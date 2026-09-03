// Service worker: hace la web instalable y consultable sin conexión.
//
// Estrategia: RED PRIMERO, caché solo como respaldo.
//
// Antes era al revés (caché primero) y salió mal: al publicar una versión
// nueva, el navegador seguía usando el JavaScript viejo guardado, que ya
// no cuadraba con el HTML nuevo, y la página se quedaba en blanco. Con
// red primero, quien tenga cobertura ve siempre lo último, y quien no la
// tenga sigue viendo el calendario guardado.
//
// Las llamadas a /api nunca pasan por aquí.

var VERSION = 'cal-v4';
var SHELL = [
  './',
  './index.html',
  './styles.css',
  './manifest.webmanifest',
  './src/config.js',
  './src/seed.js',
  './src/sha256.js',
  './src/api.js',
  './src/store.js',
  './src/auth.js',
  './src/fotos.js',
  './src/app.js',
  './assets/escudo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
];

self.addEventListener('install', function (ev) {
  ev.waitUntil(
    caches.open(VERSION)
      // addAll falla entero si un solo archivo falla: mejor uno a uno.
      .then(function (cache) {
        return Promise.all(SHELL.map(function (url) {
          return cache.add(new Request(url, { cache: 'reload' })).catch(function () {});
        }));
      })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(
    caches.keys().then(function (claves) {
      return Promise.all(claves.map(function (k) {
        return k === VERSION ? null : caches.delete(k);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;

  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.indexOf('/api/') !== -1) return;

  ev.respondWith(
    fetch(req).then(function (res) {
      // Solo se guarda lo que ha llegado bien, para no cachear un error.
      if (res && res.ok && res.type === 'basic') {
        var copia = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copia); });
      }
      return res;
    }).catch(function () {
      return caches.match(req).then(function (cacheado) {
        if (cacheado) return cacheado;
        // Sin conexión y sin copia: si es una navegación, el index sirve.
        if (req.mode === 'navigate') {
          return caches.match('./index.html').then(function (r) {
            return r || caches.match('./');
          });
        }
        return Response.error();
      });
    })
  );
});
