"""Empaqueta el juego en un Worker de Cloudflare.

Uso: python3 -I tools/build_worker.py <carpeta_dist> <salida_worker.js> <plantilla.js>
"""
import base64, json, os, sys

src, out, template = sys.argv[1], sys.argv[2], sys.argv[3]
types = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8',
         '.js': 'text/javascript; charset=utf-8', '.webmanifest': 'application/manifest+json',
         '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.hdr': 'application/octet-stream', '.jpg': 'image/jpeg'}
files = {}
for root, _, names in os.walk(src):
    for n in names:
        p = os.path.join(root, n)
        rel = '/' + os.path.relpath(p, src).replace(os.sep, '/')
        ext = os.path.splitext(n)[1]
        if ext not in types:
            continue
        data = open(p, 'rb').read()
        if types[ext].startswith(('text/', 'application/manifest', 'image/svg')):
            files[rel] = [types[ext], data.decode('utf-8'), 0]   # texto: se sirve tal cual
        else:
            files[rel] = [types[ext], base64.b64encode(data).decode(), 1]  # binario
files['/'] = files['/index.html']
js = open(template).read().replace('__FILES__', json.dumps(files))
open(out, 'w').write(js)
print(len(js), 'bytes,', len(files), 'files')
