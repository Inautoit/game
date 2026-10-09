// Reconocimiento automático (sin entrenar) de las formas de mano estáticas
// descritas en la guía de LSE: abecedario dactilológico, números y BIEN / MAL.
//
// Se usan dos fuentes de MediaPipe:
//  - worldLandmarks (metros, 3D): para saber si un dedo está estirado o doblado
//    y qué yemas se tocan, sin depender de la distancia a la cámara.
//  - landmarks (imagen): para saber hacia dónde apunta la mano.

const FINGERS = {
  index: [5, 6, 7, 8],
  middle: [9, 10, 11, 12],
  ring: [13, 14, 15, 16],
  pinky: [17, 18, 19, 20],
};
const THUMB = [1, 2, 3, 4];

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y, (a.z || 0) - (b.z || 0));

function chain(w, ids) {
  let len = 0;
  for (let i = 0; i < ids.length - 1; i++) len += dist(w[ids[i]], w[ids[i + 1]]);
  return len;
}

/** 1 = dedo totalmente estirado desde la muñeca; ~0,5 = cerrado en el puño. */
function reach(w, ids) {
  return dist(w[0], w[ids[3]]) / (dist(w[0], w[ids[0]]) + chain(w, ids));
}

function straightness(w, ids) {
  return dist(w[ids[0]], w[ids[ids.length - 1]]) / chain(w, ids);
}

function angleDeg(a, b) {
  const dot = a.x * b.x + a.y * b.y;
  const n = Math.hypot(a.x, a.y) * Math.hypot(b.x, b.y) || 1e-6;
  return (Math.acos(Math.max(-1, Math.min(1, dot / n))) * 180) / Math.PI;
}

/** Dirección en la imagen ('up' | 'down' | 'side') de un vector con y hacia abajo. */
function direction(v) {
  if (-v.y > Math.abs(v.x) * 0.9) return 'up';
  if (v.y > Math.abs(v.x) * 0.9) return 'down';
  return 'side';
}

/** Describe la forma de una mano: qué dedos están estirados, qué se toca, hacia dónde apunta. */
export function describeHand(img, world, aspect) {
  const w = world;
  const p = img.map((q) => ({ x: q.x * aspect, y: q.y }));
  const palm = dist(w[0], w[9]) || 1e-6;
  const rel = (a, b) => dist(w[a], w[b]) / palm;
  const vec = (a, b) => ({ x: p[b].x - p[a].x, y: p[b].y - p[a].y });

  const f = {};
  for (const [name, ids] of Object.entries(FINGERS)) {
    const r = reach(w, ids);
    f[name] = {
      reach: r,
      ext: r >= 0.86,
      curled: r < 0.72,
      dir: direction(vec(ids[0], ids[3])),
      v: vec(ids[0], ids[3]),
    };
  }

  const thumbStraight = straightness(w, THUMB);
  const thumbOut = rel(4, 5);
  const thumbAcross = Math.min(rel(4, 9), rel(4, 13)) < 0.55;
  // Pulgar apoyado sobre los dedos doblados (como en la V o el 2): no cuenta como estirado.
  const thumbOnFingers = Math.min(rel(4, 10), rel(4, 14), rel(4, 18), rel(4, 11), rel(4, 15)) < 0.45;
  const thumb = {
    straight: thumbStraight,
    out: thumbOut,
    ext: thumbStraight > 0.85 && thumbOut > 0.6 && !thumbAcross && !thumbOnFingers,
    across: thumbAcross,
    dir: direction(vec(2, 4)),
    v: vec(2, 4),
  };

  // Índice y corazón: ¿juntos, separados o cruzados?
  const knuckles = dist(w[5], w[9]) || 1e-6;
  const imSpread = dist(w[8], w[12]) / knuckles;
  const across = { x: p[17].x - p[5].x, y: p[17].y - p[5].y };
  const proj = (a, b) => (p[a].x - p[b].x) * across.x + (p[a].y - p[b].y) * across.y;
  const crossed = proj(8, 12) * proj(5, 9) < 0 && f.index.ext && f.middle.ext;

  return {
    f,
    thumb,
    rel,
    together: imSpread < 1.3,
    spread: imSpread > 1.55,
    crossed,
    handDir: direction(vec(0, 9)),
  };
}

const cnt = (h, names, key) => names.filter((n) => h.f[n][key]).length;

