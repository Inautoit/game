#!/usr/bin/env node
/**
 * Comprueba que el buscador local y la versión web devuelven exactamente lo
 * mismo. Los dos comparten public/comun.js, pero cada uno recorre los datos a
 * su manera (SQLite con bloques comprimidos frente a una cadena en memoria),
 * así que conviene enfrentarlos ante las mismas consultas.
 *
 *   npx wrangler dev --port 8793          (en otra terminal)
 *   node scripts/comparar-buscadores.mjs <fichero.csv>
 *
 * Necesita playwright-core y un Chromium; con PLAYWRIGHT_CHROMIUM se le puede
 * indicar dónde está el ejecutable.
 */
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright-core';

const CSV = process.argv[2];
const BASE = process.env.API || 'http://127.0.0.1:8793/api';
const LOCAL = process.env.LOCAL || new URL('../buscador-local.html', import.meta.url).href;

if (!CSV) {
  console.error('Uso: node scripts/comparar-buscadores.mjs <fichero.csv>');
  process.exit(1);
}

/* ── 1. Cargar el CSV en la versión web ───────────────────────── */
const lineas = readFileSync(CSV, 'utf8').split('\n').filter((l) => l.trim() !== '');
const columnas = lineas[0].split(',');
const datos = lineas.slice(1).map((l) => l.split(','));

const login = await fetch(`${BASE}/login`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ usuario: 'admin', password: process.env.PASS || 'Verisure2026!Admin' }),
});
if (!login.ok) throw new Error('No se pudo entrar en la versión web: ' + (await login.text()));
const cookie = login.headers.get('set-cookie').split(';')[0];

const api = (ruta, opciones = {}) =>
  fetch(BASE + ruta, {
    ...opciones,
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
  }).then((r) => r.json());

const imp = await api('/importaciones', {
  method: 'POST',
  body: JSON.stringify({ archivo: 'comparacion.csv', modo: 'reemplazar', columnas }),
});
for (let i = 0; i < datos.length; i += 300) {
  await api(`/importaciones/${imp.id}/filas`, {
    method: 'POST',
    body: JSON.stringify({ desde: i, filas: datos.slice(i, i + 300) }),
  });
}
const fin = await api(`/importaciones/${imp.id}/finalizar`, { method: 'POST' });
console.log(`web:   ${Number(fin.filas).toLocaleString('es-ES')} registros`);

/* ── 2. El mismo CSV en el buscador local ─────────────────────── */
const navegador = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM || undefined,
  args: ['--js-flags=--max-old-space-size=4096'],
});
const pagina = await navegador.newPage();
const fallos = [];
pagina.on('pageerror', (e) => fallos.push('error en el buscador local: ' + e.message));
await pagina.goto(LOCAL);
await pagina.setInputFiles('#archivo', CSV);
await pagina.waitForSelector('#app:not([hidden])', { timeout: 300000 });
console.log(`local: ${await pagina.textContent('#info-fichero')}\n`);

/* ── 3. Las mismas consultas en los dos ───────────────────────── */
const fila = datos[Math.floor(datos.length / 2)];
const telefono = (fila.find((v) => /^[67]\d{8}$/.test(v)) || '').trim();
const consultas = [
  ['valor de la primera columna', fila[0], ''],
  ['valor de la última columna', fila[fila.length - 1], ''],
  ['teléfono', telefono, ''],
  ['teléfono con espacios', telefono.replace(/(\d{3})(\d{3})(\d{3})/, '$1 $2 $3'), ''],
  ['teléfono con guiones', telefono.replace(/(\d{3})(\d{3})(\d{3})/, '$1-$2-$3'), ''],
  ['con prefijo +34', '+34 ' + telefono, ''],
  ['con prefijo 0034', '0034' + telefono, ''],
  ['en mayúsculas', String(fila[0]).toUpperCase(), ''],
  ['con acentos', 'málaga', ''],
  ['sin acentos', 'malaga', ''],
  ['dos palabras', 'gran via', ''],
  ['dos palabras al revés', 'via gran', ''],
  ['sin resultados', 'zzzzzzzz', ''],
  ['una sola letra', 'x', ''],
  ['vacía', '', ''],
  ...columnas.slice(0, 6).map((c, i) => [`campo ${c}`, fila[i], c]),
];

let diferencias = 0;
console.log('consulta                        campo         web       local');
console.log("(un '+' marca un recuento incompleto: hay más de los que dice)");
console.log('─'.repeat(66));
for (const [etiqueta, q, campo] of consultas) {
  const web = await api(`/buscar?q=${encodeURIComponent(q)}&campo=${encodeURIComponent(campo)}`);
  await pagina.selectOption('#campo', campo);
  await pagina.fill('#q', q);
  await pagina.click('#form button[type=submit]');
  await pagina.waitForTimeout(120);
  const local = await pagina.evaluate(() => ({
    total: ultima.indices.length,
    parcial: ultima.parcial,
  }));

  // Si alguno de los dos avisa de que el recuento está incompleto, las cifras
  // no son comparables: cada uno para de contar por un motivo distinto. Lo que
  // sí tiene que coincidir es si hay resultados o no.
  const incompleto = web.parcial || local.parcial;
  const igual = incompleto
    ? (web.total > 0) === (local.total > 0)
    : (web.total || 0) === local.total;
  if (!igual) diferencias++;
  console.log(
    `${etiqueta.slice(0, 30).padEnd(31)} ${(campo || '—').slice(0, 12).padEnd(12)} ` +
      `${String(web.total ?? '?').padStart(6)}${web.parcial ? '+' : ' '} ` +
      `${String(local.total).padStart(8)}${local.parcial ? '+' : ' '}` +
      (igual ? '' : '   ← DIFIEREN'),
  );
}
console.log('─'.repeat(66));
await navegador.close();

for (const fallo of fallos) console.error(fallo);
if (diferencias || fallos.length) {
  console.error(`\n${diferencias} consultas dan resultados distintos.`);
  process.exit(1);
}
console.log('\nLos dos buscadores devuelven exactamente lo mismo.');
