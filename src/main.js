// Isla Rodante — inclina la isla para llevar la bola hasta la meta.
import * as THREE from '../vendor/three.module.min.js';
import { WORLDS, prepare, dailyLevel, dailyNumber } from './levels.js';

// ---------------------------------------------------------------------------
// Utilidades y guardado
// ---------------------------------------------------------------------------
const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };
const easeOut = (t) => 1 - (1 - t) ** 3;
const fmtTime = (t) => {
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1).replace('.', ',')}`;
};

const store = {
  get(k, d) {
    try { const v = localStorage.getItem('isla.' + k); return v === null ? d : JSON.parse(v); }
    catch { return d; }
  },
  set(k, v) { try { localStorage.setItem('isla.' + k, JSON.stringify(v)); } catch { /* sin almacenamiento */ } },
};
const settings = Object.assign({ sound: true, vibe: true, motion: false }, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);
const vibrate = (p) => { if (settings.vibe && navigator.vibrate) navigator.vibrate(p); };

// ---------------------------------------------------------------------------
// Sonido (sintetizado, sin archivos)
// ---------------------------------------------------------------------------
let actx = null, rollGain = null, rollFilter = null;
function initAudio() {
  if (!actx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    actx = new AC();
    // Ruido marrón en bucle para el sonido de rodar
    const len = actx.sampleRate * 2;
    const buf = actx.createBuffer(1, len, actx.sampleRate);
    const d = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = actx.createBufferSource();
    src.buffer = buf; src.loop = true;
    rollFilter = actx.createBiquadFilter(); rollFilter.type = 'lowpass'; rollFilter.frequency.value = 300;
    rollGain = actx.createGain(); rollGain.gain.value = 0;
    src.connect(rollFilter).connect(rollGain).connect(actx.destination);
    src.start();
  }
  if (actx.state === 'suspended') actx.resume();
}
function setRoll(speed) {
  if (!rollGain) return;
  const v = settings.sound ? clamp(speed / 8, 0, 1) * 0.5 : 0;
  rollGain.gain.setTargetAtTime(v, actx.currentTime, 0.05);
  rollFilter.frequency.setTargetAtTime(180 + speed * 110, actx.currentTime, 0.05);
}
function tone(f1, f2, dur, type = 'sine', vol = 0.1, delay = 0) {
  if (!actx || !settings.sound) return;
  const t = actx.currentTime + delay;
  const o = actx.createOscillator(), g = actx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(f1, t);
  o.frequency.exponentialRampToValueAtTime(f2, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(actx.destination);
  o.start(t); o.stop(t + dur + 0.05);
}
const sfx = {
  click() { tone(880, 660, 0.06, 'triangle', 0.06); },
  gem() { [1047, 1319, 1568].forEach((f, i) => tone(f, f, 0.16, 'triangle', 0.08, i * 0.06)); },
  bump(v) { tone(140, 70, 0.12, 'sine', clamp(v / 10, 0.04, 0.22)); },
  fall() { tone(520, 90, 0.7, 'triangle', 0.12); },
  win() { [523, 659, 784, 1047, 1319].forEach((f, i) => tone(f, f, 0.25, 'triangle', 0.1, i * 0.09)); },
  star(i) { tone(660 + i * 220, 660 + i * 220, 0.18, 'triangle', 0.09); },
  respawn() { tone(300, 600, 0.2, 'sine', 0.08); },
};

// ---------------------------------------------------------------------------
// Escena 3D
// ---------------------------------------------------------------------------
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.setClearColor(0x000000, 0);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);

const hemi = new THREE.HemisphereLight(0xfff4e8, 0x9c7a6a, 1.6);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 2.4);
sun.position.set(-7, 16, 9);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.03;
sun.shadow.radius = 4;
scene.add(sun, sun.target);

const island = new THREE.Group();   // se inclina con el dedo
scene.add(island);
const levelGroup = new THREE.Group(); // contenido del nivel (se reconstruye)
island.add(levelGroup);

// Bola de playa
function ballTexture() {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 256;
  const g = c.getContext('2d');
  const cols = ['#ff5f7e', '#ffffff', '#ffc93c', '#ffffff', '#38b6ff', '#ffffff'];
  cols.forEach((col, i) => { g.fillStyle = col; g.fillRect((i * 512) / 6, 0, 512 / 6 + 1, 256); });
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, 512, 22); g.fillRect(0, 234, 512, 22);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
const BALL_R = 0.3;
const ball = new THREE.Mesh(
  new THREE.SphereGeometry(BALL_R, 40, 28),
  new THREE.MeshStandardMaterial({ map: ballTexture(), roughness: 0.35, metalness: 0 })
);
ball.castShadow = true;
island.add(ball);

// Nubes bajo la isla
const clouds = new THREE.Group();
scene.add(clouds);
{
  const cm = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, transparent: true, opacity: 0.92 });
  const cg = new THREE.IcosahedronGeometry(1, 0);
  for (let i = 0; i < 12; i++) {
    const cl = new THREE.Group();
    const n = 3 + (i % 3);
    for (let k = 0; k < n; k++) {
      const m = new THREE.Mesh(cg, cm);
      m.position.set(k * 0.9 - n * 0.45, Math.sin(k * 2.1) * 0.25, Math.cos(k * 1.3) * 0.4);
      m.scale.setScalar(0.6 + hash(i, k) * 0.7);
      cl.add(m);
    }
    const a = (i / 12) * Math.PI * 2;
    cl.position.set(Math.cos(a) * (11 + hash(i, 3) * 9), -7 - hash(i, 9) * 7, Math.sin(a) * (6 + hash(i, 5) * 8) - 4);
    cl.userData.speed = 0.15 + hash(i, 7) * 0.25;
    clouds.add(cl);
  }
}

// Geometrías compartidas
const GEO = {
  floor: new THREE.BoxGeometry(1, 0.42, 1).translate(0, -0.21, 0),
  dirt: new THREE.BoxGeometry(0.98, 0.7, 0.98).translate(0, -0.77, 0),
  spike: new THREE.ConeGeometry(0.62, 1, 5).rotateX(Math.PI).translate(0, -0.5, 0),
  wall: new THREE.BoxGeometry(1, 0.55, 1).translate(0, 0.275, 0),
  trunk: new THREE.CylinderGeometry(0.07, 0.09, 0.35, 6).translate(0, 0.175, 0),
  leaves: new THREE.ConeGeometry(0.34, 0.6, 7).translate(0, 0.3, 0),
  bush: new THREE.IcosahedronGeometry(0.22, 0),
  gem: new THREE.OctahedronGeometry(0.24, 0).scale(0.8, 1.15, 0.8),
  pad: new THREE.CylinderGeometry(0.42, 0.46, 0.06, 32),
  ring: new THREE.TorusGeometry(0.4, 0.035, 8, 48),
  pole: new THREE.CylinderGeometry(0.025, 0.025, 0.9, 8).translate(0, 0.45, 0),
  flag: (() => { const s = new THREE.Shape(); s.moveTo(0, 0); s.lineTo(0.38, -0.12); s.lineTo(0, -0.26); s.closePath(); return new THREE.ShapeGeometry(s); })(),
  conf: new THREE.PlaneGeometry(0.08, 0.13),
};

let level = null;      // nivel preparado
let world = WORLDS[0];
let gems = [];
let goalFx = null;
let ox = 0, oz = 0;

function disposeLevel() {
  levelGroup.traverse((o) => {
    if (o.isMesh || o.isInstancedMesh) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => m.dispose());
      if (o.isInstancedMesh) o.dispose();
    }
  });
  levelGroup.clear();
}

function buildLevel(lv, wd) {
  disposeLevel();
  level = lv;
  world = wd;
  const { w, h, map } = lv;
  ox = (w - 1) / 2; oz = (h - 1) / 2;
  const floors = [], walls = [], ice = [], solid = [];
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const c = map[y][x];
      if (c === ' ' || c === 'o') continue;
      solid.push([x, y]);
      if (c === '#' || c === 'T') walls.push([x, y, c]);
      if (c === '~') ice.push([x, y]); else floors.push([x, y]);
    }
  }
  const m4 = new THREE.Matrix4();
  const col = new THREE.Color();
  const q = new THREE.Quaternion();
  const v = new THREE.Vector3();
  const s = new THREE.Vector3();
  const place = (mesh, i, x, y, sy = 1, dy = 0, sxz = 1) => {
    v.set(x - ox, dy, y - oz);
    s.set(sxz, sy, sxz);
    m4.compose(v, q, s);
    mesh.setMatrixAt(i, m4);
  };
  const inst = (geo, mat, n, shadowCast, shadowRecv) => {
    const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    m.count = n;
    m.castShadow = shadowCast;
    m.receiveShadow = shadowRecv;
    levelGroup.add(m);
    return m;
  };

  // Suelo (césped / arena / nieve)
  const fl = inst(GEO.floor, new THREE.MeshStandardMaterial({ roughness: 0.95, flatShading: true }), floors.length, false, true);
  floors.forEach(([x, y], i) => {
    place(fl, i, x, y);
    fl.setColorAt(i, col.set(world.grass).lerp(new THREE.Color(world.grass2), hash(x, y)));
  });
  // Hielo
  const ic = inst(GEO.floor, new THREE.MeshStandardMaterial({ color: world.ice, roughness: 0.12, metalness: 0.05 }), ice.length, false, true);
  ice.forEach(([x, y], i) => place(ic, i, x, y));
  // Tierra
  const dt = inst(GEO.dirt, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), solid.length, false, false);
  solid.forEach(([x, y], i) => {
    place(dt, i, x, y);
    dt.setColorAt(i, col.set(world.dirt).offsetHSL(0, 0, (hash(y, x) - 0.5) * 0.06));
  });
  // Rocas colgando bajo la isla
  const sp = inst(GEO.spike, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), solid.length, false, false);
  solid.forEach(([x, y], i) => {
    const r = hash(x * 3.1, y * 1.7);
    const edge = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => { const c = (map[y + dy] || '')[x + dx]; return !c || c === ' ' || c === 'o'; });
    place(sp, i, x, y, edge ? 0.6 + r * 0.8 : 1.2 + r * 2.4, -1.1, 0.85 + r * 0.3);
    sp.setColorAt(i, col.set(world.rock).offsetHSL(0, 0, (r - 0.5) * 0.08));
  });
  // Muros
  const wl = inst(GEO.wall, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), walls.length, true, true);
  walls.forEach(([x, y], i) => {
    place(wl, i, x, y, 0.92 + hash(x, y * 2) * 0.16);
    wl.setColorAt(i, col.set(world.wall).lerp(new THREE.Color(world.wall2), hash(x * 2, y)));
  });
  // Árboles y arbustos decorativos
  const trees = walls.filter(([x, y, c]) => c === 'T' || hash(x * 5.3, y * 2.9) > 0.86);
  const tr = inst(GEO.trunk, new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1, flatShading: true }), trees.length, true, false);
  const lvs = inst(GEO.leaves, new THREE.MeshStandardMaterial({ roughness: 0.9, flatShading: true }), trees.length * 2, true, false);
  trees.forEach(([x, y], i) => {
    const r = hash(x, y * 7);
    place(tr, i, x, y, 1, 0.55);
    place(lvs, i * 2, x, y, 0.9 + r * 0.4, 0.8, 1);
    place(lvs, i * 2 + 1, x, y, 0.7 + r * 0.3, 1.1, 0.75);
    const tc = world.id === 'nieve' ? '#5d8f74' : world.id === 'desierto' ? '#7fae5a' : '#3f9a4f';
    lvs.setColorAt(i * 2, col.set(tc));
    lvs.setColorAt(i * 2 + 1, col.set(tc).offsetHSL(0, 0, 0.06));
  });
  const bushes = walls.filter(([x, y, c]) => c !== 'T' && hash(x * 1.9, y * 4.1) > 0.7 && hash(x * 5.3, y * 2.9) <= 0.86);
  const bu = inst(GEO.bush, new THREE.MeshStandardMaterial({ roughness: 1, flatShading: true }), bushes.length, true, false);
  bushes.forEach(([x, y], i) => {
    place(bu, i, x, y, 0.8, 0.62, 0.9 + hash(y, x) * 0.5);
    bu.setColorAt(i, col.set(world.id === 'desierto' ? '#9c6b4a' : world.id === 'nieve' ? '#ffffff' : '#6cc06a'));
  });
  for (const m of [fl, dt, sp, wl, lvs, bu]) if (m.instanceColor) m.instanceColor.needsUpdate = true;

  // Salida
  const [sx, sy] = lv.start;
  const startPad = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.02, 32), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, transparent: true, opacity: 0.7 }));
  startPad.position.set(sx - ox, 0.012, sy - oz);
  startPad.receiveShadow = true;
  levelGroup.add(startPad);

  // Meta
  const [gx, gy] = lv.goal;
  const goal = new THREE.Group();
  goal.position.set(gx - ox, 0, gy - oz);
  const pad = new THREE.Mesh(GEO.pad, new THREE.MeshStandardMaterial({ color: 0xffc93c, emissive: 0xffa000, emissiveIntensity: 0.35, roughness: 0.4 }));
  pad.position.y = 0.03;
  pad.receiveShadow = true;
  const ring = new THREE.Mesh(GEO.ring, new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffe08a, emissiveIntensity: 0.8 }));
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.12;
  const pole = new THREE.Mesh(GEO.pole, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.5 }));
  pole.position.set(0.32, 0, -0.32);
  pole.castShadow = true;
  const flag = new THREE.Mesh(GEO.flag, new THREE.MeshStandardMaterial({ color: 0xff4f8b, side: THREE.DoubleSide, roughness: 0.6 }));
  flag.position.set(0.32, 0.88, -0.32);
  flag.castShadow = true;
  goal.add(pad, ring, pole, flag);
  levelGroup.add(goal);
  goalFx = { ring, flag };

  // Gemas
  gems = lv.gems.map(([x, y], i) => {
    const m = new THREE.Mesh(GEO.gem, new THREE.MeshStandardMaterial({ color: 0x7ee8ff, emissive: 0x2bb6ff, emissiveIntensity: 0.7, roughness: 0.15, metalness: 0.1, flatShading: true }));
    m.position.set(x - ox, 0.5, y - oz);
    m.castShadow = true;
    m.userData.phase = i * 1.3;
    levelGroup.add(m);
    return { mesh: m, x: x - ox, z: y - oz, taken: false, fx: 0 };
  });

  // Sombras ajustadas al tamaño de la isla
  const ext = Math.max(w, h) / 2 + 3;
  Object.assign(sun.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 60 });
  sun.shadow.camera.updateProjectionMatrix();

  document.documentElement.style.setProperty('--sky1', world.sky[0]);
  document.documentElement.style.setProperty('--sky2', world.sky[1]);
  fitCamera();
}

// ---------------------------------------------------------------------------
// Cámara
// ---------------------------------------------------------------------------
const camGoal = new THREE.Vector3();
const camLook = new THREE.Vector3(0, -0.4, 0.3);
let camIntro = 1;
function fitCamera() {
  const W = window.innerWidth, H = window.innerHeight;
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  if (!level) return;
  const elev = (58 * Math.PI) / 180;
  const vf = (camera.fov * Math.PI) / 180;
  const hf = 2 * Math.atan(Math.tan(vf / 2) * camera.aspect);
  const needW = level.w + 0.9;
  const needD = level.h * Math.sin(elev) + 2.4;
  // Deja hueco arriba para el HUD
  const dist = Math.max((needW / 2) / Math.tan(hf / 2), (needD / 2) / Math.tan(vf / 2) * 1.15) + 0.6;
  camGoal.set(0, Math.sin(elev) * dist, Math.cos(elev) * dist);
}
function startCamIntro() { camIntro = 0; }

// ---------------------------------------------------------------------------
// Estado de la partida
// ---------------------------------------------------------------------------
let state = 'menu'; // menu | levels | play | pause | done
let cur = null;     // { wi, li, daily, n }
const B = { x: 0, z: 0, vx: 0, vz: 0, y: BALL_R, vy: 0, falling: false, fallT: 0, sinking: 0, spawn: 0 };
let tilt = { x: 0, z: 0 }, tiltTarget = { x: 0, z: 0 };
let timer = 0, timerOn = false, falls = 0, gemsTaken = 0;
const MAX_TILT = 0.24;
const GRAV = 24;
let confetti = [];
let shake = 0;

const cellAt = (x, z) => {
  const ix = Math.round(x + ox), iz = Math.round(z + oz);
  if (iz < 0 || iz >= level.h || ix < 0 || ix >= level.w) return ' ';
  return level.map[iz][ix];
};
const isWall = (c) => c === '#' || c === 'T';
const isVoid = (c) => c === ' ' || c === 'o';

function placeBallAtStart(drop = true) {
  const [sx, sy] = level.start;
  Object.assign(B, { x: sx - ox, z: sy - oz, vx: 0, vz: 0, y: drop ? BALL_R + 3 : BALL_R, vy: 0, falling: false, fallT: 0, sinking: 0, spawn: drop ? 1 : 0 });
  ball.scale.setScalar(1);
  ball.quaternion.identity();
}

function levelId(wi, li) { return `${WORLDS[wi].id}-${li}`; }
function getProgress() { return store.get('progress', {}); }
function isDone(wi, li) { return !!getProgress()[levelId(wi, li)]; }
function isUnlocked(wi, li) {
  if (li > 0) return isDone(wi, li - 1);
  if (wi === 0) return true;
  return isDone(wi - 1, WORLDS[wi - 1].levels.length - 1);
}
function totalStars() { return Object.values(getProgress()).reduce((s, p) => s + p.stars, 0); }
const MAX_STARS = WORLDS.reduce((s, w) => s + w.levels.length * 3, 0);

function startLevel(wi, li) {
  initAudio();
  cur = { wi, li, daily: false };
  const wd = WORLDS[wi];
  buildLevel(prepare(wd.levels[li]), wd);
  beginPlay(`${wi + 1}-${li + 1}`, wd.levels[li].name);
}
function startDaily() {
  initAudio();
  const n = dailyNumber();
  const d = dailyLevel(n);
  cur = { daily: true, n };
  buildLevel(prepare(d), d.world);
  beginPlay(`#${n}`, 'Isla del día');
}
function beginPlay(tag, name) {
  island.rotation.set(0, 0, 0);
  tilt = { x: 0, z: 0 };
  tiltTarget = { x: 0, z: 0 };
  timer = 0; timerOn = false; falls = 0; gemsTaken = 0;
  placeBallAtStart(true);
  ui.lvTag.textContent = tag;
  ui.lvName.textContent = name;
  ui.gems.textContent = '0/3';
  ui.time.textContent = fmtTime(0);
  ui.par.textContent = 'Objetivo ' + fmtTime(level.par).replace(',0', '');
  state = 'play';
  setScreen('hud');
  calibrateMotion();
  startCamIntro();
  showBanner(tag, name);
  const first = !cur.daily && cur.wi === 0 && cur.li === 0 && !isDone(0, 0);
  ui.hint.classList.toggle('on', first);
}

