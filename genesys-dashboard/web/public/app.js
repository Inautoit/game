"use strict";
// Dashboard Gestores: descarga el paquete de informes de BusinessObjects (/api/datos),
// lo cruza por gestor y por queue y lo pinta. Se refresca solo cada minuto.
//
// Qué aporta cada informe (y cada pestaña):
//   00.Servicio OP.Comerciales_6  (nivel servicio, por queue y franja de 30 min)
//     · LlamInbound  entrantes por Queue: recibidas, desbordadas, netas (Service Received), atendidas,
//                    abandonadas (en espera / en timbre / cortas), atendidas <20/<40/>60/>120 s,
//                    tiempo de espera hasta atender y tiempo hasta abandonar.
//     · TiemposInb   tiempos de atención entrante por skill: conversación, retención (hold), ACW,
//                    transferidas, consultas, RONA.
//     · TiemposOut   salientes por servicio: marcadas, conectadas, >3 s, tiempos de marcación,
//                    conversación, retención, ACW, transferencias.
//   Agent Group + Skill - v2.3_06 (por gestor, skill y franja)
//     · INBOUND      ofrecidas, atendidas, tiempo total, conversación, hold, ACW, consultas, transferidas, RONA.
//     · OUTBOUND     marcadas, conectadas, cortas <3 s, tiempo total, conversación, hold, ACW, transferencias.
//   Agent State (toda la compañía; se usa solo para los gestores del servicio)
//     · Agent States por franja: conectado, disponible, no disponible y motivos, % ocupación.
//     · Login Time   sesiones: hora de conexión y desconexión.
//   10.Agent_AUX (por gestor y día): tiempo logado, en espera, efectivo y cada pausa (descanso, formación,
//                admin, coaching, WC, apoyo sala, meeting, RRHH, reco. médico, sin tipo).
//   HistReport_Automarcador
//     · Registos gestionados  lo que el gestor ha codificado: campaña, intento, tiempo de gestión,
//                             resultado técnico y resultado de negocio (SD_BusinessCallResult).
//     · Llamadas              cada llamada: tiempo de marcación y duración.
//
// Gestores "del servicio" = los que tienen llamadas en las queues de OP.Comerciales (según Agent Group +
// Skill) o registros en el Automarcador.

const REFRESCO_MS = 60_000;
const $ = (s, r = document) => r.querySelector(s);

