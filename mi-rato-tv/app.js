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
let started = false, active = -1, player = null, skipped = new Set();
function build() {
  if (!items.length) { feed.innerHTML = '<div class="empty">Todavía no hay vídeos en la lista.</div>'; return; }
  items.forEach((it, i) => {
    const el = document.createElement('section');
    el.className = 'slide'; el.dataset.i = i;
    el.innerHTML = `<img class="thumb" src="https://i.ytimg.com/vi/${it.id}/hqdefault.jpg" alt="">
      <div class="player"></div><div class="shield"></div>
      <div class="chip" hidden></div>`;
    el.querySelector('.shield').addEventListener('click', () => togglePause(el));
    feed.appendChild(el);
    io.observe(el);
  });
}
const io = new IntersectionObserver((es) => {
  for (const e of es) if (e.isIntersecting && e.intersectionRatio > 0.6) activate(+e.target.dataset.i);
}, { root: feed, threshold: [0.6] });

function chip(el, text) { const c = el.querySelector('.chip'); c.textContent = text || ''; c.hidden = !text; }

async function activate(i) {
  if (!started || i === active) return;
  active = i;
  // Solo hay un reproductor a la vez: se quita el anterior (ahorra datos y batería)
  if (player) { try { player.destroy(); } catch {} player = null; }
  document.querySelectorAll('.slide .player').forEach(p => (p.innerHTML = ''));
  const el = feed.children[i], it = items[i];
  chip(el, '');
  await ytLoaded;
  if (active !== i) return;
  const box = document.createElement('div'); el.querySelector('.player').appendChild(box);
  player = new YT.Player(box, {
    videoId: it.id, width: '100%', height: '100%',
    host: 'https://www.youtube-nocookie.com',
    playerVars: { autoplay: 1, controls: 0, rel: 0, playsinline: 1, fs: 0, disablekb: 1, iv_load_policy: 3, modestbranding: 1, origin: location.origin },
    events: {
      onReady: (e) => { e.target.unMute(); e.target.setVolume(100); e.target.playVideo();
        setTimeout(() => { if (active === i && e.target.isMuted?.()) chip(el, '🔊 Toca para oír'); }, 1500); },
      onStateChange: (e) => {
        if (e.data === YT.PlayerState.PLAYING) chip(el, e.target.isMuted() ? '🔊 Toca para oír' : '');
        if (e.data === YT.PlayerState.ENDED) next(i);
      },
      onError: () => { skipped.add(i); next(i); }, // vídeo borrado o que no deja insertarse: al siguiente
    },
  });
}
function next(i) { const n = feed.children[i + 1]; if (n) n.scrollIntoView({ behavior: 'smooth' }); }
function togglePause(el) {
  if (!player || +el.dataset.i !== active) return;
  if (player.isMuted()) { player.unMute(); player.setVolume(100); player.playVideo(); chip(el, ''); return; }
  const s = player.getPlayerState();
  if (s === YT.PlayerState.PLAYING) { player.pauseVideo(); chip(el, '⏸ Pausa — toca para seguir'); }
  else { player.playVideo(); chip(el, ''); }
}

// ---------- Inicio ----------
loadYT();
const listo = cargar().then(build);
document.getElementById('go').addEventListener('click', () => {
  started = true;
  document.getElementById('start').classList.add('gone');
  document.getElementById('top').classList.add('gone');
  listo.then(() => { if (items.length) activate(0); });
});
addEventListener('keydown', (e) => {
  if (!started) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); next(active); }
  if (e.key === 'ArrowUp') { e.preventDefault(); feed.children[active - 1]?.scrollIntoView({ behavior: 'smooth' }); }
});

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
