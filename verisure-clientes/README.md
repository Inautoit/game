# Buscador de clientes de baja — Verisure

Aplicación web interna para consultar la base de datos de clientes dados de baja.
Los **administradores** suben el fichero CSV; los **usuarios** lo consultan por
número de instalación, teléfono, DNI, nombre, dirección o cualquier otro campo
del fichero.

Funciona sobre **Cloudflare Workers + D1**, sin servidor propio ni proceso de
compilación.

---

## Qué hace

| | Administrador | Usuario |
|---|---|---|
| Buscar clientes | ✅ | ✅ |
| Exportar los resultados a CSV | ✅ | ✅ |
| Importar la base de datos (CSV) | ✅ | — |
| Eliminar cargas anteriores | ✅ | — |
| Crear, bloquear y borrar usuarios | ✅ | — |
| Cambiar su propia contraseña | ✅ | ✅ |

### Búsqueda

- **En todos los campos a la vez** o **en un campo concreto** (desplegable y
  atajos rápidos: nº de instalación, teléfono, DNI, nombre…).
- Ignora acentos, mayúsculas, espacios y signos: `600 123 456`, `600-123-456`
  y `600123456` encuentran el mismo cliente; `perez` encuentra a `Pérez`. Un
  número con prefijo (`+34`, `0034`) encuentra al que no lo lleva.
- Admite varias palabras en cualquier orden (`perez maria` → *María Pérez*).
- Los resultados salen como **una fila por cliente** con los datos que sirven
  para distinguirlo (nº de instalación, DNI, teléfono…) y su estado de
  reconexión. Al pulsar una fila se despliega el registro completo. Si sólo hay
  una coincidencia se abre sola.
- Resalta en rojo la parte coincidente de cada valor.

### Ficha del cliente

Al abrir un registro no se vuelca el CSV entero, sino lo que hace falta para
decidir qué hacer con ese cliente:

| Bloque | Contenido |
|---|---|
| **Dónde** | Código postal y dirección |
| **Deuda** | Balance, write off y NPV |
| **Equipo instalado** | Panel, y las cantidades de cámaras, fotodetectores, magnéticos, SDI, perimetrales, ZV, llaves, mandos, sirena, tag reader y botón SOS |

Las cantidades a cero se enseñan igualmente —que no llevara sirena es un dato—
pero apagadas, para que no compitan con lo que sí tenía instalado.

Al final hay un desplegable con las columnas restantes del CSV, por si alguna
vez hace falta algo que no está arriba.

La correspondencia con las columnas se define en `FICHA` y `EQUIPO`
(`public/comun.js`) y se busca sin distinguir mayúsculas, guiones ni espacios,
así que aguanta que el fichero traiga `total_BotonSOS` o `TOTAL_BOTON_SOS`. La
columna que no esté en el CSV simplemente no se pinta.

### Botón de reconexión

Cuando el estado es RECONECTABLE ✅ aparece un botón que lleva al formulario de
reconexión. El enlace se pone en `FORMULARIO_RECONEXION` (`public/comun.js`) y
admite huecos con el nombre de una columna entre llaves, que se rellenan con
los datos de ese cliente:

```js
export const FORMULARIO_RECONEXION =
  'https://ejemplo.com/reconectar?instalacion={s#ins}&dni={cifnif}';
```

Mientras esté vacío el botón sale desactivado, para que se vea que falta
configurarlo en vez de llevar a ninguna parte.

### Estado de reconexión


Cada registro se etiqueta con uno de tres estados, calculado en
`public/comun.js` (`calcularEstado`) y por tanto idéntico en los dos buscadores:

| Orden | Condición | Estado |
|---|---|---|
| 1 | `balance_txt ≤ 149` y `writeoff_txt ≤ 149` y `npv = "NO NPV"` | RECONECTABLE ✅ |
| 2 | `balance_txt ≤ 149` y `npv = "NPV"` | LLAMA A SALES ASSURANCE 📞 |
| 3 | cualquier otro caso | NO RECONECTABLE ❌ |

Es la traducción de las medidas de Power BI `Estado_Reconectable`,
`Estado_Llamar`, `Estado_NoReconectable` y el `SWITCH` que las ordena, ya
resueltas. La tercera regla recoge también lo que el `SWITCH` dejaba caer en su
valor por defecto: por ejemplo `balance ≤ 149` con `writeoff > 149`, o un `npv`
que no sea ni `"NPV"` ni `"NO NPV"`.