// ----------------------------------------------------------------- utilidades
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
// tiempo medio corto: m:ss
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
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
function franja(v) { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})\s*-/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }
function franjaDeHora(v) {
  const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(:\d{2})?$/);
  return m ? m[1].padStart(2, "0") + ":" + (Number(m[2]) < 30 ? "00" : "30") : null;
}
const idLimpio = (v) => String(v ?? "").trim().replace(/\.0$/, "");
const nombreLimpio = (v) => String(v ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();
const skillDeCola = (q) => String(q ?? "").trim().replace(/_Target_VQ$/i, "");
function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
const sumar = (m, k, v) => m.set(k, (m.get(k) ?? 0) + v);
const sumarObj = (dest, org) => { for (const k in org) if (typeof org[k] === "number") dest[k] = (dest[k] ?? 0) + org[k]; return dest; };
const franjaDe = (mapa, f, crear) => { let x = mapa.get(f); if (!x) mapa.set(f, (x = crear())); return x; };

// Hoja cruda -> {cols, norm, filas}. Detecta la fila de títulos y, si debajo hay otra fila de
// títulos (Month/Week/Day... o "----"), las combina.
function tabla(hoja) {
  const f = hoja?.filas ?? [];
  const h = f.findIndex((r) => r.filter((v) => v != null && v !== "").length >= 3);
  if (h < 0) return { cols: [], norm: [], filas: [] };
  let cabecera = [...f[h]];
  let ini = h + 1;
  const sig = f[h + 1];
  if (sig && sig.some((v) => v === "Month" || /^-{2,}$/.test(String(v ?? "")))) {
    const n = Math.max(cabecera.length, sig.length);
    cabecera = Array.from({ length: n }, (_, i) => cabecera[i] || sig[i] || "");
    ini = h + 2;
  }
  return { cols: cabecera, norm: cabecera.map(norm), filas: f.slice(ini) };
}
function col(t, ...patrones) {
  for (const p of patrones) { const i = t.norm.indexOf(norm(p)); if (i >= 0) return i; }
  for (const p of patrones) { const q = norm(p); const i = t.norm.findIndex((c) => c.includes(q)); if (i >= 0) return i; }
  return -1;
}
// {clave: "patrón de columna"} -> {clave: índice}
const indices = (t, mapa) => Object.fromEntries(Object.entries(mapa).map(([k, p]) => [k, Array.isArray(p) ? col(t, ...p) : col(t, p)]));
const val = (fila, i) => (i >= 0 ? fila[i] : undefined);
const nv = (fila, i) => num(val(fila, i));
const buscarInforme = (paquete, re) => paquete.informes.find((i) => re.test(i.informe));
const buscarHoja = (inf, re) => inf?.hojas.find((h) => re.test(h.nombre));

// ----------------------------------------------------------------- estructuras
const nuevaQueue = (nombre) => ({
  nombre, cola: null,
  // LlamInbound
  rec: 0, desb: 0, neto: 0, at: 0, ab: 0, abEsp: 0, abCorto: 0, abTimbre: 0, at20: 0, at40: 0, at60: 0, at120: 0, tEspera: 0, tAband: 0,
  // TiemposInb
  tiAt: 0, tiTransf: 0, tiConsult: 0, tiRona: 0, tTalk: 0, tHold: 0, tAcw: 0, tInb: 0,
  // TiemposOut
  marc: 0, con: 0, con3: 0, transfOut: 0, tDial: 0, tTalkOut: 0, tHoldOut: 0, tAcwOut: 0, tOut: 0,
  entFr: new Map(), salFr: new Map(), gestores: new Set(),
});
const nuevoPorSkill = () => ({
  of: 0, at: 0, tInb: 0, talk: 0, hold: 0, acw: 0, consult: 0, transf: 0, rona: 0,
  marc: 0, con: 0, cortas: 0, tOut: 0, talkOut: 0, holdOut: 0, acwOut: 0, dialT: 0, transfOut: 0,
});
const nuevaFranjaGestor = () => ({ ent: 0, sal: 0, marc: 0, auto: 0, activo: 0, listo: 0, noListo: 0 });
const MOTIVOS_EST = [["Descanso", "Not Ready Reason Time (Descanso)"], ["Formación", "Not Ready Reason Time (Formacion)"],
  ["Administrativo", "Not Ready Reason Time (Administrativo)"], ["Coaching", "Not Ready Reason Time (Coaching)"],
  ["Pausa", "Not Ready Reason Time (Pause)"], ["WC", "Not Ready Reason Time (Baño)"], ["Sin tipo", "T_Not_Ready_Sin_Tipo"]];
const MOTIVOS_AUX = [["Descanso", "T Total Descanso"], ["Formación", "T Total Form"], ["Administrativo", "T Total Admin"],
  ["Coaching", "T Total Coaching"], ["WC", "Tiempo WC"], ["Apoyo sala", "Tiempo Apoyo Sala"], ["Meeting", "Tiempo Meeting"],
  ["RRHH", "Tiempo RRHH"], ["Reco. médico", "Tiempo RecoMedico"], ["Sin tipo", "T Total Sin tipo"]];

// ----------------------------------------------------------------- procesado
function procesar(paquete) {
  const inf = {
    auto: buscarInforme(paquete, /automarcador/i),
    aux: buscarInforme(paquete, /agent_aux/i),
    estado: buscarInforme(paquete, /agent state/i),
    skill: buscarInforme(paquete, /agent group|skill/i),
    op: buscarInforme(paquete, /servicio op|op\.?comercial/i),
  };

  // ---- 1. Queues / skills del servicio (OP.Comerciales)
  const queues = new Map();
  const q = (n) => { n = String(n ?? "").trim(); if (!n) return null; let s = queues.get(n); if (!s) queues.set(n, (s = nuevaQueue(n))); return s; };

  const hLl = tabla(buscarHoja(inf.op, /llaminbound/i));
  if (hLl.filas.length) {
    const c = indices(hLl, { fr: "Interval", cola: "Queue", rec: "Received", desb: "Overflow", neto: "Service Received", at: "Accepted Agent",
      ab: "Total Abandoned", abEsp: "Abandoned Waiting", abCorto: "Abandoned Waiting ST1", abTimbre: "Abandoned Ring",
      at20: "Accepted < 20", at40: "Accepted < 40", at60: "Accepted > 60", at120: "Accepted > 120",
      tEspera: "Accept Time Agent", tAband: "Abandoned Waiting Time" });
    for (const r of hLl.filas) {
      const s = q(skillDeCola(val(r, c.cola))); if (!s) continue;
      s.cola = String(val(r, c.cola)).trim();
      const x = {};
      for (const k of ["rec", "desb", "neto", "at", "ab", "abEsp", "abCorto", "abTimbre", "at20", "at40", "at60", "at120", "tEspera", "tAband"]) x[k] = nv(r, c[k]);
      sumarObj(s, x);
      const f = franja(val(r, c.fr));
      if (f) sumarObj(franjaDe(s.entFr, f, () => ({})), x);
    }
  }
  const hTi = tabla(buscarHoja(inf.op, /tiemposinb/i));
  if (hTi.filas.length) {
    const c = indices(hTi, { s: "Gim Requiredskill", tiAt: "Accepted Agent", tiTransf: "Received Transfer", tiConsult: "Received Consult",
      tiRona: "RONA", tTalk: "Total Talk Time", tHold: "Total Hold Time", tAcw: "Total ACW Time", tInb: "Total Inbound Time" });
    for (const r of hTi.filas) {
      const s = q(val(r, c.s)); if (!s) continue;
      for (const k of ["tiAt", "tiTransf", "tiConsult", "tiRona", "tTalk", "tHold", "tAcw", "tInb"]) s[k] += nv(r, c[k]);
    }
  }
  const hTo = tabla(buscarHoja(inf.op, /tiemposout/i));
  if (hTo.filas.length) {
    const c = indices(hTo, { fr: "Interval", s: "Service Outbound Call", marc: "NDialing", con: "NOutbound", con3: "NOutbound>3",
      transfOut: "Made Transfered", tDial: "Total Dial Time", tTalkOut: "Total Talk Time", tHoldOut: "Total Hold Time",
      tAcwOut: "Total ACW Time", tOut: "Total Outbound Time" });
    for (const r of hTo.filas) {
      const s = q(val(r, c.s)); if (!s) continue;
      const x = {};
      for (const k of ["marc", "con", "con3", "transfOut", "tDial", "tTalkOut", "tHoldOut", "tAcwOut", "tOut"]) x[k] = nv(r, c[k]);
      sumarObj(s, x);
      const f = franja(val(r, c.fr));
      if (f) sumarObj(franjaDe(s.salFr, f, () => ({})), { marc: x.marc, con: x.con });
    }
  }
  const filtrar = queues.size > 0;

  // ---- 2. Gestores
  const gestores = new Map();
  const g = (id, nombre) => {
    id = idLimpio(id);
    if (!id) return null;
    let a = gestores.get(id);
    if (!a) {
      a = { id, nombre: "", servicio: false, porSkill: new Map(), franjas: new Map(),
            activo: 0, listo: 0, noListo: 0, occNum: 0, occDen: 0, entreLlamadas: 0, motivosEst: {},
            login: null, logout: null, conectado: false,
            auxLogin: 0, auxEspera: 0, auxEfectivo: 0, motivosAux: {}, pausasAux: 0,
            autoReg: 0, autoGestion: 0, autoCod: new Map(), autoLlamadas: 0, autoDur: 0, autoDial: 0 };
      gestores.set(id, a);
    }
    if (nombre && !a.nombre) a.nombre = nombreLimpio(nombre);
    return a;
  };
  const ps = (a, s) => franjaDe(a.porSkill, s, nuevoPorSkill);
  const frG = (a, f) => (f ? franjaDe(a.franjas, f, nuevaFranjaGestor) : null);

  const hIn = tabla(buscarHoja(inf.skill, /inbound/i));
  if (hIn.filas.length) {
    const c = indices(hIn, { fr: "Ind_Agent_001", nom: "Agent Name", id: "Employee ID", s: "Gim Requiredskill", of: "Ind_Agent_004",
      at: "Ind_Agent_006", tInb: "Ind_Agent_063", talk: "Ind_Agent_067", hold: "Ind_Agent_030", acw: "Ind_Agent_036",
      consult: "Ind_Agent_010", transf: "Ind_Serv_017", rona: "Ind_Serv_068" });
    for (const r of hIn.filas) {
      const sk = String(val(r, c.s) ?? "").trim();
      if (filtrar && !queues.has(sk)) continue;
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      a.servicio = true;
      const x = ps(a, sk);
      for (const k of ["of", "at", "tInb", "talk", "hold", "acw", "consult", "transf", "rona"]) x[k] += nv(r, c[k]);
      const y = frG(a, franja(val(r, c.fr))); if (y) y.ent += nv(r, c.at);
      if (nv(r, c.at) || nv(r, c.of)) queues.get(sk)?.gestores.add(a.id);
    }
  }
  const hOut = tabla(buscarHoja(inf.skill, /outbound/i));
  if (hOut.filas.length) {
    const c = indices(hOut, { fr: "Ind_Agent_001", nom: "Agent Name", id: "Employee ID", s: ["Agent Group", "Service Outbound Call"],
      marc: "Ind_Agent_015", con: "Ind_Agent_016", cortas: "Ind_Agent_017", tOut: "Ind_Agent_065", talkOut: "Ind_Agent_067",
      holdOut: "Ind_Agent_030", acwOut: "Ind_Agent_082", dialT: "Ind_Agent_034", transfOut: "Ind_Agent_014" });
    for (const r of hOut.filas) {
      const sk = String(val(r, c.s) ?? "").trim();
      if (filtrar && !queues.has(sk)) continue;
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      a.servicio = true;
      const x = ps(a, sk);
      for (const k of ["marc", "con", "cortas", "tOut", "talkOut", "holdOut", "acwOut", "dialT", "transfOut"]) x[k] += nv(r, c[k]);
      const y = frG(a, franja(val(r, c.fr))); if (y) { y.sal += nv(r, c.con); y.marc += nv(r, c.marc); }
      if (nv(r, c.marc) || nv(r, c.con)) queues.get(sk)?.gestores.add(a.id);
    }
  }

  // Automarcador: registros codificados + llamadas
  const campanas = new Map();
  const codigos = new Map();          // codificación -> nº registros (todas las campañas)
  const autoFr = new Map();
  const campanaDeLlamada = new Map(); // CALL_ID -> campaña
  let autoTotal = 0, autoGestion = 0;
  const hReg = tabla(buscarHoja(inf.auto, /registos|registros/i));
  if (hReg.filas.length) {
    const c = indices(hReg, { call: "CALL_ID", id: ["EmployeID", "Employee ID"], info: "AGENT_INFO", camp: "NameCampaign", t: "Manage Time",
      ini: "Start_Timestamp (Date Time)", cod: "SD_BusinessCallResult", intento: "attempt" });
    for (const r of hReg.filas) {
      const cod = String(val(r, c.cod) ?? "").trim() || "(sin codificar)";
      const t = nv(r, c.t);
      autoTotal++; autoGestion += t;
      sumar(codigos, cod, 1);
      const nomCamp = String(val(r, c.camp) ?? "(sin campaña)").trim();
      campanaDeLlamada.set(String(val(r, c.call) ?? ""), nomCamp);
      const k = franjaDe(campanas, nomCamp, () => ({ nombre: nomCamp, reg: 0, gestion: 0, intento2: 0, cod: new Map(), gestores: new Set(), llamadas: 0, dur: 0 }));
      k.reg++; k.gestion += t; if (nv(r, c.intento) > 1) k.intento2++;
      sumar(k.cod, cod, 1);
      const f = franjaDeHora(val(r, c.ini)); if (f) sumar(autoFr, f, 1);
      const info = String(val(r, c.info) ?? "");
      const a = g(val(r, c.id), info.includes(" - ") ? info.split(" - ").slice(1).join(" - ") : "");
      if (!a) continue;
      a.servicio = true;
      k.gestores.add(a.id);
      a.autoReg++; a.autoGestion += t;
      sumar(a.autoCod, cod, 1);
      const y = frG(a, f); if (y) y.auto++;
    }
  }
  const hCall = tabla(buscarHoja(inf.auto, /llamadas/i));
  let autoLlamadas = 0, autoDur = 0;
  if (hCall.filas.length) {
    const c = indices(hCall, { call: "CALL_ID", ag: "CAF_AgentName", src: "Source Address", dial: "Dial Time", dur: "Call Duration" });
    for (const r of hCall.filas) {
      autoLlamadas++; autoDur += nv(r, c.dur);
      const k = campanas.get(campanaDeLlamada.get(String(val(r, c.call) ?? "")));
      if (k) { k.llamadas++; k.dur += nv(r, c.dur); }
      const m = String(val(r, c.ag) ?? "").match(/\(([^)]+)\)\s*$/);
      const id = m ? m[1] : String(val(r, c.src) ?? "").split(" - ")[0];
      const a = gestores.get(idLimpio(id));
      if (a) { a.autoLlamadas++; a.autoDur += nv(r, c.dur); a.autoDial += nv(r, c.dial); }
    }
  }

  // Agent State y AUX: solo para completar a los gestores del servicio
  const delServicio = (id) => { const a = gestores.get(idLimpio(id)); return a && a.servicio ? a : null; };
  const hEst = tabla(buscarHoja(inf.estado, /agent states/i));
  if (hEst.filas.length) {
    const c = indices(hEst, { fr: "30 minutes", id: "Employee ID", act: "Active Time", nr: "Not Ready Time", rd: "Ready Time",
      occ: "Ind_Agent_073", entre: "Tiempo Entre Llamada" });
    const motivos = MOTIVOS_EST.map(([m, p]) => [m, col(hEst, p)]);
    for (const r of hEst.filas) {
      const a = delServicio(val(r, c.id)); if (!a) continue;
      const act = nv(r, c.act), rd = nv(r, c.rd), nr = nv(r, c.nr);
      a.activo += act; a.listo += rd; a.noListo += nr; a.entreLlamadas += nv(r, c.entre);
      if (c.occ >= 0 && act > 0) { a.occNum += nv(r, c.occ) * act; a.occDen += act; }
      for (const [m, i] of motivos) { const v = nv(r, i); if (v) a.motivosEst[m] = (a.motivosEst[m] ?? 0) + v; }
      const y = frG(a, franja(val(r, c.fr))); if (y) { y.activo += act; y.listo += rd; y.noListo += nr; }
    }
  }
  const hLog = tabla(buscarHoja(inf.estado, /login/i));
  if (hLog.filas.length) {
    const c = { id: col(hLog, "Employee ID"), fin: col(hLog, "Not Login Hour"),
                ini: hLog.norm.findIndex((x) => x.includes("login hour") && !x.includes("not login")) };
    for (const r of hLog.filas) {
      const a = delServicio(val(r, c.id)); if (!a) continue;
      const ini = val(r, c.ini), fin = val(r, c.fin);
      if (ini && (!a.login || ini < a.login)) a.login = ini;
      if (!fin) a.conectado = true; else if (!a.logout || fin > a.logout) a.logout = fin;
    }
  }
  const hAux = tabla(inf.aux?.hojas[0]);
  if (hAux.filas.length) {
    const c = indices(hAux, { id: "ID RH", login: "T Total Login", espera: "T Total Waiting", efectivo: "T Total Efectivo" });
    const motivos = MOTIVOS_AUX.map(([m, p]) => [m, col(hAux, p)]);
    for (const r of hAux.filas) {
      const a = delServicio(val(r, c.id)); if (!a) continue;
      a.auxLogin += nv(r, c.login); a.auxEspera += nv(r, c.espera); a.auxEfectivo += nv(r, c.efectivo);
      for (const [m, i] of motivos) { const v = nv(r, i); if (v) { a.motivosAux[m] = (a.motivosAux[m] ?? 0) + v; a.pausasAux += v; } }
    }
  }

  const lista = [...gestores.values()].filter((a) => a.servicio).map((a) => {
    const pausasEst = Object.values(a.motivosEst).reduce((s, v) => s + v, 0);
    const occ = a.occDen ? a.occNum / a.occDen : NaN;
    return {
      ...a,
      nombre: a.nombre || a.id,
      occ: occ > 1.5 ? occ / 100 : occ,       // % Occupancy viene en 0-1 o en 0-100
      enLlamada: Math.max(0, a.activo - a.listo - a.noListo),
      pausas: a.pausasAux || pausasEst,
      motivos: Object.keys(a.motivosAux).length ? a.motivosAux : a.motivosEst,
      pEfectivo: div(a.auxEfectivo, a.auxLogin),
    };
  });

  return { inf, gestores: lista, queues, campanas: [...campanas.values()], codigos, autoFr,
           autoTotal, autoGestion, autoLlamadas, autoDur };
}

