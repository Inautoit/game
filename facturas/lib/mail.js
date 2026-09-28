'use strict';
// Inicio de sesión con la cuenta de correo y envío de facturas.
//
// Dos formas de conectar tu correo:
//  1) Microsoft (Outlook / Hotmail / Live / Office 365) con OAuth: botón
//     "Iniciar sesión con Microsoft". Los correos se envían con Microsoft Graph
//     y quedan guardados en tu carpeta "Enviados".
//  2) Correo + contraseña (SMTP): Gmail, Yahoo, iCloud, IONOS, etc. Para Gmail
//     hay que usar una "contraseña de aplicación".
const crypto = require('node:crypto');
const nodemailer = require('nodemailer');
const { db } = require('./db');
const { encrypt, decrypt } = require('./crypto');

// ---------------------------------------------------------------- SMTP ---------

const SMTP_PRESETS = [
  { match: /^(gmail|googlemail)\.com$/, host: 'smtp.gmail.com', port: 465, secure: true },
  { match: /^(outlook|hotmail|live|msn)\.[a-z.]+$/, host: 'smtp-mail.outlook.com', port: 587, secure: false },
  { match: /^yahoo\.[a-z.]+$/, host: 'smtp.mail.yahoo.com', port: 465, secure: true },
  { match: /^(icloud|me|mac)\.com$/, host: 'smtp.mail.me.com', port: 587, secure: false },
  { match: /^(gmx)\.[a-z.]+$/, host: 'mail.gmx.com', port: 587, secure: false },
  { match: /^zoho(mail)?\.[a-z.]+$/, host: 'smtp.zoho.eu', port: 465, secure: true },
];

function smtpPreset(email) {
  const domain = String(email).split('@')[1]?.toLowerCase() || '';
  const p = SMTP_PRESETS.find((x) => x.match.test(domain));
  return p ? { host: p.host, port: p.port, secure: p.secure } : null;
}

function smtpTransport({ host, port, secure, user, pass }) {
  return nodemailer.createTransport({
    host,
    port: Number(port),
    secure: !!secure,
    auth: { user, pass },
    connectionTimeout: 20000,
  });
}

async function verifySmtp(cfg) {
  const t = smtpTransport(cfg);
  try {
    await t.verify();
  } finally {
    t.close();
  }
}

// ----------------------------------------------------------- Microsoft ---------

const MS_TENANT = process.env.MS_TENANT || 'common';
const MS_SCOPES = 'openid profile email offline_access User.Read Mail.Send';
const msAuthority = `https://login.microsoftonline.com/${MS_TENANT}/oauth2/v2.0`;

function microsoftEnabled() {
  return !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
}

function msRedirectUri(req) {
  return process.env.MS_REDIRECT_URI || `${req.protocol}://${req.get('host')}/auth/microsoft/callback`;
}

function msAuthorizeUrl(req) {
  const state = crypto.randomBytes(16).toString('hex');
  req.session.oauthState = state;
  const params = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID,
    response_type: 'code',
    redirect_uri: msRedirectUri(req),
    response_mode: 'query',
    scope: MS_SCOPES,
    state,
    prompt: 'select_account',
  });
  return `${msAuthority}/authorize?${params}`;
}

