import * as THREE from 'three';

// Coche arcade: físicas simples pero satisfactorias.
// - Velocidad escalar a lo largo del "morro" del coche
// - El giro depende de la velocidad (no giras parado)
// - Rozamiento + freno de mano para derrapar un poco
export class Car {
  constructor() {
    this.group = new THREE.Group();

    // Estado físico
    this.speed = 0;          // m/s (positivo = adelante)
    this.heading = 0;        // radianes (rotación en Y)
    this.position = new THREE.Vector3(0, 0, 0);

    // Parámetros de manejo (ajustables)
    this.enginePower = 34;   // aceleración
    this.brakePower = 60;    // frenada
    this.reversePower = 18;
    this.maxSpeed = 42;      // ~150 km/h
    this.maxReverse = 12;
    this.drag = 1.6;         // rozamiento con el aire (proporcional a v)
    this.rollResist = 6;     // rozamiento de rodadura (constante)
    this.steerSpeed = 2.1;   // rad/s a velocidad de giro plena
    this.grip = 3.2;

    this._buildPlaceholder();
  }

  // Coche de bloques con ruedas: sirve hasta cargar un modelo real.
  _buildPlaceholder() {
    const body = new THREE.Group();

    const paint = new THREE.MeshStandardMaterial({ color: 0x2e6bff, metalness: 0.5, roughness: 0.35 });
    const glass = new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.2, roughness: 0.1 });
    const tire = new THREE.MeshStandardMaterial({ color: 0x0d0d0f, roughness: 0.9 });

    const chassis = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.5, 4), paint);
    chassis.position.y = 0.55;
    chassis.castShadow = true;
    body.add(chassis);

    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.5, 0.55, 1.9), glass);
    cabin.position.set(0, 1.05, -0.15);
    cabin.castShadow = true;
    body.add(cabin);

    // Ruedas. Cada rueda = pivote (dirección) > spinner (rodadura) > malla.
    this.wheels = [];
    const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 18);
    const offsets = [
      [-0.9, 0.42, 1.25, true], [0.9, 0.42, 1.25, true],   // delanteras
      [-0.9, 0.42, -1.25, false], [0.9, 0.42, -1.25, false], // traseras
    ];
    offsets.forEach(([x, y, z, isFront]) => {
      const pivot = new THREE.Group();
      pivot.position.set(x, y, z);

      const spinner = new THREE.Group();
      const mesh = new THREE.Mesh(wheelGeo, tire);
      mesh.rotation.z = Math.PI / 2; // eje del cilindro -> eje del coche (X)
      mesh.castShadow = true;
      spinner.add(mesh);
      pivot.add(spinner);
      body.add(pivot);

      this.wheels.push({ pivot, spinner, isFront });
    });

    this.model = body;
    this.group.add(body);
  }

  // Sustituye el placeholder por un modelo cargado (GLTF/GLB).
  // Si el modelo tiene nodos llamados "wheel"/"rueda" se animan al rodar.
  setModel(object3d) {
    if (this.model) this.group.remove(this.model);
    this.wheels = [];
    object3d.traverse((c) => {
      if (c.isMesh) { c.castShadow = true; c.receiveShadow = true; }
      if (c.name && /wheel|rueda/i.test(c.name)) {
        this.wheels.push({ pivot: null, spinner: c, isFront: /front|delant/i.test(c.name) });
      }
    });
    this.model = object3d;
    this.group.add(object3d);
  }

  get speedKmh() {
    return Math.round(Math.abs(this.speed) * 3.6);
  }

  update(input, dt) {
    const s = input.state;

    // --- Aceleración / freno ---
    if (s.up) {
      this.speed += this.enginePower * dt;
    } else if (s.down) {
      if (this.speed > 0.2) this.speed -= this.brakePower * dt;      // frenar
      else this.speed -= this.reversePower * dt;                     // marcha atrás
    }

    // --- Rozamientos ---
    this.speed -= this.speed * this.drag * dt;
    if (!s.up && !s.down) {
      const roll = this.rollResist * dt;
      if (this.speed > 0) this.speed = Math.max(0, this.speed - roll);
      else if (this.speed < 0) this.speed = Math.min(0, this.speed + roll);
    }

    // --- Freno de mano ---
    if (s.handbrake) this.speed -= this.speed * 2.4 * dt;

    // --- Límites ---
    this.speed = Math.max(-this.maxReverse, Math.min(this.maxSpeed, this.speed));

    // --- Dirección (proporcional a la velocidad y su signo) ---
    let steer = 0;
    if (s.left) steer += 1;
    if (s.right) steer -= 1;
    const speedFactor = Math.min(1, Math.abs(this.speed) / 8);
    const dir = Math.sign(this.speed) || 1;
    this.heading += steer * this.steerSpeed * speedFactor * dir * dt;

    // --- Integración de posición ---
    const vx = Math.sin(this.heading) * this.speed;
    const vz = Math.cos(this.heading) * this.speed;
    this.position.x += vx * dt;
    this.position.z += vz * dt;

    // --- Aplicar al mesh ---
    this.group.position.copy(this.position);
    this.group.rotation.y = this.heading;

    // --- Animación de ruedas ---
    const spin = this.speed * dt / 0.42;
    for (const w of this.wheels) {
      if (w.spinner) w.spinner.rotation.x -= spin;
      if (w.isFront && w.pivot) w.pivot.rotation.y = steer * 0.4;
    }
  }
}
