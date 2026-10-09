// Decide cuándo un signo reconocido se convierte en texto.
// Es lógica pura (sin DOM), para poder probarla fotograma a fotograma.
//
// Reglas:
//  - Un signo se escribe cuando se mantiene estable `holdMs`.
//  - Mientras lo mantengas, NO se repite, aunque el detector pierda la mano un
//    instante o dude unos fotogramas.
//  - Para repetir la misma letra: baja la mano al menos `handGoneMs`, o haz
//    otra letra antes.
//  - Sin mano durante `autoSpaceMs`: espacio.
//  - Letras con movimiento (CH, LL…): forma base + desplazamiento.

export class Typist {
  constructor({ handGoneMs = 700, autoSpaceMs = 1200 } = {}) {
    this.handGoneMs = handGoneMs;
    this.autoSpaceMs = autoSpaceMs;
    this.reset();
  }

  reset() {
    this.current = { label: null, since: 0 };
    this.lastCommitted = null;
    this.lastHandAt = -Infinity;
    this.autoSpaced = true;
    this.motionLock = null;
    this.lockedVariant = null;
  }

  /** Marca el signo actual como ya escrito (al cambiar de modo, por ejemplo). */
  suppressCurrent() {
    this.lastCommitted = this.current.label;
  }

  /**
   * @param {object} f
   * @param {number} f.now           ms
   * @param {boolean} f.hand         ¿hay mano en este fotograma?
   * @param {string|null} f.stable   signo suavizado
   * @param {number} f.holdMs
   * @param {boolean} f.writing      ¿estamos en modo traducir?
   * @param {boolean} f.autoSpace
   * @param {string|undefined} f.variant  letra con movimiento si la forma base se está moviendo
   * @returns {{commit:string|null, variant:{base:string,label:string}|null, space:boolean,
   *            progress:number, done:boolean, display:string|null}}
   */
  update({ now, hand, stable, holdMs, writing, autoSpace, variant }) {
    const out = { commit: null, variant: null, space: false, progress: 0, done: false, display: stable };

    if (hand) {
      this.lastHandAt = now;
      this.autoSpaced = false;
    } else if (now - this.lastHandAt >= this.handGoneMs) {
      this.lastCommitted = null;
      this.motionLock = null;
    }

    if (writing && autoSpace && !hand && !this.autoSpaced && now - this.lastHandAt >= this.autoSpaceMs) {
      this.autoSpaced = true;
      out.space = true;
    }

    if (stable !== this.current.label) this.current = { label: stable, since: now };
    if (!stable || !writing) return out;

    // Otra letra distinta libera el bloqueo de movimiento.
    if (this.motionLock && stable !== this.motionLock) this.motionLock = null;

    if (variant && this.motionLock !== stable) {
      out.variant = { base: stable, label: variant };
      this.lastCommitted = stable;
      this.motionLock = stable;
      this.lockedVariant = variant;
    }
    if (this.motionLock === stable) out.display = this.lockedVariant;

    if (stable === this.lastCommitted) {
      out.progress = 1;
      out.done = true;
      return out;
    }
    out.progress = Math.min(1, (now - this.current.since) / holdMs);
    if (out.progress >= 1) {
      out.commit = stable;
      out.done = true;
      this.lastCommitted = stable;
    }
    return out;
  }
}
