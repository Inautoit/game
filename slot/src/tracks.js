// Circuitos de Turbo Slot, definidos por piezas como una pista real.
// ['S', largo, altura?]            recta
// ['C', grados, radio, altura?]    curva (grados > 0 = izquierda)
// Un largo null es una recta "libre": el programa calcula su largo para que el circuito cierre.
// La altura (opcional) es la del final de la pieza; sirve para puentes.

export const TRACKS = [
  {
    id: 'ovalo', name: 'Óvalo', lanes: 4, laps: 8, scenery: 'verde',
    pieces: [['S', 6], ['C', 180, 2.4], ['S', 6], ['C', 180, 2.4]],
  },
  {
    id: 'rinon', name: 'Riñón', lanes: 4, laps: 6, scenery: 'verde',
    pieces: [['S', null], ['C', 90, 2.2], ['S', 2], ['C', 90, 2.2], ['S', 3], ['C', 45, 2.2], ['C', -90, 2.6], ['C', 45, 2.2], ['S', 1], ['C', 90, 2.2], ['S', null], ['C', 90, 2.2]],
  },
  {
    id: 'ocho', name: 'El Ocho', lanes: 4, laps: 6, scenery: 'noche',
    pieces: [['S', 2.5, 0], ['C', 270, 2.6, 0.95], ['S', null, 0.95], ['C', -270, 2.6, 0], ['S', null, 0]],
  },
  {
    id: 'horquilla', name: 'La Horquilla', lanes: 4, laps: 5, scenery: 'arena',
    pieces: [['S', null], ['C', 90, 2.6], ['S', 5.6], ['C', 90, 2.6], ['S', 2], ['C', 90, 2.0], ['S', 2.5], ['C', -180, 2.1], ['S', 2.5], ['C', 90, 2.0], ['S', 2], ['C', 90, 2.6], ['S', null], ['C', 90, 2.6]],
  },
  {
    id: 'chicane', name: 'Chicane', lanes: 4, laps: 5, scenery: 'arena',
    pieces: [['S', null], ['C', 90, 3], ['S', 3], ['C', 90, 3], ['S', 1.5], ['C', 40, 2.8], ['C', -80, 2.8], ['C', 40, 2.8], ['S', 1.5], ['C', 90, 3], ['S', null], ['C', 90, 3]],
  },
  {
    id: 'gp', name: 'Gran Premio', lanes: 4, laps: 4, scenery: 'noche',
    pieces: [['S', null], ['C', 90, 3], ['S', 1], ['C', 45, 2.8], ['C', -90, 3], ['C', 45, 2.8], ['S', 1], ['C', 90, 3], ['S', 1], ['C', 45, 2.8], ['C', -90, 3], ['C', 45, 2.8], ['S', 3], ['C', 90, 3], ['S', null], ['C', 90, 3]],
  },
  // --- Circuitos largos de club (de 16 a 36 metros de cuerda) ---
  {
    id: 'montana', name: 'Montaña', lanes: 4, laps: 5, scenery: 'verde', long: true,
    pieces: [['S', 6, 0], ['C', -90, 4, 0], ['S', null, 0], ['S', 8, 0], ['C', 90, 4], ['S', 6], ['C', 45, 3], ['C', -45, 3], ['S', 4], ['C', 90, 3.5], ['S', 6], ['C', 90, 4, 0.95], ['S', null, 0.95], ['C', -90, 4, 0.6], ['S', 6, 0.3], ['C', -90, 3.5, 0], ['S', 4, 0], ['C', -45, 3], ['C', 45, 3]],
  },
  {
    id: 'autodromo', name: 'Autódromo', lanes: 4, laps: 5, scenery: 'arena', long: true,
    pieces: [['S', null], ['C', 90, 5], ['S', 10], ['C', -45, 4], ['C', 90, 4], ['C', -45, 4], ['S', 8], ['C', 90, 3.5], ['S', 12], ['C', 90, 2.6], ['S', 10], ['C', -180, 2.4], ['S', 10], ['C', 90, 2.6], ['S', 8], ['C', 90, 4], ['S', null], ['C', 90, 4]],
  },
  {
    id: 'internacional', name: 'Internacional', lanes: 4, laps: 4, scenery: 'noche', long: true,
    pieces: [['S', null], ['C', 90, 5], ['S', 10], ['C', -30, 4], ['C', 60, 4], ['C', -30, 4], ['S', 10], ['C', 90, 3.5], ['S', 8], ['C', -90, 3], ['S', 6], ['C', 90, 3], ['S', 20], ['C', 135, 3], ['S', 8], ['C', -45, 4], ['S', null], ['C', 90, 4]],
  },
  {
    id: 'resistencia', name: 'Resistencia', lanes: 4, laps: 3, scenery: 'verde', long: true,
    pieces: [['S', null], ['C', 90, 5.5], ['S', 18], ['C', -30, 4.5], ['C', 60, 4.5], ['C', -30, 4.5], ['S', 14], ['C', 90, 3.5], ['S', 10], ['C', 90, 2.8], ['S', 12], ['C', -180, 2.6], ['S', 12], ['C', 90, 2.8], ['S', 8], ['C', -90, 3], ['S', 10], ['C', 90, 3], ['S', 30], ['C', 135, 3], ['S', 14], ['C', -45, 4.5], ['S', null], ['C', 90, 4.5]],
  },
];

