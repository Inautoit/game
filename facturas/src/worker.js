// Facturas — API en Cloudflare Workers + base de datos D1.
// La interfaz (carpeta public/) la sirve Cloudflare como archivos estáticos.
// El PDF de la factura se genera en el navegador y se envía aquí solo para mandarlo por correo.
import { randomToken, sha256, safeEqual, hashPassword, verifyPassword, encrypt, decrypt } from './crypto.js';

const ESTADOS = ['borrador', 'emitida', 'enviada', 'pagada', 'anulada'];
const SESSION_DAYS = 30;
const COOKIE = 'facturas_sid';

const DEFAULT_SETTINGS = {
  'empresa.actividad': '',
  'empresa.nombre': '',
  'empresa.nif': '',
  'empresa.direccion': '',
  'empresa.cp': '',
  'empresa.ciudad': '',
  'empresa.provincia': '',
  'empresa.telefono': '',
  'empresa.email': '',
  'empresa.web': '',
  'empresa.logo': '', // imagen en data URL (PNG/JPG)
  'empresa.sello': '', // imagen del sello/firma en data URL (opcional)
  'factura.prefijo': 'F',
  'factura.digitos': '4',
  'factura.iva_pct': '21',
  'factura.irpf_pct': '0',
  'factura.dias_vencimiento': '30',
  'factura.forma_pago': 'Transferencia bancaria',
  'factura.notas': '',
  'factura.pie': '',
  'factura.color': '#1f4e79',
  'correo.asunto': 'Factura {{numero}} - {{empresa.nombre}}',
  'correo.cuerpo':
    'Hola {{cliente.nombre}},\n\n' +
    'Te adjunto la factura {{numero}} con fecha {{fecha}} por un importe total de {{total}}.\n\n' +
    'Forma de pago: {{forma_pago}}\n{{banco.nombre}} - IBAN: {{banco.iban}}\n\n' +
    'Un saludo,\n{{empresa.nombre}}\n{{empresa.telefono}}',
  'correo.remitente_nombre': '',
  'correo.remitente_email': '',
};
const SECRET_SETTINGS = ['correo.brevo_key'];

// ------------------------------------------------------------------ Utilidades

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers },
  });

const redirect = (url, headers = {}) => new Response(null, { status: 302, headers: { Location: url, ...headers } });

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v, def = 0) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : def;
};
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const today = () => new Date().toISOString().slice(0, 10);
const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;
const fmtDate = (iso) => (iso ? String(iso).slice(0, 10).split('-').reverse().join('/') : '');
const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);

