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

1. **Clasificación mundial** con verificación en el servidor: al ser la física
   determinista, el servidor puede volver a simular la vuelta con tus entradas y
   comprobar el tiempo antes de aceptarlo. Descarga de fantasmas de los mejores.
2. **Carreras online** en directo.
3. **App nativa** (iOS / Android) empaquetando la web.

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
