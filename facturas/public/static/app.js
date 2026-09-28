/* Facturas — interfaz (JavaScript sin frameworks) */
(() => {
  'use strict';

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const app = $('#app');

  // ------------------------------------------------------------ Utilidades

  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const eur = (n) => new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
  const fdate = (iso) => (iso ? iso.slice(0, 10).split('-').reverse().join('/') : '');
  const today = () => new Date().toISOString().slice(0, 10);
  const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const parseNum = (v) => {
    const n = Number(String(v ?? '').replace(/\s/g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : 0;
  };
  // Descuento general: porcentaje o euros
  const calcDto = (bruto, tipo, valor) => {
    const v = Math.max(0, parseNum(valor));
    return Math.min(bruto, round2(tipo === 'eur' ? v : (bruto * Math.min(v, 100)) / 100));
  };
  // Línea sin precio (título o sección): no se muestran ceros
  const isSection = (l) => !Number(l.precio) && !Number(l.importe);
  const blank0 = (v) => (v === '' || v == null || Number(v) === 0 ? '' : v);
  const addDays = (iso, days) => {
    const d = new Date(iso + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  async function api(path, opts = {}) {
    const headers = { 'X-Requested-With': 'facturas', ...(opts.headers || {}) };
    let body = opts.body;
    if (body && !(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const res = await fetch('/api' + path, { ...opts, headers, body });
    if (res.status === 401) {
      location.href = '/login';
      throw new Error('Sesión caducada');
    }
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Error ${res.status}`);
    return data;
  }

  let toastTimer;
  function toast(msg, type = '') {
    const t = $('#toast');
    t.textContent = msg;
    t.className = 'show ' + type;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.className = ''), type === 'error' ? 6000 : 3000);
  }

  // Ejecuta una acción mostrando errores y desactivando el botón mientras tanto.
  async function busy(btn, fn) {
    const old = btn?.innerHTML;
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = 'Un momento…';
    }
    try {
      return await fn();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = old;
      }
    }
  }

  // Diálogo genérico. onSubmit devuelve false para dejarlo abierto.
  function openDialog({ title, body, buttons = [], wide = false, onSubmit, onOpen }) {
    const dlg = $('#dialog');
    const form = $('#dialog-form');
    dlg.classList.toggle('wide', wide);
    $('#dialog-title').textContent = title;
    $('#dialog-body').innerHTML = body;
    $('#dialog-foot').innerHTML = buttons
      .map((b) => `<button class="btn ${b.primary ? 'primary' : ''} ${b.danger ? 'danger' : ''}" value="${esc(b.value)}" ${b.value === 'cancel' ? 'formnovalidate' : ''}>${esc(b.label)}</button>`)
      .join('');
    form.onsubmit = async (e) => {
      const value = e.submitter?.value;
      if (value === 'cancel' || !onSubmit) return;
      e.preventDefault();
      const ok = await busy(e.submitter, () => onSubmit(form, value));
      if (ok !== false && ok !== undefined) dlg.close();
    };
    dlg.showModal();
    onOpen?.(form);
    return dlg;
  }

  const confirmDialog = (title, text, label = 'Aceptar', danger = false) =>
    new Promise((resolve) => {
      const dlg = openDialog({
        title,
        body: `<p style="margin:0">${text}</p>`,
        buttons: [{ label: 'Cancelar', value: 'cancel' }, { label, value: 'ok', primary: !danger, danger }],
        onSubmit: () => {
          resolve(true);
          return true;
        },
      });
      dlg.addEventListener('close', () => resolve(false), { once: true });
    });

  const formData = (form) => {
    const out = {};
    for (const el of form.elements) {
      if (!el.name) continue;
      out[el.name] = el.type === 'checkbox' ? el.checked : el.value;
    }
    return out;
  };

  const ESTADOS_FACTURA = ['borrador', 'emitida', 'enviada', 'pagada', 'anulada'];
  const ESTADOS_PRESUPUESTO = ['borrador', 'enviado', 'aceptado', 'rechazado'];
  const badge = (estado) => `<span class="badge ${esc(estado)}">${estado === 'borrador' ? 'guardado' : esc(estado)}</span>`;

  // --------------------------------------------------------------- Router

  const routes = [
    [/^#?\/?$/, pageHome, 'inicio'],
    [/^#\/facturas$/, () => pageList('factura'), 'facturas'],
    [/^#\/presupuestos$/, () => pageList('presupuesto'), 'presupuestos'],
    [/^#\/nueva$/, () => pageInvoiceForm(null, 'factura'), 'facturas'],
    [/^#\/presupuestos\/nuevo$/, () => pageQuoteForm(null), 'presupuestos'],
    [/^#\/factura\/(\d+)(?:\?enviar)?$/, (id) => pageInvoiceView(id), 'facturas'],
    [/^#\/factura\/(\d+)\/editar$/, (id) => pageInvoiceForm(id), 'facturas'],
    [/^#\/factura\/(\d+)\/editar-completo$/, (id) => pageInvoiceForm(id, 'factura', true), 'facturas'],
    [/^#\/presupuestos\/completo$/, () => pageInvoiceForm(null, 'presupuesto', true), 'presupuestos'],
    [/^#\/clientes$/, pageClients, 'clientes'],
    [/^#\/ajustes$/, pageSettings, 'ajustes'],
  ];

  let leaveGuard = null; // función que devuelve true si hay cambios sin guardar

  async function router() {
    const hash = location.hash || '#/';
    for (const [re, fn, nav] of routes) {
      const m = hash.match(re);
      if (!m) continue;
      $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));
      leaveGuard = null;
      app.innerHTML = '<p class="muted">Cargando…</p>';
      try {
        await fn(...m.slice(1));
      } catch (err) {
        app.innerHTML = `<div class="alert error">${esc(err.message)}</div>`;
      }
      window.scrollTo(0, 0);
      return;
    }
    location.hash = '#/';
  }

  let lastHash = location.hash;
  window.addEventListener('hashchange', () => {
    if (leaveGuard && leaveGuard() && !confirm('Tienes cambios sin guardar. ¿Salir igualmente?')) {
      history.replaceState(null, '', lastHash || '#/');
      return;
    }
    lastHash = location.hash;
    router();
  });
  window.addEventListener('beforeunload', (e) => {
    if (leaveGuard && leaveGuard()) e.preventDefault();
  });

  const go = (hash) => {
    leaveGuard = null;
    location.hash = hash;
  };

  // ============================================================ INICIO

  // Iconos (trazos simples, se colorean con currentColor)
  const ICON = {
    factura: '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M9 12h8M9 16h8M9 8h3"/>',
    nuevaFactura: '<path d="M6 2h9l5 5v15H6z"/><path d="M15 2v5h5"/><path d="M13 11v8M9 15h8"/>',
    presupuesto: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    nuevoPresupuesto: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M12 8v8M8 12h8"/>',
    clientes: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.8-3.6 3.4-5.5 6.5-5.5s5.7 1.9 6.5 5.5"/><circle cx="17" cy="9" r="2.5"/><path d="M16.5 14.6c2.6.2 4.4 2 5 4.9"/>',
    ajustes: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
  };
  const icon = (k) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k]}</svg>`;

  async function pageHome() {
    const tiles = [
      ['#/nueva', 'nuevaFactura', 'Nueva factura', 'blue'],
      ['#/presupuestos/nuevo', 'nuevoPresupuesto', 'Nuevo presupuesto', 'orange'],
      ['#/facturas', 'factura', 'Facturas', 'blue'],
      ['#/presupuestos', 'presupuesto', 'Presupuestos', 'orange'],
      ['#/clientes', 'clientes', 'Clientes', 'green'],
      ['#/ajustes', 'ajustes', 'Ajustes', 'grey'],
    ];
    app.innerHTML = `
      <div class="home-menu">
        ${tiles
          .map(([href, ic, label, color]) => `<a class="tile ${color}" href="${href}"><span class="tile-icon">${icon(ic)}</span><span class="tile-label">${label}</span></a>`)
          .join('')}
      </div>`;
  }

  // ============================================================ LISTADOS (facturas y presupuestos)

  const TXT = {
    factura: { uno: 'factura', titulo: 'Facturas', nueva: '#/nueva', nuevaTxt: '+ Nueva factura', estados: ESTADOS_FACTURA, enviada: 'Enviada' },
    presupuesto: { uno: 'presupuesto', titulo: 'Presupuestos', nueva: '#/presupuestos/nuevo', nuevaTxt: '+ Nuevo presupuesto', estados: ESTADOS_PRESUPUESTO, enviada: 'Enviado' },
  };
  const listState = {
    factura: { year: String(new Date().getFullYear()), estado: '', q: '' },
    presupuesto: { year: String(new Date().getFullYear()), estado: '', q: '' },
  };

  async function pageList(tipo) {
    const T = TXT[tipo];
    const st = listState[tipo];
    const years = await api('/invoices/years?tipo=' + tipo);
    if (!years.includes(st.year) && st.year) st.year = years[0];

    app.innerHTML = `
      <div class="page-head">
        <h1>${T.titulo}</h1>
        ${tipo === 'factura' ? '<a class="btn" id="export" href="#">Exportar libro (Excel)</a>' : ''}
        <a class="btn primary" href="${T.nueva}">${T.nuevaTxt}</a>
      </div>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <select id="f-year" style="width:auto">
            <option value="">Todos los años</option>
            ${years.map((y) => `<option ${y === st.year ? 'selected' : ''}>${esc(y)}</option>`).join('')}
          </select>
          <select id="f-estado" style="width:auto">
            <option value="">Todos los estados</option>
            ${T.estados.map((e) => `<option value="${e}" ${e === st.estado ? 'selected' : ''}>${e === 'borrador' ? 'guardado (borrador)' : e}</option>`).join('')}
          </select>
          <input id="f-q" type="search" placeholder="Buscar: nº, cliente, calle, teléfono, email, NIF, concepto…" value="${esc(st.q)}" style="flex:1;min-width:200px">
        </div>
        <div class="table-wrap" id="list"></div>
      </div>`;

    const load = async () => {
      const rows = await api('/invoices?' + new URLSearchParams({ tipo, year: st.year, estado: st.estado, q: st.q }));
      if ($('#export')) $('#export').href = '/api/export.csv?year=' + encodeURIComponent(st.year || new Date().getFullYear());
      if (!rows.length) {
        $('#list').innerHTML = `<div class="empty">No hay ${T.titulo.toLowerCase()}${st.q || st.estado ? ' con estos filtros' : ''}.<br><br><a class="btn primary" href="${T.nueva}">${T.nuevaTxt}</a></div>`;
        return;
      }
      $('#list').innerHTML = `
        <table>
          <thead><tr>${tipo === 'factura' ? '<th>Nº</th>' : ''}<th class="hide-sm">Fecha</th><th>Cliente</th><th class="num hide-sm">Base</th><th class="num">Total</th><th>Estado</th><th class="hide-sm">${T.enviada}</th><th></th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr class="link" data-id="${r.id}">
                ${tipo === 'factura' ? `<td><strong>${esc(r.numero)}</strong></td>` : ''}
                <td class="hide-sm">${fdate(r.fecha)}</td>
                <td>${esc(r.cliente_nombre)}</td>
                <td class="num hide-sm">${eur(r.base)}</td>
                <td class="num"><strong>${eur(r.total)}</strong></td>
                <td>${badge(r.estado)}</td>
                <td class="hide-sm small muted">${r.sent_at ? fdate(r.sent_at) + (r.sent_to ? '<br>' + esc(r.sent_to) : '') : '—'}</td>
                <td class="num"><button class="btn ghost sm del-row" data-del="${r.id}" title="Eliminar" aria-label="Eliminar ${esc(r.numero)}">🗑</button></td>
              </tr>`
              )
              .join('')}
          </tbody>
          <tfoot><tr><td colspan="${tipo === 'factura' ? 8 : 7}" class="small muted">${rows.length} ${rows.length === 1 ? T.uno : T.titulo.toLowerCase()} · ${rows.filter((r) => r.estado === 'borrador').length} guardado(s) sin enviar · ${rows.filter((r) => r.sent_at).length} enviado(s)</td></tr></tfoot>
        </table>`;
      $$('#list tr.link').forEach((tr) =>
        tr.addEventListener('click', async (e) => {
          const del = e.target.closest('[data-del]');
          if (!del) return go('#/factura/' + tr.dataset.id);
          e.stopPropagation();
          const r = rows.find((x) => String(x.id) === del.dataset.del);
          const quien = `${esc(docName(r))}${tipo === 'factura' ? ' de ' + esc(r.cliente_nombre) : ''} (${eur(r.total)})`;
          if (!(await confirmDialog('Eliminar', `¿Eliminar ${quien}? No se puede deshacer.`, 'Eliminar', true))) return;
          await busy(null, async () => {
            await api('/invoices/' + r.id, { method: 'DELETE' });
            toast('Eliminado', 'ok');
            load();
          });
        })
      );
    };

    let t;
    $('#f-year').onchange = (e) => ((st.year = e.target.value), load());
    $('#f-estado').onchange = (e) => ((st.estado = e.target.value), load());
    $('#f-q').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => ((st.q = e.target.value.trim()), load()), 250);
    };
    await load();
  }

  // ------------------------------------------------------- Formulario factura

  const setNav = (nav) => $$('nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === nav));

  async function pageInvoiceForm(id, tipoNuevo = 'factura', completo = false) {
    // Los presupuestos se editan con el formulario rápido (salvo que se pida el completo)
    if (id && !completo) {
      const doc = await api('/invoices/' + id);
      if (doc.tipo === 'presupuesto') return pageQuoteForm(id);
    }
    const [settingsRes, clients, inv, banks] = await Promise.all([
      api('/settings'),
      api('/clients'),
      id ? api('/invoices/' + id) : null,
      api('/banks'),
    ]);
    const s = settingsRes.settings;
    const tipo = inv?.tipo || tipoNuevo;
    const esPres = tipo === 'presupuesto';
    const T = TXT[tipo];
    setNav(esPres ? 'presupuestos' : 'facturas');
    const defaultBank = banks.find((b) => b.predeterminado) || banks[0];
    const fecha = inv?.fecha || today();
    const dias = parseNum(s[esPres ? 'presupuesto.dias_validez' : 'factura.dias_vencimiento']);
    const data = inv || {
      numero: (await api(`/invoices/next-number?tipo=${tipo}&fecha=` + fecha)).numero,
      fecha,
      vencimiento: dias ? addDays(fecha, dias) : '',
      iva_pct: s['factura.iva_pct'],
      irpf_pct: s['factura.irpf_pct'],
      forma_pago: s['factura.forma_pago'],
      notas: s[esPres ? 'presupuesto.notas' : 'factura.notas'],
      lines: [],
      estado: 'borrador',
      bank_id: defaultBank?.id || '',
    };
    let lines = (data.lines || []).map((l) => ({ ...l, precio: blank0(l.precio), descuento: blank0(l.descuento) }));
    if (!lines.length) lines.push({ descripcion: '', cantidad: '', unidad: 'ud', precio: '', descuento: '' });
    let dirty = false;
    leaveGuard = () => dirty;


    app.innerHTML = `
      <div class="page-head">
        <h1>${inv ? `Editar ${T.uno} ` + esc(inv.numero) : esPres ? 'Nuevo presupuesto' : 'Nueva factura'}</h1>
        <a class="btn" href="${inv ? '#/factura/' + inv.id : esPres ? '#/presupuestos' : '#/facturas'}">Cancelar</a>
      </div>
      ${inv && inv.sent_at ? `<div class="alert info" style="margin-bottom:16px">${esPres ? 'Este presupuesto' : 'Esta factura'} ya se envió el ${fdate(inv.sent_at)} a ${esc(inv.sent_to || '')}. Puedes corregir lo que necesites y pulsar <strong>"Guardar y enviar por correo"</strong> para mandarle la versión corregida.</div>` : ''}
      ${!s['empresa.nombre'] ? '<div class="alert info" style="margin-bottom:16px">Aún no has rellenado los datos de tu empresa (nombre, NIF, dirección, IBAN…). <a href="#/ajustes">Hazlo en Ajustes</a> para que salgan en las facturas.</div>' : ''}
      <form id="inv-form" autocomplete="off">
        <div class="card">
          <h2>Datos ${esPres ? 'del presupuesto' : 'de la factura'}</h2>
          <div class="grid grid-4">
            ${esPres ? `<input type="hidden" name="numero" value="${esc(data.numero)}">` : `<label>Nº de factura <input name="numero" value="${esc(data.numero)}" required></label>`}
            <label>Fecha <input type="date" name="fecha" value="${esc(data.fecha)}" required></label>
            <label>${esPres ? 'Válido hasta' : 'Vencimiento'} <input type="date" name="vencimiento" value="${esc(data.vencimiento || '')}"></label>
            <label>Forma de pago <input name="forma_pago" value="${esc(data.forma_pago || '')}" list="formas-pago"></label>
            <label class="span-2">Banco (sale en ${esPres ? 'el presupuesto' : 'la factura'} con su nº de cuenta)
              <select name="bank_id">
                ${banks.length ? '' : '<option value="">— Añade tus bancos en Ajustes —</option>'}
                ${banks.map((b) => `<option value="${b.id}" ${String(b.id) === String(data.bank_id) ? 'selected' : ''}>${esc(b.nombre)}</option>`).join('')}
              </select>
            </label>
            <div class="span-2 small muted" id="bank-iban" style="align-self:end;padding-bottom:9px"></div>
          </div>
          <datalist id="formas-pago">
            <option>Transferencia bancaria</option><option>Efectivo</option><option>Bizum</option><option>Tarjeta</option><option>Domiciliación bancaria</option>
          </datalist>
        </div>

        <div class="card">
          <div class="row" style="margin-bottom:12px">
            <h2 style="margin:0;flex:1">Cliente</h2>
            <select id="client-pick" style="width:auto;max-width:100%">
              <option value="">— Cliente nuevo / escribir a mano —</option>
              ${clients.map((c) => `<option value="${c.id}" ${String(c.id) === String(data.client_id) ? 'selected' : ''}>${esc(c.nombre)}${c.nif ? ' · ' + esc(c.nif) : ''}</option>`).join('')}
            </select>
          </div>
          <input type="hidden" name="client_id" value="${esc(data.client_id || '')}">
          <div class="grid grid-4">
            <label class="span-2">Nombre / Razón social <input name="cliente_nombre" value="${esc(data.cliente_nombre || '')}" required></label>
            <label>NIF / CIF <input name="cliente_nif" value="${esc(data.cliente_nif || '')}"></label>
            <label>Email <input type="email" name="cliente_email" value="${esc(data.cliente_email || '')}" placeholder="para enviárselo por correo"></label>
            <label class="span-2">Dirección <input name="cliente_direccion" value="${esc(data.cliente_direccion || '')}"></label>
            <label>C.P. <input name="cliente_cp" value="${esc(data.cliente_cp || '')}"></label>
            <label>Ciudad <input name="cliente_ciudad" value="${esc(data.cliente_ciudad || '')}"></label>
            <label>Provincia <input name="cliente_provincia" value="${esc(data.cliente_provincia || '')}"></label>
            <label>Teléfono <input name="cliente_telefono" value="${esc(data.cliente_telefono || '')}"></label>
            <label class="check span-2" style="align-self:end"><input type="checkbox" name="guardar_cliente" ${data.client_id ? '' : 'checked'}> <span id="save-client-label">Guardar en mis clientes</span></label>
          </div>
        </div>

        <div class="card">
          <h2>Conceptos</h2>
          <div class="table-wrap">
            <table class="lines">
              <thead><tr><th class="c-desc">Descripción</th><th class="c-qty num">Cantidad</th><th class="c-ud">Ud.</th><th class="c-price num">Precio €</th><th class="c-dto num">Dto %</th><th class="c-imp num">Importe</th><th class="c-del"></th></tr></thead>
              <tbody id="lines"></tbody>
            </table>
          </div>
          <div class="row" style="margin-top:10px">
            <button type="button" class="btn" id="add-line">+ Añadir línea</button>
          </div>

          <div class="grid grid-2" style="margin-top:18px;align-items:start">
            <div class="grid grid-2">
              ${
                esPres
                  ? `<label>Descuento <input name="dto_valor" inputmode="decimal" value="${esc(data.dto_valor || '')}" placeholder="0"></label>
                     <label>&nbsp;<select name="dto_tipo"><option value="pct" ${data.dto_tipo !== 'eur' ? 'selected' : ''}>%</option><option value="eur" ${data.dto_tipo === 'eur' ? 'selected' : ''}>€</option></select></label>`
                  : `<label>IVA %
                <select name="iva_pct">
                  ${['21', '10', '4', '0'].map((v) => `<option ${String(parseNum(data.iva_pct)) === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
              </label>
              <label>Retención IRPF %
                <select name="irpf_pct">
                  ${['0', '7', '15'].map((v) => `<option ${String(parseNum(data.irpf_pct)) === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
              </label>`
              }
              <label class="span-2">Observaciones (salen en ${esPres ? 'el presupuesto' : 'la factura'}) <textarea name="notas" rows="3">${esc(data.notas || '')}</textarea></label>
            </div>
            <div class="totals" id="totals"></div>
          </div>
        </div>

        <div class="row no-print">
          <span class="spacer"></span>
          <button type="submit" class="btn" value="save">Guardar</button>
          <button type="submit" class="btn primary" value="send">${inv && inv.sent_at ? 'Guardar y volver a enviar' : 'Guardar y enviar por correo'}</button>
        </div>
      </form>`;

    const form = $('#inv-form');
    const tbody = $('#lines');

    // --- Banco
    const showIban = () => {
      const b = banks.find((x) => String(x.id) === form.bank_id.value);
      $('#bank-iban').innerHTML = b ? 'IBAN: <strong>' + esc(b.iban) + '</strong>' : banks.length ? '' : '<a href="#/ajustes">Añadir bancos</a>';
    };
    form.bank_id.onchange = showIban;
    showIban();

    // --- Cliente
    const clientFields = ['nombre', 'nif', 'direccion', 'cp', 'ciudad', 'provincia', 'email', 'telefono'];
    const updateSaveLabel = () => {
      $('#save-client-label').textContent = form.client_id.value ? 'Actualizar los datos de este cliente' : 'Guardar en mis clientes';
    };
    updateSaveLabel();
    $('#client-pick').onchange = (e) => {
      const c = clients.find((x) => String(x.id) === e.target.value);
      form.client_id.value = c ? c.id : '';
      for (const f of clientFields) form['cliente_' + f].value = c ? c[f] || '' : '';
      form.guardar_cliente.checked = !c;
      updateSaveLabel();
      dirty = true;
    };

    // --- Líneas
    const lineImporte = (l) => round2((String(l.cantidad ?? '').trim() === '' ? 1 : parseNum(l.cantidad)) * parseNum(l.precio) * (1 - parseNum(l.descuento) / 100));

    function renderTotals() {
      const bruto = round2(lines.reduce((sum, l) => sum + (l.descripcion ? lineImporte(l) : 0), 0));
      if (esPres) {
        const dto = calcDto(bruto, form.dto_tipo.value, form.dto_valor.value);
        $('#totals').innerHTML = `
          ${dto ? `<div><span>Subtotal</span><span class="num">${eur(bruto)}</span></div><div><span>Descuento</span><span class="num">-${eur(dto)}</span></div>` : ''}
          <div class="grand"><span>TOTAL</span><span class="num">${eur(bruto - dto)}</span></div>
          <div class="small muted" style="justify-content:flex-end">IVA no incluido</div>`;
        return;
      }
      const base = bruto;
      const ivaPct = parseNum(form.iva_pct.value);
      const irpfPct = parseNum(form.irpf_pct.value);
      const iva = round2((base * ivaPct) / 100);
      const irpf = round2((base * irpfPct) / 100);
      $('#totals').innerHTML = `
        <div><span>Base imponible</span><span class="num">${eur(base)}</span></div>
        <div><span>IVA (${ivaPct}%)</span><span class="num">${eur(iva)}</span></div>
        ${irpfPct ? `<div><span>Retención IRPF (${irpfPct}%)</span><span class="num">-${eur(irpf)}</span></div>` : ''}
        <div class="grand"><span>TOTAL</span><span class="num">${eur(base + iva - irpf)}</span></div>`;
    }

    function renderLines() {
      tbody.innerHTML = lines
        .map(
          (l, i) => `<tr data-i="${i}">
            <td class="c-desc"><div class="ac"><input data-f="descripcion" value="${esc(l.descripcion)}" placeholder="Producto o servicio"></div></td>
            <td class="c-qty"><input data-f="cantidad" inputmode="decimal" class="num" value="${esc(l.cantidad)}" placeholder="1"></td>
            <td class="c-ud"><input data-f="unidad" value="${esc(l.unidad || '')}"></td>
            <td class="c-price"><input data-f="precio" inputmode="decimal" class="num" value="${esc(l.precio)}" placeholder="€"></td>
            <td class="c-dto"><input data-f="descuento" inputmode="decimal" class="num" value="${esc(blank0(l.descuento))}"></td>
            <td class="c-imp num" data-imp>${l.precio === '' ? '' : eur(lineImporte(l))}</td>
            <td class="c-del"><button type="button" class="btn ghost sm" data-del title="Quitar línea">✕</button></td>
          </tr>`
        )
        .join('');
      renderTotals();
    }

    tbody.addEventListener('input', (e) => {
      const tr = e.target.closest('tr');
      const i = Number(tr.dataset.i);
      lines[i][e.target.dataset.f] = e.target.value;
      $('[data-imp]', tr).textContent = String(lines[i].precio).trim() === '' ? '' : eur(lineImporte(lines[i]));
      renderTotals();
      dirty = true;
    });
    tbody.addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      const i = Number(e.target.closest('tr').dataset.i);
      lines.splice(i, 1);
      if (!lines.length) lines.push({ descripcion: '', cantidad: '', unidad: 'ud', precio: '', descuento: '' });
      renderLines();
      dirty = true;
    });
    $('#add-line').onclick = () => {
      lines.push({ descripcion: '', cantidad: '', unidad: 'ud', precio: '', descuento: '' });
      renderLines();
      $$('input[data-f=descripcion]', tbody).at(-1).focus();
    };
    if (esPres) {
      form.dto_valor.oninput = renderTotals;
      form.dto_tipo.onchange = renderTotals;
    } else {
      form.iva_pct.onchange = renderTotals;
      form.irpf_pct.onchange = renderTotals;
    }
    form.addEventListener('input', () => (dirty = true));

    // Número automático al cambiar la fecha (solo facturas nuevas)
    if (!inv) {
      let autoNumber = data.numero;
      form.fecha.onchange = async () => {
        if (form.numero.value === autoNumber) {
          autoNumber = (await api(`/invoices/next-number?tipo=${tipo}&fecha=` + form.fecha.value)).numero;
          form.numero.value = autoNumber;
        }
        if (dias) form.vencimiento.value = addDays(form.fecha.value, dias);
      };
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const action = e.submitter?.value;
      const body = { ...formData(form), tipo, lines: lines.filter((l) => String(l.descripcion).trim()) };
      if (!body.lines.length) return toast('Añade al menos un producto o servicio.', 'error');
      await busy(e.submitter, async () => {
        const saved = inv
          ? await api('/invoices/' + inv.id, { method: 'PUT', body })
          : await api('/invoices', { method: 'POST', body });
        dirty = false;
        toast(esPres ? 'Presupuesto guardado' : 'Factura guardada', 'ok');
        go('#/factura/' + saved.id + (action === 'send' ? '?enviar' : ''));
      });
    };

    renderLines();

    // Si se viene de "Facturar" en la lista de clientes, preselecciona el cliente.
    const pre = sessionStorage.getItem('prefillClient');
    if (!inv && pre) {
      sessionStorage.removeItem('prefillClient');
      $('#client-pick').value = pre;
      $('#client-pick').dispatchEvent(new Event('change'));
      dirty = false;
    }
  }

  // ------------------------------------------------------------ Ver factura

  // Genera el PDF (en el navegador)
  async function invoicePdf(inv) {
    const { settings } = await api('/settings');
    return window.InvoicePdf.build(inv, settings);
  }
  const fileSafe = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
  const pdfName = (inv) =>
    inv.tipo === 'presupuesto'
      ? `Presupuesto_${fileSafe(inv.cliente_nombre) || 'cliente'}_${fdate(inv.fecha).replace(/\//g, '-')}.pdf`
      : `Factura_${fileSafe(inv.numero)}.pdf`;
  // Cómo se nombra el documento en pantalla (los presupuestos no llevan número)
  const docName = (inv) => (inv.tipo === 'presupuesto' ? `el presupuesto de ${inv.cliente_nombre}` : `la factura ${inv.numero}`);

  async function pageInvoiceView(id) {
    const inv = await api('/invoices/' + id);
    const esPres = inv.tipo === 'presupuesto';
    const T = TXT[inv.tipo];
    setNav(esPres ? 'presupuestos' : 'facturas');
    const ligado = esPres && inv.factura_id ? inv.factura_id : !esPres && inv.presupuesto_id ? inv.presupuesto_id : null;

    app.innerHTML = `
      <div class="page-head">
        <h1>${esPres ? 'Presupuesto · ' + esc(inv.cliente_nombre) : 'Factura ' + esc(inv.numero)} ${badge(inv.estado)}</h1>
        <a class="btn" href="${esPres ? '#/presupuestos' : '#/facturas'}">← Volver</a>
      </div>
      <div class="card no-print">
        <div class="row">
          ${esPres ? '<button class="btn wa" id="wa">WhatsApp</button><button class="btn" id="send">✉ Correo</button>' : '<button class="btn primary" id="send">✉ Enviar por correo</button>'}
          <button class="btn" id="preview">Ver PDF</button>
          <button class="btn" id="download">Descargar PDF</button>
          <a class="btn" href="#/factura/${inv.id}/editar">Editar</a>
          <button class="btn" id="dup">Duplicar</button>
          ${esPres ? `<button class="btn" id="convert">${inv.factura_id ? 'Ver factura' : '→ Convertir en factura'}</button>` : ''}
          ${!esPres && ligado ? `<a class="btn ghost" href="#/factura/${ligado}">Ver presupuesto de origen</a>` : ''}
          <span class="spacer"></span>
          <label style="flex-direction:row;align-items:center;gap:8px">Estado
            <select id="estado" style="width:auto">${T.estados.map((e) => `<option value="${e}" ${e === inv.estado ? 'selected' : ''}>${e === 'borrador' ? 'guardado (borrador)' : e}</option>`).join('')}</select>
          </label>
          <button class="btn danger" id="del">Eliminar</button>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h2>Cliente</h2>
          <strong>${esc(inv.cliente_nombre)}</strong><br>
          ${inv.cliente_nif ? 'NIF: ' + esc(inv.cliente_nif) + '<br>' : ''}
          ${esc(inv.cliente_direccion || '')} ${esc(inv.cliente_cp || '')} ${esc(inv.cliente_ciudad || '')} ${esc(inv.cliente_provincia || '')}<br>
          ${inv.cliente_email ? '✉ ' + esc(inv.cliente_email) : '<span class="muted">Sin email</span>'}
          ${inv.cliente_telefono ? ' · ☎ ' + esc(inv.cliente_telefono) : ''}
        </div>
        <div class="card">
          <h2>Datos</h2>
          <div class="grid grid-2 small">
            <div><span class="muted">Fecha</span><br>${fdate(inv.fecha)}</div>
            <div><span class="muted">Vencimiento</span><br>${fdate(inv.vencimiento) || '—'}</div>
            <div><span class="muted">Forma de pago</span><br>${esc(inv.forma_pago || '—')}</div>
            <div><span class="muted">Banco</span><br>${inv.banco_nombre ? esc(inv.banco_nombre) + '<br>' + esc(inv.banco_iban) : '—'}</div>
            <div><span class="muted">Enviada</span><br>${inv.sent_at ? fdate(inv.sent_at) + ' a ' + esc(inv.sent_to) : 'No'}</div>
            ${inv.paid_at ? `<div><span class="muted">Pagada</span><br>${fdate(inv.paid_at)}</div>` : ''}
          </div>
        </div>
      </div>

      <div class="card">
        <div class="table-wrap">
          <table>
            <thead><tr><th class="num">Cantidad</th><th>Descripción</th><th class="num">Precio unitario</th><th class="num">Dto.</th><th class="num">Total</th></tr></thead>
            <tbody>${inv.lines
              .map(
                (l) =>
                  isSection(l)
                    ? `<tr><td></td><td><strong>${esc(l.descripcion)}</strong></td><td></td><td></td><td></td></tr>`
                    : `<tr><td class="num">${l.cantidad.toLocaleString('es-ES')} ${esc(l.unidad && l.unidad !== 'ud' ? l.unidad : '')}</td><td>${esc(l.descripcion)}</td>
                  <td class="num">${eur(l.precio)}</td><td class="num">${l.descuento ? l.descuento + '%' : ''}</td><td class="num">${eur(l.importe)}</td></tr>`
              )
              .join('')}</tbody>
          </table>
        </div>
        <div class="totals" style="margin-top:14px">
          ${
            esPres
              ? `${inv.dto_importe ? `<div><span>Subtotal</span><span class="num">${eur(inv.base + inv.dto_importe)}</span></div><div><span>Descuento${inv.dto_tipo === 'pct' ? ` (${inv.dto_valor}%)` : ''}</span><span class="num">-${eur(inv.dto_importe)}</span></div>` : ''}
                 <div class="grand"><span>TOTAL</span><span class="num">${eur(inv.total)}</span></div>
                 <div class="small muted" style="justify-content:flex-end">IVA no incluido · válido hasta el ${fdate(inv.vencimiento)}</div>`
              : `<div><span>Subtotal</span><span class="num">${eur(inv.base)}</span></div>
          <div><span>IVA (${inv.iva_pct}%)</span><span class="num">${eur(inv.iva)}</span></div>
          ${inv.irpf_pct ? `<div><span>Retención IRPF (${inv.irpf_pct}%)</span><span class="num">-${eur(inv.irpf)}</span></div>` : ''}
          <div class="grand"><span>TOTAL</span><span class="num">${eur(inv.total)}</span></div>`
          }
        </div>
        ${inv.notas ? `<p class="small"><strong>Observaciones:</strong> ${esc(inv.notas)}</p>` : ''}
      </div>

      ${
        inv.emails.length
          ? `<div class="card"><h2>Historial de envíos</h2><div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Para</th><th>Asunto</th><th>Resultado</th></tr></thead><tbody>
          ${inv.emails
            .map(
              (m) => `<tr><td class="small">${esc(m.sent_at)}</td><td>${esc(m.to_addr)}${m.cc_addr ? '<br><span class="small muted">CC: ' + esc(m.cc_addr) + '</span>' : ''}</td><td>${esc(m.subject)}</td>
                <td>${m.status === 'ok' ? '<span class="badge pagada">enviado</span>' : '<span class="badge anulada">error</span><br><span class="small muted">' + esc(m.error) + '</span>'}</td></tr>`
            )
            .join('')}</tbody></table></div></div>`
          : ''
      }`;

    $('#send').onclick = () => sendDialog(inv);
    if (esPres) {
      // Se prepara el PDF antes de pulsar para que WhatsApp se abra al instante
      const settings = (await api('/settings')).settings;
      const pdfReady = window.InvoicePdf.build(inv, settings);
      $('#wa').onclick = async (e) => {
        e.target.disabled = true;
        try {
          const r = await sharePdf(inv, await pdfReady, fillText(settings['whatsapp.mensaje'], inv, settings));
          if (r) {
            await markShared(inv);
            toast('Enviado por WhatsApp', 'ok');
            router();
          }
        } catch (err) {
          toast(err.message, 'error');
        } finally {
          e.target.disabled = false;
        }
      };
    }
    $('#preview').onclick = (e) =>
      busy(e.target, async () => {
        const url = URL.createObjectURL(new Blob([await invoicePdf(inv)], { type: 'application/pdf' }));
        // En móvil los PDF no se ven dentro de la página: se abren en otra pestaña
        if (matchMedia('(max-width: 800px)').matches) return void window.open(url, '_blank');
        const dlg = openDialog({
          title: esPres ? 'Presupuesto · ' + inv.cliente_nombre : 'Factura ' + inv.numero,
          wide: true,
          body: `<iframe class="preview" src="${url}"></iframe>`,
          buttons: [{ label: 'Cerrar', value: 'cancel' }],
        });
        dlg.addEventListener('close', () => URL.revokeObjectURL(url), { once: true });
      });
    $('#download').onclick = (e) =>
      busy(e.target, async () => {
        const url = URL.createObjectURL(new Blob([await invoicePdf(inv)], { type: 'application/pdf' }));
        const a = document.createElement('a');
        a.href = url;
        a.download = pdfName(inv);
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      });
    $('#dup').onclick = (e) =>
      busy(e.target, async () => {
        const copy = await api(`/invoices/${inv.id}/duplicate`, { method: 'POST' });
        toast('Copia creada', 'ok');
        go('#/factura/' + copy.id + '/editar');
      });
    $('#estado').onchange = async (e) => {
      const estado = e.target.value;
      if (estado === 'anulada' && !(await confirmDialog('Anular factura', `¿Seguro que quieres anular la factura ${esc(inv.numero)}? Se conserva en el registro pero no cuenta en los totales.`, 'Anular', true))) {
        e.target.value = inv.estado;
        return;
      }
      await busy(null, async () => {
        await api(`/invoices/${inv.id}/estado`, { method: 'PATCH', body: { estado } });
        toast('Estado actualizado: ' + estado, 'ok');
        router();
      });
    };
    $('#del')?.addEventListener('click', async () => {
      if (!(await confirmDialog('Eliminar', `¿Eliminar ${esc(docName(inv))}? No se puede deshacer.`, 'Eliminar', true))) return;
      await busy(null, async () => {
        await api('/invoices/' + inv.id, { method: 'DELETE' });
        toast('Eliminado', 'ok');
        go(esPres ? '#/presupuestos' : '#/facturas');
      });
    });

    $('#convert')?.addEventListener('click', (e) =>
      busy(e.target, async () => {
        if (inv.factura_id) return go('#/factura/' + inv.factura_id);
        if (!(await confirmDialog('Convertir en factura', `Se creará una factura nueva con los datos del presupuesto de ${esc(inv.cliente_nombre)}. Quedará guardada para que la revises antes de enviarla.`, 'Crear factura'))) return;
        const f = await api(`/invoices/${inv.id}/convert`, { method: 'POST' });
        toast('Factura ' + f.numero + ' creada', 'ok');
        go('#/factura/' + f.id + '/editar');
      })
    );

    if (location.hash.endsWith('?enviar')) {
      history.replaceState(null, '', '#/factura/' + inv.id);
      sendDialog(inv);
    }
  }

  async function sendDialog(inv) {
    let p, me;
    try {
      [p, me] = await Promise.all([api(`/invoices/${inv.id}/email-preview`), api('/me')]);
    } catch (err) {
      return toast(err.message, 'error');
    }
    const conectado = (me.mail && (me.mail.provider === 'smtp' || me.microsoft)) || me.brevo;
    openDialog({
      title: inv.tipo === 'presupuesto' ? 'Enviar presupuesto' : 'Enviar factura ' + inv.numero,
      body: `
        ${conectado ? `<div class="small muted">Se enviará desde <strong>${esc(me.mail?.email || 'tu remitente de Brevo')}</strong> con el PDF adjunto.</div>` : '<div class="alert warn">Aún no has conectado tu correo. Ve a <a href="#/ajustes">Ajustes → Correo</a> y pulsa "Conectar Gmail".</div>'}
        <label>Para <input name="to" type="text" value="${esc(p.to)}" placeholder="correo@cliente.com" required></label>
        <label>CC (opcional) <input name="cc" type="text" placeholder="otro@correo.com"></label>
        <label>Asunto <input name="subject" value="${esc(p.subject)}" required></label>
        <label>Mensaje <textarea name="body" rows="9">${esc(p.body)}</textarea></label>
        <label class="check"><input type="checkbox" name="copia"> Enviarme una copia</label>
        ${p.to ? '' : '<div class="alert warn">Este cliente no tiene email guardado. Escríbelo arriba y se guardará en su ficha.</div>'}`,
      buttons: [{ label: 'Cancelar', value: 'cancel' }, { label: '✉ Enviar', value: 'send', primary: true }],
      onSubmit: async (form) => {
        const pdf = window.InvoicePdf.toBase64(await invoicePdf(inv));
        await api(`/invoices/${inv.id}/send`, { method: 'POST', body: { ...formData(form), pdf } });
        toast('Factura enviada a ' + form.to.value, 'ok');
        setTimeout(router, 50);
        return true;
      },
    });
  }

  // ============================================================ PRESUPUESTO RÁPIDO (WhatsApp)

  const waPhone = (tel) => {
    let d = String(tel || '').replace(/\D/g, '');
    if (d.startsWith('00')) d = d.slice(2);
    if (d.length === 9) d = '34' + d; // número español sin prefijo
    return d;
  };

  // Comparte el PDF por WhatsApp (en el móvil abre la lista de contactos de WhatsApp).
  // `pdfBytes` debe estar ya generado: el navegador solo deja compartir justo después del toque.
  async function sharePdf(inv, pdfBytes, text) {
    const file = new File([pdfBytes], pdfName(inv), { type: 'application/pdf' });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file], text });
      } catch (err) {
        if (err.name === 'AbortError') return false;
        throw err;
      }
      return 'share';
    }
    // Ordenador: descarga el PDF y abre WhatsApp Web con el mensaje
    const url = URL.createObjectURL(new Blob([pdfBytes], { type: 'application/pdf' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    const tel = waPhone(inv.cliente_telefono);
    window.open(`https://wa.me/${tel}?text=${encodeURIComponent(text)}`, '_blank');
    toast('PDF descargado: arrástralo al chat de WhatsApp', 'ok');
    return 'web';
  }

  // Rellena {{marcadores}} del mensaje en el navegador
  function fillText(tpl, inv, s) {
    const dir = String(inv.cliente_direccion || '').trim().replace(/^c\/\s*/i, 'calle ').replace(/^avda\.?\s*/i, 'avenida ');
    const obra = !dir
      ? ''
      : /^(paseo|camino|pasaje|callejón|callejon)\b/i.test(dir)
        ? ` del ${dir.charAt(0).toLowerCase() + dir.slice(1)}`
        : /^(calle|avenida|plaza|pza|ronda|travesía|travesia|glorieta|carretera|ctra|urbanización|urb)\b/i.test(dir)
          ? ` de la ${dir.charAt(0).toLowerCase() + dir.slice(1)}`
          : ` de la calle ${dir}`;
    const v = {
      obra,
      enlace: '',
      'cliente.direccion': dir,
      numero: inv.numero,
      fecha: fdate(inv.fecha),
      total: eur(inv.total),
      'cliente.nombre': inv.cliente_nombre || '',
      'empresa.nombre': s['empresa.nombre'] || '',
      'empresa.telefono': s['empresa.telefono'] || '',
    };
    // Sin enlace (PDF adjunto): "…presupuesto: {{enlace}}" queda en "…presupuesto."
    if (!v.enlace) tpl = String(tpl || '').replace(/:?\s*\{\{\s*enlace\s*\}\}/g, '.');
    return String(tpl || '').replace(/\{\{\s*([a-zA-Z0-9_.]+)\s*\}\}/g, (m, k) => (k in v ? v[k] : ''));
  }

  async function markShared(inv) {
    return api(`/invoices/${inv.id}/shared`, { method: 'POST', body: { to: 'WhatsApp' + (inv.cliente_telefono ? ' ' + inv.cliente_telefono : '') } });
  }

  async function pageQuoteForm(id) {
    const [{ settings: s }, clients, inv] = await Promise.all([
      api('/settings'),
      api('/clients'),
      id ? api('/invoices/' + id) : null,
    ]);
    setNav('presupuestos');
    const fecha = inv?.fecha || today();
    const dias = parseNum(s['presupuesto.dias_validez']);
    const numero = inv?.numero || (await api('/invoices/next-number?tipo=presupuesto&fecha=' + fecha)).numero;
    let lines = (inv?.lines || []).map((l) => ({ descripcion: l.descripcion, cantidad: l.cantidad, precio: blank0(l.precio), unidad: l.unidad, descuento: l.descuento }));
    if (!lines.length) lines.push({ descripcion: '', cantidad: '', precio: '' });
    let clientId = inv?.client_id || '';
    let dirty = false;
    leaveGuard = () => dirty;
    const canPick = 'contacts' in navigator && 'select' in navigator.contacts;

    app.innerHTML = `
      <div class="page-head">
        <h1>${inv ? 'Editar presupuesto' : 'Presupuesto rápido'}</h1>
        <a class="btn sm ghost" href="${inv ? `#/factura/${inv.id}/editar-completo` : '#/presupuestos/completo'}">Formulario completo</a>
      </div>
      <form id="q-form" class="quick" autocomplete="off">
        <div class="card">
          <div class="grid grid-2">
            <label>Cliente
              <input name="cliente_nombre" list="q-clients" value="${esc(inv?.cliente_nombre || '')}" placeholder="Nombre" required>
            </label>
            <label>Teléfono
              <div class="row" style="flex-wrap:nowrap">
                <input name="cliente_telefono" type="tel" inputmode="tel" value="${esc(inv?.cliente_telefono || '')}" placeholder="600 000 000">
                ${canPick ? '<button type="button" class="btn" id="pick" title="Elegir de mis contactos">📇</button>' : ''}
              </div>
            </label>
          </div>
          <datalist id="q-clients">${clients.map((c) => `<option value="${esc(c.nombre)}">${esc(c.telefono || c.direccion || '')}</option>`).join('')}</datalist>
          <label style="margin-top:12px">Dirección de la obra
            <input name="cliente_direccion" value="${esc(inv?.cliente_direccion || '')}" placeholder="C/ … nº …">
          </label>
          <details id="q-email" class="small" style="margin-top:10px" ${inv?.cliente_email ? 'open' : ''}><summary class="muted" style="cursor:pointer">Email (solo si lo vas a enviar por correo)</summary>
            <input name="cliente_email" type="email" value="${esc(inv?.cliente_email || '')}" placeholder="cliente@correo.com" style="margin-top:6px">
          </details>
        </div>

        <div class="card">
          <div id="q-lines"></div>
          <button type="button" class="btn" id="q-add" style="margin-top:8px">+ Añadir concepto</button>
          <div class="row" style="margin-top:14px">
            <span class="small muted">Descuento</span>
            <input name="dto_valor" inputmode="decimal" value="${esc(inv?.dto_valor || '')}" placeholder="0" class="num" style="width:90px">
            ${['pct', 'eur'].map((v) => `<label class="chip"><input type="radio" name="dto_tipo" value="${v}" ${(inv?.dto_tipo || 'pct') === v ? 'checked' : ''}><span>${v === 'pct' ? '%' : '€'}</span></label>`).join('')}
          </div>
          <div class="small muted" id="q-sub" style="margin-top:8px"></div>
          <details class="small" style="margin-top:10px" ${inv?.notas ? 'open' : ''}><summary class="muted" style="cursor:pointer">Nota (opcional)</summary>
            <textarea name="notas" rows="2" style="margin-top:6px" placeholder="Ej.: material incluido, plazo 2 días…">${esc(inv?.notas ?? s['presupuesto.notas'] ?? '')}</textarea>
          </details>
        </div>

        <div class="quick-bar">
          <div class="quick-sum"><span class="small muted">Total <span class="nowrap">(IVA no incluido)</span></span><span class="quick-total" id="q-total"></span></div>
          <div class="quick-actions">
            <button type="submit" class="btn" value="save">Guardar</button>
            <button type="submit" class="btn mail" value="mail">Correo</button>
            <button type="submit" class="btn wa" value="wa">WhatsApp</button>
          </div>
        </div>
      </form>`;

    const form = $('#q-form');
    const imp = (l) => round2(parseNum(l.cantidad || 1) * parseNum(l.precio));
    const totals = () => {
      const bruto = round2(lines.reduce((a, l) => a + (String(l.descripcion).trim() ? imp(l) : 0), 0));
      const dto = calcDto(bruto, form.dto_tipo.value, form.dto_valor.value);
      return { bruto, dto, total: round2(bruto - dto) };
    };
    const renderTotal = () => {
      const t = totals();
      $('#q-total').textContent = eur(t.total);
      $('#q-sub').textContent = t.dto ? `Subtotal ${eur(t.bruto)} − descuento ${eur(t.dto)}` : '';
    };
    const renderLines = () => {
      $('#q-lines').innerHTML = lines
        .map(
          (l, i) => `<div class="q-line" data-i="${i}">
            <input data-f="descripcion" value="${esc(l.descripcion)}" placeholder="Concepto (ej.: cambiar enchufe)">
            <input data-f="cantidad" inputmode="decimal" value="${esc(l.cantidad ?? '')}" placeholder="1" title="Cantidad" class="num">
            <input data-f="precio" inputmode="decimal" value="${esc(l.precio)}" placeholder="€" class="num">
            <button type="button" class="btn ghost sm" data-del aria-label="Quitar">✕</button>
          </div>`
        )
        .join('');
      renderTotal();
    };
    $('#q-lines').addEventListener('input', (e) => {
      const i = Number(e.target.closest('.q-line').dataset.i);
      const f = e.target.dataset.f;
      lines[i][f] = e.target.value;
      dirty = true;
      renderTotal();
    });
    $('#q-lines').addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      lines.splice(Number(e.target.closest('.q-line').dataset.i), 1);
      if (!lines.length) lines.push({ descripcion: '', cantidad: '', precio: '' });
      renderLines();
    });
    $('#q-add').onclick = () => {
      lines.push({ descripcion: '', cantidad: '', precio: '' });
      renderLines();
      $$('#q-lines [data-f=descripcion]').at(-1).focus();
    };
    form.addEventListener('input', (e) => {
      if (e.target.name === 'dto_valor') renderTotal();
    });
    form.addEventListener('change', (e) => {
      if (e.target.name === 'dto_tipo') renderTotal();
    });
    form.cliente_nombre.addEventListener('input', () => {
      dirty = true;
      const c = clients.find((x) => x.nombre.toLowerCase() === form.cliente_nombre.value.trim().toLowerCase());
      clientId = c ? c.id : '';
      if (c && c.telefono && !form.cliente_telefono.value) form.cliente_telefono.value = c.telefono;
      if (c && c.direccion && !form.cliente_direccion.value) form.cliente_direccion.value = c.direccion;
      if (c && c.email && !form.cliente_email.value) {
        form.cliente_email.value = c.email;
        $('#q-email').open = true;
      }
    });
    $('#pick')?.addEventListener('click', async () => {
      try {
        const [c] = await navigator.contacts.select(['name', 'tel'], { multiple: false });
        if (!c) return;
        if (c.name?.[0]) form.cliente_nombre.value = c.name[0];
        if (c.tel?.[0]) form.cliente_telefono.value = c.tel[0];
        dirty = true;
      } catch {
        /* cancelado */
      }
    });

    // Datos del presupuesto tal y como se guardarán (y se pintan en el PDF)
    const buildDoc = () => {
      const f = formData(form);
      const good = lines
        .filter((l) => String(l.descripcion).trim())
        .map((l) => ({ ...l, cantidad: parseNum(l.cantidad || 1) || 1, precio: round2(parseNum(l.precio)), descuento: parseNum(l.descuento), importe: imp(l) }));
      const bruto = round2(good.reduce((a, l) => a + l.importe, 0));
      const dtoTipo = form.dto_tipo.value;
      const dtoValor = parseNum(form.dto_valor.value);
      const dto = calcDto(bruto, dtoTipo, dtoValor);
      const base = round2(bruto - dto);
      return {
        ...(inv || {}),
        tipo: 'presupuesto',
        numero,
        fecha,
        vencimiento: addDays(fecha, dias || 30),
        client_id: clientId,
        guardar_cliente: true,
        cliente_nombre: f.cliente_nombre.trim(),
        cliente_telefono: f.cliente_telefono.trim(),
        cliente_email: f.cliente_email.trim(),
        cliente_direccion: f.cliente_direccion.trim(),
        forma_pago: inv?.forma_pago || s['factura.forma_pago'],
        notas: f.notas,
        iva_pct: 0,
        irpf_pct: 0,
        dto_tipo: dtoValor ? dtoTipo : null,
        dto_valor: dtoValor,
        dto_importe: dto,
        base,
        iva: 0,
        irpf: 0,
        total: base,
        lines: good,
      };
    };

    form.onsubmit = async (e) => {
      e.preventDefault();
      const action = e.submitter?.value;
      const doc = buildDoc();
      if (!doc.cliente_nombre) return toast('Escribe el nombre del cliente.', 'error');
      if (!doc.lines.length) return toast('Añade al menos un concepto con su precio.', 'error');
      const btn = e.submitter;
      btn.disabled = true;
      try {
        const save = inv ? api('/invoices/' + inv.id, { method: 'PUT', body: doc }) : api('/invoices', { method: 'POST', body: doc });
        if (action === 'wa') {
          // PDF adjunto: se abre el menú de compartir del móvil (WhatsApp → contacto)
          const pdfBytes = await window.InvoicePdf.build(doc, s);
          const r = await sharePdf(doc, pdfBytes, fillText(s['whatsapp.mensaje'], doc, s));
          const saved = await save;
          dirty = false;
          if (r) await markShared(saved);
          go('#/factura/' + saved.id);
        } else if (action === 'mail') {
          // Se guarda y se abre la ventana de envío por correo con el PDF adjunto
          const saved = await save;
          dirty = false;
          go('#/factura/' + saved.id + '?enviar');
        } else {
          const saved = await save;
          dirty = false;
          toast('Presupuesto guardado', 'ok');
          go('#/factura/' + saved.id);
        }
      } catch (err) {
        toast(err.message, 'error');
      } finally {
        btn.disabled = false;
      }
    };

    renderLines();
    if (!inv) form.cliente_nombre.focus();
  }

  // ============================================================= CLIENTES

  async function pageClients() {
    const clients = await api('/clients');
    app.innerHTML = `
      <div class="page-head"><h1>Clientes</h1><button class="btn primary" id="new">+ Nuevo cliente</button></div>
      <div class="card">
        <input id="q" type="search" placeholder="Buscar por nombre, calle, teléfono, email, NIF…" style="margin-bottom:12px">
        <div class="table-wrap">
        ${
          clients.length
            ? `<table><thead><tr><th>Nombre</th><th>NIF</th><th class="hide-sm">Email</th><th class="hide-sm">Teléfono</th><th class="num">Facturas</th><th class="num">Facturado</th><th></th></tr></thead>
          <tbody>${clients
            .map(
              (c) => `<tr data-id="${c.id}" data-s="${esc([c.nombre, c.nif, c.email, c.telefono, String(c.telefono || '').replace(/\D/g, ''), c.direccion, c.cp, c.ciudad, c.provincia, c.notas].filter(Boolean).join(' ').toLowerCase())}">
              <td><strong>${esc(c.nombre)}</strong><br><span class="small muted">${esc(c.ciudad || '')}</span></td><td>${esc(c.nif || '')}</td>
              <td class="hide-sm">${esc(c.email || '')}</td><td class="hide-sm">${esc(c.telefono || '')}</td>
              <td class="num">${c.facturas}</td><td class="num">${eur(c.facturado)}</td>
              <td class="num"><button class="btn sm" data-edit>Editar</button> <button class="btn sm" data-inv>Facturar</button></td></tr>`
            )
            .join('')}</tbody></table>`
            : '<div class="empty">Aún no tienes clientes. Se guardan automáticamente al hacer una factura, o añádelos aquí.</div>'
        }
        </div>
      </div>`;

    $('#new').onclick = () => clientDialog(null);
    $('#q').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      const words = q.split(/\s+/).filter(Boolean).map((w) => (/^[\d\s]+$/.test(w) ? w.replace(/\s/g, '') : w));
      $$('tbody tr[data-s]').forEach((tr) => tr.classList.toggle('hidden', !words.every((w) => tr.dataset.s.includes(w))));
    };
    $$('tbody tr[data-id]').forEach((tr) => {
      const c = clients.find((x) => String(x.id) === tr.dataset.id);
      $('[data-edit]', tr).onclick = () => clientDialog(c);
      $('[data-inv]', tr).onclick = () => {
        sessionStorage.setItem('prefillClient', c.id);
        go('#/nueva');
      };
    });
  }

  function clientDialog(c) {
    const v = (k) => esc(c?.[k] || '');
    openDialog({
      title: c ? 'Editar cliente' : 'Nuevo cliente',
      body: `<div class="grid grid-2">
        <label class="span-2">Nombre / Razón social <input name="nombre" value="${v('nombre')}" required></label>
        <label>NIF / CIF <input name="nif" value="${v('nif')}"></label>
        <label>Email <input type="email" name="email" value="${v('email')}"></label>
        <label class="span-2">Dirección <input name="direccion" value="${v('direccion')}"></label>
        <label>C.P. <input name="cp" value="${v('cp')}"></label>
        <label>Ciudad <input name="ciudad" value="${v('ciudad')}"></label>
        <label>Provincia <input name="provincia" value="${v('provincia')}"></label>
        <label>Teléfono <input name="telefono" value="${v('telefono')}"></label>
        <label class="span-2">Notas <textarea name="notas" rows="2">${v('notas')}</textarea></label>
      </div>`,
      buttons: [
        ...(c ? [{ label: 'Borrar', value: 'delete', danger: true }] : []),
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Guardar', value: 'save', primary: true },
      ],
      onSubmit: async (form, action) => {
        if (action === 'delete') {
          if (!confirm(`¿Borrar el cliente ${c.nombre}? Sus facturas se conservan.`)) return false;
          await api('/clients/' + c.id, { method: 'DELETE' });
        } else if (c) await api('/clients/' + c.id, { method: 'PUT', body: formData(form) });
        else await api('/clients', { method: 'POST', body: formData(form) });
        toast('Cliente guardado', 'ok');
        router();
        return true;
      },
    });
  }

  // =============================================================== AJUSTES

  function readFileAsDataUrl(file) {
    return new Promise((res, rej) => {
      const r = new FileReader();
      r.onload = () => res(r.result);
      r.onerror = rej;
      r.readAsDataURL(file);
    });
  }

  // Reduce una imagen (logo) a un tamaño razonable y la pasa a PNG
  async function shrinkImage(file, max = 800) {
    const url = await readFileAsDataUrl(file);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('No se pudo leer la imagen.'));
      i.src = url;
    });
    const r = Math.min(1, max / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * r);
    c.height = Math.round(img.height * r);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }

  async function pageSettings() {
    const [{ settings: s }, banks, me] = await Promise.all([api('/settings'), api('/banks'), api('/me')]);
    const v = (k) => esc(s[k] ?? '');
    const images = { 'empresa.logo': s['empresa.logo'] || '', 'empresa.sello': s['empresa.sello'] || '' };

    app.innerHTML = `
      <div class="page-head"><h1>Ajustes</h1></div>

      <div class="card">
        <h2>Bancos</h2>
        <p class="small muted" style="margin-top:-6px">Añade tus cuentas. Al hacer una factura eliges el banco y su número de cuenta se escribe solo en la factura (abajo, a la derecha del sello).</p>
        <div class="table-wrap">
          ${
            banks.length
              ? `<table><thead><tr><th>Banco</th><th>IBAN</th><th class="hide-sm">BIC/SWIFT</th><th></th></tr></thead><tbody>
            ${banks
              .map(
                (b) => `<tr data-id="${b.id}"><td><strong>${esc(b.nombre)}</strong> ${b.predeterminado ? '<span class="badge emitida">predeterminado</span>' : ''}</td>
                <td>${esc(b.iban)}</td><td class="hide-sm">${esc(b.swift || '')}</td><td class="num"><button class="btn sm" data-edit-bank>Editar</button></td></tr>`
              )
              .join('')}</tbody></table>`
              : '<div class="empty" style="padding:16px">Todavía no hay bancos.</div>'
          }
        </div>
        <div class="row" style="margin-top:10px"><button class="btn primary" id="new-bank">+ Añadir banco</button></div>
      </div>

      <form id="settings-form">
        <div class="card">
          <h2>Datos de tu empresa (cabecera de la factura)</h2>
          <div class="grid grid-3">
            <label class="span-2">Actividad (debajo del logo) <input name="empresa.actividad" value="${v('empresa.actividad')}" placeholder="INSTALACIONES ELECTRICAS"></label>
            <label>NIF <input name="empresa.nif" value="${v('empresa.nif')}"></label>
            <label class="span-2">Nombre <input name="empresa.nombre" value="${v('empresa.nombre')}"></label>
            <label>Teléfono <input name="empresa.telefono" value="${v('empresa.telefono')}"></label>
            <label class="span-2">Dirección <input name="empresa.direccion" value="${v('empresa.direccion')}"></label>
            <label>C.P. <input name="empresa.cp" value="${v('empresa.cp')}"></label>
            <label>Ciudad <input name="empresa.ciudad" value="${v('empresa.ciudad')}"></label>
            <label class="span-2">Email (sale en vertical en el margen) <input name="empresa.email" value="${v('empresa.email')}"></label>
          </div>
          <div class="grid grid-2" style="margin-top:16px">
            ${['empresa.logo', 'empresa.sello']
              .map(
                (k) => `<div>
                <div class="small muted" style="font-weight:500;margin-bottom:6px">${k === 'empresa.logo' ? 'Logo' : 'Sello y firma (recuadro de abajo a la izquierda)'}</div>
                <div class="img-box" id="img-${k.split('.')[1]}"></div>
                <div class="row" style="margin-top:8px">
                  <label class="btn sm" style="flex-direction:row">Subir imagen<input type="file" accept="image/png,image/jpeg" class="hidden" data-img="${k}"></label>
                  <button type="button" class="btn sm danger" data-img-del="${k}">Quitar</button>
                </div>
                ${k === 'empresa.sello' ? '<p class="small muted" style="margin:6px 0 0">Puedes subir una captura: se quita el fondo blanco y las líneas negras de los bordes automáticamente.</p>' : ''}
              </div>`
              )
              .join('')}
          </div>
        </div>

        <div class="card">
          <h2>Facturas</h2>
          <div class="grid grid-3">
            <div class="small muted span-2" style="align-self:end">Formato del número: <code id="num-example"></code> (número / año). La numeración vuelve a empezar cada año.</div>
            <label>Empezar las facturas de ${new Date().getFullYear()} en el número
              <input name="factura.numero_inicial" type="number" min="1" value="${String(s['factura.numero_inicial_anio']) === String(new Date().getFullYear()) ? v('factura.numero_inicial') : ''}" placeholder="1">
            </label>
            <input type="hidden" name="factura.numero_inicial_anio" value="${new Date().getFullYear()}">
            <div class="small muted" style="align-self:end;grid-column:span 2">Úsalo si ya tienes facturas hechas fuera de la app este año. Ej.: pon 33 y la próxima factura será la 33/26.</div>
            <label>IVA por defecto (%) <input name="factura.iva_pct" inputmode="decimal" value="${v('factura.iva_pct')}"></label>
            <label>Retención IRPF por defecto (%) <input name="factura.irpf_pct" inputmode="decimal" value="${v('factura.irpf_pct')}"></label>
            <label>Días hasta vencimiento <input name="factura.dias_vencimiento" type="number" min="0" value="${v('factura.dias_vencimiento')}"></label>
            <label class="span-2">Forma de pago por defecto <input name="factura.forma_pago" value="${v('factura.forma_pago')}"></label>
            <label style="grid-column:1/-1">Observaciones por defecto <textarea name="factura.notas" rows="2">${v('factura.notas')}</textarea></label>
          </div>
        </div>

        <div class="card">
          <h2>Presupuestos</h2>
          <div class="grid grid-3">
            <div class="small muted" style="align-self:end">Numeración propia: 1/26, 2/26…</div>
            <label>Días de validez <input name="presupuesto.dias_validez" type="number" min="0" value="${v('presupuesto.dias_validez')}"></label>
            <div></div>
            <label style="grid-column:1/-1">Observaciones por defecto <textarea name="presupuesto.notas" rows="2">${v('presupuesto.notas')}</textarea></label>
            <label style="grid-column:1/-1">Mensaje de WhatsApp <textarea name="whatsapp.mensaje" rows="2">${v('whatsapp.mensaje')}</textarea></label>
            <p class="small muted" style="grid-column:1/-1;margin:0"><code>{{obra}}</code> pone "de la calle …" con la dirección del formulario (si no hay, no pone nada). También: <code>{{cliente.nombre}}</code> <code>{{fecha}}</code> <code>{{total}}</code></p>
          </div>
        </div>

        <div class="card">
          <h2>Correo</h2>
          <div id="mail-status"></div>
          <div class="grid" style="margin-top:14px">
            <label>Asunto (facturas) <input name="correo.asunto" value="${v('correo.asunto')}"></label>
            <label>Mensaje (facturas) <textarea name="correo.cuerpo" rows="8">${v('correo.cuerpo')}</textarea></label>
            <label>Asunto (presupuestos) <input name="correo.presupuesto_asunto" value="${v('correo.presupuesto_asunto')}"></label>
            <label>Mensaje (presupuestos) <textarea name="correo.presupuesto_cuerpo" rows="6">${v('correo.presupuesto_cuerpo')}</textarea></label>
            <p class="small muted" style="margin:0">Marcadores: <code>{{numero}}</code> <code>{{fecha}}</code> <code>{{cliente.nombre}}</code> <code>{{forma_pago}}</code> <code>{{empresa.nombre}}</code> <code>{{empresa.telefono}}</code> (y si algún día los quieres: <code>{{total}}</code> <code>{{banco.iban}}</code>)</p>
          </div>
          <details style="margin-top:14px">
            <summary class="small" style="cursor:pointer">Otra alternativa: enviar con Brevo</summary>
            <p class="small muted">Si no quieres registrar la app en Microsoft, crea una cuenta gratis en brevo.com, verifica tu correo como remitente y pega aquí la clave API.</p>
            <div class="grid grid-3">
              <label>Clave API de Brevo <input name="correo.brevo_key" type="password" placeholder="${me.brevo ? '•••••• (guardada)' : 'xkeysib-…'}" autocomplete="off"></label>
              <label>Correo remitente <input name="correo.remitente_email" value="${v('correo.remitente_email')}"></label>
              <label>Nombre remitente <input name="correo.remitente_nombre" value="${v('correo.remitente_nombre')}"></label>
            </div>
          </details>
        </div>

        <div class="row" style="margin-bottom:16px"><span class="spacer"></span><button class="btn primary" type="submit">Guardar ajustes</button></div>
      </form>

      <div class="card">
        <h2>Seguridad y copia de seguridad</h2>
        <p class="small muted" style="margin-top:-6px">Entras con <strong>${esc(me.email)}</strong>.</p>
        <div class="row">
          <button class="btn" id="change-email">Cambiar correo de acceso</button>
          <button class="btn" id="change-pass">Cambiar contraseña</button>
          <a class="btn" href="/api/backup">Descargar copia de seguridad</a>
        </div>
      </div>`;

    // --- Estado del correo
    const ms = $('#mail-status');
    const connectButtons = `<button type="button" class="btn primary sm" id="gmail-connect">Conectar Gmail</button>
      ${me.microsoft ? '<a class="btn sm" href="/auth/microsoft?modo=conectar">Conectar Outlook</a>' : ''}`;
    if (me.mail) {
      const tipo = me.mail.provider === 'smtp' ? (/gmail|googlemail/.test(me.mail.email) ? 'Gmail' : 'SMTP') : 'Outlook';
      ms.innerHTML = `<div class="alert info">Las facturas se envían desde <strong>${esc(me.mail.email)}</strong> (${tipo}).
        <div class="row" style="margin-top:8px">${connectButtons.replace('Conectar Gmail', 'Cambiar cuenta de Gmail')}<button type="button" class="btn sm danger" id="mail-off">Desconectar</button></div></div>`;
      $('#mail-off').onclick = async () => {
        if (!(await confirmDialog('Desconectar correo', 'Dejarás de poder enviar facturas hasta que conectes otro correo. ¿Continuar?', 'Desconectar', true))) return;
        await api('/mail-account', { method: 'DELETE' });
        router();
      };
    } else {
      ms.innerHTML = `<div class="alert ${me.brevo ? 'info' : 'warn'}">${me.brevo ? 'Enviando con Brevo.' : 'Aún no has conectado el correo desde el que se envían las facturas.'}
        <div class="row" style="margin-top:8px">${connectButtons}</div></div>`;
    }
    $('#gmail-connect').onclick = () => gmailDialog(me.mail?.provider === 'smtp' ? me.mail.email : '');

    // --- Imágenes (logo y sello)
    const renderImg = (k) => {
      const box = $('#img-' + k.split('.')[1]);
      box.innerHTML = images[k] ? `<img src="${images[k]}" alt="">` : '<span class="small muted">Sin imagen</span>';
    };
    Object.keys(images).forEach(renderImg);
    $$('[data-img]').forEach((input) =>
      input.addEventListener('change', async () => {
        const file = input.files[0];
        if (!file) return;
        await busy(null, async () => {
          const k = input.dataset.img;
          images[k] = k === 'empresa.sello' ? await window.InvoicePdf.cleanStamp(file) : await shrinkImage(file);
          if (images[k].length > 650000) throw new Error('La imagen es demasiado grande. Prueba con una más pequeña.');
          await api('/settings', { method: 'PUT', body: { [k]: images[k] } });
          renderImg(k);
          toast('Imagen guardada', 'ok');
        });
        input.value = '';
      })
    );
    $$('[data-img-del]').forEach((btn) =>
      btn.addEventListener('click', async () => {
        const k = btn.dataset.imgDel;
        images[k] = '';
        await api('/settings', { method: 'PUT', body: { [k]: '' } });
        renderImg(k);
      })
    );

    // --- Bancos
    $('#new-bank').onclick = () => bankDialog(null, banks.length === 0);
    $$('[data-edit-bank]').forEach((btn) => {
      btn.onclick = () => bankDialog(banks.find((b) => String(b.id) === btn.closest('tr').dataset.id));
    });

    // --- Formulario
    const form = $('#settings-form');
    const updateExample = () => {
      const n = String(Number(form['factura.numero_inicial'].value) || 1);
      $('#num-example').textContent = `${n}/${String(new Date().getFullYear()).slice(2)}`;
    };
    form['factura.numero_inicial'].oninput = updateExample;
    updateExample();

    form.onsubmit = (e) => {
      e.preventDefault();
      busy(e.submitter, async () => {
        const data = formData(form);
        if (!data['correo.brevo_key']) delete data['correo.brevo_key'];
        await api('/settings', { method: 'PUT', body: data });
        toast('Ajustes guardados', 'ok');
      });
    };

    $('#change-email').onclick = () =>
      openDialog({
        title: 'Cambiar correo de acceso',
        body: `<p class="small muted" style="margin:0">Ahora entras con <strong>${esc(me.email)}</strong>. Tus facturas y datos se mantienen.</p>
          <label>Nuevo correo <input type="email" name="email" required autocomplete="off"></label>
          <label>Contraseña actual <input type="password" name="password" required autocomplete="current-password"></label>`,
        buttons: [{ label: 'Cancelar', value: 'cancel' }, { label: 'Cambiar', value: 'save', primary: true }],
        onSubmit: async (f) => {
          const r = await api('/me/email', { method: 'POST', body: { email: f.email.value, password: f.password.value } });
          $('#user-email').textContent = r.email;
          toast('Ahora entras con ' + r.email, 'ok');
          setTimeout(router, 50);
          return true;
        },
      });

    $('#change-pass').onclick = () =>
      openDialog({
        title: 'Cambiar contraseña',
        body: '<label>Nueva contraseña (mínimo 8 caracteres) <input type="password" name="password" minlength="8" required autocomplete="new-password"></label>',
        buttons: [{ label: 'Cancelar', value: 'cancel' }, { label: 'Guardar', value: 'save', primary: true }],
        onSubmit: async (f) => {
          await api('/me/password', { method: 'POST', body: { password: f.password.value } });
          toast('Contraseña cambiada', 'ok');
          return true;
        },
      });
  }

  function gmailDialog(email) {
    openDialog({
      title: 'Conectar Gmail',
      body: `<ol class="small" style="margin:0;padding-left:18px">
          <li>Tu cuenta de Google debe tener activada la <strong>verificación en dos pasos</strong>.</li>
          <li>Entra en <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noopener">myaccount.google.com/apppasswords</a>, escribe un nombre (p. ej. "Facturas") y pulsa <strong>Crear</strong>.</li>
          <li>Copia la contraseña de 16 letras que aparece y pégala aquí abajo.</li>
        </ol>
        <label>Correo de Gmail <input type="email" name="email" value="${esc(email)}" required placeholder="tunombre@gmail.com"></label>
        <label>Contraseña de aplicación <input type="password" name="password" required autocomplete="off" placeholder="xxxx xxxx xxxx xxxx"></label>
        <label>Nombre que verá el cliente (opcional) <input name="name" placeholder="C&M Instalaciones Eléctricas"></label>
        <details><summary class="small muted" style="cursor:pointer">Otro proveedor (servidor SMTP)</summary>
          <div class="grid grid-2" style="margin-top:8px">
            <label>Servidor SMTP <input name="host" placeholder="smtp.tudominio.com"></label>
            <label>Puerto <input name="port" type="number" placeholder="465"></label>
          </div>
        </details>`,
      buttons: [{ label: 'Cancelar', value: 'cancel' }, { label: 'Comprobar y conectar', value: 'save', primary: true }],
      onSubmit: async (f) => {
        const r = await api('/mail-account/smtp', { method: 'POST', body: formData(f) });
        toast('Correo conectado: ' + r.email, 'ok');
        setTimeout(router, 50);
        return true;
      },
    });
  }

  function bankDialog(b, first = false) {
    openDialog({
      title: b ? 'Editar banco' : 'Añadir banco',
      body: `<div class="grid grid-2">
        <label class="span-2">Nombre del banco <input name="nombre" value="${esc(b?.nombre || '')}" placeholder="Ej.: Santander, BBVA, CaixaBank…" required></label>
        <label class="span-2">Número de cuenta (IBAN) <input name="iban" value="${esc(b?.iban || '')}" placeholder="ES00 0000 0000 0000 0000 0000" required></label>
        <label>BIC/SWIFT (opcional) <input name="swift" value="${esc(b?.swift || '')}"></label>
        <label class="check" style="align-self:end"><input type="checkbox" name="predeterminado" ${b?.predeterminado || first ? 'checked' : ''}> Banco predeterminado</label>
      </div>`,
      buttons: [
        ...(b ? [{ label: 'Borrar', value: 'delete', danger: true }] : []),
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Guardar', value: 'save', primary: true },
      ],
      onSubmit: async (form, action) => {
        if (action === 'delete') {
          if (!confirm(`¿Borrar el banco ${b.nombre}? Las facturas ya hechas conservan su número de cuenta.`)) return false;
          await api('/banks/' + b.id, { method: 'DELETE' });
        } else if (b) await api('/banks/' + b.id, { method: 'PUT', body: formData(form) });
        else await api('/banks', { method: 'POST', body: formData(form) });
        toast('Banco guardado', 'ok');
        router();
        return true;
      },
    });
  }

  // ================================================================ Inicio

  $('#logout').onclick = async () => {
    await fetch('/auth/logout', { method: 'POST' });
    location.href = '/login';
  };

  api('/me')
    .then((me) => ($('#user-email').textContent = me.email))
    .catch(() => {});
  const urlError = new URLSearchParams(location.search).get('error');
  if (urlError) {
    toast(urlError, 'error');
    history.replaceState(null, '', '/' + location.hash);
  }
  router();
})();
