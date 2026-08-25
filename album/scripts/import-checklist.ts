/**
 * CSV -> Supabase. Idempotente: puedes ejecutarlo mil veces sin duplicar nada,
 * porque los ids son deterministas (uuid v5 sobre slug + serie + número).
 *
 *   SUPABASE_SERVICE_ROLE_KEY=... npm run import:checklist
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
import { readCatalog } from './checklist-source';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL y SUPABASE_SERVICE_ROLE_KEY (ver .env.example).');
  process.exit(1);
}

const db = createClient(url, key, { auth: { persistSession: false } });
const catalog = readCatalog();

async function upsert(table: string, rows: unknown[], onConflict = 'id') {
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const { error } = await db.from(table).upsert(chunk as never, { onConflict });
    if (error) throw new Error(`${table}: ${error.message}`);
  }
  console.log(`${table}: ${rows.length} filas`);
}

async function main() {
  await upsert('collections', [catalog.collection]);
  await upsert('series', catalog.series);
  await upsert('teams', catalog.teams);
  await upsert('cards', catalog.cards);

  // Cartas que ya no están en el CSV (correcciones de numeración): se retiran.
  const ids = new Set(catalog.cards.map((c) => c.id));
  const { data: existing, error } = await db
    .from('cards').select('id').eq('collection_id', catalog.collection.id);
  if (error) throw new Error(`cards (limpieza): ${error.message}`);

  const stale = (existing ?? []).map((r) => r.id as string).filter((id) => !ids.has(id));
  if (stale.length) {
    const { error: delErr } = await db.from('cards').delete().in('id', stale);
    if (delErr) throw new Error(`cards (borrado): ${delErr.message}`);
    console.log(`cards: ${stale.length} obsoletas eliminadas`);
  }

  console.log('Importación completada.');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
