/* ═══════════════════════════════════════════════════════════════
   Verisure · Buscador de clientes de baja — lógica de la interfaz
   ═══════════════════════════════════════════════════════════════ */

import { escapar, resaltar } from '/comun.js';

const $ = (sel, raiz = document) => raiz.querySelector(sel);
const $$ = (sel, raiz = document) => [...raiz.querySelectorAll(sel)];

// El servidor agrupa cada 100 filas en un bloque y comprime sus datos. Se
// envían 300 filas por petición para que comprimir tres bloques quepa
// holgadamente en los 10 ms de CPU que da el plan gratuito de Workers.
const FILAS_POR_LOTE = 300;

// Peticiones simultáneas durante la importación. Con un millón de filas son más
// de tres mil envíos, y en serie se pierde casi todo el tiempo esperando la ida
// y vuelta de cada uno.
const ENVIOS_A_LA_VEZ = 4;

let sesion = null;
let campos = [];
let ultimaBusqueda = { q: '', campo: '', pagina: 1 };
let resultadosActuales = [];
let csvPreparado = null;

/* ─────────────── Utilidades ─────────────── */

async function api(ruta, opciones = {}) {
  const respuesta = await fetch(`/api${ruta}`, {
    credentials: 'same-origin',
    headers: opciones.cuerpo ? { 'Content-Type': 'application/json' } : {},
    method: opciones.metodo || 'GET',
    body: opciones.cuerpo ? JSON.stringify(opciones.cuerpo) : undefined,
  });

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    /* respuesta sin cuerpo */
  }

  if (respuesta.status === 401 && sesion) {
    sesion = null;
    mostrarLogin();
    avisar('Tu sesión ha caducado. Vuelve a entrar.', 'mal');
    throw new Error('sesión caducada');
  }
  if (!respuesta.ok) throw new Error(datos?.error || `Error ${respuesta.status}`);
  return datos;
}

function avisar(mensaje, tipo = 'ok') {
  const nodo = document.createElement('div');
  nodo.className = `aviso aviso--${tipo}`;
  nodo.textContent = mensaje;
  $('#avisos').append(nodo);
  setTimeout(() => nodo.remove(), 5000);
}

/* ─────────────── Pantallas ─────────────── */

function mostrarLogin() {
  $('#pantalla-app').hidden = true;
  $('#pantalla-login').hidden = false;
  $('#login-password').value = '';
}

async function mostrarApp() {
  $('#pantalla-login').hidden = true;
  $('#pantalla-app').hidden = false;
  $('#chip-nombre').textContent = sesion.nombre || sesion.usuario;
  const chipRol = $('#chip-rol');
  chipRol.textContent = sesion.rol === 'admin' ? 'Administrador' : 'Usuario';
  chipRol.className = `etiqueta ${sesion.rol === 'admin' ? 'etiqueta--admin' : ''}`;

  const esAdmin = sesion.rol === 'admin';
  $$('.solo-admin').forEach((n) => (n.hidden = !esAdmin));
  cambiarVista('buscar');

  await cargarEstado();
  if (esAdmin) {
    cargarImportaciones();
    cargarUsuarios();
  }
}

function cambiarVista(nombre) {
  $$('.pestana').forEach((p) => p.classList.toggle('activa', p.dataset.vista === nombre));
  $$('.vista').forEach((v) => (v.hidden = v.dataset.vista !== nombre));
}

/* ─────────────── Estado y campos ─────────────── */

