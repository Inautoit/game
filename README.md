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

- **Aventura: 18 niveles en 3 mundos**, cada uno con su mecánica:
  - 🌿 **Pradera** — laberintos.
  - 🏜️ **Desierto** — agujeros y bordes sin barandilla.
  - ❄️ **Nieve** — hielo que resbala.
- **3 estrellas por nivel**: llegar a la meta, recoger las 3 gemas y batir el tiempo objetivo.
- **Isla del día**: un laberinto nuevo cada día, igual para todos, con racha y resultado para compartir.
- **Modo infinito**: islas generadas sin fin, cada vez más grandes y con más peligros
  (agujeros desde la isla 4, bordes abiertos desde la 7, hielo desde la 10). 3 corazones,
  +1 cada 5 islas; el récord es la isla más lejana.
- **Editor de mapas**: pinta tu isla (suelo, muro, árbol, hielo, vacío, salida, meta y
  hasta 5 gemas), elige mundo y pruébala. **Solo se puede publicar un mapa después de
  superarlo**, así no hay mapas imposibles.
- **Comunidad**: mapas publicados por los jugadores, con pestañas Populares, Nuevos,
  Difíciles y Míos; partidas, victorias, «me gusta» y mejor tiempo de cada mapa.
  Cada mapa tiene su enlace (`?mapa=xxxxxxx`) para compartirlo.
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
# el token necesita permisos de Workers Scripts y D1
```

También sirve cualquier hosting estático (Cloudflare Pages, GitHub Pages,
Netlify…): no hay que compilar nada.

## Servidor de mapas

El mismo Worker que sirve el juego tiene una pequeña API (`tools/worker_template.js`)
sobre una base de datos **Cloudflare D1** (`isla-rodante-mapas`, esquema en
`tools/schema.sql`):

| Método | Ruta | Uso |
|---|---|---|
| GET | `/api/maps?sort=top\|new\|hard` | Listado (60 mapas) |
| GET | `/api/maps?ids=a,b,c` | Mapas concretos («Míos») |
| GET | `/api/maps/:id` | Un mapa |
| POST | `/api/maps` | Publicar `{name, author, world, map}` |
| POST | `/api/maps/:id/play\|win\|like` | Contadores |

El servidor vuelve a validar cada mapa (tamaño, salida, meta y que se pueda llegar a
todo), filtra nombres ofensivos y limita a 15 mapas al día por conexión. Para borrar
un mapa: panel de Cloudflare → D1 → `isla-rodante-mapas` → consola:
`DELETE FROM maps WHERE id = 'xxxxxxx';`

Los 8 mapas iniciales están firmados por **Equipo Isla Rodante** (`TEAM_MAPS` en
`src/levels.js`).

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
src/levels.js         Niveles, Isla del día, modo infinito y validación de mapas
src/editor.js         Editor de mapas
src/api.js            Cliente de la API de mapas
vendor/               three.js (licencia MIT)
fonts/                Tipografía Fredoka (licencia OFL)
icons/, og-image.png  Iconos y vista previa para redes
manifest.webmanifest  App instalable
sw.js                 Modo sin conexión
tools/                Publicación en Cloudflare, servidor de mapas y esquema de la base de datos
```
