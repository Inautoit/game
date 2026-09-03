// Configuración del calendario. Es el único archivo que hay que tocar.
window.CAL_CONFIG = {
  // Clave con la que se guarda el calendario en este navegador.
  storageKey: 'bml-calendario-v1',

  // Backend opcional (Cloudflare Pages Functions + KV, plan gratuito).
  // 'auto' = usa /api si está disponible y, si no, funciona en local.
  // Pon `false` para forzar el modo solo-navegador.
  api: 'auto',
  apiBase: './api',

  // Contraseña de edición cuando NO hay backend (web estática suelta).
  // No se guarda la contraseña, solo su huella: sha256(salt + ':' + contraseña).
  // Cámbiala desde la web: modo edición → «Cambiar contraseña».
  //
  // OJO: sin backend esto solo evita ediciones accidentales; quien mire el
  // código puede saltárselo. Con Cloudflare la comprobación es de verdad,
  // en el servidor, y esta huella deja de usarse.
  auth: {
    salt: '9d264b8b0a166fca',
    hash: '11304f14a6a1229f88b5ba13cd22755a219a3e8c3e1e4c8e8a9ee25e8e6aabd7',
  },

  // Minutos de inactividad tras los que se bloquea solo el modo edición.
  autoLockMinutes: 30,

  // Ficha del equipo en la Federación Madrileña. Para quitarla, pon url: ''.
  federacion: {
    url: 'https://www.fmbalonmano.com/equipos/200',
    etiqueta: 'Clasificación y resultados en la Federación',
  },
};
