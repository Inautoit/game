import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import {
  dedup, prune, weld, flatten, join, dequantize, meshopt,
  simplifyPrimitive, compactPrimitive, getGLPrimitiveCount, getBounds,
} from '@gltf-transform/functions';
import { MeshoptSimplifier, MeshoptEncoder, MeshoptDecoder } from 'meshoptimizer';

// Genera la versión ligera del Urus que conducen los rivales en el duelo.
//
// El modelo bueno son 171 primitivas: cinco rivales serían 855 llamadas de
// dibujado y ningún móvil aguanta eso. Aquí se tira el interior entero (a un
// rival no se le ve por dentro), se reducen los 46 materiales a cinco y se
// funde todo lo que comparte material, de modo que cada rival cuesta cinco
// llamadas en vez de 171.
//
// Uso: node tools/make-rival.mjs [entrada.glb] [salida.glb]
const SRC = process.argv[2] || 'assets/urus.glb';
const DST = process.argv[3] || 'assets/urus-rival.glb';
const TARGET_TRIS = 12000;

await MeshoptSimplifier.ready;
await MeshoptEncoder.ready;

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ 'meshopt.encoder': MeshoptEncoder, 'meshopt.decoder': MeshoptDecoder });

const doc = await io.read(SRC);
const root = doc.getRoot();
await doc.transform(dequantize());

const triCount = () => root.listMeshes().reduce((a, m) =>
  a + m.listPrimitives().reduce((b, p) => b + getGLPrimitiveCount(p), 0), 0);
const primCount = () => root.listMeshes().reduce((a, m) => a + m.listPrimitives().length, 0);

console.log('entrada:', triCount(), 'triángulos en', primCount(), 'primitivas');

// --- Cinco materiales planos, sin texturas ---------------------------------
const flat = (name, rgba, metallic, roughness, blend) => {
  const m = doc.createMaterial(name)
    .setBaseColorFactor(rgba)
    .setMetallicFactor(metallic)
    .setRoughnessFactor(roughness)
    .setDoubleSided(false);
  if (blend) m.setAlphaMode('BLEND');
  return m;
};

// La pintura se deja blanca a propósito: el color lo pone cada jugador desde
// el juego multiplicando por este material.
const paint = flat('paint', [1, 1, 1, 1], 0.75, 0.3, false);
// Cristales casi opacos: como el interior se ha tirado, unos cristales
// claros dejarían ver el hueco de dentro.
const glass = flat('glass', [0.03, 0.035, 0.05, 0.94], 0.2, 0.08, true);
const trim = flat('trim', [0.08, 0.085, 0.1, 1], 0.35, 0.55, false);
const lightF = flat('lightFront', [1, 0.95, 0.82, 1], 0, 0.3, false);
const lightR = flat('lightRear', [0.85, 0.06, 0.04, 1], 0, 0.35, false);

const classify = (name = '') => {
  if (/^intoer|^int_page/i.test(name)) return null;              // interior: fuera
  if (/^primary/i.test(name)) return paint;
  if (/glass|windscreen/i.test(name)) return glass;
  if (/rear light|signallight/i.test(name)) return lightR;
  if (/light/i.test(name)) return lightF;
  return trim;
};

let dropped = 0;
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const target = classify(prim.getMaterial()?.getName());
    if (!target) { mesh.removePrimitive(prim); dropped++; continue; }
    prim.setMaterial(target);
    for (const semantic of prim.listSemantics()) {
      if (semantic !== 'POSITION' && semantic !== 'NORMAL') prim.setAttribute(semantic, null);
    }
  }
}
console.log('primitivas de interior tiradas:', dropped);

await doc.transform(prune({ keepAttributes: false, keepLeaves: false }), dedup());

// --- Fundir todo lo que comparte material ----------------------------------
await doc.transform(flatten(), join({ keepNamed: false }), dedup());
console.log('tras fundir:', triCount(), 'triángulos en', primCount(), 'primitivas');

// --- Simplificar sobre la malla ya fundida, que da mucho mejor resultado ---
const ratio = Math.min(1, TARGET_TRIS / triCount());
await doc.transform(weld({ tolerance: 0.0002 }));
for (const mesh of root.listMeshes()) {
  for (const prim of mesh.listPrimitives()) {
    const tris = prim.getIndices() ? prim.getIndices().getCount() / 3 : 0;
    if (tris < 400) continue;
    // Margen de error generoso a propósito: un rival se ve a diez metros y
    // en movimiento, la silueta importa mucho más que el detalle.
    simplifyPrimitive(prim, { simplifier: MeshoptSimplifier, ratio, error: 0.05, lockBorder: false });
    compactPrimitive(prim);
  }
}
await doc.transform(prune({ keepAttributes: false, keepLeaves: false }), dedup());

// Fuera todas las texturas: este modelo es de colores planos.
for (const tex of root.listTextures()) tex.dispose();

await doc.transform(meshopt({ encoder: MeshoptEncoder, level: 'high' }));

const b = getBounds(root.listScenes()[0]);
console.log('salida:', triCount(), 'triángulos en', primCount(), 'primitivas');
console.log('bbox', b.min.map((v) => +v.toFixed(2)), b.max.map((v) => +v.toFixed(2)));

await io.write(DST, doc);
