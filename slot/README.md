# Turbo Slot 🏎️

**Simulador de coches de slot 1:32 con física real.**

Turbo Slot reproduce cómo se comporta un coche de slot de verdad: un motor eléctrico
controlado por un gatillo analógico, la guía delantera en la ranura, la trasera que
derrapa, el imán que lo pega a la pista y la salida de pista cuando te pasas.
Pensado para competir: tiempos al milésimo, reglajes, clases con y sin imán y un
fantasma de tu mejor vuelta.

## 🌐 Jugar

- **<https://turbo-slot.inautoit.workers.dev>** — añádelo a la pantalla de inicio
  (Safari → Compartir → Añadir a pantalla de inicio).
- Copia dentro de Claude (privada): <https://claude.ai/artifact/9ifPvyKsCrCxJhhbAgZrqf>

## Modos

- **Práctica / contrarreloj**: vueltas libres, lista de tiempos, diferencia con tu
  récord y **fantasma** de tu mejor vuelta (por circuito y clase).
- **Carrera contra la CPU**: la CPU usa la misma física que tú; antes de cada carrera
  mide el límite de cada curva simulando su coche.
- **2 jugadores** en el mismo dispositivo, un gatillo a cada lado.

## Física (`src/physics.js`)

Paso fijo de 1/480 s, determinista (la misma entrada da la misma vuelta).

- **Coche 1:32**: 88 g, guía delantera, centro de gravedad a 50 mm, eje trasero a 82 mm.
- **Motor de corriente continua**: par = ke·(V − ke·ω)/R; el gatillo regula el voltaje
  (con curva configurable) y al soltarlo el mando cortocircuita el motor (freno ajustable).
- **Restricción de la guía**: la guía sigue el carril; el coche gira a su alrededor
  (ángulo de derrape θ). Se resuelven a la vez la aceleración, la guiñada y la fuerza
  lateral en la guía.
- **Neumáticos traseros** con ángulo de deriva y círculo de fricción μ·N (tracción y
  agarre lateral compiten); el **imán** aumenta N.
- **Salida de pista** cuando la fuerza en la guía supera lo que sujeta el coche o la
  trasera se cruza demasiado.
- Rozamiento de rodadura, aerodinámico, de la guía y pendiente (puente).

Valores medidos con el banco de pruebas (punta ~6,5 m/s ≈ 750 km/h a escala):

| Imán | 0–3 m/s | Límite en curva R2 |
|---|---|---|
| Sin imán | 0,49 s | ~1,7–1,9 m/s |
| Medio | 0,19 s | ~3,0 m/s |
| Alto | 0,13 s | ~3,6–4,0 m/s |

## Reglaje (taller)

Imán (sin / bajo / medio / alto), desarrollo (9:30, 9:27, 10:27), neumáticos
(duro / blando), freno del mando (0–100 %) y curva del gatillo (lineal → muy progresiva).
Los récords se guardan por clase: **con imán** y **sin imán**.

## Controles

| Dispositivo | Control |
|---|---|
| Móvil / iPad | Gatillo deslizante en pantalla (modo zurdo en Ajustes) |
| Mando de consola | Gatillo derecho analógico (RT / R2) |
| PC | `↑` o `espacio` (J1), `W` (J2), `C` cámara, `Esc` pausa |

Cámaras: TV (vista de mesa), persecución y a bordo. La calidad gráfica se ajusta sola
si el dispositivo no mantiene la fluidez.

## Gráficos

- **Iluminación HDRI real** (Poly Haven): un taller para los circuitos de día y un
  estudio de neón para los de noche. Ilumina la escena, se refleja en la pintura y se
  ve, desenfocada, como fondo.
- **Materiales reales** (ambientCG): tapete de hierba, tierra o tela con relieve y
  marco de madera.
- **Efecto de miniatura** (*tilt-shift*): enfoca tu coche y desenfoca delante y detrás,
  como una foto macro de una maqueta. Más brillo en luces y chispas.
- Raíles de cobre metálicos, sombras de contacto bajo los coches y pintura con barniz.

Todos los recursos son CC0: ver `assets/CREDITOS.md`.

## Crear circuitos

Los circuitos están en `src/tracks.js` como listas de piezas:

