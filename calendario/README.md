# Calendario del equipo 🤾‍♀️

Web del calendario de entrenamientos y partidos.

- **La ve cualquiera** con el enlace: no hace falta cuenta ni registro.
- **La edita una sola persona**, pulsando **Editar** y metiendo la contraseña.
- **Cuatro vistas**: Hoy, Mes, Partidos y Fotos.
- **Instalable** en el móvil como una app (PWA) y consultable sin cobertura.
- **Avisa al móvil** cuando el calendario cambia, agrupando los cambios.
- **Gratis**: se publica en Cloudflare Pages sin pagar nada.

Viene rellena con el calendario de pretemporada de la Segunda Infantil
Femenino 26/27 (del 31 de agosto al 11 de octubre de 2026).

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
- Para cambiar la contraseña: **Settings** → **Variables and Secrets** →
  `EDIT_PASSWORD`, y luego **Retry deployment**.

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
- Para cambiar la contraseña hay que editar `src/config.js` a mano. Las dos
  líneas se generan así:

  ```bash
  node -e "const c=require('crypto');const s=c.randomBytes(8).toString('hex');
  console.log(\`salt: '\${s}',\`);
  console.log(\`hash: '\${c.createHash('sha256').update(s+':'+process.argv[1]).digest('hex')}',\`)" MI-CONTRASEÑA
  ```

---

## Avisos en el móvil

Quien quiera puede encenderlos desde la tarjeta de la pestaña **Hoy**. Van
por Web Push: el navegador se suscribe a su propio servicio de
notificaciones y el servidor le escribe ahí, aunque la app esté cerrada.

**En iPhone hace falta instalar antes la web** en la pantalla de inicio
(iOS 16.4 o superior); abierta en Safari no llegan. En Android funciona de
las dos formas. La propia tarjeta lo advierte cuando toca.

**Los cambios se agrupan.** Al guardar no se avisa: se apunta que hay algo
pendiente y, pasados tres minutos, sale un único aviso con el total
(«Hay 4 cambios en el calendario del equipo»). Así editar diez cosas
seguidas no son diez notificaciones.

El envío lo dispara el navegador de quien edita al terminar, y como red de
seguridad cualquiera que abra la web después. Con la contraseña se puede
forzar el envío al momento:

```bash
curl -X PUT "https://calendario-bmleganes.pages.dev/api/push?forzar=1" \
  -H "Authorization: Bearer <token de /api/auth>"
```

### Configuración

Hacen falta dos secretos en Cloudflare, las claves VAPID:

| Secreto | Qué es |
|---|---|
| `VAPID_PUBLICA` | Clave pública; la web la pide a `/api/push` para suscribirse. |
| `VAPID_PRIVADA` | Clave privada; firma cada envío. No sale del servidor. |

Se generan con un par ECDSA P-256; la pública en base64url sin relleno y
la privada es el escalar `d` del JWK. Sin ellas, `/api/push` responde
`activo: false` y la web sencillamente no ofrece los avisos.

Las suscripciones se guardan en el mismo KV, con el prefijo `push:sub:`.
Una que devuelva 404 o 410 (app desinstalada, permiso retirado) se borra
sola en el siguiente envío.

El cifrado del cuerpo (RFC 8291) y la firma VAPID (RFC 8292) están
escritos a mano en `functions/api/_webpush.js`, sin dependencias. El
cifrado se comprobó contra el vector de prueba del apéndice A del RFC
8291: reproduce el resultado publicado byte a byte.

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

- **Hoy** — lo del día y, debajo, todo lo que viene por delante: la lista
  no tiene tope, va cargando más días conforme se baja y marca dónde
  empieza cada mes.
- **Mes** — la rejilla del mes. En el móvil cada actividad es un punto de
  color; toca un día para ver el detalle.
- **Partidos** — todos los partidos de la temporada, por meses, con
  cuántos van jugados y cuántos quedan. Los ya jugados salen atenuados.
  Tocando uno se abre su día.

  A un partido se le puede meter el **resultado** (goles a favor y en
  contra) y la **convocatoria** al editarlo. Sale en la tarjeta con su marcador y la franja en
  verde, ámbar o rojo según fuera victoria, empate o derrota. Un partido
  con resultado cuenta como jugado aunque su fecha no haya llegado.

  Si un partido no llegó a jugarse, se marca **Aplazado** al editarlo y
  deja de contar: ni jugado ni por jugar, aunque su fecha ya haya pasado.
  Aparece entonces un cuarto dato con cuántos hay aplazados, para que los
  números sigan cuadrando con la lista.
- **Fotos** — la galería del equipo.

En Partidos y en el pie hay un enlace a la **ficha del equipo en la
Federación Madrileña**, con su clasificación y sus resultados. Se cambia
(o se quita, dejando la url vacía) en `federacion` de `src/config.js`.

Pulsando cualquier día se abre su ficha con horario, actividad, pista y
notas.

### Fotos

**Sube quien quiera**, sin contraseña: basta con tener el enlace. La web
pide un nombre la primera vez, solo para que se sepa quién ha puesto cada
foto, y lo recuerda en ese dispositivo.

Antes de enviarla, la foto se reduce en el propio móvil (lado máximo 1600
px, JPEG) para que no gaste datos ni llene el almacén.

Tocando una foto se abre a pantalla completa, con **Descargar** y, en los
móviles que saben hacerlo, **Compartir**, que abre la hoja del sistema
(en iPhone es la forma de guardar en Fotos).

