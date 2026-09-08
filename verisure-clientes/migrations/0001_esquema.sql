-- Esquema inicial del buscador de clientes de baja.

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
CREATE TABLE IF NOT EXISTS importaciones (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo   TEXT NOT NULL,
  columnas  TEXT NOT NULL,                    -- JSON: ["Nº instalación", "Teléfono", ...]
  modo      TEXT NOT NULL,                    -- 'reemplazar' | 'anadir'
  estado    TEXT NOT NULL DEFAULT 'pendiente',-- 'pendiente' | 'activa'
  filas     INTEGER NOT NULL DEFAULT 0,
  usuario   TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Un registro por línea del CSV.
--   datos        JSON con los valores tal cual venían
--   norm         JSON con cada valor "colapsado" (sin acentos, espacios ni signos)
--   norm_txt     JSON con cada valor tokenizado (palabras separadas por espacio)
--   busqueda     todos los valores colapsados, para buscar en cualquier campo
--   busqueda_txt todos los valores tokenizados, para buscar por palabras sueltas
CREATE TABLE IF NOT EXISTS registros (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  importacion_id INTEGER NOT NULL,
  datos          TEXT NOT NULL,
  norm           TEXT NOT NULL,
  norm_txt       TEXT NOT NULL,
  busqueda       TEXT NOT NULL,
  busqueda_txt   TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_registros_importacion ON registros (importacion_id);

-- Intentos de acceso fallidos, para frenar ataques de fuerza bruta.
CREATE TABLE IF NOT EXISTS intentos (
  usuario TEXT NOT NULL,
  ip      TEXT NOT NULL,
  ts      INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_intentos_ts ON intentos (ts);
