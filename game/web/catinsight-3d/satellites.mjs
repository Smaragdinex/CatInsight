// 地球那頁的「衛星」版(網址加 ?sat 才用):功能不是一圈大卡片,而是三層軌道上的小發光衛星;
// 選到哪顆,那顆就脫離軌道飛到前面、「變成」一張玻璃卡;換下一個 = 卡片縮回衛星、回到軌道,另一顆再飛出來。
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
  const N = slides.length;
  // 三層軌道:內圈 AI Picks / Charts / Movers、中圈 News / Voice / Alerts、外圈 Welcome
  const LAYER_OF = { picks: 0, chart: 0, gainers: 0, news: 1, voice: 1, alerts: 1, hero: 2 };
  const LAYERS = [
    { r: ER * 1.55, tiltX: 0.20, tiltZ: 0.10, speed: 0.07 },
    { r: ER * 2.0, tiltX: -0.10, tiltZ: -0.17, speed: -0.05 },
    { r: ER * 2.45, tiltX: 0.06, tiltZ: 0.22, speed: 0.035 },
  ];
  LAYERS.forEach((L) => { L.q = new THREE.Quaternion().setFromEuler(new THREE.Euler(L.tiltX, 0, L.tiltZ)); });
  // 軌道線(很淡;滑鼠移到那一層的衛星上時亮起來)。renderOrder 3:地球先畫 → 軌道線在地球後面那段會被擋住
  const lines = LAYERS.map((L) => {
    const pts = []; for (let i = 0; i <= 160; i++) { const a = i / 160 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * L.r, Math.sin(a * 2) * 18, Math.sin(a) * L.r)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    line.quaternion.copy(L.q); line.position.copy(center); line.renderOrder = 3; scene.add(line); return line;
  });
  const counts = [0, 0, 0], idx = slides.map((s) => { const l = LAYER_OF[s.key] ?? 1; return counts[l]++; });
  const sats = slides.map((s, i) => {
    const layer = LAYER_OF[s.key] ?? 1, color = s.key === 'hero' ? '#ffffff' : s.color;
    const mat = new THREE.SpriteMaterial({ map: glyphTexture(THREE, s.key, color), transparent: true, depthWrite: false, depthTest: true, opacity: 0 });
    const sp = new THREE.Sprite(mat); sp.renderOrder = 3; scene.add(sp);
    const a0 = (idx[i] / counts[layer]) * Math.PI * 2 + layer * 1.05 + (layer === 2 ? Math.PI * 0.5 : 0);
    return { i, key: s.key, layer, a0, sp, fly: 0, hover: 0, scr: { x: -999, y: -999, vis: 0 } };
  });
  // 名稱標籤(滑鼠移到衛星上才浮出)
  const label = document.createElement('div'); label.className = 'satlabel'; label.innerHTML = '<i></i><span></span>'; labelHost.appendChild(label);
  const labelText = label.querySelector('span');

  let want = -1, shown = -1, cardT = 0, hovered = -1, arriveT = 0, touched = false;
  let L = { cx: 0, cy: 0, rw: 1, rh: 1, cardX: 0, cardY: 0, cardS: 1, W: 1, H: 1 };
  const v = new THREE.Vector3(), v2 = new THREE.Vector3(), v3 = new THREE.Vector3(), camDir = new THREE.Vector3(), focus = new THREE.Vector3(), ctrl = new THREE.Vector3();
  const orbitPos = (s, t, out) => { const Lr = LAYERS[s.layer], a = s.a0 + t * Lr.speed;
    return out.set(Math.cos(a) * Lr.r, Math.sin(a * 2) * 18, Math.sin(a) * Lr.r).applyQuaternion(Lr.q).add(center); };
  const toScreen = (p, cam, out) => { v3.copy(p).project(cam); out.x = (v3.x + 1) / 2 * L.W; out.y = (1 - v3.y) / 2 * L.H; out.z = v3.z; return out; };

  // 版面:桌機 = 地球在左邊、卡片在右邊;手機 = 地球在上面、卡片在下面(都避開上 / 下的按鈕列)
  function layout(W, H, reserve, portrait) {
    const PW = 540, PH = 720;
    if (portrait) {
      const top = reserve.top, split = top + Math.max(170, H * 0.27), bot = H - Math.max(14, reserve.bot - 10);
      const cardS = Math.min((W * 0.94) / PW, (bot - split) / PH), cw = PW * cardS;
      L = { W, H, portrait, cx: W / 2, cy: (top + split) / 2, rw: W * 0.96, rh: split - top, cardS, cardX: (W - cw) / 2, cardY: split };
    } else {
      const margin = Math.max(28, W * 0.05), availH = H - reserve.top - reserve.bot - 8;
      const cardS = Math.min(Math.min(540, Math.max(420, W * 0.36)) / PW, availH / PH), cw = PW * cardS, ch = PH * cardS;
      const cardX = W - margin - cw, cardY = reserve.top + (availH - ch) / 2;
      L = { W, H, portrait, cx: cardX / 2 + 10, cy: reserve.top + availH / 2, rw: cardX - 20, rh: availH, cardS, cardX, cardY };
    }
  }
  // 鏡頭:要退多遠(整個外圈軌道放得進地球那一區)、畫面要偏移多少(地球不在正中間)
  function fit(tanH) {
    const rO = LAYERS[2].r;
    const dW = rO * 1.12 * L.H / (tanH * L.rw), dH = Math.max(ER * 1.2, rO * 0.6) * L.H / (tanH * L.rh);
    return { dist: Math.max(dW, dH), offX: L.W / 2 - L.cx, offY: L.H / 2 - L.cy };
  }

  function update(t, dt, cam, rv, atEarth) {
    // 剛到地球:畫面先乾淨一下(只有地球和衛星),0.6 秒後自動打開第一顆(WELCOME)
    if (rv > 0.95 && atEarth) { arriveT += dt; if (want < 0 && !touched && arriveT > 0.6) want = 0; }
    else { arriveT = 0; if (rv < 0.9) { want = -1; touched = false; } }
    // 換卡片:先把目前的卡縮回衛星,再換成想要的那顆(滑很快時中間的直接跳過)
    if (shown !== want) {
      if (shown >= 0 && cardT > 0) cardT = Math.max(0, cardT - dt / 0.32);
      else { shown = want; cardT = 0; onShow(shown); panels.forEach((pp, k) => { pp.el.style.display = k === shown ? '' : 'none'; }); }
    }
    cam.getWorldDirection(camDir);
    // 卡片的左上角附近 = 衛星飛過去的位置(在鏡頭前、比地球近一點)
    const camDist = cam.position.distanceTo(center);
    v.set((L.cardX + 30) / L.W * 2 - 1, -((L.cardY + 30) / L.H * 2 - 1), 0.5).unproject(cam).sub(cam.position).normalize();
    focus.copy(cam.position).addScaledVector(v, camDist * 0.72);
    const base = ER * 0.42;
    for (const s of sats) {
      const isShown = s.i === shown && shown >= 0;
      const goal = isShown && shown === want ? 1 : 0;
      s.fly += (goal - s.fly) * Math.min(1, dt * (goal ? 3.2 : 2.6)); if (Math.abs(goal - s.fly) < 0.002) s.fly = goal;
      orbitPos(s, t, v2);
      // 正面 1、側面 0.7~0.8、到地球後面淡出(地球本身也會擋住它)
      const f = v.copy(v2).sub(center).normalize().dot(camDir) * -1;
      let op = f > 0 ? 0.7 + 0.3 * f : Math.max(0, 0.7 + f * 1.6), sc = 0.55 + 0.45 * ss(-1, 1, f);
      const u = ease(s.fly);
      if (u > 0) {   // 脫離軌道:往外、往鏡頭彎出去,再飛到卡片的位置
        ctrl.copy(v2).add(focus).multiplyScalar(0.5).addScaledVector(v.copy(v2).sub(center).normalize(), ER * 0.7);
        v2.multiplyScalar((1 - u) * (1 - u)).addScaledVector(ctrl, 2 * (1 - u) * u).addScaledVector(focus, u * u);
        op = op + (1 - op) * u; sc = sc + (1.5 - sc) * u;
      }
      s.hover += ((hovered === s.i ? 1 : 0) - s.hover) * Math.min(1, dt * 10);
      sc *= 1 + 0.18 * s.hover;
      if (isShown) op *= 1 - ss(0.45, 0.9, cardT);                                              // 卡片展開後衛星藏在卡片底下
      s.sp.position.copy(v2); s.sp.scale.setScalar(base * sc); s.sp.material.opacity = op * rv;
      toScreen(v2, cam, s.scr); s.scr.vis = op * rv; s.scr.r = base * sc * L.H / (2 * Math.tan(cam.fov * Math.PI / 360) * cam.position.distanceTo(v2)) * 0.5;
    }
    lines.forEach((ln, k) => { const hl = hovered >= 0 && sats[hovered].layer === k ? 1 : 0; ln.userData.h = (ln.userData.h || 0) + (hl - (ln.userData.h || 0)) * Math.min(1, dt * 8);
      ln.material.opacity = (0.2 + 0.35 * ln.userData.h) * rv; });
    // 衛星飛到位以後,卡片從衛星的位置展開
    if (shown >= 0 && shown === want && sats[shown].fly > 0.82) cardT = Math.min(1, cardT + dt / 0.42);
    const e = ease(cardT);
    if (shown >= 0 && e > 0.001) {
      const s = sats[shown], PW = 540, PH = 720, fx = L.cardX + PW * L.cardS / 2, fy = L.cardY + PH * L.cardS / 2;
      const cx = s.scr.x + (fx - s.scr.x) * e, cy = s.scr.y + (fy - s.scr.y) * e, sc = L.cardS * (0.08 + 0.92 * e);
      deck.style.transform = `translate(${(cx - PW * sc / 2).toFixed(1)}px, ${(cy - PH * sc / 2).toFixed(1)}px) scale(${sc.toFixed(4)})`;
      deck.style.opacity = (ss(0, 0.35, cardT) * rv).toFixed(3); deck.style.visibility = 'visible'; deck.style.pointerEvents = cardT > 0.9 && rv > 0.95 ? 'auto' : 'none';
    } else { deck.style.visibility = 'hidden'; deck.style.pointerEvents = 'none'; }
    // 名稱標籤
    if (hovered >= 0 && sats[hovered].scr.vis > 0.3 && !(hovered === shown && cardT > 0.3)) {
      const s = sats[hovered]; labelText.textContent = (slides[hovered].eyebrow || 'WELCOME');
      label.style.setProperty('--c', s.key === 'hero' ? '#ffffff' : slides[hovered].color);
      label.style.transform = `translate(${s.scr.x.toFixed(1)}px, ${(s.scr.y + s.scr.r + 4).toFixed(1)}px)`; label.classList.add('on');
    } else label.classList.remove('on');
  }
  // 滑鼠 / 手指的位置上是哪一顆衛星(螢幕上的距離)
  function pick(x, y) {
    let best = -1, bd = 1e9;
    for (const s of sats) { if (s.scr.vis < 0.25 || (s.i === shown && cardT > 0.3)) continue; const d = Math.hypot(x - s.scr.x, y - s.scr.y); if (d < Math.max(22, s.scr.r * 1.2) && d < bd) { bd = d; best = s.i; } }
    return best;
  }
  return {
    layout, fit, update, pick,
    debug: () => sats.map((s) => [s.key, Math.round(s.scr.x), Math.round(s.scr.y), +s.scr.vis.toFixed(2)]),
    hover(i) { const ch = i !== hovered; hovered = i; return ch; },
    go(i) { touched = true; want = Math.max(0, Math.min(N - 1, i)); },
    step(dir) { touched = true; const cur = want < 0 ? 0 : want; const n = cur + dir; if (n < 0 || n >= N) return false; want = n; return true; },
    get want() { return want; }, get shown() { return shown; },
    reset() { want = -1; shown = -1; cardT = 0; hovered = -1; arriveT = 0; touched = false; sats.forEach((s) => { s.fly = 0; s.hover = 0; s.sp.material.opacity = 0; }); lines.forEach((l) => { l.material.opacity = 0; }); deck.style.visibility = 'hidden'; label.classList.remove('on'); },
  };
}
