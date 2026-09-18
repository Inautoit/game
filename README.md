# Urus Traffic 🏁

**▶ Jugar: <https://urustraffic.inautoit.workers.dev>**

El enlace antiguo (`urus-traffic…`, con guion) redirige aquí.

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
| Cada metro recorrido | ×0,55, y hasta **×3** según lo rápido que vayas |
| Adelantar un coche | +15 |
| Adelantar **rozando** (< 2,1 m) | +60, y ×2 si viene de frente |
| Combo de roces seguidos | +15 % por cada uno |

### Rebufo

Ponte pegado detrás de otro —tráfico o persona— y el hueco que abre en el aire
te empuja: menos resistencia, más empuje y la punta sube de 299 a **331 km/h**
(341 detrás de un camión, que abre mucho más). La barra verde del HUD te dice
cuánto estás cogiendo, y el viento se apaga mientras vas en el hueco.

El número que lo explica todo: acelerar de 250 a 299 km/h **en solitario lleva
10,3 segundos; a rebufo, 1,65**. Los 300 casi no se alcanzan solo — hay que
ir a buscarlos detrás de alguien.

Y por eso adelantar es una decisión y no una carrera de potencia: para pasar
tienes que salirte, y en cuanto te sales lo pierdes. Salir demasiado pronto y
quedarte a medias es el error clásico.

Los roces llenan el **nitro**: a partir del 35 % puedes soltarlo y subir a
346 km/h durante 3 segundos. Un solo choque termina la partida.

El coche llega a **299 km/h**, pero el último tramo cuesta: de 0 a 200 vas en
cuatro segundos y de 250 a 295 tardas otros seis.

Cuanto más rápido vas, menos te puedes desplazar de lado — pero **el volante
responde igual de rápido siempre**. Esa distinción importa: limitar cuánto te
mueves obliga a frenar para trazar, mientras que retrasar la respuesta hace
que el coche parezca que te ignora, que es el peor pecado de un arcade.
Cambiar de carril lleva 0,47 s a 100 km/h y 0,62 s a 299. Y cambiar de lado
cuando ya girabas hacia el otro va aún más rápido, porque ése es el
movimiento que salva un esquive.

Además la niebla se abre con la velocidad: a tope ves unos 100 metros más de
carretera, para que dé tiempo a leer el tráfico.

### Sensación de velocidad

A partir de unos 110 km/h el juego empieza a deformarse contigo: desenfoque
radial que crece con la aguja, rayos de velocidad, aberración cromática,
viñeta y vibración de la cámara por el asfalto. El coche se queda nítido
siempre — el efecto respeta una zona alrededor de él — para que sigas viendo
lo que haces. Al meter nitro la cámara da un tirón hacia atrás, todo se tiñe
de azul y se dispara.

Los coches que adelantas suenan: un *whoosh* que barre de agudo a grave y
cruza el estéreo hacia el lado por el que han pasado. Si el roce es al
límite, suena el doble y el móvil vibra.

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

## Online

### Cuenta

No hay registro. La primera vez que juegas se crea una cuenta anónima y el
móvil guarda la credencial; el nombre se cambia en Opciones. Para llevártela
a otro aparato está el **código de recuperación** de 10 caracteres. Ni email,
ni contraseña, ni ningún dato personal que proteger.

### Ranking mundial

Cada partida en solitario se manda al ranking del modo en que la has jugado.
En la pantalla final ves tu puesto, y el botón *Ranking* lista el top 25.

Las partidas llevan un **vale firmado** con marca de tiempo, y el servidor
comprueba que lo que cuentas cuadra: la distancia con el tiempo, los
adelantamientos con la carretera que ha dado tiempo a recorrer, y los puntos
con todo lo anterior. Una partida no se puede reenviar dos veces. Esto para
al que enchufa un número desde la consola del navegador, no al que se
empeñe de verdad; para eso habría que mandar la repetición y revalidarla.

### Duelo online (hasta 6)

*Duelo online* → **Crear sala** te da un **código de 5 números**. Los demás
entran con él. El anfitrión elige modo y hora, y arranca.

Son números y no letras a propósito: se dictan por teléfono sin deletrear, no
hay mayúsculas ni caracteres que se confundan, y en el móvil sale el teclado
numérico en vez del alfabético.

Corréis todos por la misma carretera, **todos con el Urus**, cada uno del
color que haya elegido y viendo el mismo tráfico. Cada rival lleva además un
anillo de color en el asfalto y su nombre encima.
Arriba a la derecha tienes a cada uno con los metros que te saca o que le
sacas, y como el juego no tiene retrovisor, **abajo aparece quién te viene
por detrás** y por qué lado. **Cuando alguien choca, los demás siguen**: se avisa de quién ha
caído y cuántos quedan, y tú, si te has estrellado, pasas a ver la carrera
desde el que va líder. Gana el que llegue más lejos.

### Adelantar a una persona

Si el de delante frena o tarda en esquivar, le pasas — y se ve en las dos
pantallas: a uno le sale *¡Has adelantado a Fulano!* y al otro *Fulano te ha
adelantado*. Pasar a una persona vale **140 puntos**, casi diez veces más que
un coche del tráfico, y carga nitro.

Y no os atravesáis: si os tocáis, hay **empujón**. No es un choque —con 100 ms
de latencia un choque entre coches sería injusto para alguien—, sino un
apartón lateral con pérdida de velocidad que cada cliente aplica **sólo a su
propio coche**. Como los dos hacen lo mismo en sentidos opuestos, sale
simétrico sin que nadie tenga que arbitrar y la latencia no puede hacer
trampas.

Los duelos no puntúan para el ranking mundial: las condiciones no son las
mismas que en una partida en solitario.

#### Cómo va por dentro