// --- Circuitos Premium: exclusivos de temporada, tipo maqueta (cambian con las actualizaciones) ---
// decor: decorado especial que monta el juego alrededor de la pista (montaña, ciudad…)
export const PREMIUM = [
  {
    id: 'pico', name: 'Subida al Pico', lanes: 4, laps: 3, scenery: 'verde', decor: 'montana', premium: true, long: true,
    blurb: 'Rasante en meta, subida larga, espiral hasta la cima, herraduras de bajada y chicane en el valle',
    pieces: [['S', 22, 0], ['S', 14, 0.9], ['C', 30, 7, 0.9], ['C', -60, 7, 0.9], ['C', 30, 7, 0.9], ['S', 14, 0], ['S', 6, 0], ['C', 90, 7, 0.4], ['S', 48, 2.6], ['C', -360, 6, 4.4], ['S', 8, 4.4], ['C', 90, 7, 4.2], ['C', -40, 6, 4.0], ['C', 80, 6, 3.8], ['C', -40, 6, 3.6], ['S', 10, 3.2], ['C', 180, 4.5, 2.7], ['S', 18, 2.0], ['C', -180, 4.5, 1.5], ['S', 18, 1.0], ['C', 40, 5, 0.9], ['C', -80, 5, 0.7], ['C', 40, 5, 0.6], ['S', 40, 0.2], ['C', 90, 7, 0], ['S', 12, 0.7], ['S', 12, 0], ['S', null, 0], ['C', 90, 7, 0], ['S', null, 0]],
  },
  {
    id: 'puerto', name: 'Urbano del Puerto', lanes: 4, laps: 3, scenery: 'ciudad', decor: 'ciudad', premium: true, long: true,
    blurb: 'Recta del puerto, rampa en espiral, calles en escalera, dos horquillas y dos chicanes, de noche',
    pieces: [['S', 56, 0], ['C', 35, 4, 0], ['C', -70, 4, 0], ['C', 35, 4, 0], ['S', 14, 0], ['C', 90, 4.5, 0], ['S', 26, 0.9], ['C', -360, 5.5, 2.3], ['S', 16, 2.3], ['C', 90, 4.5, 2.2], ['S', 8, 2.1], ['C', -90, 3.5, 2.0], ['S', 10, 1.9], ['C', 90, 3.5, 1.8], ['S', 10, 1.7], ['C', 90, 3.5, 1.6], ['S', 10, 1.5], ['C', -90, 3.5, 1.4], ['S', 12, 1.1], ['C', 180, 3.4, 0.8], ['S', 30, 0.5], ['C', -180, 3.4, 0.3], ['S', 30, 0.1], ['C', -35, 4, 0], ['C', 70, 4, 0], ['C', -35, 4, 0], ['S', 44, 0], ['C', 90, 4.5, 0], ['S', null, 0], ['C', 90, 4.5, 0], ['S', null, 0]],
  },
];
export const PREMIUM_SEASON = 'Temporada 1';
export const ALL_TRACKS = [...TRACKS, ...PREMIUM];
export const findTrack = (id) => ALL_TRACKS.find((t) => t.id === id) || null;

