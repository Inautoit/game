// Entrada unificada: teclado (PC), botones táctiles, deslizar e inclinación.
// El juego sólo lee `steer` (-1..1), `throttle` (-1..1), `brake`, `nitro`.

const STEER_MODES = ['buttons', 'swipe', 'tilt'];

export class Input {
  constructor() {
    this.steer = 0;
    this.throttle = 0;
    this.brake = false;
    this.nitroPressed = false;

    this.autoGas = load('autoGas', true);
    this.steerMode = STEER_MODES.includes(load('steerMode', null)) ? load('steerMode', 'buttons') : 'buttons';
    this.tiltAvailable = false;
    this._tiltZero = null;
    this._tilt = 0;

    this._keys = new Set();
    this._btn = { left: false, right: false, gas: false, brake: false };
    this._swipe = { id: null, startX: 0, value: 0 };

    this._bindKeyboard();
    this._bindButtons();
    this._bindSwipe();
    this.detectTouch();
  }

  get isTouch() {
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;
  }

  detectTouch() {
    if (this.isTouch) document.body.classList.add('is-touch');
    this.applySteerMode();
  }

  applySteerMode() {
    document.body.dataset.steer = this.steerMode;
    document.body.classList.toggle('auto-gas', this.autoGas);
  }

  setSteerMode(mode) {
    if (!STEER_MODES.includes(mode)) return;
    this.steerMode = mode;
    save('steerMode', mode);
    this._btn.left = this._btn.right = false;
    this._swipe.id = null;
    this._swipe.value = 0;
    this.applySteerMode();
    if (mode === 'tilt') this.enableTilt();
  }

  setAutoGas(v) {
    this.autoGas = !!v;
    save('autoGas', this.autoGas);
    this.applySteerMode();
  }

  // iOS exige pedir permiso desde un gesto del usuario.
  async enableTilt() {
    try {
      const DOE = window.DeviceOrientationEvent;
      if (!DOE) return false;
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission();
        if (res !== 'granted') return false;
      }
      if (!this._tiltBound) {
        this._tiltBound = true;
        window.addEventListener('deviceorientation', (e) => {
          // gamma: inclinación lateral en landscape/portrait
          const g = (e.gamma ?? 0);
          const b = (e.beta ?? 0);
          const portrait = Math.abs(window.orientation ?? 0) !== 90;
          let raw = portrait ? g : -Math.sign(window.orientation || 1) * b;
          if (this._tiltZero === null) this._tiltZero = raw;
          this._tilt = clamp((raw - this._tiltZero) / 22, -1, 1);
          this.tiltAvailable = true;
        });
      }
      return true;
    } catch {
      return false;
    }
  }

  recenterTilt() { this._tiltZero = null; }

  _bindKeyboard() {
    const map = {
      ArrowUp: 'gas', KeyW: 'gas',
      ArrowDown: 'brake', KeyS: 'brake',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      Space: 'nitro', ShiftLeft: 'nitro',
    };
    const set = (e, down) => {
      // Si estás escribiendo en un campo, el teclado no es del coche: si no,
      // A, D, W y S (girar y acelerar) desaparecen al teclearlas, y el
      // alfabeto de los códigos de sala las lleva.
      if (isTyping(e.target)) return;
      const a = map[e.code];
      if (!a) return;
      e.preventDefault();
      if (down) this._keys.add(a); else this._keys.delete(a);
      // El nitro se engancha al pulsar: si el toque cae entre dos frames
      // (pasa con fps bajos) el juego se lo comería.
      if (a === 'nitro' && down) this.nitroPressed = true;
    };
    window.addEventListener('keydown', (e) => set(e, true));
    window.addEventListener('keyup', (e) => set(e, false));
    window.addEventListener('blur', () => this._keys.clear());
  }

  _bindButtons() {
    document.querySelectorAll('[data-btn]').forEach((el) => {
      const key = el.dataset.btn;
      const press = (v) => (ev) => {
        ev.preventDefault();
        if (key === 'nitro') { if (v) this.nitroPressed = true; return; }
        this._btn[key] = v;
        el.classList.toggle('active', v);
      };
      el.addEventListener('pointerdown', press(true));
      el.addEventListener('pointerup', press(false));
      el.addEventListener('pointercancel', press(false));
      el.addEventListener('pointerleave', press(false));
      el.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  // Deslizar: se arrastra el dedo por la mitad inferior y el coche sigue.
  _bindSwipe() {
    const zone = document.getElementById('swipe-zone');
    if (!zone) return;
    zone.addEventListener('pointerdown', (e) => {
      if (this._swipe.id !== null) return;
      this._swipe.id = e.pointerId;
      this._swipe.startX = e.clientX;
      zone.setPointerCapture(e.pointerId);
    });
    zone.addEventListener('pointermove', (e) => {
      if (this._swipe.id !== e.pointerId) return;
      const span = Math.max(90, window.innerWidth * 0.28);
      this._swipe.value = clamp((e.clientX - this._swipe.startX) / span, -1, 1);
    });
    const end = (e) => {
      if (this._swipe.id !== e.pointerId) return;
      this._swipe.id = null;
      this._swipe.value = 0;
    };
    zone.addEventListener('pointerup', end);
    zone.addEventListener('pointercancel', end);
  }

  // Se llama una vez por frame antes de la física.
  update() {
    let steer = 0;
    if (this._keys.has('left')) steer += 1;
    if (this._keys.has('right')) steer -= 1;

    if (steer === 0) {
      if (this.steerMode === 'buttons') {
        if (this._btn.left) steer += 1;
        if (this._btn.right) steer -= 1;
      } else if (this.steerMode === 'swipe') {
        steer = -this._swipe.value;
      } else if (this.steerMode === 'tilt') {
        steer = -this._tilt;
      }
    }
    // steer > 0 mueve el coche hacia +X (izquierda de la pantalla).
    this.steer = clamp(steer, -1, 1);

    const gas = this._keys.has('gas') || this._btn.gas;
    const brk = this._keys.has('brake') || this._btn.brake;
    this.brake = brk;
    this.throttle = brk ? -1 : (gas || this.autoGas) ? 1 : 0;
  }

  consumeNitro() {
    const v = this.nitroPressed || this._keys.has('nitro');
    this.nitroPressed = false;
    return v;
  }

  reset() {
    this._keys.clear();
    this._btn.left = this._btn.right = this._btn.gas = this._btn.brake = false;
    this._swipe.id = null;
    this._swipe.value = 0;
    this.nitroPressed = false;
    document.querySelectorAll('[data-btn].active').forEach((el) => el.classList.remove('active'));
  }
}

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function isTyping(target) {
  if (!target) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable === true;
}

function load(key, def) {
  try {
    const v = localStorage.getItem('urus:' + key);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}
function save(key, value) {
  try { localStorage.setItem('urus:' + key, JSON.stringify(value)); } catch { /* modo privado */ }
}
