// Service worker: permite jugar sin conexión (red primero, caché de respaldo).
const CACHE = 'turbo-slot-v16';
const FILES = ['./', 'index.html', 'styles.css', 'src/main.js', 'src/tracks.js', 'src/physics.js', 'src/ai.js', 'src/telemetry.js', 'src/editor.js', 'src/online.js',
  'vendor/jsm/loaders/RGBELoader.js', 'vendor/jsm/postprocessing/EffectComposer.js', 'vendor/jsm/postprocessing/Pass.js', 'vendor/jsm/postprocessing/MaskPass.js',
  'vendor/jsm/postprocessing/RenderPass.js', 'vendor/jsm/postprocessing/ShaderPass.js', 'vendor/jsm/postprocessing/UnrealBloomPass.js', 'vendor/jsm/postprocessing/OutputPass.js',
  'vendor/jsm/shaders/CopyShader.js', 'vendor/jsm/shaders/OutputShader.js', 'vendor/jsm/shaders/LuminosityHighPassShader.js',
  'assets/hdri/artist_workshop_512.hdr', 'assets/hdri/neon_photostudio_512.hdr', 'assets/models/car_hi.glb', 'assets/models/car_lo.glb', 'assets/audio/slot_loop.wav', 'vendor/jsm/loaders/GLTFLoader.js', 'vendor/jsm/utils/BufferGeometryUtils.js', 'vendor/three.module.min.js',
  'manifest.webmanifest', 'fonts/barlow-500.woff2', 'fonts/barlow-600.woff2', 'fonts/barlow-condensed-600.woff2', 'fonts/barlow-condensed-700.woff2', 'fonts/barlow-condensed-700i.woff2', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
self.addEventListener('install', (e) => { e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(e.request).then((res) => { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); return res; })
    .catch(() => caches.match(e.request, { ignoreSearch: true })));
});
