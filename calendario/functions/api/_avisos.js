// Quién recibe los avisos y cuándo se mandan.
//
// Los cambios se agrupan: al guardar el calendario no se avisa al momento,
// se apunta que hay algo pendiente. Pasada la ventana, el siguiente que
// pase por la web dispara el envío, y sale un único aviso con el total.
// Así editar diez cosas seguidas no son diez notificaciones.
import { enviarPush } from './_webpush.js';

const SUSCRIPCION = 'push:sub:';
const PENDIENTE = 'push:pendiente';

export const VENTANA_MINUTOS = 3;

// El `sub` del JWT identifica a quien manda ante el servicio de push.
// Se usa la propia web para no dar de por medio el correo de nadie.
function contacto(env, request) {
  if (env.VAPID_SUBJECT) return env.VAPID_SUBJECT;
  return new URL(request.url).origin;
}

export function vapidConfigurado(env) {
  return !!(env.VAPID_PUBLICA && env.VAPID_PRIVADA);
}

// Identificador estable de una suscripción, a partir de su endpoint: así
// suscribirse dos veces desde el mismo móvil no duplica el aviso.
export async function idDeEndpoint(endpoint) {
  const datos = new TextEncoder().encode(endpoint);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', datos));
  return [...hash.slice(0, 16)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function guardarSuscripcion(env, suscripcion) {
  const id = await idDeEndpoint(suscripcion.endpoint);
  await env.CALENDARIO.put(SUSCRIPCION + id, JSON.stringify(suscripcion));
  return id;
}

export async function borrarSuscripcion(env, endpoint) {
  await env.CALENDARIO.delete(SUSCRIPCION + await idDeEndpoint(endpoint));
}

export async function listarSuscripciones(env) {
  const lista = await env.CALENDARIO.list({ prefix: SUSCRIPCION, limit: 1000 });
  const out = [];
  for (const k of lista.keys) {
    const sub = await env.CALENDARIO.get(k.name, { type: 'json' });
    if (sub && sub.endpoint && sub.keys) out.push({ clave: k.name, sub });
  }
  return out;
}

// Suma un cambio a lo que está pendiente de avisar.
export async function apuntarCambio(env) {
  const actual = await env.CALENDARIO.get(PENDIENTE, { type: 'json' });
  const desde = (actual && actual.desde) || new Date().toISOString();
  const cambios = ((actual && actual.cambios) || 0) + 1;
  await env.CALENDARIO.put(PENDIENTE, JSON.stringify({ desde, cambios }));
}

function redaccion(cambios) {
  if (cambios <= 1) {
    return { titulo: 'Calendario actualizado', cuerpo: 'Hay un cambio en el calendario del equipo.' };
  }
  return {
    titulo: 'Calendario actualizado',
    cuerpo: 'Hay ' + cambios + ' cambios en el calendario del equipo.',
  };
}

// Manda el aviso agrupado si ya ha pasado la ventana. Devuelve cuántos
// envíos salieron, o null si no tocaba.
export async function avisarSiToca(env, request, { forzar = false } = {}) {
  if (!vapidConfigurado(env)) return null;

  const pendiente = await env.CALENDARIO.get(PENDIENTE, { type: 'json' });
  if (!pendiente || !pendiente.cambios) return null;

  const esperado = new Date(pendiente.desde).getTime() + VENTANA_MINUTOS * 60 * 1000;
  if (!forzar && Date.now() < esperado) return null;

  // Se limpia antes de enviar: si algo falla, es preferible perder un
  // aviso a mandarlo repetido cada vez que alguien abra la web.
  await env.CALENDARIO.delete(PENDIENTE);

  const suscripciones = await listarSuscripciones(env);
  if (!suscripciones.length) return 0;

  const texto = JSON.stringify(Object.assign(redaccion(pendiente.cambios), { url: '/' }));
  const vapid = {
    publica: env.VAPID_PUBLICA,
    privada: env.VAPID_PRIVADA,
    contacto: contacto(env, request),
  };

  let enviados = 0;
  for (const { clave, sub } of suscripciones) {
    try {
      const r = await enviarPush(sub, texto, vapid);
      if (r.ok) enviados++;
      // El navegador desinstalado o con permiso retirado: fuera de la lista.
      else if (r.caducada) await env.CALENDARIO.delete(clave);
    } catch (err) {
      // Un fallo suelto no debe impedir que el resto reciba el aviso.
    }
  }
  return enviados;
}
