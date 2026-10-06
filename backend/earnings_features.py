from __future__ import annotations

import env_loader  # noqa: F401
import json
import os
from datetime import date, timedelta
from pathlib import Path
from typing import Any

import httpx
import pandas as pd
import yfinance as yf

BASE_DIR = Path(__file__).resolve().parent
EARNINGS_DIR = BASE_DIR / "data" / "earnings"
DEFAULT_FETCH_LIMIT = int(os.getenv("EARNINGS_FETCH_LIMIT", "60"))
EARNINGS_PROVIDER = os.getenv("EARNINGS_PROVIDER", "auto").strip().lower()
FMP_API_KEY = os.getenv("FMP_API_KEY", "").strip()
FMP_BASE_URL = os.getenv("FMP_BASE_URL", "https://financialmodelingprep.com/api/v3").rstrip("/")
QUANTQUOTE_API_KEY = os.getenv("QUANTQUOTE_API_KEY", "").strip()
QUANTQUOTE_BASE_URL = os.getenv("QUANTQUOTE_BASE_URL", "").rstrip("/")
QUANTQUOTE_EARNINGS_URL_TEMPLATE = os.getenv("QUANTQUOTE_EARNINGS_URL_TEMPLATE", "").strip()
EARNINGS_LOOKBACK_YEARS = int(os.getenv("EARNINGS_LOOKBACK_YEARS", "10"))


def _safe_float(value):
    try:
        return float(value) if value is not None else None
    except Exception:
        return None


def _safe_int(value):
    try:
        return int(value) if value is not None and value != "" else None
    except Exception:
        return None


def _safe_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value.strip()
    return str(value).strip()


def _extract_list_payload(payload: Any) -> list[dict]:
    if isinstance(payload, list):
        return [item for item in payload if isinstance(item, dict)]
    if isinstance(payload, dict):
        for key in ("data", "historical", "items", "events", "results"):
            items = payload.get(key)
            if isinstance(items, list):
                return [item for item in items if isinstance(item, dict)]
        return [payload]
    return []


def _normalize_guidance_flag(value: Any) -> float | None:
    if isinstance(value, bool):
        return 1.0 if value else 0.0
    text = _safe_text(value).lower()
    if not text:
        return None
    positive = (
        "raise guidance",
        "raised guidance",
        "increased guidance",
        "increase guidance",
        "lift guidance",
        "raised full-year guidance",
        "raised full year guidance",
        "upward guidance",
        "guidance raised",
    )
    negative = (
        "lower guidance",
        "cut guidance",
        "reduced guidance",
        "reduction in guidance",
        "trim guidance",
        "guidance lowered",
    )
    if any(token in text for token in positive) and not any(token in text for token in negative):
        return 1.0
    if any(token in text for token in negative):
        return 0.0
    return None


