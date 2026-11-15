"""Empaqueta la app en un solo Worker de Cloudflare (deploy/worker.js).
Luego se sube con deploy/deploy.sh."""
import os, json, base64
import sys
D=os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
TYPES={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
       '.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'}
files={}
for f in sorted(os.listdir(D)):
    ext=os.path.splitext(f)[1]
    if ext not in TYPES: continue
    data=open(os.path.join(D,f),'rb').read()
    files['/'+f]={'t':TYPES[ext],'b':base64.b64encode(data).decode()}
files['/']=files['/index.html']
js='const FILES = '+json.dumps(files)+''';
const dec = (b) => Uint8Array.from(atob(b), c => c.charCodeAt(0));
export default {
  async fetch(req) {
    const url = new URL(req.url);
    const f = FILES[url.pathname];
    if (!f) return new Response('No encontrado', { status: 404 });
    const fresh = /\\.(png|svg)$/.test(url.pathname) ? 'public, max-age=86400' : 'no-cache';
    return new Response(dec(f.b), { headers: { 'content-type': f.t, 'cache-control': fresh } });
  },
};
'''
open(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'worker.js'),'w').write(js)
print(len(js))