function parseCookies(req) {
  const out = {};
  for (const part of (req.headers.get('Cookie') || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function cookie(name, value, maxAge) {
  return `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

async function body(req) {
  try {
    return await req.json();
  } catch {
    throw new HttpError(400, 'Petición no válida.');
  }
}

// ------------------------------------------------------------------ Ajustes

async function getSettings(env) {
  const out = { ...DEFAULT_SETTINGS };
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  for (const r of results) out[r.key] = r.value;
  return out;
}

async function setSettings(env, obj) {
  const stmt = env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  );
  const batch = Object.entries(obj).map(([k, v]) => stmt.bind(k, v == null ? '' : String(v)));
  if (batch.length) await env.DB.batch(batch);
}

// ------------------------------------------------------------------ Sesiones

async function createSession(env, email) {
  const token = randomToken();
  const expires = Date.now() + SESSION_DAYS * 86400000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sessions WHERE expires < ?').bind(Date.now()),
    env.DB.prepare('INSERT INTO sessions (id, email, expires) VALUES (?, ?, ?)').bind(await sha256(token), email, expires),
  ]);
  return cookie(COOKIE, token, SESSION_DAYS * 86400);
}

async function getSession(env, req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const s = await env.DB.prepare('SELECT email, expires FROM sessions WHERE id = ?').bind(await sha256(token)).first();
  if (!s || s.expires < Date.now()) return null;
  return { email: s.email };
}

async function destroySession(env, req) {
  const token = parseCookies(req)[COOKIE];
  if (token) await env.DB.prepare('DELETE FROM sessions WHERE id = ?').bind(await sha256(token)).run();
}

async function rateLimit(env, req) {
  const ip = req.headers.get('CF-Connecting-IP') || 'local';
  const since = Date.now() - 15 * 60000;
  const r = await env.DB.prepare('SELECT COUNT(*) AS n FROM login_attempts WHERE ip = ? AND ts > ?').bind(ip, since).first();
  if (r.n >= 10) throw new HttpError(429, 'Demasiados intentos. Espera 15 minutos.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM login_attempts WHERE ts < ?').bind(since),
    env.DB.prepare('INSERT INTO login_attempts (ip, ts) VALUES (?, ?)').bind(ip, Date.now()),
  ]);
}

// El dueño es OWNER_EMAIL (secreto) o, si no se definió, el primer usuario creado.
async function ownerEmail(env) {
  if (env.OWNER_EMAIL) return env.OWNER_EMAIL.trim().toLowerCase();
  const u = await env.DB.prepare('SELECT email FROM users ORDER BY created_at LIMIT 1').first();
  return u?.email || null;
}

// ------------------------------------------------------------------ Microsoft

const MS_SCOPES = 'openid profile email offline_access User.Read Mail.Send';
const msAuthority = (env) => `https://login.microsoftonline.com/${env.MS_TENANT || 'common'}/oauth2/v2.0`;
const msEnabled = (env) => !!(env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);
const msRedirect = (req) => `${new URL(req.url).origin}/auth/microsoft/callback`;

async function msToken(env, params) {
  const res = await fetch(`${msAuthority(env)}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, scope: MS_SCOPES, ...params }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Error de Microsoft');
  return data;
}

async function msAccessToken(env, account) {
  const tok = await msToken(env, { grant_type: 'refresh_token', refresh_token: await decrypt(env.ENC_KEY, account.secret_enc) });
  if (tok.refresh_token) {
    await env.DB.prepare("UPDATE mail_account SET secret_enc = ?, updated_at = datetime('now') WHERE id = 1")
      .bind(await encrypt(env.ENC_KEY, tok.refresh_token))
      .run();
  }
  return tok.access_token;
}

// ------------------------------------------------------------------ Envío de correo

function parseAddresses(s) {
  return String(s || '')
    .split(/[;,]/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function sendMail(env, { to, cc, bcc, subject, text, attachment }) {
  const toList = parseAddresses(to);
  const ccList = parseAddresses(cc);
  const bccList = parseAddresses(bcc);
  if (!toList.length) throw new HttpError(400, 'Indica al menos un destinatario.');
  for (const a of [...toList, ...ccList, ...bccList]) if (!EMAIL_RE.test(a)) throw new HttpError(400, `Dirección no válida: ${a}`);

  const account = await env.DB.prepare('SELECT * FROM mail_account WHERE id = 1').first();
  if (account && msEnabled(env)) {
    const token = await msAccessToken(env, account);
    const addr = (list) => list.map((address) => ({ emailAddress: { address } }));
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: addr(toList),
          ccRecipients: addr(ccList),
          bccRecipients: addr(bccList),
          attachments: [
            { '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: 'application/pdf', contentBytes: attachment.base64 },
          ],
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Microsoft respondió ${res.status}`);
    }
    return account.email;
  }

  // Alternativa: Brevo (API HTTP de envío de correo, plan gratuito de 300 correos/día)
  const brevo = await env.DB.prepare("SELECT value FROM settings WHERE key = 'correo.brevo_key'").first();
  if (brevo?.value) {
    const s = await getSettings(env);
    const sender = s['correo.remitente_email'];
    if (!sender) throw new HttpError(400, 'Indica el correo remitente en Ajustes → Correo.');
    const res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': await decrypt(env.ENC_KEY, brevo.value), 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        sender: { email: sender, name: s['correo.remitente_nombre'] || s['empresa.nombre'] || undefined },
        replyTo: { email: sender },
        to: toList.map((email) => ({ email })),
        ...(ccList.length ? { cc: ccList.map((email) => ({ email })) } : {}),
        ...(bccList.length ? { bcc: bccList.map((email) => ({ email })) } : {}),
        subject,
        textContent: text,
        attachment: [{ name: attachment.name, content: attachment.base64 }],
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Brevo respondió ${res.status}`);
    }
    return sender;
  }

  throw new HttpError(400, 'No hay ningún correo conectado para enviar. Ve a Ajustes → Correo y conecta tu cuenta.');
}

// ------------------------------------------------------------------ Facturas

async function nextNumber(env, fecha) {
  const s = await getSettings(env);
  const year = (isoDate(fecha) || today()).slice(0, 4);
  const prefix = `${s['factura.prefijo'] || ''}${year}-`;
  const digits = Math.min(Math.max(num(s['factura.digitos'], 4), 1), 8);
  const { results } = await env.DB.prepare('SELECT numero FROM invoices WHERE substr(numero, 1, ?) = ?').bind(prefix.length, prefix).all();
  let max = 0;
  for (const { numero } of results) {
    const n = parseInt(numero.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(digits, '0');
}

function dueDate(fecha, days) {
  days = num(days, 0);
  if (!days) return null;
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function computeInvoice(b) {
  const lines = (Array.isArray(b.lines) ? b.lines : [])
    .map((l) => ({
      descripcion: str(l.descripcion, 1000),
      cantidad: num(l.cantidad, 1),
      unidad: str(l.unidad, 20),
      precio: round2(num(l.precio)),
      descuento: Math.min(Math.max(num(l.descuento), 0), 100),
    }))
    .filter((l) => l.descripcion)
    .map((l) => ({ ...l, importe: round2(l.cantidad * l.precio * (1 - l.descuento / 100)) }));
  if (!lines.length) throw new HttpError(400, 'Añade al menos un producto o servicio a la factura.');

  const iva_pct = num(b.iva_pct, 21);
  const irpf_pct = num(b.irpf_pct, 0);
  const base = round2(lines.reduce((s, l) => s + l.importe, 0));
  const iva = round2((base * iva_pct) / 100);
  const irpf = round2((base * irpf_pct) / 100);
  const inv = {
    numero: str(b.numero, 50),
    fecha: isoDate(b.fecha) || today(),
    vencimiento: isoDate(b.vencimiento),
    client_id: b.client_id ? Number(b.client_id) : null,
    cliente_nombre: str(b.cliente_nombre, 300),
    cliente_nif: str(b.cliente_nif, 50),
    cliente_direccion: str(b.cliente_direccion, 300),
    cliente_cp: str(b.cliente_cp, 20),
    cliente_ciudad: str(b.cliente_ciudad, 100),
    cliente_provincia: str(b.cliente_provincia, 100),
    cliente_email: str(b.cliente_email, 254),
    cliente_telefono: str(b.cliente_telefono, 50),
    forma_pago: str(b.forma_pago, 300),
    notas: str(b.notas, 3000),
    bank_id: b.bank_id ? Number(b.bank_id) : null,
    iva_pct,
    irpf_pct,
    base,
    iva,
    irpf,
    total: round2(base + iva - irpf),
    estado: ESTADOS.includes(b.estado) ? b.estado : 'borrador',
  };
  if (!inv.cliente_nombre) throw new HttpError(400, 'Indica el cliente de la factura.');
  return { inv, lines };
}

const INV_FIELDS = [
  'numero', 'fecha', 'vencimiento', 'client_id', 'cliente_nombre', 'cliente_nif', 'cliente_direccion', 'cliente_cp',
  'cliente_ciudad', 'cliente_provincia', 'cliente_email', 'cliente_telefono', 'forma_pago', 'notas', 'bank_id',
  'banco_nombre', 'banco_iban', 'banco_swift', 'iva_pct', 'irpf_pct', 'base', 'iva', 'irpf', 'total', 'estado',
];
const CLIENT_FIELDS = ['nombre', 'nif', 'direccion', 'cp', 'ciudad', 'provincia', 'email', 'telefono', 'notas'];

async function getInvoice(env, id) {
  const inv = await env.DB.prepare('SELECT * FROM invoices WHERE id = ?').bind(Number(id)).first();
  if (!inv) throw new HttpError(404, 'Factura no encontrada.');
  inv.lines = (await env.DB.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos').bind(inv.id).all()).results;
  inv.emails = (await env.DB.prepare('SELECT * FROM email_log WHERE invoice_id = ? ORDER BY id DESC').bind(inv.id).all()).results;
  return inv;
}

// Rellena número, vencimiento, banco y cliente antes de guardar.
async function prepareInvoice(env, b, existing) {
  const { inv, lines } = computeInvoice({ ...b, estado: b.estado || existing?.estado });
  if (!inv.numero) inv.numero = await nextNumber(env, inv.fecha);

  const bank = inv.bank_id
    ? await env.DB.prepare('SELECT * FROM banks WHERE id = ?').bind(inv.bank_id).first()
    : await env.DB.prepare('SELECT * FROM banks ORDER BY predeterminado DESC, id LIMIT 1').first();
  inv.bank_id = bank?.id || null;
  inv.banco_nombre = bank?.nombre || '';
  inv.banco_iban = bank?.iban || '';
  inv.banco_swift = bank?.swift || '';

  if (b.guardar_cliente) {
    const d = Object.fromEntries(CLIENT_FIELDS.filter((f) => f !== 'notas').map((f) => [f, inv['cliente_' + f]]));
    const keys = Object.keys(d);
    const exists = inv.client_id && (await env.DB.prepare('SELECT id FROM clients WHERE id = ?').bind(inv.client_id).first());
    if (exists) {
      await env.DB.prepare(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`)
        .bind(...keys.map((k) => d[k]), inv.client_id)
        .run();
    } else {
      const r = await env.DB.prepare(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
        .bind(...keys.map((k) => d[k]))
        .run();
      inv.client_id = r.meta.last_row_id;
    }
  }
  return { inv, lines };
}

function linesStatements(env, invoiceId, lines) {
  const ins = env.DB.prepare(
    'INSERT INTO invoice_lines (invoice_id, pos, descripcion, cantidad, unidad, precio, descuento, importe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  return [
    env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(invoiceId),
    ...lines.map((l, i) => ins.bind(invoiceId, i, l.descripcion, l.cantidad, l.unidad, l.precio, l.descuento, l.importe)),
  ];
}

function duplicateError(err) {
  if (/UNIQUE constraint failed: invoices.numero/.test(err.message)) throw new HttpError(409, 'Ya existe una factura con ese número.');
  throw err;
}

// Texto del correo con marcadores {{...}}
function renderText(template, inv, s) {
  const v = {
    numero: inv.numero,
    fecha: fmtDate(inv.fecha),
    vencimiento: fmtDate(inv.vencimiento),
    forma_pago: inv.forma_pago || '',
    total: eur(inv.total),
    base: eur(inv.base),
    iva: eur(inv.iva),
    'cliente.nombre': inv.cliente_nombre || '',
    'banco.nombre': inv.banco_nombre || '',
    'banco.iban': inv.banco_iban || '',
  };
  for (const k of Object.keys(DEFAULT_SETTINGS)) if (k.startsWith('empresa.') && !/logo|sello/.test(k)) v[k] = s[k] || '';
  return String(template || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, k) => (k in v ? v[k] : m));
}

