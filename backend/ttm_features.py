"""TTM(近4季滾動)財報特徵 — 解決年度財報落後一年的問題(如SNDK營收爆發)。

策略:季度優先,湊不到4季時 fallback 到年度財報。
這樣每個樣本(不管新舊)都拿到「當下最好的真實財報數字」,
避免「舊樣本=0、新樣本有值」造成的時間性洩漏。
"""
import json
from pathlib import Path

_BASE = Path(__file__).resolve().parent / "data"
_QDIR = _BASE / "fundamentals_quarterly"
_ADIR = _BASE / "fundamentals"

def _load_dir(d):
    cache = {}
    if not d.exists():
        return cache
    for p in d.glob("*.json"):
        try:
            cache[p.stem.upper()] = json.load(open(p))
        except Exception:
            cache[p.stem.upper()] = []
    return cache

def load_quarterly_cache(qdir=None):
    return _load_dir(Path(qdir) if qdir else _QDIR)

def load_annual_cache(adir=None):
    return _load_dir(Path(adir) if adir else _ADIR)

def _annual_fallback(symbol, as_of_date, annual_cache):
    """年度財報 point-in-time fallback。"""
    out = {"ttm_profit_margin": 0.0, "ttm_revenue_yoy": 0.0}
    a = annual_cache.get((symbol or "").upper(), [])
    av = [x for x in a if x.get("available_from", "9") <= as_of_date and x.get("revenue") is not None]
    if not av:
        return out
    av = sorted(av, key=lambda x: x.get("fy_end", ""))
    last = av[-1]
    if last.get("profit_margin") is not None:
        out["ttm_profit_margin"] = last["profit_margin"]
    if last.get("revenue_growth") is not None:
        out["ttm_revenue_yoy"] = last["revenue_growth"]
    return out

def compute_ttm_features(symbol, as_of_date, quarterly_cache, annual_cache=None):
    """回傳 {ttm_profit_margin, ttm_revenue_yoy}。point-in-time:只用 available_from <= as_of。

    季度湊得到4季 → 用 TTM;否則 fallback 年度財報(若提供 annual_cache)。
    """
    q = quarterly_cache.get((symbol or "").upper(), [])
    av = [x for x in q if x.get("available_from", "9") <= as_of_date and x.get("revenue") is not None]
    if len(av) < 4:
        if annual_cache is not None:
            return _annual_fallback(symbol, as_of_date, annual_cache)
        return {"ttm_profit_margin": 0.0, "ttm_revenue_yoy": 0.0}
    out = {"ttm_profit_margin": 0.0, "ttm_revenue_yoy": 0.0}
    av = sorted(av, key=lambda x: x["quarter_end"])
    last4 = av[-4:]
    rev = sum(x["revenue"] for x in last4)
    ni = sum((x.get("net_income") or 0) for x in last4)
    if rev:
        out["ttm_profit_margin"] = ni / rev
        # YoY:最新季 vs 4季前(需>=5季)
        if len(av) >= 5 and av[-5].get("revenue"):
            out["ttm_revenue_yoy"] = av[-1]["revenue"] / av[-5]["revenue"] - 1.0
    elif annual_cache is not None:
        return _annual_fallback(symbol, as_of_date, annual_cache)
    return out
