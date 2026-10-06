import asyncio
import re
from datetime import datetime
import logging
from pathlib import Path
from zoneinfo import ZoneInfo
import json
import sqlite3
from urllib.parse import urlparse

import httpx

logger = logging.getLogger("stock_api")

from fastapi import FastAPI, Query, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import os
import pandas as pd
import yfinance as yf
from yahooquery import search as yahoo_search
from sklearn.metrics import mean_squared_error, r2_score
import joblib
from earnings_features import build_earnings_features, fetch_earnings_events, load_earnings_cache

try:
    from openai import OpenAI
except ImportError:
    OpenAI = None

app = FastAPI()
BASE_DIR = Path(__file__).resolve().parent
TW_STOCKS_PATH = BASE_DIR / "tw_stocks.json"
PREDICTIONS_LOG_PATH = BASE_DIR / "watchlist_predictions.json"
DB_PATH = BASE_DIR / "predictions.db"
MODEL_PATH = BASE_DIR / "models" / "price_model.joblib"
ACTION_MODEL_PATH = BASE_DIR / "models" / "action_classifier_xgb.joblib"

_MODEL_CACHE = None
_ACTION_MODEL_CACHE = None
_TW_STOCKS_CACHE = None
_TW_STOCKS_INDEX = None
_WATCHLIST_CACHE: dict = {}
_ENDPOINT_CACHE: dict = {}
_ENDPOINT_CACHE_MAX = 500
_WATCHLIST_CACHE_MAX = 50
_FUNDAMENTALS_CACHE: dict | None = None
_EARNINGS_CACHE: dict | None = None

FUNDAMENTALS_DIR = BASE_DIR / "data" / "fundamentals"
EARNINGS_DIR = BASE_DIR / "data" / "earnings"


@app.get("/")
def root():
    return {"message": "API is running"}


@app.get("/health")
def health():
    return {"ok": True}


RANKING_PATH = BASE_DIR / "ranking_latest.json"
HEALTH_PATH = BASE_DIR / "health_latest.json"
TOP_GAINERS_PATH = BASE_DIR / "top_gainers_latest.json"


@app.get("/ranking")
def ranking(top: int = Query(20, ge=1, le=50)):
    """回傳預先算好的 LambdaMART 選股排名(由 scripts/rank_today_fast.py --out 產生,每日 cron 更新)。"""
    if not RANKING_PATH.exists():
        raise HTTPException(status_code=503, detail="Ranking not available yet")
    try:
        data = json.loads(RANKING_PATH.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Ranking file unreadable")
    items = data.get("items", [])[:top]
    return {
        "asOf": data.get("asOf"),
        "model": data.get("model"),
        "count": len(items),
        "items": items,
    }


# 因子英文/中文標籤(供 App 雷達圖雙語顯示),順序固定
_HEALTH_FACTOR_LABELS = {
    "momentum":  {"en": "Momentum", "zh": "動能"},
    "quality":   {"en": "Quality",  "zh": "品質"},
    "growth":    {"en": "Growth",   "zh": "成長"},
    "analyst":   {"en": "Analyst",  "zh": "分析師"},
    "value":     {"en": "Value",    "zh": "估值"},
    "stability": {"en": "Stability","zh": "穩定"},
}


# 先隱藏 App 個股「量化體檢卡」:設 False → 端點固定回 available=false(App 會自動不顯示)。改回 True 即恢復。
HEALTH_CARD_ENABLED = False

@app.get("/health/{symbol}")
def stock_health(symbol: str):
    """個股量化體檢:回傳該股在全美股的總分百分位 + 6 因子百分位(由 rank_today_fast 預先算好)。
    若該股不在排名宇宙(無足夠資料),回傳 available=false 讓 App 隱藏體檢卡。"""
    sym = (symbol or "").strip().upper()
    if not HEALTH_CARD_ENABLED:
        return {"symbol": sym, "available": False}
    if not HEALTH_PATH.exists():
        return {"symbol": sym, "available": False}
    try:
        data = json.loads(HEALTH_PATH.read_text(encoding="utf-8"))
    except Exception:
        return {"symbol": sym, "available": False}
    entry = (data.get("items") or {}).get(sym)
    if not entry:
        return {"symbol": sym, "available": False}
    factors = entry.get("factors", {})
    return {
        "symbol": sym,
        "available": True,
        "asOf": data.get("asOf"),
        "overall": entry.get("overall"),
        "factors": [
            {
                "key": k,
                "labelEn": _HEALTH_FACTOR_LABELS.get(k, {}).get("en", k),
                "labelZh": _HEALTH_FACTOR_LABELS.get(k, {}).get("zh", k),
                "value": factors.get(k, 0),
            }
            for k in _HEALTH_FACTOR_LABELS
            if k in factors
        ],
    }


import time

_GAINERS_LIVE_CACHE: dict = {}     # window -> (timestamp, live_items)
_GAINERS_LIVE_TTL = 180            # 盤中即時榜快取 3 分鐘,避免重複抓

# ---- Alpaca 即時報價(IEX,秒級):/quote 的優先價源,失敗自動退回 yfinance ----
_ALPACA_DATA = None
_ALPACA_PRICE_CACHE: dict = {}     # symbol -> (timestamp, price)
_ALPACA_PRICE_TTL = 5


def _alpaca_latest_price(symbol: str):
    global _ALPACA_DATA
    now = time.time()
    hit = _ALPACA_PRICE_CACHE.get(symbol)
    if hit and now - hit[0] < _ALPACA_PRICE_TTL:
        return hit[1]
    try:
        if _ALPACA_DATA is None:
            from env_loader import load_env_file
            load_env_file()
            if not os.environ.get("APCA_API_KEY_ID"):
                return None
            from alpaca.data.historical import StockHistoricalDataClient
            _ALPACA_DATA = StockHistoricalDataClient(
                os.environ["APCA_API_KEY_ID"], os.environ["APCA_API_SECRET_KEY"])
        from alpaca.data.requests import StockLatestTradeRequest
        r = _ALPACA_DATA.get_stock_latest_trade(
            StockLatestTradeRequest(symbol_or_symbols=symbol))
        price = float(r[symbol].price)
        _ALPACA_PRICE_CACHE[symbol] = (now, price)
        return price
    except Exception:
        return None


def _fetch_live_prices(symbols: list[str]) -> dict:
    """批次抓候選股的即時價(一次 yfinance download,非逐檔)。回傳 {symbol: price}。"""
    prices: dict = {}
    if not symbols:
        return prices
    yf_syms = [s.replace(".", "-") for s in symbols]
    try:
        df = yf.download(yf_syms, period="1d", interval="1m", progress=False, threads=True)
        if df is None or df.empty or "Close" not in df:
            return prices
        close = df["Close"]
        if isinstance(close, pd.Series):  # 單一標的
            v = close.dropna()
            if len(v):
                prices[symbols[0]] = float(v.iloc[-1])
        else:
            for orig, ys in zip(symbols, yf_syms):
                if ys in close.columns:
                    v = close[ys].dropna()
                    if len(v):
                        prices[orig] = float(v.iloc[-1])
    except Exception:
        logger.exception("live gainers price fetch failed")
    return prices


@app.get("/top-gainers")
def top_gainers(top: int = Query(20, ge=1, le=30), window: str = Query("1y"), live: int = Query(0)):
    """漲幅排行榜。window=1y 近一年(預設) / ytd 年初至今。
    live=1 盤中模式:只重抓候選池(top50)的即時價、用固定基準重算排序,3 分鐘快取。"""
    win = window if window in ("1y", "ytd", "rs") else "1y"
    if not TOP_GAINERS_PATH.exists():
        raise HTTPException(status_code=503, detail="Top gainers not available yet")
    try:
        data = json.loads(TOP_GAINERS_PATH.read_text(encoding="utf-8"))
    except Exception:
        raise HTTPException(status_code=500, detail="Top gainers file unreadable")
    windows = data.get("windows") or {}
    bucket = windows.get(win) or windows.get("1y") or windows.get("ytd") or {}

    # RS Rating 是日級指標(多月報酬),盤中幾乎不動 → 不做即時刷新,直接回每日榜
    if not live or win == "rs":
        items = bucket.get("items", [])[:top]
        return {"asOf": data.get("asOf"), "window": win, "since": bucket.get("since"),
                "count": len(items), "items": items, "live": False}

    # --- 盤中即時模式 ---
    cache_key = win
    cached = _GAINERS_LIVE_CACHE.get(cache_key)
    now = time.time()
    if cached and now - cached[0] < _GAINERS_LIVE_TTL:
        live_items = cached[1]
    else:
        candidates = bucket.get("candidates") or []
        prices = _fetch_live_prices([c["symbol"] for c in candidates])
        rebuilt = []
        for c in candidates:
            p = prices.get(c["symbol"])
            base = c.get("baselinePrice")
            if p and base and base > 0:
                rebuilt.append({
                    "symbol": c["symbol"],
                    "baselineDate": c.get("baselineDate"),
                    "baselinePrice": base,
                    "price": round(p, 2),
                    "changePct": round(p / base - 1.0, 4),
                })
        rebuilt.sort(key=lambda x: x["changePct"], reverse=True)
        live_items = [{"rank": i + 1, **r} for i, r in enumerate(rebuilt)]
        # 抓不到即時價(收盤/yfinance失敗)→ 退回每日收盤榜,不留空
        if not live_items:
            live_items = bucket.get("items", [])
        _GAINERS_LIVE_CACHE[cache_key] = (now, live_items)

    items = live_items[:top]
    return {"asOf": data.get("asOf"), "window": win, "since": bucket.get("since"),
            "count": len(items), "items": items, "live": True}


class AIAnalyzeIndicators(BaseModel):
    rsi: float | None = None
    mfi: float | None = None
    signal: str | None = None


class AISequencePoint(BaseModel):
    date: str | None = None
    close: float | None = None
    high: float | None = None
    low: float | None = None
    volume: float | None = None
    ma5: float | None = None
    return1d: float | None = None
    volatility5d: float | None = None


class AIAnalyzeInput(BaseModel):
    symbol: str
    companyName: str
    language: str = "zh-TW"
    currentPrice: float | None = None
    predictedLow: float | None = None
    predictedHigh: float | None = None
    bias: str | None = None
    confidence: str | None = None
    technicalSummary: str | None = None
    newsImpact: str | None = None
    newsSummary: str | None = None
    indicators: AIAnalyzeIndicators = AIAnalyzeIndicators()
    marketContext: str | None = None
    sequence: list[AISequencePoint] = []


_SYMBOL_RULES: dict[str, dict] = {
    "MRVL": {
        "canonicalName": "Marvell Technology",
        "forbiddenTerms": ["美信科技", "美信集成電路", "美信", "maxim", "mxim"],
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.22, "exitPE": 30.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.28, "exitPE": 40.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.50, "expectedNetMargin": 0.35, "exitPE": 50.0},
            ],
            "notes": "MRVL AI networking/custom silicon: GAAP margin ~29%, AI ASIC revenue scaling. Current price $289 above analyst mean $229 — needs strong Bull scenario.",
        },
    },
    # TSLA: auto manufacturer, GAAP margin 3.9%. FSD/Robotaxi/Optimus optionality drives high PE.
    # Analyst 30-day mean ~$482. Base scenario needs to reflect margin recovery path.
    "TSLA": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.08, "expectedNetMargin": 0.05, "exitPE": 50.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.22, "expectedNetMargin": 0.10, "exitPE": 75.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.38, "expectedNetMargin": 0.16, "exitPE": 110.0},
            ],
            "notes": "TSLA: GAAP margin 3.9%. Market prices FSD/Robotaxi/Optimus optionality at 75-110x PE. Base assumes margin recovery to 10% as Cybercab scales.",
        },
    },
    # TSM: TSMC foundry, actual margin 46.5%. ADR-adjusted rev/sh ~$12 (1 ADR = 5 ordinary shares).
    # fwdPE only 22x — needs higher exit PE to match actual market premium on AI fab monopoly.
    "TSM": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.42, "exitPE": 22.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.28, "expectedNetMargin": 0.48, "exitPE": 30.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.38, "expectedNetMargin": 0.52, "exitPE": 38.0},
            ],
            "notes": "TSM TSMC: margin ~46.5%, ADR-adjusted rev/sh ~$12. Higher exit PE (30x) reflects AI fab monopoly premium vs historical 18-22x.",
        },
    },
    # LITE: optical components, margin 17.7%, P/S 25x. Analyst 30-day mean ~$960 above current $895.
    "LITE": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.16, "exitPE": 30.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.30, "expectedNetMargin": 0.22, "exitPE": 50.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.45, "expectedNetMargin": 0.26, "exitPE": 65.0},
            ],
            "notes": "LITE optical: margin 17.7%, AI interconnect demand. Analyst mean $960 > current $895. High P/S 25x requires strong growth to justify.",
        },
    },
    # GLW: Corning specialty glass/fiber, margin 11.1%. Analyst mean ~$224 near current $188.
    "GLW": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.11, "exitPE": 25.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.14, "expectedNetMargin": 0.15, "exitPE": 38.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.22, "expectedNetMargin": 0.18, "exitPE": 50.0},
            ],
            "notes": "GLW Corning: margin ~11.1%, AI fiber demand catalyst. Analyst mean $224 vs current $188 = +19% upside per consensus.",
        },
    },
    # NOW: ServiceNow, SaaS platform, GAAP margin 12.6% (heavy SBC), non-GAAP much higher ~30%
    "NOW": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.18, "expectedNetMargin": 0.15, "exitPE": 35.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.25, "expectedNetMargin": 0.20, "exitPE": 45.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.32, "expectedNetMargin": 0.26, "exitPE": 55.0},
            ],
            "notes": "NOW ServiceNow SaaS: GAAP margin 12.6% depressed by SBC. Non-GAAP ~30%+. AI workflow automation accelerating growth.",
        },
    },
    # CRWV: CoreWeave AI cloud, pre-profit (-25.6%), heavy capex. Pure AI infrastructure play.
    "CRWV": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.40, "expectedNetMargin": 0.05, "exitPE": 30.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.80, "expectedNetMargin": 0.12, "exitPE": 45.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 1.20, "expectedNetMargin": 0.20, "exitPE": 60.0},
            ],
            "notes": "CRWV CoreWeave: pre-profit AI cloud infra. Requires hyper-growth 80-120%+ revenue CAGR to justify current valuation. High risk/reward.",
        },
    },
    # NVDA: actual net margin ~63%, default 35% severely underestimates Bull target
    "NVDA": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.25, "expectedNetMargin": 0.45, "exitPE": 25.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.55, "exitPE": 35.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.45, "expectedNetMargin": 0.62, "exitPE": 45.0},
            ],
            "notes": "NVDA net margin ~63%. Scenarios use realistic 45-62% margin and higher exit PE for AI infrastructure leader.",
        },
    },
    # SNDK: already trading near analyst mean, fully priced
    "SNDK": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.28, "exitPE": 20.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.34, "exitPE": 28.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.50, "expectedNetMargin": 0.40, "exitPE": 35.0},
            ],
            "notes": "SNDK (Western Digital flash): analyst mean $1659 near current price. Model uses actual ~34% margin. Fully priced near-term.",
        },
    },
    # CBRE: real estate services, net margin only ~3%. Revenue model drastically overstates targets.
    # Use EPS-based approach via normalizedRevenuePerShare suppression + scenario net margin fix.
    "CBRE": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.025, "exitPE": 18.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.031, "exitPE": 22.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.14, "expectedNetMargin": 0.038, "exitPE": 26.0},
            ],
            "notes": "CBRE real estate services: net margin ~3.1%. Scenarios corrected to actual margin range. High revenue/share is a services-industry artifact.",
        },
    },
    # EME: engineering & construction, net margin ~7.5%. Default 30% margin is 4x too high.
    "EME": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.08, "expectedNetMargin": 0.065, "exitPE": 18.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.075, "exitPE": 22.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.18, "expectedNetMargin": 0.090, "exitPE": 28.0},
            ],
            "notes": "EME engineering & construction: net margin ~7.5%. Corrected from default 30% which overstated targets 4x.",
        },
    },
    # WMB: midstream energy, moderate margin ~20%
    "WMB": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.18, "exitPE": 18.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.22, "exitPE": 22.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.26, "exitPE": 26.0},
            ],
            "notes": "WMB midstream pipeline: margin ~20-22%. Adjusted from default 30%.",
        },
    },
    # COP: oil & gas, cyclical margin ~15-25%
    "COP": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.05, "expectedNetMargin": 0.12, "exitPE": 12.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.08, "expectedNetMargin": 0.18, "exitPE": 15.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.24, "exitPE": 18.0},
            ],
            "notes": "COP oil & gas E&P: cyclical margins 12-24%. Lower PE appropriate for commodity sector.",
        },
    },
    # OXY: oil & gas similar to COP
    "OXY": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.03, "expectedNetMargin": 0.10, "exitPE": 10.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.07, "expectedNetMargin": 0.16, "exitPE": 13.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.22, "exitPE": 16.0},
            ],
            "notes": "OXY oil & gas: cyclical sector, conservative margin 10-22% and lower exit PE.",
        },
    },
    # EQT: natural gas E&P, actual margin ~35%. Prior model used 22% — corrected upward.
    "EQT": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.05, "expectedNetMargin": 0.28, "exitPE": 10.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.35, "exitPE": 13.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.18, "expectedNetMargin": 0.42, "exitPE": 16.0},
            ],
            "notes": "EQT natural gas E&P: actual margin ~35%. Conservative PE for cyclical gas sector.",
        },
    },
    # ALB: lithium specialty chemicals, currently margin -4% (lithium price crash). Recovery expected.
    "ALB": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.08, "expectedNetMargin": 0.08, "exitPE": 15.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.18, "exitPE": 20.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.28, "exitPE": 28.0},
            ],
            "notes": "ALB lithium: currently margin -4% due to lithium price crash. Scenarios reflect recovery path as EV demand drives lithium cycle rebound.",
        },
    },
    # VRT: data center power/cooling, margin ~14.4%, high P/S 10x due to AI data center demand
    "VRT": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.12, "exitPE": 25.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.16, "exitPE": 32.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.50, "expectedNetMargin": 0.20, "exitPE": 40.0},
            ],
            "notes": "VRT data center power: margin ~14.4%, high P/S 10x on AI infrastructure demand. Growth-adjusted scenarios.",
        },
    },
    # SATS: EchoStar telecom, currently deeply negative margin (-97%) due to restructuring/debt
    "SATS": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.05, "expectedNetMargin": 0.05, "exitPE": 12.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.12, "exitPE": 16.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.18, "exitPE": 20.0},
            ],
            "notes": "SATS EchoStar telecom: current margin -97% from restructuring. Scenarios use recovery-path margins as debt restructuring completes.",
        },
    },
    # HPE: enterprise IT/networking, margin ~4% GAAP but AI server segment lifting mix
    "HPE": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.04, "expectedNetMargin": 0.040, "exitPE": 11.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.09, "expectedNetMargin": 0.060, "exitPE": 14.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.080, "exitPE": 17.0},
            ],
            "notes": "HPE enterprise IT: GAAP margin ~4%, AI server (ProLiant Gen12) mix driving higher-margin services. Slight upward revision.",
        },
    },
    # ZBRA: barcode/RFID/mobile computing, margin ~7.5%. B2B hardware + software.
    "ZBRA": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.065, "exitPE": 18.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.090, "exitPE": 22.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.18, "expectedNetMargin": 0.120, "exitPE": 28.0},
            ],
            "notes": "ZBRA enterprise mobility/RFID: margin ~7.5%, recovering from 2023 downcycle. Software mix growing.",
        },
    },
    # TMUS: telecom carrier, margin ~11.6%. Stable cash flow but limited growth.
    "TMUS": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.04, "expectedNetMargin": 0.10, "exitPE": 14.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.07, "expectedNetMargin": 0.13, "exitPE": 17.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.16, "exitPE": 20.0},
            ],
            "notes": "TMUS US telecom: margin ~11.6%, 5G subscriber growth slowing. Stable but limited upside. Conservative PE for telecom sector.",
        },
    },
    # CIEN: optical networking equipment, margin ~7.9%, P/S 12x. Already priced for growth.
    "CIEN": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.08, "exitPE": 28.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.22, "expectedNetMargin": 0.12, "exitPE": 38.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.16, "exitPE": 48.0},
            ],
            "notes": "CIEN optical networking: margin ~7.9% expanding with AI buildout. High P/S 12x already reflects premium. Base scenario targets meaningful upside.",
        },
    },
    # VST: independent power producer, margin ~11.5%. AI data center power demand catalyst.
    "VST": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.10, "exitPE": 16.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.12, "expectedNetMargin": 0.14, "exitPE": 20.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.18, "exitPE": 25.0},
            ],
            "notes": "VST power producer: margin ~11.5%, AI data center power demand driving long-term contracts. Adjusted from default 30% margin.",
        },
    },
    # PWR: electrical construction services, margin ~3.7% GAAP. Premium valuation on grid/AI infrastructure supercycle.
    "PWR": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.036, "exitPE": 28.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.16, "expectedNetMargin": 0.046, "exitPE": 36.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.24, "expectedNetMargin": 0.060, "exitPE": 44.0},
            ],
            "notes": "PWR electrical construction: GAAP margin ~3.7% (pass-through). Premium PE justified by grid modernization + data center supercycle backlog.",
        },
    },
    # DELL: hardware assembler, net margin only ~6.3%. Default 30% margin vastly overstates targets.
    "DELL": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.055, "exitPE": 12.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.065, "exitPE": 15.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.080, "exitPE": 18.0},
            ],
            "notes": "DELL hardware: net margin ~6.3%. High rev/share is pass-through hardware revenue. Conservative margin and PE for hardware assembler.",
        },
    },
    # IBM: IT services, margin ~15.6%. Growth is modest, AI/hybrid cloud pivot underway.
    "IBM": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.03, "expectedNetMargin": 0.13, "exitPE": 14.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.06, "expectedNetMargin": 0.16, "exitPE": 18.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.10, "expectedNetMargin": 0.20, "exitPE": 22.0},
            ],
            "notes": "IBM IT services: margin ~15.6%, modest growth. Analyst mean ~$290 near current price, limited upside unless AI pivot accelerates.",
        },
    },
    # AMD: semiconductors, GAAP margin ~13% due to heavy R&D/amortization. Gross margin 53%.
    # Use gross-margin-adjusted approach: forward EPS based valuation is more appropriate.
    "AMD": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.20, "expectedNetMargin": 0.15, "exitPE": 25.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.20, "exitPE": 35.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.50, "expectedNetMargin": 0.26, "exitPE": 45.0},
            ],
            "notes": "AMD: GAAP margin ~13% depressed by R&D/amortization, gross margin 53%. Scenarios use path toward 20-26% net margin as AI GPU revenue scales.",
        },
    },
    # MU: HBM/AI memory cycle. Yahoo analyst mean $739 is stale (includes old $400-550 targets).
    # Latest 30-day analyst mean = $1,216 (13 firms, range $800-$1,750). Current price $949.
    "MU": {
        "valuation": {
            "holdingYears": 3,
            "scenarios": [
                {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.32, "exitPE": 12.0},
                {"id": "base", "label": "Base", "revenueGrowthRate": 0.30, "expectedNetMargin": 0.42, "exitPE": 15.0},
                {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.50, "expectedNetMargin": 0.50, "exitPE": 18.0},
            ],
            "notes": "MU HBM/AI memory: Yahoo mean $739 is stale. 30-day analyst mean $1,216 (Susquehanna $1,750, UBS $1,625, Cantor $1,500). Margin ~41%, scaling with HBM demand.",
        },
    },
}

