'use strict';
/*
 * Rayo Runner — runner infinito neón para móvil, iPad y PC.
 * Canvas 2D con proyección en perspectiva real (sin librerías).
 */

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[(Math.random() * arr.length) | 0];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const shuffle = (arr) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('rayo.' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('rayo.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};

// ---------------------------------------------------------------------------
// Canvas y tamaño
// ---------------------------------------------------------------------------
const canvas = $('game');
const ctx = canvas.getContext('2d');
let W = 0, H = 0;

function resize() {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  W = window.innerWidth;
  H = window.innerHeight;
  canvas.width = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width = W + 'px';
  canvas.style.height = H + 'px';
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  makeStars();
}

let stars = [];
function makeStars() {
  stars = [];
  for (let i = 0; i < 70; i++) stars.push({ x: Math.random(), y: Math.random(), r: rand(0.5, 1.6), p: rand(0, 6) });
}

// ---------------------------------------------------------------------------
// Sonido (Web Audio, generado al vuelo)
// ---------------------------------------------------------------------------
let actx = null;
let muted = store.get('muted', false);

function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) actx = new AC();
  }
  if (actx && actx.state === 'suspended') actx.resume();
}

function tone(f1, f2, dur, type = 'square', vol = 0.08, delay = 0) {
  if (!actx || muted) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator();
  const g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

function noise(dur, vol = 0.25) {
  if (!actx || muted) return;
  const len = Math.floor(actx.sampleRate * dur);
  const buf = actx.createBuffer(1, len, actx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 2;
  const src = actx.createBufferSource();
  const g = actx.createGain();
  g.gain.value = vol;
  src.buffer = buf;
  src.connect(g).connect(actx.destination);
  src.start();
}

const sfx = {
  coin() { tone(988, 988, 0.06, 'square', 0.04); tone(1319, 1319, 0.12, 'square', 0.04, 0.06); },
  jump() { tone(280, 720, 0.18, 'triangle', 0.12); },
  slide() { tone(520, 160, 0.2, 'sawtooth', 0.04); },
  lane() { tone(640, 460, 0.05, 'triangle', 0.05); },
  shield() { tone(400, 1400, 0.4, 'sine', 0.12); },
  block() { tone(220, 70, 0.35, 'square', 0.1); noise(0.2, 0.15); },
  crash() { tone(300, 40, 0.6, 'sawtooth', 0.12); noise(0.5, 0.3); },
};

function vibrate(ms) { if (navigator.vibrate) navigator.vibrate(ms); }

// ---------------------------------------------------------------------------
// Constantes del juego
// ---------------------------------------------------------------------------
const CAM = 3;            // distancia de la cámara detrás del jugador
const SPAWN_Z = 70;       // profundidad donde aparecen los objetos
const JUMP_V = 7.8;
const GRAV = 24;
const SLIDE_T = 0.7;
const SHIELD_T = 10;
const START_SPEED = 14;
const MAX_EXTRA_SPEED = 20;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | play | pause | dying | over
let g = null;
let best = store.get('best', 0);
let bank = store.get('bank', 0);
let time = 0;       // tiempo global (animaciones de fondo)
let menuDist = 0;   // desplazamiento del fondo en el menú

function newGame() {
  g = {
    t: 0, dist: 0, speed: START_SPEED, coins: 0,
    lane: 0, px: 0, jy: 0, vy: 0, slide: 0,
    shield: 0, inv: 0,
    objs: [], parts: [],
    untilSpawn: 0,
    deadT: 0, shake: 0, flash: 0,
  };
}

function score() { return Math.floor(g.dist * 0.5) + g.coins * 10; }

// ---------------------------------------------------------------------------
// Generación de obstáculos y monedas
// ---------------------------------------------------------------------------
function addCoinLine(lane, z, n = 4) {
  for (let i = 0; i < n; i++) g.objs.push({ type: 'coin', lane, z: z + i * 1.6, h: 0.45 });
}

function addCoinArc(lane, z) {
  for (let i = -2; i <= 2; i++) {
    const dz = i * 1.1;
    g.objs.push({ type: 'coin', lane, z: z + dz, h: 0.45 + 0.95 * (1 - (dz / 2.6) ** 2) });
  }
}

function spawnRow() {
  const z = SPAWN_Z;
  const lanes = [-1, 0, 1];
  const lvl = Math.min(1, g.t / 70);

  if (g.t < 2.5) { addCoinLine(pick(lanes), z, 5); return; }

  // Fila completa: hay que saltar o agacharse sí o sí
  if (Math.random() < 0.1 + 0.1 * lvl) {
    const type = Math.random() < 0.5 ? 'low' : 'bar';
    for (const l of lanes) g.objs.push({ type, lane: l, z });
    const l = pick(lanes);
    if (type === 'low') addCoinArc(l, z); else addCoinLine(l, z - 1.6, 3);
    return;
  }

  const free = shuffle([...lanes]);
  const n = Math.random() < 0.3 + 0.45 * lvl ? 2 : 1;
  const blocked = free.splice(0, n);
  for (const l of blocked) {
    const r = Math.random();
    g.objs.push({ type: r < 0.45 ? 'tall' : r < 0.75 ? 'low' : 'bar', lane: l, z });
  }
  const fl = pick(free);
  if (Math.random() < 0.05 && g.shield <= 0 && g.t > 10) {
    g.objs.push({ type: 'shield', lane: fl, z: z + 3, h: 0.55 });
  } else if (Math.random() < 0.8) {
    addCoinLine(fl, z + 2, 4);
  }
}

// ---------------------------------------------------------------------------
// Acciones del jugador
// ---------------------------------------------------------------------------
function moveLane(dir) {
  if (state !== 'play') return;
  const nl = clamp(g.lane + dir, -1, 1);
  if (nl !== g.lane) { g.lane = nl; sfx.lane(); }
}

function jump() {
  if (state !== 'play') return;
  if (g.jy <= 0.001) {
    g.vy = JUMP_V;
    g.jy = 0.001;
    g.slide = 0;
    sfx.jump();
  }
}

function slide() {
  if (state !== 'play') return;
  if (g.jy > 0.001) g.vy = -16; // caída rápida
  if (g.slide <= 0) sfx.slide();
  g.slide = SLIDE_T;
}

// ---------------------------------------------------------------------------
// Partículas (en coordenadas de pantalla)
// ---------------------------------------------------------------------------
function burst(x, y, color, n = 12, spd = 220) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = rand(0.3, 1) * spd;
    g.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, life: rand(0.35, 0.8), max: 0.8, color, r: rand(2, 4.5) });
  }
}

