"""Append today's (and recent missing) price rows to all history_10y JSON files."""
from __future__ import annotations

import json
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_DIR = BASE_DIR / "data" / "history_10y"
SKIP = {"SPY", "QQQ", "SOXX", "VIX"}


def _yf_symbol(sym: str) -> str:
    return sym.replace(".", "-")


def _compute_rsi(close: pd.Series, period: int = 14) -> pd.Series:
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(period).mean()
    loss  = (-delta.clip(upper=0)).rolling(period).mean()
    rs    = gain / loss.replace(0, float("nan"))
    return 100 - 100 / (1 + rs)


def _compute_mfi(high, low, close, volume, period=14) -> pd.Series:
    tp  = (high + low + close) / 3
    mf  = tp * volume
    pos = mf.where(tp > tp.shift(1), 0.0)
    neg = mf.where(tp < tp.shift(1), 0.0)
    mfr = pos.rolling(period).sum() / neg.rolling(period).sum().replace(0, float("nan"))
    return 100 - 100 / (1 + mfr)


def update_symbol(sym: str) -> str:
    path = HISTORY_DIR / f"{sym}.json"
    if not path.exists():
        return f"{sym}: 無快取檔案"

    existing = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(existing, list) or not existing:
        return f"{sym}: 空檔案"

    dates = [r["date"] for r in existing if r.get("date")]
    if not dates:
        return f"{sym}: 無日期資料"
    latest_date = max(dates)

    try:
        hist = yf.Ticker(_yf_symbol(sym)).history(period="10d", interval="1d", auto_adjust=False)
    except Exception as e:
        return f"{sym}: fetch error {e}"

    if hist is None or hist.empty:
        return f"{sym}: 無新資料"

    hist.index = pd.to_datetime(hist.index).tz_localize(None)
    rsi  = _compute_rsi(hist["Close"])
    mfi  = _compute_mfi(hist["High"], hist["Low"], hist["Close"], hist["Volume"])
    obv  = (hist["Volume"] * hist["Close"].diff().apply(lambda x: 1 if x > 0 else -1 if x < 0 else 0)).cumsum()

    macd_fast   = hist["Close"].ewm(span=12).mean()
    macd_slow   = hist["Close"].ewm(span=26).mean()
    macd_line   = macd_fast - macd_slow
    macd_signal = macd_line.ewm(span=9).mean()
    macd_hist   = macd_line - macd_signal

    new_rows = []
    for dt, row in hist.iterrows():
        date_str = dt.strftime("%Y-%m-%d")
        if date_str <= latest_date:
            continue
        new_rows.append({
            "symbol":     sym,
            "date":       date_str,
            "open":       round(float(row["Open"]), 4),
            "high":       round(float(row["High"]), 4),
            "low":        round(float(row["Low"]), 4),
            "close":      round(float(row["Close"]), 4),
            "volume":     int(row["Volume"]),
            "rsi14":      round(float(rsi[dt]), 4) if pd.notna(rsi[dt]) else None,
            "mfi14":      round(float(mfi[dt]), 4) if pd.notna(mfi[dt]) else None,
            "obv":        round(float(obv[dt]), 2) if pd.notna(obv[dt]) else None,
            "macd":       round(float(macd_line[dt]), 6) if pd.notna(macd_line[dt]) else None,
            "macdSignal": round(float(macd_signal[dt]), 6) if pd.notna(macd_signal[dt]) else None,
            "macdHist":   round(float(macd_hist[dt]), 6) if pd.notna(macd_hist[dt]) else None,
        })

    if not new_rows:
        return f"{sym}: 已是最新 ({latest_date})"

    existing.extend(new_rows)
    existing.sort(key=lambda x: x.get("date", ""))
    path.write_text(json.dumps(existing, ensure_ascii=False), encoding="utf-8")
    return f"{sym}: +{len(new_rows)} 筆 → 最新 {new_rows[-1]['date']}"


def main():
    symbols = sorted(
        p.stem.upper() for p in HISTORY_DIR.glob("*.json")
        if p.stem.upper() not in SKIP
    )
    print(f"更新 {len(symbols)} 支股票...", flush=True)
    updated = skipped = errors = 0
    for i, sym in enumerate(symbols):
        result = update_symbol(sym)
        if "+" in result:
            updated += 1
            print(f"  [{i+1}/{len(symbols)}] {result}", flush=True)
        elif "error" in result.lower():
            errors += 1
        else:
            skipped += 1
        if i % 30 == 29:
            time.sleep(1)  # 避免 yfinance rate limit

    print(f"\n完成 — 更新:{updated}  已最新:{skipped}  錯誤:{errors}")


if __name__ == "__main__":
    main()
