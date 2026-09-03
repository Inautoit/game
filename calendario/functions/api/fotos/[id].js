// GET    /api/fotos/<id>  -> la imagen (pública)
// DELETE /api/fotos/<id>  -> borrarla (solo el entrenador)
import { json, error, exigirEditor } from '../_shared.js';

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

  const noAutorizado = await exigirEditor(request, env);
  if (noAutorizado) return noAutorizado;

  await env.CALENDARIO.delete(PREFIJO + params.id);
  return json({ ok: true });
}
