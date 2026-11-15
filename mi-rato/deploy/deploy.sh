#!/usr/bin/env bash
# Publica Mi Rato en https://mi-rato.<tu-subdominio>.workers.dev
# Necesita CLOUDFLARE_API_TOKEN (permiso Workers Scripts: Edit) y CLOUDFLARE_ACCOUNT_ID.
set -euo pipefail
cd "$(dirname "$0")"
python3 build.py
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/mi-rato"
curl -sS -X PUT "$API" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -F 'metadata={"main_module":"worker.js","compatibility_date":"2026-11-01"};type=application/json' \
  -F "worker.js=@worker.js;type=application/javascript+module"
curl -sS -X POST "$API/subdomain" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  -H 'content-type: application/json' -d '{"enabled":true}'
