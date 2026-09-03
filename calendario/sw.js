// Service worker: hace la web instalable y consultable sin conexión.
//
// El calendario ya vive en localStorage, así que basta con cachear el
// "armazón" (HTML, CSS, JS, iconos). Las llamadas a /api nunca se
// cachean: o hay red y traen lo último, o se usa la copia local.

var VERSION = 'cal-v1';
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
  './src/app.js',
  './assets/escudo.svg',
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

  // Navegación: intentar red y, si no hay, servir el index cacheado.
  if (req.mode === 'navigate') {
    ev.respondWith(
      fetch(req).catch(function () {
        return caches.match('./index.html').then(function (r) {
          return r || caches.match('./');
        });
      })
    );
    return;
  }

  ev.respondWith(
    caches.match(req).then(function (cacheado) {
      if (cacheado) return cacheado;
      return fetch(req).then(function (res) {
        if (res && res.ok && res.type === 'basic') {
          var copia = res.clone();
          caches.open(VERSION).then(function (c) { c.put(req, copia); });
        }
        return res;
      });
    })
  );
});
