import { Room } from './room.js';
export { Room };

// API de Urus Traffic. Sirve bajo /api/*; todo lo demás son ficheros
// estáticos que resuelve la plataforma antes de llegar aquí.
//
// Cuentas sin contraseña: el móvil guarda {id, secret}. Para cambiar de
// aparato hay un código de recuperación de 10 caracteres.

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const MODES = new Set(['oneway', 'twoway']);
const MAX_SPEED = 92;          // m/s reales del coche con nitro, con margen

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
const bad = (msg, status = 400) => json({ error: msg }, status);

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/room/')) return routeRoom(request, env, url);
    if (!url.pathname.startsWith('/api/')) return new Response('No encontrado', { status: 404 });

    try {
      return await routeApi(request, env, url, ctx);
    } catch (err) {
      console.error('api', err?.stack || err);
      return bad('Error del servidor', 500);
    }
  },
};

// --------------------------------------------------------------- salas
function routeRoom(request, env, url) {
  if (request.headers.get('Upgrade') !== 'websocket') {
    return new Response('Se esperaba una conexión WebSocket', { status: 426 });
  }
  const code = url.pathname.split('/')[2]?.toUpperCase();
  if (!code || !/^[A-Z0-9]{5}$/.test(code)) return new Response('Código inválido', { status: 400 });

  const id = env.ROOMS.idFromName(code);
  return env.ROOMS.get(id).fetch(request);
}

// ----------------------------------------------------------------- API
async function routeApi(request, env, url, ctx) {
  const path = url.pathname.slice(5);
  const method = request.method;

  if (method === 'POST' && path === 'account') return createAccount(request, env);
  if (method === 'POST' && path === 'account/recover') return recoverAccount(request, env);
  if (method === 'PATCH' && path === 'account') return renameAccount(request, env);
  if (method === 'GET' && path === 'leaderboard') return leaderboard(request, env, url);
  if (method === 'POST' && path === 'run') return startRun(request, env);
  if (method === 'POST' && path === 'score') return submitScore(request, env, ctx);

  return bad('Ruta desconocida', 404);
}

async function createAccount(request, env) {
  const body = await readJson(request);
  const name = cleanName(body?.name);
  if (!name) return bad('Nombre no válido');

  const id = crypto.randomUUID();
  const secret = randomToken(32);
  const recovery = randomCode(10);

  await env.DB.prepare(
    'INSERT INTO players (id, name, secret_hash, recovery_hash, created_at) VALUES (?, ?, ?, ?, ?)',
  ).bind(id, name, await sha256(secret), await sha256(recovery), Date.now()).run();

  return json({ id, secret, recovery, name });
}

async function recoverAccount(request, env) {
  const body = await readJson(request);
  const code = String(body?.recovery || '').trim().toUpperCase();
  if (!/^[A-Z0-9]{10}$/.test(code)) return bad('Código no válido');

  const row = await env.DB.prepare('SELECT id, name FROM players WHERE recovery_hash = ?')
    .bind(await sha256(code)).first();
  if (!row) return bad('Ese código no existe', 404);

  // Rotamos la credencial del aparato: el código viejo deja de servir para
  // la sesión anterior, así que recuperar no deja dos móviles con acceso.
  const secret = randomToken(32);
  await env.DB.prepare('UPDATE players SET secret_hash = ? WHERE id = ?')
    .bind(await sha256(secret), row.id).run();

  return json({ id: row.id, secret, name: row.name, recovery: code });
}

async function renameAccount(request, env) {
  const player = await authenticate(request, env);
  if (!player) return bad('No autenticado', 401);
  const body = await readJson(request);
  const name = cleanName(body?.name);
  if (!name) return bad('Nombre no válido');

  await env.DB.prepare('UPDATE players SET name = ? WHERE id = ?').bind(name, player.id).run();
  return json({ ok: true, name });
}

async function leaderboard(request, env, url) {
  const mode = url.searchParams.get('mode') || 'oneway';
  if (!MODES.has(mode)) return bad('Modo desconocido');
  const limit = Math.min(50, Math.max(5, Number(url.searchParams.get('limit')) || 25));

  const { results } = await env.DB.prepare(
    `SELECT p.name AS name, b.score AS score, b.distance AS distance, b.player_id AS id
       FROM bests b JOIN players p ON p.id = b.player_id
      WHERE b.mode = ? ORDER BY b.score DESC, b.updated_at ASC LIMIT ?`,
  ).bind(mode, limit).all();

  const rows = results.map((r, i) => ({
    rank: i + 1, name: r.name, score: r.score, distance: r.distance, id: r.id,
  }));

  let you = null;
  const player = await authenticate(request, env);
  if (player) {
    const mine = await env.DB.prepare('SELECT score, distance FROM bests WHERE player_id = ? AND mode = ?')
      .bind(player.id, mode).first();
    if (mine) {
      const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM bests WHERE mode = ? AND score > ?')
        .bind(mode, mine.score).first();
      you = { rank: (ahead?.n ?? 0) + 1, score: mine.score, distance: mine.distance, id: player.id };
    } else {
      you = { rank: null, score: 0, distance: 0, id: player.id };
    }
  }

  return json({ mode, rows, you });
}

// Vale de partida: firmado y con marca de tiempo, sin guardar nada. Al
// enviar la puntuación se comprueba que el reloj cuadra con lo que dice
// haber tardado.
async function startRun(request, env) {
  const player = await authenticate(request, env);
  if (!player) return bad('No autenticado', 401);

  const issued = Date.now();
  const nonce = randomToken(8);
  const payload = `${player.id}.${issued}.${nonce}`;
  const sig = await hmac(env, payload);
  return json({ runId: `${issued}.${nonce}.${sig}` });
}

