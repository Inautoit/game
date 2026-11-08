'use strict';
/*
 * Corte Perfecto — corta cada figura en dos mitades exactas.
 * Canvas 2D, sin librerías. Funciona en móvil, iPad y PC.
 */

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const TAU = Math.PI * 2;
const fmt = (n) => n.toFixed(1).replace('.', ',');

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
let rng = Math.random;            // aleatorio de la partida (determinista en el reto diario)
const R = (a, b) => a + rng() * (b - a);
const VR = (a, b) => a + Math.random() * (b - a); // aleatorio solo visual

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('corte.' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('corte.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// Número del reto diario (#1 = 8 nov 2026), según la fecha local
function dayIndex() {
  const d = new Date();
  return Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(2026, 10, 8)) / 864e5) + 1;
}

function mix(hex, to, t) {
  const a = parseInt(hex.slice(1), 16), b = parseInt(to.slice(1), 16);
  const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return `rgb(${c(16)},${c(8)},${c(0)})`;
}

// ---------------------------------------------------------------------------
// Geometría
// ---------------------------------------------------------------------------
function polyArea(p) {
  let s = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

function centroid(p) {
  let A = 0, cx = 0, cy = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const a = p[i], b = p[(i + 1) % n];
    const c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  A /= 2;
  if (Math.abs(A) < 1e-9) {
    const m = p.reduce((s, q) => [s[0] + q[0], s[1] + q[1]], [0, 0]);
    return [m[0] / p.length, m[1] / p.length];
  }
  return [cx / (6 * A), cy / (6 * A)];
}

// Recorta un polígono (convexo o cóncavo) con un semiplano.
// El área (fórmula del lazo) del resultado es exacta también en cóncavos.
function clipHalf(pts, a, b, sign, hits) {
  const out = [];
  const sd = (p) => sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]));
  for (let i = 0, n = pts.length; i < n; i++) {
    const P = pts[i], Q = pts[(i + 1) % n];
    const sp = sd(P), sq = sd(Q);
    if (sp >= 0) out.push(P);
    if ((sp >= 0) !== (sq >= 0)) {
      const t = sp / (sp - sq);
      const X = [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t];
      out.push(X);
      if (hits) hits.push(X);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Figuras
// ---------------------------------------------------------------------------
const angDist = (a, b) => { let d = Math.abs(a - b) % TAU; return d > Math.PI ? TAU - d : d; };
function polar(f, n = 120) {
  const p = [];
  for (let i = 0; i < n; i++) { const t = (i / n) * TAU; const r = f(t); p.push([Math.cos(t) * r, Math.sin(t) * r]); }
  return p;
}

function face(x, y, s) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(s, s);
  ctx.fillStyle = 'rgba(255,90,120,0.35)';
  for (const sx of [-0.4, 0.4]) { ctx.beginPath(); ctx.ellipse(sx, 0.12, 0.12, 0.07, 0, 0, TAU); ctx.fill(); }
  for (const sx of [-0.24, 0.24]) {
    ctx.fillStyle = '#2b1a1a';
    ctx.beginPath(); ctx.ellipse(sx, -0.04, 0.07, 0.09, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.arc(sx + 0.025, -0.07, 0.025, 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = '#2b1a1a';
  ctx.lineWidth = 0.045;
  ctx.lineCap = 'round';
  ctx.beginPath(); ctx.arc(0, 0.05, 0.1, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
  ctx.restore();
}

function shine(x, y, rx, ry, rot = -0.6) {
  ctx.fillStyle = 'rgba(255,255,255,0.4)';
  ctx.beginPath(); ctx.ellipse(x, y, rx, ry, rot, 0, TAU); ctx.fill();
}

function stemLeaf(x, y, h) {
  ctx.strokeStyle = '#6b3f1d'; ctx.lineWidth = 0.07; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x, y + 0.05); ctx.quadraticCurveTo(x + 0.02, y - h * 0.6, x + 0.09, y - h); ctx.stroke();
  ctx.fillStyle = '#47b04b';
  ctx.beginPath(); ctx.ellipse(x + 0.26, y - h * 0.8, 0.2, 0.085, -0.5, 0, TAU); ctx.fill();
}

// Cada tipo: genera puntos (coords "originales") y decora dentro (inner) o fuera (outer).
const TYPES = {
  manzana: {
    name: 'Manzana', fill: '#ef3b47', dark: '#a3141f', flesh: '#fff3d4', upright: true,
    gen: () => polar((t) => 1 - 0.2 * Math.exp(-(angDist(t, -Math.PI / 2) ** 2) / 0.06) - 0.08 * Math.exp(-(angDist(t, Math.PI / 2) ** 2) / 0.05) + 0.05 * Math.cos(2 * t)),
    inner() { shine(-0.4, -0.35, 0.22, 0.11); face(0, 0.1, 0.95); },
    outer() { stemLeaf(0, -0.72, 0.33); },
  },
  naranja: {
    name: 'Naranja', fill: '#ff9b26', dark: '#c96400', flesh: '#ffc56b', upright: true,
    gen: () => polar((t) => 1 + 0.015 * Math.sin(9 * t) + 0.08 * Math.sin(t)), // un poco de huevo: sin simetría central
    inner(sh) {
      ctx.fillStyle = 'rgba(201,100,0,0.25)';
      for (const [x, y] of sh.dots) { ctx.beginPath(); ctx.arc(x, y, 0.025, 0, TAU); ctx.fill(); }
      shine(-0.4, -0.4, 0.22, 0.11); face(0, 0.08, 0.95);
    },
    outer() { ctx.fillStyle = '#47b04b'; ctx.beginPath(); ctx.ellipse(0.12, -1.02, 0.16, 0.07, -0.3, 0, TAU); ctx.fill(); },
  },
  sandia: {
    name: 'Sandía', fill: '#3aa24a', dark: '#1f6b2b', flesh: '#ff5468',
    gen: () => polar((t) => (1 + 0.1 * Math.cos(t)) / Math.sqrt((Math.cos(t) / 1.15) ** 2 + (Math.sin(t) / 0.85) ** 2)),
    inner() {
      ctx.strokeStyle = '#1f6b2b'; ctx.lineWidth = 0.1;
      for (let k = -4; k <= 4; k++) {
        ctx.beginPath();
        for (let y = -1.1; y <= 1.1; y += 0.05) { const x = k * 0.3 + 0.05 * Math.sin(y * 9); y === -1.1 ? ctx.moveTo(x, y) : ctx.lineTo(x, y); }
        ctx.stroke();
      }
      shine(-0.5, -0.4, 0.25, 0.1); face(0, 0.05, 0.9);
    },
  },
  corazon: {
    name: 'Corazón', fill: '#ff5f93', dark: '#c22a5c', flesh: '#ffd3e2', upright: true,
    gen: () => {
      const p = [];
      for (let i = 0; i < 140; i++) {
        const t = (i / 140) * TAU;
        p.push([(16 * Math.sin(t) ** 3) / 16, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)) / 16]);
      }
      return p;
    },
    inner() { shine(-0.5, -0.45, 0.18, 0.09); face(0, 0.05, 0.85); },
  },
  estrella: {
    name: 'Estrella', fill: '#ffcf33', dark: '#d19a00', flesh: '#fff1a6', upright: true,
    gen: () => {
      const p = [];
      for (let i = 0; i < 10; i++) { const t = -Math.PI / 2 + (i * Math.PI) / 5; const r = i % 2 ? 0.5 : 1; p.push([Math.cos(t) * r, Math.sin(t) * r]); }
      return p;
    },
    inner() { face(0, 0.08, 0.7); },
  },
  pera: {
    name: 'Pera', fill: '#b5d94a', dark: '#6f9620', flesh: '#f8f6d2', upright: true,
    gen: () => polar((t) => { const s = Math.sin(t); return 0.8 + 0.22 * Math.max(0, s) - 0.3 * Math.max(0, -s) ** 2 + 0.03 * Math.cos(t * 2); }),
    inner() { shine(-0.35, -0.2, 0.18, 0.09); face(0, 0.25, 0.85); },
    outer() { stemLeaf(0, -0.45, 0.3); },
  },
  platano: {
    name: 'Plátano', fill: '#ffe04a', dark: '#c9a300', flesh: '#fff7d1',
    gen: () => {
      const c = [];
      for (let i = 0; i <= 40; i++) {
        const s = i / 40, a = Math.PI * (1.15 + 0.7 * s);
        const th = 0.05 + 0.27 * Math.sin(Math.PI * s) ** 0.8;
        c.push([Math.cos(a), Math.sin(a) + 0.7, Math.cos(a), Math.sin(a), th]);
      }
      const out = c.map(([x, y, nx, ny, t]) => [x + nx * t, y + ny * t]);
      const inn = c.map(([x, y, nx, ny, t]) => [x - nx * t, y - ny * t]).reverse();
      return out.concat(inn);
    },
    inner() { face(0, -0.3, 0.6); },
    outer() {
      ctx.fillStyle = '#5b3b10';
      for (const s of [0, 1]) { const a = Math.PI * (1.15 + 0.7 * s); ctx.beginPath(); ctx.arc(Math.cos(a), Math.sin(a) + 0.7, 0.06, 0, TAU); ctx.fill(); }
    },
  },
  pez: {
    name: 'Pez', fill: '#46b6ff', dark: '#1b6fb5', flesh: '#ffc9b8',
    gen: () => {
      const p = [];
      for (let i = 0; i <= 50; i++) { const t = 0.4 + (i / 50) * (TAU - 0.8); p.push([Math.cos(t) * 0.9 - 0.15, Math.sin(t) * 0.5]); }
      p.push([1.15, -0.5], [0.85, 0], [1.15, 0.5]);
      return p;
    },
    inner() {
      ctx.strokeStyle = 'rgba(27,111,181,0.45)'; ctx.lineWidth = 0.06;
      for (const x of [-0.1, 0.15, 0.4]) { ctx.beginPath(); ctx.arc(x - 0.5, 0, 0.45, -0.6, 0.6); ctx.stroke(); }
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-0.7, -0.1, 0.13, 0, TAU); ctx.fill();
      ctx.fillStyle = '#1d1d2b'; ctx.beginPath(); ctx.arc(-0.73, -0.1, 0.07, 0, TAU); ctx.fill();
      shine(-0.3, -0.3, 0.2, 0.06, -0.2);
    },
  },
  queso: {
    name: 'Queso', fill: '#ffc93a', dark: '#d99a00', flesh: '#fff0a8',
    gen: () => [[-1, 0.5], [1.05, 0.5], [1.05, 0.25], [-0.8, -0.7]],
    inner(sh) {
      ctx.fillStyle = '#e0a400';
      for (const [x, y, r] of sh.holes) { ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill(); }
    },
  },
  tarta: {
    name: 'Tarta', fill: '#c88a52', dark: '#8a5426', flesh: '#fbe3c6', upright: true,
    // Tarta de dos pisos
    gen: () => [[-1, 0.6], [1, 0.6], [1, 0], [0.55, 0], [0.55, -0.65], [-0.55, -0.65], [-0.55, 0], [-1, 0]],
    inner() {
      ctx.fillStyle = '#ff8fb8';
      for (const y0 of [-0.65, 0]) {
        ctx.beginPath(); ctx.moveTo(-1.2, y0 - 0.1); ctx.lineTo(1.2, y0 - 0.1);
        for (let x = 1.2; x >= -1.2; x -= 0.05) ctx.lineTo(x, y0 + 0.17 + 0.05 * Math.sin(x * 11) + 0.1 * Math.max(0, Math.sin(x * 5.3)) ** 6);
        ctx.closePath(); ctx.fill();
      }
      ctx.strokeStyle = '#fff3e0'; ctx.lineWidth = 0.08;
      for (const y of [-0.25, 0.38]) { ctx.beginPath(); ctx.moveTo(-1.2, y); ctx.lineTo(1.2, y); ctx.stroke(); }
    },
    outer() {
      ctx.strokeStyle = '#3f8f2a'; ctx.lineWidth = 0.04;
      ctx.beginPath(); ctx.moveTo(0.1, -0.8); ctx.quadraticCurveTo(0.15, -1.03, 0.3, -1.07); ctx.stroke();
      ctx.fillStyle = '#e8203a'; ctx.beginPath(); ctx.arc(0.1, -0.77, 0.14, 0, TAU); ctx.fill();
      shine(0.05, -0.82, 0.05, 0.03);
    },
  },
  pizza: {
    name: 'Pizza', fill: '#ffd04a', dark: '#c98b2e', flesh: '#fff1b8',
    gen: () => {
      const p = [[0, 1]];
      for (let i = 0; i <= 30; i++) { const a = -Math.PI / 2 - 0.45 + (i / 30) * 0.9; p.push([2 * Math.cos(a), 1 + 2 * Math.sin(a)]); }
      return p;
    },
    inner() {
      ctx.fillStyle = '#d6402f';
      for (const [x, y] of [[0.25, -0.55], [-0.3, -0.45], [0.05, 0.05], [-0.05, -0.85]]) { ctx.beginPath(); ctx.arc(x, y, 0.15, 0, TAU); ctx.fill(); }
      ctx.strokeStyle = '#d9893b'; ctx.lineWidth = 0.3;
      ctx.beginPath(); ctx.arc(0, 1, 2, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); ctx.stroke();
    },
  },
  gelatina: {
    name: 'Gelatina', fill: '#9f6bff', dark: '#5e2fc2', flesh: '#dccbff',
    gen: () => {
      const a = [R(0.08, 0.16), R(0.06, 0.12), R(0.03, 0.07)], ph = [R(0, 6), R(0, 6), R(0, 6)];
      return polar((t) => 1 + a[0] * Math.sin(2 * t + ph[0]) + a[1] * Math.sin(3 * t + ph[1]) + a[2] * Math.sin(5 * t + ph[2]));
    },
    inner() { shine(-0.4, -0.4, 0.25, 0.1); face(0, 0.05, 0.9); },
  },
};
for (const T of Object.values(TYPES)) T.light = mix(T.fill, '#ffffff', 0.45);

function makeShape(type, idx) {
  const T = TYPES[type];
  const sx = R(0.82, 1.18), sy = R(0.82, 1.18);
  const raw = T.gen().map(([x, y]) => [x * sx, y * sy]);
  const [cx, cy] = centroid(raw);
  let m = 0;
  for (const [x, y] of raw) m = Math.max(m, Math.hypot(x - cx, y - cy));
  const pts = raw.map(([x, y]) => [(x - cx) / m, (y - cy) / m]);
  const hard = idx >= 3;
  return {
    type, pts, norm: { cx, cy, m, sx, sy },
    angle: T.upright ? R(-0.35, 0.35) : R(0, TAU),
    rotV: hard ? R(0.35, 0.8) * (rng() < 0.5 ? -1 : 1) : 0,
    amp: idx >= 6 ? R(0.35, 0.6) : 0,
    freq: R(0.9, 1.4), ph: R(0, TAU),
    // Fuera del centro de la tabla: así no vale cortar siempre por el medio
    offx: R(-0.32, 0.32), offy: R(-0.24, 0.24),
    timeLimit: 5 - idx * 0.15,
    timeLeft: 5 - idx * 0.15,
    t: 0, pop: 0, fallY: 0, vy: 0, alpha: 1,
    // decoración (solo visual)
    dots: Array.from({ length: 18 }, () => { const a = VR(0, TAU), r = Math.sqrt(Math.random()) * 0.9; return [Math.cos(a) * r, Math.sin(a) * r]; }),
    holes: Array.from({ length: 6 }, () => [VR(-0.6, 0.9), VR(-0.3, 0.45), VR(0.06, 0.13)]),
  };
}

// ---------------------------------------------------------------------------
// Canvas
// ---------------------------------------------------------------------------
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;
const view = { cx: 0, cy: 0, size: 100 };

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth; H = window.innerHeight;
  canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}
