# Isla Rodante 🏝️

**Inclina la isla. Llega a la meta.**

Puzle de habilidad en **3D** para iPhone, iPad, Android y PC. Arrastra el dedo
(o inclina el dispositivo) para inclinar una isla flotante y llevar la bola de
playa hasta la bandera, recogiendo gemas y sin caerte por los bordes.

## 🌐 Jugar

**<https://isla-rodante.inautoit.workers.dev>**

En iPhone / iPad (Safari): **Compartir → Añadir a pantalla de inicio** para
tenerlo como app a pantalla completa y sin conexión.

## Contenido

- **18 niveles en 3 mundos**, cada uno con su mecánica:
  - 🌿 **Pradera** — laberintos.
  - 🏜️ **Desierto** — agujeros y bordes sin barandilla.
  - ❄️ **Nieve** — hielo que resbala.
- **3 estrellas por nivel**: llegar a la meta, recoger las 3 gemas y batir el tiempo objetivo.
- **Isla del día**: un laberinto nuevo cada día, igual para todos, con racha y resultado para compartir.
- Progreso, estadísticas y ajustes (sonido, vibración, control por inclinación).
- Sonido sintetizado (rodar, choques, gemas, victoria) y vibración.
- Funciona sin conexión (PWA) y no recoge datos.

## Controles

| Dispositivo | Control |
|---|---|
| Móvil / iPad | Arrastrar el dedo en cualquier parte (joystick virtual) |
| Móvil / iPad | Inclinar el dispositivo (activar en Ajustes) |
| PC | Flechas o WASD · `Esc` pausa · `R` reinicia |

## Probar en local

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000>.

## Publicar

Publicado como Worker de Cloudflare. Tras cambiar algo (sube la versión de
caché en `sw.js`):

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... tools/deploy.sh
```

También sirve cualquier hosting estático (Cloudflare Pages, GitHub Pages,
Netlify…): no hay que compilar nada.

## Crear niveles

Los niveles están en `src/levels.js` como mapas de texto:

```
#  muro        .  suelo       ~  hielo
S  salida      G  meta        *  gema (3 por nivel)
T  árbol       espacio / o    vacío (te caes)
```

## Estructura

```
index.html            Interfaz (menús, HUD, ventanas)
styles.css            Estilos
src/main.js           Motor del juego: escena 3D, física, controles, sonido
src/levels.js         Niveles y generador de la Isla del día
vendor/               three.js (licencia MIT)
fonts/                Tipografía Fredoka (licencia OFL)
icons/, og-image.png  Iconos y vista previa para redes
manifest.webmanifest  App instalable
sw.js                 Modo sin conexión
tools/                Publicación en Cloudflare
```
