"use strict";
// Dashboard Gestores: descarga el paquete de informes de BusinessObjects (/api/datos),
// lo cruza por gestor y por skill y lo pinta. Se refresca solo cada minuto.
//
// Gestores "del servicio" = los que tienen llamadas en los skills de 00.Servicio OP.Comerciales
// (según Agent Group + Skill) o registros en el Automarcador. Agent State y 10.Agent_AUX traen
// a toda la compañía: solo se usan para completar los datos de esos gestores.

const REFRESCO_MS = 60_000;
const $ = (s, r = document) => r.querySelector(s);

// ----------------------------------------------------------------- utilidades
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Math.round(n || 0).toLocaleString("es-ES");
const fmtPct = (x) => (Number.isFinite(x) ? (x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " %" : "–");
function fmtT(seg) {
  seg = Math.round(seg || 0);
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtHora(v) {
  if (!v) return "–";
  const d = new Date(String(v).replace(" ", "T"));
  return isNaN(d) ? String(v) : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// "2026-09-22 21:30-22:00" o "21:30-22:00" -> "21:30"
function franja(v) { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})\s*-/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }
// "2026-09-22 09:04:10" -> "09:00"
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

// Hoja cruda -> {cols, norm, filas}. Detecta la fila de títulos y, si debajo hay otra
// fila de títulos (Month/Week/Day... o "----"), las combina.
function tabla(hoja) {
  const f = hoja?.filas ?? [];
  const h = f.findIndex((r) => r.filter((v) => v != null && v !== "").length >= 3);
  if (h < 0) return { cols: [], norm: [], filas: [] };
  let cols = [...f[h]];
  let ini = h + 1;
  const sig = f[h + 1];
  if (sig && sig.some((v) => v === "Month" || /^-{2,}$/.test(String(v ?? "")))) {
    const n = Math.max(cols.length, sig.length);
    cols = Array.from({ length: n }, (_, i) => cols[i] || sig[i] || "");
    ini = h + 2;
  }
  return { cols, norm: cols.map(norm), filas: f.slice(ini) };
}
function col(t, ...patrones) {
  for (const p of patrones) { const i = t.norm.indexOf(norm(p)); if (i >= 0) return i; }
  for (const p of patrones) { const q = norm(p); const i = t.norm.findIndex((c) => c.includes(q)); if (i >= 0) return i; }
  return -1;
}
const val = (fila, i) => (i >= 0 ? fila[i] : undefined);
const buscarInforme = (paquete, re) => paquete.informes.find((i) => re.test(i.informe));
const buscarHoja = (inf, re) => inf?.hojas.find((h) => re.test(h.nombre));

// ----------------------------------------------------------------- procesado
function nuevoSkill(nombre) {
  return { nombre, recibidas: 0, atendidas: 0, abandonadas: 0, at20: 0, atInb: 0, tInb: 0, salientes: 0, marcadas: 0, tOut: 0,
           entFr: new Map(), salFr: new Map(), gestores: new Set() };
}
const nuevoPorSkill = () => ({ entOf: 0, entAt: 0, entT: 0, rona: 0, salMarc: 0, sal: 0, salT: 0 });

function procesar(paquete) {
  const inf = {
    auto: buscarInforme(paquete, /automarcador/i),
    aux: buscarInforme(paquete, /agent_aux/i),
    estado: buscarInforme(paquete, /agent state/i),
    skill: buscarInforme(paquete, /agent group|skill/i),
    op: buscarInforme(paquete, /servicio op|op\.?comercial/i),
  };

  // ---- 1. Skills del servicio (00.Servicio OP.Comerciales)
  const skills = new Map();
  const sk = (n) => { n = String(n ?? "").trim(); if (!n) return null; let s = skills.get(n); if (!s) skills.set(n, (s = nuevoSkill(n))); return s; };

  const hLl = tabla(buscarHoja(inf.op, /llaminbound/i));
  const colas = new Map();
  if (hLl.filas.length) {
    const c = { fr: col(hLl, "Interval"), cola: col(hLl, "Queue"), rec: col(hLl, "Received"), at: col(hLl, "Accepted Agent"),
                ab: col(hLl, "Total Abandoned"), at20: col(hLl, "Accepted < 20") };
    for (const r of hLl.filas) {
      const rec = num(val(r, c.rec)), at = num(val(r, c.at)), ab = num(val(r, c.ab)), a20 = num(val(r, c.at20));
      const cola = String(val(r, c.cola) ?? "–");
      const q = colas.get(cola) ?? { nombre: cola, skill: skillDeCola(cola), recibidas: 0, atendidas: 0, abandonadas: 0, at20: 0 };
      q.recibidas += rec; q.atendidas += at; q.abandonadas += ab; q.at20 += a20; colas.set(cola, q);
      const s = sk(skillDeCola(cola)); if (!s) continue;
      s.recibidas += rec; s.atendidas += at; s.abandonadas += ab; s.at20 += a20;
      const f = franja(val(r, c.fr));
      if (f) { const e = s.entFr.get(f) ?? { rec: 0, at: 0, ab: 0 }; e.rec += rec; e.at += at; e.ab += ab; s.entFr.set(f, e); }
    }
  }
  const hTi = tabla(buscarHoja(inf.op, /tiemposinb/i));
  if (hTi.filas.length) {
    const c = { s: col(hTi, "Gim Requiredskill"), at: col(hTi, "Accepted Agent"), t: col(hTi, "Total Inbound Time") };
    for (const r of hTi.filas) { const s = sk(val(r, c.s)); if (s) { s.atInb += num(val(r, c.at)); s.tInb += num(val(r, c.t)); } }
  }
  const hTo = tabla(buscarHoja(inf.op, /tiemposout/i));
  if (hTo.filas.length) {
    const c = { s: col(hTo, "Service Outbound Call"), sal: col(hTo, "NOutbound"), marc: col(hTo, "NDialing"), t: col(hTo, "Total Outbound Time") };
    for (const r of hTo.filas) { const s = sk(val(r, c.s)); if (s) { s.salientes += num(val(r, c.sal)); s.marcadas += num(val(r, c.marc)); s.tOut += num(val(r, c.t)); } }
  }
  const hayFiltroSkills = skills.size > 0; // sin OP.Comerciales no se filtra por skill

  // ---- 2. Gestores
  const gestores = new Map();
  const g = (id, nombre) => {
    id = idLimpio(id);
    if (!id) return null;
    let a = gestores.get(id);
    if (!a) {
      a = { id, nombre: "", servicio: false, activo: 0, listo: 0, noListo: 0, occNum: 0, occDen: 0,
            descanso: 0, formacion: 0, admin: 0, coaching: 0, pausasAux: 0, auxDetalle: {},
            login: null, logout: null, conectado: false, porSkill: new Map(),
            autoRegistros: 0, autoContactados: 0, autoGestion: 0, franjas: new Map() };
      gestores.set(id, a);
    }
    if (nombre && !a.nombre) a.nombre = nombreLimpio(nombre);
    return a;
  };
  const fr = (a, f) => {
    if (!f) return null;
    let x = a.franjas.get(f);
    if (!x) a.franjas.set(f, (x = { ent: 0, sal: 0, auto: 0, activo: 0, listo: 0, noListo: 0 }));
    return x;
  };
  const ps = (a, s) => { let x = a.porSkill.get(s); if (!x) a.porSkill.set(s, (x = nuevoPorSkill())); return x; };

  // Agent Group + Skill (entrantes por skill / salientes por grupo) -> define quién es del servicio
  const hIn = tabla(buscarHoja(inf.skill, /inbound/i));
  if (hIn.filas.length) {
    const c = { fr: col(hIn, "Ind_Agent_001"), nom: col(hIn, "Agent Name"), id: col(hIn, "Employee ID"), s: col(hIn, "Gim Requiredskill"),
                of: col(hIn, "Ind_Agent_004"), at: col(hIn, "Ind_Agent_006"), t: col(hIn, "Ind_Agent_063"), rona: col(hIn, "Ind_Serv_068") };
    for (const r of hIn.filas) {
      const nomSkill = String(val(r, c.s) ?? "").trim();
      if (hayFiltroSkills && !skills.has(nomSkill)) continue;
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      a.servicio = true;
      const at = num(val(r, c.at));
      const x = ps(a, nomSkill);
      x.entOf += num(val(r, c.of)); x.entAt += at; x.entT += num(val(r, c.t)); x.rona += num(val(r, c.rona));
      const y = fr(a, franja(val(r, c.fr))); if (y) y.ent += at;
      if (at || num(val(r, c.of))) sk(nomSkill)?.gestores.add(a.id);
    }
  }
  const hOut = tabla(buscarHoja(inf.skill, /outbound/i));
  if (hOut.filas.length) {
    const c = { fr: col(hOut, "Ind_Agent_001"), nom: col(hOut, "Agent Name"), id: col(hOut, "Employee ID"), s: col(hOut, "Agent Group", "Service Outbound Call"),
                marc: col(hOut, "Ind_Agent_015"), ef: col(hOut, "Ind_Agent_016"), t: col(hOut, "Ind_Agent_065") };
    for (const r of hOut.filas) {
      const nomSkill = String(val(r, c.s) ?? "").trim();
      if (hayFiltroSkills && !skills.has(nomSkill)) continue;
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      a.servicio = true;
      const ef = num(val(r, c.ef));
      const x = ps(a, nomSkill);
      x.salMarc += num(val(r, c.marc)); x.sal += ef; x.salT += num(val(r, c.t));
      const f = franja(val(r, c.fr));
      const y = fr(a, f); if (y) y.sal += ef;
      const s = sk(nomSkill);
      if (s && f) sumar(s.salFr, f, ef);
      if (s && (ef || num(val(r, c.marc)))) s.gestores.add(a.id);
    }
  }

  // Automarcador (campañas del servicio): también define gestores del servicio
  const hReg = tabla(buscarHoja(inf.auto, /registos|registros/i));
  const campanas = new Map();
  const autoPorFranja = new Map();
  let autoTotal = 0, autoContactados = 0;
  if (hReg.filas.length) {
    const c = { id: col(hReg, "EmployeID", "Employee ID"), info: col(hReg, "AGENT_INFO"), camp: col(hReg, "NameCampaign"),
                res: col(hReg, "Call_result"), t: col(hReg, "Manage Time"), ini: col(hReg, "Start_Timestamp (Date Time)") };
    for (const r of hReg.filas) {
      const contacto = String(val(r, c.res) ?? "").toUpperCase() === "ANSWER";
      const t = num(val(r, c.t));
      autoTotal++; if (contacto) autoContactados++;
      const nomCamp = String(val(r, c.camp) ?? "(sin campaña)").trim();
      const k = campanas.get(nomCamp) ?? { nombre: nomCamp, registros: 0, contactados: 0, gestion: 0, gestores: new Set(), resultados: new Map() };
      k.registros++; if (contacto) k.contactados++; k.gestion += t;
      sumar(k.resultados, String(val(r, c.res) ?? "–"), 1);
      campanas.set(nomCamp, k);
      const f = franjaDeHora(val(r, c.ini));
      if (f) sumar(autoPorFranja, f, 1);
      const info = String(val(r, c.info) ?? "");
      const a = g(val(r, c.id), info.includes(" - ") ? info.split(" - ").slice(1).join(" - ") : "");
      if (!a) continue;
      a.servicio = true;
      k.gestores.add(a.id);
      a.autoRegistros++; if (contacto) a.autoContactados++; a.autoGestion += t;
      const y = fr(a, f); if (y) y.auto++;
    }
  }

  // Agent State y AUX: solo para completar a los gestores del servicio
  const delServicio = (id) => { const a = gestores.get(idLimpio(id)); return a && a.servicio ? a : null; };
  const hEst = tabla(buscarHoja(inf.estado, /agent states/i));
  if (hEst.filas.length) {
    const c = {
      fr: col(hEst, "30 minutes"), nom: col(hEst, "Agent Name"), id: col(hEst, "Employee ID"),
      act: col(hEst, "Active Time"), nr: col(hEst, "Not Ready Time"), rd: col(hEst, "Ready Time"),
      desc: col(hEst, "Not Ready Reason Time (Descanso)"), form: col(hEst, "Not Ready Reason Time (Formacion)"),
      adm: col(hEst, "Not Ready Reason Time (Administrativo)"), coach: col(hEst, "Not Ready Reason Time (Coaching)"),
      occ: col(hEst, "Ind_Agent_073"),
    };
    for (const r of hEst.filas) {
      const a = delServicio(val(r, c.id)); if (!a) continue;
      if (!a.nombre) a.nombre = nombreLimpio(val(r, c.nom));
      const act = num(val(r, c.act));
      a.activo += act; a.listo += num(val(r, c.rd)); a.noListo += num(val(r, c.nr));
      a.descanso += num(val(r, c.desc)); a.formacion += num(val(r, c.form)); a.admin += num(val(r, c.adm)); a.coaching += num(val(r, c.coach));
      if (c.occ >= 0 && act > 0) { a.occNum += num(val(r, c.occ)) * act; a.occDen += act; }
      const y = fr(a, franja(val(r, c.fr)));
      if (y) { y.activo += act; y.listo += num(val(r, c.rd)); y.noListo += num(val(r, c.nr)); }
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
    const idc = col(hAux, "ID RH");
    const pausas = [
      ["Descanso", "T Total Descanso"], ["Formación", "T Total Form"], ["Administrativo", "T Total Admin"],
      ["Coaching", "T Total Coaching"], ["Apoyo sala", "Tiempo Apoyo Sala"], ["Meeting", "Tiempo Meeting"],
      ["RRHH", "Tiempo RRHH"], ["Reco. médico", "Tiempo RecoMedico"], ["WC", "Tiempo WC"], ["Sin tipo", "T Total Sin tipo"],
    ].map(([n, p]) => [n, col(hAux, p)]);
    for (const r of hAux.filas) {
      const a = delServicio(val(r, idc)); if (!a) continue;
      for (const [n, i] of pausas) { const v = num(val(r, i)); if (v) { a.auxDetalle[n] = (a.auxDetalle[n] ?? 0) + v; a.pausasAux += v; } }
    }
  }

  const lista = [...gestores.values()].filter((a) => a.servicio).map((a) => ({
    ...a,
    nombre: a.nombre || a.id,
    occ: a.occDen ? a.occNum / a.occDen : NaN,
    pausas: a.pausasAux || a.descanso + a.formacion + a.admin + a.coaching,
  }));

  return { inf, gestores: lista, skills, campanas: [...campanas.values()], colas: [...colas.values()], autoPorFranja, autoTotal, autoContactados };
}

// Totales de un gestor para el skill elegido ("" = todos sus skills)
function totalesGestor(a, skill) {
  const t = nuevoPorSkill();
  for (const [s, x] of a.porSkill) {
    if (skill && s !== skill) continue;
    for (const k in t) t[k] += x[k];
  }
  t.tmo = t.entAt ? t.entT / t.entAt : 0;
  return t;
}

// ----------------------------------------------------------------- estado de la vista
let estado = {
  etag: null, datos: null, paquete: null, skill: "",
  orden: { gestores: ["entAt", -1], colas: ["recibidas", -1], campanas: ["registros", -1], skills: ["recibidas", -1], matriz: ["total", -1] },
};
const graficos = {};
try { estado.skill = localStorage.getItem("skill") || ""; } catch {}

// skills visibles con el filtro actual
function skillsSel() {
  const todos = [...estado.datos.skills.values()];
  return estado.skill ? todos.filter((s) => s.nombre === estado.skill) : todos;
}
function totalSkills() {
  const t = nuevoSkill("Todos");
  for (const s of skillsSel()) {
    for (const k of ["recibidas", "atendidas", "abandonadas", "at20", "atInb", "tInb", "salientes", "marcadas", "tOut"]) t[k] += s[k];
    for (const [f, e] of s.entFr) { const x = t.entFr.get(f) ?? { rec: 0, at: 0, ab: 0 }; x.rec += e.rec; x.at += e.at; x.ab += e.ab; t.entFr.set(f, x); }
    for (const [f, n] of s.salFr) sumar(t.salFr, f, n);
    for (const id of s.gestores) t.gestores.add(id);
  }
  return t;
}
function gestoresVista() {
  return estado.datos.gestores
    .filter((a) => !estado.skill || a.porSkill.has(estado.skill))
    .map((a) => ({ ...a, ...totalesGestor(a, estado.skill) }));
}

// ----------------------------------------------------------------- pintado
function kpi(etiqueta, valor, nota = "") {
  return `<div class="kpi"><div class="etiqueta">${esc(etiqueta)}</div><div class="valor">${valor}</div>${nota ? `<div class="nota">${nota}</div>` : ""}</div>`;
}

function pintarFrescura(paquete) {
  $("#frescura").innerHTML = paquete.informes.map((i) => {
    const min = (Date.now() - new Date(i.generado)) / 60000;   // "generado" es hora local del PC
    const clase = !String(i.generado).startsWith(hoyLocal()) ? "malo" : min <= 35 ? "ok" : min <= 90 ? "viejo" : "malo";
    const txt = clase === "ok" ? "al día" : clase === "viejo" ? "con retraso" : "desactualizado";
    return `<span class="chip ${clase}" title="${esc(txt)}"><i aria-hidden="true"></i>${esc(i.informe)} · ${fmtHora(i.generado)} <span class="sr">(${txt})</span></span>`;
  }).join("");
  const faltan = [["Automarcador", /automarcador/i], ["Agent AUX", /agent_aux/i], ["Agent State", /agent state/i],
                  ["Agent Group + Skill", /agent group|skill/i], ["OP.Comerciales", /servicio op|op\.?comercial/i]]
    .filter(([, re]) => !paquete.informes.some((i) => re.test(i.informe))).map(([n]) => n);
  $("#aviso").hidden = !faltan.length;
  $("#aviso").textContent = faltan.length ? `Faltan informes en la última subida: ${faltan.join(", ")}.` : "";
}

function pintarSelector() {
  const sel = $("#skill");
  const lista = [...estado.datos.skills.values()]
    .filter((s) => s.recibidas + s.salientes + s.gestores.size > 0)
    .sort((a, b) => b.recibidas + b.salientes - (a.recibidas + a.salientes));
  if (estado.skill && !estado.datos.skills.has(estado.skill)) estado.skill = "";
  sel.innerHTML = `<option value="">Todos los skills (${lista.length})</option>` +
    lista.map((s) => `<option value="${esc(s.nombre)}">${esc(s.nombre)} · ${fmtN(s.recibidas)} ent. / ${fmtN(s.salientes)} sal.</option>`).join("");
  sel.value = estado.skill;
  sel.classList.toggle("activo", !!estado.skill);
}

function pintarKpis() {
  const t = totalSkills();
  const gs = gestoresVista();
  const conectados = gs.filter((a) => a.conectado).length;
  const tmo = t.atInb ? t.tInb / t.atInb : 0;
  const d = estado.datos;
  $("#kpis").innerHTML = [
    kpi("Entrantes recibidas", fmtN(t.recibidas), estado.skill ? esc(estado.skill) : "todos los skills"),
    kpi("Atendidas", fmtN(t.atendidas), t.recibidas ? fmtPct(t.atendidas / t.recibidas) + " de las recibidas" : ""),
    kpi("Abandonadas", fmtN(t.abandonadas), t.recibidas ? fmtPct(t.abandonadas / t.recibidas) + " de las recibidas" : ""),
    kpi("Atendidas en < 20 s", t.atendidas ? fmtPct(t.at20 / t.atendidas) : "–", fmtN(t.at20) + " llamadas"),
    kpi("TMO entrante", tmo ? fmtT(tmo) : "–", "tiempo medio de llamada"),
    kpi("Salientes", fmtN(t.salientes), `${fmtN(t.marcadas)} marcadas`),
    kpi("Automarcador", fmtN(d.autoTotal), d.autoTotal ? `${fmtN(d.autoContactados)} contactados (${fmtPct(d.autoContactados / d.autoTotal)}) · todas las campañas` : "registros gestionados"),
    kpi("Gestores", fmtN(gs.length), `${fmtN(conectados)} conectados ahora`),
  ].join("");
}

const franjasOrdenadas = (...mapas) => { const s = new Set(); for (const m of mapas) for (const k of m.keys()) s.add(k); return [...s].sort(); };

function opcionesGrafico() {
  const texto = css("--text-secondary"), rejilla = css("--grid");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { color: texto, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtN(c.parsed.y)}` } },
    },
    scales: {
      x: { ticks: { color: texto, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
      y: { beginAtZero: true, ticks: { color: texto, precision: 0 }, grid: { color: rejilla }, border: { display: false } },
    },
  };
}
function grafico(id, tipo, etiquetas, series) {
  if (!window.Chart) return;
  const colores = ["--series-1", "--series-2", "--series-3"].map(css);
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data, borderColor: colores[i], backgroundColor: colores[i],
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25,
    borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 22,
  }));
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), { type: tipo, data: { labels: etiquetas, datasets }, options: opcionesGrafico() });
}
function pintarGraficos() {
  const t = totalSkills();
  const fe = franjasOrdenadas(t.entFr);
  $("#g-entrantes-sub").textContent = estado.skill ? `Skill ${estado.skill} (00.Servicio OP.Comerciales)` : "Llamadas de cola de todos los skills del servicio";
  grafico("g-entrantes", "line", fe, [
    { label: "Recibidas", data: fe.map((f) => t.entFr.get(f).rec) },
    { label: "Atendidas", data: fe.map((f) => t.entFr.get(f).at) },
    { label: "Abandonadas", data: fe.map((f) => t.entFr.get(f).ab) },
  ]);
  const auto = estado.skill ? new Map() : estado.datos.autoPorFranja;
  const fs = franjasOrdenadas(t.salFr, auto);
  $("#g-salientes-sub").textContent = estado.skill ? `Salientes de gestores en ${estado.skill}` : "Salientes de gestores y registros del automarcador";
  const series = [{ label: "Salientes gestores", data: fs.map((f) => t.salFr.get(f) ?? 0) }];
  if (!estado.skill) series.push({ label: "Registros automarcador", data: fs.map((f) => auto.get(f) ?? 0) });
  grafico("g-salientes", "bar", fs, series);
}

// Tabla genérica ordenable
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
    const k = th.dataset.k, col = columnas.find((x) => x.k === k);
    estado.orden[clave] = [k, estado.orden[clave][0] === k ? -estado.orden[clave][1] : (col.txt ? 1 : -1)];
    pintarTabla(idTabla, clave, columnas, filas, alClicar);
  }));
  if (alClicar) t.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => alClicar(ordenadas[Number(tr.dataset.i)])));
}

const cero = (v, f) => (v ? f(v) : `<span class="cero">${f(0)}</span>`);
const celdaGestor = (a) => `<div class="nombre">${esc(a.nombre)}</div><div class="id">${esc(a.id)}</div>`;
const COLS_GESTORES = () => [
  { k: "nombre", t: "Gestor", txt: true, f: celdaGestor },
  { k: "conectado", t: "Estado", txt: true, orden: (a) => (a.conectado ? 1 : 0),
    f: (a) => `<span class="estado ${a.conectado ? "on" : "off"}"><i aria-hidden="true"></i>${a.conectado ? "Conectado" : a.logout ? "Desconectado " + fmtHora(a.logout) : "–"}</span>` },
  { k: "login", t: "1ª conexión", f: (a) => fmtHora(a.login), orden: (a) => a.login ?? "" },
  { k: "skillsTxt", t: estado.skill ? "Skill" : "Skills", txt: true, orden: (a) => a.porSkill.size,
    f: (a) => `<div class="skills-lista" title="${esc([...a.porSkill.keys()].join(", "))}">${esc(estado.skill || [...a.porSkill.keys()].join(", ") || "–")}</div>` },
  { k: "entAt", t: "Entrantes", f: (a) => cero(a.entAt, fmtN), ayuda: "Entrantes atendidas (N Answer)" },
  { k: "tmo", t: "TMO entrante", f: (a) => (a.entAt ? fmtT(a.tmo) : "–"), ayuda: "T Total Inbound / N Answer" },
  { k: "rona", t: "RONA", f: (a) => cero(a.rona, fmtN), ayuda: "Llamadas ofrecidas no contestadas (RouteOnNoAnswer)" },
  { k: "sal", t: "Salientes", f: (a) => cero(a.sal, fmtN), ayuda: "N Outbound (Agent Group + Skill)" },
  { k: "autoRegistros", t: "Automarcador", f: (a) => cero(a.autoRegistros, fmtN), ayuda: "Registros gestionados (todas las campañas)" },
  { k: "autoContactados", t: "Contactados", ayuda: "Registros con resultado ANSWER",
    f: (a) => (a.autoRegistros ? `${fmtN(a.autoContactados)} <span class="id">${fmtPct(a.autoContactados / a.autoRegistros)}</span>` : `<span class="cero">0</span>`) },
  { k: "activo", t: "T. conectado", f: (a) => cero(a.activo, fmtT), ayuda: "Active Time (Agent State)" },
  { k: "listo", t: "Disponible", f: (a) => cero(a.listo, fmtT), ayuda: "Ready Time" },
  { k: "noListo", t: "No disponible", f: (a) => cero(a.noListo, fmtT), ayuda: "Not Ready Time" },
  { k: "pausas", t: "Pausas AUX", f: (a) => cero(a.pausas, fmtT), ayuda: "Descanso, formación, admin, coaching, WC… (10.Agent_AUX)" },
  { k: "occ", t: "Ocupación", f: (a) => fmtPct(a.occ), ayuda: "% Occupancy (Agent State), ponderado por tiempo conectado" },
];

function filtroTexto(lista, q) {
  q = norm(q);
  return q ? lista.filter((a) => norm(a.nombre).includes(q) || norm(a.id).includes(q)) : lista;
}
function gestoresFiltrados() {
  let l = filtroTexto(gestoresVista(), $("#buscar").value);
  if ($("#solo-conectados").checked) l = l.filter((a) => a.conectado);
  return l;
}
function pintarGestores() {
  const filas = gestoresFiltrados();
  $("#cuenta-gestores").textContent = `${filas.length} gestores${estado.skill ? " en " + estado.skill : ""}`;
  pintarTabla("t-gestores", "gestores", COLS_GESTORES(), filas, abrirDetalle);
}

function pintarMatriz() {
  const metrica = document.querySelector('input[name="metrica"]:checked').value;
  const v = (x) => (x ? (metrica === "ent" ? x.entAt : metrica === "sal" ? x.sal : x.entAt + x.sal) : 0);
  const gs = filtroTexto(estado.datos.gestores, $("#buscar-m").value);
  // columnas: skills con alguna llamada de gestores del servicio, de más a menos volumen
  const volumen = new Map();
  for (const a of estado.datos.gestores) for (const [s, x] of a.porSkill) sumar(volumen, s, v(x));
  const cols = [...volumen].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([s]) => s);
  const filas = gs.map((a) => {
    const f = { ...a, total: 0, _sel: false };
    for (const s of cols) { const n = v(a.porSkill.get(s)); f["s:" + s] = n; f.total += n; }
    return f;
  }).filter((f) => f.total > 0);
  const max = Math.max(1, ...filas.flatMap((f) => cols.map((s) => f["s:" + s])));
  const heat = css("--heat");
  const estilo = (n) => (n ? `background: rgb(${heat} / ${(0.1 + 0.6 * (n / max)).toFixed(2)})` : "");
  pintarTabla("t-matriz", "matriz", [
    { k: "nombre", t: "Gestor", txt: true, f: celdaGestor },
    { k: "total", t: "Total", celda: () => "celda total", f: (f) => fmtN(f.total) },
    ...cols.map((s) => ({
      k: "s:" + s, t: s, cls: "skill", celda: () => "celda", ayuda: s,
      estilo: (f) => estilo(f["s:" + s]),
      f: (f) => (f["s:" + s] ? fmtN(f["s:" + s]) : ""),
    })),
  ], filas, (f) => abrirDetalle(estado.datos.gestores.find((a) => a.id === f.id)));
}

function pintarSkills() {
  const filas = [...estado.datos.skills.values()]
    .filter((s) => s.recibidas + s.salientes + s.gestores.size > 0)
    .map((s) => ({ ...s, ng: s.gestores.size, _sel: s.nombre === estado.skill }));
  pintarTabla("t-skills", "skills", [
    { k: "nombre", t: "Skill", txt: true, f: (s) => `<span class="nombre">${esc(s.nombre)}</span>` },
    { k: "recibidas", t: "Recibidas", f: (s) => cero(s.recibidas, fmtN) },
    { k: "atendidas", t: "Atendidas", f: (s) => cero(s.atendidas, fmtN) },
    { k: "abandonadas", t: "Abandonadas", f: (s) => cero(s.abandonadas, fmtN) },
    { k: "pAb", t: "% abandono", orden: (s) => (s.recibidas ? s.abandonadas / s.recibidas : NaN), f: (s) => (s.recibidas ? fmtPct(s.abandonadas / s.recibidas) : "–") },
    { k: "pNs", t: "Atend. < 20 s", orden: (s) => (s.atendidas ? s.at20 / s.atendidas : NaN), f: (s) => (s.atendidas ? fmtPct(s.at20 / s.atendidas) : "–") },
    { k: "tmo", t: "TMO entrante", orden: (s) => (s.atInb ? s.tInb / s.atInb : NaN), f: (s) => (s.atInb ? fmtT(s.tInb / s.atInb) : "–") },
    { k: "salientes", t: "Salientes", f: (s) => cero(s.salientes, fmtN) },
    { k: "marcadas", t: "Marcadas", f: (s) => cero(s.marcadas, fmtN) },
    { k: "ng", t: "Gestores", f: (s) => cero(s.ng, fmtN) },
  ], filas, (s) => elegirSkill(s.nombre === estado.skill ? "" : s.nombre));
}

function pintarColas() {
  pintarTabla("t-colas", "colas", [
    { k: "nombre", t: "Cola", txt: true },
    { k: "recibidas", t: "Recibidas", f: (q) => fmtN(q.recibidas) },
    { k: "atendidas", t: "Atendidas", f: (q) => fmtN(q.atendidas) },
    { k: "abandonadas", t: "Abandonadas", f: (q) => fmtN(q.abandonadas) },
    { k: "pAb", t: "% abandono", orden: (q) => (q.recibidas ? q.abandonadas / q.recibidas : NaN), f: (q) => (q.recibidas ? fmtPct(q.abandonadas / q.recibidas) : "–") },
    { k: "pNs", t: "Atend. < 20 s", orden: (q) => (q.atendidas ? q.at20 / q.atendidas : NaN), f: (q) => (q.atendidas ? fmtPct(q.at20 / q.atendidas) : "–") },
  ], estado.datos.colas.filter((q) => q.recibidas > 0 && (!estado.skill || q.skill === estado.skill)));
}

function pintarCampanas() {
  pintarTabla("t-campanas", "campanas", [
    { k: "nombre", t: "Campaña", txt: true },
    { k: "registros", t: "Registros", f: (k) => fmtN(k.registros) },
    { k: "contactados", t: "Contactados", f: (k) => fmtN(k.contactados) },
    { k: "pc", t: "% contacto", orden: (k) => k.contactados / k.registros, f: (k) => fmtPct(k.contactados / k.registros) },
    { k: "tm", t: "T. medio gestión", orden: (k) => k.gestion / k.registros, f: (k) => fmtT(k.gestion / k.registros) },
    { k: "ng", t: "Gestores", orden: (k) => k.gestores.size, f: (k) => fmtN(k.gestores.size) },
    { k: "res", t: "Resultados principales", txt: true, orden: (k) => k.registros,
      f: (k) => esc([...k.resultados].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${fmtN(n)}`).join(" · ")) },
  ], estado.datos.campanas);
}

