// Commlogs guardados en KV (binding BBDD), uno por mes de la fecha del commlog:
//   logs:<AAAA-MM> -> [[instalacion, 'AAAA-MM-DD HH:MM', key4], ...]
//   logs_index     -> [{mes, n, max, actualizado}]
// GET            -> índice
// GET ?mes=      -> commlogs del mes (lista)
// PUT ?mes=&n=&max= -> reemplaza los commlogs del mes (el navegador ya ha hecho la fusión)
// DELETE ?mes=   -> borra los commlogs del mes
//
// Los ficheros diarios son grandes: el servidor no parsea los commlogs, solo
// los guarda y los devuelve tal cual (en el plan gratuito hay muy poca CPU).

const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const MAX_BYTES = 24 * 1024 * 1024; // límite de un valor de KV: 25 MiB

async function guardarIndice(kv, mes, entrada) {
  const idx = ((await kv.get('logs_index', 'json')) || []).filter((i) => i.mes !== mes);
  if (entrada) idx.push(entrada);
  idx.sort((a, b) => a.mes.localeCompare(b.mes));
  await kv.put('logs_index', JSON.stringify(idx));
}

export async function onRequest({ request, env }) {
  const kv = env.BBDD;
  const url = new URL(request.url);
  const mes = url.searchParams.get('mes');
  if (mes && !MES.test(mes)) return json({ error: 'mes inválido' }, 400);

  if (request.method === 'GET') {
    if (!mes) return json((await kv.get('logs_index', 'json')) || []);
    const stream = await kv.get('logs:' + mes, 'stream');
    return new Response(stream || '[]', { headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  }

  if (request.method === 'PUT' && mes) {
    const body = await request.text();
    if (body.length > MAX_BYTES) return json({ error: 'Demasiados commlogs para un mes' }, 413);
    if (body[0] !== '[') return json({ error: 'Formato inválido' }, 400);
    await kv.put('logs:' + mes, body);
    const n = Number(url.searchParams.get('n')) || 0;
    const max = String(url.searchParams.get('max') || '').slice(0, 16);
    await guardarIndice(kv, mes, { mes, n, max, actualizado: Date.now() });
    return json({ ok: true, n });
  }

  if (request.method === 'DELETE' && mes) {
    await kv.delete('logs:' + mes);
    await guardarIndice(kv, mes, null);
    return json({ ok: true });
  }

  return json({ error: 'Método no soportado' }, 405);
}
