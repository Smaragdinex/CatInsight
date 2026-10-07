// CatInsight Stock — 等軸測小房間(參考 threejs-journey 的 lessons 房間,糖果色)
// 全部用 Three.js 幾何堆出來,貓用 /assets/cat2_web.glb;螢幕是一張會動的股票線圖(CanvasTexture)。
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import { buildSlides, activateSlide, deactivate } from './intro.mjs?v=12';
// 捲動版介紹(網址加 ?story):往下捲 = 往前播,桌上的手機當主角(story.mjs)。沒加就是原本「飛到電腦螢幕 → 一頁一頁」的版本
const STORY = new URLSearchParams(location.search).has('story');
// 畫面濾鏡:發光物的光暈、調色、暗角、底片顆粒(預設開;網址加 ?nofx 看沒有濾鏡的樣子)
const FX = !new URLSearchParams(location.search).has('nofx');
let composer = null, fxGrade = null;
let story = null;

// ---------- 配色(參考圖) ----------
const C = {
  bg: 0x2a1f4e,
  slab: 0xe6c6d6, slabSide: 0xd7b3c8, plank: 0xf0d6e2, plankDark: 0xe4c4d4,
  wallL: 0xd9c4f0, wallLSide: 0xc3a8e6, wallR: 0xf0619c, wallRSide: 0xd94f88,
  shelf: 0xf1d7e4, pillar: 0xe8d3ec,
  rug: 0x46bfcf,
  desk: 0xf7e2ec, deskLeg: 0xf3c9db,
  monitor: 0x4a3d7c, monitorEdge: 0x3a2f63, stand: 0xcfc0e6,
  chair: 0xf7a24a, chairDark: 0xef7b3a, chairPost: 0xe9d6e8,
  arcade: 0xb89ad3, arcadeTop: 0xf27a5a, arcadeStripe: 0xfff2f5, arcadeScreen: 0x5a4d80,
  plant: 0x3fc9c0, plantDark: 0x2fb0a8,
  board: 0x8f6bf0, wheel: 0xf27a5a,
  bowl: 0x3aa8b8, cat: 0x2f2740,
  wire1: 0xf08ac0, wire2: 0x53d5b9,
  balls: [0xff6f91, 0x8f6bf0, 0xffb84d, 0x46bfcf, 0xff8a65, 0xa78bfa],
  camera: 0xf3e6f0, cameraLens: 0xffffff, tripod: 0xf27a5a,
};

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, stencil: true });   // stencil:窗外夜景只畫在開口範圍內
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
const CAM_TARGET = new THREE.Vector3(0, 1.55, 0);
camera.position.set(9.6, 7.0, 9.6);
camera.lookAt(CAM_TARGET);

const controls = new OrbitControls(camera, canvas);
controls.target.copy(CAM_TARGET);
controls.enableZoom = false;
controls.enablePan = false;
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minPolarAngle = 0.95;
controls.maxPolarAngle = 1.32;
controls.minAzimuthAngle = 0.30;
controls.maxAzimuthAngle = 1.27;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.35;

// ---------- 燈光 ----------
// 三層光:粉紫環境光(整體)、暖橘桌燈 / 層板燈(局部、下面跟物件一起加)、青藍螢幕光。主光(日光)調弱,局部光才看得出層次
scene.add(new THREE.HemisphereLight(0xffd9ee, 0x4a3a86, 0.55));
const key = new THREE.DirectionalLight(0xfff0e0, 1.3);
key.position.set(6, 10, 4);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1; key.shadow.camera.far = 40;
key.shadow.camera.left = -8; key.shadow.camera.right = 8;
key.shadow.camera.top = 8; key.shadow.camera.bottom = -8;
key.shadow.bias = -0.0015;
key.shadow.normalBias = 0.06;   // 圓角面自遮陰影(acne)容易閃,偏移拉大
scene.add(key);
const fill = new THREE.DirectionalLight(0xc9b4ff, 0.35);
fill.position.set(-6, 5, 6);
scene.add(fill);

// ---------- 小工具 ----------
const mat = (color, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.85, metalness: 0.0, ...extra });
const root = new THREE.Group();
root.rotation.y = Math.PI / 2;   // 讓淡紫框牆在左、粉牆在右(鏡頭從前方 45° 看)
scene.add(root);
const animated = [];   // 進場動畫用:每個物件 scale 從 0 長出來
let livePoster = null, liveN = 0;   // 牆上會動的照片:每幀重畫的函式
const idleAnims = [];               // 每幀呼叫的小動畫:植物隨風輕擺(黃金葛、龜背芋)、水晶球裡的星雲

function box(w, h, d, color, { x = 0, y = 0, z = 0, r = 0.06, parent = root, shadow = true, seg = 3, ry = 0, rz = 0, rx = 0 } = {}) {
  const g = r > 0 ? new RoundedBoxGeometry(w, h, d, seg, Math.min(r, w / 2, h / 2, d / 2)) : new THREE.BoxGeometry(w, h, d);
  const m = new THREE.Mesh(g, mat(color));
  m.position.set(x, y, z);
  m.rotation.set(rx, ry, rz);
  m.castShadow = shadow; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function cyl(rt, rb, h, color, { x = 0, y = 0, z = 0, parent = root, seg = 24, rx = 0, rz = 0 } = {}) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat(color));
  m.position.set(x, y, z); m.rotation.set(rx, 0, rz);
  m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
function sphere(rad, color, { x = 0, y = 0, z = 0, parent = root } = {}) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(rad, 24, 18), mat(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  parent.add(m);
  return m;
}
// 淺色橡木的木紋貼圖(程式畫的):along = 'u' 紋路橫向、'v' 紋路直向;幾個小木節
function woodTex(w, h, along, base = '#e9cfa6', ink = [150, 105, 60]) {   // base:木頭底色、ink:木紋線的顏色(深一點的木頭用深一點的線)
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h; const g = cv.getContext('2d');
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  const L = along === 'u' ? w : h, S = along === 'u' ? h : w;
  for (let i = 0; i < 70; i++) {
    const o = Math.random() * S, amp = 2 + Math.random() * 6, fr = 0.004 + Math.random() * 0.01, ph = Math.random() * 6, a = 0.06 + Math.random() * 0.12;
    g.strokeStyle = `rgba(${ink[0] + Math.random() * 30 | 0},${ink[1] + Math.random() * 25 | 0},${ink[2] + Math.random() * 20 | 0},${a})`; g.lineWidth = 0.6 + Math.random() * 1.6; g.beginPath();
    for (let t = 0; t <= L; t += 8) { const q = o + Math.sin(t * fr + ph) * amp + Math.sin(t * fr * 3.7 + ph) * amp * 0.3; along === 'u' ? (t ? g.lineTo(t, q) : g.moveTo(t, q)) : (t ? g.lineTo(q, t) : g.moveTo(q, t)); }
    g.stroke();
  }
  for (let k = 0; k < 2; k++) { const x = Math.random() * w, y = Math.random() * h, gr = g.createRadialGradient(x, y, 0, x, y, 9); gr.addColorStop(0, 'rgba(120,80,45,.55)'); gr.addColorStop(1, 'rgba(120,80,45,0)'); g.fillStyle = gr; g.fillRect(x - 12, y - 12, 24, 24); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function group(x = 0, y = 0, z = 0, parent = root) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); animated.push(g); return g;
}

// ---------- 房間本體 ----------
const S = 6.4;            // 地板邊長
const T = 0.42;           // 牆厚
const H = 4.8;            // 牆高
// 底座(厚厚一塊)
box(S, 0.55, S, C.slab, { y: -0.275, r: 0.05, seg: 2 });
// 木地板:12 排,每排切成長短不一、接縫錯開的木板(邊緣小倒角看得到縫);蜂蜜色橡木三種深淺隨機混,每塊木紋起點不同
{
  const TONES = [['#d9a676', [120, 72, 38]], ['#cf9b6a', [110, 66, 34]], ['#e2b386', [128, 80, 44]]];
  const bases = TONES.map(([b, ink]) => woodTex(2048, 96, 'u', b, ink));
  const ROWS = 12, W = S - 0.2, RW = W / ROWS, GAP = 0.012;
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let r = 0; r < ROWS; r++) {
    const z = -S / 2 + 0.1 + (r + 0.5) * RW;
    let x = -W / 2 - rnd() * 1.4;                                  // 每排從不同的位置開始,接縫才會錯開
    while (x < W / 2) {
      const len = 1.1 + rnd() * 1.5, x0 = Math.max(-W / 2, x), x1 = Math.min(W / 2, x + len);
      if (x1 - x0 > 0.08) {
        const tex = bases[Math.floor(rnd() * 3)].clone(); tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.repeat.set((x1 - x0) / 3.2, 1); tex.offset.set(rnd(), 0); tex.needsUpdate = true;
        const pl = new THREE.Mesh(new RoundedBoxGeometry(x1 - x0 - GAP, 0.05, RW - GAP, 1, 0.006), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62 }));
        pl.position.set((x0 + x1) / 2, 0.025, z); pl.receiveShadow = true; root.add(pl);
      }
      x += len;
    }
  }
}
// 右牆(粉紅,實心)
box(T, H, S, C.wallR, { x: S / 2 - T / 2, y: H / 2, r: 0.04, seg: 2 });
// 左牆(淡紫):做成有大開口的框:兩根柱子 + 上梁 + 下座,中間再一根細柱與兩層層架
const L = { z: -S / 2 + T / 2 };
box(S - T, 0.9, T, C.wallL, { x: -T / 2, y: H - 0.45, z: L.z, r: 0.04, seg: 2 });   // 上梁(只到粉牆內側,不穿進粉牆,避免共面閃爍)
box(0.9, H, T, C.wallL, { x: -S / 2 + 0.45, y: H / 2, z: L.z, r: 0.04, seg: 2 }); // 左柱
box(0.9, H, T, C.wallL, { x: S / 2 - T - 0.45, y: H / 2, z: L.z, r: 0.04, seg: 2 });  // 右柱(貼在粉牆內側)
box(S - T, 0.5, T, C.wallL, { x: -T / 2, y: 0.25, z: L.z, r: 0.04, seg: 2 });      // 下座
cyl(0.16, 0.16, H - 1.4, C.pillar, { x: 0.35, y: (H - 1.4) / 2 + 0.5, z: L.z });   // 中間細柱
// 兩層層架
// 層架往右縮,最左邊讓給街機
const SHELF_X0 = -1.85, SHELF_X1 = S / 2 - 0.8;
// 窗前兩片層架:淺色橡木(長邊沿 x,所以木紋都是橫向)
for (const y of [2.55, 1.65]) {
  const side = new THREE.MeshStandardMaterial({ map: woodTex(1024, 64, 'u'), roughness: 0.6 }), top = new THREE.MeshStandardMaterial({ map: woodTex(1024, 160, 'u'), roughness: 0.55 });
  const end = new THREE.MeshStandardMaterial({ color: 0xdcbf94, roughness: 0.7 });
  const sh = new THREE.Mesh(new THREE.BoxGeometry(SHELF_X1 - SHELF_X0, 0.12, 0.7), [end, end, top, top, side, side]);   // 兩端、上下面、前後緣
  sh.position.set((SHELF_X0 + SHELF_X1) / 2, y, L.z + 0.15); sh.castShadow = sh.receiveShadow = true; root.add(sh);
}

