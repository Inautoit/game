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

/* ══════════════════════════════════════════════════════════════
   Estado de reconexión
   ══════════════════════════════════════════════════════════════ */

/**
 * Lee un importe que viene como texto. Acepta las dos convenciones que salen
 * de un Excel según cómo esté configurado: "1.234,56" y "1,234.56".
 *
 * Un valor vacío cuenta como 0, igual que hace Power BI con una celda en
 * blanco. Si no se puede leer devuelve NaN, y entonces ninguna comparación se
 * cumple: el registro acaba en "NO RECONECTABLE", que es la salida por defecto
 * de la fórmula original y la más prudente.
 */
export function aNumero(valor) {
  let t = String(valor ?? '').trim().replace(/[€$\s]/g, '');
  if (t === '') return 0;

  const coma = t.includes(',');
  const punto = t.includes('.');
  if (coma && punto) {
    // El último separador que aparece es el decimal.
    t = t.lastIndexOf(',') > t.lastIndexOf('.')
      ? t.replace(/\./g, '').replace(',', '.')
      : t.replace(/,/g, '');
  } else if (coma) {
    // "1,234" son mil doscientos treinta y cuatro; "12,50" son doce con medio.
    t = /^-?\d{1,3}(,\d{3})+$/.test(t) ? t.replace(/,/g, '') : t.replace(',', '.');
  } else if (punto) {
    if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  }

  const n = Number(t);
  return Number.isFinite(n) ? n : NaN;
}

/** Columnas que necesita el estado, buscadas sin distinguir mayúsculas ni signos. */
const COLUMNAS_ESTADO = { balance: 'balancetxt', writeoff: 'writeofftxt', npv: 'npv' };

/**
 * Localiza en la cabecera del CSV las columnas del estado. Devuelve null si el
 * fichero no las trae, y entonces no se enseña ningún estado en vez de
 * inventarse uno.
 */
export function columnasEstado(columnas) {
  const encontradas = {};
  for (const [clave, buscada] of Object.entries(COLUMNAS_ESTADO)) {
    const columna = columnas.find((c) => colapsar(c) === buscada);
    if (columna === undefined) return null;
    encontradas[clave] = columna;
  }
  return encontradas;
}

export const ESTADOS = {
  RECONECTABLE: { texto: 'RECONECTABLE', emoji: '✅', clase: 'ok' },
  LLAMAR: { texto: 'LLAMA A SALES ASSURANCE', emoji: '📞', clase: 'avisar' },
  NO_RECONECTABLE: { texto: 'NO RECONECTABLE', emoji: '❌', clase: 'no' },
};

/**
 * Estado de reconexión de un registro. Traduce las medidas de Power BI
 * (Estado_Reconectable, Estado_Llamar, Estado_NoReconectable y el SWITCH que
 * las ordena) a las tres reglas que quedan al resolverlas, en este orden:
 *
 *   1. balance <= 149 y writeoff <= 149 y npv = "NO NPV"  ->  RECONECTABLE
 *   2. balance <= 149 y npv = "NPV"                       ->  LLAMA A SALES ASSURANCE
 *   3. cualquier otro caso                                ->  NO RECONECTABLE
 *
 * La tercera recoge también lo que el SWITCH dejaba caer en su valor por
 * defecto: por ejemplo balance <= 149 con writeoff > 149, o un npv que no sea
 * ni "NPV" ni "NO NPV".
 *
 * `datos` es {columna: valor} y `cols` lo que devuelve columnasEstado().
 */
export function calcularEstado(datos, cols) {
  if (!cols) return null;

  const balance = aNumero(datos[cols.balance]);
  const writeoff = aNumero(datos[cols.writeoff]);
  const npv = colapsar(datos[cols.npv]);

  const clave =
    balance <= 149 && writeoff <= 149 && npv === 'nonpv' ? 'RECONECTABLE'
    : balance <= 149 && npv === 'npv' ? 'LLAMAR'
    : 'NO_RECONECTABLE';

  return {
    clave,
    ...ESTADOS[clave],
    // Lo que ha decidido el resultado, para poder enseñarlo y comprobarlo.
    motivo: {
      [cols.balance]: datos[cols.balance] ?? '',
      [cols.writeoff]: datos[cols.writeoff] ?? '',
      [cols.npv]: datos[cols.npv] ?? '',
    },
  };
}

/**
 * Columnas que se enseñan en la lista de resultados para poder distinguir un
 * registro de otro sin abrirlo: identificadores y datos de contacto, en ese
 * orden de preferencia y sin repetir.
 */
