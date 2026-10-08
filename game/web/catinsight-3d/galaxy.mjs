// galaxy.mjs — 一個像哈伯照片(NGC 4414)那種的螺旋星系:暖黃白的核心、蓬鬆的絮狀旋臂、一條條棕色塵埃帶、外圍偏藍、零星藍白星團。
// 房間的電腦螢幕和飛進螢幕後的畫面各建一份(兩邊都用 ACES 色調映射 + sRGB 輸出,看起來才一樣);用固定的亂數種子,兩份長得一模一樣,時間也用同一個時鐘 → 飛進去時看起來就是「穿進螢幕裡」。
import * as THREE from 'three';

export const GAL_CAM = { pos: new THREE.Vector3(0, 700, 2600), fov: 40 };   // 螢幕和進去之後的第一個畫面都用這個鏡頭

export function createGalaxy({ seed = 4414 } = {}) {
  // 固定種子的亂數(mulberry32)
  let s = seed >>> 0; const rnd = () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const gauss = () => (rnd() + rnd() + rnd() - 1.5) / 1.5;
  const hash = (x, y) => { const v = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return v - Math.floor(v); };
  const vnoise = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), w = yf * yf * (3 - 2 * yf);
    return (hash(xi, yi) * (1 - u) + hash(xi + 1, yi) * u) * (1 - w) + (hash(xi, yi + 1) * (1 - u) + hash(xi + 1, yi + 1) * u) * w; };
  const fbm = (x, y) => vnoise(x, y) * 0.55 + vnoise(x * 2.1, y * 2.1) * 0.3 + vnoise(x * 4.3, y * 4.3) * 0.15;

  const glow = (() => { const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d'); const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.25, 'rgba(255,255,255,.6)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 128, 128); return new THREE.CanvasTexture(c); })();
  // 粒子:大小用「畫面高度」換算(螢幕貼圖和全螢幕看起來一樣大);離相機太近的淡掉;uFade 做淡入淡出
  const mats = [];
  const pointsMat = (sizeScale, dust = false) => { const m = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uMap: { value: glow }, uScale: { value: sizeScale }, uViewH: { value: 800 }, uFade: { value: 1 } },
    vertexShader: `attribute float aSize; attribute float aPh; attribute vec3 aCol; uniform float uTime, uScale, uViewH, uFade; varying vec3 vCol; varying float vA;
      void main() { vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_Position = projectionMatrix * mv; float k = uViewH / 800.0;
        float tw = ${dust ? '1.0' : '0.6 + 0.4 * sin(uTime * (0.8 + fract(aPh * 7.3) * 2.2) + aPh * 6.28)'};
        gl_PointSize = min(aSize * uScale * k * (900.0 / -mv.z) * (0.8 + 0.2 * tw), 26.0 * k); vCol = aCol; vA = tw * uFade * smoothstep(1.5, 14.0, -mv.z); }`,
    fragmentShader: `uniform sampler2D uMap; varying vec3 vCol; varying float vA;
      void main() { float a = texture2D(uMap, gl_PointCoord).a; ${dust ? 'gl_FragColor = vec4(vCol, a * 0.62 * vA);' : 'gl_FragColor = vec4(vCol * (0.65 + 0.5 * vA), a * (0.55 + 0.45 * vA) * min(1.0, vA * 2.0));'}
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    transparent: true, depthWrite: false, blending: dust ? THREE.NormalBlending : THREE.AdditiveBlending });
    mats.push(m); return m; };
  const points = (count, place, sizeScale, dust) => {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3), size = new Float32Array(count), ph = new Float32Array(count);
    const v = new THREE.Vector3(), c = new THREE.Color(); let n = 0, guard = 0;
    while (n < count && guard++ < count * 40) { const sz = place(v, c); if (sz <= 0) continue; pos.set([v.x, v.y, v.z], n * 3); col.set([c.r, c.g, c.b], n * 3); size[n] = sz; ph[n] = rnd(); n++; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos.subarray(0, n * 3), 3)); g.setAttribute('aCol', new THREE.BufferAttribute(col.subarray(0, n * 3), 3));
    g.setAttribute('aSize', new THREE.BufferAttribute(size.subarray(0, n), 1)); g.setAttribute('aPh', new THREE.BufferAttribute(ph.subarray(0, n), 1));
    const p = new THREE.Points(g, pointsMat(sizeScale, dust)); p.frustumCulled = false; return p;
  };

  const RD = 1150, SL = RD * 0.3;                                                       // 盤面半徑、指數盤的尺度長度
  const PITCH = Math.tan(THREE.MathUtils.degToRad(17)), R0 = RD * 0.06;
  const psi = (r, th) => th - Math.log(Math.max(r, R0) / R0) / PITCH;                // 螺旋座標:同一條旋臂上 psi 一樣
  // 旋臂密度:兩條主旋臂 + 很多短碎片(絮狀),用雜訊把相位打亂
  const armW = (r, th) => { const n = fbm(r / RD * 6 + Math.cos(th) * 2, r / RD * 6 + Math.sin(th) * 2); const ph = psi(r, th) * 2 + n * 3.2;
    return 0.5 + 0.5 * Math.cos(ph) * (0.6 + 0.4 * Math.cos(ph * 2.7 + n * 6)); };
  const diskR = () => { let r; do { r = -Math.log(1 - rnd() * 0.995) * SL; } while (r > RD * 1.05); return r; };
  const C = (h) => new THREE.Color(h);
  const WARM = [C(0xfff4dc), C(0xffe3b0), C(0xf3cf98)], BEIGE = C(0xdcc6a6), BLUE = C(0xb2c4ee), BLUE2 = C(0xd6e0ff), HII = C(0xff8fb8), DUST = C(0x3b2414);

  const root = new THREE.Group();                                                       // 整個星系往前傾、斜斜的(像照片)
  root.rotation.set(0.36, 0, -0.5);                                                     // 從鏡頭看大約傾斜 55°、長軸斜向左上到右下
  const disk = new THREE.Group(); root.add(disk);
  // 1. 核心:很亮、暖黃白、壓扁
  disk.add(points(8000, (v, c) => { const r = RD * 0.13 * Math.min(3, -Math.log(1 - rnd() * 0.99) * 0.5), u = rnd() * 2 - 1, a = rnd() * 6.283;
    v.set(Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r * 0.5, Math.sqrt(1 - u * u) * Math.sin(a) * r); const k = Math.min(1, r / (RD * 0.22));
    c.copy(WARM[0]).lerp(WARM[1], Math.min(1, k * 1.6)).lerp(WARM[2], Math.max(0, k - 0.5)); return 1.2 + rnd() * 1.8 * (1 - k * 0.4); }, 1.9));
  // 2. 盤面星星:沿旋臂比較密;內側米黃、外側偏藍;外側旋臂上有藍白星團、少數粉紅星雲
  disk.add(points(80000, (v, c) => { const r = diskR(), th = rnd() * 6.283, x = r / RD, w = armW(r, th);
    if (rnd() > 0.08 + 0.92 * Math.pow(w, 2.2) * (0.5 + 0.5 * Math.min(1, x * 4))) return 0;   // 旋臂和臂間的對比要夠,才看得出絮狀的旋臂
    v.set(Math.cos(th) * r, gauss() * RD * 0.012 * (1 + x), Math.sin(th) * r);
    c.copy(BEIGE).lerp(BLUE, THREE.MathUtils.smoothstep(x, 0.25, 0.85)).multiplyScalar((0.5 + 0.6 * w) * (1.15 - 0.45 * x));
    let sz = 0.6 + rnd() * 1.0;
    if (x > 0.3 && w > 0.7 && rnd() < 0.05) { c.copy(BLUE2); sz *= 2.2; }
    else if (x > 0.25 && w > 0.75 && rnd() < 0.012) { c.copy(HII); sz *= 1.8; }
    return sz; }, 1.4));
  // 3. 整片盤面的漫射光(很多很暗的點,讓星系看起來是一整片蓬鬆的光,不是一條條線)
  disk.add(points(18000, (v, c) => { const r = diskR(), th = rnd() * 6.283, x = r / RD;
    v.set(Math.cos(th) * r, gauss() * RD * 0.015, Math.sin(th) * r); c.copy(WARM[2]).lerp(BLUE, THREE.MathUtils.smoothstep(x, 0.15, 0.85)).multiplyScalar(0.16); return 1.6 + rnd() * 1.6; }, 1.5));
  // 4. 塵埃帶:沿著旋臂內緣的深棕色(一般混合,會把後面的光擋暗)
  const dust = points(30000, (v, c) => { const r = RD * (0.1 + rnd() * 0.8), th = rnd() * 6.283, x = r / RD;
    const n = fbm(r / RD * 6 + Math.cos(th) * 2, r / RD * 6 + Math.sin(th) * 2), lane = 0.5 + 0.5 * Math.cos(psi(r, th) * 2 + n * 3.2 + 1.9);
    if (lane < 0.6 || fbm(x * 26 + th * 3, th * 7) < 0.36) return 0;
    v.set(Math.cos(th) * r, gauss() * RD * 0.006, Math.sin(th) * r); c.copy(DUST).multiplyScalar(0.7 + rnd() * 0.5); return 2.6 + rnd() * 3.4; }, 1.4, true);
  dust.renderOrder = 2; disk.add(dust);
  // 5. 核心光暈 + 盤面的柔光(平面上的放射漸層,跟著盤面傾斜 → 橢圓的光)
  const coreGlow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: 0xffe2b0, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
  coreGlow.scale.setScalar(RD * 0.55); root.add(coreGlow);
  const diskGlowTex = (() => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(255,226,180,.4)'); gr.addColorStop(0.2, 'rgba(225,205,175,.12)'); gr.addColorStop(0.6, 'rgba(160,180,230,.04)'); gr.addColorStop(1, 'rgba(120,150,220,0)'); g.fillStyle = gr; g.fillRect(0, 0, 256, 256); return new THREE.CanvasTexture(c); })();
  const diskGlow = new THREE.Mesh(new THREE.PlaneGeometry(RD * 2.3, RD * 2.3), new THREE.MeshBasicMaterial({ map: diskGlowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
  diskGlow.rotation.x = -Math.PI / 2; disk.add(diskGlow);
  // 6. 背景星空(也是固定種子,兩邊一樣)
  const stars = points(2600, (v, c) => { const u = rnd() * 2 - 1, a = rnd() * 6.283, r = 6000 + rnd() * 4000;
    v.set(Math.sqrt(1 - u * u) * Math.cos(a) * r, u * r, Math.sqrt(1 - u * u) * Math.sin(a) * r); c.setHSL(0.58 + rnd() * 0.12, 0.35, 0.7 + rnd() * 0.3); if (rnd() < 0.04) c.setRGB(1, 0.55, 0.45); return 1.4 + rnd() * 2.6; }, 1);

  // 太陽的位置:一條旋臂上、離中心約 6 成
  const SUN_R = RD * 0.6, SUN_TH = Math.log(SUN_R / R0) / PITCH + 0.15;
  const sunLocal = new THREE.Vector3(Math.cos(SUN_TH) * SUN_R, 0, Math.sin(SUN_TH) * SUN_R);
  const scene = new THREE.Scene(); scene.add(root, stars);
  return {
    scene, root, disk, stars, coreGlow, diskGlow, sunLocal, RD,
    // time:用 performance.now() 的秒數(兩份共用同一個時鐘);fade:淡入淡出;viewH:畫的那張圖的高度(px)
    update(time, fade = 1, viewH = 800) {
      disk.rotation.y = time * 0.012;
      mats.forEach((m) => { m.uniforms.uTime.value = time; m.uniforms.uFade.value = fade; m.uniforms.uViewH.value = viewH; });
      coreGlow.material.opacity = 0.7 * fade; diskGlow.material.opacity = fade;
    },
  };
}
