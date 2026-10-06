"""族群相對強度 re-rank 傾斜(反應式 sector rotation,不重訓、事後套用)。

概念:把每檔股票對應到族群 ETF(能源→XLE、半導體→SOXX),
算該族群 ETF 近 N 日相對大盤(SPY)的超額報酬,
最終排名分數乘上 (1 + alpha × 相對強度),強族群上調、弱族群下調。

多頭:半導體族群最強 → 半導體股被上調(行為≈現狀)。
熊市:能源族群轉強 → 能源股被上調(自動輪動)。

env:
  SECTOR_TILT=1 開啟(預設關閉,驗證後再開)
  SECTOR_TILT_ALPHA(預設 0.4)、SECTOR_TILT_LOOKBACK(預設 126≈6月)、SECTOR_TILT_CAP(預設 0.5)
"""
import json
import os
from pathlib import Path

from sector_classification import _ENERGY

_HDIR = Path(__file__).resolve().parent / "data" / "history_10y"

# 半導體生態系(對應 SOXX)。涵蓋晶片/設備/材料/光通訊。
_SEMI = {
    "NVDA", "AMD", "INTC", "AVGO", "QCOM", "TXN", "MU", "MCHP", "ADI", "ON",
    "MPWR", "SWKS", "QRVO", "NXPI", "MRVL", "LSCC", "RMBS", "SLAB", "SITM",
    "CRUS", "SYNA", "AMBA", "ALGM", "INDI", "NVTS", "POWI", "DIOD", "SMTC",
    "MTSI", "CRDO", "ALAB", "AOSL", "WOLF", "GFS", "TSEM", "NVEC", "PI",
    "CEVA", "QUIK", "MXL", "HIMX", "VSH", "ARM", "AMAT", "LRCX", "KLAC",
    "TER", "ENTG", "MKSI", "ONTO", "ACLS", "ASYS", "AEIS", "COHU", "FORM",
    "NVMI", "CAMT", "KLIC", "UCTT", "ICHR", "PLAB", "VECO", "AEHR", "ACMR",
    "AZTA", "POET", "LITE", "COHR", "FN", "VIAV", "LASR", "AAOI", "SGH",
    "PENG", "CIEN", "GLW", "STX", "WDC", "SNDK", "DELL", "SATS", "LFUS",
    "SLAB", "AMKR", "COHU", "SIMO", "CAMT", "AOSL", "MPWR",
}

_CACHE = {}

# GICS 類股 → SPDR 類股 ETF
_SECTOR_ETF = {
    "Technology": "XLK",
    "Communication Services": "XLC",
    "Consumer Cyclical": "XLY",
    "Consumer Defensive": "XLP",
    "Healthcare": "XLV",
    "Financial Services": "XLF",
    "Energy": "XLE",
    "Industrials": "XLI",
    "Basic Materials": "XLB",
    "Utilities": "XLU",
    "Real Estate": "XLRE",
}

_SECTOR_MAP = None
def _sector_map():
    global _SECTOR_MAP
    if _SECTOR_MAP is None:
        p = Path(__file__).resolve().parent / "data" / "sector_map.json"
        try:
            _SECTOR_MAP = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            _SECTOR_MAP = {}
    return _SECTOR_MAP


def _closes(symbol):
    if symbol in _CACHE:
        return _CACHE[symbol]
    p = _HDIR / f"{symbol}.json"
    rows = []
    if p.exists():
        try:
            rows = json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            rows = []
    _CACHE[symbol] = rows
    return rows


def _etf_for(symbol):
    s = (symbol or "").upper()
    if s in _SEMI:
        return "SOXX"        # 半導體用較純的 SOXX(優於 XLK)
    if s in _ENERGY:
        return "XLE"
    sec = _sector_map().get(s)   # 其餘:用 GICS 類股 → SPDR ETF(全族群)
    return _SECTOR_ETF.get(sec)  # 找不到 → None(中性)


def _ret_asof(symbol, as_of_date, lookback):
    rows = _closes(symbol)
    av = [r for r in rows if r.get("date", "9") <= as_of_date and r.get("close")]
    if len(av) < lookback + 1:
        return None
    return float(av[-1]["close"]) / float(av[-1 - lookback]["close"]) - 1.0


def sector_bonus(symbol, as_of_date):
    """回傳排名分數的「加成比例」(正=上調、負=下調、0=中性)。SECTOR_TILT!=1 時恆為 0。
    呼叫端用:final_score = score + sector_bonus(...) × (分數最大−最小),sign-safe。"""
    if os.environ.get("SECTOR_TILT", "1") == "0":
        return 0.0
    etf = _etf_for(symbol)
    if etf is None:
        return 0.0
    lookback = int(os.environ.get("SECTOR_TILT_LOOKBACK", "126"))
    alpha = float(os.environ.get("SECTOR_TILT_ALPHA", "0.4"))
    cap = float(os.environ.get("SECTOR_TILT_CAP", "0.5"))
    etf_ret = _ret_asof(etf, as_of_date, lookback)
    spy_ret = _ret_asof("SPY", as_of_date, lookback)
    if etf_ret is None or spy_ret is None:
        return 0.0
    rel = etf_ret - spy_ret                       # 族群相對大盤超額
    rel = max(-cap, min(cap, rel))
    return alpha * rel
