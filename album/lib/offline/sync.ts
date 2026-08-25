'use client';

import { supabase, isSupabaseConfigured } from '../db/supabase';
import type { UserCard } from '../types';
import { db, getMeta, setMeta } from './db';

const LAST_PULL = 'sync:last_pull';
let running = false;
let pending = false;

/**
 * Vacía la cola de salida y baja los cambios del servidor.
 * Se llama después de cada escritura y al volver la conexión; si no hay Supabase
 * configurado o no hay sesión, no hace nada y la cola espera.
 */
export async function requestSync(): Promise<void> {
  if (!isSupabaseConfigured || typeof navigator === 'undefined' || !navigator.onLine) return;
  if (running) { pending = true; return; }
  running = true;
  try {
    await push();
    await pull();
    await pullPrices();
  } catch {
    // Reintentamos en la próxima escritura o al recuperar la conexión.
  } finally {
    running = false;
    if (pending) { pending = false; void requestSync(); }
  }
}

async function currentUserId(): Promise<string | null> {
  const client = supabase();
  if (!client) return null;
  const { data } = await client.auth.getUser();
  return data.user?.id ?? null;
}

async function push(): Promise<void> {
  const client = supabase();
  const userId = await currentUserId();
  if (!client || !userId) return;

  const items = await db().outbox.orderBy('created_at').toArray();
  for (const item of items) {
    try {
      if (item.op.kind === 'user_card.upsert') {
        const row = { ...item.op.payload, user_id: userId };
        const { error } = await client.from('user_cards')
          .upsert(row, { onConflict: 'user_id,card_id,condition' });
        if (error) throw error;
      } else if (item.op.kind === 'user_card.delete') {
        const { error } = await client.from('user_cards')
          .delete().eq('id', item.op.payload.id).eq('user_id', userId);
        if (error) throw error;
      } else {
        const { error } = await client.from('community_sales')
          .upsert({ ...item.op.payload, user_id: userId });
        if (error) throw error;
      }
      await db().outbox.delete(item.id!);
    } catch (e) {
      // Un fallo corta la cola: el orden importa (una repe después de un alta).
      await db().outbox.update(item.id!, {
        tries: item.tries + 1,
        last_error: e instanceof Error ? e.message : String(e),
      });
      throw e;
    }
  }
}

async function pull(): Promise<void> {
  const client = supabase();
  const userId = await currentUserId();
  if (!client || !userId) return;

  const since = (await getMeta<string>(LAST_PULL)) ?? '1970-01-01T00:00:00Z';
  const { data, error } = await client.from('user_cards')
    .select('*').eq('user_id', userId).gt('updated_at', since);
  if (error) throw error;

  const remote = (data ?? []) as UserCard[];
  if (remote.length) {
    await db().transaction('rw', db().userCards, async () => {
      for (const row of remote) {
        const local = await db().userCards
          .where('[card_id+condition]').equals([row.card_id, row.condition]).first();
        // Última escritura gana: es un álbum personal, no un documento compartido.
        if (local && local.updated_at > row.updated_at) continue;
        if (local && local.id !== row.id) await db().userCards.delete(local.id);
        await db().userCards.put(row);
      }
    });
  }
  await setMeta(LAST_PULL, new Date().toISOString());
}

/**
 * Precios de las cartas que te interesan: las que tienes. Los calcula el job
 * en segundo plano, aquí solo se descargan.
 */
async function pullPrices(): Promise<void> {
  const client = supabase();
  if (!client) return;

  const cardIds = [...new Set((await db().userCards.toArray()).map((r) => r.card_id))];
  if (!cardIds.length) return;

  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  for (let i = 0; i < cardIds.length; i += 200) {
    const { data, error } = await client.from('price_snapshots')
      .select('*').in('card_id', cardIds.slice(i, i + 200)).gt('captured_at', since);
    if (error) throw error;
    if (data?.length) await db().prices.bulkPut(data as never);
  }
}

/** Estado para la UI: cuántos cambios quedan por subir. */
export async function pendingChanges(): Promise<number> {
  return db().outbox.count();
}

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => void requestSync());
}