// Totales de un gestor para la queue elegida ("" = todas sus queues) + derivados
function totalesGestor(a, skill) {
  const t = nuevoPorSkill();
  for (const [s, x] of a.porSkill) if (!skill || s === skill) sumarObj(t, x);
  return {
    ...t,
    pAtencion: div(t.at, t.of), aht: div(t.tInb, t.at), talkMed: div(t.talk, t.at), holdMed: div(t.hold, t.at), acwMed: div(t.acw, t.at),
    pConexion: div(t.con, t.marc), ahtOut: div(t.tOut, t.con), talkOutMed: div(t.talkOut, t.con), acwOutMed: div(t.acwOut, t.con),
  };
}

// ----------------------------------------------------------------- estado de la vista
let estado = {
  etag: null, datos: null, paquete: null, skill: "",
  orden: { gestores: ["at", -1], campanas: ["reg", -1], skills: ["rec", -1], matriz: ["total", -1], codif: ["autoReg", -1], pausas: ["pausas", -1] },
};
const graficos = {};
try { estado.skill = localStorage.getItem("skill") || ""; } catch {}

const etiqueta = (nombre) => estado.datos?.queues.get(nombre)?.cola || nombre;
function queuesSel() {
  const todos = [...estado.datos.queues.values()];
  return estado.skill ? todos.filter((s) => s.nombre === estado.skill) : todos;
}
function totalQueues() {
  const t = nuevaQueue("Todas");
  for (const s of queuesSel()) {
    sumarObj(t, s);
    for (const [f, e] of s.entFr) sumarObj(franjaDe(t.entFr, f, () => ({})), e);
    for (const [f, e] of s.salFr) sumarObj(franjaDe(t.salFr, f, () => ({})), e);
    for (const id of s.gestores) t.gestores.add(id);
  }
  return t;
}
function gestoresVista() {
  return estado.datos.gestores
    .filter((a) => !estado.skill || a.porSkill.has(estado.skill))
    .map((a) => ({ ...a, ...totalesGestor(a, estado.skill) }));
}

