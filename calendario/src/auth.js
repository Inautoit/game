// Modo edición protegido por contraseña.
//
// Hay dos niveles según dónde esté publicada la web:
//
//  · Con backend (Cloudflare Pages Functions): la contraseña viaja al
//    servidor, que la compara con un secreto que nunca sale de allí y
//    devuelve un token firmado. Es protección real.
//
//  · Sin backend (web estática suelta): se compara la huella SHA-256 que
//    hay en config.js, aquí en el navegador. Evita ediciones accidentales,
//    pero quien sepa mirar el código puede saltárselo.
(function () {
  'use strict';

  var cfg = window.CAL_CONFIG;
  var SESSION_KEY = cfg.storageKey + ':editor';
  var OVERRIDE_KEY = cfg.storageKey + ':auth';

  var listeners = [];
  var unlocked = false;
  var lockTimer = null;

  function emit() {
    listeners.forEach(function (fn) { fn(unlocked); });
  }

  // Si el usuario cambió la contraseña desde la web y aún no la ha pegado
  // en config.js, la huella nueva vive aquí.
  function credentials() {
    try {
      var raw = localStorage.getItem(OVERRIDE_KEY);
      if (raw) {
        var o = JSON.parse(raw);
        if (o && o.salt && o.hash) return o;
      }
    } catch (err) { /* se usa la de config.js */ }
    return cfg.auth;
  }

  function randomSalt() {
    var bytes = new Uint8Array(8);
    if (window.crypto && window.crypto.getRandomValues) {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) {
      return ('0' + b.toString(16)).slice(-2);
    }).join('');
  }

  // Comparación en tiempo constante: no filtra cuántos caracteres aciertas.
  function equalHex(a, b) {
    if (a.length !== b.length) return false;
    var diff = 0;
    for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  }

  function armAutoLock() {
    clearTimeout(lockTimer);
    var mins = Number(cfg.autoLockMinutes) || 0;
    if (!unlocked || mins <= 0) return;
    lockTimer = setTimeout(function () { Auth.lock(); }, mins * 60 * 1000);
  }

  function abrir() {
    unlocked = true;
    try { sessionStorage.setItem(SESSION_KEY, '1'); } catch (err) { /* sin sesión persistente */ }
    armAutoLock();
    emit();
  }

  var Auth = {
    isUnlocked: function () { return unlocked; },

    onChange: function (fn) { listeners.push(fn); },

    // Devuelve una promesa: true si la contraseña es correcta.
    unlock: function (password) {
      if (window.CalApi.isAvailable()) {
        return window.CalApi.login(password).then(function () {
          abrir();
          return true;
        }).catch(function (err) {
          if (err.status === 401) return false;
          throw err;
        });
      }

      var cred = credentials();
      var hash = window.sha256Hex(cred.salt + ':' + String(password));
      if (!equalHex(hash, cred.hash)) return Promise.resolve(false);
      abrir();
      return Promise.resolve(true);
    },

    lock: function () {
      unlocked = false;
      clearTimeout(lockTimer);
      try { sessionStorage.removeItem(SESSION_KEY); } catch (err) { /* nada que limpiar */ }
      window.CalApi.logout();
      emit();
    },

    // Cada acción de edición reinicia la cuenta atrás del bloqueo.
    keepAlive: armAutoLock,

    // Devuelve el bloque que hay que pegar en config.js para que la
    // contraseña nueva valga también en el resto de dispositivos.
    // Solo tiene sentido sin backend: con Cloudflare la contraseña es la
    // variable de entorno EDIT_PASSWORD del panel.
    canChangePassword: function () { return !window.CalApi.isAvailable(); },

    changePassword: function (nueva) {
      var salt = randomSalt();
      var hash = window.sha256Hex(salt + ':' + String(nueva));
      try {
        localStorage.setItem(OVERRIDE_KEY, JSON.stringify({ salt: salt, hash: hash }));
      } catch (err) { /* solo valdrá tras editar config.js */ }
      return "    salt: '" + salt + "',\n    hash: '" + hash + "',";
    },

    init: function () {
      try { unlocked = sessionStorage.getItem(SESSION_KEY) === '1'; } catch (err) { unlocked = false; }
      // Con backend, el permiso lo da el token: si se perdió, a bloquear.
      if (unlocked && window.CalApi.isAvailable() && !window.CalApi.hasToken()) unlocked = false;
      armAutoLock();
      emit();
    },
  };

  window.CalAuth = Auth;
})();
