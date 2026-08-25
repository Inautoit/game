/**
 * Genera el esqueleto de data/checklist.csv: estructura completa de la coleccion
 * (series, equipos, numeracion) con player_name vacio para que lo rellenes a mano.
 *
 * Es un ayudante de arranque, no la fuente de verdad. La fuente de verdad es el CSV:
 * una vez generado, editalo y no vuelvas a ejecutar esto (sobreescribe el fichero).
 *
 *   npx tsx scripts/generate-checklist.ts
 */
import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.cwd(), 'data/checklist.csv');

const TEAMS = [
  'Alaves', 'Athletic Club', 'Atletico de Madrid', 'Barcelona', 'Celta de Vigo',
  'Elche', 'Espanyol', 'Getafe', 'Girona', 'Levante',
  'Mallorca', 'Osasuna', 'Rayo Vallecano', 'Real Betis', 'Real Madrid',
  'Real Oviedo', 'Real Sociedad', 'Sevilla', 'Valencia', 'Villarreal',
];

// 1 carta de equipo + 18 jugadores por club
const POSITIONS = ['', 'POR', 'POR', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF', 'DEF',
  'MED', 'MED', 'MED', 'MED', 'MED', 'MED', 'DEL', 'DEL', 'DEL', 'DEL'];

type Row = {
  series_code: string; series_name: string; series_kind: string; number: string;
  player_name: string; team: string; position: string; variant: string;
  print_run: string; scarcity: string; requestable: string;
};

const rows: Row[] = [];
const push = (r: Partial<Row>) => rows.push({
  series_code: '', series_name: '', series_kind: 'base', number: '', player_name: '',
  team: '', position: '', variant: '', print_run: '', scarcity: '1', requestable: 'true',
  ...r,
} as Row);

// --- Serie base: numeracion corrida por equipos
let n = 0;
for (const team of TEAMS) {
  for (let i = 0; i < POSITIONS.length; i++) {
    n += 1;
    push({
      series_code: 'BASE', series_name: 'Base', series_kind: 'base',
      number: String(n), team, position: POSITIONS[i], scarcity: '1', requestable: 'true',
    });
    // Ejemplo real de numeracion no entera: existen cartas '200bis'
    if (n === 200) {
      push({
        series_code: 'BASE', series_name: 'Base', series_kind: 'base',
        number: '200bis', team, position: POSITIONS[i], scarcity: '1', requestable: 'true',
      });
    }
  }
}

// --- Inserts y paralelas
for (let i = 1; i <= 30; i++) {
  push({
    series_code: 'MOM', series_name: 'Momentos', series_kind: 'insert',
    number: `MOM${i}`, team: TEAMS[(i - 1) % TEAMS.length], scarcity: '2', requestable: 'true',
  });
}
for (let i = 1; i <= 20; i++) {
  push({
    series_code: 'MVP', series_name: 'MVP', series_kind: 'insert',
    number: `MVP${i}`, team: TEAMS[i - 1], scarcity: '2', requestable: 'true',
  });
}
for (let i = 1; i <= 20; i++) {
  push({
    series_code: 'ELITE', series_name: 'Elite', series_kind: 'insert',
    number: `E${i}`, team: TEAMS[i - 1], scarcity: '3', requestable: 'false',
  });
}
for (let i = 1; i <= 40; i++) {
  push({
    series_code: 'GOLD', series_name: 'Gold', series_kind: 'parallel',
    number: `G${i}`, team: TEAMS[(i - 1) % TEAMS.length], variant: 'gold',
    print_run: '100', scarcity: '4', requestable: 'false',
  });
}
for (let i = 1; i <= 10; i++) {
  push({
    series_code: 'LEG', series_name: 'Leyendas', series_kind: 'limited',
    number: `LE${i}`, team: TEAMS[(i * 3) % TEAMS.length], print_run: '500',
    scarcity: '4', requestable: 'false',
  });
}
for (let i = 1; i <= 12; i++) {
  push({
    series_code: 'AUTO', series_name: 'Autografos', series_kind: 'autograph',
    number: `A${i}`, team: TEAMS[(i * 5) % TEAMS.length], print_run: '25',
    scarcity: '5', requestable: 'false',
  });
}

const header = ['series_code', 'series_name', 'series_kind', 'number', 'player_name',
  'team', 'position', 'variant', 'print_run', 'scarcity', 'requestable'] as const;

const csv = [header.join(',')]
  .concat(rows.map((r) => header.map((h) => r[h]).join(',')))
  .join('\n') + '\n';

if (existsSync(OUT) && !process.argv.includes('--force')) {
  console.error(`${OUT} ya existe. Usa --force si de verdad quieres sobreescribirlo.`);
  process.exit(1);
}
writeFileSync(OUT, csv, 'utf8');
console.log(`${rows.length} cartas -> data/checklist.csv`);