```js
['S', 6]            // recta de 6
['C', 90, 2.4]      // curva de 90° a la izquierda, radio 2,4
['C', -180, 1.5]    // horquilla a la derecha
['S', null]         // recta "libre": se calcula sola para que el circuito cierre
['C', 270, 2.6, 0.95] // curva que termina a 0,95 de altura (puentes)
```

## Publicar

```bash
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./deploy.sh
```

## Próximas fases

1. **App nativa** (iOS / Android) empaquetando la web.

«Scalextric» es una marca registrada de su propietario; Turbo Slot no está
relacionado con ella.

## Telemetría y circuitos largos

- **Agarre usado** (0–100 % y más): la mayor de dos medidas. La primera es la velocidad frente a la velocidad
  límite del carril, calculada por simulación con tu reglaje e incluyendo la frenada para lo que viene. La segunda
  es la deriva de la trasera y su tendencia a 0,12 s. Por encima del 103 % la salida es casi segura; el aviso
  llega una mediana de 0,25–0,35 s antes de salirse.
- Panel en `src/telemetry.js`: velocidad (m/s y km/h a escala), deriva en grados, sectores con colores
  (morado = mejor, verde = mejora, ámbar = peor), punta de la vuelta, trampa de velocidad en meta, pico de agarre
  y gráfica de velocidad de la vuelta actual contra la mejor. Se puede ocultar en Ajustes.
- En la pista: marcas de goma de las ruedas traseras al deslizar y un halo bajo el coche que pasa de verde a rojo.
- Circuitos largos: Montaña (16,6 m, con puente), Autódromo (21,5 m), Internacional (20,7 m) y
  Resistencia (36,3 m). En ellos la cámara de TV sigue al coche.

## Editor, comunidad y online (v3)

- **Todos los circuitos abiertos** desde el principio, en todos los modos.
- **Editor** (`src/editor.js`): se ponen rectas de 35 / 70 cm y curvas de 45° / 90° (cerrada, media o abierta).
  `autoClose` (en `src/tracks.js`) añade la curva que falta y mete dos rectas para llegar a la salida, y
  `validateTrack` comprueba que el circuito no se cruce, mida de 3 a 60 m y tenga piezas válidas. El servidor usa
  esa misma función antes de guardar.
- **Comunidad**: API en el Worker (`server/worker_template.js`) con D1 (`server/schema.sql`):
  `GET /api/tracks?sort=top|new`, `POST /api/tracks`, `POST /api/tracks/<id>/play|like|lap`.
  Hay un límite de 15 circuitos al día por IP; la IP se guarda solo como hash. Se filtran los nombres ofensivos.
- **Online** (`src/online.js` + Durable Object `Room`): `POST /api/room/new` da un código de 4 letras y
  `/api/room/<código>` es el WebSocket de la sala. Cada móvil simula su coche (la física es determinista) y manda su
  estado 20 veces por segundo; los demás coches se pintan interpolados con 120 ms de retraso. El reloj se sincroniza
  con el servidor para que la salida sea a la vez, y la sala recoge los tiempos de llegada.
  El enlace `?sala=ABCD` abre la sala directamente.
- Publicar: `SKIP_KV=1 bash deploy.sh` publica sin volver a subir los modelos y las texturas.

## Clasificación mundial comprobada y fantasma del récord

- **Física idéntica en todas partes** (`src/dmath.js`): seno, coseno, arcotangente, exp, log, pow y tanh hechos solo
  con suma, resta, multiplicación, división y raíz cuadrada (exactas en IEEE 754). `Math.sin` y compañía pueden variar
  en el último decimal entre navegadores; con esto la misma secuencia de gatillo da el mismo tiempo en un iPhone,
  un Android y el servidor, al último bit.
- **Grabación** (`src/main.js`): en Práctica, desde una parada (salida o tras salirte) se guarda el gatillo de cada
  paso de física (redondeado a milésimas y comprimido en tramos `[valor, pasos]`).
- **Comprobación** (`src/verify.js`, en el Durable Object `__VERIFICADOR__`): el servidor repite la vuelta con el
  mismo circuito, carril y reglaje. Si el coche se sale, no completa la vuelta o el tiempo no sale exacto, se rechaza.
  Máximo 5 minutos de simulación por envío.
- **API**: `GET /api/laps?track=o:<id>|c:<id>&cls=iman|pro&device=…` (top 50 y tu puesto),
  `GET /api/laps/ghost` (las pulsaciones del récord) y `POST /api/laps`. Se guarda la mejor vuelta de cada
  dispositivo por circuito y clase (tabla `laps`).
