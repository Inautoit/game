# Calendario del equipo 🤾‍♀️

Web del calendario de entrenamientos y partidos.

- **La ve cualquiera** con el enlace: no hace falta cuenta ni registro.
- **La edita una sola persona**, pulsando **Editar** y metiendo la contraseña.
- **Tres vistas**: Hoy, Semana y Mes, entrando en cada día para ver el detalle.
- **Instalable** en el móvil como una app (PWA) y consultable sin cobertura.
- **Gratis**: se publica en Cloudflare Pages sin pagar nada.

Viene rellena con el calendario de pretemporada de la Segunda Infantil
Femenino (del 31 de agosto al 11 de octubre de 2026).

---

## La contraseña

```
balonmano2026
```

Cámbiala antes de dar el enlace a nadie (más abajo se explica cómo, según
dónde la publiques).

---

## Dónde está publicada

<https://calendario-bmleganes.pages.dev>

Proyecto de Cloudflare Pages `calendario-bmleganes`, con el KV
`CALENDARIO` enlazado y la contraseña en el secreto `EDIT_PASSWORD`.
Para volver a desplegar tras cambiar algo:

```bash
cd calendario
npx wrangler pages deploy --project-name calendario-bmleganes --branch main
```

## Publicar gratis en Cloudflare Pages

Hay dos formas. La **completa** es la recomendada: la contraseña se
comprueba en el servidor y los cambios los ve todo el equipo al momento.

### Opción A — completa (recomendada)

Todo dentro del plan gratuito de Cloudflare.

**1. Crear el proyecto**

