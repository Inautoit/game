"use strict";
// Dashboard Gestores: descarga el paquete de informes de BusinessObjects (/api/datos),
// lo cruza por gestor y lo pinta. Se refresca solo cada minuto (solo re-procesa si hay datos nuevos).

const REFRESCO_MS = 60_000;
const $ = (s, r = document) => r.querySelector(s);

// ----------------------------------------------------------------- utilidades
const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtN = (n) => Math.round(n).toLocaleString("es-ES");
const fmtPct = (x) => (Number.isFinite(x) ? (x * 100).toLocaleString("es-ES", { maximumFractionDigits: 1 }) + " %" : "–");
function fmtT(seg) {
  seg = Math.round(seg || 0);
  const h = Math.floor(seg / 3600), m = Math.floor((seg % 3600) / 60), s = seg % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}
function fmtHora(iso) {
  if (!iso) return "–";
  const d = new Date(iso);
  return isNaN(d) ? String(iso) : d.toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
}
const css = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
// "2026-09-22 21:30-22:00" o "21:30-22:00" -> "21:30"
function franja(v) { const m = String(v ?? "").match(/(\d{1,2}):(\d{2})\s*-/); return m ? m[1].padStart(2, "0") + ":" + m[2] : null; }
// "2026-09-22 09:04:10" -> "09:00" (franja de 30 min)
function franjaDeHora(v) {
  const m = String(v ?? "").match(/(\d{1,2}):(\d{2})(:\d{2})?$/);
  if (!m) return null;
  return m[1].padStart(2, "0") + ":" + (Number(m[2]) < 30 ? "00" : "30");
}
const idLimpio = (v) => String(v ?? "").trim().replace(/\.0$/, "");
const nombreLimpio = (v) => String(v ?? "").replace(/\s*\([^)]*\)\s*$/, "").trim();

// Convierte una hoja (filas crudas) en {cols, norm, filas}. Detecta la fila de títulos
// y, si debajo hay una segunda fila de títulos (Month/Week/Day...), las combina.
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
// Índice de la primera columna cuyo título coincide (exacto primero, luego "contiene").
function col(t, ...patrones) {
  for (const p of patrones) { const i = t.norm.indexOf(norm(p)); if (i >= 0) return i; }
  for (const p of patrones) { const q = norm(p); const i = t.norm.findIndex((c) => c.includes(q)); if (i >= 0) return i; }
  return -1;
}
const val = (fila, i) => (i >= 0 ? fila[i] : undefined);

// ----------------------------------------------------------------- lectura del paquete
function buscarInforme(paquete, re) { return paquete.informes.find((i) => re.test(i.informe)); }
function buscarHoja(inf, re) { return inf?.hojas.find((h) => re.test(h.nombre)); }

