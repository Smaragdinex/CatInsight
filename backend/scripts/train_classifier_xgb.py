from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix, f1_score
from sklearn.model_selection import TimeSeriesSplit
from xgboost import XGBClassifier

BASE_DIR = Path(__file__).resolve().parent.parent
if str(BASE_DIR) not in sys.path:
    sys.path.insert(0, str(BASE_DIR))

from earnings_features import build_earnings_features, load_earnings_cache
from market_context import get_market_features, load_market_context
from sector_classification import is_cyclical
from ttm_features import load_quarterly_cache, load_annual_cache, compute_ttm_features

_QCACHE = None
_ACACHE = None
def _compute_ttm(symbol, as_of_date):
    global _QCACHE, _ACACHE
    if _QCACHE is None:
        _QCACHE = load_quarterly_cache()
        _ACACHE = load_annual_cache()
    return compute_ttm_features(symbol, as_of_date, _QCACHE, _ACACHE)

HISTORY_10Y_DIR = BASE_DIR / "data" / "history_10y"
HISTORY_1Y_DIR = BASE_DIR / "data" / "history_1y"
FUNDAMENTALS_DIR = BASE_DIR / "data" / "fundamentals"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"
ANALYST_DIR = BASE_DIR / "data" / "analyst_ratings"
MODELS_DIR = BASE_DIR / "models"
ANALYST_WINDOW_DAYS = 30
MODEL_PATH = MODELS_DIR / "action_classifier_xgb.joblib"
LOOKBACK_DAYS = 20
BUY_THRESHOLD = 0.015
AVOID_THRESHOLD = -0.015

