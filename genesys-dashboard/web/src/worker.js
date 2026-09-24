// Dashboard Genesys - Worker de Cloudflare
//
//   POST /api/upload   el script del PC sube el paquete de informes (JSON comprimido con gzip).
//                      Cabecera: Authorization: Bearer <UPLOAD_TOKEN>
//   POST /api/login    { "clave": "..." } -> cookie de sesion si coincide con DASHBOARD_PASSWORD
//   POST /api/logout   borra la cookie
//   GET  /api/datos    devuelve el ultimo paquete (necesita sesion). Soporta ETag / 304.
//   resto              ficheros estaticos de ./public
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

async function sesionValida(request, env) {
  const valor = leerCookie(request, "sesion");
  if (!valor || !env.SESSION_SECRET) return false;
  const [caduca, firma] = valor.split(".");
  if (!caduca || !firma || Number(caduca) < Date.now()) return false;
  return iguales(firma, await firmar(env.SESSION_SECRET, "sesion:" + caduca));
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
  return json({ ok: true, subido, bytes: cuerpo.byteLength });
}

async function login(request, env) {
  let datos = {};
  try { datos = await request.json(); } catch {}
  if (!env.DASHBOARD_PASSWORD || !iguales(String(datos.clave ?? ""), env.DASHBOARD_PASSWORD)) {
    await new Promise((r) => setTimeout(r, 800)); // frena intentos a lo bruto
    return json({ error: "clave incorrecta" }, 401);
  }
  const caduca = Date.now() + SESION_DIAS * 86400e3;
  const valor = caduca + "." + (await firmar(env.SESSION_SECRET, "sesion:" + caduca));
  return json({ ok: true }, 200, {
    "Set-Cookie": `sesion=${valor}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESION_DIAS * 86400}`,
  });
}

async function datos(request, env) {
  if (!(await sesionValida(request, env))) return json({ error: "sesion" }, 401);
  const { value, metadata } = await env.DATA.getWithMetadata(CLAVE_KV, { type: "stream" });
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
      if (ruta === "/api/login" && request.method === "POST") return await login(request, env);
      if (ruta === "/api/logout" && request.method === "POST")
        return json({ ok: true }, 200, { "Set-Cookie": "sesion=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0" });
      if (ruta === "/api/datos" && request.method === "GET") return await datos(request, env);
      if (ruta.startsWith("/api/")) return json({ error: "no encontrado" }, 404);
      return env.ASSETS.fetch(request);
    } catch (e) {
      return json({ error: "error interno", detalle: String(e?.message ?? e) }, 500);
    }
  },
};
