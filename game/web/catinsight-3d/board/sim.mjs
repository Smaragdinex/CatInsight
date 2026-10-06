import { makeEngine } from './engine.mjs?v=12';
import { makeAiPlan } from './aiplan.mjs?v=1';
import { makePolicy, makeValue } from './nn.mjs?v=2';
// 遊戲模擬器(純邏輯,不碰畫面)。兩個用途:
//   1. board.mjs 裡的電腦對手用它做「蒙地卡羅模擬」:每個決策把後面幾回合隨機跑很多次,挑平均最好的那個動作
//   2. Node 可以直接 import,讓三種電腦(規則 / 期望值 / 蒙地卡羅)互打幾百局,算勝率(tournament.mjs)
// 規則照 board.mjs 搬過來:骰子、走格、起點薪水、每回合配息、融資維持率 130% 斷頭、放空軋空、事件卡、命運牌、
// 警察局 / IPO 小路、商店、銀行、道具。畫面才有的東西(動畫、任務成就、聊天)不在這裡。
// 買賣以外的電腦決定(主攻股、商店、銀行、禮物、擲骰前用道具)和遊戲共用 aiplan.mjs。
//
// 三種電腦策略(policy):
//   rule  規則式:固定規則(漲 15% 賣、便宜就買;擲骰比較前方格子的分數)
//   ev    期望值:擲骰用「前方每格的分數 × 機率」算期望值;買賣用「事件卡的平均漲跌 + 配息 − 風險」算每檔的期望報酬
//   mc    蒙地卡羅:每個決策(擲幾顆、買賣多少)對每個候選動作模擬後面 D 回合 × N 次,取平均資產領先幅度最高的
export function makeSim(D, opts = {}) {
  const opts_ = opts;   // mcTrade 裡的 opts 是候選動作清單,外層設定用這個名字
  const { MARKET_DRIFT = 0, DIV_STEP = 0.01, DIV_MAX = 0.08, DIV_MIN = 0.005, DIV_UP_PRICE = 1.04, DIV_CUT_PRICE = 0.92, SECTORS, KEYS, TILES, NON_EQUITY, EVENTS, ONES, FATE, LOT, START_CASH, SALARY, FEE, DIV_ROUND, BAIL, JAIL_WAIT, LANE_LEN, IPO_OFF,
    BANK_MAX, BANK_RATE, MARGIN_LOAN, MAINT, MARGIN_FEE, SQUEEZE, buyF, sellF, shortF, SPY_ROUNDS } = D;
  const EQ = KEYS.filter((k) => !NON_EQUITY.has(k));
  const DRIFT = opts.drift ?? MARKET_DRIFT, DRIFTS = (k) => k === 'etf' || !NON_EQUITY.has(k);
  // 自己的亂數(mulberry32):可以重設種子 → 蒙地卡羅比較不同動作時用「同一組未來」(common random numbers),雜訊小很多
  let seed = (opts.seed ?? Math.floor(Math.random() * 2 ** 31)) | 0;
  const rand = () => { seed = (seed + 0x6D2B79F5) | 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const getSeed = () => seed, setSeed = (x) => { seed = x | 0; };
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // 難度參數(遊戲也用這一份,board.mjs 的 AI_LEVELS = SIM.LEVELS):reserve 現金底線、lots 主攻股一次最多買幾手、greedy 融資機率、
  // shortP 符合條件時放空的機率、atkP 買 / 用利空卡的機率、buyP 想買 / 想逛商店時真的動手的機率、memory 記得公開帳本幾回合
  const LEVELS = {
    easy:   { shortP: 0.15, atkP: 0.3, greedy: 0.1, reserve: 2500, shortAny: false, lots: 2, buyP: 0.6, memory: 2 },
    normal: { shortP: 0.35, atkP: 0.8, greedy: 0.3, reserve: 1500, shortAny: false, lots: 3, buyP: 1, memory: 5 },
    hard:   { shortP: 0.5,  atkP: 1,   greedy: 0.5, reserve: 800,  shortAny: true,  lots: 5, buyP: 1, memory: 99 },
  };
  // 蒙地卡羅的預算:每個候選動作模擬 n 次、每次往後看 depth 回合
  // z:只有比「期望值策略的建議」好超過 z 個標準誤才換動作(避免挑到雜訊);z = 0 就是單純挑平均最高的
  const MC = Object.assign({ n: 120, depth: 3, score: 'lead', z: 1.5 }, opts.mc || {});

  /* ───────── 狀態 ───────── */
  const mkPlayer = (i, alg = 'ev', level = 'normal') => ({ i, alg, level: LEVELS[level] ? level : 'normal', lv: LEVELS[level] || LEVELS.normal, cash: START_CASH, debt: 0, pos: 0, lane: null, bag: [], salary2: false, plan: null, spy: null,
    hold: Object.fromEntries(KEYS.map((k) => [k, { n: 0, cost: 0, loan: 0, locked: 0, lockUntil: 0 }])), short: Object.fromEntries(KEYS.map((k) => [k, { n: 0, entry: 0 }])) });
  const newGame = (algs, maxRounds = 20, levels = []) => ({
    price: Object.fromEntries(KEYS.map((k) => [k, SECTORS[k].open])), trend: MARKET_DRIFT, div: Object.fromEntries(KEYS.map((k) => [k, SECTORS[k].div])), rolls: 0, maxRounds, turn: 0, after: null, over: false, lanePath: {}, pub: {},
    players: algs.map((a, i) => mkPlayer(i, a, levels[i] || 'normal')),
  });
  const clonePlayer = (p) => ({ ...p, lane: p.lane ? { ...p.lane } : null, bag: p.bag.slice(), plan: p.plan ? { ...p.plan } : null,
    hold: Object.fromEntries(KEYS.map((k) => [k, { n: p.hold[k].n, cost: p.hold[k].cost, loan: p.hold[k].loan, locked: p.hold[k].locked || 0, lockUntil: p.hold[k].lockUntil || 0 }])),
    short: Object.fromEntries(KEYS.map((k) => [k, { n: p.short[k].n, entry: p.short[k].entry }])) });
  const clone = (st) => ({ ...st, pub: null, price: { ...st.price }, div: { ...st.div }, after: st.after ? { ...st.after } : null, lanePath: { ...st.lanePath }, players: st.players.map(clonePlayer) });

  /* ───────── 基本算式 ───────── */
  // 買賣、融資、放空、斷頭 / 軋空、資產計算全部用遊戲引擎(engine.mjs),和真正的遊戲是同一份規則
  const ENG = makeEngine(D, { slippage: opts.slippage, drift: opts.drift, recover: opts.recover,
    hooks: { onLiquidate: (st, who, x) => note(st, who, x.k, true), onSqueeze: (st, who, x) => note(st, who, x.k, true) } });
  const { shortValue, assetsOf, acctRatio, marginCheck, impact, coverBack } = ENG;
  const fill = ENG.fill;
  const AP = makeAiPlan(D, ENG);
  const ctxOf = (st, p) => ({ lv: p.lv, level: p.level, rand, view: (q, k) => view(st, p, q, k) });   // 給 aiplan:這位電腦的難度、亂數、眼中的對手部位
  const others = (st, p) => st.players.filter((q) => q !== p);
  const leader = (st, p) => others(st, p).sort((a, b) => assetsOf(st, b) - assetsOf(st, a))[0];   // 名次畫面上看得到

  /* ───────── 公開帳本(和 board.mjs 的 pubNote / pubView 同一套規則)───────── */
  // 公告只說買了 / 賣了 / 放空 / 回補,沒說幾股:買一次當作 2 手、賣一次當作賣掉一半,公告寫明「全部」的(斷頭、軋空、手滑全賣)才歸零。
  // 電腦只能用這本帳推測對手持股,而且依難度會忘記(memory 回合)。模擬分身(clone)沒有帳本,分身裡的部位本身就是推測出來的
  const PUB_GUESS = 2 * LOT, half = (x) => Math.round(x / 2 / LOT) * LOT;
  function note(st, p, k, all = false) {
    if (!st.pub) return;
    const book = (st.pub[p.i] ||= {}), e = book[k] || { n: 0, sh: 0, tn: 0, tsh: 0 }, tn = p.hold[k].n, tsh = p.short[k].n;
    const n = all && tn === 0 ? 0 : tn > e.tn ? e.n + PUB_GUESS : tn < e.tn ? half(e.n) : e.n;
    const sh = all && tsh === 0 ? 0 : tsh > e.tsh ? e.sh + PUB_GUESS : tsh < e.tsh ? half(e.sh) : e.sh;
    book[k] = { n, sh, tn, tsh, at: st.rolls };
  }
  function view(st, A, q, k) {
    if (A.spy && st.rolls < A.spy.until && A.spy.target === q.i) return { n: q.hold[k].n, sh: q.short[k].n };   // 偵查中:看真的
    if (!st.pub) return { n: q.hold[k].n, sh: q.short[k].n };
    const e = st.pub[q.i] && st.pub[q.i][k]; if (!e || st.rolls - e.at > (A.lv.memory ?? 99)) return { n: 0, sh: 0 };
    return { n: e.n, sh: e.sh };
  }
  // 電腦 i 眼中的局面(和 board.mjs 的 simSnapshot 一樣):自己的部位是真的;對手的持股照帳本推測、現金用公式粗估
  function beliefOf(st, i) {
    const b = clone(st), A = st.players[i];
    b.players.forEach((q, j) => { if (j === i) return; const real = st.players[j]; let spent = 0;
      KEYS.forEach((k) => { const v = view(st, A, real, k); q.hold[k] = { n: v.n, cost: v.n * st.price[k], loan: 0 }; q.short[k] = { n: v.sh, entry: v.sh ? st.price[k] : 0 }; spent += v.n * st.price[k]; });
      q.cash = Math.max(1000, START_CASH - spent * 0.9 + st.rolls * 250); q.debt = 0; q.bag = []; q.plan = null; });
    return b;
  }

  /* ───────── 交易動作 ───────── */
  // act = { a: 'buy'|'margin'|'sell'|'short'|'cover'|'skip', q }
  // 現金扣掉 reserve 之後,最多買得起幾手(上限 max 手),用真正的成交價算
  const maxLots = (st, p, k, max, reserve) => { for (let l = max; l > 0; l--) if (p.cash - fill(st, k, buyF(LOT * l)) * LOT * l >= reserve) return l; return 0; };
  const doTrade = (st, p, k, act) => { ENG.trade(st, p, k, act); if (act.a !== 'skip') note(st, p, k); };
  // 這一格可以做哪些動作(給蒙地卡羅列候選用)
  function tradeOptions(st, p, k) {
    const h = p.hold[k], sh = p.short[k], price = st.price[k], out = [{ a: 'skip' }];
    if (sh.n) { out.push({ a: 'cover' }); return out; }
    if (h.n - ENG.lockedN(st, h) > 0) out.push({ a: 'sell' });          // 內部認購鎖住的股數不能賣
    for (const lots of [1, 2, 3, 5]) { if (p.cash >= fill(st, k, buyF(LOT * lots)) * LOT * lots) out.push({ a: 'buy', q: LOT * lots }); }
    if (!h.loan && p.cash >= fill(st, k, buyF(LOT * 3)) * LOT * 3 * (1 - MARGIN_LOAN)) out.push({ a: 'margin', q: LOT * 3 });
    if (!h.n && p.cash >= fill(st, k, shortF(LOT)) * LOT) out.push({ a: 'short', q: LOT });
    return out;
  }

  /* ───────── 事件、命運 ───────── */
  // 事件卡:抽到時決定內容、生效,都用遊戲引擎(和真正的遊戲同一份規則)
  const instantiate = (st, e) => ENG.instantiate(st, e, rand);
  const applyEvent = (st, e) => ENG.applyEvent(st, e);
  const randomEvent = (st) => instantiate(st, pick(EVENTS));
  // 市場事件格:抽一張事件卡(警察局、內部認購改成命運牌,不會出現在市場事件裡)
  function chance(st, p) { applyEvent(st, randomEvent(st)); }
  const payday = (st, p, atStart) => { ENG.payday(st, p, atStart); };

  // 命運牌:效果在引擎;瞬間移動要重新結算換到的那一格、IPO 要進小路
  function applyFate(st, p, c) {
    const r = ENG.fate(st, p, c, rand);
    if (c.id === 'fat' && r.k) note(st, p, r.k);
    if (r.other) land(st, p, true);
    if (r.lane) enterLane(st, p, r.lane);
  }


  /* ───────── 小路、移動(規則在引擎,這裡是電腦的決定)───────── */
  function enterLane(st, p, type) { ENG.enterLane(st, p, type, rand); if (type === 'ipo') ipo(st, p); }
  // 電腦在內部認購攤位認購幾手:現金夠就買 3 手,不然 1 手(遊戲裡的電腦也用這個)
  const ipoLots = (st, p, k) => { const price = st.price[k] * IPO_OFF; return p.cash >= price * LOT * 3 + 1500 ? 3 : p.cash >= price * LOT + 500 ? 1 : 0; };
  function ipo(st, p) { const k = ENG.ipoPick(st, p, rand); ENG.ipoGrant(st, p, k); const lots = ipoLots(st, p, k); if (lots) ENG.ipoBuy(st, p, k, LOT * lots); note(st, p, k); }
  function walk(st, p, n) { for (let i = 0; i < n; i++) ENG.advance(st, p); }
  // 離開小路:和遊戲裡的電腦一樣,警察局那條擲 2 顆快點出去,內部認購那條擲 1 顆多踩幾格
  const leaveLane = (st, p) => walk(st, p, ENG.dice(p.lane && p.lane.type === 'ipo' ? 1 : 2, 0, rand).reduce((a, b) => a + b, 0));

  /* ───────── 踩格 ───────── */
  function land(st, p, relanding = false) {
    if (p.lane) {
      if (!p.lane.at) return;                                   // 還在攤位 / 警察局裡
      const k = ENG.tileType(st, p, rand);
      if (k === '_chance') chance(st, p); else if (k === 'fate') applyFate(st, p, pick(FATE));
      else if (k === '_gift') gift(st, p); else ENG.pathEffect(st, p, k);
      return;
    }
    const t = TILES[p.pos];
    if (SECTORS[t]) { const act = decideTrade(st, p, t); doTrade(st, p, t, act); }
    else if (t === 'chance') chance(st, p);
    else if (t === 'fate') applyFate(st, p, pick(FATE));
    else if (t === 'ipo') enterLane(st, p, 'ipo');
    else if (t === 'fee') ENG.payFee(st, p);
    else if (t === 'gift') gift(st, p);
    else if (t === 'shop') { const id = AP.shopPick(st, p, AP.shopStock(rand), ctxOf(st, p)); if (id) ENG.buyItem(st, p, id, AP.itemPrice(id)); }
    else if (t === 'bank') { const d = AP.bankMove(st, p, ctxOf(st, p)); if (d) ENG.bank(st, p, d); }
    marginCheck(st);
  }
  const gift = (st, p) => { p.bag.push(AP.giftPick(AP.giftPicks(rand), ctxOf(st, p))); };
  // 擲骰前用道具(和遊戲裡的電腦同一套決定,aiplan.mjs)。回傳這回合怎麼走:{ steps } 遙控骰子指定步數 / { nd: 3 } 三顆骰子 / {}
  function useItems(st, p) {
    const c = ctxOf(st, p);
    const k = AP.atkTarget(st, p, c); if (k) { AP.take(p, 'atk'); ENG.badNews(st, p, k); }
    const T = AP.spyTarget(st, p, c); if (T) { AP.take(p, 'spy'); p.spy = { target: T.i, until: st.rolls + SPY_ROUNDS }; }
    const id = AP.cardToPlay(st, p); if (id) { AP.take(p, id); ENG.playCard(st, p, AP.evEvent(id), rand); }
    if (AP.useDice3(st, p, c)) { AP.take(p, 'dice3'); return { nd: 3 }; }
    const steps = AP.remoteSteps(st, p, c); if (steps) { AP.take(p, 'remote'); return { steps }; }
    return {};
  }

  /* ───────── 一個人的回合 ───────── */
  // forced:蒙地卡羅指定這回合擲幾顆 { dice: 1|2 }(只對第一步有效,之後都交給 policy)
  function playTurn(st, p, forced = null) {
    const use = forced ? {} : useItems(st, p);      // forced:蒙地卡羅已經在外面決定好這一步(道具也用過了)
    if (p.lane) {
      if (p.lane.type === 'jail' && p.lane.wait > 0) {
        if (p.cash >= BAIL + 2500) { ENG.bail(st, p); leaveLane(st, p); }   // 電腦:現金夠多就付保釋金
        else { ENG.rest(st, p); afterMove(st, p); return; }
      } else leaveLane(st, p);
    } else {
      const nd = use.nd || (forced && forced.dice ? forced.dice : use.steps ? 0 : decideDice(st, p));
      walk(st, p, use.steps || ENG.dice(nd === 1 ? 1 : nd === 3 ? 3 : 2, 0, rand).reduce((a, b) => a + b, 0));
    }
    afterMove(st, p);
    land(st, p);
  }
  function afterMove(st, p) {
    if (p.i === 0) {       // 第一位走完 = 新回合:回合數 +1、配息、反彈、所有價格小幅隨機波動
      ENG.newRound(st, rand);                                  // 回合數 +1、配息、反彈、價格隨機波動 + 大盤趨勢(引擎)
    }
    marginCheck(st);
  }
  // 從 st.turn 那位開始走,直到 untilRolls 回合結束(或遊戲結束)
  function run(st, untilRolls, forcedFirst = null) {
    let first = true;
    while (!st.over) {
      const p = st.players[st.turn];
      playTurn(st, p, first ? forcedFirst : null); first = false;
      if (opts.onTurn) opts.onTurn(st, p);
      st.turn = (st.turn + 1) % st.players.length;
      if (st.turn === 0) { applyEvent(st, randomEvent(st)); if (st.rolls >= st.maxRounds) { st.over = true; break; } }
      if (st.rolls >= untilRolls && st.turn === 0) break;
    }
    return st;
  }
  const playGame = (st) => run(st, Infinity);

  /* ───────── 策略:規則式 ───────── */
  const focus = (st, p) => AP.focus(st, p, ctxOf(st, p));        // 主攻股:和遊戲同一份(aiplan.mjs)
  function ruleTrade(st, p, k) {
    const h = p.hold[k], sh = p.short[k], price = st.price[k], sec = SECTORS[k], lv = p.lv, F = focus(st, p);
    const mine = Math.max(0, ...others(st, p).map((q) => view(st, p, q, k).n));
    if (sh.n) return Math.abs((sh.entry - price) / sh.entry) >= 0.12 ? { a: 'cover' } : { a: 'skip' };
    if (h.n && (price * h.n - h.cost) / h.cost >= (k === F ? 0.35 : 0.15)) { if (k === F) p.plan = null; return { a: 'sell' }; }
    if (k === F) {
      const lots = maxLots(st, p, k, lv.lots, lv.reserve);
      if (lots < lv.lots && !h.loan && rand() < lv.greedy && p.cash >= fill(st, k, buyF(LOT * lv.lots)) * LOT * lv.lots * (1 - MARGIN_LOAN) + 500) return { a: 'margin', q: LOT * lv.lots };
      return lots > 0 ? { a: 'buy', q: LOT * lots } : { a: 'skip' };
    }
    if (!h.n && p.cash >= price * LOT + lv.reserve && rand() < lv.shortP && mine >= 30 && price > sec.open * (lv.shortAny ? 1.05 : 1.15)) return { a: 'short', q: LOT };
    const rich = p.cash >= 6000;
    const lots = price < sec.open * 0.93 && p.cash >= price * LOT * 2 + lv.reserve + 1500 ? (rich ? 3 : 2) : price < sec.open * 1.05 && p.cash >= price * LOT + lv.reserve + 1500 ? (rich && h.n ? 2 : 1) : 0;
    const ok = lots ? maxLots(st, p, k, lots, lv.reserve) : 0;
    return ok && rand() < lv.buyP ? { a: 'buy', q: LOT * ok } : { a: 'skip' };
  }

  /* ───────── 策略:期望值 ───────── */
  // 每檔資產「一張事件卡平均會讓它漲跌多少」(μ)和波動(σ),從 EVENTS 資料直接算出來
  // 長期平均大盤趨勢 = 所有「會改趨勢」的事件牌的趨勢平均(趨勢每次被改成哪一張牌的值,機會差不多)
  const TREND_CARDS = EVENTS.filter((e) => e.trend != null), TREND_MEAN = opts.drift ?? (TREND_CARDS.length ? TREND_CARDS.reduce((a, e) => a + e.trend, 0) / TREND_CARDS.length : DRIFT);
  const EVSTAT = Object.fromEntries(KEYS.map((k) => { const xs = EVENTS.map((e) => (e.meme || e.divUp || e.divCut ? 0 : e.m[k] - 1)); const mu = xs.reduce((a, b) => a + b, 0) / xs.length;
    const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mu) ** 2, 0) / xs.length); return [k, { mu, sd }]; }));
  const EVENTS_PER_ROUND = (st) => 1 + 10 / TILES.length * st.players.length;          // 每回合固定一張 + 踩到事件格的
  // 期望值策略的參數(tools/tournament.mjs 掃過,預設是最好的那組;可以用 opts.ev 覆蓋做實驗)
  //   risk 風險懲罰、buyTh 期望報酬超過多少才買、step 每多幾 % 多買一手、cheap 比開盤便宜的加分、
  //   rebound 知道「崩盤後下回合會反彈」、endSell 最後一回合清倉、takeProfit 賺多少就賣(0 = 不因為賺錢賣)
  // 2026-10 規則修正後(成交價含推動、牌組平衡)重新掃過:長期抱著、不因賺錢賣、股利蓋得過利息就融資(維持率留 200% 以上)、
  // 知道崩盤後會反彈。舊參數 { risk 0.35, buyTh 0.025, cheap 0.15, endSell, takeProfit 0.35 } 對規則式勝率 54%,這組約 60%
  const EVP = Object.assign({ risk: 0.15, buyTh: 0, step: 0.02, cheap: 0, rebound: true, endSell: false, takeProfit: 0, sellTh: -0.01, lever: true, safeRatio: 2.0, reserve: 500, maxLots: 5, trendH: 0 }, opts.ev || {});   // trendH 0:趨勢平均 5 回合就變一次,用長期平均最準(掃過 0/1/3/20)
  // 持有一檔到遊戲結束的期望報酬率(扣掉風險)
  function evOf(st, k, p) {
    const left = Math.max(1, st.maxRounds - st.rolls), ev = EVENTS_PER_ROUND(st) * left, s = EVSTAT[k];
    const drift = s.mu * ev, div = st.div[k] * DIV_ROUND * left, risk = EVP.risk * s.sd * Math.sqrt(ev) / Math.sqrt(Math.max(1, left));
    const cheap = (SECTORS[k].open / st.price[k] - 1) * EVP.cheap;
    const reb = EVP.rebound && st.after ? st.after.m[k] - 1 : 0;                              // 下回合確定會反彈的部分(黑色星期一)
    // 大盤趨勢:目前的趨勢大約維持 trendH 回合(事件牌隨時會改),之後用整副牌的長期平均趨勢
    const h = Math.min(left, EVP.trendH), tr = DRIFTS(k) ? ENG.trendOf(st) * h + TREND_MEAN * (left - h) : 0;
    return drift + div - risk + cheap + reb + tr;
  }
  function evTrade(st, p, k) {
    const h = p.hold[k], sh = p.short[k], price = st.price[k], lv = p.lv, e = evOf(st, k, p), left = st.maxRounds - st.rolls, reserve = EVP.reserve ?? lv.reserve;
    if (sh.n) { const r = (sh.entry - price) / sh.entry; return (e > 0.02 || Math.abs(r) >= 0.12 || (EVP.endSell && left <= 1)) ? { a: 'cover' } : { a: 'skip' }; }
    const pl = h.n ? (price * h.n - h.cost) / h.cost : 0;
    if (h.n && (e < EVP.sellTh || (EVP.takeProfit && pl >= EVP.takeProfit) || (EVP.endSell && left <= 1))) return { a: 'sell' };
    if (left <= 1) return { a: 'skip' };
    if (e > EVP.buyTh) {
      const want = Math.min(EVP.maxLots ?? lv.lots, Math.max(1, Math.floor(e / EVP.step))), lots = maxLots(st, p, k, want, reserve);
      if (lots <= 0) return { a: 'skip' };
      if (EVP.lever) {
        // 融資:這檔每回合的股利 > 借款每回合的利息(每 8 回合左右經過起點付 2%),而且買完整個帳戶的維持率還在 safeRatio 以上才借
        const px = fill(st, k, buyF(LOT * want)), cost = px * LOT * want, loan = cost * MARGIN_LOAN;
        let v = 0, l = 0; for (const x of KEYS) { v += p.hold[x].n * st.price[x]; l += p.hold[x].loan; }
        const ratioAfter = (v + cost) / (l + loan), carry = st.div[k] * DIV_ROUND - MARGIN_FEE / 8;
        if (carry > 0 && ratioAfter >= EVP.safeRatio && p.cash >= cost - loan + reserve) return { a: 'margin', q: LOT * want };
      } else if (e > 0.08 && !h.loan && rand() < lv.greedy && p.cash >= fill(st, k, buyF(LOT * want)) * LOT * want * (1 - MARGIN_LOAN) + lv.reserve) return { a: 'margin', q: LOT * want };
      return { a: 'buy', q: LOT * lots };
    }
    if (e < -0.04 && !h.n && p.cash >= price * LOT + lv.reserve && rand() < lv.shortP) return { a: 'short', q: LOT };
    return { a: 'skip' };
  }
  // 走到前方第 i 格有多好(擲骰期望值用)
  function tileScore(st, p, i) {
    const t = TILES[(p.pos + i) % TILES.length], sec = SECTORS[t]; let v = 0;
    if (sec) { const h = p.hold[t], sh = p.short[t], e = evOf(st, t, p);
      if (h.n && (st.price[t] * h.n - h.cost) / h.cost >= 0.15) v += 3; else if (sh.n && Math.abs((sh.entry - st.price[t]) / sh.entry) >= 0.12) v += 2;
      else if (h.loan > 0 && acctRatio(st, p) < 1.5) v += 2;
      else v += Math.max(0.3, Math.min(4.5, e * 40)) * (p.cash >= st.price[t] * LOT + p.lv.reserve ? 1 : 0.3); }
    else if (t === 'shop') v += p.cash >= 2500 ? 1.5 : 0.3; else if (t === 'ipo') v += 2.5; else if (t === 'gift') v += 1.5; else if (t === 'chance') v += 0.8;
    else if (t === 'bank') v += p.cash < 1500 ? 1.5 : 0; else if (t === 'fee') v -= 1;
    for (let j = 1; j <= i; j++) { const tt = TILES[(p.pos + j) % TILES.length]; if (tt === 'start') v += 2; else if (tt === 'divi') v += 0.8; }
    return v;
  }
  function evDice(st, p) {
    let e1 = 0, e2 = 0.3;
    for (let i = 1; i <= 6; i++) e1 += tileScore(st, p, i) / 6;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e2 += tileScore(st, p, a + b) / 36;
    return e1 > e2 ? 1 : 2;
  }

  /* ───────── 策略:蒙地卡羅 ───────── */
  // 評分:自己的總資產領先「最強對手」多少(不是只看自己,這樣會順便學到打壓第一名)
  // 模擬只跑 depth 回合,剩下的回合用期望值估:持股 × 到結束的期望報酬(這樣 3 回合的模擬也知道「這檔長期好」)
  const terminal = (st, p) => (MC.terminal === false ? 0 : KEYS.reduce((a, k) => a + (p.hold[k].n - p.short[k].n) * st.price[k] * evOf(st, k, p), 0));
  const lead = (st, i) => { const me = assetsOf(st, st.players[i]) + terminal(st, st.players[i]); let best = -Infinity;
    st.players.forEach((q, j) => { if (j !== i) best = Math.max(best, assetsOf(st, q) + terminal(st, q)); });
    // late:模擬跑得到遊戲結束(最後幾回合)才改看輸贏,前面還是看領先差距
    if (MC.score === 'win' || MC.score === 'winlead' || (MC.score === 'late' && st.over)) {   // 目標是「拿第一」:這次模擬贏了算 1、平手 0.5、輸了 0;winlead 再加一點領先差距當平手時的參考
      const w = me > best ? 1 : me === best ? 0.5 : 0;
      return MC.score === 'win' ? w : w + Math.max(-0.25, Math.min(0.25, (me - best) / 40000));
    }
    return MC.score === 'own' ? me : MC.score === 'mix' ? me - 0.5 * best : me - best; };
  // 從 st(輪到 p、還沒擲骰)用 forced 動作模擬 depth 回合,回傳平均領先。模擬裡所有人都用期望值策略
  const seedsFor = (n) => { const out = []; for (let i = 0; i < n; i++) out.push((rand() * 2 ** 31) | 0); return out; };
  function rolloutMean(st, p, forced, seeds, depth) {
    let sum = 0; const keep = getSeed();
    for (const sd of seeds) {
      setSeed(sd);
      const c = clone(st); c.players.forEach((q) => { q.alg = 'ev'; });
      run(c, c.rolls + depth, forced);
      sum += lead(c, p.i);
    }
    setSeed(keep); return sum / seeds.length;
  }
  // 從 st 用 forced 擲法模擬,回傳每個種子各自的分數(配對比較用)
  function rolloutAll(st, p, forced, seeds, depth) {
    const keep = getSeed(), out = [];
    for (const sd of seeds) { setSeed(sd); const c = clone(st); c.players.forEach((q) => { q.alg = 'ev'; }); run(c, c.rolls + depth, forced); out.push(lead(c, p.i)); }
    setSeed(keep); return out;
  }
  // 配對差的平均和標準誤:a、b 是同一組未來(同種子)底下兩個動作的分數
  const pairStat = (a, b) => { const n = a.length; let m = 0; for (let i = 0; i < n; i++) m += a[i] - b[i]; m /= n;
    let v = 0; for (let i = 0; i < n; i++) v += (a[i] - b[i] - m) ** 2; return { m, se: Math.sqrt(v / Math.max(1, n - 1) / n) }; };
  function mcDice(st, p) {
    const seeds = seedsFor(Math.max(20, Math.round(MC.n * 0.6))), base = evDice(st, p), other = base === 1 ? 2 : 1;
    const a = rolloutAll(st, p, { dice: other }, seeds, MC.depth), b = rolloutAll(st, p, { dice: base }, seeds, MC.depth);
    const { m, se } = pairStat(a, b), pick = m > MC.z * se ? other : base;
    if (opts.onMC) { const mean = (x) => x.reduce((u, v) => u + v, 0) / x.length;
      opts.onMC({ kind: 'dice', st, p, options: [base, other], means: [mean(b), mean(a)], chosen: pick, base }); }
    return pick;
  }
  // 踩到股票格:st 是「已經走到這格、還沒交易」的狀態。每個候選動作先做掉,再從下一位開始模擬
  // 每個候選動作都用同一組種子模擬,和「期望值策略的建議」做配對比較;顯著比較好(> z 個標準誤)的裡面挑平均差最大的
  function mcTrade(st, p, k) {
    const opts = tradeOptions(st, p, k), evAct = evTrade(st, p, k), same = (x, y) => x.a === y.a && (x.q || 0) === (y.q || 0);
    if (!opts.some((o) => same(o, evAct))) opts.push({ a: evAct.a, q: evAct.q });          // 期望值建議的動作(例如融資 50 股)不在清單上就補進去
    if (opts.length === 1) return opts[0];
    const base = opts.find((o) => same(o, evAct));
    const seeds = seedsFor(MC.n), keep = getSeed();
    const scores = opts.map((act) => seeds.map((sd) => {
      setSeed(sd);
      const c = clone(st), q = c.players[p.i]; c.players.forEach((x) => { x.alg = 'ev'; });
      doTrade(c, q, k, act); marginCheck(c);
      c.turn = (p.i + 1) % c.players.length;
      if (c.turn === 0) { applyEvent(c, randomEvent(c)); if (c.rolls >= c.maxRounds) c.over = true; }
      run(c, c.rolls + MC.depth);
      return lead(c, p.i);
    }));
    setSeed(keep);
    const bi = opts.indexOf(base); let best = base, bestM = 0;
    opts.forEach((act, i) => { if (i === bi) return; const { m, se } = pairStat(scores[i], scores[bi]); if (m > MC.z * se && m > bestM) { bestM = m; best = act; } });
    if (opts_.onMC) opts_.onMC({ kind: 'trade', st, p, k, options: opts, means: scores.map((x) => x.reduce((u, v) => u + v, 0) / x.length), chosen: best, base });
    return best;
  }

  /* ───────── 派發 ───────── */
  // 蒙地卡羅在 Node 對戰裡也從「自己眼中的局面」出發(對手部位是推測的),和遊戲裡 board.mjs 交給 Web Worker 的快照一樣
  const asSeen = (st, p) => (opts.belief !== false && st.pub ? beliefOf(st, p.i) : st);
  // 神經網路(nn):模仿蒙地卡羅的策略網路,一次前向計算就決定,不做模擬。候選動作和蒙地卡羅一樣(可做的動作 + 期望值建議)
  // 模型的輸入維度要和現在的特徵一樣(資產種類變了就要重新訓練),不合就不用,免得默默算錯
  const NN = opts.nn && opts.nn.dim === 5 + 8 + 4 + KEYS.length * 8 + 12 ? makePolicy(opts.nn) : null;
  if (opts.nn && !NN) console.warn(`nn-policy.json 是 ${opts.nn.dim} 維,現在的特徵是 ${5 + 8 + 4 + KEYS.length * 8 + 12} 維:要重新產生資料、重新訓練`);
  const NN_CONF = opts.nnConf ?? 0;
  function nnTrade(st, p, k) {
    const cand = tradeOptions(st, p, k), evAct = evTrade(st, p, k);
    if (!cand.some((o) => o.a === evAct.a && (o.q || 0) === (evAct.q || 0))) cand.push(evAct);
    const lg = NN.trade(withBase(features(st, p.i, k), actIndex(evAct)));
    const best = cand.reduce((x, o) => (lg[actIndex(o)] > lg[actIndex(x)] ? o : x), cand[0]);
    // 和蒙地卡羅的「好超過 z 個標準誤才換」同一個想法:網路對「不照期望值建議」的把握(候選動作裡的 softmax 機率)要超過 nnConf 才換
    if (NN_CONF > 0 && actIndex(best) !== actIndex(evAct)) {
      const mx = Math.max(...cand.map((o) => lg[actIndex(o)])), z = cand.reduce((u, o) => u + Math.exp(lg[actIndex(o)] - mx), 0);
      if (Math.exp(lg[actIndex(best)] - mx) / z < NN_CONF) return evAct;
    }
    return best;
  }
  const nnDice = (st, p) => { const lg = NN.dice(withBase(features(st, p.i), evDice(st, p) - 1)); return lg[0] > lg[1] ? 1 : 2; };
  // 輸入 = 局面特徵 + 期望值建議的 one-hot(10 格)
  const withBase = (f, bi) => { const x = new Float32Array(f.length + 10); x.set(f); x[f.length + bi] = 1; return x; };

  /* ───────── 參考 AlphaZero 的電腦(az / azb):多層 open-loop MCTS + 策略網路 + 價值網路 ───────── */
  // 搜尋樹的每個節點 = 「這位電腦自己的一次決策」(股票格的交易、擲幾顆骰子)。一次模擬:
  //   1. 從根節點開始,遇到自己的決策就用 PUCT 選子節點:Q(平均勝率)+ c·P(策略網路先驗)·√(兄弟節點總次數) / (1 + 這個子節點的次數)
  //   2. 骰子、事件卡、對手的行動每次模擬都重新抽(open-loop:樹記的是「動作序列」,不是固定的局面),所以同一個節點每次看到的局面可能不同,
  //      合法動作也可能不同 —— 只在這次合法的子節點裡選,沒見過的合法動作當場用策略網路給先驗、加進樹
  //   3. 每次模擬只展開一個新節點;走到新節點之後離開樹:自己用策略網路(選機率最高的)、對手用期望值策略繼續走
  //   4. 往後走 AZ.h 回合後,用價值網路估「從這位電腦的角度,最後拿第一的機率」;遊戲已經結束就直接看輸贏
  //   5. 把這個值回傳給這次模擬經過的每一個節點(N + 1、W + 值)
  // 根節點選被模擬最多次的動作。自我對弈時根節點加 Dirichlet 雜訊、並依次數抽樣(AZ.temp),讓資料比較多樣
  // az 和 azb 可以用不同的網路(opts.nn / nnValue 給 az,opts.nnB / nnValueB 給 azb),新舊兩代才能直接對打
  const NETDIM = 5 + 8 + 4 + KEYS.length * 8 + 12;
  const VAL = opts.nnValue && opts.nnValue.dim === NETDIM ? makeValue(opts.nnValue) : null;
  if (opts.nnValue && !VAL) console.warn('nn-value.json 的維度和現在的特徵不合:要重新訓練');
  const NETS = { az: { pol: NN, val: VAL },
    azb: { pol: opts.nnB && opts.nnB.dim === NETDIM ? makePolicy(opts.nnB) : NN, val: opts.nnValueB && opts.nnValueB.dim === NETDIM ? makeValue(opts.nnValueB) : VAL } };
  const AZ = Object.assign({ n: 100, h: 2, c: 1.5, noise: 0, temp: 0 }, opts.az || {});
  const AZSTAT = { searches: 0, sims: 0, maxDepth: 0, depthSum: 0 };   // 樹實際長到幾層(證據用)
  const gammaish = (a) => { let x = 0; for (let i = 0; i < 12; i++) x += rand(); return Math.max(1e-3, (x - 6) * Math.sqrt(a) + a); };   // 近似 Gamma,只用來做 Dirichlet 雜訊
  const softmax = (v) => { const m = Math.max(...v), e = v.map((x) => Math.exp(x - m)), s = e.reduce((a, b) => a + b, 0); return e.map((x) => x / s); };
  function leafValue(c, i, val) {
    if (c.over) { const fin = c.players.map((q) => assetsOf(c, q)), me = fin[i], best = Math.max(...fin.filter((_, j) => j !== i)); return me > best ? 1 : me === best ? 0.5 : 0; }
    return val ? val.win(features(c, i)) : 0.5 + Math.max(-0.5, Math.min(0.5, lead(c, i) / 40000));
  }
  // 這個局面的候選動作 + 策略網路先驗。交易:可做的動作 + 期望值建議;擲骰:1 或 2 顆
  function candidates(st, p, kind, k, pol) {
    if (kind === 'dice') { const base = evDice(st, p), lg = pol ? pol.dice(withBase(features(st, p.i), base - 1)) : null;
      return { cand: [1, 2], keys: ['d1', 'd2'], prior: lg ? softmax([lg[0], lg[1]]) : [0.5, 0.5], base }; }
    const cand = tradeOptions(st, p, k), evAct = evTrade(st, p, k);
    if (!cand.some((o) => o.a === evAct.a && (o.q || 0) === (evAct.q || 0))) cand.push(evAct);
    const lg = pol ? pol.trade(withBase(features(st, p.i, k), actIndex(evAct))) : null;
    return { cand, keys: cand.map((o) => 't' + actIndex(o)), prior: lg ? softmax(cand.map((o) => lg[actIndex(o)])) : cand.map(() => 1 / cand.length), base: evAct };
  }
  let SRCH = null;   // 正在進行的這一次模擬:{ cur 目前節點, inTree, path, me, nets, depth }
  // 模擬裡輪到這位電腦自己做決定(alg = '_tree'):還在樹裡就用 PUCT 選、往下一層;已經離開樹就用策略網路
  function treePick(st, p, kind, k) {
    const S = SRCH, { cand, keys, prior } = candidates(st, p, kind, k, S.nets.pol);
    if (cand.length === 1) return cand[0];                   // 只有一種選擇(例如只能跳過)不算一層
    if (!S.inTree) { let bi = 0; for (let i = 1; i < cand.length; i++) if (prior[i] > prior[bi]) bi = i; return cand[bi]; }
    const node = S.cur, isRoot = S.path.length === 1;
    let P = prior;
    if (isRoot && AZ.noise && !node.noised) { const g = P.map(() => gammaish(0.3)), gs = g.reduce((a, b) => a + b, 0); node.noise = g.map((x) => x / gs); node.noised = true; }
    keys.forEach((key, i) => { if (!node.kids.has(key)) node.kids.set(key, { N: 0, W: 0, P: P[i], kids: new Map() }); });
    let sumN = 0; keys.forEach((key) => { sumN += node.kids.get(key).N; });
    const fpu = node.N ? node.W / node.N : 0.5;
    let bi = 0, bs = -Infinity;
    keys.forEach((key, i) => { const ch = node.kids.get(key), pr = isRoot && node.noise ? 0.75 * ch.P + 0.25 * node.noise[i] : ch.P;
      const u = (ch.N ? ch.W / ch.N : fpu) + AZ.c * pr * Math.sqrt(sumN + 1) / (1 + ch.N); if (u > bs) { bs = u; bi = i; } });
    const child = node.kids.get(keys[bi]); S.path.push(child); S.cur = child; S.depth++;
    if (child.N === 0) S.inTree = false;                     // 剛展開的新節點:這次模擬到這裡離開樹
    return cand[bi];
  }
  function mcts(st, p, kind, k, nets) {
    const root = { N: 0, W: 0, P: 1, kids: new Map() }, keep = getSeed(), seeds = seedsFor(AZ.n);
    const rootInfo = candidates(st, p, kind, k, nets.pol);
    if (rootInfo.cand.length === 1) return rootInfo.cand[0];
    let maxD = 0;
    for (let t = 0; t < AZ.n; t++) {
      setSeed(seeds[t]);                                     // 每次模擬一個新的隨機未來(open-loop)
      const c = clone(st), q = c.players[p.i]; c.players.forEach((x) => { x.alg = 'ev'; }); q.alg = '_tree';
      SRCH = { cur: root, inTree: true, path: [root], me: p.i, nets, depth: 0 };
      if (kind === 'trade') {
        const act = treePick(c, q, 'trade', k); doTrade(c, q, k, act); marginCheck(c);
        c.turn = (p.i + 1) % c.players.length;
        if (c.turn === 0) { applyEvent(c, randomEvent(c)); if (c.rolls >= c.maxRounds) c.over = true; }
        if (!c.over) run(c, c.rolls + AZ.h);
      } else { const nd = treePick(c, q, 'dice'); run(c, c.rolls + AZ.h, { dice: nd }); }
      const v = leafValue(c, p.i, nets.val);
      for (const nd of SRCH.path) { nd.N++; nd.W += v; }
      maxD = Math.max(maxD, SRCH.depth); SRCH = null;
    }
    setSeed(keep);
    AZSTAT.searches++; AZSTAT.sims += AZ.n; AZSTAT.maxDepth = Math.max(AZSTAT.maxDepth, maxD); AZSTAT.depthSum += maxD;
    const visits = rootInfo.keys.map((key) => (root.kids.get(key) || { N: 0 }).N);
    let bi = 0;
    const temp = AZ.temp && st.rolls < (AZ.tempRounds ?? Infinity) ? AZ.temp : 0;   // 自我對弈前幾回合依次數抽樣,之後選最多次的
    if (temp > 0) { const w = visits.map((x) => x ** (1 / temp)), s = w.reduce((a, b) => a + b, 0); let r = rand() * s; for (bi = 0; bi < w.length - 1; bi++) { r -= w[bi]; if (r <= 0) break; } }
    else for (let i = 1; i < visits.length; i++) if (visits[i] > visits[bi]) bi = i;
    if (opts.onAZ) opts.onAZ({ kind, st, p, k, options: rootInfo.cand, visits, chosen: rootInfo.cand[bi], base: rootInfo.base, depth: maxD });
    return rootInfo.cand[bi];
  }
  const azTrade = (st, p, k, alg = 'az') => mcts(st, p, 'trade', k, NETS[alg]);
  const azDice = (st, p, alg = 'az') => mcts(st, p, 'dice', null, NETS[alg]);
  function decideDice(st, p) { if (POL[p.alg]) return POL[p.alg].dice ? POL[p.alg].dice(st, p, api) : evDice(st, p);
    if (p.alg === 'nn' && NN) { const b = asSeen(st, p); return nnDice(b, b.players[p.i]); }
    if (p.alg === '_tree') return treePick(st, p, 'dice');
    if (p.alg === 'az' || p.alg === 'azb') { const b = asSeen(st, p); return azDice(b, b.players[p.i], p.alg); }
    if (p.alg === 'mc') { const b = asSeen(st, p); return mcDice(b, b.players[p.i]); } return p.alg === 'ev' ? evDice(st, p) : AP.ruleDice(st, p, ctxOf(st, p)); }
  // opts.policies:實驗用的自訂策略 { 名字: (st, p, k, api) => 動作 },玩家的 alg 設成那個名字就會用它(tools/ 的分析腳本用)
  const POL = opts.policies || {};
  function decideTrade(st, p, k) { if (POL[p.alg]) return POL[p.alg](st, p, k, api);
    if (p.alg === 'nn' && NN) { const b = asSeen(st, p); return nnTrade(b, b.players[p.i], k); }
    if (p.alg === '_tree') return treePick(st, p, 'trade', k);
    if (p.alg === 'az' || p.alg === 'azb') { const b = asSeen(st, p); return azTrade(b, b.players[p.i], k, p.alg); }
    if (p.alg === 'mc') { const b = asSeen(st, p); return mcTrade(b, b.players[p.i], k); } return p.alg === 'ev' ? evTrade(st, p, k) : ruleTrade(st, p, k); }

  /* ───────── 神經網路用的局面特徵 ───────── */
  // st 必須是「玩家 i 眼中的局面」(beliefOf 或遊戲的 simSnapshot):對手部位是推測的,不能偷看。金額都除以起始現金
  // 全域 5 + 自己 8 + 名次 4 + 每檔 22×7 + 前方 12 格 + 這次交易是哪一檔(one-hot)22 = 205 個數字
  const NN_ACTIONS = ['skip', 'sell', 'cover', 'buy1', 'buy2', 'buy3', 'buy4', 'buy5', 'margin', 'short'];
  const actIndex = (act) => (act.a === 'buy' ? 2 + Math.round((act.q || LOT) / LOT) : NN_ACTIONS.indexOf(act.a));
  const NN_DIM = 5 + 8 + 4 + KEYS.length * 7 + 12 + KEYS.length;
  function features(st, i, k = null) {
    const G = START_CASH, p = st.players[i], f = new Float32Array(NN_DIM); let j = 0;
    const put = (x) => { f[j++] = Number.isFinite(x) ? x : 0; };
    const left = Math.max(0, st.maxRounds - st.rolls);
    put(st.rolls / st.maxRounds); put(left / 20); put(ENG.trendOf(st) * 50); put(st.after ? 1 : 0); put(st.players.length / 4);
    let loan = 0; for (const x of KEYS) loan += p.hold[x].loan;
    const mine = assetsOf(st, p);
    put(p.cash / G); put(p.debt / G); put(loan ? Math.min(5, acctRatio(st, p)) / 5 : 1); put(mine / G);
    put(p.lane && p.lane.type === 'jail' ? 1 : 0); put(p.lane && p.lane.type === 'ipo' ? 1 : 0); put(p.salary2 ? 1 : 0); put(p.bag.filter((b) => b === 'atk').length);
    const opp = st.players.filter((q) => q !== p).map((q) => assetsOf(st, q)).sort((a, b) => b - a);
    put((mine - opp[0]) / G); put((mine - (opp[1] ?? opp[0])) / G); put(opp.filter((a) => a > mine).length / 3); put(opp.reduce((a, b) => a + b, 0) / opp.length / G);
    for (const x of KEYS) {
      const pr = st.price[x], h = p.hold[x];
      put(pr / SECTORS[x].open - 1); put(st.div[x] * 10); put(evOf(st, x, p) * 5);
      put(h.n * pr / G); put(h.loan ? 1 : 0); put(p.short[x].n * pr / G);
      put(Math.max(0, ...st.players.filter((q) => q !== p).map((q) => q.hold[x].n)) * pr / G);
    }
    for (let d = 1; d <= 12; d++) put(p.lane ? 0 : tileScore(st, p, d) / 5);
    for (const x of KEYS) put(x === k ? 1 : 0);
    return f;
  }

  const api = { fill: (st, k, f) => fill(st, k, f), maxLots, acctRatio, assetsOf, evOf, evTrade, tradeOptions, buyF, sellF, shortF, LOT, MARGIN_LOAN };
  return { nnTrade, nnDice, NN, VAL, AZ, AZSTAT, azTrade, azDice, features, NN_ACTIONS, NN_DIM, actIndex, newGame, clone, playGame, run, playTurn, land, doTrade, tradeOptions, assetsOf, acctRatio, lead, evOf, beliefOf, view, note, leader, EVSTAT, evDice, evTrade, ruleTrade, mcDice, mcTrade, rolloutMean, rolloutAll, tileScore, ipoLots, setSeed, getSeed, rand, MC, EVP, LEVELS, mkPlayer };
}