async function cargarEstado() {
  const estado = await api('/estado');
  campos = estado.campos || [];

  const selector = $('#buscar-campo');
  selector.innerHTML = '<option value="">Todos los campos</option>';
  for (const campo of campos) {
    const opcion = document.createElement('option');
    opcion.value = campo;
    opcion.textContent = campo;
    selector.append(opcion);
  }

  // Atajos con los campos más habituales de búsqueda.
  const atajos = $('#atajos');
  atajos.innerHTML = '';
  const preferidos = campos.filter((c) =>
    /instalac|telef|movil|móvil|tlf|dni|nif|contrat|abonad|client|nombre|email|correo/i.test(c),
  );
  if (preferidos.length) {
    atajos.append(crearAtajo('Todos los campos', ''));
    for (const campo of preferidos.slice(0, 7)) atajos.append(crearAtajo(campo, campo));
  }

  $('#buscar-estado').textContent = estado.registros
    ? `${estado.registros.toLocaleString('es-ES')} registros disponibles` +
      (estado.ultima ? ` · última carga: ${estado.ultima.archivo} (${estado.ultima.creado_en})` : '')
    : 'Todavía no hay ningún registro cargado. Un administrador debe importar el CSV.';

  const caja = $('#estado-bbdd');
  caja.innerHTML = '';
  caja.append(
    filaEstado('Registros activos', (estado.registros || 0).toLocaleString('es-ES')),
    filaEstado('Cargas activas', String(estado.importaciones || 0)),
    filaEstado(
      'Última carga',
      estado.ultima ? `${estado.ultima.archivo} · ${estado.ultima.creado_en}` : '—',
    ),
  );
  if (estado.avisoSecreto) {
    const aviso = filaEstado(
      'Seguridad',
      'Falta configurar AUTH_SECRET (npx wrangler secret put AUTH_SECRET)',
    );
    aviso.style.borderColor = 'rgba(240,169,43,.5)';
    caja.append(aviso);
  }
}

function filaEstado(clave, valor) {
  const fila = document.createElement('div');
  fila.className = 'fila-lista';
  fila.innerHTML = `<span>${escapar(clave)}</span><span class="fila-lista__detalle">${escapar(valor)}</span>`;
  return fila;
}

function crearAtajo(texto, campo) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = 'atajo';
  boton.textContent = texto;
  boton.dataset.campo = campo;
  boton.addEventListener('click', () => {
    $('#buscar-campo').value = campo;
    $$('.atajo').forEach((a) => a.classList.toggle('activo', a === boton));
    if ($('#buscar-q').value.trim()) buscar(1);
  });
  return boton;
}

/* ─────────────── Búsqueda ─────────────── */

async function buscar(pagina = 1) {
  const q = $('#buscar-q').value.trim();
  const campo = $('#buscar-campo').value;
  if (!q) {
    $('#resultados').innerHTML = '';
    $('#paginacion').hidden = true;
    return;
  }

  ultimaBusqueda = { q, campo, pagina };
  $('#resultados').innerHTML = '<div class="vacio">Buscando…</div>';

  try {
    const datos = await api(
      `/buscar?q=${encodeURIComponent(q)}&campo=${encodeURIComponent(campo)}&pagina=${pagina}`,
    );
    resultadosActuales = datos.resultados;
    pintarResultados(datos, q);
  } catch (e) {
    $('#resultados').innerHTML = `<div class="vacio">${escapar(e.message)}</div>`;
  }
}

function pintarResultados(datos, consulta) {
  const caja = $('#resultados');
  caja.innerHTML = '';

  if (datos.total === 0) {
    caja.innerHTML =
      '<div class="vacio">Sin resultados. Prueba con otro dato o cambia el campo de búsqueda.</div>';
    $('#paginacion').hidden = true;
    return;
  }

  const resumen = document.createElement('div');
  resumen.className = 'fila-lista';
  resumen.innerHTML = datos.parcial
    ? `<span>Más de <strong>${datos.total.toLocaleString('es-ES')}</strong> registros ` +
      `coinciden. Afina la búsqueda o elige un campo concreto para verlos todos.</span>`
    : `<span><strong>${datos.total.toLocaleString('es-ES')}</strong> ` +
      `registro${datos.total === 1 ? '' : 's'} encontrado${datos.total === 1 ? '' : 's'}</span>`;
  const exportar = document.createElement('button');
  exportar.className = 'boton boton--fantasma boton--mini';
  exportar.textContent = 'Exportar esta página a CSV';
  exportar.addEventListener('click', exportarCsv);
  resumen.append(exportar);
  caja.append(resumen);

  for (const registro of datos.resultados) {
    const claves = Object.keys(registro.datos);
    const claveTitulo =
      claves.find((c) => /nombre|titular|cliente|razon|razón/i.test(c) && registro.datos[c]) ||
      claves.find((c) => registro.datos[c]) ||
      claves[0];

    const tarjeta = document.createElement('article');
    tarjeta.className = 'registro';

    const cabecera = document.createElement('div');
    cabecera.className = 'registro__cabecera';
    cabecera.innerHTML =
      `<div class="registro__titulo">${resaltar(registro.datos[claveTitulo] || '—', consulta)}</div>` +
      `<span class="etiqueta">${escapar(registro.origen || '')}</span>`;
    tarjeta.append(cabecera);

    const rejilla = document.createElement('div');
    rejilla.className = 'registro__campos';
    for (const clave of claves) {
      const valor = registro.datos[clave];
      if (valor === '' || valor === null || valor === undefined) continue;
      const dato = document.createElement('div');
      dato.className = 'dato';
      dato.innerHTML =
        `<span class="dato__clave">${escapar(clave)}</span>` +
        `<span class="dato__valor">${resaltar(valor, consulta)}</span>`;
      rejilla.append(dato);
    }
    tarjeta.append(rejilla);
    caja.append(tarjeta);
  }

  const paginacion = $('#paginacion');
  paginacion.hidden = datos.paginas <= 1;
  $('#paginacion-texto').textContent =
    `Página ${datos.pagina} de ${datos.paginas}${datos.parcial ? '+' : ''}`;
  $$('#paginacion .boton').forEach((b) => {
    const destino = datos.pagina + Number(b.dataset.paso);
    b.disabled = destino < 1 || destino > datos.paginas;
    b.style.opacity = b.disabled ? 0.4 : 1;
  });
}

