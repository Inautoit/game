// Estado del calendario: cargar, guardar, editar días y sincronizar.
(function () {
  'use strict';

  var cfg = window.CAL_CONFIG;
  var listeners = [];
  var saveListeners = [];
  var data = null;

  function clone(x) { return JSON.parse(JSON.stringify(x)); }

  function emit() {
    listeners.forEach(function (fn) { fn(data); });
  }

  function nextId() {
    return 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  var TIPOS = ['entreno', 'partido', 'descanso', 'aviso'];

  function limpiarEntrada(e) {
    return {
      id: typeof e.id === 'string' && e.id ? e.id : nextId(),
      tipo: TIPOS.indexOf(e.tipo) >= 0 ? e.tipo : 'entreno',
      horario: typeof e.horario === 'string' ? e.horario : '',
      titulo: typeof e.titulo === 'string' ? e.titulo : '',
      lugar: typeof e.lugar === 'string' ? e.lugar : '',
      notas: typeof e.notas === 'string' ? e.notas : '',
    };
  }

  // Acepta cualquier objeto con forma de calendario y devuelve una copia
  // saneada, para que un JSON importado a mano no rompa la vista.
  function normalize(raw) {
    var seed = window.CAL_SEED;
    var out = {
      version: 1,
      equipo: typeof raw.equipo === 'string' ? raw.equipo : seed.equipo,
      titulo: typeof raw.titulo === 'string' ? raw.titulo : seed.titulo,
      actualizado: typeof raw.actualizado === 'string' ? raw.actualizado : new Date().toISOString(),
      dias: {},
    };
    var dias = raw && raw.dias && typeof raw.dias === 'object' ? raw.dias : {};

    Object.keys(dias).forEach(function (fecha) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return;
      var lista = Array.isArray(dias[fecha]) ? dias[fecha] : [];
      var limpio = lista.filter(function (e) {
        return e && typeof e === 'object';
      }).map(limpiarEntrada);
      if (limpio.length) out.dias[fecha] = limpio;
    });

    return out;
  }

  function readLocal() {
    try {
      var raw = localStorage.getItem(cfg.storageKey);
      return raw ? normalize(JSON.parse(raw)) : null;
    } catch (err) {
      console.warn('No se pudo leer el calendario guardado:', err);
      return null;
    }
  }

  function writeLocal() {
    try {
      localStorage.setItem(cfg.storageKey, JSON.stringify(data));
      return true;
    } catch (err) {
      console.warn('No se pudo guardar en este navegador:', err);
      return false;
    }
  }

  // Con backend, cada cambio se sube solo (agrupando ráfagas de ediciones).
  var guardarTimer = null;
  var estadoGuardado = 'inactivo';

  function setEstado(nuevo, detalle) {
    estadoGuardado = nuevo;
    saveListeners.forEach(function (fn) { fn(nuevo, detalle); });
  }

  function autoguardar() {
    if (!window.CalApi.isAvailable() || !window.CalApi.hasToken()) return;
    clearTimeout(guardarTimer);
    setEstado('pendiente');
    guardarTimer = setTimeout(function () {
      setEstado('guardando');
      window.CalApi.guardar(data).then(function () {
        setEstado('guardado');
      }).catch(function (err) {
        setEstado('error', err);
      });
    }, 900);
  }

  var Store = {
    // --- lectura ---

    get: function () { return data; },

    // Entradas de un día concreto, ordenadas por hora.
    day: function (fecha) {
      var lista = (data.dias[fecha] || []).slice();
      lista.sort(function (a, b) {
        return (a.horario || 'zz').localeCompare(b.horario || 'zz', 'es');
      });
      return lista;
    },

    has: function (fecha) { return !!(data.dias[fecha] && data.dias[fecha].length); },

    onChange: function (fn) { listeners.push(fn); },

    // Avisos del autoguardado: 'pendiente' | 'guardando' | 'guardado' | 'error'.
    onSave: function (fn) { saveListeners.push(fn); },

    saveState: function () { return estadoGuardado; },

    // --- escritura ---

    addEntry: function (fecha, entry) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha)) return null;
      if (!data.dias[fecha]) data.dias[fecha] = [];
      var nuevo = limpiarEntrada(entry || {});
      nuevo.id = nextId();
      data.dias[fecha].push(nuevo);
      this.touch();
      return nuevo.id;
    },

    updateEntry: function (fecha, id, campos) {
      var lista = data.dias[fecha] || [];
      var entry = lista.filter(function (e) { return e.id === id; })[0];
      if (!entry) return false;
      Object.keys(campos).forEach(function (k) {
        if (k !== 'id' && k in entry) entry[k] = campos[k];
      });
      this.touch();
      return true;
    },

    removeEntry: function (fecha, id) {
      var lista = data.dias[fecha] || [];
      data.dias[fecha] = lista.filter(function (e) { return e.id !== id; });
      if (!data.dias[fecha].length) delete data.dias[fecha];
      this.touch();
    },

    clearDay: function (fecha) {
      delete data.dias[fecha];
      this.touch();
    },

    // Mueve todas las entradas de un día a otro (arrastrar un entreno).
    moveDay: function (desde, hasta) {
      if (desde === hasta || !data.dias[desde]) return;
      var destino = data.dias[hasta] || [];
      data.dias[hasta] = destino.concat(data.dias[desde]);
      delete data.dias[desde];
      this.touch();
    },

    setMeta: function (campos) {
      if (typeof campos.equipo === 'string') data.equipo = campos.equipo;
      if (typeof campos.titulo === 'string') data.titulo = campos.titulo;
      this.touch();
    },

    touch: function () {
      data.actualizado = new Date().toISOString();
      writeLocal();
      emit();
      autoguardar();
    },

    // --- carga, importación y publicación ---

    replaceAll: function (raw) {
      data = normalize(raw);
      this.touch();
    },

    resetToSeed: function () {
      this.replaceAll(clone(window.CAL_SEED));
    },

    toJSON: function () { return JSON.stringify(data, null, 2); },

    // Arranque: primero lo que haya en este navegador (instantáneo, y
    // también lo que se ve sin conexión) y luego, si hay backend, el
    // calendario del servidor, que manda sobre la copia local.
    init: function () {
      data = readLocal() || normalize(clone(window.CAL_SEED));
      emit();
      return window.CalApi.detect().then(function (hay) {
        if (!hay) return false;
        return Store.pull();
      }).catch(function (err) {
        console.warn('Sin datos del servidor:', err.message);
        return false;
      });
    },

    syncEnabled: function () { return window.CalApi.isAvailable(); },

    // Trae el calendario del servidor y lo deja como versión buena.
    pull: function () {
      return window.CalApi.cargar().then(function (remoto) {
        if (!remoto || !remoto.dias) return false;
        data = normalize(remoto);
        writeLocal();
        emit();
        return true;
      });
    },

    // Sube el calendario al servidor (requiere modo edición desbloqueado).
    push: function () {
      return window.CalApi.guardar(data);
    },
  };

  window.CalStore = Store;
})();