// ---------------------------------------------------------------------------
// Proyección
// ---------------------------------------------------------------------------
const view = { hy: 0, by: 0, lw: 0 };
function computeView() {
  view.hy = H * 0.36;
  view.by = H * 0.86;
  view.lw = Math.min(W * 0.27, H * 0.19, 190);
}
const S = (z) => CAM / (z + CAM);
// Punto del mundo (x en carriles, y altura, z profundidad) a pantalla
function P(x, y, z) {
  const s = S(z);
  return [W / 2 + x * view.lw * s, view.hy + s * ((view.by - view.hy) - y * view.lw)];
}

// ---------------------------------------------------------------------------
// Bucle de actualización
// ---------------------------------------------------------------------------
function step(dt) {
  time += dt;

  if (state === 'menu' || state === 'over') menuDist += dt * 8;

  if (!g) return;

  if (state === 'play') {
    g.t += dt;
    g.speed = START_SPEED + Math.min(MAX_EXTRA_SPEED, g.t * 0.3);
    const dz = g.speed * dt;
    g.dist += dz;

    g.px += (g.lane - g.px) * Math.min(1, dt * 15);

    if (g.jy > 0) {
      g.vy -= GRAV * dt;
      g.jy += g.vy * dt;
      if (g.jy <= 0) { g.jy = 0; g.vy = 0; }
    }
    if (g.slide > 0) g.slide -= dt;
    if (g.shield > 0) g.shield -= dt;
    if (g.inv > 0) g.inv -= dt;

    for (const o of g.objs) o.z -= dz;

    g.untilSpawn -= dz;
    if (g.untilSpawn <= 0) {
      spawnRow();
      g.untilSpawn = g.speed * rand(0.62, 0.95);
    }

    collide();
    g.objs = g.objs.filter((o) => !o.gone && o.z > -CAM + 0.4);
  } else if (state === 'dying') {
    g.deadT += dt;
    if (g.deadT > 1) gameOver();
  }

  if (g.shake > 0) g.shake = Math.max(0, g.shake - dt);
  if (g.flash > 0) g.flash = Math.max(0, g.flash - dt * 2.5);
  for (const p of g.parts) {
    p.life -= dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.vy += 600 * dt;
  }
  g.parts = g.parts.filter((p) => p.life > 0);
}

