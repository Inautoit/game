/**
 * Autenticación: hash de contraseñas (PBKDF2-SHA256) y sesiones en cookie
 * firmada con HMAC-SHA256. No se guardan sesiones en base de datos.
 */

const ITERACIONES = 100_000;
const DURACION_SESION_S = 60 * 60 * 8; // 8 horas
export const COOKIE = 'vs_sesion';

const enc = new TextEncoder();

/* ---------- utilidades base64url ---------- */

function aBase64(bytes) {
  let bin = '';
  for (const b of new Uint8Array(bytes)) bin += String.fromCharCode(b);
  return btoa(bin);
}

function deBase64(texto) {
  const bin = atob(texto);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function aBase64Url(bytes) {
  return aBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto) {
  const pad = texto.length % 4 === 0 ? '' : '='.repeat(4 - (texto.length % 4));
  return deBase64(texto.replace(/-/g, '+').replace(/_/g, '/') + pad);
}

/* ---------- contraseñas ---------- */

async function derivar(password, salt, iteraciones) {
  const clave = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iteraciones },
    clave,
    256,
  );
}

/** Devuelve "pbkdf2$iteraciones$saltB64$hashB64". */
export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const bits = await derivar(password, salt, ITERACIONES);
  return `pbkdf2$${ITERACIONES}$${aBase64(salt)}$${aBase64(bits)}`;
}

export async function verificarPassword(password, almacenado) {
  const partes = String(almacenado || '').split('$');
  if (partes.length !== 4 || partes[0] !== 'pbkdf2') return false;
  const iteraciones = Number(partes[1]);
  if (!Number.isInteger(iteraciones) || iteraciones < 1000 || iteraciones > 1_000_000) return false;
  let salt;
  let esperado;
  try {
    salt = deBase64(partes[2]);
    esperado = deBase64(partes[3]);
  } catch {
    return false;
  }
  const bits = new Uint8Array(await derivar(password, salt, iteraciones));
  return igualdadConstante(bits, esperado);
}

/** Comparación en tiempo constante (evita ataques de temporización). */
function igualdadConstante(a, b) {
  if (a.length !== b.length) return false;
  let dif = 0;
  for (let i = 0; i < a.length; i++) dif |= a[i] ^ b[i];
  return dif === 0;
}

/* ---------- sesiones ---------- */

async function claveHmac(secreto) {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

/** Crea el token de sesión: <payload>.<firma> */
export async function crearToken(secreto, usuario) {
  const datos = {
    id: usuario.id,
    usuario: usuario.usuario,
    nombre: usuario.nombre,
    rol: usuario.rol,
    exp: Math.floor(Date.now() / 1000) + DURACION_SESION_S,
  };
  const payload = aBase64Url(enc.encode(JSON.stringify(datos)));
  const firma = await crypto.subtle.sign('HMAC', await claveHmac(secreto), enc.encode(payload));
  return `${payload}.${aBase64Url(firma)}`;
}

/** Devuelve los datos de sesión o null si el token no es válido o caducó. */
export async function leerToken(secreto, token) {
  if (!token || typeof token !== 'string') return null;
  const [payload, firma] = token.split('.');
  if (!payload || !firma) return null;
  let valida = false;
  try {
    valida = await crypto.subtle.verify(
      'HMAC',
      await claveHmac(secreto),
      deBase64Url(firma),
      enc.encode(payload),
    );
  } catch {
    return null;
  }
  if (!valida) return null;
  try {
    const datos = JSON.parse(new TextDecoder().decode(deBase64Url(payload)));
    if (!datos.exp || datos.exp < Math.floor(Date.now() / 1000)) return null;
    return datos;
  } catch {
    return null;
  }
}

export function cookieSesion(token, seguro) {
  const base = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${DURACION_SESION_S}`;
  return seguro ? `${base}; Secure` : base;
}

export function cookieBorrado(seguro) {
  const base = `${COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`;
  return seguro ? `${base}; Secure` : base;
}

export function leerCookie(request, nombre) {
  const cabecera = request.headers.get('Cookie') || '';
  for (const trozo of cabecera.split(';')) {
    const i = trozo.indexOf('=');
    if (i === -1) continue;
    if (trozo.slice(0, i).trim() === nombre) return trozo.slice(i + 1).trim();
  }
  return null;
}
