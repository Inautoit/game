import { MODES, TIMES } from './config.js';

export const PAINT_OPTIONS = [
  { name: 'Gris Mansory', hex: 0x9ba2ab },
  { name: 'Negro', hex: 0x121418 },
  { name: 'Amarillo', hex: 0xf2b705 },
  { name: 'Verde', hex: 0x1f7a3f },
  { name: 'Rojo', hex: 0xb3141c },
  { name: 'Azul', hex: 0x1546c8 },
  { name: 'Naranja', hex: 0xe2640f },
  { name: 'Blanco', hex: 0xeef1f5 },
];

const $ = (id) => document.getElementById(id);

// Toda la interfaz DOM: menú, HUD, pausa y fin de partida.
export class UI {
  constructor(handlers) {
    this.h = handlers;
    this.settings = {
      mode: pick(load('mode', 'oneway'), Object.keys(MODES), 'oneway'),
      time: pick(load('time', 'day'), Object.keys(TIMES), 'day'),
      paint: Number(load('paint', 0)) || 0,
      steer: 'buttons',
      autoGas: true,
      sound: true,
    };

    this.el = {
      menu: $('menu'), hud: $('hud'), pause: $('pause'), over: $('over'),
      controls: $('controls'), loading: $('loading'),
      score: $('score'), distance: $('distance'), speed: $('speed'),
      nitroFill: $('nitro-fill'), nitroBar: document.querySelector('.nitro-bar'),
      speedo: document.querySelector('.speedo'),
      nitroBtn: document.querySelector('.nitro-btn'),
      toasts: $('toasts'), flash: $('flash'),
      menuBest: $('menu-best'), menuModeName: $('menu-mode-name'),
    };

    this._buildChips();
    this._bindButtons();
    this._last = { score: -1, distance: -1, speed: -1, nitro: -1, speedState: -1 };
  }

  _buildChips() {
    this.chips = {};

    this.chips.mode = chipGroup($('opt-mode'),
      Object.values(MODES).map((m) => ({ id: m.id, label: m.name })),
      (id) => this._set('mode', id));

    this.chips.time = chipGroup($('opt-time'),
      Object.values(TIMES).map((t) => ({ id: t.id, label: t.name })),
      (id) => this._set('time', id));

    this.chips.paint = chipGroup($('opt-paint'),
      PAINT_OPTIONS.map((p, i) => ({
        id: String(i), label: '', title: p.name,
        style: `background:#${p.hex.toString(16).padStart(6, '0')}`,
      })),
      (id) => this._set('paint', Number(id)));

    this.chips.steer = chipGroup($('opt-steer'), [
      { id: 'buttons', label: 'Botones' },
      { id: 'swipe', label: 'Deslizar' },
      { id: 'tilt', label: 'Inclinar' },
    ], (id) => this._set('steer', id));

    $('opt-autogas').addEventListener('click', () => this._set('autoGas', !this.settings.autoGas));
    $('opt-sound').addEventListener('click', () => this._set('sound', !this.settings.sound));
  }

  _bindButtons() {
    $('btn-play').addEventListener('click', () => this.h.onPlay());
    $('btn-options').addEventListener('click', () => {
      const panel = $('options-panel');
      const open = panel.classList.toggle('hidden');
      $('btn-options').textContent = open ? 'Opciones' : 'Cerrar opciones';
    });
    $('btn-pause').addEventListener('click', () => this.h.onPause());
    $('btn-resume').addEventListener('click', () => this.h.onResume());
    $('btn-quit').addEventListener('click', () => this.h.onQuit());
    $('btn-retry').addEventListener('click', () => this.h.onPlay());
    $('btn-menu').addEventListener('click', () => this.h.onQuit());
  }

  _set(key, value) {
    this.settings[key] = value;
    if (['mode', 'time', 'paint'].includes(key)) save(key, value);
    this.syncChips();
    this.h.onChange(key, value);
  }

  // El estado real de control/sonido vive en Input y Sound: lo importamos.
  adopt({ steer, autoGas, sound }) {
    this.settings.steer = steer;
    this.settings.autoGas = autoGas;
    this.settings.sound = sound;
    this.syncChips();
  }

  syncChips() {
    this.chips.mode(this.settings.mode);
    this.chips.time(this.settings.time);
    this.chips.paint(String(this.settings.paint));
    this.chips.steer(this.settings.steer);
    $('opt-autogas').classList.toggle('on', this.settings.autoGas);
    $('opt-sound').classList.toggle('on', this.settings.sound);
    this.el.menuModeName.textContent = MODES[this.settings.mode].name;
  }

