'use strict';
// Base de datos SQLite (módulo nativo node:sqlite, sin dependencias externas).
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'facturas.db'));
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS account (
  email       TEXT PRIMARY KEY,
  name        TEXT,
  method      TEXT NOT NULL,          -- 'microsoft' | 'smtp'
  smtp_host   TEXT,
  smtp_port   INTEGER,
  smtp_secure INTEGER,
  secret_enc  TEXT,                   -- contraseña SMTP o refresh token (cifrado)
  updated_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sessions (
  sid     TEXT PRIMARY KEY,
  data    TEXT NOT NULL,
  expires INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS clients (
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

CREATE TABLE IF NOT EXISTS products (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  nombre      TEXT NOT NULL,
  unidad      TEXT DEFAULT 'ud',
  precio      REAL NOT NULL DEFAULT 0,
  created_at  TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoices (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  numero            TEXT NOT NULL UNIQUE,
  fecha             TEXT NOT NULL,          -- YYYY-MM-DD
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
  iva_pct           REAL NOT NULL DEFAULT 21,
  irpf_pct          REAL NOT NULL DEFAULT 0,
  base              REAL NOT NULL DEFAULT 0,
  iva               REAL NOT NULL DEFAULT 0,
  irpf              REAL NOT NULL DEFAULT 0,
  total             REAL NOT NULL DEFAULT 0,
  estado            TEXT NOT NULL DEFAULT 'borrador', -- borrador|emitida|enviada|pagada|anulada
  sent_at           TEXT,
  sent_to           TEXT,
  paid_at           TEXT,
  created_at        TEXT DEFAULT (datetime('now')),
  updated_at        TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS invoice_lines (
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

CREATE TABLE IF NOT EXISTS email_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER REFERENCES invoices(id) ON DELETE CASCADE,
  to_addr    TEXT,
  cc_addr    TEXT,
  subject    TEXT,
  status     TEXT,     -- ok | error
  error      TEXT,
  sent_at    TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_fecha ON invoices(fecha);
CREATE INDEX IF NOT EXISTS idx_lines_invoice ON invoice_lines(invoice_id);
`);

const DEFAULT_SETTINGS = {
  'empresa.nombre': '',
  'empresa.nif': '',
  'empresa.direccion': '',
  'empresa.cp': '',
  'empresa.ciudad': '',
  'empresa.provincia': '',
  'empresa.telefono': '',
  'empresa.email': '',
  'empresa.iban': '',
  'factura.prefijo': 'F',
  'factura.digitos': '4',
  'factura.iva_pct': '21',
  'factura.irpf_pct': '0',
  'factura.dias_vencimiento': '30',
  'factura.forma_pago': 'Transferencia bancaria',
  'factura.notas': '',
  'correo.asunto': 'Factura {{numero}} - {{empresa.nombre}}',
  'correo.cuerpo':
    'Hola {{cliente.nombre}},\n\n' +
    'Te adjunto la factura {{numero}} con fecha {{fecha}} por un importe total de {{total}}.\n\n' +
    'Forma de pago: {{forma_pago}}\n{{empresa.iban}}\n\n' +
    'Un saludo,\n{{empresa.nombre}}\n{{empresa.telefono}}',
  'correo.adjunto': 'pdf', // pdf | xlsx | ambos
  'plantilla.nombre': '',
};

const getSettingStmt = db.prepare('SELECT value FROM settings WHERE key = ?');
const setSettingStmt = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
);

function getSetting(key) {
  const row = getSettingStmt.get(key);
  if (row) return row.value;
  return DEFAULT_SETTINGS[key] ?? null;
}

function setSetting(key, value) {
  setSettingStmt.run(key, value == null ? '' : String(value));
}

function getAllSettings() {
  const out = { ...DEFAULT_SETTINGS };
  for (const row of db.prepare('SELECT key, value FROM settings').all()) out[row.key] = row.value;
  return out;
}

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = { db, DATA_DIR, DEFAULT_SETTINGS, getSetting, setSetting, getAllSettings, transaction };
