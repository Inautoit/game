import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { LANE_W, SHOULDER, roadHalfWidth } from './config.js';

const TILE = 16;            // metros de carretera por repetición de textura
const ROAD_LEN = 896;      // la calzada es fija: lo que se mueve es la textura
const CHUNK_LEN = 60;
const CHUNK_COUNT = 9;
const CHUNK_START = -120;

// Carretera infinita + decorado. El jugador nunca se mueve en Z: hacemos
// scroll de la textura y reciclamos los "chunks" de decorado. Así no hay
// pérdida de precisión por muy lejos que llegues.
export class Road {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(1800, 1600),
      new THREE.MeshLambertMaterial({ color: 0x3f6b3a }),
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.04;
    this.ground.position.z = 300;
    this.group.add(this.ground);

    this.roadMesh = null;
    this.chunks = [];
    this.half = 0;
    this._offset = 0;
  }

  // Se llama al empezar partida y al cambiar de modo/hora.
  build(mode, time, renderer) {
    this.half = roadHalfWidth(mode);
    this.ground.material.color.setHex(time.ground);

    if (this.roadMesh) {
      this.roadMesh.geometry.dispose();
      this.roadMesh.material.map.dispose();
      this.roadMesh.material.dispose();
      this.group.remove(this.roadMesh);
    }
    const map = makeRoadTexture(mode, this.half, time);
    map.wrapT = THREE.RepeatWrapping;
    map.wrapS = THREE.ClampToEdgeWrapping;
    map.repeat.set(1, ROAD_LEN / TILE);
    map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    map.colorSpace = THREE.SRGBColorSpace;

    this.roadMesh = new THREE.Mesh(
      new THREE.PlaneGeometry(this.half * 2, ROAD_LEN),
      new THREE.MeshLambertMaterial({ map }),
    );
    this.roadMesh.rotation.x = -Math.PI / 2;
    this.roadMesh.position.z = ROAD_LEN / 2 + CHUNK_START;
    this.group.add(this.roadMesh);

    this._buildChunks(time);
    this.update(0);
  }

  _buildChunks(time) {
    for (const c of this.chunks) {
      c.group.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
      this.group.remove(c.group);
    }
    this.chunks = [];

    const solidMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
    this._glowMat = glowMat;

    for (let i = 0; i < CHUNK_COUNT; i++) {
      const { solid, glow } = buildChunkGeometry(i * 7919 + 13, this.half);
      const group = new THREE.Group();
      group.add(new THREE.Mesh(solid, solidMat));
      const glowMesh = new THREE.Mesh(glow, glowMat);
      glowMesh.visible = time.id !== 'day';
      group.add(glowMesh);
      group.position.z = CHUNK_START + i * CHUNK_LEN;
      this.group.add(group);
      this.chunks.push({ group, baseZ: CHUNK_START + i * CHUNK_LEN });
    }
  }

  setTime(time) {
    this.ground.material.color.setHex(time.ground);
    for (const c of this.chunks) c.group.children[1].visible = time.id !== 'day';
  }

  // distance = metros recorridos desde el inicio de la partida.
  update(distance) {
    const map = this.roadMesh.material.map;
    map.offset.y = -(distance / TILE) % 1;

    const span = CHUNK_COUNT * CHUNK_LEN;
    const scroll = distance % span;
    for (const c of this.chunks) {
      let z = c.baseZ - scroll;
      if (z < CHUNK_START - CHUNK_LEN) z += span;
      c.group.position.z = z;
    }
  }
}

// ---------------------------------------------------------------------------
// Textura de la calzada: se dibuja en un canvas, sin assets externos.
// ---------------------------------------------------------------------------
function makeRoadTexture(mode, half, time) {
  const SIZE = 512;
  const cv = document.createElement('canvas');
  cv.width = SIZE; cv.height = SIZE;
  const ctx = cv.getContext('2d');

  const W = half * 2;
  const pxX = SIZE / W;          // px por metro a lo ancho
  const pxY = SIZE / TILE;       // px por metro a lo largo
  const X = (m) => (half - m) * pxX;   // +X está a la izquierda de la pantalla

  ctx.fillStyle = time.road;
  ctx.fillRect(0, 0, SIZE, SIZE);

  // Grano del asfalto
  ctx.globalAlpha = 0.05;
  for (let i = 0; i < 2600; i++) {
    ctx.fillStyle = Math.random() < 0.5 ? '#000' : '#fff';
    ctx.fillRect(Math.random() * SIZE, Math.random() * SIZE, 2, 2);
  }
  ctx.globalAlpha = 1;

  // Arcén de tierra a los lados
  const edge = Math.max(...mode.lanes.map((l) => Math.abs(l.x))) + LANE_W / 2;
  ctx.fillStyle = time.id === 'night' ? '#1a1a1c' : '#4a4038';
  ctx.fillRect(0, 0, X(edge + SHOULDER * 0.1), SIZE);
  ctx.fillRect(X(-edge - SHOULDER * 0.1), 0, SIZE, SIZE);

  const line = (m, width, dashed, color) => {
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(1.5, width * pxX);
    ctx.setLineDash(dashed ? [3 * pxY, 5 * pxY] : []);
    ctx.lineDashOffset = 0;
    ctx.beginPath();
    ctx.moveTo(X(m), -1);
    ctx.lineTo(X(m), SIZE + 1);
    ctx.stroke();
  };

  const white = time.id === 'night' ? '#d8d8d0' : '#f2f2ec';
  const yellow = time.id === 'night' ? '#c9a53a' : '#f0c633';

  // Líneas entre carriles
  const xs = mode.lanes.map((l) => l.x).sort((a, b) => b - a);
  for (let i = 0; i < xs.length - 1; i++) {
    const mid = (xs[i] + xs[i + 1]) / 2;
    const a = mode.lanes.find((l) => l.x === xs[i]);
    const b = mode.lanes.find((l) => l.x === xs[i + 1]);
    if (a.dir !== b.dir) {
      line(mid + 0.18, 0.14, false, yellow);
      line(mid - 0.18, 0.14, false, yellow);
    } else {
      line(mid, 0.14, true, white);
    }
  }
  // Bordes
  line(edge - 0.12, 0.18, false, white);
  line(-edge + 0.12, 0.18, false, white);

  const tex = new THREE.CanvasTexture(cv);
  return tex;
}

