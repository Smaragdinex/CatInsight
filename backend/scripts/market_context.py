from __future__ import annotations

import json
from pathlib import Path

MARKET_SYMBOLS = ["SPY", "QQQ", "SOXX", "VIX"]
COMMODITY_SYMBOLS = ["GLD", "CL", "BTC"]


def safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def load_market_context(history_dir: Path) -> dict[str, dict[str, dict]]:
    context: dict[str, dict[str, dict]] = {}
    if not history_dir.exists():
        return context

    file_map = {
        "SPY": "SPY.json",
        "QQQ": "QQQ.json",
        "SOXX": "SOXX.json",
        "VIX": "VIX.json",
        "GLD": "GLD.json",
        "CL": "CL.json",
        "BTC": "BTC.json",
    }

    for symbol, filename in file_map.items():
        path = history_dir / filename
        if not path.exists():
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(rows, list):
            continue
        by_date: dict[str, dict] = {}
        for item in rows:
            if not isinstance(item, dict):
                continue
            date = str(item.get("date") or "").strip()
            if not date:
                continue
            by_date[date] = {
                "return1d": safe_float(item.get("return1d")) or 0.0,
                "rsi14": safe_float(item.get("rsi14")) or 50.0,
                "macdHist": safe_float(item.get("macdHist")) or 0.0,
                "close": safe_float(item.get("close")) or 0.0,
            }
        context[symbol] = by_date
    return context


def get_market_features(context: dict[str, dict[str, dict]], date: str) -> dict:
    out = {}
    defaults = {
        "return1d": 0.0,
        "rsi14": 50.0,
        "macdHist": 0.0,
        "close": 0.0,
    }
    for symbol in MARKET_SYMBOLS:
        record = context.get(symbol, {}).get(date, defaults)
        prefix = symbol.lower()
        out[f"{prefix}_return1d"] = float(record.get("return1d", 0.0) or 0.0)
        out[f"{prefix}_rsi14"] = float(record.get("rsi14", 50.0) or 50.0)
        out[f"{prefix}_macdHist"] = float(record.get("macdHist", 0.0) or 0.0)
        if symbol == "VIX":
            out["vix_change1d"] = float(record.get("return1d", 0.0) or 0.0)
            out["vix_level"] = float(record.get("close", 0.0) or 0.0)
    return out