function computeView() {
  view.size = Math.min(W * 0.3, H * 0.22, 250);
  view.cx = W / 2;
  view.cy = H * 0.52;
}

// Transformación actual de una figura en pantalla
function xfOf(sh) {
  return {
    x: view.cx + view.size * (sh.offx + sh.amp * Math.sin(sh.t * sh.freq + sh.ph)),
    y: view.cy + view.size * sh.offy + sh.fallY,
    a: sh.angle + sh.rotV * sh.t,
    s: view.size * sh.pop,
  };
}
function worldPts(sh, xf) {
  const c = Math.cos(xf.a), s = Math.sin(xf.a);
  return sh.pts.map(([u, v]) => [xf.x + xf.s * (u * c - v * s), xf.y + xf.s * (u * s + v * c)]);
}

// ---------------------------------------------------------------------------
// Sonido
// ---------------------------------------------------------------------------
let actx = null;
const settings = Object.assign({ sound: true, vibe: true, guide: true }, store.get('settings', {}));
let muted = !settings.sound;
function initAudio() {
  if (!actx) { const AC = window.AudioContext || window.webkitAudioContext; if (AC) actx = new AC(); }
  if (actx && actx.state === 'suspended') actx.resume();
}
function tone(f1, f2, dur, type = 'sine', vol = 0.1, delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.02);
}
function swoosh(dur = 0.16, vol = 0.25, freq = 2500) {
  if (!actx || muted) return;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.sin((Math.PI * i) / len);
  const src = actx.createBufferSource(), f = actx.createBiquadFilter(), g = actx.createGain();
  f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = 0.8;
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(f).connect(g).connect(actx.destination);
  src.start();
}
const sfx = {
  cut() { swoosh(0.14, 0.35, 3000); tone(500, 180, 0.12, 'triangle', 0.12); },
  whiff() { swoosh(0.18, 0.2, 1800); },
  perfect() { [784, 988, 1319, 1568].forEach((f, i) => tone(f, f, 0.18, 'triangle', 0.1, 0.05 + i * 0.07)); },
  great() { tone(659, 659, 0.12, 'triangle', 0.1, 0.05); tone(988, 988, 0.18, 'triangle', 0.1, 0.13); },
  ok() { tone(523, 523, 0.15, 'triangle', 0.08, 0.05); },
  bad() { tone(330, 200, 0.3, 'square', 0.06, 0.05); },
  tick() { tone(1400, 1400, 0.04, 'square', 0.04); },
  fail() { tone(420, 90, 0.45, 'sawtooth', 0.08); },
};
function vibrate(p) { if (settings.vibe && navigator.vibrate) navigator.vibrate(p); }
const juice = { slow: 0, flash: 0, shake: 0 };

