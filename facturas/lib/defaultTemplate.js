'use strict';
// Genera una plantilla de factura por defecto (se usa hasta que subas la tuya).
// También se puede descargar desde Ajustes como ejemplo de marcadores.
const ExcelJS = require('exceljs');

async function buildDefaultTemplate() {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Facturas';
  const ws = wb.addWorksheet('Factura', {
    pageSetup: { paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
      margins: { left: 0.5, right: 0.5, top: 0.6, bottom: 0.6, header: 0.3, footer: 0.3 } },
  });
  ws.columns = [
    { width: 6 },  // A nº
    { width: 44 }, // B descripción
    { width: 10 }, // C cantidad
    { width: 8 },  // D unidad
    { width: 13 }, // E precio
    { width: 9 },  // F dto
    { width: 15 }, // G importe
  ];

  const accent = 'FF1F4E79';
  const light = 'FFDDEBF7';
  const money = '#,##0.00 "€"';
  const thin = { style: 'thin', color: { argb: 'FFB4C6E7' } };

  ws.mergeCells('A1:D1');
  ws.getCell('A1').value = '{{empresa.nombre}}';
  ws.getCell('A1').font = { size: 18, bold: true, color: { argb: accent } };
  ws.getRow(1).height = 28;
  const empresa = ['NIF: {{empresa.nif}}', '{{empresa.direccion}}', '{{empresa.cp}} {{empresa.ciudad}} ({{empresa.provincia}})',
    'Tel: {{empresa.telefono}} · {{empresa.email}}'];
  empresa.forEach((t, i) => {
    ws.mergeCells(`A${i + 2}:D${i + 2}`);
    ws.getCell(`A${i + 2}`).value = t;
    ws.getCell(`A${i + 2}`).font = { size: 10, color: { argb: 'FF444444' } };
  });

  ws.mergeCells('E1:G1');
  ws.getCell('E1').value = 'FACTURA';
  ws.getCell('E1').font = { size: 22, bold: true, color: { argb: accent } };
  ws.getCell('E1').alignment = { horizontal: 'right' };
  const datos = [['Nº factura:', '{{numero}}'], ['Fecha:', '{{fecha}}'], ['Vencimiento:', '{{vencimiento}}']];
  datos.forEach(([k, v], i) => {
    const r = i + 2;
    ws.mergeCells(`E${r}:F${r}`);
    ws.getCell(`E${r}`).value = k;
    ws.getCell(`E${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`E${r}`).font = { bold: true };
    ws.getCell(`G${r}`).value = v;
    ws.getCell(`G${r}`).alignment = { horizontal: 'right' };
  });

  ws.getCell('A7').value = 'FACTURAR A';
  ws.getCell('A7').font = { bold: true, color: { argb: accent } };
  const cliente = ['{{cliente.nombre}}', 'NIF: {{cliente.nif}}', '{{cliente.direccion}}',
    '{{cliente.cp}} {{cliente.ciudad}} {{cliente.provincia}}'];
  cliente.forEach((t, i) => {
    ws.mergeCells(`A${i + 8}:D${i + 8}`);
    ws.getCell(`A${i + 8}`).value = t;
    if (i === 0) ws.getCell(`A${i + 8}`).font = { bold: true, size: 12 };
  });

  const header = ['Nº', 'Descripción', 'Cantidad', 'Ud.', 'Precio', 'Dto. %', 'Importe'];
  const hr = ws.getRow(13);
  header.forEach((h, i) => {
    const c = hr.getCell(i + 1);
    c.value = h;
    c.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: accent } };
    c.alignment = { horizontal: i === 1 ? 'left' : 'center', vertical: 'middle' };
  });
  hr.height = 20;

  const lr = ws.getRow(14);
  ['{{linea.num}}', '{{linea.descripcion}}', '{{linea.cantidad}}', '{{linea.unidad}}', '{{linea.precio}}',
    '{{linea.descuento}}', '{{linea.importe}}'].forEach((v, i) => {
    const c = lr.getCell(i + 1);
    c.value = v;
    c.border = { bottom: thin };
    c.alignment = { horizontal: i === 1 ? 'left' : i === 3 || i === 0 ? 'center' : 'right', vertical: 'top', wrapText: i === 1 };
    if (i === 4 || i === 6) c.numFmt = money;
  });

  const totals = [['Base imponible', '{{base}}'], ['IVA ({{iva_pct}}%)', '{{iva}}'],
    ['Retención IRPF ({{irpf_pct}}%)', '{{irpf}}'], ['TOTAL', '{{total}}']];
  totals.forEach(([k, v], i) => {
    const r = 16 + i;
    ws.mergeCells(`E${r}:F${r}`);
    ws.getCell(`E${r}`).value = k;
    ws.getCell(`E${r}`).alignment = { horizontal: 'right' };
    ws.getCell(`G${r}`).value = v;
    ws.getCell(`G${r}`).numFmt = money;
    ws.getCell(`G${r}`).alignment = { horizontal: 'right' };
    if (k === 'TOTAL') {
      for (const col of ['E', 'F', 'G']) {
        ws.getCell(`${col}${r}`).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: light } };
        ws.getCell(`${col}${r}`).font = { bold: true, size: 12, color: { argb: accent } };
      }
    }
  });

  const base = { name: 'Arial', size: 10 };
  ws.mergeCells('A21:G21');
  ws.getCell('A21').value = {
    richText: [{ text: 'Forma de pago: ', font: { ...base, bold: true } }, { text: '{{forma_pago}} · IBAN: {{empresa.iban}}', font: base }],
  };
  ws.mergeCells('A22:G24');
  ws.getCell('A22').value = { richText: [{ text: 'Notas: ', font: { ...base, bold: true } }, { text: '{{notas}}', font: base }] };
  ws.getCell('A22').alignment = { wrapText: true, vertical: 'top' };

  // Misma fuente en toda la hoja
  ws.eachRow({ includeEmpty: true }, (row) =>
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.font = { name: 'Arial', size: 10, ...(cell.font || {}) };
    })
  );

  return Buffer.from(await wb.xlsx.writeBuffer());
}

module.exports = { buildDefaultTemplate };
