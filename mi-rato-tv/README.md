# Mi Rato TV

**En línea:** <https://mi-rato-tv.inautoit.workers.dev>

Reels de vídeos españoles (humor, música, cocina, noticias y nostalgia) **solo de canales oficiales**.
No se puede compartir, comentar, subir ni salir de la app: una capa invisible tapa todos los botones
del reproductor; solo se puede deslizar y tocar para pausar o activar el sonido.

- **Canales:** [`canales.js`](canales.js). Cloudflare descarga sus últimos Shorts cada 3 horas
  (`/lista.json`), quita anuncios, directos y sucesos duros, y los mezcla por temas.
- **Vídeos fijos elegidos a mano (opcional):** [`lista.js`](lista.js).
- **Publicar:** `CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… ./deploy/deploy.sh`