// ----------------------------------------------------------------- pintado: cabecera y KPIs
function kpi(titulo, valor, nota = "", ayuda = "") {
  return `<div class="kpi" ${ayuda ? `title="${esc(ayuda)}"` : ""}><div class="etiqueta">${esc(titulo)}</div><div class="valor">${valor}</div>${nota ? `<div class="nota">${nota}</div>` : ""}</div>`;
}
const bloque = (titulo, kpis) => `<div class="bloque"><h2>${esc(titulo)}</h2><div class="kpis">${kpis.join("")}</div></div>`;

function fechaDatos(inf) {
  const n = new Map();
  for (const h of inf.hojas)
    for (const fila of h.filas.slice(0, 400))
      for (const v of fila) { const m = /^(20\d\d-\d\d-\d\d)/.exec(v ?? ""); if (m) sumar(n, m[1], 1); }
  return [...n].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
}
const fmtFecha = (f) => (f ? f.slice(8, 10) + "/" + f.slice(5, 7) : "");

function pintarFrescura(paquete) {
  const hoy = hoyLocal();
  const deOtroDia = [];
  $("#frescura").innerHTML = paquete.informes.map((i) => {
    const min = (Date.now() - new Date(i.generado)) / 60000;
    const fd = fechaDatos(i);
    const otroDia = fd && fd !== hoy;
    if (otroDia) deOtroDia.push(`${i.informe} (datos del ${fmtFecha(fd)})`);
    const clase = otroDia || !String(i.generado).startsWith(hoy) ? "malo" : min <= 35 ? "ok" : min <= 90 ? "viejo" : "malo";
    const txt = otroDia ? `trae datos del ${fmtFecha(fd)}, no de hoy` : clase === "ok" ? "al día" : clase === "viejo" ? "con retraso" : "desactualizado";
    return `<span class="chip ${clase}" title="${esc(txt)}"><i aria-hidden="true"></i>${esc(i.informe)} · ${fmtHora(i.generado)}${otroDia ? ` · <b>datos del ${fmtFecha(fd)}</b>` : ""} <span class="sr">(${esc(txt)})</span></span>`;
  }).join("");
  const faltan = [["Automarcador", /automarcador/i], ["Agent AUX", /agent_aux/i], ["Agent State", /agent state/i],
                  ["Agent Group + Skill", /agent group|skill/i], ["OP.Comerciales", /servicio op|op\.?comercial/i]]
    .filter(([, re]) => !paquete.informes.some((i) => re.test(i.informe))).map(([m]) => m);
  const avisos = [];
  if (faltan.length) avisos.push(`Faltan informes en la última subida: ${faltan.join(", ")}.`);
  if (deOtroDia.length) avisos.push(`Estos informes no traen datos de hoy: ${deOtroDia.join(", ")}. Revisa sus filtros de fecha.`);
  $("#aviso").hidden = !avisos.length;
  $("#aviso").textContent = avisos.join(" ");
}

function pintarSelector() {
  const sel = $("#skill");
  const lista = [...estado.datos.queues.values()]
    .filter((s) => s.rec + s.marc + s.gestores.size > 0)
    .sort((a, b) => b.rec + b.marc - (a.rec + a.marc));
  if (estado.skill && !estado.datos.queues.has(estado.skill)) estado.skill = "";
  sel.innerHTML = `<option value="">Todas las queues (${lista.length})</option>` +
    lista.map((s) => `<option value="${esc(s.nombre)}">${esc(etiqueta(s.nombre))} · ${fmtN(s.rec)} ent. / ${fmtN(s.marc)} marc.</option>`).join("");
  sel.value = estado.skill;
  sel.classList.toggle("activo", !!estado.skill);
}

function pintarKpis() {
  const t = totalQueues();
  const d = estado.datos;
  const gs = gestoresVista();
  const sumG = (k) => gs.reduce((s, a) => s + (a[k] || 0), 0);
  const activo = sumG("activo"), listo = sumG("listo"), noListo = sumG("noListo"), enLlamada = sumG("enLlamada");
  const cod = [...d.codigos].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, k]) => `${esc(c)} ${fmtPct(k / d.autoTotal)}`).join(" · ");
  const sufijo = estado.skill ? ` · ${etiqueta(estado.skill)}` : "";
  $("#kpis").innerHTML = [
    bloque("Entrantes" + sufijo, [
      kpi("Recibidas netas", fmtN(t.neto), `${fmtN(t.rec)} recibidas · ${fmtN(t.desb)} desbordadas`, "Service Received = recibidas − desbordadas a otra cola"),
      kpi("Atendidas", fmtN(t.at), fmtPct(div(t.at, t.neto)) + " de las netas"),
      kpi("Abandonadas", fmtN(t.ab), `${fmtPct(div(t.ab, t.neto))} · ${fmtN(t.abCorto)} cortas`, "En espera + en timbre; cortas = abandonos muy rápidos (ST1)"),
      kpi("Nivel de servicio", fmtPct(div(t.at20, t.neto)), "atendidas en < 20 s", "Accepted < 20 / Service Received"),
      kpi("Espera media", fmtM(div(t.tEspera, t.at)), `${fmtN(t.at60)} esperaron > 60 s`, "Accept Time Agent / atendidas"),
      kpi("TMO entrante", fmtM(div(t.tInb, t.tiAt)), `conv. ${fmtM(div(t.tTalk, t.tiAt))} · ACW ${fmtM(div(t.tAcw, t.tiAt))}`, "Total Inbound Time / Accepted Agent (TiemposInb)"),
    ]),
    bloque("Salientes" + sufijo, [
      kpi("Marcadas", fmtN(t.marc), "", "NDialing (TiemposOut)"),
      kpi("Conectadas", fmtN(t.con), fmtPct(div(t.con, t.marc)) + " de las marcadas", "NOutbound"),
      kpi("Conectadas > 3 s", fmtN(t.con3), fmtPct(div(t.con3, t.con)) + " de las conectadas"),
      kpi("TMO saliente", fmtM(div(t.tOut, t.con)), `conv. ${fmtM(div(t.tTalkOut, t.con))} · ACW ${fmtM(div(t.tAcwOut, t.con))}`),
    ]),
    bloque("Automarcador · todas las campañas", [
      kpi("Registros codificados", fmtN(d.autoTotal), `${fmtN(d.autoLlamadas)} llamadas`),
      kpi("T. medio gestión", fmtM(div(d.autoGestion, d.autoTotal)), `llamada media ${fmtM(div(d.autoDur, d.autoLlamadas))}`),
      kpi("Codificaciones", fmtN(d.codigos.size), cod),
    ]),
    bloque("Gestores" + sufijo, [
      kpi("Gestores", fmtN(gs.length), `${fmtN(gs.filter((a) => a.conectado).length)} conectados ahora`),
      kpi("En llamada", fmtPct(div(enLlamada, activo)), "del tiempo conectado", "Conectado − disponible − no disponible (Agent State)"),
      kpi("Disponible", fmtPct(div(listo, activo)), "del tiempo conectado", "Ready Time / Active Time"),
      kpi("No disponible", fmtPct(div(noListo, activo)), "del tiempo conectado", "Not Ready Time / Active Time"),
    ]),
  ].join("");
}

