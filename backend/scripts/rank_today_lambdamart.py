"""用訓練好的 LambdaMART 模型對今天的 500+ 支股票打分並排名。

用法：
    python scripts/rank_today_lambdamart.py
    python scripts/rank_today_lambdamart.py --horizon 5
    python scripts/rank_today_lambdamart.py --top 30
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from earnings_features import build_earnings_features, load_earnings_cache
from market_context import get_market_features, load_market_context
from train_classifier_xgb import (
    ANALYST_DIR,
    EARNINGS_DIR,
    HISTORY_10Y_DIR,
    HISTORY_1Y_DIR,
    FUNDAMENTALS_DIR,
    LOOKBACK_DAYS,
    _load_history_rows_from_dir,
    _load_fundamentals,
    _build_samples,
    load_analyst_cache,
)
from train_ranker_xgb import FEATURE_COLS, GRADE_THRESHOLDS

MODELS_DIR = BASE_DIR / "models"


def _apply_clip_bounds(X: pd.DataFrame, clip_bounds: dict) -> pd.DataFrame:
    """用訓練時的 IQR clip bounds 做同樣的前處理。"""
    import numpy as np
    X = X.copy()
    log_features = {"volume_ratio", "atr_ratio", "avg_volume_20"}
    for col, bounds in clip_bounds.items():
        if col not in X.columns:
            continue
        lo, hi = bounds.get("lo"), bounds.get("hi")
        if lo is not None and hi is not None:
            X[col] = X[col].clip(lower=lo, upper=hi)
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))
    return X


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", type=int, default=1)
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()

    model_path = MODELS_DIR / f"ranker_lambdamart_h{args.horizon}.joblib"
    if not model_path.exists():
        print(f"[error] 模型不存在: {model_path}")
        print("  請先執行: python scripts/train_ranker_xgb.py --horizon 1")
        return 1

    bundle   = joblib.load(model_path)
    ranker   = bundle["model"]
    metadata = bundle["metadata"]
    clip_bounds = metadata.get("clipBounds", {})
    print(f"[model] {metadata['modelType']}  horizon={metadata['horizon']}日", flush=True)
    print(f"[model] 訓練至 {metadata['trainEnd']}  CV NDCG@10={metadata['crossValidation']['ndcg10Mean']:.4f}", flush=True)

    # ── 載入今天的資料 ────────────────────────────────────────────────────
    print("[data] 載入歷史資料...", flush=True)
    market_context = load_market_context(HISTORY_10Y_DIR)
    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)

    rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    if not rows:
        rows = _load_history_rows_from_dir(HISTORY_1Y_DIR)
    if not rows:
        print("[error] 找不到歷史資料")
        return 1

    df = _build_samples(rows, market_context=market_context,
                        fundamentals=fundamentals, analyst_cache=analyst_cache)
    if df.empty:
        print("[error] 沒有可用樣本")
        return 1

    # ── 只取「最新一天」的資料（今天 = 最後一個交易日）────────────────
    latest_date = df["date"].max()
    df_today = df[df["date"] == latest_date].copy()
    print(f"[today] 日期={latest_date}  股票數={len(df_today)}", flush=True)

    if len(df_today) < 5:
        print(f"[warn] 今天只有 {len(df_today)} 支股票，嘗試最近 5 個交易日...")
        recent_dates = sorted(df["date"].unique())[-5:]
        df_today = df[df["date"].isin(recent_dates)].copy()
        df_today = df_today.sort_values("date").groupby("symbol").last().reset_index()
        df_today["date"] = latest_date
        print(f"[today] 補充後股票數={len(df_today)}", flush=True)

    # ── 特徵前處理 ────────────────────────────────────────────────────────
    X_today = df_today[FEATURE_COLS].fillna(0.0)
    X_today = _apply_clip_bounds(X_today, clip_bounds)

    # ── 預測排名分數 ──────────────────────────────────────────────────────
    scores = ranker.predict(X_today)
    df_today = df_today.copy()
    df_today["rank_score"] = scores

    # ── 取得現在價格（用 close）& 分析師 upside ──────────────────────────
    df_today["price"] = df_today["target_next_return"].apply(lambda _: None)  # placeholder
    # 從原始 rows 取最新 close
    close_map = {}
    for r in rows:
        sym = r.get("symbol", "")
        d   = r.get("date", "")
        c   = r.get("close")
        if sym and d and c is not None:
            if sym not in close_map or d > close_map[sym][0]:
                close_map[sym] = (d, float(c))
    df_today["price"] = df_today["symbol"].map(
        lambda s: close_map.get(s, ("", None))[1]
    )

    # ── 排序 & 顯示 TOP N ─────────────────────────────────────────────────
    df_ranked = df_today.sort_values("rank_score", ascending=False).reset_index(drop=True)
    df_ranked["rank"] = df_ranked.index + 1

    top = df_ranked.head(args.top)
    bottom = df_ranked.tail(10)

    print(f"\n{'='*90}")
    print(f"🏆 LambdaMART TOP {args.top} 排名  ({latest_date})")
    print(f"{'='*90}")
    print(f"{'#':<4} {'SYM':<8} {'PRICE':>8}  {'SCORE':>8}  {'ANALYST_UP':>10}  {'RAISES':>7}  {'RSI':>6}")
    print(f"{'-'*90}")
    for _, row in top.iterrows():
        price  = f"{row['price']:>8.2f}" if row["price"] else "     N/A"
        upside = row.get("analyst_upside_30d", 0.0)
        raises = row.get("analyst_raises_ratio_30d", 0.0)
        rsi    = row.get("rsi", 50.0)
        print(f"{int(row['rank']):<4} {row['symbol']:<8} {price}  {row['rank_score']:>8.4f}  "
              f"{upside:>+9.1%}  {raises:>6.0%}  {rsi:>6.1f}")

    print(f"\n{'='*90}")
    print(f"🔴 BOTTOM 10（模型認為最不值得買）")
    print(f"{'='*90}")
    print(f"{'#':<4} {'SYM':<8} {'PRICE':>8}  {'SCORE':>8}  {'ANALYST_UP':>10}")
    print(f"{'-'*90}")
    for _, row in bottom.iterrows():
        price  = f"{row['price']:>8.2f}" if row["price"] else "     N/A"
        upside = row.get("analyst_upside_30d", 0.0)
        print(f"{int(row['rank']):<4} {row['symbol']:<8} {price}  {row['rank_score']:>8.4f}  {upside:>+9.1%}")

    print(f"\n共 {len(df_ranked)} 支股票排名完成")

    # ── 對比現有 Growth Score 前20（如果有的話）──────────────────────────
    gs_path = BASE_DIR / "watchlist_predictions.json"
    if gs_path.exists():
        gs_data = json.loads(gs_path.read_text(encoding="utf-8"))
        gs_map = {d["symbol"]: d.get("growthScore", 0) for d in gs_data if isinstance(d, dict)}
        top_symbols_lm = set(top["symbol"].tolist())
        top_gs = sorted(gs_map.items(), key=lambda x: x[1], reverse=True)[:args.top]
        top_symbols_gs = set(s for s, _ in top_gs)
        overlap = top_symbols_lm & top_symbols_gs
        print(f"\n[對比] LambdaMART TOP{args.top} vs Growth Score TOP{args.top}")
        print(f"  重疊股票 ({len(overlap)}支): {', '.join(sorted(overlap))}")
        only_lm = top_symbols_lm - top_symbols_gs
        only_gs = top_symbols_gs - top_symbols_lm
        if only_lm:
            print(f"  只有 LambdaMART 選到: {', '.join(sorted(only_lm))}")
        if only_gs:
            print(f"  只有 Growth Score 選到: {', '.join(sorted(only_gs))}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
