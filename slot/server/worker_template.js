// Worker de Cloudflare de Turbo Slot (lo genera tools/build_worker.py):
// - sirve el juego (código aquí dentro, modelos y texturas desde KV),
// - API de circuitos de la comunidad (D1),
// - salas online en tiempo real (un Durable Object por sala, con WebSockets).
import { Buffer } from 'node:buffer';
import { validateTrack } from './tracks.js';

const FILES = __FILES__;
const cache = new Map();
function body(path, f) {
  if (!f[2]) return f[1];
  let b = cache.get(path);
  if (!b) { b = Buffer.from(f[1], 'base64'); cache.set(path, b); }
  return b;
}
const TYPES = { glb: 'model/gltf-binary', hdr: 'application/octet-stream', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain; charset=utf-8', wav: 'audio/wav' };
const SCENERY = ['verde', 'arena', 'noche'];

// La API se puede usar desde otras páginas (por ejemplo, la versión del juego dentro de Claude)
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...CORS },
});
const fail = (msg, status = 400) => json({ error: msg }, status);
const clean = (s, max) => String(s || '').replace(/[\u0000-\u001f\u007f<>]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
const BAD = ['puta', 'puto', 'mierda', 'polla', 'coño', 'cabron', 'cabrón', 'gilipollas', 'maricon', 'maricón', 'zorra', 'nazi', 'fuck', 'shit', 'bitch'];
const isBad = (s) => { const t = s.toLowerCase(); return BAD.some((w) => t.includes(w)); };
async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newId(n = 7, a = 'abcdefghijkmnpqrstuvwxyz23456789') {
  const r = crypto.getRandomValues(new Uint8Array(n));
  return [...r].map((b) => a[b % a.length]).join('');
}
const PUBLIC = 'id, name, author, lanes, laps, scenery, pieces, length, plays, likes, best_time, best_name, created';
const rowOut = (r) => ({ ...r, pieces: JSON.parse(r.pieces) });

async function tracksApi(req, env, url, parts) {
  const db = env.DB;
  // Listado: ?sort=top|new  · ?ids=a,b,c
  if (req.method === 'GET' && parts.length === 2) {
    const sort = url.searchParams.get('sort');
    const order = sort === 'new' ? 'created DESC' : '(plays + likes * 4) DESC, created DESC';
    const ids = (url.searchParams.get('ids') || '').split(',').filter((x) => /^[a-z0-9]{7}$/.test(x)).slice(0, 50);
    const q = ids.length
      ? db.prepare(`SELECT ${PUBLIC} FROM tracks WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created DESC`).bind(...ids)
      : db.prepare(`SELECT ${PUBLIC} FROM tracks ORDER BY ${order} LIMIT 60`);
    const { results } = await q.all();
    return json({ tracks: results.map(rowOut) });
  }
  if (req.method === 'GET' && parts.length === 3) {
    const r = await db.prepare(`SELECT ${PUBLIC} FROM tracks WHERE id = ?`).bind(parts[2]).first();
    return r ? json({ track: rowOut(r) }) : fail('Ese circuito no existe', 404);
  }
  // Publicar
  if (req.method === 'POST' && parts.length === 2) {
    if (Number(req.headers.get('content-length') || 0) > 12000) return fail('Circuito demasiado grande');
    let b;
    try { b = await req.json(); } catch { return fail('Datos no válidos'); }
    const name = clean(b.name, 28), author = clean(b.author, 20);
    if (name.length < 3) return fail('El nombre debe tener al menos 3 letras');
    if (author.length < 2) return fail('Pon tu nombre de piloto');
    if (isBad(name) || isBad(author)) return fail('Elige otro nombre, por favor');
    const lanes = b.lanes === 4 ? 4 : 2;
    const laps = Math.max(1, Math.min(20, Math.round(Number(b.laps) || 5)));
    const scenery = SCENERY.includes(b.scenery) ? b.scenery : 'verde';
    const pieces = Array.isArray(b.pieces) ? b.pieces.map((p) => (Array.isArray(p) ? p.map((v, i) => (i === 0 ? String(v) : Number(v))) : null)) : null;
    const v = validateTrack({ pieces, lanes });
    if (!v.ok) return fail(v.error);
    const ipHash = await sha((req.headers.get('cf-connecting-ip') || '') + ':slot');
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM tracks WHERE ip_hash = ? AND created > ?').bind(ipHash, Date.now() - 864e5).first();
    if (recent && recent.n >= 15) return fail('Has publicado muchos circuitos hoy. Vuelve mañana', 429);
    const id = newId();
    await db.prepare('INSERT INTO tracks (id, name, author, lanes, laps, scenery, pieces, length, created, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, name, author, lanes, laps, scenery, JSON.stringify(pieces), Math.round(v.length * 100) / 100, Date.now(), ipHash).run();
    return json({ id }, 201);
  }
  // Contadores
  if (req.method === 'POST' && parts.length === 4) {
    const id = parts[2], act = parts[3];
    if (!/^[a-z0-9]{7}$/.test(id)) return fail('No encontrado', 404);
    if (act === 'play') await db.prepare('UPDATE tracks SET plays = plays + 1 WHERE id = ?').bind(id).run();
    else if (act === 'like') await db.prepare('UPDATE tracks SET likes = likes + 1 WHERE id = ?').bind(id).run();
    else if (act === 'lap') {
      let t = null, who = '';
      try { const j = await req.json(); t = Number(j.time); who = clean(j.name, 20); } catch { /* nada */ }
      if (!who || isBad(who)) who = 'Anónimo';
      const row = await db.prepare('SELECT length FROM tracks WHERE id = ?').bind(id).first();
      // Vuelta imposible (más rápida que la punta del coche) = no cuenta
      if (row && Number.isFinite(t) && t > row.length / 7 && t < 600) {
        await db.prepare('UPDATE tracks SET best_time = ?, best_name = ? WHERE id = ? AND (best_time IS NULL OR ? < best_time)').bind(t, who, id, t).run();
      }
    } else return fail('Acción no válida');
    return json({ ok: true });
  }
  return fail('No encontrado', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts[0] === 'api') {
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
      // Salas online: /api/room/new  ·  /api/room/<CODE> (WebSocket)
      if (parts[1] === 'room') {
        if (parts[2] === 'new' && req.method === 'POST') {
          const code = newId(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ');
          return json({ code });
        }
        const code = (parts[2] || '').toUpperCase();
        if (!/^[A-Z]{4}$/.test(code)) return fail('Código de sala no válido');
        if (req.headers.get('Upgrade') !== 'websocket') return fail('Se necesita WebSocket', 426);
        const stub = env.ROOMS.get(env.ROOMS.idFromName(code));
        return stub.fetch(req);
      }
      if (parts[1] === 'tracks') {
        try { return await tracksApi(req, env, url, parts); } catch (e) { return fail('Error del servidor', 500); }
      }
      return fail('No encontrado', 404);
    }
    if (url.pathname.startsWith('/assets/') && env.ASSETS) {
      const data = await env.ASSETS.get(url.pathname.slice(1), 'arrayBuffer');
      if (data) {
        const ext = url.pathname.split('.').pop();
        return new Response(data, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' } });
      }
    }
    const path = url.pathname === '/' ? '/' : url.pathname;
    const f = FILES[path];
    if (!f) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(body(path, f), {
      headers: { 'content-type': f[0], 'x-content-type-options': 'nosniff', 'cache-control': (f[2] === 0 || path === '/sw.js') ? 'no-cache' : 'public, max-age=86400' },
    });
  },
};

// ---------------------------------------------------------------------------
// Sala online. Cada coche se simula en el móvil de su piloto (la física es determinista);
// la sala reparte el estado de cada uno a los demás, fija la salida y recoge los tiempos.
// ---------------------------------------------------------------------------
const MAX = 4;
const LIVS = ['rojo', 'azul', 'verde', 'amarillo', 'negro', 'blanco'];
export class Room {
  constructor(state) {
    this.state = state;
    this.players = new Map();  // id → { ws, name, liv, cls, lane, ready, host, fin }
    this.track = null;         // { kind: 'oficial'|'comunidad', id, name, lanes, laps, def? }
    this.phase = 'lobby';      // lobby | race
    this.startAt = 0;
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* cerrada */ } }
  all(m, except) { const s = JSON.stringify(m); for (const [id, p] of this.players) if (id !== except) { try { p.ws.send(s); } catch { /* cerrada */ } } }
  snapshot() {
    return {
      t: 'room', phase: this.phase, track: this.track, startAt: this.startAt,
      players: [...this.players.entries()].map(([id, p]) => ({ id, name: p.name, liv: p.liv, cls: p.cls, lane: p.lane, ready: p.ready, host: p.host, fin: p.fin })),
    };
  }
  // Cada piloto con un color distinto: si el que pide está cogido, el primero libre
  pickLiv(want, exceptId) {
    const used = new Set([...this.players.entries()].filter(([id]) => id !== exceptId).map(([, p]) => p.liv));
    if (LIVS.includes(want) && !used.has(want)) return want;
    return LIVS.find((l) => !used.has(l)) || 'rojo';
  }
  freeLane() {
    const lanes = this.track ? this.track.lanes : 4;
    const used = new Set([...this.players.values()].map((p) => p.lane));
    for (let l = 0; l < lanes; l++) if (!used.has(l)) return l;
    return -1;
  }
  async fetch(req) {
    const pair = new WebSocketPair();
    const [client, server] = Object.values(pair);
    server.accept();
    const id = newId(6);
    server.addEventListener('message', (e) => this.onMessage(id, server, e.data));
    const bye = () => this.leave(id);
    server.addEventListener('close', bye);
    server.addEventListener('error', bye);
    return new Response(null, { status: 101, webSocket: client });
  }
  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    this.players.delete(id);
    if (p.host && this.players.size) { const first = this.players.values().next().value; first.host = true; }
    if (!this.players.size) { this.phase = 'lobby'; this.track = null; }
    this.all({ t: 'left', id });
    this.all(this.snapshot());
  }
  onMessage(id, ws, raw) {
    if (typeof raw !== 'string' || raw.length > 16000) return;
    let m;
    try { m = JSON.parse(raw); } catch { return; }
    const me = this.players.get(id);
    switch (m.t) {
      case 'ping': this.send(ws, { t: 'pong', c: m.c, s: Date.now() }); return;
      case 'join': {
        if (me) return;
        if (this.players.size >= MAX) { this.send(ws, { t: 'error', msg: 'La sala está llena' }); return; }
        if (this.phase === 'race') { this.send(ws, { t: 'error', msg: 'La carrera ya ha empezado. Espera a que termine' }); return; }
        const lane = this.freeLane();
        if (lane < 0) { this.send(ws, { t: 'error', msg: 'No quedan carriles libres en este circuito' }); return; }
        let name = clean(m.name, 16); if (name.length < 2 || isBad(name)) name = 'Piloto';
        const p = { ws, name, liv: this.pickLiv(clean(m.liv, 12)), cls: m.cls === 'pro' ? 'pro' : 'iman', lane, ready: false, host: this.players.size === 0, fin: null };
        this.players.set(id, p);
        this.send(ws, { t: 'welcome', id });
        this.all(this.snapshot());
        return;
      }
    }
    if (!me) return;
    switch (m.t) {
      case 'track': {
        if (!me.host || this.phase !== 'lobby' || !m.track) return;
        const tr = m.track;
        const lanes = tr.lanes === 4 ? 4 : 2;
        if (this.players.size > lanes) { this.send(ws, { t: 'error', msg: `Ese circuito tiene ${lanes} carriles y sois ${this.players.size}` }); return; }
        let def;
        if (tr.kind === 'comunidad' || tr.kind === 'mio') {
          const pieces = Array.isArray(tr.def?.pieces) ? tr.def.pieces : null;
          if (!validateTrack({ pieces, lanes }).ok) { this.send(ws, { t: 'error', msg: 'Circuito no válido' }); return; }
          def = { pieces, lanes, scenery: SCENERY.includes(tr.def.scenery) ? tr.def.scenery : 'verde' };
        }
        this.track = { kind: tr.kind === 'oficial' ? 'oficial' : 'comunidad', id: clean(tr.id, 20), name: clean(tr.name, 28), lanes, laps: Math.max(1, Math.min(20, Math.round(Number(tr.laps) || 3))), def };
        // Recolocar carriles si el nuevo circuito tiene menos
        let l = 0; for (const p of this.players.values()) p.lane = l++;
        for (const p of this.players.values()) p.ready = false;
        this.all(this.snapshot());
        return;
      }
      case 'me': { // cambiar coche o clase
        if (this.phase !== 'lobby') return;
        me.liv = this.pickLiv(clean(m.liv, 12), id); me.cls = m.cls === 'pro' ? 'pro' : 'iman';
        this.all(this.snapshot());
        return;
      }
      case 'ready': me.ready = !!m.v; this.all(this.snapshot()); return;
      case 'start': {
        if (!me.host || this.phase !== 'lobby' || !this.track) return;
        if ([...this.players.values()].some((p) => !p.ready && !p.host)) { this.send(ws, { t: 'error', msg: 'Faltan pilotos por estar listos' }); return; }
        this.phase = 'race';
        this.startAt = Date.now() + 5200;
        for (const p of this.players.values()) p.fin = null;
        this.all(this.snapshot());
        // Si alguien se cuelga, la carrera se cierra sola a los 15 min
        this.timer && clearTimeout(this.timer);
        this.timer = setTimeout(() => this.endRace(), 15 * 60 * 1000);
        return;
      }
      case 'st': // estado del coche, a los demás tal cual (muy frecuente: sin copiar la sala)
        if (this.phase !== 'race') return;
        this.all({ t: 'st', id, s: +m.s, v: +m.v, th: +m.th, lap: m.lap | 0, out: !!m.out, k: m.k | 0 }, id);
        return;
      case 'lap': this.all({ t: 'lap', id, lap: m.lap | 0, time: +m.time }, id); return;
      case 'fin': {
        if (this.phase !== 'race' || me.fin) return;
        me.fin = { time: +m.time, best: +m.best };
        this.all({ t: 'fin', id, time: me.fin.time, best: me.fin.best });
        if ([...this.players.values()].every((p) => p.fin)) setTimeout(() => this.endRace(), 2500);
        return;
      }
      case 'lobby': if (me.host && this.phase === 'race') this.endRace(); return;
    }
  }
  endRace() {
    if (this.phase !== 'race') return;
    this.phase = 'lobby';
    for (const p of this.players.values()) p.ready = false;
    this.all(this.snapshot());
  }
}
