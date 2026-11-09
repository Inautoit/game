// Pruebas de extremo a extremo en un navegador de verdad (Playwright + Chromium).
// Uso:  (cd slot && python3 -m http.server 8130 &)  y luego  node slot/tests/e2e.js [filtro]
// Las pruebas que tocan el servidor usan el de producción (https://turbo-slot.inautoit.workers.dev) y limpian lo que crean.
const { chromium } = require('playwright');
const BASE = process.env.BASE || 'http://localhost:8130/index.html';
const API = 'https://turbo-slot.inautoit.workers.dev';
const OUT = process.env.OUT || '/tmp';
const only = process.argv.slice(2);   // uno o varios filtros: se ejecutan las pruebas cuyo nombre contenga alguno

const VIEWPORTS = {
  movil: { width: 390, height: 844, isMobile: true, hasTouch: true },
  movilH: { width: 844, height: 390, isMobile: true, hasTouch: true },
  ipad: { width: 820, height: 1180, isMobile: true, hasTouch: true },
  ipadH: { width: 1180, height: 820, isMobile: true, hasTouch: true },
  pc: { width: 1440, height: 900 },
  mini: { width: 480, height: 300 },   // para las pruebas de juego: pinta rápido
};
const assert = (c, msg) => { if (!c) throw new Error(msg); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let browser;
async function open(vp = 'mini', { init, route } = {}) {
  const ctx = await browser.newContext({ viewport: { width: VIEWPORTS[vp].width, height: VIEWPORTS[vp].height }, isMobile: !!VIEWPORTS[vp].isMobile, hasTouch: !!VIEWPORTS[vp].hasTouch, deviceScaleFactor: 1 });
  const p = await ctx.newPage();
  p.errors = [];
  p.on('pageerror', (e) => p.errors.push('pageerror: ' + e.message));
  p.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of (404|401|409|429)/.test(m.text())) p.errors.push('console: ' + m.text().slice(0, 300)); });
  if (init) await p.addInitScript(init);
  if (route) await route(p);
  await p.goto(BASE, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await p.waitForFunction(() => window.__slot && document.getElementById('menu').classList.contains('open'), null, { timeout: 90000 });
  await p.evaluate(() => { try { localStorage.setItem('slot.seenHelp2', 'true'); } catch {} document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')); });
  return p;
}
const close = async (p) => { await p.context().close(); };
const noErrors = (p) => assert(!p.errors.length, 'errores en la página:\n    ' + p.errors.join('\n    '));
const state = (p) => p.evaluate(() => window.__slot.state);
const click = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); if (!e) throw new Error('no existe ' + s); e.click(); }, sel);
// ¿Se ve? Espera hasta 3 s (las ventanas aparecen con un fundido y este navegador de pruebas va lento)
const visible = (p, sel, wait = 3000) => p.waitForFunction((s) => { const e = document.querySelector(s); if (!e) return false; const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && +cs.opacity > 0.05; }, sel, { timeout: wait }).then(() => true, () => false);
async function startRace(p, id, mode = '1p', extra = {}) {
  await p.evaluate(async ([id, mode, extra]) => {
    const S = window.__slot; const m = await import('./src/tracks.js');
    const entries = [{ liv: S.LIVERIES[0], setupRaw: S.DEFAULT_SETUP, carId: 'gt22' }];
    if (mode === '2p') entries.push({ liv: S.LIVERIES[1], setupRaw: S.DEFAULT_SETUP, carId: 'f1' });
    S.startRace({ def: m.findTrack(id), mode, entries, ...extra });
  }, [id, mode, extra]);
}
async function skipIntro(p) {
  if ((await state(p)) === 'intro') await p.mouse.click(5, 5);
  await p.waitForFunction(() => window.__slot.state !== 'intro', null, { timeout: 20000 });
}
async function waitRace(p, timeout = 60000) { await p.waitForFunction(() => window.__slot.state === 'race' && window.__slot.race.started, null, { timeout }); }

const tests = [];
const T = (name, fn) => tests.push({ name, fn });

