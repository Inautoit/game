// Turbo Slot — simulador de coches de slot 1:32.
import * as THREE from '../vendor/three.module.min.js';
import { TRACKS, sample, laneOffsets, LANE_W, DS } from './tracks.js';
import { step, newCarState, resolveSetup, DEFAULT_SETUP, SETUP_OPTIONS, DT, SCALE } from './physics.js';
import { buildProfile, aiThrottle } from './ai.js';

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
  set(k, v) { try { localStorage.setItem('slot.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const settings = Object.assign({ sound: true, vibe: true, lefty: false, cam: 'tv' }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
const vibrate = (p) => { if (settings.vibe && navigator.vibrate) navigator.vibrate(p); };
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
const RIVALS = ['M. Ortega', 'L. Ferrer', 'J. Sanz', 'A. Vidal', 'P. Navarro'];

// ---------------------------------------------------------------------------
// Sonido sintetizado: motor eléctrico, engranajes, ruedas y salidas
// ---------------------------------------------------------------------------
let actx = null, master = null;
function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = settings.sound ? 0.9 : 0;
    const comp = actx.createDynamicsCompressor();
    master.connect(comp).connect(actx.destination);
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
  crash() { noise(0.45, 0.4, 900); tone(170, 60, 0.3, 'triangle', 0.14); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.05, i * 0.12)); },
};
// Motor de corriente continua: zumbido del colector (2 pulsos por vuelta) + piñón-corona + trencillas
function makeEngine(human) {
  if (!actx) return null;
  const o1 = actx.createOscillator(), o2 = actx.createOscillator(), o3 = actx.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square'; o3.type = 'triangle';
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1500; f.Q.value = 1.2;
  const g = actx.createGain(); g.gain.value = 0;
  const g2 = actx.createGain(); g2.gain.value = 0.35;
  const g3 = actx.createGain(); g3.gain.value = 0.25;
  o1.connect(f); o2.connect(g2).connect(f); o3.connect(g3).connect(f);
  f.connect(g).connect(master);
  o1.start(); o2.start(); o3.start();
  const ns = actx.createBufferSource(); ns.buffer = getNoise(); ns.loop = true;
  const nf = actx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 3200; nf.Q.value = 4;
  const ng = actx.createGain(); ng.gain.value = 0;
  ns.connect(nf).connect(ng).connect(master); ns.start();
  const rs = actx.createBufferSource(); rs.buffer = getNoise(); rs.loop = true;
  const rf = actx.createBiquadFilter(); rf.type = 'highpass'; rf.frequency.value = 5000;
  const rg = actx.createGain(); rg.gain.value = 0;
  rs.connect(rf).connect(rg).connect(master); rs.start();
  return { o1, o2, o3, f, g, ng, rg, srcs: [o1, o2, o3, ns, rs], vol: human ? 0.06 : 0.018 };
}
function updateEngine(e, st, on) {
  if (!e || !actx) return;
  const t = actx.currentTime;
  const rps = st.rpm / 60;
  const fr = Math.max(30, rps * 2);
  e.o1.frequency.setTargetAtTime(fr, t, 0.02);
  e.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.02);
  e.o3.frequency.setTargetAtTime(fr * 0.333 * 9, t, 0.02);
  e.f.frequency.setTargetAtTime(700 + Math.abs(st.amps) * 900, t, 0.03);
  const load = clamp(Math.abs(st.amps) / 2.5, 0, 1);
  e.g.gain.setTargetAtTime(on ? e.vol * (0.25 + 0.75 * Math.min(1, rps / 250)) * (0.6 + 0.4 * load) : 0, t, 0.03);
  const slide = clamp((st.Fr - 0.9) * 6, 0, 1) * clamp(st.v - 0.8, 0, 1);
  e.ng.gain.setTargetAtTime(on ? slide * e.vol * 1.4 : 0, t, 0.04);
  e.rg.gain.setTargetAtTime(on ? clamp(st.v / 6, 0, 1) * e.vol * 0.25 : 0, t, 0.05);
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

