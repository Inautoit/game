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

  const ESTADOS = ['borrador', 'emitida', 'enviada', 'pagada', 'anulada'];
  const badge = (estado) => `<span class="badge ${esc(estado)}">${esc(estado)}</span>`;

  // --------------------------------------------------------------- Router

  const routes = [
    [/^#?\/?$/, pageInvoices, 'facturas'],
    [/^#\/nueva$/, () => pageInvoiceForm(null), 'nueva'],
    [/^#\/factura\/(\d+)(?:\?enviar)?$/, (id) => pageInvoiceView(id), 'facturas'],
    [/^#\/factura\/(\d+)\/editar$/, (id) => pageInvoiceForm(id), 'facturas'],
    [/^#\/clientes$/, pageClients, 'clientes'],
    [/^#\/productos$/, pageProducts, 'productos'],
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

  // ============================================================ FACTURAS

  const listState = { year: String(new Date().getFullYear()), estado: '', q: '' };

  async function pageInvoices() {
    const years = await api('/invoices/years');
    if (!years.includes(listState.year) && listState.year) listState.year = years[0];

    app.innerHTML = `
      <div class="page-head">
        <h1>Registro de facturas</h1>
        <a class="btn" id="export" href="#">Exportar libro (Excel)</a>
        <a class="btn primary" href="#/nueva">+ Nueva factura</a>
      </div>
      <div class="stats" id="stats"></div>
      <div class="card">
        <div class="row" style="margin-bottom:12px">
          <select id="f-year" style="width:auto">
            <option value="">Todos los años</option>
            ${years.map((y) => `<option ${y === listState.year ? 'selected' : ''}>${esc(y)}</option>`).join('')}
          </select>
          <select id="f-estado" style="width:auto">
            <option value="">Todos los estados</option>
            ${ESTADOS.map((e) => `<option value="${e}" ${e === listState.estado ? 'selected' : ''}>${e}</option>`).join('')}
          </select>
          <input id="f-q" type="search" placeholder="Buscar por nº, cliente o NIF…" value="${esc(listState.q)}" style="flex:1;min-width:200px">
        </div>
        <div class="table-wrap" id="list"></div>
      </div>`;

    const load = async () => {
      const params = new URLSearchParams({ year: listState.year, estado: listState.estado, q: listState.q });
      const [rows, stats] = await Promise.all([
        api('/invoices?' + params),
        api('/stats?year=' + (listState.year || new Date().getFullYear())),
      ]);
      $('#export').href = '/api/export.csv?year=' + encodeURIComponent(listState.year || stats.year);
      const tot = stats.trimestres.reduce((a, t) => ({ base: a.base + t.base, iva: a.iva + t.iva, total: a.total + t.total }), { base: 0, iva: 0, total: 0 });
      const q = Math.ceil((new Date().getMonth() + 1) / 3);
      const tq = stats.trimestres[q - 1];
      $('#stats').innerHTML = `
        <div class="stat"><div class="label">Facturado ${esc(stats.year)} (base)</div><div class="value">${eur(tot.base)}</div></div>
        <div class="stat"><div class="label">Total con IVA ${esc(stats.year)}</div><div class="value">${eur(tot.total)}</div></div>
        <div class="stat"><div class="label">IVA ${q}º trimestre</div><div class="value">${eur(tq.iva)}</div></div>
        <div class="stat"><div class="label">Pendiente de cobro (${stats.pendiente.n})</div><div class="value">${eur(stats.pendiente.total)}</div></div>`;

      if (!rows.length) {
        $('#list').innerHTML = `<div class="empty">No hay facturas${listState.q || listState.estado ? ' con estos filtros' : ''}.<br><br><a class="btn primary" href="#/nueva">Crear la primera factura</a></div>`;
        return;
      }
      const sum = (k) => rows.filter((r) => r.estado !== 'anulada' && r.estado !== 'borrador').reduce((s, r) => s + r[k], 0);
      $('#list').innerHTML = `
        <table>
          <thead><tr><th>Nº</th><th class="hide-sm">Fecha</th><th>Cliente</th><th class="num hide-sm">Base</th><th class="num hide-sm">IVA</th><th class="num">Total</th><th>Estado</th><th class="hide-sm">Enviada</th></tr></thead>
          <tbody>
            ${rows
              .map(
                (r) => `<tr class="link" data-id="${r.id}">
                <td><strong>${esc(r.numero)}</strong></td>
                <td class="hide-sm">${fdate(r.fecha)}</td>
                <td>${esc(r.cliente_nombre)}</td>
                <td class="num hide-sm">${eur(r.base)}</td>
                <td class="num hide-sm">${eur(r.iva)}</td>
                <td class="num"><strong>${eur(r.total)}</strong></td>
                <td>${badge(r.estado)}</td>
                <td class="hide-sm small muted">${r.sent_at ? fdate(r.sent_at) : '—'}</td>
              </tr>`
              )
              .join('')}
          </tbody>
          <tfoot><tr><td colspan="3" class="small">${rows.length} factura(s) · totales sin borradores ni anuladas</td>
            <td class="num hide-sm">${eur(sum('base'))}</td><td class="num hide-sm">${eur(sum('iva'))}</td><td class="num">${eur(sum('total'))}</td><td colspan="2" class="hide-sm"></td></tr></tfoot>
        </table>`;
      $$('#list tr.link').forEach((tr) => tr.addEventListener('click', () => go('#/factura/' + tr.dataset.id)));
    };

    let t;
    $('#f-year').onchange = (e) => ((listState.year = e.target.value), load());
    $('#f-estado').onchange = (e) => ((listState.estado = e.target.value), load());
    $('#f-q').oninput = (e) => {
      clearTimeout(t);
      t = setTimeout(() => ((listState.q = e.target.value.trim()), load()), 250);
    };
    await load();
  }

  // ------------------------------------------------------- Formulario factura

  async function pageInvoiceForm(id) {
    const [settingsRes, clients, products, inv, banks] = await Promise.all([
      api('/settings'),
      api('/clients'),
      api('/products'),
      id ? api('/invoices/' + id) : null,
      api('/banks'),
    ]);
    const s = settingsRes.settings;
    const defaultBank = banks.find((b) => b.predeterminado) || banks[0];
    const fecha = inv?.fecha || today();
    const dias = parseNum(s['factura.dias_vencimiento']);
    const data = inv || {
      numero: (await api('/invoices/next-number?fecha=' + fecha)).numero,
      fecha,
      vencimiento: dias ? addDays(fecha, dias) : '',
      iva_pct: s['factura.iva_pct'],
      irpf_pct: s['factura.irpf_pct'],
      forma_pago: s['factura.forma_pago'],
      notas: s['factura.notas'],
      lines: [],
      estado: 'borrador',
      bank_id: defaultBank?.id || '',
    };
    let lines = (data.lines || []).map((l) => ({ ...l }));
    if (!lines.length) lines.push({ descripcion: '', cantidad: 1, unidad: 'ud', precio: 0, descuento: 0 });
    let dirty = false;
    leaveGuard = () => dirty;

    const warnIssued = inv && inv.estado !== 'borrador';

    app.innerHTML = `
      <div class="page-head">
        <h1>${inv ? 'Editar factura ' + esc(inv.numero) : 'Nueva factura'}</h1>
        <a class="btn" href="${inv ? '#/factura/' + inv.id : '#/'}">Cancelar</a>
      </div>
      ${warnIssued ? '<div class="alert warn" style="margin-bottom:16px">Esta factura ya está ' + esc(inv.estado) + '. Normalmente una factura emitida no se modifica: si hay un error, lo correcto es anularla y hacer otra (o una rectificativa).</div>' : ''}
      ${!s['empresa.nombre'] ? '<div class="alert info" style="margin-bottom:16px">Aún no has rellenado los datos de tu empresa (nombre, NIF, dirección, IBAN…). <a href="#/ajustes">Hazlo en Ajustes</a> para que salgan en las facturas.</div>' : ''}
      <form id="inv-form" autocomplete="off">
        <div class="card">
          <h2>Datos de la factura</h2>
          <div class="grid grid-4">
            <label>Nº de factura <input name="numero" value="${esc(data.numero)}" required></label>
            <label>Fecha <input type="date" name="fecha" value="${esc(data.fecha)}" required></label>
            <label>Vencimiento <input type="date" name="vencimiento" value="${esc(data.vencimiento || '')}"></label>
            <label>Forma de pago <input name="forma_pago" value="${esc(data.forma_pago || '')}" list="formas-pago"></label>
            <label class="span-2">Banco (sale en la factura con su nº de cuenta)
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
            <label>Email <input type="email" name="cliente_email" value="${esc(data.cliente_email || '')}" placeholder="para enviarle la factura"></label>
            <label class="span-2">Dirección <input name="cliente_direccion" value="${esc(data.cliente_direccion || '')}"></label>
            <label>C.P. <input name="cliente_cp" value="${esc(data.cliente_cp || '')}"></label>
            <label>Ciudad <input name="cliente_ciudad" value="${esc(data.cliente_ciudad || '')}"></label>
            <label>Provincia <input name="cliente_provincia" value="${esc(data.cliente_provincia || '')}"></label>
            <label>Teléfono <input name="cliente_telefono" value="${esc(data.cliente_telefono || '')}"></label>
            <label class="check span-2" style="align-self:end"><input type="checkbox" name="guardar_cliente" ${data.client_id ? '' : 'checked'}> <span id="save-client-label">Guardar en mis clientes</span></label>
          </div>
        </div>

        <div class="card">
          <h2>Productos y servicios</h2>
          <p class="small muted" style="margin-top:-6px">Empieza a escribir para elegir de tu catálogo de productos, o escribe uno nuevo.</p>
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
              <label>IVA %
                <select name="iva_pct">
                  ${['21', '10', '4', '0'].map((v) => `<option ${String(parseNum(data.iva_pct)) === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
              </label>
              <label>Retención IRPF %
                <select name="irpf_pct">
                  ${['0', '7', '15'].map((v) => `<option ${String(parseNum(data.irpf_pct)) === v ? 'selected' : ''}>${v}</option>`).join('')}
                </select>
              </label>
              <label class="span-2">Notas (salen en la factura) <textarea name="notas" rows="3">${esc(data.notas || '')}</textarea></label>
            </div>
            <div class="totals" id="totals"></div>
          </div>
        </div>

        <div class="row no-print">
          <span class="spacer"></span>
          <button type="submit" class="btn" value="save">Guardar</button>
          <button type="submit" class="btn primary" value="send">Guardar y enviar por correo</button>
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
    const lineImporte = (l) => round2(parseNum(l.cantidad) * parseNum(l.precio) * (1 - parseNum(l.descuento) / 100));

    function renderTotals() {
      const base = round2(lines.reduce((sum, l) => sum + (l.descripcion ? lineImporte(l) : 0), 0));
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
            <td class="c-qty"><input data-f="cantidad" inputmode="decimal" class="num" value="${esc(l.cantidad)}"></td>
            <td class="c-ud"><input data-f="unidad" value="${esc(l.unidad || '')}"></td>
            <td class="c-price"><input data-f="precio" inputmode="decimal" class="num" value="${esc(l.precio)}"></td>
            <td class="c-dto"><input data-f="descuento" inputmode="decimal" class="num" value="${esc(l.descuento || 0)}"></td>
            <td class="c-imp num" data-imp>${eur(lineImporte(l))}</td>
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
      $('[data-imp]', tr).textContent = eur(lineImporte(lines[i]));
      renderTotals();
      dirty = true;
      if (e.target.dataset.f === 'descripcion') showSuggestions(e.target, i);
    });
    tbody.addEventListener('click', (e) => {
      if (!e.target.closest('[data-del]')) return;
      const i = Number(e.target.closest('tr').dataset.i);
      lines.splice(i, 1);
      if (!lines.length) lines.push({ descripcion: '', cantidad: 1, unidad: 'ud', precio: 0, descuento: 0 });
      renderLines();
      dirty = true;
    });
    $('#add-line').onclick = () => {
      lines.push({ descripcion: '', cantidad: 1, unidad: 'ud', precio: 0, descuento: 0 });
      renderLines();
      $$('input[data-f=descripcion]', tbody).at(-1).focus();
    };
    form.iva_pct.onchange = renderTotals;
    form.irpf_pct.onchange = renderTotals;
    form.addEventListener('input', () => (dirty = true));

    // --- Autocompletado de productos del catálogo
    let acBox = null;
    let acSel = -1;
    const closeAc = () => {
      acBox?.remove();
      acBox = null;
      acSel = -1;
    };
    function showSuggestions(input, i) {
      closeAc();
      const q = input.value.trim().toLowerCase();
      if (!q) return;
      const matches = products.filter((p) => p.nombre.toLowerCase().includes(q)).slice(0, 8);
      if (!matches.length) return;
      acBox = document.createElement('div');
      acBox.className = 'ac-list';
      acBox.innerHTML = matches.map((p, k) => `<div data-k="${k}"><span>${esc(p.nombre)}</span><span class="muted">${eur(p.precio)} / ${esc(p.unidad)}</span></div>`).join('');
      input.parentElement.appendChild(acBox);
      const pick = (p) => {
        Object.assign(lines[i], { descripcion: p.nombre, precio: p.precio, unidad: p.unidad });
        closeAc();
        renderLines();
        $(`tr[data-i="${i}"] input[data-f=cantidad]`, tbody).select();
      };
      acBox.onmousedown = (e) => {
        const d = e.target.closest('[data-k]');
        if (d) {
          e.preventDefault();
          pick(matches[Number(d.dataset.k)]);
        }
      };
      input.onkeydown = (e) => {
        if (!acBox) return;
        const items = $$('[data-k]', acBox);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          acSel = (acSel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
          items.forEach((el, k) => el.classList.toggle('sel', k === acSel));
        } else if (e.key === 'Enter' && acSel >= 0) {
          e.preventDefault();
          pick(matches[acSel]);
        } else if (e.key === 'Escape') closeAc();
      };
      input.onblur = () => setTimeout(closeAc, 150);
    }

    // Número automático al cambiar la fecha (solo facturas nuevas)
    if (!inv) {
      let autoNumber = data.numero;
      form.fecha.onchange = async () => {
        if (form.numero.value === autoNumber) {
          autoNumber = (await api('/invoices/next-number?fecha=' + form.fecha.value)).numero;
          form.numero.value = autoNumber;
        }
        if (dias) form.vencimiento.value = addDays(form.fecha.value, dias);
      };
    }

    form.onsubmit = async (e) => {
      e.preventDefault();
      const action = e.submitter?.value;
      const body = { ...formData(form), lines: lines.filter((l) => String(l.descripcion).trim()) };
      if (!body.lines.length) return toast('Añade al menos un producto o servicio.', 'error');
      await busy(e.submitter, async () => {
        // Guarda los productos nuevos en el catálogo
        const nuevos = body.lines.filter((l) => !products.some((p) => p.nombre.toLowerCase() === String(l.descripcion).trim().toLowerCase()));
        if (nuevos.length && (await confirmDialog('¿Guardar productos nuevos?', `Hay ${nuevos.length} producto(s) que no están en tu catálogo:<br><br>${nuevos.map((l) => '• ' + esc(l.descripcion) + ' — ' + eur(parseNum(l.precio))).join('<br>')}<br><br>¿Los guardo para usarlos en próximas facturas?`, 'Sí, guardarlos'))) {
          for (const l of nuevos) {
            products.push(await api('/products', { method: 'POST', body: { nombre: l.descripcion, precio: parseNum(l.precio), unidad: l.unidad || 'ud' } }));
          }
        }
        const saved = inv
          ? await api('/invoices/' + inv.id, { method: 'PUT', body })
          : await api('/invoices', { method: 'POST', body });
        dirty = false;
        toast('Factura guardada', 'ok');
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

  // Genera el PDF de una factura (en el navegador)
  async function invoicePdf(inv) {
    const { settings } = await api('/settings');
    return window.InvoicePdf.build(inv, settings);
  }
  const pdfName = (inv) => `Factura_${String(inv.numero).replace(/[^\w.-]+/g, '_')}.pdf`;

  async function pageInvoiceView(id) {
    const inv = await api('/invoices/' + id);

    app.innerHTML = `
      <div class="page-head">
        <h1>Factura ${esc(inv.numero)} ${badge(inv.estado)}</h1>
        <a class="btn" href="#/">← Volver</a>
      </div>
      <div class="card no-print">
        <div class="row">
          <button class="btn primary" id="send">✉ Enviar por correo</button>
          <button class="btn" id="preview">Ver PDF</button>
          <button class="btn" id="download">Descargar PDF</button>
          <a class="btn" href="#/factura/${inv.id}/editar">Editar</a>
          <button class="btn" id="dup">Duplicar</button>
          <span class="spacer"></span>
          <label style="flex-direction:row;align-items:center;gap:8px">Estado
            <select id="estado" style="width:auto">${ESTADOS.map((e) => `<option ${e === inv.estado ? 'selected' : ''}>${e}</option>`).join('')}</select>
          </label>
          ${inv.estado === 'borrador' ? '<button class="btn danger" id="del">Borrar</button>' : ''}
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
                (l) => `<tr><td class="num">${l.cantidad.toLocaleString('es-ES')} ${esc(l.unidad && l.unidad !== 'ud' ? l.unidad : '')}</td><td>${esc(l.descripcion)}</td>
                  <td class="num">${eur(l.precio)}</td><td class="num">${l.descuento ? l.descuento + '%' : ''}</td><td class="num">${eur(l.importe)}</td></tr>`
              )
              .join('')}</tbody>
          </table>
        </div>
        <div class="totals" style="margin-top:14px">
          <div><span>Subtotal</span><span class="num">${eur(inv.base)}</span></div>
          <div><span>IVA (${inv.iva_pct}%)</span><span class="num">${eur(inv.iva)}</span></div>
          ${inv.irpf_pct ? `<div><span>Retención IRPF (${inv.irpf_pct}%)</span><span class="num">-${eur(inv.irpf)}</span></div>` : ''}
          <div class="grand"><span>TOTAL</span><span class="num">${eur(inv.total)}</span></div>
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
    $('#preview').onclick = (e) =>
      busy(e.target, async () => {
        const url = URL.createObjectURL(new Blob([await invoicePdf(inv)], { type: 'application/pdf' }));
        // En móvil los PDF no se ven dentro de la página: se abren en otra pestaña
        if (matchMedia('(max-width: 800px)').matches) return void window.open(url, '_blank');
        const dlg = openDialog({
          title: 'Factura ' + inv.numero,
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
        toast('Factura duplicada como ' + copy.numero, 'ok');
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
      if (!(await confirmDialog('Borrar borrador', `¿Borrar la factura ${esc(inv.numero)}? No se puede deshacer.`, 'Borrar', true))) return;
      await busy(null, async () => {
        await api('/invoices/' + inv.id, { method: 'DELETE' });
        toast('Factura borrada', 'ok');
        go('#/');
      });
    });

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
    const conectado = (me.mail && me.microsoft) || me.brevo;
    openDialog({
      title: 'Enviar factura ' + inv.numero,
      body: `
        ${conectado ? `<div class="small muted">Se enviará desde <strong>${esc(me.mail?.email || 'tu remitente de Brevo')}</strong> con la factura en PDF adjunta.</div>` : '<div class="alert warn">Aún no has conectado tu correo. Ve a <a href="#/ajustes">Ajustes → Correo</a> y pulsa "Conectar Outlook".</div>'}
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

  // ============================================================= CLIENTES

  async function pageClients() {
    const clients = await api('/clients');
    app.innerHTML = `
      <div class="page-head"><h1>Clientes</h1><button class="btn primary" id="new">+ Nuevo cliente</button></div>
      <div class="card">
        <input id="q" type="search" placeholder="Buscar cliente…" style="margin-bottom:12px">
        <div class="table-wrap">
        ${
          clients.length
            ? `<table><thead><tr><th>Nombre</th><th>NIF</th><th class="hide-sm">Email</th><th class="hide-sm">Teléfono</th><th class="num">Facturas</th><th class="num">Facturado</th><th></th></tr></thead>
          <tbody>${clients
            .map(
              (c) => `<tr data-id="${c.id}" data-s="${esc((c.nombre + ' ' + (c.nif || '') + ' ' + (c.email || '')).toLowerCase())}">
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
      $$('tbody tr[data-s]').forEach((tr) => tr.classList.toggle('hidden', !tr.dataset.s.includes(q)));
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

  // ============================================================ PRODUCTOS

  async function pageProducts() {
    const products = await api('/products');
    app.innerHTML = `
      <div class="page-head"><h1>Productos y servicios</h1><button class="btn primary" id="new">+ Nuevo producto</button></div>
      <p class="muted" style="margin-top:-8px">Tu catálogo con precios. Al hacer una factura, escribe y elige: el precio se rellena solo.</p>
      <div class="card">
        <input id="q" type="search" placeholder="Buscar producto…" style="margin-bottom:12px">
        <div class="table-wrap">
        ${
          products.length
            ? `<table><thead><tr><th>Producto / servicio</th><th>Unidad</th><th class="num">Precio (sin IVA)</th><th></th></tr></thead>
          <tbody>${products
            .map(
              (p) => `<tr data-id="${p.id}" data-s="${esc(p.nombre.toLowerCase())}"><td>${esc(p.nombre)}</td><td>${esc(p.unidad)}</td><td class="num">${eur(p.precio)}</td>
              <td class="num"><button class="btn sm" data-edit>Editar</button></td></tr>`
            )
            .join('')}</tbody></table>`
            : '<div class="empty">Aún no hay productos. Añade los materiales y servicios que más usas (p.ej. "Punto de luz", "Cable 2,5 mm²", "Hora de mano de obra").</div>'
        }
        </div>
      </div>`;
    $('#new').onclick = () => productDialog(null);
    $('#q').oninput = (e) => {
      const q = e.target.value.toLowerCase();
      $$('tbody tr[data-s]').forEach((tr) => tr.classList.toggle('hidden', !tr.dataset.s.includes(q)));
    };
    $$('tbody tr[data-id]').forEach((tr) => {
      $('[data-edit]', tr).onclick = () => productDialog(products.find((p) => String(p.id) === tr.dataset.id));
    });
  }

  function productDialog(p) {
    openDialog({
      title: p ? 'Editar producto' : 'Nuevo producto',
      body: `<div class="grid grid-3">
        <label class="span-2" style="grid-column:1/-1">Nombre / descripción <input name="nombre" value="${esc(p?.nombre || '')}" required></label>
        <label>Precio sin IVA (€) <input name="precio" inputmode="decimal" value="${esc(p?.precio ?? '')}" required></label>
        <label>Unidad <input name="unidad" value="${esc(p?.unidad || 'ud')}" list="unidades"></label>
        <datalist id="unidades"><option>ud</option><option>m</option><option>h</option><option>m²</option><option>kg</option><option>rollo</option></datalist>
      </div>`,
      buttons: [
        ...(p ? [{ label: 'Borrar', value: 'delete', danger: true }] : []),
        { label: 'Cancelar', value: 'cancel' },
        { label: 'Guardar', value: 'save', primary: true },
      ],
      onSubmit: async (form, action) => {
        const body = { ...formData(form), precio: parseNum(form.precio.value) };
        if (action === 'delete') await api('/products/' + p.id, { method: 'DELETE' });
        else if (p) await api('/products/' + p.id, { method: 'PUT', body });
        else await api('/products', { method: 'POST', body });
        toast('Producto guardado', 'ok');
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
            <label>Prefijo de numeración <input name="factura.prefijo" value="${v('factura.prefijo')}"></label>
            <label>Dígitos del número <input name="factura.digitos" type="number" min="1" max="8" value="${v('factura.digitos')}"></label>
            <div class="small muted" style="align-self:end">Ejemplo: <code id="num-example"></code><br>La numeración se reinicia cada año.</div>
            <label>IVA por defecto (%) <input name="factura.iva_pct" inputmode="decimal" value="${v('factura.iva_pct')}"></label>
            <label>Retención IRPF por defecto (%) <input name="factura.irpf_pct" inputmode="decimal" value="${v('factura.irpf_pct')}"></label>
            <label>Días hasta vencimiento <input name="factura.dias_vencimiento" type="number" min="0" value="${v('factura.dias_vencimiento')}"></label>
            <label class="span-2">Forma de pago por defecto <input name="factura.forma_pago" value="${v('factura.forma_pago')}"></label>
            <label style="grid-column:1/-1">Observaciones por defecto <textarea name="factura.notas" rows="2">${v('factura.notas')}</textarea></label>
          </div>
        </div>

        <div class="card">
          <h2>Correo</h2>
          <div id="mail-status"></div>
          <div class="grid" style="margin-top:14px">
            <label>Asunto <input name="correo.asunto" value="${v('correo.asunto')}"></label>
            <label>Mensaje <textarea name="correo.cuerpo" rows="8">${v('correo.cuerpo')}</textarea></label>
            <p class="small muted" style="margin:0">Marcadores: <code>{{numero}}</code> <code>{{fecha}}</code> <code>{{total}}</code> <code>{{cliente.nombre}}</code> <code>{{forma_pago}}</code> <code>{{banco.nombre}}</code> <code>{{banco.iban}}</code> <code>{{empresa.nombre}}</code> <code>{{empresa.telefono}}</code></p>
          </div>
          <details style="margin-top:14px">
            <summary class="small" style="cursor:pointer">Alternativa sin Microsoft: enviar con Brevo</summary>
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
    if (me.mail) {
      ms.innerHTML = `<div class="alert info">Conectado a <strong>${esc(me.mail.email)}</strong> (Outlook). Las facturas se envían desde esta cuenta y se guardan en tus Enviados.
        <div class="row" style="margin-top:8px"><a class="btn sm" href="/auth/microsoft?modo=conectar">Cambiar de cuenta</a><button class="btn sm danger" id="mail-off">Desconectar</button></div></div>`;
      $('#mail-off').onclick = async () => {
        await api('/mail-account', { method: 'DELETE' });
        router();
      };
    } else if (me.microsoft) {
      ms.innerHTML = `<div class="alert warn">Tu correo no está conectado todavía.
        <div class="row" style="margin-top:8px"><a class="btn primary sm" href="/auth/microsoft?modo=conectar">Conectar Outlook</a></div></div>`;
    } else {
      ms.innerHTML = `<div class="alert ${me.brevo ? 'info' : 'warn'}">${me.brevo ? 'Enviando con Brevo.' : 'Para enviar desde tu Outlook falta registrar la app en Microsoft (ver instrucciones del README). Mientras tanto puedes usar Brevo (abajo).'}</div>`;
    }

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
      $('#num-example').textContent = `${form['factura.prefijo'].value}${new Date().getFullYear()}-${'1'.padStart(Number(form['factura.digitos'].value) || 4, '0')}`;
    };
    form['factura.prefijo'].oninput = updateExample;
    form['factura.digitos'].oninput = updateExample;
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
