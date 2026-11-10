// Turbo Slot — simulador de coches de slot 1:32.
import * as THREE from '../vendor/three.module.min.js';
import { TRACKS, PREMIUM, PREMIUM_SEASON, findTrack, setPremium, sample, laneOffsets, LANE_W, DS } from './tracks.js';
import { PALETTE, RADII, newDraft, radiusOf, closeDraft, draftDef, drawEditor } from './editor.js';
import { RoomClient, sampleRemote, NET_DELAY } from './online.js';
import { replay } from './verify.js';
import { createMusic } from './music.js';
import { GAME_VERSION } from './version.js';
import { makeTerrain, buildMountain, buildCity } from './decor.js';
import { isSynced, mergeProfile, otherStats, fitProfile } from './sync.js';
import { step, newCarState, resolveSetup, DEFAULT_SETUP, SETUP_OPTIONS, DT, SCALE } from './physics.js';
import { buildProfile, aiThrottle } from './ai.js';
import { makeTelemetry, telStep, telLap, dangerColor, drawTrace, SECTORS } from './telemetry.js';
import { RGBELoader } from '../vendor/jsm/loaders/RGBELoader.js';
import { GLTFLoader } from '../vendor/jsm/loaders/GLTFLoader.js';
import * as SkeletonUtils from '../vendor/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';
import { EffectComposer } from '../vendor/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/jsm/postprocessing/RenderPass.js';
import { ShaderPass } from '../vendor/jsm/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from '../vendor/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/jsm/postprocessing/OutputPass.js';

// ---------------------------------------------------------------------------
// Utilidades y guardado
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
// Tiempos al milésimo: 2,874 · 1:02,874
const fmt = (t) => {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return (m ? `${m}:${s < 10 ? '0' : ''}` : '') + s.toFixed(3).replace('.', ',');
};
const fmtDelta = (d) => (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3).replace('.', ',');
const store = {
  get(k, d) { try { const v = localStorage.getItem('slot.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('slot.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } if (syncHook && isSynced(k)) syncHook(); },
};
let syncHook = null;   // con sesión iniciada: avisa de que hay progreso nuevo que subir
const settings = Object.assign({ sound: true, music: true, vibe: true, lefty: false, cam: 'tv', tele: true, brakes: true }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
// ¿Dentro de la app de iPhone/iPad (Capacitor)? Allí hay vibración nativa, barra de estado y actualizaciones al momento
const NATIVE = !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
const plugin = (n) => (NATIVE && window.Capacitor.Plugins && window.Capacitor.Plugins[n]) || null;
const vibrate = (p) => {
  if (!settings.vibe) return;
  const H = plugin('Haptics');
  if (H) {
    // En iPhone no existe navigator.vibrate: se usa el motor háptico (un golpe más fuerte cuanto más larga la vibración)
    const total = Array.isArray(p) ? p.reduce((a, b, i) => a + (i % 2 ? 0 : b), 0) : p;
    H.impact({ style: total > 120 ? 'HEAVY' : total > 40 ? 'MEDIUM' : 'LIGHT' }).catch(() => {});
    return;
  }
  if (navigator.vibrate) navigator.vibrate(p);
};
const classOf = (setupRaw) => (setupRaw.magnet === 'sin' ? 'pro' : 'iman');
const CLASS_NAME = { iman: 'Con imán', pro: 'Sin imán' };

// ---------------------------------------------------------------------------
// Decoraciones de los coches (todos los coches son iguales: gana el reglaje y el piloto)
// ---------------------------------------------------------------------------
export const LIVERIES = [
  { id: 'rojo', name: 'Escudería Roja', color: 0xc8191b, accent: 0xffffff, num: 7 },
  { id: 'azul', name: 'Azul Racing', color: 0x0f4fae, accent: 0xffc400, num: 12 },
  { id: 'verde', name: 'Verde Club', color: 0x137a43, accent: 0xf2f2f2, num: 23 },
  { id: 'amarillo', name: 'Amarillo Sport', color: 0xf2b200, accent: 0x141414, num: 44 },
  { id: 'negro', name: 'Negro GT', color: 0x1b1d22, accent: 0xff6a00, num: 1 },
  { id: 'blanco', name: 'Blanco Resistencia', color: 0xeeeeee, accent: 0xd32f2f, num: 88 },
];
// Frecuencia (por segundo) y tamaño de los errores de la CPU según el imán
const AI_ERR = { sin: { rate: 0.16, lo: 1.10, hi: 1.24 }, bajo: { rate: 0.12, lo: 1.08, hi: 1.2 }, medio: { rate: 0.11, lo: 1.07, hi: 1.2 }, alto: { rate: 0.09, lo: 1.06, hi: 1.17 } };
const RIVALS = ['M. Ortega', 'L. Ferrer', 'J. Sanz', 'A. Vidal', 'P. Navarro'];

// ---------------------------------------------------------------------------
// Sonido sintetizado: motor eléctrico, engranajes, ruedas y salidas
// ---------------------------------------------------------------------------
let actx = null, master = null;
// Sonido grabado de un coche de slot de verdad (BigSoundBank, CC0): se descarga al abrir el juego
// y se decodifica cuando se activa el audio (hace falta un toque en la pantalla).
let slotRaw = null, slotBuf = null;
const slotRawP = fetch('assets/audio/slot_loop.wav').then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))
  .catch(() => fetch('assets/audio/slot_loop.wav.txt').then((r) => (r.ok ? r.text() : Promise.reject())).then((b64) => {
    const bin = atob(b64.trim()); const u = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return u.buffer;
  }))
  .then((ab) => { slotRaw = ab; decodeSlot(); return ab; })
  .catch(() => null);
function decodeSlot() {
  if (!actx || !slotRaw || slotBuf) return;
  const ab = slotRaw.slice(0);
  actx.decodeAudioData(ab, (b) => { slotBuf = b; }, () => {});
}
let music = null;
function updateMusic() {
  if (!actx) return;
  if (!music) music = createMusic(actx, master);
  // Suena en la pantalla de inicio y en todo el juego, menos mientras se corre
  const want = settings.music && settings.sound && !['race', 'countdown'].includes(state);
  if (want && !music.playing && actx.state === 'running') music.play();
  else if (!want && music.playing) music.stop(0.6);
  const hint = document.getElementById('soundHint');
  if (hint) hint.hidden = actx.state === 'running' || !settings.sound;
}
// Los navegadores no dejan sonar nada hasta que se toca la pantalla: el primer toque arranca el audio
for (const ev of ['pointerdown', 'touchend', 'keydown']) window.addEventListener(ev, () => { initAudio(); }, { capture: true, passive: true });
function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = settings.sound ? 0.9 : 0;
    const comp = actx.createDynamicsCompressor();
    master.connect(comp).connect(actx.destination);
    decodeSlot();
  }
  if (actx.state === 'suspended') actx.resume();
}
function setMuted() { if (master) master.gain.value = settings.sound ? 0.9 : 0; }
function tone(f1, f2, dur, type = 'square', vol = 0.1, delay = 0) {
  if (!actx) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.05);
}
let noiseBuf = null;
function getNoise() {
  if (!noiseBuf && actx) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  return noiseBuf;
}
function noise(dur, vol, freq = 1200) {
  if (!actx) return;
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = getNoise(); f.type = 'bandpass'; f.frequency.value = freq;
  const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur);
}
const sfx = {
  click() { tone(900, 700, 0.05, 'triangle', 0.05); },
  light() { tone(520, 520, 0.18, 'square', 0.06); },
  go() { tone(1040, 1040, 0.4, 'square', 0.07); },
  lap() { tone(1320, 1320, 0.06, 'sine', 0.07); },
  best() { tone(1320, 1320, 0.07, 'sine', 0.07); tone(1760, 1760, 0.12, 'sine', 0.07, 0.08); },
  // El coche sale de la ranura y da vueltas: golpes de plástico cada vez más flojos
  crash() {
    noise(0.12, 0.25, 3000);
    let tt = 0, v = 0.5;
    for (let i = 0; i < 9; i++) { click(v, 1600 + Math.random() * 2400, 2, tt); tt += 0.05 + Math.random() * 0.12 + i * 0.012; v *= 0.72; }
  },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.05, i * 0.12)); },
};
// Sonido de coche de slot (no de coche de verdad). Lo que más se oye es el ROCE del coche
// rodando sobre la pista (un "shhh-rrrr" que sube con la velocidad); por debajo, muy suave,
// el motor eléctrico y los engranajes, el siseo de las trencillas, el "tac" de las juntas
// cada 35 cm y la goma al deslizar.
let clickBuf = null;
function getClick() {
  if (!clickBuf && actx) {
    const n = Math.round(actx.sampleRate * 0.012);
    clickBuf = actx.createBuffer(1, n, actx.sampleRate);
    const d = clickBuf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (n * 0.18));
  }
  return clickBuf;
}
// Golpecito corto de plástico (juntas de pista, chispas, piezas al volcar)
function click(vol, freq = 2600, q = 3, when = 0) {
  if (!actx || vol < 0.0005) return;
  const sN = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  sN.buffer = getClick(); sN.playbackRate.value = 0.8 + Math.random() * 0.5;
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
  g.gain.value = vol;
  sN.connect(f).connect(g).connect(master);
  sN.start(actx.currentTime + when);
}
// Curva de saturación suave: el zumbido "rasca" más cuanto más corriente pide el motor
const growlCurve = (() => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(x * 3) / Math.tanh(3); } return c; })();
function makeEngine(human) {
  if (!actx) return null;
  const now = actx.currentTime;
  // Motor: diente de sierra (colector) + cuadrada a la frecuencia de giro (rotor algo desequilibrado)
  const comm = actx.createOscillator(); comm.type = 'sawtooth';
  const rot = actx.createOscillator(); rot.type = 'square';
  const rotG = actx.createGain(); rotG.gain.value = 0.18;
  const pre = actx.createGain(); pre.gain.value = 1;
  const shaper = actx.createWaveShaper(); shaper.curve = growlCurve;
  // Sin graves (no es un motor de explosión) y con la resonancia de la carrocería de plástico
  const hp = actx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 260; hp.Q.value = 0.7;
  const body = actx.createBiquadFilter(); body.type = 'peaking'; body.frequency.value = 2300; body.Q.value = 1.6; body.gain.value = 7;
  const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 6500;
  const mg = actx.createGain(); mg.gain.value = 0;
  comm.connect(pre); rot.connect(rotG).connect(pre);
  pre.connect(shaper).connect(hp).connect(body).connect(lp).connect(mg).connect(master);
  // Engranajes: silbido fino del piñón (9 dientes)
  const gear = actx.createOscillator(); gear.type = 'triangle';
  const gg = actx.createGain(); gg.gain.value = 0;
  gear.connect(gg).connect(master);
  // Trencillas sobre los raíles: siseo agudo
  const br = actx.createBufferSource(); br.buffer = getNoise(); br.loop = true; br.playbackRate.value = 1.3;
  const brf = actx.createBiquadFilter(); brf.type = 'bandpass'; brf.frequency.value = 5200; brf.Q.value = 1.2;
  const brg = actx.createGain(); brg.gain.value = 0;
  br.connect(brf).connect(brg).connect(master);
  // EL sonido principal: el roce del coche rodando sobre la pista de plástico.
  // Ruido filtrado cuyo tono sube con la velocidad, con un "rrrr" al ritmo del giro de las ruedas.
  const rl = actx.createBufferSource(); rl.buffer = getNoise(); rl.loop = true;
  const rlf = actx.createBiquadFilter(); rlf.type = 'bandpass'; rlf.frequency.value = 500; rlf.Q.value = 0.7;
  const rlf2 = actx.createBiquadFilter(); rlf2.type = 'peaking'; rlf2.frequency.value = 2500; rlf2.Q.value = 1; rlf2.gain.value = 5;
  const rlam = actx.createGain(); rlam.gain.value = 0.75;          // modulación (rueda)
  const wob = actx.createOscillator(); wob.type = 'sine'; wob.frequency.value = 20;
  const wobG = actx.createGain(); wobG.gain.value = 0.25;
  wob.connect(wobG).connect(rlam.gain);
  const rlg = actx.createGain(); rlg.gain.value = 0;
  rl.connect(rlf).connect(rlf2).connect(rlam).connect(rlg).connect(master);
  // Goma al deslizar
  const sq = actx.createBufferSource(); sq.buffer = getNoise(); sq.loop = true;
  const sqf = actx.createBiquadFilter(); sqf.type = 'bandpass'; sqf.frequency.value = 1700; sqf.Q.value = 2.5;
  const sqg = actx.createGain(); sqg.gain.value = 0;
  sq.connect(sqf).connect(sqg).connect(master);
  for (const o of [comm, rot, gear, br, rl, sq, wob]) o.start(now + Math.random() * 0.05);
  return {
    comm, rot, gear, pre, body, mg, gg, brg, rlg, rlf, rlf2, wob, sqf, sqg, human,
    srcs: [comm, rot, gear, br, rl, sq, wob],
    vol: human ? 0.09 : 0.025, joint: null, spark: 0,
  };
}
// Bucle de la grabación real para un coche (empieza en un punto al azar para que no suenen iguales)
function attachRecording(e) {
  if (e.rec || !slotBuf) return;
  const src = actx.createBufferSource(); src.buffer = slotBuf; src.loop = true;
  const g = actx.createGain(); g.gain.value = 0;
  src.connect(g).connect(master);
  src.start(actx.currentTime, Math.random() * slotBuf.duration);
  e.rec = src; e.recG = g; e.srcs.push(src);
}
function updateEngine(e, st, on) {
  if (!e || !actx) return;
  attachRecording(e);
  const t = actx.currentTime;
  const rps = st.rpm / 60;                 // vueltas por segundo del motor (≈ 300 a tope)
  const v = Math.max(0, st.v);
  const load = clamp(Math.abs(st.amps) / 2.2, 0, 1);
  const spin = clamp(rps / 300, 0, 1);
  // Colector de 3 polos: 3 pulsos por vuelta (con un mínimo para que se oiga el arranque)
  const fc = Math.max(40, rps * 3);
  e.comm.frequency.setTargetAtTime(fc, t, 0.012);
  e.rot.frequency.setTargetAtTime(Math.max(14, rps), t, 0.012);
  e.gear.frequency.setTargetAtTime(Math.max(120, rps * 9), t, 0.012);
  e.pre.gain.setTargetAtTime(0.4 + load * 0.6, t, 0.03);
  e.body.frequency.setTargetAtTime(1900 + spin * 1400, t, 0.05);
  const live = on ? 1 : 0;
  const sp = clamp(v / 6, 0, 1);
  if (e.rec) {
    // Grabación real: la velocidad de reproducción y el volumen siguen a la velocidad del coche
    // (la grabación es de un coche a unos 3 m/s en una pista pequeña)
    e.rec.playbackRate.setTargetAtTime(clamp(0.42 + 0.58 * (v / 3), 0.42, 1.75), t, 0.05);
    e.recG.gain.setTargetAtTime(live * e.vol * 2.4 * clamp(Math.pow(v / 3.2, 0.75), 0, 1.3), t, 0.05);
    for (const g of [e.rlg, e.mg, e.gg, e.brg]) g.gain.setTargetAtTime(0, t, 0.05);
  } else {
    // Mientras se descarga la grabación: roce sintetizado
    e.rlf.frequency.setTargetAtTime(380 + sp * 1300, t, 0.04);
    e.rlf2.frequency.setTargetAtTime(1800 + sp * 2200, t, 0.05);
    e.wob.frequency.setTargetAtTime(6 + (v / (2 * Math.PI * 0.0105)) * 0.5, t, 0.03);
    e.rlg.gain.setTargetAtTime(live * e.vol * 1.6 * Math.pow(sp, 0.8) * (0.85 + 0.15 * load), t, 0.04);
    e.mg.gain.setTargetAtTime(live * e.vol * 0.07 * Math.pow(spin, 0.8), t, 0.03);
    e.gg.gain.setTargetAtTime(live * e.vol * 0.025 * spin, t, 0.04);
    e.brg.gain.setTargetAtTime(live * e.vol * 0.35 * sp, t, 0.04);
  }
  const slide = clamp((st.Fr - 0.9) * 6, 0, 1) * clamp(v - 0.6, 0, 1) + clamp((Math.abs(st.th) - 0.12) * 3, 0, 1) * clamp(v - 0.4, 0, 1);
  e.sqf.frequency.setTargetAtTime(1300 + v * 120, t, 0.05);
  e.sqg.gain.setTargetAtTime(live * e.vol * 1.1 * clamp(slide, 0, 1), t, 0.04);
  if (!on || !T) { e.joint = null; return; }
  // Juntas de pista cada 35 cm: "tac" de las ruedas delanteras y luego de las traseras
  const piece = 0.35 / SCALE;
  const j = Math.floor(st.s / piece);
  if (e.joint !== null && j !== e.joint && v > 0.25) {
    const vol = e.vol * (e.rec ? 0.35 : 0.9) * (e.human ? 1 : 0.7) * clamp(v / 4, 0.25, 1);
    const gap = 0.082 / Math.max(0.4, v);   // distancia entre ejes / velocidad
    click(vol, 2400, 2.5);
    if (gap < 0.25) click(vol * 0.7, 2100, 2.5, gap);
  }
  e.joint = j;
  // Chispazos de las trencillas al pedir mucha corriente
  e.spark -= 1 / 60;
  if (!e.rec && load > 0.7 && v > 0.5 && e.spark <= 0 && Math.random() < 0.2) { click(e.vol * 0.25 * load, 6500, 4); e.spark = 0.05 + Math.random() * 0.1; }
}
function stopEngine(e) {
  if (!e) return;
  for (const s of e.srcs) { try { s.stop(); } catch { /* ya parado */ } }
}

// ---------------------------------------------------------------------------
// Escena
// ---------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
// Entorno de reflejos: una sala con paneles de luz (pintura y metal reflejan como en un local de slot)
{
  const env = new THREE.Scene();
  const room = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), new THREE.MeshBasicMaterial({ color: 0x2a2f3a, side: THREE.BackSide }));
  room.position.y = 4; env.add(room);
  const panel = new THREE.MeshBasicMaterial({ color: 0xffffff });
  for (const [x, z, w, d] of [[-6, -4, 8, 1.2], [6, 4, 8, 1.2], [0, 0, 1.2, 10]]) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), panel); m.rotation.x = Math.PI / 2; m.position.set(x, 9.9, z); env.add(m);
  }
  const warm = new THREE.Mesh(new THREE.PlaneGeometry(10, 3), new THREE.MeshBasicMaterial({ color: 0xffb070 }));
  warm.position.set(0, 3, -14.9); env.add(warm);
  const pm = new THREE.PMREMGenerator(renderer);
  scene.environment = pm.fromScene(env, 0.04).texture;
  scene.environmentIntensity = 0.55;
  pm.dispose();
}
const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 400);
const hemi = new THREE.HemisphereLight(0xffffff, 0x445066, 1.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.3);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, sun.target);
const world = new THREE.Group();
scene.add(world);
const trackGroup = new THREE.Group();
world.add(trackGroup);
const carsGroup = new THREE.Group();
world.add(carsGroup);

// Escenarios: iluminación HDRI real (Poly Haven, CC0) y materiales de la mesa (ambientCG, CC0)
const SCENERY = {
  verde: { table: '#3d7d4c', table2: '#356c42', bg: ['#2a3550', '#121826'], light: 1, hdri: 'artist_workshop', mat: 'grass004', tint: 0xffffff },
  arena: { table: '#c9a26b', table2: '#b88f58', bg: ['#4a3a30', '#1b1411'], light: 1, hdri: 'artist_workshop', mat: 'ground037', tint: 0xf0e2c8 },
  noche: { table: '#26375a', table2: '#1f2e4c', bg: ['#141b2e', '#06080f'], light: 0.75, hdri: 'neon_photostudio', mat: 'fabric086', tint: 0x33457a },
  ciudad: { table: '#3a3d44', table2: '#30333a', bg: ['#141b2e', '#06080f'], light: 0.7, hdri: 'neon_photostudio', mat: 'ground037', tint: 0x5c5f66, night: true },
};
const texLoader = new THREE.TextureLoader();
const texCache = new Map();
function loadTex(name, srgb) {
  if (texCache.has(name)) return texCache.get(name);
  const t = texLoader.load(`assets/tex/${name}.jpg`);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.userData.keep = true;
  texCache.set(name, t);
  return t;
}
const hdrCache = new Map();
let currentHdri = null;
function setEnvironment(name) {
  if (currentHdri === name) return;
  currentHdri = name;
  const apply = (env) => {
    if (currentHdri !== name) return;
    scene.environment = env.pmrem;
    scene.background = env.tex;
    scene.backgroundBlurriness = 0.32;
    scene.backgroundIntensity = 0.55;
    scene.environmentIntensity = 0.85;
  };
  if (hdrCache.has(name)) { apply(hdrCache.get(name)); return; }
  const done = (tex) => {
    tex.mapping = THREE.EquirectangularReflectionMapping;
    const pm = new THREE.PMREMGenerator(renderer);
    const env = { tex, pmrem: pm.fromEquirectangular(tex).texture };
    pm.dispose();
    hdrCache.set(name, env);
    apply(env);
  };
  // Si el servidor no sirve .hdr (por ejemplo, dentro de Claude), se usa la copia en texto base64
  const fallback = () => fetch(`assets/hdri/${name}_512.hdr.txt`).then((r) => (r.ok ? r.text() : Promise.reject())).then((b64) => {
    const bin = Uint8Array.from(atob(b64.trim()), (c) => c.charCodeAt(0));
    const d = new RGBELoader().parse(bin.buffer);
    const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, d.type);
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.flipY = true;
    tex.needsUpdate = true;
    done(tex);
  }).catch(() => { /* sin HDRI: se queda el entorno sintético */ });
  new RGBELoader().load(`assets/hdri/${name}_512.hdr`, done, undefined, fallback);
}

function canvasTex(w, h, draw, repeat = true) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = renderer.capabilities.getMaxAnisotropy();
  return t;
}

let T = null; // circuito actual: { def, pts, L, half, lanes, offsets, bbox }

// Libera la memoria de la tarjeta gráfica de un grupo: geometrías, materiales y TODAS sus texturas
// (no solo la principal), menos las compartidas que se reutilizan (userData.keep)
const TEX_SLOTS = ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'emissiveMap', 'alphaMap', 'aoMap', 'bumpMap', 'lightMap', 'clearcoatMap', 'clearcoatNormalMap', 'clearcoatRoughnessMap', 'specularMap', 'sheenColorMap', 'transmissionMap'];
function disposeGroup(g) {
  g.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) o.skeleton.dispose();   // la textura de los huesos de cada persona animada
    if (o.geometry && !o.geometry.userData.keep) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      for (const k of TEX_SLOTS) { const t = m[k]; if (t && t.isTexture && !t.userData.keep) t.dispose(); }
      m.dispose();
    });
  });
  g.clear();
}
// Marca como compartidas (no se liberan al cambiar de circuito) las texturas y mallas de un modelo que se reutiliza
function keepModel(root) {
  root.traverse((o) => {
    if (o.geometry) o.geometry.userData.keep = true;
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { for (const k of TEX_SLOTS) if (m[k] && m[k].isTexture) m[k].userData.keep = true; });
  });
}

// Punto de la línea central interpolado en s (con vuelta)
function at(s, d = 0) {
  const P = T.pts, n = P.length;
  let u = (((s % T.L) + T.L) % T.L) / DS;
  const i = Math.floor(u) % n, f = u - Math.floor(u), j = (i + 1) % n;
  const a = P[i], b = P[j];
  let dh = b.h - a.h;
  dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI; // sin saltos al cerrar la vuelta
  const h = a.h + dh * f;
  const nx = -Math.sin(h), nz = Math.cos(h);
  return { x: lerp(a.x, b.x, f) + nx * d, z: lerp(a.z, b.z, f) + nz * d, y: lerp(a.y, b.y, f), h, k: a.k, slope: (b.y - a.y) / DS, i };
}

