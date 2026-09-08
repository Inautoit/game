/**
 * Buscador de clientes de baja — Cloudflare Worker + D1.
 *
 * Rutas de la API (todo bajo /api). Los archivos estáticos de /public los
 * sirve la plataforma directamente (ver wrangler.toml).
 */

import {
  COOKIE,
  cookieBorrado,
  cookieSesion,
  crearToken,
  hashPassword,
  leerCookie,
  leerToken,
  verificarPassword,
} from './auth.js';
import { colapsar, escaparLike, palabras, tokenizar } from './texto.js';

const MAX_FILAS_LOTE = 500;
const MAX_RESULTADOS = 50;
const MAX_INTENTOS = 8;
const VENTANA_INTENTOS_S = 15 * 60;

/* ------------------------------------------------------------------ */
/* Respuestas                                                          */
/* ------------------------------------------------------------------ */

function json(datos, opciones = {}) {
  const cabeceras = new Headers(opciones.headers || {});
  cabeceras.set('Content-Type', 'application/json; charset=utf-8');
  cabeceras.set('Cache-Control', 'no-store');
  cabeceras.set('X-Content-Type-Options', 'nosniff');
  cabeceras.set('Referrer-Policy', 'same-origin');
  return new Response(JSON.stringify(datos), { status: opciones.status || 200, headers: cabeceras });
}

function error(mensaje, status = 400, extra = {}) {
  return json({ error: mensaje, ...extra }, { status });
}

/* ------------------------------------------------------------------ */
/* Sesión                                                              */
/* ------------------------------------------------------------------ */

function secreto(env) {
  return env.AUTH_SECRET || 'verisure-secreto-por-defecto-cambiar';
}

function esHttps(request) {
  return new URL(request.url).protocol === 'https:';
}

async function sesionDe(request, env) {
  return leerToken(secreto(env), leerCookie(request, COOKIE));
}

/* ------------------------------------------------------------------ */
/* Preparación de un registro para búsqueda                            */
/* ------------------------------------------------------------------ */

function prepararRegistro(columnas, fila) {
  const datos = {};
  const norm = {};
  const normTxt = {};
  const trozosColapsados = [];
  const trozosTexto = [];

  columnas.forEach((columna, i) => {
    const valor = fila[i] === undefined || fila[i] === null ? '' : String(fila[i]).trim();
    datos[columna] = valor;
    const c = colapsar(valor);
    const t = tokenizar(valor);
    norm[columna] = c;
    normTxt[columna] = t;
    if (c) trozosColapsados.push(c);
    if (t) trozosTexto.push(t);
  });

  return {
    datos: JSON.stringify(datos),
    norm: JSON.stringify(norm),
    normTxt: JSON.stringify(normTxt),
    busqueda: trozosColapsados.join(' '),
    busquedaTxt: trozosTexto.join(' '),
  };
}