// ---------- 粉紅牆:兩片層板(底下各一盞暖光)+ 霓虹招牌(貓掌 + K 線)----------
{
  const WX = S / 2 - T;                     // 粉牆內側的 x
  // 層板:淺色橡木(程式畫的木紋:上面的紋沿長邊走、前緣是側面的紋,幾個小木節)+ 底下兩支黃銅托架
  const grain = woodTex;
  const brassShelf = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.35 });
  for (const [y, z0, z1] of [[2.35, 0.55, 2.45], [3.05, 0.9, 2.45]]) {
    const L = z1 - z0, side = new THREE.MeshStandardMaterial({ map: grain(1024, 64, 'u'), roughness: 0.6 }), top = new THREE.MeshStandardMaterial({ map: grain(128, 1024, 'v'), roughness: 0.55 });
    const end = new THREE.MeshStandardMaterial({ color: 0xdcbf94, roughness: 0.7 });
    const sh = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.08, L), [end, side, top, top, end, end]);   // +x 靠牆、-x 前緣、上下面、兩端
    sh.position.set(WX - 0.21, y, (z0 + z1) / 2); sh.castShadow = sh.receiveShadow = true; root.add(sh);
    for (const z of [z0 + 0.22, z1 - 0.22]) {                                   // L 形托架:貼牆的一段 + 托在板子下面的一段 + 斜撐
      const b1 = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.16, 0.03), brassShelf); b1.position.set(WX - 0.008, y - 0.12, z); root.add(b1);
      const b2 = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.012, 0.03), brassShelf); b2.position.set(WX - 0.16, y - 0.046, z); root.add(b2);
      const b3 = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.01, 0.024), brassShelf); b3.position.set(WX - 0.08, y - 0.11, z); b3.rotation.z = -0.62; root.add(b3);
    }
    const under = new THREE.PointLight(0xffc27a, 1.8, 2.4, 2); under.position.set(WX - 0.3, y - 0.12, (z0 + z1) / 2); root.add(under);
  }
  // 牆上兩張畫(圖片 + 白框):夜景城市、太空貓,並排掛在桌子上方
  const posterImg = (z, y, w, h, url) => { const tex = new THREE.TextureLoader().load(url); tex.colorSpace = THREE.SRGBColorSpace;
    box(0.03, h + 0.08, w + 0.08, 0xfff6f0, { x: WX - 0.015, y, z, r: 0.005, seg: 1, shadow: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); m.rotation.y = -Math.PI / 2; m.position.set(WX - 0.035, y, z); root.add(m); };
  posterImg(-1.7, 3.1, 0.75, 0.5, './poster-city.webp?v=1');   // 夜景城市:用圖
  // 太空貓:會動的照片(哈利波特那種)—— 畫在 canvas 上,整張輕輕呼吸 / 搖晃,貓咪會眨眼,天上星星閃爍
  { const W = 512, Hh = 768, cv = document.createElement('canvas'); cv.width = W; cv.height = Hh; const g = cv.getContext('2d');
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.generateMipmaps = false; tex.minFilter = THREE.LinearFilter;
    const w = 0.7, h = 1.05, y = 3.15, z = -0.45;
    box(0.03, h + 0.08, w + 0.08, 0xfff6f0, { x: WX - 0.015, y, z, r: 0.005, seg: 1, shadow: false });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 })); m.rotation.y = -Math.PI / 2; m.position.set(WX - 0.035, y, z); root.add(m);
    const img = new Image(); img.src = './poster-cat.webp?v=2';
    // 眨眼:同一張圖的「閉眼版」(poster-cat-blink.webp)。兩張只有眼睛附近不一樣,其他地方是 AI 重畫的細微雜訊,
    // 所以只切眼睛那一塊(邊緣羽化)疊上去,整張換會讓畫面閃一下
    const EYE = { x: 160, y: 268, w: 184, h: 120 };                                             // 512×768 貼圖上眼睛的範圍(兩張圖差異最大的區塊再留邊)
    const patch = document.createElement('canvas'); patch.width = EYE.w; patch.height = EYE.h;
    const shut = new Image(); shut.onload = () => { const p = patch.getContext('2d'); p.drawImage(shut, EYE.x, EYE.y, EYE.w, EYE.h, 0, 0, EYE.w, EYE.h);
      p.globalCompositeOperation = 'destination-in'; p.save(); p.translate(EYE.w / 2, EYE.h / 2); p.scale(EYE.w / 2, EYE.h / 2);
      const gr = p.createRadialGradient(0, 0, 0, 0, 0, 1); gr.addColorStop(0, '#000'); gr.addColorStop(0.72, '#000'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      p.fillStyle = gr; p.beginPath(); p.arc(0, 0, 1, 0, Math.PI * 2); p.fill(); p.restore(); patch.ready = true; };
    shut.src = './poster-cat-blink.webp?v=1';
    const STARS = [[40, 60], [180, 30], [300, 70], [470, 20], [80, 330], [480, 300], [360, 160], [230, 120], [130, 230]];
    let blinkAt = 3, blinkDur = 0.22, forced = 0;
    livePoster = (t) => {
      if (!img.complete || !img.naturalWidth) return;
      if (forced) { blinkAt = t; blinkDur = forced; forced = 0; }
      g.clearRect(0, 0, W, Hh); g.save(); g.translate(W / 2, Hh / 2);
      g.rotate(0.012 * Math.sin(t * 0.5)); const sc = 1.05 + 0.015 * Math.sin(t * 0.8); g.scale(sc, sc);          // 整張微晃 + 呼吸
      g.translate(0, 4 * Math.sin(t * 1.1)); g.drawImage(img, -W / 2, -Hh / 2, W, Hh);
      // 眨眼:閉眼那一塊淡入 → 停一下 → 淡出。偶爾(約 15%)是「瞇眼笑」,閉著 1.2 秒;偶爾連眨兩下
      const ph = (t - blinkAt) / blinkDur;
      if (ph >= 0) { if (ph > 1) { const r = Math.random(); blinkDur = r < 0.15 ? 1.2 : 0.22; blinkAt = t + (r > 0.8 ? 0.3 : 2.5 + Math.random() * 3.5); }
        else if (patch.ready) { const edge = Math.min(0.08, blinkDur / 3) / blinkDur, a = Math.min(1, ph / edge, (1 - ph) / edge);
          g.globalAlpha = Math.max(0, a); g.drawImage(patch, EYE.x - W / 2, EYE.y - Hh / 2); g.globalAlpha = 1; } }
      g.restore();
      // 星星閃爍(四角星,亮度各自用不同頻率的 sin)
      for (let i = 0; i < STARS.length; i++) { const [sx, sy] = STARS[i], a = 0.5 + 0.5 * Math.sin(t * (1.3 + i * 0.37) + i), r = 5 + 3 * a; g.globalAlpha = a * 0.9; g.fillStyle = '#fff6d0';
        g.beginPath(); g.moveTo(sx, sy - r); g.lineTo(sx + r * 0.3, sy - r * 0.3); g.lineTo(sx + r, sy); g.lineTo(sx + r * 0.3, sy + r * 0.3); g.lineTo(sx, sy + r); g.lineTo(sx - r * 0.3, sy + r * 0.3); g.lineTo(sx - r, sy); g.lineTo(sx - r * 0.3, sy - r * 0.3); g.closePath(); g.fill(); }
      g.globalAlpha = 1; tex.needsUpdate = true; };
    livePoster.blinkNow = (dur) => { forced = dur || 0.22; }; }   // 測試用:馬上眨一次(可指定秒數)
  // 角落的龜背芋:木頭三腳架上的米白陶瓷盆,長葉柄從土裡往外拱,葉子是有深裂口和小洞的大心形葉(往房間那邊長,不穿牆),會輕輕擺
  { const p = group(2.42, 0, 1.25);
    // 盆架:三支往外斜的木腳 + 一圈木環
    const wood = 0xc98a5a;
    for (let i = 0; i < 3; i++) { const a = i / 3 * Math.PI * 2 + 0.5; const leg = cyl(0.014, 0.012, 0.2, wood, { x: Math.cos(a) * 0.15, y: 0.095, z: Math.sin(a) * 0.15, parent: p }); leg.rotation.set(Math.sin(a) * 0.22, 0, -Math.cos(a) * 0.22); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.012, 8, 40), mat(wood)); ring.rotation.x = Math.PI / 2; ring.position.y = 0.17; ring.castShadow = true; p.add(ring);
    // 盆:圓角的直筒(車床輪廓),米白;上面一層土
    // 盆口往內凹下去(內壁 + 土面在 0.45),不然最後一段會把盆口封成一片白、看不到土
    const potPts = [[0, 0.17], [0.15, 0.17], [0.175, 0.19], [0.19, 0.24], [0.2, 0.44], [0.205, 0.47], [0.2, 0.48], [0.188, 0.47], [0.182, 0.42], [0.0, 0.42]].map(([r, y]) => new THREE.Vector2(r, y));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(potPts, 48), mat(0xf7f1f2, { roughness: 0.5 })); pot.castShadow = pot.receiveShadow = true; p.add(pot);
    cyl(0.183, 0.183, 0.03, 0x4a3426, { y: 0.435, parent: p });                // 土(上面在 0.45)
    for (let i = 0; i < 14; i++) { const a = i * 2.4, r = 0.04 + (i % 5) * 0.03;  // 幾塊土塊,土面不會是平平一片
      const clod = sphere(0.018 + (i % 3) * 0.006, i % 2 ? 0x3b2a1f : 0x5a4030, { x: Math.cos(a) * r, y: 0.45, z: Math.sin(a) * r, parent: p }); clod.scale.y = 0.5; clod.castShadow = false; }
    // 龜背芋的葉子:心形外框,兩邊各幾道從邊緣切向中脈的深裂口,中脈旁幾個小洞;往後垂、沿中脈對折一點
    const leafGeo = (seed) => {
      let r = seed * 9301 + 49297; const rnd = () => { r = (r * 9301 + 49297) % 233280; return r / 233280; };
      const half = new THREE.SplineCurve([[0, 0.06], [0.14, -0.07], [0.33, -0.05], [0.47, 0.1], [0.53, 0.33], [0.5, 0.58], [0.39, 0.79], [0.21, 0.94], [0, 1.0]].map(([x, y]) => new THREE.Vector2(x, y)));
      const side = (sgn) => {      // 一邊的輪廓(從基部到葉尖),中間插進裂口
        const pts = [], N = 70, cuts = [0.3, 0.42, 0.54, 0.66, 0.78].filter(() => rnd() > 0.15), gap = 0.012;
        for (let i = 0; i <= N; i++) {
          const t = i / N, e = half.getPoint(t); pts.push(new THREE.Vector2(e.x * sgn, e.y));
          for (const c of cuts) if (Math.abs(t - c) < 0.5 / N) {   // 在這一點切進去:沿著指向中脈稍微偏葉基的方向
            const depth = 0.55 + rnd() * 0.25, tipX = e.x * (1 - depth), tipY = e.y - 0.07 - depth * 0.05;
            pts.push(new THREE.Vector2((e.x - gap) * sgn, e.y - gap), new THREE.Vector2(tipX * sgn, tipY), new THREE.Vector2((e.x - gap) * sgn, e.y + gap * 2.5));
          }
        }
        return sgn > 0 ? pts : pts.reverse();
      };
      const right = side(1), left = side(-1);
      const shape = new THREE.Shape([...right, ...left.slice(1)]);
      for (const [x, y, rx, ry] of [[0.09, 0.36, 0.022, 0.045], [-0.1, 0.48, 0.02, 0.04], [0.1, 0.6, 0.018, 0.036], [-0.08, 0.27, 0.018, 0.032]]) if (rnd() > 0.35) {
        const h = new THREE.Path(); h.absellipse(x, y, rx, ry, 0, Math.PI * 2, false, -0.4 * Math.sign(x)); shape.holes.push(h); }
      const g = new THREE.ShapeGeometry(shape, 6), pp = g.attributes.position, col = [], c = new THREE.Color();
      const dark = new THREE.Color(0x24804a), lite = new THREE.Color(0x4cb36a), vein = new THREE.Color(0x9fe09a);
      for (let i = 0; i < pp.count; i++) {
        const x = pp.getX(i), y = pp.getY(i);
        pp.setZ(i, Math.abs(x) * 0.16 - y * y * 0.22 + Math.sin(y * 9) * Math.abs(x) * 0.03);   // 對折 + 往後垂 + 一點波浪
        c.copy(lite).lerp(dark, Math.min(1, Math.abs(x) * 1.8 + y * 0.2));
        if (Math.abs(x) < 0.03) c.lerp(vein, 0.55);                                              // 中脈
        else if (Math.abs(Math.sin((y - Math.abs(x) * 0.6) * 20)) < 0.12) c.lerp(lite, 0.35);   // 側脈
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
    };
    // 背光那面會整片變黑:加一點自發光把暗面提亮(強度 < 0.5,不會被濾鏡當成發光物)
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, side: THREE.DoubleSide, emissive: 0x2a6b3c, emissiveIntensity: 0.4 });
    const petMat = mat(0x3c8a4f, { roughness: 0.6 });
    const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
    // [方向角(0 = 往房間 -x)、葉柄頂端高度、往外伸多遠、葉子大小]:牆在 +x,所以都往 -x、±z 長
    const LEAVES = [[0, 1.65, 0.3, 0.56], [0.9, 1.45, 0.4, 0.52], [-0.9, 1.5, 0.38, 0.54], [1.7, 1.2, 0.42, 0.46], [-1.7, 1.25, 0.44, 0.48],
      [0.4, 1.05, 0.5, 0.44], [-0.45, 1.1, 0.52, 0.46], [2.3, 0.95, 0.3, 0.38], [-2.3, 0.92, 0.32, 0.36]];
    const sway = [];
    LEAVES.forEach(([ang, h, reach, size], k) => {
      const dir = new THREE.Vector3(-Math.cos(ang), 0, Math.sin(ang));          // 水平往外的方向
      const pivot = new THREE.Group(); pivot.position.set(0, 0.45, 0); p.add(pivot);   // 葉柄從土面長出來
      const top = dir.clone().multiplyScalar(reach).setY(h - 0.45);
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(dir.x * 0.03, 0, dir.z * 0.03), dir.clone().multiplyScalar(reach * 0.25).setY((h - 0.45) * 0.85), top);
      const pet = new THREE.Mesh(new THREE.TubeGeometry(curve, 20, 0.011, 6), petMat); pet.castShadow = true; pivot.add(pet);
      // 葉子:基部接在葉柄頂端,葉尖沿葉柄的方向繼續往外、往下垂;葉面朝上偏外
      const tan = curve.getTangent(1), tipDir = tan.clone().setY(0).normalize().multiplyScalar(0.9).add(new THREE.Vector3(0, -0.12 - (k % 3) * 0.1, 0));   // 葉尖微微往下(太垂整棵會變矮)
      const face = new THREE.Vector3(0, 1, 0).addScaledVector(dir, 0.35);
      _y.copy(tipDir).normalize(); _x.crossVectors(_y, face).normalize(); _z.crossVectors(_x, _y).normalize();
      const leaf = new THREE.Mesh(leafGeo(k + 3), leafMat); leaf.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
      leaf.position.copy(top); leaf.scale.setScalar(size); leaf.castShadow = true; pivot.add(leaf);
      sway.push({ pivot, ph: k * 1.7, amp: 0.012 + size * 0.02, ax: dir.z, az: -dir.x });
    });
    idleAnims.push((t) => { for (const v of sway) { const a = v.amp * (Math.sin(t * 0.7 + v.ph) + 0.5 * Math.sin(t * 1.9 + v.ph * 1.3)); v.pivot.rotation.x = v.ax * a; v.pivot.rotation.z = v.az * a; } });
  }
  // 層板右端(貓咪頭上)的黃金葛:陶瓷盆 + 盆裡一叢心形葉 + 五條藤蔓從層板前緣、側緣垂下來,葉子交錯、越往尾端越小,會隨風輕擺
  { const iv = group(WX - 0.2, 2.35 + 0.04, 2.3);
    // 盆:車床旋轉出來的輪廓(圓唇、往下收),桃粉色;底下一個小托盤、上面一層土
    const potPts = [[0, 0.004], [0.062, 0.004], [0.07, 0.012], [0.084, 0.1], [0.094, 0.118], [0.1, 0.124], [0.1, 0.138], [0.093, 0.142], [0.087, 0.13], [0.0, 0.13]].map(([r, y]) => new THREE.Vector2(r, y));
    const pot = new THREE.Mesh(new THREE.LatheGeometry(potPts, 40), mat(0xf4a58c, { roughness: 0.55 })); pot.castShadow = pot.receiveShadow = true; iv.add(pot);
    cyl(0.088, 0.084, 0.012, 0xf7c9b8, { y: 0.006, parent: iv });
    cyl(0.086, 0.086, 0.012, 0x4a3426, { y: 0.128, parent: iv });
    // 心形葉(基部在原點、葉尖朝 +y,長 1):沿中脈對折一點、往前捲,中間淺邊緣深;有些葉子帶淡黃綠斑紋
    const leafShape = new THREE.Shape(); leafShape.moveTo(0, 0.04);
    leafShape.bezierCurveTo(0.2, -0.1, 0.58, 0.1, 0.5, 0.48); leafShape.quadraticCurveTo(0.38, 0.82, 0, 1.0);
    leafShape.quadraticCurveTo(-0.38, 0.82, -0.5, 0.48); leafShape.bezierCurveTo(-0.58, 0.1, -0.2, -0.1, 0, 0.04);
    const makeLeafGeo = (variegated) => {
      const g = new THREE.ShapeGeometry(leafShape, 10), p = g.attributes.position, col = [], c = new THREE.Color();
      const dark = new THREE.Color(0x2f8a4c), mid = new THREE.Color(0x4fb46a), cream = new THREE.Color(0xd9efa0);
      for (let i = 0; i < p.count; i++) {
        const x = p.getX(i), y = p.getY(i);
        p.setZ(i, Math.abs(x) * 0.22 + y * y * 0.18);                  // 對折 + 葉尖往前捲
        c.copy(mid).lerp(dark, Math.min(1, Math.abs(x) * 2.2));         // 中脈淺、邊緣深
        if (Math.abs(x) < 0.035) c.lerp(cream, 0.35);                    // 中脈
        if (variegated) { const st = Math.sin(x * 9 + y * 5) * Math.sin(y * 7 - x * 3); if (st > 0.55) c.lerp(cream, 0.6); }
        col.push(c.r, c.g, c.b);
      }
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
    };
    const leafGeos = [makeLeafGeo(false), makeLeafGeo(true)];
    const leafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, side: THREE.DoubleSide });
    const stemMat = mat(0x3d8a4e, { roughness: 0.7 });
    const _x = new THREE.Vector3(), _y = new THREE.Vector3(), _z = new THREE.Vector3(), _m = new THREE.Matrix4();
    // 一片葉:base 位置、葉尖方向 tip、葉面朝向 face、大小
    const addLeaf = (parent, base, tip, face, size, k) => {
      _y.copy(tip).normalize(); _x.crossVectors(_y, face).normalize(); _z.crossVectors(_x, _y).normalize();
      const leaf = new THREE.Mesh(leafGeos[k % 3 === 1 ? 1 : 0], leafMat); leaf.quaternion.setFromRotationMatrix(_m.makeBasis(_x, _y, _z));
      leaf.position.copy(base); leaf.scale.setScalar(size); leaf.castShadow = true; parent.add(leaf); return leaf;
    };
    // 盆裡一叢:短莖往外拱,葉子朝外、微微朝上
    for (let i = 0; i < 11; i++) {
      const a = i / 11 * Math.PI * 2 + 0.3, r = 0.05 + (i % 3) * 0.018, up = 0.07 + (i % 4) * 0.025;
      const base = new THREE.Vector3(Math.cos(a) * r, 0.135 + up, Math.sin(a) * r);
      const out = new THREE.Vector3(Math.cos(a), 0.55 + (i % 2) * 0.35, Math.sin(a));
      const stem = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(Math.cos(a) * 0.015, 0.13, Math.sin(a) * 0.015), new THREE.Vector3(Math.cos(a) * r * 0.5, 0.135 + up * 1.1, Math.sin(a) * r * 0.5), base), 8, 0.0045, 5), stemMat);
      iv.add(stem);
      addLeaf(iv, base, out, new THREE.Vector3(Math.cos(a) * 0.4, 1, Math.sin(a) * 0.4), 0.098 + (i % 3) * 0.014, i);
    }
    // 垂下來的藤蔓:從盆邊越過層板前緣(-x)或側緣(+z)往下垂;每條一個擺動的軸心放在層板邊緣
    const VINES = [ // [從哪個邊緣, 沿邊緣的位置, 長度]
      ['front', -0.05, 0.62], ['front', 0.06, 0.9], ['front', -0.13, 0.42], ['end', -0.04, 0.78], ['end', 0.07, 0.5]];
    const sway = [];
    VINES.forEach(([edge, off, len], k) => {
      const front = edge === 'front';
      const P = (u, y, w = 0) => front ? new THREE.Vector3(u, y, off + w) : new THREE.Vector3(off + w, y, u);   // u:往邊緣外的距離,w:沿邊緣的偏移
      const edgeU = front ? -0.22 : 0.17, sgn = front ? -1 : 1;
      const pivot = new THREE.Group(); pivot.position.copy(P(edgeU, 0)); iv.add(pivot);
      const pts = [P(sgn * 0.05, 0.14), P(edgeU * 0.75, 0.08), P(edgeU + sgn * 0.012, 0.005)];
      const n = Math.max(4, Math.round(len / 0.12));
      for (let i = 1; i <= n; i++) { const t = i / n; pts.push(P(edgeU + sgn * (0.025 + 0.02 * Math.sin(t * 5 + k)), -len * t + (t > 0.92 ? 0.03 : 0), 0.025 * Math.sin(t * 4 + k * 1.7))); }
      pts.push(P(edgeU + sgn * 0.06, -len + 0.06, 0.02));               // 尾端往外翹一點
      const local = pts.map((p) => p.clone().sub(pivot.position));
      const curve = new THREE.CatmullRomCurve3(local);
      const vine = new THREE.Mesh(new THREE.TubeGeometry(curve, 64, 0.0045, 6), stemMat); vine.castShadow = true; pivot.add(vine);
      // 葉子:沿著藤交錯長,越往下越小;葉面朝房間(往邊緣外),葉尖往下、往外
      const count = Math.round(len / 0.052);
      for (let i = 0; i < count; i++) {
        const t = 0.12 + (i / count) * 0.86, p = curve.getPoint(t), tan = curve.getTangent(t), side = i % 2 ? 1 : -1;
        const outward = P(sgn, 0).sub(P(0, 0)).normalize();
        const along = front ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
        const tip = tan.clone().multiplyScalar(0.8).addScaledVector(outward, 0.5).addScaledVector(along, side * 0.7);
        addLeaf(pivot, p.clone().addScaledVector(along, side * 0.01), tip, outward.clone().addScaledVector(along, side * 0.3).add(new THREE.Vector3(0, 0.25, 0)), (0.086 - t * 0.032) * (0.9 + 0.2 * Math.sin(i * 2.3 + k)), i + k);
      }
      sway.push({ pivot, axis: front ? 'z' : 'x', dir: front ? 1 : -1, ph: k * 1.3, amp: 0.025 + len * 0.03 });
    });
    idleAnims.push((t) => { for (const v of sway) v.pivot.rotation[v.axis] = v.dir * v.amp * (Math.sin(t * 0.9 + v.ph) + 0.4 * Math.sin(t * 2.1 + v.ph * 2)); });
  }
  // 上層層板的音響(Marshall 那種復古設計感,不放它的商標):黑色皮紋箱體、米白滾邊、深色布網 + 金色草寫字、上面一條黃銅面板配金色旋鈕和撥桿
  { const sp = group(WX - 0.13, 3.09, 1.72); sp.rotation.y = -Math.PI / 2;          // 本地 +z = 正面(朝房間)
    const W = 0.46, H = 0.3, D = 0.17, Y0 = 0.012;
    // 皮紋貼圖(細細的顆粒)
    const tc = document.createElement('canvas'); tc.width = tc.height = 256; { const g = tc.getContext('2d'); g.fillStyle = '#1b1a1c'; g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 5000; i++) { const v = 22 + Math.random() * 22; g.fillStyle = `rgb(${v},${v},${v + 2})`; g.fillRect(Math.random() * 256, Math.random() * 256, 1.5, 1.5); } }
    const tolex = new THREE.CanvasTexture(tc); tolex.colorSpace = THREE.SRGBColorSpace; tolex.wrapS = tolex.wrapT = THREE.RepeatWrapping; tolex.repeat.set(2, 2);
    const body = new THREE.Mesh(new RoundedBoxGeometry(W, H, D, 4, 0.026), new THREE.MeshStandardMaterial({ map: tolex, roughness: 0.82 }));
    body.position.y = Y0 + H / 2; body.castShadow = body.receiveShadow = true; sp.add(body);
    // 布網:深灰底 + 很淡的交織紋 + 金色草寫字
    const gc = document.createElement('canvas'); gc.width = 640; gc.height = 380; { const g = gc.getContext('2d'); g.fillStyle = '#232125'; g.fillRect(0, 0, 640, 380);
      g.globalAlpha = 0.12; g.strokeStyle = '#9a96a0'; g.lineWidth = 1; for (let x = -380; x < 640; x += 6) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 380, 380); g.stroke(); g.beginPath(); g.moveTo(x + 380, 0); g.lineTo(x, 380); g.stroke(); }
      g.globalAlpha = 1; g.fillStyle = '#d9b36c'; g.font = 'italic 700 74px "Snell Roundhand", "Brush Script MT", "Segoe Script", cursive'; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.shadowColor = 'rgba(0,0,0,.6)'; g.shadowBlur = 4; g.fillText('CatInsight', 320, 120); }
    const grille = new THREE.CanvasTexture(gc); grille.colorSpace = THREE.SRGBColorSpace; grille.anisotropy = 8;
    const gw = W - 0.05, gh = H - 0.06;
    const front = new THREE.Mesh(new THREE.PlaneGeometry(gw, gh), new THREE.MeshStandardMaterial({ map: grille, roughness: 0.95 }));
    front.position.set(0, Y0 + H / 2, D / 2 + 0.0015); sp.add(front);
    // 米白滾邊:沿著布網外框的圓角矩形管子
    { const r = 0.02, x0 = gw / 2 + 0.004, y0 = gh / 2 + 0.004, pts = [];
      for (const [cx, cy, a0] of [[x0 - r, y0 - r, 0], [-x0 + r, y0 - r, Math.PI / 2], [-x0 + r, -y0 + r, Math.PI], [x0 - r, -y0 + r, Math.PI * 1.5]])
        for (let i = 0; i <= 6; i++) { const a = a0 + i / 6 * Math.PI / 2; pts.push(new THREE.Vector3(cx + Math.cos(a) * r, cy + Math.sin(a) * r, 0)); }
      const pipe = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, true), 120, 0.0045, 6, true), mat(0xf3ead8, { roughness: 0.5 }));
      pipe.position.set(0, Y0 + H / 2, D / 2 + 0.002); sp.add(pipe); }
    // 上面:黃銅面板 + 三顆旋鈕(黑底、金色有刻紋的頂蓋)+ 左邊一支撥桿開關
    const brass = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.85, roughness: 0.32 });
    const plate = new THREE.Mesh(new RoundedBoxGeometry(W - 0.07, 0.006, 0.05, 2, 0.003), brass); plate.position.set(0, Y0 + H + 0.002, D / 2 - 0.035); sp.add(plate);
    const knobBase = mat(0x141316, { roughness: 0.5 });
    [0.05, 0.11, 0.17].forEach((x) => {
      const kb = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.016, 0.014, 24), knobBase); kb.position.set(x, Y0 + H + 0.012, D / 2 - 0.035); kb.castShadow = true; sp.add(kb);
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.0125, 0.0125, 0.006, 16), brass); cap.position.set(x, Y0 + H + 0.021, D / 2 - 0.035); sp.add(cap);   // 16 邊 = 刻紋
    });
    const sw = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.01, 0.006, 16), knobBase); sw.position.set(-0.17, Y0 + H + 0.008, D / 2 - 0.035); sp.add(sw);
    const lever = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0035, 0.026, 8), brass); lever.position.set(-0.17, Y0 + H + 0.02, D / 2 - 0.03); lever.rotation.x = 0.45; sp.add(lever);
    // 四個小腳
    for (const [x, z] of [[-W / 2 + 0.04, -D / 2 + 0.03], [W / 2 - 0.04, -D / 2 + 0.03], [-W / 2 + 0.04, D / 2 - 0.03], [W / 2 - 0.04, D / 2 - 0.03]]) cyl(0.012, 0.012, Y0, 0x2a2a2e, { x, y: Y0 / 2, z, parent: sp });
  }
  // 層板上的小東西:一排書、水晶球、招財貓、掌上遊戲機
  // 一排書:黃銅書擋 + 七本高矮厚薄不一的書(書背朝房間 -x,有燙金線和書名線,上面和後面看得到米白書頁),最後一本斜靠,旁邊再平放兩本
  { const SY = 2.39, BX = WX - 0.2;                                   // 層板上緣、書的中心 x
    const pagesMat = mat(0xf6eedc, { roughness: 0.9 });
    const spineTex = (hex, h, seed) => {                                // 書背:底色 + 上下燙金線 + 幾條書名線
      const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const g = cv.getContext('2d');
      g.fillStyle = '#' + hex.toString(16).padStart(6, '0'); g.fillRect(0, 0, 64, 256);
      g.fillStyle = '#e7c779'; for (const y of [18, 26, 230, 238]) g.fillRect(4, y, 56, 3);
      g.fillStyle = 'rgba(255,248,230,.85)'; const n = 2 + (seed % 2); for (let i = 0; i < n; i++) g.fillRect(14 + (seed * 7 + i * 11) % 14, 70 + i * 22, 22 - (i * 5 + seed) % 9, 6);
      g.fillStyle = 'rgba(0,0,0,.18)'; g.fillRect(0, 0, 5, 256); g.fillRect(59, 0, 5, 256);   // 書背兩側的弧度陰影
      const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
    };
    const book = (w, h, d, hex, seed, pos, rot = [0, 0, 0]) => {          // w = 厚度(z)、h = 高、d = 深(x)
      const cover = mat(hex, { roughness: 0.75 }), spine = new THREE.MeshStandardMaterial({ map: spineTex(hex, h, seed), roughness: 0.7 });
      const b = new THREE.Mesh(new THREE.BoxGeometry(d, h, w), [pagesMat, spine, pagesMat, cover, cover, cover]);   // +x 書頁、-x 書背、上下書頁、兩面封面
      b.position.copy(pos); b.rotation.set(...rot); b.castShadow = b.receiveShadow = true; root.add(b); return b;
    };
    // 書擋(L 形黃銅)
    const brassB = new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.8, roughness: 0.35 });
    { const be = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.012), brassB); be.position.set(BX, SY + 0.1, 0.62); be.castShadow = true; root.add(be);
      const ft = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.008, 0.09), brassB); ft.position.set(BX, SY + 0.004, 0.67); root.add(ft); }
    const BOOKS = [[0.055, 0.34, 0.22, 0x8b7cff], [0.04, 0.3, 0.2, 0xf27a5a], [0.062, 0.37, 0.23, 0x46bfcf], [0.035, 0.27, 0.19, 0xf5c451],
      [0.05, 0.32, 0.21, 0xf3ead8], [0.045, 0.35, 0.22, 0x6c4f9e], [0.038, 0.29, 0.2, 0xff8fb8]];
    let z = 0.632;
    BOOKS.forEach(([w, h, d, hex], i) => { z += w / 2 + 0.002; book(w, h, d, hex, i, new THREE.Vector3(BX + (0.23 - d) / 2, SY + h / 2, z)); z += w / 2; });
    // 最後一本斜靠在前一本上
    { const w = 0.042, h = 0.31, a = 0.32; book(w, h, 0.21, 0x3fae8a, 9, new THREE.Vector3(BX, SY + Math.cos(a) * h / 2 + Math.sin(a) * w / 2, z + Math.sin(a) * h / 2 + 0.004), [-a, 0, 0]); }
    // 平放的兩本
    book(0.24, 0.035, 0.17, 0xef7b3a, 11, new THREE.Vector3(BX + 0.02, SY + 0.0175, 1.27), [0, 0.12, 0]);
    book(0.21, 0.03, 0.15, 0x8fd1c4, 12, new THREE.Vector3(BX + 0.02, SY + 0.05, 1.26), [0, -0.1, 0]);
  }
  // 水晶球:胡桃木底座 + 黃銅環、透明玻璃球,裡面一團慢慢轉的紫 / 青 / 粉星雲(會發光)和幾顆閃爍的小星星
  { const cb = group(WX - 0.2, 2.39, 1.62);
    cyl(0.085, 0.1, 0.06, 0x6b4430, { y: 0.03, parent: cb });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.008, 8, 40), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.85, roughness: 0.3 })); ring.rotation.x = Math.PI / 2; ring.position.y = 0.066; cb.add(ring);
    const R = 0.115, CY = 0.06 + R * 0.92;
    // 星雲貼圖:幾團柔和的彩色霧 + 細小亮點
    const nc = document.createElement('canvas'); nc.width = 512; nc.height = 256; { const g = nc.getContext('2d'); g.fillStyle = '#1a0f3a'; g.fillRect(0, 0, 512, 256);
      g.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 18; i++) { const x = Math.random() * 512, y = 40 + Math.random() * 176, r = 30 + Math.random() * 70, col = ['120,80,255', '70,220,230', '255,110,200', '150,120,255'][i % 4];
        const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, `rgba(${col},.32)`); gr.addColorStop(1, `rgba(${col},0)`); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
      for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(255,255,255,${0.4 + Math.random() * 0.6})`; g.fillRect(Math.random() * 512, Math.random() * 256, 1.5, 1.5); } }
    const neb = new THREE.CanvasTexture(nc); neb.colorSpace = THREE.SRGBColorSpace; neb.wrapS = THREE.RepeatWrapping;
    const core = new THREE.Mesh(new THREE.SphereGeometry(R * 0.78, 32, 20), new THREE.MeshStandardMaterial({ map: neb, emissive: 0xffffff, emissiveMap: neb, emissiveIntensity: 0.55, roughness: 1 }));   // 太亮會整顆暈成白色,看不到顏色
    core.position.y = CY; cb.add(core);
    const stars = [];
    for (let i = 0; i < 7; i++) { const st = new THREE.Mesh(new THREE.SphereGeometry(0.006, 8, 6), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c8, emissiveIntensity: 1.5 }));
      const a = i * 2.3, e = (i % 3 - 1) * 0.5; st.position.set(Math.cos(a) * R * 0.84 * Math.cos(e), CY + Math.sin(e) * R * 0.84, Math.sin(a) * R * 0.84 * Math.cos(e)); cb.add(st); stars.push(st); }
    const glass = new THREE.Mesh(new THREE.SphereGeometry(R, 48, 32), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.03, metalness: 0, transmission: 1, thickness: 0.15, ior: 1.45, clearcoat: 1, transparent: true, opacity: 1 }));
    glass.position.y = CY; cb.add(glass);
    idleAnims.push((t) => { core.rotation.y = t * 0.25; core.rotation.z = Math.sin(t * 0.3) * 0.2; stars.forEach((st, i) => { st.scale.setScalar(0.6 + 0.5 * (0.5 + 0.5 * Math.sin(t * (1.7 + i * 0.4) + i))); }); });
  }
  // 招財貓:白色陶瓷、紅坐墊、紅項圈 + 金鈴鐺、抱著金幣,舉起來的那隻手慢慢招手(本地 +z 朝房間)
  { const mk = group(WX - 0.2, 3.09, 2.13); mk.rotation.y = -Math.PI / 2;
    const porcelain = mat(0xfbf7f2, { roughness: 0.28 }), red = mat(0xe0453a, { roughness: 0.45 }), gold = new THREE.MeshStandardMaterial({ color: 0xe2b84f, metalness: 0.85, roughness: 0.3 }), pink = mat(0xff9fb5, { roughness: 0.5 }), ink = mat(0x2b2228, { roughness: 0.6 });
    const add = (geo, m, x, y, z, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0, parent = mk) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); o.scale.set(sx, sy, sz); o.rotation.set(rx, ry, rz); o.castShadow = true; parent.add(o); return o; };
    add(new RoundedBoxGeometry(0.17, 0.03, 0.15, 3, 0.012), red, 0, 0.015, 0);                                   // 坐墊
    add(new THREE.SphereGeometry(0.075, 32, 20), porcelain, 0, 0.1, 0, 1, 1.12, 0.92);                           // 身體
    add(new THREE.SphereGeometry(0.066, 32, 20), porcelain, 0, 0.215, 0.005, 1.12, 0.95, 1);                     // 頭
    for (const sx of [-1, 1]) {                                                                                   // 耳朵(外白內粉)
      add(new THREE.ConeGeometry(0.026, 0.05, 16), porcelain, sx * 0.042, 0.272, 0, 1, 1, 0.7, 0, 0, -sx * 0.32);
      add(new THREE.ConeGeometry(0.016, 0.034, 16), pink, sx * 0.041, 0.268, 0.01, 1, 1, 0.5, 0, 0, -sx * 0.32);
      const eye = add(new THREE.TorusGeometry(0.011, 0.0028, 6, 16, Math.PI), ink, sx * 0.026, 0.222, 0.064, 1, 1, 1, 0, 0, Math.PI);   // 瞇瞇眼(向下彎的弧)
      add(new THREE.SphereGeometry(0.012, 12, 8), pink, sx * 0.045, 0.2, 0.055, 1, 0.6, 0.4);                   // 腮紅
      for (const k of [-1, 1]) add(new THREE.CylinderGeometry(0.0012, 0.0012, 0.045, 4), ink, sx * 0.07, 0.2 + k * 0.008, 0.045, 1, 1, 1, 0, 0, Math.PI / 2 + k * sx * 0.15);   // 鬍鬚
    }
    add(new THREE.SphereGeometry(0.007, 10, 8), pink, 0, 0.205, 0.07);                                           // 鼻子
    add(new THREE.TorusGeometry(0.052, 0.008, 8, 32), red, 0, 0.162, 0.004, 1, 1, 1, Math.PI / 2 - 0.12);        // 項圈
    add(new THREE.SphereGeometry(0.013, 16, 12), gold, 0, 0.152, 0.058);                                         // 鈴鐺
    add(new THREE.CylinderGeometry(0.028, 0.028, 0.008, 24), gold, -0.02, 0.095, 0.07, 1, 1, 1.5, Math.PI / 2 - 0.2);   // 抱著的金幣
    add(new THREE.SphereGeometry(0.02, 16, 12), porcelain, -0.035, 0.085, 0.06);                                 // 抱金幣的手
    add(new THREE.TorusGeometry(0.03, 0.009, 8, 20, Math.PI * 1.2), porcelain, 0.05, 0.05, -0.05, 1, 1, 1, 0, 0.6, 0.4);   // 尾巴
    const arm = new THREE.Group(); arm.position.set(0.055, 0.15, 0.01); mk.add(arm);                              // 舉起來招手的手(軸心在肩膀)
    add(new THREE.CylinderGeometry(0.017, 0.02, 0.065, 16), porcelain, 0, 0.03, 0, 1, 1, 1, 0, 0, -0.15, arm);
    add(new THREE.SphereGeometry(0.023, 16, 12), porcelain, 0.004, 0.068, 0, 1, 1, 1, 0, 0, 0, arm);
    add(new THREE.SphereGeometry(0.009, 10, 8), pink, 0.004, 0.068, 0.02, 1, 1, 0.5, 0, 0, 0, arm);            // 肉球
    idleAnims.push((t) => { arm.rotation.x = -0.15 - 0.45 * Math.max(0, Math.sin(t * 1.6)); });
  }
  // 掌上遊戲機(復古掌機的感覺,不放任何品牌):粉色機身斜靠在小架子上,淡綠色螢幕跑一隻跳起來吃金幣的像素貓
  { const gb = group(WX - 0.19, 3.09, 1.3); gb.rotation.y = -Math.PI / 2;
    const stand = mat(0xf6eef8, { roughness: 0.5 });
    const st = new THREE.Mesh(new RoundedBoxGeometry(0.1, 0.012, 0.06, 2, 0.004), stand); st.position.y = 0.006; gb.add(st);
    const lean = new THREE.Mesh(new RoundedBoxGeometry(0.09, 0.08, 0.008, 2, 0.003), stand); lean.position.set(0, 0.045, -0.022); lean.rotation.x = -0.32; gb.add(lean);
    const dev = new THREE.Group(); dev.position.set(0, 0.098, 0.006); dev.rotation.x = -0.28; gb.add(dev);
    const body = new THREE.Mesh(new RoundedBoxGeometry(0.105, 0.17, 0.024, 3, 0.012), mat(0xf6a9c8, { roughness: 0.45 })); body.castShadow = true; dev.add(body);
    const bezel = new THREE.Mesh(new RoundedBoxGeometry(0.084, 0.072, 0.004, 2, 0.006), mat(0x5b4a6b, { roughness: 0.5 })); bezel.position.set(0, 0.035, 0.012); dev.add(bezel);
    const sc = document.createElement('canvas'); sc.width = 80; sc.height = 64; const sg = sc.getContext('2d');
    const scrTex = new THREE.CanvasTexture(sc); scrTex.colorSpace = THREE.SRGBColorSpace; scrTex.magFilter = THREE.NearestFilter; scrTex.minFilter = THREE.NearestFilter; scrTex.generateMipmaps = false;
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.066, 0.053), new THREE.MeshStandardMaterial({ map: scrTex, emissive: 0xffffff, emissiveMap: scrTex, emissiveIntensity: 0.3, roughness: 0.4 })   /* 低於光暈門檻:太亮會暈成一片白、看不到像素貓 */);
    scr.position.set(0, 0.035, 0.0145); dev.add(scr);
    const CAT = ['..#...#.', '..##.##.', '..#####.', '..#.#.#.', '.#######', '#.#####.', '..#...#.'];   // 8×7 像素貓
    let lastF = -1;
    const drawScr = (t) => {
      const f = Math.floor(t * 8); if (f === lastF) return; lastF = f;
      sg.fillStyle = '#c9e8b8'; sg.fillRect(0, 0, 80, 64);
      sg.fillStyle = '#7fb48a'; sg.fillRect(0, 52, 80, 12); for (let x = (-(f * 2) % 8 + 8) % 8; x < 80; x += 8) sg.fillRect(x, 50, 4, 2);   // 地面往後捲
      const ph = (f % 24) / 24, jump = ph < 0.4 ? Math.sin(ph / 0.4 * Math.PI) * 16 : 0, cy = 43 - Math.round(jump);
      sg.fillStyle = '#2f5b46'; CAT.forEach((row, y) => [...row].forEach((c, x) => { if (c === '#') sg.fillRect(20 + x, cy + y, 1, 1); }));
      const coinX = 70 - ((f * 3) % 70); if (!(coinX > 18 && coinX < 30 && jump > 8)) { sg.fillStyle = '#e2b84f'; sg.fillRect(coinX, 26, 4, 4); sg.fillStyle = '#fff3c4'; sg.fillRect(coinX + 1, 27, 1, 1); }
      sg.fillStyle = '#2f5b46'; sg.font = '7px monospace'; sg.fillText('$' + (120 + Math.floor(f / 24) * 10), 4, 9);
      scrTex.needsUpdate = true;
    };
    idleAnims.push(drawScr);
    const btn = mat(0x8b7cff, { roughness: 0.4 }), dark = mat(0x5b4a6b, { roughness: 0.5 });
    const dp = new THREE.Group(); dp.position.set(-0.025, -0.032, 0.013); dev.add(dp);                           // 十字鍵
    dp.add(new THREE.Mesh(new RoundedBoxGeometry(0.03, 0.009, 0.005, 1, 0.002), dark)); dp.add(new THREE.Mesh(new RoundedBoxGeometry(0.009, 0.03, 0.005, 1, 0.002), dark));
    for (const [x, y] of [[0.022, -0.026], [0.034, -0.036]]) { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.0065, 0.0065, 0.005, 16), btn); b.rotation.x = Math.PI / 2; b.position.set(x, y, 0.013); dev.add(b); }   // A / B
    for (const x of [-0.012, 0.008]) { const p = new THREE.Mesh(new THREE.CapsuleGeometry(0.0025, 0.01, 4, 8), dark); p.rotation.z = Math.PI / 2 - 0.4; p.position.set(x, -0.062, 0.0125); dev.add(p); }   // 兩顆小長條鍵
    for (let i = 0; i < 4; i++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.002, 0.016, 0.002), dark); sl.position.set(0.026 + i * 0.005, -0.068, 0.0125); sl.rotation.z = 0.5; dev.add(sl); }   // 喇叭孔
  }
}
// ---------- 窗外:2.5D 夜景 —— 天空漸層 + 月亮星星、遠 / 近兩層用 BoxGeometry 做的高樓(InstancedMesh,窗戶用 emissive 貼圖),
//            城市底部一層柔和的橘紫光、開口前一片淡玻璃、再從窗戶打一盞藍紫 RectAreaLight 讓房間吃到夜景的冷光。全部只畫在開口範圍內(stencil)----------
{
  const mk = (w, h, draw) => { const cv = document.createElement('canvas'); cv.width = w; cv.height = h; draw(cv.getContext('2d'), w, h); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t; };
  const rnd = (a, b) => a + Math.random() * (b - a);
  const STENCIL = { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.EqualStencilFunc };
  const openW = S - T - 1.8, openH = H - 1.4, cx = -T / 2;
  // 1. 開口遮罩:看不見,只寫 stencil
  const mask = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false, stencilWrite: true, stencilRef: 1, stencilZPass: THREE.ReplaceStencilOp }));
  mask.position.set(cx, 0.5 + openH / 2, L.z + T / 2 + 0.01); mask.renderOrder = -20; root.add(mask);
  // 2. 天空:深海軍藍 → 紫 → 地平線洋紅粉,淡淡的銀河帶(星星另外一層會閃)
  const skyTex = mk(1024, 1024, (g, w, h) => { const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#0d0b2e'); sky.addColorStop(0.42, '#2a1d63'); sky.addColorStop(0.72, '#5b3a9e'); sky.addColorStop(1, '#ff7fb6'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.save(); g.translate(w / 2, h * 0.32); g.rotate(-0.35);                         // 銀河:斜斜一條淡淡的光帶 + 細小星塵
    for (let i = 0; i < 18; i++) { const x = (Math.random() - 0.5) * w * 1.4, y = (Math.random() - 0.5) * 70, r = 60 + Math.random() * 90, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(190,170,255,.10)'); gr.addColorStop(1, 'rgba(190,170,255,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2); }
    g.fillStyle = 'rgba(255,255,255,.55)'; for (let i = 0; i < 700; i++) g.fillRect((Math.random() - 0.5) * w * 1.4, (Math.random() - 0.5) * 60 * (Math.random() + 0.2), 1, 1);
    g.restore(); });
  // 天空和城市都做很寬(從斜角、手機直拿透過開口看也不會看到邊)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, H * 3), new THREE.MeshBasicMaterial({ map: skyTex, ...STENCIL }));
  sky.position.set(cx, H / 2 - 0.2, L.z - 3.4); sky.renderOrder = -10; root.add(sky);
  const SZ = L.z - 3.36;                                                               // 星星 / 月亮 / 流星都在天空前面一點
  // 會閃的星星:一層 Points,每顆有自己的大小和閃爍節奏
  const starU = { uTime: { value: 0 } };
  { const N = 340, pos = new Float32Array(N * 3), ph = new Float32Array(N), sz = new Float32Array(N);
    for (let i = 0; i < N; i++) { pos[i * 3] = cx + (Math.random() - 0.5) * S * 4.5; pos[i * 3 + 1] = 2.4 + Math.random() * (H * 1.2); pos[i * 3 + 2] = SZ; ph[i] = Math.random() * 6.28; sz[i] = 1.2 + Math.random() * Math.random() * 3.2; }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('aPh', new THREE.BufferAttribute(ph, 1)); geo.setAttribute('aSz', new THREE.BufferAttribute(sz, 1));
    const stars = new THREE.Points(geo, new THREE.ShaderMaterial({ uniforms: starU, transparent: true, depthWrite: false, ...STENCIL,
      vertexShader: 'attribute float aPh; attribute float aSz; uniform float uTime; varying float vA; void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; vA = 0.45 + 0.55 * (0.5 + 0.5 * sin(uTime * (1.2 + fract(aPh) * 2.5) + aPh)); gl_PointSize = aSz * vA * (14.0 / -mv.z); }',
      fragmentShader: 'varying float vA; void main(){ vec2 p = gl_PointCoord - 0.5; float d = length(p); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(1.0, 0.97, 0.9), a * vA); }' }));
    stars.renderOrder = -9.5; stars.frustumCulled = false; root.add(stars); }
  // 月亮:大一點的彎月 + 柔柔的光暈
  { const mt = mk(256, 256, (g) => { const gr = g.createRadialGradient(128, 128, 30, 128, 128, 128); gr.addColorStop(0, 'rgba(255,240,200,.45)'); gr.addColorStop(1, 'rgba(255,240,200,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#fff3cf'; g.beginPath(); g.arc(128, 128, 34, 0, 7); g.fill(); g.globalCompositeOperation = 'destination-out'; g.beginPath(); g.arc(144, 118, 30, 0, 7); g.fill(); });
    const moon = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.1), new THREE.MeshBasicMaterial({ map: mt, transparent: true, depthWrite: false, ...STENCIL })); moon.position.set(cx - 1.6, 3.75, SZ + 0.01); moon.renderOrder = -9.4; root.add(moon); }
  // 雲:三層很淡的雲帶,各自用不同速度慢慢飄(貼圖往旁邊捲)
  const clouds = [];
  for (const [y, z, op, sp] of [[3.5, L.z - 3.25, 0.32, 0.006], [2.95, L.z - 3.0, 0.22, 0.01], [3.9, L.z - 3.3, 0.18, 0.004]]) {
    const ct = mk(1024, 128, (g, w, h) => { for (let i = 0; i < 26; i++) { const x = Math.random() * w, yy = h * (0.35 + Math.random() * 0.3), r = 30 + Math.random() * 60, gr = g.createRadialGradient(x, yy, 0, x, yy, r); gr.addColorStop(0, 'rgba(255,214,240,.5)'); gr.addColorStop(1, 'rgba(255,214,240,0)'); g.fillStyle = gr; g.fillRect(x - r, yy - r, r * 2, r * 2); } });
    ct.wrapS = THREE.RepeatWrapping; ct.repeat.set(2, 1);
    const cm = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, 0.9), new THREE.MeshBasicMaterial({ map: ct, transparent: true, opacity: op, depthWrite: false, ...STENCIL })); cm.position.set(cx, y, z); cm.renderOrder = -9.2; root.add(cm); clouds.push([ct, sp]);
  }
  // 3. 城市底部的柔和洋紅光(加色混合的漸層面)
  const glowTex = mk(256, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,120,170,0)'); gr.addColorStop(1, 'rgba(255,110,150,.55)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, 2.2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...STENCIL }));
  glow.position.set(cx, 0.6, L.z - 3.1); glow.renderOrder = -9; root.add(glow);
  // 4. 高樓:三層(遠 / 中 / 近),中間夾一層紫色霧氣;窗戶有暖黃、冷白、少數紫 / 青;屋頂有天線(紅色航空燈會閃)、水塔、退縮的頂樓;近景有幾塊直立霓虹招牌
  const winTex = (lit, cool) => { const t = mk(64, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const cells = []; for (let y = 10; y < h - 10; y += 32) for (let x = 10; x < w - 10; x += 32) cells.push([x, y]);
      let on = cells.map(() => Math.random() < lit); while (on.filter(Boolean).length < 3) on[Math.floor(Math.random() * on.length)] = true;
      cells.forEach(([x, y], i) => { if (on[i]) { const r = Math.random(); g.fillStyle = r < 0.62 ? '#ffd27a' : r < 0.84 ? (cool ? '#cfe6ff' : '#ffe9b0') : r < 0.93 ? '#d59bff' : '#8fe8ff'; g.fillRect(x, y, 12, 14); } }); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2); return t; };
  const tops = [];
  const cityLayer = (count, z, hMin, hMax, color, lit, spread, wi, keepTops) => {
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const roof = new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...STENCIL });
    const K = 3, per = Math.ceil(count / K) + 2, ims = [], M = new THREE.Matrix4();
    for (let k = 0; k < K; k++) { const side = new THREE.MeshStandardMaterial({ color, emissive: 0xffffff, emissiveMap: winTex(lit, k === 1), emissiveIntensity: wi, roughness: 0.9, ...STENCIL });
      const im = new THREE.InstancedMesh(geo, [side, side, roof, roof, side, side], per * 2); im.renderOrder = -8; im.count = 0; root.add(im); ims.push(im); }
    let x = cx - spread / 2;
    for (let i = 0; i < count; i++) { const w = rnd(0.3, 0.6), h = rnd(hMin, hMax), d = rnd(0.4, 0.7);
      if (x + w > cx + spread / 2) break;
      const im = ims[i % K]; M.makeScale(w, h, d); M.setPosition(x + w / 2, -0.4, z - d / 2); im.setMatrixAt(im.count++, M);
      if (Math.random() < 0.3) { const w2 = w * rnd(0.45, 0.7), h2 = rnd(0.12, 0.35); M.makeScale(w2, h2, d * 0.7); M.setPosition(x + w / 2, -0.4 + h, z - d / 2); ims[(i + 1) % K].setMatrixAt(ims[(i + 1) % K].count++, M); if (keepTops) tops.push([x + w / 2, -0.4 + h + h2, z - d / 2, w2]); }   // 退縮的頂樓
      else if (keepTops) tops.push([x + w / 2, -0.4 + h, z - d / 2, w]);
      x += w + rnd(0.08, 0.3); }
    ims.forEach((im) => { im.instanceMatrix.needsUpdate = true; }); return ims;
  };
  cityLayer(46, L.z - 2.95, 1.6, 3.2, 0x2f2460, 0.18, S * 3.6, 0.7, false);   // 最遠:很高、很暗,像剪影
  { const ht = mk(64, 256, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(120,80,200,0)'); gr.addColorStop(1, 'rgba(150,90,210,.5)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });   // 霧氣
    const hz = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, 2.4), new THREE.MeshBasicMaterial({ map: ht, transparent: true, depthWrite: false, ...STENCIL })); hz.position.set(cx, 0.8, L.z - 2.4); hz.renderOrder = -7.9; root.add(hz); }
  cityLayer(38, L.z - 2.2, 1.0, 2.5, 0x3b2b6e, 0.3, S * 3.0, 1.05, true);      // 中景
  cityLayer(26, L.z - 1.45, 0.45, 1.4, 0x1f1842, 0.42, S * 2.4, 1.15, true);   // 近景:矮、最深色(上半部留給天空)
  // 屋頂小東西(都要套 stencil,只畫在窗框裡)
  const rf = (c, ex = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.8, ...ex, ...STENCIL });
  const darkM = rf(0x1a1438), beacons = [];
  for (const [x, y, z, w] of tops) {
    const r = Math.random();
    if (r < 0.28) {                                                     // 天線 + 紅色航空燈
      const hh = rnd(0.25, 0.55), ant = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.012, hh, 6), darkM); ant.position.set(x + rnd(-w / 4, w / 4), y + hh / 2, z); ant.renderOrder = -7.8; root.add(ant);
      const bm = rf(0xff3a3a, { emissive: 0xff2020, emissiveIntensity: 1.2 }), b2 = new THREE.Mesh(new THREE.SphereGeometry(0.022, 8, 6), bm); b2.position.set(ant.position.x, y + hh, z); b2.renderOrder = -7.8; root.add(b2); beacons.push([bm, Math.random() * 6]);
    } else if (r < 0.45) {                                              // 水塔
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.12, 10), darkM); tk.position.set(x + rnd(-w / 5, w / 5), y + 0.1, z); tk.renderOrder = -7.8; root.add(tk);
      const cap = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.06, 10), darkM); cap.position.set(tk.position.x, y + 0.19, z); cap.renderOrder = -7.8; root.add(cap);
      for (const dx of [-0.05, 0.05]) { const lg = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.05, 4), darkM); lg.position.set(tk.position.x + dx, y + 0.025, z); lg.renderOrder = -7.8; root.add(lg); }
    }
  }
  // 近景幾塊直立霓虹招牌(粉 / 青)
  for (let i = 0; i < 7; i++) {
    const c = i % 2 ? 0x6ff0ff : 0xff5fb0, hh = rnd(0.25, 0.5);
    const sign = new THREE.Mesh(new THREE.BoxGeometry(0.07, hh, 0.015), rf(c, { emissive: c, emissiveIntensity: 1.1 }));
    sign.position.set(cx + (i - 3) * rnd(0.85, 1.15) + rnd(-0.2, 0.2), rnd(0.15, 0.6), L.z - 1.43); sign.renderOrder = -7.7; root.add(sign);
  }
  // 流星:很亮的頭 + 長長淡出的尾巴(加色),每 3~8 秒劃過一次,偶爾連兩顆;在最遠那排樓後面
  const mtex = mk(512, 32, (g, w, h) => { const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(160,200,255,0)'); gr.addColorStop(0.75, 'rgba(200,225,255,.55)'); gr.addColorStop(0.97, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; const yc = h / 2; g.beginPath(); g.moveTo(0, yc); g.lineTo(w * 0.97, yc - h * 0.35); g.lineTo(w, yc); g.lineTo(w * 0.97, yc + h * 0.35); g.closePath(); g.fill(); });
  const meteors = [0, 1].map(() => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 0.045), new THREE.MeshBasicMaterial({ map: mtex, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, ...STENCIL })); m.renderOrder = -9.3; m.visible = false; root.add(m); return { m, t0: -1 }; });
  let nextMeteor = 2.5;
  window.__meteorNow = () => { nextMeteor = 0; };   // 除錯 / 截圖用:馬上來一顆流星
  const launch = (t, mt) => { const fromLeft = Math.random() < 0.5, ang = THREE.MathUtils.degToRad(rnd(18, 34));
    mt.dir = new THREE.Vector3(fromLeft ? Math.cos(ang) : -Math.cos(ang), -Math.sin(ang), 0); mt.start = new THREE.Vector3(cx + rnd(-2.2, 2.2) - mt.dir.x * 1.2, rnd(3.3, 4.2), SZ + 0.02);
    mt.t0 = t; mt.dur = rnd(0.7, 1.1); mt.len = rnd(0.7, 1.2); mt.speed = rnd(3.2, 4.6); mt.m.rotation.z = Math.atan2(mt.dir.y, mt.dir.x); mt.m.visible = true; };
  idleAnims.push((t) => {
    starU.uTime.value = t;
    for (const [ct, sp] of clouds) ct.offset.x = (t * sp) % 1;
    for (const [bm, ph] of beacons) bm.emissiveIntensity = Math.sin(t * 2.4 + ph) > 0.6 ? 1.4 : 0.15;
    if (t > nextMeteor) { launch(t, meteors[0]); if (Math.random() < 0.25) meteors[1].pending = t + rnd(0.25, 0.6); nextMeteor = t + rnd(3, 8); }   // 1/4 的機會緊接著再來一顆
    if (meteors[1].pending && t > meteors[1].pending) { meteors[1].pending = 0; launch(t, meteors[1]); }
    for (const mt of meteors) {
      if (mt.t0 < 0) continue;
      const p = (t - mt.t0) / mt.dur;
      if (p >= 1) { mt.t0 = -1; mt.m.visible = false; continue; }
      const head = mt.start.clone().addScaledVector(mt.dir, mt.speed * (t - mt.t0)), L2 = mt.len * Math.min(1, p * 3);
      mt.m.scale.x = L2; mt.m.position.copy(head).addScaledVector(mt.dir, -L2 / 2);
      mt.m.material.opacity = Math.sin(Math.min(1, p) * Math.PI);
    }
  });
  // 5. 開口前一片玻璃:很淡、很光滑,室內的燈會在上面留一點反光
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), new THREE.MeshStandardMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.35, depthWrite: false }));
  glass.position.set(cx, 0.5 + openH / 2, L.z + T / 2 + 0.02); glass.renderOrder = 5; root.add(glass);
  // 6. 夜景的冷光:從窗戶往房間打一盞低強度藍紫 RectAreaLight(窗框、層板、街機都會吃到)
  RectAreaLightUniformsLib.init();
  const cold = new THREE.RectAreaLight(0x8f80ff, 1.4, openW, openH); cold.position.set(cx, 0.5 + openH / 2, L.z + T / 2 + 0.05); cold.lookAt(cx, 1.6, 2); root.add(cold);
}
// ---------- 層架上的東西 ----------
{
  // 霓虹燈管:每條邊 = 外面一層有顏色的玻璃管 + 裡面一條很亮(接近白)的芯,轉角是發光的玻璃彎頭;
  // 中間再一個半透明、會發光的小立體(全息核心),反方向慢慢轉;燈管偶爾輕輕閃一下
  const neonMats = [];
  const neonEdges = (geometry, color) => {
    const g = new THREE.Group(), edges = new THREE.EdgesGeometry(geometry), pos = edges.attributes.position;
    const coreCol = new THREE.Color(color).lerp(new THREE.Color(0xffffff), 0.55);
    const core = new THREE.MeshStandardMaterial({ color: coreCol, emissive: coreCol, emissiveIntensity: 2.0, roughness: 0.3, toneMapped: false });
    const glass = new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.25, roughness: 0.12, transparent: true, opacity: 0.38, clearcoat: 1, depthWrite: false });
    neonMats.push(core);
    const seen = new Set();
    for (let i = 0; i < pos.count; i += 2) {
      const a2 = new THREE.Vector3().fromBufferAttribute(pos, i), b2 = new THREE.Vector3().fromBufferAttribute(pos, i + 1), dv = b2.clone().sub(a2), mid = a2.clone().add(b2).multiplyScalar(0.5), q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.clone().normalize());
      for (const [r2, m2] of [[0.011, core], [0.03, glass]]) { const c2 = new THREE.Mesh(new THREE.CylinderGeometry(r2, r2, dv.length(), 12), m2); c2.position.copy(mid); c2.quaternion.copy(q); if (m2 === core) c2.castShadow = true; g.add(c2); }
      for (const v of [a2, b2]) {
        const k = v.toArray().map((n) => n.toFixed(3)).join(','); if (seen.has(k)) continue; seen.add(k);
        for (const [r2, m2] of [[0.013, core], [0.034, glass]]) { const sp = new THREE.Mesh(new THREE.SphereGeometry(r2, 14, 10), m2); sp.position.copy(v); g.add(sp); }
      }
    }
    // 全息核心:同形狀縮小、半透明發光,反方向轉
    const holo = new THREE.Mesh(geometry.clone().scale(0.42, 0.42, 0.42), new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.6, transparent: true, opacity: 0.32, roughness: 0.1, depthWrite: false, side: THREE.DoubleSide }));
    g.add(holo); g.userData.holo = holo;
    return g;
  };
  // 立方體(粉)
  const g1 = group(-1.35, 3.10, L.z + 0.15);
  const e1 = neonEdges(new THREE.BoxGeometry(0.5, 0.5, 0.5), C.wire1);
  e1.rotation.set(0.5, 0.6, 0.2); g1.add(e1);
  { const l = new THREE.PointLight(C.wire1, 2.2, 2.6, 2); l.position.y = 0.1; g1.add(l); }   // 粉紅光
  g1.userData.jump = { phase: 0.0, height: 0.32, baseY: 3.10 };
  // 四面體(青)
  const g2 = group(-0.45, 3.14, L.z + 0.15);   // 四面體半徑 0.42,離層架面(2.61)要留夠,才不會插進去
  const e2 = neonEdges(new THREE.TetrahedronGeometry(0.42), C.wire2);
  e2.rotation.set(0.3, 0.2, 0.4); g2.add(e2);
  { const l = new THREE.PointLight(C.wire2, 2.2, 2.6, 2); l.position.y = 0.1; g2.add(l); }   // 青色光
  g2.userData.jump = { phase: 1.1, height: 0.28, baseY: 3.14 };
  idleAnims.push((t) => {
    e1.userData.holo.rotation.set(-t * 0.6, -t * 0.9, 0); e2.userData.holo.rotation.set(t * 0.7, -t * 0.5, t * 0.3);
    neonMats.forEach((m2, i) => { const fl = Math.sin(t * 41 + i * 3) > 0.985 ? 0.55 : 1; m2.emissiveIntensity = 2.0 * fl * (0.94 + 0.06 * Math.sin(t * 3.1 + i)); });   // 偶爾閃一下 + 輕微呼吸
  });
  // 流體沙畫(像照片那種會流動的沙漏畫):黑框 + 弧形黑腳架 + 金色轉軸。配色「夜景城市的夕陽」:靛藍、紫、洋紅、珊瑚、少許金砂,泡在桃色→淡紫的液體裡。
  // 上面那團沙慢慢變薄、沙從幾個地方細細往下流、底下堆出沙丘;約 40 秒流完,整個畫框沿轉軸翻一圈,重新開始
  { const g3 = group(1.1, 2.61, L.z + 0.15);
    const PW = 0.56, PH = 0.38, FB = 0.035, CY = 0.29;                     // 畫面寬高、框條寬、轉軸高度
    const CW = 384, CH = 260, cv = document.createElement('canvas'); cv.width = CW; cv.height = CH; const g = cv.getContext('2d');
    const PAL = ['#2b1d5c', '#4a2f8f', '#7b3fa8', '#c2387a', '#e8567e', '#ff7a6b', '#ffb08a', '#fff0e6'];
    // 沙的分層(帶顆粒):上面那團、下面沙丘各一張,用畫的時候再依形狀切出來
    const strata = (seed) => { const c = document.createElement('canvas'); c.width = CW; c.height = CH; const x2 = c.getContext('2d'); let r = seed;
      const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
      const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
      for (let y = 0; y < CH; y += 2) for (let x = 0; x < CW; x += 2) {
        const v = y + 14 * Math.sin(x * 0.018 + ph[0]) + 7 * Math.sin(x * 0.051 + ph[1] + y * 0.02) + 4 * Math.sin(x * 0.13 + ph[2]);
        const band = Math.floor(v / 22), col = PAL[((band % PAL.length) + PAL.length) % PAL.length];
        x2.fillStyle = col; x2.fillRect(x, y, 2, 2);
        if (rnd() < 0.18) { x2.fillStyle = rnd() < 0.5 ? 'rgba(255,255,255,.25)' : 'rgba(0,0,0,.18)'; x2.fillRect(x, y, 1, 1); }   // 顆粒
        if (rnd() < 0.004) { x2.fillStyle = '#f3c873'; x2.fillRect(x, y, 2, 2); }                                                  // 金砂
      }
      return c; };
    let top = strata(7), bot = strata(19), streams = [], cycle = 0;
    const newStreams = () => { streams = [0.2, 0.47, 0.78].map((p) => ({ x: (p + (Math.random() - 0.5) * 0.08) * CW, w: 3 + Math.random() * 3, rate: 0.7 + Math.random() * 0.6 })); };
    newStreams();
    const bump = (x, k) => 6 * Math.sin(x * 0.07 + k) + 4 * Math.sin(x * 0.19 + k * 2) + 3 * Math.abs(Math.sin(x * 0.045 + k));
    const dune = (x, a) => 8 + a * streams.reduce((s2, st) => s2 + 70 * st.rate * Math.exp(-(((x - st.x) / 46) ** 2)), 0) + a * 10;
    // 液體:桃色 → 粉 → 淡紫(太淡會變白,沙的顏色跳不出來)
    const draw = (t, a) => {                       // a:這一輪流了多少(0 → 1)
      const lg = g.createLinearGradient(0, 0, 0, CH); lg.addColorStop(0, '#f7b99c'); lg.addColorStop(0.55, '#f1b3bf'); lg.addColorStop(1, '#cdb4ee'); g.fillStyle = lg; g.fillRect(0, 0, CW, CH);
      // 上面那團沙:底邊有圓圓的凸起,越流越往上縮
      const edge = (x) => CH * 0.46 - a * CH * 0.3 + bump(x, cycle);
      for (let x = 0; x < CW; x += 2) { const e = Math.max(4, edge(x)); g.drawImage(top, x, CH - e, 2, e, x, 0, 2, e); }
      // 沙丘:分層跟著沙丘的形狀彎
      for (let x = 0; x < CW; x += 2) { const h = dune(x, a); g.drawImage(bot, x, 0, 2, h, x, CH - h, 2, h); }
      // 細細的沙流(一顆顆往下掉)
      for (const st of streams) {
        const y0 = Math.max(4, edge(st.x)), y1 = CH - dune(st.x, a); if (y1 <= y0) continue;
        for (let i = 0; i < 70; i++) { const fy = y0 + ((i * 37 + t * 90 * st.rate) % (y1 - y0)); g.fillStyle = PAL[(i + Math.floor(st.x)) % PAL.length]; g.globalAlpha = 0.55; g.fillRect(st.x + (Math.sin(i * 12.9) * st.w), fy, 1.6, 2.2); }
        g.globalAlpha = 1;
      }
      // 金砂閃一閃
      for (let i = 0; i < 10; i++) { const x = (i * 97 + 31) % CW, y = ((i * 53) % 60) + 8; if (y < edge(x) - 4) { g.fillStyle = `rgba(255,224,150,${0.4 + 0.6 * Math.abs(Math.sin(t * 2 + i))})`; g.fillRect(x, y, 2, 2); } }
      tex.needsUpdate = true;
    };
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const picMat = new THREE.MeshStandardMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.22, roughness: 0.35 });   // 自發光 < 0.5:不會被當成發光物
    const pic = new THREE.Group(); pic.position.y = CY; g3.add(pic);           // 畫框本體(會繞 x 軸翻)
    const front = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), picMat); front.position.z = 0.006; pic.add(front);
    const back = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), picMat); back.position.z = -0.006; back.rotation.x = Math.PI; pic.add(back);   // 翻過來時這面朝前,畫面一樣是正的
    const frameMat = mat(0x1c1a1f, { roughness: 0.45 });
    for (const [w, h, x, y] of [[PW + FB * 2, FB, 0, PH / 2 + FB / 2], [PW + FB * 2, FB, 0, -PH / 2 - FB / 2], [FB, PH, PW / 2 + FB / 2, 0], [FB, PH, -PW / 2 - FB / 2, 0]]) {
      const bar = new THREE.Mesh(new RoundedBoxGeometry(w, h, 0.03, 2, 0.008), frameMat); bar.position.set(x, y, 0); bar.castShadow = true; pic.add(bar); }
    const glassF = new THREE.Mesh(new THREE.PlaneGeometry(PW, PH), new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.05, transparent: true, opacity: 0.08, clearcoat: 1 }));
    glassF.position.z = 0.012; pic.add(glassF);
    // 腳架:弧形底座 + 兩支立柱 + 金色轉軸
    const standMat = mat(0x1c1a1f, { roughness: 0.4 }), goldM = new THREE.MeshStandardMaterial({ color: 0xe2b84f, metalness: 0.85, roughness: 0.3 });
    const SX = PW / 2 + FB + 0.03;
    const arc = new THREE.Mesh(new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(new THREE.Vector3(-SX, 0.03, 0), new THREE.Vector3(0, -0.01, 0), new THREE.Vector3(SX, 0.03, 0)), 30, 0.013, 8), standMat);
    arc.scale.z = 2.2; arc.castShadow = true; g3.add(arc);
    for (const sx of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.022, CY - 0.02, 0.03), standMat); post.position.set(sx * SX, (CY + 0.02) / 2, 0); post.rotation.z = sx * 0.06; post.castShadow = true; g3.add(post);
      const pv = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.03, 16), goldM); pv.rotation.z = Math.PI / 2; pv.position.set(sx * (SX - 0.018), CY, 0); g3.add(pv);
    }
    // 動畫:10 fps 重畫;流完就翻面(1.2 秒,翻到一半時重設,看起來就是翻過去重新開始)
    const RUN = 40, FLIP = 1.2; let lastF = -1, startT = null, flipping = false, flipStart = 0, baseRot = 0, swapped = false;
    idleAnims.push((t) => {
      if (startT === null) startT = t;
      let a = Math.min(1, (t - startT) / RUN);
      if (!flipping && a >= 1) { flipping = true; flipStart = t; baseRot = pic.rotation.x; swapped = false; }
      if (flipping) {
        const p = Math.min(1, (t - flipStart) / FLIP);
        pic.rotation.x = baseRot + p * p * (3 - 2 * p) * Math.PI;
        if (p >= 0.5 && !swapped) { swapped = true; cycle++; top = strata(7 + cycle * 13); bot = strata(19 + cycle * 7); newStreams(); lastF = -1; }
        a = swapped ? 0 : 1;
        if (p >= 1) { flipping = false; startT = t; pic.rotation.x = baseRot + Math.PI; }
      }
      const f = Math.floor(t * 10); if (f === lastF) return; lastF = f;
      draw(t, a);
    });
  }
}

// ---------- 窗前層架的小東西(原本太空):上層熔岩燈、書堆 + 復古鬧鐘(指針照真實時間走);下層金色公牛、粉紅小豬撲滿 + 金幣、
//            黑膠唱盤(唱片會轉)+ 唱片封套、三盆多肉;兩層前緣各一串會微微閃的暖色串燈 ----------
{
  const TOP = 2.61, LOW = 1.71, ZC = L.z + 0.12, FRONT = L.z + 0.15 + 0.35;
  const gold = new THREE.MeshStandardMaterial({ color: 0xe0b24e, metalness: 0.9, roughness: 0.25 });
  const M = (c, ex = {}) => mat(c, ex);
  const put = (geo, m2, x, y, z, parent, rot) => { const o = new THREE.Mesh(geo, m2); o.position.set(x, y, z); if (rot) o.rotation.set(...rot); o.castShadow = true; parent.add(o); return o; };
  // 熔岩燈(上層):深紫金屬底座 + 粉紅玻璃瓶 + 裡面幾團會上下飄、會變形的發光蠟
  { const g = group(0.3, TOP, ZC);
    const baseM = M(0x3b2a5e, { metalness: 0.6, roughness: 0.3 });
    put(new THREE.CylinderGeometry(0.05, 0.085, 0.13, 24), baseM, 0, 0.065, 0, g);
    put(new THREE.CylinderGeometry(0.03, 0.045, 0.05, 24), baseM, 0, 0.415, 0, g);
    const bottle = new THREE.Mesh(new THREE.LatheGeometry([[0.045, 0], [0.065, 0.06], [0.06, 0.16], [0.032, 0.26]].map(([r, y]) => new THREE.Vector2(r, y)), 32),
      new THREE.MeshPhysicalMaterial({ color: 0xff8fc8, emissive: 0xff5fa8, emissiveIntensity: 0.3, transparent: true, opacity: 0.45, roughness: 0.1, clearcoat: 1, depthWrite: false }));
    bottle.position.y = 0.13; g.add(bottle);
    const blobs = [0, 1, 2, 3].map((i) => { const b = put(new THREE.SphereGeometry(0.022 + (i % 2) * 0.008, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffa060, emissive: 0xff7a3c, emissiveIntensity: 1.1 }), 0, 0.17, 0, g); return { b, ph: i * 1.7, sp: 0.18 + i * 0.05 }; });
    idleAnims.push((t) => { for (const { b, ph, sp } of blobs) { const u = 0.5 + 0.5 * Math.sin(t * sp + ph), y = 0.15 + u * 0.2, r = 0.06 - Math.abs(y - 0.24) * 0.12;
      b.position.set(Math.sin(t * 0.3 + ph) * r * 0.4, y, Math.cos(t * 0.27 + ph) * r * 0.4); b.scale.set(1 + 0.15 * Math.sin(t * 0.9 + ph), 1.2 + 0.3 * Math.sin(t * 0.7 + ph * 2), 1); } }); }
  // 書堆 + 復古雙鈴鬧鐘(上層,沙畫右邊):指針跟著真實時間
  { const g = group(1.66, TOP, ZC + 0.04);   // 右邊的窗柱從 x≈1.88 開始,東西要放在它左邊,不然會陷進牆裡
    [[0.34, 0.05, 0.24, 0x7b5cf5, 0.05], [0.3, 0.045, 0.22, 0x46bfcf, -0.08], [0.32, 0.04, 0.23, 0xf5c451, 0.12]].reduce((y, [w, h, d, c, ry]) => { put(new RoundedBoxGeometry(w, h, d, 2, 0.006), M(c), 0, y + h / 2, 0, g, [0, ry, 0]); return y + h; }, 0);
    const ck = new THREE.Group(); ck.position.set(0, 0.135, 0.02); ck.rotation.y = -0.25; g.add(ck);
    const red = M(0xf27a5a, { roughness: 0.35 });
    put(new THREE.CylinderGeometry(0.075, 0.075, 0.045, 32), red, 0, 0.09, 0, ck, [Math.PI / 2, 0, 0]);
    const fc = document.createElement('canvas'); fc.width = fc.height = 128; const fg = fc.getContext('2d');
    fg.fillStyle = '#fff8ec'; fg.beginPath(); fg.arc(64, 64, 62, 0, 7); fg.fill(); fg.fillStyle = '#3b2f2a';
    for (let i = 0; i < 12; i++) { const a = i / 12 * Math.PI * 2; fg.fillRect(64 + Math.sin(a) * 50 - 2, 64 - Math.cos(a) * 50 - (i % 3 ? 2 : 5), 4, i % 3 ? 4 : 10); }
    const ft = new THREE.CanvasTexture(fc); ft.colorSpace = THREE.SRGBColorSpace;
    put(new THREE.CircleGeometry(0.063, 32), new THREE.MeshStandardMaterial({ map: ft, roughness: 0.5 }), 0, 0.09, 0.0235, ck);
    const hand = (len, w) => { const h = new THREE.Group(); h.position.set(0, 0.09, 0.026); ck.add(h); const m2 = new THREE.Mesh(new THREE.BoxGeometry(w, len, 0.002), M(0x3b2f2a)); m2.position.y = len / 2; h.add(m2); return h; };
    const hh = hand(0.035, 0.006), mh = hand(0.052, 0.004);
    for (const sx of [-1, 1]) { put(new THREE.SphereGeometry(0.03, 16, 10, 0, Math.PI * 2, 0, Math.PI / 2), gold, sx * 0.05, 0.16, -0.005, ck, [0, 0, -sx * 0.5]); put(new THREE.CylinderGeometry(0.005, 0.005, 0.05, 6), gold, sx * 0.05, 0.03, 0, ck, [0, 0, sx * 0.35]); }
    put(new THREE.SphereGeometry(0.01, 8, 6), gold, 0, 0.17, 0, ck);
    idleAnims.push(() => { const d = new Date(), m = d.getMinutes() + d.getSeconds() / 60, h = (d.getHours() % 12) + m / 60; mh.rotation.z = -m / 60 * Math.PI * 2; hh.rotation.z = -h / 12 * Math.PI * 2; }); }
  // 金色公牛(下層左邊):往前衝的低多邊形公牛,黑色大理石底座
  { const g = group(-1.3, LOW, ZC); g.rotation.y = 0.5;
    put(new RoundedBoxGeometry(0.32, 0.04, 0.16, 2, 0.01), M(0x1e1a24, { roughness: 0.3, metalness: 0.2 }), 0, 0.02, 0, g);
    const bull = new THREE.Group(); bull.position.y = 0.04; g.add(bull);
    const body = put(new THREE.SphereGeometry(0.07, 8, 6), gold, 0, 0.1, 0, bull); body.scale.set(1.6, 0.85, 0.75);
    const head = put(new THREE.SphereGeometry(0.04, 8, 6), gold, 0.115, 0.08, 0, bull); head.scale.set(1.2, 0.9, 0.85);
    for (const sz of [-1, 1]) { put(new THREE.ConeGeometry(0.01, 0.05, 6), gold, 0.12, 0.125, sz * 0.03, bull, [sz * 0.9, 0, -0.5]);
      for (const sx of [-1, 1]) { const leg = put(new THREE.CylinderGeometry(0.012, 0.01, 0.07, 6), gold, sx * 0.06, 0.035, sz * 0.03, bull, [0, 0, sx * 0.35]); leg.position.x += sx * 0.01; } }
    put(new THREE.CylinderGeometry(0.004, 0.003, 0.08, 5), gold, -0.12, 0.13, 0, bull, [0, 0, 0.9]); }
  // 粉紅小豬撲滿 + 一疊金幣(下層)
  { const g = group(-0.2, LOW, ZC); g.rotation.y = 0.35;
    const pink = M(0xffa7c4, { roughness: 0.35 });
    const body = put(new THREE.SphereGeometry(0.08, 24, 18), pink, 0, 0.09, 0, g); body.scale.set(1.25, 1, 1);
    put(new THREE.CylinderGeometry(0.03, 0.03, 0.025, 20), pink, 0.1, 0.09, 0, g, [0, 0, Math.PI / 2]);
    for (const dz of [-0.01, 0.01]) put(new THREE.CircleGeometry(0.006, 10), M(0xd9648a), 0.1135, 0.09, dz, g, [0, Math.PI / 2, 0]);
    for (const sz of [-1, 1]) { put(new THREE.ConeGeometry(0.02, 0.035, 10), pink, 0.05, 0.165, sz * 0.04, g, [sz * 0.3, 0, -0.3]); put(new THREE.SphereGeometry(0.008, 8, 6), M(0x3b2f2a), 0.085, 0.115, sz * 0.03, g);
      for (const sx of [-1, 1]) put(new THREE.CylinderGeometry(0.016, 0.016, 0.03, 10), pink, sx * 0.05, 0.015, sz * 0.04, g); }
    put(new THREE.BoxGeometry(0.035, 0.004, 0.008), M(0x3b2f2a), -0.01, 0.178, 0, g);
    for (let i = 0; i < 5; i++) put(new THREE.CylinderGeometry(0.022, 0.022, 0.007, 20), gold, 0.0 + (i % 2) * 0.003, 0.0035 + i * 0.0075, 0.13, g); }
  // 黑膠唱盤(下層中間):木頭底座、轉動的唱片(紋路 + 彩色圓標)、唱臂;旁邊斜靠兩張唱片封套
  { const g = group(0.85, LOW, ZC); g.rotation.y = -0.15;
    put(new RoundedBoxGeometry(0.42, 0.06, 0.34, 2, 0.015), new THREE.MeshStandardMaterial({ map: woodTex(512, 128, 'u', '#c99566', [110, 66, 34]), roughness: 0.5 }), 0, 0.03, 0, g);
    put(new THREE.CylinderGeometry(0.15, 0.15, 0.012, 40), M(0x2a2533, { metalness: 0.5, roughness: 0.4 }), -0.05, 0.066, 0, g);
    const rc = document.createElement('canvas'); rc.width = rc.height = 256; const rg = rc.getContext('2d');
    rg.fillStyle = '#111014'; rg.beginPath(); rg.arc(128, 128, 128, 0, 7); rg.fill();
    rg.strokeStyle = 'rgba(255,255,255,.07)'; for (let r = 40; r < 126; r += 3) { rg.beginPath(); rg.arc(128, 128, r, 0, 7); rg.stroke(); }
    rg.fillStyle = '#ff6fa8'; rg.beginPath(); rg.arc(128, 128, 36, 0, 7); rg.fill(); rg.fillStyle = '#fff'; rg.font = 'bold 13px sans-serif'; rg.textAlign = 'center'; rg.fillText('CAT FM', 128, 124); rg.fillStyle = '#111'; rg.beginPath(); rg.arc(128, 128, 4, 0, 7); rg.fill();
    const rt = new THREE.CanvasTexture(rc); rt.colorSpace = THREE.SRGBColorSpace;
    const vinyl = put(new THREE.CircleGeometry(0.14, 48), new THREE.MeshStandardMaterial({ map: rt, roughness: 0.25, metalness: 0.2, transparent: true }), -0.05, 0.0735, 0, g, [-Math.PI / 2, 0, 0]);
    put(new THREE.CylinderGeometry(0.018, 0.018, 0.03, 16), M(0xd8d4e2, { metalness: 0.7, roughness: 0.3 }), 0.15, 0.075, -0.11, g);
    const arm = new THREE.Group(); arm.position.set(0.15, 0.09, -0.11); arm.rotation.y = 0.55; g.add(arm);
    put(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 8), M(0xd8d4e2, { metalness: 0.7, roughness: 0.3 }), 0, 0, 0.1, arm, [Math.PI / 2, 0, 0]);
    put(new RoundedBoxGeometry(0.02, 0.012, 0.035, 1, 0.004), M(0x2a2533), 0, -0.006, 0.2, arm);
    idleAnims.push((t) => { vinyl.rotation.z = -t * 3.5; });   // 33⅓ 轉
    for (const [x, c, ry] of [[0.33, 0x46bfcf, 0.12], [0.37, 0xf5c451, -0.06]]) { const sl = put(new RoundedBoxGeometry(0.3, 0.3, 0.008, 1, 0.004), M(c), x, 0.15, -0.08, g, [0.18, Math.PI / 2 + ry, 0]);
      const dot = put(new THREE.CircleGeometry(0.06, 24), M(0xfff4e6), 0, 0, 0.0045, sl); dot.castShadow = false; } }
  // 三盆多肉(下層右邊):粉彩小盆 + 一圈圈尖葉
  [[1.42, 0xf3c9db, 0x6fbf8a], [1.58, 0xcbb8f0, 0x8fd1a0], [1.74, 0xfde2a7, 0x5aa87a]].forEach(([x, pc, lc], k) => {   // 都在右邊窗柱(x≈1.88)的左邊
    const g = group(x, LOW, ZC + (k % 2) * 0.05);
    put(new THREE.CylinderGeometry(0.055, 0.042, 0.075, 20), M(pc, { roughness: 0.4 }), 0, 0.0375, 0, g);
    put(new THREE.CylinderGeometry(0.05, 0.05, 0.008, 20), M(0x4a3426), 0, 0.074, 0, g);
    const leaf = M(lc, { roughness: 0.55 });
    for (let ring = 0; ring < 3; ring++) { const n = 7 - ring * 2, r = 0.035 - ring * 0.012, tilt = 0.9 - ring * 0.3;
      for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2 + ring * 0.4; const lf = put(new THREE.ConeGeometry(0.014, 0.05 - ring * 0.008, 6), leaf, Math.cos(a) * r, 0.09 + ring * 0.012, Math.sin(a) * r, g);
        lf.rotation.set(0, -a, 0); lf.rotateZ(-tilt); lf.scale.z = 0.5; } } });
  // 兩層前緣的串燈:微微下垂的電線 + 一顆顆暖色小燈泡(分三組輪流微閃)
  const bulbMats = [0, 1, 2].map(() => new THREE.MeshStandardMaterial({ color: 0xfff1d0, emissive: 0xffc77a, emissiveIntensity: 1.3 }));
  for (const y of [TOP - 0.05, LOW - 0.05]) {
    const pts = [], N = 26, x0 = SHELF_X0 + 0.08, x1 = SHELF_X1 - 0.08;
    for (let i = 0; i <= 200; i++) { const u = i / 200, x = x0 + (x1 - x0) * u, seg = (u * 5) % 1; pts.push(new THREE.Vector3(x, y - Math.sin(seg * Math.PI) * 0.05, FRONT + 0.012)); }
    const wire = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 200, 0.0025, 4), M(0x3a3340)); root.add(wire);
    for (let i = 0; i < N; i++) { const p = pts[Math.round((i + 0.5) / N * 200)]; const b = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), bulbMats[i % 3]); b.position.set(p.x, p.y - 0.016, p.z); root.add(b); }
  }
  idleAnims.push((t) => { bulbMats.forEach((m2, i) => { m2.emissiveIntensity = 1.0 + 0.35 * Math.sin(t * 1.7 + i * 2.1); }); });
}

// ---------- 街機(Meshy GLB:arcade.glb,Draco 壓縮 + 貼圖 1024)----------
const ARCADE_H = 2.5;                                            // 機台高度
let arcadeModel = null, arcadeAnchor = null, playTag = null, arcadeScreen = null, arcadeScreenTex = null, arcadeMarquee = null;
const arcadeCanvas = document.createElement('canvas'); arcadeCanvas.width = 520; arcadeCanvas.height = 385;
// 共用的 GLB 載入器:Draco 解碼器只載一次並預先載入;載入狀態顯示在開頭的 loading 文字,失敗時印出原因(不然模型不見了也不知道為什麼)
const loadingEl = document.getElementById('loading');
const pending = new Set();
const noteLoad = (name, state) => { if (state === 'done') pending.delete(name); else pending.add(name); if (loadingEl) loadingEl.textContent = pending.size ? `loading ${[...pending].join(' + ')}…` : 'building the room…'; };
const glbLoader = (() => {
  const draco = new DRACOLoader(); draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/'); draco.preload();
  const loader = new GLTFLoader(); loader.setDRACOLoader(draco); return loader;
})();
function loadGLB(name, url, onLoad) {
  noteLoad(name, 'start');
  glbLoader.load(url, (gltf) => { noteLoad(name, 'done'); onLoad(gltf); }, undefined,
    (err) => { noteLoad(name, 'done'); console.error(`[catinsight-3d] ${name} 載入失敗:`, err); });
}
{
  // 街機:純幾何重做(原本是 AI 生成的 arcade.glb,貼圖有髒污、邊緣不乾淨)。原點在背面底部中央,+z 朝房間
  const a = group(-S / 2 + 0.12 + 0.66, 0, L.z + T / 2);         // 最左邊、背面貼牆
  const m = new THREE.Group(); a.add(m); arcadeModel = m;
  const P = { parent: m };
  const W = 1.3, D = 1.36, IN = 1.12;                             // 外寬、下半身深度、兩片側板之間的寬度
  const DARK = 0x2a2140, RED = 0xe2553d, PURPLE = 0x7b5cf5;
  // 小工具:canvas 貼圖
  const canvasTex = (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h); const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const planeOn = (parent, w, h, tex, x, y, z, rx = 0, ex = {}) => { const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, ...ex })); p.position.set(x, y, z); p.rotation.x = rx; parent.add(p); return p; };
  // 兩片側板(薰衣草紫):街機側面輪廓 —— 下半身較淺、操作檯那段往前凸、螢幕那段往後斜收、最上面招牌再往前凸。座標是(深度 z, 高度 y),用 Shape 擠出厚度。
  // 側面印側板圖(珊瑚 / 橘 / 黃的大斜紋、星星、大貓掌),邊緣包一圈粉紅色 T 型飾條
  const prof = [[0, 0], [1.36, 0], [1.36, 0.62], [1.62, 0.76], [1.62, 1.34], [1.50, 1.46], [1.24, 1.53], [1.08, 2.18], [1.36, 2.23], [1.36, ARCADE_H], [0, ARCADE_H]];
  {
    const shape = new THREE.Shape(); prof.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y))); shape.closePath();
    const TH = 0.09, BV = 0.014;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: TH - BV * 2, bevelEnabled: true, bevelThickness: BV, bevelSize: BV, bevelSegments: 2, curveSegments: 4 });
    const art = canvasTex(512, 790, (g, w, h) => {                   // u = 深度 z / 1.62、v = 高度 / 2.5(canvas 的 y 往下,所以畫的時候上下顛倒想)
      g.fillStyle = '#b89ad3'; g.fillRect(0, 0, w, h);
      const Y = (y) => h - y / ARCADE_H * h, Z = (z) => z / 1.62 * w;
      [['#ffd36a', 0], ['#ff9a5a', 46], ['#f25f7a', 92]].forEach(([c, o]) => {   // 從前下往後上的大斜紋
        g.fillStyle = c; g.beginPath(); g.moveTo(Z(1.62), Y(0.35 + o / 200)); g.bezierCurveTo(Z(1.1), Y(0.9 + o / 200), Z(0.6), Y(1.4 + o / 200), Z(0), Y(2.05 + o / 200));
        g.lineTo(Z(0), Y(2.25 + o / 200)); g.bezierCurveTo(Z(0.7), Y(1.6 + o / 200), Z(1.15), Y(1.12 + o / 200), Z(1.62), Y(0.6 + o / 200)); g.closePath(); g.fill(); });
      g.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 26; i++) { const x = (i * 137) % w, y = (i * 211) % h, r = 2 + (i % 3) * 2; g.beginPath(); for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4, rr = k % 2 ? r * 0.4 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); }
      g.fillStyle = 'rgba(255,255,255,.85)'; const px = Z(0.62), py = Y(0.55);                   // 大貓掌
      g.beginPath(); g.ellipse(px, py, 62, 52, 0, 0, Math.PI * 2); g.fill();
      for (const [dx, dy, r] of [[-62, -70, 22], [-22, -96, 24], [24, -96, 24], [62, -70, 22]]) { g.beginPath(); g.ellipse(px + dx, py + dy, r, r * 1.2, 0, 0, Math.PI * 2); g.fill(); }
    });
    art.repeat.set(1 / 1.62, 1 / ARCADE_H);
    const sideArt = new THREE.MeshStandardMaterial({ map: art, roughness: 0.7 }), edge = mat(C.arcade);
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(geo, [sideArt, edge]); sp.rotation.y = -Math.PI / 2;      // Shape 的 x → 世界 +z,擠出方向 → 世界 -x;第 0 組是兩面(印圖)、第 1 組是邊
      sp.position.set(sx > 0 ? W / 2 - BV : -W / 2 + TH - BV, 0, 0);
      sp.castShadow = true; sp.receiveShadow = true; m.add(sp);
      // T 型飾條:沿著側板正面那條輪廓(不含底部和貼牆的背面)
      const cx = sx > 0 ? W / 2 - TH / 2 : -W / 2 + TH / 2;
      const pts = prof.slice(1, 10).map(([z, y]) => new THREE.Vector3(cx, y, z));
      const path = new THREE.CurvePath(); for (let i = 0; i < pts.length - 1; i++) path.add(new THREE.LineCurve3(pts[i], pts[i + 1]));
      const trim = new THREE.Mesh(new THREE.TubeGeometry(path, 160, 0.03, 8, false), mat(0xff6fa8, { roughness: 0.35 })); trim.castShadow = true; m.add(trim);
    }
  }
  // 下半身(橘)+ 中央白條
  box(IN, 0.74, 1.3, C.arcadeTop, { ...P, y: 0.37, z: 0.65, r: 0.03 });
  box(0.24, 0.72, 0.02, C.arcadeStripe, { ...P, y: 0.37, z: 1.305, r: 0.008 });
  // 投幣門(金屬):兩個投幣口(紅色投幣燈會輪流亮)、退幣鈕、鑰匙孔;最下面一條金屬踢腳板;四個調整腳
  const steel = new THREE.MeshStandardMaterial({ color: 0xb9b4c4, metalness: 0.75, roughness: 0.35 });
  { const door = new THREE.Mesh(new RoundedBoxGeometry(0.38, 0.4, 0.03, 2, 0.015), steel); door.position.set(0, 0.4, 1.315); door.castShadow = true; m.add(door); }
  const coinLights = [];
  for (const x of [-0.08, 0.08]) {
    box(0.07, 0.11, 0.012, DARK, { ...P, x, y: 0.48, z: 1.334, r: 0.006 });
    const cl = new THREE.Mesh(new RoundedBoxGeometry(0.045, 0.06, 0.008, 1, 0.004), new THREE.MeshStandardMaterial({ color: 0xff6a4a, emissive: 0xff3a1a, emissiveIntensity: 0.9 }));
    cl.position.set(x, 0.49, 1.342); m.add(cl); coinLights.push(cl);
    cyl(0.014, 0.014, 0.012, DARK, { ...P, x, y: 0.4, z: 1.336, rx: Math.PI / 2 });                 // 退幣鈕
  }
  cyl(0.012, 0.012, 0.01, 0x555060, { ...P, x: 0, y: 0.3, z: 1.334, rx: Math.PI / 2 });            // 鑰匙孔
  { const kick = new THREE.Mesh(new RoundedBoxGeometry(IN, 0.11, 0.02, 1, 0.006), steel); kick.position.set(0, 0.075, 1.31); m.add(kick); }
  for (const [x, z] of [[-0.55, 0.12], [0.55, 0.12], [-0.55, 1.25], [0.55, 1.25]]) cyl(0.035, 0.04, 0.03, DARK, { ...P, x, y: 0.015, z });
  // 操作檯底下往前凸的那一段(跟著側板的凸出)
  box(IN, 0.34, 1.52, C.arcadeTop, { ...P, y: 0.86, z: 0.76, r: 0.03 });
  // 操作檯:略往玩家這邊斜。上面貼一層印刷面板(按鈕 / 搖桿周圍白框、斜紋),搖桿在左、三顆大鈕在右,1P / 2P 小開始鈕在中間後面
  const deck = new THREE.Group(); deck.position.set(0, 1.05, 1.2); deck.rotation.x = 0.13; m.add(deck);
  const DP = { parent: deck };
  box(IN, 0.12, 0.78, C.arcadeTop, { ...DP, r: 0.03 });
  { const cp = canvasTex(560, 390, (g, w, h) => {                   // 面板的 x 對應 canvas 橫向(-0.54 → 0.54),z 對應縱向(前緣在下)
      const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, '#2a2140'); gr.addColorStop(1, '#4a2f8f'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,111,168,.35)'; for (let i = -4; i < 10; i++) { g.beginPath(); g.moveTo(i * 70, h); g.lineTo(i * 70 + 40, h); g.lineTo(i * 70 + 240, 0); g.lineTo(i * 70 + 200, 0); g.fill(); }
      const X = (x) => (x + 0.54) / 1.08 * w, Zc = (z) => (z + 0.38) / 0.76 * h;
      g.strokeStyle = '#fff'; g.lineWidth = 4;
      g.beginPath(); g.arc(X(-0.26), Zc(0.12), 62, 0, Math.PI * 2); g.stroke();
      for (const x of [0.08, 0.25, 0.42]) { g.beginPath(); g.arc(X(x), Zc(0.12), 46, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = '#fff'; g.font = 'bold 18px monospace'; g.textAlign = 'center'; g.fillText('1P', X(-0.06), Zc(-0.27)); g.fillText('2P', X(0.06), Zc(-0.27));
    });
    planeOn(deck, IN - 0.04, 0.74, cp, 0, 0.0605, 0, -Math.PI / 2); }
  cyl(0.1, 0.1, 0.01, 0xd8d4e2, { ...DP, x: -0.26, y: 0.064, z: 0.12 });                             // 搖桿:金屬底座 + 黑色防塵片 + 白桿 + 紅球
  cyl(0.07, 0.07, 0.012, DARK, { ...DP, x: -0.26, y: 0.072, z: 0.12 });
  cyl(0.018, 0.02, 0.15, 0xffffff, { ...DP, x: -0.26, y: 0.15, z: 0.12 });
  { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 18), mat(RED, { roughness: 0.35 })); ball.position.set(-0.26, 0.26, 0.12); ball.castShadow = true; deck.add(ball); }
  [[0.08, PURPLE], [0.25, C.arcadeTop], [0.42, C.plant]].forEach(([x, c]) => { cyl(0.074, 0.074, 0.02, 0xd8d4e2, { ...DP, x, y: 0.068, z: 0.12 }); cyl(0.058, 0.062, 0.045, c, { ...DP, x, y: 0.092, z: 0.12 });
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.058, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), mat(c, { roughness: 0.3 })); cap.scale.y = 0.28; cap.position.set(x, 0.114, 0.12); deck.add(cap); });   // 圓凸的按鈕頂
  for (const x of [-0.06, 0.06]) box(0.05, 0.025, 0.035, 0xfff2f5, { ...DP, x, y: 0.072, z: -0.22, r: 0.008 });   // 1P / 2P 開始鈕
  // 上半身(深紫機身)。螢幕下方多一塊凸出的「下巴」:把往後仰的螢幕邊框底下那個空隙補實,上面有三條喇叭孔
  box(IN, 1.26, 0.8, C.arcadeScreen, { ...P, y: 1.6, z: 0.4, r: 0.03 });
  box(IN, 0.42, 1.04, C.arcadeScreen, { ...P, y: 1.28, z: 0.52, r: 0.03 });
  for (let i = 0; i < 3; i++) box(0.34, 0.022, 0.012, DARK, { ...P, y: 1.24 + i * 0.055, z: 1.043, r: 0.004 });
  // 往後仰 20° 的螢幕邊框:深藍底 + 霓虹粉的內框線、角落 1P / 2P、下面 INSERT COIN(螢幕本身那片 canvas 蓋在正中間,位置不變)
  box(IN, 0.9, 0.09, DARK, { ...P, y: 1.82, z: 0.97, rx: -0.35, r: 0.03 });
  { const bz = canvasTex(560, 450, (g, w, h) => {
      g.fillStyle = '#161233'; g.fillRect(0, 0, w, h);
      const sx = (1.12 - 0.98) / 2 / 1.12 * w, sy = (0.9 - 0.72) / 2 / 0.9 * h;
      g.strokeStyle = '#ff6fa8'; g.lineWidth = 5; g.shadowColor = '#ff6fa8'; g.shadowBlur = 10; g.beginPath(); g.roundRect(sx - 9, sy - 9, w - (sx - 9) * 2, h - (sy - 9) * 2, 14); g.stroke(); g.shadowBlur = 0;
      g.fillStyle = '#ffd36a'; g.font = 'bold 15px monospace'; g.textAlign = 'center'; g.fillText('1P', sx / 2 + 6, 22); g.fillText('2P', w - sx / 2 - 6, 22);
      g.fillStyle = '#7fe0ff'; g.font = 'bold 13px monospace'; g.fillText('INSERT COIN', w / 2, h - 6);
    });
    const bezel = new THREE.Group(); bezel.position.set(0, 1.82, 0.97); bezel.rotation.x = -0.35; m.add(bezel);
    planeOn(bezel, IN - 0.02, 0.88, bz, 0, 0, 0.0465); }
  // 招牌(橘框 + 背光燈箱):一整片「CAT STREET STOCKS」,貓掌、金幣、K 棒小圖示;底面要高過 y=2.24,鏡頭正對螢幕時才不會擋到螢幕最上面一排
  box(IN, 0.25, 1.3, C.arcadeTop, { ...P, y: ARCADE_H - 0.125, z: 0.65, r: 0.03 });
  { const mq = canvasTex(800, 150, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, '#3a1f7a'); gr.addColorStop(1, '#1a1240'); g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.75)'; for (let i = 0; i < 40; i++) g.fillRect((i * 97) % w, (i * 53) % h, 2, 2);
      g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = '900 64px "Avenir Next", "Arial Black", Impact, sans-serif';
      g.lineWidth = 10; g.strokeStyle = '#ff6fa8'; g.strokeText('CAT STREET STOCKS', w / 2, h / 2 + 4); g.fillStyle = '#ffd36a'; g.fillText('CAT STREET STOCKS', w / 2, h / 2 + 4);
      const paw = (x, y, r) => { g.fillStyle = '#fff'; g.beginPath(); g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); for (const [dx, dy] of [[-1, -1.2], [-0.35, -1.6], [0.35, -1.6], [1, -1.2]]) { g.beginPath(); g.arc(x + dx * r, y + dy * r * 0.9, r * 0.38, 0, Math.PI * 2); g.fill(); } };
      paw(46, 92, 16); paw(w - 46, 92, 16);
      for (const [x, up] of [[100, 1], [116, 0], [w - 116, 1], [w - 100, 1]]) { g.fillStyle = up ? '#3fc98a' : '#e2553d'; g.fillRect(x - 4, 40, 8, 26); g.fillRect(x - 1, 34, 2, 38); }
    });
    arcadeMarquee = planeOn(m, IN - 0.08, 0.19, mq, 0, ARCADE_H - 0.125, 1.306, 0, { emissive: 0xffffff, emissiveMap: mq, emissiveIntensity: 0.6 }); }
  idleAnims.push((t) => {                                          // 招牌輕輕呼吸、兩個投幣燈輪流亮
    arcadeMarquee.material.emissiveIntensity = 0.55 + 0.08 * Math.sin(t * 1.3);
    coinLights.forEach((cl, i) => { cl.material.emissiveIntensity = Math.sin(t * 2.2 + i * Math.PI) > 0 ? 0.9 : 0.25; });
  });

  // 街機上方的漂浮標記:白色「▶ PLAY」牌子 + 橘色倒三角,會上下漂浮並永遠面向鏡頭;點它等於點街機
  playTag = new THREE.Group(); playTag.position.set(0, ARCADE_H + 0.55, 0.7); playTag.visible = false; a.add(playTag);   // 標記已拿掉(不顯示、不擋點擊),點街機本體就能進
  const tc = document.createElement('canvas'); tc.width = 512; tc.height = 256;
  const g = tc.getContext('2d');
  g.fillStyle = '#ffffff'; g.beginPath(); g.roundRect(8, 8, 496, 240, 70); g.fill();
  g.fillStyle = '#7b5cf5'; g.font = '800 120px -apple-system, Helvetica, Arial'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText('▶ PLAY', 256, 136);
  const tt = new THREE.CanvasTexture(tc); tt.colorSpace = THREE.SRGBColorSpace; tt.anisotropy = 8;
  const tag = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.3), new THREE.MeshBasicMaterial({ map: tt, transparent: true, side: THREE.DoubleSide }));
  tag.position.y = 0.27; playTag.add(tag);
  const tri = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.18, 3), new THREE.MeshStandardMaterial({ color: 0xf08262, roughness: 0.6, flatShading: true }));
  tri.rotation.x = Math.PI; tri.castShadow = true; playTag.add(tri);
  // 街機螢幕:一片會動的 canvas(待機畫面 + 選單),貼在往後仰 20° 的邊框前面
  arcadeScreenTex = new THREE.CanvasTexture(arcadeCanvas); arcadeScreenTex.colorSpace = THREE.SRGBColorSpace; arcadeScreenTex.anisotropy = 8;
  arcadeScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.98, 0.72), new THREE.MeshBasicMaterial({ map: arcadeScreenTex, transparent: true, toneMapped: false }));
  arcadeScreen.position.set(0, 1.82, 1.022); arcadeScreen.rotation.x = -0.35; a.add(arcadeScreen);
  // 街機螢幕的位置(給鏡頭飛過去用):正面、離地約 1.75(螢幕中心)
  arcadeAnchor = new THREE.Object3D(); arcadeAnchor.position.set(0, 1.75, 1.66); a.add(arcadeAnchor);
  const arcGlow = new THREE.PointLight(0x9ad8ff, 2.2, 3.2, 2); arcGlow.position.set(0, 1.7, 1.5); a.add(arcGlow);   // 機台螢幕的青藍光
  if (window.__room) window.__room.arcade = m;
}

// ---------- 攝影機 + 三腳架 ----------
// 可愛的復古攝影機:米白機身 + 珊瑚色飾條、多層鏡頭(深色鏡筒、珊瑚對焦環、遮光罩、深藍鏡片 + 反光)、上提把 + 麥克風、後面觀景窗、
// 側邊翻出來的小螢幕(平常顯示 REC + 時間碼)、會閃的錄影紅燈。三腳架:兩節腳 + 夾扣 + 黑色腳墊、中柱、雲台 + 搖桿。
// 點它一下:轉過來面向你、小螢幕翻到正面變笑臉、點頭兩下打招呼,約 4 秒後回去繼續左右掃
let camHead = null, camRig = null, camGreet = null;
{
  const t = group(-0.55, 0, -1.55); t.rotation.y = -Math.PI / 3; camRig = t;   // 整體朝右轉 60°;靠牆一點
  const DARK = 0x2a2433, CREAM = C.camera, CORAL = C.arcadeTop;
  // 三支腳:上節珊瑚色、下節米白,中間夾扣,腳底黑色墊子
  const legs = 3, head = new THREE.Vector3(0, 1.42, 0), spread = 0.52;
  const seg = (from, to, r, color) => { const d = to.clone().sub(from), m = cyl(r, r, d.length(), color, { parent: t }); m.position.copy(from).add(to).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); return m; };
  for (let i = 0; i < legs; i++) {
    const a = i * (Math.PI * 2 / legs) + 0.4, foot = new THREE.Vector3(Math.sin(a) * spread, 0.03, Math.cos(a) * spread), mid = foot.clone().lerp(head, 0.5);
    seg(head, mid, 0.032, C.tripod); seg(mid, foot, 0.024, CREAM);
    const clamp = cyl(0.04, 0.04, 0.05, DARK, { parent: t }); clamp.position.copy(mid); clamp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), head.clone().sub(foot).normalize());
    sphere(0.035, DARK, { x: foot.x, y: 0.03, z: foot.z, parent: t }).scale.y = 0.6;
  }
  cyl(0.07, 0.06, 0.06, DARK, { y: 1.42, parent: t });                 // 腳的匯合處
  cyl(0.035, 0.035, 0.32, C.tripod, { y: 1.58, parent: t });            // 中柱
  cyl(0.06, 0.06, 0.05, DARK, { y: 1.74, parent: t });                  // 雲台底座
  camHead = new THREE.Group(); camHead.position.y = 1.85; t.add(camHead);
  const hm = (geo, color, x, y, z, ex = {}) => { const m = new THREE.Mesh(geo, color.isMaterial ? color : mat(color, ex)); m.position.set(x, y, z); m.castShadow = true; camHead.add(m); return m; };
  hm(new RoundedBoxGeometry(0.12, 0.05, 0.12, 2, 0.015), DARK, 0, -0.16, 0);                              // 雲台
  { const bar = hm(new THREE.CylinderGeometry(0.014, 0.012, 0.42, 12), DARK, -0.3, -0.24, 0); bar.rotation.z = Math.PI / 2 - 0.45;   // 搖桿(往後下)
    hm(new THREE.CylinderGeometry(0.022, 0.022, 0.1, 12), C.tripod, -0.48, -0.33, 0).rotation.z = Math.PI / 2 - 0.45; }
  // 機身 + 飾條(鏡頭朝 +x)
  hm(new RoundedBoxGeometry(0.46, 0.28, 0.26, 4, 0.06), CREAM, 0, 0, 0);
  hm(new RoundedBoxGeometry(0.3, 0.07, 0.02, 2, 0.01), CORAL, -0.02, -0.07, 0.13);
  hm(new RoundedBoxGeometry(0.3, 0.07, 0.02, 2, 0.01), CORAL, -0.02, -0.07, -0.13);
  // 鏡頭:鏡筒、對焦環(有刻紋)、遮光罩、深藍鏡片 + 一圈反光 + 小亮點
  const lens = (geo, color, x, ex) => { const m = hm(geo, color, x, 0.01, 0, ex); m.rotation.z = Math.PI / 2; return m; };
  lens(new THREE.CylinderGeometry(0.1, 0.1, 0.12, 32), DARK, 0.28);
  lens(new THREE.CylinderGeometry(0.108, 0.108, 0.045, 28), CORAL, 0.255);
  lens(new THREE.CylinderGeometry(0.125, 0.105, 0.06, 32), DARK, 0.365);
  { const g = hm(new THREE.CircleGeometry(0.088, 32), new THREE.MeshPhysicalMaterial({ color: 0x1d2e66, roughness: 0.05, metalness: 0.2, clearcoat: 1 }), 0.396, 0.01, 0); g.rotation.y = Math.PI / 2;
    const rr = hm(new THREE.TorusGeometry(0.06, 0.004, 6, 32), new THREE.MeshBasicMaterial({ color: 0x8fa6ff, transparent: true, opacity: 0.35 }), 0.397, 0.01, 0); rr.rotation.y = Math.PI / 2;
    const hl = hm(new THREE.CircleGeometry(0.016, 16), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }), 0.398, 0.045, 0.03); hl.rotation.y = Math.PI / 2; }
  // 上提把 + 麥克風、後面觀景窗
  { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.17, 0.13, 0), new THREE.Vector3(-0.14, 0.22, 0), new THREE.Vector3(0.08, 0.23, 0), new THREE.Vector3(0.13, 0.13, 0)]);
    hm(new THREE.TubeGeometry(curve, 24, 0.018, 8), DARK, 0, 0, 0);
    const mic = hm(new THREE.CapsuleGeometry(0.03, 0.1, 6, 12), 0x4a4252, 0.12, 0.26, 0, { roughness: 0.95 }); mic.rotation.z = Math.PI / 2; }
  lens(new THREE.CylinderGeometry(0.045, 0.04, 0.09, 20), DARK, -0.27).position.y = 0.06;
  // 錄影紅燈
  const rec = hm(new THREE.SphereGeometry(0.018, 12, 8), new THREE.MeshStandardMaterial({ color: 0xff4d4d, emissive: 0xff3030, emissiveIntensity: 1.2 }), 0.2, 0.11, 0.09);
  // 側邊翻出來的小螢幕(鉸鏈在機身左側前緣):平常半開、REC + 時間碼;打招呼時翻到正面顯示笑臉
  const lcd = new THREE.Group(); lcd.position.set(0.12, 0.0, 0.135); camHead.add(lcd);
  { const p = new THREE.Mesh(new RoundedBoxGeometry(0.2, 0.13, 0.016, 2, 0.01), mat(DARK)); p.position.x = -0.1; p.castShadow = true; lcd.add(p); }
  const lc = document.createElement('canvas'); lc.width = 96; lc.height = 64; const lg = lc.getContext('2d');
  const lcdTex = new THREE.CanvasTexture(lc); lcdTex.colorSpace = THREE.SRGBColorSpace;
  { const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.11), new THREE.MeshStandardMaterial({ map: lcdTex, emissive: 0xffffff, emissiveMap: lcdTex, emissiveIntensity: 0.35, roughness: 0.3 })); sc.position.set(-0.1, 0, 0.009); lcd.add(sc); }
  let lcdMode = '', lcdSec = -1;
  const drawLcd = (mode, sec) => {
    if (mode === lcdMode && sec === lcdSec) return; lcdMode = mode; lcdSec = sec;
    if (mode === 'smile') {
      lg.fillStyle = '#ffd9e6'; lg.fillRect(0, 0, 96, 64);
      lg.strokeStyle = '#3b2f2a'; lg.lineWidth = 4; lg.lineCap = 'round';
      for (const x of [32, 64]) { lg.beginPath(); lg.arc(x, 30, 8, Math.PI * 1.1, Math.PI * 1.9); lg.stroke(); }   // ^ ^
      lg.fillStyle = 'rgba(255,110,140,.55)'; for (const x of [20, 76]) { lg.beginPath(); lg.ellipse(x, 40, 7, 4, 0, 0, Math.PI * 2); lg.fill(); }
      lg.beginPath(); lg.arc(48, 40, 6, 0.15 * Math.PI, 0.85 * Math.PI); lg.stroke();
    } else {
      lg.fillStyle = '#1d2240'; lg.fillRect(0, 0, 96, 64);
      lg.strokeStyle = 'rgba(255,255,255,.5)'; lg.lineWidth = 1.5; for (const [x, y, dx, dy] of [[6, 6, 1, 1], [90, 6, -1, 1], [6, 58, 1, -1], [90, 58, -1, -1]]) { lg.beginPath(); lg.moveTo(x, y + dy * 8); lg.lineTo(x, y); lg.lineTo(x + dx * 8, y); lg.stroke(); }
      if (sec % 2 === 0) { lg.fillStyle = '#ff4d4d'; lg.beginPath(); lg.arc(14, 15, 4, 0, Math.PI * 2); lg.fill(); }
      lg.fillStyle = '#fff'; lg.font = 'bold 10px monospace'; lg.fillText('REC', 21, 19);
      const m = Math.floor(sec / 60) % 60, ss = sec % 60; lg.font = '9px monospace'; lg.fillText(`00:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`, 30, 56);
    }
    lcdTex.needsUpdate = true;
  };
  // 打招呼:點一下觸發;動作期間轉向鏡頭、螢幕翻正、點頭兩下、歪頭,4.2 秒後混回原本的左右掃
  const _p = new THREE.Vector3(), GREET = 4.2;
  camGreet = { t0: -99, start() { const now = performance.now() / 1000; if (now - this.t0 > GREET - 0.6) this.t0 = now; } };
  idleAnims.push((tt) => {
    const now = performance.now() / 1000, g = now - camGreet.t0, on = g >= 0 && g < GREET;
    // 平常:左右掃 ±45°(兩端稍停)+ 一點點點頭
    const ph = (Math.sin(tt * 1.25) + 1) / 2, eased = ph * ph * (3 - 2 * ph);
    let yaw = THREE.MathUtils.degToRad(-45 + 90 * eased), pitch = THREE.MathUtils.degToRad(4) * Math.sin(tt * 2.5 + 1), roll = 0, open = 0.5;
    if (on) {
      const w = Math.min(1, g / 0.4, (GREET - g) / 0.6), k = w * w * (3 - 2 * w);
      t.worldToLocal(camera.getWorldPosition(_p)); _p.y -= 1.85;
      const face = Math.max(-1.4, Math.min(1.4, Math.atan2(-_p.z, _p.x))), look = Math.atan2(_p.y, Math.hypot(_p.x, _p.z));
      let nod = 0; for (const c of [0.85, 1.55]) { const u = (g - c) / 0.5; if (u > 0 && u < 1) nod -= Math.sin(u * Math.PI) * THREE.MathUtils.degToRad(18); }
      const tilt = g > 2.2 ? Math.sin(Math.min(1, (g - 2.2) / 0.4) * Math.PI / 2) * THREE.MathUtils.degToRad(9) : 0;
      yaw += (face - yaw) * k; pitch += (look * 0.6 + nod - pitch) * k; roll = tilt * k; open = 0.5 + (Math.PI / 2 + 0.15 - 0.5) * k;
      rec.material.emissiveIntensity = Math.sin(g * 18) > 0 ? 1.6 : 0.2;
    } else rec.material.emissiveIntensity = Math.sin(tt * 3) > -0.2 ? 1.2 : 0.15;
    camHead.rotation.set(roll, yaw, pitch, 'YZX');
    lcd.rotation.y = open;
    drawLcd(on && g > 0.25 && g < GREET - 0.35 ? 'smile' : 'rec', Math.floor(tt));
  });
}

// ---------- 地毯 / 遙控車 ----------
// 地毯:奶油色編織毯(像 kilim):青 / 珊瑚 / 紫 / 芥末黃的幾何菱形和邊框,細細的編織紋,兩短邊各一排流蘇
{
  const RX = -1.1, RZ = 0.9, RW = 3.6, RD = 2.7;
  const cv = document.createElement('canvas'); cv.width = 1080; cv.height = 810; const g = cv.getContext('2d');
  g.fillStyle = '#f3e6d6'; g.fillRect(0, 0, 1080, 810);
  for (let y = 0; y < 810; y += 3) { g.fillStyle = y % 6 ? 'rgba(160,120,90,.05)' : 'rgba(255,255,255,.12)'; g.fillRect(0, y, 1080, 1); }   // 橫向編織紋
  for (let i = 0; i < 4000; i++) { g.fillStyle = `rgba(150,110,80,${Math.random() * 0.06})`; g.fillRect(Math.random() * 1080, Math.random() * 810, 2, 1); }
  const C4 = ['#46bfcf', '#f27a5a', '#7b5cf5', '#f5c451'];
  // 邊框:兩層色帶 + 一排小三角
  const band = (inset, w, c) => { g.strokeStyle = c; g.lineWidth = w; g.strokeRect(inset, inset, 1080 - inset * 2, 810 - inset * 2); };
  band(30, 14, '#7b5cf5'); band(54, 6, '#f27a5a'); band(118, 6, '#f27a5a'); band(140, 12, '#46bfcf');
  g.fillStyle = '#f5c451';
  for (let x = 70; x < 1010; x += 30) { g.beginPath(); g.moveTo(x, 66); g.lineTo(x + 15, 100); g.lineTo(x + 30, 66); g.fill(); g.beginPath(); g.moveTo(x, 744); g.lineTo(x + 15, 710); g.lineTo(x + 30, 744); g.fill(); }
  for (let y = 70; y < 740; y += 30) { g.beginPath(); g.moveTo(66, y); g.lineTo(100, y + 15); g.lineTo(66, y + 30); g.fill(); g.beginPath(); g.moveTo(1014, y); g.lineTo(980, y + 15); g.lineTo(1014, y + 30); g.fill(); }
  // 中間:一排大菱形(套色)+ 中心小菱形
  const diamond = (cx, cy, rw, rh, c) => { g.fillStyle = c; g.beginPath(); g.moveTo(cx, cy - rh); g.lineTo(cx + rw, cy); g.lineTo(cx, cy + rh); g.lineTo(cx - rw, cy); g.closePath(); g.fill(); };
  [270, 540, 810].forEach((cx, i) => { diamond(cx, 405, 150, 190, C4[(i + 2) % 4]); diamond(cx, 405, 112, 142, '#f3e6d6'); diamond(cx, 405, 78, 98, C4[i % 4]); diamond(cx, 405, 40, 50, '#f3e6d6'); diamond(cx, 405, 16, 20, C4[(i + 1) % 4]); });
  for (const cx of [405, 675]) for (const cy of [250, 560]) diamond(cx, cy, 26, 32, '#f27a5a');
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const side = mat(0xe8d6c2, { roughness: 0.95 });
  const rug = new THREE.Mesh(new RoundedBoxGeometry(RW, 0.05, RD, 2, 0.015), [side, side, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }), side, side, side]);
  rug.position.set(RX, 0.075, RZ); rug.receiveShadow = true; root.add(rug);
  // 流蘇:兩短邊(x 方向的兩端)各一排細繩
  const N = 90, fr = new THREE.InstancedMesh(new THREE.BoxGeometry(0.11, 0.008, 0.012), mat(0xf6ecdf, { roughness: 0.9 }), N * 2), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
  for (let e = 0; e < 2; e++) for (let i = 0; i < N; i++) {
    const z = RZ - RD / 2 + 0.06 + i / (N - 1) * (RD - 0.12), sx = e ? 1 : -1;
    m4.compose(new THREE.Vector3(RX + sx * (RW / 2 + 0.05), 0.058, z + Math.sin(i * 7.1) * 0.004), q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.sin(i * 3.3) * 0.18), new THREE.Vector3(1, 1, 1));
    fr.setMatrixAt(e * N + i, m4);
  }
  fr.receiveShadow = true; root.add(fr);
}
// 遙控車:珊瑚色小越野車(深藍車窗、白色賽車條、尾翼、前後保險桿、會亮的頭燈 / 尾燈、粗輪胎 + 青色輪框、會晃的天線),
// 自己在地毯上跑 8 字(約 14 秒一圈),輪子會轉、前輪會打方向、轉彎時車身微微側傾
{
  const car = new THREE.Group(); root.add(car);
  const body = new THREE.Group(); car.add(body);                  // 會側傾的車身
  const CORAL = 0xf27a5a, DARKC = 0x2a2340;
  const cb = (w, h, d, color, x, y, z, r = 0.012, parent = body, ex) => { const m = new THREE.Mesh(new RoundedBoxGeometry(w, h, d, 2, r), color.isMaterial ? color : mat(color, ex)); m.position.set(x, y, z); m.castShadow = true; parent.add(m); return m; };
  cb(0.2, 0.035, 0.36, DARKC, 0, 0.075, 0, 0.01);                                  // 底盤
  cb(0.25, 0.085, 0.3, CORAL, 0, 0.13, -0.005, 0.03, body, { roughness: 0.35 });     // 車殼
  cb(0.19, 0.075, 0.15, new THREE.MeshPhysicalMaterial({ color: 0x1d2e66, roughness: 0.08, metalness: 0.2, clearcoat: 1 }), 0, 0.19, -0.03, 0.025);   // 車窗(座艙)
  cb(0.05, 0.004, 0.3, 0xffffff, 0, 0.174, -0.005, 0.002);                          // 白色賽車條
  cb(0.26, 0.04, 0.05, DARKC, 0, 0.1, 0.175, 0.015);                                // 前保險桿
  cb(0.24, 0.035, 0.04, DARKC, 0, 0.1, -0.17, 0.012);                               // 後保險桿
  for (const sx of [-1, 1]) cb(0.012, 0.05, 0.02, DARKC, sx * 0.08, 0.2, -0.14, 0.004);   // 尾翼支架
  cb(0.27, 0.012, 0.06, CORAL, 0, 0.228, -0.15, 0.005);                             // 尾翼
  const glow = (c, i) => new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: i });
  for (const sx of [-1, 1]) { cb(0.04, 0.025, 0.012, glow(0xfff2c8, 0.9), sx * 0.075, 0.135, 0.15, 0.006); cb(0.04, 0.02, 0.01, glow(0xff3a3a, 0.8), sx * 0.08, 0.14, -0.157, 0.005); }
  // 天線:從車尾左邊伸出來的細桿 + 頂端小球,會晃
  const ant = new THREE.Group(); ant.position.set(-0.08, 0.16, -0.12); body.add(ant);
  { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.003, 0.22, 6), mat(DARKC)); rod.position.y = 0.11; ant.add(rod);
    const tip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 10, 8), mat(CORAL)); tip.position.y = 0.225; ant.add(tip); }
  // 輪子:輪胎 + 青色輪框 + 輪轂;前輪多一層可以轉方向的 group
  const wheels = [];
  for (const [x, z, front] of [[-0.135, 0.12, 1], [0.135, 0.12, 1], [-0.135, -0.12, 0], [0.135, -0.12, 0]]) {
    const steer = new THREE.Group(); steer.position.set(x, 0.06, z); car.add(steer);
    const spin = new THREE.Group(); steer.add(spin);
    const tire = new THREE.Mesh(new THREE.CylinderGeometry(0.058, 0.058, 0.05, 20), mat(0x1c1a22, { roughness: 0.9 })); tire.rotation.z = Math.PI / 2; tire.castShadow = true; spin.add(tire);
    const rim = new THREE.Mesh(new THREE.CylinderGeometry(0.034, 0.034, 0.052, 6), mat(0x46bfcf, { roughness: 0.4 })); rim.rotation.z = Math.PI / 2; spin.add(rim);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.056, 8), mat(0xe8e2f0, { metalness: 0.6, roughness: 0.3 })); hub.rotation.z = Math.PI / 2; spin.add(hub);
    wheels.push({ steer, spin, front });
  }
  // 8 字路線(地毯中央;避開椅子、三腳架、街機、桌腳):x = cx + A·sin(u)、z = cz + B·sin(u)·cos(u)
  const CX = -1.15, CZ = 1.05, A = 1.0, B = 1.5, LAP = 14, Y = 0.1;   // 離桌腳(約 x -0.05、z 0.15)最近也有 0.35 以上
  const at = (u) => new THREE.Vector3(CX + A * Math.sin(u), Y, CZ + B * Math.sin(u) * Math.cos(u));
  let prev = null, prevHead = 0, wheelAng = 0, lastT = null;
  idleAnims.push((t) => {
    const u = t / LAP * Math.PI * 2, p = at(u), p2 = at(u + 0.02);
    const head = Math.atan2(p2.x - p.x, p2.z - p.z);                 // 車頭朝前進方向(本地 +z = 車頭)
    car.position.copy(p); car.rotation.y = head;
    const dt = lastT === null ? 0 : Math.max(0, Math.min(0.1, t - lastT)); lastT = t;
    let dh = head - prevHead; dh = Math.atan2(Math.sin(dh), Math.cos(dh)); prevHead = head;
    const turn = dt > 0 ? dh / dt : 0;                               // 轉向角速度(弧度 / 秒)
    if (prev) wheelAng += p.distanceTo(prev) / 0.058; prev = p.clone();
    for (const w of wheels) { w.spin.rotation.x = wheelAng; if (w.front) w.steer.rotation.y += (Math.max(-0.5, Math.min(0.5, turn * 0.35)) - w.steer.rotation.y) * 0.2; }
    body.rotation.z += (Math.max(-0.12, Math.min(0.12, -turn * 0.05)) - body.rotation.z) * 0.15;   // 轉彎時往外側傾
    body.position.y = 0.004 * Math.sin(t * 23);                      // 地毯上輕微的顛簸
    ant.rotation.x = -0.25 + 0.12 * Math.sin(t * 9); ant.rotation.z = 0.1 * Math.sin(t * 7.3) + body.rotation.z * 2;
  });
}

// ---------- 書桌 / 螢幕 / 鍵盤 ----------
const screenCanvas = document.createElement('canvas'); screenCanvas.width = 640; screenCanvas.height = 400;
const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
let screenMesh, deskGroup;
{
  const d = group(1.25, 0, -0.4);   // 往仙人掌(牆邊)方向移
  deskGroup = d;
  // 桌子:淺色橡木桌面(和層板同一套木紋,桌面高度不變 = 1.41)+ 霧白鋼架(桌面下的框 + 兩端雪橇腳)+ 右邊一個薄抽屜(黃銅把手)
  { const side = new THREE.MeshStandardMaterial({ map: woodTex(1024, 64, 'u'), roughness: 0.55 }), topM = new THREE.MeshStandardMaterial({ map: woodTex(1024, 460, 'u'), roughness: 0.5 }), endM = new THREE.MeshStandardMaterial({ color: 0xdcbf94, roughness: 0.65 });
    const top = new THREE.Mesh(new RoundedBoxGeometry(2.9, 0.07, 1.3, 3, 0.02), [endM, endM, topM, topM, side, side]); top.position.y = 1.375; top.castShadow = top.receiveShadow = true; d.add(top); }
  { const STEEL = 0xf3eff8, FOOT = 0x2a2340, sb = (w, h, dd, x, y, z, c = STEEL) => box(w, h, dd, c, { x, y, z, r: 0.012, parent: d, seg: 1 });
    sb(2.7, 0.05, 0.04, 0, 1.315, 0.55); sb(2.7, 0.05, 0.04, 0, 1.315, -0.55);       // 桌面下的框(前後)
    for (const sx of [-1, 1]) {
      const x = sx * 1.28;
      sb(0.05, 0.05, 1.18, x, 1.315, 0);                                               // 上橫桿
      sb(0.05, 1.29, 0.05, x, 0.655, 0.52); sb(0.05, 1.29, 0.05, x, 0.655, -0.52);    // 兩支立柱
      sb(0.06, 0.04, 1.18, x, 0.03, 0);                                                // 地上的橫桿
      for (const z of [0.52, -0.52]) box(0.07, 0.012, 0.07, FOOT, { x, y: 0.006, z, r: 0.004, parent: d, seg: 1 });   // 腳墊
    }
    // 薄抽屜(桌面右下)
    sb(0.62, 0.1, 0.55, 0.85, 1.29, 0.3, 0xf3eff8);
    box(0.6, 0.085, 0.02, 0xe2c7a0, { x: 0.85, y: 1.288, z: 0.585, r: 0.008, parent: d, seg: 1 });
    { const pull = new THREE.Mesh(new RoundedBoxGeometry(0.16, 0.014, 0.018, 1, 0.006), new THREE.MeshStandardMaterial({ color: 0xc9a25a, metalness: 0.85, roughness: 0.3 })); pull.position.set(0.85, 1.288, 0.603); d.add(pull); }
  }
  // 螢幕:超窄黑邊 + 薰衣草紫背殼(像彩色 iMac)、頂部小鏡頭、底部指示燈、一片折彎的鋁腳架。
  // 螢幕那片(screenMesh)大小位置都不能動:飛進電腦、捲動版的鏡頭都靠它
  const m = group(0, 1.41, -0.25, d);
  const alu = new THREE.MeshStandardMaterial({ color: 0xd9d5e3, metalness: 0.75, roughness: 0.3 });
  { const base = new THREE.Mesh(new RoundedBoxGeometry(0.52, 0.018, 0.34, 2, 0.008), alu); base.position.set(0, 0.009, -0.02); base.castShadow = base.receiveShadow = true; m.add(base);
    const neck = new THREE.Mesh(new RoundedBoxGeometry(0.24, 0.66, 0.022, 2, 0.01), alu); neck.position.set(0, 0.33, -0.13); neck.rotation.x = -0.32; neck.castShadow = true; m.add(neck); }
  box(1.5, 0.94, 0.03, 0x1d1a26, { y: 0.9, z: 0.028, r: 0.02, parent: m });                        // 前面的黑邊框
  box(1.5, 0.94, 0.022, 0xcbb8f0, { y: 0.9, z: 0.002, r: 0.02, parent: m });                       // 薰衣草紫背殼
  box(0.92, 0.56, 0.06, 0xcbb8f0, { y: 0.84, z: -0.03, r: 0.05, parent: m });                      // 背後凸起(接腳架)
  box(1.5, 0.05, 0.034, 0xcbb8f0, { y: 0.405, z: 0.028, r: 0.012, parent: m });                    // 下巴
  cyl(0.008, 0.008, 0.004, 0x0d0b12, { y: 1.355, z: 0.044, rx: Math.PI / 2, parent: m });          // 鏡頭
  { const led = new THREE.Mesh(new THREE.CircleGeometry(0.005, 12), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x9ff0c8, emissiveIntensity: 0.6 })); led.position.set(0.66, 0.405, 0.046); m.add(led); }
  screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.86), new THREE.MeshBasicMaterial({ map: screenTex }));
  screenMesh.position.set(0, 0.9, 0.045);
  m.add(screenMesh);
  // 大桌墊(鍵盤 + 滑鼠都放在上面):薰衣草奶油色、細點格、幾個小貓掌
  { const mt = document.createElement('canvas'); mt.width = 1024; mt.height = 400; const g = mt.getContext('2d');
    g.fillStyle = '#f2e6f8'; g.fillRect(0, 0, 1024, 400);
    g.fillStyle = 'rgba(139,124,255,.18)'; for (let x = 16; x < 1024; x += 24) for (let y = 16; y < 400; y += 24) g.fillRect(x, y, 2, 2);
    g.fillStyle = 'rgba(70,191,207,.35)'; const paw = (x, y, r) => { g.beginPath(); g.ellipse(x, y, r, r * 0.85, 0, 0, Math.PI * 2); g.fill(); for (const [dx, dy] of [[-1, -1.2], [-0.35, -1.6], [0.35, -1.6], [1, -1.2]]) { g.beginPath(); g.arc(x + dx * r, y + dy * r * 0.9, r * 0.36, 0, Math.PI * 2); g.fill(); } };
    paw(90, 90, 18); paw(940, 70, 14); paw(860, 300, 12);
    g.strokeStyle = 'rgba(123,92,245,.35)'; g.lineWidth = 6; g.strokeRect(10, 10, 1004, 380);
    const tex = new THREE.CanvasTexture(mt); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat2 = new THREE.Mesh(new RoundedBoxGeometry(1.36, 0.006, 0.53, 2, 0.003), [mat(0xe6d6f2), mat(0xe6d6f2), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9 }), mat(0xe6d6f2), mat(0xe6d6f2), mat(0xe6d6f2)]);
    mat2.position.set(0.05, 1.413, 0.3); mat2.receiveShadow = true; d.add(mat2); }
  // 機械鍵盤:外殼 + 約 70 顆鍵帽(InstancedMesh);一般鍵奶油白、功能鍵薰衣草、Esc / Enter 珊瑚色
  { const kb = group(-0.12, 1.416, 0.29, d); kb.rotation.y = 0.04;
    box(0.62, 0.028, 0.225, 0x2a2340, { y: 0.014, r: 0.01, parent: kb });
    const ROWS = [[1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2], [1.5, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.5], [1.75, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.25], [2.25, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2.75], [1.25, 1.25, 1.25, 6.25, 1.25, 1.25, 1.25, 1.25]];
    const U = 0.0385, total = ROWS.reduce((n, r) => n + r.length, 0);
    const keys = new THREE.InstancedMesh(new RoundedBoxGeometry(1, 1, 1, 1, 0.18), new THREE.MeshStandardMaterial({ roughness: 0.55 }), total);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), cream = new THREE.Color(0xfff4e6), lav = new THREE.Color(0xc9b6ef), coral = new THREE.Color(0xf27a5a);
    let k = 0;
    ROWS.forEach((row, r) => { let x = -15 * U / 2; const z = (r - 2) * U;
      row.forEach((w, i) => { const cx = x + w * U / 2; x += w * U;
        m4.compose(new THREE.Vector3(cx, 0.036 + (2 - r) * 0.0015, z), q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), (r - 2) * 0.05), new THREE.Vector3(w * U - 0.005, 0.017, U - 0.005));
        keys.setMatrixAt(k, m4);
        keys.setColorAt(k, (r === 0 && i === 0) || (r === 2 && i === row.length - 1) ? coral : w > 1 && w < 6 ? lav : cream); k++; }); });
    keys.castShadow = true; kb.add(keys); }
  // 滑鼠:圓潤的蛋形、中間一條左右鍵的縫、滾輪
  { const ms = group(0.56, 1.416, 0.33, d); ms.rotation.y = -0.15;
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.05, 28, 18), mat(0xfff4e6, { roughness: 0.4 })); body.scale.set(0.62, 0.36, 1); body.position.y = 0.012; body.castShadow = true; ms.add(body);
    const seam = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.004, 0.045), mat(0x8b7cff)); seam.position.set(0, 0.03, -0.024); seam.rotation.x = 0.25; ms.add(seam);
    const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.006, 16), mat(0x8b7cff)); wheel.rotation.z = Math.PI / 2; wheel.position.set(0, 0.031, -0.022); ms.add(wheel); }
  // 檯燈(建築師燈):重的圓底座、兩段雙桿手臂 + 彈簧 + 關節旋鈕、外珊瑚內奶油的錐形燈罩、發光燈泡;照樣在桌面左後角打暖光
  const lamp = group(-1.15, 1.41, -0.42, d); lamp.rotation.y = -0.9;   // 手臂往桌子前方右邊伸,燈罩在螢幕前面,不會被螢幕擋住
  const LAMP = 0xf2962e, LAMP_DARK = 0x3b3346;
  cyl(0.12, 0.135, 0.045, LAMP, { y: 0.0225, parent: lamp });
  cyl(0.03, 0.03, 0.03, LAMP_DARK, { y: 0.06, parent: lamp });
  const P0 = new THREE.Vector3(0, 0.07, 0), P1 = new THREE.Vector3(0.1, 0.5, 0), P2 = new THREE.Vector3(0.38, 0.74, 0);
  const rod = (a2, b2, off) => { const dv = b2.clone().sub(a2), r2 = cyl(0.008, 0.008, dv.length(), LAMP, { parent: lamp }); r2.position.copy(a2).add(b2).multiplyScalar(0.5).add(new THREE.Vector3(0, 0, off)); r2.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize()); };
  const spring = (a2, b2) => { const dv = b2.clone().sub(a2), L2 = dv.length(), pts = []; for (let i = 0; i <= 160; i++) { const t2 = i / 160, ang = t2 * Math.PI * 2 * 14; pts.push(new THREE.Vector3(Math.cos(ang) * 0.011, t2 * L2, Math.sin(ang) * 0.011)); }
    const sp = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 320, 0.0022, 5), mat(0x9a93a6, { metalness: 0.6, roughness: 0.4 }));
    sp.position.copy(a2); sp.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dv.normalize()); lamp.add(sp); };
  for (const off of [-0.022, 0.022]) { rod(P0, P1, off); rod(P1, P2, off); }
  spring(P0.clone().add(new THREE.Vector3(0.015, 0.04, 0)), P1.clone().add(new THREE.Vector3(0.0, -0.12, 0)));
  spring(P1.clone().add(new THREE.Vector3(0.03, 0.03, 0)), P2.clone().add(new THREE.Vector3(-0.1, -0.03, 0)));
  for (const p of [P0, P1, P2]) { const kn = cyl(0.026, 0.026, 0.07, LAMP_DARK, { parent: lamp, rx: Math.PI / 2 }); kn.position.copy(p); }
  const shadeG = new THREE.Group(); shadeG.position.copy(P2); shadeG.rotation.z = -2.35; lamp.add(shadeG);   // 燈罩開口朝桌面(往下偏右)
  { const prof = [[0.03, 0], [0.042, 0.02], [0.065, 0.06], [0.12, 0.15], [0.13, 0.165]].map(([r2, y2]) => new THREE.Vector2(r2, y2));
    const outer = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), new THREE.MeshStandardMaterial({ color: LAMP, roughness: 0.45, side: THREE.FrontSide }));
    const inner = new THREE.Mesh(new THREE.LatheGeometry(prof, 36), new THREE.MeshStandardMaterial({ color: 0xfff4e6, roughness: 0.6, side: THREE.BackSide }));
    outer.castShadow = true; shadeG.add(outer, inner);
    cyl(0.032, 0.032, 0.03, LAMP_DARK, { y: -0.01, parent: shadeG }); }
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.045, 16, 12), new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffc466, emissiveIntensity: 1.8 }));
  bulb.position.set(0, 0.085, 0); shadeG.add(bulb);
  const lampLight = new THREE.PointLight(0xffb36b, 7, 5.5, 2); lampLight.position.set(0.44, 0.66, 0); lamp.add(lampLight);
  // 貓咪馬克杯(在鍵盤左邊,不擋鍵盤):奶油色陶瓷 + 珊瑚色底帶、正面印貓臉、杯口兩個小耳朵、尾巴形狀的把手;
  // 裡面是有貓掌拉花的咖啡,冒幾縷熱氣;底下一片軟木杯墊。正面朝鏡頭那邊
  { const mug = group(-0.8, 1.41, 0.2, d); mug.rotation.y = -0.8;
    const cream = 0xfff4e6, coralM = 0xf27a5a;
    // 杯墊
    cyl(0.088, 0.088, 0.008, 0xc99a6b, { y: 0.004, parent: mug });
    { const rr = new THREE.Mesh(new THREE.TorusGeometry(0.078, 0.003, 6, 40), mat(0xa87a4f)); rr.rotation.x = Math.PI / 2; rr.position.y = 0.0085; mug.add(rr); }
    // 外杯身:印貓臉的貼圖(圓柱的 u 從背面開始,所以正面在貼圖正中間)
    const fc = document.createElement('canvas'); fc.width = 512; fc.height = 144; const g = fc.getContext('2d');
    g.fillStyle = '#fff4e6'; g.fillRect(0, 0, 512, 144); g.fillStyle = '#f27a5a'; g.fillRect(0, 122, 512, 22);
    const cx = 256, cy = 66; g.strokeStyle = '#3b2f2a'; g.lineWidth = 4; g.lineCap = 'round';
    for (const ex of [-22, 22]) { g.beginPath(); g.arc(cx + ex, cy, 8, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }          // ^ ^ 眼睛
    g.fillStyle = '#ff8fa8'; g.beginPath(); g.moveTo(cx - 5, cy + 10); g.lineTo(cx + 5, cy + 10); g.lineTo(cx, cy + 16); g.closePath(); g.fill();   // 鼻子
    g.lineWidth = 3; g.beginPath(); g.arc(cx - 5, cy + 18, 5, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke(); g.beginPath(); g.arc(cx + 5, cy + 18, 5, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();   // ω
    g.lineWidth = 2; for (const sx of [-1, 1]) for (const dy of [-4, 4]) { g.beginPath(); g.moveTo(cx + sx * 34, cy + 14 + dy * 0.5); g.lineTo(cx + sx * 62, cy + 12 + dy * 1.6); g.stroke(); }   // 鬍鬚
    g.fillStyle = 'rgba(255,143,168,.45)'; for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(cx + sx * 38, cy + 6, 10, 6, 0, 0, Math.PI * 2); g.fill(); }   // 腮紅
    g.fillStyle = 'rgba(242,122,90,.35)'; for (const px of [70, 150, 362, 442]) { g.beginPath(); g.ellipse(px, 92, 7, 6, 0, 0, Math.PI * 2); g.fill(); for (const [dx, dy] of [[-7, -8], [-2, -11], [3, -11], [8, -8]]) { g.beginPath(); g.arc(px + dx, 92 + dy, 2.6, 0, Math.PI * 2); g.fill(); } }   // 小腳印
    const faceTex = new THREE.CanvasTexture(fc); faceTex.colorSpace = THREE.SRGBColorSpace; faceTex.anisotropy = 8;
    const H = 0.115;
    { const outer = new THREE.Mesh(new THREE.CylinderGeometry(0.066, 0.061, H, 48, 1, true, -Math.PI, Math.PI * 2), new THREE.MeshStandardMaterial({ map: faceTex, roughness: 0.35 })); outer.position.y = 0.008 + H / 2; outer.castShadow = true; mug.add(outer);
      const inner = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.056, H - 0.004, 40, 1, true), mat(cream, { roughness: 0.35, side: THREE.BackSide })); inner.position.y = 0.01 + H / 2; mug.add(inner);
      const rim = new THREE.Mesh(new THREE.TorusGeometry(0.063, 0.0035, 8, 48), mat(cream, { roughness: 0.3 })); rim.rotation.x = Math.PI / 2; rim.position.y = 0.008 + H; mug.add(rim);
      cyl(0.061, 0.061, 0.006, coralM, { y: 0.011, parent: mug }); }
    // 咖啡 + 貓掌拉花
    { const lc = document.createElement('canvas'); lc.width = lc.height = 128; const l2 = lc.getContext('2d');
      const gr = l2.createRadialGradient(64, 64, 10, 64, 64, 64); gr.addColorStop(0, '#a8714b'); gr.addColorStop(1, '#6b4128'); l2.fillStyle = gr; l2.fillRect(0, 0, 128, 128);
      l2.fillStyle = '#f6e3cc'; l2.beginPath(); l2.ellipse(64, 74, 18, 15, 0, 0, Math.PI * 2); l2.fill(); for (const [dx, dy] of [[-18, -18], [-6, -27], [6, -27], [18, -18]]) { l2.beginPath(); l2.arc(64 + dx, 74 + dy, 6.5, 0, Math.PI * 2); l2.fill(); }
      const lt = new THREE.CanvasTexture(lc); lt.colorSpace = THREE.SRGBColorSpace;
      const cof = new THREE.Mesh(new THREE.CircleGeometry(0.058, 32), new THREE.MeshStandardMaterial({ map: lt, roughness: 0.25 })); cof.rotation.x = -Math.PI / 2; cof.rotation.z = Math.PI; cof.position.y = 0.105; mug.add(cof); }
    // 杯口的貓耳朵(外奶油內粉),在正面左右兩邊
    for (const sx of [-1, 1]) { const a2 = sx * 0.55;
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.032, 12), mat(cream, { roughness: 0.35 })); ear.position.set(Math.sin(a2) * 0.058, 0.008 + H + 0.014, Math.cos(a2) * 0.058); ear.scale.z = 0.55; ear.rotation.y = a2; ear.castShadow = true; mug.add(ear);
      const inn = new THREE.Mesh(new THREE.ConeGeometry(0.011, 0.022, 12), mat(0xff9fb5)); inn.position.set(Math.sin(a2) * 0.061, 0.008 + H + 0.011, Math.cos(a2) * 0.061); inn.scale.z = 0.4; inn.rotation.y = a2; mug.add(inn); }
    // 把手:像貓尾巴一樣捲起來
    { const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(0.064, 0.1, 0), new THREE.Vector3(0.1, 0.098, 0), new THREE.Vector3(0.118, 0.06, 0), new THREE.Vector3(0.098, 0.028, 0), new THREE.Vector3(0.07, 0.03, 0), new THREE.Vector3(0.082, 0.05, 0)]);
      const hdl = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.0085, 8), mat(cream, { roughness: 0.35 })); hdl.castShadow = true; mug.add(hdl); }
    // 熱氣:三縷柔柔的白霧往上飄、淡出
    { const sc = document.createElement('canvas'); sc.width = sc.height = 64; const s2 = sc.getContext('2d'); const gr = s2.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, 'rgba(255,255,255,.55)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); s2.fillStyle = gr; s2.fillRect(0, 0, 64, 64);
      const st = new THREE.CanvasTexture(sc), puffs = [];
      for (let i = 0; i < 4; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: st, transparent: true, depthWrite: false, opacity: 0 })); mug.add(sp); puffs.push(sp); }
      idleAnims.push((t) => { puffs.forEach((sp, i) => { const ph = ((t * 0.35 + i / puffs.length) % 1); sp.position.set(Math.sin(t * 1.3 + i * 2) * 0.012, 0.13 + ph * 0.16, Math.cos(t + i) * 0.01); sp.scale.setScalar(0.035 + ph * 0.06); sp.material.opacity = Math.sin(ph * Math.PI) * 0.5; }); }); }
  }
  // 螢幕光(青藍):從螢幕前面照向鍵盤和桌面
  const scrLight = new THREE.PointLight(0x7fd8ff, 3.5, 3.6, 2); scrLight.position.set(0, 2.2, 0.35); d.add(scrLight);
}

// ---------- 椅子 ----------
// 人體工學辦公椅:椅殼 + 微微隆起的坐墊、兩邊往前包的弧形靠背(有腰靠、往後仰一點)、連接靠背的背桿、L 形扶手、
// 金屬氣壓桿 + 套管、五爪腳 + 輪子。放在書桌前偏房間中間,不要被角落的龜背芋擋住
{
  const c = group(0.85, 0, 1.05);
  c.rotation.y = -0.25;
  const SEAT = C.chair, SHELL = C.chairDark, FRAME = C.chairPost;
  // 彎曲 / 隆起:把圓角盒子的頂點推一推再重算法線
  const shaped = (w, h, d, seg, r, color, fn) => {
    const g = new RoundedBoxGeometry(w, h, d, seg, r), p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const v = fn(p.getX(i), p.getY(i), p.getZ(i)); p.setXYZ(i, v[0], v[1], v[2]); }
    g.computeVertexNormals(); const m = new THREE.Mesh(g, mat(color, { roughness: 0.7 })); m.castShadow = m.receiveShadow = true; c.add(m); return m;
  };
  // 坐墊:殼 + 上面一塊中間隆起、前緣往下彎(瀑布邊)的墊子
  box(0.86, 0.06, 0.84, SHELL, { y: 0.66, r: 0.03, parent: c });
  shaped(0.84, 0.13, 0.82, 8, 0.06, SEAT, (x, y, z) => [x, y + (y > 0 ? 0.025 * (1 - (x / 0.42) ** 2) * (1 - (z / 0.41) ** 2) : 0) - (z > 0.25 ? (z - 0.25) ** 2 * 0.5 : 0), z]).position.y = 0.755;
  // 靠背:兩側往前包(+z 是坐墊那邊)、下方一點腰靠;後面一片深色的殼;整塊往後仰
  const back = new THREE.Group(); back.position.set(0, 0.92, -0.4); back.rotation.x = -0.12; c.add(back);
  const bend = (x, y, z) => [x, y, z + 0.11 * (x / 0.42) ** 2 + 0.035 * Math.exp(-(((y + 0.22) / 0.16) ** 2))];
  const pad = shaped(0.84, 0.92, 0.11, 8, 0.05, SEAT, bend); c.remove(pad); back.add(pad); pad.position.y = 0.47;
  const shell = shaped(0.8, 0.86, 0.04, 4, 0.02, SHELL, (x, y, z) => { const v = bend(x, y, z); return [v[0], v[1], v[2] - 0.07]; }); c.remove(shell); back.add(shell); shell.position.y = 0.47;
  for (let i = 0; i < 3; i++) { const st = shaped(0.7, 0.012, 0.012, 1, 0.005, SHELL, (x, y, z) => [x, y, z + 0.11 * (x / 0.42) ** 2 + 0.06]); c.remove(st); back.add(st); st.position.y = 0.3 + i * 0.22; }   // 車縫線
  box(0.12, 0.34, 0.05, SHELL, { y: 0.82, z: -0.43, r: 0.02, parent: c });             // 背桿:坐墊後面接到靠背
  // L 形扶手
  for (const sx of [-1, 1]) {
    box(0.05, 0.26, 0.06, FRAME, { x: sx * 0.41, y: 0.85, z: -0.06, r: 0.02, parent: c });
    box(0.09, 0.045, 0.4, SHELL, { x: sx * 0.41, y: 0.995, z: 0.0, r: 0.02, parent: c });
  }
  // 氣壓桿(金屬)+ 套管
  const chrome = mat(0xdcd6e4, { metalness: 0.7, roughness: 0.25 });
  { const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.038, 0.038, 0.42, 20), chrome); rod.position.y = 0.43; rod.castShadow = true; c.add(rod); }
  cyl(0.062, 0.07, 0.2, SHELL, { y: 0.25, parent: c });
  box(0.36, 0.05, 0.3, FRAME, { y: 0.62, r: 0.02, parent: c });                         // 坐墊下的底盤
  // 五爪腳 + 輪子
  cyl(0.11, 0.12, 0.08, FRAME, { y: 0.15, parent: c });
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5, leg = new THREE.Group(); leg.rotation.y = a; leg.position.y = 0.15; c.add(leg);
    const spoke = box(0.44, 0.055, 0.075, FRAME, { x: 0.25, y: -0.012, r: 0.025, parent: leg, seg: 2 }); spoke.rotation.z = -0.08;
    box(0.07, 0.05, 0.06, SHELL, { x: 0.46, y: -0.05, r: 0.02, parent: leg });           // 輪架
    const wheel = cyl(0.042, 0.042, 0.045, 0x5a4a6a, { x: 0.46, y: -0.105, parent: leg }); wheel.rotation.set(Math.PI / 2, 0, 0);
  }
}


// ---------- 植物 ----------
const plantLeaves = [];   // (舊的彎曲仙人掌用;現在的仙人掌不會動,留著空陣列)
// 書桌後面、靠窗角落的柱狀仙人掌(像巨柱仙人掌):主幹 + 兩支往上彎的手臂,每根都有直的稜線,稜線上一排排刺座和小刺,頂端開一朵粉紅小花;陶盆 + 白色小石子
{
  const p = group(1.85, 0, -1.9);
  const POT_TOP = 0.38;
  // 陶盆(車床輪廓:捲邊的盆口)+ 土 + 小石子
  const potPts = [[0, 0.004], [0.22, 0.004], [0.235, 0.02], [0.26, 0.28], [0.29, 0.29], [0.3, 0.31], [0.3, 0.37], [0.29, 0.38], [0.275, 0.36], [0, 0.36]].map(([r, y]) => new THREE.Vector2(r, y));
  const pot = new THREE.Mesh(new THREE.LatheGeometry(potPts, 48), mat(0xd9784f, { roughness: 0.8 })); pot.castShadow = pot.receiveShadow = true; p.add(pot);
  cyl(0.276, 0.276, 0.012, 0x4a3426, { y: 0.358, parent: p });
  { const peb = new THREE.InstancedMesh(new THREE.SphereGeometry(0.022, 8, 6), mat(0xeee6e0, { roughness: 0.9 }), 46), m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    for (let i = 0; i < 46; i++) { const a = i * 2.39996, r = 0.22 + 0.05 * ((i * 7) % 5) / 5; m4.compose(new THREE.Vector3(Math.cos(a) * r, 0.366, Math.sin(a) * r), q, new THREE.Vector3(1, 0.6, 1).multiplyScalar(0.8 + ((i * 13) % 7) / 14)); peb.setMatrixAt(i, m4); }
    peb.receiveShadow = true; p.add(peb); }
  // 有稜線的圓柱:膠囊形狀,依角度把半徑做成 9 道起伏;溝暗、稜亮、頂端新長的地方偏黃綠
  const RIBS = 9, DEPTH = 0.13;
  const cactusMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.62 });
  const ribbed = (r, h) => {
    const g = new THREE.CapsuleGeometry(r, h, 10, RIBS * 8, Math.max(8, Math.round(h * 24))), pos = g.attributes.position, col = [], c = new THREE.Color();
    const groove = new THREE.Color(0x24784a), ridge = new THREE.Color(0x52b87c), fresh = new THREE.Color(0x9fd96a);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), rib = Math.cos(RIBS * Math.atan2(z, x)), k = 1 + DEPTH * rib;
      pos.setX(i, x * k); pos.setZ(i, z * k);
      c.copy(groove).lerp(ridge, (rib + 1) / 2); c.lerp(fresh, Math.max(0, Math.min(1, (y - h / 2 + r * 0.2) / (r * 1.2))) * 0.6);
      col.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeVertexNormals(); return g;
  };
  // 刺座(奶油色小點)+ 每個 3 根小刺,全部用 InstancedMesh(上千個)
  const areoles = [], spines = [];
  const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const column = (r, h, pos, rotZ = 0, dome = true) => {
    const g = new THREE.Group(); g.position.copy(pos); g.rotation.z = rotZ; p.add(g);
    const m = new THREE.Mesh(ribbed(r, h), cactusMat); m.castShadow = true; m.receiveShadow = true; g.add(m);
    g.updateMatrix();
    const R = r * (1 + DEPTH), rows = Math.round(h / 0.085);
    for (let j = 0; j < RIBS; j++) {
      const a = j / RIBS * Math.PI * 2;
      const add = (y, rad, ny) => {   // 稜線上一點(柱體座標):位置 + 朝外的方向
        const out = new THREE.Vector3(Math.cos(a), ny, Math.sin(a)).normalize();
        const at = new THREE.Vector3(Math.cos(a) * rad, y, Math.sin(a) * rad).applyMatrix4(g.matrix);
        const dir = out.clone().transformDirection(g.matrix);
        areoles.push(at.clone().addScaledVector(dir, 0.004));
        for (let s = 0; s < 3; s++) {                                       // 三根刺:往外,上下左右散開一點
          const d = dir.clone().add(new THREE.Vector3(Math.sin(s * 2.1 + j) * 0.5, (s - 1) * 0.45, Math.cos(s * 2.1 + j) * 0.5)).normalize();
          spines.push([at.clone().addScaledVector(d, 0.028), d]);
        }
      };
      for (let i = 0; i < rows; i++) { const y = -h / 2 + 0.05 + (i + (j % 2) * 0.5) * (h / rows); if (y < h / 2) add(y, R, 0); }
      if (dome) for (const ph of [0.45, 0.95]) add(h / 2 + r * Math.sin(ph), R * Math.cos(ph), Math.sin(ph) * 1.6);
    }
    return g;
  };
  // 主幹 + 左右手臂(橫的一小段 + 手肘 + 往上的一段)
  const main = { r: 0.2, h: 1.55 };
  column(main.r, main.h, new THREE.Vector3(0, POT_TOP + main.r + main.h / 2, 0));
  for (const [sx, y0, hor, ver, r] of [[-1, 0.95, 0.2, 0.55, 0.13], [1, 1.28, 0.14, 0.38, 0.115]]) {
    const ey = POT_TOP + y0, ex = sx * (main.r + hor);
    column(r, hor, new THREE.Vector3(sx * (main.r + hor / 2 - 0.02), ey, 0), Math.PI / 2, false);
    const elbow = new THREE.Mesh(ribbed(r, 0.001), cactusMat);          // 手肘:一顆有稜線的球,和柱子接得起來
    elbow.position.set(ex, ey, 0); elbow.castShadow = true; p.add(elbow);
    column(r, ver, new THREE.Vector3(ex, ey + ver / 2, 0));
  }
  { const am = new THREE.InstancedMesh(new THREE.SphereGeometry(0.009, 8, 6), mat(0xd9ccae, { roughness: 0.95 }), areoles.length), m4 = new THREE.Matrix4();
    areoles.forEach((at, i) => { am.setMatrixAt(i, m4.makeTranslation(at.x, at.y, at.z)); }); p.add(am); }
  { const sg = new THREE.ConeGeometry(0.0035, 0.05, 4); sg.translate(0, 0.025, 0);
    const sm = new THREE.InstancedMesh(sg, mat(0xfff6dc, { roughness: 0.5 }), spines.length), m4 = new THREE.Matrix4();
    spines.forEach(([at, d], i) => { _q.setFromUnitVectors(up, d); m4.compose(at, _q, _v.set(1, 1, 1)); sm.setMatrixAt(i, m4); }); p.add(sm); }
  // 頂端一朵粉紅小花
  { const fl = new THREE.Group(); fl.position.set(0.02, POT_TOP + main.r * 2 + main.h - 0.01, 0.03); fl.rotation.set(0.2, 0, -0.15); p.add(fl);
    const petal = mat(0xff8fb8, { roughness: 0.5 });
    for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2, pt = new THREE.Mesh(new THREE.SphereGeometry(0.05, 12, 8), petal);
      pt.scale.set(1, 0.32, 0.55); pt.position.set(Math.cos(a) * 0.045, 0.03, Math.sin(a) * 0.045); pt.rotation.set(0, -a, 0.5); pt.castShadow = true; fl.add(pt); }
    sphere(0.025, 0xffd36a, { y: 0.045, parent: fl }); }
}

// ---------- 貓 + 碗 ----------
// 貓改用 Meshy 產生的 GLB(cat.glb,已 Draco 壓縮 + 貼圖縮到 1024)。
// 模型只有一個 mesh、沒有骨架,所以「轉頭」用 vertex shader 做:脖子以上的頂點依高度加權繞垂直軸旋轉。
let catHead = null;            // 舊介面保留(不再使用)
const catUniforms = { uHead: { value: 0 }, uTail: { value: 0 }, uNeck: { value: 0.08 }, uBlend: { value: 0.18 }, uPivot: { value: new THREE.Vector2(0.17, 0.40) } };   // 模型原始座標:脖子約 y=0.08~0.26,頭中心 xz≈(0.17, 0.40)
let catModel = null;
{
  const b = group(2.25, 0, 2.45);
  cyl(0.5, 0.42, 0.22, C.bowl, { y: 0.11, parent: b });
  cyl(0.42, 0.42, 0.02, 0x8fe0ea, { y: 0.23, parent: b });
  const cat = new THREE.Group(); cat.position.y = 0.24; cat.rotation.y = -Math.PI * 0.7 + Math.PI / 6; b.add(cat);   // 再往牠的左邊轉 30°
  loadGLB('cat', './cat.glb', (gltf) => {
    const m = gltf.scene;
    const box = new THREE.Box3().setFromObject(m);
    const size = box.getSize(new THREE.Vector3());
    const k = 1.0 / size.y;                       // 貓高約 1.0
    m.scale.setScalar(k);
    m.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
    m.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mat = o.material; mat.side = THREE.FrontSide;
      // 原貼圖偏暗棕,調亮並加一點金黃自發光,接近參考圖的金色
      mat.metalness = 0; mat.color.setScalar(1.25);
      mat.emissive.set(0xffb040); mat.emissiveMap = mat.map; mat.emissiveIntensity = 0.3;
      mat.onBeforeCompile = (sh) => {
        Object.assign(sh.uniforms, catUniforms);
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', `#include <common>
            uniform float uHead, uNeck, uBlend, uTail; uniform vec2 uPivot;
            mat2 rot2(float a) { float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
            mat2 headRot(float y) { return rot2(uHead * smoothstep(uNeck, uNeck + uBlend, y)); }
            // 尾巴:模型座標 x < -0.4、y < -0.55 的那一圈(繞在身體左側),尾根在 z≈-0.62、尾尖在 z≈0.3;越靠尾尖擺越多
            float tailW(vec3 p) { return (1.0 - smoothstep(-0.45, -0.33, p.x)) * (1.0 - smoothstep(-0.6, -0.5, p.y)) * smoothstep(-0.7, 0.25, p.z); }
            const vec2 TAIL_PIVOT = vec2(-0.38, -0.62);`)
          .replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
            objectNormal.xz = headRot(position.y) * objectNormal.xz;
            objectNormal.xz = rot2(uTail * tailW(position)) * objectNormal.xz;`)
          .replace('#include <begin_vertex>', `#include <begin_vertex>
            transformed.xz = uPivot + headRot(position.y) * (transformed.xz - uPivot);
            transformed.xz = TAIL_PIVOT + rot2(uTail * tailW(position)) * (transformed.xz - TAIL_PIVOT);`);
      };
      mat.needsUpdate = true;
    });
    cat.add(m); catModel = m;
    if (window.__room) window.__room.cat = m;
  });
  animated.push(cat);
}

