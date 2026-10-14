// Competición TMK - datos comunes (configuración y cálculo). Lo usan tmk.js y tv.js.
//
// Usa los mismos informes que el dashboard general (los sube el PC cada 20 min):
//   · Agent Group + Skill - v2.3_06 / OUTBOUND  → cola TMK outbound por gestor y franja de 30 min
//   · HistReport_Automarcador                   → registros codificados y llamadas del automarcador
// "Hoy" sale del último paquete. "Acumulado" suma además los días guardados (el Worker guarda la
// última subida de cada día); el resumen de cada día cerrado se calcula una vez y se guarda.

// ============ CONFIGURACIÓN DE LA COMPETICIÓN ============
const CONFIG = {
  colasOut: ["RBE_Outbound_TMK"],   // skills de la cola outbound que cuentan (Service Outbound Call)
  // gestores que cuentan, por fechas: cada tramo vale desde su fecha hasta el siguiente
  gestoresPorFecha: [
    { desde: "2026-09-28", gestores: { AE0534: "Adrián Valero García", 356245: "Ángel Vidal Martín", 271471: "Carmen Zárate Sánchez",
                                       CK6293: "Carolina Pérez Martínez", CD7581: "Cristina María Muñiz Fernández", 289317: "Sheila Carrascosa Ambite" } },
    { desde: "2026-10-14", gestores: { 271471: "Carmen Zárate Sánchez", 289317: "Sheila Carrascosa Ambite", 356245: "Ángel Vidal Martín" } },
  ],
  campanasAuto: ["C_OC_RBE_Auto"], // campañas del automarcador que cuentan; vacío = todas
  desde: "2026-09-28",              // primer día de la competición "AAAA-MM-DD"; null = todos los guardados
  objetivoDia: null,                // objetivo de gestiones por día (número) o null
  inicio: "09:00", fin: "22:00",    // jornada, para la proyección cuando no hay día anterior con el que comparar
  // nombre corto de cada automarcador en pantalla
  etiquetas: { C_Vencimiento_Push_High: "High", C_OC_RBE_Auto: "RBE Auto" },
};
const etq = (c) => CONFIG.etiquetas[c] ?? c;
const diaLocalHoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
// gestores de la competición en un día concreto (AAAA-MM-DD); sin día = hoy
function gestoresDe(dia) {
  const d = dia || diaLocalHoy();
  const tramos = [...CONFIG.gestoresPorFecha].sort((a, b) => a.desde.localeCompare(b.desde));
  return (tramos.filter((t) => t.desde <= d).at(-1) ?? tramos[0]).gestores;
}
// todos los que han estado en algún momento (nombres para el acumulado)
const todosLosGestores = () => Object.assign({}, ...CONFIG.gestoresPorFecha.map((t) => t.gestores));
const vuelta = (n) => (n >= 3 ? "3+" : n >= 2 ? "2" : "1"); // columna "attempt" del automarcador
const nuevoAuto = () => ({ reg: 0, llam: 0, dur: 0, gest: 0, cod: {}, v: {} });
function sumarAuto(x, y) {
  for (const k of ["reg", "llam", "dur", "gest"]) x[k] += y[k];
  for (const [c, n] of Object.entries(y.cod)) sumar(x.cod, c, n);
  for (const [c, n] of Object.entries(y.v)) sumar(x.v, c, n);
  return x;
}
// ==========================================================

