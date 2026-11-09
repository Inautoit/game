// Decorados de los circuitos Premium, como en una maqueta: la montaña (terreno, pico nevado,
// pinos y rocas) y la ciudad del puerto (edificios con ventanas encendidas, farolas, mar y barcos).
// Escala 1:32: 1 unidad = 12,6 cm de maqueta ≈ 4 m de verdad.
import * as THREE from '../vendor/three.module.min.js';
import { mergeGeometries } from '../vendor/jsm/utils/BufferGeometryUtils.js';

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}
// Puntos de la línea central (submuestreados) y distancia mínima a la pista
function trackSampler(P, step = 3) {
  const pts = [];
  for (let i = 0; i < P.length; i += step) pts.push(P[i]);
  const dist = (x, z) => { let m = Infinity; for (const p of pts) { const d = (x - p.x) ** 2 + (z - p.z) ** 2; if (d < m) m = d; } return Math.sqrt(m); };
  return { pts, dist };
}

// ---------------------------------------------------------------- Montaña
// Altura del terreno: sube por debajo de la pista cuando va en alto (con taludes), baja hasta la
// pista que pasa por abajo (para no taparla) y forma un pico dentro de la espiral.
export function makeTerrain(P, half) {
  const { pts, dist } = trackSampler(P, 5);
  const ymax = Math.max(...pts.map((p) => p.y));
  // Centro de la espiral: media de los centros de curvatura de las curvas en lo alto (las del giro mayoritario)
  // (los puntos en alto cuyos centros de curvatura coinciden en el mismo sitio: la espiral)
  const cells = new Map();
  for (const p of pts) if (p.y > ymax - 1.8 && p.k) {
    const cxp = p.x - Math.sin(p.h) / p.k, czp = p.z + Math.cos(p.h) / p.k;
    const k = Math.round(cxp) + ',' + Math.round(czp);
    if (!cells.has(k)) cells.set(k, []);
    cells.get(k).push(p);
  }
  let spiral = [];
  for (const g of cells.values()) if (g.length > spiral.length) spiral = g;
  let sx = 0, sz = 0;
  for (const p of spiral) { sx += p.x - Math.sin(p.h) / p.k; sz += p.z + Math.cos(p.h) / p.k; }
  const pc = spiral.length ? { x: sx / spiral.length, z: sz / spiral.length } : { x: 0, z: 0 };
  const rSp = spiral.length ? Math.abs(1 / spiral[0].k) : 3;
  const rIn = Math.max(0.8, rSp - half - 0.25);
  const peak = ymax + 3.2;          // la cima dentro de la espiral
  const massif = ymax + 4.2;        // la montaña que llena el interior del circuito
  // Cubos de 4 unidades para mirar solo los puntos de pista cercanos
  const B = 4, buckets = new Map();
  const key = (i, j) => i * 100003 + j;
  for (const p of pts) { const k = key(Math.floor(p.x / B), Math.floor(p.z / B)); if (!buckets.has(k)) buckets.set(k, []); buckets.get(k).push(p); }
  const near = (x, z, r, fn) => {
    const i0 = Math.floor((x - r) / B), i1 = Math.floor((x + r) / B), j0 = Math.floor((z - r) / B), j1 = Math.floor((z + r) / B);
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) { const l = buckets.get(key(i, j)); if (l) for (const p of l) fn(p); }
  };
  // ¿Dentro del circuito? (regla del par/impar con la línea central, simplificada)
  const poly = []; for (let i = 0; i < P.length; i += 20) poly.push(P[i]);
  const inside = (x, z) => {
    let c = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const a = poly[i], b = poly[j];
      if ((a.z > z) !== (b.z > z) && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
    }
    return c;
  };
  const R = 22;   // a partir de aquí la pista ya no influye en el terreno
  const h = (x, z) => {
    let raise = -0.05, carve = Infinity, dmin2 = R * R;
    near(x, z, R, (p) => {
      const dx = x - p.x, dz = z - p.z, d2 = dx * dx + dz * dz;
      if (d2 < dmin2) dmin2 = d2;
      const d = Math.sqrt(d2);
      if (p.y > 0.05) { const r = p.y - 0.07 - Math.max(0, d - half - 0.3) * 0.55; if (r > raise) raise = r; }
      const c = p.y - 0.07 + Math.max(0, d - half - 0.2) * 2.6;
      if (c < carve) carve = c;
    });
    const dmin = Math.sqrt(dmin2);
    if (inside(x, z)) {
      // Montaña con laderas y crestas: sube al alejarse de la pista, con relieve irregular
      const rough = 0.72 + 0.28 * (0.5 + 0.25 * (Math.sin(x * 0.33 + 1.7) * Math.cos(z * 0.27) + Math.sin(x * 0.11 + z * 0.17 + 0.6)));
      raise = Math.max(raise, massif * (1 - Math.exp(-Math.max(0, dmin - half - 0.7) / 6.5)) * rough);
    }
    const dc = Math.hypot(x - pc.x, z - pc.z);
    if (dc < rIn) raise = Math.max(raise, ymax - 0.07 + (peak - ymax) * Math.pow(1 - dc / rIn, 0.6));
    return Math.min(raise, carve);
  };
  return { h, dist, ymax, peak: Math.max(peak, massif * 0.95) };
}

