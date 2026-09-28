-- WhatsApp vuelve a enviar el PDF como archivo: se borran los enlaces públicos
DROP TABLE IF EXISTS shared_pdfs;
UPDATE settings SET value = 'Hola {{cliente.nombre}}, te adjunto el presupuesto{{obra}}.' || char(10) || char(10) || 'Si tienes cualquier duda, contáctame. Un saludo, Cefe'
WHERE key = 'whatsapp.mensaje';
