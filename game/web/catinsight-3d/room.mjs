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
let ivySway = null;                 // 層板上的黃金葛:垂下來的藤蔓隨風輕擺

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
function group(x = 0, y = 0, z = 0, parent = root) {
  const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); animated.push(g); return g;
}

// ---------- 房間本體 ----------
const S = 6.4;            // 地板邊長
const T = 0.42;           // 牆厚
const H = 4.8;            // 牆高
// 底座(厚厚一塊)
box(S, 0.55, S, C.slab, { y: -0.275, r: 0.05, seg: 2 });
// 木地板條
for (let i = 0; i < 12; i++) {
  box(S - 0.2, 0.05, (S - 0.2) / 12 - 0.03, i % 2 ? C.plank : C.plankDark, { y: 0.025, z: -S / 2 + 0.1 + (i + 0.5) * ((S - 0.2) / 12), r: 0.01, seg: 1 });
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
box(SHELF_X1 - SHELF_X0, 0.12, 0.7, C.shelf, { x: (SHELF_X0 + SHELF_X1) / 2, y: 2.55, z: L.z + 0.15, r: 0.03, seg: 1 });
box(SHELF_X1 - SHELF_X0, 0.12, 0.7, C.shelf, { x: (SHELF_X0 + SHELF_X1) / 2, y: 1.65, z: L.z + 0.15, r: 0.03, seg: 1 });

// ---------- 粉紅牆:兩片層板(底下各一盞暖光)+ 霓虹招牌(貓掌 + K 線)----------
{
  const WX = S / 2 - T;                     // 粉牆內側的 x
  for (const [y, z0, z1] of [[2.35, 0.55, 2.45], [3.05, 0.9, 2.45]]) {
    box(0.42, 0.08, z1 - z0, C.shelf, { x: WX - 0.21, y, z: (z0 + z1) / 2, r: 0.02, seg: 1 });
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
  // 植物:角落一棵龜背芋(白盆 + 幾片大葉子),層板上一盆垂下來的常春藤
  { const p = group(2.42, 0, 1.25); cyl(0.2, 0.17, 0.3, 0xf7f1f2, { y: 0.15, parent: p }); cyl(0.17, 0.17, 0.02, 0x5a4330, { y: 0.3, parent: p });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f9a5a, roughness: 0.8, side: THREE.DoubleSide });
    [[0.3, 0.75, -0.2, 0.9, 0.5], [-0.25, 0.9, 0.15, 1.3, -0.4], [0.05, 1.1, 0.3, 0.3, 0.9], [-0.1, 0.65, -0.3, 2.4, 0.3], [0.25, 1.0, 0.05, 1.9, -0.7]].forEach(([x, y, z, ry, rz]) => {
      const stem = cyl(0.012, 0.012, Math.hypot(x, y - 0.3, z), 0x2f7a46, { parent: p }); stem.position.set(x / 2, (y + 0.3) / 2, z / 2); stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(x, y - 0.3, z).normalize());
      const leaf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), leafMat); leaf.scale.set(1, 0.08, 0.7); leaf.position.set(x, y, z); leaf.rotation.set(0, ry, rz); leaf.castShadow = true; p.add(leaf); }); }
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
    ivySway = (t) => { for (const v of sway) v.pivot.rotation[v.axis] = v.dir * v.amp * (Math.sin(t * 0.9 + v.ph) + 0.4 * Math.sin(t * 2.1 + v.ph * 2)); };
  }
  // 層板上的小東西:幾本書、一個小盆栽、一台玩具貓、掌上遊戲機
  box(0.22, 0.34, 0.06, 0x8b7cff, { x: WX - 0.21, y: 2.35 + 0.21, z: 0.8, r: 0.01, seg: 1 });
  box(0.22, 0.30, 0.06, 0xf27a5a, { x: WX - 0.21, y: 2.35 + 0.19, z: 0.88, r: 0.01, seg: 1 });
  box(0.22, 0.38, 0.06, 0x46bfcf, { x: WX - 0.21, y: 2.35 + 0.23, z: 0.96, r: 0.01, seg: 1 });
  cyl(0.09, 0.07, 0.14, 0xf3c9db, { x: WX - 0.21, y: 2.35 + 0.11, z: 1.6 });
  sphere(0.13, 0x3fc9c0, { x: WX - 0.21, y: 2.35 + 0.3, z: 1.6 });
  sphere(0.11, 0xf7f1f2, { x: WX - 0.21, y: 3.05 + 0.15, z: 2.1 }); sphere(0.07, 0xf7f1f2, { x: WX - 0.21, y: 3.05 + 0.3, z: 2.1 });   // 招財貓(簡化)
  box(0.16, 0.26, 0.06, 0xf0a7c8, { x: WX - 0.21, y: 3.05 + 0.17, z: 1.35, r: 0.015, seg: 1 }); box(0.1, 0.09, 0.02, 0x6fd9c2, { x: WX - 0.21, y: 3.05 + 0.22, z: 1.33, r: 0.004, seg: 1 });   // 掌上遊戲機
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
  // 2. 天空:藍紫 → 粉紫垂直漸層,星星、月亮
  const skyTex = mk(1024, 1024, (g, w, h) => { const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#1b1442'); sky.addColorStop(0.55, '#4a3690'); sky.addColorStop(1, '#f07cb6'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = 'rgba(255,255,255,.9)'; for (let i = 0; i < 260; i++) { g.beginPath(); g.arc(Math.random() * w, Math.random() * h * 0.55, Math.random() * 1.3 + 0.3, 0, 7); g.fill(); }
    g.fillStyle = '#fff1c4'; g.beginPath(); g.arc(300, 150, 14, 0, 7); g.fill(); g.fillStyle = '#2b1f5c'; g.beginPath(); g.arc(306, 146, 12, 0, 7); g.fill(); });
  // 天空和城市都做很寬(從斜角、手機直拿透過開口看也不會看到邊)
  const sky = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, H * 3), new THREE.MeshBasicMaterial({ map: skyTex, ...STENCIL }));
  sky.position.set(cx, H / 2 - 0.2, L.z - 3.4); sky.renderOrder = -10; root.add(sky);
  // 3. 城市底部的柔和橘紫光(加色混合的漸層面)
  const glowTex = mk(256, 128, (g, w, h) => { const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,140,90,0)'); gr.addColorStop(1, 'rgba(255,120,110,.55)'); g.fillStyle = gr; g.fillRect(0, 0, w, h); });
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(S * 5, 2.2), new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, ...STENCIL }));
  glow.position.set(cx, 0.6, L.z - 3.1); glow.renderOrder = -9; root.add(glow);
  // 4. 高樓:窗戶貼圖(暖黃亮窗,隨機有亮有暗),當 emissiveMap 貼在深色方塊上;遠近兩層各一個 InstancedMesh,高度 / 寬度隨機
  // 窗戶貼圖:一格 32px 一扇窗,大約 1/3 亮著(真的夜景大多數窗是暗的);每棟樓只重複 1×2 → 一棟 4~8 扇,不會密到像雜訊
  // 每張貼圖至少 3 扇亮窗(不然整棟黑掉);每層用 3 張不同圖案輪流,樓看起來才不會一模一樣
  const winTex = (lit) => { const t = mk(64, 128, (g, w, h) => { g.fillStyle = '#000'; g.fillRect(0, 0, w, h); const cells = []; for (let y = 10; y < h - 10; y += 32) for (let x = 10; x < w - 10; x += 32) cells.push([x, y]);
      let on = cells.map(() => Math.random() < lit); while (on.filter(Boolean).length < 3) on[Math.floor(Math.random() * on.length)] = true;
      cells.forEach(([x, y], i) => { if (on[i]) { g.fillStyle = Math.random() < 0.8 ? '#ffd27a' : '#ffe9b0'; g.fillRect(x, y, 12, 14); } }); });
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1, 2); return t; };
  const cityLayer = (count, z, hMin, hMax, color, lit, spread) => {
    const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
    const roof = new THREE.MeshStandardMaterial({ color, roughness: 0.95, ...STENCIL });   // 屋頂 / 底面沒有窗戶
    const K = 3, per = Math.ceil(count / K), ims = [], M = new THREE.Matrix4();
    for (let k = 0; k < K; k++) { const side = new THREE.MeshStandardMaterial({ color, emissive: 0xffffff, emissiveMap: winTex(lit), emissiveIntensity: 1.1, roughness: 0.9, ...STENCIL });
      const im = new THREE.InstancedMesh(geo, [side, side, roof, roof, side, side], per); im.renderOrder = -8; im.count = 0; root.add(im); ims.push(im); }   // BoxGeometry 面的順序:+x -x +y -y +z -z
    // 從左到右一棟接一棟排,中間留縫,排滿就停,不會疊在一起;三組貼圖輪流用
    let x = cx - spread / 2;
    for (let i = 0; i < count; i++) { const w = rnd(0.3, 0.6), h = rnd(hMin, hMax), d = rnd(0.4, 0.7);
      if (x + w > cx + spread / 2) break;
      const im = ims[i % K]; M.makeScale(w, h, d); M.setPosition(x + w / 2, -0.4, z - d / 2); im.setMatrixAt(im.count++, M); x += w + rnd(0.08, 0.3); }
    ims.forEach((im) => { im.instanceMatrix.needsUpdate = true; }); return ims;
  };
  cityLayer(40, L.z - 2.6, 1.2, 2.9, 0x3b2b6e, 0.3, S * 3.2);      // 遠景:較高、偏紫、亮窗少(排很寬,斜看也有樓)
  cityLayer(28, L.z - 1.5, 0.5, 1.5, 0x221a48, 0.4, S * 2.4);       // 近景:矮一截、更深色(上半部留給天空和月亮)
  // 5. 開口前一片玻璃:很淡、很光滑,室內的燈會在上面留一點反光
  const glass = new THREE.Mesh(new THREE.PlaneGeometry(openW, openH), new THREE.MeshStandardMaterial({ color: 0xcfe0ff, transparent: true, opacity: 0.07, roughness: 0.05, metalness: 0.35, depthWrite: false }));
  glass.position.set(cx, 0.5 + openH / 2, L.z + T / 2 + 0.02); glass.renderOrder = 5; root.add(glass);
  // 6. 夜景的冷光:從窗戶往房間打一盞低強度藍紫 RectAreaLight(窗框、層板、街機都會吃到)
  RectAreaLightUniformsLib.init();
  const cold = new THREE.RectAreaLight(0x8f80ff, 1.4, openW, openH); cold.position.set(cx, 0.5 + openH / 2, L.z + T / 2 + 0.05); cold.lookAt(cx, 1.6, 2); root.add(cold);
}
// ---------- 層架上的東西 ----------
{
  // 粗邊線框:把每條邊做成圓管、頂點放小球(WebGL 的線寬固定 1px,不能加粗,所以用實體)
  const thickEdges = (geometry, color, radius) => {
    const g = new THREE.Group();
    const edges = new THREE.EdgesGeometry(geometry);
    const pos = edges.attributes.position;
    const m = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 1.5, roughness: 0.4, toneMapped: false });   // 線框當螢光燈管:自發光
    const seen = new Set();
    for (let i = 0; i < pos.count; i += 2) {
      const a = new THREE.Vector3().fromBufferAttribute(pos, i);
      const b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
      const d = b.clone().sub(a);
      const cylm = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, d.length(), 10), m);
      cylm.position.copy(a).add(b).multiplyScalar(0.5);
      cylm.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
      cylm.castShadow = true; g.add(cylm);
      for (const v of [a, b]) {
        const k = v.toArray().map((n) => n.toFixed(3)).join(',');
        if (seen.has(k)) continue; seen.add(k);
        const sp = new THREE.Mesh(new THREE.SphereGeometry(radius * 1.05, 12, 10), m);
        sp.position.copy(v); sp.castShadow = true; g.add(sp);
      }
    }
    return g;
  };
  // 立方體(粉)
  const g1 = group(-1.35, 3.10, L.z + 0.15);
  const e1 = thickEdges(new THREE.BoxGeometry(0.5, 0.5, 0.5), C.wire1, 0.028);
  e1.rotation.set(0.5, 0.6, 0.2); g1.add(e1);
  { const l = new THREE.PointLight(C.wire1, 2.2, 2.6, 2); l.position.y = 0.1; g1.add(l); }   // 粉紅光
  g1.userData.jump = { phase: 0.0, height: 0.32, baseY: 3.10 };
  // 四面體(青)
  const g2 = group(-0.45, 3.14, L.z + 0.15);   // 四面體半徑 0.42,離層架面(2.61)要留夠,才不會插進去
  const e2 = thickEdges(new THREE.TetrahedronGeometry(0.42), C.wire2, 0.028);
  e2.rotation.set(0.3, 0.2, 0.4); g2.add(e2);
  { const l = new THREE.PointLight(C.wire2, 2.2, 2.6, 2); l.position.y = 0.1; g2.add(l); }   // 青色光
  g2.userData.jump = { phase: 1.1, height: 0.28, baseY: 3.14 };
  // 彩球方陣
  const g3 = group(1.1, 2.61, L.z + 0.15);
  let k = 0;
  for (let x = 0; x < 3; x++) for (let y = 0; y < 3; y++) for (let z = 0; z < 3; z++) {
    sphere(0.085, C.balls[k++ % C.balls.length], { x: (x - 1) * 0.19, y: y * 0.19 + 0.09, z: (z - 1) * 0.19, parent: g3 });
  }
}

