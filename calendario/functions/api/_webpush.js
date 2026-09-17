// Envío de notificaciones Web Push, sin librerías.
//
// Dos piezas, las dos con Web Crypto:
//
//  · El cuerpo va cifrado con aes128gcm (RFC 8291): se genera un par de
//    claves de usar y tirar, se acuerda un secreto con la clave pública
//    del navegador y de ahí salen la clave y el nonce del AES.
//  · La petición se firma con VAPID (RFC 8292): un JWT ES256 que le dice
//    al servicio de push quién lo manda.

const CADUCIDAD_JWT = 12 * 60 * 60;   // 12 h, el máximo recomendado

// ---------- utilidades de base64url ----------

export function b64urlADatos(s) {
  const base = String(s).replace(/-/g, '+').replace(/_/g, '/');
  const relleno = base + '='.repeat((4 - (base.length % 4)) % 4);
  const crudo = atob(relleno);
  const out = new Uint8Array(crudo.length);
  for (let i = 0; i < crudo.length; i++) out[i] = crudo.charCodeAt(i);
  return out;
}

export function datosAB64url(buf) {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function juntar(...trozos) {
  const total = trozos.reduce((n, t) => n + t.length, 0);
  const out = new Uint8Array(total);
  let i = 0;
  for (const t of trozos) { out.set(t, i); i += t.length; }
  return out;
}

const texto = (s) => new TextEncoder().encode(s);

// ---------- HKDF (RFC 5869), que es de lo que se fía todo esto ----------

async function hkdf(sal, material, info, largo) {
  const base = await crypto.subtle.importKey('raw', material, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: sal, info },
    base,
    largo * 8
  ));
}

// ---------- cifrado del cuerpo (RFC 8291) ----------

export async function cifrar(mensaje, claveCliente, authCliente, efimeras) {
  const datos = texto(mensaje);
  const p256dh = b64urlADatos(claveCliente);
  const auth = b64urlADatos(authCliente);

  // Par efímero: se pasa desde fuera solo para poder repetir el vector de
  // prueba del RFC; en producción se genera aquí, nuevo para cada envío.
  const par = efimeras || await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']
  );
  const publicaServidor = new Uint8Array(await crypto.subtle.exportKey('raw', par.publicKey));

  const publicaCliente = await crypto.subtle.importKey(
    'raw', p256dh, { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  const compartido = new Uint8Array(await crypto.subtle.deriveBits(
    { name: 'ECDH', public: publicaCliente }, par.privateKey, 256
  ));

  // El secreto de entrada mezcla el acuerdo ECDH con las dos públicas.
  const info = juntar(texto('WebPush: info\0'), p256dh, publicaServidor);
  const prk = await hkdf(auth, compartido, info, 32);

  const sal = crypto.getRandomValues(new Uint8Array(16));
  const salFija = efimeras && efimeras.sal ? efimeras.sal : sal;

  const claveBytes = await hkdf(salFija, prk, texto('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salFija, prk, texto('Content-Encoding: nonce\0'), 12);

  const clave = await crypto.subtle.importKey('raw', claveBytes, 'AES-GCM', false, ['encrypt']);
  // El 0x02 marca el final del registro (solo se manda uno).
  const cuerpo = juntar(datos, new Uint8Array([0x02]));
  const cifrado = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: nonce }, clave, cuerpo
  ));

  // Cabecera: sal (16) + tamaño de registro (4) + largo de la clave (1) + clave (65)
  const cabecera = new Uint8Array(21);
  cabecera.set(salFija, 0);
  new DataView(cabecera.buffer).setUint32(16, 4096);
  cabecera[20] = publicaServidor.length;

  return juntar(cabecera, publicaServidor, cifrado);
}

// ---------- firma VAPID (RFC 8292) ----------

// La clave privada de VAPID es solo el escalar `d`; para importarla hace
// falta también la pública, así que se reconstruye el JWK con las dos.
async function jwkVapid(privadaB64, publicaB64) {
  const pub = b64urlADatos(publicaB64);
  if (pub.length !== 65 || pub[0] !== 4) throw new Error('Clave VAPID pública mal formada');
  return {
    kty: 'EC',
    crv: 'P-256',
    d: privadaB64,
    x: datosAB64url(pub.slice(1, 33)),
    y: datosAB64url(pub.slice(33, 65)),
    ext: true,
  };
}

export async function cabeceraVapid(endpoint, publicaB64, privadaB64, contacto) {
  const origen = new URL(endpoint).origin;
  const cabecera = { typ: 'JWT', alg: 'ES256' };
  const cuerpo = {
    aud: origen,
    exp: Math.floor(Date.now() / 1000) + CADUCIDAD_JWT,
    sub: contacto,
  };

  const sinFirmar = datosAB64url(texto(JSON.stringify(cabecera))) + '.' +
                    datosAB64url(texto(JSON.stringify(cuerpo)));

  const clave = await crypto.subtle.importKey(
    'jwk', await jwkVapid(privadaB64, publicaB64),
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']
  );
  const firma = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, clave, texto(sinFirmar)
  );

  return 'vapid t=' + sinFirmar + '.' + datosAB64url(firma) + ', k=' + publicaB64;
}

// ---------- envío ----------

// Devuelve { ok, status }. Un 404 o un 410 significan que esa suscripción
// ya no vale y hay que borrarla.
export async function enviarPush(suscripcion, mensaje, vapid) {
  const cuerpo = await cifrar(mensaje, suscripcion.keys.p256dh, suscripcion.keys.auth);
  const autorizacion = await cabeceraVapid(
    suscripcion.endpoint, vapid.publica, vapid.privada, vapid.contacto
  );

  const res = await fetch(suscripcion.endpoint, {
    method: 'POST',
    headers: {
      Authorization: autorizacion,
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: '86400',
      Urgency: 'normal',
    },
    body: cuerpo,
  });

  return { ok: res.ok, status: res.status, caducada: res.status === 404 || res.status === 410 };
}
