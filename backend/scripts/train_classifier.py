from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import train_test_split
from market_context import get_market_features, load_market_context


BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
HISTORY_1Y_DIR = BASE_DIR / "data" / "history_1y"
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "action_classifier.joblib"
LOOKBACK_DAYS = 20
BUY_THRESHOLD = 0.01
AVOID_THRESHOLD = -0.015


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


def _calc_rsi(window: pd.Series, period: int = 14) -> float | None:
    if len(window) < period + 1:
        return None
    delta = window.diff().dropna()
    if delta.empty:
        return None
    gain = delta.clip(lower=0).tail(period).mean()
    loss = (-delta.clip(upper=0)).tail(period).mean()
    if loss == 0:
        return 100.0
    rs = gain / loss
    return 100.0 - (100.0 / (1.0 + rs))


def _calc_mfi(high: list[float], low: list[float], close: list[float], volume: list[float], period: int = 14) -> float | None:
    if len(close) < period + 1 or len(high) < period + 1 or len(low) < period + 1 or len(volume) < period + 1:
        return None
    tp = pd.Series([(h + l + c) / 3.0 for h, l, c in zip(high, low, close)])
    vol = pd.Series(volume)
    money_flow = tp * vol
    positive = []
    negative = []
    for i in range(1, len(tp)):
        if tp.iloc[i] > tp.iloc[i - 1]:
            positive.append(float(money_flow.iloc[i]))
            negative.append(0.0)
        elif tp.iloc[i] < tp.iloc[i - 1]:
            positive.append(0.0)
            negative.append(float(money_flow.iloc[i]))
        else:
            positive.append(0.0)
            negative.append(0.0)
    pos_sum = sum(positive[-period:])
    neg_sum = sum(negative[-period:])
    if neg_sum == 0:
        return 100.0
    mfr = pos_sum / neg_sum
    return 100.0 - (100.0 / (1.0 + mfr))


