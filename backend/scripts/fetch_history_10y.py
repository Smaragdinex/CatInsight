from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
OUT_DIR = BASE_DIR / "data" / "history_10y"
LEGACY_DIR = BASE_DIR / "data" / "history_1y"
SP500_LIST_PATH = BASE_DIR / "data" / "sp500_constituents_2026-05-23.json"

BASE_SYMBOLS = [
    "AAPL",
    "AMAT",
    "AMZN",
    "AAOI",
    "AVGO",
    "ASML",
    "ADBE",
    "CSCO",
    "COHR",
    "ANET",
    "FN",
    "GOOGL",
    "HPE",
    "KLAC",
    "META",
    "LITE",
    "MRVL",
    "MU",
    "MSFT",
    "NOW",
    "NFLX",
    "NVDA",
    "ORCL",
    "SMCI",
    "SIMO",
    "SPOT",
    "SNDK",
    "STX",
    "VRT",
    "TSM",
    "WDC",
    "ARM",
    "QRVO",
]

# 太空/航太題材股(2026新增)。SPCX=SpaceX(2026-06-12 IPO,上市初期資料<35天會被略過,
# 待累積足夠交易日後自動納入排名)
SPACE_SYMBOLS = ["RKLB", "ASTS", "LUNR", "SPCX"]

EXTRA_SYMBOLS = ["SPY", "QQQ", "SOXX", "^VIX", "TSLA"]


def _load_sp500_symbols() -> list[str]:
    if not SP500_LIST_PATH.exists():
        return []
    try:
        data = json.loads(SP500_LIST_PATH.read_text(encoding="utf-8"))
    except Exception:
        return []
    if not isinstance(data, list):
        return []
    out: list[str] = []
    seen: set[str] = set()
    for item in data:
        sym = str(item).strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _dedupe_symbols(symbols: list[str]) -> list[str]:
    out: list[str] = []
    seen: set[str] = set()
    for symbol in symbols:
        sym = str(symbol).strip().upper()
        if not sym or sym in seen:
            continue
        seen.add(sym)
        out.append(sym)
    return out


def _yf_symbol(symbol: str) -> str:
    if symbol == "^VIX":
        return symbol
    return symbol.replace(".", "-")


SP500_SYMBOLS = _load_sp500_symbols()
SYMBOLS = _dedupe_symbols(BASE_SYMBOLS + SPACE_SYMBOLS + SP500_SYMBOLS + EXTRA_SYMBOLS)


def _symbol_filename(symbol: str) -> str:
    safe = symbol.replace("^", "")
    return f"{safe}.json"


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()
    rs = avg_gain / avg_loss.replace(0, pd.NA)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(100.0)


def _compute_mfi(high: pd.Series, low: pd.Series, close: pd.Series, volume: pd.Series, period: int = 14) -> pd.Series:
    typical = (high + low + close) / 3.0
    money_flow = typical * volume.fillna(0.0)
    direction = typical.diff()
    positive_flow = money_flow.where(direction > 0, 0.0)
    negative_flow = money_flow.where(direction < 0, 0.0).abs()
    pos_sum = positive_flow.rolling(window=period).sum()
    neg_sum = negative_flow.rolling(window=period).sum()
    mfr = pos_sum / neg_sum.replace(0, pd.NA)
    mfi = 100 - (100 / (1 + mfr))
    return mfi.fillna(100.0)


def _compute_obv(close: pd.Series, volume: pd.Series) -> pd.Series:
    direction = close.diff().fillna(0.0)
    signed_volume = volume.fillna(0.0).where(direction >= 0, -volume.fillna(0.0))
    signed_volume = signed_volume.where(direction != 0, 0.0)
    return signed_volume.cumsum()


def _compute_macd(close: pd.Series) -> tuple[pd.Series, pd.Series, pd.Series]:
    ema12 = close.ewm(span=12, adjust=False).mean()
    ema26 = close.ewm(span=26, adjust=False).mean()
    macd = ema12 - ema26
    signal = macd.ewm(span=9, adjust=False).mean()
    hist = macd - signal
    return macd, signal, hist


def _build_rows(symbol: str) -> list[dict]:
    hist = yf.Ticker(_yf_symbol(symbol)).history(period="10y", interval="1d", auto_adjust=False)
    if hist is None or hist.empty:
        return []

    hist = hist.dropna(subset=["Close"]).copy()
    if len(hist) < 35:
        return []

    close = hist["Close"].astype(float)
    high = hist["High"].astype(float)
    low = hist["Low"].astype(float)
    volume = hist["Volume"].astype(float) if "Volume" in hist.columns else pd.Series([0.0] * len(hist), index=hist.index)
    returns_1d = close.pct_change()
    ma5 = close.rolling(5).mean()
    vol5 = returns_1d.rolling(5).std(ddof=0)
    rsi14 = _compute_rsi(close, 14)
    mfi14 = _compute_mfi(high, low, close, volume, 14)
    obv = _compute_obv(close, volume)
    macd, macd_signal, macd_hist = _compute_macd(close)

    rows: list[dict] = []
    for ts, row in hist.iterrows():
        idx = hist.index.get_loc(ts)
        if idx < 25:
            continue
        rows.append({
            "symbol": symbol.upper(),
            "date": pd.Timestamp(ts).date().isoformat(),
            "close": round(float(row["Close"]), 4),
            "high": round(float(row["High"]), 4),
            "low": round(float(row["Low"]), 4),
            "volume": round(float(row["Volume"]), 4) if "Volume" in hist.columns else None,
            "ma5": round(float(ma5.loc[ts]), 4) if pd.notna(ma5.loc[ts]) else None,
            "return1d": round(float(returns_1d.loc[ts]), 6) if pd.notna(returns_1d.loc[ts]) else None,
            "volatility5d": round(float(vol5.loc[ts]), 6) if pd.notna(vol5.loc[ts]) else None,
            "rsi14": round(float(rsi14.loc[ts]), 4) if pd.notna(rsi14.loc[ts]) else None,
            "mfi14": round(float(mfi14.loc[ts]), 4) if pd.notna(mfi14.loc[ts]) else None,
            "obv": round(float(obv.loc[ts]), 4) if pd.notna(obv.loc[ts]) else None,
            "macd": round(float(macd.loc[ts]), 6) if pd.notna(macd.loc[ts]) else None,
            "macdSignal": round(float(macd_signal.loc[ts]), 6) if pd.notna(macd_signal.loc[ts]) else None,
            "macdHist": round(float(macd_hist.loc[ts]), 6) if pd.notna(macd_hist.loc[ts]) else None,
        })
    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    summary: list[dict] = []

    for symbol in SYMBOLS:
        try:
            rows = _build_rows(symbol)
            out_path = OUT_DIR / _symbol_filename(symbol)
            out_path.write_text(json.dumps(rows, ensure_ascii=False, indent=2), encoding="utf-8")
            summary.append({"symbol": symbol, "rows": len(rows), "path": str(out_path)})
            print(f"OK {symbol}: {len(rows)} rows -> {out_path}")
        except Exception as exc:
            summary.append({"symbol": symbol, "error": str(exc)})
            print(f"FAIL {symbol}: {exc}")

    (OUT_DIR / "_summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    if LEGACY_DIR.exists():
        print(f"Legacy dir kept unchanged: {LEGACY_DIR}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
