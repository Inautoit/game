// Service worker mínimo: el juego funciona sin conexión una vez cargado.
// Cambia CACHE al desplegar una versión nueva para invalidar lo antiguo.
const CACHE = 'urus-traffic-v3';

const PRECACHE = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './assets/urus.glb',
  './assets/icon.svg',
  './src/main.js',
  './src/game.js',
  './src/player.js',
  './src/traffic.js',
  './src/road.js',
  './src/postfx.js',
  './src/account.js',
  './src/net.js',
  './src/remote.js',
  './src/vehicles.js',
  './src/input.js',
  './src/audio.js',
  './src/ui.js',
  './src/config.js',
  './vendor/three.module.js',
  './vendor/addons/loaders/GLTFLoader.js',
  './vendor/addons/libs/meshopt_decoder.module.js',
  './vendor/addons/utils/BufferGeometryUtils.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  // El HTML va primero a la red para que un despliegue nuevo se vea al momento.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then((r) => r || caches.match('./index.html'))),
    );
    return;
  }

  // El resto: caché primero (el modelo pesa 3 MB, no tiene sentido repetirlo).
  e.respondWith(
    caches.match(req).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy));
      }
      return res;
    })),
  );
});
