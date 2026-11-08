// Worker de Cloudflare que sirve un juego estático (generado por tools/build_worker.py).
const FILES = __FILES__;
const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const f = FILES[url.pathname];
    if (!f) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    return new Response(bin(f[1]), {
      headers: {
        'content-type': f[0],
        'x-content-type-options': 'nosniff',
        'cache-control': url.pathname === '/sw.js' || f[0].startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
      },
    });
  },
};
