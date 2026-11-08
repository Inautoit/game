// Graba el vídeo promocional fotograma a fotograma con tiempo virtual (30 fps).
const { chromium } = require('playwright');
const fs = require('fs');
const OUT = process.argv[2];
const FR = 30, DT = 1000 / FR;
fs.rmSync(OUT + '/frames', { recursive: true, force: true });
fs.mkdirSync(OUT + '/frames', { recursive: true });

const INIT = () => {
  // ---- Tiempo virtual: rAF, setTimeout, performance.now, Date y animaciones CSS ----
  let vt = 0, tid = 1; const raf = []; let timers = [];
  performance.now = () => vt;
  const base = Date.now(); Date.now = () => base + vt;
  window.requestAnimationFrame = (cb) => { raf.push(cb); return raf.length; };
  window.cancelAnimationFrame = () => {};
  window.setTimeout = (fn, ms = 0, ...a) => { const id = tid++; timers.push({ id, t: vt + (ms || 0), fn, a }); return id; };
  window.clearTimeout = (id) => { timers = timers.filter((t) => t.id !== id); };
  window.setInterval = () => 0;
  localStorage.setItem('isla.seenHelp', 'true');
  localStorage.setItem('isla.draft', JSON.stringify({ world: 'pradera', verified: '', rows: [
    '#########', '#S......#', '#.......#', '#..#....#', '#..#.*..#', '#..#....#', '#.......#', '#...*...#', '#.......#', '#......G#', '#########'] }));

  // ---- Piloto automático: recoge gemas y va a la meta ----
  window.__ap = { on: false, vmax: 2.6 };
  function apStep() {
    const I = window.__isla; if (!I || I.state !== 'play') return;
    const L = I.level, B = I.B; if (B.spawn || B.falling) { I.release(); return; }
    const ox = (L.w - 1) / 2, oz = (L.h - 1) / 2, sx = Math.round(B.x + ox), sy = Math.round(B.z + oz);
    const walk = (c) => c && c !== '#' && c !== 'T' && c !== ' ' && c !== 'o';
    const prev = {}; const q = [[sx, sy]]; prev[sx + ',' + sy] = null;
    while (q.length) { const [x, y] = q.shift();
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy, k = nx + ',' + ny;
        if (k in prev || !walk((L.map[ny] || '')[nx])) continue; prev[k] = [x, y]; q.push([nx, ny]); } }
    const left = I.gems.filter((g) => !g.taken).map((g) => [Math.round(g.x + ox), Math.round(g.z + oz)]).filter(([x, y]) => (x + ',' + y) in prev);
    const dist = ([x, y]) => { let n = 0, c = [x, y]; while (c) { n++; c = prev[c[0] + ',' + c[1]]; } return n; };
    left.sort((a, b) => dist(a) - dist(b));
    const tgt = left[0] || L.goal;
    const path = []; let c = tgt; while (c) { path.unshift(c); c = prev[c[0] + ',' + c[1]]; }
    const nxt = path[Math.min(1, path.length - 1)];
    const tx = nxt[0] - ox, tz = nxt[1] - oz; const dx = tx - B.x, dz = tz - B.z; const d = Math.hypot(dx, dz) || 1;
    const ice = L.map[sy][sx] === '~'; const vmax = ice ? 1.5 : window.__ap.vmax;
    const ax = (dx / d * Math.min(vmax, d * 3.2) - B.vx) * 6, az = (dz / d * Math.min(vmax, d * 3.2) - B.vz) * 6, M = 0.24;
    const tX = Math.max(-M, Math.min(M, Math.asin(Math.max(-1, Math.min(1, az / 24)))));
    const tZ = Math.max(-M, Math.min(M, -Math.asin(Math.max(-1, Math.min(1, ax / 24)))));
    I.setTilt(tX, tZ);
    // Joystick visible con el dedo
    const st = document.getElementById('stick'), kn = document.getElementById('knob');
    st.classList.add('on');
    st.style.transform = `translate(${innerWidth / 2}px, ${innerHeight * 0.8}px)`;
    window.__knob = window.__knob || { x: 0, y: 0 };
    window.__knob.x += ((-tZ / M) * 64 - window.__knob.x) * 0.35;
    window.__knob.y += ((tX / M) * 64 - window.__knob.y) * 0.35;
    kn.style.transform = `translate(${window.__knob.x}px, ${window.__knob.y}px)`;
  }

  window.__vstep = (ms) => {
    vt += ms;
    timers.sort((a, b) => a.t - b.t);
    while (timers.length && timers[0].t <= vt) { const t = timers.shift(); try { t.fn(...t.a); } catch (e) { console.error(e); } }
    for (const an of document.getAnimations()) { an.pause(); an.__vt = (an.__vt || 0) + ms; an.currentTime = an.__vt; }
    if (window.__ap.on) apStep();
    raf.splice(0).forEach((cb) => cb(vt));
  };

  // ---- Capas del vídeo: texto, destello y cartel final ----
  addEventListener('DOMContentLoaded', () => {
    const css = document.createElement('style');
    css.textContent = `
      .banner, .hint { display: none !important; }
      #knob::after { content: '👆'; position: absolute; left: 6px; top: 12px; font-size: 40px; }
      #cap { position: fixed; left: 50%; top: 16%; z-index: 40; width: max-content; max-width: 88vw; box-sizing: border-box; text-align: center;
        padding: 14px 24px; border-radius: 24px; background: #fff; color: #2f2540;
        font: 700 32px/1.15 Fredoka, system-ui; box-shadow: 0 10px 30px rgba(47,37,64,.25), 0 4px 0 rgba(47,37,64,.12);
        opacity: 0; transform: translate(-50%, 0); pointer-events: none; }
      #cap.big { top: 13%; font-size: 40px; padding: 20px 28px; }
      #flash { position: fixed; inset: 0; z-index: 45; background: #fff; opacity: 0; pointer-events: none; }
      #end { position: fixed; inset: 0; z-index: 50; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 18px;
        background: linear-gradient(180deg, rgba(191,232,255,.88), rgba(255,230,242,.92)); opacity: 0; pointer-events: none; text-align: center; }
      #end img { width: 190px; height: 190px; border-radius: 44px; box-shadow: 0 18px 40px rgba(56,120,200,.35); }
      #end .wm { font: 700 76px/.9 Fredoka; color: #2f8fe0; text-shadow: 0 5px 0 #fff; }
      #end .wm span { color: #ff4f8b; }
      #end .t1 { font: 600 30px Fredoka; color: #2f2540; }
      #end .url { font: 700 25px Fredoka; color: #fff; background: linear-gradient(135deg,#ff7a59,#ff4f8b); padding: 14px 24px; border-radius: 999px; box-shadow: 0 6px 0 #d23a6c; }
      #end .t2 { font: 500 22px Fredoka; color: #6e6380; }`;
    document.head.appendChild(css);
    const cap = document.createElement('div'); cap.id = 'cap'; document.body.appendChild(cap);
    const fl = document.createElement('div'); fl.id = 'flash'; document.body.appendChild(fl);
    const end = document.createElement('div'); end.id = 'end';
    end.innerHTML = `<img src="icons/icon.svg" alt=""><div class="wm">ISLA<br><span>RODANTE</span></div>
      <div class="t1">Juega gratis · sin descargas</div><div class="url">isla-rodante.inautoit.workers.dev</div>
      <div class="t2">iPhone · iPad · Android · PC</div>`;
    document.body.appendChild(end);
  });
};

