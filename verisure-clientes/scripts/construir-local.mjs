#!/usr/bin/env node
/**
 * Genera buscador-local.html a partir de local/plantilla.html, copiando dentro
 * la lógica de búsqueda de public/comun.js.
 *
 *   npm run construir
 *
 * El buscador local tiene que ser un único archivo que funcione con un doble
 * clic: un navegador abierto con file:// no puede cargar módulos de al lado.
 * De ahí que el código compartido se copie dentro en vez de importarse.
 *
 * NO editar buscador-local.html a mano: se regenera y se perderían los
 * cambios. La lógica de búsqueda va en public/comun.js y el resto (interfaz,
 * lectura del CSV, índice en memoria) en local/plantilla.html.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const MARCADOR = '      /* @@COMUN@@ */';
const MARCADOR_CSS = '      /* @@ESTILOS@@ */';

const comun = readFileSync(join(raiz, 'public/comun.js'), 'utf8');
const estilos = readFileSync(join(raiz, 'public/resultados.css'), 'utf8');
const plantilla = readFileSync(join(raiz, 'local/plantilla.html'), 'utf8');

for (const marca of [MARCADOR, MARCADOR_CSS]) {
  if (!plantilla.includes(marca)) {
    console.error(`local/plantilla.html no tiene la marca ${marca.trim()}`);
    process.exit(1);
  }
}

// Dentro del HTML es un script normal, no un módulo: fuera los "export".
const incrustado = comun.replace(/^export /gm, '');

const sangrar = (texto) =>
  texto.split('\n').map((l) => (l.trim() === '' ? '' : '      ' + l)).join('\n');

const salida = plantilla
  .replace(MARCADOR, sangrar(incrustado))
  .replace(MARCADOR_CSS, sangrar(estilos));

if (/\bexport\b|\bimport\b/.test(salida.slice(salida.indexOf('<script>')))) {
  console.error('Ha quedado algún import/export en el archivo generado.');
  process.exit(1);
}

writeFileSync(join(raiz, 'buscador-local.html'), salida);
const kb = (Buffer.byteLength(salida) / 1024).toFixed(0);
console.log(`buscador-local.html generado (${kb} KB, ${salida.split('\n').length} líneas)`);
