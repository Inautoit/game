-- Cuentas anónimas: sin email ni contraseña. El móvil guarda {id, secret};
-- el código de recuperación sirve para llevarse la cuenta a otro aparato.
CREATE TABLE IF NOT EXISTS players (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  secret_hash   TEXT NOT NULL,
  recovery_hash TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL
);

-- Una fila por partida enviada. run_id es único: impide reenviar la misma.
CREATE TABLE IF NOT EXISTS runs (
  run_id      TEXT PRIMARY KEY,
  player_id   TEXT NOT NULL,
  mode        TEXT NOT NULL,
  score       INTEGER NOT NULL,
  distance    INTEGER NOT NULL,
  overtakes   INTEGER NOT NULL,
  near_misses INTEGER NOT NULL,
  top_speed   INTEGER NOT NULL,
  seconds     INTEGER NOT NULL,
  created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_player ON runs(player_id, created_at DESC);

-- Mejor marca por jugador y modo. El ranking se lee de aquí: una sola
-- consulta indexada, sin agrupar por encima de toda la tabla de partidas.
CREATE TABLE IF NOT EXISTS bests (
  player_id  TEXT NOT NULL,
  mode       TEXT NOT NULL,
  score      INTEGER NOT NULL,
  distance   INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (player_id, mode)
);
CREATE INDEX IF NOT EXISTS idx_bests_rank ON bests(mode, score DESC);

-- Clave HMAC de los vales de partida. Se genera sola en la primera petición
-- para no tener que gestionar secretos a mano.
CREATE TABLE IF NOT EXISTS meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL
);
