"""Train XGBRanker (LambdaMART) for stock ranking.

每天的所有股票 = 一個 query group。
Label 是漲幅等級（0/1/2/3），模型學的是「同一天內誰排前面」。
這比預測絕對漲幅更穩定，因為目標函數直接優化排名品質（NDCG）。

用法：
    python scripts/train_ranker_xgb.py
    python scripts/train_ranker_xgb.py --horizon 5   # 預測5日後漲幅
    python scripts/train_ranker_xgb.py --horizon 10
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.metrics import ndcg_score
from xgboost import XGBRanker

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from earnings_features import build_earnings_features, load_earnings_cache
from market_context import get_market_features, load_market_context
from train_classifier_xgb import (
    ANALYST_DIR,
    EARNINGS_DIR,
    FUNDAMENTALS_DIR,
    HISTORY_10Y_DIR,
    HISTORY_1Y_DIR,
    LOOKBACK_DAYS,
    _apply_noise_preprocessing,
    _build_samples,
    _load_fundamentals,
    _load_history_rows_from_dir,
    build_analyst_features,
    load_analyst_cache,
)

MODELS_DIR = BASE_DIR / "models"

# ── 漲幅等級定義 ─────────────────────────────────────────────────────────────
# 0 = 明顯虧損    return < -5%
# 1 = 持平/小漲   -5% ~ +3%
# 2 = 中等漲幅    +3% ~ +10%
# 3 = 強勢大漲    > +10%
GRADE_THRESHOLDS = [-0.05, 0.03, 0.10]


def _return_to_grade(ret: float) -> int:
    if ret < GRADE_THRESHOLDS[0]:
        return 0
    if ret < GRADE_THRESHOLDS[1]:
        return 1
    if ret < GRADE_THRESHOLDS[2]:
        return 2
    return 3


def _build_horizon_return(df: pd.DataFrame, horizon: int) -> pd.DataFrame:
    """把 target_next_return (1日) 換成 horizon 日後的累積漲幅。

    用每支股票按日期排序，取 horizon 天後的 close / 今天 close - 1。
    """
    if horizon <= 1:
        df["horizon_return"] = df["target_next_return"]
        return df

    records = []
    for symbol, grp in df.groupby("symbol"):
        grp = grp.sort_values("date").reset_index(drop=True)
        closes = grp["target_next_return"].values  # 近似：用累積
        # 直接用 close 序列重建
        # target_next_return = next_close/current_close - 1
        # 我們需要 h 步後的累積報酬
        n = len(grp)
        h_rets = []
        for i in range(n):
            end = i + horizon
            if end >= n:
                h_rets.append(None)
            else:
                # 累積: prod(1 + r_t) - 1 for t in [i, i+horizon)
                cum = 1.0
                for step in range(horizon):
                    cum *= (1.0 + float(grp.iloc[i + step]["target_next_return"]))
                h_rets.append(cum - 1.0)
        grp["horizon_return"] = h_rets
        records.append(grp)

    out = pd.concat(records, ignore_index=True)
    return out.dropna(subset=["horizon_return"])


FEATURE_COLS = [
    "lag_1_return", "lag_2_return", "lag_3_return",
    "mean_return_5", "mean_return_20",
    "volatility_20", "momentum_20",
    "avg_volume_20", "volume_ratio",
    "rsi", "mfi", "rsi_norm", "mfi_norm",
    "rsi_change_3d", "mfi_change_3d",
    "ma5_deviation", "ma20_deviation",
    "rsi_delta_1", "mfi_delta_1",
    "ma5_slope", "ma20_slope",
    "vwap_deviation", "price_mfi_divergence",
    "obv_change_5",
    "macd", "macdSignal", "macdHist", "macdHist_change_3d",
    "relative_strength_spy", "relative_strength_soxx",
    "relative_strength_spy_change_3d", "relative_strength_soxx_change_3d",
    "spy_return1d", "qqq_return1d", "soxx_return1d", "vix_change1d",
    "spy_rsi14", "qqq_rsi14", "soxx_rsi14", "vix_rsi14",
    "spy_macdHist", "qqq_macdHist", "soxx_macdHist", "vix_macdHist",
    "vix_level",
    "pe_ratio_log", "profit_margin", "gross_margin", "gross_net_spread",
    "eps_growth", "revenue_growth",
    "has_fundamentals",
    "eps_surprise_pct", "earnings_beat",
    "post_earnings_gap_pct",
    "analyst_upside_30d", "analyst_raises_ratio_30d",
    "analyst_coverage_30d", "analyst_target_high_30d",
    "eps_qoq", "eps_trend_3q", "next_eps_est_vs_prev", "eps_yoy", "eps_accel", "beat_streak",
    "price_to_52w_high", "price_to_52w_low", "eps_price_divergence",
    "price_to_fair_value", "log_market_cap",
    "consecutive_neg_eps", "analyst_raises_x_momentum",
    "eps_pos_streak", "eps_turnaround",
    "eps_analyst_lag", "value_growth",
    "loss_depth", "quality_eps_growth", "momentum_x_eps_lag",
    "crash_no_support", "revenue_growth_x_margin", "pe_momentum",
    "beat_streak_quality",
    "gold_corr_60d",
    "oil_corr_60d",
    "btc_corr_60d",
    "btc_p52w_high",
    "eps_miss",
    "gld_momentum_20d",
    "cl_momentum_20d",
    "btc_momentum_20d",
    "beat_streak_x_momentum",
    "neg_margin_x_miss",
    "consec_loss_sq",
    "spy_momentum_20d",
    "vix_change_5d",
    "beta_60d",
    "drawdown_depth",
    "low_gross_margin",
    "drawdown_x_momentum",
    "momentum_accel",
    "vol_surge_20_60",
    "hot_score",
    "cold_penalty",
    "accel_x_volume",
    "overrun_risk",
    "deep_value",
    "value_x_momentum",
    "overrun_x_neg_momentum",
    # 讓模型學習 Hard Filter 邏輯的交互特徵
    "oil_bear_signal",
    "gold_bear_signal",
    "btc_bear_signal",
    "hot_macro_headwind",
    "rsi_miss_combo",
    "crash_momentum",
    "dead_cat",
    "loss_miss_signal",
    "next_est_decline",
    "stale_target_risk",
    "hot_valuation_risk",
    "crowded_momentum",
    "falling_knife",
    "ttm_profit_margin",
    "ttm_revenue_yoy",
]


def _ndcg_at_k(y_true_groups, y_pred_groups, k: int = 10) -> float:
    """Mean NDCG@K across all query groups."""
    scores = []
    for yt, yp in zip(y_true_groups, y_pred_groups):
        if len(yt) < 2:
            continue
        scores.append(ndcg_score([yt], [yp], k=min(k, len(yt))))
    return float(sum(scores) / len(scores)) if scores else 0.0


def _split_into_groups(df: pd.DataFrame, feature_cols: list[str]):
    """Sort by date, return X, grades, group_sizes, dates."""
    df_sorted = df.sort_values(["date", "symbol"]).reset_index(drop=True)
    X = df_sorted[feature_cols].fillna(0.0).values
    grades = df_sorted["grade"].values.astype(int)
    group_sizes = df_sorted.groupby("date").size().sort_index().values.tolist()
    return X, grades, group_sizes, df_sorted


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", type=int, default=1,
                        help="預測幾日後漲幅作為排名依據 (default: 1)")
    parser.add_argument("--train_end", type=str, default=None,
                        help="訓練截止日 e.g. 2026-03-01（預設：全資料的前80%%）")
    args = parser.parse_args()
    horizon = args.horizon

    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    suffix = f"_{args.train_end[:7].replace('-','')}" if args.train_end else ""
    model_path = MODELS_DIR / f"ranker_lambdamart_h{horizon}{suffix}.joblib"

    print(f"[ranker] horizon={horizon}日後漲幅排名", flush=True)

    # ── 載入資料 ──────────────────────────────────────────────────────────
    market_context = load_market_context(HISTORY_10Y_DIR)
    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)

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

    # ── 計算 horizon 報酬 & 等級 ─────────────────────────────────────────
    df = _build_horizon_return(df, horizon)
    df["grade"] = df["horizon_return"].apply(_return_to_grade)

    grade_dist = df["grade"].value_counts().sort_index().to_dict()
    print(f"[ranker] 樣本總數: {len(df)}  等級分佈: {grade_dist}", flush=True)

    # ── 過濾每天至少有 5 支股票的日期（太少無法排名）───────────────────
    day_counts = df.groupby("date").size()
    valid_dates = day_counts[day_counts >= 5].index
    df = df[df["date"].isin(valid_dates)]
    print(f"[ranker] 有效交易日: {len(valid_dates)}  過濾後樣本: {len(df)}", flush=True)

    # ── Time-split ────────────────────────────────────────────────────────
    all_dates = sorted(df["date"].unique())
    if args.train_end:
        # 用指定截止日
        train_end  = max(d for d in all_dates if d <= args.train_end)
        test_dates = [d for d in all_dates if d > train_end]
        test_start = test_dates[min(20, len(test_dates)-1)] if test_dates else train_end
    else:
        split_idx  = int(len(all_dates) * 0.80)
        train_end  = all_dates[split_idx - 1]
        test_start = all_dates[min(split_idx + 20, len(all_dates) - 1)]

    df_train = df[df["date"] <= train_end].copy()
    df_test  = df[df["date"] >= test_start].copy()
    print(f"[timesplit] train_end={train_end}  test_start={test_start}", flush=True)
    print(f"[timesplit] trainRows={len(df_train)}  testRows={len(df_test)}", flush=True)

    # ── 準備 X / grades / groups ─────────────────────────────────────────
    X_train_raw = df_train[FEATURE_COLS].fillna(0.0)
    X_test_raw  = df_test[FEATURE_COLS].fillna(0.0)
    X_train_clean, X_test_clean, clip_bounds = _apply_noise_preprocessing(
        X_train_raw, X_test_raw
    )

    df_train_sorted = df_train.sort_values(["date", "symbol"])
    y_train = df_train_sorted["grade"].values.astype(int)
    # 樣本加權：grade0（輸家）權重 2×，grade3（大贏家）權重 1.5×，讓模型更重視反例
    _grade_weights = {0: 2.0, 1: 1.0, 2: 1.0, 3: 1.5}
    y_test  = df_test.sort_values(["date", "symbol"])["grade"].values.astype(int)

    grp_train = (df_train.sort_values(["date", "symbol"])
                 .groupby("date").size().sort_index().values.tolist())
    grp_test  = (df_test.sort_values(["date", "symbol"])
                 .groupby("date").size().sort_index().values.tolist())

    # XGBoost ranking needs per-group weights (one per trading date), not per-sample
    _grp_w_train: list[float] = []
    _offset = 0
    for _gsz in grp_train:
        _grades = y_train[_offset:_offset + _gsz]
        _grp_w_train.append(max(_grade_weights.get(int(g), 1.0) for g in _grades))
        _offset += _gsz
    w_train = np.array(_grp_w_train, dtype=float)

    X_train_sorted = df_train.sort_values(["date", "symbol"])[FEATURE_COLS].fillna(0.0)
    X_test_sorted  = df_test.sort_values(["date", "symbol"])[FEATURE_COLS].fillna(0.0)
    X_train_sorted, X_test_sorted, _ = _apply_noise_preprocessing(
        X_train_sorted, X_test_sorted
    )

    # ── TimeSeriesSplit 5-fold CV ─────────────────────────────────────────
    print("\n[cross_val] TimeSeriesSplit 5-fold CV ...", flush=True)
    n_splits = 5
    date_list = sorted(df["date"].unique())
    fold_size = len(date_list) // (n_splits + 1)
    cv_ndcg: list[float] = []

    for fold_i in range(1, n_splits + 1):
        cv_train_end_idx = fold_i * fold_size
        cv_test_end_idx  = cv_train_end_idx + fold_size
        cv_train_dates = date_list[:cv_train_end_idx]
        cv_test_dates  = date_list[cv_train_end_idx:cv_test_end_idx]
        if not cv_train_dates or not cv_test_dates:
            continue

        cv_df_tr = df[df["date"].isin(cv_train_dates)]
        cv_df_te = df[df["date"].isin(cv_test_dates)]
        if cv_df_tr.empty or cv_df_te.empty:
            continue

        cv_X_tr = cv_df_tr.sort_values(["date", "symbol"])[FEATURE_COLS].fillna(0.0)
        cv_X_te = cv_df_te.sort_values(["date", "symbol"])[FEATURE_COLS].fillna(0.0)
        cv_X_tr, cv_X_te, _ = _apply_noise_preprocessing(cv_X_tr, cv_X_te)

        cv_df_tr_sorted = cv_df_tr.sort_values(["date", "symbol"])
        cv_y_tr = cv_df_tr_sorted["grade"].values.astype(int)
        cv_y_te = cv_df_te.sort_values(["date", "symbol"])["grade"].values.astype(int)

        cv_grp_tr = (cv_df_tr.sort_values(["date", "symbol"])
                     .groupby("date").size().sort_index().values.tolist())
        cv_grp_te = (cv_df_te.sort_values(["date", "symbol"])
                     .groupby("date").size().sort_index().values.tolist())

        # Per-group weights for CV fold
        _cv_grp_w: list[float] = []
        _cv_off = 0
        for _gsz in cv_grp_tr:
            _g = cv_y_tr[_cv_off:_cv_off + _gsz]
            _cv_grp_w.append(max(_grade_weights.get(int(x), 1.0) for x in _g))
            _cv_off += _gsz
        cv_w_tr = np.array(_cv_grp_w, dtype=float)

        cv_ranker = XGBRanker(
            objective="rank:ndcg",
            n_estimators=200,
            max_depth=4,
            learning_rate=0.05,
            subsample=0.8,
            colsample_bytree=0.5,
            colsample_bylevel=0.7,
            min_child_weight=10,
            random_state=42,
            n_jobs=4,
        )
        cv_ranker.fit(cv_X_tr, cv_y_tr, group=cv_grp_tr, sample_weight=cv_w_tr)
        cv_scores = cv_ranker.predict(cv_X_te)

        # NDCG@10: split scores back into daily groups
        true_groups, pred_groups = [], []
        offset = 0
        for g in cv_grp_te:
            true_groups.append(cv_y_te[offset:offset + g].tolist())
            pred_groups.append(cv_scores[offset:offset + g].tolist())
            offset += g
        ndcg_k = _ndcg_at_k(true_groups, pred_groups, k=10)
        cv_ndcg.append(ndcg_k)
        print(f"  Fold {fold_i}: NDCG@10={ndcg_k:.4f}  "
              f"(train_days={len(cv_train_dates)}, test_days={len(cv_test_dates)})",
              flush=True)

    cv_ndcg_mean = float(sum(cv_ndcg) / len(cv_ndcg)) if cv_ndcg else 0.0
    cv_ndcg_std  = float((sum((s - cv_ndcg_mean) ** 2 for s in cv_ndcg) / max(len(cv_ndcg), 1)) ** 0.5)
    print(f"[cross_val] NDCG@10 = {cv_ndcg_mean:.4f} ± {cv_ndcg_std:.4f}", flush=True)

    # ── 訓練最終模型 ─────────────────────────────────────────────────────
    print("\n[train] 訓練最終 LambdaMART 模型 ...", flush=True)
    ranker = XGBRanker(
        objective="rank:ndcg",
        n_estimators=400,
        max_depth=4,
        learning_rate=0.05,
        subsample=0.8,
        colsample_bytree=0.5,
        colsample_bylevel=0.7,
        min_child_weight=10,
        random_state=42,
        n_jobs=4,
    )
    ranker.fit(X_train_sorted, y_train, group=grp_train, sample_weight=w_train)

    # ── 測試集評估 ────────────────────────────────────────────────────────
    test_scores = ranker.predict(X_test_sorted)
    true_groups, pred_groups = [], []
    offset = 0
    for g in grp_test:
        true_groups.append(y_test[offset:offset + g].tolist())
        pred_groups.append(test_scores[offset:offset + g].tolist())
        offset += g

    test_ndcg_10 = _ndcg_at_k(true_groups, pred_groups, k=10)
    test_ndcg_20 = _ndcg_at_k(true_groups, pred_groups, k=20)
    print(f"[eval] Test NDCG@10={test_ndcg_10:.4f}  NDCG@20={test_ndcg_20:.4f}", flush=True)

    # ── 儲存模型 ─────────────────────────────────────────────────────────
    import joblib
    payload = {
        "modelType": "XGBRanker-LambdaMART",
        "horizon": horizon,
        "gradeThresholds": GRADE_THRESHOLDS,
        "featureNames": FEATURE_COLS,
        "lookbackDays": LOOKBACK_DAYS,
        "trainEnd": str(train_end),
        "testStart": str(test_start),
        "trainRows": int(len(df_train)),
        "testRows": int(len(df_test)),
        "testNDCG10": round(test_ndcg_10, 6),
        "testNDCG20": round(test_ndcg_20, 6),
        "crossValidation": {
            "method": "TimeSeriesSplit-manual",
            "nSplits": n_splits,
            "ndcg10Mean": round(cv_ndcg_mean, 6),
            "ndcg10Std":  round(cv_ndcg_std, 6),
            "foldNDCG10": [round(s, 6) for s in cv_ndcg],
        },
        "clipBounds": clip_bounds,
        "sourceDir": str(source_dir),
    }
    joblib.dump({"model": ranker, "metadata": payload}, model_path)
    meta_path = model_path.with_suffix(".meta.json")
    meta_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    print(json.dumps({"savedModel": str(model_path), "metrics": payload},
                     ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