SYSTEM_PROMPT = "You are a disciplined short-term stock analysis assistant. Analyze exactly one stock only. Do not mention unrelated companies. Be conservative. Return valid JSON only."


def _sanitize_text_for_symbol(symbol: str, text: str) -> str:
    cleaned = (text or "").strip()
    if not cleaned:
        return ""
    rules = _SYMBOL_RULES.get(symbol.upper(), {})
    forbidden = rules.get("forbiddenTerms", [])
    if forbidden:
        lower = cleaned.lower()
        if any(term in cleaned for term in forbidden) or any(term in lower for term in forbidden):
            return ""
    return cleaned


def _sanitize_analysis_output(symbol: str, data: dict) -> dict:
    symbol = symbol.upper()
    summary = _sanitize_text_for_symbol(symbol, data.get("summary", ""))
    if not summary:
        summary = "短線訊號偏混合，建議先等待更明確方向。"

    technical = [
        item for item in (_sanitize_text_for_symbol(symbol, x) for x in data.get("technical", [])) if item
    ]
    if not technical:
        technical = ["目前技術面訊號有限，宜保守看待"]

    sentiment = data.get("sentiment", {}) or {}
    sentiment_items = [
        item for item in (_sanitize_text_for_symbol(symbol, x) for x in sentiment.get("items", [])) if item
    ]
    if not sentiment_items:
        sentiment_items = ["目前新聞面沒有明顯額外優勢"]

    watch_points = [
        item for item in (_sanitize_text_for_symbol(symbol, x) for x in data.get("watchPoints", [])) if item
    ]
    if not watch_points:
        watch_points = ["是否站回短期均線", "量能是否放大並延續", "是否突破預測區間上緣"]

    data["summary"] = summary
    data["technical"] = technical[:3]
    data["sentiment"] = {
        "label": sentiment.get("label", "neutral"),
        "items": sentiment_items[:2],
    }
    data["watchPoints"] = watch_points[:3]
    return data


def _score_action(payload: AIAnalyzeInput) -> tuple[str, int]:
    score = 50
    rsi = payload.indicators.rsi
    mfi = payload.indicators.mfi
    bias = (payload.bias or "").lower()
    news = (payload.newsImpact or "").lower()

    if rsi is not None:
        if rsi <= 35:
            score += 10
        elif rsi >= 65:
            score -= 8

    if mfi is not None:
        if mfi >= 55:
            score += 8
        elif mfi < 45:
            score -= 8

    if any(word in bias for word in ["up", "bull", "positive"]):
        score += 8
    elif any(word in bias for word in ["down", "bear", "negative"]):
        score -= 8

    if any(word in news for word in ["positive", "bull"]):
        score += 6
    elif any(word in news for word in ["negative", "bear"]):
        score -= 6

    score = max(0, min(100, score))
    if score >= 65:
        return "Buy", score
    if score <= 35:
        return "Avoid", score
    return "Wait", score


def _estimate_range_from_volatility(payload: AIAnalyzeInput, current_price: float | None) -> tuple[float | None, float | None]:
    if current_price is None:
        return payload.predictedLow, payload.predictedHigh

    rsi = payload.indicators.rsi or 50
    mfi = payload.indicators.mfi or 50
    base_pct = 0.02
    vol_adjust = 0.01 if abs(rsi - 50) < 10 and abs(mfi - 50) < 10 else 0.015
    width = base_pct + vol_adjust

    predicted_low = round(current_price * (1 - width), 2)
    predicted_high = round(current_price * (1 + width), 2)
    return predicted_low, predicted_high


def _load_price_model():
    global _MODEL_CACHE
    if _MODEL_CACHE is not None:
        return _MODEL_CACHE
    if not MODEL_PATH.exists():
        _MODEL_CACHE = None
        return None
    try:
        bundle = joblib.load(MODEL_PATH)
        _MODEL_CACHE = bundle
        return bundle
    except Exception:
        logger.exception("Failed to load price model from %s", MODEL_PATH)
        _MODEL_CACHE = None
        return None


def _load_action_model():
    global _ACTION_MODEL_CACHE
    if _ACTION_MODEL_CACHE is not None:
        return _ACTION_MODEL_CACHE
    if not ACTION_MODEL_PATH.exists():
        _ACTION_MODEL_CACHE = None
        return None
    try:
        bundle = joblib.load(ACTION_MODEL_PATH)
        _ACTION_MODEL_CACHE = bundle
        return bundle
    except Exception:
        logger.exception("Failed to load action model from %s", ACTION_MODEL_PATH)
        _ACTION_MODEL_CACHE = None
        return None


def _sequence_to_features(sequence: list[dict], current_price: float) -> dict | None:
    if not sequence:
        return None

    rows = []
    for item in sequence[-20:]:
        close = _safe_float(item.get("close"))
        if close is None or close <= 0:
            continue
        rows.append({
            "close": close,
            "volume": _safe_float(item.get("volume")),
            "return1d": _safe_float(item.get("return1d")),
            "volatility5d": _safe_float(item.get("volatility5d")),
            "ma5": _safe_float(item.get("ma5")),
        })

    if len(rows) < 5:
        return None

    closes = [r["close"] for r in rows]
    returns = [r["return1d"] for r in rows if r.get("return1d") is not None]
    volumes = [r["volume"] for r in rows if r.get("volume") is not None]
    volatilities = [r["volatility5d"] for r in rows if r.get("volatility5d") is not None]

    feature_row = {
        "lag_1_return": returns[-1] if len(returns) >= 1 else 0.0,
        "lag_2_return": returns[-2] if len(returns) >= 2 else 0.0,
        "lag_3_return": returns[-3] if len(returns) >= 3 else 0.0,
        "mean_return_5": float(pd.Series(returns[-5:]).mean()) if returns else 0.0,
        "mean_return_20": float(pd.Series(returns).mean()) if returns else 0.0,
        "volatility_20": float(pd.Series(returns).std(ddof=0) or 0.0) if returns else 0.0,
        "momentum_20": float((closes[-1] / closes[0]) - 1.0),
        "avg_volume_20": float(pd.Series(volumes).mean()) if volumes else current_price,
        "volume_ratio": float(volumes[-1] / (pd.Series(volumes).mean() or volumes[-1])) if volumes else 1.0,
    }

    # Blend in recent 5-day volatility when available.
    if volatilities:
        feature_row["volatility_20"] = max(feature_row["volatility_20"], float(pd.Series(volatilities).mean()))

    return feature_row


def _features_for_action_model(payload: AIAnalyzeInput, current_price: float) -> dict | None:
    sequence = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.sequence]
    feature_row = _sequence_to_features(sequence, current_price)
    if feature_row is None:
        return None

    closes = []
    highs = []
    lows = []
    ma5_values = []
    volumes = []
    for item in sequence[-20:]:
        close = _safe_float(item.get("close"))
        if close is not None and close > 0:
            closes.append(close)
        high = _safe_float(item.get("high"))
        if high is not None and high > 0:
            highs.append(high)
        low = _safe_float(item.get("low"))
        if low is not None and low > 0:
            lows.append(low)
        ma5 = _safe_float(item.get("ma5"))
        if ma5 is not None and ma5 > 0:
            ma5_values.append(ma5)
        volume = _safe_float(item.get("volume"))
        if volume is not None and volume > 0:
            volumes.append(volume)

    rsi = _safe_float(payload.indicators.rsi)
    mfi = _safe_float(payload.indicators.mfi)
    rsi = 50.0 if rsi is None else max(0.0, min(100.0, rsi))
    mfi = 50.0 if mfi is None else max(0.0, min(100.0, mfi))

    latest_close = closes[-1] if closes else current_price
    ma5 = ma5_values[-1] if ma5_values else latest_close
    ma20 = float(pd.Series(closes).mean()) if closes else latest_close
    high_20 = max(highs) if highs else latest_close
    low_20 = min(lows) if lows else latest_close
    avg_volume = float(pd.Series(volumes).mean()) if volumes else 0.0

    feature_row.update({
        "range_ratio": float((high_20 - low_20) / max(latest_close, 1e-9)),
        "rsi": rsi,
        "mfi": mfi,
        "rsi_norm": (rsi - 50.0) / 50.0,
        "mfi_norm": (mfi - 50.0) / 50.0,
        "rsi_change_3d": 0.0,
        "mfi_change_3d": 0.0,
        "ma5_deviation": float((latest_close / max(ma5, 1e-9)) - 1.0),
        "ma20_deviation": float((latest_close / max(ma20, 1e-9)) - 1.0),
        "rsi_delta_1": 0.0,
        "mfi_delta_1": 0.0,
        "ma5_slope": float((ma5_values[-1] / max(ma5_values[-4], 1e-9)) - 1.0) if len(ma5_values) >= 4 else 0.0,
        "ma20_slope": float((closes[-1] / max(closes[-5], 1e-9)) - 1.0) if len(closes) >= 5 else 0.0,
        "vwap_deviation": 0.0,
        "atr_ratio": float((high_20 - low_20) / max(latest_close, 1e-9)),
        "price_mfi_divergence": float(feature_row.get("momentum_20", 0.0) - ((mfi - 50.0) / 100.0)),
        "obv_change_5": 0.0,
        "macd": 0.0,
        "macdSignal": 0.0,
        "macdHist": 0.0,
        "macdHist_change_3d": 0.0,
        "relative_strength_spy": 0.0,
        "relative_strength_soxx": 0.0,
        "relative_strength_spy_change_3d": 0.0,
        "relative_strength_soxx_change_3d": 0.0,
        "spy_return1d": 0.0,
        "qqq_return1d": 0.0,
        "soxx_return1d": 0.0,
        "vix_change1d": 0.0,
        "tsla_return1d": 0.0,
        "spy_rsi14": 50.0,
        "qqq_rsi14": 50.0,
        "soxx_rsi14": 50.0,
        "vix_rsi14": 50.0,
        "tsla_rsi14": 50.0,
        "spy_macdHist": 0.0,
        "qqq_macdHist": 0.0,
        "soxx_macdHist": 0.0,
        "vix_macdHist": 0.0,
        "tsla_macdHist": 0.0,
        "vix_level": 20.0,
    })
    feature_row.update(_earnings_features_for_prediction(payload.symbol, sequence))

    if avg_volume > 0:
        feature_row["avg_volume_20"] = avg_volume

    feature_row.update(_fundamental_features_for_prediction(payload.symbol, current_price))

    return feature_row


def _features_for_price_model(payload: AIAnalyzeInput, current_price: float) -> dict | None:
    sequence = [item.model_dump() if hasattr(item, "model_dump") else dict(item) for item in payload.sequence]
    feature_row = _sequence_to_features(sequence, current_price)
    if feature_row is None:
        return None

    rsi = _safe_float(payload.indicators.rsi)
    mfi = _safe_float(payload.indicators.mfi)
    rsi = 50.0 if rsi is None else max(0.0, min(100.0, rsi))
    mfi = 50.0 if mfi is None else max(0.0, min(100.0, mfi))

    feature_row.update({
        "rsi14": rsi,
        "mfi14": mfi,
        "rsi14_norm": (rsi - 50.0) / 50.0,
        "mfi14_norm": (mfi - 50.0) / 50.0,
        "rsi_change_3d": 0.0,
        "mfi_change_3d": 0.0,
        "obv_change_5": 0.0,
        "macd": 0.0,
        "macdSignal": 0.0,
        "macdHist": 0.0,
        "macdHist_change_3d": 0.0,
        "relative_strength_spy": 1.0,
        "relative_strength_soxx": 1.0,
        "relative_strength_spy_change_3d": 0.0,
        "relative_strength_soxx_change_3d": 0.0,
        "spy_return1d": 0.0,
        "qqq_return1d": 0.0,
        "soxx_return1d": 0.0,
        "vix_change1d": 0.0,
        "tsla_return1d": 0.0,
        "spy_rsi14": 50.0,
        "qqq_rsi14": 50.0,
        "soxx_rsi14": 50.0,
        "vix_rsi14": 50.0,
        "tsla_rsi14": 50.0,
        "spy_macdHist": 0.0,
        "qqq_macdHist": 0.0,
        "soxx_macdHist": 0.0,
        "vix_macdHist": 0.0,
        "tsla_macdHist": 0.0,
        "vix_level": 20.0,
    })
    feature_row.update(_earnings_features_for_prediction(payload.symbol, sequence))

    return feature_row


def _momentum_label(momentum: float) -> str:
    pct = momentum * 100
    if pct >= 20:
        return "近期動能強勁，上漲趨勢延續中"
    if pct >= 5:
        return "近期動能溫和，短線偏多格局"
    if pct >= -5:
        return "近期動能持平，方向待確認"
    if pct >= -20:
        return "近期動能偏弱，短線壓力明顯"
    return "近期動能疲弱，下跌趨勢持續"


def _infer_with_action_model(payload: AIAnalyzeInput):
    bundle = _load_action_model()
    if not bundle:
        return None

    model = bundle.get("model")
    metadata = bundle.get("metadata") or {}
    label_map = bundle.get("labelMap") or metadata.get("labelMap") or {"Avoid": 0, "Wait": 1, "Buy": 2}
    if model is None:
        return None

    current_price = _safe_float(payload.currentPrice)
    if current_price is None or current_price <= 0:
        return None

    feature_row = _features_for_action_model(payload, current_price)
    if feature_row is None:
        return None

    feature_names = metadata.get("featureNames") or list(feature_row.keys())
    X = pd.DataFrame([{name: feature_row.get(name, 0.0) for name in feature_names}]).fillna(0.0)

    # Apply the same IQR-clip + log1p preprocessing used during training.
    clip_bounds = metadata.get("clipBounds") or {}
    log_features = metadata.get("logFeatures") or []
    if clip_bounds or log_features:
        X = _apply_inference_noise_preprocessing(X, clip_bounds, log_features)

    try:
        raw_prediction = int(model.predict(X)[0])
        probabilities = model.predict_proba(X)[0].tolist() if hasattr(model, "predict_proba") else []
    except Exception:
        logger.exception("Action model inference failed")
        return None

    inverse_label_map = {int(value): key for key, value in label_map.items()}
    action = inverse_label_map.get(raw_prediction, "NotBuy")
    if action not in {"Buy", "Wait", "Avoid", "NotBuy"}:
        action = "NotBuy"

    probability_by_label = {}
    classes = [int(value) for value in getattr(model, "classes_", [])]
    for idx, probability in enumerate(probabilities):
        label_id = classes[idx] if idx < len(classes) else idx
        label = inverse_label_map.get(int(label_id), str(label_id))
        probability_by_label[label] = round(float(probability), 4)

    buy_prob = float(probability_by_label.get("Buy", 0.0))
    not_buy_prob = float(
        probability_by_label.get("NotBuy", 0.0)
        or (probability_by_label.get("Wait", 0.0) + probability_by_label.get("Avoid", 0.0))
        or max(0.0, 1.0 - buy_prob)
    )
    binary_probabilities = {
        "Buy": round(buy_prob, 4),
        "NotBuy": round(not_buy_prob, 4),
    }
    binary_action = "Buy" if action == "Buy" else "NotBuy"
    selected_probability = binary_probabilities.get(binary_action, 0.0)
    confidence = "High" if selected_probability >= 0.68 else "Low" if selected_probability <= 0.45 else "Medium"
    predicted_low, predicted_high = _estimate_range_from_volatility(payload, current_price)
    buy_threshold = metadata.get("buyThreshold")
    threshold_text = ""
    if buy_threshold is not None:
        threshold_text = f"，二分類口徑以隔日報酬 >= {float(buy_threshold) * 100:.1f}% 為 Buy，其餘為 NotBuy"

    zh_action = "建議買" if binary_action == "Buy" else "觀望"

    return {
        "action": binary_action,
        "confidence": confidence,
        "predictedLow": predicted_low,
        "predictedHigh": predicted_high,
        "bias": binary_action,
        "newsImpact": payload.newsImpact,
        "newsSummary": payload.newsSummary,
        "summary": f"XGBoost 二分類模型判斷為 {zh_action}{threshold_text}。",
        "technical": [
            _momentum_label(feature_row.get("momentum_20", 0.0)),
            f"RSI {feature_row.get('rsi', 50.0):.1f}、MFI {feature_row.get('mfi', 50.0):.1f} 技術指標綜合研判",
            f"買進機率 {binary_probabilities.get('Buy', 0.0) * 100:.1f}%，觀望機率 {binary_probabilities.get('NotBuy', 0.0) * 100:.1f}%",
        ],
        "sentiment": {
            "label": payload.newsImpact or "neutral",
            "items": [seg.strip() for seg in str(payload.newsSummary or "").replace("；", "。").split("。") if seg.strip()][:2] or ["目前新聞面沒有明顯額外優勢"],
        },
        "watchPoints": [
            "是否站回短期均線",
            "量能是否放大並延續",
            "是否突破預測區間上緣",
        ],
        "modelVersion": f"{metadata.get('modelType', 'XGBoostClassifier')}-BinaryBuyNotBuy",
        "modelProbabilities": binary_probabilities,
        "rawModelAction": action,
        "rawModelProbabilities": probability_by_label,
    }


def _infer_with_price_model(payload: AIAnalyzeInput):
    bundle = _load_price_model()
    if not bundle:
        return None

    model = bundle.get("model")
    metadata = bundle.get("metadata") or {}
    if model is None:
        return None

    current_price = _safe_float(payload.currentPrice)
    if current_price is None or current_price <= 0:
        return None

    feature_row = _features_for_price_model(payload, current_price)
    if feature_row is None:
        return None

    feature_names = metadata.get("featureNames") or list(feature_row.keys())
    X = pd.DataFrame([{name: feature_row.get(name, 0.0) for name in feature_names}]).fillna(0.0)
    try:
        predicted_return = float(model.predict(X)[0])
    except Exception:
        logger.exception("Price model inference failed")
        return None

    predicted_mid = current_price * (1.0 + predicted_return)
    historical_rmse = _safe_float(metadata.get("rmse")) or abs(predicted_mid - current_price)

    rsi = _safe_float(payload.indicators.rsi)
    mfi = _safe_float(payload.indicators.mfi)
    sequence_vol = _safe_float(feature_row.get("volatility_20")) or 0.0

    base_width_pct = 0.03
    weak_penalty = 0.0
    if rsi is not None:
        if rsi <= 30:
            weak_penalty += 0.02
        elif rsi >= 70:
            weak_penalty += 0.015
        elif abs(rsi - 50) < 10:
            weak_penalty -= 0.005
    if mfi is not None:
        if mfi <= 35:
            weak_penalty += 0.02
        elif mfi >= 65:
            weak_penalty += 0.015
        elif abs(mfi - 50) < 10:
            weak_penalty -= 0.005

    volatility_pct = min(max(sequence_vol * 4.0, 0.005), 0.12)
    rmse_pct = min(max((historical_rmse / max(current_price, 1e-9)) * 0.75, 0.01), 0.10)
    width_pct = min(max(base_width_pct + weak_penalty + volatility_pct + rmse_pct, 0.02), 0.15)
    range_width = max(current_price * width_pct, predicted_mid * 0.01)
    predicted_low = max(0.0, round(predicted_mid - range_width, 2))
    predicted_high = round(predicted_mid + range_width, 2)

    deviation = abs(predicted_mid - current_price) / max(current_price, 1e-9)
    confidence_score = int(round(max(0.0, min(1.0, 1.0 - min(deviation / 0.12, 1.0))) * 100))
    if predicted_mid > current_price * 1.005:
        action = "Buy"
    else:
        action = "NotBuy"

    return {
        "action": action,
        "confidence": "High" if confidence_score >= 67 else "Low" if confidence_score <= 35 else "Medium",
        "predictedLow": predicted_low,
        "predictedHigh": predicted_high,
        "summary": f"20日序列回歸預測中位價約為 {predicted_mid:.2f}，預期報酬率 {predicted_return * 100:.2f}% 。",
        "technical": [
            f"模型使用 20 日序列特徵，最近報酬率約 {feature_row['lag_1_return'] * 100:.2f}%",
            f"20 日動能約 {feature_row['momentum_20'] * 100:.2f}%",
            f"區間寬度綜合 RSI/MFI/波動率/RMSE 後設定為 ±{width_pct * 100:.1f}%",
        ],
        "sentiment": {
            "label": "neutral",
            "items": ["此結果來自 20 日序列回歸推論，不是固定門檻規則"],
        },
        "watchPoints": [
            "20 日序列是否持續支持正報酬",
            "近期波動率是否升高",
            "後續實際價格是否驗證模型方向",
        ],
    }


