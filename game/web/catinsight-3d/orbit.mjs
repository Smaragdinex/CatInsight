// orbit.mjs — 鏡頭飛進電腦螢幕後的畫面:一趟「銀河系 → 太陽系 → 地球」的旅程,最後 8 塊功能面板像衛星一樣繞著地球。
// 往下捲動(或拖曳、‹ ›、方向鍵)= 往前飛;到了地球之後捲動 = 轉面板;在第一塊面板往上捲 = 往回飛到太空;在銀河再往上 = 回房間。
// 三個場景各自用自己的尺度(銀河幾千單位、太陽系幾百、地球半徑 300),交接時讓畫面上的東西大小一致再交叉淡化,看起來就是一路連續拉近。
// 面板是 CSS3D(真的 HTML,字清楚、widget 可以操作),和地球場景共用同一台相機。
import * as THREE from 'three';
import { CSS3DRenderer, CSS3DObject } from 'three/addons/renderers/CSS3DRenderer.js';
import { createGalaxy, GAL_CAM } from './galaxy.mjs?v=4';

const APP_STORE = 'https://apps.apple.com/app/id6763914049';
// 地球貼圖(NASA 藍色彈珠影像,three.js 範例附的版本);載不到時用程式畫的替代貼圖
const TEX = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r174/examples/textures/planets/';

