'use strict';
// Relleno automático de la plantilla Excel de la factura.
//
// La plantilla es un .xlsx normal en el que se escriben marcadores entre
// llaves dobles, por ejemplo {{numero}}, {{cliente.nombre}} o {{total}}.
// La fila que contiene marcadores {{linea.xxx}} se repite una vez por cada
// producto/servicio de la factura.
const ExcelJS = require('exceljs');

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g;
const SINGLE_RE = /^\s*\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}\s*$/;

// Lista de marcadores disponibles (se muestra en la pantalla de Ajustes).
const PLACEHOLDERS = {
  'Tu empresa': [
    ['empresa.nombre', 'Nombre o razón social'],
    ['empresa.nif', 'NIF / DNI'],
    ['empresa.direccion', 'Dirección'],
    ['empresa.cp', 'Código postal'],
    ['empresa.ciudad', 'Ciudad'],
    ['empresa.provincia', 'Provincia'],
    ['empresa.telefono', 'Teléfono'],
    ['empresa.email', 'Email'],
    ['empresa.iban', 'IBAN / cuenta bancaria'],
  ],
  Factura: [
    ['numero', 'Número de factura'],
    ['fecha', 'Fecha de emisión (dd/mm/aaaa)'],
    ['vencimiento', 'Fecha de vencimiento'],
    ['forma_pago', 'Forma de pago'],
    ['notas', 'Notas / observaciones'],
  ],
  Cliente: [
    ['cliente.nombre', 'Nombre del cliente'],
    ['cliente.nif', 'NIF / CIF del cliente'],
    ['cliente.direccion', 'Dirección'],
    ['cliente.cp', 'Código postal'],
    ['cliente.ciudad', 'Ciudad'],
    ['cliente.provincia', 'Provincia'],
    ['cliente.email', 'Email'],
    ['cliente.telefono', 'Teléfono'],
  ],
  'Líneas (la fila se repite por cada producto)': [
    ['linea.num', 'Nº de línea'],
    ['linea.descripcion', 'Producto / servicio'],
    ['linea.cantidad', 'Cantidad'],
    ['linea.unidad', 'Unidad (ud, m, h...)'],
    ['linea.precio', 'Precio unitario'],
    ['linea.descuento', 'Descuento %'],
    ['linea.importe', 'Importe de la línea'],
  ],
  Totales: [
    ['base', 'Base imponible'],
    ['iva_pct', '% de IVA'],
    ['iva', 'Cuota de IVA'],
    ['irpf_pct', '% de retención IRPF'],
    ['irpf', 'Retención IRPF'],
    ['total', 'Total factura'],
  ],
};

const MONEY_KEYS = new Set(['base', 'iva', 'irpf', 'total', 'linea.precio', 'linea.importe']);
const MONEY_FMT = '#,##0.00 "€"';

const money = (n) =>
  new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

function fmtDate(iso) {
  if (!iso) return '';
  const [y, m, d] = String(iso).slice(0, 10).split('-');
  return d && m && y ? `${d}/${m}/${y}` : String(iso);
}

// Valores "planos" de la factura: { 'cliente.nombre': 'Juan', total: 121, ... }
function buildValues(invoice, settings) {
  const v = {};
  for (const [k] of PLACEHOLDERS['Tu empresa']) v[k] = settings[k] || '';
  Object.assign(v, {
    numero: invoice.numero,
    fecha: fmtDate(invoice.fecha),
    vencimiento: fmtDate(invoice.vencimiento),
    forma_pago: invoice.forma_pago || '',
    notas: invoice.notas || '',
    'cliente.nombre': invoice.cliente_nombre || '',
    'cliente.nif': invoice.cliente_nif || '',
    'cliente.direccion': invoice.cliente_direccion || '',
    'cliente.cp': invoice.cliente_cp || '',
    'cliente.ciudad': invoice.cliente_ciudad || '',
    'cliente.provincia': invoice.cliente_provincia || '',
    'cliente.email': invoice.cliente_email || '',
    'cliente.telefono': invoice.cliente_telefono || '',
    base: invoice.base,
    iva_pct: invoice.iva_pct,
    iva: invoice.iva,
    irpf_pct: invoice.irpf_pct,
    irpf: invoice.irpf,
    total: invoice.total,
  });
  return v;
}

function lineValues(line, i) {
  return {
    'linea.num': i + 1,
    'linea.descripcion': line.descripcion,
    'linea.cantidad': line.cantidad,
    'linea.unidad': line.unidad || '',
    'linea.precio': line.precio,
    'linea.descuento': line.descuento || 0,
    'linea.importe': line.importe,
  };
}

// Texto para sustituir en el cuerpo del correo o en celdas con texto mezclado.
function asText(key, val) {
  if (val == null) return '';
  if (MONEY_KEYS.has(key)) return money(val);
  if (typeof val === 'number') return val.toLocaleString('es-ES', { maximumFractionDigits: 2 });
  return String(val);
}