function procesar(paquete) {
  const inf = {
    auto: buscarInforme(paquete, /automarcador/i),
    aux: buscarInforme(paquete, /agent_aux/i),
    estado: buscarInforme(paquete, /agent state/i),
    skill: buscarInforme(paquete, /agent group|skill/i),
    op: buscarInforme(paquete, /servicio op|op\.?comercial/i),
  };

  const gestores = new Map();
  const g = (id, nombre) => {
    id = idLimpio(id);
    if (!id) return null;
    let a = gestores.get(id);
    if (!a) {
      a = { id, nombre: "", activo: 0, listo: 0, noListo: 0, occNum: 0, occDen: 0, descanso: 0, formacion: 0, admin: 0, coaching: 0,
            pausasAux: 0, auxDetalle: {}, login: null, logout: null, conectado: false,
            entOfrecidas: 0, entAtendidas: 0, entTiempo: 0, rona: 0, salMarcadas: 0, salEfectivas: 0, salTiempo: 0,
            autoRegistros: 0, autoContactados: 0, autoGestion: 0, franjas: new Map() };
      gestores.set(id, a);
    }
    if (nombre && !a.nombre) a.nombre = nombreLimpio(nombre);
    return a;
  };
  const fr = (a, f) => {
    if (!f) return null;
    let x = a.franjas.get(f);
    if (!x) { x = { ent: 0, sal: 0, auto: 0, activo: 0, listo: 0, noListo: 0 }; a.franjas.set(f, x); }
    return x;
  };

  // --- Agent State: estados por franja + login
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
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      const act = num(val(r, c.act));
      a.activo += act; a.listo += num(val(r, c.rd)); a.noListo += num(val(r, c.nr));
      a.descanso += num(val(r, c.desc)); a.formacion += num(val(r, c.form)); a.admin += num(val(r, c.adm)); a.coaching += num(val(r, c.coach));
      if (c.occ >= 0 && act > 0) { a.occNum += num(val(r, c.occ)) * act; a.occDen += act; }
      const x = fr(a, franja(val(r, c.fr)));
      if (x) { x.activo += act; x.listo += num(val(r, c.rd)); x.noListo += num(val(r, c.nr)); }
    }
  }
  const hLog = tabla(buscarHoja(inf.estado, /login/i));
  if (hLog.filas.length) {
    const c = { id: col(hLog, "Employee ID"), nom: col(hLog, "Agent Name"), ini: col(hLog, "Login Hour"), fin: col(hLog, "Not Login Hour") };
    // "Agent - Login Hour" tambien contiene "login hour": se fuerza el orden correcto
    c.ini = hLog.norm.findIndex((x) => x.includes("login hour") && !x.includes("not login"));
    for (const r of hLog.filas) {
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      const ini = val(r, c.ini), fin = val(r, c.fin);
      if (ini && (!a.login || ini < a.login)) a.login = ini;
      if (!fin) a.conectado = true;
      else if (!a.logout || fin > a.logout) a.logout = fin;
    }
  }

  // --- 10.Agent_AUX: pausas
  const hAux = tabla(inf.aux?.hojas[0]);
  if (hAux.filas.length) {
    const idc = col(hAux, "ID RH");
    const pausas = [
      ["Descanso", "T Total Descanso"], ["Formación", "T Total Form"], ["Administrativo", "T Total Admin"],
      ["Coaching", "T Total Coaching"], ["Apoyo sala", "Tiempo Apoyo Sala"], ["Meeting", "Tiempo Meeting"],
      ["RRHH", "Tiempo RRHH"], ["Reco. médico", "Tiempo RecoMedico"], ["WC", "Tiempo WC"], ["Sin tipo", "T Total Sin tipo"],
    ].map(([n, p]) => [n, col(hAux, p)]);
    for (const r of hAux.filas) {
      const a = g(val(r, idc)); if (!a) continue;
      for (const [n, i] of pausas) {
        const v = num(val(r, i));
        if (v) { a.auxDetalle[n] = (a.auxDetalle[n] ?? 0) + v; a.pausasAux += v; }
      }
    }
  }

  // --- Agent Group + Skill: entrantes y salientes por gestor y franja
  const hIn = tabla(buscarHoja(inf.skill, /inbound/i));
  if (hIn.filas.length) {
    const c = { fr: col(hIn, "Ind_Agent_001"), nom: col(hIn, "Agent Name"), id: col(hIn, "Employee ID"),
                of: col(hIn, "Ind_Agent_004"), at: col(hIn, "Ind_Agent_006"), t: col(hIn, "Ind_Agent_063"), rona: col(hIn, "Ind_Serv_068") };
    for (const r of hIn.filas) {
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      const at = num(val(r, c.at));
      a.entOfrecidas += num(val(r, c.of)); a.entAtendidas += at; a.entTiempo += num(val(r, c.t)); a.rona += num(val(r, c.rona));
      const x = fr(a, franja(val(r, c.fr))); if (x) x.ent += at;
    }
  }
  const hOut = tabla(buscarHoja(inf.skill, /outbound/i));
  const salPorFranja = new Map();
  if (hOut.filas.length) {
    const c = { fr: col(hOut, "Ind_Agent_001"), nom: col(hOut, "Agent Name"), id: col(hOut, "Employee ID"),
                marc: col(hOut, "Ind_Agent_015"), ef: col(hOut, "Ind_Agent_016"), t: col(hOut, "Ind_Agent_065") };
    for (const r of hOut.filas) {
      const a = g(val(r, c.id), val(r, c.nom)); if (!a) continue;
      const ef = num(val(r, c.ef));
      a.salMarcadas += num(val(r, c.marc)); a.salEfectivas += ef; a.salTiempo += num(val(r, c.t));
      const f = franja(val(r, c.fr));
      const x = fr(a, f); if (x) x.sal += ef;
      if (f) salPorFranja.set(f, (salPorFranja.get(f) ?? 0) + ef);
    }
  }

  // --- Automarcador: registros gestionados por gestor y campaña
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
      const resu = String(val(r, c.res) ?? "–"); k.resultados.set(resu, (k.resultados.get(resu) ?? 0) + 1);
      campanas.set(nomCamp, k);
      const f = franjaDeHora(val(r, c.ini));
      if (f) autoPorFranja.set(f, (autoPorFranja.get(f) ?? 0) + 1);
      const info = String(val(r, c.info) ?? "");
      const a = g(val(r, c.id), info.includes(" - ") ? info.split(" - ").slice(1).join(" - ") : "");
      if (!a) continue;
      k.gestores.add(a.id);
      a.autoRegistros++; if (contacto) a.autoContactados++; a.autoGestion += t;
      const x = fr(a, f); if (x) x.auto++;
    }
  }

  // --- 00.Servicio OP.Comerciales: colas entrantes y salientes de servicio
  const hLl = tabla(buscarHoja(inf.op, /llaminbound/i));
  const colas = new Map();
  const entPorFranja = new Map();
  const tot = { recibidas: 0, atendidas: 0, abandonadas: 0, at20: 0 };
  if (hLl.filas.length) {
    const c = { fr: col(hLl, "Interval"), cola: col(hLl, "Queue"), rec: col(hLl, "Received"), at: col(hLl, "Accepted Agent"),
                ab: col(hLl, "Total Abandoned"), at20: col(hLl, "Accepted < 20") };
    for (const r of hLl.filas) {
      const rec = num(val(r, c.rec)), at = num(val(r, c.at)), ab = num(val(r, c.ab)), a20 = num(val(r, c.at20));
      tot.recibidas += rec; tot.atendidas += at; tot.abandonadas += ab; tot.at20 += a20;
      const nom = String(val(r, c.cola) ?? "–");
      const q = colas.get(nom) ?? { nombre: nom, recibidas: 0, atendidas: 0, abandonadas: 0, at20: 0 };
      q.recibidas += rec; q.atendidas += at; q.abandonadas += ab; q.at20 += a20;
      colas.set(nom, q);
      const f = franja(val(r, c.fr));
      if (f) { const e = entPorFranja.get(f) ?? { rec: 0, at: 0, ab: 0 }; e.rec += rec; e.at += at; e.ab += ab; entPorFranja.set(f, e); }
    }
  }
  const hTo = tabla(buscarHoja(inf.op, /tiemposout/i));
  let salServicio = 0;
  if (hTo.filas.length) { const i = col(hTo, "NOutbound"); for (const r of hTo.filas) salServicio += num(val(r, i)); }

  // Gestores sin nombre (solo aparecen en AUX): se deja el ID
  const lista = [...gestores.values()].map((a) => ({
    ...a,
    nombre: a.nombre || a.id,
    occ: a.occDen ? a.occNum / a.occDen : NaN,
    pausas: a.pausasAux || a.descanso + a.formacion + a.admin + a.coaching,
    tmoEnt: a.entAtendidas ? a.entTiempo / a.entAtendidas : 0,
    conectado: a.conectado,
    // Agent State y AUX traen a TODA la plataforma; los gestores "del servicio" son los que
    // aparecen en Agent Group + Skill o en el Automarcador
    servicio: a.entOfrecidas + a.entAtendidas + a.salMarcadas + a.salEfectivas + a.autoRegistros > 0,
  }));

  return {
    inf, gestores: lista, campanas: [...campanas.values()], colas: [...colas.values()],
    entPorFranja, salPorFranja, autoPorFranja,
    tot: { ...tot, salServicio, autoTotal, autoContactados,
           salGestores: lista.reduce((s, a) => s + a.salEfectivas, 0),
           conectados: lista.filter((a) => a.servicio && a.conectado).length,
           delServicio: lista.filter((a) => a.servicio).length },
  };
}

