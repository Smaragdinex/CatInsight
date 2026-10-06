from __future__ import annotations

import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

import yfinance as yf

from analysis_utils import DEFAULT_ACTUALS_PATH, DEFAULT_HISTORY_20D_PATH, DEFAULT_OUTPUT_DIR, append_dedup_by_key, ensure_path, load_json_list, save_json_list


BASE_DIR = Path(__file__).resolve().parent.parent
DB_PATH = BASE_DIR / "predictions.db"
HISTORY_PATH = DEFAULT_HISTORY_20D_PATH
ACTUALS_PATH = DEFAULT_ACTUALS_PATH
OUTPUT_DIR = DEFAULT_OUTPUT_DIR
WATCHLIST = ["SNDK", "MRVL", "NVDA", "STX", "TSM"]


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _fetch_close_price(symbol: str) -> float | None:
    ticker = yf.Ticker(symbol)
    hist = ticker.history(period="1d")
    if hist.empty:
        return None
    return round(float(hist["Close"].iloc[-1]), 2)


def update_actual_prices() -> dict:
    ensure_path(HISTORY_PATH, default_content="[]")
    ensure_path(ACTUALS_PATH, default_content="[]")
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    history_rows = load_json_list(HISTORY_PATH)
    actual_rows = load_json_list(ACTUALS_PATH)
    actual_by_symbol = {str(row.get("symbol") or "").upper(): row for row in actual_rows if isinstance(row, dict) and row.get("symbol")}

    placeholders = ",".join("?" * len(WATCHLIST))
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        pending = conn.execute(
            f"SELECT prediction_id, symbol, predictedMid FROM predictions WHERE actualPrice IS NULL AND symbol IN ({placeholders})",
            WATCHLIST,
        ).fetchall()

    if not pending and not history_rows:
        return {"updatedCount": 0, "message": "No predictions or history found."}

    updated_count = 0
    with sqlite3.connect(DB_PATH) as conn:
        for row in pending:
            symbol = str(row["symbol"] or "").upper()
            try:
                real_price = _fetch_close_price(symbol)
            except Exception as exc:
                print(f"⚠️ 無法抓取 {symbol}: {exc}")
                continue

            if real_price is None:
                print(f"⚠️ {symbol} 無法取得收盤價")
                continue

            predicted_mid = _safe_float(row["predictedMid"])
            residual = round(real_price - predicted_mid, 2) if predicted_mid is not None else None
            is_correct = int(abs(residual) < real_price * 0.02) if residual is not None else None

            conn.execute(
                "UPDATE predictions SET actualPrice=?, residual=?, isCorrect=? WHERE prediction_id=?",
                (real_price, residual, is_correct, row["prediction_id"]),
            )
            updated_count += 1

            actual_by_symbol[symbol] = {
                "symbol": symbol,
                "date": datetime.now(timezone.utc).date().isoformat(),
                "actualOpen": real_price,
                "actualHigh": real_price,
                "actualLow": real_price,
                "actualClose": real_price,
                "source": "yfinance",
            }
        conn.commit()

    actual_lookup = {k: v for k, v in actual_by_symbol.items()}
    updated_history = []
    for row in history_rows:
        if not isinstance(row, dict):
            continue
        symbol = str(row.get("symbol") or "").upper()
        if symbol in actual_lookup:
            row["actualClose"] = actual_lookup[symbol].get("actualClose")
            row["actualDate"] = actual_lookup[symbol].get("date")
        updated_history.append(row)

    append_dedup_by_key(HISTORY_PATH, updated_history, key="symbol")
    save_json_list(ACTUALS_PATH, list(actual_by_symbol.values()))

    return {
        "updatedCount": updated_count,
        "dbFile": str(DB_PATH),
        "historyFile": str(HISTORY_PATH),
        "actualsFile": str(ACTUALS_PATH),
    }


def main() -> int:
    result = update_actual_prices()
    print(json.dumps(result, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
