// Lógica de cálculo de vueltas de BBDD. Sin dependencias: se usa en el
// navegador y se puede probar con Node (`node test/calc.test.mjs`).

export const NO_CONTACTO = ['R_ILOC01', 'R_ILOC02', 'R_TRA006'];
export const EXCLUSION = ['R_NOU_02', 'R_NOU_03', 'R_NOU_04'];

export function clasificar(key4) {
  const k = String(key4 ?? '').trim().toUpperCase();
  if (EXCLUSION.includes(k)) return 'exclusion';
  if (NO_CONTACTO.includes(k)) return 'no_contacto';
  return 'contacto';
}

// Upsell: las key4 son otras. Exclusión: key3 V_EXC008…V_EXC011 o las key4 de RBE.
// No contacto: key3 V_ILO002, key4txt de ilocalizado o key4 MS_ILO1…MS_ILO8. El resto, contacto.
// Sin key4txt ni key3 (commlogs antiguos) se clasifica como en RBE.
export const EXCLUSION_UP = ['V_EXC008', 'V_EXC009', 'V_EXC010', 'V_EXC011'];
export const NO_CONTACTO_UP = ['V_ILO002'];
export function clasificarUpsell(key4, txt, key3) {
  const k = String(key4 ?? '').trim().toUpperCase(), k3 = String(key3 ?? '').trim().toUpperCase();
  if (EXCLUSION.includes(k) || EXCLUSION_UP.includes(k3)) return 'exclusion';
  if (NO_CONTACTO_UP.includes(k3) || /ilocaliz/i.test(String(txt ?? '')) || /^MS_ILO/.test(k)) return 'no_contacto';
  return String(txt ?? '').trim() || k3 ? 'contacto' : clasificar(k);
}

// En commlogs ins_no viene con ceros a la izquierda (030567) y en la BBDD no (30567).
export function normId(v) {
  return String(v ?? '').trim().toUpperCase().replace(/\.0+$/, '').replace(/^0+(?=.)/, '');
}