// ---------------------------------------------------------------------------
// Estado de la partida
// ---------------------------------------------------------------------------
const ROUND = 10;
let state = 'menu'; // menu | play | results
let G = null;
let demo = null;     // figura que gira en el menú
let time = 0;
const fx = { pieces: [], parts: [], popups: [] };

function grade(diff) {
  if (diff < 0.25) return { text: '¡PERFECTO!', color: '#ffb300', emoji: '🎯', snd: 'perfect' };
  if (diff < 1) return { text: '¡Increíble!', color: '#2fbf8f', emoji: '🟩', snd: 'great' };
  if (diff < 2.5) return { text: '¡Genial!', color: '#2fbf8f', emoji: '🟩', snd: 'great' };
  if (diff < 5) return { text: 'Bien', color: '#e3a000', emoji: '🟨', snd: 'ok' };
  if (diff < 10) return { text: 'Regular', color: '#ff8a3d', emoji: '🟧', snd: 'bad' };
  return { text: '¡Uy!', color: '#e2401f', emoji: '🟥', snd: 'bad' };
}

function startRound(mode) {
  initAudio();
  const day = dayIndex();
  rng = mulberry32(mode === 'daily' ? day * 7919 + 17 : (Math.random() * 2 ** 31) | 0);
  const types = Object.keys(TYPES);
  for (let i = types.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [types[i], types[j]] = [types[j], types[i]]; }
  G = { mode, day, types, idx: -1, score: 0, combo: 0, results: [], shape: null, phase: '', phaseT: 0, ticked: 0 };
  state = 'play';
  fx.pieces = []; fx.parts = []; fx.popups = [];
  buildDots();
  setScreen('hud');
  nextShape();
}

