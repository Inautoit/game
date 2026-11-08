// Circuitos de Turbo Slot, definidos por piezas como una pista real.
// ['S', largo, altura?]            recta
// ['C', grados, radio, altura?]    curva (grados > 0 = izquierda)
// Un largo null es una recta "libre": el programa calcula su largo para que el circuito cierre.
// La altura (opcional) es la del final de la pieza; sirve para puentes.

export const TRACKS = [
  {
    id: 'ovalo', name: 'Óvalo', lanes: 2, laps: 8, scenery: 'verde',
    pieces: [['S', 6], ['C', 180, 2.4], ['S', 6], ['C', 180, 2.4]],
  },
  {
    id: 'rinon', name: 'Riñón', lanes: 2, laps: 6, scenery: 'verde',
    pieces: [['S', null], ['C', 90, 2.2], ['S', 2], ['C', 90, 2.2], ['S', 3], ['C', 45, 2.2], ['C', -90, 2.6], ['C', 45, 2.2], ['S', 1], ['C', 90, 2.2], ['S', null], ['C', 90, 2.2]],
  },
  {
    id: 'ocho', name: 'El Ocho', lanes: 2, laps: 6, scenery: 'noche',
    pieces: [['S', 2.5, 0], ['C', 270, 2.6, 0.95], ['S', null, 0.95], ['C', -270, 2.6, 0], ['S', null, 0]],
  },
  {
    id: 'horquilla', name: 'La Horquilla', lanes: 2, laps: 5, scenery: 'arena',
    pieces: [['S', null], ['C', 90, 2.4], ['S', 4], ['C', 90, 2.4], ['S', 2], ['C', 90, 1.6], ['S', 2.5], ['C', -180, 1.5], ['S', 2.5], ['C', 90, 1.6], ['S', 2], ['C', 90, 2.4], ['S', null], ['C', 90, 2.4]],
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
    id: 'montana', name: 'Montaña', lanes: 2, laps: 5, scenery: 'verde', long: true,
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
