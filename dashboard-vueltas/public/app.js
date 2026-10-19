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
  // En CSV se leen las celdas como texto: SheetJS interpretaría dd/mm/aaaa como mm/dd/aaaa.
  const csv = /\.(csv|txt)$/i.test(file.name);
  const wb = XLSX.read(buf, { cellDates: true, dense: true, raw: csv });
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
  $('btnCalc').disabled = !bbdd;
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
  recalcular();
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
$('btnRango').addEventListener('click', () => { aplicarRango(); recalcular(); });
cargarIndice();

// ---------- commlogs guardados (Cloudflare) ----------
// Se guardan por mes de la fecha del commlog: logs:<AAAA-MM> -> [[id, 'AAAA-MM-DD HH:MM', key4], ...]
const cacheLogs = {};
async function logsDeMes(mes) {
  if (!cacheLogs[mes]) cacheLogs[mes] = api('/api/commlogs?mes=' + mes).then((d) => d.logs).catch(() => []);
  return cacheLogs[mes];
}
const mesesEntre = (desde, hasta) => {
  const out = [];
  let [y, m] = desde.slice(0, 7).split('-').map(Number);
  const fin = hasta.slice(0, 7);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, '0')}`;
    out.push(k);
    if (k >= fin) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
};

async function cargarIndiceLogs() {
  try {
    const idx = await api('/api/commlogs');
    const total = idx.reduce((s, i) => s + i.n, 0);
    const ult = idx.map((i) => i.max).sort().pop();
    $('stLogs').textContent = idx.length
      ? `${fmt(total)} commlogs guardados · último commlog ${ult} · actualizado ${new Date(Math.max(...idx.map((i) => i.actualizado))).toLocaleString('es-ES')}`
      : 'Todavía no hay commlogs guardados. Súbelos abajo.';
  } catch (err) {
    $('stLogs').textContent = 'Error cargando commlogs: ' + err.message;
  }
}
cargarIndiceLogs();

const fmtTs = (d) => `${isoDia(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

$('fLogs').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  logRows = [];
  $('btnGuardarLogs').disabled = true;
  if (!files.length) return;
  $('stSubida').textContent = 'Leyendo…';
  try {
    for (const f of files) logRows.push(...(await leerFichero(f)));
    setColsLogs(Object.keys(logRows[0] || {}));
    $('stSubida').textContent = `${fmt(logRows.length)} filas en ${files.length} fichero(s). Revisa las columnas y pulsa Guardar.`;
    $('btnGuardarLogs').disabled = !logRows.length;
  } catch (err) {
    $('stSubida').textContent = 'Error leyendo commlogs: ' + err.message;
  }
});

function setColsLogs(cols) {
  rellenarSelect($('colLogId'), cols, P_ID);
  rellenarSelect($('colLogFecha'), cols, P_FECHA);
  rellenarSelect($('colLogKey4'), cols, P_KEY4);
  // El formato es siempre el mismo: se recuerda la última elección.
  for (const [sel, k] of [['colLogId', 'cId'], ['colLogFecha', 'cFecha'], ['colLogKey4', 'cKey4']]) {
    if (cols.includes(load(k))) $(sel).value = load(k);
  }
}

$('btnGuardarLogs').addEventListener('click', async () => {
  const ci = $('colLogId').value, cf = $('colLogFecha').value, ck = $('colLogKey4').value;
  store('cId', ci); store('cFecha', cf); store('cKey4', ck);
  const porMes = {};
  let malas = 0;
  for (const r of logRows) {
    const d = parseFecha(r[cf]);
    const id = String(r[ci] ?? '').trim().replace(/\.0+$/, '');
    if (!d || !id) { malas++; continue; }
    const ts = fmtTs(d);
    (porMes[ts.slice(0, 7)] ||= []).push([id, ts, String(r[ck] ?? '').trim()]);
  }
  const meses = Object.keys(porMes).sort();
  if (!meses.length) { $('stSubida').textContent = 'No hay filas con instalación y fecha válidas. Revisa las columnas.'; return; }
  $('btnGuardarLogs').disabled = true;
  try {
    for (const [i, mes] of meses.entries()) {
      $('stSubida').textContent = `Guardando ${nombreMes(mes)} (${i + 1}/${meses.length})…`;
      await api('/api/commlogs?mes=' + mes, { method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ logs: porMes[mes] }) });
      delete cacheLogs[mes];
    }
    $('stSubida').textContent = `Guardados ${fmt(logRows.length - malas)} commlogs (${meses.map(nombreMes).join(', ')})` +
      (malas ? ` · ${fmt(malas)} filas sin instalación o fecha ignoradas` : '');
    $('fLogs').value = '';
    logRows = [];
    await cargarIndiceLogs();
    recalcular();
  } catch (err) {
    $('stSubida').textContent = 'Error guardando: ' + err.message;
    $('btnGuardarLogs').disabled = false;
  }
});

// ---------- cálculo ----------
async function recalcular() {
  if (!bbdd) return;
  const desde = $('desde').value, hasta = $('hasta').value;
  $('stCalc').textContent = 'Calculando…';
  const t0 = performance.now();
  const logs = [];
  for (const mes of mesesEntre(desde, hasta)) {
    for (const [id, ts, key4] of await logsDeMes(mes)) logs.push({ id, fecha: parseFecha(ts), key4 });
  }
  resultados = {};
  for (const [camp, ids] of Object.entries(bbdd.campanas)) resultados[camp] = calcular(ids, logs, desde, hasta);
  $('stCalc').textContent = `BBDD ${nombreMes(bbdd.mes)} · commlogs ${desde} → ${hasta} · ${fmt(logs.length)} commlogs leídos · ${fmt(performance.now() - t0)} ms`;
  $('res').classList.remove('hidden');
  pintarCampana();
}
$('btnCalc').addEventListener('click', recalcular);

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
for (const id of ['desde', 'hasta']) $(id).addEventListener('change', () => recalcular());
