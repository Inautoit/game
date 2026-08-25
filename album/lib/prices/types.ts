import type { Card, PriceSnapshot, PriceSourceId } from '../types';

/**
 * Las fuentes de precio cambian y algunas se rompen. Todas entran por aquí,
 * así que sustituir una no toca ni la UI ni el agregador.
 */
export interface PriceSource {
  id: PriceSourceId;
  label: string;
  /** Devuelve null si la fuente no tiene datos suficientes para esa carta. */
  fetchPrices(card: Card): Promise<PriceSnapshot | null>;
}

export interface AggregatedPrice {
  value: number;
  currency: string;
  /** Snapshots que han entrado en el cálculo, el más reciente primero. */
  snapshots: PriceSnapshot[];
  sampleSize: number;
  updatedAt: string;
}

export const SOURCE_LABEL: Record<PriceSourceId, string> = {
  community: 'Comunidad',
  ebay: 'eBay',
  cardmarket: 'Cardmarket',
  manual: 'Tuyo',
};
