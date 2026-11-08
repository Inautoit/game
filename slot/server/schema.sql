-- Base de datos D1 de Turbo Slot (turbo-slot-pistas): circuitos de la comunidad
CREATE TABLE IF NOT EXISTS tracks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  lanes INTEGER NOT NULL,
  laps INTEGER NOT NULL,
  scenery TEXT NOT NULL,
  pieces TEXT NOT NULL,          -- JSON: piezas ya cerradas
  length REAL NOT NULL,          -- metros de cuerda
  plays INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  best_time REAL,                -- mejor vuelta (s)
  best_name TEXT,
  created INTEGER NOT NULL,
  ip_hash TEXT                   -- hash de la IP para limitar publicaciones; nunca la IP
);
CREATE INDEX IF NOT EXISTS tracks_created ON tracks(created DESC);
CREATE INDEX IF NOT EXISTS tracks_plays ON tracks(plays DESC);
