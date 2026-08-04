// Gestiona la entrada del jugador: teclado (PC) y botones táctiles (móvil).
// Expone un estado normalizado que el coche lee cada frame.

export class Input {
  constructor() {
    this.state = { up: false, down: false, left: false, right: false, handbrake: false };
    this._keys = new Set();

    // ---- Teclado ----
    const map = {
      ArrowUp: 'up', KeyW: 'up',
      ArrowDown: 'down', KeyS: 'down',
      ArrowLeft: 'left', KeyA: 'left',
      ArrowRight: 'right', KeyD: 'right',
      Space: 'handbrake',
    };

    window.addEventListener('keydown', (e) => {
      const action = map[e.code];
      if (!action) return;
      e.preventDefault();
      this.state[action] = true;
    });
    window.addEventListener('keyup', (e) => {
      const action = map[e.code];
      if (!action) return;
      e.preventDefault();
      this.state[action] = false;
    });

    // ---- Táctil ----
    this._detectTouch();
    document.querySelectorAll('.tbtn').forEach((btn) => {
      const key = btn.dataset.key;
      const press = (v) => (ev) => { ev.preventDefault(); this.state[key] = v; };
      btn.addEventListener('touchstart', press(true), { passive: false });
      btn.addEventListener('touchend', press(false), { passive: false });
      btn.addEventListener('touchcancel', press(false), { passive: false });
      // Soporte también con ratón (para probar en PC)
      btn.addEventListener('mousedown', press(true));
      btn.addEventListener('mouseup', press(false));
      btn.addEventListener('mouseleave', press(false));
    });
  }

  _detectTouch() {
    const isTouch = ('ontouchstart' in window) ||
      navigator.maxTouchPoints > 0 ||
      window.matchMedia('(pointer: coarse)').matches;
    if (isTouch) document.body.classList.add('is-touch');
  }
}
