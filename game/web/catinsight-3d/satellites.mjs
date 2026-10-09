// 地球那頁的「衛星」版(網址加 ?sat 才用):7 個功能是三層軌道上的小發光衛星,整組像轉盤一樣繞著地球轉;
// 轉到正前方的那顆,透明卡從它的位置放大(大到蓋住地球);轉走時卡片縮回衛星。沒人操作時自己慢慢轉到下一顆。
// orbit.mjs 負責鏡頭、滾輪 / 拖曳 / 點擊;這裡負責衛星、軌道線、卡片的位置和動畫。

const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
const ss = (a, b, x) => ease((x - a) / (b - a));

// 每個功能的衛星符號(白色線條),中間的光用功能色
function glyphTexture(THREE, key, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  gr.addColorStop(0, color + 'cc'); gr.addColorStop(0.35, color + '55'); gr.addColorStop(1, color + '00');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  g.beginPath(); g.arc(64, 64, 27, 0, Math.PI * 2); g.fillStyle = 'rgba(16,20,36,.72)'; g.fill();
  g.lineWidth = 3.5; g.strokeStyle = 'rgba(232,236,246,.95)'; g.stroke();                       // 銀色外框 = 衛星本體
  g.translate(64, 64); g.strokeStyle = '#fff'; g.fillStyle = '#fff'; g.lineWidth = 4; g.lineCap = 'round'; g.lineJoin = 'round';
  const P = (pts, close) => { g.beginPath(); pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (close) g.closePath(); };
  if (key === 'hero') { P([[-12, -2], [-11, -15], [-4, -8], [4, -8], [11, -15], [12, -2]]); g.stroke(); g.beginPath(); g.arc(0, 2, 12, 0.15, Math.PI - 0.15); g.stroke();
    g.beginPath(); g.arc(-5, 0, 1.8, 0, 7); g.arc(5, 0, 1.8, 0, 7); g.fill(); }
  else if (key === 'picks') { P([[0, -16], [4, -4], [16, 0], [4, 4], [0, 16], [-4, 4], [-16, 0], [-4, -4]], true); g.fill(); }
  else if (key === 'chart') { P([[-15, 9], [-6, -1], [1, 5], [15, -11]]); g.stroke(); }
  else if (key === 'gainers') { P([[0, 15], [0, -13]]); g.stroke(); P([[-9, -4], [0, -14], [9, -4]]); g.stroke(); }
  else if (key === 'news') { g.lineWidth = 3; g.strokeRect(-13, -12, 26, 24); P([[-8, -5], [8, -5]]); g.stroke(); P([[-8, 1], [8, 1]]); g.stroke(); P([[-8, 7], [3, 7]]); g.stroke(); }
  else if (key === 'voice') { g.lineWidth = 3.4; g.beginPath(); g.arc(-8, 0, 3, 0, 7); g.fill();
    [8, 15].forEach((r) => { g.beginPath(); g.arc(-8, 0, r, -0.8, 0.8); g.stroke(); }); }
  else if (key === 'alerts') { g.lineWidth = 3.4; g.beginPath(); g.moveTo(-11, 8); g.quadraticCurveTo(-9, 4, -9, -2); g.arc(0, -2, 9, Math.PI, 0); g.quadraticCurveTo(9, 4, 11, 8); g.closePath(); g.stroke();
    g.beginPath(); g.arc(0, 12, 2.6, 0, 7); g.fill(); }
  else { g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

export function createSatellites({ THREE, scene, center, ER, slides, deck, panels, labelHost, onShow }) {
  const N = slides.length, SP = Math.PI * 2 / N;                                               // SP:相鄰兩顆衛星在轉盤上的角度
  // 三層軌道(半徑、傾斜不同 → 有深度):內圈 AI Picks / Charts / Movers、中圈 News / Voice / Alerts、外圈 Welcome
  const LAYER_OF = { picks: 0, chart: 0, gainers: 0, news: 1, voice: 1, alerts: 1, hero: 2 };
  const LAYERS = [
    { r: ER * 1.55, tiltX: 0.20, tiltZ: 0.10 },
    { r: ER * 2.0, tiltX: -0.10, tiltZ: -0.15 },
    { r: ER * 2.4, tiltX: 0.06, tiltZ: 0.20 },
  ];
  LAYERS.forEach((L) => { L.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(L.tiltX, 0, L.tiltZ)); });
  // 軌道線(很淡;滑鼠移到那一層的衛星上時亮起來)。renderOrder 3:地球先畫 → 軌道線在地球後面那段會被擋住
  const lines = LAYERS.map((L) => {
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * L.r, Math.sin(a * 2) * 18, Math.sin(a) * L.r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.quaternion.copy(L.q); line.position.copy(center); line.renderOrder = 3; scene.add(line); return line;
  });
  const sats = slides.map((s, i) => {
    const layer = LAYER_OF[s.key] ?? 1, color = s.key === 'hero' ? '#ffffff' : s.color;
    const mat = new THREE.SpriteMaterial({ map: glyphTexture(THREE, s.key, color), transparent: true, depthWrite: false, depthTest: true, opacity: 0 });
    const sp = new THREE.Sprite(mat); sp.renderOrder = 3; scene.add(sp);
    return { i, key: s.key, layer, sp, hover: 0, scr: { x: -999, y: -999, z: 0, r: 0, vis: 0 } };
  });
  const label = document.createElement('div'); label.className = 'satlabel'; label.innerHTML = '<i></i><span></span>'; labelHost.appendChild(label);
  const labelText = label.querySelector('span');

  // rot:轉盤目前轉到哪(rot = i * SP → 第 i 顆在正前方);rotT:要轉到哪;dragging:手指 / 滑鼠正在轉
  let rot = 0, rotT = 0, dragging = false, dragRot = 0, idle = 0, dwell = 0, shown = -1, hovered = -1, cardE = 0;
  let L = { cx: 0, cy: 0, rw: 1, rh: 1, cardX: 0, cardY: 0, cardS: 1, W: 1, H: 1 };
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), camDir = new THREE.Vector3();
  const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));
  const posOf = (s, t, out) => { const Lr = LAYERS[s.layer], a = Math.PI / 2 + s.i * SP - rot;      // a = π/2:軌道上最靠近鏡頭的位置
    return out.set(Math.cos(a) * Lr.r, Math.sin(a * 2) * 18 + Math.sin(t * 0.9 + s.i) * 6, Math.sin(a) * Lr.r).applyQuaternion(Lr.q).add(center); };
  const toScreen = (p, cam, out) => { v3.copy(p).project(cam); out.x = (v3.x + 1) / 2 * L.W; out.y = (1 - v3.y) / 2 * L.H; out.z = v3.z; return out; };
  const touch = () => { idle = 0; dwell = 0; };

  // 版面:地球在中間;卡片也在中間、夠大,轉到正前方時蓋住地球(避開上 / 下的按鈕列)
  function layout(W, H, reserve, portrait) {
    const PW = 540, PH = 720, top = reserve.top, bot = H - reserve.bot, availH = bot - top - 8;
    const cardS = portrait ? Math.min((W * 0.94) / PW, availH / PH) : Math.min(Math.min(600, W * 0.46) / PW, availH / PH);
    const cw = PW * cardS, ch = PH * cardS;
    L = { W, H, portrait, cx: W / 2, cy: top + (bot - top) / 2, rw: W * (portrait ? 0.98 : 0.8), rh: bot - top, cardS, cardX: (W - cw) / 2, cardY: top + (bot - top - ch) / 2 };
  }
  // 鏡頭:退多遠(外圈軌道放得進畫面)、畫面要上下偏多少(對準按鈕列之間的中間)
  function fit(tanH) {
    const rO = LAYERS[2].r;
    const dW = rO * 1.1 * L.H / (tanH * L.rw), dH = Math.max(ER * 1.25, rO * 0.62) * L.H / (tanH * L.rh);
    return { dist: Math.max(dW, dH), offX: L.W / 2 - L.cx, offY: L.H / 2 - L.cy };
  }

  function update(t, dt, cam, rv, atEarth) {
    if (!(rv > 0.95 && atEarth)) { idle = 0; dwell = 0; }
    // 自己轉:沒人操作 6 秒後,每停 5 秒就轉到下一顆
    if (rv > 0.95 && atEarth && !dragging) { idle += dt; if (Math.abs(rotT - rot) < 0.01) dwell += dt; if (idle > 6 && dwell > 5) { rotT += SP; dwell = 0; } }
    if (!dragging) { rot += (rotT - rot) * Math.min(1, dt * 3.2); if (Math.abs(rotT - rot) < 1e-4) rot = rotT; }
    // 正前方是哪一顆、靠多近 → 卡片多大(正前方 = 全開,轉到兩顆中間 = 縮成 0,這時才換卡片內容,看不出來)
    const k = Math.round(rot / SP), cur = ((k % N) + N) % N, near = Math.abs(rot - k * SP) / SP;
    const e = rv > 0.05 ? 1 - ss(0.08, 0.46, near) : 0;
    // 卡片縮到看不見時才換內容
    if (cur !== shown && cardE < 0.05) { shown = cur; onShow(rv > 0.05 ? shown : -1); panels.forEach((pp, j) => { pp.el.style.display = j === shown ? '' : 'none'; }); }
    if (rv <= 0.05 && shown >= 0) { shown = -1; onShow(-1); }
    cardE += ((shown === cur ? e : 0) - cardE) * Math.min(1, dt * 12);
    cam.getWorldDirection(camDir);
    const base = ER * 0.42;
    for (const s of sats) {
      posOf(s, t, v2);
      const f = -v.copy(v2).sub(center).normalize().dot(camDir);                              // 1 = 正面、0 = 側面、-1 = 地球後面
      let op = f > 0 ? 0.7 + 0.3 * f : Math.max(0, 0.7 + f * 1.6), sc = 0.55 + 0.45 * ss(-1, 1, f);
      s.hover += ((hovered === s.i ? 1 : 0) - s.hover) * Math.min(1, dt * 10);
      sc *= 1 + 0.18 * s.hover;
      if (s.i === shown) { op *= 1 - ss(0.35, 0.8, cardE); sc *= 1 + 0.5 * cardE; }             // 卡片展開時,衛星藏進卡片裡
      s.sp.position.copy(v2); s.sp.scale.setScalar(base * sc); s.sp.material.opacity = op * rv;
      toScreen(v2, cam, s.scr); s.scr.vis = op * rv;
      s.scr.r = base * sc * L.H / (2 * Math.tan(cam.fov * Math.PI / 360) * cam.position.distanceTo(v2)) * 0.5;
    }
    lines.forEach((ln, j) => { const hl = hovered >= 0 && sats[hovered].layer === j ? 1 : 0; ln.userData.h = (ln.userData.h || 0) + (hl - (ln.userData.h || 0)) * Math.min(1, dt * 8);
      ln.material.opacity = (0.2 + 0.35 * ln.userData.h) * rv * (1 - 0.6 * cardE); });
    // 卡片:從正前方那顆衛星的位置放大到中間
    const ce = ease(cardE);
    if (shown >= 0 && ce > 0.002) {
      const s = sats[shown], PW = 540, PH = 720, fx = L.cardX + PW * L.cardS / 2, fy = L.cardY + PH * L.cardS / 2;
      const cx = s.scr.x + (fx - s.scr.x) * ce, cy = s.scr.y + (fy - s.scr.y) * ce, sc = L.cardS * (0.08 + 0.92 * ce);
      deck.style.transform = `translate(${(cx - PW * sc / 2).toFixed(1)}px, ${(cy - PH * sc / 2).toFixed(1)}px) scale(${sc.toFixed(4)})`;
      deck.style.opacity = (ss(0, 0.3, cardE) * rv).toFixed(3); deck.style.visibility = 'visible'; deck.style.pointerEvents = cardE > 0.85 && rv > 0.95 ? 'auto' : 'none';
    } else { deck.style.visibility = 'hidden'; deck.style.pointerEvents = 'none'; }
    if (hovered >= 0 && sats[hovered].scr.vis > 0.3 && !(hovered === shown && cardE > 0.3)) {
      const s = sats[hovered]; labelText.textContent = slides[hovered].eyebrow || 'WELCOME';
      label.style.setProperty('--c', s.key === 'hero' ? '#ffffff' : slides[hovered].color);
      label.style.transform = `translate(${s.scr.x.toFixed(1)}px, ${(s.scr.y + s.scr.r + 4).toFixed(1)}px)`; label.classList.add('on');
    } else label.classList.remove('on');
  }
  function pick(x, y) {
    let best = -1, bd = 1e9;
    for (const s of sats) { if (s.scr.vis < 0.25 || (s.i === shown && cardE > 0.3)) continue; const d = Math.hypot(x - s.scr.x, y - s.scr.y); if (d < Math.max(22, s.scr.r * 1.2) && d < bd) { bd = d; best = s.i; } }
    return best;
  }
  return {
    layout, fit, update, pick,
    debug: () => sats.map((s) => [s.key, Math.round(s.scr.x), Math.round(s.scr.y), +s.scr.vis.toFixed(2)]),
    hover(i) { const ch = i !== hovered; hovered = i; return ch; },
    // 轉到第 i 顆(走最短的方向)
    go(i) { touch(); const curA = Math.round(rotT / SP) * SP; rotT = curA + wrap(i * SP - curA); },
    step(dir) { touch(); rotT = Math.round(rotT / SP) * SP + dir * SP; return true; },
    // 拖曳:跟著手指 / 滑鼠轉;放開對齊最近的一顆
    dragStart() { touch(); dragging = true; dragRot = rot; },
    dragMove(px) { touch(); rot = dragRot - px * SP / 240; rotT = rot; },
    dragEnd() { touch(); dragging = false; rotT = Math.round(rot / SP) * SP; },
    get dragging() { return dragging; },
    get want() { return ((Math.round(rotT / SP) % N) + N) % N; }, get shown() { return shown; },
    reset() { rot = rotT = 0; dragging = false; idle = dwell = 0; shown = -1; hovered = -1; cardE = 0; sats.forEach((s) => { s.hover = 0; s.sp.material.opacity = 0; }); lines.forEach((l) => { l.material.opacity = 0; }); deck.style.visibility = 'hidden'; label.classList.remove('on'); },
  };
}
