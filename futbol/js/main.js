// Punto de entrada: pantallas, flujo de carrera y bucle del partido.

import { TEAMS, LEAGUES, POSITIONS, teamById, leagueById, ATTR_NAMES, overallFor, teamsOfLeague } from './data.js';
import * as C from './career.js';
import { Match } from './match/engine.js';
import { Renderer } from './match/render.js';
import { Renderer3D } from './match/render3d.js';
import { Input, heldOnly } from './match/input.js';
import { Sound } from './sound.js';

const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const crest = (t) => `<i class="crest" style="background:${t.colors[0]};border-color:${t.colors[1]}"></i>`;
const teamTag = (t) => `<span class="badge">${crest(t)}${esc(t.name)}</span>`;

const STEP = 1 / 60;
const isTouch = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window;

let career = C.load();
const input = new Input();
input.bindTouch($('#touch'));
const renderer = new Renderer($('#pitch'));
renderer.touchMode = isTouch;

// ---- Vista 3D (primera persona / detrás del jugador) ----
const CAM_NAMES = { fp: 'Primera persona', tp: 'Detrás del jugador', '2d': 'Cenital' };
const CAM_ORDER = ['fp', 'tp', '2d'];
let r3d = null;
try { r3d = new Renderer3D($('#gl')); } catch (err) { console.warn('WebGL no disponible', err); }
let camMode = 'fp';
try { camMode = localStorage.getItem('fv-cam') || 'fp'; } catch { /* sin almacenamiento */ }
if (!CAM_ORDER.includes(camMode) || !r3d) camMode = r3d ? 'fp' : '2d';
let yaw = 0;
let lookT = 0;

function applyCamMode() {
  const three = camMode !== '2d' && !!match;
  $('#gl').classList.toggle('hidden', !three);
  $('#pitch').classList.toggle('overlay-hud', three);
  const b = $('#btn-cam');
  if (b) b.textContent = `Cámara: ${CAM_NAMES[camMode]}`;
}
function cycleCam() {
  if (!r3d) return;
  camMode = CAM_ORDER[(CAM_ORDER.indexOf(camMode) + 1) % CAM_ORDER.length];
  try { localStorage.setItem('fv-cam', camMode); } catch { /* nada */ }
  if (match) { match.yawSnap = true; match.say(CAM_NAMES[camMode].toUpperCase(), '', 1.2); }
  applyCamMode();
}

const angDiff = (a, b) => { let d = b - a; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return d; };

// En 3D el stick es relativo a la mirada: ↑ avanzar, ↓ retroceder, ←/→ girar.
function transformInput(inp, dt) {
  const u = match.user;
  if (camMode === '2d' || !u || match.userAI || u.sentOff) { match.userYaw = null; return inp; }
  if (match.yawSnap) { yaw = u.face; match.yawSnap = false; }
  if (inp.look) lookT = 0.5;
  if (lookT > 0) {
    lookT -= dt;
    const b = match.ball;
    const ta = Math.atan2(b.y - u.y, b.x - u.x);
    const d = angDiff(yaw, ta);
    yaw += Math.max(-9 * dt, Math.min(9 * dt, d));
    if (Math.abs(d) < 0.03) lookT = 0;
  }
  const turn = Math.max(-1, Math.min(1, inp.mx + (inp.turn || 0)));
  const fwd = -inp.my;
  const owns = match.owner === u;
  yaw += turn * (owns ? 2.3 : 2.8) * dt;
  match.userYaw = yaw;
  const k = fwd < 0 ? 0.55 : 1;
  return { ...inp, mx: Math.cos(yaw) * fwd * k, my: Math.sin(yaw) * fwd * k };
}
const sound = new Sound();

let match = null;
let matchCtx = null;
let paused = false;
let fast = false;
let endTimer = 0;
let acc = 0;
let last = performance.now();
let helpReturn = 'menu';
let hubTab = 'table';
let lastKickSound = 0;
let usingKeyboard = false;
// iPad con teclado: si se usan teclas, ocultar los botones táctiles
window.addEventListener('keydown', (e) => {
  if (!isTouch || usingKeyboard || /^(INPUT|SELECT)$/.test(e.target.tagName)) return;
  usingKeyboard = true;
  if (match) $('#touch').classList.add('hidden');
});
window.addEventListener('touchstart', () => {
  if (usingKeyboard) { usingKeyboard = false; if (match) $('#touch').classList.remove('hidden'); }
}, { passive: true });