// ---------- 街機螢幕的待機畫面:股票大富翁(一圈彩色格子、兔子繞圈跳、兩顆骰子、跑馬燈報價)----------
const ARC_COLORS = ['#ff8fc0', '#8b7cff', '#4f8ef0', '#ffd24a', '#f5b942', '#f2796b', '#54c98a', '#5aa9ff', '#c48ad6', '#2a9db5', '#ffd24a', '#e85d9b', '#9aa0ad', '#e6b422', '#3d5a80', '#ffd24a', '#2ec4b6', '#f7931a', '#5aa9ff', '#7fb069', '#b5179e', '#ff9f6b'];
// 機台螢幕上的按鈕位置(畫布座標 520x385),畫和點擊判定共用
// 版面:格子圈占滿整個螢幕,標題、骰子、按鈕(左邊語言切換、右邊 PLAY)都在圈裡面;
// 房間的 ‹ 🖱 › 導覽列也搬進圈裡、排在按鈕下面(ARC_PILL_Y)
const ARC_BTN = { zh: { x: 104, y: 218, w: 70, h: 32 }, en: { x: 176, y: 218, w: 70, h: 32 }, play: { x: 276, y: 215, w: 140, h: 38 } };
function arcadeButtonAt(x, y) {
  for (const k in ARC_BTN) { const b = ARC_BTN[k]; if (x >= b.x - 6 && x <= b.x + b.w + 6 && y >= b.y - 8 && y <= b.y + b.h + 8) return k; }
  return null;
}
let arcadeMenu = false, pushT = 0, pushGoal = 0, arcHover = null;   // arcHover:滑鼠現在停在機台螢幕的哪顆按鈕上(zh / en / play)
const ARC_PILL_Y = 342, pillV = new THREE.Vector3(), pillEl = document.querySelector('.pill');   // 導覽列在街機螢幕上的位置(畫布 y)
let gameLang = (() => { let v = null; try { v = localStorage.getItem('css.lang'); } catch (e) {} return (v || navigator.language || 'en').toLowerCase().startsWith('zh') ? 'zh' : 'en'; })();
function setGameLang(code) { gameLang = code; try { localStorage.setItem('css.lang', code); } catch (e) {} prewarmGame(); }
// cv / zoom:可以畫到別的畫布並放大 zoom 倍(進入街機後的選單畫面就是同一張圖的高解析版)
function drawArcadeScreen(t, cv = arcadeCanvas, zoom = 1) {
  const g = cv.getContext('2d'), W = 520, H = 385;
  g.setTransform(zoom, 0, 0, zoom, 0, 0);
  g.clearRect(0, 0, W, H);
  g.save();
  g.beginPath(); g.roundRect(0, 0, W, H, 34); g.clip();                    // 圓角螢幕
  g.fillStyle = '#bfe6a8'; g.fillRect(0, 0, W, H);                         // 草地
  g.fillStyle = '#f6e3c2'; g.beginPath(); g.roundRect(14, 14, W - 28, H - 20, 18); g.fill();   // 人行道
  g.fillStyle = '#9bdc7a'; g.beginPath(); g.roundRect(84, 80, W - 168, 246, 12); g.fill();      // 中間草地
  // 一圈格子:上下各 8 格、左右各 4 格,共 24 格,順時針排
  const TW = 58, TH = 48, x0 = 22, y0 = 28, cols = 8, rows = 7, cells = [];
  for (let i = 0; i < cols; i++) cells.push([x0 + i * (TW + 2), y0]);
  for (let j = 1; j < rows - 1; j++) cells.push([x0 + (cols - 1) * (TW + 2), y0 + j * (TH + 2)]);
  for (let i = cols - 1; i >= 0; i--) cells.push([x0 + i * (TW + 2), y0 + (rows - 1) * (TH + 2)]);
  for (let j = rows - 2; j >= 1; j--) cells.push([x0, y0 + j * (TH + 2)]);
  const n = cells.length, step = t * 2.2, at = Math.floor(step) % n, frac = step % 1;
  cells.forEach(([x, y], i) => {
    const c = ARC_COLORS[i % ARC_COLORS.length], lit = i === at;
    g.fillStyle = c; g.beginPath(); g.roundRect(x, y + 5, TW, TH - 5, 7); g.fill();                 // 側邊顏色
    g.fillStyle = lit ? '#fffbe0' : '#fff8ec'; g.beginPath(); g.roundRect(x, y - (lit ? 0 : 0), TW, TH - 9, 7); g.fill();   // 頂面
    g.fillStyle = c; g.beginPath(); g.arc(x + TW / 2, y + 13, 6, 0, Math.PI * 2); g.fill();        // 小圖示
    g.fillStyle = '#3b2f2a'; g.font = '900 11px Menlo, monospace'; g.textAlign = 'center';
    g.fillText(i === 0 ? 'GO' : (c === '#ffd24a' ? '?' : '$' + (60 + (i * 37) % 70)), x + TW / 2, y + 32);
  });
  // 貓:從目前這格跳到下一格
  const [ax, ay] = cells[at], [bx, by] = cells[(at + 1) % n];
  const rx = ax + (bx - ax) * frac + TW / 2, ry = ay + (by - ay) * frac + 8 - Math.sin(frac * Math.PI) * 18;
  g.fillStyle = 'rgba(0,0,0,.18)'; g.beginPath(); g.ellipse(ax + (bx - ax) * frac + TW / 2, ay + (by - ay) * frac + 16, 13, 5, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#ffb057';   // 主角是橘貓
  g.beginPath(); g.moveTo(rx - 12, ry - 17); g.lineTo(rx - 9, ry - 30); g.lineTo(rx - 2, ry - 22); g.fill(); g.beginPath(); g.moveTo(rx + 12, ry - 17); g.lineTo(rx + 9, ry - 30); g.lineTo(rx + 2, ry - 22); g.fill();   // 尖耳朵
  g.beginPath(); g.arc(rx, ry - 12, 13, 0, Math.PI * 2); g.fill();                                    // 頭
  g.fillStyle = '#2e6bd6'; g.beginPath(); g.roundRect(rx - 10, ry - 1, 20, 14, 5); g.fill();          // 衣服
  g.fillStyle = '#2b2420'; g.beginPath(); g.arc(rx - 5, ry - 13, 1.8, 0, 7); g.arc(rx + 5, ry - 13, 1.8, 0, 7); g.fill();   // 眼睛
  g.fillStyle = '#ffb3c7'; g.beginPath(); g.arc(rx, ry - 8, 1.6, 0, 7); g.fill();                     // 鼻子
  // 兩顆骰子:每 0.5 秒換一次點數,輕輕晃
  const pips = { 1: [[0, 0]], 2: [[-1, -1], [1, 1]], 3: [[-1, -1], [0, 0], [1, 1]], 4: [[-1, -1], [1, -1], [-1, 1], [1, 1]], 5: [[-1, -1], [1, -1], [0, 0], [-1, 1], [1, 1]], 6: [[-1, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [1, 1]] };
  const die = (cx, cy, v, rot) => {
    g.save(); g.translate(cx, cy); g.rotate(rot);
    g.fillStyle = 'rgba(0,0,0,.15)'; g.beginPath(); g.roundRect(-17, -13, 38, 38, 8); g.fill();
    g.fillStyle = '#fffdf8'; g.strokeStyle = '#5c4033'; g.lineWidth = 2; g.beginPath(); g.roundRect(-19, -19, 38, 38, 8); g.fill(); g.stroke();
    g.fillStyle = v === 1 ? '#e2483d' : '#2b2420'; for (const [px, py] of pips[v]) { g.beginPath(); g.arc(px * 9, py * 9, v === 1 ? 5 : 3.4, 0, 7); g.fill(); }
    g.restore();
  };
  const k = Math.floor(t * 2);
  die(W / 2 + 98, 130, 1 + (k * 5 + 2) % 6, Math.sin(t * 3) * 0.18); die(W / 2 + 146, 152, 1 + (k * 3 + 4) % 6, Math.sin(t * 3 + 1.4) * 0.18);
  // 標題 + 閃爍提示
  g.textAlign = 'center';
  // 標題跟著選的語言換:中文字用系統的中文字型(Menlo 沒有中文字)
  const zhT = gameLang === 'zh', t1 = zhT ? '貓咪股市' : 'CAT STREET', t2 = zhT ? '大富翁' : 'STOCKS';
  g.font = zhT ? '900 36px "PingFang TC", "Noto Sans TC", "Microsoft JhengHei", sans-serif' : '900 30px Menlo, monospace';
  g.fillStyle = 'rgba(0,0,0,.22)'; g.fillText(t1, W / 2 - 40 + 2, 138 + 2); g.fillText(t2, W / 2 - 40 + 2, (zhT ? 180 : 174) + 2);
  g.fillStyle = '#fff'; g.fillText(t1, W / 2 - 40, 138); g.fillStyle = '#ff7a59'; g.fillText(t2, W / 2 - 40, zhT ? 180 : 174);
  // 語言切換(左)和 PLAY(右)永遠畫在螢幕上(房間遠看也看得到,取代以前漂浮的 PLAY 牌子);
  // 只有鏡頭停在街機前才能按(點擊判定見 arcadeButtonAt),遠看時點機台是先飛過去
  {
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = 'rgba(59,47,42,.16)'; g.beginPath(); g.roundRect(ARC_BTN.zh.x - 4, ARC_BTN.zh.y - 4, ARC_BTN.zh.w + ARC_BTN.en.w + 10, ARC_BTN.zh.h + 8, 20); g.fill();
    for (const code of ['zh', 'en']) { const b = ARC_BTN[code], on = gameLang === code, hv = arcHover === code;
      g.save(); g.translate(b.x + b.w / 2, b.y + b.h / 2); if (hv) g.scale(1.08, 1.08); g.translate(-(b.x + b.w / 2), -(b.y + b.h / 2));
      if (on || hv) { g.fillStyle = on ? '#fff' : 'rgba(255,255,255,.55)'; g.beginPath(); g.roundRect(b.x, b.y, b.w, b.h, 16); g.fill(); }
      g.fillStyle = on ? '#3b2f2a' : hv ? '#3b2f2a' : '#6b594e'; g.font = '900 15px Menlo, "PingFang TC", monospace'; g.fillText(code === 'zh' ? '中文' : 'EN', b.x + b.w / 2, b.y + b.h / 2 + 1); g.restore(); }
    const p = ARC_BTN.play, hvP = arcHover === 'play', s = (hvP ? 1.1 : 1) + Math.sin(t * 5) * 0.04;
    g.save(); g.translate(p.x + p.w / 2, p.y + p.h / 2); g.scale(s, s);
    g.fillStyle = hvP ? '#c94a30' : '#d4553a'; g.beginPath(); g.roundRect(-p.w / 2, -p.h / 2 + 4, p.w, p.h, 19); g.fill();
    g.fillStyle = hvP ? '#ff9a7c' : '#ff7a59'; g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, 19); g.fill(); g.stroke();
    g.fillStyle = '#fff'; g.font = '900 17px Menlo, "PingFang TC", monospace'; g.fillText(gameLang === 'zh' ? '▶ 開始' : '▶ PLAY', 0, 1);
    g.restore(); g.textBaseline = 'alphabetic';
  }
  g.restore();
  // 掃描線,有點 CRT 味
  g.fillStyle = 'rgba(0,0,0,.08)'; for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 2);
}

