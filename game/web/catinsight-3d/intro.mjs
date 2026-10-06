// intro.mjs — 功能介紹頁(鏡頭飛進電腦螢幕後的 8 頁)
// 每頁:左邊文字、右邊一個「會動的 widget」,用 HTML/CSS/canvas 做出 App 該功能的縮影,不用截圖。
// room.mjs 只負責翻頁;這裡負責建立頁面與啟動 / 停止各頁的動畫(只跑目前這一頁,省 CPU)。

const APP_STORE = 'https://apps.apple.com/app/id6763914049';

export const SLIDES = [
  { key: 'hero',    color: '#4be07a', title: 'CatInsight <span class="green">Stock</span>', text: 'AI that reads the market for you. US and Taiwan stocks, one app.', zh: 'AI 幫你看股票 · 美股與台股' },
  { key: 'picks',   color: '#f5c451', eyebrow: 'AI PICKS',   title: 'Daily AI Picks',    text: 'A ranking model re-scores the whole market every day and surfaces clear buy / sell signals.', zh: '每日 AI 精選,自動換榜' },
  { key: 'chart',   color: '#4be07a', eyebrow: 'CHARTS',     title: 'Pro Charts',        text: '1D · 1W · 1M · 3M · YTD · 1Y, with a crosshair to check any price at a glance.', zh: '專業線圖,十字線查價 · 試著把滑鼠移到圖上' },
  { key: 'gainers', color: '#ff7a59', eyebrow: 'MOVERS',     title: 'Top Gainers',       text: 'See the biggest movers, sorted by 1D, 1Y or year-to-date.', zh: '漲幅排行 1D / 1Y / YTD' },
  { key: 'news',    color: '#7b9cff', eyebrow: 'NEWS',       title: 'AI Reads the News', text: 'Every headline boiled down to three sentences, with a bullish / bearish / neutral call.', zh: 'AI 幫你讀新聞,三句摘要 + 偏多偏空' },
  { key: 'voice',   color: '#8b7cff', eyebrow: 'VOICE',      title: 'Talk to the AI',    text: 'Ask anything by voice, ChatGPT-style. Interrupt it any time, it listens.', zh: '語音對話,隨時可以打斷' },
  { key: 'alerts',  color: '#ff5c8a', eyebrow: 'ALERTS',     title: 'Smart Alerts',      text: 'Price targets, tomorrow\'s earnings and daily pick changes, pushed straight to your phone.', zh: '推播提醒:到價、明日財報、AI 換榜' },
  { key: 'app',     color: '#ffffff', eyebrow: 'DOWNLOAD',   title: 'Get the App',       text: 'Free on the App Store. Scan the code or tap the button.', zh: '免費下載 · Android 即將推出', cta: true },
];

