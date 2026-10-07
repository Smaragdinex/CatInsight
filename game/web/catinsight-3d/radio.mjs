// radio.mjs — 房間音響的播放清單:音樂全部在瀏覽器裡用 Web Audio 即時合成(不下載任何有版權的音檔),每次播都不完全一樣。
// 一首歌 = 一個 make(ctx, out) 函式,回傳 { stop(at) };播放器負責排程、淡入淡出、換歌。
// 用法:const radio = makeRadio(() => audioContext); radio.toggle();  radio.level() 給畫面做律動

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

// 共用:一段用雜訊做的殘響(立體聲、指數衰減)
function makeReverb(ctx, seconds = 3.6, decay = 2.6) {
  const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  const c = ctx.createConvolver(); c.buffer = buf; return c;
}

// ---------- 第一首:Midnight Window(氛圍、放鬆;約 64 BPM,Gmaj9 → F#m7 → Em9 → Dmaj7,每個和弦兩小節) ----------
function midnightWindow(ctx, out) {
  const BPM = 64, BEAT = 60 / BPM, BAR = BEAT * 4, CHORD = BAR * 2;
  const CHORDS = [[43, [55, 59, 62, 66, 69]], [42, [54, 57, 61, 64, 69]], [40, [52, 55, 59, 62, 66]], [38, [50, 54, 57, 61, 64]]];   // [低音, 和弦音]
  const nodes = new Set(); const keep = (n) => { nodes.add(n); n.onended = () => nodes.delete(n); return n; };
  // 匯流排:乾聲 + 殘響 + 迴音(給鈴聲)
  const dry = ctx.createGain(); dry.gain.value = 0.9; dry.connect(out);
  const verb = makeReverb(ctx); const verbOut = ctx.createGain(); verbOut.gain.value = 0.55; verb.connect(verbOut); verbOut.connect(out);
  const toVerb = ctx.createGain(); toVerb.gain.value = 1; toVerb.connect(verb);
  const delay = ctx.createDelay(2); delay.delayTime.value = BEAT * 0.75; const fb = ctx.createGain(); fb.gain.value = 0.38; const dlp = ctx.createBiquadFilter(); dlp.type = 'lowpass'; dlp.frequency.value = 2600;
  delay.connect(dlp); dlp.connect(fb); fb.connect(delay); const delOut = ctx.createGain(); delOut.gain.value = 0.35; dlp.connect(delOut); delOut.connect(dry); delOut.connect(toVerb);
  // 墊子:每個和弦音兩顆略微走音的振盪器 → 低通(濾波器頻率慢慢呼吸)→ 慢起慢收的包絡
  const padLP = ctx.createBiquadFilter(); padLP.type = 'lowpass'; padLP.frequency.value = 900; padLP.Q.value = 0.4; padLP.connect(dry); padLP.connect(toVerb);
  const lfo = keep(ctx.createOscillator()); lfo.frequency.value = 0.05; const lfoG = ctx.createGain(); lfoG.gain.value = 380; lfo.connect(lfoG); lfoG.connect(padLP.frequency); lfo.start();
  const pad = (notes, t, dur) => {
    for (const n of notes) for (const [type, det, vol] of [['triangle', -7, 0.05], ['sawtooth', 6, 0.018]]) {
      const o = keep(ctx.createOscillator()), g = ctx.createGain(); o.type = type; o.frequency.value = midi(n); o.detune.value = det;
      g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + 2.4); g.gain.setValueAtTime(vol, t + dur - 0.2); g.gain.linearRampToValueAtTime(0, t + dur + 2.6);
      o.connect(g); g.connect(padLP); o.start(t); o.stop(t + dur + 2.8);
    }
  };
  const bass = (n, t, dur) => { const o = keep(ctx.createOscillator()), g = ctx.createGain(); o.type = 'sine'; o.frequency.value = midi(n);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.16, t + 0.12); g.gain.exponentialRampToValueAtTime(0.07, t + 1.5); g.gain.setValueAtTime(0.07, t + dur - 0.3); g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
    o.connect(g); g.connect(dry); o.start(t); o.stop(t + dur + 0.5); };
  // 鈴聲 / 電鋼琴:FM(載波 + 2 倍頻調變),短短的叮,送進迴音和殘響
  const bell = (n, t, vel) => { const c = keep(ctx.createOscillator()), m = keep(ctx.createOscillator()), mg = ctx.createGain(), g = ctx.createGain();
    c.type = 'sine'; m.type = 'sine'; c.frequency.value = midi(n); m.frequency.value = midi(n) * 2; mg.gain.setValueAtTime(midi(n) * 1.4 * vel, t); mg.gain.exponentialRampToValueAtTime(1, t + 1.2);
    m.connect(mg); mg.connect(c.frequency);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.008); g.gain.exponentialRampToValueAtTime(0.0008, t + 2.2);
    c.connect(g); g.connect(dry); g.connect(delay); g.connect(toVerb); c.start(t); m.start(t); c.stop(t + 2.3); m.stop(t + 2.3); };
  // 很淡的唱片沙沙聲 + 雨聲(帶通雜訊)+ 偶爾一聲小爆音
  { const len = ctx.sampleRate * 3, nb = ctx.createBuffer(1, len, ctx.sampleRate), d = nb.getChannelData(0); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (Math.random() < 0.0004 ? 6 : 0.35);
    const src = keep(ctx.createBufferSource()); src.buffer = nb; src.loop = true; const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 3800; bp.Q.value = 0.6; const ng = ctx.createGain(); ng.gain.value = 0.018;
    src.connect(bp); bp.connect(ng); ng.connect(out); src.start(); }
  // 排程:提前 0.3 秒排好接下來的音
  let next = ctx.currentTime + 0.1, step = 0, chordIx = 0, lastNote = 0;
  const STEP = BEAT / 2, STEPS_PER_CHORD = Math.round(CHORD / STEP);
  const tick = () => {
    while (next < ctx.currentTime + 0.3) {
      if (step % STEPS_PER_CHORD === 0) { const [b, ns] = CHORDS[chordIx % CHORDS.length]; pad(ns.slice(0, 4), next, CHORD); bass(b, next, CHORD); chordIx++; }
      const [, ns] = CHORDS[(chordIx - 1 + CHORDS.length) % CHORDS.length];
      const beatInBar = step % 8, p = beatInBar === 0 ? 0.55 : beatInBar % 2 ? 0.16 : 0.32;
      if (Math.random() < p) { let n = ns[Math.floor(Math.random() * ns.length)] + 12 * (Math.random() < 0.35 ? 1 : 0); if (n === lastNote) n += 12; lastNote = n; bell(n, next + (Math.random() - 0.5) * 0.02, 0.5 + Math.random() * 0.5); }
      next += STEP; step++;
    }
  };
  tick(); const timer = setInterval(tick, 60);
  return { stop(at) { clearInterval(timer); for (const n of nodes) { try { n.stop(at); } catch (e) {} } } };
}

