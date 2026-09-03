// Adaptador de CalApi para la versión publicada como Artifact.
//
// Cumple la misma interfaz que src/api.js (que habla con Cloudflare),
// pero por debajo usa la base de datos compartida del visor: todos los
// que abren el enlace leen el mismo calendario y ven los cambios en
// cuanto se guardan.
//
// Quién puede escribir NO lo decide esta página: lo decide el nivel con
// el que se ha compartido el enlace. Las reglas publicadas con la página
// dejan leer a cualquiera y escribir solo a quien tenga permiso de
// edición. La contraseña es la segunda barrera, la de la interfaz.
(function () {
  'use strict';

  var DOC = 'calendario/actual';
  var TOKEN_KEY = 'bml-calendario-v1:editor-ok';

  var db = null;
  var listo = false;
  var alCambiar = null;

  var Api = {
    isAvailable: function () { return !!db; },

    hasToken: function () {
      try { return sessionStorage.getItem(TOKEN_KEY) === '1'; } catch (err) { return false; }
    },

    detect: function () {
      if (listo) return Promise.resolve(!!db);
      var use = window.claude && window.claude.use;
      if (!use) { listo = true; return Promise.resolve(false); }

      return window.claude.use('db').then(function (ns) {
        db = ns || null;
        listo = true;
        if (db && alCambiar) Api.escuchar();
        return !!db;
      }).catch(function () {
        listo = true;
        return false;
      });
    },

    cargar: function () {
      if (!db) return Promise.reject(new Error('Base de datos no disponible'));
      return db.doc(DOC).get().then(function (snap) {
        var datos = snap && snap.data ? snap.data() : null;
        return datos && datos.dias ? datos : null;
      });
    },

    guardar: function (calendario) {
      if (!db) return Promise.reject(new Error('Base de datos no disponible'));
      // La copia evita mandar objetos congelados que vengan de un snapshot.
      return db.doc(DOC).set(JSON.parse(JSON.stringify(calendario))).catch(function (err) {
        var codigo = err && (err.code || err.name);
        if (codigo === 'invalid_argument' || codigo === 'permission_denied') {
          throw new Error('Este enlace es de solo lectura: pide permiso de edición al dueño del calendario.');
        }
        throw err;
      });
    },

    // La contraseña se comprueba en la página (huella SHA-256 de config.js).
    // Lo que de verdad impide escribir a un visitante son las reglas de la
    // base de datos, que se aplican fuera de esta página.
    login: function (password) {
      var cred = window.CAL_CONFIG.auth;
      var ok = window.sha256Hex(cred.salt + ':' + String(password)) === cred.hash;
      if (!ok) {
        var err = new Error('Contraseña incorrecta');
        err.status = 401;
        return Promise.reject(err);
      }
      try { sessionStorage.setItem(TOKEN_KEY, '1'); } catch (e) { /* sesión no persistente */ }
      return Promise.resolve(true);
    },

    logout: function () {
      try { sessionStorage.removeItem(TOKEN_KEY); } catch (err) { /* nada que limpiar */ }
    },

    // Cambios en vivo: si el entrenador edita, los demás lo ven al momento.
    onRemoteChange: function (fn) {
      alCambiar = fn;
      if (db) Api.escuchar();
    },

    escuchar: function () {
      if (Api._suscrito) return;
      Api._suscrito = true;
      db.doc(DOC).onSnapshot(function (snap) {
        var datos = snap && snap.data ? snap.data() : null;
        if (datos && datos.dias && alCambiar) alCambiar(datos);
      }, function () { /* se sigue con la copia local */ });
    },
  };

  window.CalApi = Api;
})();