async function msToken(body) {
  const res = await fetch(`${msAuthority}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.MS_CLIENT_ID,
      client_secret: process.env.MS_CLIENT_SECRET,
      scope: MS_SCOPES,
      ...body,
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Error al obtener el token de Microsoft');
  return data;
}

// Intercambia el código de autorización y devuelve { email, name, refreshToken }.
async function msHandleCallback(req) {
  const { code, state, error, error_description: desc } = req.query;
  if (error) throw new Error(desc || error);
  if (!state || state !== req.session.oauthState) throw new Error('Estado OAuth no válido. Vuelve a intentarlo.');
  delete req.session.oauthState;
  const tok = await msToken({ grant_type: 'authorization_code', code, redirect_uri: msRedirectUri(req) });
  const me = await fetch('https://graph.microsoft.com/v1.0/me', {
    headers: { Authorization: `Bearer ${tok.access_token}` },
  }).then((r) => r.json());
  const email = (me.mail || me.userPrincipalName || '').toLowerCase();
  if (!email) throw new Error('No se pudo leer el correo de la cuenta de Microsoft.');
  return { email, name: me.displayName || '', refreshToken: tok.refresh_token };
}

async function msAccessToken(account) {
  const tok = await msToken({ grant_type: 'refresh_token', refresh_token: decrypt(account.secret_enc) });
  if (tok.refresh_token) {
    db.prepare('UPDATE account SET secret_enc = ?, updated_at = datetime(\'now\') WHERE email = ?').run(
      encrypt(tok.refresh_token),
      account.email
    );
  }
  return tok.access_token;
}

// ------------------------------------------------------------- Cuenta ---------

function saveAccount({ email, name, method, smtp, secret }) {
  db.prepare(
    `INSERT INTO account (email, name, method, smtp_host, smtp_port, smtp_secure, secret_enc, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
     ON CONFLICT(email) DO UPDATE SET name = excluded.name, method = excluded.method, smtp_host = excluded.smtp_host,
       smtp_port = excluded.smtp_port, smtp_secure = excluded.smtp_secure, secret_enc = excluded.secret_enc,
       updated_at = excluded.updated_at`
  ).run(email, name || '', method, smtp?.host || null, smtp?.port || null, smtp?.secure ? 1 : 0, encrypt(secret));
}

function getAccount(email) {
  return db.prepare('SELECT * FROM account WHERE email = ?').get(email);
}

// ------------------------------------------------------------- Envío ----------

function parseAddresses(str) {
  return String(str || '')
    .split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

const EMAIL_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

// attachments: [{ filename, content: Buffer, contentType }]
async function sendMail(accountEmail, { to, cc, subject, text, attachments, bccSelf }) {
  const account = getAccount(accountEmail);
  if (!account) throw new Error('No hay ninguna cuenta de correo conectada. Vuelve a iniciar sesión.');
  const toList = parseAddresses(to);
  const ccList = parseAddresses(cc);
  if (!toList.length) throw new Error('Indica al menos un destinatario.');
  for (const a of [...toList, ...ccList]) if (!EMAIL_RE.test(a)) throw new Error(`Dirección de correo no válida: ${a}`);

  if (account.method === 'microsoft') {
    const token = await msAccessToken(account);
    const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: {
          subject,
          body: { contentType: 'Text', content: text },
          toRecipients: toList.map((address) => ({ emailAddress: { address } })),
          ccRecipients: ccList.map((address) => ({ emailAddress: { address } })),
          bccRecipients: bccSelf ? [{ emailAddress: { address: account.email } }] : [],
          attachments: attachments.map((a) => ({
            '@odata.type': '#microsoft.graph.fileAttachment',
            name: a.filename,
            contentType: a.contentType,
            contentBytes: a.content.toString('base64'),
          })),
        },
        saveToSentItems: true,
      }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `Microsoft respondió ${res.status}`);
    }
    return;
  }

  const transport = smtpTransport({
    host: account.smtp_host,
    port: account.smtp_port,
    secure: !!account.smtp_secure,
    user: account.email,
    pass: decrypt(account.secret_enc),
  });
  try {
    await transport.sendMail({
      from: account.name ? { name: account.name, address: account.email } : account.email,
      to: toList,
      cc: ccList.length ? ccList : undefined,
      bcc: bccSelf ? account.email : undefined,
      subject,
      text,
      attachments,
    });
  } finally {
    transport.close();
  }
}

module.exports = {
  smtpPreset,
  verifySmtp,
  microsoftEnabled,
  msAuthorizeUrl,
  msHandleCallback,
  saveAccount,
  getAccount,
  sendMail,
  EMAIL_RE,
};