const PREFERENCIAS = [
  /^(s#ins|ins_no|instalacion|n.?\s*instalac)/i,
  /instalac/i,
  /nombre|titular|cliente|razon/i,
  /^(cifnif|dni|nif|cif|documento)$/i,
  /dni|nif|cif/i,
  /phone|telef|movil|tlf/i,
  /direccion|domicilio|calle/i,
  /city|poblacion|localidad|municipio/i,
];

export function camposDestacados(columnas, maximo = 5) {
  const elegidas = [];
  for (const patron of PREFERENCIAS) {
    for (const columna of columnas) {
      if (elegidas.length >= maximo) return elegidas;
      if (!elegidas.includes(columna) && patron.test(columna)) elegidas.push(columna);
    }
  }
  // Si el CSV no trae nada reconocible, las primeras columnas sirven igual.
  for (const columna of columnas) {
    if (elegidas.length >= maximo) break;
    if (!elegidas.includes(columna)) elegidas.push(columna);
  }
  return elegidas;
}

/* ══════════════════════════════════════════════════════════════
   Tarjeta de un registro en la lista de resultados
   ══════════════════════════════════════════════════════════════ */

/**
 * Construye la tarjeta de un resultado: una fila compacta con los datos que
 * sirven para distinguirlo y su estado, que al pulsarla despliega el registro
 * entero.
 *
 * Devuelve un elemento del DOM, así que sólo la llaman las interfaces; el
 * Worker importa de este archivo únicamente las funciones de texto.
 */
export function crearTarjeta({ datos, columnas, consulta, colsEstado, etiqueta, abierta }) {
  const estado = calcularEstado(datos, colsEstado);

  const tarjeta = document.createElement('article');
  tarjeta.className = 'registro';

  /* ── fila compacta ── */
  const resumen = document.createElement('button');
  resumen.type = 'button';
  resumen.className = 'registro__resumen';
  resumen.setAttribute('aria-expanded', abierta ? 'true' : 'false');

  const destacados = document.createElement('div');
  destacados.className = 'destacados';
  for (const columna of camposDestacados(columnas)) {
    const valor = datos[columna];
    if (valor === undefined || valor === '') continue;
    const dato = document.createElement('div');
    dato.className = 'destacado';
    dato.innerHTML = `<em>${escapar(columna)}</em><b>${resaltar(valor, consulta)}</b>`;
    destacados.append(dato);
  }
  resumen.append(destacados);

  if (estado) {
    const insignia = document.createElement('span');
    insignia.className = `estado estado--${estado.clase}`;
    insignia.textContent = `${estado.texto} ${estado.emoji}`;
    resumen.append(insignia);
  }

  const flecha = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  flecha.setAttribute('class', 'flecha');
  flecha.setAttribute('viewBox', '0 0 24 24');
  flecha.innerHTML = '<polyline points="6 9 12 15 18 9" />';
  resumen.append(flecha);

  /* ── detalle ── */
  const detalle = document.createElement('div');
  detalle.className = 'registro__detalle';
  detalle.hidden = !abierta;

  if (estado) {
    const motivo = document.createElement('div');
    motivo.className = 'motivo';
    const campos = Object.entries(estado.motivo)
      .map(([c, v]) => `<span>${escapar(c)}: <b>${escapar(v === '' ? '(vacío)' : v)}</b></span>`)
      .join('');
    motivo.innerHTML =
      `<span class="estado estado--${estado.clase} estado--grande">${estado.texto} ${estado.emoji}</span>` +
      `<span class="motivo__campos">${campos}</span>`;
    detalle.append(motivo);
  }

  const rejilla = document.createElement('div');
  rejilla.className = 'campos';
  for (const columna of columnas) {
    const valor = datos[columna];
    if (valor === undefined || valor === '') continue;
    const dato = document.createElement('div');
    dato.innerHTML =
      `<span class="dato__clave">${escapar(columna)}</span>` +
      `<span class="dato__valor">${resaltar(valor, consulta)}</span>`;
    rejilla.append(dato);
  }
  detalle.append(rejilla);

  if (etiqueta) {
    const pie = document.createElement('p');
    pie.className = 'apagado';
    pie.style.margin = '.9rem 0 0';
    pie.textContent = etiqueta;
    detalle.append(pie);
  }

  resumen.addEventListener('click', () => {
    const abriendo = detalle.hidden;
    detalle.hidden = !abriendo;
    tarjeta.classList.toggle('registro--abierto', abriendo);
    resumen.setAttribute('aria-expanded', abriendo ? 'true' : 'false');
  });

  if (abierta) tarjeta.classList.add('registro--abierto');
  tarjeta.append(resumen, detalle);
  return tarjeta;
}
