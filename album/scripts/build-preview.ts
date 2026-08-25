/**
 * Genera la vista previa de una sola página: preview/template.html con el
 * catálogo real incrustado dentro.
 *
 * Es una vista previa, no la app: sirve para enseñar el álbum a alguien en un
 * enlace, sin instalar nada. La app de verdad es el proyecto Next de al lado.
 *
 *   npm run preview:build
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { readCatalog } from './checklist-source';

const catalog = readCatalog();

const teamIndex = new Map(catalog.teams.map((t, i) => [t.id, i]));
const seriesIndex = new Map(catalog.series.map((s, i) => [s.id, i]));

// El catálogo va compacto: sin uuids ni ids de colección, que aquí no sirven
// para nada y multiplican por cuatro el peso de la página.
const compact = {
  collection: { name: catalog.collection.name, season: catalog.collection.season },
  teams: catalog.teams.map((t) => ({ name: t.name, slug: t.slug, color: t.primary_color })),
  series: catalog.series.map((s) => ({
    code: s.code, name: s.name, kind: s.kind,
    scarcity: s.scarcity, requestable: s.requestable,
  })),
  cards: catalog.cards.map((c) => ({
    number: c.number,
    s: seriesIndex.get(c.series_id) ?? 0,
    t: c.team_id ? teamIndex.get(c.team_id) ?? -1 : -1,
    ...(c.player_name ? { player: c.player_name } : {}),
    ...(c.position ? { pos: c.position } : {}),
    ...(c.print_run ? { run: c.print_run } : {}),
  })),
};

const template = readFileSync(resolve(process.cwd(), 'preview/template.html'), 'utf8');
const json = JSON.stringify(compact);

if (json.includes('</script')) throw new Error('El catálogo contiene "</script": habría que escaparlo');
if (!template.includes('/*__CATALOG__*/')) throw new Error('La plantilla no tiene el hueco /*__CATALOG__*/');

const out = resolve(process.cwd(), 'preview/index.html');
writeFileSync(out, template.replace('/*__CATALOG__*/', json), 'utf8');

console.log(`vista previa -> preview/index.html (${Math.round(json.length / 1024)} kB de catálogo, ` +
  `${compact.cards.length} cartas)`);