function exportarCsv() {
  if (!resultadosActuales.length) return;
  const columnas = [...new Set(resultadosActuales.flatMap((r) => Object.keys(r.datos)))];
  const celda = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const lineas = [columnas.map(celda).join(',')];
  for (const registro of resultadosActuales) {
    lineas.push(columnas.map((c) => celda(registro.datos[c])).join(','));
  }
  const blob = new Blob(['\ufeff' + lineas.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(blob);
  enlace.download = 'busqueda-clientes.csv';
  enlace.click();
  URL.revokeObjectURL(enlace.href);
}

/* ─────────────── CSV: lectura y análisis ─────────────── */

/** Detecta el separador más probable mirando la primera línea. */
function detectarSeparador(texto) {
  const primera = texto.split(/\r?\n/)[0] || '';
  const candidatos = [
    [',', 'coma'],
    [';', 'punto y coma'],
    ['\t', 'tabulador'],
    ['|', 'barra vertical'],
  ];
  let mejor = candidatos[0];
  let maximo = -1;
  for (const candidato of candidatos) {
    const n = primera.split(candidato[0]).length - 1;
    if (n > maximo) {
      maximo = n;
      mejor = candidato;
    }
  }
  return { caracter: mejor[0], nombre: mejor[1] };
}

/** Analiza el CSV respetando comillas dobles y saltos de línea dentro de ellas. */
function analizarCsv(texto, separador) {
  const filas = [];
  let fila = [];
  let celda = '';
  let entreComillas = false;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];

    if (entreComillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') {
          celda += '"';
          i++;
        } else {
          entreComillas = false;
        }
      } else {
        celda += c;
      }
      continue;
    }

    if (c === '"') {
      entreComillas = true;
    } else if (c === separador) {
      fila.push(celda);
      celda = '';
    } else if (c === '\n') {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = '';
    } else if (c !== '\r') {
      celda += c;
    }
  }
  if (celda !== '' || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }

  return filas.filter((f) => f.some((v) => String(v).trim() !== ''));
}