function show(id) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.add('hidden'));
  if (id) $('#' + id).classList.remove('hidden');
}

// ---------------- Menú ----------------
function openMenu() {
  career = C.load();
  $('#btn-continue').disabled = !career;
  $('#btn-continue').style.display = career ? '' : 'none';
  show('menu');
}

function fillSelect(sel, items, val) {
  sel.innerHTML = items.map((i) => `<option value="${i.value}" ${i.value === val ? 'selected' : ''}>${esc(i.label)}</option>`).join('');
}

function openCreate() {
  fillSelect($('#c-pos'), POSITIONS.map((p) => ({ value: p.id, label: `${p.id} · ${p.name}` })), 'DC');
  const acad = TEAMS.filter((t) => t.parent);
  fillSelect($('#c-team'), acad.map((t) => ({ value: t.id, label: `${t.name} (filial del ${teamById(t.parent).name})` })), 'rmc');
  previewCreate();
  show('create');
}

let previewAttrs = null;
function previewCreate() {
  const role = C.roleOf($('#c-pos').value);
  previewAttrs = C.startingAttrs(role);
  const ovr = overallFor(role, previewAttrs);
  $('#c-preview').innerHTML = `<div class="attr"><span class="n">Media inicial</span><span class="v" style="color:var(--accent)">${ovr}</span></div>` +
    Object.entries(previewAttrs).map(([k, v]) => attrBox(k, v)).join('');
}

function attrBox(k, v, extra = '') {
  return `<div class="attr"><div style="flex:1"><div style="display:flex"><span class="n">${ATTR_NAMES[k]}</span><span class="v">${v}</span></div><div class="bar"><i style="width:${v}%"></i></div></div>${extra}</div>`;
}

function createCareer() {
  const name = $('#c-name').value.trim() || 'Jugador';
  const c = C.newCareer({
    name, nation: $('#c-nation').value.trim(), pos: $('#c-pos').value,
    teamId: $('#c-team').value, number: Math.max(1, Math.min(99, +$('#c-number').value || 9)),
  });
  if (previewAttrs) c.player.attrs = { ...previewAttrs };
  career = c;
  C.save(c);
  openHub();
}

// ---------------- Hub de carrera ----------------
function openHub() {
  if (!career) return openMenu();
  renderHub();
  show('hub');
}

