import * as THREE from 'three';
import { TRAFFIC, SCORE } from './config.js';
import { VEHICLE_TYPES, PAINTS } from './vehicles.js';
import { blobShadowTexture } from './player.js';

const dummy = new THREE.Object3D();
const color = new THREE.Color();

// Tráfico con InstancedMesh: 18 coches en pantalla con ~10 draw calls.
export class Traffic {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);

    this.bodyMat = new THREE.MeshLambertMaterial();
    this.trimMat = new THREE.MeshLambertMaterial({ color: 0x14161a });

    this.pools = VEHICLE_TYPES.map((type) => {
      const { body, trim, size } = type.make();
      const bodyMesh = new THREE.InstancedMesh(body, this.bodyMat, type.max);
      const trimMesh = new THREE.InstancedMesh(trim, this.trimMat, type.max);
      for (const m of [bodyMesh, trimMesh]) {
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.frustumCulled = false;
        m.count = 0;
        this.group.add(m);
      }
      bodyMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(type.max * 3), 3);
      bodyMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
      return { type, bodyMesh, trimMesh, size };
    });

    const total = VEHICLE_TYPES.reduce((a, t) => a + t.max, 0);

    this.shadows = new THREE.InstancedMesh(
      new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
      new THREE.MeshBasicMaterial({ map: blobShadowTexture(), transparent: true, depthWrite: false, opacity: 0.8 }),
      total,
    );
    this.shadows.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.shadows.frustumCulled = false;
    this.shadows.renderOrder = -1;
    this.group.add(this.shadows);

    this.lights = new THREE.InstancedMesh(
      lightsGeometry(),
      new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.9,
        blending: THREE.AdditiveBlending, depthWrite: false,
      }),
      total,
    );
    this.lights.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.lights.frustumCulled = false;
    this.lights.visible = false;
    this.group.add(this.lights);

    this.cars = [];
    this.mode = null;
    this.spawnTimer = 0;
  }

  reset(mode) {
    this.mode = mode;
    this.cars.length = 0;
    this.spawnTimer = 0.4;
    this._sync();
  }

  setNight(on) { this.lights.visible = on; }

  // Al empezar, la carretera ya tiene que estar poblada: si no, los primeros
  // segundos están vacíos y el juego parece muerto.
  prefill() {
    for (let i = 0; i < TRAFFIC.maxActive; i++) {
      this._spawn(0, 40 + Math.random() * (TRAFFIC.spawnAhead - 40));
    }
    this._sync();
  }

  update(dt, playerSpeed, distance) {
    // La densidad sube con la distancia: el juego se pone difícil solo.
    const ramp = Math.min(1, distance / 6000);
    const maxActive = Math.round(TRAFFIC.maxActive * (0.7 + 0.3 * ramp));
    const interval = 1.05 - 0.6 * ramp;

    for (const car of this.cars) {
      car.prevZ = car.z;
      car.z += (car.speed * car.dir - playerSpeed) * dt;

      // Frenar si alcanzas a otro del mismo carril y sentido
      if (car.dir === 1) {
        const ahead = this._carAhead(car);
        car.cruise = ahead && ahead.speed < car.speed
          ? Math.max(ahead.speed * 0.96, 9)
          : car.baseSpeed;
        car.speed += THREE.MathUtils.clamp(car.cruise - car.speed, -8 * dt, 3 * dt);

        // Cambios de carril esporádicos
        car.laneTimer -= dt;
        if (car.laneTimer <= 0) {
          car.laneTimer = 3 + Math.random() * 6;
          if (Math.random() < TRAFFIC.laneChangeChance) this._tryLaneChange(car);
        }
      }
      if (car.targetX !== car.x) {
        const step = 2.4 * dt;
        car.x += THREE.MathUtils.clamp(car.targetX - car.x, -step, step);
      }
    }

    this.cars = this.cars.filter((c) => {
      const alive = c.z > -TRAFFIC.despawnBehind && c.z < TRAFFIC.despawnAhead;
      if (!alive) this._release(c);
      return alive;
    });

    this.spawnTimer -= dt;
    if (this.spawnTimer <= 0 && this.cars.length < maxActive) {
      this.spawnTimer = interval * (0.6 + Math.random() * 0.8);
      this._spawn(ramp);
    }

    this._sync();
  }

  _carAhead(car) {
    let best = null;
    for (const o of this.cars) {
      if (o === car || o.lane !== car.lane || o.dir !== car.dir) continue;
      const gap = o.z - car.z;
      if (gap > 0 && gap < 30 && (!best || gap < best.z - car.z)) best = o;
    }
    return best;
  }

  _tryLaneChange(car) {
    const lanes = this.mode.lanes;
    const options = [];
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].dir !== car.dir || Math.abs(i - car.lane) !== 1) continue;
      if (this._laneFree(i, car.z, 22, car)) options.push(i);
    }
    if (!options.length) return;
    car.lane = options[(Math.random() * options.length) | 0];
    car.targetX = lanes[car.lane].x;
  }

  _laneFree(laneIdx, z, gap, ignore) {
    for (const c of this.cars) {
      if (c === ignore || c.lane !== laneIdx) continue;
      if (Math.abs(c.z - z) < gap + c.halfL) return false;
    }
    return true;
  }

  _spawn(ramp, atZ = null) {
    const lanes = this.mode.lanes;
    const laneIdx = (Math.random() * lanes.length) | 0;
    const lane = lanes[laneIdx];
    const z = atZ ?? (lane.dir === 1 ? TRAFFIC.spawnAhead : TRAFFIC.spawnAhead + 60);
    if (!this._laneFree(laneIdx, z, TRAFFIC.minGap)) return;

    // Elegir tipo respetando pesos y el tope de instancias libres
    let pool = null;
    for (let tries = 0; tries < 8 && !pool; tries++) {
      let r = Math.random();
      for (const p of this.pools) {
        r -= p.type.weight;
        if (r <= 0) { if (this._used(p) < p.type.max) pool = p; break; }
      }
    }
    if (!pool) return;

    const [lo, hi] = pool.type.speed;
    const base = lo + Math.random() * (hi - lo) * (1 - 0.25 * ramp);
    this.cars.push({
      pool,
      lane: laneIdx,
      dir: lane.dir,
      x: lane.x,
      targetX: lane.x,
      z,
      prevZ: z,
      speed: base,
      baseSpeed: base,
      cruise: base,
      laneTimer: 2 + Math.random() * 5,
      colorIdx: (Math.random() * PAINTS.length) | 0,
      halfW: pool.size[0] / 2,
      halfL: pool.size[2] / 2,
      height: pool.size[1],
      counted: false,
    });
  }

  _used(pool) {
    let n = 0;
    for (const c of this.cars) if (c.pool === pool) n++;
    return n;
  }

  _release() { /* el pool se recalcula entero en _sync */ }

  _sync() {
    const counters = new Map(this.pools.map((p) => [p, 0]));
    let si = 0;

    for (const car of this.cars) {
      const i = counters.get(car.pool);
      counters.set(car.pool, i + 1);
      car.instance = i;

      dummy.position.set(car.x, 0, car.z);
      dummy.rotation.set(0, car.dir === 1 ? 0 : Math.PI, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      car.pool.bodyMesh.setMatrixAt(i, dummy.matrix);
      car.pool.trimMesh.setMatrixAt(i, dummy.matrix);
      color.setHex(PAINTS[car.colorIdx]).convertSRGBToLinear();
      car.pool.bodyMesh.instanceColor.setXYZ(i, color.r, color.g, color.b);

      dummy.position.set(car.x, 0.02, car.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(car.halfW * 2.5, 1, car.halfL * 2.3);
      dummy.updateMatrix();
      this.shadows.setMatrixAt(si, dummy.matrix);

      dummy.position.set(car.x, 0.72, car.z);
      dummy.rotation.set(0, car.dir === 1 ? 0 : Math.PI, 0);
      dummy.scale.set(car.halfW / 0.95, 1, car.halfL / 2.2);
      dummy.updateMatrix();
      this.lights.setMatrixAt(si, dummy.matrix);
      si++;
    }

    for (const p of this.pools) {
      const n = counters.get(p);
      p.bodyMesh.count = n;
      p.trimMesh.count = n;
      p.bodyMesh.instanceMatrix.needsUpdate = true;
      p.trimMesh.instanceMatrix.needsUpdate = true;
      p.bodyMesh.instanceColor.needsUpdate = true;
    }
    this.shadows.count = si;
    this.lights.count = si;
    this.shadows.instanceMatrix.needsUpdate = true;
    this.lights.instanceMatrix.needsUpdate = true;
  }

  // Colisión AABB con el coche del jugador (los giros son pequeños).
  hitTest(px, halfW, halfL) {
    for (const car of this.cars) {
      if (Math.abs(car.z) > halfL + car.halfL) continue;
      if (Math.abs(car.x - px) > halfW + car.halfW) continue;
      return car;
    }
    return null;
  }

  // Devuelve los adelantamientos ocurridos en este frame.
  collectPasses(px, halfW) {
    const out = [];
    for (const car of this.cars) {
      if (car.counted || car.prevZ <= 0 || car.z > 0) continue;
      car.counted = true;
      const gap = Math.abs(car.x - px) - halfW - car.halfW;
      out.push({ near: gap < SCORE.nearMissDist, oncoming: car.dir === -1, gap });
    }
    return out;
  }
}

// Dos faros delante y dos pilotos detrás, con color por vértice.
function lightsGeometry() {
  const geos = [];
  for (const sx of [-0.62, 0.62]) {
    const front = new THREE.PlaneGeometry(0.5, 0.2);
    front.translate(sx, 0, 2.2);
    geos.push([front, [1, 0.96, 0.85]]);

    const back = new THREE.PlaneGeometry(0.46, 0.17);
    back.rotateY(Math.PI);
    back.translate(sx, 0, -2.2);
    geos.push([back, [1, 0.1, 0.05]]);
  }
  const pos = [];
  const col = [];
  for (const [g, c] of geos) {
    const p = g.toNonIndexed().attributes.position;
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      col.push(c[0], c[1], c[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return geo;
}
