// Competición TMK - pantalla fija para el departamento (/tv).
// Sin botones ni menús: se actualiza sola cada minuto y todo cabe en una pantalla.
// Los cálculos son los de tmk-datos.js, así que las cifras coinciden con /tmk.

const tv = { hoy: null, etag: null, ayer: undefined, pasados: null, diasComp: 0, ultCargaHist: 0 };
const graficosTv = {};

const gFr = (x) => (x ? x.con + x.reg : 0);
const franjasCon = (fr) => Object.keys(fr ?? {}).filter((f) => gFr(fr[f]) > 0).sort();
const hastaFranja = (fr, fc) => Object.entries(fr ?? {}).reduce((s, [f, x]) => s + (f <= fc ? gFr(x) : 0), 0);
const totalFr = (fr) => Object.values(fr ?? {}).reduce((s, x) => s + gFr(x), 0);
const minutos = (t) => { const [h, m] = String(t).split(":").map(Number); return h * 60 + m; };
const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// ---------------------------------------------------------------- carga
async function cargarTv() {
  try {
    const r = await fetch("/api/datos", { cache: "no-cache", headers: tv.etag ? { "If-None-Match": tv.etag } : {} });
    if (r.status === 401) return mostrarLoginTv();
    $("#login").hidden = true; $("#tv").hidden = false;
    if (r.status === 200) { tv.hoy = resumir(await r.json(), true); tv.etag = r.headers.get("ETag"); }
    // día anterior y días de la competición: al empezar y cada 15 min
    if (Date.now() - tv.ultCargaHist > 15 * 60e3) await cargarHistorico();
    pintarTv();
  } catch (e) {
    $("#tv-fresco").textContent = "Sin conexión, se reintenta en 1 min";
    $("#tv-punto").classList.add("mal");
  }
}

async function cargarHistorico() {
  try {
    const l = await (await fetch("/api/dias", { cache: "no-cache" })).json();
    const hoyDia = tv.hoy?.dia || l.hoy;
    const pasados = l.dias.map((d) => d.dia).filter((d) => d < hoyDia);
    const antDia = pasados.at(-1);
    tv.ayer = antDia ? await resumenDia(antDia) : null;
    let suma = 0, n = 0;
    for (const d of pasados.filter((d) => !CONFIG.desde || d >= CONFIG.desde)) {
      const x = d === antDia ? tv.ayer : await resumenDia(d);
      if (x) { suma += totalFr(x.fr); n++; }
    }
    tv.pasados = suma; tv.diasComp = n;
    tv.ultCargaHist = Date.now();
  } catch {}
}