  get mode() { return MODES[this.settings.mode]; }
  get time() { return TIMES[this.settings.time]; }
  get paintHex() { return PAINT_OPTIONS[this.settings.paint]?.hex ?? PAINT_OPTIONS[0].hex; }

  // ------------------------------------------------------------ pantallas
  hideLoading() { this.el.loading.classList.add('hidden'); }
  setLoading(text) { $('loading-text').textContent = text; }

  refreshBest(best) {
    this.el.menuBest.textContent = fmt(best);
    this.el.menuModeName.textContent = MODES[this.settings.mode].name;
  }

  showMenu(best) {
    this.el.menuBest.textContent = fmt(best);
    $('options-panel').classList.add('hidden');
    $('btn-options').textContent = 'Opciones';
    show(this.el.menu, true);
    show(this.el.hud, false);
    show(this.el.controls, false);
    show(this.el.pause, false);
    show(this.el.over, false);
    this.syncChips();
  }

  showGame() {
    show(this.el.menu, false);
    show(this.el.pause, false);
    show(this.el.over, false);
    show(this.el.hud, true);
    show(this.el.controls, true);
  }

  showPause(on) { show(this.el.pause, on); }

  showOver(stats) {
    $('over-score').textContent = fmt(stats.score);
    $('over-distance').textContent = fmt(stats.distance);
    $('over-overtakes').textContent = fmt(stats.overtakes);
    $('over-near').textContent = fmt(stats.nearMisses);
    $('over-best').textContent = fmt(stats.best);
    $('over-title').textContent = stats.title;
    show($('over-new-best'), stats.newBest);
    show(this.el.over, true);
    show(this.el.controls, false);
  }

  // ------------------------------------------------------------- en juego
  setScore(v) {
    const n = Math.floor(v);
    if (n === this._last.score) return;
    this._last.score = n;
    this.el.score.textContent = fmt(n);
  }
  setDistance(v) {
    const n = Math.floor(v);
    if (n === this._last.distance) return;
    this._last.distance = n;
    this.el.distance.textContent = fmt(n);
  }
  setSpeed(v, boost) {
    if (v !== this._last.speed) {
      this._last.speed = v;
      this.el.speed.textContent = v;
    }
    // 0 normal · 1 rápido · 2 con nitro
    const state = boost ? 2 : (v >= 180 ? 1 : 0);
    if (state !== this._last.speedState) {
      this._last.speedState = state;
      this.el.speedo.classList.toggle('fast', state === 1);
      this.el.speedo.classList.toggle('boost', state === 2);
    }
  }
  setNitro(pct, ready) {
    const n = Math.round(pct);
    if (n === this._last.nitro) return;
    this._last.nitro = n;
    this.el.nitroFill.style.width = n + '%';
    this.el.nitroBar.classList.toggle('full', ready);
    this.el.nitroBtn?.classList.toggle('ready', ready);
  }

  toast(text, kind = 'pass') {
    const el = document.createElement('div');
    el.className = 'toast ' + kind;
    el.textContent = text;
    this.el.toasts.appendChild(el);
    setTimeout(() => el.remove(), 1000);
    while (this.el.toasts.children.length > 4) this.el.toasts.firstChild.remove();
  }

  flash(kind = 'crash') {
    const el = this.el.flash;
    el.classList.remove('crash', 'nitro');
    el.classList.add(kind, 'on');
    clearTimeout(this._flashTimer);
    this._flashTimer = setTimeout(() => el.classList.remove('on'), kind === 'nitro' ? 130 : 90);
  }

  resetHud() {
    this._last = { score: -1, distance: -1, speed: -1, nitro: -1, speedState: -1 };
    this.el.toasts.innerHTML = '';
  }
}

// ---------------------------------------------------------------------------
function chipGroup(container, items, onPick) {
  container.innerHTML = '';
  const els = items.map((it) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = it.label;
    if (it.title) b.title = it.title;
    if (it.style) b.setAttribute('style', it.style);
    b.addEventListener('click', () => onPick(it.id));
    container.appendChild(b);
    return { id: it.id, el: b };
  });
  return (activeId) => els.forEach((e) => e.el.classList.toggle('on', e.id === String(activeId)));
}

const show = (el, on) => el.classList.toggle('hidden', !on);
const fmt = (n) => Math.floor(n).toLocaleString('es-ES');
const pick = (v, list, def) => (list.includes(v) ? v : def);

function load(key, def) {
  try {
    const v = localStorage.getItem('urus:' + key);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}
function save(key, value) {
  try { localStorage.setItem('urus:' + key, JSON.stringify(value)); } catch { /* ignorar */ }
}