// ----------------------------------------------------------------- gráficos
const franjasOrdenadas = (...mapas) => { const s = new Set(); for (const m of mapas) for (const k of m.keys()) s.add(k); return [...s].sort(); };
function opcionesGrafico({ apilado = false, porcentaje = false, horizontal = false } = {}) {
  const texto = css("--text-secondary"), rejilla = css("--grid");
  const fmt = (v) => (porcentaje ? fmtPct(v) : fmtD(v));
  const ejeValor = { stacked: apilado, beginAtZero: true, grid: { color: rejilla }, border: { display: false },
    ticks: { color: texto, precision: porcentaje ? undefined : 0, callback: porcentaje ? (v) => Math.round(v * 100) + " %" : undefined },
    ...(porcentaje ? { max: 1 } : {}) };
  const ejeCat = { stacked: apilado, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } };
  return {
    responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? "y" : "x",
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { display: !horizontal, position: "top", align: "start", labels: { color: texto, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmt(horizontal ? c.parsed.x : c.parsed.y)}` } },
    },
    scales: horizontal ? { x: ejeValor, y: { ...ejeCat, ticks: { color: texto } } } : { x: ejeCat, y: ejeValor },
  };
}
// Colores corporativos: rojo de marca, gris antracita y gris medio (discontinuo en líneas)
function grafico(id, tipo, etiquetas, series, opciones = {}) {
  if (!window.Chart) return;
  const porDefecto = ["--c-marca", "--c-oscuro", "--c-gris"];
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data,
    borderColor: css(s.color ?? porDefecto[i]), backgroundColor: css(s.color ?? porDefecto[i]),
    borderDash: tipo === "line" && s.discontinua ? [6, 4] : [],
    borderWidth: tipo === "line" ? 2 : 0, pointRadius: 0, pointHoverRadius: 5, tension: 0.25,
    borderRadius: 4, borderSkipped: "start", maxBarThickness: 22,
  }));
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), { type: tipo, data: { labels: etiquetas, datasets }, options: opcionesGrafico(opciones) });
}
function pintarGraficos() {
  const t = totalQueues();
  const d = estado.datos;
  const nom = estado.skill ? etiqueta(estado.skill) : null;

  const fe = franjasOrdenadas(t.entFr);
  $("#g-entrantes-sub").textContent = nom ? `Queue ${nom}` : "Todas las queues del servicio (00.Servicio OP.Comerciales)";
  grafico("g-entrantes", "line", fe, [
    { label: "Recibidas netas", data: fe.map((f) => t.entFr.get(f).neto ?? 0), color: "--c-oscuro" },
    { label: "Atendidas", data: fe.map((f) => t.entFr.get(f).at ?? 0), color: "--c-marca" },
    { label: "Abandonadas", data: fe.map((f) => t.entFr.get(f).ab ?? 0), color: "--c-gris", discontinua: true },
  ]);
  grafico("g-ns", "bar", fe, [
    { label: "Nivel de servicio", data: fe.map((f) => { const e = t.entFr.get(f); return e.neto ? e.at20 / e.neto : null; }), color: "--c-marca" },
  ], { porcentaje: true });

  const auto = nom ? new Map() : d.autoFr;
  const fs = franjasOrdenadas(t.salFr, auto);
  $("#g-salientes-sub").textContent = nom ? `Queue ${nom} (TiemposOut)` : "Marcadas y conectadas del servicio (TiemposOut) y registros del automarcador";
  const series = [
    { label: "Marcadas", data: fs.map((f) => t.salFr.get(f)?.marc ?? 0), color: "--c-oscuro" },
    { label: "Conectadas", data: fs.map((f) => t.salFr.get(f)?.con ?? 0), color: "--c-marca" },
  ];
  if (!nom) series.push({ label: "Registros automarcador", data: fs.map((f) => auto.get(f) ?? 0), color: "--c-gris" });
  grafico("g-salientes", "bar", fs, series);

  // Estado de los gestores de la vista: media de gestores en cada estado por franja
  const est = new Map();
  for (const a of gestoresVista()) {
    for (const [f, x] of a.franjas) {
      if (!x.activo) continue;
      const e = franjaDe(est, f, () => ({ llamada: 0, listo: 0, noListo: 0 }));
      e.llamada += Math.max(0, x.activo - x.listo - x.noListo) / 1800; e.listo += x.listo / 1800; e.noListo += x.noListo / 1800;
    }
  }
  const fz = franjasOrdenadas(est);
  $("#g-estados-sub").textContent = `Gestores medios en cada estado (Agent State)${nom ? " · gestores de " + nom : ""}`;
  grafico("g-estados", "bar", fz, [
    { label: "En llamada", data: fz.map((f) => est.get(f).llamada), color: "--c-marca" },
    { label: "Disponible", data: fz.map((f) => est.get(f).listo), color: "--c-gris" },
    { label: "No disponible", data: fz.map((f) => est.get(f).noListo), color: "--c-oscuro" },
  ], { apilado: true });
}

// ----------------------------------------------------------------- tablas
function pintarTabla(idTabla, clave, columnas, filas, alClicar) {
  const [campo, dir] = estado.orden[clave];
  const c = columnas.find((x) => x.k === campo) ?? columnas[0];
  const ordenadas = [...filas].sort((a, b) => {
    const va = c.orden ? c.orden(a) : a[c.k], vb = c.orden ? c.orden(b) : b[c.k];
    if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? ""), "es") * dir;
    return ((Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity)) * dir;
  });
  const t = document.getElementById(idTabla);
  t.innerHTML =
    `<thead><tr>${columnas.map((x) => `<th scope="col" data-k="${esc(x.k)}" class="${x.cls ?? (x.txt ? "txt" : "")}" ${x.k === campo ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""} title="${esc(x.ayuda ?? x.t)}">${esc(x.t)}</th>`).join("")}</tr></thead>` +
    `<tbody>${ordenadas.map((f, i) => `<tr data-i="${i}" class="${alClicar ? "clic" : ""} ${f._sel ? "sel" : ""}">${columnas.map((x) => `<td class="${x.celda ? x.celda(f) : x.txt ? "txt" : ""}" ${x.estilo ? `style="${x.estilo(f)}"` : ""}>${x.f ? x.f(f) : esc(f[x.k])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k, cc = columnas.find((x) => x.k === k);
    estado.orden[clave] = [k, estado.orden[clave][0] === k ? -estado.orden[clave][1] : (cc.txt ? 1 : -1)];
    pintarTabla(idTabla, clave, columnas, filas, alClicar);
  }));
  if (alClicar) t.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => alClicar(ordenadas[Number(tr.dataset.i)])));
}

const cero = (v, f) => (v ? f(v) : `<span class="cero">${f(0)}</span>`);
const cN = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => cero(a[k], fmtN) });
const cM = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => fmtM(a[k]) });
const cT = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => cero(a[k], fmtT) });
const cP = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => fmtPct(a[k]) });
const celdaGestor = (a) => `<div class="nombre">${esc(a.nombre)}</div><div class="id">${esc(a.id)}</div>`;
const COL_GESTOR = { k: "nombre", t: "Gestor", txt: true, f: celdaGestor };
const COL_ESTADO = { k: "conectado", t: "Estado", txt: true, orden: (a) => (a.conectado ? 1 : 0),
  f: (a) => `<span class="estado ${a.conectado ? "on" : "off"}"><i aria-hidden="true"></i>${a.conectado ? "Conectado" : a.logout ? "Desconectado " + fmtHora(a.logout) : "–"}</span>` };

