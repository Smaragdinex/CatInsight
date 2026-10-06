// Cat Street Stocks —— 股票大富翁(3D 初稿)
// 等軸測棋盤 + 立體格子 + 可擲的骰子 + 貓咪棋子;用「任務」決定過關,不用倒數計時。
// 公司都是虛構的,事件卡把總體經濟事件和各類股的連動寫成資料(EVENTS)。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { OutlineEffect } from 'three/addons/effects/OutlineEffect.js';

const $ = (id) => document.getElementById(id);
const fmt = (n) => Math.round(n).toLocaleString('en-US');
const APP_URL = 'https://apps.apple.com/app/id6763914049';

/* ───────────── 語言 ───────────── */
// 預設跟瀏覽器語言;網址加 ?lang=en / ?lang=zh 可強制
// 順序:網址 ?lang= → 上次在主畫面選的(localStorage)→ 瀏覽器語言
const savedLang = (() => { try { return localStorage.getItem('css.lang'); } catch (e) { return null; } })();
const ZH = (new URLSearchParams(location.search).get('lang') || savedLang || navigator.language || 'en').toLowerCase().startsWith('zh');
const L = (en, zh) => (ZH ? zh : en);

/* ───────────── 資料 ───────────── */
import { gameData } from './data.mjs?v=18';
import { makeSim } from './sim.mjs?v=23';
import { makeEngine } from './engine.mjs?v=11';
import { makeAiPlan } from './aiplan.mjs?v=1';
const GD = gameData(L, fmt);      // 遊戲資料:畫面、遊戲引擎、電腦模擬都用同一份
const { LANES, PATH_POOL, PATH_FIXED, MARKET_DRIFT, DIV_STEP, DIV_MAX, DIV_MIN, DIV_UP_PRICE, DIV_CUT_PRICE, SECTORS, KEYS, N, TILES, TILE_COLOR, NON_EQUITY, EV, EVENTS, ONES, BAIL, JAIL_WAIT, LANE_LEN, IPO_OFF, IPO_LOCK, IPO_FREE, BANK_MAX, BANK_RATE, LOT, START_CASH, SALARY, FEE, MAX_ROLLS, DIV_ROUND, FATE, MARGIN_LOAN, MAINT, MARGIN_FEE, SQUEEZE, buyF, sellF, shortF, SHORT_F, REMOTE_PRICE, CARD_PRICE, ATK_PRICE, ATK_DROP, SPY_PRICE, SPY_ROUNDS, DICE3_PRICE } = GD;
const PATH_INFO = {
  fate: { color: 0xc08cf5, base: 0x9a6ad8, a: '★', b: L('FATE', '命運') },
  chance: { color: 0xffd24a, base: 0xd9ad2a, a: '?', b: L('EVENT', '市場事件') },
  gift: { color: 0xf27a98, base: 0xc9587a, a: L('GIFT', '禮物'), b: L('free item', '送道具') },
  fee: { color: 0x9aa0ad, base: 0x7b8290, a: L('FEE', '手續費'), b: '-$200' },
  interest: { color: 0x4a63b0, base: 0x37508f, a: L('INTEREST', '利息'), b: L('+3% cash', '現金 +3%') },
  coin: { color: 0x57b86b, base: 0x3f9a52, a: L('CASH', '撿到錢'), b: '+$300' },
};
// 事件生效:改股價;有些事件(普發現金)還會直接發錢給每一位玩家
// 事件生效:規則(股價、發錢、殖利率、反彈、斷頭 / 軋空、躲過黑天鵝)在遊戲引擎;這裡負責音效、反彈的說明文字、事件鈕的「!」
function applyEvent(e) {
  ENG.applyEvent(S, e);
  if (e.cash) sfx('coin');
  if (e.rebound && S.after) Object.assign(S.after, { t: L(`Rebound after: ${e.t}`, `${e.t}後的反彈`), w: L('Part of a panic drop comes back once the panic passes. Selling at the bottom locks in the loss.', '恐慌過去後,跌掉的會漲回來一部分。在最低點賣掉,就是把虧損鎖死。') });   // 下一回合開始時套用(見 turn)
  noteEvent(e);
}
const noteEvent = (e) => { S.lastEvent = e; if ($('evtBox').classList.contains('fold')) $('evtBadge').classList.remove('hide'); };      // 新事件:右邊的事件鈕亮「!」
// 抽到牌的當下決定內容(哪幾家調股利、迷因股是哪一檔)由遊戲引擎決定;這裡只把公司名稱加進標題
function instantiate(e) {
  const x = ENG.instantiate(S, e, Math.random), sep = L(': ', ':');
  if (x.divKeys && x.divKeys.length) return { ...x, t: `${e.t}${sep}${x.divKeys.map((k) => SECTORS[k].name).join(L(', ', '、'))}` };
  if (x.squeezeAll) return { ...x, t: `${e.t}${sep}${SECTORS[x.squeezeAll].name}` };
  if (x.pickKey) return { ...x, t: `${e.t}${sep}${SECTORS[x.pickKey].name}` };
  return x;
}
const divPct = (x) => `${+(x * 100).toFixed(1)}%`;
// 大盤趨勢的文字:▲ 每回合 +1% / ▼ 每回合 −2%
// 事件卡是好是壞:會改大盤趨勢的看趨勢方向(疫情、戰爭雖然有幾檔大漲,大盤是轉空的),其他看大盤 ETF 漲跌
const evGood = (e) => (e.trend != null ? e.trend > 0 : e.m.etf >= 1);
const trendTxt = (t) => `${t >= 0 ? '▲' : '▼'} ${L('per round', '每回合')} ${t >= 0 ? '+' : '−'}${Math.round(Math.abs(t) * 100)}%`;
const trendChip = (e) => (e.trend == null ? '' : `<span class="mv ${e.trend >= 0 ? 'up' : 'dn'}">${e.trend >= 0 ? L('Market turns up', '大盤轉多') : L('Market turns down', '大盤轉空')} ${trendTxt(e.trend)}</span>`);      // 殖利率顯示:0.5% / 1.5% / 5%
// 買股面板的配息說明:目前殖利率是動態的(股利事件會調),介紹文字不寫數字,這裡顯示現在的值;調高過綠色、被削減過紅色
const divNote = (k) => { const now = S.div[k], base = SECTORS[k].div; if (!(now > 0)) return '';
  const c = now > base + 1e-9 ? '#1c8a4a' : now < base - 1e-9 ? '#c4472f' : '#5b4a40', tag = now > base + 1e-9 ? L(' (raised)', '(調高過)') : now < base - 1e-9 ? L(' (cut)', '(被削減過)') : '';
  return ` <b style="color:${c}">${L(`Pays ${divPct(now)} a lap${tag}.`, `目前每圈配息 ${divPct(now)}${tag}。`)}</b>`; };
// 牌面字太多(英文的說明比較長、股利事件的標籤比較多)時自動縮小字級,直到整張塞得下;
// 牌的大小會變(手機上翻開的那張會放大),所以用 ResizeObserver 每次變大小都重算
const cardFitRO = typeof ResizeObserver !== 'undefined' ? new ResizeObserver((es) => es.forEach((x) => fitCardFace(x.target))) : null;
function fitCardFace(f) {
  let k = 1; f.style.setProperty('--fit', 1);
  while (f.scrollHeight > f.clientHeight + 1 && k > 0.62) { k -= 0.04; f.style.setProperty('--fit', k.toFixed(2)); }
}
function fitCards(ov) { ov.querySelectorAll('.dfront').forEach((f) => { fitCardFace(f); if (cardFitRO) cardFitRO.observe(f); }); }
const cashChip = (e) => trendChip(e) + (e.cash ? `<span class="mv up">${L(`Everyone +$${fmt(e.cash)}`, `每人 +$${fmt(e.cash)}`)}</span>` : '') +
  (e.divTo ? e.divKeys.map((k) => `<span class="mv ${e.divTo[k][1] >= e.divTo[k][0] ? 'up' : 'dn'}">${SECTORS[k].code} ${pct(e.m[k])} · ${L('yield', '殖利率')} ${divPct(e.divTo[k][0])}→${divPct(e.divTo[k][1])}</span>`).join('') : '');   // 股利事件:漲跌和殖利率合成一顆,不重複列
// 玩法:走滿選定的回合數(選角畫面可以選 20 / 25 / 30 / 35 / 40),總資產最高的人獲勝
const ROUND_OPTS = [20, 25, 30, 35, 40];
const AI_ORDER = ['easy', 'normal', 'hard'];   // 設定卡的 − / + 依這個順序切難度
// 電腦難度(選角畫面可以選):
//   三種都會買卡、放空、融資,差別在「機率」和「多狠」:
//   easy   簡單:放空、買卡、用卡的機率都低,很少融資,現金留得多
//   normal 一般:原本的策略(偶爾融資、漲多才放空、有閒錢買利空卡)
//   hard   兇狠:專打第一名 —— 常用融資、只要有人持有就放空、利空卡一有錢就買、現金留得少
//   shortP:符合放空條件時真的放空的機率;atkP:商店有利空卡時買、手上有利空卡時用的機率;greedy:買股時改用融資的機率
// 電腦的個性:lots = 主攻股一次最多買幾手(每手 10 股);buyP = 想買 / 想逛商店時真的動手的機率;shortP = 符合條件時放空的機率
// 參數的值在 sim.mjs 的 LEVELS(遊戲和模擬器共用一份)
const AI = () => SIM.LEVELS[S.aiLevel] || SIM.LEVELS.normal;
// 三種難度 = 三種演算法:簡單 = 規則式(rule)、普通 = 期望值(ev)、困難 = 蒙地卡羅模擬(mc)。細節在 sim.mjs
const AI_ALG = { easy: 'rule', normal: 'ev', hard: 'mc' };
const aiAlg = () => AI_ALG[S.aiLevel] || 'ev';
const SIM = makeSim(GD,
  { mc: { n: 120, depth: 3 } });
// 模擬跑在 Web Worker(開不起來就在主執行緒算)。回傳 Promise,aiTurn / aiLand 用 await 等
const AIW = (() => { try { const w = new Worker('./ai-worker.mjs?v=28', { type: 'module' }); w.onerror = () => { AIW_BAD = true; }; return w; } catch (e) { return null; } })();
let AIW_BAD = false, aiwId = 0; const aiwWait = {};
if (AIW) AIW.onmessage = (ev) => { const r = aiwWait[ev.data.id]; if (r) { delete aiwWait[ev.data.id]; r(ev.data.act); } };
function simDecide(kind, st, i, k) {
  const p = st.players[i], alg = aiAlg(), local = () => (kind === 'dice' ? (alg === 'mc' ? SIM.mcDice(st, p) : SIM.evDice(st, p)) : (alg === 'mc' ? SIM.mcTrade(st, p, k) : SIM.evTrade(st, p, k)));
  if (!AIW || AIW_BAD) return Promise.resolve(local());
  return new Promise((res) => {
    const id = ++aiwId, timer = setTimeout(() => { if (aiwWait[id]) { delete aiwWait[id]; AIW_BAD = true; res(local()); } }, 6000);   // worker 沒回應:改用主執行緒
    aiwWait[id] = (act) => { clearTimeout(timer); res(act && !act.error ? act : local()); };
    AIW.postMessage({ id, kind, st, i, k, mc: { ...SIM.MC, alg }, zh: ZH });
  });
}
// 把現在的局面抄成模擬器用的狀態 —— 用電腦 A「看得到」的版本:自己全部真實;對手的持股只用公開帳本 / 偵查結果(pubView),
// 現金和貸款看不到,用「起始現金 − 已知持股的成本 + 每回合大約的薪水配息」粗估(只影響對手在模擬裡還買不買得起)
function simSnapshot(A) {
  const st = SIM.newGame(S.players.map(() => aiAlg()), S.maxRounds, S.players.map(() => S.aiLevel));
  st.price = { ...S.price }; st.div = { ...S.div }; st.trend = S.trend; st.rolls = S.rolls; st.turn = A.i; st.after = S.after ? { m: { ...S.after.m } } : null; st.lanePath = { ...S.lanePath };
  S.players.forEach((q, i) => {
    const p = st.players[i]; p.pos = q.pos; p.lane = q.lane ? { ...q.lane } : null; p.salary2 = !!q.salary2;
    if (q === A) { p.cash = q.cash; p.debt = q.debt; p.bag = q.bag.slice(); p.plan = q.plan ? { ...q.plan } : null; p.spy = q.spy ? { ...q.spy } : null;
      KEYS.forEach((k) => { Object.assign(p.hold[k], q.hold[k]); Object.assign(p.short[k], q.short[k]); }); }
    else { let spent = 0; KEYS.forEach((k) => { const v = pubView(A, q, k); p.hold[k].n = v.n; p.hold[k].cost = v.n * S.price[k]; p.short[k].n = v.sh; p.short[k].entry = v.sh ? S.price[k] : 0; spent += v.n * S.price[k]; });
      p.cash = Math.max(1000, START_CASH - spent * 0.9 + S.rolls * 250); }
  });
  return st;
}
// 公開資訊帳本:每筆「畫面上公告過」的持股變化(買、賣、放空、回補、IPO、斷頭…)都記一筆。
// 電腦只能靠這本帳推測對手持股(還會依難度忘記舊的),除非牠用了偵查報告才看得到真實部位;總資產和現金永遠看不到
// 公告只說「買了 / 賣了 / 放空 / 回補」,沒說幾股,所以帳本裡的股數是推測:買一次當作 2 手、賣一次當作賣掉一半;
// 只有公告寫明「全部」的(斷頭、軋空、手滑全賣)才歸零。tn / tsh 是上次公告時的真實部位,只拿來判斷這次是買還是賣(方向本來就有公告)
const PUB_GUESS = 2 * LOT;
function pubNote(p, k, all = false) {
  if (!S || !p) return; if (p === S) p = S.players[S.hi]; /* 有些地方傳的是 S(現在這位人類的捷徑) */
  const book = ((S.pub ||= {})[p.i] ||= {}), e = book[k] || { n: 0, sh: 0, tn: 0, tsh: 0 }, tn = p.hold[k].n, tsh = p.short[k].n;
  const half = (x) => Math.round(x / 2 / LOT) * LOT;
  const n = all && tn === 0 ? 0 : tn > e.tn ? e.n + PUB_GUESS : tn < e.tn ? half(e.n) : e.n;
  const sh = all && tsh === 0 ? 0 : tsh > e.tsh ? e.sh + PUB_GUESS : tsh < e.tsh ? half(e.sh) : e.sh;
  book[k] = { n, sh, tn, tsh, at: S.rolls };
}
function pubView(A, q, k) {
  if (A.spy && S.rolls < A.spy.until && A.spy.target === q.i) return { n: q.hold[k].n, sh: q.short[k].n };     // 偵查中:看真的
  const e = S.pub && S.pub[q.i] && S.pub[q.i][k]; if (!e || S.rolls - e.at > AI().memory) return { n: 0, sh: 0 };   // 沒公告過 / 忘了:當作沒有
  return { n: e.n, sh: e.sh };
}
const maxRolls = () => S.maxRounds;
// 道具:放在背包裡,輪到自己、擲骰前可以用。商店格可以買,禮物格隨機送一個
function itemInfo(id) {
  if (id === 'remote') return { icon: '🎲', name: L('Remote dice', '遙控骰子'), desc: L('Pick any total from 2 to 12 instead of rolling.', '不用擲骰,自己指定走 2 到 12 步。'), price: REMOTE_PRICE };
  if (id === 'dice3') return { icon: '🎲🎲🎲', name: L('Third die', '三顆骰子'), price: DICE3_PRICE, desc: L('Roll three dice this turn: move 3 to 18 steps.', '這回合擲三顆骰子,一次走 3 到 18 步。') };
  if (id === 'spy') return { icon: '🔍', name: L('Spy report', '偵查報告'), price: SPY_PRICE,
    desc: L(`Pick a rival: for ${SPY_ROUNDS} rounds you can open their full holdings and assets.`, `選一位對手,接下來 ${SPY_ROUNDS} 回合可以打開他的完整持股和資產。`) };
  if (id === 'atk') return { icon: '📉', name: L('Bad news card', '利空消息卡'), price: ATK_PRICE,
    desc: L('Pick any asset and knock its price down 18%. Whoever holds it takes the hit.', '指定一種資產,價格立刻下跌 18%。誰持有誰受傷。') };
  const e = AP.evEvent(id), best = AP.evBest(id);
  return { icon: '<img class="cardico" src="card-event.webp" alt="">', name: L('Event card: ', '事件卡:') + e.t, event: e, best,
    desc: L(`Play it to trigger this event. ${SECTORS[best].code} +${Math.round((e.m[best] - 1) * 100)}%.`, `使用後立刻發生這個事件,${SECTORS[best].code} +${Math.round((e.m[best] - 1) * 100)}%。`), price: CARD_PRICE };
}
// 偵查:viewer 用了偵查報告指定 q,而且還在期限內 → 看得到 q 的完整資產
const spyOn = (viewer, q) => !!(viewer && viewer.spy && viewer.spy.target === q.i && S.rolls < viewer.spy.until);
const spyLeft = (viewer) => (viewer && viewer.spy ? Math.max(0, viewer.spy.until - S.rolls) : 0);

/* ───────────── 音效與音樂 ─────────────
   全部用 WebAudio 即時合成,不載入任何音檔。瀏覽器規定要使用者先點一下才能出聲,
   所以第一次點擊 / 按鍵時才建立 AudioContext 並開始播音樂。右上角 ♪ 可以關掉(會記住) */
const VER = (new URL(import.meta.url).searchParams.get('v') || '?');      // 版本號(來自 board.mjs?v=N),顯示在結算畫面
const EMBED = !!new URLSearchParams(location.search).get('embed') && parent !== window;
const CLIENT = new URLSearchParams(location.search).get('client');      // 手機端:?client=房號 → 自己畫棋盤、跟著主機的狀態走
if (EMBED) document.body.classList.add('embed');      // 嵌在街機裡:手機版右上角要留位置給外面的離開鈕
const AU = (() => {
  let ctx = null, master, mus, nbuf;
  let on = (() => { try { return localStorage.getItem('css.sound') !== '0'; } catch (e) { return true; } })();
  const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 一個音:m 是 MIDI 音高,t 是絕對時間;to 有給的話音高會滑過去
  function tone(m, t, dur, type = 'triangle', vol = 0.15, to = null, out = master) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(hz(m), t); if (to != null) o.frequency.exponentialRampToValueAtTime(hz(to), t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out); o.start(t); o.stop(t + dur + 0.03);
  }
  function noise(t, dur, vol = 0.15, freq = 3000, out = master) {
    const src = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    src.buffer = nbuf; f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 1.2;
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out); src.start(t, Math.random() * 0.4, dur + 0.02);
  }
  // 背景音樂:しゃろう「3:03 PM」(免費 BGM)。bgm.m4a 是從 30 分鐘版剪出來的一輪(剛好 128 秒)前後各多留 0.5 秒,
  // 用 loopStart / loopEnd 在檔案「裡面」循環 —— AAC 檔頭尾會被編碼器塞一點空白,直接整檔 loop 會聽到斷點。
  // 第一次點擊後才下載(約 1.5 MB)和解碼,好了就開始播
  // 背景音樂:Mixkit「Serene View」(免費商用),已剪成 92 秒無接縫循環(檔頭是尾巴和開頭的交叉淡化)
  const BGM_URL = new URL('./bgm.m4a?v=2', import.meta.url).href, LOOP_A = 0.05;
  let bgm = null;
  // 森林鳥鳴環境音(Mixkit「Forest birds ambience」,Mixkit License 免費商用):進入遊戲才淡入、循環播,壓在音樂底下;選角畫面淡出
  let amb = null, ambGain = null, ambWant = false, ambLoading = false;
  const AMB_URL = new URL('./ambience.m4a?v=1', import.meta.url);
  async function loadAmb() {
    if (ambLoading || !ctx) return; ambLoading = true;
    try {
      const data = await (await fetch(AMB_URL)).arrayBuffer();
      const buf = await new Promise((ok, no) => { const p = ctx.decodeAudioData(data, ok, no); if (p && p.then) p.then(ok, no); });
      ambGain = ctx.createGain(); ambGain.gain.value = 0; ambGain.connect(master);
      amb = ctx.createBufferSource(); amb.buffer = buf; amb.loop = true; amb.loopStart = 1.5; amb.loopEnd = buf.duration - 2.5; amb.connect(ambGain); amb.start(0, 1.5);
      ambLevel();
    } catch (e) { console.warn('ambience', e); ambLoading = false; }
  }
  function ambLevel() { if (!ambGain) return; const g = ambGain.gain, t = ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(ambWant ? 0.5 : 0, t + 2.5); }
  function ambience(want) { ambWant = want; if (!ctx) return; if (want && !amb) loadAmb(); else ambLevel(); }
  async function loadBgm() {
    try {
      const data = await (await fetch(BGM_URL)).arrayBuffer();
      const buf = await new Promise((ok, no) => { const p = ctx.decodeAudioData(data, ok, no); if (p && p.then) p.then(ok, no); });
      bgm = ctx.createBufferSource(); bgm.buffer = buf; bgm.loop = true; bgm.loopStart = LOOP_A; bgm.loopEnd = buf.duration - 0.05;
      bgm.connect(mus); bgm.start(0, LOOP_A);
    } catch (e) { console.warn('bgm', e); }
  }
  function unlock() {
    if (ctx) { if (on && ctx.state !== 'running') ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}   // iPhone / iPad:靜音撥桿開著也要有聲音
    ctx = new AC(); ctx.resume();
    master = ctx.createGain(); master.gain.value = on ? 1.4 : 0; master.connect(ctx.destination);
    mus = ctx.createGain(); mus.gain.value = 0.42; mus.connect(master);
    nbuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    { const d = nbuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    { const b = ctx.createBufferSource(); b.buffer = ctx.createBuffer(1, 1, ctx.sampleRate); b.connect(ctx.destination); b.start(0); }   // 在點擊當下播一個無聲的取樣,Safari 才會真的開始出聲
    if (!EMBED) loadBgm();      // 嵌在街機裡時,音樂由外面的房間頁播放(從選單就開始、進遊戲不中斷)
    if (ambWant) loadAmb();      // 遊戲已經開始但那時還沒解鎖音訊:現在補載環境音
  }
  // Safari 只把 click / mouseup / touchend / keydown 當成「使用者操作」,只聽 pointerdown 的話用滑鼠永遠解不開 → 全部都聽
  ['pointerdown', 'pointerup', 'mousedown', 'mouseup', 'touchstart', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, unlock, { capture: true, passive: true }));
  document.addEventListener('visibilitychange', () => { if (!ctx) return; if (document.hidden) ctx.suspend(); else if (on) ctx.resume(); });
  // 每個音效是一小串音:[音高, 幾秒後, 長度, 波形, 音量, 滑到的音高]
  const SEQ = {
    click: [[88, 0, 0.04, 'square', 0.035]],
    hover: [[100, 0, 0.03, 'sine', 0.06, 104]],     // 滑鼠移到按鈕上:很短的一聲「嘀」
    hop: [[69, 0, 0.1, 'sine', 0.26, 76]], hopAi: [[62, 0, 0.1, 'sine', 0.16, 69]],     // 走格子的音:大聲一點
    buy: [[76, 0, 0.08, 'triangle', 0.16], [81, 0.07, 0.12, 'triangle', 0.16]],
    sell: [[88, 0, 0.06, 'square', 0.05], [93, 0.06, 0.06, 'square', 0.05], [100, 0.12, 0.14, 'square', 0.05]],
    short: [[67, 0, 0.2, 'sawtooth', 0.06, 58]],
    coin: [[84, 0, 0.07, 'triangle', 0.14], [91, 0.07, 0.2, 'triangle', 0.14]],
    item: [[83, 0, 0.07, 'triangle', 0.13], [88, 0.07, 0.07, 'triangle', 0.13], [95, 0.14, 0.16, 'triangle', 0.13]],
    good: [[72, 0, 0.1], [76, 0.08, 0.1], [79, 0.16, 0.1], [84, 0.24, 0.3]],
    bad: [[64, 0, 0.18, 'sawtooth', 0.07, 60], [57, 0.18, 0.4, 'sawtooth', 0.07, 50]],
    jail: [[40, 0, 0.5, 'square', 0.1, 36], [47, 0.02, 0.45, 'square', 0.05, 43]],
    bell: [[96, 0, 0.9, 'sine', 0.13], [103, 0, 0.6, 'sine', 0.05], [96, 0.3, 0.9, 'sine', 0.11], [103, 0.3, 0.6, 'sine', 0.04]],
    mission: [[79, 0, 0.08], [84, 0.07, 0.08], [88, 0.14, 0.08], [91, 0.21, 0.08], [96, 0.28, 0.35]],
    liq: [[70, 0, 0.16, 'square', 0.07, 64], [70, 0.2, 0.16, 'square', 0.07, 64], [70, 0.4, 0.3, 'square', 0.07, 60]],
    win: [[72, 0, 0.14], [76, 0.14, 0.14], [79, 0.28, 0.14], [84, 0.42, 0.2], [79, 0.62, 0.12], [84, 0.74, 0.7]],
    lose: [[67, 0, 0.3], [64, 0.3, 0.3], [60, 0.6, 0.8]],
  };
  function sfx(name) {
    if (!ctx || !on || skipRender) return;      // 自動測試快轉時不出聲
    if (ctx.state !== 'running') { ctx.resume(); return; }
    const t = ctx.currentTime;
    if (name === 'dice') { for (let i = 0; i < 9; i++) noise(t + i * 0.1 + Math.random() * 0.04, 0.035, 0.34 - i * 0.016, 2200 + Math.random() * 1200); noise(t + 0.95, 0.12, 0.3, 500); tone(45, t + 0.95, 0.12, 'triangle', 0.18, 40); return; }   // 骰子滾動 + 最後落地一聲
    if (name === 'flip') { noise(t, 0.18, 0.12, 1400); noise(t + 0.08, 0.12, 0.08, 2600); return; }
    if (name === 'jail') noise(t, 0.35, 0.14, 900);
    for (const [m, at, dur, type = 'triangle', vol = 0.15, to = null] of SEQ[name]) tone(m, t + at, dur, type, vol, to);
  }
  function toggle() {
    on = !on; try { localStorage.setItem('css.sound', on ? '1' : '0'); } catch (e) {}
    unlock(); if (ctx) { master.gain.value = on ? 1.4 : 0; if (on) ctx.resume(); }
    if (EMBED) try { parent.postMessage({ type: 'css-sound', on }, location.origin); } catch (e) {}
    return on;
  }
  return { sfx, toggle, ambience, get on() { return on; }, get state() { return ctx ? `${ctx.state} bgm ${bgm ? Math.round(bgm.buffer.duration) : 'loading'}` : 'locked'; } };
})();
// 音效:主機播自己的,同時轉送給手機(手機看到的翻牌、繼續、道具、好壞消息才有聲)。
// 骰子 / 走格子手機自己會播(跟著 dice / hop 訊息),hover 是本機的,不轉送
const NET_SFX_SKIP = new Set(['hover', 'dice', 'hop', 'hopAi']);
const sfx = (name) => { AU.sfx(name); if (!NET_SFX_SKIP.has(name) && !CLIENT && NET.on && NET.started) netSend({ t: 'sfx', name }); };

/* ───────────── 狀態 ───────────── */
let S;
// 買賣、融資、放空 / 回補、股價推動、斷頭 / 軋空、資產計算都在遊戲引擎(engine.mjs),電腦模擬(sim.mjs)也用同一份。
// 這裡只接上畫面需要的副作用:被斷頭 / 軋空時記進公開帳本、排一張說明卡(S.notices,流程走到可以停的地方再顯示)
const ENG = makeEngine(GD, { hooks: {
  onLiquidate: (st, who, x) => { pubNote(who, x.k, true); S.notices.push({ pi: who.i, k: x.k, n: x.n, back: x.back, lost: x.lost }); },
  onSqueeze: (st, who, x) => { pubNote(who, x.k, true); S.notices.push({ pi: who.i, k: x.k, n: x.n, back: x.back, lost: x.lost, squeeze: true }); },
} });
// 電腦「買賣以外」的決定(主攻股、商店、銀行、禮物、擲骰前用道具):和模擬器共用 aiplan.mjs
const AP = makeAiPlan(GD, ENG);
const aiCtx = (A) => ({ lv: AI(), level: S.aiLevel, rand: Math.random, view: (q, k) => pubView(A, q, k) });
const shortValue = (k, who = S) => ENG.shortValue(S, who, k);       // 空單現值:保證金 + 損益,最慘賠光保證金
const squeezeGap = (h, k) => (h.entry * SQUEEZE / S.price[k] - 1) * 100;      // 再漲幾 % 會被軋(30% 就強迫回補)
const acctRatio = (p) => ENG.acctRatio(S, p);                       // 融資維持率看整個帳戶,跌破 130% 斷頭
const assets = () => assetsOf(S.players[S.hi]);
const impact = (k, f) => ENG.impact(S, k, f);                       // 買進推高、賣出和放空壓低,之後檢查斷頭 / 軋空
const fillAt = (k, f) => ENG.fill(S, k, f);                         // 成交價 = 推動之後的價格
const coverBack = (k, h) => ENG.coverBack(S, k, h);
const marginCheck = () => ENG.marginCheck(S);
async function flushNotices() {
  while (S.notices.length) {
    const x = S.notices.shift(), sec = SECTORS[x.k], who = nameOf(S.players[x.pi]); x.isMe = isYou(S.players[x.pi]);
    drawAll(); hud(); sfx('liq');
    if (x.squeeze) {
      await cardPanel(x.isMe ? L('Short squeeze: you were forced to cover', '軋空:你被強迫回補') : L(`${who} got squeezed`, `${who}被軋空了`),
        x.isMe
          ? L(`${sec.name} rose more than 30% above where you shorted it. Your ${x.n} shares were bought back at the high price. You got back $${fmt(x.back)} of your deposit and lost $${fmt(x.lost)}. A short loses when the price rises, and there is no limit to how high a price can go.`,
              `${sec.name}比你放空時漲了超過 30%,${x.n} 股被迫用高價買回來還。保證金只拿回 $${fmt(x.back)},賠掉 $${fmt(x.lost)}。放空是漲了就賠,而股價能漲多高沒有上限。`)
          : L(`${who} shorted ${sec.name} and the price rose more than 30%. It had to buy back ${x.n} shares, losing $${fmt(x.lost)}. That forced buying pushes the price up even more.`,
              `${who}放空的${sec.name}漲了超過 30%,被迫買回 ${x.n} 股,賠掉 $${fmt(x.lost)}。這波被迫的買盤又把股價往上推。`),
        `<span class="mv up">${sec.name} ${pct(buyF(x.n))}</span>`);
      continue;
    }
    await cardPanel(x.isMe ? L('Margin call: you were liquidated', '強迫平倉:你被斷頭了') : L(`${who} was force-liquidated`, `${who}被強迫平倉`),
      x.isMe
        ? L(`${sec.name} fell until your margin ratio dropped below 130%. Your ${x.n} shares were sold to repay the loan. You got back $${fmt(x.back)} and lost $${fmt(x.lost)}. Borrowing to buy means being forced to sell at the worst moment.`,
            `${sec.name}下跌,你的融資維持率跌破 130%。${x.n} 股被全部賣掉還款,只拿回 $${fmt(x.back)},賠掉 $${fmt(x.lost)}。借錢買股票,跌的時候會被迫賣在最低點。`)
        : L(`${who} bought ${sec.name} on margin and its ratio fell below 130%. Its ${x.n} shares were dumped, losing $${fmt(x.lost)}. The forced selling pushes the price down even more.`,
            `${who}用融資買的${sec.name}維持率跌破 130%,${x.n} 股被迫全部賣出,賠掉 $${fmt(x.lost)}。這波賣壓又把股價往下壓。`),
      `<span class="mv dn">${sec.name} ${pct(sellF(x.n))}</span>`);
  }
}
// 買越多推越高、賣越多壓越低:每股 0.4%(買 10 股 +4%、買 30 股 +12%),賣出每股 0.3%、最多 -15%。
// 所以先買的人買得便宜,下一個人要用更貴的價格買
const pct = (f) => `${f >= 1 ? '+' : ''}${Math.round((f - 1) * 100)}%`;
const aiAssets = () => assetsOf(S.ai);
const stockValue = () => KEYS.reduce((a, k) => a + S.hold[k].n * S.price[k], 0);
// 任務:同時有 3 個。完成一個領 $500 獎金並換一個新的,一路玩到回合用完;結算依完成數給星星。
// 每個任務在「抽出來的當下」才決定目標(例如資產成長的門檻跟著你現在的資產走),所以可以重複抽到
const REWARD = 500;
const heldCount = () => KEYS.filter((k) => S.hold[k].n > 0).length;
// 記下這位玩家用過哪幾「種」道具(道具達人成就用);事件卡全部算一種
const usedBy = (p, id) => { const kind = id.startsWith('ev') ? 'ev' : id; (p.used ||= []); if (!p.used.includes(kind)) p.used.push(kind); };
const usedItem = (id) => usedBy(S.players[S.hi], id);
const MISSION_DEFS = [
  // 階梯式成就(chain):同一系列用等級 Lv.1、Lv.2… 表示,已完成分頁只顯示做到的最高等級
  // 分散投資三階:3 → 5 → 7 種
  ...[[3, null], [5, 'spread'], [7, 'spread5']].map(([need, after], i) => ({ id: i ? 'spread' + need : 'spread', after, chain: 'spread', lv: i + 1,
    make: () => ({ title: `${L('Spread it out', '分散投資')} Lv.${i + 1}`, sub: L(`Hold ${need} different assets at once`, `同時持有 ${need} 種不同資產`), ok: () => heldCount() >= need }) })),
  { id: 'paid', make: () => { S.lastDividend = 0;
      return { title: L('Get paid to wait', '領到股利'), sub: L('Collect $100+ in dividends in one round', '一回合領到 $100 以上股利'), ok: () => S.lastDividend >= 100 }; } },
  { id: 'dip', make: () => { S.flags.dip = false;
      return { title: L('Buy the dip', '逢低買進'), sub: L('Buy an asset trading below its opening price', '買進一檔低於開盤價的資產'), ok: () => S.flags.dip }; } },
  { id: 'profit', make: () => { S.flags.profit = false;
      return { title: L('Take profit', '獲利了結'), sub: L('Sell a holding that is up 15% or more', '賣出一檔賺超過 15% 的持股'), ok: () => S.flags.profit }; } },
  { id: 'cash', make: () => { S.cashStreak = 0;
      return { title: L('Keep dry powder', '保留現金'), sub: L('Own assets and keep $2,000+ cash for 3 turns', '持有資產且連續 3 回合現金 $2,000 以上'), ok: () => S.cashStreak >= 3 }; } },
  // 資產成長是階梯式的成就:11,000 → 15,000 → 20,000 → 30,000 → 40,000 → 50,000 → 100,000,上一階完成了下一階才會出現
  ...[11000, 15000, 20000, 30000, 40000, 50000, 100000].map((goal, i, arr) => ({ id: 'g' + goal / 1000, after: i ? 'g' + arr[i - 1] / 1000 : null, chain: goal >= 100000 ? null : 'grow', lv: i + 1,
    make: () => ({ title: goal >= 100000 ? L('Stock god', '股神') : `${L('Grow the pile', '資產成長')} Lv.${i + 1}`, sub: goal >= 100000 ? L('Total assets 10× your starting cash ($100,000)', '總資產達到起始資金 10 倍($100,000)') : L(`Reach $${fmt(goal)} in total assets`, `總資產達到 $${fmt(goal)}`), ok: () => assets() >= goal }) })),
  { id: 'coin2x', make: () => ({ title: L('Crypto whale', '炒幣達人'), sub: L('Be up 100%+ on ParrotCoin', '鸚鵡幣(加密貨幣)未實現獲利超過 100%'),
      ok: () => { const h = S.hold.crypto; return h.n > 0 && h.cost > 0 && (h.n * S.price.crypto - h.cost) / h.cost >= 1; } }) },
  { id: 'shortWin', make: () => ({ title: L('Short seller', '空軍總司令'), sub: L('Cover a short with 20%+ profit', '放空後回補,獲利 20% 以上'), ok: () => S.flags.shortWin }) },
  { id: 'marginWin', make: () => ({ title: L('Leverage pro', '借力使力'), sub: L('Sell a margin position at a profit', '融資買的股票獲利賣出(沒被斷頭)'), ok: () => S.flags.marginWin }) },
  // 股息大戶兩階:累積領到 $1,000 → $3,000
  ...[[1000, null], [3000, 'div1k']].map(([goal, after], i) => ({ id: goal === 1000 ? 'div1k' : 'div3k', after, chain: 'div', lv: i + 1,
    make: () => ({ title: `${L('Dividend king', '股息大戶')} Lv.${i + 1}`, sub: L(`Collect $${fmt(goal)} in dividends over the game`, `整局累積領到 $${fmt(goal)} 股利`), ok: () => (S.players[S.hi].divTotal || 0) >= goal }) })),
  { id: 'dodge', make: () => ({ title: L('Storm proof', '躲過黑天鵝'), sub: L('Your holdings gain value during a market crash', '壞消息事件發生時,你的持股市值反而上漲'), ok: () => S.flags.dodge }) },
  { id: 'comeback', make: () => ({ title: L('Comeback', '逆風翻盤'), sub: L('Fall below $8,000, then climb back to $12,000', '總資產跌破 $8,000 後再回到 $12,000'), ok: () => S.flags.low && assets() >= 12000 }) },
  { id: 'steel', make: () => ({ title: L('Diamond hands', '鑽石手'), sub: L('Keep holding a stock that is down 50%', '一檔持股跌了 50% 還抱著'),
      ok: () => KEYS.some((k) => { const h = S.hold[k]; return h.n > 0 && h.cost > 0 && (h.n * S.price[k] - h.cost) / h.cost <= -0.5; }) }) },
  { id: 'liquidator', make: () => ({ title: L('Margin call', '斷頭高手'), sub: L('Push a price down until a rival\'s margin position is liquidated', '把股價打到讓對手的融資部位被強迫平倉'), ok: () => S.flags.liquidator }) },
  { id: 'squeezer', make: () => ({ title: L('Squeeze master', '軋空高手'), sub: L('Push the price up until a rival\'s short is squeezed', '把股價拉到讓對手的空單被軋空'), ok: () => S.flags.squeezer }) },
  // 抱住股票也是階梯:一檔持股未實現獲利 300% → 500% → 800% → 1000%
  ...[3, 5, 8, 10].map((x, i, arr) => ({ id: 'hold' + x + 'x', after: i ? 'hold' + arr[i - 1] + 'x' : null, chain: 'hold', lv: i + 1,
    make: () => ({ title: `${L('Hold tight', '抱住股票')} Lv.${i + 1}`, sub: L(`Hold one stock until it is up ${x * 100}%`, `一檔持股未實現獲利達 ${x * 100}%`),
      ok: () => KEYS.some((k) => { const h = S.hold[k]; return h.n > 0 && h.cost > 0 && (h.n * S.price[k] - h.cost) / h.cost >= x; }) }) })),
  // 道具達人:用過 3 種不同的道具(遙控骰子、利空卡、偵查報告、三顆骰子、事件卡,事件卡不管哪張都算同一種)
  { id: 'items3', make: () => ({ title: L('Item master', '道具達人'), sub: L('Use 3 different kinds of items (remote dice, bad news, spy report, third die, event card)', '使用 3 種不同的道具(遙控骰子、利空卡、偵查報告、三顆骰子、事件卡)'),
      ok: () => (S.players[S.hi].used || []).length >= 3 }) },
  { id: 'haven', make: () => ({ title: L('Find a safe haven', '準備避險'), sub: L('Hold gold or bonds', '持有黃金或債券'), ok: () => S.hold.gold.n > 0 || S.hold.bond.n > 0 }) },
  { id: 'index', make: () => ({ title: L('Own the market', '買下整個市場'), sub: L('Hold the whole-market ETF', '持有大盤 ETF'), ok: () => S.hold.etf.n > 0 }) },
  { id: 'income', make: () => ({ title: L('Build income', '打造現金流'), sub: L('Hold 2 assets that pay 3% or more', '持有 2 種配息 3% 以上的資產'), ok: () => KEYS.filter((k) => S.hold[k].n > 0 && S.div[k] >= 0.03).length >= 2 }) },
];
// 任務是成就:每種只能完成一次,全部一次列出來;階梯式的(資產成長、抱住股票)只列出下一階,完成了再補下一階
const MISSION_BY_ID = Object.fromEntries(MISSION_DEFS.map((d) => [d.id, d]));
function refillMissions(p) {
  p.missions = p.missions || []; const doneIds = new Set(p.doneIds || []), have = new Set(p.missions.map((m) => m.id));
  for (const d of MISSION_DEFS) if (!doneIds.has(d.id) && !have.has(d.id) && (!d.after || doneIds.has(d.after))) p.missions.push({ id: d.id, done: false, ...d.make() });
}
// 玩家:最多 4 位(真人最多 2 位,排在最前面;其餘是電腦)。每位都有自己的位置、現金、持股、背包……
// 為了不用把整份程式都改寫,S 上面留著「目前視角」的捷徑:
//   S.cash / S.hold / S.bag / S.missions …… → 現在輪到的那位真人(S.hi)
//   S.ai                                    → 現在在走的那位電腦(S.ci)
let CFG = (() => { try { const c = JSON.parse(localStorage.getItem('css.players')); if (c && c.n >= 2 && c.n <= 4) { c.humans = 1; return c; } } catch (e) {} return { n: 2, humans: 1 }; })();
const P_FIELDS = ['pos', 'lane', 'cash', 'debt', 'bag', 'hold', 'short', 'diceN', 'lastDividend', 'cashStreak', 'flags', 'missions', 'done', 'salary2'];   // salary2:升職加薪,每位玩家各自的
const mkPlayer = (i, human, char) => ({ i, human, char, pos: 0, lane: null, cash: START_CASH, debt: 0, bag: human ? ['remote'] : [],
  hold: Object.fromEntries(KEYS.map((k) => [k, { n: 0, cost: 0, loan: 0, locked: 0, lockUntil: 0 }])), short: Object.fromEntries(KEYS.map((k) => [k, { n: 0, entry: 0 }])),
  diceN: 2, lastDividend: 0, cashStreak: 0, flags: { dip: false, profit: false, shortWin: false, marginWin: false, dodge: false, low: false, squeezer: false, liquidator: false }, divTotal: 0, missions: [], done: 0, spy: null });
