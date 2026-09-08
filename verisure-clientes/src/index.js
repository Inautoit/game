/**
 * Buscador de clientes de baja — Cloudflare Worker + D1.
 *
 * Rutas de la API (todo bajo /api). Los archivos estáticos de /public los
 * sirve la plataforma directamente (ver wrangler.toml).
 *
 * Cada línea del CSV se guarda como dos arrays JSON en paralelo:
 *
 *   valores  ["1234567", "María Pérez", "600 123 456", ...]  tal cual el CSV
 *   norm     ["1234567", "mariaperez",  "600123456",  ...]   para buscar
 *
 * Los nombres de las columnas están una sola vez en `importaciones.columnas`,
 * así que no se repiten en cada fila. Ver migrations/0003 para el porqué.
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
import { colapsar, escaparLike, palabras } from './texto.js';

const MAX_FILAS_LOTE = 500;
const MAX_RESULTADOS = 50;
const MAX_INTENTOS = 8;
const VENTANA_INTENTOS_S = 15 * 60;

const CREAR_REGISTROS = `CREATE TABLE IF NOT EXISTS registros (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  valores        TEXT NOT NULL,
  norm           TEXT NOT NULL
)`;

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

/**
 * Convierte un error de D1 en algo que el administrador pueda entender y
 * accionar. Los límites del plan gratuito son, con diferencia, la causa más
 * probable al cargar un fichero grande.
 */
