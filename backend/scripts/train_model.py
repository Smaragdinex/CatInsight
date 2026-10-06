from __future__ import annotations

import json
from pathlib import Path

import joblib
import pandas as pd
import yfinance as yf
from sklearn.linear_model import LinearRegression
from sklearn.metrics import mean_squared_error, r2_score
from sklearn.model_selection import train_test_split

from analysis_utils import DEFAULT_HISTORY_20D_PATH, DEFAULT_PREDICTIONS_PATH, ensure_path, load_json_list
from market_context import get_market_features, load_market_context


BASE_DIR = Path(__file__).resolve().parent.parent
PREDICTIONS_PATH = DEFAULT_PREDICTIONS_PATH
HISTORY_PATH = DEFAULT_HISTORY_20D_PATH
MODELS_DIR = BASE_DIR / "models"
MODEL_PATH = MODELS_DIR / "price_model.joblib"
LOOKBACK_DAYS = 20
MAX_SYMBOLS = 50
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
HISTORY_1Y_DIR = BASE_DIR / "data" / "history_1y"


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _daily_features(close: pd.Series, volume: pd.Series | None, idx: int) -> dict | None:
    if idx < LOOKBACK_DAYS or idx >= len(close):
        return None

    window = close.iloc[idx - LOOKBACK_DAYS : idx].astype(float)
    if len(window) < LOOKBACK_DAYS or window.isna().any():
        return None

    returns = window.pct_change().dropna()
    if len(returns) < 3:
        return None

    current_close = float(close.iloc[idx - 1])
    next_close = float(close.iloc[idx])
    if current_close <= 0 or next_close <= 0:
        return None

    vol_window = None
    if volume is not None and not volume.empty:
        vol_window = volume.iloc[idx - LOOKBACK_DAYS : idx].astype(float)
        if vol_window.isna().any():
            vol_window = None

    lag_1_return = float(returns.iloc[-1])
    lag_2_return = float(returns.iloc[-2]) if len(returns) >= 2 else lag_1_return
    lag_3_return = float(returns.iloc[-3]) if len(returns) >= 3 else lag_2_return
    mean_return_5 = float(returns.tail(5).mean())
    mean_return_20 = float(returns.mean())
    volatility_20 = float(returns.std(ddof=0) or 0.0)
    momentum_20 = float((window.iloc[-1] / window.iloc[0]) - 1.0)
    avg_volume_20 = float(vol_window.mean()) if vol_window is not None and not vol_window.empty else None
    volume_last = float(vol_window.iloc[-1]) if vol_window is not None and not vol_window.empty else None
    volume_ratio = (volume_last / avg_volume_20) if avg_volume_20 not in (None, 0) and volume_last is not None else 1.0

    return {
        "lag_1_return": lag_1_return,
        "lag_2_return": lag_2_return,
        "lag_3_return": lag_3_return,
        "mean_return_5": mean_return_5,
        "mean_return_20": mean_return_20,
        "volatility_20": volatility_20,
        "momentum_20": momentum_20,
        "avg_volume_20": avg_volume_20 if avg_volume_20 is not None else current_close,
        "volume_ratio": volume_ratio,
        "target_next_return": (next_close / current_close) - 1.0,
        "target_next_price": next_close,
    }


def _build_rows_for_symbol(symbol: str) -> list[dict]:
    try:
        hist = yf.Ticker(symbol).history(period="1y", interval="1d", auto_adjust=False)
    except Exception:
        return []

    if hist is None or hist.empty:
        return []

    hist = hist.dropna(subset=["Close"])
    if len(hist) < LOOKBACK_DAYS + 2:
        return []

    close = hist["Close"].astype(float).reset_index(drop=True)
    volume = hist["Volume"].astype(float).reset_index(drop=True) if "Volume" in hist.columns else None

    rows: list[dict] = []
    for idx in range(LOOKBACK_DAYS, len(close) - 1):
        features = _daily_features(close, volume, idx)
        if not features:
            continue
        features["symbol"] = symbol.upper()
        features["window_end_index"] = idx - 1
        rows.append(features)
    return rows




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
                "ma5": _safe_float(item.get("ma5")),
                "return1d": _safe_float(item.get("return1d")),
                "volatility5d": _safe_float(item.get("volatility5d")),
                "rsi14": _safe_float(item.get("rsi14")),
                "mfi14": _safe_float(item.get("mfi14")),
                "obv": _safe_float(item.get("obv")),
                "macd": _safe_float(item.get("macd")),
                "macdSignal": _safe_float(item.get("macdSignal")),
                "macdHist": _safe_float(item.get("macdHist")),
            })
    return rows