// ---------------------------------------------------------------- Pantallas
for (const vp of ['movil', 'movilH', 'ipad', 'ipadH', 'pc']) T(`pantallas en ${vp}: menú, circuitos, taller y ajustes sin cortes`, async () => {
  const p = await open(vp);
  const check = async (where) => {
    const r = await p.evaluate(() => {
      const out = [];
      if (document.documentElement.scrollWidth > innerWidth + 1) out.push('scroll horizontal ' + document.documentElement.scrollWidth);
      const scr = document.querySelector('.screen.open');
      const btns = [...(scr ? scr.querySelectorAll('button') : [])].filter((b) => { const r = b.getBoundingClientRect(); const cs = getComputedStyle(b); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && !b.closest('[hidden]') && !b.closest('.car-pick') && !b.closest('.circ-list') && !b.closest('#circList') && !b.closest('.tabs'); });
      for (const b of btns) { const r = b.getBoundingClientRect(); if (r.right > innerWidth + 1 || r.left < -1) out.push('botón fuera de la pantalla: ' + (b.id || b.textContent.trim().slice(0, 20))); }
      return out;
    });
    assert(!r.length, `${where}: ${r.join(' · ')}`);
  };
  await check('menú');
  // Los botones del menú no se pisan y caben enteros
  const ov = await p.evaluate(() => {
    const items = [...document.querySelectorAll('#menu .mi')].map((e) => e.getBoundingClientRect());
    const bad = [];
    items.forEach((a, i) => { if (a.bottom > innerHeight + 1) bad.push('botón del menú cortado abajo'); items.forEach((b, j) => { if (j > i && a.left < b.right - 2 && b.left < a.right - 2 && a.top < b.bottom - 2 && b.top < a.bottom - 2) bad.push(`menú ${i} pisa ${j}`); }); });
    return bad;
  });
  assert(!ov.length, ov.join(', '));
  await click(p, '#playPrac'); await sleep(500);
  await check('circuitos');
  for (const tab of ['oficial', 'premium', 'mios', 'comunidad']) {
    await click(p, `#circTabs button[data-tab="${tab}"]`); await sleep(tab === 'comunidad' ? 2500 : 300);
    const n = await p.evaluate(() => document.querySelectorAll('#circList .circ, #circList .circ-empty').length);
    assert(n > 0, 'pestaña vacía: ' + tab);
  }
  await click(p, '#circTabs button[data-tab="oficial"]'); await sleep(300);
  await click(p, '#circList .circ'); await sleep(600);
  assert((await state(p)) === 'garage', 'no abre el taller');
  await check('taller');
  const cut = await p.evaluate(() => [...document.querySelectorAll('#garage .seg button')].filter((b) => { const r = b.getBoundingClientRect(); const pr = b.parentElement.getBoundingClientRect(); return r.width > 0 && (r.right > pr.right + 1 || b.scrollWidth > b.clientWidth + 2); }).map((b) => b.textContent));
  assert(!cut.length, 'opciones del reglaje cortadas: ' + cut.join(', '));
  await click(p, '#garBack'); await sleep(300); await click(p, '#circBack'); await sleep(300);
  await click(p, '#menu [data-open="mSettings"]'); await sleep(400);
  const sheet = await p.evaluate(() => { const s = document.querySelector('#mSettings .sheet').getBoundingClientRect(); return { w: s.width, right: s.right }; });
  assert(sheet.right <= (await p.evaluate(() => innerWidth)) + 1, 'ajustes se salen de la pantalla');
  await p.screenshot({ path: `${OUT}/e2e_${vp}.png` });
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Carreras en todos los circuitos
for (const id of ['ovalo', 'rinon', 'ocho', 'horquilla', 'chicane', 'gp', 'montana', 'autodromo', 'internacional', 'resistencia', 'pico-xl', 'puerto-xl']) T(`carrera en ${id}: presentación, salida y 4 coches`, async () => {
  const p = await open('mini');
  await startRace(p, id, '1p');
  assert((await state(p)) === 'intro', 'no hay presentación');
  await sleep(1200);
  await skipIntro(p);
  assert((await state(p)) === 'countdown', 'tras la presentación no hay cuenta atrás');
  await p.evaluate(() => window.__slot.setPad(0, 0.55));
  await waitRace(p);
  const r = await p.evaluate(() => ({ n: window.__slot.cars.length, ok: window.__slot.cars.every((c) => Number.isFinite(c.st.s) && Number.isFinite(c.st.v)) }));
  assert(r.n === 4 && r.ok, 'coches mal: ' + JSON.stringify(r));
  await sleep(1500);
  const moved = await p.evaluate(() => window.__slot.cars.filter((c) => c.st.v > 0.05 || c.lap > 0).length);
  assert(moved >= 3, 'los coches no se mueven: ' + moved);
  noErrors(p); await close(p);
});

T('práctica, pausa, reanudar, cámaras y salir', async () => {
  const p = await open('mini');
  await startRace(p, 'gp', 'practica');
  await skipIntro(p);
  await waitRace(p);
  const n = await p.evaluate(() => window.__slot.cars.length); assert(n === 1, 'en práctica hay ' + n + ' coches');
  await click(p, '#pauseBtn'); await sleep(300);
  assert((await state(p)) === 'pause', 'no pausa');
  assert(await visible(p, '#pauseRank'), 'falta el botón de ranking en la pausa');
  await click(p, '#resumeBtn'); await sleep(300);
  assert((await state(p)) === 'race', 'no reanuda');
  for (let i = 0; i < 4; i++) { await click(p, '#camBtn'); await sleep(250); }
  await click(p, '#pauseBtn'); await sleep(200); await click(p, '#quitBtn'); await sleep(800);
  assert(['menu', 'circuits', 'garage'].includes(await state(p)), 'al salir queda en ' + (await state(p)));
  noErrors(p); await close(p);
});

T('2 jugadores: dos humanos y dos CPU', async () => {
  const p = await open('mini');
  await startRace(p, 'chicane', '2p');
  await skipIntro(p); await waitRace(p);
  const r = await p.evaluate(() => window.__slot.cars.map((c) => c.human));
  assert(r.filter(Boolean).length === 2 && r.length === 4, JSON.stringify(r));
  noErrors(p); await close(p);
});

T('carrera completa hasta la meta: resultados y otra vez', async () => {
  const p = await open('mini');
  await startRace(p, 'ovalo', '1p', { laps: 1 });
  await skipIntro(p);
  await p.evaluate(() => { setInterval(() => { const S = window.__slot; const c = S.cars.find((x) => x.human); if (!c) return; S.setPad(0, c.tel && c.tel.dangerS > 0.8 ? 0.1 : 0.75); }, 30); });
  await p.waitForFunction(() => document.getElementById('mResults').classList.contains('open'), null, { timeout: 120000 });
  const rows = await p.evaluate(() => document.querySelectorAll('#resTable > *').length);
  assert(rows >= 4, 'tabla de resultados con ' + rows + ' filas');
  await click(p, '#againBtn'); await sleep(800);
  assert(['intro', 'countdown'].includes(await state(p)), 'otra vez no vuelve a empezar: ' + (await state(p)));
  noErrors(p); await close(p);
});

T('campeonato: empieza la primera carrera de la copa', async () => {
  const p = await open('mini');
  await click(p, '#playChamp'); await sleep(600);
  const cups = await p.evaluate(() => document.querySelectorAll('#chList .cup').length);
  assert(cups > 0, 'no hay copas');
  await click(p, '#chList .cup'); await sleep(600);
  assert((await state(p)) === 'garage', 'la copa no lleva al taller: ' + (await state(p)));
  await click(p, '#garGo');
  await p.waitForFunction(() => ['intro', 'countdown'].includes(window.__slot.state), null, { timeout: 20000 });
  assert(await p.evaluate(() => !!window.__slot.race.champ), 'la carrera no es del campeonato');
  await skipIntro(p); await waitRace(p);
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Editor
T('editor: empieza con la meta, piezas, completar, guardar, probar y borrar', async () => {
  const p = await open('mini');
  await click(p, '#playEditor'); await sleep(500);
  assert((await state(p)) === 'editor', 'no abre el editor');
  const n0 = await p.evaluate(() => document.getElementById('edInfo').textContent);
  assert(/1 pieza/.test(n0) || /pieza/.test(n0), 'info del editor: ' + n0);
  for (let i = 0; i < 3; i++) await click(p, '#edPalette button:nth-child(2)');
  await click(p, '#edPalette button:nth-child(4)');
  await click(p, '#edFinish'); await sleep(300);
  const info = await p.evaluate(() => document.getElementById('edInfo').textContent);
  assert(/cerrado/.test(info), 'no queda cerrado: ' + info);
  await click(p, '#edSave'); await sleep(300);
  await p.fill('#saveName', 'Prueba E2E'); await click(p, '#saveGo'); await sleep(400);
  await click(p, '#edTest'); await sleep(1500);
  assert(['intro', 'countdown', 'race'].includes(await state(p)), 'probar no arranca: ' + (await state(p)));
  await skipIntro(p);
  await click(p, '#pauseBtn'); await sleep(200); await click(p, '#quitBtn'); await sleep(800);
  // En «Mis circuitos» está y se puede borrar
  await p.evaluate(() => { document.getElementById('playPrac').click(); });
  await sleep(400); await click(p, '#circTabs button[data-tab="mios"]'); await sleep(300);
  const has = await p.evaluate(() => [...document.querySelectorAll('#circList .circ')].some((b) => /Prueba E2E/.test(b.textContent)));
  assert(has, 'el circuito guardado no aparece en Mis circuitos');
  await p.evaluate(() => { const d = [...document.querySelectorAll('#circList .circ-wrap')].find((w) => /Prueba E2E/.test(w.textContent)).querySelector('.del'); d.click(); d.click(); });
  await sleep(300);
  const gone = await p.evaluate(() => ![...document.querySelectorAll('#circList .circ')].some((b) => /Prueba E2E/.test(b.textContent)));
  assert(gone, 'no se borra');
  noErrors(p); await close(p);
});

T('publicar exige aceptar las normas (sin publicar de verdad)', async () => {
  const p = await open('mini');
  await click(p, '#playEditor'); await sleep(400);
  await click(p, '#edFinish'); await sleep(200);
  await click(p, '#edPublish'); await sleep(400);
  await p.fill('#pubName', 'No publicar'); await p.fill('#pubAuthor', 'Tester');
  await click(p, '#pubGo'); await sleep(300);
  const msg = await p.evaluate(() => document.getElementById('pubMsg').textContent);
  assert(/normas/.test(msg), 'no pide aceptar las normas: ' + msg);
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Comunidad y moderación
T('comunidad: ocultar un circuito, verlo en Ajustes y volver a mostrarlo', async () => {
  const p = await open('mini');
  await click(p, '#playPrac'); await sleep(300);
  await click(p, '#circTabs button[data-tab="comunidad"]');
  await p.waitForFunction(() => document.querySelectorAll('#circList .circ-wrap').length > 0, null, { timeout: 20000 });
  const before = await p.evaluate(() => document.querySelectorAll('#circList .circ-wrap').length);
  await p.evaluate(() => [...document.querySelectorAll('#circList .circ-act button')].find((b) => b.textContent === 'Ocultar').click());
  await sleep(500);
  const after = await p.evaluate(() => document.querySelectorAll('#circList .circ-wrap').length);
  assert(after === before - 1, `ocultar no lo quita (${before} → ${after})`);
  // La ventana de denuncia se abre y se cierra (sin denunciar de verdad)
  await p.evaluate(() => [...document.querySelectorAll('#circList .circ-act button')].find((b) => b.textContent === 'Denunciar').click());
  await sleep(300); assert(await visible(p, '#mReport'), 'no abre la denuncia');
  await p.evaluate(() => document.querySelector('#mReport [data-close]').click()); await sleep(300);
  await click(p, '#circBack'); await sleep(300);
  await click(p, '#menu [data-open="mSettings"]'); await sleep(300);
  assert(await visible(p, '#hiddenRow'), 'Ajustes no muestra lo oculto');
  await click(p, '#unhideBtn'); await sleep(200);
  assert(!(await visible(p, '#hiddenRow', 300)), 'no se vuelve a mostrar');
  noErrors(p); await close(p);
});

T('ajustes: se guardan al recargar; créditos y contacto', async () => {
  const p = await open('mini');
  await click(p, '#menu [data-open="mSettings"]'); await sleep(300);
  await p.evaluate(() => { const m = document.getElementById('optMusic'); m.checked = false; m.dispatchEvent(new Event('change')); const t = document.getElementById('optTele'); t.checked = false; t.dispatchEvent(new Event('change')); });
  await p.reload({ waitUntil: 'domcontentloaded' }); await p.waitForFunction(() => window.__slot);
  const s = await p.evaluate(() => JSON.parse(localStorage.getItem('slot.settings')));
  assert(s.music === false && s.tele === false, 'los ajustes no se guardan: ' + JSON.stringify(s));
  await p.evaluate(() => document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')));
  await click(p, '#menu [data-open="mSettings"]'); await sleep(300);
  await click(p, '#mSettings [data-open="mCredits"]'); await sleep(300);
  assert(await visible(p, '#mCredits'), 'no abren los créditos');
  const txt = await p.evaluate(() => document.querySelector('#mCredits .credits').textContent);
  for (const w of ['Lexyc16', 'Márcio Meireles', 'TheoDev', 'YDEVASHISH', 'Quaternius', 'Poly Haven', 'ambientCG', 'BigSoundBank', 'three.js', 'Barlow']) assert(txt.includes(w), 'falta en créditos: ' + w);
  await p.evaluate(() => document.querySelector('#mCredits [data-close]').click()); await sleep(200);
  await click(p, '#openFeedback'); await sleep(300);
  await p.fill('#fbMsg', 'hey'); await click(p, '#fbGo'); await sleep(300);
  assert(/más/.test(await p.evaluate(() => document.getElementById('fbMsgOut').textContent)), 'acepta un mensaje vacío');
  noErrors(p); await close(p);
});

T('páginas de privacidad y normas: cargan y se pueden leer enteras', async () => {
  const p = await open('movil');
  for (const page of ['privacidad.html', 'normas.html']) {
    await p.goto(BASE.replace('index.html', page));
    const r = await p.evaluate(() => ({ h: document.documentElement.scrollHeight, vh: innerHeight, over: getComputedStyle(document.body).overflow, sw: document.documentElement.scrollWidth, w: innerWidth, title: document.querySelector('h1').textContent }));
    assert(r.over !== 'hidden', page + ': no se puede desplazar');
    assert(r.sw <= r.w + 1, page + ': se sale por los lados');
    await p.evaluate(() => window.scrollTo(0, 99999)); await sleep(200);
    const y = await p.evaluate(() => scrollY);
    assert(r.h <= r.vh || y > 0, page + ': no baja');
  }
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Ranking
T('ranking mundial: se abre desde el taller y desde la pausa', async () => {
  const p = await open('mini');
  await click(p, '#playPrac'); await sleep(300); await click(p, '#circList .circ'); await sleep(500);
  assert(await visible(p, '#garRank'), 'falta el botón de ranking en el taller');
  await click(p, '#garRank');
  await p.waitForFunction(() => !/Cargando/.test(document.getElementById('rkList').textContent), null, { timeout: 15000 });
  await click(p, '#rkTabs button[data-cls="pro"]'); await sleep(1500);
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Cuentas
T('cuenta: crear, salir, entrar, contraseña mal y borrar la cuenta', async () => {
  const user = 'e2e' + Math.random().toString(36).slice(2, 9), pass = 'clave-e2e-123';
  const p = await open('mini');
  await click(p, '#accBtn'); await sleep(300);
  await click(p, '#accTabs button[data-v="register"]');
  await p.fill('#accRU', user); await p.fill('#accRP', pass); await p.fill('#accRP2', pass);
  await click(p, '#accRegGo');
  await p.waitForSelector('#acc-code:not([hidden])', { timeout: 20000 });
  const code = await p.textContent('#accCode');
  assert(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code), 'código raro: ' + code);
  await click(p, '#accCodeOk'); await sleep(2500);
  assert(/Todo guardado|Sincronizando|Conectado/.test(await p.textContent('#accSync')), 'no sincroniza');
  // Borrar mi progreso con la cuenta abierta: se vacía también la nube y la sesión sigue
  await p.evaluate(() => { localStorage.setItem('slot.best', JSON.stringify({ 'ovalo|iman': 3.3 })); document.dispatchEvent(new Event('visibilitychange')); });
  await sleep(3500);
  const cloud1 = await p.evaluate(async (api) => { const a = JSON.parse(localStorage.getItem('slot.account')); return (await (await fetch(api + '/api/profile', { headers: { authorization: 'Bearer ' + a.token } })).json()).data; }, API);
  assert(cloud1.keys && cloud1.keys.best && cloud1.keys.best['ovalo|iman'] === 3.3, 'el récord no llega a la nube: ' + JSON.stringify(cloud1).slice(0, 200));
  await p.evaluate(() => document.querySelectorAll('.modal.open').forEach((m) => m.classList.remove('open')));
  await click(p, '#menu [data-open="mSettings"]'); await sleep(300);
  await click(p, '#resetBtn'); await sleep(200); await click(p, '#resetYes'); await sleep(3500);
  const after = await p.evaluate(async (api) => { const a = JSON.parse(localStorage.getItem('slot.account')); if (!a) return 'sin sesión'; return (await (await fetch(api + '/api/profile', { headers: { authorization: 'Bearer ' + a.token } })).json()).data; }, API);
  assert(after !== 'sin sesión', 'borrar el progreso cierra la sesión');
  assert(!after.keys || !after.keys.best, 'el progreso de la nube no se borra: ' + JSON.stringify(after).slice(0, 200));
  await click(p, '#accBtn'); await sleep(300);
  await click(p, '#accLogout'); await sleep(800);
  await p.fill('#accLU', user); await p.fill('#accLP', 'mala-clave'); await click(p, '#accLoginGo'); await sleep(1500);
  assert(/incorrect/.test(await p.textContent('#accMsg')), 'entra con una contraseña mala');
  await p.fill('#accLP', pass); await click(p, '#accLoginGo');
  await p.waitForSelector('#acc-me:not([hidden])', { timeout: 20000 });
  await click(p, '#accDelAsk'); await sleep(200);
  await p.fill('#accDelP', 'otra-mala'); await click(p, '#accDelGo'); await sleep(1500);
  assert(/incorrecta/.test(await p.textContent('#accMsg')), 'borra con contraseña mala');
  await p.fill('#accDelP', pass); await click(p, '#accDelGo');
  await p.waitForSelector('#acc-login:not([hidden])', { timeout: 20000 });
  const st = await p.evaluate(async ([u, body]) => (await fetch(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body })).status, [API + '/api/auth/login', JSON.stringify({ name: user, password: pass })]);
  assert(st === 401, 'la cuenta borrada sigue entrando: ' + st);
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- Online
T('online: sala con dos jugadores, presentación igual para los dos y salida', async () => {
  const a = await open('mini'), b = await open('mini');
  for (const [p, n] of [[a, 'Ana'], [b, 'Beto']]) { await click(p, '#playOnline'); await sleep(300); await p.fill('#onName', n); }
  await click(a, '#onCreate');
  await a.waitForFunction(() => window.__slot.room && window.__slot.room.codeShown, null, { timeout: 20000 });
  const code = await a.evaluate(() => window.__slot.room.codeShown);
  await b.fill('#onCode', code); await click(b, '#onEnter');
  await b.waitForFunction(() => window.__slot.roomState && window.__slot.roomState.players.length === 2, null, { timeout: 30000 });
  await click(a, '#onPickTrack'); await sleep(500); await click(a, '#circList .circ'); await sleep(1500);
  await click(b, '#onReady'); await sleep(2000);
  await click(a, '#onReady');
  await a.waitForFunction(() => window.__slot.state === 'intro', null, { timeout: 20000 });
  await b.waitForFunction(() => window.__slot.state === 'intro', null, { timeout: 20000 });
  await b.mouse.click(5, 5); await sleep(300);
  assert((await state(b)) === 'intro', 'en el online se puede saltar la presentación');
  await a.waitForFunction(() => window.__slot.state === 'race', null, { timeout: 60000 });
  await b.waitForFunction(() => window.__slot.state === 'race', null, { timeout: 60000 });
  noErrors(a); noErrors(b); await close(a); await close(b);
});

// ---------------------------------------------------------------- App nativa (Capacitor simulado)
const nativeMock = (latest) => `
  window.__calls = [];
  const rec = (n) => (...a) => { window.__calls.push([n, a[0]]); return Promise.resolve(n === 'download' ? { id: 'b1', version: (a[0] || {}).version } : n === 'current' ? { native: '1.0', bundle: { version: 'builtin' } } : undefined); };
  window.Capacitor = { isNativePlatform: () => true, Plugins: {
    Haptics: { impact: rec('impact') }, StatusBar: { hide: rec('hide') },
    CapacitorUpdater: { notifyAppReady: rec('notifyAppReady'), current: rec('current'), download: rec('download'), next: rec('next') } } };`;
T('app nativa: vibración, barra de estado, enlaces y actualización al momento', async () => {
  const route = (latest) => async (p) => { await p.route('**/api/app', (r) => r.fulfill({ contentType: 'application/json', body: JSON.stringify(latest) })); };
  const nuevo = { version: '9.9.9', url: API + '/assets/app/bundle-x.zip', sha256: 'abc', minNative: '1.0.0' };
  const p = await open('mini', { init: nativeMock(), route: route(nuevo) });
  await sleep(6000);
  const calls = await p.evaluate(() => window.__calls.map((c) => c[0]));
  for (const c of ['hide', 'notifyAppReady', 'download', 'next']) assert(calls.includes(c), 'no llama a ' + c + ' (' + calls.join(',') + ')');
  const dl = await p.evaluate(() => window.__calls.find((c) => c[0] === 'download')[1]);
  assert(dl.version === '9.9.9' && dl.checksum === 'abc', 'descarga mal: ' + JSON.stringify(dl));
  const href = await p.evaluate(() => document.querySelector('a[href*="privacidad"]').href);
  assert(href.startsWith('https://turbo-slot'), 'enlace de privacidad dentro de la app: ' + href);
  await click(p, '#menu [data-open="mSettings"]'); await sleep(200);
  await p.evaluate(() => { const v = document.getElementById('optVibe'); v.checked = true; v.dispatchEvent(new Event('change')); });
  await sleep(200);
  assert((await p.evaluate(() => window.__calls.map((c) => c[0]))).includes('impact'), 'no vibra con el motor del iPhone');
  noErrors(p); await close(p);
  // Si la actualización necesita una app más nueva, no se descarga
  const q = await open('mini', { init: nativeMock(), route: route({ ...nuevo, minNative: '2.0.0' }) });
  await sleep(6000);
  assert(!(await q.evaluate(() => window.__calls.map((c) => c[0]))).includes('download'), 'descarga una actualización que pide una app más nueva');
  noErrors(q); await close(q);
});

// ---------------------------------------------------------------- Memoria
T('memoria: cambiar de circuito muchas veces no la llena', async () => {
  const p = await open('mini');
  const cycle = async () => { for (const id of ['ovalo', 'montana', 'pico-xl', 'puerto-xl', 'gp']) { await startRace(p, id, '1p'); await sleep(700); } await p.evaluate(() => document.getElementById('pauseBtn').click()); };
  await cycle(); await sleep(1000);
  const a = await p.evaluate(() => window.__slot.info);
  await cycle(); await cycle(); await sleep(1000);
  const b = await p.evaluate(() => window.__slot.info);
  assert(b.geos <= a.geos * 1.15 + 20 && b.tex <= a.tex * 1.15 + 10, `crece: geometrías ${a.geos}→${b.geos}, texturas ${a.tex}→${b.tex}`);
  noErrors(p); await close(p);
});

// ---------------------------------------------------------------- API del servidor
T('servidor: rutas y validaciones', async () => {
  const p = await open('mini');
  const j = (path, opt) => p.evaluate(async ([u, o]) => { const r = await fetch(u, o); return [r.status, await r.json().catch(() => null)]; }, [API + path, opt || {}]);
  const post = (body) => ({ method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  let [s, b] = await j('/api/premium'); assert(s === 200 && b.tracks.length >= 1, 'premium');
  [s, b] = await j('/api/app'); assert(s === 200 && b.version, 'app');
  [s] = await j('/api/tracks?sort=top'); assert(s === 200, 'comunidad');
  [s] = await j('/api/feedback', post({ msg: 'no' })); assert(s === 400, 'feedback corto');
  [s] = await j('/api/auth/register', post({ name: 'x', password: '123' })); assert(s === 400, 'registro inválido');
  [s] = await j('/api/auth/delete', post({})); assert(s === 401, 'borrar sin sesión');
  [s] = await j('/api/profile'); assert(s === 401, 'perfil sin sesión');
  [s] = await j('/api/laps?track=o:no-existe-xx&cls=iman'); assert(s === 200 || s === 400, 'ranking circuito raro');
  [s] = await j('/api/laps', post({ track: 'o:ovalo', device: 'abc' })); assert(s === 400, 'vuelta inválida');
  [s] = await j('/api/tracks/zzzzzzz', {}); assert(s === 404, 'circuito inexistente');
  await close(p);
});

(async () => {
  browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
  let ok = 0; const bad = [];
  for (const t of tests.filter((x) => !only.length || only.some((o) => x.name.includes(o)))) {
    const t0 = Date.now();
    try { await t.fn(); ok++; console.log(`  ok    ${t.name} (${((Date.now() - t0) / 1000).toFixed(0)} s)`); }
    catch (e) { bad.push(t.name); console.log(`  FALLO ${t.name}\n        ${String(e.message).split('\n').join('\n        ')}`); }
    for (const c of browser.contexts()) await c.close().catch(() => {});
  }
  await browser.close();
  console.log(`\n${ok} pruebas bien, ${bad.length} fallos`);
  process.exit(bad.length ? 1 : 0);
})();