export const PLAYLIST = [
  { title: 'Midnight Window', artist: 'CatInsight FM', mood: 'Ambient · Relax', make: midnightWindow },
];

export function makeRadio(getCtx) {
  let ctx = null, master = null, analyser = null, cur = null, ix = 0, playing = false, data = null;
  const listeners = new Set(), emit = () => listeners.forEach((f) => f());
  const ensure = () => {
    ctx = getCtx(); if (!ctx) return false;
    if (!master) { master = ctx.createGain(); master.gain.value = 0; const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3;
      analyser = ctx.createAnalyser(); analyser.fftSize = 256; data = new Uint8Array(analyser.frequencyBinCount); master.connect(comp); comp.connect(analyser); analyser.connect(ctx.destination); }
    if (ctx.state !== 'running') ctx.resume(); return true;
  };
  const fade = (to, sec) => { const t = ctx.currentTime, g = master.gain; g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(to, t + sec); };
  const startTrack = () => { if (cur) cur.stop(ctx.currentTime + 1.3); cur = PLAYLIST[ix].make(ctx, master); };
  const api = {
    autoPaused: false,
    get playing() { return playing; }, get track() { return PLAYLIST[ix]; }, get index() { return ix; }, get count() { return PLAYLIST.length; },
    play() { if (!ensure()) return; if (!playing) { startTrack(); playing = true; fade(0.85, 2.5); } api.autoPaused = false; emit(); },
    pause(auto = false) { if (!playing || !ctx) return; playing = false; api.autoPaused = auto; fade(0, 1.2); const c = cur; cur = null; if (c) c.stop(ctx.currentTime + 1.3); emit(); },
    toggle() { playing ? api.pause() : api.play(); },
    skip(d) { ix = (ix + d + PLAYLIST.length) % PLAYLIST.length; if (playing) { fade(0, 0.8); setTimeout(() => { if (!playing) return; startTrack(); fade(0.85, 1.6); }, 850); } emit(); },
    level() { if (!playing || !analyser) return 0; analyser.getByteFrequencyData(data); let s = 0; for (let i = 2; i < 40; i++) s += data[i]; return s / (38 * 255); },
    bands(n) { const out = new Array(n).fill(0); if (!playing || !analyser) return out; analyser.getByteFrequencyData(data); for (let i = 0; i < n; i++) { const a = 2 + Math.floor(i * 40 / n), b = 2 + Math.floor((i + 1) * 40 / n); let s = 0; for (let k = a; k < b; k++) s += data[k]; out[i] = s / ((b - a) * 255); } return out; },
    onChange(f) { listeners.add(f); },
  };
  return api;
}
