import { calcular, parseFecha, rangoPorDefecto, isoDia } from './calc.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (a, b) => (b ? fmt((100 * a) / b, 1) + ' %' : '–');

let bbdd = null; // {mes, campanas: {nombre: [ids]}}
let carga = null;
let resultados = {};
let logRows = [];
let ultimo = null;

// ---------- utilidades ----------
function store(k, v) { try { localStorage.setItem('vueltas.' + k, v); } catch {} }
function load(k) { try { return localStorage.getItem('vueltas.' + k) || ''; } catch { return ''; } }

async function leerFichero(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { cellDates: true, dense: true });
  const ws = wb.Sheets[wb.SheetNames[0]];
  return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
}

function rellenarSelect(sel, cols, patrones) {
  sel.innerHTML = cols.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  const hit = cols.find((c) => patrones.some((p) => p.test(c)));
  if (hit) sel.value = hit;
}

const P_ID = [/^id[_ ]?inst/i, /instalaci/i, /installation/i, /^inst/i, /^id$/i];
const P_FECHA = [/^fecha$/i, /fecha/i, /date/i, /creat/i];
const P_KEY4 = [/^key4$/i, /key\s*4/i];

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function actualizarBoton() {
  $('btnCalc').disabled = !(bbdd && logRows.length);
}

// ---------- BBDD fijas (guardadas en Cloudflare) ----------
async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) { location.reload(); throw new Error('Sesión caducada'); }
  if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
  return res.json();
}

const nombreMes = (m) => {
  const [y, mm] = m.split('-').map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
};

async function cargarIndice(preferido) {
  try {
    const idx = await api('/api/bbdd');
    if (!idx.length) {
      $('mes').innerHTML = '';
      $('stBbdd').textContent = 'Todavía no hay BBDD guardadas. Cárgalas abajo.';
      return;
    }
    $('mes').innerHTML = idx.map((i) => `<option value="${i.mes}">${nombreMes(i.mes)}</option>`).join('');
    const sel = preferido || load('mes');
    $('mes').value = idx.some((i) => i.mes === sel) ? sel : idx[idx.length - 1].mes;
    await cambiarMes();
  } catch (err) {
    $('stBbdd').textContent = 'Error cargando BBDD: ' + err.message;
  }
}

async function cambiarMes() {
  const mes = $('mes').value;
  store('mes', mes);
  aplicarRango();
  $('stBbdd').textContent = 'Cargando BBDD…';
  bbdd = await api('/api/bbdd?mes=' + encodeURIComponent(mes));
  const camps = Object.keys(bbdd.campanas);
  $('campana').innerHTML = camps.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  if (camps.includes(load('campana'))) $('campana').value = load('campana');
  $('stBbdd').textContent = `BBDD de ${nombreMes(mes)}: ` +
    camps.map((c) => `${c} ${fmt(bbdd.campanas[c].length)}`).join(' · ');
  actualizarBoton();
}
$('mes').addEventListener('change', () => cambiarMes().catch((e) => ($('stBbdd').textContent = 'Error: ' + e.message)));
$('campana').addEventListener('change', () => {
  store('campana', $('campana').value);
  if (resultados[$('campana').value]) pintarCampana();
});

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
function mesDeNombre(nombre) {
  const m = nombre.match(new RegExp(`(${Object.keys(MESES).join('|')})[ _-]?(\\d{2,4})`, 'i'));
  if (!m) return '';
  const y = +m[2] < 100 ? 2000 + +m[2] : +m[2];
  return `${y}-${String(MESES[m[1].toLowerCase()]).padStart(2, '0')}`;
}

