import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';

import { Input } from './input.js';
import { Sound } from './audio.js';
import { UI } from './ui.js';
import { Player } from './player.js';
import { Game, STATE } from './game.js';
import { PostFX } from './postfx.js';
import { Account, defaultName } from './account.js';
import { Net, makeRoomCode } from './net.js';
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

const account = new Account();
const net = new Net();
let room = null;          // { code, creating, players, hostId, mode, time }

const ui = new UI({
  onPlay: () => onPlayPressed(),
  onPause: () => game.pause(true),
  onResume: () => game.pause(false),
  onQuit: () => quitToMenu(),
  onChange: (key, value) => onSettingChange(key, value),

  currentName: () => account.name,
  onName: (name) => { account.rename(name).then(() => ui.setName(account.name)); },
  onRanking: (mode) => showRanking(mode),
  onDuel: () => ui.showRooms(),
  onCreateRoom: () => openRoom(makeRoomCode(), true),
  onJoinRoom: (code) => openRoom(code, false),
  onLaunch: () => net.send({ t: 'start' }),
  onLeaveRoom: () => leaveRoom(),
  onLobbySetup: (key, value) => net.send({ t: 'setup', mode: room?.mode, time: room?.time, [key]: value }),
});
ui.adopt({ steer: input.steerMode, autoGas: input.autoGas, sound: sound.enabled });
ui.setName(account.name);

const game = new Game({ renderer, scene, camera, player, input, sound, ui });

// ------------------------------------------------------------ partidas
function onPlayPressed() {
  // Tras un duelo, "Otra vez" devuelve al vestíbulo en vez de empezar
  // una partida en solitario.
  if (game.mp || room) {
    if (net.isHost) net.send({ t: 'again' });
    else ui.toast('Esperando al anfitrión…', 'pass');
    return;
  }
  startSolo();
}

async function startSolo() {
  sound.start();
  sound.resume();
  await account.ensure(account.name).catch(() => null);
  ui.setName(account.name);
  account.startRun();                 // sin await: si tarda, no frena el juego
  game.start();
}

function quitToMenu() {
  if (game.mp) leaveRoom();
  else game.toMenu();
}

// Al acabar una partida en solitario, mandamos la marca al ranking.
game.onRunFinished = async (stats) => {
  const res = await account.submit(stats);
  if (res?.rank) ui.showOver({ ...stats.screen, rank: res.rank });
};

async function showRanking(mode) {
  await account.ensure(account.name).catch(() => null);
  const data = await account.leaderboard(mode);
  ui.showRanking(data, mode, account.id);
}

// --------------------------------------------------------------- salas
async function openRoom(code, creating) {
  await account.ensure(account.name).catch(() => null);
  ui.setName(account.name);
  ui.roomsError('');
  room = { code, creating, players: [], hostId: null, mode: ui.settings.mode, time: ui.settings.time };
  net.connect(code, {
    id: account.id || 'local-' + Math.random().toString(36).slice(2),
    name: account.name,
    paint: ui.settings.paint,
  });
}

function leaveRoom() {
  net.close();
  room = null;
  game.leaveMultiplayer();
  game.toMenu();
}

net.on('welcome', (msg) => {
  if (!room) return;
  room.hostId = msg.host;
  room.mode = msg.mode;
  room.time = msg.time;

  // Colisión de código al crear: hemos caído en la sala de otro.
  if (room.creating && msg.host !== msg.you) {
    net.close();
    return openRoom(makeRoomCode(), true);
  }
  // Al entrar con código: si la sala estaba vacía, es que no existía.
  if (!room.creating && msg.host === msg.you) {
    net.close();
    room = null;
    return ui.roomsError('Esa sala no existe o ya ha terminado');
  }
  renderLobby();
});

net.on('players', (msg) => {
  if (!room) return;
  room.players = msg.players;
  room.hostId = msg.host;
  if (game.mp) game.mp.players = msg.players;
  renderLobby();
});

net.on('setup', (msg) => {
  if (!room) return;
  room.mode = msg.mode;
  room.time = msg.time;
  renderLobby();
});

net.on('go', (msg) => {
  if (!room) return;
  const offset = msg.now - Date.now();          // reloj del servidor - el mío
  ui.closeOverlays();
  game.startMultiplayer({
    net,
    players: room.players,
    mode: msg.mode,
    time: msg.time,
    at: msg.at - offset,
    youId: net.you,
    isHost: net.you === msg.host,
  });
});

net.on('s', (msg) => game.onRemoteState(msg));
net.on('tr', (msg) => game.applyRemoteTraffic(msg));
net.on('out', (msg) => game.onRemoteOut(msg));
net.on('end', (msg) => game.onDuelEnd(msg.results));
net.on('lobby', () => {
  if (!room) return;
  game.backToLobby();
  renderLobby();
});
net.on('err', (msg) => {
  if (game.mp) ui.toast(msg.msg, 'pass');
  else ui.roomsError(msg.msg);
});
net.on('closed', () => {
  if (game.mp) ui.toast('Se ha perdido la conexión', 'big');
});
net.on('failed', () => ui.roomsError('No se ha podido conectar con la sala'));

function renderLobby() {
  if (!room) return;
  ui.showLobby({
    code: room.code,
    players: room.players,
    hostId: room.hostId,
    youId: net.you,
    isHost: net.isHost,
    mode: room.mode,
    time: room.time,
  });
}

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