function nextShape() {
  G.idx++;
  if (G.idx >= ROUND) { endRound(); return; }
  G.shape = makeShape(G.types[G.idx % G.types.length], G.idx);
  G.phase = 'enter';
  G.phaseT = 0;
  G.ticked = 0;
  updateHud();
}

function doCut(a, b) {
  const sh = G.shape;
  const xf = xfOf(sh);
  const pts = worldPts(sh, xf);
  const hits = [];
  const pa = clipHalf(pts, a, b, 1, hits);
  const pb = clipHalf(pts, a, b, -1);
  const A = pa.length > 2 ? Math.abs(polyArea(pa)) : 0;
  const B = pb.length > 2 ? Math.abs(polyArea(pb)) : 0;
  const total = A + B;
  if (A < total * 1e-4 || B < total * 1e-4) {
    sfx.whiff();
    popup('¡Fallaste!', '#8a6a60', 0.6);
    return;
  }

  const pct = (A / total) * 100;
  const pA = Math.round(pct * 10) / 10;
  const pB = Math.round((100 - pA) * 10) / 10;
  const diff = Math.abs(pct - 50);
  const gr = grade(diff);

  let pts1 = Math.max(0, Math.round(100 - diff * 8));
  if (gr.emoji === '🎯') { G.combo++; pts1 += 100 + 50 * (G.combo - 1); } else G.combo = 0;
  pts1 += Math.round((20 * sh.timeLeft) / sh.timeLimit);
  G.score += pts1;
  G.results.push({ diff, pA, pB, emoji: gr.emoji, pts: pts1 });

  // Piezas que se separan
  const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
  const d = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
  const n = [-d[1], d[0]];
  const far = [[a[0] - d[0] * 4000, a[1] - d[1] * 4000], [a[0] + d[0] * 4000, a[1] + d[1] * 4000]];
  const label = (p) => `${fmt(p)}%`;
  for (const [poly, sgn, p] of [[pa, 1, pA], [pb, -1, pB]]) {
    const c = centroid(poly);
    fx.pieces.push({
      poly, c, sh, xf, far, flesh: TYPES[sh.type].flesh,
      ox: 0, oy: 0, vx: n[0] * sgn * 240, vy: n[1] * sgn * 240,
      rot: 0, w: sgn * VR(0.3, 0.7), t: 0,
      label: label(p), labelColor: gr.color, fontSize: Math.max(18, view.size * 0.2),
    });
  }

  // Zumo
  if (hits.length >= 2) {
    const proj = hits.map((h) => (h[0] - a[0]) * d[0] + (h[1] - a[1]) * d[1]);
    const t0 = Math.min(...proj), t1 = Math.max(...proj);
    const T = TYPES[sh.type];
    for (let i = 0; i < 26; i++) {
      const t = VR(t0, t1), s = Math.random() < 0.5 ? 1 : -1;
      fx.parts.push({
        x: a[0] + d[0] * t, y: a[1] + d[1] * t,
        vx: n[0] * s * VR(60, 260) + VR(-40, 40), vy: n[1] * s * VR(60, 260) - VR(50, 200),
        life: VR(0.4, 0.9), max: 0.9, r: VR(2, 5), color: Math.random() < 0.6 ? T.flesh : T.fill,
      });
    }
  }

  sfx.cut();
  sfx[gr.snd]();
  vibrate(gr.emoji === '🎯' ? [20, 40, 20, 40, 60] : 25);
  popup(gr.text, gr.color, gr.emoji === '🎯' ? 1.3 : 1);
  if (gr.emoji === '🎯') { juice.slow = 0.35; juice.flash = 1; juice.shake = 0.2; }
  if (G.combo > 1) popup(`COMBO x${G.combo}`, '#e2401f', 0.7, 0.55);
  G.phase = 'cut';
  G.phaseT = 0;
  updateHud();
}

function timeout() {
  G.results.push({ diff: 50, emoji: '⬛', timeout: true, pts: 0 });
  G.combo = 0;
  G.phase = 'timeout';
  G.phaseT = 0;
  G.shape.vy = -350;
  popup('¡Tiempo!', '#8a6a60', 1);
  sfx.fail();
  vibrate(80);
  updateHud();
}

function popup(text, color, scale = 1, dy = 0) {
  fx.popups.push({ text, color, scale, dy, t: 0 });
}

// ---------------------------------------------------------------------------
// Actualización
// ---------------------------------------------------------------------------
const easeOutBack = (t) => { const c = 1.7; return 1 + (c + 1) * (t - 1) ** 3 + c * (t - 1) ** 2; };