def _fallback_ai_analysis(payload: AIAnalyzeInput):
    is_english = str(payload.language or "").lower().startswith("en")
    action, action_score = _score_action(payload)
    action = "Buy" if action == "Buy" else "NotBuy"
    current_price = _safe_float(payload.currentPrice)
    predicted_low, predicted_high = _estimate_range_from_volatility(payload, current_price)

    technical = []
    if payload.indicators.rsi is not None:
        if payload.indicators.rsi >= 70:
            technical.append("RSI remains elevated, suggesting short-term overheating pressure" if is_english else "RSI 偏高，短線有過熱壓力")
        elif payload.indicators.rsi <= 30:
            technical.append("RSI is low, so an oversold rebound is worth monitoring" if is_english else "RSI 偏低，留意超跌反彈可能")
        else:
            technical.append("RSI is in a neutral zone and should be treated as a supporting feature, not a standalone trigger" if is_english else "RSI 仍在中性區，僅作輔助特徵，不宜單獨決策")
    if payload.indicators.mfi is not None:
        if payload.indicators.mfi < 45:
            technical.append("MFI is soft and money flow remains weak" if is_english else "MFI 偏弱，資金動能仍不足")
        elif payload.indicators.mfi > 55:
            technical.append("MFI is firm and money flow is supportive" if is_english else "MFI 偏強，資金面提供支撐")
        else:
            technical.append("MFI is balanced and does not provide a strong edge yet" if is_english else "MFI 處於平衡區，尚未提供明確優勢")
    if payload.technicalSummary:
        technical.append(str(payload.technicalSummary).strip())
    technical = technical[:3] or (["No additional technical edge is available right now"] if is_english else ["目前技術面訊號有限，宜保守看待"])

    sentiment_label = "neutral"
    if any(word in (payload.newsImpact or "").lower() for word in ["positive", "bull"]):
        sentiment_label = "bullish"
    elif any(word in (payload.newsImpact or "").lower() for word in ["negative", "bear"]):
        sentiment_label = "bearish"

    sentiment_items = []
    if payload.newsSummary:
        sentiment_items = [seg.strip() for seg in str(payload.newsSummary).replace("；", "。").split("。") if seg.strip()][:2]
    if not sentiment_items:
        sentiment_items = ["No clear additional edge from current news"] if is_english else ["目前新聞面沒有明顯額外優勢"]

    confidence = "Medium"
    if action_score >= 70:
        confidence = "High"
    elif action_score <= 40:
        confidence = "Low"

    return _sanitize_analysis_output(payload.symbol, {
        "action": action,
        "confidence": confidence,
        "predictedLow": predicted_low,
        "predictedHigh": predicted_high,
        "summary": payload.technicalSummary or ("Signals are mixed, so waiting for a clearer direction is preferable." if is_english else "短線訊號偏混合，建議先等待更明確方向。"),
        "technical": technical,
        "sentiment": {
            "label": sentiment_label,
            "items": sentiment_items,
        },
        "watchPoints": [
            "Whether price reclaims short-term moving averages",
            "Whether volume expands and holds",
            "Whether price breaks above the projected range"
        ] if is_english else [
            "是否站回短期均線",
            "量能是否放大並延續",
            "是否突破預測區間上緣",
        ],
    })


@app.get("/api/ai/logs")
def ai_logs(limit: int = Query(0, ge=0, le=10000), symbol: str | None = Query(None)):
    logs = _load_predictions_log(symbol=symbol, limit=limit)
    return {
        "count": len(logs),
        "items": logs,
    }


@app.post("/api/ai/analyze")
def ai_analyze(payload: AIAnalyzeInput):
    try:
        model_result = _infer_with_action_model(payload)
        if model_result is None:
            model_result = _infer_with_price_model(payload)
        if model_result is not None:
            result = _sanitize_analysis_output(payload.symbol, model_result)
        else:
            result = _fallback_ai_analysis(payload)
    except Exception:
        logger.exception("ai_analyze failed for %s, using fallback", payload.symbol)
        result = _fallback_ai_analysis(payload)

    current_price = _safe_float(payload.currentPrice)
    predicted_low = _safe_float(result.get("predictedLow"))
    predicted_high = _safe_float(result.get("predictedHigh"))
    predicted_mid = None
    if predicted_low is not None and predicted_high is not None:
        predicted_mid = (predicted_low + predicted_high) / 2
    elif predicted_low is not None:
        predicted_mid = predicted_low
    elif predicted_high is not None:
        predicted_mid = predicted_high

    residual = None
    predicted_direction = None
    actual_direction = None
    is_correct = None
    if current_price is not None and predicted_mid is not None:
        residual = round(current_price - predicted_mid, 4)
        predicted_direction = "up" if predicted_mid >= current_price else "down"
        actual_direction = None
        is_correct = None

    log_entry = {
        "prediction_id": f"pred_{datetime.now(ZoneInfo('Asia/Taipei')).strftime('%Y%m%d_%H%M%S_%f')}",
        "symbol": payload.symbol.upper(),
        "companyName": payload.companyName,
        "model_version": result.get("modelVersion") or os.getenv("OLLAMA_MODEL", "gemma4:31b"),
        "predicted_at": datetime.now(ZoneInfo('Asia/Taipei')).isoformat(),
        "currentPrice": current_price,
        "predictedLow": predicted_low,
        "predictedHigh": predicted_high,
        "predictedMid": round(predicted_mid, 4) if predicted_mid is not None else None,
        "actualPrice": None,
        "residual": residual,
        "predictedDirection": predicted_direction,
        "actualDirection": actual_direction,
        "isCorrect": is_correct,
        "confidence": result.get("confidence"),
        "bias": result.get("bias"),
        "summary": result.get("summary"),
        "newsImpact": result.get("newsImpact"),
        "newsSummary": result.get("newsSummary"),
        "indicators": payload.indicators.model_dump(),
        "marketContext": payload.marketContext,
    }
    _append_predictions_log(log_entry)

    return {
        **result,
        "currentPrice": current_price,
        "actualPrice": None,
        "predictedMid": round(predicted_mid, 4) if predicted_mid is not None else None,
        "residual": residual,
        "predictedDirection": predicted_direction,
        "actualDirection": actual_direction,
        "isCorrect": is_correct,
        "predictionId": log_entry["prediction_id"],
    }


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _get_fundamentals_cache() -> dict:
    global _FUNDAMENTALS_CACHE
    if _FUNDAMENTALS_CACHE is not None:
        return _FUNDAMENTALS_CACHE
    result: dict = {}
    if FUNDAMENTALS_DIR.exists():
        for path in FUNDAMENTALS_DIR.glob("*.json"):
            try:
                data = json.loads(path.read_text(encoding="utf-8"))
                result[path.stem.upper()] = sorted(data, key=lambda x: x.get("available_from", ""))
            except Exception:
                pass
    _FUNDAMENTALS_CACHE = result
    return result


def _get_earnings_cache() -> dict:
    global _EARNINGS_CACHE
    if _EARNINGS_CACHE is not None:
        return _EARNINGS_CACHE
    _EARNINGS_CACHE = load_earnings_cache(EARNINGS_DIR)
    return _EARNINGS_CACHE


def _earnings_features_for_prediction(symbol: str, sequence: list[dict]) -> dict:
    if not sequence:
        return {
            "eps_surprise_pct": 0.0,
            "revenue_surprise_pct": 0.0,
            "earnings_beat": 0.0,
            "guidance_up": 0.0,
            "post_earnings_gap_pct": 0.0,
        }
    close_by_date = {}
    for point in sequence:
        date = str(point.get("date") or "").strip()
        close = _safe_float(point.get("close"))
        if date and close is not None:
            close_by_date[date] = close
    as_of_date = str(sequence[-1].get("date") or datetime.now().strftime("%Y-%m-%d"))
    return build_earnings_features(symbol, as_of_date, close_by_date, _get_earnings_cache())


def _apply_inference_noise_preprocessing(
    X: pd.DataFrame,
    clip_bounds: dict,
    log_features: list,
) -> pd.DataFrame:
    """Mirror of train_classifier_xgb._apply_noise_preprocessing for inference.
    Applies the IQR clip bounds and log1p transforms saved in the model bundle
    so the feature distribution at inference matches what the model was trained on.
    """
    import numpy as np
    X = X.copy()
    for col, bounds in clip_bounds.items():
        if col in X.columns and bounds.get("lo") is not None:
            X[col] = X[col].clip(lower=bounds["lo"], upper=bounds["hi"])
    for col in log_features:
        if col in X.columns:
            X[col] = np.log1p(X[col].clip(lower=0))
    return X


def _fundamental_features_for_prediction(symbol: str, current_price: float) -> dict:
    import math as _math
    today = datetime.now().strftime("%Y-%m-%d")
    records = _get_fundamentals_cache().get(symbol.upper(), [])
    applicable = [r for r in records if r.get("available_from", "9999") <= today]
    if not applicable:
        return {"pe_ratio_log": 0.0, "profit_margin": 0.0, "eps_growth": 0.0, "revenue_growth": 0.0, "has_fundamentals": 0.0}
    rec = applicable[-1]
    eps = rec.get("eps")
    pe_log = 0.0
    if eps is not None and eps > 0 and current_price > 0:
        pe = current_price / eps
        pe_log = _math.log(max(min(pe, 500.0), 1.0)) - _math.log(25.0)
    return {
        "pe_ratio_log": pe_log,
        "profit_margin": float(rec.get("profit_margin") or 0.0),
        "eps_growth": float(min(max(rec.get("eps_growth") or 0.0, -1.0), 3.0)),
        "revenue_growth": float(min(max(rec.get("revenue_growth") or 0.0, -0.5), 2.0)),
        "has_fundamentals": 1.0,
    }


def _init_db():
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("""
            CREATE TABLE IF NOT EXISTS predictions (
                prediction_id  TEXT PRIMARY KEY,
                symbol         TEXT,
                companyName    TEXT,
                model_version  TEXT,
                predicted_at   TEXT,
                currentPrice   REAL,
                predictedLow   REAL,
                predictedHigh  REAL,
                predictedMid   REAL,
                actualPrice    REAL,
                residual       REAL,
                predictedDirection TEXT,
                actualDirection    TEXT,
                isCorrect      INTEGER,
                confidence     TEXT,
                bias           TEXT,
                summary        TEXT,
                newsImpact     TEXT,
                newsSummary    TEXT,
                indicators     TEXT,
                marketContext  TEXT
            )
        """)
        conn.commit()


def _migrate_json_to_db():
    if not PREDICTIONS_LOG_PATH.exists():
        return
    try:
        data = json.loads(PREDICTIONS_LOG_PATH.read_text(encoding="utf-8"))
    except Exception:
        return
    if not isinstance(data, list) or not data:
        return
    with sqlite3.connect(DB_PATH) as conn:
        if conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0] > 0:
            return
        for entry in data:
            if not isinstance(entry, dict):
                continue
            try:
                conn.execute(_INSERT_SQL, _entry_to_row(entry))
            except Exception:
                pass
        conn.commit()


_INSERT_SQL = """
    INSERT OR IGNORE INTO predictions (
        prediction_id, symbol, companyName, model_version, predicted_at,
        currentPrice, predictedLow, predictedHigh, predictedMid,
        actualPrice, residual, predictedDirection, actualDirection, isCorrect,
        confidence, bias, summary, newsImpact, newsSummary,
        indicators, marketContext
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
"""


def _entry_to_row(entry: dict) -> tuple:
    is_correct = entry.get("isCorrect")
    indicators = entry.get("indicators")
    return (
        entry.get("prediction_id"),
        entry.get("symbol"),
        entry.get("companyName"),
        entry.get("model_version"),
        entry.get("predicted_at"),
        _safe_float(entry.get("currentPrice")),
        _safe_float(entry.get("predictedLow")),
        _safe_float(entry.get("predictedHigh")),
        _safe_float(entry.get("predictedMid")),
        _safe_float(entry.get("actualPrice")),
        _safe_float(entry.get("residual")),
        entry.get("predictedDirection"),
        entry.get("actualDirection"),
        int(is_correct) if is_correct is not None else None,
        entry.get("confidence"),
        entry.get("bias"),
        entry.get("summary"),
        entry.get("newsImpact"),
        entry.get("newsSummary"),
        json.dumps(indicators, ensure_ascii=False) if indicators is not None else None,
        entry.get("marketContext"),
    )


def _row_to_entry(row: sqlite3.Row) -> dict:
    entry = dict(row)
    raw = entry.get("indicators")
    if raw:
        try:
            entry["indicators"] = json.loads(raw)
        except Exception:
            entry["indicators"] = {}
    if entry.get("isCorrect") is not None:
        entry["isCorrect"] = bool(entry["isCorrect"])
    return entry


def _load_predictions_log(symbol: str | None = None, limit: int = 0) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        conn.row_factory = sqlite3.Row
        params: list = []
        where = "WHERE symbol = ?" if symbol else ""
        if symbol:
            params.append(symbol.upper())

        if limit > 0:
            rows = conn.execute(
                f"SELECT * FROM predictions {where} ORDER BY predicted_at DESC LIMIT ?",
                params + [limit],
            ).fetchall()
            return [_row_to_entry(r) for r in reversed(rows)]

        rows = conn.execute(
            f"SELECT * FROM predictions {where} ORDER BY predicted_at ASC",
            params,
        ).fetchall()
        return [_row_to_entry(r) for r in rows]


def _append_predictions_log(entry: dict):
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute(_INSERT_SQL, _entry_to_row(entry))
        conn.commit()


_init_db()
_migrate_json_to_db()


def _load_tw_stocks():
    global _TW_STOCKS_CACHE
    if _TW_STOCKS_CACHE is not None:
        return _TW_STOCKS_CACHE

    if not TW_STOCKS_PATH.exists():
        _TW_STOCKS_CACHE = []
        return _TW_STOCKS_CACHE

    try:
        _TW_STOCKS_CACHE = json.loads(TW_STOCKS_PATH.read_text(encoding="utf-8"))
    except Exception:
        logger.exception("Failed to load TW stocks list from %s", TW_STOCKS_PATH)
        _TW_STOCKS_CACHE = []

    return _TW_STOCKS_CACHE


def _normalize_search_text(text: str) -> str:
    return "".join(str(text or "").strip().lower().split())


def _get_tw_index():
    global _TW_STOCKS_INDEX
    if _TW_STOCKS_INDEX is not None:
        return _TW_STOCKS_INDEX

    stocks = _load_tw_stocks()
    by_code = {}
    by_symbol = {}
    prepared = []

    for item in stocks:
        symbol = str(item.get("symbol", "")).upper()
        code = str(item.get("code") or symbol.split(".")[0]).strip()
        name = str(item.get("name", "")).strip()
        exchange = item.get("exchange", "")
        quote_type = item.get("type", "EQUITY")

        prepared_item = {
            "symbol": symbol,
            "code": code,
            "name": name,
            "exchange": exchange,
            "type": quote_type,
            "nameNormalized": _normalize_search_text(name),
            "symbolNormalized": symbol.lower(),
            "codeNormalized": code.lower(),
        }
        prepared.append(prepared_item)
        by_symbol[symbol] = prepared_item
        by_code[code] = prepared_item

    _TW_STOCKS_INDEX = {
        "prepared": prepared,
        "by_code": by_code,
        "by_symbol": by_symbol,
    }
    return _TW_STOCKS_INDEX


def normalize_symbol(symbol: str) -> str:
    return symbol.strip().upper()


def _lookup_tw_symbol(symbol: str):
    normalized = normalize_symbol(symbol)
    if not normalized.isdigit():
        return None

    target = normalized.strip()
    item = _get_tw_index()["by_code"].get(target)
    return item["symbol"] if item else None


def candidate_symbols(symbol: str):
    normalized = normalize_symbol(symbol)

    if "." in normalized:
        return [normalized]

    if normalized.isdigit():
        resolved_tw_symbol = _lookup_tw_symbol(normalized)
        ordered = []

        if resolved_tw_symbol:
            ordered.append(resolved_tw_symbol)

            if resolved_tw_symbol.endswith(".TW"):
                ordered.append(f"{normalized}.TWO")
            elif resolved_tw_symbol.endswith(".TWO"):
                ordered.append(f"{normalized}.TW")
        else:
            ordered.extend([f"{normalized}.TW", f"{normalized}.TWO"])

        ordered.append(normalized)

        deduped = []
        for item in ordered:
            if item not in deduped:
                deduped.append(item)
        return deduped

    return [normalized]


@app.get("/debug_symbol/{symbol}")
def debug_symbol(symbol: str):
    return {
        "input": symbol,
        "normalized": normalize_symbol(symbol),
        "lookup": _lookup_tw_symbol(symbol),
        "candidates": candidate_symbols(symbol),
    }


def _safe_fast_info(ticker):
    try:
        data = getattr(ticker, "fast_info", {}) or {}
        return dict(data)
    except Exception:
        return {}


def _safe_info(ticker):
    try:
        data = getattr(ticker, "info", {}) or {}
        return dict(data)
    except Exception:
        return {}


def _normalize_session(market_state):
    if not market_state:
        return None
    state = str(market_state).upper()
    if "PRE" in state:
        return "pre"
    if "POST" in state or "AFTER" in state:
        return "post"
    if "REGULAR" in state or "OPEN" in state:
        return "regular"
    if "CLOSED" in state or "CLOSE" in state:
        return "closed"
    return state.lower()


def _is_tw_market_symbol(symbol: str) -> bool:
    upper = (symbol or "").upper()
    return upper.endswith(".TW") or upper.endswith(".TWO")


def _market_time_window(symbol: str):
    if _is_tw_market_symbol(symbol):
        return {
            "tz": ZoneInfo("Asia/Taipei"),
            "pre_start": None,
            "regular_start": 9 * 60,
            "regular_end": 13 * 60 + 30,
            "post_end": None,
        }

    return {
        "tz": ZoneInfo("America/New_York"),
        "pre_start": 4 * 60,
        "regular_start": 9 * 60 + 30,
        "regular_end": 16 * 60,
        "post_end": 20 * 60,
    }


def _current_market_phase(symbol: str):
    window = _market_time_window(symbol)
    now = datetime.now(window["tz"])
    current_minutes = now.hour * 60 + now.minute

    pre_start = window["pre_start"]
    regular_start = window["regular_start"]
    regular_end = window["regular_end"]
    post_end = window["post_end"]

    if pre_start is not None and pre_start <= current_minutes < regular_start:
        return "pre"
    if regular_start <= current_minutes <= regular_end:
        return "regular"
    if post_end is not None and regular_end < current_minutes <= post_end:
        return "post"
    return "closed"


def _infer_session_from_time(symbol: str, has_pre_price, has_post_price):
    phase = _current_market_phase(symbol)
    if phase == "pre":
        return "pre" if has_pre_price else "closed"
    if phase == "post":
        return "post" if has_post_price else "closed"
    return phase


def _default_valuation_scenarios():
    return [
        {"id": "bear", "label": "Bear", "revenueGrowthRate": 0.15, "expectedNetMargin": 0.25, "exitPE": 20.0},
        {"id": "base", "label": "Base", "revenueGrowthRate": 0.28, "expectedNetMargin": 0.30, "exitPE": 30.0},
        {"id": "bull", "label": "Bull", "revenueGrowthRate": 0.35, "expectedNetMargin": 0.35, "exitPE": 40.0},
    ]


def _default_tw_eps_pe_scenarios(bucket: str):
    presets = {
        "food": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.95, "targetPE": 12.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.05, "targetPE": 16.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.15, "targetPE": 20.0},
        ],
        "high_end_pcb": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.9, "targetPE": 22.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 27.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.1, "targetPE": 30.0},
        ],
        "electronic_components": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.85, "targetPE": 10.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 14.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.15, "targetPE": 18.0},
        ],
        "semiconductors": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.9, "targetPE": 15.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 20.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.15, "targetPE": 25.0},
        ],
        "shipping": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.7, "targetPE": 6.0},
            {"id": "base", "label": "Base", "epsMultiplier": 0.9, "targetPE": 8.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.1, "targetPE": 10.0},
        ],
        "building_materials": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.85, "targetPE": 10.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 14.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.15, "targetPE": 18.0},
        ],
        "chemicals_materials": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.9, "targetPE": 8.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 10.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.1, "targetPE": 12.0},
        ],
        "financials": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.9, "targetPE": 8.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 10.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.1, "targetPE": 12.0},
        ],
        "default": [
            {"id": "bear", "label": "Bear", "epsMultiplier": 0.9, "targetPE": 10.0},
            {"id": "base", "label": "Base", "epsMultiplier": 1.0, "targetPE": 14.0},
            {"id": "bull", "label": "Bull", "epsMultiplier": 1.15, "targetPE": 18.0},
        ],
    }
    return presets.get(bucket, presets["default"])


