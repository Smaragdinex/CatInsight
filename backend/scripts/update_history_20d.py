from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import yfinance as yf

from analysis_utils import DEFAULT_HISTORY_20D_PATH, DEFAULT_WATCHLIST_SYMBOLS, append_dedup_by_key, ensure_path, load_json_list


BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_PATH = DEFAULT_HISTORY_20D_PATH
WATCHLIST_PATH = BASE_DIR / "watchlist.json"


def _load_symbols() -> list[str]:
    if WATCHLIST_PATH.exists():
        try:
            data = json.loads(WATCHLIST_PATH.read_text(encoding="utf-8"))
            if isinstance(data, list):
                syms = []
                for item in data:
                    if isinstance(item, dict) and item.get("symbol"):
                        syms.append(str(item["symbol"]).upper())
                    elif isinstance(item, str):
                        syms.append(item.upper())
                if syms:
                    return sorted(set(syms))
        except Exception:
            pass
    return DEFAULT_WATCHLIST_SYMBOLS


def _build_rows(symbol: str) -> list[dict]:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="6mo", interval="1d", auto_adjust=False)
    if hist is None or hist.empty:
        return []

    hist = hist.dropna(subset=["Close"])
    if len(hist) < 21:
        return []

    close = hist["Close"].astype(float).reset_index(drop=True)
    volume = hist["Volume"].astype(float).reset_index(drop=True) if "Volume" in hist.columns else None
    out: list[dict] = []

    for idx in range(20, len(close)):
        window = close.iloc[idx - 20 : idx]
        if len(window) < 20:
            continue
        returns = window.pct_change().dropna()
        if len(returns) < 3:
            continue
        vol_window = volume.iloc[idx - 20 : idx] if volume is not None else None
        ts = hist.index[idx - 1]
        out.append({
            "symbol": symbol.upper(),
            "date": pd.Timestamp(ts).date().isoformat(),
            "close": round(float(close.iloc[idx - 1]), 4),
            "high": round(float(hist["High"].iloc[idx - 1]), 4),
            "low": round(float(hist["Low"].iloc[idx - 1]), 4),
            "volume": round(float(hist["Volume"].iloc[idx - 1]), 4) if "Volume" in hist.columns else None,
            "ma5": round(float(window.tail(5).mean()), 4),
            "return1d": round(float(close.iloc[idx - 1] / close.iloc[idx - 2] - 1.0), 6),
            "volatility5d": round(float(returns.tail(5).std(ddof=0) or 0.0), 6),
            "windowStart": pd.Timestamp(hist.index[idx - 20]).date().isoformat(),
            "windowEnd": pd.Timestamp(ts).date().isoformat(),
        })
    return out[-20:]


def main() -> int:
    ensure_path(HISTORY_PATH, default_content="[]")
    symbols = _load_symbols()
    all_rows: list[dict] = []
    for symbol in symbols:
        try:
            all_rows.extend(_build_rows(symbol))
        except Exception as exc:
            print(f"FAIL {symbol}: {exc}")

    append_dedup_by_key(HISTORY_PATH, all_rows, key="symbol")
    print(json.dumps({"saved": str(HISTORY_PATH), "rowsAdded": len(all_rows), "symbols": symbols}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