// ---------------------------------------------------------------------------
// Física de la bola
// ---------------------------------------------------------------------------
function physics(dt) {
  if (B.spawn > 0) { // cae desde arriba al empezar / reaparecer
    B.vy -= 30 * dt;
    B.y += B.vy * dt;
    if (B.y <= BALL_R) { B.y = BALL_R; B.vy = 0; B.spawn = 0; sfx.bump(4); }
    return;
  }
  if (B.sinking > 0) { // entrando en la meta
    B.sinking += dt;
    const [gx, gy] = level.goal;
    B.x += (gx - ox - B.x) * Math.min(1, dt * 10);
    B.z += (gy - oz - B.z) * Math.min(1, dt * 10);
    B.y = BALL_R - easeOut(Math.min(1, B.sinking / 0.6)) * 0.5;
    ball.scale.setScalar(1 - easeOut(Math.min(1, B.sinking / 0.6)) * 0.8);
    return;
  }
  if (B.falling) {
    B.vy -= 26 * dt;
    B.y += B.vy * dt;
    B.x += B.vx * dt; B.z += B.vz * dt;
    B.fallT += dt;
    if (B.fallT > 1.1) {
      falls++;
      placeBallAtStart(true);
      sfx.respawn();
    }
    return;
  }

  const c = cellAt(B.x, B.z);
  const onIce = c === '~';
  const ax = -GRAV * Math.sin(tilt.z);
  const az = GRAV * Math.sin(tilt.x);
  B.vx += ax * dt;
  B.vz += az * dt;
  const k = Math.exp(-(onIce ? 0.12 : 1.5) * dt);
  B.vx *= k; B.vz *= k;
  const sp = Math.hypot(B.vx, B.vz);
  if (sp > 11) { B.vx *= 11 / sp; B.vz *= 11 / sp; }
  B.x += B.vx * dt;
  B.z += B.vz * dt;

  // Choques con muros (círculo contra casillas)
  const ix = Math.round(B.x + ox), iz = Math.round(B.z + oz);
  for (let yy = iz - 1; yy <= iz + 1; yy++) {
    for (let xx = ix - 1; xx <= ix + 1; xx++) {
      if (yy < 0 || yy >= level.h || xx < 0 || xx >= level.w) continue;
      if (!isWall(level.map[yy][xx])) continue;
      const cx = xx - ox, cz = yy - oz;
      const px = clamp(B.x, cx - 0.5, cx + 0.5), pz = clamp(B.z, cz - 0.5, cz + 0.5);
      let dx = B.x - px, dz = B.z - pz;
      let d = Math.hypot(dx, dz);
      if (d >= BALL_R) continue;
      if (d < 1e-6) { // centro dentro del muro: empuja por el eje más corto
        const ex = B.x - cx, ez = B.z - cz;
        if (Math.abs(ex) > Math.abs(ez)) { dx = Math.sign(ex) || 1; dz = 0; } else { dx = 0; dz = Math.sign(ez) || 1; }
        d = 0;
        B.x = cx + dx * (0.5 + BALL_R); B.z = cz + dz * (0.5 + BALL_R);
      } else {
        dx /= d; dz /= d;
        B.x = px + dx * BALL_R; B.z = pz + dz * BALL_R;
      }
      const vn = B.vx * dx + B.vz * dz;
      if (vn < 0) {
        B.vx -= 1.45 * vn * dx;
        B.vz -= 1.45 * vn * dz;
        if (-vn > 1.5) { sfx.bump(-vn); vibrate(Math.min(25, -vn * 3)); }
      }
    }
  }

  // ¿Sin suelo? Se cae
  if (isVoid(cellAt(B.x, B.z))) {
    B.falling = true; B.fallT = 0; B.vy = 0;
    timerOn = true;
    sfx.fall(); vibrate([40, 30, 60]);
    shake = 0.3;
    return;
  }

  // Gemas
  for (const g of gems) {
    if (g.taken) continue;
    if (Math.hypot(B.x - g.x, B.z - g.z) < 0.45) {
      g.taken = true;
      gemsTaken++;
      ui.gems.textContent = `${gemsTaken}/3`;
      ui.gemsPill.classList.remove('pop'); void ui.gemsPill.offsetWidth; ui.gemsPill.classList.add('pop');
      sfx.gem(); vibrate(20);
    }
  }

  // Meta
  const [gx, gy] = level.goal;
  if (Math.hypot(B.x - (gx - ox), B.z - (gy - oz)) < 0.32) win();
}

