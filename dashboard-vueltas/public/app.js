import { calcular, delDia, parseFecha, rangoPorDefecto, isoDia } from './calc.js';
import { leerColumnasXlsx } from './xlsxstream.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (a, b) => (b ? fmt((100 * a) / b, 1) + ' %' : '–');

let bbdd = null; // {mes, campanas: {nombre: [ids]}}
let carga = null;
let resultados = {};
let cacheComp = {};
let ultimo = null;
// Informe activo: '' = principal, 'sa' = Second Attempt (sus propias BBDD, mismos commlogs).
const progDeHash = () => ({ '#sa': 'sa', '#to': 'to' })[location.hash] || '';
let PROG = progDeHash();
const urlBbdd = (qs = '', prog = PROG) => '/api/bbdd' + (qs || prog ? '?' : '') + [qs, prog && 'prog=' + prog].filter(Boolean).join('&');
const kp = (k) => (PROG ? k + '.' + PROG : k); // claves de localStorage por informe

// ---------- utilidades ----------
function store(k, v) { try { localStorage.setItem('vueltas.' + k, v); } catch {} }
function load(k) { try { return localStorage.getItem('vueltas.' + k) || ''; } catch { return ''; } }

const normCol = (c) => String(c ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
const esCabeceraLogs = (fila) => {
  const n = fila.map(normCol);
  return n.some((c) => c === 'insno' || c.endsWith('insno')) && n.some((c) => c === 'key4' || c.endsWith('key4'));
};

async function leerFichero(file) {
  const buf = await file.arrayBuffer();
  const cab = new Uint8Array(buf.slice(0, 4));
  // Un .xlsx normal es un ZIP (PK). Si empieza por D0 CF 11 E0 está cifrado
  // (etiqueta de confidencialidad / contraseña) y no se puede leer en el navegador.
  if (/\.xlsx$/i.test(file.name) && cab[0] === 0xd0 && cab[1] === 0xcf) {
    throw new Error('el Excel está protegido (etiqueta de confidencialidad o contraseña). Ábrelo y guárdalo como CSV, o quita la protección, y súbelo de nuevo');
  }
  // En CSV se leen las celdas como texto: SheetJS interpretaría dd/mm/aaaa como mm/dd/aaaa.
  const csv = /\.(csv|txt)$/i.test(file.name);
  const wb = XLSX.read(buf, { cellDates: true, dense: true, raw: csv });
  // El libro de commlogs puede tener varias pestañas: se usa la que tiene las columnas
  // ins_no y key4 (la Query), mirando las primeras filas por si la cabecera no está en la 1.
  const nombres = [...wb.SheetNames].sort((a, b) => /query/i.test(b) - /query/i.test(a));
  const vistas = [];
  for (const nombre of nombres) {
    const ws = wb.Sheets[nombre];
    if (!ws || !ws['!ref']) { vistas.push(`${nombre} (vacía)`); continue; }
    const primeras = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: true, blankrows: true }).slice(0, 30);
    const fila = primeras.findIndex(esCabeceraLogs);
    if (fila >= 0) {
      const rango = XLSX.utils.decode_range(ws['!ref']);
      rango.s.r += fila;
      return XLSX.utils.sheet_to_json(ws, { defval: '', raw: true, range: rango });
    }
    const cabecera = primeras.find((r) => r.some((c) => String(c).trim())) || [];
    vistas.push(`${nombre} (${cabecera.slice(0, 6).map((c) => String(c).trim()).join(', ') || 'sin datos'}${cabecera.length > 6 ? '…' : ''})`);
  }
  // Para la BBDD u otros ficheros: primera pestaña tal cual.
  const filas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: true });
  filas.pestanasVistas = vistas;
  return filas;
}

const P_ID = [/^ins_no$/i, /^insno$/i, /insno$/i, /^numero_de_instalacion$/i, /^id[_ ]?inst/i, /instalaci/i, /installation/i, /^inst/i, /^id$/i];
const P_FECHA = [/^fecha$/i, /fecha/i, /date/i, /creat/i];
const P_KEY4 = [/^key4$/i, /key4$/i];

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

// Una BBDD se identifica por AAAA-MM o AAAA-MM-sufijo (BBDD extra de un mes, p. ej.
// una segmentación). Puede tener nombre propio y una fecha "desde" para los commlogs.
let indiceBbdd = {};
const mesBase = (id) => id.slice(0, 7);
const nombreBbdd = (id) => indiceBbdd[id]?.nombre || nombreMes(mesBase(id));
const ayerIso = () => { const d = new Date(); d.setDate(d.getDate() - 1); return isoDia(d); };
function rangoBbdd(id, hoy) {
  // TakeOver (hastaHoy): desde el día 1 del mes de carga hasta ayer, sin cortar a fin de mes;
  // además cada instalación solo cuenta desde su propio día de carga (bbdd.cargas).
  if (indiceBbdd[id]?.hastaHoy) return { desde: indiceBbdd[id].desde || mesBase(id) + '-01', hasta: ayerIso() };
  const r = rangoPorDefecto(mesBase(id), hoy);
  const desde = indiceBbdd[id]?.desde;
  if (desde) r.desde = desde;
  return r;
}
const finMesBbdd = (id) => (indiceBbdd[id]?.hastaHoy ? ayerIso() : rangoPorDefecto(mesBase(id), new Date(2999, 0, 1)).hasta);

async function cargarIndice(preferido) {
  try {
    const idx = await api(urlBbdd());
    if (!idx.length) {
      $('mes').innerHTML = '';
      $('stBbdd').textContent = 'Sin BBDD guardadas';
      return;
    }
    indiceBbdd = Object.fromEntries(idx.map((i) => [i.mes, i]));
    $('mes').innerHTML = idx.map((i) => `<option value="${i.mes}">${escapeHtml(nombreBbdd(i.mes))}</option>`).join('');
    const sel = preferido || load(kp('mes'));
    $('mes').value = idx.some((i) => i.mes === sel) ? sel : idx[idx.length - 1].mes;
    await cambiarMes();
  } catch (err) {
    $('stBbdd').textContent = 'Error cargando BBDD: ' + err.message;
  }
}

