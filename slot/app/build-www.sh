#!/usr/bin/env bash
# Copia el juego completo (con coches, texturas y sonidos) a app/www, que es lo que va dentro de la app.
set -euo pipefail
cd "$(dirname "$0")"
rm -rf www && mkdir -p www
cd ..
cp -r index.html privacidad.html normas.html soporte.html legal_style.css styles.css manifest.webmanifest sw.js og-image.png src vendor icons fonts app/www/
mkdir -p app/www/assets
cp -r assets/models assets/tex assets/hdri assets/audio assets/cars assets/CREDITOS.md app/www/assets/
echo "www listo: $(du -sh app/www | cut -f1) · versión $(grep -o "GAME_VERSION = '[^']*'" src/version.js)"
