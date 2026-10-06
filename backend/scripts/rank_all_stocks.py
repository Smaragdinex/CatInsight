"""Rank all 516 stocks using Growth Pipeline + XGBoost entry timing.

Step 1: Growth score  — analyst upside + PEAD (rules-based)
Step 2: XGBoost score — technical entry timing (model-based)
Step 3: Combined rank — top 20 buy candidates + bottom 10 avoid

Uses cached history_10y data (no live fetch) for speed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "scripts"))

from train_classifier_xgb import (
    _build_samples, _load_fundamentals,
    load_analyst_cache, build_analyst_features,
    ANALYST_DIR, FUNDAMENTALS_DIR, HISTORY_10Y_DIR,
    MODELS_DIR, LOOKBACK_DAYS,
)
from market_context import load_market_context, get_market_features
from earnings_features import load_earnings_cache, build_earnings_features, EARNINGS_DIR

SKIP = {"SPY", "QQQ", "SOXX", "VIX"}

# 市值分層（用基本面資料估算，沒有即時價格）
MEGA_CAP_B  = 3_000
LARGE_CAP_B = 1_000
MID_CAP_B   = 300

PEAD_MIN_EPS  = 0.03
PEAD_MAX_DAYS = 60
ANALYST_WINDOW = 30


def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def load_latest_rows(history_dir: Path, symbols: list[str]) -> dict[str, list[dict]]:
    """Load last 60 days of rows per symbol from cached JSON."""
    data = {}
    for sym in symbols:
        path = history_dir / f"{sym}.json"
        if not path.exists():
            continue
        try:
            rows = json.loads(path.read_text())
            if isinstance(rows, list) and rows:
                rows = sorted(rows, key=lambda x: x.get("date", ""))
                data[sym] = rows  # keep all for lookback
        except Exception:
            pass
    return data


def get_market_cap_estimate(fundamentals: dict, symbol: str, price: float) -> float:
    """Rough market cap estimate from fundamentals (shares * price)."""
    recs = fundamentals.get(symbol.upper(), [])
    if not recs:
        return 0.0
    latest = recs[-1]
    shares = _safe_float(latest.get("shares_outstanding") or latest.get("sharesOutstanding"))
    if shares and price > 0:
        return (shares * price) / 1e9
    return 0.0


def build_xgb_features_latest(
    symbol: str,
    rows: list[dict],
    market_context: dict,
    fundamentals: dict,
    earnings_cache: dict,
    analyst_cache: dict,
    feature_cols: list[str],
    clip_bounds: dict,
    log_features: list[str],
) -> pd.DataFrame | None:
    """Build XGBoost feature row for the latest date of this symbol."""
    if len(rows) < LOOKBACK_DAYS + 2:
        return None

    # Build full sample set then take last row
    try:
        df = _build_samples(
            rows,
            market_context=market_context,
            fundamentals=fundamentals,
            analyst_cache=analyst_cache,
        )
    except Exception:
        return None

    if df.empty:
        return None

    missing = [c for c in feature_cols if c not in df.columns]
    if missing:
        return None

    latest = df.tail(1)[feature_cols].fillna(0.0).copy()

    # Apply same clip + log transforms
    for col, bounds in clip_bounds.items():
        if col in latest.columns and bounds.get("lo") is not None:
            latest[col] = latest[col].clip(lower=bounds["lo"], upper=bounds["hi"])
    for col in log_features:
        if col in latest.columns:
            latest[col] = np.log1p(latest[col].clip(lower=0))

    return latest


def growth_score(
    symbol: str,
    latest_row: dict,
    analyst_cache: dict,
    earnings_cache: dict,
) -> dict:
    """Simplified growth score without live market cap."""
    price = _safe_float(latest_row.get("close")) or 0.0
    date  = latest_row.get("date", "")
    if price <= 0 or not date:
        return {"analyst_upside": 0.0, "raises_ratio": 0.0, "pead_beat": 0,
                "pead_eps": 0.0, "pead_days": None, "has_pead": False, "g_score": 0.0}

    # Analyst
    from datetime import date as ddate, timedelta
    ratings = analyst_cache.get(symbol.upper(), [])
    today   = ddate.today().isoformat()
    cutoff  = (ddate.today() - timedelta(days=ANALYST_WINDOW)).isoformat()
    recent  = [r for r in ratings
               if r.get("GradeDate", "") <= today
               and r.get("GradeDate", "") >= cutoff
               and r.get("cur") is not None]
    if len(recent) < 3:
        cutoff90 = (ddate.today() - timedelta(days=90)).isoformat()
        recent = [r for r in ratings
                  if r.get("GradeDate", "") <= today
                  and r.get("GradeDate", "") >= cutoff90
                  and r.get("cur") is not None]

    upside, raises_ratio = 0.0, 0.0
    if recent:
        targets      = [float(r["cur"]) for r in recent]
        mean_target  = sum(targets) / len(targets)
        upside       = (mean_target - price) / price
        raises_ratio = sum(1 for r in recent if r.get("pta") == "Raises") / len(recent)

    # PEAD
    events = earnings_cache.get(symbol.upper(), [])
    applicable = [e for e in events if e.get("available_from", "9999") <= today]
    pead_beat, pead_eps, pead_days = 0, 0.0, None
    if applicable:
        latest_e   = applicable[-1]
        pead_beat  = 1 if latest_e.get("earningsBeat") else 0
        pead_eps   = float(latest_e.get("surprisePercent") or 0) / 100
        e_date     = latest_e.get("earningsDate", "")
        if e_date:
            try:
                pead_days = (ddate.today() - ddate.fromisoformat(e_date)).days
            except Exception:
                pass

    has_pead = (pead_beat and pead_eps >= PEAD_MIN_EPS
                and pead_days is not None and pead_days <= PEAD_MAX_DAYS)

    # Growth score (0-100)
    g = 0.0
    g += min(upside / 0.50, 1.0) * 40      # 40pt: upside，50%滿分
    g += raises_ratio * 30                   # 30pt: 上調比例
    if has_pead:
        g += min(pead_eps / 0.10, 1.0) * 20 # 20pt: PEAD EPS 驚喜
        g += 10                              # 10pt: PEAD 加成

    return {
        "analyst_upside": round(upside, 4),
        "raises_ratio":   round(raises_ratio, 4),
        "pead_beat":      pead_beat,
        "pead_eps":       round(pead_eps * 100, 2),
        "pead_days":      pead_days,
        "has_pead":       has_pead,
        "g_score":        round(g, 1),
    }


def main():
    print("Loading models & caches...", flush=True)
    blob = joblib.load(MODELS_DIR / "action_classifier_xgb.joblib")
    model       = blob["model"]
    meta        = blob.get("metadata", {})
    feature_cols = meta.get("featureNames", [])
    clip_bounds  = meta.get("clipBounds", {})
    log_features = meta.get("logFeatures", [])

    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    market_context = load_market_context(HISTORY_10Y_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)
    earnings_cache = load_earnings_cache(EARNINGS_DIR)

    symbols = sorted(
        p.stem.upper() for p in HISTORY_10Y_DIR.glob("*.json")
        if p.stem.upper() not in SKIP
    )
    print(f"Symbols: {len(symbols)}", flush=True)

    print("Building features...", flush=True)
    rows_by_sym = load_latest_rows(HISTORY_10Y_DIR, symbols)

    results = []
    for i, sym in enumerate(symbols):
        if (i + 1) % 50 == 0:
            print(f"  {i+1}/{len(symbols)}...", flush=True)

        rows = rows_by_sym.get(sym)
        if not rows:
            continue

        latest_row = rows[-1]
        price = _safe_float(latest_row.get("close")) or 0.0

        # Growth score
        gs = growth_score(sym, latest_row, analyst_cache, earnings_cache)

        # XGBoost buy probability
        xgb_prob = 0.0
        feat_df = build_xgb_features_latest(
            sym, rows, market_context, fundamentals,
            earnings_cache, analyst_cache,
            feature_cols, clip_bounds, log_features,
        )
        if feat_df is not None and not feat_df.empty:
            try:
                xgb_prob = float(model.predict_proba(feat_df)[0][1])
            except Exception:
                pass

        # XGBoost = entry signal only (BUY / WAIT), threshold 0.35
        xgb_signal = "BUY" if xgb_prob >= 0.35 else "WAIT"

        results.append({
            "symbol":         sym,
            "price":          round(price, 2),
            "date":           latest_row.get("date", ""),
            "g_score":        gs["g_score"],
            "xgb_prob":       round(xgb_prob * 100, 1),
            "xgb_signal":     xgb_signal,
            "analyst_upside": gs["analyst_upside"],
            "raises_ratio":   gs["raises_ratio"],
            "has_pead":       gs["has_pead"],
            "pead_eps":       gs["pead_eps"],
            "pead_days":      gs["pead_days"],
        })

    if not results:
        print("No results.")
        return

    df = pd.DataFrame(results).sort_values("g_score", ascending=False).reset_index(drop=True)

    # ── TOP 20 ──
    print(f"\n{'='*90}")
    print(f"🏆 TOP 20 — Growth 排名（XGBoost 判斷今天進場時機）")
    print(f"{'='*90}")
    print(f"{'#':<3} {'SYM':<7} {'PRICE':>8} {'G-SCORE':>8} {'UPSIDE':>8} {'RAISES':>7} {'XGB':>6}  PEAD")
    print(f"{'-'*90}")
    for i, row in df.head(20).iterrows():
        pead = f"EPS+{row['pead_eps']:.0f}% ({row['pead_days']:.0f}d)" if row["has_pead"] else "—"
        signal = "✅ BUY " if row["xgb_signal"] == "BUY" else "⏳ WAIT"
        print(f"{i+1:<3} {row['symbol']:<7} {row['price']:>8.2f} "
              f"{row['g_score']:>8.1f} {row['analyst_upside']:>+7.1%} "
              f"{row['raises_ratio']:>7.0%}  {signal}  {pead}")

    # 統計 BUY 信號
    top20 = df.head(20)
    buy_count = (top20["xgb_signal"] == "BUY").sum()
    print(f"\n  → Top 20 中 XGBoost 建議立即進場：{buy_count} 支，等待：{20-buy_count} 支")

    # ── BOTTOM 10 ──
    bottom = df[df["g_score"] > -999].tail(10).iloc[::-1]
    print(f"\n{'='*90}")
    print(f"🔴 BOTTOM 10 — 避開（分析師看跌 / 無成長動能）")
    print(f"{'='*90}")
    print(f"{'#':<3} {'SYM':<7} {'PRICE':>8} {'G-SCORE':>8} {'UPSIDE':>8} {'RAISES':>7}  原因")
    print(f"{'-'*90}")
    total = len(df)
    for i, (_, row) in enumerate(bottom.iterrows()):
        reason = "超過目標價" if row["analyst_upside"] < -0.05 else "無分析師資料" if row["raises_ratio"] == 0 else "upside不足"
        print(f"{total-i:<3} {row['symbol']:<7} {row['price']:>8.2f} "
              f"{row['g_score']:>8.1f} {row['analyst_upside']:>+7.1%} "
              f"{row['raises_ratio']:>7.0%}  {reason}")

    print(f"\n共 {len(df)} 支股票評分完成")


if __name__ == "__main__":
    main()