Ninguno de los dos saca al usuario de la aplicación: la foto se trae con
`fetch` y se guarda desde memoria. Un enlace normal dejaba la ventana de
la app instalada en la imagen, sin manera de volver al calendario más que
cerrando y abriendo. Como último recurso, si no se puede traer la imagen,
está `/api/fotos/<id>?descargar=1`, que la sirve con `Content-Disposition:
attachment` para que el navegador la guarde en vez de abrirla.

**Borrar puede quien la subió y el entrenador.** Al subir una foto, el
servidor devuelve una clave de borrado —un HMAC de su identificador, así
que no hay nada guardado ni se puede inventar— y la web la deja en el
navegador de quien sube. Con esa clave puede quitarla luego; el entrenador
puede quitar cualquiera con su token. Las fotos propias salen marcadas en
la galería con un borde de color y el pie «tuya».

Como la clave vive en ese navegador, si se borran los datos del navegador
o se cambia de móvil se pierde la posibilidad de borrar esa foto. El
entrenador siempre puede.

Límites: 6 MB por foto y 400 fotos en total. Se guardan en el mismo KV que
el calendario, con el prefijo `foto:`.

Un detalle de Cloudflare: su listado tarda hasta un minuto en incluir una
foto recién subida. Quien la sube la ve al momento (la web la añade por su
cuenta); el resto puede tardar ese minuto en verla aparecer.

### Editar

**Editar** → contraseña. El botón pasa a decir **Cerrar edición** y, dentro
de cada día, aparecen:

- **+ Añadir actividad** — nueva entrada (se pueden poner varias por día).
- **Editar** — cambiar horario, tipo, actividad, pista o notas. Cambiando
  la **fecha** la actividad se mueve a otro día.
- **Borrar** — quitar una actividad.
- **Vaciar el día** — quitarlas todas de golpe.

Los tipos (entreno, partido, descanso, aviso) solo cambian el color.

En la barra amarilla:

### Convocatoria

Al editar un partido hay un desplegable con una casilla por jugadora, más
los atajos **Todas** y **Ninguna**. El resumen del desplegable dice
cuántas van sin tener que abrirlo.

La convocatoria se ve sin contraseña: en la ficha del día, desplegando
**Convocatoria**, y en la pestaña Partidos como «5 convocadas». Es el
único sitio donde las jugadoras miran si les toca.

La plantilla está en `src/config.js`, en `plantilla`. Dar de alta o de
baja a alguien es tocar esa lista y volver a desplegar; **las
convocatorias ya guardadas no se tocan**. A quien se dé de baja le
seguirá apareciendo su casilla, en cursiva, en los partidos donde ya
estaba convocada.

### Copiar un día y pegarlo en otros

Muchas semanas repiten el mismo entreno, así que no hace falta rellenar
día a día:

1. Abre el día que quieras repetir (en **Hoy**, botón «Editar el día»; en
   **Mes**, tocando la casilla) y pulsa **Copiar día**.
2. Aparece una barra con lo copiado. Desde ahí:
   - **Pegar aquí**, al abrir otro día. Si ese día ya tiene algo, pregunta
     si sustituirlo o añadir lo copiado a lo que haya.
   - **Pegar en varios días**, que abre la rejilla del mes para ir tocando
     todos los días de golpe. Los que ya tienen algo llevan un punto.

Lo copiado aguanta hasta que pulses **Descartar**, incluso cerrando la
web: se guarda en el navegador.

**El resultado, la convocatoria y el aplazamiento no se copian.** Son de
ese partido concreto y arrastrarlos a otro día sería un error, así que lo
pegado sale siempre sin marcador, sin convocatoria y sin aplazar.

En modo edición también aparece el botón de **Borrar** al abrir una foto.
Se sale con **Cerrar edición**, y se bloquea solo a los 30 minutos.

No hay deshacer ni historial: cada cambio se guarda en el momento. Para
llevarte una copia de seguridad del calendario entero:

```bash
curl -s https://calendario-bmleganes.pages.dev/api/calendario > copia.json
```

---

## Cambiar el calendario "de fábrica"

`src/seed.js` es la copia original, la que restaura el botón **Restaurar
original**. Para cambiarla: **Descargar JSON** y pega su contenido así:

```js
window.CAL_SEED = { ...aquí el JSON descargado... };
```

## El escudo

`assets/escudo-original.webp` es el escudo del club tal y como lo mandó el
club: 1920×1050 con fondo transparente. De ahí salen, recortando solo el
margen vacío de alrededor (el dibujo no se toca):

- `assets/escudo.png` — el de la cabecera.
- `assets/icon-192.png`, `icon-512.png` — iconos de la app.
- `assets/icon-maskable-512.png`, `apple-touch-icon.png` — con fondo azul
  marino, porque Android e iOS recortan el icono y no admiten transparencia.

Para cambiarlo: pon el nuevo en `assets/escudo-original.webp` y vuelve a
generar los tamaños con un recorte automático del margen transparente.

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
    fotos.js              Galería: subir, listar, borrar
    avisos.js             Alta y baja de los avisos del móvil
    app.js                Vistas y edición
  build-artifact.js       Genera la versión de un solo archivo
  artifact-db.js          Adaptador de datos para esa versión
  functions/api/          Backend de Cloudflare (solo Opción A)
    _shared.js            Tokens firmados y utilidades
    auth.js               POST /api/auth  → token
    calendario.js         GET/PUT /api/calendario
    fotos.js              GET/POST /api/fotos
    fotos/[id].js         GET/DELETE /api/fotos/<id>
    push.js               Alta, baja y empuje de los avisos
    _webpush.js           Cifrado RFC 8291 y firma VAPID
    _avisos.js            Suscripciones y agrupación de los cambios
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