function columnasGestores(vista) {
  const colQueues = { k: "qs", t: estado.skill ? "Queue" : "Queues", txt: true, orden: (a) => a.porSkill.size,
    f: (a) => { const l = estado.skill ? etiqueta(estado.skill) : [...a.porSkill.keys()].map(etiqueta).join(", ");
                return `<div class="skills-lista" title="${esc(l)}">${esc(l || "–")}</div>`; } };
  switch (vista) {
    case "entrantes": return [COL_GESTOR,
      cN("of", "Ofrecidas", "N Entered"), cN("at", "Atendidas", "N Answer"), cP("pAtencion", "% atención", "Atendidas / ofrecidas"),
      cM("aht", "TMO", "T Total Inbound / atendidas"), cM("talkMed", "Conversación media"), cM("holdMed", "Retención media", "Hold"),
      cM("acwMed", "ACW medio", "Tiempo de postllamada"), cN("consult", "Consultas recibidas"), cN("transf", "Transferidas recibidas"), cN("rona", "RONA", "Ofrecidas y no contestadas")];
    case "salientes": return [COL_GESTOR,
      cN("marc", "Marcadas", "N Dialing"), cN("con", "Conectadas", "N Outbound"), cP("pConexion", "% conexión"), cN("cortas", "Cortas < 3 s"),
      cM("ahtOut", "TMO saliente", "T Total Outbound / conectadas"), cM("talkOutMed", "Conversación media"), cM("acwOutMed", "ACW medio"),
      cT("dialT", "T. marcación"), cN("transfOut", "Transferencias")];
    case "auto": {
      const top = [...estado.datos.codigos].sort((a, b) => b[1] - a[1]).map(([c]) => c);
      return [COL_GESTOR, cN("autoReg", "Registros"), cN("autoLlamadas", "Llamadas"),
        { k: "gm", t: "T. medio gestión", orden: (a) => div(a.autoGestion, a.autoReg), f: (a) => fmtM(div(a.autoGestion, a.autoReg)) },
        { k: "lm", t: "Llamada media", orden: (a) => div(a.autoDur, a.autoLlamadas), f: (a) => fmtM(div(a.autoDur, a.autoLlamadas)) },
        ...top.map((c) => ({ k: "c:" + c, t: c, orden: (a) => a.autoCod.get(c) ?? 0, f: (a) => cero(a.autoCod.get(c) ?? 0, fmtN) }))];
    }
    case "tiempos": {
      const mot = ["Descanso", "Formación", "Administrativo", "Coaching", "WC", "Apoyo sala", "Meeting", "Sin tipo"];
      return [COL_GESTOR, COL_ESTADO, cT("activo", "Conectado", "Active Time"), cT("enLlamada", "En llamada"), cT("listo", "Disponible"),
        cT("noListo", "No disponible"), cP("occ", "Ocupación"), cT("auxEfectivo", "Efectivo (AUX)"), cP("pEfectivo", "% efectivo", "T Total Efectivo / T Total Login"),
        ...mot.map((m) => ({ k: "m:" + m, t: m, orden: (a) => a.motivos[m] ?? 0, f: (a) => cero(a.motivos[m] ?? 0, fmtT) }))];
    }
    default: return [COL_GESTOR, COL_ESTADO,
      { k: "login", t: "1ª conexión", f: (a) => fmtHora(a.login), orden: (a) => a.login ?? "" }, colQueues,
      cN("at", "Entrantes", "Atendidas"), cM("aht", "TMO ent."), cN("con", "Salientes", "Conectadas"), cM("ahtOut", "TMO sal."),
      cN("autoReg", "Automarcador", "Registros codificados"),
      cT("activo", "Conectado"), cP("occ", "Ocupación"), cT("pausas", "Pausas")];
  }
}

function filtroTexto(lista, q) {
  q = norm(q);
  return q ? lista.filter((a) => norm(a.nombre).includes(q) || norm(a.id).includes(q)) : lista;
}
function gestoresFiltrados() {
  let l = filtroTexto(gestoresVista(), $("#buscar").value);
  if ($("#solo-conectados").checked) l = l.filter((a) => a.conectado);
  return l;
}
const vistaGestores = () => document.querySelector('input[name="vista"]:checked').value;
function pintarGestores() {
  const filas = gestoresFiltrados();
  $("#cuenta-gestores").textContent = `${filas.length} gestores${estado.skill ? " en " + etiqueta(estado.skill) : ""}`;
  pintarTabla("t-gestores", "gestores", columnasGestores(vistaGestores()), filas, abrirDetalle);
}

function calor(valor, max) {
  return valor ? `background: rgb(${css("--heat")} / ${(0.08 + 0.5 * (valor / Math.max(1, max))).toFixed(2)})` : "";
}
function pintarMatriz() {
  const metrica = document.querySelector('input[name="metrica"]:checked').value;
  const v = (x) => (x ? (metrica === "ent" ? x.at : metrica === "sal" ? x.con : x.at + x.con) : 0);
  const gs = filtroTexto(estado.datos.gestores, $("#buscar-m").value);
  const volumen = new Map();
  for (const a of estado.datos.gestores) for (const [s, x] of a.porSkill) sumar(volumen, s, v(x));
  const cs = [...volumen].filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const filas = gs.map((a) => {
    const f = { ...a, total: 0 };
    for (const s of cs) { const k = v(a.porSkill.get(s)); f["s:" + s] = k; f.total += k; }
    return f;
  }).filter((f) => f.total > 0);
  const max = Math.max(1, ...filas.flatMap((f) => cs.map((s) => f["s:" + s])));
  pintarTabla("t-matriz", "matriz", [
    COL_GESTOR,
    { k: "total", t: "Total", celda: () => "celda total", f: (f) => fmtN(f.total) },
    ...cs.map((s) => ({ k: "s:" + s, t: etiqueta(s), cls: "skill", celda: () => "celda", ayuda: etiqueta(s),
      estilo: (f) => calor(f["s:" + s], max), f: (f) => (f["s:" + s] ? fmtN(f["s:" + s]) : "") })),
  ], filas, abrirDetalle);
}

function pintarSkills() {
  const vista = document.querySelector('input[name="vista-q"]:checked').value;
  const filas = [...estado.datos.queues.values()]
    .filter((s) => s.rec + s.marc + s.gestores.size > 0)
    .map((s) => ({ ...s, ng: s.gestores.size, _sel: s.nombre === estado.skill,
      pAt: div(s.at, s.neto), pAb: div(s.ab, s.neto), ns: div(s.at20, s.neto), asa: div(s.tEspera, s.at), tAb: div(s.tAband, s.ab),
      aht: div(s.tInb, s.tiAt), talk: div(s.tTalk, s.tiAt), hold: div(s.tHold, s.tiAt), acw: div(s.tAcw, s.tiAt), pTransf: div(s.tiTransf, s.tiAt),
      pCon: div(s.con, s.marc), ahtOut: div(s.tOut, s.con), talkOut: div(s.tTalkOut, s.con), acwOut: div(s.tAcwOut, s.con), dialMed: div(s.tDial, s.marc) }));
  const colQ = { k: "nombre", t: "Queue", txt: true, orden: (s) => etiqueta(s.nombre), f: (s) => `<span class="nombre">${esc(etiqueta(s.nombre))}</span>` };
  const columnas = vista === "tiempos" ? [colQ,
      cN("tiAt", "Atendidas"), cM("aht", "TMO", "Total Inbound Time / atendidas"), cM("talk", "Conversación media"), cM("hold", "Retención media"),
      cM("acw", "ACW medio"), cN("tiTransf", "Transferidas"), cP("pTransf", "% transferidas"), cN("tiConsult", "Consultas"), cN("tiRona", "RONA"), cN("ng", "Gestores")]
    : vista === "salientes" ? [colQ,
      cN("marc", "Marcadas"), cN("con", "Conectadas"), cP("pCon", "% conexión"), cN("con3", "Conectadas > 3 s"), cM("dialMed", "Marcación media"),
      cM("ahtOut", "TMO saliente"), cM("talkOut", "Conversación media"), cM("acwOut", "ACW medio"), cN("transfOut", "Transferencias"), cN("ng", "Gestores")]
    : [colQ,
      cN("rec", "Recibidas"), cN("desb", "Desbordadas", "Overflow: enviadas a otra cola"), cN("neto", "Netas", "Service Received"), cN("at", "Atendidas"),
      cP("pAt", "% atención"), cN("ab", "Abandonadas"), cP("pAb", "% abandono"), cN("abCorto", "Aband. cortas", "Abandoned Waiting ST1"),
      cN("abTimbre", "Aband. en timbre", "Abandoned Ring"), cP("ns", "NS < 20 s", "Accepted < 20 / netas"), cM("asa", "Espera media", "Accept Time Agent / atendidas"),
      cN("at60", "Espera > 60 s"), cN("at120", "Espera > 120 s"), cM("tAb", "T. medio abandono"), cN("ng", "Gestores")];
  pintarTabla("t-skills", "skills", columnas, filas, (s) => elegirSkill(s.nombre === estado.skill ? "" : s.nombre));
}

