// Conexión con una sala online (WebSocket con el Durable Object de la sala).
// Cada móvil simula su propio coche; aquí solo se envía y recibe el estado.
export class RoomClient {
  constructor(base, code, on) {
    this.code = code;
    this.on = on;                 // { message(m), open(), close(reason) }
    this.offset = 0;              // reloj del servidor - reloj local (ms)
    this.bestRtt = Infinity;
    const http = base || location.origin;
    this.url = http.replace(/^http/, 'ws') + '/api/room/' + code;
    this.closed = false;
    this.connect();
  }
  connect() {
    const ws = new WebSocket(this.url);
    this.ws = ws;
    ws.onopen = () => {
      this.on.open && this.on.open();
      // Sincronizar relojes: varios pings y nos quedamos con el de menor retardo
      let n = 0;
      const ping = () => { if (this.ws === ws && ws.readyState === 1) { this.send({ t: 'ping', c: performance.now() }); if (++n < 6) setTimeout(ping, 250); } };
      ping();
      this.pinger = setInterval(() => this.send({ t: 'ping', c: performance.now() }), 5000);
    };
    ws.onmessage = (e) => {
      let m;
      try { m = JSON.parse(e.data); } catch { return; }
      if (m.t === 'pong') {
        const now = performance.now(), rtt = now - m.c;
        this.rtt = rtt;
        if (rtt < this.bestRtt * 1.3) {
          if (rtt < this.bestRtt) this.bestRtt = rtt;
          // Hora del servidor en el momento de recibir = s + rtt/2
          this.offset = m.s + rtt / 2 - (performance.timeOrigin + now);
        }
        return;
      }
      this.on.message(m);
    };
    ws.onclose = () => {
      clearInterval(this.pinger);
      if (this.ws !== ws) return;
      if (!this.closed) this.on.close && this.on.close('Se ha perdido la conexión con la sala');
      this.closed = true;
    };
  }
  serverNow() { return performance.timeOrigin + performance.now() + this.offset; }
  send(m) { if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(m)); }
  close() { this.closed = true; clearInterval(this.pinger); try { this.ws.close(); } catch { /* ya cerrada */ } }
}

// Interpolación del coche de otro jugador: se pinta con un pequeño retraso para que vaya suave
export const NET_DELAY = 120; // ms
export function sampleRemote(buf, t, L) {
  if (!buf.length) return null;
  while (buf.length > 2 && buf[1].at <= t) buf.shift();
  const a = buf[0], b = buf[1];
  if (!b || t <= a.at) return { ...a, total: a.lap * L + a.s };
  const k = Math.min(1, (t - a.at) / Math.max(1, b.at - a.at));
  const ta = a.lap * L + a.s, tb = b.lap * L + b.s;
  const total = ta + (tb - ta) * k;
  return { total, v: a.v + (b.v - a.v) * k, th: a.th + (b.th - a.th) * k, out: b.out, lap: Math.floor(total / L), s: total - Math.floor(total / L) * L };
}
