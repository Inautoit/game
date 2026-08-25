import type { Card, CommunitySale, PriceSnapshot } from '../types';
import { daysAgo, range, trimmedMedian } from './stats';
import type { PriceSource } from './types';

export const COMMUNITY_WINDOW_DAYS = 90;

export type SalesFetcher = (cardId: string, since: string) => Promise<CommunitySale[]>;

/**
 * La fuente principal y la más defendible: ventas reales que reportan los
 * usuarios. No depende de nadie y mejora sola conforme crece la base.
 */
export function createCommunitySource(fetchSales: SalesFetcher): PriceSource {
  return {
    id: 'community',
    label: 'Comunidad',
    async fetchPrices(card: Card): Promise<PriceSnapshot | null> {
      const since = daysAgo(COMMUNITY_WINDOW_DAYS).toISOString().slice(0, 10);
      const sales = await fetchSales(card.id, since);
      return snapshotFromSales(card.id, sales);
    },
  };
}

export function snapshotFromSales(
  cardId: string,
  sales: CommunitySale[],
): PriceSnapshot | null {
  const prices = sales.map((s) => Number(s.price)).filter((p) => Number.isFinite(p) && p > 0);
  if (!prices.length) return null;

  const med = trimmedMedian(prices, 0.1);
  if (med == null) return null;
  const bounds = range(prices);

  return {
    id: `community:${cardId}`,
    card_id: cardId,
    source: 'community',
    currency: 'EUR',
    price_min: bounds?.min ?? null,
    price_median: Math.round(med * 100) / 100,
    price_max: bounds?.max ?? null,
    sample_size: prices.length,
    listing_type: 'sold',
    source_url: null,
    captured_at: new Date().toISOString(),
  };
}
