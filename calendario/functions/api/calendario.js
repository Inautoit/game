// GET  /api/calendario  ->  { calendario }        (público)
// PUT  /api/calendario  <-  calendario completo   (requiere token de editor)
//
// Se guarda en un KV de Cloudflare (plan gratuito). Si el KV no está
// enlazado, GET responde 503 y la web sigue funcionando en modo local.
import { json, error, exigirEditor, KEY } from './_shared.js';

const MAX_BYTES = 512 * 1024;

function normalizar(raw) {
  const tipos = ['entreno', 'partido', 'descanso', 'aviso'];
  const texto = (v) => (typeof v === 'string' ? v.slice(0, 500) : '');
  const dias = {};

  const origen = raw?.dias && typeof raw.dias === 'object' ? raw.dias : {};
  for (const [fecha, lista] of Object.entries(origen)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fecha) || !Array.isArray(lista)) continue;
    const limpio = lista.filter((e) => e && typeof e === 'object').slice(0, 50).map((e, i) => ({
      id: texto(e.id) || `${fecha}-${i}`,
      tipo: tipos.includes(e.tipo) ? e.tipo : 'entreno',
      horario: texto(e.horario),
      titulo: texto(e.titulo),
      lugar: texto(e.lugar),
      notas: texto(e.notas),
    }));
    if (limpio.length) dias[fecha] = limpio;
  }

  return {
    version: 1,
    equipo: texto(raw?.equipo) || 'Equipo',
    titulo: texto(raw?.titulo) || 'Calendario',
    actualizado: new Date().toISOString(),
    dias,
  };
}

export async function onRequestGet({ env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);
  const guardado = await env.CALENDARIO.get(KEY, { type: 'json' });
  return json({ calendario: guardado || null });
}

export async function onRequestPut({ request, env }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  const noAutorizado = await exigirEditor(request, env);
  if (noAutorizado) return noAutorizado;

  const crudo = await request.text();
  if (crudo.length > MAX_BYTES) return error('El calendario es demasiado grande', 413);

  let datos;
  try {
    datos = JSON.parse(crudo);
  } catch {
    return error('JSON no válido', 400);
  }
  if (!datos?.dias || typeof datos.dias !== 'object') return error('Falta "dias"', 400);

  const limpio = normalizar(datos);
  await env.CALENDARIO.put(KEY, JSON.stringify(limpio));
  return json({ ok: true, actualizado: limpio.actualizado });
}
