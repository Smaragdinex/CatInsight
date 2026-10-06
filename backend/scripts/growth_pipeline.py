"""Growth Momentum Pipeline

Layer 1 — Universe filter  : market cap + analyst upside
Layer 2 — Entry scoring    : PEAD + technical defense
Layer 3 — Hold/Exit signal : upside remaining + distribution detection

Usage:
  python scripts/growth_pipeline.py
  python scripts/growth_pipeline.py --symbols MU NVDA AMD ALAB
"""
from __future__ import annotations

import argparse
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BASE_DIR))
sys.path.insert(0, str(BASE_DIR / "scripts"))

from train_classifier_xgb import load_analyst_cache, ANALYST_DIR
from earnings_features import load_earnings_cache, EARNINGS_DIR

HISTORY_DIR = BASE_DIR / "data" / "history_10y"

# ── 市值分層 ─────────────────────────────────────────────────────────────────
# 任何低於 NVIDIA/Apple ($3T+) 的都還有機會
# 但市值越大，PEAD 要求越嚴格
MEGA_CAP_B    = 3_000   # > $3T = 跳過（NVIDIA / Apple 級別）
LARGE_CAP_B   = 1_000   # $1T-$3T = 需要 PEAD 觸發
MID_CAP_B     = 300     # $300B-$1T = 分析師 upside 就夠
# < $300B = 小中型股，最容易翻倍

# 各層 upside 最低要求
UPSIDE_LARGE  = 0.25    # 大型股：upside > 25%
UPSIDE_MID    = 0.20    # 中型股：upside > 20%
UPSIDE_SMALL  = 0.15    # 小型股：upside > 15%

# PEAD 觸發（大型股必須有）
PEAD_MIN_EPS_SURPRISE = 0.03   # EPS 驚喜 > 3%
PEAD_MAX_DAYS         = 60     # 財報後 60 天內有效

# 分析師條件
MIN_RAISES_RATIO   = 0.55     # 至少 55% 分析師在上調
ANALYST_WINDOW     = 30       # 取最近30天

# 技術防禦
MFI_DISTRIBUTION   = 35
RSI_OVERBOUGHT     = 78
OBV_DROP_THRESHOLD = -0.10

# 進場時機門檻
RSI_OVERBOUGHT_ENTRY  = 70    # RSI > 70 = 偏高，等回調
RSI_IDEAL_ENTRY       = 60    # RSI < 60 = 理想進場區
MA20_EXTENDED         = 0.10  # 偏離 MA20 > 10% = 漲太快
MA20_IDEAL            = 0.05  # 偏離 MA20 < 5% = 理想區
MFI_HOT               = 75    # MFI > 75 = 資金過熱
MOMENTUM_5D_HOT       = 0.12  # 5日漲幅 > 12% = 追高危險

# 持倉/出場
HOLD_UPSIDE_MIN    = 0.05
EXIT_RAISES_DROP   = 0.40


def _safe_float(v):
    try:
        return float(v) if v is not None else None
    except Exception:
        return None