async function prepararArchivo(archivo) {
  const texto = (await archivo.text()).replace(/^\ufeff/, '');
  const separador = detectarSeparador(texto);
  const filas = analizarCsv(texto, separador.caracter);

  if (filas.length < 2) {
    avisar('El archivo no tiene cabecera y al menos una fila de datos.', 'mal');
    return;
  }

  const columnas = filas[0].map((c, i) => c.trim() || `Columna ${i + 1}`);
  const vistas = new Set();
  columnas.forEach((c, i) => {
    let nombre = c;
    let n = 2;
    while (vistas.has(nombre)) nombre = `${c} (${n++})`;
    vistas.add(nombre);
    columnas[i] = nombre;
  });

  csvPreparado = { nombre: archivo.name, columnas, filas: filas.slice(1), separador: separador.nombre };

  $('#previo').hidden = false;
  $('#previo-nombre').textContent = archivo.name;
  $('#previo-filas').textContent = csvPreparado.filas.length.toLocaleString('es-ES');
  $('#previo-columnas').textContent = String(columnas.length);
  $('#previo-separador').textContent = separador.nombre;

  const tabla = $('#previo-tabla');
  tabla.innerHTML =
    '<thead><tr>' +
    columnas.map((c) => `<th>${escapar(c)}</th>`).join('') +
    '</tr></thead><tbody>' +
    csvPreparado.filas
      .slice(0, 5)
      .map((f) => '<tr>' + columnas.map((_, i) => `<td>${escapar(f[i] ?? '')}</td>`).join('') + '</tr>')
      .join('') +
    '</tbody>';
}

async function importar() {
  if (!csvPreparado) return;
  const modo = $$('input[name="modo"]').find((r) => r.checked).value;
  const boton = $('#boton-importar');
  const cajaError = $('#import-error');
  boton.disabled = true;
  cajaError.hidden = true;
  $('#progreso').hidden = false;

  try {
    const { id } = await api('/importaciones', {
      metodo: 'POST',
      cuerpo: { archivo: csvPreparado.nombre, columnas: csvPreparado.columnas, modo },
    });

    const total = csvPreparado.filas.length;
    const posiciones = [];
    for (let i = 0; i < total; i += FILAS_POR_LOTE) posiciones.push(i);

    let enviadas = 0;
    let siguiente = 0;
    const comenzado = Date.now();

    // Cada lote lleva su posición en el fichero, así que el servidor no depende
    // del orden de llegada y se pueden mandar varios a la vez. Con un millón de
    // filas son más de tres mil peticiones: en serie se irían muchos minutos
    // esperando la ida y vuelta de cada una.
    const enviarLote = async (desde) => {
      const lote = csvPreparado.filas.slice(desde, desde + FILAS_POR_LOTE);
      let ultimoError = null;
      for (let intento = 1; intento <= 3; intento++) {
        try {
          await api(`/importaciones/${id}/filas`, { metodo: 'POST', cuerpo: { desde, filas: lote } });
          enviadas += lote.length;
          const porcentaje = Math.round((enviadas / total) * 100);
          const segundos = (Date.now() - comenzado) / 1000;
          const restantes = enviadas > 0 ? Math.round((segundos / enviadas) * (total - enviadas)) : 0;
          $('#progreso-relleno').style.width = `${porcentaje}%`;
          $('#progreso-texto').textContent =
            `${enviadas.toLocaleString('es-ES')} de ${total.toLocaleString('es-ES')} filas ` +
            `(${porcentaje} %)` + (restantes > 5 ? ` · quedan unos ${restantes} s` : '');
          return;
        } catch (e) {
          ultimoError = e;
          // Un límite alcanzado o un rechazo del servidor no se arregla
          // reintentando; un corte de red, casi siempre sí.
          if (/límite|permisos|sesión|cerrada|no existe/i.test(e.message)) throw e;
          await new Promise((r) => setTimeout(r, 500 * intento));
        }
      }
      throw ultimoError;
    };

    const enHilo = async () => {
      for (;;) {
        const indice = siguiente++;
        if (indice >= posiciones.length) return;
        await enviarLote(posiciones[indice]);
      }
    };
    await Promise.all(Array.from({ length: ENVIOS_A_LA_VEZ }, enHilo));

    const fin = await api(`/importaciones/${id}/finalizar`, { metodo: 'POST' });
    avisar(`Importación completada: ${fin.filas.toLocaleString('es-ES')} registros.`, 'ok');
    cancelarImportacion();
    await cargarEstado();
    await cargarImportaciones();
  } catch (e) {
    // El error se deja fijo en pantalla: los avisos flotantes desaparecen y
    // con un fichero grande el fallo puede llegar minutos después de empezar.
    cajaError.textContent = e.message;
    cajaError.hidden = false;
    avisar('La importación no se ha completado.', 'mal');
  } finally {
    boton.disabled = false;
  }
}

