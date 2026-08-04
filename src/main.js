import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Input } from './input.js';
import { Car } from './car.js';
import { buildWorld } from './world.js';

// ---------- Renderer ----------
const canvas = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

// ---------- Escena y cielo ----------
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x8fc7ff);
scene.fog = new THREE.Fog(0x8fc7ff, 120, 340);

// ---------- Cámara ----------
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
camera.position.set(0, 8, -12);

// ---------- Luces ----------
scene.add(new THREE.HemisphereLight(0xbfe3ff, 0x3a5a34, 0.9));
const sun = new THREE.DirectionalLight(0xfff2d6, 1.5);
sun.position.set(60, 90, 40);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.near = 10;
sun.shadow.camera.far = 260;
const S = 90;
sun.shadow.camera.left = -S;
sun.shadow.camera.right = S;
sun.shadow.camera.top = S;
sun.shadow.camera.bottom = -S;
scene.add(sun);
scene.add(sun.target);

// ---------- Mundo y coche ----------
buildWorld(scene);
const car = new Car();
scene.add(car.group);

const input = new Input();

// ---------- Cargar modelo del coche (opcional) ----------
// Si existe assets/car.glb se usa; si no, se queda el placeholder.
const loader = new GLTFLoader();
loader.load(
  './assets/car.glb',
  (gltf) => {
    car.setModel(gltf.scene);
    console.log('✅ Modelo de coche cargado desde assets/car.glb');
  },
  undefined,
  () => console.log('ℹ️ Sin assets/car.glb — usando coche placeholder.')
);

// ---------- Cámara que sigue al coche (tercera persona) ----------
const camTarget = new THREE.Vector3();
const camPos = new THREE.Vector3();
const followOffset = new THREE.Vector3(0, 5.2, -9.5); // detrás y arriba

function updateCamera(dt) {
  // Posición deseada: detrás del coche según su orientación
  const off = followOffset.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), car.heading);
  camPos.copy(car.position).add(off);

  // Suavizado (lerp dependiente de dt)
  const k = 1 - Math.pow(0.001, dt);
  camera.position.lerp(camPos, k);

  camTarget.copy(car.position).add(new THREE.Vector3(0, 1.4, 0));
  camera.lookAt(camTarget);

  // La sombra del sol sigue al coche para mantener resolución
  sun.position.set(car.position.x + 60, 90, car.position.z + 40);
  sun.target.position.copy(car.position);
}

// ---------- Bucle ----------
const speedEl = document.getElementById('speed');
const loadingEl = document.getElementById('loading');
loadingEl.classList.add('hidden');

const clock = new THREE.Clock();
function tick() {
  const dt = Math.min(clock.getDelta(), 0.05); // clamp para evitar saltos
  car.update(input, dt);
  updateCamera(dt);
  speedEl.textContent = car.speedKmh;
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
