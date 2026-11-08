#!/usr/bin/env bash
# Publica el juego como Worker de Cloudflare en https://corte-perfecto.inautoit.workers.dev
# Requiere: CLOUDFLARE_API_TOKEN (permiso Workers Scripts: Edit) y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${WORKER_NAME:-corte-perfecto}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/dist"
cp -r index.html styles.css src icons manifest.webmanifest sw.js og-image.png "$TMP/dist/"
python3 -I tools/build_worker.py "$TMP/dist" "$TMP/worker.js"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$NAME"
curl -fsS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2024-11-01"};type=application/json' \
  -F "worker.js=@$TMP/worker.js;type=application/javascript+module" > /dev/null
curl -fsS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled":true,"previews_enabled":false}' > /dev/null
rm -rf "$TMP"
echo "Publicado: https://$NAME.<tu-subdominio>.workers.dev"
