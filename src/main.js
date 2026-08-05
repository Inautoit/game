import * as THREE from 'three';
import { Orbit } from './orbit.js';
import { CarModel } from './carModel.js';
import { buildUI } from './ui.js';
import { buildEnvironment, makeBackground, groundColor } from './env.js';
import {
  DEFAULTS, PRESETS, sanitize, encodeConfig, decodeConfig,
  MODELS, FINISHES, WHEEL_STYLES, WINGS, HOODS, PAINT_SWATCHES, WHEEL_SWATCHES, clamp,
} from './config.js';

// ---------- Renderer ----------
const canvas = document.getElementById('scene');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

// ---------- Escena ----------
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, window.innerWidth / window.innerHeight, 0.1, 200);

const envMap = buildEnvironment(renderer);
scene.environment = envMap;

// ---------- Luces ----------
scene.add(new THREE.HemisphereLight(0xdfeaff, 0x20242c, 0.5));
const key = new THREE.DirectionalLight(0xffffff, 1.6);
key.position.set(6, 10, 6);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
const b = 6;
key.shadow.camera.left = -b; key.shadow.camera.right = b;
key.shadow.camera.top = b; key.shadow.camera.bottom = -b;
key.shadow.bias = -0.0002;
scene.add(key);
const fill = new THREE.DirectionalLight(0x9fb8ff, 0.4);
fill.position.set(-6, 4, -5);
scene.add(fill);

// ---------- Plataforma / suelo ----------
const platform = new THREE.Mesh(
  new THREE.CylinderGeometry(7, 7, 0.3, 64),
  new THREE.MeshStandardMaterial({ color: groundColor(DEFAULTS.bg), metalness: 0.4, roughness: 0.5, envMap })
);
platform.position.y = -0.15;
platform.receiveShadow = true;
scene.add(platform);

// Anillo decorativo del borde de la plataforma.
const ring = new THREE.Mesh(
  new THREE.TorusGeometry(7, 0.05, 12, 80),
  new THREE.MeshStandardMaterial({ color: 0x47e0c0, metalness: 0.6, roughness: 0.3, emissive: 0x0a2b26 })
);
ring.rotation.x = Math.PI / 2;
ring.position.y = 0.0;
scene.add(ring);

// ---------- Neón inferior ----------
const glowTex = makeGlowTexture();
const glow = new THREE.Mesh(
  new THREE.PlaneGeometry(5, 3),
  new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
);
glow.rotation.x = -Math.PI / 2;
glow.position.y = 0.02;
glow.visible = false;
scene.add(glow);
const glowLight = new THREE.PointLight(0x22d3ee, 0, 6, 2);
glowLight.position.set(0, 0.25, 0);
scene.add(glowLight);

// ---------- Coche ----------
const car = new CarModel(envMap);
scene.add(car.root);

// ---------- Cámara / órbita ----------
const orbit = new Orbit(camera, canvas, new THREE.Vector3(0, 0.55, 0));

// ---------- Configuración viva ----------
const cfg = loadInitialConfig();

function loadInitialConfig() {
  const hash = location.hash.slice(1);
  if (hash) { const c = decodeConfig(hash); if (c) return c; }
  try {
    const saved = localStorage.getItem('tuner-cfg');
    if (saved) { const c = decodeConfig(saved); if (c) return c; }
  } catch {}
  return { ...DEFAULTS };
}

// ---------- Aplicar configuración a la escena ----------
let saveTimer = 0;
function apply(key) {
  car.setConfig(cfg);
  orbit.autoRotate = cfg.autoRotate;

  // Fondo y suelo
  if (!key || key === 'bg') {
    scene.background = makeBackground(cfg.bg);
    platform.material.color.set(groundColor(cfg.bg));
  }

  // Neón
  const on = cfg.underglow;
  glow.visible = on;
  glowLight.intensity = on ? 6 : 0;
  const gc = new THREE.Color(cfg.underglowColor);
  glow.material.color.set(gc);
  glowLight.color.set(gc);

  // Guardar (con pequeño retardo)
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem('tuner-cfg', encodeConfig(cfg)); } catch {}
  }, 400);
}

// ---------- Acciones de la interfaz ----------
function onAction(name) {
  if (name.startsWith('preset:')) {
    const p = PRESETS.find((x) => x.id === name.split(':')[1]);
    if (p) { Object.assign(cfg, sanitize({ ...DEFAULTS, ...p.cfg })); apply(); ui.render(); toast('Preset: ' + p.name); }
    return;
  }
  if (name === 'random') { randomize(); apply(); ui.render(); toast('Configuración aleatoria'); return; }
  if (name === 'reset') { Object.assign(cfg, { ...DEFAULTS }); apply(); ui.render(); toast('Restablecido'); return; }
  if (name === 'screenshot') { screenshot(); return; }
  if (name === 'share') { share(); return; }
}

function randomize() {
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  cfg.model = pick(MODELS).id;
  cfg.finish = pick(FINISHES).id;
  cfg.wheelStyle = pick(WHEEL_STYLES).id;
  cfg.wing = pick(WINGS).id;
  cfg.hood = pick(HOODS).id;
  cfg.paint = pick(PAINT_SWATCHES);
  cfg.wheelColor = pick(WHEEL_SWATCHES);
  cfg.wheelSize = 16 + Math.floor(Math.random() * 5);
  cfg.rideHeight = clamp(0.18 + Math.random() * 0.3, 0.16, 0.58);
  cfg.camber = Math.round(Math.random() * 12);
  cfg.poke = Math.round(Math.random() * 10) / 100;
  cfg.splitter = Math.random() > 0.4;
  cfg.skirts = Math.random() > 0.4;
  cfg.widebody = Math.random() > 0.5;
  cfg.tint = Math.round(Math.random() * 100) / 100;
  cfg.underglow = Math.random() > 0.6;
  cfg.underglowColor = pick(PAINT_SWATCHES);
}

function screenshot() {
  renderer.render(scene, camera);
  canvas.toBlob((blob) => {
    if (!blob) return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mi-coche-tuning.png';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, 'image/png');
  toast('Imagen descargada');
}

async function share() {
  const code = encodeConfig(cfg);
  location.hash = code;
  const url = location.href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Enlace copiado al portapapeles');
  } catch {
    toast('Enlace en la barra de direcciones');
  }
}

// ---------- Toast ----------
let toastTimer = 0;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 1800);
}

// ---------- Panel plegable (móvil) ----------
document.getElementById('panel-toggle').addEventListener('click', () => {
  document.body.classList.toggle('panel-open');
});

// ---------- Arrancar ----------
const ui = buildUI(cfg, { onApply: apply, onAction });
apply();
document.getElementById('loading').classList.add('hidden');

// ---------- Bucle ----------
const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05);
  orbit.update(dt);
  // Pulso suave del neón
  if (glow.visible) {
    const p = 0.85 + Math.sin(clock.elapsedTime * 3) * 0.15;
    glowLight.intensity = 6 * p;
  }
  ring.material.emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 1.5) * 0.2;
  renderer.render(scene, camera);
  requestAnimationFrame(tick);
}
tick();

// ---------- Resize ----------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------- Textura radial para el neón ----------
function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.4, 'rgba(255,255,255,0.4)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return tex;
}
