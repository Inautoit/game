#!/usr/bin/env bash
# Publica Isla Rodante como Worker de Cloudflare (juego + API de mapas en D1).
# Requiere: CLOUDFLARE_API_TOKEN (Workers Scripts: Edit y D1: Edit) y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")/.."
NAME="${WORKER_NAME:-isla-rodante}"
D1_ID="${D1_ID:-4877a103-abe0-4879-bbda-a1bb6cc6564c}"
TMP="$(mktemp -d)"
mkdir -p "$TMP/dist"
cp -r index.html styles.css src vendor icons fonts manifest.webmanifest sw.js og-image.png "$TMP/dist/"
python3 -I tools/build_worker.py "$TMP/dist" "$TMP/worker.js" tools/worker_template.js
cp src/levels.js "$TMP/levels.js"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$NAME"
META="{\"main_module\":\"worker.js\",\"compatibility_date\":\"2024-11-01\",\"bindings\":[{\"type\":\"d1\",\"name\":\"DB\",\"id\":\"$D1_ID\"}]}"
curl -fsS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@$TMP/worker.js;type=application/javascript+module" \
  -F "levels.js=@$TMP/levels.js;type=application/javascript+module" > /dev/null
curl -fsS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H "Content-Type: application/json" -d '{"enabled":true,"previews_enabled":false}' > /dev/null
rm -rf "$TMP"
echo "Publicado: https://$NAME.inautoit.workers.dev"
