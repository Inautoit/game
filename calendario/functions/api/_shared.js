// Utilidades compartidas por las funciones de Cloudflare Pages.

export const KEY = 'calendario';
const TTL_SEGUNDOS = 12 * 60 * 60; // el token de edición dura 12 h

export function json(cuerpo, status = 200) {
  return new Response(JSON.stringify(cuerpo), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

export function error(mensaje, status) {
  return json({ error: mensaje }, status);
}

function bytesToHex(buf) {
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmac(secreto, mensaje) {
  const clave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  return bytesToHex(await crypto.subtle.sign('HMAC', clave, new TextEncoder().encode(mensaje)));
}

// Comparación en tiempo constante: no filtra cuánto has acertado.
export function iguales(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// El token es "caducidad.firma": nada que se pueda falsificar sin el secreto.
export async function crearToken(secreto) {
  const exp = Date.now() + TTL_SEGUNDOS * 1000;
  return `${exp}.${await hmac(secreto, String(exp))}`;
}

export async function tokenValido(secreto, token) {
  if (!token || typeof token !== 'string') return false;
  const punto = token.indexOf('.');
  if (punto < 1) return false;

  const exp = token.slice(0, punto);
  const firma = token.slice(punto + 1);
  if (!/^\d+$/.test(exp) || Number(exp) < Date.now()) return false;

  return iguales(firma, await hmac(secreto, exp));
}

export function tokenDePeticion(request) {
  const cab = request.headers.get('Authorization') || '';
  return cab.startsWith('Bearer ') ? cab.slice(7) : '';
}

// El secreto de firma: si no se define aparte, se deriva de la contraseña,
// así basta con configurar EDIT_PASSWORD para tenerlo todo funcionando.
export function secretoFirma(env) {
  return env.TOKEN_SECRET || `firma:${env.EDIT_PASSWORD || ''}`;
}

// Clave de borrado de una foto: se le da a quien la sube para que pueda
// quitarla luego. Es un HMAC del id, así que no hay que guardar nada y
// nadie la puede inventar sin el secreto del servidor.
export async function claveFoto(env, id) {
  return hmac(secretoFirma(env), 'foto:' + id);
}

export async function exigirEditor(request, env) {
  if (!env.EDIT_PASSWORD) return error('Falta configurar EDIT_PASSWORD', 503);
  const ok = await tokenValido(secretoFirma(env), tokenDePeticion(request));
  return ok ? null : error('No autorizado', 401);
}