// Las texturas de la pista solo dependen del número de carriles: se generan una vez
const trackTexCache = new Map();
function buildTrack(def) {
  disposeGroup(trackGroup);
  const S = sample(def);
  const lanes = def.lanes;
  const half = (lanes * LANE_W) / 2 + 0.28;
  const offsets = laneOffsets(lanes);
  T = { def, pts: S.pts, L: S.length, half, lanes, offsets };
  const P = S.pts, n = P.length;
  const sc = SCENERY[def.scenery] || SCENERY.verde;

  // Caja que lo contiene
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const p of P) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z); }
  T.bbox = { minX: minX - half, maxX: maxX + half, minZ: minZ - half, maxZ: maxZ + half };
  // En los circuitos largos la cámara de TV sigue al coche en lugar de enseñar toda la mesa
  T.big = Math.max(maxX - minX, maxZ - minZ) > 30;
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  T.center = { x: cx, z: cz };
  trackGroup.position.set(-cx, 0, -cz);
  carsGroup.position.set(-cx, 0, -cz);
  // Circuitos de montaña: terreno que sostiene la pista cuando va en alto
  T.terrain = def.decor === 'montana' ? makeTerrain(P, half) : null;

  // Textura de la pista: asfalto de plástico, ranuras, raíles de cobre y bordes
  // Textura de la pista (alta resolución): una pieza recta estándar de 35 cm por repetición
  const PIECE = 0.35 / SCALE;
  const W = 1024, Ht = 2048;
  const U = (d, w) => ((half - d) / (2 * half)) * w;
  const tex = trackTexCache.get(lanes) || canvasTex(W, Ht, (g, w, h) => {
    g.fillStyle = '#36383e'; g.fillRect(0, 0, w, h);
    // Grano del plástico moldeado
    const img = g.getImageData(0, 0, w, h), px = img.data;
    for (let i = 0; i < px.length; i += 4) { const n = (Math.random() - 0.5) * 10; px[i] += n; px[i + 1] += n; px[i + 2] += n + 1; }
    g.putImageData(img, 0, 0);
    // Goma acumulada en la trazada de cada carril
    for (const d of offsets) {
      const u = U(d, w);
      const gr = g.createLinearGradient(u - w * 0.16, 0, u + w * 0.16, 0);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(0.3, 'rgba(10,10,12,0.28)'); gr.addColorStop(0.42, 'rgba(10,10,12,0.12)');
      gr.addColorStop(0.58, 'rgba(10,10,12,0.12)'); gr.addColorStop(0.7, 'rgba(10,10,12,0.28)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(u - w * 0.16, 0, w * 0.32, h);
    }
    // Líneas blancas de borde
    g.fillStyle = '#e9e9e4';
    g.fillRect(U(half - 0.05, w), 0, w * 0.01, h); g.fillRect(U(-half + 0.05, w) - w * 0.01, 0, w * 0.01, h);
    // Ranura (con fondo más oscuro y bordes en sombra)
    for (const d of offsets) {
      const u = U(d, w);
      g.fillStyle = '#060607'; g.fillRect(u - w * 0.008, 0, w * 0.016, h);
      g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(u - w * 0.011, 0, w * 0.003, h); g.fillRect(u + w * 0.008, 0, w * 0.003, h);
    }
    // Junta entre piezas y marcas de moldeo
    g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(0, 0, w, 3);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(0, 3, w, 2);
  });
  tex.repeat.set(1, 1);
  trackTexCache.set(lanes, tex);
  // Relieve del grano (mapa de normales generado)
  const nor = trackTexCache.get('nor') || canvasTex(256, 256, (g, w, h) => {
    const img = g.createImageData(w, h), px = img.data;
    const hgt = new Float32Array(w * h).map(() => Math.random());
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const dx = hgt[y * w + ((x + 1) % w)] - hgt[y * w + ((x - 1 + w) % w)];
      const dy = hgt[((y + 1) % h) * w + x] - hgt[((y - 1 + h) % h) * w + x];
      px[i * 4] = 128 + dx * 40; px[i * 4 + 1] = 128 + dy * 40; px[i * 4 + 2] = 255; px[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  nor.colorSpace = THREE.NoColorSpace;
  nor.repeat.set(6, 6);
  trackTexCache.set('nor', nor);
  // Filas de la malla: en los circuitos largos, una de cada 2 o 3 muestras (no se nota y pesa mucho menos)
  const ST = n > 6000 ? 3 : n > 3000 ? 2 : 1;
  const rows = [];
  for (let i = 0; i < n; i += ST) rows.push(i);
  rows.push(n);
  const nr = rows.length - 1;
  const pos = [], uv = [], idx = [];
  rows.forEach((i, r) => {
    const p = P[i % n];
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const v = (i * DS) / PIECE;
    pos.push(p.x + nx * half, p.y + 0.002, p.z + nz * half, p.x - nx * half, p.y + 0.002, p.z - nz * half);
    uv.push(0, v, 1, v);
    if (r < nr) { const a = r * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  });
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, normalMap: nor, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.68, side: THREE.DoubleSide }));
  road.receiveShadow = true;
  trackGroup.add(road);

  // Raíles de cobre (trencillas) a cada lado de cada ranura: metal de verdad que refleja
  const copperMat = new THREE.MeshStandardMaterial({ color: 0xc4c8cf, metalness: 1, roughness: 0.28 });
  const rp = [], ri = [];
  let rv = 0;
  for (const d of offsets) {
    for (const side of [-1, 1]) {
      const c0 = d + side * 0.045;
      rows.forEach((i, r) => {
        const p = P[i % n];
        const nx = -Math.sin(p.h), nz = Math.cos(p.h);
        rp.push(p.x + nx * (c0 - 0.012), p.y + 0.0045, p.z + nz * (c0 - 0.012), p.x + nx * (c0 + 0.012), p.y + 0.0045, p.z + nz * (c0 + 0.012));
        if (r < nr) ri.push(rv + r * 2, rv + r * 2 + 1, rv + r * 2 + 2, rv + r * 2 + 1, rv + r * 2 + 3, rv + r * 2 + 2);
      });
      rv += (nr + 1) * 2;
    }
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(rp, 3));
  rg.setIndex(ri);
  rg.computeVertexNormals();
  const rails = new THREE.Mesh(rg, copperMat);
  rails.receiveShadow = true;
  trackGroup.add(rails);

  // Faldones laterales (grosor de la pista)
  const sk = [], skIdx = [];
  rows.forEach((i, r) => {
    const p = P[i % n];
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const bottom = p.y > 0.05 ? p.y - 0.09 : -0.02;
    for (const sgn of [1, -1]) sk.push(p.x + nx * half * sgn, p.y + 0.002, p.z + nz * half * sgn, p.x + nx * half * sgn, bottom, p.z + nz * half * sgn);
    if (r < nr) { const a = r * 4; skIdx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4, a + 2, a + 3, a + 6, a + 3, a + 7, a + 6); }
  });
  const skGeo = new THREE.BufferGeometry();
  skGeo.setAttribute('position', new THREE.Float32BufferAttribute(sk, 3));
  skGeo.setIndex(skIdx);
  skGeo.computeVertexNormals();
  trackGroup.add(new THREE.Mesh(skGeo, new THREE.MeshStandardMaterial({ color: 0x24262c, roughness: 0.8, side: THREE.DoubleSide })));

  // Pianos rojos y blancos en las curvas
  const curbTex = canvasTex(64, 64, (g, w, h) => { g.fillStyle = '#e53935'; g.fillRect(0, 0, w, h); g.fillStyle = '#ffffff'; g.fillRect(0, h / 2, w, h / 2); });
  const cp = [], cuv = [], cidx = [];
  let vi = 0;
  for (const sgn of [1, -1]) {
    let run = false;
    for (let i = 0; i <= n; i++) {
      const p = P[i % n];
      const curve = Math.abs(p.k) > 0.01 && p.y < 0.05;
      if (curve) {
        const nx = -Math.sin(p.h), nz = Math.cos(p.h);
        const v = (i * DS) / 0.5;
        cp.push(p.x + nx * half * sgn, p.y + 0.004, p.z + nz * half * sgn, p.x + nx * (half + 0.2) * sgn, p.y + 0.004, p.z + nz * (half + 0.2) * sgn);
        cuv.push(0, v, 1, v);
        if (run) cidx.push(vi - 2, vi - 1, vi, vi - 1, vi + 1, vi);
        vi += 2;
      }
      run = curve;
    }
  }
  if (cp.length) {
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.Float32BufferAttribute(cuv, 2));
    cg.setIndex(cidx);
    cg.computeVertexNormals();
    const cm = new THREE.Mesh(cg, new THREE.MeshStandardMaterial({ map: curbTex, roughness: 0.6, side: THREE.DoubleSide }));
    cm.receiveShadow = true;
    trackGroup.add(cm);
  }

  // Puente: pilares y barandillas
  const clear = half + 0.32;   // pista + pianos + un margen
  const onLowerTrack = (x, z, y) => {
    for (let j = 0; j < n; j += 3) {
      const q = P[j];
      if (q.y > y - 0.3) continue;
      const dx = q.x - x, dz = q.z - z;
      if (dx * dx + dz * dz < clear * clear) return true;
    }
    return false;
  };
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd9d9de, roughness: 0.6 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.5 });
  const pillars = [];   // [x, z, alto]: se dibujan todos de una vez (instancias)
  for (let i = 0; i < n; i += Math.round(1.1 / DS)) {
    const p = P[i];
    if (p.y < 0.25) continue;
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    for (const sgn of [1, -1]) {
      const px = p.x + nx * (half - 0.1) * sgn, pz = p.z + nz * (half - 0.1) * sgn;
      // Si debajo pasa otro tramo de pista (con sus pianos), ahí no va pilar: el puente salva el hueco
      if (onLowerTrack(px, pz, p.y)) continue;
      if (T.terrain && T.terrain.h(px, pz) > p.y - 0.4) continue;   // ya lo sostiene la montaña
      pillars.push([px, pz, p.y - 0.09]);
    }
  }
  if (pillars.length) {
    const im = new THREE.InstancedMesh(new THREE.BoxGeometry(0.12, 1, 0.12), pillarMat, pillars.length);
    const m4 = new THREE.Matrix4();
    pillars.forEach(([x, z, hgt], k) => { m4.makeScale(1, hgt, 1).setPosition(x, hgt / 2, z); im.setMatrixAt(k, m4); });
    im.castShadow = true;
    trackGroup.add(im);
  }
  for (const sgn of [1, -1]) {
    let seg = [];
    const flush = () => {
      if (seg.length < 2) { seg = []; return; }
      const curve = new THREE.CatmullRomCurve3(seg);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, Math.max(2, seg.length), 0.025, 5, false), railMat);
      tube.castShadow = true;
      trackGroup.add(tube);
      seg = [];
    };
    for (let i = 0; i < n; i += 10) {
      const p = P[i];
      if (p.y > 0.12) {
        const nx = -Math.sin(p.h), nz = Math.cos(p.h);
        seg.push(new THREE.Vector3(p.x + nx * (half + 0.02) * sgn, p.y + 0.12, p.z + nz * (half + 0.02) * sgn));
      } else flush();
    }
    flush();
  }

  // Línea de salida a cuadros y pórtico con semáforo
  const p0 = P[0];
  const chk = canvasTex(64, 16, (g, w, h) => { for (let x = 0; x < 16; x++) for (let y = 0; y < 4; y++) { g.fillStyle = (x + y) % 2 ? '#111' : '#fff'; g.fillRect(x * 4, y * 4, 4, 4); } }, false);
  const line = new THREE.Mesh(new THREE.PlaneGeometry(0.22, half * 2), new THREE.MeshStandardMaterial({ map: chk, roughness: 0.6 }));
  line.rotation.x = -Math.PI / 2;
  line.rotation.z = -p0.h;
  line.position.set(p0.x, p0.y + 0.006, p0.z);
  line.receiveShadow = true;
  trackGroup.add(line);
  const gantry = new THREE.Group();
  const gm = new THREE.MeshStandardMaterial({ color: 0x2b2f3a, roughness: 0.5 });
  for (const sgn of [1, -1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.1, 1.3, 0.1), gm);
    post.position.set(0, 0.65, (half + 0.35) * sgn);
    post.castShadow = true;
    gantry.add(post);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.26, half * 2 + 0.8), gm);
  beam.position.set(0, 1.3, 0);
  beam.castShadow = true;
  gantry.add(beam);
  const lightsArr = [];
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.075, 16, 12), new THREE.MeshStandardMaterial({ color: 0x331111, emissive: 0x000000 }));
    m.position.set(0.09, 1.3, (i - 2) * 0.24);
    gantry.add(m);
    lightsArr.push(m);
  }
  const banner = canvasTex(512, 64, (g, w, h) => { g.fillStyle = '#ff3b30'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = 'italic 700 48px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TURBO SLOT', w / 2, h / 2 + 2); }, false);
  const bn = new THREE.Mesh(new THREE.PlaneGeometry(half * 2 + 0.8, 0.22), new THREE.MeshBasicMaterial({ map: banner }));
  bn.position.set(-0.085, 1.58, 0);
  bn.rotation.y = -Math.PI / 2;
  gantry.add(bn);
  const bn2 = bn.clone(); bn2.position.x = 0.085; bn2.rotation.y = Math.PI / 2; gantry.add(bn2);
  const bnBack = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.24, half * 2 + 0.8), new THREE.MeshStandardMaterial({ color: 0xff3b30 }));
  bnBack.position.set(0, 1.58, 0); gantry.add(bnBack);
  gantry.position.set(p0.x, p0.y, p0.z);
  gantry.rotation.y = -p0.h;
  trackGroup.add(gantry);
  T.lights = lightsArr;

  // Mesa
  const extra = def.decor ? 8 : 0;   // los circuitos con decorado llevan más mesa alrededor
  const tw = T.bbox.maxX - T.bbox.minX + 3.4 + extra, td = T.bbox.maxZ - T.bbox.minZ + 3.4 + extra;
  // Tapete de la mesa (hierba, tierra o tela) con relieve real, y madera en el marco
  const topCol = loadTex(sc.mat + '_color', true), topNor = loadTex(sc.mat + '_normal', false);
  const woodCol = loadTex('wood095_color', true), woodNor = loadTex('wood095_normal', false);
  const rep = Math.max(tw, td) / 3.2;
  const topMat = new THREE.MeshStandardMaterial({ map: topCol, normalMap: topNor, color: sc.tint, roughness: 0.95 });
  topCol.repeat.set(rep, rep * td / tw); topNor.repeat.copy(topCol.repeat);
  woodCol.repeat.set(4, 1); woodNor.repeat.set(4, 1);
  const sideMat = new THREE.MeshStandardMaterial({ map: woodCol, normalMap: woodNor, color: 0xc08a5e, roughness: 0.55 });
  const table = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.3, td), [sideMat, sideMat, topMat, new THREE.MeshStandardMaterial({ color: 0x5e3b22 }), sideMat, sideMat]);
  table.position.set(cx, -0.17, cz);
  table.receiveShadow = true;
  trackGroup.add(table);
  T.table = { tw, td, cx, cz };
  buildRoom(sideMat);
  if (def.decor) {
    let seed = 0;
    for (const ch of def.id) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
    const dg = new THREE.Group(); dg.name = 'decor';
    if (def.decor === 'montana' && T.terrain) buildMountain(dg, T.terrain, T.table, half, seed);
    if (def.decor === 'ciudad') buildCity(dg, P, half, T.table, seed, !!sc.night);
    trackGroup.add(dg);
  }
  const rimMat = new THREE.MeshStandardMaterial({ map: woodCol, normalMap: woodNor, color: 0xb07a4e, roughness: 0.45 });
  for (const [w2, d2, x2, z2] of [[tw + 0.3, 0.15, 0, td / 2 + 0.075], [tw + 0.3, 0.15, 0, -td / 2 - 0.075], [0.15, td, tw / 2 + 0.075, 0], [0.15, td, -tw / 2 - 0.075, 0]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w2, 0.38, d2), rimMat);
    r.position.set(cx + x2, -0.13, cz + z2);
    r.castShadow = true; r.receiveShadow = true;
    trackGroup.add(r);
  }

  // Vallas de protección: plástico blanco con postes, por fuera de las curvas
  {
    const wp = [], wi = [];
    let wv = 0;
    const fenceMat = new THREE.MeshStandardMaterial({ color: 0xeef0f2, roughness: 0.45, side: THREE.DoubleSide });
    const postGeo = new THREE.BoxGeometry(0.035, 0.26, 0.035);
    const posts = [];
    for (const sgn of [1, -1]) {
      let run = false;
      for (let i = 0; i <= n; i++) {
        const p = P[i % n];
        const outer = Math.abs(p.k) > 0.01 && Math.sign(p.k) === -sgn && p.y < 0.05;
        if (outer) {
          const nx = -Math.sin(p.h), nz = Math.cos(p.h), off = (half + 0.42) * sgn;
          wp.push(p.x + nx * off, 0.02, p.z + nz * off, p.x + nx * off, 0.24, p.z + nz * off);
          if (run) wi.push(wv - 2, wv - 1, wv, wv - 1, wv + 1, wv);
          wv += 2;
          if (i % Math.round(0.6 / DS) === 0) posts.push([p.x + nx * (off + 0.025 * sgn), p.z + nz * (off + 0.025 * sgn)]);
        }
        run = outer;
      }
    }
    if (wp.length) {
      const fg = new THREE.BufferGeometry();
      fg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3));
      fg.setIndex(wi); fg.computeVertexNormals();
      const fence = new THREE.Mesh(fg, fenceMat); fence.castShadow = true; fence.receiveShadow = true;
      trackGroup.add(fence);
      const pm = new THREE.InstancedMesh(postGeo, new THREE.MeshStandardMaterial({ color: 0x9aa0a8, metalness: 0.6, roughness: 0.35 }), posts.length);
      const m4 = new THREE.Matrix4();
      posts.forEach(([x, z], i) => { m4.makeTranslation(x, 0.13, z); pm.setMatrixAt(i, m4); });
      pm.castShadow = true;
      trackGroup.add(pm);
    }
  }

  // Decorado: neumáticos en las curvas, árboles y grada
  const tireGeo = new THREE.TorusGeometry(0.12, 0.05, 8, 16).rotateX(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.9 });
  const tireMat2 = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
  const tiresB = [], tiresW = [];   // pilas de neumáticos: se dibujan todas de una vez
  const occupied = (x, z, r) => {
    for (let i = 0; i < n; i += 4) if (Math.hypot(P[i].x - x, P[i].z - z) < half + r) return true;
    return false;
  };
  for (let i = 0; i < n; i += Math.round(0.9 / DS)) {
    const p = P[i];
    if (Math.abs(p.k) < 0.01 || p.y > 0.05) continue;
    const out = -Math.sign(p.k);
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const x = p.x + nx * (half + 0.72) * out, z = p.z + nz * (half + 0.72) * out;
    if (occupied(x, z, 0.4)) continue;
    for (let k = 0; k < 3; k++) (k === 1 ? tiresW : tiresB).push([x, 0.05 + k * 0.09, z]);
  }
  for (const [list, mat] of [[tiresB, tireMat], [tiresW, tireMat2]]) {
    if (!list.length) continue;
    const im = new THREE.InstancedMesh(tireGeo, mat, list.length);
    const m4 = new THREE.Matrix4();
    list.forEach(([x, y, z], k) => { m4.makeTranslation(x, y, z); im.setMatrixAt(k, m4); });
    im.castShadow = true;
    trackGroup.add(im);
  }
  const treeMat = new THREE.MeshStandardMaterial({ color: def.scenery === 'arena' ? 0x6f9a3a : 0x2f7d3f, flatShading: true, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4426 });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 0; k++) { // árboles desactivados: desentonaban con el aspecto realista
    const x = lerp(T.bbox.minX - 1.2, T.bbox.maxX + 1.2, rnd()), z = lerp(T.bbox.minZ - 1.2, T.bbox.maxZ + 1.2, rnd());
    if (occupied(x, z, 0.8)) continue;
    const tr = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.05, 0.25, 6), trunkMat); trunk.position.y = 0.12;
    const top = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 7), treeMat); top.position.y = 0.5;
    trunk.castShadow = top.castShadow = true;
    tr.add(trunk, top);
    tr.position.set(x, 0, z);
    tr.scale.setScalar(0.7 + rnd() * 0.6);
    trackGroup.add(tr);
  }
  // Grada junto a la recta de salida
  // Grada por fuera de la recta de salida (los circuitos giran a la izquierda: fuera es la derecha)
  const gx = p0.x + Math.sin(p0.h) * (half + 1.0), gz = p0.z - Math.cos(p0.h) * (half + 1.0);
  if (!occupied(gx, gz, 0.9)) {
    const stand = new THREE.Group();
    const colors = [0xff5252, 0xffd740, 0x40c4ff, 0x69f0ae];
    for (let r = 0; r < 3; r++) {
      const step = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.12 + r * 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0xbfc5d2 }));
      step.position.set(0, (0.12 + r * 0.12) / 2, r * 0.3);
      step.castShadow = true; step.receiveShadow = true;
      stand.add(step);

    }
    stand.position.set(gx, 0, gz);
    stand.rotation.y = -p0.h + Math.PI;
    trackGroup.add(stand);
  }

  // Luces y sombras
  const ext = Math.max(tw, td) / 2 + 1;
  sun.position.set(-ext * 0.6, ext * 1.4, ext * 0.8);
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: ext * 5 });
  sun.shadow.camera.updateProjectionMatrix();
  sun.intensity = 2.1 * sc.light;
  hemi.intensity = 0.55 * sc.light;
  setEnvironment(sc.hdri);
  document.documentElement.style.setProperty('--bg1', sc.bg[0]);
  document.documentElement.style.setProperty('--bg2', sc.bg[1]);
  fitCamera();
}


// ---------------------------------------------------------------------------
// Coche 1:32 en 3D
// ---------------------------------------------------------------------------
const CAR_SCALE = 1.85;     // el modelo mide ~0,14 m a escala real
const GUIDE_BACK = 0.395;   // distancia (unidades) del morro a la guía, ya escalada
const tireGeo = new THREE.CylinderGeometry(0.056, 0.056, 0.05, 20).rotateX(Math.PI / 2);
const rimGeo = new THREE.CylinderGeometry(0.036, 0.036, 0.052, 16).rotateX(Math.PI / 2);
const tireMat = new THREE.MeshStandardMaterial({ color: 0x121212, roughness: 0.85 });
const rimMat = new THREE.MeshStandardMaterial({ color: 0xc9ced6, metalness: 1, roughness: 0.25 });
const glassMat = new THREE.MeshPhysicalMaterial({ color: 0x0e1622, roughness: 0.05, metalness: 0.2, clearcoat: 1 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.4 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff0000, emissiveIntensity: 0.9 });
const darkMat = new THREE.MeshStandardMaterial({ color: 0x15171c, roughness: 0.6 });

function numberTex(num, accent, base) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#' + base.toString(16).padStart(6, '0'); g.fillRect(0, 0, 128, 128);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(64, 64, 52, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#' + accent.toString(16).padStart(6, '0'); g.lineWidth = 8; g.stroke();
  g.fillStyle = '#111'; g.font = '700 70px "Barlow Condensed", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const blobTex = (() => {
  const c = document.createElement('canvas'); c.width = 128; c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(64, 32, 4, 64, 32, 60);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.save(); g.scale(1, 0.5); g.fillStyle = gr; g.beginPath(); g.arc(64, 64, 60, 0, Math.PI * 2); g.fill(); g.restore();
  return new THREE.CanvasTexture(c);
})();
// ---------------------------------------------------------------------------
// Coches: catálogo de la tienda y modelos 3D (todos inventados, sin marcas reales)
// Todos corren igual: la física no cambia de un coche a otro (gana el reglaje y el piloto).
// ---------------------------------------------------------------------------
export const CARS = [
  { id: 'gt22', name: 'GT 22', type: 'Superdeportivo de carreras', credit: '«Fantastic Race Car 22 Gold» de YDEVASHISH' },
  { id: 'abyss', name: 'Abyss GT7', type: 'Hiperdeportivo de carreras', credit: '«Tokii Abyss GT.7 V12» de Glas\'kavin' },
  { id: 'goblin', name: 'Goblin V12', type: 'Superdeportivo', credit: '«Fictional supercar - V12 Goblin» de ollitei' },
  { id: 'cheetah', name: 'Cheetah', type: 'Superdeportivo con alerón', credit: '«Generic Supercar "Cheetah"» de mk2design' },
  { id: 'f1', name: 'Monoplaza 22', type: 'Monoplaza de fórmula', credit: '«F1 Generic 2022» de TheoDev (sin logotipos)' },
];
export const DEFAULT_CAR = 'gt22';
// Coche guardado de un jugador (los antiguos, ya retirados, pasan al de por defecto)
const validCar = (id) => (CARS.some((c) => c.id === id) ? id : DEFAULT_CAR);
const savedCar = (player = 0) => validCar(store.get(`car${player}`, DEFAULT_CAR));
const carById = (id) => CARS.find((c) => c.id === id) || CARS[0];
const CAR_LEN = 0.98;       // longitud del coche en unidades (≈ 12,5 cm; ≈ 6 cm de ancho)
const NOSE_AHEAD = 0.16;    // la guía va 2 cm por detrás del morro
const carModels = {};       // id → { hi, lo } ya orientados y escalados
const carLoading = {};      // id → promesa
function prepareModel(scene) {
  keepModel(scene);
  const box = new THREE.Box3().setFromObject(scene);
  const c = box.getCenter(new THREE.Vector3());
  // Todos los modelos vienen con el morro hacia +z (adivinarlo por los faros fallaba con el
  // Turismo, que tiene material de faro delante y detrás y salía al revés)
  const hc = new THREE.Vector3(0, 0, 1);
  const pivot = new THREE.Group();
  const inner = new THREE.Group();
  inner.add(scene);
  if (Math.abs(hc.z) > Math.abs(hc.x)) inner.rotation.y = hc.z > 0 ? Math.PI / 2 : -Math.PI / 2;
  else if (hc.x < 0) inner.rotation.y = Math.PI;
  pivot.add(inner);
  pivot.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(pivot);
  const size = b2.getSize(new THREE.Vector3());
  const k = CAR_LEN / size.x;
  inner.scale.setScalar(k);
  pivot.updateMatrixWorld(true);
  const b3 = new THREE.Box3().setFromObject(pivot);
  const c3 = b3.getCenter(new THREE.Vector3());
  inner.position.set(-(b3.max.x - NOSE_AHEAD), -b3.min.y + 0.004, -c3.z);
  const wheels = [];
  scene.traverse((o) => {
    if (o.isMesh) { o.castShadow = false; o.receiveShadow = true; }
    if (/^Wheel(Front|Rear)[LR]$/.test(o.name)) wheels.push(o.name);
  });
  return { pivot, wheels };
}
const gltfLoader = new GLTFLoader();
// Si el servidor no sirve .glb (por ejemplo, dentro de Claude), se usa la copia en texto base64
function fetchGltf(f) {
  const fromText = () => fetch(`assets/models/${f}.txt`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('sin modelo')))).then((b64) => {
    const bin = atob(b64.trim());
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Promise((res, rej) => gltfLoader.parse(buf.buffer, 'assets/models/', res, rej));
  });
  return new Promise((res, rej) => gltfLoader.load(`assets/models/${f}`, res, undefined, rej)).catch(fromText);
}

