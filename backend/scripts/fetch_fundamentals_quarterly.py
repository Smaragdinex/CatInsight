"""Download quarterly revenue / net income from yfinance into data/fundamentals_quarterly/ (TTM 特徵用,見 ttm_features.py).

每個季度記一筆 {quarter_end, available_from, revenue, net_income}。
available_from = 該季財報公布日的隔天(從 data/earnings/ 找季末後 100 天內的第一個 earningsDate),
找不到就保守用季末 + 45 天(10-Q 申報期限),避免訓練時偷看未來。
yfinance 只給最近 4~5 季,所以和既有檔案合併:舊季度保留,同一季以新抓的為準;抓失敗就不動舊檔。

Run:
  python scripts/fetch_fundamentals_quarterly.py
  python scripts/fetch_fundamentals_quarterly.py NVDA MU   # 指定代號
"""
from __future__ import annotations

import json
import sys
import time
from datetime import date, timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"
QUARTERLY_DIR = BASE_DIR / "data" / "fundamentals_quarterly"
SKIP_SYMBOLS = {"SPY", "QQQ", "SOXX", "VIX"}
FALLBACK_LAG_DAYS = 45


def _earnings_dates(symbol: str) -> list[date]:
    path = EARNINGS_DIR / f"{symbol}.json"
    if not path.exists():
        return []
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return []
    items = payload if isinstance(payload, list) else (payload.get("items") or payload.get("events") or [])
    out = []
    for it in items:
        try:
            out.append(date.fromisoformat(str(it.get("earningsDate"))[:10]))
        except (TypeError, ValueError, AttributeError):
            continue
    return sorted(out)


def _available_from(quarter_end: date, report_dates: list[date]) -> str:
    for d in report_dates:
        if quarter_end < d <= quarter_end + timedelta(days=100):
            return (d + timedelta(days=1)).isoformat()
    return (quarter_end + timedelta(days=FALLBACK_LAG_DAYS)).isoformat()


def _row(df: pd.DataFrame, names: list[str], col) -> float | None:
    for name in names:
        if name in df.index:
            v = df.loc[name, col]
            if pd.notna(v):
                return float(v)
    return None


def fetch_symbol(symbol: str) -> list[dict]:
    stmt = yf.Ticker(symbol.replace(".", "-")).quarterly_income_stmt
    if stmt is None or stmt.empty:
        return []
    report_dates = _earnings_dates(symbol)
    rows = []
    for col in stmt.columns:
        q_end = pd.Timestamp(col).date()
        revenue = _row(stmt, ["Total Revenue", "Operating Revenue"], col)
        net_income = _row(stmt, ["Net Income", "Net Income Common Stockholders"], col)
        if revenue is None and net_income is None:
            continue
        rows.append({
            "quarter_end": q_end.isoformat(),
            "available_from": _available_from(q_end, report_dates),
            "revenue": revenue,
            "net_income": net_income,
        })
    return rows


def main(symbols: list[str]) -> None:
    QUARTERLY_DIR.mkdir(parents=True, exist_ok=True)
    added = failed = 0
    for i, sym in enumerate(symbols):
        path = QUARTERLY_DIR / f"{sym}.json"
        try:
            new_rows = fetch_symbol(sym)
        except Exception as e:
            print(f"  {sym}: ERROR {e} → 保留舊檔")
            failed += 1
            continue
        if not new_rows:
            print(f"  {sym}: 沒抓到資料 → 保留舊檔")
            failed += 1
            continue
        old_rows = json.loads(path.read_text(encoding="utf-8")) if path.exists() else []
        merged = {r["quarter_end"]: r for r in old_rows}
        before = len(merged)
        for r in new_rows:
            old = merged.get(r["quarter_end"])
            if old:   # 已公布過的季度沿用原本的 available_from,只更新數字
                r = {**r, "available_from": old["available_from"]}
            merged[r["quarter_end"]] = r
        rows = [merged[k] for k in sorted(merged)]
        path.write_text(json.dumps(rows, indent=2, ensure_ascii=False), encoding="utf-8")
        added += len(merged) - before
        print(f"  {sym}: {len(rows)} 季(新增 {len(merged) - before})")
        if i < len(symbols) - 1:
            time.sleep(0.3)
    print(f"Done. 新增 {added} 季,失敗 {failed} 支")


if __name__ == "__main__":
    if len(sys.argv) > 1:
        syms = [s.upper() for s in sys.argv[1:]]
    else:
        syms = [p.stem.upper() for p in sorted(HISTORY_10Y_DIR.glob("*.json"))
                if p.stem.upper() not in SKIP_SYMBOLS and not p.stem.startswith("_")]
    main(syms)
