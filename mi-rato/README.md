# Mi Rato

**En línea:** <https://mi-rato.inautoit.workers.dev>

App tipo **Reels** para personas mayores: en lugar de deslizar vídeos sin fin,
cada reel ejercita la mente. **No hace falta tocar nada**: se mira, se escucha,
se piensa y, si se quiere, se responde en voz alta. Los reels pasan solos.

## Tipos de reel

| Reel | Qué hace |
|------|----------|
| ☀️ Saludo | Buenos días + fecha de hoy (orientación) + racha de días |
| ❓ Pregunta | Refranes, adivinanzas, cultura fácil y cuentas. Cuenta atrás para pensar y luego la respuesta |
| 🎵 Música | Suena una melodía conocida → «¿Qué canción es?» → respuesta y se vuelve a tocar para cantarla |
| 🍎 Sabías que | Comida sana, salud y recetas fáciles, en 3 frases cortas |
| 🧠 Memoria | Muestra 4 cosas, las tapa y pregunta cuáles eran |
| 🌿 Respira | Ejercicio de respiración guiado con música suave |
| ⏸️ Descanso | A los 15 minutos invita a levantarse o dar un paseo |

Todo se lee en voz alta (voz del navegador) y la música se genera en el propio
navegador (melodías tradicionales / de dominio público). Funciona sin conexión
y se puede **instalar en el móvil** («Añadir a pantalla de inicio»).

## Instalar en el móvil (icono en la pantalla de inicio)

- **Android (Chrome):** abre la dirección → menú ⋮ → «Añadir a pantalla de inicio» / «Instalar app».
- **iPhone (Safari):** abre la dirección → botón Compartir → «Añadir a pantalla de inicio».

Aparece el icono azul de **Mi Rato** y se abre a pantalla completa, como una app.

## Publicar cambios

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./deploy/deploy.sh
```

Empaqueta todo en un único Worker de Cloudflare (`deploy/build.py`) y lo sube.

## Ejecutar en local

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000/mi-rato/>.

## Añadir contenido

Todo el contenido está en [`content.js`](content.js): preguntas, canciones
(notas en texto, p. ej. `C4:1 D4:.5`), consejos y juegos de memoria.

## Archivos

```
index.html            Página
styles.css            Diseño (letra grande, alto contraste)
app.js                Feed de reels, tipos de reel, racha
audio.js              Voz y música (Web Audio)
content.js            Contenido
manifest.webmanifest  Instalable como app
sw.js                 Funciona sin conexión
deploy/               Publicación en Cloudflare Workers
```