async function cambiarMes() {
  const mes = $('mes').value;
  store(kp('mes'), mes);
  aplicarRango();
  $('stBbdd').textContent = 'Cargando BBDD…';
  bbdd = await api(urlBbdd('mes=' + encodeURIComponent(mes)));
  const camps = Object.keys(bbdd.campanas);
  $('campana').innerHTML = camps.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
  if (camps.includes(load(kp('campana')))) $('campana').value = load(kp('campana'));
  const tot = camps.reduce((a, c) => a + bbdd.campanas[c].length, 0);
  $('stBbdd').textContent = `BBDD ${nombreBbdd(mes)}: ${fmt(tot)} instalaciones en ${camps.length} campañas`;
  actualizarBoton();
  await logsListos;
  recalcular();
}
$('mes').addEventListener('change', () => cambiarMes().catch((e) => ($('stBbdd').textContent = 'Error: ' + e.message)));
$('campana').addEventListener('change', () => {
  store(kp('campana'), $('campana').value);
  if (resultados[$('campana').value]) pintarCampana();
});

const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12 };
function mesDeNombre(nombre) {
  const m = nombre.match(new RegExp(`(${Object.keys(MESES).join('|')})[ _-]?(\\d{2,4})?`, 'i'));
  if (!m) return '';
  // Año pegado al mes (Octubre26) o en otra parte del nombre (BBDD_OCTUBRE_2ATTEMPT_2026).
  const anyo = m[2] && m[2].length !== 1 ? m[2] : (nombre.match(/20\d{2}/) || [''])[0];
  if (!anyo) return '';
  const y = +anyo < 100 ? 2000 + +anyo : +anyo;
  return `${y}-${String(MESES[m[1].toLowerCase()]).padStart(2, '0')}`;
}

// Second Attempt: solo estas hojas, cada una con su columna de instalación.
const HOJAS_SA = { 'BBDD WELCOME': 'INS_NO', CLOSED: 'Installation Number', 'NO ACEPTAS': 'Numero_de_Instalacion', 'BBDD PROSPECTOS MES': 'Old Inst' };

// Lee las pestañas del Excel: cada pestaña es una campaña.
$('progCarga').addEventListener('change', () => $('fBbdd').files[0] && $('fBbdd').dispatchEvent(new Event('change')));
// TakeOver: un único Excel acumulado; se separa por mes de Fecha_Carga y se guarda
// la fecha de carga de cada instalación (Ins_no_padre), desde la que cuentan sus commlogs.
let cargaTO = null;
async function leerTakeOver(f) {
  const wb = XLSX.read(await f.arrayBuffer(), { dense: true, cellDates: true });
  for (const nombre of wb.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '', raw: true });
    const cols = Object.keys(rows[0] || {});
    const ci = cols.find((c) => normCol(c) === 'insnopadre'), cf = cols.find((c) => normCol(c) === 'fechacarga');
    if (!ci || !cf) continue;
    const porMes = {};
    for (const r of rows) {
      const id = String(r[ci] ?? '').trim().replace(/\.0+$/, ''), d = parseFecha(r[cf]);
      if (!id || !d) continue;
      const dia = isoDia(d), m = (porMes[dia.slice(0, 7)] ||= { ids: new Set(), cargas: {} });
      m.ids.add(id);
      if (!m.cargas[id] || dia < m.cargas[id]) m.cargas[id] = dia; // primera carga del mes
    }
    return porMes;
  }
  throw new Error('no encuentro las columnas Ins_no_padre y Fecha_Carga');
}

$('fBbdd').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  const sa = $('progCarga').value === 'sa';
  cargaTO = null;
  if (f && $('progCarga').value === 'to') {
    carga = null;
    $('btnGuardar').disabled = true;
    $('stCarga').textContent = 'Leyendo…';
    try {
      cargaTO = await leerTakeOver(f);
      $('stCarga').textContent = 'Se guardará una BBDD por mes de carga: ' +
        Object.entries(cargaTO).sort().map(([m, x]) => `${nombreMes(m)} ${fmt(x.ids.size)}`).join(' · ');
      $('btnGuardar').disabled = false;
    } catch (err) {
      $('stCarga').textContent = 'Error leyendo el fichero: ' + err.message;
    }
    return;
  }
  carga = null;
  $('btnGuardar').disabled = true;
  if (!f) return;
  $('stCarga').textContent = 'Leyendo…';
  try {
    const buf = await f.arrayBuffer();
    const nombresSa = sa ? XLSX.read(buf, { bookSheets: true }).SheetNames.filter((n) => HOJAS_SA[n.trim()]) : null;
    if (sa && !nombresSa.length) throw new Error(`no encuentro ninguna de las hojas ${Object.keys(HOJAS_SA).join(', ')}`);
    const wb = XLSX.read(buf, { dense: true, ...(sa ? { sheets: nombresSa } : {}) });
    const campanas = {};
    for (const nombre of sa ? nombresSa : wb.SheetNames) {
      const rows = XLSX.utils.sheet_to_json(wb.Sheets[nombre], { defval: '', raw: true });
      const col = sa ? Object.keys(rows[0] || {}).find((c) => c.trim() === HOJAS_SA[nombre.trim()]) :
        Object.keys(rows[0] || {}).find((c) => /numero_de_instalacion/i.test(c)) ||
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

const slug = (t) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 20);

$('btnGuardar').addEventListener('click', async () => {
  if (cargaTO) {
    $('btnGuardar').disabled = true;
    try {
      const meses = Object.keys(cargaTO).sort();
      for (const [i, m] of meses.entries()) {
        $('stCarga').textContent = `Guardando ${nombreMes(m)} (${i + 1}/${meses.length})…`;
        delete cacheBbdd['to|' + m];
        await api(urlBbdd('mes=' + m, 'to'), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mes: m, hastaHoy: true, campanas: { TakeOver: [...cargaTO[m].ids] }, cargas: cargaTO[m].cargas }) });
      }
      $('stCarga').textContent = `Guardadas ${meses.length} BBDD de TakeOver (${nombreMes(meses[0])} – ${nombreMes(meses[meses.length - 1])}).`;
      cargaTO = null;
      $('fBbdd').value = '';
      if (PROG === 'to') await cargarIndice(); else pintarDatos();
    } catch (err) {
      $('stCarga').textContent = 'Error guardando: ' + err.message;
      $('btnGuardar').disabled = false;
    }
    return;
  }
  const nombre = $('nombreCarga').value.trim(), desde = $('desdeCarga').value;
  // Con nombre propio se guarda como BBDD adicional del mes (no sustituye a la del mes).
  const mes = $('mesCarga').value && (nombre ? `${$('mesCarga').value}-${slug(nombre) || 'extra'}` : $('mesCarga').value);
  if (!carga || !mes) return;
  $('btnGuardar').disabled = true;
  $('stCarga').textContent = 'Guardando…';
  try {
    delete cacheBbdd[$('progCarga').value + '|' + mes];
    const prog = $('progCarga').value;
    await api(urlBbdd('mes=' + mes, prog), { method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mes, nombre: nombre || undefined, desde: desde || undefined, campanas: carga }) });
    $('stCarga').textContent = `Guardada la BBDD ${nombre || nombreMes(mes)}${desde ? ` (commlogs desde ${desde.split('-').reverse().join('/')})` : ''}.`;
    $('nombreCarga').value = '';
    $('desdeCarga').value = '';
    $('fBbdd').value = '';
    carga = null;
    if (prog === PROG) await cargarIndice(mes);
    else pintarDatos();
  } catch (err) {
    $('stCarga').textContent = 'Error guardando: ' + err.message;
    $('btnGuardar').disabled = false;
  }
});

