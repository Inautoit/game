'use strict';
// Servidor de la app de facturas.
const fs = require('node:fs');
const path = require('node:path');

// Carga opcional de un fichero .env (sin dependencias)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^(['"])(.*)\1$/, '$2');
  }
}

const express = require('express');
const session = require('express-session');
const multer = require('multer');
const ExcelJS = require('exceljs');

const { db, DATA_DIR, getSetting, setSetting, getAllSettings, DEFAULT_SETTINGS, transaction } = require('./lib/db');
const { SECRET } = require('./lib/crypto');
const { SqliteStore } = require('./lib/sessionStore');
const { fillTemplate, inspectTemplate, renderText, buildValues, PLACEHOLDERS, fmtDate } = require('./lib/excel');
const { buildDefaultTemplate } = require('./lib/defaultTemplate');
const { xlsxToPdf, findSoffice } = require('./lib/pdf');
const mail = require('./lib/mail');

const PORT = Number(process.env.PORT) || 3000;
const TEMPLATE_FILE = path.join(DATA_DIR, 'plantilla.xlsx');
const ESTADOS = ['borrador', 'emitida', 'enviada', 'pagada', 'anulada'];

const app = express();
app.set('trust proxy', process.env.TRUST_PROXY === '1' ? 1 : false);
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));
app.use(
  session({
    store: new SqliteStore(),
    secret: SECRET,
    name: 'facturas.sid',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.COOKIE_SECURE === '1',
      maxAge: 1000 * 60 * 60 * 24 * 30,
    },
  })
);
app.use((req, res, next) => {
  res.set('X-Content-Type-Options', 'nosniff');
  res.set('X-Frame-Options', 'SAMEORIGIN');
  res.set('Referrer-Policy', 'same-origin');
  next();
});

// ------------------------------------------------------------------ Utilidades

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const str = (v, max = 500) => (v == null ? '' : String(v).trim().slice(0, max));
const num = (v, def = 0) => {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : def;
};
const isoDate = (v) => (/^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? String(v) : null);
const today = () => new Date().toISOString().slice(0, 10);

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function allowedEmails() {
  return String(process.env.ALLOWED_EMAILS || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

// Solo tú puedes entrar: la primera cuenta que inicia sesión queda como dueña
// (o las indicadas en ALLOWED_EMAILS).
function checkAllowed(email) {
  const list = allowedEmails();
  if (list.length) {
    if (!list.includes(email)) throw new HttpError(403, 'Esta cuenta de correo no tiene acceso a la aplicación.');
    return;
  }
  const owner = getSetting('owner_email');
  if (owner && owner !== email) {
    throw new HttpError(403, `Esta aplicación ya está vinculada a ${owner}. Solo esa cuenta puede entrar.`);
  }
  if (!owner) setSetting('owner_email', email);
}

function requireAuth(req, res, next) {
  if (req.session.user) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Sesión caducada. Vuelve a iniciar sesión.' });
  res.redirect('/login');
}

// Intentos de login (protección básica contra fuerza bruta)
const attempts = new Map();
function rateLimit(req, res, next) {
  const key = req.ip;
  const now = Date.now();
  const a = (attempts.get(key) || []).filter((t) => now - t < 15 * 60 * 1000);
  if (a.length >= 10) return res.status(429).json({ error: 'Demasiados intentos. Espera unos minutos.' });
  a.push(now);
  attempts.set(key, a);
  next();
}

function loginUser(req, { email, name, method }) {
  return new Promise((resolve, reject) =>
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.user = { email, name, method };
      req.session.save((e) => (e ? reject(e) : resolve()));
    })
  );
}

// ----------------------------------------------------------------- Autenticación

app.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/');
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

app.get('/auth/options', (req, res) => {
  res.json({ microsoft: mail.microsoftEnabled(), owner: getSetting('owner_email') || null });
});

app.get('/auth/smtp-preset', (req, res) => {
  res.json(mail.smtpPreset(String(req.query.email || '')) || null);
});