const REFRESCO_MS = 60_000;
const $ = (s, r = document) => r.querySelector(s);
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Math.round(n || 0).toLocaleString("es-ES");
const fmtD = (n, d = 1) => (Number.isFinite(n) ? n.toLocaleString("es-ES", { maximumFractionDigits: d }) : "–");
const fmtPct = (x) => (Number.isFinite(x) ? (x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " %" : "–");
const div = (a, b) => (b ? a / b : NaN);
function fmtT(seg) {
  if (!Number.isFinite(seg)) return "–";
  seg = Math.round(seg || 0);
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtM(seg) {
  if (!Number.isFinite(seg)) return "–";
  seg = Math.round(seg);
  return `${Math.floor(seg / 60)}:${String(seg % 60).padStart(2, "0")}`;
}
function fmtHora(v) {
  if (!v) return "–";
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d) ? String(v) : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
const fmtFecha = (f) => (f ? f.slice(8, 10) + "/" + f.slice(5, 7) : "");
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const franja = (v) => { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})\s*-/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; };
const franjaDeHora = (v) => { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(:\d{2})?$/); return m ? m[1].padStart(2, "0") + ":" + (Number(m[2]) < 30 ? "00" : "30") : null; };
const horaDe = (v) => String(v ?? "").match(/(\d{1,2}:\d{2})(:\d{2})?$/)?.[1] ?? "";
const diaDe = (v) => /^(20\d\d-\d\d-\d\d)/.exec(String(v ?? ""))?.[1] ?? "";
const idLimpio = (v) => String(v ?? "").trim().replace(/\.0$/, "");
const nombreLimpio = (v) => String(v ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const sumar = (o, k, v) => { o[k] = (o[k] ?? 0) + v; };
const enLista = (lista, v) => !lista.length || lista.some((x) => norm(x) === norm(v));

function tabla(hoja) {
  const f = hoja?.filas ?? [];
  const h = f.findIndex((r) => r.filter((v) => v != null && v !== "").length >= 3);
  if (h < 0) return { norm: [], filas: [] };
  let cab = [...f[h]], ini = h + 1;
  const sig = f[h + 1];
  if (sig && sig.some((v) => v === "Month" || /^-{2,}$/.test(String(v ?? "")))) {
    const n = Math.max(cab.length, sig.length);
    cab = Array.from({ length: n }, (_, i) => cab[i] || sig[i] || "");
    ini = h + 2;
  }
  return { norm: cab.map(norm), filas: f.slice(ini) };
}
function col(t, ...pat) {
  for (const p of pat) { const i = t.norm.indexOf(norm(p)); if (i >= 0) return i; }
  for (const p of pat) { const q = norm(p); const i = t.norm.findIndex((c) => c.includes(q)); if (i >= 0) return i; }
  return -1;
}
const indices = (t, m) => Object.fromEntries(Object.entries(m).map(([k, p]) => [k, Array.isArray(p) ? col(t, ...p) : col(t, p)]));
const val = (r, i) => (i >= 0 ? r[i] : undefined);
const nv = (r, i) => num(val(r, i));
const buscarInforme = (p, re) => p.informes.find((i) => re.test(i.informe));
const buscarHoja = (inf, re) => inf?.hojas.find((h) => re.test(h.nombre));

// La versión de la configuración forma parte de la clave de los resúmenes guardados: si se cambian
// las colas o campañas, los días cerrados se recalculan con el nuevo criterio.
const VERSION = "tmk5-" + [...JSON.stringify([CONFIG.colasOut, CONFIG.campanasAuto, CONFIG.gestoresPorFecha])].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

// ----------------------------------------------------------------- resumen de un paquete (un día)
const nuevoG = (nombre) => ({ n: nombre || "", marc: 0, con: 0, cortas: 0, tOut: 0, talk: 0, acw: 0,
  reg: 0, llam: 0, dur: 0, gest: 0, cod: {}, v: {}, camp: {} }); // camp: { campaña: nuevoAuto() }

function resumir(paquete, conRegistro) {
  const auto = buscarInforme(paquete, /automarcador/i);
  const skill = buscarInforme(paquete, /agent group|skill/i);
  const G = {}, fr = {}, camp = {};
  const permitidos = new Set(Object.keys(gestoresDe(paquete.dia)).map((x) => x.trim().toUpperCase())); // los de ese día
  const g = (id, nombre) => {
    id = idLimpio(id); if (!id) return null;
    if (permitidos.size && !permitidos.has(id.toUpperCase())) return null; // no es de la competición
    const a = (G[id] ??= nuevoG());
    if (nombre && !a.n) a.n = nombreLimpio(nombre);
    return a;
  };
  const F = (f) => (f ? (fr[f] ??= { marc: 0, con: 0, reg: 0, rc: {} }) : null);
  const registro = [], registroOut = [];
  let dia = "";

  // Cola TMK outbound (Agent Group + Skill / OUTBOUND)
  const hOut = tabla(buscarHoja(skill, /outbound/i));
  if (hOut.filas.length) {
    const c = indices(hOut, { fr: "Ind_Agent_001", d: "Day", nom: "Agent Name", id: "Employee ID", s: ["Agent Group", "Service Outbound Call"],
      marc: "Ind_Agent_015", con: "Ind_Agent_016", cortas: "Ind_Agent_017", tOut: "Ind_Agent_065", talk: "Ind_Agent_067", acw: "Ind_Agent_082" });
    for (const r of hOut.filas) {
      if (paquete.dia && c.d >= 0 && diaDe(val(r, c.d)) && diaDe(val(r, c.d)) !== paquete.dia) continue; // dia cerrado: solo ese dia
      const sk = String(val(r, c.s) ?? "").trim();
      if (!CONFIG.colasOut.some((x) => norm(x) === norm(sk))) continue;
      const marc = nv(r, c.marc), con = nv(r, c.con);
      if (!marc && !con) continue;
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      a.marc += marc; a.con += con; a.cortas += nv(r, c.cortas); a.tOut += nv(r, c.tOut); a.talk += nv(r, c.talk); a.acw += nv(r, c.acw);
      const f = franja(val(r, c.fr)); const y = F(f); if (y) { y.marc += marc; y.con += con; }
      const k = (camp["Cola " + sk] ??= { tipo: "cola", marc: 0, con: 0, reg: 0, llam: 0, dur: 0, gest: 0, gestores: {} });
      k.marc += marc; k.con += con; k.gestores[idLimpio(val(r, c.id))] = 1;
      dia ||= diaDe(val(r, c.d));
      if (conRegistro) registroOut.push({ f, id: idLimpio(val(r, c.id)), marc, con, cortas: nv(r, c.cortas), talk: nv(r, c.talk), tOut: nv(r, c.tOut) });
    }
  }

  // Automarcador: solo el día más reciente del informe y las campañas de la competición
  const durDe = new Map();
  const hCall = tabla(buscarHoja(auto, /llamadas/i));
  if (hCall.filas.length) {
    const c = indices(hCall, { call: "CALL_ID", dur: "Call Duration", ini: "Interaction beginning (Date Time)" });
    const d = paquete.dia || hCall.filas.reduce((m, r) => { const x = diaDe(val(r, c.ini)); return x > m ? x : m; }, "");
    for (const r of hCall.filas) if (!d || diaDe(val(r, c.ini)) === d) durDe.set(String(val(r, c.call) ?? ""), nv(r, c.dur));
  }
  // Hora de cada registro = End_Timestamp (cuando el gestor termina y codifica, junto a la llamada).
  // Start_Timestamp NO vale: es cuando el automarcador carga el registro, a veces una hora antes.
  const hReg = tabla(buscarHoja(auto, /registos|registros/i));
  if (hReg.filas.length) {
    const c = indices(hReg, { call: "CALL_ID", id: ["EmployeID", "Employee ID"], info: "AGENT_INFO", camp: "NameCampaign", t: "Manage Time",
      ini: ["End_Timestamp (Date Time)", "Start_Timestamp (Date Time)"], cod: "SD_BusinessCallResult", intento: "attempt" });
    const d = paquete.dia || hReg.filas.reduce((m, r) => { const x = diaDe(val(r, c.ini)); return x > m ? x : m; }, "");
    for (const r of hReg.filas) {
      if (d && diaDe(val(r, c.ini)) !== d) continue;
      const nomCamp = String(val(r, c.camp) ?? "").trim() || "(sin campaña)";
      if (!enLista(CONFIG.campanasAuto, nomCamp)) continue;
      const info = String(val(r, c.info) ?? "");
      const a = g(val(r, c.id), info.includes(" - ") ? info.split(" - ").slice(1).join(" - ") : ""); if (!a) continue;
      const cod = String(val(r, c.cod) ?? "").trim() || "(sin codificar)";
      const call = String(val(r, c.call) ?? "");
      const tieneLlamada = durDe.has(call), dur = durDe.get(call) ?? 0, t = nv(r, c.t);
      const vu = vuelta(nv(r, c.intento));
      const uno = { reg: 1, llam: tieneLlamada ? 1 : 0, dur: tieneLlamada ? dur : 0, gest: t, cod: { [cod]: 1 }, v: { [vu]: 1 } };
      sumarAuto(a, uno); sumarAuto((a.camp[nomCamp] ??= nuevoAuto()), uno);
      const y = F(franjaDeHora(val(r, c.ini))); if (y) { y.reg++; sumar(y.rc, nomCamp, 1); }
      const k = (camp[nomCamp] ??= { tipo: "auto", marc: 0, con: 0, reg: 0, llam: 0, dur: 0, gest: 0, gestores: {}, cod: {}, v: {} });
      k.reg++; k.gest += t; k.gestores[idLimpio(val(r, c.id))] = 1; sumar(k.cod, cod, 1); sumar(k.v, vu, 1);
      if (tieneLlamada) { k.llam++; k.dur += dur; }
      dia ||= d;
      if (conRegistro) registro.push({ hora: horaDe(val(r, c.ini)), id: idLimpio(val(r, c.id)), camp: nomCamp, cod,
        intento: nv(r, c.intento), gest: t, dur: tieneLlamada ? dur : null });
    }
  }
  for (const k of Object.values(camp)) k.gestores = Object.keys(k.gestores).length;
  return { v: VERSION, dia, subido: paquete.subido, G, fr, camp, registro, registroOut };
}

// Suma de resúmenes de varios días
function acumular(resumenes) {
  const G = {}, camp = {}, porDia = [];
  for (const r of resumenes) {
    const t = { dia: r.dia, con: 0, marc: 0, reg: 0, rc: {} };
    for (const [id, a] of Object.entries(r.G)) {
      const x = (G[id] ??= nuevoG(a.n));
      if (a.n && (!x.n || (!x.n.includes(",") && a.n.includes(",")))) x.n = a.n; // mejor "Apellidos, Nombre" (Genesys)
      for (const k of ["marc", "con", "cortas", "tOut", "talk", "acw"]) x[k] += a[k];
      sumarAuto(x, a);
      for (const [c, y] of Object.entries(a.camp)) { sumarAuto((x.camp[c] ??= nuevoAuto()), y); sumar(t.rc, c, y.reg); }
      t.con += a.con; t.marc += a.marc; t.reg += a.reg;
    }
    for (const [n, k] of Object.entries(r.camp)) {
      const x = (camp[n] ??= { tipo: k.tipo, marc: 0, con: 0, reg: 0, llam: 0, dur: 0, gest: 0, gestores: 0, cod: {}, v: {} });
      for (const [c, m] of Object.entries(k.v ?? {})) sumar(x.v, c, m);
      for (const q of ["marc", "con", "reg", "llam", "dur", "gest"]) x[q] += k[q];
      x.gestores = Math.max(x.gestores, k.gestores);
      for (const [c, m] of Object.entries(k.cod ?? {})) sumar(x.cod, c, m);
    }
    porDia.push(t);
  }
  return { G, camp, porDia };
}

// Resumen de un día guardado: se calcula una vez y se guarda en la web (/api/resumen)
async function resumenDia(dia) {
  const clave = `${VERSION}-${dia}`;
  const r = await fetch("/api/resumen?clave=" + encodeURIComponent(clave), { cache: "no-cache" });
  if (r.ok) return r.json();
  const p = await fetch("/api/datos?dia=" + dia, { cache: "no-cache" });
  if (!p.ok) return null;
  const paq = await p.json();
  paq.dia ||= dia;
  const res = resumir(paq, false);
  res.dia ||= dia;
  delete res.registro; delete res.registroOut;
  fetch("/api/resumen?clave=" + encodeURIComponent(clave), { method: "PUT", body: JSON.stringify(res) }).catch(() => {});
  return res;
}


// Series de la "carrera" (gestiones acumuladas por franja): hoy, cada uno de los otros días y su media.
// La usan /tmk y /tv para dibujar hoy en rojo y el resto de días en gris punteado.
function seriesCarrera(hoy, ultHoy, otros) {
  const g = (x) => (x ? x.con + x.reg : 0);
  const labels = [...new Set([hoy, ...otros].flatMap((d) => Object.keys(d?.fr ?? {}).filter((f) => g(d.fr[f]) > 0)))].sort();
  const acumulada = (d, hasta) => { let s = 0; return labels.map((f) => (hasta && f > hasta ? null : (s += g(d.fr?.[f])))); };
  const lineas = otros.map((d) => ({ dia: d.dia, data: acumulada(d) }));
  const media = lineas.length ? labels.map((_, i) => lineas.reduce((s, l) => s + l.data[i], 0) / lineas.length) : null;
  return { labels, hoy: hoy ? acumulada(hoy, ultHoy || "00:00") : null, lineas, media };
}
// Último día guardado anterior a "antesDe" que tuvo actividad (se salta festivos y días vacíos)
async function diaAnteriorConDatos(dias, antesDe, maxIntentos = 10) {
  const g = (x) => (x ? x.con + x.reg : 0);
  for (const d of dias.filter((x) => x < antesDe).reverse().slice(0, maxIntentos)) {
    const r = await resumenDia(d);
    if (r && Object.values(r.fr ?? {}).some((x) => g(x) > 0)) return r;
  }
  return null;
}
const conAlfa = (color, a) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(color).trim());
  if (!m) return color;
  const n = parseInt(m[1], 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
};
