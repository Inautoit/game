import { FilesetResolver, HandLandmarker } from '../vendor/mediapipe/vision_bundle.mjs';
import { extractFeatures } from './features.js';
import { SignClassifier } from './classifier.js';
import { recognize, MOTION_VARIANTS, AUTO_LABELS } from './rules.js';
import {
  LETTERS as LETTER_DATA, NUMBERS as NUMBER_DATA, COMMANDS as COMMAND_DATA,
  CATEGORIES, GRAMMAR, PHRASES,
} from './lse-data.js';

// ---------------------------------------------------------------------------
// Datos fijos
// ---------------------------------------------------------------------------

const LETTERS = LETTER_DATA.map((x) => x.g);
const NUMBERS = NUMBER_DATA.map((x) => x.g);
const COMMANDS = COMMAND_DATA.map((x) => x.g);

/** Glosa → { g, t, h } con la descripción de la guía. */
const INFO = new Map();
for (const x of [...LETTER_DATA, ...NUMBER_DATA, ...COMMAND_DATA, ...CATEGORIES.flatMap((c) => c.items)]) {
  INFO.set(x.g, x);
}

const TRAIN_GROUPS = [
  { id: 'letras', title: 'Abecedario', labels: LETTERS },
  { id: 'numeros', title: 'Números', labels: NUMBERS },
  ...CATEGORIES.map((c) => ({ id: c.id, title: c.title, labels: c.items.map((i) => i.g) })),
  { id: 'comandos', title: 'Comandos de Signa', labels: COMMANDS },
  { id: 'mias', title: 'Mis palabras', labels: null },
];
const KNOWN = new Set(TRAIN_GROUPS.flatMap((g) => g.labels || []));

// Exigencia: confianza mínima del voto y distancia máxima al ejemplo más cercano.
const STRICTNESS = {
  1: { conf: 0.45, dist: 0.45, name: 'muy baja' },
  2: { conf: 0.5, dist: 0.38, name: 'baja' },
  3: { conf: 0.6, dist: 0.32, name: 'media' },
  4: { conf: 0.7, dist: 0.26, name: 'alta' },
  5: { conf: 0.8, dist: 0.2, name: 'muy alta' },
};

const SMOOTH_FRAMES = 8;     // fotogramas para suavizar la predicción
const SMOOTH_MIN = 5;        // votos mínimos dentro de esa ventana
const HAND_GONE_MS = 250;    // sin mano este tiempo = puedes repetir la misma letra
const AUTO_SPACE_MS = 1200;  // sin mano este tiempo = espacio automático
const MOTION_WINDOW_MS = 700;
const MOTION_MIN = 1.2;      // recorrido mínimo (en largos de palma) para CH, LL, Ñ, RR, J
const RECORD_MS = 3000;
const CAPTURE_EVERY_MS = 60;
const SETTINGS_KEY = 'signa.settings.v1';
const WORDS_KEY = 'signa.words.v1';

// ---------------------------------------------------------------------------
// Elementos
// ---------------------------------------------------------------------------

const $ = (id) => document.getElementById(id);
const video = $('video');
const canvas = $('overlay');
const ctx = canvas.getContext('2d');
const ringFg = $('ring-fg');
const RING_LEN = 2 * Math.PI * 52;

// ---------------------------------------------------------------------------
// Estado
// ---------------------------------------------------------------------------

const classifier = new SignClassifier();
classifier.restore();

const settings = loadJSON(SETTINGS_KEY, {
  hold: 700,
  strict: 3,
  auto: true,
  spell: 'letters',
  autospace: true,
  voice: false,
  mirror: false,
});
let customWords = loadWords();

let landmarker = null;
let mode = 'translate';
let selectedLabel = 'A';
let trainGroup = 'letras';
const motionBuf = [];
let motionLock = null;
let lastVideoTime = -1;
let fps = { frames: 0, since: performance.now() };

const history = [];          // predicciones recientes (o null)
let current = { label: null, since: 0 };
let lastCommitted = null;
let lastHandAt = 0;
let autoSpaced = true;

/** Cada entrada es el trozo de texto que añadió un signo, para poder deshacer. */
const entries = [];
let lastEntryAt = 0;

const recording = { active: false, phase: 'idle', label: null, count: 0, lastCapture: 0 };

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}