def fetch_live_data(symbol: str) -> dict:
    """Fetch current price, market cap, and technicals from yfinance."""
    try:
        t = yf.Ticker(symbol)
        info = t.info or {}
        hist = t.history(period="3mo")
    except Exception:
        return {}

    if hist is None or hist.empty:
        return {}

    close = hist["Close"]
    volume = hist["Volume"]
    high = hist["High"]
    low = hist["Low"]

    current_price = float(close.iloc[-1])
    market_cap_b  = _safe_float(info.get("marketCap") or 0) / 1e9

    # RSI 14
    delta = close.diff()
    gain  = delta.clip(lower=0).rolling(14).mean()
    loss  = (-delta.clip(upper=0)).rolling(14).mean()
    rs    = gain / loss.replace(0, np.nan)
    rsi   = float((100 - 100 / (1 + rs)).iloc[-1])

    # MFI 14
    tp    = (high + low + close) / 3
    mf    = tp * volume
    pos   = mf.where(tp > tp.shift(1), 0)
    neg   = mf.where(tp < tp.shift(1), 0)
    mfr   = pos.rolling(14).sum() / neg.rolling(14).sum().replace(0, np.nan)
    mfi   = float((100 - 100 / (1 + mfr)).iloc[-1])

    # OBV 5日變化
    obv   = (volume * np.sign(close.diff())).cumsum()
    obv_chg_5 = float((obv.iloc[-1] - obv.iloc[-6]) / abs(obv.iloc[-6])) if len(obv) >= 6 and obv.iloc[-6] != 0 else 0.0

    # 均線
    ma20 = float(close.rolling(20).mean().iloc[-1])
    ma50 = float(close.rolling(50).mean().iloc[-1]) if len(close) >= 50 else ma20
    ma20_dev = (current_price - ma20) / ma20

    # ATR 14（衡量正常波動幅度）
    prev_close = close.shift(1)
    tr = pd.concat([
        high - low,
        (high - prev_close).abs(),
        (low - prev_close).abs(),
    ], axis=1).max(axis=1)
    atr = float(tr.rolling(14).mean().iloc[-1])
    atr_pct = atr / current_price

    # 5日動能
    momentum_5d = float((close.iloc[-1] / close.iloc[-6]) - 1.0) if len(close) >= 6 else 0.0

    # 近20日最高最低（支撐壓力）
    high_20 = float(high.tail(20).max())
    low_20  = float(low.tail(20).min())

    return {
        "price":        current_price,
        "market_cap_b": market_cap_b,
        "rsi":          rsi,
        "mfi":          mfi,
        "obv_chg_5":    obv_chg_5,
        "ma20":         ma20,
        "ma50":         ma50,
        "ma20_dev":     ma20_dev,
        "atr":          atr,
        "atr_pct":      atr_pct,
        "momentum_5d":  momentum_5d,
        "high_20":      high_20,
        "low_20":       low_20,
    }


def get_entry_timing(live: dict) -> dict:
    """判斷現在是否適合進場，還是要等回調。

    Returns:
        status: BUY_NOW / WAIT_PULLBACK / EXTENDED
        entry_zone: (low, high) 建議進場價格區間
        pullback_pct: 預估需要回調的幅度
        reason: 說明
    """
    price      = live["price"]
    rsi        = live["rsi"]
    mfi        = live["mfi"]
    ma20       = live["ma20"]
    ma50       = live["ma50"]
    ma20_dev   = live["ma20_dev"]
    atr        = live["atr"]
    atr_pct    = live["atr_pct"]
    mom5       = live["momentum_5d"]

    reasons = []
    heat_score = 0  # 越高越過熱

    # RSI 評估
    if rsi > RSI_OVERBOUGHT_ENTRY:
        heat_score += 2
        reasons.append(f"RSI {rsi:.0f} 偏高（>70）")
    elif rsi < RSI_IDEAL_ENTRY:
        heat_score -= 1  # 加分
        reasons.append(f"RSI {rsi:.0f} 理想區間")

    # MA20 偏離評估
    if ma20_dev > MA20_EXTENDED:
        heat_score += 2
        reasons.append(f"距 MA20 偏離 {ma20_dev*100:.1f}%（>10%）")
    elif ma20_dev > MA20_IDEAL:
        heat_score += 1
        reasons.append(f"距 MA20 偏離 {ma20_dev*100:.1f}%")
    else:
        heat_score -= 1
        reasons.append(f"靠近 MA20 {ma20_dev*100:.1f}%（理想）")

    # MFI 評估
    if mfi > MFI_HOT:
        heat_score += 2
        reasons.append(f"MFI {mfi:.0f} 資金過熱（>75）")

    # 5日動能評估
    if mom5 > MOMENTUM_5D_HOT:
        heat_score += 2
        reasons.append(f"5日漲幅 {mom5*100:.1f}%（>12%，追高風險）")
    elif mom5 < -0.05:
        heat_score -= 1
        reasons.append(f"5日回調 {mom5*100:.1f}%（回調中）")

    # 計算建議進場區間
    # 理想進場：回踩 MA20 ± 1 ATR
    entry_low  = round(ma20 - atr * 0.5, 2)
    entry_high = round(ma20 + atr * 0.5, 2)

    # 如果現在已經在理想區，用當前價 ± 0.5 ATR
    if heat_score <= 0:
        entry_low  = round(price - atr * 0.5, 2)
        entry_high = round(price + atr * 0.3, 2)

    pullback_pct = (price - entry_high) / price if price > entry_high else 0.0

    # 判斷結論
    if heat_score >= 4:
        status = "EXTENDED"
        conclusion = f"嚴重過熱，等回調 {pullback_pct*100:.1f}%"
    elif heat_score >= 2:
        status = "WAIT_PULLBACK"
        conclusion = f"偏高，建議等回調到 ${entry_low:.0f}-${entry_high:.0f}"
    else:
        status = "BUY_NOW"
        conclusion = f"進場區間合理，目標 ${entry_low:.0f}-${entry_high:.0f}"

    return {
        "status":       status,
        "conclusion":   conclusion,
        "entry_low":    entry_low,
        "entry_high":   entry_high,
        "pullback_pct": round(pullback_pct, 4),
        "heat_score":   heat_score,
        "reasons":      reasons,
        "ma20":         round(ma20, 2),
        "ma50":         round(ma50, 2),
        "atr_pct":      round(atr_pct * 100, 2),
    }