const others = (i = S.hi) => S.players.filter((p) => p.i !== i);
const nameOf = (p) => p.name || CHARS[p.char].name;      // 真人可以在選角時取名字;沒取就用角色名
const isYou = (p) => p.human && S.nh === 1;                 // 只有一位真人時才用「你」稱呼;兩位真人一律叫角色名字
const assetsOf = (p) => ENG.assetsOf(S, p);
function setPlayers(chars, humans, names = []) {
  S.players = chars.map((c, i) => mkPlayer(i, i < humans, c)); names.forEach((nm, i) => { if (nm && S.players[i]) S.players[i].name = nm; }); S.nh = humans; S.hi = 0; S.ci = Math.min(humans, chars.length - 1);
  for (let h = 0; h < S.players.length; h++) { S.hi = h; refillMissions(S.players[h]); }      // 電腦也有成就。make() 會讀 S.hold 等捷徑,所以要先把 S.hi 指到那位
  S.hi = 0;
}
function newState() {
  S = {
    rolls: 0, busy: false, over: false, maxRounds: MAX_ROLLS, aiLevel: 'normal', players: [], nh: 1, hi: 0, ci: 1, turn: 0, view: null,      // turn:現在輪到誰;view:資產框手動選看誰(null = 跟著 turn)
    price: Object.fromEntries(KEYS.map((k) => [k, SECTORS[k].open])),
    trend: MARKET_DRIFT,                                                     // 大盤趨勢(每回合),事件卡會改
    div: Object.fromEntries(KEYS.map((k) => [k, SECTORS[k].div])),        // 這一局目前的殖利率(事件卡「調高股利」會改)
    notices: [], lastEvent: null, after: null,
    lanePath: { jail: ENG.genLanePath('jail', Math.random), ipo: ENG.genLanePath('ipo', Math.random) },      // 兩條小路現在各格是什麼
  };
  for (const f of P_FIELDS) Object.defineProperty(S, f, { get: () => S.players[S.hi][f], set: (v) => { S.players[S.hi][f] = v; } });
  Object.defineProperty(S, 'ai', { get: () => S.players[S.ci] });
  Object.defineProperty(S, 'me', { get: () => S.players[S.hi].char });
  Object.defineProperty(S, 'foe', { get: () => S.players[S.ci].char });
  setPlayers(['cat', 'bear'], 1);       // 先放兩位佔位,選完角色後 start() 會換成真正的名單
}

/* ───────────── Three.js 場景 ───────────── */
const renderer = new THREE.WebGLRenderer({ canvas: $('gl'), antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const outline = new OutlineEffect(renderer, { defaultThickness: 0.006, defaultColor: [0.36, 0.25, 0.2], defaultAlpha: 1 });
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9bdc7a);

const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
// 棋盤很大,鏡頭平常拉近跟著「現在在走的那顆棋子」;按地圖鈕可以拉遠看全貌
const CAM_OFF = new THREE.Vector3(12, 11, 12), camT = new THREE.Vector3(0, 0.2, 0);
cam.position.copy(camT).add(CAM_OFF);
cam.lookAt(camT);
const view = { half: 5, near: 5, far: 16, overview: false, aspect: 1 };
function applyFrustum() {
  const h = view.half, a = view.aspect;
  cam.left = -h * a; cam.right = h * a; cam.top = h * 0.92; cam.bottom = -h * 1.08;
  cam.updateProjectionMatrix();
}
function resize() {
  const w = innerWidth, h = innerHeight, a = w / h;
  // 文字大小跟著螢幕走:以短邊 640 為基準,手機維持 1 倍,iPad 約 1.2~1.3 倍,最大 1.4 倍
  document.documentElement.style.setProperty('--fs', Math.max(1, Math.min(1.4, Math.min(w, h) / 640)).toFixed(3));
  renderer.setSize(w, h, false);
  // 棋盤在等軸測下大約寬 9、高 6;兩個方向都要塞得下,下方再留一點給按鈕
  view.aspect = a;
  view.near = Math.max(4.6, (a < 0.8 ? 3.8 : 5.6) / a);   // 直拿的手機:預設鏡頭拉近一點(寬度只放 3.8 格的一半),不然太遠;想看全圖再用雙指縮小
  view.far = Math.max(8.6, (N * 1.14 + 1) * 0.74 / a);
  view.stageHalf = Math.max(2.3, 2.9 / a);          // 選角舞台:中間一個 + 左右各一個要放得下
  if (!view.half0) { view.half0 = true; view.half = view.near; }
  applyFrustum();
}
addEventListener('resize', resize);

scene.add(new THREE.HemisphereLight(0xffffff, 0xffe9c9, 1.15));
const sun = new THREE.DirectionalLight(0xfff2dd, 1.7);
const SUN_OFF = new THREE.Vector3(-7, 14, 6); sun.position.copy(SUN_OFF); scene.add(sun.target);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.03;
scene.add(sun);

const STEP = 1.14, TOP = 0.40;
// 卡通渲染:光影不是連續漸層,而是切成三階色塊(gradientMap),再由 OutlineEffect 補上描邊
const toonRamp = (() => {
  const t = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true; return t;
})();
const mat = (c, o = {}) => { const { roughness, metalness, ...rest } = o; return new THREE.MeshToonMaterial({ color: c, gradientMap: toonRamp, ...rest }); };
function box(w, h, d, color, x, y, z, r = 0.06, parent = scene) {
  const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 3, Math.min(r, h / 2 - 0.001)), mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m;
}
// 地面、人行道、草地
{
  const g = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), mat(0x9bdc7a)); g.material.userData.outlineParameters = { visible: false }; g.rotation.x = -Math.PI / 2; g.receiveShadow = true; scene.add(g);
  // 格子直接放在草地上(以前底下有一塊米色人行道板);整片草地都是同一個深綠(以前只有內圈是),中間微微墊高
  box((N - 2) * STEP - 0.12, 0.16, (N - 2) * STEP - 0.12, 0x9bdc7a, 0, 0.10, 0, 0.05);
}
// 小鎮裝飾:樹和房子(純幾何)
// 樹冠另外掛在一個以樹根為軸心的群組裡,每一幀依風(SWAY)微微搖晃
const SWAY = [];
function tree(x, z, s = 1, parent = scene) {
  if (parent === scene && nearBldg(x, z)) return;
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(s); parent.add(g);
  const t = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, 0.45, 8), mat(0x9a6b4a)); t.position.y = 0.22; t.castShadow = true; g.add(t);
  const crown = new THREE.Group(); g.add(crown);
  [[0.48, 0.62, 0.7], [0.38, 0.52, 1.05], [0.26, 0.42, 1.36]].forEach(([r, h, y], i) => {
    const c = new THREE.Mesh(new THREE.ConeGeometry(r, h, 8), mat(i % 2 ? 0x5fb87a : 0x4fa86c)); c.position.y = y; c.castShadow = true; crown.add(c);
  });
  SWAY.push({ crown, phase: x * 0.7 + z * 1.3, amp: 0.045 + Math.random() * 0.025, speed: 0.9 + Math.random() * 0.4 });
  return g;
}
// 池塘波紋:每條弧線的半徑慢慢變大(從中心往外擴),越靠岸越亮、到岸邊(半徑 1)前淡掉;生命結束就換個角度重來
const RIPPLES = []; let POND_TEX = null;
function rippleStep(dt) {
  if (POND_TEX) POND_TEX.rotation += dt * 0.08;      // 亮斑慢慢繞著轉
  for (const r of RIPPLES) { r.t += dt; if (r.t >= r.dur) { r.ang = Math.random() * Math.PI * 2; r.r0 = 0.3 + Math.random() * 0.55; r.grow = 0.1 + Math.random() * 0.12; r.dur = 3.5 + Math.random() * 3; r.t = 0; r.m.rotation.y = -r.ang; }
    const k = r.t / r.dur, rad = r.r0 + r.grow * k;
    r.m.scale.set(rad, 1, rad);
    const edge = Math.min(1, rad / 0.98), fadeOut = rad > 0.97 ? Math.max(0, (1 - rad) / 0.03) : 1;   // 越靠岸越亮;碰到岸邊收掉
    r.m.material.opacity = Math.sin(k * Math.PI) * (0.25 + 0.7 * edge * edge) * fadeOut;
    r.m.material.color.setRGB(0.85 + 0.15 * edge, 0.92 + 0.08 * edge, 1); }
}
// 風:所有樹冠一起慢慢搖,各自錯開相位;偶爾來一陣比較大的風
function windStep() {
  const gust = 1 + Math.max(0, Math.sin(T * 0.23)) * 0.9;
  for (const w of SWAY) { const a = w.amp * gust, t = T * w.speed + w.phase;
    w.crown.rotation.z = Math.sin(t) * a + Math.sin(t * 2.3 + 1) * a * 0.35;
    w.crown.rotation.x = Math.cos(t * 0.8 + 2) * a * 0.6; }
}
function house(x, z, wall, roof, ry = 0) {
  if (nearBldg(x, z, 2.2)) return;
  const g = new THREE.Group(); g.position.set(x, 0, z); g.rotation.y = ry; scene.add(g);
  box(1.5, 0.95, 1.2, wall, 0, 0.48, 0, 0.05, g);
  const r = new THREE.Mesh(new THREE.ConeGeometry(1.18, 0.62, 4), mat(roof)); r.position.y = 1.26; r.rotation.y = Math.PI / 4; r.scale.set(1, 1, 0.82); r.castShadow = true; g.add(r);
  box(0.3, 0.46, 0.05, 0x9a6b4a, 0.3, 0.24, 0.61, 0.02, g);
  box(0.34, 0.3, 0.05, 0xbfe6ff, -0.35, 0.55, 0.61, 0.02, g);
}
function lamp(x, z) {
  const g = new THREE.Group(); g.position.set(x, 0, z); scene.add(g);
  const p = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.1, 8), mat(0x4a5568)); p.position.y = 0.55; p.castShadow = true; g.add(p);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 10), new THREE.MeshStandardMaterial({ color: 0xfff2b8, emissive: 0xffd76a, emissiveIntensity: 0.9 })); b.position.y = 1.18; g.add(b);
  box(0.2, 0.05, 0.2, 0x4a5568, 0, 1.34, 0, 0.02, g);
}
function fence(x, z, len, alongX) {
  if (nearBldg(x, z, 2.2)) return;
  for (let i = 0; i < len; i++) { const o = (i - (len - 1) / 2) * 0.42;
    box(alongX ? 0.36 : 0.08, 0.34, alongX ? 0.08 : 0.36, 0xd9a86c, x + (alongX ? o : 0), 0.2, z + (alongX ? 0 : o), 0.02); }
}
const E = N / 2 * STEP + 0.62;
// 角落的建築:商店、銀行格的對角線往外一點(第 18 / 36 / 54 格;起點那個角靠鏡頭,不放)。外圍的樹、房子、籬笆、花和路燈都避開這些位置
const BLDG = (() => { const H = (N - 1) / 2 * STEP + 1.85;
  return [[1, -1, 1], [2, -1, -1], [3, 1, -1]].map(([k, sx, sz]) => ({ type: TILES[k * (N - 1)], x: sx * H, z: sz * H })).filter((b) => b.type === 'shop' || b.type === 'bank'); })();
const nearBldg = (x, z, r = 1.9) => BLDG.some((b) => Math.hypot(b.x - x, b.z - z) < r);
[[-E, -E], [E, -E], [-E, E]].filter(([x, z]) => !nearBldg(x, z, 2.6)).forEach(([x, z]) => lamp(x, z));   // 最靠鏡頭的那個角不放,會擋到起點
// 外圍:只在「鏡頭對面」的兩側放樹和房子,靠鏡頭這兩側放了會擋到格子
{
  const walls = [0xfff1dc, 0xffe6ee, 0xeef4ff, 0xfdf6e3], roofs = [0x6fb7c9, 0xf2a35e, 0xe2726b, 0xd9b24a, 0x8fbf6a];
  let k = 0;
  for (let t = -E; t <= E; t += 2.3) {
    const far = E + 1.7 + (k % 3) * 0.7;
    if (k % 4 === 1) { house(-far - 0.8, t, walls[k % 4], roofs[k % 5], Math.PI / 2 + 0.1); house(t, -far - 0.8, walls[(k + 2) % 4], roofs[(k + 3) % 5], 0.1); }
    else { tree(-far, t, 1 + (k % 3) * 0.15); tree(t, -far, 1 + ((k + 1) % 3) * 0.15); }
    if (k % 2 === 0) { fence(-E - 0.5, t, 3, false); fence(t, -E - 0.5, 3, true); }
    k++;
  }
  // 靠鏡頭的兩側(畫面右下、左下)也放,但要離外圈遠一點(至少 2.4 格外),樹和房子的高度才不會從鏡頭方向遮到格子
  k = 1;
  for (let t = -E + 1.1; t <= E - 0.4; t += 2.3) {
    const near = E + 2.4 + (k % 3) * 0.6;
    if (k % 4 === 2) { house(near + 0.8, t, walls[(k + 1) % 4], roofs[(k + 2) % 5], -Math.PI / 2 - 0.1); house(t, near + 0.8, walls[(k + 3) % 4], roofs[(k + 4) % 5], Math.PI + 0.1); }
    else { tree(near, t, 1 + ((k + 2) % 3) * 0.15); tree(t, near, 1 + (k % 3) * 0.15); }
    if (k % 2 === 1) { fence(E + 0.5, t, 3, false); fence(t, E + 0.5, 3, true); }
    k++;
  }
}
// 角落的商店、銀行建築:和警察局同一種做法(方塊 + 面向鏡頭的招牌)。整棟轉向棋盤中心,招牌另外轉回 45 度正對鏡頭
function signBoard(parent, zh, en, bg, y, w = 1.5) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; const c = cv.getContext('2d');
  c.fillStyle = bg; c.beginPath(); c.roundRect(0, 0, 512, 160, 26); c.fill();
  c.strokeStyle = '#fff'; c.lineWidth = 8; c.beginPath(); c.roundRect(8, 8, 496, 144, 20); c.stroke();
  c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.font = '900 76px "PingFang TC","Noto Sans TC","Helvetica Neue",Arial,sans-serif'; c.fillText(ZH ? zh : en, 256, ZH ? 64 : 84);
  if (ZH) { c.font = '900 34px "Helvetica Neue",Arial,sans-serif'; c.fillText(en, 256, 124); }
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 0.3125), Object.assign(new THREE.MeshBasicMaterial({ map: tex, transparent: true }), { userData: { outlineParameters: { visible: false } } }));
  sign.position.set(0, y, 0); sign.rotation.y = Math.PI / 4 - parent.rotation.y; parent.add(sign);
  return sign;
}
for (const b of BLDG) {
  const g = new THREE.Group(); g.position.set(b.x, 0, b.z); g.rotation.y = Math.atan2(-b.x, -b.z); scene.add(g);   // 正面(+z)朝棋盤中心
  if (b.type === 'shop') {
    // 商店:白色店面、藍色腰帶和屋頂、藍白條紋遮雨棚、大櫥窗和門
    box(1.64, 0.18, 1.24, 0x5aa9ff, 0, 0.09, 0, 0.03, g);
    box(1.6, 0.92, 1.2, 0xfff8ec, 0, 0.6, 0, 0.05, g);
    box(1.72, 0.12, 1.32, 0x3d86d6, 0, 1.1, 0, 0.04, g);
    for (let i = 0; i < 5; i++) box(0.32, 0.08, 0.34, i % 2 ? 0xffffff : 0x5aa9ff, -0.64 + i * 0.32, 0.92, 0.74, 0.02, g);
    box(0.86, 0.4, 0.03, 0xbfe6ff, -0.28, 0.55, 0.61, 0.02, g);
    box(0.3, 0.56, 0.04, 0x9a6b4a, 0.5, 0.36, 0.61, 0.02, g);
    signBoard(g, '商店', 'SHOP', '#3d86d6', 1.6);
  } else {
    // 銀行:兩層台階、白色主體、前面四根柱子、深藍色橫樑和三角屋頂
    box(1.9, 0.12, 1.5, 0xe9e2d0, 0, 0.06, 0, 0.03, g);
    box(1.76, 0.12, 1.36, 0xf3eee2, 0, 0.18, 0, 0.03, g);
    box(1.5, 0.84, 1.0, 0xfff8ec, 0, 0.66, -0.06, 0.05, g);
    for (const cx of [-0.54, -0.18, 0.18, 0.54]) { const c = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 0.84, 12), mat(0xffffff)); c.position.set(cx, 0.66, 0.56); c.castShadow = true; g.add(c); }
    box(1.66, 0.14, 1.32, 0x4a63b0, 0, 1.14, 0, 0.04, g);
    const roof = new THREE.Mesh(new THREE.ConeGeometry(1.12, 0.46, 4), mat(0x4a63b0)); roof.position.y = 1.44; roof.rotation.y = Math.PI / 4; roof.scale.set(1, 1, 0.78); roof.castShadow = true; g.add(roof);
    box(0.32, 0.5, 0.04, 0x33415c, 0, 0.49, 0.45, 0.02, g);
    signBoard(g, '銀行', 'BANK', '#4a63b0', 1.95);
  }
}
// 中間的大草地:一個小公園(池塘、樹、房子、花)。樹和房子都避開兩條小路(z=4 那排和 z=12 那排)和兩棟建築
{
  const pond = new THREE.Mesh(new THREE.CylinderGeometry(1.85, 1.85, 0.06, 40), mat(0x8fd3ff)); pond.position.set(-0.8, 0.2, 0.6); pond.scale.z = 0.7; pond.material.userData.outlineParameters = { visible: false }; scene.add(pond);
  // 水面:中間深、邊邊淺的放射漸層(畫在 canvas 上),再加一塊偏一邊的亮斑慢慢轉,看起來像水在動
  { const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    // 外圈(0.86 以後)慢慢透明:水直接融進草地,沒有硬邊也沒有米色岸
    const g = c.createRadialGradient(128, 128, 10, 128, 128, 128); g.addColorStop(0, '#3d93d6'); g.addColorStop(0.5, '#62b4ea'); g.addColorStop(0.78, '#9ad8fb'); g.addColorStop(0.86, 'rgba(198,236,255,1)'); g.addColorStop(1, 'rgba(198,236,255,0)');
    c.fillStyle = g; c.fillRect(0, 0, 256, 256);
    const h = c.createRadialGradient(170, 96, 4, 170, 96, 90); h.addColorStop(0, 'rgba(255,255,255,.22)'); h.addColorStop(1, 'rgba(255,255,255,0)'); c.fillStyle = h; c.fillRect(0, 0, 256, 256);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.center.set(0.5, 0.5);
    const wmat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }); wmat.userData.outlineParameters = { visible: false };
    const top = new THREE.Mesh(new THREE.CircleGeometry(2.2, 48), wmat); top.rotation.x = -Math.PI / 2; top.position.set(-0.8, 0.232, 0.6); top.scale.y = 0.7; top.renderOrder = 1; scene.add(top);
    POND_TEX = tex; }
  // 水面的波紋:順著池塘形狀的弧線,從中心往外擴散、越靠岸越亮,到岸邊淡掉(像真的水被風吹)。
  // 每條是一段「沿橢圓的緞帶」:在單位圓上建一段弧,放進一個縮放成橢圓的群組裡,每一幀改半徑就是往外擴
  { const grp = new THREE.Group(); grp.position.set(-0.8, 0.236, 0.6); grp.scale.set(1.9, 1, 1.33); scene.add(grp);
    const fade = (() => { const cv = document.createElement('canvas'); cv.width = 256; cv.height = 4; const c = cv.getContext('2d');
      const g = c.createLinearGradient(0, 0, 256, 0); g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.25, '#fff'); g.addColorStop(0.75, '#fff'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, 256, 4); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; })();
    const arcGeo = (span, width, wob) => {   // 單位圓上、角度跨 span 的一段弧;半徑帶一點正弦擺動,線才不會太規則
      const N = 28, pos = [], uv = [], idx = [];
      for (let k = 0; k <= N; k++) { const t = k / N, a = -span / 2 + t * span, r = 1 + Math.sin(t * Math.PI * 2 * wob) * 0.012;
        const w = width * (0.6 + 0.4 * Math.sin(t * Math.PI));
        pos.push(Math.cos(a) * (r - w), 0, Math.sin(a) * (r - w), Math.cos(a) * (r + w), 0, Math.sin(a) * (r + w)); uv.push(t, 0, t, 1);
        if (k < N) { const b = k * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); } }
      const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); return g; };
    const reset = (r) => { r.ang = Math.random() * Math.PI * 2; r.r0 = 0.3 + Math.random() * 0.55; r.grow = 0.1 + Math.random() * 0.12; r.dur = 3.5 + Math.random() * 3; r.t = 0;
      r.m.geometry.dispose(); r.m.geometry = arcGeo(0.5 + Math.random() * 1.1, 0.012 + Math.random() * 0.008, 1 + Math.random() * 2); r.m.rotation.y = -r.ang; };
    for (let i = 0; i < 16; i++) { const mt = new THREE.MeshBasicMaterial({ color: 0xffffff, map: fade, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide }); mt.userData.outlineParameters = { visible: false };
      const m = new THREE.Mesh(new THREE.BufferGeometry(), mt); m.renderOrder = 2; grp.add(m); const r = { m }; reset(r); r.t = Math.random() * r.dur; RIPPLES.push(r); } }
  [[-3.4, -2.6, 1.2], [-2.2, -2.2, 1], [2.6, -3.2, 1.3], [3.6, -1.4, 1], [3.2, 2.6, 1.1], [-3.8, 2.4, 1.1], [2.4, 2.2, 1], [-2.6, 3.0, 1.2], [3.0, -2.4, 1.1]].forEach(([x, z, sc]) => tree(x, z, sc));
  house(1.9, -0.9, 0xfff1dc, 0xe2726b, 0.4);
  lamp(0.6, 2.2); lamp(-2.4, 1.9);
}
// 花很多(幾百朵),每朵各自一個 Mesh 的話一幀要多畫上千次 → 用 InstancedMesh 併成兩次繪製,而且不描邊
function flowers(n, outer = false) {
  const cols = [0xffffff, 0xffd24a, 0xff9ec4, 0xffffff].map((c) => new THREE.Color(c));
  const R = (N - 2) * STEP - 0.8, pts = [];
  for (let i = 0; i < n; i++) {
    let x, z;
    if (outer) {      // 外圈草地:人行道外 0.8~4 格的帶狀區域,避開選角舞台
      const side = Math.floor(Math.random() * 4), t = (Math.random() - 0.5) * 2 * (E + 4), d = E + 0.8 + Math.random() * 3.2;
      [x, z] = side === 0 ? [d, t] : side === 1 ? [-d, t] : side === 2 ? [t, d] : [t, -d];
      if (Math.hypot(x - STAGE.x, z - STAGE.z) < 4.5 || nearBldg(x, z, 1.4)) continue;
    } else {
      x = (Math.random() - 0.5) * R; z = (Math.random() - 0.5) * R;
      if (Math.hypot((x + 0.8) / 2.3, (z - 0.6) / 1.7) < 1) continue;   // 不要長在池塘裡
    }
    pts.push([x, z]);
  }
  const noLine = (m) => { m.userData.outlineParameters = { visible: false }; return m; };
  const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), noLine(mat(0xffffff)), pts.length);
  const leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), noLine(mat(0x86c96f)), pts.length);
  const m4 = new THREE.Matrix4();
  pts.forEach(([x, z], i) => {
    petals.setMatrixAt(i, m4.makeTranslation(x, 0.21, z)); petals.setColorAt(i, cols[i % cols.length]);
    leaves.setMatrixAt(i, m4.makeScale(1, 0.5, 1).setPosition(x + 0.05, 0.19, z + 0.03));
  });
  petals.instanceColor.needsUpdate = true;
  scene.add(petals, leaves);
}
flowers(320);

/* ───────────── 棋盤 ───────────── */
// 5x5 外圈,從最靠近鏡頭的角開始逆時針走
const COORD = [];
const M = N - 1;
for (let x = M; x >= 0; x--) COORD.push([x, M]);
for (let z = M - 1; z >= 0; z--) COORD.push([0, z]);
for (let x = 1; x <= M; x++) COORD.push([x, 0]);
for (let z = 1; z <= M - 1; z++) COORD.push([M, z]);
const tilePos = (i) => new THREE.Vector3((COORD[i][0] - M / 2) * STEP, 0, (COORD[i][1] - M / 2) * STEP);

const COIN_GEO = new THREE.CylinderGeometry(0.17, 0.17, 0.065, 20), COIN_MAT = mat(0xffd24a), COIN_MAT2 = mat(0xf5b82e);
const tiles = [];
TILES.forEach((type, i) => {
  const p = tilePos(i), sec = SECTORS[type];
  const g = new THREE.Group(); g.position.copy(p); scene.add(g);
  const special = !sec;
  box(1.04, 0.36, 1.04, sec ? sec.color : TILE_COLOR[type], 0, 0.18, 0, 0.09, g);   // 底座從地面長到 0.36
  box(1.0, 0.10, 1.0, special ? TILE_COLOR[type] : 0xfff8ec, 0, TOP - 0.05, 0, 0.045, g);
  // 標籤:畫在 canvas 上貼在格子頂面,朝鏡頭方向轉 45° 讓字是正的
  const cv = document.createElement('canvas'); cv.width = cv.height = 256;
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const holder = new THREE.Group(); holder.rotation.y = Math.PI / 4; holder.position.y = TOP + 0.004; g.add(holder);
  const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), Object.assign(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), { userData: { outlineParameters: { visible: false } } }));
  lab.rotation.x = -Math.PI / 2; holder.add(lab);
  // 你的持股:格子角落疊金幣,每 10 股一枚(最多 6 枚)。以前是一根方柱加白色頂蓋,從介面後面露出來像破圖
  let bld = null;
  if (sec) {
    bld = new THREE.Group(); bld.position.set(0.36, TOP, -0.36);   // 放在畫面右側那個角,不擋圖示和價格
    bld.visible = false; g.add(bld);
    for (let i = 0; i < 6; i++) {
      const coin = new THREE.Mesh(COIN_GEO, i % 2 ? COIN_MAT2 : COIN_MAT); coin.position.set((i % 2) * 0.02, 0.035 + i * 0.07, (i % 3) * 0.015); coin.castShadow = true; bld.add(coin);
    }
  }
  tiles.push({ type, g, cv, tex, bld, bldH: 0 });
});

