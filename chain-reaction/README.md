# Reacción en cadena ⚛️

Juego de **reacción en cadena** para dos jugadores online, sobre
Cloudflare Workers + Durable Objects con WebSockets hibernables.

El servidor es la única autoridad: valida las jugadas, resuelve las cascadas
y difunde el estado completo. El cliente sólo pinta lo que recibe.

## Reglas

- Tablero de **6 columnas × 9 filas**.
- La **masa crítica** de una casilla es su número de vecinos ortogonales:
  esquinas 2, bordes 3, interiores 4.
- En tu turno añades una ficha a una casilla **vacía o tuya**, nunca del rival.
- Al alcanzar su masa crítica la casilla **explota**: se vacía y reparte una
  ficha a cada vecino ortogonal, que pasan a ser de tu color.
- Las explosiones se encadenan **por oleadas**: en cada oleada explotan a la
  vez todas las casillas inestables (tope de 200 oleadas por jugada).
- Ganas cuando el rival se queda sin fichas, comprobación que sólo se aplica
  a partir del momento en que **los dos** han hecho al menos una jugada.

## Ejecutar en local

```bash
npm install
npm run dev          # wrangler dev -> http://localhost:8787
```

Abre dos pestañas: en la primera pulsa **Crear partida** (el código de cuatro
letras queda en el hash de la URL) y pega ese enlace en la segunda, o usa
**Unirse** con el código.

## Desplegar

```bash
npx wrangler login
npm run deploy
```

Los Durable Objects usan `new_sqlite_classes` en la migración, necesario para
el plan gratuito de Workers.

## Estructura

```
public/index.html   Juego completo en un solo archivo, sin dependencias
src/index.js        Worker (rutas) + Durable Object `Sala` (partida y WebSockets)
wrangler.jsonc      Binding SALA, assets estáticos y migración sqlite
```

## Protocolo

```jsonc
// cliente -> servidor
{ "tipo": "jugar", "fila": 0, "col": 0 }
{ "tipo": "revancha" }

// servidor -> cliente
{ "tipo": "estado",
  "celdas": [{ "n": 1, "jugador": "rojo" }, ...],   // 54 casillas, fila * 6 + col
  "turno": "azul", "tuColor": "rojo", "ganador": null, "jugadores": 2,
  "explosiones": [                                   // oleadas de la última jugada
    { "explotan": [{ "fila": 0, "col": 0 }], "celdas": [ ... ] }
  ]
}
{ "tipo": "error", "mensaje": "No es tu turno" }
```

Cada oleada incluye el tablero resultante para que el cliente pueda animarlas
una detrás de otra (≈150 ms cada una) sin calcular nada.