// ---------------------------------------------------------------------------
// Victoria
// ---------------------------------------------------------------------------
function win() {
  B.sinking = 0.0001;
  timerOn = false;
  state = 'done';
  setRoll(0);
  sfx.win(); vibrate([30, 40, 30, 40, 80]);
  burstConfetti();
  const stars = 1 + (gemsTaken === 3 ? 1 : 0) + (timer <= level.par ? 1 : 0);
  let record = false;
  if (cur.daily) {
    const d = store.get('daily', {});
    const prev = d[cur.n];
    if (!prev || timer < prev.time) { d[cur.n] = { time: timer, stars, gems: gemsTaken }; record = !!prev; }
    store.set('daily', d);
    const st = store.get('streak', { last: 0, count: 0, max: 0 });
    if (st.last !== cur.n) {
      st.count = st.last === cur.n - 1 ? st.count + 1 : 1;
      st.last = cur.n;
      st.max = Math.max(st.max || 0, st.count);
      store.set('streak', st);
    }
  } else {
    const p = getProgress();
    const id = levelId(cur.wi, cur.li);
    const prev = p[id];
    if (!prev || stars > prev.stars || timer < prev.time) {
      p[id] = { stars: Math.max(stars, prev ? prev.stars : 0), time: Math.min(timer, prev ? prev.time : Infinity) };
      record = !!prev && timer < prev.time;
    }
    store.set('progress', p);
  }
  const s = store.get('stats', { wins: 0, falls: 0, gems: 0 });
  s.wins++; s.falls += falls; s.gems += gemsTaken;
  store.set('stats', s);
  setTimeout(() => showComplete(stars, record), 1100);
}

