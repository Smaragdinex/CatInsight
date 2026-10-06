// 電腦對手「買賣股票以外」的決定(唯一一份):主攻股、商店買什麼、銀行借還錢、禮物、擲骰前用哪個道具、簡單難度擲幾顆骰子。
// board.mjs(真正的遊戲)和 sim.mjs(電腦模擬、對戰工具)都呼叫這裡,所以模擬器裡的電腦 = 你在遊戲裡遇到的電腦。
// 買賣股票的三種演算法(規則式 / 期望值 / 蒙地卡羅)在 sim.mjs;規則本身(價格、借款、道具效果)在 engine.mjs。
//
// 這裡只做決定、不改狀態(focus 會記下 p.plan 除外),由呼叫端執行並負責畫面。
// 局面 st 需要 { price, div, rolls, maxRounds, players };玩家 p 需要 { i, cash, debt, pos, lane, bag, plan, hold, short, spy }。
// ctx = { lv: 難度參數, level: 'easy' | 'normal' | 'hard', rand: 亂數, view(q, k) → { n, sh }:這位電腦眼中對手 q 的部位(公開帳本 / 偵查) }
export function makeAiPlan(D, ENG) {
  const { KEYS, SECTORS, TILES, EVENTS, NON_EQUITY, LOT, BANK_MAX, SALE_EVENTS, ITEM_IDS, REMOTE_PRICE, CARD_PRICE, ATK_PRICE, SPY_PRICE, DICE3_PRICE } = D;
  const others = (st, p) => st.players.filter((q) => q !== p);
  const leader = (st, p) => others(st, p).sort((a, b) => ENG.assetsOf(st, b) - ENG.assetsOf(st, a))[0];   // 名次畫面上看得到

  /* ───────── 道具 ───────── */
  // 事件卡 'evN' = EVENTS[N];受惠最多的那檔(畫面說明、電腦判斷都用)
  const evEvent = (id) => EVENTS[+id.slice(2)];
  const BEST = {};
  const evBest = (id) => (BEST[id] ??= ((e) => KEYS.reduce((a, k) => (e.m[k] > e.m[a] ? k : a), KEYS[0]))(evEvent(id)));
  const isEv = (id) => id.startsWith('ev');
  const itemPrice = (id) => (isEv(id) ? CARD_PRICE : { remote: REMOTE_PRICE, atk: ATK_PRICE, spy: SPY_PRICE, dice3: DICE3_PRICE }[id]);
  const take = (p, id) => { p.bag.splice(p.bag.indexOf(id), 1); };
  const jailed = (p) => !!(p.lane && p.lane.type === 'jail');           // 在警察局(含出來那條小路)不能用道具,玩家和電腦都一樣
  // 商店每次進門隨機擺 3 樣:道具 1 樣 + 事件卡 2 張,只能買一樣
  const shopStock = (rand) => [ITEM_IDS[Math.floor(rand() * ITEM_IDS.length)], ...SALE_EVENTS.slice().sort(() => rand() - 0.5).slice(0, 2).map((i) => 'ev' + i)];
  // 禮物:三個盒子(道具 70% / 事件卡 30%,彼此不同),電腦隨便挑一個
  const randomItem = (rand) => (rand() < 0.7 ? ITEM_IDS[Math.floor(rand() * ITEM_IDS.length)] : 'ev' + SALE_EVENTS[Math.floor(rand() * SALE_EVENTS.length)]);
  const giftPicks = (rand) => { const picks = []; while (picks.length < 3) { const id = randomItem(rand); if (!picks.includes(id)) picks.push(id); } return picks; };

  /* ───────── 主攻股與想去的格子 ───────── */
  // 主攻股:挑一檔集中火力——便宜、有配息、已經持有、手上有能炒它的事件卡、別人在放空(買進可以軋他)都加分。
  // 賣掉獲利了結後會重新挑(呼叫端把 p.plan 清掉);挑了很久都沒買到也換一檔
  function focus(st, p, ctx) {
    if (p.plan && (p.hold[p.plan.k].n > 0 || st.rolls - p.plan.since < 6)) return p.plan.k;
    const score = (k) => { const pr = st.price[k]; let v = (SECTORS[k].open / pr - 1) * 10 + st.div[k] * 40;
      if (p.hold[k].n) v += 2 + Math.min(3, p.hold[k].n / 10);
      if (p.bag.some((id) => isEv(id) && evBest(id) === k)) v += 4;
      if (NON_EQUITY.has(k)) v -= 1.5;
      if (others(st, p).some((q) => ctx.view(q, k).sh > 0)) v += 1;                 // 看公開帳本:有人公告過放空它
      return v + ctx.rand(); };
    const k = KEYS.slice().sort((a, b) => score(b) - score(a))[0]; p.plan = { k, since: st.rolls }; return k;
  }
  // 走到前方第 i 格有多好(規則式擲幾顆骰子、要不要用遙控骰子都看這個)
  function tileScore(st, p, i, ctx) {
    const t = TILES[(p.pos + i) % TILES.length], sec = SECTORS[t], F = focus(st, p, ctx), lv = ctx.lv; let v = 0;
    if (sec) { const h = p.hold[t], sh = p.short[t], pr = st.price[t];
      if (h.n && (pr * h.n - h.cost) / h.cost >= (t === F ? 0.35 : 0.15)) v += 3;     // 可以獲利了結
      else if (sh.n && Math.abs((sh.entry - pr) / sh.entry) >= 0.12) v += 2;         // 空單該回補了
      else if (h.loan > 0 && ENG.acctRatio(st, p) < 1.5) v += 2;                     // 融資快斷頭,想去處理
      else if (t === F) v += p.cash >= pr * LOT + lv.reserve ? 4.5 : 1;              // 主攻股:最想去
      else v += pr < sec.open * 0.95 ? 1.5 : 0.5; }                                  // 便宜的比較想買
    else if (t === 'shop') v += p.cash >= 2500 ? (p.bag.includes('remote') ? 1.5 : 2.5) : 0.3;
    else if (t === 'ipo') v += 2.5;
    else if (t === 'gift') v += 1.5;
    else if (t === 'bank') v += p.cash < 1500 || (p.debt && p.cash > 6000) ? 1.5 : 0;
    for (let j = 1; j <= i; j++) { const tt = TILES[(p.pos + j) % TILES.length]; if (tt === 'start') v += 2; }   // 經過起點發薪
    return v;
  }
  // 規則式擲幾顆骰子:一顆走 1~6 格(機率相同)、兩顆走 2~12 格(7 最常出現),比較兩種擲法落點分數的期望值
  function ruleDice(st, p, ctx) {
    let e1 = 0, e2 = 0.3;                                                              // 兩顆走得遠,給一點基本分
    for (let i = 1; i <= 6; i++) e1 += tileScore(st, p, i, ctx) / 6;
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) e2 += tileScore(st, p, a + b, ctx) / 36;
    return e1 > e2 ? 1 : 2;
  }

  /* ───────── 擲骰前用道具(依序:利空卡 → 偵查報告 → 事件卡 → 三顆骰子 → 遙控骰子)───────── */
  // 利空卡:打「名次最高的對手」牠所知道持有最多的資產;只看公開帳本 / 偵查結果,不知道的就先留著卡。回傳要打的那檔或 null
  function atkTarget(st, p, ctx) {
    if (jailed(p) || !p.bag.includes('atk') || !(ctx.rand() < ctx.lv.atkP)) return null;
    const T = leader(st, p); if (!T) return null;
    const vn = (k) => ctx.view(T, k).n;
    return KEYS.filter((k) => vn(k) > 0).sort((x, y) => vn(y) * st.price[y] - vn(x) * st.price[x])[0] || null;
  }
  // 偵查報告:手上有利空卡(或困難難度)而且還沒在偵查,就對名次最高的對手用。回傳對象或 null
  function spyTarget(st, p, ctx) {
    if (jailed(p) || !p.bag.includes('spy') || (p.spy && st.rolls < p.spy.until) || !(p.bag.includes('atk') || ctx.level === 'hard')) return null;
    return leader(st, p) || null;
  }
  // 事件卡:等受惠的那檔買到 20 股以上再打(炒自己的持股);剩 3 回合以內就有持股就打。回傳卡片 id 或 null
  const cardToPlay = (st, p) => !jailed(p) && p.bag.find((id) => isEv(id) && (p.hold[evBest(id)].n >= 20 || (p.hold[evBest(id)].n > 0 && st.maxRounds - st.rolls <= 3))) || null;
  // 三顆骰子:手上沒有遙控骰子時,六成機率拿來用
  const useDice3 = (st, p, ctx) => !p.lane && !p.bag.includes('remote') && p.bag.includes('dice3') && ctx.rand() < 0.6;
  // 遙控骰子:前方 2~12 格裡有很想去的格子(分數 > 3.8:主攻股、商店、IPO…)就指定步數走過去。回傳步數,0 = 不用
  function remoteSteps(st, p, ctx) {
    if (p.lane || !p.bag.includes('remote')) return 0;
    let best = { i: 0, v: 3.8 }; for (let i = 2; i <= 12; i++) { const v = tileScore(st, p, i, ctx); if (v > best.v) best = { i, v }; }
    return best.i;
  }

  /* ───────── 商店、銀行、禮物 ───────── */
  // 商店(架上 stock 3 樣,只能買一樣)。優先順序:炒主攻股的事件卡 → 遙控骰子 → 利空卡 → 偵查報告 → 三顆骰子 → 其他有持股受惠的事件卡
  function shopPick(st, p, stock, ctx) {
    const F = focus(st, p, ctx), lv = ctx.lv, has = (id) => stock.includes(id);
    const evF = stock.find((id) => isEv(id) && evBest(id) === F);
    if (evF && p.cash >= CARD_PRICE + lv.reserve && ctx.rand() < lv.buyP) return evF;
    if (has('remote') && !p.bag.includes('remote') && p.cash >= REMOTE_PRICE + lv.reserve + 800 && ctx.rand() < lv.buyP) return 'remote';
    if (has('atk') && p.cash >= ATK_PRICE + lv.reserve && ctx.rand() < lv.atkP) return 'atk';
    if (has('spy') && !p.bag.includes('spy') && (p.bag.includes('atk') || ctx.level === 'hard') && p.cash >= SPY_PRICE + lv.reserve && ctx.rand() < lv.atkP) return 'spy';   // 想打人但不知道對手拿什麼:買偵查報告
    if (has('dice3') && p.cash >= DICE3_PRICE + lv.reserve + 800 && ctx.rand() < lv.buyP * 0.5) return 'dice3';
    return stock.find((id) => isEv(id) && p.hold[evBest(id)].n >= LOT && p.cash >= CARD_PRICE + lv.reserve) || null;
  }
  // 銀行:手頭寬裕又有欠款就還清(省利息);現金太少,或(普通 / 困難)想買主攻股但錢不夠、還剩 4 回合以上,就借最多 $3,000。
  // 回傳現金變化:> 0 借、< 0 還、0 路過
  function bankMove(st, p, ctx) {
    const lv = ctx.lv, F = focus(st, p, ctx), need = st.price[F] * LOT * lv.lots + lv.reserve;
    if (p.debt > 0 && p.cash >= p.debt + 4000) return -p.debt;
    if ((p.cash < 1500 || (p.cash < need && ctx.level !== 'easy' && st.maxRounds - st.rolls > 4)) && p.debt + 2000 <= BANK_MAX) return Math.min(3000, BANK_MAX - p.debt);
    return 0;
  }
  const giftPick = (picks, ctx) => picks[Math.floor(ctx.rand() * picks.length)];

  return { evEvent, evBest, isEv, itemPrice, take, shopStock, randomItem, giftPicks, giftPick, focus, tileScore, ruleDice, atkTarget, spyTarget, cardToPlay, useDice3, remoteSteps, shopPick, bankMove };
}
