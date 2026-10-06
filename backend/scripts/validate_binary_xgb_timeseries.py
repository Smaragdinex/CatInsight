from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score, precision_score, recall_score
from xgboost import XGBClassifier

from market_context import get_market_features, load_market_context

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
LOOKBACK_DAYS = 20
BUY_THRESHOLD = 0.01
FOLDS = [
    ("2020-2021_train__2022_test", "2021-12-31", "2022-01-01", "2022-12-31"),
    ("2020-2022_train__2023_test", "2022-12-31", "2023-01-01", "2023-12-31"),
    ("2020-2023_train__2024_test", "2023-12-31", "2024-01-01", "2024-12-31"),
    ("2020-2024_train__2025_test", "2024-12-31", "2025-01-01", "2025-12-31"),
    ("2020-2025_train__2026_test", "2025-12-31", "2026-01-01", "2026-12-31"),
]


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _load_history_rows_from_dir(history_dir: Path) -> list[dict]:
    rows: list[dict] = []
    if not history_dir.exists():
        return rows
    for path in sorted(history_dir.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or path.stem).upper().strip()
            date = str(item.get("date") or "").strip()
            close = _safe_float(item.get("close"))
            if not symbol or not date or close is None:
                continue
            rows.append({
                "symbol": symbol,
                "date": date,
                "close": close,
                "high": _safe_float(item.get("high")),
                "low": _safe_float(item.get("low")),
                "volume": _safe_float(item.get("volume")),
                "rsi14": _safe_float(item.get("rsi14")),
                "mfi14": _safe_float(item.get("mfi14")),
                "obv": _safe_float(item.get("obv")),
                "macd": _safe_float(item.get("macd")),
                "macdSignal": _safe_float(item.get("macdSignal")),
                "macdHist": _safe_float(item.get("macdHist")),
            })
    return rows


