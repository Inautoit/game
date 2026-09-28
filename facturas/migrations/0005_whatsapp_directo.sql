-- PDF de presupuestos compartidos por enlace (para abrir WhatsApp directamente con el número del cliente)
CREATE TABLE shared_pdfs (
  token      TEXT PRIMARY KEY,
  invoice_id INTEGER NOT NULL UNIQUE REFERENCES invoices(id) ON DELETE CASCADE,
  pdf        TEXT NOT NULL,          -- base64
  created_at TEXT DEFAULT (datetime('now'))
);

-- Mismo texto en WhatsApp y en el correo del presupuesto
UPDATE settings SET value = 'Hola {{cliente.nombre}}, te adjunto el presupuesto{{obra}}: {{enlace}}' || char(10) || char(10) || 'Si tienes cualquier duda, contáctame. Un saludo, Cefe'
WHERE key = 'whatsapp.mensaje';
DELETE FROM settings WHERE key = 'correo.presupuesto_cuerpo';