// ---------- rango de fechas ----------
function aplicarRango() {
  if (!$('mes').value) return;
  const r = rangoBbdd($('mes').value);
  $('desde').value = r.desde;
  $('hasta').value = r.hasta;
}
$('btnRango').addEventListener('click', () => { aplicarRango(); recalcular(); });
cargarIndice();

// ---------- commlogs guardados (Cloudflare) ----------
// Se guardan por mes de la fecha del commlog: logs:<AAAA-MM> -> [[id, 'AAAA-MM-DD HH:MM', key4], ...]
const cacheLogs = {};
let hayLogs = false;
async function logsDeMes(mes) {
  if (!cacheLogs[mes]) cacheLogs[mes] = api('/api/commlogs?mes=' + mes).catch(() => []);
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
    hayLogs = idx.length > 0;
    $('stLogs').textContent = hayLogs
      ? `Commlogs hasta ${ult.slice(8, 10)}/${ult.slice(5, 7)}/${ult.slice(0, 4)} · actualizado ${new Date(Math.max(...idx.map((i) => i.actualizado))).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`
      : 'Sin commlogs cargados';
    $('vacio').classList.toggle('hidden', hayLogs);
    if (!hayLogs) $('res').classList.add('hidden');
    $('stLogs2').textContent = $('stLogs').textContent;
    pintarDatos();
  } catch (err) {
    $('stLogs').textContent = 'Error cargando commlogs: ' + err.message;
  }
}
const logsListos = cargarIndiceLogs();