def get_analyst_signal(symbol: str, price: float, analyst_cache: dict) -> dict:
    """Compute analyst signal from 30-day window."""
    ratings = analyst_cache.get(symbol.upper(), [])
    if not ratings or price <= 0:
        return {"upside": 0.0, "raises_ratio": 0.0, "coverage": 0, "target_mean": 0.0, "target_high": 0.0}

    today = date.today().isoformat()
    cutoff = (date.today() - timedelta(days=ANALYST_WINDOW)).isoformat()

    recent = [r for r in ratings
              if r.get("GradeDate", "") <= today
              and r.get("GradeDate", "") >= cutoff
              and r.get("cur") is not None]

    # 擴展到90天如果不夠
    if len(recent) < 3:
        cutoff90 = (date.today() - timedelta(days=90)).isoformat()
        recent = [r for r in ratings
                  if r.get("GradeDate", "") <= today
                  and r.get("GradeDate", "") >= cutoff90
                  and r.get("cur") is not None]

    if not recent:
        return {"upside": 0.0, "raises_ratio": 0.0, "coverage": 0, "target_mean": 0.0, "target_high": 0.0}

    targets       = [float(r["cur"]) for r in recent]
    raises        = sum(1 for r in recent if r.get("pta") == "Raises")
    target_mean   = sum(targets) / len(targets)
    target_high   = max(targets)
    upside        = (target_mean - price) / price
    raises_ratio  = raises / len(recent)

    return {
        "upside":       round(upside, 4),
        "raises_ratio": round(raises_ratio, 4),
        "coverage":     len(recent),
        "target_mean":  round(target_mean, 2),
        "target_high":  round(target_high, 2),
    }