function collide() {
  for (const o of g.objs) {
    if (o.gone || Math.abs(o.z) > 0.55) continue;
    const dx = Math.abs(g.px - o.lane);

    if (o.type === 'coin' || o.type === 'shield') {
      if (dx > 0.6) continue;
      const top = g.jy + (g.slide > 0 ? 0.6 : 1.25);
      if (o.h < g.jy - 0.3 || o.h > top) continue;
      o.gone = true;
      const [x, y] = P(o.lane, o.h, 0);
      if (o.type === 'coin') {
        g.coins++;
        sfx.coin();
        burst(x, y, '#ffd23f', 8, 160);
      } else {
        g.shield = SHIELD_T;
        sfx.shield();
        burst(x, y, '#2de2ff', 20, 260);
      }
      continue;
    }

    if (dx > 0.45) continue;
    let hit = false;
    if (o.type === 'tall') hit = true;
    else if (o.type === 'low') hit = g.jy < 0.5;
    else if (o.type === 'bar') hit = g.slide <= 0;
    if (!hit || g.inv > 0) continue;

    const [x, y] = P(o.lane, 0.6, o.z);
    if (g.shield > 0) {
      g.shield = 0;
      g.inv = 1;
      o.gone = true;
      g.shake = 0.3;
      sfx.block();
      vibrate(40);
      burst(x, y, '#2de2ff', 24, 300);
      continue;
    }
    die(x, y);
    return;
  }
}

function die(x, y) {
  state = 'dying';
  g.deadT = 0;
  g.shake = 0.5;
  g.flash = 1;
  sfx.crash();
  vibrate([60, 40, 120]);
  burst(x, y, '#ff3ea5', 30, 380);
  burst(x, y, '#ffffff', 12, 260);
  ui.hud.classList.add('hidden');
}

// ---------------------------------------------------------------------------
// Dibujo
// ---------------------------------------------------------------------------
function poly(pts, fill, stroke, lw = 1.5) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
  if (fill) { ctx.fillStyle = fill; ctx.fill(); }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = lw; ctx.stroke(); }
}

// Caja en el mundo: centro x, ancho w, base y0, alto h, profundidad z..z+d
function box(x, w, y0, h, z, d, c) {
  const l = x - w / 2, r = x + w / 2, b = y0, t = y0 + h, z2 = z + d;
  // Lateral visible (la cámara está en x = 0)
  if (l > 0) poly([P(l, b, z), P(l, b, z2), P(l, t, z2), P(l, t, z)], c.side, c.edge);
  if (r < 0) poly([P(r, b, z), P(r, b, z2), P(r, t, z2), P(r, t, z)], c.side, c.edge);
  // Tapa superior (visible si está por debajo de los ojos)
  poly([P(l, t, z), P(r, t, z), P(r, t, z2), P(l, t, z2)], c.top, c.edge);
  // Frontal
  poly([P(l, b, z), P(r, b, z), P(r, t, z), P(l, t, z)], c.front, c.edge, 2);
}