def _tw_industry_bucket(symbol, info):
    industry = (info.get("industry") or "").lower()
    sector = (info.get("sector") or "").lower()
    name = (info.get("longName") or info.get("shortName") or "").lower()
    upper_symbol = (symbol or "").upper()

    if upper_symbol in {"2313.TW", "2368.TW", "2383.TW"}:
        return "high_end_pcb"
    if "food" in industry or "packaged foods" in industry or sector == "consumer defensive":
        return "food"
    if "insurance" in industry or sector == "financial services":
        return "financials"
    if "shipping" in industry or "marine shipping" in industry:
        return "shipping"
    if "building materials" in industry or "glass" in name:
        return "building_materials"
    if "chemical" in industry or sector == "basic materials":
        return "chemicals_materials"
    if "semiconductor" in industry:
        return "semiconductors"
    if "electronic component" in industry or "printed circuit" in industry or "computer hardware" in industry or "pcb" in name or "satellite" in name or "hdi" in name:
        return "electronic_components"
    return "default"


def _valuation_overrides(symbol: str):
    return _SYMBOL_RULES.get((symbol or "").upper(), {}).get("valuation", {})


def _resolved_current_price(info, fast_info):
    return _safe_float(
        (info or {}).get("currentPrice")
        or (info or {}).get("regularMarketPrice")
        or (fast_info or {}).get("lastPrice")
        or (fast_info or {}).get("regularMarketPrice")
    )


def _adr_adjusted_revenue_per_share(symbol, info, fast_info):
    upper = (symbol or "").upper()
    if upper != "TSM":
        return None

    revenue_per_share = _safe_float((info or {}).get("revenuePerShare"))
    shares_outstanding = _safe_float((info or {}).get("sharesOutstanding") or (fast_info or {}).get("shares"))
    total_revenue = _safe_float((info or {}).get("totalRevenue"))

    if revenue_per_share in (None, 0) or shares_outstanding in (None, 0) or total_revenue in (None, 0):
        return None

    implied_shares = total_revenue / revenue_per_share if revenue_per_share not in (None, 0) else None
    if implied_shares in (None, 0):
        return None

    adr_ratio = implied_shares / shares_outstanding
    if adr_ratio <= 1:
        return None

    return revenue_per_share / adr_ratio


def _load_analyst_30d(symbol: str):
    """以「最近三個月」為主回傳 (mean, low, high, count)。
    近三個月評等不足(<3 筆)時回 None,改由 yfinance 即時 consensus 接手(避免用到過時舊目標)。"""
    try:
        from datetime import date, timedelta
        path = BASE_DIR / "data" / "analyst_ratings" / f"{symbol.upper()}.json"
        if not path.exists():
            return None, None, None, 0
        data = json.loads(path.read_text(encoding="utf-8"))
        ratings = data.get("ratings", [])
        cutoff = (date.today() - timedelta(days=90)).isoformat()   # 最近三個月
        recent = [r for r in ratings if r.get("GradeDate", "") >= cutoff and r.get("cur") is not None]
        if len(recent) < 3:
            return None, None, None, 0   # 交給即時 consensus
        targets = [float(r["cur"]) for r in recent]
        return sum(targets) / len(targets), min(targets), max(targets), len(targets)
    except Exception:
        return None, None, None, 0


def _build_us_valuation_inputs(symbol, info, fast_info):
    overrides = _valuation_overrides(symbol)

    current_price = _resolved_current_price(info, fast_info)

    # Use local 30-day cache first (avoids stale Yahoo consensus)
    cached_mean, cached_low, cached_high, cached_count = _load_analyst_30d(symbol)
    analyst_target_low = cached_low or _safe_float(info.get("targetLowPrice"))
    analyst_target_mean = cached_mean or _safe_float(info.get("targetMeanPrice") or info.get("targetMedianPrice"))
    analyst_target_high = cached_high or _safe_float(info.get("targetHighPrice"))
    analyst_count = cached_count or int(info.get("numberOfAnalystOpinions") or 0)
    current_revenue_per_share = _adr_adjusted_revenue_per_share(symbol, info, fast_info)
    notes = overrides.get("notes")

    if current_revenue_per_share is None:
        current_revenue_per_share = _safe_float(info.get("revenuePerShare"))

    if current_revenue_per_share is None:
        total_revenue = _safe_float(info.get("totalRevenue"))
        shares_outstanding = _safe_float(info.get("sharesOutstanding") or fast_info.get("shares"))
        if total_revenue not in (None, 0) and shares_outstanding not in (None, 0):
            current_revenue_per_share = total_revenue / shares_outstanding

    trailing_eps = _safe_float(info.get("trailingEps") or info.get("epsTrailingTwelveMonths") or info.get("eps"))
    forward_eps = _safe_float(info.get("forwardEps"))
    base_eps = forward_eps or trailing_eps

    # Guard against obviously tiny / stale EPS placeholders for non-TW symbols.
    if base_eps is not None and abs(base_eps) < 0.5:
        heuristic_eps = None
        # Prefer the analyst mean / forward PE or trailing PE if available.
        if analyst_target_mean not in (None, 0):
            pe_candidates = [
                _safe_float(info.get("forwardPE")),
                _safe_float(info.get("trailingPE")),
            ]
            for pe in pe_candidates:
                if pe not in (None, 0):
                    heuristic_eps = analyst_target_mean / pe
                    break

        # Secondary fallback: if the stock is already trading near analyst mean,
        # use a simple ratio that better reflects the visible market scale.
        if heuristic_eps is None and analyst_target_mean not in (None, 0) and current_price not in (None, 0):
            heuristic_eps = (analyst_target_mean / current_price) * (base_eps or 1)

        if heuristic_eps is not None and abs(heuristic_eps) > abs(base_eps):
            base_eps = heuristic_eps
            forward_eps = forward_eps or heuristic_eps
            trailing_eps = trailing_eps or heuristic_eps
            notes = ((notes + " ") if notes else "") + "EPS fallback recalibrated because Yahoo EPS looked too small."

    if (symbol or '').upper() == 'TSM' and current_revenue_per_share is not None:
        notes = ((notes + " ") if notes else "") + "ADR revenue/share adjusted to avoid mixing Taiwan issuer revenue with ADR share count."

    normalized_revenue_per_share = _safe_float(overrides.get("normalizedRevenuePerShare")) or current_revenue_per_share
    holding_years = int(overrides.get("holdingYears") or 3)

    return {
        "modelType": "revenue_exit_pe",
        "holdingYears": holding_years,
        "currentPrice": current_price,
        "currentRevenuePerShare": current_revenue_per_share,
        "normalizedRevenuePerShare": normalized_revenue_per_share,
        "analystTargetLow": analyst_target_low,
        "analystTargetMean": analyst_target_mean,
        "analystTargetHigh": analyst_target_high,
        "analystCount": analyst_count,
        "notes": notes,
        "isCalibrated": normalized_revenue_per_share != current_revenue_per_share if normalized_revenue_per_share is not None and current_revenue_per_share is not None else False,
    }


def _build_tw_valuation_inputs(symbol, info, fast_info):
    current_price = _safe_float(
        info.get("currentPrice")
        or info.get("regularMarketPrice")
        or fast_info.get("lastPrice")
        or fast_info.get("regularMarketPrice")
    )
    trailing_eps = _safe_float(info.get("trailingEps") or info.get("epsTrailingTwelveMonths"))
    forward_eps = _safe_float(info.get("forwardEps"))
    base_eps = forward_eps or trailing_eps
    industry_bucket = _tw_industry_bucket(symbol, info)

    return {
        "modelType": "eps_pe",
        "holdingYears": 1,
        "currentPrice": current_price,
        "baseEPS": base_eps,
        "trailingEPS": trailing_eps,
        "forwardEPS": forward_eps,
        "industryBucket": industry_bucket,
        "analystTargetLow": None,
        "analystTargetMean": None,
        "analystTargetHigh": None,
        "analystCount": 0,
        "notes": f"TW v2.1 model: Target Price = Expected EPS × Target P/E ({industry_bucket.replace('_', ' ')} bucket).",
        "isCalibrated": False,
    }


def _compute_target_price(current_revenue_per_share, revenue_growth_rate, holding_years, expected_net_margin, exit_pe):
    return current_revenue_per_share * pow(1 + revenue_growth_rate, holding_years) * expected_net_margin * exit_pe


def _compute_expected_return(target_price, current_price, holding_years):
    if target_price in (None, 0) or current_price in (None, 0) or holding_years in (None, 0):
        return None
    try:
        return pow(target_price / current_price, 1.0 / holding_years) - 1
    except Exception:
        return None


def _sector_default_pe(info) -> float:
    sector = ((info or {}).get("sector") or "").lower()
    industry = ((info or {}).get("industry") or "").lower()
    if "semiconduct" in industry or "semiconduct" in sector:
        return 25.0
    if "software" in industry or "technology" in sector:
        return 28.0
    if "utilit" in sector:
        return 16.0
    if "financial" in sector or "bank" in industry:
        return 13.0
    if "energy" in sector or "oil" in industry:
        return 12.0
    if "defensive" in sector or "staple" in industry:
        return 18.0
    if "health" in sector:
        return 20.0
    return 20.0


def _fundamentals_driven_scenarios(info):
    """用該股真實基本面(淨利率/營收成長/PE)推導 Bear/Base/Bull,取代寫死的高成長假設。"""
    if not info:
        return None, None
    margin = _safe_float(info.get("profitMargins"))
    growth = _safe_float(info.get("revenueGrowth"))
    if growth is None:
        growth = _safe_float(info.get("earningsGrowth"))
    pe = _safe_float(info.get("forwardPE")) or _safe_float(info.get("trailingPE"))
    if margin is None and pe is None and growth is None:
        return None, None

    unprofitable = margin is not None and margin <= 0
    base_margin = 0.05 if (margin is None or margin <= 0) else margin
    base_margin = min(max(base_margin, 0.02), 0.45)
    base_growth = 0.05 if growth is None else growth
    base_growth = min(max(base_growth, 0.0), 0.40)
    base_pe = pe if (pe is not None and pe > 0) else _sector_default_pe(info)
    base_pe = min(max(base_pe, 8.0), 45.0)

    note = (f"情境由當前基本面推導(淨利率 {base_margin*100:.0f}%、營收成長 {base_growth*100:.0f}%、PE {base_pe:.0f})"
            + ("。註:目前淨利率為負,採保守假設。" if unprofitable else "。"))
    scenarios = [
        {"id": "bear", "label": "Bear", "revenueGrowthRate": round(base_growth*0.6, 4),
         "expectedNetMargin": round(base_margin*0.85, 4), "exitPE": round(base_pe*0.8, 1)},
        {"id": "base", "label": "Base", "revenueGrowthRate": round(base_growth, 4),
         "expectedNetMargin": round(base_margin, 4), "exitPE": round(base_pe, 1)},
        {"id": "bull", "label": "Bull", "revenueGrowthRate": round(min(base_growth*1.3, 0.5), 4),
         "expectedNetMargin": round(min(base_margin*1.15, 0.5), 4), "exitPE": round(min(base_pe*1.25, 50.0), 1)},
    ]
    return scenarios, note


def _build_us_valuation_payload(symbol, info, fast_info, scenarios=None):
    inputs = _build_us_valuation_inputs(symbol, info, fast_info)
    overrides = _valuation_overrides(symbol)
    # 優先序:呼叫端指定 > 人工 override > 基本面推導 > 寫死預設
    fd_scenarios, fd_note = _fundamentals_driven_scenarios(info)
    scenario_defs = scenarios or overrides.get("scenarios") or fd_scenarios or _default_valuation_scenarios()
    is_override = bool(scenarios or overrides.get("scenarios"))
    margin_val = _safe_float((info or {}).get("profitMargins"))
    unprofitable = margin_val is not None and margin_val <= 0
    outputs = []

    # 虧損股:營收×淨利×PE 不適用 → 改用分析師目標價區間
    if (not is_override and unprofitable
            and inputs.get("analystTargetMean") not in (None, 0)):
        cur = inputs["currentPrice"]
        yrs = inputs["holdingYears"]
        mean = inputs["analystTargetMean"]
        band = [
            ("bear", "Bear", inputs.get("analystTargetLow") or mean),
            ("base", "Base", mean),
            ("bull", "Bull", inputs.get("analystTargetHigh") or mean),
        ]
        for sid, lbl, tp in band:
            outputs.append({
                "id": sid, "label": lbl,
                "revenueGrowthRate": None, "expectedNetMargin": None, "exitPE": None,
                "targetPE": None, "expectedEPS": None,
                "targetPrice": round(tp, 2) if tp is not None else None,
                "compositeTargetPrice": round(tp, 2) if tp is not None else None,
                "expectedReturn": round(_compute_expected_return(tp, cur, yrs), 4)
                                  if _compute_expected_return(tp, cur, yrs) is not None else None,
            })
        inputs["notes"] = ((inputs["notes"] + " ") if inputs.get("notes") else "") \
            + "目前淨利率為負,營收×淨利×PE 模型不適用,改採分析師目標價區間。"
        scenario_defs = []   # 跳過下方計算
    elif not is_override and fd_note:
        inputs["notes"] = ((inputs["notes"] + " ") if inputs.get("notes") else "") + fd_note

    for scenario in scenario_defs:
        target_price = None
        expected_return = None
        if inputs["normalizedRevenuePerShare"] not in (None, 0):
            target_price = _compute_target_price(
                inputs["normalizedRevenuePerShare"],
                scenario["revenueGrowthRate"],
                inputs["holdingYears"],
                scenario["expectedNetMargin"],
                scenario["exitPE"],
            )
            expected_return = _compute_expected_return(target_price, inputs["currentPrice"], inputs["holdingYears"])

        composite_target_price = None
        if target_price is not None and inputs["analystTargetMean"] is not None:
            composite_target_price = (target_price * 0.4) + (inputs["analystTargetMean"] * 0.6)
        elif target_price is not None:
            composite_target_price = target_price

        outputs.append({
            "id": scenario["id"],
            "label": scenario["label"],
            "revenueGrowthRate": scenario["revenueGrowthRate"],
            "expectedNetMargin": scenario["expectedNetMargin"],
            "exitPE": scenario["exitPE"],
            "targetPE": None,
            "expectedEPS": None,
            "targetPrice": round(target_price, 2) if target_price is not None else None,
            "compositeTargetPrice": round(composite_target_price, 2) if composite_target_price is not None else None,
            "expectedReturn": round(expected_return, 4) if expected_return is not None else None,
        })

    return {
        "stock": symbol.upper(),
        "modelType": inputs["modelType"],
        "holdingYears": inputs["holdingYears"],
        "currentPrice": round(inputs["currentPrice"], 2) if inputs["currentPrice"] is not None else None,
        "currentRevenuePerShare": round(inputs["currentRevenuePerShare"], 4) if inputs["currentRevenuePerShare"] is not None else None,
        "normalizedRevenuePerShare": round(inputs["normalizedRevenuePerShare"], 4) if inputs["normalizedRevenuePerShare"] is not None else None,
        "baseEPS": None,
        "trailingEPS": None,
        "forwardEPS": None,
        "industryBucket": None,
        "analystTargetLow": round(inputs["analystTargetLow"], 2) if inputs["analystTargetLow"] is not None else None,
        "analystTargetMean": round(inputs["analystTargetMean"], 2) if inputs["analystTargetMean"] is not None else None,
        "analystTargetHigh": round(inputs["analystTargetHigh"], 2) if inputs["analystTargetHigh"] is not None else None,
        "analystCount": inputs["analystCount"],
        "isCalibrated": inputs["isCalibrated"],
        "notes": inputs["notes"],
        "scenarios": outputs,
    }


def _build_tw_valuation_payload(symbol, info, fast_info):
    inputs = _build_tw_valuation_inputs(symbol, info, fast_info)
    scenario_defs = _default_tw_eps_pe_scenarios(inputs["industryBucket"])
    outputs = []

    for scenario in scenario_defs:
        target_price = None
        expected_return = None
        expected_eps = None
        if inputs["baseEPS"] not in (None, 0):
            expected_eps = inputs["baseEPS"] * scenario["epsMultiplier"]
            target_price = expected_eps * scenario["targetPE"]
            expected_return = _compute_expected_return(target_price, inputs["currentPrice"], inputs["holdingYears"])

        outputs.append({
            "id": scenario["id"],
            "label": scenario["label"],
            "revenueGrowthRate": None,
            "expectedNetMargin": None,
            "exitPE": None,
            "targetPE": scenario["targetPE"],
            "expectedEPS": round(expected_eps, 2) if expected_eps is not None else None,
            "targetPrice": round(target_price, 2) if target_price is not None else None,
            "compositeTargetPrice": None,
            "expectedReturn": round(expected_return, 4) if expected_return is not None else None,
        })

    return {
        "stock": symbol.upper(),
        "modelType": inputs["modelType"],
        "holdingYears": inputs["holdingYears"],
        "currentPrice": round(inputs["currentPrice"], 2) if inputs["currentPrice"] is not None else None,
        "currentRevenuePerShare": None,
        "normalizedRevenuePerShare": None,
        "baseEPS": round(inputs["baseEPS"], 2) if inputs["baseEPS"] is not None else None,
        "trailingEPS": round(inputs["trailingEPS"], 2) if inputs["trailingEPS"] is not None else None,
        "forwardEPS": round(inputs["forwardEPS"], 2) if inputs["forwardEPS"] is not None else None,
        "industryBucket": inputs["industryBucket"],
        "analystTargetLow": None,
        "analystTargetMean": None,
        "analystTargetHigh": None,
        "analystCount": 0,
        "isCalibrated": inputs["isCalibrated"],
        "notes": inputs["notes"],
        "scenarios": outputs,
    }


def _build_valuation_payload(symbol, info, fast_info, scenarios=None):
    if _is_tw_market_symbol(symbol):
        return _build_tw_valuation_payload(symbol, info, fast_info)
    return _build_us_valuation_payload(symbol, info, fast_info, scenarios=scenarios)


def _company_snapshot(ticker):
    info = _safe_info(ticker)
    fast_info = _safe_fast_info(ticker)

    company_name = info.get("longName") or info.get("shortName") or info.get("displayName")
    market_cap = _safe_float(info.get("marketCap") or fast_info.get("marketCap"))
    open_price = _safe_float(info.get("open") or fast_info.get("open"))
    fifty_two_week_high = _safe_float(info.get("fiftyTwoWeekHigh") or info.get("yearHigh"))
    fifty_two_week_low = _safe_float(info.get("fiftyTwoWeekLow") or info.get("yearLow"))
    eps = _safe_float(info.get("trailingEps") or info.get("epsTrailingTwelveMonths") or info.get("eps"))
    if eps is not None and abs(eps) < 0.5:
        analyst_target_mean = _safe_float(info.get("targetMeanPrice") or info.get("targetMedianPrice"))
        trailing_pe = _safe_float(info.get("trailingPE"))
        forward_pe = _safe_float(info.get("forwardPE"))
        heuristic_eps = None
        if analyst_target_mean not in (None, 0) and trailing_pe not in (None, 0):
            heuristic_eps = analyst_target_mean / trailing_pe
        elif analyst_target_mean not in (None, 0) and forward_pe not in (None, 0):
            heuristic_eps = analyst_target_mean / forward_pe
        if heuristic_eps is not None and abs(heuristic_eps) >= abs(eps):
            eps = heuristic_eps
    pe_ratio = _safe_float(info.get("trailingPE") or info.get("forwardPE"))

    dividend_yield_raw = _safe_float(info.get("dividendYield") or info.get("trailingAnnualDividendYield"))
    if dividend_yield_raw is None:
        dividend_rate = _safe_float(info.get("dividendRate") or info.get("trailingAnnualDividendRate"))
        reference_price = _safe_float(info.get("previousClose") or info.get("currentPrice") or fast_info.get("lastPrice"))
        if dividend_rate is not None and reference_price not in (None, 0):
            dividend_yield = (dividend_rate / reference_price) * 100
        else:
            dividend_yield = None
    elif dividend_yield_raw < 0.01:
        dividend_yield = dividend_yield_raw * 100
    else:
        dividend_yield = dividend_yield_raw

    valuation = _build_valuation_payload(ticker.ticker if hasattr(ticker, "ticker") else (company_name or "UNKNOWN"), info, fast_info)

    return {
        "companyName": company_name,
        "marketCap": market_cap,
        "openPrice": open_price,
        "fiftyTwoWeekHigh": fifty_two_week_high,
        "fiftyTwoWeekLow": fifty_two_week_low,
        "eps": eps,
        "peRatio": pe_ratio,
        "dividendYield": dividend_yield,
        "valuation": valuation,
    }


def _contains_chinese(text: str) -> bool:
    return any("\u4e00" <= ch <= "\u9fff" for ch in text)


