// Modo carrera: jugador, temporadas, calendario, clasificación, progresión y ofertas.

import { TEAMS, teamById, leagueById, teamsOfLeague, POSITIONS, ROLE_WEIGHTS, overallFor } from './data.js';

const SAVE_KEY = 'futbol-vida-save-v1';
const ATTRS = ['pac', 'sho', 'pas', 'dri', 'def', 'phy'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const randn = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
function poisson(l) {
  const L = Math.exp(-l);
  let k = 0, p = 1;
  do { k++; p *= Math.random(); } while (p > L);
  return k - 1;
}

export function save(c) {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify(c)); } catch { /* sin almacenamiento */ }
}
export function load() {
  try {
    const s = localStorage.getItem(SAVE_KEY);
    return s ? JSON.parse(s) : null;
  } catch { return null; }
}
export function hasSave() { return !!load(); }
export function deleteSave() { try { localStorage.removeItem(SAVE_KEY); } catch { /* nada */ } }

export function roleOf(posId) { return (POSITIONS.find((p) => p.id === posId) || POSITIONS[0]).role; }
export function ovrOf(player) { return overallFor(player.role, player.attrs); }

export function startingAttrs(role) {
  const w = ROLE_WEIGHTS[role];
  const a = {};
  for (const k of ATTRS) a[k] = Math.round(clamp(44 + w[k] * 48 + randn() * 2.5, 35, 70));
  return a;
}

export function newCareer({ name, nation, pos, teamId, number }) {
  const role = roleOf(pos);
  const player = {
    name: name || 'Jugador', nation: nation || 'España', pos, role,
    number: number || 9, age: 16, attrs: startingAttrs(role),
    potential: Math.round(clamp(84 + randn() * 4, 76, 94)),
    xp: 0, points: 3, fame: 0, morale: 70,
    clubId: teamId, contract: 2, wage: 400,
  };
  const c = {
    version: 1, year: 2026, season: 1, player,
    seasonStats: freshStats(), careerStats: freshStats(),
    history: [], news: [], phase: 'season', offers: null, lastMatch: null,
    settings: { duration: 300 },
  };
  c.news.push(`¡Bienvenido a la cantera del ${teamById(teamId).name}! Tienes 16 años y un sueño.`);
  setupSeason(c);
  return c;
}

function freshStats() { return { apps: 0, starts: 0, goals: 0, assists: 0, ratingSum: 0, motm: 0, yellows: 0, reds: 0 }; }

export function setupSeason(c) {
  const team = teamById(c.player.clubId);
  const ids = teamsOfLeague(team.league).map((t) => t.id);
  c.league = {
    id: team.league,
    teams: ids,
    fixtures: makeFixtures(ids),
    round: 0,
    table: Object.fromEntries(ids.map((id) => [id, { p: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }])),
    scorers: {},
  };
  c.phase = 'season';
  c.offers = null;
  c.seasonStats = freshStats();
}

// liga a doble vuelta (método del círculo)
function makeFixtures(ids) {
  const t = ids.slice();
  if (t.length % 2) t.push(null);
  const n = t.length;
  const rounds = [];
  const arr = t.slice();
  for (let r = 0; r < n - 1; r++) {
    const games = [];
    for (let i = 0; i < n / 2; i++) {
      const a = arr[i], b = arr[n - 1 - i];
      if (a && b) games.push(r % 2 === 0 ? { h: a, a: b } : { h: b, a });
    }
    rounds.push(games);
    arr.splice(1, 0, arr.pop());
  }
  const second = rounds.map((g) => g.map((m) => ({ h: m.a, a: m.h })));
  return [...rounds, ...second];
}

export function currentTeam(c) { return teamById(c.player.clubId); }

export function nextFixture(c) {
  const lg = c.league;
  if (lg.round >= lg.fixtures.length) return null;
  const id = c.player.clubId;
  return lg.fixtures[lg.round].find((m) => m.h === id || m.a === id) || null;
}

// probabilidad de ser titular según media vs. equipo
export function squadStatus(c) {
  const ovr = ovrOf(c.player);
  const t = currentTeam(c);
  const diff = ovr - t.ovr;
  if (diff >= -2) return { label: 'Titular indiscutible', start: 0.95 };
  if (diff >= -5) return { label: 'Titular habitual', start: 0.75 };
  if (diff >= -9) return { label: 'Rotación', start: 0.45 };
  if (diff >= -14) return { label: 'Suplente', start: 0.2 };
  return { label: 'Promesa', start: 0.08 };
}

export function decideSelection(c) {
  if (c.careerStats.apps === 0) return { starter: true, minute: 0 }; // debut como titular
  const st = squadStatus(c);
  if (Math.random() < st.start) return { starter: true, minute: 0 };
  const minute = Math.round(55 + Math.random() * 25);
  return { starter: false, minute };
}

export function simScore(hOvr, aOvr) {
  const d = (hOvr - aOvr) * 0.055;
  return [poisson(1.4 * Math.exp(d) + 0.1), poisson(1.1 * Math.exp(-d))];
}