window.__arcadeCanvas = arcadeCanvas;

// ---------- 螢幕上的股票線圖 ----------
const series = [];
// 假股價:圍繞 260 做均值回歸的隨機漫步,永遠夾在 220~300 之間(之前是有向上偏移的隨機漫步,放久會飄到一千多)
const PX_MIN = 220, PX_MAX = 300, PX_MID = 260;
const stepPrice = (v, amp) => Math.max(PX_MIN, Math.min(PX_MAX, v + (Math.random() - 0.5) * amp + (PX_MID - v) * 0.02));
let px = 250;
for (let i = 0; i < 120; i++) { px = stepPrice(px, 3.2); series.push(px); }
function drawScreen(t) {
  const g = screenCanvas.getContext('2d');
  const W = screenCanvas.width, Hh = screenCanvas.height;
  g.fillStyle = '#1a1a1f'; g.fillRect(0, 0, W, Hh);
  // 頂部
  g.fillStyle = '#fff'; g.font = '700 30px -apple-system, Helvetica, Arial'; g.fillText('NVDA', 28, 46);
  g.fillStyle = '#9a9aa8'; g.font = '500 18px -apple-system, Helvetica, Arial'; g.fillText('NVIDIA Corporation', 28, 72);
  const last = series[series.length - 1], first = series[0];
  const up = last >= first;
  g.fillStyle = up ? '#ff453a' : '#30d158'; g.font = '800 40px -apple-system, Helvetica, Arial';
  g.fillText('$' + last.toFixed(2), W - 190, 52);
  g.font = '600 18px -apple-system, Helvetica, Arial';
  g.fillText((up ? '+' : '') + (last - first).toFixed(2) + ' (' + ((last / first - 1) * 100).toFixed(2) + '%)', W - 190, 78);
  // 圖
  const x0 = 28, y0 = 100, w = W - 56, h = Hh - 140;
  const min = Math.min(...series), max = Math.max(...series), pad = (max - min) * 0.15 + 0.01;
  const X = (i) => x0 + i / (series.length - 1) * w;
  const Y = (v) => y0 + (1 - (v - (min - pad)) / (max - min + pad * 2)) * h;
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1;
  for (let k = 0; k < 4; k++) { const y = y0 + k * h / 3; g.beginPath(); g.moveTo(x0, y); g.lineTo(x0 + w, y); g.stroke(); }
  const col = up ? '#ff453a' : '#30d158';
  const grad = g.createLinearGradient(0, y0, 0, y0 + h); grad.addColorStop(0, col + '55'); grad.addColorStop(1, col + '00');
  g.beginPath(); g.moveTo(X(0), y0 + h);
  series.forEach((v, i) => g.lineTo(X(i), Y(v)));
  g.lineTo(X(series.length - 1), y0 + h); g.closePath(); g.fillStyle = grad; g.fill();
  g.beginPath(); series.forEach((v, i) => i ? g.lineTo(X(i), Y(v)) : g.moveTo(X(i), Y(v)));
  g.strokeStyle = col; g.lineWidth = 3; g.lineJoin = 'round'; g.stroke();
  // 即時點
  const lx = X(series.length - 1), ly = Y(last);
  g.fillStyle = col; g.beginPath(); g.arc(lx, ly, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = col + '44'; g.beginPath(); g.arc(lx, ly, 10 + 4 * Math.sin(t * 4), 0, Math.PI * 2); g.fill();
  // 底部期間列
  g.fillStyle = '#9a9aa8'; g.font = '600 16px -apple-system, Helvetica, Arial';
  ['1D', '1W', '1M', '3M', 'YTD', '1Y'].forEach((s, i) => {
    const x = 40 + i * 92;
    if (i === 2) { g.fillStyle = '#0a84ff'; g.beginPath(); g.roundRect(x - 12, Hh - 34, 52, 26, 8); g.fill(); g.fillStyle = '#fff'; }
    g.fillText(s, x, Hh - 15); g.fillStyle = '#9a9aa8';
  });
  screenTex.needsUpdate = true;
}
let lastTick = 0;
function tickSeries(now) {
  if (now - lastTick > 700) {
    lastTick = now;
    const v = stepPrice(series[series.length - 1], 2.8);
    series.push(v); series.shift();
  }
}

// ---------- 滾輪:往上滾鏡頭慢慢飛到電腦螢幕前,往下滾退回房間 ----------
let zoomT = 0, zoomGoal = 0, focusArcade = false;   // focusArcade:這次是飛向街機(而不是電腦螢幕)
const orbitPos = new THREE.Vector3(), orbitTarget = new THREE.Vector3();
const tagPos = new THREE.Vector3(), tagLook = new THREE.Vector3();
const scrPos = new THREE.Vector3(), scrNormal = new THREE.Vector3(), endPos = new THREE.Vector3(), lookTgt = new THREE.Vector3();
canvas.addEventListener('wheel', (e) => {
  if (story && !storyBusy()) return;                                      // 捲動版:滾輪交給 story.mjs
  e.preventDefault();
  if (performance.now() < wheelLockUntil) return;                        // 剛從螢幕退出:忽略滾輪慣性
  zoomGoal = Math.max(0, Math.min(1, zoomGoal + e.deltaY * 0.0015));   // 和介紹頁同方向:往前滾 = 前進
}, { passive: false });
function updateZoom(dt) {
  zoomT += (zoomGoal - zoomT) * Math.min(1, dt * 2.5);
  if (zoomT < 0.002) {
    zoomT = 0; focusArcade = false; pushT = 0; pushGoal = 0;
    if (gameFrame && !gameOn) { gameFrame.remove(); gameFrame = null; }   // 沒玩就離開街機:把預載的遊戲收掉,不要在背後一直跑
    controls.enabled = true; controls.autoRotate = true;
    // 自動旋轉到視角邊界就反向,左右來回
    const az = controls.getAzimuthalAngle(), sp = controls.autoRotateSpeed;
    if (az <= controls.minAzimuthAngle + 0.01 && sp > 0) controls.autoRotateSpeed = -Math.abs(sp);
    else if (az >= controls.maxAzimuthAngle - 0.01 && sp < 0) controls.autoRotateSpeed = Math.abs(sp);
    controls.update();
    orbitPos.copy(camera.position); orbitTarget.copy(controls.target);     // 記住房間視角,退回時用
    return;
  }
  controls.enabled = false; controls.autoRotate = false;
  const e = zoomT * zoomT * (3 - 2 * zoomT);
  const half = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
  let dist;
  if (focusArcade && arcadeAnchor) {
    // 選單畫面:正對螢幕(沿螢幕法線),拉近到整個螢幕剛好完整放進視窗 —— 螢幕能多大就多大,機台只剩邊緣
    (arcadeScreen || arcadeAnchor).getWorldPosition(scrPos);
    (arcadeScreen || arcadeAnchor).getWorldDirection(scrNormal);
    dist = Math.max(0.36 / half, 0.49 / (half * camera.aspect)) * 1.03;
    // 按下 PLAY 之後再往螢幕推進:從「看得到機台」過渡到「螢幕蓋滿整個視窗」,推到底才換成真正的遊戲畫面
    pushT += (pushGoal - pushT) * Math.min(1, dt * 4.5);
    if (pushT > 0.001 && arcadeScreen) {
      const k = pushT * pushT * (3 - 2 * pushT);
      dist += (Math.min(0.36 / half, 0.49 / (half * camera.aspect)) * 0.96 - dist) * k;   // 取小的 = 螢幕「蓋滿」視窗,不留機台
      if (pushGoal === 1 && pushT > 0.97 && !gameOn) openGame();
    }
  } else {
    screenMesh.getWorldPosition(scrPos);
    screenMesh.getWorldDirection(scrNormal);                               // 平面 +z = 法線,朝向房間
    dist = Math.max(0.43 / half, 0.71 / (half * camera.aspect)) * 1.04;    // 讓整個螢幕剛好填滿畫面
  }
  endPos.copy(scrPos).addScaledVector(scrNormal, dist);
  camera.position.lerpVectors(orbitPos, endPos, e);
  lookTgt.lerpVectors(orbitTarget, scrPos, e);
  camera.lookAt(lookTgt);
  // 鏡頭快到街機前(0.9 就算,最後那段收尾很慢不用等):機台螢幕上出現語言 / PLAY 按鈕
  arcadeMenu = zoomGoal >= 1 && zoomT > 0.9 && focusArcade && !gameOn;
  if (focusArcade && zoomGoal >= 1 && zoomT > 0.35 && !gameOn && !gameFrame) prewarmGame();   // 鏡頭飛向街機的途中就開始預載遊戲
  // 街機選單時,房間的 ‹ 🖱 › 導覽列搬進格子圈裡面(語言 / 開始按鈕的下面):把螢幕上那個點投影到視窗座標。
  // 這樣格子圈可以占滿整個螢幕,貓在最下面一排跳的時候不會被導覽列擋住
  if (arcadeMenu && arcadeScreen && pushGoal === 0) {
    if (innerHeight > innerWidth) pillEl.style.bottom = '';      // 手機直拿:街機螢幕只占中間一條,導覽列直接留在畫面最底下
    else { pillV.set(0, (0.5 - ARC_PILL_Y / 385) * 0.72, 0); arcadeScreen.localToWorld(pillV).project(camera);
      pillEl.style.bottom = Math.max(14, Math.round(innerHeight - (1 - pillV.y) / 2 * innerHeight - pillEl.offsetHeight / 2)) + 'px'; }
  } else if (pillEl.style.bottom) pillEl.style.bottom = '';
  setBgm((zoomGoal >= 1 && focusArcade) || gameOn);   // 點了街機(選語言 / PLAY 的畫面)就開始放遊戲音樂,離開街機才停
  document.body.classList.toggle('arcade-on', zoomGoal >= 1 && focusArcade && zoomT > 0.5);   // 螢幕放到最大時,房間的 logo 和右下按鈕會蓋在上面 → 收起來
  if (zoomGoal >= 1 && zoomT > 0.985 && !focusArcade && !uiOn) showUI();     // 鏡頭到電腦螢幕 → 淡入介紹介面
}

// ---------- 螢幕介面:鏡頭定在螢幕後淡入,滾輪一頁一頁介紹功能;第一頁再往上滾 → 退回房間 ----------
const ui = document.getElementById('screen-ui');
const uiTrack = ui.querySelector('.track'), uiNum = ui.querySelector('.num'), uiDots = ui.querySelector('.dots');
const SLIDE_COUNT = buildSlides(uiTrack);                       // 頁面內容與 widget 在 intro.mjs
for (let i = 0; i < SLIDE_COUNT; i++) { const d = document.createElement('i'); d.onclick = () => setSlide(i); uiDots.appendChild(d); }
let slide = 0, uiOn = false, navLockUntil = 0, wheelLockUntil = 0;
function setSlide(i) {
  slide = Math.max(0, Math.min(SLIDE_COUNT - 1, i));
  uiTrack.style.transform = `translateY(${-slide * 100}%)`;
  uiNum.textContent = `${String(slide + 1).padStart(2, '0')} / ${String(SLIDE_COUNT).padStart(2, '0')}`;
  [...uiDots.children].forEach((d, k) => d.classList.toggle('on', k === slide));
  activateSlide(slide);                                          // 只跑目前這頁的 widget 動畫
}
function showUI() { uiOn = true; ui.classList.add('on'); document.body.classList.add('ui-on'); setSlide(0); navLockUntil = performance.now() + 900; }
function hideUI() { uiOn = false; ui.classList.remove('on'); document.body.classList.remove('ui-on'); zoomGoal = 0; wheelLockUntil = performance.now() + 1000; deactivate(); }
function uiNav(dir) {
  const now = performance.now(); if (now < navLockUntil) return; navLockUntil = now + 700;
  if (dir > 0) { if (slide < SLIDE_COUNT - 1) setSlide(slide + 1); }
  else { if (slide > 0) setSlide(slide - 1); else hideUI(); }
}
ui.addEventListener('wheel', (e) => { if (story) return; e.preventDefault(); if (Math.abs(e.deltaY) < 6) return; uiNav(e.deltaY > 0 ? 1 : -1); }, { passive: false });
let touchY0 = null;
ui.addEventListener('touchstart', (e) => { touchY0 = e.touches[0].clientY; }, { passive: true });
ui.addEventListener('touchend', (e) => { if (story || touchY0 === null) return; const dy = touchY0 - e.changedTouches[0].clientY; touchY0 = null; if (Math.abs(dy) > 40) uiNav(dy > 0 ? 1 : -1); });
// 底部控制列:‹ / › 等於滾輪往回 / 往前,中間鍵在房間 ↔ 螢幕之間切換
// 在房間裡:點一下 = 像滾一格(前進 1/3),按住不放 = 持續慢慢靠近/退遠;在介紹頁:點一下翻一頁
function holdButton(id, dir) {
  const el = document.getElementById(id);
  let timer = null, t0 = 0, moved = false;
  el.addEventListener('pointerdown', (e) => {
    e.preventDefault(); el.setPointerCapture(e.pointerId);
    t0 = performance.now(); moved = false;
    if (uiOn || gameOn || (story && !storyBusy())) return;
    timer = setInterval(() => {
      if (performance.now() - t0 < 220) return;                     // 220ms 內放開算點一下
      moved = true; zoomGoal = Math.max(0, Math.min(1, zoomGoal + dir * 0.02));   // 每 30ms 一小步 ≈ 1.5 秒走完
    }, 30);
  });
  const release = () => {
    if (timer) { clearInterval(timer); timer = null; }
    if (gameOn) { if (dir < 0) hideGame(); return; }
    if (story && !storyBusy()) { story.goto(Math.round(story.target) + dir); return; }
    if (uiOn) { uiNav(dir); return; }
    if (!moved) zoomGoal = Math.max(0, Math.min(1, zoomGoal + dir * 0.34));
  };
  el.addEventListener('pointerup', release);
  el.addEventListener('pointercancel', () => { if (timer) { clearInterval(timer); timer = null; } });
}
holdButton('next', 1); holdButton('prev', -1);
// 左上角的 CatInsight Stock:回到 3D 房間的總覽(關掉遊戲 / 電腦畫面、鏡頭拉回來);在新分頁開啟時就是這個房間的網址
document.getElementById('brand').onclick = (e) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1) return;
  e.preventDefault();
  if (gameOn) hideGame(); else if (uiOn) hideUI(); else { focusArcade = false; zoomGoal = 0; }
  if (story) story.goto(0);
};
document.getElementById('mid').onclick = () => { if (story && !storyBusy()) { story.goto(story.active ? 0 : 1); return; } if (gameOn) hideGame(); else if (uiOn) hideUI(); else { focusArcade = false; zoomGoal = zoomGoal >= 1 ? 0 : 1; } };
window.addEventListener('keydown', (e) => {
  if (gameOn) { if (e.key === 'Escape') hideGame(); return; }
  if (arcadeMenu && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); startGame(); return; }
  if (!uiOn) return;
  if (e.key === 'ArrowDown' || e.key === 'PageDown' || e.key === ' ') uiNav(1);
  else if (e.key === 'ArrowUp' || e.key === 'PageUp') uiNav(-1);
  else if (e.key === 'Escape') hideUI();
});
// 點螢幕也能進去(手機沒有滾輪)
const raycaster = new THREE.Raycaster(); const ndc = new THREE.Vector2(); let pd = null;
canvas.addEventListener('pointerdown', (e) => { pd = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', (e) => {
  if (story && story.active) { pd = null; return; }                       // 捲動版離開房間後,點畫面不做房間的事
  if (!pd || Math.hypot(e.clientX - pd.x, e.clientY - pd.y) > 6 || !screenMesh) { pd = null; return; }
  pd = null;
  ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1);
  raycaster.setFromCamera(ndc, camera);
  if (arcadeMenu && arcadeScreen && pushGoal === 0) {    // 已經停在街機前:點的是機台螢幕上的哪顆按鈕
    const hit = raycaster.intersectObject(arcadeScreen)[0];
    if (hit && hit.uv) {
      const b = arcadeButtonAt(hit.uv.x * 520, (1 - hit.uv.y) * 385);
      if (b) uiSfx('click');
      if (b === 'play') startGame(); else if (b) setGameLang(b);
      return;
    }
  }
  if (camRig && zoomT === 0 && raycaster.intersectObject(camRig, true).length) { camGreet.start(); uiSfx('hover'); return; }   // 點攝影機:打招呼
  if (raycaster.intersectObject(screenMesh).length) { if (story) story.goto(1); else { focusArcade = false; zoomGoal = 1; } }
  else if ((arcadeScreen && raycaster.intersectObject(arcadeScreen).length) || (arcadeModel && raycaster.intersectObject(arcadeModel, true).length)) { focusArcade = true; zoomGoal = 1; }
});