def build_binary_samples(rows: list[dict], market_context: dict[str, dict[str, dict]] | None = None) -> pd.DataFrame:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["symbol"], []).append(row)

    samples: list[dict] = []
    for symbol, items in grouped.items():
        ordered = sorted(items, key=lambda x: x["date"])
        if len(ordered) < LOOKBACK_DAYS + 2:
            continue
        closes = [float(x["close"]) for x in ordered]
        highs = [float(x["high"]) if x.get("high") is not None else x["close"] for x in ordered]
        lows = [float(x["low"]) if x.get("low") is not None else x["close"] for x in ordered]
        volumes = [float(x["volume"]) if x.get("volume") is not None else None for x in ordered]
        rsis = [x.get("rsi14") for x in ordered]
        mfis = [x.get("mfi14") for x in ordered]
        obvs = [x.get("obv") for x in ordered]
        macds = [x.get("macd") for x in ordered]
        macd_signals = [x.get("macdSignal") for x in ordered]
        macd_hists = [x.get("macdHist") for x in ordered]

        for idx in range(LOOKBACK_DAYS, len(ordered) - 1):
            window = pd.Series(closes[idx - LOOKBACK_DAYS:idx])
            if window.isna().any():
                continue
            returns = window.pct_change().dropna()
            if len(returns) < 3:
                continue
            current_close = closes[idx - 1]
            next_close = closes[idx]
            if current_close <= 0 or next_close <= 0:
                continue

            vol_window = [v for v in volumes[idx - LOOKBACK_DAYS:idx] if v is not None]
            avg_volume = float(pd.Series(vol_window).mean()) if vol_window else current_close
            volume_ratio = (float(vol_window[-1]) / avg_volume) if vol_window and avg_volume not in (0.0, -0.0) else 1.0
            target_return = (next_close / current_close) - 1.0
            label = "Buy" if target_return >= BUY_THRESHOLD else "NotBuy"

            ma5 = float(window.tail(5).mean())
            ma20 = float(window.mean())
            rsi = _safe_float(rsis[idx - 1]) or 50.0
            mfi = _safe_float(mfis[idx - 1]) or 50.0
            ma5_deviation = (current_close / ma5) - 1.0 if ma5 else 0.0
            ma20_deviation = (current_close / ma20) - 1.0 if ma20 else 0.0
            rsi_norm = (rsi - 50.0) / 50.0
            mfi_norm = (mfi - 50.0) / 50.0
            rsi_prev_3 = _safe_float(rsis[idx - 4]) if idx - 4 >= 0 else None
            mfi_prev_3 = _safe_float(mfis[idx - 4]) if idx - 4 >= 0 else None
            obv_now = _safe_float(obvs[idx - 1])
            obv_prev_5 = _safe_float(obvs[idx - 6]) if idx - 6 >= 0 else None
            macd_now = _safe_float(macds[idx - 1]) or 0.0
            macd_signal_now = _safe_float(macd_signals[idx - 1]) or 0.0
            macd_hist_now = _safe_float(macd_hists[idx - 1]) or 0.0
            macd_hist_prev_3 = _safe_float(macd_hists[idx - 4]) if idx - 4 >= 0 else None
            market_features = get_market_features(market_context or {}, ordered[idx - 1]["date"])
            spy_close = market_context.get("SPY", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            soxx_close = market_context.get("SOXX", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None

            sample = {
                "symbol": symbol,
                "date": ordered[idx - 1]["date"],
                "nextDate": ordered[idx]["date"],
                "currentClose": current_close,
                "nextClose": next_close,
                "target_next_return": target_return,
                "actualLabel": label,
                "lag_1_return": float(returns.iloc[-1]),
                "lag_2_return": float(returns.iloc[-2]) if len(returns) >= 2 else float(returns.iloc[-1]),
                "lag_3_return": float(returns.iloc[-3]) if len(returns) >= 3 else float(returns.iloc[-1]),
                "mean_return_5": float(returns.tail(5).mean()),
                "mean_return_20": float(returns.mean()),
                "volatility_20": float(returns.std(ddof=0) or 0.0),
                "momentum_20": float((window.iloc[-1] / window.iloc[0]) - 1.0),
                "avg_volume_20": avg_volume,
                "volume_ratio": volume_ratio,
                "range_ratio": float((max(highs[idx - LOOKBACK_DAYS:idx]) - min(lows[idx - LOOKBACK_DAYS:idx])) / max(current_close, 1e-9)),
                "rsi": rsi,
                "mfi": mfi,
                "rsi_norm": rsi_norm,
                "mfi_norm": mfi_norm,
                "rsi_change_3d": (rsi - rsi_prev_3) if rsi_prev_3 is not None else 0.0,
                "mfi_change_3d": (mfi - mfi_prev_3) if mfi_prev_3 is not None else 0.0,
                "ma5_deviation": ma5_deviation,
                "ma20_deviation": ma20_deviation,
                "rsi_delta_1": 0.0,
                "mfi_delta_1": 0.0,
                "ma5_slope": 0.0,
                "ma20_slope": 0.0,
                "vwap_deviation": 0.0,
                "atr_ratio": 0.0,
                "price_mfi_divergence": 0.0,
                "obv_change_5": ((obv_now - obv_prev_5) / abs(obv_prev_5)) if obv_now is not None and obv_prev_5 not in (None, 0.0, -0.0) else 0.0,
                "macd": macd_now,
                "macdSignal": macd_signal_now,
                "macdHist": macd_hist_now,
                "macdHist_change_3d": (macd_hist_now - macd_hist_prev_3) if macd_hist_prev_3 is not None else 0.0,
                "relative_strength_spy": (current_close / spy_close) if spy_close not in (None, 0.0, -0.0) else 1.0,
                "relative_strength_soxx": (current_close / soxx_close) if soxx_close not in (None, 0.0, -0.0) else 1.0,
                **market_features,
            }
            samples.append(sample)
    return pd.DataFrame(samples)


def main() -> int:
    rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    market_context = load_market_context(HISTORY_10Y_DIR)
    df = build_binary_samples(rows, market_context=market_context)
    if df.empty:
        print(json.dumps({"error": "No samples found"}, ensure_ascii=False, indent=2))
        return 1

    feature_cols = [
        "lag_1_return", "lag_2_return", "lag_3_return", "mean_return_5", "mean_return_20",
        "volatility_20", "momentum_20", "avg_volume_20", "volume_ratio", "range_ratio",
        "rsi", "mfi", "rsi_norm", "mfi_norm", "rsi_change_3d", "mfi_change_3d",
        "ma5_deviation", "ma20_deviation", "rsi_delta_1", "mfi_delta_1", "ma5_slope",
        "ma20_slope", "vwap_deviation", "atr_ratio", "price_mfi_divergence", "obv_change_5",
        "macd", "macdSignal", "macdHist", "macdHist_change_3d", "relative_strength_spy",
        "relative_strength_soxx", "spy_return1d", "qqq_return1d", "soxx_return1d", "vix_change1d",
        "spy_rsi14", "qqq_rsi14", "soxx_rsi14", "vix_rsi14",
        "spy_macdHist", "qqq_macdHist", "soxx_macdHist", "vix_macdHist", "vix_level",
    ]

    label_map = {"NotBuy": 0, "Buy": 1}
    inv_label_map = {v: k for k, v in label_map.items()}

    fold_results = []
    for fold_name, train_end, test_start, test_end in FOLDS:
        train_df = df[df["date"] <= train_end].copy()
        test_df = df[(df["date"] >= test_start) & (df["date"] <= test_end)].copy()
        if train_df.empty or test_df.empty:
            continue

        X_train = train_df[feature_cols].fillna(0.0)
        y_train = train_df["actualLabel"].map(label_map)
        X_test = test_df[feature_cols].fillna(0.0)
        y_test_labels = test_df["actualLabel"]

        clf = XGBClassifier(
            n_estimators=400,
            max_depth=6,
            learning_rate=0.05,
            subsample=0.9,
            colsample_bytree=0.8,
            objective="binary:logistic",
            eval_metric="logloss",
            random_state=42,
            n_jobs=4,
        )
        clf.fit(X_train, y_train)
        y_pred_num = (clf.predict_proba(X_test)[:, 1] >= 0.5).astype(int)
        y_pred_labels = pd.Series(y_pred_num).map(inv_label_map)

        bt = test_df[["symbol", "date", "nextDate", "target_next_return", "actualLabel"]].copy()
        bt["predictedLabel"] = y_pred_labels.values
        buy_df = bt[bt["predictedLabel"] == "Buy"].copy()
        notbuy_df = bt[bt["predictedLabel"] == "NotBuy"].copy()

        fold_results.append({
            "fold": fold_name,
            "trainEnd": train_end,
            "testStart": test_start,
            "testEnd": test_end,
            "trainRows": int(len(train_df)),
            "testRows": int(len(test_df)),
            "accuracy": round(float(accuracy_score(y_test_labels, y_pred_labels)), 6),
            "f1Macro": round(float(f1_score(y_test_labels, y_pred_labels, average="macro")), 6),
            "precisionBuy": round(float(precision_score(y_test_labels, y_pred_labels, pos_label="Buy", zero_division=0)), 6),
            "recallBuy": round(float(recall_score(y_test_labels, y_pred_labels, pos_label="Buy", zero_division=0)), 6),
            "confusionMatrix": confusion_matrix(y_test_labels, y_pred_labels, labels=["Buy", "NotBuy"]).tolist(),
            "classificationReport": classification_report(y_test_labels, y_pred_labels, output_dict=True, zero_division=0),
            "buySignals": {
                "count": int(len(buy_df)),
                "avgReturn": round(float(buy_df["target_next_return"].mean()), 6) if not buy_df.empty else None,
                "medianReturn": round(float(buy_df["target_next_return"].median()), 6) if not buy_df.empty else None,
                "winRate": round(float((buy_df["target_next_return"] > 0).mean()), 6) if not buy_df.empty else None,
                "hitBuyLabelRate": round(float((buy_df["actualLabel"] == "Buy").mean()), 6) if not buy_df.empty else None,
            },
            "notBuySignals": {
                "count": int(len(notbuy_df)),
                "avgReturn": round(float(notbuy_df["target_next_return"].mean()), 6) if not notbuy_df.empty else None,
                "medianReturn": round(float(notbuy_df["target_next_return"].median()), 6) if not notbuy_df.empty else None,
                "winRate": round(float((notbuy_df["target_next_return"] > 0).mean()), 6) if not notbuy_df.empty else None,
            },
        })

    if not fold_results:
        print(json.dumps({"error": "No valid folds produced results"}, ensure_ascii=False, indent=2))
        return 1

    result_df = pd.DataFrame([{k: v for k, v in r.items() if isinstance(v, (int, float, str))} for r in fold_results])
    summary = {
        "modelType": "XGBClassifier-Binary",
        "buyThreshold": BUY_THRESHOLD,
        "validationType": "ExpandingWindow-TimeSeriesSplit-5fold",
        "folds": fold_results,
        "aggregate": {
            "meanAccuracy": round(float(result_df["accuracy"].mean()), 6),
            "stdAccuracy": round(float(result_df["accuracy"].std(ddof=0)), 6),
            "meanF1Macro": round(float(result_df["f1Macro"].mean()), 6),
            "stdF1Macro": round(float(result_df["f1Macro"].std(ddof=0)), 6),
            "meanPrecisionBuy": round(float(result_df["precisionBuy"].mean()), 6),
            "meanRecallBuy": round(float(result_df["recallBuy"].mean()), 6),
        },
    }

    out_path = BASE_DIR / "reports" / "xgb_binary_timeseries_validation.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(summary, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
