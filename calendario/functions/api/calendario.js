// GET  /api/calendario  ->  { calendario }        (público)
// PUT  /api/calendario  <-  calendario completo   (requiere token de editor)
//
// Se guarda en un KV de Cloudflare (plan gratuito). Si el KV no está
// enlazado, GET responde 503 y la web sigue funcionando en modo local.
import { json, error, exigirEditor, KEY } from './_shared.js';
import { apuntarCambio, avisarSiToca } from './_avisos.js';

const MAX_BYTES = 512 * 1024;

function normalizar(raw) {
  const tipos = ['entreno', 'partido', 'descanso', 'aviso'];
  const texto = (v) => (typeof v === 'string' ? v.slice(0, 500) : '');
  const nombres = (v) => {
    if (!Array.isArray(v)) return [];
    const vistos = new Set();
    const out = [];
    for (const n of v) {
      if (typeof n !== 'string') continue;
      const limpio = n.trim().slice(0, 60);
      if (!limpio || vistos.has(limpio)) continue;
      vistos.add(limpio);
      out.push(limpio);
      if (out.length >= 60) break;
    }
    return out;
  };
  const marcador = (v) => {
    if (v === null || v === undefined || v === '') return null;
    const n = Math.round(Number(v));
    return Number.isFinite(n) && n >= 0 && n <= 999 ? n : null;
  };
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
      aplazado: e.aplazado === true,
      golesFavor: marcador(e.golesFavor),
      golesContra: marcador(e.golesContra),
      convocadas: nombres(e.convocadas),
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

export async function onRequestGet({ request, env, waitUntil }) {
  if (!env.CALENDARIO) return error('KV CALENDARIO no enlazado', 503);

  // De paso, si hay avisos pendientes y ya pasó la ventana, se mandan.
  // Sale gratis: cualquiera que abra la web hace de disparador.
  if (waitUntil) waitUntil(avisarSiToca(env, request).catch(() => {}));

  const guardado = await env.CALENDARIO.get(KEY, { type: 'json' });
  return json({ calendario: guardado || null });
}

export async function onRequestPut({ request, env, waitUntil }) {
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

  // No se avisa aquí: se apunta y se agrupa, para no soltar una
  // notificación por cada toque mientras se edita.
  if (waitUntil) waitUntil(apuntarCambio(env).catch(() => {}));

  return json({ ok: true, actualizado: limpio.actualizado });
}
