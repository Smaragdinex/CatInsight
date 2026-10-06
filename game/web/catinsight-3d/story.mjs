// story.mjs — 捲動版功能介紹(網址加 ?story 才啟用):不是一頁一頁換的投影片,而是「往下捲 = 往前播」。
// 房間 → 鏡頭推到書桌、桌上的手機飛起來變主角、房間暗下來 → 手機在畫面中間轉來轉去,螢幕上跑的是 App 的各個功能
// (intro.mjs 的 widget,真的 HTML,可以互動)→ 最後一段是下載。
// 畫面分四層:WebGL 房間 + 手機本體(#c)→ 手機螢幕(CSS3D 的 HTML)→ 綠色股價緞帶(另一張透明 canvas,用手機當遮擋)→ 文字
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { SLIDES, mountWidget } from './intro.mjs?v=12';

const APP_STORE = 'https://apps.apple.com/app/id6763914049';
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const lerp = (a, b, k) => a + (b - a) * k;

export function initStory({ THREE, scene, camera, controls, renderer, canvas, desk, orbit, busy }) {
  const N = SLIDES.length;                         // 第 1 ~ N 段 = SLIDES[0 .. N-1];0 = 房間
  const D2R = Math.PI / 180;
  // ---------- 手機(單位和房間一樣) ----------
  const PW = 0.46, PH = 0.96, PD = 0.05, SW = 0.43, SH = 0.93, CSS_W = 390, CSS_H = 844;
  const phone = new THREE.Group(); scene.add(phone);
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0x23263a, metalness: 0.25, roughness: 0.38 });
  const add = (mesh, layers = [0, 1]) => { mesh.layers.set(layers[0]); layers.slice(1).forEach((l) => mesh.layers.enable(l)); phone.add(mesh); return mesh; };
  const body = add(new THREE.Mesh(new RoundedBoxGeometry(PW, PH, PD, 6, 0.06), bodyMat));
  body.castShadow = true;
  // 側邊按鍵、背面相機
  add(new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.16, 0.018, 2, 0.005), bodyMat)).position.set(PW / 2 + 0.003, 0.17, 0);
  for (const y of [0.25, 0.12]) add(new THREE.Mesh(new RoundedBoxGeometry(0.012, 0.08, 0.018, 2, 0.005), bodyMat)).position.set(-PW / 2 - 0.003, y, 0);
  const bump = add(new THREE.Mesh(new RoundedBoxGeometry(0.17, 0.17, 0.014, 3, 0.035), new THREE.MeshStandardMaterial({ color: 0x2c3046, metalness: 0.3, roughness: 0.3 })));
  bump.position.set(-0.115, 0.34, -PD / 2 - 0.006);
  const lensMat = new THREE.MeshStandardMaterial({ color: 0x0b0d16, metalness: 0.6, roughness: 0.15 });
  for (const [x, y] of [[-0.15, 0.375], [-0.15, 0.305], [-0.08, 0.34]]) { const l = add(new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 24), lensMat)); l.rotation.x = Math.PI / 2; l.position.set(x, y, -PD / 2 - 0.016); }
  // 螢幕底圖(遠看 / HTML 還沒出現時):深色漸層 + App 圖示
  const fc = document.createElement('canvas'); fc.width = 195; fc.height = 422;
  const fg = fc.getContext('2d'), fTex = new THREE.CanvasTexture(fc); fTex.colorSpace = THREE.SRGBColorSpace;
  const paintFallback = (img) => { const gr = fg.createLinearGradient(0, 0, 0, 422); gr.addColorStop(0, '#1d2547'); gr.addColorStop(0.6, '#0b0e17'); fg.fillStyle = gr; fg.fillRect(0, 0, 195, 422);
    if (img) { fg.save(); fg.beginPath(); fg.roundRect(65, 150, 64, 64, 16); fg.clip(); fg.drawImage(img, 65, 150, 64, 64); fg.restore(); }
    fg.fillStyle = '#fff'; fg.font = '700 15px -apple-system, Helvetica, sans-serif'; fg.textAlign = 'center'; fg.fillText('CatInsight', 97, 240); fTex.needsUpdate = true; };
  paintFallback(null); { const im = new Image(); im.onload = () => paintFallback(im); im.src = '/assets/icon-180.png'; }
  const scrMesh = add(new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), new THREE.MeshBasicMaterial({ map: fTex })));
  scrMesh.position.z = PD / 2 + 0.0008;
  // 手機專用的燈(只照第 1 層 = 手機,不影響房間),跟著鏡頭走
  const rig = new THREE.Group(); scene.add(rig);
  const pKey = new THREE.DirectionalLight(0xfff1e6, 2.6); pKey.position.set(1.6, 1.4, 0.6);
  const pRim = new THREE.DirectionalLight(0x8fa6ff, 3.2); pRim.position.set(-1.8, 0.9, -4.5);
  const pHemi = new THREE.HemisphereLight(0xc9d2ff, 0x1a1c28, 1.1);
  for (const l of [pKey, pRim, pHemi]) { l.layers.set(1); rig.add(l); if (l.target) l.target = phone; }
  // ---------- 手機螢幕:CSS3D 上的真 HTML(沿用 #screen-ui 的 widget 樣式) ----------
  const css = new CSS3DRenderer(); css.domElement.className = 'story-css'; document.body.appendChild(css.domElement);
  const scr = document.getElementById('screen-ui');
  scr.className = 'phone-mode'; scr.innerHTML = '<div class="pbar"><b>9:41</b><span class="isl"></span><i>●●● 5G</i></div><div class="papp"><div class="wgin"></div></div>';
  const host = scr.querySelector('.wgin');
  const cssObj = new CSS3DObject(scr); cssObj.scale.setScalar(SW / CSS_W); cssObj.position.z = PD / 2 + 0.0012; phone.add(cssObj);
  // ---------- 背景:蓋在房間上的暗色漸層(每段帶一點該功能的顏色) ----------
  const ovScene = new THREE.Scene(), ovCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const ovMat = new THREE.ShaderMaterial({ transparent: true, depthTest: false, depthWrite: false,
    uniforms: { uA: { value: 0 }, uC: { value: new THREE.Color('#4be07a') }, uAsp: { value: 1 }, uX: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `varying vec2 vUv; uniform float uA, uAsp, uX; uniform vec3 uC;
      void main(){ vec2 p = (vUv - 0.5) * vec2(uAsp, 1.0); float d = length(p - vec2(uX * 0.35 * uAsp, 0.0));
        vec3 base = mix(vec3(0.075, 0.09, 0.16), vec3(0.02, 0.025, 0.045), smoothstep(0.0, 0.95, length(p)));
        vec3 col = base + uC * 0.16 * (1.0 - smoothstep(0.0, 0.75, d));
        float grid = (step(0.985, fract(gl_FragCoord.x / 64.0)) + step(0.985, fract(gl_FragCoord.y / 64.0))) * 0.018;
        gl_FragColor = vec4(col + grid, uA); }` });
  ovScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), ovMat));
  // 語音那段:手機後面一顆會呼吸的光
  const glowC = document.createElement('canvas'); glowC.width = glowC.height = 256;
  { const g = glowC.getContext('2d'), gr = g.createRadialGradient(128, 128, 0, 128, 128, 128); gr.addColorStop(0, 'rgba(150,120,255,1)'); gr.addColorStop(0.35, 'rgba(110,90,255,.45)'); gr.addColorStop(1, 'rgba(90,130,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); }
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(glowC), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity: 0 }));
  glow.layers.set(1); scene.add(glow);
  // ---------- 綠色股價緞帶(圖表那段繞著手機):另一張透明 canvas,手機當遮擋,螢幕前面那段才蓋得過 HTML ----------
  const top = document.createElement('canvas'); top.className = 'story-top'; document.body.appendChild(top);
  const r2 = new THREE.WebGLRenderer({ canvas: top, alpha: true, antialias: true }); r2.setPixelRatio(renderer.getPixelRatio()); r2.outputColorSpace = THREE.SRGBColorSpace;
  const occ = new THREE.MeshBasicMaterial({ colorWrite: false });
  for (const m of [new THREE.Mesh(body.geometry, occ), new THREE.Mesh(new THREE.PlaneGeometry(SW, SH), occ)]) { m.layers.set(2); m.renderOrder = -1; phone.add(m); if (m.geometry.type === 'PlaneGeometry') m.position.z = PD / 2 + 0.0012; }
  const ribbonPts = []; {
    let r = 0x2f6b; const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    let wig = 0;
    for (let i = 0; i <= 120; i++) {                 // 左邊畫面外進來 → 繞手機 1.3 圈往上 → 從手機上方往上出去(不劃過右邊的字),一路帶著股價的起伏
      const k = i / 120; wig += (rnd() - 0.47) * 0.05; wig *= 0.9;
      if (k < 0.25) { const q = k / 0.25; ribbonPts.push(new THREE.Vector3(lerp(-2.6, -0.5, q), lerp(-0.55, -0.42, q) + wig, lerp(0.6, 0.3, q))); }
      else if (k < 0.8) { const q = (k - 0.25) / 0.55, a = Math.PI * 0.85 + q * Math.PI * 2 * 1.3, rad = 0.5 + 0.04 * Math.sin(q * 17); ribbonPts.push(new THREE.Vector3(Math.cos(a) * rad, lerp(-0.42, 0.58, q) + wig, Math.sin(a) * rad * 0.9)); }
      else { const q = (k - 0.8) / 0.2, a = Math.PI * 0.85 + Math.PI * 2 * 1.3; ribbonPts.push(new THREE.Vector3(lerp(Math.cos(a) * 0.5, 0.9, q), lerp(0.58, 2.0, q * q * 0.6 + q * 0.4) + wig, lerp(Math.sin(a) * 0.45, 0.1, q))); }
    }
  }
  const curve = new THREE.CatmullRomCurve3(ribbonPts), TUB = 600, RAD = 10;
  const ribbon = new THREE.Mesh(new THREE.TubeGeometry(curve, TUB, 0.0085, RAD, false), new THREE.MeshBasicMaterial({ color: 0x7dffa6 }));
  const ribbonGlow = new THREE.Mesh(new THREE.TubeGeometry(curve, TUB, 0.026, RAD, false), new THREE.MeshBasicMaterial({ color: 0x4be07a, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false }));
  for (const m of [ribbon, ribbonGlow]) { m.layers.set(3); phone.add(m); }
  // ---------- 文字(每段一組,放在手機旁邊) ----------
  const txt = document.createElement('div'); txt.className = 'story-txt'; document.body.appendChild(txt);
  const words = (s) => s.split(/(\s+)/).filter((w) => w.trim()).map((w, i) => `<span class="w"><span style="--d:${i}">${w}</span></span>`).join(' ');
  const secs = SLIDES.map((sl, i) => {
    const el = document.createElement('section'); el.style.setProperty('--c', sl.color);
    if (sl.key === 'hero') {
      el.className = 'stx hero';
      el.innerHTML = `<h2 class="hl">${words('CatInsight')}</h2><h2 class="hr">${words('Stock')}</h2><p class="tag">${sl.text}<br><span class="zh">${sl.zh}</span></p>`;
    } else {
      el.className = `stx side-${i % 2 ? 'l' : 'r'}`;
      el.innerHTML = `<div class="num">${String(i + 1).padStart(2, '0')}</div><div class="eb">${String(i).padStart(2, '0')} · ${sl.eyebrow}</div><h2>${words(sl.title)}</h2><p>${sl.text}</p><div class="zh">${sl.zh}</div>` +
        (sl.cta ? `<a class="store" href="${APP_STORE}"> Download on the App Store</a>` : '');
    }
    txt.appendChild(el); return el;
  });
  // 右邊的進度:每段一根小 K 棒
  const prog = document.createElement('div'); prog.className = 'story-prog'; document.body.appendChild(prog);
  const candles = SLIDES.map((sl, i) => { const c = document.createElement('i'); c.style.setProperty('--c', sl.color); c.title = sl.eyebrow || 'CatInsight'; c.onclick = () => goto(i + 1); prog.appendChild(c); return c; });
  // ---------- 鏡頭 / 手機的位置 ----------
  desk.updateWorldMatrix(true, false);
  const deskQ = desk.getWorldQuaternion(new THREE.Quaternion());
  const restPos = desk.localToWorld(new THREE.Vector3(0.62, 1.41 + PD / 2, 0.3));
  const restQ = deskQ.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 0.4)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2));
  const camLook = desk.localToWorld(new THREE.Vector3(0.1, 1.95, -0.3));
  const camDir = new THREE.Vector3(0.38, 0.14, 1).normalize();
  // 每段手機的姿勢(相對鏡頭):x 左右、y 上下、旋轉 [前後仰, 左右轉, 側傾](度)
  const POSE = [
    null,
    { x: 0, y: -0.02, r: [0, 0, 0] },              // 1 開場
    { x: 0.5, y: 0, r: [3, -22, 2] },              // 2 AI 選股
    { x: -0.5, y: 0, r: [-4, 30, -3] },            // 3 圖表(緞帶)
    { x: 0.5, y: 0.02, r: [6, -15, -2] },           // 4 漲幅
    { x: -0.5, y: 0, r: [-16, 20, 2] },            // 5 新聞(往後仰)
    { x: 0.5, y: 0, r: [0, -10, 0] },               // 6 語音(後面發光)
    { x: -0.5, y: 0, r: [2, 16, -5] },             // 7 提醒(震動)
    { x: 0.5, y: 0, r: [0, -20, 0] },              // 8 下載
  ];
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _e = new THREE.Euler(), _v = new THREE.Vector3(), _p = new THREE.Vector3();
  const poseQ = (r, out) => out.setFromEuler(_e.set(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'YXZ'));
  // ---------- 狀態 / 輸入 ----------
  let u = 0, target = 0, idleT = 0, cur = 0, stopW = null, shakeT = 0, lastW = 0, base = 0;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const isTouch = matchMedia('(hover: none)').matches;
  const clampT = (v) => Math.max(0, Math.min(N, v));
  const nudge = (d) => { target = clampT(Math.max(base - 1, Math.min(base + 1, target + d))); lastW = performance.now(); };   // 一次手勢最多走一段
  function goto(i) { target = clampT(i); base = target; idleT = 0; }
  // 停手時吸到一段:照這次捲的方向,離開原本那段超過 0.12 就前進 / 後退到下一段,不然退回原本那段
  const snap = () => { const d = target - base; target = clampT(d > 0.12 ? Math.ceil(target - 1e-6) : d < -0.12 ? Math.floor(target + 1e-6) : Math.round(base)); base = target; };
  window.addEventListener('wheel', (e) => {
    if (busy()) return;
    e.preventDefault();
    const dy = e.deltaMode === 1 ? e.deltaY * 30 : e.deltaY;
    nudge(dy * 0.003);
  }, { passive: false });
  let ty = null;
  window.addEventListener('touchstart', (e) => { if (busy() || e.touches.length > 1) return; ty = e.touches[0].clientY; }, { passive: true });
  window.addEventListener('touchmove', (e) => { if (ty == null || busy()) return; const y = e.touches[0].clientY; nudge((ty - y) * 0.005); ty = y; if (u > 0.02) e.preventDefault(); }, { passive: false });
  window.addEventListener('touchend', () => { ty = null; lastW = 0; });   // 放開手指就吸到一段
  window.addEventListener('keydown', (e) => {
    if (busy()) return;
    if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') { e.preventDefault(); goto(Math.round(target) + 1); }
    else if (e.key === 'ArrowUp' || e.key === 'PageUp') { e.preventDefault(); goto(Math.round(target) - 1); }
    else if (e.key === 'Home' || e.key === 'Escape') goto(0);
  });
  window.addEventListener('pointermove', (e) => { mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1; });
  if (isTouch) controls.enableRotate = false;      // 手機:手指上下滑 = 捲動,不要同時轉房間
  // ---------- 螢幕內容換頁 ----------
  function showSection(i) {
    if (i === cur) return; cur = i;
    const sl = SLIDES[Math.max(0, i - 1)]; scr.style.setProperty('--c', sl.color);
    scr.classList.add('swap');
    setTimeout(() => { if (stopW) stopW(); stopW = mountWidget(sl.key, host); scr.classList.remove('swap'); }, 160);
    if (sl.key === 'alerts') shakeT = 0.7;
  }
  showSection(1);
  // ---------- 每格 ----------
  const W = { w: 0, h: 0 };
  function update(dt, t) {
    if (ty == null && performance.now() - lastW > 220 && Math.abs(target - Math.round(target)) > 0.001) snap();   // 停手(手指放開)就吸到一段
    u += (target - u) * (1 - Math.exp(-dt * 5)); if (Math.abs(target - u) < 0.0005) u = target;
    const active = u > 0.0008;
    document.body.classList.toggle('story-on', u > 0.5);
    // 鏡頭:房間視角 → 書桌前(之後每段微微漂移,背景才有視差)
    const e = ss(0, 1, Math.min(u, 1)), s = Math.max(0, u - 1);
    if (active) {
      controls.enabled = false; controls.autoRotate = false;
      const portrait = camera.aspect < 0.9;
      const dist = portrait ? 4.4 : 3.3;
      _p.copy(camLook).addScaledVector(camDir, dist);
      _p.x += Math.sin(s * 0.9) * 0.22; _p.y += Math.cos(s * 0.7) * 0.06;
      camera.position.lerpVectors(orbit.pos, _p, e);
      _v.lerpVectors(orbit.target, camLook, e); camera.lookAt(_v);
    }
    camera.updateMatrixWorld();
    rig.position.copy(camera.position); rig.quaternion.copy(camera.quaternion);
    // 手機在這一段的姿勢(相對鏡頭)
    const portrait = camera.aspect < 0.9, D = portrait ? 3.1 : 2.8;
    const i0 = Math.max(1, Math.min(N, Math.floor(s) + 1)), i1 = Math.min(N, i0 + 1), k = ss(0.2, 0.8, s - (i0 - 1));
    const A = POSE[i0], B = POSE[i1];
    const xs = portrait ? 0 : 1, yOff = portrait ? -0.3 : 0, rs = portrait ? 0.5 : 1;
    _v.set(lerp(A.x, B.x, k) * xs, lerp(A.y, B.y, k) + yOff, -D);
    poseQ(A.r.map((v) => v * rs), _q); poseQ(B.r.map((v) => v * rs), _q2); _q.slerp(_q2, k);
    mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 4); mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 4);
    _q.multiply(_q2.setFromEuler(_e.set(mouse.sy * 0.14, mouse.sx * 0.22, 0)));          // 手機朝滑鼠那邊轉一點
    if (shakeT > 0) { shakeT -= dt; _v.x += Math.sin(t * 95) * 0.012 * (shakeT / 0.7); _v.y += Math.sin(t * 71) * 0.006 * (shakeT / 0.7); }
    _v.y += Math.sin(t * 1.3) * 0.012;                                                       // 漂浮
    const camPos = camera.localToWorld(_v.clone()), camQ = camera.quaternion.clone().multiply(_q);
    // 起飛:桌上 → 鏡頭前(中間往上拋一點)
    const lift = ss(0.12, 1, Math.min(u, 1));
    phone.position.lerpVectors(restPos, camPos, lift); phone.position.y += Math.sin(Math.PI * lift) * 0.35;
    phone.quaternion.slerpQuaternions(restQ, camQ, lift);
    // 背景變暗,帶一點目前這段的顏色;中心偏向手機那邊
    const dim = ss(0.15, 0.85, u);
    ovMat.uniforms.uA.value = dim * 0.93; ovMat.uniforms.uAsp.value = camera.aspect;
    const ci = Math.max(1, Math.min(N, Math.round(u))); ovMat.uniforms.uC.value.lerp(new THREE.Color(SLIDES[ci - 1].color), Math.min(1, dt * 3));
    ovMat.uniforms.uX.value = lerp(ovMat.uniforms.uX.value, portrait ? 0 : (POSE[ci].x > 0 ? 1 : POSE[ci].x < 0 ? -1 : 0), Math.min(1, dt * 3));
    // 螢幕 HTML:離開房間一點點就出現(遠看用 WebGL 的底圖)
    scr.style.opacity = ss(0.12, 0.35, u).toFixed(3);
    if (u > 0.4) showSection(Math.max(1, Math.min(N, Math.round(u))));
    // 語音:手機後面的光
    const gv = Math.max(0, 1 - Math.abs(u - 6) / 0.6);
    glow.material.opacity = gv * (0.75 + 0.25 * Math.sin(t * 2.4)); glow.position.copy(phone.position).addScaledVector(camera.getWorldDirection(_p), 0.6); glow.scale.setScalar(2.4 + 0.15 * Math.sin(t * 1.7));
    // 緞帶:圖表那段畫出來,離開時從尾巴收掉
    const grow = ss(2.45, 3.05, u), shrink = ss(3.15, 3.7, u), total = TUB * RAD * 6;
    const a0 = Math.floor(shrink * TUB) * RAD * 6, a1 = Math.floor(grow * TUB) * RAD * 6;
    for (const m of [ribbon, ribbonGlow]) m.geometry.setDrawRange(a0, Math.max(0, a1 - a0));
    W.ribbon = a1 - a0 > 0 && total > 0;
    // 文字:目前這段淡入、字一個個從遮罩裡浮出來;大號碼有視差
    secs.forEach((el, i) => {
      const on = Math.abs(u - (i + 1)) < 0.42 && (i > 0 || u > 0.7);
      el.classList.toggle('on', on);
      const nm = el.querySelector('.num'); if (nm) nm.style.transform = `translateY(${(u - (i + 1)) * -90}px)`;
    });
    candles.forEach((c, i) => { c.classList.toggle('on', Math.round(u) === i + 1); c.classList.toggle('done', u > i + 1.5); });
    W.active = active;
  }
  // ---------- 畫 ----------
  function render() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (w !== W.w || h !== W.h) { W.w = w; W.h = h; css.setSize(w, h); r2.setSize(w, h, false); }
    const showOv = ovMat.uniforms.uA.value > 0.002;
    renderer.autoClear = false; renderer.clear();
    camera.layers.set(0); renderer.render(scene, camera);
    if (showOv) {
      renderer.render(ovScene, ovCam); renderer.clearDepth();
      renderer.shadowMap.autoUpdate = false; camera.layers.set(1); renderer.render(scene, camera); renderer.shadowMap.autoUpdate = true;
    }
    camera.layers.set(0);
    css.domElement.style.display = ''; txt.style.display = ''; prog.style.display = '';
    css.render(scene, camera);
    top.style.display = W.ribbon ? 'block' : 'none';
    if (W.ribbon) { r2.clear(); camera.layers.set(2); camera.layers.enable(3); r2.render(scene, camera); camera.layers.set(0); }
  }
  function idle() {      // 房間在用舊流程(街機)時:把捲動版的圖層收起來
    css.domElement.style.display = 'none'; top.style.display = 'none'; txt.style.display = 'none'; prog.style.display = 'none';
    renderer.autoClear = true;
  }
  return { update, render, idle, goto, get active() { return u > 0.0008 || target > 0; }, get u() { return u; }, get target() { return target; } };
}
