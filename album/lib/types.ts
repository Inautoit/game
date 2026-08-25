export type SeriesKind = 'base' | 'insert' | 'parallel' | 'autograph' | 'limited';
export type Condition = 'mint' | 'nm' | 'played' | 'damaged';
export type PriceSourceId = 'ebay' | 'cardmarket' | 'community' | 'manual';
export type ListingType = 'sold' | 'active';

export interface Collection {
  id: string;
  slug: string;
  name: string;
  season: string;
  publisher: string | null;
  total_cards: number;
  released_at: string | null;
  is_active: boolean;
}

export interface Series {
  id: string;
  collection_id: string;
  code: string;
  name: string;
  kind: SeriesKind;
  card_count: number;
  scarcity: number;
  sort_order: number;
  requestable: boolean;
}

export interface Team {
  id: string;
  collection_id: string;
  name: string;
  slug: string;
  primary_color: string;
  secondary_color: string;
  sort_order: number;
}

export interface Card {
  id: string;
  collection_id: string;
  series_id: string;
  team_id: string | null;
  number: string;
  player_name: string | null;
  position: string | null;
  variant: string | null;
  print_run: number | null;
  sort_order: number;
}

/** El catálogo completo, servido como JSON estático y cacheado en IndexedDB. */
export interface Catalog {
  collection: Collection;
  series: Series[];
  teams: Team[];
  cards: Card[];
}

export interface UserCard {
  id: string;
  user_id: string | null;
  card_id: string;
  quantity: number;
  condition: Condition;
  photo_path: string | null;
  for_trade: boolean;
  acquired_price: number | null;
  notes: string | null;
  updated_at: string;
}

export interface PriceSnapshot {
  id: string;
  card_id: string;
  source: PriceSourceId;
  currency: string;
  price_min: number | null;
  price_median: number | null;
  price_max: number | null;
  sample_size: number | null;
  listing_type: ListingType | null;
  source_url: string | null;
  captured_at: string;
}

export interface CommunitySale {
  id: string;
  card_id: string;
  user_id: string | null;
  price: number;
  platform: string | null;
  condition: Condition | null;
  sold_at: string;
  verified: boolean;
  created_at: string;
}

export const CONDITIONS: { value: Condition; label: string }[] = [
  { value: 'mint', label: 'Mint' },
  { value: 'nm', label: 'Casi nueva' },
  { value: 'played', label: 'Jugada' },
  { value: 'damaged', label: 'Dañada' },
];

export const SERIES_KIND_LABEL: Record<SeriesKind, string> = {
  base: 'Base',
  insert: 'Inserts',
  parallel: 'Paralelas',
  autograph: 'Autógrafos',
  limited: 'Tiradas limitadas',
};

/** El oro se reserva para lo raro: paralelas, autógrafos y tiradas limitadas. */
export function isRare(series: Pick<Series, 'kind' | 'scarcity'>): boolean {
  return series.scarcity >= 3 || series.kind === 'parallel' ||
    series.kind === 'autograph' || series.kind === 'limited';
}
