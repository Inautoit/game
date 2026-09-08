-- Rediseño de la tabla de registros para reducir escrituras y espacio.
--
-- Antes se guardaban cinco copias de cada fila (datos, norm, norm_txt,
-- busqueda y busqueda_txt) y un índice secundario, así que cada línea del CSV
-- costaba 2 escrituras de fila y unos 4 KB. Con 54.000 clientes eso son 108.000
-- escrituras: por encima del límite diario del plan gratuito de D1.
--
-- Ahora se guardan dos arrays JSON en paralelo (los nombres de las columnas
-- están una sola vez en importaciones.columnas):
--
--   valores  ["1234567", "María Pérez", "600 123 456", ...]   tal cual el CSV
--   norm     ["1234567", "mariaperez",  "600123456",  ...]    para buscar
--
-- Buscar en todos los campos es un LIKE sobre `norm` completo: como los valores
-- normalizados sólo tienen letras y números, las comas y comillas del JSON
-- impiden que una coincidencia cruce de un campo a otro. Buscar en un campo
-- concreto es json_extract(norm, '$[n]').
--
-- Sin AUTOINCREMENT (evita una escritura extra en sqlite_sequence por fila) y
-- sin índice secundario: cada línea del CSV cuesta ahora 1 sola escritura.
--
-- Se usa DROP TABLE en lugar de DELETE porque borrar filas también consume el
-- límite diario de escrituras, y soltar la tabla entera no.

DROP TABLE IF EXISTS registros;

CREATE TABLE registros (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  valores        TEXT NOT NULL,
  norm           TEXT NOT NULL
);

-- Las importaciones anteriores quedaron a medias y ya no tienen registros.
DROP TABLE IF EXISTS importaciones;

CREATE TABLE importaciones (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  archivo   TEXT NOT NULL,
  columnas  TEXT NOT NULL,
  modo      TEXT NOT NULL,
  estado    TEXT NOT NULL DEFAULT 'pendiente',
  filas     INTEGER NOT NULL DEFAULT 0,
  usuario   TEXT NOT NULL,
  creado_en TEXT NOT NULL DEFAULT (datetime('now'))
);