// Lee todas las pestañas del Excel: cada pestaña es una campaña.
$('fBbdd').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  carga = null;
  $('btnGuardar').disabled = true;
  if (!f) return;
  $('stCarga').textContent = 'Leyendo…';
  try {
    const wb = XLSX.read(await f.arrayBuffer(), { dense: true });
    const campanas = {};
    for (const nombre of wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '', raw: true });
      const col = Object.keys(rows[0] || {}).find((c) => /numero_de_instalacion/i.test(c)) ||
        Object.keys(rows[0] || {}).find((c) => P_ID.some((p) => p.test(c)));
      if (!col) continue;
      const ids = new Set();
      for (const r of rows) {
        const v = String(r[col] ?? '').trim().replace(/\.0+$/, '');
        if (v) ids.add(v);
      }
      if (ids.size) campanas[nombre.trim()] = [...ids];
    }
    if (!Object.keys(campanas).length) throw new Error('No encuentro la columna Numero_de_Instalacion en ninguna pestaña');
    carga = campanas;
    $('mesCarga').value = mesDeNombre(f.name) || $('mesCarga').value;
    $('stCarga').textContent = Object.entries(campanas).map(([c, v]) => `${c}: ${fmt(v.length)}`).join(' · ') +
      (mesDeNombre(f.name) ? '' : ' — no detecto el mes en el nombre, elígelo a mano');
    $('btnGuardar').disabled = false;
  } catch (err) {
    $('stCarga').textContent = 'Error leyendo el fichero: ' + err.message;
  }
});

$('btnGuardar').addEventListener('click', async () => {
  const mes = $('mesCarga').value;
  if (!carga || !mes) return;
  $('btnGuardar').disabled = true;
  $('stCarga').textContent = 'Guardando…';
  try {
    await api('/api/bbdd?mes=' + mes, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes, campanas: carga }) });
    $('stCarga').textContent = `Guardada la BBDD de ${nombreMes(mes)}.`;
    $('fBbdd').value = '';
    carga = null;
    await cargarIndice(mes);
  } catch (err) {
    $('stCarga').textContent = 'Error guardando: ' + err.message;
    $('btnGuardar').disabled = false;
  }
});

// ---------- rango de fechas ----------
function aplicarRango() {
  if (!$('mes').value) return;
  const r = rangoPorDefecto($('mes').value);
  $('desde').value = r.desde;
  $('hasta').value = r.hasta;
}
$('btnRango').addEventListener('click', aplicarRango);
cargarIndice();

// ---------- commlogs desde fichero ----------
$('fLogs').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  $('stLogs').textContent = 'Leyendo…';
  try {
    logRows = [];
    for (const f of files) logRows.push(...(await leerFichero(f)));
    setColsLogs(Object.keys(logRows[0] || {}));
    $('stLogs').textContent = `${fmt(logRows.length)} commlogs en ${files.length} fichero(s)`;
  } catch (err) {
    $('stLogs').textContent = 'Error leyendo commlogs: ' + err.message;
  }
  actualizarBoton();
});

function setColsLogs(cols) {
  rellenarSelect($('colLogId'), cols, P_ID);
  rellenarSelect($('colLogFecha'), cols, P_FECHA);
  rellenarSelect($('colLogKey4'), cols, P_KEY4);
}

// ---------- commlogs desde Power BI (dataflow) con tu usuario Microsoft ----------
const CFG = ['Tenant', 'Client', 'Group', 'Dataset', 'Tabla', 'ColId', 'ColFecha', 'ColKey4'];
for (const k of CFG) {
  const el = $('cfg' + k);
  el.value = load('cfg' + k);
  el.addEventListener('change', () => store('cfg' + k, el.value.trim()));
}
const cfg = (k) => $('cfg' + k).value.trim() || $('cfg' + k).placeholder;