// ------------------------------------------------------------------ Rutas

const routes = [];
const route = (method, pattern, handler, opts = {}) =>
  routes.push({ method, re: new RegExp('^' + pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)') + '$'), handler, ...opts });

// --- Autenticación (públicas)

route('GET', '/auth/options', async (req, env) => {
  const users = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL').first();
  return json({ microsoft: msEnabled(env), setup: users.n === 0 && !!env.SETUP_CODE });
}, { public: true });

route('POST', '/auth/setup', async (req, env) => {
  await rateLimit(env, req);
  const b = await body(req);
  const email = str(b.email, 254).toLowerCase();
  const exists = await env.DB.prepare('SELECT COUNT(*) AS n FROM users WHERE password_hash IS NOT NULL').first();
  if (exists.n > 0) throw new HttpError(400, 'La cuenta ya está creada. Inicia sesión.');
  if (!env.SETUP_CODE || !safeEqual(str(b.code, 100), env.SETUP_CODE)) throw new HttpError(403, 'El código de activación no es correcto.');
  if (!EMAIL_RE.test(email)) throw new HttpError(400, 'Escribe un correo válido.');
  const owner = await ownerEmail(env);
  if (owner && owner !== email) throw new HttpError(403, 'Este correo no tiene acceso a la app.');
  if (String(b.password || '').length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  await env.DB.prepare(
    'INSERT INTO users (email, password_hash) VALUES (?, ?) ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash'
  )
    .bind(email, await hashPassword(String(b.password)))
    .run();
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, email) });
}, { public: true });