// ---- Público alrededor de la mesa (personajes de Quaternius, CC0) ----
// Escala real: 1 unidad = 12,6 cm. Una persona mide ~1,75 m (14 unidades) y la mesa está a 80 cm del suelo.
const FLOOR_Y = -0.02 - 0.8 / 0.126;
const PEOPLE_FILES = ['people_m1', 'people_f1', 'people_m2', 'people_f2'];
let peopleSrc = null, peopleLoading = null;
let crowd = [];   // { root, mixer, yaw0, yaw }
function loadPeople() {
  if (!peopleLoading) {
    peopleLoading = Promise.all(PEOPLE_FILES.map((f) => fetchGltf(`${f}.glb`))).then((gs) => {
      peopleSrc = gs.map((g) => {
        g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.receiveShadow = false; o.frustumCulled = false; } });
        keepModel(g.scene);
        const box = new THREE.Box3().setFromObject(g.scene);
        return { scene: g.scene, clip: g.animations.find((a) => a.name === 'Idle') || g.animations[0], h: box.max.y - box.min.y };
      });
    }).catch(() => { peopleLoading = null; });
  }
  return peopleLoading;
}
const PAL = {
  Shirt: ['#1f3b73', '#c62828', '#eeeeee', '#2e7d32', '#262626', '#f9a825', '#6a1b9a', '#00838f', '#ef6c00', '#546e7a', '#ad1457', '#3949ab'],
  Vest: ['#263238', '#37474f', '#1a237e', '#4e342e', '#b71c1c', '#33691e'],
  Pants: ['#2b3f5c', '#1c1c1c', '#5d4e37', '#6d6d6d', '#3e4a61', '#b8a77a', '#283593'],
  Hair: ['#1b1b1b', '#3b2416', '#6b4423', '#c9a25a', '#8d8d8d', '#a0522d', '#2a1a10'],
  Skin: ['#f1c27d', '#e0ac69', '#c68642', '#8d5524', '#ffdbac', '#d9a06b', '#b5835a'],
  Hat: ['#c62828', '#1f3b73', '#262626', '#f9a825', '#eeeeee'],
};
const pickc = (l, r) => l[Math.floor(r() * l.length)];
function makePerson(src, r) {
  const root = SkeletonUtils.clone(src.scene);
  const hideHat = r() < 0.65;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
      const c = m.clone();
      const pal = PAL[m.name];
      if (pal) c.color.set(pickc(pal, r));
      if (m.name === 'Hat' && hideHat) c.visible = false;
      c.roughness = 0.85; c.metalness = 0;
      return c;
    });
    o.material = Array.isArray(o.material) ? mats : mats[0];
  });
  const k = (13.2 + r() * 1.6) / src.h;
  root.scale.setScalar(k);
  const mixer = new THREE.AnimationMixer(root);
  if (src.clip) { const a = mixer.clipAction(src.clip); a.play(); a.time = r() * src.clip.duration; a.timeScale = 0.85 + r() * 0.3; }
  return { root, mixer };
}
// Coloca a la gente alrededor de la mesa: de pie, mirando hacia la pista, con huecos al azar
function placeCrowd() {
  if (!T || !T.table || !peopleSrc) return;
  for (const p of crowd) { p.root.removeFromParent(); p.mixer.stopAllAction(); disposeGroup(p.root); }
  crowd = [];
  const { tw, td, cx, cz } = T.table;
  let seed = 0;
  for (const ch of String(T.def.id || 'x')) seed = (seed * 31 + ch.charCodeAt(0)) >>> 0;
  const r = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  // En el móvil (pantalla táctil) menos gente: cada persona son 6 dibujos con su esqueleto animado
  const touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  const max = quality >= 2 ? 5 : quality === 1 ? (touch ? 7 : 12) : (touch ? 12 : 22);
  const gap = 3.6;   // del borde de la mesa al centro de la persona (~45 cm)
  const spots = [];
  // [inicio x, inicio z, dirección x, dirección z, largo, normal hacia la mesa x, z]
  const sides = [
    [cx - tw / 2, cz - td / 2 - gap, 1, 0, tw, 0, 1], [cx - tw / 2, cz + td / 2 + gap, 1, 0, tw, 0, -1],
    [cx - tw / 2 - gap, cz - td / 2, 0, 1, td, 1, 0], [cx + tw / 2 + gap, cz - td / 2, 0, 1, td, -1, 0],
  ];
  for (const [x0, z0, dx, dz, len, nx, nz] of sides) {
    for (let t = 2 + r() * 4; t < len - 2; t += 6.5 + r() * 6) {
      if (r() < 0.3) continue;
      spots.push({ x: x0 + dx * t + nx * (r() - 0.5) * 1.2, z: z0 + dz * t + nz * (r() - 0.5) * 1.2, nx, nz });
    }
  }
  for (let i = spots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [spots[i], spots[j]] = [spots[j], spots[i]]; }
  const grp = new THREE.Group(); grp.name = 'crowd';
  for (const sp of spots.slice(0, max)) {
    const src = peopleSrc[Math.floor(r() * peopleSrc.length)];
    const p = makePerson(src, r);
    const yaw0 = Math.atan2(sp.nx, sp.nz) + (r() - 0.5) * 0.5;
    p.root.position.set(sp.x, FLOOR_Y, sp.z);
    p.root.rotation.y = yaw0;
    p.yaw0 = yaw0; p.yaw = yaw0;
    grp.add(p.root);
    crowd.push(p);
  }
  trackGroup.add(grp);
}
// ---- La sala del club: suelo, paredes, ventanas, pósteres, estanterías y luces ----
// A propósito en baja resolución (texturas pequeñas, pocas piezas): es el fondo, detrás del público.
const ROOM_H = 3.0 / 0.126;          // 3 m de techo
const roomTex = {};
function roomCanvas(key, w, h, draw) {
  if (!roomTex[key]) {
    const t = canvasTex(w, h, draw, false);
    t.userData.keep = true; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 1;
    t.minFilter = THREE.LinearFilter; t.generateMipmaps = false;
    roomTex[key] = t;
  }
  return roomTex[key];
}
function wallTex() {
  return roomCanvas('wall', 256, 128, (g, w, h) => {
    g.fillStyle = '#b9b2a6'; g.fillRect(0, 0, w, h);                       // pintura
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(0,0,0,${Math.random() * 0.04})`; g.fillRect(Math.random() * w, Math.random() * h, 3, 3); }
    const zy = h * 0.66;                                                    // zócalo de madera (1 m)
    g.fillStyle = '#6d4a2f'; g.fillRect(0, zy, w, h - zy);
    for (let x = 0; x < w; x += 32) { g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x, zy, 2, h - zy); }
    g.fillStyle = '#4e331f'; g.fillRect(0, zy - 4, w, 5);                   // moldura
    g.fillStyle = '#2b2b2b'; g.fillRect(0, h - 6, w, 6);                    // rodapié
  });
}
const POSTERS = [
  ['#c62828', '#ffcc00', 'GRAN PREMIO', '1:32', 'car'],
  ['#1f3b73', '#ffffff', 'SLOT CLUB', 'DESDE 1985', 'flag'],
  ['#1b1b1b', '#ffcc00', 'RESISTENCIA', '24 HORAS', 'car'],
  ['#2e7d32', '#ffffff', 'CAMPEONATO', 'REGIONAL', 'cup'],
  ['#ef6c00', '#1b1b1b', 'TURBO SLOT', 'CARRERAS', 'flag'],
];
function posterTex(i) {
  const [bg, fg, t1, t2, art] = POSTERS[i % POSTERS.length];
  return roomCanvas('poster' + i, 96, 128, (g, w, h) => {
    g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.fillStyle = fg; g.font = 'bold 14px sans-serif'; g.textAlign = 'center';
    g.fillText(t1, w / 2, 22); g.font = 'bold 11px sans-serif'; g.fillText(t2, w / 2, h - 12);
    if (art === 'car') {        // silueta de coche de carreras
      g.beginPath(); g.moveTo(14, 82); g.lineTo(26, 66); g.lineTo(58, 62); g.lineTo(74, 70); g.lineTo(84, 82); g.closePath(); g.fill();
      g.fillStyle = '#111'; g.beginPath(); g.arc(30, 84, 7, 0, 7); g.arc(70, 84, 7, 0, 7); g.fill();
    } else if (art === 'flag') { // bandera a cuadros
      for (let y = 0; y < 5; y++) for (let x = 0; x < 6; x++) { g.fillStyle = (x + y) % 2 ? fg : '#111'; g.fillRect(18 + x * 10, 40 + y * 10, 10, 10); }
    } else {                     // copa
      g.fillStyle = '#e6b422'; g.beginPath(); g.moveTo(30, 40); g.lineTo(66, 40); g.lineTo(60, 70); g.lineTo(36, 70); g.closePath(); g.fill(); g.fillRect(44, 70, 8, 14); g.fillRect(34, 84, 28, 6);
    }
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 3; g.strokeRect(2, 2, w - 4, h - 4);
  });
}
function windowTex() {
  return roomCanvas('window', 128, 96, (g, w, h) => {
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#cfe6ff'); grd.addColorStop(0.7, '#e9f3ff'); grd.addColorStop(1, '#9fb68a');
    g.fillStyle = grd; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7f9a6a'; g.beginPath(); g.moveTo(0, 70); g.quadraticCurveTo(40, 52, 80, 66); g.quadraticCurveTo(110, 58, 128, 64); g.lineTo(128, 96); g.lineTo(0, 96); g.fill();
    g.fillStyle = '#f2f2f2'; g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6); g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h); g.fillRect(w / 2 - 3, 0, 6, h); g.fillRect(0, h / 2 - 3, w, 6);
  });
}
function doorTex() {
  return roomCanvas('door', 64, 128, (g, w, h) => {
    g.fillStyle = '#5a3b24'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#3f2817'; g.lineWidth = 4; g.strokeRect(10, 10, w - 20, h * 0.4); g.strokeRect(10, h * 0.5, w - 20, h * 0.42);
    g.fillStyle = '#d9b44a'; g.beginPath(); g.arc(w - 12, h * 0.52, 3, 0, 7); g.fill();
    g.fillStyle = '#1b5e20'; g.fillRect(16, 2, w - 32, 7); g.fillStyle = '#fff'; g.font = 'bold 6px sans-serif'; g.textAlign = 'center'; g.fillText('SALIDA', w / 2, 8);
  });
}
// Junta en una sola malla todas las piezas fijas que comparten material (menos llamadas de dibujo:
// en el móvil es lo que más cuesta). Las piezas con el mismo aspecto se juntan aunque tengan materiales distintos.
function mergeStatic(group) {
  group.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(group.matrixWorld).invert();
  const m = new THREE.Matrix4();
  const buckets = new Map();
  const sig = (mt) => [mt.type, mt.color && mt.color.getHex(), mt.map && mt.map.uuid, mt.emissive && mt.emissive.getHex(), mt.emissiveMap && mt.emissiveMap.uuid, mt.emissiveIntensity, mt.roughness, mt.metalness, mt.transparent, mt.opacity].join('|');
  const olds = [];
  group.traverse((o) => {
    if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) return;
    let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(name)) g.deleteAttribute(name);
    if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
    g.applyMatrix4(m.multiplyMatrices(inv, o.matrixWorld));
    const key = sig(o.material);
    if (!buckets.has(key)) buckets.set(key, { mat: o.material, geos: [], cast: false });
    const b = buckets.get(key); b.geos.push(g); b.cast = b.cast || o.castShadow;
    olds.push(o);
  });
  for (const o of olds) { o.geometry.dispose(); }
  group.clear();
  for (const b of buckets.values()) {
    const merged = mergeGeometries(b.geos);
    b.geos.forEach((g) => g.dispose());
    if (!merged) continue;
    const mesh = new THREE.Mesh(merged, b.mat);
    mesh.castShadow = b.cast; mesh.receiveShadow = true;
    group.add(mesh);
  }
}
function buildRoom(woodMat) {
  const { tw, td, cx, cz } = T.table;
  const M = 30;                                     // ~3,8 m de sala alrededor de la mesa
  const W = tw + 2 * M, D = td + 2 * M;
  let seed = 7;
  for (const ch of String(T.def.id || 'x')) seed = (seed * 33 + ch.charCodeAt(0)) >>> 0;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
  const room = new THREE.Group(); room.name = 'room';
  // Suelo de tarima
  const floorCol = loadTex('wood095_color', true).clone();   // copia: la textura de la mesa no se toca
  floorCol.userData = {};
  floorCol.repeat.set(W / 10, D / 10);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ map: floorCol, color: 0x6b5a4a, roughness: 0.8 }));
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(cx, FLOOR_Y, cz);
  room.add(floor);
  // Paredes (solo se ven por dentro: desde fuera, la cámara ve a través, como en una maqueta)
  const wt = wallTex();
  const walls = [
    [W, cx, cz - D / 2, 0], [W, cx, cz + D / 2, Math.PI], [D, cx - W / 2, cz, Math.PI / 2], [D, cx + W / 2, cz, -Math.PI / 2],
  ];
  const deco = (tex, w, h, emissive = 0) => new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.9, emissive: emissive ? 0xffffff : 0x000000, emissiveMap: emissive ? tex : null, emissiveIntensity: emissive }));
  let doorDone = false;
  walls.forEach(([len, x, z, ry], wi) => {
    const t = wt.clone(); t.userData = {}; t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 20, 1); t.needsUpdate = true;
    const wall = new THREE.Mesh(new THREE.PlaneGeometry(len, ROOM_H), new THREE.MeshStandardMaterial({ map: t, roughness: 0.95 }));
    wall.position.set(x, FLOOR_Y + ROOM_H / 2, z); wall.rotation.y = ry;
    room.add(wall);
    // Cosas colgadas en la pared, cada 9–14 unidades
    const dirX = Math.cos(ry), dirZ = -Math.sin(ry);       // a lo largo de la pared
    const inX = Math.sin(ry), inZ = Math.cos(ry);          // hacia dentro de la sala
    for (let u = -len / 2 + 8; u < len / 2 - 8; u += 9 + rnd() * 6) {
      const r = rnd();
      let m, y;
      if (!doorDone && wi === 1 && u > -len / 4) { m = deco(doorTex(), 7.5, 16.5); y = FLOOR_Y + 8.25; doorDone = true; }
      else if (r < 0.35) { m = deco(windowTex(), 12, 8.5, 0.55); y = FLOOR_Y + 14.5; }
      else if (r < 0.75) { m = deco(posterTex(Math.floor(rnd() * 5)), 5.5, 7.4); y = FLOOR_Y + 14 + rnd() * 2; }
      else {
        // Estantería con trofeos y cajas
        m = new THREE.Group(); y = FLOOR_Y + 12;
        const shelf = new THREE.Mesh(new THREE.BoxGeometry(10, 0.4, 2), woodMat); m.add(shelf);
        for (let k = 0; k < 4; k++) {
          const gold = rnd() < 0.5;
          const item = gold ? new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.25, 1.8, 8), new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 }))
            : new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 1.4), new THREE.MeshStandardMaterial({ color: pickc(['#c62828', '#1f3b73', '#f9a825', '#2e7d32', '#eeeeee'], rnd), roughness: 0.8 }));
          item.position.set(-3.6 + k * 2.4, gold ? 1.1 : 0.9, 0); m.add(item);
        }
      }
      m.position.set(x + dirX * u + inX * 0.08 + (m.isGroup ? inX * 1 : 0), y, z + dirZ * u + inZ * 0.08 + (m.isGroup ? inZ * 1 : 0));
      m.rotation.y = ry;
      room.add(m);
    }
  });
  // Techo con pantallas de luz
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(W, D), new THREE.MeshStandardMaterial({ color: 0xd8d6d0, roughness: 1 }));
  ceil.rotation.x = Math.PI / 2; ceil.position.set(cx, FLOOR_Y + ROOM_H, cz);
  room.add(ceil);
  const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff6e0 });
  for (let x = -W / 2 + 14; x < W / 2 - 6; x += 22) for (let zz = -D / 2 + 14; zz < D / 2 - 6; zz += 22) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(8, 2.4), lampMat);
    l.rotation.x = Math.PI / 2; l.position.set(cx + x, FLOOR_Y + ROOM_H - 0.05, cz + zz);
    room.add(l);
  }
  // Otra mesa de slot al fondo (tapada) y unas sillas, para que la sala tenga vida
  const far = new THREE.Group();
  const top2 = new THREE.Mesh(new THREE.BoxGeometry(22, 0.4, 12), new THREE.MeshStandardMaterial({ color: 0x2f5a3a, roughness: 1 }));
  top2.position.y = -0.2; far.add(top2);
  const cover = new THREE.Mesh(new THREE.BoxGeometry(22.4, 0.9, 12.4), new THREE.MeshStandardMaterial({ color: 0x8a8f99, roughness: 1, transparent: true, opacity: 0.85 }));
  cover.position.y = 0.3; far.add(cover);
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.6, -FLOOR_Y, 0.6), woodMat); leg.position.set(sx * 10.4, FLOOR_Y / 2 - 0.2, sz * 5.4); far.add(leg);
  }
  far.position.set(cx + (rnd() < 0.5 ? -1 : 1) * (W / 2 - 13), 0, cz - D / 2 + 9);
  room.add(far);
  const chairMat = new THREE.MeshStandardMaterial({ color: 0x37474f, roughness: 0.7 });
  for (let k = 0; k < 4; k++) {
    const ch = new THREE.Group();
    const seat = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.4, 3.6), chairMat); seat.position.y = 3.6; ch.add(seat);
    const back = new THREE.Mesh(new THREE.BoxGeometry(3.6, 4, 0.4), chairMat); back.position.set(0, 5.6, -1.6); ch.add(back);
    for (const [a, b] of [[-1.5, -1.5], [1.5, -1.5], [-1.5, 1.5], [1.5, 1.5]]) { const lg = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.6, 0.3), chairMat); lg.position.set(a, 1.8, b); ch.add(lg); }
    const side = k % 2 ? 1 : -1;
    ch.position.set(cx + side * (W / 2 - 4), FLOOR_Y, cz + (rnd() - 0.5) * D * 0.6);
    ch.rotation.y = side * Math.PI / 2;
    room.add(ch);
  }
  mergeStatic(room);
  trackGroup.add(room);
  // Patas de la mesa
  const legH = -0.32 - FLOOR_Y;
  for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.7, legH, 0.7), woodMat);
    leg.position.set(cx + sx * (tw / 2 - 0.8), FLOOR_Y + legH / 2, cz + sz * (td / 2 - 0.8));
    trackGroup.add(leg);
  }
  crowd = [];
  const myT = T;
  if (peopleSrc) placeCrowd(); else loadPeople().then(() => { if (T === myT) placeCrowd(); });
}
// Cada fotograma: respiran (animación) y giran un poco el cuerpo siguiendo al coche que va delante.
// Quien se pone entre la cámara y la pista se oculta para no tapar la carrera.
const _pv = new THREE.Vector3();
function updateCrowd(dt) {
  if (!crowd.length) return;
  const lead = cars.length ? cars.reduce((a, c) => ((c.lap * 1e4 + c.st.s) > (a.lap * 1e4 + a.st.s) ? c : a), cars[0]) : null;
  const camDist = camera.position.distanceTo(camTarget);
  for (const p of crowd) {
    p.mixer.update(dt);
    if (lead && !lead.crash) {
      const lp = lead.mesh.position;
      let want = Math.atan2(lp.x - p.root.position.x, lp.z - p.root.position.z);
      let d = want - p.yaw0; d -= Math.round(d / (2 * Math.PI)) * 2 * Math.PI;
      d = clamp(d, -0.75, 0.75);
      let cur = p.yaw - p.yaw0; cur -= Math.round(cur / (2 * Math.PI)) * 2 * Math.PI;
      p.yaw = p.yaw0 + cur + (d - cur) * Math.min(1, dt * 1.5);
      p.root.rotation.y = p.yaw;
    }
    // ¿Tapa la vista? (está más cerca de la cámara que lo que se mira y dentro del encuadre)
    p.root.getWorldPosition(_pv); _pv.y += 9;
    const dc = camera.position.distanceTo(_pv);
    _pv.project(camera);
    const inView = Math.abs(_pv.x) < 1.15 && _pv.y > -1.2 && _pv.y < 1.2 && _pv.z < 1;
    p.root.visible = !(inView && dc < camDist * 0.92);
  }
}

function fetchModel(f) {
  const fromText = () => fetch(`assets/models/${f}.txt`).then((r) => (r.ok ? r.text() : Promise.reject(new Error('sin modelo')))).then((b64) => {
    const bin = atob(b64.trim());
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Promise((res, rej) => gltfLoader.parse(buf.buffer, 'assets/models/', (g) => res(g.scene), rej));
  });
  return new Promise((res, rej) => gltfLoader.load(`assets/models/${f}`, (g) => res(g.scene), undefined, rej)).catch(fromText);
}
// Carga un coche (una sola vez) y cambia los que ya estén en pantalla por el modelo de verdad
function loadCar(id) {
  if (carLoading[id]) return carLoading[id];
  carLoading[id] = Promise.all([fetchModel(`car_${id}_hi.glb`), fetchModel(`car_${id}_lo.glb`)]).then(([hi, lo]) => {
    carModels[id] = { hi: prepareModel(hi), lo: prepareModel(lo) };
    for (const c of cars) {
      if ((c.carId || DEFAULT_CAR) !== id) continue;
      const old = c.mesh;
      c.mesh = makeCarMesh(c.liv, false, id);
      c.mesh.position.copy(old.position); c.mesh.rotation.copy(old.rotation);
      if (c.human) { c.mesh.userData.ring.material.opacity = 0.7; c.mesh.userData.halo = makeHalo(); c.mesh.add(c.mesh.userData.halo); }
      carsGroup.remove(old); carsGroup.add(c.mesh);
    }
    if (ghost && ghost.carId === id) { const old = ghost.mesh; ghost.mesh = makeCarMesh(old.userData.liv, true, id); carsGroup.remove(old); carsGroup.add(ghost.mesh); }
  }).catch(() => { delete carLoading[id]; });
  return carLoading[id];
}
function loadCarModels() { return loadCar(savedCar(0)); }
function paintModel(src, liv, ghost, car) {
  const m = src.pivot.clone(true);
  const cache = new Map();
  const ghostMat = new THREE.MeshBasicMaterial({ color: ghost === 'gold' ? 0xffcc33 : 0x9fe3ff, transparent: true, opacity: ghost === 'gold' ? 0.42 : 0.28, depthWrite: false });
  const tintCol = new THREE.Color(0xffffff).lerp(new THREE.Color(liv.color), 0.8);
  m.traverse((o) => {
    if (!o.isMesh) return;
    if (ghost) { o.material = ghostMat; o.castShadow = false; return; }
    const name = o.material.name || '';
    if (car.tint) {
      // Coche con una sola textura: se tiñe entero del color de la decoración
      if (!cache.has(name)) { const mat = o.material.clone(); mat.color = tintCol.clone(); cache.set(name, mat); }
      o.material = cache.get(name);
      return;
    }
    let col = null;
    if (/^Paint 1/.test(name) || /^Paint 2/.test(name)) col = liv.color;
    else if (/^Interior 3/.test(name)) col = liv.accent;
    if (col !== null) {
      if (!cache.has(name)) {
        const mat = o.material.clone();
        mat.color = new THREE.Color(col);
        if (/^Paint/.test(name)) {
          // Barniz de coche: la propiedad clearcoat solo existe en MeshPhysicalMaterial
          const phys = mat.isMeshPhysicalMaterial ? mat : Object.assign(new THREE.MeshPhysicalMaterial(), { color: mat.color, map: mat.map || null, normalMap: mat.normalMap || null, name: mat.name });
          phys.clearcoat = 1; phys.clearcoatRoughness = 0.04; phys.metalness = Math.min(mat.metalness ?? 0.5, 0.6); phys.roughness = Math.min(mat.roughness ?? 0.3, 0.3);
          cache.set(name, phys);
        } else cache.set(name, mat);
      }
      o.material = cache.get(name);
    }
  });
  const wheels = [];
  m.traverse((o) => { if (src.wheels.includes(o.name)) wheels.push(o); });
  m.userData.wheels = wheels;
  return m;
}
function makeCarMesh(liv, ghost = false, carId = DEFAULT_CAR) {
  const model = carModels[carId];
  if (!model) loadCar(carId);
  if (model) {
    const car = carById(carId);
    const root = new THREE.Group();
    root.userData.liv = liv;
    root.userData.carId = carId;
    const lod = new THREE.LOD();
    const hi = paintModel(model.hi, liv, ghost, car), lo = paintModel(model.lo, liv, ghost, car);
    lod.addLevel(hi, 0); lod.addLevel(lo, 7);
    root.add(lod);
    if (!ghost) {
      // La sombra la proyecta la versión ligera (invisible): misma silueta, mucho menos coste
      const shadowProxy = model.lo.pivot.clone(true);
      const inv = new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false });
      shadowProxy.traverse((o) => { if (o.isMesh) { o.material = inv; o.castShadow = true; o.receiveShadow = false; } });
      root.add(shadowProxy);
    }
    root.userData.wheels = [...hi.userData.wheels, ...lo.userData.wheels];
    if (!ghost) {
      const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 0.62), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.7 }));
      blob.rotation.x = -Math.PI / 2; blob.position.set(-CAR_LEN / 2 + NOSE_AHEAD, 0.007, 0);
      root.add(blob);
      // Guía de slot bajo el morro
      const guide = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.012), darkMat);
      guide.position.set(0, -0.012, 0); root.add(guide);
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.54, 40), new THREE.MeshBasicMaterial({ color: liv.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
      ring.rotation.x = -Math.PI / 2; ring.position.set(-CAR_LEN / 2 + NOSE_AHEAD, 0.012, 0);
      root.add(ring);
      root.userData.ring = ring;
    }
    return root;
  }
  const simple = makeCarMeshSimple(liv, ghost);
  simple.userData.carId = carId;
  return simple;
}
function makeCarMeshSimple(liv, ghost = false) {
  const root = new THREE.Group();
  const g = new THREE.Group();
  const paint = ghost
    ? new THREE.MeshBasicMaterial({ color: 0x9fe3ff, transparent: true, opacity: 0.32, depthWrite: false })
    : new THREE.MeshPhysicalMaterial({ color: liv.color, metalness: 0.35, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.06 });
  const acc = ghost ? paint : new THREE.MeshPhysicalMaterial({ color: liv.accent, roughness: 0.35, clearcoat: 0.8 });
  // Carrocería: perfil lateral extruido y estrechado en morro y cola
  const sh = new THREE.Shape();
  sh.moveTo(-0.3, 0.028); sh.lineTo(0.3, 0.028); sh.quadraticCurveTo(0.312, 0.05, 0.27, 0.062);
  sh.lineTo(0.14, 0.08); sh.quadraticCurveTo(0.07, 0.135, -0.03, 0.14); sh.lineTo(-0.15, 0.135);
  sh.quadraticCurveTo(-0.26, 0.122, -0.3, 0.1); sh.closePath();
  const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.25, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 3, curveSegments: 10 });
  geo.translate(0, 0, -0.125);
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i);
    // Morro afilado, cola recogida y techo estrecho (sección en "botella", como un GT real)
    const nose = THREE.MathUtils.smoothstep(x, 0.08, 0.32) * 0.28;
    const tail = THREE.MathUtils.smoothstep(-x, 0.16, 0.32) * 0.14;
    const top = THREE.MathUtils.smoothstep(y, 0.06, 0.15) * 0.42;
    const waist = Math.exp(-((x + 0.02) ** 2) / 0.006) * THREE.MathUtils.smoothstep(y, 0.04, 0.09) * 0.08;
    pos.setZ(i, pos.getZ(i) * (1 - nose - tail - top - waist));
  }
  geo.computeVertexNormals();
  const body = new THREE.Mesh(geo, paint);
  body.castShadow = !ghost;
  g.add(body);
  if (!ghost) {
    const cab = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glassMat);
    cab.scale.set(1.05, 0.38, 0.5); cab.position.set(-0.04, 0.12, 0); g.add(cab);
    const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.026, 12, 10), acc); helmet.position.set(-0.05, 0.15, 0); g.add(helmet);
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.004, 0.04), acc); stripe.position.set(0.17, 0.088, 0); stripe.rotation.z = -0.12; g.add(stripe);
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.007, 0.22), acc); wing.position.set(-0.272, 0.152, 0); wing.castShadow = true; g.add(wing);
    for (const z of [-0.075, 0.075]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.04, 0.008), darkMat); st.position.set(-0.268, 0.13, z); g.add(st); }
    // Difusor y entradas de aire
    const diff = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.025, 0.2), darkMat); diff.position.set(-0.3, 0.045, 0); g.add(diff);
    for (const z of [-0.09, 0.09]) { const sk = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.03, 0.006), darkMat); sk.position.set(-0.08, 0.06, z * 1.38); g.add(sk); }
    const ntex = numberTex(liv.num, liv.accent, liv.color);
    for (const z of [0.126, -0.126]) {
      const dec = new THREE.Mesh(new THREE.PlaneGeometry(0.075, 0.075), new THREE.MeshStandardMaterial({ map: ntex, roughness: 0.4 }));
      dec.position.set(0.02, 0.075, z * 0.98); dec.rotation.y = z > 0 ? 0 : Math.PI; g.add(dec);
    }
    const hood = new THREE.Mesh(new THREE.PlaneGeometry(0.07, 0.07), new THREE.MeshStandardMaterial({ map: ntex, roughness: 0.4 }));
    hood.rotation.x = -Math.PI / 2; hood.rotation.z = -Math.PI / 2; hood.position.set(0.16, 0.083, 0); g.add(hood);
    for (const [x, z] of [[0.185, 0.122], [0.185, -0.122], [-0.18, 0.122], [-0.18, -0.122]]) {
      const t = new THREE.Mesh(tireGeo, tireMat); t.position.set(x, 0.056, z); g.add(t);
      const r = new THREE.Mesh(rimGeo, rimMat); r.position.set(x, 0.056, z); g.add(r);
    }
    for (const z of [-0.07, 0.07]) {
      const hl = new THREE.Mesh(new THREE.BoxGeometry(0.012, 0.016, 0.045), lightMat); hl.position.set(0.3, 0.05, z); g.add(hl);
      const tl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.016, 0.05), tailMat); tl.position.set(-0.305, 0.085, z); g.add(tl);
    }
  }
  g.scale.setScalar(CAR_SCALE);
  g.position.x = -GUIDE_BACK; // el origen del grupo es la guía
  root.add(g);
  if (!ghost) {
    const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.62), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity: 0.75 }));
    blob.rotation.x = -Math.PI / 2; blob.position.set(-GUIDE_BACK, 0.007, 0);
    root.add(blob);
  }
  if (!ghost) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.42, 0.5, 40), new THREE.MeshBasicMaterial({ color: liv.color, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2; ring.position.set(-GUIDE_BACK * 0.9, 0.012, 0);
    root.add(ring);
    root.userData.ring = ring;
  }
  return root;
}

// ---------------------------------------------------------------------------
// Chispas de las trencillas
// ---------------------------------------------------------------------------
const SPARKS = 260;
const sparkGeo = new THREE.BufferGeometry();
sparkGeo.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(SPARKS * 3), 3));
const sparkMat = new THREE.PointsMaterial({ color: 0xffc46b, size: 0.05, transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false });
const sparkPts = new THREE.Points(sparkGeo, sparkMat);
sparkPts.frustumCulled = false;
carsGroup.add(sparkPts);
const sparks = Array.from({ length: SPARKS }, () => ({ life: 0, x: 0, y: -10, z: 0, vx: 0, vy: 0, vz: 0 }));
let sparkIdx = 0;
function emitSpark(x, y, z, hx, hz) {
  const p = sparks[sparkIdx++ % SPARKS];
  p.life = 0.12 + Math.random() * 0.14;
  p.x = x; p.y = y; p.z = z;
  const sp = 1.5 + Math.random() * 2;
  p.vx = -hx * sp + (Math.random() - 0.5) * 1.5; p.vz = -hz * sp + (Math.random() - 0.5) * 1.5; p.vy = 0.5 + Math.random() * 1.2;
}
function updateSparks(dt) {
  const a = sparkGeo.attributes.position.array;
  for (let i = 0; i < SPARKS; i++) {
    const p = sparks[i];
    if (p.life > 0) {
      p.life -= dt; p.vy -= 9 * dt;
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
      if (p.y < 0.005) { p.y = 0.005; p.vy *= -0.3; }
    } else p.y = -10;
    a[i * 3] = p.x; a[i * 3 + 1] = p.y; a[i * 3 + 2] = p.z;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Derrape: marcas de goma de las ruedas traseras y halo de aviso bajo el coche
// ---------------------------------------------------------------------------
const SKID_MAX = 3000;
const skidMat = new THREE.MeshBasicMaterial({ color: 0x050506, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const skids = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), skidMat, SKID_MAX);
skids.count = 0; skids.frustumCulled = false;
skids.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
carsGroup.add(skids);
let skidIdx = 0;
const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _pos = new THREE.Vector3(), _scl = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0);
function clearSkids() { skids.count = 0; skidIdx = 0; skids.instanceMatrix.needsUpdate = true; }
function addSkid(x0, z0, x1, z1, y, w) {
  const dx = x1 - x0, dz = z1 - z0, len = Math.hypot(dx, dz);
  if (len < 0.004 || len > 1.2) return;
  _q.setFromAxisAngle(_up, Math.atan2(dx, dz));
  _pos.set((x0 + x1) / 2, y, (z0 + z1) / 2);
  _scl.set(w, 1, len + 0.01);
  _m4.compose(_pos, _q, _scl);
  skids.setMatrixAt(skidIdx, _m4);
  skidIdx = (skidIdx + 1) % SKID_MAX;
  skids.count = Math.min(SKID_MAX, skids.count + 1);
  skids.instanceMatrix.needsUpdate = true;
}
const REAR = 0.7, HALF_TRACK = 0.19;   // posición de las ruedas traseras respecto a la guía (unidades)
function updateSkids(c, p) {
  const st = c.st;
  const sliding = st.v > 0.5 && (st.Fr > 0.93 || Math.abs(st.th) > 0.1 || st.wheelspin > 0.08);
  const psi = p.h + st.th;
  const fx = Math.cos(psi), fz = Math.sin(psi), nx = -fz, nz = fx;
  const rx = p.x - fx * REAR, rz = p.z - fz * REAR;
  const wl = [rx + nx * HALF_TRACK, rz + nz * HALF_TRACK, rx - nx * HALF_TRACK, rz - nz * HALF_TRACK];
  if (sliding && c.skidPrev && p.y < 0.05) {
    const w = 0.035 + Math.min(0.03, Math.abs(st.th) * 0.08);
    addSkid(c.skidPrev[0], c.skidPrev[1], wl[0], wl[1], p.y + 0.0052, w);
    addSkid(c.skidPrev[2], c.skidPrev[3], wl[2], wl[3], p.y + 0.0052, w);
  }
  c.skidPrev = sliding ? wl : null;
}
// Carteles de frenada junto a tu carril: marcan dónde empieza la frenada (yendo a tope)
// antes de cada curva fuerte, como los carteles de un circuito.
const brakeBoardTex = canvasTex(128, 64, (g, w, h) => {
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#e53935';
  for (let k = 0; k < 3; k++) { const x = 18 + k * 34; g.beginPath(); g.moveTo(x, 10); g.lineTo(x + 22, h / 2); g.lineTo(x, h - 10); g.lineTo(x + 10, h - 10); g.lineTo(x + 32, h / 2); g.lineTo(x + 10, 10); g.closePath(); g.fill(); }
}, false);
function buildBrakeMarks(c) {
  const grp = new THREE.Group();
  grp.visible = settings.brakes;
  const P = T.pts, d = c.d;
  const boardGeo = new THREE.PlaneGeometry(0.5, 0.25);
  const boardMat = new THREE.MeshBasicMaterial({ map: brakeBoardTex, side: THREE.DoubleSide });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8a9099, metalness: 0.5, roughness: 0.4 });
  for (const z of c.tel.zones) {
    if (z.vmax - z.vmin < 0.9) continue;
    // Cartel de frenada en el borde más cercano a tu carril
    const p = P[z.start], sgn = d >= 0 ? 1 : -1;
    if (p.y < 0.05) {
      const nx = -Math.sin(p.h), nz = Math.cos(p.h), off = (T.half + 0.18) * sgn;
      const board = new THREE.Mesh(boardGeo, boardMat);
      board.position.set(p.x + nx * off, 0.3, p.z + nz * off);
      board.rotation.y = -p.h - Math.PI / 2;
      grp.add(board);
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.2, 0.03), postMat);
      post.position.set(p.x + nx * off, 0.09, p.z + nz * off);
      post.castShadow = true;
      grp.add(post);
    }
  }
  carsGroup.add(grp);
  brakeGroups.push(grp);
}
const brakeGroups = [];

// Halo bajo el coche del jugador: verde → ámbar → rojo según lo cerca que está de salirse
const haloTex = canvasTex(128, 64, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 2, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}, false);
function makeHalo() {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.7, 0.9), new THREE.MeshBasicMaterial({ map: haloTex, color: 0xff3b30, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
  m.rotation.x = -Math.PI / 2; m.position.set(-0.4, 0.009, 0);
  m.renderOrder = 2;
  return m;
}
const _haloCol = new THREE.Color();
function updateHalo(c) {
  const h = c.mesh.userData.halo;
  if (!h) return;
  const x = c.tel ? c.tel.dangerS : 0;
  const a = c.crash ? 0 : clamp((x - 0.86) / 0.17, 0, 1);
  h.material.opacity = a * (settings.tele ? 0.9 : 0.6);
  h.visible = a > 0.01;
  if (h.visible) h.material.color.copy(_haloCol.set(dangerColor(x)));
}

// ---------------------------------------------------------------------------
// Cámara: TV (vista de mesa), persecución y a bordo
// ---------------------------------------------------------------------------
const CAMS = ['heli', 'tv', 'persecucion', 'bordo'];
const CAM_NAME = { tv: 'Cámara TV', heli: 'Helicóptero', persecucion: 'Persecución', bordo: 'A bordo' };
// La cámara principal es la de helicóptero: cada carrera empieza con ella
const DEFAULT_CAM = 'heli';
let camMode = DEFAULT_CAM;
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
let camLook = 0, heliH = null;
const camGoalPos = new THREE.Vector3(), camGoalTarget = new THREE.Vector3();
let orbit = 0;
const TiltShift = {
  uniforms: { tDiffuse: { value: null }, dir: { value: new THREE.Vector2(1, 0) }, focus: { value: 0.5 }, band: { value: 0.12 }, amount: { value: 3.0 }, res: { value: new THREE.Vector2(1, 1) } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform vec2 dir; uniform float focus; uniform float band; uniform float amount; uniform vec2 res; varying vec2 vUv;
    void main() {
      float d = abs(vUv.y - focus);
      float r = clamp((d - band) / (0.55 - band), 0.0, 1.0) * amount;
      vec4 sum = vec4(0.0); float ws = 0.0;
      for (int i = -4; i <= 4; i++) { float w = exp(-float(i * i) / 9.0); sum += texture2D(tDiffuse, vUv + dir * float(i) * r / res) * w; ws += w; }
      gl_FragColor = sum / ws;
    }`,
};
let composer = null, tiltH = null, tiltV = null, bloom = null;
function setupComposer() {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  tiltH = new ShaderPass(TiltShift); tiltV = new ShaderPass(TiltShift);
  tiltV.uniforms.dir.value.set(0, 1);
  composer.addPass(tiltH); composer.addPass(tiltV);
  bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.24, 0.45, 0.93);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());
}
function fitCamera() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  if (composer) {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(W, H);
    const pr = renderer.getPixelRatio();
    tiltH.uniforms.res.value.set(W * pr, H * pr); tiltV.uniforms.res.value.set(W * pr, H * pr);
  }
}
const focusV = new THREE.Vector3();
let focusY = 0.5;
function renderFrame(dt) {
  if (!composer || quality >= 2) { renderer.render(scene, camera); return; }
  // Enfoca tu coche (o el centro de la mesa en los menús)
  const me = cars.find((c) => c.human) || cars[0];
  let fy = 0.5;
  if (me) { me.mesh.getWorldPosition(focusV); focusV.y += 0.15; focusV.project(camera); fy = clamp(focusV.y * 0.5 + 0.5, 0.03, 0.97); }
  focusY += (fy - focusY) * Math.min(1, dt * 4);
  const close = camMode !== 'tv' && state !== 'menu';
  for (const p of [tiltH, tiltV]) {
    p.uniforms.focus.value = focusY;
    const heli = camMode === 'heli' && state !== 'menu';
    p.uniforms.band.value = heli ? 0.4 : close ? 0.22 : 0.1;
    p.uniforms.amount.value = (quality === 0 ? 3.2 : 2.2) * (heli ? 0.4 : close ? 0.75 : 1);
  }
  bloom.enabled = quality === 0;
  composer.render(dt);
}
function overviewCamera(out, target) {
  const bw = T.bbox.maxX - T.bbox.minX + 1.6, bd = T.bbox.maxZ - T.bbox.minZ + 1.6;
  const portrait = camera.aspect < 1;
  const az = (portrait ? bw > bd : bw < bd) ? Math.PI / 2 : 0;
  const scrW = az ? bd : bw, scrD = az ? bw : bd;
  const el = (57 * Math.PI) / 180;
  const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const needV = scrD * Math.sin(el) + 1.2;
  let dist = Math.max((scrW / 2) / Math.tan(hf / 2), (needV / 2) / Math.tan(vf / 2)) * (portrait ? 1.12 : 1.28) + 1;
  if (state === 'menu') dist *= 1.15;
  else if (portrait) dist *= 1.07;
  const a = az + orbit;
  out.set(Math.sin(a) * Math.cos(el) * dist, Math.sin(el) * dist, Math.cos(a) * Math.cos(el) * dist);
  target.set(Math.sin(a) * 0.9 * (portrait ? 1 : 0.4), 0, Math.cos(a) * 0.9 * (portrait ? 1 : 0.4));
}

