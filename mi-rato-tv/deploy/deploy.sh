#!/usr/bin/env bash
# Publica Mi Rato TV en https://mi-rato-tv.<subdominio>.workers.dev
# Necesita CLOUDFLARE_API_TOKEN y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/mi-rato-tv"
curl -sS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"worker-main.js","compatibility_date":"2026-11-01"};type=application/json' \
  -F "worker-main.js=@worker-main.js;type=application/javascript+module" \
  -F "canales.js=@../canales.js;type=application/javascript+module" \
  -F "files.js=@files.js;type=application/javascript+module"
curl -sS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" -H 'content-type: application/json' -d '{"enabled":true}'