// ----------------------------------------------------------------- pintado
let estado = { etag: null, datos: null, paquete: null, orden: { gestores: ["activo", -1], colas: ["recibidas", -1], campanas: ["registros", -1] } };
const graficos = {};

function kpi(etiqueta, valor, nota = "") {
  return `<div class="kpi"><div class="etiqueta">${esc(etiqueta)}</div><div class="valor">${valor}</div>${nota ? `<div class="nota">${nota}</div>` : ""}</div>`;
}

function hoyLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function pintarFrescura(paquete) {
  const chips = paquete.informes.map((i) => {
    const min = (Date.now() - new Date(i.generado)) / 60000;   // "generado" es hora local del PC
    const clase = !String(i.generado).startsWith(hoyLocal()) ? "malo" : min <= 35 ? "ok" : min <= 90 ? "viejo" : "malo";
    const txt = clase === "ok" ? "al día" : clase === "viejo" ? "con retraso" : "desactualizado";
    return `<span class="chip ${clase}" title="${esc(txt)}"><i aria-hidden="true"></i>${esc(i.informe)} · ${fmtHora(i.generado)} <span class="sr">(${txt})</span></span>`;
  });
  $("#frescura").innerHTML = chips.join("");
  const faltan = [["Automarcador", /automarcador/i], ["Agent AUX", /agent_aux/i], ["Agent State", /agent state/i],
                  ["Agent Group + Skill", /agent group|skill/i], ["OP.Comerciales", /servicio op|op\.?comercial/i]]
    .filter(([, re]) => !paquete.informes.some((i) => re.test(i.informe))).map(([n]) => n);
  $("#aviso").hidden = !faltan.length;
  $("#aviso").textContent = faltan.length ? `Faltan informes en la última subida: ${faltan.join(", ")}.` : "";
}

