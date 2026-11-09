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

-- Clasificación mundial: la mejor vuelta comprobada de cada piloto (dispositivo) por circuito y clase.
-- inputs = pulsaciones del gatillo desde la última parada; el servidor repite la vuelta con
-- la física del juego y solo la guarda si da exactamente el mismo tiempo.
CREATE TABLE IF NOT EXISTS laps (
  track_key TEXT NOT NULL,       -- 'o:ovalo' (oficial) o 'c:abc1234' (comunidad)
  cls TEXT NOT NULL,             -- 'iman' | 'pro'
  device TEXT NOT NULL,          -- identificador aleatorio del dispositivo
  name TEXT NOT NULL,
  time REAL NOT NULL,
  car TEXT, liv TEXT,
  lane INTEGER NOT NULL,
  setup TEXT NOT NULL,           -- JSON del reglaje
  s0 REAL NOT NULL, t0 REAL NOT NULL, go_t REAL NOT NULL,
  inputs TEXT NOT NULL,          -- JSON [valor, pasos, …]
  lap INTEGER NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (track_key, cls, device)
);
CREATE INDEX IF NOT EXISTS laps_rank ON laps(track_key, cls, time);

-- Cuentas de jugador: la contraseña y el código de recuperación se guardan con PBKDF2 (nunca en claro).
-- rid = identificador de la cuenta en el ranking mundial; data = perfil sincronizado (JSON).
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  salt TEXT NOT NULL,
  rid TEXT NOT NULL UNIQUE,
  recovery_hash TEXT NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  ver INTEGER NOT NULL DEFAULT 0,
  created INTEGER NOT NULL,
  updated INTEGER NOT NULL
);
-- Sesiones abiertas (solo se guarda el hash del token)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
-- Límites por IP y día (registros, intentos fallidos)
CREATE TABLE IF NOT EXISTS limits (
  k TEXT NOT NULL,
  day INTEGER NOT NULL,
  n INTEGER NOT NULL,
  PRIMARY KEY (k, day)
);

-- Moderación: circuitos ocultos tras varias denuncias, y las denuncias (una por persona y circuito)
ALTER TABLE tracks ADD COLUMN hidden INTEGER NOT NULL DEFAULT 0;
CREATE TABLE IF NOT EXISTS reports (
  track_id TEXT NOT NULL,
  reporter TEXT NOT NULL,        -- hash de la IP
  reason TEXT NOT NULL,
  created INTEGER NOT NULL,
  PRIMARY KEY (track_id, reporter)
);
-- Mensajes de los jugadores (Ajustes → Contacto)
CREATE TABLE IF NOT EXISTS feedback (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  created INTEGER NOT NULL,
  user_name TEXT,
  contact TEXT,
  msg TEXT NOT NULL
);