def _search_tw_stocks(query: str, limit: int):
    normalized = _normalize_search_text(query)
    if not normalized:
        return []

    prepared = _get_tw_index()["prepared"]
    scored = []

    for item in prepared:
        score = None
        code = item["codeNormalized"]
        symbol = item["symbolNormalized"]
        name = item["nameNormalized"]

        if normalized == code:
            score = 0
        elif normalized == symbol:
            score = 1
        elif code.startswith(normalized):
            score = 2
        elif symbol.startswith(normalized):
            score = 3
        elif name.startswith(normalized):
            score = 4
        elif normalized in name:
            score = 5
        elif normalized in code or normalized in symbol:
            score = 6

        if score is not None:
            scored.append((score, len(item["code"]), item["code"], {
                "symbol": item["symbol"],
                "name": item["name"],
                "exchange": item["exchange"],
                "type": item["type"],
            }))

    scored.sort(key=lambda x: (x[0], x[1], x[2]))
    return [entry[-1] for entry in scored[:limit]]


def _is_tw_symbol(symbol: str) -> bool:
    upper = (symbol or "").upper()
    return upper.endswith(".TW") or upper.endswith(".TWO")


def _tw_search_from_yahoo(query: str, limit: int):
    raw = yahoo_search(query)
    quotes = raw.get("quotes", []) if isinstance(raw, dict) else []
    results = []

    for item in quotes:
        symbol = item.get("symbol")
        if not symbol or not _is_tw_symbol(symbol):
            continue

        quote_type = item.get("quoteType") or ""
        if quote_type and quote_type not in {"EQUITY", "ETF", "MUTUALFUND", "INDEX"}:
            continue

        results.append({
            "symbol": symbol,
            "name": item.get("shortname") or item.get("longname") or symbol,
            "exchange": item.get("exchange") or item.get("exchDisp") or "",
            "type": quote_type,
        })

        if len(results) >= limit:
            break

    return results


def _looks_like_tw_query(query: str) -> bool:
    stripped = query.strip()
    return _contains_chinese(stripped) or stripped.isdigit() or stripped.upper().endswith(".TW") or stripped.upper().endswith(".TWO")


def _compute_rsi(closes, period=14):
    if len(closes) <= period:
        return None

    series = pd.Series(closes, dtype=float)
    delta = series.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)

    avg_gain = gain.rolling(window=period).mean()
    avg_loss = loss.rolling(window=period).mean()

    last_gain = avg_gain.iloc[-1]
    last_loss = avg_loss.iloc[-1]

    if pd.isna(last_gain) or pd.isna(last_loss):
        return None
    if last_loss == 0:
        return 100.0

    rs = last_gain / last_loss
    return round(100 - (100 / (1 + rs)), 2)


def _compute_mfi(highs, lows, closes, volumes, period=14):
    if min(len(highs), len(lows), len(closes), len(volumes)) <= period:
        return None

    df = pd.DataFrame({
        "high": pd.Series(highs, dtype=float),
        "low": pd.Series(lows, dtype=float),
        "close": pd.Series(closes, dtype=float),
        "volume": pd.Series(volumes, dtype=float),
    })

    typical = (df["high"] + df["low"] + df["close"]) / 3
    money_flow = typical * df["volume"]
    direction = typical.diff()

    positive_flow = money_flow.where(direction > 0, 0.0)
    negative_flow = money_flow.where(direction < 0, 0.0).abs()

    pos_sum = positive_flow.rolling(window=period).sum().iloc[-1]
    neg_sum = negative_flow.rolling(window=period).sum().iloc[-1]

    if pd.isna(pos_sum) or pd.isna(neg_sum):
        return None
    if neg_sum == 0:
        return 100.0

    mfr = pos_sum / neg_sum
    return round(100 - (100 / (1 + mfr)), 2)


def _resolve_list_price(symbol: str, quote_payload: dict):
    is_tw_symbol = _is_tw_market_symbol(symbol)
    if is_tw_symbol:
        return quote_payload.get("displayPrice") or quote_payload.get("regularPrice") or quote_payload.get("price")
    return quote_payload.get("regularPrice") or quote_payload.get("displayPrice") or quote_payload.get("price")


async def _fetch_watchlist_item(symbol: str):
    for resolved_symbol in candidate_symbols(symbol):
        try:
            quote_payload = await asyncio.to_thread(get_quote, resolved_symbol)
            if isinstance(quote_payload, dict) and quote_payload.get("error"):
                continue

            stock_payload = await asyncio.to_thread(get_stock_data, resolved_symbol, "1d")
            sparkline = stock_payload.get("data", []) if isinstance(stock_payload, dict) else []
            sparkline_prices = [item.get("price") for item in sparkline if item.get("price") is not None]

            company_name = quote_payload.get("companyName") or resolved_symbol.upper()
            list_price = _resolve_list_price(resolved_symbol, quote_payload)

            return {
                "symbol": resolved_symbol.upper(),
                "name": company_name,
                "price": round(list_price, 2) if list_price is not None else None,
                "previousClose": quote_payload.get("previousClose"),
                "change": quote_payload.get("change"),
                "sparkline": sparkline_prices,
            }
        except Exception as e:
            logger.warning("_fetch_watchlist_item failed for %s: %s", resolved_symbol, e)
            continue

    return {
        "symbol": normalize_symbol(symbol),
        "name": normalize_symbol(symbol),
        "price": None,
        "previousClose": None,
        "change": None,
        "sparkline": [],
    }