function cancelarImportacion() {
  csvPreparado = null;
  $('#previo').hidden = true;
  $('#import-error').hidden = true;
  $('#progreso').hidden = true;
  $('#progreso-relleno').style.width = '0%';
  $('#progreso-texto').textContent = '';
  $('#archivo').value = '';
}

async function cargarImportaciones() {
  const caja = $('#lista-importaciones');
  try {
    const { importaciones } = await api('/importaciones');
    caja.innerHTML = '';
    if (!importaciones.length) {
      caja.innerHTML = '<p class="apagado">Aún no se ha importado ningún archivo.</p>';
      return;
    }
    for (const imp of importaciones) {
      const fila = document.createElement('div');
      fila.className = 'fila-lista';
      fila.innerHTML =
        `<div><strong>${escapar(imp.archivo)}</strong> ` +
        `<span class="etiqueta ${imp.estado === 'activa' ? 'etiqueta--ok' : ''}">${escapar(imp.estado)}</span>` +
        `<div class="fila-lista__detalle">${imp.filas.toLocaleString('es-ES')} filas · ` +
        `${escapar(imp.modo)} · ${escapar(imp.usuario)} · ${escapar(imp.creado_en)}</div></div>`;
      const borrar = document.createElement('button');
      borrar.className = 'boton boton--peligro boton--mini';
      borrar.textContent = 'Eliminar';
      borrar.addEventListener('click', async () => {
        if (!confirm(`¿Eliminar la carga "${imp.archivo}" y sus ${imp.filas} registros?`)) return;
        try {
          await api(`/importaciones/${imp.id}`, { metodo: 'DELETE' });
          avisar('Carga eliminada.', 'ok');
          await cargarImportaciones();
          await cargarEstado();
        } catch (e) {
          avisar(e.message, 'mal');
        }
      });
      fila.append(borrar);
      caja.append(fila);
    }
  } catch (e) {
    caja.innerHTML = `<p class="apagado">${escapar(e.message)}</p>`;
  }
}

/* ─────────────── Usuarios ─────────────── */

async function cargarUsuarios() {
  const tabla = $('#tabla-usuarios');
  try {
    const { usuarios } = await api('/usuarios');
    tabla.innerHTML =
      '<thead><tr><th>Usuario</th><th>Nombre</th><th>Rol</th><th>Estado</th><th>Alta</th><th></th></tr></thead>';
    const cuerpo = document.createElement('tbody');

    for (const u of usuarios) {
      const tr = document.createElement('tr');
      tr.innerHTML =
        `<td><strong>${escapar(u.usuario)}</strong></td>` +
        `<td>${escapar(u.nombre)}</td>` +
        `<td><span class="etiqueta ${u.rol === 'admin' ? 'etiqueta--admin' : ''}">${
          u.rol === 'admin' ? 'Administrador' : 'Usuario'
        }</span></td>` +
        `<td><span class="etiqueta ${u.activo ? 'etiqueta--ok' : ''}">${u.activo ? 'Activo' : 'Bloqueado'}</span></td>` +
        `<td class="fila-lista__detalle">${escapar(u.creado_en)}</td>`;

      const acciones = document.createElement('td');
      acciones.append(
        botonUsuario(u.activo ? 'Bloquear' : 'Activar', 'fantasma', () =>
          api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo: { activo: u.activo ? 0 : 1 } }),
        ),
        botonUsuario(u.rol === 'admin' ? 'Hacer usuario' : 'Hacer admin', 'fantasma', () =>
          api(`/usuarios/${u.id}`, {
            metodo: 'PATCH',
            cuerpo: { rol: u.rol === 'admin' ? 'usuario' : 'admin' },
          }),
        ),
        botonUsuario('Contraseña', 'fantasma', () => {
          const nueva = prompt(`Nueva contraseña para "${u.usuario}" (mínimo 8 caracteres):`);
          if (!nueva) return null;
          return api(`/usuarios/${u.id}`, { metodo: 'PATCH', cuerpo: { password: nueva } });
        }),
        botonUsuario('Eliminar', 'peligro', () => {
          if (!confirm(`¿Eliminar al usuario "${u.usuario}"?`)) return null;
          return api(`/usuarios/${u.id}`, { metodo: 'DELETE' });
        }),
      );
      tr.append(acciones);
      cuerpo.append(tr);
    }
    tabla.append(cuerpo);
  } catch (e) {
    tabla.innerHTML = `<tbody><tr><td>${escapar(e.message)}</td></tr></tbody>`;
  }
}

