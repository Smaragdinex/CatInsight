// 重構驗證用:固定種子跑幾局,印出所有玩家最後資產、現金、股價的總和(到小數點),改程式前後要一模一樣
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const D = gameData((en) => en, (n) => String(Math.round(n)));
const policies = { allin: (st, p, k, api) => { for (let l = 5; l >= 1; l--) { const q = api.LOT * l, c = api.fill(st, k, api.buyF(q)) * q; if (p.cash >= c * 0.4 + 200) return { a: 'margin', q }; } return { a: 'skip' }; } };
const out = [];
for (const [algs, rounds, n, mc] of [[['rule', 'ev', 'ev'], 20, 60, null], [['allin', 'ev', 'rule', 'ev'], 30, 40, null], [['ev', 'mc'], 20, 3, { n: 30, depth: 2 }]]) {
  const sim = makeSim(D, { seed: 4321, policies, mc: mc || undefined });
  let a = 0, c = 0, px = 0;
  for (let g = 0; g < n; g++) { const st = sim.newGame(algs, rounds); sim.playGame(st); for (const p of st.players) { a += sim.assetsOf(st, p); c += p.cash; } for (const k of D.KEYS) px += st.price[k]; }
  out.push(`${algs.join(',')} x${n}: assets ${a.toFixed(4)} cash ${c.toFixed(4)} prices ${px.toFixed(4)}`);
}
console.log(out.join('\n'));