// ---------------------------------------------------------------------------
// Decorado: todo el chunk se fusiona en una geometría con colores por vértice
// -> 1 draw call de sólidos + 1 de ventanas encendidas por chunk.
// ---------------------------------------------------------------------------
function buildChunkGeometry(seed, half) {
  const rnd = mulberry32(seed);
  const solids = [];
  const glows = [];

  const add = (list, geo, color) => { list.push(paint(geo, color)); };
  const bx = (w, h, d, x, y, z) => {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(x, y, z);
    return g;
  };

  for (const side of [1, -1]) {
    const edge = side * (half + 0.1);

    // Bordillo
    add(solids, bx(1.6, 0.26, CHUNK_LEN, edge + side * 0.8, 0.13, CHUNK_LEN / 2), 0x9b9b96);

    // Quitamiedos
    add(solids, bx(0.1, 0.34, CHUNK_LEN, edge + side * 1.5, 0.85, CHUNK_LEN / 2), 0xb9bec6);
    for (let z = 2; z < CHUNK_LEN; z += 4) {
      add(solids, bx(0.14, 0.9, 0.14, edge + side * 1.5, 0.45, z), 0x8f949b);
    }

    // Farolas
    for (let z = 6; z < CHUNK_LEN; z += 30) {
      const x = edge + side * 2.2;
      add(solids, bx(0.22, 8, 0.22, x, 4, z), 0x6f747c);
      add(solids, bx(2.6, 0.2, 0.2, x - side * 1.3, 7.9, z), 0x6f747c);
      add(glows, bx(1.0, 0.18, 0.5, x - side * 2.2, 7.75, z), 0xffe9a8);
    }

    // Edificios y arbolado
    let z = rnd() * 10;
    while (z < CHUNK_LEN) {
      const depth = 10 + rnd() * 18;
      if (rnd() < 0.68) {
        const w = 9 + rnd() * 16;
        const h = 7 + rnd() * 40;
        const x = edge + side * (9 + rnd() * 16 + w / 2);
        const tint = [0x8a94a6, 0x6b7688, 0xa7b0c0, 0x7f8a9c, 0x5f6a7a][(rnd() * 5) | 0];
        add(solids, bx(w, h, depth, x, h / 2, z + depth / 2), tint);
        add(solids, bx(w + 0.8, 0.5, depth + 0.8, x, h + 0.2, z + depth / 2), 0x4d5666);

        // Ventanas encendidas (sólo se ven de noche)
        const rows = Math.max(1, Math.floor(h / 3.4));
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < 4; c++) {
            if (rnd() < 0.45) continue;
            const wy = 2.2 + r * 3.4;
            if (wy > h - 1) continue;
            const wz = z + 1.5 + (c + 0.5) * (depth - 3) / 4;
            add(glows, bx(0.15, 1.5, 1.4, x - side * (w / 2), wy, wz),
              rnd() < 0.25 ? 0xfff2c4 : 0xffd98a);
          }
        }
      } else {
        const n = 2 + ((rnd() * 3) | 0);
        for (let i = 0; i < n; i++) {
          const x = edge + side * (5 + rnd() * 16);
          const tz = z + rnd() * depth;
          const s = 0.8 + rnd() * 0.7;
          add(solids, bx(0.5 * s, 2.6 * s, 0.5 * s, x, 1.3 * s, tz), 0x5b3a21);
          const leaves = new THREE.IcosahedronGeometry(1.8 * s, 0);
          leaves.translate(x, 3.6 * s, tz);
          add(solids, leaves, 0x2f7a3c);
        }
      }
      z += depth + 2 + rnd() * 6;
    }
  }

  return {
    solid: mergeGeometries(solids),
    glow: glows.length ? mergeGeometries(glows) : new THREE.BufferGeometry(),
  };
}

function paint(geo, hex) {
  // Todo sin índices: así mergeGeometries puede mezclar cajas e icosaedros.
  if (geo.index) geo = geo.toNonIndexed();
  const c = new THREE.Color(hex).convertSRGBToLinear();
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  geo.deleteAttribute('uv');
  return geo;
}

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export { CHUNK_LEN, CHUNK_COUNT };
