// Worker de Cloudflare: sirve el juego y la API de mapas de la comunidad (D1).
// Generado por tools/build_worker.py: FILES contiene los archivos del juego.
import { validateMap, estimateDifficulty } from './levels.js';

import { Buffer } from 'node:buffer';
const FILES = __FILES__;
const cache = new Map();
// El texto se sirve tal cual; los binarios se decodifican una vez por instancia (Buffer nativo, muy rápido)
function body(path, f) {
  if (!f[2]) return f[1];
  let b = cache.get(path);
  if (!b) { b = Buffer.from(f[1], 'base64'); cache.set(path, b); }
  return b;
}
const WORLDS = ['pradera', 'desierto', 'nieve'];

const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
});
const fail = (msg, status = 400) => json({ error: msg }, status);

const clean = (s, max) => String(s || '')
  .replace(/[\u0000-\u001f\u007f<>]/g, '')
  .replace(/\s+/g, ' ')
  .trim()
  .slice(0, max);

// Filtro básico de palabras ofensivas en nombres
const BAD = ['puta', 'puto', 'mierda', 'polla', 'coño', 'cabron', 'cabrón', 'gilipollas', 'maricon', 'maricón', 'zorra', 'nazi', 'fuck', 'shit', 'bitch'];
const isBad = (s) => { const t = s.toLowerCase(); return BAD.some((w) => t.includes(w)); };

async function sha(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].slice(0, 12).map((b) => b.toString(16).padStart(2, '0')).join('');
}
function newId() {
  const a = 'abcdefghijkmnpqrstuvwxyz23456789';
  const r = crypto.getRandomValues(new Uint8Array(7));
  return [...r].map((b) => a[b % a.length]).join('');
}
const PUBLIC = 'id, name, author, world, map, w, h, difficulty, plays, wins, likes, best_time, created';
const rowOut = (r) => ({ ...r, map: JSON.parse(r.map) });

async function api(req, env, url) {
  const parts = url.pathname.split('/').filter(Boolean); // ['api','maps',id?,action?]
  if (parts[1] !== 'maps') return fail('No encontrado', 404);
  const db = env.DB;

  // Listado
  if (req.method === 'GET' && parts.length === 2) {
    const sort = url.searchParams.get('sort');
    const order = sort === 'new' ? 'created DESC' : sort === 'hard' ? 'difficulty DESC, plays DESC' : '(plays + likes * 3) DESC, created DESC';
    const ids = (url.searchParams.get('ids') || '').split(',').filter((x) => /^[a-z0-9]{7}$/.test(x)).slice(0, 50);
    const q = ids.length
      ? db.prepare(`SELECT ${PUBLIC} FROM maps WHERE id IN (${ids.map(() => '?').join(',')}) ORDER BY created DESC`).bind(...ids)
      : db.prepare(`SELECT ${PUBLIC} FROM maps ORDER BY ${order} LIMIT 60`);
    const { results } = await q.all();
    return json({ maps: results.map(rowOut) });
  }

  // Un mapa
  if (req.method === 'GET' && parts.length === 3) {
    const r = await db.prepare(`SELECT ${PUBLIC} FROM maps WHERE id = ?`).bind(parts[2]).first();
    return r ? json({ map: rowOut(r) }) : fail('Ese mapa no existe', 404);
  }

  // Publicar
  if (req.method === 'POST' && parts.length === 2) {
    if (Number(req.headers.get('content-length') || 0) > 8000) return fail('Mapa demasiado grande');
    let body;
    try { body = await req.json(); } catch { return fail('Datos no válidos'); }
    const name = clean(body.name, 28), author = clean(body.author, 20);
    const world = WORLDS.includes(body.world) ? body.world : 'pradera';
    if (name.length < 3) return fail('El nombre debe tener al menos 3 letras');
    if (author.length < 2) return fail('Pon tu nombre de jugador');
    if (isBad(name) || isBad(author)) return fail('Elige otro nombre, por favor');
    if (!Array.isArray(body.map) || body.map.some((r) => typeof r !== 'string')) return fail('Mapa no válido');
    const rows = body.map.map((r) => r.replace(/\s+$/, ''));
    while (rows.length && !rows[rows.length - 1].trim()) rows.pop();
    while (rows.length && !rows[0].trim()) rows.shift();
    const errs = validateMap(rows);
    if (errs.length) return fail(errs[0]);
    const ipHash = await sha((req.headers.get('cf-connecting-ip') || '') + ':isla');
    const recent = await db.prepare('SELECT COUNT(*) AS n FROM maps WHERE ip_hash = ? AND created > ?').bind(ipHash, Date.now() - 864e5).first();
    if (recent && recent.n >= 15) return fail('Has publicado muchos mapas hoy. Vuelve mañana', 429);
    const w = Math.max(...rows.map((r) => r.length));
    const id = newId();
    await db.prepare('INSERT INTO maps (id, name, author, world, map, w, h, difficulty, created, ip_hash) VALUES (?,?,?,?,?,?,?,?,?,?)')
      .bind(id, name, author, world, JSON.stringify(rows), w, rows.length, estimateDifficulty(rows), Date.now(), ipHash).run();
    return json({ id }, 201);
  }

  // Contadores: jugar / ganar / me gusta
  if (req.method === 'POST' && parts.length === 4) {
    const id = parts[2], act = parts[3];
    if (act === 'play') await db.prepare('UPDATE maps SET plays = plays + 1 WHERE id = ?').bind(id).run();
    else if (act === 'like') await db.prepare('UPDATE maps SET likes = likes + 1 WHERE id = ?').bind(id).run();
    else if (act === 'win') {
      let t = null;
      try { t = Number((await req.json()).time); } catch { /* sin tiempo */ }
      if (Number.isFinite(t) && t > 0.5 && t < 3600) {
        await db.prepare('UPDATE maps SET wins = wins + 1, best_time = CASE WHEN best_time IS NULL OR ? < best_time THEN ? ELSE best_time END WHERE id = ?').bind(t, t, id).run();
      } else {
        await db.prepare('UPDATE maps SET wins = wins + 1 WHERE id = ?').bind(id).run();
      }
    } else return fail('Acción no válida');
    return json({ ok: true });
  }
  return fail('No encontrado', 404);
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith('/api/')) {
      try { return await api(req, env, url); }
      catch (e) { return fail('Error del servidor', 500); }
    }
    const f = FILES[url.pathname];
    if (!f) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(body(url.pathname, f), {
      headers: {
        'content-type': f[0],
        'x-content-type-options': 'nosniff',
        'cache-control': url.pathname === '/sw.js' || f[0].startsWith('text/html') ? 'no-cache' : 'public, max-age=86400',
      },
    });
  },
};
