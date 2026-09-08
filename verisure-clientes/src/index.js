/**
 * Buscador de clientes de baja — Cloudflare Worker + D1.
 *
 * Rutas de la API (todo bajo /api). Los archivos estáticos de /public los
 * sirve la plataforma directamente (ver wrangler.toml).
 *
 * El CSV NO se guarda con una fila de base de datos por cliente, sino troceado
 * en bloques de 100 registros (ver migrations/0001_esquema.sql). Buscar es un
 * LIKE que descarta bloques enteros dentro de SQLite, y sólo los que quedan se
 * abren aquí para ver qué registros concretos coinciden.
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

const REGISTROS_POR_BLOQUE = 100;
const MAX_FILAS_LOTE = 1000;
const MAX_RESULTADOS = 50;

/**
 * Cuántos registros se recorren como mucho en una búsqueda (en bloques de 100).
 * Buscar un número de instalación o un teléfono abre uno o dos bloques; un
 * término muy genérico los abre todos, y medido son ~4 ms de CPU para 54.000
 * registros, dentro de los 10 ms que da el plan gratuito de Workers. Si el
 * fichero es mayor que este tope, el recuento se marca como incompleto en vez
 * de agotar el tiempo de la petición.
 */
const MAX_BLOQUES_ABIERTOS = 800;

const MAX_INTENTOS = 8;
const VENTANA_INTENTOS_S = 15 * 60;

/** Multiplicador para numerar bloques sin AUTOINCREMENT: importacion * ESTO + n. */
const RANGO_BLOQUES = 100000000;

const CREAR_BLOQUES = `CREATE TABLE IF NOT EXISTS bloques (
  id             INTEGER PRIMARY KEY,
  importacion_id INTEGER NOT NULL,
  n              INTEGER NOT NULL,
  norm           TEXT NOT NULL
)`;

const CREAR_BLOQUES_DATOS = `CREATE TABLE IF NOT EXISTS bloques_datos (
  bloque_id INTEGER PRIMARY KEY,
  datos     BLOB NOT NULL
)`;

/* ------------------------------------------------------------------ */
/* Compresión (gzip) de los datos originales                           */
/* ------------------------------------------------------------------ */

async function comprimir(texto) {
  const flujo = new CompressionStream('gzip');
  const escritor = flujo.writable.getWriter();
  escritor.write(new TextEncoder().encode(texto));
  escritor.close();
  return new Response(flujo.readable).arrayBuffer();
}

async function descomprimir(datos) {
  // D1 puede devolver un BLOB como ArrayBuffer o como array de bytes.
  const bytes = datos instanceof ArrayBuffer ? new Uint8Array(datos) : Uint8Array.from(datos);
  const flujo = new DecompressionStream('gzip');
  const escritor = flujo.writable.getWriter();
  escritor.write(bytes);
  escritor.close();
  return new Response(flujo.readable).text();
}

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
/* Bloques de registros                                                */
/* ------------------------------------------------------------------ */

/**
 * Empaqueta un grupo de filas del CSV en un bloque.
 *
 *   datos  JSON con las filas tal cual venían
 *   norm   una línea por fila, campos separados por tabulador, normalizados
 *
 * Devuelve null si no queda ninguna fila con contenido.
 */