function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* almacenamiento bloqueado: seguimos sin guardar */
  }
}

function loadWords() {
  try {
    const list = JSON.parse(localStorage.getItem(WORDS_KEY) || '[]');
    return Array.isArray(list) ? list.filter((w) => typeof w === 'string') : [];
  } catch {
    return [];
  }
}

let toastTimer = 0;
function toast(msg) {
  const el = $('toast');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 2600);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setStatus(text, kind = '') {
  $('status-text').textContent = text;
  $('status').className = `status ${kind}`;
}

function isWord(label) {
  return !LETTERS.includes(label) && !NUMBERS.includes(label);
}

/** Palabras propias: las añadidas a mano y las que vengan en un archivo importado. */
function customLabels() {
  const set = new Set(customWords);
  for (const s of classifier.samples) if (!KNOWN.has(s.label)) set.add(s.label);
  return [...set];
}

function groupLabels(id) {
  const g = TRAIN_GROUPS.find((x) => x.id === id);
  return g?.labels ?? customLabels();
}

function kindOf(label) {
  if (NUMBERS.includes(label)) return `Número ${label}`;
  if (LETTERS.includes(label)) return `Letra ${label}`;
  return 'Palabra';
}

// Movimiento de la mano en los últimos instantes, medido en largos de palma.
function trackMotion(hands, aspect, now) {
  if (!hands.length) {
    motionBuf.length = 0;
    return;
  }
  const lm = hands[0];
  const size = Math.hypot((lm[9].x - lm[0].x) * aspect, lm[9].y - lm[0].y) || 1e-6;
  motionBuf.push({ t: now, x: lm[5].x * aspect, y: lm[5].y, size });
  while (motionBuf.length && now - motionBuf[0].t > MOTION_WINDOW_MS) motionBuf.shift();
}

function movement() {
  if (motionBuf.length < 3) return 0;
  let path = 0;
  let size = 0;
  for (let i = 1; i < motionBuf.length; i++) {
    path += Math.hypot(motionBuf[i].x - motionBuf[i - 1].x, motionBuf[i].y - motionBuf[i - 1].y);
    size += motionBuf[i].size;
  }
  return path / (size / (motionBuf.length - 1));
}

// ---------------------------------------------------------------------------
// Cámara y modelo
// ---------------------------------------------------------------------------

async function createLandmarker() {
  const base = new URL('../vendor/mediapipe/', import.meta.url);
  const fileset = await FilesetResolver.forVisionTasks(new URL('wasm', base).href);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: new URL('hand_landmarker.task', base).href, delegate },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.6,
    minHandPresenceConfidence: 0.6,
    minTrackingConfidence: 0.5,
  });
  try {
    return await HandLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    return await HandLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

async function startCamera() {
  if (!window.isSecureContext) {
    throw new Error('La cámara solo funciona si abres la página con https:// o desde localhost.');
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador no permite usar la cámara. Prueba con Chrome, Edge o Safari actualizados.');
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false,
    });
    video.srcObject = stream;
    await video.play();
  } catch (err) {
    if (err.name === 'NotAllowedError') {
      throw new Error('Has bloqueado la cámara. Permítela desde el icono junto a la dirección web y vuelve a pulsar.');
    }
    if (err.name === 'NotFoundError' || err.name === 'OverconstrainedError') {
      throw new Error('No encuentro ninguna cámara conectada.');
    }
    if (err.name === 'NotReadableError') {
      throw new Error('La cámara está ocupada por otra aplicación (Teams, Zoom…). Ciérrala y vuelve a pulsar.');
    }
    throw err;
  }
}

$('btn-start').addEventListener('click', async () => {
  const btn = $('btn-start');
  const errEl = $('start-error');
  btn.disabled = true;
  errEl.hidden = true;
  setStatus('Cargando detector de manos…', 'busy');
  try {
    const [lm] = await Promise.all([landmarker ?? createLandmarker(), startCamera()]);
    landmarker = lm;
    $('start').hidden = true;
    setStatus('En directo', 'live');
    requestAnimationFrame(loop);
  } catch (err) {
    errEl.textContent = err.message || 'No se pudo iniciar. Recarga la página e inténtalo otra vez.';
    errEl.hidden = false;
    btn.disabled = false;
    setStatus('Sin cámara', 'error');
  }
});