app.post(
  '/auth/smtp',
  rateLimit,
  wrap(async (req, res) => {
    const email = str(req.body.email, 254).toLowerCase();
    const password = String(req.body.password || '');
    if (!mail.EMAIL_RE.test(email) || !password) throw new HttpError(400, 'Escribe tu correo y contraseña.');
    checkAllowedReadOnly(email);
    const preset = mail.smtpPreset(email);
    const smtp = req.body.host
      ? { host: str(req.body.host, 200), port: num(req.body.port, 587), secure: !!req.body.secure }
      : preset;
    if (!smtp) throw new HttpError(400, 'No conozco el servidor de tu correo. Pulsa "Opciones avanzadas" e indica el servidor SMTP.');
    try {
      await mail.verifySmtp({ ...smtp, user: email, pass: password });
    } catch (err) {
      const msg = /535|534|auth|Invalid login|Username and Password/i.test(err.message)
        ? 'El servidor de correo rechazó el usuario o la contraseña. Si usas Gmail u Outlook con verificación en dos pasos necesitas una "contraseña de aplicación".'
        : `No se pudo conectar con ${smtp.host}: ${err.message}`;
      throw new HttpError(401, msg);
    }
    checkAllowed(email);
    mail.saveAccount({ email, name: str(req.body.name, 100) || getSetting('empresa.nombre'), method: 'smtp', smtp, secret: password });
    await loginUser(req, { email, name: '', method: 'smtp' });
    res.json({ ok: true });
  })
);

// Comprueba el acceso sin registrar al dueño (se registra tras validar la contraseña).
function checkAllowedReadOnly(email) {
  const list = allowedEmails();
  if (list.length && !list.includes(email)) throw new HttpError(403, 'Esta cuenta de correo no tiene acceso a la aplicación.');
  const owner = getSetting('owner_email');
  if (!list.length && owner && owner !== email) {
    throw new HttpError(403, `Esta aplicación ya está vinculada a ${owner}. Solo esa cuenta puede entrar.`);
  }
}

app.get('/auth/microsoft', (req, res) => {
  if (!mail.microsoftEnabled()) return res.redirect('/login?error=' + encodeURIComponent('Microsoft no está configurado (MS_CLIENT_ID / MS_CLIENT_SECRET).'));
  const url = mail.msAuthorizeUrl(req);
  req.session.save(() => res.redirect(url));
});

app.get('/auth/microsoft/callback', async (req, res) => {
  try {
    const { email, name, refreshToken } = await mail.msHandleCallback(req);
    checkAllowed(email);
    mail.saveAccount({ email, name, method: 'microsoft', secret: refreshToken });
    await loginUser(req, { email, name, method: 'microsoft' });
    res.redirect('/');
  } catch (err) {
    res.redirect('/login?error=' + encodeURIComponent(err.message));
  }
});

app.post('/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.clearCookie('facturas.sid');
    res.json({ ok: true });
  });
});

// Archivos estáticos (login.css, etc.) sin sesión; la app requiere sesión.
app.use('/static', express.static(path.join(__dirname, 'public', 'static')));

// A partir de aquí, todo requiere sesión.
app.use(requireAuth);

// Protección CSRF adicional: las peticiones de escritura deben venir de la propia app.
app.use('/api', (req, res, next) => {
  if (['GET', 'HEAD'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'facturas') return res.status(403).json({ error: 'Petición no permitida.' });
  next();
});

app.get('/api/me', (req, res) => {
  const acc = mail.getAccount(req.session.user.email);
  res.json({ ...req.session.user, name: acc?.name || req.session.user.name, smtp_host: acc?.smtp_host || null });
});

// ------------------------------------------------------------------- Ajustes

app.get(
  '/api/settings',
  wrap(async (req, res) => {
    const s = getAllSettings();
    delete s.owner_email;
    res.json({ settings: s, pdf: !!(await findSoffice()), template: fs.existsSync(TEMPLATE_FILE) ? s['plantilla.nombre'] || 'plantilla.xlsx' : null });
  })
);

app.put('/api/settings', (req, res) => {
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'plantilla.nombre') continue;
    if (key in req.body) setSetting(key, str(req.body[key], 5000));
  }
  res.json({ ok: true });
});

// ------------------------------------------------------------------- Clientes