const fmtTs = (d) => `${isoDia(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

// Columnas fijas del fichero de commlogs (Libro.xlsx de SharePoint): ins_no, fecha y key4.
function buscarCol(cols, patrones) {
  for (const p of patrones) {
    const c = cols.find((x) => p.test(String(x).trim()) || p.test(normCol(x)));
    if (c) return c;
  }
  return null;
}

// Cabecera del fichero de commlogs: posiciones de ins_no, fecha y key4.
function mapaCabecera(arr) {
  const n = arr.map((c) => normCol(c));
  const id = n.findIndex((c) => c === 'insno');
  const fecha = n.findIndex((c) => c === 'fecha');
  const key4 = n.findIndex((c) => c === 'key4');
  return id >= 0 && fecha >= 0 && key4 >= 0 ? { id, fecha, key4 } : null;
}

// Lee los ficheros de commlogs y guarda los nuevos.
async function procesarFicheros(files) {
  let filas = [];
  for (const f of files) {
    $('stSubida').textContent = `Leyendo ${f.name}… (con ficheros grandes puede tardar un minuto)`;
    if (/\.xlsx$/i.test(f.name)) {
      const buf = await f.arrayBuffer();
      const cab = new Uint8Array(buf.slice(0, 4));
      // Un .xlsx normal es un ZIP (PK). Si empieza por D0 CF 11 E0 está cifrado.
      if (cab[0] === 0xd0 && cab[1] === 0xcf) {
        throw new Error('el Excel está protegido (etiqueta de confidencialidad o contraseña). Ábrelo y guárdalo como CSV, o quita la protección, y súbelo de nuevo');
      }
      const r = await leerColumnasXlsx(buf, mapaCabecera);
      if (!r.filas) throw new Error(`no encuentro las columnas ins_no, fecha y key4. Pestañas que veo: ${r.diagnostico.join(' · ') || 'ninguna'}`);
      filas = filas.concat(r.filas);
    } else {
      const leidas = await leerFichero(f);
      const cols = Object.keys(leidas[0] || {});
      const ci = buscarCol(cols, P_ID), cf = buscarCol(cols, P_FECHA), ck = buscarCol(cols, P_KEY4);
      const faltan = [[ci, 'ins_no'], [cf, 'fecha'], [ck, 'key4']].filter(([c]) => !c).map(([, n]) => n);
      if (faltan.length) throw new Error(`no encuentro la(s) columna(s) ${faltan.join(', ')} en ${f.name}. Columnas que veo: ${cols.slice(0, 8).join(', ')}`);
      filas = filas.concat(leidas.map((x) => ({ id: x[ci], fecha: x[cf], key4: x[ck] })));
    }
  }
  await guardarLogs(filas, 'id', 'fecha', 'key4');
}

// Subida manual: al elegir el fichero se lee y se guarda directamente.
$('fLogs').addEventListener('change', async (e) => {
  const files = [...e.target.files];
  if (!files.length) return;
  $('fLogs').disabled = true;
  try {
    await procesarFicheros(files);
  } catch (err) {
    $('stSubida').textContent = 'Error: ' + err.message;
  } finally {
    $('fLogs').value = '';
    $('fLogs').disabled = false;
  }
});

// ---------- fichero vinculado (Commlogs.xlsx sincronizado con OneDrive) ----------
// Chrome/Edge permiten recordar un fichero del PC (File System Access API). Si la
// carpeta de SharePoint está sincronizada con OneDrive, el fichero se actualiza solo
// y la web lo vuelve a leer al abrirse, guardando únicamente si ha cambiado.
const soportaVinculo = 'showOpenFilePicker' in window;


function idb(modo, fn) {
  return new Promise((ok, ko) => {
    const req = indexedDB.open('vueltas-bbdd', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => ko(req.error);
    req.onsuccess = () => {
      let tx, r;
      try {
        tx = req.result.transaction('kv', modo);
        r = fn(tx.objectStore('kv'));
      } catch (err) { return ko(err); }
      tx.oncomplete = () => ok(r && r.result);
      tx.onerror = () => ko(tx.error);
    };
  });
}
const getHandle = () => idb('readonly', (st) => st.get('commlogs')).catch(() => null);
const setHandle = (h) => idb('readwrite', (st) => st.put(h, 'commlogs'));

async function sincronizar(handle, conGesto) {
  let perm = await handle.queryPermission({ mode: 'read' });
  if (perm !== 'granted' && conGesto) perm = await handle.requestPermission({ mode: 'read' });
  if (perm !== 'granted') {
    $('btnSync').classList.remove('hidden');
    $('stVinculo').textContent = `Fichero vinculado: ${handle.name}. Pulsa «Actualizar» para leer los commlogs nuevos.`;
    return;
  }
  const file = await handle.getFile();
  const visto = load('vinculoMod');
  $('btnSync').classList.remove('hidden');
  if (String(file.lastModified) === visto && !conGesto) {
    $('stVinculo').textContent = `Fichero vinculado: ${handle.name} · sin cambios desde la última lectura (${new Date(file.lastModified).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })})`;
    return;
  }
  $('stVinculo').textContent = `Fichero vinculado: ${handle.name} · leyendo versión del ${new Date(file.lastModified).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}…`;
  await procesarFicheros([file]);
  store('vinculoMod', String(file.lastModified));
  $('stVinculo').textContent = `Fichero vinculado: ${handle.name} · actualizado con la versión del ${new Date(file.lastModified).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}`;
}

if (soportaVinculo) {
  $('vinculo').classList.remove('hidden');
  $('btnVincular').addEventListener('click', async () => {
    try {
      const [h] = await window.showOpenFilePicker({ types: [{ description: 'Commlogs', accept: {
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx'], 'text/csv': ['.csv'] } }] });
      await setHandle(h).catch(() => {}); // si no se puede recordar, al menos se lee ahora
      store('vinculoMod', '');
      await sincronizar(h, true);
    } catch (err) {
      if (err.name !== 'AbortError') $('stSubida').textContent = 'Error: ' + err.message;
    }
  });
  $('btnSync').addEventListener('click', async () => {
    const h = await getHandle();
    if (!h) return;
    $('btnSync').disabled = true;
    try { await sincronizar(h, true); } catch (err) { $('stSubida').textContent = 'Error: ' + err.message; }
    $('btnSync').disabled = false;
  });
  // Al abrir la web: si ya hay permiso, lee el fichero si ha cambiado.
  getHandle().then((h) => h && sincronizar(h, false)).catch((err) => ($('stSubida').textContent = 'Error: ' + err.message));
}

async function guardarLogs(filas, ci, cf, ck) {
  const porMes = {};
  let malas = 0;
  for (const r of filas) {
    const d = parseFecha(r[cf]);
    const id = String(r[ci] ?? '').trim().replace(/\.0+$/, '');
    if (!d || !id) { malas++; continue; }
    const ts = fmtTs(d);
    (porMes[ts.slice(0, 7)] ||= []).push([id, ts, String(r[ck] ?? '').trim()]);
  }
  const meses = Object.keys(porMes).sort();
  if (!meses.length) throw new Error('el fichero no tiene filas con instalación y fecha válidas');
  // El fichero es acumulativo: se fusiona con lo guardado (sin duplicar) y se reemplaza el mes.
  let nuevos = 0;
  for (const [i, mes] of meses.entries()) {
    $('stSubida').textContent = `Guardando ${nombreMes(mes)} (${i + 1}/${meses.length})…`;
    const actuales = await api('/api/commlogs?mes=' + mes);
    const vistos = new Set(actuales.map((l) => l.join('|')));
    for (const l of porMes[mes]) {
      const k = l.join('|');
      if (!vistos.has(k)) { vistos.add(k); actuales.push(l); nuevos++; }
    }
    const max = actuales.reduce((m, l) => (l[1] > m ? l[1] : m), '');
    await api(`/api/commlogs?mes=${mes}&n=${actuales.length}&max=${encodeURIComponent(max)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(actuales) });
    delete cacheLogs[mes];
    delete cacheParsed[mes];
  }
  $('stSubida').textContent = `Listo: ${fmt(filas.length - malas)} commlogs leídos, ${fmt(nuevos)} nuevos guardados` +
    (malas ? ` · ${fmt(malas)} filas sin instalación o fecha ignoradas` : '');
  await cargarIndiceLogs();
  recalcular();
}

// ---------- cálculo ----------
async function recalcular() {
  if (!bbdd || !hayLogs) return;
  const desde = $('desde').value, hasta = $('hasta').value;
  $('stCalc').textContent = 'Calculando…';
  const t0 = performance.now();
  const logs = [];
  for (const mes of mesesEntre(desde, hasta)) {
    for (const [id, ts, key4] of await logsDeMes(mes)) logs.push({ id, fecha: parseFecha(ts), key4 });
  }
  cacheComp = {};
  resultados = {};
  for (const [camp, ids] of Object.entries(bbdd.campanas)) resultados[camp] = calcular(ids, logs, desde, hasta, bbdd.cargas);
  const f = (d) => d.split('-').reverse().join('/');
  $('stCalc').textContent = `BBDD ${nombreBbdd(bbdd.mes)} · commlogs del ${f(desde)} al ${f(hasta)}`;
  $('res').classList.remove('hidden');
  pintarCampana();
}
$('btnCalc').addEventListener('click', recalcular);

