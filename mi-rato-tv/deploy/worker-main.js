// Worker de Mi Rato TV: sirve la app y /lista.json con los Shorts nuevos de los canales oficiales.
import { CANALES, parseFeed, mezclar } from './canales.js';
import { FILES } from './files.js';

const dec = (b) => Uint8Array.from(atob(b), c => c.charCodeAt(0));
const HORAS = 3;

async function lista(ctx) {
  const cache = caches.default, key = new Request('https://mi-rato-tv.cache/lista.json');
  const hit = await cache.match(key);
  if (hit) return hit;
  const porCanal = await Promise.all(CANALES.map(async (canal) => {
    try {
      const r = await fetch(`https://www.youtube.com/feeds/videos.xml?playlist_id=UUSH${canal.id.slice(2)}`,
        { headers: { 'user-agent': 'MiRatoTV/1.0 (https://mi-rato-tv.inautoit.workers.dev)' } });
      return { canal, videos: r.ok ? parseFeed(await r.text()) : [] };
    } catch { return { canal, videos: [] }; }
  }));
  const body = JSON.stringify({ actualizado: new Date().toISOString(), videos: mezclar(porCanal) });
  const res = new Response(body, { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': `public, max-age=${HORAS * 3600}` } });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/lista.json') return lista(ctx);
    const f = FILES[url.pathname === '/' ? '/index.html' : url.pathname];
    if (!f) return new Response('No encontrado', { status: 404 });
    const fresh = /\.(png|svg)$/.test(url.pathname) ? 'public, max-age=86400' : 'no-cache';
    return new Response(dec(f.b), { headers: { 'content-type': f.t, 'cache-control': fresh } });
  },
};