def _normalize_event_row(row: dict) -> dict | None:
    earnings_date_raw = (
        row.get("earningsDate")
        or row.get("date")
        or row.get("Earnings Date")
        or row.get("reportedDate")
        or row.get("reportDate")
    )
    if not earnings_date_raw:
        return None
    if isinstance(earnings_date_raw, (list, tuple)) and earnings_date_raw:
        earnings_date_raw = earnings_date_raw[0]
    try:
        earnings_ts = pd.Timestamp(earnings_date_raw)
    except Exception:
        return None
    if earnings_ts.tzinfo is not None:
        earnings_ts = earnings_ts.tz_convert("UTC").tz_localize(None)

    estimate = _safe_float(row.get("estimate") or row.get("epsEstimated") or row.get("EPS Estimate"))
    actual = _safe_float(row.get("actual") or row.get("eps") or row.get("Reported EPS"))
    surprise_pct = _safe_float(
        row.get("surprisePercent")
        or row.get("surprisePercentage")
        or row.get("Surprise(%)")
        or row.get("surprise")
    )
    if estimate is not None and pd.isna(estimate):
        estimate = None
    if actual is not None and pd.isna(actual):
        actual = None
    if surprise_pct is not None and pd.isna(surprise_pct):
        surprise_pct = None
    revenue_actual = _safe_float(row.get("revenue") or row.get("revenueActual") or row.get("Revenue"))
    revenue_estimate = _safe_float(
        row.get("revenueEstimated")
        or row.get("revenueEstimate")
        or row.get("revenueConsensus")
        or row.get("Revenue Estimate")
    )
    revenue_surprise_pct = row.get("revenueSurprisePct")
    if revenue_surprise_pct is None and revenue_actual is not None and revenue_estimate not in (None, 0.0, -0.0):
        try:
            revenue_surprise_pct = ((revenue_actual - revenue_estimate) / abs(revenue_estimate)) * 100.0
        except Exception:
            revenue_surprise_pct = None
    guidance_up = _normalize_guidance_flag(
        row.get("guidanceUp")
        or row.get("guidance")
        or row.get("guidanceText")
        or row.get("transcript")
        or row.get("transcriptText")
        or row.get("content")
        or row.get("text")
    )

    available_from = (earnings_ts + timedelta(days=1)).date().isoformat()
    return {
        "earningsDate": earnings_ts.date().isoformat(),
        "available_from": available_from,
        "estimate": estimate,
        "actual": actual,
        "surprisePercent": surprise_pct,
        "earningsBeat": bool(actual is not None and estimate is not None and actual > estimate),
        "guidanceUp": guidance_up,
        "revenueSurprisePct": revenue_surprise_pct,
    }


def _fetch_yfinance_earnings_events(symbol: str, limit: int = DEFAULT_FETCH_LIMIT) -> list[dict]:
    try:
        # yfinance 用破折號格式(BRK-B),不是點號(BRK.B)
        ticker = yf.Ticker(symbol.replace(".", "-"))
        earnings_dates = getattr(ticker, "earnings_dates", None)
    except Exception:
        return []

    if earnings_dates is None or getattr(earnings_dates, "empty", True):
        return []

    try:
        df = earnings_dates.head(limit).reset_index()
    except Exception:
        return []

    events: list[dict] = []
    for _, row in df.iterrows():
        normalized = _normalize_event_row(
            {
                "earningsDate": row.get("Earnings Date"),
                "estimate": row.get("EPS Estimate"),
                "actual": row.get("Reported EPS"),
                "surprisePercent": row.get("Surprise(%)"),
            }
        )
        if normalized:
            events.append(normalized)
    return sorted(events, key=lambda x: x.get("available_from", ""))


def _http_get_json(client: httpx.Client, url: str, params: dict[str, Any], headers: dict[str, str] | None = None) -> Any:
    response = client.get(url, params=params, headers=headers)
    response.raise_for_status()
    return response.json()


def _http_get_json_header_first(
    client: httpx.Client,
    url: str,
    params: dict[str, Any],
    api_key: str,
    header_name: str = "apikey",
) -> Any:
    headers = {header_name: api_key}
    try:
        return _http_get_json(client, url, params, headers=headers)
    except httpx.HTTPStatusError as exc:
        if exc.response is None or exc.response.status_code not in (401, 403):
            raise
    query_params = dict(params)
    query_params[header_name] = api_key
    return _http_get_json(client, url, query_params)


def _fetch_fmp_transcript_text(symbol: str, year: int | None, quarter: int | None) -> str | None:
    if not FMP_API_KEY or year is None or quarter is None:
        return None
    candidate_urls = [
        f"{FMP_BASE_URL}/stable/earning-call-transcript",
        f"{FMP_BASE_URL}/earning-call-transcript",
        f"{FMP_BASE_URL}/earning_call_transcript/{symbol.upper()}",
    ]
    params = {"symbol": symbol.upper(), "year": year, "quarter": quarter, "apikey": FMP_API_KEY}
    for url in candidate_urls:
        try:
            with httpx.Client(timeout=30.0) as client:
                payload = _http_get_json_header_first(client, url, params, FMP_API_KEY)
        except Exception:
            continue
        items = _extract_list_payload(payload)
        if not items:
            continue
        first = items[0]
        for key in ("content", "text", "transcript", "transcriptText", "body", "summary"):
            text = _safe_text(first.get(key))
            if text:
                return text
    return None