route('POST', '/auth/login', async (req, env) => {
  await rateLimit(env, req);
  const b = await body(req);
  const email = str(b.email, 254).toLowerCase();
  const user = await env.DB.prepare('SELECT * FROM users WHERE email = ?').bind(email).first();
  if (!user?.password_hash || !(await verifyPassword(String(b.password || ''), user.password_hash))) {
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  }
  return json({ ok: true }, 200, { 'Set-Cookie': await createSession(env, email) });
}, { public: true });

route('POST', '/auth/logout', async (req, env) => {
  await destroySession(env, req);
  return json({ ok: true }, 200, { 'Set-Cookie': cookie(COOKIE, '', 0) });
}, { public: true });

// Microsoft: ?modo=login (entrar) o ?modo=conectar (conectar el correo para enviar)
route('GET', '/auth/microsoft', async (req, env) => {
  if (!msEnabled(env)) return redirect('/login?error=' + encodeURIComponent('El inicio con Microsoft no está configurado todavía.'));
  const state = randomToken(16);
  const modo = new URL(req.url).searchParams.get('modo') === 'conectar' ? 'conectar' : 'login';
  const params = new URLSearchParams({
    client_id: env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: msRedirect(req),
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    prompt: 'select_account',
  });
  return redirect(`${msAuthority(env)}/authorize?${params}`, { 'Set-Cookie': cookie('ms_state', `${state}.${modo}`, 600) });
}, { public: true });