// ---------- 街機(Meshy GLB:arcade.glb,Draco 壓縮 + 貼圖 1024)----------
const ARCADE_H = 2.5;                                            // 機台高度
let arcadeModel = null, arcadeAnchor = null, playTag = null, arcadeScreen = null, arcadeScreenTex = null;
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
  // 兩片側板(薰衣草紫):照參考模型量出來的街機側面輪廓 —— 下半身較淺、操作檯那段往前凸、
  // 螢幕那段往後斜收、最上面招牌再往前凸。座標是(深度 z, 高度 y),用 Shape 擠出厚度
  {
    const prof = [[0, 0], [1.36, 0], [1.36, 0.62], [1.62, 0.76], [1.62, 1.34], [1.50, 1.46], [1.24, 1.53], [1.08, 2.18], [1.36, 2.23], [1.36, ARCADE_H], [0, ARCADE_H]];
    const shape = new THREE.Shape(); prof.forEach(([z, y], i) => (i ? shape.lineTo(z, y) : shape.moveTo(z, y))); shape.closePath();
    const TH = 0.09, BV = 0.014;
    const geo = new THREE.ExtrudeGeometry(shape, { depth: TH - BV * 2, bevelEnabled: true, bevelThickness: BV, bevelSize: BV, bevelSegments: 2, curveSegments: 4 });
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(geo, mat(C.arcade)); sp.rotation.y = -Math.PI / 2;      // Shape 的 x → 世界 +z,擠出方向 → 世界 -x
      sp.position.set(sx > 0 ? W / 2 - BV : -W / 2 + TH - BV, 0, 0);
      sp.castShadow = true; sp.receiveShadow = true; m.add(sp);
    }
  }
  // 下半身(橘)+ 中央白條 + 投幣門
  box(IN, 0.74, 1.3, C.arcadeTop, { ...P, y: 0.37, z: 0.65, r: 0.03 });
  box(0.24, 0.72, 0.02, C.arcadeStripe, { ...P, y: 0.37, z: 1.305, r: 0.008 });
  box(0.34, 0.38, 0.03, C.arcade, { ...P, y: 0.38, z: 1.31, r: 0.02 });
  box(0.05, 0.14, 0.02, DARK, { ...P, x: -0.06, y: 0.42, z: 1.328, r: 0.008 });
  box(0.1, 0.1, 0.02, C.arcadeTop, { ...P, x: 0.08, y: 0.46, z: 1.328, r: 0.01 });
  // 操作檯底下往前凸的那一段(跟著側板的凸出)
  box(IN, 0.34, 1.52, C.arcadeTop, { ...P, y: 0.86, z: 0.76, r: 0.03 });
  // 操作檯:略往玩家這邊斜。搖桿在左、三顆按鈕在右,都比螢幕下緣低,不會撞在一起
  const deck = new THREE.Group(); deck.position.set(0, 1.05, 1.2); deck.rotation.x = 0.13; m.add(deck);
  const DP = { parent: deck };
  box(IN, 0.12, 0.78, C.arcadeTop, { ...DP, r: 0.03 });
  cyl(0.09, 0.11, 0.035, C.arcade, { ...DP, x: -0.26, y: 0.075, z: 0.12 });
  cyl(0.02, 0.02, 0.14, 0xffffff, { ...DP, x: -0.26, y: 0.16, z: 0.12 });
  { const ball = new THREE.Mesh(new THREE.SphereGeometry(0.062, 24, 18), mat(RED, { roughness: 0.45 })); ball.position.set(-0.26, 0.26, 0.12); ball.castShadow = true; deck.add(ball); }
  [[0.08, PURPLE], [0.25, C.arcadeTop], [0.42, C.plant]].forEach(([x, c]) => { cyl(0.078, 0.078, 0.025, C.arcadeStripe, { ...DP, x, y: 0.07, z: 0.12 }); cyl(0.058, 0.064, 0.045, c, { ...DP, x, y: 0.095, z: 0.12 }); });
  // 上半身(深紫機身)。螢幕下方多一塊凸出的「下巴」:把往後仰的螢幕邊框底下那個空隙補實,上面有三條喇叭孔
  box(IN, 1.26, 0.8, C.arcadeScreen, { ...P, y: 1.6, z: 0.4, r: 0.03 });
  box(IN, 0.42, 1.04, C.arcadeScreen, { ...P, y: 1.28, z: 0.52, r: 0.03 });
  for (let i = 0; i < 3; i++) box(0.34, 0.022, 0.012, DARK, { ...P, y: 1.24 + i * 0.055, z: 1.043, r: 0.004 });
  // 往後仰 20° 的螢幕邊框(比螢幕大一圈),螢幕那片 canvas 貼在它前面
  box(IN, 0.9, 0.09, DARK, { ...P, y: 1.82, z: 0.97, rx: -0.35, r: 0.03 });
  // 招牌(橘 + 發亮的燈箱):往前凸出到和側板上緣齊。底面要高過 y=2.24,鏡頭正對螢幕時才不會擋到螢幕最上面一排
  box(IN, 0.25, 1.3, C.arcadeTop, { ...P, y: ARCADE_H - 0.125, z: 0.65, r: 0.03 });
  for (const sx of [-1, 1]) { const l = new THREE.Mesh(new RoundedBoxGeometry(0.42, 0.15, 0.03, 2, 0.012), new THREE.MeshStandardMaterial({ color: 0xfff2c8, emissive: 0xffd76a, emissiveIntensity: 0.6, roughness: 0.6 }));   // 0.75 → 0.6:加了光暈之後太亮,調暗 20%
    l.position.set(sx * 0.28, ARCADE_H - 0.125, 1.305); m.add(l); }

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
let camHead = null;
{
  const t = group(-0.55, 0, -1.55); t.rotation.y = -Math.PI / 3;   // 整體朝右轉 60°;靠牆一點(層架前緣在 -2.14,腳架腳張開 0.5 不會碰到)
  // 三隻腳:腳底在地上張開,頂端收攏到雲台下方
  const legs = 3, head = new THREE.Vector3(0, 1.45, 0), spread = 0.5;
  for (let i = 0; i < legs; i++) {
    const a = i * (Math.PI * 2 / legs) + 0.4;
    const foot = new THREE.Vector3(Math.sin(a) * spread, 0.02, Math.cos(a) * spread);
    const dir = head.clone().sub(foot);
    const leg = cyl(0.03, 0.035, dir.length(), C.tripod, { parent: t });
    leg.position.copy(foot).add(head).multiplyScalar(0.5);
    leg.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  }
  cyl(0.05, 0.05, 0.4, C.tripod, { y: 1.55, parent: t });
  // 攝影機頭獨立一個 group,繞雲台左右慢慢掃(±30°)
  camHead = new THREE.Group(); camHead.position.y = 1.85; t.add(camHead);
  box(0.55, 0.32, 0.3, C.camera, { r: 0.06, parent: camHead });
  cyl(0.11, 0.09, 0.22, C.camera, { x: 0.35, parent: camHead, rz: Math.PI / 2 });
  cyl(0.085, 0.085, 0.02, C.cameraLens, { x: 0.47, parent: camHead, rz: Math.PI / 2 });
  box(0.22, 0.12, 0.08, C.arcadeTop, { x: -0.1, z: 0.19, r: 0.03, parent: camHead, seg: 1 });
  sphere(0.02, 0xff4d4d, { x: -0.2, y: 0.1, z: 0.16, parent: camHead });   // 錄影紅燈
}