// 中間的小路:拘留小路(灰)和 IPO 小路(綠)。格子做法和外圈一樣,標籤是固定的所以只畫一次
const cellPos = (x, z) => new THREE.Vector3((x - M / 2) * STEP, 0, (z - M / 2) * STEP);
const LANE_COLOR = { jail: 0x7b8494, ipo: 0x2fbf9f };
const laneTiles = {};
for (const [type, def] of Object.entries(LANES)) {
  const F = (px) => `900 ${px}px "Avenir Next","PingFang TC","Helvetica Neue",Arial,sans-serif`;
  // 一格小路:底座 + 面板 + 畫在 canvas 上的標籤(轉 45 度正對鏡頭)
  const cellTile = (x, z, base, top, draw) => {
    const g = new THREE.Group(); g.position.copy(cellPos(x, z)); scene.add(g);
    const bm = box(1.04, 0.36, 1.04, base, 0, 0.18, 0, 0.09, g);
    const tm = box(1.0, 0.10, 1.0, top, 0, TOP - 0.05, 0, 0.045, g);
    const cv = document.createElement('canvas'); cv.width = cv.height = 256; const c = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const holder = new THREE.Group(); holder.rotation.y = Math.PI / 4; holder.position.y = TOP + 0.004; g.add(holder);
    const lab = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.98), Object.assign(new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }), { userData: { outlineParameters: { visible: false } } }));
    lab.rotation.x = -Math.PI / 2; holder.add(lab);
    const t = { g, cv, tex, bm, tm, redraw(fn) { c.clearRect(0, 0, 256, 256); c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.globalAlpha = 1; fn(c); tex.needsUpdate = true; } };
    t.redraw(draw); return t;
  };
  const cell = cellTile(def.cell[0], def.cell[1], type === 'jail' ? 0x565e6c : 0x1f9a80, LANE_COLOR[type], (c) => {
    if (type === 'jail') iconTile(c, F, drawPoliceIcon, L('POLICE', '警察局'));
    else iconTile(c, F, drawOfferIcon, L('OFFER', '內部認購'));
  });
  // 小路的 6 格:先做空白格,內容由 drawLane 依 S.lanePath 畫上去(每次重新生成都會重畫)
  const path = def.path.map(([x, z]) => cellTile(x, z, 0x8c95a5, 0xb3bac6, () => {}));
  laneTiles[type] = { cell, path, F };
}
// 把小路每一格畫成現在的種類:空白格寫第幾步,其他格換顏色、寫名稱和效果
function drawLane(type) {
  const lt = laneTiles[type], F = lt.F, blankTop = type === 'jail' ? 0xb3bac6 : 0x7fe3c9, blankBase = type === 'jail' ? 0x8c95a5 : 0x3fcfae;
  S.lanePath[type].forEach((k, i) => {
    const t = lt.path[i], info = PATH_INFO[k];
    t.tm.material.color.setHex(info ? info.color : blankTop); t.bm.material.color.setHex(info ? info.base : blankBase);
    t.redraw((c) => {
      if (!info) { c.globalAlpha = 0.85; c.font = F(110); c.fillText(String(i + 1), 128, 128); return; }
      if (k === 'fate') { c.font = F(96); c.fillText('★', 128, 96); c.font = F(ZH ? 44 : 40); c.fillText(info.b, 128, 196); return; }
      if (k === 'chance') { c.fillStyle = '#b0780a'; c.font = F(120); c.fillText('?', 128, 100); c.font = F(ZH ? 36 : 34); c.fillText(info.b, 128, 196); return; }
      if (k === 'gift') { drawGiftLabel(c, F); return; }
      if (k === 'coin') { drawIconTile(c, F, 'coin', L('CASH', '撿到錢')); return; }
      if (k === 'fee') { drawIconTile(c, F, 'fee', L('FEE', '手續費')); return; }
      if (k === 'interest') { drawInterestIcon(c, F, 128, 96); c.fillStyle = '#fff'; c.font = F(ZH ? 44 : 38); c.fillText(L('INTEREST', '利息'), 128, 212); return; }
      c.font = F(info.a.length > 4 ? 44 : (ZH ? 56 : 48)); c.fillText(info.a, 128, 100);
      c.font = F(ZH ? 34 : 32); c.fillText(info.b, 128, 172);
    });
  });
}
const drawLanes = () => Object.keys(LANES).forEach(drawLane);
// 小路內容變了也要告訴手機(drawLane 本身在上面;這裡包一層廣播)
const _drawLane0 = drawLane;
function drawLaneNet(type) { _drawLane0(type); if (NET.on && NET.started) netSend({ t: 'lane', type, path: S.lanePath[type] }); }
// 小路旁的建築:警察局(拘留小路)和交易所(IPO 小路,白色、金色的鐘)
{
  // 警察局:放在警察局格的後面(離鏡頭更遠的那側,不會擋到格子和小路上的棋子)。藍白色的建築、鐵窗、屋頂的紅藍警示燈,
  // 再立一塊面向鏡頭的招牌寫「警察局 POLICE」,玩家一看就知道被送到哪裡
  const j = new THREE.Group(); j.position.copy(cellPos(7, 2.65));
  scene.add(j);
  box(1.5, 1.0, 1.0, 0xf4f7ff, 0, 0.69, 0, 0.05, j);                                                // 主體(白)
  box(1.54, 0.2, 1.04, 0x2f5fd0, 0, 0.3, 0, 0.03, j);                                               // 底部藍色腰帶
  box(1.62, 0.14, 1.12, 0x2f5fd0, 0, 1.26, 0, 0.04, j);                                             // 屋頂(藍)
  box(0.34, 0.56, 0.04, 0x33415c, 0, 0.47, 0.51, 0.02, j);                                          // 門
  for (const wx of [-0.5, 0.5]) { box(0.3, 0.3, 0.03, 0x9fd0ff, wx, 0.78, 0.51, 0.02, j);           // 兩扇窗 + 鐵窗
    for (let i = -1; i <= 1; i++) box(0.03, 0.3, 0.04, 0x33415c, wx + i * 0.09, 0.78, 0.53, 0.01, j); }
  for (let i = -1; i <= 1; i++) box(0.04, 0.34, 0.05, 0x33415c, 0.76, 0.78, i * 0.14, 0.01, j);     // 側面的鐵窗
  { const red = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color: 0xff4d4d })); red.position.set(-0.14, 1.43, 0); j.add(red);
    const blue = new THREE.Mesh(new THREE.SphereGeometry(0.1, 14, 10), new THREE.MeshBasicMaterial({ color: 0x4d8dff })); blue.position.set(0.14, 1.43, 0); j.add(blue);
    box(0.5, 0.06, 0.2, 0x33415c, 0, 1.35, 0, 0.02, j); }
  { const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160; const c = cv.getContext('2d');
    c.fillStyle = '#2f5fd0'; c.beginPath(); c.roundRect(0, 0, 512, 160, 26); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = 8; c.beginPath(); c.roundRect(8, 8, 496, 144, 20); c.stroke();
    c.fillStyle = '#fff'; c.textAlign = 'center'; c.textBaseline = 'middle';
    c.font = '900 76px "PingFang TC","Noto Sans TC","Helvetica Neue",Arial,sans-serif'; c.fillText(L('POLICE', '警察局'), 256, ZH ? 64 : 84);
    if (ZH) { c.font = '900 34px "Helvetica Neue",Arial,sans-serif'; c.fillText('POLICE', 256, 124); }
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.47), Object.assign(new THREE.MeshBasicMaterial({ map: tex, transparent: true }), { userData: { outlineParameters: { visible: false } } }));
    sign.position.set(0, 1.86, 0); sign.rotation.y = Math.PI / 4; j.add(sign);                      // 招牌轉 45 度,正對鏡頭
    box(0.06, 0.34, 0.06, 0x33415c, -0.3, 1.5, 0.3, 0.01, j); box(0.06, 0.34, 0.06, 0x33415c, 0.3, 1.5, -0.3, 0.01, j); }   // 招牌的兩根支柱
  const x = new THREE.Group(); x.position.copy(cellPos(LANES.ipo.cell[0] - 1.25, LANES.ipo.cell[1])); scene.add(x);   // 內部認購的交易所:攤位格的後面(左側)
  box(1.0, 0.7, 1.0, 0xfff8ec, 0, 0.53, 0, 0.05, x); box(1.14, 0.12, 1.14, 0x2fbf9f, 0, 0.94, 0, 0.04, x);
  for (const sx of [-0.32, 0, 0.32]) box(0.1, 0.5, 0.1, 0xffffff, sx, 0.45, 0.52, 0.03, x);         // 柱子
  box(0.5, 0.3, 0.5, 0xfff8ec, 0, 1.15, 0, 0.04, x);
  const bell = new THREE.Mesh(new THREE.SphereGeometry(0.2, 20, 14), mat(0xffc93c)); bell.position.y = 1.5; bell.castShadow = true; x.add(bell);
}
// 類股圖示:自己用 canvas 畫的簡單圖形(不用任何真實公司的商標)
function icon(c, type, x, y, r, color) {
  c.save(); c.translate(x, y); c.fillStyle = color; c.strokeStyle = color; c.lineWidth = r * 0.16; c.lineJoin = 'round'; c.lineCap = 'round';
  const rr = (X, Y, W, H, R) => { c.beginPath(); c.roundRect(X, Y, W, H, R); };
  if (type === 'soft') { c.lineWidth = r * 0.22; c.beginPath(); c.moveTo(-r * 0.35, -r * 0.6); c.lineTo(-r, 0); c.lineTo(-r * 0.35, r * 0.6); c.moveTo(r * 0.35, -r * 0.6); c.lineTo(r, 0); c.lineTo(r * 0.35, r * 0.6); c.stroke();
    c.beginPath(); c.moveTo(r * 0.18, -r * 0.9); c.lineTo(-r * 0.18, r * 0.9); c.stroke(); }
  else if (type === 'tech') { rr(-r, -r * 0.78, r * 2, r * 1.3, r * 0.18); c.fill(); c.fillRect(-r * 0.14, r * 0.5, r * 0.28, r * 0.3); rr(-r * 0.55, r * 0.74, r * 1.1, r * 0.2, r * 0.1); c.fill();
    c.fillStyle = '#fff'; rr(-r * 0.78, -r * 0.58, r * 1.56, r * 0.9, r * 0.08); c.fill(); }
  else if (type === 'chip') { for (let i = -1; i <= 1; i++) { c.beginPath(); c.moveTo(i * r * 0.45, -r); c.lineTo(i * r * 0.45, r); c.moveTo(-r, i * r * 0.45); c.lineTo(r, i * r * 0.45); c.stroke(); }
    rr(-r * 0.72, -r * 0.72, r * 1.44, r * 1.44, r * 0.2); c.fill(); c.fillStyle = '#fff'; rr(-r * 0.34, -r * 0.34, r * 0.68, r * 0.68, r * 0.1); c.fill(); }
  else if (type === 'agri') { c.lineWidth = r * 0.16; c.beginPath(); c.moveTo(0, r); c.lineTo(0, -r * 0.3); c.stroke();
    for (let i = 0; i < 4; i++) { const y = r * 0.6 - i * r * 0.36; for (const sgn of [-1, 1]) { c.beginPath(); c.ellipse(sgn * r * 0.3, y, r * 0.3, r * 0.16, sgn * 0.6, 0, 7); c.fill(); } }
    c.beginPath(); c.ellipse(0, -r * 0.72, r * 0.18, r * 0.32, 0, 0, 7); c.fill(); }
  else if (type === 'yield') { for (let i = 0; i < 4; i++) { const hgt = r * (0.5 + i * 0.45); c.beginPath(); c.roundRect(-r * 0.95 + i * r * 0.5, r * 0.9 - hgt, r * 0.36, hgt, r * 0.08); c.fill(); }
    c.beginPath(); c.arc(-r * 0.78, -r * 0.5, r * 0.14, 0, 7); c.fill(); c.lineWidth = r * 0.1; c.beginPath(); c.arc(-r * 0.78, -r * 0.5, r * 0.36, -2.2, -0.9); c.stroke(); }
  else if (type === 'oil') { c.beginPath(); c.moveTo(r * 0.25, -r); c.lineTo(-r * 0.6, r * 0.15); c.lineTo(-r * 0.05, r * 0.15); c.lineTo(-r * 0.3, r); c.lineTo(r * 0.6, -r * 0.2); c.lineTo(r * 0.05, -r * 0.2); c.closePath(); c.fill(); }
  else if (type === 'health') { rr(-r, -r, r * 2, r * 2, r * 0.4); c.fill(); c.fillStyle = '#fff'; c.fillRect(-r * 0.2, -r * 0.62, r * 0.4, r * 1.24); c.fillRect(-r * 0.62, -r * 0.2, r * 1.24, r * 0.4); }
  else if (type === 'reit') { c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 1.05, -r * 0.1); c.lineTo(-r * 1.05, -r * 0.1); c.closePath(); c.fill(); c.fillRect(-r * 0.72, -r * 0.1, r * 1.44, r * 1.05);
    c.fillStyle = '#fff'; c.fillRect(-r * 0.2, r * 0.3, r * 0.4, r * 0.65); }
  else if (type === 'fin') { c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 1.05, -r * 0.35); c.lineTo(-r * 1.05, -r * 0.35); c.closePath(); c.fill();
    for (let i = -1; i <= 1; i++) c.fillRect(i * r * 0.6 - r * 0.14, -r * 0.2, r * 0.28, r * 0.85); c.fillRect(-r, r * 0.72, r * 2, r * 0.26); }
  else if (type === 'trans') { c.beginPath(); c.moveTo(-r, r * 0.15); c.lineTo(r, r * 0.15); c.lineTo(r * 0.68, r * 0.85); c.lineTo(-r * 0.68, r * 0.85); c.closePath(); c.fill();
    c.fillRect(-r * 0.5, -r * 0.5, r * 0.75, r * 0.55); c.fillRect(r * 0.32, -r * 0.95, r * 0.2, r * 1.0); c.fillStyle = '#fff'; c.fillRect(-r * 0.36, -r * 0.36, r * 0.2, r * 0.2); c.fillRect(-r * 0.06, -r * 0.36, r * 0.2, r * 0.2); }
  else if (type === 'bio') { c.beginPath(); c.moveTo(-r * 0.24, -r); c.lineTo(r * 0.24, -r); c.lineTo(r * 0.24, -r * 0.3); c.lineTo(r * 0.85, r * 0.78); c.quadraticCurveTo(r * 0.9, r, r * 0.65, r); c.lineTo(-r * 0.65, r); c.quadraticCurveTo(-r * 0.9, r, -r * 0.85, r * 0.78); c.lineTo(-r * 0.24, -r * 0.3); c.closePath(); c.fill();
    c.fillRect(-r * 0.38, -r * 1.02, r * 0.76, r * 0.16); c.fillStyle = '#fff'; c.beginPath(); c.arc(-r * 0.15, r * 0.5, r * 0.14, 0, 7); c.arc(r * 0.25, r * 0.3, r * 0.1, 0, 7); c.fill(); }
  else if (type === 'staples') { c.beginPath(); c.arc(0, -r * 0.05, r, 0, Math.PI); c.closePath(); c.fill(); c.fillRect(-r * 0.5, r * 0.85, r, r * 0.16);
    for (const [x, y] of [[-0.5, -0.4], [0, -0.55], [0.5, -0.4], [-0.25, -0.25], [0.25, -0.25]]) { c.beginPath(); c.arc(x * r, y * r, r * 0.17, 0, 7); c.fill(); } }
  else if (type === 'disc') { rr(-r, -r * 0.5, r * 2, r * 1.4, r * 0.2); c.fill(); c.lineWidth = r * 0.2; rr(-r * 0.4, -r * 0.95, r * 0.8, r * 0.6, r * 0.15); c.stroke();
    c.fillStyle = '#fff'; c.fillRect(-r, r * 0.05, r * 2, r * 0.16); }
  else if (type === 'util') { c.beginPath(); c.arc(0, -r * 0.25, r * 0.75, 0, 7); c.fill(); c.fillRect(-r * 0.36, r * 0.35, r * 0.72, r * 0.3); rr(-r * 0.26, r * 0.72, r * 0.52, r * 0.24, r * 0.08); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(r * 0.12, -r * 0.7); c.lineTo(-r * 0.28, -r * 0.18); c.lineTo(0, -r * 0.18); c.lineTo(-r * 0.12, r * 0.22); c.lineTo(r * 0.28, -r * 0.34); c.lineTo(0, -r * 0.34); c.closePath(); c.fill(); }
  else if (type === 'mat') { for (const [x, y] of [[-0.55, 0.45], [0.55, 0.45], [0, -0.45]]) { c.beginPath(); c.moveTo((x - 0.5) * r, (y + 0.4) * r); c.lineTo((x - 0.32) * r, (y - 0.4) * r); c.lineTo((x + 0.32) * r, (y - 0.4) * r); c.lineTo((x + 0.5) * r, (y + 0.4) * r); c.closePath(); c.fill(); } }
  else if (type === 'gold') { c.beginPath(); c.moveTo(-r, r * 0.6); c.lineTo(-r * 0.6, -r * 0.6); c.lineTo(r * 0.6, -r * 0.6); c.lineTo(r, r * 0.6); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.moveTo(-r * 0.42, -r * 0.34); c.lineTo(r * 0.1, -r * 0.34); c.lineTo(r * 0.02, -r * 0.1); c.lineTo(-r * 0.5, -r * 0.1); c.closePath(); c.fill(); }
  else if (type === 'bond') { rr(-r * 0.75, -r, r * 1.5, r * 2, r * 0.14); c.fill(); c.fillStyle = '#fff'; for (let i = 0; i < 3; i++) c.fillRect(-r * 0.48, -r * 0.62 + i * r * 0.38, r * 0.96, r * 0.14);
    c.beginPath(); c.arc(r * 0.22, r * 0.6, r * 0.2, 0, 7); c.fill(); }
  else if (type === 'etf') { c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = r * 0.14;
    for (const a of [-Math.PI / 2, Math.PI / 6, Math.PI * 5 / 6]) { c.beginPath(); c.moveTo(0, 0); c.lineTo(Math.cos(a) * r, Math.sin(a) * r); c.stroke(); } }
  else if (type === 'green') { c.beginPath(); c.moveTo(-r * 0.85, r * 0.85); c.quadraticCurveTo(-r, -r, r * 0.9, -r * 0.9); c.quadraticCurveTo(r, r * 0.9, -r * 0.85, r * 0.85); c.fill();
    c.strokeStyle = '#fff'; c.lineWidth = r * 0.13; c.beginPath(); c.moveTo(-r * 0.6, r * 0.6); c.lineTo(r * 0.45, -r * 0.45); c.stroke(); }
  else if (type === 'def') { c.beginPath(); c.moveTo(0, -r); c.lineTo(r * 0.9, -r * 0.6); c.lineTo(r * 0.9, r * 0.1); c.quadraticCurveTo(r * 0.7, r * 0.8, 0, r); c.quadraticCurveTo(-r * 0.7, r * 0.8, -r * 0.9, r * 0.1); c.lineTo(-r * 0.9, -r * 0.6); c.closePath(); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(0, -r * 0.05, r * 0.3, 0, 7); c.fill(); }
  else if (type === 'game') { rr(-r, -r * 0.55, r * 2, r * 1.2, r * 0.5); c.fill(); c.fillStyle = '#fff'; c.fillRect(-r * 0.68, -r * 0.08, r * 0.5, r * 0.16); c.fillRect(-r * 0.51, -r * 0.25, r * 0.16, r * 0.5);
    c.beginPath(); c.arc(r * 0.38, -r * 0.12, r * 0.13, 0, 7); c.arc(r * 0.64, r * 0.12, r * 0.13, 0, 7); c.fill(); }
  else if (type === 'crypto') { c.beginPath(); c.arc(0, 0, r, 0, 7); c.fill(); c.strokeStyle = '#fff'; c.lineWidth = r * 0.1; c.beginPath(); c.arc(0, 0, r * 0.78, 0, 7); c.stroke();
    c.fillStyle = '#fff'; c.font = `900 ${r * 1.1}px Arial`; c.textAlign = 'center'; c.textBaseline = 'middle'; c.fillText('M', 0, r * 0.06); }
  else if (type === 'space') {      // 火箭:機身 + 鼻錐 + 兩片尾翼,中間挖一個圓窗
    c.beginPath(); c.moveTo(0, -r); c.quadraticCurveTo(r * 0.5, -r * 0.55, r * 0.38, r * 0.45); c.lineTo(-r * 0.38, r * 0.45); c.quadraticCurveTo(-r * 0.5, -r * 0.55, 0, -r); c.fill();
    c.beginPath(); c.moveTo(-r * 0.38, r * 0.05); c.lineTo(-r * 0.8, r * 0.75); c.lineTo(-r * 0.3, r * 0.5); c.moveTo(r * 0.38, r * 0.05); c.lineTo(r * 0.8, r * 0.75); c.lineTo(r * 0.3, r * 0.5); c.fill();
    c.beginPath(); c.moveTo(-r * 0.2, r * 0.55); c.lineTo(0, r); c.lineTo(r * 0.2, r * 0.55); c.fill();
    c.fillStyle = '#fff'; c.beginPath(); c.arc(0, -r * 0.2, r * 0.2, 0, 7); c.fill(); }
  else if (type === 'ecom') {       // 購物車:車籃 + 把手 + 兩個輪子
    c.lineWidth = r * 0.18; c.beginPath(); c.moveTo(-r, -r * 0.75); c.lineTo(-r * 0.68, -r * 0.75); c.lineTo(-r * 0.4, r * 0.35); c.lineTo(r * 0.72, r * 0.35); c.stroke();
    c.beginPath(); c.moveTo(-r * 0.6, -r * 0.45); c.lineTo(r * 0.95, -r * 0.45); c.lineTo(r * 0.75, r * 0.15); c.lineTo(-r * 0.46, r * 0.15); c.closePath(); c.fill();
    for (const x of [-0.3, 0.6]) { c.beginPath(); c.arc(x * r, r * 0.72, r * 0.17, 0, 7); c.fill(); } }
  else if (type === 'robot') {      // 機器人頭:天線 + 方頭 + 兩隻挖空的眼睛和嘴
    c.lineWidth = r * 0.14; c.beginPath(); c.moveTo(0, -r * 0.55); c.lineTo(0, -r * 0.85); c.stroke(); c.beginPath(); c.arc(0, -r * 0.92, r * 0.13, 0, 7); c.fill();
    rr(-r * 0.85, -r * 0.55, r * 1.7, r * 1.35, r * 0.3); c.fill(); c.fillRect(-r, -r * 0.05, r * 0.18, r * 0.4); c.fillRect(r * 0.82, -r * 0.05, r * 0.18, r * 0.4);
    c.fillStyle = '#fff'; for (const x of [-0.35, 0.35]) { c.beginPath(); c.arc(x * r, -r * 0.05, r * 0.17, 0, 7); c.fill(); } c.fillRect(-r * 0.35, r * 0.4, r * 0.7, r * 0.12); }
  c.restore();
}
// 禮物格的圖示:和其他格子一樣用單色線條畫(白色禮物盒,緞帶用挖空的方式露出格子底色)
// 銀行格的圖示:三角形屋頂(中間一個 $)、四根柱子、台階。白色,和禮物格同樣的畫法
const drawBankIcon = (c, F, cx, cy) => {
  c.save(); c.translate(cx, cy); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round';
  c.beginPath(); c.moveTo(-66, -26); c.lineTo(0, -66); c.lineTo(66, -26); c.closePath(); c.fill();          // 屋頂
  c.fillRect(-62, -24, 124, 10);                                                                         // 橫樑
  for (const x of [-46, -16, 16, 46]) c.fillRect(x - 8, -10, 16, 56);                                     // 柱子
  c.fillRect(-64, 48, 128, 10); c.fillRect(-72, 60, 144, 10);                                             // 台階
  c.globalCompositeOperation = 'destination-out'; c.font = F(30); c.fillText('$', 0, -40); c.globalCompositeOperation = 'source-over';   // 屋頂上挖一個 $
  c.restore();
};
// 利息格的圖示:一矮一高兩疊硬幣(錢變多),上面一個往右上的箭頭
const drawInterestIcon = (c, F, cx, cy) => {
  c.save(); c.translate(cx, cy); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineCap = 'round'; c.lineJoin = 'round';
  const stack = (x, n) => { for (let i = 0; i < n; i++) { c.beginPath(); c.roundRect(x - 30, 48 - i * 17, 60, 14, 7); c.fill(); } };
  stack(-36, 3); stack(36, 6);                                                                           // 矮的一疊、高的一疊
  c.lineWidth = 10; c.beginPath(); c.moveTo(-58, -6); c.quadraticCurveTo(-30, -40, 14, -54); c.stroke();  // 往右上的箭頭
  c.beginPath(); c.moveTo(-2, -68); c.lineTo(20, -56); c.lineTo(6, -34); c.stroke();
  c.restore();
};
// 其他特殊格的圖示(都是白色,挖空的部分用 destination-out),大約佔 120×120,中心在 (cx, cy)
const cut = (c, fn) => { c.globalCompositeOperation = 'destination-out'; fn(); c.globalCompositeOperation = 'source-over'; };
const TILE_ICONS = {
  coin: (c, F) => {                                                                                       // 撿到錢:一枚 $ 硬幣 + 閃光
    c.beginPath(); c.arc(-6, 6, 44, 0, Math.PI * 2); c.fill();
    cut(c, () => { c.lineWidth = 6; c.beginPath(); c.arc(-6, 6, 34, 0, Math.PI * 2); c.stroke(); c.font = F(52); c.fillText('$', -6, 9); });
    c.beginPath(); for (let i = 0; i < 8; i++) { const r = i % 2 ? 6 : 18, a = i * Math.PI / 4 - Math.PI / 2; c.lineTo(46 + Math.cos(a) * r, -40 + Math.sin(a) * r); } c.closePath(); c.fill();
  },
  fee: (c) => {                                                                                           // 手續費:收據(下緣鋸齒)
    c.beginPath(); c.moveTo(-36, -52); c.lineTo(36, -52); c.lineTo(36, 40);
    for (let i = 0; i < 6; i++) c.lineTo(36 - (i + 0.5) * 12, i % 2 ? 40 : 50); c.lineTo(-36, 40); c.closePath(); c.fill();
    cut(c, () => { c.lineWidth = 7; c.lineCap = 'round'; for (const y of [-32, -14, 4]) { c.beginPath(); c.moveTo(-22, y); c.lineTo(y === 4 ? 4 : 22, y); c.stroke(); } c.beginPath(); c.moveTo(-22, 24); c.lineTo(-6, 24); c.stroke(); });
  },
  divi: (c, F) => {                                                                                       // 股息結算:錢袋
    c.beginPath(); c.ellipse(0, 18, 50, 42, 0, 0, Math.PI * 2); c.fill();
    c.beginPath(); c.moveTo(-18, -22); c.lineTo(-30, -50); c.quadraticCurveTo(0, -38, 30, -50); c.lineTo(18, -22); c.closePath(); c.fill();
    cut(c, () => { c.lineWidth = 6; c.beginPath(); c.moveTo(-20, -22); c.lineTo(20, -22); c.stroke(); c.font = F(50); c.fillText('$', 0, 22); });
  },
  start: (c) => {                                                                                         // 起點:方格旗
    c.fillRect(-46, -56, 9, 112);
    c.beginPath(); c.moveTo(-37, -56); c.quadraticCurveTo(0, -66, 46, -52); c.lineTo(46, -6); c.quadraticCurveTo(0, -20, -37, -10); c.closePath(); c.fill();
    cut(c, () => { for (let r = 0; r < 2; r++) for (let k = 0; k < 4; k++) if ((r + k) % 2) c.fillRect(-37 + k * 21, -52 + r * 21, 21, 21); });
  },
  shop: (c) => {                                                                                          // 商店:條紋遮雨棚 + 店面(門、兩扇窗)
    c.beginPath(); c.moveTo(-58, -26); c.lineTo(-50, -54); c.lineTo(50, -54); c.lineTo(58, -26); c.closePath(); c.fill();
    for (let i = 0; i < 5; i++) { c.beginPath(); c.arc(-46 + i * 23, -26, 11.5, 0, Math.PI); c.fill(); }
    c.fillRect(-48, -14, 96, 62);
    cut(c, () => { for (let i = 0; i < 2; i++) c.fillRect(-28 + i * 34, -54, 12, 28); c.fillRect(-13, 8, 26, 40); c.fillRect(-40, -4, 20, 18); c.fillRect(20, -4, 20, 18); });
  },
  ipo: (c) => drawOfferIcon(c),                                                                           // 內部認購:邀請函
  police: (c) => drawPoliceIcon(c),                                                                       // 警察局:警徽
};
// 警察局、內部認購的圖示:寫成 function(會提升),因為小路的格子在檔案前面就畫了,那時 TILE_ICONS / cut 還沒定義
function knockOut(c, fn) { c.globalCompositeOperation = 'destination-out'; fn(); c.globalCompositeOperation = 'source-over'; }
function starPath(c, x, y, R, r) { c.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, d = i % 2 ? r : R; c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d); } c.closePath(); }
function shieldPath(c, k) {
  c.beginPath(); c.moveTo(0, -58 * k); c.quadraticCurveTo(26 * k, -44 * k, 48 * k, -46 * k); c.lineTo(48 * k, -4 * k);
  c.quadraticCurveTo(46 * k, 36 * k, 0, 58 * k); c.quadraticCurveTo(-46 * k, 36 * k, -48 * k, -4 * k); c.lineTo(-48 * k, -46 * k); c.quadraticCurveTo(-26 * k, -44 * k, 0, -58 * k); c.closePath();
}
function drawPoliceIcon(c) {      // 警徽:盾牌,內圈挖一圈細線,中間挖空一顆星
  shieldPath(c, 1); c.fill();
  knockOut(c, () => { c.lineWidth = 5; shieldPath(c, 0.78); c.stroke(); starPath(c, 0, -2, 24, 10); c.fill(); });
}
function drawOfferIcon(c) {       // 內部認購:邀請函信封,封口畫 V 字,中間一顆封蠟(挖空星星)
  c.beginPath(); c.roundRect(-56, -38, 112, 80, 10); c.fill();
  knockOut(c, () => { c.lineWidth = 6; c.beginPath(); c.moveTo(-48, -30); c.lineTo(0, 6); c.lineTo(48, -30); c.stroke(); c.beginPath(); c.arc(0, 8, 24, 0, Math.PI * 2); c.fill(); });
  c.beginPath(); c.arc(0, 8, 19, 0, Math.PI * 2); c.fill();
  knockOut(c, () => { starPath(c, 0, 8, 11, 5); c.fill(); });
}
function iconTile(c, F, draw, label) {
  c.save(); c.translate(128, 96); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; draw(c); c.restore();
  c.fillStyle = '#fff'; c.font = F(label.length > 6 ? 34 : ZH ? 44 : 42); c.fillText(label, 128, 212);
}
// 一格的畫法:圖示在上,名稱(和可有可無的一行小字)在下
function drawIconTile(c, F, kind, label, sub) {
  c.save(); c.translate(128, sub ? 84 : 96); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; if (sub) c.scale(0.86, 0.86); TILE_ICONS[kind](c, F); c.restore();
  c.fillStyle = '#fff'; c.font = F(label.length > 6 ? 34 : ZH ? 44 : 42); c.fillText(label, 128, sub ? 182 : 212);
  if (sub) { c.font = F(ZH ? 32 : 30); c.fillText(sub, 128, 226); }
}
const drawGiftLabel = (c, F) => {
  c.save(); c.translate(128, 96); c.fillStyle = '#fff'; c.strokeStyle = '#fff'; c.lineJoin = 'round'; c.lineCap = 'round';
  c.beginPath(); c.roundRect(-52, -6, 104, 72, 10); c.fill();                       // 盒身
  c.beginPath(); c.roundRect(-62, -30, 124, 30, 9); c.fill();                       // 蓋子
  c.globalCompositeOperation = 'destination-out';                                   // 緞帶:挖空
  c.fillRect(-8, -30, 16, 96); c.fillRect(-62, -4, 124, 5);
  c.globalCompositeOperation = 'source-over';
  c.lineWidth = 9;                                                                  // 蝴蝶結:兩個圈
  c.beginPath(); c.ellipse(-22, -46, 18, 12, -0.5, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.ellipse(22, -46, 18, 12, 0.5, 0, Math.PI * 2); c.stroke();
  c.beginPath(); c.arc(0, -42, 8, 0, Math.PI * 2); c.fill();
  c.restore();
  c.fillStyle = '#fff'; c.font = F(ZH ? 50 : 44); c.fillText(L('GIFT', '禮物'), 128, 212);
};
function drawLabel(i) {
  const t = tiles[i], c = t.cv.getContext('2d'), sec = SECTORS[t.type];
  c.clearRect(0, 0, 256, 256); c.textAlign = 'center'; c.textBaseline = 'middle';
  const F = (px) => `900 ${px}px "Avenir Next","PingFang TC","Helvetica Neue",Arial,sans-serif`;
  if (sec) {
    icon(c, t.type, 128, 62, 34, sec.css);
    c.fillStyle = sec.css; c.font = F(sec.code.length > 8 ? 28 : ZH ? (sec.code.length > 3 ? 34 : 38) : 34); c.fillText(sec.code, 128, 136);
    c.fillStyle = '#3b2f2a'; c.font = F(62); c.fillText('$' + Math.round(S.price[t.type]), 128, 196);
  } else if (t.type === 'gift') { drawGiftLabel(c, F);
  } else if (TILE_ICONS[t.type]) {
    const lab = { start: [L('GO', '起點')], shop: [L('SHOP', '商店')], divi: [L('DIVIDEND', '股息結算')], ipo: [L('OFFER', '內部認購')], fee: [L('FEE', '手續費')] }[t.type];   // 金額不寫在格子上,踩到時會有提示
    drawIconTile(c, F, t.type, ...lab);
  } else if (t.type === 'bank') {
    drawBankIcon(c, F, 128, 100);
    c.fillStyle = '#fff'; c.font = F(ZH ? 46 : 42); c.fillText(L('BANK', '銀行'), 128, 212);
  } else if (t.type === 'chance') {
    c.fillStyle = '#b0780a'; c.font = F(150); c.fillText('?', 128, 112);
    c.font = F(34); c.fillText(L('EVENT', '市場事件'), 128, 208);
  } else if (t.type === 'fate') {
    c.fillStyle = '#fff'; c.font = F(130); c.fillText('★', 128, 112);
    c.font = F(ZH ? 44 : 40); c.fillText(L('FATE', '命運'), 128, 208);
  } else {
    const [a, b] = { start: [L('GO', '起點'), L('+$' + SALARY, '領薪水股利')], fee: [L('FEE', '手續費'), '-$' + FEE], shop: [L('SHOP', '商店'), L('buy items', '買道具')], gift: [L('GIFT', '禮物'), L('free item', '送道具')], fate: [L('FATE', '命運'), L('flip a card', '翻一張牌')], bank: [L('BANK', '銀行'), L('loans', '借錢 還錢')], ipo: ['IPO', L('enter lane', '新股申購')], divi: [L('DIVIDEND', '股息結算'), L('paid here', '在此領股利')] }[t.type];
    c.fillStyle = '#fff'; c.font = F(a.length > 5 ? 40 : (ZH && a !== 'IPO' ? (a.length > 3 ? 50 : 60) : 72)); c.fillText(a, 128, 104);
    c.font = F(ZH ? 34 : 40); c.fillText(b, 128, 168);
  }
  t.tex.needsUpdate = true;
}
let pricesQueued = false;
const drawAll = () => { tiles.forEach((_, i) => drawLabel(i)); if (NET.on && NET.started && !pricesQueued) { pricesQueued = true; setTimeout(() => { pricesQueued = false; netSend({ t: 'prices', price: S.price }); }, 0); } };

/* ───────────── 棋子(貓) ───────────── */
const piece = new THREE.Group(); scene.add(piece);
const body = new THREE.Group(); piece.add(body);
// 棋子可選:預設是原創的幾何兔子;網址加 ?piece=cat 換回房間那隻貓的模型
const PRESET = new URLSearchParams(location.search).get('piece');   // ?piece=cat|bunny|bear|dog 可以跳過選角
// 原創兔子(純幾何):奶油色、一隻耳朵折下來、腮紅、粉紅圓點鼻、橘色圍巾。正面朝 +z
function makeBunny() {
  const g = new THREE.Group();
  const fur = mat(0xfff4e2, { roughness: 0.9 }), pink = mat(0xffb3c7), dark = mat(0x2b2420, { roughness: 0.5 }), scarf = mat(0xff8a3d);
  const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.castShadow = true; g.add(o); return o; };
  const sph = (r) => new THREE.SphereGeometry(r, 24, 18);
  add(sph(0.22), fur, 0, 0.24, 0, 1, 1.08, 0.92);                    // 身體
  add(sph(0.075), fur, -0.11, 0.045, 0.07, 1, 0.6, 1.3);             // 腳
  add(sph(0.075), fur, 0.11, 0.045, 0.07, 1, 0.6, 1.3);
  add(sph(0.06), fur, -0.2, 0.27, 0.05, 0.8, 1.3, 0.8);              // 手
  add(sph(0.06), fur, 0.2, 0.27, 0.05, 0.8, 1.3, 0.8);
  add(sph(0.07), fur, 0, 0.2, -0.2);                                 // 尾巴
  add(new THREE.TorusGeometry(0.15, 0.05, 10, 24), scarf, 0, 0.43, 0).rotation.x = Math.PI / 2;   // 圍巾
  add(new THREE.BoxGeometry(0.09, 0.2, 0.04), scarf, 0.1, 0.33, 0.15).rotation.z = -0.25;
  add(sph(0.24), fur, 0, 0.62, 0, 1.12, 0.95, 1);                    // 頭(偏扁寬)
  // 耳朵:左耳直立,右耳折下來
  const earGeo = new THREE.CapsuleGeometry(0.062, 0.26, 6, 14), inGeo = new THREE.CapsuleGeometry(0.032, 0.2, 4, 10);
  const earL = add(earGeo, fur, -0.11, 0.98, 0); earL.rotation.z = 0.12;
  const inL = add(inGeo, pink, -0.11, 0.98, 0.04); inL.rotation.z = 0.12; inL.castShadow = false;
  const earR = add(new THREE.CapsuleGeometry(0.062, 0.12, 6, 14), fur, 0.12, 0.9, 0); earR.rotation.z = -0.2;
  const tip = add(new THREE.CapsuleGeometry(0.06, 0.13, 6, 14), fur, 0.24, 0.98, 0.02); tip.rotation.z = -1.35;   // 折下來的那一段
  add(sph(0.028), dark, -0.095, 0.65, 0.215);                        // 眼睛
  add(sph(0.028), dark, 0.095, 0.65, 0.215);
  add(sph(0.024), pink, 0, 0.595, 0.24);                             // 粉紅圓點鼻
  add(sph(0.045), pink, -0.165, 0.575, 0.17, 1, 0.6, 0.5).castShadow = false;   // 腮紅
  add(sph(0.045), pink, 0.165, 0.575, 0.17, 1, 0.6, 0.5).castShadow = false;
  return g;
}
// 載入棋子模型:先放幾何佔位,模型到了再換。貼圖保留,材質換成卡通著色讓它和場景同一種畫風
// 模型只下載、解壓一次(快取成 Promise),要用的地方拿 clone。貼圖保留,材質換成卡通著色讓它和場景同一種畫風
const pieceLoader = (() => { const d = new DRACOLoader(); d.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/'); const l = new GLTFLoader(); l.setDRACOLoader(d); return l; })();
const modelCache = {};
function loadModel(url, height) {
  return (modelCache[url] ||= new Promise((res, rej) => pieceLoader.load(url, (gltf) => {
    const m = gltf.scene;
    const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3()), ctr = bb.getCenter(new THREE.Vector3());
    const k = height / size.y;
    m.scale.setScalar(k); m.position.set(-ctr.x * k, -bb.min.y * k, -ctr.z * k);
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      const old = o.material;
      o.material = new THREE.MeshToonMaterial({ map: old.map || null, gradientMap: toonRamp, side: old.side });
      // 生成模型在 UV 接縫處法線不連續,描邊會沿接縫裂開變成臉上的髒線 → 這個模型不描邊
      o.material.userData.outlineParameters = { visible: false };
    });
    const wrap = new THREE.Group(); wrap.add(m); res(wrap);
  }, undefined, rej)));
}
// 先放幾何佔位,模型到了再換
function loadPiece(url, height, placeholder, target = body) {
  placeholder.name = 'ph'; target.add(placeholder);
  const token = (target.userData.token = (target.userData.token || 0) + 1);   // 之後又換角色的話,舊的載入結果就丟掉
  loadModel(url, height).then((tpl) => {
    if (target.userData.token !== token) return;
    target.remove(target.getObjectByName('ph')); target.add(tpl.clone(true));
  }).catch((e) => console.warn(`[board] ${url} 載入失敗,維持幾何佔位`, e));
}
body.rotation.y = Math.PI / 4;
// 對手(電腦控制)。和玩家站同一格時各往一邊偏一點才不會疊在一起
const bearPiece = new THREE.Group(); scene.add(bearPiece);
const bearBody = new THREE.Group(); bearPiece.add(bearBody); bearBody.rotation.y = Math.PI / 4;
// 四個角色:開局選一隻當自己,電腦從剩下的挑一隻當對手。模型都是 Meshy 生成後壓到約 250 KB
const CHARS = {
  cat:   { url: './kitty.glb?v=1', h: 1.25, name: L('Kitty', '貓咪'), icon: '🐱', color: 0xffb057 },
  bunny: { url: './bunny.glb?v=1', h: 1.3,  name: L('Bunny', '兔子'), icon: '🐰', color: 0xfff4e2 },
  bear:  { url: './bear.glb?v=1',  h: 1.25, name: L('Bear', '小熊'),  icon: '🐻', color: 0xb9793f },
  dog:   { url: './pup.glb?v=1',   h: 1.25, name: L('Pup', '狗狗'),   icon: '🐶', color: 0xe8c9a0 },
  penguin: { url: './penguin.glb?v=1', h: 1.2,  name: L('Penguin', '小企鵝'),   icon: '🐧', color: 0x4a5a78 },
  guinea:  { url: './guinea.glb?v=1',  h: 1.15, name: L('Guinea pig', '天竺鼠'), icon: '🐹', color: 0xe9b97a },
  fox:     { url: './fox.glb?v=1',     h: 1.25, name: L('Fox', '小狐狸'),       icon: '🦊', color: 0xf08a3c },
  pony:    { url: './pony.glb?v=1',    h: 1.3,  name: L('Pony', '小馬'),        icon: '🐴', color: 0xd9b48a },
};
function setChar(target, key) {
  while (target.children.length) target.remove(target.children[0]);
  const c = CHARS[key], ph = new THREE.Group(), m = mat(c.color);
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), m); b.position.y = 0.26; b.scale.y = 1.1; ph.add(b);
  const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), m); h.position.y = 0.68; ph.add(h);
  loadPiece(c.url, c.h, ph, target);
}
// 選角舞台:在起點外側的空地。選到的角色站在正中間、最大;左右各露出一個「上一個 / 下一個」,比較小、退後一點;
// 其他的收起來看不到。按左右(或直接點旁邊那個)時整排滑過去,像翻唱片封面。被選到的會跳一下、慢慢自轉
const STAGE = new THREE.Vector3(11.6, 0, 11.6), STAGE_KEYS = Object.keys(CHARS);
flowers(260, true);      // 外圈草地也撒花
const stage = new THREE.Group(); stage.position.copy(STAGE); stage.visible = false; scene.add(stage);
// 舞台周圍的花草和樹(掛在 stage 底下,選角結束一起隱藏)
{ const R = Math.SQRT1_2;
  const cols = [0xffffff, 0xffd24a, 0xff9ec4].map((c) => new THREE.Color(c)), pts = [];
  for (let i = 0; i < 90; i++) { const a = Math.random() * Math.PI * 2, d = 2.2 + Math.random() * 2.6; const x = Math.cos(a) * d, z = Math.sin(a) * d; if (Math.abs((x - z) * R) < 4.6 && Math.abs((x + z) * R - 1.6) < 1.5) continue; pts.push([x, z]); }
  const noLine = (m) => { m.userData.outlineParameters = { visible: false }; return m; };
  const petals = new THREE.InstancedMesh(new THREE.SphereGeometry(0.045, 8, 6), noLine(mat(0xffffff)), pts.length), leaves = new THREE.InstancedMesh(new THREE.SphereGeometry(0.07, 8, 6), noLine(mat(0x86c96f)), pts.length), m4 = new THREE.Matrix4();
  pts.forEach(([x, z], i) => { petals.setMatrixAt(i, m4.makeTranslation(x, 0.07, z)); petals.setColorAt(i, cols[i % cols.length]); leaves.setMatrixAt(i, m4.makeScale(1, 0.5, 1).setPosition(x + 0.05, 0.05, z + 0.03)); });
  petals.instanceColor.needsUpdate = true; stage.add(petals, leaves);
  [[-2.6, -1.4, 1.1], [-1.2, -2.8, 0.9], [2.4, -2.9, 1.0], [-3.2, 0.6, 0.8]].forEach(([x, z, sc]) => tree(x, z, sc, stage)); }
