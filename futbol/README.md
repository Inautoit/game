# ⚽ Fútbol Vida — de la cantera a leyenda

Juego de fútbol para navegador (PC, mando y móvil) en modo carrera: empiezas
con 16 años en un filial y vas subiendo. En el campo **solo controlas a tu
jugador**; tus compañeros y rivales los maneja la IA.

Los nombres de equipos llevan una letra cambiada a propósito (Real Madrix,
FC Barcelana, Manchestar City, Bayern Múnech…).

## Ejecutar

```bash
python3 -m http.server 8000
```
Abre <http://localhost:8000/futbol/>.

## Controles (teclado)

| Tecla | Con balón | Sin balón |
|---|---|---|
| WASD / flechas | Mover / conducir | Mover |
| Shift | Sprint | Sprint |
| J / Espacio | Pase raso hacia donde apuntas | Pedir el balón · pedir presión a un compañero |
| K | Tiro (mantén = potencia; ↑/↓ elige palo) | Entrada · remate de primeras / cabeza |
| L | Pase al hueco | Pedir al hueco · entrada deslizante |
| I | Pase elevado / centro | — |
| E | Conducción larga | — |
| Esc / P | Pausa (continuar, simular el resto, sonido) | |

Mando: stick izq., A pase, B tiro, Y hueco, X elevado, RT sprint, RB conducción.
Móvil: joystick a la izquierda y botones a la derecha (en horizontal).

## Qué hay

**Partido**
- Física de balón con altura, botes, efecto, palos y larguero.
- IA de equipo en 4-3-3: bloque que se mueve con el balón, presión,
  marcajes, desmarques al espacio, línea del fuera de juego, centros y
  cabezazos, porteros con tiempo de reacción y estiradas.
- Reglas: banda, córner, saque de puerta, faltas, tarjetas, penaltis y
  fuera de juego.
- Nota en directo (0–10) según lo que haces: pases, tiros, goles,
  asistencias, entradas, pérdidas…

**Carrera**
- Crea a tu jugador (posición, dorsal, cantera).
- Liga a doble vuelta con clasificación y calendario; el resto de
  partidos se simulan.
- Titular o suplente según tu media frente a la del equipo (si sales del
  banquillo entras en la 2ª parte).
- Experiencia → puntos de entrenamiento para subir atributos; crecimiento
  y declive por edad.
- A final de temporada: ofertas de otros clubes (o ascenso al primer
  equipo) según tu media y tu rendimiento. Se guarda en el navegador.

**Ligas:** Liga Fedaración (filiales), Segunda Divisiún, Primera Divisiún,
Premiar League, Sarie A, Bundesliva y Ligua 1.

## Estructura

```
futbol/
  index.html, css/style.css
  js/main.js          pantallas y bucle
  js/career.js        lógica de carrera
  js/data.js          ligas, equipos, posiciones
  js/sound.js         sonido sintetizado (WebAudio)
  js/match/engine.js  motor del partido + IA
  js/match/render.js  dibujo (canvas 2D)
  js/match/input.js   teclado / mando / táctil
```