def get_pead_signal(symbol: str, earnings_cache: dict) -> dict:
    """Get most recent PEAD signal."""
    events = earnings_cache.get(symbol.upper(), [])
    today  = date.today().isoformat()
    applicable = [e for e in events if e.get("available_from", "9999") <= today]
    if not applicable:
        return {"eps_surprise": 0.0, "earnings_beat": 0, "guidance_up": 0,
                "revenue_surprise": 0.0, "days_since_earnings": None}

    latest = applicable[-1]
    earnings_date = latest.get("earningsDate", "")
    days_since = None
    if earnings_date:
        try:
            days_since = (date.today() - date.fromisoformat(earnings_date)).days
        except Exception:
            pass

    return {
        "eps_surprise":     float(latest.get("surprisePercent") or 0) / 100,
        "earnings_beat":    1 if latest.get("earningsBeat") else 0,
        "guidance_up":      1 if latest.get("guidanceUp") is True else 0,
        "revenue_surprise": float(latest.get("revenueSurprisePct") or 0) / 100,
        "days_since_earnings": days_since,
    }


def score_entry(live: dict, analyst: dict, pead: dict) -> dict:
    """Score entry signal 0-100 and return breakdown."""
    scores = {}

    # ── Analyst score (40분) ──────────────────────────────────────────────
    upside_score   = min(analyst["upside"] / 0.50, 1.0) * 20   # 最高20分，50%upside滿分
    raises_score   = analyst["raises_ratio"] * 15               # 最高15分
    coverage_score = min(analyst["coverage"] / 10, 1.0) * 5    # 最高5分
    scores["analyst"] = round(upside_score + raises_score + coverage_score, 1)

    # ── PEAD score (30分) ────────────────────────────────────────────────
    eps_score      = min(pead["eps_surprise"] / 0.10, 1.0) * 15  # 10% surprise = 滿分
    beat_score     = pead["earnings_beat"] * 8
    guidance_score = pead["guidance_up"] * 7
    scores["pead"]  = round(eps_score + beat_score + guidance_score, 1)

    # ── Technical defense (30分，扣分制) ────────────────────────────────
    tech_score = 30.0
    mfi_warn   = live.get("mfi", 50) < MFI_DISTRIBUTION
    rsi_warn   = live.get("rsi", 50) > RSI_OVERBOUGHT
    obv_warn   = live.get("obv_chg_5", 0) < OBV_DROP_THRESHOLD
    if mfi_warn:
        tech_score -= 15
    if rsi_warn:
        tech_score -= 10
    if obv_warn:
        tech_score -= 10
    scores["technical"] = max(round(tech_score, 1), 0)

    total = scores["analyst"] + scores["pead"] + scores["technical"]

    # ── 警告旗 ───────────────────────────────────────────────────────────
    warnings = []
    if mfi_warn:
        warnings.append(f"MFI={live.get('mfi', 0):.0f} 資金流出")
    if rsi_warn:
        warnings.append(f"RSI={live.get('rsi', 0):.0f} 超買")
    if obv_warn:
        warnings.append(f"OBV 5日 {live.get('obv_chg_5', 0)*100:.1f}% 量能異常")

    return {
        "total":     round(total, 1),
        "analyst":   scores["analyst"],
        "pead":      scores["pead"],
        "technical": scores["technical"],
        "warnings":  warnings,
    }


def get_hold_exit(live: dict, analyst: dict) -> str:
    """Return HOLD / WATCH / EXIT recommendation."""
    upside = analyst["upside"]
    raises = analyst["raises_ratio"]
    mfi    = live.get("mfi", 50)
    obv    = live.get("obv_chg_5", 0)

    if upside < HOLD_UPSIDE_MIN:
        return "EXIT — 已接近目標價"
    if raises < EXIT_RAISES_DROP and upside < 0.10:
        return "EXIT — 分析師開始撤退"
    if mfi < MFI_DISTRIBUTION and obv < OBV_DROP_THRESHOLD:
        return "EXIT — 主力出貨信號"
    if raises < EXIT_RAISES_DROP:
        return "WATCH — 分析師信心下降"
    if mfi < 40:
        return "WATCH — 資金流出觀察"
    return "HOLD"


