import { QUESTIONS, SONGS, INFOS, MEMORY, CHEERS } from './content.js';
import { initAudio, setMuted, state, Run, Cancelled, chime } from './audio.js';

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
const CHANNELS = {
  'Refrán': ['📜', 'Refranes de siempre'], 'Adivinanza': ['🤔', 'Adivinanzas'], 'Pregunta': ['❓', 'Preguntas fáciles'],
  'Cuentas': ['🧮', 'Cuentas del mercado'], 'Dilo en voz alta': ['🗣️', 'Juegos de palabras'],
  'Comida sana': ['🥗', 'Comer bien'], 'Salud': ['💙', 'Salud y bienestar'], 'Receta fácil': ['🍳', 'Cocina fácil'],
  'Truco de cocina': ['🍳', 'Cocina fácil'], 'Curiosidad': ['💡', 'Curiosidades'],
};
/** Marco de reel: contenido + autor y texto abajo + botones a la derecha (como en las redes). */
function shell(kind, [avatar, name], caption, inner) {
  const av = avatar === 'logo' ? LOGO : `<span>${avatar}</span>`;
  return $(`<section class="reel reel-${kind}">
    <div class="floaties" aria-hidden="true"></div>
    <div class="body">${inner}</div>
    <div class="meta">
      <div class="author"><div class="avatar">${av}</div><b>${esc(name)}</b></div>
      <p class="caption">${caption}</p>
    </div>
    <div class="actions">
      <button class="act like" data-act="like" aria-label="Me gusta"><span>🤍</span><small>Me gusta</small></button>
      <button class="act" data-act="replay" aria-label="Otra vez"><span>🔁</span><small>Otra vez</small></button>
      <button class="act" data-act="share" aria-label="Compartir"><span>📤</span><small>Compartir</small></button>
    </div>
  </section>`);
}
function floaties(el, emojis) {
  const box = el.querySelector('.floaties');
  for (let i = 0; i < 9; i++) {
    const s = document.createElement('span');
    s.textContent = emojis[i % emojis.length];
    s.style.left = (5 + Math.random() * 85) + '%';
    s.style.animationDelay = (-Math.random() * 14) + 's';
    s.style.animationDuration = (11 + Math.random() * 8) + 's';
    s.style.fontSize = (28 + Math.random() * 30) + 'px';
    box.appendChild(s);
  }
}
const show = (el, sel) => el.querySelector(sel).classList.add('on');

/** Cuenta atrás visual: "Piénsalo… ¡dilo en voz alta!" */
async function thinkTime(run, el, seconds, text = 'Piénsalo… ¡dilo en voz alta!') {
  const box = el.querySelector('.think');
  box.innerHTML = `<div class="ring"><svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="44" class="track"/><circle cx="50" cy="50" r="44" class="prog" style="animation-duration:${seconds}s"/></svg><b>${seconds}</b></div><p>🤔 ${text}</p>`;
  box.classList.add('on');
  const num = box.querySelector('b');
  for (let s = seconds; s > 0; s--) { num.textContent = s; await run.wait(1000); }
  box.classList.remove('on');
}