function pintarKpis(d) {
  const t = d.tot;
  $("#kpis").innerHTML = [
    kpi("Entrantes recibidas", fmtN(t.recibidas), "colas OP.Comerciales"),
    kpi("Entrantes atendidas", fmtN(t.atendidas), t.recibidas ? fmtPct(t.atendidas / t.recibidas) + " de las recibidas" : ""),
    kpi("Abandonadas", fmtN(t.abandonadas), t.recibidas ? fmtPct(t.abandonadas / t.recibidas) + " de las recibidas" : ""),
    kpi("Atendidas en < 20 s", t.atendidas ? fmtPct(t.at20 / t.atendidas) : "–", fmtN(t.at20) + " llamadas"),
    kpi("Salientes de gestores", fmtN(t.salGestores), "Agent Group + Skill"),
    kpi("Automarcador", fmtN(t.autoTotal), t.autoTotal ? `${fmtN(t.autoContactados)} contactados (${fmtPct(t.autoContactados / t.autoTotal)})` : "registros gestionados"),
    kpi("Gestores del servicio", fmtN(t.delServicio), `${fmtN(t.conectados)} conectados ahora`),
  ].join("");
}

function franjasOrdenadas(...mapas) {
  const s = new Set(); for (const m of mapas) for (const k of m.keys()) s.add(k);
  return [...s].sort();
}

function opcionesGrafico(apilado = false) {
  const texto = css("--text-secondary"), rejilla = css("--grid");
  return {
    responsive: true, maintainAspectRatio: false, animation: false,
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { color: texto, boxWidth: 12, boxHeight: 12, usePointStyle: true } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtN(c.parsed.y)}` } },
    },
    scales: {
      x: { stacked: apilado, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } },
      y: { stacked: apilado, beginAtZero: true, ticks: { color: texto, precision: 0 }, grid: { color: rejilla }, border: { display: false } },
    },
  };
}

function grafico(id, tipo, etiquetas, series, apilado = false) {
  if (!window.Chart) return;
  const colores = ["--series-1", "--series-2", "--series-3"].map(css);
  const datasets = series.map((s, i) => ({
    label: s.label, data: s.data,
    borderColor: colores[i], backgroundColor: colores[i],
    borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, tension: 0.25,
    borderRadius: 4, borderSkipped: "bottom", maxBarThickness: 22,
  }));
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), { type: tipo, data: { labels: etiquetas, datasets }, options: opcionesGrafico(apilado) });
}

function pintarGraficos(d) {
  const fe = franjasOrdenadas(d.entPorFranja);
  grafico("g-entrantes", "line", fe, [
    { label: "Recibidas", data: fe.map((f) => d.entPorFranja.get(f).rec) },
    { label: "Atendidas", data: fe.map((f) => d.entPorFranja.get(f).at) },
    { label: "Abandonadas", data: fe.map((f) => d.entPorFranja.get(f).ab) },
  ]);
  const fs = franjasOrdenadas(d.salPorFranja, d.autoPorFranja);
  grafico("g-salientes", "bar", fs, [
    { label: "Salientes gestores", data: fs.map((f) => d.salPorFranja.get(f) ?? 0) },
    { label: "Registros automarcador", data: fs.map((f) => d.autoPorFranja.get(f) ?? 0) },
  ]);
}

// Tabla genérica con ordenación por columna
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
    `<thead><tr>${columnas.map((x) => `<th scope="col" data-k="${x.k}" class="${x.txt ? "txt" : ""}" ${x.k === campo ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""} title="${esc(x.ayuda ?? "")}">${esc(x.t)}</th>`).join("")}</tr></thead>` +
    `<tbody>${ordenadas.map((f, i) => `<tr data-i="${i}" class="${alClicar ? "clic" : ""}">${columnas.map((x) => `<td class="${x.txt ? "txt" : ""}">${x.f ? x.f(f) : esc(f[x.k])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k;
    estado.orden[clave] = [k, estado.orden[clave][0] === k ? -estado.orden[clave][1] : (columnas.find((x) => x.k === k).txt ? 1 : -1)];
    pintarTabla(idTabla, clave, columnas, filas, alClicar);
  }));
  if (alClicar) t.querySelectorAll("tbody tr").forEach((tr) => tr.addEventListener("click", () => alClicar(ordenadas[Number(tr.dataset.i)])));
}

