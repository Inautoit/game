// GET    /api/fotos/<id>  -> la imagen (pública)
// DELETE /api/fotos/<id>  -> borrarla
//
// Puede borrar dos gentes: el entrenador (con su token de edición) y quien
// subió la foto, que al subirla recibió una clave y la guardó en su
// navegador. Esa clave es un HMAC del id: nadie la puede inventar.
import { json, error, exigirEditor, claveFoto, iguales } from '../_shared.js';

const PREFIJO = 'foto:';

function idValido(id) {
  return typeof id === 'string' && /^[0-9a-fA-F-]{36}$/.test(id);
}

export async function onRequestGet({ params, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);
  if (!idValido(params.id)) return error('Identificador no válido', 400);

  const { value, metadata } = await env.CALENDARIO.getWithMetadata(PREFIJO + params.id, {
    type: 'arrayBuffer',
  });
  if (!value) return error('Esa foto ya no está', 404);

  return new Response(value, {
    headers: {
      'Content-Type': (metadata && metadata.tipo) || 'image/jpeg',
      // El id no se reutiliza nunca, así que la imagen se puede cachear.
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
}

export async function onRequestDelete({ params, request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);
  if (!idValido(params.id)) return error('Identificador no válido', 400);
  if (!env.EDIT_PASSWORD) return error('Falta configurar EDIT_PASSWORD', 503);

  // ¿La sube quien la subió? Su clave vale por sí sola.
  const clave = request.headers.get('x-clave') || '';
  const suya = clave && iguales(clave, await claveFoto(env, params.id));

  if (!suya) {
    // Si no, tiene que ser el entrenador.
    const noAutorizado = await exigirEditor(request, env);
    if (noAutorizado) return noAutorizado;
  }

  await env.CALENDARIO.delete(PREFIJO + params.id);
  return json({ ok: true });
}
