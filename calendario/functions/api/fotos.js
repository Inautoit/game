// GET  /api/fotos   -> lista de fotos (pública)
// POST /api/fotos   -> sube una foto (pública: cualquiera del equipo)
//
// Las fotos se guardan en el mismo KV que el calendario, con el prefijo
// `foto:`, y los datos de cada una (nombre, autor, fecha) en la metadata
// de la clave. Así no hace falta un índice aparte que se pueda pisar
// cuando dos personas suben a la vez.
import { json, error, claveFoto } from './_shared.js';

const PREFIJO = 'foto:';
const MAX_BYTES = 6 * 1024 * 1024;   // la web las reduce antes de subir
const MAX_FOTOS = 400;
const TIPOS = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

function texto(v, max) {
  if (typeof v !== 'string') return '';
  return v.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max);
}

// Las cabeceras solo admiten ASCII, así que el nombre y el autor viajan
// con encodeURIComponent.
function cabeceraTexto(request, nombre, max) {
  const crudo = request.headers.get(nombre);
  if (!crudo) return '';
  try {
    return texto(decodeURIComponent(crudo), max);
  } catch {
    return texto(crudo, max);
  }
}

export async function onRequestGet({ env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  const lista = await env.CALENDARIO.list({ prefix: PREFIJO, limit: 1000 });
  const fotos = lista.keys.map((k) => ({
    id: k.name.slice(PREFIJO.length),
    nombre: (k.metadata && k.metadata.nombre) || 'foto',
    autor: (k.metadata && k.metadata.autor) || '',
    tipo: (k.metadata && k.metadata.tipo) || 'image/jpeg',
    fecha: (k.metadata && k.metadata.fecha) || '',
    bytes: (k.metadata && k.metadata.bytes) || 0,
  }));

  // Las más nuevas primero.
  fotos.sort((a, b) => String(b.fecha).localeCompare(String(a.fecha)));
  return json({ fotos });
}

export async function onRequestPost({ request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  const tipo = (request.headers.get('Content-Type') || '').split(';')[0].trim().toLowerCase();
  if (!TIPOS.includes(tipo)) return error('Solo se admiten imágenes JPG, PNG, WEBP o GIF', 415);

  const datos = await request.arrayBuffer();
  if (!datos.byteLength) return error('La imagen llegó vacía', 400);
  if (datos.byteLength > MAX_BYTES) return error('La imagen pesa demasiado (máximo 6 MB)', 413);

  const yaHay = await env.CALENDARIO.list({ prefix: PREFIJO, limit: 1000 });
  if (yaHay.keys.length >= MAX_FOTOS) {
    return error('La galería está llena (' + MAX_FOTOS + ' fotos). Hay que borrar alguna.', 507);
  }

  const id = crypto.randomUUID();
  await env.CALENDARIO.put(PREFIJO + id, datos, {
    metadata: {
      nombre: cabeceraTexto(request, 'x-nombre', 120) || 'foto',
      autor: cabeceraTexto(request, 'x-autor', 40),
      tipo,
      fecha: new Date().toISOString(),
      bytes: datos.byteLength,
    },
  });

  // La clave solo la ve quien acaba de subir: es su permiso para borrarla.
  return json({ ok: true, id, clave: await claveFoto(env, id) });
}
