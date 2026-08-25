import type { Card, PriceSnapshot } from '../types';
import { median, range } from './stats';
import type { PriceSource } from './types';

interface EbayConfig {
  clientId: string;
  clientSecret: string;
  marketplaceId?: string;
}

interface EbayItem {
  price?: { value?: string; currency?: string };
  itemWebUrl?: string;
}

const OAUTH = 'https://api.ebay.com/identity/v1/oauth2/token';
const BROWSE = 'https://api.ebay.com/buy/browse/v1/item_summary/search';

let token: { value: string; expiresAt: number } | null = null;

async function accessToken(cfg: EbayConfig): Promise<string> {
  if (token && token.expiresAt > Date.now() + 60_000) return token.value;

  const basic = Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64');
  const res = await fetch(OAUTH, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${basic}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials&scope=https%3A%2F%2Fapi.ebay.com%2Foauth%2Fapi_scope',
  });
  if (!res.ok) throw new Error(`eBay OAuth ${res.status}`);
  const data = (await res.json()) as { access_token: string; expires_in: number };
  token = { value: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return token.value;
}

export function searchQuery(card: Card, collectionName: string, teamName?: string): string {
  return [collectionName, card.player_name ?? teamName, card.number]
    .filter(Boolean).join(' ');
}

/**
 * Única fuente grande con vía legítima y estable: API oficial.
 *
 * Ojo con lo que promete: la Browse API devuelve anuncios **activos**, no ventas
 * cerradas. El histórico de ventas está en Marketplace Insights, que requiere
 * solicitud y aprobación aparte. Por eso los snapshots salen como 'active' y
 * el agregador les da menos peso.
 */
export function createEbaySource(cfg: EbayConfig, queryFor: (card: Card) => string): PriceSource {
  return {
    id: 'ebay',
    label: 'eBay',
    async fetchPrices(card: Card): Promise<PriceSnapshot | null> {
      const q = queryFor(card);
      const url = `${BROWSE}?q=${encodeURIComponent(q)}&limit=50&filter=${
        encodeURIComponent('buyingOptions:{FIXED_PRICE},conditionIds:{4000|5000|1000|1500|2000|2500|3000}')
      }`;

      const res = await fetch(url, {
        headers: {
          Authorization: `Bearer ${await accessToken(cfg)}`,
          'X-EBAY-C-MARKETPLACE-ID': cfg.marketplaceId || 'EBAY_ES',
        },
      });
      if (!res.ok) return null;

      const data = (await res.json()) as { itemSummaries?: EbayItem[] };
      const items = data.itemSummaries ?? [];
      const prices = items
        .map((i) => Number(i.price?.value))
        .filter((p) => Number.isFinite(p) && p > 0);
      if (prices.length < 3) return null;

      const bounds = range(prices)!;
      return {
        id: `ebay:${card.id}`,
        card_id: card.id,
        source: 'ebay',
        currency: items[0]?.price?.currency || 'EUR',
        price_min: bounds.min,
        price_median: median(prices),
        price_max: bounds.max,
        sample_size: prices.length,
        listing_type: 'active',
        source_url: `https://www.ebay.es/sch/i.html?_nkw=${encodeURIComponent(q)}`,
        captured_at: new Date().toISOString(),
      };
    },
  };
}