const msal_browser_ns = window.msal;
let msal = null;
async function tokenPowerBI() {
  const tenant = $('cfgTenant').value.trim();
  const client = $('cfgClient').value.trim();
  if (!tenant || !client) throw new Error('Rellena Tenant ID y Client ID en la configuración de conexión.');
  if (!msal || msal.__cfg !== tenant + client) {
    msal = new msal_browser_ns.PublicClientApplication({
      auth: { clientId: client, authority: `https://login.microsoftonline.com/${tenant}`, redirectUri: location.origin + location.pathname },
      cache: { cacheLocation: 'localStorage' },
    });
    msal.__cfg = tenant + client;
    if (msal.initialize) await msal.initialize();
  }
  const scopes = ['https://analysis.windows.net/powerbi/api/Dataset.Read.All'];
  let account = msal.getAllAccounts()[0];
  if (!account) account = (await msal.loginPopup({ scopes })).account;
  try {
    return (await msal.acquireTokenSilent({ scopes, account })).accessToken;
  } catch {
    return (await msal.acquireTokenPopup({ scopes, account })).accessToken;
  }
}
const daxCol = (t, c) => `'${t.replace(/'/g, "''")}'[${c.replace(/]/g, ']]')}]`;

// executeQueries devuelve como máximo 100.000 filas por consulta, así que se
// pide día a día.
async function consultarDia(token, dia) {
  const t = cfg('Tabla');
  const [y, m, d] = dia.split('-').map(Number);
  const fecha = daxCol(t, cfg('ColFecha'));
  const dax = `EVALUATE SELECTCOLUMNS(
    FILTER('${t.replace(/'/g, "''")}', ${fecha} >= DATE(${y},${m},${d}) && ${fecha} < DATE(${y},${m},${d}) + 1),
    "id", ${daxCol(t, cfg('ColId'))}, "fecha", ${fecha}, "key4", ${daxCol(t, cfg('ColKey4'))})`;
  const url = `https://api.powerbi.com/v1.0/myorg/groups/${cfg('Group')}/datasets/${cfg('Dataset')}/executeQueries`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ queries: [{ query: dax }], serializerSettings: { includeNulls: true } }),
  });
  if (!res.ok) throw new Error(`Power BI ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const json = await res.json();
  const rows = json.results?.[0]?.tables?.[0]?.rows || [];
  return rows.map((r) => ({ id: r['[id]'], fecha: r['[fecha]'], key4: r['[key4]'] }));
}

$('btnPbi').addEventListener('click', async () => {
  const btn = $('btnPbi');
  btn.disabled = true;
  try {
    for (const k of ['Group', 'Dataset']) if (!$('cfg' + k).value.trim()) throw new Error('Rellena Workspace ID y Dataset ID.');
    $('stLogs').textContent = 'Iniciando sesión en Microsoft…';
    const token = await tokenPowerBI();
    const dias = [];
    for (let d = parseFecha($('desde').value); isoDia(d) <= $('hasta').value; d.setDate(d.getDate() + 1)) dias.push(isoDia(d));
    const out = [];
    for (let i = 0; i < dias.length; i++) {
      $('stLogs').textContent = `Leyendo dataflow… día ${dias[i]} (${i + 1}/${dias.length}) · ${fmt(out.length)} commlogs`;
      out.push(...(await consultarDia(token, dias[i])));
    }
    logRows = out;
    setColsLogs(['id', 'fecha', 'key4']);
    $('stLogs').textContent = `${fmt(out.length)} commlogs leídos de Power BI (${dias[0]} → ${dias[dias.length - 1]})`;
  } catch (err) {
    $('stLogs').textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    actualizarBoton();
  }
});

// ---------- cálculo ----------
$('btnCalc').addEventListener('click', () => {
  const t0 = performance.now();
  const ci = $('colLogId').value, cf = $('colLogFecha').value, ck = $('colLogKey4').value;
  const logs = logRows.map((r) => ({ id: r[ci], fecha: parseFecha(r[cf]), key4: r[ck] }));
  resultados = {};
  for (const [camp, ids] of Object.entries(bbdd.campanas)) {
    resultados[camp] = calcular(ids, logs, $('desde').value, $('hasta').value);
  }
  $('stCalc').textContent = `Calculado en ${fmt(performance.now() - t0)} ms · BBDD ${nombreMes(bbdd.mes)} · commlogs ${$('desde').value} → ${$('hasta').value}`;
  $('res').classList.remove('hidden');
  pintarCampana();
});

function pintarCampana() {
  const sel = $('campana').value;
  const filas = Object.entries(resultados).map(([c, r]) => {
    const s = r.resumen;
    return `<tr data-c="${escapeHtml(c)}" class="${c === sel ? 'sel' : ''}"><td>${escapeHtml(c)}</td><td>${fmt(s.total)}</td><td>${fmt(s.excluidas)}</td>
      <td>${fmt(s.gestionables)}</td><td>${fmt(s.vueltasCompletas)}</td><td>${fmt(s.mediaIntentos, 2)}</td>
      <td>${fmt(s.contactadas)} (${pct(s.contactadas, s.gestionables)})</td><td>${fmt(s.ilocalizadas)} (${pct(s.ilocalizadas, s.gestionables)})</td>
      <td>${fmt(s.sinIntentos)} (${pct(s.sinIntentos, s.gestionables)})</td><td>${fmt(s.mediaIlocAntes, 2)}</td><td>${fmt(s.logsEnRango)}</td></tr>`;
  }).join('');
  $('tablaCamp').innerHTML = `<thead><tr><th>Campaña</th><th>BBDD</th><th>Excluidas</th><th>Gestionables</th><th>Vueltas completas</th>
    <th>Intentos medios</th><th>Contactadas</th><th>Ilocalizadas</th><th>Sin intentos</th><th>Iloc. antes de contacto</th><th>Commlogs</th></tr></thead><tbody>${filas}</tbody>`;
  $('tablaCamp').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    $('campana').value = tr.dataset.c;
    store('campana', tr.dataset.c);
    pintarCampana();
  }));
  $('tituloCamp').textContent = `Detalle · ${sel}`;
  ultimo = resultados[sel];
  pintar(ultimo);
}

function pintar(r) {
  const s = r.resumen;
  $('res').classList.remove('hidden');
  const kpis = [
    ['Instalaciones BBDD', fmt(s.total), ''],
    ['Excluidas', fmt(s.excluidas), pct(s.excluidas, s.total) + ' de la BBDD'],
    ['Gestionables', fmt(s.gestionables), 'BBDD sin excluidas'],
    ['Vueltas completas', fmt(s.vueltasCompletas), 'todas con ≥N intentos o contactadas'],
    ['Intentos medios', fmt(s.mediaIntentos, 2), fmt(s.totalIntentos) + ' intentos'],
    ['Contactadas', fmt(s.contactadas), pct(s.contactadas, s.gestionables)],
    ['Ilocalizadas', fmt(s.ilocalizadas), pct(s.ilocalizadas, s.gestionables) + ' · llamadas sin contacto'],
    ['Sin intentos', fmt(s.sinIntentos), pct(s.sinIntentos, s.gestionables)],
    ['Iloc. antes de contacto', fmt(s.mediaIlocAntes, 2), `media · ${fmt(s.ilocAntesTotal)} en total`],
  ];
  $('kpis').innerHTML = kpis.map(([l, v, sub]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('');

  barras($('chVueltas'), r.vueltas.map((v) => ({
    label: 'V' + v.n, segs: [{ v: v.pct * 100, c: 'var(--s1)' }], top: fmt(v.pct * 100, 0) + '%',
    tip: `Vuelta ${v.n}\n${fmt(v.cubiertas)} cubiertas (${fmt(v.pct * 100, 1)} %)\n${fmt(v.conN)} con ≥${v.n} intentos`,
  })), 100);
  barras($('chIloc'), r.distIlocAntes.map((b) => ({
    label: b.label, segs: [{ v: b.n, c: 'var(--s1)' }], top: fmt(b.n),
    tip: `${b.label} ilocalizado(s) antes del contacto\n${fmt(b.n)} instalaciones (${pct(b.n, s.contactadas)})`,
  })));
  barras($('chIntentos'), r.distIntentos.map((b) => ({
    label: b.label, segs: [{ v: b.n, c: 'var(--s1)' }], top: fmt(b.n),
    tip: `${b.label} intento(s)\n${fmt(b.n)} instalaciones (${pct(b.n, s.gestionables)})`,
  })));
  barras($('chDia'), r.porDia.map((d) => ({
    label: d.dia.slice(8),
    segs: [{ v: d.no_contacto, c: 'var(--s2)' }, { v: d.contacto, c: 'var(--s1)' }],
    tip: `${d.dia}\nNo contacto: ${fmt(d.no_contacto)}\nContacto válido: ${fmt(d.contacto)}\nTotal: ${fmt(d.no_contacto + d.contacto)}`,
  })));
  tabla();
}

function barras(el, datos, max) {
  max = max || Math.max(1, ...datos.map((d) => d.segs.reduce((a, s) => a + s.v, 0)));
  const paso = Math.ceil(datos.length / 16);
  el.innerHTML = `<div class="bars">${datos.map((d, i) => {
    const tot = d.segs.reduce((a, s) => a + s.v, 0);
    return `<div class="bar" data-i="${i}">${d.segs.map((s) => `<i style="height:${(100 * s.v) / max}%;background:${s.c}"></i>`).join('')}${
      d.top && datos.length <= 16 ? `<span class="vl" style="bottom:calc(${(100 * tot) / max}% + 2px)">${d.top}</span>` : ''}</div>`;
  }).join('')}</div><div class="xl">${datos.map((d, i) => `<span>${i % paso ? '' : d.label}</span>`).join('')}</div>`;
  el.querySelectorAll('.bar').forEach((b) => {
    b.addEventListener('mousemove', (e) => tip(datos[b.dataset.i].tip, e));
    b.addEventListener('mouseleave', () => tip());
  });
}

function tip(txt, e) {
  const t = $('tip');
  if (!txt) return t.classList.add('hidden');
  t.textContent = txt;
  t.classList.remove('hidden');
  const x = Math.min(e.clientX + 12, innerWidth - t.offsetWidth - 8);
  t.style.left = x + 'px';
  t.style.top = e.clientY + 12 + 'px';
}

const ESTADOS = { contactada: 'Contactada', ilocalizada: 'Ilocalizada', sin_intentos: 'Sin intentos', excluida: 'Excluida' };
const COLS = [['id', 'Instalación'], ['estado', 'Estado'], ['intentos', 'Intentos'], ['noContacto', 'No contacto'],
  ['ilocAntes', 'Iloc. antes de contacto'], ['primerContacto', 'Primer contacto'], ['ultimoLog', 'Último commlog']];

function filas() {
  const f = $('filtro').value;
  return ultimo.detalle.filter((d) => !f || d.estado === f);
}
function tabla() {
  const rows = filas();
  $('tabla').innerHTML = `<thead><tr>${COLS.map((c) => `<th>${c[1]}</th>`).join('')}</tr></thead><tbody>${
    rows.slice(0, 500).map((d) => `<tr>${COLS.map(([k]) => `<td>${escapeHtml(k === 'estado' ? ESTADOS[d[k]] : d[k] ?? '')}</td>`).join('')}</tr>`).join('')
  }</tbody>${rows.length > 500 ? `<caption style="caption-side:bottom;padding:8px;color:var(--muted)">Mostrando 500 de ${fmt(rows.length)} — exporta a CSV para verlas todas</caption>` : ''}`;
}
$('filtro').addEventListener('change', () => ultimo && tabla());
$('btnCsv').addEventListener('click', () => {
  if (!ultimo) return;
  const lines = [COLS.map((c) => c[1]).join(';'), ...filas().map((d) => COLS.map(([k]) => (k === 'estado' ? ESTADOS[d[k]] : d[k] ?? '')).join(';'))];
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' }));
  a.download = `vueltas_${$('mes').value}_${$('campana').value.replace(/\W+/g, '_')}.csv`;
  a.click();
});
