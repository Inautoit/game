# Catálogo

`checklist.csv` es la **fuente de verdad** del catálogo. Todo lo demás (la base de
datos, el JSON que consume la app) se deriva de él.

## Estado de estos datos

El CSV que viene en el repo es un **esqueleto generado**: tiene la estructura
completa (series, equipos, numeración, rarezas, tiradas) pero la columna
`player_name` está vacía y la lista de equipos es la de una temporada de
referencia. Antes de publicar nada:

1. Verifica la lista de equipos de la temporada en `teams.csv` y en la columna
   `team` del checklist.
2. Rellena `player_name` carta a carta.
3. Ajusta `print_run`, `scarcity` y `requestable` por serie según la colección real.

Los datos del checklist (número, nombre del jugador, equipo) son **hechos**.
Consúltalos donde quieras, pero introdúcelos tú: no copies listados ni imágenes.

## Ficheros

| Fichero | Qué es |
|---|---|
| `collection.json` | Metadatos de la colección (slug, nombre, temporada) |
| `teams.csv` | Equipos, con el color que alimenta el diseño del hueco vacío |
| `checklist.csv` | Una fila por carta |

## Columnas de `checklist.csv`

```
series_code,series_name,series_kind,number,player_name,team,position,variant,print_run,scarcity,requestable
```

- `series_kind`: `base` | `insert` | `parallel` | `autograph` | `limited`
- `number`: texto. Admite `12bis`, `LE1`, `MVP7`…
- `scarcity`: 1 común … 5 ultra rara. Ordena el álbum y pondera el valor.
- `requestable`: si esa serie se puede pedir al servicio de últimas cartas.

## Comandos

```bash
npm run catalog            # CSV -> public/catalog/<slug>.json (lo que usa la app)
npm run import:checklist   # CSV -> Supabase (upsert idempotente)
npx tsx scripts/generate-checklist.ts --force   # regenera el esqueleto (destructivo)
```
