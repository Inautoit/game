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

## Límites de Cloudflare y tamaño del fichero

La aplicación va sobre D1, la base de datos de Cloudflare. Lo que marca el
ritmo no es el espacio sino las **escrituras de fila al día**, que en el plan
gratuito son 100.000 para toda la cuenta:

| | Gratuito | Workers Paid (desde 5 $/mes) |
|---|---|---|
| Escrituras de fila | 100.000 **al día** (límite duro) | Sin límite diario · 50 millones al mes incluidas, después 1 $/millón |
| Lecturas de fila | 5.000.000 al día (límite duro) | 25.000 millones al mes incluidas |
| Almacenamiento | 5 GB en total | 5 GB incluidos, después 0,75 $/GB al mes |

Una carga completa de 54.000 clientes son 54.000 escrituras: en el plan de pago
cabrían unas 900 recargas al mes dentro de lo ya incluido, así que en la
práctica el coste se queda en los 5 $/mes del plan.

Cada línea del CSV cuesta **una** escritura, así que en el plan gratuito caben
unos 100.000 clientes al día, en una sola carga. Un fichero de 54.000 registros
entra sin problema, pero **no se puede cargar dos veces el mismo día**.

El modo *Reemplazar todo* vacía la tabla con `DROP TABLE` en vez de borrar fila
a fila, precisamente porque borrar 54.000 filas costaría otras 54.000
escrituras y no cabría en el día. A cambio, mientras dura la importación el
buscador se queda sin datos.

Como referencia medida con 54.000 registros de 35 columnas: **27 MB** de base
de datos y búsquedas de **30-60 ms**.

Si se agota la cuota, la aplicación lo dice con todas las letras y el límite se
restablece a las 00:00 UTC (las 02:00 en España peninsular).

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