// ---------- 小工具 ----------
const h = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const rng = (seed) => () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
const walk = (seed, n, start, vol, drift = 0) => { const r = rng(seed); const a = []; let v = start; for (let i = 0; i < n; i++) { v = Math.max(1, v * (1 + (r() - 0.5) * vol + drift)); a.push(v); } return a; };
const fmt = (v) => v >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 0 }) : v.toFixed(2);
const pct = (v) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`;
const loopRAF = (fn) => { let id = 0, on = true; const t0 = performance.now(); const tick = (now) => { if (!on) return; fn((now - t0) / 1000); id = requestAnimationFrame(tick); }; id = requestAnimationFrame(tick); return () => { on = false; cancelAnimationFrame(id); }; };
const every = (ms, fn) => { const id = setInterval(fn, ms); return () => clearInterval(id); };
const later = (ms, fn) => { const id = setTimeout(fn, ms); return () => clearTimeout(id); };
const fitCanvas = (c) => { const dpr = Math.min(devicePixelRatio || 1, 2); const w = c.clientWidth, hh = c.clientHeight; if (c.width !== Math.round(w * dpr) || c.height !== Math.round(hh * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(hh * dpr); } const g = c.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); return [g, w, hh]; };
// 畫一條有漸層填色的折線
function drawLine(g, series, x0, y0, w, hh, color, { fill = true, width = 2, pad = 0.12 } = {}) {
  const min = Math.min(...series), max = Math.max(...series), p = (max - min) * pad + 1e-6;
  const X = (i) => x0 + i / (series.length - 1) * w, Y = (v) => y0 + hh - (v - (min - p)) / (max - min + 2 * p) * hh;
  if (fill) { const gr = g.createLinearGradient(0, y0, 0, y0 + hh); gr.addColorStop(0, color + '55'); gr.addColorStop(1, color + '00'); g.beginPath(); g.moveTo(X(0), y0 + hh); series.forEach((v, i) => g.lineTo(X(i), Y(v))); g.lineTo(X(series.length - 1), y0 + hh); g.closePath(); g.fillStyle = gr; g.fill(); }
  g.beginPath(); series.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v))); g.strokeStyle = color; g.lineWidth = width; g.lineJoin = 'round'; g.stroke();
  return { X, Y };
}

// ---------- 建立頁面 ----------
const slideEls = [];
export function buildSlides(track) {
  SLIDES.forEach((sl, i) => {
    const el = h('div', `slide slide-${sl.key}`); el.style.top = `${i * 100}%`; el.style.setProperty('--c', sl.color);
    if (sl.key === 'hero') {
      el.innerHTML = `<div class="hero"><canvas class="bgc"></canvas><div class="chips"></div>
        <div class="icon img"><img src="/assets/icon-180.png" alt="CatInsight Stock"></div>
        <h2>${sl.title}</h2><p>${sl.text}</p><div class="zh">${sl.zh}</div></div>`;
    } else {
      // 下載頁:大顆貓咪 icon 放在標題右邊(同一列)
      const titleHtml = sl.cta ? `<div class="ttl"><h2>${sl.title}</h2><img class="h2icon" src="/assets/icon-180.png" alt=""></div>` : `<h2>${sl.title}</h2>`;
      el.innerHTML = `<div class="s"><div class="txt"><div class="eyebrow">${String(i).padStart(2, '0')} · ${sl.eyebrow}</div>${titleHtml}<p>${sl.text}</p><div class="zh">${sl.zh}</div>` +
        (sl.cta ? `<a class="store" href="${APP_STORE}"> Download on the App Store</a>` : '') +
        `</div><div class="wg"><div class="glow"></div><div class="wgin"></div></div></div>`;
    }
    track.appendChild(el); slideEls.push(el);
  });
  return SLIDES.length;
}

// ---------- 啟動 / 停止 ----------
let stopCurrent = null, current = -1;
export function activateSlide(i) {
  if (i === current) return;
  if (stopCurrent) { stopCurrent(); stopCurrent = null; }
  slideEls.forEach((el, k) => el.classList.toggle('on', k === i));
  current = i;
  const el = slideEls[i]; const key = SLIDES[i].key;
  const host = el.querySelector('.wgin') || el.querySelector('.hero');
  if (host && WIDGETS[key]) { host.innerHTML = key === 'hero' ? host.innerHTML : ''; stopCurrent = WIDGETS[key](host, el) || null; }
}
export function deactivate() { if (stopCurrent) { stopCurrent(); stopCurrent = null; } slideEls.forEach((el) => el.classList.remove('on')); current = -1; }
// 捲動版(story.mjs)用:把某一頁的 widget 單獨掛到 host(手機螢幕)上,回傳停止函式
export function mountWidget(key, host) {
  host.innerHTML = '';
  if (key === 'hero') {
    const sl = SLIDES[0];
    host.innerHTML = `<div class="hero"><canvas class="bgc"></canvas><div class="chips"></div>
      <div class="icon img"><img src="/assets/icon-180.png" alt="CatInsight Stock"></div><h2>${sl.title}</h2><p>${sl.text}</p></div>`;
    return WIDGETS.hero(host.querySelector('.hero')) || (() => {});
  }
  return (WIDGETS[key] && WIDGETS[key](host)) || (() => {});
}

// ---------- 各頁 widget ----------
const WIDGETS = {};

// 1) 開場:背景慢慢流動的股價線 + 漂浮的股票標籤
WIDGETS.hero = (host) => {
  const c = host.querySelector('.bgc'); const chips = host.querySelector('.chips'); chips.innerHTML = '';
  const data = [['NVDA', 2.14], ['2330.TW', 1.32], ['TSLA', -0.86], ['AAPL', 0.57], ['2454.TW', 3.05], ['AMD', -1.21], ['MSFT', 0.92], ['PLTR', 4.40]];
  data.forEach(([t, p], i) => { const ch = h('span', `chip ${p >= 0 ? 'up' : 'dn'}`, `${t} <b>${pct(p)}</b>`); ch.style.left = `${6 + (i % 4) * 24 + (i > 3 ? 8 : 0)}%`; ch.style.top = `${i < 4 ? 10 + i * 5 : 68 + (i - 4) * 6}%`; ch.style.animationDelay = `${-i * 1.3}s`; ch.style.animationDuration = `${7 + (i % 3) * 1.5}s`; chips.appendChild(ch); });
  let series = walk(7, 160, 230, 0.03, 0.0008);
  const stopT = every(90, () => { series.push(Math.max(50, series[series.length - 1] * (1 + (Math.random() - 0.49) * 0.03))); series.shift(); });
  const stopR = loopRAF(() => { const [g, w, hh] = fitCanvas(c); g.clearRect(0, 0, w, hh); drawLine(g, series, -4, hh * 0.35, w + 8, hh * 0.55, '#4be07a', { width: 2 }); });
  return () => { stopT(); stopR(); };
};

// 2) Daily AI Picks:排行卡,每幾秒重新計分並換榜
WIDGETS.picks = (host) => {
  const rows = [
    { t: 'NVDA', n: 'NVIDIA', s: 91 }, { t: '2330.TW', n: 'TSMC', s: 86 }, { t: 'PLTR', n: 'Palantir', s: 78 },
    { t: 'AMD', n: 'Advanced Micro', s: 64 }, { t: 'TSLA', n: 'Tesla', s: 41 },
  ];
  const card = h('div', 'card picks', `<div class="ch"><span>Today's AI Picks</span><span class="muted">${new Date().toISOString().slice(0, 10)}</span></div><div class="list"></div><div class="foot muted">Re-scored daily · demo data</div>`);
  host.appendChild(card); const list = card.querySelector('.list');
  const els = rows.map((r) => { const e = h('div', 'row', `<span class="rk"></span><span class="tk">${r.t}<small>${r.n}</small></span><span class="bar"><i></i></span><span class="sc"></span><span class="bd"></span>`); list.appendChild(e); r.el = e; return e; });
  const render = () => {
    const sorted = [...rows].sort((a, b) => b.s - a.s);
    const step = list.clientHeight / rows.length;                 // 依卡片高度算列距(手機較矮)
    sorted.forEach((r, i) => { r.el.style.transform = `translateY(${i * step}px)`; r.el.querySelector('.rk').textContent = i + 1; r.el.querySelector('.bar i').style.width = `${r.s}%`; r.el.querySelector('.sc').textContent = r.s; const bd = r.el.querySelector('.bd'); const sig = r.s >= 70 ? 'BUY' : r.s >= 50 ? 'HOLD' : 'SELL'; bd.textContent = sig; bd.className = `bd ${sig.toLowerCase()}`; });
  };
  rows.forEach((r) => { r.el.style.transform = 'translateY(0)'; r.el.querySelector('.bar i').style.width = '0%'; });
  const s1 = later(80, render);
  const stop = every(2800, () => { rows.forEach((r) => { r.s = Math.max(20, Math.min(98, Math.round(r.s + (Math.random() - 0.5) * 18))); }); render(); });
  return () => { s1(); stop(); };
};