route('GET', '/auth/microsoft/callback', async (req, env) => {
  const url = new URL(req.url);
  const [state, modo] = (parseCookies(req).ms_state || '').split('.');
  const back = modo === 'conectar' ? '/#/ajustes' : '/';
  const fail = (msg) => redirect((modo === 'conectar' ? '/?error=' : '/login?error=') + encodeURIComponent(msg) + (modo === 'conectar' ? '#/ajustes' : ''));
  try {
    if (url.searchParams.get('error')) throw new Error(url.searchParams.get('error_description') || url.searchParams.get('error'));
    if (!state || state !== url.searchParams.get('state')) throw new Error('Sesión de Microsoft caducada. Vuelve a intentarlo.');
    const tok = await msToken(env, { grant_type: 'authorization_code', code: url.searchParams.get('code'), redirect_uri: msRedirect(req) });
    const me = await (await fetch('https://graph.microsoft.com/v1.0/me', { headers: { Authorization: `Bearer ${tok.access_token}` } })).json();
    const email = String(me.mail || me.userPrincipalName || '').toLowerCase();
    if (!email) throw new Error('No se pudo leer el correo de la cuenta de Microsoft.');

    const session = await getSession(env, req);
    const owner = await ownerEmail(env);
    if (modo !== 'conectar' || !session) {
      if (owner && owner !== email) throw new Error(`Solo la cuenta ${owner} puede entrar en esta app.`);
      await env.DB.prepare('INSERT OR IGNORE INTO users (email) VALUES (?)').bind(email).run();
    }
    await env.DB.prepare(
      `INSERT INTO mail_account (id, provider, email, name, secret_enc, updated_at) VALUES (1, 'microsoft', ?, ?, ?, datetime('now'))
       ON CONFLICT(id) DO UPDATE SET provider = excluded.provider, email = excluded.email, name = excluded.name,
       secret_enc = excluded.secret_enc, updated_at = excluded.updated_at`
    )
      .bind(email, me.displayName || '', await encrypt(env.ENC_KEY, tok.refresh_token))
      .run();

    const headers = new Headers({ Location: back });
    headers.append('Set-Cookie', cookie('ms_state', '', 0));
    if (!session) headers.append('Set-Cookie', await createSession(env, email));
    return new Response(null, { status: 302, headers });
  } catch (err) {
    return fail(err.message);
  }
}, { public: true });

// --- API privada

route('GET', '/api/me', async (req, env, { user }) => {
  const acc = await env.DB.prepare('SELECT provider, email, name, updated_at FROM mail_account WHERE id = 1').first();
  const brevo = await env.DB.prepare("SELECT 1 AS ok FROM settings WHERE key = 'correo.brevo_key' AND value != ''").first();
  return json({ email: user.email, mail: acc || null, brevo: !!brevo, microsoft: msEnabled(env) });
});

route('POST', '/api/me/password', async (req, env, { user }) => {
  const b = await body(req);
  if (String(b.password || '').length < 8) throw new HttpError(400, 'La contraseña debe tener al menos 8 caracteres.');
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE email = ?').bind(await hashPassword(String(b.password)), user.email).run();
  return json({ ok: true });
});

route('DELETE', '/api/mail-account', async (req, env) => {
  await env.DB.prepare('DELETE FROM mail_account WHERE id = 1').run();
  return json({ ok: true });
});

route('GET', '/api/settings', async (req, env) => {
  const s = await getSettings(env);
  for (const k of SECRET_SETTINGS) delete s[k];
  return json({ settings: s });
});

route('PUT', '/api/settings', async (req, env) => {
  const b = await body(req);
  const out = {};
  for (const k of Object.keys(DEFAULT_SETTINGS)) {
    if (!(k in b)) continue;
    const isImage = k === 'empresa.logo' || k === 'empresa.sello';
    const v = str(b[k], isImage ? 700000 : 5000);
    if (isImage && v && !/^data:image\/(png|jpeg);base64,/.test(v)) throw new HttpError(400, 'La imagen debe ser PNG o JPG.');
    out[k] = v;
  }
  if ('correo.brevo_key' in b) out['correo.brevo_key'] = b['correo.brevo_key'] ? await encrypt(env.ENC_KEY, str(b['correo.brevo_key'], 300)) : '';
  await setSettings(env, out);
  return json({ ok: true });
});

// --- Bancos

route('GET', '/api/banks', async (req, env) =>
  json((await env.DB.prepare('SELECT * FROM banks ORDER BY predeterminado DESC, nombre COLLATE NOCASE').all()).results)
);

