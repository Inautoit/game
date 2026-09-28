-- Presupuestos: se guardan en la misma tabla que las facturas, con tipo = 'presupuesto'
ALTER TABLE invoices ADD COLUMN tipo TEXT NOT NULL DEFAULT 'factura';
ALTER TABLE invoices ADD COLUMN factura_id INTEGER;   -- factura creada a partir del presupuesto
ALTER TABLE invoices ADD COLUMN presupuesto_id INTEGER; -- presupuesto del que viene la factura
CREATE INDEX idx_invoices_tipo ON invoices(tipo, fecha);

-- Nuevo texto del correo: sin importe ni número de cuenta
UPDATE settings SET value =
  'Hola {{cliente.nombre}},' || char(10) || char(10) ||
  'Te adjunto la factura {{numero}} con fecha {{fecha}}.' || char(10) || char(10) ||
  'El número de cuenta al que se tiene que realizar el pago está al final de la factura.' || char(10) || char(10) ||
  'Un saludo,' || char(10) || '{{empresa.nombre}}' || char(10) || '{{empresa.telefono}}'
WHERE key = 'correo.cuerpo';
