-- Conexión de correo por SMTP (Gmail con contraseña de aplicación, u otros)
ALTER TABLE mail_account ADD COLUMN smtp_host TEXT;
ALTER TABLE mail_account ADD COLUMN smtp_port INTEGER;
ALTER TABLE mail_account ADD COLUMN smtp_secure INTEGER;