En [dash.cloudflare.com](https://dash.cloudflare.com) → **Workers & Pages**
→ **Create** → **Pages** → **Connect to Git** → elige este repositorio.

En la configuración de compilación:

| Campo | Valor |
|---|---|
| Framework preset | `None` |
| Build command | *(vacío)* |
| Build output directory | `/` |
| Root directory | `calendario` |

> Es importante poner `calendario` como *Root directory*: así Cloudflare
> sirve esta carpeta como raíz de la web y encuentra `functions/`.

**2. Crear el almacén del calendario (KV)**

**Storage & Databases** → **KV** → **Create a namespace** → nómbralo
`calendario`.

Vuelve a tu proyecto de Pages → **Settings** → **Bindings** → **Add** →
**KV namespace**:

| Campo | Valor |
|---|---|
| Variable name | `CALENDARIO` |
| KV namespace | el que acabas de crear |

**3. Poner la contraseña**

**Settings** → **Variables and Secrets** → **Add** → tipo **Secret**:

| Campo | Valor |
|---|---|
| Variable name | `EDIT_PASSWORD` |
| Value | la contraseña que quieras |

**4. Volver a desplegar**

**Deployments** → **Retry deployment** (los *bindings* nuevos solo entran
en el despliegue siguiente).

Listo. La web queda en `https://tu-proyecto.pages.dev`.

**Cómo funciona con esta opción**

- La contraseña vive solo en Cloudflare: no está en el código de la web.
- Al entrar en modo edición, el servidor devuelve un token firmado que
  caduca a las 12 horas.
- Cada cambio se guarda solo en el servidor. Los demás lo ven al abrir o
  al volver a la pestaña.
- Para cambiar la contraseña: edita el secreto `EDIT_PASSWORD` y vuelve a
  desplegar.

### Opción B — solo web estática

Si no quieres tocar KV ni secretos, sube la carpeta y ya está: Cloudflare
Pages → **Upload assets** (arrastra el contenido de `calendario/`), o el
mismo proceso de la Opción A saltándote los pasos 2 y 3.

La web funciona igual **para consultar**. La diferencia está en editar:

- La contraseña se comprueba en el navegador, contra la huella SHA-256 de
  `src/config.js`. Evita que alguien toque el calendario sin querer, pero
  **no es seguridad de verdad**: quien sepa mirar el código puede
  saltárselo.
- Los cambios se guardan solo en el dispositivo de quien edita. Para que
  los vea el equipo hay que **Descargar JSON**, guardarlo como
  `calendario/src/seed.js` (ver más abajo) y volver a publicar.
- Para cambiar la contraseña: modo edición → **Cambiar contraseña**. La web
  te da dos líneas para pegar en `src/config.js`.

---

## Instalarla en el móvil

Con la web abierta en el navegador:

- **Android / Chrome**: menú ⋮ → *Añadir a pantalla de inicio* (o el aviso
  de *Instalar* que sale solo).
- **iPhone / Safari**: botón compartir → *Añadir a pantalla de inicio*.

Se abre a pantalla completa, con su icono, y el calendario se puede
consultar sin cobertura (los cambios necesitan conexión).

---

## Usarla

### Consultar

- **Hoy** — lo del día y las siguientes citas.
- **Semana** — los siete días, con las flechas `‹` `›` para moverte.
- **Mes** — la rejilla del mes. En el móvil cada actividad es un punto de
  color; toca un día para ver el detalle.

Pulsando cualquier día se abre su ficha con horario, actividad, pista y
notas.

### Editar

**Editar** → contraseña. Aparece la barra amarilla y, dentro de cada día:

- **+ Añadir actividad** — nueva entrada (se pueden poner varias por día).
- **Editar** — cambiar horario, tipo, actividad, pista o notas. Cambiando
  la **fecha** la actividad se mueve a otro día.
- **Borrar** — quitar una actividad.
- **Vaciar el día** — quitarlas todas de golpe.

Los tipos (entreno, partido, descanso, aviso) solo cambian el color.

En la barra amarilla:

| Botón | Qué hace |
|---|---|
| Descargar JSON | Guarda una copia del calendario entero. |
| Importar JSON | Sustituye el calendario por el de un archivo. |
| Publicar cambios | Reintenta el guardado en el servidor (solo con backend). |
| Cambiar contraseña | Genera una contraseña nueva (solo sin backend). |
| Restaurar original | Vuelve al calendario del PDF. |
| Salir de edición | Bloquea. También se bloquea solo a los 30 min. |

---

## Cambiar el calendario "de fábrica"

`src/seed.js` es la copia original, la que restaura el botón **Restaurar
original**. Para cambiarla: **Descargar JSON** y pega su contenido así:

```js
window.CAL_SEED = { ...aquí el JSON descargado... };
```

## Poner el escudo de verdad

Sustituye `assets/escudo.svg` por el escudo del club (vale un `.png`, pero
entonces cambia también las rutas de `index.html` y del manifest). Los
iconos de la app son `assets/icon-192.png`, `assets/icon-512.png`,
`assets/icon-maskable-512.png` y `assets/apple-touch-icon.png`.

---

## Versión de un solo archivo (Artifact)

`build-artifact.js` junta el CSS y los módulos en un único HTML y cambia
el cliente de Cloudflare por `artifact-db.js`, que guarda el calendario en
la base de datos compartida del visor de Artifacts:

```bash
node calendario/build-artifact.js salida.html
```

Ahí quién puede escribir lo deciden las reglas de la base de datos según
el nivel con el que se comparta el enlace (ver = solo lectura, editar =
puede guardar), y la contraseña es la segunda barrera, la de la interfaz.
Esa versión no es instalable como app: para eso está el despliegue en
Cloudflare.

## Estructura

```
calendario/
  index.html              Página y estructura
  styles.css              Estilos (móvil primero)
  manifest.webmanifest    Datos de la app instalable
  sw.js                   Service worker: instalable y sin conexión
  _headers                Cabeceras para Cloudflare Pages
  src/
    config.js             Contraseña (sin backend), backend, ajustes
    seed.js               Calendario original del PDF
    sha256.js             SHA-256 en JS puro
    api.js                Cliente del backend
    store.js              Datos: leer, editar, guardar, sincronizar
    auth.js               Modo edición
    app.js                Vistas Hoy / Semana / Mes y edición
  build-artifact.js       Genera la versión de un solo archivo
  artifact-db.js          Adaptador de datos para esa versión
  functions/api/          Backend de Cloudflare (solo Opción A)
    _shared.js            Tokens firmados y utilidades
    auth.js               POST /api/auth  → token
    calendario.js         GET/PUT /api/calendario
  assets/                 Escudo e iconos
```

## Probarlo en local

Solo la web (Opción B):

```bash
cd calendario
python3 -m http.server 8000
```

Con backend (Opción A), hace falta Node:

```bash
cd calendario
npx wrangler pages dev . --kv CALENDARIO --binding EDIT_PASSWORD=loquesea
```

## Aviso honesto sobre la contraseña

- **Con backend (Opción A)**: la comprobación es en el servidor. Nadie
  puede escribir en el calendario sin la contraseña.
- **Sin backend (Opción B)**: la comprobación es en el navegador. Sirve
  para que nadie edite por error, no para parar a quien quiera saltárselo.

En los dos casos, **cualquiera puede leer el calendario**: es público a
propósito.
