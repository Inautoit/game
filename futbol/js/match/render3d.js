// Vista 3D del partido (Three.js): primera persona, cámara detrás del jugador
// o cámara de TV cuando no controlas a nadie (simulación / expulsión).

import * as THREE from '../../../vendor/three.module.js';
import { L, W, GOAL_HALF, GOAL_H, BOX_D, BOX_HALF } from './engine.js';

// motor (x, y, z-altura) -> three (x, y-arriba, z)
const V = (x, y, z = 0) => new THREE.Vector3(x - L / 2, z, y - W / 2);

const matCache = new Map();
function lambert(color) {
  const k = 'l' + color;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshLambertMaterial({ color }));
  return matCache.get(k);
}

function canvasTex(w, h, draw, repeat) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  t.anisotropy = 8;
  return t;
}

// geometrías compartidas por todos los jugadores
const GEO = {
  leg: new THREE.BoxGeometry(0.13, 0.5, 0.13),
  sock: new THREE.BoxGeometry(0.135, 0.38, 0.135),
  boot: new THREE.BoxGeometry(0.26, 0.09, 0.13),
  shorts: new THREE.BoxGeometry(0.26, 0.27, 0.42),
  torso: new THREE.BoxGeometry(0.25, 0.56, 0.44),
  arm: new THREE.BoxGeometry(0.1, 0.32, 0.1),
  forearm: new THREE.BoxGeometry(0.09, 0.3, 0.09),
  head: new THREE.SphereGeometry(0.12, 14, 10),
  hair: new THREE.SphereGeometry(0.125, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2),
  neck: new THREE.CylinderGeometry(0.05, 0.05, 0.1, 8),
  shadow: new THREE.CircleGeometry(0.42, 20),
};
const SKINS = ['#f1c9a5', '#e0ac85', '#c68c63', '#8d5a3b', '#5c3a24'];
const HAIRS = ['#1b1209', '#3b2412', '#6b4423', '#c9a25b', '#111111'];