// ---------- 街機遊戲:點街機 → 鏡頭飛到街機螢幕 → iframe 載入股票大富翁(./board/) ----------
// 之前接的是貓咪瑪利歐:https://smaragdinex.github.io/cat-game/?minigame=1&v=16
const GAME_URL = './board/?v=287';   // v 參數用來避開 index.html 的快取
const gameUI = document.getElementById('game-ui'), gameCab = gameUI.querySelector('.cab'), gameScr = gameUI.querySelector('.scr');
let gameFrame = null, gameOn = false;
// 手機直拿(觸控、短邊 ≤ 1100px、直的)就把遊戲畫面轉 90° 變橫向;轉成橫拿或平板、電腦就正常顯示
function fitGameRot() {
  const portrait = false;      // 先關掉自動轉橫向:玩家自己把網站加到主畫面、把手機轉橫就好(要再開把這行改回判斷式)
  gameUI.classList.toggle('rot', portrait);
  gameScr.style.width = portrait ? innerHeight + 'px' : ''; gameScr.style.height = portrait ? innerWidth + 'px' : '';
}
addEventListener('resize', fitGameRot); addEventListener('orientationchange', () => setTimeout(fitGameRot, 150)); fitGameRot();
// 遊戲的背景音樂由房間這一頁來放(不是 iframe 裡的遊戲):這樣從街機選單(切換語言 / PLAY)就有音樂,進遊戲時不會斷。
// 瀏覽器規定要先有使用者操作才能出聲,所以在房間裡的任何一次點擊 / 按鍵時先把 AudioContext 建好(無聲),要播的時候再淡入
const bgm = { ctx: null, gain: null, want: false, loading: false, on: (() => { try { return localStorage.getItem('css.sound') !== '0'; } catch (e) { return true; } })() };
function bgmUnlock() {
  if (!bgm.ctx) {
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) {}
    bgm.ctx = new AC(); bgm.gain = bgm.ctx.createGain(); bgm.gain.gain.value = 0; bgm.gain.connect(bgm.ctx.destination);
  }
  if (bgm.want && bgm.ctx.state !== 'running') bgm.ctx.resume();
}
['pointerdown', 'pointerup', 'mouseup', 'touchend', 'click', 'keydown'].forEach((ev) => window.addEventListener(ev, bgmUnlock, { capture: true, passive: true }));
async function bgmLoad() {
  if (bgm.loading || !bgm.ctx) return; bgm.loading = true;
  try {
    const data = await (await fetch(new URL('./board/bgm.m4a?v=2', import.meta.url))).arrayBuffer();   // Mixkit「Serene View」,92 秒無接縫循環
    const buf = await new Promise((ok, no) => { const p = bgm.ctx.decodeAudioData(data, ok, no); if (p && p.then) p.then(ok, no); });
    const src = bgm.ctx.createBufferSource(); src.buffer = buf; src.loop = true; src.loopStart = 0.05; src.loopEnd = buf.duration - 0.05;   // 整檔循環(檔案本身已做成無接縫),只避開 AAC 頭尾幾個取樣
    src.connect(bgm.gain); src.start(0, 0.05);
  } catch (e) { console.warn('bgm', e); bgm.loading = false; }
}
function bgmLevel() { if (!bgm.ctx) return; const g = bgm.gain.gain, t = bgm.ctx.currentTime; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(bgm.want && bgm.on ? 0.55 : 0, t + 0.5); }
let bgmLast = null; window.__bgm = bgm;
function setBgm(want) {
  bgm.want = want;
  if (want && bgm.ctx) { if (!bgm.loading) bgmLoad(); if (bgm.ctx.state !== 'running' && !document.hidden) bgm.ctx.resume(); }
  if (want === bgmLast && (bgm.ctx || !want)) return;
  if (!bgm.ctx) return;                                   // 還沒有任何操作 → 等 bgmUnlock 之後下一幀再來
  bgmLast = want; bgmLevel();
}
document.addEventListener('visibilitychange', () => { if (!bgm.ctx) return; if (document.hidden) bgm.ctx.suspend(); else if (bgm.want) bgm.ctx.resume(); });
// 機台螢幕按鈕的小音效(和遊戲裡一樣用合成音):hover 一聲「嘀」、按下一聲「嗒」
function uiSfx(kind) {
  if (!bgm.ctx || !bgm.on || bgm.ctx.state !== 'running') return;
  const c = bgm.ctx, t = c.currentTime, o = c.createOscillator(), g = c.createGain();
  const [f0, f1, dur, vol, type] = kind === 'hover' ? [2637, 2960, 0.03, 0.06, 'sine'] : [5274, 5274, 0.04, 0.035, 'square'];
  o.type = type; o.frequency.setValueAtTime(f0, t); if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur + 0.02);
  o.connect(g); g.connect(c.destination); o.start(t); o.stop(t + dur + 0.03);
}
// 滑鼠在機台螢幕上移動:算出停在哪顆按鈕,換按鈕時響一聲、游標變成手
canvas.addEventListener('pointermove', (e) => {
  if (e.pointerType === 'touch') return;
  let hv = null;
  if (arcadeMenu && arcadeScreen && pushGoal === 0) {
    ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(arcadeScreen)[0];
    if (hit && hit.uv) hv = arcadeButtonAt(hit.uv.x * 520, (1 - hit.uv.y) * 385);
  }
  if (hv !== arcHover) { arcHover = hv; if (hv) uiSfx('hover'); }
  // 房間裡(還沒飛進去):滑到攝影機、電腦螢幕、街機上 = 可以點
  let onCam = false, hot3d = !!hv;
  if (!hv && zoomT === 0 && !uiOn && !(story && story.active)) {
    ndc.set((e.clientX / canvas.clientWidth) * 2 - 1, -(e.clientY / canvas.clientHeight) * 2 + 1); raycaster.setFromCamera(ndc, camera);
    onCam = !!camRig && raycaster.intersectObject(camRig, true).length > 0;
    hot3d = onCam || (screenMesh && raycaster.intersectObject(screenMesh).length > 0) || (arcadeModel && raycaster.intersectObject(arcadeModel, true).length > 0) || (arcadeScreen && raycaster.intersectObject(arcadeScreen).length > 0);
  }
  if (ccur) ccur.p.hot3d = hot3d;
  canvas.style.cursor = hot3d ? 'pointer' : '';
});
// ---------- 可以互動的物件上的提示點(很多遊戲那種):白色小點 + 一圈往外擴散的光圈,釘在物件上(鏡頭更新後才算位置);滑上去跳出小標籤,點它等於點那個物件 ----------
const hints = (() => {
  // class 叫 ihint:index.html 裡已經有一個舊的 .hint(捲動提示),手機上會被 display: none
  const st = document.createElement('style');
  st.textContent = `.ihint { position: fixed; left: 0; top: 0; z-index: 7; width: 36px; height: 36px; margin: -18px 0 0 -18px; padding: 0; border: 0; background: none; cursor: pointer; transition: opacity .35s; will-change: transform; -webkit-tap-highlight-color: transparent; }
    .ihint.off { opacity: 0; pointer-events: none; }
    .ihint .core { position: absolute; left: 50%; top: 50%; width: 10px; height: 10px; margin: -5px 0 0 -5px; border-radius: 50%; background: #fff; box-shadow: 0 0 0 3px rgba(255,255,255,.28), 0 0 14px rgba(255,255,255,.95); transition: transform .2s; }
    .ihint .ring { position: absolute; left: 50%; top: 50%; width: 18px; height: 18px; margin: -9px 0 0 -9px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.9); animation: hintPulse 1.9s ease-out infinite; }
    .ihint .ring + .ring { animation-delay: .95s; }
    @keyframes hintPulse { 0% { transform: scale(.55); opacity: .95; } 100% { transform: scale(2.1); opacity: 0; } }
    .ihint .lbl { position: absolute; left: 50%; bottom: 100%; transform: translate(-50%, 2px); padding: 6px 11px; border-radius: 999px; background: rgba(24,18,48,.85); color: #fff; font: 700 12px/1 -apple-system, "SF Pro Display", "Helvetica Neue", sans-serif; letter-spacing: .02em; white-space: nowrap; opacity: 0; transition: opacity .2s, transform .25s cubic-bezier(.2,.8,.2,1); pointer-events: none; }
    @media (hover: hover) { .ihint:hover .lbl { opacity: 1; transform: translate(-50%, -6px); } .ihint:hover .core { transform: scale(1.25); } }`;
  document.head.appendChild(st);
  const list = [];
  const add = (parent, x, y, z, label, act) => {
    const anchor = new THREE.Object3D(); anchor.position.set(x, y, z); parent.add(anchor);
    const el = document.createElement('button'); el.className = 'ihint off'; el.type = 'button'; el.setAttribute('aria-label', label);
    el.innerHTML = `<span class="ring"></span><span class="ring"></span><span class="core"></span><span class="lbl">${label}</span>`;
    el.addEventListener('click', (e) => { e.stopPropagation(); act(); });
    document.body.appendChild(el); list.push({ anchor, el, ph: list.length * 1.7 });
  };
  add(arcadeModel, 0, ARCADE_H + 0.16, 1.22, 'Play', () => { focusArcade = true; zoomGoal = 1; });
  add(screenMesh, 0.62, 0.36, 0.03, 'Explore', () => { if (story) story.goto(1); else { focusArcade = false; zoomGoal = 1; } });
  add(camHead, 0, 0.4, 0, 'Interact', () => { camGreet.start(); uiSfx('hover'); });
  const v = new THREE.Vector3();
  return { step(t) {
    const show = zoomT === 0 && !uiOn && !gameOn && !(story && story.active) && loadingEl.classList.contains('done');
    camera.updateMatrixWorld();                                    // 鏡頭這一格剛被 OrbitControls 動過,先更新矩陣再投影,點才不會晚一格
    for (const h of list) {
      h.anchor.getWorldPosition(v);
      // 在鏡頭後面、或跑出畫面外就藏起來
      const p = v.clone().project(camera), off = !show || p.z > 1 || Math.abs(p.x) > 1.05 || Math.abs(p.y) > 1.05;
      h.el.classList.toggle('off', off);
      if (!off) h.el.style.transform = `translate3d(${((p.x + 1) / 2 * innerWidth).toFixed(1)}px, ${((1 - p.y) / 2 * innerHeight).toFixed(1)}px, 0)`;   // 釘在物件上,不浮動
    }
  } };
})();
// ---------- 圓圈游標(只在有滑鼠的電腦上):跟著滑鼠的細圓圈 + 中心小點;滑到能互動的東西上,圓圈縮小變實心 ----------
const ccur = (() => {
  if (!matchMedia('(hover: hover) and (pointer: fine)').matches) return null;
  const st = document.createElement('style');
  st.textContent = `body.ccur-on, body.ccur-on * { cursor: none !important; }
    .ccur-ring, .ccur-dot { position: fixed; left: 0; top: 0; z-index: 99; pointer-events: none; border-radius: 50%; mix-blend-mode: difference; opacity: 0; transition: opacity .2s; will-change: transform; }
    .ccur-ring { width: 36px; height: 36px; margin: -18px 0 0 -18px; border: 1.5px solid #fff; box-sizing: border-box;
      transition: width .28s cubic-bezier(.2,.8,.2,1), height .28s cubic-bezier(.2,.8,.2,1), margin .28s cubic-bezier(.2,.8,.2,1), background-color .28s, border-width .28s, opacity .2s; }
    .ccur-ring.hot { width: 14px; height: 14px; margin: -7px 0 0 -7px; background-color: #fff; }
    .ccur-ring.down { width: 26px; height: 26px; margin: -13px 0 0 -13px; }
    .ccur-ring.hot.down { width: 10px; height: 10px; margin: -5px 0 0 -5px; }
    .ccur-dot { width: 4px; height: 4px; margin: -2px 0 0 -2px; background: #fff; }
    .ccur-dot.hot { opacity: 0 !important; }`;
  document.head.appendChild(st);
  const ring = document.createElement('div'), dot = document.createElement('div'); ring.className = 'ccur-ring'; dot.className = 'ccur-dot'; document.body.append(ring, dot);
  // 頁面上能按的東西:連結、按鈕、捲動版的 K 棒進度、手機螢幕上的分頁、會互動的圖表
  const SEL = 'a, button, [role=button], input, select, label, .story-prog i, .tabs span, .dots i, .chart canvas';
  const p = { x: -100, y: -100, rx: -100, ry: -100, hotDom: false, hot3d: false, down: false, inside: false };
  window.addEventListener('pointermove', (e) => { if (e.pointerType !== 'mouse') return; p.x = e.clientX; p.y = e.clientY; if (!p.inside) { p.rx = p.x; p.ry = p.y; } p.inside = true; p.hotDom = !!(e.target.closest && e.target.closest(SEL)); if (e.target !== canvas) p.hot3d = false; }, true);
  window.addEventListener('pointerdown', () => { p.down = true; }, true);
  window.addEventListener('pointerup', () => { p.down = false; }, true);
  document.documentElement.addEventListener('mouseleave', () => { p.inside = false; });
  window.addEventListener('blur', () => { p.inside = false; });
  return { p, step(dt) {
    const on = !gameOn;                                            // 遊戲(iframe)裡用系統游標,圓圈跟不進去
    document.body.classList.toggle('ccur-on', on);
    const k = 1 - Math.exp(-dt * 22); p.rx += (p.x - p.rx) * k; p.ry += (p.y - p.ry) * k;   // 圓圈慢一點點跟上,中心點直接跟著滑鼠
    ring.style.transform = `translate3d(${p.rx}px, ${p.ry}px, 0)`; dot.style.transform = `translate3d(${p.x}px, ${p.y}px, 0)`;
    const show = on && p.inside, hot = p.hotDom || p.hot3d;
    ring.style.opacity = dot.style.opacity = show ? '1' : '0';
    ring.classList.toggle('hot', hot); ring.classList.toggle('down', p.down); dot.classList.toggle('hot', hot);
  } };
})();
// 遊戲裡的 ♪ 靜音鈕會通知這一頁
window.addEventListener('message', (e) => { if (e.origin !== location.origin || !e.data || e.data.type !== 'css-sound') return; bgm.on = !!e.data.on; bgmLevel(); });
// 遊戲裡按「全螢幕」:把整個房間頁放到全螢幕(iframe 裡做不到),狀態變化再回報給遊戲更新按鈕
{ const doc = document, el = doc.documentElement, isFs = () => !!(doc.fullscreenElement || doc.webkitFullscreenElement);
  window.addEventListener('message', (e) => { if (e.origin === location.origin && e.data && e.data.type === 'css-exit') hideGame(); });   // 遊戲結算畫面的「退出」
  window.addEventListener('message', (e) => { if (e.origin !== location.origin || !e.data || e.data.type !== 'css-fullscreen') return;
    if (isFs()) (doc.exitFullscreen || doc.webkitExitFullscreen)?.call(doc); else (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el); });
  const report = () => { try { gameFrame?.contentWindow?.postMessage({ type: 'css-fullscreen-state', on: isFs() }, location.origin); } catch (e) {} };
  doc.addEventListener('fullscreenchange', report); doc.addEventListener('webkitfullscreenchange', report); }
