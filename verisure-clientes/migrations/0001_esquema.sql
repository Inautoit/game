-- Esquema del buscador de clientes de baja.

CREATE TABLE IF NOT EXISTS usuarios (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  usuario   TEXT NOT NULL UNIQUE,
  nombre    TEXT NOT NULL,
  rol       TEXT NOT NULL CHECK (rol IN ('admin', 'usuario')),
  hash      TEXT NOT NULL,
  activo    INTEGER NOT NULL DEFAULT 1,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada carga de CSV. Sólo las 'activa' se usan en las búsquedas.
-- `columnas` guarda los nombres de las columnas una única vez para toda la
-- carga, de modo que no se repitan en cada uno de los registros.
CREATE TABLE IF NOT EXISTS importaciones (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo   TEXT NOT NULL,
  columnas  TEXT NOT NULL,                     -- JSON: ["Nº instalación", ...]
  modo      TEXT NOT NULL,                     -- 'reemplazar' | 'anadir'
  estado    TEXT NOT NULL DEFAULT 'pendiente', -- 'pendiente' | 'activa'
  filas     INTEGER NOT NULL DEFAULT 0,
  n_bloques INTEGER NOT NULL DEFAULT 0,
  usuario   TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El CSV se guarda TROCEADO EN BLOQUES, no una fila por cliente.
--
-- El límite del plan gratuito de D1 son 100.000 escrituras de fila al día, así
-- que convertir un millón de líneas de CSV en un millón de filas es imposible.
-- Con 100 registros por bloque, ese mismo fichero son 20.000 escrituras.
--
-- Los bloques van en dos tablas separadas a propósito:
--
--   bloques         el texto normalizado, que es lo único que se recorre al
--                   buscar. Al no llevar los datos al lado, SQLite lee la mitad
--                   de páginas de disco en cada búsqueda.
--   bloques_datos   los valores originales en JSON comprimido con gzip. Sólo se
--                   piden los de los bloques que salen en pantalla. Comprime
--                   unas 5 veces, que es lo que permite que un millón de
--                   clientes quepa en los 500 MB del plan gratuito.
--
-- En `bloques.norm` hay una línea por registro y sus campos van separados por
-- tabulador, ya normalizados: "1234567\tmariaperez\t600123456". Como el texto
-- normalizado sólo tiene letras y números, los tabuladores y saltos de línea
-- impiden que una coincidencia cruce de un campo a otro o de un registro al
-- siguiente.
--
-- El id del bloque se calcula (importacion * 100.000.000 + nº de bloque) en vez
-- de dejarlo a AUTOINCREMENT, que costaría una escritura extra por bloque y no
-- permitiría enlazar las dos tablas dentro del mismo lote de inserciones.
CREATE TABLE IF NOT EXISTS bloques (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  norm           TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bloques_datos (
  bloque_id INTEGER PRIMARY KEY,
  datos     BLOB NOT NULL
);

-- Intentos de acceso fallidos, para frenar ataques de fuerza bruta.
CREATE TABLE IF NOT EXISTS intentos (
  usuario TEXT NOT NULL,
  ip      TEXT NOT NULL,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intentos_ts ON intentos (ts);