function renderText(template, values) {
  return String(template || '').replace(PLACEHOLDER_RE, (m, key) => (key in values ? asText(key, values[key]) : m));
}

function cellText(cell) {
  const v = cell.value;
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (v.richText) return v.richText.map((r) => r.text).join('');
  return '';
}

function hasPlaceholder(text) {
  PLACEHOLDER_RE.lastIndex = 0;
  return PLACEHOLDER_RE.test(text);
}

// Sustituye los marcadores de una celda. Si la celda contiene SOLO un marcador
// numérico se escribe como número (así se pueden usar fórmulas en la plantilla).
function fillCell(cell, values) {
  const text = cellText(cell);
  if (!text || !hasPlaceholder(text)) return;
  const single = text.match(SINGLE_RE);
  if (single && single[1] in values) {
    const key = single[1];
    const val = values[key];
    if (typeof val === 'number') {
      cell.value = Math.round(val * 100) / 100;
      // (se crea un estilo nuevo: ExcelJS comparte el objeto de estilo entre celdas)
      if (MONEY_KEYS.has(key) && (!cell.numFmt || cell.numFmt === 'General')) cell.style = { ...cell.style, numFmt: MONEY_FMT };
      return;
    }
    cell.value = val == null ? '' : String(val);
    return;
  }
  // Texto enriquecido: se sustituye trozo a trozo para conservar negritas, colores...
  const rich = cell.value && cell.value.richText;
  if (rich && rich.map((r) => renderText(r.text, values)).join('') === renderText(text, values)) {
    cell.value = { richText: rich.map((r) => ({ ...r, text: renderText(r.text, values) })) };
    return;
  }
  cell.value = renderText(text, values);
}

// --- Inserción de filas conservando celdas combinadas y fórmulas -------------

// Desplaza las referencias a filas >= fromRow en una fórmula (mismo libro, estilo A1).
function shiftFormula(formula, fromRow, count) {
  return formula.replace(/(^|[^A-Za-z0-9_.!"'])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, d1, col, d2, row) => {
    const r = Number(row);
    return `${pre}${d1}${col}${d2}${r >= fromRow ? r + count : r}`;
  });
}

// Copia una fórmula a otra fila (como al arrastrar en Excel): mueve las filas relativas.
function copyFormula(formula, delta) {
  return formula.replace(/(^|[^A-Za-z0-9_.!"'])(\$?)([A-Z]{1,3})(\$?)(\d+)(?![\d(A-Za-z_])/g, (m, pre, d1, col, d2, row) =>
    `${pre}${d1}${col}${d2}${d2 ? row : Number(row) + delta}`
  );
}

function insertRows(ws, afterRow, count, styleRow) {
  if (count <= 0) return;
  const fromRow = afterRow + 1;

  // 1) Celdas combinadas situadas debajo: se deshacen y se vuelven a crear desplazadas.
  const merges = [...(ws.model.merges || [])];
  const moved = [];
  for (const range of merges) {
    const [tl, br] = range.split(':');
    const top = Number(tl.match(/\d+/)[0]);
    if (top >= fromRow) {
      ws.unMergeCells(range);
      const bottom = Number(br.match(/\d+/)[0]);
      moved.push(
        `${tl.replace(/\d+/, top + count)}:${br.replace(/\d+/, bottom + count)}`
      );
    }
  }

  // 2) Fórmulas de toda la hoja: se ajustan antes de mover las filas.
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const f = cell.formula;
      if (f) cell.value = { formula: shiftFormula(f, fromRow, count) };
    });
  });

  // 3) Insertar filas vacías y copiar el formato de la fila de líneas.
  ws.spliceRows(fromRow, 0, ...Array.from({ length: count }, () => []));
  const src = ws.getRow(styleRow);
  for (let i = 0; i < count; i++) {
    const row = ws.getRow(fromRow + i);
    if (src.height) row.height = src.height;
    src.eachCell({ includeEmpty: true }, (cell, col) => {
      const dst = row.getCell(col);
      dst.style = JSON.parse(JSON.stringify(cell.style || {}));
      // Fórmulas de la fila de líneas (p.ej. =B10*C10) se copian a la nueva fila
      if (cell.formula) dst.value = { formula: copyFormula(cell.formula, fromRow + i - styleRow) };
    });
  }

  // 4) Combinaciones de la propia fila de líneas (p.ej. descripción en B:D).
  for (const range of merges) {
    const [tl, br] = range.split(':');
    const top = Number(tl.match(/\d+/)[0]);
    const bottom = Number(br.match(/\d+/)[0]);
    if (top === styleRow && bottom === styleRow) {
      for (let i = 0; i < count; i++) {
        moved.push(`${tl.replace(/\d+/, fromRow + i)}:${br.replace(/\d+/, fromRow + i)}`);
      }
    }
  }
  for (const range of moved) ws.mergeCells(range);
}

// --- Relleno de la tabla de líneas -------------------------------------------