// 在機台螢幕上按 PLAY → 直接 openGame()(以前會先把鏡頭推進螢幕,現在不推了)
function startGame() { if (gameOn) return; openGame(); }      // 不再把鏡頭推進螢幕(手機上比例會不對),按 PLAY 直接淡入遊戲的選角畫面
// 預載:鏡頭一到街機前(還在看選單)就把遊戲的 iframe 先在背後建好。此時 #game-ui 是透明的,
// 遊戲在裡面自己載程式和四個角色模型;等玩家按 PLAY、鏡頭推進完,直接顯示就是已經載好的選角畫面。
// 之後又換語言的話,用新語言重載一次(檔案都在快取裡,很快)
const gameSrc = () => `${GAME_URL}&lang=${gameLang}&embed=1`;
function prewarmGame() {
  if (gameOn) return;
  if (gameFrame && gameFrame.dataset.src === gameSrc()) return;
  if (gameFrame) gameFrame.remove();
  gameFrame = document.createElement('iframe'); gameFrame.dataset.src = gameSrc(); gameFrame.src = gameSrc(); gameFrame.allow = 'autoplay; fullscreen'; gameFrame.allowFullscreen = true; gameFrame.title = 'Cat Street Stocks';
  gameScr.appendChild(gameFrame);
}
// 全螢幕提示:手機瀏覽器開(不是從主畫面開)的話,進遊戲前提示一次「加入主畫面」。Android Chrome 會拿到安裝事件,可以一鍵安裝;iOS 只能教使用者按分享
let installEvt = null; addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); installEvt = e; });
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || matchMedia('(display-mode: fullscreen)').matches || navigator.standalone === true;
function pwaHint() {
  const phone = matchMedia('(pointer: coarse)').matches && Math.max(innerWidth, innerHeight) <= 1400;
  let snoozed = 0; try { snoozed = +localStorage.getItem('pwa-hint-ts') || 0; } catch (e) {}
  if (!phone || isStandalone() || Date.now() - snoozed < 3 * 86400e3) return;
  const ios = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const box = document.getElementById('pwa-hint'), zh = gameLang === 'zh';
  document.getElementById('pwa-title').textContent = zh ? '📱 想要全螢幕玩?' : '📱 Want it full screen?';
  document.getElementById('pwa-text').textContent = ios
    ? (zh ? '把這個網站加到主畫面,從主畫面打開就不會有網址列:\n按下方的「分享」⬆️ → 「加入主畫面」→ 再從主畫面開啟。' : 'Add this site to your Home Screen and open it from there:\ntap Share ⬆️ → "Add to Home Screen".')
    : installEvt ? (zh ? '安裝成主畫面 App,打開就是全螢幕。' : 'Install it as an app for a full-screen view.') : (zh ? '用瀏覽器選單的「加到主畫面」或「安裝應用程式」,從主畫面開啟就是全螢幕。' : 'Use the browser menu → "Add to Home screen" / "Install app".');
  const ins = document.getElementById('pwa-install'); ins.classList.toggle('hide', !installEvt || ios); ins.textContent = zh ? '安裝' : 'Install';
  ins.onclick = async () => { try { installEvt.prompt(); await installEvt.userChoice; } catch (e) {} installEvt = null; box.classList.add('hide'); };
  const ok = document.getElementById('pwa-ok'); ok.textContent = zh ? '知道了' : 'Got it';
  ok.onclick = () => { box.classList.add('hide'); try { localStorage.setItem('pwa-hint-ts', String(Date.now())); } catch (e) {} };
  box.classList.remove('hide');
}
function openGame() {
  pwaHint();
  arcadeMenu = false; prewarmGame(); gameOn = true; fitGameRot();   // 沒預載到(或語言不同)就現在建
  gameUI.classList.add('on'); document.body.classList.add('game-on');
  setTimeout(() => { try { gameFrame.contentWindow.focus(); } catch (e) {} }, 400);
}
function hideGame() {
  gameOn = false; gameUI.classList.remove('on'); document.body.classList.remove('game-on');
  if (gameFrame) { gameFrame.remove(); gameFrame = null; }                           // 移除 iframe,音樂一起停
  pushGoal = 0; pushT = 0; zoomGoal = 0; wheelLockUntil = performance.now() + 1000;
}
gameUI.addEventListener('wheel', (e) => { e.preventDefault(); }, { passive: false });
document.getElementById('game-exit').onclick = hideGame;
// 房間載完後閒置時,先把四個角色模型抓進瀏覽器快取(各約 250 KB),之後遊戲要用時不用再等下載
(window.requestIdleCallback || ((f) => setTimeout(f, 3000)))(() => {
  ['kitty', 'bunny', 'bear', 'pup', 'penguin', 'guinea', 'fox', 'pony'].forEach((n) => { fetch(`./board/${n}.glb?v=1`).catch(() => {}); });
});
window.addEventListener('message', (e) => { if (e.data && e.data.type === 'catgame-finished') console.log('cat arcade: cleared!'); });

