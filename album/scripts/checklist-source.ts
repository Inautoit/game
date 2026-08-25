/**
 * Lee data/*.csv y devuelve el catálogo ya normalizado.
 * Lo comparten build-catalog.ts (JSON para la app) e import-checklist.ts (Supabase),
 * así que ambos generan exactamente los mismos ids.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import Papa from 'papaparse';
import type { Card, Catalog, Collection, Series, SeriesKind, Team } from '../lib/types';

const DATA = (f: string) => resolve(process.cwd(), 'data', f);
const NAMESPACE = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';

/** UUID v5 determinista: la misma clave da siempre el mismo id, en local y en Supabase. */
export function uuidFor(key: string): string {
  const ns = Buffer.from(NAMESPACE.replace(/-/g, ''), 'hex');
  const hash = createHash('sha1').update(Buffer.concat([ns, Buffer.from(key, 'utf8')])).digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface ChecklistRow {
  series_code: string; series_name: string; series_kind: string; number: string;
  player_name: string; team: string; position: string; variant: string;
  print_run: string; scarcity: string; requestable: string;
}

interface TeamRow {
  key: string; name: string; slug: string;
  primary_color: string; secondary_color: string; pattern: string; sort_order: string;
}

function parseCsv<T>(file: string): T[] {
  const text = readFileSync(DATA(file), 'utf8');
  const out = Papa.parse<T>(text, { header: true, skipEmptyLines: true, transform: (v) => v.trim() });
  if (out.errors.length) {
    throw new Error(`${file}: ${out.errors[0].message} (fila ${out.errors[0].row})`);
  }
  return out.data;
}

const num = (v: string): number | null => (v === '' ? null : Number(v));

export function readCatalog(): Catalog {
  const meta = JSON.parse(readFileSync(DATA('collection.json'), 'utf8'));
  const collectionId = uuidFor(`collection:${meta.slug}`);

  const teamRows = parseCsv<TeamRow>('teams.csv');
  const rows = parseCsv<ChecklistRow>('checklist.csv');

  const teams: Team[] = teamRows.map((t) => ({
    id: uuidFor(`team:${meta.slug}:${t.slug}`),
    collection_id: collectionId,
    name: t.name,
    slug: t.slug,
    primary_color: t.primary_color || '#7c8291',
    secondary_color: t.secondary_color || '#ffffff',
    pattern: t.pattern || 'plain',
    sort_order: Number(t.sort_order || 0),
  }));
  const teamByKey = new Map(teamRows.map((t, i) => [t.key, teams[i]]));

  const series: Series[] = [];
  const seriesByCode = new Map<string, Series>();
  const cards: Card[] = [];

  rows.forEach((row, i) => {
    if (!row.series_code || !row.number) {
      throw new Error(`checklist.csv fila ${i + 2}: faltan series_code o number`);
    }
    let s = seriesByCode.get(row.series_code);
    if (!s) {
      s = {
        id: uuidFor(`series:${meta.slug}:${row.series_code}`),
        collection_id: collectionId,
        code: row.series_code,
        name: row.series_name || row.series_code,
        kind: (row.series_kind || 'base') as SeriesKind,
        card_count: 0,
        scarcity: Number(row.scarcity || 1),
        sort_order: series.length,
        requestable: row.requestable !== 'false',
      };
      seriesByCode.set(row.series_code, s);
      series.push(s);
    }
    s.card_count += 1;

    const team = row.team ? teamByKey.get(row.team) : undefined;
    if (row.team && !team) {
      throw new Error(`checklist.csv fila ${i + 2}: equipo "${row.team}" no está en teams.csv`);
    }

    cards.push({
      id: uuidFor(`card:${meta.slug}:${row.series_code}:${row.number}`),
      collection_id: collectionId,
      series_id: s.id,
      team_id: team?.id ?? null,
      number: row.number,
      player_name: row.player_name || null,
      position: row.position || null,
      variant: row.variant || null,
      print_run: num(row.print_run),
      sort_order: i,
    });
  });

  const collection: Collection = {
    id: collectionId,
    slug: meta.slug,
    name: meta.name,
    season: meta.season,
    publisher: meta.publisher || null,
    total_cards: cards.length,
    released_at: meta.released_at ?? null,
    is_active: meta.is_active !== false,
  };

  return { collection, series, teams, cards };
}
