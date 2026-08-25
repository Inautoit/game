'use client';

import type { Catalog } from '../types';
import { db } from './db';

/**
 * Carga el catálogo: primero de IndexedDB (instantáneo y sin red) y, si no está,
 * del JSON estático. Después refresca en segundo plano.
 */
export async function loadCatalog(slug: string): Promise<Catalog> {
  const cached = await db().catalogs.get(slug);
  if (cached) {
    void refresh(slug);
    return cached.catalog;
  }
  const catalog = await fetchCatalog(slug);
  await db().catalogs.put({ slug, catalog, fetched_at: new Date().toISOString() });
  return catalog;
}

async function fetchCatalog(slug: string): Promise<Catalog> {
  const res = await fetch(`/catalog/${slug}.json`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`No se pudo cargar el catálogo "${slug}" (${res.status})`);
  return (await res.json()) as Catalog;
}

async function refresh(slug: string): Promise<void> {
  try {
    const catalog = await fetchCatalog(slug);
    await db().catalogs.put({ slug, catalog, fetched_at: new Date().toISOString() });
  } catch {
    // Sin conexión: el catálogo cacheado sigue siendo válido.
  }
}

export interface CatalogIndex {
  catalog: Catalog;
  cardById: Map<string, Catalog['cards'][number]>;
  seriesById: Map<string, Catalog['series'][number]>;
  teamById: Map<string, Catalog['teams'][number]>;
  teamBySlug: Map<string, Catalog['teams'][number]>;
  seriesByCode: Map<string, Catalog['series'][number]>;
  baseSeries: Catalog['series'][number] | undefined;
  cardsByTeam: Map<string, Catalog['cards'][number][]>;
  cardsBySeries: Map<string, Catalog['cards'][number][]>;
}

export function indexCatalog(catalog: Catalog): CatalogIndex {
  const cardById = new Map(catalog.cards.map((c) => [c.id, c]));
  const seriesById = new Map(catalog.series.map((s) => [s.id, s]));
  const teamById = new Map(catalog.teams.map((t) => [t.id, t]));
  const teamBySlug = new Map(catalog.teams.map((t) => [t.slug, t]));
  const seriesByCode = new Map(catalog.series.map((s) => [s.code, s]));
  const baseSeries = catalog.series.find((s) => s.kind === 'base') ?? catalog.series[0];

  const cardsByTeam = new Map<string, Catalog['cards'][number][]>();
  const cardsBySeries = new Map<string, Catalog['cards'][number][]>();
  for (const card of catalog.cards) {
    if (card.team_id && card.series_id === baseSeries?.id) {
      const list = cardsByTeam.get(card.team_id) ?? [];
      list.push(card);
      cardsByTeam.set(card.team_id, list);
    }
    const list = cardsBySeries.get(card.series_id) ?? [];
    list.push(card);
    cardsBySeries.set(card.series_id, list);
  }

  return {
    catalog, cardById, seriesById, teamById, teamBySlug, seriesByCode,
    baseSeries, cardsByTeam, cardsBySeries,
  };
}
