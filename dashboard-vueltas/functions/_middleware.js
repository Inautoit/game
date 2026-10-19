// Protege todo el dashboard con una contraseña (secreto DASHBOARD_PASSWORD).
// Tras iniciar sesión se guarda una cookie firmada con HMAC durante 30 días.

const COOKIE = 'vb_auth';

async function firma(secreto) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secreto),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode('vueltas-bbdd'));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function cookie(req, nombre) {
  const m = (req.headers.get('Cookie') || '').match(new RegExp(`(?:^|; )${nombre}=([^;]+)`));
  return m ? m[1] : '';
}

const login = (error = '') => new Response(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Vueltas BBDD</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f4f4f2;color:#0b0b0b;font:15px system-ui,sans-serif}
@media (prefers-color-scheme:dark){body{background:#111110;color:#f0efec}form{background:#1a1a19!important;border-color:#2e2e2c!important}input{background:#111110!important;color:#f0efec!important;border-color:#2e2e2c!important}}
form{background:#fcfcfb;border:1px solid #e2e1dc;border-radius:10px;padding:24px;display:grid;gap:12px;width:min(320px,calc(100vw - 32px))}
input,button{font:inherit;padding:8px 10px;border-radius:6px;border:1px solid #e2e1dc}button{background:#2a78d6;color:#fff;border:0;cursor:pointer}
.e{color:#e34948;font-size:13px}</style></head><body><form method="POST" action="/login">
<strong>Vueltas de BBDD</strong><input type="password" name="password" placeholder="Contraseña" autofocus required>
${error ? `<div class="e">${error}</div>` : ''}<button>Entrar</button></form></body></html>`,
{ status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } });

export async function onRequest(ctx) {
  const { request, env, next } = ctx;
  const secreto = env.DASHBOARD_PASSWORD;
  if (!secreto) return new Response('Falta configurar DASHBOARD_PASSWORD', { status: 500 });
  const url = new URL(request.url);
  const ok = await firma(secreto);

  if (url.pathname === '/login' && request.method === 'POST') {
    const form = await request.formData();
    if (String(form.get('password') || '') !== secreto) return login('Contraseña incorrecta');
    return new Response(null, { status: 303, headers: {
      Location: '/',
      'Set-Cookie': `${COOKIE}=${ok}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=2592000`,
    } });
  }
  if (url.pathname === '/logout') {
    return new Response(null, { status: 303, headers: { Location: '/', 'Set-Cookie': `${COOKIE}=; Path=/; Max-Age=0` } });
  }
  if (cookie(request, COOKIE) !== ok) {
    return url.pathname.startsWith('/api/') ? new Response('No autorizado', { status: 401 }) : login();
  }
  const res = await next();
  const out = new Response(res.body, res);
  out.headers.set('Cache-Control', 'no-store');
  return out;
}
