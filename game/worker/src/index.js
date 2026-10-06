// 貓咪股市大富翁 全球排行榜
//   GET  /api/board/top?limit=10        前 N 名
//   POST /api/board/submit  {name,char,assets,rounds,players,ai,lang}   回傳 {rank, top}
// 全球榜只收「4 人局 + 困難難度」:其他局送來會回 403;舊資料庫裡其他局的紀錄保留,但排名和列表都不算
// 遊戲規則都在前端,所以分數是可以偽造的;這裡只做合理性檢查 + 每個 IP 的頻率限制,擋掉亂送的。
const CHARS = new Set(['cat', 'bunny', 'bear', 'dog', 'penguin', 'guinea', 'fox', 'pony']);
const AI = new Set(['easy', 'normal', 'hard']);
const MAX_ASSETS = 300000;        // 20~40 回合、起始 $10,000,正常玩不可能超過這個數
const MAX_PER_HOUR = 12;          // 同一個 IP 一小時最多送幾筆
const RANKED = 'players = 4 AND ai = \'hard\'';   // 上榜條件(SQL);改這裡和前端 board.mjs 的 lbEligible

// 正式站是同網域不需要 CORS;開放 localhost 是為了本機測試(網址加 ?lb=1)
const corsHeaders = (req) => { const o = req.headers.get('origin') || ''; return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(o) || o === `https://${new URL(req.url).host}` ? { 'access-control-allow-origin': o, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'vary': 'origin' } : {}; };
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra } });

async function sha256(s) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s));
  return [...new Uint8Array(buf)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
const clean = (s, max) => String(s ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, max);

async function top(env, limit) {
  const { results } = await env.DB.prepare(`SELECT name, char, assets, rounds, players, ai, created_at FROM records WHERE ${RANKED} ORDER BY assets DESC, created_at ASC LIMIT ?`).bind(limit).all();
  return results;
}

// ---------- 線上同樂:房間(Durable Object)----------
// 主機(跑遊戲的那台)和手機都用 WebSocket 連到同一個房間;房間只負責轉送訊息,不懂遊戲規則。
//   POST /api/board/room/new            → { code }
//   GET  /api/board/room/:code/ws?role=host|guest   → WebSocket
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // 去掉容易看錯的 I O 0 1
const genCode = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
export class Room {
  constructor(state) { this.state = state; }
  async fetch(req) {
    const url = new URL(req.url);
    if (url.pathname === '/init') { await this.state.storage.put('created', Date.now()); await this.state.storage.setAlarm(Date.now() + 8 * 3600e3); return new Response('ok'); }
    if (req.headers.get('upgrade') !== 'websocket') return new Response('expected websocket', { status: 426 });
    if (!(await this.state.storage.get('created'))) return new Response('no such room', { status: 404 });
    const role = url.searchParams.get('role') === 'host' ? 'host' : 'guest';
    if (role === 'host') for (const ws of this.state.getWebSockets('host')) { try { ws.close(1000, 'replaced'); } catch (e) {} }   // 主機重連:舊的連線踢掉
    const pair = new WebSocketPair(), [client, server] = Object.values(pair);
    const id = role === 'host' ? 'host' : 'g' + Math.random().toString(36).slice(2, 8);
    this.state.acceptWebSocket(server, [role, id]); server.serializeAttachment({ role, id });
    if (role === 'guest') this.toHost({ t: 'conn', from: id }); else this.toGuests({ t: 'host', on: true });
    return new Response(null, { status: 101, webSocket: client });
  }
  send(ws, msg) { try { ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg)); } catch (e) {} }
  toHost(msg) { for (const ws of this.state.getWebSockets('host')) this.send(ws, msg); }
  toGuests(msg, to) { const s = JSON.stringify(msg); for (const ws of this.state.getWebSockets('guest')) { if (!to || ws.deserializeAttachment().id === to) this.send(ws, s); } }
  async webSocketMessage(ws, data) {
    const { role, id } = ws.deserializeAttachment(); let msg; try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (role === 'guest') { msg.from = id; this.toHost(msg); }
    else { const to = msg.to; delete msg.to; this.toGuests(msg, to); }
  }
  async webSocketClose(ws) { const a = ws.deserializeAttachment(); if (a.role === 'guest') this.toHost({ t: 'gone', from: a.id }); else if (!this.state.getWebSockets('host').length) this.toGuests({ t: 'host', on: false }); }
  async webSocketError(ws) { return this.webSocketClose(ws); }
  async alarm() { for (const ws of this.state.getWebSockets()) { try { ws.close(1000, 'expired'); } catch (e) {} } await this.state.storage.deleteAll(); }
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url), cors = corsHeaders(req);
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (req.method === 'POST' && url.pathname === '/api/board/room/new') {
      const code = genCode(); await env.ROOM.get(env.ROOM.idFromName(code)).fetch('https://room/init', { method: 'POST' });
      return json({ code }, 200, cors);
    }
    { const m = url.pathname.match(/^\/api\/board\/room\/([A-Z0-9]{4})\/ws$/);
      if (m) return env.ROOM.get(env.ROOM.idFromName(m[1])).fetch(req); }
    if (req.method === 'GET' && url.pathname === '/api/board/top') {
      const limit = Math.min(50, Math.max(1, +url.searchParams.get('limit') || 10));
      return json({ top: await top(env, limit) }, 200, cors);
    }
    if (req.method === 'POST' && url.pathname === '/api/board/submit') {
      let b; try { b = await req.json(); } catch { return json({ error: 'bad json' }, 400, cors); }
      const name = clean(b.name, 12), char = String(b.char || ''), ai = String(b.ai || 'normal'), lang = clean(b.lang, 5) || 'zh';
      const assets = Math.round(+b.assets), rounds = +b.rounds, players = +b.players;
      if (!name) return json({ error: 'name' }, 400, cors);
      if (!CHARS.has(char) || !AI.has(ai)) return json({ error: 'char/ai' }, 400, cors);
      if (!Number.isFinite(assets) || assets < 0 || assets > MAX_ASSETS) return json({ error: 'assets' }, 400, cors);
      if (![20, 25, 30, 35, 40].includes(rounds) || players < 2 || players > 4) return json({ error: 'rounds/players' }, 400, cors);
      if (players !== 4 || ai !== 'hard') return json({ error: 'not ranked: only 4-player hard games' }, 403, cors);
      const ip = req.headers.get('cf-connecting-ip') || '0', ipHash = await sha256(ip + (env.SALT || 'catstreet')), now = Math.floor(Date.now() / 1000);
      const recent = await env.DB.prepare('SELECT COUNT(*) AS n FROM records WHERE ip_hash = ? AND created_at > ?').bind(ipHash, now - 3600).first('n');
      if (recent >= MAX_PER_HOUR) return json({ error: 'too many' }, 429, cors);
      await env.DB.prepare('INSERT INTO records (name, char, assets, rounds, players, ai, lang, ip_hash, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .bind(name, char, assets, rounds, players, ai, lang, ipHash, now).run();
      const rank = 1 + (await env.DB.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${RANKED} AND assets > ?`).bind(assets).first('n'));
      return json({ rank, top: await top(env, 20) }, 200, cors);
    }
    return json({ error: 'not found' }, 404);
  },
};
