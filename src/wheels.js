import * as THREE from 'three';

// Construye una rueda completa: neumático + llanta (varios estilos) +
// disco y pinza de freno. Eje de giro a lo largo de X (ancho del coche);
// la cara "bonita" mira hacia +X (exterior). CarModel la clona y espeja.

const TIRE_R = 0.34; // radio exterior del neumático (fitment fijo)

export function tireRadius() { return TIRE_R; }

// rimR según pulgadas: llanta más grande = perfil de goma más bajo.
function rimRadius(size) {
  const t = (THREE.MathUtils.clamp(size, 15, 20) - 15) / 5;
  return TIRE_R * (0.60 + t * 0.24);
}

export function buildWheel(cfg, env) {
  const g = new THREE.Group();
  const size = cfg.wheelSize;
  const rimR = rimRadius(size);
  const width = (cfg.widebody ? 0.30 : 0.26);
  const outer = width / 2;

  const rubber = new THREE.MeshStandardMaterial({ color: 0x0c0d10, roughness: 0.85, metalness: 0.0 });
  const rimMat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(cfg.wheelColor), metalness: 0.9, roughness: 0.28, envMap: env,
  });
  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x2a2d33, metalness: 0.85, roughness: 0.4, envMap: env });
  const discMat = new THREE.MeshStandardMaterial({ color: 0x8a8f98, metalness: 0.9, roughness: 0.35, envMap: env });
  const caliperMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(cfg.caliper), metalness: 0.5, roughness: 0.4 });

  // --- Neumático ---
  const tire = new THREE.Mesh(new THREE.CylinderGeometry(TIRE_R, TIRE_R, width, 40, 1, false), rubber);
  tire.rotation.z = Math.PI / 2; // eje del cilindro (Y) -> X
  tire.castShadow = true;
  g.add(tire);

  // Pequeña pared lateral / hueco de la goma
  const sidewall = new THREE.Mesh(new THREE.RingGeometry(rimR, TIRE_R, 40), rubber);
  sidewall.position.x = outer + 0.001;
  sidewall.rotation.y = -Math.PI / 2;
  g.add(sidewall);

  // --- Barril de la llanta ---
  const barrel = new THREE.Mesh(new THREE.CylinderGeometry(rimR, rimR, width * 0.96, 32, 1, true), barrelMat);
  barrel.rotation.z = Math.PI / 2;
  g.add(barrel);

  // --- Disco de freno + pinza (detrás, hacia -X) ---
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.74, rimR * 0.74, 0.03, 28), discMat);
  disc.rotation.z = Math.PI / 2;
  disc.position.x = -outer * 0.3;
  g.add(disc);

  const caliper = new THREE.Mesh(new THREE.BoxGeometry(0.05, rimR * 0.5, rimR * 0.34), caliperMat);
  caliper.position.set(-outer * 0.3, rimR * 0.55, 0);
  g.add(caliper);

  // --- Cara de la llanta con radios según estilo ---
  const faceX = outer - 0.015; // plano exterior de los radios
  const face = buildFace(cfg.wheelStyle, rimR, faceX, rimMat, barrelMat, env);
  g.add(face);

  return g;
}

// Devuelve un grupo con la cara/radios de la llanta.
function buildFace(style, rimR, x, rimMat, barrelMat, env) {
  const grp = new THREE.Group();

  // Aro exterior (lip) siempre presente.
  const lipMat = style === 'dish'
    ? new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 1.0, roughness: 0.12, envMap: env })
    : rimMat;
  const lip = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.94, rimR * 0.09, 12, 40), lipMat);
  lip.rotation.y = Math.PI / 2;
  lip.position.x = x - 0.02;
  grp.add(lip);

  // Buje central.
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.18, rimR * 0.18, 0.06, 20), rimMat);
  hub.rotation.z = Math.PI / 2;
  hub.position.x = x;
  grp.add(hub);

  const addSpokes = (count, wFrac, inner, outerR, mat = rimMat, twist = 0) => {
    const sw = rimR * wFrac;
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + twist;
      const len = outerR - inner;
      const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.05, len, sw), mat);
      const rMid = (inner + outerR) / 2;
      spoke.position.set(x - 0.01, Math.cos(a) * rMid, Math.sin(a) * rMid);
      spoke.rotation.x = -a;
      grp.add(spoke);
    }
  };

  switch (style) {
    case 'spoke5':
      addSpokes(5, 0.16, rimR * 0.16, rimR * 0.92);
      break;
    case 'split10':
      addSpokes(10, 0.07, rimR * 0.17, rimR * 0.9);
      break;
    case 'mesh':
      addSpokes(10, 0.045, rimR * 0.16, rimR * 0.9, rimMat, 0);
      addSpokes(10, 0.045, rimR * 0.16, rimR * 0.9, rimMat, Math.PI / 10);
      // anillo intermedio
      const ring = new THREE.Mesh(new THREE.TorusGeometry(rimR * 0.55, rimR * 0.03, 8, 36), rimMat);
      ring.rotation.y = Math.PI / 2;
      ring.position.x = x - 0.015;
      grp.add(ring);
      break;
    case 'dish':
      // Radios cortos y hondos: cara metida hacia dentro con lip ancho pulido.
      addSpokes(6, 0.12, rimR * 0.17, rimR * 0.7, rimMat);
      const dishFace = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.72, rimR * 0.72, 0.02, 28), rimMat);
      dishFace.rotation.z = Math.PI / 2;
      dishFace.position.x = x - 0.08;
      grp.add(dishFace);
      break;
    case 'steelie': {
      // Disco liso con agujeros de ventilación + tapa central.
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.9, rimR * 0.9, 0.03, 28), rimMat);
      disc.rotation.z = Math.PI / 2;
      disc.position.x = x - 0.03;
      grp.add(disc);
      const capMat = new THREE.MeshStandardMaterial({ color: 0xcfd3da, metalness: 1, roughness: 0.2, envMap: env });
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(rimR * 0.3, rimR * 0.3, 0.04, 18), capMat);
      cap.rotation.z = Math.PI / 2;
      cap.position.x = x + 0.005;
      grp.add(cap);
      // Tuercas simuladas
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2;
        const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.03, 6), capMat);
        bolt.rotation.z = Math.PI / 2;
        bolt.position.set(x + 0.01, Math.cos(a) * rimR * 0.55, Math.sin(a) * rimR * 0.55);
        grp.add(bolt);
      }
      break;
    }
    default:
      addSpokes(5, 0.16, rimR * 0.16, rimR * 0.92);
  }

  grp.traverse((c) => { if (c.isMesh) c.castShadow = true; });
  return grp;
}