function applyResult(lg, h, a, hs, as) {
  const th = lg.table[h], ta = lg.table[a];
  th.p++; ta.p++;
  th.gf += hs; th.ga += as; ta.gf += as; ta.ga += hs;
  if (hs > as) { th.w++; th.pts += 3; ta.l++; }
  else if (hs < as) { ta.w++; ta.pts += 3; th.l++; }
  else { th.d++; ta.d++; th.pts++; ta.pts++; }
}

export function sortedTable(c) {
  const lg = c.league;
  return lg.teams.map((id) => ({ id, team: teamById(id), ...lg.table[id] }))
    .sort((x, y) => y.pts - x.pts || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
}

// simula el partido del usuario sin jugarlo
export function simulateUserMatch(c, sel) {
  const fx = nextFixture(c);
  const home = teamById(fx.h), away = teamById(fx.a);
  const [hs, as] = simScore(home.ovr, away.ovr);
  const userHome = fx.h === c.player.clubId;
  const myGoals = userHome ? hs : as;
  const ovr = ovrOf(c.player);
  const goalShare = { ST: 0.33, LW: 0.2, RW: 0.2, CM: 0.12, CDM: 0.05, LB: 0.04, RB: 0.04, CB: 0.05 }[c.player.role];
  const asShare = { ST: 0.15, LW: 0.2, RW: 0.2, CM: 0.2, CDM: 0.1, LB: 0.1, RB: 0.1, CB: 0.04 }[c.player.role];
  const played = sel.starter ? 1 : (90 - sel.minute) / 90;
  const boost = clamp(1 + (ovr - currentTeam(c).ovr) * 0.04, 0.5, 1.8);
  let goals = 0, assists = 0;
  for (let i = 0; i < myGoals; i++) {
    const r = Math.random();
    if (r < goalShare * played * boost) goals++;
    else if (r < (goalShare + asShare) * played * boost) assists++;
  }
  const res = myGoals - (userHome ? as : hs);
  const rating = clamp(6.2 + randn() * 0.55 + goals * 0.9 + assists * 0.5 + res * 0.15 + (ovr - currentTeam(c).ovr) * 0.02, 4, 10);
  return {
    home: fx.h, away: fx.a, hs, as, simulated: true, starter: sel.starter, minuteIn: sel.minute,
    us: { goals, assists, passes: 0, passOk: 0, shots: 0, onTarget: 0, tackles: 0, yellow: 0, red: false },
    rating: Math.round(rating * 10) / 10, events: [],
  };
}

// registra el resultado (jugado o simulado) y simula el resto de la jornada
export function finishMatchday(c, result) {
  const lg = c.league;
  const round = lg.fixtures[lg.round];
  for (const m of round) {
    if (m.h === result.home && m.a === result.away) { m.hs = result.hs; m.as = result.as; }
    else {
      const [hs, as] = simScore(teamById(m.h).ovr, teamById(m.a).ovr);
      m.hs = hs; m.as = as;
    }
    applyResult(lg, m.h, m.a, m.hs, m.as);
  }
  lg.round++;

  const s = c.seasonStats, cs = c.careerStats;
  const u = result.us;
  for (const st of [s, cs]) {
    st.apps++; if (result.starter) st.starts++;
    st.goals += u.goals; st.assists += u.assists; st.ratingSum += result.rating;
    if (result.rating >= 8) st.motm++;
    st.yellows += u.yellow || 0; if (u.red) st.reds++;
  }
  lg.scorers.__user = (lg.scorers.__user || 0) + u.goals;

  // experiencia -> puntos de entrenamiento
  const xp = Math.max(10, Math.round((result.rating - 5) * 35 + u.goals * 25 + u.assists * 15 + (result.simulated ? 0 : 15)));
  c.player.xp += xp;
  let gained = 0;
  while (c.player.xp >= 100) { c.player.xp -= 100; c.player.points++; gained++; }
  c.player.fame = clamp(c.player.fame + (result.rating - 6.3) * 2 + u.goals * 1.5, 0, 100);
  c.player.morale = clamp(c.player.morale + (result.rating - 6.5) * 6, 10, 100);

  const myHome = result.home === c.player.clubId;
  const gf = myHome ? result.hs : result.as, ga = myHome ? result.as : result.hs;
  const opp = teamById(myHome ? result.away : result.home);
  const resTxt = gf > ga ? 'Victoria' : gf < ga ? 'Derrota' : 'Empate';
  let line = `J${lg.round}: ${resTxt} ${gf}-${ga} vs ${opp.name}. Nota ${result.rating.toFixed(1)}`;
  if (u.goals) line += ` · ${u.goals} gol${u.goals > 1 ? 'es' : ''}`;
  if (u.assists) line += ` · ${u.assists} asist.`;
  c.news.unshift(line);
  c.news = c.news.slice(0, 30);
  c.lastMatch = { ...result, xp, pointsGained: gained };

  if (lg.round >= lg.fixtures.length) endSeason(c);
  save(c);
  return { xp, gained };
}

export function trainAttr(c, k) {
  const p = c.player;
  const cost = p.attrs[k] >= 85 ? 3 : p.attrs[k] >= 75 ? 2 : 1;
  if (p.points < cost) return false;
  if (p.attrs[k] >= Math.min(99, p.potential + 6)) return false;
  p.points -= cost;
  p.attrs[k]++;
  save(c);
  return true;
}
export function trainCost(c, k) {
  const v = c.player.attrs[k];
  return v >= 85 ? 3 : v >= 75 ? 2 : 1;
}

function endSeason(c) {
  c.phase = 'offseason';
  const table = sortedTable(c);
  const pos = table.findIndex((r) => r.id === c.player.clubId) + 1;
  const s = c.seasonStats;
  const avg = s.apps ? s.ratingSum / s.apps : 6;
  c.history.push({
    year: `${c.year}/${String((c.year + 1) % 100).padStart(2, '0')}`, age: c.player.age,
    club: currentTeam(c).name, league: leagueById(c.league.id).name, pos,
    apps: s.apps, goals: s.goals, assists: s.assists, avg: Math.round(avg * 100) / 100, ovr: ovrOf(c.player),
  });
  c.news.unshift(`Fin de temporada: ${currentTeam(c).name} acaba ${pos}º. Tú: ${s.apps} PJ, ${s.goals} goles, ${s.assists} asist., media ${avg.toFixed(2)}.`);
  c.offers = generateOffers(c, avg);
}

function generateOffers(c, avg) {
  const ovr = ovrOf(c.player);
  const cur = currentTeam(c);
  const perf = (avg - 6.6) * 4 + c.player.fame * 0.05; // buena temporada => mejores clubes
  const ceiling = ovr + 4 + perf;
  const floor = ovr - 8 + perf * 0.5;
  const offers = [];
  if (cur.parent) {
    const parent = teamById(cur.parent);
    if (ovr >= parent.ovr - 14 + (avg < 6.5 ? 3 : 0)) {
      offers.push(makeOffer(c, parent, 'Ascenso al primer equipo', true));
    }
  }
  const pool = TEAMS.filter((t) => t.id !== cur.id && !t.parent && t.ovr <= ceiling && t.ovr >= floor && !offers.find((o) => o.teamId === t.id));
  pool.sort(() => Math.random() - 0.5);
  pool.sort((a, b) => b.ovr - a.ovr);
  const pick = pool.slice(0, 8).sort(() => Math.random() - 0.5).slice(0, 3);
  for (const t of pick) offers.push(makeOffer(c, t));
  // si no hay nada, al menos equipos de Segunda
  if (offers.length === 0) {
    const fallback = TEAMS.filter((t) => t.league === 'seg').sort(() => Math.random() - 0.5)[0];
    offers.push(makeOffer(c, fallback));
  }
  offers.push({ teamId: cur.id, renew: true, label: 'Renovar y seguir', wage: Math.round(c.player.wage * 1.15), years: 2, status: squadStatusFor(ovrOf(c.player), cur) });
  return offers;
}

function squadStatusFor(ovr, team) {
  const diff = ovr - team.ovr;
  if (diff >= -2) return 'Titular indiscutible';
  if (diff >= -5) return 'Titular habitual';
  if (diff >= -9) return 'Rotación';
  if (diff >= -14) return 'Suplente';
  return 'Promesa';
}

function makeOffer(c, t, label = '', promo = false) {
  const wage = Math.round((Math.pow(1.11, t.ovr - 55) * 500 + c.player.fame * 30) / 50) * 50;
  return { teamId: t.id, label: label || leagueById(t.league).name, promo, wage, years: 2 + Math.floor(Math.random() * 3), status: squadStatusFor(ovrOf(c.player), t) };
}

export function acceptOffer(c, offer) {
  const p = c.player;
  const old = currentTeam(c);
  if (!offer.renew) {
    const t = teamById(offer.teamId);
    c.news.unshift(`¡Fichaje! Firmas por el ${t.name} (${offer.years} años, ${offer.wage} €/sem).`);
    p.clubId = offer.teamId;
  } else {
    c.news.unshift(`Renuevas con el ${old.name}.`);
  }
  p.wage = offer.wage;
  p.contract = offer.years;
  // envejecer y crecer
  p.age++;
  c.year++; c.season++;
  const growth = p.age <= 19 ? 3 : p.age <= 22 ? 2 : p.age <= 27 ? 1 : p.age <= 30 ? 0 : -1;
  for (const k of ATTRS) {
    let g = growth + (Math.random() < 0.5 ? 1 : 0) - (Math.random() < 0.3 ? 1 : 0);
    if (p.age > 30 && (k === 'pac' || k === 'phy')) g -= 1;
    if (g > 0 && p.attrs[k] >= p.potential + 3) g = 0;
    p.attrs[k] = clamp(p.attrs[k] + g, 20, 99);
  }
  p.points += 2;
  setupSeason(c);
  save(c);
}

export function retire(c) {
  c.phase = 'retired';
  save(c);
}
