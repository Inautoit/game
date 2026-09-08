#!/usr/bin/env node
/**
 * Genera un hash de contraseña compatible con la aplicación.
 *
 *   node scripts/crear-hash.mjs "MiContraseña"
 *
 * Sirve para preparar el SQL de un usuario nuevo sin pasar por la interfaz.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';

const password = process.argv[2];
if (!password) {
  console.error('Uso: node scripts/crear-hash.mjs "<contraseña>"');
  process.exit(1);
}

const iteraciones = 100000;
const salt = randomBytes(16);
const hash = pbkdf2Sync(password, salt, iteraciones, 32, 'sha256');
console.log(`pbkdf2$${iteraciones}$${salt.toString('base64')}$${hash.toString('base64')}`);
