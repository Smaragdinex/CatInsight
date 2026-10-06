"""LambdaMART Walk-Forward Backtest

模擬：在某個過去日期用當時資料排名 TOP N，然後看之後 hold_days 天的真實報酬。

用法：
    python scripts/backtest_lambdamart.py --start 2025-03-01 --hold 60 --top 20
    python scripts/backtest_lambdamart.py --start 2025-01-01 --hold 90 --top 20
"""
from __future__ import annotations

import argparse
import json
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

_QCACHE_BT = None
_ACACHE_BT = None
def _compute_ttm_bt(symbol, as_of_date):
    global _QCACHE_BT, _ACACHE_BT
    if _QCACHE_BT is None:
        _QCACHE_BT = load_quarterly_cache()
        _ACACHE_BT = load_annual_cache()
    return compute_ttm_features(symbol, as_of_date, _QCACHE_BT, _ACACHE_BT)
from train_classifier_xgb import (
    ANALYST_DIR, FUNDAMENTALS_DIR, HISTORY_10Y_DIR, HISTORY_1Y_DIR,
    LOOKBACK_DAYS, _load_fundamentals, load_analyst_cache,
    _get_fundamental_features, build_analyst_features, _safe_float, _commodity_corr,
)
from train_ranker_xgb import FEATURE_COLS
from rank_today_fast import EXCLUDE_SYMBOLS, _calc_rsi, _load_latest_rows

MODELS_DIR   = BASE_DIR / "models"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"