function abrirDetalle(a) {
  if (!a) return;
  const tot = totalesGestor(a, "");
  $("#d-nombre").textContent = a.nombre;
  $("#d-sub").textContent = `ID ${a.id} · ${a.conectado ? "Conectado" : "Desconectado"}${a.login ? " · 1ª conexión " + fmtHora(a.login) : ""}${a.logout && !a.conectado ? " · última desconexión " + fmtHora(a.logout) : ""}`;
  const pausas = Object.entries(a.auxDetalle).sort((x, y) => y[1] - x[1]).map(([n, v]) => `${n} ${fmtT(v)}`).join(" · ");
  $("#d-kpis").innerHTML = [
    kpi("Tiempo conectado", fmtT(a.activo), `Disponible ${fmtT(a.listo)} · Ocupación ${fmtPct(a.occ)}`),
    kpi("Entrantes atendidas", fmtN(tot.entAt), tot.entAt ? `TMO ${fmtT(tot.tmo)} · RONA ${fmtN(tot.rona)}` : ""),
    kpi("Salientes", fmtN(tot.sal), `${fmtN(tot.salMarc)} marcadas`),
    kpi("Automarcador", fmtN(a.autoRegistros), a.autoRegistros ? `${fmtN(a.autoContactados)} contactados` : ""),
    kpi("Pausas AUX", fmtT(a.pausas), esc(pausas)),
  ].join("");

  const porSkill = [...a.porSkill].map(([s, x]) => ({ s, ...x })).sort((p, q) => q.entAt + q.sal - (p.entAt + p.sal));
  $("#t-detalle-skill").innerHTML =
    `<thead><tr><th>Skill</th><th>Ofrecidas</th><th>Entrantes</th><th>TMO entrante</th><th>RONA</th><th>Marcadas</th><th>Salientes</th><th>T. saliente</th></tr></thead><tbody>` +
    (porSkill.length ? porSkill.map((x) => `<tr><td>${esc(x.s)}</td><td>${fmtN(x.entOf)}</td><td>${fmtN(x.entAt)}</td><td>${x.entAt ? fmtT(x.entT / x.entAt) : "–"}</td><td>${fmtN(x.rona)}</td><td>${fmtN(x.salMarc)}</td><td>${fmtN(x.sal)}</td><td>${fmtT(x.salT)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="txt muted">Sin llamadas de skill (solo automarcador).</td></tr>`) + `</tbody>`;

  const fr = [...a.franjas.keys()].sort();
  $("#detalle").showModal();
  grafico("g-detalle", "bar", fr, [
    { label: "Entrantes", data: fr.map((f) => a.franjas.get(f).ent) },
    { label: "Salientes", data: fr.map((f) => a.franjas.get(f).sal) },
    { label: "Automarcador", data: fr.map((f) => a.franjas.get(f).auto) },
  ]);
  $("#t-detalle").innerHTML =
    `<thead><tr><th>Franja</th><th>Conectado</th><th>Disponible</th><th>No disponible</th><th>Entrantes</th><th>Salientes</th><th>Automarcador</th></tr></thead><tbody>` +
    fr.map((f) => { const x = a.franjas.get(f); return `<tr><td>${f}</td><td>${fmtT(x.activo)}</td><td>${fmtT(x.listo)}</td><td>${fmtT(x.noListo)}</td><td>${fmtN(x.ent)}</td><td>${fmtN(x.sal)}</td><td>${fmtN(x.auto)}</td></tr>`; }).join("") +
    `</tbody>`;
}

function pintarVista() {
  pintarKpis();
  pintarGraficos();
  pintarGestores();
  pintarMatriz();
  pintarSkills();
  pintarColas();
  pintarCampanas();
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
  const cab = ["ID", "Gestor", "Skill", "Estado", "Primera conexion", "Entrantes", "TMO entrante (s)", "RONA", "Salientes", "Automarcador", "Contactados",
               "T conectado (s)", "Disponible (s)", "No disponible (s)", "Pausas AUX (s)", "Ocupacion"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = filas.map((a) => [a.id, a.nombre, estado.skill || [...a.porSkill.keys()].join(", "), a.conectado ? "Conectado" : "Desconectado", a.login ?? "",
    a.entAt, Math.round(a.tmo), a.rona, a.sal, a.autoRegistros, a.autoContactados, Math.round(a.activo), Math.round(a.listo), Math.round(a.noListo),
    Math.round(a.pausas), Number.isFinite(a.occ) ? a.occ.toFixed(3) : ""].map(q).join(";"));
  const blob = new Blob(["﻿" + [cab.map(q).join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `gestores_${estado.skill || "todos"}_${hoyLocal()}.csv` }).click();
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
    const etag = r.headers.get("ETag");
    if (etag && etag === estado.etag) { marcarRefresco(); return; } // sin cambios
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
function mostrarLogin() { $("#app").hidden = true; $("#login").hidden = false; $("#clave").focus(); }
function mostrarApp() { $("#login").hidden = true; $("#app").hidden = false; }

// ----------------------------------------------------------------- eventos
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
  if (r.ok) { $("#clave").value = ""; cargar(); } else $("#login-error").textContent = "Clave incorrecta.";
});
$("#salir").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); estado.etag = null; mostrarLogin(); });
$("#skill").addEventListener("change", (e) => estado.datos && elegirSkill(e.target.value));
$("#buscar").addEventListener("input", () => estado.datos && pintarGestores());
$("#solo-conectados").addEventListener("change", () => estado.datos && pintarGestores());
$("#buscar-m").addEventListener("input", () => estado.datos && pintarMatriz());
document.querySelectorAll('input[name="metrica"]').forEach((r) => r.addEventListener("change", () => estado.datos && pintarMatriz()));
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
  if (estado.datos) { pintarGraficos(); pintarMatriz(); }
});
try { const t = localStorage.getItem("tema"); if (t) document.documentElement.dataset.theme = t; } catch {}

cargar();
setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