function burstConfetti() {
  const colors = [0xff4f8b, 0xffc93c, 0x38b6ff, 0x22b98a, 0xffffff, 0xa77bff];
  const [gx, gy] = level.goal;
  for (let i = 0; i < 70; i++) {
    const m = new THREE.Mesh(GEO.conf, new THREE.MeshBasicMaterial({ color: colors[i % colors.length], side: THREE.DoubleSide, transparent: true }));
    m.position.set(gx - ox, 0.3, gy - oz);
    const a = Math.random() * Math.PI * 2, sp = 1.5 + Math.random() * 3;
    m.userData = { vx: Math.cos(a) * sp, vy: 5 + Math.random() * 4, vz: Math.sin(a) * sp, rx: Math.random() * 10, ry: Math.random() * 10, life: 2 };
    island.add(m);
    confetti.push(m);
  }
}

// ---------------------------------------------------------------------------
// Entrada: joystick virtual (dedo/ratón) e inclinación del dispositivo
// ---------------------------------------------------------------------------
const STICK_R = 64;
let touch = null;
canvas.addEventListener('pointerdown', (e) => {
  if (state !== 'play') return;
  initAudio();
  touch = { id: e.pointerId, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 };
  try { canvas.setPointerCapture(e.pointerId); } catch { /* nada */ }
  ui.stick.style.transform = `translate(${e.clientX}px, ${e.clientY}px)`;
  ui.knob.style.transform = 'translate(0px, 0px)';
  ui.stick.classList.add('on');
  ui.hint.classList.remove('on');
});
canvas.addEventListener('pointermove', (e) => {
  if (!touch || e.pointerId !== touch.id) return;
  let dx = e.clientX - touch.x0, dy = e.clientY - touch.y0;
  const d = Math.hypot(dx, dy);
  if (d > STICK_R) { dx *= STICK_R / d; dy *= STICK_R / d; }
  touch.dx = dx; touch.dy = dy;
  ui.knob.style.transform = `translate(${dx}px, ${dy}px)`;
});
const endTouch = (e) => {
  if (!touch || (e && e.pointerId !== touch.id)) return;
  touch = null;
  ui.stick.classList.remove('on');
};
canvas.addEventListener('pointerup', endTouch);
canvas.addEventListener('pointercancel', endTouch);

