// Dibujo del partido en canvas 2D con vista cenital inclinada (pseudo 3D).

import { L, W, GOAL_HALF, GOAL_H, BOX_D, BOX_HALF } from './engine.js';

const TILT = 0.78;   // compresión vertical del campo
const ZK = 0.95;     // escala de la altura

export class Renderer {
  constructor(canvas) {
    this.c = canvas;
    this.g = canvas.getContext('2d');
    this.cam = { x: L / 2, y: W / 2 };
    this.dpr = 1;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth, h = window.innerHeight;
    this.c.width = Math.round(w * this.dpr);
    this.c.height = Math.round(h * this.dpr);
    this.c.style.width = w + 'px';
    this.c.style.height = h + 'px';
    this.w = w; this.h = h;
    this.s = Math.max(9, h > w ? Math.min(w / 52, h / 30) : Math.min(w / 40, h / 25));
  }

  P(x, y, z = 0) {
    return [
      (x - this.cam.x) * this.s + this.w / 2,
      (y - this.cam.y) * this.s * TILT + this.h / 2 - z * this.s * ZK,
    ];
  }

  updateCamera(m, dt, snap = false) {
    const b = m.ball;
    let tx = b.x, ty = b.y;
    if (m.user && !m.user.sentOff && !m.userAI) {
      tx = m.user.x * 0.6 + b.x * 0.4;
      ty = m.user.y * 0.6 + b.y * 0.4;
    }
    const vw = this.w / this.s, vh = this.h / (this.s * TILT);
    const minX = vw / 2 - 6, maxX = L - vw / 2 + 6;
    const minY = vh / 2 - 6, maxY = W - vh / 2 + 6;
    tx = minX > maxX ? L / 2 : Math.max(minX, Math.min(maxX, tx));
    ty = minY > maxY ? W / 2 : Math.max(minY, Math.min(maxY, ty));
    const k = snap ? 1 : 1 - Math.exp(-dt * 3.2);
    this.cam.x += (tx - this.cam.x) * k;
    this.cam.y += (ty - this.cam.y) * k;
  }

  draw(m, dt) {
    const g = this.g;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.updateCamera(m, dt);
    this.drawPitch();
    this.drawGoal(m, 0, false);
    this.drawGoal(m, L, false);

    const ents = [];
    for (const t of m.teams) for (const p of t.players) if (!p.sentOff) ents.push({ y: p.y, p });
    ents.push({ y: m.ball.y, ball: true });
    ents.sort((a, b) => a.y - b.y);
    // sombras primero
    for (const e of ents) {
      if (e.ball) this.shadow(m.ball.x, m.ball.y, 0.16 + m.ball.z * 0.02, 0.35 - Math.min(0.25, m.ball.z * 0.04));
      else this.shadow(e.p.x, e.p.y, 0.42, 0.28);
    }
    // marcadores de suelo
    if (m.user && !m.user.sentOff) this.userRing(m.user, m);
    if (m.owner && m.owner !== m.user) this.ownerRing(m.owner);
    for (const e of ents) {
      if (e.ball) this.drawBall(m.ball);
      else this.drawPlayer(e.p, m);
    }
    this.drawGoal(m, 0, true);
    this.drawGoal(m, L, true);
    if (m.user && !m.user.sentOff) this.userOverlay(m.user, m);
    this.drawHUD(m);
  }