function update(dt) {
  time += dt;
  if (demo) demo.t += dt;

  if (state === 'play' && G && G.shape) {
    const sh = G.shape;
    G.phaseT += dt;
    if (G.phase === 'enter') {
      sh.t += dt;
      sh.pop = easeOutBack(Math.min(1, G.phaseT / 0.32));
      if (G.phaseT >= 0.32) { G.phase = 'aim'; G.phaseT = 0; sh.pop = 1; }
    } else if (G.phase === 'aim') {
      sh.t += dt;
      sh.timeLeft -= dt;
      const sec = Math.ceil(sh.timeLeft);
      if (sh.timeLeft < 2 && sec !== G.ticked) { G.ticked = sec; sfx.tick(); }
      if (sh.timeLeft <= 0) { sh.timeLeft = 0; timeout(); }
    } else if (G.phase === 'timeout') {
      sh.vy += 2600 * dt;
      sh.fallY += sh.vy * dt;
      sh.alpha = clamp(1 - G.phaseT / 0.6, 0, 1);
      if (G.phaseT > 0.65) nextShape();
    } else if (G.phase === 'cut') {
      if (G.phaseT > 1.05) nextShape();
    }
  }

  for (const p of fx.pieces) {
    p.t += dt;
    if (p.t < 0.55) {
      const k = Math.exp(-5 * dt);
      p.vx *= k; p.vy *= k;
    } else {
      p.vy += 2600 * dt;
    }
    p.ox += p.vx * dt;
    p.oy += p.vy * dt;
    p.rot += p.w * dt * (p.t > 0.55 ? 3 : 1);
  }
  fx.pieces = fx.pieces.filter((p) => p.t < 2.2);

  for (const p of fx.parts) {
    p.life -= dt;
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.vy += 900 * dt;
  }
  fx.parts = fx.parts.filter((p) => p.life > 0);

  for (const p of fx.popups) p.t += dt;
  fx.popups = fx.popups.filter((p) => p.t < 1.1);
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------
function tracePath(pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
}

// Compatibilidad con iOS 15 (sin roundRect en canvas)
if (!CanvasRenderingContext2D.prototype.roundRect) {
  CanvasRenderingContext2D.prototype.roundRect = function (x, y, w, h, r) {
    this.moveTo(x + r, y);
    this.arcTo(x + w, y, x + w, y + h, r);
    this.arcTo(x + w, y + h, x, y + h, r);
    this.arcTo(x, y + h, x, y, r);
    this.arcTo(x, y, x + w, y, r);
    this.closePath();
  };
}

// Pasa a las coordenadas "originales" de la figura (las de gen/inner/outer)
function toOrig(sh) {
  const { cx, cy, m, sx, sy } = sh.norm;
  ctx.scale(1 / m, 1 / m);
  ctx.translate(-cx, -cy);
  ctx.scale(sx, sy);
}

// Dibuja la figura completa; ctx ya en su transformación (unidades normalizadas)
function drawShapeBody(sh) {
  const T = TYPES[sh.type];
  tracePath(sh.pts);
  const g = ctx.createRadialGradient(-0.35, -0.4, 0.05, 0, 0, 1.25);
  g.addColorStop(0, T.light);
  g.addColorStop(0.55, T.fill);
  g.addColorStop(1, T.dark);
  ctx.fillStyle = g;
  ctx.fill();

  if (T.inner) {
    ctx.save();
    tracePath(sh.pts);
    ctx.clip();
    toOrig(sh);
    T.inner(sh);
    ctx.restore();
  }
  tracePath(sh.pts);
  ctx.lineJoin = 'round';
  ctx.lineWidth = 0.035;
  ctx.strokeStyle = T.dark;
  ctx.stroke();
  if (T.outer) {
    ctx.save();
    toOrig(sh);
    T.outer(sh);
    ctx.restore();
  }
}

function drawShape(sh, xf, alpha = 1) {
  if (xf.s <= 0.5) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  // sombra
  ctx.fillStyle = 'rgba(90,40,20,0.18)';
  ctx.beginPath();
  ctx.ellipse(xf.x, view.cy + view.size * 1.02, xf.s * 0.75, xf.s * 0.12, 0, 0, TAU);
  ctx.fill();
  ctx.translate(xf.x, xf.y);
  ctx.rotate(xf.a);
  ctx.scale(xf.s, xf.s);
  drawShapeBody(sh);
  ctx.restore();
}

function drawPiece(p) {
  const alpha = clamp(1 - (p.t - 1.4) / 0.6, 0, 1);
  if (alpha <= 0) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.c[0] + p.ox, p.c[1] + p.oy);
  ctx.rotate(p.rot);
  ctx.translate(-p.c[0], -p.c[1]);
  tracePath(p.poly);
  ctx.clip();
  ctx.save();
  ctx.translate(p.xf.x, p.xf.y);
  ctx.rotate(p.xf.a);
  ctx.scale(p.xf.s, p.xf.s);
  drawShapeBody(p.sh);
  ctx.restore();
  // Cara del corte (solo la mitad interior de la banda queda dentro del recorte)
  ctx.strokeStyle = p.flesh;
  ctx.lineWidth = p.xf.s * 0.16;
  ctx.beginPath();
  ctx.moveTo(p.far[0][0], p.far[0][1]);
  ctx.lineTo(p.far[1][0], p.far[1][1]);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.12)';
  ctx.lineWidth = p.xf.s * 0.02;
  ctx.stroke();
  ctx.restore();
}

function drawPieceLabel(p) {
  if (p.t > 1.1) return;
  const a = clamp(Math.min(p.t / 0.12, (1.1 - p.t) / 0.25), 0, 1);
  const x = p.c[0] + p.ox, y = p.c[1] + p.oy;
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `700 ${p.fontSize}px Fredoka, ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = p.fontSize * 0.28;
  ctx.lineJoin = 'round';
  ctx.strokeStyle = 'rgba(58,31,26,0.85)';
  ctx.strokeText(p.label, x, y);
  ctx.fillStyle = '#fff';
  ctx.fillText(p.label, x, y);
  ctx.restore();
}

function drawBackground() {
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#fff3e6');
  g.addColorStop(1, '#ffd2c2');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);
  // Lunares suaves
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  const step = Math.max(46, Math.min(W, H) / 9);
  for (let y = 0; y < H + step; y += step) {
    for (let x = ((y / step) % 2) * step * 0.5; x < W + step; x += step) {
      ctx.beginPath(); ctx.arc(x, y, step * 0.12, 0, TAU); ctx.fill();
    }
  }
}

function drawBoard() {
  const r = view.size * 1.4, x = view.cx, y = view.cy;
  ctx.fillStyle = 'rgba(120,50,20,0.18)';
  ctx.beginPath(); ctx.ellipse(x, y + r * 0.08, r, r, 0, 0, TAU); ctx.fill();
  const g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
  g.addColorStop(0, '#f6cf94');
  g.addColorStop(1, '#e0a865');
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(160,95,40,0.18)';
  ctx.lineWidth = 2;
  for (let k = 1; k <= 4; k++) { ctx.beginPath(); ctx.arc(x + k * 3, y - k * 2, r * k * 0.2, 0, TAU); ctx.stroke(); }
  ctx.strokeStyle = '#c98a4b';
  ctx.lineWidth = Math.max(4, r * 0.04);
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.stroke();
}

function drawTimer(sh) {
  const w = view.size * 2.2, h = Math.max(8, view.size * 0.07);
  const x = view.cx - w / 2, y = view.cy + view.size * 1.4 + h * 2.2;
  const f = clamp(sh.timeLeft / sh.timeLimit, 0, 1);
  ctx.fillStyle = 'rgba(58,31,26,0.12)';
  roundRect(x, y, w, h, h / 2); ctx.fill();
  ctx.fillStyle = `hsl(${Math.round(120 * f)},75%,48%)`;
  if (f > 0) { roundRect(x, y, Math.max(h, w * f), h, h / 2); ctx.fill(); }
}

function roundRect(x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawBlade() {
  if (!drag) return;
  const { x0, y0, x, y } = drag;
  const L = Math.hypot(x - x0, y - y0);
  if (L < 4) return;
  const d = [(x - x0) / L, (y - y0) / L];
  ctx.save();
  // Guía punteada
  if (settings.guide) {
  ctx.setLineDash([8, 10]);
  ctx.strokeStyle = 'rgba(58,31,26,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x0 - d[0] * 3000, y0 - d[1] * 3000);
  ctx.lineTo(x0 + d[0] * 3000, y0 + d[1] * 3000);
  ctx.stroke();
  ctx.setLineDash([]);
  }
  // Hoja
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(255,255,255,0.55)';
  ctx.lineWidth = 12;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x, y); ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 4;
  ctx.stroke();
  ctx.restore();
}

function drawPopups() {
  for (const p of fx.popups) {
    const k = p.t < 0.15 ? easeOutBack(p.t / 0.15) : 1;
    const a = clamp((1.1 - p.t) / 0.3, 0, 1);
    const fs = Math.max(28, view.size * 0.32) * p.scale * k;
    const y = view.cy - view.size * 1.4 - fs * 0.2 - p.t * 30 + p.dy * view.size;
    ctx.save();
    ctx.globalAlpha = a;
    ctx.font = `700 ${fs}px Fredoka, ui-rounded, system-ui, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.22;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(p.text, view.cx, Math.max(fs, y));
    ctx.fillStyle = p.color;
    ctx.fillText(p.text, view.cx, Math.max(fs, y));
    ctx.restore();
  }
}

