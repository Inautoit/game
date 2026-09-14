import * as THREE from 'three';
import { VEHICLE_TYPES } from './vehicles.js';
import { PAINT_OPTIONS } from './ui.js';
import { blobShadowTexture } from './player.js';

// Los rivales del duelo. No se dibujan con el Urus de 187k triángulos —
// cinco copias serían casi un millón— sino con el coche low-poly del
// tráfico, pintado del color que cada uno haya elegido, y con su nombre
// encima.
//
// Como tu coche nunca se mueve en Z, colocar a un rival es trivial:
//   z = suDistancia - miDistancia
// Si va 30 metros por delante, se dibuja en +30.

const VISIBLE_RANGE = 420;

export class Remotes {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cars = new Map();

    const proto = VEHICLE_TYPES[0].make();
    this.bodyGeo = proto.body;
    this.trimGeo = proto.trim;
    this.shadowGeo = new THREE.PlaneGeometry(2.6, 5.2).rotateX(-Math.PI / 2);
    this.haloGeo = new THREE.PlaneGeometry(5.4, 7.2).rotateX(-Math.PI / 2);
    this.haloTex = makeHaloTexture();
  }

  sync(players, meId) {
    const seen = new Set();
    for (const p of players) {
      if (p.id === meId) continue;
      seen.add(p.id);
      if (!this.cars.has(p.id)) this.cars.set(p.id, this._make(p));
    }
    for (const [id, car] of this.cars) {
      if (!seen.has(id)) { this._dispose(car); this.cars.delete(id); }
    }
  }

  _make(player) {
    const hex = PAINT_OPTIONS[player.paint % PAINT_OPTIONS.length]?.hex ?? 0xd8dee6;
    const group = new THREE.Group();

    const paint = new THREE.MeshLambertMaterial({ color: hex, transparent: true });
    const trim = new THREE.MeshLambertMaterial({ color: 0x14161a, transparent: true });
    group.add(new THREE.Mesh(this.bodyGeo, paint));
    group.add(new THREE.Mesh(this.trimGeo, trim));

    const shadowMat = new THREE.MeshBasicMaterial({
      map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.8,
    });
    const shadow = new THREE.Mesh(this.shadowGeo, shadowMat);
    shadow.position.y = 0.02;
    shadow.renderOrder = -1;
    group.add(shadow);

    // Anillo de color en el asfalto. Sin esto un rival es indistinguible de
    // un coche del tráfico, que usa el mismo modelo.
    const haloMat = new THREE.MeshBasicMaterial({
      map: this.haloTex, color: hex, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const halo = new THREE.Mesh(this.haloGeo, haloMat);
    halo.position.y = 0.04;
    halo.renderOrder = 1;
    group.add(halo);

    const label = makeLabel(player.name);
    label.position.y = 2.6;
    group.add(label);

    group.visible = false;
    this.group.add(group);

    return {
      id: player.id, group, materials: [paint, trim, shadowMat, haloMat], label, halo,
      d: 0, x: 0, yaw: 0, vel: 0, nitro: 0,
      targetD: 0, targetX: 0, targetYaw: 0,
      crashed: false, crashSpin: 0, crashAge: 0, started: false,
    };
  }

  _dispose(car) {
    this.group.remove(car.group);
    for (const m of car.materials) m.dispose();
    car.label.material.map?.dispose();
    car.label.material.dispose();
  }

  // Llega un paquete de posición: fijamos el objetivo, no saltamos a él.
  onState(msg) {
    const car = this.cars.get(msg.id);
    if (!car || car.crashed) return;
    car.targetD = msg.d;
    car.targetX = msg.x;
    car.targetYaw = msg.y;
    car.vel = msg.v;
    car.nitro = msg.n;
    if (!car.started) {
      car.started = true;
      car.d = msg.d; car.x = msg.x; car.yaw = msg.y;
    }
  }

  onCrash(id) {
    const car = this.cars.get(id);
    if (!car || car.crashed) return;
    car.crashed = true;
    car.crashAge = 0;
    car.crashSpin = (Math.random() - 0.5) * 3.4;
  }

  reset() {
    for (const car of this.cars.values()) {
      Object.assign(car, {
        d: 0, x: 0, yaw: 0, vel: 0, targetD: 0, targetX: 0, targetYaw: 0,
        crashed: false, crashSpin: 0, crashAge: 0, started: false,
      });
      car.group.visible = false;
      setFade(car, 1);
    }
  }

  clear() {
    for (const car of this.cars.values()) this._dispose(car);
    this.cars.clear();
  }

  // myDistance = metros que llevo yo. De ahí sale la Z de cada rival.
  tick(dt, myDistance) {
    for (const car of this.cars.values()) {
      if (!car.started) continue;

      if (car.crashed) {
        car.crashAge += dt;
        car.vel = Math.max(0, car.vel - 34 * dt);
        car.targetD += car.vel * dt;
        car.yaw += car.crashSpin * dt;
        car.crashSpin *= 1 - Math.min(1, dt * 1.2);
        const fade = 1 - Math.max(0, Math.min(1, (car.crashAge - 3) / 2));
        setFade(car, fade);
        if (fade <= 0) { car.group.visible = false; continue; }
      } else {
        // Entre paquete y paquete avanzamos por estima con su velocidad.
        car.targetD += car.vel * dt;
        car.yaw += (car.targetYaw - car.yaw) * Math.min(1, dt * 8);
      }

      const k = Math.min(1, dt * 9);
      car.d += (car.targetD - car.d) * k;
      car.x += (car.targetX - car.x) * k;

      const z = car.d - myDistance;
      const visible = Math.abs(z) < VISIBLE_RANGE;
      car.group.visible = visible;
      if (!visible) continue;

      car.group.position.set(car.x, 0, z);
      car.group.rotation.y = car.yaw;
      // El cartel se ve desde casi encima hasta el fondo de la niebla.
      const far = Math.abs(z);
      car.label.material.opacity = Math.max(0, Math.min(1,
        Math.min((far - 3) / 5, 1 - (far - 230) / 90)));
      if (!car.crashed) {
        car.halo.material.opacity = 0.62 + 0.22 * Math.sin(performance.now() * 0.005);
      }
    }
  }

  // Distancia de cada rival, para el marcador de posiciones.
  standings() {
    return [...this.cars.values()].map((c) => ({ id: c.id, d: c.d, crashed: c.crashed }));
  }
}

// Opacidad de golpe para chapa, cristales, sombra y halo.
function setFade(car, fade) {
  const [paint, trim, shadow, halo] = car.materials;
  paint.opacity = fade;
  trim.opacity = fade;
  shadow.opacity = 0.8 * fade;
  halo.opacity = 0.85 * fade;
}

function makeHaloTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(64, 64, 30, 64, 64, 62);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(0.55, 'rgba(255,255,255,0.28)');
  g.addColorStop(0.78, 'rgba(255,255,255,0.95)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(cv);
}

function makeLabel(name) {
  const cv = document.createElement('canvas');
  cv.width = 256; cv.height = 64;
  const ctx = cv.getContext('2d');
  ctx.font = 'bold 34px "Segoe UI", system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 7;
  ctx.strokeStyle = 'rgba(0,0,0,0.85)';
  ctx.strokeText(name, 128, 34);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(name, 128, 34);

  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: tex, transparent: true, depthWrite: false, depthTest: false,
  }));
  sprite.scale.set(2.6, 0.65, 1);
  sprite.renderOrder = 10;
  return sprite;
}
