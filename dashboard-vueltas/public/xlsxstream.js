// Lector de .xlsx por streaming para el fichero de commlogs.
// Los libros de commlogs son muy grandes: en vez de cargar la hoja entera (SheetJS
// la devuelve vacía en esos casos), se descomprime la hoja por trozos y solo se
// extraen las columnas pedidas. Sin dependencias: ZIP + DecompressionStream.

const td = new TextDecoder();

// Lee el directorio central del ZIP: {nombre: {offset, comp, metodo}}.
function leerZip(buf) {
  const dv = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 70000); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) {
    // Empieza como un .xlsx (PK) pero le falta el final: descarga o sincronización cortada.
    if (dv.getUint32(0, true) === 0x04034b50) {
      let p = 0, esperado = 0;
      while (p + 30 <= buf.byteLength && dv.getUint32(p, true) === 0x04034b50) {
        const fin = p + 30 + dv.getUint16(p + 26, true) + dv.getUint16(p + 28, true) + dv.getUint32(p + 18, true);
        esperado = Math.max(esperado, fin);
        if (fin > buf.byteLength) break;
        p = fin;
      }
      const mb = (n) => (n / 1048576).toLocaleString('es-ES', { maximumFractionDigits: 0 });
      throw new Error(`el Excel está incompleto: el archivo se ha cortado al descargarlo o sincronizarlo (pesa ${mb(buf.byteLength)} MB` +
        (esperado > buf.byteLength ? ` y debería pesar al menos ${mb(esperado)} MB` : '') +
        '). Vuelve a descargarlo de SharePoint esperando a que termine (o ábrelo en Excel y usa «Guardar como») y súbelo otra vez');
    }
    throw new Error('el fichero no es un Excel .xlsx válido');
  }
  let n = dv.getUint16(eocd + 10, true);
  let p = dv.getUint32(eocd + 16, true);
  const entradas = {};
  while (n-- > 0 && dv.getUint32(p, true) === 0x02014b50) {
    const metodo = dv.getUint16(p + 10, true);
    const comp = dv.getUint32(p + 20, true);
    const lNombre = dv.getUint16(p + 28, true), lExtra = dv.getUint16(p + 30, true), lCom = dv.getUint16(p + 32, true);
    const offset = dv.getUint32(p + 42, true);
    const nombre = td.decode(new Uint8Array(buf, p + 46, lNombre));
    entradas[nombre.replace(/^\//, '')] = { offset, comp, metodo };
    p += 46 + lNombre + lExtra + lCom;
  }
  return entradas;
}

// Devuelve un ReadableStream de texto con el contenido de una entrada del ZIP.
function streamEntrada(buf, e) {
  const dv = new DataView(buf);
  const ini = e.offset + 30 + dv.getUint16(e.offset + 26, true) + dv.getUint16(e.offset + 28, true);
  const datos = new Blob([new Uint8Array(buf, ini, e.comp)]).stream();
  const crudo = e.metodo === 8 ? datos.pipeThrough(new DecompressionStream('deflate-raw')) : datos;
  return crudo.pipeThrough(new TextDecoderStream());
}

async function textoEntrada(buf, e) {
  let out = '';
  const r = streamEntrada(buf, e).getReader();
  for (;;) {
    const { value, done } = await r.read();
    if (done) return out;
    out += value;
  }
}

// Recorre los elementos <tag>…</tag> completos de un stream XML, trozo a trozo.
async function recorrer(stream, tag, fn) {
  const re = new RegExp(`<(?:\\w+:)?${tag}[\\s>][\\s\\S]*?</(?:\\w+:)?${tag}>|<(?:\\w+:)?${tag}\\s[^>]*/>`, 'g');
  const r = stream.getReader();
  let resto = '';
  for (;;) {
    const { value, done } = await r.read();
    if (done) break;
    resto += value;
    re.lastIndex = 0;
    let m, fin = 0;
    while ((m = re.exec(resto))) {
      if (fn(m[0]) === false) { r.cancel(); return; }
      fin = re.lastIndex;
    }
    resto = resto.slice(fin);
  }
}

const desescapar = (s) => s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e) => {
  const m = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" }[e.toLowerCase()];
  if (m) return m;
  return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
});
const textos = (xml) => {
  let out = '';
  for (const m of xml.matchAll(/<(?:\w+:)?t(?:\s[^>]*)?>([\s\S]*?)<\/(?:\w+:)?t>/g)) out += m[1];
  return desescapar(out);
};
const colDeRef = (ref) => {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
};