// Teclado (PC)
const keys = new Set();
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'w', 'a', 's', 'd'].includes(e.key)) { keys.add(e.key); initAudio(); ui.hint.classList.remove('on'); e.preventDefault(); }
  if (e.key === 'Escape') { if (state === 'play') pause(); else if (state === 'pause') resume(); }
  if (e.key === 'r' && state === 'play') restart();
});
window.addEventListener('keyup', (e) => keys.delete(e.key));

// Inclinación del dispositivo
let motion = { beta: 0, gamma: 0, b0: 0, g0: 0, has: false };
window.addEventListener('deviceorientation', (e) => {
  if (e.beta == null) return;
  motion.beta = e.beta; motion.gamma = e.gamma; motion.has = true;
});
function calibrateMotion() { motion.b0 = motion.beta; motion.g0 = motion.gamma; }
async function enableMotion() {
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      const r = await DeviceOrientationEvent.requestPermission();
      return r === 'granted';
    }
    return 'DeviceOrientationEvent' in window;
  } catch { return false; }
}

function updateTiltTarget() {
  let tx = 0, tz = 0;
  if (touch) {
    tx = (touch.dy / STICK_R) * MAX_TILT;
    tz = -(touch.dx / STICK_R) * MAX_TILT;
  } else if (keys.size) {
    if (keys.has('ArrowUp') || keys.has('w')) tx -= MAX_TILT;
    if (keys.has('ArrowDown') || keys.has('s')) tx += MAX_TILT;
    if (keys.has('ArrowLeft') || keys.has('a')) tz += MAX_TILT;
    if (keys.has('ArrowRight') || keys.has('d')) tz -= MAX_TILT;
  } else if (settings.motion && motion.has) {
    const ang = (screen.orientation && screen.orientation.angle) || window.orientation || 0;
    const db = motion.beta - motion.b0, dg = motion.gamma - motion.g0;
    let lr = dg, fb = db;
    if (ang === 90) { lr = db; fb = -dg; } else if (ang === -90 || ang === 270) { lr = -db; fb = dg; }
    tx = clamp(fb / 18, -1, 1) * MAX_TILT;
    tz = -clamp(lr / 18, -1, 1) * MAX_TILT;
  }
  tiltTarget.x = tx; tiltTarget.z = tz;
  if ((tx || tz) && !timerOn && state === 'play' && B.spawn === 0) timerOn = true;
}

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------
const qTmp = new THREE.Quaternion();
const axTmp = new THREE.Vector3();
let last = performance.now();
let t = 0;
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  t += dt;

  if (state === 'play' || state === 'done') {
    if (state === 'play') {
      updateTiltTarget();
      if (timerOn) { timer += dt; ui.time.textContent = fmtTime(timer); ui.timePill.classList.toggle('late', timer > level.par); }
    } else { tiltTarget.x = 0; tiltTarget.z = 0; }
    const kk = Math.min(1, dt * 9);
    tilt.x += (tiltTarget.x - tilt.x) * kk;
    tilt.z += (tiltTarget.z - tilt.z) * kk;
    island.rotation.set(tilt.x, 0, tilt.z);
    let rem = dt;
    while (rem > 0) { const s = Math.min(rem, 1 / 120); physics(s); rem -= s; }
    const speed = Math.hypot(B.vx, B.vz);
    setRoll(B.falling || B.spawn || B.sinking ? 0 : speed);
    // Rodar
    if (speed > 1e-4 && !B.sinking) {
      axTmp.set(B.vz, 0, -B.vx).normalize();
      qTmp.setFromAxisAngle(axTmp, (speed * dt) / BALL_R);
      ball.quaternion.premultiply(qTmp);
    }
    ball.position.set(B.x, B.y, B.z);
  } else if (state === 'menu' || state === 'levels') {
    island.rotation.set(0, island.rotation.y + dt * 0.18, 0);
    setRoll(0);
    ball.position.set(B.x, BALL_R + Math.abs(Math.sin(t * 2.2)) * 0.25, B.z);
  }

  // Gemas, meta, nubes, confeti
  for (const g of gems) {
    if (!g.taken) {
      g.mesh.rotation.y += dt * 2;
      g.mesh.position.y = 0.5 + Math.sin(t * 3 + g.mesh.userData.phase) * 0.06;
    } else if (g.fx < 1) {
      g.fx = Math.min(1, g.fx + dt * 3);
      g.mesh.scale.setScalar(1 + g.fx * 1.2);
      g.mesh.position.y += dt * 2;
      g.mesh.material.transparent = true;
      g.mesh.material.opacity = 1 - g.fx;
      if (g.fx >= 1) g.mesh.visible = false;
    }
  }
  if (goalFx) {
    goalFx.ring.scale.setScalar(1 + Math.sin(t * 4) * 0.08);
    goalFx.ring.position.y = 0.12 + Math.sin(t * 2) * 0.04;
    goalFx.flag.rotation.y = Math.sin(t * 3) * 0.25;
  }
  for (const cl of clouds.children) {
    cl.position.x += cl.userData.speed * dt;
    if (cl.position.x > 20) cl.position.x = -20;
  }
  confetti = confetti.filter((m) => {
    const u = m.userData;
    u.life -= dt;
    u.vy -= 9 * dt;
    m.position.x += u.vx * dt; m.position.y += u.vy * dt; m.position.z += u.vz * dt;
    u.vx *= 0.98; u.vz *= 0.98;
    m.rotation.x += u.rx * dt; m.rotation.y += u.ry * dt;
    m.material.opacity = clamp(u.life, 0, 1);
    if (u.life <= 0) { island.remove(m); m.material.dispose(); return false; }
    return true;
  });

  // Cámara (entrada suave + temblor)
  camIntro = Math.min(1, camIntro + dt / 1.1);
  const e = easeOut(camIntro);
  camera.position.set(camGoal.x, camGoal.y * (1 + (1 - e) * 0.5), camGoal.z * (1 + (1 - e) * 0.35));
  if (shake > 0) {
    shake = Math.max(0, shake - dt);
    camera.position.x += (Math.random() - 0.5) * shake;
    camera.position.y += (Math.random() - 0.5) * shake;
  }
  camera.lookAt(camLook);

  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// ---------------------------------------------------------------------------
