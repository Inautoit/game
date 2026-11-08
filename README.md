# Corte Perfecto ✂️

**¿Eres capaz de cortar exactamente 50/50?**

Juego de habilidad para **iPhone, iPad y Android** (también PC). Aparece una
figura (manzana, tarta, pez, pizza, estrella…) y tienes que **cortarla en dos
mitades exactas** con un deslizamiento del dedo. El juego calcula el área real
de cada trozo y te dice el porcentaje: `49,8% / 50,2%`.

- ⏱️ **Partidas de ~30 segundos**: 10 cortes, cada uno con su cuenta atrás.
- 📅 **Reto diario**: las mismas 10 figuras para todo el mundo cada día (#1, #2, #3…).
- 🔥 **Racha de días** jugando el reto diario.
- 🎯 **Combos** al encadenar cortes perfectos.
- 📤 **Compartir resultado** en un mensaje con emojis, al estilo Wordle:
  ```
  ✂️ Corte Perfecto #12
  🎯🟩🟨🟩🎯🟧🟩🟩🎯🟩
  Precisión: 96,4 % · 1534 pts
  ```
- 📲 **Instalable** en la pantalla de inicio y **funciona sin conexión** (PWA).
- Sin librerías, sin compilación, sin servidor: solo archivos estáticos.

## Cómo se juega

1. Desliza el dedo en línea recta a través de la figura.
2. Al soltar, se corta por esa línea (la guía punteada te ayuda a apuntar).
3. Cuanto más cerca del 50/50, más puntos:

| Diferencia con 50 % | Resultado | Emoji |
|---|---|---|
| < 0,25 % | ¡PERFECTO! | 🎯 |
| < 2,5 % | ¡Genial! | 🟩 |
| < 5 % | Bien | 🟨 |
| < 10 % | Regular | 🟧 |
| ≥ 10 % | ¡Uy! | 🟥 |
| Se acaba el tiempo | — | ⬛ |

A partir de la 4.ª figura empiezan a **girar**, y desde la 7.ª también **se mueven**.
Las figuras no están centradas en la tabla y casi ninguna es simétrica: no vale
cortar siempre por el medio 😉

## Probarlo en tu ordenador

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000>. Desde el móvil (misma wifi):
`http://IP-DE-TU-ORDENADOR:8000`.

## 🌐 Jugar ahora

**<https://corte-perfecto.inautoit.workers.dev>**

Publicado como Worker de Cloudflare. Para volver a publicar tras cambiar algo
(sube antes la versión de caché en `sw.js`):

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... tools/deploy.sh
```

## Alternativa: Cloudflare Pages (gratis)

### Opción A — Conectado a GitHub (recomendada: se actualiza solo)
1. Entra en <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → pestaña **Pages** → **Connect to Git**.
2. Elige este repositorio y la rama que quieras publicar.
3. Configuración de compilación:
   - **Framework preset:** `None`
   - **Build command:** *(vacío)*
   - **Build output directory:** `/`
4. **Save and Deploy**. Tendrás una dirección tipo `https://corte-perfecto.pages.dev`.
   Cada `git push` vuelve a publicar automáticamente.

### Opción B — Subir la carpeta a mano
**Workers & Pages** → **Create** → **Pages** → **Upload assets** → arrastra la
carpeta del proyecto (sin la carpeta `.git`).

### Opción C — Desde la terminal
```bash
npx wrangler pages deploy . --project-name corte-perfecto
```

### Después de publicar
- Si cambias de dirección, actualiza `og:image` y `og:url` en `index.html`
  para que la vista previa salga bien al compartir el enlace.
- Si cambias archivos, sube la versión de caché en `sw.js`
  (`corte-perfecto-v1` → `v2`) para que los móviles cojan la versión nueva.
- Puedes poner un dominio propio en **Custom domains** del proyecto de Pages.

## Añadirlo a la pantalla de inicio

- **iPhone / iPad (Safari):** botón **Compartir** → **Añadir a pantalla de inicio**.
- **Android (Chrome):** menú ⋮ → **Instalar aplicación**.

Se abre a pantalla completa con su icono, como una app.

## Estructura

```
index.html            Página, HUD, menú y resultados
styles.css            Estilos (adaptados a notch y zonas seguras)
src/game.js           Todo el juego: figuras, corte, puntuación, sonido, controles
manifest.webmanifest  Datos de la app instalable
sw.js                 Service worker (modo sin conexión)
fonts/                Tipografía Fredoka (licencia OFL)
_headers              Cabeceras para Cloudflare Pages
tools/                Script de publicación como Worker de Cloudflare
icons/                Iconos de la app
og-image.png          Imagen para compartir en redes
```

## Ideas para seguir (y para monetizar)

- **Ranking mundial del reto diario** con Cloudflare Workers + D1.
- **Retar a un amigo**: enlace con tu puntuación para que intente superarla.
- **Modo infinito / contrarreloj** y nuevas figuras cada semana.
- **Cuchillos y tablas personalizados** (cosméticos de pago).
- **Vídeo del corte** listo para TikTok / Reels.
- Publicarlo en App Store / Google Play empaquetado con Capacitor.
