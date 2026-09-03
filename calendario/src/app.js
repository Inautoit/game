// Interfaz del calendario: vistas Hoy / Semana / Mes, panel de día y edición.
(function () {
  'use strict';

  var Store = window.CalStore;
  var Auth = window.CalAuth;
  var Api = window.CalApi;

  var DOW_LARGO = ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado', 'Domingo'];
  var DOW_CORTO = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  var MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio',
               'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
  var TIPOS = {
    entreno:  'Entreno',
    partido:  'Partido',
    descanso: 'Descanso',
    aviso:    'Aviso',
  };

  var vistaActual = 'hoy';
  var anclaMes = null;     // primer día del mes mostrado
  var anclaSemana = null;  // lunes de la semana mostrada
  var diaAbierto = null;
  var editandoId = null;   // id de la entrada con el formulario abierto, o 'nueva'

  var $ = function (sel) { return document.querySelector(sel); };

  // ---------- fechas (todo en hora local, sin sorpresas de zona horaria) ----------

  function iso(d) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }

  function fromIso(s) {
    var p = s.split('-');
    return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2]));
  }

  function hoyIso() { return iso(new Date()); }

  function sumarDias(d, n) {
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() + n);
    return x;
  }

  // Índice de día de la semana con el lunes como 0.
  function dowLunes(d) { return (d.getDay() + 6) % 7; }

  function lunesDe(d) { return sumarDias(d, -dowLunes(d)); }

  function fechaLarga(d) {
    return DOW_LARGO[dowLunes(d)] + ', ' + d.getDate() + ' de ' + MESES[d.getMonth()] + ' de ' + d.getFullYear();
  }

  // ---------- utilidades ----------

  function el(tag, clase, texto) {
    var n = document.createElement(tag);
    if (clase) n.className = clase;
    if (texto != null) n.textContent = texto;
    return n;
  }

  var avisoTimer = null;
  function aviso(mensaje, esError) {
    var caja = $('#aviso');
    caja.textContent = mensaje;
    caja.className = 'aviso' + (esError ? ' error' : '');
    caja.hidden = false;
    clearTimeout(avisoTimer);
    avisoTimer = setTimeout(function () { caja.hidden = true; }, esError ? 6000 : 3000);
  }

  // ---------- piezas reutilizables ----------

  function etiquetaTipo(tipo) {
    var s = el('span', 'etiqueta tipo-' + tipo, TIPOS[tipo] || tipo);
    return s;
  }

  function tarjetaEntrada(fecha, entrada, conAcciones) {
    var card = el('div', 'tarjeta tipo-' + entrada.tipo);
    var cuerpo = el('div', 'tarjeta-cuerpo');

    if (entrada.horario) cuerpo.appendChild(el('div', 'tarjeta-hora', entrada.horario));
    cuerpo.appendChild(el('h3', 'tarjeta-titulo', entrada.titulo || TIPOS[entrada.tipo]));

    var meta = el('div', 'tarjeta-meta');
    meta.appendChild(etiquetaTipo(entrada.tipo));
    if (entrada.lugar) meta.appendChild(document.createTextNode(' · ' + entrada.lugar));
    cuerpo.appendChild(meta);

    if (entrada.notas) cuerpo.appendChild(el('p', 'tarjeta-notas', entrada.notas));
    card.appendChild(cuerpo);

    if (conAcciones && Auth.isUnlocked()) {
      var acciones = el('div', 'tarjeta-acciones');

      var editar = el('button', 'btn btn-small btn-plano', 'Editar');
      editar.type = 'button';
      editar.onclick = function () { editandoId = entrada.id; pintarPanel(); };
      acciones.appendChild(editar);

      var borrar = el('button', 'btn btn-small btn-danger', 'Borrar');
      borrar.type = 'button';
      borrar.onclick = function () {
        if (!confirm('¿Borrar «' + (entrada.titulo || TIPOS[entrada.tipo]) + '»?')) return;
        Store.removeEntry(fecha, entrada.id);
        Auth.keepAlive();
        aviso('Entrada borrada');
      };
      acciones.appendChild(borrar);

      card.appendChild(acciones);
    }

    return card;
  }

  // ---------- vista: HOY ----------

  function vistaHoy() {
    var raiz = el('div');
    var hoy = new Date();
    var claveHoy = iso(hoy);

    var cab = el('div', 'hoy-cab');
    cab.appendChild(el('div', 'dia-semana', DOW_LARGO[dowLunes(hoy)]));
    cab.appendChild(el('h2', 'dia-numero', hoy.getDate() + ' de ' + MESES[hoy.getMonth()]));
    cab.appendChild(el('div', 'anio', String(hoy.getFullYear())));
    raiz.appendChild(cab);

    raiz.appendChild(cabeceraSeccion('Lo de hoy', claveHoy));

    var deHoy = Store.day(claveHoy);
    if (deHoy.length) {
      var lista = el('div', 'tarjetas');
      deHoy.forEach(function (e) { lista.appendChild(tarjetaEntrada(claveHoy, e, false)); });
      raiz.appendChild(lista);
    } else {
      raiz.appendChild(el('div', 'vacio', 'Hoy no hay nada en el calendario.'));
    }

    // Los próximos 14 días con algo apuntado.
    var proximos = [];
    for (var i = 1; i <= 14 && proximos.length < 5; i++) {
      var f = iso(sumarDias(hoy, i));
      if (Store.has(f)) proximos.push(f);
    }

    raiz.appendChild(el('div', 'seccion-titulo', 'Lo que viene'));
    if (proximos.length) {
      var sig = el('div', 'semana');
      proximos.forEach(function (f) { sig.appendChild(filaDia(f)); });
      raiz.appendChild(sig);
    } else {
      raiz.appendChild(el('div', 'vacio', 'Nada apuntado en los próximos 14 días.'));
    }

    return raiz;
  }

  function cabeceraSeccion(texto, fechaParaAnadir) {
    var h = el('div', 'seccion-titulo', texto);
    if (fechaParaAnadir && Auth.isUnlocked()) {
      var b = el('button', 'btn btn-small', '+ Añadir');
      b.type = 'button';
      b.onclick = function () { abrirDia(fechaParaAnadir, true); };
      h.appendChild(b);
    }
    return h;
  }

  // ---------- vista: SEMANA ----------

  function filaDia(fecha) {
    var d = fromIso(fecha);
    var entradas = Store.day(fecha);

    var fila = el('button', 'semana-dia' + (entradas.length ? '' : ' sin-nada') + (fecha === hoyIso() ? ' es-hoy' : ''));
    fila.type = 'button';
    fila.setAttribute('aria-label', fechaLarga(d) + ', ' + (entradas.length ? entradas.length + ' actividades' : 'sin actividad'));
    fila.onclick = function () { abrirDia(fecha, false); };

    var izq = el('div', 'semana-fecha');
    izq.appendChild(el('span', 'dow', DOW_CORTO[dowLunes(d)]));
    izq.appendChild(el('span', 'num', String(d.getDate())));
    fila.appendChild(izq);

    var der = el('div', 'semana-lista');
    if (entradas.length) {
      entradas.forEach(function (e) {
        var it = el('div', 'semana-item');
        if (e.horario) it.appendChild(el('span', 'h', e.horario));
        it.appendChild(el('span', 't', e.titulo || TIPOS[e.tipo]));
        if (e.lugar) it.appendChild(el('span', 'l', '· ' + e.lugar));
        der.appendChild(it);
      });
    } else {
      der.appendChild(el('div', 'semana-nada', 'Sin actividad'));
    }
    fila.appendChild(der);

    return fila;
  }

  function vistaSemana() {
    if (!anclaSemana) anclaSemana = lunesDe(new Date());
    var raiz = el('div');
    var fin = sumarDias(anclaSemana, 6);

    var titulo = anclaSemana.getDate() + ' ' + MESES[anclaSemana.getMonth()].slice(0, 3) +
      ' – ' + fin.getDate() + ' ' + MESES[fin.getMonth()].slice(0, 3) + ' ' + fin.getFullYear();

    raiz.appendChild(navPeriodo(titulo, function (paso) {
      anclaSemana = sumarDias(anclaSemana, paso * 7);
      render();
    }, function () {
      anclaSemana = lunesDe(new Date());
      render();
    }));

    var lista = el('div', 'semana');
    for (var i = 0; i < 7; i++) lista.appendChild(filaDia(iso(sumarDias(anclaSemana, i))));
    raiz.appendChild(lista);

    return raiz;
  }

  function navPeriodo(titulo, mover, alHoy) {
    var nav = el('div', 'nav-periodo');

    var atras = el('button', 'btn btn-small btn-plano', '‹');
    atras.type = 'button';
    atras.setAttribute('aria-label', 'Anterior');
    atras.onclick = function () { mover(-1); };
    nav.appendChild(atras);

    nav.appendChild(el('h2', '', titulo));

    var hoyBtn = el('button', 'btn btn-small btn-plano', 'Hoy');
    hoyBtn.type = 'button';
    hoyBtn.onclick = alHoy;
    nav.appendChild(hoyBtn);

    var alante = el('button', 'btn btn-small btn-plano', '›');
    alante.type = 'button';
    alante.setAttribute('aria-label', 'Siguiente');
    alante.onclick = function () { mover(1); };
    nav.appendChild(alante);

    return nav;
  }

  // ---------- vista: MES ----------

  function vistaMes() {
    if (!anclaMes) {
      var h = new Date();
      anclaMes = new Date(h.getFullYear(), h.getMonth(), 1);
    }

    var raiz = el('div');
    raiz.appendChild(navPeriodo(MESES[anclaMes.getMonth()] + ' ' + anclaMes.getFullYear(), function (paso) {
      anclaMes = new Date(anclaMes.getFullYear(), anclaMes.getMonth() + paso, 1);
      render();
    }, function () {
      var n = new Date();
      anclaMes = new Date(n.getFullYear(), n.getMonth(), 1);
      render();
    }));

    var cab = el('div', 'mes-cabecera');
    DOW_CORTO.forEach(function (d) { cab.appendChild(el('div', '', d)); });
    raiz.appendChild(cab);

    var rejilla = el('div', 'mes-rejilla');
    var inicio = lunesDe(anclaMes);
    var claveHoy = hoyIso();

    for (var i = 0; i < 42; i++) {
      var d = sumarDias(inicio, i);
      var fecha = iso(d);
      var fuera = d.getMonth() !== anclaMes.getMonth();

      var entradas = Store.day(fecha);

      var celda = el('button', 'celda' + (fuera ? ' fuera' : '') + (fecha === claveHoy ? ' es-hoy' : ''));
      celda.type = 'button';
      // En móvil las actividades se ven como puntos: el lector de pantalla
      // necesita el texto completo aquí.
      celda.setAttribute('aria-label', fechaLarga(d) + '. ' + (entradas.length
        ? entradas.map(function (e) { return (e.titulo || TIPOS[e.tipo]) + (e.horario ? ' ' + e.horario : ''); }).join('; ')
        : 'Sin actividad'));
      celda.onclick = (function (f) { return function () { abrirDia(f, false); }; })(fecha);

      celda.appendChild(el('div', 'celda-num', String(d.getDate())));

      var chips = el('div', 'celda-chips');
      entradas.slice(0, 3).forEach(function (e) {
        var texto = (e.titulo || TIPOS[e.tipo]);
        // Solo se antepone la hora si de verdad lo es ("16:30"), no
        // textos como "Por confirmar", que quedarían cortados en "Por…".
        var hora = /^\d{1,2}[:.]\d{2}/.test(e.horario) ? e.horario.split(' ')[0] + ' ' : '';
        var chip = el('div', 'chip tipo-' + e.tipo, hora + texto);
        chip.title = texto + (e.horario ? ' · ' + e.horario : '') + (e.lugar ? ' · ' + e.lugar : '');
        chips.appendChild(chip);
      });
      if (entradas.length > 3) chips.appendChild(el('div', 'chip', '+' + (entradas.length - 3) + ' más'));
      celda.appendChild(chips);

      rejilla.appendChild(celda);
    }
    raiz.appendChild(rejilla);

    var leyenda = el('div', 'leyenda');
    Object.keys(TIPOS).map(function (k) { return [k, TIPOS[k]]; })
      .forEach(function (par) {
        var s = el('span', 'lg-' + par[0]);
        s.appendChild(el('i'));
        s.appendChild(document.createTextNode(par[1]));
        leyenda.appendChild(s);
      });
    raiz.appendChild(leyenda);

    return raiz;
  }

  // ---------- panel de un día ----------

  function abrirDia(fecha, nueva) {
    diaAbierto = fecha;
    editandoId = nueva && Auth.isUnlocked() ? 'nueva' : null;
    pintarPanel();
    $('#panel').hidden = false;
    document.body.style.overflow = 'hidden';
  }

  function cerrarPanel() {
    diaAbierto = null;
    editandoId = null;
    $('#panel').hidden = true;
    document.body.style.overflow = '';
  }

  function pintarPanel() {
    if (!diaAbierto) return;
    var fecha = diaAbierto;
    var cuerpo = $('#panel-cuerpo');
    cuerpo.textContent = '';
    $('#panel-titulo').textContent = fechaLarga(fromIso(fecha));

    var entradas = Store.day(fecha);

    if (entradas.length) {
      var lista = el('div', 'tarjetas');
      entradas.forEach(function (e) {
        if (editandoId === e.id) {
          lista.appendChild(formularioEntrada(fecha, e));
        } else {
          lista.appendChild(tarjetaEntrada(fecha, e, true));
        }
      });
      cuerpo.appendChild(lista);
    } else if (editandoId !== 'nueva') {
      cuerpo.appendChild(el('div', 'vacio', 'Nada apuntado este día.'));
    }

    if (!Auth.isUnlocked()) return;

    if (editandoId === 'nueva') {
      cuerpo.appendChild(formularioEntrada(fecha, null));
      return;
    }

    var acciones = el('div', 'form-acciones');

    var add = el('button', 'btn', '+ Añadir actividad');
    add.type = 'button';
    add.onclick = function () { editandoId = 'nueva'; pintarPanel(); };
    acciones.appendChild(add);

    if (entradas.length) {
      var vaciar = el('button', 'btn btn-danger', 'Vaciar el día');
      vaciar.type = 'button';
      vaciar.onclick = function () {
        if (!confirm('¿Borrar las ' + entradas.length + ' actividades de este día?')) return;
        Store.clearDay(fecha);
        Auth.keepAlive();
        aviso('Día vaciado');
      };
      acciones.appendChild(vaciar);
    }

    cuerpo.appendChild(acciones);
  }

  function campo(etiqueta, control) {
    var l = el('label', 'campo');
    l.appendChild(el('span', '', etiqueta));
    l.appendChild(control);
    return l;
  }

  function entrada(valor, placeholder) {
    var i = document.createElement('input');
    i.type = 'text';
    i.value = valor || '';
    if (placeholder) i.placeholder = placeholder;
    return i;
  }

  function formularioEntrada(fecha, existente) {
    var form = el('form', 'form-editor');

    var selTipo = document.createElement('select');
    Object.keys(TIPOS).forEach(function (k) {
      var o = document.createElement('option');
      o.value = k;
      o.textContent = TIPOS[k];
      if (existente && existente.tipo === k) o.selected = true;
      selTipo.appendChild(o);
    });

    var inTitulo  = entrada(existente && existente.titulo, 'Ej.: RSA + FZA, o el rival');
    var inHorario = entrada(existente && existente.horario, 'Ej.: 16:30 a 18:30');
    var inLugar   = entrada(existente && existente.lugar, 'Ej.: Cantera 1');

    var inFecha = document.createElement('input');
    inFecha.type = 'date';
    inFecha.value = fecha;

    var txNotas = document.createElement('textarea');
    txNotas.value = (existente && existente.notas) || '';
    txNotas.placeholder = 'Convocatoria, material, quedada…';

    form.appendChild(campo('Actividad', inTitulo));

    var fila = el('div', 'campos-2');
    fila.appendChild(campo('Tipo', selTipo));
    fila.appendChild(campo('Horario', inHorario));
    form.appendChild(fila);

    var fila2 = el('div', 'campos-2');
    fila2.appendChild(campo('Pista / lugar', inLugar));
    fila2.appendChild(campo('Fecha', inFecha));
    form.appendChild(fila2);

    form.appendChild(campo('Notas', txNotas));

    var acciones = el('div', 'form-acciones');
    var guardar = el('button', 'btn', existente ? 'Guardar cambios' : 'Añadir');
    guardar.type = 'submit';
    acciones.appendChild(guardar);

    var cancelar = el('button', 'btn btn-plano', 'Cancelar');
    cancelar.type = 'button';
    cancelar.onclick = function () { editandoId = null; pintarPanel(); };
    acciones.appendChild(cancelar);
    form.appendChild(acciones);

    form.onsubmit = function (ev) {
      ev.preventDefault();
      var datos = {
        tipo: selTipo.value,
        titulo: inTitulo.value.trim(),
        horario: inHorario.value.trim(),
        lugar: inLugar.value.trim(),
        notas: txNotas.value.trim(),
      };
      if (!datos.titulo && datos.tipo !== 'descanso') {
        aviso('Ponle un nombre a la actividad', true);
        inTitulo.focus();
        return;
      }
      var destino = /^\d{4}-\d{2}-\d{2}$/.test(inFecha.value) ? inFecha.value : fecha;

      if (existente && destino === fecha) {
        Store.updateEntry(fecha, existente.id, datos);
      } else {
        if (existente) Store.removeEntry(fecha, existente.id);
        Store.addEntry(destino, datos);
      }

      Auth.keepAlive();
      editandoId = null;
      if (destino !== fecha) {
        diaAbierto = destino;
        aviso('Movido al ' + fechaLarga(fromIso(destino)));
      } else {
        aviso(existente ? 'Cambios guardados' : 'Actividad añadida');
      }
      pintarPanel();
    };

    setTimeout(function () { inTitulo.focus(); }, 30);
    return form;
  }

  // ---------- modal genérico ----------

  function abrirModal(titulo, construir) {
    $('#modal-titulo').textContent = titulo;
    var cuerpo = $('#modal-cuerpo');
    cuerpo.textContent = '';
    cuerpo.appendChild(construir(cerrarModal));
    $('#modal').hidden = false;
  }

  function cerrarModal() { $('#modal').hidden = true; }

  function pedirContrasena() {
    abrirModal('Entrar en modo edición', function (cerrar) {
      var form = el('form');
      var inp = document.createElement('input');
      inp.type = 'password';
      inp.autocomplete = 'current-password';
      inp.placeholder = 'Contraseña';
      form.appendChild(campo('Contraseña del entrenador', inp));

      var err = el('p', 'nota');
      err.hidden = true;
      form.appendChild(err);

      var acciones = el('div', 'form-acciones');
      var ok = el('button', 'btn', 'Entrar');
      ok.type = 'submit';
      acciones.appendChild(ok);
      var no = el('button', 'btn btn-plano', 'Cancelar');
      no.type = 'button';
      no.onclick = cerrar;
      acciones.appendChild(no);
      form.appendChild(acciones);

      form.onsubmit = function (ev) {
        ev.preventDefault();
        ok.disabled = true;
        ok.textContent = 'Comprobando…';
        Auth.unlock(inp.value).then(function (bien) {
          ok.disabled = false;
          ok.textContent = 'Entrar';
          if (bien) {
            cerrar();
            aviso('Modo edición activado');
            return;
          }
          err.hidden = false;
          err.textContent = 'Contraseña incorrecta.';
          inp.select();
        }).catch(function (e) {
          ok.disabled = false;
          ok.textContent = 'Entrar';
          err.hidden = false;
          err.textContent = 'No se pudo comprobar la contraseña: ' + e.message;
        });
      };

      setTimeout(function () { inp.focus(); }, 30);
      return form;
    });
  }

  // ---------- acciones de la barra de edición ----------

  var acciones = {
    sincronizar: function () {
      aviso('Publicando…');
      Store.push().then(function () {
        aviso('Publicado. Ya lo ve todo el mundo.');
      }).catch(function (err) {
        aviso('No se pudo publicar: ' + err.message, true);
      });
    },

    restaurar: function () {
      if (!confirm('Vas a volver al calendario original del PDF y perder todos los cambios. ¿Seguro?')) return;
      Store.resetToSeed();
      aviso('Calendario original restaurado');
    },

    salir: function () {
      Auth.lock();
      aviso('Modo edición cerrado');
    },
  };

  // ---------- pintado general ----------

  function render() {
    var datos = Store.get();
    $('#equipo').textContent = datos.equipo;
    $('#subtitulo').textContent = datos.titulo;

    var f = new Date(datos.actualizado);
    $('#actualizado').textContent = isNaN(f.getTime()) ? '—' :
      f.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' }) +
      ', ' + f.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    var contenedor = $('#vista');
    contenedor.textContent = '';
    if (vistaActual === 'hoy') contenedor.appendChild(vistaHoy());
    else if (vistaActual === 'semana') contenedor.appendChild(vistaSemana());
    else contenedor.appendChild(vistaMes());

    if (diaAbierto) pintarPanel();
  }

  function pintarEstadoEditor(desbloqueado) {
    $('#badge-editor').hidden = !desbloqueado;
    $('#editorbar').hidden = !desbloqueado;
    $('#btn-editar').textContent = desbloqueado ? 'Bloquear' : 'Editar';
    // Con backend los cambios se suben solos, pero dejamos el botón para
    // reintentar si algo falló. Sin backend no hay nada que publicar.
    $('#editorbar [data-accion="sincronizar"]').hidden = !Api.isAvailable();
    $('#editorbar-nota').textContent = Api.isAvailable()
      ? 'Los cambios se guardan solos y los ve todo el equipo. Ojo: no hay deshacer. La contraseña se cambia en Cloudflare (Settings → Variables and Secrets).'
      : 'Sin servidor: los cambios se guardan solo en este dispositivo, nadie más los ve.';
    render();
  }

  // ---------- arranque ----------

  function conectarEventos() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.onclick = function () {
        vistaActual = tab.dataset.view;
        document.querySelectorAll('.tab').forEach(function (t) {
          var activo = t === tab;
          t.classList.toggle('is-active', activo);
          t.setAttribute('aria-selected', activo ? 'true' : 'false');
        });
        render();
      };
    });

    $('#btn-editar').onclick = function () {
      if (Auth.isUnlocked()) { Auth.lock(); aviso('Modo edición cerrado'); }
      else pedirContrasena();
    };

    $('#editorbar').addEventListener('click', function (ev) {
      var b = ev.target.closest('[data-accion]');
      if (b && acciones[b.dataset.accion]) { Auth.keepAlive(); acciones[b.dataset.accion](); }
    });

    // Cerrar paneles: botón, clic fuera o Escape.
    [['#panel', cerrarPanel], ['#modal', cerrarModal]].forEach(function (par) {
      var nodo = $(par[0]);
      nodo.addEventListener('click', function (ev) {
        if (ev.target === nodo || ev.target.closest('[data-cerrar]')) par[1]();
      });
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!$('#modal').hidden) cerrarModal();
      else if (!$('#panel').hidden) cerrarPanel();
    });

    Store.onChange(render);
    Auth.onChange(pintarEstadoEditor);

    Store.onSave(function (estado, err) {
      if (estado === 'guardando') aviso('Guardando…');
      else if (estado === 'guardado') aviso('Guardado para todo el equipo');
      else if (estado === 'error') aviso('No se pudo guardar en el servidor: ' + err.message, true);
    });

    // Al volver a la pestaña, refrescar por si otro dispositivo cambió algo.
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Store.syncEnabled()) {
        Store.pull().catch(function () { /* seguimos con la copia local */ });
      }
    });
  }

  function registrarServiceWorker() {
    // Requiere contexto seguro: https, localhost o 127.0.0.1.
    if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
    // La versión de un solo archivo no lleva manifest ni sw.js.
    if (!document.querySelector('link[rel="manifest"]')) return;
    navigator.serviceWorker.register('./sw.js').catch(function (err) {
      console.warn('Service worker no registrado:', err.message);
    });
  }

  // Los accesos directos de la PWA abren la web con ?vista=hoy|semana|mes.
  function vistaInicial() {
    var pedida = new URLSearchParams(location.search).get('vista');
    if (['hoy', 'semana', 'mes'].indexOf(pedida) < 0) return;
    vistaActual = pedida;
    document.querySelectorAll('.tab').forEach(function (t) {
      var activo = t.dataset.view === pedida;
      t.classList.toggle('is-active', activo);
      t.setAttribute('aria-selected', activo ? 'true' : 'false');
    });
  }

  function iniciar() {
    vistaInicial();
    conectarEventos();
    Store.init().then(function () {
      Auth.init();
      render();
    });
    Auth.init();
    render();
    registrarServiceWorker();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', iniciar);
  } else {
    iniciar();
  }
})();
