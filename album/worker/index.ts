/**
 * Worker opcional de precios (Cloudflare).
 *
 * La app no lo necesita: el precio de la comunidad se calcula en el navegador a
 * partir de las ventas reportadas. Este Worker existe solo para lo que sí
 * requiere un secreto y no puede vivir en el cliente: consultar la API de eBay
 * y dejar los snapshots en Supabase.
 *
 *   cd album && npx wrangler deploy --config worker/wrangler.jsonc
 */
import { createClient } from '@supabase/supabase-js';
import { createCommunitySource } from '../lib/prices/community';
import { createEbaySource, searchQuery } from '../lib/prices/ebay';
import type { PriceSource } from '../lib/prices/types';
import type { Card, Catalog, CommunitySale, PriceSnapshot } from '../lib/types';

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  /** JSON del catálogo publicado, p. ej. https://tu-sitio.pages.dev/catalog/liga-2025-26.json */
  CATALOG_URL: string;
  PRICE_REFRESH_SECRET?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  EBAY_MARKETPLACE_ID?: string;
}

/** Un snapshot por carta y fuente cada 24 h como mucho. */
const MIN_HOURS_BETWEEN_SNAPSHOTS = 24;
const DEFAULT_LIMIT = 200;

async function refresh(env: Env, limit = DEFAULT_LIMIT) {
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Faltan SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY');
  }

  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false },
  });

  const res = await fetch(env.CATALOG_URL);
  if (!res.ok) throw new Error(`No se pudo leer el catálogo (${res.status})`);
  const catalog = (await res.json()) as Catalog;

  const cardById = new Map(catalog.cards.map((c) => [c.id, c]));
  const teamById = new Map(catalog.teams.map((t) => [t.id, t]));

  // Prioridad: cartas que alguien tiene o busca. El resto puede esperar.
  const { data: demand, error: demandError } = await db
    .from('user_cards').select('card_id').limit(20_000);
  if (demandError) throw new Error(demandError.message);

  const counts = new Map<string, number>();
  for (const row of demand ?? []) {
    const id = row.card_id as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const queue = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => cardById.get(id))
    .filter((c): c is Card => Boolean(c))
    .slice(0, limit);
  if (!queue.length) queue.push(...catalog.cards.slice(0, limit));

  const sources: PriceSource[] = [
    createCommunitySource(async (cardId, since) => {
      const { data } = await db.from('community_sales')
        .select('*').eq('card_id', cardId).gte('sold_at', since);
      return (data ?? []) as CommunitySale[];
    }),
  ];

  if (env.EBAY_CLIENT_ID && env.EBAY_CLIENT_SECRET) {
    sources.push(createEbaySource(
      {
        clientId: env.EBAY_CLIENT_ID,
        clientSecret: env.EBAY_CLIENT_SECRET,
        marketplaceId: env.EBAY_MARKETPLACE_ID,
      },
      (card) => searchQuery(
        card,
        catalog.collection.name,
        card.team_id ? teamById.get(card.team_id)?.name : undefined,
      ),
    ));
  }

  const fresh = new Date(Date.now() - MIN_HOURS_BETWEEN_SNAPSHOTS * 3_600_000).toISOString();
  const { data: recent } = await db.from('price_snapshots')
    .select('card_id, source').gt('captured_at', fresh);
  const skip = new Set((recent ?? []).map((r) => `${r.card_id}:${r.source}`));

  const inserts: Omit<PriceSnapshot, 'id'>[] = [];
  const errors: string[] = [];

  for (const card of queue) {
    for (const source of sources) {
      if (skip.has(`${card.id}:${source.id}`)) continue;
      try {
        const snapshot = await source.fetchPrices(card);
        if (snapshot) {
          const { id: _unused, ...row } = snapshot;
          inserts.push(row);
        }
      } catch (e) {
        errors.push(`${source.id}/${card.number}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  for (let i = 0; i < inserts.length; i += 500) {
    const { error } = await db.from('price_snapshots').insert(inserts.slice(i, i + 500));
    if (error) errors.push(`insert: ${error.message}`);
  }

  return {
    checked: queue.length,
    sources: sources.map((s) => s.id),
    written: inserts.length,
    errors: errors.slice(0, 20),
  };
}

export default {
  /** Disparo manual, protegido por secreto. */
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const given = url.searchParams.get('secret')
      ?? request.headers.get('authorization')?.replace(/^Bearer /, '');

    if (!env.PRICE_REFRESH_SECRET || given !== env.PRICE_REFRESH_SECRET) {
      return Response.json({ error: 'no autorizado' }, { status: 401 });
    }

    try {
      const limit = Math.min(1000, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT);
      return Response.json(await refresh(env, limit));
    } catch (e) {
      return Response.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  },

  /** El cron real: una pasada al día, nunca durante la petición de un usuario. */
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(refresh(env).then((r) => console.log('precios', r)));
  },
};
