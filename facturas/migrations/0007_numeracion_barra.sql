-- Numeración "33/26" (número / año con dos cifras), sin prefijos.
-- Facturas y presupuestos llevan series separadas, así que el número es único por tipo.
PRAGMA defer_foreign_keys = true;

-- Copia de las tablas hijas: al borrar la tabla antigua, ON DELETE CASCADE las vaciaría
CREATE TABLE _lines_bak AS SELECT * FROM invoice_lines;
CREATE TABLE _email_bak AS SELECT * FROM email_log;

CREATE TABLE invoices_new (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  numero            TEXT NOT NULL,
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
  updated_at        TEXT DEFAULT (datetime('now')),
  tipo              TEXT NOT NULL DEFAULT 'factura',
  factura_id        INTEGER,
  presupuesto_id    INTEGER,
  dto_tipo          TEXT,
  dto_valor         REAL NOT NULL DEFAULT 0,
  dto_importe       REAL NOT NULL DEFAULT 0,
  UNIQUE (tipo, numero)
);

INSERT INTO invoices_new
SELECT id,
  -- "F2026-0033" / "P2026-0003" -> "33/26" / "3/26"
  CASE WHEN numero GLOB '[A-Za-z]*[0-9][0-9][0-9][0-9]-[0-9]*'
       THEN CAST(substr(numero, instr(numero, '-') + 1) AS INTEGER) || '/' || substr(numero, instr(numero, '-') - 2, 2)
       ELSE numero END,
  fecha, vencimiento, client_id, cliente_nombre, cliente_nif, cliente_direccion, cliente_cp, cliente_ciudad,
  cliente_provincia, cliente_email, cliente_telefono, forma_pago, notas, bank_id, banco_nombre, banco_iban, banco_swift,
  iva_pct, irpf_pct, base, iva, irpf, total, estado, sent_at, sent_to, paid_at, created_at, updated_at,
  tipo, factura_id, presupuesto_id, dto_tipo, dto_valor, dto_importe
FROM invoices;

DROP TABLE invoices;
ALTER TABLE invoices_new RENAME TO invoices;
CREATE INDEX idx_invoices_fecha ON invoices(fecha);
CREATE INDEX idx_invoices_tipo ON invoices(tipo, fecha);

-- Se restauran las líneas y el historial de envíos
DELETE FROM invoice_lines;
INSERT INTO invoice_lines SELECT * FROM _lines_bak;
DELETE FROM email_log;
INSERT INTO email_log SELECT * FROM _email_bak;
DROP TABLE _lines_bak;
DROP TABLE _email_bak;