async def _cached_watchlist_response(symbols: list[str]):
    now = datetime.now().timestamp()
    ttl_seconds = 10
    normalized_key = tuple(symbols)
    cached = _WATCHLIST_CACHE.get(normalized_key)

    if cached and (now - cached["ts"]) < ttl_seconds:
        return cached["payload"]

    items = await asyncio.gather(*[_fetch_watchlist_item(symbol) for symbol in symbols])
    payload = {
        "symbols": symbols,
        "items": list(items),
        "basicItems": [
            {
                "symbol": item.get("symbol"),
                "name": item.get("name"),
                "price": item.get("price"),
                "previousClose": item.get("previousClose"),
                "change": item.get("change"),
            }
            for item in items
        ],
    }
    _WATCHLIST_CACHE[normalized_key] = {
        "ts": now,
        "payload": payload,
    }
    if len(_WATCHLIST_CACHE) > _WATCHLIST_CACHE_MAX:
        oldest = sorted(_WATCHLIST_CACHE, key=lambda k: _WATCHLIST_CACHE[k]["ts"])
        for k in oldest[:len(_WATCHLIST_CACHE) - _WATCHLIST_CACHE_MAX // 2]:
            del _WATCHLIST_CACHE[k]
    return payload


def _cache_get(bucket: str, key, ttl_seconds: int):
    now = datetime.now().timestamp()
    cached = _ENDPOINT_CACHE.get((bucket, key))
    if cached and (now - cached["ts"]) < ttl_seconds:
        return cached["payload"]
    return None


def _cache_set(bucket: str, key, payload):
    _ENDPOINT_CACHE[(bucket, key)] = {
        "ts": datetime.now().timestamp(),
        "payload": payload,
    }
    if len(_ENDPOINT_CACHE) > _ENDPOINT_CACHE_MAX:
        oldest = sorted(_ENDPOINT_CACHE, key=lambda k: _ENDPOINT_CACHE[k]["ts"])
        for k in oldest[:_ENDPOINT_CACHE_MAX // 4]:
            del _ENDPOINT_CACHE[k]
    return payload


def _cache_get_stale(bucket: str, key):
    cached = _ENDPOINT_CACHE.get((bucket, key))
    if cached:
        return cached["payload"]
    return None


async def _ollama_generate(prompt: str, schema: dict | None = None, model: str | None = None, think: bool | None = None) -> str:
    """think=False 會關掉 Gemma 4 / Qwen 的思考模式(隱藏的推理 token 常常比答案長十倍,對話用不到)。"""
    model = model or os.getenv("OLLAMA_MODEL", "gemma4:31b")
    payload: dict = {"model": model, "prompt": prompt, "stream": False}
    if think is not None:
        payload["think"] = think
    if schema:
        payload["format"] = schema
    async with httpx.AsyncClient(timeout=300.0) as client:
        response = await client.post("http://127.0.0.1:11434/api/generate", json=payload)
        response.raise_for_status()
    return response.json().get("response", "")


async def _ollama_stream(prompt: str, model: str | None = None, think: bool | None = None):
    """串流版 generate:逐段 yield 模型吐出的文字(給語音對話用,第一句到就能開始唸)。"""
    model = model or os.getenv("OLLAMA_MODEL", "gemma4:31b")
    payload: dict = {"model": model, "prompt": prompt, "stream": True}
    if think is not None:
        payload["think"] = think
    async with httpx.AsyncClient(timeout=300.0) as client:
        async with client.stream("POST", "http://127.0.0.1:11434/api/generate", json=payload) as response:
            response.raise_for_status()
            async for line in response.aiter_lines():
                if not line.strip():
                    continue
                try:
                    chunk = json.loads(line)
                except Exception:
                    continue
                delta = chunk.get("response")
                if delta:
                    yield delta
                if chunk.get("done"):
                    break


def _contains_enough_cjk(text: str) -> bool:
    if not text:
        return False
    cjk_count = sum(1 for ch in text if "\u4e00" <= ch <= "\u9fff")
    alpha_count = sum(1 for ch in text if ch.isalpha())
    return cjk_count >= 6 and cjk_count >= alpha_count / 2


def _sanitize_llm_tomorrow_output(raw: dict, fallback_price: float | None = None):
    bias = str(raw.get("bias") or "neutral").strip().lower()
    if bias not in {"up", "down", "flat", "neutral", "bullish", "bearish", "positive", "negative", "mixed", "cautious"}:
        bias = "neutral"

    if bias in {"bullish", "positive"}:
        bias = "up"
    elif bias in {"bearish", "negative"}:
        bias = "down"
    elif bias in {"neutral", "mixed", "cautious"}:
        bias = "flat"

    predicted_low = _safe_float(raw.get("predictedLow"))
    predicted_high = _safe_float(raw.get("predictedHigh"))
    if predicted_low is not None and predicted_high is not None and predicted_low > predicted_high:
        predicted_low, predicted_high = predicted_high, predicted_low

    if fallback_price is not None:
        if predicted_low is None:
            predicted_low = round(fallback_price * 0.98, 2)
        if predicted_high is None:
            predicted_high = round(fallback_price * 1.02, 2)

    confidence = str(raw.get("confidence") or "medium").strip().lower()
    if confidence not in {"low", "medium", "high"}:
        if "high" in confidence:
            confidence = "high"
        elif "low" in confidence:
            confidence = "low"
        else:
            confidence = "medium"

    if bias == "down" and confidence == "high":
        predicted_mid = None
        if predicted_low is not None and predicted_high is not None:
            predicted_mid = (predicted_low + predicted_high) / 2
        if fallback_price is not None and (predicted_mid is None or predicted_mid >= fallback_price * 0.99):
            bias = "flat"
            confidence = "medium"

    news_impact = str(raw.get("newsImpact") or "neutral").strip().lower()
    if news_impact not in {"positive", "negative", "neutral", "bullish", "bearish"}:
        news_impact = "neutral"
    if news_impact == "bullish":
        news_impact = "positive"
    elif news_impact == "bearish":
        news_impact = "negative"

    summary = str(raw.get("summary") or "")[:280].strip()
    news_summary = str(raw.get("newsSummary") or "")[:280].strip()

    return {
        "bias": bias,
        "predictedLow": round(predicted_low, 2) if predicted_low is not None else None,
        "predictedHigh": round(predicted_high, 2) if predicted_high is not None else None,
        "confidence": confidence,
        "summary": summary,
        "newsImpact": news_impact,
        "newsSummary": news_summary,
    }


def _signal_from_indicators(rsi, mfi):
    if rsi is None and mfi is None:
        return "-"
    if rsi is not None and mfi is not None:
        if rsi >= 60 and mfi >= 60:
            return "強勢"
        if rsi <= 45 and mfi <= 45:
            return "主力出貨"
        return "中性"
    if rsi is not None:
        return "強勢" if rsi >= 60 else "主力出貨" if rsi <= 45 else "中性"
    return "強勢" if mfi >= 60 else "主力出貨" if mfi <= 45 else "中性"


def _attach_indicators(payload, highs, lows, closes, volumes):
    rsi = _compute_rsi(closes)
    mfi = _compute_mfi(highs, lows, closes, volumes)
    payload["rsi"] = rsi
    payload["mfi"] = mfi
    payload["signal"] = _signal_from_indicators(rsi, mfi)
    return payload


def _parse_news_item(item):
    content = item.get("content", {}) if isinstance(item, dict) else {}
    title = content.get("title") or item.get("title")
    if not title:
        return None

    raw_url = (
        (content.get("clickThroughUrl") or {}).get("url")
        or (content.get("canonicalUrl") or {}).get("url")
        or item.get("link")
    )
    provider = (content.get("provider") or {}).get("displayName") or ""
    published_at = content.get("pubDate") or content.get("displayTime") or ""
    summary = content.get("summary") or content.get("description") or ""
    thumbnail = ((content.get("thumbnail") or {}).get("resolutions") or [{}])
    image_url = thumbnail[-1].get("url") if thumbnail else None

    domain = ""
    if raw_url:
        try:
            domain = urlparse(raw_url).netloc
        except Exception:
            domain = ""

    return {
        "id": content.get("id") or item.get("id") or title,
        "title": title,
        "summary": summary,
        "url": raw_url,
        "provider": provider,
        "publishedAt": published_at,
        "imageUrl": image_url,
        "domain": domain,
    }


@app.get("/search")
def search_symbols(q: str = Query(..., min_length=1), limit: int = Query(8, ge=1, le=20)):
    try:
        seen = set()
        results = []
        query = q.strip()
        is_tw_query = _looks_like_tw_query(query)

        if is_tw_query:
            local_results = _search_tw_stocks(query, limit)
            for item in local_results:
                symbol = item["symbol"]
                if symbol in seen:
                    continue
                seen.add(symbol)
                results.append(item)

            # 台股查詢優先本地清單；只有完全沒命中時才補打 Yahoo
            if results:
                return {"query": q, "results": results[:limit]}

            for item in _tw_search_from_yahoo(query, limit):
                symbol = item["symbol"]
                if symbol in seen:
                    continue
                seen.add(symbol)
                results.append(item)

            if results:
                return {"query": q, "results": results[:limit]}

        raw = yahoo_search(query)
        quotes = raw.get("quotes", []) if isinstance(raw, dict) else []

        for item in quotes:
            symbol = item.get("symbol")
            name = item.get("shortname") or item.get("longname") or symbol
            exchange = item.get("exchange") or item.get("exchDisp") or ""
            quote_type = item.get("quoteType") or ""

            if not symbol or symbol in seen:
                continue
            if quote_type and quote_type not in {"EQUITY", "ETF", "MUTUALFUND", "INDEX"}:
                continue

            seen.add(symbol)
            results.append({
                "symbol": symbol,
                "name": name,
                "exchange": exchange,
                "type": quote_type,
            })

            if len(results) >= limit:
                break

        return {"query": q, "results": results[:limit]}
    except Exception as e:
        return {"error": f"搜尋失敗: {str(e)}", "results": []}


@app.get("/watchlist")
async def get_watchlist(symbols: str = Query(..., min_length=1)):
    requested = [normalize_symbol(item) for item in symbols.split(",") if item.strip()]
    deduped = []
    for item in requested:
        if item not in deduped:
            deduped.append(item)

    return await _cached_watchlist_response(deduped)


def _corr_label(c: float) -> str:
    if c >= 0.8:
        return "twin"          # 雙胞胎:假分散
    if c >= 0.6:
        return "high"          # 高度連動
    if c >= 0.3:
        return "moderate"      # 中度連動
    if c > -0.3:
        return "independent"   # 獨立
    return "inverse"           # 反向互補


def _load_close_series(sym: str, days: int) -> pd.Series | None:
    """從本機 history_10y 快取讀收盤序列(index=date);不足或缺檔回 None。"""
    path = BASE_DIR / "data" / "history_10y" / f"{sym}.json"
    if not path.exists():
        return None
    try:
        rows = json.loads(path.read_text(encoding="utf-8"))
        closes = {r["date"]: float(r["close"]) for r in rows[-(days + 10):]
                  if r.get("date") and r.get("close")}
        if len(closes) < 20:
            return None
        return pd.Series(closes).sort_index().tail(days + 1)
    except Exception:
        return None


def _correlation_report(symbols: list[str], days: int = 63) -> dict:
    """計算持股間日報酬相關性矩陣 + 分散度評級。days=63 約為 3 個月。"""
    series = {}
    missing = []
    for sym in symbols:
        s = _load_close_series(sym, days)
        if s is not None:
            series[sym] = s
        else:
            missing.append(sym)

    if len(series) < 2:
        return {"symbols": symbols, "missing": missing, "pairs": [],
                "avgCorrelation": None, "grade": None,
                "note": "需要至少 2 支有本機歷史資料的股票"}

    df = pd.DataFrame(series).dropna()
    rets = df.pct_change().dropna()
    corr = rets.corr()

    pairs = []
    syms = list(corr.columns)
    for i in range(len(syms)):
        for j in range(i + 1, len(syms)):
            c = float(corr.iloc[i, j])
            pairs.append({
                "a": syms[i], "b": syms[j],
                "correlation": round(c, 2),
                "label": _corr_label(c),
            })
    pairs.sort(key=lambda p: -p["correlation"])

    avg = float(pd.Series([p["correlation"] for p in pairs]).mean())
    if avg < 0.2:
        grade, verdict = "A", "分散良好:持股間大多獨立漲跌"
    elif avg < 0.4:
        grade, verdict = "B", "分散尚可:部分持股連動"
    elif avg < 0.55:
        grade, verdict = "C", "連動偏高:一半以上的漲跌是同一件事"
    elif avg < 0.7:
        grade, verdict = "D", "假分散:多數持股同漲同跌"
    else:
        grade, verdict = "F", "極度集中:整個組合等於單一賭注"

    twins = [p for p in pairs if p["label"] == "twin"]
    warnings = [
        f'{p["a"]}+{p["b"]} 相關 {p["correlation"]:.2f}:同漲同跌,等於同一注下兩次'
        for p in twins[:5]
    ]

    return {
        "symbols": syms,
        "missing": missing,
        "days": int(len(rets)),
        "pairs": pairs,
        "avgCorrelation": round(avg, 2),
        "grade": grade,
        "verdict": verdict,
        "warnings": warnings,
    }


@app.get("/watchlist/correlation")
async def get_watchlist_correlation(symbols: str = Query(..., min_length=1), days: int = Query(63, ge=20, le=252)):
    """持股健康檢查:兩兩相關性 + 分散度評級(A~F)。用本機日線快取計算。"""
    requested = [normalize_symbol(item) for item in symbols.split(",") if item.strip()]
    deduped = list(dict.fromkeys(requested))
    if len(deduped) > 20:
        raise HTTPException(status_code=400, detail="最多 20 支股票")
    return await asyncio.to_thread(_correlation_report, deduped, days)


@app.get("/llm-tomorrow/{symbol}")
async def get_llm_tomorrow(symbol: str, lang: str = Query("en")):
    normalized_lang = "zh" if str(lang).lower().startswith("zh") else "en"
    cache_key = (normalize_symbol(symbol), normalized_lang)
    cached = _cache_get("llm_tomorrow", cache_key, 300)
    if cached is not None:
        return cached

    stock_payload, quote_payload, earnings_payload, ratings_payload, valuation_payload, news_payload = await asyncio.gather(
        asyncio.to_thread(get_stock_data, symbol, "1mo"),
        asyncio.to_thread(get_quote, symbol),
        asyncio.to_thread(get_earnings, symbol, 4),
        asyncio.to_thread(get_ratings, symbol),
        asyncio.to_thread(get_valuation, symbol),
        asyncio.to_thread(get_news, symbol, 5),
    )

    current_price = _safe_float(
        quote_payload.get("regularPrice")
        or quote_payload.get("displayPrice")
        or quote_payload.get("price")
    )

    latest_news_titles = [item.get("title") for item in news_payload.get("items", [])[:3] if item.get("title")]

    language_instruction = "Respond in Traditional Chinese." if normalized_lang == "zh" else "Respond in English."

    prompt = f"""
You are a balanced stock-analysis assistant.
Return only valid JSON with keys: bias, predictedLow, predictedHigh, confidence, summary, newsImpact, newsSummary.
Use bias from: up, down, flat.
Use confidence from: low, medium, high.
Summary must be one short sentence under 220 characters.
Do not include markdown.
{language_instruction}

Important rules:
- Weigh bullish and bearish evidence fairly.
- If the evidence is mixed or unclear, use flat.
- Use down only when the negative evidence is clear and dominant.
- Do not assign high confidence to down unless the projected range is clearly below current price.
- Use high confidence only when the evidence is strong and aligned.
- For newsImpact, do not rely only on explicit earnings headlines.
- If financial impact is not explicit, infer sentiment from industry and macro signals such as AI demand, cloud spending, semiconductor cycle, competition intensity, pricing pressure, regulation, tariffs, geopolitics, and supply-chain trends.
- Use positive when recent headlines imply improving demand, stronger adoption, favorable positioning, or easing risk.
- Use negative when recent headlines imply weakening demand, tougher competition, export limits, geopolitical pressure, regulatory risk, or supply-chain stress.
- Use neutral only when the combined news signal is genuinely mixed or weak after considering those broader factors.

Stock: {normalize_symbol(symbol)}
Current price: {current_price}
Session: {quote_payload.get('session')}
Change: {quote_payload.get('change')}
Change percent: {quote_payload.get('changePercent')}
RSI: {stock_payload.get('rsi')}
MFI: {stock_payload.get('mfi')}
Signal: {stock_payload.get('signal')}
Analyst mean target: {valuation_payload.get('analystTargetMean')}
Analyst count: {valuation_payload.get('analystCount')}
Valuation scenarios: {valuation_payload.get('scenarios')}
Ratings total: {ratings_payload.get('total')}
Ratings strongBuy: {ratings_payload.get('strongBuy')}, buy: {ratings_payload.get('buy')}, hold: {ratings_payload.get('hold')}, sell: {ratings_payload.get('sell')}, strongSell: {ratings_payload.get('strongSell')}
Earnings next date: {earnings_payload.get('nextEarningsDate')}
Recent earnings items: {earnings_payload.get('items')}
Top news headlines: {latest_news_titles}

Estimate only the next trading day's likely price range and directional bias using the provided data.
In newsSummary, explicitly mention the likely driver behind the news sentiment when possible (for example AI demand, competition, geopolitics, regulation, tariffs, or supply chain).
Be balanced, realistic, and avoid one-sided pessimism.
""".strip()

    schema = {
        "type": "object",
        "properties": {
            "bias": {"type": "string"},
            "predictedLow": {"type": "number"},
            "predictedHigh": {"type": "number"},
            "confidence": {"type": "string"},
            "summary": {"type": "string"},
            "newsImpact": {"type": "string"},
            "newsSummary": {"type": "string"},
        },
        "required": ["bias", "predictedLow", "predictedHigh", "confidence", "summary", "newsImpact", "newsSummary"],
    }

    try:
        raw_response = await _ollama_generate(prompt, schema=schema)
        parsed = json.loads(raw_response)
        cleaned = _sanitize_llm_tomorrow_output(parsed, fallback_price=current_price)

        if normalized_lang == "zh" and (not _contains_enough_cjk(cleaned.get("summary", "")) or not _contains_enough_cjk(cleaned.get("newsSummary", ""))):
            retry_prompt = prompt + "\nIMPORTANT: summary and newsSummary must be Traditional Chinese only. Do not mix English words unless they are stock tickers."
            raw_response = await _ollama_generate(retry_prompt, schema=schema)
            parsed = json.loads(raw_response)
            cleaned = _sanitize_llm_tomorrow_output(parsed, fallback_price=current_price)

        payload = {
            "stock": normalize_symbol(symbol),
            **cleaned,
            "source": os.getenv("OLLAMA_MODEL", "gemma4:31b"),
            "lang": normalized_lang,
        }
        return _cache_set("llm_tomorrow", cache_key, payload)
    except Exception as e:
        fallback = {
            "stock": normalize_symbol(symbol),
            "bias": "flat",
            "predictedLow": round(current_price * 0.98, 2) if current_price is not None else None,
            "predictedHigh": round(current_price * 1.02, 2) if current_price is not None else None,
            "confidence": "low",
            "summary": "技術面訊號偏中性，先顯示保守區間。" if normalized_lang == "zh" else "Technical signals look neutral; showing a conservative range.",
            "newsImpact": "neutral",
            "newsSummary": "最新新聞整體偏中性，暫未看到明確利多或利空。" if normalized_lang == "zh" else "Recent headlines look neutral without a clear bullish or bearish catalyst.",
            "source": "fallback",
            "lang": normalized_lang,
            "error": str(e),
        }
        return _cache_set("llm_tomorrow", cache_key, fallback)


_SECTOR_MAP_CACHE: dict | None = None


def _load_sector_map() -> dict:
    global _SECTOR_MAP_CACHE
    if _SECTOR_MAP_CACHE is None:
        try:
            _SECTOR_MAP_CACHE = json.loads((BASE_DIR / "data" / "sector_map.json").read_text(encoding="utf-8"))
        except Exception:
            _SECTOR_MAP_CACHE = {}
    return _SECTOR_MAP_CACHE


def _market_leadership_context() -> str:
    """從漲幅榜組出「當前市場主線」:領先個股清單 + 主導族群,讓 LLM 判讀主題(如 AI 伺服器/記憶體/光通訊)。"""
    try:
        data = json.loads(TOP_GAINERS_PATH.read_text(encoding="utf-8"))
        items = (((data.get("windows") or {}).get("1y") or {}).get("items") or [])[:15]
    except Exception:
        return ""
    if not items:
        return ""
    smap = _load_sector_map()
    from collections import Counter
    counter = Counter(smap.get(i.get("symbol", ""), "Other") for i in items)
    top_sectors = ", ".join(f"{s} ({c})" for s, c in counter.most_common(3))
    leaders = ", ".join(f"{i.get('symbol')} +{i.get('changePct', 0) * 100:.0f}%" for i in items[:12])
    return (f"Current 1-year market leaders (biggest gainers right now): {leaders}\n"
            f"Dominant sectors among the leaders: {top_sectors}")


async def _build_ai_context(symbol: str) -> tuple[str, float | None]:
    """收集個股資料,組成給 LLM 的精簡上下文(報告與問答共用)。"""
    stock_payload, quote_payload, earnings_payload, ratings_payload, valuation_payload, news_payload = await asyncio.gather(
        asyncio.to_thread(get_stock_data, symbol, "3mo"),
        asyncio.to_thread(get_quote, symbol),
        asyncio.to_thread(get_earnings, symbol, 4),
        asyncio.to_thread(get_ratings, symbol),
        asyncio.to_thread(get_valuation, symbol),
        asyncio.to_thread(get_news, symbol, 5),
    )
    current_price = _safe_float(
        quote_payload.get("regularPrice") or quote_payload.get("displayPrice") or quote_payload.get("price")
    )
    news_titles = [item.get("title") for item in news_payload.get("items", [])[:5] if item.get("title")]

    # 技術訊號:MA / VWAP / MACD / 大戶出金(複用 /signals 計算)
    sig = {}
    try:
        su = (symbol or "").strip().upper()
        spath = BASE_DIR / "data" / "history_10y" / f"{su}.json"
        if spath.exists():
            srows = json.loads(spath.read_text(encoding="utf-8"))
            if srows:
                sig = _compute_signals(su, srows)
    except Exception:
        sig = {}

    # 52 週位階:距離高/低點多遠
    wk_high = _safe_float(quote_payload.get("fiftyTwoWeekHigh"))
    wk_low = _safe_float(quote_payload.get("fiftyTwoWeekLow"))
    pct_from_high = pct_from_low = None
    if current_price and wk_high:
        pct_from_high = round((current_price / wk_high - 1.0) * 100, 1)
    if current_price and wk_low:
        pct_from_low = round((current_price / wk_low - 1.0) * 100, 1)

    macd_cross = None
    if sig.get("macd") is not None and sig.get("macdSignal") is not None:
        macd_cross = "above signal (bullish)" if sig["macd"] > sig["macdSignal"] else "below signal (bearish)"

    sym_u = (symbol or "").strip().upper()
    sector = _load_sector_map().get(sym_u, "Unknown")
    market_ctx = _market_leadership_context()

    ctx = f"""Stock: {normalize_symbol(symbol)}
Sector: {sector}
Current price: {current_price}
Change percent: {quote_payload.get('changePercent')}
RSI: {stock_payload.get('rsi')}  MFI: {stock_payload.get('mfi')}  Signal: {stock_payload.get('signal')}
MA(14): {sig.get('ma')}  VWAP(14): {sig.get('vwap')}
MACD: {sig.get('macd')}  MACD signal: {sig.get('macdSignal')}  ({macd_cross})
Large-holder outflow (主力出貨): {sig.get('moneyOutflow')}
52-week high: {wk_high} (price is {pct_from_high}% from high)  52-week low: {wk_low} ({pct_from_low}% above low)
Analyst mean target: {valuation_payload.get('analystTargetMean')} (count {valuation_payload.get('analystCount')})
Ratings — strongBuy {ratings_payload.get('strongBuy')}, buy {ratings_payload.get('buy')}, hold {ratings_payload.get('hold')}, sell {ratings_payload.get('sell')}, strongSell {ratings_payload.get('strongSell')}
Next earnings: {earnings_payload.get('nextEarningsDate')}
Recent earnings: {earnings_payload.get('items')}
Valuation scenarios: {valuation_payload.get('scenarios')}
Recent headlines: {news_titles}

=== Market context (for theme judgement) ===
{market_ctx}"""
    return ctx, current_price


def _compute_signals(su: str, rows: list, period: int = 14, fast: int = 12,
                     slow: int = 26, signal: int = 9) -> dict:
    """由歷史資料現算技術訊號:price / RSI / MA / VWAP / MACD / 大戶出金。"""
    last = rows[-1]
    price = _safe_float(last.get("close"))
    closes = [_safe_float(r.get("close")) for r in rows if _safe_float(r.get("close")) is not None]
    vols = [(_safe_float(r.get("close")), _safe_float(r.get("volume"))) for r in rows]

    # MA(period):近 period 日簡單均線
    ma = sum(closes[-period:]) / period if len(closes) >= period else None

    # VWAP:近 period 日成交量加權均價(typical price = (h+l+c)/3)
    vwap = None
    tp_rows = [(_safe_float(r.get("high")), _safe_float(r.get("low")), _safe_float(r.get("close")), _safe_float(r.get("volume"))) for r in rows[-period:]]
    tp_rows = [(h, l, c, v) for h, l, c, v in tp_rows if h and l and c and v]
    if tp_rows:
        num = sum(((h + l + c) / 3.0) * v for h, l, c, v in tp_rows)
        den = sum(v for _, _, _, v in tp_rows)
        vwap = num / den if den else None

    # MACD(fast/slow/signal,預設 12/26/9)
    macd_val = macd_sig = None
    if len(closes) >= slow + signal:
        def _ema(vals, n):
            k = 2.0 / (n + 1); e = vals[0]; out = [e]
            for v in vals[1:]:
                e = v * k + e * (1 - k); out.append(e)
            return out
        ema_fast = _ema(closes, fast); ema_slow = _ema(closes, slow)
        macd_line = [a - b for a, b in zip(ema_fast, ema_slow)]
        signal_line = _ema(macd_line, signal)
        macd_val = macd_line[-1]; macd_sig = signal_line[-1]

    # RSI(period) 直接由收盤價現算(最新一根可能沒存)
    rsi = None
    if len(closes) >= period + 1:
        gains, losses = [], []
        for i in range(-period, 0):
            ch = closes[i] - closes[i - 1]
            gains.append(max(ch, 0.0)); losses.append(max(-ch, 0.0))
        avg_g = sum(gains) / period; avg_l = sum(losses) / period
        rsi = 100.0 if avg_l == 0 else 100.0 - 100.0 / (1.0 + avg_g / avg_l)

    # 大戶出金:近20日「跌日」成交額明顯大於「漲日」+ 近20日下跌 + 有量(>$30M)
    outflow = False
    recent = [(c, v) for c, v in vols[-21:] if c and v]
    if len(recent) >= 10:
        up_dollar = sum(c * v for i, (c, v) in enumerate(recent) if i > 0 and c >= recent[i - 1][0])
        down_dollar = sum(c * v for i, (c, v) in enumerate(recent) if i > 0 and c < recent[i - 1][0])
        avg_dollar = sum(c * v for c, v in recent) / len(recent)
        mom20 = (recent[-1][0] / recent[0][0] - 1.0) if recent[0][0] else 0.0
        outflow = bool(down_dollar > up_dollar * 1.3 and mom20 < 0 and avg_dollar > 30e6)

    return {
        "symbol": su,
        "asOf": last.get("date"),
        "price": round(price, 2) if price is not None else None,
        "rsi": round(rsi, 1) if rsi is not None else None,
        "rsiPeriod": period,
        "ma": round(ma, 2) if ma is not None else None,
        "vwap": round(vwap, 2) if vwap is not None else None,
        "macd": round(macd_val, 3) if macd_val is not None else None,
        "macdSignal": round(macd_sig, 3) if macd_sig is not None else None,
        "moneyOutflow": outflow,
    }


# ---------------- 推播(APNs) ----------------
import push as _push
from pydantic import BaseModel as _PB


class PushRegisterInput(_PB):
    token: str
    platform: str = "ios"
    lang: str = "zh"


class PushAlertsInput(_PB):
    token: str
    alerts: list[dict] = []
    watchlist: list[str] = []


_push.init_db()
_push_scheduler = _push.Scheduler(
    compute_signals=lambda su, rows, period, fast, slow, signal: _compute_signals(su, rows, period, fast, slow, signal),
    get_quote=lambda sym: get_quote(sym),
    get_earnings=lambda sym, limit: get_earnings(sym, limit),
    history_dir=BASE_DIR / "data" / "history_10y",
)


@app.on_event("startup")
async def _start_push_scheduler():
    _push_scheduler.start()


@app.post("/push/register")
def push_register(payload: PushRegisterInput):
    """App 拿到裝置 token 後呼叫。"""
    _push.register_device(payload.token.strip(), payload.platform, "zh" if payload.lang.lower().startswith("zh") else "en")
    return {"ok": True}


@app.post("/push/alerts")
def push_alerts(payload: PushAlertsInput):
    """整組同步該裝置的提醒與自選(供伺服器在 App 關閉時評估、發財報提醒)。"""
    _push.sync_alerts(payload.token.strip(), payload.alerts, payload.watchlist)
    return {"ok": True}


@app.post("/push/test")
async def push_test(payload: PushRegisterInput):
    """測試用:對該 token 發一則。"""
    ok, info = await _push.APNs.send(payload.token.strip(), "CatInsight", "推播測試成功 🎉" if payload.lang.startswith("zh") else "Push test OK 🎉", {"kind": "test"})
    return {"ok": ok, "info": info}


@app.get("/push/stats")
def push_stats():
    return _push.stats()


@app.post("/push/run-now")
async def push_run_now():
    """測試用:立刻評估一次所有提醒(不管盤中)。"""
    sent = await _push_scheduler.evaluate_alerts()
    return {"sent": sent}


@app.get("/signals/{symbol}")
def get_signals(symbol: str, period: int = Query(14, ge=2, le=50),
                fast: int = Query(12, ge=2, le=100), slow: int = Query(26, ge=3, le=200),
                signal: int = Query(9, ge=2, le=100)):
    """回傳個股即時技術訊號(供提醒評估):price / RSI(可設 period) / 大戶出金。"""
    su = (symbol or "").strip().upper()
    path = BASE_DIR / "data" / "history_10y" / f"{su}.json"
    if not path.exists():
        raise HTTPException(status_code=404, detail="No data")
    rows = json.loads(path.read_text(encoding="utf-8"))
    if not rows:
        raise HTTPException(status_code=404, detail="No data")
    return _compute_signals(su, rows, period, fast, slow, signal)


@app.get("/api/ai/report/{symbol}")
async def get_ai_report(symbol: str, lang: str = Query("en")):
    """LLM 客觀簡短報告(不預測漲跌)。"""
    normalized_lang = "zh" if str(lang).lower().startswith("zh") else "en"
    cache_key = (normalize_symbol(symbol), normalized_lang)
    cached = _cache_get("ai_report", cache_key, 600)
    if cached is not None:
        return cached

    ctx, _ = await _build_ai_context(symbol)
    lang_line = "用繁體中文回答。" if normalized_lang == "zh" else "Respond in English."
    prompt = f"""You are a balanced equity research assistant. Ground your analysis in the data below; you MAY use general knowledge of the company's sector and current market themes to interpret it, but do NOT invent specific numbers, and do NOT predict tomorrow's price or give buy/sell advice. Be specific with the numbers provided. {lang_line}

Write 5-7 short bullet points, each one sentence, covering:
- valuation vs analyst targets
- profitability / earnings trend
- momentum / technicals
- Theme: which market theme or group this name belongs to — infer from its sector and the "Market context" leaders list (e.g. AI compute, memory/storage, optical/AI networking, power/clean energy) — and whether that theme is currently leading the market.
- Demand quality: judge whether the driver behind this name looks like structural / essential ("剛需") demand or a cyclical / hype-driven surge, and briefly say what would sustain it versus what would break it. Be explicit about uncertainty — do not overclaim.
- the single key risk
- one-line summary of the recent headlines and what they point to; if none are meaningful, say news flow is quiet.

{ctx}"""
    try:
        report = (await _ollama_generate(prompt)).strip()
        payload = {"symbol": normalize_symbol(symbol), "report": report,
                   "source": os.getenv("OLLAMA_MODEL", "gemma4:31b"), "lang": normalized_lang}
        return _cache_set("ai_report", cache_key, payload)
    except Exception as e:
        return {"symbol": normalize_symbol(symbol), "report": "", "source": "error",
                "lang": normalized_lang, "error": str(e)}


class AIChatMessage(BaseModel):
    role: str
    content: str


class AIChatInput(BaseModel):
    symbol: str = ""
    lang: str = "en"
    messages: list[AIChatMessage] = []
    watchlist: list[str] = []
    voice: bool = False   # 語音模式:口語、簡短、不要條列/markdown


def _build_watchlist_context(symbols: list[str]) -> str:
    """從本機資料組出 watchlist 各股快照(價/動能/RSI/分析師上漲空間),供 AI 做健康分析。"""
    lines = []
    for raw in symbols[:50]:
        sym = (raw or "").strip().upper()
        if not sym:
            continue
        path = BASE_DIR / "data" / "history_10y" / f"{sym}.json"
        if not path.exists():
            lines.append(f"{sym}: 無本機資料")
            continue
        try:
            rows = json.loads(path.read_text(encoding="utf-8"))
            if not rows:
                lines.append(f"{sym}: 無資料")
                continue
            last = rows[-1]
            price = _safe_float(last.get("close")) or 0.0
            rsi = _safe_float(last.get("rsi14"))
            mom60 = None
            if len(rows) > 60 and _safe_float(rows[-60].get("close")):
                mom60 = price / float(rows[-60]["close"]) - 1.0
            # 分析師 consensus
            amean = None
            apath = BASE_DIR / "data" / "analyst_ratings" / f"{sym}.json"
            if apath.exists():
                c = (json.loads(apath.read_text(encoding="utf-8")).get("consensus") or {})
                amean = _safe_float(c.get("mean") or c.get("median"))
            upside = (amean / price - 1.0) if (amean and price) else None
            parts = [f"price {price:.2f}"]
            if mom60 is not None: parts.append(f"60d {mom60*100:+.0f}%")
            if rsi is not None: parts.append(f"RSI {rsi:.0f}")
            if upside is not None: parts.append(f"analyst upside {upside*100:+.0f}%")
            lines.append(f"{sym}: " + ", ".join(parts))
        except Exception:
            lines.append(f"{sym}: 讀取失敗")

    # 相關性/分散度摘要(持股 >= 2 支才算)
    cleaned = [s.strip().upper() for s in symbols[:20] if s and s.strip()]
    if len(cleaned) >= 2:
        try:
            rep = _correlation_report(cleaned)
            if rep.get("avgCorrelation") is not None:
                lines.append(
                    f"Diversification: avg pairwise correlation {rep['avgCorrelation']:.2f}, "
                    f"grade {rep['grade']} ({rep['verdict']})"
                )
                for w in rep.get("warnings", [])[:3]:
                    lines.append(f"  ⚠ {w}")
        except Exception:
            pass
    return "\n".join(lines)


# 使用者在對話中提到「別支股票」時,把那支的資料也帶進去(之前只有目前這支的資料,問 VRT 會說手邊沒有數據)
_TICKER_STOPWORDS = {"AI", "ETF", "CEO", "CFO", "RSI", "MACD", "PE", "EPS", "IPO", "USD", "OK", "GDP", "CPI", "FED", "US", "TW", "VWAP",
                     "MA", "YTD", "IT", "PM", "AM", "TV", "VS", "Q1", "Q2", "Q3", "Q4", "AND", "THE", "FOR", "NOT", "YOU", "ARE", "BUY", "SELL"}
_ZH_COMPANY_TICKERS = {"輝達": "NVDA", "英偉達": "NVDA", "台積電": "2330.TW", "台積": "2330.TW", "蘋果": "AAPL", "特斯拉": "TSLA", "微軟": "MSFT",
                       "亞馬遜": "AMZN", "谷歌": "GOOGL", "聯發科": "2454.TW", "鴻海": "2317.TW", "超微": "AMD", "博通": "AVGO", "網飛": "NFLX",
                       "英特爾": "INTC", "高通": "QCOM", "帕蘭泰爾": "PLTR", "美光": "MU", "甲骨文": "ORCL", "臉書": "META"}

_EN_COMPANY_TICKERS = {  # 英文公司名(不分大小寫)→ 代號;語音辨識常給「Apple」「Tesla」這種字而不是代號
    "apple": "AAPL", "tesla": "TSLA", "nvidia": "NVDA", "microsoft": "MSFT", "amazon": "AMZN", "google": "GOOGL", "alphabet": "GOOGL",
    "meta": "META", "facebook": "META", "netflix": "NFLX", "broadcom": "AVGO", "palantir": "PLTR", "intel": "INTC", "qualcomm": "QCOM",
    "micron": "MU", "oracle": "ORCL", "tsmc": "2330.TW", "mediatek": "2454.TW", "foxconn": "2317.TW", "vertiv": "VRT", "dell": "DELL",
    "marvell": "MRVL", "coherent": "COHR", "amd": "AMD", "salesforce": "CRM", "adobe": "ADBE", "costco": "COST", "walmart": "WMT",
    "uber": "UBER", "supermicro": "SMCI", "super micro": "SMCI", "arm": "ARM", "asml": "ASML", "eli lilly": "LLY", "lilly": "LLY",
    "novo nordisk": "NVO", "alibaba": "BABA", "pinduoduo": "PDD", "berkshire": "BRK-B", "jpmorgan": "JPM", "visa": "V", "mastercard": "MA",
    "coca cola": "KO", "coca-cola": "KO", "pepsi": "PEP", "disney": "DIS", "boeing": "BA", "starbucks": "SBUX", "nike": "NKE", "shopify": "SHOP",
    "spotify": "SPOT", "airbnb": "ABNB", "coinbase": "COIN", "microstrategy": "MSTR", "strategy": "MSTR", "rivian": "RIVN", "lucid": "LCID",
    "snowflake": "SNOW", "crowdstrike": "CRWD", "servicenow": "NOW", "applovin": "APP", "arista": "ANET", "cisco": "CSCO", "ibm": "IBM",
    "sandisk": "SNDK", "western digital": "WDC", "seagate": "STX", "rocket lab": "RKLB", "intuitive": "ISRG", "unitedhealth": "UNH",
    "exxon": "XOM", "chevron": "CVX", "gold": "GLD", "bitcoin": "BTC-USD", "ethereum": "ETH-USD", "s&p 500": "SPY", "nasdaq": "QQQ",
}

def _mentioned_symbols(text: str, exclude: str) -> list[str]:
    """從使用者這句話找出提到的股票代號(含語音辨識拆開的「V R T」、中文公司名),排除目前這支。最多 2 支。"""
    import unicodedata
    t = unicodedata.normalize("NFKC", text or "")          # 語音辨識常給全形字母「ＶＲＴ」→ 先轉半形
    t = re.sub(r"(?<![A-Za-z])([A-Z](?:\s?[A-Z]){1,4})(?![A-Za-z])", lambda m: m.group(1).replace(" ", ""), t)   # V R T / ＶＲＴ → VRT
    found: list[str] = []
    for m in re.finditer(r"(?<![A-Za-z0-9])(\d{4}(?:\.TW)?|[A-Z]{2,5})(?![A-Za-z0-9])", t):   # 中文夾英文沒有空白,不能用 \b
        tok = m.group(1)
        if tok.isdigit():
            tok = f"{tok}.TW"
        if tok in _TICKER_STOPWORDS:
            continue
        found.append(tok)
    for name, tk in _ZH_COMPANY_TICKERS.items():
        if name in t:
            found.append(tk)
    low = t.lower()
    for name, tk in _EN_COMPANY_TICKERS.items():                     # 英文公司名(整個字才算,避免 "arm" 對到 "farm")
        if re.search(r"(?<![a-z])" + re.escape(name) + r"(?![a-z])", low):
            found.append(tk)
    out: list[str] = []
    ex = normalize_symbol(exclude) if exclude else ""
    for tk in found:
        n = normalize_symbol(tk)
        if n and n != ex and n not in out:
            out.append(n)
    return out[:2]


# 對照表以外的公司名 → 用 Yahoo 搜尋自動找代號(中英文都可),結果快取一天
_NAME_LOOKUP_CACHE: dict[str, tuple[str | None, float]] = {}
_NAME_STOPWORDS = {"the", "can", "you", "please", "help", "me", "analyze", "analyse", "about", "what", "how", "is", "are", "stock", "stocks",
                   "share", "shares", "price", "today", "this", "that", "and", "or", "for", "with", "of", "in", "on", "to", "a", "an", "i",
                   "hi", "hello", "hey", "ok", "okay", "thanks", "thank", "ai", "us", "usa", "tw", "taiwan", "china", "market", "markets",
                   "buy", "sell", "hold", "now", "should", "would", "could", "do", "does", "did", "which", "why", "when", "where", "who",
                   "compare", "versus", "vs", "check", "look", "tell", "give", "show", "think", "good", "bad", "best", "top"}
_ZH_NAME_STOP = {"股票", "股價", "公司", "分析", "這支", "那支", "一下", "幫我", "我想", "請問", "可以", "看看", "現在", "今天", "最近", "怎麼樣", "怎樣", "如何",
                 "目前", "美股", "台股", "市場", "大盤", "自選", "清單", "組合", "持股", "新聞", "財報", "技術面", "基本面", "估值", "目標價", "走勢", "行情",
                 "你好", "謝謝", "小薇薇", "貓咪", "助理", "覺得", "認為", "值得", "適合", "還是", "或是", "跟", "和", "與", "的", "嗎", "呢"}

def _name_candidates(text: str) -> list[str]:
    """從句子裡挑出可能是公司名的片段:英文 1~3 個大寫開頭的字;中文則是「XX 的股票 / XX 股價 / 分析 XX」這種樣式抓 2~6 字"""
    import unicodedata
    t = unicodedata.normalize("NFKC", text or "")
    out: list[str] = []
    for m in re.finditer(r"(?<![A-Za-z])([A-Z][A-Za-z&\.\-]*(?:\s[A-Z][A-Za-z&\.\-]*){0,2})(?![A-Za-z])", t):
        name = m.group(1).strip()
        if name.lower() in _NAME_STOPWORDS or (name.isupper() and len(name) <= 5):   # 全大寫短字是代號,別的地方已處理
            continue
        out.append(name)
    zh_pat = (r"([\u4e00-\u9fff]{2,6})(?:的)?(?:股票|股價|這支|那支|公司|走勢|行情|財報|目標價)"
              r"|(?:分析|看一下|看看|查一下|查|聊聊|介紹|評估)\s*([\u4e00-\u9fff]{2,6})")
    for m in re.finditer(zh_pat, t):
        name = (m.group(1) or m.group(2) or "").strip()
        for stop in sorted(_ZH_NAME_STOP, key=len, reverse=True):     # 去掉黏在前後的功能詞(例如「分析蘋果的」→「蘋果」)
            if name.startswith(stop): name = name[len(stop):]
            if name.endswith(stop): name = name[:-len(stop)]
        if len(name) >= 2 and name not in _ZH_NAME_STOP:
            out.append(name)
    # 沒有「的股票 / 分析 XX」這類線索時(例如「台達電最近怎麼樣」):把中文片段裡的功能詞全部拿掉,剩 2~6 字就當候選
    strip = re.compile("|".join(sorted(map(re.escape, _ZH_NAME_STOP | {"最近", "現在", "今天", "可以買", "值得買", "好嗎", "如何", "吧", "啊", "喔", "耶",
                                                                         "我", "你", "他", "它", "想", "要", "讓", "叫", "是", "有", "沒有", "會", "了", "嗎"}), key=len, reverse=True)))
    for m in re.finditer(r"[\u4e00-\u9fff]{2,10}", t):
        name = strip.sub("", m.group(0))
        if 2 <= len(name) <= 6 and name not in out:
            out.append(name)
    seen: list[str] = []
    for n in out:
        if n not in seen: seen.append(n)
    return seen[:3]

_TW_NAME_MAP: dict[str, str] = {}
_TW_NAME_MAP_TS = 0.0

def _tw_name_map() -> dict[str, str]:
    """台股中文簡稱 → 代號(上市 .TW / 上櫃 .TWO),來自證交所與櫃買中心公開資料,快取在 data/tw_names.json,7 天更新一次"""
    global _TW_NAME_MAP, _TW_NAME_MAP_TS
    if _TW_NAME_MAP and time.time() - _TW_NAME_MAP_TS < 7 * 86400:
        return _TW_NAME_MAP
    cache = BASE_DIR / "data" / "tw_names.json"
    try:
        if cache.exists() and time.time() - cache.stat().st_mtime < 7 * 86400:
            _TW_NAME_MAP = json.loads(cache.read_text(encoding="utf-8")); _TW_NAME_MAP_TS = time.time()
            return _TW_NAME_MAP
    except Exception:
        pass
    m: dict[str, str] = {}
    # 證交所/櫃買的憑證用 Python 內建的 CA 會驗證失敗(Missing Subject Key Identifier),改用 macOS 系統信任鏈(truststore)
    try:
        import ssl as _ssl, truststore as _ts
        verify = _ts.SSLContext(_ssl.PROTOCOL_TLS_CLIENT)
    except Exception:
        verify = True
    try:
        r = httpx.get("https://openapi.twse.com.tw/v1/exchangeReport/STOCK_DAY_ALL", timeout=20.0, verify=verify)
        for row in r.json():
            code, name = (row.get("Code") or "").strip(), (row.get("Name") or "").strip()
            if code and name and len(code) in (4, 5) and code[:4].isdigit(): m.setdefault(name, f"{code}.TW")     # 4~5 碼:股票 / ETF,排除權證
    except Exception as e:
        logging.warning("twse name list failed: %s", e)
    try:
        r = httpx.get("https://www.tpex.org.tw/openapi/v1/tpex_mainboard_daily_close_quotes", timeout=20.0, verify=verify)
        for row in r.json():
            code, name = (row.get("SecuritiesCompanyCode") or "").strip(), (row.get("CompanyName") or "").strip()
            if code and name and len(code) in (4, 5) and code[:4].isdigit(): m.setdefault(name, f"{code}.TWO")
    except Exception as e:
        logging.warning("tpex name list failed: %s", e)
    if m:
        _TW_NAME_MAP = m; _TW_NAME_MAP_TS = time.time()
        try:
            cache.parent.mkdir(parents=True, exist_ok=True); cache.write_text(json.dumps(m, ensure_ascii=False), encoding="utf-8")
        except Exception:
            pass
    return _TW_NAME_MAP

def _lookup_symbol_by_name(name: str) -> str | None:
    """Yahoo 搜尋:拿第一個股票/ETF/加密貨幣結果;英文名要對得上名稱才收(避免亂對)"""
    key = name.lower()
    hit = _NAME_LOOKUP_CACHE.get(key)
    if hit and time.time() - hit[1] < 86400:
        return hit[0]
    result = None
    if any("一" <= ch <= "鿿" for ch in name):                       # 中文:先查台股簡稱表(Yahoo 搜尋不吃中文)
        tw = _tw_name_map()
        result = tw.get(name) or next((v for k, v in tw.items() if k.startswith(name) and len(k) - len(name) <= 1), None)
        if result:
            _NAME_LOOKUP_CACHE[key] = (result, time.time())
            return result
    try:
        raw = yahoo_search(name)
        quotes = raw.get("quotes", []) if isinstance(raw, dict) else []
        for q in quotes:
            sym = q.get("symbol") or ""
            qt = q.get("quoteType") or ""
            if not sym or qt not in {"EQUITY", "ETF", "CRYPTOCURRENCY", "INDEX"}:
                continue
            longname = ((q.get("longname") or "") + " " + (q.get("shortname") or "")).lower()
            is_cjk = any("一" <= ch <= "鿿" for ch in name)
            if is_cjk or key.split()[0] in longname or key in longname:
                result = sym
                break
    except Exception:
        result = None
    _NAME_LOOKUP_CACHE[key] = (result, time.time())
    return result

async def _resolve_company_names(text: str, exclude: list[str]) -> list[str]:
    out: list[str] = []
    for name in _name_candidates(text):
        sym = await asyncio.to_thread(_lookup_symbol_by_name, name)
        if sym:
            n = normalize_symbol(sym)
            if n and n not in exclude and n not in out:
                out.append(n)
    return out[:2]


async def _build_chat_prompt(payload: AIChatInput) -> tuple[str, str, str]:
    """組個股問答的提示詞。回傳 (prompt, 標準化代號, 語言)。"""
    sym = (payload.symbol or "").strip()
    ctx_block = ""
    if sym:
        ctx, _ = await _build_ai_context(sym)
        ctx_block = f"\n=== Stock data ({normalize_symbol(sym)}) ===\n{ctx}\n"

    # 若使用者問到 watchlist / 自選 / 股票池 / 組合,帶入 watchlist 各股快照
    last_user = next((m.content for m in reversed(payload.messages) if m.role == "user"), "")

    # 使用者提到別支股票 → 也把那支的資料帶進來(抓不到報價的就略過,避免把一般英文字當代號)
    others = _mentioned_symbols(last_user, sym)
    if len(others) < 2:                                                       # 對照表沒中的公司名 → Yahoo 自動查
        others += await _resolve_company_names(last_user, others + [normalize_symbol(sym)] if sym else others)
    for other in others[:2]:
        try:
            octx, oprice = await _build_ai_context(other)
            if oprice:
                ctx_block += f"\n=== Stock data ({other}) — the user just asked about this one ===\n{octx}\n"
        except Exception:
            continue

    # 語言:優先偵測使用者問句是否含中文字(跟著使用者語言),其次才看傳入的 lang
    has_cjk = any("一" <= ch <= "鿿" for ch in last_user)
    normalized_lang = "zh" if (has_cjk or str(payload.lang).lower().startswith("zh")) else "en"
    lang_line = ("請務必用繁體中文回答(股票代號可保留英文)。" if normalized_lang == "zh"
                 else "Respond in English.")
    wl_keywords = ("watchlist", "自選", "股票池", "清單", "組合", "portfolio", "持股", "health", "健康")
    if payload.watchlist and any(k in last_user.lower() for k in wl_keywords):
        wl_ctx = _build_watchlist_context(payload.watchlist)
        if wl_ctx:
            ctx_block += f"\n=== User's watchlist ({len(payload.watchlist)} stocks) ===\n{wl_ctx}\n"

    convo = ""
    for m in payload.messages[-12:]:
        who = "User" if m.role == "user" else "Assistant"
        convo += f"{who}: {m.content}\n"

    # 語音模式:像講話一樣,短、口語、不要條列與 markdown(App 會逐句唸出來)
    voice_line = ""
    if payload.voice:
        voice_line = ("\n這是語音對話:請用口語回答,2 到 3 句、100 字以內,不要條列、不要 markdown 符號、不要表情符號,數字直接講出來。提到公司請用公司名稱(輝達、台積電、蘋果),不要用股票代號。"
                      if normalized_lang == "zh" else
                      "\nThis is a voice conversation: answer conversationally in 2-3 short sentences (under 60 words), no bullet points, no markdown, no emojis. Refer to companies by name (NVIDIA, Apple, TSMC), not by ticker symbol.")

    prompt = f"""You are a balanced, factual equity research assistant.
Answer the user's question using any data provided and general market knowledge. If the user names a stock, focus on it; if a data block for that stock is provided, use it (do not say you have no data).
If a "User's watchlist" block is provided, you can assess the portfolio's health: concentration/diversification, momentum and overbought/oversold names (RSI), valuation vs analyst targets, and which holdings look strongest or weakest. Be specific per ticker.
Be concise and specific. Do NOT predict exact future prices or give direct buy/sell orders; explain trade-offs instead. {lang_line}{voice_line}
{ctx_block}
=== Conversation ===
{convo}Assistant:"""
    return prompt, (normalize_symbol(sym) if sym else ""), normalized_lang


@app.post("/api/ai/chat")
async def ai_chat(payload: AIChatInput):
    """個股問答:帶入該股上下文 + 對話歷史,回答使用者問題。"""
    prompt, out_sym, normalized_lang = await _build_chat_prompt(payload)
    try:
        reply = (await _ollama_generate(prompt, think=False)).strip()
        return {"symbol": out_sym, "reply": reply,
                "source": os.getenv("OLLAMA_MODEL", "gemma4:31b"), "lang": normalized_lang}
    except Exception as e:
        return {"symbol": out_sym, "reply": "",
                "source": "error", "lang": normalized_lang, "error": str(e)}


@app.post("/api/ai/chat/stream")
async def ai_chat_stream(payload: AIChatInput):
    """個股問答(串流版,給語音對話):NDJSON,每行 {"t": 片段};最後一行 {"done": true, "reply": 全文}。"""
    prompt, out_sym, normalized_lang = await _build_chat_prompt(payload)
    model = os.getenv("OLLAMA_MODEL", "gemma4:31b")

    async def gen():
        full = []
        try:
            async for delta in _ollama_stream(prompt, model=model, think=False):
                full.append(delta)
                yield json.dumps({"t": delta}, ensure_ascii=False) + "\n"
            yield json.dumps({"done": True, "symbol": out_sym, "reply": "".join(full).strip(),
                              "source": model, "lang": normalized_lang}, ensure_ascii=False) + "\n"
        except Exception as e:
            yield json.dumps({"done": True, "symbol": out_sym, "reply": "".join(full).strip(),
                              "source": "error", "lang": normalized_lang, "error": str(e)}, ensure_ascii=False) + "\n"

    return StreamingResponse(gen(), media_type="application/x-ndjson",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


# ---------- 高音質語音(代理到 tts_server.py,port 8004;Kokoro 英文 + CosyVoice 中文)----------
TTS_URL = os.getenv("TTS_URL", "http://127.0.0.1:8004")

class TTSBody(BaseModel):
    text: str
    voice: str = "auto"
    speed: float = 1.0
    mode: str = "stream"   # 串流端點用:stream(首段最快)/ whole(整句算完再送)

@app.get("/tts/voices")
async def tts_voices():
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.get(f"{TTS_URL}/tts/voices")
            return r.json()
    except Exception:
        raise HTTPException(503, "tts unavailable")

@app.post("/tts")
async def tts_proxy(body: TTSBody):
    """把文字轉成語音(WAV, 24kHz)。App 離線或這裡 503 時退回手機內建 TTS。"""
    try:
        async with httpx.AsyncClient(timeout=90.0) as client:
            r = await client.post(f"{TTS_URL}/tts", json=body.model_dump())
    except Exception:
        raise HTTPException(503, "tts unavailable")
    if r.status_code != 200:
        raise HTTPException(r.status_code, r.text[:200])
    from fastapi.responses import Response as _Resp
    return _Resp(r.content, media_type="audio/wav", headers={k: v for k, v in r.headers.items() if k.lower().startswith("x-")})

@app.post("/tts/stream")
async def tts_stream_proxy(body: TTSBody):
    """串流版:raw PCM16 mono 24kHz,邊生成邊送;App 用 AVAudioEngine 邊收邊播。"""
    client = httpx.AsyncClient(timeout=httpx.Timeout(120.0, connect=5.0))
    try:
        req = client.build_request("POST", f"{TTS_URL}/tts/stream", json=body.model_dump())
        r = await client.send(req, stream=True)
    except Exception:
        await client.aclose()
        raise HTTPException(503, "tts unavailable")
    if r.status_code != 200:
        body_text = (await r.aread())[:200]
        await r.aclose(); await client.aclose()
        raise HTTPException(r.status_code, body_text.decode(errors="ignore"))
    async def relay():
        try:
            async for chunk in r.aiter_bytes():
                yield chunk
        finally:
            await r.aclose(); await client.aclose()
    return StreamingResponse(relay(), media_type="audio/L16",
                             headers={k: v for k, v in r.headers.items() if k.lower().startswith("x-")} | {"Cache-Control": "no-store"})

@app.get("/news-digest/{symbol}")
async def get_news_digest(symbol: str, lang: str = Query("zh"), limit: int = Query(8, ge=3, le=15)):
    """AI 幫你讀新聞:把最近幾則新聞交給本地模型,回 3 句話的摘要 + 整體偏多/偏空/中性。快取 30 分鐘。"""
    normalized_lang = "zh" if str(lang).lower().startswith("zh") else "en"
    sym = normalize_symbol(symbol)
    cache_key = (sym, normalized_lang)
    cached = _cache_get("news_digest", cache_key, 1800)
    if cached is not None:
        return cached

    news_payload = await asyncio.to_thread(get_news, sym, limit)
    items = [i for i in news_payload.get("items", []) if i.get("title")]
    if not items:
        return {"symbol": sym, "sentiment": "neutral", "summary": "", "count": 0, "lang": normalized_lang}

    lines = []
    for i in items[:limit]:
        t = str(i.get("title") or "").strip()
        summ = str(i.get("summary") or "").strip()[:220]
        when = str(i.get("publishedAt") or "")[:10]
        lines.append(f"- [{when}] {t}" + (f" — {summ}" if summ else ""))
    news_block = "\n".join(lines)

    if normalized_lang == "zh":
        instr = ("請用繁體中文、口語、剛好 3 句話,告訴一般投資人這幾則新聞對這檔股票整體是好是壞、原因是什麼、要注意什麼。"
                 "不要條列、不要 markdown、不要重複標題、不要給買賣指令。")
    else:
        instr = ("In exactly 3 plain sentences, tell a retail investor whether this news is overall good or bad for the stock, why, "
                 "and what to watch. No bullet points, no markdown, do not repeat headlines, no buy/sell instructions.")
    prompt = f"""You are a balanced equity news analyst.
Return only valid JSON with keys: sentiment, summary.
sentiment must be one of: positive, negative, neutral.
{instr}

Stock: {sym}
Recent headlines:
{news_block}
"""
    schema = {"type": "object",
              "properties": {"sentiment": {"type": "string"}, "summary": {"type": "string"}},
              "required": ["sentiment", "summary"]}
    try:
        raw = await _ollama_generate(prompt, schema=schema, think=False)
        parsed = json.loads(raw)
        sentiment = str(parsed.get("sentiment") or "neutral").strip().lower()
        if sentiment not in ("positive", "negative", "neutral"):
            sentiment = "neutral"
        summary = str(parsed.get("summary") or "").strip()
        if normalized_lang == "zh" and not _contains_enough_cjk(summary):
            raw = await _ollama_generate(prompt + "\nIMPORTANT: summary must be Traditional Chinese only.", schema=schema, think=False)
            parsed = json.loads(raw)
            summary = str(parsed.get("summary") or "").strip()
        payload = {"symbol": sym, "sentiment": sentiment, "summary": summary, "count": len(items[:limit]),
                   "asOf": datetime.now().strftime("%Y-%m-%d %H:%M"), "source": os.getenv("OLLAMA_MODEL", "gemma4:31b"), "lang": normalized_lang}
        return _cache_set("news_digest", cache_key, payload)
    except Exception as e:
        return {"symbol": sym, "sentiment": "neutral", "summary": "", "count": len(items), "lang": normalized_lang, "error": str(e)}


@app.get("/news/{symbol}")
def get_news(symbol: str, limit: int = Query(10, ge=1, le=30)):
    cache_key = (normalize_symbol(symbol), int(limit))
    cached = _cache_get("news", cache_key, 300)
    if cached is not None:
        return cached

    last_error = None

    for resolved_symbol in candidate_symbols(symbol):
        try:
            ticker = yf.Ticker(resolved_symbol)
            raw_news = getattr(ticker, "news", None) or []
            normalized = []

            for item in raw_news:
                parsed = _parse_news_item(item)
                if parsed and parsed.get("url"):
                    normalized.append(parsed)

            normalized.sort(key=lambda x: x.get("publishedAt") or "", reverse=True)

            return _cache_set("news", cache_key, {
                "stock": resolved_symbol.upper(),
                "items": normalized[:limit],
            })
        except Exception as e:
            last_error = str(e)
            logger.warning("get_news failed for %s: %s", resolved_symbol, e)
            continue

    return _cache_set("news", cache_key, {"stock": normalize_symbol(symbol), "items": [], "error": last_error})


@app.get("/ratings/{symbol}")
def get_ratings(symbol: str):
    cache_key = normalize_symbol(symbol)
    cached = _cache_get("ratings", cache_key, 300)
    if cached is not None:
        return cached

    last_error = None

    for resolved_symbol in candidate_symbols(symbol):
        try:
            ticker = yf.Ticker(resolved_symbol)
            summary = getattr(ticker, "recommendations_summary", None)
            info = _safe_info(ticker)

            latest = None
            if summary is not None and not summary.empty:
                latest = summary.iloc[0].to_dict()

            if not latest:
                latest = {
                    "strongBuy": 0,
                    "buy": 0,
                    "hold": 0,
                    "sell": 0,
                    "strongSell": 0,
                }

            strong_buy = int(latest.get("strongBuy") or 0)
            buy = int(latest.get("buy") or 0)
            hold = int(latest.get("hold") or 0)
            sell = int(latest.get("sell") or 0)
            strong_sell = int(latest.get("strongSell") or 0)
            total = strong_buy + buy + hold + sell + strong_sell

            return _cache_set("ratings", cache_key, {
                "stock": resolved_symbol.upper(),
                "strongBuy": strong_buy,
                "buy": buy,
                "hold": hold,
                "sell": sell,
                "strongSell": strong_sell,
                "total": total,
                "recommendationKey": info.get("recommendationKey"),
                "numberOfAnalystOpinions": info.get("numberOfAnalystOpinions"),
            })
        except Exception as e:
            last_error = str(e)
            logger.warning("get_ratings failed for %s: %s", resolved_symbol, e)
            continue

    return _cache_set("ratings", cache_key, {
        "stock": normalize_symbol(symbol),
        "strongBuy": 0,
        "buy": 0,
        "hold": 0,
        "sell": 0,
        "strongSell": 0,
        "total": 0,
        "error": last_error,
    })


@app.get("/earnings/{symbol}")
def get_earnings(symbol: str, limit: int = Query(6, ge=1, le=8)):
    cache_key = (normalize_symbol(symbol), int(limit))
    cached = _cache_get("earnings", cache_key, 1800)
    if cached is not None:
        return cached

    stale_cached = _cache_get_stale("earnings", cache_key)
    last_error = None

    def _fetch_for_symbol(resolved_symbol: str):
        items = []
        calendar = {}
        cached_events = _get_earnings_cache().get(resolved_symbol.upper(), [])
        source_events = cached_events or fetch_earnings_events(resolved_symbol, limit=max(limit, 12))

        if source_events:
            recent_events = list(source_events[-limit:])[::-1]
            for event in recent_events:
                earnings_date = event.get("earningsDate") or event.get("available_from")
                ts = None
                quarter_label = ""
                fiscal_label = ""
                if earnings_date:
                    try:
                        ts = pd.Timestamp(earnings_date)
                        quarter = ((ts.month - 1) // 3) + 1
                        quarter_label = f"Q{quarter}"
                        fiscal_label = f"FY{str(ts.year)[-2:]}"
                    except Exception:
                        ts = None
                estimate = _safe_float(event.get("estimate"))
                actual = _safe_float(event.get("actual"))
                surprise_pct = _safe_float(event.get("surprisePercent"))
                if estimate is not None and pd.isna(estimate):
                    estimate = None
                if actual is not None and pd.isna(actual):
                    actual = None
                if surprise_pct is not None and pd.isna(surprise_pct):
                    surprise_pct = None
                items.append({
                    "quarter": quarter_label,
                    "fiscalYear": fiscal_label,
                    "estimate": round(estimate, 2) if estimate is not None else None,
                    "actual": round(actual, 2) if actual is not None else None,
                    "surprisePercent": round(surprise_pct, 2) if surprise_pct is not None else None,
                    "earningsDate": ts.isoformat() if ts is not None else None,
                })
        else:
            ticker = yf.Ticker(resolved_symbol)
            earnings_dates = getattr(ticker, "earnings_dates", None)
            calendar = getattr(ticker, "calendar", None) or {}

            if earnings_dates is not None and not earnings_dates.empty:
                df = earnings_dates.head(limit).reset_index()
                for _, row in df.iterrows():
                    earnings_date = row.get("Earnings Date")
                    quarter_label = ""
                    fiscal_label = ""
                    ts = None

                    if pd.notnull(earnings_date):
                        ts = pd.Timestamp(earnings_date)
                        quarter = ((ts.month - 1) // 3) + 1
                        quarter_label = f"Q{quarter}"
                        fiscal_label = f"FY{str(ts.year)[-2:]}"

                    estimate = _safe_float(row.get("EPS Estimate"))
                    actual = _safe_float(row.get("Reported EPS"))
                    surprise_pct = _safe_float(row.get("Surprise(%)"))

                    if estimate is not None and pd.isna(estimate):
                        estimate = None
                    if actual is not None and pd.isna(actual):
                        actual = None
                    if surprise_pct is not None and pd.isna(surprise_pct):
                        surprise_pct = None

                    items.append({
                        "quarter": quarter_label,
                        "fiscalYear": fiscal_label,
                        "estimate": round(estimate, 2) if estimate is not None else None,
                        "actual": round(actual, 2) if actual is not None else None,
                        "surprisePercent": round(surprise_pct, 2) if surprise_pct is not None else None,
                        "earningsDate": ts.isoformat() if ts is not None else None,
                    })

        next_earnings_date = None
        earnings_timing = None

        now_ts = pd.Timestamp.now(tz="UTC")
        for item in items:
            raw_item_date = item.get("earningsDate")
            if not raw_item_date or item.get("actual") is not None:
                continue
            try:
                item_ts = pd.Timestamp(raw_item_date)
                if item_ts.tzinfo is None:
                    item_ts = item_ts.tz_localize("UTC")
                else:
                    item_ts = item_ts.tz_convert("UTC")

                if item_ts >= now_ts:
                    next_earnings_date = item_ts.date().isoformat()
                    earnings_timing = "after-hours" if item_ts.hour >= 16 else "before-open" if item_ts.hour < 9 else None
                    break
            except Exception:
                continue

        cal_date = None
        if next_earnings_date is None and isinstance(calendar, dict):
            raw_dates = calendar.get("Earnings Date")
            if isinstance(raw_dates, list) and raw_dates:
                cal_date = raw_dates[0]
            elif raw_dates:
                cal_date = raw_dates

        if next_earnings_date is None and cal_date:
            if isinstance(cal_date, datetime):
                next_earnings_date = cal_date.date().isoformat()
                earnings_timing = "after-hours" if cal_date.hour >= 16 else "before-open" if cal_date.hour < 9 else None
            else:
                try:
                    cal_ts = pd.Timestamp(cal_date)
                    next_earnings_date = cal_ts.date().isoformat()
                    earnings_timing = "after-hours" if cal_ts.hour >= 16 else "before-open" if cal_ts.hour < 9 else None
                except Exception:
                    next_earnings_date = str(cal_date)

        return {
            "stock": resolved_symbol.upper(),
            "items": items,
            "nextEarningsDate": next_earnings_date,
            "earningsTiming": earnings_timing,
        }

    for resolved_symbol in candidate_symbols(symbol):
        for attempt in range(2):
            try:
                payload = _fetch_for_symbol(resolved_symbol)
                return _cache_set("earnings", cache_key, payload)
            except Exception as e:
                last_error = str(e)
                logger.warning("get_earnings failed for %s (attempt %d): %s", resolved_symbol, attempt + 1, e)
                if attempt == 0:
                    continue

    if stale_cached and stale_cached.get("items"):
        payload = dict(stale_cached)
        payload["stale"] = True
        payload["error"] = last_error
        return payload

    return {
        "stock": normalize_symbol(symbol),
        "items": [],
        "nextEarningsDate": stale_cached.get("nextEarningsDate") if stale_cached else None,
        "earningsTiming": stale_cached.get("earningsTiming") if stale_cached else None,
        "stale": bool(stale_cached and stale_cached.get("items")),
        "error": last_error,
    }


@app.get("/valuation/{symbol}")
def get_valuation(symbol: str):
    cache_key = normalize_symbol(symbol)
    cached = _cache_get("valuation", cache_key, 300)
    if cached is not None:
        return cached

    last_error = None

    for resolved_symbol in candidate_symbols(symbol):
        try:
            ticker = yf.Ticker(resolved_symbol)
            info = _safe_info(ticker)
            fast_info = _safe_fast_info(ticker)
            payload = _build_valuation_payload(resolved_symbol, info, fast_info)

            if payload.get("modelType") == "revenue_exit_pe" and payload.get("normalizedRevenuePerShare") is None:
                payload["error"] = "Valuation inputs unavailable"
            elif payload.get("modelType") == "eps_pe" and payload.get("baseEPS") is None:
                payload["error"] = "Valuation inputs unavailable"
            return _cache_set("valuation", cache_key, payload)
        except Exception as e:
            last_error = str(e)
            logger.warning("get_valuation failed for %s: %s", resolved_symbol, e)
            continue

    return _cache_set("valuation", cache_key, {
        "stock": normalize_symbol(symbol),
        "holdingYears": 3,
        "currentPrice": None,
        "currentRevenuePerShare": None,
        "normalizedRevenuePerShare": None,
        "isCalibrated": False,
        "notes": None,
        "scenarios": [],
        "error": last_error or "Valuation inputs unavailable",
    })


@app.get("/quote/{symbol}")
def get_quote(symbol: str):
    cache_key = normalize_symbol(symbol)
    cached = _cache_get("quote", cache_key, 30)
    if cached is not None:
        return cached

    stale_cached = _cache_get_stale("quote", cache_key)
    last_error = None

    for resolved_symbol in candidate_symbols(symbol):
        try:
            ticker = yf.Ticker(resolved_symbol)
            info = _safe_fast_info(ticker)
            snapshot = _company_snapshot(ticker)

            last_price = _safe_float(info.get("lastPrice"))
            # Alpaca 即時價優先(美股;台股不在 Alpaca,維持 yfinance)
            alp_price = None if _is_tw_market_symbol(resolved_symbol) else _alpaca_latest_price(resolved_symbol)
            if alp_price is not None:
                last_price = alp_price
            previous_close = _safe_float(info.get("previousClose"))
            day_high = _safe_float(info.get("dayHigh"))
            day_low = _safe_float(info.get("dayLow"))
            currency = info.get("currency") or "USD"
            market_state = info.get("marketState")

            try:
                intraday = ticker.history(period="2d", interval="1m", prepost=True)
            except Exception:
                intraday = pd.DataFrame()

            if intraday.empty:
                if last_price is None:
                    last_error = f"找不到股票代號: {resolved_symbol}"
                    continue

                session = _normalize_session(market_state)
                if session in (None, "closed"):
                    session = _infer_session_from_time(resolved_symbol, False, False)
                change = round(last_price - previous_close, 2) if previous_close is not None else None
                change_percent = round((change / previous_close) * 100, 2) if previous_close not in (None, 0) and change is not None else None

                return _cache_set("quote", cache_key, {
                    "stock": resolved_symbol.upper(),
                    "price": round(last_price, 2),
                    "displayPrice": round(last_price, 2),
                    "regularPrice": round(last_price, 2),
                    "extendedPrice": None,
                    "previousClose": round(previous_close, 2) if previous_close is not None else None,
                    "change": change,
                    "changePercent": change_percent,
                    "dayHigh": round(day_high, 2) if day_high is not None else None,
                    "dayLow": round(day_low, 2) if day_low is not None else None,
                    "currency": currency,
                    "marketState": market_state,
                    "session": session,
                    **snapshot,
                })

            close_prices = intraday["Close"].dropna()
            if close_prices.empty:
                last_error = f"無法取得最新報價: {resolved_symbol}"
                continue

            latest_intraday_price = _safe_float(close_prices.iloc[-1])

            regular_only = intraday.between_time("09:30", "16:00")
            regular_close_prices = regular_only["Close"].dropna() if not regular_only.empty else pd.Series(dtype=float)
            regular_price = _safe_float(regular_close_prices.iloc[-1]) if not regular_close_prices.empty else last_price

            pre_only = intraday.between_time("04:00", "09:29")
            pre_close_prices = pre_only["Close"].dropna() if not pre_only.empty else pd.Series(dtype=float)
            pre_price = _safe_float(pre_close_prices.iloc[-1]) if not pre_close_prices.empty else None

            post_only = intraday.between_time("16:01", "20:00")
            post_close_prices = post_only["Close"].dropna() if not post_only.empty else pd.Series(dtype=float)
            post_price = _safe_float(post_close_prices.iloc[-1]) if not post_close_prices.empty else None

            session = _normalize_session(market_state)
            market_phase = _current_market_phase(resolved_symbol)
            inferred_session = _infer_session_from_time(resolved_symbol, pre_price is not None, post_price is not None)

            if session in (None, "closed"):
                session = inferred_session
            elif session == "regular" and inferred_session in {"pre", "post"}:
                session = inferred_session

            if _is_tw_market_symbol(resolved_symbol):
                extended_price = None
                display_price = regular_price or last_price or latest_intraday_price
            else:
                if market_phase == "pre":
                    session = "pre"
                    extended_price = pre_price or latest_intraday_price or last_price
                    display_price = extended_price or regular_price
                elif market_phase == "post":
                    session = "post"
                    extended_price = post_price or latest_intraday_price or last_price
                    display_price = extended_price or regular_price
                elif session == "pre":
                    extended_price = pre_price or latest_intraday_price or last_price
                    display_price = extended_price or regular_price
                elif session == "post":
                    extended_price = post_price or latest_intraday_price or last_price
                    display_price = extended_price or regular_price
                else:
                    extended_price = post_price if session == "closed" else (post_price or pre_price)
                    display_price = regular_price or last_price or latest_intraday_price or extended_price

            if alp_price is not None:   # Alpaca 最新成交價覆蓋顯示價(含盤前盤後)
                display_price = alp_price
                if session == "regular":
                    regular_price = alp_price
                elif session in ("pre", "post"):
                    extended_price = alp_price

            if previous_close is None and len(close_prices) > 1:
                previous_close = _safe_float(close_prices.iloc[-2])

            change = round(display_price - previous_close, 2) if previous_close is not None and display_price is not None else None
            change_percent = round((change / previous_close) * 100, 2) if previous_close not in (None, 0) and change is not None else None

            return _cache_set("quote", cache_key, {
                "stock": resolved_symbol.upper(),
                "price": round(display_price, 2) if display_price is not None else None,
                "displayPrice": round(display_price, 2) if display_price is not None else None,
                "regularPrice": round(regular_price, 2) if regular_price is not None else None,
                "extendedPrice": round(extended_price, 2) if extended_price is not None else None,
                "previousClose": round(previous_close, 2) if previous_close is not None else None,
                "change": change,
                "changePercent": change_percent,
                "dayHigh": round(day_high, 2) if day_high is not None else None,
                "dayLow": round(day_low, 2) if day_low is not None else None,
                "currency": currency,
                "marketState": market_state,
                "session": session,
                **snapshot,
            })
        except Exception as e:
            last_error = str(e)
            logger.warning("get_quote failed for %s: %s", resolved_symbol, e)
            continue

    if stale_cached and stale_cached.get("price") is not None:
        payload = dict(stale_cached)
        payload["stale"] = True
        payload["error"] = last_error or f"最新報價更新失敗，先使用快取資料: {symbol}"
        return payload

    return {"error": last_error or f"找不到股票代號: {symbol}"}


@app.get("/chart/{symbol}")
def get_chart_data(symbol: str, period: str = "1mo"):
    """圖表專用資料:1D 5 分鐘、1W(5d)15 分鐘、1M 每小時、3M 以上每日。指標/歷史明細請仍用 /stock。"""
    return get_stock_data(symbol, period, chart=True)


@app.get("/stock/{symbol}")
def get_stock_data(symbol: str, period: str = "6mo", chart: bool = False):
    cache_key = (normalize_symbol(symbol), period, chart)
    cached = _cache_get("stock", cache_key, 20)
    if cached is not None:
        return cached

    allowed_periods = ["1d", "5d", "1mo", "ytd", "3mo", "6mo", "1y", "5y"]
    if period not in allowed_periods:
        return {"error": f"不支援的 period: {period}"}

    interval_map = {
        "1d": "5m",
        "5d": "30m",
        "1mo": "1d",
        "ytd": "1d",
        "3mo": "1d",
        "6mo": "1d",
        "1y": "1d",
        "5y": "1wk",
    }
    if chart:
        # 圖表專用(對齊 Robinhood):1W 每 15 分鐘(yfinance 無 10m)、1M 每小時;其餘同上
        interval_map = {**interval_map, "5d": "15m", "1mo": "60m"}
    interval = interval_map.get(period, "1d")
    intraday = interval not in ("1d", "1wk", "1mo")
    last_error = None

    for resolved_symbol in candidate_symbols(symbol):
        try:
            ticker = yf.Ticker(resolved_symbol)

            df = pd.DataFrame()
            history_errors = []
            for auto_adjust in (True, False):
                try:
                    df = ticker.history(period=period, interval=interval, auto_adjust=auto_adjust)
                    if not df.empty:
                        break
                except Exception as history_error:
                    history_errors.append(str(history_error))
                    df = pd.DataFrame()

            if df.empty:
                last_error = history_errors[-1] if history_errors else f"找不到股票代號: {resolved_symbol}"
                continue

            close_prices = df["Close"]
            high_prices = df["High"]
            low_prices = df["Low"]
            open_prices = df["Open"] if "Open" in df.columns else df["Close"]
            volume_series = df["Volume"]
            ma5 = close_prices.rolling(window=5).mean()

            result = []
            for i in range(len(df)):
                try:
                    ts = df.index[i]

                    if intraday:
                        date_str = ts.strftime("%Y-%m-%d %H:%M")
                        chart_label = ts.strftime("%m-%d %H:%M")
                    else:
                        date_str = ts.strftime("%Y-%m-%d")
                        chart_label = ts.strftime("%m-%d")

                    if pd.isnull(close_prices.iloc[i]) or pd.isnull(high_prices.iloc[i]) or pd.isnull(low_prices.iloc[i]):
                        continue

                    price_val = float(close_prices.iloc[i])
                    ma5_val = float(ma5.iloc[i]) if pd.notnull(ma5.iloc[i]) else None
                    high_val = float(high_prices.iloc[i])
                    low_val = float(low_prices.iloc[i])
                    open_val = float(open_prices.iloc[i]) if pd.notnull(open_prices.iloc[i]) else price_val

                    result.append({
                        "date": date_str,
                        "chartLabel": chart_label,
                        "price": round(price_val, 2),
                        "open": round(open_val, 2),
                        "ma5": round(ma5_val, 2) if ma5_val is not None else None,
                        "high": round(high_val, 2),
                        "low": round(low_val, 2),
                        "volume": float(volume_series.iloc[i]) if pd.notnull(volume_series.iloc[i]) else 0.0,
                    })
                except Exception:
                    continue

            payload = {
                "stock": resolved_symbol.upper(),
                "period": period,
                "interval": interval,
                "data": result,
            }

            closes = [float(x) for x in close_prices.tolist()]
            highs = [float(x) for x in high_prices.tolist()]
            lows = [float(x) for x in low_prices.tolist()]
            volumes = [float(x) if pd.notnull(x) else 0.0 for x in volume_series.tolist()]

            return _cache_set("stock", cache_key, _attach_indicators(payload, highs, lows, closes, volumes))

        except Exception as e:
            last_error = str(e)
            logger.warning("get_stock_data failed for %s: %s", resolved_symbol, e)
            continue

    return _cache_set("stock", cache_key, {"error": last_error or f"找不到股票代號: {symbol}"})


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=8003, reload=True)