export const LANE_W = 0.62; // separación entre carriles
export const DS = 0.04;     // paso de muestreo

// Recorre las piezas con un largo dado para las rectas libres
function walk(pieces, free) {
  let x = 0, z = 0, h = 0, k = 0;
  let fi = 0;
  const dirs = [];
  for (const p of pieces) {
    if (p[0] === 'S') {
      const len = p[1] == null ? free[fi++] : p[1];
      if (p[1] == null) dirs.push([Math.cos(h), Math.sin(h)]);
      x += Math.cos(h) * len; z += Math.sin(h) * len;
    } else {
      const ang = (p[1] * Math.PI) / 180, r = p[2];
      const sgn = Math.sign(ang);
      const cx = x - Math.sin(h) * r * sgn, cz = z + Math.cos(h) * r * sgn;
      const h2 = h + ang;
      x = cx + Math.sin(h2) * r * sgn; z = cz - Math.cos(h2) * r * sgn;
      h = h2;
    }
    k++;
  }
  return { x, z, h, dirs };
}

// Calcula el largo de las rectas libres para cerrar el circuito
export function solve(track) {
  const nFree = track.pieces.filter((p) => p[0] === 'S' && p[1] == null).length;
  if (nFree === 0) return track.pieces;
  if (nFree !== 2) throw new Error('Se necesitan 0 o 2 rectas libres: ' + track.id);
  const base = walk(track.pieces, [0, 0]);
  const [d1, d2] = base.dirs;
  // base + L1*d1 + L2*d2 = 0
  const det = d1[0] * d2[1] - d1[1] * d2[0];
  if (Math.abs(det) < 1e-6) throw new Error('Rectas libres paralelas: ' + track.id);
  const L1 = (-base.x * d2[1] + base.z * d2[0]) / det;
  const L2 = (-base.z * d1[0] + base.x * d1[1]) / det;
  let i = 0;
  return track.pieces.map((p) => (p[0] === 'S' && p[1] == null ? ['S', [L1, L2][i++], p[2]] : p));
}

// Muestrea la línea central: posición, rumbo, curvatura y altura cada DS
export function sample(track) {
  const pieces = solve(track);
  const pts = [];
  let x = 0, z = 0, h = 0, y = 0;
  for (const p of pieces) {
    const isS = p[0] === 'S';
    const len = isS ? p[1] : (Math.abs(p[1]) * Math.PI / 180) * p[2];
    const k = isS ? 0 : Math.sign(p[1]) / p[2];
    const yEnd = (isS ? p[2] : p[3]);
    const y0 = y, y1 = yEnd == null ? y : yEnd;
    const n = Math.max(1, Math.round(len / DS));
    const step = len / n;
    for (let i = 0; i < n; i++) {
      const t = i / n;
      const sm = t * t * (3 - 2 * t);
      pts.push({ x, z, h, k, y: y0 + (y1 - y0) * sm });
      x += Math.cos(h + (k * step) / 2) * step;
      z += Math.sin(h + (k * step) / 2) * step;
      h += k * step;
    }
    y = y1;
  }
  const closure = Math.hypot(x, z);
  return { pts, length: pts.length * DS, closure, pieces };
}

// Desplazamiento de cada carril respecto al centro (positivo = izquierda)
export function laneOffsets(n) {
  return Array.from({ length: n }, (_, i) => (i - (n - 1) / 2) * LANE_W);
}

