// Turbo Slot — carreras de coches de slot en 3D.
import * as THREE from '../vendor/three.module.min.js';
import { TRACKS, sample, laneOffsets, LANE_W, DS } from './tracks.js';

// ---------------------------------------------------------------------------
// Utilidades y guardado
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const fmt = (t) => {
  if (!Number.isFinite(t)) return '–';
  const m = Math.floor(t / 60), s = t - m * 60;
  return (m ? `${m}:${s < 10 ? '0' : ''}` : '') + s.toFixed(2).replace('.', ',');
};
const store = {
  get(k, d) { try { const v = localStorage.getItem('slot.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('slot.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const settings = Object.assign({ sound: true, vibe: true, lefty: false }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
const vibrate = (p) => { if (settings.vibe && navigator.vibrate) navigator.vibrate(p); };

// ---------------------------------------------------------------------------
// Coches
// ---------------------------------------------------------------------------
export const CARS = [
  { id: 'rojo', name: 'Rayo Rojo', color: 0xe53935, accent: 0xffffff, vtop: 12.5, acc: 1.3, grip: 15, desc: 'Equilibrado' },
  { id: 'azul', name: 'Bala Azul', color: 0x1e88e5, accent: 0xffd54f, vtop: 13.6, acc: 1.2, grip: 13.4, desc: 'Muy rápido en recta, poco agarre' },
  { id: 'verde', name: 'Lagarto', color: 0x2fae5a, accent: 0x1b1b1b, vtop: 11.7, acc: 1.3, grip: 17.2, desc: 'Se pega a las curvas' },
  { id: 'amarillo', name: 'Avispa', color: 0xfbc02d, accent: 0x1b1b1b, vtop: 12.1, acc: 1.75, grip: 15, desc: 'Sale disparado' },
];
const RIVALS = ['Tornado', 'Chispa', 'Centella', 'Turbo'];
const KB = 3.2; // frenada del motor al soltar el gatillo

// ---------------------------------------------------------------------------
// Sonido sintetizado
// ---------------------------------------------------------------------------
let actx = null, master = null;
function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    master = actx.createGain();
    master.gain.value = settings.sound ? 0.9 : 0;
    master.connect(actx.destination);
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
function noise(dur, vol, freq = 1200) {
  if (!actx) return;
  if (!noiseBuf) {
    noiseBuf = actx.createBuffer(1, actx.sampleRate, actx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const s = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  s.buffer = noiseBuf; f.type = 'bandpass'; f.frequency.value = freq;
  const t = actx.currentTime;
  g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(g).connect(master);
  s.start(t); s.stop(t + dur);
}
const sfx = {
  click() { tone(900, 700, 0.05, 'triangle', 0.05); },
  light() { tone(520, 520, 0.18, 'square', 0.06); },
  go() { tone(1040, 1040, 0.4, 'square', 0.07); },
  lap() { tone(1320, 1320, 0.08, 'triangle', 0.06); tone(1760, 1760, 0.1, 'triangle', 0.06, 0.08); },
  crash() { noise(0.5, 0.35, 700); tone(160, 50, 0.35, 'sawtooth', 0.12); },
  finish() { [523, 659, 784, 1047].forEach((f, i) => tone(f, f, 0.22, 'square', 0.06, i * 0.12)); },
};
// Motor de cada coche: diente de sierra + filtro, y chirrido de ruedas
function makeEngine(human) {
  if (!actx) return null;
  const o1 = actx.createOscillator(), o2 = actx.createOscillator();
  o1.type = 'sawtooth'; o2.type = 'square';
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 900;
  const g = actx.createGain(); g.gain.value = 0;
  o1.connect(f); o2.connect(f); f.connect(g).connect(master);
  o1.start(); o2.start();
  let sq = null;
  if (human) {
    if (!noiseBuf) noise(0.01, 0.0001);
    const ns = actx.createBufferSource(); ns.buffer = noiseBuf; ns.loop = true;
    const nf = actx.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 2600; nf.Q.value = 3;
    const ng = actx.createGain(); ng.gain.value = 0;
    ns.connect(nf).connect(ng).connect(master); ns.start();
    sq = { ns, ng };
  }
  return { o1, o2, f, g, sq, vol: human ? 0.07 : 0.025 };
}
function updateEngine(e, v, thr, slip, on) {
  if (!e) return;
  const t = actx.currentTime;
  const fr = 55 + v * 26 + thr * 18;
  e.o1.frequency.setTargetAtTime(fr, t, 0.03);
  e.o2.frequency.setTargetAtTime(fr * 0.5, t, 0.03);
  e.f.frequency.setTargetAtTime(500 + v * 120, t, 0.05);
  e.g.gain.setTargetAtTime(on ? e.vol * (0.35 + 0.65 * Math.min(1, v / 8)) : 0, t, 0.05);
  if (e.sq) e.sq.ng.gain.setTargetAtTime(on ? clamp((slip - 0.78) * 0.5, 0, 0.1) : 0, t, 0.05);
}
function stopEngine(e) {
  if (!e) return;
  try { e.o1.stop(); e.o2.stop(); if (e.sq) e.sq.ns.stop(); } catch { /* ya parado */ }
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
  const road = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.75, side: THREE.DoubleSide }));
  road.receiveShadow = true;
  trackGroup.add(road);

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
// Coche 3D
// ---------------------------------------------------------------------------
const wheelGeo = new THREE.CylinderGeometry(0.055, 0.055, 0.05, 14).rotateX(Math.PI / 2);
const wheelMat = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8 });
const glassMat = new THREE.MeshStandardMaterial({ color: 0x1c2738, roughness: 0.1, metalness: 0.3 });
const lightMat = new THREE.MeshStandardMaterial({ color: 0xfff3c4, emissive: 0xffe9a0, emissiveIntensity: 1.2 });
const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff0000, emissiveIntensity: 0.8 });
function makeCarMesh(car) {
  const g = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: car.color, roughness: 0.3, metalness: 0.2 });
  const acc = new THREE.MeshStandardMaterial({ color: car.accent, roughness: 0.4 });
  const sh = new THREE.Shape();
  sh.moveTo(-0.29, 0.03); sh.lineTo(0.29, 0.03); sh.lineTo(0.3, 0.06); sh.lineTo(0.14, 0.085);
  sh.lineTo(0.04, 0.135); sh.lineTo(-0.12, 0.14); sh.lineTo(-0.24, 0.11); sh.lineTo(-0.3, 0.1); sh.closePath();
  const bodyGeo = new THREE.ExtrudeGeometry(sh, { depth: 0.24, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }).translate(0, 0, -0.12);
  const b = new THREE.Mesh(bodyGeo, body); b.castShadow = true; g.add(b);
  const cab = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, 0.17), glassMat); cab.position.set(-0.04, 0.155, 0); g.add(cab);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.006, 0.055), acc); stripe.position.set(0.02, 0.144, 0); g.add(stripe);
  const wing = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.015, 0.29), acc); wing.position.set(-0.27, 0.175, 0); wing.castShadow = true; g.add(wing);
  for (const z of [-0.08, 0.08]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.06, 0.015), acc); st.position.set(-0.26, 0.14, z); g.add(st); }
  for (const [x, z] of [[0.18, 0.13], [0.18, -0.13], [-0.18, 0.13], [-0.18, -0.13]]) { const w = new THREE.Mesh(wheelGeo, wheelMat); w.position.set(x, 0.055, z); w.castShadow = true; g.add(w); }
  for (const z of [-0.08, 0.08]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.05), lightMat); hl.position.set(0.3, 0.06, z); g.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.02, 0.05), tailMat); tl.position.set(-0.3, 0.08, z); g.add(tl);
  }
  // Indicador de jugador
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.4, 32), new THREE.MeshBasicMaterial({ color: car.color, transparent: true, opacity: 0.0, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = 0.01;
  g.add(ring);
  g.userData.ring = ring;
  return g;
}

// ---------------------------------------------------------------------------
// Cámara
// ---------------------------------------------------------------------------
let camMode = 'mesa';
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
  // El eje largo del circuito va en el eje largo de la pantalla
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
  // Deja sitio abajo para los mandos
  target.set(Math.sin(a) * 0.9 * (portrait ? 1 : 0.4), 0, Math.cos(a) * 0.9 * (portrait ? 1 : 0.4));
}

