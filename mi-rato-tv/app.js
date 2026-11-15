import { LISTA } from './lista.js';

// ---------- Lista de vídeos ----------
const idOf = (u) => (String(u).match(/(?:shorts\/|v=|youtu\.be\/|embed\/)([\w-]{11})/) || [])[1] || (/^[\w-]{11}$/.test(u) ? u : null);
// Lista fija elegida a mano (opcional) + Shorts nuevos de los canales oficiales (los trae Cloudflare)
const fijos = LISTA.map(x => (typeof x === 'string' ? { url: x } : x)).map(x => ({ ...x, id: idOf(x.url || x.id) })).filter(x => x.id);
let items = [];
async function cargar() {
  let nuevos = [];
  try { const r = await fetch('./lista.json', { cache: 'no-cache' }); if (r.ok) nuevos = (await r.json()).videos || []; } catch {}
  // Mete un vídeo fijo cada 4 de canales
  const out = []; let f = 0;
  nuevos.forEach((v, i) => { out.push(v); if (i % 4 === 3 && fijos[f]) out.push(fijos[f++]); });
  items = out.concat(fijos.slice(f));
}

const feed = document.getElementById('feed');
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---------- YouTube ----------
let ytReady;
const ytLoaded = new Promise(res => (ytReady = res));
window.onYouTubeIframeAPIReady = () => ytReady();
function loadYT() {
  if (document.getElementById('yt-api')) return;
  const s = document.createElement('script'); s.id = 'yt-api'; s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}

// ---------- Diapositivas ----------
// Hay UN SOLO reproductor fijo detrás de las diapositivas. Al deslizar, cambia de vídeo
// (loadVideoById) en vez de crear otro: así el móvil mantiene el sonido sin tener que tocar cada vez.
let started = false, active = -1, player = null, playerReady = false;
function build() {
  if (!items.length) { feed.innerHTML = '<div class="empty">Todavía no hay vídeos en la lista.</div>'; return; }
  items.forEach((it, i) => {
    const el = document.createElement('section');
    el.className = 'slide'; el.dataset.i = i;
    el.innerHTML = `<img class="thumb" src="https://i.ytimg.com/vi/${it.id}/hqdefault.jpg" alt="" loading="lazy"><div class="chip" hidden></div>`;
    el.addEventListener('click', () => togglePause(el)); // la diapositiva tapa el reproductor: nada de YouTube se puede tocar
    feed.appendChild(el);
    io.observe(el);
  });
}
const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(+e.target.dataset.i);
}, { root: feed, threshold: [0.6] });

function chip(el, text) { const c = el?.querySelector('.chip'); if (!c) return; c.textContent = text || ''; c.hidden = !text; }
const cur = () => feed.children[active];

async function crearPlayer() {
  await ytLoaded;
  if (!items.length) return;
  player = new YT.Player('stage-player', {
    videoId: items[0].id, width: '100%', height: '100%',
    host: 'https://www.youtube-nocookie.com',
    playerVars: { autoplay: 0, controls: 0, rel: 0, playsinline: 1, fs: 0, disablekb: 1, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
    events: {
      onReady: () => { playerReady = true; if (started) play(active); },
      onStateChange: (e) => {
        const el = cur();
        if (e.data === YT.PlayerState.PLAYING) {
          el?.classList.add('live');
          chip(el, player.isMuted() ? '🔊 Toca para oír' : '');
        }
        if (e.data === YT.PlayerState.ENDED) next(active);
      },
      onError: () => next(active), // vídeo borrado o que no deja insertarse: al siguiente
    },
  });
}

function play(i) {
  if (!playerReady || i < 0) return;
  player.loadVideoById(items[i].id);
  player.unMute(); player.setVolume(100); player.playVideo();
  // Si el móvil no deja arrancarlo solo, se avisa en vez de quedarse parado
  setTimeout(() => {
    if (active === i && player.getPlayerState() !== YT.PlayerState.PLAYING && player.getPlayerState() !== YT.PlayerState.BUFFERING)
      chip(cur(), '▶ Toca para ver');
  }, 3000);
}

function activate(i) {
  if (!started || i === active) return;
  document.querySelectorAll('.slide.live').forEach(s => s.classList.remove('live'));
  chip(cur(), '');
  active = i;
  play(i);
}
function next(i) { const n = feed.children[i + 1]; if (n) n.scrollIntoView({ behavior: 'smooth' }); }
function togglePause(el) {
  if (!playerReady || +el.dataset.i !== active) return;
  if (player.isMuted()) { player.unMute(); player.setVolume(100); player.playVideo(); chip(el, ''); return; }
  const st = player.getPlayerState();
  if (st === YT.PlayerState.PLAYING) { player.pauseVideo(); chip(el, '⏸ Pausa: toca para seguir'); }
  else { player.playVideo(); chip(el, ''); }
}

// ---------- Inicio ----------
loadYT();
const listo = cargar().then(() => { build(); crearPlayer(); });
document.getElementById('go').addEventListener('click', () => {
  started = true;
  document.getElementById('start').classList.add('gone');
  document.getElementById('top').classList.add('gone');
  // Dentro del toque de "Entrar": arranca con sonido si el reproductor ya está listo
  if (playerReady) { active = 0; play(0); } else listo.then(() => activate(0));
});
addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); next(active); }
  if (e.key === 'ArrowUp') { e.preventDefault(); feed.children[active - 1]?.scrollIntoView({ behavior: 'smooth' }); }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