function mensajeDeError(e, autenticado) {
  const texto = String(e?.message || e || '');

  if (/daily row write limit/i.test(texto)) {
    return (
      'Se ha agotado el límite de escrituras diarias del plan gratuito de Cloudflare D1 ' +
      '(100.000 filas al día, contando toda la cuenta). Se restablece a las 00:00 UTC ' +
      '(las 02:00 en España peninsular). El plan Workers Paid (desde 5 $/mes) elimina el ' +
      'límite diario e incluye 50 millones de escrituras al mes.'
    );
  }
  if (/daily read/i.test(texto)) {
    return (
      'Se ha agotado el límite de lecturas diarias del plan gratuito de Cloudflare D1. ' +
      'Se restablece a las 00:00 UTC (las 02:00 en España peninsular).'
    );
  }
  if (/storage limit|database is full|too large/i.test(texto)) {
    return (
      'La base de datos ha alcanzado el tamaño máximo del plan. Elimina alguna carga ' +
      'antigua desde "Importar CSV" o activa el plan Workers Paid.'
    );
  }
  // Para personal identificado mostramos el detalle técnico: es una herramienta
  // interna y así se puede diagnosticar sin abrir los registros del Worker.
  return autenticado && texto ? `Error interno: ${texto}` : 'Error interno del servidor.';
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

/* ------------------------------------------------------------------ */
/* Preparación de un registro para búsqueda                            */
/* ------------------------------------------------------------------ */

function prepararRegistro(columnas, fila) {
  const valores = [];
  const norm = [];
  let tieneAlgo = false;

  for (let i = 0; i < columnas.length; i++) {
    const valor = fila[i] === undefined || fila[i] === null ? '' : String(fila[i]).trim();
    const c = colapsar(valor);
    valores.push(valor);
    norm.push(c);
    if (c) tieneAlgo = true;
  }

  return tieneAlgo ? { valores: JSON.stringify(valores), norm: JSON.stringify(norm) } : null;
}

/** Reconstruye el objeto {columna: valor} que espera la interfaz. */
function aObjeto(columnas, valores) {
  const datos = {};
  columnas.forEach((columna, i) => {
    datos[columna] = valores[i] ?? '';
  });
  return datos;
}

/* ------------------------------------------------------------------ */
/* Construcción del WHERE de búsqueda                                  */
/* ------------------------------------------------------------------ */

/**
 * Devuelve {sql, params} o null si la consulta no da para buscar nada.
 *
 * Sin campo, el LIKE va contra el JSON `norm` entero. Como los valores
 * normalizados sólo contienen letras y números, las comillas y comas que los
 * separan impiden que una coincidencia cruce de un campo a otro.
 *
 * Con campo, se usa json_extract sobre la posición que ocupa esa columna en
 * cada importación activa (puede ser distinta en cada una).
 */
function condicionBusqueda(consulta, campo, activas) {
  const colapsada = colapsar(consulta);
  const tokens = palabras(consulta).map(colapsar).filter(Boolean);
  if (!colapsada && tokens.length === 0) return null;

  const soloDigitos = colapsada !== '' && /^[0-9]+$/.test(colapsada);

  // Variantes de la consulta completa. Para un número se prueba también sin el
  // prefijo internacional, para que "+34 600123456" encuentre "600123456".
  const agujas = [];
  if (colapsada) {
    agujas.push(colapsada);
    if (soloDigitos) {
      if (/^0034[0-9]{9,}$/.test(colapsada)) agujas.push(colapsada.slice(4));
      else if (/^34[0-9]{9,}$/.test(colapsada)) agujas.push(colapsada.slice(2));
    }
  }

  // Buscar las palabras por separado (para "perez maria" además de "maria
  // perez") sólo tiene sentido con texto: un número escrito con espacios o
  // guiones, "638 147 794", es un único dato y no tres fragmentos sueltos.
  const usarTokens = tokens.length > 1 && !soloDigitos;

  const alternativas = (expresion, params) => {
    const trozos = [];
    for (const aguja of agujas) {
      trozos.push(`${expresion} LIKE ? ESCAPE '\\'`);
      params.push(`%${escaparLike(aguja)}%`);
    }
    if (usarTokens) {
      trozos.push('(' + tokens.map(() => `${expresion} LIKE ? ESCAPE '\\'`).join(' AND ') + ')');
      for (const token of tokens) params.push(`%${escaparLike(token)}%`);
    }
    return trozos.length ? '(' + trozos.join(' OR ') + ')' : null;
  };

  const params = [];

  if (!campo) {
    const sql = alternativas('r.norm', params);
    return sql ? { sql, params } : null;
  }

  const grupos = [];
  for (const importacion of activas) {
    const indice = importacion.columnas.indexOf(campo);
    if (indice === -1) continue; // esa carga no tiene esa columna
    const sub = alternativas(`json_extract(r.norm, '$[${indice}]')`, params);
    if (sub) grupos.push(`(r.importacion_id = ${Number(importacion.id)} AND ${sub})`);
  }
  if (grupos.length === 0) return null;
  return { sql: '(' + grupos.join(' OR ') + ')', params };
}

/* ------------------------------------------------------------------ */
/* Rutas                                                               */
/* ------------------------------------------------------------------ */

async function manejarApi(request, env, url, sesion) {
  const ruta = url.pathname.replace(/^\/api/, '') || '/';
  const metodo = request.method.toUpperCase();

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
      // Si no se puede registrar el intento (p. ej. límite de escrituras
      // agotado) el acceso debe seguir denegándose igualmente.
      try {
        await env.DB.prepare('INSERT INTO intentos (usuario, ip, ts) VALUES (?, ?, ?)')
          .bind(usuario, ip, ahora)
          .run();
      } catch (e) {
        console.error('No se pudo registrar el intento fallido', e?.message);
      }
      return error('Usuario o contraseña incorrectos.', 401);
    }

    try {
      await env.DB.batch([
        env.DB.prepare('DELETE FROM intentos WHERE usuario = ? OR ip = ?').bind(usuario, ip),
        env.DB.prepare('DELETE FROM intentos WHERE ts < ?').bind(desde),
      ]);
    } catch (e) {
      console.error('No se pudieron limpiar los intentos', e?.message);
    }

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
    const activas = await importacionesActivas(env);
    const totales = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM registros r
        WHERE r.importacion_id IN (SELECT id FROM importaciones WHERE estado = 'activa')`,
    ).first();
    const ultima = await env.DB.prepare(
      `SELECT archivo, filas, usuario, creado_en FROM importaciones
        WHERE estado = 'activa' ORDER BY id DESC LIMIT 1`,
    ).first();

    const campos = [];
    for (const importacion of activas) {
      for (const columna of importacion.columnas) {
        if (!campos.includes(columna)) campos.push(columna);
      }
    }

    return json({
      registros: totales?.n || 0,
      importaciones: activas.length,
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

    const activas = await importacionesActivas(env);
    const condicion = activas.length ? condicionBusqueda(consulta, campo, activas) : null;
    if (!condicion) return json({ total: 0, pagina: 1, paginas: 0, resultados: [] });

    const ids = activas.map((i) => Number(i.id)).join(',');
    const base = `FROM registros r WHERE r.importacion_id IN (${ids}) AND ${condicion.sql}`;

    const cuenta = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
      .bind(...condicion.params)
      .first();
    const total = cuenta?.n || 0;

    const filas = await env.DB.prepare(
      `SELECT r.id, r.importacion_id, r.valores ${base} ORDER BY r.id LIMIT ? OFFSET ?`,
    )
      .bind(...condicion.params, MAX_RESULTADOS, (pagina - 1) * MAX_RESULTADOS)
      .all();

    const porId = new Map(activas.map((i) => [Number(i.id), i]));
    const resultados = (filas.results || []).map((f) => {
      const importacion = porId.get(Number(f.importacion_id));
      return {
        id: f.id,
        origen: importacion?.archivo || '',
        importado: importacion?.creado_en || '',
        datos: aObjeto(importacion?.columnas || [], JSON.parse(f.valores)),
      };
    });

    return json({
      total,
      pagina,
      paginas: Math.ceil(total / MAX_RESULTADOS),
      porPagina: MAX_RESULTADOS,
      resultados,
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
      importaciones: (filas.results || []).map((f) => ({ ...f, columnas: JSON.parse(f.columnas) })),
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

    // En modo "reemplazar" se vacía todo ANTES de cargar. Se usa DROP TABLE
    // porque borrar fila a fila consumiría tantas escrituras como insertarlas,
    // y con ficheros grandes eso agota el límite diario de D1.
    if (modo === 'reemplazar') {
      await env.DB.prepare('DROP TABLE IF EXISTS registros').run();
      await env.DB.prepare(CREAR_REGISTROS).run();
      await env.DB.prepare('DELETE FROM importaciones').run();
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
      'INSERT INTO registros (importacion_id, valores, norm) VALUES (?, ?, ?)',
    );
    const sentencias = [];
    for (const fila of filas) {
      if (!Array.isArray(fila)) continue;
      const p = prepararRegistro(columnas, fila);
      if (p) sentencias.push(insertar.bind(id, p.valores, p.norm));
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
    const destino = await env.DB.prepare(
      'SELECT id, usuario, rol, activo FROM usuarios WHERE id = ?',
    )
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
      const rol =
        cuerpo?.rol === undefined ? destino.rol : cuerpo.rol === 'admin' ? 'admin' : 'usuario';
      const activo = cuerpo?.activo === undefined ? destino.activo : cuerpo.activo ? 1 : 0;
      if (destino.id === sesion.id && (rol !== 'admin' || activo !== 1)) {
        return error('No puedes quitarte a ti mismo el acceso de administrador.', 400);
      }
      if (
        destino.rol === 'admin' &&
        (rol !== 'admin' || activo !== 1) &&
        (await adminsActivos(env)) <= 1
      ) {
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

async function importacionesActivas(env) {
  const filas = await env.DB.prepare(
    `SELECT id, archivo, columnas, creado_en FROM importaciones
      WHERE estado = 'activa' ORDER BY id DESC`,
  ).all();
  return (filas.results || []).map((f) => ({ ...f, columnas: JSON.parse(f.columnas) }));
}

async function borrarImportacion(env, id) {
  const otras = await env.DB.prepare('SELECT COUNT(*) AS n FROM importaciones WHERE id != ?')
    .bind(id)
    .first();

  if ((otras?.n || 0) === 0) {
    // Es la única carga: soltar la tabla entera es instantáneo y no consume
    // escrituras, al contrario que borrar decenas de miles de filas.
    await env.DB.prepare('DROP TABLE IF EXISTS registros').run();
    await env.DB.prepare(CREAR_REGISTROS).run();
  } else {
    await env.DB.prepare('DELETE FROM registros WHERE importacion_id = ?').bind(id).run();
  }
  await env.DB.prepare('DELETE FROM importaciones WHERE id = ?').bind(id).run();
}

/* ------------------------------------------------------------------ */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!url.pathname.startsWith('/api/')) {
      return new Response('No encontrado', { status: 404 });
    }
    let sesion = null;
    try {
      sesion = await leerToken(secreto(env), leerCookie(request, COOKIE));
      return await manejarApi(request, env, url, sesion);
    } catch (e) {
      if (e instanceof ErrorHttp) return error(e.message, e.status);
      console.error('Error inesperado', e?.message, e?.stack);
      return error(mensajeDeError(e, Boolean(sesion)), 500);
    }
  },
};