function drawHint() {
  ctx.save();
  ctx.font = `600 ${Math.max(15, view.size * 0.13)}px Fredoka, ui-rounded, system-ui, sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(58,31,26,0.7)';
  const y = view.cy + view.size * 1.4 + Math.max(8, view.size * 0.07) * 2.2 + Math.max(36, view.size * 0.3);
  ctx.fillText('Desliza el dedo para cortar en dos mitades iguales', view.cx, Math.min(H - 20, y));
  // Dedo animado
  const k = (time % 1.6) / 1.6;
  const x = view.cx + lerp(-view.size * 1.2, view.size * 1.2, k);
  const yy = view.cy - view.size * 1.1 + lerp(0, view.size * 2.2, k);
  ctx.globalAlpha = Math.sin(k * Math.PI);
  ctx.font = `${Math.max(30, view.size * 0.3)}px system-ui`;
  ctx.fillText('👆', x, yy);
  ctx.restore();
}

function render() {
  computeView();
  drawBackground();
  ctx.save();
  if (juice.shake > 0 && !reducedMotion) {
    const m = juice.shake * 30;
    ctx.translate(VR(-m, m), VR(-m, m));
  }
  drawBoard();

  if (state === 'menu' && demo) {
    demo.pop = 1;
    drawShape(demo, { x: view.cx, y: view.cy, a: Math.sin(demo.t * 0.8) * 0.3, s: view.size * (1 + Math.sin(demo.t * 2) * 0.03) });
  }

  if ((state === 'play' || state === 'pause') && G && G.shape && G.phase !== 'cut') {
    const sh = G.shape;
    drawShape(sh, xfOf(sh), sh.alpha);
    if (G.phase === 'aim' || G.phase === 'enter') drawTimer(sh);
    if (G.idx === 0 && !store.get('played', false) && G.phase !== 'timeout') drawHint();
  }

  for (const p of fx.pieces) drawPiece(p);
  for (const p of fx.parts) {
    ctx.globalAlpha = clamp((p.life / p.max) * 1.5, 0, 1);
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (state === 'play' && G && G.phase === 'aim') drawBlade();
  for (const p of fx.pieces) drawPieceLabel(p);
  drawPopups();
  ctx.restore();
  if (juice.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${juice.flash * 0.45})`;
    ctx.fillRect(0, 0, W, H);
  }
}
const reducedMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
const ui = {
  hud: $('hud'), score: $('score'), dots: $('dots'), combo: $('combo'), comboN: $('comboN'),
  menu: $('menu'), results: $('results'), toast: $('toast'), splash: $('splash'),
  streak: $('streak'), streakTxt: $('streakTxt'), dailyN: $('dailyN'), dailySub: $('dailySub'), best: $('best'),
  stars: $('stars'), resTitle: $('resTitle'), resMode: $('resMode'), resRecord: $('resRecord'), resScore: $('resScore'),
  resPrec: $('resPrec'), resGrid: $('resGrid'), resBest: $('resBest'), nextDaily: $('nextDaily'),
};
const SCREENS = { menu: ui.menu, hud: ui.hud, results: ui.results };
const GRADE_IDX = { '🎯': 0, '🟩': 1, '🟨': 2, '🟧': 3, '🟥': 4, '⬛': 5 };
const GRADE_COLORS = ['#ffb020', '#22b98a', '#f2c230', '#ff8a3d', '#ea4a35', '#4a3a36'];
const GRADE_NAMES = ['Perfecto', 'Genial', 'Bien', 'Regular', 'Fallo', 'Tiempo'];

function setScreen(name) {
  for (const [k, el] of Object.entries(SCREENS)) el.classList.toggle('open', k === name);
}

// ---- Modales ----
function openModal(id) {
  if (id === 'mStats') fillStats();
  if (id === 'mSettings') fillSettings();
  $(id).classList.add('open');
}
function closeModal(m) { m.classList.remove('open'); }
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => openModal(b.dataset.open)));
document.querySelectorAll('.modal').forEach((m) => {
  m.addEventListener('click', (e) => { if (e.target === m && m.id !== 'mPause') closeModal(m); });
  m.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(m)));
});

// ---- HUD ----
function buildDots() {
  ui.dots.innerHTML = '';
  for (let i = 0; i < ROUND; i++) ui.dots.appendChild(document.createElement('i'));
}
function updateHud() {
  if (!G) return;
  ui.score.textContent = G.score;
  const kids = ui.dots.children;
  for (let i = 0; i < kids.length; i++) {
    const r = G.results[i];
    kids[i].className = r ? 'g' + GRADE_IDX[r.emoji] : i === G.idx ? 'now' : '';
  }
  ui.combo.classList.toggle('on', G.combo >= 2);
  ui.comboN.textContent = G.combo;
}

// ---- Estadísticas ----
function getStats() {
  return Object.assign({ games: 0, cuts: 0, perfects: 0, bestPrec: 0, maxStreak: 0, dist: [0, 0, 0, 0, 0, 0] }, store.get('stats', {}));
}
function currentStreak() {
  const st = store.get('streak', { last: 0, count: 0 });
  const day = dayIndex();
  return st.last === day || st.last === day - 1 ? st.count : 0;
}
function fillStats() {
  const s = getStats();
  $('sGames').textContent = s.games;
  $('sPerfect').textContent = s.perfects;
  $('sBestPrec').textContent = s.games ? fmt(s.bestPrec) + '%' : '–';
  $('sStreak').textContent = currentStreak();
  $('sMaxStreak').textContent = s.maxStreak;
  const max = Math.max(1, ...s.dist);
  const box = $('sDist');
  box.innerHTML = '';
  s.dist.forEach((n, i) => {
    const row = document.createElement('div');
    row.className = 'bar';
    row.innerHTML = `<span title="${GRADE_NAMES[i]}">${Object.keys(GRADE_IDX)[i]}</span><div class="fill" style="width:${Math.max(8, (n / max) * 100)}%;background:${GRADE_COLORS[i]}">${n}</div>`;
    box.appendChild(row);
  });
}