// ---------------------------------------------------------------------------
// Carrera
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | circuits | garage | countdown | race | pause | results
let race = null;
let cars = [];
let ghost = null;   // { mesh, data, d }
let physTrack = null;

function clearCars() {
  for (const c of cars) stopEngine(c.engine);
  for (const ch of [...carsGroup.children]) if (ch !== sparkPts && ch !== skids) { carsGroup.remove(ch); disposeGroup(ch); }
  cars = [];
  ghost = null;
  wrGhost = null;
  clearSkids();
  brakeGroups.length = 0;
}

// Pose: la guía va en el carril; el coche gira θ respecto a la tangente
function placeCar(mesh, s, d, th) {
  const p = at(s, d);
  mesh.position.set(p.x, p.y + 0.004, p.z);
  mesh.rotation.set(0, -(p.h + th), 0);
  mesh.rotateZ(Math.atan(p.slope));
  return p;
}

function makeCar({ liv, lane, human, player, name, setupRaw, skill, carId = DEFAULT_CAR }) {
  const mesh = makeCarMesh(liv, false, carId);
  carsGroup.add(mesh);
  const setup = resolveSetup(setupRaw);
  const c = {
    carId, liv, lane, d: T.offsets[lane], human, player, name, setupRaw, setup, skill: skill || 1,
    st: newCarState(T.L - 0.55), thr: 0, mesh,
    lap: 0, lapStart: 0, laps: [], best: Infinity, last: NaN, finished: false, finishTime: 0,
    crash: null, blink: 0, mistake: 0, crashes: 0,
    engine: makeEngine(human), prof: null, rec: [], recT: 0,
  };
  if (!human) c.prof = buildProfile(physTrack, c.d, setup, 0.95);
  if (human) {
    mesh.userData.ring.material.opacity = 0.7;
    c.tel = makeTelemetry(physTrack, c.d, setup);
    mesh.userData.halo = makeHalo();
    mesh.add(mesh.userData.halo);
  }
  cars.push(c);
  placeCar(mesh, c.st.s, c.d, 0);
  return c;
}

function ghostKey(trackId, cls) { return `ghost.${trackId}.${cls}`; }

// mode: 'practica' | '1p' | '2p'
function startRace({ def, trackIdx, mode, entries, online, laps: lapsOverride }) {
  initAudio();
  def = def || TRACKS[trackIdx];
  trackIdx = TRACKS.indexOf(def);
  if (def.cid && !playedCids.has(def.cid)) { playedCids.add(def.cid); apiPost(`/api/tracks/${def.cid}/play`); }
  buildTrack(def);
  physTrack = { L: T.L, DSU: DS, pts: T.pts };
  clearCars();
  const lanes = def.lanes;
  const humans = entries.length;
  const used = new Set(entries.map((e) => e.liv.id));
  const others = LIVERIES.filter((l) => !used.has(l.id));
  entries.forEach((e, i) => {
    const lane = online ? online.lane : humans === 2 ? i : (lanes === 2 ? 1 : Math.min(lanes - 1, 1));
    makeCar({ liv: e.liv, lane, human: true, player: i, name: humans === 2 ? `Jugador ${i + 1}` : 'Tú', setupRaw: e.setupRaw, carId: validCar(e.carId) });
  });
  for (const c of cars) if (c.human) buildBrakeMarks(c);
  // Online: los coches de los demás pilotos (se mueven con lo que llega por la red)
  if (online) {
    for (const p of online.players) {
      if (p.id === online.me) continue;
      const liv = LIVERIES.find((l) => l.id === p.liv) || LIVERIES[(p.lane + 1) % LIVERIES.length];
      const c = makeCar({ liv, lane: p.lane, human: false, name: p.name, setupRaw: DEFAULT_SETUP, carId: validCar(p.car) });
      c.remote = p.id; c.net = [];
    }
    // CPU de la sala: el anfitrión los conduce (IA normal) y manda su estado; los demás los ven por la red
    for (const bt of online.bots || []) {
      const liv = LIVERIES.find((l) => l.id === bt.liv) || LIVERIES[(bt.lane + 2) % LIVERIES.length];
      if (online.amHost) {
        const c = makeCar({ liv, lane: bt.lane, human: false, name: bt.name, setupRaw: { ...DEFAULT_SETUP, magnet: entries[0].setupRaw.magnet }, skill: 0.9 + Math.random() * 0.05, carId: validCar(bt.car) });
        c.botId = bt.id;
      } else {
        const c = makeCar({ liv, lane: bt.lane, human: false, name: bt.name, setupRaw: DEFAULT_SETUP, carId: validCar(bt.car) });
        c.remote = bt.id; c.net = [];
      }
    }
  }
  if (mode !== 'practica' && mode !== 'online') {
    const free = [...Array(lanes).keys()].filter((l) => !cars.some((c) => c.lane === l));
    const base = trackIdx >= 0 ? 0.86 + trackIdx * 0.018 : 0.93;
    free.forEach((l, i) => {
      // La CPU corre con el mismo imán que tú: si vas sin imán, ellos también
      const setupRaw = { ...DEFAULT_SETUP, magnet: entries[0].setupRaw.magnet };
      const skill = clamp(base + (i - (free.length - 1) / 2) * 0.025, 0.82, 0.97);
      // Los rivales llevan coches distintos del catálogo (así se ven los de la tienda)
      makeCar({ liv: others[i % others.length], lane: l, human: false, name: RIVALS[i % RIVALS.length], setupRaw, skill, carId: CARS[(i * 2 + 1) % CARS.length].id });
    });
  }
  // Fantasma: tu mejor vuelta guardada (solo en práctica)
  if (mode === 'practica') {
    const cls = classOf(entries[0].setupRaw);
    const data = store.get(ghostKey(def.id, cls), null);
    if (data) {
      const gid = validCar(entries[0].carId);
      const mesh = makeCarMesh(entries[0].liv, true, gid);
      carsGroup.add(mesh);
      ghost = { mesh, data, carId: gid };
    }
  }
  race = {
    trackIdx, def, mode, online, laps: mode === 'practica' ? Infinity : (online ? online.laps : lapsOverride || def.laps), simT: 0, acc: 0,
    goT: mode === 'practica' ? 1.2 : online ? Math.max(1, (online.startAt - room.serverNow()) / 1000) : 4.2 + Math.random() * 0.8, lightsOn: 0, started: false, finishedAt: null, humans, entries,
    cls: classOf(entries[0].setupRaw),
  };
  // Clasificación mundial (práctica en circuitos oficiales o publicados)
  race.rankKey = mode === 'practica' ? rankKeyOf(def) : null;
  if (race.rankKey) loadWorldRecord(race);
  state = 'countdown';
  heliH = null; camLook = 0;
  camMode = DEFAULT_CAM;
  setupSliders();
  setScreen('hud');
  // Presentación del circuito antes de la salida. En el online dura lo mismo para todos (reloj del servidor)
  startIntro(online);
  T.lights.forEach((m) => { m.material.emissive.setHex(0x000000); m.material.color.setHex(0x331111); });
  ui.count.textContent = '';
  updateHud(true);
}

function crashCar(c) {
  c.vlog = null;   // la vuelta con salida no cuenta; se vuelve a grabar desde la parada
  const p = at(c.st.s, c.d);
  c.crashes++;
  const psi = p.h + c.st.th;
  const out = -Math.sign(p.k || 1);
  const nx = -Math.sin(p.h) * out, nz = Math.cos(p.h) * out;
  const v = Math.max(0.5, c.st.v) / SCALE;  // a unidades/s
  c.crash = {
    x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z,
    vx: Math.cos(p.h) * v * 0.55 + nx * v * 0.35, vz: Math.sin(p.h) * v * 0.55 + nz * v * 0.35, vy: 1.4 + v * 0.06,
    yaw: -psi, spin: (c.st.w || (Math.random() - 0.5) * 8) * 1.5, roll: 0, t: 0,
  };
  if (c.human) { sfx.crash(); vibrate([60, 40, 90]); shake = 0.22; flashText(c.player, '¡FUERA!'); }
  else noise(0.25, 0.07, 800);
}

function animateCrash(c, dt) {
  const k = c.crash;
  k.t += dt;
  k.vy -= 9 * dt;
  k.x += k.vx * dt; k.z += k.vz * dt; k.y += k.vy * dt;
  if (k.y < 0.004) { k.y = 0.004; k.vy = Math.abs(k.vy) * 0.25; const f = Math.exp(-6 * dt); k.vx *= f; k.vz *= f; k.spin *= f; }
  k.yaw += k.spin * dt;
  k.roll += k.spin * 0.3 * dt;
  c.mesh.position.set(k.x, k.y, k.z);
  c.mesh.rotation.set(Math.sin(k.roll) * 0.5, k.yaw, 0);
  if (k.t > 1.9) { // el comisario devuelve el coche al carril
    const s = c.st.s;
    c.st = newCarState(s);
    c.crash = null;
    c.blink = 0.9;
  }
}

// Un paso de física para un coche
function physStep(c) {
  if (c.crash || c.remote) return;
  const hold = !race.started;
  let thr = c.human ? c.thrIn : aiThrottle(c.st, c.prof, physTrack, c.skill * (c.mistake > 0 ? c.mistakeMul : 1), c.setup);
  if (c.finished && !c.human) thr = Math.min(thr, 0.35);
  if (hold) { thr = 0; c.st.v = 0; c.st.w = 0; c.st.th = 0; }
  c.thr = thr;
  // Clasificación mundial: se graban las pulsaciones desde la última parada (salida o tras salirse)
  if (!hold && c.human && race.rankKey) {
    if (!c.vlog) { c.st = newCarState(c.st.s); c.vlog = { s0: c.st.s, t0: race.simTPrev, inputs: [], steps: 0, cross: 0 }; }
    const L = c.vlog.inputs;
    if (L.length && L[L.length - 2] === thr) L[L.length - 1]++; else L.push(thr, 1);
    c.vlog.steps++;
  }
  const before = c.st.s;
  step(c.st, physTrack, c.d, thr, c.setup);
  if (hold) c.st.s = before;
  if (c.st.out) { crashCar(c); return; }
  if (c.st.s >= T.L) {
    c.st.s -= T.L;
    // Instante exacto del paso por meta (interpolado dentro del paso)
    const over = (c.st.s * SCALE) / Math.max(0.05, c.st.v);
    if (c.vlog) c.vlog.cross++;
    crossLine(c, race.simT - over - race.goT);
  }
  if (c.tel) telStep(c.tel, c.st, c.st.s, race.simT - race.goT, race.started && c.lap > 0 && !c.finished);
  // Grabación para el fantasma (60 por segundo)
  if (c.human && race.mode === 'practica' && c.lap > 0) {
    c.recT += DT;
    if (c.recT >= 1 / 60) { c.recT -= 1 / 60; c.rec.push(+c.st.s.toFixed(3), +c.st.th.toFixed(3)); }
  }
}

function crossLine(c, now) {
  if (c.lap === 0) { c.lap = 1; c.lapStart = now; c.rec = []; c.recT = 0; if (c.tel) telLap(c.tel, c.st, now, NaN, false); return; }
  const lt = now - c.lapStart;
  c.laps.push(lt);
  c.last = lt;
  const prevBest = c.best;
  if (lt < c.best) c.best = lt;
  c.lapStart = now;
  if (c.tel) telLap(c.tel, c.st, now, lt, lt === c.best);
  if (c.human) {
    const key = `${race.def.id}|${race.cls}`;
    const recs = store.get('best', {});
    const rec = recs[key];
    if (race.mode === 'practica') addCoins(5);
    if (!rec || lt < rec) {
      recs[key] = lt; store.set('best', recs);
      if (race.mode === 'practica' && rec) addCoins(25);
      sfx.best();
      flashText(c.player, rec ? '¡Récord personal!' : '¡Primera vuelta!');
      if (race.mode === 'practica') store.set(ghostKey(race.def.id, race.cls), { t: lt, d: c.d, s: c.rec });
    } else if (lt < prevBest) { sfx.best(); flashText(c.player, '¡Mejor vuelta!'); } else sfx.lap();
    if (race.rankKey && c.vlog && c.vlog.cross >= 2 && c.player === 0) submitLap(c, lt);
    // (el récord de los circuitos de la comunidad sale del ranking mundial: vueltas comprobadas en Práctica)
    c.rec = []; c.recT = 0;
  }
  if (race.mode === 'online' && (c.human || c.botId)) {
    const bot = c.botId ? { bot: c.botId } : {};
    if (c.lap >= race.laps) room && room.send({ t: 'fin', time: now, best: c.best, ...bot });
    else room && room.send({ t: 'lap', lap: c.lap, time: lt, ...bot });
  }
  if (c.lap >= race.laps) {
    c.finished = true;
    c.finishTime = now;
    if (c.human) { sfx.finish(); vibrate([30, 30, 30, 30, 100]); flashText(c.player, '¡Meta!'); }
  } else c.lap++;
}

function progress(c) {
  if (c.finished) return 1e6 - c.finishTime;
  return c.lap === 0 ? c.st.s - T.L : (c.lap - 1) * T.L + c.st.s;
}
function standings() { return [...cars].sort((a, b) => progress(b) - progress(a)); }

function stepRace(dt) {
  // Semáforo
  const t = race.simT;
  if (state === 'countdown') {
    if (race.mode === 'practica') {
      if (t >= race.goT) { race.started = true; state = 'race'; }
    } else {
      const lit = Math.min(5, Math.floor(t / 0.7));
      if (lit > race.lightsOn) {
        race.lightsOn = lit;
        T.lights[lit - 1].material.emissive.setHex(0xff1a1a);
        T.lights[lit - 1].material.color.setHex(0xff3b3b);
        sfx.light();
      }
      if (t >= race.goT) {
        race.started = true; state = 'race';
        T.lights.forEach((m) => { m.material.emissive.setHex(0x000000); m.material.color.setHex(0x331111); });
        sfx.go();
        ui.count.textContent = '¡YA!';
        ui.count.classList.remove('pop'); void ui.count.offsetWidth; ui.count.classList.add('pop');
        setTimeout(() => { if (ui.count.textContent === '¡YA!') ui.count.textContent = ''; }, 900);
      }
    }
  }
  for (const c of cars) if (c.human) c.thrIn = Math.round(clamp(readThrottle(c.player, dt), 0, 1) * 1000) / 1000;
  if (race.mode === 'online') onlineTick();
  // Física a paso fijo
  race.acc += dt;
  let n = 0;
  while (race.acc >= DT && n < 60) {
    race.acc -= DT; n++;
    race.simTPrev = race.simT;
    race.simT += DT;
    for (const c of cars) physStep(c);
  }
  for (const c of cars) {
    // Errores de la CPU: a veces entra pasada en una curva (y puede salirse). Sin imán se equivoca
    // más y el error castiga más, como a un piloto de verdad.
    if (!c.human && !c.remote && race.started && !c.crash && c.mistake <= 0) {
      const M = AI_ERR[c.setupRaw.magnet] || AI_ERR.medio;
      if (Math.random() < dt * M.rate) { c.mistake = 0.7; c.mistakeMul = M.lo + Math.random() * (M.hi - M.lo); }
    }
    if (c.mistake > 0) c.mistake -= dt;
    if (c.remote) updateRemote(c);
    if (c.crash) animateCrash(c, dt);
    else {
      const p = placeCar(c.mesh, c.st.s, c.d, c.st.th);
      if (c.blink > 0) { c.blink -= dt; c.mesh.visible = Math.floor(c.blink * 12) % 2 === 0; } else c.mesh.visible = true;
      const wh = c.mesh.userData.wheels;
      if (wh) { const a = (c.st.v / 0.0105) * dt; for (const w of wh) w.rotateX(a); }
      updateSkids(c, p);
      // Chispas: al frenar fuerte o a alta velocidad
      const rate = (c.st.amps < -0.6 ? 70 : 0) + (c.st.v > 3 ? (c.st.v - 3) * 8 : 0);
      let k = rate * dt;
      while (k > 0) { if (Math.random() < k) emitSpark(p.x, p.y + 0.02, p.z, Math.cos(p.h), Math.sin(p.h)); k -= 1; }
    }
    updateEngine(c.engine, c.st, !c.crash);
    if (c.tel) { c.tel.dangerS += (c.tel.danger - c.tel.dangerS) * Math.min(1, dt * 14); updateHalo(c); }
  }
  // Fantasma
  if (ghost && race.started) {
    const me = cars[0];
    const tLap = me.lap > 0 ? race.simT - race.goT - me.lapStart : -1;
    const i = Math.floor(tLap * 60);
    if (i >= 0 && i * 2 + 1 < ghost.data.s.length) {
      ghost.mesh.visible = true;
      placeCar(ghost.mesh, ghost.data.s[i * 2], ghost.data.d, ghost.data.s[i * 2 + 1]);
    } else ghost.mesh.visible = false;
  }
  // Fantasma del récord mundial (dorado), sincronizado con tu vuelta
  if (wrGhost && race.started && wrGhost.race === race) {
    const me = cars[0];
    const tLap = me.lap > 0 ? race.simT - race.goT - me.lapStart : -1;
    const i = Math.floor(tLap * 60);
    if (i >= 0 && i * 2 + 1 < wrGhost.s.length) {
      wrGhost.mesh.visible = true;
      placeCar(wrGhost.mesh, wrGhost.s[i * 2], wrGhost.d, wrGhost.s[i * 2 + 1]);
    } else wrGhost.mesh.visible = false;
  }
  updateSparks(dt);
  // Fin
  if (race.mode !== 'practica') {
    const humansDone = cars.filter((c) => c.human).every((c) => c.finished);
    if (humansDone && race.finishedAt === null) race.finishedAt = race.simT;
    if (race.finishedAt !== null && race.simT - race.finishedAt > 1.6 && state === 'race') endRace();
  }
}

function endRace() {
  state = 'results';
  for (const c of cars) updateEngine(c.engine, c.st, false);
  const order = standings();
  const tbl = $('resTable');
  tbl.innerHTML = '';
  const winner = order[0];
  order.forEach((c, i) => {
    const tr = document.createElement('div');
    tr.className = 'row' + (c.human ? ' me' : '');
    const pos = document.createElement('b'); pos.textContent = `${i + 1}º`;
    const dot = document.createElement('i'); dot.style.background = '#' + c.liv.color.toString(16).padStart(6, '0');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
    const tm = document.createElement('span'); tm.className = 'tm';
    tm.textContent = !c.finished ? `+${race.laps - c.lap + 1} v.` : i === 0 ? fmt(c.finishTime) : '+' + fmt(c.finishTime - winner.finishTime);
    const bl = document.createElement('span'); bl.className = 'bl'; bl.textContent = fmt(c.best);
    tr.append(pos, dot, nm, tm, bl);
    tbl.appendChild(tr);
  });
  const me = cars.find((c) => c.human && c.player === 0);
  const myPos = order.indexOf(me) + 1;
  let title;
  if (race.mode === '2p') {
    const p1 = order.findIndex((c) => c.human && c.player === 0), p2 = order.findIndex((c) => c.human && c.player === 1);
    title = p1 < p2 ? '¡Gana el Jugador 1!' : '¡Gana el Jugador 2!';
  } else {
    title = myPos === 1 ? '¡Victoria! ' : myPos === 2 ? '¡Segundo puesto!' : myPos === 3 ? 'Tercer puesto' : `${myPos}º puesto`;
    const pos = store.get('pos', {});
    if (!pos[race.def.id] || myPos < pos[race.def.id]) { pos[race.def.id] = myPos; store.set('pos', pos); }
  }
  if (race.mode === 'online') {
    $('nextBtn').hidden = true; $('againBtn').hidden = true;
    $('resMenuBtn').querySelector('.btn-main').textContent = 'Volver a la sala';
  } else { $('againBtn').hidden = false; $('resMenuBtn').querySelector('.btn-main').textContent = 'Circuitos'; }
  $('resTitle').textContent = title;
  $('resSub').textContent = `${race.def.name} · ${race.laps} ${race.laps === 1 ? 'vuelta' : 'vueltas'} · ${CLASS_NAME[race.cls]}`;
  const best = store.get('best', {})[`${race.def.id}|${race.cls}`];
  $('resBest').textContent = best ? `Tu récord (${CLASS_NAME[race.cls].toLowerCase()}): ${fmt(best)}` : '';
  const nextIdx = race.trackIdx + 1;
  $('nextBtn').hidden = !(race.trackIdx >= 0 && nextIdx < TRACKS.length);
  $('nextBtn').querySelector('.btn-main').textContent = 'Siguiente circuito ›';
  const unlockedNow = false;
  $('resUnlock').hidden = !unlockedNow;
  if (unlockedNow) $('resUnlock').textContent = `Desbloqueado: ${TRACKS[nextIdx].name}`;
  const liked = store.get('liked', []);
  $('likeBtn').hidden = !race.def.cid || race.mode === 'online';
  $('likeBtn').disabled = liked.includes(race.def.cid);
  $('likeBtn').querySelector('.btn-main').textContent = liked.includes(race.def.cid) ? 'Te gusta' : 'Me gusta este circuito';
  // Créditos ganados
  let earned = 0;
  if (!race.paid) {
    race.paid = true;
    const humansPos = cars.filter((c) => c.human).map((c) => order.indexOf(c) + 1);
    const bestPos = Math.min(...humansPos);
    const me0 = cars.find((c) => c.human && c.player === 0);
    if (race.mode === 'online') earned = me0 && me0.finished && me0.finishTime < 9000 ? 60 + (myPos === 1 ? 120 : 0) : 0;
    else earned = raceReward(bestPos, Math.min(race.laps, 20));
    addCoins(earned);
  }
  $('resCoins').hidden = true;
  $('resCoins').textContent = `+${earned} créditos`;
  if (race.mode === 'online') { $('nextBtn').hidden = true; $('resChamp').hidden = true; setTimeout(() => openModal('mResults'), 300); return; }
  $('resChamp').hidden = true;
  if (race.champ) champAfterRace(order);
  setTimeout(() => openModal('mResults'), 300);
  const stats = store.get('stats', { races: 0, wins: 0, crashes: 0, laps: 0 });
  stats.races++; if (myPos === 1 && race.mode !== '2p') stats.wins++;
  for (const c of cars.filter((c) => c.human)) { stats.crashes += c.crashes; stats.laps += c.laps.length; }
  store.set('stats', stats);
}

function endPractice() {
  const me = cars[0];
  const stats = store.get('stats', { races: 0, wins: 0, crashes: 0, laps: 0 });
  stats.crashes += me.crashes; stats.laps += me.laps.length;
  store.set('stats', stats);
}

// Todos los circuitos están abiertos desde el principio
function isUnlocked() { return true; }

