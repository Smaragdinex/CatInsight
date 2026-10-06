"""
⚠️ 已測試並淘汰，未在正式 pipeline 使用（保留作記錄）。

嚴格全歷史驗證（2017-2026, 2229交易日）結果：此開關（及所有測過的領先/落後
變體 50/200、跌破50MA、20天動能、破200MA、VIX突升）空手期間 SPY 未來60天
平均報酬都是『正』的（+4~7%），代表它們都賣在 V 型反彈底部、錯過反彈，平均
扣分。2022-04 那次成功是時機巧合，非可複製能力。結論：簡單技術擇時在 V 型復甦
主導的市場是價值毀滅。已從 backtest_lambdamart.py / rank_today_fast.py 移除整合。
詳見記憶 market-regime-switch。

────────────────────────────────────────────────────────────
大盤狀態總開關（market regime master switch）

問題：排序模型是「多頭/動能機器」，在深空頭會選到跌最凶的高beta股
（2022-04 回測：前20 -35.8% vs SPY -16.7%，0%勝率，輸給隨機選股）。

解法：在選股之上加一層「大盤趨勢濾網」，空頭時減碼/空手，不要滿倉選動能股。

核心訊號：SPY 的 50日均線 vs 200日均線（黃金/死亡交叉）
  - 50MA >= 200MA → 上升趨勢，risk-on，滿倉
  - 50MA <  200MA → 下降趨勢/死叉，risk-off，空手

為什麼用 50/200 而不是「現價 vs 200MA」：兩個 4月是鏡像——
  2022-04 現價在200MA之上但死叉(該空)；2026-04 現價在200MA之下但50>200(該進，結果+79%)。
  趨勢結構(50/200)才能區分，現價 vs 200MA 會搞錯。

VIX 只當極端恐慌備援（>40），因為單看 VIX 會誤判（2026-04 VIX 24.5 卻是最佳月）。
"""
from __future__ import annotations

VIX_PANIC = 40.0  # 極端恐慌門檻（備援）


def _sma(series: dict, as_of_date: str, n: int) -> float | None:
    """SPY 收盤的 n 日簡單均線（只用 as_of 之前的資料）。"""
    dates = sorted(d for d in series if d <= as_of_date)
    if len(dates) < n:
        return None
    vals = [series[d]["close"] for d in dates[-n:]]
    return sum(vals) / n


def _latest_close(series: dict, as_of_date: str) -> float | None:
    dates = sorted(d for d in series if d <= as_of_date)
    return series[dates[-1]]["close"] if dates else None


def market_regime(market_context: dict, as_of_date: str,
                  benchmark: str = "SPY") -> dict:
    """回傳大盤狀態與建議倉位乘數。

    Returns dict:
      regime: 'risk-on' | 'risk-off' | 'caution'
      multiplier: 1.0 | 0.0 | 0.5   （建議倉位比例）
      reason, spy, ma50, ma200, vix
    """
    spy = market_context.get(benchmark, {})
    vix_series = market_context.get("VIX", {})

    price = _latest_close(spy, as_of_date)
    ma50 = _sma(spy, as_of_date, 50)
    ma200 = _sma(spy, as_of_date, 200)
    vix = _latest_close(vix_series, as_of_date) if vix_series else None

    out = {"spy": price, "ma50": ma50, "ma200": ma200, "vix": vix}

    # 資料不足 → 預設滿倉（不擋）
    if ma50 is None or ma200 is None:
        out.update(regime="risk-on", multiplier=1.0, reason="均線資料不足，預設滿倉")
        return out

    # 主訊號：50/200 交叉
    if ma50 >= ma200:
        # 上升趨勢。但極端恐慌時減半。
        if vix is not None and vix >= VIX_PANIC:
            out.update(regime="caution", multiplier=0.5,
                       reason=f"上升趨勢但VIX={vix:.0f}極端恐慌，減半")
        else:
            out.update(regime="risk-on", multiplier=1.0,
                       reason=f"50MA({ma50:.0f})≥200MA({ma200:.0f}) 上升趨勢，滿倉")
    else:
        # 死叉/下降趨勢 → 空手
        out.update(regime="risk-off", multiplier=0.0,
                   reason=f"50MA({ma50:.0f})<200MA({ma200:.0f}) 死叉/下降趨勢，空手避險")
    return out
