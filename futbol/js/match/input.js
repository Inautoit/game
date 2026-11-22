// Entrada: teclado, mando (Gamepad API) y controles táctiles.
// read() devuelve el estado del frame con flancos (pulsaciones nuevas).

const KEYMAP = {
  KeyW: 'up', ArrowUp: 'up', KeyS: 'down', ArrowDown: 'down',
  KeyA: 'left', ArrowLeft: 'left', KeyD: 'right', ArrowRight: 'right',
  ShiftLeft: 'sprint', ShiftRight: 'sprint',
  KeyJ: 'pass', Space: 'pass',
  KeyK: 'shoot',
  KeyL: 'through',
  KeyI: 'lob',
  KeyE: 'skill',
  Escape: 'pause', KeyP: 'pause',
};
const BUTTONS = ['pass', 'shoot', 'through', 'lob', 'skill', 'pause', 'sprint'];

export class Input {
  constructor() {
    this.keys = new Set();
    this.tapped = new Set(); // pulsadas desde el último read() (aunque ya se hayan soltado)
    this.touch = { mx: 0, my: 0, buttons: new Set() };
    this.prev = {};
    this.enabled = true;
    window.addEventListener('keydown', (e) => {
      const a = KEYMAP[e.code];
      if (!a) return;
      if (this.enabled) e.preventDefault();
      this.keys.add(a);
      this.tapped.add(a);
    });
    window.addEventListener('keyup', (e) => {
      const a = KEYMAP[e.code];
      if (a) this.keys.delete(a);
    });
    window.addEventListener('blur', () => this.keys.clear());
  }

  bindTouch(root) {
    const stick = root.querySelector('#stick');
    const knob = root.querySelector('#stick-knob');
    let id = null, ox = 0, oy = 0;
    const R = 55;
    const zone = root.querySelector('#stick-zone');
    const move = (x, y) => {
      let dx = x - ox, dy = y - oy;
      const d = Math.hypot(dx, dy);
      if (d > R) { dx *= R / d; dy *= R / d; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      this.touch.mx = dx / R; this.touch.my = dy / R;
    };
    zone.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      id = t.identifier; ox = t.clientX; oy = t.clientY;
      stick.style.left = `${ox - 70}px`; stick.style.top = `${oy - 70}px`;
      stick.classList.add('on');
      move(ox, oy);
    }, { passive: false });
    zone.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (t.identifier === id) move(t.clientX, t.clientY);
    }, { passive: false });
    const end = (e) => {
      for (const t of e.changedTouches) if (t.identifier === id) {
        id = null; this.touch.mx = 0; this.touch.my = 0;
        knob.style.transform = ''; stick.classList.remove('on');
      }
    };
    zone.addEventListener('touchend', end);
    zone.addEventListener('touchcancel', end);
    root.querySelectorAll('[data-btn]').forEach((b) => {
      const name = b.dataset.btn;
      b.addEventListener('touchstart', (e) => { e.preventDefault(); this.touch.buttons.add(name); this.tapped.add(name); b.classList.add('down'); }, { passive: false });
      const up = (e) => { e.preventDefault(); this.touch.buttons.delete(name); b.classList.remove('down'); };
      b.addEventListener('touchend', up, { passive: false });
      b.addEventListener('touchcancel', up, { passive: false });
    });
  }

  gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const g of pads) {
      if (!g) continue;
      const ax = g.axes[0] || 0, ay = g.axes[1] || 0;
      const b = (i) => !!(g.buttons[i] && g.buttons[i].pressed);
      return {
        mx: Math.abs(ax) > 0.18 ? ax : (b(15) ? 1 : b(14) ? -1 : 0),
        my: Math.abs(ay) > 0.18 ? ay : (b(13) ? 1 : b(12) ? -1 : 0),
        pass: b(0), shoot: b(1), lob: b(2), through: b(3), skill: b(5), sprint: b(7) || b(4), pause: b(9),
      };
    }
    return null;
  }

  read() {
    const k = this.keys;
    let mx = (k.has('right') ? 1 : 0) - (k.has('left') ? 1 : 0);
    let my = (k.has('down') ? 1 : 0) - (k.has('up') ? 1 : 0);
    const held = {};
    for (const n of BUTTONS) held[n] = k.has(n) || this.touch.buttons.has(n) || this.tapped.has(n);
    this.tapped.clear();
    if (this.touch.mx || this.touch.my) { mx = this.touch.mx; my = this.touch.my; }
    const gp = this.gamepad();
    if (gp) {
      if (gp.mx || gp.my) { mx = gp.mx; my = gp.my; }
      for (const n of BUTTONS) held[n] = held[n] || gp[n];
    }
    const m = Math.hypot(mx, my);
    if (m > 1) { mx /= m; my /= m; }
    const out = { mx, my, sprint: held.sprint, shootHeld: held.shoot };
    for (const n of BUTTONS) out[n] = held[n] && !this.prev[n];
    out.shootRelease = !held.shoot && !!this.prev.shoot;
    this.prev = held;
    return out;
  }
}

// copia sin flancos para los sub-pasos siguientes del mismo frame
export function heldOnly(inp) {
  return { mx: inp.mx, my: inp.my, sprint: inp.sprint, shootHeld: inp.shootHeld };
}