async function submitScore(request, env, ctx) {
  const player = await authenticate(request, env);
  if (!player) return bad('No autenticado', 401);

  const body = await readJson(request);
  const mode = String(body?.mode || '');
  if (!MODES.has(mode)) return bad('Modo desconocido');

  const score = intOf(body?.score), distance = intOf(body?.distance);
  const overtakes = intOf(body?.overtakes), nearMisses = intOf(body?.nearMisses);
  const topSpeed = intOf(body?.topSpeed);
  if (score === null || distance === null || overtakes === null
      || nearMisses === null || topSpeed === null) return bad('Datos incompletos');

  const runId = String(body?.runId || '');
  const parts = runId.split('.');
  if (parts.length !== 3) return bad('Vale de partida no válido');
  const [issuedStr, nonce, sig] = parts;
  const issued = Number(issuedStr);
  if (!Number.isFinite(issued)) return bad('Vale de partida no válido');
  if (sig !== await hmac(env, `${player.id}.${issued}.${nonce}`)) return bad('Vale de partida no válido');

  const seconds = Math.round((Date.now() - issued) / 1000);
  const problem = implausible({ score, distance, overtakes, nearMisses, topSpeed, seconds });
  if (problem) return bad(problem, 422);

  const now = Date.now();
  try {
    await env.DB.prepare(
      `INSERT INTO runs (run_id, player_id, mode, score, distance, overtakes, near_misses, top_speed, seconds, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(runId, player.id, mode, score, distance, overtakes, nearMisses, topSpeed, seconds, now).run();
  } catch {
    return bad('Esa partida ya estaba registrada', 409);   // run_id es PRIMARY KEY
  }

  await env.DB.prepare(
    `INSERT INTO bests (player_id, mode, score, distance, updated_at) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(player_id, mode) DO UPDATE SET
       score = MAX(score, excluded.score),
       distance = MAX(distance, excluded.distance),
       updated_at = excluded.updated_at`,
  ).bind(player.id, mode, score, distance, now).run();

  const best = await env.DB.prepare('SELECT score FROM bests WHERE player_id = ? AND mode = ?')
    .bind(player.id, mode).first();
  const ahead = await env.DB.prepare('SELECT COUNT(*) AS n FROM bests WHERE mode = ? AND score > ?')
    .bind(mode, best?.score ?? score).first();

  return json({ ok: true, best: best?.score ?? score, rank: (ahead?.n ?? 0) + 1 });
}

// Comprobaciones de coherencia física. No para a quien se empeñe —para eso
// habría que revalidar la repetición— pero sí al que enchufa un número.
function implausible({ score, distance, overtakes, nearMisses, topSpeed, seconds }) {
  if (seconds < 3) return 'La partida ha durado demasiado poco';
  if (seconds > 4 * 3600) return 'El vale de partida ha caducado';
  if (topSpeed > MAX_SPEED * 3.6 + 5) return 'Velocidad imposible';
  if (distance > seconds * MAX_SPEED * 1.05 + 50) return 'Distancia imposible para ese tiempo';
  if (overtakes > distance / 6 + 10) return 'Más adelantamientos que carretera';
  if (nearMisses > overtakes) return 'Más roces que adelantamientos';
  // Techo generoso: distancia + adelantamientos + roces, todo al máximo.
  if (score > distance * 4 + overtakes * 60 + nearMisses * 300 + 500) return 'Puntuación imposible';
  return null;
}

// -------------------------------------------------------------- utilidades
async function authenticate(request, env) {
  const header = request.headers.get('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const cut = token.indexOf('.');
  if (cut < 0) return null;
  const id = token.slice(0, cut), secret = token.slice(cut + 1);
  if (!id || !secret) return null;

  const row = await env.DB.prepare('SELECT id, name, secret_hash FROM players WHERE id = ?').bind(id).first();
  if (!row) return null;
  return timingSafeEqual(row.secret_hash, await sha256(secret)) ? { id: row.id, name: row.name } : null;
}

async function hmacKey(env) {
  const row = await env.DB.prepare("SELECT v FROM meta WHERE k = 'run_key'").first();
  if (row?.v) return row.v;
  const key = randomToken(32);
  await env.DB.prepare("INSERT INTO meta (k, v) VALUES ('run_key', ?) ON CONFLICT(k) DO NOTHING")
    .bind(key).run();
  const after = await env.DB.prepare("SELECT v FROM meta WHERE k = 'run_key'").first();
  return after?.v || key;
}

async function hmac(env, payload) {
  const key = await hmacKey(env);
  const cryptoKey = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(payload));
  return hex(new Uint8Array(sig)).slice(0, 32);
}

async function sha256(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(new Uint8Array(buf));
}

const hex = (bytes) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');

function timingSafeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // sin I, O, 0, 1

function randomCode(len) {
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  return [...bytes].map((b) => ALPHABET[b % ALPHABET.length]).join('');
}

function randomToken(bytes) {
  return hex(crypto.getRandomValues(new Uint8Array(bytes)));
}

function cleanName(raw) {
  const name = String(raw || '').replace(/\s+/g, ' ').trim().slice(0, 16);
  return name.length >= 2 ? name : null;
}

function intOf(v) {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 0 && n < 1e9 ? n : null;
}

async function readJson(request) {
  try { return await request.json(); } catch { return null; }
}
