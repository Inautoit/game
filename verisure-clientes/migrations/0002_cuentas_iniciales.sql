-- Cuentas iniciales.
--
--   admin  / Verisure2026!Admin    -> administrador (sube el CSV y gestiona usuarios)
--   agente / Verisure2026!Agente   -> usuario (solo consulta)
--
-- IMPORTANTE: cambia ambas contrasenas desde la aplicacion tras el primer acceso
-- (apartado "Mi cuenta"). Estos hashes son publicos porque estan en el repositorio.

INSERT OR IGNORE INTO usuarios (usuario, nombre, rol, hash, activo) VALUES
  ('admin', 'Administrador', 'admin', 'pbkdf2$100000$34C0poJIvhOKk+aPYkjoag==$uPCLzbFaCF8a4n8r8Xrx1kI9sS3FulNkIqoAQdNy2ss=', 1),
  ('agente', 'Agente de atención', 'usuario', 'pbkdf2$100000$QS2FYAYjTliHBjc3KPQNYQ==$DqaQpc3sLp0OR2sB7ST0DmXrTgCE2UGonxlIT+CnB10=', 1);
