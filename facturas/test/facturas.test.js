'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'facturas-test-'));

const ExcelJS = require('exceljs');
const { computeInvoice, nextNumber } = require('../server');
const { fillTemplate, inspectTemplate, renderText, shiftFormula } = require('../lib/excel');
const { buildDefaultTemplate } = require('../lib/defaultTemplate');

const sampleLines = (n) =>
  Array.from({ length: n }, (_, i) => ({ descripcion: `Item ${i + 1}`, cantidad: 2, unidad: 'ud', precio: 10, descuento: 0, importe: 20 }));

test('calcula base, IVA, IRPF y total con redondeo a céntimos', () => {
  const { inv, lines } = computeInvoice({
    cliente_nombre: 'Cliente',
    fecha: '2026-03-01',
    iva_pct: '21',
    irpf_pct: '15',
    lines: [
      { descripcion: 'Punto de luz', cantidad: '3', precio: '35,5' },
      { descripcion: 'Mano de obra', cantidad: 2, precio: 25, descuento: 10 },
      { descripcion: '', cantidad: 1, precio: 99 }, // línea vacía: se ignora
    ],
  });
  assert.equal(lines.length, 2);
  assert.equal(inv.base, 151.5);
  assert.equal(inv.iva, 31.82);
  assert.equal(inv.irpf, 22.73);
  assert.equal(inv.total, 160.59);
  assert.equal(inv.numero, 'F2026-0001');
});

test('exige cliente y al menos una línea', () => {
  assert.throws(() => computeInvoice({ cliente_nombre: 'X', lines: [] }), /al menos un producto/);
  assert.throws(() => computeInvoice({ lines: [{ descripcion: 'a', precio: 1 }] }), /cliente/);
});

test('numeración correlativa por año', () => {
  assert.equal(nextNumber('2027-01-05'), 'F2027-0001');
});

test('la plantilla por defecto se rellena y repite la fila de líneas', async () => {
  const tpl = await buildDefaultTemplate();
  const info = await inspectTemplate(tpl);
  assert.ok(info.hasLines);
  assert.deepEqual(info.unknown, []);

  const out = await fillTemplate(
    tpl,
    { numero: 'F2026-0007', fecha: '2026-05-04', cliente_nombre: 'Ana', base: 120, iva_pct: 21, iva: 25.2, irpf_pct: 0, irpf: 0, total: 145.2 },
    sampleLines(6),
    { 'empresa.nombre': 'Electricidad Test' }
  );
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(out);
  const ws = wb.getWorksheet(1);
  const texts = [];
  ws.eachRow((row) => row.eachCell((c) => texts.push(typeof c.value === 'object' && c.value?.richText ? c.value.richText.map((r) => r.text).join('') : c.value)));
  assert.ok(texts.includes('F2026-0007'));
  assert.ok(texts.includes('04/05/2026'));
  assert.ok(texts.includes('Electricidad Test'));
  for (let i = 1; i <= 6; i++) assert.ok(texts.includes(`Item ${i}`), `falta Item ${i}`);
  assert.ok(texts.includes(145.2));
  assert.ok(!texts.some((t) => typeof t === 'string' && t.includes('{{')), 'quedan marcadores sin sustituir');
});

test('plantilla con fórmulas propias: inserta filas y ajusta las sumas', async () => {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('F');
  for (let r = 10; r <= 12; r++) {
    ws.getCell(`C${r}`).value = { formula: `A${r}*B${r}` };
    ws.getCell(`A${r}`).border = { bottom: { style: 'thin' } };
  }
  ws.getCell('A10').value = '{{linea.cantidad}}';
  ws.getCell('B10').value = '{{linea.precio}}';
  ws.getCell('D10').value = '{{linea.descripcion}}';
  ws.mergeCells('A14:B14');
  ws.getCell('A14').value = 'Total';
  ws.getCell('C14').value = { formula: 'SUM(C10:C12)' };
  const tpl = Buffer.from(await wb.xlsx.writeBuffer());

  const out = await fillTemplate(tpl, { numero: '1' }, sampleLines(5), {});
  const res = new ExcelJS.Workbook();
  await res.xlsx.load(out);
  const s = res.getWorksheet(1);
  assert.equal(s.getCell('C16').formula, 'SUM(C10:C14)');
  for (let r = 10; r <= 14; r++) {
    assert.equal(s.getCell(`C${r}`).formula, `A${r}*B${r}`);
    assert.equal(s.getCell(`A${r}`).value, 2);
  }
  assert.ok(s.model.merges.includes('A16:B16'));
});

test('sustitución de marcadores en textos y fórmulas', () => {
  assert.equal(renderText('Factura {{numero}} total {{total}}', { numero: 'F1', total: 1234.5 }), 'Factura F1 total 1234,50 €');
  assert.equal(shiftFormula('SUM(C10:C12)+$D$20+LOG10(C11)', 11, 2), 'SUM(C10:C14)+$D$22+LOG10(C13)');
});
