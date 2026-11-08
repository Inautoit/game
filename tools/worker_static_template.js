// Worker de Cloudflare que sirve un juego estático (generado por tools/build_worker.py).
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
const TYPES = { glb: 'model/gltf-binary', hdr: 'application/octet-stream', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp', txt: 'text/plain; charset=utf-8' };
export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    // Archivos grandes (modelos, HDRI, texturas) desde el almacén KV
    if (url.pathname.startsWith('/assets/') && env.ASSETS) {
      const data = await env.ASSETS.get(url.pathname.slice(1), 'arrayBuffer');
      if (data) {
        const ext = url.pathname.split('.').pop();
        return new Response(data, { headers: { 'content-type': TYPES[ext] || 'application/octet-stream', 'cache-control': 'public, max-age=604800', 'x-content-type-options': 'nosniff' } });
      }
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