// ---------------------------------------------------------------------------
// Carrera
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | circuits | garage | countdown | race | pause | results
let race = null;
let cars = [];

function clearCars() {
  for (const c of cars) stopEngine(c.engine);
  disposeGroup(carsGroup);
  cars = [];
}

function speedProfile(lane, grip, vtop) {
  const P = T.pts, n = P.length, d = T.offsets[lane];
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const k = P[i].k;
    const kl = Math.abs(k / (1 - k * d));
    v[i] = kl > 1e-4 ? Math.min(vtop, Math.sqrt(grip / kl)) : vtop;
  }
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      v[i] = Math.min(v[i], v[j] + KB * DS);
    }
  }
  return v;
}

function makeCar({ car, lane, human, player, name, skill }) {
  const mesh = makeCarMesh(car);
  carsGroup.add(mesh);
  const c = {
    car, lane, d: T.offsets[lane], human, player, name, skill: skill || 1,
    s: T.L - 0.45, v: 0, thr: 0, over: 0, state: 'run', mesh,
    lap: 0, lapStart: 0, laps: [], best: Infinity, finished: false, finishTime: 0,
    crash: null, blink: 0, mistake: 0, crashes: 0,
    engine: makeEngine(human),
    prof: human ? null : speedProfile(lane, car.grip * (skill || 1), car.vtop),
  };
  if (human) mesh.userData.ring.material.opacity = 0.85;
  mesh.scale.setScalar(1.3); // un poco más grandes para verlos bien en el móvil
  cars.push(c);
  placeCar(c, 0);
  return c;
}

