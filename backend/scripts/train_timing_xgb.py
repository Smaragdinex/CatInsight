"""
階段2：進場時機模型（XGBRegressor）

與階段1排序模型分開的獨立模型。複用相同的特徵 pipeline（_build_samples），
但預測目標不同：

  目標 = 未來 N 日內最低點跌幅，再用該股波動率正規化（= 跌幾個 sigma）
         dip = min_{k in 1..N} ( prod(1+r_t) ) - 1
         target = dip / (volatility_20 * sqrt(N))

  為什麼正規化：原始跌幅被「正常波動」主導——高波動股(SNDK)就算最後漲120%，
  10天內也會回檔 8-11%。直接預測原始跌幅會把所有高波動股都標「等回檔」，
  誤殺追高贏家。正規化後抓的是「跌得比自己平常還凶」= 真正的時機風險。

  - 接近 0：跌幅在正常波動內 → 「現在進」
  - 很負（例如 < -0.45）：跌得異常深 → 「等回檔」（APP $693、HOOD 接刀類）

用途：對階段1選出的前20名，逐支判斷「現在進 vs 等回檔到更低點」。
這把「買什麼好公司」（階段1）和「何時買」（階段2）徹底分開，互不干擾。

用法：
    python scripts/train_timing_xgb.py --train_end 2025-11-30 --window 10
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from xgboost import XGBRegressor

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from market_context import load_market_context
from train_classifier_xgb import (
    ANALYST_DIR,
    FUNDAMENTALS_DIR,
    HISTORY_10Y_DIR,
    HISTORY_1Y_DIR,
    _apply_noise_preprocessing,
    _build_samples,
    _load_fundamentals,
    _load_history_rows_from_dir,
    load_analyst_cache,
)
from train_ranker_xgb import FEATURE_COLS

MODELS_DIR = BASE_DIR / "models"

# 「等回檔」判定門檻：預測正規化跌幅 < 此值 → 建議等回檔（跌得比平常深）
WAIT_THRESHOLD = -0.80


def _build_dip_target(df: pd.DataFrame, window: int) -> pd.DataFrame:
    """為每個 (symbol, date) 算未來 window 內最低點跌幅，並用波動率正規化。

    target = dip / (volatility_20 * sqrt(window))
    抓「跌得比自己平常還凶」而非「會不會跌」。
    """
    import math
    sqrt_w = math.sqrt(window)
    records = []
    for symbol, grp in df.groupby("symbol"):
        grp = grp.sort_values("date").reset_index(drop=True)
        rets = grp["target_next_return"].values
        vols = grp["volatility_20"].values if "volatility_20" in grp else [0.02] * len(grp)
        n = len(grp)
        targets = []
        for i in range(n):
            if i + window >= n:
                targets.append(None)
                continue
            cum = 1.0
            worst = 1.0
            for step in range(window):
                cum *= (1.0 + float(rets[i + step]))
                if cum < worst:
                    worst = cum
            dip = worst - 1.0  # <= 0
            vol = float(vols[i]) if vols[i] else 0.0
            denom = max(vol * sqrt_w, 0.01)  # 防除0，下限 1%
            targets.append(dip / denom)
        grp["dip_target"] = targets
        records.append(grp)
    out = pd.concat(records, ignore_index=True)
    return out.dropna(subset=["dip_target"])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--train_end", type=str, default=None,
                        help="訓練資料截止日（如 2025-11-30）")
    parser.add_argument("--window", type=int, default=10,
                        help="前瞻最低點視窗（交易日）")
    args = parser.parse_args()
    window = args.window

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"_{args.train_end[:7].replace('-', '')}" if args.train_end else ""
    model_path = MODELS_DIR / f"timing_xgb_w{window}{suffix}.joblib"

    print(f"[timing] 進場時機模型  window={window}日內最低點", flush=True)

    # ── 載入資料（與階段1相同 pipeline）─────────────────────────────────
    market_context = load_market_context(HISTORY_10Y_DIR)
    fundamentals = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache = load_analyst_cache(ANALYST_DIR)

    rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    source_dir = HISTORY_10Y_DIR
    if not rows:
        rows = _load_history_rows_from_dir(HISTORY_1Y_DIR)
        source_dir = HISTORY_1Y_DIR
    if not rows:
        print(json.dumps({"error": "No history data found"}))
        return 1

    df = _build_samples(rows, market_context=market_context,
                        fundamentals=fundamentals, analyst_cache=analyst_cache)
    if df.empty:
        print(json.dumps({"error": "No samples built"}))
        return 1

    # ── 計算時機目標（未來 window 最低點）────────────────────────────────
    df = _build_dip_target(df, window)
    print(f"[timing] 樣本總數: {len(df)}  "
          f"平均最低點: {df['dip_target'].mean():.3f}  "
          f"中位數: {df['dip_target'].median():.3f}", flush=True)

    # ── Time-split（與階段1相同邏輯）────────────────────────────────────
    all_dates = sorted(df["date"].unique())
    if args.train_end:
        train_end = max(d for d in all_dates if d <= args.train_end)
        test_dates = [d for d in all_dates if d > train_end]
        test_start = test_dates[min(20, len(test_dates) - 1)] if test_dates else train_end
    else:
        split_idx = int(len(all_dates) * 0.80)
        train_end = all_dates[split_idx - 1]
        test_start = all_dates[min(split_idx + 20, len(all_dates) - 1)]

    df_train = df[df["date"] <= train_end].copy()
    df_test = df[df["date"] >= test_start].copy()
    print(f"[timesplit] train_end={train_end}  test_start={test_start}  "
          f"trainRows={len(df_train)}  testRows={len(df_test)}", flush=True)

    # ── 準備 X / y ────────────────────────────────────────────────────────
    X_train_raw = df_train[FEATURE_COLS].fillna(0.0)
    X_test_raw = df_test[FEATURE_COLS].fillna(0.0)
    X_train, X_test, clip_bounds = _apply_noise_preprocessing(X_train_raw, X_test_raw)
    y_train = df_train["dip_target"].values.astype(float)
    y_test = df_test["dip_target"].values.astype(float)

    # ── 訓練 XGBRegressor ────────────────────────────────────────────────
    model = XGBRegressor(
        n_estimators=400,
        max_depth=5,
        learning_rate=0.03,
        subsample=0.8,
        colsample_bytree=0.8,
        min_child_weight=5,
        reg_lambda=1.5,
        objective="reg:squarederror",
        n_jobs=-1,
        random_state=42,
    )
    model.fit(X_train, y_train, eval_set=[(X_test, y_test)], verbose=False)

    # ── 評估 ──────────────────────────────────────────────────────────────
    pred = model.predict(X_test)
    mae = float(np.mean(np.abs(pred - y_test)))
    # 方向命中：實際大跌(<WAIT_THRESHOLD) 時模型是否也預測大跌
    actual_big_dip = y_test < WAIT_THRESHOLD
    pred_big_dip = pred < WAIT_THRESHOLD
    tp = int(np.sum(actual_big_dip & pred_big_dip))
    fp = int(np.sum(~actual_big_dip & pred_big_dip))
    fn = int(np.sum(actual_big_dip & ~pred_big_dip))
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    print(f"[eval] MAE={mae:.4f}  "
          f"等回檔訊號 precision={precision:.3f} recall={recall:.3f} "
          f"(門檻={WAIT_THRESHOLD})", flush=True)

    # ── 特徵重要性 top10 ─────────────────────────────────────────────────
    imp = pd.Series(model.feature_importances_, index=FEATURE_COLS).sort_values(ascending=False)
    print("[importance] 時機判斷前10特徵:", flush=True)
    for name, val in imp.head(10).items():
        print(f"    {name:<30} {val:.4f}", flush=True)

    # ── 存檔 ──────────────────────────────────────────────────────────────
    import joblib
    payload = {
        "featureNames": FEATURE_COLS,
        "clipBounds": clip_bounds,
        "window": window,
        "waitThreshold": WAIT_THRESHOLD,
        "trainEnd": str(train_end),
        "testStart": str(test_start),
        "testMAE": mae,
        "waitPrecision": precision,
        "waitRecall": recall,
        "sourceDir": str(source_dir),
    }
    joblib.dump({"model": model, "metadata": payload}, model_path)
    meta_path = model_path.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"savedModel": str(model_path), "metrics": payload},
                     ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
