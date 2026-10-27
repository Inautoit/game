// BBDD mensuales guardadas en KV (binding BBDD):
//   bbdd:<AAAA-MM> -> {mes, campanas: {<campaña>: [instalaciones]}}
//   index          -> [{mes, campanas: {<campaña>: nº instalaciones}}]
// GET            -> índice
// GET ?mes=      -> BBDD del mes
// PUT ?mes=      -> guarda/reemplaza la BBDD del mes
// DELETE ?mes=   -> borra la BBDD del mes
// ?prog=sa|to     -> mismas operaciones para los informes Second Attempt / TakeOver (claves sa:… / to:…)

const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
// AAAA-MM o AAAA-MM-sufijo (BBDD adicionales de un mes, p. ej. una segmentación).
const MES = /^\d{4}-(0[1-9]|1[0-2])(-[a-z0-9]{1,20})?$/;
const DIA = /^\d{4}-\d{2}-\d{2}$/;

// Cada informe (principal o Second Attempt) tiene sus propias BBDD; los commlogs son comunes.
const PROGS = { '': '', sa: 'sa:', to: 'to:', ven: 'ven:' };
// ?esp=up -> dashboard de Upsell, con sus propias BBDD (claves up:…)
const ESPACIOS = { '': '', up: 'up:' };

async function leerIndice(kv, pre) {
  return (await kv.get(pre + 'index', 'json')) || [];
}

export async function onRequest({ request, env }) {
  const kv = env.BBDD;
  const url = new URL(request.url);
  const mes = url.searchParams.get('mes');
  if (mes && !MES.test(mes)) return json({ error: 'mes inválido' }, 400);
  const prog = PROGS[url.searchParams.get('prog') || ''], esp = ESPACIOS[url.searchParams.get('esp') || ''];
  if (prog == null || esp == null) return json({ error: 'informe inválido' }, 400);
  const pre = esp + prog;

  if (request.method === 'GET') {
    if (!mes) return json(await leerIndice(kv, pre));
    const d = await kv.get(pre + 'bbdd:' + mes, 'json');
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
    // Opcionales: nombre visible y fecha desde la que cuentan los commlogs.
    const extra = {};
    if (body.nombre) extra.nombre = String(body.nombre).trim().slice(0, 60);
    if (DIA.test(body.desde || '')) extra.desde = body.desde;
    // TakeOver: commlogs hasta hoy (sin cortar a fin de mes) y fecha de carga por instalación.
    if (body.hastaHoy) extra.hastaHoy = true;
    let cargas = null;
    if (body.cargas && typeof body.cargas === 'object') {
      cargas = {};
      for (const [id, d] of Object.entries(body.cargas)) if (DIA.test(d)) cargas[String(id).trim()] = d;
    }
    await kv.put(pre + 'bbdd:' + mes, JSON.stringify({ mes, ...extra, campanas, ...(cargas ? { cargas } : {}) }));
    const idx = (await leerIndice(kv, pre)).filter((i) => i.mes !== mes);
    idx.push({ mes, ...extra, campanas: Object.fromEntries(Object.entries(campanas).map(([k, v]) => [k, v.length])) });
    idx.sort((a, b) => a.mes.localeCompare(b.mes));
    await kv.put(pre + 'index', JSON.stringify(idx));
    return json({ ok: true });
  }

  if (request.method === 'DELETE' && mes) {
    await kv.delete(pre + 'bbdd:' + mes);
    await kv.put(pre + 'index', JSON.stringify((await leerIndice(kv, pre)).filter((i) => i.mes !== mes)));
    return json({ ok: true });
  }

  return json({ error: 'Método no soportado' }, 405);
}
