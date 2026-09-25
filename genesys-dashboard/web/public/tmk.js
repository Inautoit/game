// Competición TMK - ranking de gestores en tiempo real y acumulado.
//
// Usa los mismos informes que el dashboard general (los sube el PC cada 20 min):
//   · Agent Group + Skill - v2.3_06 / OUTBOUND  → cola TMK outbound por gestor y franja de 30 min
//   · HistReport_Automarcador                   → registros codificados y llamadas del automarcador
// "Hoy" sale del último paquete. "Acumulado" suma además los días guardados (el Worker guarda la
// última subida de cada día); el resumen de cada día cerrado se calcula una vez y se guarda.

// ============ CONFIGURACIÓN DE LA COMPETICIÓN ============
const CONFIG = {
  colasOut: ["RBE_Outbound_TMK"],   // skills de la cola outbound que cuentan (Service Outbound Call)
  campanasAuto: ["C_Vencimiento_Push_High", "C_OC_RBE_Auto"], // campañas del automarcador que cuentan; vacío = todas
  desde: null,                      // primer día de la competición "AAAA-MM-DD"; null = todos los guardados
  objetivoDia: null,                // objetivo de gestiones por día (número) o null
  inicio: "09:00", fin: "22:00",    // jornada, para la proyección cuando no hay día anterior con el que comparar
  // nombre corto de cada automarcador en pantalla
  etiquetas: { C_Vencimiento_Push_High: "High", C_OC_RBE_Auto: "RBE Auto" },
};
const etq = (c) => CONFIG.etiquetas[c] ?? c;
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
const VERSION = "tmk2-" + [...JSON.stringify([CONFIG.colasOut, CONFIG.campanasAuto])].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36);

// ----------------------------------------------------------------- resumen de un paquete (un día)
const nuevoG = (nombre) => ({ n: nombre || "", marc: 0, con: 0, cortas: 0, tOut: 0, talk: 0, acw: 0,
  reg: 0, llam: 0, dur: 0, gest: 0, cod: {}, v: {}, camp: {} }); // camp: { campaña: nuevoAuto() }

