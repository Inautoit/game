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
    salt: '00c43b870c125c5d',
    hash: 'c5980ea6e241702b07bd0ecc0468b7b8c6981e914567a4265c7ddd45dd089ada',
  },

  // Minutos de inactividad tras los que se bloquea solo el modo edición.
  autoLockMinutes: 30,
};
