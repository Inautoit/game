/**
 * CSV -> public/catalog/<slug>.json
 * Es lo que la app descarga una vez y guarda en IndexedDB para funcionar sin conexión.
 *
 *   npm run catalog
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCatalog } from './checklist-source';

const catalog = readCatalog();
const dir = resolve(process.cwd(), 'public/catalog');
mkdirSync(dir, { recursive: true });

writeFileSync(resolve(dir, `${catalog.collection.slug}.json`), JSON.stringify(catalog), 'utf8');
writeFileSync(
  resolve(dir, 'index.json'),
  JSON.stringify([{ slug: catalog.collection.slug, name: catalog.collection.name, season: catalog.collection.season }]),
  'utf8',
);

console.log(
  `catálogo "${catalog.collection.slug}": ${catalog.cards.length} cartas, ` +
  `${catalog.series.length} series, ${catalog.teams.length} equipos`,
);