function resumir(paquete, conRegistro) {
  const auto = buscarInforme(paquete, /automarcador/i);
  const skill = buscarInforme(paquete, /agent group|skill/i);
  const G = {}, fr = {}, camp = {};
  const g = (id, nombre) => {
    id = idLimpio(id); if (!id) return null;
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
    const d = hCall.filas.reduce((m, r) => { const x = diaDe(val(r, c.ini)); return x > m ? x : m; }, "");
    for (const r of hCall.filas) if (!d || diaDe(val(r, c.ini)) === d) durDe.set(String(val(r, c.call) ?? ""), nv(r, c.dur));
  }
  const hReg = tabla(buscarHoja(auto, /registos|registros/i));
  if (hReg.filas.length) {
    const c = indices(hReg, { call: "CALL_ID", id: ["EmployeID", "Employee ID"], info: "AGENT_INFO", camp: "NameCampaign", t: "Manage Time",
      ini: "Start_Timestamp (Date Time)", cod: "SD_BusinessCallResult", intento: "attempt" });
    const d = hReg.filas.reduce((m, r) => { const x = diaDe(val(r, c.ini)); return x > m ? x : m; }, "");
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

// ----------------------------------------------------------------- estado y carga
const estado = { ayer: null, auto: "", periodo: "hoy", hoy: null, etag: null, acum: null, cargandoAcum: false, dias: [], orden: { ranking: ["gestiones", -1], registro: ["hora", -1], out: ["f", -1], campanas: ["reg", -1] } };
const graficos = {};

async function cargar() {
  try {
    const r = await fetch("/api/datos", { cache: "no-cache", credentials: "same-origin" });
    if (r.status === 401) return mostrarLogin();
    mostrarApp();
    if (r.status === 404) { $("#subtitulo").textContent = "Todavía no se ha subido ningún informe desde el PC."; return; }
    if (!r.ok) throw new Error("HTTP " + r.status);
    const etag = r.headers.get("ETag");
    if (!(etag && etag === estado.etag)) {
      const paquete = await r.json();
      estado.hoy = resumir(paquete, true);
      estado.etag = etag;
      estado.acum = null; // se recalcula con el nuevo "hoy"
    }
    if (estado.periodo === "acum" && !estado.acum) await cargarAcumulado();
    if (!estado.ayer) await cargarAyer();
    pintar();
    if (!estado.acum && !estado.cargandoAcum) cargarAcumulado().then(pintar).catch(() => {}); // para el marcador
    $("#refresco").textContent = "Comprobado " + new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" });
  } catch (e) {
    $("#refresco").textContent = "Error al actualizar: " + e.message + " (se reintenta en 1 min)";
  }
}

async function resumenDia(dia) {
  const clave = `${VERSION}-${dia}`;
  const r = await fetch("/api/resumen?clave=" + encodeURIComponent(clave), { cache: "no-cache" });
  if (r.ok) return r.json();
  const p = await fetch("/api/datos?dia=" + dia, { cache: "no-cache" });
  if (!p.ok) return null;
  const res = resumir(await p.json(), false);
  res.dia ||= dia;
  delete res.registro; delete res.registroOut;
  fetch("/api/resumen?clave=" + encodeURIComponent(clave), { method: "PUT", body: JSON.stringify(res) }).catch(() => {});
  return res;
}

// Día anterior con datos (para comparar "a la misma hora")
async function cargarAyer() {
  try {
    const l = await (await fetch("/api/dias", { cache: "no-cache" })).json();
    const hoyDia = estado.hoy?.dia || l.hoy;
    const ant = l.dias.map((d) => d.dia).filter((d) => d < hoyDia).at(-1);
    if (ant) estado.ayer = (await resumenDia(ant)) ?? false; else estado.ayer = false;
  } catch { estado.ayer = null; }
}

async function cargarAcumulado() {
  if (estado.cargandoAcum) return;
  estado.cargandoAcum = true;
  $("#periodo-info").textContent = "Calculando el acumulado…";
  try {
    const l = await (await fetch("/api/dias", { cache: "no-cache" })).json();
    const hoyDia = estado.hoy?.dia || l.hoy;
    const pasados = l.dias.map((d) => d.dia).filter((d) => d < hoyDia && (!CONFIG.desde || d >= CONFIG.desde));
    const res = [];
    for (const d of pasados) { const x = await resumenDia(d); if (x) res.push(x); } // uno a uno: no satura la red
    estado.dias = [...pasados, hoyDia];
    estado.acum = acumular([...res, estado.hoy]);
  } finally { estado.cargandoAcum = false; }
}

// ----------------------------------------------------------------- pintado
function kpi(titulo, valor, nota = "", ayuda = "") {
  return `<div class="kpi" ${ayuda ? `title="${esc(ayuda)}"` : ""}><div class="etiqueta">${esc(titulo)}</div><div class="valor">${valor}</div>${nota ? `<div class="nota">${nota}</div>` : ""}</div>`;
}
const bloque = (titulo, kpis) => `<div class="bloque"><h2>${esc(titulo)}</h2><div class="kpis">${kpis.join("")}</div></div>`;

function datosVista() {
  if (estado.periodo === "acum" && estado.acum) return { ...estado.acum, fr: null };
  const h = estado.hoy;
  return { G: h.G, camp: h.camp, fr: h.fr, porDia: null };
}

function gestoresLista(G) {
  return Object.entries(G).map(([id, a]) => ({
    ...a, id, nombre: a.n || id,
    gestiones: a.con + a.reg,
    ...Object.fromEntries(campanasVista().map((c) => ["r:" + c, a.camp[c]?.reg ?? 0])),
    sel: estado.auto ? (a.camp[estado.auto] ?? nuevoAuto()) : a, // lo que se ve en las columnas del automarcador
    pCon: div(a.con, a.marc), tmo: div(a.tOut, a.con), talkMed: div(a.talk, a.con),
    llamMed: div(a.dur, a.llam), gestMed: div(a.gest, a.reg),
  }));
}

// automarcadores que salen en pantalla: los de la configuración, o los que haya en los datos
function campanasVista() {
  if (CONFIG.campanasAuto.length) return CONFIG.campanasAuto;
  return Object.entries(datosVista().camp).filter(([, k]) => k.tipo === "auto").map(([n]) => n).sort();
}

function pintar() {
  if (!estado.hoy) return;
  const d = datosVista();
  const lista = gestoresLista(d.G);
  const t = lista.reduce((s, a) => { for (const k of ["marc", "con", "cortas", "tOut", "talk", "reg", "llam", "dur", "gest"]) s[k] += a[k]; return s; },
    { marc: 0, con: 0, cortas: 0, tOut: 0, talk: 0, reg: 0, llam: 0, dur: 0, gest: 0 });
  const acum = estado.periodo === "acum";
  const hoy = estado.hoy.dia;

  $("#subtitulo").textContent = `${acum ? "Acumulado" : "Hoy"} · datos subidos a las ${fmtHora(estado.hoy.subido)}`;
  $("#periodo-info").textContent = acum
    ? (estado.acum ? `${estado.dias.length} día${estado.dias.length === 1 ? "" : "s"}: del ${fmtFecha(estado.dias[0])} al ${fmtFecha(estado.dias.at(-1))}` : "Calculando el acumulado…")
    : hoy ? `Día ${fmtFecha(hoy)}` : "";
  $("#frescura").innerHTML = `<span class="chip ok"><i aria-hidden="true"></i>Cola: ${esc(CONFIG.colasOut.join(", "))}</span>` +
    `<span class="chip ok"><i aria-hidden="true"></i>Automarcador: ${esc(CONFIG.campanasAuto.length ? CONFIG.campanasAuto.join(", ") : "todas las campañas")}</span>`;

  $("#kpis").innerHTML = [
    bloque("Cola TMK outbound", [
      kpi("Marcadas", fmtN(t.marc)),
      kpi("Llamadas", fmtN(t.con), `${fmtPct(div(t.con, t.marc))} de las marcadas · ${fmtN(t.cortas)} < 3 s`, "N Outbound (Ind_Agent_016): llamadas salientes establecidas desde el puesto del gestor"),
      kpi("TMO", fmtM(div(t.tOut, t.con)), `conversación media ${fmtM(div(t.talk, t.con))}`),
    ]),
    ...campanasVista().map((c) => {
      const k = d.camp[c] ?? { reg: 0, llam: 0, dur: 0, gest: 0, cod: {}, v: {} };
      const top = Object.entries(k.cod).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([x, n]) => `${esc(x)} ${fmtN(n)}`).join(" · ");
      return bloque(`Automarcador ${etq(c)}`, [
        kpi("Registros", fmtN(k.reg), `1ª vuelta ${fmtN(k.v["1"] ?? 0)} · 2ª ${fmtN(k.v["2"] ?? 0)}${k.v["3+"] ? ` · 3ª+ ${fmtN(k.v["3+"])}` : ""}`, `Campaña ${c}. Vuelta = columna attempt`),
        kpi("Llamadas", fmtN(k.llam), `media ${fmtM(div(k.dur, k.llam))} · gestión ${fmtM(div(k.gest, k.reg))}`),
        kpi("Codificaciones", fmtN(Object.keys(k.cod).length), top || "–"),
      ]);
    }),
    bloque("Competición", [
      kpi("Gestores", fmtN(lista.length), "con actividad en la cola o el automarcador"),
      kpi("Gestiones", fmtN(t.con + t.reg), "llamadas TMK + registros automarcador"),
    ]),
  ].join("");

  pintarMarcador(lista, t, d);

  // Ranking y podio
  $("#criterio").textContent = "Ordenado por gestiones = llamadas de la cola TMK + registros codificados del automarcador. Pulsa una columna para ordenar por otra medida.";
  const top = [...lista].sort((a, b) => b.gestiones - a.gestiones || b.con - a.con);
  const medallas = ["1º", "2º", "3º"];
  $("#podio").innerHTML = top.slice(0, 3).map((a, i) =>
    `<li class="puesto p${i + 1}"><span class="medalla" aria-hidden="true">${medallas[i]}</span><div><div class="nombre">${esc(a.nombre)}</div>` +
    `<div class="muted pequeno">${fmtN(a.gestiones)} gestiones · ${fmtN(a.con)} llamadas TMK${campanasVista().map((c) => (a["r:" + c] ? ` · ${fmtN(a["r:" + c])} ${esc(etq(c))}` : "")).join("")}</div></div></li>`).join("")
    || `<li class="muted">Todavía sin actividad.</li>`;

  // Gráficos: cola TMK y cada automarcador por separado
  const cs = campanasVista();
  const color = (i) => ["--c-oscuro", "--c-gris"][i] ?? "--c-gris";
  if (acum && d.porDia) {
    $("#g-evol-tit").textContent = "Actividad por día";
    grafico("g-evol", "bar", d.porDia.map((x) => fmtFecha(x.dia)), [
      { label: "Llamadas TMK", data: d.porDia.map((x) => x.con), color: "--c-marca" },
      ...cs.map((c, i) => ({ label: `Registros ${etq(c)}`, data: d.porDia.map((x) => x.rc?.[c] ?? 0), color: color(i) })),
    ]);
  } else {
    $("#g-evol-tit").textContent = "Actividad por franja";
    const fs = Object.keys(d.fr ?? {}).sort();
    grafico("g-evol", "bar", fs, [
      { label: "Llamadas TMK", data: fs.map((f) => d.fr[f].con), color: "--c-marca" },
      ...cs.map((c, i) => ({ label: `Registros ${etq(c)}`, data: fs.map((f) => d.fr[f].rc?.[c] ?? 0), color: color(i) })),
    ]);
  }
  const t10 = top.slice(0, 10);
  $("#g-top-sub").textContent = "Gestiones de cada gestor: cola TMK y cada automarcador";
  grafico("g-top", "bar", t10.map((a) => a.nombre), [
    { label: "Llamadas TMK", data: t10.map((a) => a.con), color: "--c-marca" },
    ...cs.map((c, i) => ({ label: `Registros ${etq(c)}`, data: t10.map((a) => a["r:" + c]), color: color(i) })),
  ], { horizontal: true, apilado: true });

  const sel = $("#auto-sel");
  const opciones = `<option value="">Los dos automarcadores</option>` + cs.map((c) => `<option value="${esc(c)}">${esc(etq(c))} (${esc(c)})</option>`).join("");
  if (sel.dataset.o !== opciones) { sel.innerHTML = opciones; sel.dataset.o = opciones; sel.value = estado.auto; }
  pintarRanking(lista, top);
  pintarRegistro();
  pintarCampanas(d.camp);
  $("#pie").textContent = `Datos de BusinessObjects (Genesys), actualizados cada 20 minutos. Cola outbound: Agent Group + Skill (OUTBOUND); automarcador: HistReport_Automarcador. Uso interno.`;
}

// ----------------------------------------------------------------- marcador del equipo
const gFr = (x) => (x ? x.con + x.reg : 0);                       // gestiones de una franja
const franjasCon = (fr) => Object.keys(fr ?? {}).filter((f) => gFr(fr[f]) > 0).sort();
const hastaFranja = (fr, fc) => Object.entries(fr ?? {}).reduce((s, [f, x]) => s + (f <= fc ? gFr(x) : 0), 0);
const totalFr = (fr) => Object.values(fr ?? {}).reduce((s, x) => s + gFr(x), 0);
const minutos = (hhmm) => { const [h, m] = String(hhmm).split(":").map(Number); return h * 60 + m; };
const hhmm = (min) => `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
function variacion(a, b) {
  if (!b) return "";
  const v = a / b - 1;
  return `<span class="${v >= 0 ? "sube" : "baja"}">${v >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(v))}</span>`;
}
const dato = (etq, grande, nota = "", clase = "") => `<div class="marca-dato ${clase}"><div class="etiqueta">${etq}</div><div class="grande">${grande}</div>${nota ? `<div class="nota">${nota}</div>` : ""}</div>`;

function pintarMarcador(lista, t, d) {
  const acum = estado.periodo === "acum";
  const hoy = estado.hoy, ayer = estado.ayer || null;
  const cs = campanasVista();
  const reparto = `TMK ${fmtN(t.con)}${cs.map((c) => ` · ${esc(etq(c))} ${fmtN(d.camp[c]?.reg ?? 0)}`).join("")}`;
  const alertas = [];
  const html = [];

  if (acum) {
    const dias = d.porDia ?? [];
    const tot = t.con + t.reg;
    const mejor = dias.reduce((m, x) => (x.con + x.reg > (m ? m.con + m.reg : -1) ? x : m), null);
    $("#marcador-tit").textContent = "Marcador del equipo · acumulado de la competición";
    $("#marcador-sub").textContent = dias.length ? `Del ${fmtFecha(dias[0].dia)} al ${fmtFecha(dias.at(-1).dia)} (${dias.length} días)` : "";
    html.push(dato("Gestiones acumuladas", fmtN(tot), reparto, "principal"));
    html.push(dato("Media por día", fmtN(div(tot, dias.length)), `${fmtN(lista.length)} gestores han participado`));
    if (mejor) html.push(dato("Mejor día", fmtN(mejor.con + mejor.reg), fmtFecha(mejor.dia)));
    if (dias.length) { const h = dias.at(-1); html.push(dato("Hoy", fmtN(h.con + h.reg), "en curso")); }
    $("#marcador").innerHTML = html.join("");
    $("#alertas").innerHTML = `<li class="bien">Las alertas se calculan sobre el día en curso: cambia a "Hoy" para verlas.</li>`;
    $("#g-carrera-tit").textContent = "Carrera de la competición";
    $("#g-carrera-sub").textContent = "Gestiones acumuladas día a día";
    let s = 0;
    grafico("g-carrera", "line", dias.map((x) => fmtFecha(x.dia)), [{ label: "Acumulado", data: dias.map((x) => (s += x.con + x.reg)), color: "--c-marca" }]);
    return;
  }

  const fs = franjasCon(hoy.fr);
  const ult = fs.at(-1);                                  // franja más reciente con actividad
  const tot = totalFr(hoy.fr);
  $("#marcador-tit").textContent = "Marcador del equipo · hoy";
  $("#g-carrera-tit").textContent = "Carrera del día: hoy frente a ayer";
  $("#g-carrera-sub").textContent = "Gestiones acumuladas a lo largo del día";
  $("#marcador-sub").textContent = ult ? `Datos hasta la franja de las ${ult} (subidos a las ${fmtHora(hoy.subido)})` : "Todavía sin actividad hoy";
  html.push(dato("Gestiones de hoy", fmtN(tot), reparto, "principal"));

  // Ritmo: última hora (las dos últimas franjas) frente a la media del día
  if (ult) {
    const i = fs.length - 1;
    const hora = gFr(hoy.fr[fs[i]]) + (i > 0 ? gFr(hoy.fr[fs[i - 1]]) : 0);
    const horasDia = Math.max(0.5, (minutos(ult) + 30 - minutos(fs[0])) / 60);
    html.push(dato("Ritmo última hora", `${fmtN(hora)}<span class="pequeno"> /h</span>`, `media del día ${fmtN(tot / horasDia)} /h`));
  }

  // Frente a ayer a la misma hora y proyección
  let proy = NaN;
  if (ayer && ult) {
    const aMisma = hastaFranja(ayer.fr, ult), aTot = totalFr(ayer.fr);
    html.push(dato(`Ayer (${fmtFecha(ayer.dia)}) a esta hora`, fmtN(aMisma), `${variacion(tot, aMisma)} hoy · ayer cerró con ${fmtN(aTot)}`));
    if (aMisma > 0 && aTot > 0) proy = tot / (aMisma / aTot);
  }
  if (!Number.isFinite(proy) && ult) {
    const trans = minutos(ult) + 30 - minutos(fs[0] < CONFIG.inicio ? fs[0] : CONFIG.inicio);
    const jornada = minutos(CONFIG.fin) - minutos(fs[0] < CONFIG.inicio ? fs[0] : CONFIG.inicio);
    if (trans > 0) proy = tot * Math.max(1, jornada / trans);
  }
  if (Number.isFinite(proy)) html.push(dato("Proyección fin del día", fmtN(proy), ayer ? "si se mantiene el ritmo, con el perfil horario de ayer" : `a este ritmo hasta las ${CONFIG.fin}`));

  if (CONFIG.objetivoDia) {
    const p = Math.min(1, tot / CONFIG.objetivoDia);
    const quedan = Math.max(0, minutos(CONFIG.fin) - (ult ? minutos(ult) + 30 : minutos(CONFIG.inicio)));
    const faltan = Math.max(0, CONFIG.objetivoDia - tot);
    html.push(dato("Objetivo del día", `${fmtPct(tot / CONFIG.objetivoDia)}`,
      `${fmtN(tot)} de ${fmtN(CONFIG.objetivoDia)} · faltan ${fmtN(faltan)}${quedan ? ` (${fmtN(faltan / (quedan / 60))} /h)` : ""}<div class="progreso"><i style="width:${p * 100}%"></i></div>`));
    if (Number.isFinite(proy) && proy < CONFIG.objetivoDia) alertas.push(["mal", `A este ritmo el día acabaría en ${fmtN(proy)}: ${fmtN(CONFIG.objetivoDia - proy)} por debajo del objetivo.`]);
  }
  if (estado.acum?.porDia?.length > 1) {
    const at = estado.acum.porDia.reduce((s, x) => s + x.con + x.reg, 0);
    html.push(dato("Acumulado competición", fmtN(at), `${estado.acum.porDia.length} días, incluido hoy`));
  }
  $("#marcador").innerHTML = html.join("");

  // ---- alertas
  const min = Date.now() - new Date(String(hoy.subido)).getTime();
  const hLocal = new Date().getHours();
  if (min > 45 * 60e3 && hLocal >= 8 && hLocal < 23) alertas.push(["mal", `Los datos son de hace ${Math.round(min / 60e3)} min: revisa que el PC siga subiendo informes.`]);
  if (ayer && fs.length >= 2) {
    const f = fs.at(-2); // última franja completa
    const h = gFr(hoy.fr[f]), a = gFr(ayer.fr?.[f]);
    if (a >= 10 && h < a * 0.7) alertas.push(["mal", `Franja de las ${f}: ${fmtN(h)} gestiones, un ${fmtPct(1 - h / a)} menos que ayer a esa hora (${fmtN(a)}).`]);
    else if (a >= 10 && h > a * 1.2) alertas.push(["bien", `Franja de las ${f}: ${fmtN(h)} gestiones, un ${fmtPct(h / a - 1)} más que ayer (${fmtN(a)}).`]);
  }
  if (fs.length >= 2) {
    const ult2 = fs.slice(-2).reduce((s, f) => ({ m: s.m + hoy.fr[f].marc, c: s.c + hoy.fr[f].con }), { m: 0, c: 0 });
    const pDia = div(t.con, t.marc), pHora = div(ult2.c, ult2.m);
    if (ult2.m >= 10 && pHora < pDia - 0.1) alertas.push(["mal", `Cola TMK: en la última hora se completan el ${fmtPct(pHora)} de las marcadas (media del día ${fmtPct(pDia)}).`]);
  }
  // gestores con actividad hoy pero parados en la última hora
  if (ult) {
    const ultAct = {};
    for (const r of hoy.registro) if (r.hora > (ultAct[r.id] ?? "")) ultAct[r.id] = r.hora;
    for (const r of hoy.registroOut) { const fin = hhmm(minutos(r.f) + 30); if (fin > (ultAct[r.id] ?? "")) ultAct[r.id] = fin; }
    const ahora = Object.values(ultAct).sort().at(-1) ?? ult;
    const parados = Object.entries(ultAct).filter(([, h]) => minutos(ahora) - minutos(h) >= 60)
      .map(([id, h]) => `${esc(nombreDe(id))} (${h})`);
    if (parados.length) alertas.push(["", `${parados.length} gestor${parados.length > 1 ? "es" : ""} sin actividad en la última hora (última gestión): ${parados.slice(0, 12).join(", ")}${parados.length > 12 ? "…" : ""}`]);
  }
  $("#alertas").innerHTML = alertas.length ? alertas.map(([c, x]) => `<li class="${c}">${x}</li>`).join("") : `<li class="bien">Sin alertas: el equipo va a su ritmo.</li>`;

  // ---- carrera: acumulado del día hoy frente a ayer
  const todas = [...new Set([...Object.keys(hoy.fr), ...Object.keys(ayer?.fr ?? {})])].sort();
  let sh = 0, sa = 0;
  const serieHoy = todas.map((f) => (ult && f <= ult ? (sh += gFr(hoy.fr[f])) : null));
  const serieAyer = todas.map((f) => (sa += gFr(ayer?.fr?.[f])));
  grafico("g-carrera", "line", todas, [
    { label: "Hoy", data: serieHoy, color: "--c-marca" },
    ...(ayer ? [{ label: `Ayer (${fmtFecha(ayer.dia)})`, data: serieAyer, color: "--c-gris", discontinua: true }] : []),
  ]);
}

function opcionesGrafico({ apilado = false, horizontal = false } = {}) {
  const texto = css("--text-secondary"), rejilla = css("--grid");
  const ejeValor = { stacked: apilado, beginAtZero: true, grid: { color: rejilla }, border: { display: false }, ticks: { color: texto, precision: 0 } };
  const ejeCat = { stacked: apilado, ticks: { color: texto, maxRotation: 0, autoSkipPadding: 12 }, grid: { display: false } };
  return {
    responsive: true, maintainAspectRatio: false, animation: false, indexAxis: horizontal ? "y" : "x",
    interaction: { mode: "index", intersect: false },
    plugins: {
      legend: { position: "top", align: "start", labels: { color: texto, boxWidth: 10, boxHeight: 10, usePointStyle: true, pointStyle: "rectRounded" } },
      tooltip: { callbacks: { label: (c) => ` ${c.dataset.label}: ${fmtD(horizontal ? c.parsed.x : c.parsed.y)}` } },
    },
    scales: horizontal ? { x: ejeValor, y: { ...ejeCat, ticks: { color: texto, autoSkip: false } } } : { x: ejeCat, y: ejeValor },
  };
}
function grafico(id, tipo, etiquetas, series, opciones = {}) {
  if (!window.Chart) return;
  const datasets = series.map((s) => ({
    label: s.label, data: s.data, borderColor: css(s.color), backgroundColor: css(s.color),
    borderWidth: tipo === "line" ? 2.5 : 0, borderDash: s.discontinua ? [6, 4] : [], pointRadius: 0, pointHoverRadius: 5, tension: 0.2, spanGaps: false,
    borderRadius: 4, borderSkipped: "start", maxBarThickness: 22,
  }));
  graficos[id]?.destroy();
  graficos[id] = new Chart(document.getElementById(id), { type: tipo, data: { labels: etiquetas, datasets }, options: opcionesGrafico(opciones) });
}

function pintarTabla(idTabla, clave, columnas, filas) {
  const [campo, dir] = estado.orden[clave];
  const c = columnas.find((x) => x.k === campo) ?? columnas[0];
  const ord = [...filas].sort((a, b) => {
    const va = c.orden ? c.orden(a) : a[c.k], vb = c.orden ? c.orden(b) : b[c.k];
    if (typeof va === "string" || typeof vb === "string") return String(va ?? "").localeCompare(String(vb ?? ""), "es") * dir;
    return ((Number.isFinite(va) ? va : -Infinity) - (Number.isFinite(vb) ? vb : -Infinity)) * dir;
  });
  const t = document.getElementById(idTabla);
  t.innerHTML =
    `<thead><tr>${columnas.map((x) => `<th scope="col" data-k="${esc(x.k)}" class="${x.txt ? "txt" : ""}" ${x.k === campo ? `aria-sort="${dir > 0 ? "ascending" : "descending"}"` : ""} title="${esc(x.ayuda ?? x.t)}">${esc(x.t)}</th>`).join("")}</tr></thead>` +
    `<tbody>${ord.map((f) => `<tr>${columnas.map((x) => `<td class="${x.txt ? "txt" : ""}">${x.f ? x.f(f) : esc(f[x.k])}</td>`).join("")}</tr>`).join("")}</tbody>`;
  t.querySelectorAll("th").forEach((th) => th.addEventListener("click", () => {
    const k = th.dataset.k, cc = columnas.find((x) => x.k === k);
    estado.orden[clave] = [k, estado.orden[clave][0] === k ? -estado.orden[clave][1] : (cc.txt ? 1 : -1)];
    pintarTabla(idTabla, clave, columnas, filas);
  }));
}
const cero = (v, f) => (v ? f(v) : `<span class="cero">${f(0)}</span>`);
const cN = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => cero(a[k], fmtN) });
const cM = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => fmtM(a[k]) });
const cT = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => cero(a[k], fmtT) });
const cP = (k, t, ayuda) => ({ k, t, ayuda, f: (a) => fmtPct(a[k]) });
const nombreDe = (id) => { const a = datosVista().G[id] ?? estado.hoy?.G[id]; return a?.n || id; };

let columnasRanking = [];
function pintarRanking(lista, top) {
  const puesto = new Map(top.map((a, i) => [a.id, i + 1]));
  const codigos = {};
  for (const a of lista) for (const [c, n] of Object.entries(a.sel.cod)) sumar(codigos, c, n);
  const cs = campanasVista();
  const nomAuto = estado.auto ? etq(estado.auto) : "auto";
  const cA = (k, t, f, ayuda) => ({ k: "a:" + k, t, ayuda, orden: (a) => f(a.sel), f: (a) => { const v = f(a.sel); return k.startsWith("m") ? fmtM(v) : cero(v, fmtN); } });
  const cods = Object.entries(codigos).sort((a, b) => b[1] - a[1]).map(([c]) => c);
  columnasRanking = [
    { k: "puesto", t: "#", orden: (a) => -puesto.get(a.id), f: (a) => `<b>${puesto.get(a.id)}</b>` },
    { k: "nombre", t: "Gestor", txt: true, f: (a) => `<div class="nombre">${esc(a.nombre)}</div><div class="id">${esc(a.id)}</div>` },
    cN("gestiones", "Gestiones", "Llamadas TMK + registros automarcador"),
    cN("marc", "Marcadas TMK", "NDialing en la cola TMK outbound"), cN("con", "Llamadas TMK", "NOutbound en la cola TMK outbound"),
    cP("pCon", "% llamadas", "Llamadas / marcadas"), cM("tmo", "TMO TMK", "Tiempo total outbound / llamadas"), cT("talk", "Conversación TMK"),
    ...(estado.auto ? [] : cs.map((c) => cN("r:" + c, `Reg. ${etq(c)}`, `Registros codificados en ${c}`))),
    cA("reg", `Registros ${nomAuto}`, (x) => x.reg, "Registros codificados"),
    cA("v1", "1ª vuelta", (x) => x.v["1"] ?? 0, "Registros con attempt = 1"), cA("v2", "2ª vuelta", (x) => x.v["2"] ?? 0, "Registros con attempt = 2"),
    cA("v3", "3ª+ vuelta", (x) => x.v["3+"] ?? 0, "Registros con attempt 3 o más"),
    cA("llam", `Llamadas ${nomAuto}`, (x) => x.llam), cA("mLlam", "Llamada media", (x) => div(x.dur, x.llam)),
    ...cods.map((c) => ({ k: "c:" + c, t: c, ayuda: `Registros codificados como ${c}`, orden: (a) => a.sel.cod[c] ?? 0, f: (a) => cero(a.sel.cod[c] ?? 0, fmtN) })),
  ];
  const q = norm($("#buscar").value);
  const filas = lista.filter((a) => !q || norm(a.nombre).includes(q) || a.id.includes(q));
  $("#cuenta").textContent = `${filas.length} gestores`;
  pintarTabla("t-ranking", "ranking", columnasRanking, filas);
  estado.filasRanking = filas;
}

function pintarRegistro() {
  const h = estado.hoy;
  const q = norm($("#buscar-r").value);
  const filas = h.registro.map((r) => ({ ...r, nombre: nombreDe(r.id) }))
    .filter((r) => !q || norm(r.nombre).includes(q) || r.id.includes(q) || norm(r.camp).includes(q) || norm(r.cod).includes(q));
  $("#cuenta-r").textContent = `${fmtN(filas.length)} registros de hoy`;
  pintarTabla("t-registro", "registro", [
    { k: "hora", t: "Hora", txt: true },
    { k: "nombre", t: "Gestor", txt: true, f: (r) => `<div class="nombre">${esc(r.nombre)}</div><div class="id">${esc(r.id)}</div>` },
    { k: "camp", t: "Campaña", txt: true }, { k: "cod", t: "Codificación", txt: true },
    { k: "intento", t: "Intento", f: (r) => fmtN(r.intento) },
    { k: "dur", t: "Duración llamada", f: (r) => (r.dur == null ? `<span class="cero">sin llamada</span>` : fmtM(r.dur)) },
    { k: "gest", t: "T. gestión", f: (r) => fmtM(r.gest) },
  ], filas);
  estado.filasRegistro = filas;
  const out = h.registroOut.map((r) => ({ ...r, nombre: nombreDe(r.id) }))
    .filter((r) => !q || norm(r.nombre).includes(q) || r.id.includes(q));
  pintarTabla("t-registro-out", "out", [
    { k: "f", t: "Franja", txt: true }, { k: "nombre", t: "Gestor", txt: true, f: (r) => `<div class="nombre">${esc(r.nombre)}</div><div class="id">${esc(r.id)}</div>` },
    cN("marc", "Marcadas"), cN("con", "Llamadas"), cN("cortas", "< 3 s"), cT("talk", "Conversación"),
  ], out);
}

function pintarCampanas(camp) {
  const filas = Object.entries(camp).map(([n, k]) => ({ ...k, nombre: k.tipo === "auto" ? `${n} (${etq(n)})` : n, tipoTxt: k.tipo === "cola" ? "Cola outbound" : "Automarcador",
    llamMed: div(k.dur, k.llam), gestMed: div(k.gest, k.reg) }));
  pintarTabla("t-campanas", "campanas", [
    { k: "nombre", t: "Campaña / cola", txt: true }, { k: "tipoTxt", t: "Origen", txt: true },
    cN("marc", "Marcadas cola"), cN("con", "Llamadas cola"), cN("reg", "Registros auto"), cN("llam", "Llamadas auto"),
    { k: "v1", t: "1ª vuelta", orden: (k) => k.v?.["1"] ?? 0, f: (k) => (k.tipo === "auto" ? cero(k.v["1"] ?? 0, fmtN) : "") },
    { k: "v2", t: "2ª vuelta", orden: (k) => k.v?.["2"] ?? 0, f: (k) => (k.tipo === "auto" ? cero(k.v["2"] ?? 0, fmtN) : "") },
    { k: "v3", t: "3ª+ vuelta", orden: (k) => k.v?.["3+"] ?? 0, f: (k) => (k.tipo === "auto" ? cero(k.v["3+"] ?? 0, fmtN) : "") },
    cM("llamMed", "Llamada media"), cM("gestMed", "T. medio gestión"), cN("gestores", "Gestores", "Gestores distintos (en el acumulado: el máximo de un día)"),
  ], filas);
}

function csv(nombre, cab, filas) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const blob = new Blob(["﻿" + [cab.map(q).join(";"), ...filas.map((f) => f.map(q).join(";"))].join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  Object.assign(document.createElement("a"), { href: url, download: nombre }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ----------------------------------------------------------------- login y eventos
async function mostrarLogin() {
  $("#app").hidden = true; $("#login").hidden = false;
  let s = { modo: "clave" };
  try { s = await (await fetch("/api/sesion", { cache: "no-store" })).json(); } catch {}
  const ms = s.modo === "microsoft";
  $("#login-ms").hidden = !ms; $("#form-login").hidden = ms;
  if (!ms) $("#clave").focus();
}
function mostrarApp() { $("#login").hidden = true; $("#app").hidden = false; }

$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  $("#login-error").textContent = "";
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
  if (r.ok) { $("#clave").value = ""; cargar(); } else $("#login-error").textContent = "Clave incorrecta.";
});
$("#salir").addEventListener("click", async () => { await fetch("/api/logout", { method: "POST" }); estado.etag = null; mostrarLogin(); });
document.querySelectorAll('input[name="periodo"]').forEach((r) => r.addEventListener("change", async () => {
  estado.periodo = r.value;
  pintar();
  if (estado.periodo === "acum" && !estado.acum) { await cargarAcumulado(); pintar(); }
}));
$("#buscar").addEventListener("input", () => estado.hoy && pintar());
$("#auto-sel").addEventListener("change", (e) => { estado.auto = e.target.value; estado.hoy && pintar(); });
$("#buscar-r").addEventListener("input", () => estado.hoy && pintarRegistro());
$("#csv").addEventListener("click", () => {
  if (!estado.filasRanking) return;
  const cols = columnasRanking.filter((c) => c.k !== "puesto");
  csv(`competicion_tmk_${estado.periodo}.csv`, ["ID", ...cols.map((c) => c.t)],
    estado.filasRanking.map((a) => [a.id, ...cols.map((c) => { const v = c.orden ? c.orden(a) : a[c.k]; return typeof v === "number" ? (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : "") : v; })]));
});
$("#csv-r").addEventListener("click", () => {
  if (!estado.filasRegistro) return;
  csv(`registro_tmk_${estado.hoy.dia}.csv`, ["Hora", "ID", "Gestor", "Campaña", "Codificación", "Intento", "Duración llamada (s)", "T. gestión (s)"],
    estado.filasRegistro.map((r) => [r.hora, r.id, r.nombre, r.camp, r.cod, r.intento, r.dur ?? "", Math.round(r.gest)]));
});
document.querySelectorAll(".pestanas button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll(".pestanas button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  document.querySelectorAll("[data-panel]").forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.pestana; });
}));
$("#tema").addEventListener("click", () => {
  const actual = document.documentElement.dataset.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  const nuevo = actual === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nuevo;
  try { localStorage.setItem("tema", nuevo); } catch {}
  if (estado.hoy) pintar();
});
try { const t = localStorage.getItem("tema"); if (t) document.documentElement.dataset.theme = t; } catch {}
{
  const q = new URLSearchParams(location.search);
  if (q.has("error")) { $("#login-error").textContent = q.get("error"); history.replaceState(null, "", location.pathname); }
}

cargar();
setInterval(() => { if (!document.hidden) cargar(); }, REFRESCO_MS);
document.addEventListener("visibilitychange", () => { if (!document.hidden) cargar(); });