export function buildMountain(group, terrain, table, half, seed) {
  const { tw, td, cx, cz } = table;
  const res = Math.max(0.42, Math.sqrt((tw * td) / 26000));   // en mesas enormes, celdas algo mayores
  const nx = Math.ceil(tw / res), nz = Math.ceil(td / res);
  const geo = new THREE.PlaneGeometry(tw, td, nx, nz);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const r = rng(seed);
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) + cx, z = pos.getZ(i) + cz;
    pos.setY(i, terrain.h(x, z));
  }
  geo.computeVertexNormals();
  const nrm = geo.attributes.normal;
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i), steep = 1 - nrm.getY(i);
    if (y > terrain.peak - 1.5) c.setRGB(0.93, 0.95, 0.97);                     // nieve (solo en las cumbres)
    else if (steep > 0.35) c.setRGB(0.42 + r() * 0.05, 0.4, 0.37);             // roca
    else c.setRGB(0.24 + r() * 0.06, 0.42 + r() * 0.08 + Math.min(0.1, y * 0.02), 0.2);  // hierba
    col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.translate(cx, 0, cz);
  const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.95 }));
  mesh.receiveShadow = true;
  group.add(mesh);
  // Pinos y rocas (instanciados: muchas copias baratas)
  const crowns = [], trunks = [], rocks = [];
  const maxTrees = Math.min(260, Math.round((tw * td) / 28));
  for (let k = 0; k < maxTrees * 10 && crowns.length < maxTrees; k++) {
    const x = cx + (r() - 0.5) * (tw - 1.2), z = cz + (r() - 0.5) * (td - 1.2);
    const d = terrain.dist(x, z);
    if (d < half + 0.75) continue;
    const y = terrain.h(x, z);
    if (y > terrain.peak - 1.7) continue;                       // en la nieve no
    if (y < 0.1 && r() < 0.7) continue;                         // en el llano, pocos
    const s = 0.8 + r() * 0.7;
    crowns.push([x, y, z, s]); trunks.push([x, y, z, s]);
    if (r() < 0.35) rocks.push([x + (r() - 0.5) * 1.2, terrain.h(x, z) , z + (r() - 0.5) * 1.2, 0.18 + r() * 0.3]);
  }
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), p3 = new THREE.Vector3();
  const inst = (geom, mat, list, place) => {
    const im = new THREE.InstancedMesh(geom, mat, list.length);
    list.forEach((it, i) => { place(it); m4.compose(p3, q, sc); im.setMatrixAt(i, m4); });
    im.castShadow = true;
    group.add(im);
  };
  inst(new THREE.ConeGeometry(0.5, 1.6, 7), new THREE.MeshStandardMaterial({ color: 0x2f5d34, flatShading: true, roughness: 0.9 }), crowns,
    ([x, y, z, s]) => { p3.set(x, y + 0.3 * s + 0.8 * s, z); q.identity(); sc.set(s, s, s); });
  inst(new THREE.CylinderGeometry(0.07, 0.09, 0.35, 5), new THREE.MeshStandardMaterial({ color: 0x5a3d26, roughness: 1 }), trunks,
    ([x, y, z, s]) => { p3.set(x, y + 0.17 * s, z); q.identity(); sc.set(s, s, s); });
  inst(new THREE.IcosahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: 0x77736c, flatShading: true, roughness: 1 }), rocks,
    ([x, y, z, s]) => { p3.set(x, y + s * 0.3, z); e.set(r() * 3, r() * 3, r() * 3); q.setFromEuler(e); sc.set(s, s * 0.7, s); });
}