- Una sala es un **Durable Object** direccionado por su código de 5 números. No simula
  nada: reparte mensajes y lleva quién sigue vivo. Con la API de hibernación
  no factura mientras nadie habla.
- Como tu coche nunca se mueve en Z, colocar a un rival es trivial:
  `z = suDistancia − miDistancia`. Por la red sólo viajan seis números por
  jugador a 10 Hz, unos 30 bytes.
- **El tráfico lo simula el anfitrión y lo retransmite** a 8 Hz. Es la única
  forma de que los seis veáis los mismos coches en el mismo sitio sin
  depender de que seis simulaciones no se separen nunca. Los invitados
  reconcilian por identificador y avanzan por estima entre paquete y
  paquete, así que no dan saltos. Si el anfitrión se cae, cada uno pasa a
  simular su propio tráfico en vez de quedarse en un mundo congelado.
- Los mensajes entrantes se facturan 20:1, así que una partida de seis a
  10 Hz sale por unas 540 peticiones de las 100.000 diarias gratuitas.
- **Los rivales llevan una versión ligera del Urus** (`assets/urus-rival.glb`,
  264 KB). El modelo bueno son 171 llamadas de dibujado: cinco rivales serían
  855 y no las aguanta ningún móvil. La ligera tira el interior entero (a un
  rival no se le ve por dentro), reduce los 46 materiales a cinco y funde todo
  lo que comparte material, así que cada rival cuesta **cinco llamadas**. La
  pintura se deja blanca en el modelo y el color lo pone cada jugador. Si el
  fichero no llega, se usa el coche low-poly del tráfico y el duelo sigue.
- **Las posiciones y el tráfico salen por temporizador, no por fotograma.**
  Si a alguien se le atasca el render un momento, los demás le siguen viendo
  moverse.
- Si el invitado pasa 8 segundos sin recibir tráfico, simula el suyo para no
  quedarse atravesando un mundo congelado — pero se avisa en pantalla
  (*reconectando…*) y **se vuelve a sincronizar en cuanto el anfitrión
  reaparece**. Antes era irreversible: un microcorte y cada uno seguía en una
  partida distinta sin enterarse.
- **La sala comprueba la versión del juego.** Compartir sala no basta: si dos
  clientes llevan código distinto (uno con la versión vieja en caché, por
  ejemplo) simulan mundos distintos. Quien no coincida no entra y se le
  recarga la página.

---

## Despliegue

Ya está publicado en Cloudflare (proyecto `urustraffic`, cuenta
`inautoit@outlook.es`) en <https://urustraffic.inautoit.workers.dev>.

El nombre antiguo llevaba guion. Sigue existiendo como Worker aparte
(`wrangler.redirect.toml`) que redirige todo al nuevo con un 301 — y redirige
en vez de servir el juego a propósito: las salas viven dentro de cada Worker,
así que dos personas entrando por enlaces distintos no se verían aunque
usaran el mismo código.

```bash
npm run deploy            # el juego
npm run deploy:redirect   # el enlace antiguo (rara vez hace falta)
```

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

El enlace gratuito es `<proyecto>.<cuenta>.workers.dev` y la parte de la
cuenta no se puede quitar. Para algo más corto hace falta un dominio: en el
panel de Cloudflare, dentro del proyecto `urustraffic` →
*Settings → Domains & Routes*, se engancha en un minuto.

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
  postfx.js     Desenfoque radial, rayos, aberración y viñeta (una pasada)
  account.js    Cuenta anónima, ranking y envío de marcas
  net.js        Cliente de la sala (WebSocket)
  remote.js     Los coches de los rivales y sus nombres
  sky.js        Mapa de entorno procedural (los reflejos de la chapa)
  input.js      Teclado, botones, deslizar e inclinación
  audio.js      Motor, choque y avisos sintetizados con WebAudio
  ui.js         DOM: menú, HUD, pausa y fin de partida
  config.js     Todos los números del juego en un solo sitio (PLAYER, FX,
                CONTACT, DRAFT…), para poder afinar el tacto sin bucear
assets/urus.glb El coche (3,1 MB) — ver assets/README.md
assets/urus-rival.glb  El mismo coche, ligero, para los rivales (264 KB)
vendor/         Three.js r160 + GLTFLoader + decoder de meshopt
worker/         API de cuentas y ranking (D1) + salas (Durable Object)
tools/          Optimización del modelo y generación del Urus ligero
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
- **El post-proceso es una sola pasada**, no una cadena: un render target y
  un shader que hace desenfoque, rayos, aberración y viñeta de golpe. Una
  cadena de pasadas en un móvil cuesta varios render targets.
- **Calidad adaptativa**: si el dispositivo no llega a 46 fps, `main.js` baja
  la resolución de render escalón a escalón y la vuelve a subir si sobra
  margen. Los efectos de velocidad son lo último que se sacrifica.
- **Sin ficheros de audio**: el motor, el choque y los avisos se sintetizan
  con WebAudio.

---

## Ideas para seguir

- Coches desbloqueables con cifras propias (la Supra está a medio camino).
- Revalidar la repetición en el servidor para blindar el ranking.
- Choques entre jugadores en el duelo (hoy os atravesáis: con 100 ms de
  latencia, un choque injusto arruina una partida).

- Garaje con varios coches y mejoras (motor, frenos, nitro).
- Misiones: llegar a X metros, N adelantamientos al límite, contrarreloj.
- Tabla de récords online (Cloudflare Workers + KV encaja perfecto).
- Lluvia y niebla como modificadores de dificultad, con asfalto mojado.
- Motor con capas reales (ralentí/medio/alto, turbo y petardeo).
- Curvas y tramos temáticos: túnel, puente, desierto.
- Policía que te persigue si pasas de 200 km/h.
