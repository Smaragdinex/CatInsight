from __future__ import annotations

"""Fetch earnings dates / surprise data into data/earnings/.

This helper stores the latest point-in-time earnings snapshots we can obtain from
yfinance so the training and inference pipelines can use them as features.
"""

import json
import argparse
import sys
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from earnings_features import DEFAULT_FETCH_LIMIT, EARNINGS_DIR, fetch_earnings_events, load_earnings_cache, save_earnings_cache

HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch earnings snapshots into data/earnings/")
    parser.add_argument(
        "--provider",
        default=None,
        help="Earnings provider: auto, fmp, quantquote, or yfinance. Defaults to env EARNINGS_PROVIDER.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=DEFAULT_FETCH_LIMIT,
        help="Max events to keep per symbol.",
    )
    args = parser.parse_args()

    EARNINGS_DIR.mkdir(parents=True, exist_ok=True)
    symbols = [
        p.stem.upper()
        for p in sorted(HISTORY_10Y_DIR.glob("*.json"))
        if not p.stem.startswith("_")
    ]
    print(f"Fetching earnings snapshots for {len(symbols)} symbols...")

    summary: dict[str, int] = {}
    for sym in symbols:
        try:
            events = fetch_earnings_events(sym, limit=args.limit, provider=args.provider)
            cache_path = EARNINGS_DIR / f"{sym}.json"
            existing_events = []
            if cache_path.exists():
                try:
                    payload = json.loads(cache_path.read_text(encoding="utf-8"))
                    if isinstance(payload, list):
                        existing_events = [item for item in payload if isinstance(item, dict)]
                    elif isinstance(payload, dict):
                        items = payload.get("items") or payload.get("events") or []
                        if isinstance(items, list):
                            existing_events = [item for item in items if isinstance(item, dict)]
                except Exception:
                    existing_events = []

            if events:
                save_earnings_cache(sym, events, EARNINGS_DIR)
                summary[sym] = len(events)
                print(f"  {sym}: {len(events)} events")
            elif existing_events:
                summary[sym] = len(existing_events)
                print(f"  {sym}: kept {len(existing_events)} cached events")
            else:
                save_earnings_cache(sym, [], EARNINGS_DIR)
                summary[sym] = 0
                print(f"  {sym}: 0 events")
        except Exception as exc:
            existing = load_earnings_cache(EARNINGS_DIR).get(sym, [])
            summary[sym] = len(existing)
            print(f"  {sym}: ERROR {exc}")

    summary_path = EARNINGS_DIR / "_summary.json"
    summary_path.write_text(json.dumps(summary, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"Saved summary -> {summary_path}")


if __name__ == "__main__":
    main()