function renderHub() {
  const c = career;
  const p = c.player;
  const team = C.currentTeam(c);
  const lg = leagueById(c.league.id);
  const ovr = C.ovrOf(p);
  const st = c.seasonStats;
  const avg = st.apps ? (st.ratingSum / st.apps).toFixed(2) : '-';
  const status = C.squadStatus(c);
  const pos = POSITIONS.find((x) => x.id === p.pos);

  const attrRows = Object.keys(ATTR_NAMES).map((k) => {
    const cost = C.trainCost(c, k);
    const btn = `<button class="btn small train-btn" data-act="train" data-k="${k}" ${p.points < cost ? 'disabled' : ''} title="Coste: ${cost}">+${cost > 1 ? ` (${cost})` : ''}</button>`;
    return attrBox(k, p.attrs[k], btn);
  }).join('');

  let mainCard = '';
  if (c.phase === 'season') {
    const fx = C.nextFixture(c);
    const h = teamById(fx.h), a = teamById(fx.a);
    mainCard = `<div class="card">
      <h3>Próximo partido · Jornada ${c.league.round + 1} de ${c.league.fixtures.length}</h3>
      <div class="next">
        <div class="vs">${teamTag(h)} <span class="x">vs</span> ${teamTag(a)}</div>
        <div class="row" style="margin:0">
          <select id="dur" title="Duración real del partido">
            ${[180, 300, 420, 600].map((d) => `<option value="${d}" ${c.settings.duration === d ? 'selected' : ''}>${d / 60} min</option>`).join('')}
          </select>
          <button class="btn" data-act="sim">Simular</button>
          <button class="btn big" data-act="play">Jugar partido</button>
        </div>
      </div>
      <p class="muted">Estado en el equipo: <b>${status.label}</b> (${Math.round(status.start * 100)}% de ser titular). Si sales desde el banquillo entrarás en la 2ª parte.</p>
    </div>`;
  } else if (c.phase === 'offseason') {
    const offers = c.offers.map((o, i) => {
      const t = teamById(o.teamId);
      return `<div class="offer"><div class="o-l"><b>${teamTag(t)} ${o.promo ? '<span class="pill">⬆ Primer equipo</span>' : ''}</b>
        <small>${esc(o.label)} · Media equipo ${t.ovr} · Rol: ${o.status}</small>
        <small>${o.wage.toLocaleString('es-ES')} €/semana · ${o.years} años</small></div>
        <button class="btn ${o.renew ? '' : 'big'}" data-act="offer" data-i="${i}">${o.renew ? 'Renovar' : 'Firmar'}</button></div>`;
    }).join('');
    mainCard = `<div class="card"><h3>Mercado de fichajes · Fin de temporada ${c.year}/${(c.year + 1) % 100}</h3>
      <p class="muted">Tu rendimiento ha llamado la atención. Elige tu siguiente paso:</p>${offers}
      ${p.age >= 33 ? '<div class="row"><button class="btn ghost" data-act="retire">Retirarse</button></div>' : ''}</div>`;
  } else {
    mainCard = `<div class="card"><h3>Retirado</h3><p class="muted">Has colgado las botas. ¡Qué carrera! Mira tu historial abajo.</p>
      <div class="row"><button class="btn big" data-act="new">Nueva carrera</button></div></div>`;
  }

  let tabBody = '';
  if (hubTab === 'table') {
    const rows = C.sortedTable(c).map((r, i) => `<tr class="${r.id === team.id ? 'me' : ''}"><td>${i + 1}</td><td class="l">${teamTag(r.team)}</td><td>${r.p}</td><td>${r.w}</td><td>${r.d}</td><td>${r.l}</td><td>${r.gf}:${r.ga}</td><td><b>${r.pts}</b></td></tr>`).join('');
    tabBody = `<table class="tbl"><tr><th>#</th><th class="l">Equipo</th><th>PJ</th><th>G</th><th>E</th><th>P</th><th>Goles</th><th>Pts</th></tr>${rows}</table>`;
  } else if (hubTab === 'fixtures') {
    tabBody = `<table class="tbl">${c.league.fixtures.map((round, i) => {
      const m = round.find((x) => x.h === team.id || x.a === team.id);
      if (!m) return '';
      const played = m.hs != null;
      return `<tr class="${i === c.league.round ? 'me' : ''}"><td>J${i + 1}</td><td class="l">${teamTag(teamById(m.h))}</td><td>${played ? `${m.hs} - ${m.as}` : '-'}</td><td class="l">${teamTag(teamById(m.a))}</td></tr>`;
    }).join('')}</table>`;
  } else if (hubTab === 'history') {
    const cs = c.careerStats;
    tabBody = `<div class="stats-row"><div><b>${cs.apps}</b><span>Partidos</span></div><div><b>${cs.goals}</b><span>Goles</span></div><div><b>${cs.assists}</b><span>Asist.</span></div><div><b>${cs.apps ? (cs.ratingSum / cs.apps).toFixed(2) : '-'}</b><span>Media</span></div></div>
      <table class="tbl" style="margin-top:12px"><tr><th>Temp.</th><th class="l">Club</th><th>Edad</th><th>Pos.</th><th>PJ</th><th>G</th><th>A</th><th>Nota</th><th>Med.</th></tr>
      ${c.history.map((h) => `<tr><td>${h.year}</td><td class="l">${esc(h.club)}</td><td>${h.age}</td><td>${h.pos}º</td><td>${h.apps}</td><td>${h.goals}</td><td>${h.assists}</td><td>${h.avg}</td><td>${h.ovr}</td></tr>`).join('') || '<tr><td colspan="9" class="muted">Aún no has completado ninguna temporada.</td></tr>'}</table>`;
  }

  $('#hub-body').innerHTML = `
    <div style="display:flex;flex-direction:column;gap:14px">
      <div class="card">
        <div class="pcard">
          <div class="ovr"><b>${ovr}</b><small>${p.pos}</small></div>
          <div>
            <div class="pname">${esc(p.name)} <span class="muted">#${p.number}</span></div>
            <div class="pmeta">${esc(pos ? pos.name : p.pos)} · ${p.age} años · ${esc(p.nation)}</div>
            <div class="pmeta">${teamTag(team)}</div>
            <div class="pmeta">${lg.name} · ${p.wage.toLocaleString('es-ES')} €/sem · Potencial ${'★'.repeat(Math.max(1, Math.round((p.potential - 70) / 5)))}</div>
          </div>
        </div>
        <div class="stats-row"><div><b>${st.apps}</b><span>PJ</span></div><div><b>${st.goals}</b><span>Goles</span></div><div><b>${st.assists}</b><span>Asist.</span></div><div><b>${avg}</b><span>Nota</span></div></div>
      </div>
      <div class="card">
        <h3>Entrenamiento · ${p.points} punto${p.points === 1 ? '' : 's'} <span class="pill">XP ${p.xp}/100</span></h3>
        <div class="attrs" style="margin-top:0">${attrRows}</div>
      </div>
      <div class="card"><h3>Noticias</h3><ul class="news">${c.news.map((n) => `<li>${esc(n)}</li>`).join('')}</ul></div>
    </div>
    <div style="display:flex;flex-direction:column;gap:14px">
      ${mainCard}
      <div class="card">
        <div class="tabs">
          <button data-act="tab" data-t="table" class="${hubTab === 'table' ? 'on' : ''}">Clasificación</button>
          <button data-act="tab" data-t="fixtures" class="${hubTab === 'fixtures' ? 'on' : ''}">Calendario</button>
          <button data-act="tab" data-t="history" class="${hubTab === 'history' ? 'on' : ''}">Historial</button>
        </div>
        ${tabBody}
      </div>
      <div class="row"><button class="btn ghost" data-act="menu">Menú principal</button></div>
    </div>`;
}

