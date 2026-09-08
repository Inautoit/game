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
  usuario   TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- El CSV se guarda TROCEADO EN BLOQUES, no una fila por cliente.
--
-- El límite del plan gratuito de D1 son 100.000 escrituras de fila al día, así
-- que convertir 54.000 líneas de CSV en 54.000 filas agota la cuota de un día
-- entero con una sola carga. Guardando 100 registros por fila, esa misma carga
-- son 540 escrituras y se puede repetir tantas veces como haga falta.
--
-- Cada bloque lleva los mismos registros en dos formatos paralelos:
--
--   datos  JSON [["1234567","María Pérez","600 123 456"], [...], ...]
--   norm   una línea por registro, campos separados por tabulador, con el
--          texto normalizado: "1234567\tmariaperez\t600123456"
--
-- Buscar es un LIKE sobre `norm`: SQLite descarta de golpe los bloques que no
-- contienen el texto (eso no consume CPU del Worker) y sólo los que quedan se
-- abren para ver qué registros concretos coinciden. Como el texto normalizado
-- sólo tiene letras y números, los tabuladores y saltos de línea impiden que
-- una coincidencia cruce de un campo a otro o de un registro al siguiente.
--
-- Sin AUTOINCREMENT: añadiría una escritura extra por cada bloque insertado.
CREATE TABLE IF NOT EXISTS bloques (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  datos          TEXT NOT NULL,
  norm           TEXT NOT NULL
);

-- Intentos de acceso fallidos, para frenar ataques de fuerza bruta.
CREATE TABLE IF NOT EXISTS intentos (
  usuario TEXT NOT NULL,
  ip      TEXT NOT NULL,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intentos_ts ON intentos (ts);
