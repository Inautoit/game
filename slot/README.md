# Turbo Slot 🏎️

**Acelera, frena… ¡que no se salga!**

Juego de carreras de coches de slot en 3D para móvil, iPad y PC. Como en una pista
real, solo controlas el **gatillo**: tu pulgar en el mando deslizante. Si entras
demasiado rápido en una curva, el coche derrapa… y se sale de la pista.

## 🌐 Jugar

**<https://turbo-slot.inautoit.workers.dev>** — añádelo a la pantalla de inicio
(Safari → Compartir → Añadir a pantalla de inicio).

## Contenido

- **6 circuitos** construidos por piezas (rectas y curvas, como una pista real):
  Óvalo, Riñón, **El Ocho** (con puente), La Horquilla, Chicane (4 carriles) y
  Gran Premio (4 carriles).
- **Carrera contra la CPU**: rivales que conocen el límite de cada curva y que, a
  veces, también se salen. Ganar desbloquea el siguiente circuito.
- **2 jugadores en el mismo dispositivo**: un mando a cada lado de la pantalla
  (ideal en iPad).
- **4 coches** con velocidad, aceleración y agarre distintos.
- Semáforo de salida, vueltas, posiciones, vuelta rápida y récords.
- Derrapes, chirrido de ruedas al límite, salidas de pista con vuelta al carril.
- Vista de mesa o **vista de coche** (botón 📷).
- Sonido de motores sintetizado, vibración, modo zurdo, funciona sin conexión.

## Controles

| Dispositivo | Jugador 1 | Jugador 2 |
|---|---|---|
| Móvil / iPad | Mando deslizante (derecha, o izquierda en modo zurdo) | Mando de la derecha |
| PC | `↑` o `espacio` | `W` |

`C` cambia la cámara · `Esc` pausa.

## Física (resumen)

- El gatillo fija la velocidad objetivo; al soltar, el motor frena.
- En cada curva, la fuerza lateral es `v² × curvatura del carril`. Si supera el
  agarre del coche durante un instante, el coche se sale.
- El carril interior es más corto pero más cerrado.
- La CPU calcula un perfil de velocidad por carril (límite de cada curva + frenada).

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

«Scalextric» es una marca registrada de su propietario; Turbo Slot no está
relacionado con ella.