# ── Noise preprocessing ──────────────────────────────────────────────────────
# Right-skewed, always >= 0: apply log1p AFTER IQR clipping
_LOG_FEATURES: list[str] = ["volume_ratio", "atr_ratio", "avg_volume_20"]
# Use 3× IQR (wider than textbook 1.5×) to respect fat-tailed financial returns
_IQR_MULT: float = 3.0


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def load_analyst_cache(analyst_dir: Path) -> dict[str, list[dict]]:
    """Load analyst ratings cache: symbol -> list of rating dicts sorted newest first."""
    result: dict[str, list[dict]] = {}
    if not analyst_dir.exists():
        return result
    for path in sorted(analyst_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        symbol = path.stem.upper()
        # Support both old format (list) and new format (dict with 'ratings' key)
        if isinstance(payload, list):
            result[symbol] = payload
        elif isinstance(payload, dict):
            result[symbol] = payload.get("ratings", [])
    return result


def build_analyst_features(
    symbol: str,
    as_of_date: str,
    current_price: float,
    analyst_cache: dict[str, list[dict]],
    window_days: int = ANALYST_WINDOW_DAYS,
) -> dict[str, float]:
    """Return analyst-consensus features using point-in-time ratings as of as_of_date.

    Tries 30-day window first; expands to 90 then 180 days if fewer than 3 ratings found.
    This ensures historical training rows also get meaningful analyst signal.
    """
    default = {
        "analyst_upside_30d": 0.0,
        "analyst_raises_ratio_30d": 0.0,
        "analyst_coverage_30d": 0.0,
        "analyst_target_high_30d": 0.0,
    }
    ratings = analyst_cache.get(symbol.upper(), [])
    if not ratings or current_price <= 0:
        return default

    from datetime import date, timedelta
    try:
        as_of = date.fromisoformat(as_of_date)
    except Exception:
        return default

    # Try 30d window first; expand only up to 90d (not 180/365 — stale targets are misleading)
    recent = []
    for days in (window_days, 90):
        cutoff = (as_of - timedelta(days=days)).isoformat()
        recent = [
            r for r in ratings
            if r.get("GradeDate", "") <= as_of_date
            and r.get("GradeDate", "") >= cutoff
            and r.get("cur") is not None
        ]
        if len(recent) >= 3:
            break

    if not recent:
        return default

    targets = [float(r["cur"]) for r in recent]
    raises = sum(1 for r in recent if r.get("pta") == "Raises")

    mean_target = sum(targets) / len(targets)
    high_target = max(targets)
    upside = (mean_target - current_price) / current_price
    raises_ratio = raises / len(recent)
    coverage = min(float(len(recent)) / 10.0, 1.0)

    return {
        "analyst_upside_30d": float(max(min(upside, 2.0), -1.0)),  # clip [-100%, +200%]
        "analyst_raises_ratio_30d": float(raises_ratio),
        "analyst_coverage_30d": float(coverage),
        "analyst_target_high_30d": float(min((high_target - current_price) / current_price, 3.0)),
    }


def _load_fundamentals(fundamentals_dir: Path) -> dict[str, list[dict]]:
    result: dict[str, list[dict]] = {}
    if not fundamentals_dir.exists():
        return result
    for path in sorted(fundamentals_dir.glob("*.json")):
        symbol = path.stem.upper()
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            result[symbol] = sorted(data, key=lambda x: x["available_from"])
        except Exception:
            pass
    return result


def _get_fundamental_features(fundamentals: dict[str, list[dict]], symbol: str, date: str, price: float) -> dict:
    records = fundamentals.get(symbol, [])
    applicable = [r for r in records if r.get("available_from", "9999") <= date]
    if not applicable:
        return {
            "pe_ratio_log": 0.0,
            "profit_margin": 0.0,
            "gross_margin": 0.0,
            "gross_net_spread": 0.0,
            "eps_growth": 0.0,
            "revenue_growth": 0.0,
            "has_fundamentals": 0.0,
            "log_market_cap": 0.0,
        }
    rec = applicable[-1]
    eps = rec.get("eps")
    pe_log = 0.0
    if eps is not None and eps > 0 and price > 0:
        pe = price / eps
        pe_log = math.log(max(min(pe, 500.0), 1.0)) - math.log(25.0)
    profit_margin = float(rec.get("profit_margin") or 0.0)
    gross_margin = float(rec.get("gross_margin") or 0.0)
    gross_net_spread = gross_margin - profit_margin  # 燒錢幅度：越大說明費用越高
    eps_growth = float(min(max(rec.get("eps_growth") or 0.0, -1.0), 3.0))
    revenue_growth = float(min(max(rec.get("revenue_growth") or 0.0, -0.5), 2.0))
    # 市值估算：股數 ≈ 年淨利 / 年EPS；市值 = 股數 × 當前價
    log_market_cap = 0.0
    net_income = rec.get("net_income")
    if net_income and eps and abs(eps) > 0.01 and price > 0:
        shares_est = abs(float(net_income) / float(eps))
        mkt_cap = shares_est * price
        if mkt_cap > 0:
            log_market_cap = math.log(mkt_cap)
    return {
        "pe_ratio_log": pe_log,
        "profit_margin": profit_margin,
        "gross_margin": gross_margin,
        "gross_net_spread": gross_net_spread,
        "eps_growth": eps_growth,
        "revenue_growth": revenue_growth,
        "has_fundamentals": 1.0,
        "log_market_cap": log_market_cap,
    }


def _load_history_rows_from_dir(history_dir: Path) -> list[dict]:
    rows: list[dict] = []
    if not history_dir.exists():
        return rows
    for path in sorted(history_dir.glob("*.json")):
        try:
            items = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if not isinstance(items, list):
            continue
        for item in items:
            if not isinstance(item, dict):
                continue
            symbol = str(item.get("symbol") or path.stem).upper().strip()
            date = str(item.get("date") or "").strip()
            close = _safe_float(item.get("close"))
            if not symbol or not date or close is None:
                continue
            rows.append({
                "symbol": symbol,
                "date": date,
                "close": close,
                "high": _safe_float(item.get("high")),
                "low": _safe_float(item.get("low")),
                "volume": _safe_float(item.get("volume")),
                "rsi14": _safe_float(item.get("rsi14")),
                "mfi14": _safe_float(item.get("mfi14")),
                "obv": _safe_float(item.get("obv")),
                "macd": _safe_float(item.get("macd")),
                "macdSignal": _safe_float(item.get("macdSignal")),
                "macdHist": _safe_float(item.get("macdHist")),
            })
    return rows


def _calc_rsi(window: pd.Series, period: int = 14) -> float | None:
    if len(window) < period + 1:
        return None
    delta = window.diff().dropna()
    if delta.empty:
        return None
    gain = delta.clip(lower=0).tail(period).mean()
    loss = (-delta.clip(upper=0)).tail(period).mean()
    if loss == 0:
        return 100.0
    rs = gain / loss
    return 100.0 - (100.0 / (1.0 + rs))


def _calc_mfi(high: list[float], low: list[float], close: list[float], volume: list[float], period: int = 14) -> float | None:
    if len(close) < period + 1 or len(high) < period + 1 or len(low) < period + 1 or len(volume) < period + 1:
        return None
    tp = pd.Series([(h + l + c) / 3.0 for h, l, c in zip(high, low, close)])
    vol = pd.Series(volume)
    money_flow = tp * vol
    positive = []
    negative = []
    for i in range(1, len(tp)):
        if tp.iloc[i] > tp.iloc[i - 1]:
            positive.append(float(money_flow.iloc[i]))
            negative.append(0.0)
        elif tp.iloc[i] < tp.iloc[i - 1]:
            positive.append(0.0)
            negative.append(float(money_flow.iloc[i]))
        else:
            positive.append(0.0)
            negative.append(0.0)
    pos_sum = sum(positive[-period:])
    neg_sum = sum(negative[-period:])
    if neg_sum == 0:
        return 100.0
    mfr = pos_sum / neg_sum
    return 100.0 - (100.0 / (1.0 + mfr))


def _commodity_corr(stock_closes: list, dates: list, commodity_by_date: dict, min_points: int = 20) -> float:
    """Rolling correlation between stock and commodity returns over a trailing window."""
    pairs = [(s, commodity_by_date[d]["close"]) for s, d in zip(stock_closes, dates) if d in commodity_by_date and commodity_by_date[d].get("close")]
    if len(pairs) < min_points:
        return 0.0
    s_ret = pd.Series([p[0] for p in pairs]).pct_change().dropna()
    c_ret = pd.Series([p[1] for p in pairs]).pct_change().dropna()
    if len(s_ret) < min_points:
        return 0.0
    try:
        v = float(s_ret.corr(c_ret))
        return v if pd.notna(v) else 0.0
    except Exception:
        return 0.0


def _build_samples(rows: list[dict], market_context: dict[str, dict[str, dict]] | None = None, fundamentals: dict[str, list[dict]] | None = None, analyst_cache: dict[str, list[dict]] | None = None) -> pd.DataFrame:
    grouped: dict[str, list[dict]] = {}
    for row in rows:
        grouped.setdefault(row["symbol"], []).append(row)

    samples: list[dict] = []
    for symbol, items in grouped.items():
        ordered = sorted(items, key=lambda x: x["date"])
        if len(ordered) < LOOKBACK_DAYS + 2:
            continue
        close_by_date = {item["date"]: float(item["close"]) for item in ordered if item.get("date") and item.get("close") is not None}
        closes = [float(x["close"]) for x in ordered]
        highs = [float(x["high"]) if x.get("high") is not None else x["close"] for x in ordered]
        lows = [float(x["low"]) if x.get("low") is not None else x["close"] for x in ordered]
        volumes = [float(x["volume"]) if x.get("volume") is not None else None for x in ordered]
        rsis = [x.get("rsi14") for x in ordered]
        mfis = [x.get("mfi14") for x in ordered]
        obvs = [x.get("obv") for x in ordered]
        macds = [x.get("macd") for x in ordered]
        macd_signals = [x.get("macdSignal") for x in ordered]
        macd_hists = [x.get("macdHist") for x in ordered]

        for idx in range(LOOKBACK_DAYS, len(ordered) - 1):
            window = pd.Series(closes[idx - LOOKBACK_DAYS:idx])
            if window.isna().any():
                continue
            returns = window.pct_change().dropna()
            if len(returns) < 3:
                continue

            current_close = closes[idx - 1]
            next_close = closes[idx]
            if current_close <= 0 or next_close <= 0:
                continue

            vol_window = [v for v in volumes[idx - LOOKBACK_DAYS:idx] if v is not None]
            avg_volume = float(pd.Series(vol_window).mean()) if vol_window else current_close
            volume_ratio = (float(vol_window[-1]) / avg_volume) if vol_window and avg_volume not in (0.0, -0.0) else 1.0
            # 60天平均成交量（用於計算成交量趨勢）
            vol_window_60 = [v for v in volumes[max(0, idx-60):idx] if v is not None]
            avg_volume_60 = float(pd.Series(vol_window_60).mean()) if vol_window_60 else avg_volume
            # 20天 vs 60天成交量比：> 1 = 成交量放大，市場關注增加
            vol_surge_20_60 = float(avg_volume / avg_volume_60) if avg_volume_60 > 0 else 1.0
            target_return = (next_close / current_close) - 1.0
            label = "Buy" if target_return >= BUY_THRESHOLD else "NotBuy"

            ma5 = float(window.tail(5).mean())
            ma20 = float(window.mean())
            rsi = _safe_float(rsis[idx - 1])
            mfi = _safe_float(mfis[idx - 1])
            if rsi is None:
                rsi = _calc_rsi(window)
            if mfi is None:
                mfi = _calc_mfi(highs[idx - LOOKBACK_DAYS:idx], lows[idx - LOOKBACK_DAYS:idx], closes[idx - LOOKBACK_DAYS:idx], [v if v is not None else avg_volume for v in volumes[idx - LOOKBACK_DAYS:idx]])
            ma5_deviation = (current_close / ma5) - 1.0 if ma5 else 0.0
            ma20_deviation = (current_close / ma20) - 1.0 if ma20 else 0.0
            rsi_norm = ((rsi - 50.0) / 50.0) if rsi is not None else 0.0
            mfi_norm = ((mfi - 50.0) / 50.0) if mfi is not None else 0.0
            rsi_delta_1 = (rsi - _calc_rsi(pd.Series(closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]))) if rsi is not None else 0.0
            mfi_prev = _calc_mfi(highs[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], lows[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1], [v if v is not None else avg_volume for v in volumes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]])
            mfi_delta_1 = (mfi - mfi_prev) if (mfi is not None and mfi_prev is not None) else 0.0
            ma5_slope = (ma5 - float(pd.Series(closes[idx - LOOKBACK_DAYS:idx - 1]).tail(5).mean())) if idx - LOOKBACK_DAYS - 1 >= 0 else 0.0
            ma20_slope = (ma20 - float(pd.Series(closes[max(0, idx - LOOKBACK_DAYS - 1):idx - 1]).mean())) if idx - LOOKBACK_DAYS - 1 >= 0 else 0.0
            price_mfi_divergence = ((current_close / max(closes[idx - 2], 1e-9)) - 1.0) - ((mfi_delta_1 or 0.0) / 100.0)
            typical_price = pd.Series([(h + l + c) / 3.0 for h, l, c in zip(highs[idx - LOOKBACK_DAYS:idx], lows[idx - LOOKBACK_DAYS:idx], closes[idx - LOOKBACK_DAYS:idx])])
            vwap = float((typical_price * pd.Series(vol_window if vol_window else [avg_volume] * len(typical_price))).sum() / max(sum(vol_window) if vol_window else avg_volume * len(typical_price), 1e-9))
            vwap_deviation = (current_close / vwap) - 1.0 if vwap else 0.0
            true_ranges = []
            for j in range(max(1, idx - LOOKBACK_DAYS + 1), idx):
                prev_close = closes[j - 1]
                tr = max(highs[j] - lows[j], abs(highs[j] - prev_close), abs(lows[j] - prev_close))
                true_ranges.append(tr)
            atr = float(pd.Series(true_ranges).tail(14).mean()) if true_ranges else 0.0
            atr_ratio = atr / max(current_close, 1e-9)

            obv_now = _safe_float(obvs[idx - 1])
            obv_prev_5 = _safe_float(obvs[idx - 6]) if idx - 6 >= 0 else None
            macd_now = _safe_float(macds[idx - 1])
            macd_signal_now = _safe_float(macd_signals[idx - 1])
            macd_hist_now = _safe_float(macd_hists[idx - 1])
            rsi_prev_3 = _safe_float(rsis[idx - 4]) if idx - 4 >= 0 else None
            mfi_prev_3 = _safe_float(mfis[idx - 4]) if idx - 4 >= 0 else None
            macd_hist_prev_3 = _safe_float(macd_hists[idx - 4]) if idx - 4 >= 0 else None
            market_features = get_market_features(market_context or {}, ordered[idx - 1]["date"])
            spy_close = market_context.get("SPY", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            soxx_close = market_context.get("SOXX", {}).get(ordered[idx - 1]["date"], {}).get("close") if market_context else None
            fundamental_features = _get_fundamental_features(fundamentals or {}, symbol, ordered[idx - 1]["date"], current_close)
            earnings_features = build_earnings_features(symbol, ordered[idx - 1]["date"], close_by_date, _get_earnings_cache(), current_price=current_close)
            analyst_features = build_analyst_features(symbol, ordered[idx - 1]["date"], current_close, analyst_cache or {})

            sample = {
                "symbol": symbol,
                "lag_1_return": float(returns.iloc[-1]),
                "lag_2_return": float(returns.iloc[-2]) if len(returns) >= 2 else float(returns.iloc[-1]),
                "lag_3_return": float(returns.iloc[-3]) if len(returns) >= 3 else float(returns.iloc[-1]),
                "mean_return_5": float(returns.tail(5).mean()),
                "mean_return_20": float(returns.mean()),
                "volatility_20": float(returns.std(ddof=0) or 0.0),
                "momentum_20": float((window.iloc[-1] / window.iloc[0]) - 1.0),
                "avg_volume_20": avg_volume,
                "volume_ratio": volume_ratio,
                "range_ratio": float((max(highs[idx - LOOKBACK_DAYS:idx]) - min(lows[idx - LOOKBACK_DAYS:idx])) / max(current_close, 1e-9)),
                "rsi": rsi if rsi is not None else 50.0,
                "mfi": mfi if mfi is not None else 50.0,
                "rsi_norm": rsi_norm,
                "mfi_norm": mfi_norm,
                "rsi_change_3d": (rsi - rsi_prev_3) if rsi is not None and rsi_prev_3 is not None else 0.0,
                "mfi_change_3d": (mfi - mfi_prev_3) if mfi is not None and mfi_prev_3 is not None else 0.0,
                "ma5_deviation": ma5_deviation,
                "ma20_deviation": ma20_deviation,
                "rsi_delta_1": rsi_delta_1,
                "mfi_delta_1": mfi_delta_1,
                "ma5_slope": ma5_slope,
                "ma20_slope": ma20_slope,
                "vwap_deviation": vwap_deviation,
                "price_mfi_divergence": price_mfi_divergence,
                "atr_ratio": atr_ratio,
                "obv_change_5": ((obv_now - obv_prev_5) / abs(obv_prev_5)) if obv_now is not None and obv_prev_5 not in (None, 0.0, -0.0) else 0.0,
                # Normalise MACD by price so the same signal is comparable across
                # stocks with very different price levels (e.g. NVDA vs INTC).
                "macd": (macd_now / max(current_close, 1e-9)) if macd_now is not None else 0.0,
                "macdSignal": (macd_signal_now / max(current_close, 1e-9)) if macd_signal_now is not None else 0.0,
                "macdHist": (macd_hist_now / max(current_close, 1e-9)) if macd_hist_now is not None else 0.0,
                "macdHist_change_3d": ((macd_hist_now - macd_hist_prev_3) / max(current_close, 1e-9)) if macd_hist_now is not None and macd_hist_prev_3 is not None else 0.0,
                "relative_strength_spy": (current_close / spy_close) if spy_close not in (None, 0.0, -0.0) else 1.0,
                "relative_strength_soxx": (current_close / soxx_close) if soxx_close not in (None, 0.0, -0.0) else 1.0,
                "target_next_return": target_return,
                "label": label,
                **market_features,
                **fundamental_features,
                **earnings_features,
                **analyst_features,
            }
            prev_date_3 = ordered[idx - 4]["date"] if idx - 4 >= 0 else None
            spy_close_prev_3 = market_context.get("SPY", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            soxx_close_prev_3 = market_context.get("SOXX", {}).get(prev_date_3, {}).get("close") if market_context and prev_date_3 else None
            rs_spy_prev_3 = (closes[idx - 4] / spy_close_prev_3) if idx - 4 >= 0 and spy_close_prev_3 not in (None, 0.0, -0.0) else None
            rs_soxx_prev_3 = (closes[idx - 4] / soxx_close_prev_3) if idx - 4 >= 0 and soxx_close_prev_3 not in (None, 0.0, -0.0) else None
            sample["relative_strength_spy_change_3d"] = (sample["relative_strength_spy"] - rs_spy_prev_3) if rs_spy_prev_3 is not None else 0.0
            sample["relative_strength_soxx_change_3d"] = (sample["relative_strength_soxx"] - rs_soxx_prev_3) if rs_soxx_prev_3 is not None else 0.0
            # 52-week high ratio: current price vs max close over last 252 trading days
            w52_window = closes[max(0, idx - 252):idx]
            w52_high = max(w52_window)
            w52_low  = min(w52_window)
            sample["price_to_52w_high"] = current_close / w52_high if w52_high > 0 else 1.0
            sample["price_to_52w_low"]  = current_close / w52_low  if w52_low  > 0 else 1.0
            # EPS 成長 vs 股價動能背離：正值 = 股價被低估（EPS 回升但價格未反應）
            # 分析師調升 × 動能交互特徵：正值 = 有人調升且在上升趨勢
            _raises = analyst_features.get("analyst_raises_ratio_30d") or 0.0
            sample["analyst_raises_x_momentum"] = float(_raises) * float((window.iloc[-1] / window.iloc[0]) - 1.0)

            _eps_yoy_raw = sample.get("eps_yoy") or earnings_features.get("eps_yoy")
            _momentum = float((window.iloc[-1] / window.iloc[0]) - 1.0)
            if _eps_yoy_raw:
                sample["eps_price_divergence"] = float(_eps_yoy_raw) - _momentum
            else:
                # 無 EPS 數據（新股）→ 改用分析師目標價 upside 替代
                _analyst_upside = analyst_features.get("analyst_upside_30d") or 0.0
                sample["eps_price_divergence"] = float(_analyst_upside) - _momentum if _analyst_upside else 0.0

            # 分析師滯後特徵：EPS 強但分析師還沒跟上 = 潛力窗口
            _eps_yoy_val = float(_eps_yoy_raw) if _eps_yoy_raw else 0.0
            sample["eps_analyst_lag"] = _eps_yoy_val * (1.0 - float(_raises))

            # 估值成長特徵：EPS 成長 / 估值 = 便宜高成長
            _ptfv = float(sample.get("price_to_fair_value") or earnings_features.get("price_to_fair_value") or 1.0)
            sample["value_growth"] = _eps_yoy_val / max(abs(_ptfv), 0.1)

            # 虧損深度：連續虧損季數 × 虧損幅度，越大越危險
            _consec = float(earnings_features.get("consecutive_neg_eps") or 0.0)
            _margin = float(sample.get("profit_margin") or fundamental_features.get("profit_margin") or 0.0)
            sample["loss_depth"] = _consec * max(0.0, -_margin)

            # EPS 成長品質：兩個都正才是真回升；負利潤公司永遠懲罰（防止負×負=正的 bug）
            if _margin >= 0:
                sample["quality_eps_growth"] = _eps_yoy_val * _margin
            else:
                sample["quality_eps_growth"] = -abs(_eps_yoy_val) * abs(_margin)

            # 動能 × 分析師滯後：動能崩潰時 eps_lag 反而是陷阱
            sample["momentum_x_eps_lag"] = _momentum * sample["eps_analyst_lag"]

            # 崩跌且無人支撐：動能 < -15% 且分析師無調升 → 強烈下跌訊號
            sample["crash_no_support"] = 1.0 if _momentum < -0.15 and float(_raises) == 0.0 else 0.0

            # 財報連勝品質：連勝但利潤率為負 = 假繁榮（BAX/CSGP）
            _beat = float(sample.get("beat_streak") or 0.0)
            sample["beat_streak_quality"] = _beat * _margin

            # 收入成長品質：成長但利潤率接近零 = 不值錢的成長（CSGP）
            _rev_growth = float(fundamental_features.get("revenue_growth") or 0.0)
            sample["revenue_growth_x_margin"] = _rev_growth * _margin

            # PE × 動能：高PE + 動能轉弱 = 估值壓縮風險（INTU）
            _pe_log = float(fundamental_features.get("pe_ratio_log") or 0.0)
            sample["pe_momentum"] = _pe_log * _momentum

            # 商品相關性：60 天滾動相關係數，讓模型識別黃金/石油代理股
            _corr_window = 60
            _corr_start = max(0, idx - _corr_window)
            _stock_cls = closes[_corr_start:idx]
            _dates_w = [ordered[j]["date"] for j in range(_corr_start, idx)]
            sample["gold_corr_60d"] = _commodity_corr(_stock_cls, _dates_w, (market_context or {}).get("GLD", {}))
            sample["oil_corr_60d"] = _commodity_corr(_stock_cls, _dates_w, (market_context or {}).get("CL", {}))
            sample["btc_corr_60d"] = _commodity_corr(_stock_cls, _dates_w, (market_context or {}).get("BTC", {}))

            # 大幅 miss 財報：miss > 10% = 強烈負面訊號（TPL miss -50.2%）
            _eps_surp = float(sample.get("eps_surprise_pct") or earnings_features.get("eps_surprise_pct") or 0.0)
            sample["eps_miss"] = 1.0 if _eps_surp < -0.10 else 0.0

            # 商品動能：GLD/CL 的 20 天報酬（讓模型知道黃金/石油現在漲跌）
            _gld_by_date = (market_context or {}).get("GLD", {})
            _cl_by_date  = (market_context or {}).get("CL", {})
            _cur_date = ordered[idx - 1]["date"]
            _prev_date_20 = ordered[max(0, idx - 21)]["date"]
            _gld_now  = _gld_by_date.get(_cur_date, {}).get("close")
            _gld_prev = _gld_by_date.get(_prev_date_20, {}).get("close")
            _cl_now   = _cl_by_date.get(_cur_date, {}).get("close")
            _cl_prev  = _cl_by_date.get(_prev_date_20, {}).get("close")
            sample["gld_momentum_20d"] = float((_gld_now / _gld_prev) - 1.0) if (_gld_now and _gld_prev and _gld_prev > 0) else 0.0
            sample["cl_momentum_20d"]  = float((_cl_now  / _cl_prev)  - 1.0) if (_cl_now  and _cl_prev  and _cl_prev  > 0) else 0.0
            _btc_by_date = (market_context or {}).get("BTC", {})
            _btc_now  = _btc_by_date.get(_cur_date, {}).get("close")
            _btc_prev = _btc_by_date.get(_prev_date_20, {}).get("close")
            sample["btc_momentum_20d"] = float((_btc_now / _btc_prev) - 1.0) if (_btc_now and _btc_prev and _btc_prev > 0) else 0.0
            _btc_52h = max((_btc_by_date.get(ordered[j]["date"], {}).get("close") or 0) for j in range(max(0, idx-252), idx)) if idx > 0 else 0
            sample["btc_p52w_high"] = float(_btc_now / _btc_52h) if (_btc_now and _btc_52h and _btc_52h > 0) else 1.0

            # 市場整體動能：SPY 20天報酬（負值 = 市場下跌趨勢）
            _spy_by_date = (market_context or {}).get("SPY", {})
            _spy_now  = _spy_by_date.get(_cur_date, {}).get("close")
            _spy_prev20 = _spy_by_date.get(_prev_date_20, {}).get("close")
            sample["spy_momentum_20d"] = float((_spy_now / _spy_prev20) - 1.0) if (_spy_now and _spy_prev20 and _spy_prev20 > 0) else 0.0

            # VIX 5天變化：VIX 急升 = 恐慌湧入，股票預期下跌
            _vix_by_date = (market_context or {}).get("VIX", {})
            _prev_date_5 = ordered[max(0, idx - 6)]["date"]
            _vix_now  = _vix_by_date.get(_cur_date, {}).get("close")
            _vix_prev5 = _vix_by_date.get(_prev_date_5, {}).get("close")
            sample["vix_change_5d"] = float((_vix_now / _vix_prev5) - 1.0) if (_vix_now and _vix_prev5 and _vix_prev5 > 0) else 0.0

            # Beta 60天：個股對 SPY 的敏感度（高 beta = 市場跌時跌更多）
            _spy_rets = []
            _stk_rets = []
            for _bi in range(max(1, idx - 60), idx):
                _sd = ordered[_bi]["date"]
                _sd_prev = ordered[_bi - 1]["date"]
                _spy_c  = _spy_by_date.get(_sd, {}).get("close")
                _spy_cp = _spy_by_date.get(_sd_prev, {}).get("close")
                _stk_c  = closes[_bi]
                _stk_cp = closes[_bi - 1]
                if _spy_c and _spy_cp and _spy_cp > 0 and _stk_cp > 0:
                    _spy_rets.append((_spy_c / _spy_cp) - 1.0)
                    _stk_rets.append((_stk_c / _stk_cp) - 1.0)
            if len(_spy_rets) >= 20:
                import statistics
                _cov = sum((s - sum(_stk_rets)/len(_stk_rets)) * (m - sum(_spy_rets)/len(_spy_rets)) for s, m in zip(_stk_rets, _spy_rets)) / len(_spy_rets)
                _var_spy = sum((m - sum(_spy_rets)/len(_spy_rets))**2 for m in _spy_rets) / len(_spy_rets)
                sample["beta_60d"] = float(_cov / _var_spy) if _var_spy > 1e-10 else 1.0
            else:
                sample["beta_60d"] = 1.0

            # beat_streak × 動能：beat 多但股價在跌 = 好消息已 price in（INTU 陷阱）
            sample["beat_streak_x_momentum"] = float(_beat) * _momentum

            # 負利潤 × 財報大幅 miss：替代原本的硬過濾，讓 ML 自己學懲罰強度
            sample["neg_margin_x_miss"] = max(-_margin, 0.0) * sample["eps_miss"]

            # 連續虧損嚴重度：連虧季數（ML 已有 consecutive_neg_eps，再加平方強化非線性）
            sample["consec_loss_sq"] = float(_consec) ** 2

            # 崩跌深度特徵：距52週高點越遠，風險越高（TTD 類）
            _p52h_val = sample.get("price_to_52w_high", 1.0) or 1.0
            sample["drawdown_depth"] = max(0.0, 1.0 - float(_p52h_val))

            # 低毛利率懲罰：毛利 < 30% 是結構性風險（CVNA 類）
            _gross_val = float((fundamental_features or {}).get("gross_margin") or 1.0)
            sample["low_gross_margin"] = max(0.0, 0.30 - _gross_val)

            # 崩跌 × 動能：深度崩跌 + 動能繼續跌 = 最危險組合
            sample["drawdown_x_momentum"] = sample["drawdown_depth"] * min(0.0, _momentum)

            # 市場熱度特徵
            # 10天動能（短期）
            _mom10 = float((window.iloc[-1] / window.iloc[-11]) - 1.0) if len(window) >= 11 else _momentum
            # 動能加速度：10天動能 - 20天動能，正值 = 近期加速上漲
            sample["momentum_accel"] = _mom10 - _momentum
            # 成交量放大：20天 vs 60天，> 0 = 成交量在增加
            sample["vol_surge_20_60"] = float(min(vol_surge_20_60, 3.0))
            # 熱度分數：成交量放大 × 上漲動能（兩者都正才是真熱門）
            sample["hot_score"] = float(vol_surge_20_60) * max(0.0, _momentum)
            # 冷門懲罰：成交量萎縮 × 動能弱（GDDY 類：沒人追的股票）
            sample["cold_penalty"] = max(0.0, 1.0 - vol_surge_20_60) * max(0.0, -_momentum + 0.05)
            # 動能加速 × 成交量放大（最強買入訊號）
            sample["accel_x_volume"] = max(0.0, sample["momentum_accel"]) * max(0.0, vol_surge_20_60 - 1.0)

            # 狗與主人理論特徵
            _upside = float(analyst_features.get("analyst_upside_30d") or 0.0)
            # 股價跑太快（upside < 5%）= 狗跑過頭，回調風險高
            sample["overrun_risk"] = max(0.0, 0.05 - _upside)
            # 嚴重低估（upside > 30%）= 主人在等，反彈潛力大
            sample["deep_value"] = max(0.0, _upside - 0.30)
            # 低估 × 動能轉正 = 最佳買點（主人等到狗回來）
            sample["value_x_momentum"] = max(0.0, _upside - 0.10) * max(0.0, _momentum)
            # 高估 × 動能轉負 = 最危險（狗跑太快 + 開始往回跑）
            sample["overrun_x_neg_momentum"] = sample["overrun_risk"] * abs(min(0.0, _momentum))
            # 目標價過時風險：大跌（drawdown>30%）+ 分析師 upside 虛高（>40%）= 分析師未更新目標，假性低估（INTU 類）
            _drawdown_v = float(sample.get("drawdown_depth", 0.0) or 0.0)
            sample["stale_target_risk"] = max(0.0, _drawdown_v - 0.25) * max(0.0, _upside - 0.35)

            # ── 讓模型學習 Hard Filter 邏輯的交互特徵 ────────────────────────────
            _oil_c  = float(sample.get("oil_corr_60d",  0.0) or 0.0)
            _gld_c  = float(sample.get("gold_corr_60d", 0.0) or 0.0)
            _btc_c  = float(sample.get("btc_corr_60d",  0.0) or 0.0)
            _cl_m   = float(sample.get("cl_momentum_20d",  0.0) or 0.0)
            _gld_m  = float(sample.get("gld_momentum_20d", 0.0) or 0.0)
            _btc_h  = float(sample.get("btc_p52w_high", 1.0) or 1.0)
            _rsi_v  = float(sample.get("rsi", 50.0) or 50.0)
            _eps_s  = float(sample.get("eps_surprise_pct", 0.0) or 0.0)
            _p52h_v = float(sample.get("price_to_52w_high", 1.0) or 1.0)
            _pm_v   = float(sample.get("profit_margin", 0.0) or 0.0)
            _surp_v = float(sample.get("vol_surge_20_60", 1.0) or 1.0)
            _hot    = float(sample.get("hot_score", 0.0) or 0.0)
            _nxt_e  = float(sample.get("next_eps_est_vs_prev", 0.0) or 0.0)
            # 商品相關股在商品下跌時的風險信號
            sample["oil_bear_signal"]   = max(0.0, _oil_c - 0.3) * max(0.0, -_cl_m)
            sample["gold_bear_signal"]  = max(0.0, _gld_c - 0.3) * max(0.0, -_gld_m)
            sample["btc_bear_signal"]   = max(0.0, _btc_c - 0.3) * max(0.0, 0.85 - _btc_h)
            # 熱股 + 商品下跌 = APA/OXY 類型風險（即使 corr 低也能捕捉）
            sample["hot_macro_headwind"] = _hot * max(0.0, -_cl_m) + _hot * max(0.0, -float(sample.get("spy_momentum_20d", 0.0) or 0.0) * 2.0)
            # RSI 過買 + 財報 miss
            sample["rsi_miss_combo"]    = max(0.0, _rsi_v - 65.0) / 35.0 * max(0.0, -_eps_s)
            # 深度崩跌 × 負動能（極端下跌趨勢）
            sample["crash_momentum"]    = max(0.0, 0.50 - _p52h_v) * max(0.0, -_momentum)
            # 深跌 × 量縮（死貓彈信號）
            sample["dead_cat"]          = max(0.0, 0.55 - _p52h_v) * max(0.0, 0.95 - _surp_v)
            # 虧損 × miss（連續虧損的惡化）
            sample["loss_miss_signal"]  = max(0.0, -_pm_v - 0.02) * max(0.0, -_eps_s)
            # 下季預估大幅下調（直接風險信號）
            sample["next_est_decline"]  = max(0.0, -_nxt_e - 0.10)
            # 高估值 + 高波動 + 量爆 = 擁擠的情緒動能股（CVNA 類，大起大落）
            _pe_log_v = float(sample.get("pe_ratio_log", 0.0) or 0.0)
            _beta_v   = float(sample.get("beta_60d", 1.0) or 1.0)
            _vol20_v  = float(sample.get("volatility_20", 0.0) or 0.0)
            sample["hot_valuation_risk"] = (
                max(0.0, _pe_log_v - 3.5)        # PE > ~33（log>3.5）才算高估值
                * max(0.0, _beta_v - 1.2)        # beta > 1.2 才算高波動
                * (1.0 + max(0.0, _surp_v - 1.0))  # 量爆放大風險
            )
            sample["crowded_momentum"] = max(0.0, _vol20_v - 0.04) * max(0.0, _surp_v - 1.0) * max(0.0, _beta_v - 1.0)
            # 接刀風險：超賣(RSI<35) + 負動能 + 量縮(無人承接) + 高beta放大（HOOD 類，未腰斬就漏掉的下跌刀口）
            sample["falling_knife"] = (
                max(0.0, 35.0 - _rsi_v) / 35.0     # RSI 越低越超賣
                * max(0.0, -_momentum)              # 負動能
                * max(0.0, 1.0 - _surp_v)           # 量縮（vol_surge<1 = 沒人接）
                * (1.0 + max(0.0, _beta_v - 1.5))   # 高 beta 放大崩跌風險
            )

            # date is NOT a training feature but is needed for time-split eval
            sample["date"] = ordered[idx - 1]["date"]
            # TTM(近4季滾動)財報特徵:解決年度財報落後(如SNDK營收爆發+251%但年報只+10%)
            _ttm = _compute_ttm(symbol, sample["date"])
            sample["ttm_profit_margin"] = _ttm["ttm_profit_margin"]
            sample["ttm_revenue_yoy"] = _ttm["ttm_revenue_yoy"]
            samples.append(sample)
    return pd.DataFrame(samples)


_EARNINGS_CACHE: dict[str, list[dict]] | None = None


def _apply_noise_preprocessing(
    X_train: pd.DataFrame,
    X_test: pd.DataFrame,
) -> tuple[pd.DataFrame, pd.DataFrame, dict]:
    """
    Step 1 – IQR clip: compute [Q1 - k*IQR, Q3 + k*IQR] bounds on *training*
              data only, then apply to both sets (no lookahead).
    Step 2 – log1p: transform right-skewed positive features so extreme
              spikes (e.g. 20× volume days) don't dominate splits.

    Returns (X_train_clean, X_test_clean, clip_bounds)
    where clip_bounds = {col: {"lo": float, "hi": float}} – persisted in
    the model bundle so inference can apply the same transform.
    """
    clip_bounds: dict[str, dict] = {}
    X_train = X_train.copy()
    X_test = X_test.copy()

    for col in X_train.columns:
        q1 = float(X_train[col].quantile(0.25))
        q3 = float(X_train[col].quantile(0.75))
        iqr = q3 - q1
        if iqr < 1e-9:
            # Sparse / near-constant feature (e.g. has_fundamentals, guidance_up).
            # IQR ≈ 0 means clipping to [lo, hi] = [0, 0] would destroy the signal.
            # Record a no-op sentinel so inference knows no clipping is needed.
            clip_bounds[col] = {"lo": None, "hi": None}
            continue
        lo = q1 - _IQR_MULT * iqr
        hi = q3 + _IQR_MULT * iqr
        clip_bounds[col] = {"lo": round(lo, 8), "hi": round(hi, 8)}
        X_train[col] = X_train[col].clip(lower=lo, upper=hi)
        X_test[col] = X_test[col].clip(lower=lo, upper=hi)

    for col in _LOG_FEATURES:
        if col in X_train.columns:
            X_train[col] = np.log1p(X_train[col].clip(lower=0))
            X_test[col] = np.log1p(X_test[col].clip(lower=0))

    return X_train, X_test, clip_bounds


def _get_earnings_cache() -> dict[str, list[dict]]:
    global _EARNINGS_CACHE
    if _EARNINGS_CACHE is not None:
        return _EARNINGS_CACHE
    _EARNINGS_CACHE = load_earnings_cache(EARNINGS_DIR)
    return _EARNINGS_CACHE


def main() -> int:
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    market_context = load_market_context(HISTORY_10Y_DIR)
    fundamentals = _load_fundamentals(FUNDAMENTALS_DIR)
    rows = _load_history_rows_from_dir(HISTORY_10Y_DIR)
    source_dir = HISTORY_10Y_DIR
    if not rows:
        rows = _load_history_rows_from_dir(HISTORY_1Y_DIR)
        source_dir = HISTORY_1Y_DIR
    if not rows:
        print(json.dumps({"error": "No history data found"}, ensure_ascii=False, indent=2))
        return 1

    analyst_cache = load_analyst_cache(ANALYST_DIR)
    df = _build_samples(rows, market_context=market_context, fundamentals=fundamentals, analyst_cache=analyst_cache)
    if df.empty:
        print(json.dumps({"error": "No usable classifier samples found"}, ensure_ascii=False, indent=2))
        return 1

    feature_cols = [
        "lag_1_return",
        "lag_2_return",
        "lag_3_return",
        "mean_return_5",
        "mean_return_20",
        "volatility_20",
        "momentum_20",
        "avg_volume_20",
        "volume_ratio",
        "range_ratio",
        "rsi",
        "mfi",
        "rsi_norm",
        "mfi_norm",
        "rsi_change_3d",
        "mfi_change_3d",
        "ma5_deviation",
        "ma20_deviation",
        "rsi_delta_1",
        "mfi_delta_1",
        "ma5_slope",
        "ma20_slope",
        "vwap_deviation",
        "atr_ratio",
        "price_mfi_divergence",
        "obv_change_5",
        "macd",
        "macdSignal",
        "macdHist",
        "macdHist_change_3d",
        "relative_strength_spy",
        "relative_strength_soxx",
        "relative_strength_spy_change_3d",
        "relative_strength_soxx_change_3d",
        "spy_return1d",
        "qqq_return1d",
        "soxx_return1d",
        "vix_change1d",
        "spy_rsi14",
        "qqq_rsi14",
        "soxx_rsi14",
        "vix_rsi14",
        "spy_macdHist",
        "qqq_macdHist",
        "soxx_macdHist",
        "vix_macdHist",
        "vix_level",
        "pe_ratio_log",
        "profit_margin",
        "eps_growth",
        "revenue_growth",
        "has_fundamentals",
        "eps_surprise_pct",
        "revenue_surprise_pct",
        "earnings_beat",
        "guidance_up",
        "post_earnings_gap_pct",
        "analyst_upside_30d",
        "analyst_raises_ratio_30d",
        "analyst_coverage_30d",
        "analyst_target_high_30d",
        "eps_qoq",
        "eps_yoy",
        "eps_accel",
        "beat_streak",
    ]
    X = df[feature_cols].fillna(0.0)
    y = df["label"]
    label_map = {"NotBuy": 0, "Buy": 1}
    inv_label_map = {v: k for k, v in label_map.items()}
    y_enc = y.map(label_map)

    # ── TimeSeriesSplit 5-fold Cross Validation ───────────────────────────
    # 時間序列不能隨機切割（未來資料不能洩漏給訓練集），所以用 TimeSeriesSplit
    # 而非 StratifiedKFold。每個 fold 都是「前面訓練 → 後面測試」。
    print("\n[cross_val] TimeSeriesSplit 5-fold CV ...", flush=True)
    X_cv = df[feature_cols].fillna(0.0).values
    y_cv = df["label"].map(label_map).values
    # Sort by date so folds respect time order
    date_order = df["date"].argsort().values
    X_cv = X_cv[date_order]
    y_cv = y_cv[date_order]

    tscv = TimeSeriesSplit(n_splits=5)
    cv_f1_scores: list[float] = []
    cv_acc_scores: list[float] = []
    clf_cv = XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=4,
    )
    for fold_i, (tr_idx, te_idx) in enumerate(tscv.split(X_cv), 1):
        clf_cv.fit(X_cv[tr_idx], y_cv[tr_idx])
        y_fold_pred = clf_cv.predict(X_cv[te_idx])
        fold_f1  = f1_score(y_cv[te_idx], y_fold_pred, average="macro", zero_division=0)
        fold_acc = accuracy_score(y_cv[te_idx], y_fold_pred)
        cv_f1_scores.append(fold_f1)
        cv_acc_scores.append(fold_acc)
        print(f"  Fold {fold_i}: F1={fold_f1:.4f}  Acc={fold_acc:.4f}  "
              f"(train={len(tr_idx)}, test={len(te_idx)})", flush=True)

    cv_f1_mean  = float(sum(cv_f1_scores) / len(cv_f1_scores))
    cv_f1_std   = float((sum((s - cv_f1_mean) ** 2 for s in cv_f1_scores) / len(cv_f1_scores)) ** 0.5)
    cv_acc_mean = float(sum(cv_acc_scores) / len(cv_acc_scores))
    print(f"[cross_val] F1 = {cv_f1_mean:.4f} ± {cv_f1_std:.4f}  |  Acc = {cv_acc_mean:.4f}", flush=True)

    # ── Time-split (date-based, with embargo) ─────────────────────────────
    # Random split leaks future dates into training (mixed 2014-2026 samples).
    # Date-based split ensures the model is evaluated on genuinely unseen future.
    TRAIN_RATIO = 0.80
    EMBARGO_DAYS = 20  # trading days between train end and test start

    all_dates = sorted(df["date"].unique())
    n_dates = len(all_dates)
    split_date_idx = int(n_dates * TRAIN_RATIO)
    train_end_date = all_dates[split_date_idx - 1]
    test_start_date = all_dates[min(split_date_idx + EMBARGO_DAYS, n_dates - 1)]

    df_train_full = df[df["date"] <= train_end_date]
    df_test_full  = df[df["date"] >= test_start_date]

    X_train = df_train_full[feature_cols].fillna(0.0)
    y_train = df_train_full["label"].map(label_map)
    X_test  = df_test_full[feature_cols].fillna(0.0)
    y_test  = df_test_full["label"].map(label_map)
    print(f"[timesplit] train end: {train_end_date}  test start: {test_start_date}", flush=True)
    print(f"[timesplit] trainRows: {len(X_train)}  testRows: {len(X_test)}", flush=True)

    # ── Noise preprocessing (IQR clip + log1p) ────────────────────────────
    X_train, X_test, clip_bounds = _apply_noise_preprocessing(X_train, X_test)
    print(f"[noise] IQR clip + log1p applied to {len(clip_bounds)} features "
          f"(log1p: {_LOG_FEATURES})", flush=True)

    clf = XGBClassifier(
        n_estimators=400,
        max_depth=6,
        learning_rate=0.05,
        subsample=0.9,
        colsample_bytree=0.8,
        objective="binary:logistic",
        eval_metric="logloss",
        random_state=42,
        n_jobs=4,
    )
    clf.fit(X_train, y_train)
    y_pred = clf.predict(X_test)

    y_test_labels = y_test.map(inv_label_map)
    y_pred_labels = pd.Series(y_pred).map(inv_label_map)

    acc = accuracy_score(y_test_labels, y_pred_labels)
    f1 = f1_score(y_test_labels, y_pred_labels, average="macro")
    cm = confusion_matrix(y_test_labels, y_pred_labels, labels=["Buy", "NotBuy"]).tolist()
    report = classification_report(y_test_labels, y_pred_labels, output_dict=True, zero_division=0)

    payload = {
        "featureNames": feature_cols,
        "modelType": "XGBClassifier-Binary",
        "lookbackDays": LOOKBACK_DAYS,
        "buyThreshold": BUY_THRESHOLD,
        "sampleRows": int(len(df)),
        "trainRows": int(len(X_train)),
        "testRows": int(len(X_test)),
        "trainEnd": str(train_end_date),
        "testStart": str(test_start_date),
        "accuracy": round(float(acc), 6),
        "f1Macro": round(float(f1), 6),
        "confusionMatrix": cm,
        "classificationReport": report,
        "crossValidation": {
            "method": "TimeSeriesSplit",
            "nSplits": 5,
            "f1MacroMean": round(cv_f1_mean, 6),
            "f1MacroStd": round(cv_f1_std, 6),
            "accMean": round(cv_acc_mean, 6),
            "foldF1": [round(s, 6) for s in cv_f1_scores],
            "foldAcc": [round(s, 6) for s in cv_acc_scores],
        },
        "sourceDir": str(source_dir),
        # Noise-preprocessing params – applied at inference time in main.py
        "clipBounds": clip_bounds,
        "logFeatures": _LOG_FEATURES,
    }

    joblib.dump({"model": clf, "metadata": payload, "labelMap": label_map}, MODEL_PATH)
    print(json.dumps({"savedModel": str(MODEL_PATH), "metrics": payload}, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
