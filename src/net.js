// Cliente de la sala. Un WebSocket contra el Durable Object que lleva el
// código de 5 letras. Sólo transporta: la lógica está en game.js.

// Códigos de sala sólo con números: se dictan por teléfono sin deletrear,
// no hay mayúsculas ni letras que se confundan, y en el móvil sale el
// teclado numérico.
export function makeRoomCode() {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] % 100000;
  return String(n).padStart(5, '0');
}

export class Net {
  constructor() {
    this.ws = null;
    this.code = null;
    this.you = null;
    this.hostId = null;
    this.handlers = new Map();
    this.connected = false;
    this.lastSent = 0;
  }

  get isHost() { return this.you && this.you === this.hostId; }

  on(type, fn) {
    this.handlers.set(type, fn);
    return this;
  }

  emit(type, payload) {
    this.handlers.get(type)?.(payload);
  }

  connect(code, identity) {
    this.close();
    this.code = code.toUpperCase();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}/room/${this.code}`);
    this.ws = ws;

    ws.addEventListener('open', () => {
      this.connected = true;
      this.send({ t: 'join', ...identity });
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      if (msg.t === 'welcome') { this.you = msg.you; this.hostId = msg.host; }
      if (msg.t === 'players' || msg.t === 'go' || msg.t === 'end') {
        if (msg.host) this.hostId = msg.host;
      }
      this.emit(msg.t, msg);
    });

    ws.addEventListener('close', () => {
      this.connected = false;
      this.emit('closed', {});
    });

    ws.addEventListener('error', () => {
      this.connected = false;
      this.emit('failed', {});
    });
  }

  send(obj) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
      return true;
    }
    return false;
  }

  // Posición propia, limitada a ~10 veces por segundo.
  sendState(now, distance, x, speed, yaw, nitro) {
    if (now - this.lastSent < 100) return;
    this.lastSent = now;
    this.send({
      t: 'state',
      d: round(distance, 1),
      x: round(x, 2),
      v: round(speed, 1),
      y: round(yaw, 3),
      n: nitro ? 1 : 0,
    });
  }

  close() {
    if (this.ws) {
      try { this.ws.close(); } catch { /* ya estaba */ }
      this.ws = null;
    }
    this.connected = false;
    this.you = null;
    this.hostId = null;
  }
}

const round = (v, decimals) => {
  const f = 10 ** decimals;
  return Math.round(v * f) / f;
};
