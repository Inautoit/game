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