// ---------------------------------------------------------------------------
// Mandos: gatillo en pantalla, teclado y mando de consola (gatillo analógico)
// ---------------------------------------------------------------------------
const throttles = [0, 0];
const keys = new Set();
const pads = [];
function setupSliders() {
  const box = $('pads');
  box.innerHTML = '';
  pads.length = 0;
  const humans = cars.filter((c) => c.human).sort((a, b) => a.player - b.player);
  humans.forEach((c) => {
    const side = race.humans === 2 ? (c.player === 0 ? 'left' : 'right') : (settings.lefty ? 'left' : 'right');
    const el = document.createElement('div');
    el.className = `pad ${side}`;
    el.style.setProperty('--car', '#' + c.liv.color.toString(16).padStart(6, '0'));
    el.innerHTML = '<div class="pad-track"><div class="pad-fill"></div><div class="pad-knob"><span></span></div></div><div class="pad-label"></div>';
    el.querySelector('.pad-label').textContent = race.humans === 2 ? `J${c.player + 1}` : 'GATILLO';
    box.appendChild(el);
    const pad = { el, player: c.player, id: null, value: 0 };
    const trackEl = el.querySelector('.pad-track');
    const setFrom = (e) => { const r = trackEl.getBoundingClientRect(); pad.value = clamp((r.bottom - e.clientY) / r.height, 0, 1); };
    el.addEventListener('pointerdown', (e) => { initAudio(); pad.id = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch { /* nada */ } setFrom(e); });
    el.addEventListener('pointermove', (e) => { if (pad.id === e.pointerId) setFrom(e); });
    const up = (e) => { if (pad.id === e.pointerId) { pad.id = null; pad.value = 0; } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    pads.push(pad);
  });
}
function gamepadValue(player) {
  const gps = navigator.getGamepads ? [...navigator.getGamepads()].filter(Boolean) : [];
  const gp = gps[player];
  if (!gp) return 0;
  const rt = gp.buttons[7] ? gp.buttons[7].value : 0;
  const lt = race && race.humans === 1 && gp.buttons[6] ? gp.buttons[6].value : 0;
  return Math.max(rt, lt);
}
function readThrottle(player, dt) {
  const pad = pads.find((p) => p.player === player);
  let v = pad ? pad.value : 0;
  v = Math.max(v, gamepadValue(player));
  const k = player === 0 ? (keys.has('ArrowUp') || keys.has(' ')) : keys.has('w');
  if (k) v = Math.max(v, throttles[player] + dt * 2.5);
  else if (keys.size && !pad?.id) v = Math.max(v, throttles[player] - dt * 8);
  throttles[player] = clamp(v, 0, 1);
  if (pad) {
    pad.el.querySelector('.pad-fill').style.height = (throttles[player] * 100) + '%';
    pad.el.querySelector('.pad-knob').style.bottom = `calc(${throttles[player] * 100}% - 28px)`;
  }
  return throttles[player];
}
window.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (['ArrowUp', ' ', 'w'].includes(e.key)) { keys.add(e.key); initAudio(); e.preventDefault(); }
  if (e.key === 'Escape') { if (state === 'race' || state === 'countdown') pause(); else if (state === 'pause') resume(); }
  if (e.key === 'c' && (state === 'race' || state === 'countdown')) toggleCam();
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
let last = performance.now();
let shake = 0;
let viewOff = 0, viewOffX = 0;
// Calidad gráfica automática: si el dispositivo no mantiene la fluidez, baja resolución y sombras
const QUALITY = [
  { pr: Math.min(window.devicePixelRatio || 1, 2), shadows: true, map: 2048 },
  { pr: Math.min(window.devicePixelRatio || 1, 1.5), shadows: true, map: 1024 },
  { pr: 1, shadows: false, map: 512 },
];
let quality = clamp(store.get('quality', 0), 0, 2);
let perfAcc = 0, perfN = 0;
function applyQuality() {
  const q = QUALITY[quality];
  renderer.setPixelRatio(q.pr);
  renderer.shadowMap.enabled = q.shadows;
  sun.castShadow = q.shadows;
  sun.shadow.mapSize.set(q.map, q.map);
  if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
  fitCamera();
}
function watchPerf(rawDt) {
  if (state !== 'race' || quality >= 2) return;
  perfAcc += rawDt; perfN++;
  if (perfN >= 180) {
    if (perfAcc / perfN > 0.028) { quality++; store.set('quality', quality); applyQuality(); toast('Calidad gráfica ajustada para ir más fluido'); }
    perfAcc = 0; perfN = 0;
  }
}
function loop(now) {
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt);
  last = now;
  watchPerf(rawDt);
  requestAnimationFrame(loop);
  updateMusic();
  if (!T) return;
  if (state === 'intro') {
    if (race.intro.fixed && room) race.intro.t = ONLINE_INTRO - (race.intro.syncEnd - room.serverNow()) / 1000;
    else race.intro.t += dt;
    for (const c of cars) if (!c.crash) placeCar(c.mesh, c.st.s, c.d, c.st.th);
    if (race.intro.fixed ? race.intro.t >= ONLINE_INTRO : race.intro.t >= race.intro.d1 + race.intro.d2 + 0.4) endIntro();
  } else if (state === 'countdown' || state === 'race' || state === 'results') {
    stepRace(dt);
    updateHud();
    updateTele();
  } else if (state === 'menu' || state === 'circuits' || state === 'garage') {
    if (race && race.demo) {
      // A cámara lenta, como en un anuncio: se ve cada derrape
      const sdt = dt * DEMO_SPEED;
      race.acc += sdt;
      let n = 0;
      while (race.acc >= DT && n < 40) { race.acc -= DT; n++; race.simT += DT; for (const c of cars) physStep(c); }
      for (const c of cars) {
        demoMistakes(c, sdt);
        if (c.crash) animateCrash(c, sdt);
        else {
          const p = placeCar(c.mesh, c.st.s, c.d, c.st.th);
          if (c.blink > 0) { c.blink -= sdt; c.mesh.visible = Math.floor(c.blink * 12) % 2 === 0; } else c.mesh.visible = true;
          const wh = c.mesh.userData.wheels;
          if (wh) { const a = (c.st.v / 0.0105) * sdt; for (const w of wh) w.rotateX(a); }
          updateSkids(c, p);
          const rate = (c.st.amps < -0.6 ? 70 : 0) + (c.st.v > 3 ? (c.st.v - 3) * 8 : 0);
          let k = rate * sdt;
          while (k > 0) { if (Math.random() < k) emitSpark(p.x, p.y + 0.02, p.z, Math.cos(p.h), Math.sin(p.h)); k -= 1; }
        }
      }
      updateSparks(sdt);
    }
    orbit += dt * 0.05;
  }

  // Cámara
  const racing = state === 'race' || state === 'countdown' || state === 'pause' || state === 'results';
  for (const c of cars) if (c.human && c.mesh.userData.ring) c.mesh.userData.ring.visible = camMode === 'tv';
  const me = racing ? cars.find((c) => c.human) : null;
  if (state === 'intro') {
    introCamera(dt);
  } else if (me && camMode !== 'tv') {
    const p = at(me.st.s, me.d);
    const psi = p.h + (me.crash ? 0 : me.st.th * 0.5);
    const fx = Math.cos(psi), fz = Math.sin(psi);
    const ox = -T.center.x, oz = -T.center.z;
    if (camMode === 'heli') {
      // Helicóptero: alto y detrás, girando despacio para que la pista que viene quede hacia arriba
      const ahead = at(me.st.s + 3.5, me.d);
      let dh = ahead.h - (heliH ?? ahead.h);
      dh -= Math.round(dh / (2 * Math.PI)) * 2 * Math.PI;
      heliH = (heliH ?? ahead.h) + dh * Math.min(1, dt * 2.5);
      const hx = Math.cos(heliH), hz = Math.sin(heliH);
      const portrait = camera.aspect < 1;
      const back = portrait ? 6 : 5.5, up = portrait ? 8 : 7, fwd = portrait ? 2 : 1.75;
      camGoalPos.set(p.x - hx * back + ox, p.y + up, p.z - hz * back + oz);
      camGoalTarget.set(p.x + hx * fwd + ox, p.y, p.z + hz * fwd + oz);
      const kf = 1 - Math.exp(-dt * 10);
      camPos.lerp(camGoalPos, kf);
      camTarget.lerp(camGoalTarget, kf);
    } else if (camMode === 'persecucion') {
      camGoalPos.set(p.x - fx * 3.3 + ox, p.y + 2.1, p.z - fz * 3.3 + oz);
      camGoalTarget.set(p.x + fx * 1.6 + ox, p.y - 0.3, p.z + fz * 1.6 + oz);
    } else {
      camGoalPos.set(p.x - fx * 1.25 + ox, p.y + 0.55, p.z - fz * 1.25 + oz);
      camGoalTarget.set(p.x + fx * 2.2 + ox, p.y + 0.12, p.z + fz * 2.2 + oz);
    }
    if (camMode !== 'heli') {
      camPos.lerp(camGoalPos, Math.min(1, dt * (camMode === 'bordo' ? 14 : 6)));
      camTarget.lerp(camGoalTarget, Math.min(1, dt * (camMode === 'bordo' ? 16 : 8)));
    }
  } else if (me && T.big && state !== 'results') {
    // Cámara de TV de circuito: alta, siguiendo al coche con algo de anticipación
    // Mirar por delante del coche (más cuanto más rápido) para ver la curva que viene
    const laGoal = me.crash ? 0 : clamp(Math.max(0, me.st.v) * 0.3 / SCALE, 1.5, camera.aspect < 1 ? 9 : 7.5);
    camLook += (laGoal - camLook) * Math.min(1, dt * 1.5);
    const p = at(me.st.s + camLook, me.d);
    const ox = -T.center.x, oz = -T.center.z;
    const portrait = camera.aspect < 1;
    const D = portrait ? 25 : 21, el = (58 * Math.PI) / 180;
    camGoalTarget.set(p.x + ox, p.y, p.z + oz);
    camGoalPos.set(p.x + ox, p.y + Math.sin(el) * D, p.z + oz + Math.cos(el) * D);
    // Seguimiento firme: el punto mirado ya avanza suave por la pista, así que casi no hay retraso
    const kf = 1 - Math.exp(-dt * 12);
    camPos.lerp(camGoalPos, kf);
    camTarget.lerp(camGoalTarget, kf);
  } else if (state === 'menu' && race && race.demo && cars.length) {
    menuCamera(dt);
  } else {
    overviewCamera(camGoalPos, camGoalTarget);
    camPos.lerp(camGoalPos, Math.min(1, dt * 3));
    camTarget.lerp(camGoalTarget, Math.min(1, dt * 3));
  }
  const inMenu = state === 'menu' && !!shot;
  const wantOffset = racing && camMode === 'tv' && camera.aspect < 1 ? 0.09 : inMenu && camera.aspect < 1 ? 0.2 : 0;
  // En el menú horizontal el vídeo se centra en la mitad derecha (la izquierda es el menú)
  const wantOffX = inMenu && camera.aspect >= 1 && innerWidth >= 700 ? -0.17 : 0;
  viewOff += (wantOffset - viewOff) * Math.min(1, dt * 4);
  viewOffX += (wantOffX - viewOffX) * Math.min(1, dt * 4);
  if (Math.abs(viewOff) > 0.001 || Math.abs(viewOffX) > 0.001) camera.setViewOffset(innerWidth, innerHeight, innerWidth * viewOffX, innerHeight * viewOff, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.fov = state === 'intro' ? 38 : inMenu ? shot.fov : racing && camMode === 'bordo' ? 52 : racing && camMode === 'heli' ? 50 : 34;
  camera.updateProjectionMatrix();
  camera.position.copy(camPos);
  if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  camera.lookAt(camTarget);
  camera.updateMatrixWorld();
  updateCrowd(dt);
  renderFrame(dt);
}

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
const ui = {
  splash: $('splash'), menu: $('menu'), circuits: $('circuits'), garage: $('garage'), hud: $('hud'),
  count: $('count'), toast: $('toast'), hudRows: $('hudRows'), timing: $('timing'),
};
const SCREENS = { menu: ui.menu, circuits: ui.circuits, garage: ui.garage, hud: ui.hud, editor: $('editor'), online: $('online'), champ: $('champ'), shop: $('shop') };
function setScreen(name) { for (const [k, el] of Object.entries(SCREENS)) el.classList.toggle('open', k === name); }
function openModal(id) { if (id === 'mSettings') fillSettings(); if (id === 'mStats') fillStats(); $(id).classList.add('open'); }
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { initAudio(); sfx.click(); openModal(b.dataset.open); }));
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m && m.dataset.dismiss !== 'no') closeModal(m.id); });
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(m.id)));
});
function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ui.toast.classList.remove('on'), 2200);
}
function flashText(player, text) {
  const el = document.createElement('div');
  el.className = 'flash ' + (race && race.humans === 2 ? (player === 0 ? 'p1' : 'p2') : '');
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1300);
}

// Pantalla de tiempos, al estilo de un programa de cronometraje de club
let hudTick = 0;
function updateHud(force) {
  if (!race) return;
  hudTick++;
  if (!force && hudTick % 3) return;
  const order = standings();
  const humans = cars.filter((c) => c.human).sort((a, b) => a.player - b.player);
  const nowT = race.simT - race.goT;
  const recBest = store.get('best', {})[`${race.def.id}|${race.cls}`];
  ui.hudRows.innerHTML = '';
  for (const c of humans) {
    const card = document.createElement('div');
    card.className = 'tcard' + ((c.tel ? c.tel.dangerS > 1.0 : c.st.Fr > 0.95) && c.st.v > 1 && !c.crash ? ' warn' : '');
    card.style.setProperty('--car', '#' + c.liv.color.toString(16).padStart(6, '0'));
    const cur = c.lap > 0 && !c.finished ? nowT - c.lapStart : null;
    const ref = race.mode === 'practica' ? recBest : c.best;
    const lapTxt = race.mode === 'practica' ? `Vuelta ${Math.max(1, c.lap)}` : c.finished ? 'Terminado' : `Vuelta ${Math.max(1, c.lap)}/${race.laps}`;
    const pos = race.mode === 'practica' ? '' : `<div class="tpos"><b>${order.indexOf(c) + 1}º</b><small>/${cars.length}</small></div>`;
    const kmh = Math.round(Math.max(0, c.st.v) * 3.6 * 32);
    const delta = Number.isFinite(c.last) && Number.isFinite(ref) && c.laps.length ? c.last - ref : null;
    card.innerHTML = `${pos}<div class="tmain"><span class="tlap"></span><span class="tcur"></span>
      <span class="trow"><em>Última</em><i class="tlast"></i><em>Mejor</em><i class="tbest"></i></span></div>
      <div class="tside"><b class="tkmh"></b><small>km/h escala</small><span class="tdelta"></span></div>`;
    if (c.tel && !(settings.tele && race.humans === 1)) {
      const gb = document.createElement('span'); gb.className = 'tgrip';
      const x = c.tel.dangerS, gi = document.createElement('i');
      gi.style.width = `${clamp((x - 0.6) / 0.5, 0, 1) * 100}%`; gi.style.background = dangerColor(x);
      gb.appendChild(gi); card.querySelector('.tmain').appendChild(gb);
    }
    card.querySelector('.tlap').textContent = `${c.name} · ${lapTxt}`;
    card.querySelector('.tcur').textContent = cur != null ? fmt(cur) : '0,000';
    card.querySelector('.tlast').textContent = fmt(c.last);
    card.querySelector('.tbest').textContent = fmt(c.best);
    card.querySelector('.tkmh').textContent = kmh;
    const dEl = card.querySelector('.tdelta');
    if (delta != null && race.mode === 'practica') { dEl.textContent = fmtDelta(delta); dEl.className = 'tdelta ' + (delta <= 0 ? 'good' : 'bad'); }
    if (race.rankKey && c.player === 0) {
      const w = document.createElement('span'); w.className = 'wr-line';
      w.textContent = race.wr ? `Récord mundial ${fmt(race.wr.time)} · ${race.wr.name}${race.wrMine ? ` · tú ${race.wrMine.pos}º` : ''}` : 'Récord mundial: ¡aún libre!';
      card.querySelector('.tmain').appendChild(w);
    }
    ui.hudRows.appendChild(card);
  }
  // Lista de vueltas (práctica)
  if (race.mode === 'practica') {
    const me = humans[0];
    const box = $('lapList');
    box.hidden = !me.laps.length;
    box.innerHTML = '';
    me.laps.slice(-6).reverse().forEach((lt, i) => {
      const n = me.laps.length - i;
      const r = document.createElement('div');
      r.className = 'lrow' + (lt === me.best ? ' best' : '');
      r.innerHTML = `<span>V${n}</span><b></b>`;
      r.querySelector('b').textContent = fmt(lt);
      box.appendChild(r);
    });
  } else $('lapList').hidden = true;
}

// Panel de telemetría del piloto (1 jugador)
const tl = { el: $('tele'), c: $('tlC'), nb: $('tlNext'), v: $('tlV'), k: $('tlK'), d: $('tlD'), bar: $('tlBar'), g: $('tlG'), max: $('tlMax'), trap: $('tlTrap'), peak: $('tlPeak'), trace: $('tlTrace'), sec: [0, 1, 2].map((i) => $('tlS' + i)), tick: 0 };
const ms = (v) => (Number.isFinite(v) && v > 0 ? v.toFixed(2).replace('.', ',') : '–');
function updateTele() {
  const show = !!race && race.humans === 1 && settings.tele && state !== 'results';
  tl.el.hidden = !show;
  if (!show) return;
  const c = cars.find((x) => x.human);
  if (!c || !c.tel) return;
  const T2 = c.tel, st = c.st;
  tl.el.classList.toggle('lefty', !!settings.lefty);
  const x = c.crash ? 0 : T2.dangerS;
  tl.v.textContent = (c.crash ? 0 : Math.max(0, st.v)).toFixed(2).replace('.', ',');
  tl.k.textContent = Math.round(Math.max(0, c.crash ? 0 : st.v) * 3.6 * 32);
  tl.d.textContent = `${Math.round(Math.abs(c.crash ? 0 : st.th) * 57.3)}°`;
  tl.bar.style.width = `${clamp((x - 0.6) / 0.5, 0, 1) * 100}%`;
  tl.bar.style.background = dangerColor(x);
  tl.g.textContent = x > 1.5 ? 'MAX' : `${Math.round(x * 100)}%`;
  tl.g.style.color = dangerColor(x);
  tl.el.classList.toggle('alarm', x >= 1.0);
  const cause = x < 0.9 ? 'Agarre' : T2.cause === 'drift' ? (x >= 0.98 ? '¡Trompo!' : 'Derrapa') : (x >= 0.98 ? '¡Frena!' : 'Al límite');
  if (tl.c.textContent !== cause) tl.c.textContent = cause;
  tl.c.style.color = x < 0.9 ? '' : dangerColor(x);
  const nx = T2.next;
  if (nx && c.lap > 0 || nx && race.started) {
    const vin = nx.vmin.toFixed(1).replace('.', ',');
    const txt = nx.inZone ? `Frenando · entra a ${vin} m/s` : `Frenada en ${nx.dist < 1 ? Math.round(nx.dist * 100) + ' cm' : nx.dist.toFixed(1).replace('.', ',') + ' m'} · entra a ${vin} m/s`;
    if (tl.nb.textContent !== txt) tl.nb.textContent = txt;
    const near = nx.inZone || nx.dist < Math.max(0.2, st.v * 0.12);
    tl.nb.className = 'tl-next' + (nx.inZone ? ' in' : near ? ' near' : '');
  } else tl.nb.textContent = '';
  if (++tl.tick % 6) return;
  tl.max.textContent = ms(c.lap > 0 ? Math.max(T2.vmax, 0) : NaN);
  tl.trap.textContent = ms(T2.trap);
  tl.peak.textContent = T2.last ? `${Math.round(T2.last.peak * 100)}%` : '–';
  for (let k = 0; k < SECTORS; k++) {
    const live = c.lap > 0 && k === T2.secIdx;
    const done = c.lap > 0 && k < T2.secIdx;
    const t = done ? T2.sec[k] : T2.secLast[k];
    const stt = done ? (T2.sec[k] < T2.secBest[k] ? 'best' : T2.sec[k] < T2.secLast[k] ? 'better' : 'worse') : live ? '' : (T2.lastStatus || [])[k] || '';
    tl.sec[k].className = 'sec ' + stt + (live ? ' run' : '');
    tl.sec[k].textContent = `S${k + 1} ${Number.isFinite(t) ? t.toFixed(3).replace('.', ',') : '–'}`;
  }
  drawTrace(tl.trace, T2, (((st.s % T.L) + T.L) % T.L) / T.L, buildVtop(c));
}
function buildVtop(c) { return c.vtop || (c.vtop = Math.max(...c.tel.lim) * 1.02); }

// ---- Menú ----
let mode = '1p';
let selDef = TRACKS[0];
function showMenu() {
  state = 'menu';
  closeModal('mResults'); closeModal('mPause');
  demoRace();
  const pos = store.get('pos', {});
  $('trophies').textContent = `${TRACKS.filter((t) => pos[t.id] === 1).length}/${TRACKS.length}`;
  setScreen('menu');
}
// Fondo del menú: una carrera de exhibición retransmitida como en la tele (4 coches, circuitos largos)
const DEMO_MAG = ['bajo', 'sin', 'medio', 'bajo'];
const DEMO_SPEED = 0.5;   // la exhibición va a la mitad de velocidad (cámara lenta)
// Errores del piloto en la exhibición: a menudo aprieta un poco de más (derrapa) y de vez en cuando
// entra muy pasado en una curva (se sale). Medido: una salida cada ~15 s entre los 4 coches.
function demoMistakes(c, dt) {
  if (c.crash) return;
  if (c.mistake > 0) { c.mistake -= dt; return; }
  const r = Math.random();
  if (r < dt * 0.02) { c.mistake = 0.7; c.mistakeMul = 1.14 + Math.random() * 0.12; }
  else if (r < dt * 0.82) { c.mistake = 0.8; c.mistakeMul = 1.04 + Math.random() * 0.06; }
}
const DEMO_TRACKS = ['autodromo', 'internacional', 'gp', 'resistencia', 'montana', 'chicane'];
let demoIdx = Math.floor(Math.random() * DEMO_TRACKS.length);
function demoRace() {
  const def = TRACKS.find((t) => t.id === DEMO_TRACKS[demoIdx++ % DEMO_TRACKS.length]) || TRACKS[2];
  buildTrack(def);
  physTrack = { L: T.L, DSU: DS, pts: T.pts };
  clearCars();
  const mine = savedCar(0);
  const order = [mine, ...CARS.map((c) => c.id).filter((id) => id !== mine)];
  for (let l = 0; l < T.offsets.length; l++) {
    // Imanes distintos: los de poco imán derrapan más (y alguno acabará fuera)
    makeCar({ liv: LIVERIES[l % LIVERIES.length], lane: l, human: false, name: 'demo', setupRaw: { ...DEFAULT_SETUP, magnet: DEMO_MAG[l % DEMO_MAG.length] }, skill: 0.985 - l * 0.012, carId: order[l % order.length] });
  }
  // Salen en pelotón, escalonados
  cars.forEach((c, i) => { c.st.s = (T.L - i * 1.6) % T.L; });
  race = { demo: true, simT: 0, acc: 0, goT: 0, started: true, laps: Infinity, def, humans: 0, finishedAt: null, mode: 'demo', cls: 'iman' };
  shot = null;
  $('liveTrack').textContent = def.name;
}
// Realizador: cambia de plano cada pocos segundos, como en una retransmisión
let shot = null, lastShot = '';
const SHOTS = ['pista', 'lateral', 'persecucion', 'frontal', 'grua', 'aereo', 'tele', 'pista', 'lateral'];
const tmpV = new THREE.Vector3();
function newShot() {
  const live = cars.map((c, i) => i).filter((i) => !cars[i].crash);
  if (!live.length) return false;
  let type;
  // El primer plano es el aéreo de presentación del circuito, como en una retransmisión
  if (!shot) type = 'aereo';
  else do type = SHOTS[Math.floor(Math.random() * SHOTS.length)]; while (type === lastShot);
  lastShot = type;
  // Como un realizador de verdad: a menudo pincha el coche que va más cruzado o que está apretando
  const hot = live.slice().sort((a, b) => (Math.abs(cars[b].st.th) + (cars[b].mistake > 0 ? 0.3 : 0)) - (Math.abs(cars[a].st.th) + (cars[a].mistake > 0 ? 0.3 : 0)))[0];
  const ci = Math.random() < 0.35 ? hot : shot && live.length > 1 && Math.random() < 0.6 ? live.filter((i) => i !== shot.ci)[Math.floor(Math.random() * (live.length - 1))] : live[Math.floor(Math.random() * live.length)];
  const c = cars[ci];
  shot = { type, ci, t: 0, dur: 7 + Math.random() * 3, side: Math.random() < 0.5 ? 1 : -1, a0: Math.random() * Math.PI * 2, fov: 30 };
  shot.fov = { pista: 22, tele: 17, lateral: 28, persecucion: 34, frontal: 30, grua: 36, aereo: 40 }[type];
  if (type === 'tele') {
    // Teleobjetivo a ras de pista, lejos y por delante: se ve al coche trazar las curvas
    const half = (T.offsets.length * LANE_W) / 2 + 0.55;
    shot.dist = 8;
    const ok = [shot.side, -shot.side].find((sg) => {
      const q = at(c.st.s + shot.dist, half * sg), r = at(c.st.s, c.d);
      return clearView(tmpV.set(q.x - T.center.x, q.y + 0.42, q.z - T.center.z).clone(), new THREE.Vector3(r.x - T.center.x, r.y + 0.12, r.z - T.center.z));
    });
    if (ok === undefined) { type = shot.type = 'frontal'; shot.fov = 30; } else { shot.side = ok; shot.edge = half * ok; }
  }
  if (type === 'pista') {
    const low = false;
    // Cámara fija junto a la pista, por delante del coche: lo ve llegar y pasar.
    // Se prueba a cada lado y a dos distancias hasta encontrar un sitio sin vallas ni gradas delante.
    const ahead = Math.max(2, c.st.v / SCALE) * shot.dur * (low ? 0.22 : 0.4);
    const half = (T.offsets.length * LANE_W) / 2;
    let found = null;
    for (const dist of low ? [0.32, 0.6] : [0.95, 1.6]) for (const sgn of [shot.side, -shot.side]) {
      if (found) break;
      const q = at(c.st.s + ahead, 0);
      const nx = -Math.sin(q.h), nz = Math.cos(q.h);
      const cam = new THREE.Vector3(q.x + nx * (half + dist) * sgn - T.center.x, q.y + (low ? 0.14 : 0.45), q.z + nz * (half + dist) * sgn - T.center.z);
      const seesCar = [c.st.s, c.st.s + ahead * 0.5, c.st.s + ahead].every((s2) => { const r = at(s2, c.d); return clearView(cam, tmpV.set(r.x - T.center.x, r.y + 0.12, r.z - T.center.z)); });
      if (seesCar) found = cam;
    }
    if (!found) { lastShot = ''; shot.type = type = 'persecucion'; shot.fov = 34; }
    else shot.fixed = found;
  }
  // Sale del fundido a negro poco a poco
  requestAnimationFrame(() => $('menuCut').classList.remove('on'));
  shot.snap = true;
  return true;
}
// ¿Se ve el punto b desde a sin que lo tape nada del decorado (vallas, gradas, pórtico…)?
const viewRay = new THREE.Raycaster();
function clearView(a, b) {
  const dir = new THREE.Vector3().subVectors(b, a);
  const d = dir.length();
  viewRay.set(a, dir.normalize());
  viewRay.far = Math.max(0, d - 0.4);
  const hits = viewRay.intersectObjects(world.children.filter((o) => o !== carsGroup), true);
  return !hits.some((h) => h.object.visible !== false && h.object.material && !h.object.material.transparent);
}
function menuCamera(dt) {
  // Si el coche del plano se sale, el plano aguanta un poco para que se vea y luego corta
  if (shot && cars[shot.ci].crash && shot.crashT === undefined) { shot.crashT = shot.t; shot.dur = Math.min(shot.dur, shot.t + 3); }
  if (shot && shot.t > shot.dur - 0.45) $('menuCut').classList.add('on');   // fundido a negro antes del corte
  if (!shot || shot.t >= shot.dur) { if (!newShot()) { overviewCamera(camGoalPos, camGoalTarget); camPos.lerp(camGoalPos, Math.min(1, dt * 3)); camTarget.lerp(camGoalTarget, Math.min(1, dt * 3)); return; } }
  shot.t += dt;
  const c = cars[shot.ci], k = shot.t / shot.dur;
  const p = at(c.st.s, c.d);
  const ox = -T.center.x, oz = -T.center.z;
  const fx = Math.cos(p.h), fz = Math.sin(p.h), nx = -Math.sin(p.h), nz = Math.cos(p.h);
  const px = p.x + ox, py = p.y, pz = p.z + oz;
  const sd = shot.side;
  switch (shot.type) {
    case 'pista': camGoalPos.copy(shot.fixed); camGoalTarget.set(px, py + 0.08, pz); break;
    case 'tele': {
      // Va por delante siguiendo la pista (también en las curvas) y se acerca poco a poco
      const q = at(c.st.s + shot.dist - 2.5 * k, shot.edge);
      camGoalPos.set(q.x + ox, q.y + 0.42, q.z + oz);
      camGoalTarget.set(px, py + 0.1, pz);
      break;
    }
    case 'lateral': {
      const along = -0.7 + 1.4 * k;
      camGoalPos.set(px + nx * 1.9 * sd + fx * along, py + 0.32, pz + nz * 1.9 * sd + fz * along);
      camGoalTarget.set(px + fx * 0.15, py + 0.1, pz + fz * 0.15);
      break;
    }
    case 'persecucion':
      camGoalPos.set(px - fx * 2.5 + nx * 0.35 * sd, py + 0.55, pz - fz * 2.5 + nz * 0.35 * sd);
      camGoalTarget.set(px + fx * 1.2, py + 0.12, pz + fz * 1.2);
      break;
    case 'frontal': {
      // Bajo, delante del coche: se le ve venir
      const d = 2.8 - 0.8 * k;
      camGoalPos.set(px + fx * d + nx * 0.5 * sd, py + 0.3, pz + fz * d + nz * 0.5 * sd);
      camGoalTarget.set(px, py + 0.1, pz);
      break;
    }
    case 'grua': {
      const a = shot.a0 + k * 0.6;
      camGoalPos.set(px + Math.cos(a) * 3.2, py + 1.3 + 0.9 * k, pz + Math.sin(a) * 3.2);
      camGoalTarget.set(px, py + 0.1, pz);
      break;
    }
    default: { // aéreo
      camGoalPos.set(px + nx * 3 * sd - fx * 2, py + 7.5 - 1.5 * k, pz + nz * 3 * sd - fz * 2);
      camGoalTarget.set(px + fx * 1.5, py, pz + fz * 1.5);
    }
  }
  if (shot.snap) { camPos.copy(camGoalPos); camTarget.copy(camGoalTarget); shot.snap = false; }
  else {
    // Los planos móviles siguen al coche casi pegados; la cámara fija solo gira
    const kp = 1 - Math.exp(-dt * (shot.fixed ? 30 : 8)), kt = 1 - Math.exp(-dt * 10);
    camPos.lerp(camGoalPos, kp); camTarget.lerp(camGoalTarget, kt);
  }
}
$('playPrac').addEventListener('click', () => { initAudio(); sfx.click(); mode = 'practica'; showCircuits(); });
$('play1').addEventListener('click', () => { initAudio(); sfx.click(); mode = '1p'; showCircuits(); });
$('play2').addEventListener('click', () => { initAudio(); sfx.click(); mode = '2p'; showCircuits(); });