// 3) Pro Charts:可切換期間、滑鼠十字線
WIDGETS.chart = (host) => {
  const periods = ['1D', '1W', '1M', '3M', 'YTD', '1Y'];
  const data = { '1D': walk(11, 78, 258, 0.006), '1W': walk(12, 5 * 13, 250, 0.01), '1M': walk(13, 22, 240, 0.03), '3M': walk(14, 64, 210, 0.03, 0.002), 'YTD': walk(15, 180, 140, 0.03, 0.003), '1Y': walk(16, 250, 120, 0.03, 0.003) };
  const card = h('div', 'card chart', `<div class="ch"><div><b>NVDA</b><small>NVIDIA Corporation</small></div><div class="px"><b class="last"></b><small class="chg"></small></div></div><canvas></canvas><div class="tabs">${periods.map((p) => `<span data-p="${p}">${p}</span>`).join('')}</div>`);
  host.appendChild(card);
  const c = card.querySelector('canvas'), tabs = [...card.querySelectorAll('.tabs span')], last = card.querySelector('.last'), chg = card.querySelector('.chg');
  let cur = '1M', hover = null, userTouched = false;
  const setP = (p) => { cur = p; tabs.forEach((t) => t.classList.toggle('on', t.dataset.p === p)); };
  tabs.forEach((t) => t.onclick = () => { userTouched = true; setP(t.dataset.p); });
  c.addEventListener('pointermove', (e) => { const r = c.getBoundingClientRect(); hover = (e.clientX - r.left) / r.width; userTouched = true; });
  c.addEventListener('pointerleave', () => { hover = null; });
  const stopCycle = every(2600, () => { if (!userTouched) setP(periods[(periods.indexOf(cur) + 1) % periods.length]); });
  setP(cur);
  const stopR = loopRAF(() => {
    const s = data[cur]; const [g, w, hh] = fitCanvas(c); g.clearRect(0, 0, w, hh);
    const up = s[s.length - 1] >= s[0]; const col = up ? '#4be07a' : '#ff5c6a';
    g.strokeStyle = 'rgba(255,255,255,.07)'; g.lineWidth = 1; for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(0, hh * k / 4); g.lineTo(w, hh * k / 4); g.stroke(); }
    const { X, Y } = drawLine(g, s, 0, 8, w, hh - 16, col);
    let idx = s.length - 1;
    if (hover != null) { idx = Math.max(0, Math.min(s.length - 1, Math.round(hover * (s.length - 1)))); const x = X(idx), y = Y(s[idx]); g.setLineDash([4, 4]); g.strokeStyle = 'rgba(255,255,255,.45)'; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, hh); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); g.setLineDash([]); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.globalAlpha = .35; g.fill(); g.globalAlpha = 1;
      const lbl = `$${fmt(s[idx])}`; g.font = '600 12px -apple-system, Helvetica, sans-serif'; const tw = g.measureText(lbl).width + 12; const lx = Math.min(w - tw, Math.max(0, x - tw / 2)); g.fillStyle = 'rgba(255,255,255,.92)'; g.beginPath(); g.roundRect(lx, Math.max(0, y - 30), tw, 20, 6); g.fill(); g.fillStyle = '#0b0e17'; g.fillText(lbl, lx + 6, Math.max(0, y - 30) + 14); }
    else { const x = X(idx), y = Y(s[idx]); g.fillStyle = col; g.beginPath(); g.arc(x, y, 4, 0, Math.PI * 2); g.fill(); }
    const v = s[idx], d = (v / s[0] - 1) * 100; last.textContent = `$${fmt(v)}`; chg.textContent = `${d >= 0 ? '+' : ''}${(v - s[0]).toFixed(2)} (${pct(d)})`; chg.className = `chg ${d >= 0 ? 'up' : 'dn'}`;
  });
  return () => { stopCycle(); stopR(); };
};

