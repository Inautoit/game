// Worker de Cloudflare de Turbo Slot (lo genera tools/build_worker.py):
// - sirve el juego (código aquí dentro, modelos y texturas desde KV),
// - API de circuitos de la comunidad (D1),
// - salas online en tiempo real (un Durable Object por sala, con WebSockets).
import { Buffer } from 'node:buffer';
import { validateTrack, TRACKS, findTrack } from './tracks.js';
import { verifyLap } from './verify.js';

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
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type, authorization', 'access-control-allow-methods': 'GET, POST, PUT, OPTIONS', 'access-control-max-age': '86400' };
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
// ---- Cuentas: usuario + contraseña (PBKDF2), sesiones con token y perfil sincronizado ----
const PROFILE_MAX = 1500000;   // bytes del perfil (récords, fantasmas, circuitos…)
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randTok = (n) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function passHash(pass, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pass), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return b64u(bits);
}
function sameStr(a, b) {   // comparación en tiempo constante
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
const normName = (s) => String(s || '').normalize('NFC').trim();
const NAME_RE = /^[\p{L}\p{N}_. -]{3,16}$/u;
const newRecovery = () => newId(12, 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789').replace(/(.{4})(?=.)/g, '$1-');
// Límite de intentos (login fallidos, registros) por IP y día
async function limited(db, req, what, max) {
  const ip = await sha((req.headers.get('cf-connecting-ip') || '') + ':' + what);
  const day = Math.floor(Date.now() / 864e5);
  const row = await db.prepare('SELECT n FROM limits WHERE k = ? AND day = ?').bind(ip, day).first();
  return { over: !!row && row.n >= max, hit: () => db.prepare('INSERT INTO limits (k, day, n) VALUES (?, ?, 1) ON CONFLICT(k, day) DO UPDATE SET n = n + 1').bind(ip, day).run() };
}
async function newSession(db, userId) {
  const token = randTok(32);
  await db.prepare('INSERT INTO sessions (token_hash, user_id, created) VALUES (?, ?, ?)').bind(await sha(token + ':ses'), userId, Date.now()).run();
  return token;
}
// Usuario de la petición (cabecera Authorization: Bearer <token>) o null
async function authUser(req, db) {
  const h = req.headers.get('authorization') || '';
  const m = h.match(/^Bearer ([A-Za-z0-9_-]{20,80})$/);
  if (!m) return null;
  return db.prepare('SELECT u.id, u.name, u.rid FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').bind(await sha(m[1] + ':ses')).first();
}
const userOut = (u) => ({ name: u.name, rid: u.rid });
async function authApi(req, env, parts) {
  const db = env.DB;
  const what = parts[2];
  if (req.method !== 'POST') return fail('Método no permitido', 405);
  const b = await req.json().catch(() => ({}));
  if (what === 'logout') {
    const h = (req.headers.get('authorization') || '').replace(/^Bearer /, '');
    if (h) await db.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha(h + ':ses')).run();
    return json({ ok: true });
  }
  const name = normName(b.name), pass = String(b.password || '');
  if (what === 'register') {
    if (!NAME_RE.test(name) || isBad(name)) return fail('Usuario no válido: de 3 a 16 letras, números, espacios, puntos o guiones');
    if (pass.length < 6 || pass.length > 128) return fail('La contraseña debe tener al menos 6 caracteres');
    const lim = await limited(db, req, 'reg', 10);
    if (lim.over) return fail('Demasiadas cuentas nuevas desde aquí hoy. Prueba mañana', 429);
    const exists = await db.prepare('SELECT 1 FROM users WHERE name = ? COLLATE NOCASE').bind(name).first();
    if (exists) return fail('Ese usuario ya existe');
    const id = newId(12), salt = randTok(16), recovery = newRecovery();
    await db.prepare('INSERT INTO users (id, name, pass_hash, salt, rid, recovery_hash, data, ver, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)')
      .bind(id, name, await passHash(pass, salt), salt, newId(16, 'abcdefghijkmnpqrstuvwxyz23456789'), await passHash(recovery, salt), '{}', Date.now(), Date.now()).run();
    await lim.hit();
    const u = await db.prepare('SELECT id, name, rid FROM users WHERE id = ?').bind(id).first();
    return json({ token: await newSession(db, id), user: userOut(u), recovery });
  }
  if (what === 'login' || what === 'recover') {
    const lim = await limited(db, req, 'fail', 30);
    if (lim.over) return fail('Demasiados intentos fallidos hoy. Prueba mañana', 429);
    const u = await db.prepare('SELECT * FROM users WHERE name = ? COLLATE NOCASE').bind(name).first();
    if (what === 'login') {
      const ok = u && sameStr(await passHash(pass, u.salt), u.pass_hash);
      if (!ok) { await lim.hit(); return fail('Usuario o contraseña incorrectos', 401); }
      return json({ token: await newSession(db, u.id), user: userOut(u) });
    }
    // Recuperar: código de recuperación + contraseña nueva; cierra las demás sesiones y da un código nuevo
    const code = String(b.recovery || '').toUpperCase().replace(/[^A-Z0-9]/g, '').replace(/(.{4})(?=.)/g, '$1-');
    const ok = u && sameStr(await passHash(code, u.salt), u.recovery_hash);
    if (!ok) { await lim.hit(); return fail('Usuario o código de recuperación incorrectos', 401); }
    if (pass.length < 6 || pass.length > 128) return fail('La contraseña nueva debe tener al menos 6 caracteres');
    const salt = randTok(16), recovery = newRecovery();
    await db.prepare('UPDATE users SET pass_hash = ?, salt = ?, recovery_hash = ? WHERE id = ?').bind(await passHash(pass, salt), salt, await passHash(recovery, salt), u.id).run();
    await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(u.id).run();
    return json({ token: await newSession(db, u.id), user: userOut(u), recovery });
  }
  return fail('No encontrado', 404);
}
// Perfil: GET devuelve { data, ver }; PUT guarda si «ver» coincide (si no, 409 con lo del servidor para fusionar)
async function profileApi(req, env) {
  const db = env.DB;
  const u = await authUser(req, db);
  if (!u) return fail('Inicia sesión', 401);
  if (req.method === 'GET') {
    const r = await db.prepare('SELECT data, ver FROM users WHERE id = ?').bind(u.id).first();
    return json({ user: userOut(u), data: JSON.parse(r.data || '{}'), ver: r.ver });
  }
  if (req.method === 'PUT') {
    const text = await req.text();
    if (text.length > PROFILE_MAX + 200) return fail('Perfil demasiado grande', 413);
    let b; try { b = JSON.parse(text); } catch { return fail('Datos no válidos'); }
    if (!b || typeof b.data !== 'object' || !Number.isInteger(b.ver)) return fail('Datos no válidos');
    const data = JSON.stringify(b.data);
    const r = await db.prepare('UPDATE users SET data = ?, ver = ver + 1, updated = ? WHERE id = ? AND ver = ?').bind(data, Date.now(), u.id, b.ver).run();
    if (!r.meta.changes) {
      const cur = await db.prepare('SELECT data, ver FROM users WHERE id = ?').bind(u.id).first();
      return json({ conflict: true, data: JSON.parse(cur.data || '{}'), ver: cur.ver }, 409);
    }
    return json({ ok: true, ver: b.ver + 1 });
  }
  return fail('Método no permitido', 405);
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

// ---------------------------------------------------------------------------
// Clasificación mundial con vueltas comprobadas
// ---------------------------------------------------------------------------
async function trackDefFor(db, key) {
  if (key.startsWith('o:')) {
    const t = findTrack(key.slice(2));
    return t ? { pieces: t.pieces, lanes: t.lanes } : null;
  }
  if (key.startsWith('c:')) {
    const r = await db.prepare('SELECT pieces, lanes FROM tracks WHERE id = ?').bind(key.slice(2)).first();
    return r ? { pieces: JSON.parse(r.pieces), lanes: r.lanes } : null;
  }
  return null;
}
const keyOk = (k) => typeof k === 'string' && /^(o:[a-z0-9_-]{2,20}|c:[a-z0-9]{7})$/.test(k);
async function lapsApi(req, env, url, parts) {
  const db = env.DB;
  // Ranking: GET /api/laps?track=o:ovalo&cls=iman&device=…
  if (req.method === 'GET' && parts.length === 2) {
    const key = url.searchParams.get('track'), cls = url.searchParams.get('cls') === 'pro' ? 'pro' : 'iman';
    if (!keyOk(key)) return fail('Circuito no válido');
    const dev = url.searchParams.get('device') || '';
    const { results } = await db.prepare('SELECT name, time, car, liv, device, created FROM laps WHERE track_key = ? AND cls = ? ORDER BY time ASC LIMIT 50').bind(key, cls).all();
    let mine = null;
    if (dev) {
      const r = await db.prepare('SELECT time FROM laps WHERE track_key = ? AND cls = ? AND device = ?').bind(key, cls, dev).first();
      if (r) { const p = await db.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_key = ? AND cls = ? AND time < ?').bind(key, cls, r.time).first(); mine = { time: r.time, pos: p.n + 1 }; }
    }
    const total = await db.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_key = ? AND cls = ?').bind(key, cls).first();
    return json({ laps: results.map((r) => ({ name: r.name, time: r.time, car: r.car, liv: r.liv, me: !!dev && r.device === dev, created: r.created })), mine, total: total.n });
  }
  // Fantasma del récord: GET /api/laps/ghost?track=…&cls=…
  if (req.method === 'GET' && parts[2] === 'ghost') {
    const key = url.searchParams.get('track'), cls = url.searchParams.get('cls') === 'pro' ? 'pro' : 'iman';
    if (!keyOk(key)) return fail('Circuito no válido');
    const r = await db.prepare('SELECT name, time, car, liv, lane, setup, s0, t0, go_t, inputs, lap FROM laps WHERE track_key = ? AND cls = ? ORDER BY time ASC LIMIT 1').bind(key, cls).first();
    if (!r) return json({ ghost: null });
    return json({ ghost: { ...r, setup: JSON.parse(r.setup), inputs: JSON.parse(r.inputs), goT: r.go_t } });
  }
  // Enviar una vuelta: POST /api/laps
  if (req.method === 'POST' && parts.length === 2) {
    if (Number(req.headers.get('content-length') || 0) > 600000) return fail('Vuelta demasiado grande');
    let b;
    try { b = await req.json(); } catch { return fail('Datos no válidos'); }
    const key = b.track;
    if (!keyOk(key)) return fail('Circuito no válido');
    const acc = await authUser(req, db);
    const device = acc ? acc.rid : String(b.device || '');
    if (!/^[a-z0-9]{12,32}$/.test(device)) return fail('Dispositivo no válido');
    let name = acc ? acc.name : clean(b.name, 16); if (name.length < 2 || isBad(name)) name = 'Piloto';
    const def = await trackDefFor(db, key);
    if (!def) return fail('Ese circuito no existe', 404);
    const setup = { magnet: String(b.setup?.magnet || 'medio'), gear: String(b.setup?.gear || 'medio'), tire: String(b.setup?.tire || 'blando'), brake: Number(b.setup?.brake), curve: Number(b.setup?.curve) };
    if (!Number.isFinite(setup.brake) || !Number.isFinite(setup.curve)) return fail('Reglaje no válido');
    const cls = setup.magnet === 'sin' ? 'pro' : 'iman';
    const sub = { lane: b.lane | 0, setup, s0: Number(b.s0), t0: Number(b.t0), goT: Number(b.goT), inputs: b.inputs, lap: b.lap, time: Number(b.time) };
    // La comprobación (repetir la vuelta entera) se hace en un Durable Object: tiene más tiempo de CPU
    const ver = env.ROOMS.get(env.ROOMS.idFromName('__VERIFICADOR__'));
    const vr = await (await ver.fetch(new Request('https://sala/verify', { method: 'POST', body: JSON.stringify({ sub, def }) }))).json();
    if (!vr.ok) return fail(vr.error || 'Vuelta no válida', 422);
    const car = clean(b.car, 12), liv = clean(b.liv, 12);
    const prev = await db.prepare('SELECT time FROM laps WHERE track_key = ? AND cls = ? AND device = ?').bind(key, cls, device).first();
    if (!prev || vr.time < prev.time) {
      await db.prepare(`INSERT INTO laps (track_key, cls, device, name, time, car, liv, lane, setup, s0, t0, go_t, inputs, lap, created)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(track_key, cls, device) DO UPDATE SET name=excluded.name, time=excluded.time, car=excluded.car, liv=excluded.liv, lane=excluded.lane,
          setup=excluded.setup, s0=excluded.s0, t0=excluded.t0, go_t=excluded.go_t, inputs=excluded.inputs, lap=excluded.lap, created=excluded.created`)
        .bind(key, cls, device, name, vr.time, car, liv, sub.lane, JSON.stringify(setup), sub.s0, sub.t0, sub.goT, JSON.stringify(sub.inputs), sub.lap, Date.now()).run();
    }
    const best = Math.min(vr.time, prev ? prev.time : Infinity);
    const pos = await db.prepare('SELECT COUNT(*) AS n FROM laps WHERE track_key = ? AND cls = ? AND time < ?').bind(key, cls, best).first();
    const top = await db.prepare('SELECT name, time FROM laps WHERE track_key = ? AND cls = ? ORDER BY time ASC LIMIT 1').bind(key, cls).first();
    return json({ ok: true, time: vr.time, best, pos: pos.n + 1, improved: !prev || vr.time < prev.time, wr: top });
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
      // Partida rápida: el emparejador (una sala especial) reparte el mismo código a quien llegue a la vez
      if (parts[1] === 'quick' && req.method === 'POST') {
        const mm = env.ROOMS.get(env.ROOMS.idFromName('__EMPAREJADOR__'));
        const r = await mm.fetch(new Request('https://sala/match', { method: 'POST' }));
        return json(await r.json());
      }
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
      if (parts[1] === 'auth') {
        try { return await authApi(req, env, parts); } catch (e) { return fail('Error del servidor', 500); }
      }
      if (parts[1] === 'profile') {
        try { return await profileApi(req, env); } catch (e) { return fail('Error del servidor', 500); }
      }
      if (parts[1] === 'laps') {
        try { return await lapsApi(req, env, url, parts); } catch (e) { return fail('Error del servidor', 500); }
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
const CPU_NAMES = ['Ortega', 'Ferrer', 'Sanz', 'Vidal'];
const CAR_IDS = ['muscle', 'sedan', 'f1', 'gt22'];
const carOf = (c) => (CAR_IDS.includes(c) ? c : 'muscle');
const CHAMP_PTS = [10, 6, 4, 3];
// Copas online (circuitos oficiales)
const CUPS = {
  club: { name: 'Copa Club', tracks: ['ovalo', 'rinon', 'horquilla', 'chicane'] },
  gp: { name: 'Copa Grand Prix', tracks: ['gp', 'internacional', 'montana', 'autodromo'] },
};
// Circuitos de 4 carriles para la partida rápida
const QUICK = ['chicane', 'gp', 'internacional', 'autodromo'];
const offTrack = (id, laps) => { const t = TRACKS.find((x) => x.id === id); return t ? { kind: 'oficial', id: t.id, name: t.name, lanes: t.lanes, laps: laps || Math.min(t.laps, 5) } : null; };

export class Room {
  constructor(state) {
    this.state = state;
    this.players = new Map();  // id → { ws, name, liv, cls, lane, ready, host, fin }
    this.track = null;         // { kind: 'oficial'|'comunidad', id, name, lanes, laps, def? }
    this.phase = 'lobby';      // lobby | race
    this.startAt = 0;
    this.cpu = false;          // rellenar carriles libres con coches de la CPU
    this.bots = [];            // [{ id, lane, name, liv, fin }]
    this.quick = false;        // partida rápida (empieza sola)
    this.autoAt = 0;
    this.champ = null;         // { cup, name, tracks, idx, pts: { id: { name, liv, pts, cpu } }, final }
    this.mm = null;            // solo en el emparejador
  }
  send(ws, m) { try { ws.send(JSON.stringify(m)); } catch { /* cerrada */ } }
  all(m, except) { const s = JSON.stringify(m); for (const [id, p] of this.players) if (id !== except) { try { p.ws.send(s); } catch { /* cerrada */ } } }
  snapshot() {
    return {
      t: 'room', phase: this.phase, track: this.track, startAt: this.startAt, cpu: this.cpu, quick: this.quick, autoAt: this.autoAt,
      bots: this.bots, champ: this.champ,
      players: [...this.players.entries()].map(([id, p]) => ({ id, name: p.name, liv: p.liv, cls: p.cls, car: p.car, lane: p.lane, ready: p.ready, host: p.host, fin: p.fin })),
    };
  }
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
  host() { for (const p of this.players.values()) if (p.host) return p; return null; }
  async fetch(req) {
    const url = new URL(req.url);
    // Emparejador de la partida rápida: el mismo código para los que lleguen en los próximos segundos
    if (url.pathname === '/verify') {
      try {
        const { sub, def } = await req.json();
        return new Response(JSON.stringify(verifyLap(sub, def)), { headers: { 'content-type': 'application/json' } });
      } catch (e) {
        return new Response(JSON.stringify({ ok: false, error: 'No se pudo comprobar la vuelta' }), { headers: { 'content-type': 'application/json' } });
      }
    }
    if (url.pathname === '/match') {
      const now = Date.now();
      if (!this.mm || now > this.mm.until || this.mm.n >= MAX) this.mm = { code: newId(4, 'ABCDEFGHJKLMNPQRSTUVWXYZ'), until: now + 11000, n: 0 };
      this.mm.n++;
      return new Response(JSON.stringify({ code: this.mm.code }), { headers: { 'content-type': 'application/json' } });
    }
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
    if (!this.players.size) { this.phase = 'lobby'; this.track = null; this.champ = null; this.bots = []; this.quick = false; clearTimeout(this.autoTimer); clearTimeout(this.timer); }
    this.all({ t: 'left', id });
    if (this.phase === 'race') this.checkEnd();
    this.all(this.snapshot());
  }
  // Partida rápida: empieza sola a los 15 s de entrar el primero, o a los 4 s si se llena
  scheduleAuto(ms) {
    clearTimeout(this.autoTimer);
    this.autoAt = Date.now() + ms;
    this.autoTimer = setTimeout(() => { if (this.phase === 'lobby' && this.players.size) this.startRace(); }, ms);
  }
  startRace() {
    if (!this.track) return;
    clearTimeout(this.autoTimer); this.autoAt = 0;
    this.phase = 'race';
    // 13 s de presentación del circuito (igual para todos, no se puede saltar) + 5,2 s de semáforo
    this.startAt = Date.now() + 13000 + 5200;
    for (const p of this.players.values()) p.fin = null;
    // CPU en los carriles libres (los conduce el móvil del anfitrión)
    this.bots = [];
    if (this.cpu) {
      const used = new Set([...this.players.values()].map((p) => p.lane));
      const livUsed = new Set([...this.players.values()].map((p) => p.liv));
      let k = 0;
      for (let l = 0; l < this.track.lanes; l++) {
        if (used.has(l)) continue;
        const liv = LIVS.find((x) => !livUsed.has(x)) || 'blanco'; livUsed.add(liv);
        this.bots.push({ id: 'cpu' + l, lane: l, name: `${CPU_NAMES[k % CPU_NAMES.length]} · CPU`, liv, car: CAR_IDS[(k * 2 + 1) % CAR_IDS.length], fin: null }); k++;
      }
    }
    this.all(this.snapshot());
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.endRace(), 15 * 60 * 1000);
  }
  checkEnd() {
    const players = [...this.players.values()];
    if (players.length && players.every((p) => p.fin) && this.bots.every((b) => b.fin || !this.host())) setTimeout(() => this.endRace(), 2500);
  }
  endRace() {
    if (this.phase !== 'race') return;
    clearTimeout(this.timer);
    this.phase = 'lobby';
    // Campeonato: puntos según el tiempo de llegada (+1 a la vuelta rápida)
    if (this.champ && !this.champ.final) {
      const all = [...[...this.players.entries()].map(([id, p]) => ({ id, name: p.name, liv: p.liv, fin: p.fin, cpu: false })), ...this.bots.map((b) => ({ ...b, cpu: true }))];
      const T = (x) => (x.fin && x.fin.time < 9000 ? x.fin.time : Infinity);
      all.sort((a, b) => T(a) - T(b));
      const best = all.filter((x) => x.fin && Number.isFinite(x.fin.best)).sort((a, b) => a.fin.best - b.fin.best)[0];
      all.forEach((x, i) => {
        const e = this.champ.pts[x.id] || (this.champ.pts[x.id] = { name: x.name, liv: x.liv, pts: 0, cpu: x.cpu });
        e.last = Number.isFinite(T(x)) ? (CHAMP_PTS[i] || 0) : 0;
        if (best && best.id === x.id) e.last += 1;
        e.pts += e.last; e.name = x.name; e.liv = x.liv;
      });
      this.champ.idx++;
      if (this.champ.idx >= this.champ.tracks.length) this.champ.final = true;
      else this.track = offTrack(this.champ.tracks[this.champ.idx], this.track.laps);
    }
    for (const p of this.players.values()) p.ready = false;
    if (this.quick) this.scheduleAuto(25000);   // otra carrera rápida si se quedan
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
        // Primera persona en una sala de partida rápida: circuito al azar y salida automática
        if (m.quick && this.players.size === 0) {
          this.quick = true; this.cpu = true; this.champ = null;
          this.track = offTrack(QUICK[Math.floor(Math.random() * QUICK.length)], 3);
          this.scheduleAuto(15000);
        }
        const lane = this.freeLane();
        if (lane < 0) { this.send(ws, { t: 'error', msg: 'No quedan carriles libres en este circuito' }); return; }
        let name = clean(m.name, 16); if (name.length < 2 || isBad(name)) name = 'Piloto';
        const p = { ws, name, liv: this.pickLiv(clean(m.liv, 12)), cls: m.cls === 'pro' ? 'pro' : 'iman', car: carOf(m.car), lane, ready: this.quick, host: this.players.size === 0, fin: null };
        this.players.set(id, p);
        if (this.quick && this.players.size >= Math.min(MAX, this.track.lanes)) this.scheduleAuto(4000);
        this.send(ws, { t: 'welcome', id });
        this.all(this.snapshot());
        return;
      }
    }
    if (!me) return;
    switch (m.t) {
      case 'track': {
        if (!me.host || this.phase !== 'lobby' || !m.track || this.quick) return;
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
        if (!m.keepChamp) this.champ = null;
        let l = 0; for (const p of this.players.values()) p.lane = l++;
        for (const p of this.players.values()) p.ready = false;
        this.all(this.snapshot());
        return;
      }
      case 'laps': {
        if (!me.host || this.phase !== 'lobby' || !this.track || this.quick) return;
        this.track.laps = Math.max(1, Math.min(20, Math.round(Number(m.laps) || 3)));
        for (const p of this.players.values()) p.ready = false;
        this.all(this.snapshot());
        return;
      }
      case 'champ': { // el anfitrión empieza (o quita) una copa
        if (!me.host || this.phase !== 'lobby' || this.quick) return;
        const cup = CUPS[m.cup];
        if (!cup) { this.champ = null; this.all(this.snapshot()); return; }
        if (this.players.size > 2 && cup.tracks.some((id) => offTrack(id).lanes < this.players.size)) { this.send(ws, { t: 'error', msg: 'Esa copa tiene circuitos de 2 carriles: sois demasiados' }); return; }
        this.champ = { cup: m.cup, name: cup.name, tracks: cup.tracks, idx: 0, pts: {}, final: false };
        this.track = offTrack(cup.tracks[0], Math.max(1, Math.min(10, Math.round(Number(m.laps) || 3))));
        let l = 0; for (const p of this.players.values()) p.lane = l++;
        for (const p of this.players.values()) p.ready = false;
        this.all(this.snapshot());
        return;
      }
      case 'cpu': if (me.host && this.phase === 'lobby' && !this.quick) { this.cpu = !!m.v; this.all(this.snapshot()); } return;
      case 'me': {
        if (this.phase !== 'lobby') return;
        me.liv = this.pickLiv(clean(m.liv, 12), id); me.cls = m.cls === 'pro' ? 'pro' : 'iman'; me.car = carOf(m.car);
        this.all(this.snapshot());
        return;
      }
      case 'ready': me.ready = !!m.v; this.all(this.snapshot()); return;
      case 'start': {
        if (!me.host || this.phase !== 'lobby' || !this.track) return;
        if (this.champ && this.champ.final) { this.send(ws, { t: 'error', msg: 'La copa ha terminado: elige otra o un circuito' }); return; }
        if ([...this.players.values()].some((p) => !p.ready && !p.host)) { this.send(ws, { t: 'error', msg: 'Faltan pilotos por estar listos' }); return; }
        this.startRace();
        return;
      }
      case 'st': { // estado de un coche (el suyo, o los de la CPU si es el anfitrión)
        if (this.phase !== 'race') return;
        let from = id;
        if (m.bot) { if (!me.host || !this.bots.some((b) => b.id === m.bot)) return; from = m.bot; }
        this.all({ t: 'st', id: from, s: +m.s, v: +m.v, th: +m.th, lap: m.lap | 0, out: !!m.out }, id);
        return;
      }
      case 'lap': {
        let from = id;
        if (m.bot) { if (!me.host) return; from = m.bot; }
        this.all({ t: 'lap', id: from, lap: m.lap | 0, time: +m.time }, id);
        return;
      }
      case 'fin': {
        if (this.phase !== 'race') return;
        if (m.bot) {
          const b = this.bots.find((x) => x.id === m.bot);
          if (!me.host || !b || b.fin) return;
          b.fin = { time: +m.time, best: +m.best };
          this.all({ t: 'fin', id: b.id, time: b.fin.time, best: b.fin.best });
        } else {
          if (me.fin) return;
          me.fin = { time: +m.time, best: +m.best };
          this.all({ t: 'fin', id, time: me.fin.time, best: me.fin.best });
        }
        this.checkEnd();
        return;
      }
      case 'lobby': if (me.host && this.phase === 'race') this.endRace(); return;
    }
  }
}
