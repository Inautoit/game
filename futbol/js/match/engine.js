// Motor del partido: física del balón, movimiento de jugadores, IA de equipo,
// reglas (fuera de banda, córner, saque de puerta, faltas, penaltis,
// fuera de juego) y estadísticas del jugador del usuario.
//
// Coordenadas en metros: x a lo largo (0..105), y a lo ancho (0..68), z altura.

import { ROLE_WEIGHTS, randomName } from '../data.js';

export const L = 105;
export const W = 68;
export const GOAL_HALF = 3.66;
export const GOAL_H = 2.44;
export const BOX_D = 16.5;
export const BOX_HALF = 20.16;
const G = 9.81;
const BALL_R = 0.11;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
const randn = () => {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  while (v === 0) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
const hyp = Math.hypot;
const dist = (a, b) => hyp(a.x - b.x, a.y - b.y);
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy || 1;
  const t = clamp(((px - ax) * dx + (py - ay) * dy) / l2, 0, 1);
  return hyp(px - (ax + t * dx), py - (ay + t * dy));
}
function angDiff(a, b) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

// 4-3-3 en coordenadas normalizadas del "marco de ataque" (x: 0 portería propia -> 1 rival)
export const FORMATION = [
  { role: 'GK', x: 0.03, y: 0.5, num: 1 },
  { role: 'LB', x: 0.22, y: 0.13, num: 3 },
  { role: 'CB', x: 0.17, y: 0.38, num: 4 },
  { role: 'CB', x: 0.17, y: 0.62, num: 5 },
  { role: 'RB', x: 0.22, y: 0.87, num: 2 },
  { role: 'CDM', x: 0.34, y: 0.5, num: 6 },
  { role: 'CM', x: 0.45, y: 0.3, num: 8 },
  { role: 'CM', x: 0.45, y: 0.7, num: 10 },
  { role: 'LW', x: 0.68, y: 0.14, num: 11 },
  { role: 'ST', x: 0.76, y: 0.5, num: 9 },
  { role: 'RW', x: 0.68, y: 0.86, num: 7 },
];
const GROUP = { GK: 'GK', LB: 'DEF', CB: 'DEF', RB: 'DEF', CDM: 'MID', CM: 'MID', LW: 'FWD', ST: 'FWD', RW: 'FWD' };

function genAttrs(ovr, role) {
  const w = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.CM;
  const a = {};
  for (const k of ['pac', 'sho', 'pas', 'dri', 'def', 'phy']) {
    const spec = role === 'GK' ? (k === 'pas' || k === 'phy' ? 0 : -15) : (w[k] - 0.17) * 55;
    a[k] = Math.round(clamp(ovr + spec + randn() * 4, 25, 99));
  }
  a.gk = role === 'GK' ? Math.round(clamp(ovr + 2 + randn() * 3, 40, 99)) : 20;
  return a;
}