// 4) Top Gainers:排行榜,百分比數字跑上去,分頁可切換
WIDGETS.gainers = (host) => {
  const sets = {
    '1D': [['PLTR', 'Palantir', 9.8], ['2454.TW', 'MediaTek', 6.4], ['AMD', 'Advanced Micro', 5.1], ['NVDA', 'NVIDIA', 4.6], ['2317.TW', 'Hon Hai', 3.9]],
    '1Y': [['NVDA', 'NVIDIA', 186.2], ['PLTR', 'Palantir', 142.7], ['2330.TW', 'TSMC', 78.4], ['2454.TW', 'MediaTek', 64.9], ['AVGO', 'Broadcom', 58.3]],
    'YTD': [['PLTR', 'Palantir', 96.1], ['NVDA', 'NVIDIA', 71.5], ['2330.TW', 'TSMC', 44.2], ['AMD', 'Advanced Micro', 39.7], ['MSFT', 'Microsoft', 21.3]],
  };
  const keys = Object.keys(sets);
  const card = h('div', 'card gainers', `<div class="ch"><span>Top Gainers</span><span class="tabs">${keys.map((k) => `<span data-p="${k}">${k}</span>`).join('')}</span></div><div class="list"></div>`);
  host.appendChild(card); const list = card.querySelector('.list'); const tabs = [...card.querySelectorAll('.tabs span')];
  let cur = '1D', touched = false, stopAnim = null;
  const show = (k) => {
    cur = k; tabs.forEach((t) => t.classList.toggle('on', t.dataset.p === k)); list.innerHTML = '';
    const rows = sets[k]; const max = rows[0][2];
    const els = rows.map(([t, n, p], i) => { const e = h('div', 'row', `<span class="rk">${i + 1}</span><span class="tk">${t}<small>${n}</small></span><span class="bar"><i></i></span><span class="pc up">+0.0%</span>`); e.style.animationDelay = `${i * 70}ms`; list.appendChild(e); return e; });
    if (stopAnim) stopAnim();
    stopAnim = loopRAF((t) => { const k2 = Math.min(1, t / 0.9); const e = 1 - Math.pow(1 - k2, 3); els.forEach((el, i) => { const p = rows[i][2] * e; el.querySelector('.pc').textContent = `+${p.toFixed(1)}%`; el.querySelector('.bar i').style.width = `${p / max * 100}%`; }); });
  };
  tabs.forEach((t) => t.onclick = () => { touched = true; show(t.dataset.p); });
  show(cur);
  const stopCycle = every(3200, () => { if (!touched) show(keys[(keys.indexOf(cur) + 1) % keys.length]); });
  return () => { stopCycle(); if (stopAnim) stopAnim(); };
};

