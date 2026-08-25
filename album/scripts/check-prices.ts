/**
 * Comprobaciones del cálculo de precios. Es la parte del código donde un fallo
 * silencioso da un número creíble y equivocado, así que se verifica a mano.
 *
 *   npm run check:prices
 */
import { trimmedMedian, median } from '../lib/prices/stats';
import { aggregate } from '../lib/prices/aggregate';
import { snapshotFromSales } from '../lib/prices/community';

const eq = (name: string, got: unknown, want: unknown) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(ok ? '✓' : '✗', name, ok ? '' : `got ${JSON.stringify(got)} want ${JSON.stringify(want)}`);
  if (!ok) process.exitCode = 1;
};

eq('mediana impar', median([3, 1, 2]), 2);
eq('mediana par', median([1, 2, 3, 4]), 2.5);
eq('mediana vacía', median([]), null);
eq('recortada con pocos datos = mediana', trimmedMedian([1, 100]), 50.5);
// 12 valores: descarta 1 por lado -> quita el 0.5 y el 300
eq('recortada descarta extremos',
  trimmedMedian([0.5, 4, 4, 4.5, 5, 5, 5, 5.5, 6, 6, 6, 300]), 5);

const sales = [4, 5, 5, 6, 4.5, 5.5, 5, 5, 300, 0.2].map((price, i) => ({
  id: String(i), card_id: 'c1', user_id: null, price, platform: 'wallapop',
  condition: 'nm' as const, sold_at: '2026-08-01', verified: false, created_at: '',
}));
const snap = snapshotFromSales('c1', sales)!;
eq('snapshot comunidad: mediana recortada', snap.price_median, 5);
eq('snapshot comunidad: muestra', snap.sample_size, 10);
eq('snapshot comunidad: extremos visibles', [snap.price_min, snap.price_max], [0.2, 300]);

const now = new Date().toISOString();
const old = new Date(Date.now() - 400 * 86400000).toISOString();
const agg = aggregate([
  { ...snap, id: 'a', price_median: 5, captured_at: now, listing_type: 'sold', source: 'community' },
  { ...snap, id: 'b', price_median: 50, captured_at: old, listing_type: 'active', source: 'ebay' },
])!;
eq('agregado: manda lo reciente y cerrado', agg.value, 5);
eq('agregado sin datos', aggregate([]), null);
