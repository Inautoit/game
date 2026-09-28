/* Genera el PDF de la factura en el navegador con pdf-lib.
 * Reproduce la plantilla "plantilla_en_blanco" (C&M Instalaciones Eléctricas).
 * Todas las medidas están en puntos, medidas desde ARRIBA de la página (A4). */
(() => {
  'use strict';
  const { PDFDocument, StandardFonts, rgb, degrees } = window.PDFLib;

  const PW = 595.28;
  const PH = 841.89;

  // Posiciones sacadas de la plantilla Excel
  const L = {
    logo: { x: 62, top: 88, w: 146, h: 48 },
    headCenterX: 135,
    tabla: { top: 279, head: 11, bottom: 606, x: [44, 122, 387, 471, 558] }, // Cantidad | Descripción | Precio | TOTAL
    sello: { x: 44, top: 629, w: 244, h: 75 },
  };
  const ROW_H = 11.4;

  const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  const numES = (n) => (Number(n) || 0).toLocaleString('es-ES', { maximumFractionDigits: 3 });
  const fdate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');

  async function embedImage(pdf, dataUrl) {
    if (!dataUrl) return null;
    try {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), (c) => c.charCodeAt(0));
      return /^data:image\/png/.test(dataUrl) ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
    } catch {
      return null;
    }
  }

  async function buildInvoicePdf(inv, s) {
    const pdf = await PDFDocument.create();
    const esPres = inv.tipo === 'presupuesto';
    const TITULO = esPres ? 'PRESUPUESTO' : 'FACTURA';
    pdf.setTitle(`${esPres ? 'Presupuesto' : 'Factura'} ${inv.numero}`);
    pdf.setAuthor(s['empresa.nombre'] || '');
    pdf.setCreator('Facturas');

    const helv = await pdf.embedFont(StandardFonts.Helvetica);
    const helvB = await pdf.embedFont(StandardFonts.HelveticaBold);
    const times = await pdf.embedFont(StandardFonts.TimesRoman);
    const timesB = await pdf.embedFont(StandardFonts.TimesRomanBold);
    const charset = new Set(helv.getCharacterSet());
    const clean = (t) => [...String(t ?? '').replace(/\t/g, ' ')].map((ch) => (ch === '\n' || charset.has(ch.codePointAt(0)) ? ch : '?')).join('');

    const black = rgb(0, 0, 0);
    const grey = rgb(0.75, 0.75, 0.75);
    const headGrey = rgb(0.85, 0.85, 0.85);
    const blue = rgb(0.12, 0.23, 0.5);
    const linkBlue = rgb(0.2, 0.3, 0.7);

    const logo = await embedImage(pdf, s['empresa.logo']);
    const sello = await embedImage(pdf, s['empresa.sello']);

    let page;
    const Y = (top) => PH - top;
    const text = (t, x, top, { size = 9, f = helv, color = black, align = 'left', maxWidth } = {}) => {
      t = clean(t);
      if (maxWidth && f.widthOfTextAtSize(t, size) > maxWidth) {
        while (t && f.widthOfTextAtSize(t + '…', size) > maxWidth) t = t.slice(0, -1);
        t += '…';
      }
      const w = f.widthOfTextAtSize(t, size);
      const xx = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x;
      page.drawText(t, { x: xx, y: Y(top), size, font: f, color });
    };
    const hline = (x1, x2, top, th = 0.6, color = black) =>
      page.drawLine({ start: { x: x1, y: Y(top) }, end: { x: x2, y: Y(top) }, thickness: th, color });
    const vline = (x, t1, t2, th = 0.6, color = black) =>
      page.drawLine({ start: { x, y: Y(t1) }, end: { x, y: Y(t2) }, thickness: th, color });
    const rect = (x, top, w, h, opts) => page.drawRectangle({ x, y: Y(top + h), width: w, height: h, ...opts });

    const wrap = (t, width, size = 9, f = helv) => {
      const out = [];
      for (const para of clean(t).split('\n')) {
        let cur = '';
        for (const word of para.split(/\s+/)) {
          const next = cur ? cur + ' ' + word : word;
          if (f.widthOfTextAtSize(next, size) <= width) cur = next;
          else {
            if (cur) out.push(cur);
            let w = word;
            while (f.widthOfTextAtSize(w, size) > width) {
              let i = w.length;
              while (i > 1 && f.widthOfTextAtSize(w.slice(0, i), size) > width) i--;
              out.push(w.slice(0, i));
              w = w.slice(i);
            }
            cur = w;
          }
        }
        out.push(cur);
      }
      return out;
    };

    // ---------------------------------------------------------- Cabecera
    function drawHeader(pageNum, pages) {
      page = pdf.addPage([PW, PH]);
      const cx = L.headCenterX;

      if (logo) {
        const r = Math.min(L.logo.w / logo.width, L.logo.h / logo.height);
        const w = logo.width * r;
        const h = logo.height * r;
        page.drawImage(logo, { x: cx - w / 2, y: Y(L.logo.top + L.logo.h - (L.logo.h - h) / 2), width: w, height: h });
      }
      hline(50, 220, 138, 0.8, blue);
      text(s['empresa.actividad'] || '', cx, 152, { size: 11, f: timesB, color: blue, align: 'center', maxWidth: 190 });
      hline(50, 220, 157, 0.8, blue);
      const cpLinea = [s['empresa.cp'], s['empresa.ciudad'] && `( ${s['empresa.ciudad'].toUpperCase()})`, s['empresa.nif'] && `NIF-${s['empresa.nif']}`]
        .filter(Boolean)
        .join('  ');
      [s['empresa.nombre'], s['empresa.direccion'], cpLinea, s['empresa.telefono'] && `TLF - ${s['empresa.telefono']}`].forEach((l, i) => {
        if (l) text(l, cx, 168 + i * 15, { size: 8.5, f: times, align: 'center', maxWidth: 200 });
      });

      // Email en vertical (margen izquierdo)
      if (s['empresa.email']) {
        const size = 7.5;
        const w = helv.widthOfTextAtSize(clean(s['empresa.email']), size);
        const mid = (L.tabla.top + L.tabla.bottom) / 2;
        page.drawText(clean(s['empresa.email']), { x: 41, y: Y(mid) - w / 2, size, font: helv, color: linkBlue, rotate: degrees(90) });
        page.drawLine({ start: { x: 42.5, y: Y(mid) - w / 2 }, end: { x: 42.5, y: Y(mid) + w / 2 }, thickness: 0.4, color: linkBlue });
      }

      text(TITULO, 455, 128, { size: 15, f: helvB, align: 'center' });
      text('Cliente', 274, 152, { size: 11, f: helvB });

      const campos = [
        ['Nombre', inv.cliente_nombre],
        ['Dirección', inv.cliente_direccion],
        ['Ciudad', [inv.cliente_ciudad, inv.cliente_provincia].filter(Boolean).join(' (') + (inv.cliente_provincia && inv.cliente_ciudad ? ')' : '')],
        ['CP', inv.cliente_cp],
        ['NIF', inv.cliente_nif],
      ];
      campos.forEach(([k, v], i) => {
        const top = 168 + i * 15;
        text(k, 247, top, { size: 7.5, f: helvB });
        hline(288, 558, top + 2, 0.5);
        text(v || '', 291, top, { size: 9, maxWidth: 265 });
      });

      const nLabel = `Nº DE ${TITULO}`;
      const vx = Math.max(122, 46 + helvB.widthOfTextAtSize(nLabel, 8.5) + 6);
      text(nLabel, 46, 241, { size: 8.5, f: helvB });
      hline(vx, vx + 67, 243, 0.5);
      text(inv.numero, vx + 2, 240.5, { size: 9.5, f: helvB, maxWidth: 110 });
      text('FECHA', 46, 265, { size: 8.5, f: helvB });
      hline(vx, vx + 124, 267, 0.5);
      text(fdate(inv.fecha), vx + 2, 264.5, { size: 9.5 });
      if (esPres && inv.vencimiento) {
        text('VÁLIDO HASTA', 288, 265, { size: 8.5, f: helvB });
        text(fdate(inv.vencimiento), 358, 264.5, { size: 9.5 });
      }
      if (pages > 1) text(`Página ${pageNum} de ${pages}`, 558, 265, { size: 7.5, align: 'right' });

      // Tabla
      const t = L.tabla;
      const x = t.x;
      rect(x[0], t.top, x[4] - x[0], t.head, { color: headGrey });
      hline(x[0], x[4], t.top, 1.2);
      hline(x[0], x[4], t.top + t.head, 0.8);
      text('Cantidad', (x[0] + x[1]) / 2, t.top + 8.5, { size: 7.5, f: helvB, align: 'center' });
      text('Descripción', x[1] + 10, t.top + 8.5, { size: 7.5, f: helvB });
      text('Precio unitario', (x[2] + x[3]) / 2, t.top + 8.5, { size: 7.5, f: helvB, align: 'center' });
      text('TOTAL', (x[3] + x[4]) / 2, t.top + 8.5, { size: 7.5, f: helvB, align: 'center' });
      for (const xx of x) vline(xx, t.top, t.bottom, xx === x[0] || xx === x[4] ? 1 : 0.6);
      hline(x[0], x[4], t.bottom, 1);
    }

    // ---------------------------------------------------------- Líneas
    const t = L.tabla;
    const descW = t.x[2] - t.x[1] - 14;
    const rows = inv.lines.map((l) => ({ l, desc: wrap(l.descripcion, descW, 8.5) }));
    const capacity = t.bottom - (t.top + t.head) - 4;
    const pagesRows = [[]];
    let used = 0;
    for (const r of rows) {
      const h = r.desc.length * ROW_H;
      if (used + h > capacity && pagesRows.at(-1).length) {
        pagesRows.push([]);
        used = 0;
      }
      pagesRows.at(-1).push(r);
      used += h;
    }

    pagesRows.forEach((list, pi) => {
      drawHeader(pi + 1, pagesRows.length);
      let top = t.top + t.head + 2;
      for (const { l, desc } of list) {
        const base = top + 8.5;
        text(numES(l.cantidad) + (l.unidad && l.unidad !== 'ud' ? ' ' + l.unidad : ''), (t.x[0] + t.x[1]) / 2, base, { size: 8.5, align: 'center', maxWidth: t.x[1] - t.x[0] - 6 });
        desc.forEach((d, k) => text(d, t.x[1] + 6, base + k * ROW_H, { size: 8.5 }));
        const precio = eur(l.precio) + (Number(l.descuento) ? ` (-${numES(l.descuento)}%)` : '');
        text(precio, t.x[3] - 5, base, { size: 8.5, align: 'right', maxWidth: t.x[3] - t.x[2] - 8 });
        text(eur(l.importe), t.x[4] - 5, base, { size: 8.5, align: 'right' });
        top += desc.length * ROW_H;
      }
      if (pi < pagesRows.length - 1) {
        const suma = pagesRows.slice(0, pi + 1).flat().reduce((a, r) => a + Number(r.l.importe || 0), 0);
        text('Suma y sigue', t.x[3] - 5, t.bottom + 10, { size: 8, align: 'right' });
        text(eur(suma), t.x[4] - 5, t.bottom + 10, { size: 8, align: 'right' });
      }
    });

    // ---------------------------------------------------------- Totales (última página)
    const [x0, , x2, x3, x4] = t.x;
    // Subtotal
    rect(x3, 606, x4 - x3, 12, { color: grey, borderColor: black, borderWidth: 0.6 });
    text('Subtotal', x3 - 6, 615, { size: 8.5, align: 'right' });
    text(eur(inv.base), x4 - 5, 615, { size: 9, align: 'right' });
    // IVA
    text('IVA', 346, 637.5, { size: 8.5, f: helvB });
    rect(x2, 629, x3 - x2, 11.5, { borderColor: black, borderWidth: 0.6 });
    text(`${numES(inv.iva_pct)} %`, x3 - 5, 637.5, { size: 8.5, align: 'right' });
    rect(x3, 629, x4 - x3, 11.5, { color: grey, borderColor: black, borderWidth: 0.6 });
    text(eur(inv.iva), x4 - 5, 637.5, { size: 9, align: 'right' });
    // IRPF (solo si hay retención)
    let totalTop = 651;
    if (Number(inv.irpf_pct)) {
      text('IRPF', 346, 649, { size: 8.5, f: helvB });
      rect(x2, 641, x3 - x2, 11.5, { borderColor: black, borderWidth: 0.6 });
      text(`${numES(inv.irpf_pct)} %`, x3 - 5, 649, { size: 8.5, align: 'right' });
      rect(x3, 641, x4 - x3, 11.5, { color: grey, borderColor: black, borderWidth: 0.6 });
      text('-' + eur(inv.irpf), x4 - 5, 649, { size: 9, align: 'right' });
      totalTop = 656;
    }
    // TOTAL
    rect(x2, totalTop, x3 - x2, 12.5, { borderColor: black, borderWidth: 1.4 });
    text('TOTAL', x3 - 6, totalTop + 9.5, { size: 8.5, align: 'right' });
    rect(x3, totalTop, x4 - x3, 12.5, { color: grey, borderColor: black, borderWidth: 1.4 });
    text(eur(inv.total), x4 - 5, totalTop + 9.5, { size: 9.5, f: helvB, align: 'right' });

    // Recuadro del sello / firma
    const sb = L.sello;
    rect(sb.x, sb.top, sb.w, sb.h, { borderColor: rgb(0.7, 0.7, 0.7), borderWidth: 0.6 });
    if (sello) {
      // Como un sello real: puede sobresalir un poco del recuadro
      const r = Math.min((sb.w - 10) / sello.width, (sb.h + 30) / sello.height);
      const w = sello.width * r;
      const h = sello.height * r;
      page.drawImage(sello, { x: sb.x + (sb.w - w) / 2, y: Y(sb.top + sb.h - (sb.h - h) / 2), width: w, height: h });
    }

    // Datos de pago: a la derecha del sello
    const bx = sb.x + sb.w + 14;
    let by = totalTop + 26;
    const pago = [
      ['Forma de pago', inv.forma_pago],
      ['Banco', inv.banco_nombre],
      ['IBAN', inv.banco_iban],
      ['BIC/SWIFT', inv.banco_swift],
    ].filter(([, v]) => v);
    for (const [k, v] of pago) {
      text(k + ':', bx, by, { size: 8.5, f: helvB });
      text(v, bx + 68, by, { size: k === 'IBAN' ? 9.5 : 8.5, f: k === 'IBAN' ? helvB : helv, maxWidth: x4 - bx - 68 });
      by += 12.5;
    }

    // Observaciones (bajo el sello)
    if (inv.notas) {
      const notas = wrap(inv.notas, x4 - x0, 7.5).slice(0, 5);
      notas.forEach((n, i) => text(n, x0, 722 + i * 9.5, { size: 7.5 }));
    } else {
      hline(122, 471, 714, 0.4, grey);
    }

    return pdf.save();
  }

  function toBase64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  // Limpia una imagen de firma/sello: fondo blanco -> transparente y quita las
  // líneas negras rectas de los bordes (por ser una captura de pantalla).
  async function cleanStamp(file) {
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = rej;
      i.src = url;
    });
    URL.revokeObjectURL(url);
    const scale = Math.min(1, 900 / img.width);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale);
    c.height = Math.round(img.height * scale);
    const ctx = c.getContext('2d');
    ctx.drawImage(img, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height);
    const p = d.data;
    const W = c.width;
    const H = c.height;
    const dark = (i) => p[i + 3] > 0 && p[i] < 110 && p[i + 1] < 110 && p[i + 2] < 110;

    // Líneas horizontales/verticales largas y oscuras (bordes de la captura)
    const rowRun = (y) => {
      let best = 0;
      let cur = 0;
      for (let x = 0; x < W; x++) {
        cur = dark((y * W + x) * 4) ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return best;
    };
    const colRun = (x) => {
      let best = 0;
      let cur = 0;
      for (let y = 0; y < H; y++) {
        cur = dark((y * W + x) * 4) ? cur + 1 : 0;
        best = Math.max(best, cur);
      }
      return best;
    };
    const kill = [];
    for (let y = 0; y < H; y++) if (rowRun(y) > W * 0.3) for (let x = 0; x < W; x++) kill.push((y * W + x) * 4);
    for (let x = 0; x < W; x++) if (colRun(x) > H * 0.5) for (let y = 0; y < H; y++) kill.push((y * W + x) * 4);
    for (const i of kill) if (dark(i)) p[i + 3] = 0;

    // Fondo blanco -> transparente (con borde suave)
    for (let i = 0; i < p.length; i += 4) {
      const lum = (p[i] + p[i + 1] + p[i + 2]) / 3;
      if (lum > 235) p[i + 3] = 0;
      else if (lum > 200) p[i + 3] = Math.round(p[i + 3] * ((235 - lum) / 35));
    }
    ctx.putImageData(d, 0, 0);

    // Recorta los márgenes vacíos
    let minX = W, minY = H, maxX = 0, maxY = 0;
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (p[(y * W + x) * 4 + 3] > 20) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
    if (maxX <= minX || maxY <= minY) return c.toDataURL('image/png');
    const out = document.createElement('canvas');
    out.width = maxX - minX + 1;
    out.height = maxY - minY + 1;
    out.getContext('2d').drawImage(c, minX, minY, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  }

  window.InvoicePdf = { build: buildInvoicePdf, toBase64, cleanStamp };
})();