export function createOrbit({ host, slides, mountWidget, onExit }) {
  const N = slides.length, STEP = Math.PI * 2 / N, R = 1080, PW = 540, PH = 720, RY = -170;   // 面板圈的半徑、面板大小、面板圈的高度
  const ER = 300;                                                                            // 地球場景裡的地球半徑
  // 旅程的進度 p(0 = 看著整個銀河、1 = 到地球、面板出現):各段的範圍
  const G_END = 0.44, S_START = 0.34, S_END = 0.8, E_START = 0.76, REVEAL = 0.9, OVERVIEW = 0.56;
  // ---------- 外框 ----------
  const root = document.createElement('div'); root.className = 'orbit'; host.appendChild(root);
  const canvas = document.createElement('canvas'); canvas.className = 'orbit-gl'; root.appendChild(canvas);
  const cssLayer = document.createElement('div'); cssLayer.className = 'orbit-css'; root.appendChild(cssLayer);
  const chrome = document.createElement('div'); chrome.className = 'orbit-ui';
  chrome.innerHTML = `<div class="ot"><b>CatInsight</b> <span>Stock</span><i>· features</i></div>
    <div class="ob"><div class="ostages"><span>Milky Way · 銀河系</span><i></i><span>Solar System · 太陽系</span><i></i><span>Earth · 地球</span></div>
    <div class="odots">${slides.map((s, i) => `<i data-i="${i}" style="--c:${s.color}"></i>`).join('')}</div>
    <div class="ohint"></div></div>
    <div class="ocredit">Planet textures © Solar System Scope (CC BY 4.0) · Earth & Moon: NASA</div>`;
  root.appendChild(chrome);
  const dots = [...chrome.querySelectorAll('.odots i')], stageEls = [...chrome.querySelectorAll('.ostages span')], hintEl = chrome.querySelector('.ohint'), dotsEl = chrome.querySelector('.odots');
  dots.forEach((d) => d.addEventListener('click', (e) => { e.stopPropagation(); if (atEarth()) goTo(+d.dataset.i); }));
  stageEls.forEach((s, k) => { s.style.pointerEvents = 'auto'; s.style.cursor = 'pointer'; s.addEventListener('click', (e) => { e.stopPropagation(); pT = [0, OVERVIEW, 1][k]; }); });

  // ---------- 共用 ----------
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  renderer.setClearColor(0x020309, 1); renderer.autoClear = false;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;   // 和房間一樣(銀河用得到;粒子和地球的 shader 不吃色調映射)
  const css = new CSS3DRenderer({ element: cssLayer });
  const camera = new THREE.PerspectiveCamera(GAL_CAM.fov, 1, 1, 20000);
  const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  // 發光的粒子:每顆有自己的大小和閃爍;離相機太近的會淡掉(穿過銀河時不會變成一大團),大小有上限;uFade 給場景淡入淡出
  const allPoints = [];
  const pointsMat = (sizeScale) => new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glow }, uScale: { value: sizeScale }, uPR: { value: 1 }, uFade: { value: 1 } },
    vertexShader: `attribute float aSize; attribute float aPh; attribute vec3 aCol; uniform float uTime, uScale, uPR, uFade; varying vec3 vCol; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv;
        float tw = 0.55 + 0.45 * sin(uTime * (0.8 + fract(aPh * 7.3) * 2.2) + aPh * 6.28);
        gl_PointSize = min(aSize * uScale * uPR * (900.0 / -mv.z) * (0.75 + 0.25 * tw), 26.0 * uPR); vCol = aCol; vA = tw * uFade * smoothstep(1.5, 14.0, -mv.z); }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vA;
      void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol * (0.6 + 0.6 * vA), a * (0.55 + 0.45 * vA) * step(0.001, vA) * min(1.0, vA * 2.0)); }`,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const makePoints = (count, place, sizeScale) => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
    const v = new THREE.Vector3(), c = new THREE.Color();
    for (let i = 0; i < count; i++) { const s = place(i, v, c); pos.set([v.x, v.y, v.z], i * 3); col.set([c.r, c.g, c.b], i * 3); size[i] = s; ph[i] = Math.random(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size, 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph, 1));
    const p = new THREE.Points(g, pointsMat(sizeScale)); p.frustumCulled = false; allPoints.push(p); return p;
  };
  const starField = (r0, r1, count, sizeScale) => makePoints(count, (i, v, c) => { const u = Math.random() * 2 - 1, a = Math.random() * 6.283, r = r0 + Math.random() * (r1 - r0);
    v.set(Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r, Math.sqrt(1 - u * u) * Math.sin(a) * r); c.setHSL(0.58 + Math.random() * 0.12, 0.35, 0.75 + Math.random() * 0.25); return 1.5 + Math.random() * 3; }, sizeScale);
  const sprite = (color, scale, opacity = 1) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })); s.scale.setScalar(scale); s.userData.op = opacity; return s; };
  const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
  const ss = (a, b, x) => ease((x - a) / (b - a));
  const lerpLog = (a, b, k) => Math.exp(Math.log(a) + (Math.log(b) - Math.log(a)) * k);

  // =====================================================================
  // 1. 銀河系(galaxy.mjs:和房間電腦螢幕上那個是同一個,固定亂數種子、同一個時鐘)
  // =====================================================================
  const gauss = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  const gal = createGalaxy(), gScene = gal.scene;
  const sunMark = sprite(0xffe7b0, 10, 0); sunMark.position.copy(gal.sunLocal); gal.disk.add(sunMark);
  const sunW = new THREE.Vector3(), diskN = new THREE.Vector3();
  // 飛進銀河時的星塵:一團跟著相機的顆粒,從遠處畫面中心往外散開、從身邊飛過(往下捲越快,飛得越快、越明顯)
  const makeWarp = (scene, N2) => { const pos = new Float32Array(N2 * 3), col = new Float32Array(N2 * 3), size = new Float32Array(N2);
    const PAL = [[1, 0.93, 0.8], [0.8, 0.86, 1], [1, 0.82, 0.62], [0.55, 0.36, 0.24], [0.95, 0.97, 1]];
    for (let i = 0; i < N2; i++) { const a = Math.random() * 6.283, r = 0.03 + Math.pow(Math.random(), 0.7) * 0.75; pos.set([Math.cos(a) * r, Math.sin(a) * r, -Math.random()], i * 3);
      const c = PAL[Math.floor(Math.random() * PAL.length)], b = 0.5 + Math.random() * 0.6; col.set([c[0] * b, c[1] * b, c[2] * b], i * 3); size[i] = 0.6 + Math.random() * 1.8; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3)); g.setAttribute('aSize', new THREE.BufferAttribute(size, 1));
    const m = new THREE.ShaderMaterial({ uniforms: { uOff: { value: 0 }, uAmt: { value: 0 }, uViewH: { value: 800 }, uMap: { value: glow } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aSize; attribute vec3 aCol; uniform float uOff, uAmt, uViewH; varying vec3 vCol; varying float vA;
        void main() { vec3 P = position; P.z = -1.0 + mod(P.z + 1.0 + uOff, 1.0); float d = max(-P.z, 0.015);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0); float k = uViewH / 800.0;
          gl_PointSize = min(aSize * k * 2.2 / d, 30.0 * k); vCol = aCol; vA = uAmt * smoothstep(1.0, 0.7, d) * smoothstep(0.015, 0.09, d); }`,
      fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vA; void main() { float a = texture2D(uMap, gl_PointCoord).a; gl_FragColor = vec4(vCol, a * vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    const pts = new THREE.Points(g, m); pts.frustumCulled = false; pts.renderOrder = 5; scene.add(pts); return { pts, m, spd: 0 }; };
  const warp = makeWarp(gScene, 5200);                                                       // 銀河段的星塵(多一點)
  let gStreak = null, sWarp = null;                                                          // 銀河段的光速線、太陽系段的星塵(第一次用到時建立)
  let pPrev = 0, readyAt = 0, mv = 0, wheelGate = true, lastWheel = 0;                                                       // readyAt:畫面放大完成的時間(之後顆粒才慢慢出現);mv:目前「有沒有在動」(0~1)
  // 超空間光速線(像星際大戰跳躍):跟著相機的細長光線,從畫面中心往外拉長飛過;進入太陽系那一刻最強,在太陽系裡捲動時也會出現
  const makeStreaks = (scene) => { const N2 = 1100, pos = new Float32Array(N2 * 6), end = new Float32Array(N2 * 2), col = new Float32Array(N2 * 6);
    for (let i = 0; i < N2; i++) { const a = Math.random() * 6.283, r = 0.04 + Math.pow(Math.random(), 0.6) * 0.95, z = -Math.random(), b = 0.5 + Math.random() * 0.5, w = Math.random() < 0.7;
      for (let e = 0; e < 2; e++) { pos.set([Math.cos(a) * r, Math.sin(a) * r, z], (i * 2 + e) * 3); end[i * 2 + e] = e; col.set(w ? [0.85 * b, 0.92 * b, 1.0 * b] : [1.0 * b, 0.9 * b, 0.75 * b], (i * 2 + e) * 3); } }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aEnd', new THREE.BufferAttribute(end, 1)); g.setAttribute('aCol', new THREE.BufferAttribute(col, 3));
    const m = new THREE.ShaderMaterial({ uniforms: { uOff: { value: 0 }, uAmt: { value: 0 }, uLen: { value: 0.05 } }, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      vertexShader: `attribute float aEnd; attribute vec3 aCol; uniform float uOff, uAmt, uLen; varying vec3 vCol; varying float vA;
        void main() { vec3 P = position; P.z = -1.0 + mod(P.z + 1.0 + uOff, 1.0); float head = -P.z; P.z -= aEnd * uLen;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(P, 1.0); vCol = aCol; vA = uAmt * smoothstep(1.0, 0.6, head) * smoothstep(0.02, 0.12, head) * (1.0 - aEnd * 0.85); }`,
      fragmentShader: `varying vec3 vCol; varying float vA; void main() { gl_FragColor = vec4(vCol, vA);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
    const obj = new THREE.LineSegments(g, m); obj.frustumCulled = false; obj.renderOrder = 9; scene.add(obj); return { obj, m, spd: 0 }; };
  // 銀河先畫進一張高精度的圖,再整張做一次 ACES 色調映射 + sRGB + 和房間一樣的調色 / 暗角 / 顆粒(房間的電腦螢幕就是這樣出來的,兩邊才會一模一樣)
  const galRT = new THREE.WebGLRenderTarget(4, 4, { type: THREE.HalfFloatType, samples: 4 });
  const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const postMat = new THREE.ShaderMaterial({ depthTest: false, depthWrite: false, toneMapped: false,
    uniforms: { tDiffuse: { value: galRT.texture }, uExp: { value: 1.05 }, uRes: { value: new THREE.Vector2(1, 1) }, uTime: { value: 0 }, uVig: { value: 0.3 }, uGrain: { value: 0.035 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uExp, uTime, uVig, uGrain; uniform vec2 uRes; varying vec2 vUv;
      vec3 RRTAndODTFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
      vec3 aces(vec3 c) { const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
        const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
        c *= uExp / 0.6; c = I * c; c = RRTAndODTFit(c); c = O * c; return clamp(c, 0.0, 1.0); }
      vec3 srgb(vec3 c) { return mix(1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, c * 12.92, step(c, vec3(0.0031308))); }
      void main() { vec3 c = srgb(aces(texture2D(tDiffuse, vUv).rgb)); float l = dot(c, vec3(.299, .587, .114));
        c *= mix(vec3(1.05, 1.02, .95), vec3(1.0, .97, 1.07), 1.0 - l);
        c = (c - .5) * 1.06 + .5; c = mix(vec3(l), c, 1.08);
        vec2 p = vUv - .5; p.x *= uRes.x / uRes.y; c *= mix(1.0 - uVig, 1.0, smoothstep(.95, .3, length(p)));
        float n = fract(sin(dot(floor(vUv * uRes) + fract(uTime * 7.13) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - .5;
        gl_FragColor = vec4(c + n * uGrain, 1.0); }` });
  postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

  // =====================================================================
  // 2. 太陽系
  // =====================================================================
  const sScene = new THREE.Scene();
  const sStars = starField(30000, 40000, 3000, 30); sScene.add(sStars);
  // 天空裡淡淡的一條銀河帶(太陽系和地球兩段都有)
  const milkyBand = (rad, count, sizeScale) => makePoints(count, (i, v, c) => { const a = Math.random() * 6.283, lat = gauss() * 0.11 + gauss() * 0.04;
    v.set(Math.cos(a) * Math.cos(lat), Math.sin(lat), Math.sin(a) * Math.cos(lat)).multiplyScalar(rad).applyAxisAngle(new THREE.Vector3(1, 0, 0), 1.05).applyAxisAngle(new THREE.Vector3(0, 0, 1), 0.5);
    const core = Math.pow(Math.max(0, Math.cos(a - 1.2)), 6); c.setRGB(0.78 + 0.22 * core, 0.74 + 0.14 * core, 0.82 - 0.2 * core).multiplyScalar(0.3 + 0.45 * core + Math.random() * 0.25);
    return 0.8 + Math.random() * 1.4 + core * 1.2; }, sizeScale);
  const sBand = milkyBand(34000, 7000, 30); sScene.add(sBand);
  let sStreak = null;                                                                        // makeStreaks 在下面定義,建好再放進來
  // 太陽:表面有翻動的米粒組織、邊緣比較暗(臨邊昏暗)、偶爾幾塊太陽黑子;外面三層光暈
  const NOISE_GLSL = `float h3(vec3 p) { p = fract(p * 0.3183099 + 0.1); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
    float vn3(vec3 x) { vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);
      return mix(mix(mix(h3(i), h3(i + vec3(1,0,0)), f.x), mix(h3(i + vec3(0,1,0)), h3(i + vec3(1,1,0)), f.x), f.y), mix(mix(h3(i + vec3(0,0,1)), h3(i + vec3(1,0,1)), f.x), mix(h3(i + vec3(0,1,1)), h3(i + vec3(1,1,1)), f.x), f.y), f.z); }
    float fbm3(vec3 p) { float a = 0.5, s = 0.0; for (int i = 0; i < 5; i++) { s += a * vn3(p); p *= 2.03; a *= 0.5; } return s; }`;
  const sunMat = new THREE.ShaderMaterial({ uniforms: { uTime: { value: 0 }, uFade: { value: 1 }, uTex: { value: null }, uHas: { value: 0 } }, transparent: true,
    vertexShader: `varying vec3 vP, vN, vW; varying vec2 vUv; void main() { vUv = uv; vP = position; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uFade, uHas; uniform sampler2D uTex; varying vec3 vP, vN, vW; varying vec2 vUv; ${NOISE_GLSL}
      void main() { vec3 q = normalize(vP); float g = fbm3(q * 6.0 + vec3(0.0, uTime * 0.05, uTime * 0.02)); float gr = vn3(q * 42.0 + uTime * 0.3);
        float spots = smoothstep(0.63, 0.7, fbm3(q * 3.0 + 7.0)); float mu = max(dot(normalize(vN), normalize(cameraPosition - vW)), 0.0), limb = pow(mu, 0.45);
        vec3 col = mix(vec3(1.0, 0.36, 0.05), vec3(1.0, 0.9, 0.62), limb) * (0.68 + 0.5 * g + 0.2 * gr) * (1.0 - spots * 0.6);
        if (uHas > 0.5) { vec3 tx = texture2D(uTex, vUv + vec2(uTime * 0.003, 0.0)).rgb; col = tx * mix(vec3(1.0, 0.55, 0.25), vec3(1.25, 1.1, 0.95), limb) * (0.8 + 0.4 * g) * 1.6; }   // 真實太陽貼圖 + 翻動的雜訊 + 臨邊昏暗
        gl_FragColor = vec4(col * 1.3, uFade);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }` });
  const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(22, 64, 48), sunMat); sScene.add(sunMesh);
  new THREE.TextureLoader().load(new URL('./planets/2k_sun.jpg', import.meta.url).href, (t) => { t.colorSpace = THREE.SRGBColorSpace; sunMat.uniforms.uTex.value = t; sunMat.uniforms.uHas.value = 1; }, undefined, () => {});
  const sunGlow1 = sprite(0xfff0d0, 90, 0.85), sunGlow2 = sprite(0xffb060, 230, 0.35), sunGlow3 = sprite(0xff8a3a, 650, 0.12); sScene.add(sunGlow1, sunGlow2, sunGlow3);
  sScene.add(new THREE.PointLight(0xfff4e6, 3.4, 0, 0)); sScene.add(new THREE.AmbientLight(0x223355, 0.06));   // 環境光很弱 → 行星背光那面是暗的
  // 行星表面:用 3D 雜訊在球面上畫(沒有接縫),依行星特徵上色;第一次用到前在閒置時間畫好
  const pnoise = (() => { const P = new Uint8Array(512); let sd = 1234567; for (let i = 0; i < 256; i++) P[i] = i;
    for (let i = 255; i > 0; i--) { sd = (sd * 16807) % 2147483647; const j = sd % (i + 1); [P[i], P[j]] = [P[j], P[i]]; } for (let i = 0; i < 256; i++) P[i + 256] = P[i];
    const h = (i, j, k) => P[P[P[i & 255] + (j & 255)] + (k & 255)] / 255;
    const n = (x, y, z) => { const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z); let xf = x - xi, yf = y - yi, zf = z - zi; xf = xf * xf * (3 - 2 * xf); yf = yf * yf * (3 - 2 * yf); zf = zf * zf * (3 - 2 * zf);
      const l = (a, b, t) => a + (b - a) * t;
      return l(l(l(h(xi, yi, zi), h(xi + 1, yi, zi), xf), l(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), xf), yf), l(l(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), xf), l(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), xf), yf), zf); };
    return (x, y, z, oct = 4) => { let a = 0.5, s2 = 0, f = 1; for (let o = 0; o < oct; o++) { s2 += a * n(x * f, y * f, z * f); f *= 2.03; a *= 0.5; } return s2 / (1 - Math.pow(0.5, oct)); }; })();
  const hex = (hh) => [(hh >> 16 & 255) / 255, (hh >> 8 & 255) / 255, (hh & 255) / 255];
  const mixc = (a, b, t) => a.map((v, i) => v + (b[i] - v) * Math.max(0, Math.min(1, t)));
  const sm = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const planetTex = (W, H, shade) => { const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) { const lat = (0.5 - (y + 0.5) / H) * Math.PI, cl = Math.cos(lat), sl = Math.sin(lat);
      for (let x = 0; x < W; x++) { const lon = (x + 0.5) / W * Math.PI * 2, px = cl * Math.cos(lon), pz = cl * Math.sin(lon); const col = shade(px, sl, pz, lat, lon), i = (y * W + x) * 4;
        d[i] = Math.min(255, col[0] * 255); d[i + 1] = Math.min(255, col[1] * 255); d[i + 2] = Math.min(255, col[2] * 255); d[i + 3] = 255; } }
    g.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t; };
  const SHADES = {
    mercury: (x, y, z) => { const n = pnoise(x * 4, y * 4, z * 4), cr = pnoise(x * 18 + 5, y * 18, z * 18, 3); const v = 0.38 + 0.28 * n - (cr > 0.66 ? (cr - 0.66) * 1.6 : 0) + (cr < 0.3 ? 0.08 : 0); return [v * 1.02, v, v * 0.94]; },
    venus: (x, y, z, lat) => { const q = pnoise(x * 2 + 3, y * 2, z * 2), band = 0.5 + 0.5 * Math.sin(lat * 7 + q * 5); return mixc(hex(0xd4ad6c), hex(0xf2dfb2), band).map((v) => v * (0.9 + 0.15 * pnoise(x * 8, y * 8, z * 8, 3))); },
    mars: (x, y, z, lat) => { const n = pnoise(x * 3, y * 3, z * 3), dk = sm(0.5, 0.62, n), f = pnoise(x * 12, y * 12, z * 12, 3);
      let c = mixc(hex(0xc8693c), hex(0x7d4228), dk).map((v) => v * (0.85 + 0.3 * f)); const cap = sm(1.22, 1.3, Math.abs(lat) + (pnoise(x * 9, y * 9, z * 9, 2) - 0.5) * 0.12); return mixc(c, [0.95, 0.93, 0.9], cap); },
    jupiter: (x, y, z, lat, lon) => { const t = lat * 9 + (pnoise(x * 3, y * 3, z * 3) - 0.5) * 1.6, band = 0.5 + 0.5 * Math.sin(t * 2.3);
      let c = mixc(hex(0xa8754a), hex(0xf0e2c4), band); c = mixc(c, hex(0xd8b588), 0.35 * (0.5 + 0.5 * Math.sin(t * 5.1))); c = c.map((v) => v * (0.9 + 0.18 * pnoise(x * 14, y * 14, z * 14, 3)));
      const dx = (((lon - 1.0 + Math.PI) % (Math.PI * 2)) - Math.PI) * Math.cos(lat) / 0.17, dy = (lat + 0.38) / 0.085, e = dx * dx + dy * dy;
      return e < 1 ? mixc(c, hex(0xc4603e), (1 - e) * 1.4) : c; },
    saturn: (x, y, z, lat) => { const t = lat * 7 + (pnoise(x * 2, y * 2, z * 2) - 0.5) * 0.35, band = 0.5 + 0.5 * Math.sin(t * 2.2); return mixc(hex(0xcdb07a), hex(0xeedcae), band).map((v) => v * (0.95 + 0.08 * pnoise(x * 10, y * 10, z * 10, 2))); },
    uranus: (x, y, z, lat) => hex(0x9fd8e0).map((v) => v * (0.95 + 0.05 * Math.sin(lat * 10))),
    neptune: (x, y, z, lat, lon) => { let c = hex(0x3f62c8).map((v) => v * (0.9 + 0.12 * Math.sin(lat * 9 + pnoise(x * 3, y * 3, z * 3) * 2))); const dx = (((lon - 2.2 + Math.PI) % (Math.PI * 2)) - Math.PI) * Math.cos(lat) / 0.16, dy = (lat + 0.35) / 0.07; return dx * dx + dy * dy < 1 ? c.map((v) => v * 0.55) : c; },
  };
  const PLANETS = [
    { name: 'mercury', file: '2k_mercury.jpg', r: 2.4, d: 55, sp: 1.6, col: 0x8d8a86 },
    { name: 'venus', file: '2k_venus_atmosphere.jpg', r: 4.6, d: 85, sp: 1.2, col: 0xe2c690 },
    { name: 'earth', r: 5, d: 125, earth: true },
    { name: 'mars', file: '2k_mars.jpg', r: 3.3, d: 165, sp: 0.8, col: 0xb85e36 },
    { name: 'jupiter', file: '2k_jupiter.jpg', r: 15, d: 255, sp: 0.4, col: 0xd2b08a, big: true },
    { name: 'saturn', file: '2k_saturn.jpg', r: 12, d: 345, sp: 0.3, col: 0xdcc394, big: true, ring: true },
    { name: 'uranus', file: '2k_uranus.jpg', r: 7.5, d: 430, sp: 0.22, col: 0x9fd8e0 },
    { name: 'neptune', file: '2k_neptune.jpg', r: 7.2, d: 505, sp: 0.18, col: 0x4466cc },
  ];
  // 地球固定在這個位置:從地球看太陽的方向 = 相機最後靠近地球的方向往右轉約 50°(白天在右、夜晚在左,看得到城市燈光)
  const D_FINAL = new THREE.Vector3(0, 0.16, 1).normalize();
  const SUN_DIR = new THREE.Vector3(Math.sin(0.9), 0, Math.cos(0.9));                        // 從地球看太陽(世界方向)
  const EARTH_POS = SUN_DIR.clone().multiplyScalar(-125);
  const PLANET_DIR = new URL('./planets/', import.meta.url).href, ploader = new THREE.TextureLoader();
  const loadReal = (file, cb) => ploader.load(PLANET_DIR + file, (t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; cb(t); }, undefined, () => {});
  const sMats = [sunMat];
  const planetObjs = PLANETS.map((pl) => {
    const g = new THREE.Group(); sScene.add(g); pl.a0 = Math.random() * 6.283;
    if (!pl.earth) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(pl.r, 64, 40), new THREE.MeshStandardMaterial({ color: pl.col, roughness: 1, metalness: 0, transparent: true })); m.rotation.z = pl.name === 'uranus' ? 1.7 : 0.05; g.add(m); sMats.push(m.material); pl.mesh = m;
      if (pl.ring) {   // 土星環:C 環(淡)、B 環(最亮)、卡西尼縫、A 環 + 恩克縫
        const RI = 1.24, RO = 2.27, rc = document.createElement('canvas'); rc.width = 1024; rc.height = 4; const rg = rc.getContext('2d');
        for (let x2 = 0; x2 < 1024; x2++) { const rr = RI + (RO - RI) * x2 / 1024; let a = rr < 1.53 ? 0.18 : rr < 1.95 ? 0.85 : rr < 2.03 ? 0.04 : (rr > 2.2 && rr < 2.215) ? 0.05 : 0.6;
          a *= 0.8 + 0.2 * Math.sin(rr * 160) * Math.sin(rr * 37); const k = (rr - RI) / (RO - RI); rg.fillStyle = `rgba(${230 - k * 20 | 0},${212 - k * 30 | 0},${176 - k * 40 | 0},${Math.max(0, a)})`; rg.fillRect(x2, 0, 1, 4); }
        const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace;
        const rgeo = new THREE.RingGeometry(pl.r * RI, pl.r * RO, 160, 1), uv = rgeo.attributes.uv, pos = rgeo.attributes.position;
        for (let k = 0; k < pos.count; k++) { const rr = Math.hypot(pos.getX(k), pos.getY(k)); uv.setXY(k, (rr / pl.r - RI) / (RO - RI), 0.5); }
        const ring = new THREE.Mesh(rgeo, new THREE.MeshStandardMaterial({ map: rt, transparent: true, side: THREE.DoubleSide, depthWrite: false, roughness: 1, emissive: 0x6a5a40, emissiveIntensity: 0.25 }));
        ring.rotation.x = -Math.PI / 2 + 0.47; g.add(ring); sMats.push(ring.material);
        loadReal('2k_saturn_ring_alpha.png', (t) => { ring.material.map = t; ring.material.needsUpdate = true; }); }
    }
    // 軌道線(很細很淡)
    const pts = []; for (let k = 0; k <= 200; k++) { const a = k / 200 * Math.PI * 2; pts.push(new THREE.Vector3(Math.cos(a) * pl.d, 0, Math.sin(a) * pl.d)); }
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: pl.earth ? 0x7fb6ff : 0x8fa0d8, transparent: true, opacity: pl.earth ? 0.28 : 0.1, depthWrite: false }));
    line.material.userData.op = line.material.opacity; line.material.userData.line = true; sScene.add(line); sMats.push(line.material);
    return { pl, g };
  });
  // 行星貼圖:Solar System Scope(CC BY 4.0,放在 ./planets/);載不到的行星用下面程式畫的表面
  PLANETS.forEach((pl) => { if (pl.file) loadReal(pl.file, (t) => { pl.real = true; pl.mesh.material.map = t; pl.mesh.material.color.set(0xffffff); pl.mesh.material.needsUpdate = true; }); });
  let planetTexDone = false;
  const buildPlanetTex = () => { if (planetTexDone) return; planetTexDone = true;
    PLANETS.forEach((pl) => { if (pl.earth || pl.real) return; pl.mesh.material.map = planetTex(pl.big ? 512 : 256, pl.big ? 256 : 128, SHADES[pl.name]); pl.mesh.material.color.set(0xffffff); pl.mesh.material.needsUpdate = true; }); };
  (window.requestIdleCallback || ((f) => setTimeout(f, 1500)))(buildPlanetTex, { timeout: 4000 });
  const belt = makePoints(4000, (i, v, c) => { const r = 195 + Math.random() * 35, a = Math.random() * 6.283; v.set(Math.cos(a) * r, gauss() * 3, Math.sin(a) * r); c.setRGB(0.55, 0.5, 0.45).multiplyScalar(0.6 + Math.random() * 0.5); return 0.4 + Math.random() * 0.6; }, 0.22);
  sScene.add(belt);
  // 月亮(three.js 範例附的月球貼圖):太陽系那段繞著地球、地球那段在左上方的遠處
  const moonMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 1, metalness: 0, transparent: true }), eMoonMat = new THREE.MeshStandardMaterial({ color: 0xbfbfbf, roughness: 1, metalness: 0 });
  new THREE.TextureLoader().setCrossOrigin('anonymous').load(TEX + 'moon_1024.jpg', (t) => { t.colorSpace = THREE.SRGBColorSpace; [moonMat, eMoonMat].forEach((m) => { m.map = t; m.color.set(0xffffff); m.needsUpdate = true; }); }, undefined, () => {});
  const sMoon = new THREE.Mesh(new THREE.SphereGeometry(1.35, 48, 32), moonMat); sScene.add(sMoon); sMats.push(moonMat);

  // =====================================================================
  // 3. 地球(白天 / 夜晚城市燈光 / 海面反光 / 雲 / 大氣光暈);太陽系裡那顆地球用同一套材質
  // =====================================================================
  const eScene = new THREE.Scene();
  const eStars = starField(9000, 14000, 2600, 12); eScene.add(eStars);
  const eSun = sprite(0xfff1d0, 1800, 0.9); eSun.position.copy(SUN_DIR).multiplyScalar(15000); eScene.add(eSun);
  const eBand = milkyBand(12000, 7000, 12); eScene.add(eBand);
  const eMoon = new THREE.Mesh(new THREE.SphereGeometry(82, 64, 40), eMoonMat); eMoon.position.set(-1750, 620, -1900); eScene.add(eMoon);
  const eLight = new THREE.DirectionalLight(0xfff4e6, 3.2); eLight.position.copy(SUN_DIR).multiplyScalar(1000); eScene.add(eLight, new THREE.AmbientLight(0x223355, 0.05));
  // 載不到 NASA 貼圖時的替代:程式畫的海洋 + 大陸
  const fallbackDay = (() => { const c = document.createElement('canvas'); c.width = 512; c.height = 256; const g = c.getContext('2d'); g.fillStyle = '#0d2d5c'; g.fillRect(0, 0, 512, 256);
    for (let i = 0; i < 40; i++) { const x = Math.random() * 512, y = 40 + Math.random() * 176, rr = 10 + Math.random() * 40; g.fillStyle = ['#3d6b35', '#7a6a42', '#5b7a3a'][i % 3]; g.beginPath(); g.ellipse(x, y, rr, rr * 0.6, Math.random() * 3, 0, 7); g.fill(); }
    g.fillStyle = '#e8eef5'; g.fillRect(0, 0, 512, 16); g.fillRect(0, 240, 512, 16); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t; })();
  const black = new THREE.DataTexture(new Uint8Array([0, 0, 0, 255]), 1, 1); black.needsUpdate = true;
  const earthU = { uDay: { value: fallbackDay }, uNight: { value: black }, uSpec: { value: black }, uClouds: { value: black }, uSun: { value: SUN_DIR }, uFade: { value: 1 } };
  const loader = new THREE.TextureLoader(); loader.setCrossOrigin('anonymous');
  const loadTex = (name, key, srgb) => loader.load(TEX + name, (t) => { if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; earthU[key].value = t; }, undefined, () => {});
  let texLoaded = false;
  const loadEarth = () => { if (texLoaded) return; texLoaded = true; loadTex('earth_atmos_2048.jpg', 'uDay', true); loadTex('earth_lights_2048.png', 'uNight', true); loadTex('earth_specular_2048.jpg', 'uSpec', false); loadTex('earth_clouds_1024.png', 'uClouds', false); };
  const EV = `varying vec2 vUv; varying vec3 vN, vW; void main() { vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`;
  const earthMat = new THREE.ShaderMaterial({ uniforms: earthU, transparent: true, vertexShader: EV,
    fragmentShader: `uniform sampler2D uDay, uNight, uSpec; uniform vec3 uSun; uniform float uFade; varying vec2 vUv; varying vec3 vN, vW;
      void main() { vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float ndl = dot(N, uSun);
        vec3 day = texture2D(uDay, vUv).rgb, night = texture2D(uNight, vUv).rgb;
        float dm = smoothstep(-0.12, 0.25, ndl);
        vec3 col = day * (max(ndl, 0.0) * 1.25 + 0.02);
        vec3 H = normalize(uSun + V); col += texture2D(uSpec, vUv).r * pow(max(dot(N, H), 0.0), 45.0) * vec3(1.0, 0.95, 0.85) * 0.7 * dm;
        col = mix(night * vec3(1.0, 0.82, 0.55) * 1.6, col, dm);
        float fr = pow(1.0 - max(dot(N, V), 0.0), 3.0); col += vec3(0.3, 0.6, 1.0) * fr * 0.55 * smoothstep(-0.3, 0.5, ndl);
        gl_FragColor = vec4(col, uFade);
        #include <colorspace_fragment>
      }` });
  const cloudMat = new THREE.ShaderMaterial({ uniforms: earthU, transparent: true, depthWrite: false, vertexShader: EV,
    fragmentShader: `uniform sampler2D uClouds; uniform vec3 uSun; uniform float uFade; varying vec2 vUv; varying vec3 vN, vW;
      void main() { vec3 N = normalize(vN); float ndl = dot(N, uSun); vec4 ct = texture2D(uClouds, vUv); float c = ct.a * dot(ct.rgb, vec3(0.333));   // 雲貼圖的形狀在 alpha
        gl_FragColor = vec4(vec3(1.0) * (max(ndl, 0.0) * 1.1 + 0.03), c * 0.62 * uFade * (smoothstep(-0.25, 0.2, ndl) * 0.85 + 0.15));
        #include <colorspace_fragment>
      }` });
  const atmoMat = new THREE.ShaderMaterial({ uniforms: earthU, transparent: true, depthWrite: false, side: THREE.BackSide, blending: THREE.AdditiveBlending, vertexShader: EV,
    fragmentShader: `uniform vec3 uSun; uniform float uFade; varying vec2 vUv; varying vec3 vN, vW;
      void main() { vec3 N = normalize(vN), V = normalize(cameraPosition - vW); float k = pow(max(0.0, 0.72 + dot(N, V)), 3.5);
        gl_FragColor = vec4(vec3(0.3, 0.6, 1.0) * k * (0.25 + 0.9 * smoothstep(-0.4, 0.5, dot(N, uSun))) * uFade, 1.0);
        #include <colorspace_fragment>
      }` });
  const makeEarth = (rad) => {
    const tilt = new THREE.Group(); tilt.rotation.z = 0.41;                                    // 地軸傾斜 23.5°
    const spin = new THREE.Group(); tilt.add(spin);
    const e = new THREE.Mesh(new THREE.SphereGeometry(rad, 96, 64), earthMat); spin.add(e);
    const cl = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.012, 96, 64), cloudMat); cl.renderOrder = 1; tilt.add(cl);
    const at = new THREE.Mesh(new THREE.SphereGeometry(rad * 1.07, 64, 48), atmoMat); at.renderOrder = 2; tilt.add(at);
    return { tilt, spin, cl };
  };
  const EY = 140;                                                                            // 地球在最後構圖裡往上抬,不會被正前方的面板擋住
  const bigEarth = makeEarth(ER); bigEarth.tilt.position.y = EY; eScene.add(bigEarth.tilt);
  const smallEarth = makeEarth(PLANETS[2].r); smallEarth.tilt.position.copy(EARTH_POS); sScene.add(smallEarth.tilt);
  planetObjs[2].g.position.copy(EARTH_POS);
  // 面板走的軌道:一圈很淡的光環
  const ringLine = new THREE.Mesh(new THREE.TorusGeometry(R, 1.2, 6, 256), new THREE.MeshBasicMaterial({ color: 0x9fb8ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  ringLine.rotation.x = Math.PI / 2; ringLine.position.y = RY - PH / 2 - 30; eScene.add(ringLine);

  // ---------- 面板(CSS3D)----------
  const cssScene = new THREE.Scene(), ring = new THREE.Group(); cssScene.add(ring);
  const panels = slides.map((sl, i) => {
    const el = document.createElement('div'); el.className = `opanel op-${sl.key}`; el.style.setProperty('--c', sl.color); el.style.width = PW + 'px'; el.style.height = PH + 'px';
    const head = sl.key === 'hero'
      ? `<div class="oph"><img class="opicon" src="/assets/icon-180.png" alt=""><div class="eyebrow">WELCOME</div><h3>${sl.title}</h3><p>${sl.text}</p><div class="zh">${sl.zh}</div></div>`
      : `<div class="oph"><div class="eyebrow">${String(i).padStart(2, '0')} · ${sl.eyebrow}</div><h3>${sl.title}</h3><p>${sl.text}</p><div class="zh">${sl.zh}</div>` +
        (sl.cta ? `<a class="store" href="${APP_STORE}"> Download on the App Store</a>` : '') + `</div>`;
    el.innerHTML = `${head}<div class="opw"><div class="wgin"></div></div><div class="opshine"></div>`;
    el.addEventListener('click', () => { if (atEarth() && i !== cur()) goTo(i); });
    const obj = new CSS3DObject(el); const a = i * STEP;
    obj.position.set(Math.sin(a) * R, RY, Math.cos(a) * R); obj.rotation.y = a; ring.add(obj);
    return { el, obj, key: sl.key, host: el.querySelector('.wgin'), stop: null };
  });

  // ---------- 狀態 / 互動 ----------
  let open = false, angle = 0, target = 0, active = -1, t0 = performance.now(), last = t0, raf = 0, covering = false;
  let p = 0, pT = 0, exitAcc = 0, lastRot = 0;
  const mouse = { x: 0, y: 0, sx: 0, sy: 0 };
  const atEarth = () => pT >= 1 && p > 0.985;
  const cur = () => ((Math.round(-target / STEP) % N) + N) % N;
  const settled = () => Math.abs(target - Math.round(target / STEP) * STEP) < 1e-3 && Math.abs(angle - target) < 0.02;
  function goTo(i) { const k = Math.round(-target / STEP); let d = ((i - ((k % N) + N) % N) % N + N) % N; if (d > N / 2) d -= N; target = -(k + d) * STEP; lastRot = performance.now(); }
  function rotate(dir) { target = (Math.round(target / STEP) - dir) * STEP; lastRot = performance.now(); }
  // ‹ › 按鈕 / 方向鍵:旅程中跳到下一站(銀河 → 太陽系全景 → 地球);在地球上轉面板,第一塊再往回 = 回太陽系;在銀河再往回 = 回房間
  function step(dir) {
    if (intro) return;
    if (atEarth()) { if (dir < 0 && cur() === 0) { pT = OVERVIEW; return; } rotate(dir); return; }
    const stops = [0, OVERVIEW, 1];
    if (dir > 0) pT = stops.find((s) => s > pT + 0.01) ?? 1;
    else { if (pT <= 0.01) { onExit && onExit(); return; } pT = [...stops].reverse().find((s) => s < pT - 0.01) ?? 0; }
  }
  function setActive(i) {
    if (i === active) return;
    if (active >= 0 && panels[active].stop) { panels[active].stop(); panels[active].stop = null; panels[active].host.innerHTML = ''; }
    active = i; if (i < 0) { panels.forEach((q) => q.el.classList.remove('front')); return; }
    const pp = panels[i];
    if (pp.key !== 'hero' && pp.key !== 'app') pp.stop = mountWidget(pp.key, pp.host);
    else if (pp.key === 'app') pp.host.innerHTML = `<div class="qr"><img src="/assets/icon-180.png" alt=""><span>App Store · free</span></div>`;
    panels.forEach((q, k) => q.el.classList.toggle('front', k === i)); dots.forEach((d, k) => d.classList.toggle('on', k === i));
  }
  // 滾輪:旅程中 = 往前 / 往後飛;到了地球 = 轉面板(停下來 160ms 後對齊最近一塊)
  let snapTimer = 0;
  root.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    // 進來時那一下滾動(含觸控板放開後的慣性)不算:要等滾輪停 0.35 秒以上、重新開始滾,才開始旅程 → 不會一進來就被慣性甩進去、顆粒亂噴
    // 用事件本身的時間(真的滾動的時間)算間隔:剛進來第一幀會卡一下(編譯 shader),卡住期間累積的滾動會一次送進來,用處理時間算會誤判成「停過」
    const nowW = e.timeStamp || performance.now();
    if (intro || wheelGate) { if (!intro && performance.now() - readyAt > 600 && nowW - lastWheel > 350) wheelGate = false; else { lastWheel = nowW; return; } }
    lastWheel = nowW;
    const d = Math.max(-90, Math.min(90, Math.abs(e.deltaY) > Math.abs(e.deltaX) ? e.deltaY : e.deltaX));
    if (atEarth()) {
      if (d < 0 && cur() === 0 && settled() && performance.now() - lastRot > 600) { pT = 0.995 + d / 2200; return; }   // 在第一塊再往上 → 離開地球
      target -= d * 0.0032; lastRot = performance.now(); clearTimeout(snapTimer); snapTimer = setTimeout(() => { target = Math.round(target / STEP) * STEP; }, 160); return;
    }
    if (pT <= 0 && d < 0) { exitAcc += -d; if (exitAcc > 260) { exitAcc = 0; onExit && onExit(); } return; }
    exitAcc = 0; pT = Math.max(0, Math.min(1, Math.max(p - 0.3, Math.min(p + 0.3, pT + d / 2200))));   // 目標最多領先目前位置 0.3,不會一次衝到底
  }, { passive: false });
  // 拖曳:旅程中上下拖 = 往前 / 往後飛;在地球上左右拖 = 轉面板
  let drag = null;
  root.addEventListener('pointerdown', (e) => { if (e.target.closest('a, button, canvas.wgc, .tabs, .ostages')) return; if (intro) return; drag = { x: e.clientX, y: e.clientY, t: target, pT, moved: false, earth: atEarth() }; });
  window.addEventListener('pointermove', (e) => {
    mouse.x = e.clientX / innerWidth * 2 - 1; mouse.y = e.clientY / innerHeight * 2 - 1;
    if (!drag || !open) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 6) drag.moved = true;
    if (!drag.moved) return;
    if (drag.earth) { const d = Math.abs(dx) > Math.abs(dy) * 0.8 || e.pointerType !== 'touch' ? dx : -dy; target = drag.t + d * 0.0042; lastRot = performance.now(); }
    else pT = Math.max(0, Math.min(1, drag.pT - dy / (innerHeight * 2.2)));
  });
  window.addEventListener('pointerup', () => { if (drag) { if (drag.moved && drag.earth) target = Math.round(target / STEP) * STEP; drag = null; } });
  root.addEventListener('click', (e) => { if (drag && drag.moved) e.stopPropagation(); }, true);

  function resize() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    renderer.setPixelRatio(dpr); renderer.setSize(w, h, false); css.setSize(w, h);
    camera.aspect = w / h; camera.updateProjectionMatrix();
    allPoints.forEach((pp) => { pp.material.uniforms.uPR.value = dpr; });
  }
  addEventListener('resize', () => { if (open) resize(); });

  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), look = new THREE.Vector3();
  const setCam = (pos, tgt, near, far) => { camera.position.copy(pos); camera.near = near; camera.far = far; camera.updateProjectionMatrix(); camera.lookAt(tgt); };
  const slerpDir = (a, b, k, out) => out.copy(a).lerp(b, k).normalize();
  let intro = null, earthSpin = 2.6;
  function frame(now) {
    if (!open) return; raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000), t = (now - t0) / 1000; last = now; pPrev = p;
    // ready:放大完成後 1.5 秒內顆粒慢慢出現;mv:只有真的在飛的時候才是 1(光速線只在這時候出現,停下來 0.3 秒內收掉)
    const ready = intro ? 0 : ss(0, 1500, now - readyAt);
    // 旅程速度有上限:滑鼠滑很快也照正常速度飛(整趟至少約 8 秒),慢慢滑就跟著滑、尾端緩下來
    { const MAXV = 0.12, d = (pT - p) * Math.min(1, dt * 2.2); p += Math.max(-MAXV * dt, Math.min(MAXV * dt, d)); if (Math.abs(pT - p) < 1e-4) p = pT; }
    // 進場:一開始畫面只露出房間電腦螢幕那一塊(位置、大小一模一樣),鏡頭的視野也對齊那一塊;約 1.1 秒內擴大到整個畫面 → 像是穿進螢幕
    const W = innerWidth, H = innerHeight; let camAspect = W / H;
    if (intro) {
      const k = ease((now - intro.t0) / 1100), r = intro.rect, rx = r.x * (1 - k), ry = r.y * (1 - k), rw = r.w + (W - r.w) * k, rh = r.h + (H - r.h) * k;
      camAspect = rw / rh; camera.aspect = camAspect; camera.setViewOffset(rw, rh, -rx, -ry, W, H);
      root.style.clipPath = `inset(${ry.toFixed(1)}px ${(W - rx - rw).toFixed(1)}px ${(H - ry - rh).toFixed(1)}px ${rx.toFixed(1)}px round ${(8 * (1 - k)).toFixed(1)}px)`;
      if (k >= 1) { intro = null; camera.clearViewOffset(); camera.aspect = W / H; root.style.clipPath = ''; covering = true; readyAt = now; }
    }
    const aspect = W / H, portrait = aspect < 0.8, fit = Math.max(1, 1.3 / camAspect);
    { const vNow = Math.abs(p - pPrev) / Math.max(dt, 1e-3), target2 = ss(0.004, 0.03, vNow); mv += (target2 - mv) * Math.min(1, dt * (target2 > mv ? 8 : 5)); }
    allPoints.forEach((pp) => { pp.material.uniforms.uTime.value = t; });
    const gF = 1 - ss(S_START, G_END, p), sF = ss(S_START, G_END, p) * (1 - ss(E_START, S_END, p)), eF = ss(E_START, S_END, p), rv = ss(REVEAL, 1.0, p);
    renderer.clear();
    // ---- 1. 銀河:從遠處看整個銀河 → 飛向太陽所在的旋臂(從外側往內看,銀河中心在太陽後面)----
    if (gF > 0.001) {
      gal.update(now / 1000, gF, renderer.domElement.height);
      gal.root.updateMatrixWorld(true); sunW.copy(gal.sunLocal).applyMatrix4(gal.disk.matrixWorld);
      diskN.set(0, 1, 0).transformDirection(gal.disk.matrixWorld);
      const gp = Math.min(1, p / G_END), k = ease(gp);
      const start = v1.copy(GAL_CAM.pos).multiplyScalar(fit);
      const dirEnd = v2.copy(sunW).normalize().addScaledVector(diskN, 0.45).normalize();
      const dir = slerpDir(start.clone().sub(sunW).normalize(), dirEnd, ss(0.1, 0.9, gp), new THREE.Vector3());
      const dist = lerpLog(start.distanceTo(sunW), 2.5, k);
      look.set(0, 0, 0).lerp(sunW, ss(0, 0.55, gp));
      setCam(sunW.clone().addScaledVector(dir, dist), look, 0.3, 20000);
      // 星塵:跟著相機;速度 = 這一幀旅程進度變化的快慢
      const v = Math.abs(p - pPrev) / Math.max(dt, 1e-3); warp.spd += (v - warp.spd) * Math.min(1, dt * 4);
      warp.pts.position.copy(camera.position); warp.pts.quaternion.copy(camera.quaternion); warp.pts.scale.setScalar(Math.max(3, dist * 0.9));
      warp.m.uniforms.uOff.value += dt * (0.06 + warp.spd * 9); warp.m.uniforms.uViewH.value = renderer.domElement.height;
      warp.m.uniforms.uAmt.value = Math.min(1, 0.2 + warp.spd * 16) * (1 - ss(0.88, 1, gp)) * gF * ready;   // 停著的時候還是有一點顆粒在飄
      // 銀河段也有光速線:捲動時才出現,捲越快越長越亮
      if (!gStreak) gStreak = makeStreaks(gScene);
      const gAmt = Math.min(1, warp.spd * 12) * mv * (1 - ss(0.9, 1, gp)) * gF * ready;
      gStreak.obj.visible = gAmt > 0.01; gStreak.obj.position.copy(camera.position); gStreak.obj.quaternion.copy(camera.quaternion); gStreak.obj.scale.setScalar(Math.max(3, dist * 0.9));
      gStreak.m.uniforms.uOff.value += dt * (0.08 + warp.spd * 11); gStreak.m.uniforms.uLen.value = Math.min(0.5, 0.02 + warp.spd * 3.2); gStreak.m.uniforms.uAmt.value = gAmt;
      gal.coreGlow.material.opacity *= 1 - ss(0.15, 0.6, gp); gal.diskGlow.material.opacity *= 1 - ss(0.15, 0.6, gp);   // 靠近之後核心 / 盤面的柔光是一大片平面,淡掉(核心的星星還在)
      sunMark.material.opacity = ss(0.3, 0.9, gp) * gF; sunMark.scale.setScalar(dist * 0.045);          // 太陽:畫面上一直是一顆小亮星(約 2.5°),交接時剛好接上太陽系那顆
      if (galRT.width !== renderer.domElement.width || galRT.height !== renderer.domElement.height) galRT.setSize(renderer.domElement.width, renderer.domElement.height);
      renderer.setRenderTarget(galRT); renderer.setClearColor(0x020309, 1); renderer.clear(); renderer.render(gScene, camera); renderer.setRenderTarget(null);
      postMat.uniforms.uRes.value.set(innerWidth, innerHeight); postMat.uniforms.uTime.value = t; renderer.render(postScene, postCam);
    }
    // ---- 2. 太陽系:太陽從一個亮點開始 → 看到八大行星全景 → 飛向地球 ----
    planetObjs.forEach(({ pl, g }) => { if (!pl.earth) { const a = pl.a0 + t * pl.sp * 0.05; g.position.set(Math.cos(a) * pl.d, 0, Math.sin(a) * pl.d); g.rotation.y = t * 0.3; } });
    // 讓台灣 / 東亞在白天、正對鏡頭(貼圖經度 121°E 轉到相機方向偏向太陽一點),然後很慢地自轉
    sMoon.position.copy(EARTH_POS).add(v2.set(Math.cos(t * 0.05 + 2.4) * 13, 1.5, Math.sin(t * 0.05 + 2.4) * 13)); sMoon.rotation.y = t * 0.05;
    if (p > 0.66) earthSpin += dt * 0.045;                                                  // 地球自轉(快到地球時開始轉,一圈約 2 分 20 秒),一開始台灣在正前方偏左,會慢慢轉過來
    const spin = earthSpin; smallEarth.spin.rotation.y = bigEarth.spin.rotation.y = spin; smallEarth.cl.rotation.y = bigEarth.cl.rotation.y = spin + t * 0.003;
    if (sF > 0.001) {
      const sp = Math.max(0, Math.min(1, (p - S_START) / (S_END - S_START))), a = Math.min(1, sp / 0.45), b = Math.max(0, (sp - 0.45) / 0.55);
      const dirA = v1.set(0, 0.35, 1).normalize(), dirB = new THREE.Vector3(0.35, 0.75, 1).normalize(), ovDist = 1250 * fit;
      let pos, tgt;
      if (b <= 0) { pos = slerpDir(dirA, dirB, ease(a), new THREE.Vector3()).multiplyScalar(lerpLog(5000 * fit, ovDist, ease(a))); tgt = new THREE.Vector3(); }
      else {
        const ov = dirB.clone().multiplyScalar(ovDist), rel = ov.clone().sub(EARTH_POS), kb = ease(b);
        const dir = slerpDir(rel.clone().normalize(), D_FINAL, ss(0.2, 1, b), new THREE.Vector3());
        pos = EARTH_POS.clone().addScaledVector(dir, lerpLog(rel.length(), PLANETS[2].r * 5, kb));
        tgt = new THREE.Vector3().lerp(EARTH_POS, ss(0, 0.45, b));
      }
      setCam(pos, tgt, 0.2, 60000);
      // 光速線:跳進太陽系那一刻(p ≈ 0.41)最強;之後在太陽系裡捲得快也會出現
      if (!sStreak) sStreak = makeStreaks(sScene);
      const jump = Math.exp(-Math.pow((p - 0.41) / 0.045, 2)), sv = Math.abs(p - pPrev) / Math.max(dt, 1e-3); sStreak.spd += (sv - sStreak.spd) * Math.min(1, dt * 4);
      const sAmt = Math.min(1, jump * 1.2 + sStreak.spd * 9) * mv * sF * ready;           // 停在中間時不出現光速線
      sStreak.obj.visible = sAmt > 0.01; sStreak.obj.position.copy(camera.position); sStreak.obj.quaternion.copy(camera.quaternion); sStreak.obj.scale.setScalar(Math.max(4, pos.distanceTo(tgt) * 0.9));
      sStreak.m.uniforms.uOff.value += dt * (0.08 + jump * 2.4 + sStreak.spd * 10); sStreak.m.uniforms.uLen.value = Math.min(0.55, 0.02 + jump * 0.45 + sStreak.spd * 3); sStreak.m.uniforms.uAmt.value = sAmt;
      if (!sWarp) sWarp = makeWarp(sScene, 3200);                                                // 太陽系段也有星塵
      sWarp.pts.position.copy(camera.position); sWarp.pts.quaternion.copy(camera.quaternion); sWarp.pts.scale.setScalar(Math.max(4, pos.distanceTo(tgt) * 0.9));
      sWarp.m.uniforms.uOff.value += dt * (0.05 + jump * 1.6 + sStreak.spd * 8); sWarp.m.uniforms.uViewH.value = renderer.domElement.height;
      sWarp.m.uniforms.uAmt.value = Math.min(1, 0.12 + (jump * 1.2 + sStreak.spd * 14) * mv) * sF * ready;
      const lineFade = 1 - ss(0.5, 0.9, b);                                            // 靠近地球時軌道線淡掉,不會橫過地球
      sMats.forEach((m) => { m.opacity = (m.userData.op ?? 1) * sF * (m.userData.line ? lineFade : 1); });
      sunMat.uniforms.uTime.value = t; sunMat.uniforms.uFade.value = sF; sunGlow1.material.opacity = 0.85 * sF; sunGlow2.material.opacity = 0.35 * sF * (1 - ss(0.05, 0.5, b)); sunGlow3.material.opacity = 0.12 * sF * (1 - ss(0.05, 0.5, b));   // 飛向地球時太陽的大光暈淡掉,畫面才不會一片棕 sBand.material.uniforms.uFade.value = sF; sStars.material.uniforms.uFade.value = sF; belt.material.uniforms.uFade.value = sF;
      earthU.uFade.value = sF; renderer.clearDepth(); renderer.render(sScene, camera);
    }
    // ---- 3. 地球:接手時地球在畫面上的大小和太陽系那顆一樣 → 拉回到最後的構圖,面板浮現 ----
    if (eF > 0.001) {
      const ep = Math.max(0, Math.min(1, (p - E_START) / (1 - E_START))), k = ss(0.15, 1, ep);
      const tanH = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      const dist = R + (portrait ? PW / (0.88 * 2 * tanH * aspect) : Math.max(PH / (0.66 * 2 * tanH), PW / (0.44 * 2 * tanH * aspect)));
      mouse.sx += (mouse.x - mouse.sx) * 0.05; mouse.sy += (mouse.y - mouse.sy) * 0.05;
      const fin = portrait ? new THREE.Vector3(mouse.sx * 40, 200, dist) : new THREE.Vector3(mouse.sx * 90 * rv, 330 - mouse.sy * 50 * rv, dist);
      const finLook = new THREE.Vector3(0, portrait ? RY - 90 : RY - 110, 0);
      const startPos = D_FINAL.clone().multiplyScalar(ER * 5); startPos.y += EY;
      setCam(startPos.lerp(fin, k), new THREE.Vector3(0, EY, 0).lerp(finLook, k), 10, 60000);
      earthU.uFade.value = eF; eStars.material.uniforms.uFade.value = eF; eBand.material.uniforms.uFade.value = eF; eMoon.visible = eF > 0.5; eSun.material.opacity = 0.9 * eF; ringLine.material.opacity = 0.35 * rv;
      renderer.clearDepth(); renderer.render(eScene, camera);
    }
    // ---- 面板:到地球才出現 ----
    angle += (target - angle) * Math.min(1, dt * 6); ring.rotation.y = angle;
    if (rv > 0.001) {
      cssLayer.style.visibility = 'visible';
      if (rv > 0.95) setActive(cur()); else setActive(-1);
      panels.forEach((pp, i) => { const a = i * STEP + angle, f = Math.cos(a);
        const op = (f > -0.1 ? 0.35 + 0.65 * Math.pow((f + 0.1) / 1.1, 1.6) : Math.max(0, (f + 0.45) / 0.35) * 0.35) * rv;
        pp.el.style.opacity = op.toFixed(3); pp.el.style.pointerEvents = op > 0.3 && rv > 0.95 ? 'auto' : 'none'; pp.obj.position.y = RY + Math.sin(t * 0.8 + i * 1.3) * 8 - (1 - rv) * 160; });
      css.render(cssScene, camera);
    } else { cssLayer.style.visibility = 'hidden'; setActive(-1); }
    // ---- 介面:目前在哪一站、提示文字;面板的點點只在地球顯示 ----
    const stage = p < (S_START + G_END) / 2 ? 0 : p < (E_START + S_END) / 2 ? 1 : 2;
    stageEls.forEach((s, k) => s.classList.toggle('on', k === stage));
    dotsEl.style.opacity = rv.toFixed(2); dotsEl.style.pointerEvents = rv > 0.95 ? 'auto' : 'none';
    const hint = atEarth() ? 'Scroll or drag to explore · 滾動或拖曳瀏覽' : 'Scroll down to travel · 往下捲動前進';
    if (hintEl.textContent !== hint) hintEl.textContent = hint;
  }
  return {
    get open() { return open; }, get covering() { return covering; }, get progress() { return p; },
    show(rect) { if (open) return; open = true; loadEarth(); earthSpin = 2.6; mv = 0; readyAt = performance.now(); wheelGate = true; lastWheel = performance.now(); root.classList.add('on'); resize(); p = pT = 0; exitAcc = 0; target = angle = 0; active = -1; last = t0 = performance.now();
      intro = rect && rect.w > 20 ? { rect, t0: performance.now() } : null; if (!intro) setTimeout(() => { if (open) covering = true; }, 700);
      raf = requestAnimationFrame(frame); },
    hide() { open = false; covering = false; intro = null; camera.clearViewOffset(); root.style.clipPath = ''; root.classList.remove('on'); cancelAnimationFrame(raf); panels.forEach((pp) => { if (pp.stop) { pp.stop(); pp.stop = null; } pp.host.innerHTML = ''; }); active = -1; },
    step, goTo, exit: onExit, travel(v) { pT = Math.max(0, Math.min(1, v)); },
  };
}