def _fetch_fmp_transcript_dates(symbol: str) -> list[dict]:
    if not FMP_API_KEY:
        return []
    candidate_urls = [
        f"{FMP_BASE_URL}/stable/earning-call-transcript-dates",
        f"{FMP_BASE_URL}/earning-call-transcript-dates",
    ]
    params = {"symbol": symbol.upper()}
    for url in candidate_urls:
        try:
            with httpx.Client(timeout=30.0) as client:
                payload = _http_get_json_header_first(client, url, params, FMP_API_KEY)
        except Exception:
            continue
        items = _extract_list_payload(payload)
        if items:
            return items
    return []


def _fetch_fmp_earnings_events(symbol: str, limit: int = DEFAULT_FETCH_LIMIT) -> list[dict]:
    if not FMP_API_KEY:
        return []
    end_date = date.today()
    start_date = end_date - timedelta(days=365 * EARNINGS_LOOKBACK_YEARS + 60)
    candidate_urls = [
        f"{FMP_BASE_URL}/stable/earnings",
        f"{FMP_BASE_URL}/earnings-calendar",
        f"{FMP_BASE_URL}/earning_calendar",
    ]
    params = {"from": start_date.isoformat(), "to": end_date.isoformat()}
    payload: Any | None = None
    for url in candidate_urls:
        try:
            with httpx.Client(timeout=45.0) as client:
                payload = _http_get_json_header_first(client, url, params, FMP_API_KEY)
        except Exception:
            payload = None
            continue
        if payload is not None:
            break
    if payload is None:
        return []

    items = _extract_list_payload(payload)
    if not items:
        return []

    symbol_upper = symbol.upper()
    filtered = [item for item in items if _safe_text(item.get("symbol")).upper() == symbol_upper]
    if not filtered:
        return []

    normalized_items: list[dict] = []
    for item in filtered[-limit:]:
        normalized = _normalize_event_row(item)
        if not normalized:
            continue
        quarter = _safe_int(item.get("quarter") or item.get("fiscalQuarter"))
        year = _safe_int(item.get("year") or item.get("calendarYear"))
        transcript_text = _fetch_fmp_transcript_text(symbol, year, quarter)
        if transcript_text:
            guidance_flag = _normalize_guidance_flag(transcript_text)
            if guidance_flag is not None:
                normalized["guidanceUp"] = guidance_flag
        normalized_items.append(normalized)

    if normalized_items:
        transcript_dates = _fetch_fmp_transcript_dates(symbol)
        if transcript_dates:
            date_index: dict[tuple[int | None, int | None], dict] = {}
            for row in transcript_dates:
                q = _safe_int(row.get("quarter") or row.get("fiscalQuarter"))
                y = _safe_int(row.get("year") or row.get("calendarYear"))
                if q is not None or y is not None:
                    date_index[(y, q)] = row
            for event in normalized_items:
                event_year = _safe_int(pd.Timestamp(event["earningsDate"]).year)
                matched_row = None
                # First try exact year-quarter match if available.
                for (y, q), row in date_index.items():
                    if y == event_year:
                        matched_row = row
                        break
                if matched_row is None:
                    continue
                guidance_text = (
                    matched_row.get("guidance")
                    or matched_row.get("guidanceText")
                    or matched_row.get("transcript")
                    or matched_row.get("content")
                    or matched_row.get("text")
                )
                guidance_flag = _normalize_guidance_flag(guidance_text)
                if guidance_flag is not None:
                    event["guidanceUp"] = guidance_flag
    return sorted(normalized_items, key=lambda x: x.get("available_from", ""))


