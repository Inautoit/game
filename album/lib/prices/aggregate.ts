import type { PriceSnapshot } from '../types';
import type { AggregatedPrice } from './types';

/** Una venta cerrada dice más que un anuncio que nadie ha comprado. */
const LISTING_WEIGHT: Record<string, number> = { sold: 1, active: 0.55 };
const SOURCE_WEIGHT: Record<string, number> = {
  community: 1, ebay: 0.9, cardmarket: 0.9, manual: 0.5,
};
const HALF_LIFE_DAYS = 45;

function weightOf(s: PriceSnapshot, now: number): number {
  const ageDays = Math.max(0, (now - new Date(s.captured_at).getTime()) / 86_400_000);
  const recency = Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
  const sample = Math.min(1, Math.log10((s.sample_size ?? 1) + 1) / Math.log10(21));
  return recency
    * (LISTING_WEIGHT[s.listing_type ?? 'active'] ?? 0.5)
    * (SOURCE_WEIGHT[s.source] ?? 0.5)
    * (0.4 + 0.6 * sample);
}

/**
 * Mediana ponderada de los snapshots: más peso a lo reciente, a lo cerrado
 * y a las muestras grandes. Un solo número, pero siempre acompañado del
 * desglose que lo explica.
 */
export function aggregate(snapshots: PriceSnapshot[]): AggregatedPrice | null {
  const usable = snapshots.filter((s) => s.price_median != null);
  if (!usable.length) return null;

  const now = Date.now();
  const weighted = usable
    .map((s) => ({ s, price: Number(s.price_median), weight: weightOf(s, now) }))
    .filter((w) => w.weight > 0)
    .sort((a, b) => a.price - b.price);

  if (!weighted.length) return null;

  const total = weighted.reduce((n, w) => n + w.weight, 0);
  let acc = 0;
  let value = weighted[weighted.length - 1].price;
  for (const w of weighted) {
    acc += w.weight;
    if (acc >= total / 2) { value = w.price; break; }
  }

  const ordered = [...usable].sort(
    (a, b) => new Date(b.captured_at).getTime() - new Date(a.captured_at).getTime(),
  );

  return {
    value: Math.round(value * 100) / 100,
    currency: ordered[0].currency || 'EUR',
    snapshots: ordered,
    sampleSize: usable.reduce((n, s) => n + (s.sample_size ?? 0), 0),
    updatedAt: ordered[0].captured_at,
  };
}

export function formatPrice(value: number | null | undefined, currency = 'EUR'): string {
  if (value == null) return '—';
  return new Intl.NumberFormat('es-ES', {
    style: 'currency', currency, maximumFractionDigits: value >= 100 ? 0 : 2,
  }).format(value);
}
