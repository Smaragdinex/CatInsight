// 電腦對手的蒙地卡羅模擬跑在 Web Worker 裡,主執行緒的動畫不會卡。board.mjs 丟 { id, kind, st, i, k, mc } 進來,回 { id, act }
import { gameData } from './data.mjs?v=16';
import { makeSim } from './sim.mjs?v=23';
const sims = {};
self.onmessage = (ev) => {
  const { id, kind, st, i, k, mc, zh } = ev.data;
  const key = JSON.stringify(mc) + (zh ? 'zh' : 'en');
  const sim = sims[key] || (sims[key] = makeSim(gameData((en, z) => (zh ? z : en), (n) => String(Math.round(n))), { mc }));
  const p = st.players[i];
  let act;
  try { act = kind === 'dice' ? (mc.alg === 'mc' ? sim.mcDice(st, p) : sim.evDice(st, p)) : (mc.alg === 'mc' ? sim.mcTrade(st, p, k) : sim.evTrade(st, p, k)); }
  catch (e) { act = { error: String(e) }; }
  self.postMessage({ id, act });
};