// ---------------- Partidos ----------------
function startCareerMatch() {
  const c = career;
  const dur = +($('#dur') ? $('#dur').value : c.settings.duration);
  c.settings.duration = dur;
  C.save(c);
  const fx = C.nextFixture(c);
  const sel = C.decideSelection(c);
  const home = teamById(fx.h), away = teamById(fx.a);
  const userSide = fx.h === c.player.clubId ? 0 : 1;
  let preScore = null;
  if (!sel.starter) {
    const [hs, as] = C.simScore(home.ovr, away.ovr);
    const k = sel.minute / 90;
    preScore = [binom(hs, k), binom(as, k)];
  }
  const p = c.player;
  beginMatch({
    home, away, userSide, userRole: p.role, userAttrs: p.attrs, userName: p.name, userNumber: p.number,
    durationSec: dur * (sel.starter ? 1 : 0.9), startMinute: sel.minute, preScore,
  }, { mode: 'career', sel });
}

function binom(n, p) { let k = 0; for (let i = 0; i < n; i++) if (Math.random() < p) k++; return k; }

function simCareerMatch() {
  const sel = C.decideSelection(career);
  const result = C.simulateUserMatch(career, sel);
  const info = C.finishMatchday(career, result);
  showPost(result, info, 'career');
}

function openQuick() {
  const opts = TEAMS.map((t) => ({ value: t.id, label: `${t.name} (${t.ovr}) · ${leagueById(t.league).name}` }));
  fillSelect($('#q-home'), opts, 'rmd');
  fillSelect($('#q-away'), opts, 'fcb');
  fillSelect($('#q-pos'), POSITIONS.map((p) => ({ value: p.id, label: `${p.id} · ${p.name}` })), 'DC');
  show('quick');
}

function startQuick() {
  const home = teamById($('#q-home').value), away = teamById($('#q-away').value);
  if (home.id === away.id) return;
  const role = C.roleOf($('#q-pos').value);
  const attrs = {};
  const base = Math.max(70, home.ovr);
  for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) attrs[k] = Math.min(95, Math.round(base - 6 + ({ ST: { sho: 10, pac: 6, dri: 6 }, LW: { pac: 10, dri: 10 }, RW: { pac: 10, dri: 10 }, CM: { pas: 10, dri: 5 }, CDM: { def: 8, pas: 6 }, LB: { pac: 6, def: 8 }, RB: { pac: 6, def: 8 }, CB: { def: 12, phy: 8 } }[role][k] || -6)));
  beginMatch({ home, away, userSide: 0, userRole: role, userAttrs: attrs, userName: 'Tú', userNumber: 10, durationSec: +$('#q-dur').value, startMinute: 0 }, { mode: 'quick' });
}

function beginMatch(opts, ctx) {
  sound.init(); sound.resume(); sound.startCrowd();
  opts.onEvent = onMatchEvent;
  match = new Match(opts);
  matchCtx = ctx;
  if (opts.startMinute > 0) match.say('SALES DEL BANQUILLO', `Entras en el minuto ${opts.startMinute}`, 3);
  else match.say(`${opts.home.short} vs ${opts.away.short}`, leagueById(opts.home.league).name, 2.5);
  paused = false; fast = false; endTimer = 0; acc = 0;
  renderer.updateCamera(match, 0, true);
  if (r3d) { r3d.dispose(); r3d.snapCamera(); }
  match.yawSnap = true;
  applyCamMode();
  show(null);
  $('#touch').classList.toggle('hidden', !isTouch || usingKeyboard);
  input.enabled = true;
}