function pintarCampana() {
  const sel = $('campana').value;
  const filas = Object.entries(resultados).map(([c, r]) => {
    const s = r.resumen;
    const pc = s.gestionables ? (100 * s.contactadas) / s.gestionables : 0;
    return `<tr data-c="${escapeHtml(c)}" class="${c === sel ? 'sel' : ''}"><td>${escapeHtml(c)}</td>
      <td class="n">${fmt(s.total)}</td><td class="n">${fmt(s.excluidas)}</td><td class="n">${fmt(s.gestionables)}</td>
      <td><span class="minibar"><i style="width:${pc}%"></i></span><b>${fmt(pc, 1)} %</b></td>
      <td class="n">${fmt(s.vueltasCompletas)}</td><td class="n">${fmt(s.mediaIntentos, 2)}</td>
      <td class="n">${fmt(s.ilocalizadas)}</td><td class="n">${fmt(s.sinIntentos)}</td>
      <td class="n">${fmt(s.contacto1)}</td><td class="n">${fmt(s.contacto2)}</td><td class="n">${fmt(s.contacto3mas)}</td>
      <td class="n">${fmt(s.mediaIlocAntes, 2)}</td><td class="n">${fmt(s.logsEnRango)}</td></tr>`;
  }).join('');
  $('tablaCamp').innerHTML = `<thead><tr><th>Campaña</th><th class="n">BBDD</th><th class="n">Excluidas</th><th class="n">Gestionables</th>
    <th>Contactación</th><th class="n">Vueltas completas</th><th class="n">Nº de vueltas</th><th class="n">Ilocalizadas</th>
    <th class="n">Sin intentos</th><th class="n">Contacto 1º int.</th><th class="n">Contacto 2º int.</th><th class="n">Contacto 3º+ int.</th>
    <th class="n">Iloc. antes contacto</th><th class="n">Commlogs</th></tr></thead><tbody>${filas}</tbody>`;
  $('tablaCamp').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    $('campana').value = tr.dataset.c;
    store(kp('campana'), tr.dataset.c);
    pintarCampana();
  }));
  $('tituloCamp').textContent = `Campaña ${sel}`;
  ultimo = resultados[sel];
  pintar(ultimo);
  comparar();
}