// 5) AI 讀新聞:三句摘要打字機 + 偏多 / 偏空標籤
WIDGETS.news = (host) => {
  const items = [
    { src: 'Reuters', ago: '12m', head: 'NVIDIA lifts data-center outlook as hyperscalers boost AI spending', sum: 'NVIDIA raised its full-year data-center forecast after three cloud providers expanded orders. Margins held above 70% despite supply constraints. Analysts see the guidance as a strong signal for the next two quarters.', call: 'Bullish' },
    { src: 'Bloomberg', ago: '41m', head: 'TSMC flags softer smartphone demand in the second half', sum: 'TSMC said mobile chip orders are tracking below plan for the second half. AI accelerator demand remains strong and is expected to offset most of the gap. Management kept its capex plan unchanged.', call: 'Neutral' },
    { src: 'CNBC', ago: '1h', head: 'Tesla cuts prices again in China as competition intensifies', sum: 'Tesla lowered Model Y prices in China for the third time this year. Local rivals continue to gain share with cheaper models. Investors worry the cuts will pressure automotive margins.', call: 'Bearish' },
  ];
  const card = h('div', 'card news', `<div class="ch"><span class="src"></span><span class="muted ago"></span></div><div class="head"></div><div class="ai"><span class="dot"></span>AI summary</div><p class="sum"></p><span class="call"></span>`);
  host.appendChild(card);
  const src = card.querySelector('.src'), ago = card.querySelector('.ago'), head = card.querySelector('.head'), sum = card.querySelector('.sum'), call = card.querySelector('.call');
  let i = 0, alive = true, timers = [];
  const run = () => {
    if (!alive) return; const it = items[i % items.length]; i++;
    src.textContent = it.src; ago.textContent = `${it.ago} ago`; head.textContent = it.head; sum.textContent = ''; call.className = 'call'; call.textContent = '';
    let k = 0; const type = () => { if (!alive) return; if (k <= it.sum.length) { sum.textContent = it.sum.slice(0, k); k += 2; timers.push(later(16, type)); } else { call.textContent = it.call; call.className = `call on ${it.call.toLowerCase()}`; timers.push(later(2600, run)); } };
    timers.push(later(350, type));
  };
  run();
  return () => { alive = false; timers.forEach((s) => s()); };
};

