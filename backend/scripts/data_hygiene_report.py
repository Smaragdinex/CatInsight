from __future__ import annotations

import json
from pathlib import Path

import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
REPORTS_DIR = BASE_DIR / "reports"

RANGE_RULES = {
    "rsi14": (0.0, 100.0),
    "mfi14": (0.0, 100.0),
    "volume": (0.0, None),
    "close": (0.0, None),
    "high": (0.0, None),
    "low": (0.0, None),
    "vix_level": (0.0, None),
}


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def load_rows() -> list[dict]:
    rows: list[dict] = []
    if not HISTORY_10Y_DIR.exists():
        return rows
    for path in sorted(HISTORY_10Y_DIR.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(items, list):
            continue
        symbol = path.stem.upper()
        for item in items:
            if not isinstance(item, dict):
                continue
            rows.append({
                "symbol": str(item.get("symbol") or symbol).upper(),
                "date": str(item.get("date") or ""),
                "close": _safe_float(item.get("close")),
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


def range_check(df: pd.DataFrame) -> dict:
    results = {}
    for col, (lo, hi) in RANGE_RULES.items():
        if col not in df.columns:
            continue
        series = df[col]
        invalid = pd.Series([False] * len(series))
        if lo is not None:
            invalid = invalid | (series < lo)
        if hi is not None:
            invalid = invalid | (series > hi)
        invalid = invalid & series.notna()
        results[col] = {
            "invalidCount": int(invalid.sum()),
            "min": _safe_float(series.min()),
            "max": _safe_float(series.max()),
        }
    return results


def main() -> int:
    rows = load_rows()
    if not rows:
        print(json.dumps({"error": "No rows found in history_10y"}, ensure_ascii=False, indent=2))
        return 1

    df = pd.DataFrame(rows)
    before_rows = len(df)
    missing_counts = df.isna().sum().to_dict()
    missing_ratio = ((df.isna().mean()) * 100.0).round(4).to_dict()
    describe_numeric = df.describe(include=["number"]).round(6).to_dict()
    range_results = range_check(df)

    # Standardized cleaning rules
    cleaned = df.copy()
    cleaned = cleaned.dropna(subset=["symbol", "date", "close", "high", "low", "volume"])
    cleaned = cleaned[cleaned["close"] > 0]
    cleaned = cleaned[cleaned["high"] > 0]
    cleaned = cleaned[cleaned["low"] > 0]
    cleaned = cleaned[cleaned["volume"] >= 0]
    if "rsi14" in cleaned.columns:
        cleaned = cleaned[cleaned["rsi14"].isna() | cleaned["rsi14"].between(0, 100)]
    if "mfi14" in cleaned.columns:
        cleaned = cleaned[cleaned["mfi14"].isna() | cleaned["mfi14"].between(0, 100)]

    after_rows = len(cleaned)
    removed_rows = before_rows - after_rows

    per_symbol = (
        cleaned.groupby("symbol")
        .agg(rows=("symbol", "size"), startDate=("date", "min"), endDate=("date", "max"))
        .reset_index()
        .sort_values("symbol")
    )

    summary = {
        "sourceDir": str(HISTORY_10Y_DIR),
        "rowsBeforeCleaning": int(before_rows),
        "rowsAfterCleaning": int(after_rows),
        "rowsRemoved": int(removed_rows),
        "missingCounts": {k: int(v) for k, v in missing_counts.items()},
        "missingRatioPercent": {k: float(v) for k, v in missing_ratio.items()},
        "rangeChecks": range_results,
        "describeNumeric": describe_numeric,
        "symbols": per_symbol.to_dict(orient="records"),
        "cleaningRules": [
            "dropna on symbol/date/close/high/low/volume",
            "close > 0",
            "high > 0",
            "low > 0",
            "volume >= 0",
            "rsi14 in [0,100] when present",
            "mfi14 in [0,100] when present",
        ],
    }

    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    json_path = REPORTS_DIR / "data_hygiene_summary.json"
    md_path = REPORTS_DIR / "data_hygiene_notes.md"
    json_path.write_text(json.dumps(summary, ensure_ascii=False, indent=2), encoding="utf-8")

    lines = [
        "# Data Hygiene Summary",
        "",
        f"- Source: `{HISTORY_10Y_DIR}`",
        f"- Rows before cleaning: **{before_rows}**",
        f"- Rows after cleaning: **{after_rows}**",
        f"- Rows removed: **{removed_rows}**",
        "",
        "## Range checks",
    ]
    for col, info in range_results.items():
        lines.append(f"- {col}: invalid={info['invalidCount']}, min={info['min']}, max={info['max']}")
    lines.append("")
    lines.append("## Missing ratio (%)")
    for col, val in missing_ratio.items():
        lines.append(f"- {col}: {val}%")
    lines.append("")
    lines.append("## Symbols")
    for row in per_symbol.to_dict(orient="records"):
        lines.append(f"- {row['symbol']}: rows={row['rows']}, {row['startDate']} → {row['endDate']}")
    md_path.write_text("\n".join(lines), encoding="utf-8")

    print(json.dumps({
        "jsonReport": str(json_path),
        "markdownReport": str(md_path),
        "rowsBeforeCleaning": before_rows,
        "rowsAfterCleaning": after_rows,
        "rowsRemoved": removed_rows,
    }, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