function pintarCampanas() {
  const d = estado.datos;
  const cods = [...d.codigos].sort((a, b) => b[1] - a[1]);
  grafico("g-codif", "bar", cods.map(([c]) => c), [{ label: "Registros", data: cods.map(([, k]) => k), color: "--c-marca" }], { horizontal: true });
  pintarTabla("t-campanas", "campanas", [
    { k: "nombre", t: "Campaña", txt: true },
    cN("reg", "Registros"), cN("llamadas", "Llamadas"),
    { k: "i2", t: "2º intento", orden: (k) => k.intento2, f: (k) => fmtN(k.intento2) },
    { k: "tm", t: "T. medio gestión", orden: (k) => div(k.gestion, k.reg), f: (k) => fmtM(div(k.gestion, k.reg)) },
    { k: "lm", t: "Llamada media", orden: (k) => div(k.dur, k.llamadas), f: (k) => fmtM(div(k.dur, k.llamadas)) },
    { k: "ng", t: "Gestores", orden: (k) => k.gestores.size, f: (k) => fmtN(k.gestores.size) },
  ], d.campanas);
  const gs = d.gestores.filter((a) => a.autoReg > 0);
  const max = Math.max(1, ...gs.flatMap((a) => [...a.autoCod.values()]));
  pintarTabla("t-codif-gestor", "codif", [
    COL_GESTOR,
    { k: "autoReg", t: "Registros", celda: () => "celda total", f: (a) => fmtN(a.autoReg) },
    ...cods.map(([c]) => ({ k: "c:" + c, t: c, cls: "skill", celda: () => "celda", orden: (a) => a.autoCod.get(c) ?? 0,
      estilo: (a) => calor(a.autoCod.get(c) ?? 0, max), f: (a) => (a.autoCod.get(c) ? fmtN(a.autoCod.get(c)) : "") })),
  ], gs, abrirDetalle);
}

function pintarPausas() {
  const gs = gestoresVista().filter((a) => a.pausas > 0 || a.auxLogin > 0);
  const mot = [...new Set([...MOTIVOS_AUX, ...MOTIVOS_EST].map(([m]) => m))].filter((m) => gs.some((a) => a.motivos[m]));
  const max = Math.max(1, ...gs.flatMap((a) => mot.map((m) => a.motivos[m] ?? 0)));
  const base = (a) => a.auxLogin || a.activo;
  pintarTabla("t-pausas", "pausas", [
    COL_GESTOR,
    { k: "auxLogin", t: "Logado", celda: () => "celda", orden: base, f: (a) => fmtT(base(a)) },
    { k: "pausas", t: "Total pausas", celda: () => "celda total", f: (a) => fmtT(a.pausas) },
    { k: "pp", t: "% pausas", celda: () => "celda", orden: (a) => div(a.pausas, base(a)), f: (a) => fmtPct(div(a.pausas, base(a))) },
    ...mot.map((m) => ({ k: "m:" + m, t: m, cls: "skill", celda: () => "celda", orden: (a) => a.motivos[m] ?? 0,
      estilo: (a) => calor(a.motivos[m] ?? 0, max), f: (a) => (a.motivos[m] ? fmtT(a.motivos[m]) : "") })),
  ], gs, abrirDetalle);
}

// ----------------------------------------------------------------- detalle del gestor
function abrirDetalle(sel) {
  if (!sel) return;
  const a = estado.datos.gestores.find((x) => x.id === sel.id);
  if (!a) return;
  const t = totalesGestor(a, "");
  $("#d-nombre").textContent = a.nombre;
  $("#d-sub").textContent = `ID ${a.id} · ${a.conectado ? "Conectado" : "Desconectado"}${a.login ? " · 1ª conexión " + fmtHora(a.login) : ""}${a.logout && !a.conectado ? " · última desconexión " + fmtHora(a.logout) : ""}`;
  const pausas = Object.entries(a.motivos).sort((x, y) => y[1] - x[1]).map(([m, v]) => `${m} ${fmtT(v)}`).join(" · ");
  $("#d-kpis").innerHTML = [
    bloque("Entrantes", [kpi("Atendidas", fmtN(t.at), `${fmtN(t.of)} ofrecidas · ${fmtPct(t.pAtencion)}`),
      kpi("TMO", fmtM(t.aht), `conv. ${fmtM(t.talkMed)} · hold ${fmtM(t.holdMed)} · ACW ${fmtM(t.acwMed)}`),
      kpi("Transf. / consultas", `${fmtN(t.transf)} / ${fmtN(t.consult)}`, `RONA ${fmtN(t.rona)}`)]),
    bloque("Salientes", [kpi("Conectadas", fmtN(t.con), `${fmtN(t.marc)} marcadas · ${fmtPct(t.pConexion)}`),
      kpi("TMO", fmtM(t.ahtOut), `conv. ${fmtM(t.talkOutMed)} · ACW ${fmtM(t.acwOutMed)}`),
      kpi("Cortas < 3 s", fmtN(t.cortas), `${fmtN(t.transfOut)} transferencias`)]),
    bloque("Automarcador", [kpi("Registros", fmtN(a.autoReg), `${fmtN(a.autoLlamadas)} llamadas`),
      kpi("T. medio gestión", fmtM(div(a.autoGestion, a.autoReg)), `llamada media ${fmtM(div(a.autoDur, a.autoLlamadas))}`)]),
    bloque("Tiempos", [kpi("Conectado", fmtT(a.activo), `en llamada ${fmtT(a.enLlamada)} · disponible ${fmtT(a.listo)}`),
      kpi("Ocupación", fmtPct(a.occ), `% efectivo ${fmtPct(a.pEfectivo)}`),
      kpi("Pausas", fmtT(a.pausas), esc(pausas))]),
  ].join("");

  const porSkill = [...a.porSkill].map(([s, x]) => ({ s, ...x })).sort((p, r) => r.at + r.con - (p.at + p.con));
  $("#t-detalle-skill").innerHTML =
    `<thead><tr><th>Queue</th><th>Ofrecidas</th><th>Atendidas</th><th>TMO ent.</th><th>Hold medio</th><th>ACW medio</th><th>RONA</th><th>Marcadas</th><th>Conectadas</th><th>TMO sal.</th></tr></thead><tbody>` +
    (porSkill.length ? porSkill.map((x) => `<tr><td>${esc(etiqueta(x.s))}</td><td>${fmtN(x.of)}</td><td>${fmtN(x.at)}</td><td>${fmtM(div(x.tInb, x.at))}</td><td>${fmtM(div(x.hold, x.at))}</td><td>${fmtM(div(x.acw, x.at))}</td><td>${fmtN(x.rona)}</td><td>${fmtN(x.marc)}</td><td>${fmtN(x.con)}</td><td>${fmtM(div(x.tOut, x.con))}</td></tr>`).join("")
      : `<tr><td colspan="10" class="txt muted">Sin llamadas en queues (solo automarcador).</td></tr>`) + `</tbody>`;

  const cods = [...a.autoCod].sort((x, y) => y[1] - x[1]);
  $("#d-auto").innerHTML = cods.length
    ? `<h3>Codificaciones del automarcador</h3><div class="tabla-scroll bajo"><table class="tabla"><thead><tr><th>Codificación</th><th>Registros</th><th>%</th></tr></thead><tbody>` +
      cods.map(([c, k]) => `<tr><td>${esc(c)}</td><td>${fmtN(k)}</td><td>${fmtPct(k / a.autoReg)}</td></tr>`).join("") + `</tbody></table></div>`
    : "";

  const fr = [...a.franjas.keys()].sort();
  $("#detalle").showModal();
  grafico("g-detalle", "bar", fr, [
    { label: "Entrantes", data: fr.map((f) => a.franjas.get(f).ent), color: "--c-marca" },
    { label: "Salientes", data: fr.map((f) => a.franjas.get(f).sal), color: "--c-oscuro" },
    { label: "Automarcador", data: fr.map((f) => a.franjas.get(f).auto), color: "--c-gris" },
  ]);
  $("#t-detalle").innerHTML =
    `<thead><tr><th>Franja</th><th>Conectado</th><th>En llamada</th><th>Disponible</th><th>No disponible</th><th>Entrantes</th><th>Marcadas</th><th>Conectadas</th><th>Automarcador</th></tr></thead><tbody>` +
    fr.map((f) => { const x = a.franjas.get(f); return `<tr><td>${f}</td><td>${fmtT(x.activo)}</td><td>${fmtT(Math.max(0, x.activo - x.listo - x.noListo))}</td><td>${fmtT(x.listo)}</td><td>${fmtT(x.noListo)}</td><td>${fmtN(x.ent)}</td><td>${fmtN(x.marc)}</td><td>${fmtN(x.sal)}</td><td>${fmtN(x.auto)}</td></tr>`; }).join("") +
    `</tbody>`;
}

