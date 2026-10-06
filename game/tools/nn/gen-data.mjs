// 產生神經網路的訓練資料:node tools/nn/gen-data.mjs <局數> <種子> <輸出檔>
// 隨機組桌(2~4 人,至少一位蒙地卡羅),電腦依難度用 easy / normal / hard 參數(和遊戲一樣:規則式=簡單、期望值=普通、蒙地卡羅=困難)。
// 每一筆都是「那位玩家眼中的局面」(對手部位用公開帳本推測,不偷看),一局結束後再補上這位玩家最後的結果。
// 三種紀錄(type):
//   0 交易:蒙地卡羅在股票格的決定 —— 可選動作、每個動作模擬出來的平均分數、選了哪個、期望值策略原本建議哪個
//   1 擲骰:蒙地卡羅決定擲 1 顆還是 2 顆
//   2 局面:每位玩家每次走完的局面(給價值網路學「這個局面最後拿第一的機率」)
//   3 / 4 az 的交易 / 擲骰:q 欄放 MCTS 的搜尋次數分布(自我對弈時策略網路學這個)
// 環境變數:MIX=self 純自我對弈(全部座位都是 az;根節點加 Dirichlet 雜訊、前 10 回合依搜尋次數抽樣);MIX=az 舊的混合桌;
//           POLICY / VALUE 指定網路權重;AZN 每步模擬次數、AZH 模擬往後看幾回合
// 每筆一列 Float32,欄位見同名的 .json
import fs from 'node:fs';
import { gameData } from '../../web/catinsight-3d/board/data.mjs';
import { makeSim } from '../../web/catinsight-3d/board/sim.mjs';

const games = +process.argv[2] || 50, seed = +process.argv[3] || 1, out = process.argv[4] || 'tools/nn/data/sample.bin';
const D = gameData((en) => en, (n) => String(Math.round(n)));
const ALGS = ['rule', 'ev', 'mc', 'az'], LEVEL = { rule: 'easy', ev: 'normal', mc: 'hard', az: 'hard' };
const MIX = process.env.MIX || 'base', load = (f) => (f ? JSON.parse(fs.readFileSync(f)) : null);
const NA = 10;
let main = null, rows = [];

const sim = makeSim(D, {
  seed, nn: load(process.env.POLICY), nnValue: load(process.env.VALUE), az: { n: +process.env.AZN || 100, h: +process.env.AZH || 2, noise: MIX === 'az' || MIX === 'self' ? 1 : 0, temp: MIX === 'self' ? 1 : 0, tempRounds: 10 },
  onAZ: ({ kind, st, p, k, options, visits, chosen, base }) => {
    if (!main) return;
    const mask = new Array(NA).fill(0), q = new Array(NA).fill(0), tot = visits.reduce((a, b) => a + b, 0);
    const idx = (o) => (kind === 'trade' ? sim.actIndex(o) : o - 1);
    options.forEach((o, i) => { mask[idx(o)] = 1; q[idx(o)] += visits[i] / tot; });
    rows.push({ type: kind === 'trade' ? 3 : 4, i: p.i, f: sim.features(st, p.i, kind === 'trade' ? k : null), mask, ci: idx(chosen), bi: kind === 'trade' ? sim.actIndex(base) : base - 1, q });
  },
  onMC: ({ kind, st, p, k, options, means, chosen, base }) => {
    if (!main) return;
    const mask = new Array(NA).fill(0), q = new Array(NA).fill(0);
    let ci, bi;
    if (kind === 'trade') {
      options.forEach((o, i) => { const a = sim.actIndex(o); mask[a] = 1; q[a] = means[i] / D.START_CASH; });
      ci = sim.actIndex(chosen); bi = sim.actIndex(base);
    } else {                                   // 擲骰:第 0 格 = 1 顆、第 1 格 = 2 顆
      options.forEach((o, i) => { mask[o - 1] = 1; q[o - 1] = means[i] / D.START_CASH; });
      ci = chosen - 1; bi = base - 1;
    }
    rows.push({ type: kind === 'trade' ? 0 : 1, i: p.i, f: sim.features(st, p.i, kind === 'trade' ? k : null), mask, ci, bi, q });
  },
  onTurn: (st, p) => {
    if (st !== main) return;                   // 蒙地卡羅的模擬分身也會觸發 onTurn,只記真正的這一局
    rows.push({ type: 2, i: p.i, f: sim.features(sim.beliefOf(st, p.i), p.i), mask: new Array(NA).fill(0), ci: -1, bi: -1, q: new Array(NA).fill(0) });
  },
});

const COLS = ['type', 'alg', 'players', ...Array.from({ length: sim.NN_DIM }, (_, i) => 'f' + i), ...Array.from({ length: NA }, (_, i) => 'mask' + i), 'chosen', 'base',
  ...Array.from({ length: NA }, (_, i) => 'q' + i), 'win', 'margin', 'rank'];
fs.mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true });
const fd = fs.openSync(out, 'w');
const t0 = Date.now(); let total = 0;
for (let g = 0; g < games; g++) {
  const n = 2 + Math.floor(sim.rand() * 3);
  const pool = MIX === 'self' ? ['az'] : MIX === 'az' ? ['az', 'az', 'az', 'ev', 'mc'] : ['rule', 'ev', 'mc'], must = MIX === 'az' || MIX === 'self' ? 'az' : 'mc';
  const algs = Array.from({ length: n }, () => pool[Math.floor(sim.rand() * pool.length)]);
  if (!algs.includes(must)) algs[Math.floor(sim.rand() * n)] = must;
  main = sim.newGame(algs, 20, algs.map((a) => LEVEL[a]));
  rows = [];
  sim.playGame(main);
  // 結果用真正的最後資產算:拿第一 1(平手 0.5)、領先或落後第二強的差距、名次
  const fin = main.players.map((q) => sim.assetsOf(main, q));
  const res = fin.map((m, i) => { const best = Math.max(...fin.filter((_, j) => j !== i));
    return { win: m > best ? 1 : m === best ? 0.5 : 0, margin: (m - best) / D.START_CASH, rank: fin.filter((x) => x > m).length }; });
  const buf = new Float32Array(rows.length * COLS.length);
  rows.forEach((r, x) => {
    const o = x * COLS.length, R = res[r.i];
    buf.set([r.type, ALGS.indexOf(algs[r.i]), n], o); buf.set(r.f, o + 3); buf.set(r.mask, o + 3 + sim.NN_DIM);
    buf.set([r.ci, r.bi], o + 3 + sim.NN_DIM + NA); buf.set(r.q, o + 5 + sim.NN_DIM + NA); buf.set([R.win, R.margin, R.rank], o + 5 + sim.NN_DIM + 2 * NA);
  });
  fs.writeSync(fd, Buffer.from(buf.buffer));
  total += rows.length;
}
fs.closeSync(fd);
fs.writeFileSync(out.replace(/\.bin$/, '.json'), JSON.stringify({ cols: COLS, dim: sim.NN_DIM, actions: sim.NN_ACTIONS, rows: total, games }));
console.log(`${games} games, ${total} rows, ${((Date.now() - t0) / 1000).toFixed(1)}s → ${out}`);