function placeCar(c, slip) {
  const p = at(c.s, c.d);
  const yaw = Math.sign(p.k) * Math.pow(clamp(slip, 0, 1.2), 3) * 0.42;
  c.mesh.position.set(p.x, p.y + 0.004, p.z);
  c.mesh.rotation.set(0, -(p.h + yaw), 0);
  c.mesh.rotateZ(Math.atan(p.slope));
}

function startRace({ trackIdx, mode, picks }) {
  initAudio();
  const def = TRACKS[trackIdx];
  buildTrack(def);
  clearCars();
  const lanes = def.lanes;
  const humans = mode === '2p' ? 2 : 1;
  const used = new Set(picks);
  const others = CARS.filter((c) => !used.has(c.id));
  const base = 0.86 + trackIdx * 0.024;
  for (let l = 0; l < lanes; l++) {
    if (l < humans) {
      const car = CARS.find((c) => c.id === picks[l]);
      makeCar({ car, lane: humans === 2 ? l : lanes - 1 - l, human: true, player: l, name: humans === 2 ? `Jugador ${l + 1}` : 'Tú' });
    }
  }
  const free = [...Array(lanes).keys()].filter((l) => !cars.some((c) => c.lane === l));
  free.forEach((l, i) => {
    const car = others[i % others.length];
    const skill = clamp(base + (free.length > 1 ? (i - (free.length - 1) / 2) * 0.03 : 0) + (mode === '2p' ? 0.01 : 0), 0.8, 0.985);
    makeCar({ car, lane: l, human: false, name: RIVALS[i % RIVALS.length], skill });
  });
  race = { trackIdx, def, mode, laps: def.laps, t: 0, cd: 0, lightsOn: 0, goAt: 4.2 + Math.random() * 0.8, started: false, finishedAt: null, humans };
  state = 'countdown';
  camMode = store.get('cam', 'mesa');
  setupSliders();
  setScreen('hud');
  updateHud();
  T.lights.forEach((m) => { m.material.emissive.setHex(0x000000); m.material.color.setHex(0x331111); });
  ui.count.textContent = '';
}

function crashCar(c, p) {
  c.state = 'crash';
  c.crashes++;
  const tx = Math.cos(p.h), tz = Math.sin(p.h);
  const out = -Math.sign(p.k) || 1;
  const nx = -Math.sin(p.h) * out, nz = Math.cos(p.h) * out;
  c.crash = {
    x: c.mesh.position.x, y: c.mesh.position.y, z: c.mesh.position.z,
    vx: tx * c.v * 0.9 + nx * c.v * 0.35, vz: tz * c.v * 0.9 + nz * c.v * 0.35, vy: 1.6 + c.v * 0.12,
    yaw: -(p.h), spin: (Math.random() < 0.5 ? -1 : 1) * (6 + Math.random() * 6), roll: 0, t: 0,
  };
  c.v = 0; c.over = 0;
  if (c.human) { sfx.crash(); vibrate([60, 40, 90]); shake = 0.25; flashText(c.player, '¡FUERA!'); }
  else noise(0.25, 0.08, 800);
}