/** Letra del abecedario (forma estática) o null. */
export function letterFor(h) {
  const { f, thumb, rel } = h;
  const I = f.index, M = f.middle, R = f.ring, P = f.pinky;
  const restCurled = (names) => names.every((n) => !f[n].ext);

  // Cuatro dedos cerrados: A, E, BIEN/MAL
  if (cnt(h, ['index', 'middle', 'ring', 'pinky'], 'ext') === 0 &&
      cnt(h, ['index', 'middle', 'ring', 'pinky'], 'curled') >= 3) {
    if (thumb.ext && thumb.dir === 'up' && rel(4, 6) > 0.75) return 'BIEN';
    if (thumb.ext && thumb.dir === 'down') return 'MAL';
    if (thumb.across && Math.min(rel(8, 4), rel(12, 4), rel(8, 3), rel(12, 3)) < 0.45) return 'E';
    if (!thumb.across && Math.min(rel(4, 6), rel(4, 5)) < 0.75) return 'A';
    return null;
  }

  // O: yemas tocando la del pulgar
  if (!I.ext && !M.ext && rel(8, 4) < 0.35 && rel(12, 4) < 0.45) return 'O';

  // F: índice y pulgar en círculo, los otros tres estirados
  if (rel(8, 4) < 0.35 && M.ext && R.ext && P.ext) return 'F';

  // C: dedos curvados, pulgar enfrente sin tocar
  if (!I.ext && !M.ext && !I.curled && !M.curled && !R.ext &&
      rel(8, 4) > 0.4 && rel(8, 4) < 1.3 && !thumb.across) return 'C';

  // Solo el índice
  if (I.ext && restCurled(['middle', 'ring', 'pinky'])) {
    if (thumb.ext) {
      const ang = angleDeg(I.v, thumb.v);
      if (I.dir === 'up' && ang > 45) return 'L';
      if (I.dir === 'side' && ang < 40) return 'G';
      return null;
    }
    if (I.dir === 'up' && rel(4, 12) < 0.5) return 'D';
    return null;
  }

  // Solo el meñique (con o sin pulgar)
  if (P.ext && restCurled(['index', 'middle', 'ring'])) {
    if (thumb.ext) return 'Y';
    if (P.dir === 'up') return 'I';
    return null;
  }

  // Índice y corazón
  if (I.ext && M.ext && !R.ext && !P.ext) {
    if (h.crossed) return 'R';
    const thumbBetween = rel(4, 10) < 0.45 || rel(4, 6) < 0.4;
    if (thumbBetween && h.spread) return I.dir === 'down' ? 'P' : I.dir === 'up' ? 'K' : null;
    if (I.dir === 'down' && M.dir === 'down') return 'N';
    if (h.together && I.dir === 'up') return 'U';
    if (h.together && I.dir === 'side') return 'H';
    if (h.spread && I.dir === 'up') return 'V';
    return null;
  }

  // Índice, corazón y anular
  if (I.ext && M.ext && R.ext && !P.ext) {
    if (I.dir === 'down' && M.dir === 'down' && R.dir === 'down') return 'M';
    if (I.dir === 'up' && h.spread) return 'W';
    return null;
  }

  // Cuatro dedos estirados y juntos, pulgar recogido
  if (I.ext && M.ext && R.ext && P.ext && !thumb.ext && h.together && I.dir === 'up') return 'B';

  return null;
}

/** Número de dedos levantados de una mano (0 = forma O). */
export function countFor(h) {
  const { f, thumb, rel } = h;
  if (!f.index.ext && !f.middle.ext && rel(8, 4) < 0.35 && rel(12, 4) < 0.45) return 0;
  const n = cnt(h, ['index', 'middle', 'ring', 'pinky'], 'ext') + (thumb.ext ? 1 : 0);
  if (n === 1 && !f.index.ext) return null; // un solo dedo que no es el índice
  return n === 0 ? null : n;
}

/**
 * @param {'letters'|'numbers'} mode
 * @returns {string|null}
 */
export function recognize(hands, worlds, aspect, mode) {
  if (!hands?.length || !worlds?.length) return null;
  const desc = hands.slice(0, 2).map((lm, i) => describeHand(lm, worlds[i], aspect));

  if (mode === 'numbers') {
    if (desc.length === 1) {
      const n = countFor(desc[0]);
      return n === null ? null : String(n);
    }
    const [a, b] = desc.map(countFor);
    if (a === null || b === null) return null;
    if (a === 5 && b === 5) return '10';
    if (a === 5 && b >= 1 && b <= 4) return String(5 + b);
    if (b === 5 && a >= 1 && a <= 4) return String(5 + a);
    return null;
  }

  return desc.length === 1 ? letterFor(desc[0]) : null;
}

/** Letras de la guía que son una forma estática + un movimiento. */
export const MOTION_VARIANTS = { C: 'CH', L: 'LL', N: 'Ñ', R: 'RR', I: 'J' };

/** Letras y números que el modo automático puede reconocer. */
export const AUTO_LABELS = new Set([
  'A', 'B', 'C', 'CH', 'D', 'E', 'F', 'G', 'H', 'I', 'J', 'K', 'L', 'LL', 'M', 'N', 'Ñ',
  'O', 'P', 'R', 'RR', 'U', 'V', 'W', 'Y', 'BIEN', 'MAL',
  '0', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10',
]);
