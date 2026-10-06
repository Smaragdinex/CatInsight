// 遊戲引擎(唯一一份規則,不碰畫面):買賣、融資、放空 / 回補、股價推動、斷頭 / 軋空、資產計算。
// board.mjs(真正的遊戲)和 sim.mjs(電腦模擬、對戰工具)都呼叫這裡,所以電腦模擬的世界 = 玩家玩的世界。
//
// 狀態 st 只需要 { price, players, turn }:board 傳 S、sim 傳自己的局面,形狀一樣。
// 玩家 p 需要 { cash, hold: {k: {n, cost, loan}}, short: {k: {n, entry}} },有 flags 的話會順便記成就旗標。
// hooks:遊戲畫面需要知道的副作用 —— onLiquidate(st, who, info) / onSqueeze(st, who, info),
//        info = { k, n, back, lost }。模擬器不用傳。
export function makeEngine(D, opts = {}) {
  const { KEYS, SECTORS, buyF, sellF, shortF, MARGIN_LOAN, MAINT, SQUEEZE, SALARY, MARGIN_FEE, BANK_RATE, DIV_ROUND,
    TILES, LANES, PATH_POOL, PATH_FIXED = {}, LANE_LEN, JAIL_WAIT, BAIL, FEE, IPO_OFF, IPO_LOCK, IPO_FREE, LOT, FATE,
    NON_EQUITY, MARKET_DRIFT = 0, DIV_STEP = 0.01, DIV_MAX = 0.08, DIV_MIN = 0.005, DIV_UP_PRICE = 1.04, DIV_CUT_PRICE = 0.92 } = D;
  const EQ = KEYS.filter((k) => !NON_EQUITY.has(k));                                   // 股票類股(大盤 ETF = 它們的平均)
  const ONES = Object.fromEntries(KEYS.map((k) => [k, 1]));
  const DIV_PAYERS = KEYS.filter((k) => SECTORS[k].div > 0 && k !== 'etf' && k !== 'bond');   // 股利事件只挑原本就有配息的公司
  const DRIFT = opts.drift ?? MARKET_DRIFT, DRIFTS = (k) => k === 'etf' || !NON_EQUITY.has(k);   // 大盤長期趨勢:股票和大盤 ETF
  const hooks = opts.hooks || {};
  // slippage === false:舊規則(先用舊價成交再推價),只給對照實驗用
  const SLIP = opts.slippage !== false;
  const FLOOR = 8;                                                    // 股價最低 $8

  /* ───────── 計價 ───────── */
  // 成交價 = 這筆交易把價格推動「之後」的價格:買 30 股推高 12%,就用 +12% 的價格成交
  const fill = (st, k, f) => (SLIP ? Math.max(FLOOR, st.price[k] * f) : st.price[k]);
  // 空單現值:保證金 + (進場價 − 現價) × 股數
  const shortValue = (st, p, k) => { const h = p.short[k]; return h.n ? Math.max(0, h.n * (2 * h.entry - st.price[k])) : 0; };
  // 回補拿回多少:用回補這筆把價格推高之後的價格算
  const coverBack = (st, k, h) => Math.max(0, h.n * (2 * h.entry - fill(st, k, buyF(h.n))));
  // 總資產 = 現金 − 銀行貸款 + 持股市值 − 融資借款 + 空單現值
  const assetsOf = (st, p) => p.cash - p.debt + KEYS.reduce((a, k) => a + p.hold[k].n * st.price[k] - p.hold[k].loan + shortValue(st, p, k), 0);
  // 維持率看整個帳戶:所有持股市值 ÷ 所有融資借款
  const acctRatio = (st, p) => { let v = 0, l = 0; for (const k of KEYS) { v += p.hold[k].n * st.price[k]; l += p.hold[k].loan; } return l > 0 ? v / l : Infinity; };
  const ratioOf = (st, h, k) => (h.loan > 0 ? h.n * st.price[k] / h.loan : Infinity);   // 單一檔的維持率(只拿來排先砍哪一檔)
  const flag = (p, name) => { if (p && p.flags) p.flags[name] = true; };

  /* ───────── 股價推動與強制平倉 ───────── */
  // 任何一次價格變動後都檢查:帳戶維持率 < 130% → 從最差的那檔融資部位開始賣,賣到回到 130% 以上(斷頭);
  // 空單比進場價漲 30% 以上 → 強迫回補(軋空)。被迫的買賣盤又會推動價格,可能連鎖
  // st.actor:這次價格變動是誰「自己的動作」造成的(買賣、利空卡、從背包打出的事件卡)。
  // 斷頭高手 / 軋空高手只算給 actor;隨機的市場事件、回合價格波動、反彈造成的不算任何人的
  const withActor = (st, p, fn) => { const keep = st.actor; st.actor = p; try { return fn(); } finally { st.actor = keep; } };
  function marginCheck(st) {
    const by = st.actor;
    for (const who of st.players) {
      for (let guard = 0; guard < KEYS.length && acctRatio(st, who) < MAINT; guard++) {
        let k = null; for (const x of KEYS) { if (who.hold[x].loan > 0 && (k === null || ratioOf(st, who.hold[x], x) < ratioOf(st, who.hold[k], k))) k = x; }
        if (k === null) break;
        const h = who.hold[k], n = h.n, back = Math.max(0, n * fill(st, k, sellF(n)) - h.loan), put = h.cost - h.loan;
        who.cash += back; h.n = 0; h.cost = 0; h.loan = 0;
        if (hooks.onLiquidate) hooks.onLiquidate(st, who, { k, n, back, lost: put - back });
        if (by && by !== who) flag(by, 'liquidator');
        impact(st, k, sellF(n));
      }
    }
    for (const who of st.players) for (const k of KEYS) {
      const h = who.short[k];
      if (!h.n || st.price[k] < h.entry * SQUEEZE) continue;
      squeeze(st, who, k);
      if (by && by !== who) flag(by, 'squeezer');
    }
  }
  function impact(st, k, f) { st.price[k] = Math.max(FLOOR, st.price[k] * f); marginCheck(st); }
  // 強迫回補一筆空單(軋空、迷因股事件都用這個)
  function squeeze(st, who, k) {
    const h = who.short[k], n = h.n, back = coverBack(st, k, h), put = h.entry * n;
    who.cash += back; h.n = 0; h.entry = 0;
    if (hooks.onSqueeze) hooks.onSqueeze(st, who, { k, n, back, lost: put - back });
    impact(st, k, buyF(n));
  }

  /* ───────── 交易 ───────── */
  // 買進 q 股;margin = true 用融資(自備 4 成、借 6 成)
  function buy(st, p, k, q, margin = false) {
    const h = p.hold[k], price = st.price[k], cost = fill(st, k, buyF(q)) * q, loan = margin ? cost * MARGIN_LOAN : 0;
    p.cash -= cost - loan; h.n += q; h.cost += cost; h.loan += loan;
    if (price < SECTORS[k].open * 0.97) flag(p, 'dip');                // 逢低買進
    withActor(st, p, () => impact(st, k, buyF(q)));
    return { q, cost, loan, pay: cost - loan };
  }
  // 賣出 q 股(不傳就全賣);融資借款按賣掉的比例一起還。先把部位清掉再動價格,自己的賣壓才不會觸發自己的斷頭
  // forced = true:不是自己決定賣的(命運牌「手滑」),不算成就
  // 內部認購的股票有閉鎖期:鎖住的股數不能自己賣;被斷頭(forced)時照樣會被強制賣掉
  const lockedN = (st, h) => (h.lockUntil && st.rolls < h.lockUntil ? Math.min(h.locked || 0, h.n) : 0);
  function sell(st, p, k, q = Infinity, forced = false) {
    const h = p.hold[k], sn = Math.min(q, h.n - (forced ? 0 : lockedN(st, h))); if (!(sn > 0)) return null;
    const part = sn / h.n, value = fill(st, k, sellF(sn)) * sn, cost = h.cost * part, loan = h.loan * part;
    if (!forced && (value - cost) / cost >= 0.15) flag(p, 'profit');   // 獲利了結
    if (!forced && loan > 0 && value > cost) flag(p, 'marginWin');     // 借力使力:融資部位獲利出場
    p.cash += value - loan; h.n -= sn; h.cost -= cost; h.loan -= loan;
    if (h.n <= 0) { h.n = 0; h.cost = 0; h.loan = 0; h.locked = 0; h.lockUntil = 0; } else if (h.locked > h.n) h.locked = h.n;
    withActor(st, p, () => impact(st, k, sellF(sn)));
    return { n: sn, value, cost, loan, pl: value - cost };
  }
  // 放空 q 股:用壓低後的價格進場,付出等額保證金
  function short(st, p, k, q) {
    const sh = p.short[k], e = fill(st, k, shortF(q));
    p.cash -= e * q; sh.entry = e; sh.n = q;
    withActor(st, p, () => impact(st, k, shortF(q)));
    return { q, entry: e, pay: e * q };
  }
  // 自己回補整筆空單
  function cover(st, p, k) {
    const sh = p.short[k], n = sh.n; if (!n) return null;
    const back = coverBack(st, k, sh), pl = back - sh.entry * n, r = pl / (sh.entry * n);
    if (r >= 0.15) flag(p, 'profit');
    if (r >= 0.2) flag(p, 'shortWin');                                 // 空軍總司令
    p.cash += back; sh.n = 0; sh.entry = 0;
    withActor(st, p, () => impact(st, k, buyF(n)));
    return { n, back, pl };
  }
  // act = { a: 'buy'|'margin'|'sell'|'short'|'cover'|'skip', q }
  function trade(st, p, k, act) {
    if (act.a === 'buy' || act.a === 'margin') return buy(st, p, k, act.q, act.a === 'margin');
    if (act.a === 'sell') return sell(st, p, k, act.q);
    if (act.a === 'short') return short(st, p, k, act.q);
    if (act.a === 'cover') return cover(st, p, k);
    return null;
  }

  /* ───────── 配息、薪水、利息 ───────── */
  // 殖利率是每局動態的(st.div,股利事件會改)。dividends:這位玩家持股的「全額」股利(股息格、特別股利牌)
  const dividendsOf = (st, p) => KEYS.reduce((a, k) => a + p.hold[k].n * st.price[k] * st.div[k], 0);
  // 每回合配息:每位玩家領年率的 DIV_ROUND(四分之一),四捨五入。回傳有領到錢的 [{ p, div }](畫面拿去跳提示)
  function roundDividends(st) {
    const paid = [];
    for (const p of st.players) {
      const div = Math.round(KEYS.reduce((a, k) => a + p.hold[k].n * st.price[k] * st.div[k] * DIV_ROUND, 0));
      if (div <= 0) continue;
      p.cash += div; p.divTotal = (p.divTotal || 0) + div; p.lastDividend = div;
      paid.push({ p, div });
    }
    return paid;
  }
  // 經過起點(atStart):領薪水(升職加薪時加倍,用掉就恢復),付融資利息和銀行貸款利息;
  // 股息格 / 特別股利(!atStart):領全額股利。回傳各項金額給畫面顯示
  function payday(st, p, atStart) {
    const salary = atStart ? SALARY * (p.salary2 ? 2 : 1) : 0; if (atStart) p.salary2 = false;
    const div = atStart ? 0 : dividendsOf(st, p);
    const interest = atStart ? KEYS.reduce((a, k) => a + p.hold[k].loan * MARGIN_FEE, 0) : 0, bank = atStart ? p.debt * BANK_RATE : 0;
    p.cash += salary + div - (interest + bank);
    if (!atStart) { p.lastDividend = div; p.divTotal = (p.divTotal || 0) + div; }   // 股息格的股利也算進成就(領到股利、股息大戶)
    return { salary, div, interest, bank };
  }

  /* ───────── 事件卡 ───────── */
  // 有些牌要「抽到的當下」才決定內容(rand:亂數來源,遊戲傳 Math.random、模擬器傳自己的種子亂數):
  //   divUp:隨機挑 n 家有配息、但不是目前配最多的公司,殖利率 +1 個百分點、股價 +4%
  //   divCut:'top' 配最多的那家(同分隨機)/ 'any' 隨機一家,殖利率 −1 個百分點(最低 0.5%)、股價 −8%
  //   meme:場上被放空最多的那檔(沒人放空就隨機一檔股票)暴漲 50%,所有空單強迫回補
  // 回傳新的事件物件;divTo 記好「從幾 % 到幾 %」,牌面顯示和生效用同一組數字。標題由畫面自己加
  function instantiate(st, e, rand) {
    if (e.divUp || e.divCut) {
      let keys;
      if (e.divUp) { const top = Math.max(...DIV_PAYERS.map((k) => st.div[k])); keys = DIV_PAYERS.filter((k) => st.div[k] < top - 1e-9 && st.div[k] < DIV_MAX - 1e-9).sort(() => rand() - 0.5).slice(0, e.divUp); }
      else { let pool = DIV_PAYERS.filter((k) => st.div[k] > DIV_MIN + 1e-9); if (e.divCut === 'top') { const top = Math.max(...pool.map((k) => st.div[k])); pool = pool.filter((k) => st.div[k] >= top - 1e-9); } keys = pool.length ? [pool[Math.floor(rand() * pool.length)]] : []; }
      const up = !!e.divUp, m = { ...ONES }; keys.forEach((k) => { m[k] = up ? DIV_UP_PRICE : DIV_CUT_PRICE; }); m.etf = EQ.reduce((a, x) => a + m[x], 0) / EQ.length;
      const divTo = Object.fromEntries(keys.map((k) => [k, [st.div[k], up ? Math.min(DIV_MAX, st.div[k] + DIV_STEP) : Math.max(DIV_MIN, st.div[k] - DIV_STEP)]]));
      return { ...e, m, divKeys: keys, divTo };
    }
    if (!e.meme) return e;
    const tot = (k) => st.players.reduce((a, p) => a + p.short[k].n, 0);
    const k = EQ.some((x) => tot(x) > 0) ? EQ.slice().sort((a, b) => tot(b) - tot(a))[0] : EQ[Math.floor(rand() * EQ.length)];
    return { ...e, m: { ...ONES, [k]: 1.5, etf: Math.round((1 + 0.5 / EQ.length) * 100) / 100 }, squeezeAll: k };
  }
  // 事件生效:改股價、發錢、改殖利率、記下崩盤後的反彈(st.after,下一回合開始時套用),再檢查斷頭 / 軋空
  function applyEvent(st, e) {
    const bad = (e.m.etf || 1) < 0.97, worth = (p) => KEYS.reduce((a, k) => a + p.hold[k].n * st.price[k], 0), before = bad ? st.players.map(worth) : null;
    KEYS.forEach((k) => { st.price[k] *= e.m[k]; });
    if (bad) st.players.forEach((p, i) => { if (before[i] > 0 && worth(p) > before[i]) flag(p, 'dodge'); });   // 壞消息裡持股反而漲:躲過黑天鵝
    if (e.cash) st.players.forEach((p) => { p.cash += e.cash; });
    if (e.divTo) e.divKeys.forEach((k) => { st.div[k] = e.divTo[k][1]; });
    if (e.trend != null) st.trend = e.trend;                                // 大盤趨勢轉向(戰爭、危機轉空;降息、景氣好轉多),維持到下一張改趨勢的牌
    if (e.rebound) st.after = { m: Object.fromEntries(KEYS.map((k) => [k, e.m[k] < 1 ? 1 + (1 / e.m[k] - 1) * e.rebound : 1])), from: e };   // 跌掉的部分下回合漲回 rebound 比例
    marginCheck(st);
    if (e.squeezeAll) for (const p of st.players) { if (p.short[e.squeezeAll].n) squeeze(st, p, e.squeezeAll); }
  }
  // 目前的大盤趨勢(每回合):事件卡會改;沒設定過就用開局值 MARKET_DRIFT
  const trendOf = (st) => (opts.drift ?? st.trend ?? DRIFT);
  // 新的一回合開始:回合數 +1 → 每回合配息 → 套用上回合留下的反彈 → 所有價格小幅隨機波動(股票和大盤 ETF 再加上大盤趨勢)
  // 回傳 { paid: 領到配息的人, after: 套用的反彈事件 } 給畫面顯示
  function newRound(st, rand) {
    st.rolls++;
    if (opts.recover && st.trend != null && st.trend < DRIFT) st.trend = Math.min(DRIFT, st.trend + opts.recover);   // (實驗)恐慌慢慢退去
    const paid = roundDividends(st), after = st.after;
    if (after) { st.after = null; applyEvent(st, after); }
    const tr = trendOf(st);
    KEYS.forEach((k) => { const v = SECTORS[k].vol ?? 0.03; st.price[k] = Math.max(FLOOR, st.price[k] * (1 - v + rand() * v * 2) * (DRIFTS(k) ? 1 + tr : 1)); });
    return { paid, after };
  }

  /* ───────── 回合流程:擲骰、移動、小路、格子效果、命運牌、IPO、銀行、商店 ───────── */
  // 骰子點數:forced = 遙控骰子指定的總點數(6 以內一顆、7 以上拆成兩顆),nDice = 1 / 2 / 3(三顆骰子道具)
  const r6 = (rand) => 1 + Math.floor(rand() * 6);
  function dice(nDice, forced, rand) {
    if (forced) return forced <= 6 ? [forced] : [Math.floor(forced / 2), forced - Math.floor(forced / 2)];
    return nDice === 3 ? [r6(rand), r6(rand), r6(rand)] : nDice === 1 ? [r6(rand)] : [r6(rand), r6(rand)];
  }
  // 小路(警察局 / IPO 出來的 6 格):固定格(第 3 格市場事件)、2 格命運隨機放、其他從池子隨機排、不重複
  function genLanePath(type, rand) {
    const t = new Array(LANE_LEN).fill(null), fixed = PATH_FIXED[type] || {};
    for (const i in fixed) t[i] = fixed[i];
    const free = () => t.map((v, i) => (v ? -1 : i)).filter((i) => i >= 0);
    const pool = PATH_POOL[type].slice().sort(() => rand() - 0.5);      // 池子就是剩下那幾格的種類(可以和固定格重複,例如第二格市場事件)
    for (let i = 0; i < LANE_LEN; i++) if (!t[i]) t[i] = pool.pop();
    return t;
  }
  // 進小路(被送進警察局 / 抽中 IPO):沒有別人正走在這條小路上,就重新生成小路的格子。回傳 { regen }(畫面要重畫小路)
  function enterLane(st, p, type, rand) {
    let regen = false;
    if (!st.players.some((q) => q !== p && q.lane && q.lane.type === type && q.lane.at > 0)) { st.lanePath[type] = genLanePath(type, rand); regen = true; }
    p.lane = { type, wait: type === 'jail' ? JAIL_WAIT : 0, at: 0 };         // at:0 = 在攤位 / 警察局,1~6 = 小路第幾格
    return { regen };
  }
  // 往前走一步。在小路上:往小路下一格;走完小路:踏上外圈的出口格;外圈:下一格,踩到 / 經過起點、股息格就結算。
  // 回傳這一步去了哪裡,畫面照著播動畫:{ kind: 'lane', type, at } | { kind: 'exit', pos } | { kind: 'step', pos, pay }
  function advance(st, p) {
    if (p.lane) {
      if (p.lane.at < LANE_LEN) { p.lane.at++; return { kind: 'lane', type: p.lane.type, at: p.lane.at }; }
      const pos = LANES[p.lane.type].exit; p.lane = null; p.pos = pos; return { kind: 'exit', pos };
    }
    p.pos = (p.pos + 1) % TILES.length;
    const atStart = p.pos === 0, pay = atStart || TILES[p.pos] === 'divi' ? { atStart, ...payday(st, p, atStart) } : null;
    return { kind: 'step', pos: p.pos, pay };
  }
  // 現在站的格子是什麼:外圈就是 TILES 的種類;小路上:'_jail' / '_ipo'(還在攤位)、'fate'、'_chance'、'_gift'、'_fee'、'_interest'、'_coin'
  function tileType(st, p, rand) {
    if (!p.lane) return TILES[p.pos];
    if (!p.lane.at) return '_' + p.lane.type;
    const k = (st.lanePath[p.lane.type] || genLanePath(p.lane.type, rand))[p.lane.at - 1];
    return k === 'fate' ? 'fate' : k === 'blank' ? '_path' : '_' + k;
  }
  // 小路專屬格子:利息(現金 3%)、撿到錢 $300、手續費 $200。回傳現金變化
  function pathEffect(st, p, k) {
    const x = k.replace(/^_/, '');
    const d = x === 'interest' ? Math.round(Math.max(0, p.cash) * 0.03) : x === 'coin' ? 300 : x === 'fee' ? -200 : 0;
    p.cash += d; return d;
  }
  const payFee = (st, p) => { p.cash -= FEE; return FEE; };                 // 外圈的手續費格
  const rest = (st, p) => { p.lane.wait--; return p.lane.wait; };          // 警察局:再休息一回合
  const bail = (st, p) => { p.cash -= BAIL; p.lane.wait = 0; };              // 付保釋金,這回合就能擲骰出去
  // 命運牌。回傳畫面要做的事:{ id, amount? , from?(請客的人), pay?, k?(手滑賣掉的那檔), other?(瞬間移動的對象), lane?(要進的小路) }
  // 瞬間移動之後要重新結算換到的那一格、IPO 要進小路,這兩件由呼叫端接著做
  function fate(st, p, c, rand) {
    const others = st.players.filter((q) => q !== p), r = { id: c.id };
    if (c.id === 'lottery') { p.cash += 1500; r.amount = 1500; }
    else if (c.id === 'tax') { const t = Math.round(Math.max(0, p.cash) * 0.05); p.cash -= t; r.amount = -t; }
    else if (c.id === 'birthday') { let got = 0; others.forEach((q) => { q.cash -= 200; got += 200; }); p.cash += got; r.amount = got; }
    else if (c.id === 'phone') { p.cash -= 300; r.amount = -300; }
    else if (c.id === 'fine') { p.cash -= 500; r.amount = -500; }
    else if (c.id === 'richest') { const q = others.sort((a, b) => assetsOf(st, b) - assetsOf(st, a))[0]; if (q) { q.cash -= 500; p.cash += 500; r.from = q; } }
    else if (c.id === 'remote' || c.id === 'atk') p.bag.push(c.id);
    else if (c.id === 'divi') r.pay = payday(st, p, false);
    else if (c.id === 'salary2') p.salary2 = true;
    else if (c.id === 'gostart') { p.lane = null; p.pos = 0; r.pay = payday(st, p, true); }
    else if (c.id === 'fat') { const held = KEYS.filter((k) => p.hold[k].n - lockedN(st, p.hold[k]) > 0); if (held.length) { r.k = held[Math.floor(rand() * held.length)]; const s = sell(st, p, r.k, LOT, true); r.n = s ? s.n : 0; } }   // 隨機一檔賣 LOT 股(不是挑賠錢的);鎖住的內部認購股賣不掉
    else if (c.id === 'swap') { const q = others[Math.floor(rand() * others.length)]; if (q) { [p.pos, q.pos] = [q.pos, p.pos]; [p.lane, q.lane] = [q.lane, p.lane]; r.other = q; } }
    else if (c.id === 'ipo') r.lane = 'ipo';
    else if (c.id === 'jail') r.lane = 'jail';
    return r;
  }
  // 內部認購:隨機一檔(沒在放空的)股票,先送 IPO_FREE 股;再用市價 8 折認購,一定買得到,認購的股數鎖 IPO_LOCK 回合不能賣。新股不會推動市價
  const ipoPick = (st, p, rand) => { const pool = EQ.filter((k) => !p.short[k].n); return pool[Math.floor(rand() * pool.length)]; };
  // 送的股票成本算認購價(只是不用付錢),這樣損益百分比才有意義;送的不鎖,馬上可以賣
  function ipoGrant(st, p, k) { const h = p.hold[k]; h.n += IPO_FREE; h.cost += st.price[k] * IPO_OFF * IPO_FREE; }
  function ipoBuy(st, p, k, n) {
    const h = p.hold[k], cost = st.price[k] * IPO_OFF * n; p.cash -= cost; h.n += n; h.cost += cost;
    h.locked = lockedN(st, h) + n; h.lockUntil = st.rolls + IPO_LOCK; return cost;
  }
  // 銀行:d > 0 借款、d < 0 還款(現金和欠款一起變)
  const bank = (st, p, d) => { p.cash += d; p.debt += d; };
  // 商店:買一樣道具
  const buyItem = (st, p, id, price) => { p.cash -= price; p.bag.push(id); };

  return { trendOf, dice, genLanePath, enterLane, advance, tileType, pathEffect, payFee, rest, bail, fate, ipoPick, ipoGrant, ipoBuy, lockedN, bank, buyItem,
    withActor, instantiate, applyEvent, newRound, roundDividends, payday, dividendsOf, fill, shortValue, coverBack, assetsOf, acctRatio, ratioOf, marginCheck, impact, squeeze, buy, sell, short, cover, trade, SLIP };
}