function onMatchEvent(type, d) {
  if (fast) return;
  switch (type) {
    case 'kick': {
      const now = performance.now();
      if (now - lastKickSound > 60) { sound.kick(d.power || 10); lastKickSound = now; }
      break;
    }
    case 'whistle': sound.whistle(d.long, d.final); break;
    case 'goal': sound.roar(d.user ? 1.4 : 0.9); break;
    case 'save': case 'post': sound.ooh(); break;
  }
}

function finishMatch() {
  const m = match;
  sound.stopCrowd();
  $('#touch').classList.add('hidden');
  const [h, a] = m.teams;
  const result = {
    home: h.info.id, away: a.info.id, hs: h.score, as: a.score,
    us: { ...m.us }, rating: Math.round(m.rating * 10) / 10,
    starter: matchCtx.sel ? matchCtx.sel.starter : true, minuteIn: m.opts.startMinute || 0,
    events: m.events, stats: [h.stats, a.stats], simulated: false,
  };
  match = null;
  applyCamMode();
  if (matchCtx.mode === 'career') {
    const info = C.finishMatchday(career, result);
    showPost(result, info, 'career');
  } else showPost(result, null, 'quick');
}

function showPost(r, info, mode) {
  const h = teamById(r.home), a = teamById(r.away);
  const u = r.us;
  const col = r.rating >= 7.5 ? 'var(--green)' : r.rating >= 6 ? 'var(--accent)' : 'var(--red)';
  const goals = (r.events || []).filter((e) => e.type === 'goal').map((e) =>
    `<div>${e.minute}' ${e.side === 0 ? crest(h) : crest(a)} ${esc(e.scorer)}${e.own ? ' (p.p.)' : ''}${e.assist ? ` <span class="muted">· asist. ${esc(e.assist)}</span>` : ''}${e.user ? ' ⭐' : ''}</div>`).join('');
  let extra = '';
  if (info) {
    extra = `<p class="muted" style="text-align:center">+${info.xp} XP${info.gained ? ` · <b style="color:var(--accent)">+${info.gained} punto${info.gained > 1 ? 's' : ''} de entrenamiento</b>` : ''}</p>`;
    if (career.phase === 'offseason') extra += `<p class="muted" style="text-align:center"><b>¡Fin de temporada!</b> Tienes ofertas esperando.</p>`;
  }
  const possTot = r.stats ? r.stats[0].poss + r.stats[1].poss : 0;
  const teamStats = r.stats ? `<h3 style="margin-top:14px">Partido</h3><div class="grid2">
      <div><span>Posesión</span><b>${Math.round(r.stats[0].poss / (possTot || 1) * 100)}% - ${Math.round(r.stats[1].poss / (possTot || 1) * 100)}%</b></div>
      <div><span>Tiros (a puerta)</span><b>${r.stats[0].shots} (${r.stats[0].onTarget}) - ${r.stats[1].shots} (${r.stats[1].onTarget})</b></div>
      <div><span>Pases</span><b>${r.stats[0].passOk} - ${r.stats[1].passOk}</b></div>
      <div><span>Córners</span><b>${r.stats[0].corners} - ${r.stats[1].corners}</b></div></div>` : '';
  const userStats = r.simulated ? `<p class="muted" style="text-align:center">Partido simulado${r.starter ? '' : ` (entraste en el ${r.minuteIn}')`}: ${u.goals} gol(es), ${u.assists} asistencia(s).</p>` :
    `<h3>Tu partido${r.minuteIn ? ` (desde el ${r.minuteIn}')` : ''}</h3><div class="grid2">
      <div><span>Goles</span><b>${u.goals}</b></div><div><span>Asistencias</span><b>${u.assists}</b></div>
      <div><span>Pases</span><b>${u.passOk}/${u.passes}</b></div><div><span>Tiros (a puerta)</span><b>${u.shots} (${u.onTarget})</b></div>
      <div><span>Entradas ganadas</span><b>${u.tackles}/${u.tacklesTry}</b></div><div><span>Recuperaciones</span><b>${u.intercepts}</b></div>
      <div><span>Fueras de juego</span><b>${u.offsides}</b></div><div><span>Faltas</span><b>${u.fouls}${u.yellow ? ' 🟨' : ''}${u.red ? ' 🟥' : ''}</b></div></div>`;
  $('#post-body').innerHTML = `
    <h2 style="text-align:center">Final del partido</h2>
    <div class="score-big">${teamTag(h)} <span class="sc">${r.hs} - ${r.as}</span> ${teamTag(a)}</div>
    <div class="goals-list">${goals || '<div class="muted" style="text-align:center">Sin goles</div>'}</div>
    <div class="rating-big"><div class="muted">Tu nota</div><b style="color:${col}">${r.rating.toFixed(1)}</b></div>
    ${userStats}${teamStats}${extra}
    <div class="row"><button class="btn big" data-act="${mode === 'career' ? 'hub' : 'menu'}">Continuar</button></div>`;
  show('post');
}

// ---------------- Eventos de UI ----------------
document.addEventListener('click', (e) => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  sound.init(); sound.resume();
  const act = b.dataset.act;
  switch (act) {
    case 'new': openCreate(); break;
    case 'continue': openHub(); break;
    case 'menu': openMenu(); break;
    case 'hub': openHub(); break;
    case 'quick': openQuick(); break;
    case 'quickgo': startQuick(); break;
    case 'help': helpReturn = match ? 'pause' : 'menu'; show('help'); break;
    case 'back': show(helpReturn); break;
    case 'create': createCareer(); break;
    case 'play': startCareerMatch(); break;
    case 'sim': simCareerMatch(); break;
    case 'tab': hubTab = b.dataset.t; renderHub(); break;
    case 'train': C.trainAttr(career, b.dataset.k); renderHub(); break;
    case 'offer': C.acceptOffer(career, career.offers[+b.dataset.i]); hubTab = 'table'; renderHub(); window.scrollTo(0, 0); break;
    case 'retire': C.retire(career); renderHub(); break;
    case 'resume': paused = false; show(null); break;
    case 'simrest': paused = false; fast = true; match.userAI = true; show(null); break;
    case 'cam': cycleCam(); break;
    case 'mute': sound.setMuted(!sound.muted); b.textContent = `Sonido: ${sound.muted ? 'no' : 'sí'}`; break;
  }
});
document.addEventListener('change', (e) => {
  if (e.target.id === 'c-pos') previewCreate();
});

function drawMatch(dt) {
  if (camMode === '2d' || !r3d) { renderer.draw(match, dt); return; }
  r3d.mode = camMode;
  const u = match.user;
  let pt = null;
  if (u && match.owner === u && !match.userAI) pt = match.pickUserTarget(u, 'ground', Math.cos(u.face), Math.sin(u.face));
  r3d.render(match, dt, yaw, pt);
  const b = match.ball;
  renderer.drawOverlay(match, {
    mode: camMode, following: r3d.following, ballScreen: r3d.project(b.x, b.y, b.z + 0.11),
    passName: pt ? pt.name : null,
    hint: match.time < 8 && r3d.following ? (isTouch ? 'Stick: ↑ avanzar · ←→ girar · BALÓN para mirarlo · CÁM cambia la vista' : 'W avanzar · A/D girar · Q mirar al balón · C cambiar cámara') : null,
  });
}

// ---------------- Bucle ----------------
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (match) {
    const inp = input.read();
    if (inp.cam) cycleCam();
    if (inp.pause && !fast) {
      paused = !paused;
      show(paused ? 'pause' : null);
    }
    if (isTouch) $('#rotate').classList.toggle('hidden', window.innerWidth >= window.innerHeight || Math.min(window.innerWidth, window.innerHeight) >= 600);
    if (!paused) {
      if (fast) {
        for (let i = 0; i < 240 && !match.finished; i++) match.step(STEP, null);
      } else {
        acc += dt;
        let first = true;
        const tin = transformInput(inp, dt);
        while (acc >= STEP) {
          match.step(STEP, first ? tin : heldOnly(tin));
          first = false;
          acc -= STEP;
        }
        const b = match.ball;
        const dg = Math.min(b.x, 105 - b.x);
        sound.excitement(Math.max(0, 1 - dg / 30));
      }
      if (match.finished) {
        endTimer += dt;
        if (endTimer > (fast ? 0.3 : 2.8)) finishMatch();
      }
    }
    if (match) drawMatch(dt);
  } else if (!$('#rotate').classList.contains('hidden')) {
    $('#rotate').classList.add('hidden');
  }
  requestAnimationFrame(frame);
}

openMenu();
requestAnimationFrame(frame);

// para depuración desde consola
window.__fv = { get match() { return match; }, C, teamsOfLeague, LEAGUES };