def analyse_symbol(symbol: str, analyst_cache: dict, earnings_cache: dict) -> dict | None:
    print(f"  {symbol}...", end=" ", flush=True)
    live = fetch_live_data(symbol)
    if not live:
        print("no data")
        return None

    analyst = get_analyst_signal(symbol, live["price"], analyst_cache)
    pead    = get_pead_signal(symbol, earnings_cache)
    score   = score_entry(live, analyst, pead)
    action  = get_hold_exit(live, analyst)
    timing  = get_entry_timing(live)

    print(f"score={score['total']:.0f}  upside={analyst['upside']:+.1%}  {action}  [{timing['status']}]")

    return {
        "symbol":       symbol,
        "price":        live["price"],
        "market_cap_b": round(live["market_cap_b"], 1),
        "score":        score["total"],
        "score_analyst":   score["analyst"],
        "score_pead":      score["pead"],
        "score_technical": score["technical"],
        "analyst_upside":  analyst["upside"],
        "analyst_target_mean": analyst["target_mean"],
        "analyst_target_high": analyst["target_high"],
        "analyst_raises_ratio": analyst["raises_ratio"],
        "analyst_coverage": analyst["coverage"],
        "pead_eps_surprise": pead["eps_surprise"],
        "pead_earnings_beat": pead["earnings_beat"],
        "pead_guidance_up": pead["guidance_up"],
        "pead_days_since": pead["days_since_earnings"],
        "rsi":          round(live["rsi"], 1),
        "mfi":          round(live["mfi"], 1),
        "obv_chg_5":    round(live["obv_chg_5"], 4),
        "ma20":         timing["ma20"],
        "ma50":         timing["ma50"],
        "momentum_5d":  round(live["momentum_5d"] * 100, 1),
        "atr_pct":      timing["atr_pct"],
        "warnings":     score["warnings"],
        "action":       action,
        "timing_status":     timing["status"],
        "timing_conclusion": timing["conclusion"],
        "entry_low":         timing["entry_low"],
        "entry_high":        timing["entry_high"],
        "pullback_pct":      timing["pullback_pct"],
        "timing_reasons":    timing["reasons"],
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--symbols", nargs="*", help="Symbols to analyse")
    parser.add_argument("--min-score", type=float, default=40.0)
    args = parser.parse_args()

    analyst_cache  = load_analyst_cache(ANALYST_DIR)
    earnings_cache = load_earnings_cache(EARNINGS_DIR)

    if args.symbols:
        symbols = [s.upper() for s in args.symbols]
    else:
        symbols = sorted(p.stem.upper() for p in HISTORY_DIR.glob("*.json")
                         if p.stem.upper() not in {"SPY", "QQQ", "SOXX", "VIX"})

    print(f"\n=== Growth Pipeline — {date.today()} ===")
    print(f"Universe: {len(symbols)} symbols  |  min_score={args.min_score}")
    print(f"層級: 小型<$300B  中型$300B-$1T  大型$1T-$3T  跳過>$3T\n")
    print("Fetching data...")

    results = []
    skipped = []
    for sym in symbols:
        row = analyse_symbol(sym, analyst_cache, earnings_cache)
        if row is None:
            continue

        cap   = row["market_cap_b"]
        up    = row["analyst_upside"]
        pead  = row["pead_earnings_beat"]
        eps   = row["pead_eps_surprise"]
        days  = row["pead_days_since"]
        has_pead = (pead and eps >= PEAD_MIN_EPS_SURPRISE
                    and days is not None and days <= PEAD_MAX_DAYS)

        # Layer 1: 市值分層篩選
        if cap >= MEGA_CAP_B:
            skipped.append(f"{sym} (市值${cap:.0f}B > $3T，跳過)")
            continue
        elif cap >= LARGE_CAP_B:
            row["tier"] = f"大型 ${cap:.0f}B"
            if up < UPSIDE_LARGE:
                skipped.append(f"{sym} 大型股 upside {up:+.1%} < {UPSIDE_LARGE:.0%}")
                continue
            if not has_pead:
                skipped.append(f"{sym} 大型股但無 PEAD 觸發")
                continue
        elif cap >= MID_CAP_B:
            row["tier"] = f"中型 ${cap:.0f}B"
            if up < UPSIDE_MID:
                skipped.append(f"{sym} 中型股 upside {up:+.1%} < {UPSIDE_MID:.0%}")
                continue
        else:
            row["tier"] = f"小型 ${cap:.0f}B"
            if up < UPSIDE_SMALL:
                skipped.append(f"{sym} 小型股 upside {up:+.1%} < {UPSIDE_SMALL:.0%}")
                continue

        row["has_pead"] = has_pead
        results.append(row)

    # 印出跳過的
    if skipped:
        print(f"\n⏭  跳過 {len(skipped)} 支:")
        for s in skipped:
            print(f"   {s}")

    if not results:
        print("\n沒有股票通過篩選。")
        return

    df = pd.DataFrame(results).sort_values("score", ascending=False)

    print(f"\n{'='*90}")
    print(f"{'SYMBOL':<7} {'層級':<12} {'PRICE':>8} {'SCORE':>6} {'UPSIDE':>8} {'TARGET':>8} {'RAISES':>7} {'RSI':>5} {'MFI':>5}  ACTION")
    print(f"{'-'*90}")

    for _, r in df.iterrows():
        pead_tag  = " [PEAD]" if r.get("has_pead") else ""
        warn_flag = " ⚠" if r["warnings"] else ""
        print(f"{r['symbol']:<7} {r.get('tier',''):<12} {r['price']:>8.2f} "
              f"{r['score']:>6.0f} {r['analyst_upside']:>+7.1%} "
              f"{r['analyst_target_mean']:>8.0f} {r['analyst_raises_ratio']:>7.0%} "
              f"{r['rsi']:>5.1f} {r['mfi']:>5.1f}  {r['action']}{pead_tag}{warn_flag}")
        if r["warnings"]:
            for w in r["warnings"]:
                print(f"{'':>7}  ⚠ {w}")

    print(f"\n通過篩選: {len(df)} 支")

    top = df[df["score"] >= args.min_score]
    if not top.empty:
        print(f"\n{'='*80}")
        print(f"🎯 進場候選 (score >= {args.min_score:.0f})")
        print(f"{'='*80}")
        for _, r in top.iterrows():
            pead_info = ""
            if r.get("has_pead"):
                pead_info = f"  PEAD: EPS+{r['pead_eps_surprise']*100:.1f}%"
                if r["pead_guidance_up"]:
                    pead_info += " guidance↑"
                if r["pead_days_since"] is not None:
                    pead_info += f" ({r['pead_days_since']}天前)"

            # 進場狀態 emoji
            timing_emoji = {"BUY_NOW": "✅", "WAIT_PULLBACK": "⏳", "EXTENDED": "🔴"}.get(r["timing_status"], "")

            print(f"\n  {r['symbol']} — {r.get('tier','')}  score={r['score']:.0f}/100")
            print(f"  分析師: upside {r['analyst_upside']:+.1%} → 目標 ${r['analyst_target_mean']:.0f}  (最高 ${r['analyst_target_high']:.0f})  上調比 {r['analyst_raises_ratio']:.0%}")
            if pead_info:
                print(f"  {pead_info}")
            print(f"  技術面: RSI {r['rsi']:.0f}  MFI {r['mfi']:.0f}  5日動能 {r['momentum_5d']:+.1f}%  MA20偏離 {(r['price']-r['ma20'])/r['ma20']*100:.1f}%")
            print(f"  {timing_emoji} 進場建議: {r['timing_conclusion']}")
            for reason in r.get("timing_reasons", []):
                print(f"     · {reason}")
            if r["warnings"]:
                for w in r["warnings"]:
                    print(f"     ⚠ {w}")
            print(f"  持倉狀態: {r['action']}")


if __name__ == "__main__":
    main()