function stepCar(c, dt) {
  if (c.state === 'crash') {
    const k = c.crash;
    k.t += dt;
    k.vy -= 9 * dt;
    k.x += k.vx * dt; k.z += k.vz * dt; k.y += k.vy * dt;
    if (k.y < 0.004) { k.y = 0.004; k.vy = Math.abs(k.vy) * 0.25; const f = Math.exp(-5 * dt); k.vx *= f; k.vz *= f; k.spin *= f; }
    k.yaw += k.spin * dt;
    k.roll += k.spin * 0.25 * dt;
    c.mesh.position.set(k.x, k.y, k.z);
    c.mesh.rotation.set(Math.sin(k.roll) * 0.4, k.yaw, 0);
    if (k.t > 1.5) { c.state = 'run'; c.blink = 0.8; c.v = 0; }
    return 0;
  }
  if (!race.started || c.finished && !c.human) {
    if (c.finished) { c.v = Math.max(0, c.v - 4 * dt); } else c.v = 0;
  }
  const p = at(c.s, c.d);
  // Mando: la IA calcula su gatillo con su perfil de velocidad
  if (!c.human) {
    const i = Math.floor((((c.s % T.L) + T.L) % T.L) / DS) % T.pts.length;
    if (c.mistake > 0) c.mistake -= dt;
    const tgt = c.prof[(i + 6) % c.prof.length] * (c.mistake > 0 ? 1.06 : 1);
    c.thr = clamp(tgt / c.car.vtop + (tgt - c.v) * 0.8, 0, 1);
  }
  if (race.started && !(c.finished && !c.human)) {
    const target = c.thr * c.car.vtop;
    c.v += (target - c.v) * (target > c.v ? c.car.acc : KB) * dt;
    c.v -= p.slope * 6 * dt;
    c.v = Math.max(0, c.v);
  }
  const kl = p.k / (1 - p.k * c.d);
  const g = c.v * c.v * Math.abs(kl);
  const slip = g / c.car.grip;
  if (c.blink > 0) c.blink -= dt;
  else if (slip > 1) { c.over += (slip - 1) * dt * 14; if (c.over > 0.12) { crashCar(c, p); return slip; } }
  else c.over = Math.max(0, c.over - dt * 0.6);
  const ds = (c.v / (1 - p.k * c.d)) * dt;
  const before = c.s;
  c.s += ds;
  if (c.s >= T.L) {
    c.s -= T.L;
    crossLine(c);
  } else if (before < 0) c.s = Math.max(c.s, 0);
  placeCar(c, slip);
  c.mesh.visible = c.blink > 0 ? Math.floor(c.blink * 12) % 2 === 0 : true;
  return slip;
}

function crossLine(c) {
  const now = race.t - race.goAt;
  if (c.lap === 0) { c.lap = 1; c.lapStart = now; return; }
  const lt = now - c.lapStart;
  c.laps.push(lt);
  if (lt < c.best) c.best = lt;
  c.lapStart = now;
  if (c.human) {
    sfx.lap();
    const bestKey = store.get('best', {});
    const rec = bestKey[race.def.id];
    if (!rec || lt < rec) { bestKey[race.def.id] = lt; store.set('best', bestKey); if (c.laps.length > 1 || rec) flashText(c.player, '¡Vuelta rápida!'); }
  }
  if (c.lap >= race.laps) {
    c.finished = true;
    c.finishTime = now;
    if (c.human) { sfx.finish(); vibrate([30, 30, 30, 30, 100]); flashText(c.player, '🏁 ¡Meta!'); }
  } else c.lap++;
}

function progress(c) {
  if (c.finished) return 1e6 - c.finishTime;
  return c.lap === 0 ? c.s - T.L : (c.lap - 1) * T.L + c.s;
}
function standings() { return [...cars].sort((a, b) => progress(b) - progress(a)); }

