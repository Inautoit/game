import { QUESTIONS, SONGS, INFOS, MEMORY, CHEERS } from './content.js';
import { initAudio, setMuted, state, Run, Cancelled, chime, sayNow } from './audio.js';
import { icon } from './icons.js';
import { VIDEOS } from './videos.js';

const feed = document.getElementById('feed');
const BREAK_AFTER_MIN = 15;

// ---------- Utilidades ----------
const $ = (html) => { const t = document.createElement('template'); t.innerHTML = html.trim(); return t.content.firstElementChild; };
const esc = (s) => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const store = {
  get(k, d) { try { const v = localStorage.getItem('mirato.' + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem('mirato.' + k, JSON.stringify(v)); } catch {} },
};

/** Bolsa barajada: no repite hasta haber salido todo. */
function bag(items) {
  let pool = [];
  return () => { if (!pool.length) pool = [...items].sort(() => Math.random() - 0.5); return pool.pop(); };
}
const next = { question: bag(QUESTIONS), song: bag(SONGS), info: bag(INFOS), memory: bag(MEMORY) };

// ---------- Racha de días ----------
function updateStreak() {
  const today = new Date().toDateString();
  const yest = new Date(Date.now() - 864e5).toDateString();
  let { last, days } = store.get('streak', { last: null, days: 0 });
  if (last !== today) { days = last === yest ? days + 1 : 1; last = today; store.set('streak', { last, days }); }
  return days;
}

// ---------- Piezas visuales ----------
export const LOGO = '<svg viewBox="0 0 512 512" aria-hidden="true"><rect width="512" height="512" rx="112" fill="#1f5fd6"/><circle cx="256" cy="262" r="150" fill="#fff"/><path d="M222 192 L328 262 L222 332 Z" fill="#1f5fd6" stroke="#1f5fd6" stroke-width="22" stroke-linejoin="round"/><path d="M398 92 l12 30 30 12 -30 12 -12 30 -12 -30 -30 -12 30 -12z" fill="#fff"/></svg>';
// Canal: [icono, nombre, presentador]. Cada canal tiene siempre la misma voz,
// y hay varias voces distintas repartidas entre canales.
const CHANNELS = {
  greeting: ['logo', 'Mi Rato', 0],
  'Refrán': ['quote', 'Refranes de siempre', 1], 'Adivinanza': ['bulb', 'Adivinanzas', 2],
  'Pregunta': ['question', 'Preguntas fáciles', 0], 'Cuentas': ['calc', 'Cuentas del mercado', 3],
  'Dilo en voz alta': ['speech', 'Juegos de palabras', 2],
  song: ['music', 'Canciones de siempre', 1],
  'Comida sana': ['bowl', 'Comer bien', 2], 'Salud': ['health', 'Salud y bienestar', 0],
  'Receta fácil': ['bowl', 'Cocina fácil', 3], 'Truco de cocina': ['bowl', 'Cocina fácil', 3],
  'Curiosidad': ['book', 'Curiosidades', 1],
  memory: ['eye', 'Memoria', 3], relax: ['wind', 'Respira tranquilo', 0],
};

/** Marco de reel: contenido + autor y texto abajo + botones a la derecha (como en las redes). */
function shell(kind, ch, caption, inner, topic) {
  const [ic, name] = ch;
  const av = ic === 'logo' ? LOGO : icon(ic);
  const v = VIDEOS[topic];
  const video = v ? `<video class="bgv" muted loop playsinline preload="none" poster="${v.poster}" aria-hidden="true">
      <source data-src="${v.webm}" type='video/webm; codecs="vp9"'><source data-src="${v.mov}"></video><div class="shade"></div>` : '';
  const credit = v ? `<p class="credit">Vídeo: ${esc(v.by)} · Wikimedia Commons · ${esc(v.lic)}</p>` : '';
  return $(`<section class="reel reel-${kind}${v ? ' has-video' : ''}">
    ${video}
    <div class="glow" aria-hidden="true"></div>
    <div class="body">${inner}</div>
    <div class="meta">
      <div class="author"><div class="avatar">${av}</div><b>${esc(name)}</b></div>
      <p class="caption">${caption}</p>
      ${credit}
    </div>
    <div class="actions">
      <button class="act like" data-act="like" aria-label="Me gusta"><span>${icon('heart')}</span><small>Me gusta</small></button>
      <button class="act" data-act="replay" aria-label="Otra vez"><span>${icon('replay')}</span><small>Otra vez</small></button>
      <button class="act" data-act="share" aria-label="Compartir"><span>${icon('share')}</span><small>Compartir</small></button>
    </div>
  </section>`);
}
const show = (el, sel) => el.querySelector(sel).classList.add('on');
const kicker = (ic, text) => `<p class="kicker step on">${icon(ic)}<span>${esc(text)}</span></p>`;

/** Cuenta atrás visual para pensar. */
async function thinkTime(run, el, seconds, text = 'Piénsalo y dilo en voz alta') {
  const box = el.querySelector('.think');
  box.innerHTML = `<div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="track"/><circle cx="50" cy="50" r="44" class="prog" style="animation-duration:${seconds}s"/></svg><b>${seconds}</b></div><p>${text}</p>`;
  box.classList.add('on');
  const num = box.querySelector('b');
  for (let s = seconds; s > 0; s--) { num.textContent = s; await run.wait(1000); }
  box.classList.remove('on');
}

const VINYL = `<div class="vinyl"><svg viewBox="0 0 200 200" aria-hidden="true">
  <circle cx="100" cy="100" r="96" fill="#111"/>
  ${[86, 76, 66, 56, 46].map(r => `<circle cx="100" cy="100" r="${r}" fill="none" stroke="#2a2a2a" stroke-width="1.2"/>`).join('')}
  <path d="M40 60 A80 80 0 0 1 100 20" fill="none" stroke="rgba(255,255,255,.18)" stroke-width="6" stroke-linecap="round"/>
  <circle cx="100" cy="100" r="30" fill="currentColor"/><circle cx="100" cy="100" r="4" fill="#111"/></svg></div>`;

// ---------- Tipos de reel ----------
const REELS = {
  greeting() {
    const name = store.get('name', '');
    const date = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const h = new Date().getHours();
    const hello = h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const days = updateStreak();
    const el = shell('greeting', CHANNELS.greeting, 'Tu rato de cada día', `
      ${kicker('sun', date)}
      <h1 class="big step">${hello}${name ? ',<br>' + esc(name) : ''}</h1>
      <p class="mid step">${days > 1 ? `Llevas <b>${days} días</b> seguidos` : 'Qué bien que estés aquí'}</p>
      <p class="small step hint">${icon('up')} Desliza hacia arriba o espera, pasa solo</p>`, 'sunrise');
    return { el, presenter: 0, async play(run) {
      const steps = el.querySelectorAll('.step');
      steps[1].classList.add('on'); await run.say(`${hello}${name ? ', ' + name : ''}.`);
      await run.say(`Hoy es ${date}.`);
      steps[2].classList.add('on'); await run.say(days > 1 ? `Llevas ${days} días seguidos. Muy bien.` : 'Vamos a pasar un buen rato.');
      steps[3].classList.add('on'); await run.wait(1500);
    } };
  },

  question() {
    const q = next.question();
    const ch = CHANNELS[q.cat];
    const el = shell('question', ch, 'Piénsalo y dilo en voz alta', `
      ${kicker(ch[0], q.cat)}
      <h2 class="q step on${q.q.length > 45 ? ' long' : ''}">${esc(q.q)}</h2>
      <div class="think"></div>
      <div class="answer step"><span>${esc(q.a)}</span></div>
      <p class="cheer step">${pick(CHEERS)}</p>`, q.v);
    return { el, presenter: ch[2], async play(run) {
      await run.say(q.q);
      await thinkTime(run, el, q.cat === 'Dilo en voz alta' ? 10 : 7);
      show(el, '.answer'); chime();
      await run.say((q.cat === 'Dilo en voz alta' ? 'Por ejemplo: ' : 'La respuesta es: ') + q.a);
      show(el, '.cheer'); await run.wait(2200);
    } };
  },

  song() {
    const s = next.song();
    const el = shell('song', CHANNELS.song, '¿La reconoces? Cántala', `
      ${kicker('music', 'Música')}
      <h2 class="q step on">¿Qué canción es?</h2>
      ${VINYL}
      <div class="think"></div>
      <div class="answer step"><span>${esc(s.title)}</span></div>
      <p class="cheer step">${esc(s.hint)}</p>`, s.v);
    const spin = (on) => el.querySelector('.vinyl').classList.toggle('on', on);
    return { el, presenter: CHANNELS.song[2], async play(run) {
      await run.say('Escucha bien. ¿Qué canción es?');
      spin(true); await run.melody(s); spin(false);
      await thinkTime(run, el, 6, '¿La reconoces? Dilo en voz alta');
      show(el, '.answer'); show(el, '.cheer'); chime();
      await run.say(`Es: ${s.title}. Vamos a cantarla.`);
      spin(true); await run.melody(s); spin(false);
      await run.wait(800);
    } };
  },

  info() {
    const it = next.info();
    const ch = CHANNELS[it.cat];
    const steps = it.cat === 'Receta fácil';
    const el = shell('info', ch, esc(it.title), `
      ${kicker(ch[0], it.cat)}
      <h2 class="q step on">${esc(it.title)}</h2>
      <ol class="facts${steps ? ' numbered' : ''}">${it.facts.map(([, t], i) => `<li class="step"><span>${steps ? i + 1 : ''}</span>${esc(t)}</li>`).join('')}</ol>`, it.v);
    return { el, presenter: ch[2], async play(run) {
      await run.say(it.title + '.');
      for (const [i, li] of [...el.querySelectorAll('.facts li')].entries()) {
        li.classList.add('on');
        await run.say(it.facts[i][1]);
        await run.wait(500);
      }
      await run.wait(1800);
    } };
  },

  memory() {
    const items = next.memory().map(([, w]) => w);
    const el = shell('memory', CHANNELS.memory, 'Mira bien y luego recuerda', `
      ${kicker('eye', 'Memoria')}
      <h2 class="q step on">Recuerda estas cuatro palabras</h2>
      <div class="grid">${items.map(w => `<div class="card"><span class="front">${esc(w)}</span><span class="back">?</span></div>`).join('')}</div>
      <div class="think"></div>
      <p class="cheer step">${pick(CHEERS)}</p>`, 'clouds sky');
    return { el, presenter: CHANNELS.memory[2], async play(run) {
      await run.say('Recuerda estas cuatro palabras: ' + items.join(', ') + '.');
      await run.wait(3500);
      el.querySelector('.grid').classList.add('hidden');
      el.querySelector('.q').textContent = '¿Cuáles eran?';
      await run.say('Las he tapado. ¿Cuáles eran?');
      await thinkTime(run, el, 9, 'Dilas en voz alta');
      el.querySelector('.grid').classList.remove('hidden'); chime();
      await run.say('Eran: ' + items.join(', ') + '.');
      show(el, '.cheer'); await run.wait(2000);
    } };
  },

  relax() {
    const el = shell('relax', CHANNELS.relax, 'Un momento para ti', `
      ${kicker('wind', 'Un respiro')}
      <h2 class="q step on">Respira conmigo</h2>
      <div class="breath"><div class="ball"></div><p class="bt">Toma aire…</p></div>`, pick(['ocean waves', 'forest stream']));
    return { el, presenter: CHANNELS.relax[2], async play(run) {
      run.pad([130.81, 196, 261.63, 329.63], 30);
      await run.say('Vamos a respirar despacio, tres veces.');
      const ball = el.querySelector('.ball'), bt = el.querySelector('.bt');
      for (let i = 0; i < 3; i++) {
        bt.textContent = 'Toma aire…'; ball.className = 'ball in'; await run.wait(4500);
        bt.textContent = 'Suelta el aire…'; ball.className = 'ball out'; await run.wait(5000);
      }
      bt.textContent = 'Muy bien';
      await run.say('Muy bien. Seguimos.');
      await run.wait(1000);
    } };
  },

  pause() {
    const el = shell('greeting', CHANNELS.greeting, 'Hora de moverse un poco', `
      ${kicker('glass', 'Descanso')}
      <h2 class="q step on">Llevas un buen rato</h2>
      <p class="mid step on">Has hecho muchos ejercicios. Buen momento para levantarse, beber un vaso de agua o dar un paseo.</p>
      <p class="small step on hint">${icon('up')} Si quieres seguir, desliza hacia arriba</p>`, 'walking park');
    return { el, presenter: 0, autoNext: false, async play(run) {
      await run.say('Llevas un buen rato. Has hecho muchos ejercicios.');
      await run.say('Buen momento para levantarte, beber un vaso de agua o dar un paseo. Mañana más.');
    } };
  },
};

// Orden del "feed": mezcla variada, como en los reels.
const PATTERN = ['question', 'song', 'info', 'question', 'memory', 'question', 'song', 'info', 'question', 'relax', 'question', 'info', 'song', 'memory'];
let patIdx = 0;

// ---------- Feed ----------
const reels = [];
let active = null, run = null, startTime = 0, breakShown = false;

function add(kind) {
  const r = REELS[kind]();
  r.kind = kind;
  r.el.dataset.i = reels.length;
  reels.push(r);
  feed.appendChild(r.el);
  io.observe(r.el);
}
function fill(n) {
  for (let i = 0; i < n; i++) {
    if (!breakShown && startTime && Date.now() - startTime > BREAK_AFTER_MIN * 60e3) { breakShown = true; add('pause'); continue; }
    add(PATTERN[patIdx++ % PATTERN.length]);
  }
}

const io = new IntersectionObserver((entries) => {
  for (const e of entries) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(reels[+e.target.dataset.i]);
}, { root: feed, threshold: [0.6] });

async function activate(r, force = false) {
  if (!started || (r === active && !force)) return;
  run?.cancel();
  active = r;
  reels.forEach(x => x.el.classList.toggle('active', x === r));
  const idx = reels.indexOf(r);
  if (idx > reels.length - 4) fill(5);
  const myRun = run = new Run(r.presenter || 0);
  resetReel(r);
  reels.forEach(x => { if (x !== r) x.el.querySelector('video.bgv')?.pause(); });
  playBg(r.el);
  if (reels[idx + 1]) loadBg(reels[idx + 1].el); // el siguiente ya va cargando
  try {
    await r.play(myRun);
    countToday();
    if (r.autoNext !== false) { await myRun.wait(1200); goTo(idx + 1); }
  } catch (err) { if (err !== Cancelled) console.error(err); }
}

/** Si vuelves a un reel anterior, se rehace desde el principio. */
function resetReel(r) {
  if (!r.html) { r.html = r.el.innerHTML; return; }
  r.el.innerHTML = r.html;
}

/** Vídeo de fondo: se carga solo cuando hace falta (ahorra datos). */
function loadBg(el) {
  const v = el.querySelector('video.bgv'); if (!v || v.dataset.loaded) return v;
  v.querySelectorAll('source').forEach(s => { s.src = s.dataset.src; });
  v.preload = 'auto'; v.dataset.loaded = '1'; v.load();
  v.addEventListener('error', () => el.classList.remove('has-video'), { once: true });
  return v;
}
function playBg(el) { const v = loadBg(el); v?.play().catch(() => {}); }

function goTo(i) { reels[i]?.el.scrollIntoView({ behavior: 'smooth' }); }

function countToday() {
  const today = new Date().toDateString();
  const s = store.get('today', { d: today, n: 0 });
  if (s.d !== today) { s.d = today; s.n = 0; }
  s.n++; store.set('today', s);
}

// ---------- Inicio ----------
let started = false;
const startEl = document.getElementById('start');
const nameEl = document.getElementById('name');
nameEl.value = store.get('name', '');
document.getElementById('go').addEventListener('click', () => {
  store.set('name', nameEl.value.trim());
  initAudio();
  started = true; startTime = Date.now();
  startEl.classList.add('gone');
  add('greeting'); fill(4);
  // Empezar YA, dentro del toque: así el móvil permite la voz desde la primera frase
  activate(reels[0]);
  if (document.documentElement.requestFullscreen && matchMedia('(pointer:coarse)').matches) {
    document.documentElement.requestFullscreen().catch(() => {});
  }
});

// Botones de la derecha (opcionales: la app funciona sin tocar nada)
feed.addEventListener('click', async (e) => {
  const b = e.target.closest('.act'); if (!b) return;
  const r = reels.find(x => x.el.contains(b));
  if (b.dataset.act === 'like') {
    const on = b.classList.toggle('on');
    if (on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); store.set('likes', store.get('likes', 0) + 1); }
  }
  if (b.dataset.act === 'replay' && r) { r.el.scrollIntoView({ behavior: 'smooth' }); activate(r, true); }
  if (b.dataset.act === 'share') {
    const data = { title: 'Mi Rato', text: 'Mira esta app para pasar un buen rato y ejercitar la mente.', url: location.href.split('#')[0] };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Enlace copiado'); } }
    catch { /* cancelado */ }
  }
});
function toast(msg) {
  const t = $(`<div class="toast">${esc(msg)}</div>`); document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

document.getElementById('test').addEventListener('click', () => {
  initAudio(); chime();
  const ok = sayNow('Hola. Si me oyes, todo está bien.');
  document.getElementById('testmsg').textContent = ok
    ? '¿No oyes nada? Sube el volumen y quita el modo silencio.'
    : 'Este navegador no puede hablar. Prueba con Chrome o Safari.';
});

const muteBtn = document.getElementById('mute');
muteBtn.innerHTML = icon('volume');
muteBtn.addEventListener('click', () => {
  setMuted(!state.muted);
  muteBtn.innerHTML = icon(state.muted ? 'mute' : 'volume');
  muteBtn.setAttribute('aria-label', state.muted ? 'Activar sonido' : 'Quitar sonido');
});

// Teclado (PC): flechas para pasar de reel
addEventListener('keydown', (e) => {
  if (!started || !active) return;
  const i = reels.indexOf(active);
  if (e.key === 'ArrowDown' || e.key === ' ') { e.preventDefault(); goTo(i + 1); }
  if (e.key === 'ArrowUp') { e.preventDefault(); goTo(i - 1); }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  navigator.serviceWorker.register('./sw.js').catch(() => {});
}
