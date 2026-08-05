import * as THREE from 'three';

// Construye la carrocería (chasis pintado + cristales + faros + kit) de forma
// paramétrica: cada tipo de coche es un conjunto de dimensiones que definen la
// silueta lateral; se extruye a lo ancho para darle volumen 3D.
// Devuelve { group, dims } — dims sirve para colocar las ruedas.

// Parámetros por modelo (en metros). +X = morro, +Z = lado derecho.
const MODELS = {
  coupe: { frontX: 2.15, rearX: -2.10, faxle: 1.35, raxle: -1.35, archR: 0.40, W: 1.82,
    fbump: 0.32, hoodY: 0.60, beltY: 0.80, roofY: 1.20, noseTopX: 1.95,
    wsX: 0.55, roofFX: -0.05, roofRX: -0.92, blX: -1.55 },
  hatch: { frontX: 1.95, rearX: -1.92, faxle: 1.20, raxle: -1.22, archR: 0.40, W: 1.80,
    fbump: 0.32, hoodY: 0.64, beltY: 0.82, roofY: 1.30, noseTopX: 1.78,
    wsX: 0.42, roofFX: 0.0, roofRX: -1.20, blX: -1.78 },
  sedan: { frontX: 2.28, rearX: -2.25, faxle: 1.45, raxle: -1.45, archR: 0.40, W: 1.84,
    fbump: 0.32, hoodY: 0.64, beltY: 0.82, roofY: 1.28, noseTopX: 2.05,
    wsX: 0.55, roofFX: 0.15, roofRX: -1.00, blX: -1.55 },
  muscle: { frontX: 2.40, rearX: -2.18, faxle: 1.50, raxle: -1.40, archR: 0.42, W: 1.92,
    fbump: 0.34, hoodY: 0.66, beltY: 0.80, roofY: 1.18, noseTopX: 2.20,
    wsX: 0.70, roofFX: 0.35, roofRX: -0.80, blX: -2.00 },
  super: { frontX: 2.20, rearX: -2.00, faxle: 1.35, raxle: -1.30, archR: 0.42, W: 1.94,
    fbump: 0.26, hoodY: 0.50, beltY: 0.66, roofY: 0.98, noseTopX: 2.10,
    wsX: 0.70, roofFX: 0.20, roofRX: -0.70, blX: -1.62 },
  kei: { frontX: 1.72, rearX: -1.70, faxle: 1.05, raxle: -1.12, archR: 0.40, W: 1.76,
    fbump: 0.40, hoodY: 0.82, beltY: 1.00, roofY: 1.56, noseTopX: 1.58,
    wsX: 0.78, roofFX: 0.72, roofRX: -1.52, blX: -1.62 },
};

export function modelDims(id) {
  const m = MODELS[id] || MODELS.coupe;
  return { faxle: m.faxle, raxle: m.raxle, halfW: m.W / 2, frontX: m.frontX, rearX: m.rearX };
}

// Silueta lateral como THREE.Shape, con arcos para los pasos de rueda.
function silhouette(m) {
  const s = new THREE.Shape();
  s.moveTo(m.frontX, 0);
  s.lineTo(m.frontX, m.fbump);
  s.quadraticCurveTo(m.frontX, m.hoodY, m.noseTopX, m.hoodY); // nariz redondeada
  s.lineTo(m.wsX, m.hoodY);                                   // capó
  s.lineTo(m.roofFX, m.roofY);                                // parabrisas
  s.lineTo(m.roofRX, m.roofY);                                // techo
  s.lineTo(m.blX, m.beltY);                                   // luna trasera
  s.lineTo(m.rearX, m.beltY - 0.04);                          // portón/maletero
  s.lineTo(m.rearX, 0);                                       // paragolpes trasero
  // Bajos: de atrás hacia delante con arcos de rueda.
  s.lineTo(m.raxle - m.archR, 0);
  s.absarc(m.raxle, 0, m.archR, Math.PI, 0, true);
  s.lineTo(m.faxle - m.archR, 0);
  s.absarc(m.faxle, 0, m.archR, Math.PI, 0, true);
  s.lineTo(m.frontX, 0);
  return s;
}