def _load_history_rows() -> list[dict]:
    history = load_json_list(HISTORY_PATH)
    rows: list[dict] = []
    for item in history:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").upper().strip()
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
            "ma5": _safe_float(item.get("ma5")),
            "return1d": _safe_float(item.get("return1d")),
            "volatility5d": _safe_float(item.get("volatility5d")),
            "rsi14": _safe_float(item.get("rsi14")),
            "mfi14": _safe_float(item.get("mfi14")),
            "obv": _safe_float(item.get("obv")),
            "macd": _safe_float(item.get("macd")),
            "macdSignal": _safe_float(item.get("macdSignal")),
            "macdHist": _safe_float(item.get("macdHist")),
        })
    return rows


def _build_rows_from_history(rows: list[dict], market_context: dict[str, dict[str, dict]] | None = None) -> list[dict]:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["symbol"], []).append(row)

    samples: list[dict] = []
    for symbol, items in grouped.items():
        ordered = sorted(items, key=lambda x: x["date"])
        if len(ordered) < LOOKBACK_DAYS + 2:
            continue
        closes = [float(x["close"]) for x in ordered]
        volumes = [float(x["volume"]) if x.get("volume") is not None else None for x in ordered]
        rsis = [x.get("rsi14") for x in ordered]
        mfis = [x.get("mfi14") for x in ordered]
        obvs = [x.get("obv") for x in ordered]
        macds = [x.get("macd") for x in ordered]
        macd_signals = [x.get("macdSignal") for x in ordered]
        macd_hists = [x.get("macdHist") for x in ordered]
        for idx in range(LOOKBACK_DAYS, len(ordered) - 1):
            window_closes = pd.Series(closes[idx - LOOKBACK_DAYS:idx])
            if window_closes.isna().any():
                continue
            returns = window_closes.pct_change().dropna()
            if len(returns) < 3:
                continue
            vol_window = [v for v in volumes[idx - LOOKBACK_DAYS:idx] if v is not None]
            current_close = closes[idx - 1]
            next_close = closes[idx]
            if current_close <= 0 or next_close <= 0:
                continue
            rsi_now = _safe_float(rsis[idx - 1])
            mfi_now = _safe_float(mfis[idx - 1])
            obv_now = _safe_float(obvs[idx - 1])
            obv_prev_5 = _safe_float(obvs[idx - 6]) if idx - 6 >= 0 else None
            macd_now = _safe_float(macds[idx - 1])
            macd_signal_now = _safe_float(macd_signals[idx - 1])
            macd_hist_now = _safe_float(macd_hists[idx - 1])
            market_features = get_market_features(market_context or {}, ordered[idx - 1]["date"])
            rsi_prev_3 = _safe_float(rsis[idx - 4]) if idx - 4 >= 0 else None
            mfi_prev_3 = _safe_float(mfis[idx - 4]) if idx - 4 >= 0 else None
            macd_hist_prev_3 = _safe_float(macd_hists[idx - 4]) if idx - 4 >= 0 else None
            market_features = get_market_features(market_context or {}, ordered[idx - 1]["date"])
            spy_close = market_context.get("SPY", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            soxx_close = market_context.get("SOXX", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            sample = {
                "symbol": symbol,
                "lag_1_return": float(returns.iloc[-1]),
                "lag_2_return": float(returns.iloc[-2]) if len(returns) >= 2 else float(returns.iloc[-1]),
                "lag_3_return": float(returns.iloc[-3]) if len(returns) >= 3 else float(returns.iloc[-1]),
                "mean_return_5": float(returns.tail(5).mean()),
                "mean_return_20": float(returns.mean()),
                "volatility_20": float(returns.std(ddof=0) or 0.0),
                "momentum_20": float((window_closes.iloc[-1] / window_closes.iloc[0]) - 1.0),
                "avg_volume_20": float(pd.Series(vol_window).mean()) if vol_window else current_close,
                "volume_ratio": ((float(vol_window[-1]) / float(pd.Series(vol_window).mean())) if vol_window and float(pd.Series(vol_window).mean()) not in (0.0, -0.0) else 1.0),
                "rsi14": rsi_now if rsi_now is not None else 50.0,
                "mfi14": mfi_now if mfi_now is not None else 50.0,
                "rsi14_norm": ((rsi_now - 50.0) / 50.0) if rsi_now is not None else 0.0,
                "mfi14_norm": ((mfi_now - 50.0) / 50.0) if mfi_now is not None else 0.0,
                "rsi_change_3d": (rsi_now - rsi_prev_3) if rsi_now is not None and rsi_prev_3 is not None else 0.0,
                "mfi_change_3d": (mfi_now - mfi_prev_3) if mfi_now is not None and mfi_prev_3 is not None else 0.0,
                "obv_change_5": ((obv_now - obv_prev_5) / abs(obv_prev_5)) if obv_now is not None and obv_prev_5 not in (None, 0.0, -0.0) else 0.0,
                "macd": macd_now if macd_now is not None else 0.0,
                "macdSignal": macd_signal_now if macd_signal_now is not None else 0.0,
                "macdHist": macd_hist_now if macd_hist_now is not None else 0.0,
                "macdHist_change_3d": (macd_hist_now - macd_hist_prev_3) if macd_hist_now is not None and macd_hist_prev_3 is not None else 0.0,
                "relative_strength_spy": (current_close / spy_close) if spy_close not in (None, 0.0, -0.0) else 1.0,
                "relative_strength_soxx": (current_close / soxx_close) if soxx_close not in (None, 0.0, -0.0) else 1.0,
                "target_next_return": (next_close / current_close) - 1.0,
                "target_next_price": next_close,
                "window_start": ordered[idx - LOOKBACK_DAYS]["date"],
                "window_end": ordered[idx - 1]["date"],
                **market_features,
            }
            prev_date_3 = ordered[idx - 4]["date"] if idx - 4 >= 0 else None
            spy_close_prev_3 = market_context.get("SPY", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            soxx_close_prev_3 = market_context.get("SOXX", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            rs_spy_prev_3 = (closes[idx - 4] / spy_close_prev_3) if idx - 4 >= 0 and spy_close_prev_3 not in (None, 0.0, -0.0) else None
            rs_soxx_prev_3 = (closes[idx - 4] / soxx_close_prev_3) if idx - 4 >= 0 and soxx_close_prev_3 not in (None, 0.0, -0.0) else None
            sample["relative_strength_spy_change_3d"] = (sample["relative_strength_spy"] - rs_spy_prev_3) if rs_spy_prev_3 is not None else 0.0
            sample["relative_strength_soxx_change_3d"] = (sample["relative_strength_soxx"] - rs_soxx_prev_3) if rs_soxx_prev_3 is not None else 0.0
            samples.append(sample)
    return samples


def load_training_frame() -> pd.DataFrame:
    market_context = load_market_context(HISTORY_10Y_DIR)
    history_10y_rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    if history_10y_rows:
        rows = _build_rows_from_history(history_10y_rows, market_context=market_context)
        if rows:
            return pd.DataFrame(rows)

    history_1y_rows = _load_history_rows_from_dir(HISTORY_1Y_DIR)
    if history_1y_rows:
        rows = _build_rows_from_history(history_1y_rows, market_context=market_context)
        if rows:
            return pd.DataFrame(rows)

    history_rows = _load_history_rows()
    if history_rows:
        rows = _build_rows_from_history(history_rows, market_context=market_context)
        if rows:
            return pd.DataFrame(rows)

    symbols = []
    seen = set()
    for item in load_json_list(PREDICTIONS_PATH):
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").upper().strip()
        if symbol and symbol not in seen:
            symbols.append(symbol)
            seen.add(symbol)
        if len(symbols) >= MAX_SYMBOLS:
            break

    if not symbols:
        symbols = ["SNDK", "MRVL", "NVDA", "STX", "TSM"]

    rows: list[dict] = []
    for symbol in symbols:
        rows.extend(_build_rows_for_symbol(symbol))

    return pd.DataFrame(rows)


def main() -> int:
    ensure_path(PREDICTIONS_PATH, default_content="[]")
    MODELS_DIR.mkdir(parents=True, exist_ok=True)

    df = load_training_frame()
    if df.empty:
        print(json.dumps({"error": "No usable sequence rows found for training"}, ensure_ascii=False, indent=2))
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
        "rsi14",
        "mfi14",
        "rsi14_norm",
        "mfi14_norm",
        "rsi_change_3d",
        "mfi_change_3d",
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
    y = df["target_next_return"]

    test_size = 0.2 if len(df) >= 10 else 0.3
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=test_size, random_state=42)

    model = LinearRegression()
    model.fit(X_train, y_train)

    y_pred = model.predict(X_test)
    mse = mean_squared_error(y_test, y_pred)
    rmse = mse ** 0.5
    r2 = r2_score(y_test, y_pred) if len(y_test) >= 2 else None

    payload = {
        "featureNames": feature_cols,
        "coefficients": model.coef_.tolist(),
        "intercept": float(model.intercept_),
        "target": "next_day_return",
        "lookbackDays": LOOKBACK_DAYS,
        "sampleRows": int(len(df)),
        "trainRows": int(len(X_train)),
        "testRows": int(len(X_test)),
        "rmse": round(float(rmse), 6),
        "r2": round(float(r2), 6) if r2 is not None else None,
        "sourceFile": str(HISTORY_10Y_DIR if HISTORY_10Y_DIR.exists() else (HISTORY_1Y_DIR if HISTORY_1Y_DIR.exists() else (HISTORY_PATH if not df.empty and HISTORY_PATH.exists() else PREDICTIONS_PATH))),
    }

    joblib.dump({"model": model, "metadata": payload}, MODEL_PATH)

    print(json.dumps({"savedModel": str(MODEL_PATH), "metrics": payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
