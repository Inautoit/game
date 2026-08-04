# Open Drive 3D 🏎️

Juego de coches **3D de mundo abierto** para navegador (PC y móvil).
Conduce libremente por una ciudad con carreteras, edificios y árboles,
con cámara en tercera persona.

Hecho con [Three.js](https://threejs.org/). Sin instalación ni build: se
abre directamente en el navegador.

## Cómo jugar

### PC (teclado)
| Tecla | Acción |
|-------|--------|
| `W` / `↑` | Acelerar |
| `S` / `↓` | Frenar / marcha atrás |
| `A` / `←` | Girar a la izquierda |
| `D` / `→` | Girar a la derecha |
| `Espacio` | Freno de mano |

### Móvil (táctil)
Botones en pantalla: flechas de dirección (izquierda) y acelerar/frenar
(derecha). Aparecen automáticamente en dispositivos táctiles.

## Ejecutar en local

Necesitas servir los archivos por HTTP (los módulos ES no funcionan con
`file://`). Con Python:

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000> en el navegador.

## Estructura

```
index.html      Página y HUD
styles.css      Estilos e interfaz táctil
src/
  main.js       Escena, luces, cámara, bucle del juego
  car.js        Coche + físicas de conducción
  world.js      Mundo procedural (carreteras, edificios, árboles)
  input.js      Entrada de teclado y táctil
assets/         Modelos 3D (.glb) — ver assets/README.md
```

## Añadir tu coche 3D

Exporta tu modelo como `assets/car.glb` y el juego lo usará
automáticamente. Detalles en [`assets/README.md`](assets/README.md).

## Próximas mejoras posibles

- Coche importado con materiales reales
- Tráfico y peatones
- Minimapa
- Sonido de motor
- Objetos coleccionables / misiones
- Día/noche y farolas