// Interfaz
// ---------------------------------------------------------------------------
const ui = {
  splash: $('splash'), menu: $('menu'), levels: $('levels'), hud: $('hud'),
  lvTag: $('lvTag'), lvName: $('lvName'), time: $('time'), timePill: $('timePill'), par: $('par'),
  gems: $('gems'), gemsPill: $('gemsPill'), stick: $('stick'), knob: $('knob'), hint: $('hint'), banner: $('banner'),
  starsTotal: $('starsTotal'), dailyN: $('dailyN'), dailySub: $('dailySub'), playSub: $('playSub'),
  worldTabs: $('worldTabs'), levelGrid: $('levelGrid'), toast: $('toast'),
};
const SCREENS = { menu: ui.menu, levels: ui.levels, hud: ui.hud };
function setScreen(name) {
  for (const [k, el] of Object.entries(SCREENS)) el.classList.toggle('open', k === name);
}
function openModal(id) {
  if (id === 'mStats') fillStats();
  if (id === 'mSettings') fillSettings();
  $(id).classList.add('open');
}
function closeModal(id) { $(id).classList.remove('open'); }
document.querySelectorAll('[data-open]').forEach((b) => b.addEventListener('click', () => { sfx.click(); openModal(b.dataset.open); }));
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
function showBanner(tag, name) {
  ui.banner.querySelector('b').textContent = tag;
  ui.banner.querySelector('span').textContent = name;
  ui.banner.classList.remove('on'); void ui.banner.offsetWidth; ui.banner.classList.add('on');
}

