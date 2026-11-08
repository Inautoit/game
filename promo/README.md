# Vídeo promocional

`isla-rodante-promo.mp4` — 33 s, vertical 1080×1920 (TikTok, Reels, Shorts), 30 fps, con música original.

Se graba con imágenes reales del juego, fotograma a fotograma con tiempo virtual
(funciona aunque el ordenador no tenga tarjeta gráfica):

```bash
# 1. Servidor local del juego en http://localhost:8124 (con mapas de comunidad)
# 2. Grabar fotogramas (~1000 imágenes)
node promo/record.js <carpeta_salida>
# 3. Música sintetizada (sin derechos de terceros) ajustada a los cortes
python3 -I promo/music.py <carpeta_salida>/timeline.json <carpeta_salida>/music.wav
# 4. Montaje
ffmpeg -framerate 30 -i <carpeta_salida>/frames/%05d.jpg -i <carpeta_salida>/music.wav \
  -af volume=-1.5dB -c:v libx264 -crf 19 -pix_fmt yuv420p -c:a aac -b:a 192k -shortest \
  -movflags +faststart isla-rodante-promo.mp4
```

Guion: gancho («¿Eres capaz de llegar a la meta?») → Pradera → Desierto → Nieve →
victoria con 3 estrellas → comunidad → editor → cartel final con el enlace.