const cero = (v, f) => (v ? f(v) : `<span class="cero">${f(0)}</span>`);
const COLS_GESTORES = [
  { k: "nombre", t: "Gestor", txt: true, f: (a) => `<div class="nombre">${esc(a.nombre)}</div><div class="id">${esc(a.id)}</div>` },
  { k: "conectado", t: "Estado", txt: true, orden: (a) => (a.conectado ? 1 : 0),
    f: (a) => `<span class="estado ${a.conectado ? "on" : "off"}"><i aria-hidden="true"></i>${a.conectado ? "Conectado" : a.logout ? "Desconectado " + fmtHora(a.logout.replace(" ", "T")) : "–"}</span>` },
  { k: "login", t: "1ª conexión", f: (a) => (a.login ? fmtHora(a.login.replace(" ", "T")) : "–"), orden: (a) => a.login ?? "" },
  { k: "activo", t: "T. conectado", f: (a) => cero(a.activo, fmtT), ayuda: "Active Time (Agent State)" },
  { k: "listo", t: "Disponible", f: (a) => cero(a.listo, fmtT), ayuda: "Ready Time" },
  { k: "noListo", t: "No disponible", f: (a) => cero(a.noListo, fmtT), ayuda: "Not Ready Time" },
  { k: "pausas", t: "Pausas AUX", f: (a) => cero(a.pausas, fmtT), ayuda: "Descanso, formación, admin, coaching, WC… (10.Agent_AUX)" },
  { k: "occ", t: "Ocupación", f: (a) => fmtPct(a.occ), ayuda: "% Occupancy (Agent State), ponderado por tiempo conectado" },
  { k: "entAtendidas", t: "Entrantes", f: (a) => cero(a.entAtendidas, fmtN), ayuda: "Llamadas entrantes atendidas (N Answer)" },
  { k: "tmoEnt", t: "TMO entrante", f: (a) => (a.entAtendidas ? fmtT(a.tmoEnt) : "–"), ayuda: "T Total Inbound / N Answer" },
  { k: "salEfectivas", t: "Salientes", f: (a) => cero(a.salEfectivas, fmtN), ayuda: "N Outbound (Agent Group + Skill)" },
  { k: "autoRegistros", t: "Automarcador", f: (a) => cero(a.autoRegistros, fmtN), ayuda: "Registros gestionados" },
  { k: "autoContactados", t: "Contactados", f: (a) => (a.autoRegistros ? `${fmtN(a.autoContactados)} <span class="id">${fmtPct(a.autoContactados / a.autoRegistros)}</span>` : `<span class="cero">0</span>`), ayuda: "Registros con resultado ANSWER" },
];

function gestoresFiltrados() {
  const q = norm($("#buscar").value);
  const solo = $("#solo-activos").checked;
  return estado.datos.gestores.filter((a) => (!solo || a.servicio) && (!q || norm(a.nombre).includes(q) || norm(a.id).includes(q)));
}

function pintarGestores() {
  const filas = gestoresFiltrados();
  $("#cuenta-gestores").textContent = `${filas.length} gestores`;
  pintarTabla("t-gestores", "gestores", COLS_GESTORES, filas, abrirDetalle);
}