const FRONT = Math.PI / 4;          // 從舞台中心看向鏡頭的方向(世界座標的 +x+z)
const slots = STAGE_KEYS.map((key, i) => {
  const top = 0.14;
  const g = new THREE.Group();                                       // 位置每一幀由 stageStep 依「離選到的那個多遠」決定
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, top, 40), mat(0xfff8ec)); base.position.y = top / 2; base.receiveShadow = true; base.castShadow = true; g.add(base);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.76, 0.06, 40), mat(0xff7a59)); ring.position.y = 0.03; g.add(ring);
  const holder = new THREE.Group(); holder.position.y = top; holder.rotation.y = Math.PI / 4; g.add(holder);
  stage.add(g);
  return { key, g, holder, ring, hop: 0, top, spin: 0 };
});
let stageSel = 0, stageOn = false, stageCur = 0;
// 線上同樂:手機玩家一加入,他選的角色就從轉盤拿掉、跳到轉盤前面一排(像大亂鬥),不用文字
const joinedRow = new THREE.Group(); stage.add(joinedRow);
// 第二步「人數格」:2~4 個位子排一排。位子 0 是主機自己,其餘等手機加入;空位是灰圈的底座
let lobbyPhase = false;
const lobbySeats = [0, 1, 2, 3].map(() => { const g = new THREE.Group(); g.visible = false; stage.add(g);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.14, 40), mat(0xfff8ec)); base.position.y = 0.07; base.receiveShadow = true; base.castShadow = true; g.add(base);
  const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.76, 0.06, 40), mat(0xd9cbb6)); ring.position.y = 0.03; g.add(ring);
  const holder = new THREE.Group(); holder.position.y = 0.14; holder.rotation.y = FRONT; g.add(holder);
  return { g, ring, holder, char: null, hop: 0 }; });
function seatSet(i, char) {
  const st = lobbySeats[i]; if (st.char === char) return; st.char = char; st.holder.clear();
  if (char) { const c = CHARS[char]; loadPiece(c.url, c.h, new THREE.Group(), st.holder); st.hop = 1; sfx('item'); st.ring.material.color.setHex(0xff7a59); }
  else st.ring.material.color.setHex(0xd9cbb6);
}
function lobbySeatsPaint() {
  const gs = NET.guests.filter((g) => g.online), n = Math.min(4, Math.max(CFG.n, 1 + gs.length)), R = Math.SQRT1_2;
  lobbySeats.forEach((st, i) => { st.g.visible = lobbyPhase && i < n; const o = (i - (n - 1) / 2) * 1.9, fwd = 1.2; st.g.position.set(o * R + fwd * R, 0, -o * R + fwd * R); });
  if (!lobbyPhase) return;
  seatSet(0, slots[stageSel].key);
  for (let i = 1; i < 4; i++) seatSet(i, gs[i - 1] ? gs[i - 1].char : null);
  $('lobbyGo').textContent = gs.length ? L(`Start · ${1 + gs.length} players`, `開始(${1 + gs.length} 位真人)`) : L('Waiting for players…', '等待玩家加入…');
}
function lobbySeatsStep(dt) { lobbySeats.forEach((st) => { st.hop = Math.max(0, st.hop - dt * 2); st.holder.position.y = 0.14 + Math.sin((1 - st.hop) * Math.PI) * (st.hop > 0 ? 0.5 : 0); if (st.char) st.holder.rotation.y = FRONT + Math.sin(performance.now() / 900 + st.g.position.x) * 0.25; }); }
const joined = [];      // [{ gid, char, g, holder, hop }]
function syncJoined(guests) {
  const live = guests.filter((g) => g.online);
  // 選角階段不顯示其他玩家(只把他們選走的角色從轉盤拿掉);到了人數格大廳才把他們放到位子上
  joined.forEach((j) => joinedRow.remove(j.g)); joined.length = 0;
  slots.forEach((sl) => { sl.taken = live.some((g) => g.char === sl.key); });
  if (slots[stageSel] && slots[stageSel].taken) stageSelect(stageSel + 1);
  if (lobbyPhase) lobbySeatsPaint();
  return;
  // 移除已離開的
  for (let i = joined.length - 1; i >= 0; i--) if (!live.some((g) => g.gid === joined[i].gid)) { joinedRow.remove(joined[i].g); joined.splice(i, 1); }
  live.forEach((g) => {
    let j = joined.find((x) => x.gid === g.gid);
    if (!j) { const grp = new THREE.Group(); joinedRow.add(grp);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.55, 0.12, 36), mat(0xfff8ec)); base.position.y = 0.06; base.receiveShadow = true; base.castShadow = true; grp.add(base);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.57, 0.62, 0.05, 36), mat(0x7cc6ff)); ring.position.y = 0.025; grp.add(ring);
      const holder = new THREE.Group(); holder.position.y = 0.12; holder.rotation.y = FRONT; holder.scale.setScalar(0.78); grp.add(holder);
      j = { gid: g.gid, char: null, g: grp, holder, hop: 0 }; joined.push(j); }
    if (j.char !== g.char) { j.char = g.char; const c = CHARS[g.char]; j.holder.clear(); const ph = new THREE.Group(); loadPiece(c.url, c.h, ph, j.holder); j.hop = 1; sfx('item'); }
  });
  // 放在轉盤左右兩側(第 1 位右、第 2 位左、第 3、4 位在後面一排),不會擋到轉盤
  joined.forEach((j, i) => { j.side = i % 2 ? -1 : 1; j.row = i < 2 ? 0 : 1; });
  // 轉盤上把被選走的拿掉;主機正停在被選走的角色上就自動跳下一個
  slots.forEach((sl) => { sl.taken = live.some((g) => g.char === sl.key); });
  if (slots[stageSel] && slots[stageSel].taken) stageSelect(stageSel + 1);
}
function joinedStep(dt) {
  const R = Math.SQRT1_2, hw = (view.half + stageZoom) * view.aspect, o0 = Math.min(3.1, Math.max(2.5, hw - 0.6));   // 畫面窄的時候往內靠
  joined.forEach((j) => { const o = j.side * (o0 - j.row * 0.35), fwd = 1.5 - j.row * 1.6; j.g.position.set(o * R + fwd * R, 0, -o * R + fwd * R); });
  joined.forEach((j) => { j.hop = Math.max(0, j.hop - dt * 2); j.holder.position.y = 0.12 + Math.sin((1 - j.hop) * Math.PI) * (j.hop > 0 ? 0.5 : 0); j.holder.rotation.y = FRONT + Math.sin(performance.now() / 900 + j.g.position.x) * 0.25; }); }
// 選角畫面的動態排版:上面的設定卡不能擋到角色的頭,底座也不能被下面的名字 / 開始鈕擠到。
// 做法:先把鏡頭目標往上抬(場景整個往下移),不夠再把鏡頭拉遠一點
let stageLift = 0, stageZoom = 0, cardZoom = 1;
const _fv = new THREE.Vector3();
function stageMetrics() {
  const card = (lobbyPhase ? $('lobbyCard') : $('pcfg')).getBoundingClientRect(), bar = (lobbyPhase ? document.querySelector('.lobbybar') : document.querySelector('.pbar')).getBoundingClientRect(), sl = lobbyPhase ? { g: lobbySeats[0].g, top: 0.14, holder: lobbySeats[0].holder } : slots[stageSel];
  sl.g.getWorldPosition(_fv); const y0 = _fv.y;
  const px = (y) => { _fv.y = y; const q = _fv.clone().project(cam); return (1 - q.y) / 2 * innerHeight; };
  let foot = px(y0 - 0.15);
  if (joined.length) { joined[0].g.getWorldPosition(_fv); foot = Math.max(foot, px(_fv.y - 0.1)); sl.g.getWorldPosition(_fv); }
  const head = px(y0 + sl.top + 1.45 * sl.holder.scale.y), unit = px(y0) - px(y0 + 1);   // 世界往上 1 單位 = 畫面往上幾 px
  return { head, foot, unit, cardBottom: card.bottom, barTop: bar.top };
}
function fitStage(dt) {
  const { head, foot, unit, cardBottom, barTop } = stageMetrics();
  if (!(unit > 0)) return;
  const needDown = (cardBottom + 12) - head, room = (barTop - 10) - foot, k = Math.min(1, dt * 5);
  if (needDown > 0) {
    const lift = Math.min(needDown, Math.max(0, room));          // 先把能用的空間用掉(整體往下移)
    if (lift > 1) stageLift += lift / unit * k;
    if (needDown - lift > 1) {
      if (stageZoom < 1.2) stageZoom = Math.min(4, stageZoom + 0.15 * k);          // 再來把鏡頭拉遠一點(角色變小)
      else if (cardZoom > 0.68) { cardZoom = Math.max(0.68, cardZoom - 0.25 * k); document.documentElement.style.setProperty('--cardZoom', cardZoom.toFixed(3)); }   // 還是擠:設定卡縮小
      else stageZoom = Math.min(4, stageZoom + 0.15 * k);
    }
  } else if (needDown < -16) {   // 空間很多:設定卡放回原大小、鏡頭拉回來、場景移回去
    if (cardZoom < 1) { cardZoom = Math.min(1, cardZoom + 0.25 * k); document.documentElement.style.setProperty('--cardZoom', cardZoom.toFixed(3)); }
    else if (stageZoom > 0) stageZoom = Math.max(0, stageZoom - 0.15 * k); else stageLift = Math.max(0, stageLift + needDown / unit * k * 0.5);
  }
}                 // stageCur:目前滑到第幾個(小數),慢慢追上 stageSel
let pickWho = 0;                                              // 現在是第幾位真人在選(0 或 1)
// 選第 i 個;如果那個角色已經被第一位真人選走,就往 dir 方向找下一個
function stageSelect(i, dir = 1) {
  const n = slots.length; i = (i % n + n) % n;
  for (let c = 0; c < n && slots[i].taken; c++) i = (i + dir + n) % n;
  if (i !== stageSel) sfx('hop');     // 換角色也有聲(按鈕本身的點擊聲另外有)
  stageSel = i; slots[i].hop = 1; paintStage(); if (NET.on && !NET.started) netLobby();
}
function paintStage() {
  const c = CHARS[slots[stageSel].key];
  $('pname').textContent = c.name; $('pnameIn').placeholder = c.name;      // 名字欄的預設字就是角色名,不打就用它
  // 沒有標題,所以兩位真人時用按鈕文字說明現在是誰在選
  { const gN = NET.guests.filter((g) => g.online).length; $('pok').textContent = NET.on ? L(`Confirm ${c.name}`, `確認用${c.name}`) : CFG.humans > 1 ? (pickWho === 0 ? L(`Player 1 takes ${c.name}`, `玩家 1 選${c.name}`) : L(`Player 2 takes ${c.name} · start`, `玩家 2 選${c.name},開始`)) : L(`Play as ${c.name}`, `用${c.name}開始`); }
  // 人數設定:只有第一位在選的時候可以改
  $('pcfg').classList.toggle('hide', pickWho > 0);
  $('pcN').textContent = L('Players', '人數');
  $('pcD').textContent = L('Bot', '電腦'); document.getElementById('pcDrow').classList.toggle('hide', CFG.n - (NET.on ? 1 + NET.guests.filter((g) => g.online).length : CFG.humans) <= 0);
  { const names = { easy: L('Easy', '簡單'), normal: L('Normal', '一般'), hard: L('Hard', '兇狠') };
    const di = AI_ORDER.indexOf(CFG.ai || 'normal'); $('pcDv').textContent = names[AI_ORDER[di]];
    document.querySelector('#pcDst [data-ds="-1"]').disabled = di === 0; document.querySelector('#pcDst [data-ds="1"]').disabled = di === AI_ORDER.length - 1; }
  if (NET.on) { const h = Math.min(4, 1 + NET.guests.filter((g) => g.online).length); if (CFG.n < h) CFG.n = h; }
  const H = NET.on ? Math.min(4, 1 + NET.guests.filter((g) => g.online).length) : CFG.humans;
  $('pcNv').textContent = CFG.n; document.querySelector('#pcNst [data-ns="-1"]').disabled = CFG.n <= 2; document.querySelector('#pcNst [data-ns="1"]').disabled = CFG.n >= 4;
  document.querySelectorAll('#pcfg [data-h]').forEach((b) => b.classList.toggle('on', +b.dataset.h === CFG.humans));
  { const R = ROUND_OPTS.includes(CFG.rounds) ? CFG.rounds : MAX_ROLLS;
    // 回合數的上下選擇;到頭的那一邊按鈕變灰
    $('pcM').textContent = L('Rounds', '回合數'); $('pcRv').textContent = R;
    document.querySelector('#pcR [data-r="-1"]').disabled = R === ROUND_OPTS[0]; document.querySelector('#pcR [data-r="1"]').disabled = R === ROUND_OPTS[ROUND_OPTS.length - 1];
    }
}
function stageStep(dt) {
  // 被玩家 1 選走的角色整個(連底座)從輪播拿掉:輪播只排剩下的角色,位置用「在剩下名單裡的第幾個」算
  const order = slots.map((_, i) => i).filter((i) => !slots[i].taken), n = order.length, R = Math.SQRT1_2;
  const wrap = (v) => ((v % n) + n + n / 2) % n - n / 2;      // 繞一圈的最短距離(-n/2 ~ n/2)
  stageCur += wrap(order.indexOf(stageSel) - stageCur) * Math.min(1, dt * 7);
  slots.forEach((sl, i) => {
    if (sl.taken) { sl.g.visible = false; return; }
    const on = i === stageSel, rel = wrap(order.indexOf(i) - stageCur), a = Math.abs(rel);
    // 位置:rel = 0 在正中間;±1 在左右兩邊、往後退一點;再遠的縮小到看不見
    const o = rel * 1.95, back = Math.min(a, 2) * 0.75, k = Math.max(0, 1 - Math.max(0, a - 1) * 1.7);
    const fwd = 1.6 - back;                                           // 整排往鏡頭這邊挪一點,才不會頂到上面的標題
    sl.g.position.set(o * R + fwd * R, 0, -o * R + fwd * R);
    sl.g.visible = k > 0.02; sl.g.scale.setScalar(Math.max(0.001, k));
    sl.hop = Math.max(0, sl.hop - dt * 2.2);
    const sT = Math.max(0.78, 1.3 - a * 0.52); sl.holder.scale.x += (sT - sl.holder.scale.x) * Math.min(1, dt * 10); sl.holder.scale.z = sl.holder.scale.y = sl.holder.scale.x;
    sl.holder.position.y = sl.top + Math.sin((1 - sl.hop) * Math.PI) * (sl.hop > 0 ? 0.35 : 0);
    // 被選到的慢慢轉一圈給你看;沒選到的轉回正面
    if (on) sl.spin += dt * 1.1;
    else { const d = Math.atan2(Math.sin(-sl.spin), Math.cos(-sl.spin)); sl.spin += d * Math.min(1, dt * 6); }
    sl.holder.rotation.y = FRONT + sl.spin;
    sl.ring.visible = on;
  });
}
const pickRay = new THREE.Raycaster(), pickNdc = new THREE.Vector2();
renderer.domElement.addEventListener('pointerup', (e) => {
  if (!stageOn || lobbyPhase) return;
  pickNdc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  pickRay.setFromCamera(pickNdc, cam);
  const hit = pickRay.intersectObjects(slots.map((sl) => sl.g), true)[0];
  if (!hit) return;
  const i = slots.findIndex((sl) => { let o = hit.object; while (o) { if (o === sl.g) return true; o = o.parent; } return false; });
  if (i >= 0 && !slots[i].taken) stageSelect(i);
});
addEventListener('keydown', (e) => {
  if (!stageOn || lobbyPhase || e.target.tagName === 'INPUT') return;      // 在名字欄打字時,空白鍵和方向鍵不要當成選角操作
  if (e.key === 'ArrowLeft') stageSelect(stageSel - 1, -1); else if (e.key === 'ArrowRight') stageSelect(stageSel + 1);
  else if (e.key === 'Enter' || e.key === ' ') $('pok').click();
});
function pickStage() {
  return new Promise((res) => {
    slots.forEach((sl) => { if (!sl.holder.children.length) { const c = CHARS[sl.key], ph = new THREE.Group(), m = mat(c.color);
      const b = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), m); b.position.y = 0.26; b.scale.y = 1.1; ph.add(b);
      const h = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 16), m); h.position.y = 0.68; ph.add(h);
      loadPiece(c.url, c.h, ph, sl.holder); } });
    stage.visible = true; stageOn = true; document.body.classList.add('picking');
    showPieces(false);      // 選角時把棋子藏起來:再玩一次時,上一局的角色不會還站在起點
    if (!pickStage.seen) { pickStage.seen = true; camT.x = STAGE.x; camT.z = STAGE.z; view.half = view.stageHalf; applyFrustum(); }   // 第一次直接從舞台開場,不用從起點慢慢滑過來
    pickWho = 0; const picked = [], names = [];
    // 名字欄:每局都重新打(不記住上次的,因為可能換人玩)
    const nameIn = $('pnameIn'); nameIn.value = '';
    slots.forEach((sl) => { sl.taken = false; });
    stageCur = stageSel; stageSelect(stageSel);
    $('pprev').onclick = () => stageSelect(stageSel - 1, -1); $('pnext').onclick = () => stageSelect(stageSel + 1);
    document.querySelectorAll('#pcfg button').forEach((b) => { if (b.id === 'pcOnline' || b.classList.contains('share')) return; b.onclick = () => {
      if (b.dataset.ns) CFG.n = Math.min(4, Math.max(2, CFG.n + +b.dataset.ns)); else if (b.dataset.h) CFG.humans = +b.dataset.h;
      else if (b.dataset.ds) { const i = Math.max(0, AI_ORDER.indexOf(CFG.ai || 'normal')); CFG.ai = AI_ORDER[Math.min(AI_ORDER.length - 1, Math.max(0, i + +b.dataset.ds))]; }
      else if (b.dataset.r) { const i = Math.max(0, ROUND_OPTS.indexOf(CFG.rounds || MAX_ROLLS)); CFG.rounds = ROUND_OPTS[Math.min(ROUND_OPTS.length - 1, Math.max(0, i + +b.dataset.r))]; }
      try { localStorage.setItem('css.players', JSON.stringify(CFG)); } catch (e) {}
      paintStage();
    }; });
    $('pcOnline').onclick = () => { if (NET.on) netClose(); else netOpen(); };
    // 再玩一次:房間留著,手機回到大廳(可以換角色),離線的位子清掉
    if (NET.on) { NET.started = false; NET.guests = NET.guests.filter((g) => g.online); netSend({ t: 'reset' }); }
    document.body.classList.remove('remote'); $('remoteBanner').classList.add('hide'); lobbyPaint(); netLobby();
    const enterLobby = (on) => {      // 第二步:人數格大廳(多人連線)。on=false 回到選角
      lobbyPhase = on; $('lobbyUI').classList.toggle('hide', !on); document.querySelector('.ptop').classList.toggle('hide', on); document.querySelector('.pbar').classList.toggle('hide', on);
      slots.forEach((sl) => { sl.g.visible = !on && !sl.taken; }); joinedRow.visible = !on;
      lobbySeats.forEach((st) => { st.g.visible = on; }); lobbyPaint(); netLobby(); if (!on) stageSelect(stageSel);
    };
    $('lobbyBack').onclick = () => enterLobby(false);
    $('lobbyGo').onclick = () => {
      {              // 線上同樂:主機 + 手機上的玩家都是真人,不夠的人數用電腦補
        const gs = NET.guests.filter((g) => g.online);
        if (!gs.length) { toast(L('No one has joined yet', '還沒有人加入')); return; }
        NET.guests = gs; NET.started = true; stageOn = false; stage.visible = false; document.body.classList.remove('picking'); slots.forEach((sl) => { sl.taken = false; }); enterLobby(false);
        // 4 支手機都加入時,主機只當螢幕(不下場);否則主機自己也是一位玩家
        const hostPlays = gs.length < 4, chars = [...(hostPlays ? [slots[stageSel].key] : []), ...gs.map((g) => g.char)], humans = chars.length, n = Math.max(CFG.n, humans);
        const rest = Object.keys(CHARS).filter((k) => !chars.includes(k)).sort(() => Math.random() - 0.5);
        netSend({ t: 'start', code: NET.code }); NET.started = true;
        res({ chars: [...chars, ...rest.slice(0, n - humans)], humans, rounds: CFG.rounds, ai: CFG.ai, names: [...(hostPlays ? [nameIn.value.trim().slice(0, 12)] : []), ...gs.map((g) => g.name)], remote: gs.map((g) => g.gid), hostPlays });
      }
    };
    $('pok').onclick = () => {
      if (NET.on) { enterLobby(true); return; }      // 多人連線:先確認角色,再到人數格等大家加入
      picked.push(slots[stageSel].key);
      names.push(nameIn.value.trim().slice(0, 12)); nameIn.value = '';
      if (picked.length < CFG.humans) {            // 換第二位真人選:第一位選走的角色從轉盤上拿掉
        slots[stageSel].taken = true; pickWho = 1; stageSelect(stageSel + 1);
        stageCur = slots.map((_, i) => i).filter((i) => !slots[i].taken).indexOf(stageSel); return;
      }
      stageOn = false; stage.visible = false; document.body.classList.remove('picking');
      slots.forEach((sl) => { sl.taken = false; });
      // 電腦對手:從剩下的角色裡隨機挑
      const rest = Object.keys(CHARS).filter((k) => !picked.includes(k)).sort(() => Math.random() - 0.5);
      res({ chars: [...picked, ...rest.slice(0, CFG.n - picked.length)], humans: picked.length, rounds: CFG.rounds, ai: CFG.ai, names });
    };
  });
}
// 角色頭像:把模型單獨拍一張正面半身照(離屏渲染到 RenderTarget,讀回像素轉成圖片),給左上角頭像和對手面板用
const portraitCache = {};
async function portrait(key) {
  if (portraitCache[key]) return portraitCache[key];
  const c = CHARS[key], tpl = await loadModel(c.url, c.h), SZ = 192;
  const sc = new THREE.Scene(); sc.add(new THREE.HemisphereLight(0xffffff, 0xffe9c9, 1.3)); const dl = new THREE.DirectionalLight(0xffffff, 1.6); dl.position.set(-1, 2, 3); sc.add(dl);
  sc.add(tpl.clone(true));
  const pc = new THREE.OrthographicCamera(-0.5, 0.5, 0.5, -0.5, 0.1, 10); pc.position.set(0, c.h * 0.66, 3); pc.lookAt(0, c.h * 0.66, 0);
  const rt = new THREE.WebGLRenderTarget(SZ, SZ); rt.texture.colorSpace = THREE.SRGBColorSpace;
  const prev = renderer.getRenderTarget(), oc = renderer.getClearColor(new THREE.Color()), oa = renderer.getClearAlpha();
  renderer.setRenderTarget(rt); renderer.setClearColor(0x000000, 0); renderer.clear(); renderer.render(sc, pc);
  const px = new Uint8Array(SZ * SZ * 4); renderer.readRenderTargetPixels(rt, 0, 0, SZ, SZ, px);
  renderer.setRenderTarget(prev); renderer.setClearColor(oc, oa); rt.dispose();
  const cv = document.createElement('canvas'); cv.width = cv.height = SZ; const g = cv.getContext('2d'), img = g.createImageData(SZ, SZ);
  for (let y = 0; y < SZ; y++) img.data.set(px.subarray((SZ - 1 - y) * SZ * 4, (SZ - y) * SZ * 4), y * SZ * 4);   // WebGL 的原點在左下,要上下翻
  g.putImageData(img, 0, 0);
  return (portraitCache[key] = cv.toDataURL());
}
const putPortrait = (el, key) => portrait(key).then((url) => { if (el) el.style.backgroundImage = `url(${url})`; }).catch(() => {});
function setPortraits() {
  putPortrait($('avaMe'), meP().char);
  document.querySelectorAll('#assetTabs .pava').forEach((b) => putPortrait(b, S.players[+b.dataset.i].char));
}
// 排行榜列上的小頭像(和左上的頭像同一套 3D 渲染圖)
function paintPortraits(root = document) { root.querySelectorAll('.mini[data-char]').forEach((el) => { if (!el.dataset.done && CHARS[el.dataset.char]) { el.dataset.done = '1'; putPortrait(el, el.dataset.char); } }); }
let focus;
// 四個棋子(第 3、4 個只有 3~4 人局才會出現)。同一格上四個角落各站一位
const mkPiece = () => { const piece = new THREE.Group(); scene.add(piece); const body = new THREE.Group(); body.rotation.y = Math.PI / 4; piece.add(body); piece.visible = false; return { piece, body }; };
const PIECES = [{ piece, body }, { piece: bearPiece, body: bearBody }, mkPiece(), mkPiece()];
[[-0.3, 0.2], [0.3, -0.2], [0.26, 0.26], [-0.26, -0.26]].forEach(([x, z], i) => { PIECES[i].off = new THREE.Vector3(x, 0, z); });
const PM = () => PIECES[S.hi], PA = () => PIECES[S.ci];      // 現在這位真人 / 現在這位電腦的棋子
const showPieces = (on) => PIECES.forEach((P, i) => { P.piece.visible = on && i < S.players.length; });
focus = PIECES[0];
function placePiece(i, P = PM()) { const p = tilePos(i); P.piece.position.set(p.x + P.off.x, TOP, p.z + P.off.z); }
const onLane = (v) => Object.values(LANES).some((d) => [d.cell, ...d.path].some(([x, z]) => { const p = cellPos(x, z); return Math.abs(p.x - v.x) < 0.95 && Math.abs(p.z - v.z) < 0.95; }));

/* ───────────── 骰子 ───────────── */
const DIE = 0.56;
function pipTex(n) {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128; const c = cv.getContext('2d');
  c.fillStyle = '#fffdf8'; c.fillRect(0, 0, 128, 128);
  const P = { 1: [[64, 64]], 2: [[36, 36], [92, 92]], 3: [[34, 34], [64, 64], [94, 94]], 4: [[36, 36], [92, 36], [36, 92], [92, 92]],
    5: [[36, 36], [92, 36], [64, 64], [36, 92], [92, 92]], 6: [[36, 30], [92, 30], [36, 64], [92, 64], [36, 98], [92, 98]] }[n];
  c.fillStyle = n === 1 ? '#e2483d' : '#2b2420';
  P.forEach(([x, y]) => { c.beginPath(); c.arc(x, y, n === 1 ? 17 : 12, 0, Math.PI * 2); c.fill(); });
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// BoxGeometry 的面順序是 +x,-x,+y,-y,+z,-z;對面加起來是 7
const FACE = [3, 4, 1, 6, 2, 5];
const dieMats = FACE.map((n) => new THREE.MeshToonMaterial({ map: pipTex(n), gradientMap: toonRamp }));
const DIE_REST = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];   // 第三顆只有用「三顆骰子」道具時才出現
// 骰子落在「擲的人」旁邊的草地上:從棋子往棋盤中心退 2.6 格
function diceSpots(P) {
  const p = P.piece.position, d = new THREE.Vector3(-p.x, 0, -p.z);
  if (d.lengthSq() < 0.01) d.set(-1, 0, -1);
  d.normalize();
  const side = new THREE.Vector3(-d.z, 0, d.x), y = 0.18 + DIE / 2;
  DIE_REST[0].set(p.x + d.x * 2.6 + side.x * 0.42, y, p.z + d.z * 2.6 + side.z * 0.42);
  DIE_REST[1].set(p.x + d.x * 2.9 - side.x * 0.42, y, p.z + d.z * 2.9 - side.z * 0.42);
  DIE_REST[2].set(p.x + d.x * 3.5, y, p.z + d.z * 3.5);
  // 落點剛好在小路的格子上 → 往旁邊挪,不然骰子會陷進格子裡
  for (let n = 0; n < 2 && DIE_REST.some(onLane); n++) DIE_REST.forEach((v) => { v.x += side.x * 1.7; v.z += side.z * 1.7; });
}
const dice = DIE_REST.map((p, i) => { const d = new THREE.Mesh(new RoundedBoxGeometry(DIE, DIE, DIE, 4, 0.08), dieMats); d.castShadow = true; d.position.copy(p); d.visible = i < 2; scene.add(d); return d; });
// 讓點數 n 朝上的姿態
const UPQ = {
  1: new THREE.Quaternion(),
  6: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI),
  3: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
  4: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -Math.PI / 2),
  2: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2),
  5: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2),
};

/* ───────────── 補間動畫(用自己的時鐘,面板隱藏時也能手動推進) ───────────── */
let T = 0; const tweens = [];
const tween = (dur, fn) => new Promise((res) => tweens.push({ t0: T, dur, fn, res }));
const wait = (dur) => tween(dur, () => {});
const ease = (k) => 1 - Math.pow(1 - k, 3);
let skipRender = false;
function step(dt) {
  T += dt;
  windStep(); rippleStep(dt);
  for (let i = tweens.length - 1; i >= 0; i--) {
    const a = tweens[i], k = Math.min(1, (T - a.t0) / a.dur);
    a.fn(k);
    if (k >= 1) { tweens.splice(i, 1); a.res(); }
  }
  // 待機:貓輕輕呼吸;小樓平滑長高
  PIECES.forEach((P, i) => {
    if (!S.busy) { P.body.scale.y = 1 + Math.sin(T * (3 - i * 0.3) + i) * 0.025; P.body.rotation.z = Math.sin(T * (1.6 - i * 0.2) + i * 2) * 0.04; }
    else P.body.rotation.z *= 0.85;
  });
  tiles.forEach((t) => {
    if (!t.bld) return;
    const coins = Math.min(6, Math.round(S.hold[t.type].n / LOT)), target = coins > 0 ? 1 : 0;
    t.bldH += (target - t.bldH) * Math.min(1, dt * 8);
    t.bld.visible = t.bldH > 0.01; t.bld.scale.setScalar(Math.max(0.001, t.bldH));
    t.bld.children.forEach((c, i) => { c.visible = i < coins; });
  });
  // 鏡頭:跟著現在在走的棋子(全覽模式則看棋盤中心),視野大小平滑過渡
  const fp = focus.piece.position;
  // 目標點往棋盤中心偏 1.6 格:棋子在畫面偏下方,前方要走的格子和骰子落點都看得到
  const fl = Math.hypot(fp.x, fp.z) || 1, ox = -fp.x / fl * 1.6, oz = -fp.z / fl * 1.6;
  const tx = stageOn ? STAGE.x : (view.overview ? 0 : fp.x + ox) + pan.x, tz = stageOn ? STAGE.z : (view.overview ? 0 : fp.z + oz) + pan.z, kf = Math.min(1, dt * 3.2);
  if (stageOn) { if (lobbyPhase) lobbySeatsStep(dt); else { stageStep(dt); joinedStep(dt); } }
  // 放手後,如果拖到範圍外就彈回來
  if (!panDrag && !stageOn) { const kb = Math.min(1, dt * 7);
    if (Math.abs(tx) > PAN_LIM) pan.x += (Math.sign(tx) * PAN_LIM - tx) * kb;
    if (Math.abs(tz) > PAN_LIM) pan.z += (Math.sign(tz) * PAN_LIM - tz) * kb; }
  camT.x += (tx - camT.x) * kf; camT.z += (tz - camT.z) * kf;
  cam.position.copy(camT).add(CAM_OFF);
  sun.position.copy(camT).add(SUN_OFF); sun.target.position.copy(camT);
  if (stageOn) fitStage(dt);
  camT.y += ((stageOn ? 0.2 + stageLift : 0.2) - camT.y) * Math.min(1, dt * 4);
  const hGoal = stageOn ? view.stageHalf + stageZoom : (view.overview ? view.far : view.near) * view.zoomMul;   // zoomMul:玩家用滾輪 / 雙指縮放的倍率(只動地圖,UI 不變)
  if (Math.abs(hGoal - view.half) > 0.002) { view.half += (hGoal - view.half) * Math.min(1, dt * 4); applyFrustum(); }
  if (!skipRender) outline.render(scene, cam);
}
/* ───────────── 拖曳看地圖 ─────────────
   按住畫面拖曳 = 平移鏡頭(pan 是加在「跟著棋子」的目標點上的偏移)。下一次擲骰、換對手走、或按地圖鈕時歸零,鏡頭自己滑回棋子 */
