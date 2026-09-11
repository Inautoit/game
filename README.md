# Urus Traffic 🏁

**▶ Jugar: <https://urus-traffic.inautoit.workers.dev>**

Juego **3D de tráfico para móvil** que se abre directamente en el navegador.
Conduces un **Lamborghini Urus Mansory** esquivando el tráfico: cuanto más
rápido vas y más cerca pasas, más puntos sacas.

Hecho con [Three.js](https://threejs.org/). **Sin build, sin CDN y sin
dependencias en tiempo de ejecución**: se despliega tal cual en Cloudflare
Pages.

---

## Cómo se juega

Aceleras solo (se puede desactivar) y lo único que tienes que hacer es
esquivar. Se puntúa por:

| Acción | Puntos |
|---|---|
| Cada metro recorrido | ×0,55 (**doble** por encima de 108 km/h) |
| Adelantar un coche | +15 |
| Adelantar **rozando** (< 2,1 m) | +60, y ×2 si viene de frente |
| Combo de roces seguidos | +15 % por cada uno |

Los roces llenan el **nitro**: a partir del 35 % puedes soltarlo y subir a
324 km/h durante 3 segundos. Un solo choque termina la partida.

### Modos

- **Una dirección** — 4 carriles, todo el tráfico en tu sentido.
- **Dos direcciones** — 6 carriles con tráfico de frente y ×1,8 de puntos.

### Hora del día

**Día**, **Atardecer** y **Noche**. De noche se encienden faros, pilotos,
farolas y las ventanas de los edificios; se ve mucho menos, así que puntúa
igual pero cuesta bastante más.

### Controles

**Móvil** (tres modos, se eligen en Opciones):

- **Botones** — flechas a la izquierda, freno y nitro a la derecha.
- **Deslizar** — arrastras el dedo por la mitad inferior y el coche sigue.
- **Inclinar** — giroscopio. En iOS hay que aceptar el permiso que aparece.

**PC**: `A`/`D` o `←`/`→` girar · `W`/`S` acelerar y frenar · `Espacio` nitro.

---

## Despliegue

Ya está publicado en Cloudflare (proyecto `urus-traffic`, cuenta
`inautoit@outlook.es`) en <https://urus-traffic.inautoit.workers.dev>.

El repo **es** el sitio: no hay paso de compilación. `wrangler.toml` declara
la raíz como directorio de assets y `.assetsignore` deja fuera lo que no
forma parte del juego (README, `tools/`, workflows, `package.json`…).

### Publicar una versión nueva

```bash
npm install
npx wrangler login     # sólo la primera vez
npm run deploy
```

### O automáticamente desde GitHub Actions

`.github/workflows/deploy.yml` publica en cada push a la rama por defecto.
Sólo hay que dar de alta dos secretos en *Settings → Secrets and variables →
Actions*:

- `CLOUDFLARE_API_TOKEN` — token con permiso de edición de Workers/Pages.
- `CLOUDFLARE_ACCOUNT_ID` — `65d459cf690cddf4d4b15c2d02195cd0`.

### Dominio propio

En el panel de Cloudflare, dentro del proyecto `urus-traffic` →
*Settings → Domains & Routes*, se puede enganchar un dominio propio.

### Detalles

- `_headers` marca `assets/` y `vendor/` como inmutables durante un año y el
  HTML como `no-cache`, para que una versión nueva se vea al instante sin
  volver a bajar los 3 MB del coche.
- Hay un service worker (`sw.js`): tras la primera visita el juego funciona
  **sin conexión** y se puede instalar en la pantalla de inicio del móvil.
  Al desplegar cambios, sube el número de `CACHE` en `sw.js` para que los
  navegadores que ya lo tengan cacheado se enteren.

---

## Ejecutarlo en local

Los módulos ES no funcionan con `file://`, así que hace falta un servidor:

```bash
npm run preview   # http://localhost:8000
```

---

## Cómo está hecho

```
index.html      Pantallas, HUD y controles táctiles
styles.css      Interfaz (vertical, horizontal y safe areas de iPhone)
src/
  main.js       Renderer, carga del modelo, bucle y calidad adaptativa
  game.js       Máquina de estados, puntuación, colisiones y cámara
  player.js     El Urus: físicas, ruedas, faros y pintura
  traffic.js    Tráfico con InstancedMesh (18 coches, ~10 draw calls)
  vehicles.js   Geometrías procedurales de coche, furgoneta, camión y bus
  road.js       Carretera infinita y decorado reciclado por chunks
  sky.js        Mapa de entorno procedural (los reflejos de la chapa)
  input.js      Teclado, botones, deslizar e inclinación
  audio.js      Motor, choque y avisos sintetizados con WebAudio
  ui.js         DOM: menú, HUD, pausa y fin de partida
  config.js     Todos los números del juego en un solo sitio
assets/urus.glb El coche (3,1 MB) — ver assets/README.md
vendor/         Three.js r160 + GLTFLoader + decoder de meshopt
tools/          Script de optimización del modelo
```

### Decisiones pensando en el móvil

- **El coche nunca se mueve en Z.** Lo que se mueve es el mundo: la textura
  de la calzada hace scroll y los chunks de decorado se reciclan. Así no hay
  pérdida de precisión ni aunque juegues una hora seguida.
- **Sin shadow maps.** Cada vehículo lleva una sombra de mancha (un plano con
  un degradado), que en un móvil cuesta una fracción de lo que cuesta un mapa
  de sombras y aquí se ve igual de bien.
- **Todo el tráfico son `InstancedMesh`**: dos draw calls por tipo de
  vehículo, más uno para las sombras y otro para los faros.
- **Cada chunk de decorado es una sola geometría fusionada** con colores por
  vértice: un draw call para los edificios, árboles, farolas y quitamiedos de
  60 metros de ciudad.
- **Calidad adaptativa**: si el dispositivo no llega a 48 fps, `main.js` baja
  la resolución de render y la vuelve a subir si sobra margen.
- **Sin ficheros de audio**: el motor, el choque y los avisos se sintetizan
  con WebAudio.

---

## Ideas para seguir

- Garaje con varios coches y mejoras (motor, frenos, nitro).
- Misiones: llegar a X metros, N adelantamientos al límite, contrarreloj.
- Tabla de récords online (Cloudflare Workers + KV encaja perfecto).
- Lluvia y niebla como modificadores de dificultad.
- Policía que te persigue si pasas de 200 km/h.
