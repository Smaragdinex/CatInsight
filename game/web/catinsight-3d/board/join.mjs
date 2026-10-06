// 貓咪股市大富翁 · 手機加入頁(大廳)
// 連到主機開的房間(Cloudflare Durable Object 轉送),選角色、取名字、按加入;主機按開始後就跳到棋盤頁
// (../?client=房號)自己畫棋盤。遊戲規則全部在主機跑。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
const $ = (id) => document.getElementById(id);
const API = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/board`;   // 房間 Worker 和網頁同一個網域
const q = new URLSearchParams(location.search);
const gid = sessionStorage.gid || (sessionStorage.gid = 'p' + Math.random().toString(36).slice(2, 10));   // 同一支手機重整頁面還能認回座位
const ST = { ws: null, code: (q.get('r') || '').toUpperCase().slice(0, 4), name: localStorage.getItem('css.jname') || '', char: null, chars: [], joined: false, started: false, retry: 0, hostOn: true };
const send = (m) => { if (ST.ws && ST.ws.readyState === 1) ST.ws.send(JSON.stringify(m)); };

// ---- 連線 ----
function connect() {
  if (!ST.code) return;
  const ws = new WebSocket(`${API}/room/${ST.code}/ws?role=guest`); ST.ws = ws;
  ws.onopen = () => { if (ST.joined || ST.started) send({ t: 'join', gid, name: ST.name, char: ST.char }); $('jmsg').textContent = ''; };
  ws.onmessage = (e) => { let m; try { m = JSON.parse(e.data); } catch (x) { return; } onMsg(m); };
  ws.onclose = (e) => { if (ST.ws !== ws) return; ST.ws = null; if (e.code === 1006 || e.reason !== 'expired') { $('jmsg').textContent = '連線中斷,重新連線中…'; ST.retry = setTimeout(connect, 2000); } else $('jmsg').textContent = '房間已過期'; };
  ws.onerror = () => {};
}
function onMsg(m) {
  if (m.t === 'lobby') { ST.chars = m.chars; paintChars(); if (!ST.joined) $('jmsg').textContent = ''; return; }
  if (m.t === 'joined') {
    if (!m.ok) { $('jmsg').textContent = m.reason === 'full' ? '房間已滿(最多 3 支手機)' : m.reason === 'started' ? '這一局已經開始,等下一局再加入' : '加入失敗'; ST.joined = false; return; }
    ST.joined = true; ST.char = m.char; ST.name = m.name; paintChars();
    if (m.started) { ST.started = true; sessionStorage.setItem('css.jchar', ST.char || ''); location.href = `../?client=${encodeURIComponent(ST.code)}&gid=${encodeURIComponent(gid)}&lang=zh`; }
    return;
  }
  if (m.t === 'start') { ST.started = true; sessionStorage.setItem('css.jchar', ST.char || ''); location.href = `../?client=${encodeURIComponent(m.code || ST.code)}&gid=${encodeURIComponent(gid)}&lang=zh`; return; }   // 開始:換到棋盤頁(手機自己畫棋盤)
  if (m.t === 'host') { ST.hostOn = !!m.on; $('jmsg').textContent = ST.hostOn ? '' : '主機離線了,等它回來…'; return; }
  if (m.t === 'reset') { ST.started = false; $('jform').classList.remove('hide'); paintChars(); return; }   // 主機按了再玩一次:回到大廳,等下一局
}
// ---- 大廳:3D 角色轉盤(和主機同一套模型,左右切換;被主機 / 別人選走的會跳過)----
const stage = (() => {
  const cv = $('jgl'), renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.shadowMap.enabled = true;
  const scene = new THREE.Scene(); scene.background = new THREE.Color(0xc9e8b8);
  scene.add(new THREE.HemisphereLight(0xffffff, 0xffe9c9, 1.15));
  const sun = new THREE.DirectionalLight(0xfff2dd, 1.7); sun.position.set(-4, 9, 6); sun.castShadow = true; sun.shadow.mapSize.set(1024, 1024);
  Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 1, far: 30 }); scene.add(sun);
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(40, 40), new THREE.MeshToonMaterial({ color: 0xc9e8b8 })); ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const ramp = new THREE.DataTexture(new Uint8Array([150, 150, 150, 255, 215, 215, 215, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat); ramp.minFilter = ramp.magFilter = THREE.NearestFilter; ramp.needsUpdate = true;
  const mat = (c) => new THREE.MeshToonMaterial({ color: c, gradientMap: ramp });
  // 幾朵花
  for (let i = 0; i < 40; i++) { const a = Math.random() * Math.PI * 2, d = 2.4 + Math.random() * 3; const f = new THREE.Mesh(new THREE.SphereGeometry(0.05, 6, 5), mat([0xffffff, 0xffd24a, 0xff9ec4][i % 3])); f.position.set(Math.cos(a) * d, 0.05, Math.sin(a) * d); scene.add(f); }
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100); const CAM_OFF = new THREE.Vector3(12, 11, 12), target = new THREE.Vector3(0.9, 0.5, 0.9);
  cam.position.copy(target).add(CAM_OFF); cam.lookAt(target);
  const loader = (() => { const d = new DRACOLoader(); d.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.174.0/examples/jsm/libs/draco/'); const l = new GLTFLoader(); l.setDRACOLoader(d); return l; })();
  const cache = {};
  const loadModel = (url, h) => (cache[url] ||= new Promise((res, rej) => loader.load(url, (g) => { const m = g.scene; const bb = new THREE.Box3().setFromObject(m), size = bb.getSize(new THREE.Vector3()), c = bb.getCenter(new THREE.Vector3()); const k = h / size.y;
    m.scale.setScalar(k); m.position.set(-c.x * k, -bb.min.y * k, -c.z * k); m.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.material = new THREE.MeshToonMaterial({ map: o.material.map || null, gradientMap: ramp, side: o.material.side }); } });
    const w = new THREE.Group(); w.add(m); res(w); }, undefined, rej)));
  let slots = [], sel = 0, cur = 0, R = Math.SQRT1_2, FRONT = Math.PI / 4, last = performance.now();
  function build(chars) {          // 依大廳給的角色清單建底座(只建一次)
    if (slots.length) { slots.forEach((sl, i) => { sl.taken = !!chars[i].taken && chars[i].taken !== gid; }); return; }
    slots = chars.map((c) => { const g = new THREE.Group(); scene.add(g);
      const base = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.68, 0.14, 40), mat(0xfff8ec)); base.position.y = 0.07; base.receiveShadow = true; base.castShadow = true; g.add(base);
      const ring = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.76, 0.06, 40), mat(0xff7a59)); ring.position.y = 0.03; g.add(ring);
      const holder = new THREE.Group(); holder.position.y = 0.14; holder.rotation.y = FRONT; g.add(holder);
      const ph = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), mat(c.color || 0xffb057)); ph.position.y = 0.4; holder.add(ph);
      loadModel(new URL(c.url, location.href.replace(/join\/.*$/, '')).href, c.h).then((tpl) => { holder.remove(ph); holder.add(tpl.clone(true)); }).catch(() => {});
      return { key: c.k, g, holder, ring, spin: 0, hop: 0, taken: !!c.taken && c.taken !== gid }; });
  }
  function select(i, dir = 1) { const n = slots.length; if (!n) return null; i = (i % n + n) % n; for (let c = 0; c < n && slots[i].taken; c++) i = (i + dir + n) % n; sel = i; slots[i].hop = 1; return slots[i].key; }
  function resize() { const w = cv.clientWidth, h = cv.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); const a = w / h, half = Math.max(2.1, 2.7 / a); cam.left = -half * a; cam.right = half * a; cam.top = half; cam.bottom = -half; cam.updateProjectionMatrix(); }
  function frame() {
    const now = performance.now(), dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (slots.length) {
      const order = slots.map((_, i) => i).filter((i) => !slots[i].taken), n = order.length || 1;
      const wrap = (v) => ((v % n) + n + n / 2) % n - n / 2;
      cur += wrap(order.indexOf(sel) - cur) * Math.min(1, dt * 7);
      slots.forEach((sl, i) => {
        if (sl.taken) { sl.g.visible = false; return; }
        const on = i === sel, rel = wrap(order.indexOf(i) - cur), a = Math.abs(rel);
        const o = rel * 1.95, back = Math.min(a, 2) * 0.75, k = Math.max(0, 1 - Math.max(0, a - 1) * 1.7), fwd = 1.2 - back;
        sl.g.position.set(o * R + fwd * R, 0, -o * R + fwd * R); sl.g.visible = k > 0.02; sl.g.scale.setScalar(Math.max(0.001, k));
        sl.hop = Math.max(0, sl.hop - dt * 2.2);
        const sT = Math.max(0.78, 1.3 - a * 0.52); sl.holder.scale.setScalar(sl.holder.scale.x + (sT - sl.holder.scale.x) * Math.min(1, dt * 10));
        sl.holder.position.y = 0.14 + Math.sin((1 - sl.hop) * Math.PI) * (sl.hop > 0 ? 0.35 : 0);
        if (on) sl.spin += dt * 1.1; else { const d = Math.atan2(Math.sin(-sl.spin), Math.cos(-sl.spin)); sl.spin += d * Math.min(1, dt * 6); }
        sl.holder.rotation.y = FRONT + sl.spin; sl.ring.visible = on;
      });
    }
    renderer.render(scene, cam); requestAnimationFrame(frame);
  }
  addEventListener('resize', resize); resize(); requestAnimationFrame(frame);
  return { build, select, get sel() { return sel; }, get slots() { return slots; } };
})();
function paintChars() {
  if (!ST.chars.length) return;
  stage.build(ST.chars); $('jhint').classList.add('hide');
  const idx = ST.chars.findIndex((c) => c.k === ST.char);
  const k = stage.select(idx >= 0 ? idx : 0);            // 自己選的被別人搶走就自動跳到下一個
  if (k && k !== ST.char) { ST.char = k; if (ST.joined) send({ t: 'join', gid, name: ST.name, char: ST.char }); }
  const c = ST.chars.find((x) => x.k === ST.char); $('jcharName').textContent = c ? c.name : '—'; $('jname').placeholder = c ? c.name : '你的名字';
  $('jgo').textContent = ST.joined ? `✓ 已加入(${c ? c.name : ''}),等主機開始` : (c ? `用${c.name}加入` : '加入');
}
const step = (d) => { if (!ST.chars.length) return; const k = stage.select(stage.sel + d, d); if (k) { ST.char = k; paintChars(); if (ST.joined) send({ t: 'join', gid, name: ST.name, char: ST.char }); } };
$('jprev').onclick = () => step(-1); $('jnext').onclick = () => step(1);
$('jcode').value = ST.code; $('jname').value = ST.name;
$('jcode').oninput = () => { ST.code = $('jcode').value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); $('jcode').value = ST.code; if (ST.code.length === 4 && !ST.ws) connect(); };
$('jgo').onclick = () => {
  ST.name = $('jname').value.trim().slice(0, 12) || ($('jname').placeholder !== '你的名字' ? $('jname').placeholder : '玩家'); localStorage.setItem('css.jname', ST.name);
  if (ST.code.length !== 4) { $('jmsg').textContent = '請輸入 4 碼房號'; return; }
  if (!ST.ws) connect();
  const go = () => send({ t: 'join', gid, name: ST.name, char: ST.char });
  if (ST.ws && ST.ws.readyState === 1) go(); else { const ws = ST.ws; ws.addEventListener('open', go, { once: true }); }
  $('jmsg').textContent = '';
};
if (ST.code.length === 4) connect();
