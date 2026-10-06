// 幾組期望值參數各和規則式打 N 局(座位輪流),印勝率 ± 標準誤
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const games = +process.argv[2] || 1500;
const D = gameData((en) => en, (n) => String(Math.round(n)));
const base = { risk: 0.15, buyTh: 0, step: 0.01, cheap: 0, rebound: true, endSell: false, takeProfit: 0 };
const L = { ...base, lever: true, safeRatio: 2.2, reserve: 500 };
const C = {
  s02:        { ...L, maxLots: 5, step: 0.02 },
  s015:       { ...L, maxLots: 5, step: 0.015 },
  s025:       { ...L, maxLots: 5, step: 0.025 },
  s02_safe18: { ...L, maxLots: 5, step: 0.02, safeRatio: 1.8 },
  s02_risk0:  { ...L, maxLots: 5, step: 0.02, risk: 0 },
};
for (const [name, ev] of Object.entries(C)) {
  const sim = makeSim(D, { seed: +process.argv[3] || 4242, ev }); let w = 0, sum = 0;
  for (let g = 0; g < games; g++) { const s = g % 2, st = sim.newGame(s ? ['rule', 'ev'] : ['ev', 'rule'], 20); sim.playGame(st);
    const a = st.players.map((p) => sim.assetsOf(st, p)); if (a[s] >= a[1 - s]) w++; sum += a[s]; }
  const p = w / games; console.log(name.padEnd(8), `win ${(p * 100).toFixed(1)}% ± ${(100 * Math.sqrt(p * (1 - p) / games)).toFixed(1)}`, `avg $${Math.round(sum / games)}`);
}
