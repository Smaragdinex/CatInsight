// 股神($100,000 = 起始 10 倍)可不可能?node tools/stock-god.mjs <策略> <回合> <局數> [seed]
// 一個「測試玩家」用指定策略,對手是兩個期望值電腦;記錄測試玩家每局的資產最高點,和到達最高點時資產最大的那檔
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const [strat, rounds, games, seed] = [process.argv[2] || 'allin', +process.argv[3] || 20, +process.argv[4] || 2000, +process.argv[5] || 1];
const D = gameData((en) => en, (n) => String(Math.round(n)));
const VOL = new Set(['crypto', 'bio', 'chip', 'tech', 'green', 'game', 'soft']);
// 全押:能買多少買多少(最多 5 手),現金夠付 4 成就用融資(可以重複融資,和真人一樣),永遠不賣;only(k) 只買那一檔
const allin = (ok) => (st, p, k, api) => {
  if (!ok(k) || p.short[k].n) return { a: 'skip' };
  for (let lots = 5; lots >= 1; lots--) { const q = api.LOT * lots, cost = api.fill(st, k, api.buyF(q)) * q;
    if (p.cash >= cost * (1 - api.MARGIN_LOAN) + 200) { let v = 0, l = 0; for (const x in p.hold) { v += p.hold[x].n * st.price[x]; l += p.hold[x].loan; }
      if ((v + cost) / (l + cost * api.MARGIN_LOAN) >= 1.6) return { a: 'margin', q }; }
    if (p.cash >= cost + 200) return { a: 'buy', q }; }
  return { a: 'skip' };
};
const policies = { allin: allin(() => true), vol: allin((k) => VOL.has(k)) };
for (const k of D.KEYS) policies['only_' + k] = allin((x) => x === k);
let peak = 0, peakTop = null, main = null;
const sim = makeSim(D, { seed, policies, onTurn: (st) => { if (st !== main) return; const p = st.players[0], a = sim.assetsOf(st, p);
  if (a > peak) { peak = a; peakTop = D.KEYS.slice().sort((x, y) => p.hold[y].n * st.price[y] - p.hold[x].n * st.price[x])[0]; } } });
const peaks = [], hits = {}; let god = 0;
for (let g = 0; g < games; g++) {
  main = sim.newGame([strat, 'ev', 'ev'], rounds); peak = 0; peakTop = null;
  sim.playGame(main); peaks.push(peak);
  if (peak >= 100000) { god++; hits[peakTop] = (hits[peakTop] || 0) + 1; }
}
peaks.sort((a, b) => a - b); const q = (x) => Math.round(peaks[Math.floor(x * (peaks.length - 1))]);
console.log(JSON.stringify({ strat, rounds, games, godPct: +(100 * god / games).toFixed(2), median: q(0.5), p99: q(0.99), max: q(1), godBy: hits }));