// ---------------------------------------------------------------- Ciudad del puerto
function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// Una baldosa = 1 unidad de ancho (4 m: dos ventanas) por 0,75 de alto (una planta)
let facadeTex = null, litTex = null;
function facadeTextures() {
  if (facadeTex) return [facadeTex, litTex];
  const lit = [];
  for (let i = 0; i < 64; i++) lit.push(Math.random() < 0.45);
  const draw = (night) => (g, w, h) => {
    g.fillStyle = night ? '#000' : '#d8d2c6'; g.fillRect(0, 0, w, h);
    for (let row = 0; row < 4; row++) for (let colI = 0; colI < 8; colI++) {
      const x = colI * (w / 8) + 4, y = row * (h / 4) + 5;
      const on = lit[row * 8 + colI];
      g.fillStyle = night ? (on ? (Math.random() < 0.3 ? '#ffe9b0' : '#ffd27a') : '#000') : '#3b4a5a';
      g.fillRect(x, y, w / 8 - 8, h / 4 - 12);
    }
  };
  facadeTex = canvas(128, 96, draw(false)); litTex = canvas(128, 96, draw(true));
  facadeTex.userData.keep = true; litTex.userData.keep = true;
  return [facadeTex, litTex];
}
// Caja con las ventanas a escala (UV en unidades de mundo); el tejado sin ventanas
function buildingGeo(w, h, d, color) {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.attributes.uv;
  // Caras: +x, -x, +y, -y, +z, -z (4 vértices cada una). Una baldosa = 4 unidades (8 ventanas) × 3 (4 plantas)
  const fu = [d, d, 0, 0, w, w], fv = [h, h, 0, 0, h, h];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    if (f === 2 || f === 3) uv.setXY(i, 0.003, 0.003);
    else uv.setXY(i, (uv.getX(i) * fu[f]) / 4, (uv.getY(i) * fv[f]) / 3);
  }
  const col = new Float32Array(uv.count * 3);
  for (let i = 0; i < uv.count; i++) { col[i * 3] = color.r; col[i * 3 + 1] = color.g; col[i * 3 + 2] = color.b; }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.translate(0, h / 2, 0);
  return g;
}

