# Assets

## `urus.glb` — el coche del jugador

Lamborghini Urus Mansory optimizado para móvil:

| | Original | En el juego |
|---|---|---|
| Tamaño | 26,5 MB | **3,1 MB** |
| Triángulos | 433 527 | **186 761** |
| Texturas | PNG sueltas | WebP ≤ 1024 px |
| Geometría | float32 sin comprimir | cuantizada + `EXT_meshopt_compression` |

Qué se hizo (todo reproducible con `npm run optimize-model`):

1. Quitar `TEXCOORD_1/2/3`: los 46 materiales sólo usan el primer juego de UV
   (eran ~10 MB de coordenadas que no pintaban nada).
2. Unificar mallas repetidas — las cuatro ruedas eran cuatro copias idénticas.
3. Simplificar malla a malla. El interior (`intoer`, 154 k triángulos él solo)
   se queda en el 10 %: en cámara de tercera persona casi no se ve.
4. Texturas a WebP con lado máximo de 1024 px.
5. Cuantizar y comprimir con meshopt. El navegador lo descomprime con
   `vendor/addons/libs/meshopt_decoder.module.js`.

### Regenerarlo desde el original

```bash
npm install
node tools/optimize-model.mjs "Lamborghini Urus Mansory (.glb)/UrusM.glb" assets/urus.glb
```

## Cómo se coloca el modelo en el juego

El modelo viene mirando hacia **-X**; `src/player.js` lo gira 90° para que el
morro apunte a **+Z**, lo escala a 5 m de largo (longitud real del Urus) y lo
apoya en el suelo. Las ruedas se localizan por nombre de nodo
(`wheelFL`, `wheelFR`, `wheelRL`, `wheelRR`) y se les monta un pivote de
dirección y otro de rodadura; el volante (`steeringwheel`) también gira.

Para cambiar de coche basta con exportar otro `.glb` con esos nombres de nodo.
Si el nuevo modelo mira a otro eje, se ajusta `MODEL_YAW` en `src/player.js`.

## `urus-rival.glb` — el mismo coche, para los rivales

En un duelo puede haber cinco rivales en pantalla. El modelo bueno son 171
primitivas, o sea 171 llamadas de dibujado: cinco copias serían 855 y no las
aguanta ningún móvil.

`tools/make-rival.mjs` saca de él una versión con la misma silueta y una
fracción del coste:

| | Modelo bueno | Para rivales |
|---|---|---|
| Llamadas de dibujado | 171 | **5** |
| Triángulos | 186 761 | 29 524 |
| Materiales | 46 | 5 |
| Tamaño | 3,1 MB | **264 KB** |

Cómo: se tira el interior entero (a un rival no se le ve por dentro, y eran
65 689 triángulos), los 46 materiales se reducen a cinco —pintura, cristales,
faros, pilotos y el resto—, se funde todo lo que comparte material y sólo
entonces se simplifica, que da mucho mejor resultado que hacerlo pieza a
pieza. Se quitan todas las texturas: es un modelo de colores planos.

La pintura se deja **blanca** a propósito: el color lo pone cada jugador
multiplicando por ese material, que se clona por rival.

```bash
node tools/make-rival.mjs assets/urus.glb assets/urus-rival.glb
```

## Iconos

`icon.svg` es el original; `icon-192.png` e `icon-512.png` se generan con
sharp para la PWA (`manifest.webmanifest`).
