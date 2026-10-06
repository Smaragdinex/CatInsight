from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

import pandas as pd

from analysis_utils import (
    DEFAULT_HISTORY_20D_PATH,
    DEFAULT_OUTPUT_DIR,
    DEFAULT_PREDICTIONS_PATH,
    DEFAULT_WATCHLIST_SYMBOLS,
    build_group_report,
    ensure_path,
    load_json_list,
    load_predictions,
)


PREDICTIONS_PATH = DEFAULT_PREDICTIONS_PATH
HISTORY_PATH = DEFAULT_HISTORY_20D_PATH
OUTPUT_DIR = DEFAULT_OUTPUT_DIR
WATCHLIST_SYMBOLS = DEFAULT_WATCHLIST_SYMBOLS


def _normalize_history_rows(rows: list[dict[str, Any]]) -> pd.DataFrame:
    normalized = []
    for item in rows:
        if not isinstance(item, dict):
            continue
        symbol = str(item.get("symbol") or "").upper().strip()
        date = item.get("date") or item.get("window_end") or item.get("windowEnd")
        close = item.get("close") or item.get("target_next_price") or item.get("target_next_return")
        if not symbol:
            continue
        normalized.append({
            "symbol": symbol,
            "predicted_at": date,
            "actual": item.get("target_next_price"),
            "predicted": item.get("target_next_price"),
            "currentPrice": item.get("close"),
            "predictedMid": item.get("target_next_price"),
            "predictedLow": None,
            "predictedHigh": None,
            "source": "history_20d",
        })
    return pd.DataFrame(normalized)


def _load_analysis_frame(source: str) -> pd.DataFrame:
    source = source.lower()
    if source == "predictions":
        ensure_path(PREDICTIONS_PATH, default_content="[]")
        return load_predictions(PREDICTIONS_PATH)
    if source == "history":
        ensure_path(HISTORY_PATH, default_content="[]")
        return _normalize_history_rows(load_json_list(HISTORY_PATH))
    if source == "auto":
        ensure_path(HISTORY_PATH, default_content="[]")
        history_rows = load_json_list(HISTORY_PATH)
        if history_rows:
            df = _normalize_history_rows(history_rows)
            if not df.empty:
                return df
        ensure_path(PREDICTIONS_PATH, default_content="[]")
        return load_predictions(PREDICTIONS_PATH)
    raise ValueError(f"Unsupported source: {source}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Analyze prediction logs or 20-day history and generate charts.")
    parser.add_argument("--symbol", help="Optional symbol filter, e.g. SNDK or MRVL")
    parser.add_argument("--all-symbols", nargs="*", default=WATCHLIST_SYMBOLS, help="Generate per-symbol charts for these symbols after the overall charts")
    parser.add_argument("--source", choices=["auto", "predictions", "history"], default="auto", help="Choose data source to analyze")
    args = parser.parse_args()

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    df = _load_analysis_frame(args.source)
    if df.empty:
        print("No valid analysis data found.")
        return 1

    outputs = []
    if args.symbol:
        outputs.append(build_group_report(df, OUTPUT_DIR, args.symbol))
    else:
        outputs.append(build_group_report(df, OUTPUT_DIR, None))
        for sym in args.all_symbols:
            outputs.append(build_group_report(df, OUTPUT_DIR, sym))

    print(json.dumps({"source": args.source, "generated": outputs}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
