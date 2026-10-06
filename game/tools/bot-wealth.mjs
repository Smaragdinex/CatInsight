// 電腦最後資產分布:node tools/bot-wealth.mjs <alg> <回合> <局數> [seed]  → 平均、中位數、P(≥5 萬)
// 三人桌:測試的那個 alg 坐第 1 位,另外兩位是期望值電腦(mc 也一樣,避免整桌都跑模擬太慢)
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';
const [alg, rounds, games, seed] = [process.argv[2] || 'ev', +process.argv[3] || 20, +process.argv[4] || 500, +process.argv[5] || 1];
const sim = makeSim(gameData((en) => en, (n) => String(Math.round(n))), { seed });
const a = [];
for (let g = 0; g < games; g++) { const st = sim.newGame([alg, 'ev', 'ev'], rounds); sim.playGame(st); a.push(sim.assetsOf(st, st.players[0])); }
a.sort((x, y) => x - y);
console.log(JSON.stringify({ alg, rounds, games, mean: Math.round(a.reduce((x, y) => x + y, 0) / games), median: Math.round(a[games >> 1]), p90: Math.round(a[Math.floor(games * 0.9)]), max: Math.round(a[games - 1]), over50k: +(100 * a.filter((x) => x >= 50000).length / games).toFixed(1) }));
