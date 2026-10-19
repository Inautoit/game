// Commlogs guardados en KV (binding BBDD), uno por mes de la fecha del commlog:
//   logs:<AAAA-MM> -> [[instalacion, 'AAAA-MM-DD HH:MM', key4], ...]
//   logs_index     -> [{mes, n, max, actualizado}]
// GET            -> índice
// GET ?mes=      -> commlogs del mes
// PUT ?mes=      -> añade commlogs al mes sin duplicar ({logs: [...]})
// DELETE ?mes=   -> borra los commlogs del mes

const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

async function guardarIndice(kv, mes, entrada) {
  const idx = ((await kv.get('logs_index', 'json')) || []).filter((i) => i.mes !== mes);
  if (entrada) idx.push(entrada);
  idx.sort((a, b) => a.mes.localeCompare(b.mes));
  await kv.put('logs_index', JSON.stringify(idx));
}

export async function onRequest({ request, env }) {
  const kv = env.BBDD;
  const mes = new URL(request.url).searchParams.get('mes');
  if (mes && !MES.test(mes)) return json({ error: 'mes inválido' }, 400);

  if (request.method === 'GET') {
    if (!mes) return json((await kv.get('logs_index', 'json')) || []);
    return json({ mes, logs: (await kv.get('logs:' + mes, 'json')) || [] });
  }

  if (request.method === 'PUT' && mes) {
    const { logs } = await request.json();
    if (!Array.isArray(logs)) return json({ error: 'logs debe ser una lista' }, 400);
    const actuales = (await kv.get('logs:' + mes, 'json')) || [];
    const vistos = new Set(actuales.map((l) => l.join('|')));
    for (const l of logs) {
      if (!Array.isArray(l) || l.length < 3) continue;
      const fila = [String(l[0]).trim(), String(l[1]).slice(0, 16), String(l[2] ?? '').trim()];
      if (!fila[0] || !fila[1].startsWith(mes)) continue;
      const k = fila.join('|');
      if (!vistos.has(k)) { vistos.add(k); actuales.push(fila); }
    }
    await kv.put('logs:' + mes, JSON.stringify(actuales));
    const max = actuales.reduce((m, l) => (l[1] > m ? l[1] : m), '');
    await guardarIndice(kv, mes, { mes, n: actuales.length, max, actualizado: Date.now() });
    return json({ ok: true, n: actuales.length });
  }

  if (request.method === 'DELETE' && mes) {
    await kv.delete('logs:' + mes);
    await guardarIndice(kv, mes, null);
    return json({ ok: true });
  }

  return json({ error: 'Método no soportado' }, 405);
}
