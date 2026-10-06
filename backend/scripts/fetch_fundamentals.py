"""Download annual fundamental data from yfinance and save to data/fundamentals/.

Uses a 180-day publication lag so data is only "available" 6 months after the
fiscal year ends — preventing look-ahead bias in training.
"""
from __future__ import annotations

import json
from datetime import timedelta
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
FUNDAMENTALS_DIR = BASE_DIR / "data" / "fundamentals"
SKIP_SYMBOLS = {"SPY", "QQQ", "SOXX", "VIX"}
PUBLICATION_LAG_DAYS = 180


def _yf_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def _safe_val(df: pd.DataFrame, row_names: list[str], col) -> float | None:
    for name in row_names:
        if name in df.index:
            v = df.loc[name, col]
            if pd.notna(v):
                return float(v)
    return None


def fetch_symbol(symbol: str) -> list[dict]:
    ticker = yf.Ticker(_yf_symbol(symbol))
    try:
        stmt = ticker.income_stmt  # annual; columns = fiscal year end dates
    except Exception as e:
        print(f"  ERROR fetching {symbol}: {e}")
        return []

    if stmt is None or stmt.empty:
        print(f"  No annual income data for {symbol}")
        return []

    cols = sorted(stmt.columns)  # oldest first
    records: list[dict] = []
    prev_eps: float | None = None
    prev_revenue: float | None = None

    for col in cols:
        fy_end = pd.Timestamp(col)
        available_from = (fy_end + timedelta(days=PUBLICATION_LAG_DAYS)).strftime("%Y-%m-%d")

        net_income = _safe_val(stmt, ["Net Income", "Net Income Common Stockholders"], col)
        revenue = _safe_val(stmt, ["Total Revenue", "Revenue"], col)
        gross_profit = _safe_val(stmt, ["Gross Profit"], col)
        diluted_shares = _safe_val(stmt, ["Diluted Average Shares", "Basic Average Shares", "Average Dilution Earnings"], col)

        # Try direct EPS rows first, fall back to net income / shares
        eps = _safe_val(stmt, ["Diluted EPS", "Basic EPS"], col)
        if eps is None and net_income is not None and diluted_shares and diluted_shares > 0:
            eps = net_income / diluted_shares

        profit_margin = (net_income / revenue) if (net_income is not None and revenue and revenue > 0) else None
        gross_margin = (gross_profit / revenue) if (gross_profit is not None and revenue and revenue > 0) else None
        eps_growth = ((eps / prev_eps) - 1.0) if (eps is not None and prev_eps is not None and prev_eps != 0) else None
        revenue_growth = ((revenue / prev_revenue) - 1.0) if (revenue is not None and prev_revenue is not None and prev_revenue != 0) else None

        records.append({
            "fy_end": fy_end.strftime("%Y-%m-%d"),
            "available_from": available_from,
            "eps": eps,
            "net_income": net_income,
            "revenue": revenue,
            "gross_profit": gross_profit,
            "profit_margin": profit_margin,
            "gross_margin": gross_margin,
            "eps_growth": eps_growth,
            "revenue_growth": revenue_growth,
        })

        if eps is not None:
            prev_eps = eps
        if revenue is not None:
            prev_revenue = revenue

    return records


def main() -> None:
    FUNDAMENTALS_DIR.mkdir(parents=True, exist_ok=True)

    symbols = [
        p.stem.upper()
        for p in sorted(HISTORY_10Y_DIR.glob("*.json"))
        if p.stem.upper() not in SKIP_SYMBOLS and not p.stem.startswith("_")
    ]
    print(f"Fetching fundamentals for {len(symbols)} symbols: {symbols}")

    for sym in symbols:
        print(f"  {sym}...", end=" ", flush=True)
        records = fetch_symbol(sym)
        out = FUNDAMENTALS_DIR / f"{sym}.json"
        if not records:   # 抓失敗(限流、下市)不要用空資料蓋掉舊檔
            print("no data → kept existing file")
            continue
        # yfinance 只給最近 4~5 年 → 和舊檔合併,同一年度以新抓的為準
        old = json.loads(out.read_text(encoding="utf-8")) if out.exists() else []
        merged = {r["fy_end"]: r for r in old}
        merged.update({r["fy_end"]: r for r in records})
        records = [merged[k] for k in sorted(merged)]
        out.write_text(json.dumps(records, indent=2, ensure_ascii=False), encoding="utf-8")
        print(f"saved {len(records)} records → {out.name}")

    print("Done.")


if __name__ == "__main__":
    main()
