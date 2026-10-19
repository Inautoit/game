// BBDD mensuales guardadas en KV (binding BBDD):
//   bbdd:<AAAA-MM> -> {mes, campanas: {<campaña>: [instalaciones]}}
//   index          -> [{mes, campanas: {<campaña>: nº instalaciones}}]
// GET            -> índice
// GET ?mes=      -> BBDD del mes
// PUT ?mes=      -> guarda/reemplaza la BBDD del mes
// DELETE ?mes=   -> borra la BBDD del mes

const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;

async function leerIndice(kv) {
  return (await kv.get('index', 'json')) || [];
}

export async function onRequest({ request, env }) {
  const kv = env.BBDD;
  const mes = new URL(request.url).searchParams.get('mes');
  if (mes && !MES.test(mes)) return json({ error: 'mes inválido' }, 400);

  if (request.method === 'GET') {
    if (!mes) return json(await leerIndice(kv));
    const d = await kv.get('bbdd:' + mes, 'json');
    return d ? json(d) : json({ error: 'No hay BBDD para ' + mes }, 404);
  }

  if (request.method === 'PUT' && mes) {
    const body = await request.json();
    const campanas = {};
    for (const [nombre, ids] of Object.entries(body.campanas || {})) {
      if (!Array.isArray(ids)) continue;
      campanas[String(nombre).trim().slice(0, 80)] = [...new Set(ids.map((x) => String(x).trim()).filter(Boolean))];
    }
    if (!Object.keys(campanas).length) return json({ error: 'Sin campañas' }, 400);
    await kv.put('bbdd:' + mes, JSON.stringify({ mes, campanas }));
    const idx = (await leerIndice(kv)).filter((i) => i.mes !== mes);
    idx.push({ mes, campanas: Object.fromEntries(Object.entries(campanas).map(([k, v]) => [k, v.length])) });
    idx.sort((a, b) => a.mes.localeCompare(b.mes));
    await kv.put('index', JSON.stringify(idx));
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && mes) {
    await kv.delete('bbdd:' + mes);
    await kv.put('index', JSON.stringify((await leerIndice(kv)).filter((i) => i.mes !== mes)));
    return json({ ok: true });
  }

  return json({ error: 'Método no soportado' }, 405);
}
