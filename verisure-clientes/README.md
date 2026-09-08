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
  y `600123456` encuentran el mismo cliente; `perez` encuentra a `Pérez`.
- Admite varias palabras en cualquier orden (`perez maria` → *María Pérez*).
- Resalta en rojo la parte coincidente de cada valor.
- Resultados paginados de 50 en 50.

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

## Aplicación publicada

<https://verisure-clientes.inautoit.workers.dev>

Base vacía y lista para la primera carga.

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

La base de datos es D1, y en el plan gratuito su límite real no es el espacio
sino las **escrituras de fila: 100.000 al día** para toda la cuenta. Convertir
un fichero de 54.000 clientes en 54.000 filas agota la cuota de un día entero
con una sola carga.

Por eso el CSV se guarda **troceado en bloques de 100 registros**, no una fila
por cliente. Cada bloque lleva los mismos registros en dos formatos paralelos:

```
datos  JSON [["1234567","María Pérez","600 123 456"], [...], ...]
norm   una línea por registro, campos separados por tabulador y normalizados:
       "1234567\tmariaperez\t600123456"
```

Buscar tiene dos pasadas:

1. Un `LIKE` sobre `norm` dentro de SQLite descarta de golpe los bloques que no
   contienen el texto. Eso no consume CPU del Worker.
2. Los bloques que quedan se abren aquí y se mira registro a registro cuál
   coincide de verdad. Los datos originales sólo se piden para los bloques que
   acaban saliendo en pantalla.

Como el texto normalizado sólo tiene letras y números, los tabuladores y saltos
de línea impiden que una coincidencia cruce de un campo a otro o de un registro
al siguiente.

### Lo que cuesta en la práctica

Medido con 54.000 registros de 35 columnas:

| | Una fila por cliente | En bloques de 100 |
|---|---|---|
| Escrituras por carga | 54.000 | **540** |
| Cargas posibles al día (plan gratuito) | 1 | **~185** |
| Tamaño de la base | 27 MB | 20 MB |
| Buscar un nº de instalación o teléfono | ~40 ms | ~45 ms |
| Buscar un término genérico ("madrid") | ~40 ms | ~230 ms |
| CPU del Worker en el peor caso | — | ~4 ms (el límite gratuito son 10) |

El tope está en 800 bloques por búsqueda, es decir **80.000 registros
recorridos**. Si el fichero es mayor, el buscador sigue funcionando pero avisa
de que el recuento es un mínimo ("más de N").

### Límites del plan

| | Gratuito | Workers Paid (desde 5 $/mes) |
|---|---|---|
| Escrituras de fila | 100.000 al día (límite duro) | Sin límite diario · 50 millones al mes incluidas |
| Lecturas de fila | 5.000.000 al día | 25.000 millones al mes incluidas |
| Almacenamiento | 5 GB en total | 5 GB incluidos, después 0,75 $/GB al mes |
| CPU por petición | 10 ms | 30 s |

Con el diseño en bloques, **el plan gratuito sobra** para un fichero de decenas
de miles de clientes recargado a diario.

El modo *Reemplazar todo* vacía la tabla con `DROP TABLE` en vez de borrar
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
wrangler.toml              Configuración del Worker, los assets y D1
src/
  index.js                 API: sesión, búsqueda, importación, usuarios
  auth.js                  PBKDF2 para contraseñas y cookie firmada (HMAC)
  texto.js                 Normalización de texto para las búsquedas
public/
  index.html               Interfaz (login + aplicación)
  styles.css               Estilos
  app.js                   Lógica de la interfaz y lectura del CSV
migrations/
  0001_esquema.sql         Tablas
  0002_cuentas_iniciales.sql  Cuentas admin y agente
scripts/
  desplegar.sh             Despliegue completo desde cero
  crear-hash.mjs           Genera el hash de una contraseña
```

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