/** Ruta JSON segura para json_extract, p. ej. $."Nº instalación". */
function rutaJson(columna) {
  return '$."' + String(columna).replace(/"/g, '\\"') + '"';
}

/* ------------------------------------------------------------------ */
/* Construcción del WHERE de búsqueda                                  */
/* ------------------------------------------------------------------ */

function condicionBusqueda(consulta, campo) {
  const colapsada = colapsar(consulta);
  const tokens = palabras(consulta);
  if (!colapsada && tokens.length === 0) return null;

  const alternativas = [];
  const params = [];

  if (campo) {
    const ruta = rutaJson(campo);
    if (colapsada) {
      alternativas.push("json_extract(r.norm, ?) LIKE ? ESCAPE '\\'");
      params.push(ruta, `%${escaparLike(colapsada)}%`);
    }
    if (tokens.length > 1) {
      const trozos = tokens.map(() => "json_extract(r.norm_txt, ?) LIKE ? ESCAPE '\\'");
      for (const token of tokens) params.push(ruta, `%${escaparLike(token)}%`);
      alternativas.push('(' + trozos.join(' AND ') + ')');
    }
  } else {
    if (colapsada) {
      alternativas.push("r.busqueda LIKE ? ESCAPE '\\'");
      params.push(`%${escaparLike(colapsada)}%`);
    }
    if (tokens.length > 1) {
      const trozos = tokens.map(() => "r.busqueda_txt LIKE ? ESCAPE '\\'");
      for (const token of tokens) params.push(`%${escaparLike(token)}%`);
      alternativas.push('(' + trozos.join(' AND ') + ')');
    }
  }

  if (alternativas.length === 0) return null;
  return { sql: '(' + alternativas.join(' OR ') + ')', params };
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

async function manejarApi(request, env, url) {
  const ruta = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = request.method.toUpperCase();
  const sesion = await sesionDe(request, env);

  /* --- login --- */
  if (ruta === '/login' && metodo === 'POST') {
    const cuerpo = await leerJson(request);
    const usuario = String(cuerpo?.usuario || '').trim().toLowerCase();
    const password = String(cuerpo?.password || '');
    if (!usuario || !password) return error('Introduce usuario y contraseña.', 400);

    const ip = request.headers.get('CF-Connecting-IP') || 'desconocida';
    const ahora = Math.floor(Date.now() / 1000);
    const desde = ahora - VENTANA_INTENTOS_S;
    const fallos = await env.DB.prepare(
      'SELECT COUNT(*) AS n FROM intentos WHERE ts > ? AND (usuario = ? OR ip = ?)',
    )
      .bind(desde, usuario, ip)
      .first();
    if ((fallos?.n || 0) >= MAX_INTENTOS) {
      return error('Demasiados intentos fallidos. Espera 15 minutos.', 429);
    }

    const fila = await env.DB.prepare(
      'SELECT id, usuario, nombre, rol, hash, activo FROM usuarios WHERE usuario = ?',
    )
      .bind(usuario)
      .first();

    const correcta = fila && fila.activo === 1 && (await verificarPassword(password, fila.hash));
    if (!correcta) {
      await env.DB.prepare('INSERT INTO intentos (usuario, ip, ts) VALUES (?, ?, ?)')
        .bind(usuario, ip, ahora)
        .run();
      return error('Usuario o contraseña incorrectos.', 401);
    }

    await env.DB.prepare('DELETE FROM intentos WHERE usuario = ? OR ip = ?').bind(usuario, ip).run();
    await env.DB.prepare('DELETE FROM intentos WHERE ts < ?').bind(desde).run();

    const token = await crearToken(secreto(env), fila);
    return json(
      { usuario: { usuario: fila.usuario, nombre: fila.nombre, rol: fila.rol } },
      { headers: { 'Set-Cookie': cookieSesion(token, esHttps(request)) } },
    );
  }

  if (ruta === '/logout' && metodo === 'POST') {
    return json({ ok: true }, { headers: { 'Set-Cookie': cookieBorrado(esHttps(request)) } });
  }

  if (ruta === '/sesion' && metodo === 'GET') {
    if (!sesion) return json({ usuario: null });
    return json({ usuario: { usuario: sesion.usuario, nombre: sesion.nombre, rol: sesion.rol } });
  }

  /* A partir de aquí hace falta haber iniciado sesión. */
  if (!sesion) return error('Sesión no iniciada o caducada.', 401);

  /* --- estado general --- */
  if (ruta === '/estado' && metodo === 'GET') {
    const totales = await env.DB.prepare(
      `SELECT (SELECT COUNT(*) FROM registros r
                 JOIN importaciones i ON i.id = r.importacion_id
                WHERE i.estado = 'activa') AS registros,
              (SELECT COUNT(*) FROM importaciones WHERE estado = 'activa') AS importaciones`,
    ).first();
    const ultima = await env.DB.prepare(
      `SELECT archivo, filas, usuario, creado_en FROM importaciones
        WHERE estado = 'activa' ORDER BY id DESC LIMIT 1`,
    ).first();
    const campos = await columnasActivas(env);
    return json({
      registros: totales?.registros || 0,
      importaciones: totales?.importaciones || 0,
      ultima: ultima || null,
      campos,
      avisoSecreto: sesion.rol === 'admin' && !env.AUTH_SECRET,
    });
  }

  /* --- búsqueda --- */
  if (ruta === '/buscar' && metodo === 'GET') {
    const consulta = url.searchParams.get('q') || '';
    const campo = url.searchParams.get('campo') || '';
    const pagina = Math.max(1, Number(url.searchParams.get('pagina') || 1) || 1);

    const condicion = condicionBusqueda(consulta, campo);
    if (!condicion) return json({ total: 0, pagina: 1, paginas: 0, resultados: [], campos: [] });

    const base = `FROM registros r JOIN importaciones i ON i.id = r.importacion_id
                  WHERE i.estado = 'activa' AND ${condicion.sql}`;

    const cuenta = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
      .bind(...condicion.params)
      .first();
    const total = cuenta?.n || 0;

    const filas = await env.DB.prepare(
      `SELECT r.id, r.datos, i.archivo, i.creado_en ${base} ORDER BY r.id LIMIT ? OFFSET ?`,
    )
      .bind(...condicion.params, MAX_RESULTADOS, (pagina - 1) * MAX_RESULTADOS)
      .all();

    const resultados = (filas.results || []).map((f) => ({
      id: f.id,
      origen: f.archivo,
      importado: f.creado_en,
      datos: JSON.parse(f.datos),
    }));

    return json({
      total,
      pagina,
      paginas: Math.ceil(total / MAX_RESULTADOS),
      porPagina: MAX_RESULTADOS,
      resultados,
      campos: await columnasActivas(env),
    });
  }

  /* --- importaciones (solo administradores) --- */
  if (ruta === '/importaciones' && metodo === 'GET') {
    exigirAdmin(sesion);
    const filas = await env.DB.prepare(
      `SELECT id, archivo, filas, modo, estado, usuario, creado_en, columnas
         FROM importaciones ORDER BY id DESC LIMIT 50`,
    ).all();
    return json({
      importaciones: (filas.results || []).map((f) => ({
        ...f,
        columnas: JSON.parse(f.columnas),
      })),
    });
  }

  if (ruta === '/importaciones' && metodo === 'POST') {
    exigirAdmin(sesion);
    const cuerpo = await leerJson(request);
    const archivo = String(cuerpo?.archivo || 'importacion.csv').slice(0, 200);
    const modo = cuerpo?.modo === 'anadir' ? 'anadir' : 'reemplazar';
    const columnas = Array.isArray(cuerpo?.columnas)
      ? cuerpo.columnas.map((c) => String(c).trim()).filter(Boolean)
      : [];
    if (columnas.length === 0) return error('El CSV no tiene columnas en la primera fila.', 400);
    if (new Set(columnas).size !== columnas.length) {
      return error('Hay nombres de columna repetidos en la cabecera del CSV.', 400);
    }

    const res = await env.DB.prepare(
      `INSERT INTO importaciones (archivo, columnas, modo, estado, usuario)
       VALUES (?, ?, ?, 'pendiente', ?)`,
    )
      .bind(archivo, JSON.stringify(columnas), modo, sesion.usuario)
      .run();
    return json({ id: res.meta.last_row_id, columnas, modo });
  }

  let m = ruta.match(/^\/importaciones\/(\d+)\/filas$/);
  if (m && metodo === 'POST') {
    exigirAdmin(sesion);
    const id = Number(m[1]);
    const importacion = await env.DB.prepare(
      'SELECT id, columnas, estado FROM importaciones WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!importacion) return error('La importación no existe.', 404);
    if (importacion.estado !== 'pendiente') return error('La importación ya está cerrada.', 409);

    const cuerpo = await leerJson(request);
    const filas = Array.isArray(cuerpo?.filas) ? cuerpo.filas : [];
    if (filas.length === 0) return json({ insertadas: 0 });
    if (filas.length > MAX_FILAS_LOTE) return error(`Máximo ${MAX_FILAS_LOTE} filas por lote.`, 413);

    const columnas = JSON.parse(importacion.columnas);
    const insertar = env.DB.prepare(
      `INSERT INTO registros (importacion_id, datos, norm, norm_txt, busqueda, busqueda_txt)
       VALUES (?, ?, ?, ?, ?, ?)`,
    );
    const sentencias = [];
    for (const fila of filas) {
      if (!Array.isArray(fila)) continue;
      const p = prepararRegistro(columnas, fila);
      if (!p.busqueda) continue; // fila totalmente vacía
      sentencias.push(insertar.bind(id, p.datos, p.norm, p.normTxt, p.busqueda, p.busquedaTxt));
    }
    if (sentencias.length > 0) await env.DB.batch(sentencias);
    await env.DB.prepare('UPDATE importaciones SET filas = filas + ? WHERE id = ?')
      .bind(sentencias.length, id)
      .run();
    return json({ insertadas: sentencias.length });
  }

  m = ruta.match(/^\/importaciones\/(\d+)\/finalizar$/);
  if (m && metodo === 'POST') {
    exigirAdmin(sesion);
    const id = Number(m[1]);
    const importacion = await env.DB.prepare(
      'SELECT id, modo, filas, estado FROM importaciones WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!importacion) return error('La importación no existe.', 404);
    if (importacion.estado !== 'pendiente') return error('La importación ya está cerrada.', 409);
    if (importacion.filas === 0) {
      await borrarImportacion(env, id);
      return error('El CSV no contenía ninguna fila de datos.', 400);
    }

    if (importacion.modo === 'reemplazar') {
      const antiguas = await env.DB.prepare('SELECT id FROM importaciones WHERE id != ?')
        .bind(id)
        .all();
      for (const fila of antiguas.results || []) await borrarImportacion(env, fila.id);
    }
    await env.DB.prepare("UPDATE importaciones SET estado = 'activa' WHERE id = ?").bind(id).run();
    return json({ ok: true, filas: importacion.filas });
  }

  m = ruta.match(/^\/importaciones\/(\d+)$/);
  if (m && metodo === 'DELETE') {
    exigirAdmin(sesion);
    await borrarImportacion(env, Number(m[1]));
    return json({ ok: true });
  }

  /* --- usuarios (solo administradores) --- */
  if (ruta === '/usuarios' && metodo === 'GET') {
    exigirAdmin(sesion);
    const filas = await env.DB.prepare(
      'SELECT id, usuario, nombre, rol, activo, creado_en FROM usuarios ORDER BY id',
    ).all();
    return json({ usuarios: filas.results || [] });
  }

  if (ruta === '/usuarios' && metodo === 'POST') {
    exigirAdmin(sesion);
    const cuerpo = await leerJson(request);
    const usuario = String(cuerpo?.usuario || '').trim().toLowerCase();
    const nombre = String(cuerpo?.nombre || '').trim() || usuario;
    const rol = cuerpo?.rol === 'admin' ? 'admin' : 'usuario';
    const password = String(cuerpo?.password || '');
    if (!/^[a-z0-9._-]{3,40}$/.test(usuario)) {
      return error('El usuario debe tener entre 3 y 40 caracteres (letras, números . _ -).', 400);
    }
    const problema = validarPassword(password);
    if (problema) return error(problema, 400);

    const existe = await env.DB.prepare('SELECT id FROM usuarios WHERE usuario = ?')
      .bind(usuario)
      .first();
    if (existe) return error('Ya existe un usuario con ese nombre.', 409);

    await env.DB.prepare(
      'INSERT INTO usuarios (usuario, nombre, rol, hash, activo) VALUES (?, ?, ?, ?, 1)',
    )
      .bind(usuario, nombre, rol, await hashPassword(password))
      .run();
    return json({ ok: true });
  }

  m = ruta.match(/^\/usuarios\/(\d+)$/);
  if (m && metodo === 'PATCH') {
    exigirAdmin(sesion);
    const id = Number(m[1]);
    const cuerpo = await leerJson(request);
    const destino = await env.DB.prepare('SELECT id, usuario, rol, activo FROM usuarios WHERE id = ?')
      .bind(id)
      .first();
    if (!destino) return error('El usuario no existe.', 404);

    if (cuerpo?.password !== undefined) {
      const problema = validarPassword(String(cuerpo.password));
      if (problema) return error(problema, 400);
      await env.DB.prepare('UPDATE usuarios SET hash = ? WHERE id = ?')
        .bind(await hashPassword(String(cuerpo.password)), id)
        .run();
    }
    if (cuerpo?.nombre !== undefined) {
      await env.DB.prepare('UPDATE usuarios SET nombre = ? WHERE id = ?')
        .bind(String(cuerpo.nombre).trim() || destino.usuario, id)
        .run();
    }
    if (cuerpo?.rol !== undefined || cuerpo?.activo !== undefined) {
      const rol = cuerpo?.rol === undefined ? destino.rol : cuerpo.rol === 'admin' ? 'admin' : 'usuario';
      const activo = cuerpo?.activo === undefined ? destino.activo : cuerpo.activo ? 1 : 0;
      if (destino.id === sesion.id && (rol !== 'admin' || activo !== 1)) {
        return error('No puedes quitarte a ti mismo el acceso de administrador.', 400);
      }
      if (destino.rol === 'admin' && (rol !== 'admin' || activo !== 1) && (await adminsActivos(env)) <= 1) {
        return error('Debe quedar al menos un administrador activo.', 400);
      }
      await env.DB.prepare('UPDATE usuarios SET rol = ?, activo = ? WHERE id = ?')
        .bind(rol, activo, id)
        .run();
    }
    return json({ ok: true });
  }

  if (m && metodo === 'DELETE') {
    exigirAdmin(sesion);
    const id = Number(m[1]);
    if (id === sesion.id) return error('No puedes eliminar tu propio usuario.', 400);
    const destino = await env.DB.prepare('SELECT rol FROM usuarios WHERE id = ?').bind(id).first();
    if (!destino) return error('El usuario no existe.', 404);
    if (destino.rol === 'admin' && (await adminsActivos(env)) <= 1) {
      return error('Debe quedar al menos un administrador activo.', 400);
    }
    await env.DB.prepare('DELETE FROM usuarios WHERE id = ?').bind(id).run();
    return json({ ok: true });
  }

  /* --- cambio de la propia contraseña --- */
  if (ruta === '/password' && metodo === 'POST') {
    const cuerpo = await leerJson(request);
    const actual = String(cuerpo?.actual || '');
    const nueva = String(cuerpo?.nueva || '');
    const problema = validarPassword(nueva);
    if (problema) return error(problema, 400);

    const fila = await env.DB.prepare('SELECT hash FROM usuarios WHERE id = ?')
      .bind(sesion.id)
      .first();
    if (!fila || !(await verificarPassword(actual, fila.hash))) {
      return error('La contraseña actual no es correcta.', 401);
    }
    await env.DB.prepare('UPDATE usuarios SET hash = ? WHERE id = ?')
      .bind(await hashPassword(nueva), sesion.id)
      .run();
    return json({ ok: true });
  }

  return error('Ruta no encontrada.', 404);
}

/* ------------------------------------------------------------------ */
/* Ayudantes                                                           */
/* ------------------------------------------------------------------ */

class ErrorHttp extends Error {
  constructor(mensaje, status) {
    super(mensaje);
    this.status = status;
  }
}

function exigirAdmin(sesion) {
  if (!sesion || sesion.rol !== 'admin') {
    throw new ErrorHttp('Necesitas permisos de administrador.', 403);
  }
}

function validarPassword(password) {
  if (password.length < 8) return 'La contraseña debe tener al menos 8 caracteres.';
  if (password.length > 200) return 'La contraseña es demasiado larga.';
  return null;
}

async function leerJson(request) {
  try {
    return await request.json();
  } catch {
    throw new ErrorHttp('El cuerpo de la petición no es JSON válido.', 400);
  }
}

async function adminsActivos(env) {
  const fila = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM usuarios WHERE rol = 'admin' AND activo = 1",
  ).first();
  return fila?.n || 0;
}

async function borrarImportacion(env, id) {
  await env.DB.batch([
    env.DB.prepare('DELETE FROM registros WHERE importacion_id = ?').bind(id),
    env.DB.prepare('DELETE FROM importaciones WHERE id = ?').bind(id),
  ]);
}

async function columnasActivas(env) {
  const filas = await env.DB.prepare(
    "SELECT columnas FROM importaciones WHERE estado = 'activa' ORDER BY id DESC",
  ).all();
  const vistas = [];
  for (const fila of filas.results || []) {
    for (const columna of JSON.parse(fila.columnas)) {
      if (!vistas.includes(columna)) vistas.push(columna);
    }
  }
  return vistas;
}

/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('No encontrado', { status: 404 });
    }
    try {
      return await manejarApi(request, env, url);
    } catch (e) {
      if (e instanceof ErrorHttp) return error(e.message, e.status);
      console.error('Error inesperado', e);
      return error('Error interno del servidor.', 500);
    }
  },
};