const pan = new THREE.Vector3(), PAN_LIM = N / 2 * STEP + 10;   // 鏡頭中心最遠可以到棋盤外 10 格
let panDrag = false;
view.zoomMul = 1;
{
  const cv = $('gl'), R = Math.SQRT1_2, TILT = CAM_OFF.y / CAM_OFF.length();   // TILT:地面往前 1 格,在畫面上只移動這個比例(鏡頭是斜著看的)
  let drag = null;
  const UI = 'button, a, .bar, .ava, .m, .box, .bubble, .panel, .draw, .end, .pickui, .round, .steps, .dsel, .toast, .rb, .stockbtn, .tabs';
  // 縮放:電腦滾輪、手機雙指。只改鏡頭的視野大小(view.zoomMul),介面不受影響;範圍 0.55x ~ 3.3x(拉到最遠可以看到整張地圖,所以不用地圖鈕了)
  const setZoom = (m) => { view.zoomMul = Math.max(0.55, Math.min(3.3, m)); };   // 3.3x 差不多等於以前地圖鈕的全覽
  window.addEventListener('wheel', (e) => { if (stageOn || e.target.closest?.(UI)) return; e.preventDefault(); setZoom(view.zoomMul * Math.exp(e.deltaY * 0.0012)); }, { passive: false });
  const touches = new Map(); let pinch = null;      // pinch:{ d0, m0 } 開始時的兩指距離和倍率
  window.addEventListener('pointerdown', (e) => { if (e.pointerType !== 'touch' || stageOn || e.target.closest?.(UI)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) { const [a, b] = [...touches.values()]; pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), m0: view.zoomMul }; drag = null; panDrag = false; } });
  window.addEventListener('pointermove', (e) => { if (!touches.has(e.pointerId)) return; touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) { const [a, b] = [...touches.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y); if (d > 10) setZoom(pinch.m0 * pinch.d0 / d); } });
  const tEnd = (e) => { touches.delete(e.pointerId); if (touches.size < 2) pinch = null; };
  window.addEventListener('pointerup', tEnd); window.addEventListener('pointercancel', tEnd);
  cv.style.touchAction = 'none'; cv.style.cursor = 'grab';
  // 聽整個視窗而不是只聽 canvas:按鈕列、頂端資訊列這些「容器」的空白處蓋在 canvas 上面,從那裡開始拖也要能拖。
  // 只有真的按在按鈕 / 面板 / 資訊框上才不算拖曳
  window.addEventListener('pointerdown', (e) => { if (stageOn || drag || pinch || touches.size > 1 || e.target.closest?.(UI)) return; panDrag = true; drag = { id: e.pointerId, x: e.clientX, y: e.clientY }; cv.style.cursor = 'grabbing'; });
  window.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id || pinch) return;
    const upp = 2 * view.half / innerHeight, dx = (e.clientX - drag.x) * upp, dy = (e.clientY - drag.y) * upp / TILT;
    drag.x = e.clientX; drag.y = e.clientY;
    // 畫面往右 = 世界的 (1,0,-1);畫面往上 = 世界的 (-1,0,-1)。拖曳時地圖跟著手指走,所以目標點往反方向移
    let mx = (-dx - dy) * R, mz = (dx - dy) * R;
    // 超出範圍不硬擋:越往外拖越「重」(橡皮筋),放手後 step() 會把鏡頭彈回範圍內
    const soft = (c, m) => { const over = Math.abs(c + m) - PAN_LIM; return over > 0 && (c + m) * m > 0 ? m / (1 + over * 0.9) : m; };
    mx = soft(camT.x, mx); mz = soft(camT.z, mz);
    pan.x += mx; pan.z += mz; camT.x += mx; camT.z += mz;                        // camT 也直接動,拖起來才不會有延遲
  });
  const end = (e) => { if (drag && e.pointerId === drag.id) { drag = null; panDrag = false; cv.style.cursor = 'grab'; } };
  window.addEventListener('pointerup', end); window.addEventListener('pointercancel', end);
}
let last = performance.now();
function loop(now) { const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt); requestAnimationFrame(loop); }
// 測試用:手動推進時間。fast = true 時只算邏輯和動畫、不繪製(跑整局自動測試用)
window.__tick = (ms = 16, fast = false) => { skipRender = fast; for (let t = 0; t < ms; t += 16) step(0.016); skipRender = false; };

// 兩顆骰子一起擲:各自有自己的起點、旋轉軸和落點,最後停在指定點數朝上
async function rollDice(vals, P = PM()) {
  if (NET.on && NET.started) netSend({ t: 'dice', p: PIECES.indexOf(P), vals });
  diceSpots(P); sfx('dice');
  dice.forEach((d, i) => { d.visible = i < vals.length; });      // 只擲一顆時,第二顆收起來;三顆骰子道具才會有第三顆
  const plan = dice.slice(0, vals.length).map((d, i) => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2);
    return { d, rest: DIE_REST[i], final: yaw.multiply(UPQ[vals[i]]),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.4, Math.random() - 0.5).normalize(),
      from: new THREE.Vector3(DIE_REST[i].x - 1.8 + i * 0.6, 2.8, DIE_REST[i].z - 1.8 - i * 0.4), turns: 6 + i * 2, bounce: 2.5 + i * 0.4 };
  });
  const spin = new THREE.Quaternion();
  await tween(1.0, (k) => {
    const e = ease(k);
    for (const q of plan) {
      q.d.position.lerpVectors(q.from, q.rest, e);
      q.d.position.y = q.rest.y + Math.abs(Math.cos(k * Math.PI * q.bounce)) * (1 - k) * 2.3;   // 落地彈兩下
      spin.setFromAxisAngle(q.axis, (1 - k) * (1 - k) * Math.PI * q.turns);
      q.d.quaternion.copy(q.final).multiply(spin);
    }
  });
  await wait(0.25);
}
const hopTo = (i, P = PM()) => hopOnto(tiles[i].g, P);
// 跳到某一格上(外圈或小路都用這個)。far = 被送進小路時的大跳躍
// 線上同樂:手機自己畫棋盤,所以主機每次移動棋子 / 擲骰 / 改價都要廣播給手機照著做
function hopTarget(g) {
  const ti = tiles.findIndex((t) => t.g === g); if (ti >= 0) return { k: 't', i: ti };
  for (const type in laneTiles) { const lt = laneTiles[type]; if (lt.cell.g === g) return { k: 'c', type }; const pi = lt.path.findIndex((x) => x.g === g); if (pi >= 0) return { k: 'p', type, at: pi + 1 }; }
  return null;
}
const hopGroup = (tgt) => (tgt.k === 't' ? tiles[tgt.i].g : tgt.k === 'c' ? laneTiles[tgt.type].cell.g : laneTiles[tgt.type].path[tgt.at - 1].g);
async function hopOnto(g, P = PM(), far = false) {
  if (NET.on && NET.started) { const tgt = hopTarget(g); if (tgt) netSend({ t: 'hop', p: PIECES.indexOf(P), tgt, far }); }
  const a = P.piece.position.clone(), p = g.position, b = new THREE.Vector3(p.x + P.off.x, TOP, p.z + P.off.z);
  await tween(far ? 0.8 : 0.22, (k) => {
    P.piece.position.lerpVectors(a, b, k);
    P.piece.position.y = TOP + Math.sin(k * Math.PI) * (far ? 2.4 : 0.5);
    P.body.scale.y = 1 + Math.sin(k * Math.PI) * 0.18;
  });
  // 落地把格子壓一下
  sfx(far ? 'coin' : S.players[PIECES.indexOf(P)]?.human ? 'hop' : 'hopAi');
  tween(0.18, (k) => { g.position.y = -Math.sin(k * Math.PI) * 0.06; });
  P.body.scale.y = 1;
}