const SCENERY = {
  verde: { table: '#3d7d4c', table2: '#356c42', bg: ['#2a3550', '#121826'], light: 1 },
  arena: { table: '#c9a26b', table2: '#b88f58', bg: ['#4a3a30', '#1b1411'], light: 1 },
  noche: { table: '#26375a', table2: '#1f2e4c', bg: ['#141b2e', '#06080f'], light: 0.75 },
};

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

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  g.clear();
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
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  T.center = { x: cx, z: cz };
  trackGroup.position.set(-cx, 0, -cz);
  carsGroup.position.set(-cx, 0, -cz);

  // Textura de la pista: asfalto de plástico, ranuras, raíles de cobre y bordes
  const W = 512;
  const tex = canvasTex(W, 128, (g, w, h) => {
    g.fillStyle = '#3c3f47'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `rgba(255,255,255,${Math.random() * 0.035})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
    const U = (d) => ((half - d) / (2 * half)) * w;
    g.fillStyle = '#f2f2f2';
    g.fillRect(U(half - 0.05), 0, w * 0.012, h); g.fillRect(U(-half + 0.05) - w * 0.012, 0, w * 0.012, h);
    for (const d of offsets) {
      const u = U(d);
      g.fillStyle = '#c98a4b'; g.fillRect(u - w * 0.028, 0, w * 0.012, h); g.fillRect(u + w * 0.016, 0, w * 0.012, h);
      g.fillStyle = '#0d0e12'; g.fillRect(u - w * 0.009, 0, w * 0.018, h);
    }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, w, 2); // junta entre piezas
  });
  tex.repeat.set(1, 1);
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= n; i++) {
    const p = P[i % n];
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const v = (i * DS) / 1.0;
    pos.push(p.x + nx * half, p.y + 0.002, p.z + nz * half, p.x - nx * half, p.y + 0.002, p.z - nz * half);
    uv.push(0, v, 1, v);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.62, side: THREE.DoubleSide }));
  road.receiveShadow = true;
  trackGroup.add(road);

  // Raíles de cobre (trencillas) a cada lado de cada ranura: metal de verdad que refleja
  const copperMat = new THREE.MeshStandardMaterial({ color: 0xd99560, metalness: 1, roughness: 0.32 });
  const rp = [], ri = [];
  let rv = 0;
  for (const d of offsets) {
    for (const side of [-1, 1]) {
      const c0 = d + side * 0.045;
      for (let i = 0; i <= n; i++) {
        const p = P[i % n];
        const nx = -Math.sin(p.h), nz = Math.cos(p.h);
        rp.push(p.x + nx * (c0 - 0.012), p.y + 0.0045, p.z + nz * (c0 - 0.012), p.x + nx * (c0 + 0.012), p.y + 0.0045, p.z + nz * (c0 + 0.012));
        if (i < n) ri.push(rv + i * 2, rv + i * 2 + 1, rv + i * 2 + 2, rv + i * 2 + 1, rv + i * 2 + 3, rv + i * 2 + 2);
      }
      rv += (n + 1) * 2;
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
  for (let i = 0; i <= n; i++) {
    const p = P[i % n];
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const bottom = p.y > 0.05 ? p.y - 0.09 : -0.02;
    for (const sgn of [1, -1]) sk.push(p.x + nx * half * sgn, p.y + 0.002, p.z + nz * half * sgn, p.x + nx * half * sgn, bottom, p.z + nz * half * sgn);
    if (i < n) { const a = i * 4; skIdx.push(a, a + 1, a + 4, a + 1, a + 5, a + 4, a + 2, a + 3, a + 6, a + 3, a + 7, a + 6); }
  }
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
  const pillarMat = new THREE.MeshStandardMaterial({ color: 0xd9d9de, roughness: 0.6 });
  const railMat = new THREE.MeshStandardMaterial({ color: 0xff5252, roughness: 0.5 });
  for (let i = 0; i < n; i += Math.round(1.1 / DS)) {
    const p = P[i];
    if (p.y < 0.25) continue;
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    for (const sgn of [1, -1]) {
      const pil = new THREE.Mesh(new THREE.BoxGeometry(0.12, p.y - 0.09, 0.12), pillarMat);
      pil.position.set(p.x + nx * (half - 0.1) * sgn, (p.y - 0.09) / 2, p.z + nz * (half - 0.1) * sgn);
      pil.castShadow = true;
      trackGroup.add(pil);
    }
  }
  for (const sgn of [1, -1]) {
    let seg = [];
    const flush = () => {
      if (seg.length < 2) { seg = []; return; }
      const curve = new THREE.CatmullRomCurve3(seg);
      const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, seg.length * 2, 0.025, 6, false), railMat);
      tube.castShadow = true;
      trackGroup.add(tube);
      seg = [];
    };
    for (let i = 0; i < n; i += 3) {
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
  const banner = canvasTex(512, 64, (g, w, h) => { g.fillStyle = '#ff3b30'; g.fillRect(0, 0, w, h); g.fillStyle = '#fff'; g.font = '700 44px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('TURBO SLOT', w / 2, h / 2 + 2); }, false);
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
  const tw = T.bbox.maxX - T.bbox.minX + 3.4, td = T.bbox.maxZ - T.bbox.minZ + 3.4;
  const felt = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = sc.table; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() < 0.5 ? sc.table2 : 'rgba(255,255,255,0.05)'; g.fillRect(Math.random() * w, Math.random() * h, 1.5, 1.5); }
  });
  felt.repeat.set(tw / 4, td / 4);
  const table = new THREE.Mesh(new THREE.BoxGeometry(tw, 0.3, td), [
    new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }),
    new THREE.MeshStandardMaterial({ map: felt, roughness: 1 }), new THREE.MeshStandardMaterial({ color: 0x5e3b22 }),
    new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }), new THREE.MeshStandardMaterial({ color: 0x8a5a36, roughness: 0.6 }),
  ]);
  table.position.set(cx, -0.17, cz);
  table.receiveShadow = true;
  trackGroup.add(table);
  const rimMat = new THREE.MeshStandardMaterial({ color: 0x9b6a41, roughness: 0.5 });
  for (const [w2, d2, x2, z2] of [[tw + 0.3, 0.15, 0, td / 2 + 0.075], [tw + 0.3, 0.15, 0, -td / 2 - 0.075], [0.15, td, tw / 2 + 0.075, 0], [0.15, td, -tw / 2 - 0.075, 0]]) {
    const r = new THREE.Mesh(new THREE.BoxGeometry(w2, 0.38, d2), rimMat);
    r.position.set(cx + x2, -0.13, cz + z2);
    r.castShadow = true; r.receiveShadow = true;
    trackGroup.add(r);
  }

  // Decorado: neumáticos en las curvas, árboles y grada
  const tireGeo = new THREE.TorusGeometry(0.12, 0.05, 8, 16).rotateX(Math.PI / 2);
  const tireMat = new THREE.MeshStandardMaterial({ color: 0x1c1c1f, roughness: 0.9 });
  const tireMat2 = new THREE.MeshStandardMaterial({ color: 0xf5f5f5, roughness: 0.9 });
  const occupied = (x, z, r) => {
    for (let i = 0; i < n; i += 4) if (Math.hypot(P[i].x - x, P[i].z - z) < half + r) return true;
    return false;
  };
  for (let i = 0; i < n; i += Math.round(0.9 / DS)) {
    const p = P[i];
    if (Math.abs(p.k) < 0.01 || p.y > 0.05) continue;
    const out = -Math.sign(p.k);
    const nx = -Math.sin(p.h), nz = Math.cos(p.h);
    const x = p.x + nx * (half + 0.55) * out, z = p.z + nz * (half + 0.55) * out;
    if (occupied(x, z, 0.4)) continue;
    for (let k = 0; k < 3; k++) {
      const t = new THREE.Mesh(tireGeo, k === 1 ? tireMat2 : tireMat);
      t.position.set(x, 0.05 + k * 0.09, z);
      t.castShadow = true;
      trackGroup.add(t);
    }
  }
  const treeMat = new THREE.MeshStandardMaterial({ color: def.scenery === 'arena' ? 0x6f9a3a : 0x2f7d3f, flatShading: true, roughness: 0.9 });
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b4426 });
  let seed = 7;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let k = 0; k < 40; k++) {
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
      for (let s2 = 0; s2 < 9; s2++) {
        const fan = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.16, 0.08), new THREE.MeshStandardMaterial({ color: colors[(s2 + r) % 4] }));
        fan.position.set(-1.05 + s2 * 0.26, 0.2 + r * 0.12, r * 0.3);
        stand.add(fan);
      }
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
  sun.intensity = 2.3 * sc.light;
  hemi.intensity = 1.5 * sc.light;
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
  g.fillStyle = '#111'; g.font = '700 64px Fredoka, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(String(num), 64, 68);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function makeCarMesh(liv, ghost = false) {
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
// Cámara: TV (vista de mesa), persecución y a bordo
// ---------------------------------------------------------------------------
const CAMS = ['tv', 'persecucion', 'bordo'];
const CAM_NAME = { tv: 'Cámara TV', persecucion: 'Persecución', bordo: 'A bordo' };
let camMode = settings.cam || 'tv';
const camPos = new THREE.Vector3(), camTarget = new THREE.Vector3();
const camGoalPos = new THREE.Vector3(), camGoalTarget = new THREE.Vector3();
let orbit = 0;
function fitCamera() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
}
function overviewCamera(out, target) {
  const bw = T.bbox.maxX - T.bbox.minX + 1.6, bd = T.bbox.maxZ - T.bbox.minZ + 1.6;
  const portrait = camera.aspect < 1;
  const az = (portrait ? bw > bd : bw < bd) ? Math.PI / 2 : 0;
  const scrW = az ? bd : bw, scrD = az ? bw : bd;
  const el = (57 * Math.PI) / 180;
  const vf = (camera.fov * Math.PI) / 180, hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const needV = scrD * Math.sin(el) + 1.2;
  let dist = Math.max((scrW / 2) / Math.tan(hf / 2), (needV / 2) / Math.tan(vf / 2)) * 1.05 + 1;
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
  for (const ch of [...carsGroup.children]) if (ch !== sparkPts) { carsGroup.remove(ch); disposeGroup(ch); }
  cars = [];
  ghost = null;
}

// Pose: la guía va en el carril; el coche gira θ respecto a la tangente
function placeCar(mesh, s, d, th) {
  const p = at(s, d);
  mesh.position.set(p.x, p.y + 0.004, p.z);
  mesh.rotation.set(0, -(p.h + th), 0);
  mesh.rotateZ(Math.atan(p.slope));
  return p;
}

function makeCar({ liv, lane, human, player, name, setupRaw, skill }) {
  const mesh = makeCarMesh(liv);
  carsGroup.add(mesh);
  const setup = resolveSetup(setupRaw);
  const c = {
    liv, lane, d: T.offsets[lane], human, player, name, setupRaw, setup, skill: skill || 1,
    st: newCarState(T.L - 0.55), thr: 0, mesh,
    lap: 0, lapStart: 0, laps: [], best: Infinity, last: NaN, finished: false, finishTime: 0,
    crash: null, blink: 0, mistake: 0, crashes: 0,
    engine: makeEngine(human), prof: null, rec: [], recT: 0,
  };
  if (!human) c.prof = buildProfile(physTrack, c.d, setup, 0.95);
  if (human) mesh.userData.ring.material.opacity = 0.7;
  cars.push(c);
  placeCar(mesh, c.st.s, c.d, 0);
  return c;
}

function ghostKey(trackId, cls) { return `ghost.${trackId}.${cls}`; }

// mode: 'practica' | '1p' | '2p'
function startRace({ trackIdx, mode, entries }) {
  initAudio();
  const def = TRACKS[trackIdx];
  buildTrack(def);
  physTrack = { L: T.L, DSU: DS, pts: T.pts };
  clearCars();
  const lanes = def.lanes;
  const humans = entries.length;
  const used = new Set(entries.map((e) => e.liv.id));
  const others = LIVERIES.filter((l) => !used.has(l.id));
  entries.forEach((e, i) => {
    const lane = humans === 2 ? i : (lanes === 2 ? 1 : Math.min(lanes - 1, 1));
    makeCar({ liv: e.liv, lane, human: true, player: i, name: humans === 2 ? `Jugador ${i + 1}` : 'Tú', setupRaw: e.setupRaw });
  });
  if (mode !== 'practica') {
    const free = [...Array(lanes).keys()].filter((l) => !cars.some((c) => c.lane === l));
    const base = 0.86 + trackIdx * 0.018;
    free.forEach((l, i) => {
      const setupRaw = { ...DEFAULT_SETUP, magnet: entries[0].setupRaw.magnet === 'sin' ? 'sin' : 'medio' };
      const skill = clamp(base + (i - (free.length - 1) / 2) * 0.025, 0.82, 0.97);
      makeCar({ liv: others[i % others.length], lane: l, human: false, name: RIVALS[i % RIVALS.length], setupRaw, skill });
    });
  }
  // Fantasma: tu mejor vuelta guardada (solo en práctica)
  if (mode === 'practica') {
    const cls = classOf(entries[0].setupRaw);
    const data = store.get(ghostKey(def.id, cls), null);
    if (data) {
      const mesh = makeCarMesh(entries[0].liv, true);
      carsGroup.add(mesh);
      ghost = { mesh, data };
    }
  }
  race = {
    trackIdx, def, mode, laps: mode === 'practica' ? Infinity : def.laps, simT: 0, acc: 0,
    goT: mode === 'practica' ? 1.2 : 4.2 + Math.random() * 0.8, lightsOn: 0, started: false, finishedAt: null, humans, entries,
    cls: classOf(entries[0].setupRaw),
  };
  state = 'countdown';
  setupSliders();
  setScreen('hud');
  T.lights.forEach((m) => { m.material.emissive.setHex(0x000000); m.material.color.setHex(0x331111); });
  ui.count.textContent = '';
  updateHud(true);
}

function crashCar(c) {
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
  if (c.crash) return;
  const hold = !race.started;
  let thr = c.human ? c.thrIn : aiThrottle(c.st, c.prof, physTrack, c.skill * (c.mistake > 0 ? 1.06 : 1), c.setup);
  if (c.finished && !c.human) thr = Math.min(thr, 0.35);
  if (hold) { thr = 0; c.st.v = 0; c.st.w = 0; c.st.th = 0; }
  c.thr = thr;
  const before = c.st.s;
  step(c.st, physTrack, c.d, thr, c.setup);
  if (hold) c.st.s = before;
  if (c.st.out) { crashCar(c); return; }
  if (c.st.s >= T.L) {
    c.st.s -= T.L;
    // Instante exacto del paso por meta (interpolado dentro del paso)
    const over = (c.st.s * SCALE) / Math.max(0.05, c.st.v);
    crossLine(c, race.simT - over - race.goT);
  }
  // Grabación para el fantasma (60 por segundo)
  if (c.human && race.mode === 'practica' && c.lap > 0) {
    c.recT += DT;
    if (c.recT >= 1 / 60) { c.recT -= 1 / 60; c.rec.push(+c.st.s.toFixed(3), +c.st.th.toFixed(3)); }
  }
}

function crossLine(c, now) {
  if (c.lap === 0) { c.lap = 1; c.lapStart = now; c.rec = []; c.recT = 0; return; }
  const lt = now - c.lapStart;
  c.laps.push(lt);
  c.last = lt;
  const prevBest = c.best;
  if (lt < c.best) c.best = lt;
  c.lapStart = now;
  if (c.human) {
    const key = `${race.def.id}|${race.cls}`;
    const recs = store.get('best', {});
    const rec = recs[key];
    if (!rec || lt < rec) {
      recs[key] = lt; store.set('best', recs);
      sfx.best();
      flashText(c.player, rec ? '🏆 ¡Récord personal!' : '¡Primera vuelta!');
      if (race.mode === 'practica') store.set(ghostKey(race.def.id, race.cls), { t: lt, d: c.d, s: c.rec });
    } else if (lt < prevBest) { sfx.best(); flashText(c.player, '¡Mejor vuelta!'); } else sfx.lap();
    c.rec = []; c.recT = 0;
  }
  if (c.lap >= race.laps) {
    c.finished = true;
    c.finishTime = now;
    if (c.human) { sfx.finish(); vibrate([30, 30, 30, 30, 100]); flashText(c.player, '🏁 ¡Meta!'); }
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
  for (const c of cars) if (c.human) c.thrIn = readThrottle(c.player, dt);
  // Física a paso fijo
  race.acc += dt;
  let n = 0;
  while (race.acc >= DT && n < 60) {
    race.acc -= DT; n++;
    race.simT += DT;
    for (const c of cars) physStep(c);
  }
  for (const c of cars) {
    if (!c.human && race.started && !c.crash && Math.random() < dt * 0.02) c.mistake = 0.8;
    if (c.mistake > 0) c.mistake -= dt;
    if (c.crash) animateCrash(c, dt);
    else {
      const p = placeCar(c.mesh, c.st.s, c.d, c.st.th);
      if (c.blink > 0) { c.blink -= dt; c.mesh.visible = Math.floor(c.blink * 12) % 2 === 0; } else c.mesh.visible = true;
      // Chispas: al frenar fuerte o a alta velocidad
      const rate = (c.st.amps < -0.6 ? 70 : 0) + (c.st.v > 3 ? (c.st.v - 3) * 8 : 0);
      let k = rate * dt;
      while (k > 0) { if (Math.random() < k) emitSpark(p.x, p.y + 0.02, p.z, Math.cos(p.h), Math.sin(p.h)); k -= 1; }
    }
    updateEngine(c.engine, c.st, !c.crash);
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
    title = myPos === 1 ? '¡Victoria! 🏆' : myPos === 2 ? '¡Segundo puesto!' : myPos === 3 ? 'Tercer puesto' : `${myPos}º puesto`;
    const pos = store.get('pos', {});
    if (!pos[race.def.id] || myPos < pos[race.def.id]) { pos[race.def.id] = myPos; store.set('pos', pos); }
  }
  $('resTitle').textContent = title;
  $('resSub').textContent = `${race.def.name} · ${race.laps} vueltas · ${CLASS_NAME[race.cls]}`;
  const best = store.get('best', {})[`${race.def.id}|${race.cls}`];
  $('resBest').textContent = best ? `Tu récord (${CLASS_NAME[race.cls].toLowerCase()}): ${fmt(best)}` : '';
  const nextIdx = race.trackIdx + 1;
  $('nextBtn').hidden = !(nextIdx < TRACKS.length && isUnlocked(nextIdx));
  const unlockedNow = race.mode !== '2p' && myPos === 1 && nextIdx < TRACKS.length;
  $('resUnlock').hidden = !unlockedNow;
  if (unlockedNow) $('resUnlock').textContent = `🔓 Desbloqueado: ${TRACKS[nextIdx].name}`;
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

function isUnlocked(i) {
  if (i === 0) return true;
  const pos = store.get('pos', {});
  return pos[TRACKS[i - 1].id] === 1 || !!pos[TRACKS[i].id];
}

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
  if (e.target && e.target.tagName === 'INPUT') return;
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
let viewOff = 0;
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
  if (!T) return;
  if (state === 'countdown' || state === 'race' || state === 'results') {
    stepRace(dt);
    updateHud();
  } else if (state === 'menu' || state === 'circuits' || state === 'garage') {
    if (race && race.demo) {
      race.acc += dt;
      let n = 0;
      while (race.acc >= DT && n < 40) { race.acc -= DT; n++; race.simT += DT; for (const c of cars) physStep(c); }
      for (const c of cars) {
        if (c.crash) animateCrash(c, dt);
        else {
          const p = placeCar(c.mesh, c.st.s, c.d, c.st.th);
          if (c.st.amps < -0.6 && Math.random() < 0.6) emitSpark(p.x, p.y + 0.02, p.z, Math.cos(p.h), Math.sin(p.h));
        }
      }
      updateSparks(dt);
    }
    orbit += dt * 0.05;
  }

  // Cámara
  const racing = state === 'race' || state === 'countdown' || state === 'pause' || state === 'results';
  for (const c of cars) if (c.human && c.mesh.userData.ring) c.mesh.userData.ring.visible = camMode === 'tv';
  const me = racing ? cars.find((c) => c.human) : null;
  if (me && camMode !== 'tv') {
    const p = at(me.st.s, me.d);
    const psi = p.h + (me.crash ? 0 : me.st.th * 0.5);
    const fx = Math.cos(psi), fz = Math.sin(psi);
    const ox = -T.center.x, oz = -T.center.z;
    if (camMode === 'persecucion') {
      camGoalPos.set(p.x - fx * 3.3 + ox, p.y + 2.1, p.z - fz * 3.3 + oz);
      camGoalTarget.set(p.x + fx * 1.6 + ox, p.y - 0.3, p.z + fz * 1.6 + oz);
    } else {
      camGoalPos.set(p.x - fx * 1.25 + ox, p.y + 0.55, p.z - fz * 1.25 + oz);
      camGoalTarget.set(p.x + fx * 2.2 + ox, p.y + 0.12, p.z + fz * 2.2 + oz);
    }
    camPos.lerp(camGoalPos, Math.min(1, dt * (camMode === 'bordo' ? 14 : 6)));
    camTarget.lerp(camGoalTarget, Math.min(1, dt * (camMode === 'bordo' ? 16 : 8)));
  } else {
    overviewCamera(camGoalPos, camGoalTarget);
    camPos.lerp(camGoalPos, Math.min(1, dt * 3));
    camTarget.lerp(camGoalTarget, Math.min(1, dt * 3));
  }
  const wantOffset = racing && camMode === 'tv' && camera.aspect < 1 ? 0.09 : 0;
  viewOff += (wantOffset - viewOff) * Math.min(1, dt * 4);
  if (Math.abs(viewOff) > 0.001) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * viewOff, innerWidth, innerHeight);
  else camera.clearViewOffset();
  camera.fov = camMode === 'bordo' && racing ? 52 : 34;
  camera.updateProjectionMatrix();
  camera.position.copy(camPos);
  if (shake > 0) { shake = Math.max(0, shake - dt); camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake; }
  camera.lookAt(camTarget);
  renderer.render(scene, camera);
}

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
const ui = {
  splash: $('splash'), menu: $('menu'), circuits: $('circuits'), garage: $('garage'), hud: $('hud'),
  count: $('count'), toast: $('toast'), hudRows: $('hudRows'), timing: $('timing'),
};
const SCREENS = { menu: ui.menu, circuits: ui.circuits, garage: ui.garage, hud: ui.hud };
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
    card.className = 'tcard' + (c.st.Fr > 0.95 && c.st.v > 1 && !c.crash ? ' warn' : '');
    card.style.setProperty('--car', '#' + c.liv.color.toString(16).padStart(6, '0'));
    const cur = c.lap > 0 && !c.finished ? nowT - c.lapStart : null;
    const ref = race.mode === 'practica' ? recBest : c.best;
    const lapTxt = race.mode === 'practica' ? `Vuelta ${Math.max(1, c.lap)}` : c.finished ? '🏁 Terminado' : `Vuelta ${Math.max(1, c.lap)}/${race.laps}`;
    const pos = race.mode === 'practica' ? '' : `<div class="tpos"><b>${order.indexOf(c) + 1}º</b><small>/${cars.length}</small></div>`;
    const kmh = Math.round(Math.max(0, c.st.v) * 3.6 * 32);
    const delta = Number.isFinite(c.last) && Number.isFinite(ref) && c.laps.length ? c.last - ref : null;
    card.innerHTML = `${pos}<div class="tmain"><span class="tlap"></span><span class="tcur"></span>
      <span class="trow"><em>Última</em><i class="tlast"></i><em>Mejor</em><i class="tbest"></i></span></div>
      <div class="tside"><b class="tkmh"></b><small>km/h escala</small><span class="tdelta"></span></div>`;
    card.querySelector('.tlap').textContent = `${c.name} · ${lapTxt}`;
    card.querySelector('.tcur').textContent = cur != null ? fmt(cur) : '0,000';
    card.querySelector('.tlast').textContent = fmt(c.last);
    card.querySelector('.tbest').textContent = fmt(c.best);
    card.querySelector('.tkmh').textContent = kmh;
    const dEl = card.querySelector('.tdelta');
    if (delta != null && race.mode === 'practica') { dEl.textContent = fmtDelta(delta); dEl.className = 'tdelta ' + (delta <= 0 ? 'good' : 'bad'); }
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

// ---- Menú ----
let mode = '1p';
let trackSel = 0;
function showMenu() {
  state = 'menu';
  closeModal('mResults'); closeModal('mPause');
  demoRace();
  const pos = store.get('pos', {});
  $('trophies').textContent = `${TRACKS.filter((t) => pos[t.id] === 1).length}/${TRACKS.length}`;
  setScreen('menu');
}
function demoRace() {
  const def = TRACKS[2];
  buildTrack(def);
  physTrack = { L: T.L, DSU: DS, pts: T.pts };
  clearCars();
  [0, 1].forEach((l) => makeCar({ liv: LIVERIES[l], lane: l, human: false, name: 'demo', setupRaw: DEFAULT_SETUP, skill: 0.97 - l * 0.03 }));
  cars.forEach((c, i) => { c.st.s = i * 6; });
  race = { demo: true, simT: 0, acc: 0, goT: 0, started: true, laps: Infinity, def, humans: 0, finishedAt: null, mode: 'demo', cls: 'iman' };
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
function showCircuits() {
  state = 'circuits';
  $('circTitle').textContent = mode === '2p' ? '2 Jugadores · Circuito' : mode === 'practica' ? 'Práctica · Circuito' : 'Carrera · Circuito';
  const box = $('circList');
  box.innerHTML = '';
  const pos = store.get('pos', {}), best = store.get('best', {});
  TRACKS.forEach((def, i) => {
    const b = document.createElement('button');
    const un = mode === 'practica' || isUnlocked(i);
    b.className = 'circ' + (un ? '' : ' locked');
    b.appendChild(miniTrack(def));
    const info = document.createElement('div');
    info.className = 'ci';
    const nm = document.createElement('b'); nm.textContent = `${i + 1}. ${def.name}`;
    const meta = document.createElement('small'); meta.textContent = `${(sample(def).length * SCALE).toFixed(1).replace('.', ',')} m · ${def.lanes} carriles · ${def.laps} vueltas`;
    const rec = document.createElement('small'); rec.className = 'rec';
    const medal = pos[def.id] === 1 ? '🥇' : pos[def.id] === 2 ? '🥈' : pos[def.id] === 3 ? '🥉' : '';
    const bi = best[`${def.id}|iman`], bp = best[`${def.id}|pro`];
    rec.textContent = un ? `${medal} ${bi ? 'Imán ' + fmt(bi) : ''}${bi && bp ? ' · ' : ''}${bp ? 'Sin imán ' + fmt(bp) : ''}${!bi && !bp ? 'Sin récord' : ''}` : '🔒 Gana el anterior';
    info.append(nm, meta, rec);
    b.appendChild(info);
    b.disabled = !un;
    b.addEventListener('click', () => { sfx.click(); trackSel = i; showGarage(); });
    box.appendChild(b);
  });
  setScreen('circuits');
}
$('circBack').addEventListener('click', () => { sfx.click(); showMenu(); });

// ---- Taller: decoración y reglaje ----
let entries = [];
let editing = null; // { liv, setupRaw }
function showGarage() {
  state = 'garage';
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
  editing = { liv, setupRaw: { ...DEFAULT_SETUP, ...(saved || {}) } };
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
  $('garTrack').textContent = `${TRACKS[trackSel].name} · ${mode === 'practica' ? 'Práctica' : mode === '2p' ? '2 jugadores' : 'Carrera'}`;
  $('garPreview').innerHTML = carIcon(editing.liv);
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
  entries.push({ liv: editing.liv, setupRaw: { ...editing.setupRaw } });
  if (mode === '2p' && entries.length < 2) beginEntry();
  else startRace({ trackIdx: trackSel, mode, entries });
});
$('garBack').addEventListener('click', () => { sfx.click(); if (entries.length) { entries.pop(); beginEntry(); } else showCircuits(); });

// ---- Carrera: pausa, cámara y resultados ----
function pause() {
  if (state !== 'race' && state !== 'countdown') return;
  race.prevState = state;
  state = 'pause';
  for (const c of cars) updateEngine(c.engine, c.st, false);
  pads.forEach((p) => { p.id = null; p.value = 0; });
  $('quitBtn').querySelector('.btn-main').textContent = race.mode === 'practica' ? 'Terminar práctica' : 'Salir';
  openModal('mPause');
}
function resume() {
  if (state !== 'pause') return;
  closeModal('mPause');
  state = race.prevState || 'race';
  last = performance.now();
}
function toggleCam() {
  camMode = CAMS[(CAMS.indexOf(camMode) + 1) % CAMS.length];
  settings.cam = camMode; saveSettings();
  toast('📷 ' + CAM_NAME[camMode]);
}
$('pauseBtn').addEventListener('click', pause);
$('camBtn').addEventListener('click', () => { sfx.click(); toggleCam(); });
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => { closeModal('mPause'); if (race.mode === 'practica') endPractice(); startRace({ trackIdx: race.trackIdx, mode: race.mode, entries: race.entries }); });
$('quitBtn').addEventListener('click', () => { closeModal('mPause'); if (race.mode === 'practica') endPractice(); mode = race.mode; clearCars(); showCircuits(); demoRace(); });
$('againBtn').addEventListener('click', () => { closeModal('mResults'); startRace({ trackIdx: race.trackIdx, mode: race.mode, entries: race.entries }); });
$('nextBtn').addEventListener('click', () => { closeModal('mResults'); trackSel = race.trackIdx + 1; startRace({ trackIdx: trackSel, mode: race.mode, entries: race.entries }); });
$('resMenuBtn').addEventListener('click', () => { closeModal('mResults'); mode = race.mode; showCircuits(); demoRace(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---- Ajustes y estadísticas ----
function fillSettings() {
  $('optSound').checked = settings.sound;
  $('optVibe').checked = settings.vibe;
  $('optLefty').checked = settings.lefty;
  $('resetConfirm').hidden = true;
}
$('optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); initAudio(); setMuted(); sfx.click(); });
$('optVibe').addEventListener('change', (e) => { settings.vibe = e.target.checked; saveSettings(); vibrate(30); });
$('optLefty').addEventListener('change', (e) => { settings.lefty = e.target.checked; saveSettings(); });
$('resetBtn').addEventListener('click', () => { $('resetConfirm').hidden = false; });
$('resetNo').addEventListener('click', () => { $('resetConfirm').hidden = true; });
$('resetYes').addEventListener('click', () => {
  try { Object.keys(localStorage).filter((k) => k.startsWith('slot.') && !k.endsWith('settings')).forEach((k) => localStorage.removeItem(k)); } catch { /* nada */ }
  closeModal('mSettings'); showMenu(); toast('Progreso borrado');
});
function fillStats() {
  const s = store.get('stats', { races: 0, wins: 0, crashes: 0, laps: 0 });
  const pos = store.get('pos', {}), best = store.get('best', {});
  $('sRaces').textContent = s.races; $('sWins').textContent = s.wins; $('sLaps').textContent = s.laps || 0; $('sCrashes').textContent = s.crashes;
  const box = $('sTracks');
  box.innerHTML = '';
  TRACKS.forEach((t) => {
    const r = document.createElement('div');
    r.className = 'trow';
    const medal = pos[t.id] === 1 ? '🥇' : pos[t.id] === 2 ? '🥈' : pos[t.id] === 3 ? '🥉' : (pos[t.id] ? `${pos[t.id]}º` : '–');
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
window.addEventListener('gamepadconnected', () => toast('🎮 Mando conectado: usa el gatillo derecho'));

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
applyQuality();
showMenu();
overviewCamera(camPos, camTarget);
requestAnimationFrame(loop);
Promise.race([document.fonts ? document.fonts.load('700 20px Fredoka') : null, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .then(() => setTimeout(() => {
    ui.splash.classList.add('done');
    if (!store.get('seenHelp2', false)) { store.set('seenHelp2', true); setTimeout(() => openModal('mHelp'), 500); }
  }, 300));

// Gancho para pruebas automáticas
window.__slot = {
  get state() { return state; }, get cars() { return cars; }, get race() { return race; }, get T() { return T; },
  startRace, LIVERIES, DEFAULT_SETUP,
  setPad: (p, v) => { const pad = pads.find((x) => x.player === p); if (pad) { pad.id = 'test'; pad.value = v; } },
  setCam: (m) => { camMode = m; },
};
