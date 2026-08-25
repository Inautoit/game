'use client';

import Dexie, { type Table } from 'dexie';
import type { Catalog, CommunitySale, PriceSnapshot, UserCard } from '../types';

export interface CachedCatalog {
  slug: string;
  catalog: Catalog;
  fetched_at: string;
}

export type OutboxOp =
  | { kind: 'user_card.upsert'; payload: UserCard }
  | { kind: 'user_card.delete'; payload: { id: string } }
  | { kind: 'sale.create'; payload: CommunitySale };

export interface OutboxItem {
  id?: number;
  op: OutboxOp;
  created_at: string;
  tries: number;
  last_error?: string;
}

export interface StoredPhoto {
  key: string;
  blob: Blob;
}

export interface MetaRow {
  key: string;
  value: unknown;
}

/**
 * IndexedDB es la fuente de verdad del cliente: se escribe aquí primero y se
 * sincroniza después. La app entera funciona sin conexión.
 */
class AlbumDatabase extends Dexie {
  catalogs!: Table<CachedCatalog, string>;
  userCards!: Table<UserCard, string>;
  outbox!: Table<OutboxItem, number>;
  sales!: Table<CommunitySale, string>;
  prices!: Table<PriceSnapshot, string>;
  photos!: Table<StoredPhoto, string>;
  meta!: Table<MetaRow, string>;

  constructor() {
    super('album-cards');
    this.version(1).stores({
      catalogs: 'slug',
      userCards: 'id, card_id, [card_id+condition], quantity, for_trade, updated_at',
      outbox: '++id, created_at',
      sales: 'id, card_id, sold_at',
      prices: 'id, card_id, [card_id+source], captured_at',
      photos: 'key',
      meta: 'key',
    });
  }
}

let instance: AlbumDatabase | null = null;

/** El navegador es el único sitio donde existe IndexedDB: nunca en el servidor. */
export function db(): AlbumDatabase {
  if (!instance) instance = new AlbumDatabase();
  return instance;
}

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `local-${Math.random().toString(36).slice(2)}-${Date.now().toString(36)}`;
}

export async function getMeta<T>(key: string): Promise<T | undefined> {
  const row = await db().meta.get(key);
  return row?.value as T | undefined;
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await db().meta.put({ key, value });
}