// ---- Circuitos ----
function miniTrack(def) {
  const S = sample(def);
  const c = document.createElement('canvas');
  c.width = 220; c.height = 140; c.className = 'mini';
  const g = c.getContext('2d');
  const xs = S.pts.map((p) => p.x), zs = S.pts.map((p) => p.z);
  const mnx = Math.min(...xs), mxx = Math.max(...xs), mnz = Math.min(...zs), mxz = Math.max(...zs);
  const sc = Math.min(190 / (mxx - mnx), 110 / (mxz - mnz));
  const ox = (220 - (mxx - mnx) * sc) / 2, oz = (140 - (mxz - mnz) * sc) / 2;
  const draw = (w, col, filter) => {
    g.strokeStyle = col; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round';
    g.beginPath();
    S.pts.forEach((p, i) => { if (filter && !filter(p)) { g.moveTo((p.x - mnx) * sc + ox, (p.z - mnz) * sc + oz); return; } const x = (p.x - mnx) * sc + ox, y = (p.z - mnz) * sc + oz; i ? g.lineTo(x, y) : g.moveTo(x, y); });
    if (!filter) g.closePath();
    g.stroke();
  };
  draw(def.lanes * 3.4 + 6, '#20232b');
  draw(def.lanes * 3.4 + 2, '#5b606d');
  draw(def.lanes * 3.4 + 2, '#ff6b5b', (p) => p.y > 0.3);
  const p0 = S.pts[0];
  g.fillStyle = '#fff'; g.beginPath(); g.arc((p0.x - mnx) * sc + ox, (p0.z - mnz) * sc + oz, 4, 0, Math.PI * 2); g.fill();
  return c;
}
// ---- API de la comunidad (en Claude o en local se usa el servidor publicado) ----
const API = /turbo-slot\.[a-z0-9-]+\.workers\.dev$/.test(location.hostname) ? '' : 'https://turbo-slot.inautoit.workers.dev';
const playedCids = new Set();
const ON_WEB = API === '' || NATIVE;   // en la web del juego o en la app: el servidor es «el nuestro»
const SITE = 'https://turbo-slot.inautoit.workers.dev/';
class NetError extends Error {}
const netFail = () => { throw new NetError(ON_WEB ? 'No hay conexión con el servidor. Comprueba Internet e inténtalo otra vez.' : 'Desde aquí no se puede conectar con el servidor del juego.'); };
// Con sesión iniciada, cada petición lleva el token de la cuenta
const authHeaders = () => (acct ? { authorization: 'Bearer ' + acct.token } : {});
async function apiReq(method, path, data, { allow = [] } = {}) {
  const opt = { method, cache: 'no-store', headers: { ...authHeaders() } };
  if (data !== undefined) { opt.headers['content-type'] = 'application/json'; opt.body = JSON.stringify(data); }
  const r = await fetch(API + path, opt).catch(netFail);
  const j = await r.json().catch(() => ({}));
  if (!r.ok && !allow.includes(r.status)) { const e = new Error(j.error || 'Sin conexión'); e.status = r.status; throw e; }
  return j;
}
const apiGet = (path) => apiReq('GET', path);
const apiPost = (path, data) => apiReq('POST', path, data || {});
// ---- Cuenta de jugador: inicio de sesión y progreso sincronizado entre dispositivos ----
let acct = store.get('account', null);   // { token, name, rid }
let syncVer = store.get('syncVer', -1), syncTimer = null, syncBusy = false, syncAgain = false, syncState = 'idle', syncAt = 0;
function localProfile() {
  const keys = {};
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const full = localStorage.key(i);
      if (full && full.startsWith('slot.') && isSynced(full.slice(5))) keys[full.slice(5)] = store.get(full.slice(5));
    }
  } catch { /* sin almacenamiento */ }
  return { keys, statsBy: { ...store.get('statsBy', {}), [deviceId]: store.get('stats', { races: 0, wins: 0, crashes: 0, laps: 0 }) } };
}
function applyProfile(p) {
  try { for (const [k, v] of Object.entries(p.keys || {})) if (isSynced(k) && v !== undefined) localStorage.setItem('slot.' + k, JSON.stringify(v)); } catch { /* lleno */ }
  store.set('statsBy', p.statsBy || {});
  if (acct) { settings.pilot = acct.name; saveSettings(); }
  if (state === 'menu') { const pos = store.get('pos', {}); $('trophies').textContent = `${TRACKS.filter((t) => pos[t.id] === 1).length}/${TRACKS.length}`; }
}
function setSyncState(s) { syncState = s; if (s === 'ok') syncAt = Date.now(); renderAccountChip(); if ($('mAccount').classList.contains('open') && acctView === 'me') renderAccount(); }
// pull = traer primero lo del servidor (al entrar, al abrir el juego, al volver a la pestaña)
let resetting = false;   // mientras se borra el progreso no se sincroniza (si no, la nube lo devolvería)
async function syncNow(pull = false, prefer = 'local') {
  if (!acct || resetting) return;
  if (syncBusy) { syncAgain = true; return; }
  syncBusy = true; setSyncState('busy');
  try {
    let remote = null;
    if (pull || syncVer < 0) { remote = await apiGet('/api/profile'); applyProfile(mergeProfile(localProfile(), remote.data || {}, prefer)); syncVer = remote.ver; }
    for (let i = 0; i < 4; i++) {
      const r = await apiReq('PUT', '/api/profile', { data: fitProfile(localProfile(), 1400000), ver: syncVer }, { allow: [409] });
      if (r.ok) { syncVer = r.ver; break; }
      if (r.conflict) { applyProfile(mergeProfile(localProfile(), r.data || {}, 'local')); syncVer = r.ver; }
    }
    store.set('syncVer', syncVer);
    setSyncState('ok');
  } catch (e) {
    if (e.status === 401) { acct = null; store.set('account', null); syncHook = null; setSyncState('idle'); toast('Tu sesión ha caducado: vuelve a entrar en tu cuenta'); }
    else setSyncState('offline');
  }
  syncBusy = false;
  if (syncAgain) { syncAgain = false; scheduleSync(); }
}
function scheduleSync() { clearTimeout(syncTimer); syncTimer = setTimeout(() => syncNow(), 3000); }
function startAccount(a, fresh) {
  acct = a; store.set('account', a);
  syncHook = scheduleSync;
  settings.pilot = a.name; saveSettings();
  syncVer = -1;
  return syncNow(true, fresh ? 'remote' : 'local');
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && acct) syncNow(true); else if (acct && syncTimer) { clearTimeout(syncTimer); syncNow(); } });

// Botón de la cuenta (arriba en el menú) y ventana
function renderAccountChip() {
  const b = $('accBtn');
  b.querySelector('span').textContent = acct ? acct.name : 'Entrar';
  b.classList.toggle('on', !!acct);
  b.classList.toggle('warn', !!acct && syncState === 'offline');
}
let acctView = 'login';
function showAcct(view) {
  acctView = view;
  for (const v of ['login', 'register', 'recover', 'code', 'me', 'delete']) $('acc-' + v).hidden = v !== view;
  document.querySelectorAll('#accTabs button').forEach((b) => b.classList.toggle('on', b.dataset.v === view));
  $('accTabs').hidden = !['login', 'register'].includes(view);
  $('accMsg').textContent = '';
  if (view === 'me') renderAccount();
}
function renderAccount() {
  if (!acct) return;
  $('accName').textContent = acct.name;
  $('accSync').textContent = syncState === 'busy' ? 'Sincronizando…' : syncState === 'offline' ? 'Sin conexión: se sincronizará en cuanto vuelva Internet' : syncAt ? 'Todo guardado en tu cuenta' : 'Conectado';
  $('accSync').className = 'acc-sync ' + syncState;
  const best = store.get('best', {}), pos = store.get('pos', {});
  const s = { ...store.get('stats', { races: 0, laps: 0 }) };
  const o = otherStats(store.get('statsBy', {}), deviceId);
  $('accStats').textContent = `${Object.keys(best).length} récords · ${Object.values(pos).filter((p) => p === 1).length} victorias en circuitos · ${(+s.laps || 0) + o.laps} vueltas · ${myTracks().length} circuitos propios`;
}
$('accBtn').addEventListener('click', () => { initAudio(); sfx.click(); showAcct(acct ? 'me' : 'login'); openModal('mAccount'); });
document.querySelectorAll('#accTabs button').forEach((b) => b.addEventListener('click', () => { sfx.click(); showAcct(b.dataset.v); }));
$('accForgot').addEventListener('click', () => { sfx.click(); showAcct('recover'); });
$('accBackLogin').addEventListener('click', () => { sfx.click(); showAcct('login'); });
document.querySelectorAll('#mAccount input').forEach((i) => i.addEventListener('keydown', (e) => { e.stopPropagation(); if (e.key === 'Enter') { const f = i.closest('.acc-form'); if (f) f.querySelector('.btn.primary, .btn.danger').click(); } }));
async function accSubmit(btn, path, body, after) {
  const msg = $('accMsg');
  btn.disabled = true; msg.textContent = 'Un momento…';
  try {
    const j = await apiPost(path, body);
    msg.textContent = '';
    await after(j);
  } catch (e) { msg.textContent = e.message; }
  btn.disabled = false;
}
$('accLoginGo').addEventListener('click', (e) => accSubmit(e.currentTarget, '/api/auth/login', { name: $('accLU').value, password: $('accLP').value }, async (j) => {
  $('accLP').value = '';
  await startAccount({ token: j.token, name: j.user.name, rid: j.user.rid }, true);
  showAcct('me'); toast(`Hola, ${j.user.name}: tu progreso está sincronizado`);
}));
$('accRegGo').addEventListener('click', (e) => {
  if ($('accRP').value !== $('accRP2').value) { $('accMsg').textContent = 'Las contraseñas no coinciden'; return; }
  accSubmit(e.currentTarget, '/api/auth/register', { name: $('accRU').value, password: $('accRP').value }, async (j) => {
    $('accRP').value = ''; $('accRP2').value = '';
    // La cuenta nueva se queda con todo lo que ya tenías en este dispositivo
    await startAccount({ token: j.token, name: j.user.name, rid: j.user.rid }, false);
    $('accCode').textContent = j.recovery; showAcct('code');
  });
});
$('accRecGo').addEventListener('click', (e) => accSubmit(e.currentTarget, '/api/auth/recover', { name: $('accCU').value, recovery: $('accCC').value, password: $('accCP').value }, async (j) => {
  $('accCP').value = ''; $('accCC').value = '';
  await startAccount({ token: j.token, name: j.user.name, rid: j.user.rid }, true);
  $('accCode').textContent = j.recovery; showAcct('code');
}));
$('accCodeOk').addEventListener('click', () => { sfx.click(); showAcct('me'); });
$('accDelAsk').addEventListener('click', () => { sfx.click(); $('accDelP').value = ''; showAcct('delete'); });
$('accDelBack').addEventListener('click', () => { sfx.click(); showAcct('me'); });
$('accDelGo').addEventListener('click', (e) => accSubmit(e.currentTarget, '/api/auth/delete', { password: $('accDelP').value }, async () => {
  $('accDelP').value = '';
  clearTimeout(syncTimer);
  acct = null; store.set('account', null); syncHook = null; syncVer = -1; store.set('syncVer', -1);
  renderAccountChip(); showAcct('login'); toast('Cuenta borrada. Tus datos ya no están en el servidor');
}));
$('accLogout').addEventListener('click', async () => {
  sfx.click();
  if (syncTimer) { clearTimeout(syncTimer); await syncNow(); }
  apiPost('/api/auth/logout', {}).catch(() => {});
  acct = null; store.set('account', null); syncHook = null; syncVer = -1; store.set('syncVer', -1);
  renderAccountChip(); showAcct('login'); toast('Sesión cerrada. Tu progreso sigue guardado en la cuenta');
});
if (acct) { syncHook = scheduleSync; setTimeout(() => syncNow(true), 1500); }
renderAccountChip();

// Circuito de la comunidad → definición jugable
const commDef = (t) => ({ id: 'c_' + t.id, cid: t.id, name: t.name, author: t.author, lanes: t.lanes, laps: t.laps, scenery: t.scenery, pieces: t.pieces, community: t });
const myTracks = () => store.get('mytracks', []);
const saveMyTracks = (l) => store.set('mytracks', l);

let circTab = 'oficial', commSort = 'top', commCache = { top: null, new: null };
let pickForOnline = false;   // la lista de circuitos se usa para elegir el de la sala online
function circButton(def, lines, onClick) {
  const b = document.createElement('button');
  b.className = 'circ';
  try { b.appendChild(miniTrack(def)); } catch { /* circuito raro: sin miniatura */ }
  const info = document.createElement('div');
  info.className = 'ci';
  lines.forEach(([cls, text], i) => { const el = document.createElement(i === 0 ? 'b' : 'small'); if (cls) el.className = cls; el.textContent = text; info.appendChild(el); });
  b.appendChild(info);
  b.addEventListener('click', () => { sfx.click(); onClick(); });
  return b;
}
function chooseTrack(def) {
  selDef = def;
  if (pickForOnline) { pickForOnline = false; onlinePickTrack(def); return; }
  showGarage();
}
const lenTxt = (def) => `${(sample(def).length * SCALE).toFixed(1).replace('.', ',')} m`;
function showCircuits() {
  state = 'circuits';
  $('circTitle').textContent = pickForOnline ? 'Circuito de la sala' : mode === '2p' ? '2 Jugadores' : mode === 'practica' ? 'Práctica' : 'Carrera';
  document.querySelectorAll('#circTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === circTab));
  document.querySelectorAll('#commSort button').forEach((b) => b.classList.toggle('on', b.dataset.sort === commSort));
  $('commSort').hidden = circTab !== 'comunidad';
  $('circCreate').hidden = pickForOnline;
  const box = $('circList');
  box.innerHTML = '';
  const pos = store.get('pos', {}), best = store.get('best', {});
  const recTxt = (def) => {
    const medal = pos[def.id] ? `${pos[def.id]}º puesto · ` : '';
    const bi = best[`${def.id}|iman`], bp = best[`${def.id}|pro`];
    return `${medal}${bi ? 'Imán ' + fmt(bi) : ''}${bi && bp ? ' · ' : ''}${bp ? 'Sin imán ' + fmt(bp) : ''}${!bi && !bp ? 'Sin récord' : ''}`;
  };
  const empty = (t) => { const d = document.createElement('div'); d.className = 'circ-empty'; d.textContent = t; box.appendChild(d); };
  if (circTab === 'oficial') {
    TRACKS.forEach((def, i) => box.appendChild(circButton(def, [
      ['', `${i + 1}. ${def.name}`], ['', `${lenTxt(def)} · ${def.lanes} carriles · ${def.laps} vueltas`], ['rec', recTxt(def)],
    ], () => chooseTrack(def))));
  } else if (circTab === 'premium') {
    const head = document.createElement('div'); head.className = 'prem-head';
    head.innerHTML = '<b>Circuitos Premium</b><span></span><small>Exclusivos tipo maqueta. Cambian con cada temporada: ¡córrelos mientras estén!</small>';
    head.querySelector('span').textContent = PREMIUM_SEASON;
    box.appendChild(head);
    PREMIUM.forEach((def) => {
      const b = circButton(def, [
        ['', def.name], ['', `${lenTxt(def)} · ${def.lanes} carriles · ${def.laps} vueltas`], ['by', def.blurb], ['rec', recTxt(def)],
      ], () => chooseTrack(def));
      b.classList.add('premium');
      const tag = document.createElement('i'); tag.className = 'prem-tag'; tag.textContent = 'Premium'; b.appendChild(tag);
      box.appendChild(b);
    });
  } else if (circTab === 'comunidad') {
    const list = commCache[commSort];
    const render = (tracks) => {
      box.innerHTML = '';
      if (!tracks.length) { empty('Todavía no hay circuitos. ¡Crea el primero!'); return; }
      const hid = new Set(store.get('hiddenTracks', [])), blk = new Set(store.get('blocked', []));
      const shown = tracks.filter((t) => !hid.has(t.id) && !blk.has(String(t.author).toLowerCase()));
      if (!shown.length) { empty('No hay circuitos que mostrar.'); return; }
      for (const t of shown) {
        const def = commDef(t);
        const wrap = document.createElement('div'); wrap.className = 'circ-wrap';
        box.appendChild(wrap);
        let actEl = null;
        if (!pickForOnline) {
          const act = document.createElement('div'); act.className = 'circ-act'; actEl = act;
          const rep = document.createElement('button'); rep.className = 'rep'; rep.textContent = 'Denunciar';
          rep.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); openReport(t); });
          const hide = document.createElement('button'); hide.textContent = 'Ocultar';
          hide.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); hideTrack(t.id); toast('Circuito oculto. Puedes volver a mostrarlo en Ajustes'); showCircuits(); });
          act.append(rep, hide);
        }
        wrap.appendChild(circButton(def, [
          ['', t.name], ['by', `de ${t.author} · ${t.length.toFixed(1).replace('.', ',')} m · ${t.lanes} carriles`],
          ['', `${t.plays} partidas  ·  ${t.likes} me gusta${t.best_time ? `  ·  Récord ${fmt(t.best_time)} (${t.best_name || 'Anónimo'})` : ''}`],
          ['rec', recTxt(def)],
        ], () => chooseTrack(def)));
        if (actEl) wrap.appendChild(actEl);
      }
    };
    if (list) render(list);
    else empty('Cargando circuitos…');
    apiGet(`/api/tracks?sort=${commSort}`).then((j) => { commCache[commSort] = j.tracks; if (state === 'circuits' && circTab === 'comunidad') render(j.tracks); })
      .catch(() => { if (!list && circTab === 'comunidad') { box.innerHTML = ''; empty('No se puede conectar con la comunidad. Comprueba la conexión.'); } });
  } else {
    const mine = myTracks();
    if (!mine.length) empty('Aún no has creado circuitos. Pulsa «＋ Crear».');
    for (const d of mine) {
      const closed = closeDraft(d);
      const wrap = document.createElement('div'); wrap.className = 'circ-wrap';
      if (!closed.pieces && pickForOnline) continue;
      if (!closed.pieces) {
        // Sin terminar: se abre en el editor
        const b = document.createElement('button'); b.className = 'circ';
        const info = document.createElement('div'); info.className = 'ci';
        const nm = document.createElement('b'); nm.textContent = d.name || 'Sin nombre';
        const st = document.createElement('small'); st.textContent = `Sin terminar · ${d.pieces.length} piezas`;
        const hint = document.createElement('small'); hint.className = 'rec'; hint.textContent = 'Toca para seguir editándolo';
        info.append(nm, st, hint); b.appendChild(info);
        b.addEventListener('click', () => { sfx.click(); openEditor(d); });
        wrap.appendChild(b);
      } else {
        const def = draftDef(d, closed);
        wrap.appendChild(circButton(def, [
          ['', d.name || 'Sin nombre'], ['', `${lenTxt(def)} · ${d.lanes} carriles · ${d.laps} ${d.laps === 1 ? 'vuelta' : 'vueltas'}`],
          ['by', d.published ? 'Publicado' : 'Solo en este dispositivo'], ['rec', recTxt(def)],
        ], () => chooseTrack(def)));
      }
      if (!pickForOnline) {
        const act = document.createElement('div'); act.className = 'circ-act';
        const ed = document.createElement('button'); ed.textContent = 'Editar';
        ed.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); openEditor(d); });
        const del = document.createElement('button'); del.textContent = 'Borrar'; del.className = 'del';
        del.addEventListener('click', (e) => {
          e.stopPropagation();
          if (del.dataset.sure) { saveMyTracks(myTracks().filter((x) => x.lid !== d.lid)); showCircuits(); }
          else { del.dataset.sure = '1'; del.textContent = '¿Seguro?'; }
        });
        act.append(ed, del); wrap.appendChild(act);
      }
      box.appendChild(wrap);
    }
  }
  setScreen('circuits');
}
document.querySelectorAll('#circTabs button').forEach((b) => b.addEventListener('click', () => { sfx.click(); circTab = b.dataset.tab; showCircuits(); }));
document.querySelectorAll('#commSort button').forEach((b) => b.addEventListener('click', () => { sfx.click(); commSort = b.dataset.sort; showCircuits(); }));
$('circCreate').addEventListener('click', () => { sfx.click(); openEditor(null); });
$('circBack').addEventListener('click', () => { sfx.click(); if (pickForOnline) { pickForOnline = false; showOnline(); return; } showMenu(); });

