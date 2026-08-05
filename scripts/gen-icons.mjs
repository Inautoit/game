// Genera iconos y splash de la app renderizando un SVG con Chromium.
// Marca: llanta de aleación de 5 radios en turquesa sobre fondo oscuro.
// Uso: node scripts/gen-icons.mjs
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'icons');
const assetsDir = join(root, 'assets');
await mkdir(iconsDir, { recursive: true });
await mkdir(assetsDir, { recursive: true });

// Marca de la llanta (viewBox 0 0 512 512), centrada en 256,256.
function rim(scale = 1) {
  const cx = 256, cy = 256;
  const spokes = [];
  for (let i = 0; i < 5; i++) {
    const a = (i * 72) - 90;
    spokes.push(`<g transform="rotate(${a} ${cx} ${cy})">
      <path d="M ${cx} ${cy} L ${cx - 26} ${cy - 168} Q ${cx} ${cy - 190} ${cx + 26} ${cy - 168} Z"
        fill="url(#gspoke)"/></g>`);
  }
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(${-cx} ${-cy})">
    <circle cx="${cx}" cy="${cy}" r="196" fill="none" stroke="#0b1220" stroke-width="52"/>
    <circle cx="${cx}" cy="${cy}" r="196" fill="none" stroke="#1b2740" stroke-width="6"/>
    <circle cx="${cx}" cy="${cy}" r="162" fill="#0d1524" stroke="url(#glip)" stroke-width="12"/>
    ${spokes.join('')}
    <circle cx="${cx}" cy="${cy}" r="40" fill="url(#ghub)"/>
    <circle cx="${cx}" cy="${cy}" r="40" fill="none" stroke="#0b1220" stroke-width="6"/>
  </g>`;
}

const DEFS = `<defs>
  <linearGradient id="gbg" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#141f38"/><stop offset="1" stop-color="#0a0f1d"/>
  </linearGradient>
  <linearGradient id="glip" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#7ff0d8"/><stop offset="1" stop-color="#22c3a6"/>
  </linearGradient>
  <linearGradient id="gspoke" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5fe8cd"/><stop offset="1" stop-color="#2bb59a"/>
  </linearGradient>
  <radialGradient id="ghub" cx="0.5" cy="0.4" r="0.6">
    <stop offset="0" stop-color="#8ff5e0"/><stop offset="1" stop-color="#2bb59a"/>
  </radialGradient>
  <filter id="glow" x="-40%" y="-40%" width="180%" height="180%">
    <feGaussianBlur stdDeviation="16" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
</defs>`;

function svgIcon({ bg = true, scale = 0.72 }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
    ${DEFS}
    ${bg ? '<rect width="512" height="512" fill="url(#gbg)"/>' : ''}
    <g filter="url(#glow)">${rim(scale)}</g>
  </svg>`;
}

function svgSplash() {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="1200" viewBox="0 0 1200 1200">
    ${DEFS}
    <rect width="1200" height="1200" fill="#060811"/>
    <g transform="translate(344 300)"><g filter="url(#glow)">${rim(0.9)}</g></g>
    <text x="600" y="960" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif"
      font-size="90" font-weight="800" fill="#eaf2ff" letter-spacing="2">GARAJE 3D</text>
    <text x="600" y="1020" text-anchor="middle" font-family="system-ui,Segoe UI,Roboto,sans-serif"
      font-size="34" font-weight="600" fill="#47e0c0" letter-spacing="8">TUNING STUDIO</text>
  </svg>`;
}

async function render(page, svg, size, out) {
  const html = `<!doctype html><meta charset="utf-8"><style>*{margin:0;padding:0}html,body{background:transparent}</style>${svg}`;
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(html, { waitUntil: 'load' });
  const el = await page.$('svg');
  await el.evaluate((n, s) => { n.setAttribute('width', s); n.setAttribute('height', s); }, size);
  await page.screenshot({ path: out, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
  console.log('•', out.split('/').pop());
}

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage();

// PWA / web
await render(page, svgIcon({ bg: true, scale: 0.72 }), 192, join(iconsDir, 'icon-192.png'));
await render(page, svgIcon({ bg: true, scale: 0.72 }), 512, join(iconsDir, 'icon-512.png'));
await render(page, svgIcon({ bg: true, scale: 0.58 }), 192, join(iconsDir, 'icon-maskable-192.png'));
await render(page, svgIcon({ bg: true, scale: 0.58 }), 512, join(iconsDir, 'icon-maskable-512.png'));
await render(page, svgIcon({ bg: true, scale: 0.72 }), 180, join(iconsDir, 'apple-touch-icon.png'));

// Fuentes para @capacitor/assets (iconos/splash nativos)
await render(page, svgIcon({ bg: true, scale: 0.72 }), 1024, join(assetsDir, 'icon.png'));
await render(page, svgIcon({ bg: true, scale: 0.58 }), 1024, join(assetsDir, 'icon-foreground.png'));
await render(page, svgIcon({ bg: false, scale: 0.001 }), 1024, join(assetsDir, 'icon-background.png'));

// Splash (@capacitor/assets escala a los tamaños de cada dispositivo)
const splashPage = await browser.newPage();
await splashPage.setViewportSize({ width: 2732, height: 2732 });
await splashPage.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0}html,body{background:#060811}</style>${svgSplash().replace('width="1200" height="1200"', 'width="2732" height="2732"')}`, { waitUntil: 'load' });
await splashPage.screenshot({ path: join(assetsDir, 'splash.png'), clip: { x: 0, y: 0, width: 2732, height: 2732 } });
await splashPage.setContent(`<!doctype html><meta charset="utf-8"><style>*{margin:0}html,body{background:#060811}</style>${svgSplash().replace('width="1200" height="1200"', 'width="2732" height="2732"')}`, { waitUntil: 'load' });
await splashPage.screenshot({ path: join(assetsDir, 'splash-dark.png'), clip: { x: 0, y: 0, width: 2732, height: 2732 } });
console.log('• splash.png / splash-dark.png');

await browser.close();
console.log('✅ iconos y splash generados');
