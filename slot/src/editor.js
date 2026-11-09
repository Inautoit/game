// Editor de circuitos: se monta pieza a pieza (como una pista de verdad) y el juego
// propone cómo cerrarlo. Vista cenital en un canvas.
import { walkOpen, autoClose, EDITOR, LANE_W, sample, heightAtEnd } from './tracks.js';

const STRAIGHT = 0.35 / 0.126;   // una recta estándar de 35 cm, en unidades
export const PALETTE = [
  { id: 's1', label: 'Recta', sub: '35 cm', make: () => ['S', STRAIGHT] },
  { id: 's2', label: 'Recta larga', sub: '70 cm', make: () => ['S', STRAIGHT * 2] },
  { id: 'l45', label: '↰ 45°', sub: 'Izquierda', make: (r) => ['C', -45, r] },
  { id: 'l90', label: '↰ 90°', sub: 'Izquierda', make: (r) => ['C', -90, r] },
  { id: 'r45', label: '↱ 45°', sub: 'Derecha', make: (r) => ['C', 45, r] },
  { id: 'r90', label: '↱ 90°', sub: 'Derecha', make: (r) => ['C', 90, r] },
  // Rampas: suben a la altura de un puente (para cruzar por encima) o bajan al suelo
  { id: 'up', label: 'Subir', sub: 'Rampa a puente', make: () => ['S', EDITOR.ramp, EDITOR.bridge], when: (d) => heightAtEnd(d.pieces) < 0.5 },
  { id: 'down', label: 'Bajar', sub: 'Rampa al suelo', make: () => ['S', EDITOR.ramp, 0], when: (d) => heightAtEnd(d.pieces) > 0.5 },
];
export const RADII = [['cerrada', 'Cerrada'], ['media', 'Media'], ['abierta', 'Abierta']];

export function newDraft() {
  return {
    lid: Math.random().toString(36).slice(2, 9),
    name: '', lanes: 2, laps: 5, scenery: 'verde', radius: 'media',
    pieces: [['S', STRAIGHT * 2], ['C', 90, 3.2], ['S', STRAIGHT], ['C', 90, 3.2]],
    published: null,
  };
}
export const radiusOf = (draft) => EDITOR.radii[draft.radius] + (draft.lanes === 4 ? EDITOR.radius4 : 0);

// Cierra el borrador (con caché: solo se recalcula si cambia)
const closeCache = new Map();
export function closeDraft(draft) {
  const key = JSON.stringify([draft.pieces, draft.lanes, draft.radius]);
  if (closeCache.has(key)) return closeCache.get(key);
  const r = autoClose(draft.pieces, draft.lanes, radiusOf(draft));
  if (closeCache.size > 50) closeCache.clear();
  closeCache.set(key, r);
  return r;
}

// Definición jugable a partir del borrador cerrado
export function draftDef(draft, closed) {
  return {
    id: draft.published ? 'c_' + draft.published : 'm_' + draft.lid,
    cid: draft.published || null,
    name: draft.name || 'Mi circuito', lanes: draft.lanes, laps: draft.laps, scenery: draft.scenery,
    pieces: closed.pieces, mine: true,
  };
}

