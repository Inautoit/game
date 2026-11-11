#!/usr/bin/env bash
# Publica Turbo Slot como Worker de Cloudflare en https://turbo-slot.inautoit.workers.dev
# - El código va dentro del Worker.
# - Los archivos grandes de assets/ (modelos, HDRI, texturas) se suben al almacén KV.
# Requiere: CLOUDFLARE_API_TOKEN (Workers Scripts, Workers KV y D1: Edit) y CLOUDFLARE_ACCOUNT_ID.
# Base de datos: server/schema.sql (crear una vez la tabla en D1).
set -euo pipefail
cd "$(dirname "$0")"
NAME="${WORKER_NAME:-turbo-slot}"
KV_ID="${KV_ID:-d681275e45a34dbda40d050dd4372757}"
ACC="$CLOUDFLARE_ACCOUNT_ID"
API_KV="https://api.cloudflare.com/client/v4/accounts/$ACC/storage/kv/namespaces/$KV_ID/values"
# 1) Subir assets al KV (clave = ruta, p. ej. assets/models/car_hi.glb)
[ -n "${SKIP_KV:-}" ] || find assets -type f \( -name '*.glb' -o -name '*.hdr' -o -name '*.jpg' -o -name '*.png' -o -name '*.webp' -o -name '*.wav' \) | sort | while read -r f; do
  key=$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" "$f")
  curl -fsS -X PUT "$API_KV/$key" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H "Content-Type: application/octet-stream" --data-binary @"$f" > /dev/null
  echo "  KV ← $f ($(du -h "$f" | cut -f1))"
done
# 2) Empaquetar el código (sin los assets grandes) y publicar el Worker
#    con la base de datos de circuitos (D1) y las salas online (Durable Object "Room")
D1_ID="${D1_ID:-b72d6b1d-60b9-4b43-abfc-c127fd561ed4}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/dist/assets"
cp -r index.html descubre.html privacidad.html normas.html soporte.html legal_style.css styles.css src vendor icons fonts manifest.webmanifest sw.js og-image.png "$TMP/dist/"
cp assets/CREDITOS.md "$TMP/dist/assets/" 2>/dev/null || true
python3 -I ../tools/build_worker.py "$TMP/dist" "$TMP/worker.js" server/worker_template.js
cp src/tracks.js src/physics.js src/dmath.js src/verify.js "$TMP/"
API="https://api.cloudflare.com/client/v4/accounts/$ACC/workers/scripts/$NAME"
BINDINGS="[{\"type\":\"kv_namespace\",\"name\":\"ASSETS\",\"namespace_id\":\"$KV_ID\"},{\"type\":\"d1\",\"name\":\"DB\",\"id\":\"$D1_ID\"},{\"type\":\"durable_object_namespace\",\"name\":\"ROOMS\",\"class_name\":\"Room\"}]"
upload() {
  curl -sS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    -F "metadata=$1;type=application/json" \
    -F "worker.js=@$TMP/worker.js;type=application/javascript+module" \
    -F "tracks.js=@$TMP/tracks.js;type=application/javascript+module" \
    -F "physics.js=@$TMP/physics.js;type=application/javascript+module" \
    -F "dmath.js=@$TMP/dmath.js;type=application/javascript+module" \
    -F "verify.js=@$TMP/verify.js;type=application/javascript+module"
}
BASE="\"main_module\":\"worker.js\",\"keep_bindings\":[\"secret_text\"],\"compatibility_date\":\"2024-11-01\",\"compatibility_flags\":[\"nodejs_compat\"],\"bindings\":$BINDINGS"
# La primera vez hay que crear la clase de las salas (migración v1); después ya existe
OUT=$(upload "{$BASE}")
if ! echo "$OUT" | grep -q '"success": *true'; then
  OUT=$(upload "{$BASE,\"migrations\":{\"new_tag\":\"v1\",\"new_sqlite_classes\":[\"Room\"]}}")
fi
echo "$OUT" | grep -q '"success": *true' || { echo "$OUT" | head -c 1500; exit 1; }
curl -fsS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled":true,"previews_enabled":false}' > /dev/null
rm -rf "$TMP"
echo "Publicado: https://$NAME.inautoit.workers.dev"
