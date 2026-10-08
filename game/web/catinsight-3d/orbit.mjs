// orbit.mjs — 鏡頭飛進電腦螢幕後的畫面:中間一個真實配色的棒旋銀河,8 塊半透明玻璃面板(App 各功能介紹)圍成一圈繞著它。
// 滾輪上 / 下、拖曳、‹ › 按鈕、方向鍵 → 轉到上一塊 / 下一塊;點旁邊的面板會轉到正前方;只有正前方那塊的 widget 會動(省 CPU)。
// 球和星塵用自己的 WebGL canvas 畫,面板是 CSS3D(真的 HTML,字清楚、widget 可以操作);兩邊共用同一台相機。
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';

const APP_STORE = 'https://apps.apple.com/app/id6763914049';

export function createOrbit({ host, slides, mountWidget, onExit }) {
  const N = slides.length, STEP = Math.PI * 2 / N, R = 1080, PW = 540, PH = 720, RY = -170;   // 面板圈的半徑、面板大小、面板圈的高度(比球低一點,球才露得出來)
  // ---------- 外框 ----------
  const root = document.createElement('div'); root.className = 'orbit'; host.appendChild(root);
  const canvas = document.createElement('canvas'); canvas.className = 'orbit-gl'; root.appendChild(canvas);
  const cssLayer = document.createElement('div'); cssLayer.className = 'orbit-css'; root.appendChild(cssLayer);
  const chrome = document.createElement('div'); chrome.className = 'orbit-ui';
  chrome.innerHTML = `<div class="ot"><b>CatInsight</b> <span>Stock</span><i>· features</i></div>
    <div class="ob"><div class="odots">${slides.map((s, i) => `<i data-i="${i}" style="--c:${s.color}"></i>`).join('')}</div>
    <div class="ohint">Scroll or drag to explore · 滾動或拖曳瀏覽</div></div>`;
  root.appendChild(chrome);
  const dots = [...chrome.querySelectorAll('.odots i')];
  dots.forEach((d) => d.addEventListener('click', (e) => { e.stopPropagation(); goTo(+d.dataset.i); }));

  // ---------- 三維:相機、銀河球、星塵、背景星空 ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x05060f, 1);
  const css = new CSS3DRenderer({ element: cssLayer });
  const scene = new THREE.Scene(), cssScene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, 1, 10, 20000);
  const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  const pointsMat = (sizeScale) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glow }, uScale: { value: sizeScale }, uPR: { value: 1 } },
    vertexShader: `attribute float aSize; attribute float aPh; attribute vec3 aCol; uniform float uTime, uScale, uPR; varying vec3 vCol; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + fract(aPh * 7.3) * 2.2) + aPh * 6.28);
        gl_PointSize = aSize * uScale * uPR * (900.0 / -mv.z) * (0.75 + 0.25 * tw); vCol = aCol; vA = tw; }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vA;
      void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol * (0.6 + 0.6 * vA), a * (0.55 + 0.45 * vA)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  // 真實銀河的配色:中心核球暖黃白(老恆星)、旋臂藍白(年輕恆星)、旋臂上零星粉紅的電離氫星雲、旋臂內緣一條暗的塵埃帶(那裡粒子很少)
  const C = (h) => new THREE.Color(h);
  const CORE = [C(0xfff6e2), C(0xffe2a8), C(0xffc278), C(0xf0a060)], ARM = [C(0xcfe0ff), C(0x9fc0ff), C(0xe8eeff), C(0xffffff)], HII = C(0xff7fb0), DUSTY = C(0xd9b88a);
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const makePoints = (count, place, sizeScale) => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < count; i++) { const s = place(i, v, c); pos.set([v.x, v.y, v.z], i * 3); col.set([c.r, c.g, c.b], i * 3); size[i] = s; ph[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const p = new THREE.Points(g, pointsMat(sizeScale)); p.frustumCulled = false; return p;
  };
  const SR = 340;                                                                          // 核球的大小基準
  const galaxy = new THREE.Group(); scene.add(galaxy);
  const diskG = new THREE.Group(); diskG.rotation.set(0.5, 0, 0.16); galaxy.add(diskG);   // 整個銀河盤往前傾
  // 核球:越中心越密越白,往外變黃、變橘;壓扁成橢球
  const sphere = makePoints(9000, (i, v, c) => {
    const r = SR * 0.62 * Math.min(2.4, -Math.log(1 - Math.random() * 0.98) * 0.55), u = Math.random() * 2 - 1, a = Math.random() * 6.283;
    v.set(Math.sqrt(1 - u * u) * Math.cos(a) * r * 1.15, u * r * 0.55, Math.sqrt(1 - u * u) * Math.sin(a) * r);
    const k = Math.min(1, r / (SR * 0.9)); c.copy(CORE[0]).lerp(CORE[1], Math.min(1, k * 1.8)).lerp(CORE[2], Math.max(0, k - 0.4)).lerp(CORE[3], Math.max(0, k - 0.8) * 1.5);
    return 1.1 + Math.random() * 2.0 * (1 - k * 0.5);
  }, 1.8);
  diskG.add(sphere);
  // 中心棒狀結構(銀河系是棒旋星系)
  const core = makePoints(3500, (i, v, c) => { const x = gauss() * SR * 0.75, r = Math.abs(x) / (SR * 0.75);
    v.set(x, gauss() * SR * 0.08, gauss() * SR * 0.16); v.applyAxisAngle(new THREE.Vector3(0, 1, 0), 0.5); c.copy(CORE[1]).lerp(CORE[2], r); return 1 + Math.random() * 1.6; }, 1.6);
  diskG.add(core);
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffd9a0, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
  coreGlow.scale.setScalar(SR * 2.6); galaxy.add(coreGlow);
  // 旋臂:兩條主臂 + 兩條次臂,對數螺線(俯仰角約 13°);塵埃帶 = 臂內緣那一側粒子少、偏暗偏黃
  const PITCH = Math.tan(THREE.MathUtils.degToRad(13)), R0 = SR * 0.75, RMAX = SR * 3.1;
  const disk = makePoints(26000, (i, v, c) => {
    const major = i % 4 < 2, arm = i % 4, t = Math.pow(Math.random(), 0.8), r = R0 + t * (RMAX - R0);
    const th = arm * Math.PI / 2 + Math.log(r / R0) / PITCH * 0.42;
    let off = gauss() * r * (major ? 0.2 : 0.26);                                        // 旋臂寬一點、邊緣鬆散
    const dust = off < -r * 0.03 && off > -r * 0.09;                                     // 臂內緣的塵埃帶
    if (dust && Math.random() < 0.75) off = -r * 0.12 + gauss() * r * 0.02;
    const a = th + off / r;
    v.set(Math.cos(a) * r, gauss() * SR * 0.05 * (1 - t * 0.6), Math.sin(a) * r);
    c.copy(DUSTY).lerp(ARM[0], Math.min(1, t * 1.6)).lerp(ARM[(i >> 2) % 4], Math.random() * 0.5);
    let sz = (major ? 1.0 : 0.8) + Math.random() * 1.4 * (1 - t * 0.4);
    if (Math.random() < 0.035 && Math.abs(off) < r * 0.05) { c.copy(HII); sz *= 1.8; }   // 粉紅星雲團
    if (Math.random() < 0.02) { c.setRGB(1, 1, 1); sz *= 1.6; }                          // 幾顆亮的藍白巨星
    if (!major) c.multiplyScalar(0.75);
    return sz;
  }, 1.5);
  diskG.add(disk);
  // 盤面的一層淡淡的漫射光(很多很暗的小點)
  const haze = makePoints(9000, (i, v, c) => { const r = SR * 0.6 + Math.pow(Math.random(), 1.6) * RMAX, a = Math.random() * 6.283;
    v.set(Math.cos(a) * r, gauss() * SR * 0.04, Math.sin(a) * r); c.copy(CORE[1]).lerp(ARM[0], Math.min(1, r / RMAX * 1.4)).multiplyScalar(0.45); return 0.8 + Math.random(); }, 1.3);
  diskG.add(haze);
  // 遠方星空
  const stars = makePoints(2600, (i, v, c) => { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = 5000 + Math.random() * 4000;
    v.set(Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r, Math.sqrt(1 - u * u) * Math.sin(a) * r); c.setHSL(0.6 + Math.random() * 0.2, 0.4, 0.75 + Math.random() * 0.25); return 1.5 + Math.random() * 3; }, 1);
  scene.add(stars);
  // 面板走的軌道:一圈很淡的光環
  const ringLine = new THREE.Mesh(new THREE.TorusGeometry(R, 1.2, 6, 256), new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
  ringLine.rotation.x = Math.PI / 2; ringLine.position.y = RY - PH / 2 - 30; scene.add(ringLine);

  // ---------- 面板(CSS3D)----------
  const ring = new THREE.Group(); cssScene.add(ring);
  const panels = slides.map((sl, i) => {
    const el = document.createElement('div'); el.className = `opanel op-${sl.key}`; el.style.setProperty('--c', sl.color); el.style.width = PW + 'px'; el.style.height = PH + 'px';
    const head = sl.key === 'hero'
      ? `<div class="oph"><img class="opicon" src="/assets/icon-180.png" alt=""><div class="eyebrow">WELCOME</div><h3>${sl.title}</h3><p>${sl.text}</p><div class="zh">${sl.zh}</div></div>`
      : `<div class="oph"><div class="eyebrow">${String(i).padStart(2, '0')} · ${sl.eyebrow}</div><h3>${sl.title}</h3><p>${sl.text}</p><div class="zh">${sl.zh}</div>` +
        (sl.cta ? `<a class="store" href="${APP_STORE}"> Download on the App Store</a>` : '') + `</div>`;
    el.innerHTML = `${head}<div class="opw"><div class="wgin"></div></div><div class="opshine"></div>`;
    el.addEventListener('click', () => { if (i !== cur()) goTo(i); });
    const obj = new CSS3DObject(el); const a = i * STEP;
    obj.position.set(Math.sin(a) * R, RY, Math.cos(a) * R); obj.rotation.y = a; ring.add(obj);
    return { el, obj, key: sl.key, host: el.querySelector('.wgin'), stop: null };
  });

  // ---------- 狀態 / 互動 ----------
  let open = false, angle = 0, target = 0, active = -1, t0 = performance.now(), last = t0, raf = 0, covering = false;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const cur = () => ((Math.round(-target / STEP) % N) + N) % N;
  function goTo(i) { const k = Math.round(-target / STEP); let d = ((i - ((k % N) + N) % N) % N + N) % N; if (d > N / 2) d -= N; target = -(k + d) * STEP; }
  function step(dir) { target = (Math.round(target / STEP) - dir) * STEP; }
  function setActive(i) {
    if (i === active) return;
    if (active >= 0 && panels[active].stop) { panels[active].stop(); panels[active].stop = null; panels[active].host.innerHTML = ''; }
    active = i; const p = panels[i];
    if (p.key !== 'hero' && p.key !== 'app') p.stop = mountWidget(p.key, p.host);
    else if (p.key === 'app') p.host.innerHTML = `<div class="qr"><img src="/assets/icon-180.png" alt=""><span>App Store · free</span></div>`;
    panels.forEach((q, k) => q.el.classList.toggle('front', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }
  // 滾輪:累積成角度,停下來 160ms 後對齊最近一塊
  let snapTimer = 0;
  root.addEventListener('wheel', (e) => { e.preventDefault(); e.stopPropagation(); const d = Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX;
    target -= Math.max(-90, Math.min(90, d)) * 0.0032; clearTimeout(snapTimer); snapTimer = setTimeout(() => { target = Math.round(target / STEP) * STEP; }, 160); }, { passive: false });
  // 拖曳:左右拖轉圈(手機上下滑也可以)
  let drag = null;
  root.addEventListener('pointerdown', (e) => { if (e.target.closest('a, button, canvas.wgc, .tabs')) return; drag = { x: e.clientX, y: e.clientY, t: target, moved: false }; });
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1;
    if (!drag || !open) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    const d = Math.abs(dx) > Math.abs(dy) * 0.8 || e.pointerType !== 'touch' ? dx : -dy;
    if (drag.moved) target = drag.t + d * 0.0042;
  });
  window.addEventListener('pointerup', () => { if (drag) { if (drag.moved) target = Math.round(target / STEP) * STEP; drag = null; } });
  root.addEventListener('click', (e) => { if (drag && drag.moved) e.stopPropagation(); }, true);

  function resize() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); css.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    [sphere, core, disk, haze, stars].forEach((p) => { p.material.uniforms.uPR.value = dpr; });
  }
  addEventListener('resize', () => { if (open) resize(); });

  function frame(now) {
    if (!open) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000), t = (now - t0) / 1000; last = now;
    angle += (target - angle) * Math.min(1, dt * 6);
    ring.rotation.y = angle;
    setActive(cur());
    // 每塊面板:越靠正前方越亮越清楚,轉到球後面就淡出(CSS 層在 WebGL 上面,不淡掉會蓋住球)
    panels.forEach((p, i) => { const a = i * STEP + angle, f = Math.cos(a);
      const op = f > -0.1 ? 0.35 + 0.65 * Math.pow((f + 0.1) / 1.1, 1.6) : Math.max(0, (f + 0.45) / 0.35) * 0.35;
      p.el.style.opacity = op.toFixed(3); p.el.style.pointerEvents = op > 0.3 ? 'auto' : 'none'; p.obj.position.y = RY + Math.sin(t * 0.8 + i * 1.3) * 8; });
    // 相機:依畫面比例拉遠(直式手機要退比較多),跟著滑鼠一點點視差
    // 從比較高的地方往下看:球在畫面中上,正前方的面板在下半部,旁邊的面板沿著橢圓繞
    // 直式手機:鏡頭拉近,讓正前方的面板佔畫面寬度約 86%(兩旁的面板會露一點邊),球在面板上方
    const aspect = innerWidth / innerHeight, portrait = aspect < 0.8;
    // 桌機:正前方面板佔畫面高度約 66%(寬度不超過約 46%);手機:佔寬度約 88%
    const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const dist = R + (portrait ? PW / (0.88 * 2 * tanH * aspect) : Math.max(PH / (0.66 * 2 * tanH), PW / (0.44 * 2 * tanH * aspect)));
    mouse.sx += (mouse.x - mouse.sx) * 0.05; mouse.sy += (mouse.y - mouse.sy) * 0.05;
    if (portrait) { camera.position.set(mouse.sx * 40, 200, dist); camera.lookAt(0, RY - 90, 0); }
    else { camera.position.set(mouse.sx * 90, 330 - mouse.sy * 50, dist); camera.lookAt(0, RY - 110, 0); }
    diskG.rotation.y = t * 0.035; stars.rotation.y = t * 0.004;
    [sphere, core, disk, haze, stars].forEach((p) => { p.material.uniforms.uTime.value = t; });
    coreGlow.material.opacity = 0.65 + 0.08 * Math.sin(t * 1.3);
    renderer.render(scene, camera); css.render(cssScene, camera);
  }
  return {
    get open() { return open; }, get covering() { return covering; },
    show() { if (open) return; open = true; root.classList.add('on'); resize(); target = angle = Math.round(angle / STEP) * STEP; active = -1; last = t0 = performance.now(); raf = requestAnimationFrame(frame); setTimeout(() => { if (open) covering = true; }, 700); },
    hide() { open = false; covering = false; root.classList.remove('on'); cancelAnimationFrame(raf); panels.forEach((p) => { if (p.stop) { p.stop(); p.stop = null; } p.host.innerHTML = ''; }); active = -1; },
    step, goTo, exit: onExit,
  };
}
