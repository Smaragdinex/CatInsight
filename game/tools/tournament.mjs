// 電腦對手互打:node tools/tournament.mjs [games] [rounds]
// 用 sim.mjs 把 規則式(rule)/ 期望值(ev)/ 蒙地卡羅(mc)三種策略放在同一桌,算勝率和平均資產
import { gameData } from '../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../web/catinsight-3d/board/sim.mjs';

const games = +process.argv[2] || 100, rounds = +process.argv[3] || 20;
const mcN = +process.argv[4] || 120, mcDepth = +process.argv[5] || 3;
const D = gameData((en, zh) => en, (n) => String(Math.round(n)));
const score = process.argv[6] || 'lead';
const slippage = process.env.SLIP !== '0';   // 預設照遊戲規則用「推動後的價格」成交;SLIP=0 切回舊規則做對照
// 有 nn(神經網路)座位就讀遊戲用的同一份權重
import fs from 'node:fs';
// az 座位讀 NN_DIR(預設 tools/nn/models)的網路;azb 座位讀 NNB_DIR —— 新舊兩代可以直接對打
const spec7 = process.argv[7] || '', useNN = /(^|,)(nn|az|azb)(,|$)/.test(spec7);
const model = (dir, f) => JSON.parse(fs.readFileSync(dir ? `${dir}/${f}` : new URL(`./nn/models/${f}`, import.meta.url)));
const nn = useNN ? model(process.env.NN_DIR, 'nn-policy.json') : null, nnValue = /(^|,)azb?(,|$)/.test(spec7) ? model(process.env.NN_DIR, 'nn-value.json') : null;
const nnB = /(^|,)azb(,|$)/.test(spec7) ? model(process.env.NNB_DIR, 'nn-policy.json') : null, nnValueB = nnB ? model(process.env.NNB_DIR, 'nn-value.json') : null;
const sim = makeSim(D, { seed: +process.env.SEED || 12345, slippage, mc: { n: mcN, depth: mcDepth, score }, nn, nnValue, nnB, nnValueB, nnConf: +process.env.NNC || 0, az: { n: +process.env.AZN || 100, h: +process.env.AZH || 2 } });   // 固定種子,結果可重現
const rand = sim.rand;

function table(algs, label) {
  const wins = algs.map(() => 0), sum = algs.map(() => 0), t0 = Date.now();
  for (let g = 0; g < games; g++) {
    const order = algs.map((a, i) => i).sort(() => rand() - 0.5);          // 每局換座位,避免先手優勢
    const st = sim.newGame(order.map((i) => algs[i]), rounds);
    sim.playGame(st);
    const a = st.players.map((p) => sim.assetsOf(st, p)), best = Math.max(...a);
    st.players.forEach((p, seat) => { const i = order[seat]; sum[i] += a[seat]; if (a[seat] === best) wins[i]++; });
  }
  console.log(`\n${label}  (${games} games × ${rounds} rounds, ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  algs.forEach((a, i) => console.log(`  ${a.padEnd(5)} win ${(100 * wins[i] / games).toFixed(0).padStart(3)}%   avg assets $${Math.round(sum[i] / games).toLocaleString()}`));
}
// 第 7 個參數可以指定對戰組合,例如 "ev,mc;rule,ev,mc"(用 ; 分組、, 分座位)
const spec = process.argv[7];
if (spec) spec.split(';').forEach((g) => table(g.split(','), g));
else { table(['rule', 'ev'], 'rule vs ev'); table(['ev', 'mc'], 'ev vs mc'); table(['rule', 'ev', 'mc'], 'rule vs ev vs mc'); table(['rule', 'rule', 'ev', 'mc'], '4 players'); }
