import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, simplifyPrimitive, compactPrimitive,
  textureCompress, meshopt, getBounds, getGLPrimitiveCount,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';
import sharp from 'sharp';

// Uso: node tools/optimize-model.mjs <entrada.glb> [salida.glb]
//
// Deja el modelo listo para móvil: quita los UV que no usa ningún material,
// simplifica cada malla (el interior apenas se ve en 3ª persona), pasa las
// texturas a WebP 1024 y comprime geometría con meshopt.
// 26,5 MB -> 3,1 MB y 433k -> 187k triángulos.
const SRC = process.argv[2] || 'UrusM.glb';
const DST = process.argv[3] || 'assets/urus.glb';

// Cuánto conservar de cada malla. El interior casi no se ve en 3ª persona.
const RATIOS = [
  [/^intoer/i, 0.10],
  [/^wheel/i, 0.30],
  [/^bump/i, 0.28],
  [/^(rr|lr|door_rf|door_lf|boot|bonnet|exctx|suijijian)/i, 0.40],
  [/^ligthd/i, 0.35],
  [/glass|windscreen/i, 1.0],
];
const ratioFor = (name) => (RATIOS.find(([re]) => re.test(name)) || [null, 0.45])[1];

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });
const doc = await io.read(SRC);
const root = doc.getRoot();

const triCount = () => root.listMeshes().reduce((a, m) =>
  a + m.listPrimitives().reduce((b, p) => b + getGLPrimitiveCount(p), 0), 0);
const before = triCount();

// 1) Fuera los UV extra: los materiales sólo usan TEXCOORD_0.
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    for (const sem of prim.listSemantics()) {
      if (/^TEXCOORD_[1-9]/.test(sem)) prim.setAttribute(sem, null);
      if (/^COLOR_|^TANGENT/.test(sem)) prim.setAttribute(sem, null);
    }
  }
}

// 2) Unificar mallas/materiales/accessors duplicados (las 4 ruedas son iguales).
await doc.transform(dedup(), prune({ keepAttributes: false, keepLeaves: false }));

// 3) Soldar vértices y simplificar malla a malla.
await doc.transform(weld({ tolerance: 0.0001 }));

for (const mesh of root.listMeshes()) {
  const ratio = ratioFor(mesh.getName() || '');
  if (ratio >= 1) continue;
  for (const prim of mesh.listPrimitives()) {
    const tris = prim.getIndices() ? prim.getIndices().getCount() / 3 : 0;
    if (tris < 200) continue; // piezas pequeñas: se rompen al simplificar
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.0015, lockBorder: false });
    compactPrimitive(prim);
  }
}

await doc.transform(prune({ keepAttributes: false, keepLeaves: false }), dedup());

// 4) Backface culling en todo lo opaco (gran ahorro de fill-rate en móvil).
for (const mat of root.listMaterials()) {
  if (mat.getAlphaMode() === 'OPAQUE') mat.setDoubleSided(false);
}

// 5) Texturas -> WebP, máx 1024 px.
await doc.transform(
  textureCompress({ encoder: sharp, targetFormat: 'webp', resize: [1024, 1024], quality: 82 }),
);

// 6) Cuantización + compresión meshopt.
await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

const bounds = getBounds(root.listScenes()[0]);
console.log('bbox min', bounds.min.map((v) => +v.toFixed(3)));
console.log('bbox max', bounds.max.map((v) => +v.toFixed(3)));
console.log('tris', before, '->', triCount());

await io.write(DST, doc);