def _fetch_quantquote_earnings_events(symbol: str, limit: int = DEFAULT_FETCH_LIMIT) -> list[dict]:
    """
    QuantQuote support is intentionally template-driven because API plans and
    endpoint shapes differ by account tier. Set QUANTQUOTE_EARNINGS_URL_TEMPLATE
    to a URL containing {symbol}, {start}, {end}, {limit}, and {api_key}.
    """
    template = QUANTQUOTE_EARNINGS_URL_TEMPLATE
    if not template or not QUANTQUOTE_API_KEY:
        return []
    end_date = date.today()
    start_date = end_date - timedelta(days=365 * EARNINGS_LOOKBACK_YEARS + 60)
    url = template.format(
        symbol=symbol.upper(),
        start=start_date.isoformat(),
        end=end_date.isoformat(),
        limit=limit,
        api_key=QUANTQUOTE_API_KEY,
        base_url=QUANTQUOTE_BASE_URL,
    )
    try:
        with httpx.Client(timeout=45.0) as client:
            payload = _http_get_json(client, url, {})
    except Exception:
        return []
    items = _extract_list_payload(payload)
    normalized_items: list[dict] = []
    for item in items[:limit]:
        normalized = _normalize_event_row(item)
        if normalized:
            normalized_items.append(normalized)
    return sorted(normalized_items, key=lambda x: x.get("available_from", ""))


def fetch_earnings_events(
    symbol: str,
    limit: int = DEFAULT_FETCH_LIMIT,
    provider: str | None = None,
) -> list[dict]:
    provider = (provider or EARNINGS_PROVIDER or "auto").strip().lower()
    providers = []
    if provider == "auto":
        providers = ["fmp", "quantquote", "yfinance"]
    elif provider in {"fmp", "quantquote", "yfinance"}:
        providers = [provider]
    else:
        providers = ["fmp", "quantquote", "yfinance"]

    for name in providers:
        try:
            if name == "fmp":
                events = _fetch_fmp_earnings_events(symbol, limit)
            elif name == "quantquote":
                events = _fetch_quantquote_earnings_events(symbol, limit)
            else:
                events = _fetch_yfinance_earnings_events(symbol, limit)
        except Exception:
            events = []
        if events:
            return events
    return []


def load_earnings_cache(earnings_dir: Path | None = None) -> dict[str, list[dict]]:
    earnings_dir = earnings_dir or EARNINGS_DIR
    result: dict[str, list[dict]] = {}
    if not earnings_dir.exists():
        return result

    for path in sorted(earnings_dir.glob("*.json")):
        try:
            payload = json.loads(path.read_text(encoding="utf-8"))
        except Exception:
            continue
        if isinstance(payload, dict):
            items = payload.get("items") or payload.get("events") or []
        elif isinstance(payload, list):
            items = payload
        else:
            items = []
        if not isinstance(items, list):
            continue
        normalized_items: list[dict] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            normalized = _normalize_event_row(item)
            if normalized:
                normalized_items.append(normalized)
        if normalized_items:
            result[path.stem.upper()] = sorted(normalized_items, key=lambda x: x.get("available_from", ""))
    return result


def save_earnings_cache(symbol: str, events: list[dict], earnings_dir: Path | None = None) -> Path:
    earnings_dir = earnings_dir or EARNINGS_DIR
    earnings_dir.mkdir(parents=True, exist_ok=True)
    path = earnings_dir / f"{symbol.upper()}.json"
    path.write_text(json.dumps(events, indent=2, ensure_ascii=False), encoding="utf-8")
    return path


_BENCHMARK_PE = 30.0  # 科技/成長股基準 PE（AMD/NVDA/MRVL 一般 PE 40-80x）


def is_consecutive_loss(
    symbol: str,
    as_of_date: str,
    earnings_cache: dict[str, list[dict]] | None = None,
    n: int = 2,
) -> bool:
    """最近 n 季的 actual EPS 全部為負 → True（連續虧損，不應入選）。"""
    events = (earnings_cache or {}).get(symbol.upper(), [])
    applicable = [e for e in events if e.get("available_from", "9999") <= as_of_date]
    if len(applicable) < n:
        return False
    recent = applicable[-n:]
    return all((_safe_float(e.get("actual")) or 0.0) < 0 for e in recent)