// 6) 語音對話:Spotify DJ 風格三圈光球(呼吸 / 說話時內凹)+ 對話泡泡
WIDGETS.voice = (host) => {
  const wrap = h('div', 'voice', `<canvas class="orb"></canvas><div class="bubbles"></div><div class="state muted"></div>`);
  host.appendChild(wrap);
  const c = wrap.querySelector('.orb'), bubbles = wrap.querySelector('.bubbles'), state = wrap.querySelector('.state');
  const script = [
    { who: 'you', text: 'NVDA 最近怎麼樣?' },
    { who: 'ai', text: 'NVIDIA is up about 8% this month on strong data-center demand. Analysts stay bullish, with earnings due in two weeks.' },
    { who: 'you', text: '幫我設到價提醒,260 塊。' },
    { who: 'ai', text: 'Done. I\'ll notify you the moment NVDA hits $260.' },
  ];
  let speaking = 0, alive = true, timers = [], idx = 0;
  const say = () => {
    if (!alive) return; const line = script[idx % script.length]; idx++;
    if (bubbles.children.length >= 3) bubbles.firstChild.remove();
    const b = h('div', `bub ${line.who}`, ''); bubbles.appendChild(b);
    if (line.who === 'you') { b.textContent = line.text; state.textContent = 'Listening…'; speaking = 0; timers.push(later(1400, say)); }
    else { state.textContent = 'Speaking…'; let k = 0; const type = () => { if (!alive) return; if (k <= line.text.length) { b.textContent = line.text.slice(0, k); k += 1; speaking = 1; timers.push(later(28, type)); } else { speaking = 0; state.textContent = 'Listening…'; timers.push(later(1800, say)); } }; timers.push(later(300, type)); }
  };
  say();
  // 科技感能量球:藍紫粉漸層的半透明球體、內部流動的光線、外圈細環、光暈;說話時內部波動加大、球體微微脈動
  const stopR = loopRAF((t) => {
    const [g, w, hh] = fitCanvas(c); g.clearRect(0, 0, w, hh); const cx = w / 2, cy = hh / 2;
    const env = speaking ? 0.6 + 0.4 * Math.abs(Math.sin(t * 9) * Math.sin(t * 2.3)) : 0.12 + 0.08 * Math.sin(t * 1.6);
    const r = Math.min(w, hh) * 0.27 * (1 + 0.03 * Math.sin(t * 1.6) + env * 0.04);
    let gr;
    // 光暈
    gr = g.createRadialGradient(cx, cy, r * 0.7, cx, cy, r * 2.2); gr.addColorStop(0, 'rgba(90,130,255,.38)'); gr.addColorStop(0.5, 'rgba(120,80,255,.12)'); gr.addColorStop(1, 'rgba(90,130,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, hh);
    // 外圈:像電流一樣 — 帶抖動的鋸齒環線、發光,加上一段亮點沿著環繞行(每圈方向、速度不同),偶爾閃一下
    g.save(); g.globalCompositeOperation = 'lighter'; g.lineCap = 'round';
    // 三圈同方向、同速度(2.5 秒一圈)平穩繞 360°,三道電流錯開 120° 各在不同位置(和 App 一致)
    const rings = [[1.3, .55, 2.5, 'rgba(120,200,255,', 0], [1.52, .38, 2.5, 'rgba(180,140,255,', 2 * Math.PI / 3], [1.75, .25, 2.5, 'rgba(255,140,240,', 4 * Math.PI / 3]];
    const spark = speaking ? 1 : 0;                         // 講話時外圈才有電流通過(固定亮度、固定速度,不閃跳;和 App 一致)
    for (const [k, a, spd, col, off] of rings) {
      const rr = r * k, flick = speaking ? 1 : 0.6;
      // 主環:半徑加上高頻小抖動(電流的毛邊)
      g.beginPath();
      for (let i = 0; i <= 140; i++) {
        const ang = i / 140 * Math.PI * 2;
        const jit = Math.sin(ang * 9 + t * 2.0 + off) * r * 0.008 * spark;   // 很輕、很慢的起伏,不抖
        const x = cx + Math.cos(ang) * (rr + jit), y = cy + Math.sin(ang) * (rr + jit) * 0.92;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      }
      g.closePath(); g.strokeStyle = col + (a * flick * (speaking ? 0.6 : 0.35)) + ')'; g.lineWidth = 1; g.shadowColor = col + '0.9)'; g.shadowBlur = speaking ? 8 : 2; g.stroke();
      if (!spark) continue;                                  // 沒講話:只有安靜的細環
      // 繞行的電流亮段(頭亮尾淡,分三小段畫出漸層),越大聲跑越快
      const head = t * spd + off;                           // 固定速度繞行
      for (let sgm = 0; sgm < 4; sgm++) {                    // 拖尾約 90°,頭亮尾淡
        const a0 = head - (sgm + 1) * 0.4, a1 = head - sgm * 0.4;
        g.beginPath();
        for (let i = 0; i <= 12; i++) {
          const ang = a0 + (a1 - a0) * i / 12;
          const jit = Math.sin(ang * 9 + t * 2.0 + off) * r * 0.008;
          const x = cx + Math.cos(ang) * (rr + jit), y = cy + Math.sin(ang) * (rr + jit) * 0.92;
          i ? g.lineTo(x, y) : g.moveTo(x, y);
        }
        g.strokeStyle = col + ((a + 0.35) * flick * (1 - sgm * 0.24)) + ')'; g.lineWidth = 2.6 - sgm * 0.5; g.shadowColor = col + '1)'; g.shadowBlur = 16; g.stroke();
      }
      // 亮點
      const hx = cx + Math.cos(head) * rr, hy = cy + Math.sin(head) * rr * 0.92;
      g.fillStyle = 'rgba(255,255,255,' + (0.85 * flick) + ')'; g.shadowColor = col + '1)'; g.shadowBlur = 18; g.beginPath(); g.arc(hx, hy, 2.2, 0, Math.PI * 2); g.fill();
    }
    g.restore();
    // 球體
    gr = g.createRadialGradient(cx - r * 0.25, cy - r * 0.25, r * 0.05, cx, cy, r);
    gr.addColorStop(0, 'rgba(70,90,230,.55)'); gr.addColorStop(0.55, 'rgba(110,60,210,.75)'); gr.addColorStop(0.9, 'rgba(200,90,230,.85)'); gr.addColorStop(1, 'rgba(255,120,235,.95)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
    // 內部流動光線(裁在球內、加亮混合)
    g.save(); g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.clip(); g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const ph = t * (0.9 + i * 0.18) + i * 1.3;
      const amp = r * (0.22 + 0.4 * env) * (0.6 + 0.4 * Math.sin(i * 1.7 + t * 0.5));
      const col = i % 2 ? 'rgba(255,130,245,' : 'rgba(120,210,255,';
      g.strokeStyle = col + '0.5)'; g.lineWidth = 1.2 + (i % 3) * 0.8; g.shadowColor = col + '0.95)'; g.shadowBlur = 16;
      g.beginPath();
      for (let x = -r; x <= r + 1; x += 5) {
        const u = x / r;
        const y = Math.sin(u * 2.4 + ph) * amp * Math.cos(u * 0.8) + Math.sin(u * 5 + ph * 1.6) * amp * 0.25 + Math.sin(ph * 0.35 + i) * r * 0.28 * ((i - 2.5) / 2.5);
        x === -r ? g.moveTo(cx + x, cy + y) : g.lineTo(cx + x, cy + y);
      }
      g.stroke();
    }
    g.restore();
    // 邊緣光(青 → 粉)
    g.save(); g.globalCompositeOperation = 'lighter';
    const rim = g.createLinearGradient(cx - r, cy - r, cx + r, cy + r); rim.addColorStop(0, 'rgba(120,225,255,.95)'); rim.addColorStop(0.5, 'rgba(150,120,255,.3)'); rim.addColorStop(1, 'rgba(255,140,240,.95)');
    g.strokeStyle = rim; g.lineWidth = 2.2; g.shadowColor = 'rgba(150,170,255,.9)'; g.shadowBlur = 18; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.stroke(); g.restore();
    // 左上高光
    gr = g.createRadialGradient(cx - r * 0.35, cy - r * 0.4, 0, cx - r * 0.35, cy - r * 0.4, r * 0.7); gr.addColorStop(0, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
  });
  return () => { alive = false; timers.forEach((s) => s()); stopR(); };
};

// 7) 推播提醒:iPhone 通知橫幅一則一則滑進來
WIDGETS.alerts = (host) => {
  const phone = h('div', 'phone', `<div class="status"><span>9:41</span><span>●●●</span></div><div class="stack"></div>`);
  host.appendChild(phone); const stack = phone.querySelector('.stack');
  const list = [
    ['🎯', 'Price target hit', 'NVDA just crossed $260.00 (+2.1% today).'],
    ['📅', 'Earnings tomorrow', 'AAPL reports after the close. Consensus EPS $1.62.'],
    ['✨', 'AI picks updated', 'PLTR moved up to #1. TSLA dropped out of the top 5.'],
    ['📰', 'News digest ready', 'TSMC: softer phone demand, AI still strong · Neutral'],
    ['🔔', 'Price alert', '2330.TW reached NT$1,050 — your target.'],
  ];
  let i = 0, alive = true, timers = [];
  const push = () => {
    if (!alive) return; const [ic, t, m] = list[i % list.length]; i++;
    const n = h('div', 'notif', `<span class="ic">${ic}</span><div><b>CatInsight Stock</b><div class="t">${t}</div><div class="m">${m}</div></div><span class="time">now</span>`);
    stack.prepend(n); requestAnimationFrame(() => n.classList.add('in'));
    while (stack.children.length > 3) { const old = stack.lastChild; old.classList.add('out'); timers.push(later(400, () => old.remove())); if (stack.children.length <= 4) break; }
    timers.push(later(1700, push));
  };
  push();
  return () => { alive = false; timers.forEach((s) => s()); };
};

// 8) 下載:App icon + QR code(掃了直接到 App Store)
WIDGETS.app = (host) => {
  const box = h('div', 'dl', `<div class="qr"><canvas></canvas><div class="muted">Scan to download</div></div>`);   // 只放一個大 QR code
  host.appendChild(box);
  const c = box.querySelector('canvas');
  try {                                                             // qrcode-generator(index.html 用 <script> 載入,全域 qrcode)
    const qr = window.qrcode(0, 'M'); qr.addData(APP_STORE); qr.make();
    const n = qr.getModuleCount(), size = Math.min(300, Math.max(180, Math.round(innerWidth * 0.2))), cell = size / (n + 2);
    const dpr = Math.min(devicePixelRatio || 1, 2); c.width = size * dpr; c.height = size * dpr; c.style.width = c.style.height = `${size}px`;
    const g = c.getContext('2d'); g.scale(dpr, dpr); g.fillStyle = '#fff';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col)) g.fillRect((col + 1) * cell, (r + 1) * cell, cell + 0.4, cell + 0.4);
  } catch (e) { box.querySelector('.qr').style.display = 'none'; }
  return null;
};
