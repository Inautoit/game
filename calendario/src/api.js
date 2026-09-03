// Cliente del backend opcional (Cloudflare Pages Functions).
//
// Si la web se publica en Cloudflare Pages con la función `functions/api/`
// y un KV enlazado, el calendario se guarda en el servidor y lo ven todos.
// Si no hay backend, `detect()` devuelve false y la web sigue funcionando
// en modo solo-navegador.
(function () {
  'use strict';

  var cfg = window.CAL_CONFIG;
  var TOKEN_KEY = cfg.storageKey + ':token';
  var disponible = false;

  function url(ruta) { return cfg.apiBase.replace(/\/$/, '') + ruta; }

  function token() {
    try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch (err) { return ''; }
  }

  function pedir(ruta, opciones) {
    var o = opciones || {};
    o.headers = o.headers || {};
    o.cache = 'no-store';
    var t = token();
    if (t) o.headers.Authorization = 'Bearer ' + t;
    return fetch(url(ruta), o).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (cuerpo) {
        if (!res.ok) {
          var err = new Error(cuerpo.error || ('HTTP ' + res.status));
          err.status = res.status;
          throw err;
        }
        return cuerpo;
      });
    });
  }

  var Api = {
    isAvailable: function () { return disponible; },

    hasToken: function () { return !!token(); },

    // Comprueba una sola vez, al arrancar, si hay backend detrás.
    detect: function () {
      if (cfg.api === false) return Promise.resolve(false);
      return pedir('/calendario', { method: 'GET' }).then(function () {
        disponible = true;
        return true;
      }).catch(function () {
        disponible = false;
        return false;
      });
    },

    cargar: function () {
      return pedir('/calendario', { method: 'GET' }).then(function (r) { return r.calendario || null; });
    },

    guardar: function (calendario) {
      return pedir('/calendario', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(calendario),
      });
    },

    login: function (password) {
      return pedir('/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: password }),
      }).then(function (r) {
        if (!r.token) throw new Error('Respuesta sin token');
        try { sessionStorage.setItem(TOKEN_KEY, r.token); } catch (err) { /* sesión no persistente */ }
        return true;
      });
    },

    logout: function () {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* nada que limpiar */ }
    },
  };

  window.CalApi = Api;
})();
