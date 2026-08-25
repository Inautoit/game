/**
 * Genera los iconos de la PWA sin dependencias de imagen: un archivador con una
 * carta dentro, dibujado a base de rectángulos y escrito como PNG a mano.
 *
 *   npx tsx scripts/make-icons.ts
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type RGB = [number, number, number];

const LEATHER: RGB = [0x0b, 0x1a, 0x15];
const SHEET: RGB = [0x16, 0x30, 0x2a];
const EDGE: RGB = [0x24, 0x47, 0x3e];
const GOLD: RGB = [0xc9, 0xa2, 0x27];
const CREAM: RGB = [0xec, 0xf1, 0xee];

function crc32(buf: Buffer): number {
  let c = ~0;
  for (const byte of buf) {
    c ^= byte;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function png(size: number, pixels: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;   // bits por canal
  ihdr[9] = 2;   // color RGB
  const raw = Buffer.alloc(size * (size * 3 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 3 + 1)] = 0; // filtro none
    Buffer.from(pixels.subarray(y * size * 3, (y + 1) * size * 3))
      .copy(raw, y * (size * 3 + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size: number): Buffer {
  const px = new Uint8Array(size * size * 3);
  const set = (x: number, y: number, [r, g, b]: RGB) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 3;
    px[i] = r; px[i + 1] = g; px[i + 2] = b;
  };
  const rect = (x0: number, y0: number, w: number, h: number, color: RGB) => {
    for (let y = Math.round(y0); y < Math.round(y0 + h); y++) {
      for (let x = Math.round(x0); x < Math.round(x0 + w); x++) set(x, y, color);
    }
  };

  rect(0, 0, size, size, LEATHER);

  // La carta, con la proporción real 63 × 88
  const cardH = size * 0.68;
  const cardW = cardH * (63 / 88);
  const x = (size - cardW) / 2;
  const y = (size - cardH) / 2;

  rect(x - size * 0.012, y - size * 0.012, cardW + size * 0.024, cardH + size * 0.024, EDGE);
  rect(x, y, cardW, cardH, SHEET);
  rect(x, y, cardW * 0.13, cardH, GOLD);                       // banda del equipo
  rect(x + cardW * 0.28, y + cardH * 0.18, cardW * 0.5, cardH * 0.32, CREAM); // el número
  rect(x + cardW * 0.28, y + cardH * 0.68, cardW * 0.56, cardH * 0.06, EDGE);
  rect(x + cardW * 0.28, y + cardH * 0.78, cardW * 0.38, cardH * 0.05, EDGE);

  return png(size, px);
}

const dir = resolve(process.cwd(), 'public/icons');
mkdirSync(dir, { recursive: true });
for (const size of [192, 512, 180]) {
  writeFileSync(resolve(dir, `icon-${size}.png`), icon(size));
}
console.log('iconos -> public/icons/');