function stepRace(dt) {
  race.t += dt;
  if (state === 'countdown') {
    const lit = Math.min(5, Math.floor(race.t / 0.7));
    if (lit > race.lightsOn) {
      race.lightsOn = lit;
      T.lights[lit - 1].material.emissive.setHex(0xff1a1a);
      T.lights[lit - 1].material.color.setHex(0xff3b3b);
      sfx.light();
    }
    if (race.t >= race.goAt) {
      race.started = true;
      state = 'race';
      T.lights.forEach((m) => { m.material.emissive.setHex(0x000000); m.material.color.setHex(0x331111); });
      sfx.go();
      ui.count.textContent = '¡YA!';
      ui.count.classList.remove('pop'); void ui.count.offsetWidth; ui.count.classList.add('pop');
      setTimeout(() => { if (ui.count.textContent === '¡YA!') ui.count.textContent = ''; }, 900);
    }
  }
  for (const c of cars) {
    if (c.human) c.thr = readThrottle(c.player, dt);
    else if (race.started && Math.random() < dt * 0.025) c.mistake = 1.0; // despistes ocasionales
    let slip = 0;
    const sub = 4;
    for (let k = 0; k < sub; k++) slip = stepCar(c, dt / sub);
    updateEngine(c.engine, c.v, c.thr, slip, c.state === 'run');
    if (c.human) c.slip = slip;
  }
  // Fin de carrera: cuando todos los humanos han terminado
  const humansDone = cars.filter((c) => c.human).every((c) => c.finished);
  if (humansDone && race.finishedAt === null) race.finishedAt = race.t;
  if (race.finishedAt !== null && race.t - race.finishedAt > 1.6 && state === 'race') endRace();
}

function endRace() {
  state = 'results';
  for (const c of cars) updateEngine(c.engine, 0, 0, 0, false);
  const order = standings();
  const tbl = $('resTable');
  tbl.innerHTML = '';
  order.forEach((c, i) => {
    const tr = document.createElement('div');
    tr.className = 'row' + (c.human ? ' me' : '');
    const pos = document.createElement('b'); pos.textContent = `${i + 1}º`;
    const dot = document.createElement('i'); dot.style.background = '#' + c.car.color.toString(16).padStart(6, '0');
    const nm = document.createElement('span'); nm.className = 'nm'; nm.textContent = c.name;
    const tm = document.createElement('span'); tm.className = 'tm'; tm.textContent = c.finished ? fmt(c.finishTime) : `+${race.laps - c.lap + 1} v.`;
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
  $('resSub').textContent = `${race.def.name} · ${race.laps} vueltas`;
  const best = store.get('best', {})[race.def.id];
  $('resBest').textContent = best ? `Récord de vuelta: ${fmt(best)}` : '';
  const nextIdx = race.trackIdx + 1;
  const canNext = nextIdx < TRACKS.length && isUnlocked(nextIdx);
  $('nextBtn').hidden = !canNext;
  const unlockedNow = race.mode !== '2p' && myPos === 1 && nextIdx < TRACKS.length;
  $('resUnlock').hidden = !unlockedNow;
  if (unlockedNow) $('resUnlock').textContent = `🔓 Desbloqueado: ${TRACKS[nextIdx].name}`;
  setTimeout(() => openModal('mResults'), 300);
  const stats = store.get('stats', { races: 0, wins: 0, crashes: 0 });
  stats.races++; if (myPos === 1 && race.mode !== '2p') stats.wins++;
  stats.crashes += cars.filter((c) => c.human).reduce((a, c) => a + c.crashes, 0);
  store.set('stats', stats);
}

function isUnlocked(i) {
  if (i === 0) return true;
  const pos = store.get('pos', {});
  return pos[TRACKS[i - 1].id] === 1 || !!pos[TRACKS[i].id];
}

// ---------------------------------------------------------------------------
// Mandos: un gatillo deslizante por jugador
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
    el.style.setProperty('--car', '#' + c.car.color.toString(16).padStart(6, '0'));
    el.innerHTML = '<div class="pad-track"><div class="pad-fill"></div><div class="pad-knob"><span></span></div></div><div class="pad-label"></div>';
    el.querySelector('.pad-label').textContent = race.humans === 2 ? `J${c.player + 1}` : 'GAS';
    box.appendChild(el);
    const pad = { el, player: c.player, id: null, value: 0 };
    const trackEl = el.querySelector('.pad-track');
    const setFrom = (e) => {
      const r = trackEl.getBoundingClientRect();
      pad.value = clamp((r.bottom - e.clientY) / r.height, 0, 1);
    };
    el.addEventListener('pointerdown', (e) => { initAudio(); pad.id = e.pointerId; try { el.setPointerCapture(e.pointerId); } catch { /* nada */ } setFrom(e); });
    el.addEventListener('pointermove', (e) => { if (pad.id === e.pointerId) setFrom(e); });
    const up = (e) => { if (pad.id === e.pointerId) { pad.id = null; pad.value = 0; } };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    pads.push(pad);
  });
}
function readThrottle(player, dt) {
  const pad = pads.find((p) => p.player === player);
  let v = pad ? pad.value : 0;
  // Teclado: jugador 1 con ↑ o espacio, jugador 2 con W
  const k = player === 0 ? (keys.has('ArrowUp') || keys.has(' ')) : keys.has('w');
  if (k) v = Math.max(v, throttles[player] + dt * 3);
  else if (!pad || pad.id === null) v = Math.max(v, throttles[player] - dt * 6);
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
let tAll = 0;
let viewOff = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  tAll += dt;
  requestAnimationFrame(loop);
  if (!T) return;
  if (state === 'countdown' || state === 'race' || state === 'results') {
    stepRace(dt);
    updateHud();
  } else if (state === 'menu' || state === 'circuits' || state === 'garage') {
    // Modo exhibición: la CPU corre sola
    if (race) {
      race.t += dt;
      race.started = true;
      for (const c of cars) { const sl = stepCar(c, dt); updateEngine(c.engine, c.v, c.thr, sl, false); }
    }
    orbit += dt * 0.06;
  }

  // Cámara
  if (camMode === 'coche' && (state === 'race' || state === 'countdown' || state === 'pause') && cars.length) {
    const me = cars.find((c) => c.human) || cars[0];
    const p = at(me.s, me.d); // tras una salida, la cámara espera en la pista
    const fx = Math.cos(p.h), fz = Math.sin(p.h);
    camGoalPos.set(p.x - fx * 2.4 - T.center.x, p.y + 1.5, p.z - fz * 2.4 - T.center.z);
    camGoalTarget.set(p.x + fx * 1.6 - T.center.x, p.y, p.z + fz * 1.6 - T.center.z);
    camPos.lerp(camGoalPos, Math.min(1, dt * 5));
    camTarget.lerp(camGoalTarget, Math.min(1, dt * 6));
  } else {
    overviewCamera(camGoalPos, camGoalTarget);
    camPos.lerp(camGoalPos, Math.min(1, dt * 3));
    camTarget.lerp(camGoalTarget, Math.min(1, dt * 3));
  }
  // En vertical, sube la imagen para que la pista quede por encima del mando
  const racing = state === 'race' || state === 'countdown' || state === 'pause' || state === 'results';
  const wantOffset = racing && camMode === 'mesa' && camera.aspect < 1 ? 0.09 : 0;
  viewOff += (wantOffset - viewOff) * Math.min(1, dt * 4);
  if (Math.abs(viewOff) > 0.001) camera.setViewOffset(innerWidth, innerHeight, 0, innerHeight * viewOff, innerWidth, innerHeight);
  else camera.clearViewOffset();
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
  count: $('count'), toast: $('toast'), hudRows: $('hudRows'),
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
  setTimeout(() => el.remove(), 1200);
}