export function buildCity(group, P, half, table, seed, night) {
  const { tw, td, cx, cz } = table;
  const { dist } = trackSampler(P, 2);
  const r = rng(seed);
  const minX = cx - tw / 2 + 0.4, maxX = cx + tw / 2 - 0.4, minZ = cz - td / 2 + 0.4, maxZ = cz + td / 2 - 0.4;
  // El mar va en el lado de la mesa más cercano a la recta de salida (la recta junto al puerto)
  let tminZ = Infinity, tmaxZ = -Infinity;
  for (const p of P) { tminZ = Math.min(tminZ, p.z); tmaxZ = Math.max(tmaxZ, p.z); }
  const seaLow = P[0].z - tminZ < tmaxZ - P[0].z;
  const quay = seaLow ? tminZ - half - 0.7 : tmaxZ + half + 0.7;      // borde del muelle
  const inSea = (z) => (seaLow ? z < quay : z > quay);
  // Agua y muelle
  const seaD = seaLow ? quay - minZ + 0.4 : maxZ + 0.4 - quay;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(tw - 0.2, seaD),
    new THREE.MeshStandardMaterial({ color: night ? 0x0b2a44 : 0x1f5f86, roughness: 0.15, metalness: 0.3, emissive: night ? 0x061826 : 0x000000 }));
  water.rotation.x = -Math.PI / 2;
  water.position.set(cx, 0.004, seaLow ? quay - seaD / 2 : quay + seaD / 2);
  group.add(water);
  const edge = new THREE.Mesh(new THREE.BoxGeometry(tw - 0.2, 0.08, 0.25), new THREE.MeshStandardMaterial({ color: 0x9a978f, roughness: 0.9 }));
  edge.position.set(cx, 0.04, quay);
  group.add(edge);
  // Barcos
  const hullMat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5 });
  const cabMat = new THREE.MeshStandardMaterial({ color: 0x24527a, roughness: 0.6, emissive: night ? 0x334455 : 0x000000 });
  for (let k = 0; k < 5; k++) {
    const b = new THREE.Group();
    const len = 0.9 + r() * 0.8;
    const hull = new THREE.Mesh(new THREE.BoxGeometry(len, 0.22, len * 0.38), hullMat); hull.position.y = 0.1; b.add(hull);
    const cab = new THREE.Mesh(new THREE.BoxGeometry(len * 0.4, 0.2, len * 0.28), cabMat); cab.position.set(-len * 0.1, 0.31, 0); b.add(cab);
    const z = seaLow ? quay - 0.5 - r() * Math.max(0.1, seaD - 1.4) : quay + 0.5 + r() * Math.max(0.1, seaD - 1.4);
    b.position.set(minX + 1 + r() * (tw - 3), 0, z);
    b.rotation.y = (r() - 0.5) * 0.6;
    group.add(b);
  }
  // Edificios: se colocan donde no tocan la pista, la acera, el mar ni otros edificios
  const boxes = [], geos = [];
  const palette = ['#d8cfc0', '#c7b9a4', '#e3dccd', '#b9a58b', '#cdbfb0', '#a9b2b8', '#d9c3a5', '#bfae9a'].map((h) => new THREE.Color(h));
  // Manzanas: una cuadrícula de solares de 2,6 unidades con calles estrechas entre ellos
  const maxB = 700, G = 2.6;
  const lots = [];
  for (let x = minX + G / 2; x < maxX - G / 2; x += G) for (let z = minZ + G / 2; z < maxZ - G / 2; z += G) lots.push([x, z]);
  for (let i = lots.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [lots[i], lots[j]] = [lots[j], lots[i]]; }
  for (const [lx, lz] of lots) {
    if (boxes.length >= maxB) break;
    if (r() < 0.12) continue;   // algún solar vacío (plaza)
    const w = G - 0.35 - r() * 0.5, d = G - 0.35 - r() * 0.5;
    const x = lx + (r() - 0.5) * 0.2, z = lz + (r() - 0.5) * 0.2;
    let ok = true;
    for (const [px, pz] of [[x, z], [x - w / 2, z - d / 2], [x + w / 2, z - d / 2], [x - w / 2, z + d / 2], [x + w / 2, z + d / 2], [x, z - d / 2], [x, z + d / 2], [x - w / 2, z], [x + w / 2, z]]) {
      if (dist(px, pz) < half + 0.75 || inSea(pz)) { ok = false; break; }
    }
    if (!ok) continue;
    for (const b of boxes) if (Math.abs(b.x - x) < (b.w + w) / 2 + 0.2 && Math.abs(b.z - z) < (b.d + d) / 2 + 0.2) { ok = false; break; }
    if (!ok) continue;
    // Más bajos junto a la pista y más altos hacia dentro, como un centro de ciudad
    const far = Math.min(1, Math.max(0, (dist(x, z) - half - 1.5) / 8));
    const h = 0.9 + r() * 1.3 + far * (1 + r() * 3.5);
    boxes.push({ x, z, w, d });
    geos.push(buildingGeo(w, h, d, palette[Math.floor(r() * palette.length)]).translate(x, 0, z));
  }
  if (geos.length) {
    const [ft, lt] = facadeTextures();
    const mat = new THREE.MeshStandardMaterial({ map: ft, vertexColors: true, roughness: 0.85, emissive: night ? 0xffffff : 0x000000, emissiveMap: night ? lt : null, emissiveIntensity: night ? 0.9 : 0 });
    const city = new THREE.Mesh(mergeGeometries(geos), mat);
    city.castShadow = true; city.receiveShadow = true;
    group.add(city);
    geos.forEach((g) => g.dispose());
  }
  // Farolas a lo largo de la pista, alternando lados
  const lamps = [];
  for (let i = 0, side = 1; i < P.length; i += Math.round(3.2 / 0.04), side = -side) {
    const p = P[i];
    const nxv = -Math.sin(p.h), nzv = Math.cos(p.h);
    const x = p.x + nxv * (half + 0.42) * side, z = p.z + nzv * (half + 0.42) * side;
    if (inSea(z)) continue;
    lamps.push([x, z, side * nxv, side * nzv]);
  }
  if (lamps.length) {
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s1 = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
    const poles = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.025, 0.035, 1.25, 5), new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.6 }), lamps.length);
    const bulbs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.06, 0.12), new THREE.MeshStandardMaterial({ color: 0xfff1c4, emissive: 0xffd88a, emissiveIntensity: night ? 2.2 : 0.3 }), lamps.length);
    lamps.forEach(([x, z, ox, oz], i) => {
      p3.set(x, 0.62, z); m4.compose(p3, q, s1); poles.setMatrixAt(i, m4);
      p3.set(x - ox * 0.12, 1.24, z - oz * 0.12); m4.compose(p3, q, s1); bulbs.setMatrixAt(i, m4);
    });
    group.add(poles, bulbs);
  }
}
