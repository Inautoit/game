#!/usr/bin/env bash
# Sube la máquina a Cloudflare Workers sin instalar nada (solo curl y node).
# Uso: CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./deploy.sh
set -euo pipefail
cd "$(dirname "$0")"
: "${CLOUDFLARE_ACCOUNT_ID:?falta CLOUDFLARE_ACCOUNT_ID}"
TOKEN="${CLOUDFLARE_API_TOKEN:-}"
NAME="${WORKER_NAME:-maquina-trader}"
API="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID"
AUTH=(-H "Authorization: Bearer $TOKEN")
node build.mjs

# 1) almacenamiento (KV): reutiliza si ya existe
KV_TITLE="$NAME-estado"
KV_ID=$(curl -sS "${AUTH[@]}" "$API/storage/kv/namespaces?per_page=100" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const r=JSON.parse(d).result||[];const n=r.find(x=>x.title===process.argv[1]);console.log(n?n.id:'')})" "$KV_TITLE")
if [ -z "$KV_ID" ]; then
  KV_ID=$(curl -sS "${AUTH[@]}" -H "content-type: application/json" -X POST "$API/storage/kv/namespaces" -d "{\"title\":\"$KV_TITLE\"}" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).result.id))")
fi
echo "KV: $KV_ID"

# 2) código
META=$(printf '{"main_module":"worker.js","compatibility_date":"2025-01-01","bindings":[{"type":"kv_namespace","name":"STATE","namespace_id":"%s"}],"keep_bindings":["secret_text"]}' "$KV_ID")
curl -sS --fail-with-body "${AUTH[@]}" -X PUT "$API/workers/scripts/$NAME" \
  -F "metadata=$META;type=application/json" \
  -F "worker.js=@worker.js;type=application/javascript+module" \
  -F "lib.js=@lib.js;type=application/javascript+module" \
  -F "dashboard.js=@dashboard.js;type=application/javascript+module" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('código:',j.success,JSON.stringify(j.errors))})"

# 3) que se ejecute sola cada 5 minutos
curl -sS --fail-with-body "${AUTH[@]}" -H "content-type: application/json" -X PUT "$API/workers/scripts/$NAME/schedules" \
  -d '[{"cron":"*/5 * * * *"}]' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('cron:',JSON.parse(d).success))"

# 4) publicar en <tu-subdominio>.workers.dev
curl -sS "${AUTH[@]}" -H "content-type: application/json" -X POST "$API/workers/scripts/$NAME/subdomain" \
  -d '{"enabled":true,"previews_enabled":false}' | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log('workers.dev:',JSON.parse(d).success))"
SUB=$(curl -sS "${AUTH[@]}" "$API/workers/subdomain" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).result.subdomain))")
echo "Panel: https://$NAME.$SUB.workers.dev"
