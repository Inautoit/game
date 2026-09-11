// Una sala de duelo = un Durable Object, direccionado por su código de 5
// letras. El objeto no simula nada: reparte mensajes y lleva la cuenta de
// quién sigue vivo. El tráfico lo simula el anfitrión y se retransmite.
//
// Usa la API de hibernación: mientras nadie habla, el objeto se duerme y no
// factura duración. Los mensajes entrantes se facturan 20:1, así que una
// partida de 6 a 10 Hz sale por unas 540 peticiones.

const MAX_PLAYERS = 6;
const MAX_MESSAGE = 4096;
const COUNTDOWN_MS = 3500;

export class Room {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
    this.meta = null;
    ctx.blockConcurrencyWhile(async () => {
      this.meta = (await ctx.storage.get('meta')) || {
        phase: 'lobby', hostId: null, mode: 'oneway', time: 'day', startedAt: 0, results: [],
      };
    });
  }

  async fetch(request) {
    if (request.headers.get('Upgrade') !== 'websocket') {
      return new Response('Se esperaba una conexión WebSocket', { status: 426 });
    }
    if (this.ctx.getWebSockets().length >= MAX_PLAYERS) {
      return new Response('La sala está llena', { status: 409 });
    }
    const pair = new WebSocketPair();
    this.ctx.acceptWebSocket(pair[1]);
    return new Response(null, { status: 101, webSocket: pair[0] });
  }

  // ------------------------------------------------------------ mensajes
  async webSocketMessage(ws, raw) {
    if (typeof raw !== 'string' || raw.length > MAX_MESSAGE) return;
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }

    const me = ws.deserializeAttachment();
    switch (msg.t) {
      case 'join': return this.onJoin(ws, msg);
      case 'setup': return this.onSetup(ws, me, msg);
      case 'start': return this.onStart(ws, me);
      case 'state': return this.onState(ws, me, msg);
      case 'traffic': return this.onTraffic(me, msg);
      case 'crash': return this.onCrash(ws, me, msg);
      case 'again': return this.onAgain(ws, me);
      default: return undefined;
    }
  }

  async webSocketClose(ws) { await this.onGone(ws); }
  async webSocketError(ws) { await this.onGone(ws); }

  // --------------------------------------------------------------- entrar
  async onJoin(ws, msg) {
    if (ws.deserializeAttachment()) return;           // ya estaba dentro
    if (this.meta.phase !== 'lobby') return send(ws, { t: 'err', msg: 'La partida ya ha empezado' });

    const id = String(msg.id || '').slice(0, 40) || crypto.randomUUID();
    const taken = this.players().some((p) => p.id === id);
    if (taken) return send(ws, { t: 'err', msg: 'Ya estás dentro en otra pestaña' });

    const first = this.ctx.getWebSockets().filter((s) => s.deserializeAttachment()).length === 0;
    const me = {
      id,
      name: String(msg.name || 'Piloto').slice(0, 16),
      paint: Number(msg.paint) || 0,
      alive: true,
      distance: 0,
      score: 0,
    };
    ws.serializeAttachment(me);

    if (first || !this.meta.hostId) {
      this.meta.hostId = id;
      await this.save();
    }

    send(ws, {
      t: 'welcome',
      you: id,
      host: this.meta.hostId,
      phase: this.meta.phase,
      mode: this.meta.mode,
      time: this.meta.time,
    });
    this.broadcastPlayers();
  }

  async onGone(ws) {
    const me = ws.deserializeAttachment();
    if (!me) return;
    ws.serializeAttachment(null);

    if (this.meta.phase === 'racing' && me.alive) {
      await this.eliminate(me, 'se ha ido');
      return;
    }
    if (this.meta.hostId === me.id) {
      const next = this.players()[0];
      this.meta.hostId = next ? next.id : null;
      await this.save();
    }
    if (this.players().length === 0) {
      this.meta = { phase: 'lobby', hostId: null, mode: 'oneway', time: 'day', startedAt: 0, results: [] };
      await this.ctx.storage.deleteAll();
      return;
    }
    this.broadcastPlayers();
  }

  // ------------------------------------------------------------- preparar
  async onSetup(ws, me, msg) {
    if (!me || me.id !== this.meta.hostId || this.meta.phase !== 'lobby') return;
    if (msg.mode === 'oneway' || msg.mode === 'twoway') this.meta.mode = msg.mode;
    if (['day', 'dusk', 'night'].includes(msg.time)) this.meta.time = msg.time;
    await this.save();
    this.broadcast({ t: 'setup', mode: this.meta.mode, time: this.meta.time });
  }

  async onStart(ws, me) {
    if (!me || me.id !== this.meta.hostId || this.meta.phase !== 'lobby') return;
    if (this.players().length < 2) return send(ws, { t: 'err', msg: 'Hacen falta al menos dos pilotos' });

    for (const sock of this.sockets()) {
      const p = sock.deserializeAttachment();
      sock.serializeAttachment({ ...p, alive: true, distance: 0, score: 0 });
    }
    this.meta.phase = 'racing';
    this.meta.results = [];
    this.meta.startedAt = Date.now() + COUNTDOWN_MS;
    await this.save();

    this.broadcast({
      t: 'go',
      at: this.meta.startedAt,
      now: Date.now(),
      mode: this.meta.mode,
      time: this.meta.time,
      host: this.meta.hostId,
    });
  }

  async onAgain(ws, me) {
    if (!me || me.id !== this.meta.hostId || this.meta.phase !== 'over') return;
    this.meta.phase = 'lobby';
    this.meta.results = [];
    await this.save();
    this.broadcast({ t: 'lobby' });
    this.broadcastPlayers();
  }

  // --------------------------------------------------------------- correr
  onState(ws, me, msg) {
    if (!me || this.meta.phase !== 'racing' || !me.alive) return;
    const d = num(msg.d), x = num(msg.x);
    if (d === null || x === null) return;
    ws.serializeAttachment({ ...me, distance: Math.max(me.distance, d) });

    // Retransmitir tal cual: lo que sale no se factura.
    this.broadcast({
      t: 's', id: me.id, d, x, v: num(msg.v) ?? 0, y: num(msg.y) ?? 0, n: msg.n ? 1 : 0,
    }, ws);
  }

  onTraffic(me, msg) {
    if (!me || me.id !== this.meta.hostId || this.meta.phase !== 'racing') return;
    if (!Array.isArray(msg.c)) return;
    this.broadcast({ t: 'tr', hd: num(msg.hd) ?? 0, c: msg.c }, null, this.meta.hostId);
  }

  async onCrash(ws, me, msg) {
    if (!me || this.meta.phase !== 'racing' || !me.alive) return;
    const updated = { ...me, distance: Math.max(me.distance, num(msg.d) ?? 0), score: num(msg.s) ?? 0 };
    ws.serializeAttachment(updated);
    await this.eliminate(updated, 'ha chocado');
  }

  async eliminate(player, reason) {
    const sock = this.socketOf(player.id);
    if (sock) sock.serializeAttachment({ ...sock.deserializeAttachment(), alive: false });

    this.meta.results.push({
      id: player.id, name: player.name, distance: Math.round(player.distance), score: Math.round(player.score),
    });
    await this.save();

    const left = this.players().filter((p) => p.alive).length;
    this.broadcast({ t: 'out', id: player.id, name: player.name, reason, left });

    if (left === 0) await this.finish();
  }

  async finish() {
    this.meta.phase = 'over';
    const order = [...this.meta.results].sort((a, b) => b.distance - a.distance);
    const results = order.map((r, i) => ({ ...r, place: i + 1 }));
    this.meta.results = results;
    await this.save();
    this.broadcast({ t: 'end', results, host: this.meta.hostId });
  }

  // ------------------------------------------------------------ utilidades
  sockets() {
    return this.ctx.getWebSockets().filter((s) => s.deserializeAttachment());
  }
  players() {
    return this.sockets().map((s) => s.deserializeAttachment());
  }
  socketOf(id) {
    return this.sockets().find((s) => s.deserializeAttachment()?.id === id) || null;
  }
  broadcastPlayers() {
    this.broadcast({
      t: 'players',
      host: this.meta.hostId,
      players: this.players().map((p) => ({ id: p.id, name: p.name, paint: p.paint, alive: p.alive })),
    });
  }
  broadcast(payload, except = null, onlyExcludeId = null) {
    const text = JSON.stringify(payload);
    for (const sock of this.sockets()) {
      if (sock === except) continue;
      if (onlyExcludeId && sock.deserializeAttachment()?.id === onlyExcludeId) continue;
      try { sock.send(text); } catch { /* se cerró */ }
    }
  }
  async save() {
    await this.ctx.storage.put('meta', this.meta);
  }
}

function send(ws, payload) {
  try { ws.send(JSON.stringify(payload)); } catch { /* se cerró */ }
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}
