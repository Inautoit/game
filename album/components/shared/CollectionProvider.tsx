'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { COLLECTION_SLUG } from '@/lib/config';
import { db } from '@/lib/offline/db';
import { indexCatalog, loadCatalog, type CatalogIndex } from '@/lib/offline/catalog';
import { requestSync } from '@/lib/offline/sync';
import type { UserCard } from '@/lib/types';

export interface Owned {
  quantity: number;
  rows: UserCard[];
  photo_path: string | null;
  for_trade: boolean;
}

interface CollectionState {
  index: CatalogIndex | null;
  loading: boolean;
  error: string | null;
  owned: Map<string, Owned>;
  userCards: UserCard[];
  pending: number;
  /** Cartas distintas que tienes, sobre el total del catálogo. */
  progress: { owned: number; total: number; percent: number };
}

const Ctx = createContext<CollectionState | null>(null);

const browser = () => typeof window !== 'undefined';

export function CollectionProvider({ children }: { children: React.ReactNode }) {
  const [index, setIndex] = useState<CatalogIndex | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadCatalog(COLLECTION_SLUG)
      .then((catalog) => { if (alive) setIndex(indexCatalog(catalog)); })
      .catch((e: Error) => { if (alive) setError(e.message); });
    void requestSync();
    return () => { alive = false; };
  }, []);

  const userCards = useLiveQuery(
    () => (browser() ? db().userCards.toArray() : Promise.resolve([] as UserCard[])),
    [],
    [] as UserCard[],
  );
  const pending = useLiveQuery(
    () => (browser() ? db().outbox.count() : Promise.resolve(0)),
    [],
    0,
  );

  const owned = useMemo(() => {
    const map = new Map<string, Owned>();
    for (const row of userCards) {
      if (row.quantity < 1) continue;
      const prev = map.get(row.card_id);
      map.set(row.card_id, {
        quantity: (prev?.quantity ?? 0) + row.quantity,
        rows: [...(prev?.rows ?? []), row],
        photo_path: prev?.photo_path ?? row.photo_path,
        for_trade: (prev?.for_trade ?? false) || row.for_trade,
      });
    }
    return map;
  }, [userCards]);

  const value: CollectionState = useMemo(() => {
    const total = index?.catalog.cards.length ?? 0;
    const have = index
      ? index.catalog.cards.reduce((n, c) => n + (owned.has(c.id) ? 1 : 0), 0)
      : 0;
    return {
      index,
      loading: !index && !error,
      error,
      owned,
      userCards,
      pending,
      progress: { owned: have, total, percent: total ? Math.round((have / total) * 100) : 0 },
    };
  }, [index, error, owned, userCards, pending]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCollection(): CollectionState {
  const value = useContext(Ctx);
  if (!value) throw new Error('useCollection fuera de CollectionProvider');
  return value;
}
