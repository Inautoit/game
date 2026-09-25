// Dashboard Genesys - Worker de Cloudflare
//
//   POST /api/upload   el script del PC sube el paquete de informes (JSON comprimido con gzip).
//                      Cabecera: Authorization: Bearer <UPLOAD_TOKEN>
//   GET  /auth/login   inicio de sesion con Microsoft (Entra ID) -> redirige a Microsoft
//   GET  /auth/callback vuelta de Microsoft: comprueba la cuenta corporativa y crea la sesion
//   POST /api/login    { "clave": "..." } -> sesion con DASHBOARD_PASSWORD (solo si NO hay Microsoft configurado)
//   GET  /api/sesion   { modo: "microsoft" | "clave", usuario }
//   POST /api/logout   borra la cookie
//   GET  /api/datos    devuelve el ultimo paquete (necesita sesion). Soporta ETag / 304.
//                      ?dia=AAAA-MM-DD  el ultimo paquete de ese dia (se guarda uno por dia)
//   GET  /api/dias     dias guardados
//   GET/PUT /api/resumen?clave=...  resumenes pequenos que calcula el navegador (p. ej. de la
//                      competicion TMK) para no volver a descargar dias ya cerrados
//   resto              ficheros estaticos de ./public
//
// Inicio de sesion con Microsoft: se activa al poner los secretos MS_TENANT_ID, MS_CLIENT_ID y
// MS_CLIENT_SECRET (registro de aplicacion en Entra ID). Opcional: ALLOWED_DOMAINS (p. ej.
// "verisure.es,verisure.com") y ALLOWED_EMAILS para limitar mas quien entra. Con Microsoft activo,
// la clave compartida deja de funcionar.
//
// El paquete se guarda tal cual (ya comprimido) en KV: el Worker no lo descomprime ni lo
// procesa, asi que apenas consume CPU. El navegador lo descomprime y calcula el dashboard.

const CLAVE_KV = "paquete";
const MAX_BYTES = 24 * 1024 * 1024; // limite de un valor en KV: 25 MiB
const SESION_DIAS = 30;

const enc = new TextEncoder();

function json(datos, estado = 200, cabeceras = {}) {
  return new Response(JSON.stringify(datos), {
    status: estado,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cabeceras },
  });
}

function iguales(a, b) {
  if (typeof a !== "string" || typeof b !== "string") return false;
  const x = enc.encode(a), y = enc.encode(b);
  let d = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) d |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return d === 0;
}