const CLIENT_FIELDS = ['nombre', 'nif', 'direccion', 'cp', 'ciudad', 'provincia', 'email', 'telefono', 'notas'];

function clientData(body) {
  const d = Object.fromEntries(CLIENT_FIELDS.map((f) => [f, str(body[f], f === 'notas' ? 2000 : 300)]));
  if (!d.nombre) throw new HttpError(400, 'El nombre del cliente es obligatorio.');
  if (d.email && !mail.EMAIL_RE.test(d.email)) throw new HttpError(400, 'El email del cliente no es válido.');
  return d;
}

app.get('/api/clients', (req, res) => {
  res.json(
    db
      .prepare(
        `SELECT c.*, COUNT(i.id) AS facturas, COALESCE(SUM(CASE WHEN i.estado != 'anulada' THEN i.total END), 0) AS facturado
         FROM clients c LEFT JOIN invoices i ON i.client_id = c.id GROUP BY c.id ORDER BY c.nombre COLLATE NOCASE`
      )
      .all()
  );
});

app.post('/api/clients', (req, res) => {
  const d = clientData(req.body);
  const r = db
    .prepare(`INSERT INTO clients (${CLIENT_FIELDS.join(',')}) VALUES (${CLIENT_FIELDS.map(() => '?').join(',')})`)
    .run(...CLIENT_FIELDS.map((f) => d[f]));
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/clients/:id', (req, res) => {
  const d = clientData(req.body);
  db.prepare(`UPDATE clients SET ${CLIENT_FIELDS.map((f) => `${f} = ?`).join(', ')} WHERE id = ?`).run(
    ...CLIENT_FIELDS.map((f) => d[f]),
    Number(req.params.id)
  );
  res.json(db.prepare('SELECT * FROM clients WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/clients/:id', (req, res) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------ Productos

function productData(body) {
  const d = { nombre: str(body.nombre, 500), unidad: str(body.unidad, 20) || 'ud', precio: round2(num(body.precio)) };
  if (!d.nombre) throw new HttpError(400, 'El nombre del producto es obligatorio.');
  return d;
}

app.get('/api/products', (req, res) => {
  res.json(db.prepare('SELECT * FROM products ORDER BY nombre COLLATE NOCASE').all());
});

app.post('/api/products', (req, res) => {
  const d = productData(req.body);
  const r = db.prepare('INSERT INTO products (nombre, unidad, precio) VALUES (?, ?, ?)').run(d.nombre, d.unidad, d.precio);
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/products/:id', (req, res) => {
  const d = productData(req.body);
  db.prepare('UPDATE products SET nombre = ?, unidad = ?, precio = ? WHERE id = ?').run(d.nombre, d.unidad, d.precio, Number(req.params.id));
  res.json(db.prepare('SELECT * FROM products WHERE id = ?').get(Number(req.params.id)));
});

app.delete('/api/products/:id', (req, res) => {
  db.prepare('DELETE FROM products WHERE id = ?').run(Number(req.params.id));
  res.json({ ok: true });
});

// ------------------------------------------------------------------- Facturas

function nextNumber(fecha) {
  const year = (isoDate(fecha) || today()).slice(0, 4);
  const prefix = `${getSetting('factura.prefijo') || ''}${year}-`;
  const digits = Math.min(Math.max(num(getSetting('factura.digitos'), 4), 1), 8);
  let max = 0;
  for (const { numero } of db.prepare('SELECT numero FROM invoices WHERE numero LIKE ?').all(prefix.replace(/[%_]/g, '') + '%')) {
    if (!numero.startsWith(prefix)) continue;
    const n = parseInt(numero.slice(prefix.length), 10);
    if (Number.isFinite(n) && n > max) max = n;
  }
  return prefix + String(max + 1).padStart(digits, '0');
}

function computeInvoice(body) {
  const lines = (Array.isArray(body.lines) ? body.lines : [])
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

  const iva_pct = num(body.iva_pct, 21);
  const irpf_pct = num(body.irpf_pct, 0);
  const base = round2(lines.reduce((s, l) => s + l.importe, 0));
  const iva = round2((base * iva_pct) / 100);
  const irpf = round2((base * irpf_pct) / 100);
  const total = round2(base + iva - irpf);

  const fecha = isoDate(body.fecha) || today();
  const inv = {
    numero: str(body.numero, 50) || nextNumber(fecha),
    fecha,
    vencimiento: isoDate(body.vencimiento),
    client_id: body.client_id ? Number(body.client_id) : null,
    cliente_nombre: str(body.cliente_nombre, 300),
    cliente_nif: str(body.cliente_nif, 50),
    cliente_direccion: str(body.cliente_direccion, 300),
    cliente_cp: str(body.cliente_cp, 20),
    cliente_ciudad: str(body.cliente_ciudad, 100),
    cliente_provincia: str(body.cliente_provincia, 100),
    cliente_email: str(body.cliente_email, 254),
    cliente_telefono: str(body.cliente_telefono, 50),
    forma_pago: str(body.forma_pago, 300),
    notas: str(body.notas, 3000),
    iva_pct,
    irpf_pct,
    base,
    iva,
    irpf,
    total,
    estado: ESTADOS.includes(body.estado) ? body.estado : 'borrador',
  };
  if (!inv.cliente_nombre) throw new HttpError(400, 'Indica el cliente de la factura.');
  return { inv, lines };
}

const INV_FIELDS = [
  'numero', 'fecha', 'vencimiento', 'client_id', 'cliente_nombre', 'cliente_nif', 'cliente_direccion', 'cliente_cp',
  'cliente_ciudad', 'cliente_provincia', 'cliente_email', 'cliente_telefono', 'forma_pago', 'notas', 'iva_pct',
  'irpf_pct', 'base', 'iva', 'irpf', 'total', 'estado',
];

function saveLines(invoiceId, lines) {
  db.prepare('DELETE FROM invoice_lines WHERE invoice_id = ?').run(invoiceId);
  const ins = db.prepare(
    'INSERT INTO invoice_lines (invoice_id, pos, descripcion, cantidad, unidad, precio, descuento, importe) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  lines.forEach((l, i) => ins.run(invoiceId, i, l.descripcion, l.cantidad, l.unidad, l.precio, l.descuento, l.importe));
}

// Guarda el cliente nuevo (o actualiza sus datos) si se marcó la casilla en el formulario.
function upsertClientFromInvoice(inv, body) {
  if (!body.guardar_cliente) return inv.client_id;
  const d = {
    nombre: inv.cliente_nombre, nif: inv.cliente_nif, direccion: inv.cliente_direccion, cp: inv.cliente_cp,
    ciudad: inv.cliente_ciudad, provincia: inv.cliente_provincia, email: inv.cliente_email, telefono: inv.cliente_telefono,
  };
  const keys = Object.keys(d);
  if (inv.client_id && db.prepare('SELECT id FROM clients WHERE id = ?').get(inv.client_id)) {
    db.prepare(`UPDATE clients SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => d[k]), inv.client_id);
    return inv.client_id;
  }
  const r = db.prepare(`INSERT INTO clients (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`).run(...keys.map((k) => d[k]));
  return Number(r.lastInsertRowid);
}

function getInvoice(id) {
  const inv = db.prepare('SELECT * FROM invoices WHERE id = ?').get(Number(id));
  if (!inv) throw new HttpError(404, 'Factura no encontrada.');
  inv.lines = db.prepare('SELECT * FROM invoice_lines WHERE invoice_id = ? ORDER BY pos').all(inv.id);
  inv.emails = db.prepare('SELECT * FROM email_log WHERE invoice_id = ? ORDER BY id DESC').all(inv.id);
  return inv;
}

function uniqueNumberError(err) {
  if (/UNIQUE constraint failed: invoices.numero/.test(err.message)) {
    throw new HttpError(409, 'Ya existe una factura con ese número.');
  }
  throw err;
}

app.get('/api/invoices', (req, res) => {
  const where = [];
  const params = [];
  if (req.query.year) {
    where.push("substr(fecha, 1, 4) = ?");
    params.push(String(req.query.year));
  }
  if (req.query.estado && ESTADOS.includes(req.query.estado)) {
    where.push('estado = ?');
    params.push(req.query.estado);
  }
  if (req.query.q) {
    where.push('(numero LIKE ? OR cliente_nombre LIKE ? OR cliente_nif LIKE ?)');
    const q = `%${String(req.query.q)}%`;
    params.push(q, q, q);
  }
  if (req.query.client_id) {
    where.push('client_id = ?');
    params.push(Number(req.query.client_id));
  }
  const sql = `SELECT id, numero, fecha, vencimiento, client_id, cliente_nombre, cliente_email, base, iva, irpf, total, estado, sent_at, sent_to, paid_at
     FROM invoices ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY fecha DESC, numero DESC`;
  res.json(db.prepare(sql).all(...params));
});

app.get('/api/invoices/years', (req, res) => {
  const years = db.prepare("SELECT DISTINCT substr(fecha, 1, 4) AS y FROM invoices ORDER BY y DESC").all().map((r) => r.y);
  const current = today().slice(0, 4);
  if (!years.includes(current)) years.unshift(current);
  res.json(years);
});

app.get('/api/invoices/next-number', (req, res) => {
  res.json({ numero: nextNumber(req.query.fecha) });
});

app.post('/api/invoices', (req, res) => {
  const { inv, lines } = computeInvoice(req.body);
  let id;
  try {
    id = transaction(() => {
      inv.client_id = upsertClientFromInvoice(inv, req.body);
      const r = db
        .prepare(`INSERT INTO invoices (${INV_FIELDS.join(',')}) VALUES (${INV_FIELDS.map(() => '?').join(',')})`)
        .run(...INV_FIELDS.map((f) => inv[f]));
      saveLines(Number(r.lastInsertRowid), lines);
      return Number(r.lastInsertRowid);
    });
  } catch (err) {
    uniqueNumberError(err);
  }
  res.json(getInvoice(id));
});

app.get('/api/invoices/:id', (req, res) => res.json(getInvoice(req.params.id)));

app.put('/api/invoices/:id', (req, res) => {
  const current = getInvoice(req.params.id);
  const { inv, lines } = computeInvoice({ ...req.body, estado: req.body.estado || current.estado });
  try {
    transaction(() => {
      inv.client_id = upsertClientFromInvoice(inv, req.body);
      db.prepare(`UPDATE invoices SET ${INV_FIELDS.map((f) => `${f} = ?`).join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(
        ...INV_FIELDS.map((f) => inv[f]),
        current.id
      );
      saveLines(current.id, lines);
    });
  } catch (err) {
    uniqueNumberError(err);
  }
  res.json(getInvoice(current.id));
});

app.patch('/api/invoices/:id/estado', (req, res) => {
  const inv = getInvoice(req.params.id);
  const estado = req.body.estado;
  if (!ESTADOS.includes(estado)) throw new HttpError(400, 'Estado no válido.');
  db.prepare(
    `UPDATE invoices SET estado = ?, paid_at = CASE WHEN ? = 'pagada' THEN COALESCE(paid_at, date('now')) ELSE NULL END,
     updated_at = datetime('now') WHERE id = ?`
  ).run(estado, estado, inv.id);
  res.json(getInvoice(inv.id));
});

app.delete('/api/invoices/:id', (req, res) => {
  const inv = getInvoice(req.params.id);
  if (inv.estado !== 'borrador') {
    throw new HttpError(400, 'Solo se pueden borrar borradores. Las facturas emitidas se deben anular para conservar la numeración.');
  }
  db.prepare('DELETE FROM invoices WHERE id = ?').run(inv.id);
  res.json({ ok: true });
});

app.post('/api/invoices/:id/duplicate', (req, res) => {
  const src = getInvoice(req.params.id);
  const fecha = today();
  const copy = { ...src, numero: nextNumber(fecha), fecha, vencimiento: dueDate(fecha), estado: 'borrador' };
  const id = transaction(() => {
    const r = db
      .prepare(`INSERT INTO invoices (${INV_FIELDS.join(',')}) VALUES (${INV_FIELDS.map(() => '?').join(',')})`)
      .run(...INV_FIELDS.map((f) => copy[f] ?? null));
    saveLines(Number(r.lastInsertRowid), src.lines);
    return Number(r.lastInsertRowid);
  });
  res.json(getInvoice(id));
});

function dueDate(fecha) {
  const days = num(getSetting('factura.dias_vencimiento'), 0);
  if (!days) return null;
  const d = new Date(fecha + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

// ---------------------------------------------------------- Excel / PDF / Correo

async function templateBuffer() {
  if (fs.existsSync(TEMPLATE_FILE)) return fs.promises.readFile(TEMPLATE_FILE);
  return buildDefaultTemplate();
}

async function invoiceXlsx(inv) {
  return fillTemplate(await templateBuffer(), inv, inv.lines, getAllSettings());
}

const safeName = (s) => String(s).replace(/[^\w.-]+/g, '_');
const contentDisposition = (type, filename) => `${type}; filename="${safeName(filename)}"`;

app.get(
  '/api/invoices/:id/xlsx',
  wrap(async (req, res) => {
    const inv = getInvoice(req.params.id);
    const buf = await invoiceXlsx(inv);
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', contentDisposition('attachment', `Factura_${inv.numero}.xlsx`));
    res.send(buf);
  })
);

app.get(
  '/api/invoices/:id/pdf',
  wrap(async (req, res) => {
    const inv = getInvoice(req.params.id);
    const pdf = await xlsxToPdf(await invoiceXlsx(inv));
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', contentDisposition(req.query.download ? 'attachment' : 'inline', `Factura_${inv.numero}.pdf`));
    res.send(pdf);
  })
);

app.get(
  '/api/invoices/:id/email-preview',
  wrap(async (req, res) => {
    const inv = getInvoice(req.params.id);
    const values = buildValues(inv, getAllSettings());
    res.json({
      to: inv.cliente_email || '',
      subject: renderText(getSetting('correo.asunto'), values),
      body: renderText(getSetting('correo.cuerpo'), values),
      adjunto: (await findSoffice()) ? getSetting('correo.adjunto') : 'xlsx',
      pdf: !!(await findSoffice()),
    });
  })
);

app.post(
  '/api/invoices/:id/send',
  wrap(async (req, res) => {
    const inv = getInvoice(req.params.id);
    const to = str(req.body.to, 1000);
    const cc = str(req.body.cc, 1000);
    const subject = str(req.body.subject, 500) || `Factura ${inv.numero}`;
    const text = str(req.body.body, 20000);
    const adjunto = ['pdf', 'xlsx', 'ambos'].includes(req.body.adjunto) ? req.body.adjunto : 'pdf';

    const xlsx = await invoiceXlsx(inv);
    const attachments = [];
    if (adjunto !== 'xlsx') {
      attachments.push({ filename: `Factura_${safeName(inv.numero)}.pdf`, content: await xlsxToPdf(xlsx), contentType: 'application/pdf' });
    }
    if (adjunto !== 'pdf') {
      attachments.push({
        filename: `Factura_${safeName(inv.numero)}.xlsx`,
        content: xlsx,
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
    }

    const log = db.prepare('INSERT INTO email_log (invoice_id, to_addr, cc_addr, subject, status, error) VALUES (?, ?, ?, ?, ?, ?)');
    try {
      await mail.sendMail(req.session.user.email, { to, cc, subject, text, attachments, bccSelf: !!req.body.copia });
    } catch (err) {
      log.run(inv.id, to, cc, subject, 'error', err.message);
      throw new HttpError(502, `No se pudo enviar el correo: ${err.message}`);
    }
    log.run(inv.id, to, cc, subject, 'ok', null);
    db.prepare(
      `UPDATE invoices SET sent_at = datetime('now'), sent_to = ?, estado = CASE WHEN estado IN ('borrador', 'emitida') THEN 'enviada' ELSE estado END,
       updated_at = datetime('now') WHERE id = ?`
    ).run(to, inv.id);
    // Guarda el email del cliente si no lo tenía
    if (inv.client_id) {
      db.prepare("UPDATE clients SET email = ? WHERE id = ? AND (email IS NULL OR email = '')").run(to.split(/[;,]/)[0].trim(), inv.client_id);
    }
    res.json(getInvoice(inv.id));
  })
);

// ------------------------------------------------------------------- Plantilla

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

app.get('/api/placeholders', (req, res) => res.json(PLACEHOLDERS));

app.get(
  '/api/template',
  wrap(async (req, res) => {
    const custom = fs.existsSync(TEMPLATE_FILE) && !req.query.default;
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', contentDisposition('attachment', custom ? getSetting('plantilla.nombre') || 'plantilla.xlsx' : 'plantilla-ejemplo.xlsx'));
    res.send(custom ? await fs.promises.readFile(TEMPLATE_FILE) : await buildDefaultTemplate());
  })
);

app.get(
  '/api/template/info',
  wrap(async (req, res) => {
    const custom = fs.existsSync(TEMPLATE_FILE);
    res.json({ custom, nombre: custom ? getSetting('plantilla.nombre') : null, ...(await inspectTemplate(await templateBuffer())) });
  })
);

app.post(
  '/api/template',
  upload.single('plantilla'),
  wrap(async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Selecciona el archivo .xlsx de tu plantilla.');
    if (!/\.xlsx$/i.test(req.file.originalname)) {
      throw new HttpError(400, 'La plantilla debe ser un archivo .xlsx (si es .xls, ábrela en Excel y "Guardar como" .xlsx).');
    }
    let info;
    try {
      info = await inspectTemplate(req.file.buffer);
    } catch {
      throw new HttpError(400, 'No se pudo leer el archivo. ¿Es un Excel .xlsx válido?');
    }
    if (!info.found.length) {
      throw new HttpError(400, 'La plantilla no tiene ningún marcador como {{numero}} o {{cliente.nombre}}. Mira la lista de marcadores y añádelos en las celdas.');
    }
    await fs.promises.writeFile(TEMPLATE_FILE, req.file.buffer);
    setSetting('plantilla.nombre', req.file.originalname);
    res.json({ custom: true, nombre: req.file.originalname, ...info });
  })
);

app.delete('/api/template', (req, res) => {
  if (fs.existsSync(TEMPLATE_FILE)) fs.unlinkSync(TEMPLATE_FILE);
  setSetting('plantilla.nombre', '');
  res.json({ ok: true });
});

// Vista previa con una factura de ejemplo
app.get(
  '/api/template/preview',
  wrap(async (req, res) => {
    const sample = {
      numero: nextNumber(today()), fecha: today(), vencimiento: dueDate(today()),
      cliente_nombre: 'Cliente de Ejemplo S.L.', cliente_nif: 'B12345678', cliente_direccion: 'C/ Mayor 1',
      cliente_cp: '28001', cliente_ciudad: 'Madrid', cliente_provincia: 'Madrid', cliente_email: 'cliente@ejemplo.com',
      forma_pago: getSetting('factura.forma_pago'), notas: 'Factura de ejemplo',
      iva_pct: 21, irpf_pct: 0, base: 190, iva: 39.9, irpf: 0, total: 229.9,
      lines: [
        { descripcion: 'Instalación de punto de luz', cantidad: 4, unidad: 'ud', precio: 35, descuento: 0, importe: 140 },
        { descripcion: 'Cable 2,5 mm²', cantidad: 25, unidad: 'm', precio: 1.2, descuento: 0, importe: 30 },
        { descripcion: 'Mano de obra', cantidad: 1, unidad: 'h', precio: 20, descuento: 0, importe: 20 },
      ],
    };
    const xlsx = await invoiceXlsx(sample);
    if (req.query.format === 'xlsx') {
      res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.set('Content-Disposition', contentDisposition('attachment', 'vista-previa.xlsx'));
      return res.send(xlsx);
    }
    res.set('Content-Type', 'application/pdf');
    res.set('Content-Disposition', 'inline; filename="vista-previa.pdf"');
    res.send(await xlsxToPdf(xlsx));
  })
);

// ------------------------------------------------------- Resumen y exportación

app.get('/api/stats', (req, res) => {
  const year = String(req.query.year || today().slice(0, 4));
  const rows = db
    .prepare(
      `SELECT substr(fecha, 6, 2) AS mes, COUNT(*) AS n, SUM(base) AS base, SUM(iva) AS iva, SUM(irpf) AS irpf, SUM(total) AS total
       FROM invoices WHERE substr(fecha, 1, 4) = ? AND estado NOT IN ('anulada', 'borrador') GROUP BY mes ORDER BY mes`
    )
    .all(year);
  const pendiente = db
    .prepare(
      `SELECT COUNT(*) AS n, COALESCE(SUM(total), 0) AS total FROM invoices WHERE estado IN ('emitida', 'enviada')`
    )
    .get();
  const trimestres = [1, 2, 3, 4].map((t) => {
    const r = rows.filter((x) => Math.ceil(Number(x.mes) / 3) === t);
    const sum = (k) => round2(r.reduce((s, x) => s + (x[k] || 0), 0));
    return { t, n: r.reduce((s, x) => s + x.n, 0), base: sum('base'), iva: sum('iva'), irpf: sum('irpf'), total: sum('total') };
  });
  res.json({ year, meses: rows, trimestres, pendiente });
});

// Libro registro de facturas emitidas (para el gestor / Hacienda)
app.get(
  '/api/export.xlsx',
  wrap(async (req, res) => {
    const year = String(req.query.year || today().slice(0, 4));
    const rows = db.prepare('SELECT * FROM invoices WHERE substr(fecha, 1, 4) = ? ORDER BY fecha, numero').all(year);
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet(`Facturas ${year}`);
    ws.columns = [
      { header: 'Número', key: 'numero', width: 16 },
      { header: 'Fecha', key: 'fecha', width: 12 },
      { header: 'Cliente', key: 'cliente_nombre', width: 32 },
      { header: 'NIF', key: 'cliente_nif', width: 14 },
      { header: 'Base imponible', key: 'base', width: 15, style: { numFmt: '#,##0.00 "€"' } },
      { header: '% IVA', key: 'iva_pct', width: 8 },
      { header: 'Cuota IVA', key: 'iva', width: 13, style: { numFmt: '#,##0.00 "€"' } },
      { header: '% IRPF', key: 'irpf_pct', width: 8 },
      { header: 'Retención IRPF', key: 'irpf', width: 14, style: { numFmt: '#,##0.00 "€"' } },
      { header: 'Total', key: 'total', width: 14, style: { numFmt: '#,##0.00 "€"' } },
      { header: 'Estado', key: 'estado', width: 11 },
      { header: 'Enviada a', key: 'sent_to', width: 28 },
      { header: 'Fecha pago', key: 'paid_at', width: 12 },
    ];
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    for (const r of rows) ws.addRow({ ...r, fecha: fmtDate(r.fecha), paid_at: fmtDate(r.paid_at) });
    if (rows.length) {
      const last = rows.length + 1;
      const t = ws.addRow({ numero: 'TOTAL (sin anuladas)' });
      t.font = { bold: true };
      for (const col of ['E', 'G', 'I', 'J']) {
        t.getCell(col).value = { formula: `SUMIFS(${col}2:${col}${last},K2:K${last},"<>anulada",K2:K${last},"<>borrador")` };
      }
    }
    res.set('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.set('Content-Disposition', contentDisposition('attachment', `Libro_facturas_${year}.xlsx`));
    res.send(Buffer.from(await wb.xlsx.writeBuffer()));
  })
);

// Copia de seguridad de la base de datos
app.get(
  '/api/backup',
  wrap(async (req, res) => {
    const file = path.join(DATA_DIR, `backup-${Date.now()}.db`);
    db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`);
    res.download(file, `facturas-${today()}.db`, () => fs.unlink(file, () => {}));
  })
);

// --------------------------------------------------------------- Front-end

app.use(express.static(path.join(__dirname, 'public'), { index: 'index.html' }));

app.use((req, res) => res.status(404).json({ error: 'No encontrado' }));

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.status || (err.type === 'entity.parse.failed' ? 400 : 500);
  if (status >= 500) console.error(err);
  res.status(status).json({ error: status >= 500 && !err.status ? `Error interno: ${err.message}` : err.message });
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n  Facturas lista en  http://localhost:${PORT}\n`);
    if (!mail.microsoftEnabled()) console.log('  (Inicio con Microsoft desactivado: define MS_CLIENT_ID y MS_CLIENT_SECRET en .env)\n');
  });
}

module.exports = { app, computeInvoice, nextNumber };
