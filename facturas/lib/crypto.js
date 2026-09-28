'use strict';
// Cifrado AES-256-GCM para guardar en disco la contraseña SMTP / token de Microsoft.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DATA_DIR } = require('./db');

// Si no se define APP_SECRET se genera uno aleatorio y se guarda en data/.secret
function loadSecret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  const file = path.join(DATA_DIR, '.secret');
  if (!fs.existsSync(file)) fs.writeFileSync(file, crypto.randomBytes(32).toString('hex'), { mode: 0o600 });
  return fs.readFileSync(file, 'utf8').trim();
}

const SECRET = loadSecret();
const KEY = crypto.scryptSync(SECRET, 'facturas-electricidad', 32);

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}

function decrypt(payload) {
  const [iv, tag, enc] = String(payload).split('.').map((s) => Buffer.from(s, 'base64'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

module.exports = { SECRET, encrypt, decrypt };
