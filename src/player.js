import * as THREE from 'three';
import { PLAYER } from './config.js';

// El Lamborghini Urus del jugador.
// El modelo viene mirando hacia -X, así que lo giramos 90° para que el morro
// apunte a +Z (la dirección de avance del juego).
const MODEL_YAW = Math.PI / 2;
const WHEEL_NAMES = [
  ['wheelFL', true], ['wheelFR', true],
  ['wheelRL', false], ['wheelRR', false],
];

export class Player {
  constructor() {
    this.group = new THREE.Group();     // posición en el mundo
    this.body = new THREE.Group();      // balanceo/cabeceo
    this.group.add(this.body);

    this.speed = 0;
    this.lateral = 0;                   // m/s en X
    this.x = 0;
    this.yaw = 0;
    this.roll = 0;
    this.nitro = 0;
    this.nitroActive = 0;               // segundos restantes
    this.crashed = false;
    this.crashSpin = 0;

    this.halfWidth = PLAYER.halfWidth;
    this.halfLength = PLAYER.halfLength;
    this.wheels = [];
    this.wheelRadius = 0.4;
    this.paintMaterials = [];
    this.lightMaterials = [];

    this.shadow = makeBlobShadow(5.4, 2.6);
    this.group.add(this.shadow);

    this._buildLights();
  }

