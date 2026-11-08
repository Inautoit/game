#!/usr/bin/env bash
# Publica Turbo Slot como Worker de Cloudflare en https://turbo-slot.inautoit.workers.dev
# Requiere: CLOUDFLARE_API_TOKEN (Workers Scripts: Edit) y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")"
NAME="${WORKER_NAME:-turbo-slot}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/dist"
cp -r index.html styles.css src vendor icons fonts assets manifest.webmanifest sw.js og-image.png "$TMP/dist/"
python3 -I ../tools/build_worker.py "$TMP/dist" "$TMP/worker.js" ../tools/worker_static_template.js
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$NAME"
curl -fsS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2024-11-01","compatibility_flags":["nodejs_compat"]};type=application/json' \
  -F "worker.js=@$TMP/worker.js;type=application/javascript+module" > /dev/null
curl -fsS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled":true,"previews_enabled":false}' > /dev/null
rm -rf "$TMP"
echo "Publicado: https://$NAME.inautoit.workers.dev"
