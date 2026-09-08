#!/usr/bin/env bash
# Despliegue completo en Cloudflare desde cero.
#
#   bash scripts/desplegar.sh
#
# Requiere estar autenticado (npx wrangler login) o tener CLOUDFLARE_API_TOKEN
# y CLOUDFLARE_ACCOUNT_ID en el entorno.
set -euo pipefail

cd "$(dirname "$0")/.."
BD="verisure-clientes"

echo "▸ 1/4 · Creando la base de datos D1 (si no existe)…"
if ! grep -q 'database_id = "PENDIENTE_DE_CREAR"' wrangler.toml; then
  echo "  La base de datos ya está configurada en wrangler.toml; se omite."
else
  SALIDA=$(npx wrangler d1 create "$BD" 2>&1 || true)
  echo "$SALIDA"
  ID=$(echo "$SALIDA" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1)
  if [ -z "$ID" ]; then
    echo "  No se pudo leer el identificador. Cópialo a mano en wrangler.toml y vuelve a ejecutar." >&2
    exit 1
  fi
  sed -i.bak "s/PENDIENTE_DE_CREAR/$ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "  database_id = $ID"
fi

echo "▸ 2/4 · Aplicando las migraciones (esquema + cuentas iniciales)…"
npx wrangler d1 migrations apply "$BD" --remote

echo "▸ 3/4 · Configurando el secreto de firma de sesiones…"
if [ -n "${AUTH_SECRET:-}" ]; then
  printf '%s' "$AUTH_SECRET" | npx wrangler secret put AUTH_SECRET
else
  head -c 32 /dev/urandom | base64 | npx wrangler secret put AUTH_SECRET
fi

echo "▸ 4/4 · Publicando el Worker…"
npx wrangler deploy

echo
echo "✅ Listo. Entra con admin / Verisure2026!Admin y cambia las contraseñas."
