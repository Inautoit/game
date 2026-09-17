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

  // ---------- resultados de los partidos ----------

  function tieneResultado(e) {
    return e && e.golesFavor !== null && e.golesFavor !== undefined &&
           e.golesContra !== null && e.golesContra !== undefined;
  }

  // 'ganado' | 'empatado' | 'perdido'
  function signoResultado(e) {
    if (e.golesFavor > e.golesContra) return 'ganado';
    if (e.golesFavor < e.golesContra) return 'perdido';
    return 'empatado';
  }

  var LETRA = { ganado: 'V', empatado: 'E', perdido: 'D' };
  var PALABRA = { ganado: 'Victoria', empatado: 'Empate', perdido: 'Derrota' };

  function marcadorNodo(e, conLetra) {
    var signo = signoResultado(e);
    var caja = el('span', 'marcador ' + signo);
    caja.appendChild(el('strong', '', String(e.golesFavor)));
    caja.appendChild(el('span', 'guion', '–'));
    caja.appendChild(el('strong', '', String(e.golesContra)));
    if (conLetra) caja.appendChild(el('span', 'letra', LETRA[signo]));
    caja.title = PALABRA[signo] + ' ' + e.golesFavor + '-' + e.golesContra;
    return caja;
  }

  // ---------- piezas reutilizables ----------

  // Enlace a la ficha del equipo en la federación. Abre en otra pestaña,
  // con rel="noopener" para que la página de destino no toque la nuestra.
  function enlaceFederacion(clase) {
    var fed = window.CAL_CONFIG.federacion;
    if (!fed || !fed.url) return null;

    var a = document.createElement('a');
    a.className = clase || 'btn btn-federacion';
    a.href = fed.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.appendChild(document.createTextNode(fed.etiqueta || 'Ficha en la Federación'));
    a.appendChild(el('span', 'fuera-icono', '↗'));
    return a;
  }

  function etiquetaTipo(tipo) {
    var s = el('span', 'etiqueta tipo-' + tipo, TIPOS[tipo] || tipo);
    return s;
  }

  function tarjetaEntrada(fecha, entrada, conAcciones) {
    var card = el('div', 'tarjeta tipo-' + entrada.tipo);
    var cuerpo = el('div', 'tarjeta-cuerpo');

    if (entrada.horario) cuerpo.appendChild(el('div', 'tarjeta-hora', entrada.horario));
    cuerpo.appendChild(el('h3', 'tarjeta-titulo', entrada.titulo || TIPOS[entrada.tipo]));
    if (tieneResultado(entrada)) cuerpo.appendChild(marcadorNodo(entrada, true));

    var meta = el('div', 'tarjeta-meta');
    meta.appendChild(etiquetaTipo(entrada.tipo));
    if (entrada.aplazado) meta.appendChild(el('span', 'etiqueta etiqueta-aplazado', 'Aplazado'));
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

  // La lista de "lo que viene" no tiene tope: empieza por hoy y sigue
  // hacia delante, cargando más conforme se baja.
  var POR_TANDA = 10;
  var hoyPintados = 0;
  var hoyObservador = null;

  // Todos los días con algo apuntado de mañana en adelante.
  function diasPorVenir() {
    var datos = Store.get();
    var manana = iso(sumarDias(new Date(), 1));
    return Object.keys(datos.dias).filter(function (f) {
      return f >= manana;
    }).sort();
  }

  function vistaHoy() {
    if (hoyObservador) { hoyObservador.disconnect(); hoyObservador = null; }

    var raiz = el('div');
    var hoy = new Date();
    var claveHoy = iso(hoy);

    var cab = el('div', 'hoy-cab');
    cab.appendChild(el('div', 'dia-semana', DOW_LARGO[dowLunes(hoy)]));
    cab.appendChild(el('h2', 'dia-numero', hoy.getDate() + ' de ' + MESES[hoy.getMonth()]));
    cab.appendChild(el('div', 'anio', String(hoy.getFullYear())));
    raiz.appendChild(cab);

    var avisos = tarjetaAvisos();
    if (avisos) raiz.appendChild(avisos);

    raiz.appendChild(cabeceraSeccion('Lo de hoy', claveHoy));

    var deHoy = Store.day(claveHoy);
    if (deHoy.length) {
      var lista = el('div', 'tarjetas');
      deHoy.forEach(function (e) { lista.appendChild(tarjetaEntrada(claveHoy, e, false)); });
      raiz.appendChild(lista);
    } else {
      raiz.appendChild(el('div', 'vacio', 'Hoy no hay nada en el calendario.'));
    }

    var fechas = diasPorVenir();
    raiz.appendChild(el('div', 'seccion-titulo', 'Lo que viene'));

    if (!fechas.length) {
      raiz.appendChild(el('div', 'vacio', 'No queda nada apuntado más adelante.'));
      return raiz;
    }

    var sig = el('div', 'semana');
    raiz.appendChild(sig);

    var pie = el('div', 'mas-dias');
    var boton = el('button', 'btn btn-plano', 'Ver más días');
    boton.type = 'button';
    pie.appendChild(boton);
    raiz.appendChild(pie);

    // Al volver a pintar (un cambio del calendario, entrar en edición) se
    // mantiene lo que ya se había desplegado, para no saltar hacia arriba.
    if (!hoyPintados) hoyPintados = POR_TANDA;

    function pintar() {
      sig.textContent = '';
      var cuantos = Math.min(hoyPintados, fechas.length);
      for (var i = 0; i < cuantos; i++) sig.appendChild(filaDia(fechas[i]));

      if (cuantos >= fechas.length) {
        pie.textContent = '';
        pie.appendChild(el('p', 'mas-fin', 'Eso es todo lo que hay apuntado.'));
        if (hoyObservador) { hoyObservador.disconnect(); hoyObservador = null; }
      }
    }

    boton.onclick = function () {
      hoyPintados += POR_TANDA;
      pintar();
    };

    pintar();

    // Con IntersectionObserver la carga es automática al llegar al final;
    // sin él queda el botón, que hace lo mismo a mano.
    if (typeof IntersectionObserver === 'function') {
      hoyObservador = new IntersectionObserver(function (entradas) {
        if (!entradas[0].isIntersecting) return;
        if (hoyPintados >= fechas.length) return;
        hoyPintados += POR_TANDA;
        pintar();
      }, { rootMargin: '400px' });
      // Observar en cuanto el nodo esté en la página.
      setTimeout(function () {
        if (hoyObservador && pie.isConnected) hoyObservador.observe(pie);
      }, 0);
    }

    return raiz;
  }

  // Interruptor de los avisos. Se pinta vacío y se rellena cuando el
  // navegador y el servidor contestan: ninguna de las dos cosas se sabe
  // en el momento de montar la vista.
  var avisosActivos = null;   // null = todavía no se sabe

  function tarjetaAvisos() {
    if (!window.CalAvisos || !CalAvisos.soportado()) return null;

    var caja = el('div', 'avisos');
    caja.hidden = true;

    CalAvisos.consultar().then(function (hay) {
      if (!hay) return null;
      return CalAvisos.estado();
    }).then(function (suscrito) {
      if (suscrito === null || suscrito === undefined) return;
      avisosActivos = suscrito;
      pintarAvisos(caja);
      caja.hidden = false;
    }).catch(function () { /* sin avisos, la web va igual */ });

    return caja;
  }

  function pintarAvisos(caja) {
    caja.textContent = '';
    caja.className = 'avisos' + (avisosActivos ? ' encendidos' : '');

    var texto = el('div', 'avisos-texto');
    texto.appendChild(el('strong', '', avisosActivos
      ? 'Avisos encendidos'
      : 'Avisarme de los cambios'));
    texto.appendChild(el('small', '', avisosActivos
      ? 'Te llega un aviso al móvil cuando se actualiza el calendario.'
      : 'Un aviso al móvil cuando el entrenador cambia algo. Se agrupan: nunca más de uno seguido.'));
    caja.appendChild(texto);

    var boton = el('button', 'btn btn-small' + (avisosActivos ? ' btn-plano' : ''),
                   avisosActivos ? 'Quitar' : 'Activar');
    boton.type = 'button';
    boton.onclick = function () {
      boton.disabled = true;
      var accion = avisosActivos ? CalAvisos.desactivar() : CalAvisos.activar();
      accion.then(function () {
        avisosActivos = !avisosActivos;
        aviso(avisosActivos ? 'Avisos encendidos' : 'Avisos quitados');
        pintarAvisos(caja);
      }).catch(function (err) {
        boton.disabled = false;
        aviso(err.message || 'No se pudieron activar los avisos', true);
      });
    };
    caja.appendChild(boton);

    // En iPhone hay que instalar la web antes; si no, el botón no hace nada.
    if (!avisosActivos && CalAvisos.esIOS() && !CalAvisos.instalada()) {
      caja.appendChild(el('p', 'avisos-nota',
        'En iPhone hay que añadir antes la web a la pantalla de inicio: botón compartir → «Añadir a pantalla de inicio».'));
    }
  }

  function cabeceraSeccion(texto, fechaParaAnadir) {
    var h = el('div', 'seccion-titulo', texto);
    if (fechaParaAnadir && Auth.isUnlocked()) {
      // Abre la ficha del día entera, no solo el alta: desde ahí se puede
      // además copiar el día, pegar otro o vaciarlo.
      var b = el('button', 'btn btn-small', 'Editar el día');
      b.type = 'button';
      b.onclick = function () { abrirDia(fechaParaAnadir, false); };
      h.appendChild(b);
    }
    return h;
  }

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
        var it = el('div', 'semana-item' + (e.aplazado ? ' aplazado' : ''));
        if (e.horario) it.appendChild(el('span', 'h', e.horario));
        it.appendChild(el('span', 't', e.titulo || TIPOS[e.tipo]));
        if (tieneResultado(e)) it.appendChild(marcadorNodo(e, false));
        if (e.aplazado) it.appendChild(el('span', 'marca-aplazado', 'Aplazado'));
        if (e.lugar) it.appendChild(el('span', 'l', '· ' + e.lugar));
        der.appendChild(it);
      });
    } else {
      der.appendChild(el('div', 'semana-nada', 'Sin actividad'));
    }
    fila.appendChild(der);

    return fila;
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
        var chip = el('div', 'chip tipo-' + e.tipo + (e.aplazado ? ' aplazado' : ''), hora + texto);
        chip.title = texto + (e.aplazado ? ' (aplazado)' : '') +
          (e.horario ? ' · ' + e.horario : '') + (e.lugar ? ' · ' + e.lugar : '');
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

  // ---------- vista: PARTIDOS ----------

  // Todos los partidos de la temporada, agrupados por mes.
  function partidosDeLaTemporada() {
    var datos = Store.get();
    var salida = [];
    Object.keys(datos.dias).sort().forEach(function (fecha) {
      Store.day(fecha).forEach(function (e) {
        if (e.tipo === 'partido') salida.push({ fecha: fecha, entrada: e });
      });
    });
    return salida;
  }

  function vistaPartidos() {
    var raiz = el('div');
    var partidos = partidosDeLaTemporada();
    var claveHoy = hoyIso();

    // Un partido aplazado no cuenta ni como jugado ni como pendiente:
    // no se jugó, aunque su fecha ya pasara, y todavía no tiene fecha nueva.
    var aplazados = partidos.filter(function (p) { return p.entrada.aplazado; }).length;
    var jugados = partidos.filter(function (p) {
      return !p.entrada.aplazado && (p.fecha < claveHoy || tieneResultado(p.entrada));
    }).length;
    var quedan = partidos.length - jugados - aplazados;

    var datos = [[partidos.length, 'partidos'], [jugados, 'jugados'], [quedan, 'por jugar']];
    if (aplazados) datos.push([aplazados, aplazados === 1 ? 'aplazado' : 'aplazados']);

    var resumen = el('div', 'resumen' + (aplazados ? ' resumen-4' : ''));
    datos.forEach(function (par) {
      var caja = el('div', 'resumen-dato' + (par[1].indexOf('aplazad') === 0 ? ' es-aplazado' : ''));
      caja.appendChild(el('strong', '', String(par[0])));
      caja.appendChild(el('span', '', par[1]));
      resumen.appendChild(caja);
    });
    raiz.appendChild(resumen);

    var fed = enlaceFederacion();
    if (fed) raiz.appendChild(fed);

    if (!partidos.length) {
      raiz.appendChild(el('div', 'vacio', 'Todavía no hay ningún partido en el calendario.'));
      return raiz;
    }

    // Un bloque por mes, con los partidos de ese mes en tarjetas.
    var mesActual = '';
    var rejilla = null;

    partidos.forEach(function (p) {
      var d = fromIso(p.fecha);
      var mes = MESES[d.getMonth()] + ' ' + d.getFullYear();

      if (mes !== mesActual) {
        mesActual = mes;
        raiz.appendChild(el('div', 'seccion-titulo', mes));
        rejilla = el('div', 'partidos');
        raiz.appendChild(rejilla);
      }

      rejilla.appendChild(tarjetaPartido(p.fecha, p.entrada, claveHoy));
    });

    return raiz;
  }

  function tarjetaPartido(fecha, entrada, claveHoy) {
    var d = fromIso(fecha);
    var aplazado = !!entrada.aplazado;
    var pasado = !aplazado && (fecha < claveHoy || tieneResultado(entrada));

    var card = el('button', 'partido' + (pasado ? ' jugado' : '') +
      (aplazado ? ' es-aplazado' : '') + (!aplazado && fecha === claveHoy ? ' es-hoy' : ''));
    card.type = 'button';
    card.setAttribute('aria-label', entrada.titulo + ', ' + fechaLarga(d) +
      (aplazado ? '. Aplazado' : ''));
    card.onclick = function () { abrirDia(fecha, false); };

    var cal = el('div', 'partido-fecha');
    cal.appendChild(el('span', 'mes', MESES[d.getMonth()].slice(0, 3).toUpperCase()));
    cal.appendChild(el('span', 'dia', String(d.getDate())));
    cal.appendChild(el('span', 'dow', DOW_CORTO[dowLunes(d)]));
    card.appendChild(cal);

    var cuerpo = el('div', 'partido-cuerpo');
    cuerpo.appendChild(el('h3', 'partido-rival', entrada.titulo || 'Partido'));

    var meta = el('div', 'partido-meta');
    if (entrada.horario) meta.appendChild(el('span', 'partido-hora', entrada.horario));
    if (entrada.lugar) meta.appendChild(el('span', '', entrada.lugar));
    cuerpo.appendChild(meta);

    if (entrada.notas) cuerpo.appendChild(el('p', 'partido-notas', entrada.notas));
    card.appendChild(cuerpo);

    if (aplazado) {
      card.appendChild(el('span', 'partido-sello sello-aplazado', 'Aplazado'));
    } else if (tieneResultado(entrada)) {
      card.classList.add('con-resultado', signoResultado(entrada));
      card.appendChild(marcadorNodo(entrada, true));
    } else if (pasado) {
      card.appendChild(el('span', 'partido-sello', 'Jugado'));
    }

    return card;
  }

  // ---------- vista: FOTOS ----------

  var fotosCache = null;      // lo que se está mostrando
  var fotosEstado = 'sin-cargar';

  // El listado de Cloudflare tarda hasta un minuto en incluir una foto
  // recién subida (y en olvidar una recién borrada). Para que quien sube
  // la vea al momento, se recuerda aquí lo hecho en esta sesión y se
  // mezcla con lo que llega del servidor.
  var fotosRecientes = [];
  var fotosBorradas = {};

  function mezclarFotos(delServidor) {
    var lista = delServidor.filter(function (f) { return !fotosBorradas[f.id]; });
    var yaEstan = {};
    lista.forEach(function (f) { yaEstan[f.id] = true; });

    // Las subidas hace poco que el servidor todavía no lista van delante.
    fotosRecientes = fotosRecientes.filter(function (f) {
      return !yaEstan[f.id] && !fotosBorradas[f.id];
    });

    return fotosRecientes.concat(lista);
  }

  function vistaFotos() {
    var raiz = el('div');

    if (!Api.isAvailable()) {
      raiz.appendChild(el('div', 'vacio', 'Las fotos necesitan el servidor. Abre la web publicada en Cloudflare.'));
      return raiz;
    }

    // Zona de subida: la puede usar cualquiera, sin contraseña.
    var subida = el('div', 'subida');
    var boton = el('button', 'btn', '📷  Subir fotos');
    boton.type = 'button';
    boton.onclick = function () { $('#file-fotos').click(); };
    subida.appendChild(boton);
    subida.appendChild(el('p', 'subida-nota',
      'Cualquiera del equipo puede subir fotos. Las tuyas las puedes borrar tú desde este mismo móvil; ' +
      'el entrenador puede borrar cualquiera. Se reducen antes de enviarlas, así que no gastan datos de más.'));
    raiz.appendChild(subida);

    var entrada = document.createElement('input');
    entrada.type = 'file';
    entrada.id = 'file-fotos';
    entrada.accept = 'image/*';
    entrada.multiple = true;
    entrada.hidden = true;
    entrada.onchange = function (ev) {
      var files = Array.prototype.slice.call(ev.target.files || []);
      ev.target.value = '';
      if (files.length) subirFotos(files);
    };
    raiz.appendChild(entrada);

    var galeria = el('div', 'galeria');
    galeria.id = 'galeria';
    raiz.appendChild(galeria);

    pintarGaleria(galeria);
    if (fotosEstado === 'sin-cargar') cargarFotos();

    return raiz;
  }

  function pintarGaleria(nodo) {
    var galeria = nodo || document.getElementById('galeria');
    if (!galeria) return;
    galeria.textContent = '';

    if (fotosEstado === 'cargando' && !fotosCache) {
      galeria.appendChild(el('div', 'vacio', 'Cargando fotos…'));
      return;
    }
    if (fotosEstado === 'error') {
      galeria.appendChild(el('div', 'vacio', 'No se pudieron cargar las fotos. Prueba a recargar.'));
      return;
    }
    if (!fotosCache || !fotosCache.length) {
      galeria.appendChild(el('div', 'vacio', 'Todavía no hay fotos. Sube la primera.'));
      return;
    }

    fotosCache.forEach(function (foto) {
      var b = el('button', 'foto');
      b.type = 'button';
      b.onclick = function () { abrirVisor(foto); };

      var img = document.createElement('img');
      img.src = CalFotos.urlDe(foto.id);
      img.alt = foto.nombre;
      img.loading = 'lazy';
      img.decoding = 'async';
      b.appendChild(img);

      var pie = foto.autor || '';
      if (CalFotos.esMia(foto.id)) {
        b.classList.add('mia');
        pie = pie ? pie + ' · tuya' : 'tuya';
      }
      if (pie) b.appendChild(el('span', 'foto-autor', pie));
      galeria.appendChild(b);
    });
  }

  function cargarFotos() {
    fotosEstado = 'cargando';
    pintarGaleria();
    return CalFotos.listar().then(function (lista) {
      fotosCache = mezclarFotos(lista);
      fotosEstado = 'listo';
      pintarGaleria();
    }).catch(function () {
      fotosEstado = 'error';
      pintarGaleria();
    });
  }

  function subirFotos(files) {
    var autor = CalFotos.autor();
    if (!autor) {
      pedirNombre(function (nombre) {
        CalFotos.setAutor(nombre);
        subirFotos(files);
      });
      return;
    }

    var total = files.length;
    var hechas = 0;
    var fallos = 0;
    aviso('Subiendo ' + total + (total === 1 ? ' foto…' : ' fotos…'));

    // De una en una: subir cinco a la vez desde el móvil va peor.
    var siguiente = function () {
      if (!files.length) {
        if (fallos) aviso(hechas + ' subidas, ' + fallos + ' fallaron', true);
        else aviso(hechas === 1 ? 'Foto subida' : hechas + ' fotos subidas');
        cargarFotos();
        return;
      }
      var file = files.shift();
      CalFotos.subir(file, autor).then(function (r) {
        hechas++;
        if (r && r.id) {
          fotosRecientes.unshift({
            id: r.id, nombre: file.name || 'foto', autor: autor,
            tipo: file.type, fecha: new Date().toISOString(), bytes: file.size,
          });
        }
      }).catch(function (err) {
        fallos++;
        console.warn('Foto no subida:', err.message);
      }).then(siguiente);
    };
    siguiente();
  }

  function pedirNombre(despues) {
    abrirModal('¿Quién sube las fotos?', function (cerrar) {
      var form = el('form');
      var inp = document.createElement('input');
      inp.type = 'text';
      inp.placeholder = 'Tu nombre';
      inp.maxLength = 40;
      form.appendChild(campo('Para que el equipo sepa quién las ha puesto', inp));

      var acciones = el('div', 'form-acciones');
      var ok = el('button', 'btn', 'Continuar');
      ok.type = 'submit';
      acciones.appendChild(ok);
      var no = el('button', 'btn btn-plano', 'Cancelar');
      no.type = 'button';
      no.onclick = cerrar;
      acciones.appendChild(no);
      form.appendChild(acciones);

      form.onsubmit = function (ev) {
        ev.preventDefault();
        var nombre = inp.value.trim();
        if (!nombre) { aviso('Escribe tu nombre', true); return; }
        cerrar();
        despues(nombre);
      };

      setTimeout(function () { inp.focus(); }, 30);
      return form;
    });
  }

  // ---------- visor de una foto ----------

  var fotoAbierta = null;
  var blobAbierto = null;   // la foto ya descargada, lista para guardar

  function abrirVisor(foto) {
    fotoAbierta = foto;
    blobAbierto = null;
    var url = CalFotos.urlDe(foto.id);

    $('#visor-img').src = url;
    $('#visor-img').alt = foto.nombre;
    $('#visor-pie').textContent = foto.autor ? foto.nombre + ' · ' + foto.autor : foto.nombre;

    var puedoBorrar = Auth.isUnlocked() || CalFotos.esMia(foto.id);
    $('#visor-borrar').hidden = !puedoBorrar;
    $('#visor-borrar').textContent = Auth.isUnlocked() ? 'Borrar' : 'Borrar la mía';

    // Compartir solo donde el móvil sabe hacerlo con archivos. En iPhone
    // es la forma de guardar en Fotos sin salir de la aplicación.
    $('#visor-compartir').hidden = !puedeCompartirArchivos();

    $('#visor').hidden = false;
    document.body.style.overflow = 'hidden';

    // Se va trayendo la imagen ya, para que al pulsar Guardar no haya
    // espera: compartir en iPhone exige responder en el mismo toque.
    CalFotos.blobDe(foto.id).then(function (blob) {
      if (fotoAbierta && fotoAbierta.id === foto.id) blobAbierto = blob;
    }).catch(function () { /* se resolverá al pulsar */ });
  }

  function cerrarVisor() {
    fotoAbierta = null;
    blobAbierto = null;
    $('#visor').hidden = true;
    $('#visor-img').src = '';
    document.body.style.overflow = '';
  }

  function puedeCompartirArchivos() {
    if (!navigator.canShare || !navigator.share || typeof File !== 'function') return false;
    try {
      return navigator.canShare({ files: [new File([new Blob([1])], 'x.jpg', { type: 'image/jpeg' })] });
    } catch (err) {
      return false;
    }
  }

  // Guarda el archivo sin sacar al usuario de la aplicación. Antes esto
  // era un enlace normal, y en la app instalada la ventana se quedaba en
  // la foto, sin manera de volver al calendario.
  function guardarBlob(blob, nombre) {
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = nombre;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 60000);
  }

  function descargarFoto() {
    if (!fotoAbierta) return;
    var foto = fotoAbierta;
    var nombre = CalFotos.nombreArchivo(foto);

    if (blobAbierto) {
      guardarBlob(blobAbierto, nombre);
      aviso('Foto guardada');
      return;
    }

    aviso('Preparando la foto…');
    CalFotos.blobDe(foto.id).then(function (blob) {
      guardarBlob(blob, nombre);
      aviso('Foto guardada');
    }).catch(function () {
      // Sin poder traerla, se abre la versión que el navegador guarda
      // directamente en vez de mostrarla.
      window.location.href = CalFotos.urlDescarga(foto.id);
    });
  }

  function compartirFoto() {
    if (!fotoAbierta) return;
    var foto = fotoAbierta;
    var nombre = CalFotos.nombreArchivo(foto);

    var conBlob = function (blob) {
      var archivo = new File([blob], nombre, { type: blob.type || 'image/jpeg' });
      if (!navigator.canShare({ files: [archivo] })) {
        guardarBlob(blob, nombre);
        return;
      }
      return navigator.share({ files: [archivo] }).catch(function (err) {
        // Cancelar no es un fallo: el usuario cerró la hoja.
        if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
        guardarBlob(blob, nombre);
      });
    };

    if (blobAbierto) { conBlob(blobAbierto); return; }
    CalFotos.blobDe(foto.id).then(conBlob).catch(function () {
      aviso('No se pudo preparar la foto', true);
    });
  }

  function conectarVisor() {
    var visor = $('#visor');
    visor.addEventListener('click', function (ev) {
      if (ev.target === visor || ev.target.closest('[data-cerrar-visor]')) cerrarVisor();
    });

    $('#visor-descargar').onclick = descargarFoto;
    $('#visor-compartir').onclick = compartirFoto;

    $('#visor-borrar').onclick = function () {
      if (!fotoAbierta) return;
      if (!confirm('¿Borrar esta foto para todo el equipo?')) return;
      var id = fotoAbierta.id;
      cerrarVisor();
      CalFotos.borrar(id).then(function () {
        fotosBorradas[id] = true;
        fotosCache = (fotosCache || []).filter(function (f) { return f.id !== id; });
        pintarGaleria();
        aviso('Foto borrada');
        cargarFotos();
      }).catch(function (err) {
        aviso('No se pudo borrar: ' + err.message, true);
      });
    };
  }

  // ---------- copiar y pegar días ----------
  //
  // Muchas semanas repiten el mismo entreno, así que se copia un día
  // entero y se pega en los que hagan falta, de uno en uno o en varios
  // de golpe desde la rejilla del mes.

  var COPIA_KEY = window.CAL_CONFIG.storageKey + ':copia-dia';
  var copiado = null;   // { fecha, entradas }

  function leerCopia() {
    if (copiado) return copiado;
    try {
      var crudo = localStorage.getItem(COPIA_KEY);
      if (crudo) copiado = JSON.parse(crudo);
    } catch (err) { copiado = null; }
    return copiado;
  }

  function guardarCopia(valor) {
    copiado = valor;
    try {
      if (valor) localStorage.setItem(COPIA_KEY, JSON.stringify(valor));
      else localStorage.removeItem(COPIA_KEY);
    } catch (err) { /* se queda solo en memoria */ }
  }

  function copiarDia(fecha) {
    var entradas = Store.day(fecha).map(function (e) {
      // El resultado y el aplazamiento son de ese partido concreto: no se
      // arrastran a otro día.
      return {
        tipo: e.tipo, horario: e.horario, titulo: e.titulo,
        lugar: e.lugar, notas: e.notas,
      };
    });
    if (!entradas.length) { aviso('Ese día no tiene nada que copiar', true); return; }
    guardarCopia({ fecha: fecha, entradas: entradas });
    aviso('Copiado: ' + entradas.length + (entradas.length === 1 ? ' actividad' : ' actividades'));
  }

  function pegarEn(fechas, sustituir) {
    var copia = leerCopia();
    if (!copia) return 0;

    fechas.forEach(function (f) {
      if (sustituir) Store.clearDay(f);
      copia.entradas.forEach(function (e) { Store.addEntry(f, e); });
    });
    Auth.keepAlive();
    return fechas.length;
  }

  function resumenCopia(copia) {
    var d = fromIso(copia.fecha);
    return DOW_CORTO[dowLunes(d)] + ' ' + d.getDate() + ' ' + MESES[d.getMonth()].slice(0, 3) +
      ' · ' + copia.entradas.length + (copia.entradas.length === 1 ? ' actividad' : ' actividades');
  }

  // Barra que sale en la ficha del día mientras haya algo copiado.
  function barraCopia(fechaActual) {
    var copia = leerCopia();
    if (!copia) return null;

    var barra = el('div', 'copia-barra');
    var texto = el('div', 'copia-texto');
    texto.appendChild(el('strong', '', 'Copiado'));
    texto.appendChild(el('small', '', resumenCopia(copia)));
    barra.appendChild(texto);

    var varios = el('button', 'btn btn-small', 'Pegar en varios días');
    varios.type = 'button';
    varios.onclick = function () { dialogoPegarEnVarios(); };
    barra.appendChild(varios);

    var soltar = el('button', 'btn btn-small btn-plano', 'Descartar');
    soltar.type = 'button';
    soltar.onclick = function () { guardarCopia(null); pintarPanel(); };
    barra.appendChild(soltar);

    return barra;
  }

  // Rejilla de un mes para marcar en qué días se pega.
  function dialogoPegarEnVarios() {
    var copia = leerCopia();
    if (!copia) return;

    var elegidas = {};
    var mes = anclaMes || new Date(fromIso(copia.fecha).getFullYear(),
                                   fromIso(copia.fecha).getMonth(), 1);

    abrirModal('Pegar en varios días', function (cerrar) {
      var caja = el('div');
      caja.appendChild(el('p', 'nota', 'Copiado de ' + resumenCopia(copia) +
        '. Toca los días donde quieres pegarlo.'));

      var zona = el('div');
      caja.appendChild(zona);

      var sustituir = document.createElement('input');
      sustituir.type = 'checkbox';
      var lbl = el('label', 'casilla');
      lbl.appendChild(sustituir);
      var t = el('span');
      t.appendChild(el('strong', '', 'Sustituir lo que haya'));
      t.appendChild(el('small', '', 'Si no, lo copiado se añade a lo que ya tenga cada día.'));
      lbl.appendChild(t);
      caja.appendChild(lbl);

      var acciones = el('div', 'form-acciones');
      var pegar = el('button', 'btn', 'Pegar');
      pegar.type = 'button';
      pegar.disabled = true;
      acciones.appendChild(pegar);
      var cancelar = el('button', 'btn btn-plano', 'Cancelar');
      cancelar.type = 'button';
      cancelar.onclick = cerrar;
      acciones.appendChild(cancelar);
      caja.appendChild(acciones);

      function cuantas() { return Object.keys(elegidas).length; }

      function refrescarBoton() {
        var n = cuantas();
        pegar.disabled = !n;
        pegar.textContent = n ? 'Pegar en ' + n + (n === 1 ? ' día' : ' días') : 'Pegar';
      }

      function pintarMes() {
        zona.textContent = '';
        zona.appendChild(navPeriodo(MESES[mes.getMonth()] + ' ' + mes.getFullYear(), function (paso) {
          mes = new Date(mes.getFullYear(), mes.getMonth() + paso, 1);
          pintarMes();
        }, function () {
          var n = new Date();
          mes = new Date(n.getFullYear(), n.getMonth(), 1);
          pintarMes();
        }));

        var cab = el('div', 'mes-cabecera');
        DOW_CORTO.forEach(function (d) { cab.appendChild(el('div', '', d)); });
        zona.appendChild(cab);

        var rejilla = el('div', 'mes-rejilla');
        var inicio = lunesDe(mes);
        for (var i = 0; i < 42; i++) {
          (function (d) {
            var f = iso(d);
            var fuera = d.getMonth() !== mes.getMonth();
            var celda = el('button', 'celda celda-elegible' + (fuera ? ' fuera' : '') +
              (elegidas[f] ? ' elegida' : ''));
            celda.type = 'button';
            celda.setAttribute('aria-pressed', elegidas[f] ? 'true' : 'false');
            celda.setAttribute('aria-label', fechaLarga(d));
            celda.appendChild(el('div', 'celda-num', String(d.getDate())));
            if (Store.has(f)) celda.appendChild(el('div', 'celda-ocupado', '•'));
            celda.onclick = function () {
              if (elegidas[f]) delete elegidas[f]; else elegidas[f] = true;
              pintarMes();
              refrescarBoton();
            };
            rejilla.appendChild(celda);
          })(sumarDias(inicio, i));
        }
        zona.appendChild(rejilla);
      }

      pegar.onclick = function () {
        var fechas = Object.keys(elegidas).sort();
        var n = pegarEn(fechas, sustituir.checked);
        cerrar();
        aviso('Pegado en ' + n + (n === 1 ? ' día' : ' días'));
        pintarPanel();
      };

      pintarMes();
      refrescarBoton();
      return caja;
    });
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

    var barra = barraCopia(fecha);
    if (barra) cuerpo.appendChild(barra);

    var acciones = el('div', 'form-acciones');

    var add = el('button', 'btn', '+ Añadir actividad');
    add.type = 'button';
    add.onclick = function () { editandoId = 'nueva'; pintarPanel(); };
    acciones.appendChild(add);

    if (entradas.length) {
      var copiar = el('button', 'btn btn-plano', 'Copiar día');
      copiar.type = 'button';
      copiar.onclick = function () { copiarDia(fecha); pintarPanel(); };
      acciones.appendChild(copiar);
    }

    if (leerCopia()) {
      var pegarAqui = el('button', 'btn btn-plano', 'Pegar aquí');
      pegarAqui.type = 'button';
      pegarAqui.onclick = function () {
        var copia = leerCopia();
        var sustituir = false;
        if (entradas.length) {
          sustituir = confirm('Este día ya tiene ' + entradas.length +
            (entradas.length === 1 ? ' actividad' : ' actividades') +
            '.\n\nAceptar: sustituirlas por lo copiado.\nCancelar: añadir lo copiado a lo que ya hay.');
        }
        pegarEn([fecha], sustituir);
        aviso('Pegadas ' + copia.entradas.length +
              (copia.entradas.length === 1 ? ' actividad' : ' actividades'));
        pintarPanel();
      };
      acciones.appendChild(pegarAqui);
    }

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

    var chAplazado = document.createElement('input');
    chAplazado.type = 'checkbox';
    chAplazado.checked = !!(existente && existente.aplazado);

    function campoGoles(valor) {
      var i = document.createElement('input');
      i.type = 'number';
      i.min = '0';
      i.max = '999';
      i.step = '1';
      i.inputMode = 'numeric';
      i.placeholder = '—';
      i.value = (valor === null || valor === undefined) ? '' : String(valor);
      return i;
    }

    var inFavor = campoGoles(existente && existente.golesFavor);
    var inContra = campoGoles(existente && existente.golesContra);

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

    // El resultado solo tiene sentido en un partido: el bloque aparece y
    // desaparece según el tipo elegido.
    var bloqueResultado = el('div', 'resultado-campos');
    var filaGoles = el('div', 'campos-2');
    filaGoles.appendChild(campo('Goles a favor', inFavor));
    filaGoles.appendChild(campo('Goles en contra', inContra));
    bloqueResultado.appendChild(el('div', 'seccion-titulo', 'Resultado'));
    bloqueResultado.appendChild(filaGoles);
    form.appendChild(bloqueResultado);

    function refrescarResultado() {
      bloqueResultado.hidden = selTipo.value !== 'partido';
    }
    selTipo.addEventListener('change', refrescarResultado);
    refrescarResultado();

    // Marcar un partido como aplazado lo saca de los contadores: ni jugado
    // ni pendiente, aunque su fecha ya haya pasado.
    var lblAplazado = el('label', 'casilla');
    lblAplazado.appendChild(chAplazado);
    var textoAplazado = el('span');
    textoAplazado.appendChild(el('strong', '', 'Aplazado'));
    textoAplazado.appendChild(el('small', '', 'No se jugó ni se hizo. No cuenta en los contadores.'));
    lblAplazado.appendChild(textoAplazado);
    form.appendChild(lblAplazado);

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
        aplazado: chAplazado.checked,
        // Solo los partidos llevan marcador, y solo si están los dos.
        golesFavor: null,
        golesContra: null,
      };

      if (selTipo.value === 'partido' && inFavor.value !== '' && inContra.value !== '') {
        datos.golesFavor = inFavor.value;
        datos.golesContra = inContra.value;
      }
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

  // ---------- pintado general ----------

  function pintarPie() {
    var hueco = $('#pie-federacion');
    if (!hueco || hueco.children.length) return;
    var fed = enlaceFederacion('enlace-pie');
    if (fed) hueco.appendChild(fed);
  }

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
    else if (vistaActual === 'mes') contenedor.appendChild(vistaMes());
    else if (vistaActual === 'partidos') contenedor.appendChild(vistaPartidos());
    else contenedor.appendChild(vistaFotos());

    if (diaAbierto) pintarPanel();
    pintarPie();
  }

  function pintarEstadoEditor(desbloqueado) {
    $('#badge-editor').hidden = !desbloqueado;
    $('#btn-editar').textContent = desbloqueado ? 'Cerrar edición' : 'Editar';
    render();
  }

  // ---------- arranque ----------

  function conectarEventos() {
    document.querySelectorAll('.tab').forEach(function (tab) {
      tab.onclick = function () {
        vistaActual = tab.dataset.view;
        hoyPintados = 0;
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

    conectarVisor();

    // Cerrar paneles: botón, clic fuera o Escape.
    [['#panel', cerrarPanel], ['#modal', cerrarModal]].forEach(function (par) {
      var nodo = $(par[0]);
      nodo.addEventListener('click', function (ev) {
        if (ev.target === nodo || ev.target.closest('[data-cerrar]')) par[1]();
      });
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      if (!$('#visor').hidden) cerrarVisor();
      else if (!$('#modal').hidden) cerrarModal();
      else if (!$('#panel').hidden) cerrarPanel();
    });

    // Cuando quien edita termina, se empuja el aviso agrupado en vez de
    // esperar a que alguien abra la web. El temporizador se reinicia con
    // cada guardado, así que solo salta cuando de verdad ha parado.
    var empujarTimer = null;
    var MINUTOS_VENTANA = 3;

    Store.onSave(function (estado, err) {
      if (estado === 'guardando') aviso('Guardando…');
      else if (estado === 'error') aviso('No se pudo guardar en el servidor: ' + err.message, true);
      else if (estado === 'guardado') {
        aviso('Guardado para todo el equipo');
        if (!window.CalAvisos) return;
        clearTimeout(empujarTimer);
        empujarTimer = setTimeout(function () {
          CalAvisos.empujar();
        }, (MINUTOS_VENTANA * 60 + 10) * 1000);
      }
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
    if (['hoy', 'mes', 'partidos', 'fotos'].indexOf(pedida) < 0) return;
    vistaActual = pedida;
    document.querySelectorAll('.tab').forEach(function (t) {
      var activo = t.dataset.view === pedida;
      t.classList.toggle('is-active', activo);
      t.setAttribute('aria-selected', activo ? 'true' : 'false');
    });
  }

  function iniciar() {
    vistaInicial();

    // Lo primero, que el calendario se pinte y se repinte pase lo que pase.
    Store.onChange(render);
    Auth.onChange(pintarEstadoEditor);

    // Si engancharse a algún botón falla, se pierde esa interacción, pero
    // el calendario se sigue viendo: nunca una pantalla en blanco.
    try {
      conectarEventos();
    } catch (err) {
      console.error('No se pudieron enganchar todos los controles:', err);
    }

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
