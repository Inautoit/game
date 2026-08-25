'use client';

import type { CommunitySale, Condition, UserCard } from '../types';
import { db, newId, type OutboxOp } from './db';
import { requestSync } from './sync';

async function enqueue(op: OutboxOp): Promise<void> {
  await db().outbox.add({ op, created_at: new Date().toISOString(), tries: 0 });
  void requestSync();
}

export const DEFAULT_CONDITION: Condition = 'nm';

async function find(cardId: string, condition: Condition): Promise<UserCard | undefined> {
  return db().userCards.where('[card_id+condition]').equals([cardId, condition]).first();
}

async function save(row: UserCard): Promise<UserCard> {
  const next = { ...row, updated_at: new Date().toISOString() };
  await db().userCards.put(next);
  await enqueue({ kind: 'user_card.upsert', payload: next });
  return next;
}

async function remove(row: UserCard): Promise<void> {
  await db().userCards.delete(row.id);
  await enqueue({ kind: 'user_card.delete', payload: { id: row.id } });
}

export interface MarkResult {
  quantity: number;
  isNew: boolean;
}

/** Toque corto en el álbum: si no la tienes la marcas, si la tienes suma una repe. */
export async function addCopy(
  cardId: string,
  condition: Condition = DEFAULT_CONDITION,
): Promise<MarkResult> {
  const existing = await find(cardId, condition);
  if (!existing) {
    await save({
      id: newId(), user_id: null, card_id: cardId, quantity: 1, condition,
      photo_path: null, for_trade: false, acquired_price: null, notes: null,
      updated_at: new Date().toISOString(),
    });
    return { quantity: 1, isNew: true };
  }
  const quantity = existing.quantity + 1;
  await save({ ...existing, quantity });
  return { quantity, isNew: false };
}

export async function setQuantity(
  cardId: string,
  quantity: number,
  condition: Condition = DEFAULT_CONDITION,
): Promise<void> {
  const existing = await find(cardId, condition);
  const q = Math.max(0, Math.floor(quantity));
  if (!existing) {
    if (q === 0) return;
    await save({
      id: newId(), user_id: null, card_id: cardId, quantity: q, condition,
      photo_path: null, for_trade: false, acquired_price: null, notes: null,
      updated_at: new Date().toISOString(),
    });
    return;
  }
  if (q === 0 && !existing.photo_path && !existing.notes) {
    await remove(existing);
    return;
  }
  await save({ ...existing, quantity: q });
}

export async function updateUserCard(
  cardId: string,
  patch: Partial<Omit<UserCard, 'id' | 'card_id' | 'condition'>>,
  condition: Condition = DEFAULT_CONDITION,
): Promise<void> {
  const existing = await find(cardId, condition);
  if (!existing) {
    await save({
      id: newId(), user_id: null, card_id: cardId, quantity: 0, condition,
      photo_path: null, for_trade: false, acquired_price: null, notes: null,
      updated_at: new Date().toISOString(), ...patch,
    });
    return;
  }
  await save({ ...existing, ...patch });
}

export async function reportSale(
  sale: Omit<CommunitySale, 'id' | 'created_at' | 'verified' | 'user_id'>,
): Promise<void> {
  const row: CommunitySale = {
    ...sale, id: newId(), user_id: null, verified: false,
    created_at: new Date().toISOString(),
  };
  await db().sales.put(row);
  await enqueue({ kind: 'sale.create', payload: row });
}

/** Deshacer de la entrada rápida: quita una copia. */
export async function removeCopy(
  cardId: string,
  condition: Condition = DEFAULT_CONDITION,
): Promise<void> {
  const existing = await find(cardId, condition);
  if (!existing) return;
  await setQuantity(cardId, existing.quantity - 1, condition);
}
