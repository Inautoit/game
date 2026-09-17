// Avisos en el móvil cuando cambia el calendario.
//
// Usa Web Push: el navegador se suscribe a su propio servicio de
// notificaciones y nos devuelve una dirección a la que escribirle. Esa
// dirección se guarda en el servidor y es lo único que hace falta para
// avisar, aunque la app esté cerrada.
//
// En iPhone solo funciona con la web instalada en la pantalla de inicio
// (iOS 16.4 o superior). En Android va de las dos formas.
(function () {
  'use strict';

  var cfg = window.CAL_CONFIG;
  var PEDIDO_KEY = cfg.storageKey + ':avisos-pedidos';

  var publica = null;
  var activoEnServidor = false;
  var consultado = false;

  function base() { return cfg.apiBase.replace(/\/$/, ''); }

  function b64urlABytes(s) {
    var base = String(s).replace(/-/g, '+').replace(/_/g, '/');
    var crudo = atob(base + '='.repeat((4 - (base.length % 4)) % 4));
    var out = new Uint8Array(crudo.length);
    for (var i = 0; i < crudo.length; i++) out[i] = crudo.charCodeAt(i);
    return out;
  }

  function bytesAB64url(buf) {
    var bytes = new Uint8Array(buf);
    var s = '';
    for (var i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function registro() {
    if (!('serviceWorker' in navigator)) return Promise.resolve(null);
    return navigator.serviceWorker.ready.catch(function () { return null; });
  }

  function comoJson(sub) {
    return {
      endpoint: sub.endpoint,
      keys: {
        p256dh: bytesAB64url(sub.getKey('p256dh')),
        auth: bytesAB64url(sub.getKey('auth')),
      },
    };
  }

  var Avisos = {
    // ¿Puede este navegador recibir avisos?
    soportado: function () {
      // Se mira que las piezas existan de verdad, no solo que el nombre
      // esté declarado: hay navegadores que lo dejan a medias.
      return 'serviceWorker' in navigator &&
             typeof window.PushManager === 'function' &&
             typeof window.Notification === 'function' &&
             typeof Notification.requestPermission === 'function' &&
             window.isSecureContext;
    },

    // En iPhone hace falta tener la web instalada.
    esIOS: function () {
      return /iP(hone|ad|od)/.test(navigator.userAgent) ||
             (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    },

    instalada: function () {
      return window.matchMedia('(display-mode: standalone)').matches ||
             window.navigator.standalone === true;
    },

    permiso: function () {
      return ('Notification' in window) ? Notification.permission : 'denied';
    },

    // El servidor dice si los avisos están configurados y con qué clave.
    consultar: function () {
      if (consultado) return Promise.resolve(activoEnServidor);
      return fetch(base() + '/push', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (r) {
        consultado = true;
        activoEnServidor = !!r.activo;
        publica = r.publica || null;
        return activoEnServidor;
      }).catch(function () {
        consultado = true;
        activoEnServidor = false;
        return false;
      });
    },

    disponible: function () { return activoEnServidor && !!publica; },

    // ¿Está este dispositivo suscrito ahora mismo?
    estado: function () {
      if (!Avisos.soportado()) return Promise.resolve(false);
      return registro().then(function (reg) {
        if (!reg) return false;
        return reg.pushManager.getSubscription().then(function (s) { return !!s; });
      }).catch(function () { return false; });
    },

    activar: function () {
      if (!Avisos.soportado()) return Promise.reject(new Error('Este navegador no admite avisos'));

      return Avisos.consultar().then(function (hay) {
        if (!hay) throw new Error('Los avisos no están configurados en el servidor');
        return Notification.requestPermission();
      }).then(function (permiso) {
        try { localStorage.setItem(PEDIDO_KEY, '1'); } catch (err) { /* da igual */ }
        if (permiso !== 'granted') throw new Error('No diste permiso para avisar');
        return registro();
      }).then(function (reg) {
        if (!reg) throw new Error('La app no está lista todavía; recarga y prueba otra vez');
        return reg.pushManager.getSubscription().then(function (ya) {
          return ya || reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: b64urlABytes(publica),
          });
        });
      }).then(function (sub) {
        return fetch(base() + '/push', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(comoJson(sub)),
        }).then(function (res) {
          if (!res.ok) throw new Error('El servidor no aceptó la suscripción');
          return true;
        });
      });
    },

    desactivar: function () {
      return registro().then(function (reg) {
        if (!reg) return false;
        return reg.pushManager.getSubscription();
      }).then(function (sub) {
        if (!sub) return false;
        var endpoint = sub.endpoint;
        return sub.unsubscribe().then(function () {
          return fetch(base() + '/push', {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ endpoint: endpoint }),
          });
        }).then(function () { return true; });
      });
    },

    // Empuja los avisos pendientes. Lo llama quien acaba de editar, para
    // que el equipo no tenga que esperar a que alguien abra la web.
    empujar: function () {
      return fetch(base() + '/push', { method: 'PUT' }).catch(function () { /* ya saldrá */ });
    },
  };

  window.CalAvisos = Avisos;
})();
