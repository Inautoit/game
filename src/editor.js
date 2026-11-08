// Editor de mapas: pintas la isla en una cuadrícula vista desde arriba.
import { WORLDS, MAP_LIMITS, validateMap } from './levels.js';

const TOOLS = [
  { c: '.', name: 'Suelo' },
  { c: '#', name: 'Muro' },
  { c: 'T', name: 'Árbol' },
  { c: '~', name: 'Hielo' },
  { c: ' ', name: 'Vacío' },
  { c: 'S', name: 'Salida' },
  { c: 'G', name: 'Meta' },
  { c: '*', name: 'Gema' },
];

const store = {
  get(k, d) { try { const v = localStorage.getItem('isla.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('isla.' + k, JSON.stringify(v)); } catch { /* nada */ } },
};

function blank(w, h) {
  const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (x === 0 || y === 0 || x === w - 1 || y === h - 1 ? '#' : '.')));
  g[1][1] = 'S';
  g[h - 2][w - 2] = 'G';
  return g;
}

export function createEditor({ onTest, onPublish, onBack, toast, sfx }) {
  const $ = (id) => document.getElementById(id);
  const cv = $('edCanvas');
  const ctx = cv.getContext('2d');
  const wrap = $('edCanvasWrap');
  const draft = store.get('draft', null);
  let grid = draft ? draft.rows.map((r) => [...r]) : blank(9, 11);
  let worldId = draft ? draft.world : 'pradera';
  let verified = draft ? draft.verified : '';
  let tool = '#';
  let cell = 20, offX = 0, offY = 0;

  const W = () => grid[0].length;
  const H = () => grid.length;
  const world = () => WORLDS.find((w) => w.id === worldId) || WORLDS[0];

  // Mapa recortado (sin filas/columnas vacías en los bordes)
  function rows() {
    let r = grid.map((row) => row.join(''));
    while (r.length && !r[0].trim()) r.shift();
    while (r.length && !r[r.length - 1].trim()) r.pop();
    if (!r.length) return [];
    let left = Math.min(...r.map((s) => (s.trim() ? s.search(/\S/) : Infinity)));
    if (!Number.isFinite(left)) left = 0;
    r = r.map((s) => s.slice(left).replace(/\s+$/, ''));
    return r;
  }
  const key = () => worldId + '|' + rows().join('/');

  function save() { store.set('draft', { rows: grid.map((r) => r.join('')), world: worldId, verified }); }

  // ---- Dibujo ----
  function fit() {
    const r = wrap.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    cell = Math.max(10, Math.floor(Math.min((r.width - 8) / W(), (r.height - 8) / H())));
    const cw = cell * W(), ch = cell * H();
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cv.style.width = cw + 'px'; cv.style.height = ch + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function draw() {
    const wd = world();
    const w = W(), h = H(), s = cell;
    ctx.clearRect(0, 0, w * s, h * s);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const c = grid[y][x], px = x * s, py = y * s;
        if (c === ' ' || c === 'o') {
          ctx.fillStyle = (x + y) % 2 ? 'rgba(47,37,64,0.06)' : 'rgba(47,37,64,0.03)';
          ctx.fillRect(px, py, s, s);
          continue;
        }
        ctx.fillStyle = c === '~' ? wd.ice : (x + y) % 2 ? wd.grass : wd.grass2;
        ctx.fillRect(px, py, s, s);
        if (c === '~') {
          ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = Math.max(1, s * 0.06);
          ctx.beginPath(); ctx.moveTo(px + s * 0.2, py + s * 0.7); ctx.lineTo(px + s * 0.45, py + s * 0.3); ctx.stroke();
        }
        if (c === '#' || c === 'T') {
          ctx.fillStyle = wd.wall;
          ctx.fillRect(px + 1, py + 1, s - 2, s - 2);
          ctx.fillStyle = 'rgba(255,255,255,0.18)';
          ctx.fillRect(px + 1, py + 1, s - 2, s * 0.22);
          if (c === 'T') {
            ctx.fillStyle = '#2f7d3d';
            ctx.beginPath(); ctx.moveTo(px + s / 2, py + s * 0.12); ctx.lineTo(px + s * 0.82, py + s * 0.78); ctx.lineTo(px + s * 0.18, py + s * 0.78); ctx.closePath(); ctx.fill();
          }
        }
        if (c === 'S') {
          const cx = px + s / 2, cy = py + s / 2, r = s * 0.32;
          ['#ff5f7e', '#ffffff', '#ffc93c', '#ffffff', '#38b6ff', '#ffffff'].forEach((col, i) => {
            ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, (i / 6) * Math.PI * 2, ((i + 1) / 6) * Math.PI * 2); ctx.fill();
          });
          ctx.strokeStyle = 'rgba(47,37,64,0.35)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke();
        }
        if (c === 'G') {
          ctx.fillStyle = '#ffc93c'; ctx.beginPath(); ctx.arc(px + s / 2, py + s / 2, s * 0.34, 0, Math.PI * 2); ctx.fill();
          ctx.fillStyle = '#fff'; ctx.fillRect(px + s * 0.62, py + s * 0.12, Math.max(1.5, s * 0.06), s * 0.5);
          ctx.fillStyle = '#ff4f8b'; ctx.beginPath(); ctx.moveTo(px + s * 0.66, py + s * 0.12); ctx.lineTo(px + s * 0.92, py + s * 0.22); ctx.lineTo(px + s * 0.66, py + s * 0.32); ctx.fill();
        }
        if (c === '*') {
          const cx = px + s / 2, cy = py + s / 2;
          ctx.fillStyle = '#38b6ff';
          ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.32); ctx.lineTo(cx + s * 0.24, cy); ctx.lineTo(cx, cy + s * 0.32); ctx.lineTo(cx - s * 0.24, cy); ctx.closePath(); ctx.fill();
          ctx.fillStyle = 'rgba(255,255,255,0.6)';
          ctx.beginPath(); ctx.moveTo(cx, cy - s * 0.32); ctx.lineTo(cx + s * 0.08, cy); ctx.lineTo(cx, cy + s * 0.1); ctx.lineTo(cx - s * 0.08, cy); ctx.closePath(); ctx.fill();
        }
      }
    }
    // Cuadrícula
    ctx.strokeStyle = 'rgba(47,37,64,0.08)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= w; x++) { ctx.moveTo(x * s + 0.5, 0); ctx.lineTo(x * s + 0.5, h * s); }
    for (let y = 0; y <= h; y++) { ctx.moveTo(0, y * s + 0.5); ctx.lineTo(w * s, y * s + 0.5); }
    ctx.stroke();
    status();
  }

  function status() {
    const errs = validateMap(rows());
    const gems = grid.flat().filter((c) => c === '*').length;
    const msg = $('edMsg');
    $('edSizeW').textContent = W();
    $('edSizeH').textContent = H();
    $('edGems').textContent = `${gems}/${MAP_LIMITS.maxGems}`;
    const ok = !errs.length;
    const isVerified = ok && verified === key();
    msg.className = 'ed-msg ' + (ok ? (isVerified ? 'ok' : 'info') : 'err');
    msg.textContent = !ok ? errs[0] : isVerified ? '✓ Superado. ¡Ya puedes publicarlo!' : 'Pruébalo y supéralo para poder publicarlo';
    $('edPublish').disabled = !isVerified;
  }

  // ---- Pintar ----
  let painting = false;
  function cellFrom(e) {
    const r = cv.getBoundingClientRect();
    const x = Math.floor((e.clientX - r.left) / cell), y = Math.floor((e.clientY - r.top) / cell);
    return x >= 0 && y >= 0 && x < W() && y < H() ? [x, y] : null;
  }
  function paint(x, y, first) {
    const cur = grid[y][x];
    if (tool === 'S' || tool === 'G') {
      for (const row of grid) for (let i = 0; i < row.length; i++) if (row[i] === tool) row[i] = '.';
      grid[y][x] = tool;
    } else if (tool === '*') {
      if (!first) return;
      if (cur === '*') grid[y][x] = '.';
      else {
        if (grid.flat().filter((c) => c === '*').length >= MAP_LIMITS.maxGems) { toast(`Máximo ${MAP_LIMITS.maxGems} gemas`); return; }
        grid[y][x] = '*';
      }
    } else {
      if (cur === tool) return;
      grid[y][x] = tool;
    }
    save();
    draw();
  }
  cv.addEventListener('pointerdown', (e) => {
    const c = cellFrom(e); if (!c) return;
    painting = true;
    try { cv.setPointerCapture(e.pointerId); } catch { /* nada */ }
    paint(c[0], c[1], true);
  });
  cv.addEventListener('pointermove', (e) => {
    if (!painting || tool === '*') return;
    const c = cellFrom(e); if (c) paint(c[0], c[1], false);
  });
  const stop = () => { painting = false; };
  cv.addEventListener('pointerup', stop);
  cv.addEventListener('pointercancel', stop);

  // ---- Herramientas ----
  const toolsEl = $('edTools');
  TOOLS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tool';
    b.dataset.c = t.c;
    b.innerHTML = `<i class="sw sw-${t.c === ' ' ? 'void' : t.c === '#' ? 'wall' : t.c === '.' ? 'floor' : t.c === '~' ? 'ice' : t.c === '*' ? 'gem' : t.c === 'T' ? 'tree' : t.c}"></i><span></span>`;
    b.querySelector('span').textContent = t.name;
    b.addEventListener('click', () => { tool = t.c; sfx(); syncTools(); });
    toolsEl.appendChild(b);
  });
  function syncTools() { toolsEl.querySelectorAll('.tool').forEach((b) => b.classList.toggle('on', b.dataset.c === tool)); }

  const worldEl = $('edWorld');
  WORLDS.forEach((w) => {
    const b = document.createElement('button');
    b.dataset.w = w.id;
    b.textContent = w.emoji;
    b.title = w.name;
    b.addEventListener('click', () => { worldId = w.id; sfx(); save(); syncWorld(); draw(); });
    worldEl.appendChild(b);
  });
  function syncWorld() {
    worldEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.w === worldId));
    document.documentElement.style.setProperty('--sky1', world().sky[0]);
    document.documentElement.style.setProperty('--sky2', world().sky[1]);
  }

  function resize(dw, dh) {
    const w = W() + dw, h = H() + dh;
    if (w < MAP_LIMITS.minW || w > MAP_LIMITS.maxW || h < MAP_LIMITS.minH || h > MAP_LIMITS.maxH) return;
    const g = Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => (grid[y] && grid[y][x] !== undefined ? grid[y][x] : '.')));
    grid = g;
    sfx(); save(); fit();
  }
  $('edWm').addEventListener('click', () => resize(-1, 0));
  $('edWp').addEventListener('click', () => resize(1, 0));
  $('edHm').addEventListener('click', () => resize(0, -1));
  $('edHp').addEventListener('click', () => resize(0, 1));
  $('edClear').addEventListener('click', () => {
    if (!confirm('¿Empezar un mapa nuevo? Se borrará el actual.')) return;
    grid = blank(W(), H()); verified = ''; save(); fit();
  });
  $('edTest').addEventListener('click', () => {
    const errs = validateMap(rows());
    if (errs.length) { toast(errs[0]); return; }
    sfx();
    onTest(rows(), worldId);
  });
  $('edPublish').addEventListener('click', () => { sfx(); onPublish(rows(), worldId); });
  $('edBack').addEventListener('click', () => { sfx(); onBack(); });
  window.addEventListener('resize', () => { if (document.getElementById('editor').classList.contains('open')) fit(); });

  return {
    open() { syncTools(); syncWorld(); requestAnimationFrame(fit); },
    markVerified(r, w) { if (w + '|' + r.join('/') === key()) { verified = key(); save(); } },
    reset() { grid = blank(9, 11); verified = ''; save(); },
  };
}