// ----------------------------------------------------------------- orquestación
function pintarVista() {
  pintarKpis();
  pintarGraficos();
  pintarGestores();
  pintarMatriz();
  pintarSkills();
  pintarCampanas();
  pintarPausas();
}
function pintarTodo() {
  $("#subtitulo").textContent = `${new Date().toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · datos subidos a las ${fmtHora(estado.paquete.subido)}`;
  pintarFrescura(estado.paquete);
  pintarSelector();
  pintarVista();
}
function elegirSkill(s) {
  estado.skill = s;
  try { localStorage.setItem("skill", s); } catch {}
  $("#skill").value = s;
  $("#skill").classList.toggle("activo", !!s);
  pintarVista();
}

function descargarCsv() {
  const filas = gestoresFiltrados();
  const cab = ["ID", "Gestor", "Queue", "Estado", "Primera conexion", "Ofrecidas", "Atendidas", "TMO entrante (s)", "Hold medio (s)", "ACW medio (s)", "RONA",
               "Marcadas", "Conectadas", "TMO saliente (s)", "Automarcador registros", "Conectado (s)", "En llamada (s)",
               "Disponible (s)", "No disponible (s)", "Pausas (s)", "Ocupacion", "% efectivo"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const r = (v) => (Number.isFinite(v) ? Math.round(v) : "");
  const p = (v) => (Number.isFinite(v) ? v.toFixed(3) : "");
  const lineas = filas.map((a) => [a.id, a.nombre, estado.skill ? etiqueta(estado.skill) : [...a.porSkill.keys()].map(etiqueta).join(", "),
    a.conectado ? "Conectado" : "Desconectado", a.login ?? "", a.of, a.at, r(a.aht), r(a.holdMed), r(a.acwMed), a.rona, a.marc, a.con, r(a.ahtOut),
    a.autoReg, r(a.activo), r(a.enLlamada), r(a.listo), r(a.noListo), r(a.pausas), p(a.occ), p(a.pEfectivo)].map(q).join(";"));
  const blob = new Blob(["﻿" + [cab.map(q).join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `gestores_${estado.skill ? etiqueta(estado.skill) : "todas"}_${hoyLocal()}.csv` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------------------------------------------- carga y refresco
async function cargar() {
  try {
    const r = await fetch("/api/datos", { cache: "no-cache", credentials: "same-origin" });
    if (r.status === 401) return mostrarLogin();
    if (r.status === 404) { mostrarApp(); $("#subtitulo").textContent = "Todavía no se ha subido ningún informe desde el PC."; return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    mostrarApp();
    if (!estado.usuario) {
      fetch("/api/sesion", { cache: "no-store" }).then((x) => x.json()).then((x) => {
        estado.usuario = x.usuario; $("#usuario").textContent = x.usuario && x.usuario.includes("@") ? x.usuario : "";
      }).catch(() => {});
    }
    const etag = r.headers.get("ETag");
    if (etag && etag === estado.etag) { marcarRefresco(); return; }
    estado.paquete = await r.json();
    estado.datos = procesar(estado.paquete);
    estado.etag = etag;
    pintarTodo();
    marcarRefresco();
  } catch (e) {
    $("#refresco").textContent = "Error al actualizar: " + e.message + " (se reintenta en 1 min)";
  }
}
function marcarRefresco() { $("#refresco").textContent = "Comprobado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); }
async function mostrarLogin() {
  $("#app").hidden = true; $("#login").hidden = false;
  let sesion = { modo: "clave" };
  try { sesion = await (await fetch("/api/sesion", { cache: "no-store" })).json(); } catch {}
  const ms = sesion.modo === "microsoft";
  $("#login-ms").hidden = !ms; $("#form-login").hidden = ms;
  if (!ms) $("#clave").focus();
}
function mostrarApp() { $("#login").hidden = true; $("#app").hidden = false; }

// ----------------------------------------------------------------- eventos
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
  if (r.ok) { $("#clave").value = ""; cargar(); } else $("#login-error").textContent = "Clave incorrecta.";
});
$("#salir").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); estado.etag = null; estado.usuario = null; mostrarLogin(); });
{ // error que devuelve el inicio de sesion con Microsoft (/?error=...)
  const q = new URLSearchParams(location.search);
  if (q.has("error")) { $("#login-error").textContent = q.get("error"); history.replaceState(null, "", "/"); }
}
$("#skill").addEventListener("change", (e) => estado.datos && elegirSkill(e.target.value));
$("#buscar").addEventListener("input", () => estado.datos && pintarGestores());
$("#solo-conectados").addEventListener("change", () => estado.datos && pintarGestores());
$("#buscar-m").addEventListener("input", () => estado.datos && pintarMatriz());
document.querySelectorAll('input[name="metrica"]').forEach((r) => r.addEventListener("change", () => estado.datos && pintarMatriz()));
document.querySelectorAll('input[name="vista"]').forEach((r) => r.addEventListener("change", () => estado.datos && pintarGestores()));
document.querySelectorAll('input[name="vista-q"]').forEach((r) => r.addEventListener("change", () => estado.datos && pintarSkills()));
$("#csv").addEventListener("click", () => estado.datos && descargarCsv());
$("#d-cerrar").addEventListener("click", () => $("#detalle").close());
$("#detalle").addEventListener("click", (e) => { if (e.target === $("#detalle")) $("#detalle").close(); });
document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.pestana; });
}));
$("#tema").addEventListener("click", () => {
  const actual = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const nuevo = actual === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem("tema", nuevo); } catch {}
  if (estado.datos) pintarVista();
});
try { const t = localStorage.getItem("tema"); if (t) document.documentElement.dataset.theme = t; } catch {}

cargar();
setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