def build_earnings_features(
    symbol: str,
    as_of_date: str,
    close_by_date: dict[str, float],
    earnings_cache: dict[str, list[dict]] | None = None,
    current_price: float | None = None,
) -> dict[str, float]:
    earnings_cache = earnings_cache or {}
    events = earnings_cache.get(symbol.upper(), [])
    if not events:
        return {
            "eps_surprise_pct": 0.0,
            "revenue_surprise_pct": 0.0,
            "earnings_beat": 0.0,
            "guidance_up": 0.0,
            "post_earnings_gap_pct": 0.0,
            "eps_qoq": 0.0,
            "eps_trend_3q": 0.0,
            "next_eps_est_vs_prev": 0.0,
            "eps_yoy": 0.0,
            "eps_accel": 0.0,
            "beat_streak": 0.0,
            "consecutive_neg_eps": 0.0,
            "price_to_fair_value": 0.0,
            "eps_pos_streak": 0.0,
            "eps_turnaround": 0.0,
        }

    applicable = [event for event in events if event.get("available_from", "9999-12-31") <= as_of_date]
    if not applicable:
        return {
            "eps_surprise_pct": 0.0,
            "revenue_surprise_pct": 0.0,
            "earnings_beat": 0.0,
            "guidance_up": 0.0,
            "post_earnings_gap_pct": 0.0,
            "eps_qoq": 0.0,
            "eps_trend_3q": 0.0,
            "next_eps_est_vs_prev": 0.0,
            "eps_yoy": 0.0,
            "eps_accel": 0.0,
            "beat_streak": 0.0,
            "consecutive_neg_eps": 0.0,
            "price_to_fair_value": 0.0,
            "eps_pos_streak": 0.0,
            "eps_turnaround": 0.0,
        }

    latest = applicable[-1]
    eps_surprise_pct = float((latest.get("surprisePercent") or 0.0) / 100.0)
    earnings_beat = 1.0 if float(latest.get("actual") or 0.0) > float(latest.get("estimate") or 0.0) else 0.0

    revenue_surprise_pct = float(latest.get("revenueSurprisePct") or 0.0)
    guidance_up = 1.0 if latest.get("guidanceUp") is True else 0.0

    post_earnings_gap_pct = 0.0
    earnings_date = latest.get("earningsDate")
    if earnings_date and earnings_date in close_by_date:
        ordered_dates = sorted(close_by_date.keys())
        try:
            event_idx = ordered_dates.index(earnings_date)
        except ValueError:
            event_idx = -1
        if event_idx >= 0 and event_idx + 1 < len(ordered_dates):
            event_close = close_by_date.get(earnings_date)
            next_close = close_by_date.get(ordered_dates[event_idx + 1])
            if event_close not in (None, 0.0, -0.0) and next_close is not None:
                post_earnings_gap_pct = float(next_close / event_close - 1.0)

    # ── 季增率 QoQ & 年增率 YoY ──────────────────────────────────────────
    # 需要至少 5 筆才能算出 YoY（4季前）
    eps_qoq, eps_yoy, eps_accel = 0.0, 0.0, 0.0
    if len(applicable) >= 2:
        cur_eps  = _safe_float(latest.get("actual"))
        prev_eps = _safe_float(applicable[-2].get("actual"))
        if cur_eps is not None and prev_eps not in (None, 0.0):
            eps_qoq = float((cur_eps - prev_eps) / abs(prev_eps))
    if len(applicable) >= 5:
        cur_eps   = _safe_float(latest.get("actual"))
        yoy_eps   = _safe_float(applicable[-5].get("actual"))
        if cur_eps is not None and yoy_eps not in (None, 0.0):
            eps_yoy = float((cur_eps - yoy_eps) / abs(yoy_eps))
        # 加速度：本季 YoY 成長 vs 上季 YoY 成長
        prev_cur  = _safe_float(applicable[-2].get("actual"))
        prev_yoy  = _safe_float(applicable[-6].get("actual")) if len(applicable) >= 6 else None
        if prev_cur is not None and prev_yoy not in (None, 0.0):
            prev_yoy_growth = (prev_cur - prev_yoy) / abs(prev_yoy)
            eps_accel = float(eps_yoy - prev_yoy_growth)

    # 連續 beat 次數（最多看最近4季）
    beat_streak = 0.0
    for ev in reversed(applicable[-4:]):
        a = _safe_float(ev.get("actual"))
        e = _safe_float(ev.get("estimate"))
        if a is not None and e is not None and a > e:
            beat_streak += 1.0
        else:
            break

    # ── 連續虧損季數 ─────────────────────────────────────────────────────
    consecutive_neg_eps = 0.0
    for ev in reversed(applicable[-4:]):
        a = _safe_float(ev.get("actual"))
        if a is not None and a < 0:
            consecutive_neg_eps += 1.0
        else:
            break

    # ── EPS 線性趨勢（最近3季斜率）─────────────────────────────────────────
    # 正值 = EPS 逐季往上，負值 = 逐季往下（PODD 類：beat 但絕對值在下滑）
    eps_trend_3q = 0.0
    if len(applicable) >= 3:
        recent_eps = [_safe_float(applicable[-(i+1)].get("actual")) for i in range(3)]
        recent_eps = [v for v in recent_eps if v is not None]
        if len(recent_eps) == 3:
            # 線性斜率：x=[0,1,2]（最舊到最新）
            vals = list(reversed(recent_eps))
            n = len(vals)
            x_mean = (n - 1) / 2.0
            slope = sum((i - x_mean) * v for i, v in enumerate(vals)) / sum((i - x_mean) ** 2 for i in range(n))
            base = abs(vals[0]) if vals[0] else 1.0
            eps_trend_3q = float(min(max(slope / max(base, 0.01), -3.0), 3.0))

    # ── 下次預估 EPS vs 上季實際（分析師是否預期衰退）───────────────────────
    # 負值 = 預估比上季低 = 市場預期衰退（PODD 類：beat 但預估已被調低）
    next_eps_est_vs_prev = 0.0
    all_events = sorted(events, key=lambda x: x.get("earningsDate", ""))
    # 找下一季預估：earningsDate > as_of_date 且有 estimate
    # estimate 是財報前就公開的分析師預測，不需要等 available_from
    next_event = next(
        (e for e in all_events if e.get("earningsDate", "") > as_of_date and e.get("estimate") is not None),
        None
    )
    if next_event and applicable:
        _next_est = _safe_float(next_event.get("estimate"))
        _prev_act = _safe_float(applicable[-1].get("actual"))
        if _next_est is not None and _prev_act not in (None, 0.0):
            next_eps_est_vs_prev = float(min(max((_next_est - _prev_act) / abs(_prev_act), -2.0), 2.0))

    # ── price_to_fair_value：當前價 vs EPS 算出的合理價 ──────────────────
    # 合理價 = 最新季EPS × 4（年化）× 基準PE
    # < 1.0 = 低估，> 1.5 = 偏貴
    price_to_fair_value = 0.0
    latest_actual_eps = _safe_float(latest.get("actual"))
    if latest_actual_eps and latest_actual_eps > 0 and current_price and current_price > 0:
        annual_eps_proxy = latest_actual_eps * 4.0
        fair_value = annual_eps_proxy * _BENCHMARK_PE
        price_to_fair_value = float(current_price / fair_value)

    # ── 轉盈訊號(non-GAAP actual EPS):連續正 EPS 季數 + 虧轉盈 ──────────
    eps_seq = [_safe_float(e.get("actual")) for e in applicable if _safe_float(e.get("actual")) is not None]
    eps_pos_streak = 0
    for v in reversed(eps_seq):
        if v > 0:
            eps_pos_streak += 1
        else:
            break
    # 虧轉盈:最近兩季都正,且其前兩季有過虧損(剛由負轉正、且已連兩季)
    eps_turnaround = 0.0
    if len(eps_seq) >= 3 and eps_seq[-1] > 0 and eps_seq[-2] > 0 and any(v <= 0 for v in eps_seq[-4:-2]):
        eps_turnaround = 1.0

    return {
        "eps_surprise_pct": float(eps_surprise_pct),
        "revenue_surprise_pct": float(revenue_surprise_pct),
        "earnings_beat": float(earnings_beat),
        "guidance_up": float(guidance_up),
        "post_earnings_gap_pct": float(post_earnings_gap_pct),
        "eps_qoq": float(min(max(eps_qoq, -2.0), 5.0)),
        "eps_trend_3q": float(eps_trend_3q),
        "next_eps_est_vs_prev": float(next_eps_est_vs_prev),
        "eps_yoy": float(min(max(eps_yoy, -2.0), 10.0)),
        "eps_accel": float(min(max(eps_accel, -3.0), 3.0)),
        "beat_streak": float(beat_streak),
        "consecutive_neg_eps": float(consecutive_neg_eps),
        "price_to_fair_value": float(min(price_to_fair_value, 10.0)),
        "eps_pos_streak": float(min(eps_pos_streak, 12)),
        "eps_turnaround": float(eps_turnaround),
    }