function pintar(r) {
  const s = r.resumen;
  $('res').classList.remove('hidden');
  const pc = s.gestionables ? (100 * s.contactadas) / s.gestionables : 0;
  const sig = r.vueltas[s.vueltasCompletas];
  const hero = [
    ['main', 'Contactación', fmt(pc, 1) + ' %', `${fmt(s.contactadas)} de ${fmt(s.gestionables)} gestionables`, pc],
    ['', 'Vueltas completas', fmt(s.vueltasCompletas),
      sig ? `Vuelta ${sig.n} al ${fmt(sig.pct * 100, 1)} %` : '', sig ? sig.pct * 100 : 100],
    ['', 'Nº de vueltas', fmt(s.mediaIntentos, 2), `intentos medios por instalación · ${fmt(s.totalIntentos)} intentos en total`, null],
    ['', 'Ilocalizados antes de contactar', fmt(s.mediaIlocAntes, 2), `media por contactada · ${fmt(s.ilocAntesTotal)} en total`, null],
  ];
  $('hero').innerHTML = hero.map(([cls, l, v, sub, m]) => `<div class="hk ${cls}"><div class="l">${l}</div><div class="v">${v}</div>
    <div class="s">${sub}</div>${m == null ? '' : `<div class="meter"><i style="width:${Math.min(100, m)}%"></i></div>`}</div>`).join('');
  const kpis = [
    ['Instalaciones BBDD', fmt(s.total), ''],
    ['Excluidas', fmt(s.excluidas), pct(s.excluidas, s.total) + ' de la BBDD'],
    ['Gestionables', fmt(s.gestionables), 'BBDD sin excluidas'],
    ['Contactadas', fmt(s.contactadas), pct(s.contactadas, s.gestionables)],
    ['Ilocalizadas', fmt(s.ilocalizadas), pct(s.ilocalizadas, s.gestionables) + ' · sin contacto aún'],
    ['Sin intentos', fmt(s.sinIntentos), pct(s.sinIntentos, s.gestionables)],
  ];
  $('kpis').innerHTML = kpis.map(([l, v, sub]) => `<div class="kpi"><div class="l">${l}</div><div class="v">${v}</div><div class="s">${sub}</div></div>`).join('');

  barras($('chVueltas'), r.vueltas.map((v) => ({
    label: 'V' + v.n, segs: [{ v: v.pct * 100, c: 'var(--s1)' }], top: fmt(v.pct * 100, 0) + '%',
    tip: `Vuelta ${v.n}\n${fmt(v.cubiertas)} cubiertas (${fmt(v.pct * 100, 1)} %)\n${fmt(v.conN)} con ≥${v.n} intentos`,
  })), 100);
  const intentos = [
    ['1er intento', s.contacto1, 'a la primera llamada'],
    ['2º intento', s.contacto2, 'tras 1 ilocalizado'],
    ['3er intento o más', s.contacto3mas, 'tras 2 o más ilocalizados'],
  ];
  $('porIntento').innerHTML = intentos.map(([l, n, sub]) => `<div class="hk"><div class="l">Contactadas en el ${l}</div>
    <div class="v">${fmt(n)}</div><div class="s">${pct(n, s.contactadas)} de las contactadas · ${sub}</div>
    <div class="meter"><i style="width:${s.contactadas ? (100 * n) / s.contactadas : 0}%"></i></div></div>`).join('');
  barras($('chIloc'), r.contactoEnIntento.map((b) => ({
    label: b.label, segs: [{ v: b.n, c: 'var(--s1)' }], top: fmt(b.n),
    tip: `Contactadas en el ${b.label} intento\n${fmt(b.n)} instalaciones (${pct(b.n, s.contactadas)} de las contactadas)\n${b.intento - 1}${b.intento === 5 ? ' o más' : ''} ilocalizado(s) antes`,
  })));
  barras($('chIntentos'), r.distIntentos.map((b) => ({
    label: b.label, segs: [{ v: b.n, c: 'var(--s1)' }], top: fmt(b.n),
    tip: `${b.label} intento(s)\n${fmt(b.n)} instalaciones (${pct(b.n, s.gestionables)})`,
  })));
  barras($('chDia'), r.porDia.map((d) => ({
    label: d.dia.slice(8),
    segs: [{ v: d.contacto, c: 'var(--s1)' }, { v: d.no_contacto, c: 'var(--s2)' }],
    tip: `${d.dia.split('-').reverse().join('/')}\nContacto válido: ${fmt(d.contacto)}\nNo contacto: ${fmt(d.no_contacto)}\nTotal: ${fmt(d.no_contacto + d.contacto)}`,
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
    rows.slice(0, 500).map((d) => `<tr>${COLS.map(([k]) => (k === 'estado' ? `<td><span class="pill ${d[k]}">${ESTADOS[d[k]]}</span></td>` : `<td>${escapeHtml(d[k] ?? '')}</td>`)).join('')}</tr>`).join('')
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

// ---------- pestañas: Dashboard / Añadir orígenes ----------
function vista() {
  const orig = location.hash === '#origenes';
  $('vistaDash').classList.toggle('hidden', orig);
  $('vistaOrig').classList.toggle('hidden', !orig);
  $('tabDash').classList.toggle('on', !orig && PROG === '');
  $('tabSa').classList.toggle('on', !orig && PROG === 'sa');
  $('tabTo').classList.toggle('on', !orig && PROG === 'to');
  $('tabOrig').classList.toggle('on', orig);
  scrollTo(0, 0);
}
// Cambiar de informe (Dashboard <-> Second Attempt) recarga sus BBDD; Añadir orígenes no cambia el informe.
addEventListener('hashchange', () => {
  if (location.hash === '#origenes') return;
  const nuevo = progDeHash();
  if (nuevo === PROG) return;
  PROG = nuevo;
  pintarInforme();
  cacheComp = {};
  resultados = {};
  bbdd = null;
  $('res').classList.add('hidden');
  for (const id of ['mesA', 'mesB', 'campA', 'campB', 'diaA', 'diaB']) $(id).value = '';
  cargarIndice();
});
function pintarInforme() {
  const t = { sa: ['Second Attempt · contactación y vueltas', 'Second Attempt BBDD'], to: ['TakeOver · contactación y vueltas', 'TakeOver BBDD'] }[PROG] ||
    ['Contactación y vueltas de BBDD', 'Contactación y vueltas BBDD'];
  $('tituloInforme').textContent = t[0];
  document.title = t[1];
}
pintarInforme();
addEventListener('hashchange', vista);
vista();

async function pintarDatos() {
  try {
    const [bbP, bbS, bbT, lg] = await Promise.all([api(urlBbdd('', '')), api(urlBbdd('', 'sa')), api(urlBbdd('', 'to')), api('/api/commlogs')]);
    const etiqueta = (pref) => (b) => ({ ...b, nombre: pref + (b.nombre ? ' · ' + b.nombre : '') });
    const bb = [...bbP, ...bbS.map(etiqueta('Second Attempt')), ...bbT.map(etiqueta('TakeOver'))];
    const meses = [...new Set([...bb.map((b) => mesBase(b.mes)), ...lg.map((l) => l.mes)])].sort().reverse();
    $('tablaDatos').innerHTML = `<thead><tr><th>Mes</th><th>BBDD (campañas · instalaciones)</th><th class="n">Commlogs con fecha de ese mes</th><th>Último commlog</th></tr></thead><tbody>${
      meses.map((m) => {
        const bs = bb.filter((x) => mesBase(x.mes) === m), l = lg.find((x) => x.mes === m);
        const camp = bs.length ? bs.map((b) => (b.nombre ? `<b>${escapeHtml(b.nombre)}</b>${b.desde ? ` (desde ${b.desde.split('-').reverse().join('/')})` : ''}: ` : '') +
          Object.entries(b.campanas).map(([c, n]) => `${escapeHtml(c)} ${fmt(n)}`).join(' · ')).join('<br>') : '—';
        return `<tr><td>${nombreMes(m)}</td><td style="white-space:normal">${camp}</td><td class="n">${l ? fmt(l.n) : '—'}</td><td>${l ? l.max : '—'}</td></tr>`;
      }).join('')}</tbody>`;
  } catch (err) {
    $('tablaDatos').innerHTML = `<tbody><tr><td>Error: ${escapeHtml(err.message)}</td></tr></tbody>`;
  }
}

// ---------- comparador de días ----------
// Cada lado: un día y una BBDD. Situación al cierre de ese día con la regla de rango
// de esa BBDD (desde el 15 del mes anterior hasta el día, sin pasar del fin de mes).
const sumarDias = (iso, n) => { const d = parseFecha(iso); d.setDate(d.getDate() + n); return isoDia(d); };
const sumarMeses = (iso, n) => {
  const [y, m, d] = iso.split('-').map(Number);
  const ult = new Date(y, m - 1 + n + 1, 0).getDate();
  return isoDia(new Date(y, m - 1 + n, Math.min(d, ult)));
};
const fDia = (iso) => iso.split('-').reverse().join('/');
const cacheBbdd = {};
const cacheParsed = {};
const bbddDe = (mes) => (cacheBbdd[PROG + '|' + mes] ||= api(urlBbdd('mes=' + mes)));
const logsParseados = (mes) => (cacheParsed[mes] ||= logsDeMes(mes).then((l) => l.map(([id, ts, key4]) => ({ id, fecha: parseFecha(ts), key4 }))));

// Dos modos:
//  - 'dia':  solo los commlogs del día elegido, cruzados con la BBDD elegida.
//  - 'acum': situación a ese día = commlogs desde el inicio del rango de esa BBDD
//            (15 del mes anterior) hasta el día elegido, sin pasar del fin de mes.
let modoComp = load('modoComp') === 'acum' ? 'acum' : 'dia';

async function estadoAl(mes, dia, modo, desdeElegido) {
  const k = PROG + '|' + modo + '|' + mes + '|' + dia + '|' + (desdeElegido || '');
  if (cacheComp[k]) return cacheComp[k];
  const desde = (modo === 'acum' && desdeElegido) || rangoBbdd(mes).desde;
  const finMes = finMesBbdd(mes);
  const datos = {};
  if (modo === 'dia') {
    const [bb, logsMes] = await Promise.all([bbddDe(mes), logsParseados(dia.slice(0, 7))]);
    const delDiaLogs = logsMes.filter((l) => l.fecha && isoDia(l.fecha) === dia);
    for (const [camp, ids] of Object.entries(bb.campanas)) datos[camp] = delDia(ids, delDiaLogs, dia, bb.cargas);
    return (cacheComp[k] = { datos, fueraVentana: dia < desde || dia > finMes, desde, finMes });
  }
  const hasta = dia > finMes ? finMes : dia;
  if (hasta < desde) {
    // Sin datos para ese día, pero las campañas de la BBDD siguen disponibles para elegir.
    for (const camp of Object.keys((await bbddDe(mes)).campanas)) datos[camp] = null;
    return (cacheComp[k] = { datos, vacio: true, desde, hasta });
  }
  const [bb, ...porMes] = await Promise.all([bbddDe(mes), ...mesesEntre(desde, hasta).map(logsParseados)]);
  const logs = [].concat(...porMes);
  for (const [camp, ids] of Object.entries(bb.campanas)) datos[camp] = calcular(ids, logs, desde, hasta, bb.cargas).resumen;
  return (cacheComp[k] = { datos, desde, hasta, recortado: hasta !== dia });
}

const mesesDisponibles = () => [...$('mes').options].map((o) => o.value);
function mesParaDia(dia, preferido) {
  const ms = mesesDisponibles();
  if (preferido && ms.includes(preferido)) return preferido;
  return ms.includes(dia.slice(0, 7)) ? dia.slice(0, 7) : (ms.find((m) => mesBase(m) === dia.slice(0, 7)) || ms[ms.length - 1]);
}
function rellenarMesesComp() {
  const html = mesesDisponibles().map((m) => `<option value="${m}">${escapeHtml(nombreBbdd(m))}</option>`).join('');
  for (const id of ['mesA', 'mesB']) {
    const v = $(id).value;
    $(id).innerHTML = html;
    if (v && mesesDisponibles().includes(v)) $(id).value = v;
  }
}
function fijarDias(modo) {
  const hoyB = $('hasta').value;
  $('diaB').value = hoyB;
  $('mesB').value = $('mes').value;
  $('diaA').value = modo === 'semana' ? sumarDias(hoyB, -7) : sumarMeses(hoyB, -1);
  $('mesA').value = modo === 'semana' ? $('mes').value : mesParaDia($('diaA').value);
}

const pctDe = (a, b) => (b ? (100 * a) / b : 0);
const METRICAS_ACUM = [
  ['Nº de vueltas', (s) => s.mediaIntentos, 2, ''],
  ['Vueltas completas', (s) => s.vueltasCompletas, 0, ''],
  ['Contactación', (s) => pctDe(s.contactadas, s.gestionables), 1, ' %'],
  ['Instalaciones BBDD', (s) => s.total, 0, ''],
  ['Gestionables', (s) => s.gestionables, 0, ''],
  ['Contactadas', (s) => s.contactadas, 0, ''],
  ['Ilocalizadas', (s) => s.ilocalizadas, 0, ''],
  ['Sin intentos', (s) => s.sinIntentos, 0, ''],
  ['Excluidas', (s) => s.excluidas, 0, ''],
  ['Intentos totales', (s) => s.totalIntentos, 0, ''],
  ['Contactadas en 1er intento', (s) => s.contacto1, 0, ''],
  ['Contactadas en 2º intento', (s) => s.contacto2, 0, ''],
  ['Contactadas en 3er intento o más', (s) => s.contacto3mas, 0, ''],
  ['Ilocalizados antes de contactar', (s) => s.mediaIlocAntes, 2, ''],
];
const METRICAS_DIA = [
  ['Instalaciones llamadas', (d) => d.instLlamadas, 0, ''],
  ['Contactadas ese día', (d) => d.contactadas, 0, ''],
  ['Ilocalizadas ese día (llamadas sin contacto)', (d) => d.ilocalizadas, 0, ''],
  ['% contacto del día (contactadas / llamadas)', (d) => d.pctContactoDia, 1, ' %'],
  ['% contactadas sobre la BBDD', (d) => d.pctSobreBbdd, 2, ' %'],
  ['Llamadas (commlogs) del día', (d) => d.llamadas, 0, ''],
  ['Llamadas por instalación', (d) => d.llamadasPorInst, 2, ''],
  ['Commlogs de contacto válido', (d) => d.contactos, 0, ''],
  ['Commlogs de no contacto', (d) => d.noContacto, 0, ''],
  ['Excluidas ese día', (d) => d.excluidas, 0, ''],
];

function delta(a, b, dec, suf) {
  if (a == null || b == null) return '<td class="n">—</td>';
  const d = b - a;
  const cls = Math.abs(d) < 1e-9 ? 'eq' : d > 0 ? 'up' : 'down';
  const signo = d > 0 ? '▲ +' : d < 0 ? '▼ ' : '';
  return `<td class="n"><span class="delta ${cls}">${signo}${fmt(d, dec)}${suf === ' %' ? ' p.p.' : suf}</span></td>`;
}
const val = (s, f, dec, suf) => (s ? `${fmt(f(s), dec)}${suf}` : '—');

let compId = 0;
async function comparar() {
  if (!$('mes').options.length || !hayLogs) return;
  rellenarMesesComp();
  if (!$('diaA').value || !$('diaB').value || !$('mesA').value || !$('mesB').value) fijarDias('mes');
  const A = $('diaA').value, B = $('diaB').value, mA = $('mesA').value, mB = $('mesB').value;
  const modo = modoComp;
  for (const [btn, m] of [['btnModoDia', 'dia'], ['btnModoAcum', 'acum']]) $(btn).classList.toggle('sec', modo !== m);
  $('ayudaModo').textContent = modo === 'dia'
    ? 'Día único: solo los commlogs del día elegido, cruzados con la BBDD que elijas.'
    : 'Situación a ese día: cómo íbamos con esa BBDD hasta ese día (commlogs desde el 15 del mes anterior hasta el día elegido, sin pasar del fin de mes).';
  // "Commlogs desde" de cada lado (solo modo situación): por defecto la regla de su BBDD;
  // se reinicia al cambiar de BBDD y se puede editar para mirar antes/después de una fecha.
  for (const l of ['A', 'B']) {
    const m = $('mes' + l).value;
    if ($('desde' + l).dataset.mes !== m || !$('desde' + l).value) {
      $('desde' + l).value = rangoBbdd(m).desde;
      $('desde' + l).dataset.mes = m;
    }
  }
  document.querySelectorAll('.soloAcum').forEach((e) => e.classList.toggle('hidden', modo !== 'acum'));
  const id = ++compId;
  $('notaComp').textContent = 'Calculando…';
  let ea, eb;
  try {
    [ea, eb] = await Promise.all([estadoAl(mA, A, modo, $('desdeA').value), estadoAl(mB, B, modo, $('desdeB').value)]);
  } catch (err) {
    $('notaComp').textContent = 'Error: ' + err.message;
    return;
  }
  if (id !== compId) return; // llegó otra comparación más reciente
  const nota = modo === 'dia'
    ? (e, d, m, l) => `${l}: commlogs del ${fDia(d)} cruzados con la BBDD ${nombreBbdd(m)}.`
    : (e, d, m, l) => e.vacio
      ? `${l}: el ${fDia(d)} es anterior a «Commlogs desde» (${fDia(e.desde)}); adelanta esa fecha para ver ese día.`
      : `${l}: BBDD ${nombreBbdd(m)}, commlogs del ${fDia(e.desde)} al ${fDia(e.hasta)}${e.recortado ? ' (cierre de mes)' : ''}.`;
  $('notaComp').textContent = `${nota(ea, A, mA, 'A')} ${nota(eb, B, mB, 'B')}`;

  // Cada lado tiene su campaña: se rellenan con las campañas de su BBDD y se
  // mantiene la elegida si sigue existiendo (si no, la del dashboard o la primera).
  const sel = $('campana').value;
  for (const [l, e] of [['A', ea], ['B', eb]]) {
    const cs = Object.keys(e.datos), prev = $('camp' + l).value || load('camp' + l);
    $('camp' + l).innerHTML = cs.map((c) => `<option>${escapeHtml(c)}</option>`).join('');
    $('camp' + l).value = cs.includes(prev) ? prev : cs.includes(sel) ? sel : cs[0] || '';
  }
  const cA = $('campA').value, cB = $('campB').value;
  const camps = [...new Set([...Object.keys(ea.datos), ...Object.keys(eb.datos)])];
  const campSel = cA;
  const da = ea.datos[cA], db = eb.datos[cB];
  const metricas = modo === 'dia' ? METRICAS_DIA : METRICAS_ACUM;
  const cab = modo === 'dia' ? 'Medida (solo commlogs de ese día)' : 'Medida (acumulado hasta ese día)';
  $('tituloCompDia').textContent = `A: ${cA} · ${fDia(A)} (${nombreBbdd(mA)})  frente a  B: ${cB} · ${fDia(B)} (${nombreBbdd(mB)})`;
  $('tablaCompDia').innerHTML = `<thead><tr><th>${cab}</th><th class="n">A · ${escapeHtml(cA)} · ${fDia(A)}</th><th class="n">B · ${escapeHtml(cB)} · ${fDia(B)}</th><th class="n">Diferencia</th></tr></thead><tbody>${
    metricas.map(([l, f, dec, suf]) => `<tr><td>${l}</td><td class="n">${val(da, f, dec, suf)}</td><td class="n"><b>${val(db, f, dec, suf)}</b></td>${delta(da && f(da), db && f(db), dec, suf)}</tr>`).join('')
  }</tbody>`;
  const celdas3 = (x, y, f, dec, suf) => `<td class="n">${val(x, f, dec, suf)}</td><td class="n"><b>${val(y, f, dec, suf)}</b></td>${delta(x && f(x), y && f(y), dec, suf)}`;
  const cols = modo === 'dia'
    ? [['Inst. llamadas', (d) => d.instLlamadas, 0, ''], ['Contactadas', (d) => d.contactadas, 0, ''], ['% contacto', (d) => d.pctContactoDia, 1, ' %']]
    : [['Nº vueltas', (s) => s.mediaIntentos, 2, ''], ['Contactación', (s) => pctDe(s.contactadas, s.gestionables), 1, ' %'], ['Contactadas', (s) => s.contactadas, 0, '']];
  $('tablaCompCamp').innerHTML = `<thead><tr><th>Campaña</th>${
    cols.map(([l]) => `<th class="n">${l} A</th><th class="n">${l} B</th><th class="n">Dif.</th>`).join('')}</tr></thead><tbody>${
    camps.map((c) => {
      const x = ea.datos[c], y = eb.datos[c];
      return `<tr class="${c === campSel ? 'sel' : ''}"><td>${escapeHtml(c)}</td>${cols.map(([, f, dec, suf]) => celdas3(x, y, f, dec, suf)).join('')}</tr>`;
    }).join('')
  }</tbody>`;
}
for (const [btn, m] of [['btnModoDia', 'dia'], ['btnModoAcum', 'acum']]) {
  $(btn).addEventListener('click', () => { modoComp = m; store('modoComp', m); comparar(); });
}
for (const l of ['A', 'B']) {
  // Al cambiar el día se propone la BBDD del mes de ese día.
  // Si el día cambia de mes se propone la BBDD de ese mes; si sigue en el mismo mes se
  // respeta la BBDD elegida (p. ej. una segmentada).
  $('dia' + l).addEventListener('change', () => {
    const d = $('dia' + l).value;
    if (d && mesBase($('mes' + l).value) !== d.slice(0, 7)) $('mes' + l).value = mesParaDia(d);
    comparar();
  });
  $('mes' + l).addEventListener('change', comparar);
  $('desde' + l).addEventListener('change', comparar);
  $('camp' + l).addEventListener('change', () => { store('camp' + l, $('camp' + l).value); comparar(); });
}
$('btnCompMes').addEventListener('click', () => { fijarDias('mes'); comparar(); });
$('btnCompHoy').addEventListener('click', () => { fijarDias('semana'); comparar(); });
