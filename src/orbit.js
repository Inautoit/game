import * as THREE from 'three';

// Controles de órbita ligeros y propios (ratón + táctil), sin dependencias.
// Gira alrededor de un objetivo, con zoom por rueda/pellizco y límites de
// inclinación para que la cámara no atraviese el suelo.
export class Orbit {
  constructor(camera, dom, target = new THREE.Vector3(0, 0.6, 0)) {
    this.camera = camera;
    this.dom = dom;
    this.target = target;

    this.radius = 7.5;
    this.minRadius = 3.2;
    this.maxRadius = 16;
    this.theta = Math.PI * 0.25;   // azimut
    this.phi = Math.PI * 0.36;     // polar (desde +Y)
    this.minPhi = 0.18;
    this.maxPhi = Math.PI * 0.49;  // no pasar del horizonte

    this.autoRotate = true;
    this.autoSpeed = 0.28;         // rad/s

    // Suavizado
    this._tTheta = this.theta;
    this._tPhi = this.phi;
    this._tRadius = this.radius;

    this._pointers = new Map();
    this._pinch = 0;
    this._dragging = false;

    this._bind();
    this.update(0);
  }

  _bind() {
    const d = this.dom;
    d.addEventListener('pointerdown', (e) => {
      d.setPointerCapture?.(e.pointerId);
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this._dragging = true;
      this.autoRotate = false;
    });
    d.addEventListener('pointermove', (e) => {
      if (!this._pointers.has(e.pointerId)) return;
      const prev = this._pointers.get(e.pointerId);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      this._pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (this._pointers.size >= 2) {
        // Pellizco → zoom
        const pts = [...this._pointers.values()];
        const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        if (this._pinch) this._tRadius *= this._pinch / dist;
        this._pinch = dist;
        this._tRadius = THREE.MathUtils.clamp(this._tRadius, this.minRadius, this.maxRadius);
      } else {
        this._tTheta -= dx * 0.005;
        this._tPhi -= dy * 0.005;
        this._tPhi = THREE.MathUtils.clamp(this._tPhi, this.minPhi, this.maxPhi);
      }
    });
    const up = (e) => {
      this._pointers.delete(e.pointerId);
      if (this._pointers.size < 2) this._pinch = 0;
      if (this._pointers.size === 0) this._dragging = false;
    };
    d.addEventListener('pointerup', up);
    d.addEventListener('pointercancel', up);
    d.addEventListener('pointerleave', up);

    d.addEventListener('wheel', (e) => {
      e.preventDefault();
      this._tRadius *= 1 + Math.sign(e.deltaY) * 0.08;
      this._tRadius = THREE.MathUtils.clamp(this._tRadius, this.minRadius, this.maxRadius);
    }, { passive: false });
  }

  update(dt) {
    if (this.autoRotate && !this._dragging) {
      this._tTheta += this.autoSpeed * dt;
    }
    // Suavizado exponencial
    const k = dt > 0 ? 1 - Math.pow(0.0015, dt) : 1;
    this.theta += (this._tTheta - this.theta) * k;
    this.phi += (this._tPhi - this.phi) * k;
    this.radius += (this._tRadius - this.radius) * k;

    const sinPhi = Math.sin(this.phi);
    this.camera.position.set(
      this.target.x + this.radius * sinPhi * Math.sin(this.theta),
      this.target.y + this.radius * Math.cos(this.phi),
      this.target.z + this.radius * sinPhi * Math.cos(this.theta)
    );
    this.camera.lookAt(this.target);
  }
}