def _build_features_as_of(
    sym: str,
    all_items: list[dict],
    as_of_date: str,
    market_context: dict,
    fundamentals: dict,
    analyst_cache: dict,
    earnings_cache: dict,
) -> dict | None:
    """用 as_of_date 當天的視角建 features（不能用未來資料）。"""
    items = [x for x in all_items if x["date"] <= as_of_date]
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
    macd_sigs  = [_safe_float(x.get("macdSignal")) for x in items]
    macd_hists = [_safe_float(x.get("macdHist"))   for x in items]

    idx = len(items) - 1
    current_close = closes[idx - 1]
    if current_close <= 0:
        return None

    window  = pd.Series(closes[idx - LOOKBACK_DAYS: idx])
    returns = window.pct_change().dropna()
    if len(returns) < 3:
        return None

    vol_window = [v for v in volumes[idx - LOOKBACK_DAYS: idx] if v is not None]
    avg_vol    = float(pd.Series(vol_window).mean()) if vol_window else current_close
    vol_ratio  = (float(vol_window[-1]) / avg_vol) if vol_window and avg_vol > 0 else 1.0
    vol_window_60 = [v for v in volumes[max(0, idx-60):idx] if v is not None]
    avg_vol_60 = float(pd.Series(vol_window_60).mean()) if vol_window_60 else avg_vol
    _vol_surge_20_60 = float(min(avg_vol / avg_vol_60, 3.0)) if avg_vol_60 > 0 else 1.0

    rsi = next((rsis[i] for i in range(idx-1, max(idx-5,-1), -1) if rsis[i] is not None), None)
    rsi = rsi or _calc_rsi(closes[:idx])
    mfi = next((mfis[i] for i in range(idx-1, max(idx-5,-1), -1) if mfis[i] is not None), None)
    mfi = mfi or 50.0
    rsi_prev_3 = next((rsis[i] for i in range(max(idx-4,0), max(idx-8,-1), -1) if rsis[i] is not None), None)
    mfi_prev_3 = next((mfis[i] for i in range(max(idx-4,0), max(idx-8,-1), -1) if mfis[i] is not None), None)

    macd_now  = macds[idx-1] or 0.0
    macd_sig  = macd_sigs[idx-1] or 0.0
    macd_hist = macd_hists[idx-1] or 0.0
    macd_hist_prev3 = macd_hists[idx-4] if idx-4 >= 0 else None
    obv_now  = obvs[idx-1]
    obv_prev5 = obvs[idx-6] if idx-6 >= 0 else None

    ma5  = float(window.tail(5).mean())
    ma20 = float(window.mean())
    true_ranges = [
        max(highs[j]-lows[j], abs(highs[j]-closes[j-1]), abs(lows[j]-closes[j-1]))
        for j in range(max(1, idx-LOOKBACK_DAYS), idx)
    ]
    atr  = float(pd.Series(true_ranges).tail(14).mean()) if true_ranges else 0.0
    tp   = [(highs[j]+lows[j]+closes[j])/3 for j in range(idx-LOOKBACK_DAYS, idx)]
    vols_w = vol_window if vol_window else [avg_vol]*len(tp)
    vwap = sum(t*v for t,v in zip(tp,vols_w)) / max(sum(vols_w), 1e-9)

    today_date = items[idx-1]["date"]
    mkt  = get_market_features(market_context, today_date)
    spy_close  = market_context.get("SPY",  {}).get(today_date, {}).get("close")
    soxx_close = market_context.get("SOXX", {}).get(today_date, {}).get("close")

    fund    = _get_fundamental_features(fundamentals, sym, today_date, current_close)
    from earnings_features import build_earnings_features
    close_by_date = {x["date"]: float(x["close"]) for x in items}
    earn    = build_earnings_features(sym, today_date, close_by_date, earnings_cache, current_price=current_close)
    analyst = build_analyst_features(sym, today_date, current_close, analyst_cache)

    _corr_cls   = closes[max(0, idx-60):idx]
    _corr_dates = [items[j]["date"] for j in range(max(0, idx-60), idx)]
    _gold_corr  = _commodity_corr(_corr_cls, _corr_dates, market_context.get("GLD", {}))
    _oil_corr   = _commodity_corr(_corr_cls, _corr_dates, market_context.get("CL", {}))
    _btc_corr   = _commodity_corr(_corr_cls, _corr_dates, market_context.get("BTC", {}))
    _vol20      = float(window.pct_change().dropna().std(ddof=0) or 0.0)
    _momentum   = float((window.iloc[-1] / window.iloc[0]) - 1.0)
    _raises     = float(analyst.get("analyst_raises_ratio_30d") or 0.0)

    mfi_delta    = (mfi - mfi_prev_3) if mfi and mfi_prev_3 else 0.0
    price_mfi_div = ((current_close / max(closes[idx-2],1e-9))-1.0) - (mfi_delta/100.0)

    prev3_date = items[idx-4]["date"] if idx-4 >= 0 else None
    spy_prev3  = market_context.get("SPY", {}).get(prev3_date,{}).get("close") if prev3_date else None
    soxx_prev3 = market_context.get("SOXX",{}).get(prev3_date,{}).get("close") if prev3_date else None
    rs_spy   = current_close/spy_close  if spy_close  else 1.0
    rs_soxx  = current_close/soxx_close if soxx_close else 1.0
    rs_spy_p = closes[idx-4]/spy_prev3  if idx-4>=0 and spy_prev3  else None
    rs_soxx_p= closes[idx-4]/soxx_prev3 if idx-4>=0 and soxx_prev3 else None

    w52_window = closes[max(0, idx - 252):idx]
    w52_high = max(w52_window)
    w52_low  = min(w52_window)
    result = {
        "symbol": sym,
        "date": today_date,
        "price_entry": current_close,
        "price_to_52w_high": current_close / w52_high if w52_high > 0 else 1.0,
        "price_to_52w_low":  current_close / w52_low  if w52_low  > 0 else 1.0,
        "eps_price_divergence": (
            float(earn["eps_yoy"]) - float((window.iloc[-1] / window.iloc[0]) - 1.0)
            if earn and earn.get("eps_yoy") else
            float(analyst.get("analyst_upside_30d") or 0.0) - float((window.iloc[-1] / window.iloc[0]) - 1.0)
            if analyst and analyst.get("analyst_upside_30d") else 0.0
        ),
        "lag_1_return": float(returns.iloc[-1]),
        "lag_2_return": float(returns.iloc[-2]) if len(returns)>=2 else float(returns.iloc[-1]),
        "lag_3_return": float(returns.iloc[-3]) if len(returns)>=3 else float(returns.iloc[-1]),
        "mean_return_5": float(returns.tail(5).mean()),
        "mean_return_20": float(returns.mean()),
        "volatility_20": float(returns.std(ddof=0) or 0.0),
        "momentum_20": float((window.iloc[-1]/window.iloc[0])-1.0),
        "avg_volume_20": avg_vol,
        "volume_ratio": vol_ratio,
        "range_ratio": (max(highs[idx-LOOKBACK_DAYS:idx])-min(lows[idx-LOOKBACK_DAYS:idx]))/max(current_close,1e-9),
        "rsi": rsi if rsi else 50.0,
        "mfi": mfi if mfi else 50.0,
        "rsi_norm": ((rsi-50.0)/50.0) if rsi else 0.0,
        "mfi_norm": ((mfi-50.0)/50.0) if mfi else 0.0,
        "rsi_change_3d": (rsi-rsi_prev_3) if rsi and rsi_prev_3 else 0.0,
        "mfi_change_3d": (mfi-mfi_prev_3) if mfi and mfi_prev_3 else 0.0,
        "ma5_deviation": (current_close/ma5)-1.0 if ma5 else 0.0,
        "ma20_deviation": (current_close/ma20)-1.0 if ma20 else 0.0,
        "rsi_delta_1": 0.0,
        "mfi_delta_1": mfi_delta,
        "ma5_slope": 0.0,
        "ma20_slope": 0.0,
        "vwap_deviation": (current_close/vwap)-1.0 if vwap else 0.0,
        "atr_ratio": atr/max(current_close,1e-9),
        "price_mfi_divergence": price_mfi_div,
        "obv_change_5": ((obv_now-obv_prev5)/abs(obv_prev5)) if obv_now and obv_prev5 else 0.0,
        "macd": macd_now/max(current_close,1e-9),
        "macdSignal": macd_sig/max(current_close,1e-9),
        "macdHist": macd_hist/max(current_close,1e-9),
        "macdHist_change_3d": ((macd_hist-macd_hist_prev3)/max(current_close,1e-9)) if macd_hist_prev3 else 0.0,
        "relative_strength_spy": rs_spy,
        "relative_strength_soxx": rs_soxx,
        "relative_strength_spy_change_3d": (rs_spy-rs_spy_p) if rs_spy_p else 0.0,
        "relative_strength_soxx_change_3d": (rs_soxx-rs_soxx_p) if rs_soxx_p else 0.0,
        "analyst_raises_x_momentum": float(analyst.get("analyst_raises_ratio_30d") or 0.0) * float((window.iloc[-1] / window.iloc[0]) - 1.0),
        "eps_analyst_lag": float((earn or {}).get("eps_yoy") or 0.0) * (1.0 - float(analyst.get("analyst_raises_ratio_30d") or 0.0)),
        "value_growth": float((earn or {}).get("eps_yoy") or 0.0) / max(abs(float((earn or {}).get("price_to_fair_value") or 1.0)), 0.1),
        "loss_depth": float((earn or {}).get("consecutive_neg_eps") or 0.0) * max(0.0, -float((fund or {}).get("profit_margin") or 0.0)),
        "quality_eps_growth": (float((earn or {}).get("eps_yoy") or 0.0) * float((fund or {}).get("profit_margin") or 0.0)) if float((fund or {}).get("profit_margin") or 0.0) >= 0 else (-abs(float((earn or {}).get("eps_yoy") or 0.0)) * abs(float((fund or {}).get("profit_margin") or 0.0))),
        "momentum_x_eps_lag": float((window.iloc[-1] / window.iloc[0]) - 1.0) * (float((earn or {}).get("eps_yoy") or 0.0) * (1.0 - float(analyst.get("analyst_raises_ratio_30d") or 0.0))),
        "crash_no_support": 1.0 if float((window.iloc[-1] / window.iloc[0]) - 1.0) < -0.15 and float(analyst.get("analyst_raises_ratio_30d") or 0.0) == 0.0 else 0.0,
        "revenue_growth_x_margin": float((fund or {}).get("revenue_growth") or 0.0) * float((fund or {}).get("profit_margin") or 0.0),
        "pe_momentum": float((fund or {}).get("pe_ratio_log") or 0.0) * float((window.iloc[-1] / window.iloc[0]) - 1.0),
        "gross_net_spread": float((fund or {}).get("gross_margin") or 0.0) - float((fund or {}).get("profit_margin") or 0.0),
        "beat_streak_quality": float((earn or {}).get("beat_streak") or 0.0) * float((fund or {}).get("profit_margin") or 0.0),
        "gold_corr_60d": _gold_corr,
        "oil_corr_60d": _oil_corr,
        "btc_corr_60d": _btc_corr,
        "btc_momentum_20d": (lambda bn, bp: float((bn/bp)-1.0) if (bn and bp and bp>0) else 0.0)(market_context.get("BTC",{}).get(today_date,{}).get("close"), market_context.get("BTC",{}).get(items[max(0,idx-21)]["date"],{}).get("close") if idx>=21 else None),
        "btc_p52w_high": (lambda bn, bh: float(bn/bh) if (bn and bh and bh>0) else 1.0)(market_context.get("BTC",{}).get(today_date,{}).get("close"), max((market_context.get("BTC",{}).get(items[j]["date"],{}).get("close",0) or 0) for j in range(max(0,idx-252),idx)) if idx>0 else None),
        "eps_miss": 1.0 if float((earn or {}).get("eps_surprise_pct") or 0.0) < -0.10 else 0.0,
        "gld_momentum_20d": (lambda gn, gp: float((gn/gp)-1.0) if (gn and gp and gp>0) else 0.0)(market_context.get("GLD",{}).get(today_date,{}).get("close"), market_context.get("GLD",{}).get(items[max(0,idx-21)]["date"],{}).get("close") if idx>=21 else None),
        "cl_momentum_20d":  (lambda cn, cp: float((cn/cp)-1.0) if (cn and cp and cp>0) else 0.0)(market_context.get("CL",{}).get(today_date,{}).get("close"),  market_context.get("CL",{}).get(items[max(0,idx-21)]["date"],{}).get("close")  if idx>=21 else None),
        "beat_streak_x_momentum": float((earn or {}).get("beat_streak") or 0.0) * _momentum,
        "neg_margin_x_miss": max(-float((fund or {}).get("profit_margin") or 0.0), 0.0) * (1.0 if float((earn or {}).get("eps_surprise_pct") or 0.0) < -0.10 else 0.0),
        "consec_loss_sq": float((earn or {}).get("consecutive_neg_eps") or 0.0) ** 2,
        "drawdown_depth": max(0.0, 1.0 - (current_close / max(closes[max(0,idx-252):idx]) if max(closes[max(0,idx-252):idx]) > 0 else 1.0)),
        "low_gross_margin": max(0.0, 0.30 - float((fund or {}).get("gross_margin") or 1.0)),
        "drawdown_x_momentum": max(0.0, 1.0 - (current_close / max(closes[max(0,idx-252):idx]) if max(closes[max(0,idx-252):idx]) > 0 else 1.0)) * min(0.0, _momentum),
        "momentum_accel": (float((window.iloc[-1]/window.iloc[-11])-1.0) if len(window)>=11 else 0.0) - _momentum,
        "vol_surge_20_60": _vol_surge_20_60,
        "hot_score": _vol_surge_20_60 * max(0.0, _momentum),
        "cold_penalty": max(0.0, 1.0 - _vol_surge_20_60) * max(0.0, -_momentum + 0.05),
        "accel_x_volume": max(0.0, (float((window.iloc[-1]/window.iloc[-11])-1.0) if len(window)>=11 else 0.0) - _momentum) * max(0.0, _vol_surge_20_60 - 1.0),
        "overrun_risk": max(0.0, 0.05 - float(analyst.get("analyst_upside_30d") or 0.0)),
        "deep_value": max(0.0, float(analyst.get("analyst_upside_30d") or 0.0) - 0.30),
        "value_x_momentum": max(0.0, float(analyst.get("analyst_upside_30d") or 0.0) - 0.10) * max(0.0, _momentum),
        "overrun_x_neg_momentum": max(0.0, 0.05 - float(analyst.get("analyst_upside_30d") or 0.0)) * abs(min(0.0, _momentum)),
        "spy_momentum_20d": (lambda sn, sp: float((sn/sp)-1.0) if (sn and sp and sp>0) else 0.0)(market_context.get("SPY",{}).get(today_date,{}).get("close"), market_context.get("SPY",{}).get(items[max(0,idx-21)]["date"],{}).get("close") if idx>=21 else None),
        "vix_change_5d": (lambda vn, vp: float((vn/vp)-1.0) if (vn and vp and vp>0) else 0.0)(market_context.get("VIX",{}).get(today_date,{}).get("close"), market_context.get("VIX",{}).get(items[max(0,idx-6)]["date"],{}).get("close") if idx>=6 else None),
        "beta_60d": (lambda sr, mr: float(sum((s-sum(sr)/len(sr))*(m-sum(mr)/len(mr)) for s,m in zip(sr,mr))/len(mr) / max(sum((m-sum(mr)/len(mr))**2 for m in mr)/len(mr),1e-10)) if len(sr)>=20 else 1.0)(
            [float((closes[j]/closes[j-1])-1.0) for j in range(max(1,idx-60),idx) if closes[j-1]>0 and market_context.get("SPY",{}).get(items[j]["date"],{}).get("close") and market_context.get("SPY",{}).get(items[j-1]["date"],{}).get("close")],
            [float((market_context.get("SPY",{}).get(items[j]["date"],{}).get("close",0)/market_context.get("SPY",{}).get(items[j-1]["date"],{}).get("close",1))-1.0) for j in range(max(1,idx-60),idx) if closes[j-1]>0 and market_context.get("SPY",{}).get(items[j]["date"],{}).get("close") and market_context.get("SPY",{}).get(items[j-1]["date"],{}).get("close")]
        ),
        **mkt, **fund, **earn, **analyst,
    }
    # 交互特徵（依賴上面已計算的值）
    _oc = float(result.get("oil_corr_60d",  0.0) or 0.0)
    _gc = float(result.get("gold_corr_60d", 0.0) or 0.0)
    _bc = float(result.get("btc_corr_60d",  0.0) or 0.0)
    _cm = float(result.get("cl_momentum_20d",  0.0) or 0.0)
    _gm = float(result.get("gld_momentum_20d", 0.0) or 0.0)
    _bh = float(result.get("btc_p52w_high", 1.0) or 1.0)
    _rv = float(result.get("rsi", 50.0) or 50.0)
    _es = float(result.get("eps_surprise_pct", 0.0) or 0.0)
    _pv = float(result.get("price_to_52w_high", 1.0) or 1.0)
    _pmv= float(result.get("profit_margin", 0.0) or 0.0)
    _ht = float(result.get("hot_score", 0.0) or 0.0)
    _ne = float(result.get("next_eps_est_vs_prev", 0.0) or 0.0)
    _sv = float(result.get("spy_momentum_20d", 0.0) or 0.0)
    _vs = float(result.get("vol_surge_20_60", 1.0) or 1.0)
    result["oil_bear_signal"]    = max(0.0, _oc - 0.3) * max(0.0, -_cm)
    result["gold_bear_signal"]   = max(0.0, _gc - 0.3) * max(0.0, -_gm)
    result["btc_bear_signal"]    = max(0.0, _bc - 0.3) * max(0.0, 0.85 - _bh)
    result["hot_macro_headwind"] = _ht * max(0.0, -_cm) + _ht * max(0.0, -_sv * 2.0)
    result["rsi_miss_combo"]     = max(0.0, _rv - 65.0) / 35.0 * max(0.0, -_es)
    result["crash_momentum"]     = max(0.0, 0.50 - _pv) * max(0.0, -_momentum)
    result["dead_cat"]           = max(0.0, 0.55 - _pv) * max(0.0, 0.95 - _vs)
    result["loss_miss_signal"]   = max(0.0, -_pmv - 0.02) * max(0.0, -_es)
    result["next_est_decline"]   = max(0.0, -_ne - 0.10)
    _dv = float(result.get("drawdown_depth", 0.0) or 0.0)
    _up = float(result.get("analyst_upside_30d", 0.0) or 0.0)
    result["stale_target_risk"]  = max(0.0, _dv - 0.25) * max(0.0, _up - 0.35)
    _pel = float(result.get("pe_ratio_log", 0.0) or 0.0)
    _bta = float(result.get("beta_60d", 1.0) or 1.0)
    _v20 = float(result.get("volatility_20", 0.0) or 0.0)
    result["hot_valuation_risk"] = max(0.0, _pel - 3.5) * max(0.0, _bta - 1.2) * (1.0 + max(0.0, _vs - 1.0))
    result["crowded_momentum"]   = max(0.0, _v20 - 0.04) * max(0.0, _vs - 1.0) * max(0.0, _bta - 1.0)
    result["falling_knife"]      = max(0.0, 35.0 - _rv) / 35.0 * max(0.0, -_momentum) * max(0.0, 1.0 - _vs) * (1.0 + max(0.0, _bta - 1.5))
    _ttm = _compute_ttm_bt(sym, today_date)
    result["ttm_profit_margin"]  = _ttm["ttm_profit_margin"]
    result["ttm_revenue_yoy"]    = _ttm["ttm_revenue_yoy"]
    return result


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--start",    default="2025-03-01", help="回測起始日（當天排名）")
    parser.add_argument("--hold",     type=int, default=90,  help="持有天數")
    parser.add_argument("--top",      type=int, default=20,  help="看前 N 名")
    parser.add_argument("--horizon",   type=int, default=1)
    parser.add_argument("--train_end", type=str, default=None, help="模型後綴 e.g. 2026-03-01")
    parser.add_argument("--benchmark", default="SPY",         help="比較基準")
    args = parser.parse_args()

    suffix = f"_{args.train_end[:7].replace('-','')}" if args.train_end else ""
    model_path = MODELS_DIR / f"ranker_lambdamart_h{args.horizon}{suffix}.joblib"
    if not model_path.exists():
        print(f"[error] 模型不存在: {model_path}"); return 1

    bundle = joblib.load(model_path)
    ranker = bundle["model"]
    meta   = bundle["metadata"]
    clip_bounds = meta.get("clipBounds", {})
    log_features = {"volume_ratio", "atr_ratio", "avg_volume_20"}

    print(f"[model] LambdaMART  trainEnd={meta['trainEnd']}", flush=True)
    if args.start <= meta["trainEnd"]:
        print(f"[warn]  回測起始日 {args.start} 在訓練資料內（{meta['trainEnd']}），結果可能過度樂觀")

    print(f"[data]  載入歷史資料...", flush=True)
    history_dir = HISTORY_10Y_DIR if HISTORY_10Y_DIR.exists() else HISTORY_1Y_DIR
    # 讀全部資料（不限 lookback，因為要查未來價格）
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

    market_context = load_market_context(history_dir)
    fundamentals   = _load_fundamentals(FUNDAMENTALS_DIR)
    analyst_cache  = load_analyst_cache(ANALYST_DIR)
    from earnings_features import load_earnings_cache
    earnings_cache = load_earnings_cache(EARNINGS_DIR)

    print(f"[data]  {len(all_sym_rows)} 支股票  回測日={args.start}  持有={args.hold}天", flush=True)

    # ── 找最接近 start 的實際交易日 ─────────────────────────────────────
    all_dates_flat = sorted({x["date"] for rows in all_sym_rows.values() for x in rows})
    entry_date = next((d for d in all_dates_flat if d >= args.start), None)
    if not entry_date:
        print(f"[error] 找不到 {args.start} 之後的交易日"); return 1

    # 找 exit 日期（entry + hold 個「日曆日」，再取該日(含)之前最近的交易日）
    # 用日曆日計算，不依賴資料裡有無週末日期（如 BTC），行為才一致穩定。
    from datetime import date as _date, timedelta as _timedelta
    future_dates = [d for d in all_dates_flat if d > entry_date]
    _target_exit = (_date.fromisoformat(entry_date) + _timedelta(days=args.hold)).isoformat()
    _exit_candidates = [d for d in future_dates if d <= _target_exit]
    exit_date = _exit_candidates[-1] if _exit_candidates else (future_dates[-1] if future_dates else entry_date)
    print(f"[backtest] 進場日={entry_date}  出場日={exit_date}  持有={args.hold}日曆日", flush=True)

    # ── 建 features（只用 entry_date 之前的資料）────────────────────────
    print(f"[feat]  計算進場時的 features...", flush=True)
    records = []
    skipped_loss = []
    for sym, items in all_sym_rows.items():
        feat = _build_features_as_of(sym, items, entry_date, market_context,
                                     fundamentals, analyst_cache, earnings_cache)
        if feat:
            # 核心基本面都缺失 → 資料不足，跳過（避免 null→0 造成誤排高位）
            _has_fund = any(feat.get(k) for k in ("profit_margin", "gross_margin", "revenue_growth"))
            _has_earn = any(feat.get(k) for k in ("eps_yoy", "beat_streak", "eps_surprise_pct"))
            if not _has_fund and not _has_earn:
                skipped_loss.append(sym)
                continue
            # 高風險投機股排除（CVNA 類：反覆進榜反覆虧、波動率無法區分）
            if is_speculative_excluded(sym):
                skipped_loss.append(sym)
                continue
            # 安全網：只保留極端案例（模型學不到的邊界情況）
            _p52h = feat.get("price_to_52w_high", 1.0) or 1.0
            _mom20 = feat.get("momentum_20", 0.0) or 0.0
            # 極度崩跌（>65% 跌幅）或 急速崩跌中
            if _p52h < 0.35 or (_p52h < 0.45 and _mom20 < -0.15):
                skipped_loss.append(sym)
                continue
            # 接刀過濾：超賣(RSI<30)+負動能+量縮+高beta（SMCI/HOOD/COIN 型，無量下跌的刀口）
            _rsi_f = feat.get("rsi", 50.0) or 50.0
            _surge_f = feat.get("vol_surge_20_60", 1.0) or 1.0
            _beta_f = feat.get("beta_60d", 1.0) or 1.0
            if _rsi_f < 30 and _mom20 < 0 and _surge_f < 0.90 and _beta_f > 2.5:
                skipped_loss.append(sym)
                continue
            # 測試:淨利率<=0 排除(擋掉虧錢公司,如 CLF/XRAY)
            import os as _os
            if _os.environ.get("FILTER_NEG_MARGIN") == "1":
                _pm = feat.get("profit_margin")
                if isinstance(_pm, (int, float)) and _pm <= 0:
                    skipped_loss.append(sym)
                    continue
            # 當下虧損(最近季EPS<0)且下季預估/指引未轉正 → 排除(INDI類;SNDK已轉正則保留)
            if _os.environ.get("FILTER_LOSS_NO_TURN") == "1":
                _ev = sorted(earnings_cache.get(sym, []), key=lambda e: e.get("available_from", ""))
                _past = [e for e in _ev if e.get("available_from", "") <= entry_date and e.get("actual") is not None]
                _fut = [e for e in _ev if e.get("available_from", "") > entry_date and e.get("estimate") is not None]
                _latest_act = _past[-1]["actual"] if _past else None
                _next_est = _fut[0]["estimate"] if _fut else None
                _guid_up = bool(_fut and _fut[0].get("guidanceUp"))
                if _latest_act is not None and _latest_act < 0:  # 當下虧損
                    _turnaround = (_next_est is not None and _next_est > 0) or _guid_up
                    if not _turnaround:
                        skipped_loss.append(sym)
                        continue
            # 流動性過濾(主力訊號):日成交額過低 + MFI超買 = 薄量散戶froth(INDI類),非主力進駐
            # 大贏家(NVTS/SNDK/MRVL/CRDO)成交額都是數億,不受影響。預設常駐,設 =0 才關閉
            if _os.environ.get("FILTER_THIN_LIQUIDITY", "1") != "0":
                _dollar_vol = (feat.get("avg_volume_20") or 0) * (feat.get("price_entry") or 0)
                _mfi_f = feat.get("mfi", 50.0) or 50.0
                _min_dv = float(_os.environ.get("MIN_DOLLAR_VOL", "50e6"))
                _mfi_hot = float(_os.environ.get("THIN_MFI_HOT", "85"))
                if _dollar_vol < _min_dv and _mfi_f >= _mfi_hot:
                    skipped_loss.append(sym)
                    continue
            # 接刀+分析師滯後過濾(APP類):已回檔 + 分析師仍高上漲空間 + 動能轉負 = 分析師力挺的下跌股
            if _os.environ.get("FILTER_ANALYST_FALLINGKNIFE") == "1":
                _dd  = float(feat.get("drawdown_depth", 0.0) or 0.0)
                _up_f= float(feat.get("analyst_upside_30d", 0.0) or 0.0)
                _mom = float(feat.get("momentum_20", 0.0) or 0.0)
                _dd_th  = float(_os.environ.get("AFK_DRAWDOWN", "0.12"))
                _up_th  = float(_os.environ.get("AFK_UPSIDE", "0.20"))
                if _dd >= _dd_th and _up_f >= _up_th and _mom < 0:
                    skipped_loss.append(sym)
                    continue
            # 熊市刀鋒過濾(事後過濾,不重訓,不做大盤擇時):距52週高回撤>25% 且 價在MA20之下 → 排除
            # 個股站回自己的MA20立即恢復資格 — 比MA200快數月,避開2020 V型反轉「空手看漲」陷阱
            if _os.environ.get("FILTER_BEAR_KNIFE") == "1":
                _p52b = float(feat.get("price_to_52w_high", 1.0) or 1.0)
                _ma20d = float(feat.get("ma20_deviation", 0.0) or 0.0)
                _dd_thb = float(_os.environ.get("BEAR_KNIFE_P52", "0.75"))
                if _p52b < _dd_thb and _ma20d < 0:
                    skipped_loss.append(sym)
                    continue
            records.append(feat)
    if skipped_loss:
        print(f"[filter] 連虧+負利潤過濾: {len(skipped_loss)} 支", flush=True)

    if not records:
        print("[error] 沒有可用 features"); return 1

    df = pd.DataFrame(records)

    print(f"[feat]  有效股票={len(df)}", flush=True)

    # ── 預測排名 ─────────────────────────────────────────────────────────
    # 使用模型自己的特徵列表（支援新舊模型共存）
    model_feature_cols = meta.get("featureNames") or FEATURE_COLS
    X = df[model_feature_cols].fillna(0.0).copy()
    for col, bounds in clip_bounds.items():
        if col not in X.columns: continue
        lo, hi = bounds.get("lo"), bounds.get("hi")
        if lo is not None and hi is not None:
            X[col] = X[col].clip(lower=lo, upper=hi)
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))

    df["rank_score"] = ranker.predict(X)

    # 族群相對強度 re-rank 傾斜(SECTOR_TILT=1 才生效)
    import os as _os2
    if _os2.environ.get("SECTOR_TILT", "1") != "0" and len(df) > 1:
        from sector_momentum import sector_bonus
        _rng = float(df["rank_score"].max() - df["rank_score"].min()) or 1.0
        df["rank_score"] = df.apply(
            lambda r: r["rank_score"] + sector_bonus(r.get("symbol", ""), str(r.get("date", ""))) * _rng, axis=1)

    df_ranked = df.sort_values("rank_score", ascending=False).reset_index(drop=True)
    df_ranked["rank"] = df_ranked.index + 1

    # ── 查真實出場價格 ────────────────────────────────────────────────────
    exit_price_map: dict[str, float] = {}
    for sym, items in all_sym_rows.items():
        future = [x for x in items if x["date"] > entry_date]
        if not future: continue
        # 找最接近 exit_date 的價格
        exit_rows = [x for x in future if x["date"] <= exit_date]
        if exit_rows:
            exit_price_map[sym] = float(exit_rows[-1]["close"])

    df_ranked["price_exit"] = df_ranked["symbol"].map(exit_price_map)
    df_ranked["actual_return"] = (
        (df_ranked["price_exit"] - df_ranked["price_entry"]) / df_ranked["price_entry"]
    )

    # ── 基準報酬（SPY）───────────────────────────────────────────────────
    spy_entry = market_context.get(args.benchmark, {}).get(entry_date, {}).get("close")
    spy_exit_rows = {d: v for d, v in market_context.get(args.benchmark, {}).items() if d <= exit_date and d > entry_date}
    spy_exit = market_context.get(args.benchmark, {}).get(max(spy_exit_rows.keys()), {}).get("close") if spy_exit_rows else None
    benchmark_return = (spy_exit - spy_entry) / spy_entry if spy_entry and spy_exit else None

    # ── 結果輸出 ──────────────────────────────────────────────────────────
    top = df_ranked.head(args.top).copy()
    top_valid = top.dropna(subset=["actual_return"])

    print(f"\n{'='*92}")
    print(f"📊 LambdaMART 回測結果  進場:{entry_date} → 出場:{exit_date}  持有~{args.hold}交易日")
    print(f"{'='*92}")
    print(f"{'#':<4} {'SYM':<8} {'進場價':>8}  {'出場價':>8}  {'實際漲幅':>10}  {'SCORE':>7}  {'RSI':>6}")
    print(f"{'-'*92}")
    for _, row in top.iterrows():
        ret_str = f"{row['actual_return']:>+9.1%}" if pd.notna(row.get("actual_return")) else "   N/A    "
        exit_p  = f"{row['price_exit']:>8.2f}" if pd.notna(row.get("price_exit")) else "     N/A"
        rsi     = row.get("rsi", 50.0)
        print(f"{int(row['rank']):<4} {row['symbol']:<8} {row['price_entry']:>8.2f}  {exit_p}  {ret_str}  {row['rank_score']:>7.4f}  {rsi:>6.1f}")

    if not top_valid.empty:
        avg_ret     = float(top_valid["actual_return"].mean())
        med_ret     = float(top_valid["actual_return"].median())
        # 截尾平均:去掉最高/最低各 10%
        _sorted     = top_valid["actual_return"].sort_values().tolist()
        _k          = int(len(_sorted) * 0.10)
        _core       = _sorted[_k:len(_sorted)-_k] if len(_sorted) - 2*_k > 0 else _sorted
        trim_ret    = sum(_core) / len(_core)
        win_rate    = float((top_valid["actual_return"] > 0).mean())
        beat_bm     = float((top_valid["actual_return"] > (benchmark_return or 0)).mean()) if benchmark_return else None
        max_win     = top_valid.loc[top_valid["actual_return"].idxmax()]
        max_lose    = top_valid.loc[top_valid["actual_return"].idxmin()]

        print(f"\n{'─'*60}")
        print(f"  TOP {args.top} 報酬(三種平均,防止單一異數誤導):")
        print(f"    算術平均：{avg_ret:>+.1%}   中位數：{med_ret:>+.1%}   截尾平均(±10%)：{trim_ret:>+.1%}")
        if benchmark_return is not None:
            print(f"  {args.benchmark} 報酬：     {benchmark_return:>+.1%}  (超額: {avg_ret - benchmark_return:>+.1%})")
        if beat_bm is not None:
            print(f"  跑贏 {args.benchmark} 勝率：  {beat_bm:.0%}")
        print(f"  勝率（>0）：    {win_rate:.0%}  ({int(win_rate*len(top_valid))}/{len(top_valid)})")
        print(f"  最大贏家：      {max_win['symbol']} {max_win['actual_return']:>+.1%}")
        print(f"  最大輸家：      {max_lose['symbol']} {max_lose['actual_return']:>+.1%}")

        # 對比：隨機選20支的報酬
        random_sample = df_ranked.dropna(subset=["actual_return"]).sample(
            min(args.top, len(df_ranked.dropna(subset=["actual_return"]))), random_state=42
        )
        random_avg = float(random_sample["actual_return"].mean())
        print(f"  隨機選{args.top}支平均：{random_avg:>+.1%}  (LambdaMART超越: {avg_ret - random_avg:>+.1%})")

    print(f"\n{'─'*60}")
    print(f"  全部 {len(df_ranked.dropna(subset=['actual_return']))} 支股票平均報酬：{float(df_ranked['actual_return'].mean()):>+.1%}")

    # 查詢指定股票的排名
    watchlist = ["MU", "SNDK", "NVDA", "TSLA", "GOOGL", "AMD", "MRVL", "ALAB", "TSM", "DELL", "IBM"]
    print(f"\n{'─'*60}")
    print(f"  📌 Watchlist 股票排名")
    print(f"  {'SYM':<8} {'排名':>5}  {'進場價':>8}  {'出場價':>8}  {'實際漲幅':>10}  {'SCORE':>7}  {'RSI':>6}")
    print(f"  {'-'*70}")
    for sym in watchlist:
        rows = df_ranked[df_ranked["symbol"] == sym]
        if rows.empty:
            print(f"  {sym:<8}   N/A")
            continue
        row = rows.iloc[0]
        ret_str = f"{row['actual_return']:>+9.1%}" if pd.notna(row.get("actual_return")) else "       N/A"
        exit_p  = f"{row['price_exit']:>8.2f}" if pd.notna(row.get("price_exit")) else "     N/A"
        print(f"  {sym:<8} #{int(row['rank']):<4}  {row['price_entry']:>8.2f}  {exit_p}  {ret_str}  {row['rank_score']:>7.4f}  {row.get('rsi',50):>6.1f}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
