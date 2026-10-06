// 蒙地卡羅參數對期望值策略:node tools/eval-mc.mjs [局數] [n] [depth] [z] [seed]
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const [games, n, depth, z, seed] = [+process.argv[2] || 200, +process.argv[3] || 120, +process.argv[4] || 3, process.argv[5] != null ? +process.argv[5] : 1, +process.argv[6] || 31];
const D = gameData((en) => en, (x) => String(Math.round(x)));
const sim = makeSim(D, { seed, mc: { n, depth, z } });
let w = 0, sum = 0, t0 = Date.now();
for (let g = 0; g < games; g++) { const s = g % 2, st = sim.newGame(s ? ['ev', 'mc'] : ['mc', 'ev'], 20); sim.playGame(st); const a = st.players.map((p) => sim.assetsOf(st, p)); const mi = s ? 1 : 0; if (a[mi] > a[1 - mi]) w++; sum += a[mi] - a[1 - mi]; }
const p = w / games; console.log(`n=${n} depth=${depth} z=${z}: mc win ${(100 * p).toFixed(1)}% ± ${(100 * Math.sqrt(p * (1 - p) / games)).toFixed(1)}, avg lead $${Math.round(sum / games)}, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