// ---- Ajustes ----
function saveSettings() { store.set('settings', settings); muted = !settings.sound; }
function fillSettings() {
  $('optSound').checked = settings.sound;
  $('optVibe').checked = settings.vibe;
  $('optGuide').checked = settings.guide;
}
$('optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); initAudio(); sfx.ok(); });
$('optVibe').addEventListener('change', (e) => { settings.vibe = e.target.checked; saveSettings(); vibrate(30); });
$('optGuide').addEventListener('change', (e) => { settings.guide = e.target.checked; saveSettings(); });
$('resetBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar récords, racha y estadísticas? No se puede deshacer.')) return;
  for (const k of ['best', 'daily', 'streak', 'stats', 'played']) { try { localStorage.removeItem('corte.' + k); } catch { /* nada */ } }
  refreshMenu();
  toast('Datos borrados');
});

// ---- Menú ----
function refreshMenu() {
  const day = dayIndex();
  ui.dailyN.textContent = '#' + day;
  const daily = store.get('daily', null);
  ui.dailySub.textContent = daily && daily.day === day ? `✓ Completado · ${daily.score} pts` : '10 figuras · ~30 s';
  const n = currentStreak();
  ui.streakTxt.textContent = n > 0 ? `Racha de ${n} ${n === 1 ? 'día' : 'días'}` : 'Empieza tu racha hoy';
  ui.streak.classList.toggle('off', n === 0);
  ui.best.textContent = store.get('best', 0);
}

function toMenu() {
  state = 'menu';
  G = null;
  drag = null;
  newDemo();
  refreshMenu();
  setScreen('menu');
  stopCountdown();
}

function newDemo() {
  const keys = Object.keys(TYPES);
  rng = Math.random;
  demo = makeShape(keys[Math.floor(Math.random() * keys.length)], 0);
  demo.pop = 1;
  demo.offx = demo.offy = 0;
}

// ---- Pausa ----
function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  drag = null;
  openModal('mPause');
}
function resumeGame() {
  if (state !== 'pause') return;
  closeModal($('mPause'));
  state = 'play';
  last = performance.now();
}
$('pauseBtn').addEventListener('click', pauseGame);
$('resumeBtn').addEventListener('click', resumeGame);
$('restartBtn').addEventListener('click', () => { closeModal($('mPause')); startRound(G ? G.mode : 'free'); });
$('quitBtn').addEventListener('click', () => { closeModal($('mPause')); toMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });

// ---- Resultados ----
let lastShare = '';
let shareInfo = null;

function endRound() {
  state = 'results';
  store.set('played', true);
  const res = G.results;
  const avgDiff = res.reduce((s, r) => s + r.diff, 0) / res.length;
  const prec = Math.max(0, 100 - avgDiff * 2);
  const grid = res.map((r) => r.emoji).join('');
  const cuts = res.filter((r) => !r.timeout);
  const bestCut = cuts.length ? cuts.reduce((a, b) => (a.diff < b.diff ? a : b)) : null;

  // Estadísticas globales
  const s = getStats();
  s.games++;
  s.cuts += cuts.length;
  s.perfects += res.filter((r) => r.emoji === '🎯').length;
  s.bestPrec = Math.max(s.bestPrec, prec);
  for (const r of res) s.dist[GRADE_IDX[r.emoji]]++;

  let isRecord = false;
  let modeText;
  if (G.mode === 'daily') {
    const day = G.day;
    const prev = store.get('daily', null);
    if (!prev || prev.day !== day) {
      store.set('daily', { day, score: G.score, grid, prec });
      const st = store.get('streak', { last: 0, count: 0 });
      const count = st.last === day - 1 ? st.count + 1 : st.last === day ? st.count : 1;
      store.set('streak', { last: day, count });
      s.maxStreak = Math.max(s.maxStreak, count);
      modeText = `Reto diario #${day} · 🔥 ${count} ${count === 1 ? 'día' : 'días'}`;
    } else {
      modeText = `Reto diario #${day} · repetición (no cuenta)`;
    }
  } else {
    const best = store.get('best', 0);
    if (G.score > best) { store.set('best', G.score); isRecord = best > 0; }
    modeText = 'Partida libre';
  }
  store.set('stats', s);

  const stars = prec >= 97 ? 3 : prec >= 90 ? 2 : prec >= 75 ? 1 : 0;
  ui.resTitle.textContent = ['Sigue practicando', '¡Nada mal!', '¡Muy fino!', '¡Maestro del corte!'][stars];
  ui.resMode.textContent = modeText;
  ui.resRecord.hidden = !isRecord;
  ui.resPrec.textContent = fmt(prec) + ' %';
  ui.resGrid.textContent = grid;
  ui.resBest.textContent = bestCut ? `Mejor corte: ${fmt(bestCut.pA)}% / ${fmt(bestCut.pB)}%` : '';

  const title = G.mode === 'daily' ? `✂️ Corte Perfecto #${G.day}` : '✂️ Corte Perfecto';
  lastShare = `${title}\n${grid}\nPrecisión: ${fmt(prec)} % · ${G.score} pts\n¿Lo superas? ${location.origin}${location.pathname}`;
  shareInfo = { mode: G.mode, day: G.day, prec, score: G.score, res: res.map((r) => GRADE_IDX[r.emoji]) };

  setScreen('results');
  animateStars(stars);
  countUp(ui.resScore, G.score, 900);
  startCountdown();
}

function animateStars(n) {
  [...ui.stars.children].forEach((el, i) => {
    el.classList.remove('show', 'on');
    void el.getBoundingClientRect();
    setTimeout(() => {
      el.classList.add('show');
      if (i < n) { el.classList.add('on'); tone(660 + i * 220, 660 + i * 220, 0.15, 'triangle', 0.08); }
    }, 300 + i * 220);
  });
}

function countUp(el, to, ms) {
  const t0 = performance.now();
  const stepFn = (now) => {
    const k = Math.min(1, (now - t0) / ms);
    el.textContent = Math.round(to * (1 - (1 - k) ** 3));
    if (k < 1) requestAnimationFrame(stepFn);
  };
  requestAnimationFrame(stepFn);
}

let countdownId = 0;
function startCountdown() {
  stopCountdown();
  const tick = () => {
    const now = new Date();
    const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const s = Math.max(0, Math.floor((next - now) / 1000));
    const p = (n) => String(n).padStart(2, '0');
    ui.nextDaily.innerHTML = `Próximo reto en <b>${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}</b>`;
  };
  tick();
  countdownId = setInterval(tick, 1000);
}
function stopCountdown() { clearInterval(countdownId); }