Detalles de la conversión:

- Una celda vacía cuenta como 0, igual que hace Power BI con un BLANK.
- Los importes se leen con las dos convenciones de Excel: `1.234,56` y
  `1,234.56`. Un valor ilegible no cumple ninguna comparación y acaba en
  NO RECONECTABLE, que es la salida por defecto de la fórmula original.
- `npv` se compara sin distinguir mayúsculas ni espacios.
- Si el CSV no trae las tres columnas (`balance_txt`, `writeoff_txt`, `npv`) no
  se muestra ningún estado, en vez de inventarse uno.

Al desplegar un registro se ven los tres valores que han decidido su estado,
para poder comprobarlo de un vistazo.

### Importación

El CSV debe llevar una **primera fila con los nombres de las columnas**. Las
columnas son libres: la aplicación se adapta al fichero que se suba y el
buscador ofrece automáticamente los campos que contenga.

- Separador: coma (también detecta `;`, tabulador y `|`).
- Admite comillas dobles, saltos de línea dentro de las celdas y BOM de Excel.
- Se procesa en el navegador y se envía por lotes de 200 filas con barra de
  progreso, así que aguanta ficheros grandes.
- Dos modos: **reemplazar todo** (borra lo anterior) o **añadir**.

Hay un fichero de muestra en [`ejemplo-clientes.csv`](ejemplo-clientes.csv).

---

## Dos formas de usarlo

### 1. Buscador local — `buscador-local.html`

Un único archivo HTML. Se abre haciendo doble clic, se elige el CSV y ya se
puede buscar. **No instala nada, no sube el fichero a ningún sitio y funciona
sin conexión**: todo ocurre dentro del navegador.

Es la opción para ficheros grandes: no tiene límites de ningún plan.

Medido con un CSV de 185 MB y 1.000.000 de registros de 35 columnas, en
Chromium:

| | |
|---|---|
| Preparar el fichero (una vez, al abrirlo) | **18 s** |
| Memoria usada por el navegador | 391 MB |
| Buscar nº de instalación, teléfono o DNI | **150-290 ms** |
| Buscar un término sin resultados | 69 ms |

Cómo aguanta un millón de filas sin base de datos: en vez de guardar un objeto
por cliente, mantiene **una sola cadena de texto** con todo el fichero
normalizado (sin acentos, en minúsculas y sin espacios ni signos), un salto de
línea por registro y un tabulador entre campos, más un `Int32Array` con la
posición en la que empieza cada registro. Buscar es un `indexOf` sobre esa
cadena: lo resuelve el motor del navegador en código nativo sobre memoria
contigua, que es la operación de texto más rápida que existe. La posición
encontrada se traduce a número de registro con una búsqueda binaria.

Comprobada la integridad: la primera fila, la última y varias del medio,
verificadas campo a campo (las 35 columnas) contra el CSV original.

Lo que no tiene: usuarios ni contraseñas. El control de acceso es quién tiene
el fichero.

### 2. Aplicación web publicada

<https://verisure-clientes.inautoit.workers.dev>

Con login y roles, para que la consulten varios agentes sin repartir el
fichero. Los administradores suben el CSV desde el navegador. Base vacía y
lista para la primera carga.

---

## Cuentas iniciales

| Usuario | Contraseña | Rol |
|---|---|---|
| `admin` | `Verisure2026!Admin` | Administrador |
| `agente` | `Verisure2026!Agente` | Usuario (sólo consulta) |

> **Cámbialas nada más entrar**, desde *Mi cuenta*. Los hashes de estas dos
> contraseñas están en el repositorio, así que sólo sirven para el primer acceso.

---

## Cómo se guarda el CSV (y por qué)

La base de datos es D1. En el plan gratuito sus dos límites duros son **100.000
escrituras de fila al día** y **500 MB por base**, así que convertir un fichero
de un millón de clientes en un millón de filas es imposible por partida doble.

Por eso el CSV se guarda **troceado en bloques de 100 registros**, repartidos en
dos tablas:

