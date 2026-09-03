// Galería de fotos del equipo.
//
// Subir es libre: cualquiera con el enlace puede añadir fotos. Borrar
// solo lo puede hacer quien esté en modo edición, porque el servidor
// exige el token para el DELETE.
//
// Antes de subir, la foto se reduce en el propio móvil: así una foto de
// 4 MB de la cámara viaja como unos 300 KB y la galería carga rápida.
(function () {
  'use strict';

  var cfg = window.CAL_CONFIG;
  var NOMBRE_KEY = cfg.storageKey + ':autor';
  var LADO_MAX = 1600;
  var CALIDAD = 0.82;

  function base() { return cfg.apiBase.replace(/\/$/, ''); }

  // Redimensiona con canvas. Si algo falla, se sube el original.
  function reducir(file) {
    return new Promise(function (resolve) {
      if (file.type === 'image/gif' || file.size < 250 * 1024) {
        resolve({ blob: file, tipo: file.type });
        return;
      }

      var url = URL.createObjectURL(file);
      var img = new Image();

      img.onload = function () {
        URL.revokeObjectURL(url);
        var escala = Math.min(1, LADO_MAX / Math.max(img.width, img.height));
        var w = Math.round(img.width * escala);
        var h = Math.round(img.height * escala);

        var lienzo = document.createElement('canvas');
        lienzo.width = w;
        lienzo.height = h;
        lienzo.getContext('2d').drawImage(img, 0, 0, w, h);

        lienzo.toBlob(function (blob) {
          // Si comprimir no mejora nada, se manda el original.
          if (blob && blob.size < file.size) resolve({ blob: blob, tipo: 'image/jpeg' });
          else resolve({ blob: file, tipo: file.type });
        }, 'image/jpeg', CALIDAD);
      };

      img.onerror = function () {
        URL.revokeObjectURL(url);
        resolve({ blob: file, tipo: file.type });
      };

      img.src = url;
    });
  }

  var Fotos = {
    // Nombre de quien sube, recordado en este dispositivo.
    autor: function () {
      try { return localStorage.getItem(NOMBRE_KEY) || ''; } catch (err) { return ''; }
    },

    setAutor: function (nombre) {
      try { localStorage.setItem(NOMBRE_KEY, String(nombre).slice(0, 40)); } catch (err) { /* da igual */ }
    },

    urlDe: function (id) { return base() + '/fotos/' + encodeURIComponent(id); },

    listar: function () {
      return fetch(base() + '/fotos', { cache: 'no-store' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      }).then(function (r) { return r.fotos || []; });
    },

    subir: function (file, autor) {
      return reducir(file).then(function (r) {
        return fetch(base() + '/fotos', {
          method: 'POST',
          headers: {
            'Content-Type': r.tipo,
            'x-nombre': encodeURIComponent(file.name || 'foto'),
            'x-autor': encodeURIComponent(autor || ''),
          },
          body: r.blob,
        });
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (cuerpo) {
          if (!res.ok) throw new Error(cuerpo.error || ('HTTP ' + res.status));
          return cuerpo;
        });
      });
    },

    borrar: function (id) {
      var cabeceras = {};
      try {
        var t = sessionStorage.getItem(cfg.storageKey + ':token');
        if (t) cabeceras.Authorization = 'Bearer ' + t;
      } catch (err) { /* sin token: el servidor dirá que no */ }

      return fetch(Fotos.urlDe(id), { method: 'DELETE', headers: cabeceras }).then(function (res) {
        if (!res.ok) throw new Error(res.status === 401 ? 'Hay que entrar en modo edición' : 'HTTP ' + res.status);
        return true;
      });
    },
  };

  window.CalFotos = Fotos;
})();