export function buildBody(cfg, mats, env) {
  const m = MODELS[cfg.model] || MODELS.coupe;
  const group = new THREE.Group();

  // --- Chasis: extrusión de la silueta a lo ancho ---
  const shape = silhouette(m);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: m.W, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05,
    bevelSegments: 2, steps: 1, curveSegments: 10,
  });
  geo.translate(0, 0, -m.W / 2); // centrar en Z
  geo.computeVertexNormals();
  const chassis = new THREE.Mesh(geo, mats.paint);
  chassis.castShadow = true;
  chassis.receiveShadow = true;
  group.add(chassis);

  // --- Cristales ---
  const halfGW = m.W / 2 - 0.015;
  // Laterales (banda de ventanillas)
  const sideGlass = new THREE.Shape();
  sideGlass.moveTo(m.wsX, m.beltY);
  sideGlass.lineTo(m.roofFX, m.roofY - 0.02);
  sideGlass.lineTo(m.roofRX, m.roofY - 0.02);
  sideGlass.lineTo(m.blX + 0.06, m.beltY);
  sideGlass.lineTo(m.wsX, m.beltY);
  const sgGeo = new THREE.ExtrudeGeometry(sideGlass, { depth: m.W * 0.9, bevelEnabled: false });
  sgGeo.translate(0, 0, -m.W * 0.45);
  group.add(new THREE.Mesh(sgGeo, mats.glass));

  // Parabrisas y luna trasera (planos a lo ancho para verlos de frente/detrás)
  group.add(quad(m.wsX, m.beltY, m.roofFX, m.roofY - 0.02, m.W * 0.84, mats.glass));
  group.add(quad(m.blX + 0.06, m.beltY, m.roofRX, m.roofY - 0.02, m.W * 0.84, mats.glass));

  // --- Faros y pilotos ---
  const headMat = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, emissive: 0x88bbff, emissiveIntensity: 0.35, metalness: 0.4, roughness: 0.2 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0xff2b2b, emissive: 0xff0000, emissiveIntensity: 0.5, metalness: 0.2, roughness: 0.3 });
  for (const sgn of [-1, 1]) {
    const hl = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.14, 0.34), headMat);
    hl.position.set(m.frontX - 0.05, m.fbump + 0.06, sgn * (m.W / 2 - 0.28));
    group.add(hl);
    const tl = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.16, 0.4), tailMat);
    tl.position.set(m.rearX + 0.02, m.beltY - 0.18, sgn * (m.W / 2 - 0.3));
    group.add(tl);
  }
  // Rejilla frontal
  const grille = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.18, m.W * 0.5),
    new THREE.MeshStandardMaterial({ color: 0x0a0b0e, metalness: 0.6, roughness: 0.5 }));
  grille.position.set(m.frontX - 0.02, m.fbump - 0.08, 0);
  group.add(grille);

  // Retrovisores
  for (const sgn of [-1, 1]) {
    const mir = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.09, 0.12), mats.paint);
    mir.position.set(m.wsX - 0.05, m.beltY + 0.06, sgn * (m.W / 2 + 0.05));
    group.add(mir);
  }

  // --- Kit aerodinámico ---
  addBodyKit(group, m, cfg, mats);

  return { group, dims: modelDims(cfg.model) };
}

// Un plano rectangular entre dos puntos del perfil (x1,y1)-(x2,y2), ancho w.
// Se orienta con una base explícita: eje X local = dirección del perfil,
// eje Y local = ancho del coche (Z mundial), normal = perpendicular a ambos.
const _q = { x: new THREE.Vector3(), y: new THREE.Vector3(0, 0, 1), z: new THREE.Vector3(), m: new THREE.Matrix4() };
function quad(x1, y1, x2, y2, w, mat) {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(len, w), mat);
  mesh.position.set((x1 + x2) / 2, (y1 + y2) / 2, 0);
  const ang = Math.atan2(y2 - y1, x2 - x1);
  _q.x.set(Math.cos(ang), Math.sin(ang), 0);
  _q.z.crossVectors(_q.x, _q.y);
  _q.m.makeBasis(_q.x, _q.y, _q.z);
  mesh.quaternion.setFromRotationMatrix(_q.m);
  return mesh;
}