- **Fantasma dorado**: el juego descarga las pulsaciones del récord y las repite con su propia física para dibujar
  el coche del récordman junto al tuyo, vuelta a vuelta.
- Entran los circuitos oficiales y los publicados en la comunidad. Las dos clases (con imán / sin imán) van aparte.

## Menú con retransmisión en directo (v3.1)

- De fondo del menú corre una carrera de exhibición de 4 coches en un circuito largo (cambia cada vez), y un
  «realizador» va cortando entre planos como en la tele: cámara fija junto a la pista (comprueba que ninguna valla
  o grada la tape), travelling lateral, persecución, frontal, grúa y aéreo. Es el propio juego en tiempo real, así
  que no hay vídeo que descargar.
- Menú en columna a la izquierda en iPad y ordenador, y abajo en el móvil, con el logotipo encima.
- Todos los circuitos son de 4 carriles (La Horquilla se ha ensanchado para que quepan). El editor ya no deja elegir 2.
- Los pilares de los puentes no se ponen donde pasa otro tramo de pista por debajo.

## Menú: carrera de exhibición más real y música

- Los coches de la exhibición llevan imanes distintos (bajo, sin, medio, bajo) y su piloto comete errores: a menudo
  aprieta de más y derrapa, y de vez en cuando entra pasado y se sale (medido: una salida cada ~15 s entre los 4).
  Hay marcas de frenada, chispas y ruedas girando como en carrera. El realizador pincha a menudo el coche que va más
  cruzado y, si el coche del plano se sale, aguanta el plano para que se vea.
- Plano «tele»: teleobjetivo a ras de pista, lejos y por delante, siguiendo la pista para ver cómo traza las curvas.
- Música (`src/music.js`): electrónica de carreras sintetizada en directo con Web Audio, 116 BPM, 32 compases con
  entrada, cuerpo y subida. Suena desde la pantalla de inicio y en todo el juego menos mientras se corre (cuenta
  atrás y carrera). El navegador no deja sonar nada hasta el primer toque, así que arranca con él (hay un aviso).
  Se quita en Ajustes → Música.
- La exhibición va a cámara lenta (×0,5), los planos duran 7–10 s y se enlazan con fundidos a negro; siempre empieza
  con el plano aéreo del circuito.

## Cuentas y progreso sincronizado

- **Entrar / Crear cuenta** (botón arriba en el menú): usuario y contraseña. En el servidor la contraseña se guarda
  con PBKDF2-SHA256 (100 000 iteraciones y sal propia), nunca en claro; las sesiones se guardan solo como hash.
- Al crear la cuenta se da un **código de recuperación** (también guardado con PBKDF2): con él y el usuario se
  pone una contraseña nueva. Límite de 10 cuentas nuevas y 30 intentos fallidos al día por IP (tabla `limits`).
- **Sincronización** (`src/sync.js`): récords de todos los modos, posiciones, copas, monedas, circuitos propios,
  «me gusta», fantasmas, coche, pintura y reglaje. Al juntar dos dispositivos se queda lo mejor de cada cosa (el
  tiempo más bajo, la mejor posición, todos los circuitos…). Las estadísticas se guardan por dispositivo y se suman.
  Se sube sola 3 s después de cada cambio y se trae al abrir el juego o volver a la pestaña; si dos dispositivos
  guardan a la vez, el servidor responde 409 y se vuelve a juntar (control de versión optimista).
- **Ranking mundial**: con sesión, las vueltas se guardan a nombre de la cuenta (su identificador de ranking), así
  que tu mejor tiempo es el mismo en todos tus dispositivos.
- API: `POST /api/auth/register|login|recover|logout`, `GET|PUT /api/profile` (cabecera `Authorization: Bearer`).

## Público alrededor de la mesa

- Entre 6 y 22 personas (según la calidad gráfica) de pie alrededor de la mesa, a escala real (1,65–1,85 m, con
  la mesa a 80 cm del suelo), con ropa, pelo y piel al azar. Respiran (animación «Idle») y giran el cuerpo para
  seguir al coche que va delante. Quien se pone entre la cámara y la pista se oculta para no tapar la carrera.
- Suelo de la sala y patas de la mesa. Modelos: Quaternius (CC0), ver `assets/CREDITOS.md`.