// ---------------------------------------------------------------------------
// Editor de circuitos: muestreo de un trazado abierto, cierre automático y validación
// (lo usan el juego y el servidor para comprobar los circuitos de la comunidad)
// ---------------------------------------------------------------------------
export const EDITOR = {
  maxPieces: 80,
  minLen: 3,      // metros de cuerda
  maxLen: 60,
  radii: { cerrada: 2.2, media: 3.2, abierta: 4.6 },   // radio de la línea central (unidades), 2 carriles
  radius4: 0.6,   // con 4 carriles las curvas son más abiertas
  scenery: ['verde', 'arena', 'noche'],
  bridge: 0.95,   // altura de un puente (unidades): pasa por encima de otro tramo
  ramp: 0.35 / 0.126 * 3,   // una rampa son 3 rectas (1,05 m)
};
// Altura final de una pieza (o undefined si sigue a la misma altura)
const endH = (p) => (p[0] === 'S' ? p[2] : p[3]);
export function heightAtEnd(pieces) {
  let y = 0;
  for (const p of pieces) { const h = endH(p); if (Number.isFinite(h)) y = h; }
  return y;
}
const SCALE_M = 0.126;

// Recorre piezas sin cerrar (rectas con largo fijo) y devuelve el final y los puntos
export function walkOpen(pieces, step = 0.2) {
  let x = 0, z = 0, h = 0, y = 0;
  const pts = [{ x, z, h, y }];
  for (const p of pieces) {
    const isS = p[0] === 'S';
    const len = isS ? p[1] : (Math.abs(p[1]) * Math.PI / 180) * p[2];
    const k = isS ? 0 : Math.sign(p[1]) / p[2];
    const n = Math.max(1, Math.ceil(len / step));
    const st = len / n;
    const y0 = y, h1 = endH(p), y1 = Number.isFinite(h1) ? h1 : y;
    for (let i = 0; i < n; i++) {
      x += Math.cos(h + (k * st) / 2) * st;
      z += Math.sin(h + (k * st) / 2) * st;
      h += k * st;
      const t = (i + 1) / n, sm = t * t * (3 - 2 * t);
      pts.push({ x, z, h, y: y0 + (y1 - y0) * sm });
    }
    y = y1;
  }
  return { x, z, h, y, pts };
}