// ---------- 地毯 / 滑板 ----------
box(3.6, 0.05, 2.7, C.rug, { x: -1.1, y: 0.075, z: 0.9, r: 0.02, seg: 1 });   // 地毯往左移 0.6
{ // 地毯上的貓臉圖案:畫在 canvas 上貼一片薄面(耳朵、眼睛、鼻子、鬍鬚,淺一號的青色)
  const cv = document.createElement('canvas'); cv.width = 720; cv.height = 540; const g = cv.getContext('2d');
  g.fillStyle = '#46bfcf'; g.fillRect(0, 0, 720, 540);
  g.strokeStyle = '#7fdbe6'; g.lineWidth = 14; g.lineCap = 'round'; g.lineJoin = 'round';
  g.beginPath(); g.roundRect(26, 26, 668, 488, 40); g.stroke();                       // 外框
  g.fillStyle = '#7fdbe6';
  g.beginPath(); g.moveTo(250, 250); g.lineTo(295, 130); g.lineTo(360, 230); g.closePath(); g.fill();   // 耳朵
  g.beginPath(); g.moveTo(470, 250); g.lineTo(425, 130); g.lineTo(360, 230); g.closePath(); g.fill();
  g.beginPath(); g.ellipse(360, 300, 125, 105, 0, 0, Math.PI * 2); g.fill();          // 臉
  g.fillStyle = '#46bfcf';
  g.beginPath(); g.ellipse(318, 290, 14, 20, 0, 0, Math.PI * 2); g.ellipse(402, 290, 14, 20, 0, 0, Math.PI * 2); g.fill();   // 眼睛
  g.beginPath(); g.moveTo(348, 322); g.lineTo(372, 322); g.lineTo(360, 336); g.closePath(); g.fill();                        // 鼻子
  g.strokeStyle = '#46bfcf'; g.lineWidth = 8;
  for (const sx of [-1, 1]) for (const dy of [-10, 12]) { g.beginPath(); g.moveTo(360 + sx * 60, 325 + dy); g.lineTo(360 + sx * 128, 318 + dy * 1.8); g.stroke(); }   // 鬍鬚
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(3.5, 2.6), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95 }));
  face.rotation.x = -Math.PI / 2; face.position.set(-1.1, 0.102, 0.9); face.receiveShadow = true; root.add(face); }
{
  const s = group(-1.55, 0.08, 1.75);   // 靠左邊
  s.rotation.y = 0.5;
  box(1.5, 0.06, 0.42, C.board, { y: 0.19, r: 0.03, parent: s });
  for (const [x, z] of [[-0.5, 0.18], [-0.5, -0.18], [0.5, 0.18], [0.5, -0.18]]) {
    cyl(0.07, 0.07, 0.06, C.wheel, { x, y: 0.08, z, parent: s, rx: Math.PI / 2 });
  }
}