function botonUsuario(texto, estilo, accion) {
  const boton = document.createElement('button');
  boton.className = `boton boton--${estilo} boton--mini`;
  boton.style.marginRight = '.35rem';
  boton.textContent = texto;
  boton.addEventListener('click', async () => {
    try {
      const promesa = accion();
      if (!promesa) return;
      await promesa;
      avisar('Cambio guardado.', 'ok');
      await cargarUsuarios();
    } catch (e) {
      avisar(e.message, 'mal');
    }
  });
  return boton;
}

/* ─────────────── Eventos ─────────────── */

$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  const aviso = $('#login-error');
  aviso.hidden = true;
  try {
    const datos = await api('/login', {
      metodo: 'POST',
      cuerpo: { usuario: $('#login-usuario').value, password: $('#login-password').value },
    });
    sesion = datos.usuario;
    await mostrarApp();
  } catch (err) {
    aviso.textContent = err.message;
    aviso.hidden = false;
  }
});

$('#boton-salir').addEventListener('click', async () => {
  try {
    await api('/logout', { metodo: 'POST' });
  } catch {
    /* da igual: cerramos igualmente */
  }
  sesion = null;
  mostrarLogin();
});

$('#pestanas').addEventListener('click', (e) => {
  const pestana = e.target.closest('.pestana');
  if (pestana) cambiarVista(pestana.dataset.vista);
});

$('#form-buscar').addEventListener('submit', (e) => {
  e.preventDefault();
  buscar(1);
});

$('#buscar-campo').addEventListener('change', () => {
  const campo = $('#buscar-campo').value;
  $$('.atajo').forEach((a) => a.classList.toggle('activo', a.dataset.campo === campo));
  if ($('#buscar-q').value.trim()) buscar(1);
});

$('#paginacion').addEventListener('click', (e) => {
  const boton = e.target.closest('.boton');
  if (boton && !boton.disabled) buscar(ultimaBusqueda.pagina + Number(boton.dataset.paso));
});

const zona = $('#zona-archivo');
$('#archivo').addEventListener('change', (e) => {
  if (e.target.files[0]) prepararArchivo(e.target.files[0]);
});
zona.addEventListener('dragover', (e) => {
  e.preventDefault();
  zona.classList.add('encima');
});
zona.addEventListener('dragleave', () => zona.classList.remove('encima'));
zona.addEventListener('drop', (e) => {
  e.preventDefault();
  zona.classList.remove('encima');
  const archivo = e.dataTransfer.files[0];
  if (archivo) prepararArchivo(archivo);
});

$('#boton-importar').addEventListener('click', importar);
$('#boton-cancelar-import').addEventListener('click', cancelarImportacion);

$('#form-usuario').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    await api('/usuarios', {
      metodo: 'POST',
      cuerpo: {
        usuario: $('#nuevo-usuario').value,
        nombre: $('#nuevo-nombre').value,
        rol: $('#nuevo-rol').value,
        password: $('#nuevo-password').value,
      },
    });
    avisar('Usuario creado.', 'ok');
    e.target.reset();
    await cargarUsuarios();
  } catch (err) {
    avisar(err.message, 'mal');
  }
});

$('#form-password').addEventListener('submit', async (e) => {
  e.preventDefault();
  if ($('#pass-nueva').value !== $('#pass-repetir').value) {
    avisar('Las contraseñas nuevas no coinciden.', 'mal');
    return;
  }
  try {
    await api('/password', {
      metodo: 'POST',
      cuerpo: { actual: $('#pass-actual').value, nueva: $('#pass-nueva').value },
    });
    avisar('Contraseña actualizada.', 'ok');
    e.target.reset();
  } catch (err) {
    avisar(err.message, 'mal');
  }
});

/* ─────────────── Arranque ─────────────── */

(async function inicio() {
  try {
    const datos = await api('/sesion');
    if (datos.usuario) {
      sesion = datos.usuario;
      await mostrarApp();
      return;
    }
  } catch {
    /* sin sesión */
  }
  mostrarLogin();
})();