// ---- Editor de circuitos ----
let draft = null;
function openEditor(d) {
  draft = d ? JSON.parse(JSON.stringify(d)) : newDraft();
  draft.lanes = 4;   // todos los circuitos son de 4 carriles
  showEditor();
}
function saveDraft() {
  draft.saved = true;
  const l = myTracks();
  const i = l.findIndex((x) => x.lid === draft.lid);
  if (i >= 0) l[i] = draft; else l.unshift(draft);
  saveMyTracks(l.slice(0, 40));
}
function showEditor() {
  state = 'editor';
  clearCars(); race = null;
  setScreen('editor');
  renderEditor();
}
function segButtons(box, items, cur, onPick) {
  box.innerHTML = '';
  for (const [id, label] of items) {
    const b = document.createElement('button');
    b.className = id === cur ? 'on' : '';
    b.textContent = label;
    b.addEventListener('click', () => { sfx.click(); onPick(id); });
    box.appendChild(b);
  }
}
function renderEditor() {
  if (!draft) return;
  if (draft.published && draft.pubKey && draftKey(draft) !== draft.pubKey) { draft.published = null; draft.pubKey = null; draft.lid = Math.random().toString(36).slice(2, 9); }
  if (draft.pieces.length > 1 && draft.saved) saveDraft();   // una vez guardado, se guarda solo con cada cambio
  const closed = closeDraft(draft);
  const info = $('edInfo');
  if (closed.pieces) {
    const def = draftDef(draft, closed);
    info.textContent = `${draft.name ? draft.name + ' · ' : ''}${draft.pieces.length} piezas · ${lenTxt(def)} · cerrado ✓`;
    info.className = 'subtitle good';
  } else {
    info.textContent = `${draft.name ? draft.name + ' · ' : ''}${draft.pieces.length} piezas · ${closed.error}`;
    info.className = 'subtitle bad';
  }
  $('edTest').disabled = $('edPublish').disabled = !closed.pieces;
  // ¿Ya llega a la meta? (el cierre no añade nada)
  const done = closed.pieces && closed.pieces.length === draft.pieces.length && JSON.stringify(closed.pieces) === JSON.stringify(draft.pieces);
  $('edFinish').disabled = !closed.pieces || done;
  $('edFinish').querySelector('.btn-main').textContent = done ? '✓ El circuito ya llega a la meta' : '✓ Completar hasta la meta';
  $('edFinish').querySelector('.btn-sub').textContent = done ? 'Ya puedes probarlo o publicarlo' : closed.pieces ? 'Pone las piezas azules por ti' : 'Así no se puede cerrar: cambia alguna pieza';
  $('edPublish').querySelector('.btn-main').textContent = draft.published ? 'Publicado ✓' : 'Publicar';
  if (draft.published) $('edPublish').disabled = true;
  PALETTE.forEach((it, i) => { const b = $('edPalette').children[i]; if (b) b.disabled = !!it.when && !it.when(draft); });
  segButtons($('edRadius'), RADII, draft.radius, (id) => { draft.radius = id; renderEditor(); });
  segButtons($('edScenery'), [['verde', 'Césped'], ['arena', 'Arena'], ['noche', 'Noche']], draft.scenery, (id) => { draft.scenery = id; renderEditor(); });
  $('edLaps').textContent = draft.laps;
  requestAnimationFrame(() => drawEditor($('edCanvas'), draft, closed));
}
// Paleta de piezas
for (const it of PALETTE) {
  const b = document.createElement('button');
  b.innerHTML = '<span></span><small></small>';
  b.firstChild.textContent = it.label; b.lastChild.textContent = it.sub;
  b.addEventListener('click', () => {
    if (!draft) return;
    if (draft.pieces.length >= 70) { toast('Máximo de piezas alcanzado'); return; }
    sfx.click();
    if (draft.published) draft = { ...draft, lid: Math.random().toString(36).slice(2, 9), published: null };
    draft.before = null;
    draft.pieces.push(it.make(radiusOf(draft)));
    renderEditor();
  });
  $('edPalette').appendChild(b);
}
$('edSave').addEventListener('click', () => {
  if (!draft) return;
  sfx.click();
  $('saveName').value = draft.name || '';
  openModal('mSave');
  setTimeout(() => $('saveName').focus(), 300);
});
$('saveGo').addEventListener('click', () => {
  const name = $('saveName').value.trim();
  draft.name = name || draft.name || `Mi circuito ${myTracks().length + 1}`;
  saveDraft();
  closeModal('mSave'); sfx.best(); toast('Guardado en «Mis circuitos»');
  renderEditor();
});
$('saveName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('saveGo').click(); });
$('edFinish').addEventListener('click', () => {
  const closed = closeDraft(draft);
  if (!closed.pieces) return;
  sfx.best();
  draft.before = draft.pieces.map((p) => p.slice());   // para poder deshacerlo de una vez
  draft.pieces = closed.pieces.map((p) => p.slice());
  renderEditor();
  toast('✓ Circuito cerrado hasta la meta');
});
$('edUndo').addEventListener('click', () => {
  if (!draft) return;
  sfx.click();
  if (draft.before) { draft.pieces = draft.before; draft.before = null; }
  else if (draft.pieces.length) draft.pieces.pop();
  renderEditor();
});
$('edClear').addEventListener('click', (e) => {
  const b = e.currentTarget;
  if (!b.dataset.sure) { b.dataset.sure = '1'; b.querySelector('.btn-main').textContent = '¿Seguro? Pulsa otra vez'; setTimeout(() => { delete b.dataset.sure; b.querySelector('.btn-main').textContent = 'Empezar de nuevo'; }, 2500); return; }
  delete b.dataset.sure; b.querySelector('.btn-main').textContent = 'Empezar de nuevo';
  sfx.click(); draft.pieces = [['S', 0.35 / SCALE]]; draft.published = null; renderEditor();
});
$('edLapsM').addEventListener('click', () => { draft.laps = Math.max(1, draft.laps - 1); sfx.click(); renderEditor(); });
$('edLapsP').addEventListener('click', () => { draft.laps = Math.min(20, draft.laps + 1); sfx.click(); renderEditor(); });
$('edBack').addEventListener('click', () => { sfx.click(); if (draft && draft.pieces.length > 1) saveDraft(); circTab = 'mios'; showCircuits(); demoRace(); });
$('edTest').addEventListener('click', () => {
  const closed = closeDraft(draft);
  if (!closed.pieces) return;
  sfx.click(); saveDraft();
  const def = draftDef(draft, closed);
  const raw = { ...DEFAULT_SETUP, ...store.get('setup0', {}) };
  const liv = LIVERIES.find((l) => l.id === store.get('liv0', 'rojo')) || LIVERIES[0];
  startRace({ def, mode: 'practica', entries: [{ liv, setupRaw: raw, carId: savedCar(0) }] });
  race.editorTest = true;
});
$('edPublish').addEventListener('click', () => {
  const closed = closeDraft(draft);
  if (!closed.pieces) return;
  sfx.click();
  $('pubName').value = draft.name || '';
  $('pubAuthor').value = settings.pilot || '';
  $('pubInfo').textContent = `${lenTxt(draftDef(draft, closed))} · ${draft.lanes} carriles · ${draft.laps} vueltas. Cualquiera podrá jugarlo; no se puede borrar después.`;
  $('pubMsg').textContent = '';
  $('pubGo').disabled = false;
  $('pubWeb').hidden = true;
  openModal('mPublish');
});
$('pubGo').addEventListener('click', async () => {
  const closed = closeDraft(draft);
  const name = $('pubName').value.trim(), author = $('pubAuthor').value.trim();
  if (name.length < 3) { $('pubMsg').textContent = 'Pon un nombre de al menos 3 letras'; return; }
  if (author.length < 2) { $('pubMsg').textContent = 'Pon tu nombre de piloto'; return; }
  if (!$('pubRules').checked) { $('pubMsg').textContent = 'Acepta las normas de la comunidad para publicar'; return; }
  $('pubGo').disabled = true; $('pubMsg').textContent = 'Publicando…';
  try {
    const r = await apiPost('/api/tracks', { name, author, lanes: draft.lanes, laps: draft.laps, scenery: draft.scenery, pieces: closed.pieces });
    draft.name = name; draft.published = r.id; draft.pubKey = draftKey(draft); settings.pilot = author; saveSettings(); saveDraft();
    commCache = { top: null, new: null };
    closeModal('mPublish'); sfx.best(); toast('¡Circuito publicado!');
    circTab = 'comunidad'; commSort = 'new'; showCircuits(); demoRace();
  } catch (e) {
    $('pubMsg').textContent = e.message; $('pubGo').disabled = false;
    // Sin conexión desde otra página (por ejemplo, dentro de Claude): llevar el circuito a la web
    if (e instanceof NetError && !ON_WEB) {
      draft.name = name; settings.pilot = author; saveSettings(); saveDraft();
      $('pubWeb').hidden = false;
    }
  }
});
// Abre la web del juego con este circuito ya cargado en el editor
$('pubWeb').addEventListener('click', () => {
  const data = { name: draft.name, lanes: draft.lanes, laps: draft.laps, scenery: draft.scenery, radius: draft.radius, pieces: draft.pieces };
  const enc = btoa(unescape(encodeURIComponent(JSON.stringify(data)))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  window.open(`${SITE}?circuito=${enc}`, '_blank', 'noopener');
});
// Clave del contenido: si cambias algo después de publicar, se publica como circuito nuevo
const draftKey = (d) => JSON.stringify([d.pieces, d.lanes, d.laps, d.scenery]);
addEventListener('resize', () => { if (state === 'editor') renderEditor(); });
$('playEditor').addEventListener('click', () => { initAudio(); sfx.click(); openEditor(null); });

// ---- Online: salas con amigos ----
let room = null;          // RoomClient
let roomState = null;     // último estado de la sala que mandó el servidor
let myId = null;
let myEntry = null;       // coche y reglaje para online
function onlineEntry() {
  if (!myEntry) {
    const raw = { ...DEFAULT_SETUP, ...store.get('setup0', {}) };
    const liv = LIVERIES.find((l) => l.id === store.get('liv0', 'rojo')) || LIVERIES[0];
    myEntry = { liv, setupRaw: raw, carId: savedCar(0) };
  }
  return myEntry;
}
function roomDef(tr) {
  if (!tr) return null;
  if (tr.kind === 'oficial') return findTrack(tr.id);
  if (!tr.def) return null;
  return { id: 'c_' + (tr.id || 'sala'), cid: /^[a-z0-9]{7}$/.test(tr.id) ? tr.id : null, name: tr.name, lanes: tr.lanes, laps: tr.laps, scenery: tr.def.scenery, pieces: tr.def.pieces };
}
function showOnline() {
  state = 'online';
  mode = 'online';
  setScreen('online');
  $('onName').value = settings.pilot || '';
  renderLobby();
}
function onMsg(text) { $('onMsg').textContent = text || ''; }
function connectRoom(code, quick = false) {
  const name = $('onName').value.trim() || settings.pilot || 'Piloto';
  settings.pilot = name; saveSettings();
  if (room) room.close();
  roomState = null; myId = null;
  onMsg('Conectando…');
  room = new RoomClient(API, code, {
    open: () => { const e = onlineEntry(); room.send({ t: 'join', name, liv: e.liv.id, cls: classOf(e.setupRaw), car: e.carId, quick }); },
    close: (why) => { room = null; roomState = null; if (state === 'online') { renderLobby(); onMsg(why); } else toast('' + why); },
    message: onRoomMessage,
  });
  room.codeShown = code;
}
function onRoomMessage(m) {
  if (m.t === 'welcome') { myId = m.id; onMsg(''); return; }
  if (m.t === 'error') { if (!myId) { room && room.close(); room = null; renderLobby(); onMsg(m.msg); } else { $('onLobbyMsg').textContent = m.msg; toast(m.msg); } return; }
  if (m.t === 'room') {
    const was = roomState;
    roomState = m;
    if (m.phase === 'race' && (!was || was.phase !== 'race') && myId) startOnlineRace(m);
    if (m.phase === 'lobby' && race && race.mode === 'online' && state !== 'results' && state !== 'online') {
      // El anfitrión ha cerrado la carrera
      if (state === 'race' || state === 'countdown' || state === 'pause') endRace();
    }
    if (state === 'online') renderLobby();
    if (state === 'results' && race && race.mode === 'online' && m.phase === 'lobby' && m.champ) renderOnlineChamp($('resChamp'), m.champ);
    return;
  }
  if (!race || race.mode !== 'online') return;
  const c = cars.find((x) => x.remote === m.id);
  if (m.t === 'st' && c) {
    c.net.push({ at: performance.now(), s: m.s, v: m.v, th: m.th, lap: m.lap, out: m.out });
    if (c.net.length > 40) c.net.shift();
  } else if (m.t === 'fin' && c) {
    c.finished = true; c.finishTime = m.time; c.best = m.best || c.best;
    c.lap = race.laps;
    if (m.time < 9000) flashText(0, `${c.name} termina`);
    if (state === 'results') endRace();
  } else if (m.t === 'lap' && c) {
    c.laps.push(m.time); c.last = m.time; if (m.time < c.best) c.best = m.time;
  } else if (m.t === 'left' && c) {
    c.finished = true; c.finishTime = 9999; c.mesh.visible = false;
  }
}
function renderOnlineChamp(box, champ) {
  box.innerHTML = '';
  if (!champ) { box.hidden = true; return; }
  box.hidden = false;
  const h = document.createElement('h4');
  const rows = Object.entries(champ.pts).sort((a, b) => b[1].pts - a[1].pts);
  h.textContent = champ.final ? `${champ.name} · final${rows[0] ? ': gana ' + rows[0][1].name : ''}` : `${champ.name} · carrera ${champ.idx + 1} de ${champ.tracks.length}`;
  box.appendChild(h);
  rows.forEach(([id, e], i) => {
    const row = document.createElement('div'); row.className = 'row' + (id === myId ? ' me' : '');
    const pos = document.createElement('b'); pos.textContent = `${i + 1}º`;
    const dot = document.createElement('i'); const liv = LIVERIES.find((l) => l.id === e.liv); dot.style.background = liv ? '#' + liv.color.toString(16).padStart(6, '0') : '#888';
    const nm = document.createElement('span'); nm.textContent = e.name;
    const add = document.createElement('span'); add.className = 'add'; add.textContent = e.last ? `+${e.last}` : '';
    const tot = document.createElement('span'); tot.className = 'tot'; tot.textContent = e.pts;
    row.append(pos, dot, nm, add, tot); box.appendChild(row);
  });
}
let lobbyTimer = null;
function renderLobby() {
  clearInterval(lobbyTimer);
  const inRoom = !!(room && roomState && myId);
  $('onJoin').hidden = inRoom;
  $('onLobby').hidden = !inRoom;
  $('onTitle').textContent = inRoom ? 'Sala online' : 'Online';
  $('onSub').textContent = inRoom ? 'Hasta 4 pilotos · uno por carril' : 'Juega con amigos en tiempo real';
  if (!inRoom) return;
  const rs = roomState, me = rs.players.find((p) => p.id === myId);
  const host = !!(me && me.host);
  $('onRoom').textContent = room.codeShown;
  const def = roomDef(rs.track);
  const lanes = def ? def.lanes : 4;
  const box = $('onPlayers');
  box.innerHTML = '';
  for (let l = 0; l < lanes; l++) {
    const p = rs.players.find((x) => x.lane === l);
    const row = document.createElement('div');
    row.className = 'on-p' + (p ? '' : ' empty');
    const dot = document.createElement('i');
    const liv = p && LIVERIES.find((x) => x.id === p.liv);
    dot.style.background = liv ? '#' + liv.color.toString(16).padStart(6, '0') : 'rgba(255,255,255,0.15)';
    const nm = document.createElement('b'); nm.textContent = p ? p.name + (p.id === myId ? ' (tú)' : '') : rs.cpu ? 'CPU (si no entra nadie)' : 'Libre';
    const sm = document.createElement('small'); sm.textContent = `Carril ${l + 1}${p ? ' · ' + CLASS_NAME[p.cls] : ''}`;
    const st = document.createElement('span'); st.className = 'st' + (p && (p.ready || p.host) ? ' ok' : '');
    st.textContent = !p ? '' : p.host ? 'Anfitrión' : p.ready ? '✓ Listo' : 'Esperando';
    row.append(dot, nm, sm, st);
    box.appendChild(row);
  }
  const extra = rs.players.filter((p) => p.lane >= lanes).length;
  const mini = $('onTrackMini'); mini.innerHTML = '';
  if (def) { try { mini.appendChild(miniTrack(def)); } catch { /* sin miniatura */ } }
  $('onTrackName').textContent = def ? def.name : 'Sin circuito';
  $('onTrackMeta').textContent = def ? `${lenTxt(def)} · ${def.lanes} carriles · ${rs.track.laps} ${rs.track.laps === 1 ? 'vuelta' : 'vueltas'}` : (host ? 'Elige un circuito para la carrera' : 'El anfitrión elegirá el circuito');
  $('onPickTrack').hidden = !host || rs.quick || !!rs.champ;
  // Modo (carrera suelta o copa) y CPU: solo el anfitrión, y no en partida rápida
  $('onModeRow').hidden = !host || rs.quick;
  $('onCpuRow').hidden = !host || rs.quick;
  $('onCpu').checked = !!rs.cpu;
  segButtons($('onMode'), [['race', 'Carrera'], ['club', 'Copa Club'], ['gp', 'Copa GP']], rs.champ && !rs.champ.final ? rs.champ.cup : 'race', (id) => {
    room.send({ t: 'champ', cup: id === 'race' ? null : id, laps: rs.track ? rs.track.laps : 3 });
    if (id === 'race' && !rs.track) { pickForOnline = true; showCircuits(); }
  });
  renderOnlineChamp($('onChamp'), rs.champ);
  $('onLapsRow').hidden = !host || !def || rs.quick;
  if (def) $('onLaps').textContent = rs.track.laps;
  const rb = $('onReady');
  if (rs.quick) {
    rb.hidden = true;
    const tick = () => {
      if (!roomState || roomState.phase !== 'lobby') return;
      const left = Math.max(0, Math.ceil((roomState.autoAt - room.serverNow()) / 1000));
      const free = (def ? def.lanes : 4) - roomState.players.length;
      $('onLobbyMsg').textContent = roomState.autoAt ? `Buscando pilotos… la carrera empieza en ${left} s${free > 0 ? ` · ${free} ${free === 1 ? 'hueco' : 'huecos'} con la CPU` : ''}` : 'Preparando la carrera…';
    };
    tick(); lobbyTimer = setInterval(tick, 500);
    $('onTitle').textContent = 'Partida rápida';
    return;
  }
  rb.hidden = false;
  if (host) {
    const others = rs.players.filter((p) => !p.host);
    const allReady = others.every((p) => p.ready);
    rb.querySelector('.btn-main').textContent = '¡Empezar carrera!';
    rb.disabled = !def || !allReady || extra > 0 || !!(rs.champ && rs.champ.final);
    rb.className = 'btn primary';
    $('onLobbyMsg').textContent = !def ? 'Elige un circuito.' : extra ? 'Hay más pilotos que carriles: elige un circuito de 4 carriles.' : !allReady ? 'Esperando a que todos estén listos…' : rs.players.length === 1 ? 'Estás solo: invita a tus amigos con el código o empieza igualmente.' : '¡Todos listos!';
  } else {
    rb.disabled = false;
    rb.querySelector('.btn-main').textContent = me && me.ready ? '✓ Listo (quitar)' : 'Estoy listo';
    rb.className = 'btn ' + (me && me.ready ? 'on-ready' : 'primary');
    $('onLobbyMsg').textContent = 'El anfitrión empieza la carrera cuando todos estén listos.';
  }
}
function startOnlineRace(rs) {
  const def = roomDef(rs.track);
  if (!def) return;
  const me = rs.players.find((p) => p.id === myId);
  if (!me) return;
  closeModal('mResults'); closeModal('mPause');
  selDef = def;
  // El color que me ha dado la sala (si el mío lo tenía otro)
  const liv = LIVERIES.find((l) => l.id === me.liv);
  if (liv) onlineEntry().liv = liv;
  startRace({ def, mode: 'online', entries: [onlineEntry()], online: { lane: me.lane, players: rs.players, bots: rs.bots || [], amHost: !!me.host, me: myId, startAt: rs.startAt, laps: rs.track.laps } });
}
let sendT = 0;
function onlineTick() {
  // Mientras no hay salida, se ajusta el semáforo al reloj del servidor
  if (!race.started && race.online && room) race.goT = race.simT + (race.online.startAt - room.serverNow()) / 1000;
  const now = performance.now();
  if (now - sendT < 50 || !room) return;
  sendT = now;
  for (const c of cars) {
    if (!c.human && !c.botId) continue;
    room.send({ t: 'st', s: +c.st.s.toFixed(4), v: +c.st.v.toFixed(3), th: +c.st.th.toFixed(3), lap: c.lap, out: !!c.crash, ...(c.botId ? { bot: c.botId } : {}) });
  }
}
function updateRemote(c) {
  const r = sampleRemote(c.net, performance.now() - NET_DELAY, T.L);
  if (!r) return;
  if (r.out && !c.crash) { crashCar(c); return; }
  if (c.crash) return;
  if (c.finished) { c.st.v = Math.max(0, c.st.v - 0.02); return; }
  c.lap = r.lap; c.st.s = r.s; c.st.v = r.v; c.st.th = r.th;
}
function sendRoomTrack(def, laps) {
  const kind = TRACKS.includes(def) || PREMIUM.includes(def) ? 'oficial' : 'comunidad';
  room.send({ t: 'track', track: { kind, id: kind === 'oficial' ? def.id : (def.cid || def.id), name: def.name, lanes: def.lanes, laps, def: kind === 'oficial' ? undefined : { pieces: def.pieces, scenery: def.scenery } } });
}
function onlinePickTrack(def) {
  if (!room) { showOnline(); return; }
  sendRoomTrack(def, def.laps);
  showOnline();
}
for (const [id, d] of [['onLapsM', -1], ['onLapsP', 1]]) {
  $(id).addEventListener('click', () => {
    const def = roomState && roomDef(roomState.track);
    if (!def || !room) return;
    sfx.click();
    room.send({ t: 'laps', laps: Math.max(1, Math.min(20, roomState.track.laps + d)) });
  });
}
function onlineCarChosen(entry) {
  myEntry = entry;
  room && room.send({ t: 'me', liv: entry.liv.id, cls: classOf(entry.setupRaw), car: entry.carId });
  showOnline();
}
$('playOnline').addEventListener('click', () => { initAudio(); sfx.click(); showOnline(); });
$('onBack').addEventListener('click', () => {
  sfx.click();
  if (room && roomState) { room.close(); room = null; roomState = null; renderLobby(); return; }
  showMenu();
});
$('onCpu').addEventListener('change', (e) => { if (room) room.send({ t: 'cpu', v: e.target.checked }); });
$('onQuick').addEventListener('click', async () => {
  sfx.click();
  if (!$('onName').value.trim()) { onMsg('Pon tu nombre de piloto'); $('onName').focus(); return; }
  onMsg('Buscando partida…');
  try { const r = await apiPost('/api/quick'); connectRoom(r.code, true); } catch (e) { onMsg(e.message); }
});
$('onCreate').addEventListener('click', async () => {
  sfx.click();
  if (!$('onName').value.trim()) { onMsg('Pon tu nombre de piloto'); $('onName').focus(); return; }
  onMsg('Creando sala…');
  try { const r = await apiPost('/api/room/new'); connectRoom(r.code); } catch (e) { onMsg(e.message); }
});
$('onEnter').addEventListener('click', () => {
  sfx.click();
  const code = $('onCode').value.trim().toUpperCase();
  if (!/^[A-Z]{4}$/.test(code)) { onMsg('El código tiene 4 letras'); return; }
  if (!$('onName').value.trim()) { onMsg('Pon tu nombre de piloto'); $('onName').focus(); return; }
  connectRoom(code);
});
$('onCode').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('onEnter').click(); });
$('onPickTrack').addEventListener('click', () => { sfx.click(); pickForOnline = true; showCircuits(); });
$('onCar').addEventListener('click', () => {
  sfx.click();
  selDef = roomDef(roomState && roomState.track) || TRACKS[0];
  mode = 'online';
  state = 'garage'; entries = []; editing = { liv: onlineEntry().liv, setupRaw: { ...onlineEntry().setupRaw }, carId: onlineEntry().carId };
  renderGarage(); setScreen('garage');
});
$('onReady').addEventListener('click', () => {
  if (!room || !roomState) return;
  sfx.click();
  const me = roomState.players.find((p) => p.id === myId);
  if (me && me.host) room.send({ t: 'start' });
  else room.send({ t: 'ready', v: !(me && me.ready) });
});
$('onShare').addEventListener('click', async () => {
  const code = room && room.codeShown;
  if (!code) return;
  const url = `https://turbo-slot.inautoit.workers.dev/?sala=${code}`;
  const text = `¡Únete a mi carrera de Turbo Slot! Sala ${code}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Turbo Slot', text, url });
    else { await navigator.clipboard.writeText(`${text}: ${url}`); toast('Enlace copiado'); }
  } catch { /* cancelado */ }
});

// ---- Campeonatos ----
const CUPS = [
  { id: 'club', name: 'Copa Club', sub: 'Circuitos cortos y rápidos', tracks: ['ovalo', 'rinon', 'horquilla', 'chicane'] },
  { id: 'gp', name: 'Copa Grand Prix', sub: 'Circuitos largos de 4 carriles', tracks: ['gp', 'internacional', 'montana', 'autodromo'] },
  { id: 'gran', name: 'Gran Campeonato', sub: 'Los 10 circuitos oficiales', tracks: TRACKS.map((t) => t.id) },
  { id: 'comunidad', name: 'Copa Comunidad', sub: 'Los 4 circuitos más jugados de la comunidad', community: true },
];
const CHAMP_PTS = [10, 6, 4, 3];
let champ = null;          // { cup, defs, idx, pts, entries, players, history }
let champPlayers = 1;
function showChamp() {
  state = 'champ';
  setScreen('champ');
  segButtons($('chPlayers'), [[1, '1 piloto'], [2, '2 pilotos']], champPlayers, (n) => { champPlayers = n; showChamp(); });
  const box = $('chList'); box.innerHTML = '';
  const best = store.get('cups', {});
  for (const cup of CUPS) {
    const b = document.createElement('button'); b.className = 'cup';
    const nm = document.createElement('b'); nm.textContent = cup.name;
    const sub = document.createElement('small'); sub.textContent = cup.community ? cup.sub : `${cup.sub} · ${cup.tracks.length} carreras`;
    const minis = document.createElement('div'); minis.className = 'minis';
    if (!cup.community) for (const id of cup.tracks.slice(0, 5)) { try { minis.appendChild(miniTrack(TRACKS.find((t) => t.id === id))); } catch { /* nada */ } }
    const rec = document.createElement('small'); rec.className = 'rec';
    const r = best[`${cup.id}|${champPlayers}`];
    rec.textContent = r ? (r === 1 ? 'Campeón' : `Mejor resultado: ${r}º`) : 'Sin jugar';
    b.append(nm, sub, minis, rec);
    b.addEventListener('click', () => { sfx.click(); startCup(cup); });
    box.appendChild(b);
  }
}
async function startCup(cup) {
  let defs;
  if (cup.community) {
    try { defs = (await apiGet('/api/tracks?sort=top')).tracks.slice(0, 4).map(commDef); } catch (e) { toast(e.message); return; }
    if (defs.length < 2) { toast('Aún no hay bastantes circuitos en la comunidad'); return; }
  } else defs = cup.tracks.map((id) => TRACKS.find((t) => t.id === id));
  champ = { cup, defs, idx: 0, pts: {}, players: champPlayers, entries: null, last: {} };
  mode = champPlayers === 2 ? '2p' : '1p';
  selDef = defs[0];
  showGarage();
}
function startChampRace() {
  const def = champ.defs[champ.idx];
  selDef = def;
  startRace({ def, mode: champ.players === 2 ? '2p' : '1p', entries: champ.entries, laps: Math.min(def.laps, 5) });
  race.champ = champ;
}
function champAfterRace(order) {
  if (race.champDone) return;
  race.champDone = true;
  const last = {};
  order.forEach((c, i) => { last[c.name] = (c.finished ? CHAMP_PTS[i] || 0 : 0); });
  const fast = cars.filter((c) => Number.isFinite(c.best)).sort((a, b) => a.best - b.best)[0];
  if (fast) last[fast.name] = (last[fast.name] || 0) + 1;
  for (const c of cars) { champ.pts[c.name] = (champ.pts[c.name] || 0) + (last[c.name] || 0); champ.last[c.name] = { liv: c.liv, human: c.human }; }
  const table = Object.keys(champ.pts).sort((a, b) => champ.pts[b] - champ.pts[a]);
  const box = $('resChamp'); box.innerHTML = ''; box.hidden = false;
  const done = champ.idx >= champ.defs.length - 1;
  const h = document.createElement('h4'); h.textContent = done ? `${champ.cup.name} · clasificación final` : `${champ.cup.name} · carrera ${champ.idx + 1} de ${champ.defs.length}`;
  box.appendChild(h);
  table.forEach((name, i) => {
    const info = champ.last[name];
    const row = document.createElement('div'); row.className = 'row' + (info.human ? ' me' : '');
    const pos = document.createElement('b'); pos.textContent = `${i + 1}º`;
    const dot = document.createElement('i'); dot.style.background = '#' + info.liv.color.toString(16).padStart(6, '0');
    const nm = document.createElement('span'); nm.textContent = name + (fast && fast.name === name ? ' · v. rápida' : '');
    const add = document.createElement('span'); add.className = 'add'; add.textContent = last[name] ? `+${last[name]}` : '';
    const tot = document.createElement('span'); tot.className = 'tot'; tot.textContent = champ.pts[name];
    row.append(pos, dot, nm, add, tot); box.appendChild(row);
  });
  $('againBtn').hidden = true;
  $('resMenuBtn').querySelector('.btn-main').textContent = done ? 'Volver a las copas' : 'Abandonar';
  if (done) {
    $('nextBtn').hidden = true;
    const meName = cars.find((c) => c.human && c.player === 0).name;
    const myCup = table.indexOf(meName) + 1;
    $('resTitle').textContent = champ.players === 2
      ? `¡${table.find((n) => champ.last[n].human)} gana la copa!`
      : myCup === 1 ? '¡Campeón!' : `${myCup}º en la copa`;
    const best = store.get('cups', {}), key = `${champ.cup.id}|${champ.players}`;
    if (!best[key] || myCup < best[key]) { best[key] = myCup; store.set('cups', best); }
    if (myCup === 1) sfx.finish();
    const prize = [400, 200, 100][myCup - 1] || 0;
    if (prize) addCoins(prize);
  } else {
    $('nextBtn').hidden = false;
    $('nextBtn').querySelector('.btn-main').textContent = `Siguiente: ${champ.defs[champ.idx + 1].name} ›`;
  }
}
$('playChamp').addEventListener('click', () => { initAudio(); sfx.click(); showChamp(); });
$('chBack').addEventListener('click', () => { sfx.click(); champ = null; showMenu(); });

// ---- Clasificación mundial (vueltas comprobadas por el servidor) y fantasma del récord ----
const rankId = () => (acct ? acct.rid : deviceId);   // con cuenta, los tiempos van a la cuenta
const deviceId = (() => { let d = store.get('device', null); if (!d) { d = Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join(''); store.set('device', d); } return d; })();
function rankKeyOf(def) {
  if (TRACKS.includes(def) || PREMIUM.includes(def)) return 'o:' + def.id;
  if (def.cid) return 'c:' + def.cid;
  return null;
}
let wrGhost = null;   // { race, mesh, s, d, name, time }
function loadWorldRecord(r) {
  const key = r.rankKey, cls = r.cls;
  r.wr = null;
  apiGet(`/api/laps?track=${encodeURIComponent(key)}&cls=${cls}&device=${rankId()}`).then((j) => {
    if (race !== r) return;
    r.wr = j.laps.find((l) => l.me || !isBlocked(l.name)) || null; r.wrMine = j.mine; r.wrTotal = j.total;
    if (r.wr) flashText(0, `Récord mundial: ${fmt(r.wr.time)} · ${r.wr.name}`);
    updateHud(true);
  }).catch(() => {});
  // El fantasma: se repite la vuelta del récord con la misma física
  apiGet(`/api/laps/ghost?track=${encodeURIComponent(key)}&cls=${cls}`).then((j) => {
    if (race !== r || !j.ghost || isBlocked(j.ghost.name)) return;
    const g = j.ghost;
    const res = replay({ def: r.def, track: physTrack, lane: g.lane, setupRaw: g.setup, s0: g.s0, t0: g.t0, goT: g.goT, inputs: g.inputs }, g.lap);
    if (!res.ghost || !res.ghost.length || race !== r) return;
    if (wrGhost && wrGhost.mesh.parent) carsGroup.remove(wrGhost.mesh);
    const liv = LIVERIES.find((l) => l.id === g.liv) || LIVERIES[3];
    const mesh = makeCarMesh(liv, 'gold', validCar(g.car));
    mesh.visible = false;
    carsGroup.add(mesh);
    wrGhost = { race: r, mesh, s: res.ghost, d: res.d, name: g.name, time: g.time };
  }).catch(() => {});
}
function submitLap(c, lt) {
  const key = race.rankKey, cls = race.cls;
  const bestKey = `wrsent.${key}|${cls}`;
  const sent = store.get(bestKey, Infinity);
  if (!(lt < sent)) return;
  const body = {
    track: key, lane: c.lane, setup: c.setupRaw, car: c.carId, liv: c.liv.id, name: settings.pilot || 'Piloto', device: deviceId,
    s0: c.vlog.s0, t0: c.vlog.t0, goT: race.goT, inputs: c.vlog.inputs.slice(), lap: c.vlog.cross - 1, time: lt,
  };
  const r = race;
  apiPost('/api/laps', body).then((j) => {
    store.set(bestKey, j.best);
    if (race !== r) return;
    r.wrMine = { time: j.best, pos: j.pos };
    if (j.wr) r.wr = { ...(r.wr || {}), name: j.wr.name, time: j.wr.time };
    if (j.improved && j.pos === 1) { sfx.finish(); flashText(0, '¡Récord mundial!'); toast('Vuelta comprobada: ¡récord mundial!'); }
    else if (j.improved) toast(`Vuelta comprobada · ${j.pos}º del mundo`);
    updateHud(true);
  }).catch((e) => { if (race === r) toast(`Ranking: ${e.message}`); });
}
// ---- App nativa: barra de estado oculta, enlaces legales en Safari y actualizaciones al momento ----
const cmpVer = (a, b) => { const x = String(a).split('.').map(Number), y = String(b).split('.').map(Number); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); } return 0; };
async function liveUpdate() {
  const U = plugin('CapacitorUpdater');
  if (!U) return;
  try { await U.notifyAppReady(); } catch { /* sin plugin */ }
  try {
    const info = await apiGet('/api/app');
    if (!info || !info.version || cmpVer(info.version, GAME_VERSION) <= 0) return;
    const cur = await U.current().catch(() => null);
    if (info.minNative && cur && cur.native && cmpVer(cur.native, info.minNative) < 0) return;   // hace falta la app nueva de la App Store
    const b = await U.download({ url: info.url, version: info.version, checksum: info.sha256 });
    await U.next({ id: b.id });
    toast('Hay una versión nueva del juego: se pondrá la próxima vez que lo abras');
  } catch { /* sin conexión o descarga fallida: se intenta en otra ocasión */ }
}
if (NATIVE) {
  document.documentElement.classList.add('native');
  const SB = plugin('StatusBar'); if (SB) SB.hide().catch(() => {});
  // Las páginas de privacidad y normas se abren en Safari (si no, la app se iría de la pantalla del juego)
  document.querySelectorAll('a[href$=".html"]').forEach((a) => { a.href = SITE + a.getAttribute('href'); a.target = '_blank'; });
  setTimeout(liveUpdate, 4000);
}
$('verTxt').textContent = `Turbo Slot ${GAME_VERSION}${NATIVE ? ' · app' : ''}`;

// ---- Temporada Premium: la manda el servidor (y se guarda para jugar sin conexión) ----
setPremium(store.get('premiumCfg', null));
apiGet('/api/premium').then((cfg) => { if (setPremium(cfg)) { store.set('premiumCfg', cfg); if (state === 'circuits' && circTab === 'premium') showCircuits(); } }).catch(() => {});

// ---- Moderación: denunciar y ocultar (lo que oculta cada jugador viaja con su cuenta) ----
const isBlocked = (name) => store.get('blocked', []).includes(String(name || '').toLowerCase());
function hideTrack(id) { const l = store.get('hiddenTracks', []); if (!l.includes(id)) { l.push(id); store.set('hiddenTracks', l.slice(-500)); } }
function blockName(name) { const n = String(name || '').toLowerCase(); const l = store.get('blocked', []); if (n && !l.includes(n)) { l.push(n); store.set('blocked', l.slice(-500)); } }
let reportT = null;
function openReport(t) {
  reportT = t;
  $('repName').textContent = `«${t.name}» de ${t.author}`;
  $('repAuthor').textContent = t.author;
  $('repMsg').textContent = '';
  document.querySelectorAll('#mReport .rep-reasons .btn').forEach((b) => { b.disabled = false; });
  openModal('mReport');
}
document.querySelectorAll('#mReport .rep-reasons .btn').forEach((b) => b.addEventListener('click', async () => {
  if (!reportT) return;
  sfx.click();
  document.querySelectorAll('#mReport .rep-reasons .btn').forEach((x) => { x.disabled = true; });
  hideTrack(reportT.id);
  try { await apiPost(`/api/tracks/${reportT.id}/report`, { reason: b.dataset.reason }); $('repMsg').textContent = 'Gracias: denuncia enviada y circuito oculto.'; }
  catch (e) { $('repMsg').textContent = `Circuito oculto. No se pudo enviar la denuncia: ${e.message}`; }
  setTimeout(() => { closeModal('mReport'); if (state === 'circuits') showCircuits(); }, 1100);
}));
$('repBlock').addEventListener('click', () => {
  if (!reportT) return;
  sfx.click(); blockName(reportT.author); hideTrack(reportT.id);
  closeModal('mReport'); toast(`No verás nada más de ${reportT.author}`);
  if (state === 'circuits') showCircuits();
});
$('openFeedback').addEventListener('click', () => { sfx.click(); $('fbMsgOut').textContent = ''; openModal('mFeedback'); });
$('fbMsg').addEventListener('keydown', (e) => e.stopPropagation());
$('fbGo').addEventListener('click', async () => {
  const msg = $('fbMsg').value.trim();
  if (msg.length < 5) { $('fbMsgOut').textContent = 'Escribe un poco más, por favor'; return; }
  sfx.click(); $('fbGo').disabled = true; $('fbMsgOut').textContent = 'Enviando…';
  try { await apiPost('/api/feedback', { msg, contact: $('fbContact').value.trim() }); $('fbMsg').value = ''; $('fbMsgOut').textContent = '¡Gracias! Mensaje enviado.'; }
  catch (e) { $('fbMsgOut').textContent = e.message; }
  $('fbGo').disabled = false;
});
$('unhideBtn').addEventListener('click', () => { sfx.click(); store.set('hiddenTracks', []); store.set('blocked', []); fillSettings(); toast('Vuelves a verlo todo'); });

// Pantalla del ranking de un circuito
let rankDef = null, rankCls = 'iman';
function openRanking(def) {
  rankDef = def;
  const key = rankKeyOf(def);
  $('rkTitle').textContent = `Ranking mundial · ${def.name}`;
  document.querySelectorAll('#rkTabs button').forEach((b) => b.classList.toggle('on', b.dataset.cls === rankCls));
  const box = $('rkList'); box.innerHTML = '<div class="circ-empty">Cargando…</div>';
  $('rkMine').textContent = '';
  openModal('mRank');
  if (!key) { box.innerHTML = '<div class="circ-empty">Este circuito todavía no está publicado: publícalo para tener ranking.</div>'; return; }
  apiGet(`/api/laps?track=${encodeURIComponent(key)}&cls=${rankCls}&device=${rankId()}`).then((j) => {
    box.innerHTML = '';
    if (!j.laps.length) { box.innerHTML = '<div class="circ-empty">Nadie tiene tiempo todavía. ¡Sé el primero en Práctica!</div>'; return; }
    j.laps.map((l, k) => ({ ...l, pos: k + 1 })).filter((l) => l.me || !isBlocked(l.name)).slice(0, 30).forEach((l) => {
      const row = document.createElement('div'); row.className = 'rk-row' + (l.me ? ' me' : '');
      if (!l.me) row.addEventListener('click', () => {
        if (row.querySelector('.rk-hide')) return;
        const hb = document.createElement('button'); hb.className = 'rk-hide'; hb.textContent = `Ocultar a ${l.name}`;
        hb.addEventListener('click', (e) => { e.stopPropagation(); sfx.click(); blockName(l.name); toast(`No verás más a ${l.name}`); openRanking(rankDef); });
        row.appendChild(hb);
      });
      const pos = document.createElement('b'); pos.textContent = `${l.pos}º`;   // la posición real, aunque haya pilotos ocultos
      const dot = document.createElement('i'); const lv = LIVERIES.find((x) => x.id === l.liv); dot.style.background = lv ? '#' + lv.color.toString(16).padStart(6, '0') : '#888';
      const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = l.name;
      const car = document.createElement('small'); car.textContent = (CARS.find((x) => x.id === l.car) || {}).name || '';
      const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = fmt(l.time);
      row.append(pos, dot, nm, car, tm); box.appendChild(row);
    });
    $('rkMine').textContent = j.mine ? `Tu mejor vuelta: ${fmt(j.mine.time)} · ${j.mine.pos}º de ${j.total}` : `${j.total} ${j.total === 1 ? "piloto" : "pilotos"} en el ranking. Haz una vuelta en Práctica para entrar.`;
  }).catch((e) => { box.innerHTML = ''; const d = document.createElement('div'); d.className = 'circ-empty'; d.textContent = e.message; box.appendChild(d); });
}
$('garRank').addEventListener('click', () => { sfx.click(); rankCls = classOf(editing ? editing.setupRaw : DEFAULT_SETUP); openRanking(selDef); });
$('pauseRank').addEventListener('click', () => { sfx.click(); rankCls = race.cls; openRanking(race.def); });
document.querySelectorAll('#rkTabs button').forEach((b) => b.addEventListener('click', () => { sfx.click(); rankCls = b.dataset.cls; openRanking(rankDef); }));

// ---- Créditos y tienda ----
const coins = () => store.get('coins', 300);
// Todos los coches están disponibles desde el principio (no hay que comprarlos)
const ownedCars = () => CARS.map((c) => c.id);
function addCoins(n) {
  if (!n) return;
  store.set('coins', coins() + n);
}
// Créditos de una carrera: por puesto y por vuelta (para 1 jugador; en 2 jugadores, el que gane)
function raceReward(myPos, laps) { return ([120, 70, 45, 25][myPos - 1] || 15) + laps * 5; }
function showShop(from) {
  state = 'shop';
  shopFrom = from || 'menu';
  setScreen('shop');
  renderShop();
}
let shopFrom = 'menu';
function renderShop() {
  const box = $('shList'); box.innerHTML = '';
  const sel = savedCar(0);
  for (const car of CARS) {
    const card = document.createElement('div');
    card.className = 'shop-card owned';
    const img = new Image(); img.src = `assets/cars/${car.id}.webp`; img.alt = car.name; img.loading = 'lazy';
    const info = document.createElement('div'); info.className = 'info';
    const nm = document.createElement('b'); nm.textContent = car.name;
    const ty = document.createElement('small'); ty.textContent = car.type;
    const btn = document.createElement('button');
    btn.className = 'btn ' + (sel === car.id ? 'ghost' : 'primary');
    const bm = document.createElement('span'); bm.className = 'btn-main';
    bm.textContent = sel === car.id ? 'Tu coche' : 'Elegir';
    btn.disabled = sel === car.id;
    btn.appendChild(bm);
    btn.addEventListener('click', () => { store.set('car0', car.id); loadCar(car.id); sfx.click(); toast(`${car.name} elegido`); renderShop(); });
    info.append(nm, ty, btn);
    card.append(img, info);
    box.appendChild(card);
  }
}
// Selector de coche en el taller (solo los que tienes) y acceso a la tienda
function renderCarPick() {
  const box = $('carPick'); box.innerHTML = '';
  const taken = entries.map((e) => e.carId);
  for (const id of ownedCars()) {
    const car = carById(id);
    const b = document.createElement('button');
    b.className = id === editing.carId ? 'on' : '';
    const img = new Image(); img.src = `assets/cars/${id}.webp`; img.alt = '';
    const sp = document.createElement('span'); sp.textContent = car.name;
    b.append(img, sp);
    b.addEventListener('click', () => { sfx.click(); editing.carId = id; loadCar(id); renderGarage(); });
    box.appendChild(b);
  }
  const sh = document.createElement('button'); sh.className = 'shop'; sh.textContent = 'Ver todos ›';
  sh.addEventListener('click', () => { sfx.click(); showShop('garage'); });
  box.appendChild(sh);
}
$('playShop').addEventListener('click', () => { initAudio(); sfx.click(); showShop('menu'); });
$('shBack').addEventListener('click', () => {
  sfx.click();
  if (shopFrom === 'garage') { state = 'garage'; const sel = savedCar(0); if (editing && entries.length === 0) editing.carId = sel; renderGarage(); setScreen('garage'); }
  else showMenu();
});

// ---- Taller: decoración y reglaje ----
let entries = [];
let editing = null; // { liv, setupRaw }
function showGarage() {
  state = 'garage';
  $('garRank').hidden = !(mode === 'practica' && selDef && rankKeyOf(selDef));
  entries = [];
  beginEntry();
  setScreen('garage');
}
function beginEntry() {
  const player = entries.length;
  const saved = store.get(`setup${player}`, null);
  const taken = entries.map((e) => e.liv.id);
  const livId = store.get(`liv${player}`, LIVERIES[player].id);
  const liv = LIVERIES.find((l) => l.id === livId && !taken.includes(l.id)) || LIVERIES.find((l) => !taken.includes(l.id));
  editing = { liv, setupRaw: { ...DEFAULT_SETUP, ...(saved || {}) }, carId: savedCar(player) };
  renderGarage();
}
function carIcon(liv) {
  const hex = '#' + liv.color.toString(16).padStart(6, '0'), acc = '#' + liv.accent.toString(16).padStart(6, '0');
  return `<svg viewBox="0 0 120 54" class="caricon"><ellipse cx="60" cy="48" rx="50" ry="4" fill="rgba(0,0,0,.3)"/>
    <path d="M6 38 Q4 30 14 28 L40 24 Q52 10 70 11 L88 13 Q104 18 112 27 Q118 31 116 38 Z" fill="${hex}"/>
    <path d="M52 22 Q60 13 72 14 L84 16 Q90 19 92 23 Z" fill="#0e1622"/><rect x="16" y="29" width="92" height="3" fill="${acc}"/>
    <rect x="2" y="21" width="16" height="4" rx="1" fill="${acc}"/><circle cx="58" cy="32" r="6" fill="#fff"/>
    <text x="58" y="35" font-size="8" font-weight="700" text-anchor="middle" fill="#111">${liv.num}</text>
    <circle cx="30" cy="40" r="8.5" fill="#121212"/><circle cx="94" cy="40" r="8.5" fill="#121212"/>
    <circle cx="30" cy="40" r="4.5" fill="#c9ced6"/><circle cx="94" cy="40" r="4.5" fill="#c9ced6"/></svg>`;
}
function renderGarage() {
  const player = entries.length;
  $('garTitle').textContent = mode === '2p' ? `Jugador ${player + 1}: taller` : 'Taller';
  $('garTrack').textContent = champ ? `${champ.cup.name} · ${champ.defs.length} carreras` : `${selDef.name} · ${mode === 'practica' ? 'Práctica' : mode === '2p' ? '2 jugadores' : mode === 'online' ? 'Online' : 'Carrera'}`;
  // Foto del coche elegido (si aún no está, el dibujo de siempre)
  const img = new Image(); img.alt = carById(editing.carId).name; img.src = `assets/cars/${editing.carId}.webp`;
  img.onerror = () => { $('garPreview').innerHTML = carIcon(editing.liv); };
  $('garPreview').innerHTML = ''; $('garPreview').appendChild(img);
  renderCarPick();
  $('garName').textContent = editing.liv.name;
  const taken = entries.map((e) => e.liv.id);
  const lv = $('livList');
  lv.innerHTML = '';
  LIVERIES.forEach((l) => {
    const b = document.createElement('button');
    b.className = 'liv' + (l.id === editing.liv.id ? ' on' : '');
    b.style.setProperty('--c', '#' + l.color.toString(16).padStart(6, '0'));
    b.style.setProperty('--a', '#' + l.accent.toString(16).padStart(6, '0'));
    b.title = l.name;
    b.disabled = taken.includes(l.id);
    b.addEventListener('click', () => { sfx.click(); editing.liv = l; renderGarage(); });
    lv.appendChild(b);
  });
  for (const k of ['magnet', 'gear', 'tire']) {
    const box = $('opt-' + k);
    box.innerHTML = '';
    SETUP_OPTIONS[k].forEach((o) => {
      const b = document.createElement('button');
      b.className = editing.setupRaw[k] === o.id ? 'on' : '';
      b.textContent = o.name;
      b.addEventListener('click', () => { sfx.click(); editing.setupRaw[k] = o.id; renderGarage(); });
      box.appendChild(b);
    });
  }
  $('optBrake').value = Math.round(editing.setupRaw.brake * 100);
  $('optBrakeV').textContent = `${Math.round(editing.setupRaw.brake * 100)} %`;
  $('optCurve').value = Math.round(editing.setupRaw.curve * 10);
  $('optCurveV').textContent = editing.setupRaw.curve <= 1.1 ? 'Lineal' : editing.setupRaw.curve < 1.6 ? 'Progresiva' : 'Muy progresiva';
  const cls = classOf(editing.setupRaw);
  $('garClass').textContent = CLASS_NAME[cls];
  $('garClass').className = 'cls ' + cls;
  $('garHint').textContent = cls === 'pro'
    ? 'Sin imán el coche derrapa mucho más: hay que dosificar el gatillo. Es la clase más difícil y la que usan los clubes.'
    : 'El imán pega el coche a la pista: más velocidad en curva, pero salidas más bruscas cuando te pasas.';
  $('garGo').querySelector('.btn-main').textContent = mode === '2p' && entries.length === 0 ? 'Siguiente: Jugador 2 ›' : 'Salir a pista ›';
}
$('optBrake').addEventListener('input', (e) => { editing.setupRaw.brake = e.target.value / 100; renderGarage(); });
$('optCurve').addEventListener('input', (e) => { editing.setupRaw.curve = e.target.value / 10; renderGarage(); });
$('garGo').addEventListener('click', () => {
  sfx.click();
  const player = entries.length;
  store.set(`setup${player}`, editing.setupRaw);
  store.set(`liv${player}`, editing.liv.id);
  store.set(`car${player}`, editing.carId);
  entries.push({ liv: editing.liv, setupRaw: { ...editing.setupRaw }, carId: editing.carId });
  if (mode === '2p' && entries.length < 2) beginEntry();
  else if (mode === 'online') onlineCarChosen(entries[0]);
  else if (champ && champ.idx === 0 && !champ.entries) { champ.entries = entries.slice(); startChampRace(); }
  else withVeil(selDef, () => startRace({ def: selDef, mode, entries }));
});
$('garBack').addEventListener('click', () => { sfx.click(); if (mode === 'online') { showOnline(); return; } if (champ && !champ.entries && !entries.length) { champ = null; showChamp(); return; } if (entries.length) { entries.pop(); beginEntry(); } else showCircuits(); });

// ---- Carrera: pausa, cámara y resultados ----
// Los circuitos con decorado (montaña, ciudad) tardan un momento en montarse: se avisa en pantalla
// en vez de dejar la imagen congelada
function withVeil(def, fn) {
  if (!def || !(def.decor || def.long)) { fn(); return; }
  const v = $('loadVeil');
  $('loadName').textContent = def.name;
  v.classList.add('on');
  requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(() => {
    try { fn(); } finally { v.classList.remove('on'); }
  }, 30)));
}

// ---- Presentación del circuito: helicóptero sobre la mesa y una pasada de TV por toda la vuelta ----
const MODE_NAME = { practica: 'Práctica', '1p': 'Carrera', '2p': '2 Jugadores' };
const ONLINE_INTRO = 13;   // segundos (el servidor deja este margen antes del semáforo)
function startIntro(online) {
  const meters = T.L * SCALE;
  if (online) {
    // Termina cuando faltan 5,2 s para la salida, según el reloj del servidor; si ya no da tiempo, no hay
    const syncEnd = online.startAt - 5200;
    const left = (syncEnd - room.serverNow()) / 1000;
    if (left < 2) return;
    race.intro = { t: ONLINE_INTRO - left, d1: 3.6, d2: ONLINE_INTRO - 4, a0: (online.startAt % 628) / 100, snap: false, fixed: true, syncEnd };
  } else race.intro = { t: 0, d1: 3.6, d2: clamp(4.2 + meters / 3.6, 6, 14), a0: Math.random() * Math.PI * 2, snap: false };
  state = 'intro';
  $('introHint').textContent = online ? 'La salida es a la vez para todos' : 'Toca para empezar';
  $('introMode').textContent = champ && champ.cup ? champ.cup.name : MODE_NAME[race.mode] || 'Carrera';
  $('introName').textContent = race.def.name;
  $('introInfo').textContent = `${meters.toFixed(1).replace('.', ',')} m · ${race.def.lanes} carriles · ${race.mode === 'practica' ? 'vueltas libres' : `${race.laps} ${race.laps === 1 ? 'vuelta' : 'vueltas'}`}`;
  $('hud').classList.add('intro');
}
function endIntro() {
  if (state !== 'intro') return;
  state = 'countdown';
  $('hud').classList.remove('intro');
}
function introCamera(dt) {
  const it = race.intro, t = it.t;
  const { tw, td } = T.table;
  const R = Math.max(tw, td, 14);
  if (t < it.d1) {
    // Helicóptero girando alto sobre toda la mesa
    const k = t / it.d1, a = it.a0 + k * 0.8;
    camGoalPos.set(Math.sin(a) * R * 0.85, R * (0.8 - 0.12 * k), Math.cos(a) * R * 0.85);
    camGoalTarget.set(0, 0, 0);
    if (!it.snap) { camPos.copy(camGoalPos); camTarget.copy(camGoalTarget); it.snap = true; }
  } else {
    // Cámara de TV que recorre la vuelta entera para ver todas las curvas
    const k = Math.min(1, (t - it.d1) / it.d2);
    const e = k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k);
    const s = e * T.L;
    const p = at(s, 0), q = at(s + 5, 0);
    let hx = q.x - p.x, hz = q.z - p.z; const hl = Math.hypot(hx, hz) || 1; hx /= hl; hz /= hl;
    const ox = -T.center.x, oz = -T.center.z;
    camGoalPos.set(p.x + ox - hx * 6.5, p.y + 7.5, p.z + oz - hz * 6.5);
    camGoalTarget.set(q.x + ox, q.y, q.z + oz);
  }
  const kf = 1 - Math.exp(-dt * (t < it.d1 ? 5 : 3.2));
  camPos.lerp(camGoalPos, kf); camTarget.lerp(camGoalTarget, kf);
}
// Se salta tocando la pantalla o con cualquier tecla
// (en el online no: allí dura lo mismo para todos)
for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, (e) => {
  if (state !== 'intro' || race.intro.fixed) return;
  if (e.target && e.target.closest && e.target.closest('#pauseBtn')) return;
  e.preventDefault(); e.stopPropagation(); endIntro();
}, { capture: true });

function pause() {
  if (state === 'intro' && !race.intro.fixed) { endIntro(); return; }
  if (state !== 'race' && state !== 'countdown' && state !== 'intro') return;
  if (race.mode === 'online') { $('quitBtn').querySelector('.btn-main').textContent = 'Abandonar carrera'; openModal('mPause'); return; }
  race.prevState = state;
  state = 'pause';
  for (const c of cars) updateEngine(c.engine, c.st, false);
  pads.forEach((p) => { p.id = null; p.value = 0; });
  $('quitBtn').querySelector('.btn-main').textContent = race.mode === 'practica' ? 'Terminar práctica' : 'Salir';
  $('pauseRank').hidden = !race.rankKey;
  openModal('mPause');
}
function resume() {
  if (race && race.mode === 'online') { closeModal('mPause'); return; }
  if (state !== 'pause') return;
  closeModal('mPause');
  state = race.prevState || 'race';
  last = performance.now();
}
function toggleCam() {
  camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
  toast('' + CAM_NAME[camMode]);
}
$('pauseBtn').addEventListener('click', pause);
$('camBtn').addEventListener('click', () => { sfx.click(); toggleCam(); });
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => { closeModal('mPause'); if (race.champ) { startChampRace(); return; } if (race.mode === 'practica') endPractice(); startRace({ def: race.def, mode: race.mode, entries: race.entries }); });
$('quitBtn').addEventListener('click', () => {
  closeModal('mPause');
  if (race.mode === 'online') { room && room.send({ t: 'fin', time: 9999, best: Infinity }); afterRace(); return; }
  if (race.mode === 'practica') endPractice(); mode = race.mode; clearCars(); afterRace();
});
$('againBtn').addEventListener('click', () => { closeModal('mResults'); const r = race; withVeil(r.def, () => startRace({ def: r.def, mode: r.mode, entries: r.entries })); });
$('nextBtn').addEventListener('click', () => {
  closeModal('mResults');
  if (race.champ) { champ.idx++; startChampRace(); return; }
  selDef = TRACKS[race.trackIdx + 1]; startRace({ def: selDef, mode: race.mode, entries: race.entries });
});
$('resMenuBtn').addEventListener('click', () => { closeModal('mResults'); mode = race.mode; afterRace(); });
$('likeBtn').addEventListener('click', () => {
  const cid = race && race.def.cid; if (!cid) return;
  const liked = store.get('liked', []); if (liked.includes(cid)) return;
  liked.push(cid); store.set('liked', liked.slice(-500));
  apiPost(`/api/tracks/${cid}/like`).catch(() => {});
  sfx.best(); $('likeBtn').disabled = true; $('likeBtn').querySelector('.btn-main').textContent = 'Te gusta';
  commCache = { top: null, new: null };
});
// Al salir de una carrera: volver al editor si era una prueba, si no a la lista de circuitos
function afterRace() {
  if (race && race.editorTest) { showEditor(); return; }
  if (race && race.champ) { champ = null; showChamp(); demoRace(); return; }
  if (race && race.mode === 'online') { clearCars(); race = null; showOnline(); demoRace(); return; }
  showCircuits(); demoRace();
}
document.addEventListener('visibilitychange', () => { if (document.hidden && !(race && race.mode === 'online')) pause(); });

// ---- Ajustes y estadísticas ----
function fillSettings() {
  $('resetTxt').textContent = acct ? '¿Borrar récords, fantasmas, copas y circuitos, aquí y en tu cuenta?' : '¿Borrar récords, fantasmas, copas y circuitos de este dispositivo?';
  $('optSound').checked = settings.sound;
  $('optMusic').checked = settings.music;
  $('optVibe').checked = settings.vibe;
  $('optLefty').checked = settings.lefty;
  $('optTele').checked = settings.tele;
  $('optBrakes').checked = settings.brakes;
  $('resetConfirm').hidden = true;
  const nh = store.get('hiddenTracks', []).length, nb = store.get('blocked', []).length;
  $('hiddenRow').hidden = !(nh || nb);
  $('hiddenTxt').textContent = `Ocultos: ${nh} ${nh === 1 ? 'circuito' : 'circuitos'} · ${nb} ${nb === 1 ? 'piloto' : 'pilotos'}`;
}
$('optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); initAudio(); setMuted(); sfx.click(); });
$('optMusic').addEventListener('change', (e) => { settings.music = e.target.checked; saveSettings(); initAudio(); });
$('optVibe').addEventListener('change', (e) => { settings.vibe = e.target.checked; saveSettings(); vibrate(30); });
$('optLefty').addEventListener('change', (e) => { settings.lefty = e.target.checked; saveSettings(); });
$('optTele').addEventListener('change', (e) => { settings.tele = e.target.checked; saveSettings(); });
$('optBrakes').addEventListener('change', (e) => { settings.brakes = e.target.checked; saveSettings(); for (const g of brakeGroups) g.visible = settings.brakes; });
$('resetBtn').addEventListener('click', () => { $('resetConfirm').hidden = false; });
$('resetNo').addEventListener('click', () => { $('resetConfirm').hidden = true; });
$('resetYes').addEventListener('click', async () => {
  // Se borra el progreso, pero no la sesión, los ajustes ni el identificador del dispositivo.
  // Con cuenta, primero se espera a que acabe cualquier sincronización en marcha y se bloquean las nuevas.
  resetting = true;
  clearTimeout(syncTimer);
  for (let i = 0; i < 100 && syncBusy; i++) await new Promise((r) => setTimeout(r, 100));
  const KEEP = ['slot.settings', 'slot.account', 'slot.device', 'slot.syncVer', 'slot.seenHelp2', 'slot.quality', 'slot.premiumCfg'];
  try { Object.keys(localStorage).filter((k) => k.startsWith('slot.') && !KEEP.includes(k)).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
  closeModal('mSettings'); showMenu();
  if (!acct) { resetting = false; toast('Progreso borrado'); return; }
  try {
    let ver = (await apiGet('/api/profile')).ver, done = false;
    for (let i = 0; i < 4 && !done; i++) {
      const r = await apiReq('PUT', '/api/profile', { data: { keys: {}, statsBy: {} }, ver }, { allow: [409] });
      if (r.ok) { syncVer = r.ver; store.set('syncVer', syncVer); done = true; } else ver = r.ver;
    }
    toast(done ? 'Progreso borrado, también en tu cuenta' : 'Progreso borrado aquí. La cuenta estaba ocupada: inténtalo otra vez');
  } catch (e) { toast('Progreso borrado aquí. No se pudo borrar el de la cuenta: ' + e.message); }
  resetting = false;
});
function fillStats() {
  // Las de este dispositivo más las de los demás donde se ha jugado con la misma cuenta
  const s = { ...store.get('stats', { races: 0, wins: 0, crashes: 0, laps: 0 }) };
  if (acct) { const o = otherStats(store.get('statsBy', {}), deviceId); for (const f of Object.keys(o)) s[f] = (+s[f] || 0) + o[f]; }
  const pos = store.get('pos', {}), best = store.get('best', {});
  $('sRaces').textContent = s.races; $('sWins').textContent = s.wins; $('sLaps').textContent = s.laps || 0; $('sCrashes').textContent = s.crashes;
  const box = $('sTracks');
  box.innerHTML = '';
  TRACKS.forEach((t) => {
    const r = document.createElement('div');
    r.className = 'trow';
    const medal = pos[t.id] === 1 ? '1º' : pos[t.id] === 2 ? '2º' : pos[t.id] === 3 ? '3º' : (pos[t.id] ? `${pos[t.id]}º` : '–');
    r.innerHTML = '<span></span><b></b><em></em><em></em>';
    r.querySelector('span').textContent = t.name;
    r.querySelector('b').textContent = medal;
    const ems = r.querySelectorAll('em');
    ems[0].textContent = best[`${t.id}|iman`] ? fmt(best[`${t.id}|iman`]) : '–';
    ems[1].textContent = best[`${t.id}|pro`] ? fmt(best[`${t.id}|pro`]) : '–';
    box.appendChild(r);
  });
}

window.addEventListener('resize', fitCamera);
window.addEventListener('orientationchange', () => setTimeout(fitCamera, 250));
window.addEventListener('gamepadconnected', () => toast('Mando conectado: usa el gatillo derecho'));

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
setupComposer();
applyQuality();
showMenu();
loadCarModels();
overviewCamera(camPos, camTarget);
// Enlace con un circuito (?circuito=…): se guarda en «Mis circuitos» y se abre en el editor
{
  const raw = new URLSearchParams(location.search).get('circuito');
  if (raw && raw.length < 20000) {
    try {
      const j = JSON.parse(decodeURIComponent(escape(atob(raw.replace(/-/g, '+').replace(/_/g, '/')))));
      if (Array.isArray(j.pieces) && j.pieces.length < 90) {
        const d = { ...newDraft(), name: String(j.name || '').slice(0, 28), lanes: j.lanes === 4 ? 4 : 2, laps: Math.max(1, Math.min(20, j.laps | 0 || 5)), scenery: ['verde', 'arena', 'noche'].includes(j.scenery) ? j.scenery : 'verde', radius: ['cerrada', 'media', 'abierta'].includes(j.radius) ? j.radius : 'media', pieces: j.pieces.filter((p) => Array.isArray(p) && (p[0] === 'S' || p[0] === 'C')).map((p) => p.map((v, i) => (i ? Number(v) : v))) };
        draft = d; saveDraft();
        history.replaceState(null, '', location.pathname);
        showEditor();
        toast('Circuito cargado: ya puedes publicarlo');
      }
    } catch { /* enlace roto */ }
  }
}
// Enlace de invitación: ?sala=ABCD abre la pantalla online con el código puesto
{
  const sala = (new URLSearchParams(location.search).get('sala') || '').toUpperCase();
  if (/^[A-Z]{4}$/.test(sala)) { showOnline(); $('onCode').value = sala; onMsg(settings.pilot ? 'Pulsa «Entrar» para unirte' : 'Pon tu nombre y pulsa «Entrar»'); }
}
requestAnimationFrame(loop);
Promise.race([document.fonts ? Promise.all([document.fonts.load('italic 700 20px "Barlow Condensed"'), document.fonts.load('500 16px Barlow')]) : null, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .then(() => setTimeout(() => {
    ui.splash.classList.add('done');
    if (!store.get('seenHelp2', false)) { store.set('seenHelp2', true); setTimeout(() => openModal('mHelp'), 500); }
  }, 300));

// Gancho para pruebas automáticas
window.__slot = {
  get state() { return state; }, get cars() { return cars; }, get race() { return race; }, get T() { return T; }, get wrGhost() { return wrGhost; }, get shot() { return shot; }, get world() { return world; }, measure: () => new Promise((res) => { renderer.info.autoReset = false; renderer.info.reset(); requestAnimationFrame(() => requestAnimationFrame(() => { const r = { ...renderer.info.render }; renderer.info.autoReset = true; let meshes = 0, shadow = 0, inst = 0, skinned = 0; scene.traverse((o) => { if (o.isMesh && o.visible) { meshes++; if (o.castShadow) shadow++; if (o.isInstancedMesh) inst++; if (o.isSkinnedMesh) skinned++; } }); res({ ...r, meshes, shadow, inst, skinned }); })); }), breakdown: () => { const out = {}; const tri = (g) => (g.index ? g.index.count : g.attributes.position.count) / 3; scene.traverse((o) => { if (!o.isMesh) return; let a = o, tag = ''; while (a && !tag) { if (a.name) tag = a.name; a = a.parent; } tag = tag || (o.isSkinnedMesh ? 'skinned' : o.parent && o.parent.type) || 'x'; if (o.parent === trackGroup) tag = 'track:' + (o.geometry.type); const n = o.isInstancedMesh ? o.count : 1; const e = out[tag] || (out[tag] = { meshes: 0, tris: 0, shadow: 0 }); e.meshes++; e.tris += Math.round(tri(o.geometry) * n); if (o.castShadow) e.shadow++; }); return out; }, get info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, quality }; },
  get actx() { return actx; }, get slotBuf() { return slotBuf; }, startRace, LIVERIES, DEFAULT_SETUP, TRACKS, get room() { return room; }, get roomState() { return roomState; },
  setPad: (p, v) => { const pad = pads.find((x) => x.player === p); if (pad) { pad.id = 'test'; pad.value = v; } },
  setCam: (m) => { camMode = m; },
};