async function saveBank(req, env, id) {
  const b = await body(req);
  const nombre = str(b.nombre, 100);
  const iban = str(b.iban, 50).toUpperCase().replace(/\s+/g, ' ');
  if (!nombre || !iban) throw new HttpError(400, 'Escribe el nombre del banco y el número de cuenta (IBAN).');
  const pred = b.predeterminado ? 1 : 0;
  const stmts = [];
  if (pred) stmts.push(env.DB.prepare('UPDATE banks SET predeterminado = 0'));
  if (id) stmts.push(env.DB.prepare('UPDATE banks SET nombre = ?, iban = ?, swift = ?, predeterminado = ? WHERE id = ?').bind(nombre, iban, str(b.swift, 20), pred, Number(id)));
  else stmts.push(env.DB.prepare('INSERT INTO banks (nombre, iban, swift, predeterminado) VALUES (?, ?, ?, ?)').bind(nombre, iban, str(b.swift, 20), pred));
  await env.DB.batch(stmts);
  return json({ ok: true });
}
route('POST', '/api/banks', (req, env) => saveBank(req, env, null));
route('PUT', '/api/banks/:id', (req, env, { params }) => saveBank(req, env, params.id));
route('DELETE', '/api/banks/:id', async (req, env, { params }) => {
  await env.DB.prepare('DELETE FROM banks WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
});

// --- Clientes

function clientData(b) {
  const d = Object.fromEntries(CLIENT_FIELDS.map((f) => [f, str(b[f], f === 'notas' ? 2000 : 300)]));
  if (!d.nombre) throw new HttpError(400, 'El nombre del cliente es obligatorio.');
  if (d.email && !EMAIL_RE.test(d.email)) throw new HttpError(400, 'El email del cliente no es válido.');
  return d;
}

route('GET', '/api/clients', async (req, env) =>
  json(
    (
      await env.DB.prepare(
        `SELECT c.*, COUNT(i.id) AS facturas, COALESCE(SUM(CASE WHEN i.estado NOT IN ('anulada', 'borrador') THEN i.total END), 0) AS facturado
         FROM clients c LEFT JOIN invoices i ON i.client_id = c.id GROUP BY c.id ORDER BY c.nombre COLLATE NOCASE`
      ).all()
    ).results
  )
);
route('POST', '/api/clients', async (req, env) => {
  const d = clientData(await body(req));
  const r = await env.DB.prepare(`INSERT INTO clients (${CLIENT_FIELDS.join(',')}) VALUES (${CLIENT_FIELDS.map(() => '?').join(',')})`)
    .bind(...CLIENT_FIELDS.map((f) => d[f]))
    .run();
  return json({ id: r.meta.last_row_id, ...d });
});
route('PUT', '/api/clients/:id', async (req, env, { params }) => {
  const d = clientData(await body(req));
  await env.DB.prepare(`UPDATE clients SET ${CLIENT_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`)
    .bind(...CLIENT_FIELDS.map((f) => d[f]), Number(params.id))
    .run();
  return json({ id: Number(params.id), ...d });
});
route('DELETE', '/api/clients/:id', async (req, env, { params }) => {
  await env.DB.prepare('DELETE FROM clients WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
});

// --- Productos

function productData(b) {
  const d = { nombre: str(b.nombre, 500), unidad: str(b.unidad, 20) || 'ud', precio: round2(num(b.precio)) };
  if (!d.nombre) throw new HttpError(400, 'El nombre del producto es obligatorio.');
  return d;
}
route('GET', '/api/products', async (req, env) => json((await env.DB.prepare('SELECT * FROM products ORDER BY nombre COLLATE NOCASE').all()).results));
route('POST', '/api/products', async (req, env) => {
  const d = productData(await body(req));
  const r = await env.DB.prepare('INSERT INTO products (nombre, unidad, precio) VALUES (?, ?, ?)').bind(d.nombre, d.unidad, d.precio).run();
  return json({ id: r.meta.last_row_id, ...d });
});
route('PUT', '/api/products/:id', async (req, env, { params }) => {
  const d = productData(await body(req));
  await env.DB.prepare('UPDATE products SET nombre = ?, unidad = ?, precio = ? WHERE id = ?').bind(d.nombre, d.unidad, d.precio, Number(params.id)).run();
  return json({ id: Number(params.id), ...d });
});
route('DELETE', '/api/products/:id', async (req, env, { params }) => {
  await env.DB.prepare('DELETE FROM products WHERE id = ?').bind(Number(params.id)).run();
  return json({ ok: true });
});

// --- Facturas

route('GET', '/api/invoices', async (req, env) => {
  const q = new URL(req.url).searchParams;
  const where = [];
  const params = [];
  if (q.get('year')) {
    where.push('substr(fecha, 1, 4) = ?');
    params.push(q.get('year'));
  }
  if (ESTADOS.includes(q.get('estado'))) {
    where.push('estado = ?');
    params.push(q.get('estado'));
  }
  if (q.get('q')) {
    where.push('(numero LIKE ? OR cliente_nombre LIKE ? OR cliente_nif LIKE ?)');
    const like = `%${q.get('q')}%`;
    params.push(like, like, like);
  }
  const sql = `SELECT id, numero, fecha, vencimiento, client_id, cliente_nombre, cliente_email, base, iva, irpf, total, estado, sent_at, sent_to, paid_at
    FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, numero DESC`;
  return json((await env.DB.prepare(sql).bind(...params).all()).results);
});

route('GET', '/api/invoices/years', async (req, env) => {
  const years = (await env.DB.prepare('SELECT DISTINCT substr(fecha, 1, 4) AS y FROM invoices ORDER BY y DESC').all()).results.map((r) => r.y);
  if (!years.includes(today().slice(0, 4))) years.unshift(today().slice(0, 4));
  return json(years);
});

route('GET', '/api/invoices/next-number', async (req, env) => json({ numero: await nextNumber(env, new URL(req.url).searchParams.get('fecha')) }));

route('POST', '/api/invoices', async (req, env) => {
  const { inv, lines } = await prepareInvoice(env, await body(req));
  let id;
  try {
    const r = await env.DB.prepare(`INSERT INTO invoices (${INV_FIELDS.join(',')}) VALUES (${INV_FIELDS.map(() => '?').join(',')})`)
      .bind(...INV_FIELDS.map((f) => inv[f] ?? null))
      .run();
    id = r.meta.last_row_id;
  } catch (err) {
    duplicateError(err);
  }
  await env.DB.batch(linesStatements(env, id, lines));
  return json(await getInvoice(env, id));
});

route('GET', '/api/invoices/:id', async (req, env, { params }) => json(await getInvoice(env, params.id)));

route('PUT', '/api/invoices/:id', async (req, env, { params }) => {
  const current = await getInvoice(env, params.id);
  const { inv, lines } = await prepareInvoice(env, await body(req), current);
  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE invoices SET ${INV_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).bind(
        ...INV_FIELDS.map((f) => inv[f] ?? null),
        current.id
      ),
      ...linesStatements(env, current.id, lines),
    ]);
  } catch (err) {
    duplicateError(err);
  }
  return json(await getInvoice(env, current.id));
});