// ---------- 書桌 / 螢幕 / 鍵盤 ----------
const screenCanvas = document.createElement('canvas'); screenCanvas.width = 640; screenCanvas.height = 400;
const screenTex = new THREE.CanvasTexture(screenCanvas); screenTex.colorSpace = THREE.SRGBColorSpace; screenTex.anisotropy = 8;
let screenMesh, deskGroup;
{
  const d = group(1.25, 0, -0.4);   // 往仙人掌(牆邊)方向移
  deskGroup = d;
  box(2.9, 0.12, 1.3, C.desk, { y: 1.35, r: 0.05, parent: d });
  for (const [x, z] of [[-1.3, 0.55], [-1.3, -0.55], [1.3, 0.55], [1.3, -0.55]]) {
    cyl(0.05, 0.05, 1.3, C.deskLeg, { x, y: 0.65, z, parent: d });
  }
  // 螢幕
  const m = group(0, 1.41, -0.25, d);
  cyl(0.28, 0.32, 0.05, C.stand, { y: 0.025, parent: m });
  cyl(0.05, 0.05, 0.42, C.stand, { y: 0.24, parent: m });
  box(1.55, 0.98, 0.08, C.monitorEdge, { y: 0.9, r: 0.04, parent: m });
  screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(1.42, 0.86), new THREE.MeshBasicMaterial({ map: screenTex }));
  screenMesh.position.set(0, 0.9, 0.045);
  m.add(screenMesh);
  // 耳機架:桌面右側,圓底座 + 立桿 + 頂端橫桿;耳機頭帶掛在橫桿上,兩個耳罩垂在立桿兩側
  const st = group(1.15, 1.41, -0.2, d);
  cyl(0.15, 0.16, 0.03, C.stand, { y: 0.015, parent: st });
  cyl(0.025, 0.025, 0.60, C.stand, { y: 0.30, parent: st });
  cyl(0.03, 0.03, 0.18, C.stand, { y: 0.60, parent: st, rx: Math.PI / 2 });
  // 耳機:米白色粗弧形頭帶,兩個橘色圓耳罩,內側淺色耳墊
  const hp = group(0, 0.42, 0, st);
  const CREAM = 0xf7f1f2, CUP = 0xf08262, PAD = 0xfbe3d8;
  const band = new THREE.Mesh(new THREE.TorusGeometry(0.21, 0.032, 12, 40, Math.PI), mat(CREAM));
  band.castShadow = true; hp.add(band);
  for (const sx of [-1, 1]) {
    // 頭帶末端往下一小段
    cyl(0.032, 0.032, 0.12, CREAM, { x: sx * 0.21, y: -0.06, parent: hp });
    // 耳罩:橘色圓盤,軸向 x(面朝內),外側再一片淺色耳墊
    cyl(0.09, 0.09, 0.06, CUP, { x: sx * 0.21, y: -0.13, parent: hp, rz: Math.PI / 2 });
    cyl(0.07, 0.07, 0.015, PAD, { x: sx * (0.21 - 0.035), y: -0.13, parent: hp, rz: Math.PI / 2 });
    cyl(0.035, 0.035, 0.02, CREAM, { x: sx * 0.21, y: -0.06, parent: hp });
  }
  // 鍵盤、滑鼠、滑鼠墊
  box(0.95, 0.03, 0.34, 0xd9c9ef, { x: 0, y: 1.42, z: 0.28, r: 0.01, parent: d, seg: 1, shadow: false });
  box(0.75, 0.05, 0.28, 0xf6eef8, { x: 0, y: 1.44, z: 0.28, r: 0.02, parent: d });
  box(0.16, 0.06, 0.22, 0xf6eef8, { x: 0.65, y: 1.44, z: 0.3, r: 0.04, parent: d });
  // 桌燈(暖橘):桌面左後角,圓底座 + 斜桿 + 燈罩,燈泡自發光,底下一盞暖色點光照亮桌面和牆
  // 造型:圓底座 → 直桿 → 關節球 → 斜桿 → 橘色半球燈罩(開口朝下偏桌面),罩裡一片發光圓盤
  const lamp = group(-1.15, 1.41, -0.42, d);
  const LAMP = 0xf2962e, LAMP_DARK = 0xd97d1e;
  cyl(0.13, 0.15, 0.04, LAMP_DARK, { y: 0.02, parent: lamp });
  cyl(0.022, 0.022, 0.5, LAMP, { y: 0.27, parent: lamp });
  sphere(0.04, LAMP_DARK, { y: 0.52, parent: lamp });
  const arm2 = cyl(0.02, 0.02, 0.42, LAMP, { parent: lamp }); arm2.position.set(0.17, 0.7, 0); arm2.rotation.z = -0.95;
  const shade = new THREE.Mesh(new THREE.SphereGeometry(0.17, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: LAMP, roughness: 0.55, side: THREE.DoubleSide }));
  shade.position.set(0.36, 0.86, 0); shade.rotation.z = -0.5; shade.castShadow = true; lamp.add(shade);
  const bulb = new THREE.Mesh(new THREE.CircleGeometry(0.15, 24), new THREE.MeshStandardMaterial({ color: 0xfff1cc, emissive: 0xffc466, emissiveIntensity: 1.8, side: THREE.DoubleSide }));
  bulb.position.set(0.36, 0.855, 0); bulb.rotation.set(Math.PI / 2, 0, -0.5); lamp.add(bulb);
  const lampLight = new THREE.PointLight(0xffb36b, 7, 5.5, 2); lampLight.position.set(0.4, 0.76, 0); lamp.add(lampLight);
  // 桌上小物:筆筒(幾支筆)、貓咪馬克杯
  cyl(0.06, 0.055, 0.14, 0xf7f1f2, { x: -0.75, y: 1.41 + 0.07, z: 0.05, parent: d });
  [[-0.77, 0x8b7cff], [-0.73, 0xf27a5a], [-0.75, 0x46bfcf]].forEach(([x, c], i) => cyl(0.008, 0.008, 0.22, c, { x, y: 1.41 + 0.2, z: 0.03 + i * 0.02, parent: d }));
  { const mug = group(-0.45, 1.41, 0.12, d); cyl(0.065, 0.06, 0.12, 0xf7a24a, { y: 0.06, parent: mug }); const h = new THREE.Mesh(new THREE.TorusGeometry(0.04, 0.012, 8, 16, Math.PI), mat(0xf7a24a)); h.position.set(0.07, 0.06, 0); h.rotation.z = -Math.PI / 2; mug.add(h);
    for (const sx of [-1, 1]) { const ear = new THREE.Mesh(new THREE.ConeGeometry(0.02, 0.04, 4), mat(0xf7a24a)); ear.position.set(sx * 0.035, 0.135, 0); mug.add(ear); } }
  // 螢幕光(青藍):從螢幕前面照向鍵盤和桌面
  const scrLight = new THREE.PointLight(0x7fd8ff, 3.5, 3.6, 2); scrLight.position.set(0, 2.2, 0.35); d.add(scrLight);
}

