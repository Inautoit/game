export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Mediana recortada: descarta el `trim` superior e inferior antes de calcular.
 * Sin esto, una carta regalada a 0,50 € y otra de un vendedor optimista a 300 €
 * mueven el precio de toda la comunidad.
 */
export function trimmedMedian(values: number[], trim = 0.1): number | null {
  if (values.length < 5) return median(values);
  const sorted = [...values].sort((a, b) => a - b);
  const cut = Math.floor(sorted.length * trim);
  return median(sorted.slice(cut, sorted.length - cut));
}

export function range(values: number[]): { min: number; max: number } | null {
  if (!values.length) return null;
  return { min: Math.min(...values), max: Math.max(...values) };
}

export const daysAgo = (n: number): Date => new Date(Date.now() - n * 86_400_000);
