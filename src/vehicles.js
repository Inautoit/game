import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// Vehículos de tráfico procedurales: low-poly a propósito para que el móvil
// pueda dibujar 18 a la vez con 2 draw calls por tipo (InstancedMesh).
//
// Cada tipo devuelve dos geometrías:
//   body -> se pinta con color por instancia (la chapa)
//   trim -> ruedas, cristales y parachoques (siempre oscuro)

function box(w, h, d, x, y, z) {
  const g = new THREE.BoxGeometry(w, h, d);
  g.translate(x, y, z);
  return g;
}

function wheels(halfW, radius, width, positions) {
  return positions.map(([x, z]) => {
    const g = new THREE.CylinderGeometry(radius, radius, width, 10);
    g.rotateZ(Math.PI / 2);
    g.translate(x * halfW, radius, z);
    return g;
  });
}

function makeCar() {
  const body = mergeGeometries([
    box(1.82, 0.62, 4.2, 0, 0.72, 0),
    box(1.62, 0.52, 2.2, 0, 1.24, -0.15),
  ]);
  const trim = mergeGeometries([
    box(1.5, 0.36, 0.06, 0, 1.3, 0.95),      // luna delantera
    box(1.5, 0.34, 0.06, 0, 1.3, -1.22),     // luna trasera
    box(0.06, 0.34, 1.9, 0.78, 1.3, -0.15),  // ventanillas
    box(0.06, 0.34, 1.9, -0.78, 1.3, -0.15),
    box(1.86, 0.2, 0.22, 0, 0.6, 2.05),
    box(1.86, 0.2, 0.22, 0, 0.6, -2.05),
    ...wheels(0.92, 0.33, 0.24, [[1, 1.35], [-1, 1.35], [1, -1.35], [-1, -1.35]]),
  ]);
  return { body, trim, size: [1.9, 1.6, 4.4] };
}

function makeVan() {
  const body = mergeGeometries([
    box(2.0, 1.5, 5.0, 0, 1.05, -0.2),
    box(1.94, 0.7, 1.4, 0, 0.65, 2.1),
  ]);
  const trim = mergeGeometries([
    box(1.7, 0.5, 0.06, 0, 1.35, 2.75),
    box(0.06, 0.45, 1.0, 0.96, 1.35, 2.1),
    box(0.06, 0.45, 1.0, -0.96, 1.35, 2.1),
    box(2.04, 0.22, 0.24, 0, 0.55, 2.82),
    box(2.04, 0.22, 0.24, 0, 0.55, -2.68),
    ...wheels(1.0, 0.38, 0.26, [[1, 1.9], [-1, 1.9], [1, -1.7], [-1, -1.7]]),
  ]);
  return { body, trim, size: [2.1, 2.3, 5.6] };
}

function makeTruck() {
  const body = mergeGeometries([
    box(2.4, 1.9, 2.6, 0, 1.35, 2.6),         // cabina
    box(2.5, 2.5, 6.6, 0, 1.75, -1.5),        // caja
  ]);
  const trim = mergeGeometries([
    box(2.0, 0.7, 0.08, 0, 1.85, 3.86),
    box(0.08, 0.6, 1.2, 1.16, 1.8, 2.7),
    box(0.08, 0.6, 1.2, -1.16, 1.8, 2.7),
    box(2.44, 0.3, 0.3, 0, 0.5, 3.9),
    box(2.5, 0.3, 0.3, 0, 0.6, -4.8),
    ...wheels(1.15, 0.5, 0.3, [[1, 2.7], [-1, 2.7], [1, -2.2], [-1, -2.2], [1, -3.6], [-1, -3.6]]),
  ]);
  return { body, trim, size: [2.6, 3.3, 8.6] };
}

function makeBus() {
  const body = box(2.5, 2.6, 10.4, 0, 1.75, 0);
  const parts = [
    box(2.1, 0.9, 0.08, 0, 2.1, 5.24),
    box(2.1, 0.8, 0.08, 0, 2.1, -5.24),
    box(2.54, 0.32, 0.3, 0, 0.5, 5.2),
    box(2.54, 0.32, 0.3, 0, 0.5, -5.2),
  ];
  for (let i = -3; i <= 3; i++) {
    parts.push(box(0.08, 0.8, 1.1, 1.22, 2.1, i * 1.35));
    parts.push(box(0.08, 0.8, 1.1, -1.22, 2.1, i * 1.35));
  }
  parts.push(...wheels(1.15, 0.5, 0.3, [[1, 3.7], [-1, 3.7], [1, -3.2], [-1, -3.2]]));
  return { body, trim: mergeGeometries(parts), size: [2.6, 3.4, 10.6] };
}

export const VEHICLE_TYPES = [
  { id: 'car', make: makeCar, weight: 0.56, speed: [21, 32], max: 10 },
  { id: 'van', make: makeVan, weight: 0.2, speed: [18, 26], max: 5 },
  { id: 'truck', make: makeTruck, weight: 0.14, speed: [15, 22], max: 4 },
  { id: 'bus', make: makeBus, weight: 0.1, speed: [14, 20], max: 3 },
];

export const PAINTS = [
  0xd8dee6, 0x2b2f36, 0xb4232b, 0x1d4ed8, 0xe0a615, 0x2f7d4f,
  0x9aa2ad, 0xef6c1a, 0x6b4bb0, 0x0f9bb5, 0xf2f4f7, 0x5c626b,
];
