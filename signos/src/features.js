// Convierte los 21 puntos de cada mano (MediaPipe) en un vector comparable,
// independiente de dónde esté la mano en la imagen y de lo cerca que esté.

const WRIST = 0;
const MIDDLE_MCP = 9;
const Z_WEIGHT = 0.5; // la profundidad de MediaPipe es más ruidosa que x/y

function toPoints(landmarks, aspect, mirror) {
  return landmarks.map((p) => ({
    x: (mirror ? 1 - p.x : p.x) * aspect,
    y: p.y,
    z: p.z * aspect * Z_WEIGHT,
  }));
}

function handScale(pts) {
  const w = pts[WRIST];
  const m = pts[MIDDLE_MCP];
  return Math.hypot(m.x - w.x, m.y - w.y, m.z - w.z) || 1e-6;
}

function pushHand(out, pts) {
  const w = pts[WRIST];
  const s = handScale(pts);
  for (const p of pts) out.push((p.x - w.x) / s, (p.y - w.y) / s, (p.z - w.z) / s);
  return s;
}

/**
 * @param {Array<Array<{x:number,y:number,z:number}>>} hands  manos detectadas
 * @param {number} aspect  ancho/alto del vídeo
 * @param {boolean} mirror invierte izquierda/derecha (para personas zurdas)
 * @returns {{hands:number, v:number[]}|null}
 */
export function extractFeatures(hands, aspect, mirror = false) {
  if (!hands || hands.length === 0) return null;
  const list = hands.slice(0, 2).map((h) => toPoints(h, aspect, mirror));
  // Con dos manos, el orden es siempre de izquierda a derecha en la imagen.
  list.sort((a, b) => a[WRIST].x - b[WRIST].x);

  const v = [];
  const s1 = pushHand(v, list[0]);
  if (list.length === 2) {
    pushHand(v, list[1]);
    const a = list[0][WRIST];
    const b = list[1][WRIST];
    v.push((b.x - a.x) / s1, (b.y - a.y) / s1, (b.z - a.z) / s1);
  }
  return { hands: list.length, v };
}

/** Distancia media por punto entre dos vectores de la misma longitud. */
export function distance(a, b) {
  let sum = 0;
  for (let i = 0; i < a.length; i += 3) {
    const dx = a[i] - b[i];
    const dy = a[i + 1] - b[i + 1];
    const dz = a[i + 2] - b[i + 2];
    sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  return sum / (a.length / 3);
}