// Dibujo cenital: lo que has puesto (gris), lo que añade el cierre automático (azul) y la salida
export function drawEditor(cv, draft, closed) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr) || cv.height !== Math.round(H * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  // Fondo de mesa con cuadrícula de 1 m
  g.fillStyle = '#2f5a2c'; g.fillRect(0, 0, W, H);
  const open = walkOpen(draft.pieces, 0.15);
  const all = closed && closed.pieces ? walkOpen(closed.pieces, 0.15).pts : open.pts;
  const pts = [...open.pts, ...all];
  const half = (draft.lanes * LANE_W) / 2 + 0.28;
  let mnx = Infinity, mxx = -Infinity, mnz = Infinity, mxz = -Infinity;
  for (const p of pts) { mnx = Math.min(mnx, p.x); mxx = Math.max(mxx, p.x); mnz = Math.min(mnz, p.z); mxz = Math.max(mxz, p.z); }
  const pad = half + 1.2;
  mnx -= pad; mxx += pad; mnz -= pad; mxz += pad;
  // En vertical, giramos la vista para aprovechar la pantalla
  const rot = (H > W) !== ((mxz - mnz) > (mxx - mnx));
  const bw = rot ? mxz - mnz : mxx - mnx, bh = rot ? mxx - mnx : mxz - mnz;
  const sc = Math.min(W / bw, H / bh);
  const ox = (W - bw * sc) / 2, oy = (H - bh * sc) / 2;
  const P = (p) => rot ? [ox + (p.z - mnz) * sc, oy + (mxx - p.x) * sc] : [ox + (p.x - mnx) * sc, oy + (p.z - mnz) * sc];
  // Cuadrícula de 1 m
  g.strokeStyle = 'rgba(255,255,255,0.06)'; g.lineWidth = 1;
  const m = 1 / 0.126;
  for (let x = Math.ceil(mnx / m) * m; x < mxx; x += m) { const a = P({ x, z: mnz }), b = P({ x, z: mxz }); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  for (let z = Math.ceil(mnz / m) * m; z < mxz; z += m) { const a = P({ x: mnx, z }), b = P({ x: mxx, z }); g.beginPath(); g.moveTo(...a); g.lineTo(...b); g.stroke(); }
  const stroke = (list, color, w, dash) => {
    if (list.length < 2) return;
    g.strokeStyle = color; g.lineWidth = w; g.lineJoin = 'round'; g.lineCap = 'round';
    g.setLineDash(dash || []);
    g.beginPath(); list.forEach((p, i) => { const [x, y] = P(p); i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.stroke();
    g.setLineDash([]);
  };
  const tw = half * 2 * sc;
  if (closed && closed.pieces) {
    stroke(all, 'rgba(79,195,247,0.35)', tw + 2);
    stroke(all, 'rgba(79,195,247,0.9)', 2, [6, 6]);
  }
  // Primero el suelo y luego lo que va en alto (puentes), con sombra para que se vea encima
  const runs = [];
  let cur = null;
  for (const p of open.pts) {
    const hi = (p.y || 0) > 0.3;
    if (!cur || cur.hi !== hi) { cur = { hi, pts: cur ? [cur.pts[cur.pts.length - 1]] : [] }; runs.push(cur); }
    cur.pts.push(p);
  }
  const lanesOf = (pts) => {
    for (let l = 0; l < draft.lanes; l++) {
      const off = (l - (draft.lanes - 1) / 2) * LANE_W;
      stroke(pts.map((p) => ({ x: p.x - Math.sin(p.h) * off, z: p.z + Math.cos(p.h) * off })), '#0b0c0e', Math.max(1, sc * 0.05));
    }
  };
  for (const r of runs.filter((q) => !q.hi)) { stroke(r.pts, '#15171c', tw + 4); stroke(r.pts, '#3a3d45', tw); lanesOf(r.pts); }
  for (const r of runs.filter((q) => q.hi)) {
    stroke(r.pts.map((p) => ({ x: p.x + 0.35, z: p.z + 0.5 })), 'rgba(0,0,0,0.35)', tw + 8);
    stroke(r.pts, '#c9ced6', tw + 6);
    stroke(r.pts, '#4a4e58', tw);
    lanesOf(r.pts);
  }
  // Salida (cuadros) y final con flecha
  const s0 = open.pts[0], n0 = [-Math.sin(s0.h) * half, Math.cos(s0.h) * half];
  const a0 = P({ x: s0.x + n0[0], z: s0.z + n0[1] }), b0 = P({ x: s0.x - n0[0], z: s0.z - n0[1] });
  g.strokeStyle = '#fff'; g.lineWidth = 4; g.setLineDash([4, 4]); g.beginPath(); g.moveTo(...a0); g.lineTo(...b0); g.stroke(); g.setLineDash([]);
  const e = open.pts[open.pts.length - 1];
  const [ex, ey] = P(e), [fx, fy] = P({ x: e.x + Math.cos(e.h) * 1.2, z: e.z + Math.sin(e.h) * 1.2 });
  const ang = Math.atan2(fy - ey, fx - ex);
  g.fillStyle = '#ffcc00';
  g.beginPath(); g.moveTo(fx, fy); g.lineTo(ex + Math.cos(ang + 2.4) * 12, ey + Math.sin(ang + 2.4) * 12); g.lineTo(ex + Math.cos(ang - 2.4) * 12, ey + Math.sin(ang - 2.4) * 12); g.closePath(); g.fill();
  // Escala
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.font = '12px system-ui, sans-serif';
  g.fillRect(12, H - 18, m * sc, 3); g.fillText('1 m', 12, H - 24);
}

// Longitud en metros de un circuito cerrado
export const lengthM = (pieces, lanes) => sample({ pieces, lanes }).length * 0.126;
