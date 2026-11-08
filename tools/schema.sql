-- Base de datos D1 de mapas de la comunidad (isla-rodante-mapas)
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  author TEXT NOT NULL,
  world TEXT NOT NULL,
  map TEXT NOT NULL,          -- JSON: filas del mapa
  w INTEGER NOT NULL,
  h INTEGER NOT NULL,
  difficulty INTEGER NOT NULL DEFAULT 1,
  plays INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  likes INTEGER NOT NULL DEFAULT 0,
  best_time REAL,
  created INTEGER NOT NULL,
  ip_hash TEXT                -- hash de la IP (límite de 15 mapas/día), nunca la IP
);
CREATE INDEX IF NOT EXISTS maps_created ON maps(created DESC);
CREATE INDEX IF NOT EXISTS maps_plays ON maps(plays DESC);