function addBodyKit(group, m, cfg, mats) {
  const dark = new THREE.MeshStandardMaterial({ color: 0x101216, metalness: 0.3, roughness: 0.7 });

  // Splitter / faldón delantero
  if (cfg.splitter) {
    const sp = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, m.W * 0.96), dark);
    sp.position.set(m.frontX - 0.02, 0.03, 0);
    sp.castShadow = true;
    group.add(sp);
  }

  // Taloneras laterales
  if (cfg.skirts) {
    for (const sgn of [-1, 1]) {
      const len = (m.faxle - m.archR) - (m.raxle + m.archR);
      const sk = new THREE.Mesh(new THREE.BoxGeometry(len, 0.1, 0.06), dark);
      sk.position.set((m.faxle - m.archR + m.raxle + m.archR) / 2, 0.06, sgn * (m.W / 2 + 0.01));
      group.add(sk);
    }
  }

  // Ensanchado (widebody): aletas anchas sobre cada paso de rueda.
  if (cfg.widebody) {
    for (const ax of [m.faxle, m.raxle]) {
      for (const sgn of [-1, 1]) {
        const flare = new THREE.Mesh(
          new THREE.TorusGeometry(m.archR + 0.02, 0.09, 10, 24, Math.PI),
          mats.paint
        );
        flare.position.set(ax, 0.02, sgn * (m.W / 2 + 0.02));
        flare.rotation.y = Math.PI / 2;
        flare.castShadow = true;
        group.add(flare);
      }
    }
  }

  // Capó: toma de aire o rejillas de ventilación.
  if (cfg.hood === 'scoop') {
    const scoop = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.1, 0.5), mats.paint);
    scoop.position.set((m.noseTopX + m.wsX) / 2, m.hoodY + 0.05, 0);
    scoop.castShadow = true;
    group.add(scoop);
    const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.07, 0.44), dark);
    mouth.position.set((m.noseTopX + m.wsX) / 2 + 0.18, m.hoodY + 0.06, 0);
    group.add(mouth);
  } else if (cfg.hood === 'vented') {
    for (const sgn of [-1, 1]) {
      const vent = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.02, 0.14), dark);
      vent.position.set((m.noseTopX + m.wsX) / 2, m.hoodY + 0.01, sgn * 0.3);
      group.add(vent);
    }
  }

  // Alerón trasero
  addWing(group, m, cfg, mats, dark);
}

function addWing(group, m, cfg, mats, dark) {
  if (cfg.wing === 'none') return;
  if (cfg.wing === 'lip') {
    const lip = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, m.W * 0.86), mats.paint);
    lip.position.set(m.rearX + 0.08, m.beltY, 0);
    lip.rotation.z = 0.25;
    group.add(lip);
  } else if (cfg.wing === 'ducktail') {
    const dt = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.08, m.W * 0.88), mats.paint);
    dt.position.set(m.rearX + 0.28, m.beltY + 0.02, 0);
    dt.rotation.z = 0.35;
    dt.castShadow = true;
    group.add(dt);
  } else if (cfg.wing === 'gt') {
    // Dos soportes + ala ancha.
    for (const sgn of [-1, 1]) {
      const strut = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.05), dark);
      strut.position.set(m.rearX + 0.18, m.beltY + 0.14, sgn * m.W * 0.32);
      group.add(strut);
    }
    const wing = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.05, m.W * 1.02), mats.wing);
    wing.position.set(m.rearX + 0.18, m.beltY + 0.34, 0);
    wing.rotation.z = 0.12;
    wing.castShadow = true;
    group.add(wing);
    const end1 = m.W * 0.51;
    for (const sgn of [-1, 1]) {
      const plate = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.16, 0.03), dark);
      plate.position.set(m.rearX + 0.18, m.beltY + 0.34, sgn * end1);
      group.add(plate);
    }
  }
}
