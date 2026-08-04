# RealPunch 3D 🥊

Juego de **boxeo con seguimiento de pose por webcam**, para navegador.
Ponte frente a la cámara y tu muñeco (en cian) replica tu **tren superior
completo — hombros, codos y muñecas —** para pelear contra el rival (rojo).
Golpeas extendiendo el brazo, bloqueas subiendo las manos y esquivas
inclinando el torso: movimientos reales.

La pose se calcula **en tu propio navegador** con
[MediaPipe Pose Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker).
El vídeo **no sale de tu dispositivo**. Todo el juego está en un único
archivo: [`index.html`](index.html).

## ⚠️ Cómo probarlo (necesita cámara)

El navegador **solo da permiso de cámara en un contexto seguro**: `https://`
o `http://localhost`. Abrir el archivo con `file://` **no** funciona, y los
visores tipo *sandbox* (p. ej. la vista previa de artifacts) **bloquean la
cámara**. Usa una de estas dos opciones:

### Opción A — En local (rápido)
```bash
python3 -m http.server 8000
```
Abre <http://localhost:8000> en Chrome o Edge y pulsa
**«Activar cámara y jugar»**.

### Opción B — Publicar gratis con GitHub Pages (sin instalar nada)
1. En GitHub: **Settings → Pages**.
2. En *Build and deployment* elige **Deploy from a branch**.
3. Branch: `claude/3d-boxing-motion-detection-5jdks5` · carpeta `/ (root)` · **Save**.
4. En 1–2 min tendrás una URL `https://<usuario>.github.io/game/` con
   cámara habilitada, que puedes abrir desde cualquier dispositivo.

> La primera vez descarga el modelo de pose (~6 MB) desde el CDN de
> MediaPipe; necesita conexión a internet esa primera carga.

## Controles

| Movimiento | Gesto ante la cámara | Teclado |
|------------|----------------------|---------|
| Golpe izquierdo | Extiende el brazo **izquierdo** hacia delante | `J` |
| Golpe derecho | Extiende el brazo **derecho** hacia delante | `L` |
| Esquivar | Inclina el torso a un lado | `A` / `D` |
| Bloquear | Sube las dos manos junto a la cara | `K` / `Espacio` |

También hay **modo teclado** por si no tienes cámara. Colócate a 1,5–2,5 m
con buena luz para que se vean torso y brazos.

## Cómo funciona

- MediaPipe detecta 33 puntos del cuerpo por fotograma; usamos los del tren
  superior (nariz, orejas, hombros, codos, muñecas y caderas).
- El muñeco del jugador se **dibuja directamente a partir de esos puntos**
  (torso, cuello + cabeza, brazos articulados y guantes en las muñecas), así
  que copia tu postura real.
- La lógica de combate deriva de la pose:
  - **Golpe:** la muñeca se aleja rápido del hombro (brazo extendido) → puñetazo de ese lado.
  - **Bloqueo:** las dos muñecas suben junto a la cara.
  - **Esquiva:** el eje hombros se desplaza respecto al de caderas.
- El rival es una IA que telegrafía sus golpes (verás el aviso) para que
  puedas bloquear o esquivar a tiempo.

## Siguientes pasos posibles

- **Golpes ricos**: distinguir jab / crochet / uppercut por la trayectoria
  de la muñeca y el ángulo del codo.
- **Boxeador 3D real** con Three.js y *rigging* esquelético mapeado a la pose.
- **Profundidad**: usar la coordenada `z` de MediaPipe para golpes hacia
  cámara y mejor detección de distancia.
- Rondas, dificultad, varios rivales, modo entrenamiento/fitness y ranking online.
- Empaquetado como app móvil (Capacitor) o experiencia WebXR/VR.
```