// ¿Se cruza o se pisa el circuito? (ignora tramos con más de 0,6 de diferencia de altura)
export function selfOverlap(pts, lanes) {
  const half = (lanes * LANE_W) / 2 + 0.28, need = 2 * half + 0.9;
  const n = pts.length;
  const step = Math.max(1, Math.round(0.12 / DS));
  const skip = Math.ceil((need * 2.2) / DS);
  let worst = Infinity;
  // Rejilla espacial para no comparar todos con todos
  const cell = need, grid = new Map();
  const key = (x, z) => `${Math.floor(x / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i += step) {
    const k = key(pts[i].x, pts[i].z);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(i);
  }
  for (let i = 0; i < n; i += step) {
    const p = pts[i], cx = Math.floor(p.x / cell), cz = Math.floor(p.z / cell);
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const list = grid.get(`${cx + a},${cz + b}`);
      if (!list) continue;
      for (const j of list) {
        if (j <= i) continue;
        const gap = Math.min(j - i, n - j + i);
        if (gap < skip) continue;
        const q = pts[j];
        if (Math.abs((p.y || 0) - (q.y || 0)) > 0.6) continue;
        const d = Math.hypot(p.x - q.x, p.z - q.z);
        if (d < worst) worst = d;
      }
    }
  }
  return { ok: worst >= need, worst, need };
}

// Comprueba un circuito (de la comunidad o del editor). Devuelve { ok, error, length (m) }
export function validateTrack(def) {
  if (!def || !Array.isArray(def.pieces)) return { ok: false, error: 'Circuito no válido' };
  if (![2, 4].includes(def.lanes)) return { ok: false, error: 'Elige 2 o 4 carriles' };
  if (def.pieces.length < 3 || def.pieces.length > EDITOR.maxPieces) return { ok: false, error: `El circuito debe tener entre 3 y ${EDITOR.maxPieces} piezas` };
  const minR = def.lanes === 4 ? 2.0 : 1.4;
  for (const p of def.pieces) {
    if (!Array.isArray(p)) return { ok: false, error: 'Pieza no válida' };
    if (p[0] === 'S') {
      if (!(Number.isFinite(p[1]) && p[1] >= 0 && p[1] <= 80) || p.length > 3) return { ok: false, error: 'Recta no válida' };
    } else if (p[0] === 'C') {
      if (!(Number.isFinite(p[1]) && Math.abs(p[1]) >= 5 && Math.abs(p[1]) <= 360) || !(Number.isFinite(p[2]) && p[2] >= minR && p[2] <= 12) || p.length > 4) return { ok: false, error: 'Curva no válida' };
    } else return { ok: false, error: 'Pieza no válida' };
    const hh = endH(p);
    if (hh !== undefined && hh !== null && !(Number.isFinite(hh) && hh >= 0 && hh <= 1.2)) return { ok: false, error: 'Altura no válida' };
  }
  // Rampas: que no sean un muro (pendiente máxima ~17 %)
  {
    let y = 0;
    for (const p of def.pieces) {
      const len = p[0] === 'S' ? p[1] : (Math.abs(p[1]) * Math.PI / 180) * p[2];
      const hh = endH(p);
      if (Number.isFinite(hh)) { if (Math.abs(hh - y) > 0.01 && Math.abs(hh - y) / Math.max(1e-6, len) > 0.17) return { ok: false, error: 'Hay una rampa demasiado empinada' }; y = hh; }
    }
    if (Math.abs(y) > 0.01) return { ok: false, error: 'El circuito tiene que volver a bajar al suelo' };
  }
  const end = walkOpen(def.pieces, 0.05);
  const turn = def.pieces.reduce((a, p) => a + (p[0] === 'C' ? p[1] : 0), 0);
  // Una vuelta completa (360°) o un ocho con puente (0°)
  const okTurn = Math.abs(Math.abs(turn) - 360) < 0.5 || (Math.abs(turn) < 0.5 && def.pieces.some((p) => endH(p) > 0.5));
  if (Math.hypot(end.x, end.z) > 0.05 || !okTurn) return { ok: false, error: 'El circuito no está cerrado' };
  let S;
  try { S = sample(def); } catch { return { ok: false, error: 'Circuito no válido' }; }
  const length = S.length * SCALE_M;
  if (length < EDITOR.minLen) return { ok: false, error: `Muy corto: mínimo ${EDITOR.minLen} m` };
  if (length > EDITOR.maxLen) return { ok: false, error: `Muy largo: máximo ${EDITOR.maxLen} m` };
  const ov = selfOverlap(S.pts, def.lanes);
  if (!ov.ok) return { ok: false, error: 'El circuito se cruza o se toca consigo mismo' };
  return { ok: true, length };
}

// Cierra un trazado abierto: añade la curva que falta para dar la vuelta completa y
// mete dos rectas donde haga falta para que el final llegue a la salida.
// Devuelve { pieces } (todas con largo fijo) o { error }.
export function autoClose(pieces, lanes, radius) {
  if (!pieces.length) return { error: 'Pon alguna pieza primero' };
  const turn = pieces.reduce((a, p) => a + (p[0] === 'C' ? p[1] : 0), 0);
  const bridge = pieces.some((p) => endH(p) > 0.5);
  let target = Math.round(turn / 360) * 360;
  if (target === 0 && !bridge) target = turn >= 0 ? 360 : -360;   // sin puente no puede haber un ocho
  const missing = target - turn;
  // Las curvas se parten en trozos de 45° para tener más sitios donde meter rectas
  const base = [];
  const inside = new Set();   // huecos que caen dentro de una curva del jugador (mejor no tocarlos)
  for (const p of pieces) {
    if (p[0] !== 'C') { base.push(p.slice()); continue; }
    let r = p[1], first = true;
    while (Math.abs(r) > 0.5) {
      if (!first) inside.add(base.length);
      const a = Math.sign(r) * Math.min(45, Math.abs(r)); base.push(['C', a, p[2]]); r -= a; first = false;
    }
    if (Number.isFinite(p[3])) base[base.length - 1][3] = p[3];   // la altura, en el último trozo
  }
  // Si acaba en alto, una rampa de bajada antes de cerrar
  if (heightAtEnd(base) > 0.01) base.push(['S', EDITOR.ramp, 0]);
  if (Math.abs(target) > 360) return { error: 'Has girado más de una vuelta completa: quita alguna curva' };
  // La curva que falta, en trozos de 90° como mucho
  let rest = missing;
  while (Math.abs(rest) > 0.5) {
    const a = Math.sign(rest) * Math.min(45, Math.abs(rest));
    base.push(['C', a, radius]);
    rest -= a;
  }
  // Rumbo al principio de cada hueco entre piezas (donde se puede meter una recta)
  const heads = [];
  let h = 0;
  for (let i = 0; i <= base.length; i++) {
    heads.push(h);
    const p = base[i];
    if (p && p[0] === 'C') h += (p[1] * Math.PI) / 180;
  }
  const end = walkOpen(base, 0.1);
  const gx = -end.x, gz = -end.z;   // lo que falta para llegar a la salida
  const cands = [];
  for (let i = 0; i <= base.length; i++) for (let j = i + 1; j <= base.length; j++) {
    const d1 = [Math.cos(heads[i]), Math.sin(heads[i])], d2 = [Math.cos(heads[j]), Math.sin(heads[j])];
    const det = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(det) < 0.2) continue;
    // Insertar una recta en el hueco i desplaza todo lo que va detrás en su dirección
    const L1 = (gx * d2[1] - gz * d2[0]) / det;
    const L2 = (gz * d1[0] - gx * d1[1]) / det;
    if (L1 < -1e-6 || L2 < -1e-6) continue;
    cands.push({ i, j, L1: Math.max(0, L1), L2: Math.max(0, L2), cost: L1 + L2 + (inside.has(i) ? 4 : 0) + (inside.has(j) ? 4 : 0) });
  }
  if (!Math.hypot(gx, gz) || Math.hypot(gx, gz) < 1e-3) cands.unshift({ i: 0, j: 0, L1: 0, L2: 0, cost: 0 });
  cands.sort((a, b) => a.cost - b.cost);
  let lastErr = 'No se puede cerrar así: prueba con otras curvas';
  for (const c of cands.slice(0, 60)) {
    const out = [];
    for (let k = 0; k <= base.length; k++) {
      if (k === c.i && c.L1 > 1e-4) out.push(['S', +c.L1.toFixed(4)]);
      if (k === c.j && c.j !== c.i && c.L2 > 1e-4) out.push(['S', +c.L2.toFixed(4)]);
      if (k < base.length) out.push(base[k]);
    }
    // Junta rectas seguidas y redondea
    const merged = [];
    for (const p of out) {
      const last = merged[merged.length - 1];
      // Se juntan piezas iguales seguidas (si no cambian de altura)
      if (p[0] === 'S' && last && last[0] === 'S' && last.length === 2 && p.length === 2) last[1] = +(last[1] + p[1]).toFixed(4);
      else if (p[0] === 'C' && last && last[0] === 'C' && last.length === 3 && p.length <= 4 && last[2] === p[2] && Math.sign(last[1]) === Math.sign(p[1])) { last[1] += p[1]; if (p.length === 4) last[3] = p[3]; }
      else merged.push(p.slice());
    }
    // Corrige el pequeño error de redondeo con la última recta
    const e2 = walkOpen(merged, 0.05);
    if (Math.hypot(e2.x, e2.z) > 0.05) continue;
    const v = validateTrack({ pieces: merged, lanes });
    if (v.ok) return { pieces: merged, added: c.cost, length: v.length };
    lastErr = v.error;
  }
  return { error: lastErr };
}