// ---- Menú ----
function nextLevel() {
  for (let wi = 0; wi < WORLDS.length; wi++) {
    for (let li = 0; li < WORLDS[wi].levels.length; li++) if (!isDone(wi, li)) return [wi, li];
  }
  return [WORLDS.length - 1, WORLDS[WORLDS.length - 1].levels.length - 1];
}
function showMenu() {
  state = 'menu';
  cur = null;
  ui.stick.classList.remove('on');
  // Isla de fondo: la del siguiente nivel
  const [wi, li] = nextLevel();
  buildLevel(prepare(WORLDS[wi].levels[li]), WORLDS[wi]);
  placeBallAtStart(false);
  startCamIntro();
  ui.starsTotal.textContent = `${totalStars()}/${MAX_STARS}`;
  ui.playSub.textContent = `Nivel ${wi + 1}-${li + 1} · ${WORLDS[wi].levels[li].name}`;
  const n = dailyNumber();
  ui.dailyN.textContent = '#' + n;
  const d = store.get('daily', {})[n];
  ui.dailySub.textContent = d ? `✓ Tu tiempo: ${fmtTime(d.time)}` : 'Un laberinto nuevo cada día';
  const st = store.get('streak', { last: 0, count: 0 });
  const alive = st.last === n || st.last === n - 1;
  $('streak').textContent = alive && st.count ? `🔥 ${st.count}` : '';
  setScreen('menu');
}

$('playBtn').addEventListener('click', () => { sfx.click(); showLevels(nextLevel()[0]); });
$('dailyBtn').addEventListener('click', () => { sfx.click(); startDaily(); });

// ---- Selector de niveles ----
let shownWorld = 0;
function showLevels(wi = shownWorld) {
  state = 'levels';
  shownWorld = wi;
  ui.worldTabs.innerHTML = '';
  WORLDS.forEach((w, i) => {
    const b = document.createElement('button');
    const locked = !isUnlocked(i, 0);
    b.className = 'tab' + (i === wi ? ' active' : '') + (locked ? ' locked' : '');
    b.innerHTML = `<span>${locked ? '🔒' : w.emoji}</span>${w.name}`;
    b.addEventListener('click', () => { sfx.click(); showLevels(i); });
    ui.worldTabs.appendChild(b);
  });
  const w = WORLDS[wi];
  const p = getProgress();
  ui.levelGrid.innerHTML = '';
  w.levels.forEach((lv, li) => {
    const b = document.createElement('button');
    const unlocked = isUnlocked(wi, li);
    const pr = p[levelId(wi, li)];
    b.className = 'lvl' + (unlocked ? '' : ' locked') + (pr ? ' done' : '');
    const stars = [0, 1, 2].map((k) => `<i class="${pr && pr.stars > k ? 'on' : ''}">★</i>`).join('');
    b.innerHTML = unlocked
      ? `<b>${wi + 1}-${li + 1}</b><span class="nm">${lv.name}</span><span class="st">${stars}</span>`
      : `<b>🔒</b><span class="nm">${lv.name}</span>`;
    b.disabled = !unlocked;
    b.addEventListener('click', () => { sfx.click(); startLevel(wi, li); });
    ui.levelGrid.appendChild(b);
  });
  document.documentElement.style.setProperty('--sky1', w.sky[0]);
  document.documentElement.style.setProperty('--sky2', w.sky[1]);
  setScreen('levels');
}
$('levelsBack').addEventListener('click', () => { sfx.click(); showMenu(); });

// ---- Pausa ----
function pause() {
  if (state !== 'play') return;
  state = 'pause';
  touch = null;
  ui.stick.classList.remove('on');
  setRoll(0);
  openModal('mPause');
}
function resume() {
  if (state !== 'pause') return;
  closeModal('mPause');
  state = 'play';
  calibrateMotion();
}
function restart() {
  closeModal('mPause'); closeModal('mDone');
  if (cur.daily) startDaily(); else startLevel(cur.wi, cur.li);
}
$('pauseBtn').addEventListener('click', pause);
$('resumeBtn').addEventListener('click', resume);
$('restartBtn').addEventListener('click', restart);
$('quitBtn').addEventListener('click', () => { closeModal('mPause'); cur && !cur.daily ? showLevels(cur.wi) : showMenu(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) pause(); });

