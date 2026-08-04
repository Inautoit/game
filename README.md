# RealPunch 3D 🥊

Juego de **boxeo con detección de movimiento por webcam**, para navegador.
Colócate frente a la cámara y tu muñeco (en cian) replica tus golpes,
esquivas y bloqueos para pelear contra el rival (en rojo).

**Sin instalar nada, sin CDN y sin modelos de IA que descargar:** la
detección de movimiento se hace en el propio navegador por *diferencia de
fotogramas* (frame differencing) sobre el vídeo de la cámara. El vídeo
**no sale de tu dispositivo**.

Todo el juego está en un único archivo: [`index.html`](index.html)
(escena en pseudo-3D con Canvas 2D, audio sintetizado con WebAudio,
detección de movimiento y bucle de juego).

## Cómo jugar

1. Abre el juego (ver más abajo). Necesita **HTTPS o `localhost`** para que
   el navegador conceda permiso de cámara.
2. Pulsa **«Activar cámara y jugar»** y acepta el permiso.
3. Ponte a 1–2 m, con el torso visible y buena luz.

| Movimiento | Gesto ante la cámara | Teclado |
|------------|----------------------|---------|
| Jab izquierdo | Lanza el brazo **izquierdo** hacia delante | `J` |
| Jab derecho | Lanza el brazo **derecho** hacia delante | `L` |
| Esquivar | Inclina el cuerpo a un lado | `A` / `D` |
| Bloquear | Sube las dos manos y quédate quieto | `K` / `Espacio` |

Ajusta la **sensibilidad de golpe** en la pantalla de inicio según tu luz
y distancia. También puedes jugar **solo con teclado** si no tienes cámara.

## Ejecutar en local

El acceso a la cámara requiere un contexto seguro, así que sírvelo por HTTP
en `localhost` (abrir el `file://` directamente no da permiso de cámara en
la mayoría de navegadores):

```bash
python3 -m http.server 8000
```

Luego abre <http://localhost:8000> en Chrome o Edge.

## Cómo funciona la detección

- El fotograma de la webcam se reduce a una rejilla de 64×48 en escala de grises.
- Se compara con el fotograma anterior: los píxeles que cambian por encima
  de un umbral son **movimiento**.
- Se mide la energía de movimiento por zonas (izquierda / derecha / arriba)
  y el **centroide horizontal** del movimiento.
  - Pico fuerte a la izquierda o derecha → **jab** de ese lado.
  - Desplazamiento del centroide → **esquiva**.
  - Movimiento alto en la zona superior sin dirección clara → **bloqueo**.

Es un enfoque ligero y robusto que corre en cualquier navegador. Para una
fidelidad tipo «el muñeco copia tu esqueleto completo» habría que pasar a
seguimiento de pose (p. ej. MediaPipe/TensorFlow.js), que requiere descargar
un modelo — ver la sección siguiente.

## Siguientes pasos posibles

- **Pose tracking real** con MediaPipe Pose / TF.js MoveNet para mapear
  hombros, codos y muñecas al muñeco (jabs, crochets, uppercuts, guardia real).
- Boxeador en **3D real** con Three.js y animaciones esqueléticas.
- Modo VR/pass-through (WebXR) o export a app móvil/consola.
- Más rivales, dificultad, rounds, entrenamiento y modo fitness.
```
