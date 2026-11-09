// Crear circuito con IA: una descripción en texto («largo, rápido, con una horquilla y un puente»)
// se convierte en una ficha (spec) y el generador monta el trazado con piezas del editor.
// La ficha la saca Claude en el servidor (/api/ai/track) o, si no hay IA, el intérprete local de abajo.
// El generador prueba muchos trazados al azar y se queda con el que mejor cumple la ficha;
// todos pasan por autoClose/validateTrack, así que siempre salen cerrados y jugables.
import { autoClose, EDITOR } from './tracks.js';

const ST = 0.35 / 0.126;                     // recta estándar (35 cm) en unidades
const M = 0.126;                             // metros por unidad
export const AI_RADIUS = { cerrada: 2.8, media: 3.8, abierta: 5.2 };   // = radiusOf() con 4 carriles

// ---------- Ficha ----------
export const SPEC_DEFAULT = { name: '', lengthM: 22, style: 'mixto', curves: 'medias', hairpins: 0, chicanes: 0, longStraights: 0, bridge: false, scenery: 'verde', laps: 5, direction: 'mixto' };
const clampI = (v, a, b, d) => (Number.isFinite(+v) ? Math.max(a, Math.min(b, Math.round(+v))) : d);
const pick = (v, list, d) => (list.includes(v) ? v : d);
export function normSpec(s = {}) {
  return {
    name: String(s.name || '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 28),
    lengthM: clampI(s.lengthM, 8, 55, 22),
    style: pick(s.style, ['rapido', 'tecnico', 'mixto'], 'mixto'),
    curves: pick(s.curves, ['abiertas', 'medias', 'cerradas'], 'medias'),
    hairpins: clampI(s.hairpins, 0, 3, 0),
    chicanes: clampI(s.chicanes, 0, 3, 0),
    longStraights: clampI(s.longStraights, 0, 3, 0),
    bridge: !!s.bridge,
    scenery: pick(s.scenery, EDITOR.scenery, 'verde'),
    laps: clampI(s.laps, 1, 20, 5),
    direction: pick(s.direction, ['izquierda', 'derecha', 'mixto'], 'mixto'),
  };
}

// ---------- Intérprete local (sin IA): palabras clave en español ----------
const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, doce: 12, quince: 15, veinte: 20 };
const numBefore = (t, re) => {
  const m = t.match(new RegExp(`(\\d+|${Object.keys(NUM).join('|')})\\s+(?:\\w+\\s+)?${re}`));
  return m ? (/^\d+$/.test(m[1]) ? +m[1] : NUM[m[1]]) : null;
};
const NAMES = ['Circuito del Valle', 'Anillo del Norte', 'Circuito de la Sierra', 'Pista del Faro', 'Circuito Real', 'Gran Anillo', 'Circuito del Puerto', 'Pista de la Colina', 'Circuito del Lago', 'Anillo Dorado'];
export function parsePrompt(text) {
  const t = ` ${String(text || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')} `;
  const s = { ...SPEC_DEFAULT };
  // Largo
  const m = t.match(/(\d+(?:[.,]\d+)?)\s*(m\b|metros)/);
  if (m) s.lengthM = parseFloat(m[1].replace(',', '.'));
  else if (/muy larg|enorme|gigante|kilometr|interminable/.test(t)) s.lengthM = 50;
  else if (/\blarg/.test(t)) s.lengthM = 38;
  else if (/muy corto|minusculo|diminuto/.test(t)) s.lengthM = 9;
  else if (/\bcort|pequen|mini/.test(t)) s.lengthM = 13;
  else if (/median|normal/.test(t)) s.lengthM = 22;
  // Carácter
  if (/rapid|veloz|velocidad|curvas abiertas|ovalo|fluid/.test(t)) { s.style = 'rapido'; s.curves = 'abiertas'; }
  if (/tecnic|lent|revirad|curvas cerradas|muchas curvas|enrevesad|dificil|complicad|ratoner|sinuos/.test(t)) { s.style = 'tecnico'; s.curves = 'cerradas'; }
  if (/curvas medias|equilibrad|mixto/.test(t)) { s.style = 'mixto'; s.curves = 'medias'; }
  // Elementos
  if (/horquilla|curva de 180|180 grados|herradura/.test(t)) s.hairpins = numBefore(t, 'horquillas?') || (/horquillas/.test(t) ? 2 : 1);
  if (/chicane|eses|zig ?zag|\bese\b/.test(t)) s.chicanes = numBefore(t, '(?:chicanes?|eses)') || (/chicanes|eses/.test(t) ? 2 : 1);
  if (/recta/.test(t) && /larg|enorme|gran|kilometr|infinit|interminable/.test(t)) s.longStraights = numBefore(t, 'rectas?') || (/rectas/.test(t) ? 2 : 1);
  if (/puente|cruce|cruza|en ocho|forma de ocho|\b8\b|elevad|paso superior|viaducto/.test(t)) s.bridge = true;
  if (/sin puente/.test(t)) s.bridge = false;
  // Escenario
  if (/noche|nocturn|oscur|luces/.test(t)) s.scenery = 'noche';
  else if (/arena|desierto|playa|dunas|seco/.test(t)) s.scenery = 'arena';
  else if (/verde|hierba|cesped|bosque|campo|montan/.test(t)) s.scenery = 'verde';
  // Vueltas y sentido
  const v = t.match(/(\d+|\w+)\s+vueltas/);
  if (v) s.laps = /^\d+$/.test(v[1]) ? +v[1] : NUM[v[1]] || s.laps;
  if (/izquierda|antihorari/.test(t)) s.direction = 'izquierda';
  else if (/derecha|horari/.test(t)) s.direction = 'derecha';
  // Nombre: «llamado X», «que se llame X», «nombre X»
  const n = String(text || '').match(/(?:llamad[oa]|se llame|nombre(?: de)?|ll[aá]malo)\s+[«"']?([^«»"',.]{2,28})/i);
  s.name = n ? n[1].trim() : NAMES[Math.floor(Math.random() * NAMES.length)];
  return normSpec(s);
}

// ---------- Generador ----------
function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const curveLen = (deg, r) => (Math.abs(deg) * Math.PI / 180) * r;

// Un tramo con giro neto «net» grados: curvas, rectas (huecos que luego se rellenan) y los elementos pedidos
function buildLoop(spec, R, net, feats, rand, h) {
  const sgn = Math.sign(net) || 1;
  const rMain = spec.curves === 'abiertas' ? AI_RADIUS.abierta : spec.curves === 'cerradas' ? AI_RADIUS.cerrada : AI_RADIUS.media;
  const rOf = () => (rand() < 0.7 ? rMain : [AI_RADIUS.cerrada, AI_RADIUS.media, AI_RADIUS.abierta][Math.floor(rand() * 3)]);
  const out = [];   // piezas; las rectas de relleno son { gap: peso }
  let turn = 0;
  const C = (deg, r) => { out.push(['C', deg, r]); turn += deg; };
  const gap = (w) => out.push({ gap: w });
  const items = feats.slice();
  // Curvas «de relleno» hasta completar el giro: más curvas y más cortas si es técnico
  const nCorners = Math.max(2, Math.round((spec.style === 'tecnico' ? 7 : spec.style === 'rapido' ? 3 : 5) * (Math.abs(net) / 360) * (0.7 + spec.lengthM / 40)));
  for (let i = 0; i < nCorners; i++) items.push('c');
  for (let i = items.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [items[i], items[j]] = [items[j], items[i]]; }
  gap(1);
  for (const it of items) {
    const left = net - turn;   // lo que falta girar
    if (it === 'H') {           // horquilla: 180° cerrada entre dos rectas
      const d = Math.abs(left) >= 180 || rand() < 0.4 ? sgn : -sgn;
      gap(0.6); C(180 * d, AI_RADIUS.cerrada); gap(0.6);
    } else if (it === 'X') {    // chicane: izquierda-derecha-izquierda
      const d = rand() < 0.5 ? 1 : -1, r = spec.curves === 'abiertas' ? AI_RADIUS.media : AI_RADIUS.cerrada;
      gap(0.3); C(45 * d, r); C(-90 * d, r); C(45 * d, r); gap(0.3);
    } else if (it === 'L') {
      out.push(['S', ST * (6 + Math.floor(rand() * 5))]);
    } else {
      // Curva normal, casi siempre hacia donde falta girar; a veces una contracurva para darle vida
      const q = rand();
      const ang = spec.style === 'rapido' ? (q < 0.55 ? 90 : q < 0.8 ? 135 : 45) : spec.style === 'tecnico' ? (q < 0.6 ? 90 : 45) : (q < 0.45 ? 45 : q < 0.9 ? 90 : 135);
      const counter = rand() < (spec.style === 'tecnico' ? 0.35 : spec.style === 'rapido' ? 0.18 : 0.22);
      let d = counter ? -sgn : sgn;
      if (Math.abs(left) < ang && !counter) d = 0;
      // Las curvas rápidas son una sola pieza ancha (nada de octógonos de 45° sueltos)
      if (d) C(ang * d, spec.style === 'rapido' && d === sgn ? Math.max(rOf(), AI_RADIUS.media) : rOf());
      gap(spec.style === 'rapido' ? 1.4 : 0.8);
    }
  }
  // Completa el giro que falta en trozos de 45/90
  let rest = net - turn;
  while (Math.abs(rest) > 0.5) { const a = Math.sign(rest) * (Math.abs(rest) >= 90 ? 90 : 45); C(a, rOf()); gap(0.7); rest -= a; }
  return out;
}

// Rellena los huecos con rectas para acercarse al largo pedido
function fillGaps(parts, budget, rand) {
  let used = 0, wsum = 0;
  for (const p of parts) {
    if (p.gap) wsum += p.gap;
    else used += p[0] === 'C' ? curveLen(p[1], p[2]) : p[1];
  }
  const free = Math.max(0, budget - used);
  const out = [];
  for (const p of parts) {
    if (p.gap) {
      const n = Math.round((free * p.gap * (0.5 + rand())) / Math.max(1e-6, wsum) / ST);
      if (n > 0) out.push(['S', ST * Math.min(n, 12)]);
    } else out.push(p);
  }
  return out;
}

function attempt(spec, seed) {
  const rand = rng(seed);
  const target = spec.lengthM / M;
  const R = radiusFor(spec);
  const feats = [];
  for (let i = 0; i < spec.hairpins; i++) feats.push('H');
  for (let i = 0; i < spec.chicanes; i++) feats.push('X');
  for (let i = 0; i < spec.longStraights; i++) feats.push('L');
  const dir = spec.direction === 'izquierda' ? -1 : spec.direction === 'derecha' ? 1 : (rand() < 0.5 ? -1 : 1);
  let pieces;
  if (!spec.bridge) {
    pieces = fillGaps(buildLoop(spec, R, 360 * dir, feats, rand), target * 0.9, rand);
  } else {
    // En forma de ocho: [recta en el suelo][rampa arriba][lazo A, en alto][recta en alto que cruza][rampa abajo][lazo B]
    const fa = feats.filter((_, i) => i % 2 === 0), fb = feats.filter((_, i) => i % 2 === 1);
    const ang = 270;
    const loopBudget = (target - 2 * EDITOR.ramp) * 0.42;
    const A = fillGaps(buildLoop(spec, R, ang * dir, fa, rand), loopBudget, rand);
    const B = fillGaps(buildLoop(spec, R, -ang * dir, fb, rand), loopBudget, rand);
    const lead = ST * (3 + Math.floor(rand() * 3)), cross = ST * (4 + Math.floor(rand() * 3));
    pieces = [['S', lead], ['S', EDITOR.ramp, EDITOR.bridge], ...A, ['S', cross], ['S', EDITOR.ramp, 0], ...B];
  }
  if (pieces.length > EDITOR.maxPieces - 8) return null;
  const closed = autoClose(pieces, 4, R);
  if (closed.error) return null;
  // Nota: menos es mejor (largo parecido al pedido y poco relleno automático)
  const L = closed.length;
  const score = Math.abs(L - spec.lengthM) / spec.lengthM + closed.added * M / Math.max(4, spec.lengthM) * 0.6;
  return { pieces, closed, length: L, score };
}

export const radiusFor = (spec) => (spec.curves === 'abiertas' ? AI_RADIUS.abierta : spec.curves === 'cerradas' ? AI_RADIUS.cerrada : AI_RADIUS.media);
export const radiusKey = (spec) => (spec.curves === 'abiertas' ? 'abierta' : spec.curves === 'cerradas' ? 'cerrada' : 'media');

// Busca durante «ms» milisegundos (cediendo el hilo para no congelar la pantalla) y devuelve el mejor trazado
export async function generateTrack(specIn, { ms = 1800, seed = (Math.random() * 2 ** 31) | 0, onProgress } = {}) {
  const spec = normSpec(specIn);
  const t0 = performance.now();
  let best = null, tries = 0, ok = 0;
  let relaxed = spec;
  while (performance.now() - t0 < ms || !best) {
    const r = attempt(relaxed, seed + tries++);
    if (r) { ok++; if (!best || r.score < best.score) best = r; }
    if (tries % 4 === 0) { if (onProgress) onProgress(tries, best); await new Promise((res) => setTimeout(res, 0)); }
    // Si no sale nada, se relaja la ficha poco a poco (menos elementos, sin puente…)
    if (!best && tries === 120) relaxed = { ...relaxed, chicanes: Math.min(1, relaxed.chicanes), hairpins: Math.min(1, relaxed.hairpins) };
    if (!best && tries === 240) relaxed = { ...relaxed, bridge: false };
    if (!best && tries > 400) break;
    if (best && best.score < 0.06 && ok > 6) break;
  }
  return best ? { spec, pieces: best.pieces, length: best.length, bridge: relaxed.bridge, tries } : null;
}
