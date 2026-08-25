import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Catalog } from '../types';

const cache = new Map<string, Catalog>();

/**
 * Catálogo en el servidor, para renderizar las fichas de carta con SSR
 * (metadatos correctos al compartir un enlace).
 */
export async function getCatalog(slug: string): Promise<Catalog | null> {
  const cached = cache.get(slug);
  if (cached) return cached;
  try {
    const raw = await readFile(join(process.cwd(), 'public/catalog', `${slug}.json`), 'utf8');
    const catalog = JSON.parse(raw) as Catalog;
    cache.set(slug, catalog);
    return catalog;
  } catch {
    return null;
  }
}

export async function findCard(slug: string, cardId: string) {
  const catalog = await getCatalog(slug);
  if (!catalog) return null;
  const card = catalog.cards.find((c) => c.id === cardId);
  if (!card) return null;
  return {
    catalog,
    card,
    series: catalog.series.find((s) => s.id === card.series_id)!,
    team: catalog.teams.find((t) => t.id === card.team_id) ?? null,
  };
}