  setModel(root) {
    root.updateMatrixWorld(true);

    // Ruedas: pivote de dirección (Y) > pivote de giro (Z) > rueda.
    for (const [name, isFront] of WHEEL_NAMES) {
      const wheel = root.getObjectByName(name);
      if (!wheel) continue;
      const box = new THREE.Box3().setFromObject(wheel);
      const center = box.getCenter(new THREE.Vector3());
      const parent = wheel.parent;
      parent.worldToLocal(center);

      const steer = new THREE.Object3D();
      steer.position.copy(center);
      const spin = new THREE.Object3D();
      steer.add(spin);
      parent.add(steer);

      wheel.position.sub(center);
      spin.add(wheel);

      this.wheelRadius = Math.max(this.wheelRadius, (box.max.y - box.min.y) / 2);
      this.wheels.push({ steer, spin, isFront });
    }

    // Volante: gira sobre el eje longitudinal del modelo (X).
    const sw = root.getObjectByName('steeringwheel');
    if (sw) {
      const box = new THREE.Box3().setFromObject(sw);
      const center = box.getCenter(new THREE.Vector3());
      sw.parent.worldToLocal(center);
      const pivot = new THREE.Object3D();
      pivot.position.copy(center);
      sw.parent.add(pivot);
      sw.position.sub(center);
      pivot.add(sw);
      this.steeringWheel = pivot;
    }

    root.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        if (m.isMeshStandardMaterial) m.envMapIntensity = 1.0;
        if (/^primary/i.test(m.name || '') && !this.paintMaterials.includes(m)) {
          this.paintMaterials.push(m);
        }
        // Faros y pilotos del propio modelo: de noche los encendemos.
        if (/light/i.test(m.name || '') && !this.lightMaterials.includes(m)) {
          this.lightMaterials.push(m);
          m.userData.rear = /rear|signal/i.test(m.name);
        }
      }
    });

    // Escalar a la longitud real de un Urus y apoyarlo en el suelo.
    const holder = new THREE.Group();
    holder.rotation.y = MODEL_YAW;
    holder.add(root);
    this.body.add(holder);

    const box = new THREE.Box3().setFromObject(holder);
    const size = box.getSize(new THREE.Vector3());
    const scale = PLAYER.length / size.z;
    holder.scale.setScalar(scale);
    holder.position.y = -box.min.y * scale;

    this.halfWidth = (size.x * scale) / 2;
    this.halfLength = (size.z * scale) / 2;
    this.wheelRadius *= scale;
    this.model = holder;

    this.shadow.scale.set((size.x * scale) / 5.4 * 1.15, 1, (size.z * scale) / 2.6 * 1.05);
    this.lightGroup.position.z = this.halfLength;
  }

  setPaint(hex) {
    this.paint = hex;
    for (const m of this.paintMaterials) {
      // La textura original trae el color de fábrica: la quitamos para que
      // el color elegido se vea limpio.
      if (m.map) { m.map = null; }
      m.color.setHex(hex);
      m.metalness = 0.72;
      m.roughness = 0.26;
      m.envMapIntensity = 1.35;
      m.needsUpdate = true;
    }
  }

  setEnvIntensity(v) {
    this.model?.traverse((o) => {
      if (!o.isMesh) return;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m?.isMeshStandardMaterial) continue;
        m.envMapIntensity = this.paintMaterials.includes(m) ? v * 1.35 : v;
      }
    });
  }

  _buildLights() {
    this.lightGroup = new THREE.Group();
    this.body.add(this.lightGroup);

    // Charco de luz en el asfalto
    this.beam = new THREE.Mesh(
      new THREE.PlaneGeometry(9, 26),
      new THREE.MeshBasicMaterial({
        map: makeBeamTexture(), transparent: true, opacity: 0.34,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
    );
    this.beam.rotation.x = -Math.PI / 2;
    this.beam.position.set(0, 0.05, 13.5);
    this.lightGroup.add(this.beam);

    this.lightGroup.visible = false;
  }

  setNight(on) {
    this.lightGroup.visible = on;
    for (const m of this.lightMaterials) {
      if (on) {
        m.emissive.copy(m.color);
        if (m.map && !m.emissiveMap) m.emissiveMap = m.map;
        m.emissiveIntensity = m.userData.rear ? 1.6 : 2.2;
      } else {
        m.emissive.setHex(0x000000);
        m.emissiveIntensity = 1;
      }
      m.needsUpdate = true;
    }
  }

  reset(x) {
    this.speed = 0;
    this.lateral = 0;
    this.x = x;
    this.yaw = 0;
    this.roll = 0;
    this.nitro = 0;
    this.nitroActive = 0;
    this.crashed = false;
    this.crashSpin = 0;
    this.group.position.set(x, 0, 0);
    this.group.rotation.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
  }

  get speedKmh() { return Math.round(this.speed * 3.6); }
  get maxSpeed() { return this.nitroActive > 0 ? PLAYER.nitroSpeed : PLAYER.maxSpeed; }

  addNitro(v) { this.nitro = Math.min(PLAYER.nitroMax, this.nitro + v); }

  tryNitro() {
    if (this.nitro < PLAYER.nitroMax * 0.35 || this.nitroActive > 0) return false;
    this.nitroActive = 3.2;
    this.nitro = 0;
    return true;
  }

  update(dt, input, roadHalf) {
    if (this.crashed) return this._updateCrash(dt);

    if (this.nitroActive > 0) this.nitroActive = Math.max(0, this.nitroActive - dt);

    // --- Motor ---
    const t = input.throttle;
    const max = this.maxSpeed;
    if (t > 0) {
      const power = this.nitroActive > 0 ? 20 : 12;
      const curve = 1 - Math.min(1, this.speed / max) * 0.72;
      this.speed += power * curve * dt;
    } else if (t < 0) {
      this.speed -= PLAYER.brake * dt;
    }
    this.speed -= (PLAYER.drag * this.speed * this.speed + PLAYER.rollResist * (t > 0 ? 0.25 : 1)) * dt;
    this.speed = Math.max(0, Math.min(max, this.speed));

    // --- Movimiento lateral ---
    // A poca velocidad el coche responde menos: da sensación de peso.
    const grip = 0.45 + 0.55 * Math.min(1, this.speed / 26);
    const target = input.steer * PLAYER.lateralMax * grip;
    const k = 1 - Math.pow(0.0008, dt);
    this.lateral += (target - this.lateral) * k;
    this.x += this.lateral * dt;

    // Límite de calzada: rozar el borde frena.
    const limit = roadHalf - this.halfWidth - 0.1;
    this.scraping = false;
    if (Math.abs(this.x) > limit) {
      this.x = Math.sign(this.x) * limit;
      this.lateral *= 0.2;
      this.speed = Math.max(0, this.speed - 26 * dt);
      this.scraping = this.speed > 4;
    }

    // --- Postura del coche ---
    const lat = this.lateral / PLAYER.lateralMax;
    this.yaw += (lat * 0.20 - this.yaw) * Math.min(1, dt * 9);
    this.roll += (-lat * 0.055 - this.roll) * Math.min(1, dt * 7);

    // A tope de velocidad el chasis vibra un poco: se nota en el bajo.
    this._t = (this._t || 0) + dt;
    const sr = this.speed / PLAYER.maxSpeed;
    const buzz = Math.sin(this._t * 33) * 0.0035 * sr * sr;

    this.group.position.set(this.x, 0, 0);
    this.group.rotation.y = this.yaw;
    this.body.rotation.z = this.roll + buzz;
    this.body.rotation.x = THREE.MathUtils.clamp(
      (t < 0 ? 0.018 : 0) - (t > 0 ? this.speed / max * 0.010 : 0), -0.02, 0.02);

    this._spinWheels(dt, input.steer);
  }

  _spinWheels(dt, steer) {
    const spin = (this.speed * dt) / this.wheelRadius;
    for (const w of this.wheels) {
      w.spin.rotation.z += spin;
      if (w.isFront) w.steer.rotation.y += (steer * -0.42 - w.steer.rotation.y) * Math.min(1, dt * 12);
    }
    if (this.steeringWheel) {
      this.steeringWheel.rotation.x += (steer * -2.1 - this.steeringWheel.rotation.x) * Math.min(1, dt * 10);
    }
  }

  crash(sideImpulse = 0) {
    if (this.crashed) return;
    this.crashed = true;
    this.crashSpin = (sideImpulse || (Math.random() - 0.5)) * 3.2;
    this.nitroActive = 0;
  }

  _updateCrash(dt) {
    this.speed = Math.max(0, this.speed - 30 * dt);
    this.x += this.lateral * dt;
    this.lateral *= 1 - Math.min(1, dt * 1.6);
    this.yaw += this.crashSpin * dt;
    this.crashSpin *= 1 - Math.min(1, dt * 1.1);
    this.roll += (Math.sin(this.yaw * 2) * 0.05 - this.roll) * Math.min(1, dt * 4);
    this.group.position.set(this.x, 0, 0);
    this.group.rotation.y = this.yaw;
    this.body.rotation.z = this.roll;
    this._spinWheels(dt, 0);
  }
}

// ---------------------------------------------------------------------------
let shadowTex = null;
export function blobShadowTexture() {
  if (shadowTex) return shadowTex;
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 4, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.55, 'rgba(0,0,0,0.32)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  shadowTex = new THREE.CanvasTexture(cv);
  return shadowTex;
}

function makeBlobShadow(len, wid) {
  const m = new THREE.Mesh(
    new THREE.PlaneGeometry(wid, len),
    new THREE.MeshBasicMaterial({
      map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.9,
    }),
  );
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.02;
  m.renderOrder = -1;
  return m;
}

function makeBeamTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, 'rgba(255,244,214,0.55)');
  g.addColorStop(0.5, 'rgba(255,240,200,0.18)');
  g.addColorStop(1, 'rgba(255,240,200,0)');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(24, 128); ctx.lineTo(40, 128); ctx.lineTo(62, 0); ctx.lineTo(2, 0);
  ctx.closePath();
  ctx.fill();
  return new THREE.CanvasTexture(cv);
}