// ---------------------------------------------------------------- pintado
function pintarTv() {
  const h = tv.hoy; if (!h) return;
  const ahora = new Date();
  const subido = new Date(String(h.subido));
  const min = (ahora - subido) / 60e3;
  $("#tv-fresco").textContent = `Datos de las ${fmtHora(h.subido)}`;
  $("#tv-punto").classList.toggle("mal", min > 45);
  $("#tv-sub").textContent = `Equipo RBE_Out_TMK_Piloto · ${ahora.toLocaleDateString("es-ES", { weekday: "long", day: "numeric", month: "long" })}`;

  // ---- totales del equipo
  const G = h.G;
  let tmk = 0, rbe = 0, marc = 0;
  for (const a of Object.values(G)) { tmk += a.con; rbe += a.reg; marc += a.marc; }
  const tot = totalFr(h.fr);
  const fs = franjasCon(h.fr), ult = fs.at(-1);
  const ayer = tv.ayer || null;

  // frente al día anterior a la misma hora
  let comp = `<div class="num">–</div><div class="nota">Sin día anterior con datos</div>`;
  let proy = NaN;
  if (ayer && ult) {
    const aMisma = hastaFranja(ayer.fr, ult), aTot = totalFr(ayer.fr);
    if (aMisma > 0) {
      const v = tot / aMisma - 1;
      comp = `<div class="num var ${v >= 0 ? "sube" : "baja"}">${v >= 0 ? "▲" : "▼"} ${fmtPct(Math.abs(v))}</div>` +
        `<div class="nota">${fmtN(tot)} hoy · ${fmtN(aMisma)} el ${fmtFecha(ayer.dia)} a las ${hhmm(minutos(ult) + 30)}</div>`;
      if (aTot > 0) proy = tot / (aMisma / aTot);
    }
  }
  // ritmo: las dos últimas franjas (última hora)
  let ritmo = 0;
  if (ult) { const i = fs.length - 1; ritmo = gFr(h.fr[fs[i]]) + (i > 0 ? gFr(h.fr[fs[i - 1]]) : 0); }
  const acum = tv.pasados != null ? tv.pasados + tot : NaN;
  const nDias = tv.diasComp + 1;

  $("#tv-heroes").innerHTML = [
    `<div class="hero principal"><div class="et">Gestiones de hoy</div><div class="num">${fmtN(tot)}</div>` +
      `<div class="nota">TMK ${fmtN(tmk)} · RBE Auto ${fmtN(rbe)}</div></div>`,
    `<div class="hero"><div class="et">Vs. día anterior</div>${comp}</div>`,
    `<div class="hero"><div class="et">Ritmo última hora</div><div class="num">${fmtN(ritmo)}<small> /h</small></div>` +
      `<div class="nota">${Number.isFinite(proy) ? `Proyección del día: <b>${fmtN(proy)}</b>` : "&nbsp;"}</div></div>`,
    `<div class="hero"><div class="et">Acumulado</div><div class="num">${Number.isFinite(acum) ? fmtN(acum) : "–"}</div>` +
      `<div class="nota">${nDias} día${nDias === 1 ? "" : "s"} desde el ${fmtFecha(CONFIG.desde)}</div></div>`,
  ].join("");

  pintarCarrera(h, ayer, ult);
  pintarRankingTv(h);

  // ---- pie: cola TMK y codificaciones de RBE Auto
  $("#tv-tmk").innerHTML = `<span class="et">Cola TMK</span>` +
    `<span class="chip-tv">Marcadas <b>${fmtN(marc)}</b></span><span class="chip-tv">Llamadas <b>${fmtN(tmk)}</b></span>`;
  const cod = {};
  for (const c of CONFIG.campanasAuto) for (const [x, n] of Object.entries(h.camp[c]?.cod ?? {})) sumar(cod, x, n);
  const top = Object.entries(cod).sort((a, b) => b[1] - a[1]).slice(0, 6);
  $("#tv-codif").innerHTML = `<span class="et">Codificaciones</span>` +
    (top.length ? top.map(([x, n]) => `<span class="chip-tv">${esc(x)} <b>${fmtN(n)}</b></span>`).join("") : `<span class="chip-tv">Sin registros todavía</span>`) +
    (min > 45 ? `<span class="aviso-tv">⚠ Datos de hace ${Math.round(min)} min: revisa el PC que sube los informes</span>` : "");
}

function pintarCarrera(h, ayer, ult) {
  if (!window.Chart) return;
  const todas = [...new Set([...Object.keys(h.fr), ...Object.keys(ayer?.fr ?? {})])].sort();
  let sh = 0, sa = 0;
  const serieHoy = todas.map((f) => (ult && f <= ult ? (sh += gFr(h.fr[f])) : null));
  const serieAyer = todas.map((f) => (sa += gFr(ayer?.fr?.[f])));
  $("#tv-carrera-sub").textContent = ayer ? `Gestiones acumuladas: hoy frente al ${fmtFecha(ayer.dia)}` : "Gestiones acumuladas de hoy";
  const texto = css("--text-secondary"), rejilla = css("--grid"), letra = Math.round(innerHeight * 0.018);
  const datasets = [
    { label: "Hoy", data: serieHoy, borderColor: css("--c-marca"), backgroundColor: css("--c-marca"), borderWidth: 4, pointRadius: 0, tension: 0.2 },
    ...(ayer ? [{ label: `Día anterior (${fmtFecha(ayer.dia)})`, data: serieAyer, borderColor: css("--c-gris"), backgroundColor: css("--c-gris"),
      borderWidth: 3, borderDash: [10, 7], pointRadius: 0, tension: 0.2 }] : []),
  ];
  graficosTv.c?.destroy();
  graficosTv.c = new Chart($("#tv-carrera"), {
    type: "line", data: { labels: todas, datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false,
      plugins: { legend: { position: "top", align: "start", labels: { color: texto, font: { size: letra }, boxWidth: letra, boxHeight: letra, usePointStyle: true, pointStyle: "rectRounded" } },
                 tooltip: { enabled: false } },
      scales: {
        x: { ticks: { color: texto, font: { size: letra }, maxRotation: 0, autoSkipPadding: 24 }, grid: { display: false } },
        y: { beginAtZero: true, ticks: { color: texto, font: { size: letra }, precision: 0 }, grid: { color: rejilla }, border: { display: false } },
      },
    },
  });
}

