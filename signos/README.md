# Signa: traductor de signos

Web que usa la cámara para **detectar tus manos** y **escribir en pantalla lo
que signas**, con la opción de leerlo en voz alta. Funciona en el navegador,
sin instalar nada. El vídeo se procesa en tu equipo y no se envía a ningún sitio.

## Cómo se usa

1. Pulsa **Activar cámara** y acepta el permiso.
2. En **Entrenar**, elige una letra, pon la mano en el recuadro y pulsa
   **Grabar 3 s** (o la tecla `Espacio`). Haz 1–2 tandas por letra, moviendo
   un poco la mano y cambiando la distancia a la cámara.
3. En **Traducir**, haz el signo y mantenlo quieto hasta que el círculo se
   llene: la letra se escribe en el cuadro de texto.
   - Para repetir la misma letra (por ejemplo, la doble C de *acción*), baja la mano un momento.
   - Si retiras la mano más de 1 segundo, se añade un espacio.
   - Puedes entrenar gestos para **ESPACIO** y **BORRAR**, y añadir **palabras**
     con un signo propio (HOLA, GRACIAS…).
4. **Leer en voz alta** dice el texto con la voz del navegador.

Los ejemplos se guardan en el navegador. Con **Exportar ejemplos** te llevas un
archivo `.json` para usarlos en otro equipo o compartirlos.

## Cómo funciona

- **MediaPipe Hand Landmarker** (Google) localiza 21 puntos por mano en cada
  fotograma, con hasta dos manos.
- Los puntos se normalizan respecto a la muñeca y al tamaño de la mano, así que
  da igual en qué parte de la imagen esté la mano o a qué distancia.
- Un clasificador **k-vecinos** compara la postura con tus ejemplos y vota.
  La predicción se suaviza durante varios fotogramas y solo se acepta si se
  mantiene el tiempo configurado.

## Limitaciones

- Reconoce **posturas quietas**: el abecedario dactilológico y signos estáticos.
  En las letras que llevan movimiento en LSE (por ejemplo J, Ñ, LL, RR, Z),
  graba la posición final. Los signos con movimiento son el siguiente paso.
- No interpreta la expresión facial ni la gramática de la lengua de signos.
- Funciona mejor con buena luz y la mano sobre un fondo liso.

## Abrirla

La cámara solo funciona con `https://` o desde `localhost`. La forma más
sencilla es publicarla con **GitHub Pages** y abrir
`https://<usuario>.github.io/<repo>/signos/`.

## Créditos

`vendor/mediapipe/` contiene `@mediapipe/tasks-vision` 0.10.21 y el modelo
`hand_landmarker.task`, de Google, con licencia Apache-2.0. Se incluyen en el
repositorio para que la web funcione sin depender de CDNs (útil en redes de empresa).
