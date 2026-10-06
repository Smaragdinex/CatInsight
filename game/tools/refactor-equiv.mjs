// 回合流程搬進引擎時的對照測試:舊版 board.mjs 的規則(逐字抄出)vs engine.mjs,隨機局面 5 萬多次比對。node tools/refactor-equiv.mjs
// 舊版遊戲規則(逐字從 git HEAD 的 board.mjs 抄出來,只把 S / Math.random 換成參數)vs 新引擎,隨機狀態比對
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeEngine } from '../web/catinsight-3d/board/engine.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const D = gameData((a) => a, String), { KEYS, NON_EQUITY, TILES, LANES, LANE_LEN, PATH_POOL, IPO_OFF, IPO_FREE, LOT, JAIL_WAIT, SALARY, MARGIN_FEE, BANK_RATE } = D;
const PATH_FIXED = { jail: { 2: 'chance' }, ipo: { 2: 'chance' } };
const ENG = makeEngine(D), SIM = makeSim(D, { seed: 1 });
const mk = (s) => { let seed = s; return () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
// ---- 舊版 ----
function oldGenLanePath(type, R) { const t = new Array(LANE_LEN).fill(null), fixed = PATH_FIXED[type] || {}; for (const i in fixed) t[i] = fixed[i];
  const free = () => t.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0); for (let n = 0; n < 2; n++) { const f = free(); t[f[Math.floor(R() * f.length)]] = 'fate'; }
  const pool = PATH_POOL[type].filter((k) => !Object.values(fixed).includes(k)).sort(() => R() - 0.5); for (let i = 0; i < LANE_LEN; i++) if (!t[i]) t[i] = pool.pop(); return t; }
const oldIpoPick = (who, R) => { const pool = KEYS.filter((k) => !NON_EQUITY.has(k) && !who.short[k].n); return pool[Math.floor(R() * pool.length)]; };
function oldIpoGrant(S, who, k) { const h = who.hold[k]; h.n += IPO_FREE; h.cost += S.price[k] * IPO_OFF * IPO_FREE; }
function oldAiIpo(S, A, R) { const k = oldIpoPick(A, R), price = S.price[k] * IPO_OFF; const lots = A.cash >= price * LOT * 3 + 1500 ? 3 : A.cash >= price * LOT + 500 ? 1 : 0; oldIpoGrant(S, A, k);
  if (lots) { const n = LOT * lots; A.cash -= price * n; A.hold[k].n += n; A.hold[k].cost += price * n; } }
const oldLaneTileType = (S, lane) => { if (!lane.at) return '_' + lane.type; const k = S.lanePath[lane.type][lane.at - 1]; return k === 'fate' ? 'fate' : k === 'blank' ? '_path' : '_' + k; };
function oldPathEffect(who, k) { if (k === '_interest') { const g = Math.round(Math.max(0, who.cash) * 0.03); who.cash += g; } if (k === '_coin') who.cash += 300; if (k === '_fee') who.cash -= 200; }
function oldPayday(S, p, atStart) { const salary = atStart ? SALARY * (p.salary2 ? 2 : 1) : 0; if (atStart) p.salary2 = false; const div = atStart ? 0 : KEYS.reduce((a, k) => a + p.hold[k].n * S.price[k] * S.div[k], 0);
  p.cash += salary + div - (atStart ? KEYS.reduce((a, k) => a + p.hold[k].loan * MARGIN_FEE, 0) + p.debt * BANK_RATE : 0); }