  drawPitch() {
    const g = this.g;
    g.fillStyle = '#2b6a2f';
    g.fillRect(0, 0, this.w, this.h);
    // rayas de césped
    const n = 18;
    const sw = L / n;
    for (let i = -2; i < n + 2; i++) {
      const [x1, y1] = this.P(i * sw, -8);
      const [x2, y2] = this.P((i + 1) * sw, W + 8);
      g.fillStyle = i % 2 === 0 ? '#3a8a3c' : '#347e36';
      g.fillRect(x1, y1, x2 - x1 + 1, y2 - y1);
    }
    // grada/publicidad
    const [ax, ay] = this.P(-6, -4.5);
    const [bx] = this.P(L + 6, -4.5);
    g.fillStyle = '#1d2433';
    g.fillRect(ax, ay - 60 * (this.s / 20), bx - ax, 60 * (this.s / 20));
    const [, by2] = this.P(0, -3.2);
    g.fillStyle = '#0e3b6e';
    g.fillRect(ax, by2 - this.s * 0.9, bx - ax, this.s * 0.9);
    g.fillStyle = 'rgba(255,255,255,.55)';
    g.font = `bold ${Math.max(9, this.s * 0.6)}px system-ui`;
    g.textBaseline = 'middle';
    for (let x = 0; x < L; x += 21) {
      const [px] = this.P(x + 3, 0);
      g.fillText(['FÚTBOL·VIDA', 'CANTERA', 'LEYENDA', 'GOLAZO', 'CARRERA'][(x / 21) % 5], px, by2 - this.s * 0.45);
    }

    g.strokeStyle = 'rgba(255,255,255,.88)';
    g.lineWidth = Math.max(1.5, this.s * 0.12);
    g.lineJoin = 'round';
    const line = (pts) => {
      g.beginPath();
      pts.forEach(([x, y], i) => {
        const [sx, sy] = this.P(x, y);
        if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy);
      });
      g.stroke();
    };
    const rect = (x1, y1, x2, y2) => line([[x1, y1], [x2, y1], [x2, y2], [x1, y2], [x1, y1]]);
    rect(0, 0, L, W);
    line([[L / 2, 0], [L / 2, W]]);
    for (const gx of [0, L]) {
      const d = gx === 0 ? 1 : -1;
      rect(gx, W / 2 - BOX_HALF, gx + d * BOX_D, W / 2 + BOX_HALF);
      rect(gx, W / 2 - 9.16, gx + d * 5.5, W / 2 + 9.16);
      // punto de penalti
      this.spot(gx + d * 11, W / 2, 0.22);
      // media luna
      const cx = gx + d * 11;
      const a0 = Math.acos((BOX_D - 11) / 9.15);
      this.arc(cx, W / 2, 9.15, d > 0 ? -a0 : Math.PI - a0, d > 0 ? a0 : Math.PI + a0);
    }
    this.arc(L / 2, W / 2, 9.15, 0, Math.PI * 2);
    this.spot(L / 2, W / 2, 0.25);
    for (const [cx, cy, a0] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]]) {
      this.arc(cx, cy, 1, a0, a0 + Math.PI / 2);
    }
  }

  arc(cx, cy, r, a0, a1) {
    const g = this.g;
    g.beginPath();
    const steps = 40;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (a1 - a0) * (i / steps);
      const [x, y] = this.P(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  }

  spot(x, y, r) {
    const [sx, sy] = this.P(x, y);
    this.g.fillStyle = 'rgba(255,255,255,.9)';
    this.g.beginPath();
    this.g.ellipse(sx, sy, r * this.s, r * this.s * TILT, 0, 0, Math.PI * 2);
    this.g.fill();
  }

  drawGoal(m, gx, front) {
    const g = this.g;
    const d = gx === 0 ? -1 : 1;
    const bx = gx + d * 2.0;
    const y1 = W / 2 - GOAL_HALF, y2 = W / 2 + GOAL_HALF;
    if (!front) {
      // red: suelo, fondo y laterales
      const poly = (pts, fill) => {
        g.beginPath();
        pts.forEach(([x, y, z], i) => {
          const [sx, sy] = this.P(x, y, z);
          if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy);
        });
        g.closePath();
        g.fillStyle = fill; g.fill();
      };
      poly([[gx, y1, 0], [bx, y1, 0], [bx, y2, 0], [gx, y2, 0]], 'rgba(20,40,20,.35)');
      poly([[bx, y1, 0], [bx, y1, GOAL_H * 0.85], [bx, y2, GOAL_H * 0.85], [bx, y2, 0]], 'rgba(255,255,255,.10)');
      poly([[gx, y1, 0], [gx, y1, GOAL_H], [bx, y1, GOAL_H * 0.85], [bx, y1, 0]], 'rgba(255,255,255,.12)');
      // malla
      g.strokeStyle = 'rgba(255,255,255,.28)';
      g.lineWidth = 1;
      for (let i = 0; i <= 10; i++) {
        const y = y1 + (y2 - y1) * (i / 10);
        const [a, b] = this.P(bx, y, 0), [c, e] = this.P(bx, y, GOAL_H * 0.85);
        g.beginPath(); g.moveTo(a, b); g.lineTo(c, e); g.stroke();
      }
      for (let j = 0; j <= 4; j++) {
        const z = GOAL_H * 0.85 * (j / 4);
        const [a, b] = this.P(bx, y1, z), [c, e] = this.P(bx, y2, z);
        g.beginPath(); g.moveTo(a, b); g.lineTo(c, e); g.stroke();
      }
      // poste trasero (lado de arriba) y larguero
      this.post(gx, y1);
      const [a, b] = this.P(gx, y1, GOAL_H), [c, e] = this.P(gx, y2, GOAL_H);
      g.strokeStyle = '#fafafa'; g.lineWidth = Math.max(3, this.s * 0.18);
      g.beginPath(); g.moveTo(a, b); g.lineTo(c, e); g.stroke();
    } else {
      // poste delantero (lado de abajo) por encima de jugadores
      const poly = (pts, fill) => {
        g.beginPath();
        pts.forEach(([x, y, z], i) => {
          const [sx, sy] = this.P(x, y, z);
          if (i) g.lineTo(sx, sy); else g.moveTo(sx, sy);
        });
        g.closePath();
        g.fillStyle = fill; g.fill();
      };
      poly([[gx, y2, 0], [gx, y2, GOAL_H], [bx, y2, GOAL_H * 0.85], [bx, y2, 0]], 'rgba(255,255,255,.10)');
      this.post(gx, y2);
      void m;
    }
  }

  post(x, y) {
    const g = this.g;
    const [a, b] = this.P(x, y, 0), [c, e] = this.P(x, y, GOAL_H);
    g.strokeStyle = '#fafafa'; g.lineWidth = Math.max(3, this.s * 0.18); g.lineCap = 'round';
    g.beginPath(); g.moveTo(a, b); g.lineTo(c, e); g.stroke();
  }

  shadow(x, y, r, alpha) {
    const [sx, sy] = this.P(x, y);
    const g = this.g;
    g.fillStyle = `rgba(0,0,0,${alpha})`;
    g.beginPath();
    g.ellipse(sx + r * this.s * 0.25, sy, r * this.s, r * this.s * TILT * 0.7, 0, 0, Math.PI * 2);
    g.fill();
  }

  userRing(p, m) {
    const g = this.g;
    const [sx, sy] = this.P(p.x, p.y);
    const pulse = 1 + Math.sin(m.time * 6) * 0.06;
    g.strokeStyle = '#ffd60a';
    g.lineWidth = Math.max(2, this.s * 0.1);
    g.beginPath();
    g.ellipse(sx, sy, 0.75 * this.s * pulse, 0.75 * this.s * TILT * pulse, 0, 0, Math.PI * 2);
    g.stroke();
    // flecha de dirección
    const a = p.face;
    const r = 1.05;
    const [tx, ty] = this.P(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    const [lx, ly] = this.P(p.x + Math.cos(a + 0.35) * 0.78, p.y + Math.sin(a + 0.35) * 0.78);
    const [rx, ry] = this.P(p.x + Math.cos(a - 0.35) * 0.78, p.y + Math.sin(a - 0.35) * 0.78);
    g.fillStyle = '#ffd60a';
    g.beginPath(); g.moveTo(tx, ty); g.lineTo(lx, ly); g.lineTo(rx, ry); g.closePath(); g.fill();
  }

  ownerRing(p) {
    const g = this.g;
    const [sx, sy] = this.P(p.x, p.y);
    g.strokeStyle = 'rgba(255,255,255,.55)';
    g.lineWidth = 1.5;
    g.beginPath();
    g.ellipse(sx, sy, 0.6 * this.s, 0.6 * this.s * TILT, 0, 0, Math.PI * 2);
    g.stroke();
  }

  drawPlayer(p, m) {
    const g = this.g;
    const s = this.s;
    const t = p.team;
    const shirt = p.role === 'GK' ? t.gkColor : t.color;
    const shorts = p.role === 'GK' ? '#1f2937' : t.color2;
    const [fx, fy] = this.P(p.x, p.y);
    const lying = p.slide > 0 || p.dive > 0 || (p.stun > 0.6 && p.speed < 2);
    const flip = Math.cos(p.face) < 0 ? -1 : 1;
    if (lying) {
      g.save();
      g.translate(fx, fy - s * 0.25);
      let ang = Math.atan2(Math.sin(p.face) * TILT, Math.cos(p.face));
      if (p.dive > 0) ang = Math.atan2(p.vy * TILT, p.vx) || 0;
      g.rotate(ang);
      g.fillStyle = shorts; g.fillRect(-s * 0.85, -s * 0.18, s * 0.6, s * 0.36);
      g.fillStyle = shirt; g.fillRect(-s * 0.3, -s * 0.22, s * 0.75, s * 0.44);
      g.fillStyle = '#e0b48a'; g.beginPath(); g.arc(s * 0.6, 0, s * 0.16, 0, Math.PI * 2); g.fill();
      g.restore();
      return;
    }
    const sp = p.speed;
    const sw = Math.sin(p.phase * 2.2) * Math.min(1, sp / 4);
    const hipZ = 0.92, shZ = 1.45, headZ = 1.68;
    const [, hipY] = this.P(p.x, p.y, hipZ);
    const [, shY] = this.P(p.x, p.y, shZ);
    const [, headY] = this.P(p.x, p.y, headZ);
    const lw = Math.max(2, s * 0.13);
    g.lineCap = 'round';
    // piernas
    g.strokeStyle = '#1b1b1b';
    g.lineWidth = lw;
    const stride = s * 0.28;
    g.beginPath(); g.moveTo(fx - s * 0.08, hipY); g.lineTo(fx - s * 0.08 + sw * stride * flip, fy - 1); g.stroke();
    g.beginPath(); g.moveTo(fx + s * 0.08, hipY); g.lineTo(fx + s * 0.08 - sw * stride * flip, fy - 1); g.stroke();
    // medias de color
    g.strokeStyle = shirt;
    g.lineWidth = lw * 0.9;
    const kneeY = (hipY + fy) / 2 + 2;
    g.beginPath(); g.moveTo(fx - s * 0.08 + sw * stride * flip * 0.5, kneeY); g.lineTo(fx - s * 0.08 + sw * stride * flip, fy - 1); g.stroke();
    g.beginPath(); g.moveTo(fx + s * 0.08 - sw * stride * flip * 0.5, kneeY); g.lineTo(fx + s * 0.08 - sw * stride * flip, fy - 1); g.stroke();
    // pantalón
    g.fillStyle = shorts;
    g.fillRect(fx - s * 0.22, hipY - s * 0.12, s * 0.44, s * 0.26);
    // brazos
    g.strokeStyle = '#d9a77c';
    g.lineWidth = lw * 0.8;
    const armY = shY + s * 0.08;
    g.beginPath(); g.moveTo(fx - s * 0.24, armY); g.lineTo(fx - s * 0.3 - sw * s * 0.2 * flip, armY + s * 0.42); g.stroke();
    g.beginPath(); g.moveTo(fx + s * 0.24, armY); g.lineTo(fx + s * 0.3 + sw * s * 0.2 * flip, armY + s * 0.42); g.stroke();
    // camiseta
    g.fillStyle = shirt;
    const tw = s * 0.52, th = hipY - shY + s * 0.02;
    roundRect(g, fx - tw / 2, shY - s * 0.04, tw, th, s * 0.1);
    g.fill();
    g.strokeStyle = 'rgba(0,0,0,.35)'; g.lineWidth = 1; g.stroke();
    // número
    if (s > 16) {
      g.fillStyle = p.role === 'GK' ? '#111' : contrast(shirt);
      g.font = `bold ${Math.round(s * 0.3)}px system-ui`;
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(p.num), fx, shY + th / 2 - s * 0.02);
    }
    // cabeza
    g.fillStyle = p.skin || (p.skin = ['#f1c9a5', '#e0ac85', '#c68c63', '#8d5a3b', '#5c3a24'][(p.idx * 7 + t.side * 3) % 5]);
    g.beginPath(); g.arc(fx + flip * s * 0.03, headY, s * 0.17, 0, Math.PI * 2); g.fill();
    g.fillStyle = p.hair || (p.hair = ['#1b1209', '#3b2412', '#6b4423', '#c9a25b', '#111'][(p.idx * 3 + t.side) % 5]);
    g.beginPath(); g.arc(fx + flip * s * 0.03, headY - s * 0.04, s * 0.17, Math.PI * 1.05, Math.PI * 1.95); g.fill();
    if (p.yellow > 0 && s > 14) {
      g.fillStyle = '#facc15';
      g.fillRect(fx + s * 0.3, headY - s * 0.2, s * 0.12, s * 0.17);
    }
    void m;
  }

  drawBall(b) {
    const g = this.g;
    const [sx, sy] = this.P(b.x, b.y, b.z + 0.11);
    const r = Math.max(2.5, this.s * (0.15 + b.z * 0.006));
    g.fillStyle = '#ffffff';
    g.beginPath(); g.arc(sx, sy, r, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.5)'; g.lineWidth = 1; g.stroke();
    const rot = (b.x + b.y) * 2.2;
    g.fillStyle = '#222';
    for (let i = 0; i < 3; i++) {
      const a = rot + i * 2.1;
      g.beginPath(); g.arc(sx + Math.cos(a) * r * 0.45, sy + Math.sin(a) * r * 0.45, r * 0.25, 0, Math.PI * 2); g.fill();
    }
  }

  userOverlay(p, m) {
    const g = this.g;
    const s = this.s;
    const [hx, hy] = this.P(p.x, p.y, 2.25);
    // flecha sobre la cabeza
    g.fillStyle = '#ffd60a';
    g.beginPath(); g.moveTo(hx, hy + s * 0.25); g.lineTo(hx - s * 0.22, hy - s * 0.05); g.lineTo(hx + s * 0.22, hy - s * 0.05); g.closePath(); g.fill();
    g.font = `bold ${Math.max(11, s * 0.45)}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'bottom';
    g.lineWidth = 3; g.strokeStyle = 'rgba(0,0,0,.7)';
    g.strokeText(p.name, hx, hy - s * 0.1);
    g.fillStyle = '#fff';
    g.fillText(p.name, hx, hy - s * 0.1);
    // barra de potencia
    if (p.charge > 0) {
      const w = s * 1.8, h = Math.max(5, s * 0.2);
      const x = hx - w / 2, y = hy - s * 0.95;
      g.fillStyle = 'rgba(0,0,0,.6)'; g.fillRect(x - 1, y - 1, w + 2, h + 2);
      const c = p.charge;
      g.fillStyle = c < 0.6 ? '#22c55e' : c < 0.85 ? '#facc15' : '#ef4444';
      g.fillRect(x, y, w * c, h);
    }
    if (m.userCall > 0) {
      g.fillStyle = 'rgba(255,214,10,.9)';
      g.font = `bold ${Math.max(10, s * 0.4)}px system-ui`;
      g.fillText('¡Pásala!', hx, hy - s * 1.0);
    }
  }

  drawHUD(m) {
    const g = this.g;
    const [h, a] = m.teams;
    const pad = 10;
    // marcador
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    const fs = Math.max(13, Math.min(18, this.w / 60));
    g.font = `800 ${fs}px system-ui`;
    const min = Math.min(90, Math.floor(m.minute));
    const parts = [h.short, `${h.score} - ${a.score}`, a.short];
    const wHome = g.measureText(parts[0]).width, wScore = g.measureText(parts[1]).width, wAway = g.measureText(parts[2]).width;
    const bw = wHome + wScore + wAway + fs * 5.6, bh = fs * 2;
    g.fillStyle = 'rgba(8,12,24,.82)';
    roundRect(g, pad, pad, bw, bh, 8); g.fill();
    let x = pad + fs * 0.5;
    g.fillStyle = h.color; g.fillRect(x, pad + bh * 0.25, fs * 0.35, bh * 0.5); x += fs * 0.6;
    g.fillStyle = '#fff'; g.fillText(parts[0], x, pad + bh / 2); x += wHome + fs * 0.6;
    g.fillStyle = '#ffd60a'; g.fillText(parts[1], x, pad + bh / 2); x += wScore + fs * 0.6;
    g.fillStyle = '#fff'; g.fillText(parts[2], x, pad + bh / 2); x += wAway + fs * 0.25;
    g.fillStyle = a.color; g.fillRect(x, pad + bh * 0.25, fs * 0.35, bh * 0.5); x += fs * 0.7;
    g.fillStyle = '#9fb3d1'; g.fillText(`${min}'`, x, pad + bh / 2);

    // jugador
    if (m.user) {
      const u = m.user;
      const y0 = pad + bh + 8;
      const w = Math.max(150, fs * 11);
      g.fillStyle = 'rgba(8,12,24,.75)';
      roundRect(g, pad, y0, w, fs * 2.9, 8); g.fill();
      g.fillStyle = '#fff'; g.font = `700 ${fs * 0.85}px system-ui`;
      g.fillText(`${u.name}  #${u.num}`, pad + 10, y0 + fs * 0.8);
      const r = m.rating;
      g.fillStyle = r >= 7.5 ? '#22c55e' : r >= 6 ? '#facc15' : '#ef4444';
      g.textAlign = 'right';
      g.fillText(r.toFixed(1), pad + w - 10, y0 + fs * 0.8);
      g.textAlign = 'left';
      // energía
      g.fillStyle = 'rgba(255,255,255,.15)';
      g.fillRect(pad + 10, y0 + fs * 1.65, w - 20, fs * 0.45);
      g.fillStyle = u.stamina > 0.5 ? '#38bdf8' : u.stamina > 0.3 ? '#f59e0b' : '#ef4444';
      g.fillRect(pad + 10, y0 + fs * 1.65, (w - 20) * u.stamina, fs * 0.45);
      g.fillStyle = '#9fb3d1'; g.font = `600 ${fs * 0.6}px system-ui`;
      g.fillText('ENERGÍA', pad + 10, y0 + fs * 2.5);
      if (u.sentOff) { g.fillStyle = '#ef4444'; g.fillText('EXPULSADO', pad + w * 0.5, y0 + fs * 2.5); }
    }

    // radar
    const rw = this.touchMode ? Math.min(120, this.w * 0.14) : Math.min(190, this.w * 0.22), rh = rw * (W / L);
    const rx = this.w - rw - pad, ry = this.h - rh - pad - (this.touchMode ? this.h * 0.0 : 0);
    const rxx = this.touchMode ? (this.w - rw) / 2 : rx;
    const ryy = this.touchMode ? pad : ry;
    g.fillStyle = 'rgba(10,40,16,.75)';
    g.fillRect(rxx, ryy, rw, rh);
    g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 1;
    g.strokeRect(rxx, ryy, rw, rh);
    g.beginPath(); g.moveTo(rxx + rw / 2, ryy); g.lineTo(rxx + rw / 2, ryy + rh); g.stroke();
    for (const t of m.teams) {
      for (const p of t.players) {
        if (p.sentOff) continue;
        g.fillStyle = p.isUser ? '#ffd60a' : t.color;
        const r = p.isUser ? 3.5 : 2.5;
        g.beginPath(); g.arc(rxx + (p.x / L) * rw, ryy + (p.y / W) * rh, r, 0, Math.PI * 2); g.fill();
        if (!p.isUser) { g.strokeStyle = 'rgba(0,0,0,.6)'; g.stroke(); }
      }
    }
    g.fillStyle = '#fff';
    g.beginPath(); g.arc(rxx + (m.ball.x / L) * rw, ryy + (m.ball.y / W) * rh, 2.2, 0, Math.PI * 2); g.fill();

    // aviso de saque del usuario
    if (m.state === 'restart' && m.rs && m.rs.taker.isUser && !m.userAI) {
      const names = { kickoff: 'Saque de centro', throw: 'Saque de banda', corner: 'Córner', goalkick: 'Saque de puerta', freekick: 'Falta', penalty: 'Penalti' };
      const hint = m.rs.type === 'penalty' ? 'Apunta y mantén TIRO para la potencia' :
        m.rs.type === 'throw' ? 'Apunta y pulsa PASE' : 'Apunta: PASE · ELEVADO · TIRO';
      this.toast(`${names[m.rs.type]} — ${hint}`, this.touchMode ? rh + 34 : this.h - 60);
    }

    // banner
    if (m.banner) {
      const bnr = m.banner;
      const life = Math.min(1, bnr.t / 0.3, (bnr.max - bnr.t) / 0.2 + 0.2);
      g.globalAlpha = Math.max(0, Math.min(1, life));
      const big = bnr.text.includes('GOO') ? 2.6 : 1.7;
      g.font = `900 ${fs * big}px system-ui`;
      g.textAlign = 'center';
      const ty = this.h * 0.24;
      g.lineWidth = 6; g.strokeStyle = 'rgba(0,0,0,.65)';
      g.strokeText(bnr.text, this.w / 2, ty);
      g.fillStyle = bnr.text.includes('GOO') ? '#ffd60a' : '#fff';
      g.fillText(bnr.text, this.w / 2, ty);
      if (bnr.sub) {
        g.font = `700 ${fs}px system-ui`;
        g.lineWidth = 4; g.strokeText(bnr.sub, this.w / 2, ty + fs * big * 0.85);
        g.fillStyle = '#fff'; g.fillText(bnr.sub, this.w / 2, ty + fs * big * 0.85);
      }
      g.globalAlpha = 1;
    }
  }

  toast(text, y) {
    const g = this.g;
    g.font = `700 ${Math.max(12, Math.min(16, this.w / 70))}px system-ui`;
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const w = g.measureText(text).width + 28;
    g.fillStyle = 'rgba(8,12,24,.85)';
    roundRect(g, this.w / 2 - w / 2, y - 16, w, 32, 16); g.fill();
    g.fillStyle = '#ffd60a';
    g.fillText(text, this.w / 2, y);
  }
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

function contrast(hex) {
  const n = parseInt(hex.slice(1), 16);
  const r = (n >> 16) & 255, gg = (n >> 8) & 255, b = n & 255;
  return (r * 299 + gg * 587 + b * 114) / 1000 > 150 ? '#111' : '#fff';
}
