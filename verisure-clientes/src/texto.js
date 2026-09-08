/**
 * Normalización de texto para búsquedas.
 *
 * Se guardan dos formas de cada registro:
 *  - "colapsada": sin acentos, sin espacios ni signos → "600 123 456" => "600123456"
 *  - "tokenizada": sin acentos, signos convertidos en espacios → "juan perez"
 *
 * Así una búsqueda por teléfono funciona escríbalo como se escriba, y una
 * búsqueda por nombre funciona aunque se escriban las palabras en otro orden.
 */

const ACENTOS = /[\u0300-\u036f]/g;

function sinAcentos(valor) {
  return String(valor).normalize('NFD').replace(ACENTOS, '');
}

/** "Juan Pérez" => "juanperez" ; "+34 600-123-456" => "34600123456" */
export function colapsar(valor) {
  if (valor === null || valor === undefined) return '';
  return sinAcentos(valor).toLowerCase().replace(/[^a-z0-9]/g, '');
}

/** "Juan Pérez (Madrid)" => "juan perez madrid" */
export function tokenizar(valor) {
  if (valor === null || valor === undefined) return '';
  return sinAcentos(valor)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Palabras sueltas de una consulta, sin duplicados. */
export function palabras(valor) {
  const texto = tokenizar(valor);
  if (!texto) return [];
  return [...new Set(texto.split(' ').filter(Boolean))];
}

/** Escapa los comodines de LIKE para que se busquen de forma literal. */
export function escaparLike(valor) {
  return valor.replace(/[\\%_]/g, (c) => '\\' + c);
}
