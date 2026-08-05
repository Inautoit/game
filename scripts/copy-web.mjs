// Ensambla la carpeta `www/` con solo los archivos de la app web.
// Capacitor empaqueta `www/` dentro de las apps de Android e iOS.
// Uso: node scripts/copy-web.mjs  (o: npm run build)
import { cp, rm, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const www = join(root, 'www');

// Archivos y carpetas que forman la app web.
const ITEMS = [
  'index.html',
  'styles.css',
  'src',
  'vendor',
  'manifest.webmanifest',
  'sw.js',
  'icons',
];

await rm(www, { recursive: true, force: true });
await mkdir(www, { recursive: true });

for (const item of ITEMS) {
  const from = join(root, item);
  if (!existsSync(from)) {
    console.warn('⚠️  falta (se omite):', item);
    continue;
  }
  await cp(from, join(www, item), { recursive: true });
}

console.log('✅ www/ generada');