route('PATCH', '/api/invoices/:id/estado', async (req, env, { params }) => {
  const inv = await getInvoice(env, params.id);
  const { estado } = await body(req);
  if (!ESTADOS.includes(estado)) throw new HttpError(400, 'Estado no válido.');
  await env.DB.prepare(
    `UPDATE invoices SET estado = ?, paid_at = CASE WHEN ? = 'pagada' THEN COALESCE(paid_at, date('now')) ELSE NULL END, updated_at = datetime('now') WHERE id = ?`
  )
    .bind(estado, estado, inv.id)
    .run();
  return json(await getInvoice(env, inv.id));
});

route('DELETE', '/api/invoices/:id', async (req, env, { params }) => {
  const inv = await getInvoice(env, params.id);
  if (inv.estado !== 'borrador') throw new HttpError(400, 'Solo se pueden borrar borradores. Las facturas emitidas se anulan para conservar la numeración.');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').bind(inv.id),
    env.DB.prepare('DELETE FROM email_log WHERE invoice_id = ?').bind(inv.id),
    env.DB.prepare('DELETE FROM invoices WHERE id = ?').bind(inv.id),
  ]);
  return json({ ok: true });
});

route('POST', '/api/invoices/:id/duplicate', async (req, env, { params }) => {
  const src = await getInvoice(env, params.id);
  const s = await getSettings(env);
  const fecha = today();
  const copy = { ...src, numero: await nextNumber(env, fecha), fecha, vencimiento: dueDate(fecha, s['factura.dias_vencimiento']), estado: 'borrador' };
  const r = await env.DB.prepare(`INSERT INTO invoices (${INV_FIELDS.join(',')}) VALUES (${INV_FIELDS.map(() => '?').join(',')})`)
    .bind(...INV_FIELDS.map((f) => copy[f] ?? null))
    .run();
  await env.DB.batch(linesStatements(env, r.meta.last_row_id, src.lines));
  return json(await getInvoice(env, r.meta.last_row_id));
});

route('GET', '/api/invoices/:id/email-preview', async (req, env, { params }) => {
  const inv = await getInvoice(env, params.id);
  const s = await getSettings(env);
  return json({ to: inv.cliente_email || '', subject: renderText(s['correo.asunto'], inv, s), body: renderText(s['correo.cuerpo'], inv, s) });
});

// El navegador genera el PDF y lo manda aquí en base64 para enviarlo.
route('POST', '/api/invoices/:id/send', async (req, env, { params, user }) => {
  const inv = await getInvoice(env, params.id);
  const b = await body(req);
  const to = str(b.to, 1000);
  const cc = str(b.cc, 1000);
  const subject = str(b.subject, 500) || `Factura ${inv.numero}`;
  const pdf = String(b.pdf || '');
  if (!/^[A-Za-z0-9+/=]+$/.test(pdf) || pdf.length < 100) throw new HttpError(400, 'No se ha podido generar el PDF de la factura.');
  const log = env.DB.prepare('INSERT INTO email_log (invoice_id, to_addr, cc_addr, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)');
  try {
    const account = await env.DB.prepare('SELECT email FROM mail_account WHERE id = 1').first();
    await sendMail(env, {
      to,
      cc,
      bcc: b.copia ? account?.email || user.email : '',
      subject,
      text: str(b.body, 20000),
      attachment: { name: `Factura_${inv.numero.replace(/[^\w.-]+/g, '_')}.pdf`, base64: pdf },
    });
  } catch (err) {
    await log.bind(inv.id, to, cc, subject, 'error', err.message).run();
    if (err instanceof HttpError) throw err;
    throw new HttpError(502, `No se pudo enviar el correo: ${err.message}`);
  }
  await env.DB.batch([
    log.bind(inv.id, to, cc, subject, 'ok', null),
    env.DB.prepare(
      `UPDATE invoices SET sent_at = datetime('now'), sent_to = ?, estado = CASE WHEN estado IN ('borrador', 'emitida') THEN 'enviada' ELSE estado END,
       updated_at = datetime('now') WHERE id = ?`
    ).bind(to, inv.id),
    env.DB.prepare("UPDATE clients SET email = ? WHERE id = ? AND (email IS NULL OR email = '')").bind(parseAddresses(to)[0] || '', inv.client_id),
  ]);
  return json(await getInvoice(env, inv.id));
});

