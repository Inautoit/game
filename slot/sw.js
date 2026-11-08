// Service worker: permite jugar sin conexión (red primero, caché de respaldo).
const CACHE = 'turbo-slot-v2';
const FILES = ['./', 'index.html', 'styles.css', 'src/main.js', 'src/tracks.js', 'src/physics.js', 'src/ai.js', 'vendor/three.module.min.js',
  'manifest.webmanifest', 'fonts/fredoka.woff2', 'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];
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
