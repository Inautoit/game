/* Dictado por voz del presupuesto rápido.
 *
 * Cómo se habla (palabras clave, en cualquier orden, todo seguido o por partes):
 *   "Cliente Juan García. Teléfono 611 22 33 44. Dirección calle Mayor 5.
 *    Concepto cambiar enchufe de la cocina 35 euros.
 *    Concepto 2 puntos de luz a 28 euros.
 *    Concepto 3 horas de mano de obra a 25 euros.
 *    IVA 10. Nota material incluido."
 */
(function (root) {
  'use strict';

  // ------------------------------------------------------------ Números en letra
  const UNITS = {
    cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
    diez: 10, once: 11, doce: 12, trece: 13, catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17,
    dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintiuna: 21, veintidos: 22,
    veintitres: 23, veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29,
  };
  const TENS = { treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60, setenta: 70, ochenta: 80, noventa: 90 };
  const HUNDREDS = {
    cien: 100, ciento: 100, doscientos: 200, doscientas: 200, trescientos: 300, trescientas: 300, cuatrocientos: 400,
    cuatrocientas: 400, quinientos: 500, quinientas: 500, seiscientos: 600, seiscientas: 600, setecientos: 700,
    setecientas: 700, ochocientos: 800, ochocientas: 800, novecientos: 900, novecientas: 900,
  };
  const deaccent = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

  // Convierte "treinta y cinco" -> "35", "mil doscientos" -> "1200". `keepUn` deja "un/una" como palabra.
  function wordsToDigits(text, keepUn = false) {
    const tokens = text.split(/(\s+)/);
    const out = [];
    let acc = null; // número en construcción
    let pendingSpace = '';
    const flush = () => {
      if (acc !== null) {
        out.push(String(acc));
        acc = null;
      }
    };
    for (let i = 0; i < tokens.length; i++) {
      const tok = tokens[i];
      if (/^\s+$/.test(tok)) {
        pendingSpace = tok;
        continue;
      }
      const w = deaccent(tok.toLowerCase()).replace(/[.,;:]$/, '');
      const punct = /[.,;:]$/.test(tok) ? tok.slice(-1) : '';
      let val = null;
      if (keepUn && (w === 'un' || w === 'una')) val = null;
      else if (w in UNITS) val = { v: UNITS[w], k: 'u' };
      else if (w in TENS) val = { v: TENS[w], k: 't' };
      else if (w in HUNDREDS) val = { v: HUNDREDS[w], k: 'h' };
      else if (w === 'mil') val = { v: 1000, k: 'm' };

      // "treinta y cinco": la "y" une decenas y unidades
      if (w === 'y' && acc !== null && acc % 10 === 0 && acc % 100 !== 0) {
        const next = deaccent((tokens[i + 2] || '').toLowerCase()).replace(/[.,;:]$/, '');
        if (next in UNITS && UNITS[next] < 10) continue;
      }
      if (val) {
        if (acc === null) {
          if (out.length) out.push(pendingSpace);
          acc = val.k === 'm' ? 1000 : val.v;
        } else if (val.k === 'm') acc = (acc || 1) * 1000;
        else if (val.k === 'h' && acc % 1000 === 0) acc += val.v;
        else if (val.k === 't' && acc % 100 === 0) acc += val.v;
        else if (val.k === 'u' && (acc % 10 === 0 || acc % 100 === 0) && val.v < (acc % 100 === 0 ? 100 : 10)) acc += val.v;
        else {
          flush();
          out.push(pendingSpace);
          acc = val.v;
        }
        pendingSpace = '';
        if (punct) {
          flush();
          out.push(punct);
        }
        continue;
      }
      flush();
      if (out.length) out.push(pendingSpace);
      pendingSpace = '';
      out.push(tok);
    }
    flush();
    return out.join('');
  }

  // ------------------------------------------------------------ Utilidades
  const NUM = String.raw`\d+(?:[.,]\d+)?`;
  // "1.200" = mil doscientos; "1,5" o "1.5" = uno y medio
  const toNum = (s) => {
    s = String(s);
    if (/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) s = s.replace(/\./g, '');
    return Number(s.replace(',', '.'));
  };
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const titleCase = (s) =>
    s
      .toLowerCase()
      .split(/\s+/)
      .map((w, i) => (i > 0 && /^(de|del|la|las|los|el|y|e)$/.test(w) ? w : cap(w)))
      .join(' ');
  const tidy = (s) => s.replace(/\s+/g, ' ').replace(/^[\s,.;:]+|[\s,.;:]+$/g, '').trim();

  function normalize(text) {
    let t = ' ' + String(text || '') + ' ';
    t = t.replace(/€/g, ' euros ');
    t = t.replace(/(\d)\s*euros?\s+con\s+(\d{1,2})\b(\s*c[ée]ntimos)?/gi, '$1,$2 euros');
    t = t.replace(/(\d)\s+con\s+(\d{1,2})\b(\s*c[ée]ntimos)?/gi, '$1,$2');
    return t.replace(/\s+/g, ' ').trim();
  }

  // ------------------------------------------------------------ Palabras clave
  const KEYS = [
    { re: /\bcliente\b/, k: 'cliente' },
    { re: /\b(tel[eé]fono|m[oó]vil|tfno)\b/, k: 'telefono' },
    { re: /\b(direcci[oó]n|obra en|domicilio)\b/, k: 'direccion' },
    { re: /\b(calle|avenida|plaza|paseo|camino|carretera)\b/, k: 'calle' },
    { re: /\b(concepto|partida|a[nñ]ade|a[nñ]adir|otro concepto|siguiente)\b/, k: 'concepto' },
    { re: /\bdescuento\b/, k: 'descuento' },
    { re: /\bsin iva\b/, k: 'siniva' },
    { re: /\biva\b/, k: 'iva' },
    { re: /\b(nota|notas|observaci[oó]n|observaciones)\b/, k: 'nota' },
  ];

  function segments(text) {
    const low = text.toLowerCase();
    const marks = [];
    for (const { re, k } of KEYS) {
      const g = new RegExp(re.source, 'gi');
      let m;
      while ((m = g.exec(low))) marks.push({ i: m.index, end: m.index + m[0].length, k, word: m[0] });
    }
    marks.sort((a, b) => a.i - b.i || b.end - a.end);
    // quita solapados ("otro concepto" / "concepto", "sin iva" / "iva")
    const clean = [];
    for (const m of marks) if (!clean.length || m.i >= clean[clean.length - 1].end) clean.push(m);
    // "calle" justo después de "dirección" forma parte de la dirección
    const out = [];
    for (let j = 0; j < clean.length; j++) {
      const m = clean[j];
      if (m.k === 'calle') {
        const prev = out[out.length - 1];
        if (prev && prev.k === 'direccion' && low.slice(prev.end, m.i).trim() === '') continue;
        if (prev && prev.k !== 'direccion' && prev.k !== 'cliente' && prev.k !== 'telefono' && prev.k !== 'calle') {
          // "calle" dentro de un concepto o nota: no es una marca
          continue;
        }
      }
      out.push(m);
    }
    const segs = [];
    if (!out.length || out[0].i > 0) {
      const head = text.slice(0, out.length ? out[0].i : text.length);
      if (tidy(head)) segs.push({ k: 'libre', v: head });
    }
    out.forEach((m, j) => {
      const v = text.slice(m.k === 'calle' ? m.i : m.end, j + 1 < out.length ? out[j + 1].i : text.length);
      segs.push({ k: m.k === 'calle' ? 'direccion' : m.k, v });
    });
    return segs;
  }

  // ------------------------------------------------------------ Conceptos
  const FILLERS = /\b(cada uno|cada una|la unidad|por unidad|la hora|por hora|el metro|por metro|cada hora|cada metro|la pieza|m[aá]s iva)\b/gi;

  function parseLine(raw) {
    let t = ' ' + normalize(wordsToDigits(raw)) + ' ';
    t = t.replace(FILLERS, ' ');
    const enTotal = /\b(en total|total)\b/i.test(t);
    t = t.replace(/\b(en total|total)\b/gi, ' ');
    let cantidad = 1;
    let precio = null;

    // "2 por 28 euros" / "2 x 28"
    let m = t.match(new RegExp(String.raw`(${NUM})\s*(?:unidades?|uds?\.?)?\s*(?:por|x)\s*(${NUM})\s*(?:euros?|eur)?`, 'i'));
    if (m) {
      cantidad = toNum(m[1]);
      precio = toNum(m[2]);
      t = t.replace(m[0], ' ');
    } else {
      // "... a 28 euros" / "... a 28"
      const all = [...t.matchAll(new RegExp(String.raw`\ba\s+(${NUM})\s*(?:euros?|eur)?`, 'gi'))];
      if (all.length) {
        m = all[all.length - 1];
        precio = toNum(m[1]);
        t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
      } else {
        // último número seguido de "euros", o el último número de la frase
        const eu = [...t.matchAll(new RegExp(String.raw`(${NUM})\s*(?:euros?|eur)\b`, 'gi'))];
        const nums = [...t.matchAll(new RegExp(String.raw`(${NUM})`, 'g'))];
        m = eu.length ? eu[eu.length - 1] : nums.length ? nums[nums.length - 1] : null;
        if (m) {
          precio = toNum(m[1]);
          t = t.slice(0, m.index) + ' ' + t.slice(m.index + m[0].length);
        }
      }
      // cantidad al principio: "3 horas de mano de obra", "2 puntos de luz"
      const q = t.match(new RegExp(String.raw`^\s*(${NUM})\s+`));
      if (q && precio !== null) {
        cantidad = toNum(q[1]);
        t = t.slice(q[0].length);
      }
    }
    if (enTotal && precio !== null && cantidad > 0) precio = Math.round((precio / cantidad) * 100) / 100;
    const descripcion = cap(tidy(t.replace(/\b(euros?|eur)\b/gi, ' ').replace(/\s+(de|a|por|con|y)\s*$/i, '')));
    return { descripcion, cantidad: cantidad || 1, precio: precio === null ? '' : precio };
  }

  // ------------------------------------------------------------ Análisis completo
  function parse(input) {
    const text = normalize(input);
    const out = { lines: [] };
    for (const seg of segments(text)) {
      const v = tidy(seg.v);
      switch (seg.k) {
        case 'cliente':
          if (v) out.cliente = titleCase(v.replace(/^(es|se llama|:)\s+/i, ''));
          break;
        case 'telefono': {
          // Teléfono: cada palabra es su número ("seis cero cero" = 600, "sesenta y dos" = 62)
          const d = v
            .split(/\s+/)
            .map((w) => {
              const k = deaccent(w.toLowerCase()).replace(/[.,;:]$/, '');
              return k in UNITS ? UNITS[k] : k in TENS ? TENS[k] : k === 'y' ? '' : w;
            })
            .join(' ')
            .replace(/\b([2-9])0\s+([1-9])\b/g, '$1$2') // "treinta y tres" -> 33
            .replace(/\D/g, '');
          if (d) out.telefono = d.replace(/^(\d{3})(\d{2})(\d{2})(\d{2})$/, '$1 $2 $3 $4');
          break;
        }
        case 'direccion': {
          const dv = tidy(wordsToDigits(v, true).replace(/^(es|en)\s+/i, ''));
          if (dv) out.direccion = cap(dv.replace(/\b(numero|número|nº)\s*/gi, ''));
          break;
        }
        case 'siniva':
          out.iva = 0;
          break;
        case 'iva': {
          const n = wordsToDigits(v).match(/\d+/);
          if (n) out.iva = Number(n[0]);
          break;
        }
        case 'descuento': {
          // "descuento 10 por ciento" / "10%" / "de 20 euros"
          const dv = wordsToDigits(v).replace(/%/g, ' por ciento');
          const m = dv.match(new RegExp(String.raw`(${NUM})\s*(por ciento|porciento|euros?|eur)?`, 'i'));
          if (m) out.descuento = { valor: toNum(m[1]), tipo: /euro|eur/i.test(m[2] || '') ? 'eur' : 'pct' };
          break;
        }
        case 'nota':
          if (v) out.nota = cap(v);
          break;
        case 'concepto':
          if (v) out.lines.push(parseLine(v));
          break;
        default: {
          // Texto sin palabra clave: si lleva precio, se toma como concepto(s)
          for (const piece of v.split(/[.;]|\by luego\b|\by también\b/i)) {
            if (/\d|\b(euros?)\b/i.test(wordsToDigits(piece)) && tidy(piece)) out.lines.push(parseLine(piece));
          }
        }
      }
    }
    out.lines = out.lines.filter((l) => l.descripcion || l.precio !== '');
    return out;
  }

  // ------------------------------------------------------------ Micrófono
  function supported() {
    return !!(root.SpeechRecognition || root.webkitSpeechRecognition);
  }

  // Escucha hasta que se llama a stop(). onText(textoFinal, textoProvisional)
  function listen(onText, onEnd) {
    const SR = root.SpeechRecognition || root.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = 'es-ES';
    rec.continuous = true;
    rec.interimResults = true;
    let finalText = '';
    let stopped = false;
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += (finalText ? ' ' : '') + r[0].transcript.trim();
        else interim += r[0].transcript;
      }
      onText(finalText, interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        stopped = true;
        onEnd(finalText, 'Permite el uso del micrófono para dictar.');
      }
    };
    // Algunos móviles cortan tras un silencio: se vuelve a escuchar hasta pulsar "Terminar"
    rec.onend = () => {
      if (stopped) return onEnd(finalText);
      try {
        rec.start();
      } catch {
        onEnd(finalText);
      }
    };
    rec.start();
    return {
      stop() {
        stopped = true;
        try {
          rec.stop();
        } catch {
          onEnd(finalText);
        }
      },
    };
  }

  const api = { parse, parseLine, wordsToDigits, supported, listen };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.VoiceQuote = api;
})(typeof window !== 'undefined' ? window : globalThis);