def _build_samples(rows: list[dict], market_context: dict[str, dict[str, dict]] | None = None) -> pd.DataFrame:
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
            if target_return >= BUY_THRESHOLD:
                label = "Buy"
            elif target_return <= AVOID_THRESHOLD:
                label = "Avoid"
            else:
                label = "Wait"

            ma5 = float(window.tail(5).mean())
            ma20 = float(window.mean())
            rsi = _safe_float(rsis[idx - 1])
            mfi = _safe_float(mfis[idx - 1])
            if rsi is None:
                rsi = _calc_rsi(window)
            if mfi is None:
                mfi = _calc_mfi(highs[idx - LOOKBACK_DAYS:idx], lows[idx - LOOKBACK_DAYS:idx], closes[idx - LOOKBACK_DAYS:idx], [v if v is not None else avg_volume for v in volumes[idx - LOOKBACK_DAYS:idx]])
            ma5_deviation = (current_close / ma5) - 1.0 if ma5 else 0.0
            ma20_deviation = (current_close / ma20) - 1.0 if ma20 else 0.0
            rsi_norm = ((rsi - 50.0) / 50.0) if rsi is not None else 0.0
            mfi_norm = ((mfi - 50.0) / 50.0) if mfi is not None else 0.0
            rsi_delta_1 = (rsi - _calc_rsi(pd.Series(closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]))) if rsi is not None else 0.0
            mfi_prev = _calc_mfi(highs[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], lows[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], [v if v is not None else avg_volume for v in volumes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]])
            mfi_delta_1 = (mfi - mfi_prev) if (mfi is not None and mfi_prev is not None) else 0.0
            ma5_slope = (ma5 - float(pd.Series(closes[idx - LOOKBACK_DAYS:idx - 1]).tail(5).mean())) if idx - LOOKBACK_DAYS - 1 >= 0 else 0.0
            ma20_slope = (ma20 - float(pd.Series(closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]).mean())) if idx - LOOKBACK_DAYS - 1 >= 0 else 0.0
            price_mfi_divergence = ((current_close / max(closes[idx - 2], 1e-9)) - 1.0) - ((mfi_delta_1 or 0.0) / 100.0)
            typical_price = pd.Series([(h + l + c) / 3.0 for h, l, c in zip(highs[idx - LOOKBACK_DAYS:idx], lows[idx - LOOKBACK_DAYS:idx], closes[idx - LOOKBACK_DAYS:idx])])
            vwap = float((typical_price * pd.Series(vol_window if vol_window else [avg_volume] * len(typical_price))).sum() / max(sum(vol_window) if vol_window else avg_volume * len(typical_price), 1e-9))
            vwap_deviation = (current_close / vwap) - 1.0 if vwap else 0.0
            true_ranges = []
            for j in range(max(1, idx - LOOKBACK_DAYS + 1), idx):
                prev_close = closes[j - 1]
                tr = max(
                    highs[j] - lows[j],
                    abs(highs[j] - prev_close),
                    abs(lows[j] - prev_close),
                )
                true_ranges.append(tr)
            atr = float(pd.Series(true_ranges).tail(14).mean()) if true_ranges else 0.0
            atr_ratio = atr / max(current_close, 1e-9)
            price_mfi_divergence = ((current_close / max(closes[idx - 2], 1e-9)) - 1.0) - ((mfi_delta_1 or 0.0) / 100.0)
            atr_ratio = atr / max(current_close, 1e-9)
            true_ranges = []
            for j in range(max(1, idx - LOOKBACK_DAYS + 1), idx):
                prev_close = closes[j - 1]
                tr = max(
                    highs[j] - lows[j],
                    abs(highs[j] - prev_close),
                    abs(lows[j] - prev_close),
                )
                true_ranges.append(tr)
            atr = float(pd.Series(true_ranges).tail(14).mean()) if true_ranges else 0.0
            atr_ratio = atr / max(current_close, 1e-9)

            obv_now = _safe_float(obvs[idx - 1])
            obv_prev_5 = _safe_float(obvs[idx - 6]) if idx - 6 >= 0 else None
            macd_now = _safe_float(macds[idx - 1])
            macd_signal_now = _safe_float(macd_signals[idx - 1])
            macd_hist_now = _safe_float(macd_hists[idx - 1])
            rsi_prev_3 = _safe_float(rsis[idx - 4]) if idx - 4 >= 0 else None
            mfi_prev_3 = _safe_float(mfis[idx - 4]) if idx - 4 >= 0 else None
            macd_hist_prev_3 = _safe_float(macd_hists[idx - 4]) if idx - 4 >= 0 else None
            market_features = get_market_features(market_context or {}, ordered[idx - 1]["date"])
            spy_close = market_context.get("SPY", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            soxx_close = market_context.get("SOXX", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            samples.append({
                "symbol": symbol,
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
                "rsi": rsi if rsi is not None else 50.0,
                "mfi": mfi if mfi is not None else 50.0,
                "rsi_norm": rsi_norm,
                "mfi_norm": mfi_norm,
                "rsi_change_3d": (rsi - rsi_prev_3) if rsi is not None and rsi_prev_3 is not None else 0.0,
                "mfi_change_3d": (mfi - mfi_prev_3) if mfi is not None and mfi_prev_3 is not None else 0.0,
                "ma5_deviation": ma5_deviation,
                "ma20_deviation": ma20_deviation,
                "rsi_delta_1": rsi_delta_1,
                "mfi_delta_1": mfi_delta_1,
                "ma5_slope": ma5_slope,
                "ma20_slope": ma20_slope,
                "vwap_deviation": vwap_deviation,
                "price_mfi_divergence": price_mfi_divergence,
                "atr_ratio": atr_ratio,
                "obv_change_5": ((obv_now - obv_prev_5) / abs(obv_prev_5)) if obv_now is not None and obv_prev_5 not in (None, 0.0, -0.0) else 0.0,
                "macd": macd_now if macd_now is not None else 0.0,
                "macdSignal": macd_signal_now if macd_signal_now is not None else 0.0,
                "macdHist": macd_hist_now if macd_hist_now is not None else 0.0,
                "macdHist_change_3d": (macd_hist_now - macd_hist_prev_3) if macd_hist_now is not None and macd_hist_prev_3 is not None else 0.0,
                "relative_strength_spy": (current_close / spy_close) if spy_close not in (None, 0.0, -0.0) else 1.0,
                "relative_strength_soxx": (current_close / soxx_close) if soxx_close not in (None, 0.0, -0.0) else 1.0,
                "target_next_return": target_return,
                "label": label,
                **market_features,
            })
            prev_date_3 = ordered[idx - 4]["date"] if idx - 4 >= 0 else None
            spy_close_prev_3 = market_context.get("SPY", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            soxx_close_prev_3 = market_context.get("SOXX", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            rs_spy_prev_3 = (closes[idx - 4] / spy_close_prev_3) if idx - 4 >= 0 and spy_close_prev_3 not in (None, 0.0, -0.0) else None
            rs_soxx_prev_3 = (closes[idx - 4] / soxx_close_prev_3) if idx - 4 >= 0 and soxx_close_prev_3 not in (None, 0.0, -0.0) else None
            samples[-1]["relative_strength_spy_change_3d"] = (samples[-1]["relative_strength_spy"] - rs_spy_prev_3) if rs_spy_prev_3 is not None else 0.0
            samples[-1]["relative_strength_soxx_change_3d"] = (samples[-1]["relative_strength_soxx"] - rs_soxx_prev_3) if rs_soxx_prev_3 is not None else 0.0
    return pd.DataFrame(samples)


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    market_context = load_market_context(HISTORY_10Y_DIR)
    rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    source_dir = HISTORY_10Y_DIR
    if not rows:
        rows = _load_history_rows_from_dir(HISTORY_1Y_DIR)
        source_dir = HISTORY_1Y_DIR
    if not rows:
        print(json.dumps({"error": "No history data found"}, ensure_ascii=False, indent=2))
        return 1

    df = _build_samples(rows, market_context=market_context)
    if df.empty:
        print(json.dumps({"error": "No usable classifier samples found"}, ensure_ascii=False, indent=2))
        return 1

    feature_cols = [
        "lag_1_return",
        "lag_2_return",
        "lag_3_return",
        "mean_return_5",
        "mean_return_20",
        "volatility_20",
        "momentum_20",
        "avg_volume_20",
        "volume_ratio",
        "range_ratio",
        "rsi",
        "mfi",
        "rsi_norm",
        "mfi_norm",
        "rsi_change_3d",
        "mfi_change_3d",
        "ma5_deviation",
        "ma20_deviation",
        "rsi_delta_1",
        "mfi_delta_1",
        "ma5_slope",
        "ma20_slope",
        "vwap_deviation",
        "atr_ratio",
        "price_mfi_divergence",
        "obv_change_5",
        "macd",
        "macdSignal",
        "macdHist",
        "macdHist_change_3d",
        "relative_strength_spy",
        "relative_strength_soxx",
        "relative_strength_spy_change_3d",
        "relative_strength_soxx_change_3d",
        "spy_return1d",
        "qqq_return1d",
        "soxx_return1d",
        "vix_change1d",
        "spy_rsi14",
        "qqq_rsi14",
        "soxx_rsi14",
        "vix_rsi14",
        "spy_macdHist",
        "qqq_macdHist",
        "soxx_macdHist",
        "vix_macdHist",
        "vix_level",
    ]
    X = df[feature_cols].fillna(0.0)
    y = df["label"]

    stratify = y if y.value_counts().min() >= 2 else None
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=0.2, random_state=42, stratify=stratify)

    clf = RandomForestClassifier(
        n_estimators=300,
        max_depth=8,
        min_samples_leaf=3,
        class_weight={"Buy": 1.5, "Wait": 1, "Avoid": 2.0},
        random_state=42,
    )
    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)

    acc = accuracy_score(y_test, y_pred)
    f1 = f1_score(y_test, y_pred, average="macro")
    cm = confusion_matrix(y_test, y_pred, labels=["Buy", "Wait", "Avoid"]).tolist()
    report = classification_report(y_test, y_pred, output_dict=True, zero_division=0)

    payload = {
        "featureNames": feature_cols,
        "modelType": "RandomForestClassifier",
        "lookbackDays": LOOKBACK_DAYS,
        "buyThreshold": BUY_THRESHOLD,
        "avoidThreshold": AVOID_THRESHOLD,
        "sampleRows": int(len(df)),
        "trainRows": int(len(X_train)),
        "testRows": int(len(X_test)),
        "accuracy": round(float(acc), 6),
        "f1Macro": round(float(f1), 6),
        "confusionMatrix": cm,
        "classificationReport": report,
        "sourceDir": str(source_dir),
    }

    joblib.dump({"model": clf, "metadata": payload}, MODEL_PATH)

    print(json.dumps({"savedModel": str(MODEL_PATH), "metrics": payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