export class Renderer3D {
  constructor(canvas) {
    this.canvas = canvas;
    this.r = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#8fbbe3');
    this.scene.fog = new THREE.Fog('#8fbbe3', 110, 260);
    this.cam = new THREE.PerspectiveCamera(65, 1, 0.05, 500);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#4b7a3c', 2.2));
    const sun = new THREE.DirectionalLight('#fff3dc', 2.0);
    sun.position.set(40, 80, 30);
    this.scene.add(sun);

    this.shadowMat = new THREE.MeshBasicMaterial({ color: '#000', transparent: true, opacity: 0.28, depthWrite: false });
    this.buildPitch();
    this.buildGoals();
    this.buildStadium();
    this.buildBall();

    this.players = new Map();
    this.targetRing = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.78, 32), new THREE.MeshBasicMaterial({ color: '#ffd60a', transparent: true, opacity: 0.9, depthWrite: false }));
    this.targetRing.rotation.x = -Math.PI / 2;
    this.targetRing.visible = false;
    this.scene.add(this.targetRing);

    this.pitchAng = -0.15;
    this.camPos = new THREE.Vector3(0, 20, 40);
    this.camLook = new THREE.Vector3();
    this.mode = 'fp';
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.r.setSize(w, h, false);
    this.canvas.style.width = w + 'px';
    this.canvas.style.height = h + 'px';
    this.cam.aspect = w / h;
    this.cam.updateProjectionMatrix();
    this.w = w; this.h = h;
  }

  // ---------- Escenario ----------
  buildPitch() {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), lambert('#2f6a2c'));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.02;
    this.scene.add(ground);

    const tex = canvasTex(2048, 1024, (g, w, h) => {
      const n = 20;
      for (let i = 0; i < n; i++) {
        g.fillStyle = i % 2 ? '#3d8b3d' : '#357c35';
        g.fillRect((i * w) / n, 0, w / n + 1, h);
      }
      // textura de césped
      for (let i = 0; i < 26000; i++) {
        const v = Math.random();
        g.fillStyle = v < 0.5 ? 'rgba(0,0,0,.06)' : 'rgba(255,255,255,.05)';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    const pitch = new THREE.Mesh(new THREE.PlaneGeometry(L + 8, W + 8), new THREE.MeshLambertMaterial({ map: tex }));
    pitch.rotation.x = -Math.PI / 2;
    pitch.position.y = 0;
    this.scene.add(pitch);

    const lineMat = new THREE.MeshBasicMaterial({ color: '#f4f7f2', polygonOffset: true, polygonOffsetFactor: -2 });
    const lw = 0.12;
    const seg = (x1, y1, x2, y2) => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(len + lw, lw), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.rotation.z = -Math.atan2(y2 - y1, x2 - x1);
      m.position.copy(V((x1 + x2) / 2, (y1 + y2) / 2, 0.012));
      this.scene.add(m);
    };
    const rect = (x1, y1, x2, y2) => { seg(x1, y1, x2, y1); seg(x2, y1, x2, y2); seg(x2, y2, x1, y2); seg(x1, y2, x1, y1); };
    // arco: ángulos del motor t0..t1 (en el plano el ángulo se invierte)
    const arc = (cx, cy, r, t0, t1) => {
      const m = new THREE.Mesh(new THREE.RingGeometry(r - lw / 2, r + lw / 2, 64, 1, -t1, t1 - t0), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(V(cx, cy, 0.012));
      this.scene.add(m);
    };
    const spot = (x, y, r) => {
      const m = new THREE.Mesh(new THREE.CircleGeometry(r, 16), lineMat);
      m.rotation.x = -Math.PI / 2;
      m.position.copy(V(x, y, 0.012));
      this.scene.add(m);
    };
    rect(0, 0, L, W);
    seg(L / 2, 0, L / 2, W);
    arc(L / 2, W / 2, 9.15, 0, Math.PI * 2);
    spot(L / 2, W / 2, 0.2);
    for (const gx of [0, L]) {
      const d = gx === 0 ? 1 : -1;
      rect(gx, W / 2 - BOX_HALF, gx + d * BOX_D, W / 2 + BOX_HALF);
      rect(gx, W / 2 - 9.16, gx + d * 5.5, W / 2 + 9.16);
      spot(gx + d * 11, W / 2, 0.15);
      const a0 = Math.acos((BOX_D - 11) / 9.15);
      if (d > 0) arc(gx + 11, W / 2, 9.15, -a0, a0);
      else arc(gx - 11, W / 2, 9.15, Math.PI - a0, Math.PI + a0);
    }
    for (const [cx, cy, a0] of [[0, 0, 0], [L, 0, Math.PI / 2], [L, W, Math.PI], [0, W, -Math.PI / 2]]) arc(cx, cy, 1, a0, a0 + Math.PI / 2);
  }

  buildGoals() {
    const white = new THREE.MeshLambertMaterial({ color: '#ffffff' });
    const netTex = canvasTex(64, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.strokeStyle = 'rgba(255,255,255,.85)';
      g.lineWidth = 3;
      g.strokeRect(0, 0, w, h);
    }, [1, 1]);
    const net = (w, h, rx, ry) => {
      const t = netTex.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(rx, ry);
      return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false, opacity: 0.7 }));
    };
    const post = new THREE.CylinderGeometry(0.06, 0.06, GOAL_H, 12);
    const bar = new THREE.CylinderGeometry(0.06, 0.06, GOAL_HALF * 2 + 0.12, 12);
    const depth = 2.0;
    for (const gx of [0, L]) {
      const d = gx === 0 ? -1 : 1;
      for (const py of [W / 2 - GOAL_HALF, W / 2 + GOAL_HALF]) {
        const m = new THREE.Mesh(post, white);
        m.position.copy(V(gx, py, GOAL_H / 2));
        this.scene.add(m);
      }
      const cb = new THREE.Mesh(bar, white);
      cb.rotation.x = Math.PI / 2;
      cb.position.copy(V(gx, W / 2, GOAL_H));
      this.scene.add(cb);
      // red
      const back = net(GOAL_HALF * 2, GOAL_H, 28, 10);
      back.rotation.y = Math.PI / 2;
      back.position.copy(V(gx + d * depth, W / 2, GOAL_H / 2));
      this.scene.add(back);
      const top = net(depth, GOAL_HALF * 2, 8, 28);
      top.rotation.x = -Math.PI / 2;
      top.position.copy(V(gx + d * depth / 2, W / 2, GOAL_H));
      this.scene.add(top);
      for (const py of [W / 2 - GOAL_HALF, W / 2 + GOAL_HALF]) {
        const side = net(depth, GOAL_H, 8, 10);
        side.position.copy(V(gx + d * depth / 2, py, GOAL_H / 2));
        this.scene.add(side);
      }
    }
  }

  buildStadium() {
    const crowd = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#20262f'; g.fillRect(0, 0, w, h);
      const cols = ['#e5e7eb', '#ef4444', '#3b82f6', '#facc15', '#22c55e', '#111827', '#f97316', '#a855f7', '#f1c9a5', '#8d5a3b'];
      for (let row = 0; row < 16; row++) {
        g.fillStyle = row % 2 ? '#2a313c' : '#232a34';
        g.fillRect(0, row * 8, w, 8);
        for (let i = 0; i < 40; i++) {
          if (Math.random() < 0.12) continue;
          g.fillStyle = cols[Math.floor(Math.random() * cols.length)];
          const x = i * 6.4 + Math.random() * 1.5;
          g.fillRect(x, row * 8 + 1, 4, 4);
          g.fillStyle = SKINS[Math.floor(Math.random() * 5)];
          g.fillRect(x + 0.8, row * 8 - 1.5, 2.4, 2.4);
        }
      }
    }, [1, 1]);
    const stand = (len, cx, cy, rotY) => {
      const t = crowd.clone(); t.needsUpdate = true;
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(len / 22, 2.2);
      const g = new THREE.Group();
      const seats = new THREE.Mesh(new THREE.PlaneGeometry(len, 30), new THREE.MeshLambertMaterial({ map: t }));
      seats.rotation.x = -0.62;
      seats.position.set(0, 8.5, 0);
      g.add(seats);
      const roof = new THREE.Mesh(new THREE.BoxGeometry(len, 0.6, 18), lambert('#d1d5db'));
      roof.position.set(0, 21, -6);
      g.add(roof);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(len, 1.4, 0.4), lambert('#1e3a5f'));
      wall.position.set(0, 0.7, 12.5);
      g.add(wall);
      g.position.copy(V(cx, cy, 0));
      g.rotation.y = rotY;
      this.scene.add(g);
    };
    stand(L + 40, L / 2, -19, 0);
    stand(L + 40, L / 2, W + 19, Math.PI);
    stand(W + 20, -22, W / 2, Math.PI / 2);
    stand(W + 20, L + 22, W / 2, -Math.PI / 2);

    // vallas publicitarias
    const words = ['FÚTBOL·VIDA', 'CANTERA', 'LEYENDA', 'GOLAZO', 'CARRERA', 'BALÓN DE ORA'];
    const ads = canvasTex(1024, 64, (g, w, h) => {
      const cols = ['#0e3b6e', '#b91c1c', '#065f46', '#7c2d12', '#312e81', '#0f172a'];
      for (let i = 0; i < 6; i++) {
        g.fillStyle = cols[i]; g.fillRect((i * w) / 6, 0, w / 6, h);
        g.fillStyle = '#fff'; g.font = 'bold 22px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle';
        g.fillText(words[i], (i + 0.5) * w / 6, h / 2);
      }
    }, [1, 1]);
    const board = (len, x, y, rot) => {
      const t = ads.clone(); t.needsUpdate = true;
      t.wrapS = THREE.RepeatWrapping; t.repeat.set(len / 40, 1);
      const m = new THREE.Mesh(new THREE.BoxGeometry(len, 0.9, 0.12), [lambert('#111'), lambert('#111'), lambert('#111'), lambert('#111'), new THREE.MeshBasicMaterial({ map: t }), new THREE.MeshBasicMaterial({ map: t })]);
      m.position.copy(V(x, y, 0.45));
      m.rotation.y = rot;
      this.scene.add(m);
    };
    board(L + 10, L / 2, -4, 0);
    board(L + 10, L / 2, W + 4, 0);
    board(W / 2 - 6, -5, W / 4 - 2, Math.PI / 2);
    board(W / 2 - 6, -5, W * 0.75 + 2, Math.PI / 2);
    board(W / 2 - 6, L + 5, W / 4 - 2, Math.PI / 2);
    board(W / 2 - 6, L + 5, W * 0.75 + 2, Math.PI / 2);

    // focos
    const pole = new THREE.CylinderGeometry(0.4, 0.6, 40, 8);
    const lamp = new THREE.MeshBasicMaterial({ color: '#fffbe6' });
    for (const [x, y] of [[-24, -22], [L + 24, -22], [-24, W + 22], [L + 24, W + 22]]) {
      const m = new THREE.Mesh(pole, lambert('#9ca3af'));
      m.position.copy(V(x, y, 20));
      this.scene.add(m);
      const l = new THREE.Mesh(new THREE.BoxGeometry(6, 3, 0.6), lamp);
      l.position.copy(V(x, y, 41));
      l.lookAt(V(L / 2, W / 2, 0));
      this.scene.add(l);
    }
  }

  buildBall() {
    const tex = canvasTex(256, 128, (g, w, h) => {
      g.fillStyle = '#fafafa'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#1a1a1a';
      for (let i = 0; i < 12; i++) {
        const x = ((i % 6) + (i >= 6 ? 0.5 : 0)) * (w / 6) + 10, y = i >= 6 ? h * 0.72 : h * 0.28;
        g.beginPath();
        for (let k = 0; k < 5; k++) {
          const a = (k / 5) * Math.PI * 2;
          g.lineTo(x + Math.cos(a) * 13, y + Math.sin(a) * 13);
        }
        g.closePath(); g.fill();
      }
    });
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(0.11, 20, 14), new THREE.MeshLambertMaterial({ map: tex }));
    this.scene.add(this.ball);
    this.ballShadow = new THREE.Mesh(new THREE.CircleGeometry(0.16, 16), this.shadowMat);
    this.ballShadow.rotation.x = -Math.PI / 2;
    this.scene.add(this.ballShadow);
  }

  // ---------- Jugadores ----------
  makePlayer(p) {
    const t = p.team;
    const shirt = lambert(p.role === 'GK' ? t.gkColor : t.color);
    const shorts = lambert(p.role === 'GK' ? '#1f2937' : t.color2);
    const skinC = SKINS[(p.idx * 7 + t.side * 3) % 5];
    const skin = lambert(skinC);
    const boot = lambert('#111111');
    const hair = lambert(HAIRS[(p.idx * 3 + t.side) % 5]);

    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const mk = (geo, mat, x, y, z, parent = body) => {
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); parent.add(m); return m;
    };
    const legs = [];
    for (const side of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0, 0.92, side * 0.1); body.add(hip);
      mk(GEO.leg, skin, 0, -0.25, 0, hip);
      mk(GEO.sock, shorts, 0, -0.66, 0, hip);
      mk(GEO.boot, boot, 0.05, -0.88, 0, hip);
      legs.push(hip);
    }
    mk(GEO.shorts, shorts, 0, 0.98, 0);
    mk(GEO.torso, shirt, 0, 1.36, 0);
    mk(GEO.neck, skin, 0, 1.66, 0);
    mk(GEO.head, skin, 0.01, 1.78, 0);
    mk(GEO.hair, hair, -0.01, 1.8, 0);
    const arms = [];
    for (const side of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0, 1.58, side * 0.28); body.add(sh);
      mk(GEO.arm, shirt, 0, -0.16, 0, sh);
      mk(GEO.forearm, skin, 0.02, -0.45, 0, sh);
      arms.push(sh);
    }
    const shadow = new THREE.Mesh(GEO.shadow, this.shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.014;
    this.scene.add(shadow);
    // marca sobre la cabeza para reconocer a los compañeros
    let marker = null;
    if (this.userTeam === t && !p.isUser) {
      marker = new THREE.Mesh(new THREE.ConeGeometry(0.14, 0.24, 3), new THREE.MeshBasicMaterial({ color: '#7dd3fc' }));
      marker.rotation.x = Math.PI;
      marker.position.set(0, 2.25, 0);
      root.add(marker);
    }
    this.scene.add(root);
    return { root, body, legs, arms, shadow, marker };
  }

  syncPlayers(m) {
    this.userTeam = m.user ? m.user.team : null;
    for (const t of m.teams) {
      for (const p of t.players) {
        let o = this.players.get(p);
        if (!o) { o = this.makePlayer(p); this.players.set(p, o); }
        const vis = !p.sentOff && !(p.isUser && this.mode === 'fp' && this.following);
        o.root.visible = vis;
        o.shadow.visible = vis;
        if (p.sentOff) continue;
        o.root.position.copy(V(p.x, p.y, 0));
        o.shadow.position.set(p.x - L / 2 + 0.12, 0.014, p.y - W / 2);
        const lying = p.slide > 0 || p.dive > 0 || (p.stun > 0.6 && p.speed < 2);
        if (lying) {
          const a = p.dive > 0 ? Math.atan2(p.vy, p.vx) : p.face;
          o.root.rotation.y = -a;
          o.body.rotation.z = -1.35;
          o.body.position.y = 0.12;
          for (const l of o.legs) l.rotation.z = 0;
          for (const a2 of o.arms) a2.rotation.z = 2.8;
          continue;
        }
        o.root.rotation.y = -p.face;
        o.body.rotation.z = -Math.min(0.18, p.speed * 0.02);
        o.body.position.y = Math.abs(Math.sin(p.phase * 2.2)) * Math.min(1, p.speed / 5) * 0.05;
        const sw = Math.sin(p.phase * 2.2) * Math.min(1, p.speed / 4) * 0.75;
        o.legs[0].rotation.z = sw; o.legs[1].rotation.z = -sw;
        o.arms[0].rotation.z = -sw * 0.7; o.arms[1].rotation.z = sw * 0.7;
        if (p.holding && p.role === 'GK' && m.owner === p) { o.arms[0].rotation.z = 1.4; o.arms[1].rotation.z = 1.4; }
      }
    }
  }

  // ---------- Cámara ----------
  updateCamera(m, dt, yaw) {
    const u = m.user;
    this.following = !!(u && !u.sentOff && !m.userAI && this.mode !== '2d');
    const k = 1 - Math.exp(-dt * 6);
    if (this.following && this.mode === 'fp') {
      const owns = m.owner === u;
      const b = m.ball;
      // mirar hacia abajo al llevar el balón; arriba si viene por el aire
      let target = owns ? -0.44 : -0.08;
      if (!owns && b.z > 2 && Math.hypot(b.x - u.x, b.y - u.y) < 15) target = 0.1;
      this.pitchAng += (target - this.pitchAng) * (1 - Math.exp(-dt * 5));
      const bob = Math.sin(u.phase * 4.4) * Math.min(1, u.speed / 5) * 0.035;
      const fx = Math.cos(yaw), fy = Math.sin(yaw);
      this.eyeBack = (this.eyeBack ?? 0.32) + ((owns ? 0.7 : 0.32) - (this.eyeBack ?? 0.32)) * (1 - Math.exp(-dt * 6));
      const eb = this.eyeBack;
      const eye = V(u.x - fx * eb, u.y - fy * eb, 1.7 + bob);
      this.cam.position.copy(eye);
      const cp = Math.cos(this.pitchAng);
      this.cam.lookAt(eye.x + fx * cp, eye.y + Math.sin(this.pitchAng), eye.z + fy * cp);
      const fov = this.w < this.h ? 82 : 66;
      if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
      this.camPos.copy(eye);
      return;
    }
    let pos, look;
    if (this.following) {
      const fx = Math.cos(yaw), fy = Math.sin(yaw);
      pos = V(u.x - fx * 6, u.y - fy * 6, 3.2);
      look = V(u.x + fx * 7, u.y + fy * 7, 0.6);
    } else {
      // cámara de televisión
      const b = m.ball;
      pos = V(Math.max(-5, Math.min(L + 5, b.x)), W + 32, 24);
      look = V(b.x, b.y, 0);
    }
    this.camPos.lerp(pos, k);
    this.camLook.lerp(look, k);
    this.cam.position.copy(this.camPos);
    this.cam.lookAt(this.camLook);
    const fov = this.w < this.h ? 75 : 55;
    if (this.cam.fov !== fov) { this.cam.fov = fov; this.cam.updateProjectionMatrix(); }
  }

  snapCamera() { this.camPos.set(0, 20, 50); this.camLook.set(0, 0, 0); }

  render(m, dt, yaw, passTarget) {
    this.updateCamera(m, dt, yaw);
    this.syncPlayers(m);
    const b = m.ball;
    this.ball.position.copy(V(b.x, b.y, b.z + 0.11));
    const sp = Math.hypot(b.vx, b.vy);
    if (sp > 0.05) {
      const axis = new THREE.Vector3(b.vy, 0, -b.vx).normalize();
      this.ball.rotateOnWorldAxis(axis, (sp * dt) / 0.11);
    }
    this.ballShadow.position.set(b.x - L / 2 + b.z * 0.15, 0.016, b.y - W / 2);
    const sc = Math.max(0.5, 1 - b.z * 0.06);
    this.ballShadow.scale.set(sc, sc, sc);
    if (passTarget) {
      this.targetRing.visible = true;
      this.targetRing.position.set(passTarget.x - L / 2, 0.02, passTarget.y - W / 2);
    } else this.targetRing.visible = false;
    this.r.render(this.scene, this.cam);
  }

  // proyecta un punto del campo a la pantalla (para flechas del HUD)
  project(x, y, z) {
    const v = V(x, y, z).project(this.cam);
    const behind = v.z > 1;
    return { x: (v.x * 0.5 + 0.5) * this.w, y: (-v.y * 0.5 + 0.5) * this.h, behind };
  }

  dispose() {
    for (const o of this.players.values()) { this.scene.remove(o.root); this.scene.remove(o.shadow); }
    this.players.clear();
  }
}