```
bloques        el texto normalizado, que es lo único que se recorre al buscar.
               Una línea por registro, campos separados por tabulador:
               "1234567\tmariaperez\t600123456"

bloques_datos  los valores originales en JSON comprimido con gzip (comprime ~5
               veces). Sólo se piden los de los bloques que salen en pantalla.
```

Tenerlos separados importa: al buscar, SQLite recorre únicamente la tabla del
texto y no arrastra los datos originales, que ocupan otro tanto.

Buscar tiene dos pasadas:

1. Un `LIKE` sobre `norm` descarta de golpe los bloques que no contienen el
   texto. Eso ocurre dentro de SQLite y no consume CPU del Worker.
2. Los bloques que quedan se abren aquí y se mira registro a registro cuál
   coincide de verdad, comparando sólo el trozo de línea del campo elegido.

Como el texto normalizado sólo tiene letras y números, los tabuladores y saltos
de línea impiden que una coincidencia cruce de un campo a otro o de un registro
al siguiente.

### Medido con un millón de registros de 35 columnas

CSV de partida: 185 MB.

| | Una fila por cliente | En bloques comprimidos |
|---|---|---|
| Escrituras por carga completa | 1.000.000 ❌ imposible | **20.000** (el 20 % del día) |
| Cargas completas al día | 0 | **5** |
| Tamaño de la base | ~4 GB ❌ imposible | **219 MB** de los 500 MB |
| Tiempo de la carga | — | ~1 minuto |
| Buscar nº instalación, teléfono o DNI | — | 350-550 ms |
| Buscar un término genérico | — | ~300 ms |
| CPU del Worker en el peor caso | — | ~4 ms de los 10 ms del plan |

Comprobado además que los datos vuelven íntegros: 25 registros al azar
verificados campo a campo contra el CSV original, más la primera y la última
fila del fichero.

El tope está en 800 bloques por búsqueda, es decir **80.000 registros
recorridos**. Ese tope se aplica a los bloques *que ya coinciden*: buscar un
número de instalación abre uno o dos aunque el fichero tenga millones de
líneas. Sólo un término muy genérico llega al tope, y entonces la interfaz
avisa de que el recuento es un mínimo ("más de N") en vez de dar una cifra
engañosa.

### Límites del plan

| | Gratuito | Workers Paid (desde 5 $/mes) |
|---|---|---|
| Escrituras de fila | 100.000 al día (límite duro) | Sin límite diario · 50 millones al mes |
| Lecturas de fila | 5.000.000 al día | 25.000 millones al mes |
| Tamaño de la base | 500 MB | 10 GB |
| CPU por petición | 10 ms | 30 s |

**Con este diseño el plan gratuito sirve para un millón de clientes.** Sólo
haría falta pasar al de pago por encima de ~2 millones de registros, que es
donde los 500 MB empiezan a quedarse cortos.

El modo *Reemplazar todo* vacía las tablas con `DROP TABLE` en vez de borrar
bloque a bloque, porque borrar también consume escrituras. A cambio, mientras
dura la importación el buscador se queda sin datos.

---

## Despliegue en Cloudflare

Necesitas una cuenta de Cloudflare (el plan gratuito es suficiente) y Node.js.

### Opción rápida

```bash
cd verisure-clientes
npm install
npx wrangler login          # abre el navegador para autorizar la cuenta
bash scripts/desplegar.sh
```

El script crea la base de datos D1, escribe su identificador en `wrangler.toml`,
aplica las migraciones, genera el secreto de sesiones y publica el Worker.

### Paso a paso

```bash
# 1. Crear la base de datos y copiar el database_id en wrangler.toml
npx wrangler d1 create verisure-clientes

# 2. Crear las tablas y las dos cuentas iniciales
npx wrangler d1 migrations apply verisure-clientes --remote

# 3. Secreto con el que se firman las sesiones (cualquier cadena larga y aleatoria)
npx wrangler secret put AUTH_SECRET

# 4. Publicar
npx wrangler deploy
```

Al terminar, Cloudflare devuelve la URL pública
(`https://verisure-clientes.<tu-subdominio>.workers.dev`). Para usar un dominio
propio, añade una ruta en *Workers & Pages → tu Worker → Settings → Domains*.

### Si prefieres un token en vez de `wrangler login`