function pintarRankingTv(h) {
  // última actividad de cada gestor (registro del automarcador o franja de la cola TMK)
  const ultAct = {};
  for (const r of h.registro) if (r.hora > (ultAct[r.id] ?? "")) ultAct[r.id] = r.hora;
  for (const r of h.registroOut) { const fin = hhmm(minutos(r.f) + 30); if (fin > (ultAct[r.id] ?? "")) ultAct[r.id] = fin; }
  const ahora = Object.values(ultAct).sort().at(-1) ?? "00:00";
  const filas = Object.entries(CONFIG.gestores).map(([id, nombre]) => {
    const a = h.G[id] ?? { con: 0, reg: 0 };
    return { id, nombre, tmk: a.con, rbe: a.reg, total: a.con + a.reg, ult: ultAct[id] };
  }).sort((a, b) => b.total - a.total || a.nombre.localeCompare(b.nombre, "es"));
  const max = Math.max(1, ...filas.map((f) => f.total));
  const cTmk = css("--c-marca"), cRbe = css("--c-oscuro");
  $("#tv-leyenda").innerHTML = `<span><b style="background:${cTmk}"></b>Llamadas TMK</span><span><b style="background:${cRbe}"></b>Registros RBE Auto</span>` +
    `<span><i class="dot on"></i>activo en la última hora</span>`;
  $("#tv-ranking").innerHTML = filas.map((f, i) => {
    const activo = f.ult && minutos(ahora) - minutos(f.ult) < 60;
    return `<li class="fila p${i + 1}"><span class="pos">${i + 1}</span><div class="quien">` +
      `<div class="nombre"><i class="dot ${activo ? "on" : "off"}" title="${activo ? "Activo" : "Sin actividad en la última hora"}"></i>${esc(f.nombre)}</div>` +
      `<div class="tvbar">${f.tmk ? `<i style="width:${(f.tmk / max) * 100}%;background:${cTmk}"></i>` : ""}${f.rbe ? `<i style="width:${(f.rbe / max) * 100}%;background:${cRbe}"></i>` : ""}</div>` +
      `<div class="info">TMK ${fmtN(f.tmk)} · RBE ${fmtN(f.rbe)}${f.ult ? ` · última ${f.ult}` : " · sin actividad hoy"}</div></div>` +
      `<span class="total">${fmtN(f.total)}</span></li>`;
  }).join("");
}

// ---------------------------------------------------------------- login y arranque
async function mostrarLoginTv() {
  $("#tv").hidden = true; $("#login").hidden = false;
  let s = { modo: "clave" };
  try { s = await (await fetch("/api/sesion", { cache: "no-store" })).json(); } catch {}
  const ms = s.modo === "microsoft";
  $("#login-ms").hidden = !ms; $("#form-login").hidden = ms;
  if (!ms) $("#clave").focus();
}
$("#form-login").addEventListener("submit", async (e) => {
  e.preventDefault();
  const r = await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clave: $("#clave").value }) });
  if (r.ok) { $("#clave").value = ""; cargarTv(); } else $("#login-error").textContent = "Clave incorrecta.";
});
if (new URLSearchParams(location.search).has("claro")) document.documentElement.dataset.theme = "light";

const reloj = () => { $("#tv-hora").textContent = new Date().toLocaleTimeString("es-ES", { hour: "2-digit", minute: "2-digit" }); };
reloj(); setInterval(reloj, 15e3);
cargarTv(); setInterval(cargarTv, 60e3);
addEventListener("resize", () => tv.hoy && pintarTv());
setTimeout(() => location.reload(), 6 * 3600e3); // una recarga cada 6 h para que la pantalla no acumule memoria
