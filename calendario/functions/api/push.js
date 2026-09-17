// GET    /api/push  -> { activo, publica }  clave para suscribirse
// POST   /api/push  <- la suscripción del navegador
// DELETE /api/push  <- { endpoint } para darse de baja
//
// Suscribirse es libre, como subir fotos: cualquiera del equipo con el
// enlace puede pedir que le avisen.
import { json, error, exigirEditor } from './_shared.js';
import { guardarSuscripcion, borrarSuscripcion, vapidConfigurado, avisarSiToca } from './_avisos.js';

// Los servicios de push de verdad son siempre https. Se admite además
// localhost para poder probar los envíos en desarrollo; desde Cloudflare
// esa dirección no lleva a ninguna parte, así que no abre nada.
function endpointAdmisible(url) {
  if (!/^https:\/\//.test(url)) {
    return /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(url);
  }
  return true;
}

function suscripcionValida(s) {
  return !!(s && typeof s.endpoint === 'string' &&
    endpointAdmisible(s.endpoint) && s.endpoint.length < 2000 &&
    s.keys && typeof s.keys.p256dh === 'string' && typeof s.keys.auth === 'string');
}

export async function onRequestGet({ env }) {
  return json({
    activo: vapidConfigurado(env) && !!env.CALENDARIO,
    publica: env.VAPID_PUBLICA || null,
  });
}

export async function onRequestPost({ request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);
  if (!vapidConfigurado(env)) return error('Los avisos no están configurados', 503);

  let sub;
  try {
    sub = await request.json();
  } catch {
    return error('JSON no válido', 400);
  }
  if (!suscripcionValida(sub)) return error('Suscripción mal formada', 400);

  const id = await guardarSuscripcion(env, {
    endpoint: sub.endpoint,
    keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
  });
  return json({ ok: true, id });
}

export async function onRequestDelete({ request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  let cuerpo;
  try {
    cuerpo = await request.json();
  } catch {
    return error('JSON no válido', 400);
  }
  if (!cuerpo || typeof cuerpo.endpoint !== 'string') return error('Falta el endpoint', 400);

  await borrarSuscripcion(env, cuerpo.endpoint);
  return json({ ok: true });
}

// PUT /api/push -> empuja los avisos pendientes si ya toca.
//
// Lo llama el navegador de quien edita cuando termina, para no esperar a
// que pase alguien por la web. No hace falta permiso: solo manda lo que ya
// estaba apuntado, y únicamente si la ventana se cumplió.
export async function onRequestPut({ request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  // Con ?forzar=1 sale al momento, sin esperar a que cierre la ventana.
  // Eso sí lo reserva el entrenador: es quien decide que algo corre prisa.
  const forzar = !!new URL(request.url).searchParams.get('forzar');
  if (forzar) {
    const noAutorizado = await exigirEditor(request, env);
    if (noAutorizado) return noAutorizado;
  }

  const enviados = await avisarSiToca(env, request, { forzar });
  return json({ ok: true, enviados });
}
