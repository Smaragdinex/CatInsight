"""Fetch analyst price targets and upgrades/downgrades from yfinance.

Saves to data/analyst_ratings/<SYMBOL>.json as a list of:
  { GradeDate, Firm, ToGrade, FromGrade, cur, pri, pta }

Run:
  python scripts/fetch_analyst_ratings.py
  python scripts/fetch_analyst_ratings.py NVDA MU AMD   # specific symbols
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path

import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
ANALYST_DIR = BASE_DIR / "data" / "analyst_ratings"
SKIP_SYMBOLS = {"SPY", "QQQ", "SOXX", "VIX"}


def _yf_symbol(symbol: str) -> str:
    return symbol.replace(".", "-")


def _pta_label(cur: float | None, pri: float | None) -> str:
    if cur is None or pri is None:
        return "Maintains"
    if cur > pri:
        return "Raises"
    if cur < pri:
        return "Lowers"
    return "Maintains"


def fetch_symbol(symbol: str) -> list[dict]:
    ticker = yf.Ticker(_yf_symbol(symbol))
    try:
        ud = ticker.upgrades_downgrades
    except Exception as e:
        print(f"  ERROR {symbol}: {e}")
        return []

    if ud is None or getattr(ud, "empty", True):
        return []

    try:
        ud = ud.reset_index()
    except Exception:
        return []

    rows: list[dict] = []
    for _, row in ud.iterrows():
        grade_date = row.get("GradeDate")
        if grade_date is None:
            continue
        try:
            grade_date_str = pd.Timestamp(grade_date).strftime("%Y-%m-%d")
        except Exception:
            continue

        cur = row.get("currentPriceTarget") if "currentPriceTarget" in row else None
        pri = row.get("priorPriceTarget") if "priorPriceTarget" in row else None
        if cur is not None and pd.isna(cur):
            cur = None
        if pri is not None and pd.isna(pri):
            pri = None
        cur = float(cur) if cur is not None else None
        pri = float(pri) if pri is not None else None

        rows.append({
            "GradeDate": grade_date_str,
            "Firm": str(row.get("Firm") or ""),
            "ToGrade": str(row.get("ToGrade") or ""),
            "FromGrade": str(row.get("FromGrade") or ""),
            "cur": cur,
            "pri": pri,
            "pta": _pta_label(cur, pri),
        })

    rows.sort(key=lambda x: x["GradeDate"], reverse=True)
    return rows


def fetch_consensus(symbol: str) -> dict | None:
    ticker = yf.Ticker(_yf_symbol(symbol))
    try:
        apt = ticker.analyst_price_targets
    except Exception:
        return None
    if not apt:
        return None
    return {
        "current": apt.get("current"),
        "mean": apt.get("mean"),
        "median": apt.get("median"),
        "high": apt.get("high"),
        "low": apt.get("low"),
    }


def main(symbols: list[str]) -> None:
    ANALYST_DIR.mkdir(parents=True, exist_ok=True)

    for i, symbol in enumerate(symbols):
        if symbol in SKIP_SYMBOLS:
            continue
        print(f"[{i+1}/{len(symbols)}] {symbol} ...", end=" ", flush=True)
        rows = fetch_symbol(symbol)
        consensus = fetch_consensus(symbol)

        out = {
            "symbol": symbol,
            "consensus": consensus,
            "ratings": rows,
        }

        path = ANALYST_DIR / f"{symbol}.json"
        path.write_text(json.dumps(out, indent=2, ensure_ascii=False), encoding="utf-8")

        upside = ""
        if consensus and consensus.get("current") and consensus.get("mean"):
            pct = (consensus["mean"] - consensus["current"]) / consensus["current"] * 100
            upside = f"  mean=${consensus['mean']:.0f} upside={pct:+.1f}%"
        print(f"OK ({len(rows)} ratings){upside}")

        if i < len(symbols) - 1:
            time.sleep(0.3)


if __name__ == "__main__":
    if len(sys.argv) > 1:
        syms = [s.upper() for s in sys.argv[1:]]
    else:
        syms = sorted(
            p.stem.upper()
            for p in HISTORY_10Y_DIR.glob("*.json")
            if p.stem.upper() not in SKIP_SYMBOLS
        )
    print(f"Fetching analyst ratings for {len(syms)} symbols...")
    main(syms)