(async () => {
  const b = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await b.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => console.log('ERR', e.message));
  await p.addInitScript(INIT);
  const cdp = await ctx.newCDPSession(p);
  await p.goto('http://localhost:8124/');
  await p.waitForTimeout(2500);

  let frame = 0, flash = 0;
  const timeline = [];
  const caption = { text: '', t: 0, len: 0, big: false };
  const setCap = (text, secs, big = false) => Object.assign(caption, { text, t: 0, len: secs, big });
  const ff = async (n) => { for (let i = 0; i < n; i++) await p.evaluate((d) => __vstep(d), DT); };
  const shot = async (n, each) => {
    for (let i = 0; i < n; i++) {
      if (each) await each(i);
      const ct = caption.t, a = caption.text ? Math.min(1, ct / 0.25, Math.max(0, (caption.len - ct) / 0.25)) : 0;
      await p.evaluate(({ d, cap, a, big, ct, flash }) => {
        __vstep(d);
        const c = document.getElementById('cap');
        c.textContent = cap; c.classList.toggle('big', big);
        c.style.opacity = a;
        const k = Math.min(1, ct / 0.3);
        c.style.transform = `translate(-50%, ${(1 - k) * 20}px) scale(${0.9 + 0.1 * (1 - (1 - k) ** 3)})`;
        document.getElementById('flash').style.opacity = flash;
      }, { d: DT, cap: caption.text, a, big: caption.big, ct, flash });
      let data = null;
      for (let tries = 0; tries < 4 && !data; tries++) {
        try {
          data = (await Promise.race([cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 92, clip: { x: 0, y: 0, width: 540, height: 960, scale: 2 } }),
            new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 120000))])).data;
        } catch (e) { console.log('reintento captura', frame, e.message); }
      }
      if (!data) throw new Error('no se pudo capturar el fotograma ' + frame);
      fs.writeFileSync(`${OUT}/frames/${String(frame).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'));
      frame++; caption.t += 1 / FR; flash = Math.max(0, flash - 0.17);
      if (frame % 60 === 0) console.log('fotograma', frame);
    }
  };
  const cut = () => { flash = 1; timeline.push({ cut: frame / FR }); };

  await ff(90); // pantalla de carga
  // A — Gancho
  await p.evaluate(() => { document.getElementById('menu').classList.remove('open'); });
  await ff(12);
  setCap('¿Eres capaz de llegar a la meta? 🏝️', 3.0, true);
  await shot(90);

  // B — Pradera
  cut();
  await p.evaluate(() => { __isla.startLevel(0, 4); __ap.on = true; });
  setCap('Inclina la isla con el dedo 👆', 6.6);
  await shot(210);

  // C — Desierto sin barandillas
  cut();
  await p.evaluate(() => { __isla.startLevel(1, 5); });
  setCap('Sin barandillas… ¡no te caigas! 😱', 5.3);
  await shot(165);

  // D — Hielo
  cut();
  await p.evaluate(() => { __isla.startLevel(2, 0); });
  setCap('Hielo que resbala ❄️', 5.3);
  await shot(165);

  // E — Victoria con 3 estrellas (se avanza rápido hasta cerca de la meta)
  await p.evaluate(() => { __isla.startLevel(0, 1); });
  for (let i = 0; i < 1200; i++) {
    await ff(1);
    const near = await p.evaluate(() => { const I = __isla, L = I.level; const d = Math.hypot(I.B.x - (L.goal[0] - (L.w - 1) / 2), I.B.z - (L.goal[1] - (L.h - 1) / 2)); return I.gemsTaken === I.gems.length && d < 1.6; });
    if (near) break;
  }
  cut();
  setCap('¡Consigue las 3 estrellas! ⭐', 4.4);
  let winAt = null;
  await shot(135, async () => { if (winAt === null && await p.evaluate(() => __isla.state === 'done')) { winAt = frame / FR; timeline.push({ win: winAt }); } });

  // F — Comunidad y editor
  cut();
  await p.evaluate(() => { document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')); __ap.on = false; __isla.release(); document.getElementById('stick').classList.remove('on'); __isla.showCommunity(); });
  await p.waitForTimeout(1500); // carga de mapas (red local)
  await ff(2);
  setCap('Juega mapas de otros jugadores 🌍', 1.9);
  await shot(57, async (i) => { if (i > 15) await p.evaluate(() => { document.getElementById('comList').scrollTop += 4; }); });
  cut();
  await p.evaluate(() => { __isla.showEditor(); });
  await ff(3);
  await p.click('.tool[data-c="#"]');
  const box = await p.locator('#edCanvas').boundingBox();
  const cw = box.width / 9, ch = box.height / 11;
  setCap('…o crea los tuyos 🛠️', 2.2);
  const path = [[5, 2], [6, 2], [7, 2], [7, 3], [6, 6], [5, 6], [4, 6], [3, 8], [4, 8], [5, 8], [6, 8]];
  await shot(66, async (i) => {
    const k = Math.floor((i - 8) / 5);
    if (i >= 8 && (i - 8) % 5 === 0 && k < path.length) {
      const [x, y] = path[k];
      await p.mouse.click(box.x + cw * (x + 0.5), box.y + ch * (y + 0.5));
    }
  });

  // G — Cartel final
  cut();
  await p.evaluate(() => { __isla.showEditor(); }); // mantiene el fondo estable
  await p.evaluate(() => { document.getElementById('editor').classList.remove('open'); });
  await p.evaluate(() => { window.__isla.startLevel(0, 4); __ap.on = false; });
  setCap('', 0);
  await shot(105, async (i) => {
    await p.evaluate((i) => {
      const e = document.getElementById('end'), k = Math.min(1, i / 12);
      e.style.opacity = k;
      e.firstElementChild.style.transform = `scale(${0.7 + 0.3 * (1 - (1 - k) ** 3)}) rotate(${Math.sin(i / 10) * 3}deg)`;
      e.querySelector('.url').style.transform = `scale(${1 + Math.max(0, Math.sin(i / 7)) * 0.04})`;
    }, i);
  });

  fs.writeFileSync(OUT + '/timeline.json', JSON.stringify({ frames: frame, fps: FR, events: timeline }));
  console.log('TOTAL fotogramas', frame, JSON.stringify(timeline));
  await b.close();
})();
