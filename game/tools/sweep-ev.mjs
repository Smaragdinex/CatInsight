// 掃期望值策略的參數:每組和規則式打 N 局,印勝率。node tools/sweep-ev.mjs [局數]
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const games = +process.argv[2] || 400;
const D = gameData((en) => en, (n) => String(Math.round(n)));
const grid = [];
for (const risk of [0, 0.15, 0.35]) for (const buyTh of [0, 0.01, 0.025]) for (const cheap of [0, 0.15]) for (const rebound of [false, true]) for (const endSell of [false, true]) for (const takeProfit of [0, 0.35])
  grid.push({ risk, buyTh, cheap, rebound, endSell, takeProfit, step: Math.max(0.01, buyTh || 0.01) });
const res = [];
for (const ev of grid) {
  const sim = makeSim(D, { seed: 999, ev });
  let w = 0, sum = 0;
  for (let g = 0; g < games; g++) { const evSeat = g % 2, algs = evSeat ? ['rule', 'ev'] : ['ev', 'rule']; const st = sim.newGame(algs, 20); sim.playGame(st);
    const a = st.players.map((p) => sim.assetsOf(st, p)); if (a[evSeat] >= a[1 - evSeat]) w++; sum += a[evSeat]; }
  res.push({ ...ev, win: w / games, avg: Math.round(sum / games) });
}
res.sort((a, b) => b.win - a.win || b.avg - a.avg);
console.log('top 10 / ' + res.length); res.slice(0, 10).forEach((r) => console.log(JSON.stringify(r)));
console.log('current default:', JSON.stringify(res.find((r) => r.risk === 0.35 && r.buyTh === 0.025 && r.cheap === 0.15 && !r.rebound && r.endSell && r.takeProfit === 0.35)));
