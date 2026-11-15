"""Empaqueta Mi Rato TV en un Worker: files.js (la app) + canales.js + worker-main.js."""
import os, json, base64
H = os.path.dirname(os.path.abspath(__file__)); D = os.path.join(H, '..')
T = {'.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
     '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'}
files = {}
for f in sorted(os.listdir(D)):
    e = os.path.splitext(f)[1]
    if e in T and os.path.isfile(os.path.join(D, f)):
        files['/' + f] = {'t': T[e], 'b': base64.b64encode(open(os.path.join(D, f), 'rb').read()).decode()}
open(os.path.join(H, 'files.js'), 'w').write('export const FILES = ' + json.dumps(files) + ';\n')
print(len(files), 'archivos')
