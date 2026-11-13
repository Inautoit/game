# Sistema de captación de clientes (agencia de webs y automatizaciones)

> Nota: esta carpeta también contiene un juego web (`index.html`, `src/`, `assets/`, `vendor/`).
> No tiene nada que ver con la captación; no lo toques salvo que se pida.

Buscamos **locales pequeños e independientes** en España (peluquerías, bares, restaurantes, talleres,
clínicas, tiendas de barrio, gimnasios pequeños...), detectamos qué les falta en internet, les
preparamos una **web demo** con su nombre y redactamos un **mensaje** que el usuario aprueba y envía
él mismo. **Nada se envía automáticamente.**

## Piezas

| Pieza | Qué es |
|---|---|
| `locales.db` | Base de datos SQLite. Una fila por local + tabla `historial` de cambios de estado. |
| `captacion/db.py` | Esquema y reglas (orden de estados, duplicados). |
| `captacion/buscar_locales.py` | Busca en OpenStreetMap (Overpass; si falla, Nominatim + API OSM) y guarda sin duplicados. Descarta cadenas. |
| `captacion/revisar_web.py` | Revisa una web: HTTPS, móvil, año, reservas, WhatsApp, formulario. |
| `captacion/crear_demo.py` | Genera `demos/<id>-<nombre>/index.html` desde `plantillas/`. |
| `captacion/panel.py` | Panel para el usuario y los agentes (pendientes, aprobar, corregir, contactado...). |
| `captacion/config.json` | Datos de la agencia, ofertas y tono. **El usuario debe rellenarlo.** |
| `plantillas/` | `base.html` (diseño) + `sectores.json` (textos, colores y servicios por sector). |
| `.claude/agents/` | Subagentes: `buscador`, `creador`, `redactor`, `analista`. |

## Estados (en este orden, no se pueden saltar)

`encontrado` → `demo lista` → `mensaje redactado` → `aprobado` → `contactado` → `respondió`
(+ `descartado` para cadenas, cerrados o locales que no interesan).

Quién mueve cada estado:
- `encontrado`: buscador (vía script). `descartado`: buscador o usuario.
- `demo lista`: creador (vía `crear_demo.py`).
- `mensaje redactado`: redactor (vía `panel.py guardar-mensaje`).
- `aprobado`, `contactado`, `respondió`: **solo el usuario** (o Claude si el usuario lo pide expresamente
  en la conversación, p. ej. "aprueba el 12" o "he contactado con el 12 y el 15").

## Cómo coordinar a los subagentes

Ejemplo de orden: *"Busca 20 peluquerías en Valencia, crea demo para las 5 con más potencial, redacta sus
mensajes y dame el resumen"*.

1. **buscador** (un solo agente): "Busca 20 locales del sector `peluqueria` en `Valencia` y cualifícalos".
   Espera su tabla.
2. **Elegir candidatos** (tú, sin agente):
   `python3 captacion/panel.py candidatos --ciudad Valencia --sector peluqueria --n 5`
   (ordenados por potencial). Descarta a ojo los que tengan una web buena con reservas o sin forma de contacto
   y coge el siguiente.
3. **creador**: pásale los IDs elegidos. Si son más de 3, lanza varios creadores en paralelo
   (2-3 IDs cada uno) en un mismo mensaje.
4. **redactor**: pásale los IDs que ya están en `demo lista` (uno para todos: así varía el estilo entre mensajes).
5. **analista**: pídele el resumen.
6. **Responde al usuario** en lenguaje sencillo: qué se encontró, los 5 elegidos y por qué, ruta de cada
   demo, los mensajes completos, el resumen del analista y **qué tiene que hacer él**:
   revisar y aprobar (`python3 captacion/panel.py pendientes`), publicar las demos y sustituir `[ENLACE DEMO]`.

Si la orden es parcial ("solo busca...", "redacta para los que tengan demo"), ejecuta solo esos pasos.
Para "dame el resumen" basta con el **analista**.

## Lo que hace el usuario (panel)

```bash
python3 captacion/panel.py                 # menú interactivo
python3 captacion/panel.py pendientes      # ver mensajes por aprobar (--archivo crea mensajes_pendientes.md)
python3 captacion/panel.py aprobar 12 15
python3 captacion/panel.py corregir 12     # pegar texto nuevo; --aprobar para aprobar a la vez
python3 captacion/panel.py contactado 12
python3 captacion/panel.py respondio 12 --nota "quiere precio"
python3 captacion/panel.py descartar 12 --nota "no le interesa"
python3 captacion/panel.py ver 12
python3 captacion/panel.py resumen
```
También puede pedírtelo en lenguaje natural ("enséñame los pendientes", "aprueba el 3 pero cambia el
saludo por 'Buenas'", "marca el 7 como que ha respondido"): hazlo con estos mismos comandos.

## Reglas
- **Nunca enviar** mensajes, emails ni formularios a los locales.
- **No inventar** locales ni datos (precios, años, reseñas). Todo local sale de OpenStreetMap.
- Respetar las APIs gratuitas: no lanzar más de una búsqueda a la vez (Nominatim: 1 petición/segundo).
- Solo locales pequeños: sin etiqueta `brand`, sin nombres repetidos en la ciudad, sin cadenas conocidas.
- `locales.db` se guarda en git para no perder datos (el entorno en la nube es temporal): haz commit al terminar.
