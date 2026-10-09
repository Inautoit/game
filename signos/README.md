# Signa: traductor de signos

Web que usa la cámara para **detectar tus manos** y **escribir en pantalla lo
que signas**, con la opción de leerlo en voz alta. Funciona en el navegador,
sin instalar nada. El vídeo se procesa en tu equipo y no se envía a ningún sitio.

## Cómo se usa

1. Pulsa **Activar cámara** y acepta el permiso.
2. En **Traducir**, elige **Letras** o **Números** y deletrea. La mayoría del
   abecedario, los números del 0 al 10 y BIEN / MAL se reconocen **sin entrenar**.
   Mantén el signo hasta que se llene el círculo y se escribe en el texto.
   - CH, LL, Ñ, RR y J: haz la forma base (C, L, N, R, I) y muévela.
   - Para repetir la misma letra (por ejemplo, la doble C de *acción*), baja la mano un momento.
   - Si retiras la mano más de 1 segundo, se añade un espacio.
3. En **Entrenar**, elige un tema (saludos, familia, verbos…) y un signo, y pulsa
   **Grabar 3 s** (o la tecla `Espacio`). Haz 1–2 tandas moviendo un poco la mano.
   Tus ejemplos tienen prioridad sobre el reconocimiento automático. En
   **Comandos de Signa** puedes crear gestos para ESPACIO y BORRAR, y en
   **Mis palabras** añadir signos propios.
4. En **Diccionario** tienes los 200+ signos de la guía con su descripción,
   la gramática básica y frases útiles.
5. **Leer en voz alta** dice el texto con la voz del navegador. El texto sale en
   glosa LSE (por ejemplo YO MANZANA COMER), que es el orden de la lengua de signos.

Los ejemplos se guardan en el navegador. Con **Exportar ejemplos** te llevas un
archivo `.json` para usarlos en otro equipo o compartirlos.

## Cómo funciona

- **MediaPipe Hand Landmarker** (Google) localiza 21 puntos por mano en cada
  fotograma, con hasta dos manos.
- `src/rules.js` traduce las descripciones de la guía (dedos estirados o
  doblados, qué yemas se tocan, hacia dónde apunta la mano) a reglas, para
  reconocer letras y números sin entrenar. `src/lse-data.js` guarda la guía.
- Los puntos se normalizan respecto a la muñeca y al tamaño de la mano, así que
  da igual en qué parte de la imagen esté la mano o a qué distancia.
- Un clasificador **k-vecinos** compara la postura con tus ejemplos y vota.
  La predicción se suaviza durante varios fotogramas y solo se acepta si se
  mantiene el tiempo configurado.

## Limitaciones

- El reconocimiento automático sale de descripciones escritas y solo se ha
  probado con fotos. Q, S, T, X y Z no son automáticas (dependen del trazo):
  entrénalas tú.
- Las palabras se reconocen por la forma de la mano, no por su recorrido ni por
  el sitio del cuerpo donde se hacen. Dos signos con la misma forma de mano se
  pueden confundir. Reconocer el movimiento completo es el siguiente paso.
- No interpreta la expresión facial ni la gramática de la lengua de signos.
- Funciona mejor con buena luz y la mano sobre un fondo liso.

## Abrirla

Publicada en Cloudflare: <https://signa.inautoit.workers.dev>

La cámara solo funciona con `https://` o desde `localhost`. Para volver a
publicarla: `npx wrangler deploy --name=signa --assets=signos` desde la raíz del repo.

## Créditos

`vendor/mediapipe/` contiene `@mediapipe/tasks-vision` 0.10.21 y el modelo
`hand_landmarker.task`, de Google, con licencia Apache-2.0. Se incluyen en el
repositorio para que la web funcione sin depender de CDNs (útil en redes de empresa).