// ---------------------------------------------------------------------------
// Bucle principal
// ---------------------------------------------------------------------------

function loop() {
  requestAnimationFrame(loop);
  if (!landmarker || video.readyState < 2 || video.currentTime === lastVideoTime) return;
  lastVideoTime = video.currentTime;

  const now = performance.now();
  const result = landmarker.detectForVideo(video, now);
  const hands = result.landmarks || [];
  const worlds = result.worldLandmarks || [];
  const aspect = video.videoWidth / video.videoHeight || 16 / 9;

  // FPS
  fps.frames++;
  if (now - fps.since >= 500) {
    $('hud-fps').textContent = Math.round((fps.frames * 1000) / (now - fps.since));
    fps = { frames: 0, since: now };
  }
  $('hud-hands').textContent = hands.length;

  const feat = extractFeatures(hands, aspect, settings.mirror);
  if (feat) lastHandAt = now;

  // Grabación de ejemplos
  if (recording.phase === 'capture' && feat && now - recording.lastCapture >= CAPTURE_EVERY_MS) {
    classifier.add(recording.label, feat);
    recording.count++;
    recording.lastCapture = now;
    $('rec-text').textContent = `Grabando ${recording.label} · ${recording.count}`;
  }

  trackMotion(hands, aspect, now);

  // Primero tus ejemplos; si no encajan, las reglas automáticas de la guía.
  let pred = recording.active ? null : classifier.predict(feat);
  const th = STRICTNESS[settings.strict];
  const knnOk = pred && pred.confidence >= th.conf && pred.distance <= th.dist;
  if (!recording.active && !knnOk && settings.auto && hands.length) {
    const rule = recognize(hands, worlds, aspect, settings.spell);
    if (rule) pred = { label: rule, confidence: 1, distance: 0, ranking: [{ label: rule, share: 1 }], auto: true };
  }
  const stable = smooth(pred);
  draw(hands, stable);
  updateReadout(feat, pred, stable, now);
}

/** Devuelve la etiqueta aceptada si se repite en la mayoría de los últimos fotogramas. */
function smooth(pred) {
  const th = STRICTNESS[settings.strict];
  const ok = pred && pred.confidence >= th.conf && pred.distance <= th.dist;
  history.push(ok ? pred.label : null);
  if (history.length > SMOOTH_FRAMES) history.shift();
  const counts = new Map();
  for (const l of history) if (l) counts.set(l, (counts.get(l) || 0) + 1);
  let best = null;
  let bestN = 0;
  for (const [l, n] of counts) if (n > bestN) [best, bestN] = [l, n];
  return bestN >= SMOOTH_MIN ? best : null;
}

function updateReadout(feat, pred, stable, now) {
  const glyph = $('glyph');
  const label = $('readout-label');

  if (stable !== current.label) current = { label: stable, since: now };

  // Sin mano: permite repetir letra y, si dura, añade espacio.
  if (!feat && now - lastHandAt >= HAND_GONE_MS) lastCommitted = null;
  if (feat) autoSpaced = false;
  if (
    mode === 'translate' && settings.autospace && !feat && !autoSpaced &&
    now - lastHandAt >= AUTO_SPACE_MS
  ) {
    autoSpaced = true;
    addSpace();
  }

  // Letras con movimiento (CH, LL, Ñ, RR, J): forma estática + desplazamiento.
  if (!feat || (stable && stable !== motionLock)) motionLock = null;
  if (
    mode === 'translate' && stable && MOTION_VARIANTS[stable] && settings.spell === 'letters' &&
    motionLock !== stable && movement() >= MOTION_MIN
  ) {
    const variant = MOTION_VARIANTS[stable];
    if (entries[entries.length - 1] === stable && now - lastEntryAt < 2500) {
      entries[entries.length - 1] = variant;
      lastEntryAt = now;
      renderTranscript();
    } else {
      push(variant);
    }
    lastCommitted = stable;
    motionLock = stable;
  }
  const display = stable && motionLock === stable ? MOTION_VARIANTS[stable] : stable;

  // Texto del lector
  let shown = '·';
  if (!feat) {
    label.textContent = 'Sin mano';
  } else if (recording.active) {
    label.textContent = 'Grabando ejemplos…';
  } else if (!stable) {
    label.textContent = pred || classifier.samples.length || settings.auto ? 'No lo reconozco' : 'Mano detectada';
    shown = '?';
  } else {
    label.textContent = `${kindOf(display)}${pred?.auto ? ' · automático' : ''}`;
    shown = display;
  }
  if (glyph.textContent !== shown) {
    glyph.textContent = shown;
    glyph.classList.toggle('long', shown.length > 3);
    $('readout-help').textContent = display ? INFO.get(display)?.h ?? '' : '';
  }
  renderRanking(pred);

  // Progreso y aceptación del signo
  let progress = 0;
  let done = false;
  if (stable && mode === 'translate') {
    if (stable === lastCommitted) {
      progress = 1;
      done = true;
    } else {
      progress = Math.min(1, (now - current.since) / settings.hold);
      if (progress >= 1) {
        commit(stable);
        lastCommitted = stable;
        done = true;
      }
    }
  }
  ringFg.style.strokeDashoffset = String(RING_LEN * (1 - progress));
  ringFg.classList.toggle('done', done);
}