function updateHud() {
  if (!race) return;
  const order = standings();
  const humans = cars.filter((c) => c.human).sort((a, b) => a.player - b.player);
  ui.hudRows.innerHTML = '';
  for (const c of humans) {
    const row = document.createElement('div');
    row.className = 'hud-card';
    row.style.setProperty('--car', '#' + c.car.color.toString(16).padStart(6, '0'));
    const pos = order.indexOf(c) + 1;
    const cur = c.lap > 0 && !c.finished ? race.t - race.goAt - c.lapStart : null;
    row.innerHTML = `<div class="pos"><b></b><small>/${cars.length}</small></div><div class="info"><span class="who"></span><span class="lap"></span><span class="time"></span></div>`;
    row.querySelector('.pos b').textContent = pos + 'º';
    row.querySelector('.who').textContent = c.name;
    row.querySelector('.lap').textContent = c.finished ? '🏁 Terminado' : `Vuelta ${Math.max(1, c.lap)}/${race.laps}`;
    row.querySelector('.time').textContent = `${cur != null ? fmt(cur) : '–'}  ·  Mejor ${fmt(c.best)}`;
    if (c.slip > 0.85 && c.state === 'run') row.classList.add('warn');
    ui.hudRows.appendChild(row);
  }
}

// ---- Menú ----
let mode = '1p';
let trackSel = 0;
function showMenu() {
  state = 'menu';
  closeModal('mResults'); closeModal('mPause');
  // Exhibición en el óvalo con todos los coches de la CPU
  demoRace();
  const pos = store.get('pos', {});
  $('trophies').textContent = `${TRACKS.filter((t) => pos[t.id] === 1).length}/${TRACKS.length}`;
  setScreen('menu');
}
function demoRace() {
  const def = TRACKS[2];
  buildTrack(def);
  clearCars();
  [0, 1].forEach((l) => makeCar({ car: CARS[l === 0 ? 0 : 1], lane: l, human: false, name: 'demo', skill: 0.95 - l * 0.03 }));
  cars.forEach((c, i) => { c.s = i * 5; });
  race = { t: 0, goAt: 0, started: true, laps: 99, def, humans: 0, finishedAt: null };
}
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
  $('circTitle').textContent = mode === '2p' ? '2 Jugadores · Circuito' : 'Elige circuito';
  const box = $('circList');
  box.innerHTML = '';
  const pos = store.get('pos', {}), best = store.get('best', {});
  TRACKS.forEach((def, i) => {
    const b = document.createElement('button');
    const un = isUnlocked(i);
    b.className = 'circ' + (un ? '' : ' locked');
    b.appendChild(miniTrack(def));
    const info = document.createElement('div');
    info.className = 'ci';
    const nm = document.createElement('b'); nm.textContent = `${i + 1}. ${def.name}`;
    const meta = document.createElement('small'); meta.textContent = `${def.lanes} carriles · ${def.laps} vueltas`;
    const rec = document.createElement('small'); rec.className = 'rec';
    const medal = pos[def.id] === 1 ? '🥇' : pos[def.id] === 2 ? '🥈' : pos[def.id] === 3 ? '🥉' : '';
    rec.textContent = un ? `${medal} ${best[def.id] ? 'Récord ' + fmt(best[def.id]) : 'Sin récord'}` : '🔒 Gana el anterior';
    info.append(nm, meta, rec);
    b.appendChild(info);
    b.disabled = !un;
    b.addEventListener('click', () => { sfx.click(); trackSel = i; showGarage(); });
    box.appendChild(b);
  });
  setScreen('circuits');
}
$('circBack').addEventListener('click', () => { sfx.click(); showMenu(); });