Crea el token en *My Profile → API Tokens* con permisos **Workers Scripts:Edit**,
**D1:Edit** y **Account Settings:Read**, y expórtalo:

```bash
export CLOUDFLARE_API_TOKEN=...
export CLOUDFLARE_ACCOUNT_ID=...
```

---

## Desarrollo en local

```bash
npm install
npx wrangler d1 migrations apply verisure-clientes --local
npx wrangler dev
```

Se abre en <http://127.0.0.1:8787> con una base de datos SQLite local en
`.wrangler/`.

---

## Estructura

```
public/
  comun.js               LÓGICA DE BÚSQUEDA COMPARTIDA por los dos programas
  index.html             interfaz de la versión web (login + aplicación)
  styles.css             estilos
  app.js                 interfaz: importación del CSV y pintado
src/
  index.js               Worker: sesión, búsqueda, importación, usuarios
  auth.js                PBKDF2 para contraseñas y cookie firmada (HMAC)
local/
  plantilla.html         fuente del buscador local (sin la parte compartida)
buscador-local.html      GENERADO · no editar a mano
migrations/
  0001_esquema.sql       tablas
  0002_cuentas_iniciales.sql   cuentas admin y agente
scripts/
  construir-local.mjs    genera buscador-local.html
  comparar-buscadores.mjs  comprueba que los dos devuelven lo mismo
  desplegar.sh           despliegue completo desde cero
  crear-hash.mjs         genera el hash de una contraseña
wrangler.toml            configuración del Worker, los assets y D1
```

## Tocar los dos programas a la vez

Hay dos buscadores —el local y el web— y **comparten `public/comun.js`**: ahí
está qué significa buscar (cómo se normaliza el texto, cómo se interpreta un
teléfono con prefijo, cuándo vale con que estén todas las palabras). Un cambio
ahí llega a los dos.

Lo que no se puede compartir es cómo recorre cada uno los datos: el web lo hace
con SQLite sobre bloques comprimidos y el local con un `indexOf` sobre una
cadena en memoria. Por eso hay un comparador que los enfrenta a las mismas
consultas.

```bash
# 1. Cambiar la lógica de búsqueda
$EDITOR public/comun.js          # lo comparten los dos
$EDITOR src/index.js             # cómo busca el web dentro de los bloques
$EDITOR local/plantilla.html     # cómo busca el local dentro de la cadena

# 2. Regenerar el archivo local (copia comun.js dentro)
npm run construir

# 3. Comprobar que los dos siguen devolviendo lo mismo
npx wrangler dev --port 8793     # en otra terminal
node scripts/comparar-buscadores.mjs ejemplo-clientes.csv

# 4. Publicar la versión web
npx wrangler deploy
```

El comparador carga el mismo CSV en los dos, lanza la misma tanda de consultas
(identificadores, teléfonos en todos sus formatos, acentos, palabras en otro
orden, búsqueda por campo…) y falla si alguna cifra no cuadra. Ya ha servido:
destapó que el buscador local se paraba a los 20.000 resultados mientras el web
daba el recuento completo.

Cuando los dos avisan de que un recuento está incompleto, el comparador sólo
exige que coincidan en si hay resultados o no: cada uno deja de contar por un
motivo distinto (el web por bloques recorridos, el local por número de
coincidencias).

---

## Seguridad

- Contraseñas con **PBKDF2-SHA256** (100 000 iteraciones y sal por usuario);
  nunca se guardan en claro.
- Sesión en **cookie `HttpOnly`, `Secure` y `SameSite=Strict`**, firmada con
  HMAC-SHA256 y con caducidad de 8 horas.
- **Bloqueo temporal** tras 8 intentos fallidos en 15 minutos (por usuario e IP).
- Comprobación del rol en el servidor en cada petición: un usuario sin permisos
  no puede importar ni gestionar cuentas aunque manipule la interfaz.
- Consultas SQL siempre parametrizadas.
- Cabecera `noindex` para que la herramienta no aparezca en buscadores.

Consideraciones antes de cargar datos reales de clientes: el fichero contiene
datos personales, así que conviene limitar el acceso al Worker a la red de la
empresa (Cloudflare Zero Trust o una regla de firewall por IP), revisar el
periodo de conservación y dar de alta sólo a las personas que lo necesiten.
