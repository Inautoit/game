// Planificador de trabajo: proyectos, cosas y tickets con notas e información.
// Todo se guarda en localStorage del navegador.
(function () {
  'use strict';

  const STORAGE_KEY = 'planificador.items.v1';
  const TYPES = { proyecto: 'Proyecto', cosa: 'Cosa', ticket: 'Ticket' };
  const PRIORITY_ORDER = { alta: 0, media: 1, baja: 2 };

  let items = load();
  let tab = 'pendientes';
  let filter = 'todos';
  let query = '';
  let editingId = null;   // id del elemento abierto en el panel
  let draftType = null;   // tipo de un elemento nuevo aún sin guardar

  const $ = (sel) => document.querySelector(sel);

  // ---------- Persistencia ----------
  function load() {
    try {
      const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }
  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch (e) {
      alert('No se han podido guardar los datos en este navegador.');
    }
  }

  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const byId = (id) => items.find((i) => i.id === id);
  const today = () => new Date().toISOString().slice(0, 10);

  function formatDate(iso) {
    if (!iso) return '';
    const d = iso.length === 10 ? new Date(iso + 'T00:00:00') : new Date(iso);
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  }
  function formatDateTime(iso) {
    return new Date(iso).toLocaleString('es-ES', {
      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'
    });
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v);
    }
    for (const c of children) if (c != null) node.append(c);
    return node;
  }

  // ---------- Lista principal ----------
  function visibleItems() {
    const q = query.trim().toLowerCase();
    return items
      .filter((i) => (tab === 'terminados' ? i.done : !i.done))
      .filter((i) => filter === 'todos' || i.type === filter)
      .filter((i) => {
        if (!q) return true;
        const text = [i.title, i.info, i.ref, ...(i.notes || []).map((n) => n.text)].join(' ');
        return text.toLowerCase().includes(q);
      })
      .sort((a, b) => {
        if (tab === 'terminados') return (b.doneAt || '').localeCompare(a.doneAt || '');
        // Pendientes: prioridad, luego fecha límite (las que tienen fecha primero), luego más reciente
        const p = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
        if (p) return p;
        if (a.due !== b.due) return !a.due ? 1 : !b.due ? -1 : a.due.localeCompare(b.due);
        return b.createdAt.localeCompare(a.createdAt);
      });
  }

  function renderList() {
    const list = $('#list');
    list.replaceChildren();
    const shown = visibleItems();

    for (const item of shown) {
      const meta = el('div', { class: 'meta' }, el('span', { class: 'badge ' + item.type }, TYPES[item.type]));
      if (item.ref) meta.append(el('span', { class: 'pill' }, item.ref));
      if (tab === 'pendientes') {
        meta.append(el('span', { class: 'pill ' + item.priority }, 'Prioridad ' + item.priority));
      }
      if (item.due) {
        const overdue = !item.done && item.due < today();
        meta.append(el('span', { class: 'pill' + (overdue ? ' overdue' : '') }, (overdue ? 'Vencido ' : 'Para el ') + formatDate(item.due)));
      }
      const project = item.projectId && byId(item.projectId);
      if (project) meta.append(el('span', { class: 'pill' }, '📁 ' + project.title));
      if (item.type === 'proyecto') {
        const kids = items.filter((i) => i.projectId === item.id);
        if (kids.length) meta.append(el('span', { class: 'pill' }, `${kids.filter((k) => k.done).length}/${kids.length} hechas`));
      }
      if (item.notes && item.notes.length) meta.append(el('span', null, '📝 ' + item.notes.length));
      if (item.done && item.doneAt) meta.append(el('span', null, '✔ ' + formatDate(item.doneAt)));

      const check = el('input', {
        type: 'checkbox', class: 'check', checked: item.done,
        'aria-label': item.done ? 'Marcar como pendiente' : 'Marcar como terminado',
        onclick: (e) => e.stopPropagation(),
        onchange: () => setDone(item.id, check.checked)
      });

      list.append(el('li', { class: `item ${item.type}${item.done ? ' done' : ''}`, onclick: () => openPanel(item.id) },
        check,
        el('div', { class: 'item-body' },
          el('div', { class: 'item-title' }, item.title),
          item.info ? el('div', { class: 'item-info' }, item.info.split('\n')[0]) : null,
          meta)));
    }

    const empty = $('#empty');
    empty.hidden = shown.length > 0;
    empty.textContent = query
      ? 'No hay resultados para tu búsqueda.'
      : tab === 'pendientes'
        ? 'Nada pendiente. Añade un proyecto, una cosa o un ticket con los botones de arriba.'
        : 'Todavía no has terminado nada.';

    $('#count-pend').textContent = items.filter((i) => !i.done).length;
    $('#count-done').textContent = items.filter((i) => i.done).length;
  }

  function setDone(id, done) {
    const item = byId(id);
    if (!item) return;
    item.done = done;
    item.doneAt = done ? new Date().toISOString() : null;
    save();
    renderList();
    if (editingId === id) renderPanel();
  }

  // ---------- Panel de detalle ----------
  function openNew(type) {
    editingId = null;
    draftType = type;
    $('#form').reset();
    $('#f-priority').value = 'media';
    showOverlay();
    renderPanel();
    $('#f-title').focus();
  }

  function openPanel(id) {
    editingId = id;
    draftType = null;
    showOverlay();
    renderPanel();
  }

  function showOverlay() {
    $('#overlay').hidden = false;
    document.body.style.overflow = 'hidden';
  }
  function closePanel() {
    $('#overlay').hidden = true;
    document.body.style.overflow = '';
    editingId = null;
    draftType = null;
  }

  function renderPanel() {
    const item = editingId ? byId(editingId) : null;
    const type = item ? item.type : draftType;

    const badge = $('#f-badge');
    badge.className = 'badge ' + type;
    badge.textContent = (item ? '' : 'Nuevo: ') + TYPES[type];

    $('#f-ref-wrap').hidden = type !== 'ticket';
    $('#f-project-wrap').hidden = type === 'proyecto';

    // Selector de proyecto
    const sel = $('#f-project');
    sel.replaceChildren(el('option', { value: '' }, '— Ninguno —'));
    for (const p of items.filter((i) => i.type === 'proyecto')) {
      sel.append(el('option', { value: p.id }, p.title + (p.done ? ' (terminado)' : '')));
    }

    if (item) {
      $('#f-title').value = item.title;
      $('#f-ref').value = item.ref || '';
      $('#f-priority').value = item.priority;
      $('#f-due').value = item.due || '';
      $('#f-info').value = item.info || '';
      sel.value = item.projectId || '';
    }

    const toggle = $('#toggle-done');
    toggle.hidden = !item;
    toggle.textContent = item && item.done ? '↺ Volver a pendiente' : '✔ Marcar terminado';
    $('#delete').hidden = !item;

    // Notas: solo cuando el elemento ya existe
    $('#notes-section').hidden = !item;
    const notes = $('#notes');
    notes.replaceChildren();
    if (item) {
      if (!item.notes.length) notes.append(el('li', { class: 'muted' }, 'Sin notas todavía.'));
      for (const n of [...item.notes].reverse()) {
        notes.append(el('li', { class: 'note' },
          el('div', { class: 'note-head' },
            el('span', null, formatDateTime(n.date)),
            el('button', { type: 'button', onclick: () => deleteNote(n.id) }, 'Borrar')),
          n.text));
      }
    }

    // Hijos de un proyecto
    const kids = item && item.type === 'proyecto' ? items.filter((i) => i.projectId === item.id) : [];
    $('#children-section').hidden = !(item && item.type === 'proyecto');
    const childList = $('#children');
    childList.replaceChildren();
    if (item && item.type === 'proyecto') {
      if (!kids.length) childList.append(el('li', { class: 'muted' }, 'Asigna este proyecto desde una cosa o un ticket.'));
      for (const k of kids) {
        childList.append(el('li', { class: k.done ? 'done' : '', onclick: () => openPanel(k.id) },
          el('span', { class: 'badge ' + k.type }, TYPES[k.type]),
          el('span', null, k.title)));
      }
    }
  }

  function saveForm(e) {
    e.preventDefault();
    const title = $('#f-title').value.trim();
    if (!title) return;
    let item = editingId ? byId(editingId) : null;
    if (!item) {
      item = {
        id: uid(), type: draftType, notes: [], done: false, doneAt: null,
        createdAt: new Date().toISOString()
      };
      items.push(item);
    }
    item.title = title;
    item.info = $('#f-info').value;
    item.priority = $('#f-priority').value;
    item.due = $('#f-due').value || '';
    item.ref = item.type === 'ticket' ? $('#f-ref').value.trim() : '';
    item.projectId = item.type === 'proyecto' ? '' : $('#f-project').value;
    save();
    const isNew = !editingId;
    editingId = item.id;
    draftType = null;
    renderList();
    if (isNew) renderPanel(); // se queda abierto para poder añadir notas
    else closePanel();
  }

  function addNote(e) {
    e.preventDefault();
    const item = byId(editingId);
    const text = $('#note-text').value.trim();
    if (!item || !text) return;
    item.notes.push({ id: uid(), text, date: new Date().toISOString() });
    $('#note-text').value = '';
    save();
    renderPanel();
    renderList();
  }

  function deleteNote(noteId) {
    const item = byId(editingId);
    if (!item || !confirm('¿Borrar esta nota?')) return;
    item.notes = item.notes.filter((n) => n.id !== noteId);
    save();
    renderPanel();
    renderList();
  }

  function deleteItem() {
    const item = byId(editingId);
    if (!item || !confirm(`¿Eliminar "${item.title}"? No se puede deshacer.`)) return;
    items = items.filter((i) => i.id !== item.id);
    // Desvincula lo que colgaba de un proyecto eliminado
    for (const i of items) if (i.projectId === item.id) i.projectId = '';
    save();
    closePanel();
    renderList();
  }

  // ---------- Exportar / importar ----------
  function exportData() {
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const a = el('a', { href: URL.createObjectURL(blob), download: `planificador-${today()}.json` });
    document.body.append(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(a.href);
  }

  function importData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data)) throw new Error();
        if (!confirm(`Se van a cargar ${data.length} elementos y reemplazar los actuales. ¿Continuar?`)) return;
        items = data.map((i) => ({ notes: [], priority: 'media', ...i }));
        save();
        renderList();
      } catch (e) {
        alert('El archivo no es una copia válida.');
      }
    };
    reader.readAsText(file);
  }

  // ---------- Eventos ----------
  document.querySelectorAll('[data-new]').forEach((b) => b.addEventListener('click', () => openNew(b.dataset.new)));
  document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => {
    tab = b.dataset.tab;
    document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === b));
    renderList();
  }));
  document.querySelectorAll('.chip').forEach((b) => b.addEventListener('click', () => {
    filter = b.dataset.filter;
    document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', c === b));
    renderList();
  }));
  $('#search').addEventListener('input', (e) => { query = e.target.value; renderList(); });

  $('#form').addEventListener('submit', saveForm);
  $('#note-form').addEventListener('submit', addNote);
  $('#note-text').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) addNote(e);
  });
  $('#toggle-done').addEventListener('click', () => {
    const item = byId(editingId);
    if (item) setDone(item.id, !item.done);
  });
  $('#delete').addEventListener('click', deleteItem);
  $('#close').addEventListener('click', closePanel);
  $('#overlay').addEventListener('click', (e) => { if (e.target.id === 'overlay') closePanel(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !$('#overlay').hidden) closePanel(); });

  $('#export').addEventListener('click', exportData);
  $('#import').addEventListener('change', (e) => {
    if (e.target.files[0]) importData(e.target.files[0]);
    e.target.value = '';
  });

  renderList();
})();
