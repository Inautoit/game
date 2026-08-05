import {
  MODELS, FINISHES, WHEEL_STYLES, WINGS, HOODS, BACKGROUNDS,
  PAINT_SWATCHES, WHEEL_SWATCHES, PRESETS,
} from './config.js';

// Construye el panel de tuning en el DOM y despacha los cambios.
// `cfg` es el objeto de configuración vivo; se muta in situ y se avisa vía
// onApply(key). Los botones re-renderizan para reflejar el estado activo;
// los deslizadores solo aplican (sin re-render) para no cortar el arrastre.

export function buildUI(cfg, { onApply, onAction }) {
  const panel = document.getElementById('panel');

  const el = (tag, cls, txt) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (txt != null) n.textContent = txt;
    return n;
  };

  function section(title) {
    const s = el('section', 'sec');
    s.appendChild(el('h3', 'sec-t', title));
    const body = el('div', 'sec-b');
    s.appendChild(body);
    panel.appendChild(s);
    return body;
  }

  function chips(parent, options, current, onSel) {
    const wrap = el('div', 'chips');
    options.forEach((o) => {
      const b = el('button', 'chip' + (o.id === current ? ' on' : ''), o.name);
      b.addEventListener('click', () => onSel(o.id));
      wrap.appendChild(b);
    });
    parent.appendChild(wrap);
  }

  function swatches(parent, colors, current, onSel) {
    const wrap = el('div', 'sw');
    colors.forEach((c) => {
      const b = el('button', 'swatch' + (c.toLowerCase() === String(current).toLowerCase() ? ' on' : ''));
      b.style.background = c;
      b.addEventListener('click', () => onSel(c));
      wrap.appendChild(b);
    });
    parent.appendChild(wrap);
  }

  function colorPicker(parent, value, onSel) {
    const label = el('label', 'colinp');
    const input = el('input');
    input.type = 'color';
    input.value = value;
    input.addEventListener('input', () => onSel(input.value));
    label.appendChild(input);
    label.appendChild(el('span', null, 'Personalizado'));
    parent.appendChild(label);
  }

  function slider(parent, label, min, max, step, val, fmt, onInput) {
    const row = el('div', 'slider');
    const head = el('div', 'slabel');
    head.appendChild(el('span', null, label));
    const out = el('span', 'sval', fmt(val));
    head.appendChild(out);
    row.appendChild(head);
    const input = el('input');
    input.type = 'range';
    input.min = min; input.max = max; input.step = step; input.value = val;
    input.addEventListener('input', () => {
      const v = parseFloat(input.value);
      out.textContent = fmt(v);
      onInput(v);
    });
    row.appendChild(input);
    parent.appendChild(row);
  }

  function toggle(parent, label, val, onChange) {
    const row = el('label', 'toggle' + (val ? ' on' : ''));
    row.appendChild(el('span', null, label));
    const sw = el('span', 'tsw');
    row.appendChild(sw);
    row.addEventListener('click', () => onChange(!val));
    parent.appendChild(row);
  }

  // set(key, value) muta y aplica; re-render opcional para estados activos.
  const set = (k, v, rerender = true) => {
    cfg[k] = v;
    onApply(k);
    if (rerender) render();
  };

  function render() {
    panel.innerHTML = '';

    // Presets
    let b = section('Presets');
    const pr = el('div', 'chips');
    PRESETS.forEach((p) => {
      const btn = el('button', 'chip preset', p.name);
      btn.addEventListener('click', () => onAction('preset:' + p.id));
      pr.appendChild(btn);
    });
    b.appendChild(pr);

    // Modelo
    b = section('Carrocería');
    chips(b, MODELS, cfg.model, (v) => set('model', v));

    // Pintura
    b = section('Pintura');
    swatches(b, PAINT_SWATCHES, cfg.paint, (v) => set('paint', v));
    colorPicker(b, cfg.paint, (v) => set('paint', v, false));
    chips(b, FINISHES, cfg.finish, (v) => set('finish', v));

    // Llantas
    b = section('Llantas y neumáticos');
    chips(b, WHEEL_STYLES, cfg.wheelStyle, (v) => set('wheelStyle', v));
    swatches(b, WHEEL_SWATCHES, cfg.wheelColor, (v) => set('wheelColor', v));
    colorPicker(b, cfg.wheelColor, (v) => set('wheelColor', v, false));
    slider(b, 'Diámetro', 15, 20, 1, cfg.wheelSize, (v) => v + '"', (v) => set('wheelSize', v, false));

    // Suspensión
    b = section('Suspensión y estilo');
    slider(b, 'Altura', 0.16, 0.58, 0.01, cfg.rideHeight,
      (v) => v <= 0.24 ? 'Slam' : v >= 0.5 ? 'Lift' : Math.round(v * 100) + ' mm',
      (v) => set('rideHeight', v, false));
    slider(b, 'Camber (caída)', 0, 14, 0.5, cfg.camber, (v) => '-' + v + '°', (v) => set('camber', v, false));
    slider(b, 'Poke (vía)', -0.02, 0.14, 0.01, cfg.poke,
      (v) => v <= 0 ? 'Metida' : Math.round(v * 1000) + ' mm', (v) => set('poke', v, false));

    // Aero / kit
    b = section('Aerodinámica');
    chips(b, WINGS, cfg.wing, (v) => set('wing', v));
    chips(b, HOODS, cfg.hood, (v) => set('hood', v));
    toggle(b, 'Splitter delantero', cfg.splitter, (v) => set('splitter', v));
    toggle(b, 'Taloneras', cfg.skirts, (v) => set('skirts', v));
    toggle(b, 'Widebody (ensanchado)', cfg.widebody, (v) => set('widebody', v));

    // Detalles
    b = section('Detalles');
    slider(b, 'Tintado de lunas', 0, 1, 0.05, cfg.tint,
      (v) => v < 0.15 ? 'Claro' : v > 0.85 ? 'Limo' : Math.round(v * 100) + '%',
      (v) => set('tint', v, false));
    const cal = el('div', 'row2');
    cal.appendChild(el('span', 'rlbl', 'Pinzas de freno'));
    colorPicker(cal, cfg.caliper, (v) => set('caliper', v, false));
    b.appendChild(cal);
    toggle(b, 'Neón inferior', cfg.underglow, (v) => set('underglow', v));
    if (cfg.underglow) {
      const ug = el('div', 'row2');
      ug.appendChild(el('span', 'rlbl', 'Color del neón'));
      colorPicker(ug, cfg.underglowColor, (v) => set('underglowColor', v, false));
      b.appendChild(ug);
    }

    // Escena
    b = section('Escena');
    chips(b, BACKGROUNDS, cfg.bg, (v) => set('bg', v));
    toggle(b, 'Giro automático', cfg.autoRotate, (v) => set('autoRotate', v));

    // Acciones
    b = section('Acciones');
    const acts = el('div', 'acts');
    [['random', '🎲 Aleatorio'], ['screenshot', '📸 Captura'], ['share', '🔗 Compartir'], ['reset', '↺ Reset']]
      .forEach(([id, txt]) => {
        const btn = el('button', 'act', txt);
        btn.addEventListener('click', () => onAction(id));
        acts.appendChild(btn);
      });
    b.appendChild(acts);
  }

  render();
  return { render };
}
