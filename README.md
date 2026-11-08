# Rayo Runner ⚡

Runner infinito con estilo neón retro, pensado para **iPhone, iPad y Android**
(también funciona en PC). Corre por una autopista al atardecer, esquiva
obstáculos, recoge monedas y bate tu récord.

Es un juego web (HTML5 + Canvas, sin librerías ni compilación) e **instalable
como app (PWA)**: funciona a pantalla completa y sin conexión.

## Cómo jugar

| Gesto (móvil / iPad) | Teclado | Acción |
|----------------------|---------|--------|
| Deslizar ← / → | `←` `→` / `A` `D` | Cambiar de carril |
| Deslizar ↑ o tocar | `↑` / `W` / `Espacio` | Saltar |
| Deslizar ↓ | `↓` / `S` | Agacharse (en el aire: caída rápida) |
| Botón ❚❚ | `Esc` / `P` | Pausa |

### Obstáculos
- **Muro morado (✕)**: solo se puede esquivar cambiando de carril.
- **Valla naranja (baja)**: sáltala o cambia de carril.
- **Barra roja (alta)**: agáchate por debajo o cambia de carril.

### Objetos
- **Monedas**: +10 puntos cada una; se acumulan en tu hucha total.
- **Escudo (S)**: aguanta un choque durante 10 segundos.

La velocidad aumenta poco a poco. Los puntos son la distancia recorrida más las monedas.

## Probarlo en local

```bash
python3 -m http.server 8000
```

Abre <http://localhost:8000>. Para probarlo en el móvil, conéctalo a la misma
wifi y abre `http://IP-DE-TU-ORDENADOR:8000`.

## Instalarlo en iPhone / iPad

1. Publica la carpeta en cualquier hosting con HTTPS (GitHub Pages, Netlify, Vercel…).
2. Ábrelo en **Safari** → botón **Compartir** → **Añadir a pantalla de inicio**.
3. Se abrirá a pantalla completa como una app, también sin conexión.

En Android (Chrome): menú ⋮ → **Instalar aplicación**.

## Estructura

```
index.html            Página, HUD y menús
styles.css            Estilos (adaptados a notch / zonas seguras)
src/game.js           Todo el juego: lógica, dibujo, sonido y controles
manifest.webmanifest  Datos de la app instalable
sw.js                 Service worker (modo sin conexión)
icons/                Iconos de la app
```

## Ideas para seguir

- Tienda para gastar monedas en personajes o colores
- Más power-ups (imán de monedas, multiplicador)
- Misiones diarias y logros
- Música de fondo
- Publicarlo en App Store / Google Play con Capacitor
