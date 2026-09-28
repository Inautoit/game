-- Descuento general del documento (se usa en presupuestos)
ALTER TABLE invoices ADD COLUMN dto_tipo TEXT;            -- 'pct' | 'eur'
ALTER TABLE invoices ADD COLUMN dto_valor REAL NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN dto_importe REAL NOT NULL DEFAULT 0;

-- Presupuestos: IVA no incluido y validez de 30 días en todos
UPDATE invoices SET iva_pct = 0, iva = 0, irpf_pct = 0, irpf = 0, total = base WHERE tipo = 'presupuesto';
UPDATE invoices SET vencimiento = date(fecha, '+30 days') WHERE tipo = 'presupuesto';
INSERT INTO settings (key, value) VALUES ('presupuesto.dias_validez', '30') ON CONFLICT(key) DO UPDATE SET value = '30';

-- Nuevo mensaje de WhatsApp (sin número de presupuesto)
DELETE FROM settings WHERE key = 'whatsapp.mensaje';
