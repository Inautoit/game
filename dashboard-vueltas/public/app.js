import { calcular, parseFecha, rangoPorDefecto, isoDia } from './calc.js';

const $ = (id) => document.getElementById(id);
const fmt = (n, d = 0) => Number(n).toLocaleString('es-ES', { maximumFractionDigits: d, minimumFractionDigits: d });
const pct = (a, b) => (b ? fmt((100 * a) / b, 1) + ' %' : '–');

let bbdd = null; // {mes, campanas: {nombre: [ids]}}
let carga = null;
let resultados = {};
let ultimo = null;

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

async function cargarIndice(preferido) {
  try {
    const idx = await api('/api/bbdd');
    if (!idx.length) {
      $('mes').innerHTML = '';
      $('stBbdd').textContent = 'Sin BBDD guardadas';
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
  const tot = camps.reduce((a, c) => a + bbdd.campanas[c].length, 0);
  $('stBbdd').textContent = `BBDD ${nombreMes(mes)}: ${fmt(tot)} instalaciones en ${camps.length} campañas`;
  actualizarBoton();
  await logsListos;
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

// Lee los ficheros de commlogs y guarda los nuevos.
async function procesarFicheros(files) {
  $('stSubida').textContent = 'Leyendo el fichero… (con ficheros grandes puede tardar un minuto)';
  // concat: con cientos de miles de filas, push(...filas) desborda la pila.
  let filas = [];
  let vistas = [];
  for (const f of files) {
    const leidas = await leerFichero(f);
    vistas = vistas.concat(leidas.pestanasVistas || []);
    filas = filas.concat(leidas);
  }
  const cols = Object.keys(filas[0] || {});
  const ci = buscarCol(cols, P_ID), cf = buscarCol(cols, P_FECHA), ck = buscarCol(cols, P_KEY4);
  const faltan = [[ci, 'ins_no'], [cf, 'fecha'], [ck, 'key4']].filter(([c]) => !c).map(([, n]) => n);
  if (faltan.length) {
    throw new Error(`no encuentro la(s) columna(s) ${faltan.join(', ')}.` +
      (vistas.length ? ` Pestañas que veo: ${vistas.join(' · ')}` : ` Columnas que veo: ${cols.slice(0, 8).join(', ')}`));
  }
  await guardarLogs(filas, ci, cf, ck);
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
  resultados = {};
  for (const [camp, ids] of Object.entries(bbdd.campanas)) resultados[camp] = calcular(ids, logs, desde, hasta);
  const f = (d) => d.split('-').reverse().join('/');
  $('stCalc').textContent = `BBDD ${nombreMes(bbdd.mes)} · commlogs del ${f(desde)} al ${f(hasta)}`;
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
      <td class="n">${fmt(s.mediaIlocAntes, 2)}</td><td class="n">${fmt(s.logsEnRango)}</td></tr>`;
  }).join('');
  $('tablaCamp').innerHTML = `<thead><tr><th>Campaña</th><th class="n">BBDD</th><th class="n">Excluidas</th><th class="n">Gestionables</th>
    <th>Contactación</th><th class="n">Vueltas completas</th><th class="n">Intentos medios</th><th class="n">Ilocalizadas</th>
    <th class="n">Sin intentos</th><th class="n">Iloc. antes contacto</th><th class="n">Commlogs</th></tr></thead><tbody>${filas}</tbody>`;
  $('tablaCamp').querySelectorAll('tbody tr').forEach((tr) => tr.addEventListener('click', () => {
    $('campana').value = tr.dataset.c;
    store('campana', tr.dataset.c);
    pintarCampana();
  }));
  $('tituloCamp').textContent = `Campaña ${sel}`;
  ultimo = resultados[sel];
  pintar(ultimo);
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
    ['', 'Intentos medios', fmt(s.mediaIntentos, 2), `${fmt(s.totalIntentos)} intentos en total`, null],
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
  $('tabDash').classList.toggle('on', !orig);
  $('tabOrig').classList.toggle('on', orig);
  scrollTo(0, 0);
}
addEventListener('hashchange', vista);
vista();

async function pintarDatos() {
  try {
    const [bb, lg] = await Promise.all([api('/api/bbdd'), api('/api/commlogs')]);
    const meses = [...new Set([...bb.map((b) => b.mes), ...lg.map((l) => l.mes)])].sort().reverse();
    $('tablaDatos').innerHTML = `<thead><tr><th>Mes</th><th>BBDD (campañas · instalaciones)</th><th class="n">Commlogs con fecha de ese mes</th><th>Último commlog</th></tr></thead><tbody>${
      meses.map((m) => {
        const b = bb.find((x) => x.mes === m), l = lg.find((x) => x.mes === m);
        const camp = b ? Object.entries(b.campanas).map(([c, n]) => `${escapeHtml(c)} ${fmt(n)}`).join(' · ') : '—';
        return `<tr><td>${nombreMes(m)}</td><td>${camp}</td><td class="n">${l ? fmt(l.n) : '—'}</td><td>${l ? l.max : '—'}</td></tr>`;
      }).join('')}</tbody>`;
  } catch (err) {
    $('tablaDatos').innerHTML = `<tbody><tr><td>Error: ${escapeHtml(err.message)}</td></tr></tbody>`;
  }
}