let lastRankingKey = '';
function renderRanking(pred) {
  const top = pred ? pred.ranking.slice(0, 3) : [];
  const key = top.map((r) => `${r.label}:${Math.round(r.share * 20)}`).join('|');
  if (key === lastRankingKey) return;
  lastRankingKey = key;
  const ol = $('ranking');
  ol.replaceChildren(
    ...top.map((r) => {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.className = 'name';
      name.textContent = r.label;
      const bar = document.createElement('span');
      bar.className = 'bar';
      const fill = document.createElement('i');
      fill.style.width = `${Math.round(r.share * 100)}%`;
      bar.append(fill);
      const pct = document.createElement('span');
      pct.className = 'pct';
      pct.textContent = `${Math.round(r.share * 100)}%`;
      li.append(name, bar, pct);
      return li;
    }),
  );
}

// ---------------------------------------------------------------------------
// Dibujo de las manos
// ---------------------------------------------------------------------------

const TIPS = new Set([4, 8, 12, 16, 20]);

function draw(hands, stableLabel) {
  const W = video.videoWidth;
  const H = video.videoHeight;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W;
    canvas.height = H;
  }
  ctx.clearRect(0, 0, W, H);
  const unit = W / 640;
  const X = (p) => (1 - p.x) * W; // el vídeo se ve en espejo
  const Y = (p) => p.y * H;

  hands.forEach((lm, i) => {
    const color = i === 0 ? '#6ae4ff' : '#ffb547';

    // Huesos
    ctx.save();
    ctx.strokeStyle = color;
    ctx.lineWidth = 2.5 * unit;
    ctx.lineCap = 'round';
    ctx.shadowColor = color;
    ctx.shadowBlur = 14 * unit;
    ctx.beginPath();
    for (const { start, end } of HandLandmarker.HAND_CONNECTIONS) {
      ctx.moveTo(X(lm[start]), Y(lm[start]));
      ctx.lineTo(X(lm[end]), Y(lm[end]));
    }
    ctx.stroke();

    // Articulaciones
    lm.forEach((p, idx) => {
      const r = (TIPS.has(idx) ? 5 : 3) * unit;
      ctx.fillStyle = TIPS.has(idx) ? '#ffffff' : color;
      ctx.beginPath();
      ctx.arc(X(p), Y(p), r, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();

    // Recuadro con esquinas
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const p of lm) {
      minX = Math.min(minX, X(p)); maxX = Math.max(maxX, X(p));
      minY = Math.min(minY, Y(p)); maxY = Math.max(maxY, Y(p));
    }
    const pad = 16 * unit;
    minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    const c = 14 * unit;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.globalAlpha = 0.85;
    ctx.lineWidth = 2 * unit;
    ctx.beginPath();
    ctx.moveTo(minX, minY + c); ctx.lineTo(minX, minY); ctx.lineTo(minX + c, minY);
    ctx.moveTo(maxX - c, minY); ctx.lineTo(maxX, minY); ctx.lineTo(maxX, minY + c);
    ctx.moveTo(maxX, maxY - c); ctx.lineTo(maxX, maxY); ctx.lineTo(maxX - c, maxY);
    ctx.moveTo(minX + c, maxY); ctx.lineTo(minX, maxY); ctx.lineTo(minX, maxY - c);
    ctx.stroke();

    // Etiqueta del signo sobre la primera mano
    if (i === 0 && stableLabel) {
      const size = 22 * unit;
      ctx.font = `700 ${size}px "Chakra Petch", system-ui, sans-serif`;
      const text = stableLabel;
      const tw = ctx.measureText(text).width;
      const bx = minX;
      const by = Math.max(0, minY - size - 14 * unit);
      ctx.globalAlpha = 1;
      ctx.fillStyle = 'rgba(6, 9, 18, 0.85)';
      ctx.fillRect(bx, by, tw + 20 * unit, size + 10 * unit);
      ctx.strokeRect(bx, by, tw + 20 * unit, size + 10 * unit);
      ctx.fillStyle = color;
      ctx.textBaseline = 'top';
      ctx.fillText(text, bx + 10 * unit, by + 6 * unit);
    }
    ctx.restore();
  });
}

// ---------------------------------------------------------------------------
// Texto
// ---------------------------------------------------------------------------

const textValue = () => entries.join('');

function push(piece) {
  entries.push(piece);
  lastEntryAt = performance.now();
  renderTranscript();
}

function lastWord() {
  const words = textValue().trim().split(/\s+/);
  return words[words.length - 1] || '';
}

function addSpace() {
  const t = textValue();
  if (!t || t.endsWith(' ')) return;
  const word = lastWord();
  push(' ');
  if (settings.voice) speak(word);
}

function commit(label) {
  if (label === 'ESPACIO') return addSpace();
  if (label === 'BORRAR') return undo();
  if (isWord(label)) {
    const t = textValue();
    const lead = t && !t.endsWith(' ') ? ' ' : '';
    push(`${lead}${label} `);
    if (settings.voice) speak(label);
    return;
  }
  push(label);
}

function undo() {
  entries.pop();
  renderTranscript();
}

function renderTranscript() {
  const el = $('transcript');
  const fresh = performance.now() - lastEntryAt < 1200 && entries.length > 0;
  const before = fresh ? entries.slice(0, -1).join('') : textValue();
  const nodes = [document.createTextNode(before)];
  if (fresh) {
    const span = document.createElement('span');
    span.className = 'new';
    span.textContent = entries[entries.length - 1];
    nodes.push(span);
    setTimeout(renderTranscript, 1250);
  }
  const caret = document.createElement('span');
  caret.className = 'caret';
  nodes.push(caret);
  el.replaceChildren(...nodes);
}

function speak(text) {
  if (!('speechSynthesis' in window) || !text.trim()) return;
  const u = new SpeechSynthesisUtterance(text.toLowerCase());
  u.lang = 'es-ES';
  const voice = speechSynthesis.getVoices().find((v) => v.lang?.toLowerCase().startsWith('es'));
  if (voice) u.voice = voice;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

$('btn-space').addEventListener('click', () => {
  if (textValue()) push(' ');
});
$('btn-undo').addEventListener('click', undo);
$('btn-clear').addEventListener('click', () => {
  entries.length = 0;
  renderTranscript();
});
$('btn-copy').addEventListener('click', async () => {
  const t = textValue().trim();
  if (!t) return toast('Todavía no hay texto que copiar.');
  try {
    await navigator.clipboard.writeText(t);
    toast('Texto copiado.');
  } catch {
    toast('No se pudo copiar. Selecciona el texto y usa Ctrl+C.');
  }
});
$('btn-speak').addEventListener('click', () => {
  const t = textValue().trim();
  if (!t) return toast('Todavía no hay texto que leer.');
  if (!('speechSynthesis' in window)) return toast('Este navegador no puede leer en voz alta.');
  speak(t);
});

// ---------------------------------------------------------------------------
// Modos
// ---------------------------------------------------------------------------

function setMode(next) {
  mode = next;
  for (const tab of document.querySelectorAll('.tab')) {
    tab.setAttribute('aria-selected', String(tab.dataset.mode === next));
  }
  $('panel-translate').hidden = next !== 'translate';
  $('panel-train').hidden = next !== 'train';
  $('panel-dict').hidden = next !== 'dict';
  if (next === 'dict') renderDict();
  // El signo que ya estás haciendo al cambiar de modo no se escribe de golpe.
  lastCommitted = current.label;
  refreshTrainUI();
}

for (const tab of document.querySelectorAll('.tab')) {
  tab.addEventListener('click', () => setMode(tab.dataset.mode));
}
for (const link of document.querySelectorAll('[data-goto]')) {
  link.addEventListener('click', () => setMode(link.dataset.goto));
}

// ---------------------------------------------------------------------------
// Entrenamiento
// ---------------------------------------------------------------------------

function chip(label, extraClass = '') {
  const b = document.createElement('button');
  b.type = 'button';
  const n = classifier.countFor(label);
  b.className = `chip ${extraClass} ${n > 0 ? 'trained' : ''}`.trim();
  b.setAttribute('aria-pressed', String(label === selectedLabel));
  if (AUTO_LABELS.has(label)) {
    const dot = document.createElement('span');
    dot.className = 'auto-dot';
    dot.title = 'Se reconoce sin entrenar';
    b.append(dot);
  }
  const name = document.createElement('span');
  name.className = isWord(label) ? 'word' : '';
  name.textContent = label;
  const count = document.createElement('small');
  count.textContent = n;
  b.append(name, count);
  b.addEventListener('click', () => {
    selectedLabel = label;
    refreshTrainUI();
  });
  return b;
}

function fillGroupSelect() {
  const sel = $('train-cat');
  sel.replaceChildren(
    ...TRAIN_GROUPS.map((g) => {
      const o = document.createElement('option');
      o.value = g.id;
      o.textContent = g.title;
      return o;
    }),
  );
  sel.addEventListener('change', () => {
    trainGroup = sel.value;
    const labels = groupLabels(trainGroup);
    if (!labels.includes(selectedLabel)) selectedLabel = labels[0] ?? selectedLabel;
    refreshTrainUI();
  });
}

function trainTip(label, n) {
  if (label === 'ESPACIO') return 'Un gesto que uses para separar palabras.';
  if (label === 'BORRAR') return 'Un gesto que uses para borrar lo último escrito.';
  if (AUTO_LABELS.has(label) && n === 0) return 'Ya se reconoce sin entrenar. Si grabas ejemplos tuyos, tendrán prioridad.';
  if (isWord(label) && n === 0) return 'Haz el signo completo durante la grabación. Signa aprende la forma de la mano.';
  if (n === 0) return 'Graba al menos 30 ejemplos, moviendo un poco la mano.';
  if (n < 30) return 'Graba otra tanda para que lo reconozca mejor.';
  return 'Bien entrenado. Otra tanda desde otro ángulo lo hará más robusto.';
}

function refreshTrainUI() {
  $('train-cat').value = trainGroup;
  const labels = groupLabels(trainGroup);
  const grid = $('grid-labels');
  grid.classList.toggle('words', labels.some(isWord));
  grid.replaceChildren(...labels.map((l) => chip(l, COMMANDS.includes(l) ? 'cmd' : '')));
  $('form-word').hidden = trainGroup !== 'mias';

  const n = classifier.countFor(selectedLabel);
  const g = $('train-glyph');
  g.textContent = selectedLabel;
  g.classList.toggle('long', selectedLabel.length > 3);
  $('train-count').textContent = n;
  $('train-tip').textContent = trainTip(selectedLabel, n);
  const info = INFO.get(selectedLabel);
  $('train-how').textContent = info ? `${info.t ? `${info.t}: ` : ''}${info.h}` : '';
  $('hud-samples').textContent = classifier.samples.length;
  $('empty-note').hidden = classifier.samples.some((s) => isWord(s.label));
}

// ---------------------------------------------------------------------------
// Diccionario
// ---------------------------------------------------------------------------

const fold = (t) => t.normalize('NFD').replace(/[\u0300-\u036f¿?¡!]/g, '').toLowerCase();

const DICT_SECTIONS = [
  { id: 'letras', title: 'Abecedario dactilológico', note: 'Con una sola mano, a la altura del hombro, palma hacia fuera.', items: LETTER_DATA },
  { id: 'numeros', title: 'Números', note: 'Del 1 al 5 con una mano; del 6 al 9 se combinan las dos (5 + lo que falte).', items: NUMBER_DATA },
  ...CATEGORIES,
];

function renderDict() {
  const q = fold($('dict-search').value.trim());
  const sections = [];
  for (const sec of DICT_SECTIONS) {
    const items = sec.items.filter((it) => !q || fold(`${it.t ?? it.g} ${it.h}`).includes(q));
    if (!items.length) continue;
    const wrap = document.createElement('section');
    wrap.className = 'dict-cat';
    const h = document.createElement('h2');
    h.className = 'group-title';
    h.textContent = sec.title;
    wrap.append(h);
    if (sec.note && !q) {
      const p = document.createElement('p');
      p.textContent = sec.note;
      wrap.append(p);
    }
    for (const it of items) wrap.append(dictItem(it, sec.id));
    sections.push(wrap);
  }
  if (!sections.length) {
    const p = document.createElement('p');
    p.className = 'dict-empty';
    p.textContent = 'No hay ningún signo con ese nombre en la guía.';
    sections.push(p);
  }
  $('dict-list').replaceChildren(...sections);
}

function dictItem(it, groupId) {
  const el = document.createElement('article');
  el.className = 'dict-item';
  const h = document.createElement('h3');
  h.textContent = it.t ?? it.g;
  const btn = document.createElement('button');
  btn.className = 'btn';
  btn.type = 'button';
  btn.textContent = 'Entrenar';
  btn.addEventListener('click', () => {
    trainGroup = groupId;
    selectedLabel = it.g;
    setMode('train');
    $('panel-train').scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const p = document.createElement('p');
  p.textContent = it.h;
  el.append(h, btn, p);

  const n = classifier.countFor(it.g);
  if (AUTO_LABELS.has(it.g) || n > 0) {
    const badges = document.createElement('div');
    badges.className = 'dict-badges';
    if (AUTO_LABELS.has(it.g)) badges.append(badge('Automático', 'auto'));
    if (n > 0) badges.append(badge(`Entrenado · ${n}`, 'trained'));
    el.append(badges);
  }
  return el;
}

function badge(text, cls) {
  const b = document.createElement('span');
  b.className = `badge ${cls}`;
  b.textContent = text;
  return b;
}

function renderGuide() {
  $('grammar').replaceChildren(
    ...GRAMMAR.map(([title, text]) => {
      const li = document.createElement('li');
      const b = document.createElement('b');
      b.textContent = `${title}. `;
      li.append(b, text);
      return li;
    }),
  );
  $('phrases').replaceChildren(
    ...PHRASES.flatMap(([es, lse]) => {
      const dt = document.createElement('dt');
      dt.textContent = es;
      const dd = document.createElement('dd');
      dd.textContent = lse;
      return [dt, dd];
    }),
  );
}

$('dict-search').addEventListener('input', renderDict);

async function record() {
  if (recording.active) return;
  if (!landmarker) return toast('Primero activa la cámara.');
  Object.assign(recording, { active: true, phase: 'countdown', label: selectedLabel, count: 0, lastCapture: 0 });
  $('btn-record').disabled = true;
  $('rec-banner').hidden = false;
  for (const n of [3, 2, 1]) {
    $('rec-text').textContent = `Prepara el signo ${recording.label} · ${n}`;
    await sleep(600);
  }
  recording.phase = 'capture';
  $('rec-text').textContent = `Grabando ${recording.label} · 0`;
  await sleep(RECORD_MS);
  recording.phase = 'idle';
  recording.active = false;
  $('rec-banner').hidden = true;
  $('btn-record').disabled = false;

  if (recording.count === 0) {
    toast('No vi ninguna mano. Ponla dentro del recuadro y repite.');
  } else {
    if (!classifier.save()) toast('Ejemplos añadidos, pero el navegador no deja guardarlos. Expórtalos para no perderlos.');
    else toast(`+${recording.count} ejemplos de ${recording.label}`);
  }
  refreshTrainUI();
}

$('btn-record').addEventListener('click', record);

function confirmTwice(btn, label, action) {
  if (btn.dataset.armed === '1') {
    btn.dataset.armed = '';
    btn.textContent = label;
    action();
    return;
  }
  btn.dataset.armed = '1';
  btn.textContent = 'Pulsa otra vez para confirmar';
  setTimeout(() => {
    btn.dataset.armed = '';
    btn.textContent = label;
  }, 3000);
}

$('btn-forget').addEventListener('click', (e) =>
  confirmTwice(e.currentTarget, 'Borrar este signo', () => {
    classifier.removeLabel(selectedLabel);
    if (customWords.includes(selectedLabel)) {
      customWords = customWords.filter((w) => w !== selectedLabel);
      saveJSON(WORDS_KEY, customWords);
      selectedLabel = groupLabels(trainGroup)[0] ?? 'A';
    }
    classifier.save();
    refreshTrainUI();
    toast('Signo borrado.');
  }),
);

$('btn-reset').addEventListener('click', (e) =>
  confirmTwice(e.currentTarget, 'Borrar todo', () => {
    classifier.clear();
    classifier.save();
    customWords = [];
    saveJSON(WORDS_KEY, customWords);
    trainGroup = 'letras';
    selectedLabel = 'A';
    refreshTrainUI();
    toast('Todos los ejemplos borrados.');
  }),
);

$('form-word').addEventListener('submit', (e) => {
  e.preventDefault();
  const input = $('input-word');
  const word = input.value.trim().toUpperCase().replace(/\s+/g, ' ');
  if (!word) return;
  if (!KNOWN.has(word) && !customLabels().includes(word)) {
    customWords.push(word);
    saveJSON(WORDS_KEY, customWords);
  }
  const home = TRAIN_GROUPS.find((g) => g.labels?.includes(word));
  trainGroup = home ? home.id : 'mias';
  selectedLabel = word;
  input.value = '';
  refreshTrainUI();
});

$('btn-export').addEventListener('click', () => {
  if (classifier.samples.length === 0) return toast('Todavía no hay ejemplos que exportar.');
  const data = { ...classifier.toJSON(), words: customWords };
  const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'signa-ejemplos.json';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('input-import').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const incoming = new SignClassifier();
    incoming.load(data);
    classifier.samples.push(...incoming.samples);
    if (Array.isArray(data.words)) {
      for (const w of data.words) if (typeof w === 'string' && !customWords.includes(w)) customWords.push(w);
      saveJSON(WORDS_KEY, customWords);
    }
    classifier.save();
    refreshTrainUI();
    toast(`Importados ${incoming.samples.length} ejemplos.`);
  } catch (err) {
    toast(err.message?.startsWith('El archivo') ? err.message : 'Ese archivo no es una copia de Signa.');
  }
});

// ---------------------------------------------------------------------------
// Ajustes
// ---------------------------------------------------------------------------

function bindSettings() {
  const hold = $('set-hold');
  const strict = $('set-strict');
  const showHold = () => ($('out-hold').textContent = `${(settings.hold / 1000).toFixed(1).replace('.', ',')} s`);
  const showStrict = () => ($('out-strict').textContent = STRICTNESS[settings.strict].name);

  hold.value = settings.hold;
  strict.value = settings.strict;
  showHold();
  showStrict();
  hold.addEventListener('input', () => {
    settings.hold = Number(hold.value);
    showHold();
    saveJSON(SETTINGS_KEY, settings);
  });
  strict.addEventListener('input', () => {
    settings.strict = Number(strict.value);
    showStrict();
    saveJSON(SETTINGS_KEY, settings);
  });
  const segs = document.querySelectorAll('.seg');
  const showSpell = () => {
    for (const b of segs) b.setAttribute('aria-checked', String(b.dataset.spell === settings.spell));
  };
  showSpell();
  for (const b of segs) {
    b.addEventListener('click', () => {
      settings.spell = b.dataset.spell;
      history.length = 0;
      showSpell();
      saveJSON(SETTINGS_KEY, settings);
    });
  }
  for (const key of ['auto', 'autospace', 'voice', 'mirror']) {
    const box = $(`set-${key}`);
    box.checked = settings[key];
    box.addEventListener('change', () => {
      settings[key] = box.checked;
      saveJSON(SETTINGS_KEY, settings);
    });
  }
}

// ---------------------------------------------------------------------------
// Teclado
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
  if (e.code !== 'Space' || e.repeat) return;
  const tag = document.activeElement?.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'BUTTON') return;
  e.preventDefault();
  if (mode === 'train') record();
  else if (mode === 'translate' && textValue()) push(' ');
});

// Las voces del navegador se cargan con retraso.
if ('speechSynthesis' in window) speechSynthesis.getVoices();

bindSettings();
fillGroupSelect();
renderGuide();
refreshTrainUI();
renderTranscript();