function prepararBloque(columnas, filas) {
  const datos = [];
  const lineas = [];

  for (const fila of filas) {
    if (!Array.isArray(fila)) continue;
    const valores = [];
    const normalizados = [];
    let tieneAlgo = false;

    for (let i = 0; i < columnas.length; i++) {
      const valor = fila[i] === undefined || fila[i] === null ? '' : String(fila[i]).trim();
      const c = colapsar(valor);
      valores.push(valor);
      normalizados.push(c);
      if (c) tieneAlgo = true;
    }
    if (!tieneAlgo) continue; // fila totalmente vacía

    datos.push(valores);
    lineas.push(normalizados.join('\t'));
  }

  if (datos.length === 0) return null;
  return { datos: JSON.stringify(datos), norm: lineas.join('\n'), n: datos.length };
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
/* Criterio de búsqueda                                                */
/* ------------------------------------------------------------------ */

/**
 * Traduce lo que ha escrito el usuario a un criterio reutilizable: primero
 * para descartar bloques en SQL y después para filtrar registro a registro.
 */
function criterioBusqueda(consulta) {
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

  if (agujas.length === 0 && !usarTokens) return null;
  return { agujas, tokens, usarTokens };
}

/**
 * Condición SQL para quedarse sólo con los bloques que pueden contener algo.
 * Es deliberadamente amplia: dentro del bloque puede haber una coincidencia
 * repartida entre registros distintos, y eso ya se descarta después en JS.
 */
function sqlBloques(criterio) {
  const trozos = [];
  const params = [];

  for (const aguja of criterio.agujas) {
    trozos.push("b.norm LIKE ? ESCAPE '\\'");
    params.push(`%${escaparLike(aguja)}%`);
  }
  if (criterio.usarTokens) {
    trozos.push('(' + criterio.tokens.map(() => "b.norm LIKE ? ESCAPE '\\'").join(' AND ') + ')');
    for (const token of criterio.tokens) params.push(`%${escaparLike(token)}%`);
  }
  return { sql: '(' + trozos.join(' OR ') + ')', params };
}

/**
 * ¿Coincide este registro? `linea` son sus campos normalizados separados por
 * tabulador. Con indiceCampo = -1 se busca en todos los campos a la vez: como
 * las agujas sólo tienen letras y números, no pueden cruzar un tabulador y
 * mezclar dos campos.
 */
function coincideRegistro(linea, criterio, indiceCampo) {
  // Límites del trozo de línea donde hay que mirar. Se calculan con indexOf en
  // vez de trocear la línea: con 54.000 registros y 35 columnas, evitar ese
  // millón y medio de cadenas intermedias es la diferencia entre 450 y 150 ms.
  let inicio = 0;
  let fin = linea.length;

  if (indiceCampo !== -1) {
    for (let k = 0; k < indiceCampo; k++) {
      inicio = linea.indexOf('\t', inicio);
      if (inicio === -1) return false;
      inicio++;
    }
    fin = linea.indexOf('\t', inicio);
    if (fin === -1) fin = linea.length;
  }

  const contiene = (aguja) => {
    const pos = linea.indexOf(aguja, inicio);
    return pos !== -1 && pos + aguja.length <= fin;
  };

  for (const aguja of criterio.agujas) {
    if (contiene(aguja)) return true;
  }
  if (criterio.usarTokens) {
    let todas = true;
    for (const token of criterio.tokens) {
      if (!contiene(token)) {
        todas = false;
        break;
      }
    }
    if (todas) return true;
  }
  return false;
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
    const registros = activas.reduce((suma, i) => suma + (i.filas || 0), 0);
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
      registros,
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

    const vacio = { total: 0, parcial: false, pagina: 1, paginas: 0, resultados: [] };
    const activas = await importacionesActivas(env);
    const criterio = activas.length ? criterioBusqueda(consulta) : null;
    if (!criterio) return json(vacio);

    // Si se busca en un campo concreto, sólo interesan las cargas que lo tengan.
    const buscables = campo ? activas.filter((i) => i.columnas.includes(campo)) : activas;
    if (buscables.length === 0) return json(vacio);

    const { sql, params } = sqlBloques(criterio);
    const ids = buscables.map((i) => Number(i.id)).join(',');
    const base = `FROM bloques b WHERE b.importacion_id IN (${ids}) AND ${sql}`;

    // Cuántos bloques encajan en total, para saber si nos dejamos alguno fuera.
    const cuenta = await env.DB.prepare(`SELECT COUNT(*) AS n ${base}`)
      .bind(...params)
      .first();
    const candidatos = cuenta?.n || 0;
    if (candidatos === 0) return json(vacio);

    // Primera pasada: sólo el texto normalizado. Los datos originales pesan
    // otro tanto y de ellos hará falta un puñado de bloques, no todos.
    const bloques = await env.DB.prepare(
      `SELECT b.id, b.importacion_id, b.norm ${base} ORDER BY b.id LIMIT ?`,
    )
      .bind(...params, MAX_BLOQUES_ABIERTOS)
      .all();

    const porId = new Map(buscables.map((i) => [Number(i.id), i]));
    const desde = (pagina - 1) * MAX_RESULTADOS;
    const aMostrar = []; // {bloqueId, indice, importacion} de la página pedida
    let total = 0;

    for (const bloque of bloques.results || []) {
      const importacion = porId.get(Number(bloque.importacion_id));
      if (!importacion) continue;
      const indice = campo ? importacion.columnas.indexOf(campo) : -1;

      const lineas = bloque.norm.split('\n');
      for (let i = 0; i < lineas.length; i++) {
        if (!coincideRegistro(lineas[i], criterio, indice)) continue;
        if (total >= desde && aMostrar.length < MAX_RESULTADOS) {
          aMostrar.push({ bloqueId: Number(bloque.id), indice: i, importacion });
        }
        total++;
      }
    }

    // Segunda pasada: los datos originales de los bloques que salen en pantalla.
    const resultados = [];
    if (aMostrar.length > 0) {
      const necesarios = [...new Set(aMostrar.map((r) => r.bloqueId))];
      const filas = await env.DB.prepare(
        `SELECT bloque_id, datos FROM bloques_datos WHERE bloque_id IN (${necesarios.join(',')})`,
      ).all();
      const datosPorBloque = new Map();
      for (const f of filas.results || []) {
        datosPorBloque.set(Number(f.bloque_id), JSON.parse(await descomprimir(f.datos)));
      }
      for (const r of aMostrar) {
        const valores = datosPorBloque.get(r.bloqueId)?.[r.indice];
        if (!valores) continue;
        resultados.push({
          id: `${r.bloqueId}-${r.indice}`,
          origen: r.importacion.archivo,
          importado: r.importacion.creado_en,
          datos: aObjeto(r.importacion.columnas, valores),
        });
      }
    }

    // Si el fichero es mayor que el tope quedan bloques sin mirar: el recuento
    // es entonces un mínimo, y así se dice en pantalla.
    const parcial = candidatos > (bloques.results || []).length;

    return json({
      total,
      parcial,
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
      await env.DB.prepare('DROP TABLE IF EXISTS bloques').run();
      await env.DB.prepare('DROP TABLE IF EXISTS bloques_datos').run();
      await env.DB.prepare(CREAR_BLOQUES).run();
      await env.DB.prepare(CREAR_BLOQUES_DATOS).run();
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
      'SELECT id, columnas, estado, n_bloques FROM importaciones WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!importacion) return error('La importación no existe.', 404);
    if (importacion.estado !== 'pendiente') return error('La importación ya está cerrada.', 409);

    const cuerpo = await leerJson(request);
    const filas = Array.isArray(cuerpo?.filas) ? cuerpo.filas : [];
    if (filas.length === 0) return json({ insertadas: 0 });
    if (filas.length > MAX_FILAS_LOTE) return error(`Máximo ${MAX_FILAS_LOTE} filas por lote.`, 413);

    // Posición absoluta de la primera fila del lote dentro del CSV. Es lo que
    // permite numerar los bloques sin depender del orden de llegada, y por
    // tanto enviar varios lotes a la vez: cada lote ocupa un rango propio de
    // identificadores. Reenviar un lote que falló sobrescribe el suyo en vez
    // de duplicarlo.
    const desde = Number(cuerpo?.desde);
    if (!Number.isInteger(desde) || desde < 0 || desde % REGISTROS_POR_BLOQUE !== 0) {
      return error(`El lote debe indicar "desde" como múltiplo de ${REGISTROS_POR_BLOQUE}.`, 400);
    }

    const columnas = JSON.parse(importacion.columnas);
    const insertarNorm = env.DB.prepare(
      'INSERT OR REPLACE INTO bloques (id, importacion_id, n, norm) VALUES (?, ?, ?, ?)',
    );
    const insertarDatos = env.DB.prepare(
      'INSERT OR REPLACE INTO bloques_datos (bloque_id, datos) VALUES (?, ?)',
    );

    const sentencias = [];
    let insertadas = 0;
    let nBloques = 0;

    for (let i = 0; i < filas.length; i += REGISTROS_POR_BLOQUE) {
      const bloque = prepararBloque(columnas, filas.slice(i, i + REGISTROS_POR_BLOQUE));
      if (!bloque) continue;
      const idBloque = id * RANGO_BLOQUES + (desde + i) / REGISTROS_POR_BLOQUE;
      sentencias.push(insertarNorm.bind(idBloque, id, bloque.n, bloque.norm));
      sentencias.push(insertarDatos.bind(idBloque, await comprimir(bloque.datos)));
      insertadas += bloque.n;
      nBloques++;
    }

    if (sentencias.length > 0) await env.DB.batch(sentencias);
    // El total no se acumula aquí: reenviar un lote tras un corte de red lo
    // contaría dos veces. Se calcula al finalizar sumando lo que hay de verdad.
    return json({ insertadas, bloques: nBloques });
  }

  m = ruta.match(/^\/importaciones\/(\d+)\/finalizar$/);
  if (m && metodo === 'POST') {
    exigirAdmin(sesion);
    const id = Number(m[1]);
    const importacion = await env.DB.prepare(
      'SELECT id, modo, estado FROM importaciones WHERE id = ?',
    )
      .bind(id)
      .first();
    if (!importacion) return error('La importación no existe.', 404);
    if (importacion.estado !== 'pendiente') return error('La importación ya está cerrada.', 409);

    const suma = await env.DB.prepare(
      'SELECT COUNT(*) AS bloques, COALESCE(SUM(n), 0) AS filas FROM bloques WHERE importacion_id = ?',
    )
      .bind(id)
      .first();
    if (!suma || suma.filas === 0) {
      await borrarImportacion(env, id);
      return error('El CSV no contenía ninguna fila de datos.', 400);
    }

    await env.DB.prepare(
      "UPDATE importaciones SET estado = 'activa', filas = ?, n_bloques = ? WHERE id = ?",
    )
      .bind(suma.filas, suma.bloques, id)
      .run();
    return json({ ok: true, filas: suma.filas });
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
    `SELECT id, archivo, columnas, filas, creado_en FROM importaciones
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
    // escrituras, al contrario que borrar los bloques uno a uno.
    await env.DB.prepare('DROP TABLE IF EXISTS bloques').run();
    await env.DB.prepare('DROP TABLE IF EXISTS bloques_datos').run();
    await env.DB.prepare(CREAR_BLOQUES).run();
    await env.DB.prepare(CREAR_BLOQUES_DATOS).run();
  } else {
    await env.DB.batch([
      env.DB.prepare(
        'DELETE FROM bloques_datos WHERE bloque_id BETWEEN ? AND ?',
      ).bind(id * RANGO_BLOQUES, (id + 1) * RANGO_BLOQUES - 1),
      env.DB.prepare('DELETE FROM bloques WHERE importacion_id = ?').bind(id),
    ]);
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
