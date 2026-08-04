# Assets 3D

Aquí van los modelos 3D que exportes (por ejemplo desde Claude).

## Formato recomendado

- **`.glb`** (preferido) o **`.gltf`** — es el estándar para web e incluye
  geometría, materiales, texturas y animaciones en un solo archivo.
- También acepto `.obj` / `.fbx` + texturas sueltas; los convierto yo.

## El coche

Coloca tu modelo de coche aquí como:

```
assets/car.glb
```

El juego lo detecta y lo usa automáticamente (si no existe, se ve un coche
de bloques de placeholder).

### Convenciones para que las ruedas giren solas (opcional)

Si el modelo tiene las ruedas como nodos separados, nómbralos incluyendo la
palabra `wheel` (o `rueda`). Para las delanteras añade `front` (o `delant`):

```
wheel_front_left
wheel_front_right
wheel_rear_left
wheel_rear_right
```

## Orientación y escala

- El coche debe "mirar" hacia **+Z** (el morro hacia adelante).
- Escala aproximada: un coche real mide ~4 m de largo, ~1.8 m de ancho.
- Origen (pivote) centrado en la base del coche.

Si algo no encaja al importarlo, no te preocupes: ajusto rotación y escala
en el código.

## Otros modelos que podemos añadir

- Edificios, farolas, semáforos, señales
- Árboles, vallas, bordillos
- Rampas, conos, obstáculos
- Otros vehículos (tráfico)