async function firmar(secreto, texto) {
  const clave = await crypto.subtle.importKey("raw", enc.encode(secreto), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const firma = await crypto.subtle.sign("HMAC", clave, enc.encode(texto));
  return [...new Uint8Array(firma)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function leerCookie(request, nombre) {
  const c = request.headers.get("Cookie") || "";
  for (const parte of c.split(";")) {
    const [k, ...v] = parte.trim().split("=");
    if (k === nombre) return v.join("=");
  }
  return null;
}

const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlTexto = (t) => b64url(enc.encode(t));
const deB64url = (t) => new TextDecoder().decode(Uint8Array.from(atob(t.replace(/-/g, "+").replace(/_/g, "/")), (c) => c.charCodeAt(0)));
const aleatorio = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
const conMicrosoft = (env) => Boolean(env.MS_TENANT_ID && env.MS_CLIENT_ID && env.MS_CLIENT_SECRET);

// Cookie de sesion: <caduca>.<usuario en base64url>.<firma HMAC>
async function leerSesion(request, env) {
  const valor = leerCookie(request, "sesion");
  if (!valor || !env.SESSION_SECRET) return null;
  const partes = valor.split(".");
  if (partes.length !== 3) return null;
  const [caduca, u, firma] = partes;
  if (!caduca || Number(caduca) < Date.now()) return null;
  let usuario;
  try { usuario = deB64url(u); } catch { return null; }
  if (!iguales(firma, await firmar(env.SESSION_SECRET, `sesion:${caduca}:${usuario}`))) return null;
  // con Microsoft activo no valen las sesiones abiertas con la clave compartida
  if (conMicrosoft(env) && !usuario.includes("@")) return null;
  return usuario;
}

async function cookieSesion(env, usuario) {
  const caduca = Date.now() + SESION_DIAS * 86400e3;
  const valor = `${caduca}.${b64urlTexto(usuario)}.${await firmar(env.SESSION_SECRET, `sesion:${caduca}:${usuario}`)}`;
  return `sesion=${valor}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESION_DIAS * 86400}`;
}

function permitido(env, correo) {
  const c = correo.toLowerCase();
  const lista = (x) => String(x || "").toLowerCase().split(/[\s,;]+/).filter(Boolean);
  const correos = lista(env.ALLOWED_EMAILS), dominios = lista(env.ALLOWED_DOMAINS);
  if (!correos.length && !dominios.length) return true; // basta con ser de la organizacion (tenant)
  return correos.includes(c) || dominios.some((d) => c.endsWith("@" + d.replace(/^@/, "")));
}

function redirigir(destino, cookies = []) {
  const h = new Headers({ Location: destino, "Cache-Control": "no-store" });
  for (const c of cookies) h.append("Set-Cookie", c);
  return new Response(null, { status: 302, headers: h });
}
const errorLogin = (msg) => redirigir("/?error=" + encodeURIComponent(msg), ["oauth=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);

async function msLogin(request, env) {
  if (!conMicrosoft(env)) return redirigir("/");
  const url = new URL(request.url);
  const estado = aleatorio(), nonce = aleatorio(), verificador = aleatorio(48);
  const reto = b64url(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(verificador))));
  const v = url.searchParams.get("volver") || "/";
  const volver = /^\/[a-z0-9_-]*$/i.test(v) ? v : "/"; // solo rutas de esta web
  const datos = b64urlTexto(JSON.stringify({ estado, nonce, verificador, volver, t: Date.now() }));
  const cookie = `oauth=${datos}.${await firmar(env.SESSION_SECRET, "oauth:" + datos)}; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=600`;
  const q = new URLSearchParams({
    client_id: env.MS_CLIENT_ID, response_type: "code", response_mode: "query",
    redirect_uri: url.origin + "/auth/callback", scope: "openid profile email",
    state: estado, nonce, code_challenge: reto, code_challenge_method: "S256", prompt: "select_account",
  });
  return redirigir(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/authorize?${q}`, [cookie]);
}

async function msCallback(request, env) {
  if (!conMicrosoft(env)) return redirigir("/");
  const url = new URL(request.url);
  if (url.searchParams.get("error")) return errorLogin(url.searchParams.get("error_description")?.split("\n")[0] || "Microsoft ha rechazado el inicio de sesión.");
  const [datos, firma] = (leerCookie(request, "oauth") || "").split(".");
  if (!datos || !firma || !iguales(firma, await firmar(env.SESSION_SECRET, "oauth:" + datos))) return errorLogin("La sesión de inicio ha caducado. Vuelve a intentarlo.");
  const o = JSON.parse(deB64url(datos));
  if (Date.now() - o.t > 600e3 || !iguales(url.searchParams.get("state") || "", o.estado)) return errorLogin("La sesión de inicio ha caducado. Vuelve a intentarlo.");

  const r = await fetch(`https://login.microsoftonline.com/${env.MS_TENANT_ID}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.MS_CLIENT_ID, client_secret: env.MS_CLIENT_SECRET, grant_type: "authorization_code",
      code: url.searchParams.get("code") || "", redirect_uri: url.origin + "/auth/callback", code_verifier: o.verificador,
    }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.id_token) return errorLogin("No se ha podido completar el inicio de sesión con Microsoft.");

  // El id_token llega directamente de Microsoft por HTTPS con el secreto del cliente, asi que basta
  // con comprobar que es para esta aplicacion, de esta organizacion, vigente y de este intento.
  let c;
  try { c = JSON.parse(deB64url(tok.id_token.split(".")[1])); } catch { return errorLogin("Respuesta de Microsoft no válida."); }
  const ahora = Date.now() / 1000;
  const tenantOk = /^[0-9a-f-]{36}$/i.test(env.MS_TENANT_ID) ? c.tid === env.MS_TENANT_ID : true;
  if (c.aud !== env.MS_CLIENT_ID || !tenantOk || !(c.exp > ahora) || c.nonce !== o.nonce) return errorLogin("Respuesta de Microsoft no válida.");
  const correo = String(c.email || c.preferred_username || c.upn || "").toLowerCase();
  if (!correo.includes("@")) return errorLogin("Tu cuenta de Microsoft no tiene correo.");
  if (!permitido(env, correo)) return errorLogin(`La cuenta ${correo} no tiene acceso a este dashboard.`);

  return redirigir(o.volver || "/", [await cookieSesion(env, correo), "oauth=; Path=/auth; HttpOnly; Secure; SameSite=Lax; Max-Age=0"]);
}

async function subir(request, env) {
  const auth = request.headers.get("Authorization") || "";
  if (!env.UPLOAD_TOKEN || !iguales(auth, "Bearer " + env.UPLOAD_TOKEN)) return json({ error: "clave de subida incorrecta" }, 401);

  const cuerpo = await request.arrayBuffer();
  const b = new Uint8Array(cuerpo, 0, Math.min(2, cuerpo.byteLength));
  if (cuerpo.byteLength < 20 || b[0] !== 0x1f || b[1] !== 0x8b) return json({ error: "se esperaba un paquete gzip" }, 400);
  if (cuerpo.byteLength > MAX_BYTES) return json({ error: "paquete demasiado grande" }, 413);

  const subido = new Date().toISOString();
  await env.DATA.put(CLAVE_KV, cuerpo, { metadata: { subido, bytes: cuerpo.byteLength } });
  // copia del dia: la ultima subida de cada dia queda guardada (historico para la competicion)
  await env.DATA.put("dia:" + diaMadrid(), cuerpo, { metadata: { subido, bytes: cuerpo.byteLength } });
  return json({ ok: true, subido, bytes: cuerpo.byteLength });
}

function diaMadrid(fecha = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Madrid", year: "numeric", month: "2-digit", day: "2-digit" }).format(fecha);
}

async function dias(request, env) {
  if (!(await leerSesion(request, env))) return json({ error: "sesion" }, 401);
  const lista = [];
  let cursor;
  do {
    const r = await env.DATA.list({ prefix: "dia:", cursor });
    for (const k of r.keys) lista.push({ dia: k.name.slice(4), subido: k.metadata?.subido ?? null });
    cursor = r.list_complete ? null : r.cursor;
  } while (cursor);
  return json({ hoy: diaMadrid(), dias: lista.sort((a, b) => a.dia.localeCompare(b.dia)) });
}

async function resumen(request, env) {
  if (!(await leerSesion(request, env))) return json({ error: "sesion" }, 401);
  const clave = new URL(request.url).searchParams.get("clave") || "";
  if (!/^[a-z0-9_.:-]{3,80}$/i.test(clave)) return json({ error: "clave no valida" }, 400);
  if (request.method === "PUT") {
    const cuerpo = await request.text();
    if (cuerpo.length > 2 * 1024 * 1024) return json({ error: "demasiado grande" }, 413);
    try { JSON.parse(cuerpo); } catch { return json({ error: "no es JSON" }, 400); }
    await env.DATA.put("res:" + clave, cuerpo);
    return json({ ok: true });
  }
  const v = await env.DATA.get("res:" + clave);
  return v ? new Response(v, { headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-cache" } })
           : json({ error: "no existe" }, 404);
}

async function login(request, env) {
  if (conMicrosoft(env)) return json({ error: "usa el inicio de sesión con Microsoft", modo: "microsoft" }, 403);
  let datos = {};
  try { datos = await request.json(); } catch {}
  if (!env.DASHBOARD_PASSWORD || !iguales(String(datos.clave ?? ""), env.DASHBOARD_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800)); // frena intentos a lo bruto
    return json({ error: "clave incorrecta" }, 401);
  }
  return json({ ok: true }, 200, { "Set-Cookie": await cookieSesion(env, "clave") });
}

async function datos(request, env) {
  if (!(await leerSesion(request, env))) return json({ error: "sesion", modo: conMicrosoft(env) ? "microsoft" : "clave" }, 401);
  // ?p=verificacion: paquete aparte con un dia cerrado, para comprobar cifras (no lo toca el PC)
  const q = new URL(request.url).searchParams;
  const dia = q.get("dia");
  if (dia && !/^\d{4}-\d{2}-\d{2}$/.test(dia)) return json({ error: "dia no valido" }, 400);
  const clave = q.get("p") === "verificacion" ? "verificacion" : dia ? "dia:" + dia : CLAVE_KV;
  const { value, metadata } = await env.DATA.getWithMetadata(clave, { type: "stream" });
  if (!value) return json({ error: "todavia no se ha subido ningun informe" }, 404);

  const etag = `"${metadata?.subido ?? "x"}"`;
  if (request.headers.get("If-None-Match") === etag) {
    await value.cancel();
    return new Response(null, { status: 304, headers: { ETag: etag, "Cache-Control": "private, no-cache" } });
  }
  // El paquete ya esta en gzip: se entrega tal cual y el navegador lo descomprime.
  return new Response(value, {
    encodeBody: "manual",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Encoding": "gzip",
      ETag: etag,
      "Cache-Control": "private, no-cache",
      "X-Subido": metadata?.subido ?? "",
    },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const ruta = url.pathname;
    try {
      if (ruta === "/api/upload" && request.method === "POST") return await subir(request, env);
      if (ruta === "/auth/login" && request.method === "GET") return await msLogin(request, env);
      if (ruta === "/auth/callback" && request.method === "GET") return await msCallback(request, env);
      if (ruta === "/api/login" && request.method === "POST") return await login(request, env);
      if (ruta === "/api/sesion" && request.method === "GET")
        return json({ modo: conMicrosoft(env) ? "microsoft" : "clave", usuario: await leerSesion(request, env) });
      if (ruta === "/api/logout" && request.method === "POST")
        return json({ ok: true }, 200, { "Set-Cookie": "sesion=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0" });
      if (ruta === "/api/datos" && request.method === "GET") return await datos(request, env);
      if (ruta === "/api/dias" && request.method === "GET") return await dias(request, env);
      if (ruta === "/api/resumen" && (request.method === "GET" || request.method === "PUT")) return await resumen(request, env);
      if (ruta.startsWith("/api/")) return json({ error: "no encontrado" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: "error interno", detalle: String(e?.message ?? e) }, 500);
    }
  },
};
