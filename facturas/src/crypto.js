// Utilidades criptográficas con WebCrypto (disponible en Cloudflare Workers).

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes) {
  let s = '';
  for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(str) {
  const s = atob(str.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function randomToken(bytes = 32) {
  return b64url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function sha256(text) {
  return b64url(await crypto.subtle.digest('SHA-256', enc.encode(text)));
}

// Comparación en tiempo constante
export function safeEqual(a, b) {
  a = String(a);
  b = String(b);
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

// --- Contraseñas (PBKDF2-SHA256) ---------------------------------------------
// Pocas iteraciones porque el plan gratuito de Workers limita el tiempo de CPU;
// además hay límite de intentos de acceso por IP.
const PBKDF2_ITER = 20000;

async function pbkdf2(password, salt, iter) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256);
}

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITER);
  return `pbkdf2$${PBKDF2_ITER}$${b64url(salt)}$${b64url(hash)}`;
}

export async function verifyPassword(password, stored) {
  const [alg, iter, salt, hash] = String(stored || '').split('$');
  if (alg !== 'pbkdf2') return false;
  const test = await pbkdf2(password, fromB64url(salt), Number(iter));
  return safeEqual(b64url(test), hash);
}

// --- Cifrado de secretos guardados (AES-256-GCM) ------------------------------
async function aesKey(secret) {
  const raw = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}

export async function encrypt(secret, text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(secret), enc.encode(text));
  return `${b64url(iv)}.${b64url(data)}`;
}

export async function decrypt(secret, payload) {
  const [iv, data] = String(payload).split('.');
  const out = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64url(iv) }, await aesKey(secret), fromB64url(data));
  return dec.decode(out);
}