// --- Resumen, exportación y copia de seguridad

route('GET', '/api/stats', async (req, env) => {
  const year = new URL(req.url).searchParams.get('year') || today().slice(0, 4);
  const rows = (
    await env.DB.prepare(
      `SELECT substr(fecha, 6, 2) AS mes, COUNT(*) AS n, SUM(base) AS base, SUM(iva) AS iva, SUM(irpf) AS irpf, SUM(total) AS total
       FROM invoices WHERE substr(fecha, 1, 4) = ? AND estado NOT IN ('anulada', 'borrador') GROUP BY mes ORDER BY mes`
    )
      .bind(year)
      .all()
  ).results;
  const pendiente = await env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM invoices WHERE estado IN ('emitida', 'enviada')").first();
  const trimestres = [1, 2, 3, 4].map((t) => {
    const r = rows.filter((x) => Math.ceil(Number(x.mes) / 3) === t);
    const sum = (k) => round2(r.reduce((s, x) => s + (x[k] || 0), 0));
    return { t, n: r.reduce((s, x) => s + x.n, 0), base: sum('base'), iva: sum('iva'), irpf: sum('irpf'), total: sum('total') };
  });
  return json({ year, meses: rows, trimestres, pendiente });
});

// Libro de facturas emitidas en CSV (se abre directamente con Excel)
route('GET', '/api/export.csv', async (req, env) => {
  const year = new URL(req.url).searchParams.get('year') || today().slice(0, 4);
  const rows = (await env.DB.prepare('SELECT * FROM invoices WHERE substr(fecha, 1, 4) = ? ORDER BY fecha, numero').bind(year).all()).results;
  const n = (v) => (Number(v) || 0).toFixed(2).replace('.', ',');
  const q = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['Número', 'Fecha', 'Cliente', 'NIF', 'Base imponible', '% IVA', 'Cuota IVA', '% IRPF', 'Retención IRPF', 'Total', 'Estado', 'Banco', 'Enviada a', 'Fecha pago'];
  const lines = rows.map((r) =>
    [q(r.numero), fmtDate(r.fecha), q(r.cliente_nombre), q(r.cliente_nif), n(r.base), n(r.iva_pct), n(r.iva), n(r.irpf_pct), n(r.irpf), n(r.total), r.estado, q(r.banco_nombre), q(r.sent_to), fmtDate(r.paid_at)].join(';')
  );
  return new Response('﻿' + [head.join(';'), ...lines].join('\r\n'), {
    headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="Libro_facturas_${year}.csv"` },
  });
});

route('GET', '/api/backup', async (req, env) => {
  const out = {};
  for (const t of ['settings', 'banks', 'clients', 'products', 'invoices', 'invoice_lines', 'email_log']) {
    out[t] = (await env.DB.prepare(`SELECT * FROM ${t}`).all()).results;
  }
  out.settings = out.settings.filter((r) => !SECRET_SETTINGS.includes(r.key));
  return new Response(JSON.stringify(out, null, 1), {
    headers: { 'Content-Type': 'application/json', 'Content-Disposition': `attachment; filename="facturas-${today()}.json"` },
  });
});

// ------------------------------------------------------------------ Entrada

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const path = url.pathname;
    if (!path.startsWith('/api/') && !path.startsWith('/auth/')) return env.ASSETS.fetch(req);

    try {
      if (!env.ENC_KEY) throw new HttpError(500, 'Falta configurar ENC_KEY.');
      for (const r of routes) {
        if (r.method !== req.method) continue;
        const m = path.match(r.re);
        if (!m) continue;
        let user = null;
        if (!r.public) {
          user = await getSession(env, req);
          if (!user) throw new HttpError(401, 'Sesión caducada. Vuelve a iniciar sesión.');
          // Protección CSRF: las escrituras deben venir de la propia app
          if (req.method !== 'GET' && req.headers.get('X-Requested-With') !== 'facturas') throw new HttpError(403, 'Petición no permitida.');
        }
        return await r.handler(req, env, { params: m.groups || {}, user });
      }
      throw new HttpError(404, 'No encontrado');
    } catch (err) {
      const status = err.status || 500;
      if (status >= 500) console.error(err);
      return json({ error: err.status ? err.message : `Error interno: ${err.message}` }, status);
    }
  },
};
