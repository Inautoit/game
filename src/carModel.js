import * as THREE from 'three';
import { buildBody } from './body.js';
import { buildWheel, tireRadius } from './wheels.js';

// Ensambla el coche a partir de la configuración. Reconstruye la geometría
// solo cuando cambia algo "estructural"; los ajustes de postura (altura,
// camber, poke) se aplican por transformación, sin reconstruir.

const STRUCT_KEYS = ['model', 'paint', 'finish', 'wheelStyle', 'wheelColor',
  'wheelSize', 'tint', 'wing', 'splitter', 'skirts', 'widebody', 'caliper', 'hood'];

export class CarModel {
  constructor(env) {
    this.env = env;
    this.root = new THREE.Group();
    this.bodyPivot = new THREE.Group();   // sube/baja con la suspensión
    this.wheelsGroup = new THREE.Group();
    this.root.add(this.bodyPivot);
    this.root.add(this.wheelsGroup);
    this._sig = '';
    this._dims = null;
  }

  _signature(cfg) {
    return STRUCT_KEYS.map((k) => cfg[k]).join('|');
  }

  setConfig(cfg) {
    const sig = this._signature(cfg);
    if (sig !== this._sig) {
      this._sig = sig;
      this._rebuild(cfg);
    }
    this._applyStance(cfg);
  }

  _makeMaterials(cfg) {
    const color = new THREE.Color(cfg.paint);
    const base = { color, envMap: this.env, envMapIntensity: 1.1 };
    let paint;
    switch (cfg.finish) {
      case 'metallic':
        paint = new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.85, roughness: 0.34, clearcoat: 0.6, clearcoatRoughness: 0.2 });
        break;
      case 'matte':
        paint = new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.0, roughness: 0.92, clearcoat: 0.0 });
        break;
      case 'pearl':
        paint = new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.5, roughness: 0.22, clearcoat: 1.0, clearcoatRoughness: 0.08, sheen: 0.6, sheenColor: color.clone().offsetHSL(0.5, 0, 0) });
        break;
      case 'chrome':
        paint = new THREE.MeshPhysicalMaterial({ color: color.clone().lerp(new THREE.Color(0xffffff), 0.35), envMap: this.env, envMapIntensity: 1.6, metalness: 1.0, roughness: 0.05 });
        break;
      case 'gloss':
      default:
        paint = new THREE.MeshPhysicalMaterial({ ...base, metalness: 0.2, roughness: 0.32, clearcoat: 1.0, clearcoatRoughness: 0.08 });
    }

    const glass = new THREE.MeshPhysicalMaterial({
      color: new THREE.Color(0x05070b), metalness: 0.0, roughness: 0.06,
      envMap: this.env, envMapIntensity: 1.5, transparent: true,
      opacity: THREE.MathUtils.clamp(0.32 + cfg.tint * 0.55, 0.3, 0.92),
    });

    const wing = new THREE.MeshStandardMaterial({ color: 0x14161a, metalness: 0.45, roughness: 0.4, envMap: this.env });

    return { paint, glass, wing };
  }

  _rebuild(cfg) {
    disposeChildren(this.bodyPivot);
    disposeChildren(this.wheelsGroup);

    const mats = this._makeMaterials(cfg);
    const { group, dims } = buildBody(cfg, mats, this.env);
    this._dims = dims;
    this.bodyPivot.add(group);

    // Cuatro ruedas: [morro, cola] × [derecha, izquierda]
    const r = tireRadius();
    this._wheelHolders = [];
    const specs = [
      [dims.faxle, 1], [dims.faxle, -1], [dims.raxle, 1], [dims.raxle, -1],
    ];
    for (const [x, side] of specs) {
      const holder = new THREE.Group();
      const inner = buildWheel(cfg, this.env);
      inner.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2; // cara hacia fuera
      holder.add(inner);
      holder.userData = { x, side, r };
      this.wheelsGroup.add(holder);
      this._wheelHolders.push(holder);
    }
  }

  _applyStance(cfg) {
    // Altura de suspensión: sube/baja la carrocería (las ruedas quedan en el suelo).
    this.bodyPivot.position.y = cfg.rideHeight;

    const camberRad = THREE.MathUtils.degToRad(cfg.camber);
    for (const h of this._wheelHolders) {
      const { x, side, r } = h.userData;
      const halfW = this._dims.halfW;
      const z = side * (halfW - 0.03 + cfg.poke);
      h.position.set(x, r, z);
      // Camber negativo: parte superior de la rueda hacia dentro.
      h.rotation.x = -side * camberRad;
    }
  }
}

function disposeChildren(group) {
  for (let i = group.children.length - 1; i >= 0; i--) {
    const c = group.children[i];
    c.traverse?.((n) => {
      if (n.geometry) n.geometry.dispose();
      if (n.material) {
        (Array.isArray(n.material) ? n.material : [n.material]).forEach((m) => m.dispose());
      }
    });
    group.remove(c);
  }
}
