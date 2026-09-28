-- Los presupuestos no muestran número: asunto del correo sin número
UPDATE settings SET value = 'Presupuesto{{obra}} - {{empresa.nombre}}' WHERE key = 'correo.presupuesto_asunto';