// ---------- Tipos de reel ----------
const REELS = {
  greeting() {
    const name = store.get('name', '');
    const date = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    const h = new Date().getHours();
    const hello = h < 13 ? 'Buenos días' : h < 20 ? 'Buenas tardes' : 'Buenas noches';
    const days = updateStreak();
    const el = shell('greeting', ['logo', 'Mi Rato'], 'Tu rato de cada día ☀️', `
      <h1 class="big step">${hello}${name ? ', ' + esc(name) : ''}</h1>
      <p class="mid step">Hoy es <b>${date}</b></p>
      ${days > 1 ? `<p class="mid step">🔥 Llevas <b>${days} días</b> seguidos</p>` : '<p class="mid step">🌼 ¡Qué bien que estés aquí!</p>'}
      <p class="small step hint">Desliza hacia arriba o espera, que pasa solo ⬆️</p>`);
    floaties(el, ['☀️', '🌼', '🌻', '☕']);
    return { el, async play(run) {
      const steps = el.querySelectorAll('.step');
      steps[0].classList.add('on'); await run.say(`${hello}${name ? ', ' + name : ''}.`);
      steps[1].classList.add('on'); await run.say(`Hoy es ${date}.`);
      steps[2].classList.add('on'); await run.say(days > 1 ? `Llevas ${days} días seguidos. ¡Muy bien!` : 'Vamos a pasar un buen rato.');
      steps[3].classList.add('on'); await run.wait(1500);
    } };
  },

  question() {
    const q = next.question();
    const el = shell('question', CHANNELS[q.cat], '¿Te lo sabes? Dilo en voz alta 🗣️', `
      <h2 class="q step on${q.q.length > 45 ? ' long' : ''}">${esc(q.q)}</h2>
      <div class="think"></div>
      <div class="answer step">${q.ae ? `<span class="ae">${q.ae}</span>` : ''}<span>${esc(q.a)}</span></div>
      <p class="cheer step">${pick(CHEERS)}</p>`);
    floaties(el, [q.icon, '✨', '💭']);
    return { el, async play(run) {
      await run.say(q.q);
      await thinkTime(run, el, q.cat === 'Dilo en voz alta' ? 10 : 7);
      show(el, '.answer'); chime();
      await run.say((q.cat === 'Dilo en voz alta' ? 'Por ejemplo: ' : 'La respuesta es: ') + q.a);
      show(el, '.cheer'); await run.wait(2200);
    } };
  },

  song() {
    const s = next.song();
    const bars = Array.from({ length: 12 }, () => '<i></i>').join('');
    const el = shell('song', ['🎵', 'Canciones de siempre'], '¿La reconoces? 🎶 ¡Cántala!', `
      <h2 class="q step on">¿Qué canción es?</h2>
      <div class="eq">${bars}</div>
      <div class="think"></div>
      <div class="answer step"><span class="ae">${s.icon}</span><span>${esc(s.title)}</span></div>
      <p class="cheer step">${esc(s.hint)}</p>`);
    floaties(el, ['🎵', '🎶', '🎼', s.icon]);
    const bump = (i) => {
      const eq = el.querySelectorAll('.eq i');
      eq.forEach(b => { b.style.height = (20 + Math.random() * 80) + '%'; });
      eq[i % eq.length].style.height = '100%';
    };
    return { el, async play(run) {
      await run.say('Escucha bien. ¿Qué canción es?');
      el.querySelector('.eq').classList.add('on');
      await run.melody(s, bump);
      await thinkTime(run, el, 6, '¿La reconoces? ¡Dilo en voz alta!');
      show(el, '.answer'); show(el, '.cheer'); chime();
      await run.say(`Es: ${s.title}. ¡Vamos a cantarla!`);
      await run.melody(s, bump);
      await run.wait(800);
    } };
  },

  info() {
    const it = next.info();
    const el = shell('info', CHANNELS[it.cat], `${it.icon} ${esc(it.title)}`, `
      <div class="hero step on">${it.icon}</div>
      <h2 class="q step on">${esc(it.title)}</h2>
      <ul class="facts">${it.facts.map(([e, t]) => `<li class="step"><span>${e}</span>${esc(t)}</li>`).join('')}</ul>`);
    floaties(el, [it.icon, ...it.facts.map(f => f[0])]);
    return { el, async play(run) {
      await run.say(it.title + '.');
      for (const li of el.querySelectorAll('.facts li')) {
        li.classList.add('on');
        await run.say(li.textContent.slice(li.firstChild.textContent.length));
        await run.wait(500);
      }
      await run.wait(1800);
    } };
  },

  memory() {
    const items = next.memory();
    const el = shell('memory', ['🧠', 'Memoria'], 'Mira bien y luego recuerda 👀', `
      <h2 class="q step on">Mira bien estas cuatro cosas</h2>
      <div class="grid">${items.map(([e]) => `<div class="card"><span class="front">${e}</span><span class="back">❔</span></div>`).join('')}</div>
      <div class="think"></div>
      <div class="answer step words"><span>${items.map(([, w]) => w).join(' · ')}</span></div>
      <p class="cheer step">${pick(CHEERS)}</p>`);
    floaties(el, ['🧠', '✨', '👀']);
    return { el, async play(run) {
      await run.say('Mira bien estas cuatro cosas. Intenta recordarlas.');
      await run.wait(5000);
      el.querySelector('.grid').classList.add('hidden');
      el.querySelector('.q').textContent = '¿Cuáles eran?';
      await run.say('Las he tapado. ¿Cuáles eran?');
      await thinkTime(run, el, 9, 'Dilas en voz alta');
      el.querySelector('.grid').classList.remove('hidden');
      show(el, '.answer'); chime();
      await run.say('Eran: ' + items.map(i => i[1]).join(', ') + '.');
      show(el, '.cheer'); await run.wait(2000);
    } };
  },

  relax() {
    const el = shell('relax', ['🌿', 'Respira tranquilo'], 'Un momento para ti 🍃', `
      <h2 class="q step on">Respira conmigo</h2>
      <div class="breath"><div class="ball"></div><p class="bt">Toma aire…</p></div>`);
    floaties(el, ['🍃', '🌿', '☁️']);
    return { el, async play(run) {
      run.pad([130.81, 196, 261.63, 329.63], 30);
      await run.say('Vamos a respirar despacio, tres veces.');
      const ball = el.querySelector('.ball'), bt = el.querySelector('.bt');
      for (let i = 0; i < 3; i++) {
        bt.textContent = 'Toma aire…'; ball.className = 'ball in'; await run.wait(4500);
        bt.textContent = 'Suelta el aire…'; ball.className = 'ball out'; await run.wait(5000);
      }
      bt.textContent = '¡Muy bien! 😊';
      await run.say('Muy bien. Seguimos.');
      await run.wait(1000);
    } };
  },

  pause() {
    const el = shell('greeting', ['logo', 'Mi Rato'], 'Hora de moverse un poco 🚶‍♀️', `
      <div class="hero step on">🚶‍♀️</div>
      <h2 class="q step on">¡Llevas un buen rato!</h2>
      <p class="mid step on">Has hecho un montón de ejercicios. ¿Qué tal si te levantas, bebes un vaso de agua o das un paseo?</p>
      <p class="small step on hint">Si quieres seguir, desliza hacia arriba ⬆️</p>`);
    floaties(el, ['💧', '🌳', '☀️']);
    return { el, autoNext: false, async play(run) {
      await run.say('¡Llevas un buen rato! Has hecho un montón de ejercicios.');
      await run.say('¿Qué tal si te levantas, bebes un vaso de agua o das un paseo? Mañana más.');
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
  const myRun = run = new Run();
  resetReel(r);
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
  setTimeout(() => activate(reels[0]), 300);
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
    b.querySelector('span').textContent = on ? '❤️' : '🤍';
    if (on) { b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop'); store.set('likes', store.get('likes', 0) + 1); }
  }
  if (b.dataset.act === 'replay' && r) { r.el.scrollIntoView({ behavior: 'smooth' }); activate(r, true); }
  if (b.dataset.act === 'share') {
    const data = { title: 'Mi Rato', text: '¡Mira esta app para pasar un buen rato y ejercitar la mente! 🧠🎵', url: location.href.split('#')[0] };
    try { if (navigator.share) await navigator.share(data); else { await navigator.clipboard.writeText(data.url); toast('Enlace copiado 👍'); } }
    catch { /* cancelado */ }
  }
});
function toast(msg) {
  const t = $(`<div class="toast">${esc(msg)}</div>`); document.body.appendChild(t);
  setTimeout(() => t.remove(), 2200);
}

const muteBtn = document.getElementById('mute');
muteBtn.addEventListener('click', () => {
  setMuted(!state.muted);
  muteBtn.textContent = state.muted ? '🔇' : '🔊';
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