/* ───────────── 介面 ───────────── */
// 貓咪顧問:只講棋盤上看得到的事實和任務提示,**不預測漲跌**
function advise() {
  const todo = new Set(S.missions.filter((m) => !m.done).map((m) => m.id));
  const held = KEYS.filter((k) => S.hold[k].n > 0);
  const cheap = KEYS.filter((k) => S.price[k] < SECTORS[k].open * 0.97);
  const up = held.find((k) => (S.price[k] * S.hold[k].n - S.hold[k].cost) / S.hold[k].cost >= 0.15);
  if (S.lane?.type === 'jail') return L(`Resting at the police station (${S.lane.wait} rounds left, or pay $${fmt(BAIL)} bail). You cannot trade, but a margin position can still be liquidated.`, `在警察局休息(再 ${S.lane.wait} 回合,或付 $${fmt(BAIL)} 保釋金)。不能買賣,但融資部位一樣可能被斷頭。`);
  if (S.lane?.type === 'ipo') return L('At the private placement booth. Roll to get back on the road.', '在內部認購攤位。擲骰子走回外圈。');
  let d = 0; for (let i = 1; i <= 6; i++) if (TILES[(S.pos + i) % TILES.length] === 'chance') { d = i; break; }
  if (todo.has('profit') && up) return L(`${SECTORS[up].name} is up over 15%. Land on it to take profit.`, `${SECTORS[up].name}已經賺超過 15%,走到它的格子就能獲利了結。`);
  if (todo.has('dip') && cheap.length) return L(`${SECTORS[cheap[0]].name} is below its opening price. Buying it counts as buying the dip.`, `${SECTORS[cheap[0]].name}現在低於開盤價,買進就算逢低買進。`);
  if (todo.has('spread') && held.length < 3) return L(`You hold ${held.length} sector${held.length === 1 ? '' : 's'}. Three different ones spread your risk.`, `你現在持有 ${held.length} 種類股,湊滿 3 種可以分散風險。`);
  if (todo.has('paid')) return L('Telecom and REIT pay the most. Dividends arrive every round; the dividend tile pays a full extra round.', '電信和不動產配息最多,每回合都會配息;走到股息格再多領一次全額。');
  if (todo.has('cash') && S.cash < 2000) return L('Cash is low. Keep $2,000 so you can buy when a chance shows up.', '現金偏低。留 $2,000 以上,好機會出現時才買得起。');
  { let best = null;                                           // 對手裡融資維持率最低的那一檔
    for (const p of others()) for (const k of KEYS) if (p.hold[k].loan > 0) { const r = acctRatio(p); if (!best || r < best.r) best = { p, k, r }; }
    if (best) { const drop = Math.max(1, Math.ceil((1 - MAINT / best.r) * 100));
      return L(`${nameOf(best.p)} bought ${SECTORS[best.k].name} on margin (ratio ${Math.round(best.r * 100)}%). A ${drop}% drop forces it to sell.`, `${nameOf(best.p)}用融資買了${SECTORS[best.k].name},維持率 ${Math.round(best.r * 100)}%。再跌 ${drop}% 就會被強迫平倉。`); } }
  { const my = KEYS.filter((k) => S.hold[k].loan > 0)[0], ar = acctRatio(S.players[S.hi]); if (my && ar < 1.5)
    return L(`Careful: your margin ratio is ${Math.round(ar * 100)}%. Below 130% your margin positions are sold for you.`, `小心:你的融資維持率只剩 ${Math.round(ar * 100)}%,跌破 130% 會被強迫平倉。`); }
  { const sq = KEYS.filter((k) => S.short[k].n > 0 && squeezeGap(S.short[k], k) < 12)[0];
    if (sq) return L(`Careful: your ${SECTORS[sq].name} short is squeezed if it rises ${Math.max(1, Math.ceil(squeezeGap(S.short[sq], sq)))}% more.`, `小心:你放空的${SECTORS[sq].name}再漲 ${Math.max(1, Math.ceil(squeezeGap(S.short[sq], sq)))}% 就會被軋空。`); }
  { let best = null;                                           // 對手裡最接近被軋空的那一檔
    for (const p of others()) for (const k of KEYS) if (p.short[k].n > 0) { const g = squeezeGap(p.short[k], k); if (!best || g < best.g) best = { p, k, g }; }
    if (best) return L(`${nameOf(best.p)} is short ${SECTORS[best.k].name}. Push it up ${Math.max(1, Math.ceil(best.g))}% (buy it, or play a good-news card) and it is squeezed.`, `${nameOf(best.p)}放空了${SECTORS[best.k].name}。把它推高 ${Math.max(1, Math.ceil(best.g))}%(買進,或用利多事件卡)就能軋掉。`); }
  if (S.bag.includes('atk')) { let best = null;
    for (const p of others()) for (const k of KEYS) if (p.hold[k].n > 0) { const v = p.hold[k].n * S.price[k]; if (!best || v > best.v) best = { p, k, v }; }
    if (best) return L(`${nameOf(best.p)} holds a lot of ${SECTORS[best.k].name}. A bad news card would hit it.`, `${nameOf(best.p)}持有不少${SECTORS[best.k].name},用利空消息卡可以打擊。`); }
  const card = S.bag.find((id) => id.startsWith('ev'));
  if (card) { const it = itemInfo(card), sec = SECTORS[it.best];
    return S.hold[it.best].n > 0
      ? L(`You hold ${sec.name} and a card that lifts it. Open your backpack to play it.`, `你持有${sec.name},背包裡有一張會讓它上漲的事件卡,可以打開背包使用。`)
      : L(`Your event card lifts ${sec.name}. Buy that sector first, then play the card.`, `你的事件卡會讓${sec.name}上漲。先買進那個類股,再使用卡片。`); }
  if (d) return L(`A market event is ${d} step${d > 1 ? 's' : ''} ahead. Every price may move.`, `前方第 ${d} 格是市場事件,所有價格都可能變動。`);
  return L('No one knows the next roll. Spread out and keep some cash.', '沒有人知道下一步會擲出幾點,分散持股、留點現金最穩。');
}
// 融資部位的小標:維持率,低於 150% 用紅字警告
const marginTag = (h, k, p) => { if (!(h.loan > 0)) return ''; const r = p ? acctRatio(p) : ENG.ratioOf(S, h, k); return ` <b style="color:${r < 1.5 ? '#c4472f' : '#8a5cf5'}">${L('M', '融')}${Math.round(r * 100)}%</b>`; };
const squeezeTag = (h, k) => { const g = Math.max(0, squeezeGap(h, k)); return ` <b style="color:${g < 10 ? '#c4472f' : '#8a5cf5'}">${L('sq', '軋')}+${Math.ceil(g)}%</b>`; };
const debtRow = (d) => (d > 0 ? `<div class="row"><i style="background:#4a63b0"></i><span>${L('Bank loan', '銀行貸款')}</span><span></span><span style="color:#c4472f">-${fmt(d)}</span></div>` : '');
// 資產框上面那排頭像:每局開始時依人數建一次。點誰就看誰的資產
// 「我」:這台裝置上的真人(主機自己);4 支手機都加入、主機只當螢幕時就是第一位
let CLIENT_ME = -1;      // 手機端:自己是第幾位
const meP = () => (CLIENT_ME >= 0 && S.players[CLIENT_ME]) || S.players.find((p) => p.human && !p.remote) || S.players[0];
function buildFoes() {
  const el = $('assetTabs'); el.innerHTML = '';
  S.players.filter((p) => p !== meP()).forEach((p) => {      // 直排只放對手;自己是左上那顆頭像。每列:頭像(右下角名次)| 股票鈕(看他的資產)
    const row = document.createElement('div'); row.className = 'otab'; row.dataset.i = p.i;
    row.innerHTML = `<span class="pava" data-i="${p.i}" title="${nameOf(p)}"><b class="rk"></b></span><button class="stockbtn" data-i="${p.i}" aria-label="${nameOf(p)}"><svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="11" width="5" height="10" rx="1.5"/><rect x="9.5" y="5" width="5" height="16" rx="1.5"/><rect x="16" y="9" width="5" height="12" rx="1.5"/></svg></button>`;
    row.querySelector('button').onclick = () => { const box = $('assetBox'); if (!box.classList.contains('fold') && S.view === p.i) box.classList.add('fold'); else { S.view = p.i; box.classList.remove('fold'); } hud(); };   // 點同一個再點一次就收起
    el.appendChild(row);
  });
}
// 資產清單的 HTML(資產框和手機遙控頁共用)。每檔持股在市值底下帶一行「+/- 多少」(市值 − 買進成本),放空則直接顯示損益;最後一行是全部加總的未實現損益
function assetRowsHtml(A, mine) {
  const held = KEYS.filter((k) => A.hold[k].n > 0).sort((x, y) => A.hold[y].n * S.price[y] - A.hold[x].n * S.price[x]);
  const plTxt = (pl) => `<small style="display:block;font-size:.85em;color:${pl >= 0 ? '#1c8a4a' : '#c4472f'}">${pl >= 0 ? '+' : '-'}${fmt(Math.abs(pl))}</small>`;
  let totPL = 0;
  const stockV = KEYS.reduce((a, k) => a + A.hold[k].n * S.price[k], 0);
  return `<div class="row"><i style="background:#57b86b"></i><span>${L('Cash', '現金')}</span><span></span><span>${fmt(A.cash)}</span></div>` +
    `<div class="row"><i style="background:#4aa8ff"></i><span>${L('Stocks', '股票市值')}</span><span></span><span>${fmt(stockV)}</span></div>` +
    `<div class="row"><i style="background:#ffb000"></i><span>${L('Total assets', '總資產')}</span><span></span><b>${fmt(assetsOf(A))}</b></div>` + debtRow(A.debt) +
      (held.length ? held.map((k) => { const h = A.hold[k], pl = h.n * S.price[k] - h.cost; totPL += pl;
        return `<div class="row"><i style="background:${SECTORS[k].css}"></i><span>${SECTORS[k].code}</span><span class="q">${h.n} ${L('sh', '股')}${marginTag(h, k, A)}${ENG.lockedN(S, h) ? ` 🔒${ENG.lockedN(S, h)}` : ''}</span><span style="text-align:right">${fmt(h.n * S.price[k])}${plTxt(pl)}</span></div>`; }).join('')
        : `<div class="row" style="display:block;color:#9a8676;font-weight:600">${L('No holdings yet', '還沒有持股')}</div>`) +
      KEYS.filter((k) => A.short[k].n > 0).map((k) => { const pl = (A.short[k].entry - S.price[k]) * A.short[k].n; totPL += pl;
        return `<div class="row"><i style="background:${SECTORS[k].css}"></i><span>${SECTORS[k].code}</span><span class="q">${L('short', '空')} ${A.short[k].n}${squeezeTag(A.short[k], k)}</span><span style="color:${pl >= 0 ? '#1c8a4a' : '#c4472f'}">${pl >= 0 ? '+' : '-'}${fmt(Math.abs(pl))}</span></div>`; }).join('') +
      (held.length || KEYS.some((k) => A.short[k].n > 0) ? `<div class="row"><i style="background:${totPL >= 0 ? '#1c8a4a' : '#c4472f'}"></i><span>${L('Unrealized P/L', '未實現損益')}</span><span></span><span style="color:${totPL >= 0 ? '#1c8a4a' : '#c4472f'}">${totPL >= 0 ? '+' : '-'}${fmt(Math.abs(totPL))}</span></div>` : '') +
      '';   // 對手手上有什麼道具永遠不顯示
}
// 任務清單的 HTML(主機自己和手機都用)
const missHtml = (p) => {
  const pend = (p.missions || []).map((m) => `<div class="m ${m.done ? 'done' : ''}"><span class="ck">${m.done ? '✓' : ''}</span><span>${m.title}<small>${m.sub}</small></span></div>`).join('');
  // 已完成:最新的排前面;同一系列(chain)只留一列,顯示做到的最高等級(依完成順序,最新的那筆就是最高等級)
  const ids = (p.doneIds || []).slice().reverse(), titles = (p.doneList || []).slice().reverse(), seenChain = new Set(), rows = [];
  ids.forEach((id, i) => { const d = MISSION_BY_ID[id]; if (d && d.chain) { if (seenChain.has(d.chain)) return; seenChain.add(d.chain); } rows.push(titles[i]); });   // 標題完成時就存好了(含 Lv.N);不要呼叫 make(),有些會重設旗標
  const done = rows.map((t) => `<div class="m done old"><span class="ck">✓</span><span>${t}</span></div>`).join('') || `<div class="sub">${L('Nothing completed yet', '還沒有完成的成就')}</div>`;
  const pendOrAll = pend || `<div class="sub">${L('All achievements done!', '所有成就都完成了!')}</div>`;
  // 上面兩個分頁:進行中 / 已完成(哪一頁開著記在 #missBox 的 data-tab,重畫不會跳掉)
  return `<div class="mtabs"><button data-mt="pend">${L('Active', '進行中')}</button><button data-mt="done">${L('Done', '已完成')} ${(p.doneList || []).length ? `<i>${(p.doneList || []).length}</i>` : ''}</button></div><div class="mpend">${pendOrAll}</div><div class="mdone">${done}</div>`;
};
const ordinal = (n) => n + (['th', 'st', 'nd', 'rd'][n % 10 > 3 ? 0 : n % 10] || 'th');      // 1st 2nd 3rd 4th
const rankOf = (p) => { const a = assetsOf(p); return 1 + S.players.filter((q) => assetsOf(q) > a + 0.5).length; };
function hud() {
  // 上方資訊列跟著「現在輪到誰」:電腦在走的時候顯示牠的現金、總資產、股票市值和背包(左上頭像也會換成牠)
  { const T = meP();      // 左上頭像 + 現金永遠是自己的
    $('cash').textContent = fmt(T.cash); $('avaMe').classList.toggle('turn', S.turn === T.i);
    $('assets').textContent = fmt(assetsOf(T));
    $('stocks').textContent = fmt(KEYS.reduce((a, k) => a + T.hold[k].n * S.price[k], 0));
    $('bagCount').textContent = T.bag.length;
  }
  // 目前名次:依總資產排(同分算同名次)。回合條旁邊顯示;手機沒有回合條,所以擲骰鈕底下也帶一份
  const myA = assetsOf(meP()), rank = 1 + S.players.filter((p) => assetsOf(p) > myA + 0.5).length;   // 名次也是自己的,不跟著輪到誰
  $('rankTxt').textContent = ordinal(rank); $('rankTxt').classList.toggle('top', rank === 1); $('crown').classList.toggle('hide', rank !== 1);

  document.querySelectorAll('#dsel button').forEach((b) => b.classList.toggle('on', +b.dataset.n === S.diceN));
  { const rest = S.lane && S.lane.type === 'jail' && S.lane.wait > 0;   // 擲骰鈕:沒有字,骰子顆數跟著選擇(小路上也能選);休息中才顯示文字
    $('rollTxt').textContent = rest ? L('REST', '休息中') : ''; $('rollDice').className = 'dice ' + (rest ? 'rest' : S.diceN === 1 ? 'one' : 'two');
    $('dsel').style.visibility = rest ? 'hidden' : ''; }
  { const T = meP();    // 任務清單永遠是自己的(每位玩家各自抽 3 個;以前跟著輪到誰,手機玩家走的時候主機會看到他的)
    $('missTitle').textContent = L(`Achievements · ${T.done} unlocked`, `任務 · 完成 ${T.done}`); $('missBadge').textContent = (T.missions || []).filter((m) => !m.done).length;
    $('miss').innerHTML = missHtml(T); }
  { const t = advise(); if ($('tip').textContent !== t) { $('tip').textContent = t; const tb = $('tipbar'); if (tb) { tb.classList.remove('pulse'); void tb.offsetWidth; tb.classList.add('pulse'); } } }
  // 資產框:一次只顯示一位。預設跟著「現在輪到誰」;點上面的頭像可以改看別人(下一位開始走的時候會自動切回去)
  { const T = meP(); if (S.view != null && S.view !== T.i && !spyOn(T, S.players[S.view])) { S.view = null; $('assetBox').classList.add('fold'); }   // 偵查到期:對手的資產框收起
    const A = S.players[S.view ?? T.i] || S.players[S.hi], mine = A.i === S.hi;      // 資產框預設看自己,用了偵查報告才能看對手
    $('assetTitle').textContent = (isYou(A) ? L('My assets', '我的資產') : L(`${nameOf(A)}'s assets`, `${nameOf(A)}的資產`)) + ' · $' + fmt(assetsOf(A)) + (A.i !== T.i ? ` · 🔍${spyLeft(T)}` : '');
    document.querySelectorAll('#assetTabs .otab').forEach((row) => { const q = S.players[+row.dataset.i]; const sb = row.querySelector('button'); sb.classList.toggle('on', q.i === A.i); sb.classList.toggle('hide', !spyOn(T, q)); row.querySelector('.pava').classList.toggle('turn', q.i === S.turn);
      const r = rankOf(q), rk = row.querySelector('.rk'); rk.textContent = ordinal(r); rk.classList.toggle('top', r === 1); });
    $('assetRows').innerHTML = assetRowsHtml(A, mine); }
  const e = S.lastEvent;

  { const up = (S.trend ?? MARKET_DRIFT) >= 0; $('evtBox').classList.toggle('mk-up', up); $('evtBox').classList.toggle('mk-dn', !up); }   // 市場事件框的標題列:大盤漲綠色、跌紅色
  // 大盤趨勢(每回合的方向)和這張卡讓 ETF 漲跌多少是兩回事:只有總體大事會改趨勢,產業新聞不改,底下用一行小字講清楚
  const tnote = !e || e.special ? '' : e.trend != null ? L('This news changed the market trend', '這則新聞改變了大盤趨勢') : L('Only some sectors move; market trend unchanged', '只影響部分產業,大盤趨勢不變');
  $('evtBody').innerHTML = `<div class="trendbox"><div class="mvrow trend"><span>${L('Market trend', '大盤趨勢')}</span><span style="color:${(S.trend ?? MARKET_DRIFT) >= 0 ? '#1c8a4a' : '#c4472f'}">${trendTxt(S.trend ?? MARKET_DRIFT)}</span></div>${tnote ? `<div class="tnote">${tnote}</div>` : ''}</div>` + (e
    ? `<div>${e.t}</div><div class="why">${e.w}</div>` + (e.cash ? `<div class="mvrow"><span>${L('Everyone', '每位玩家')}</span><span style="color:#1c8a4a">+$${fmt(e.cash)}</span></div>` : '') + KEYS.filter((k) => Math.round((e.m[k] - 1) * 100)).sort((x, y) => Math.abs(e.m[y] - 1) - Math.abs(e.m[x] - 1)).slice(0, 7).map((k) => { const d = Math.round((e.m[k] - 1) * 100);   // 只列變動最大的 7 檔,不然面板會蓋到任務
        return `<div class="mvrow"><span>${SECTORS[k].code}</span><span style="color:${d > 0 ? '#1c8a4a' : '#c4472f'}">${d > 0 ? '+' : ''}${d}% ${d > 0 ? '▲' : '▼'}</span></div>`; }).join('')
    : `<div class="why">${L('No event yet. Land on a ? tile to draw one.', '還沒有事件。走到「?」格會抽一張。')}</div>`);
  $('roundTxt').textContent = L(`Round ${S.rolls} / ${maxRolls()}`, `回合 ${S.rolls} / ${maxRolls()}`);
  netHud();
}
function staticText() {
  document.documentElement.lang = ZH ? 'zh-Hant' : 'en';
  document.documentElement.dataset.title = L('Cat Street Stocks', '貓咪股市大富翁');   // 分頁標題的動畫(index.html)會接在這段文字後面
  $('lblAssets').textContent = L('Total assets', '總資產'); $('lblStocks').textContent = L('Stocks', '股票市值'); 
  { // 擲幾顆骰子的切換:直接畫骰子圖(一顆 = 一個骰子,兩顆 = 兩個骰子),比文字直覺
    // 骰子圖示:實心的骰子(選中時白底橘點、未選時淺底),點數用 5 和 2 / 3,看起來才像骰子而不是一個方框
    const die = (x, pips, tilt) => `<g transform="rotate(${tilt} ${x + 11} 11)"><rect x="${x + 1.5}" y="1.5" width="19" height="19" rx="5.5" fill="currentColor" opacity=".95"/>` +
      pips.map(([px, py]) => `<circle cx="${x + px}" cy="${py}" r="2.2" class="pip"/>`).join('') + '</g>';
    $('d1').innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${die(1, [[6.5, 6.5], [15.5, 6.5], [11, 11], [6.5, 15.5], [15.5, 15.5]], -8)}</svg>`;
    $('d2').innerHTML = `<svg viewBox="0 0 50 24" aria-hidden="true">${die(1, [[7, 7], [15, 15]], -10)}${die(27, [[7, 7], [11, 11], [15, 15]], 8)}</svg>`;
    $('d1').setAttribute('aria-label', L('Roll 1 die', '擲 1 顆骰子')); $('d2').setAttribute('aria-label', L('Roll 2 dice', '擲 2 顆骰子')); } $('rollBtn').setAttribute('aria-label', L('Roll', '擲骰子'));
  $('assetTitle').textContent = L('My assets', '我的資產'); $('evtTitle').textContent = L('Market event', '市場事件');
  // 頁尾加上版本號(取 board.mjs?v=N 的 N),方便確認拿到的是不是最新版
  $('note').textContent = '';      // 畫面底下不再放字(省空間);聲明、音樂出處和版本改放在結算畫面
}
let toastTimer;
// 成就達成:畫面上方跳出一張卡(自己的在自己這台;手機玩家的送到他手機上),2.6 秒後收起
let achvTimer = 0;
function showAchv(p, title) {
  const msg = L('Achievement unlocked', '成就達成');
  if (p.remote) { const g = NET.guests.find((x) => x.gid === p.remote); if (g && g.conn) netSend({ t: 'achv', title }, g.conn); return; }
  if (p !== meP()) { toast(L(`${nameOf(p)}: ${title} +$${REWARD}`, `${nameOf(p)}達成「${title}」+$${REWARD}`)); return; }
  achvPop(title);
}
function achvPop(title) { const el = $('achv'); el.innerHTML = `<b><img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L('Achievement unlocked', '成就達成')}</b><span>${title} · +$${REWARD}</span>`; el.classList.add('on'); clearTimeout(achvTimer); achvTimer = setTimeout(() => el.classList.remove('on'), 2600); }
function toast(msg) { netSend({ t: 'toast', msg }); const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1900); }
function showCtl(on) { $('ctl').classList.toggle('hide', !on); $('tipbar').classList.toggle('hide', !on); $('stepCtl').classList.add('hide'); }   // 提示泡泡跟擲骰鈕一起出現 / 隱藏,抽卡時才不會擋到
function panel(html) { const p = $('panel'); p.innerHTML = html; p.classList.remove('hide'); p.classList.toggle('over', !!(S && S.over)); return p; }
const closePanel = () => $('panel').classList.add('hide');

// 買賣面板:一條拉桿選股數(10 ~ 50 股,每 10 股一格),底下四顆按鈕:買進、融資買、放空、賣出(有空單時「放空」變成「回補」)。
// 按鈕上的金額和價格影響會跟著拉桿即時變
function buyPanel(k) {
  return new Promise((res) => {
    const sec = SECTORS[k], h = S.hold[k], sh = S.short[k], price = S.price[k], lockN = ENG.lockedN(S, h), free = h.n - lockN;   // 內部認購鎖住的股數不能賣
    const gain = h.n ? (price * h.n - h.cost) / h.cost * 100 : 0;
    const spl = sh.n ? (sh.entry - price) / sh.entry * 100 : 0;
    const vs = (price / sec.open - 1) * 100, ratio = acctRatio(S.players[S.hi]);
    // 對手的持股只有「正在偵查的那位」看得到(其他人的持股是秘密)
    const me = S.players[S.hi], spied = (p) => me.spy && S.rolls < me.spy.until && me.spy.target === p.i;
    const rivalTxt = others().filter(spied).map((p) => { const rh = p.hold[k], rs = p.short[k], nm = nameOf(p);
      return (rh.n ? ` <b style="color:#c4472f">${L(`${nm} holds ${rh.n}`, `${nm}持有 ${rh.n} 股`)}${rh.loan > 0 ? L(` on margin (ratio ${Math.round(acctRatio(p) * 100)}%)`, `(融資,維持率 ${Math.round(acctRatio(p) * 100)}%)`) : ''}${L('.', '。')}</b>` : '') +
        (rs.n ? ` <b style="color:#8a5cf5">${L(`${nm} is short ${rs.n}: a ${Math.max(1, Math.ceil(squeezeGap(rs, k)))}% rise squeezes it out.`, `${nm}放空 ${rs.n} 股,再漲 ${Math.max(1, Math.ceil(squeezeGap(rs, k)))}% 會被軋空。`)}</b>` : ''); }).join('');
    const p = panel(`
      <h3><span class="tag" style="background:${sec.css}">${sec.code}</span>${sec.name}
        <span class="help" tabindex="0" aria-label="${L('How trading works', '買賣說明')}"><i>?</i><span class="tip">${L('Your own trade moves the price, and you trade at the moved price: buying 30 shares pushes it up 12% and you pay that higher price. Selling and shorting push it down the same way.', '自己的買賣會推動股價,而且是用推動後的價格成交:買 30 股推高 12%,你就付漲 12% 之後的價格。賣出和放空同樣是用壓低後的價格成交。')}<br><br>
          <b>${L('Margin', '融資')}</b>${L(': pay 40% and borrow 60%. The ratio is account-wide: all your holdings\' value ÷ all your loans. Only if it falls below 130% are margin positions sold (worst first). Interest is 2% of the loan each lap.', ':自備 4 成、借 6 成。維持率看整個帳戶:全部持股市值 ÷ 全部借款,跌破 130% 才會強迫平倉(先砍最差的那檔);每圈付借款 2% 的利息。')}<br><br>
          <b>${L('Short', '放空')}</b>${L(': sell borrowed shares, buy back later. You win if the price falls. If it rises 30% above your entry you are squeezed: forced to buy back at the high price.', ':先借股票賣掉、之後買回來還,跌了你賺、漲了你賠。比進場價漲超過 30% 會被軋空:強迫用高價買回。')}</span></span></h3>
      <p>${sec.blurb}${divNote(k)}${rivalTxt}</p>
      <div class="kv">
        <div>${L('Price', '股價')}<b>$${Math.round(price)}</b></div>
        <div>${L('Since open', '相對開盤')}<b style="color:${vs >= 0 ? '#1c8a4a' : '#c4472f'}">${vs >= 0 ? '+' : ''}${vs.toFixed(0)}%</b></div>
        <div>${sh.n ? L('Short', '放空') : h.loan > 0 ? L('Margin', '融資持有') : L('You hold', '持有')}<b>${sh.n || h.n}${(sh.n || h.n) ? ` <span style="font-size:calc(11px * var(--fs));color:${(sh.n ? spl : gain) >= 0 ? '#1c8a4a' : '#c4472f'}">${(sh.n ? spl : gain) >= 0 ? '+' : ''}${(sh.n ? spl : gain).toFixed(0)}%</span>` : ''}${h.loan > 0 ? `<span style="display:block;font-size:calc(11px * var(--fs));color:${ratio < 1.5 ? '#c4472f' : '#8a786c'}">${L('ratio', '維持率')} ${Math.round(ratio * 100)}%</span>` : ''}</b></div>
      </div>
      <div class="slider"><span>${L('Shares', '股數')}</span><input type="range" id="qty" min="10" max="50" step="10" value="10"><b id="qtyVal"></b></div>
      <div class="btns grid2">
        <button class="b-buy" data-a="buy" ${sh.n ? 'disabled' : ''}>${L('Buy', '買進')}<br><span id="tBuy"></span></button>
        <button class="b-margin" data-a="margin" ${sh.n ? 'disabled' : ''}>${L('Margin', '融資買')}<br><span id="tMargin"></span></button>
        ${sh.n
          ? `<button class="b-ok" data-a="cover">${L('Cover', '回補')}<br><span>${coverBack(k, sh) >= sh.entry * sh.n ? '+' : '-'}$${fmt(Math.abs(coverBack(k, sh) - sh.entry * sh.n))}</span></button>`
          : `<button class="b-short" data-a="short" ${h.n ? 'disabled' : ''}>${L('Short', '放空')}<br><span id="tShort"></span></button>`}
        <button class="b-sell" data-a="sell" ${free ? '' : 'disabled'}>${L('Sell', '賣出')}<br><span id="tSell"></span></button>
      </div>
      <div class="btns" style="margin-top:8px"><button class="b-skip" data-a="skip">${L('Skip', '跳過')}</button></div>`);
    const qty = $('qty'), n = () => +qty.value;
    // 拉桿一動,四顆按鈕的金額、價格影響、能不能按都跟著更新
    const paint = () => {
      const q = n(), cost = fillAt(k, buyF(q)) * q, sellN = Math.min(q, free), shortCost = fillAt(k, shortF(q)) * q;
      $('qtyVal').textContent = L(`${q} shares · $${fmt(cost)}`, `${q} 股 · $${fmt(cost)}`);
      $('tBuy').textContent = `$${fmt(cost)} ${pct(buyF(q))}`; p.querySelector('[data-a=buy]').disabled = !!sh.n || S.cash < cost;
      $('tMargin').textContent = `${L('pay', '自備')} $${fmt(cost * (1 - MARGIN_LOAN))}`; p.querySelector('[data-a=margin]').disabled = !!sh.n || S.cash < cost * (1 - MARGIN_LOAN);
      if ($('tShort')) { $('tShort').textContent = `$${fmt(shortCost)} ${pct(shortF(q))}`; p.querySelector('[data-a=short]').disabled = !!h.n || S.cash < shortCost; }
      $('tSell').textContent = free ? `${sellN} ${L('sh', '股')} ${pct(sellF(sellN))}` : lockN ? `🔒 ${h.lockUntil - S.rolls}${L('r', '回合')}` : '—';
    };
    qty.oninput = paint; paint();
    p.querySelectorAll('button').forEach((b) => b.onclick = () => {
      const a = b.dataset.a, q = n(), me = S.players[S.hi], nm = nameOf(me);
      // 規則在遊戲引擎裡算(成交價、融資、成就旗標、推動股價、斷頭檢查);這裡只負責音效和公告
      // 公告大家都看得到:只說做了什麼,不寫股數和金額
      if (a === 'buy' || a === 'margin') {
        ENG.buy(S, me, k, q, a === 'margin'); sfx('buy');
        toast(a === 'margin' ? L(`${nm} margin-bought ${sec.name}. Price ${pct(buyF(q))}`, `${nm}融資買進${sec.name},股價被推高 ${pct(buyF(q))}`)
          : L(`${nm} bought ${sec.name}. Price ${pct(buyF(q))}`, `${nm}買進${sec.name},股價被推高 ${pct(buyF(q))}`));
      } else if (a === 'sell') {
        const r = ENG.sell(S, me, k, q); sfx('sell');      // 賣拉桿上的股數(不夠就全賣),借款按比例一起還
        if (r) toast(L(`${nm} sold ${sec.name}. Price ${pct(sellF(r.n))}`, `${nm}賣出${sec.name},股價 ${pct(sellF(r.n))}`));
      } else if (a === 'short') {
        ENG.short(S, me, k, q); sfx('short');
        toast(L(`${nm} shorted ${sec.name}. Price ${pct(shortF(q))}`, `${nm}放空${sec.name},股價被壓低 ${pct(shortF(q))}`));
      } else if (a === 'cover') {
        const r = ENG.cover(S, me, k); sfx('sell');
        if (r) toast(L(`${nm} covered the ${sec.name} short. Price ${pct(buyF(r.n))}`, `${nm}回補${sec.name}空單,股價 ${pct(buyF(r.n))}`));
      }
      pubNote(S.players[S.hi], k);                                   // 交易都有公告,記進公開帳本
      drawAll(); hud(); closePanel(); res();
    });
  });
}
function cardPanel(title, text, moves = '', auto = 0) {
  return new Promise((res) => {
    const p = panel(`<h3>${title}</h3><p>${text}</p>${moves ? `<div class="moves">${moves}</div>` : ''}<div class="btns"><button class="b-ok">${L('Continue', '繼續')}</button></div>`);
    let done = false;
    const go = () => { if (done) return; done = true; closePanel(); res(); };
    p.querySelector('button').onclick = go;
    if (auto > 0) wait(auto).then(go);
  });
}
const AI_CARD_WAIT = 3;       // 電腦出牌後,說明卡停留幾秒

/* ───────────── 回合流程(狀態機:idle → rolling → moving → landing → idle / over) ───────────── */
// 起點:薪水 + 股利;對面的「股息結算」格:只發股利
// 每回合配息:新的一回合開始時,每位玩家依持股領年率 1/4 的股利(自己的顯示提示,手機玩家各自收到自己的)
function roundDividends() { showDividends(ENG.roundDividends(S)); }
// 每回合配息的提示(金額由引擎算、入帳):自己的跳在畫面上,遠端玩家的送到他的手機
function showDividends(paid) {
  for (const { p, div } of paid) {
    const msg = L(`Dividends +$${fmt(div)}`, `配息 +$${fmt(div)}`);
    if (p === meP()) { const t = $('toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 1900); }
    else if (p.remote) { const g = NET.guests.find((x) => x.gid === p.remote); if (g && g.conn) netSend({ t: 'toast', msg }, g.conn); }
  }
  if (S.players.some((p) => p.human && KEYS.some((k) => p.hold[k].n > 0))) sfx('coin');
  hud();
}
// 起點:薪水(升職加薪時加倍)、付融資和貸款利息;股息格:全額股利。金額由引擎算,這裡負責音效和提示
function payday(atStart = true) { paydayUI(ENG.payday(S, S.players[S.hi], atStart), atStart); }
// 發薪 / 股利的提示(金額已經由引擎算好、入帳)
function paydayUI({ salary, div, interest, bank }, atStart) {
  sfx('coin');
  if (atStart) S.players[S.hi].lastSalary = salary;      // 發薪日卡片顯示實際領到的(升職加薪是兩倍)
  toast((salary ? L('Payday', '發薪日') + ` +$${fmt(salary)}` : `${L('dividends', '股利')} +$${fmt(div)}`) + (interest ? ` · ${L('margin interest', '融資利息')} -$${fmt(interest)}` : '') + (bank ? ` · ${L('loan interest', '貸款利息')} -$${fmt(bank)}` : ''));
  hud(); checkMissions();
}
// 檢查 S.hi 那位玩家的成就(S.cash / S.hold / S.missions 等捷徑都指向他)。回傳這次新達成的標題
function evalMissions() {
  // 上一次完成的任務先換成新的(所以完成的那張會亮綠色停留到下一次檢查)
  if (assets() < 8000) S.flags.low = true;   // 逆風翻盤用:曾經跌破 $8,000
  S.missions = S.missions.filter((m) => !m.done);   // 上一次完成的(綠色那張)這時才拿掉
  const got = [];
  S.missions.forEach((m) => { if (!m.done && m.ok()) { m.done = true; S.done++; const me = S.players[S.hi]; (me.doneList ||= []).push(m.title); (me.doneIds ||= []).push(m.id); S.cash += REWARD; got.push(m.title); } });
  refillMissions(S.players[S.hi]);   // 階梯式的下一階在這裡補進來
  return got;
}
function checkMissions() {
  const me = S.players[S.hi], got = evalMissions();
  got.forEach((t) => { sfx('mission'); showAchv(me, t); });
  hud();
}
// 電腦也照同樣規則拿成就(每個 +$500):把 S.hi 暫時指到牠檢查,一次達成好幾個就合併成一則公告
function checkBotMissions(only) {
  const keep = S.hi; let total = 0;
  for (const p of S.players) { if (p.human || (only && p !== only)) continue;
    S.hi = p.i; let got; try { got = evalMissions(); } finally { S.hi = keep; }
    if (got.length === 1) showAchv(p, got[0]);
    else if (got.length > 1) toast(L(`${nameOf(p)} unlocked ${got.length} achievements +$${fmt(REWARD * got.length)}`, `${nameOf(p)}達成 ${got.length} 個成就 +$${fmt(REWARD * got.length)}`));
    total += got.length; }
  hud(); return total;
}
// 市場事件格:桌上發三張背面朝上的牌,玩家自己挑一張翻開(對手走到時由牠自動挑)。
// 翻開的那張生效;另外兩張隨後也翻開,讓你看到「本來可能抽到什麼」。計時用遊戲自己的時鐘(wait),測試時可以快轉
// auto = 電腦抽(自動挑、自動繼續);round = 一輪結束系統抽(同樣自動)。警察局、內部認購是命運牌,不會出現在這裡
function drawEventCards(auto, round = false, special = !round) {     // special=false:這次不混特殊牌(回合事件、小路上的事件)
  return new Promise((res) => {
    const picks = EVENTS.slice().sort(() => Math.random() - 0.5).slice(0, 3).map(instantiate), who = CHARS[S.foe].name;
    const face = (e) => {
      const top = KEYS.filter((k) => Math.round((e.m[k] - 1) * 100) && !(e.divKeys || []).includes(k)).sort((x, y) => Math.abs(e.m[y] - 1) - Math.abs(e.m[x] - 1)).slice(0, 6);
      if (e.special) return `<div class="dhead ${e.special === 'ipo' ? 'good' : 'bad'}">${e.t}</div><div class="dwhy">${e.w}</div><div class="dmv">` +
        (e.special === 'ipo' ? `<span class="mv up">${L('IPO lane', '進入 IPO 小路')}</span>` : `<span class="mv dn">${L('Detention lane', '送進拘留小路')}</span>`) + '</div>';
      return `<div class="dhead ${evGood(e) ? 'good' : 'bad'}">${e.t}</div><div class="dwhy">${e.w}</div><div class="dmv">` + cashChip(e) +
        top.map((k) => { const d = Math.round((e.m[k] - 1) * 100); return `<span class="mv ${d > 0 ? 'up' : 'dn'}">${SECTORS[k].code} ${d > 0 ? '+' : ''}${d}%</span>`; }).join('') + '</div>';
    };
    const ov = $('draw');
    ov.innerHTML = `<h2>${round ? L(`Round ${S.rolls} is over: market event`, `第 ${S.rolls} 回合結束,市場事件`) : auto ? L(`${who} draws a market event`, `${who}抽市場事件`) : L('Pick a card', '抽一張市場事件')}</h2>` +
      `<div class="dcards">${picks.map((e, i) => `<div class="dcard" data-i="${i}" style="--i:${i}"><div class="dinner"><div class="dback"><span>?</span></div><div class="dfront">${face(e)}</div></div></div>`).join('')}</div>` +
      `<button class="dgo hide" id="dgo">${L('Continue', '繼續')}</button>`;
    ov.classList.remove('hide'); ov.classList.toggle('auto', !!auto); fitCards(ov);
    const cards = [...ov.querySelectorAll('.dcard')]; let chosen = -1;
    const choose = (i) => {
      if (chosen >= 0) return;
      chosen = i; ov.classList.add('done'); cards[i].classList.add('flip', 'picked'); sfx('flip');
      const e = picks[i];
      wait(0.45).then(() => sfx(e.special ? (e.special === 'ipo' ? 'good' : 'bad') : evGood(e) ? 'good' : 'bad'));
      if (!e.special) applyEvent(e);
      drawAll(); hud();
      wait(0.9).then(() => {
        cards.forEach((c, j) => { if (j !== i) c.classList.add('flip', 'lost'); }); $('dgo').classList.remove('hide');
        // 對手抽的牌:給你 2 秒看完事件,然後自動按「繼續」(想快一點也可以自己先按)
        if (auto) wait(2).then(() => { if (!done) $('dgo').click(); });
      });
    };
    cards.forEach((c, i) => { c.onclick = () => { if (!auto) choose(i); }; });
    if (auto) wait(1.2).then(() => choose(Math.floor(Math.random() * 3)));
    let done = false;
    $('dgo').onclick = () => { if (done) return; done = true; ov.classList.add('hide'); ov.classList.remove('done'); res(picks[chosen]); };
  });
}
// actor:從背包打出事件卡的人(這張牌造成的斷頭 / 軋空算他的成就);回合事件、市場事件格不傳
async function playEvent(e, auto = 0, actor = null) {
  if (actor) ENG.withActor(S, actor, () => applyEvent(e)); else applyEvent(e);
  drawAll(); hud(); sfx(evGood(e) ? 'good' : 'bad');
  const moves = cashChip(e) + KEYS.map((k) => { const d = Math.round((e.m[k] - 1) * 100); return d && !(e.divKeys || []).includes(k) ? `<span class="mv ${d > 0 ? 'up' : 'dn'}">${SECTORS[k].name} ${d > 0 ? '+' : ''}${d}%</span>` : ''; }).join('');
  await cardPanel(e.t, e.w, moves, auto);
}
// 商店:每樣只有一個,你和對手共用同一批貨(兩個商店格也是同一家),誰先買走就沒了。
// 商店:每次進門隨機擺 3 樣 —— 道具 1 樣(遙控骰子 / 利空卡 / 偵查報告 / 三顆骰子)+ 事件卡 2 張,只能買一樣
const shopStock = () => AP.shopStock(Math.random);
function shopPanel() {
  const stock = shopStock();
  return new Promise((res) => {
    const p = panel(`<h3>${L('Item shop', '道具商店')}</h3><p>${L('Three on the shelf today: pick one to buy.', '今天架上這 3 樣,只能買一樣。')}</p>` +
      stock.map((id, i) => { const it = itemInfo(id);
        return `<div class="it"><span class="ic">${it.icon}</span><span class="tx"><b>${it.name}</b><small>${it.desc}</small></span><button class="b-buy" data-i="${i}" ${S.cash < it.price ? 'disabled' : ''}>$${it.price}</button></div>`; }).join('') +
      `<div class="btns"><button class="b-skip" data-i="-1">${L('Leave', '離開')}</button></div>`);
    p.querySelectorAll('button').forEach((b) => b.onclick = () => {
      const i = +b.dataset.i; closePanel();
      if (i >= 0) { const id = stock[i], it = itemInfo(id); ENG.buyItem(S, S.players[S.hi], id, it.price); sfx('item'); toast(L('Bought ', '買了 ') + it.name); hud(); }
      res();
    });
  });
}
// 利空消息卡:挑一種資產讓它下跌。列表先列對手持有的(打擊對手),再列你自己放空的(幫自己賺)
function attackPanel() {
  // 看不到對手持有什麼。三組:自己放空的(打下去你賺)、自己沒有持有的、最後是自己持有的(會連自己一起打,但有時候值得,例如想壓低價格再便宜加碼)
  return new Promise((res) => {
    const mine = KEYS.filter((k) => S.short[k].n > 0);
    const rest = KEYS.filter((k) => !S.hold[k].n && !S.short[k].n);
    const held = KEYS.filter((k) => S.hold[k].n > 0);
    const chip = (k, note) => `<button data-k="${k}" style="border-color:${SECTORS[k].css}"><i style="background:${SECTORS[k].css}"></i>${SECTORS[k].code}${note ? `<small>${note}</small>` : ''}</button>`;
    const p = panel(`<h3>📉 ${L('Bad news card', '利空消息卡')}</h3><p>${L('Pick an asset. Its price drops 18%. You cannot see who holds what, so guess from what rivals have been buying. You can also hit something you own: your holding falls too, but it can pay off, for example to buy more cheaply.', '選一種資產,價格下跌 18%。你看不到對手持有什麼,只能從他們之前買了什麼來猜。也可以打自己持有的:你的持股也會跟著跌,但有時候值得,例如想壓低價格再便宜加碼。')}</p>` +
      (mine.length ? `<p><b>${L('You are short', '你放空的')}</b></p><div class="chips">${mine.map((k) => chip(k, `${L('short', '空')} ${S.short[k].n}`)).join('')}</div>` : '') +
      `<p><b>${L('Assets you do not own', '你沒有持有的資產')}</b></p><div class="chips">${rest.map((k) => chip(k)).join('')}</div>` +
      (held.length ? `<p><b>${L('Assets you own', '你持有的資產')}</b></p><div class="chips">${held.map((k) => chip(k, `${L('own', '持有')} ${S.hold[k].n}`)).join('')}</div>` : '') +
      `<div class="btns"><button class="b-skip" data-k="">${L('Cancel', '取消')}</button></div>`);
    p.querySelectorAll('button').forEach((b) => b.onclick = () => { closePanel(); res(b.dataset.k || null); });
  });
}
// 偵查報告:選一位對手
function spyPanel() {
  return new Promise((res) => {
    const p = panel(`<h3>🔍 ${L('Spy report', '偵查報告')}</h3><p>${L(`Pick a rival. For ${SPY_ROUNDS} rounds the stock button next to their avatar opens their full assets.`, `選一位對手。接下來 ${SPY_ROUNDS} 回合,他頭像旁的股票鈕可以打開他的完整資產。`)}</p>` +
      `<div class="chips">${others().map((q) => `<button data-t="${q.i}">${CHARS[q.char].icon} ${nameOf(q)}</button>`).join('')}</div>` +
      `<div class="btns"><button class="b-skip" data-t="">${L('Cancel', '取消')}</button></div>`);
    p.querySelectorAll('button').forEach((b) => b.onclick = () => { closePanel(); res(b.dataset.t === '' ? null : +b.dataset.t); });
  });
}
// 利空消息生效:價格下跌,並說明誰受傷
async function badNews(k, by) {
  const sec = SECTORS[k], byYou = isYou(by), who = nameOf(by);
  ENG.badNews(S, by, k); sfx('bad');   // 價格 ×ATK_DROP;利空卡是出牌的人自己的動作,造成斷頭算他的(引擎)
  S.lastEvent = { t: L(`Bad news about ${sec.name}`, `${sec.name}傳出利空`), w: L('Rumors and bad headlines can sink a price fast.', '壞消息和傳言可以讓股價快速下跌。'), m: Object.fromEntries(KEYS.map((x) => [x, x === k ? ATK_DROP : 1])) };
  drawAll(); hud();
  await cardPanel(byYou ? L(`You spread bad news about ${sec.name}`, `你放出${sec.name}的利空消息`) : L(`${who} spreads bad news about ${sec.name}`, `${who}放出${sec.name}的利空消息`),
    L('Anyone holding it loses 18% of its value; anyone short profits. Who got hit stays secret.', '持有這檔的人市值少 18%,放空的人則會獲利。誰被打到不會公開。'),
    `<span class="mv dn">${sec.name} -${Math.round((1 - ATK_DROP) * 100)}%</span>`, by.human ? 0 : AI_CARD_WAIT);
}
// 背包:只有輪到自己、還沒擲骰時能開
function bagPanel() {
  if (S.busy || S.over) return;
  if (S.lane?.type === 'jail') return toast(L('At the police station: items cannot be used', '在警察局裡不能使用道具'));
  S.busy = true; $('ctl').classList.add('hide');
  const close = () => { closePanel(); S.busy = false; showCtl(true); };
  const kinds = [...new Set(S.bag)];
  const p = panel(`<h3>${L('Backpack', '背包')}</h3>` +
    (kinds.length ? kinds.map((id) => { const it = itemInfo(id), c = S.bag.filter((x) => x === id).length;
      return `<div class="it"><span class="ic">${it.icon}</span><span class="tx"><b>${it.name}${c > 1 ? ' ×' + c : ''}</b><small>${it.desc}</small></span><button class="b-ok" data-id="${id}">${L('Use', '使用')}</button></div>`; }).join('')
      : `<p>${L('Empty. Buy items at a shop tile.', '背包是空的。走到商店格可以買道具。')}</p>`) +
    `<div class="btns"><button class="b-skip" data-id="">${L('Close', '關閉')}</button></div>`);
  p.querySelectorAll('button').forEach((b) => b.onclick = async () => {
    const id = b.dataset.id;
    if (!id) return close();
    closePanel();
    if (id === 'remote' && S.lane) { toast(L('You leave with a normal die roll', '離開這裡要擲真的骰子')); S.busy = false; showCtl(true); }
    else if (id === 'remote') {
      $('steps').innerHTML = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12].map((n) => `<button data-n="${n}">${n}</button>`).join('') + '<button data-n="0" style="background:#a99b90;box-shadow:0 4px 0 #857a70">×</button>';
      $('stepCtl').classList.remove('hide');
      $('steps').querySelectorAll('button').forEach((x) => x.onclick = () => {
        const n = +x.dataset.n; $('stepCtl').classList.add('hide'); S.busy = false;
        if (!n) return showCtl(true);
        S.bag.splice(S.bag.indexOf('remote'), 1); usedItem('remote'); hud(); turn(n);
      });
    } else if (id === 'atk') {
      const k = await attackPanel();
      if (k) { S.bag.splice(S.bag.indexOf('atk'), 1); usedItem('atk'); await badNews(k, S.players[S.hi]); await flushNotices(); checkMissions(); }
      S.busy = false; showCtl(true);
    } else if (id === 'dice3') {
      S.bag.splice(S.bag.indexOf('dice3'), 1); usedItem('dice3'); S.busy = false; hud(); turn(undefined, 3);   // 直接用三顆骰子擲這一回合
    } else if (id === 'spy') {
      const t = await spyPanel();
      if (t != null) { S.bag.splice(S.bag.indexOf('spy'), 1); const me = S.players[S.hi]; me.spy = { target: t, until: S.rolls + SPY_ROUNDS }; if (me === meP()) { S.view = t; $('assetBox').classList.remove('fold'); } sfx('item');
        toast(L(`Spying on ${nameOf(S.players[t])} for ${SPY_ROUNDS} rounds`, `開始偵查${nameOf(S.players[t])},${SPY_ROUNDS} 回合內看得到他的資產`)); usedItem('spy'); hud(); checkMissions(); }
      S.busy = false; showCtl(true);
    } else {
      S.bag.splice(S.bag.indexOf(id), 1); usedItem(id);
      await playEvent(instantiate(itemInfo(id).event), 0, S.players[S.hi]); await flushNotices();
      checkMissions(); S.busy = false; showCtl(true);
    }
  });
}
/* ───────────── 中間的小路 ───────────── */
// 被送進小路:大跳躍到第一格。拘留小路 = 帳戶凍結(不能買賣、不能用道具);內部認購 = 在攤位用市價 8 折認購一檔新股(鎖 IPO_LOCK 回合不能賣)
async function enterLane(isMe, type) {
  const who = isMe ? S : S.ai, P = isMe ? PM() : PA(), name = CHARS[S.foe].name;
  // 每次有人進來,這條小路重新隨機生成(除非還有別人正走在上面)
  if (ENG.enterLane(S, isMe ? S.players[S.hi] : who, type, Math.random).regen) drawLaneNet(type);   // 引擎:必要時重新生成小路的格子
  hud();
  await hopOnto(laneTiles[type].cell.g, P, true); sfx(type === 'jail' ? 'jail' : 'bell');
  if (type === 'ipo') return isMe ? ipoPanel() : aiIpo();
  if (isMe) await cardPanel(L('Sent to the police station', '被送進警察局'),
    L(`Rest here ${JAIL_WAIT} rounds. You cannot buy, sell, cover or use items, but prices keep moving: a margin position below 130% is still sold for you. On your turn you can pay $${fmt(BAIL)} bail to leave at once.`,
      `在這裡休息 ${JAIL_WAIT} 回合。期間不能買賣、不能回補、不能用道具,但股價照樣會動:融資部位跌破 130% 一樣會被強迫平倉。輪到你時可以付 $${fmt(BAIL)} 保釋金立刻離開。`));
  else { toast(L(`${name} is sent to the police station`, `${name}被送進警察局了`)); await wait(1.3); }
}
// 沿著外圈走 n 格(經過起點 / 股息結算格會結算)。真人和電腦都用這個
// 每一步由引擎決定去哪裡(並結算經過的起點 / 股息格),這裡照著播棋子跳的動畫、跳發薪提示
async function stepAlong(isMe, n) { for (let i = 0; i < n; i++) await stepOnce(isMe); }
async function stepOnce(isMe) {
  const who = isMe ? S.players[S.hi] : S.ai, P = isMe ? PM() : PA(), s = ENG.advance(S, who);
  if (s.kind === 'lane') { await hopOnto(laneTiles[s.type].path[s.at - 1].g, P); return; }
  await hopTo(s.pos, P); if (s.kind === 'exit') hud();                      // 踏上外圈的出口格
  if (s.pay) { if (isMe) paydayUI(s.pay, s.pay.atStart); else hud(); }
}
// 離開警察局 / 內部認購攤位:和外圈一樣自己選擲 1 顆或 2 顆,沿小路走;走完小路踏上外圈出口格,剩下的點數繼續往前走(每一步由引擎決定)
// 真人用擲骰鈕旁邊的選擇(S.diceN);電腦:警察局那條擲 2 顆快點出去(有手續費),內部認購那條擲 1 顆多踩幾格(撿到錢、禮物多)
const laneDice = (p) => (p.lane && p.lane.type === 'ipo' ? 1 : 2);
async function leaveLane(isMe) {
  const P = isMe ? PM() : PA(), who = isMe ? S.players[S.hi] : S.ai, nd = isMe ? S.diceN : laneDice(who), name = isMe ? L('You', '你') : CHARS[S.foe].name;
  const vals = ENG.dice(nd, 0, Math.random), n = vals.reduce((x, y) => x + y, 0);
  toast(L(`${name} roll${isMe ? '' : 's'} ${nd === 1 ? 'one die' : 'two dice'} on the path`, `${name}擲 ${nd} 顆骰子走小路`)); await wait(0.5);
  await rollDice(vals, P); toast(vals.length === 1 ? `${name}: ${n}` : `${name}: ${vals.join(' + ')} = ${n}`);
  await stepAlong(isMe, n);
  hud();
}
// 小路上踩到的格子是什麼:'fate' 命運、'_gift' / '_interest' / '_coin' / '_fine' 小路專屬的格子、'_path' 空白的一步、'_jail' / '_ipo' 還在攤位上
// 小路專屬格子的效果(真人和電腦共用)。回傳提示文字
// 小路專屬格子(利息、撿到錢、手續費):金額由引擎算,這裡回傳提示文字
function pathEffect(who, k, isMe) {
  const name = isMe ? L('You', '你') : CHARS[S.foe].name, d = ENG.pathEffect(S, isMe ? S.players[S.hi] : who, k);
  if (k === '_interest') { sfx('coin'); return L(`${name} earned $${fmt(d)} interest`, `${name}領到利息 $${fmt(d)}`); }
  if (k === '_coin') { sfx('coin'); return L(`${name} picked up $300`, `${name}撿到 $300`); }
  if (k === '_fee') { sfx('short'); return L(`${name} paid a $200 fee`, `${name}付了 $200 手續費`); }
  return '';
}
function jailPanel() {
  return new Promise((res) => {
    const left = S.lane.wait, risky = KEYS.filter((k) => S.hold[k].loan > 0);
    const p = panel(`<h3><span class="tag" style="background:#7b8494">${L('POLICE', '警察局')}</span>${L('Resting', '休息中')}</h3>
      <p>${L(`${left} more round${left > 1 ? 's' : ''} before you can roll out. You cannot trade in here.`, `再休息 ${left} 回合才能擲骰子出去,在這裡不能買賣。`)}${risky.length ? ` <b style="color:#c4472f">${L(`Margin at risk: ${risky.map((k) => SECTORS[k].code).join(', ')} (ratio ${Math.round(acctRatio(S.players[S.hi]) * 100)}%)`, `融資部位有風險:${risky.map((k) => SECTORS[k].code).join('、')},維持率 ${Math.round(acctRatio(S.players[S.hi]) * 100)}%`)}</b>` : ''}</p>
      <div class="btns">
        <button class="b-ok" data-a="bail" ${S.cash < BAIL ? 'disabled' : ''}>${L('Pay bail', '付保釋金')}<br><span style="font-size:calc(11px * var(--fs))">$${fmt(BAIL)} · ${L('roll out now', '立刻擲骰出去')}</span></button>
        <button class="b-skip" data-a="wait">${L('Rest', '休息')}<br><span style="font-size:calc(11px * var(--fs))">${L('one more round', '再等一回合')}</span></button>
      </div>`);
    p.querySelectorAll('button').forEach((b) => b.onclick = () => { closePanel(); res(b.dataset.a === 'bail'); });
  });
}
// 內部認購:隨機一檔股票,先免費送 IPO_FREE 股(馬上能賣);再受邀用市價 8 折認購,一定買得到,認購的股數鎖 IPO_LOCK 回合不能賣(被斷頭時照樣會被賣掉)。新股不會推高市價
const ipoPick = (who) => ENG.ipoPick(S, who === S ? S.players[S.hi] : who, Math.random);      // 隨機一檔沒在放空的股票(引擎)
function ipoGrant(who, k) { ENG.ipoGrant(S, who === S ? S.players[S.hi] : who, k); pubNote(who, k); }
function ipoPanel() {
  return new Promise((res) => {
    const k = ipoPick(S), sec = SECTORS[k], h = S.hold[k], mkt = S.price[k], price = mkt * IPO_OFF;
    ipoGrant(S, k); sfx('coin'); drawAll(); hud();
    const p = panel(`<h3><span class="tag" style="background:#2fbf9f">${L('OFFER', '內部認購')}</span>${sec.name}</h3>
      <p><b style="color:#1c8a4a">${L(`You get ${IPO_FREE} shares for free (worth $${fmt(mkt * IPO_FREE)}).`, `免費獲得 ${IPO_FREE} 股(市值 $${fmt(mkt * IPO_FREE)}),馬上可以賣。`)}</b> ${L(`You can also buy more at 20% below the market price, and you are sure to get them. <b>The catch: shares you buy here cannot be sold for ${IPO_LOCK} rounds</b> (they can still be sold for you if a margin call hits).`,
        `你還能用市價 8 折加碼認購,一定買得到。<b>代價是加碼的股數 ${IPO_LOCK} 回合不能賣</b>(融資被斷頭時照樣會被強制賣掉)。`)}</p>
      <div class="kv">
        <div>${L('Market price', '市價')}<b>$${Math.round(mkt)}</b></div>
        <div>${L('Offer price', '認購價')}<b style="color:#1c8a4a">$${Math.round(price)}</b></div>
        <div>${L('You hold', '持有')}<b>${h.n}</b></div>
      </div>
      <div class="slider"><span>${L('Buy more', '加碼')}</span><input type="range" id="ipoQty" min="10" max="50" step="10" value="10"><b id="ipoVal"></b></div>
      <div class="btns">
        <button class="b-buy" data-a="buy">${L('Buy more', '加碼認購')}<br><span id="ipoBtn"></span></button>
        <button class="b-skip" data-a="x">${L('Continue', '繼續')}</button>
      </div>`);
    const qty = $('ipoQty');
    const paint = () => { const q = +qty.value; $('ipoVal').textContent = `${q} ${L('sh', '股')} · $${fmt(price * q)}`; $('ipoBtn').textContent = `$${fmt(price * q)} · 🔒${IPO_LOCK}${L('r', '回合')}`; p.querySelector('[data-a=buy]').disabled = S.cash < price * q; };
    qty.oninput = paint; paint();
    p.querySelectorAll('button').forEach((b) => b.onclick = () => {
      if (b.dataset.a === 'buy') { const n = +qty.value; ENG.ipoBuy(S, S.players[S.hi], k, n); pubNote(S.players[S.hi], k); sfx('buy'); { const nm = nameOf(S.players[S.hi]); toast(L(`${nm} took part in the ${sec.name} private placement`, `${nm}參加了${sec.name}的內部認購`)); } }
      drawAll(); hud(); closePanel(); res();
    });
  });
}
async function aiIpo() {
  const A = S.ai, who = CHARS[S.foe].name, k = ipoPick(A), sec = SECTORS[k];
  const lots = SIM.ipoLots(S, A, k);                               // 電腦加碼認購幾手(和模擬器同一個決定);公告不寫加碼的股數
  ipoGrant(A, k);
  if (lots) { ENG.ipoBuy(S, A, k, LOT * lots); pubNote(A, k); toast(L(`${who} got ${IPO_FREE} free ${sec.name} shares and bought more`, `${who}免費獲得${sec.name} ${IPO_FREE} 股,又加碼認購了`)); }
  else toast(L(`${who} got ${IPO_FREE} free ${sec.name} shares`, `${who}免費獲得${sec.name} ${IPO_FREE} 股`));
  drawAll(); hud(); await wait(1.1);
}
// 銀行:借現金 / 還錢。每次走到銀行只做一個動作,選完面板就關掉、換下一位
function bankPanel() {
  return new Promise((res) => {
    const draw = () => {
      const room = BANK_MAX - S.debt, fee = S.debt * BANK_RATE;
      const p = panel(`<h3><span class="tag" style="background:#4a63b0">${L('BANK', '銀行')}</span>${L('Cat Street Bank', '貓街銀行')}</h3>
        <p>${L(`Borrow cash now and pay it back later. Each time you pass GO you pay ${Math.round(BANK_RATE * 100)}% interest on what you owe, and the loan counts against your total assets. Borrowing only pays off if what you buy earns more than the interest.`,
              `先借現金、之後再還。每次經過起點要付欠款 ${Math.round(BANK_RATE * 100)}% 的利息,欠的錢也會從總資產扣掉。借來的錢賺得比利息多,才划算。`)}</p>
        <div class="kv">
          <div>${L('You owe', '目前欠款')}<b style="color:${S.debt ? '#c4472f' : 'inherit'}">$${fmt(S.debt)}</b></div>
          <div>${L('Interest per lap', '每圈利息')}<b>$${fmt(fee)}</b></div>
          <div>${L('Can still borrow', '還能借')}<b>$${fmt(room)}</b></div>
        </div>
        ${room >= 1000 ? `<div class="slider"><span>${L('Borrow', '借款')}</span><input type="range" id="bkAmt" min="1000" max="${Math.floor(room / 500) * 500}" step="500" value="${Math.min(2000, Math.floor(room / 500) * 500)}"><b id="bkVal"></b></div>` : ''}
        ${S.debt > 0 ? `<div class="slider"><span>${L('Repay', '還款')}</span><input type="range" id="bkRep" min="500" max="${Math.max(500, Math.min(S.debt, Math.floor(S.cash / 500) * 500))}" step="500" value="${Math.max(500, Math.min(S.debt, Math.floor(S.cash / 500) * 500))}"><b id="bkRepVal"></b></div>` : ''}
        <div class="btns">
          <button class="b-buy" data-a="borrow" ${room < 1000 ? 'disabled' : ''}>${L('Borrow', '借')} <span id="bkBtn"></span></button>
          <button class="b-ok" data-a="repay" ${S.debt > 0 && S.cash >= 500 ? '' : 'disabled'}>${L('Repay', '還')} <span id="bkRepBtn"></span></button>
          <button class="b-skip" data-a="x">${L('Leave', '離開')}</button>
        </div>`);
      // 拉桿:借 1,000 ~ 5,000(每 500 一格),還款 500 ~ 欠款(受現金限制)。拉動時即時顯示金額和利息
      const amt = $('bkAmt'), rep = $('bkRep');
      const paint = () => {
        if (amt) { const v = +amt.value; $('bkVal').textContent = `$${fmt(v)} · ${L('interest', '利息')} $${fmt(v * BANK_RATE)}${L(' / lap', ' / 圈')}`; $('bkBtn').textContent = `$${fmt(v)}`; }
        else $('bkBtn').textContent = '—';
        if (rep) { const v = +rep.value; $('bkRepVal').textContent = `$${fmt(v)}${v >= S.debt ? L(' (all)', '(全部還清)') : ''}`; $('bkRepBtn').textContent = `$${fmt(v)}`; }
        else $('bkRepBtn').textContent = '—';
      };
      if (amt) amt.oninput = paint; if (rep) rep.oninput = paint; paint();
      p.querySelectorAll('button').forEach((b) => b.onclick = () => {
        const a = b.dataset.a;
        if (a === 'x') { closePanel(); return res(); }
        const d = a === 'borrow' ? +amt.value : -Math.min(S.debt, +rep.value);
        ENG.bank(S, S.players[S.hi], d); sfx(d > 0 ? 'coin' : 'sell');
        { const nm = nameOf(S.players[S.hi]); toast(d > 0 ? L(`${nm} took a bank loan`, `${nm}向銀行貸款了`) : L(`${nm} paid back the bank`, `${nm}還了銀行貸款`)); }   // 公告不寫金額(大家都看得到)
        hud(); closePanel(); res();        // 選一個動作就結束,不用再按離開
      });
    };
    draw();
  });
}
// 命運牌:只影響踩到的那個人(市場事件是影響所有人的股價)。有好有壞,有些會把你移到別的地方
// 拿禮物:三個禮物盒挑一個(電腦自動挑),打開是哪個道具就放進背包。三個盒子裡的道具各不相同
function drawGiftCards(auto) {
  return new Promise((res) => {
    const picks = AP.giftPicks(Math.random);
    const who = CHARS[S.foe].name;
    const face = (id) => { const it = itemInfo(id); return `<div class="dhead good">${it.icon} ${it.name}</div><div class="dwhy">${it.desc}</div><div class="dmv"><span class="mv up">${L('Into your backpack', '放進背包')}</span></div>`; };
    const ov = $('draw');
    ov.innerHTML = `<h2>🎁 ${auto ? L(`${who} picks a gift`, `${who}挑一個禮物`) : L('Pick a gift', '挑一個禮物')}</h2>` +
      `<div class="dcards">${picks.map((id, i) => `<div class="dcard" data-i="${i}" style="--i:${i}"><div class="dinner"><div class="dback gift"></div><div class="dfront">${face(id)}</div></div></div>`).join('')}</div>` +
      `<button class="dgo hide" id="dgo">${L('Continue', '繼續')}</button>`;
    ov.classList.remove('hide'); ov.classList.toggle('auto', !!auto); fitCards(ov);
    const cards = [...ov.querySelectorAll('.dcard')]; let chosen = -1, done = false;
    const choose = (i) => {
      if (chosen >= 0) return;
      chosen = i; ov.classList.add('done'); cards[i].classList.add('flip', 'picked'); sfx('flip');
      wait(0.45).then(() => sfx('item'));
      wait(0.9).then(() => { cards.forEach((c, j) => { if (j !== i) c.classList.add('flip', 'lost'); }); $('dgo').classList.remove('hide'); if (auto) wait(2).then(() => { if (!done) $('dgo').click(); }); });
    };
    cards.forEach((c, i) => { c.onclick = () => { if (!auto) choose(i); }; });
    if (auto) wait(1.2).then(() => choose(Math.floor(Math.random() * 3)));
    $('dgo').onclick = () => { if (done) return; done = true; ov.classList.add('hide'); ov.classList.remove('done'); res(picks[chosen]); };
  });
}
// 翻命運牌:三張背面朝上挑一張(電腦自動挑)。回傳抽到的牌,效果由 applyFate 處理
function drawFateCards(auto) {
  return new Promise((res) => {
    const picks = FATE.slice().sort(() => Math.random() - 0.5).slice(0, 3), who = CHARS[S.foe].name;
    const face = (c) => `<div class="dhead ${c.good ? 'good' : 'bad'}">${c.t}</div><div class="dwhy">${c.w}</div><div class="dmv"><span class="mv ${c.good ? 'up' : 'dn'}">${c.fx}</span></div>`;
    const ov = $('draw');
    ov.innerHTML = `<h2>★ ${auto ? L(`${who} flips a fate card`, `${who}翻命運牌`) : L('Flip a fate card', '翻一張命運牌')}</h2>` +
      `<div class="dcards">${picks.map((c, i) => `<div class="dcard" data-i="${i}" style="--i:${i}"><div class="dinner"><div class="dback fate"></div><div class="dfront">${face(c)}</div></div></div>`).join('')}</div>` +
      `<button class="dgo hide" id="dgo">${L('Continue', '繼續')}</button>`;
    ov.classList.remove('hide'); ov.classList.toggle('auto', !!auto); fitCards(ov);
    const cards = [...ov.querySelectorAll('.dcard')]; let chosen = -1, done = false;
    const choose = (i) => {
      if (chosen >= 0) return;
      chosen = i; ov.classList.add('done'); cards[i].classList.add('flip', 'picked'); sfx('flip');
      wait(0.45).then(() => sfx(picks[i].good ? 'good' : 'bad'));
      wait(0.9).then(() => { cards.forEach((c, j) => { if (j !== i) c.classList.add('flip', 'lost'); }); $('dgo').classList.remove('hide'); if (auto) wait(2).then(() => { if (!done) $('dgo').click(); }); });
    };
    cards.forEach((c, i) => { c.onclick = () => { if (!auto) choose(i); }; });
    if (auto) wait(1.2).then(() => choose(Math.floor(Math.random() * 3)));
    $('dgo').onclick = () => { if (done) return; done = true; ov.classList.add('hide'); ov.classList.remove('done'); res(picks[chosen]); };
  });
}
// 命運牌生效。會移動的牌(回起點、IPO)在這裡處理
// 命運牌:效果由引擎算(現金、道具、配息、薪水、手滑賣出、瞬間移動、IPO);這裡負責提示、音效和棋子動畫
async function applyFate(c, isMe) {
  const who = isMe ? S.players[S.hi] : S.ai, name = isMe ? L('You', '你') : CHARS[S.foe].name, P = isMe ? PM() : PA();
  const say = (en, zh) => toast(L(en, zh));
  const r = ENG.fate(S, who, c, Math.random), amt = r.amount;
  if (c.id === 'lottery') { sfx('coin'); say(`${name} +$1,500`, `${name} +$1,500`); }
  else if (c.id === 'tax') { sfx('short'); say(`${name} paid $${fmt(-amt)} tax`, `${name}繳稅 $${fmt(-amt)}`); }
  else if (c.id === 'birthday') { sfx('coin'); say(`${name} +$${fmt(amt)} in gifts`, `${name}收到紅包 +$${fmt(amt)}`); }
  else if (c.id === 'phone') { sfx('short'); say(`${name} −$300`, `${name} −$300`); }
  else if (c.id === 'fine') { sfx('short'); say(`${name} −$500`, `${name} −$500`); }
  else if (c.id === 'richest') { if (r.from) { sfx('coin'); say(`${nameOf(r.from)} pays ${name} $500`, `${nameOf(r.from)}請客,${name} +$500`); } }
  else if (c.id === 'remote' || c.id === 'atk') { sfx('item'); say(`${name}: ${itemInfo(c.id).name} added`, `${name}獲得${itemInfo(c.id).name}`); }
  else if (c.id === 'divi') { if (isMe) paydayUI(r.pay, false); else hud(); }
  else if (c.id === 'salary2') say(`${name}: next salary doubled`, `${name}下次薪水加倍`);
  else if (c.id === 'gostart') { await hopOnto(tiles[0].g, P, true); if (isMe) paydayUI(r.pay, true); else hud(); }
  else if (c.id === 'fat') {
    // 隨機一檔持股用市價賣掉 LOT 股(持股不到 LOT 股就全賣;融資借款按比例還),賣壓會壓低股價。沒有可賣的持股就只是虛驚一場
    if (!r.k) say(`${name} has nothing to sell. Phew.`, `${name}沒有可以賣的持股,虛驚一場`);
    else { pubNote(who, r.k); sfx('sell'); say(`${name} accidentally sold ${r.n} shares of ${SECTORS[r.k].name}`, `${name}手滑賣掉了 ${r.n} 股${SECTORS[r.k].name}`); } }
  else if (c.id === 'swap' && r.other) {
    // 和隨機一位對手交換位置(連同在小路上的狀態一起換),兩隻棋子各自跳過去;自己換到的那一格要重新結算
    const o = r.other, PW = PIECES[who.i], PR = PIECES[o.i];
    const spot = (p) => (p.lane ? (p.lane.at ? laneTiles[p.lane.type].path[p.lane.at - 1].g : laneTiles[p.lane.type].cell.g) : tiles[p.pos].g);
    say(`${name} swap${isMe ? '' : 's'} places with ${nameOf(o)}`, `${name}和${nameOf(o)}互換位置`); sfx('item');
    await hopOnto(spot(o), PR, true); await hopOnto(spot(who), PW, true);
    hud(); await wait(0.2); return isMe ? landOn() : aiLand(); }
  else if (r.lane) { await enterLane(isMe, r.lane); }
  hud(); await wait(0.6);
}
// 對手決定擲 1 顆還是 2 顆:把「每個可能落點對牠有多好」算成分數,比較兩種擲法的期望值。
// 一顆骰子走 1~6 格(機率相同),兩顆走 2~12 格(7 最常出現)
// 電腦的主攻股、前方格子分數、規則式擲幾顆骰子:aiplan.mjs(和模擬器同一份)
const aiFocus = (A) => AP.focus(S, A, aiCtx(A));
async function aiDiceChoice() {
  const A = S.ai;
  if (aiAlg() !== 'rule') return simDecide('dice', simSnapshot(A), A.i);
  return AP.ruleDice(S, A, aiCtx(A));
}
// 小熊的回合。策略很單純,但都是看得懂的規則:
//   賺超過 15% 就賣;價格比開盤低 5% 以上且現金夠就多買;否則留 $1,500 現金後買 10 股
// 電腦經過起點 / 股息結算:薪水(升職加薪時加倍)、股利、融資與貸款利息
function aiPayday(A, atStart) { ENG.payday(S, A, atStart); hud(); }
async function aiTurn() {
  const A = S.ai, who = CHARS[S.foe].name;
  focus = PA(); pan.set(0, 0, 0); toast(L(`${who}'s turn`, `${who}的回合`)); await wait(0.9);
  // 擲骰前用道具:用不用、用在誰身上由 aiplan.mjs 決定(和模擬器同一份),這裡負責執行和畫面
  // 依序:利空卡(打名次最高的對手牠所知道持有最多的資產)→ 偵查報告 → 事件卡(炒自己的持股)→ 三顆骰子 / 遙控骰子
  const use = (id) => { AP.take(A, id); usedBy(A, id); hud(); };
  { const k = AP.atkTarget(S, A, aiCtx(A)); if (k) { use('atk'); await badNews(k, A); } }
  { const T = AP.spyTarget(S, A, aiCtx(A)); if (T) { use('spy'); A.spy = { target: T.i, until: S.rolls + SPY_ROUNDS }; hud();
    toast(L(`${who} spies on ${nameOf(T)}`, `${who}對${nameOf(T)}使用偵查報告`)); await wait(0.9); } }
  { const id = AP.cardToPlay(S, A); if (id) { use(id); toast(L(`${who} plays an event card`, `${who}使用事件卡`)); await wait(0.6); await playEvent(itemInfo(id).event, AI_CARD_WAIT, A); } }
  let forced = 0, three = false;
  if (AP.useDice3(S, A, aiCtx(A))) { use('dice3'); three = true; toast(L(`${who} uses a third die`, `${who}使用三顆骰子`)); await wait(0.9); }
  else { forced = AP.remoteSteps(S, A, aiCtx(A)); if (forced) { use('remote'); toast(L(`${who} uses a remote dice: ${forced} steps`, `${who}使用遙控骰子:走 ${forced} 步`)); await wait(1.0); } }
  if (A.lane) {
    // 在警察局:錢夠多就付保釋金,不然休息一回合;能走了就擲骰出去。內部認購攤位:下一回合直接擲骰出去
    if (A.lane.type === 'jail' && A.lane.wait > 0) {
      if (A.cash >= BAIL + 2500) { ENG.bail(S, A); toast(L(`${who} pays $${fmt(BAIL)} bail`, `${who}付了 $${fmt(BAIL)} 保釋金`)); await wait(0.8); await leaveLane(false); }
      else { ENG.rest(S, A); toast(L(`${who} rests at the police station (${A.lane.wait} left)`, `${who}在警察局休息(再 ${A.lane.wait} 回合)`)); await wait(0.9); }
    } else await leaveLane(false);
  } else {
  const nd = forced ? (forced <= 6 ? 1 : 2) : three ? 3 : await aiDiceChoice(), vals = ENG.dice(nd, forced, Math.random), n = vals.reduce((x, y) => x + y, 0);
  if (!forced && !three) { toast(L(`${who} rolls ${nd === 1 ? 'one die' : 'two dice'}`, `${who}選擇擲 ${nd} 顆骰子`)); await wait(0.7); }
  await rollDice(vals, PA()); toast(vals.length === 1 ? `${who}: ${n}` : `${who}: ${vals.join(' + ')} = ${n}`);
  await stepAlong(false, n);
  }
  await wait(0.2);
  await aiLand();
  hud(); pan.set(0, 0, 0); await wait(0.5);
}
// 電腦踩到的那一格要做什麼
// 規則式(簡單難度)的買賣決定:賺 15%(主攻股 35%)賣、主攻股能買幾手買幾手、對手重押又漲多就放空、不是主攻股便宜才順手買
// 現金扣掉 reserve 之後最多買得起幾手(用推動後的成交價算)
const aiMaxLots = (A, k, max, reserve) => { for (let l = max; l > 0; l--) if (A.cash - fillAt(k, buyF(LOT * l)) * LOT * l >= reserve) return l; return 0; };
function aiRuleAct(A, type, h, sh, price, mine, F, lv) {
  const sec = SECTORS[type];
  if (sh.n) return Math.abs((sh.entry - price) / sh.entry) >= 0.12 ? { a: 'cover' } : { a: 'skip' };
  if (h.n && (price * h.n - h.cost) / h.cost >= (type === F ? 0.35 : 0.15)) return { a: 'sell', why: L('(taking profit)', '(獲利了結)') };
  if (type === F) {
    const lots = aiMaxLots(A, type, lv.lots, lv.reserve);
    if (lots < lv.lots && !h.loan && Math.random() < lv.greedy && A.cash >= fillAt(type, buyF(LOT * lv.lots)) * LOT * lv.lots * (1 - MARGIN_LOAN) + 500) return { a: 'margin', q: LOT * lv.lots, why: L('(its favourite)', '(主攻股)') };
    return lots > 0 ? { a: 'buy', q: LOT * lots, why: L('(its favourite)', '(主攻股)') } : { a: 'skip', why: L('(short on cash)', '(現金不夠)') };
  }
  if (!h.n && A.cash >= price * LOT + lv.reserve && Math.random() < lv.shortP && mine >= 30 && price > sec.open * (lv.shortAny ? 1.05 : 1.15)) return { a: 'short', q: LOT, why: L('(to hit its holders)', '(打擊持有的人)') };
  const rich = A.cash >= 6000, lots = price < sec.open * 0.93 && A.cash >= price * LOT * 2 + lv.reserve + 1500 ? (rich ? 3 : 2) : price < sec.open * 1.05 && A.cash >= price * LOT + lv.reserve + 1500 ? (rich && h.n ? 2 : 1) : 0;
  const ok = lots ? aiMaxLots(A, type, lots, lv.reserve) : 0;
  if (ok && Math.random() < lv.buyP) return { a: 'buy', q: LOT * ok, why: L('(on the dip)', '(逢低買進)') };
  return { a: 'skip', why: L(`(saving cash for ${SECTORS[F].name})`, `(把現金留給${SECTORS[F].name})`) };
}
async function aiLand() {
  const A = S.ai, who = CHARS[S.foe].name;
  const type = ENG.tileType(S, A, Math.random), sec = SECTORS[type];
  if (type === '_jail' || type === '_ipo' || type === '_path') { await wait(0.2); }
  else if (type === '_chance') { await wait(0.3); await drawEventCards(true, false, false); }
  else if (type.startsWith('_') && type !== '_gift') { toast(pathEffect(A, type, false)); hud(); await wait(1.0); }
  else if (type === 'ipo') await enterLane(false, 'ipo');
  else if (type === 'fate') { await wait(0.3); const c = await drawFateCards(true); await applyFate(c, false); }
  else if (sec) {
    const h = A.hold[type], sh = A.short[type], price = S.price[type], mine = Math.max(...others(A.i).map((p) => pubView(A, p, type).n)), F = aiFocus(A), lv = AI();   // mine:牠所知道別人最多持有幾股(公開帳本);F:主攻股
    // 先決定動作 act = { a: buy|margin|sell|short|cover|skip, q, why },再統一執行、說明
    let act;
    if (aiAlg() === 'rule') act = aiRuleAct(A, type, h, sh, price, mine, F, lv);
    else { const st = simSnapshot(A), p = st.players[A.i]; act = await simDecide('trade', st, A.i, type);
      const e = SIM.evOf(st, type, p) / Math.max(1, S.maxRounds - S.rolls), ep = `${e >= 0 ? '+' : ''}${Math.round(e * 100)}%`;   // 換算成每回合的期望報酬
      act.why = aiAlg() === 'mc' ? '' : L(`(expects ${ep} per round)`, `(期望每回合 ${ep})`); }   // 困難(蒙地卡羅)的公告不寫決策方式
    const why = act.why || '';
    // 規則在遊戲引擎裡算(和玩家、電腦模擬同一份);這裡只負責公告
    if (act.a === 'cover') { const r = ENG.cover(S, A, type);
      if (r) toast(L(`${who} covered its ${sec.name} short. Price ${pct(buyF(r.n))} ${why}`, `${who}回補${sec.name}空單,股價 ${pct(buyF(r.n))}${why}`)); }
    else if (act.a === 'sell') { const r = ENG.sell(S, A, type); if (type === F) A.plan = null;     // 賣掉主攻股就重新挑
      if (r) toast(L(`${who} sold ${sec.name}. Price ${pct(sellF(r.n))} ${why}`, `${who}賣出${sec.name},股價 ${pct(sellF(r.n))}${why}`)); }
    else if (act.a === 'buy' || act.a === 'margin') { const q = act.q, loan = act.a === 'margin'; ENG.buy(S, A, type, q, loan);
      toast(loan ? L(`${who} margin-bought ${sec.name}. Price ${pct(buyF(q))} ${why}`, `${who}融資買進${sec.name},股價 ${pct(buyF(q))}${why}`) : L(`${who} bought ${sec.name}. Price ${pct(buyF(q))} ${why}`, `${who}買進${sec.name},股價 ${pct(buyF(q))}${why}`)); }
    else if (act.a === 'short') { const q = act.q || LOT; ENG.short(S, A, type, q);
      toast(L(`${who} shorts ${sec.name}. Price ${pct(shortF(q))} ${why}`, `${who}放空${sec.name},股價 ${pct(shortF(q))}${why}`)); }
    else toast(sh.n ? L(`${who} keeps its ${sec.name} short ${why}`, `${who}續抱${sec.name}空單${why}`) : h.n ? L(`${who} holds ${sec.name} ${why}`, `${who}續抱${sec.name}${why}`) : L(`${who} passes on ${sec.name} ${why}`, `${who}跳過${sec.name}${why}`));
    pubNote(A, type); drawAll(); hud(); await wait(1.0);
  } else if (type === 'shop') {
    // 逛商店:買什麼由 aiplan.mjs 決定(炒主攻股的事件卡 → 遙控骰子 → 利空卡 → 偵查報告 → 三顆骰子 → 其他持股受惠的事件卡)
    const got = AP.shopPick(S, A, shopStock(), aiCtx(A));
    if (got) { const it = itemInfo(got); ENG.buyItem(S, A, got, it.price); toast(L(`${who} bought: ${it.name}`, `${who}買了:${it.name}`)); }
    else toast(L(`${who} looks around the shop`, `${who}逛了逛商店`));
    hud(); await wait(1.2);
  } else if (type === 'chance') { await wait(0.3); const c = await drawEventCards(true); if (c.special) await enterLane(false, c.special); }
  else if (type === 'bank') {
    // 銀行:借還錢由 aiplan.mjs 決定(手頭寬裕就還清;現金太少,或想買主攻股錢不夠就借)
    const d = AP.bankMove(S, A, aiCtx(A));
    if (d) ENG.bank(S, A, d);
    toast(d < 0 ? L(`${who} paid back the bank`, `${who}還了銀行貸款`) : d > 0 ? L(`${who} took a bank loan`, `${who}向銀行貸款了`) : L(`${who} walks past the bank`, `${who}路過銀行`));
    hud(); await wait(1.1);
  }
  else if (type === 'gift' || type === '_gift') { await wait(0.3); const id = await drawGiftCards(true); A.bag.push(id); hud(); toast(L(`${who} got ${itemInfo(id).name}`, `${who}拿到${itemInfo(id).name}`)); await wait(0.6); }
  else if (type === 'fee') { ENG.payFee(S, A); toast(L(`${who} paid $${FEE} in fees`, `${who}付了 $${FEE} 手續費`)); hud(); await wait(0.9); }
  else { toast(L(`${who} takes a break`, `${who}休息一下`)); await wait(0.7); }
}
async function turn(forced, nDice = 0) {      // nDice = 3:用了「三顆骰子」道具
  if (S.busy || S.over) return;
  S.busy = true; showCtl(false); pan.set(0, 0, 0);
  // 擲 1 顆或 2 顆由玩家選(S.diceN)。遙控骰子(forced):6 以內用一顆顯示,7 以上拆成兩顆的點數
  if (S.lane) {
    // 在警察局:付保釋金或再休息一回合;能走了(或在內部認購攤位)就擲骰出去(1 顆或 2 顆照玩家的選擇)
    if (S.lane.type === 'jail' && S.lane.wait > 0) {
      if (await jailPanel()) { ENG.bail(S, S.players[S.hi]); hud(); sfx('sell'); toast(L(`Paid $${fmt(BAIL)} bail`, `付了 $${fmt(BAIL)} 保釋金`)); await leaveLane(true); }
      else { ENG.rest(S, S.players[S.hi]); S.lane.rested = true; hud(); toast(L(`Resting (${S.lane.wait} left)`, `休息中(再 ${S.lane.wait} 回合)`)); await wait(0.6); }
    } else await leaveLane(true);      // 休息夠了(或在內部認購攤位):擲骰出去
  } else {
  const vals = ENG.dice(nDice === 3 ? 3 : S.diceN, forced, Math.random);          // 點數由引擎決定(遙控骰子 / 三顆骰子也是)
  const n = vals.reduce((x, y) => x + y, 0);
  await rollDice(vals);
  toast(vals.length === 1 ? `${n}` : `${vals.join(' + ')} = ${n}`);
  await stepAlong(true, n);
  }
  if (S.hi === 0) {           // 第一位走完 = 新的一回合開始:回合數 +1,所有價格小幅隨機波動
    const r = ENG.newRound(S, Math.random);                  // 回合數 +1、配息、套用反彈、價格隨機波動 + 大盤趨勢(引擎)
    showDividends(r.paid);
    if (r.after) { noteEvent(r.after); drawAll(); hud(); toast(r.after.t); sfx('good'); }
  }
  marginCheck();
  drawAll(); hud();
  await wait(0.15);

  await landOn();

  await flushNotices();
  S.cashStreak = (stockValue() > 0 && S.cash >= 2000) ? S.cashStreak + 1 : 0;
  checkMissions();
  await nextTurns();
}
// 輪到下一位:電腦自己走完;遇到真人就停下來等他擲骰。繞回第一位時,如果回合數用完就結算
// 玩家踩到的那一格要做什麼(命運牌「退三格」之後也會再呼叫一次)
async function landOn() {
  const type = ENG.tileType(S, S.players[S.hi], Math.random);
  if (type === '_jail') { if (S.lane.wait > 0) { toast(L('Resting at the police station: no trading this turn', '在警察局休息,這回合不能交易')); await wait(0.9); } }
  else if (type === '_ipo' || type === '_path') { await wait(0.2); }
  else if (type === '_chance') await drawEventCards(false, false, false);
  else if (type.startsWith('_') && type !== '_gift') { toast(pathEffect(S, type, true)); hud(); await wait(0.9); }
  else if (type === 'ipo') await enterLane(true, 'ipo');
  else if (type === 'fate') { const c = await drawFateCards(false); await applyFate(c, true); }
  else if (SECTORS[type]) await buyPanel(type);
  else if (type === 'chance') {
    const c = await drawEventCards(false);
    if (c.special) await enterLane(true, c.special);
  } else if (type === 'fee') { ENG.payFee(S, S.players[S.hi]); hud(); sfx('short'); await cardPanel(L('Trading fees', '交易手續費'), L(`Every trade has a cost. You paid $${FEE}.`, `每筆交易都有成本,這次付了 $${FEE}。`)); }
  else if (type === 'shop') await shopPanel();
  else if (type === 'bank') await bankPanel();
  else if (type === 'gift' || type === '_gift') { const id = await drawGiftCards(false); S.bag.push(id); hud(); toast(L(`${itemInfo(id).name} added to your backpack`, `${itemInfo(id).name}已放進背包`)); }
  else if (type === 'divi') await cardPanel(L('Dividend day', '股息結算'), L(`You collected $${fmt(S.lastDividend)} in dividends. Assets that pay nothing, like gold, biotech and crypto, only make money if the price rises.`, `領到股利 $${fmt(S.lastDividend)}。黃金、生技、加密貨幣不配息,只能靠價格上漲賺錢。`));
  else await cardPanel(L('Payday', '發薪日'), L(`Salary $${fmt(S.players[S.hi].lastSalary || SALARY)}. Dividends do not wait for a lap: dividend stocks pay you every round.`, `薪水 $${fmt(S.players[S.hi].lastSalary || SALARY)}。股利不用等繞一圈,持有配息股每回合都會領。`));   // 起點只發薪水(升職加薪會是兩倍)
}
async function nextTurns() {
  let i = S.hi;
  for (;;) {
    i = (i + 1) % S.players.length;
    if (i === 0) {
      // 大家都走完一輪:系統自動抽一張市場事件(事件才不會太久才出現一次),再檢查有沒有人被斷頭 / 軋空
      await wait(0.3); await drawEventCards(true, true); await flushNotices(); checkMissions(); checkBotMissions();
      if (S.rolls >= maxRolls()) { await wait(0.4); return finish(); }
    }
    const p = S.players[i];
    if (p.human) {
      S.turn = i; S.view = null; S.hi = i; if (S.players.length > S.nh) S.ci = S.players.findIndex((x) => !x.human); else S.ci = (i + 1) % S.players.length;
      focus = PM(); pan.set(0, 0, 0);
      setPortraits();
      if (S.nh > 1) { toast(L(`${nameOf(p)}'s turn (Player ${i + 1})`, `輪到${nameOf(p)}(玩家 ${i + 1})`)); }
      checkMissions();          // 別人走的時候股價會變,輪到自己先檢查一次任務
      S.busy = false; showCtl(true); remoteBanner(); return;
    }
    S.ci = i; S.turn = i; S.view = null; hud(); setPortraits(); remoteBanner(); await aiTurn(); await flushNotices();
    { const A = S.players[i]; A.cashStreak = (KEYS.some((k) => A.hold[k].n > 0) && A.cash >= 2000) ? (A.cashStreak || 0) + 1 : 0; }   // 保留現金成就用
    if (checkBotMissions(S.players[i])) await wait(1.2);   // 有達成就停一下讓公告看得到
  }
}
// 本機排行榜:每局結束存一筆到瀏覽器(只有第一位真人的成績),留最好的 20 筆(依總資產)
const rankMark = (i) => (i < 3 ? ['🥇', '🥈', '🥉'][i] : String(i + 1));      // 前三名用獎牌,其餘數字
const loadRecords = () => { try { return JSON.parse(localStorage.getItem('css.records')) || []; } catch (e) { return []; } };
function saveRecord(r) {
  const list = loadRecords(); list.push(r); list.sort((a, b) => b.assets - a.assets);
  try { localStorage.setItem('css.records', JSON.stringify(list.slice(0, 20))); } catch (e) {}
}
// 這一局在排行榜裡的那一筆(用內容比對,因為存進去再讀出來已經不是同一個物件)
const findRecord = (r) => loadRecords().find((x) => x.date === r.date && x.assets === r.assets && x.char === r.char && x.rounds === r.rounds) || null;
const bestOf = () => { const l = loadRecords(); return { games: l.length, best: l[0] || null, stars3: l.filter((r) => r.stars === 3).length, wins: l.filter((r) => r.rank === 1).length }; };
// 全球排行榜:Cloudflare Worker + D1(程式在 repo 的 worker/)。本機測試(localhost)預設不送,網址加 ?lb=1 才送
const LB_API = `${location.origin}/api/board`;   // 排行榜 Worker 掛在網頁同一個網域的 /api/board 底下
const LB_ON = !/^(localhost|127\.|\[::1\])/.test(location.hostname) || new URLSearchParams(location.search).get('lb') === '1';
let lbState = { status: 'idle', rank: null, top: null };      // status: idle | sending | ok | error
async function submitGlobal(rec) {
  if (!LB_ON) { lbState = { ...lbState, status: 'off' }; return; }
  lbState = { ...lbState, status: 'sending', rank: null, top: null };
  try {
    const r = await fetch(`${LB_API}/submit`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: rec.name || CHARS[rec.char].name, char: rec.char, assets: rec.assets, rounds: rec.rounds, players: rec.n, ai: S.aiLevel, lang: ZH ? 'zh' : 'en' }) });
    if (!r.ok) throw new Error(r.status);
    const d = await r.json(); lbState = { ...lbState, status: 'ok', rank: d.rank, top: d.top };
  } catch (e) { lbState = { ...lbState, status: 'error', rank: null, top: null }; }
  const box = document.getElementById('lbGlobal'); if (box) { box.innerHTML = globalBox(); paintPortraits(box); }
}
async function fetchGlobal() {
  try { const r = await fetch(`${LB_API}/top?limit=20`); const d = await r.json(); lbState.top = d.top; if (lbState.status !== 'ok' && lbState.status !== 'off') lbState.status = 'ok'; } catch (e) { lbState.status = 'error'; }
  const box = document.getElementById('lbGlobal'); if (box) { box.innerHTML = globalBox(); paintPortraits(box); }
}
function globalBox() {
  const st = lbState, when = (t) => new Date(t * 1000).toISOString().slice(5, 10);
  const head = `<h4><img class="emo" src="ico-globe.webp?v=1" alt=""> ${L('Global leaderboard', '全球排行榜')}</h4>`;
  if (st.status === 'sending' || ((st.status === 'idle' || st.status === 'off') && !st.top)) return `${head}<p>${L('Loading…', '載入中…')}</p>`;
  if (st.status === 'error' && !st.top) return `${head}<p>${L('Could not reach the leaderboard. Check your connection.', '連不上排行榜,請檢查網路。')}</p>`;
  const rows = (st.top || []).map((r, i) => `<div class="rrow ${st.rank === i + 1 && st.mine && r.assets === st.mine.assets && r.name === st.mine.name ? 'me' : ''}">
      <span class="rk">${rankMark(i)}</span><span class="ic mini" data-char="${r.char}"></span>
      <div class="c"><b>${r.name} · $${fmt(r.assets)}</b><small>${r.rounds}${L(' rd', ' 回合')} · ${r.players}${L('p', ' 人')} · ${{ easy: L('easy', '簡單'), normal: L('normal', '一般'), hard: L('hard', '兇狠') }[r.ai] || r.ai} · ${when(r.created_at)}</small></div></div>`).join('');
  return `${head}<p>${st.rank ? L(`This game ranks #${st.rank} worldwide`, `這一局在全球排第 ${st.rank} 名`) : st.status === 'off' ? L('Local test: score not sent.', '本機測試,成績不上傳。') : L('Top 20 players worldwide', '全球前 20 名')}</p>
    ${rows || `<p>${L('No scores yet. Be the first!', '還沒有人上榜,來當第一個!')}</p>`}
    <small class="note2">${L('Top 20 by total assets across all players.', '所有玩家依總資產排前 20 名。')}</small>`;
}
// 排行榜面板:本機 / 全球 兩個分頁
function leaderboardPanel(myRec) {
  const p = panel(`<div class="lbtabs"><button class="on" data-t="local"><img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L('This device', '本機')}</button><button data-t="global"><img class="emo" src="ico-globe.webp?v=1" alt=""> ${L('Global', '全球')}</button></div>
    <div id="lbLocal" class="lblist">${recordsBox(myRec)}</div><div id="lbGlobal" class="rbox lblist hide">${globalBox()}</div>
    <div class="btns"><button class="b-skip" id="recClose">${L('Close', '關閉')}</button></div>`);
  p.querySelector('#recClose').onclick = closePanel;
  p.querySelectorAll('.lbtabs button').forEach((b) => b.onclick = () => {
    p.querySelectorAll('.lbtabs button').forEach((x) => x.classList.toggle('on', x === b));
    p.querySelector('#lbLocal').classList.toggle('hide', b.dataset.t !== 'local'); p.querySelector('#lbGlobal').classList.toggle('hide', b.dataset.t !== 'global');
    if (b.dataset.t === 'global' && lbState.status !== 'sending') fetchGlobal();
  });
}
// 結算畫面右側的排行榜:1~10 名,這一局的那筆會亮起來
function recordsBox(cur) {
  const list = loadRecords(), best = bestOf();
  const same = (a, b) => a && b && a.date === b.date && a.assets === b.assets && a.char === b.char && a.rounds === b.rounds;
  const rows = list.map((r, i) => `<div class="rrow ${same(r, cur) ? 'me' : ''}">
      <span class="rk">${rankMark(i)}</span><span class="ic mini" data-char="${r.char}"></span>
      <div class="c"><b>${r.name ? `${r.name} · ` : ''}$${fmt(r.assets)}</b><small>${r.rounds}${L(' rd', ' 回合')} · ${r.n}${L('p', ' 人')} · ${L('#', '第 ')}${r.rank}${L('', ' 名')} · ${r.date.slice(5)}</small></div>
      <span class="st">${'★'.repeat(r.stars)}<i>${'★'.repeat(3 - r.stars)}</i></span></div>`).join('');
  return `<div class="rbox"><h4><img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L('Leaderboard', '排行榜')}</h4>
    <p>${L(`${best.games} game${best.games > 1 ? 's' : ''} · ${best.wins} win${best.wins === 1 ? '' : 's'} · ${best.stars3} three-star`, `已記錄 ${best.games} 局 · 第一名 ${best.wins} 次 · 三顆星 ${best.stars3} 次`)}</p>
    ${rows || `<p>${L('No games finished yet.', '還沒有完成過的對局。')}</p>`}
    <small class="note2">${L('Top 20 by total assets, saved in this browser.', '依總資產排前 20 名,只存在這個瀏覽器裡。')}</small></div>`;
}
function finish() {
  S.over = true; S.hi = S.players.findIndex((p) => p.human);      // 結算畫面用第一位真人的視角
  // 星星:完成 2 / 4 / 6 個任務
  const done = S.done >= 6 ? 3 : S.done >= 4 ? 2 : S.done >= 2 ? 1 : 0;
  const rank = S.players.slice().sort((x, y) => assetsOf(y) - assetsOf(x)), medal = ['🥇', '🥈', '🥉', '4'];
  const won = rank[0].human;
  // 存紀錄(第一位真人),並拿歷史最佳來比
  const me0 = S.players[S.hi], myRank = 1 + rank.findIndex((p) => p === me0), rec = { date: new Date().toISOString().slice(0, 10), char: me0.char, name: me0.name || '', n: S.players.length, rounds: S.rolls, assets: Math.round(assetsOf(me0)), done: S.done, stars: done, rank: myRank };
  const prev = bestOf(); saveRecord(rec); const after = bestOf();
  lbState = { status: 'idle', rank: null, top: null, mine: { name: rec.name || CHARS[rec.char].name, assets: rec.assets } }; submitGlobal(rec);      // 同時上傳到全球排行榜(背景進行)
  const newBest = !prev.best || rec.assets > prev.best.assets;
  // 成績卡上一個「看排行榜」按鈕,點了才疊一塊 1~10 名的排行榜(內容和右側版一樣)
  const recLine = `<p style="font-size:calc(12.5px * var(--fs))">${newBest ? `<img class="emo" src="ico-trophy.webp?v=1" alt=""> <b>${L('New personal best!', '新的個人最佳紀錄!')}</b> ` : ''}<button class="lnk" id="recBtn"><img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L('Leaderboard', '看排行榜')}</button></p>`;
  // 結算畫面:標題(你獲勝 / ○○獲勝)+ 自己這局的總資產 + 可捲動的全球排行榜 + 再玩一次 / 下載 App / 退出
  const credit = `<p style="margin:10px 0 0;font-size:calc(10.5px * var(--fs));color:#b5a593">${L('Fictional companies · for learning, not investment advice · Music & SFX: Mixkit', '公司皆為虛構 · 學習用途,非投資建議 · 音樂 / 音效:Mixkit')} · v${VER}</p>`;
  const meA = assetsOf(me0), youWon = rank[0] === me0;
  $('end').innerHTML = `<div class="card endcard">
    <h2>${youWon ? `<img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L('You win!', '你獲勝!')}` : `<img class="emo" src="ico-trophy.webp?v=1" alt=""> ${L(`${nameOf(rank[0])} wins`, `${nameOf(rank[0])}獲勝`)}`}</h2>
    <p>${L(`You: #${myRank} · $${fmt(meA)} · ${S.rolls} rounds`, `你:第 ${myRank} 名 · $${fmt(meA)} · ${S.rolls} 回合`)}${newBest ? ` · <img class="emo" src="ico-trophy.webp?v=1" alt=""> <b>${L('New best!', '新紀錄!')}</b>` : ''}</p>
    <div id="lbGlobal" class="rbox lblist endlb">${globalBox()}</div>
    <div class="btns"><button class="b-skip" id="again">${L('Play again', '再玩一次')}</button><button class="b-ok" id="app">${L('Get the app', '下載 App')}</button><button class="b-sell" id="quit">${L('Exit', '退出')}</button></div>${credit}</div>`;
  $('end').classList.remove('hide'); sfx(won ? 'win' : 'lose'); remoteBanner(); paintPortraits($('end'));
  $('again').onclick = start;
  $('app').onclick = () => window.open(APP_URL, '_blank', 'noopener');
  // 退出:嵌在街機裡就請外面的房間頁把遊戲關掉;單獨開的就回房間頁
  $('quit').onclick = () => { if (EMBED) { try { parent.postMessage({ type: 'css-exit' }, location.origin); } catch (e) {} } else location.href = '../'; };
  if (lbState.status !== 'sending') fetchGlobal();
}
/* ───────────── 線上同樂(主機端) ─────────────
   這台是主機:遊戲照常在這裡跑。手機掃 QR 進房間後只是「遙控器」:主機把面板(擲骰、買賣、翻牌…)的 HTML 鏡射到手機,
   手機上按了哪個鈕就回傳給主機,主機再當成自己被點了。房間是 Cloudflare Durable Object,只轉送訊息。 */
const NET = { on: false, code: null, ws: null, guests: [], started: false, retry: 0 };      // guests: { gid, conn, name, char, online }
const netSend = (msg, to) => { if (NET.on && NET.ws && NET.ws.readyState === 1) { try { NET.ws.send(JSON.stringify(to ? { ...msg, to } : msg)); } catch (e) {} } };
const joinUrl = (code) => { const u = new URL('join/', location.href); u.search = `?r=${code}`; return u.href; };
async function netOpen() {
  try {
    $('pcOnline').disabled = true;
    const r = await fetch(`${LB_API}/room/new`, { method: 'POST' }); const d = await r.json();
    NET.code = d.code; NET.on = true; NET.guests = []; NET.started = false; netConnect(); lobbyPaint(); paintStage();
  } catch (e) { toast(L('Could not create a room', '開房間失敗,請檢查網路')); }
  $('pcOnline').disabled = false;
}
function netClose() { NET.on = false; if (lobbyPhase) { lobbyPhase = false; $('lobbyUI').classList.add('hide'); document.querySelector('.ptop').classList.remove('hide'); document.querySelector('.pbar').classList.remove('hide'); lobbySeats.forEach((st) => { st.g.visible = false; }); } clearTimeout(NET.retry); if (NET.ws) { try { NET.ws.close(); } catch (e) {} } NET.ws = null; NET.guests = []; NET.started = false; NET.code = null; lobbyPaint(); }
function netConnect() {
  if (!NET.on) return;
  const ws = new WebSocket(`${LB_API.replace(/^http/, 'ws')}/room/${NET.code}/ws?role=host`); NET.ws = ws;
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } netOnMsg(m); };
  ws.onclose = () => { if (NET.on && NET.ws === ws) NET.retry = setTimeout(netConnect, 1500); };
}
const guestByConn = (c) => NET.guests.find((g) => g.conn === c);
const hostChar = () => slots[stageSel].key;
const charTakenBy = (k, except) => (k === hostChar() ? 'host' : NET.guests.find((g) => g !== except && g.char === k) || null);
function netOnMsg(m) {
  if (m.t === 'conn') { netLobby(m.from); return; }
  if (m.t === 'gone') { const g = guestByConn(m.from); if (!g) return; g.online = false; g.conn = null;
    if (!NET.started) { NET.guests.splice(NET.guests.indexOf(g), 1); toast(L(`${g.name} left the room`, `${g.name} 離開了房間`)); } else toast(L(`${g.name} disconnected`, `${g.name}斷線了`));
    lobbyPaint(); netLobby(); remoteBanner(); return; }
  if (m.t === 'join') {
    const name = String(m.name || '').replace(/[<>]/g, '').trim().slice(0, 12) || L('Player', '玩家'), gid = String(m.gid || '').slice(0, 24);
    let g = NET.guests.find((x) => x.gid === gid);
    if (NET.started) {         // 遊戲中重連:認 gid 找回座位
      if (!g) { netSend({ t: 'joined', ok: false, reason: 'started' }, m.from); return; }
      g.conn = m.from; g.online = true; netSend({ t: 'joined', ok: true, gid, char: g.char, name: g.name, started: true }, m.from); netPushAll(g); remoteBanner(); return;
    }
    if (!g && NET.guests.filter((x) => x.online).length >= 4) { netSend({ t: 'joined', ok: false, reason: 'full' }, m.from); return; }
    let char = m.char; if (!CHARS[char] || charTakenBy(char, g)) char = Object.keys(CHARS).find((k) => !charTakenBy(k, g));
    // 主機畫面上提示:誰用什麼角色加入了 / 換了角色 / 改了名字
    if (g) Object.assign(g, { conn: m.from, online: true, name, char }); else { g = { gid, conn: m.from, name, char, online: true }; NET.guests.push(g); }
    netSend({ t: 'joined', ok: true, gid, char, name }, m.from); lobbyPaint(); paintStage(); netLobby(); return;
  }
  const g = guestByConn(m.from); if (!g || !NET.started || !S) return;
  if (m.t === 'ready') { g.ready = true; return; }      // 手機看完規則卡(重連時就不再補送)
  const p = S.players[S.turn]; if (!p || !p.human || p.remote !== g.gid) return;      // 只有輪到的那支手機可以操作
  if (m.t === 'click' && m.box !== 'end') { const b = $(m.box)?.querySelectorAll('button, .dcard')[m.idx | 0]; if (b && !b.disabled) b.click(); }
  else if (m.t === 'input') { const inp = $(m.box)?.querySelectorAll('input')[m.idx | 0]; if (inp) { inp.value = m.value; inp.dispatchEvent(new Event('input', { bubbles: true })); inp.dispatchEvent(new Event('change', { bubbles: true })); } }
}
// 大廳:告訴手機房號、哪些角色還能選、誰已經加入。主機換角色時,被撞到的手機自動換成別的角色
function netLobby(to) {
  if (!NET.on || NET.started) return;
  NET.guests.forEach((g) => { if (g.char === hostChar() || NET.guests.some((o) => o !== g && o.char === g.char && NET.guests.indexOf(o) < NET.guests.indexOf(g))) { g.char = Object.keys(CHARS).find((k) => !charTakenBy(k, g)); if (g.conn) netSend({ t: 'joined', ok: true, gid: g.gid, char: g.char, name: g.name }, g.conn); } });
  netSend({ t: 'lobby', code: NET.code, chars: Object.keys(CHARS).map((k) => { const by = charTakenBy(k); return { k, name: CHARS[k].name, icon: CHARS[k].icon, url: CHARS[k].url, h: CHARS[k].h, color: CHARS[k].color, taken: by ? (by === 'host' ? 'host' : by.gid) : null }; }),
    guests: NET.guests.filter((g) => g.online).map((g) => ({ gid: g.gid, name: g.name, char: g.char })), host: { char: hostChar(), name: $('pnameIn').value.trim().slice(0, 12) } }, to);
}
let qrLib = null;
function lobbyPaint() {
  const box = $('lobbyCard'); if (!box) return;
  syncJoined(NET.on && !NET.started ? NET.guests : []);
  $('pcOnT').textContent = NET.on ? L('Close room', '關閉房間') : L('Multiplayer', '多人連線'); $('pcOnS').textContent = NET.on ? L(`Room ${NET.code} is open`, `房間 ${NET.code} 開著`) : L('Scan a QR code to join', '掃描 QR Code 加入房間');
  $('pcOnline').classList.toggle('on', NET.on);
  $('lobby').classList.toggle('hide', !NET.on);      // 設定卡裡也放一份 QR / 房號(按下多人連線就看得到)
  if (!NET.on) return;
  const gs = NET.guests.filter((g) => g.online);
  // QR + 房號 + 「分享連結」:手機上會跳出系統分享(LINE / Instagram / 訊息…),電腦就複製到剪貼簿
  const html = `<div class="qr"></div><div class="info"><b>${L('Room', '房號')} <span class="code">${NET.code}</span></b><button class="share" type="button">${L('Share link', '分享連結')}</button></div>`;
  box.innerHTML = html; $('lobby').innerHTML = html;
  document.querySelectorAll('#lobbyCard .share, #lobby .share').forEach((b) => { b.onclick = async (e) => { e.stopPropagation();
    const url = joinUrl(NET.code), text = L(`Join my Cat Street Stocks game! Room ${NET.code}`, `來玩貓咪股市大富翁!房號 ${NET.code}`);
    try { if (navigator.share) { await navigator.share({ title: L('Cat Street Stocks', '貓咪股市大富翁'), text, url }); return; } } catch (err) { if (err && err.name === 'AbortError') return; }
    try { await navigator.clipboard.writeText(url); toast(L('Link copied', '連結已複製')); } catch (err) { toast(url); } }; });
  const draw = () => { try { const q = qrLib(0, 'M'); q.addData(joinUrl(NET.code)); q.make(); const svg = q.createSvgTag({ cellSize: 3, margin: 1, scalable: true }); document.querySelectorAll('#lobbyCard .qr, #lobby .qr').forEach((el) => { el.innerHTML = svg; }); } catch (e) {} };
  if (qrLib) draw();
  else if (window.qrcode) { qrLib = window.qrcode; draw(); }
  else if (!document.getElementById('qrlib')) { const sc = document.createElement('script'); sc.id = 'qrlib'; sc.src = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js'; sc.onload = () => { qrLib = window.qrcode; draw(); }; document.head.appendChild(sc); }
  else document.getElementById('qrlib').addEventListener('load', () => { qrLib = window.qrcode; draw(); });
}
// 鏡射:這幾個區塊一有變動就把 HTML 送到手機(同一幀內合併成一次)
const MIRROR = ['ctl', 'stepCtl', 'panel', 'draw', 'end'], uiLast = {}; let uiQueued = false;
function netUiFlush(to) {
  uiQueued = false; if (!NET.on || !NET.started) return;
  for (const id of MIRROR) { const el = $(id); if (el.classList.contains('nomirror')) continue; const key = el.className + '\u0001' + el.innerHTML; if (!to && uiLast[id] === key) continue; if (!to) uiLast[id] = key; netSend({ t: 'ui', box: id, cls: el.className, html: el.innerHTML }, to); }
}
const netUi = () => { if (!uiQueued && NET.on && NET.started) { uiQueued = true; setTimeout(() => netUiFlush(), 0); } };   // 用 setTimeout 不用 rAF:主機分頁在背景時 rAF 不會跑
{ const mo = new MutationObserver(netUi); MIRROR.forEach((id) => mo.observe($(id), { childList: true, subtree: true, attributes: true, characterData: true })); }
// 每支手機自己的資產和「現在輪到誰」
// 每支手機自己視角的 HUD(金錢列、名次、提示、頭像欄、每位玩家的資產、任務、事件)。hud() 每次更新都送;同一幀內合併
let hudQueued = false;
function netHud(to) {
  if (!NET.on || !NET.started || !S) return;
  if (!to) { if (hudQueued) return; hudQueued = true; setTimeout(() => { hudQueued = false; netHudNow(); }, 0); } else netHudNow(to);
}
function netHudNow(to) {
  const cur = S.players[S.turn];
  for (const g of NET.guests) { if (!g.online || (to && g !== to)) continue; const p = S.players.find((x) => x.remote === g.gid); if (!p) continue;
    const myA = assetsOf(p), rank = 1 + S.players.filter((q) => assetsOf(q) > myA + 0.5).length;
    netSend({ t: 'hud', me: p.i, turn: S.turn, mine: cur === p, over: !!S.over,
      cash: fmt(p.cash), assets: fmt(myA), stocks: fmt(KEYS.reduce((a, k) => a + p.hold[k].n * S.price[k], 0)), mcount: p.done, bag: p.bag.length,
      rank: ordinal(rank), top: rank === 1, spy: p.spy && S.rolls < p.spy.until ? p.spy.target : -1, spyLeft: spyLeft(p),
      tip: S.hi === p.i ? advise() : L(`${nameOf(cur)}'s turn`, `現在是${nameOf(cur)}的回合`),
      players: S.players.map((q) => ({ i: q.i, char: q.char, rank: ordinal(rankOf(q)), top: rankOf(q) === 1, title: (q === p ? L('My assets', '我的資產') : L(`${nameOf(q)}'s assets`, `${nameOf(q)}的資產`)) + ' · $' + fmt(assetsOf(q)), rows: assetRowsHtml(q, q === p) })),
      missTitle: L(`Achievements · ${p.done} unlocked`, `任務 · 完成 ${p.done}`), missBadge: (p.missions || []).filter((m) => !m.done).length, miss: missHtml(p),
      evtTitle: $('evtTitle').textContent, evt: $('evtBody').innerHTML, evtUp: $('evtBox').classList.contains('mk-up'), round: $('roundTxt').textContent,
      holds: S.players.map((q) => Object.fromEntries(KEYS.filter((k) => q.hold[k].n > 0).map((k) => [k, q.hold[k].n]))) }, g.conn); }
}
function netInit(g) {
  if (!S || !NET.started) return; const me = S.players.findIndex((p) => p.remote === g.gid);
  netSend({ t: 'init', chars: S.players.map((p) => p.char), names: S.players.map((p) => p.name || ''), humans: S.nh, remote: S.players.map((p) => p.remote || null), me, turn: S.turn,
    pos: S.players.map((p) => p.pos), lane: S.players.map((p) => p.lane), price: S.price, lanePath: S.lanePath, rolls: S.rolls, maxRounds: S.maxRounds }, g.conn);
}
function netPushAll(g) { netInit(g); netHud(g); netUiFlush(g.conn); if (NET.rules && !g.ready) netSend({ t: 'rules', ...NET.rules }, g.conn); }
// 輪到手機上的玩家:主機畫面上的按鈕鎖住(不然主機可以幫他按),顯示等待提示。那支手機斷線的話就解鎖讓主機代打
function remoteBanner() {
  const p = S && S.players[S.turn], g = p && p.remote && NET.guests.find((x) => x.gid === p.remote), on = !!(g && g.online && !S.over);
  document.body.classList.toggle('remote', on);
  $('remoteBanner').classList.add('hide');      // 不顯示「等待 ○○ 在手機上操作」那行字,只鎖按鈕
  netHud();
}
// 選角:在 3D 轉盤上選(pickStage),同時決定人數(2~4)和真人數(1~2)。電腦對手從剩下的角色裡隨機挑。
// 網址 ?piece=cat 可以跳過選角(測試用),還可以加 &n=4&h=2 指定人數和真人數
async function start() {
  newState(); $('end').classList.add('hide'); closePanel(); $('toast').classList.remove('on');   // 上一局最後的提示不要留到選角畫面
  staticText(); PIECES.forEach((P) => placePiece(0, P)); focus = PIECES[0]; diceSpots(PIECES[0]); dice.forEach((d, i) => d.position.copy(DIE_REST[i])); drawAll(); drawLanes();
  S.busy = true; showCtl(false); hud(); AU.ambience(false);   // 選角畫面:環境音淡出
  let cfg;
  if (CHARS[PRESET]) { const q = new URLSearchParams(location.search), n = Math.min(4, Math.max(2, +q.get('n') || 2)), h = Math.min(2, Math.max(1, +q.get('h') || 1));
    const rest = Object.keys(CHARS).filter((k) => k !== PRESET).sort(() => Math.random() - 0.5);
    cfg = { chars: [PRESET, ...rest.slice(0, n - 1)], humans: h, rounds: q.get('rounds'), ai: q.get('ai'), names: [q.get('name') || ''] };
  } else cfg = await pickStage();
  setPlayers(cfg.chars, cfg.humans, cfg.names || []); { const off = cfg.hostPlays === false ? 0 : 1; (cfg.remote || []).forEach((gid, j) => { if (S.players[off + j]) S.players[off + j].remote = gid; }); } S.maxRounds = ROUND_OPTS.includes(+cfg.rounds) ? +cfg.rounds : MAX_ROLLS; S.aiLevel = SIM.LEVELS[cfg.ai] ? cfg.ai : 'normal';
  PIECES.forEach((P, i) => { if (i < S.players.length) { setChar(P.body, S.players[i].char); placePiece(0, P); } });
  showPieces(true); focus = PIECES[0];
  buildFoes(); setPortraits();
  hud(); AU.ambience(true);   // 進入遊戲:森林鳥鳴淡入
  // 開局先講清楚怎麼算贏
  const rule = L(`After ${S.maxRounds} rounds, whoever has the highest total assets wins.`, `${S.maxRounds} 回合結束時,總資產最高的人獲勝。`);
  const rulesTitle = L('How to win', '獲勝條件'), rulesBody = rule + L(` Total assets = cash + the value of your holdings − loans. Everyone starts with $${fmt(START_CASH)}.<br><br>The whole market drifts every round: it starts going up, big bad news (wars, crises) turns it down, and good news (rate cuts, strong jobs) turns it back up. Company news does not change it.<br><br>Achievements (on the right) are a bonus: each one pays $${REWARD} and can be earned once. They do not decide the winner.<br><br>Your current place is shown next to the round bar.`,
      `總資產 = 現金 + 持有資產的市值 − 貸款,每個人都從 $${fmt(START_CASH)} 開始。<br><br>大盤每回合都會跟著趨勢漲跌:一開始往上,戰爭、金融危機這類大壞消息會讓大盤轉空,降息、就業強勁這類好消息再轉回多頭;個別公司的新聞不影響大盤。<br><br>右邊的任務是成就:每達成一個得 $${REWARD},每個只能拿一次,但不決定輸贏。<br><br>回合條旁邊會顯示你目前第幾名。`);
  // 線上同樂:規則卡每個人在自己裝置上看、自己按繼續(閱讀速度不同);主機按完就開始,不等別人(別人沒按完也擲不了骰)
  if (NET.on && NET.started) {
    NET.rules = { title: rulesTitle, body: rulesBody }; NET.guests.forEach((g) => { g.ready = false; });
    netSend({ t: 'rules', title: rulesTitle, body: rulesBody });
    const pr = cardPanel(rulesTitle, rulesBody); $('panel').classList.add('nomirror'); await pr; $('panel').classList.remove('nomirror');   // 主機自己的規則卡不鏡射給手機(手機有自己的)
  } else await cardPanel(rulesTitle, rulesBody);
  S.busy = false; showCtl(true);
  if (S.nh > 1) toast(L(`${nameOf(S.players[0])} goes first (Player 1)`, `${nameOf(S.players[0])}先走(玩家 1)`));
}

