-- Esquema inicial de la base de datos (Cloudflare D1)

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

-- Usuario de la app (solo el dueño)
CREATE TABLE users (
  email         TEXT PRIMARY KEY,
  password_hash TEXT,              -- pbkdf2$iter$salt$hash (opcional si entra con Microsoft)
  created_at    TEXT DEFAULT (datetime('now'))
);

-- Cuenta de correo conectada para enviar (Microsoft)
CREATE TABLE mail_account (
  id          INTEGER PRIMARY KEY CHECK (id = 1),
  provider    TEXT NOT NULL,       -- 'microsoft'
  email       TEXT NOT NULL,
  name        TEXT,
  secret_enc  TEXT NOT NULL,       -- refresh token cifrado
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  id         TEXT PRIMARY KEY,     -- hash SHA-256 del token de la cookie
  email      TEXT NOT NULL,
  expires    INTEGER NOT NULL,
  data       TEXT
);

CREATE TABLE login_attempts (
  ip   TEXT NOT NULL,
  ts   INTEGER NOT NULL
);
CREATE INDEX idx_login_attempts ON login_attempts(ip, ts);

CREATE TABLE banks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL,
  iban        TEXT NOT NULL,
  swift       TEXT,
  predeterminado INTEGER NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE clients (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  nif        TEXT,
  direccion  TEXT,
  cp         TEXT,
  ciudad     TEXT,
  provincia  TEXT,
  email      TEXT,
  telefono   TEXT,
  notas      TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE products (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre     TEXT NOT NULL,
  unidad     TEXT DEFAULT 'ud',
  precio     REAL NOT NULL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  numero            TEXT NOT NULL UNIQUE,
  fecha             TEXT NOT NULL,
  vencimiento       TEXT,
  client_id         INTEGER REFERENCES clients(id) ON DELETE SET NULL,
  cliente_nombre    TEXT,
  cliente_nif       TEXT,
  cliente_direccion TEXT,
  cliente_cp        TEXT,
  cliente_ciudad    TEXT,
  cliente_provincia TEXT,
  cliente_email     TEXT,
  cliente_telefono  TEXT,
  forma_pago        TEXT,
  notas             TEXT,
  bank_id           INTEGER REFERENCES banks(id) ON DELETE SET NULL,
  banco_nombre      TEXT,
  banco_iban        TEXT,
  banco_swift       TEXT,
  iva_pct           REAL NOT NULL DEFAULT 21,
  irpf_pct          REAL NOT NULL DEFAULT 0,
  base              REAL NOT NULL DEFAULT 0,
  iva               REAL NOT NULL DEFAULT 0,
  irpf              REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  estado            TEXT NOT NULL DEFAULT 'borrador',
  sent_at           TEXT,
  sent_to           TEXT,
  paid_at           TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);
CREATE INDEX idx_invoices_fecha ON invoices(fecha);

CREATE TABLE invoice_lines (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id  INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  pos         INTEGER NOT NULL,
  descripcion TEXT NOT NULL,
  cantidad    REAL NOT NULL DEFAULT 1,
  unidad      TEXT,
  precio      REAL NOT NULL DEFAULT 0,
  descuento   REAL NOT NULL DEFAULT 0,
  importe     REAL NOT NULL DEFAULT 0
);
CREATE INDEX idx_lines_invoice ON invoice_lines(invoice_id);

CREATE TABLE email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  to_addr    TEXT,
  cc_addr    TEXT,
  subject    TEXT,
  status     TEXT,
  error      TEXT,
  sent_at    TEXT DEFAULT (datetime('now'))
);
