import * as THREE from 'three';

// Construye un mundo abierto sencillo: suelo, retícula de carreteras,
// edificios de alturas variadas y árboles. Todo procedural para no depender
// de assets, pero listo para mezclarse con modelos importados.
export function buildWorld(scene) {
  const world = new THREE.Group();
  scene.add(world);

  const HALF = 220;          // medio tamaño del mapa
  const BLOCK = 40;          // tamaño de manzana
  const ROAD_W = 12;         // ancho de carretera

  // ---- Suelo (césped) ----
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(HALF * 2, HALF * 2),
    new THREE.MeshStandardMaterial({ color: 0x1d5e34, roughness: 1 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  world.add(ground);

  // ---- Carreteras (rejilla) ----
  const roadMat = new THREE.MeshStandardMaterial({ color: 0x2b2f38, roughness: 0.9 });
  const lineMat = new THREE.MeshStandardMaterial({ color: 0xf5d33a, roughness: 0.6 });

  for (let c = -HALF; c <= HALF; c += BLOCK) {
    // Carretera vertical (a lo largo de Z)
    const rv = new THREE.Mesh(new THREE.PlaneGeometry(ROAD_W, HALF * 2), roadMat);
    rv.rotation.x = -Math.PI / 2;
    rv.position.set(c, 0.02, 0);
    rv.receiveShadow = true;
    world.add(rv);

    // Carretera horizontal (a lo largo de X)
    const rh = new THREE.Mesh(new THREE.PlaneGeometry(HALF * 2, ROAD_W), roadMat);
    rh.rotation.x = -Math.PI / 2;
    rh.position.set(0, 0.021, c);
    rh.receiveShadow = true;
    world.add(rh);

    // Líneas discontinuas centrales
    for (let d = -HALF; d < HALF; d += 8) {
      const lv = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 4), lineMat);
      lv.rotation.x = -Math.PI / 2;
      lv.position.set(c, 0.03, d + 2);
      world.add(lv);

      const lh = new THREE.Mesh(new THREE.PlaneGeometry(4, 0.4), lineMat);
      lh.rotation.x = -Math.PI / 2;
      lh.position.set(d + 2, 0.031, c);
      world.add(lh);
    }
  }

  // ---- Edificios y árboles dentro de cada manzana ----
  const buildingMats = [0x8a94a6, 0x6b7688, 0xa7b0c0, 0x9aa3b2, 0x7f8a9c]
    .map((color) => new THREE.MeshStandardMaterial({ color, roughness: 0.8 }));
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a21, roughness: 1 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f9e44, roughness: 1 });

  // PRNG determinista para que el mapa sea siempre igual.
  let seed = 1337;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };

  const boxGeo = new THREE.BoxGeometry(1, 1, 1);

  for (let bx = -HALF + BLOCK; bx < HALF; bx += BLOCK) {
    for (let bz = -HALF + BLOCK; bz < HALF; bz += BLOCK) {
      // Centro de la manzana (entre carreteras)
      const cx = bx - BLOCK / 2;
      const cz = bz - BLOCK / 2;

      if (rnd() < 0.75) {
        // Edificio
        const h = 8 + rnd() * 34;
        const w = 10 + rnd() * 12;
        const d = 10 + rnd() * 12;
        const mat = buildingMats[Math.floor(rnd() * buildingMats.length)];
        const b = new THREE.Mesh(boxGeo, mat);
        b.scale.set(w, h, d);
        b.position.set(cx, h / 2, cz);
        b.castShadow = true;
        b.receiveShadow = true;
        world.add(b);
      } else {
        // Grupo de árboles
        const n = 2 + Math.floor(rnd() * 4);
        for (let i = 0; i < n; i++) {
          const tx = cx + (rnd() - 0.5) * 20;
          const tz = cz + (rnd() - 0.5) * 20;
          world.add(makeTree(tx, tz, trunkMat, leafMat, 0.8 + rnd() * 0.8));
        }
      }
    }
  }

  return world;
}

function makeTree(x, z, trunkMat, leafMat, s) {
  const g = new THREE.Group();
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.4, 2.4, 8), trunkMat);
  trunk.position.y = 1.2;
  trunk.castShadow = true;
  g.add(trunk);
  const leaves = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 0), leafMat);
  leaves.position.y = 3.1;
  leaves.castShadow = true;
  g.add(leaves);
  g.position.set(x, 0, z);
  g.scale.setScalar(s);
  return g;
}