// ---------- 椅子 ----------
{
  const c = group(1.5, 0, 1.0);   // 跟著桌子移;桌面 z 到 0.25,椅墊從 1.15 開始,不重疊
  c.rotation.y = -0.35;
  box(0.9, 0.16, 0.9, C.chairDark, { y: 0.72, r: 0.07, parent: c });            // 座墊
  box(0.9, 1.0, 0.16, C.chair, { y: 1.3, z: -0.4, r: 0.07, parent: c });        // 靠背
  for (let i = 0; i < 3; i++) box(0.82, 0.03, 0.02, C.chairDark, { y: 0.95 + i * 0.3, z: -0.31, r: 0, parent: c, shadow: false });
  cyl(0.05, 0.05, 0.6, C.chairPost, { y: 0.35, parent: c });
  for (let i = 0; i < 5; i++) {
    const a = i * Math.PI * 2 / 5;
    const arm = box(0.5, 0.05, 0.08, C.chairPost, { x: Math.sin(a) * 0.25, y: 0.09, z: Math.cos(a) * 0.25, r: 0.02, parent: c, seg: 1 });
    arm.rotation.y = a + Math.PI / 2;
    sphere(0.06, C.chairPost, { x: Math.sin(a) * 0.48, y: 0.06, z: Math.cos(a) * 0.48, parent: c });
  }
}

