#!/usr/bin/env bash
# Publica Turbo Slot como Worker de Cloudflare en https://turbo-slot.inautoit.workers.dev
# - El código va dentro del Worker.
# - Los archivos grandes de assets/ (modelos, HDRI, texturas) se suben al almacén KV.
# Requiere: CLOUDFLARE_API_TOKEN (Workers Scripts y Workers KV: Edit) y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")"
NAME="${WORKER_NAME:-turbo-slot}"
KV_ID="${KV_ID:-d681275e45a34dbda40d050dd4372757}"
ACC="$CLOUDFLARE_ACCOUNT_ID"
API_KV="https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces/$KV_ID/values"
# 1) Subir assets al KV (clave = ruta, p. ej. assets/models/car_hi.glb)
find assets -type f \( -name '*.glb' -o -name '*.hdr' -o -name '*.jpg' -o -name '*.png' -o -name '*.webp' \) | sort | while read -r f; do
  key=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" "$f")
  curl -fsS -X PUT "$API_KV/$key" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/octet-stream" --data-binary @"$f" > /dev/null
  echo "  KV ← $f ($(du -h "$f" | cut -f1))"
done
# 2) Empaquetar el código (sin los assets grandes) y publicar el Worker
TMP="$(mktemp -d)"
mkdir -p "$TMP/dist/assets"
cp -r index.html styles.css src vendor icons fonts manifest.webmanifest sw.js og-image.png "$TMP/dist/"
cp assets/CREDITOS.md "$TMP/dist/assets/" 2>/dev/null || true
python3 -I ../tools/build_worker.py "$TMP/dist" "$TMP/worker.js" ../tools/worker_static_template.js
API="https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/$NAME"
META="{\"main_module\":\"worker.js\",\"compatibility_date\":\"2024-11-01\",\"compatibility_flags\":[\"nodejs_compat\"],\"bindings\":[{\"type\":\"kv_namespace\",\"name\":\"ASSETS\",\"namespace_id\":\"$KV_ID\"}]}"
curl -fsS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@$TMP/worker.js;type=application/javascript+module" > /dev/null
curl -fsS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled":true,"previews_enabled":false}' > /dev/null
rm -rf "$TMP"
echo "Publicado: https://$NAME.inautoit.workers.dev"