// ---- Garaje ----
let picks = [];
function carIcon(car) {
  const hex = '#' + car.color.toString(16).padStart(6, '0'), acc = '#' + car.accent.toString(16).padStart(6, '0');
  return `<svg viewBox="0 0 120 60" class="caricon"><ellipse cx="60" cy="52" rx="50" ry="5" fill="rgba(0,0,0,.25)"/>
    <path d="M8 40 L10 30 L40 26 L58 14 L84 14 L100 24 L114 28 L114 40 Z" fill="${hex}"/>
    <path d="M60 17 L82 17 L92 25 L52 25 Z" fill="#1c2738"/><rect x="18" y="31" width="80" height="4" fill="${acc}"/>
    <rect x="2" y="22" width="14" height="5" rx="1" fill="${acc}"/><circle cx="32" cy="42" r="9" fill="#151515"/><circle cx="92" cy="42" r="9" fill="#151515"/>
    <circle cx="32" cy="42" r="3.5" fill="#888"/><circle cx="92" cy="42" r="3.5" fill="#888"/></svg>`;
}
function showGarage() {
  state = 'garage';
  picks = [];
  renderGarage();
  setScreen('garage');
}
function renderGarage() {
  const player = picks.length;
  $('garTitle').textContent = mode === '2p' ? `Jugador ${player + 1}: elige coche` : 'Elige tu coche';
  $('garTrack').textContent = TRACKS[trackSel].name;
  const box = $('carList');
  box.innerHTML = '';
  const maxV = Math.max(...CARS.map((c) => c.vtop)), maxA = Math.max(...CARS.map((c) => c.acc)), maxG = Math.max(...CARS.map((c) => c.grip));
  CARS.forEach((car) => {
    const b = document.createElement('button');
    const taken = picks.includes(car.id);
    b.className = 'car' + (taken ? ' taken' : '');
    b.disabled = taken;
    b.innerHTML = carIcon(car) + '<div class="cn"><b></b><small></small></div>' +
      [['Velocidad', car.vtop / maxV], ['Aceleración', car.acc / maxA], ['Agarre', car.grip / maxG]].map(([n, v]) => `<div class="stat"><span>${n}</span><i><em style="width:${Math.round(v * 100)}%"></em></i></div>`).join('');
    b.querySelector('.cn b').textContent = car.name;
    b.querySelector('.cn small').textContent = taken ? 'Elegido por J1' : car.desc;
    b.addEventListener('click', () => {
      sfx.click();
      picks.push(car.id);
      store.set('car', car.id);
      if (mode === '2p' && picks.length < 2) renderGarage();
      else startRace({ trackIdx: trackSel, mode, picks });
    });
    box.appendChild(b);
  });
}
$('garBack').addEventListener('click', () => { sfx.click(); if (picks.length) { picks.pop(); renderGarage(); } else showCircuits(); });