// ---- Nivel completado ----
let shareText = '';
function showComplete(stars, record) {
  const m = $('mDone');
  $('doneTitle').textContent = cur.daily ? '¡Isla del día superada!' : ['', '¡Superado!', '¡Muy bien!', '¡Perfecto!'][stars];
  $('doneTime').textContent = fmtTime(timer);
  $('donePar').textContent = timer <= level.par ? '✓ Dentro del objetivo' : `Objetivo: ${fmtTime(level.par)}`;
  $('doneGems').textContent = `${gemsTaken}/3`;
  $('doneFalls').textContent = falls;
  $('doneRecord').hidden = !record;
  const starsEl = [...$('doneStars').children];
  starsEl.forEach((el, i) => {
    el.classList.remove('show', 'on'); void el.offsetWidth;
    setTimeout(() => { el.classList.add('show'); if (i < stars) { el.classList.add('on'); sfx.star(i); } }, 250 + i * 230);
  });
  const nextBtn = $('nextBtn');
  const shareBtn = $('shareBtn');
  if (cur.daily) {
    nextBtn.hidden = true; shareBtn.hidden = false;
    shareText = `🏝️ Isla Rodante #${cur.n}\n⏱️ ${fmtTime(timer)} · 💎 ${gemsTaken}/3 · ${'⭐'.repeat(stars)}\n¿Me ganas? ${location.origin}${location.pathname}`;
  } else {
    const w = WORLDS[cur.wi];
    const hasNext = cur.li < w.levels.length - 1 || cur.wi < WORLDS.length - 1;
    nextBtn.hidden = !hasNext; shareBtn.hidden = hasNext;
    shareText = `🏝️ ¡He superado el nivel ${cur.wi + 1}-${cur.li + 1} de Isla Rodante con ${'⭐'.repeat(stars)}!\n${location.origin}${location.pathname}`;
    if (!hasNext) $('doneTitle').textContent = '¡Has completado el juego! 🏆';
  }
  openModal('mDone');
}
$('nextBtn').addEventListener('click', () => {
  closeModal('mDone');
  let { wi, li } = cur;
  li++;
  if (li >= WORLDS[wi].levels.length) { wi++; li = 0; }
  startLevel(wi, li);
});
$('retryBtn').addEventListener('click', restart);
$('doneMenuBtn').addEventListener('click', () => { closeModal('mDone'); cur && !cur.daily ? showLevels(cur.wi) : showMenu(); });
$('shareBtn').addEventListener('click', async () => {
  try { if (navigator.share) { await navigator.share({ text: shareText }); return; } }
  catch (e) { if (e && e.name === 'AbortError') return; }
  try { await navigator.clipboard.writeText(shareText); toast('¡Copiado! Pégalo donde quieras'); }
  catch { toast('No se pudo compartir'); }
});

// ---- Estadísticas ----
function fillStats() {
  const p = getProgress();
  const s = store.get('stats', { wins: 0, falls: 0, gems: 0 });
  const st = store.get('streak', { last: 0, count: 0, max: 0 });
  const n = dailyNumber();
  $('sLevels').textContent = `${Object.keys(p).length}/${WORLDS.reduce((a, w) => a + w.levels.length, 0)}`;
  $('sStars').textContent = `${totalStars()}/${MAX_STARS}`;
  $('sGems').textContent = s.gems;
  $('sFalls').textContent = s.falls;
  $('sStreak').textContent = st.last === n || st.last === n - 1 ? st.count : 0;
  $('sMax').textContent = st.max || 0;
  const box = $('sWorlds');
  box.innerHTML = '';
  WORLDS.forEach((w, wi) => {
    const got = w.levels.reduce((a, _, li) => a + ((p[levelId(wi, li)] || {}).stars || 0), 0);
    const max = w.levels.length * 3;
    const row = document.createElement('div');
    row.className = 'wrow';
    row.innerHTML = `<span>${w.emoji} ${w.name}</span><div class="bar"><i style="width:${(got / max) * 100}%"></i></div><b>${got}/${max} ★</b>`;
    box.appendChild(row);
  });
}

// ---- Ajustes ----
function fillSettings() {
  $('optSound').checked = settings.sound;
  $('optVibe').checked = settings.vibe;
  $('optMotion').checked = settings.motion;
}
$('optSound').addEventListener('change', (e) => { settings.sound = e.target.checked; saveSettings(); initAudio(); sfx.click(); });
$('optVibe').addEventListener('change', (e) => { settings.vibe = e.target.checked; saveSettings(); vibrate(30); });
$('optMotion').addEventListener('change', async (e) => {
  if (e.target.checked) {
    const ok = await enableMotion();
    if (!ok) { e.target.checked = false; toast('Tu dispositivo no permite usar la inclinación'); return; }
    toast('Inclina el dispositivo para mover la isla');
  }
  settings.motion = e.target.checked;
  saveSettings();
});
$('resetBtn').addEventListener('click', () => {
  if (!confirm('¿Borrar tu progreso, estrellas y estadísticas? No se puede deshacer.')) return;
  for (const k of ['progress', 'daily', 'streak', 'stats']) { try { localStorage.removeItem('isla.' + k); } catch { /* nada */ } }
  closeModal('mSettings');
  showMenu();
  toast('Progreso borrado');
});

window.addEventListener('resize', fitCamera);
window.addEventListener('orientationchange', () => setTimeout(fitCamera, 250));

// ---------------------------------------------------------------------------
// Arranque
// ---------------------------------------------------------------------------
showMenu();
fitCamera();
requestAnimationFrame(loop);
Promise.race([document.fonts ? document.fonts.load('700 20px Fredoka') : null, new Promise((r) => setTimeout(r, 1500))])
  .catch(() => {})
  .then(() => setTimeout(() => {
    ui.splash.classList.add('done');
    if (!store.get('seenHelp', false)) { store.set('seenHelp', true); setTimeout(() => openModal('mHelp'), 500); }
  }, 300));

// Gancho para pruebas automáticas
window.__isla = {
  get state() { return state; }, get B() { return B; }, get level() { return level; }, get timer() { return timer; },
  get gemsTaken() { return gemsTaken; }, startLevel, startDaily, setTilt: (x, z) => { touch = { dx: (-z / MAX_TILT) * STICK_R, dy: (x / MAX_TILT) * STICK_R }; }, release: () => { touch = null; },
};