function fillLines(ws, lines) {
  // Busca la fila plantilla (la que tiene marcadores {{linea.x}}).
  let tplRow = null;
  const tplCells = []; // [{ col, text }]
  ws.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (tplRow) return;
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      const t = cellText(cell);
      if (/\{\{\s*linea\./.test(t)) {
        tplRow = rowNumber;
        tplCells.push({ col, text: t, value: JSON.parse(JSON.stringify(cell.value)) });
      }
    });
    if (tplRow) {
      // Recoge también el resto de celdas de la fila con marcadores (misma fila)
      row.eachCell({ includeEmpty: false }, (cell, col) => {
        const t = cellText(cell);
        if (hasPlaceholder(t) && !tplCells.some((c) => c.col === col)) tplCells.push({ col, text: t, value: JSON.parse(JSON.stringify(cell.value)) });
      });
    }
  });
  if (!tplRow) return;
  tplCells.sort((a, b) => a.col - b.col);

  // Cuántas filas de la tabla hay debajo para rellenar sin insertar (tabla fija).
  // Una fila cuenta como libre si:
  //  - está vacía en las columnas de líneas y no tiene otros textos/números,
  //  - tiene las mismas fórmulas por fila que la fila plantilla (p.ej. =B11*C11), y
  //  - si la plantilla no usa fórmulas, tiene formato de tabla (bordes o relleno).
  //    Así una fila en blanco de separación antes de los totales no se usa.
  const cols = tplCells.map((c) => c.col);
  const isMergedSlave = (cell) => cell.isMerged && cell.master && cell.master.address !== cell.address;
  const formulaCols = [];
  ws.getRow(tplRow).eachCell({ includeEmpty: false }, (cell, col) => {
    if (cell.formula && !cols.includes(col)) formulaCols.push(col);
  });
  const hasTableStyle = (cell) => !!(cell && ((cell.border && Object.keys(cell.border).length) || (cell.fill && cell.fill.type)));

  let free = 1;
  for (let r = tplRow + 1; ; r++) {
    if (r > ws.rowCount) {
      free = Infinity; // no hay nada debajo: se puede escribir sin insertar
      break;
    }
    const row = ws.findRow(r);
    if (!row) break;
    let ok = cols.every((c) => {
      const cell = row.findCell(c);
      return !cell || (!isMergedSlave(cell) && !cell.formula && (cell.value == null || cellText(cell) === ''));
    });
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (isMergedSlave(cell) || cell.formula) return;
      if (typeof cell.value === 'number' || cellText(cell) !== '') ok = false;
    });
    if (formulaCols.length) ok = ok && formulaCols.every((c) => row.findCell(c)?.formula);
    else ok = ok && cols.some((c) => hasTableStyle(row.findCell(c)));
    if (!ok) break;
    free++;
  }

  const needed = Math.max(lines.length, 1);
  if (needed > free) insertRows(ws, tplRow, needed - free, tplRow);

  const srcStyles = Object.fromEntries(
    cols.map((c) => [c, JSON.parse(JSON.stringify(ws.getRow(tplRow).getCell(c).style || {}))])
  );

  for (let i = 0; i < needed; i++) {
    const row = ws.getRow(tplRow + i);
    const values = lines[i] ? lineValues(lines[i], i) : null;
    for (const { col, value } of tplCells) {
      const cell = row.getCell(col);
      if (i > 0) cell.style = JSON.parse(JSON.stringify(srcStyles[col]));
      if (!values) {
        cell.value = null;
        continue;
      }
      cell.value = JSON.parse(JSON.stringify(value));
      fillCell(cell, values);
    }
  }
}

// --- API pública ---------------------------------------------------------------

async function fillTemplate(templateBuffer, invoice, lines, settings) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const values = buildValues(invoice, settings);

  wb.eachSheet((ws) => {
    fillLines(ws, lines);
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        if (cell.isMerged && cell.master && cell.master.address !== cell.address) return;
        fillCell(cell, values);
      });
    });
    // Quita resultados en caché de las fórmulas para que Excel/LibreOffice las recalculen.
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const f = cell.formula;
        if (f && cell.type === ExcelJS.ValueType.Formula) cell.value = { formula: f };
      });
    });
  });

  wb.calcProperties = { ...(wb.calcProperties || {}), fullCalcOnLoad: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// Devuelve los marcadores encontrados en una plantilla (para validarla al subirla).
async function inspectTemplate(templateBuffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBuffer);
  const found = new Set();
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        for (const m of cellText(cell).matchAll(PLACEHOLDER_RE)) found.add(m[1]);
      });
    });
  });
  const known = new Set(Object.values(PLACEHOLDERS).flat().map(([k]) => k));
  const list = [...found];
  return {
    sheets: wb.worksheets.map((w) => w.name),
    found: list.filter((k) => known.has(k)),
    unknown: list.filter((k) => !known.has(k)),
    hasLines: list.some((k) => k.startsWith('linea.')),
  };
}

module.exports = { fillTemplate, inspectTemplate, renderText, buildValues, PLACEHOLDERS, money, fmtDate, shiftFormula };