// ---- Carrera: pausa, cámara y resultados ----
function pause() {
  if (state !== 'race' && state !== 'countdown') return;
  race.prevState = state;
  state = 'pause';
  for (const c of cars) updateEngine(c.engine, 0, 0, 0, false);
  pads.forEach((p) => { p.id = null; p.value = 0; });
  openModal('mPause');
}
function resume() {
  if (state !== 'pause') return;
  closeModal('mPause');
  state = race.prevState || 'race';
  last = performance.now();
}
function toggleCam() {
  camMode = camMode === 'mesa' ? 'coche' : 'mesa';
  store.set('cam', camMode);
  toast(camMode === 'mesa' ? '📷 Vista de mesa' : '📷 Vista de coche');
}
$('pauseBtn').addEventListener('click', pause);
$('camBtn').addEventListener('click', () => { sfx.click(); toggleCam(); });
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', () => { closeModal('mPause'); startRace({ trackIdx: race.trackIdx, mode: race.mode, picks }); });
$('quitBtn').addEventListener('click', () => { closeModal('mPause'); clearCars(); showMenu(); });
$('againBtn').addEventListener('click', () => { closeModal('mResults'); startRace({ trackIdx: race.trackIdx, mode: race.mode, picks }); });
$('nextBtn').addEventListener('click', () => { closeModal('mResults'); trackSel = race.trackIdx + 1; startRace({ trackIdx: trackSel, mode: race.mode, picks }); });
$('resMenuBtn').addEventListener('click', () => { closeModal('mResults'); mode = race.mode; showCircuits(); demoRace(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---- Ajustes y estadísticas ----
function fillSettings() {
  $('optSound').checked = settings.sound;
  $('optVibe').checked = settings.vibe;
  $('optLefty').checked = settings.lefty;
}
$('optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); initAudio(); setMuted(); sfx.click(); });
$('optVibe').addEventListener('change', (e) => { settings.vibe = e.target.checked; saveSettings(); vibrate(30); });
$('optLefty').addEventListener('change', (e) => { settings.lefty = e.target.checked; saveSettings(); });
$('resetBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar récords y circuitos desbloqueados?')) return;
  for (const k of ['pos', 'best', 'stats']) { try { localStorage.removeItem('slot.' + k); } catch { /* nada */ } }
  closeModal('mSettings'); showMenu(); toast('Progreso borrado');
});
function fillStats() {
  const s = store.get('stats', { races: 0, wins: 0, crashes: 0 });
  const pos = store.get('pos', {}), best = store.get('best', {});
  $('sRaces').textContent = s.races; $('sWins').textContent = s.wins; $('sCrashes').textContent = s.crashes;
  const box = $('sTracks');
  box.innerHTML = '';
  TRACKS.forEach((t) => {
    const r = document.createElement('div');
    r.className = 'trow';
    const medal = pos[t.id] === 1 ? '🥇' : pos[t.id] === 2 ? '🥈' : pos[t.id] === 3 ? '🥉' : (pos[t.id] ? `${pos[t.id]}º` : '–');
    r.innerHTML = '<span></span><b></b><em></em>';
    r.querySelector('span').textContent = t.name;
    r.querySelector('b').textContent = medal;
    r.querySelector('em').textContent = best[t.id] ? fmt(best[t.id]) : '–';
    box.appendChild(r);
  });
}

window.addEventListener('resize', fitCamera);
window.addEventListener('orientationchange', () => setTimeout(fitCamera, 250));

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
fitCamera();
showMenu();
overviewCamera(camPos, camTarget);
requestAnimationFrame(loop);
Promise.race([document.fonts ? document.fonts.load('700 20px Fredoka') : null, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .then(() => setTimeout(() => {
    ui.splash.classList.add('done');
    if (!store.get('seenHelp', false)) { store.set('seenHelp', true); setTimeout(() => openModal('mHelp'), 500); }
  }, 300));

// Gancho para pruebas automáticas
window.__slot = {
  get state() { return state; }, get cars() { return cars; }, get race() { return race; }, get T() { return T; },
  startRace, showCircuits, showGarage, setPad: (p, v) => { const pad = pads.find((x) => x.player === p); if (pad) { pad.id = 'test'; pad.value = v; } },
};
