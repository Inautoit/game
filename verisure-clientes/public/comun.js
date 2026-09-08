/**
 * Lógica de búsqueda compartida por los tres sitios donde hace falta:
 *
 *   src/index.js          el Worker de la versión web
 *   public/app.js         la interfaz de la versión web
 *   buscador-local.html   el buscador local (se copia dentro al construirlo)
 *
 * Está aquí para que no pueda haber dos versiones distintas de lo que
 * significa "buscar": si se cambia cómo se normaliza un teléfono o cómo se
 * interpretan dos palabras sueltas, cambia en todas partes a la vez.
 *
 * No importa nada de fuera a propósito: así se puede copiar tal cual dentro
 * del archivo local, que tiene que funcionar con un doble clic.
 */

const ACENTOS = [
  [/[áàäâãå]/g, 'a'], [/[éèëê]/g, 'e'], [/[íìïî]/g, 'i'],
  [/[óòöôõ]/g, 'o'], [/[úùüû]/g, 'u'], [/ñ/g, 'n'], [/ç/g, 'c'],
];

/**
 * Quita acentos, mayúsculas y todo lo que no sea letra o número, respetando
 * los tabuladores (separan campos) y los saltos de línea (separan registros).
 */
export function normalizar(texto) {
  let t = String(texto).toLowerCase();
  for (const [re, letra] of ACENTOS) t = t.replace(re, letra);
  return t.replace(/[^a-z0-9\t\n]/g, '');
}

/** "Juan Pérez" => "juanperez" · "+34 600-123-456" => "34600123456" */
export function colapsar(valor) {
  if (valor === null || valor === undefined) return '';
  return normalizar(valor).replace(/[\t\n]/g, '');
}

/** Palabras sueltas de una consulta, ya normalizadas y sin repetidas. */
export function palabras(valor) {
  if (valor === null || valor === undefined) return [];
  let t = String(valor).toLowerCase();
  for (const [re, letra] of ACENTOS) t = t.replace(re, letra);
  t = t.replace(/[^a-z0-9]+/g, ' ').trim();
  return t ? [...new Set(t.split(' ').filter(Boolean))] : [];
}

/** Separa una línea de CSV en campos, respetando las comillas dobles. */
export function separarCampos(linea) {
  if (linea.indexOf('"') === -1) return linea.split(',');
  const campos = [];
  let celda = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c === '"') {
        if (linea[i + 1] === '"') { celda += '"'; i++; } else comillas = false;
      } else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { campos.push(celda); celda = ''; }
    else celda += c;
  }
  campos.push(celda);
  return campos;
}

/** Escapa los comodines de LIKE para que se busquen de forma literal. */
export function escaparLike(valor) {
  return valor.replace(/[\\%_]/g, (c) => '\\' + c);
}

/**
 * Traduce lo que ha escrito el usuario a un criterio de búsqueda:
 *
 *   agujas      variantes de la consulta completa; basta que encaje una
 *   tokens      palabras sueltas
 *   usarTokens  si además vale con que estén todas las palabras, en cualquier
 *               orden ("perez maria" encuentra "María Pérez")
 *
 * Devuelve null si no hay nada que buscar.
 */
export function criterioBusqueda(consulta) {
  const colapsada = colapsar(consulta);
  const tokens = palabras(consulta);
  if (!colapsada && tokens.length === 0) return null;

  const soloDigitos = colapsada !== '' && /^[0-9]+$/.test(colapsada);

  const agujas = [];
  if (colapsada) {
    agujas.push(colapsada);
    // Un número con prefijo internacional debe encontrar al que no lo lleva.
    if (soloDigitos) {
      if (/^0034[0-9]{9,}$/.test(colapsada)) agujas.push(colapsada.slice(4));
      else if (/^34[0-9]{9,}$/.test(colapsada)) agujas.push(colapsada.slice(2));
    }
  }

  // Buscar las palabras por separado sólo tiene sentido con texto: un número
  // escrito con espacios o guiones, "638 147 794", es un único dato y no tres
  // fragmentos sueltos.
  const usarTokens = tokens.length > 1 && !soloDigitos;

  if (agujas.length === 0 && !usarTokens) return null;
  return { agujas, tokens, usarTokens };
}

/** Escapa HTML. */
export function escapar(texto) {
  return String(texto).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Devuelve el valor en HTML con las coincidencias envueltas en <mark>.
 * Compara sin acentos ni signos, pero resalta sobre el texto original.
 */
export function resaltar(valor, consulta) {
  const texto = String(valor ?? '');
  if (!texto || !consulta) return escapar(texto);

  // Mapa: posición en el texto normalizado -> posición en el original.
  let normalizado = '';
  const mapa = [];
  for (let i = 0; i < texto.length; i++) {
    const trozo = colapsar(texto[i]);
    for (let k = 0; k < trozo.length; k++) mapa.push(i);
    normalizado += trozo;
  }
  if (!normalizado) return escapar(texto);

  const agujas = [colapsar(consulta), ...palabras(consulta)]
    .filter((a, i, arr) => a && arr.indexOf(a) === i);

  const marcado = new Array(texto.length).fill(false);
  for (const aguja of agujas) {
    let desde = 0;
    for (;;) {
      const pos = normalizado.indexOf(aguja, desde);
      if (pos === -1) break;
      for (let k = pos; k < pos + aguja.length; k++) marcado[mapa[k]] = true;
      desde = pos + 1;
    }
  }

  let html = '';
  let dentro = false;
  for (let i = 0; i < texto.length; i++) {
    if (marcado[i] && !dentro) { html += '<mark>'; dentro = true; }
    else if (!marcado[i] && dentro) { html += '</mark>'; dentro = false; }
    html += escapar(texto[i]);
  }
  return dentro ? html + '</mark>' : html;
}
