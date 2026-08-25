'use client';

import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo } from 'react';
import { db } from '../offline/db';
import type { CommunitySale, PriceSnapshot, UserCard } from '../types';
import { aggregate } from './aggregate';
import { snapshotFromSales, COMMUNITY_WINDOW_DAYS } from './community';
import { daysAgo } from './stats';
import type { AggregatedPrice } from './types';

const browser = () => typeof window !== 'undefined';

/**
 * Precios de todas las cartas, calculados en el cliente sobre lo que hay en
 * IndexedDB: snapshots sincronizados, ventas de la comunidad y lo que el propio
 * usuario apuntó. Cero llamadas a APIs externas durante la navegación.
 */
export function usePrices(): {
  priceFor: (cardId: string) => AggregatedPrice | null;
  snapshotsFor: (cardId: string) => PriceSnapshot[];
  ready: boolean;
} {
  const snapshots = useLiveQuery(
    () => (browser() ? db().prices.toArray() : Promise.resolve([] as PriceSnapshot[])),
    [], [] as PriceSnapshot[],
  );
  const sales = useLiveQuery(
    () => (browser() ? db().sales.toArray() : Promise.resolve([] as CommunitySale[])),
    [], [] as CommunitySale[],
  );
  const userCards = useLiveQuery(
    () => (browser() ? db().userCards.toArray() : Promise.resolve([] as UserCard[])),
    [], [] as UserCard[],
  );

  const byCard = useMemo(() => {
    const map = new Map<string, PriceSnapshot[]>();
    const add = (s: PriceSnapshot) => {
      const list = map.get(s.card_id) ?? [];
      list.push(s);
      map.set(s.card_id, list);
    };

    snapshots.forEach(add);

    // Ventas locales aún no sincronizadas: cuentan igual para el usuario.
    const since = daysAgo(COMMUNITY_WINDOW_DAYS).toISOString().slice(0, 10);
    const byCardSales = new Map<string, typeof sales>();
    for (const sale of sales) {
      if (sale.sold_at < since) continue;
      const list = byCardSales.get(sale.card_id) ?? [];
      list.push(sale);
      byCardSales.set(sale.card_id, list);
    }
    for (const [cardId, list] of byCardSales) {
      const snap = snapshotFromSales(cardId, list);
      if (snap) add({ ...snap, id: `local-community:${cardId}` });
    }

    // Lo que pagaste es un dato, aunque valga menos que el mercado.
    for (const row of userCards) {
      if (row.acquired_price == null) continue;
      add({
        id: `manual:${row.id}`,
        card_id: row.card_id,
        source: 'manual',
        currency: 'EUR',
        price_min: row.acquired_price,
        price_median: row.acquired_price,
        price_max: row.acquired_price,
        sample_size: 1,
        listing_type: 'sold',
        source_url: null,
        captured_at: row.updated_at,
      });
    }

    return map;
  }, [snapshots, sales, userCards]);

  return useMemo(() => ({
    priceFor: (cardId: string) => aggregate(byCard.get(cardId) ?? []),
    snapshotsFor: (cardId: string) => byCard.get(cardId) ?? [],
    ready: true,
  }), [byCard]);
}