// ---------- 進場動畫 + 迴圈 ----------
animated.forEach((g, i) => { g.userData.baseScale = g.scale.clone(); g.scale.setScalar(0.001); g.userData.delay = 0.15 + i * 0.07; });
const introStart = performance.now();
const clock = new THREE.Clock();
// 直式(手機)畫面窄,鏡頭要拉遠整間房才塞得進去:距離依長寬比調整
const BASE_DIST = camera.position.distanceTo(CAM_TARGET);
let lastAspect = 0;
function fitCamera(aspect) {
  const k = aspect >= 1.15 ? 1 : 1.28 / aspect;          // 越窄越遠
  const dist = BASE_DIST * Math.min(k, 2.2);
  const dir = camera.position.clone().sub(controls.target).normalize();
  camera.position.copy(controls.target).add(dir.multiplyScalar(dist));
  // 直式時看的目標點稍微往上,底部留給按鈕
  controls.target.set(0, aspect < 1 ? 1.35 : 1.55, 0);
}
function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) {
    renderer.setSize(w, h, false);
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }
  if (Math.abs(camera.aspect - lastAspect) > 0.01) { lastAspect = camera.aspect; fitCamera(camera.aspect); }
  if (composer && (composer._w !== w || composer._h !== h)) { composer._w = w; composer._h = h; composer.setSize(w, h); fxGrade.uniforms.uRes.value.set(w, h); }
}
let frameNo = 0;
function loop() {
  requestAnimationFrame(loop);
  if (window.__room) window.__room.frames++;
  resize();
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = (performance.now() - introStart) / 1000;         // 全部用真實時間,分頁切回來動畫接得上
  const introT = t;
  for (const g of animated) {
    const p = Math.max(0, Math.min(1, (introT - g.userData.delay) / 0.6));
    const e = 1 - Math.pow(1 - p, 3);                 // easeOut
    const overshoot = p < 1 ? 1 + 0.08 * Math.sin(p * Math.PI) : 1;
    g.scale.copy(g.userData.baseScale).multiplyScalar(Math.max(0.001, e * overshoot));
    if (g.userData.spin) g.rotation.y += g.userData.spin * dt;
    if (g.userData.jump) {
      // 每 2.6 秒跳一次:前 0.9 秒是拋物線,其餘停在架上
      const j = g.userData.jump, cycle = 2.6, air = 0.9;
      const u = ((t + j.phase) % cycle);
      const inAir = u < air;
      const hop = inAir ? Math.sin(Math.PI * u / air) : 0;
      g.position.y = j.baseY + j.height * hop;
      g.scale.y = g.userData.baseScale.y * (inAir ? 1 + 0.08 * hop : 1);   // 跳起來時微拉長
      // 空中轉一整圈(360°),落地剛好轉完;用 smoothstep 讓起跳/落地時轉速慢、最高點轉最快
      const k = inAir ? u / air : 1;
      const ease = k * k * (3 - 2 * k);
      const laps = Math.floor((t + j.phase) / cycle);
      g.rotation.y = (laps + ease) * Math.PI * 2;
    }
  }

  // 攝影機頭的左右掃 / 打招呼:在攝影機那段的 idleAnims 裡
  // 貓頭自由左右看:偶爾轉頭、停一下、再轉回來(用幾個不同頻率的 sin 疊出不規則的節奏)
  {
    const look = 0.55 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1.0) + 0.25 * Math.sin(t * 1.9 + 0.5) * Math.max(0, Math.sin(t * 0.31));
    catUniforms.uHead.value += (look - catUniforms.uHead.value) * Math.min(1, dt * 3);   // 平滑跟上
    catUniforms.uTail.value = -0.08 + 0.22 * Math.sin(t * 1.6) + 0.06 * Math.sin(t * 3.7 + 1.0);   // 尾巴左右搖(偏向外側,不打到腳)
  }

  // 仙人掌彎曲:把時間餵給每根的著色器
  for (const lf of plantLeaves) lf.userData.uni.uTime.value = t;
  for (const f of idleAnims) f(t);
  if (ccur) ccur.step(dt);
  if (playTag) {                                                          // PLAY 標記:上下漂浮 + 面向鏡頭(只轉 y 軸)
    playTag.position.y = ARCADE_H + 0.55 + 0.08 * Math.sin(t * 2.2);
    playTag.getWorldPosition(tagPos); tagLook.set(camera.position.x, tagPos.y, camera.position.z);
    playTag.lookAt(tagLook);
    playTag.children[1].rotation.y = t * 1.5;                             // 倒三角自轉
  }
  tickSeries(performance.now());
  drawScreen(t);
  if (arcadeScreen && (frameNo++ % 2 === 0)) { drawArcadeScreen(t); arcadeScreenTex.needsUpdate = true; }   // 街機螢幕每 2 幀更新
  if (livePoster && (liveN++ % 2 === 1)) livePoster(t);                                                       // 會動的照片每 2 幀更新(和街機錯開)
  if (story && !focusArcade && zoomT === 0) {
    if (!story.active) updateZoom(dt);                                    // 還在房間:照舊左右慢慢轉
    story.update(dt, t); hints.step(t); story.render();
  } else { if (story) story.idle(); updateZoom(dt); hints.step(t); if (composer) { fxGrade.uniforms.uTime.value = t; composer.render(dt); } else renderer.render(scene, camera); }
}
// 街機在用(飛過去 / 選單 / 遊戲中)時,捲動版不接滾輪
const storyBusy = () => gameOn || (focusArcade && (zoomGoal > 0 || zoomT > 0));
if (FX) {
  const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }, { ShaderPass }] = await Promise.all([
    import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'), import('three/addons/postprocessing/UnrealBloomPass.js'),
    import('three/addons/postprocessing/OutputPass.js'), import('three/addons/postprocessing/ShaderPass.js')]);
  // 背景:原本是網頁的紫色漸層透出來;開濾鏡後改畫在場景裡,暗角 / 調色才會一起套到
  const bg = document.createElement('canvas'); bg.width = bg.height = 512;
  { const g = bg.getContext('2d'), gr = g.createRadialGradient(256, 205, 0, 256, 205, 400); gr.addColorStop(0, '#3a2a66'); gr.addColorStop(0.45, '#2a1f4e'); gr.addColorStop(1, '#1d1538'); g.fillStyle = gr; g.fillRect(0, 0, 512, 512); }
  const bgTex = new THREE.CanvasTexture(bg); bgTex.colorSpace = THREE.SRGBColorSpace; scene.background = bgTex;
  const w = canvas.clientWidth, h = canvas.clientHeight, pr = renderer.getPixelRatio();
  // ── 只讓「自己會發光」的東西暈開(霓虹、螢幕、窗戶燈、燈泡):另外畫一張只有發光物、其他全黑的圖去做光暈,再疊回去。
  //    直接對整張畫面做光暈的話,被桌燈照得很亮的桌面也會暈成一片白
  // 貓咪模型有一點金黃自發光(0.3)只是為了顏色,不算發光物;很亮的大螢幕(街機、電腦)暈開要弱一點
  const glows = (m) => m && m.colorWrite !== false && (m.isMeshBasicMaterial || (m.emissive && m.emissiveIntensity >= 0.5 && m.emissive.getHex() !== 0));
  const gainOf = (o) => (o === arcadeScreen ? 0.18 : o === screenMesh ? 0.3 : o === arcadeMarquee ? 0.35 : 1);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 }), swapped = [], hidden = [], glowMats = new Map();
  const glowMat = (m, g) => {          // 發光圖用的版本:只留自發光(表面被燈照亮的部分不算),再乘上強度
    const key = m.uuid + g; let c = glowMats.get(key);
    if (!c) { c = m.clone(); if (c.isMeshBasicMaterial) c.color.multiplyScalar(g); else { c.color.set(0x000000); c.emissiveIntensity *= g; } glowMats.set(key, c); }
    return c;
  };
  const darken = () => scene.traverse((o) => {
    if (!o.visible) return;
    if (o.isMesh) { const m = Array.isArray(o.material) ? o.material[0] : o.material;
      if (m.transmission > 0 || (m.transparent && m.opacity < 0.9 && !glows(m))) { hidden.push(o); o.visible = false; return; }   // 玻璃:發光圖裡藏起來,不然會變成黑球擋住裡面發光的東西
      swapped.push([o, o.material]); o.material = glows(m) ? glowMat(m, gainOf(o)) : black; }
    else if (o.isLine || o.isPoints || o.isSprite) { hidden.push(o); o.visible = false; }
  });
  const restore = () => { for (const [o, m] of swapped) o.material = m; for (const o of hidden) o.visible = true; swapped.length = hidden.length = 0; };
  const bloomComposer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, stencilBuffer: true }));
  bloomComposer.renderToScreen = false; bloomComposer.setPixelRatio(pr * 0.5);   // 光暈本來就是糊的,用一半解析度算就好(手機省很多)
  bloomComposer.addPass(new RenderPass(scene, camera));
  bloomComposer.addPass(new UnrealBloomPass(new THREE.Vector2(w, h), 1.15, 0.5, 0.18));   // 強度、範圍、門檻(發光物以外都是黑的,門檻可以很低)
  const rt = new THREE.WebGLRenderTarget(w * pr, h * pr, { type: THREE.HalfFloatType, samples: 4, stencilBuffer: true });   // 自己的 MSAA(走濾鏡就不會用到畫布的抗鋸齒)
  composer = new EffectComposer(renderer, rt); composer._w = w; composer._h = h;
  composer.addPass(new RenderPass(scene, camera));
  // 環境遮蔽(GTAO)試過:這個場景在桌子下面會算出一塊黑色方塊,效果又不明顯,先不用
  const mix = new ShaderPass({ uniforms: { tDiffuse: { value: null }, tBloom: { value: null } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: 'uniform sampler2D tDiffuse, tBloom; varying vec2 vUv; void main(){ vec4 c = texture2D(tDiffuse, vUv); gl_FragColor = vec4(c.rgb + texture2D(tBloom, vUv).rgb, c.a); }' });
  mix.uniforms.tBloom.value = bloomComposer.renderTarget2.texture;   // 建立後再指定(render target 的貼圖不能被 cloneUniforms 複製)
  mix.needsSwap = true; composer.addPass(mix);
  composer.addPass(new OutputPass());                 // 色調映射(ACES)+ 轉 sRGB
  fxGrade = new ShaderPass({                          // 調色(暗部偏紫、亮部偏暖、對比 / 飽和度一點點)+ 暗角 + 底片顆粒
    uniforms: { tDiffuse: { value: null }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(w, h) }, uVig: { value: 0.3 }, uGrain: { value: 0.035 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float uTime, uVig, uGrain; uniform vec2 uRes; varying vec2 vUv;
      void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = dot(c, vec3(.299, .587, .114));
        c *= mix(vec3(1.05, 1.02, .95), vec3(1.0, .97, 1.07), 1.0 - l);
        c = (c - .5) * 1.06 + .5; c = mix(vec3(l), c, 1.08);
        vec2 p = vUv - .5; p.x *= uRes.x / uRes.y; c *= mix(1.0 - uVig, 1.0, smoothstep(.95, .3, length(p)));
        float n = fract(sin(dot(floor(vUv * uRes) + fract(uTime * 7.13) * 91.0, vec2(12.9898, 78.233))) * 43758.5453) - .5;
        gl_FragColor = vec4(c + n * uGrain, 1.0); }` });
  composer.addPass(fxGrade);
  // 每格:先畫發光圖(背景也要黑),再畫正式的
  const composerRender = composer.render.bind(composer), composerSize = composer.setSize.bind(composer);
  composer.render = (dt) => { scene.background = null; darken(); renderer.setClearColor(0x000000, 1); bloomComposer.render(dt); restore(); renderer.setClearColor(0x000000, 0); scene.background = bgTex; composerRender(dt); };
  composer.setSize = (W, H) => { composerSize(W, H); bloomComposer.setSize(W, H); };
}
if (STORY) {
  const ln = document.createElement('link'); ln.rel = 'stylesheet'; ln.href = './story.css?v=2'; document.head.appendChild(ln);
  const { initStory } = await import('./story.mjs?v=3');
  story = initStory({ THREE, scene, camera, controls, renderer, canvas, desk: deskGroup, orbit: { pos: orbitPos, target: orbitTarget }, busy: storyBusy });
  window.__story = story;
}
loop();
// 等兩個模型都載好再收掉 loading(最多等 6 秒,網路慢就先進房間、模型稍後出現)
const loadT0 = performance.now();
(function waitModels() {
  if ((pending.size === 0 && performance.now() - loadT0 > 400) || performance.now() - loadT0 > 6000) loadingEl.classList.add('done');
  else setTimeout(waitModels, 100);
})();
window.__room = { get camHeadY() { return camHead ? camHead.rotation.y : null; }, get camHeadPitch() { return camHead ? camHead.rotation.z : null; }, greetCam() { camGreet.start(); }, get arcade() { return arcadeModel; }, frames: 0, camera, controls, THREE, catUniforms, get zoomT() { return zoomT; }, setZoom(v) { zoomGoal = v; }, openGame, hideGame, fitGameRot, get poster() { return livePoster; } };