$('rollBtn').onclick = () => turn();
document.addEventListener('click', (e) => { if (CLIENT && e.target.closest('#ctl, #stepCtl, #panel, #draw, #end')) return; if (e.target.closest('button, .dcard, .bubble')) sfx('click'); });
// 面板標題旁的「?」:手機沒有 hover,點一下開 / 關;點別處關掉
document.addEventListener('click', (e) => { const t = e.target.closest('.mtabs button'); if (t) $('missBox').dataset.tab = t.dataset.mt; });   // 任務框分頁(主機和手機都是本機切換)
document.addEventListener('keydown', (e) => { const h = e.target.closest && e.target.closest('.panel h3 .help'); if (h && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); h.classList.toggle('open'); } });   // 鍵盤也能開關說明
document.addEventListener('click', (e) => { const h = e.target.closest('.panel h3 .help'); document.querySelectorAll('.panel h3 .help.open').forEach((x) => { if (x !== h) x.classList.remove('open'); }); if (h) h.classList.toggle('open'); });   // 任何按鈕 / 牌 / 提示泡泡按下都有聲(手機上鏡射區的按鈕由主機轉送點擊聲,不重複)
// 滑鼠移到任何按鈕 / 卡片上都有一聲(只有有滑鼠的裝置;同一顆按鈕不重複響)
if (matchMedia('(hover:hover)').matches) { let lastHover = null;
  document.addEventListener('mouseover', (e) => { const b = e.target.closest('button, .dcard, .rb, .stockbtn, .bubble'); if (!b || b === lastHover) { if (!b) lastHover = null; return; } lastHover = b; if (b.disabled) return; sfx('hover'); });
  document.addEventListener('mouseout', (e) => { const b = e.target.closest('button, .dcard, .rb, .stockbtn, .bubble'); if (b && b === lastHover && !b.contains(e.relatedTarget)) lastHover = null; }); }
{ const b = $('sndBtn'), paint = () => { b.classList.toggle('off', !AU.on); b.setAttribute('aria-label', AU.on ? 'sound on' : 'sound off'); };
  b.onclick = () => { AU.toggle(); paint(); }; paint(); }