function hexToRgb(h) {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function colorDist(a, b) {
  const x = hexToRgb(a), y = hexToRgb(b);
  return hyp(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

class Player {
  constructor(team, slot, idx) {
    this.team = team;
    this.idx = idx;
    this.role = slot.role;
    this.group = GROUP[slot.role];
    this.base = { x: slot.x, y: slot.y };
    this.num = slot.num;
    this.name = randomName();
    this.a = genAttrs(team.ovr, slot.role);
    this.x = 0; this.y = 0; this.vx = 0; this.vy = 0;
    this.face = 0;
    this.stamina = 1;
    this.isUser = false;
    this.cd = 0; this.stun = 0; this.slide = 0; this.dive = 0;
    this.holding = false; this.holdT = 0;
    this.decideT = 0; this.dribDir = null;
    this.receive = null; this.run = 0; this.runT = null;
    this.tackleCd = 0;
    this.sentOff = false; this.yellow = 0;
    this.phase = Math.random() * 6;
    this.charge = 0; this.charging = false;
    this.assistFrom = null; this.assistT = 0;
    this.slideTouched = false;
  }
  get speed() { return hyp(this.vx, this.vy); }
}

function makeTeam(side, info, ovrOverride) {
  const t = {
    side,
    info,
    name: info.name,
    short: info.short,
    ovr: ovrOverride ?? info.ovr,
    color: info.colors[0],
    color2: info.colors[1],
    dir: side === 0 ? 1 : -1,
    score: 0,
    players: [],
    stats: { shots: 0, onTarget: 0, poss: 0, passes: 0, passOk: 0, fouls: 0, corners: 0 },
  };
  FORMATION.forEach((slot, i) => t.players.push(new Player(t, slot, i)));
  return t;
}

export class Match {
  /**
   * opts: { home, away, userSide (0|1|null), userRole, userAttrs, userName, userNumber,
   *         durationSec, startMinute, preScore:[h,a], onEvent(type,data) }
   */
  constructor(opts) {
    this.opts = opts;
    this.teams = [makeTeam(0, opts.home), makeTeam(1, opts.away)];
    // Equipación alternativa si los colores chocan
    const [h, a] = this.teams;
    if (colorDist(h.color, a.color) < 120) {
      const alt = colorDist(h.color, a.color2) > 140 ? a.color2 : (colorDist(h.color, '#202020') > 140 ? '#202020' : '#f0f0f0');
      a.color2 = a.color; a.color = alt;
    }
    h.gkColor = '#22c55e'; a.gkColor = '#f97316';
    if (opts.preScore) { h.score = opts.preScore[0]; a.score = opts.preScore[1]; }

    this.ball = { x: L / 2, y: W / 2, z: 0, vx: 0, vy: 0, vz: 0, spin: 0 };
    this.owner = null;
    this.lastTouch = null;
    this.time = 0;
    this.minute = opts.startMinute || 0;
    this.half = this.minute >= 45 ? 2 : 1;
    if (this.half === 2) { h.dir = -1; a.dir = 1; }
    this.rate = 90 / (opts.durationSec || 300);
    this.state = 'restart';
    this.timer = 0;
    this.rs = null;
    this.pass = null;
    this.shot = null;
    this.events = [];
    this.banner = null;
    this.userCall = 0;
    this.pressCall = 0;
    this.userAI = false;
    this.finished = false;
    this.onEvent = opts.onEvent || (() => {});
    this.chaser = [null, null];

    this.user = null;
    if (opts.userSide === 0 || opts.userSide === 1) {
      const team = this.teams[opts.userSide];
      const p = team.players.find((q) => q.role === opts.userRole) || team.players[9];
      p.isUser = true;
      p.name = opts.userName || 'Tú';
      if (opts.userAttrs) p.a = { ...opts.userAttrs, gk: 20 };
      if (opts.userNumber) p.num = opts.userNumber;
      this.user = p;
    }
    this.us = {
      passes: 0, passOk: 0, keyPasses: 0, shots: 0, onTarget: 0, goals: 0, assists: 0,
      tackles: 0, tacklesTry: 0, intercepts: 0, lost: 0, fouls: 0, offsides: 0, dribbles: 0,
      rt: 0, yellow: 0, red: false,
    };
    this.kickoff(this.half === 1 ? 0 : 1);
  }

  // ---------- Utilidades de marco de ataque ----------
  nx(t, x) { return t.dir > 0 ? x / L : 1 - x / L; }
  ny(t, y) { return t.dir > 0 ? y / W : 1 - y / W; }
  wx(t, nx) { return t.dir > 0 ? nx * L : (1 - nx) * L; }
  wy(t, ny) { return t.dir > 0 ? ny * W : (1 - ny) * W; }
  goalX(t) { return t.dir > 0 ? L : 0; }
  ownGoalX(t) { return t.dir > 0 ? 0 : L; }
  opp(t) { return this.teams[1 - t.side]; }
  active(t) { return t.players.filter((p) => !p.sentOff); }
  gk(t) { return t.players[0]; }
  inBox(defTeam, x, y) {
    const gx = this.ownGoalX(defTeam);
    return Math.abs(x - gx) < BOX_D && Math.abs(y - W / 2) < BOX_HALF;
  }
  get possTeam() { return this.owner ? this.owner.team : (this.lastTouch ? this.lastTouch.team : null); }

  offsideLine(t) {
    const o = this.opp(t);
    const xs = this.active(o).map((p) => this.nx(t, p.x)).sort((a, b) => b - a);
    const second = xs[1] ?? 0.5;
    return Math.max(second, 0.5, this.nx(t, this.ball.x));
  }

  maxSpeed(p, sprint) {
    const st = 0.8 + 0.2 * p.stamina;
    let s = sprint ? 6.0 + p.a.pac * 0.034 : 4.4 + p.a.pac * 0.02;
    if (this.owner === p) s *= 0.86 + p.a.dri * 0.0012;
    if (p.shuffle) s = Math.min(s, 2.2 + p.a.gk * 0.015);
    return s * st;
  }

  say(text, sub = '', t = 2.2) { this.banner = { text, sub, t, max: t }; }
  event(type, data) { this.onEvent(type, data || {}); }
  addRating(v) { this.us.rt += v; }
  get rating() { return clamp(6.0 + this.us.rt, 3, 10); }

  // ---------- Saques / reanudaciones ----------
  kickoff(sideToKick) {
    for (const t of this.teams) {
      for (const p of this.active(t)) {
        let nx = Math.min(p.base.x * 0.62, 0.46);
        let ny = p.base.y;
        if (p.role === 'GK') nx = 0.03;
        p.x = this.wx(t, nx); p.y = this.wy(t, ny);
        p.vx = p.vy = 0; p.face = t.dir > 0 ? 0 : Math.PI;
        p.receive = null; p.run = 0; p.holding = false; p.stun = 0; p.slide = 0; p.dive = 0;
        if (t.side !== sideToKick) {
          const d = hyp(p.x - L / 2, p.y - W / 2);
          if (d < 9.6) {
            const k = 9.6 / (d || 1);
            p.x = L / 2 + (p.x - L / 2) * k; p.y = W / 2 + (p.y - W / 2) * k;
            if (Math.abs(p.x - L / 2) < 0.5) p.x = L / 2 - t.dir * 9.6;
          }
        }
      }
    }
    const t = this.teams[sideToKick];
    const st = this.active(t).find((p) => p.role === 'ST') || this.active(t)[9];
    const mate = this.active(t).find((p) => p.role === 'CM') || this.active(t)[6];
    st.x = L / 2 - t.dir * 0.4; st.y = W / 2;
    mate.x = L / 2 - t.dir * 6; mate.y = W / 2 + 4;
    this.setRestart('kickoff', t, L / 2, W / 2, st);
  }

  setRestart(type, team, x, y, taker) {
    const b = this.ball;
    b.x = x; b.y = y; b.z = 0; b.vx = b.vy = b.vz = 0;
    this.owner = null;
    this.pass = null;
    this.state = 'restart';
    const delay = { kickoff: 1.4, throw: 1.1, corner: 1.6, goalkick: 1.4, freekick: 1.6, penalty: 2.2 }[type] || 1.2;
    if (!taker) taker = this.pickTaker(type, team, x, y);
    this.rs = { type, team, x, y, taker, timer: delay, auto: 7 };
    // colocar al lanzador detrás del balón mirando al campo
    const gx = this.goalX(team);
    let fx = gx - x, fy = W / 2 - y;
    if (type === 'throw') { fx = 0; fy = y < W / 2 ? 1 : -1; }
    if (type === 'goalkick') { fx = team.dir; fy = 0; }
    const fa = Math.atan2(fy, fx);
    taker.x = x - Math.cos(fa) * 0.6; taker.y = y - Math.sin(fa) * 0.6;
    taker.vx = taker.vy = 0; taker.face = fa; taker.receive = null;
    this.owner = taker; taker.holding = true; taker.holdT = 99;
    this.lastTouch = taker;
    if (type === 'kickoff') return;
    // apartar rivales
    const minD = type === 'throw' ? 3 : 9.15;
    for (const p of this.active(this.opp(team))) {
      if (type === 'penalty' && p.role === 'GK') continue;
      const d = hyp(p.x - x, p.y - y);
      if (d < minD) {
        const k = minD / (d || 1);
        p.x = clamp(x + (p.x - x) * k + 0.1, 0.5, L - 0.5);
        p.y = clamp(y + (p.y - y) * k, 0.5, W - 0.5);
      }
    }
    if (type === 'penalty') {
      const def = this.opp(team);
      const gk = this.gk(def);
      gk.x = this.goalX(team) - team.dir * 0.3; gk.y = W / 2; gk.vx = gk.vy = 0;
      for (const p of [...this.active(team), ...this.active(def)]) {
        if (p === taker || p === gk) continue;
        if (this.inBox(def, p.x, p.y) || hyp(p.x - x, p.y - y) < 9.2) {
          p.x = this.goalX(team) - team.dir * (BOX_D + 1 + Math.random() * 3);
          p.y = W / 2 + rand(-16, 16);
        }
      }
    }
    if (type === 'goalkick') {
      for (const p of this.active(this.opp(team))) {
        if (this.inBox(team, p.x, p.y)) p.x = this.ownGoalX(team) + team.dir * (BOX_D + 1);
      }
    }
  }

  pickTaker(type, team, x, y) {
    const ps = this.active(team).filter((p) => p.role !== 'GK');
    if (type === 'goalkick') return this.gk(team);
    if (type === 'penalty') {
      if (this.user && this.user.team === team && !this.user.sentOff && !this.userAI &&
          ['ST', 'LW', 'RW', 'CM'].includes(this.user.role)) return this.user;
      return ps.slice().sort((a, b) => b.a.sho - a.a.sho)[0];
    }
    if (type === 'corner') {
      const cands = ps.filter((p) => ['LW', 'RW', 'CM'].includes(p.role));
      if (this.user && this.user.team === team && cands.includes(this.user) && !this.userAI) return this.user;
      return cands.sort((a, b) => b.a.pas - a.a.pas)[0] || ps[0];
    }
    let best = ps[0], bd = 1e9;
    for (const p of ps) {
      const d = hyp(p.x - x, p.y - y);
      if (d < bd) { bd = d; best = p; }
    }
    return best;
  }

  executeRestartAI() {
    const rs = this.rs, p = rs.taker, t = rs.team;
    this.state = 'play';
    p.holding = false;
    switch (rs.type) {
      case 'kickoff': {
        const mate = this.bestPassTarget(p, { back: true }) || this.active(t)[6];
        this.passTo(p, mate, 'ground');
        break;
      }
      case 'throw': {
        const q = this.bestPassTarget(p, { maxD: 22 });
        if (q) this.passTo(p, q, 'throw');
        else this.kickToward(p, p.x + t.dir * 12, p.y, 'throw');
        break;
      }
      case 'corner': this.aiCross(p); break;
      case 'goalkick': {
        const q = this.bestPassTarget(p, { minD: 12 });
        if (q && Math.random() < 0.45) this.passTo(p, q, 'ground');
        else {
          const mids = this.active(t).filter((m) => m.group !== 'DEF' && m.group !== 'GK');
          const m = mids[Math.floor(Math.random() * mids.length)];
          this.passTo(p, m, 'lob');
        }
        break;
      }
      case 'freekick': {
        const d = hyp(this.goalX(t) - rs.x, W / 2 - rs.y);
        if (d < 29 && Math.random() < 0.7) this.shoot(p, 0.85, null);
        else {
          const q = this.bestPassTarget(p, {});
          if (q) this.passTo(p, q, d < 40 ? 'lob' : 'ground');
          else this.kickToward(p, p.x + t.dir * 20, p.y, 'lob');
        }
        break;
      }
      case 'penalty': this.shoot(p, 0.8, Math.random() < 0.5 ? -0.8 : 0.8, true); break;
    }
    this.rs = null;
  }

  // ---------- Golpeos ----------
  kick(p, vx, vy, vz) {
    const b = this.ball;
    if (this.owner === p) {
      b.x = p.x + Math.cos(p.face) * 0.5; b.y = p.y + Math.sin(p.face) * 0.5;
    }
    this.owner = null;
    p.holding = false;
    b.vx = vx; b.vy = vy; b.vz = vz; b.z = Math.max(b.z, vz > 0 ? 0.05 : 0);
    b.spin = randn() * 0.5;
    b.kickT = this.time; b.kickTeam = p.team;
    p.cd = 0.32;
    this.lastTouch = p;
    this.event('kick', { power: hyp(vx, vy) });
  }

  // apunta al compañero con anticipación de su carrera
  leadTarget(from, q, kind) {
    let tx = q.x, ty = q.y;
    for (let i = 0; i < 2; i++) {
      const d = hyp(tx - from.x, ty - from.y);
      const tt = kind === 'lob' || kind === 'cross' ? clamp(0.5 + d * 0.035, 0.7, 2.2) : d / 13;
      tx = q.x + q.vx * tt * 0.85; ty = q.y + q.vy * tt * 0.85;
    }
    return { x: clamp(tx, 1, L - 1), y: clamp(ty, 1, W - 1) };
  }

  passTo(p, q, kind, target) {
    const tg = target || (kind === 'through' ? this.throughTarget(p, q) : this.leadTarget(p, q, kind));
    this.registerPass(p, q, kind);
    this.kickToward(p, tg.x, tg.y, kind);
    if (q && !q.isUser) q.receive = { x: tg.x, y: tg.y, t: 3 };
    else if (q && q.isUser && this.userAI) q.receive = { x: tg.x, y: tg.y, t: 3 };
  }

  throughTarget(p, q) {
    const t = p.team;
    const lead = this.leadTarget(p, q, 'ground');
    let ax = t.dir, ay = 0;
    if (q.vx * t.dir > 1) { const s = q.speed || 1; ax = (ax + q.vx / s) / 2; ay = q.vy / s / 2; }
    const ahead = 7 + Math.random() * 3;
    return { x: clamp(lead.x + ax * ahead, 2, L - 2), y: clamp(lead.y + ay * ahead, 2, W - 2) };
  }

  registerPass(p, q, kind) {
    const t = p.team;
    const line = this.offsideLine(t);
    const off = [];
    if (kind !== 'throw' && !(this.rs && (this.rs.type === 'corner' || this.rs.type === 'goalkick'))) {
      for (const m of this.active(t)) {
        if (m === p) continue;
        const mx = this.nx(t, m.x);
        if (mx > line + 0.004 && mx > 0.5) off.push(m);
      }
    }
    this.pass = { from: p, to: q, team: t, kind, off, time: this.time };
    t.stats.passes++;
    if (p.isUser) this.us.passes++;
  }

  kickToward(p, tx, ty, kind) {
    const b = this.ball;
    const pas = p.a.pas;
    const errK = (1.05 - pas / 100);
    let dx = tx - b.x, dy = ty - b.y;
    let d = hyp(dx, dy) || 1;
    let ang = Math.atan2(dy, dx) + randn() * errK * (kind === 'ground' || kind === 'throw' ? 0.07 : 0.1);
    d *= 1 + randn() * errK * 0.12;
    if (kind === 'ground' || kind === 'through') {
      const vr = kind === 'through' ? 3 : 4.5;
      const v0 = clamp(Math.sqrt(vr * vr + 2 * 5.4 * d), 6, 27);
      this.kick(p, Math.cos(ang) * v0, Math.sin(ang) * v0, 0);
    } else if (kind === 'throw') {
      const T = clamp(0.4 + d * 0.035, 0.5, 1.1);
      const vz = G * T / 2;
      const vh = d * 0.9 / T;
      this.kick(p, Math.cos(ang) * vh, Math.sin(ang) * vh, vz);
      this.ball.z = 1.8;
    } else {
      const T = clamp(0.55 + d * 0.034, 0.8, 2.3);
      const vz = G * T / 2;
      const vh = (d * 0.92) / T;
      this.kick(p, Math.cos(ang) * vh, Math.sin(ang) * vh, vz);
    }
  }

  shoot(p, power, aim, isPenalty = false) {
    const t = p.team, b = this.ball;
    const gx = this.goalX(t);
    const gk = this.gk(this.opp(t));
    if (aim == null) {
      const side = gk.y > W / 2 ? -1 : 1;
      aim = Math.random() < 0.72 ? side * rand(0.55, 0.95) : -side * rand(0.3, 0.8);
    }
    const sho = p.a.sho;
    let ty = W / 2 + clamp(aim, -1, 1) * (GOAL_HALF - 0.35);
    const dx = gx - b.x, dy0 = ty - b.y;
    const d = hyp(dx, dy0);
    const press = this.nearestOpp(p);
    const pressK = press && press.d < 1.8 ? 1.3 : 1;
    const err = (1.12 - sho / 100) * (0.55 + power * 0.8) * pressK * (isPenalty ? 0.6 : 1);
    ty += randn() * err * (0.5 + d / 10) * 1.25;
    const speed = 14 + power * 15 + sho * 0.05;
    const tt = d / (speed * 0.96);
    let z = 0.2 + power * 0.8 + Math.random() * 0.7 + randn() * err * (0.4 + d / 25);
    if (power > 0.85) z += (power - 0.85) * 9 * Math.random();
    z = Math.max(0.05, z);
    const vz = (z + 0.5 * G * tt * tt) / tt;
    const ang = Math.atan2(ty - b.y, dx);
    this.kick(p, Math.cos(ang) * speed, Math.sin(ang) * speed, vz);
    this.pass = null;
    this.shot = { by: p, team: t, time: this.time, resolved: false };
    t.stats.shots++;
    if (p.isUser) { this.us.shots++; this.addRating(0.05); }
    this.event('shot', { power });
  }

  header(p, toGoal) {
    const t = p.team, b = this.ball;
    if (toGoal) {
      const gx = this.goalX(t);
      const ty = W / 2 + rand(-1, 1) * (GOAL_HALF - 0.4) + randn() * (1.1 - (p.a.sho + p.a.phy) / 200) * 2.5;
      const ang = Math.atan2(ty - b.y, gx - b.x);
      const sp = 13 + p.a.phy * 0.06;
      this.kick(p, Math.cos(ang) * sp, Math.sin(ang) * sp, -1 + Math.random() * 2.5);
      this.shot = { by: p, team: t, time: this.time, resolved: false, header: true };
      t.stats.shots++;
      if (p.isUser) { this.us.shots++; this.addRating(0.05); }
    } else {
      // despeje / pase de cabeza hacia delante
      const ang = (t.dir > 0 ? 0 : Math.PI) + randn() * 0.6;
      this.kick(p, Math.cos(ang) * 12, Math.sin(ang) * 12, 4);
    }
    p.cd = 0.4;
    this.event('kick', { power: 10 });
  }

  nearestOpp(p) {
    let best = null, bd = 1e9;
    for (const o of this.active(this.opp(p.team))) {
      const d = hyp(o.x - p.x, o.y - p.y);
      if (d < bd) { bd = d; best = o; }
    }
    return best ? { p: best, d: bd } : null;
  }

  // ---------- Posesión ----------
  setOwner(p, viaTackle = false) {
    const prev = this.lastTouch;
    const pass = this.pass;
    this.pass = null;
    if (this.shot && !this.shot.resolved) {
      this.shot.resolved = true;
      if (p.role === 'GK' && p.team !== this.shot.team) {
        this.shot.team.stats.onTarget++;
        if (this.shot.by.isUser) { this.us.onTarget++; this.addRating(0.12); }
      }
    }
    if (pass) {
      if (p.team === pass.team && p !== pass.from) {
        if (pass.off.includes(p)) {
          this.offside(p);
          return;
        }
        pass.team.stats.passOk++;
        p.assistFrom = pass.from; p.assistT = this.time;
        if (pass.from.isUser) {
          this.us.passOk++;
          const fwd = (this.nx(p.team, p.x) - this.nx(p.team, pass.from.x));
          this.addRating(0.025 + Math.max(0, fwd) * 0.12);
        }
      } else if (p.team !== pass.team) {
        if (pass.from.isUser) this.addRating(-0.07);
        if (p.isUser) { this.us.intercepts++; this.addRating(0.1); }
      }
    } else if (!viaTackle && prev && prev.team !== p.team && p.isUser && prev !== p) {
      this.us.intercepts++; this.addRating(0.05);
    }
    if (prev && prev.team !== p.team) {
      for (const q of prev.team.players) { q.receive = null; q.run = 0; }
    }
    this.owner = p;
    this.lastTouch = p;
    p.receive = null;
    p.run = 0;
    p.decideT = 0.18 + Math.random() * 0.2;
    p.gotBallT = this.time;
    p.dribDir = null;
    if (p.isUser) this.userCall = 0;
    this.event('touch');
  }

  offside(p) {
    const t = this.opp(p.team);
    if (p.isUser) { this.us.offsides++; this.addRating(-0.08); }
    this.say('FUERA DE JUEGO', p.name);
    this.event('whistle');
    this.setRestart('freekick', t, clamp(p.x, 1, L - 1), clamp(p.y, 1, W - 1));
  }

  foul(by, victim, x, y) {
    by.team.stats.fouls++;
    if (by.isUser) { this.us.fouls++; this.addRating(-0.1); }
    let card = '';
    const yellowP = by.slide > 0 ? 0.35 : 0.14;
    if (Math.random() < yellowP) {
      by.yellow++;
      card = by.yellow >= 2 ? ' · ROJA' : ' · Amarilla';
      if (by.isUser) { this.us.yellow++; this.addRating(-0.3); }
      if (by.yellow >= 2) this.sendOff(by);
    }
    const vt = victim.team;
    this.event('whistle');
    if (this.inBox(by.team, x, y)) {
      this.say('¡PENALTI!', `Falta de ${by.name}${card}`, 2.5);
      const px = this.ownGoalX(by.team) + by.team.dir * 11;
      this.setRestart('penalty', vt, px, W / 2);
    } else {
      this.say('FALTA', `${by.name}${card}`);
      this.setRestart('freekick', vt, clamp(x, 1, L - 1), clamp(y, 1, W - 1));
    }
  }

  sendOff(p) {
    p.sentOff = true;
    p.x = L / 2; p.y = -6; p.vx = p.vy = 0;
    if (this.owner === p) this.owner = null;
    if (p.isUser) { this.us.red = true; this.addRating(-1.2); this.userAI = true; }
  }

  // ---------- Bucle principal ----------
  step(dt, input) {
    if (this.finished) return;
    this.time += dt;
    if (this.banner) { this.banner.t -= dt; if (this.banner.t <= 0) this.banner = null; }
    this.userCall = Math.max(0, this.userCall - dt);
    this.pressCall = Math.max(0, this.pressCall - dt);

    if (this.state === 'goal') {
      this.timer -= dt;
      this.updateBall(dt);
      this.updatePlayers(dt, null, true);
      if (this.timer <= 0) this.kickoff(this.rs.concede);
      return;
    }
    if (this.state === 'halftime') {
      this.timer -= dt;
      if (this.timer <= 0) {
        this.half = 2;
        for (const t of this.teams) t.dir = -t.dir;
        for (const t of this.teams) for (const p of t.players) p.stamina = Math.min(1, p.stamina + 0.35);
        this.kickoff(1);
      }
      return;
    }

    this.minute += dt * this.rate;
    const b = this.ball;
    const ballCalm = this.owner || hyp(b.vx, b.vy) < 12;
    if (this.half === 1 && this.minute >= 45 && ballCalm && this.state === 'play') {
      this.minute = 45;
      this.state = 'halftime'; this.timer = 2.5;
      this.say('DESCANSO', `${this.teams[0].short} ${this.teams[0].score} - ${this.teams[1].score} ${this.teams[1].short}`, 2.5);
      this.event('whistle', { long: true });
      return;
    }
    if (this.minute >= 90 && ballCalm && this.state === 'play') {
      this.minute = 90;
      this.endMatch();
      return;
    }

    if (this.owner) this.owner.team.stats.poss += dt;

    // Saque pendiente
    if (this.state === 'restart') {
      const rs = this.rs;
      rs.timer -= dt;
      const userTaker = rs.taker.isUser && !this.userAI;
      if (userTaker) {
        rs.auto -= dt;
        if (rs.auto <= 0) this.executeRestartAI();
      } else if (rs.timer <= 0) this.executeRestartAI();
    }

    this.computeChasers();
    this.updatePlayers(dt, input, false);
    this.updateBall(dt);
    if (this.state === 'play') this.checkPossession();
    this.separate();
  }

  endMatch() {
    this.state = 'fulltime';
    this.finished = true;
    if (this.user) {
      const ut = this.user.team, ot = this.opp(ut);
      const diff = ut.score - ot.score;
      this.addRating(diff > 0 ? 0.3 : diff < 0 ? -0.25 : 0);
      if (['CB', 'LB', 'RB', 'CDM'].includes(this.user.role)) {
        this.addRating(ot.score === 0 ? 0.5 : -0.15 * ot.score);
      }
    }
    this.say('FINAL DEL PARTIDO', `${this.teams[0].short} ${this.teams[0].score} - ${this.teams[1].score} ${this.teams[1].short}`, 99);
    this.event('whistle', { long: true, final: true });
  }

  // ---------- Balón ----------
  updateBall(dt) {
    const b = this.ball;
    if (this.owner) {
      const p = this.owner;
      const d = 0.5 + Math.min(p.speed, 8) * 0.035;
      b.x = p.x + Math.cos(p.face) * d;
      b.y = p.y + Math.sin(p.face) * d;
      b.z = p.holding && p.role === 'GK' && this.state === 'play' ? 1.0 : 0;
      b.vx = p.vx; b.vy = p.vy; b.vz = 0;
      return;
    }
    const sp = hyp(b.vx, b.vy, b.vz);
    const n = Math.max(1, Math.ceil((sp * dt) / 0.12));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      const px = b.x, py = b.y, pz = b.z;
      if (b.z > 0 || b.vz > 0) {
        b.vz -= G * h;
        const k = 1 - 0.06 * h;
        b.vx *= k; b.vy *= k;
        // efecto leve
        const s = b.spin * h;
        const vx = b.vx; b.vx -= b.vy * s * 0.05; b.vy += vx * s * 0.05;
      } else {
        const s = hyp(b.vx, b.vy);
        if (s > 0) {
          const ns = Math.max(0, s - (4.2 + 0.12 * s) * h);
          b.vx *= ns / s; b.vy *= ns / s;
        }
      }
      b.x += b.vx * h; b.y += b.vy * h; b.z += b.vz * h;
      if (b.z < 0) {
        b.z = 0;
        if (b.vz < -1.6) { b.vz = -b.vz * 0.48; b.vx *= 0.82; b.vy *= 0.82; this.event('bounce'); }
        else b.vz = 0;
      }
      if (this.state === 'goal') {
        // dentro de la red
        if (b.x < -1.9 || b.x > L + 1.9) { b.vx *= -0.2; b.x = clamp(b.x, -1.9, L + 1.9); }
        if (Math.abs(b.y - W / 2) > GOAL_HALF - 0.1 && (b.x < 0 || b.x > L)) { b.vy *= -0.2; b.y = clamp(b.y, W / 2 - GOAL_HALF + 0.1, W / 2 + GOAL_HALF - 0.1); }
        if (b.z > GOAL_H - 0.1 && (b.x < 0 || b.x > L)) { b.vz = -Math.abs(b.vz) * 0.2; }
        continue;
      }
      // líneas de gol: palos, larguero, gol
      for (const gx of [0, L]) {
        const crossed = (px - gx) * (b.x - gx) <= 0 && px !== b.x;
        if (!crossed) continue;
        const dyc = Math.abs(b.y - W / 2);
        if (Math.abs(dyc - GOAL_HALF) < 0.17 && b.z < GOAL_H + 0.1) {
          b.x = px; b.vx = -b.vx * 0.55; b.vy += (b.y > W / 2 ? 1 : -1) * (dyc > GOAL_HALF ? 1 : -1) * 2;
          this.say('¡AL PALO!', '', 1.4); this.event('post');
          continue;
        }
        if (dyc < GOAL_HALF && Math.abs(b.z - GOAL_H) < 0.16) {
          b.x = px; b.vx = -b.vx * 0.5; b.vz = -Math.abs(b.vz) * 0.5;
          this.say('¡LARGUERO!', '', 1.4); this.event('post');
          continue;
        }
        if (dyc < GOAL_HALF - BALL_R && b.z < GOAL_H) {
          this.goal(gx === 0 ? (this.teams[0].dir < 0 ? 0 : 1) : (this.teams[0].dir > 0 ? 0 : 1));
          return;
        }
      }
      void pz;
    }
    if (this.state !== 'play') {
      b.x = clamp(b.x, -1, L + 1); b.y = clamp(b.y, -1, W + 1);
      return;
    }
    // fuera
    if (b.y < -BALL_R || b.y > W + BALL_R) {
      const t = this.opp(this.lastTouch ? this.lastTouch.team : this.teams[0]);
      this.resolveShotOut();
      this.setRestart('throw', t, clamp(b.x, 1, L - 1), b.y < 0 ? 0 : W);
      return;
    }
    if (b.x < -BALL_R || b.x > L + BALL_R) {
      const gx = b.x < 0 ? 0 : L;
      const defTeam = this.teams.find((t) => this.ownGoalX(t) === gx);
      const att = this.opp(defTeam);
      const lt = this.lastTouch ? this.lastTouch.team : att;
      this.resolveShotOut();
      if (lt === defTeam) {
        att.stats.corners++;
        this.say('CÓRNER', att.short, 1.3);
        this.setRestart('corner', att, gx === 0 ? 0.3 : L - 0.3, b.y < W / 2 ? 0.3 : W - 0.3);
      } else {
        this.setRestart('goalkick', defTeam, gx === 0 ? 5.5 : L - 5.5, W / 2 + (b.y < W / 2 ? -5 : 5));
      }
    }
  }

  resolveShotOut() {
    if (this.shot && !this.shot.resolved) this.shot.resolved = true;
  }

  goal(sideScoring) {
    const t = this.teams[sideScoring];
    t.score++;
    const scorer = this.lastTouch;
    const own = scorer && scorer.team !== t;
    let assist = null;
    if (!own && scorer && scorer.assistFrom && scorer.assistFrom.team === t && this.time - scorer.assistT < 14 && scorer.assistFrom !== scorer) assist = scorer.assistFrom;
    if (this.shot && !this.shot.resolved) {
      this.shot.resolved = true;
      this.shot.team.stats.onTarget++;
      if (this.shot.by.isUser) this.us.onTarget++;
    }
    const minute = Math.max(1, Math.ceil(this.minute));
    this.events.push({ type: 'goal', side: sideScoring, minute, scorer: scorer ? scorer.name : '?', own, assist: assist ? assist.name : null, user: scorer && scorer.isUser && !own });
    if (scorer && scorer.isUser && !own) { this.us.goals++; this.addRating(1.1); }
    if (assist && assist.isUser) { this.us.assists++; this.addRating(0.65); this.us.keyPasses++; }
    if (own && scorer.isUser) this.addRating(-0.6);
    if (this.user && this.user.team === t && !(scorer && scorer.isUser)) this.addRating(0.08);
    this.say(own ? 'GOL EN PROPIA' : '¡GOOOOL!', `${scorer ? scorer.name : ''}${assist ? ' (asist. ' + assist.name + ')' : ''} · ${minute}'`, 3);
    this.state = 'goal';
    this.timer = 3.2;
    this.owner = null;
    this.rs = { concede: 1 - sideScoring };
    this.event('goal', { user: scorer && scorer.isUser && !own, side: sideScoring });
  }

  // ---------- Posesión de balón suelto ----------
  checkPossession() {
    if (this.owner) return;
    const b = this.ball;
    let best = null, bd = 1e9;
    for (const t of this.teams) {
      for (const p of t.players) {
        if (p.sentOff || p.cd > 0 || p.stun > 0) continue;
        if (b.kickTeam && b.kickTeam !== t && this.time - b.kickT < 0.14) continue;
        const d = hyp(p.x - b.x, p.y - b.y);
        const isGK = p.role === 'GK' && this.inBox(t, p.x, p.y);
        let reach = 0.75 + (p.slide > 0 ? 0.35 : 0);
        let zMax = 1.0;
        if (isGK) { reach = p.dive > 0 ? 0.85 + p.a.gk * 0.004 : 0.85; zMax = 2.7; }
        if (b.z > zMax) {
          // cabezazo
          if (b.z < 2.6 && d < 1.0 && !isGK && this.tryHeader(p)) return;
          continue;
        }
        if (d < reach && d < bd) { bd = d; best = p; }
      }
    }
    if (!best) return;
    const p = best;
    const sp = hyp(b.vx, b.vy);
    const isGK = p.role === 'GK' && this.inBox(p.team, p.x, p.y);
    if (p.slide > 0) {
      // entrada al balón suelto: lo desvía
      const a = p.face;
      this.kick(p, Math.cos(a) * 7, Math.sin(a) * 7, 0.5);
      p.slideTouched = true;
      return;
    }
    if (isGK && this.shot && !this.shot.resolved && this.shot.team !== p.team) {
      const catchP = clamp(0.78 - (sp - 14) * 0.035 + (p.a.gk - 70) * 0.012 - (p.dive > 0 ? 0.2 : 0), 0.2, 0.95);
      if (Math.random() > catchP) {
        // despeje / rechace
        const out = -Math.sign(b.vx);
        this.shot.resolved = true;
        this.shot.team.stats.onTarget++;
        if (this.shot.by.isUser) { this.us.onTarget++; this.addRating(0.12); }
        b.vx = out * rand(3, 8); b.vy = (Math.random() < 0.5 ? -1 : 1) * rand(4, 10); b.vz = rand(1, 4);
        p.cd = 0.6;
        this.lastTouch = p;
        this.say('¡PARADÓN!', p.name, 1.3);
        this.event('save');
        return;
      }
      this.setOwner(p);
      p.holding = true; p.holdT = 1.2 + Math.random();
      this.say('PARADA', p.name, 1.2);
      this.event('save');
      return;
    }
    if (isGK && (!this.lastTouch || this.lastTouch.team !== p.team || b.z > 0.5)) {
      this.setOwner(p);
      p.holding = true; p.holdT = 1.0 + Math.random();
      return;
    }
    // control difícil si el balón viene fuerte
    if (sp > 13 || b.z > 0.6) {
      const ctrl = clamp(1 - (sp - 13) * 0.05 - b.z * 0.15 + (p.a.dri - 60) * 0.01, 0.25, 1);
      if (Math.random() > ctrl) {
        const a = Math.random() * Math.PI * 2;
        b.vx = b.vx * 0.25 + Math.cos(a) * 3; b.vy = b.vy * 0.25 + Math.sin(a) * 3; b.vz = Math.max(0, b.vz * 0.3);
        p.cd = 0.3;
        this.lastTouch = p;
        if (this.shot && !this.shot.resolved) this.shot.resolved = true;
        return;
      }
    }
    this.setOwner(p);
    if (p.isUser && !this.userAI) this.userBufferedAction(p);
  }

  tryHeader(p) {
    if (p.cd > 0) return false;
    const t = p.team;
    const attBox = this.inBox(this.opp(t), p.x, p.y);
    if (p.isUser && !this.userAI) {
      if (p.shootBuf > 0) { p.shootBuf = 0; this.header(p, true); return true; }
      if (p.passBuf > 0) { p.passBuf = 0; this.header(p, false); return true; }
      return false;
    }
    const ourPass = this.pass && this.pass.team === t;
    if (attBox && ourPass) { this.header(p, true); return true; }
    if (ourPass) return false; // dejarla caer y controlar
    if (this.inBox(t, p.x, p.y) || Math.random() < 0.02) { this.header(p, false); return true; }
    return false;
  }

  userBufferedAction(p) {
    if (p.shootBuf > 0) {
      p.shootBuf = 0;
      const inp = this.lastInput || {};
      this.shoot(p, 0.72, Math.abs(inp.my || 0) > 0.3 ? inp.my : null);
    } else if (p.passBuf > 0) {
      p.passBuf = 0;
      this.userPass(p, 'ground', this.lastInput || {});
    }
  }

  separate() {
    const all = [];
    for (const t of this.teams) for (const p of t.players) if (!p.sentOff) all.push(p);
    for (let i = 0; i < all.length; i++) {
      for (let j = i + 1; j < all.length; j++) {
        const a = all[i], c = all[j];
        const dx = c.x - a.x, dy = c.y - a.y;
        const d = hyp(dx, dy);
        if (d < 0.75 && d > 0.0001) {
          const push = (0.75 - d) / 2;
          const ux = dx / d, uy = dy / d;
          const ka = a.holding ? 0 : 1, kc = c.holding ? 0 : 1;
          a.x -= ux * push * ka; a.y -= uy * push * ka;
          c.x += ux * push * kc; c.y += uy * push * kc;
        }
      }
    }
  }

  // ---------- IA ----------
  predictBall(tAhead) {
    const b = this.ball;
    if (this.owner) return { x: this.owner.x + this.owner.vx * tAhead, y: this.owner.y + this.owner.vy * tAhead, z: 0 };
    const s = hyp(b.vx, b.vy);
    if (s < 0.01 && b.z <= 0.01 && b.vz <= 0) return { x: b.x, y: b.y, z: 0 };
    const ux = s > 0.01 ? b.vx / s : 0, uy = s > 0.01 ? b.vy / s : 0;
    const roll = (s0, t) => {
      const a = 5.2;
      const tt = Math.min(t, s0 / a);
      return s0 * tt - 0.5 * a * tt * tt;
    };
    let d, z = 0;
    if (b.z > 0.05 || b.vz > 0) {
      const tl = (b.vz + Math.sqrt(b.vz * b.vz + 2 * G * b.z)) / G;
      if (tAhead <= tl) { d = s * tAhead * 0.97; z = b.z + b.vz * tAhead - 0.5 * G * tAhead * tAhead; }
      else d = s * tl * 0.97 + roll(s * 0.75, tAhead - tl);
    } else d = roll(s, tAhead);
    return { x: b.x + ux * d, y: b.y + uy * d, z };
  }

  interceptPoint(p) {
    const sp = this.maxSpeed(p, true);
    for (let t = 0.1; t <= 2.6; t += 0.1) {
      const q = this.predictBall(t);
      if (q.z > 1.0) continue;
      if (hyp(q.x - p.x, q.y - p.y) <= sp * t + 0.4) return { x: q.x, y: q.y, t };
    }
    const q = this.predictBall(2.6);
    return { x: q.x, y: q.y, t: 2.6 + hyp(q.x - p.x, q.y - p.y) / sp };
  }

  computeChasers() {
    this.chaser = [null, null];
    this.chaseT = [99, 99];
    this.userChaseT = 99;
    if (this.owner || this.state !== 'play') return;
    for (const t of this.teams) {
      let best = null, bt = 1e9;
      for (const p of this.active(t)) {
        if (p.role === 'GK') continue;
        const ip = this.interceptPoint(p);
        let tt = ip.t;
        if (this.pass && this.pass.to === p) tt -= 0.6;
        if (p.isUser && !this.userAI) { this.userChaseT = tt; continue; }
        if (tt < bt) { bt = tt; best = p; }
      }
      // si el usuario llega claramente antes, la IA de su equipo no va a por ella
      if (this.user && !this.userAI && this.user.team === t && this.userChaseT < bt - 0.35) best = null;
      this.chaser[t.side] = best;
      this.chaseT[t.side] = bt;
    }
  }

  updatePlayers(dt, input, frozen) {
    this.lastInput = input || this.lastInput;
    const owner0 = this.owner;
    const ownerTeam = owner0 ? owner0.team : null;
    for (const t of this.teams) {
      // presión: el más cercano al poseedor rival
      let presser = null, presser2 = null;
      if (ownerTeam && ownerTeam !== t && this.state === 'play') {
        const o = owner0;
        const cands = this.active(t).filter((p) => p.role !== 'GK' && !(p.isUser && !this.userAI))
          .map((p) => ({ p, d: hyp(p.x - o.x, p.y - o.y) })).sort((a, b) => a.d - b.d);
        presser = cands[0] ? cands[0].p : null;
        presser2 = cands[1] ? cands[1].p : null;
        if (this.user && !this.userAI && this.user.team === t) {
          const ud = hyp(this.user.x - o.x, this.user.y - o.y);
          if (cands[0] && ud < cands[0].d - 1.5 && this.pressCall <= 0) { presser2 = presser; presser = null; }
        }
      }
      for (const p of t.players) {
        if (p.sentOff) continue;
        p.cd = Math.max(0, p.cd - dt);
        p.stun = Math.max(0, p.stun - dt);
        p.tackleCd = Math.max(0, p.tackleCd - dt);
        p.shootBuf = Math.max(0, (p.shootBuf || 0) - dt);
        p.passBuf = Math.max(0, (p.passBuf || 0) - dt);
        if (p.receive) { p.receive.t -= dt; if (p.receive.t <= 0) p.receive = null; }
        if (p.run > 0) p.run -= dt;

        let target = null, sprint = false, desired = null;
        if (frozen) {
          // celebración: los jugadores se frenan
          target = { x: p.x, y: p.y };
        } else if (p.slide > 0) {
          this.updateSlide(p, dt);
          this.integrate(p, dt, null, false, true);
          continue;
        } else if (p.dive > 0) {
          p.dive -= dt;
          this.integrate(p, dt, null, false, true);
          continue;
        } else if (p.stun > 0) {
          target = { x: p.x + p.vx * 0.1, y: p.y + p.vy * 0.1 };
        } else if (p.isUser && !this.userAI && input) {
          desired = this.userControl(p, input, dt);
          sprint = !!input.sprint;
        } else if (p.holding && this.owner === p) {
          if (p.role === 'GK' && this.state === 'play') this.gkDistribute(p, dt);
          target = { x: p.x, y: p.y };
        } else if (p.role === 'GK') {
          ({ target, sprint } = this.gkThink(p, dt));
        } else if (this.owner === p) {
          ({ target, sprint } = this.ownerThink(p, dt));
        } else {
          ({ target, sprint } = this.offBall(p, presser, presser2, dt));
        }
        this.integrate(p, dt, target, sprint, false, desired);
      }
    }
  }

  integrate(p, dt, target, sprint, free, desired) {
    if (!free) {
      let dvx = 0, dvy = 0;
      if (desired) { dvx = desired.x; dvy = desired.y; }
      else if (target) {
        const dx = target.x - p.x, dy = target.y - p.y;
        const d = hyp(dx, dy);
        if (d > 0.15) {
          const max = this.maxSpeed(p, sprint);
          const s = Math.min(max, d * 2.0);
          dvx = (dx / d) * s; dvy = (dy / d) * s;
        }
      }
      if (p.holding) { dvx = 0; dvy = 0; }
      const acc = (this.owner === p ? 9 + p.a.dri * 0.06 : 11 + p.a.pac * 0.07) * dt;
      let ex = dvx - p.vx, ey = dvy - p.vy;
      const e = hyp(ex, ey);
      if (e > acc) { ex *= acc / e; ey *= acc / e; }
      p.vx += ex; p.vy += ey;
      const sp = p.speed;
      if (sp > 0.4) {
        const ta = Math.atan2(p.vy, p.vx);
        const rate = (this.owner === p ? 6 + p.a.dri * 0.07 : 12) * dt;
        const da = angDiff(p.face, ta);
        p.face += clamp(da, -rate, rate);
      } else if (!p.holding || (p.isUser && !this.userAI)) {
        // mirar al balón cuando está quieto
        const b = this.ball;
        if (this.owner !== p) {
          const ta = Math.atan2(b.y - p.y, b.x - p.x);
          p.face += clamp(angDiff(p.face, ta), -6 * dt, 6 * dt);
        }
      }
      // energía
      if (sprint && sp > 5.5) p.stamina -= dt * 0.02 * (1.45 - p.a.phy / 100) * (p.isUser ? 1 : 0.5);
      else p.stamina += dt * 0.012;
      p.stamina = clamp(p.stamina, 0.25, 1);
    } else {
      const k = 1 - 2.2 * dt;
      p.vx *= k; p.vy *= k;
    }
    p.x += p.vx * dt; p.y += p.vy * dt;
    p.x = clamp(p.x, -3, L + 3); p.y = clamp(p.y, -3, W + 3);
    p.phase += p.speed * dt * 1.6;
  }

  updateSlide(p, dt) {
    p.slide -= dt;
    const b = this.ball;
    const o = this.owner;
    if (o && o.team !== p.team && !o.holding) {
      const db = hyp(b.x - p.x, b.y - p.y);
      const dp = hyp(o.x - p.x, o.y - p.y);
      if (db < 1.15 && !p.slideTouched) {
        // gana el balón
        p.slideTouched = true;
        const chance = clamp(0.7 + (p.a.def - o.a.dri) * 0.01, 0.35, 0.95);
        if (Math.random() < chance) {
          o.stun = 0.8;
          this.kick(p, Math.cos(p.face) * 7 + o.vx * 0.3, Math.sin(p.face) * 7 + o.vy * 0.3, 0.4);
          if (p.isUser) { this.us.tackles++; this.us.tacklesTry++; this.addRating(0.15); }
          if (o.isUser) { this.us.lost++; this.addRating(-0.05); }
          this.event('tackle');
          return;
        }
      }
      if (dp < 0.8 && !p.slideTouched) {
        p.slideTouched = true;
        // derriba sin tocar balón: falta (más probable desde atrás)
        const behind = Math.cos(angDiff(o.face, p.face)) > 0.3;
        if (Math.random() < (behind ? 0.85 : 0.55)) {
          if (p.isUser) this.us.tacklesTry++;
          o.stun = 0.9;
          this.foul(p, o, o.x, o.y);
          p.slide = 0;
          return;
        }
      }
    }
    if (p.slide <= 0) { p.stun = 0.7; p.slideTouched = false; }
  }

  startSlide(p) {
    p.slide = 0.55;
    p.slideTouched = false;
    const s = Math.max(p.speed, 5) + 3.5;
    p.vx = Math.cos(p.face) * s; p.vy = Math.sin(p.face) * s;
    this.event('slide');
  }

  tryTackle(p, o, isUser) {
    if (p.tackleCd > 0 || o.holding) return;
    p.tackleCd = 0.8;
    const d = hyp(p.x - o.x, p.y - o.y);
    if (d > 1.9) return;
    let chance = clamp(0.45 + (p.a.def - o.a.dri) * 0.012 + (isUser ? 0.08 : 0) + (o.isUser && !this.userAI ? -0.1 : 0) - (d - 1) * 0.15, 0.1, 0.85);
    if (isUser) this.us.tacklesTry++;
    if (Math.random() < chance) {
      o.stun = 0.45;
      if (Math.random() < 0.55) {
        this.owner = null;
        this.setOwner(p, true);
      } else {
        const a = Math.atan2(o.y - p.y, o.x - p.x) + randn() * 0.8;
        this.kick(p, Math.cos(a) * 4, Math.sin(a) * 4, 0);
        p.cd = 0.1;
      }
      if (isUser) { this.us.tackles++; this.addRating(0.12); }
      if (o.isUser) { this.us.lost++; this.addRating(-0.06); }
      this.event('tackle');
    } else {
      p.stun = 0.55;
      if (o.isUser && !this.userAI) { this.us.dribbles++; this.addRating(0.04); }
      if (Math.random() < (isUser ? 0.12 : 0.07)) { o.stun = 0.8; this.foul(p, o, o.x, o.y); }
    }
  }

  // ----- Portero -----
  gkThink(p, dt) {
    const t = p.team, b = this.ball;
    const gx = this.ownGoalX(t);
    const sgn = t.dir; // hacia el campo
    // tiro entrante
    const react = 0.3 - p.a.gk * 0.0018;
    if (!this.owner && this.shot && !this.shot.resolved && this.time - this.shot.time < react) {
      return { target: { x: p.x, y: p.y }, sprint: false };
    }
    if (!this.owner && Math.abs(b.vx) > 4 && Math.sign(gx - b.x) === Math.sign(b.vx)) {
      const tc = (gx - b.x) / b.vx;
      const yc = b.y + b.vy * tc;
      if (tc > 0 && tc < 1.8 && Math.abs(yc - W / 2) < GOAL_HALF + 1.2) {
        const tx = gx + sgn * 0.7, ty = clamp(yc, W / 2 - GOAL_HALF, W / 2 + GOAL_HALF);
        const d = hyp(tx - p.x, ty - p.y);
        if (d > 1.1 && tc < 0.75 && p.dive <= 0 && p.stun <= 0) {
          const reacts = Math.random() < 0.2 + p.a.gk * 0.0065;
          if (reacts) {
            p.dive = 0.65;
            const s = Math.min(3.2 + p.a.gk * 0.03, d / Math.max(tc, 0.2) * 1.1);
            p.vx = ((tx - p.x) / d) * s; p.vy = ((ty - p.y) / d) * s;
            this.event('dive');
          }
        }
        p.shuffle = true;
        return { target: { x: tx, y: ty }, sprint: false };
      }
    }
    p.shuffle = false;
    // balón suelto cerca en el área: salir
    if (!this.owner && this.inBox(t, b.x, b.y) && b.z < 2.2) {
      const oc = this.chaser[1 - t.side];
      const myT = this.interceptPoint(p);
      const oT = oc ? this.chaseT[1 - t.side] : 99;
      if (myT.t < oT + 0.2 || hyp(b.x - gx, b.y - W / 2) < 8) return { target: { x: myT.x, y: myT.y }, sprint: true };
    }
    // delantero rival solo: achicar
    if (this.owner && this.owner.team !== t) {
      const o = this.owner;
      const d = hyp(o.x - p.x, o.y - p.y);
      if (this.inBox(t, o.x, o.y) && d < 9) {
        if (d < 1.6) this.tryTackleGK(p, o);
        return { target: { x: o.x, y: o.y }, sprint: true };
      }
    }
    // posición en la bisectriz
    const bx = b.x, by = b.y;
    const db = hyp(bx - gx, by - W / 2);
    const k = clamp(db * 0.09, 0.6, 5.5);
    const ux = (bx - gx) / (db || 1), uy = (by - W / 2) / (db || 1);
    void dt;
    return { target: { x: gx + ux * k, y: W / 2 + uy * k * 0.8 }, sprint: false };
  }

  tryTackleGK(p, o) {
    if (p.tackleCd > 0) return;
    p.tackleCd = 0.7;
    const chance = clamp(0.35 + (p.a.gk - o.a.dri) * 0.012, 0.15, 0.7);
    if (Math.random() < chance) {
      o.stun = 0.5;
      this.owner = null;
      this.setOwner(p);
      p.holding = true; p.holdT = 1.3;
      this.say('¡SALIDA DEL PORTERO!', p.name, 1.2);
      if (o.isUser) { this.us.lost++; this.addRating(-0.05); }
    } else {
      p.stun = 0.6;
      if (Math.random() < 0.15) this.foul(p, o, o.x, o.y);
    }
  }

  gkDistribute(p, dt) {
    p.holdT -= dt;
    if (p.holdT > 0) return;
    p.holding = false;
    const t = p.team;
    const q = this.bestPassTarget(p, { minD: 8 });
    if (q && Math.random() < 0.6) this.passTo(p, q, 'ground');
    else {
      const mids = this.active(t).filter((m) => m.group === 'MID' || m.group === 'FWD');
      this.passTo(p, mids[Math.floor(Math.random() * mids.length)], 'lob');
    }
  }

  // ----- Con balón -----
  bestPassTarget(p, opt = {}) {
    const t = p.team;
    let best = null, bs = -1e9;
    for (const q of this.active(t)) {
      if (q === p) continue;
      if (q.role === 'GK' && !opt.back) continue;
      const d = hyp(q.x - p.x, q.y - p.y);
      if (d < (opt.minD ?? 4) || d > (opt.maxD ?? 45)) continue;
      const prog = this.nx(t, q.x) - this.nx(t, p.x);
      if (opt.back && prog > 0.02) continue;
      const lane = this.laneSafety(p, q.x, q.y, t);
      const space = this.spaceAt(q.x, q.y, t);
      const s = lane * 0.8 + space * 0.5 + (opt.back ? -prog : prog) * 0.5 - d / 70 + Math.random() * 0.2;
      if (s > bs) { bs = s; best = q; }
    }
    return best;
  }

  // 0..1: probabilidad aproximada de que el pase llegue sin que lo corte un rival
  laneSafety(p, tx, ty, t, kind = 'ground') {
    const dx = tx - p.x, dy = ty - p.y;
    const d = hyp(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const lob = kind === 'lob' || kind === 'cross';
    const flight = clamp(0.55 + d * 0.034, 0.8, 2.3);
    let m = 1;
    for (const o of this.active(this.opp(t))) {
      let tb, sd;
      if (lob) {
        sd = hyp(o.x - tx, o.y - ty);
        tb = flight;
      } else {
        const proj = clamp((o.x - p.x) * ux + (o.y - p.y) * uy, 0, d);
        const cx = p.x + ux * proj, cy = p.y + uy * proj;
        sd = hyp(o.x - cx, o.y - cy);
        tb = proj / 13;
      }
      const to = Math.max(0, sd - 0.8) / 6.2 + 0.22;
      const margin = to - tb;
      m = Math.min(m, clamp((margin + 0.05) / 0.5, 0, 1));
    }
    return m;
  }

  spaceAt(x, y, t) {
    let m = 99;
    for (const o of this.active(this.opp(t))) m = Math.min(m, hyp(o.x - x, o.y - y));
    return clamp(m / 7, 0, 1);
  }

  ownerThink(p, dt) {
    const t = p.team;
    const gx = this.goalX(t), gy = W / 2;
    p.decideT -= dt;
    // posible entrada del rival sobre mí lo gestiona offBall del rival
    if (p.decideT > 0 && p.dribDir) {
      return { target: { x: p.x + p.dribDir.x * 4, y: p.y + p.dribDir.y * 4 }, sprint: p.dribSprint };
    }
    p.decideT = 0.22 + Math.random() * 0.2;
    const pnx = this.nx(t, p.x), pny = this.ny(t, p.y);
    const near = this.nearestOpp(p);
    const pressure = near ? clamp(1 - (near.d - 1) / 5, 0, 1) : 0;
    const dGoal = hyp(gx - p.x, gy - p.y);

    let bestType = 'dribble', bestScore = -1, bestQ = null, bestKind = 'ground';

    // dribbling
    const dribDir = this.dribbleDirection(p);
    const aheadSpace = this.spaceAt(p.x + dribDir.x * 5, p.y + dribDir.y * 5, t);
    const held = this.time - (p.gotBallT || 0);
    bestScore = 0.5 + aheadSpace * 0.7 + (p.a.dri - 65) / 100 - pressure * 0.9 + (held < 1.0 ? 0.35 : held > 3 ? -0.3 : 0);
    if (p.group === 'DEF') bestScore -= 0.15;
    if (pnx > 0.8) bestScore -= 0.2;

    // tiro
    if (dGoal < 32 && pnx > 0.55) {
      const a1 = Math.atan2(gy - GOAL_HALF - p.y, gx - p.x);
      const a2 = Math.atan2(gy + GOAL_HALF - p.y, gx - p.x);
      const ang = Math.abs(angDiff(a1, a2));
      let blockers = 0;
      for (const o of this.active(this.opp(t))) {
        if (o.role === 'GK') continue;
        if (segDist(o.x, o.y, p.x, p.y, gx, gy) < 1.2 && hyp(o.x - p.x, o.y - p.y) < dGoal) blockers++;
      }
      let s = 0.35 + ang * 2.8 + (p.a.sho - 65) / 90 - blockers * 0.2 + (dGoal < 13 ? 0.7 : 0) + (dGoal < 20 ? 0.3 : 0) + pressure * 0.15;
      if (p.group === 'DEF') s -= 0.3;
      if (s > bestScore) { bestScore = s; bestType = 'shoot'; }
    }

    // pases
    for (const q of this.active(t)) {
      if (q === p || q.role === 'GK') continue;
      const kinds = [];
      if (q.run > 0 && this.nx(t, q.x) > pnx - 0.05) kinds.push('through');
      kinds.push('ground');
      for (const kind of kinds) {
        const tg = kind === 'through' ? this.throughTarget(p, q) : this.leadTarget(p, q, 'ground');
        const d = hyp(tg.x - p.x, tg.y - p.y);
        if (d < 5 || d > 48) continue;
        const prog = clamp((this.nx(t, tg.x) - pnx) / 0.3, -0.8, 1);
        let k = kind;
        let lane = this.laneSafety(p, tg.x, tg.y, t, k);
        if (d > 18 && lane < 0.6 && kind !== 'through') {
          const ll = this.laneSafety(p, tg.x, tg.y, t, 'lob') * 0.85;
          if (ll > lane) { k = 'lob'; lane = ll; }
        }
        const space = this.spaceAt(tg.x, tg.y, t);
        let s = -0.1 + prog * 0.6 + lane * 0.55 + space * 0.3 - d / 80 + pressure * 0.45;
        if (lane < 0.45) s -= 0.9;
        if (kind === 'through') s += 0.15;
        if (q.isUser && !this.userAI) {
          s += 0.12 + (this.userCall > 0 ? 0.7 : 0);
          if (this.state === 'play' && this.pass && this.pass.off) { /* nada */ }
        }
        // fuera de juego potencial
        if (this.nx(t, q.x) > this.offsideLine(t) + 0.004 && this.nx(t, q.x) > 0.5) s -= 1.5;
        s += Math.random() * 0.25;
        if (s > bestScore) { bestScore = s; bestType = 'pass'; bestQ = q; bestKind = k; }
      }
    }

    // centro desde banda
    if (pnx > 0.76 && Math.abs(pny - 0.5) > 0.24) {
      const inBox = this.active(t).filter((q) => q !== p && this.inBox(this.opp(t), q.x, q.y)).length;
      const s = 0.55 + inBox * 0.25 + (pnx - 0.76) * 3 + Math.random() * 0.2;
      if (s > bestScore && inBox > 0) { bestScore = s; bestType = 'cross'; }
    }

    if (bestType === 'shoot') {
      this.shoot(p, dGoal < 14 ? rand(0.55, 0.85) : rand(0.7, 0.95), null);
      return { target: { x: p.x, y: p.y }, sprint: false };
    }
    if (bestType === 'pass') {
      this.passTo(p, bestQ, bestKind);
      return { target: { x: p.x, y: p.y }, sprint: false };
    }
    if (bestType === 'cross') {
      this.aiCross(p);
      return { target: { x: p.x, y: p.y }, sprint: false };
    }
    p.dribDir = dribDir;
    p.dribSprint = aheadSpace > 0.5 && p.stamina > 0.4;
    return { target: { x: p.x + dribDir.x * 4, y: p.y + dribDir.y * 4 }, sprint: p.dribSprint };
  }

  dribbleDirection(p) {
    const t = p.team;
    const gx = this.goalX(t);
    const pnx = this.nx(t, p.x);
    let dx, dy;
    if (pnx < 0.72 && (p.group === 'FWD' || p.role === 'LB' || p.role === 'RB') && Math.abs(this.ny(t, p.y) - 0.5) > 0.25) {
      dx = t.dir; dy = 0; // por la banda
    } else {
      dx = gx - p.x; dy = W / 2 - p.y;
      const d = hyp(dx, dy) || 1; dx /= d; dy /= d;
    }
    for (const o of this.active(this.opp(t))) {
      const ox = p.x - o.x, oy = p.y - o.y;
      const d = hyp(ox, oy);
      if (d < 7 && d > 0.01) {
        const k = 1.6 / (d * d);
        dx += (ox / d) * k; dy += (oy / d) * k;
      }
    }
    if (p.y < 4) dy += 0.6;
    if (p.y > W - 4) dy -= 0.6;
    // no recular hacia atrás
    if (dx * t.dir < -0.2) dx = -0.2 * t.dir;
    const d = hyp(dx, dy) || 1;
    return { x: dx / d, y: dy / d };
  }

  aiCross(p) {
    const t = p.team;
    const o = this.opp(t);
    const inBox = this.active(t).filter((q) => q !== p && this.inBox(o, q.x, q.y));
    const gx = this.goalX(t);
    let tx, ty;
    if (inBox.length) {
      const q = inBox[Math.floor(Math.random() * inBox.length)];
      const lt = this.leadTarget(p, q, 'cross');
      tx = lt.x; ty = lt.y;
      this.registerPass(p, q, 'cross');
      q.receive = { x: tx, y: ty, t: 3 };
    } else {
      tx = gx - t.dir * rand(6, 12); ty = W / 2 + rand(-6, 6);
      this.registerPass(p, null, 'cross');
    }
    this.kickToward(p, tx, ty, 'cross');
  }

  // ----- Sin balón -----
  offBall(p, presser, presser2, dt) {
    const t = p.team;
    const b = this.ball;
    const o = this.owner;

    if (this.state === 'restart') return { target: this.restartTarget(p), sprint: false };

    // recibir pase
    if (p.receive && !o) {
      const ip = this.interceptPoint(p);
      return { target: ip.t < 2.5 ? ip : p.receive, sprint: true };
    }
    // balón suelto: perseguir
    if (!o && this.chaser[t.side] === p) {
      const ip = this.interceptPoint(p);
      return { target: ip, sprint: true };
    }

    // defendiendo
    if (o && o.team !== t) {
      if (p === presser) {
        const gx = this.ownGoalX(t);
        const d = hyp(o.x - p.x, o.y - p.y);
        const ux = (gx - o.x), uy = (W / 2 - o.y);
        const ud = hyp(ux, uy) || 1;
        const tgt = d > 3 ? { x: o.x + (ux / ud) * 1.2 + o.vx * 0.3, y: o.y + (uy / ud) * 1.2 + o.vy * 0.3 } : { x: o.x + o.vx * 0.2, y: o.y + o.vy * 0.2 };
        if (d < 1.7 && Math.random() < dt * (1.4 + p.a.def * 0.01)) this.tryTackle(p, o, false);
        return { target: tgt, sprint: d > 4 };
      }
      if (p === presser2 && (this.pressCall > 0 || hyp(o.x - p.x, o.y - p.y) < 12)) {
        const gx = this.ownGoalX(t);
        const ux = gx - o.x, uy = W / 2 - o.y;
        const ud = hyp(ux, uy) || 1;
        const k = this.pressCall > 0 ? 1.2 : 4.5;
        const d = hyp(o.x - p.x, o.y - p.y);
        if (this.pressCall > 0 && d < 1.6 && Math.random() < dt * 1.2) this.tryTackle(p, o, false);
        return { target: { x: o.x + (ux / ud) * k, y: o.y + (uy / ud) * k }, sprint: true };
      }
    }

    let tgt = this.shapeTarget(p);

    // marcaje
    if (o && o.team !== t && (p.group === 'DEF' || p.group === 'MID')) {
      const gx = this.ownGoalX(t);
      let m = null, md = 11;
      for (const q of this.active(o.team)) {
        if (q === o || q.role === 'GK') continue;
        const d = hyp(q.x - tgt.x, q.y - tgt.y);
        if (d < md) { md = d; m = q; }
      }
      if (m) {
        const ux = gx - m.x, uy = W / 2 - m.y;
        const ud = hyp(ux, uy) || 1;
        const mk = { x: m.x + (ux / ud) * 1.6, y: m.y + (uy / ud) * 1.6 };
        const w = p.group === 'DEF' ? 0.55 : 0.4;
        tgt = { x: tgt.x + (mk.x - tgt.x) * w, y: tgt.y + (mk.y - tgt.y) * w };
      }
    }

    // atacando: desmarques
    if (o && o.team === t && o !== p) {
      const line = this.offsideLine(t);
      const onx = this.nx(t, o.x);
      if (p.run > 0 && p.runT) {
        tgt = p.runT;
      } else if ((p.group === 'FWD' || (p.group === 'MID' && Math.random() < 0.3)) && onx > 0.3 && Math.random() < dt * 0.35) {
        const pnx = this.nx(t, p.x);
        if (pnx < line && pnx > line - 0.15) {
          p.run = 2.2;
          const rx = Math.min(0.96, line + 0.14);
          const ry = clamp(this.ny(t, p.y) + (0.5 - this.ny(t, p.y)) * 0.35, 0.08, 0.92);
          p.runT = { x: this.wx(t, rx), y: this.wy(t, ry) };
          tgt = p.runT;
        }
      }
      // separarse del poseedor
      const d = hyp(tgt.x - o.x, tgt.y - o.y);
      if (d < 7) {
        const ux = (tgt.x - o.x) / (d || 1), uy = (tgt.y - o.y) / (d || 1);
        tgt = { x: o.x + ux * 7, y: o.y + uy * 7 };
      }
      // si el usuario pide balón, el resto no se le acerca
    }
    tgt.x = clamp(tgt.x, 0.5, L - 0.5); tgt.y = clamp(tgt.y, 0.5, W - 0.5);
    const far = hyp(tgt.x - p.x, tgt.y - p.y) > 8 || p.run > 0;
    void b;
    return { target: tgt, sprint: far };
  }

  shapeTarget(p, ballOverride) {
    const t = p.team;
    const b = ballOverride || this.ball;
    const bx = this.nx(t, b.x), by = this.ny(t, b.y);
    const pt = this.possTeam;
    const att = pt === t;
    let x = p.base.x + (bx - 0.5) * (att ? 0.55 : 0.5) + (att ? 0.1 : -0.05);
    let y = p.base.y + (by - 0.5) * 0.3;
    y = 0.5 + (y - 0.5) * (att ? 1.12 : 0.82);
    if (p.group === 'DEF') {
      if (att && (p.role === 'LB' || p.role === 'RB')) x += 0.06;
      x = clamp(x, 0.06, att ? 0.62 : 0.45);
      if (!att) x = Math.max(0.05, Math.min(x, bx - 0.03));
    } else if (p.group === 'MID') {
      x = clamp(x, 0.14, att ? 0.8 : 0.6);
    } else if (p.group === 'FWD') {
      x = clamp(x, att ? 0.42 : 0.36, 0.93);
      if (att) {
        const line = this.offsideLine(t);
        x = Math.min(x, line - 0.012);
      }
    }
    y = clamp(y, 0.04, 0.96);
    return { x: this.wx(t, x), y: this.wy(t, y) };
  }

  restartTarget(p) {
    const rs = this.rs;
    if (!rs) return { x: p.x, y: p.y };
    if (rs.type === 'kickoff' || rs.type === 'penalty') return { x: p.x, y: p.y };
    const t = p.team;
    let tgt = this.shapeTarget(p, { x: rs.x, y: rs.y });
    if (rs.type === 'corner') {
      const attT = rs.team;
      const defT = this.opp(attT);
      const gx = this.goalX(attT);
      const inward = -attT.dir;
      if (t === attT && (p.group === 'FWD' || p.role === 'CB' || p.role === 'CM')) {
        const slot = (p.idx * 37) % 7;
        tgt = { x: gx + inward * (5 + (slot % 3) * 3.5), y: W / 2 - 7 + slot * 2.3 };
        if (p.role === 'CB' && p.idx === 3) tgt = { x: this.wx(t, 0.5), y: W / 2 };
      } else if (t === defT && p.group !== 'GK' && p.role !== 'ST' && p.role !== 'LW') {
        const slot = (p.idx * 29) % 8;
        tgt = { x: gx + inward * (3 + (slot % 3) * 3.5), y: W / 2 - 8 + slot * 2.2 };
      }
    }
    if (t !== rs.team) {
      const minD = rs.type === 'throw' ? 3 : 9.2;
      const d = hyp(tgt.x - rs.x, tgt.y - rs.y);
      if (d < minD) {
        const k = minD / (d || 1);
        tgt = { x: rs.x + (tgt.x - rs.x) * k, y: rs.y + (tgt.y - rs.y) * k };
      }
    }
    return tgt;
  }

  // ---------- Control del usuario ----------
  userControl(p, inp, dt) {
    const mx = inp.mx || 0, my = inp.my || 0;
    const mag = Math.min(1, hyp(mx, my));
    const sprint = !!inp.sprint;
    const max = this.maxSpeed(p, sprint);
    const desired = mag > 0.15 ? { x: (mx / (hyp(mx, my) || 1)) * max * mag, y: (my / (hyp(mx, my) || 1)) * max * mag } : { x: 0, y: 0 };

    const isOwner = this.owner === p;
    const rs = this.state === 'restart' ? this.rs : null;

    if (isOwner && rs && rs.taker === p) {
      // apuntar y ejecutar saque
      if (mag > 0.2) p.face = Math.atan2(my, mx);
      const act = inp.pass ? 'ground' : inp.through ? 'through' : inp.lob ? 'lob' : null;
      if (rs.timer <= 0.3) {
        if (act) {
          this.state = 'play'; p.holding = false; this.rs = null;
          this.userPass(p, rs.type === 'throw' ? 'throw' : (rs.type === 'corner' ? 'lob' : act), inp, rs.type);
        } else if (inp.shootRelease && rs.type !== 'throw') {
          this.state = 'play'; p.holding = false; this.rs = null;
          const pw = rs.type === 'penalty' ? clamp(p.charge, 0.4, 1) : clamp(p.charge, 0.3, 1);
          this.shoot(p, pw, Math.abs(my) > 0.25 ? my : (Math.abs(mx) > 0.25 && rs.type === 'penalty' ? 0 : null), rs.type === 'penalty');
          p.charge = 0;
        }
      }
      if (inp.shootHeld) p.charge = Math.min(1, p.charge + dt * 1.3); else if (!inp.shootRelease) p.charge = 0;
      return { x: 0, y: 0 };
    }

    if (isOwner) {
      if (inp.shootHeld) { p.charging = true; p.charge = Math.min(1, p.charge + dt * 1.35); }
      if (inp.shootRelease && p.charging) {
        this.shoot(p, Math.max(0.25, p.charge), Math.abs(my) > 0.3 ? my : null);
        p.charge = 0; p.charging = false;
        return desired;
      }
      if (inp.pass) { this.userPass(p, 'ground', inp); return desired; }
      if (inp.through) { this.userPass(p, 'through', inp); return desired; }
      if (inp.lob) { this.userPass(p, 'lob', inp); return desired; }
      if (inp.skill) {
        // conducción larga: me la adelanto
        const a = mag > 0.2 ? Math.atan2(my, mx) : p.face;
        p.face = a;
        this.kick(p, Math.cos(a) * (max + 3.5), Math.sin(a) * (max + 3.5), 0);
        p.cd = 0.18;
        this.lastTouch = p;
        return desired;
      }
      return desired;
    }

    p.charge = 0; p.charging = false;
    const o = this.owner;
    if (o && o.team === p.team) {
      if (inp.pass) { this.userCall = 2; this.say('¡DÁMELA!', '', 0.8); }
      if (inp.through) {
        // pedir al hueco: desmarque
        this.userCall = 2;
        this.say('¡AL HUECO!', '', 0.8);
        p.run = 2;
      }
    } else if (o && o.team !== p.team) {
      const d = hyp(o.x - p.x, o.y - p.y);
      if (inp.shoot && d < 2.0) this.tryTackle(p, o, true);
      if (inp.through && p.slide <= 0 && p.stun <= 0) this.startSlide(p);
      if (inp.pass) { this.pressCall = 2; this.say('¡PRESIÓN!', '', 0.7); }
    } else {
      // balón suelto: preparar remate de primeras
      if (inp.shoot) p.shootBuf = 0.6;
      if (inp.pass) p.passBuf = 0.6;
      if (inp.through && p.slide <= 0) {
        const b = this.ball;
        if (hyp(b.x - p.x, b.y - p.y) < 4) this.startSlide(p);
      }
    }
    return desired;
  }

  userPass(p, kind, inp, rsType) {
    const t = p.team;
    const mx = inp.mx || 0, my = inp.my || 0;
    let dx, dy;
    const aimed = hyp(mx, my) > 0.2;
    if (aimed) { const m = hyp(mx, my); dx = mx / m; dy = my / m; }
    else { dx = Math.cos(p.face); dy = Math.sin(p.face); }
    let best = null, bs = -1e9;
    // en saques sin dirección: el mejor compañero disponible
    if (rsType && !aimed && rsType !== 'corner') best = this.bestPassTarget(p, { back: rsType === 'kickoff', maxD: rsType === 'throw' ? 22 : 45 });
    for (const q of best ? [] : this.active(t)) {
      if (q === p) continue;
      const vx = q.x - p.x, vy = q.y - p.y;
      const d = hyp(vx, vy);
      if (d < 3 || d > 60) continue;
      const c = (vx * dx + vy * dy) / d;
      if (c < 0.35) continue;
      const s = c * 2.2 - d / 45 + this.spaceAt(q.x, q.y, t) * 0.3 + this.laneSafety(p, q.x, q.y, t, kind) * 0.3 - (q.role === 'GK' ? 0.5 : 0);
      if (s > bs) { bs = s; best = q; }
    }
    const k = kind === 'throw' ? 'throw' : kind;
    if (rsType === 'corner') {
      if (best) this.passTo(p, best, 'cross');
      else {
        const gx = this.goalX(t);
        this.registerPass(p, null, 'cross');
        this.kickToward(p, gx - t.dir * 8, W / 2, 'cross');
      }
      return;
    }
    if (best) {
      this.passTo(p, best, k === 'lob' && this.inBox(this.opp(t), best.x, best.y) ? 'cross' : k);
    } else {
      const len = kind === 'through' ? 18 : kind === 'lob' ? 25 : 12;
      this.registerPass(p, null, k);
      this.kickToward(p, p.x + dx * len, p.y + dy * len, k);
    }
  }
}
