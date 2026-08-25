import { NextResponse } from 'next/server';
import { serviceClient } from '@/lib/db/supabase-server';
import { getCatalog } from '@/lib/server/catalog';
import { COLLECTION_SLUG } from '@/lib/config';
import { createCommunitySource, COMMUNITY_WINDOW_DAYS } from '@/lib/prices/community';
import { createEbaySource, searchQuery } from '@/lib/prices/ebay';
import { daysAgo } from '@/lib/prices/stats';
import type { PriceSource } from '@/lib/prices/types';
import type { Card, CommunitySale, PriceSnapshot } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Un snapshot por carta y fuente cada 24 h como mucho. */
const MIN_HOURS_BETWEEN_SNAPSHOTS = 24;
const DEFAULT_LIMIT = 200;

function authorized(request: Request): boolean {
  const secret = process.env.PRICE_REFRESH_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization')?.replace(/^Bearer /, '')
    ?? request.headers.get('x-refresh-secret');
  const param = new URL(request.url).searchParams.get('secret');
  return header === secret || param === secret;
}

/**
 * Job de refresco de precios. Nunca se llama desde la petición de un usuario:
 * lo dispara el cron, prioriza las cartas que alguien tiene o busca y respeta
 * las 24 h de caché por carta y fuente.
 */
async function refresh(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'no autorizado' }, { status: 401 });
  }

  const db = serviceClient();
  if (!db) {
    return NextResponse.json({ error: 'Supabase no configurado' }, { status: 503 });
  }

  const url = new URL(request.url);
  const limit = Math.min(1000, Number(url.searchParams.get('limit')) || DEFAULT_LIMIT);
  const catalog = await getCatalog(url.searchParams.get('collection') ?? COLLECTION_SLUG);
  if (!catalog) {
    return NextResponse.json({ error: 'catálogo no encontrado' }, { status: 404 });
  }

  const cardById = new Map(catalog.cards.map((c) => [c.id, c]));
  const teamById = new Map(catalog.teams.map((t) => [t.id, t]));

  // Prioridad: cartas que alguien tiene o busca. El resto puede esperar.
  const { data: demand, error: demandError } = await db
    .from('user_cards').select('card_id').limit(20_000);
  if (demandError) {
    return NextResponse.json({ error: demandError.message }, { status: 500 });
  }

  const counts = new Map<string, number>();
  for (const row of demand ?? []) {
    counts.set(row.card_id as string, (counts.get(row.card_id as string) ?? 0) + 1);
  }
  const queue = [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([id]) => cardById.get(id))
    .filter((c): c is Card => Boolean(c))
    .slice(0, limit);

  // Nada que priorizar todavía: se refresca el principio del catálogo.
  if (!queue.length) queue.push(...catalog.cards.slice(0, limit));

  const sources: PriceSource[] = [
    createCommunitySource(async (cardId, since) => {
      const { data } = await db.from('community_sales')
        .select('*').eq('card_id', cardId).gte('sold_at', since);
      return (data ?? []) as CommunitySale[];
    }),
  ];

  if (process.env.EBAY_CLIENT_ID && process.env.EBAY_CLIENT_SECRET) {
    sources.push(createEbaySource(
      {
        clientId: process.env.EBAY_CLIENT_ID,
        clientSecret: process.env.EBAY_CLIENT_SECRET,
        marketplaceId: process.env.EBAY_MARKETPLACE_ID,
      },
      (card) => searchQuery(
        card,
        catalog.collection.name,
        card.team_id ? teamById.get(card.team_id)?.name : undefined,
      ),
    ));
  }

  const fresh = daysAgo(MIN_HOURS_BETWEEN_SNAPSHOTS / 24).toISOString();
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
          const { id: _ignored, ...row } = snapshot;
          inserts.push(row);
        }
      } catch (e) {
        errors.push(`${source.id}/${card.number}: ${e instanceof Error ? e.message : e}`);
      }
    }
  }

  if (inserts.length) {
    for (let i = 0; i < inserts.length; i += 500) {
      const { error } = await db.from('price_snapshots').insert(inserts.slice(i, i + 500));
      if (error) errors.push(`insert: ${error.message}`);
    }
  }

  return NextResponse.json({
    checked: queue.length,
    sources: sources.map((s) => s.id),
    written: inserts.length,
    windowDays: COMMUNITY_WINDOW_DAYS,
    errors: errors.slice(0, 20),
  });
}

export const GET = refresh;
export const POST = refresh;