// 全螢幕:嵌在街機裡時請外面的房間頁把整個網站放到全螢幕(iframe 自己不能);單獨開遊戲就直接全螢幕。
// iPhone 的 Safari 沒有全螢幕 API,按鈕就不顯示(iPad、電腦都有)
{ const b = $('fsBtn'), doc = document, el = doc.documentElement;
  const can = EMBED || !!(doc.fullscreenEnabled || doc.webkitFullscreenEnabled);
  if (can) b.classList.remove('hide');
  const isFs = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  b.onclick = () => {
    if (EMBED) { try { parent.postMessage({ type: 'css-fullscreen' }, location.origin); } catch (e) {} return; }
    if (isFs()) (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc);
    else (el.requestFullscreen || el.webkitRequestFullscreen).call(el);
  };
  // 圖示:進全螢幕是四角往外的箭頭,退出是往內的箭頭(不用 ✕,免得和離開遊戲的 ✕ 搞混)
  const ICON = { out: '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg>', in: '<svg viewBox="0 0 24 24"><path d="M9 4v5H4M15 4v5h5M20 15h-5v5M4 15h5v5"/></svg>' };
  const paint = (on = isFs()) => { b.innerHTML = on ? ICON.in : ICON.out; b.setAttribute('aria-label', on ? 'exit fullscreen' : 'fullscreen'); }; paint();
  doc.addEventListener('fullscreenchange', () => paint()); doc.addEventListener('webkitfullscreenchange', () => paint());
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'css-fullscreen-state') paint(!!e.data.on); });
}
$('bagBtn').onclick = bagPanel;
$('stockBtn').onclick = () => { if (!S || !S.players.length) return; const box = $('assetBox'); if (!box.classList.contains('fold') && (S.view ?? meP().i) === meP().i) box.classList.add('fold'); else { S.view = meP().i; box.classList.remove('fold'); } hud(); };
// 提示泡泡:手機預設縮成「!」,點一下展開 / 收起
{ const tb = $('tipbar'); if (matchMedia('(max-width:900px)').matches) tb.classList.add('min'); tb.querySelector('.bubble').onclick = () => tb.classList.toggle('min');
  tb.addEventListener('animationend', (e) => { if (e.animationName === 'tipPulse') tb.classList.remove('pulse'); }); }   // 閃完把 pulse 拿掉,平常的小跳動才會回來

document.querySelectorAll('#dsel button').forEach((b) => { b.onclick = () => { if (S.busy) return; S.diceN = +b.dataset.n; hud(); }; });

if (new URLSearchParams(location.search).get('embed')) document.body.classList.add('embed');   // 嵌在街機裡:右上角留位置給離開鈕
// 右側兩個面板的標題可以點:三角箭頭收合 / 展開
document.querySelectorAll('.lcol .box h4').forEach((h) => { h.onclick = () => h.parentElement.classList.toggle('fold'); });
$('assetBox').classList.add('fold');   // 資產框預設收起,點頭像展開、再點收起
// 右邊兩顆圖示鈕:點了在旁邊彈出市場事件 / 任務框(一次只開一個;點標題或再點一次收起)
{ const pair = { evtBtn: 'evtBox', missBtn: 'missBox' };
  const toggle = (id) => { const want = $(pair[id]).classList.contains('fold'); Object.values(pair).forEach((b) => $(b).classList.add('fold')); Object.keys(pair).forEach((k) => $(k).classList.remove('on'));
    if (want) { $(pair[id]).classList.remove('fold'); $(id).classList.add('on'); if (id === 'evtBtn') $('evtBadge').classList.add('hide'); } };
  Object.keys(pair).forEach((id) => { $(id).onclick = () => toggle(id); $(pair[id]).querySelector('h4').onclick = () => toggle(id); });
  $('evtLbl').textContent = L('Events', '事件'); $('missLbl').textContent = L('Achievements', '任務');
  // 標籤超出螢幕右邊時往左推(視窗大小改變時重算)
  const fitLbl = () => { const el = $('missLbl'); el.style.setProperty('--lblShift', '0px'); const over = el.getBoundingClientRect().right - (innerWidth - 6); if (over > 0) el.style.setProperty('--lblShift', `${-Math.ceil(over)}px`); };
  fitLbl(); addEventListener('resize', fitLbl); }

/* ───────────── 線上同樂:手機端(自己畫棋盤) ─────────────
   手機用同一份棋盤程式,但不跑規則:主機廣播「誰跳到哪一格、擲到幾點、股價、小路、面板 HTML、自己的 HUD」,
   這裡照著演。鏡頭跟著自己的棋子,拖曳 / 縮放都是本機的。 */
function clientInit() {
  const q = new URLSearchParams(location.search), code = CLIENT.toUpperCase(), gid = q.get('gid') || sessionStorage.gid || ('p' + Math.random().toString(36).slice(2, 10));
  sessionStorage.gid = gid;
  document.body.classList.add('client'); document.body.classList.remove('picking'); stage.visible = false; stageOn = false;
  newState(); S.busy = true; staticText();
  let ws = null, me = 0; const queues = [];
  const send = (m) => { if (ws && ws.readyState === 1) ws.send(JSON.stringify(m)); };
  const enqueue = (p, fn) => { queues[p] = (queues[p] || Promise.resolve()).then(fn).catch((e) => console.warn('[client]', e)); };
  const connect = () => {
    ws = new WebSocket(`${LB_API.replace(/^http/, 'ws')}/room/${code}/ws?role=guest`);
    ws.onopen = () => { send({ t: 'join', gid, name: localStorage.getItem('css.jname') || '', char: sessionStorage.getItem('css.jchar') || '' }); };
    ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
    ws.onclose = () => setTimeout(connect, 2000);
  };
  function onMsg(m) {
    if (m.t === 'init') {
      setPlayers(m.chars, m.humans, m.names); m.remote.forEach((g, i) => { if (g) S.players[i].remote = g; });
      me = Math.max(0, m.me); CLIENT_ME = me; S.hi = me; S.turn = m.turn; S.rolls = m.rolls; S.maxRounds = m.maxRounds;
      S.price = m.price; S.lanePath = m.lanePath; drawAll(); drawLanes();
      S.players.forEach((p, i) => { p.pos = m.pos[i]; p.lane = m.lane[i]; const P = PIECES[i]; if (!P) return; setChar(P.body, p.char);   // 手機這邊棋子還是空的,要自己掛上角色模型
        if (p.lane) { const g = p.lane.at ? laneTiles[p.lane.type].path[p.lane.at - 1].g : laneTiles[p.lane.type].cell.g; P.piece.position.set(g.position.x + P.off.x, TOP, g.position.z + P.off.z); } else placePiece(p.pos, P); });
      showPieces(true); focus = PIECES[me]; diceSpots(PIECES[me]); dice.forEach((d, i) => d.position.copy(DIE_REST[i]));
      buildFoes(); setPortraits(); S.view = null; AU.ambience(true); return;
    }
    // 鏡頭和主機一樣跟著「正在走的人」:誰擲骰 / 誰在跳就跟誰(玩家自己的縮放不受影響)
    if (m.t === 'hop') { const P = PIECES[m.p]; if (P) enqueue(m.p, () => { focus = P; return hopOnto(hopGroup(m.tgt), P, m.far); }); return; }
    if (m.t === 'dice') { const P = PIECES[m.p]; if (P) enqueue(m.p, () => { focus = P; return rollDice(m.vals, P); }); return; }
    if (m.t === 'prices') { S.price = m.price; drawAll(); return; }
    if (m.t === 'lane') { S.lanePath[m.type] = m.path; _drawLane0(m.type); return; }
    if (m.t === 'toast') { toast(m.msg); return; }
    if (m.t === 'sfx') { AU.sfx(m.name); return; }
    if (m.t === 'achv') { achvPop(m.title); AU.sfx('mission'); return; }
    if (m.t === 'rules') {     // 規則卡:自己這台顯示、自己按繼續,按了才告訴主機;期間主機鏡射過來的面板先存著
      rulesOpen = true; const el = $('panel'); el.className = 'panel';
      el.innerHTML = `<h3>${m.title}</h3><p>${m.body}</p><div class="btns"><button class="b-ok" data-local="1">${L('Continue', '繼續')}</button></div>`;
      el.querySelector('button').onclick = () => { rulesOpen = false; AU.sfx('click'); send({ t: 'ready' }); if (pendingPanel) { const q = pendingPanel; pendingPanel = null; onMsg(q); } else { el.className = 'panel hide'; el.innerHTML = ''; } };
      return; }
    if (m.t === 'reset') { location.href = `join/?r=${code}`; return; }
    if (m.t === 'ui') { if (m.box === 'panel' && rulesOpen) { pendingPanel = m; return; } const el = $(m.box); if (!el) return; el.className = m.cls; morph(el, m.html); applyMine(); return; }
    if (m.t === 'hud') { HUD = m; mine = !!m.mine; if (S.turn !== m.turn && PIECES[m.turn]) { focus = PIECES[m.turn]; pan.set(0, 0, 0); } S.turn = m.turn; /* 換人:鏡頭切到那位、平移歸零 */ (m.holds || []).forEach((h, i) => { const p = S.players[i]; if (!p) return; KEYS.forEach((k) => { p.hold[k].n = h[k] || 0; }); }); paintHud(); applyMine(); return; }
  }
  let HUD = null, mine = false, aview = null, rulesOpen = false, pendingPanel = null;
  function paintHud() {
    const h = HUD; if (!h) return;
    $('cash').textContent = h.cash; $('rankTxt').textContent = h.rank; $('rankTxt').classList.toggle('top', !!h.top); $('crown').classList.toggle('hide', !h.top);
    $('avaMe').classList.toggle('turn', h.turn === h.me);
    if ($('tip').textContent !== h.tip) { $('tip').textContent = h.tip; const tb = $('tipbar'); tb.classList.remove('pulse'); void tb.offsetWidth; tb.classList.add('pulse'); }
    $('missTitle').textContent = h.missTitle; $('missBadge').textContent = h.missBadge; $('miss').innerHTML = h.miss;
    $('evtBox').classList.toggle('mk-up', !!h.evtUp); $('evtBox').classList.toggle('mk-dn', !h.evtUp);
    $('evtTitle').textContent = h.evtTitle; if ($('evtBody').innerHTML !== h.evt) { if ($('evtBody').innerHTML && $('evtBox').classList.contains('fold')) $('evtBadge').classList.remove('hide'); $('evtBody').innerHTML = h.evt; }
    if (aview == null || !h.players.some((p) => p.i === aview) || (aview !== h.me && aview !== h.spy)) { if (aview != null && aview !== h.me) $('assetBox').classList.add('fold'); aview = h.me; }   // 只能看自己,或偵查中的那位
    const v = h.players.find((p) => p.i === aview); if (v) { $('assetTitle').textContent = v.title + (aview !== h.me ? ` · 🔍${h.spyLeft}` : ''); $('assetRows').innerHTML = v.rows; }
    document.querySelectorAll('#assetTabs .otab').forEach((row) => { const i = +row.dataset.i, p = h.players.find((x) => x.i === i); const sb = row.querySelector('button'); sb.classList.toggle('on', i === aview); sb.classList.toggle('hide', i !== h.spy); row.querySelector('.pava').classList.toggle('turn', i === h.turn);
      const rk = row.querySelector('.rk'); if (p) { rk.textContent = p.rank; rk.classList.toggle('top', !!p.top); } });
  }
  // 股票鈕點擊:看誰的資產(本機切換,不用問主機)
  const pickView = (i) => { const box = $('assetBox'); if (!box.classList.contains('fold') && aview === i) box.classList.add('fold'); else { aview = i; box.classList.remove('fold'); } paintHud(); };
  $('stockBtn').onclick = () => pickView(me);
  new MutationObserver(() => { document.querySelectorAll('#assetTabs button').forEach((b) => { b.onclick = () => pickView(+b.dataset.i); }); }).observe($('assetTabs'), { childList: true });
  // 不是自己的回合:別人的買賣面板、分步選單、抽卡畫面照樣看得到(只是不能按),右上角標「○○操作中」
  function applyMine() {
    document.body.classList.toggle('watch', !mine);
    const cur = S.players[S.turn]; $('panel').dataset.watch = cur && !mine ? L(`${nameOf(cur)} is playing`, `${nameOf(cur)}操作中`) : '';
    ['stepCtl', 'panel', 'draw', 'ctl', 'end'].forEach((id) => { $(id).style.pointerEvents = (mine && id !== 'end') || (id === 'panel' && rulesOpen) ? '' : 'none'; });
    $('ctl').style.visibility = mine ? '' : 'hidden';   // 別人的背包 / 擲骰鈕不顯示(和看電腦走一樣),面板才看得到
    $('tipbar').classList.toggle('hide', $('ctl').classList.contains('hide') || !mine);
  }
  // 鏡射區塊的操作回傳主機
  ['ctl', 'stepCtl', 'panel', 'draw', 'end'].forEach((id) => { const el = $(id);
    el.addEventListener('click', (e) => { const b = e.target.closest('button, .dcard'); if (!b || !el.contains(b) || b.disabled || b.dataset.local) return; e.preventDefault();
      send({ t: 'click', box: id, idx: [...el.querySelectorAll('button, .dcard')].indexOf(b) }); });
    let last = 0; el.addEventListener('input', (e) => { const inp = e.target; if (inp.tagName !== 'INPUT') return; const now = Date.now(); const fire = () => send({ t: 'input', box: id, idx: [...el.querySelectorAll('input')].indexOf(inp), value: inp.value });
      if (now - last > 60) { last = now; fire(); } else { clearTimeout(inp._t); inp._t = setTimeout(fire, 70); } }); });
  // DOM 合併(翻牌動畫、拉桿狀態不會被整段重畫打斷)
  let dragging = null; document.addEventListener('pointerdown', (e) => { if (e.target.tagName === 'INPUT') dragging = e.target; }); document.addEventListener('pointerup', () => { dragging = null; });
  function morph(from, html) { const tpl = document.createElement('template'); tpl.innerHTML = html; morphChildren(from, tpl.content); }
  function morphChildren(a, b) {
    const an = [...a.childNodes], bn = [...b.childNodes];
    for (let i = 0; i < bn.length; i++) { const x = an[i], y = bn[i];
      if (!x) { a.appendChild(y.cloneNode(true)); continue; }
      if (x.nodeType !== y.nodeType || (x.nodeType === 1 && x.tagName !== y.tagName)) { a.replaceChild(y.cloneNode(true), x); continue; }
      if (x.nodeType === 3) { if (x.data !== y.data) x.data = y.data; continue; }
      if (x.nodeType !== 1) continue;
      for (const at of [...x.attributes]) if (!y.hasAttribute(at.name)) x.removeAttribute(at.name);
      for (const at of y.attributes) { if (x.getAttribute(at.name) !== at.value) { if (at.name === 'value' && x === dragging) continue; x.setAttribute(at.name, at.value); } }
      if (x.tagName === 'INPUT' && x !== dragging && y.hasAttribute('value') && x.value !== y.getAttribute('value')) x.value = y.getAttribute('value');
      morphChildren(x, y); }
    for (let i = an.length - 1; i >= bn.length; i--) a.removeChild(an[i]);
  }
  connect();
}

resize(); if (CLIENT) clientInit(); else start();
requestAnimationFrame(loop);
window.__game = { get S() { return S; }, SIM, AP, aiTurn, aiLand, instantiate, simSnapshot, playEvent, laneTiles, drawLanes, roundDividends, payday, aiPayday, drawEventCards, drawFateCards, drawGiftCards, shopPanel, buyPanel, marginCheck, acctRatio, finish, checkMissions, fitStage, stageMetrics, cam, stage, slots, THREE, get stageFit() { return { stageLift, stageZoom, half: view.half, on: stageOn }; }, NET, netUiFlush, netHud, AU, EVENTS, FATE, applyEvent, applyFate, instantiate, turn, enterLane, tiles, dice, piece, bearPiece, PIECES, bagPanel, aiAssets, assetsOf, get CFG() { return CFG; }, view, TILES, slots, stageSelect };