// ---- Compartir (imagen + texto) ----
async function makeShareCard(info) {
  try { await document.fonts.load('700 100px Fredoka'); } catch { /* sin fuente: usa la del sistema */ }
  const c = document.createElement('canvas');
  c.width = 1080; c.height = 1350;
  const x = c.getContext('2d');
  const F = (w, s) => `${w} ${s}px Fredoka, ui-rounded, system-ui, sans-serif`;
  const g = x.createLinearGradient(0, 0, 0, 1350);
  g.addColorStop(0, '#fff3e6'); g.addColorStop(1, '#ffd2c2');
  x.fillStyle = g; x.fillRect(0, 0, 1080, 1350);
  x.fillStyle = 'rgba(255,255,255,0.4)';
  for (let yy = 0; yy < 1400; yy += 90) for (let xx = (yy / 90) % 2 ? 45 : 0; xx < 1120; xx += 90) { x.beginPath(); x.arc(xx, yy, 10, 0, TAU); x.fill(); }
  x.textAlign = 'center';
  x.textBaseline = 'alphabetic';
  x.fillStyle = '#ff6b57'; x.font = F(700, 130); x.fillText('CORTE', 540, 220);
  x.fillStyle = '#ff4f8b'; x.fillText('PERFECTO', 540, 345);
  x.fillStyle = '#7a5a50'; x.font = F(500, 50);
  x.fillText(info.mode === 'daily' ? `Reto diario #${info.day}` : 'Partida libre', 540, 440);
  // Tarjeta blanca
  x.fillStyle = '#fff';
  x.shadowColor = 'rgba(150,60,30,0.2)'; x.shadowBlur = 40; x.shadowOffsetY = 12;
  x.beginPath(); x.roundRect(80, 500, 920, 620, 56); x.fill();
  x.shadowColor = 'transparent';
  x.fillStyle = '#7a5a50'; x.font = F(600, 38); x.fillText('PRECISIÓN', 540, 590);
  x.fillStyle = '#3b211b'; x.font = F(700, 190); x.fillText(fmt(info.prec) + '%', 540, 770);
  const tile = 72, gap = 12, total = info.res.length * tile + (info.res.length - 1) * gap;
  info.res.forEach((gi, i) => {
    const tx = 540 - total / 2 + i * (tile + gap), ty = 830;
    x.fillStyle = GRADE_COLORS[gi];
    x.beginPath(); x.roundRect(tx, ty, tile, tile, 18); x.fill();
    if (gi === 0) {
      x.strokeStyle = '#fff'; x.lineWidth = 7;
      x.beginPath(); x.arc(tx + tile / 2, ty + tile / 2, 22, 0, TAU); x.stroke();
      x.fillStyle = '#fff'; x.beginPath(); x.arc(tx + tile / 2, ty + tile / 2, 8, 0, TAU); x.fill();
    }
  });
  x.fillStyle = '#ff4f8b'; x.font = F(700, 64); x.fillText(`${info.score} puntos`, 540, 1040);
  x.fillStyle = '#3b211b'; x.font = F(600, 54); x.fillText('¿Lo superas? ✂️', 540, 1215);
  x.fillStyle = '#7a5a50'; x.font = F(500, 38); x.fillText(location.host || 'corte-perfecto', 540, 1280);
  return new Promise((r) => c.toBlob(r, 'image/png'));
}

async function share() {
  try {
    if (navigator.share && shareInfo) {
      const blob = await makeShareCard(shareInfo);
      const file = blob && new File([blob], 'corte-perfecto.png', { type: 'image/png' });
      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], text: lastShare });
        return;
      }
      await navigator.share({ text: lastShare });
      return;
    }
  } catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(lastShare); toast('¡Copiado! Pégalo donde quieras'); }
  catch { toast('No se pudo compartir'); }
}

function toast(msg) {
  ui.toast.textContent = msg;
  ui.toast.classList.add('on');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ui.toast.classList.remove('on'), 2200);
}

$('dailyBtn').addEventListener('click', () => startRound('daily'));
$('freeBtn').addEventListener('click', () => startRound('free'));
$('againBtn').addEventListener('click', () => { stopCountdown(); startRound('free'); });
$('menuBtn').addEventListener('click', toMenu);
$('shareBtn').addEventListener('click', share);

// ---------------------------------------------------------------------------
// Entrada (dedo, lápiz o ratón)
// ---------------------------------------------------------------------------
let drag = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  initAudio();
  drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* ignorar */ }
});
canvas.addEventListener('pointermove', (e) => {
  if (drag && e.pointerId === drag.id) { drag.x = e.clientX; drag.y = e.clientY; }
});
function endDrag(e) {
  if (!drag || e.pointerId !== drag.id) return;
  const d = drag;
  drag = null;
  if (state !== 'play' || !G || G.phase !== 'aim') return;
  if (Math.hypot(d.x - d.x0, d.y - d.y0) < 30) return;
  doCut([d.x0, d.y0], [d.x, d.y]);
}
canvas.addEventListener('pointerup', endDrag);
canvas.addEventListener('pointercancel', () => { drag = null; });
document.addEventListener('gesturestart', (e) => e.preventDefault()); // sin zoom en iOS

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const open = document.querySelector('.modal.open');
    if (state === 'play') pauseGame();
    else if (state === 'pause') resumeGame();
    else if (open) closeModal(open);
    else if (state === 'results') toMenu();
  } else if (e.key === 'Enter' && !document.querySelector('.modal.open')) {
    if (state === 'menu') startRound('daily');
    else if (state === 'results') startRound('free');
  }
});
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------------------------------------------------------------------
// Bucle
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (state !== 'pause') {
    // Cámara lenta tras un corte perfecto
    if (juice.slow > 0) { juice.slow -= dt; dt *= 0.3; }
    update(dt);
  }
  juice.flash = Math.max(0, juice.flash - (now - (frame.prev || now)) / 1000 * 3);
  juice.shake = Math.max(0, juice.shake - (now - (frame.prev || now)) / 1000);
  frame.prev = now;
  render();
  requestAnimationFrame(frame);
}

resize();
newDemo();
refreshMenu();
requestAnimationFrame(frame);

// Pantalla de carga: espera a la fuente (máx. 1,5 s)
Promise.race([document.fonts ? document.fonts.load('700 20px Fredoka') : null, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .then(() => setTimeout(() => {
    ui.splash.classList.add('done');
    setScreen('menu');
    if (!store.get('played', false) && !store.get('seenHelp', false)) {
      store.set('seenHelp', true);
      setTimeout(() => openModal('mHelp'), 450);
    }
  }, 350));

// Gancho para pruebas automáticas
window.__corte = {
  get state() { return state; }, get game() { return G; },
  startRound, doCut, xfOf, worldPts, centroid, view, makeShareCard,
};