function oldStepAlong(S, who, n) { for (let i = 0; i < n; i++) { who.pos = (who.pos + 1) % TILES.length; if (who.pos === 0 || TILES[who.pos] === 'divi') ENG.payday(S, who, who.pos === 0); } }   // 第二步起舊版已經用引擎的 payday
function oldLeaveLane(S, who, d) { const def = LANES[who.lane.type]; for (let i = 0; i < d; i++) { if (who.lane.at < LANE_LEN) { who.lane.at++; continue; } who.lane = null; who.pos = def.exit; oldStepAlong(S, who, d - i - 1); break; } }
// ---- 隨機局面 ----
function randState(R) {
  const S = { price: Object.fromEntries(KEYS.map((k) => [k, 20 + R() * 200])), div: Object.fromEntries(KEYS.map((k) => [k, Math.floor(R() * 6) / 100])), players: [], lanePath: { jail: oldGenLanePath('jail', R), ipo: oldGenLanePath('ipo', R) }, rolls: 3, turn: 0 };
  for (let i = 0; i < 3; i++) S.players.push({ i, cash: 500 + R() * 15000, debt: R() < 0.3 ? 1000 : 0, pos: Math.floor(R() * 64), lane: null, bag: [], salary2: R() < 0.3,
    hold: Object.fromEntries(KEYS.map((k) => [k, R() < 0.3 ? { n: 10 * (1 + Math.floor(R() * 5)), cost: 1000 + R() * 3000, loan: R() < 0.3 ? 300 + R() * 500 : 0 } : { n: 0, cost: 0, loan: 0 }])),
    short: Object.fromEntries(KEYS.map((k) => [k, R() < 0.1 ? { n: 10, entry: 50 + R() * 100 } : { n: 0, entry: 0 }])) });
  return S;
}
const clone = (x) => JSON.parse(JSON.stringify(x));
let n = 0, bad = []; const same = (a, b, what) => { n++; if (JSON.stringify(a) !== JSON.stringify(b)) bad.push(what); };
for (let s = 1; s <= 3000; s++) {
  const R0 = mk(s), base = randState(R0);
  // 小路生成
  for (const type of ['jail', 'ipo']) same(oldGenLanePath(type, mk(s * 7)), ENG.genLanePath(type, mk(s * 7)), 'genLanePath ' + type);
  // IPO(電腦):抽股 + 送股 + 加購
  { const a = clone(base), b = clone(base); oldAiIpo(a, a.players[1], mk(s * 11)); const R = mk(s * 11), p = b.players[1], k = ENG.ipoPick(b, p, R); ENG.ipoGrant(b, p, k); const lots = SIM.ipoLots(b, p, k); if (lots) ENG.ipoBuy(b, p, k, LOT * lots); same(a, b, 'ipo'); }
  // 外圈走 n 格(經過起點 / 股息格發薪配息)
  { const steps = 1 + Math.floor(R0() * 18), a = clone(base), b = clone(base); oldStepAlong(a, a.players[0], steps); for (let i = 0; i < steps; i++) ENG.advance(b, b.players[0]); same(a, b, 'walk'); }
  // 小路:進去、走出來(含出口和外圈剩下的步數)
  { const type = R0() < 0.5 ? 'jail' : 'ipo', at = Math.floor(R0() * 7), d = 1 + Math.floor(R0() * 6), a = clone(base), b = clone(base);
    a.players[2].lane = { type, wait: 0, at }; b.players[2].lane = { type, wait: 0, at }; oldLeaveLane(a, a.players[2], d); for (let i = 0; i < d; i++) ENG.advance(b, b.players[2]); same(a, b, 'leaveLane');
    // 站在小路格子上:種類 + 效果
    const c = clone(base), e = clone(base); c.players[0].lane = { type, wait: 0, at }; e.players[0].lane = { type, wait: 0, at };
    const t1 = oldLaneTileType(c, c.players[0].lane), t2 = ENG.tileType(e, e.players[0], mk(1)); same(t1, t2, 'tileType'); oldPathEffect(c.players[0], t1); if (t2.startsWith('_')) ENG.pathEffect(e, e.players[0], t2); same(c, e, 'pathEffect'); }
  // 骰子(遙控、三顆、一顆、兩顆)
  for (const [nd, f] of [[1, 0], [2, 0], [3, 0], [2, 9], [1, 4]]) { const R1 = mk(s * 13), R2 = mk(s * 13), r6 = () => 1 + Math.floor(R1() * 6);
    const old = f ? (f <= 6 ? [f] : [Math.floor(f / 2), f - Math.floor(f / 2)]) : nd === 3 ? [r6(), r6(), r6()] : nd === 1 ? [r6()] : [r6(), r6()]; same(old, ENG.dice(nd, f, R2), 'dice'); }
}
// 命運牌(舊版 board.mjs applyFate 的狀態部分,動畫和提示拿掉)
function oldFate(S, who, c, R) {
  const others = S.players.filter((p) => p.i !== who.i);
  if (c.id === 'lottery') who.cash += 1500;
  else if (c.id === 'tax') { const t = Math.round(Math.max(0, who.cash) * 0.05); who.cash -= t; }
  else if (c.id === 'birthday') { let got = 0; others.forEach((p) => { p.cash -= 200; got += 200; }); who.cash += got; }
  else if (c.id === 'phone') who.cash -= 300;
  else if (c.id === 'fine') who.cash -= 500;
  else if (c.id === 'richest') { const r = others.sort((a, b) => ENG.assetsOf(S, b) - ENG.assetsOf(S, a))[0]; r.cash -= 500; who.cash += 500; }
  else if (c.id === 'remote' || c.id === 'atk') who.bag.push(c.id);
  else if (c.id === 'divi') ENG.payday(S, who, false);
  else if (c.id === 'salary2') who.salary2 = true;
  else if (c.id === 'gostart') { who.lane = null; who.pos = 0; ENG.payday(S, who, true); }
  else if (c.id === 'fat') { const held = KEYS.filter((k) => who.hold[k].n > 0); if (held.length) { const k = held[Math.floor(R() * held.length)]; ENG.sell(S, who, k, Infinity, true); } }
  else if (c.id === 'swap') { const o = others, r = o[Math.floor(R() * o.length)]; [who.pos, r.pos] = [r.pos, who.pos]; [who.lane, r.lane] = [r.lane, who.lane]; }
}
for (let s = 1; s <= 1500; s++) for (const c of D.FATE) {
  if (c.id === 'ipo') continue;
  const base = randState(mk(s * 17)); base.players.forEach((p) => { p.flags = {}; });
  base.players[1].lane = s % 3 === 0 ? { type: 'jail', wait: 2, at: 3 } : null;
  const a = clone(base), b = clone(base); oldFate(a, a.players[s % 3], c, mk(s * 19)); ENG.fate(b, b.players[s % 3], c, mk(s * 19)); same(a, b, 'fate ' + c.id);
}
console.log(`${n} comparisons, ${bad.length} mismatches`, bad.slice(0, 10));
