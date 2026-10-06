"""
推播(APNs)模組:裝置註冊、提醒同步、排程評估、發送。
- 資料存 push.db(SQLite):devices / alerts / watch / ranking_snapshot
- APNs 用 HTTP/2 + JWT(ES256),金鑰由 .env 指定:
    APNS_KEY_PATH=./AuthKey_XXXX.p8   APNS_KEY_ID=XXXX   APNS_TEAM_ID=3FYF934Z4N
    APNS_BUNDLE_ID=com.catinsight.app   APNS_ENV=sandbox|production
- 排程:美股盤中每 5 分鐘評估價格/技術提醒;每天早上 06:10(本機時間)發 AI 精選換榜與明天財報提醒。
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sqlite3
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

import httpx

logger = logging.getLogger("stock_api.push")
BASE_DIR = Path(__file__).resolve().parent
DB_PATH = BASE_DIR / "push.db"

# ---------------- 儲存 ----------------

def _db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, timeout=10)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _db() as c:
        c.executescript("""
        CREATE TABLE IF NOT EXISTS devices (
            token TEXT PRIMARY KEY, platform TEXT, lang TEXT, updated_at REAL
        );
        CREATE TABLE IF NOT EXISTS alerts (
            id TEXT, token TEXT, symbol TEXT, metric TEXT, direction TEXT, target REAL,
            period INTEGER, fast INTEGER, slow INTEGER, signal INTEGER, enabled INTEGER,
            last_triggered REAL, PRIMARY KEY (id, token)
        );
        CREATE TABLE IF NOT EXISTS watch (token TEXT, symbol TEXT, PRIMARY KEY (token, symbol));
        CREATE TABLE IF NOT EXISTS ranking_snapshot (as_of TEXT PRIMARY KEY, symbols TEXT);
        CREATE TABLE IF NOT EXISTS sent_log (key TEXT PRIMARY KEY, at REAL);
        CREATE TABLE IF NOT EXISTS token_env (token TEXT PRIMARY KEY, env TEXT);
        """)


def register_device(token: str, platform: str, lang: str) -> None:
    with _db() as c:
        c.execute("INSERT INTO devices(token, platform, lang, updated_at) VALUES(?,?,?,?) "
                  "ON CONFLICT(token) DO UPDATE SET platform=excluded.platform, lang=excluded.lang, updated_at=excluded.updated_at",
                  (token, platform, lang, time.time()))


def remove_device(token: str) -> None:
    with _db() as c:
        c.execute("DELETE FROM devices WHERE token=?", (token,))
        c.execute("DELETE FROM alerts WHERE token=?", (token,))
        c.execute("DELETE FROM watch WHERE token=?", (token,))


def sync_alerts(token: str, alerts: list[dict], watchlist: list[str]) -> None:
    """整組覆蓋該裝置的提醒與自選(App 端是真相來源);保留既有的 last_triggered。"""
    with _db() as c:
        old = {r["id"]: r["last_triggered"] for r in c.execute("SELECT id, last_triggered FROM alerts WHERE token=?", (token,))}
        c.execute("DELETE FROM alerts WHERE token=?", (token,))
        for a in alerts:
            c.execute("INSERT INTO alerts VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", (
                str(a.get("id")), token, str(a.get("symbol", "")).upper(), a.get("metric"), a.get("direction"),
                float(a.get("target") or 0), a.get("period"), a.get("fastPeriod"), a.get("slowPeriod"), a.get("signalPeriod"),
                1 if a.get("enabled", True) else 0, old.get(str(a.get("id"))) or (a.get("lastTriggered") or None),
            ))
        c.execute("DELETE FROM watch WHERE token=?", (token,))
        for s in watchlist:
            s = str(s).strip().upper()
            if s:
                c.execute("INSERT OR IGNORE INTO watch VALUES(?,?)", (token, s))


def stats() -> dict:
    with _db() as c:
        return {
            "devices": c.execute("SELECT COUNT(*) FROM devices").fetchone()[0],
            "alerts": c.execute("SELECT COUNT(*) FROM alerts WHERE enabled=1").fetchone()[0],
            "watch": c.execute("SELECT COUNT(*) FROM watch").fetchone()[0],
            "apns_configured": APNs.configured(),
        }


# ---------------- APNs ----------------

class APNs:
    _jwt: str | None = None
    _jwt_at: float = 0
    _client: httpx.AsyncClient | None = None

    @staticmethod
    def _cfg() -> dict:
        key_path = os.getenv("APNS_KEY_PATH", "")
        if not key_path:
            cands = sorted(BASE_DIR.glob("AuthKey_*.p8")) or sorted(BASE_DIR.glob("*.p8"))
            key_path = str(cands[0]) if cands else ""
        return {
            "key_path": key_path,
            "key_id": os.getenv("APNS_KEY_ID", ""),
            "team_id": os.getenv("APNS_TEAM_ID", ""),
            "bundle_id": os.getenv("APNS_BUNDLE_ID", "com.catinsight.app"),
            "env": os.getenv("APNS_ENV", "sandbox"),
        }

    @classmethod
    def configured(cls) -> bool:
        c = cls._cfg()
        return bool(c["key_path"] and Path(c["key_path"]).exists() and c["key_id"] and c["team_id"])

    @classmethod
    def _token(cls) -> str:
        import jwt  # PyJWT
        now = time.time()
        if cls._jwt and now - cls._jwt_at < 50 * 60:
            return cls._jwt
        c = cls._cfg()
        key = Path(c["key_path"]).read_text()
        cls._jwt = jwt.encode({"iss": c["team_id"], "iat": int(now)}, key, algorithm="ES256", headers={"kid": c["key_id"]})
        cls._jwt_at = now
        return cls._jwt

    @classmethod
    def _http(cls) -> httpx.AsyncClient:
        if cls._client is None:
            cls._client = httpx.AsyncClient(http2=True, timeout=15.0)
        return cls._client

    @classmethod
    async def send(cls, token: str, title: str, body: str, data: dict | None = None, env: str | None = None) -> tuple[bool, str]:
        """回傳 (成功, 訊息)。
        App Store 版的 token 要打 production、Xcode 直接裝的要打 sandbox;同一台後端兩種都會遇到,
        所以先用該 token 上次成功的環境,失敗(BadDeviceToken)就換另一個再試一次並記住。
        裝置真的失效(410 / Unregistered)會自動從 DB 移除。"""
        if not cls.configured():
            return False, "APNs not configured"
        c = cls._cfg()
        with _db() as db:
            row = db.execute("SELECT env FROM token_env WHERE token=?", (token,)).fetchone()
        first = env or (row["env"] if row else c["env"])
        other = "sandbox" if first == "production" else "production"
        ok, info = await cls._send_once(token, title, body, data, first)
        if not ok and "BadDeviceToken" in info:
            ok2, info2 = await cls._send_once(token, title, body, data, other)
            if ok2:
                with _db() as db:
                    db.execute("INSERT OR REPLACE INTO token_env VALUES(?,?)", (token, other))
                return True, f"ok ({other})"
            remove_device(token)
            return False, f"{info} / {info2}"
        if ok and not row:
            with _db() as db:
                db.execute("INSERT OR REPLACE INTO token_env VALUES(?,?)", (token, first))
        return ok, info

    @classmethod
    async def _send_once(cls, token: str, title: str, body: str, data: dict | None, env: str) -> tuple[bool, str]:
        c = cls._cfg()
        host = "https://api.push.apple.com" if env == "production" else "https://api.sandbox.push.apple.com"
        payload = {"aps": {"alert": {"title": title, "body": body}, "sound": "default"}}
        if data:
            payload.update(data)
        headers = {
            "authorization": f"bearer {cls._token()}",
            "apns-topic": c["bundle_id"],
            "apns-push-type": "alert",
            "apns-priority": "10",
        }
        try:
            r = await cls._http().post(f"{host}/3/device/{token}", json=payload, headers=headers)
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"
        if r.status_code == 200:
            return True, "ok"
        reason = ""
        try:
            reason = r.json().get("reason", "")
        except Exception:
            pass
        if r.status_code == 410 or reason in ("Unregistered", "DeviceTokenNotForTopic"):
            remove_device(token)
        return False, f"{r.status_code} {reason}"


# ---------------- 訊息文案 ----------------

def _fmt(v: float) -> str:
    return f"{v:.2f}"


def alert_message(a: sqlite3.Row, sig: dict, lang: str) -> tuple[bool, str]:
    """對照 App 內 AlertCenter.evaluate 的判斷與文案。"""
    zh = lang == "zh"
    sym = a["symbol"]
    above = a["direction"] == "above"
    m = a["metric"]
    period = a["period"] or (10 if m == "ma" else 14)
    if m == "price" and sig.get("price") is not None:
        p = sig["price"]; hit = p >= a["target"] if above else p <= a["target"]
        return hit, (f"{sym} 價格 {_fmt(p)} {'突破' if above else '跌破'} {_fmt(a['target'])}" if zh
                     else f"{sym} price {_fmt(p)} {'rose above' if above else 'fell below'} {_fmt(a['target'])}")
    if m == "rsi" and sig.get("rsi") is not None:
        r = sig["rsi"]; hit = r >= a["target"] if above else r <= a["target"]
        return hit, (f"{sym} RSI {int(r)} {'高於' if above else '低於'} {int(a['target'])}" if zh
                     else f"{sym} RSI {int(r)} {'above' if above else 'below'} {int(a['target'])}")
    if m == "ma" and sig.get("price") is not None and sig.get("ma") is not None:
        p, mv = sig["price"], sig["ma"]; hit = p >= mv if above else p <= mv
        return hit, (f"{sym} 價格 {_fmt(p)} {'突破' if above else '跌破'} MA({period}) {_fmt(mv)}" if zh
                     else f"{sym} price {_fmt(p)} {'above' if above else 'below'} MA({period}) {_fmt(mv)}")
    if m == "vwap" and sig.get("price") is not None and sig.get("vwap") is not None:
        p, w = sig["price"], sig["vwap"]; hit = p >= w if above else p <= w
        return hit, (f"{sym} 價格 {_fmt(p)} {'高於' if above else '低於'} VWAP {_fmt(w)}" if zh
                     else f"{sym} price {_fmt(p)} {'above' if above else 'below'} VWAP {_fmt(w)}")
    if m == "macd" and sig.get("macd") is not None and sig.get("macdSignal") is not None:
        hit = sig["macd"] >= sig["macdSignal"] if above else sig["macd"] <= sig["macdSignal"]
        return hit, (f"{sym} MACD {'黃金交叉(轉多)' if above else '死亡交叉(轉空)'}" if zh
                     else f"{sym} MACD {'bullish cross' if above else 'bearish cross'}")
    if m == "moneyOutflow":
        hit = bool(sig.get("moneyOutflow"))
        return hit, (f"{sym} 偵測到大戶出金(資金流出)" if zh else f"{sym} big-money outflow detected")
    return False, ""


# ---------------- 排程 ----------------

def _is_us_market_hours(now_utc: datetime) -> bool:
    """美東 09:30–16:00,週一到週五(簡化處理 DST:3 月第二個週日到 11 月第一個週日用 EDT)。"""
    y = now_utc.year
    def nth_sunday(month: int, n: int) -> datetime:
        d = datetime(y, month, 1, tzinfo=timezone.utc)
        first_sun = d + timedelta(days=(6 - d.weekday()) % 7)
        return first_sun + timedelta(weeks=n - 1)
    dst = nth_sunday(3, 2) <= now_utc < nth_sunday(11, 1)
    et = now_utc - timedelta(hours=4 if dst else 5)
    if et.weekday() >= 5:
        return False
    t = et.hour * 60 + et.minute
    return 9 * 60 + 30 <= t <= 16 * 60


class Scheduler:
    """由 main.py 在啟動時呼叫 start(),注入取得訊號/報價/財報的函式。"""

    def __init__(self, compute_signals: Callable, get_quote: Callable, get_earnings: Callable, history_dir: Path):
        self.compute_signals = compute_signals
        self.get_quote = get_quote
        self.get_earnings = get_earnings
        self.history_dir = history_dir
        self._task: asyncio.Task | None = None
        self._last_daily: str = ""

    def start(self) -> None:
        if self._task is None:
            self._task = asyncio.create_task(self._loop())
            logger.info("push scheduler started")

    async def _loop(self) -> None:
        await asyncio.sleep(20)   # 等 API 啟動完
        while True:
            try:
                now = datetime.now(timezone.utc)
                local = datetime.now()
                if _is_us_market_hours(now):
                    await self.evaluate_alerts()
                # 每天本機 06:10 之後跑一次每日事件(排名剛更新完)
                today = local.strftime("%Y-%m-%d")
                if self._last_daily != today and (local.hour, local.minute) >= (6, 10):
                    self._last_daily = today
                    await self.daily_events()
            except Exception as e:
                logger.warning("push scheduler tick failed: %s", e)
            await asyncio.sleep(300)

    # -- 價格 / 技術提醒 --

    async def evaluate_alerts(self) -> int:
        with _db() as c:
            rows = c.execute("SELECT a.*, d.lang FROM alerts a JOIN devices d ON d.token=a.token WHERE a.enabled=1").fetchall()
        if not rows:
            return 0
        sent = 0
        now = time.time()
        sig_cache: dict[tuple, dict] = {}
        for a in rows:
            if a["last_triggered"] and now - a["last_triggered"] < 12 * 3600:
                continue
            key = (a["symbol"], a["period"], a["fast"], a["slow"], a["signal"])
            if key not in sig_cache:
                sig_cache[key] = await asyncio.to_thread(self._signals_for, a)
            sig = sig_cache[key]
            if not sig:
                continue
            hit, msg = alert_message(a, sig, a["lang"] or "zh")
            if not hit:
                continue
            title = "📈 股價提醒" if (a["lang"] or "zh") == "zh" else "📈 Stock alert"
            ok, info = await APNs.send(a["token"], title, msg, {"symbol": a["symbol"], "kind": "alert"})
            logger.info("push alert %s %s -> %s %s", a["symbol"], a["metric"], ok, info)
            if ok:
                sent += 1
                with _db() as c:
                    c.execute("UPDATE alerts SET last_triggered=? WHERE id=? AND token=?", (now, a["id"], a["token"]))
        return sent

    def _signals_for(self, a: sqlite3.Row) -> dict:
        sym = a["symbol"]
        path = self.history_dir / f"{sym}.json"
        sig: dict = {}
        if path.exists():
            try:
                rows = json.loads(path.read_text(encoding="utf-8"))
                m = a["metric"]
                period = a["period"] or (10 if m == "ma" else (20 if m == "vwap" else 14))
                sig = dict(self.compute_signals(sym, rows, period, a["fast"] or 12, a["slow"] or 26, a["signal"] or 9))
            except Exception as e:
                logger.warning("signals %s failed: %s", sym, e)
        # 價格用即時報價(歷史檔是昨收)
        try:
            q = self.get_quote(sym)
            live = q.get("regularPrice") or q.get("displayPrice") or q.get("price")
            if live:
                sig["price"] = float(live)
        except Exception:
            pass
        return sig

    # -- 每日:AI 精選換榜、明天財報 --

    async def daily_events(self) -> None:
        await self._ranking_changes()
        await self._earnings_tomorrow()

    async def _ranking_changes(self) -> None:
        path = BASE_DIR / "ranking_latest.json"
        if not path.exists():
            return
        data = json.loads(path.read_text(encoding="utf-8"))
        as_of = data.get("asOf") or datetime.now().strftime("%Y-%m-%d")
        symbols = [i["symbol"] for i in data.get("items", [])][:20]
        with _db() as c:
            prev_row = c.execute("SELECT symbols FROM ranking_snapshot ORDER BY as_of DESC LIMIT 1").fetchone()
            already = c.execute("SELECT 1 FROM ranking_snapshot WHERE as_of=?", (as_of,)).fetchone()
            c.execute("INSERT OR REPLACE INTO ranking_snapshot VALUES(?,?)", (as_of, json.dumps(symbols)))
        if already or not prev_row:
            return
        prev = json.loads(prev_row["symbols"])
        new_in = [s for s in symbols if s not in prev][:5]
        if not new_in:
            return
        with _db() as c:
            devices = c.execute("SELECT token, lang FROM devices").fetchall()
        for d in devices:
            zh = (d["lang"] or "zh") == "zh"
            title = "✨ AI 精選更新" if zh else "✨ AI Top Picks updated"
            body = (f"新進榜:{'、'.join(new_in)}" if zh else f"New this week: {', '.join(new_in)}")
            await APNs.send(d["token"], title, body, {"kind": "ranking"})

    async def _earnings_tomorrow(self) -> None:
        tomorrow = (datetime.now() + timedelta(days=1)).strftime("%Y-%m-%d")
        with _db() as c:
            pairs = c.execute("SELECT w.token, w.symbol, d.lang FROM watch w JOIN devices d ON d.token=w.token").fetchall()
        by_symbol: dict[str, list] = {}
        for p in pairs:
            by_symbol.setdefault(p["symbol"], []).append(p)
        for sym, targets in by_symbol.items():
            try:
                e = await asyncio.to_thread(self.get_earnings, sym, 1)
            except Exception:
                continue
            nxt = str(e.get("nextEarningsDate") or "")[:10]
            if nxt != tomorrow:
                continue
            for t in targets:
                key = f"earn:{t['token']}:{sym}:{tomorrow}"
                with _db() as c:
                    if c.execute("SELECT 1 FROM sent_log WHERE key=?", (key,)).fetchone():
                        continue
                    c.execute("INSERT INTO sent_log VALUES(?,?)", (key, time.time()))
                zh = (t["lang"] or "zh") == "zh"
                title = "📅 明天財報" if zh else "📅 Earnings tomorrow"
                body = f"{sym} 明天公布財報,留意波動。" if zh else f"{sym} reports earnings tomorrow."
                await APNs.send(t["token"], title, body, {"symbol": sym, "kind": "earnings"})