def build_earnings_feature_frame(
    symbol: str,
    dates: list[str] | list[pd.Timestamp],
    close_by_date: dict[str, float],
    earnings_cache: dict[str, list[dict]] | None = None,
) -> pd.DataFrame:
    """
    Build a point-in-time earnings feature frame for a sequence of dates.

    The returned frame is aligned by date and contains the same PEAD features
    used by build_earnings_features(), but vectorized for model training /
    evaluation over many timestamps.
    """
    dates_df = pd.DataFrame({"date": pd.to_datetime(list(dates))}).sort_values("date")
    if dates_df.empty:
        return pd.DataFrame(
            columns=[
                "date",
                "eps_surprise_pct",
                "revenue_surprise_pct",
                "earnings_beat",
                "guidance_up",
                "post_earnings_gap_pct",
            ]
        )

    earnings_cache = earnings_cache or {}
    events = earnings_cache.get(symbol.upper(), [])
    if not events:
        out = dates_df.copy()
        for col in ["eps_surprise_pct", "revenue_surprise_pct", "earnings_beat", "guidance_up", "post_earnings_gap_pct"]:
            out[col] = 0.0
        return out

    event_rows: list[dict] = []
    close_keys = sorted(close_by_date.keys())
    for event in events:
        available_from = event.get("available_from")
        earnings_date = event.get("earningsDate")
        if not available_from or not earnings_date:
            continue

        eps_surprise_pct = float((event.get("surprisePercent") or 0.0) / 100.0)
        earnings_beat = 1.0 if float(event.get("actual") or 0.0) > float(event.get("estimate") or 0.0) else 0.0
        revenue_surprise_pct = float(event.get("revenueSurprisePct") or 0.0)
        guidance_up = 1.0 if event.get("guidanceUp") is True else 0.0
        post_earnings_gap_pct = 0.0
        if earnings_date in close_by_date:
            try:
                event_idx = close_keys.index(earnings_date)
            except ValueError:
                event_idx = -1
            if event_idx >= 0 and event_idx + 1 < len(close_keys):
                event_close = close_by_date.get(earnings_date)
                next_close = close_by_date.get(close_keys[event_idx + 1])
                if event_close not in (None, 0.0, -0.0) and next_close is not None:
                    post_earnings_gap_pct = float(next_close / event_close - 1.0)

        event_rows.append(
            {
                "date": pd.to_datetime(available_from),
                "eps_surprise_pct": eps_surprise_pct,
                "revenue_surprise_pct": revenue_surprise_pct,
                "earnings_beat": earnings_beat,
                "guidance_up": guidance_up,
                "post_earnings_gap_pct": post_earnings_gap_pct,
            }
        )

    if not event_rows:
        out = dates_df.copy()
        for col in ["eps_surprise_pct", "revenue_surprise_pct", "earnings_beat", "guidance_up", "post_earnings_gap_pct"]:
            out[col] = 0.0
        return out

    events_df = pd.DataFrame(event_rows).sort_values("date")
    merged = pd.merge_asof(dates_df, events_df, on="date", direction="backward")
    for col in ["eps_surprise_pct", "revenue_surprise_pct", "earnings_beat", "guidance_up", "post_earnings_gap_pct"]:
        merged[col] = merged[col].fillna(0.0).astype(float)
    return merged