// Acepta Date, 'YYYY-MM-DD[ hh:mm]', 'DD/MM/YYYY[ hh:mm]' o serial de Excel.
export function parseFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v === 'number') {
    // Serial de Excel: es la hora "de reloj", se construye en hora local.
    const u = new Date(Math.round((v - 25569) * 86400000));
    return new Date(u.getUTCFullYear(), u.getUTCMonth(), u.getUTCDate(), u.getUTCHours(), u.getUTCMinutes(), u.getUTCSeconds());
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return new Date(+m[3], +m[2] - 1, +m[1], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

export const isoDia = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Rango por defecto para una BBDD de mes `YYYY-MM`: desde el día 15 del mes
// anterior (a veces se empieza a llamar antes) hasta ayer, sin pasar del fin
// de mes de la BBDD.
export function rangoPorDefecto(mesBbdd, hoy = new Date()) {
  const [y, m] = mesBbdd.split('-').map(Number);
  const desde = new Date(y, m - 2, 15);
  const finMes = new Date(y, m, 0);
  const ayer = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate() - 1);
  const hasta = ayer < finMes ? ayer : finMes;
  return { desde: isoDia(desde), hasta: isoDia(hasta) };
}

/**
 * @param bbddIds  array de ids de instalación de la BBDD del mes
 * @param commlogs array de {id, fecha: Date, key4, tipo?} (tipo ya clasificado, p. ej. Upsell)
 * @param desde,hasta 'YYYY-MM-DD' (ambos incluidos)
 * @param desdePorId opcional {id: 'YYYY-MM-DD'}: cada instalación solo cuenta commlogs
 *        desde esa fecha (p. ej. su día de carga en TakeOver)
 */
export function calcular(bbddIds, commlogs, desde, hasta, desdePorId) {
  const inst = new Map();
  for (const raw of bbddIds) {
    const id = normId(raw);
    if (id && !inst.has(id)) inst.set(id, { id, logs: [], desde: '' });
  }
  if (desdePorId) {
    for (const [raw, d] of Object.entries(desdePorId)) {
      const it = inst.get(normId(raw));
      if (it && d) it.desde = d;
    }
  }

  let logsEnRango = 0, logsFueraBbdd = 0;
  const porDia = new Map();
  for (const c of commlogs) {
    if (!c.fecha) continue;
    const dia = isoDia(c.fecha);
    if (dia < desde || dia > hasta) continue;
    const it = inst.get(normId(c.id));
    if (!it) { logsFueraBbdd++; continue; }
    if (dia < it.desde) continue;
    logsEnRango++;
    it.logs.push({ fecha: c.fecha, dia, tipo: c.tipo || clasificar(c.key4), key4: c.key4 });
  }

  const detalle = [];
  for (const it of inst.values()) {
    it.logs.sort((a, b) => a.fecha - b.fecha);
    const excluida = it.logs.some((l) => l.tipo === 'exclusion');
    const iPrimerContacto = it.logs.findIndex((l) => l.tipo === 'contacto');
    const contactada = !excluida && iPrimerContacto >= 0;
    // Un intento es cualquier commlog de una instalación no excluida.
    const intentos = excluida ? 0 : it.logs.length;
    const noContacto = excluida ? 0 : it.logs.filter((l) => l.tipo === 'no_contacto').length;
    const ilocAntes = contactada ? iPrimerContacto : null;
    let estado = 'sin_intentos';
    if (excluida) estado = 'excluida';
    else if (contactada) estado = 'contactada';
    else if (intentos > 0) estado = 'ilocalizada';

    if (!excluida) {
      for (const l of it.logs) {
        const d = porDia.get(l.dia) || { dia: l.dia, contacto: 0, no_contacto: 0 };
        d[l.tipo]++;
        porDia.set(l.dia, d);
      }
    }

    detalle.push({
      id: it.id, estado, intentos, noContacto, ilocAntes,
      primerContacto: contactada ? isoDia(it.logs[iPrimerContacto].fecha) : '',
      ultimoLog: it.logs.length ? isoDia(it.logs[it.logs.length - 1].fecha) : '',
    });
  }

  const total = detalle.length;
  const excluidas = detalle.filter((d) => d.estado === 'excluida').length;
  const gestionables = detalle.filter((d) => d.estado !== 'excluida');
  const contactadas = gestionables.filter((d) => d.estado === 'contactada');
  const ilocalizadas = gestionables.filter((d) => d.estado === 'ilocalizada');
  const sinIntentos = gestionables.filter((d) => d.estado === 'sin_intentos');
  const totalIntentos = gestionables.reduce((s, d) => s + d.intentos, 0);

  const maxV = Math.max(5, ...gestionables.map((d) => d.intentos));
  // Vuelta N cubierta: la instalación tiene >= N intentos o ya está contactada
  // (una vez contactada no se vuelve a llamar).
  const vueltas = [];
  for (let n = 1; n <= Math.min(maxV, 15); n++) {
    const conN = gestionables.filter((d) => d.intentos >= n).length;
    const cubiertas = gestionables.filter((d) => d.intentos >= n || d.estado === 'contactada').length;
    vueltas.push({ n, conN, cubiertas, pct: gestionables.length ? cubiertas / gestionables.length : 0 });
  }
  const vueltasCompletas = vueltas.filter((v) => v.cubiertas === gestionables.length && v.cubiertas > 0).length;

  const distIntentos = bucket(gestionables.map((d) => d.intentos), 6);
  const distIlocAntes = bucket(contactadas.map((d) => d.ilocAntes), 5);
  // Intento en el que se contactó: 1º = sin ilocalizados previos, 2º = uno previo…
  const contactoEnIntento = bucket(contactadas.map((d) => d.ilocAntes), 4)
    .map((b, i) => ({ intento: i + 1, label: i === 4 ? '5º+' : `${i + 1}º`, n: b.n }));
  const cEn = (i) => contactoEnIntento[i - 1].n;

  return {
    resumen: {
      total, excluidas, gestionables: gestionables.length,
      contactadas: contactadas.length, ilocalizadas: ilocalizadas.length,
      sinIntentos: sinIntentos.length, totalIntentos,
      mediaIntentos: gestionables.length ? totalIntentos / gestionables.length : 0,
      mediaIlocAntes: contactadas.length
        ? contactadas.reduce((s, d) => s + d.ilocAntes, 0) / contactadas.length : 0,
      ilocAntesTotal: contactadas.reduce((s, d) => s + d.ilocAntes, 0),
      vueltasCompletas, logsEnRango, logsFueraBbdd,
      contacto1: cEn(1), contacto2: cEn(2), contacto3mas: cEn(3) + cEn(4) + cEn(5),
    },
    vueltas, distIntentos, distIlocAntes, contactoEnIntento,
    porDia: [...porDia.values()].sort((a, b) => (a.dia < b.dia ? -1 : 1)),
    detalle,
  };
}

// Agrupa valores enteros en 0..tope-1 y "tope+".
function bucket(vals, tope) {
  const out = Array.from({ length: tope + 1 }, (_, i) => ({ label: i === tope ? `${tope}+` : String(i), n: 0 }));
  for (const v of vals) out[Math.min(v, tope)].n++;
  return out;
}

/**
 * Actividad de un único día: solo se usan los commlogs de ese día (nada acumulado).
 * Las instalaciones con exclusión ese día no cuentan en el resto de medidas.
 */
export function delDia(bbddIds, commlogs, dia, desdePorId) {
  const r = calcular(bbddIds, commlogs, dia, dia, desdePorId);
  const s = r.resumen;
  const d = r.porDia[0] || { contacto: 0, no_contacto: 0 };
  const instLlamadas = s.contactadas + s.ilocalizadas;
  return {
    instLlamadas,
    contactadas: s.contactadas,
    ilocalizadas: s.ilocalizadas,
    llamadas: s.totalIntentos,
    contactos: d.contacto,
    noContacto: d.no_contacto,
    excluidas: s.excluidas,
    pctContactoDia: instLlamadas ? (100 * s.contactadas) / instLlamadas : 0,
    pctSobreBbdd: s.gestionables ? (100 * s.contactadas) / s.gestionables : 0,
    llamadasPorInst: instLlamadas ? s.totalIntentos / instLlamadas : 0,
  };
}