// ---------- 植物 ----------
const plantLeaves = [];
{
  const p = group(1.85, 0, -1.9);
  cyl(0.28, 0.22, 0.28, C.chairDark, { y: 0.14, parent: p });
  // 每根葉子:高度方向切 24 段,頂點著色器依高度權重(底 0、頂 1,平方)往側邊推 → 根部不動、越上面彎越多
  const leaf = (h, x, z, tilt, col, phase) => {
    const pivot = new THREE.Group(); pivot.position.set(x, 0.28 + 0.1, z); p.add(pivot);
    pivot.rotation.z = tilt; pivot.rotation.x = tilt * 0.4;
    const geo = new THREE.CapsuleGeometry(0.17, h, 8, 16, 24);   // capSegments, radialSegments, heightSegments
    const material = mat(col);
    const uni = { uTime: { value: 0 }, uPhase: { value: phase }, uAmp: { value: 0.16 * (h / 1.9 + 0.4) }, uYMin: { value: -h / 2 - 0.17 }, uH: { value: h + 0.34 } };
    material.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, uni);
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime, uPhase, uAmp, uYMin, uH;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          float w = clamp((position.y - uYMin) / uH, 0.0, 1.0);
          w = w * w;                                   // 底部穩、頂端彎
          float sway = sin(uTime * 1.4 + uPhase) * uAmp;
          float sway2 = sin(uTime * 0.9 + uPhase * 1.7) * uAmp * 0.45;
          transformed.x += sway * w;
          transformed.z += sway2 * w;
          transformed.y -= (sway * sway + sway2 * sway2) * w * 0.35;   // 彎的時候高度略縮,比較像真的彎
        `);
    };
    material.customProgramCacheKey = () => 'cactus-bend';
    const m = new THREE.Mesh(geo, material);
    m.position.y = h / 2 + 0.17; m.castShadow = true; pivot.add(m);
    pivot.userData = { uni };
    plantLeaves.push(pivot);
  };
  leaf(1.9, 0, 0, 0.05, C.plant, 0);
  leaf(1.1, -0.28, 0.05, 0.45, C.plantDark, 1.3);
  leaf(0.9, 0.26, -0.05, -0.5, C.plant, 2.4);
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
  if (hv !== arcHover) { arcHover = hv; if (hv) uiSfx('hover'); canvas.style.cursor = hv ? 'pointer' : ''; }
});
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

  // 攝影機頭左右掃 ±30°(約 8 秒一個來回),外加一點點上下點頭
  if (camHead) {
    // 掃描角度 ±45°、約 5 秒一個來回,並在兩端稍作停留(smoothstep 曲線)
    const ph = (Math.sin(t * 1.25) + 1) / 2;
    const eased = ph * ph * (3 - 2 * ph);
    camHead.rotation.y = THREE.MathUtils.degToRad(-45 + 90 * eased);
    camHead.rotation.z = THREE.MathUtils.degToRad(4) * Math.sin(t * 2.5 + 1);
  }
  // 貓頭自由左右看:偶爾轉頭、停一下、再轉回來(用幾個不同頻率的 sin 疊出不規則的節奏)
  {
    const look = 0.55 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1.0) + 0.25 * Math.sin(t * 1.9 + 0.5) * Math.max(0, Math.sin(t * 0.31));
    catUniforms.uHead.value += (look - catUniforms.uHead.value) * Math.min(1, dt * 3);   // 平滑跟上
    catUniforms.uTail.value = -0.08 + 0.22 * Math.sin(t * 1.6) + 0.06 * Math.sin(t * 3.7 + 1.0);   // 尾巴左右搖(偏向外側,不打到腳)
  }

  // 仙人掌彎曲:把時間餵給每根的著色器
  for (const lf of plantLeaves) lf.userData.uni.uTime.value = t;
  if (ivySway) ivySway(t);
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
    story.update(dt, t); story.render();
  } else { if (story) story.idle(); updateZoom(dt); if (composer) { fxGrade.uniforms.uTime.value = t; composer.render(dt); } else renderer.render(scene, camera); }
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
  const gainOf = (o) => (o === arcadeScreen ? 0.18 : o === screenMesh ? 0.3 : 1);
  const black = new THREE.MeshBasicMaterial({ color: 0x000000 }), swapped = [], hidden = [], glowMats = new Map();
  const glowMat = (m, g) => {          // 發光圖用的版本:只留自發光(表面被燈照亮的部分不算),再乘上強度
    const key = m.uuid + g; let c = glowMats.get(key);
    if (!c) { c = m.clone(); if (c.isMeshBasicMaterial) c.color.multiplyScalar(g); else { c.color.set(0x000000); c.emissiveIntensity *= g; } glowMats.set(key, c); }
    return c;
  };
  const darken = () => scene.traverse((o) => {
    if (!o.visible) return;
    if (o.isMesh) { const m = Array.isArray(o.material) ? o.material[0] : o.material; swapped.push([o, o.material]); o.material = glows(m) ? glowMat(m, gainOf(o)) : black; }
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
  const { initStory } = await import('./story.mjs?v=2');
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
window.__room = { get camHeadY() { return camHead ? camHead.rotation.y : null; }, get arcade() { return arcadeModel; }, frames: 0, camera, controls, THREE, catUniforms, get zoomT() { return zoomT; }, setZoom(v) { zoomGoal = v; }, openGame, hideGame, fitGameRot, get poster() { return livePoster; } };
