import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Game, STATE } from './game.js';
import { PostFX } from './postfx.js';
import { DRAW_DISTANCE } from './config.js';

// --------------------------------------------------------------- Renderer
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: window.devicePixelRatio < 2,
  powerPreference: 'high-performance',
  stencil: false,
});
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

let pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
renderer.setPixelRatio(pixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.35, DRAW_DISTANCE);

// Post-proceso de velocidad. Si el dispositivo no soporta render targets
// half-float, se queda desactivado y el juego pinta directo a pantalla.
const postfx = new PostFX(renderer);

// ------------------------------------------------------------ Composición
const input = new Input();
const sound = new Sound();
const player = new Player();
scene.add(player.group);

const ui = new UI({
  onPlay: () => { sound.start(); sound.resume(); game.start(); },
  onPause: () => game.pause(true),
  onResume: () => game.pause(false),
  onQuit: () => game.toMenu(),
  onChange: (key, value) => onSettingChange(key, value),
});
ui.adopt({ steer: input.steerMode, autoGas: input.autoGas, sound: sound.enabled });

const game = new Game({ renderer, scene, camera, player, input, sound, ui });

function onSettingChange(key, value) {
  switch (key) {
    case 'mode': game.setMode(value); ui.refreshBest(game.best); break;
    case 'time': game.setTime(value); break;
    case 'paint': player.setPaint(ui.paintHex); break;
    case 'steer': input.setSteerMode(value); break;
    case 'autoGas': input.setAutoGas(value); break;
    case 'sound': sound.setEnabled(value); break;
    default: break;
  }
}

// --------------------------------------------------------- Carga del coche
const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
loader.load(
  './assets/urus.glb',
  (gltf) => {
    player.setModel(gltf.scene);
    player.setPaint(ui.paintHex);
    game.applyTime(game.time);
    ui.hideLoading();
    game.toMenu();
    start();
  },
  (e) => {
    if (e.lengthComputable) {
      ui.setLoading(`Cargando el Urus… ${Math.round((e.loaded / e.total) * 100)}%`);
    }
  },
  (err) => {
    console.error('No se pudo cargar assets/urus.glb', err);
    ui.setLoading('No se pudo cargar el coche. Recarga la página.');
  },
);

// ------------------------------------------------------------------ Bucle
const clock = new THREE.Clock();
let running = false;

// Calidad adaptativa. Vamos bajando por esta escalera si el móvil no llega a
// los 50 fps, y subiendo si le sobra margen. Primero se recorta resolución;
// los efectos de velocidad son lo último que se sacrifica.
const LEVELS = [
  { scale: 1.0, fx: true },
  { scale: 0.85, fx: true },
  { scale: 0.7, fx: true },
  { scale: 0.6, fx: true },
  { scale: 0.6, fx: false },
  { scale: 0.5, fx: false },
];
let level = 0;
let frames = 0;
let acc = 0;

function applyLevel() {
  const l = LEVELS[level];
  renderer.setPixelRatio(pixelRatio * l.scale);
  postfx.enabled = l.fx;
  postfx.setSize();
}

function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);

  game.update(dt);

  if (postfx.active && game.fx.active) postfx.render(scene, camera, game.fx, dt);
  else renderer.render(scene, camera);

  acc += dt;
  frames++;
  if (acc >= 2) {
    const fps = frames / acc;
    if (fps < 46 && level < LEVELS.length - 1) { level++; applyLevel(); }
    else if (fps > 58 && level > 0) { level--; applyLevel(); }
    acc = 0;
    frames = 0;
  }
}

function start() {
  if (running) return;
  running = true;
  clock.getDelta();
  tick();
}

// ---------------------------------------------------------------- Eventos
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
  applyLevel();
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.state === STATE.PLAYING) game.pause(true);
});

// El audio necesita un gesto previo del usuario en móvil.
const unlock = () => { if (sound.enabled) { sound.start(); sound.resume(); } };
window.addEventListener('pointerdown', unlock, { once: true });
window.addEventListener('keydown', unlock, { once: true });

// Evitar el zoom por doble toque en iOS
document.addEventListener('dblclick', (e) => e.preventDefault(), { passive: false });
document.addEventListener('gesturestart', (e) => e.preventDefault());

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => { /* opcional */ });
  });
}
