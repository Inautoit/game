// Conexiones de los gestores de Upsell (tabla «BBDD agent 30 minutos» del Access), ya sumadas
// por día y franja de media hora, en KV (binding BBDD):
//   up:con:<AAAA-MM> -> {'AAAA-MM-DD': {'HH:MM': segundos}}
//   up:con:index     -> [{mes, dias, segundos, actualizado}]
// ?tipo=llam -> lo mismo para las llamadas del informe de llamadas (tabla «agent skill 30 minutes»):
//   up:llam:<AAAA-MM> -> {'AAAA-MM-DD': {'HH:MM': nº de llamadas}}
// GET           -> índice
// GET ?mes=     -> datos del mes
// PUT ?mes=     -> body {dias: {...}}: sustituye los días que vienen y deja el resto del mes

const json = (d, status = 200) => new Response(JSON.stringify(d), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8' },
});
const MES = /^\d{4}-(0[1-9]|1[0-2])$/;
const FRANJA = /^([01]\d|2[0-3]):[03]0$/;

export async function onRequest({ request, env }) {
  const kv = env.BBDD;
  const url = new URL(request.url);
  const mes = url.searchParams.get('mes');
  const PRE = url.searchParams.get('tipo') === 'llam' ? 'up:llam:' : 'up:con:';
  if (mes && !MES.test(mes)) return json({ error: 'mes inválido' }, 400);
  const indice = async () => (await kv.get(PRE + 'index', 'json')) || [];

  if (request.method === 'GET') {
    if (!mes) return json(await indice());
    return json((await kv.get(PRE + mes, 'json')) || {});
  }

  if (request.method === 'PUT' && mes) {
    const body = await request.json();
    const datos = (await kv.get(PRE + mes, 'json')) || {};
    for (const [dia, franjas] of Object.entries(body.dias || {})) {
      if (!dia.startsWith(mes + '-') || !/^\d{4}-\d{2}-\d{2}$/.test(dia) || typeof franjas !== 'object') continue;
      const limpio = {};
      for (const [f, seg] of Object.entries(franjas)) {
        if (FRANJA.test(f) && Number.isFinite(+seg) && +seg > 0) limpio[f] = Math.round(+seg);
      }
      datos[dia] = limpio;
    }
    await kv.put(PRE + mes, JSON.stringify(datos));
    const segundos = Object.values(datos).reduce((s, fr) => s + Object.values(fr).reduce((a, b) => a + b, 0), 0);
    const idx = (await indice()).filter((i) => i.mes !== mes);
    idx.push({ mes, dias: Object.keys(datos).length, segundos, actualizado: Date.now() });
    idx.sort((a, b) => a.mes.localeCompare(b.mes));
    await kv.put(PRE + 'index', JSON.stringify(idx));
    return json({ ok: true });
  }

  return json({ error: 'Método no soportado' }, 405);
}
