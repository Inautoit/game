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

-- Una fila por línea del CSV, con dos arrays JSON en paralelo:
--
--   valores  ["1234567", "María Pérez", "600 123 456", ...]  tal cual el CSV
--   norm     ["1234567", "mariaperez",  "600123456",  ...]   para buscar
--
-- Buscar en todos los campos es un LIKE sobre `norm` entero: como los valores
-- normalizados sólo tienen letras y números, las comas y comillas del JSON
-- impiden que una coincidencia cruce de un campo a otro. Buscar en un campo
-- concreto es json_extract(norm, '$[n]').
--
-- Deliberadamente SIN AUTOINCREMENT y SIN índice secundario: ambos añadirían
-- una escritura de fila extra por cada línea importada, y el plan gratuito de
-- D1 permite 100.000 escrituras al día. Así cada línea del CSV cuesta una sola.
CREATE TABLE IF NOT EXISTS registros (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  valores        TEXT NOT NULL,
  norm           TEXT NOT NULL
);

-- Intentos de acceso fallidos, para frenar ataques de fuerza bruta.
CREATE TABLE IF NOT EXISTS intentos (
  usuario TEXT NOT NULL,
  ip      TEXT NOT NULL,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intentos_ts ON intentos (ts);