const COL = {
  tall: { front: '#3b0d5e', side: '#24063d', top: '#5a1a8a', edge: '#ff3ea5' },
  low: { front: '#5e2a00', side: '#3a1900', top: '#8a4500', edge: '#ffa02d' },
  bar: { front: '#5e0021', side: '#3d0015', top: '#8a0033', edge: '#ff2d6a' },
  post: { front: '#2a2a40', side: '#1a1a2a', top: '#3a3a55', edge: '#ff2d6a' },
};

function drawBackground(dist) {
  const { hy } = view;

  // Cielo
  const sky = ctx.createLinearGradient(0, 0, 0, hy);
  sky.addColorStop(0, '#07011a');
  sky.addColorStop(0.6, '#2a0a4a');
  sky.addColorStop(1, '#6a1660');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, W, hy + 1);

  // Estrellas
  for (const s of stars) {
    ctx.globalAlpha = 0.4 + 0.4 * Math.sin(time * 2 + s.p);
    ctx.fillStyle = '#fff';
    ctx.fillRect(s.x * W, s.y * hy * 0.8, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  // Sol retro con franjas
  const sr = Math.min(W, H) * 0.2;
  const sx = W / 2, sy = hy - sr * 0.15;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, W, hy);
  ctx.clip();
  const sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
  sun.addColorStop(0, '#ffe66b');
  sun.addColorStop(0.5, '#ff7a3d');
  sun.addColorStop(1, '#ff2d8a');
  ctx.fillStyle = sun;
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a0d50';
  for (let i = 0; i < 6; i++) {
    const yy = sy + sr * (0.05 + i * 0.16);
    ctx.fillRect(sx - sr, yy, sr * 2, 2 + i * 1.6);
  }
  ctx.restore();

  // Montañas de silueta
  ctx.fillStyle = '#1a0533';
  ctx.beginPath();
  ctx.moveTo(0, hy);
  for (let i = 0; i <= 12; i++) {
    const x = (i / 12) * W;
    const hh = (Math.sin(i * 1.7) * 0.5 + 0.6) * H * 0.05 + (i % 2) * H * 0.02;
    ctx.lineTo(x, hy - hh);
  }
  ctx.lineTo(W, hy);
  ctx.fill();

  // Suelo
  const ground = ctx.createLinearGradient(0, hy, 0, H);
  ground.addColorStop(0, '#1a0430');
  ground.addColorStop(1, '#05010d');
  ctx.fillStyle = ground;
  ctx.fillRect(0, hy, W, H - hy);

  // Rejilla del suelo
  ctx.lineWidth = 1;
  for (let k = 0; k < 18; k++) {
    const z = k * 5 - (dist % 5);
    if (z < -2.5) continue;
    const [, y] = P(0, 0, z);
    ctx.strokeStyle = `rgba(255,62,165,${0.55 * Math.min(1, S(z) * 2)})`;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(W, y);
    ctx.stroke();
  }
  for (let i = -12; i <= 12; i++) {
    if (Math.abs(i) < 2) continue;
    const x = i * 1.5;
    const a = P(x, 0, 90), b = P(x, 0, -2.6);
    ctx.strokeStyle = 'rgba(255,62,165,0.35)';
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Carretera
  const far = 90, near = -2.6;
  poly([P(-1.5, 0, near), P(1.5, 0, near), P(1.5, 0, far), P(-1.5, 0, far)], 'rgba(18,4,40,0.92)');

  // Bordes de neón
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#2de2ff';
  for (const x of [-1.5, 1.5]) {
    const a = P(x, 0, far), b = P(x, 0, near);
    ctx.beginPath();
    ctx.moveTo(a[0], a[1]);
    ctx.lineTo(b[0], b[1]);
    ctx.stroke();
  }

  // Líneas de carril discontinuas
  ctx.fillStyle = 'rgba(45,226,255,0.55)';
  for (let k = 0; k < 24; k++) {
    const z = k * 4 - (dist % 4);
    if (z < -2.5) continue;
    for (const x of [-0.5, 0.5]) {
      poly([P(x - 0.03, 0, z), P(x + 0.03, 0, z), P(x + 0.03, 0, z + 1.8), P(x - 0.03, 0, z + 1.8)], 'rgba(45,226,255,0.55)');
    }
  }

  // Postes laterales de neón
  for (let k = 0; k < 12; k++) {
    const z = k * 8 - (dist % 8);
    if (z < -2) continue;
    for (const x of [-2.1, 2.1]) {
      const a = P(x, 0, z), b = P(x, 1.6, z);
      ctx.lineWidth = Math.max(1, 5 * S(z));
      ctx.strokeStyle = x < 0 ? '#ff3ea5' : '#2de2ff';
      ctx.beginPath();
      ctx.moveTo(a[0], a[1]);
      ctx.lineTo(b[0], b[1]);
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(b[0], b[1], Math.max(1.5, 6 * S(z)), 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawObj(o) {
  if ((o.type === 'coin' || o.type === 'shield') && o.z < -0.3) return;
  // Aparece suave al fondo y se desvanece al pasar junto a la cámara
  const alpha = clamp((SPAWN_Z + 4 - o.z) / 14, 0, 1) * clamp(1 + o.z / 1.8, 0, 1);
  if (alpha <= 0) return;
  ctx.globalAlpha = alpha;
  if (o.type === 'tall') {
    box(o.lane, 0.82, 0, 1.6, o.z, 0.9, COL.tall);
    // Marca de peligro
    const [x, y] = P(o.lane, 0.9, o.z);
    const u = view.lw * S(o.z);
    ctx.strokeStyle = '#ff3ea5';
    ctx.lineWidth = Math.max(1, u * 0.05);
    ctx.beginPath();
    ctx.moveTo(x - u * 0.2, y - u * 0.2);
    ctx.lineTo(x + u * 0.2, y + u * 0.2);
    ctx.moveTo(x + u * 0.2, y - u * 0.2);
    ctx.lineTo(x - u * 0.2, y + u * 0.2);
    ctx.stroke();
  } else if (o.type === 'low') {
    box(o.lane, 0.9, 0, 0.42, o.z, 0.3, COL.low);
    // Franjas
    const u = view.lw * S(o.z);
    const [x, y] = P(o.lane, 0.21, o.z);
    ctx.fillStyle = '#ffd23f';
    for (let i = -2; i <= 2; i++) ctx.fillRect(x + i * u * 0.18 - u * 0.04, y - u * 0.1, u * 0.08, u * 0.2);
  } else if (o.type === 'bar') {
    box(o.lane - 0.4, 0.07, 0, 1.08, o.z, 0.07, COL.post);
    box(o.lane + 0.4, 0.07, 0, 1.08, o.z, 0.07, COL.post);
    box(o.lane, 0.92, 0.72, 0.34, o.z, 0.15, COL.bar);
  } else if (o.type === 'coin') {
    const [x, y] = P(o.lane, o.h, o.z);
    const r = view.lw * S(o.z) * 0.17;
    const sx = Math.abs(Math.cos(time * 5 + o.z * 0.4));
    ctx.fillStyle = 'rgba(255,210,63,0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#ffd23f';
    ctx.beginPath();
    ctx.ellipse(x, y, Math.max(1, r * sx), r, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#fff6c2';
    ctx.beginPath();
    ctx.ellipse(x - r * 0.25 * sx, y - r * 0.25, Math.max(0.5, r * 0.3 * sx), r * 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (o.type === 'shield') {
    const [x, y] = P(o.lane, o.h + Math.sin(time * 4) * 0.08, o.z);
    const r = view.lw * S(o.z) * 0.24;
    ctx.fillStyle = 'rgba(45,226,255,0.25)';
    ctx.beginPath();
    ctx.arc(x, y, r * 1.7, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2de2ff';
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.lineTo(x + r * 0.85, y - r * 0.55);
    ctx.lineTo(x + r * 0.7, y + r * 0.4);
    ctx.lineTo(x, y + r);
    ctx.lineTo(x - r * 0.7, y + r * 0.4);
    ctx.lineTo(x - r * 0.85, y - r * 0.55);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#e8fbff';
    ctx.font = `900 ${Math.max(6, r * 1.1)}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('S', x, y + r * 0.05);
  }
  ctx.globalAlpha = 1;
}

function drawPlayer() {
  const u = view.lw; // píxeles por unidad a z = 0
  const [gx, gy] = P(g.px, 0, 0);
  const sliding = g.slide > 0 && g.jy <= 0.001;
  const hBody = sliding ? 0.45 : 1.1;
  const wBody = sliding ? 0.7 : 0.5;
  const [cx, cy] = P(g.px, g.jy, 0);

  // Sombra
  const sh = 1 / (1 + g.jy * 0.8);
  ctx.fillStyle = 'rgba(0,0,0,0.45)';
  ctx.beginPath();
  ctx.ellipse(gx, gy, u * 0.32 * sh, u * 0.08 * sh, 0, 0, Math.PI * 2);
  ctx.fill();

  if (state === 'dying') return;
  if (g.inv > 0 && Math.floor(time * 20) % 2) return; // parpadeo

  const w = wBody * u, h = hBody * u;
  const top = cy - h;

  // Piernas (animación de carrera)
  if (!sliding) {
    const run = g.jy > 0.001 ? 0.6 : Math.sin(g.dist * 1.6);
    ctx.strokeStyle = '#1b8fb0';
    ctx.lineWidth = u * 0.11;
    ctx.lineCap = 'round';
    const legTop = cy - h * 0.32;
    ctx.beginPath();
    ctx.moveTo(cx - w * 0.22, legTop);
    ctx.lineTo(cx - w * 0.22, cy - u * 0.04 - Math.max(0, run) * u * 0.18);
    ctx.moveTo(cx + w * 0.22, legTop);
    ctx.lineTo(cx + w * 0.22, cy - u * 0.04 - Math.max(0, -run) * u * 0.18);
    ctx.stroke();
  }

  // Cuerpo
  const bodyBottom = sliding ? cy : cy - h * 0.3;
  const r = Math.min(w, h) * 0.35;
  ctx.fillStyle = '#2de2ff';
  roundRect(cx - w / 2, top, w, bodyBottom - top, r);
  ctx.fill();
  // Mochila (vista de espaldas)
  ctx.fillStyle = '#ff3ea5';
  roundRect(cx - w * 0.3, top + (bodyBottom - top) * 0.35, w * 0.6, (bodyBottom - top) * 0.45, r * 0.5);
  ctx.fill();
  // Rayo en la mochila
  ctx.fillStyle = '#ffd23f';
  const bx = cx, by = top + (bodyBottom - top) * 0.57, bs = Math.min(w, bodyBottom - top) * 0.18;
  ctx.beginPath();
  ctx.moveTo(bx + bs * 0.3, by - bs);
  ctx.lineTo(bx - bs * 0.5, by + bs * 0.15);
  ctx.lineTo(bx, by + bs * 0.15);
  ctx.lineTo(bx - bs * 0.3, by + bs);
  ctx.lineTo(bx + bs * 0.5, by - bs * 0.15);
  ctx.lineTo(bx, by - bs * 0.15);
  ctx.closePath();
  ctx.fill();
  // Antena
  ctx.strokeStyle = '#2de2ff';
  ctx.lineWidth = Math.max(1.5, u * 0.03);
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.lineTo(cx + w * 0.15, top - u * 0.15);
  ctx.stroke();
  ctx.fillStyle = '#ffd23f';
  ctx.beginPath();
  ctx.arc(cx + w * 0.15, top - u * 0.15, u * 0.05, 0, Math.PI * 2);
  ctx.fill();

  // Escudo
  if (g.shield > 0) {
    const blink = g.shield < 2 && Math.floor(time * 8) % 2;
    if (!blink) {
      ctx.strokeStyle = 'rgba(45,226,255,0.9)';
      ctx.fillStyle = 'rgba(45,226,255,0.15)';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.ellipse(cx, cy - h / 2, w * 1.05, h * 0.75, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }
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

function render() {
  computeView();
  ctx.save();
  if (g && g.shake > 0) {
    const m = g.shake * 18;
    ctx.translate(rand(-m, m), rand(-m, m));
  }

  const playing = g && state !== 'menu';
  drawBackground(playing ? g.dist : menuDist);

  if (playing) {
    const objs = [...g.objs].sort((a, b) => b.z - a.z);
    for (const o of objs) if (o.z > 0) drawObj(o);
    drawPlayer();
    for (const o of objs) if (o.z <= 0) drawObj(o);

    for (const p of g.parts) {
      ctx.globalAlpha = clamp(p.life / p.max * 1.5, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.r / 2, p.y - p.r / 2, p.r, p.r);
    }
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  if (g && g.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${g.flash * 0.6})`;
    ctx.fillRect(0, 0, W, H);
  }
}

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
const ui = {
  hud: $('hud'), score: $('score'), coins: $('coins'),
  shield: $('shield'), shieldTime: $('shieldTime'),
  menu: $('menu'), pause: $('pause'), over: $('over'),
  best: $('best'), bank: $('bank'),
  finalScore: $('finalScore'), finalCoins: $('finalCoins'), finalBest: $('finalBest'),
  record: $('record'), sound: $('soundBtn'),
};

let lastHud = '';
function updateHud() {
  if (!g || state !== 'play') return;
  const key = score() + '|' + g.coins + '|' + Math.ceil(g.shield);
  if (key === lastHud) return;
  lastHud = key;
  ui.score.textContent = score();
  ui.coins.textContent = g.coins;
  ui.shield.classList.toggle('hidden', g.shield <= 0);
  ui.shieldTime.textContent = Math.ceil(g.shield);
}

function show(el) {
  for (const o of [ui.menu, ui.pause, ui.over]) o.classList.toggle('hidden', o !== el);
}

function refreshMenu() {
  ui.best.textContent = best;
  ui.bank.textContent = bank;
  ui.sound.textContent = muted ? '🔇 Sonido: No' : '🔊 Sonido: Sí';
}

function startGame() {
  initAudio();
  newGame();
  state = 'play';
  lastHud = '';
  show(null);
  ui.hud.classList.remove('hidden');
  updateHud();
}

function pauseGame() {
  if (state !== 'play') return;
  state = 'pause';
  show(ui.pause);
}

function resumeGame() {
  if (state !== 'pause') return;
  initAudio();
  state = 'play';
  show(null);
}

function toMenu() {
  state = 'menu';
  g = null;
  ui.hud.classList.add('hidden');
  refreshMenu();
  show(ui.menu);
}

function gameOver() {
  state = 'over';
  const sc = score();
  const isRecord = sc > best;
  if (isRecord) { best = sc; store.set('best', best); }
  bank += g.coins;
  store.set('bank', bank);
  ui.finalScore.textContent = sc;
  ui.finalCoins.textContent = g.coins;
  ui.finalBest.textContent = best;
  ui.record.classList.toggle('hidden', !isRecord);
  show(ui.over);
}

$('playBtn').addEventListener('click', startGame);
$('againBtn').addEventListener('click', startGame);
$('menuBtn').addEventListener('click', toMenu);
$('resumeBtn').addEventListener('click', resumeGame);
$('quitBtn').addEventListener('click', toMenu);
$('pauseBtn').addEventListener('click', pauseGame);
ui.sound.addEventListener('click', () => {
  muted = !muted;
  store.set('muted', muted);
  initAudio();
  refreshMenu();
});

// ---------------------------------------------------------------------------
// Entrada: gestos táctiles, ratón y teclado
// ---------------------------------------------------------------------------
const SWIPE_MIN = 24;
let touch = null;

function gestureStart(x, y) { touch = { x, y, t: performance.now(), used: false }; }
function gestureMove(x, y) {
  if (!touch || touch.used) return;
  const dx = x - touch.x, dy = y - touch.y;
  if (Math.max(Math.abs(dx), Math.abs(dy)) < SWIPE_MIN) return;
  touch.used = true;
  if (Math.abs(dx) > Math.abs(dy)) moveLane(dx > 0 ? 1 : -1);
  else if (dy < 0) jump();
  else slide();
}
function gestureEnd() {
  if (touch && !touch.used && performance.now() - touch.t < 350) jump(); // toque = saltar
  touch = null;
}

const isUi = (e) => e.target.closest && e.target.closest('button, .card');

window.addEventListener('touchstart', (e) => {
  if (isUi(e)) return;
  e.preventDefault();
  initAudio();
  const t = e.changedTouches[0];
  gestureStart(t.clientX, t.clientY);
}, { passive: false });
window.addEventListener('touchmove', (e) => {
  if (!touch) return;
  e.preventDefault();
  const t = e.changedTouches[0];
  gestureMove(t.clientX, t.clientY);
}, { passive: false });
window.addEventListener('touchend', (e) => {
  if (!touch) return;
  e.preventDefault();
  gestureEnd();
}, { passive: false });
window.addEventListener('touchcancel', () => { touch = null; });

// Ratón (para probar en PC arrastrando)
canvas.addEventListener('mousedown', (e) => gestureStart(e.clientX, e.clientY));
window.addEventListener('mousemove', (e) => { if (e.buttons) gestureMove(e.clientX, e.clientY); });
window.addEventListener('mouseup', () => { if (touch) gestureEnd(); });

window.addEventListener('keydown', (e) => {
  const k = e.key;
  if (state === 'play') {
    if (k === 'ArrowLeft' || k === 'a' || k === 'A') moveLane(-1);
    else if (k === 'ArrowRight' || k === 'd' || k === 'D') moveLane(1);
    else if (k === 'ArrowUp' || k === 'w' || k === 'W' || k === ' ') jump();
    else if (k === 'ArrowDown' || k === 's' || k === 'S') slide();
    else if (k === 'Escape' || k === 'p' || k === 'P') pauseGame();
    else return;
    e.preventDefault();
  } else if (state === 'pause' && (k === 'Escape' || k === 'p' || k === 'P' || k === 'Enter')) {
    resumeGame();
  } else if ((state === 'menu' || state === 'over') && (k === 'Enter' || k === ' ')) {
    e.preventDefault();
    startGame();
  }
});

// Pausa automática al salir de la app
document.addEventListener('visibilitychange', () => { if (document.hidden) pauseGame(); });
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
let last = performance.now();
function frame(now) {
  let dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  // Sub-pasos para que las colisiones no se salten objetos a alta velocidad
  while (dt > 0) {
    const s = Math.min(dt, 1 / 120);
    step(s);
    dt -= s;
  }
  updateHud();
  render();
  requestAnimationFrame(frame);
}

resize();
refreshMenu();
show(ui.menu);
requestAnimationFrame(frame);

// Gancho para pruebas automáticas
window.__rayo = { get state() { return state; }, get game() { return g; }, startGame, moveLane, jump, slide };