// Parsea las celdas de una fila: [{col, valor}].
function celdas(filaXml, shared) {
  const out = [];
  let siguiente = 0;
  for (const m of filaXml.matchAll(/<(?:\w+:)?c(\s[^>]*)?(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
    const attrs = m[1] || '', cuerpo = m[2] || '';
    const r = attrs.match(/\sr="([A-Z]+)\d*"/);
    const col = r ? colDeRef(r[1]) : siguiente;
    siguiente = col + 1;
    const t = (attrs.match(/\st="([^"]+)"/) || [])[1];
    let valor = '';
    if (t === 'inlineStr') valor = textos(cuerpo);
    else {
      const v = cuerpo.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/);
      if (v) {
        if (t === 's') valor = shared[+v[1]] ?? '';
        else if (t === 'str' || t === 'e' || t === 'd') valor = desescapar(v[1]);
        else if (t === 'b') valor = v[1] === '1';
        else valor = Number(v[1]);
      }
    }
    out.push({ col, valor });
  }
  return out;
}

/**
 * Lee las columnas pedidas de la primera hoja cuya cabecera las contenga
 * (prioridad a la hoja llamada "Query").
 * @param buf ArrayBuffer del .xlsx
 * @param esCabecera fn(arrayDeTextos) -> {nombreSalida: índiceColumna} | null
 * @returns {filas: [{nombreSalida: valor}], hoja, diagnostico}
 */
export async function leerColumnasXlsx(buf, esCabecera, filtroHoja = () => true) {
  const zip = leerZip(buf);
  const wbXml = await textoEntrada(buf, zip['xl/workbook.xml']);
  const relsXml = zip['xl/_rels/workbook.xml.rels'] ? await textoEntrada(buf, zip['xl/_rels/workbook.xml.rels']) : '';
  const rels = {};
  for (const m of relsXml.matchAll(/<(?:\w+:)?Relationship\s[^>]*>/g)) {
    const id = (m[0].match(/\sId="([^"]+)"/) || [])[1], target = (m[0].match(/\sTarget="([^"]+)"/) || [])[1];
    if (id && target) rels[id] = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const hojas = [...wbXml.matchAll(/<(?:\w+:)?sheet\s[^>]*>/g)].map((m) => ({
    nombre: desescapar((m[0].match(/\sname="([^"]*)"/) || [])[1] || ''),
    path: rels[(m[0].match(/\sr:id="([^"]+)"/) || m[0].match(/\s\w+:id="([^"]+)"/) || [])[1]],
  })).filter((h) => h.path && zip[h.path]);
  hojas.sort((a, b) => /query/i.test(b.nombre) - /query/i.test(a.nombre));
  const elegidas = hojas.filter((h) => filtroHoja(h.nombre));

  const shared = [];
  if (zip['xl/sharedStrings.xml']) {
    await recorrer(streamEntrada(buf, zip['xl/sharedStrings.xml']), 'si', (si) => { shared.push(textos(si)); });
  }

  const diagnostico = [];
  for (const h of elegidas) {
    let mapa = null, nFilas = 0, primera = null;
    const filas = [];
    await recorrer(streamEntrada(buf, zip[h.path]), 'row', (rowXml) => {
      nFilas++;
      const cs = celdas(rowXml, shared);
      if (!mapa) {
        const arr = [];
        for (const c of cs) arr[c.col] = String(c.valor ?? '');
        if (!primera && cs.length) primera = arr.filter(Boolean).slice(0, 6).join(', ');
        mapa = esCabecera(arr);
        if (!mapa && nFilas > 30) return false; // esta hoja no es
        return;
      }
      const obj = {};
      let algo = false;
      for (const [k, idx] of Object.entries(mapa)) {
        const c = cs.find((x) => x.col === idx);
        obj[k] = c ? c.valor : '';
        if (obj[k] !== '') algo = true;
      }
      if (algo) filas.push(obj);
    });
    if (mapa) return { filas, hoja: h.nombre, diagnostico };
    diagnostico.push(`${h.nombre} (${nFilas ? `${nFilas} filas leídas; primera: ${primera || 'sin texto'}` : 'sin filas'})`);
  }
  return { filas: null, hoja: null, diagnostico };
}
