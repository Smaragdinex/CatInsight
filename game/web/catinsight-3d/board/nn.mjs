// 神經網路推論(純 JavaScript,不用任何函式庫):讀 tools/nn/ 的訓練腳本匯出的權重,做多層感知器的前向計算。
// 第一層已經把特徵標準化併進去了,直接吃 sim.features() 的原始數字。瀏覽器、Web Worker、Node 都能用
const prep = (L) => ({ in: L.in, out: L.out, w: Float32Array.from(L.w), b: Float32Array.from(L.b) });
function dense(L, x, relu) {
  const o = new Float32Array(L.out);
  for (let j = 0; j < L.out; j++) { let s = L.b[j]; const off = j * L.in; for (let i = 0; i < L.in; i++) s += L.w[off + i] * x[i]; o[j] = relu && s < 0 ? 0 : s; }
  return o;
}
// 策略網路:局面 → 10 個交易動作的分數、擲 1 / 2 顆骰子的分數
export function makePolicy(m) {
  const layers = m.layers.map(prep), trade = prep(m.trade), dice = prep(m.dice);
  const body = (x) => layers.reduce((h, L) => dense(L, h, true), x);
  return { trade: (x) => dense(trade, body(x), false), dice: (x) => dense(dice, body(x), false), meta: { trained: m.trained, val: m.val } };
}
// 價值網路:局面 → 這位玩家最後拿第一的機率(0~1)
export function makeValue(m) {
  const layers = m.layers.map(prep), win = prep(m.win);
  return { win: (x) => 1 / (1 + Math.exp(-dense(win, layers.reduce((h, L) => dense(L, h, true), x), false)[0])), meta: { trained: m.trained, val: m.val } };
}
