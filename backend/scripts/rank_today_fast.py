"""快速版 LambdaMART 推理：只讀每支股票最新 30 天資料，不重建全部歷史樣本。"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from market_context import load_market_context, get_market_features
from sector_classification import is_cyclical, is_speculative_excluded
from ttm_features import load_quarterly_cache, load_annual_cache, compute_ttm_features

_QCACHE_RT = None
_ACACHE_RT = None
def _compute_ttm_rt(symbol, as_of_date):
    global _QCACHE_RT, _ACACHE_RT
    if _QCACHE_RT is None:
        _QCACHE_RT = load_quarterly_cache()
        _ACACHE_RT = load_annual_cache()
    return compute_ttm_features(symbol, as_of_date, _QCACHE_RT, _ACACHE_RT)
from train_classifier_xgb import (
    ANALYST_DIR, FUNDAMENTALS_DIR, HISTORY_10Y_DIR, HISTORY_1Y_DIR,
    LOOKBACK_DAYS, _load_fundamentals, load_analyst_cache,
    _get_fundamental_features, build_analyst_features,
    _safe_float, _commodity_corr,
)
from train_ranker_xgb import FEATURE_COLS

MODELS_DIR = BASE_DIR / "models"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"

# 過濾掉指數/ETF，不是可交易個股
# 指數/ETF/商品/加密——市場context用，非可選個股，不進排名池
EXCLUDE_SYMBOLS = {"SPY", "QQQ", "SOXX", "VIX", "IWM", "DIA", "GLD", "TLT", "SHY", "XLF", "PSKY",
                   "CL", "BTC"}

# 新股歷史不足，改用規則打分門檻
NEW_STOCK_MIN_DAYS = 400  # 少於 400 天歷史 → 用規則補充（模型訓練截止前未上市）


def _new_stock_rule_score(
    sym: str,
    items: list[dict],
    analyst_cache: dict,
    earnings_cache: dict,
) -> dict | None:
    """歷史資料不足的新股：用分析師 upside + beat_streak + eps_surprise 打分。"""
    if not items:
        return None
    latest = items[-1]
    price = float(latest.get("close") or 0)
    if price <= 0:
        return None

    from train_classifier_xgb import build_analyst_features
    from earnings_features import build_earnings_features, load_earnings_cache

    today_date = latest["date"]
    analyst = build_analyst_features(sym, today_date, price, analyst_cache)
    close_by_date = {x["date"]: float(x["close"]) for x in items}
    earn = build_earnings_features(sym, today_date, close_by_date, earnings_cache, current_price=price)

    upside       = analyst.get("analyst_upside_30d", 0.0)
    raises_ratio = analyst.get("analyst_raises_ratio_30d", 0.0)
    coverage     = analyst.get("analyst_coverage_30d", 0.0)
    eps_surprise = earn.get("eps_surprise_pct", 0.0)
    beat_streak  = earn.get("beat_streak", 0.0)
    eps_yoy      = earn.get("eps_yoy", 0.0)

    # 門檻：分析師 upside > 20% 且至少有 1 筆評級才納入
    if upside < 0.20 or coverage <= 0:
        return None

    # 規則分數：upside 50% + raises 20% + beat_streak 15% + eps_yoy 15%
    rule_score = (
        upside * 0.50
        + raises_ratio * 0.20
        + min(beat_streak / 4.0, 1.0) * 0.15
        + min(max(eps_yoy, 0.0), 5.0) / 5.0 * 0.15
    )

    return {
        "symbol": sym,
        "date": today_date,
        "price": price,
        "rank_score": float(rule_score),
        "analyst_upside_30d": upside,
        "analyst_raises_ratio_30d": raises_ratio,
        "rsi": 50.0,
        "mfi": 50.0,
        "eps_yoy": eps_yoy,
        "beat_streak": beat_streak,
        "price_to_52w_high": 1.0,
        "price_to_52w_low": 1.0,
        "eps_price_divergence": 0.0,
        "eps_analyst_lag": 0.0,
        "value_growth": 0.0,
        "loss_depth": 0.0,
        "quality_eps_growth": 0.0,
        "momentum_x_eps_lag": 0.0,
        "crash_no_support": 0.0,
        "revenue_growth_x_margin": 0.0,
        "pe_momentum": 0.0,
        "gross_net_spread": 0.0,
        "beat_streak_quality": 0.0,
        "gold_corr_60d": 0.0,
        "oil_corr_60d": 0.0,
        "btc_corr_60d": 0.0,
        "eps_miss": 0.0,
        "gld_momentum_20d": 0.0,
        "cl_momentum_20d": 0.0,
        "btc_momentum_20d": 0.0,
        "btc_p52w_high": 1.0,
        "beat_streak_x_momentum": 0.0,
        "neg_margin_x_miss": 0.0,
        "consec_loss_sq": 0.0,
        "spy_momentum_20d": 0.0,
        "vix_change_5d": 0.0,
        "beta_60d": 1.0,
        "drawdown_depth": 0.0,
        "low_gross_margin": 0.0,
        "drawdown_x_momentum": 0.0,
        "momentum_accel": 0.0,
        "vol_surge_20_60": 1.0,
        "hot_score": 0.0,
        "cold_penalty": 0.0,
        "accel_x_volume": 0.0,
        "overrun_risk": 0.0,
        "deep_value": 0.0,
        "value_x_momentum": 0.0,
        "overrun_x_neg_momentum": 0.0,
        "oil_bear_signal": 0.0,
        "gold_bear_signal": 0.0,
        "btc_bear_signal": 0.0,
        "hot_macro_headwind": 0.0,
        "rsi_miss_combo": 0.0,
        "crash_momentum": 0.0,
        "dead_cat": 0.0,
        "loss_miss_signal": 0.0,
        "next_est_decline": 0.0,
        "stale_target_risk": 0.0,
        "hot_valuation_risk": 0.0,
        "crowded_momentum": 0.0,
        "falling_knife": 0.0,
        "ttm_profit_margin": 0.0,
        "ttm_revenue_yoy": 0.0,
        "eps_pos_streak": 0.0,
        "eps_turnaround": 0.0,
        "_is_new_stock": True,
    }


def _load_latest_rows(history_dir: Path, lookback: int = 60) -> dict[str, list[dict]]:
    """每支股票只讀最後 lookback 天，速度快。"""
    result: dict[str, list[dict]] = {}
    if not history_dir.exists():
        return result
    for path in sorted(history_dir.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(items, list) or not items:
            continue
        sym = path.stem.upper()
        sorted_items = sorted(
            [x for x in items if isinstance(x, dict) and x.get("date") and x.get("close")],
            key=lambda x: x["date"]
        )
        result[sym] = sorted_items[-lookback:]
    return result


def _calc_rsi(closes: list[float], period: int = 14) -> float:
    if len(closes) < period + 1:
        return 50.0
    s = pd.Series(closes)
    delta = s.diff().dropna()
    gain = delta.clip(lower=0).tail(period).mean()
    loss = (-delta.clip(upper=0)).tail(period).mean()
    if loss == 0:
        return 100.0
    return 100.0 - 100.0 / (1.0 + gain / loss)


def _build_today_features(
    sym: str,
    items: list[dict],
    market_context: dict,
    fundamentals: dict,
    analyst_cache: dict,
    earnings_cache: dict,
) -> dict | None:
    if len(items) < LOOKBACK_DAYS + 2:
        return None

    closes  = [float(x["close"]) for x in items]
    highs   = [float(x.get("high") or x["close"]) for x in items]
    lows    = [float(x.get("low")  or x["close"]) for x in items]
    volumes = [float(x["volume"]) if x.get("volume") else None for x in items]
    rsis    = [_safe_float(x.get("rsi14") or x.get("rsi")) for x in items]
    mfis    = [_safe_float(x.get("mfi14") or x.get("mfi")) for x in items]
    obvs    = [_safe_float(x.get("obv"))   for x in items]
    macds   = [_safe_float(x.get("macd"))  for x in items]
    macd_sigs = [_safe_float(x.get("macdSignal")) for x in items]
    macd_hists= [_safe_float(x.get("macdHist"))   for x in items]

    # 以最新「完整」收盤日為基準(update_history_latest 只寫已完成日K;cron 在美股收盤後跑)。
    # 註:若在美股盤中執行,最後一根可能是當日未完成K——cron 排在收盤後可避免。
    idx = len(items)              # 最後一天 = 最新完整收盤日
    current_close = closes[idx - 1]
    if current_close <= 0:
        return None

    window = pd.Series(closes[idx - LOOKBACK_DAYS: idx])
    returns = window.pct_change().dropna()
    if len(returns) < 3:
        return None

    vol_window = [v for v in volumes[idx - LOOKBACK_DAYS: idx] if v is not None]
    avg_vol = float(pd.Series(vol_window).mean()) if vol_window else current_close
    vol_ratio = (float(vol_window[-1]) / avg_vol) if vol_window and avg_vol > 0 else 1.0

    # 往前找最近一個有值的 RSI/MFI（最新一天可能是 None）
    rsi = next((rsis[i] for i in range(idx - 1, max(idx - 5, -1), -1) if rsis[i] is not None), None)
    rsi = rsi or _calc_rsi(closes[:idx])
    mfi = next((mfis[i] for i in range(idx - 1, max(idx - 5, -1), -1) if mfis[i] is not None), None)
    mfi = mfi or 50.0
    rsi_prev_3 = next((rsis[i] for i in range(max(idx-4,0), max(idx-8,-1), -1) if rsis[i] is not None), None)
    mfi_prev_3 = next((mfis[i] for i in range(max(idx-4,0), max(idx-8,-1), -1) if mfis[i] is not None), None)
    macd_now  = macds[idx - 1] or 0.0
    macd_sig  = macd_sigs[idx - 1] or 0.0
    macd_hist = macd_hists[idx - 1] or 0.0
    macd_hist_prev3 = macd_hists[idx - 4] if idx - 4 >= 0 else None
    obv_now   = obvs[idx - 1]
    obv_prev5 = obvs[idx - 6] if idx - 6 >= 0 else None

    ma5  = float(window.tail(5).mean())
    ma20 = float(window.mean())
    true_ranges = [
        max(highs[j] - lows[j], abs(highs[j] - closes[j-1]), abs(lows[j] - closes[j-1]))
        for j in range(max(1, idx - LOOKBACK_DAYS), idx)
    ]
    atr = float(pd.Series(true_ranges).tail(14).mean()) if true_ranges else 0.0
    tp = [(highs[j] + lows[j] + closes[j]) / 3 for j in range(idx - LOOKBACK_DAYS, idx)]
    vols_w = vol_window if vol_window else [avg_vol] * len(tp)
    vwap = sum(t * v for t, v in zip(tp, vols_w)) / max(sum(vols_w), 1e-9)

    today_date = items[idx - 1]["date"]
    mkt = get_market_features(market_context, today_date)
    spy_close  = market_context.get("SPY",  {}).get(today_date, {}).get("close")
    soxx_close = market_context.get("SOXX", {}).get(today_date, {}).get("close")

    fund = _get_fundamental_features(fundamentals, sym, today_date, current_close)

    from earnings_features import build_earnings_features
    close_by_date = {x["date"]: float(x["close"]) for x in items}
    earn = build_earnings_features(sym, today_date, close_by_date, earnings_cache, current_price=current_close)
    analyst = build_analyst_features(sym, today_date, current_close, analyst_cache)

    mfi_delta = (mfi - mfi_prev_3) if mfi and mfi_prev_3 else 0.0
    price_mfi_div = ((current_close / max(closes[idx-2], 1e-9)) - 1.0) - (mfi_delta / 100.0)

    prev3_date = items[idx - 4]["date"] if idx - 4 >= 0 else None
    spy_prev3  = market_context.get("SPY",  {}).get(prev3_date, {}).get("close") if prev3_date else None
    soxx_prev3 = market_context.get("SOXX", {}).get(prev3_date, {}).get("close") if prev3_date else None
    rs_spy  = current_close / spy_close  if spy_close  else 1.0
    rs_soxx = current_close / soxx_close if soxx_close else 1.0
    rs_spy_prev3  = closes[idx-4] / spy_prev3  if idx-4 >= 0 and spy_prev3  else None
    rs_soxx_prev3 = closes[idx-4] / soxx_prev3 if idx-4 >= 0 and soxx_prev3 else None

    w52_window = closes[max(0, idx - 252):idx]
    w52_high = max(w52_window)
    w52_low  = min(w52_window)
    feat = {
        "symbol": sym,
        "date": today_date,
        "price": current_close,
        "price_to_52w_high": current_close / w52_high if w52_high > 0 else 1.0,
        "price_to_52w_low":  current_close / w52_low  if w52_low  > 0 else 1.0,
        "eps_price_divergence": (
            float(earn["eps_yoy"]) - float((window.iloc[-1] / window.iloc[0]) - 1.0)
            if earn.get("eps_yoy") else
            float(analyst.get("analyst_upside_30d") or 0.0) - float((window.iloc[-1] / window.iloc[0]) - 1.0)
            if analyst.get("analyst_upside_30d") else 0.0
        ),
        "analyst_raises_x_momentum": float(analyst.get("analyst_raises_ratio_30d") or 0.0) * float((window.iloc[-1] / window.iloc[0]) - 1.0),
        "eps_analyst_lag": float(earn.get("eps_yoy") or 0.0) * (1.0 - float(analyst.get("analyst_raises_ratio_30d") or 0.0)),
        "value_growth": float(earn.get("eps_yoy") or 0.0) / max(abs(float(earn.get("price_to_fair_value") or 1.0)), 0.1),
        "loss_depth": float(earn.get("consecutive_neg_eps") or 0.0) * max(0.0, -float(fund.get("profit_margin") or 0.0)),
        "quality_eps_growth": (float(earn.get("eps_yoy") or 0.0) * float(fund.get("profit_margin") or 0.0)) if float(fund.get("profit_margin") or 0.0) >= 0 else (-abs(float(earn.get("eps_yoy") or 0.0)) * abs(float(fund.get("profit_margin") or 0.0))),
        "momentum_x_eps_lag": float((window.iloc[-1] / window.iloc[0]) - 1.0) * (float(earn.get("eps_yoy") or 0.0) * (1.0 - float(analyst.get("analyst_raises_ratio_30d") or 0.0))),
        "crash_no_support": 1.0 if float((window.iloc[-1] / window.iloc[0]) - 1.0) < -0.15 and float(analyst.get("analyst_raises_ratio_30d") or 0.0) == 0.0 else 0.0,
        "beat_streak_quality": float(earn.get("beat_streak") or 0.0) * float(fund.get("profit_margin") or 0.0),
        "revenue_growth_x_margin": float(fund.get("revenue_growth") or 0.0) * float(fund.get("profit_margin") or 0.0),
        "pe_momentum": float(fund.get("pe_ratio_log") or 0.0) * float((window.iloc[-1] / window.iloc[0]) - 1.0),
        "gross_net_spread": float(fund.get("gross_margin") or 0.0) - float(fund.get("profit_margin") or 0.0),
        "lag_1_return": float(returns.iloc[-1]),
        "lag_2_return": float(returns.iloc[-2]) if len(returns) >= 2 else float(returns.iloc[-1]),
        "lag_3_return": float(returns.iloc[-3]) if len(returns) >= 3 else float(returns.iloc[-1]),
        "mean_return_5": float(returns.tail(5).mean()),
        "mean_return_20": float(returns.mean()),
        "volatility_20": float(returns.std(ddof=0) or 0.0),
        "momentum_20": float((window.iloc[-1] / window.iloc[0]) - 1.0),
        "avg_volume_20": avg_vol,
        "volume_ratio": vol_ratio,
        "range_ratio": (max(highs[idx-LOOKBACK_DAYS:idx]) - min(lows[idx-LOOKBACK_DAYS:idx])) / max(current_close, 1e-9),
        "rsi": rsi if rsi else 50.0,
        "mfi": mfi if mfi else 50.0,
        "rsi_norm": ((rsi - 50.0) / 50.0) if rsi else 0.0,
        "mfi_norm": ((mfi - 50.0) / 50.0) if mfi else 0.0,
        "rsi_change_3d": (rsi - rsi_prev_3) if rsi and rsi_prev_3 else 0.0,
        "mfi_change_3d": (mfi - mfi_prev_3) if mfi and mfi_prev_3 else 0.0,
        "ma5_deviation": (current_close / ma5) - 1.0 if ma5 else 0.0,
        "ma20_deviation": (current_close / ma20) - 1.0 if ma20 else 0.0,
        "rsi_delta_1": 0.0,
        "mfi_delta_1": mfi_delta,
        "ma5_slope": 0.0,
        "ma20_slope": 0.0,
        "vwap_deviation": (current_close / vwap) - 1.0 if vwap else 0.0,
        "atr_ratio": atr / max(current_close, 1e-9),
        "price_mfi_divergence": price_mfi_div,
        "obv_change_5": ((obv_now - obv_prev5) / abs(obv_prev5)) if obv_now and obv_prev5 else 0.0,
        "macd": macd_now / max(current_close, 1e-9),
        "macdSignal": macd_sig / max(current_close, 1e-9),
        "macdHist": macd_hist / max(current_close, 1e-9),
        "macdHist_change_3d": ((macd_hist - macd_hist_prev3) / max(current_close, 1e-9)) if macd_hist_prev3 else 0.0,
        "relative_strength_spy": rs_spy,
        "relative_strength_soxx": rs_soxx,
        "relative_strength_spy_change_3d": (rs_spy - rs_spy_prev3) if rs_spy_prev3 else 0.0,
        "relative_strength_soxx_change_3d": (rs_soxx - rs_soxx_prev3) if rs_soxx_prev3 else 0.0,
        **mkt,
        **fund,
        **earn,
        **analyst,
    }
    # 商品相關性：用 60 天滾動相關係數識別黃金/石油代理股
    _corr_n = 60
    _corr_items = items[max(0, idx - _corr_n):idx]
    _corr_cls = [float(x["close"]) for x in _corr_items]
    _corr_dates = [x["date"] for x in _corr_items]
    feat["gold_corr_60d"] = _commodity_corr(_corr_cls, _corr_dates, market_context.get("GLD", {}))
    feat["oil_corr_60d"] = _commodity_corr(_corr_cls, _corr_dates, market_context.get("CL", {}))
    feat["btc_corr_60d"] = _commodity_corr(_corr_cls, _corr_dates, market_context.get("BTC", {}))

    # eps_miss、商品動能、beat_streak × 動能
    _eps_surp = feat.get("eps_surprise_pct") or earn.get("eps_surprise_pct") or 0.0
    feat["eps_miss"] = 1.0 if float(_eps_surp) < -0.10 else 0.0
    _momentum_now = float((window.iloc[-1] / window.iloc[0]) - 1.0)
    _gld_by_date = market_context.get("GLD", {})
    _cl_by_date  = market_context.get("CL", {})
    _gld_now  = _gld_by_date.get(today_date, {}).get("close")
    _gld_prev = _gld_by_date.get(items[max(0, idx-21)]["date"], {}).get("close") if idx >= 21 else None
    _cl_now   = _cl_by_date.get(today_date, {}).get("close")
    _cl_prev  = _cl_by_date.get(items[max(0, idx-21)]["date"], {}).get("close") if idx >= 21 else None
    feat["gld_momentum_20d"] = float((_gld_now / _gld_prev) - 1.0) if (_gld_now and _gld_prev and _gld_prev > 0) else 0.0
    feat["cl_momentum_20d"]  = float((_cl_now  / _cl_prev)  - 1.0) if (_cl_now  and _cl_prev  and _cl_prev  > 0) else 0.0
    _btc_by_date = market_context.get("BTC", {})
    _btc_now  = _btc_by_date.get(today_date, {}).get("close")
    _btc_prev = _btc_by_date.get(items[max(0, idx-21)]["date"], {}).get("close") if idx >= 21 else None
    feat["btc_momentum_20d"] = float((_btc_now / _btc_prev) - 1.0) if (_btc_now and _btc_prev and _btc_prev > 0) else 0.0
    _btc_52h = max((_btc_by_date.get(items[j]["date"], {}).get("close") or 0) for j in range(max(0, idx-252), idx)) if idx > 0 else 0
    feat["btc_p52w_high"] = float(_btc_now / _btc_52h) if (_btc_now and _btc_52h and _btc_52h > 0) else 1.0
    feat["beat_streak_x_momentum"] = float(earn.get("beat_streak") or 0.0) * _momentum_now
    _pm = float(fund.get("profit_margin") or 0.0)
    _eps_s = float(feat.get("eps_surprise_pct") or earn.get("eps_surprise_pct") or 0.0)
    _eps_miss_val = 1.0 if _eps_s < -0.10 else 0.0
    feat["neg_margin_x_miss"] = max(-_pm, 0.0) * _eps_miss_val
    _consec = float(earn.get("consecutive_neg_eps") or 0.0)
    feat["consec_loss_sq"] = _consec ** 2

    # 市場防禦特徵
    _spy_by_date = market_context.get("SPY", {})
    _vix_by_date = market_context.get("VIX", {})
    _spy_now  = _spy_by_date.get(today_date, {}).get("close")
    _spy_prev20 = _spy_by_date.get(items[max(0, idx-21)]["date"], {}).get("close") if idx >= 21 else None
    feat["spy_momentum_20d"] = float((_spy_now / _spy_prev20) - 1.0) if (_spy_now and _spy_prev20 and _spy_prev20 > 0) else 0.0
    _vix_now  = _vix_by_date.get(today_date, {}).get("close")
    _vix_prev5 = _vix_by_date.get(items[max(0, idx-6)]["date"], {}).get("close") if idx >= 6 else None
    feat["vix_change_5d"] = float((_vix_now / _vix_prev5) - 1.0) if (_vix_now and _vix_prev5 and _vix_prev5 > 0) else 0.0
    _spy_rets_b = [float((closes[j]/closes[j-1])-1.0) for j in range(max(1,idx-60),idx) if closes[j-1]>0 and _spy_by_date.get(items[j]["date"],{}).get("close") and _spy_by_date.get(items[j-1]["date"],{}).get("close")]
    _mkt_rets_b = [float((_spy_by_date.get(items[j]["date"],{}).get("close",0)/_spy_by_date.get(items[j-1]["date"],{}).get("close",1))-1.0) for j in range(max(1,idx-60),idx) if closes[j-1]>0 and _spy_by_date.get(items[j]["date"],{}).get("close") and _spy_by_date.get(items[j-1]["date"],{}).get("close")]
    if len(_spy_rets_b) >= 20:
        _sm = sum(_spy_rets_b)/len(_spy_rets_b)
        _mm = sum(_mkt_rets_b)/len(_mkt_rets_b)
        _cov_b = sum((s-_sm)*(m-_mm) for s,m in zip(_spy_rets_b,_mkt_rets_b))/len(_mkt_rets_b)
        _var_b = sum((m-_mm)**2 for m in _mkt_rets_b)/len(_mkt_rets_b)
        feat["beta_60d"] = float(_cov_b/_var_b) if _var_b > 1e-10 else 1.0
    else:
        feat["beta_60d"] = 1.0

    # 崩跌/低毛利 ML 特徵
    _w52h = max(closes[max(0, idx-252):idx]) if idx > 0 else current_close
    _p52h_v = current_close / _w52h if _w52h > 0 else 1.0
    feat["drawdown_depth"] = max(0.0, 1.0 - _p52h_v)
    _gross_v = float(fund.get("gross_margin") or 1.0)
    feat["low_gross_margin"] = max(0.0, 0.30 - _gross_v)
    feat["drawdown_x_momentum"] = feat["drawdown_depth"] * min(0.0, _momentum_now)
    # 市場熱度特徵
    _vol_60 = [v for v in [items[j].get("volume") for j in range(max(0, idx-60), idx)] if v is not None]
    _avg_vol_60 = float(sum(_vol_60)/len(_vol_60)) if _vol_60 else feat.get("avg_volume_20", 1.0)
    _avg_vol_20 = feat.get("avg_volume_20", _avg_vol_60) or _avg_vol_60
    _vol_surge = float(min(_avg_vol_20 / _avg_vol_60, 3.0)) if _avg_vol_60 > 0 else 1.0
    _mom10 = float((closes[idx-1] / closes[idx-11]) - 1.0) if idx >= 11 and closes[idx-11] > 0 else _momentum_now
    feat["momentum_accel"] = _mom10 - _momentum_now
    feat["vol_surge_20_60"] = _vol_surge
    feat["hot_score"] = _vol_surge * max(0.0, _momentum_now)
    feat["cold_penalty"] = max(0.0, 1.0 - _vol_surge) * max(0.0, -_momentum_now + 0.05)
    feat["accel_x_volume"] = max(0.0, feat["momentum_accel"]) * max(0.0, _vol_surge - 1.0)

    _upside_v = float(earn.get("analyst_upside_30d") or analyst.get("analyst_upside_30d") or feat.get("analyst_upside_30d") or 0.0)
    feat["overrun_risk"] = max(0.0, 0.05 - _upside_v)
    feat["deep_value"] = max(0.0, _upside_v - 0.30)
    feat["value_x_momentum"] = max(0.0, _upside_v - 0.10) * max(0.0, _momentum_now)
    feat["overrun_x_neg_momentum"] = feat["overrun_risk"] * abs(min(0.0, _momentum_now))

    # 讓模型學習 Hard Filter 邏輯的交互特徵
    _oil_c  = float(feat.get("oil_corr_60d",  0.0) or 0.0)
    _gld_c  = float(feat.get("gold_corr_60d", 0.0) or 0.0)
    _btc_c  = float(feat.get("btc_corr_60d",  0.0) or 0.0)
    _cl_m   = float(feat.get("cl_momentum_20d",  0.0) or 0.0)
    _gld_m  = float(feat.get("gld_momentum_20d", 0.0) or 0.0)
    _btc_h  = float(feat.get("btc_p52w_high", 1.0) or 1.0)
    _rsi_v  = float(feat.get("rsi", 50.0) or 50.0)
    _eps_s  = float(feat.get("eps_surprise_pct", 0.0) or 0.0)
    _p52h_v = float(feat.get("price_to_52w_high", 1.0) or 1.0)
    _pm_v   = float(feat.get("profit_margin", 0.0) or 0.0)
    _hot    = float(feat.get("hot_score", 0.0) or 0.0)
    _nxt_e  = float(feat.get("next_eps_est_vs_prev", 0.0) or 0.0)
    _spy_m  = float(feat.get("spy_momentum_20d", 0.0) or 0.0)
    feat["oil_bear_signal"]    = max(0.0, _oil_c - 0.3) * max(0.0, -_cl_m)
    feat["gold_bear_signal"]   = max(0.0, _gld_c - 0.3) * max(0.0, -_gld_m)
    feat["btc_bear_signal"]    = max(0.0, _btc_c - 0.3) * max(0.0, 0.85 - _btc_h)
    feat["hot_macro_headwind"] = _hot * max(0.0, -_cl_m) + _hot * max(0.0, -_spy_m * 2.0)
    feat["rsi_miss_combo"]     = max(0.0, _rsi_v - 65.0) / 35.0 * max(0.0, -_eps_s)
    feat["crash_momentum"]     = max(0.0, 0.50 - _p52h_v) * max(0.0, -_momentum_now)
    feat["dead_cat"]           = max(0.0, 0.55 - _p52h_v) * max(0.0, 0.95 - _vol_surge)
    feat["loss_miss_signal"]   = max(0.0, -_pm_v - 0.02) * max(0.0, -_eps_s)
    feat["next_est_decline"]   = max(0.0, -_nxt_e - 0.10)
    _drawdown_v = float(feat.get("drawdown_depth", 0.0) or 0.0)
    feat["stale_target_risk"]  = max(0.0, _drawdown_v - 0.25) * max(0.0, _upside_v - 0.35)
    _pel = float(feat.get("pe_ratio_log", 0.0) or 0.0)
    _bta = float(feat.get("beta_60d", 1.0) or 1.0)
    _v20 = float(feat.get("volatility_20", 0.0) or 0.0)
    feat["hot_valuation_risk"] = max(0.0, _pel - 3.5) * max(0.0, _bta - 1.2) * (1.0 + max(0.0, _vol_surge - 1.0))
    feat["crowded_momentum"]   = max(0.0, _v20 - 0.04) * max(0.0, _vol_surge - 1.0) * max(0.0, _bta - 1.0)
    feat["falling_knife"]      = max(0.0, 35.0 - _rsi_v) / 35.0 * max(0.0, -_momentum_now) * max(0.0, 1.0 - _vol_surge) * (1.0 + max(0.0, _bta - 1.5))
    _ttm = _compute_ttm_rt(feat.get("symbol", ""), today_date)
    feat["ttm_profit_margin"]  = _ttm["ttm_profit_margin"]
    feat["ttm_revenue_yoy"]    = _ttm["ttm_revenue_yoy"]
    return feat


# 「個股量化體檢」6 大因子 → 對映模型特徵欄(direction: +1 越高越好, -1 越低越好)。
# 每個因子取成分特徵在全市場的百分位平均,翻譯成 0~100 的健康分數。
HEALTH_FACTORS = {
    "momentum":  [("momentum_20", 1), ("mean_return_20", 1), ("relative_strength_spy", 1)],
    "quality":   [("profit_margin", 1), ("gross_margin", 1)],
    "growth":    [("revenue_growth", 1), ("eps_yoy", 1)],
    "analyst":   [("analyst_upside_30d", 1), ("analyst_raises_ratio_30d", 1)],
    "value":     [("price_to_fair_value", -1), ("pe_ratio_log", -1)],
    "stability": [("beta_60d", -1), ("volatility_20", -1)],
}


def _compute_health(df: pd.DataFrame, latest_date) -> None:
    """把全市場每支股票的因子值換算成百分位,寫出 health_latest.json(供 API /health/{symbol})。"""
    work = df.copy()
    factor_pct: dict[str, pd.Series] = {}
    for fac, comps in HEALTH_FACTORS.items():
        parts = []
        for col, direction in comps:
            if col not in work.columns:
                continue
            pct = pd.to_numeric(work[col], errors="coerce").rank(pct=True)
            if direction < 0:
                pct = 1.0 - pct
            parts.append(pct.fillna(0.5))
        factor_pct[fac] = (sum(parts) / len(parts)) if parts else pd.Series(0.5, index=work.index)
    # 總分=6 因子綜合分數的全市場百分位 → 與雷達一致(雷達越大,總分越高,擊敗X%語意成立)
    composite = sum(factor_pct.values()) / len(factor_pct)
    overall = composite.rank(pct=True).fillna(0.5)

    items: dict[str, dict] = {}
    for i, sym in enumerate(work["symbol"]):
        items[str(sym).upper()] = {
            "overall": int(round(float(overall.iloc[i]) * 100)),
            "factors": {f: int(round(float(factor_pct[f].iloc[i]) * 100)) for f in HEALTH_FACTORS},
        }
    payload = {"asOf": str(latest_date), "factors": list(HEALTH_FACTORS.keys()), "items": items}
    out = BASE_DIR / "health_latest.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[health] 體檢百分位已寫出 → {out}  ({len(items)} 支)", flush=True)


def _gainer_entry(sym: str, base: dict, last: dict) -> dict | None:
    try:
        b = float(base.get("close") or 0.0)
        l = float(last.get("close") or 0.0)
    except (TypeError, ValueError):
        return None
    if b <= 0 or l <= 0:
        return None
    return {
        "symbol": sym,
        "baselineDate": str(base.get("date")),
        "baselinePrice": round(b, 2),
        "price": round(l, 2),
        "changePct": round(l / b - 1.0, 4),
    }


def _compute_rs_window(all_sym_rows: dict, top: int = 30):
    """IBD 式相對強度 RS Rating(1~99):4 區間報酬加權(近季加倍) → 全市場百分位。
    3/6/9/12 月 ≈ 63/126/189/252 個交易日。需≥1年歷史。回傳 (items, candidates)。"""
    lookbacks = [(63, 0.4), (126, 0.2), (189, 0.2), (252, 0.2)]
    raw: dict = {}
    price: dict = {}
    ret12: dict = {}
    for sym, rows in all_sym_rows.items():
        if len(rows) < 253:
            continue
        try:
            closes = [float(r.get("close") or 0.0) for r in rows]
        except (TypeError, ValueError):
            continue
        last = closes[-1]
        if last <= 0:
            continue
        score = 0.0
        ok = True
        for n, w in lookbacks:
            past = closes[-1 - n]
            if past <= 0:
                ok = False
                break
            score += w * (last / past - 1.0)
        if ok:
            raw[sym] = score
            price[sym] = last
            ret12[sym] = last / closes[-1 - 252] - 1.0
    if not raw:
        return [], []
    ser = pd.Series(raw)
    pctrank = ser.rank(pct=True)
    rs = {s: int(round(1 + 98 * float(pctrank[s]))) for s in ser.index}
    order = sorted(raw.keys(), key=lambda s: (rs[s], raw[s]), reverse=True)
    items = [
        {"rank": i + 1, "symbol": s, "rsRating": rs[s],
         "price": round(price[s], 2), "changePct": round(ret12[s], 4)}
        for i, s in enumerate(order[:top])
    ]
    candidates = [{"symbol": s} for s in order[:50]]
    return items, candidates


def _compute_top_gainers(all_sym_rows: dict, latest_date, top: int = 30) -> None:
    """全市場漲幅排行,同時算兩種視窗,寫出 top_gainers_latest.json(供 API /top-gainers):
      • ytd: 年初至今。年份依最新資料日動態判斷 → 跨年(2027/1/1)自動歸零重算。
             基準=去年底收盤;只納年初已上市的股(避免年中 IPO 誤導)。
      • 1y : 反推一年(近365天)。永遠有完整一年資料 → 年初不會出現「大家都0%」死區。
             基準=約一年前那天收盤;要求至少有一年歷史(避開新股低基期失真,如剛分拆的 SNDK)。"""
    import datetime
    year = str(latest_date)[:4]
    ytd_since = f"{year}-01-01"
    ytd_ipo_cutoff = f"{year}-01-15"
    try:
        _ld = datetime.date.fromisoformat(str(latest_date))
        y1_target = (_ld - datetime.timedelta(days=365)).isoformat()
    except Exception:
        y1_target = None

    ytd_res: list = []
    y1_res: list = []
    for sym, rows in all_sym_rows.items():
        last = rows[-1]
        # --- YTD ---
        prev_year = [r for r in rows if str(r.get("date", "")) < ytd_since]
        if prev_year:
            e = _gainer_entry(sym, prev_year[-1], last)
            if e:
                ytd_res.append(e)
        else:
            base = next((r for r in rows if str(r.get("date", "")) >= ytd_since), None)
            if base and str(base.get("date", "")) <= ytd_ipo_cutoff:
                e = _gainer_entry(sym, base, last)
                if e:
                    ytd_res.append(e)
        # --- 近1年 ---
        if y1_target:
            older = [r for r in rows if str(r.get("date", "")) <= y1_target]
            # 一年前有真實收盤價即納入(真數據;含剛分拆但已滿一年者,如 SNDK +4842%)
            if older:
                e = _gainer_entry(sym, older[-1], last)
                if e:
                    y1_res.append(e)

    def _finalize(lst):
        lst.sort(key=lambda x: x["changePct"], reverse=True)
        items = [{"rank": i + 1, **r} for i, r in enumerate(lst[:top])]
        # 候選池 top 50:盤中只需重抓這些股的即時價,用固定基準重算漲幅(省算力)
        candidates = [
            {"symbol": r["symbol"], "baselineDate": r["baselineDate"], "baselinePrice": r["baselinePrice"]}
            for r in lst[:50]
        ]
        return items, candidates

    ytd_items, ytd_cand = _finalize(ytd_res)
    y1_items, y1_cand = _finalize(y1_res)
    rs_items, rs_cand = _compute_rs_window(all_sym_rows, top)
    payload = {
        "asOf": str(latest_date),
        "windows": {
            "ytd": {"since": ytd_since, "items": ytd_items, "candidates": ytd_cand},
            "1y": {"since": y1_target, "items": y1_items, "candidates": y1_cand},
            "rs": {"since": None, "items": rs_items, "candidates": rs_cand},
        },
    }
    out = BASE_DIR / "top_gainers_latest.json"
    out.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"[gainers] 漲幅榜已寫出 → {out}  (YTD {len(ytd_res)} / 近1年 {len(y1_res)} / RS {len(rs_items)})", flush=True)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--horizon", type=int, default=1)
    parser.add_argument("--top", type=int, default=20)
    parser.add_argument("--out", type=str, default=None,
                        help="寫出排名 JSON 的路徑(供 API /ranking 端點讀取),如 ranking_latest.json")
    args = parser.parse_args()

    # 優先用最新的乾淨日期模型（202511 > 202506 > 無後綴舊版）
    _candidates = [
        MODELS_DIR / f"ranker_lambdamart_h{args.horizon}_202607.joblib",
        MODELS_DIR / f"ranker_lambdamart_h{args.horizon}_202511.joblib",
        MODELS_DIR / f"ranker_lambdamart_h{args.horizon}_202506.joblib",
        MODELS_DIR / f"ranker_lambdamart_h{args.horizon}.joblib",
    ]
    model_path = next((p for p in _candidates if p.exists()), None)
    if model_path is None:
        print(f"[error] 找不到任何 ranker 模型")
        return 1

    bundle = joblib.load(model_path)
    ranker = bundle["model"]
    meta   = bundle["metadata"]
    clip_bounds = meta.get("clipBounds", {})
    _ndcg = meta.get("testNDCG10") or meta.get("crossValidation", {}).get("ndcg10Mean", 0.0)
    print(f"[model] {model_path.name}  trainEnd={meta.get('trainEnd')}  特徵={len(meta.get('featureNames', []))}  NDCG@10={_ndcg:.4f}", flush=True)

    print("[data] 載入最新歷史資料...", flush=True)
    history_dir = HISTORY_10Y_DIR if HISTORY_10Y_DIR.exists() else HISTORY_1Y_DIR
    sym_rows = _load_latest_rows(history_dir, lookback=260)
    market_context = load_market_context(history_dir)
    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)

    from earnings_features import load_earnings_cache
    earnings_cache = load_earnings_cache(EARNINGS_DIR)

    # 讀全部歷史（不限 lookback=60）以判斷是否為新股
    all_sym_rows: dict[str, list[dict]] = {}
    for path in sorted(history_dir.glob("*.json")):
        sym = path.stem.upper()
        if sym in EXCLUDE_SYMBOLS:
            continue
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
            sorted_items = sorted(
                [x for x in items if isinstance(x, dict) and x.get("date") and x.get("close")],
                key=lambda x: x["date"]
            )
            if sorted_items:
                all_sym_rows[sym] = sorted_items
        except Exception:
            continue

    sym_rows = {s: v for s, v in sym_rows.items() if s not in EXCLUDE_SYMBOLS}
    print(f"[data] 股票數={len(sym_rows)}  開始計算 features...", flush=True)
    records = []
    new_stock_records = []
    for i, (sym, items) in enumerate(sym_rows.items()):
        total_history = len(all_sym_rows.get(sym, []))
        if total_history < NEW_STOCK_MIN_DAYS:
            rule_rec = _new_stock_rule_score(sym, items, analyst_cache, earnings_cache)
            if rule_rec:
                new_stock_records.append(rule_rec)
        else:
            feat = _build_today_features(sym, items, market_context, fundamentals, analyst_cache, earnings_cache)
            if feat:
                # 連續兩季 EPS 虧損 → 排除
                _has_fund = any(feat.get(k) for k in ("profit_margin", "gross_margin", "revenue_growth"))
                _has_earn = any(feat.get(k) for k in ("eps_yoy", "beat_streak", "eps_surprise_pct"))
                if not _has_fund and not _has_earn:
                    continue
                # 高風險投機股排除（CVNA 類）
                if is_speculative_excluded(feat.get("symbol", "")):
                    continue
                # 安全網：只保留極端案例
                _p52h = feat.get("price_to_52w_high", 1.0) or 1.0
                _mom20 = feat.get("momentum_20", 0.0) or 0.0
                if _p52h < 0.35 or (_p52h < 0.45 and _mom20 < -0.15):
                    continue
                # 接刀過濾：超賣(RSI<30)+負動能+量縮+高beta（SMCI/HOOD/COIN 型）
                _rsi_f = feat.get("rsi", 50.0) or 50.0
                _surge_f = feat.get("vol_surge_20_60", 1.0) or 1.0
                _beta_f = feat.get("beta_60d", 1.0) or 1.0
                if _rsi_f < 30 and _mom20 < 0 and _surge_f < 0.90 and _beta_f > 2.5:
                    continue
                records.append(feat)
        if (i + 1) % 100 == 0:
            print(f"  {i+1}/{len(sym_rows)}...", flush=True)

    if new_stock_records:
        print(f"[new_stock] 新股規則補充: {len(new_stock_records)} 支 → {[r['symbol'] for r in new_stock_records]}", flush=True)

    if not records and not new_stock_records:
        print("[error] 沒有可用資料")
        return 1

    df = pd.DataFrame(records)
    latest_date = df["date"].max()
    print(f"[today] 日期={latest_date}  有效股票={len(df)}", flush=True)

    # 用模型自己的特徵清單（不同模型特徵數可能不同，避免 mismatch）
    model_feature_cols = meta.get("featureNames") or FEATURE_COLS
    for _c in model_feature_cols:
        if _c not in df.columns:
            df[_c] = 0.0
    X = df[model_feature_cols].fillna(0.0).copy()

    # 套用訓練時的 clip bounds
    log_features = {"volume_ratio", "atr_ratio", "avg_volume_20"}
    for col, bounds in clip_bounds.items():
        if col not in X.columns:
            continue
        lo, hi = bounds.get("lo"), bounds.get("hi")
        if lo is not None and hi is not None:
            X[col] = X[col].clip(lower=lo, upper=hi)
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))

    scores = ranker.predict(X)
    df["rank_score"] = scores
    df["_is_new_stock"] = False

    # 合併新股
    if new_stock_records:
        df_new = pd.DataFrame(new_stock_records)
        df = pd.concat([df, df_new], ignore_index=True)

    # 流動性護欄(主力訊號):日成交額過低 + MFI超買 = 薄量散戶froth(INDI類),非主力進駐。
    # 大量股(NVTS/SNDK/MRVL/CRDO 成交額數億)不受影響。預設常駐,設 FILTER_THIN_LIQUIDITY=0 才關閉。
    if os.environ.get("FILTER_THIN_LIQUIDITY", "1") != "0":
        _min_dv  = float(os.environ.get("MIN_DOLLAR_VOL", "50e6"))
        _mfi_hot = float(os.environ.get("THIN_MFI_HOT", "85"))
        _dv  = (df["avg_volume_20"].fillna(0.0) * df["price"].fillna(0.0))
        _mfi = df["mfi"].fillna(50.0)
        _thin = (_dv < _min_dv) & (_mfi >= _mfi_hot)
        if _thin.any():
            _dropped = sorted(df.loc[_thin, "symbol"].tolist())
            print(f"[filter] 薄量froth流動性過濾: {len(_dropped)} 支 {_dropped}", flush=True)
            df = df.loc[~_thin].copy()

    # 族群相對強度 re-rank 傾斜(SECTOR_TILT=1 才生效;反應式 sector rotation)
    if os.environ.get("SECTOR_TILT", "1") != "0" and len(df) > 1:
        from sector_momentum import sector_bonus
        _rng = float(df["rank_score"].max() - df["rank_score"].min()) or 1.0
        df["rank_score"] = df.apply(
            lambda r: r["rank_score"] + sector_bonus(r.get("symbol", ""), str(latest_date)) * _rng, axis=1)

    df_ranked = df.sort_values("rank_score", ascending=False).reset_index(drop=True)
    df_ranked["rank"] = df_ranked.index + 1

    top = df_ranked.head(args.top)
    bottom = df_ranked.tail(10)

    print(f"\n{'='*88}")
    print(f"🏆 LambdaMART TOP {args.top}  ({latest_date})")
    print(f"{'='*88}")
    print(f"{'#':<4} {'SYM':<8} {'PRICE':>8}  {'SCORE':>7}  {'ANALYST_UP':>10}  {'RAISES':>7}  {'RSI':>6}  {'NOTE'}")
    print(f"{'-'*92}")
    for _, row in top.iterrows():
        upside = row.get("analyst_upside_30d", 0.0)
        raises = row.get("analyst_raises_ratio_30d", 0.0)
        rsi    = row.get("rsi", 50.0)
        note   = "⭐新股(規則)" if row.get("_is_new_stock") else ""
        print(f"{int(row['rank']):<4} {row['symbol']:<8} {row['price']:>8.2f}  {row['rank_score']:>7.4f}"
              f"  {upside:>+9.1%}  {raises:>6.0%}  {rsi:>6.1f}  {note}")

    print(f"\n{'='*88}")
    print(f"🔴 BOTTOM 10")
    print(f"{'='*88}")
    print(f"{'#':<4} {'SYM':<8} {'PRICE':>8}  {'SCORE':>7}  {'ANALYST_UP':>10}  {'RSI':>6}")
    print(f"{'-'*88}")
    for _, row in bottom.iterrows():
        upside = row.get("analyst_upside_30d", 0.0)
        rsi    = row.get("rsi", 50.0)
        print(f"{int(row['rank']):<4} {row['symbol']:<8} {row['price']:>8.2f}  {row['rank_score']:>7.4f}"
              f"  {upside:>+9.1%}  {rsi:>6.1f}")

    print(f"\n共 {len(df_ranked)} 支股票排名完成")

    # 對比 Growth Score
    gs_path = BASE_DIR / "watchlist_predictions.json"
    if gs_path.exists():
        gs_data = json.loads(gs_path.read_text(encoding="utf-8"))
        gs_map  = {d["symbol"]: d.get("growthScore", 0) for d in gs_data if isinstance(d, dict)}
        top_lm  = set(top["symbol"].tolist())
        top_gs  = set(s for s, _ in sorted(gs_map.items(), key=lambda x: x[1], reverse=True)[:args.top])
        overlap = top_lm & top_gs
        print(f"\n[對比] LambdaMART vs Growth Score  重疊 {len(overlap)}/{args.top} 支")
        print(f"  共同選中: {', '.join(sorted(overlap))}")
        only_lm = top_lm - top_gs
        only_gs = top_gs - top_lm
        if only_lm: print(f"  只有 LambdaMART: {', '.join(sorted(only_lm))}")
        if only_gs: print(f"  只有 Growth Score: {', '.join(sorted(only_gs))}")

    # 寫出排名 JSON(供 API /ranking 端點)
    if args.out:
        items = []
        for _, row in top.iterrows():
            items.append({
                "rank": int(row["rank"]),
                "symbol": str(row["symbol"]),
                "price": round(float(row.get("price", 0.0) or 0.0), 2),
                "score": round(float(row.get("rank_score", 0.0) or 0.0), 4),
                "analystUpside": round(float(row.get("analyst_upside_30d", 0.0) or 0.0), 4),
                "analystRaisesRatio": round(float(row.get("analyst_raises_ratio_30d", 0.0) or 0.0), 4),
                "rsi": round(float(row.get("rsi", 50.0) or 50.0), 1),
                "isNewStock": bool(row.get("_is_new_stock", False)),
            })
        payload = {
            "asOf": str(latest_date),
            "model": model_path.stem,
            "count": len(items),
            "items": items,
        }
        out_path = Path(args.out)
        if not out_path.is_absolute():
            out_path = BASE_DIR / out_path
        out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"[out] 排名已寫出 → {out_path}  ({len(items)} 支, asOf={latest_date})", flush=True)

    # 個股量化體檢百分位(全市場),供 API /health/{symbol}
    _compute_health(df_ranked, latest_date)
    # 漲幅排行榜已改由獨立的「廣宇宙」builder 產生(scripts/build_gainers.py),
    # 與模型宇宙(history_10y,聚焦半導體)解耦 → 這裡不再寫窄榜。
    # _compute_top_gainers(all_sym_rows, latest_date)  # 已停用(見 build_gainers.py)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
