#!/usr/bin/env bash
# Publica una actualización al momento para la app: empaqueta app/www en un zip, lo sube al almacén KV del servidor
# y actualiza app/latest.json. La app la descarga sola y la pone la siguiente vez que se abre.
# Uso: CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… bash build-bundle.sh [versión mínima de la app nativa]
set -euo pipefail
cd "$(dirname "$0")"
bash build-www.sh
VER=$(grep -o "GAME_VERSION = '[^']*'" ../src/version.js | cut -d"'" -f2)
MIN_NATIVE="${1:-1.0.0}"
ZIP="bundle-$VER.zip"
rm -f "$ZIP"
(cd www && zip -qr -X "../$ZIP" .)
SHA=$(sha256sum "$ZIP" | cut -d' ' -f1)
KV_ID="${KV_ID:-d681275e45a34dbda40d050dd4372757}"
API_KV="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/storage/kv/namespaces/$KV_ID/values"
put() { curl -fsS -X PUT "$API_KV/$(python3 -c "import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1], safe=''))" "$1")" -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" "${@:2}" > /dev/null; }
put "assets/app/$ZIP" -H "Content-Type: application/octet-stream" --data-binary @"$ZIP"
printf '{"version":"%s","url":"https://turbo-slot.inautoit.workers.dev/assets/app/%s","sha256":"%s","minNative":"%s"}' "$VER" "$ZIP" "$SHA" "$MIN_NATIVE" > latest.json
put "app/latest.json" -H "Content-Type: application/json" --data-binary @latest.json
echo "Publicada la actualización $VER ($(du -h "$ZIP" | cut -f1), sha256 $SHA)"