function pintarColas(d) {
  pintarTabla("t-colas", "colas", [
    { k: "nombre", t: "Cola", txt: true },
    { k: "recibidas", t: "Recibidas", f: (q) => fmtN(q.recibidas) },
    { k: "atendidas", t: "Atendidas", f: (q) => fmtN(q.atendidas) },
    { k: "abandonadas", t: "Abandonadas", f: (q) => fmtN(q.abandonadas) },
    { k: "pAb", t: "% abandono", orden: (q) => (q.recibidas ? q.abandonadas / q.recibidas : NaN), f: (q) => (q.recibidas ? fmtPct(q.abandonadas / q.recibidas) : "–") },
    { k: "pNs", t: "Atendidas < 20 s", orden: (q) => (q.atendidas ? q.at20 / q.atendidas : NaN), f: (q) => (q.atendidas ? fmtPct(q.at20 / q.atendidas) : "–") },
  ], d.colas.filter((q) => q.recibidas > 0));
}

function pintarCampanas(d) {
  pintarTabla("t-campanas", "campanas", [
    { k: "nombre", t: "Campaña", txt: true },
    { k: "registros", t: "Registros", f: (k) => fmtN(k.registros) },
    { k: "contactados", t: "Contactados", f: (k) => fmtN(k.contactados) },
    { k: "pc", t: "% contacto", orden: (k) => k.contactados / k.registros, f: (k) => fmtPct(k.contactados / k.registros) },
    { k: "tm", t: "T. medio gestión", orden: (k) => k.gestion / k.registros, f: (k) => fmtT(k.gestion / k.registros) },
    { k: "ng", t: "Gestores", orden: (k) => k.gestores.size, f: (k) => fmtN(k.gestores.size) },
    { k: "res", t: "Resultados principales", txt: true, orden: (k) => k.registros,
      f: (k) => esc([...k.resultados].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([r, n]) => `${r} ${fmtN(n)}`).join(" · ")) },
  ], d.campanas);
}

function abrirDetalle(a) {
  $("#d-nombre").textContent = a.nombre;
  $("#d-sub").textContent = `ID ${a.id} · ${a.conectado ? "Conectado" : "Desconectado"}${a.login ? " · 1ª conexión " + fmtHora(a.login.replace(" ", "T")) : ""}`;
  const pausas = Object.entries(a.auxDetalle).sort((x, y) => y[1] - x[1]).map(([n, v]) => `${n} ${fmtT(v)}`).join(" · ");
  $("#d-kpis").innerHTML = [
    kpi("Tiempo conectado", fmtT(a.activo), `Disponible ${fmtT(a.listo)}`),
    kpi("Entrantes atendidas", fmtN(a.entAtendidas), a.entAtendidas ? `TMO ${fmtT(a.tmoEnt)}` : ""),
    kpi("Salientes", fmtN(a.salEfectivas), `${fmtN(a.salMarcadas)} marcadas`),
    kpi("Automarcador", fmtN(a.autoRegistros), a.autoRegistros ? `${fmtN(a.autoContactados)} contactados` : ""),
    kpi("Pausas AUX", fmtT(a.pausas), esc(pausas)),
  ].join("");
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

function pintarTodo() {
  const d = estado.datos;
  const subido = new Date(estado.paquete.subido);
  $("#subtitulo").textContent = `${subido.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })} · datos subidos a las ${fmtHora(estado.paquete.subido)}`;
  pintarFrescura(estado.paquete);
  pintarKpis(d);
  pintarGraficos(d);
  pintarGestores();
  pintarColas(d);
  pintarCampanas(d);
}

function descargarCsv() {
  const filas = gestoresFiltrados();
  const cab = ["ID", "Gestor", "Estado", "Primera conexion", "T conectado (s)", "Disponible (s)", "No disponible (s)", "Pausas AUX (s)", "Ocupacion", "Entrantes", "TMO entrante (s)", "Salientes", "Automarcador", "Contactados"];
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lineas = filas.map((a) => [a.id, a.nombre, a.conectado ? "Conectado" : "Desconectado", a.login ?? "", Math.round(a.activo), Math.round(a.listo), Math.round(a.noListo),
    Math.round(a.pausas), Number.isFinite(a.occ) ? a.occ.toFixed(3) : "", a.entAtendidas, Math.round(a.tmoEnt), a.salEfectivas, a.autoRegistros, a.autoContactados].map(q).join(";"));
  const blob = new Blob(["﻿" + [cab.map(q).join(";"), ...lineas].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: `gestores_${new Date().toISOString().slice(0, 10)}.csv` }).click();
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
$("#buscar").addEventListener("input", () => estado.datos && pintarGestores());
$("#solo-activos").addEventListener("change", () => estado.datos && pintarGestores());
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
  if (estado.datos) pintarGraficos(estado.datos);
});
try { const t = localStorage.getItem("tema"); if (t) document.documentElement.dataset.theme = t; } catch {}

cargar();
setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
