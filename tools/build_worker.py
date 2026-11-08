import base64, json, os, sys
src, out = sys.argv[1], sys.argv[2]
types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
         '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}
files = {}
for root, _, names in os.walk(src):
    for n in names:
        p = os.path.join(root, n); rel = '/' + os.path.relpath(p, src).replace(os.sep, '/')
        ext = os.path.splitext(n)[1]
        if ext not in types: continue
        files[rel] = [types[ext], base64.b64encode(open(p,'rb').read()).decode()]
files['/'] = files['/index.html']
js = """// Generado automáticamente: sirve Corte Perfecto desde un Worker de Cloudflare.
const FILES = %s;
const bin = (b64) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const f = FILES[url.pathname];
    if (!f) return new Response('No encontrado', { status: 404, headers: { 'content-type': 'text/plain; charset=utf-8' } });
    const h = {
      'content-type': f[0],
      'x-content-type-options': 'nosniff',
      'cache-control': url.pathname === '/sw.js' || f[0].startsWith('text/html') ? 'no-cache' : 'public, max-age=3600',
    };
    return new Response(bin(f[1]), { headers: h });
  },
};
""" % json.dumps(files)
open(out, 'w').write(js)
print(len(js), 'bytes,', len(files), 'files')
