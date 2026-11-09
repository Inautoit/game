// Pruebas sin navegador: circuitos, física, IA, repetición exacta de vueltas (ranking), sincronización y temporadas.
// Uso: node slot/tests/unit.mjs
import assert from 'assert';
import { TRACKS, PREMIUM, sample, selfOverlap, laneOffsets, DS, validateTrack, autoClose, setPremium, findTrack } from '../src/tracks.js';
import { step, newCarState, resolveSetup, DEFAULT_SETUP, DT, SCALE } from '../src/physics.js';
import { buildProfile, aiThrottle } from '../src/ai.js';
import { replay, verifyLap, lapTimes } from '../src/verify.js';
import { mergeProfile, otherStats, fitProfile, isSynced } from '../src/sync.js';

let fails = 0, passes = 0;
const test = (name, fn) => { try { fn(); passes++; console.log('  ok  ', name); } catch (e) { fails++; console.log('  FALLO', name, '→', e.message); } };

console.log('Circuitos');
for (const t of [...TRACKS, ...PREMIUM]) test(`${t.id}: cierra, 4 carriles, sin cruces, pendiente razonable`, () => {
  const S = sample(t);
  assert.ok(S.closure < 0.02, 'no cierra: ' + S.closure);
  assert.strictEqual(t.lanes, 4);
  assert.ok(selfOverlap(S.pts, 4).ok, 'se cruza');
  let ms = 0; for (let i = 1; i < S.pts.length; i++) ms = Math.max(ms, Math.abs(S.pts[i].y - S.pts[i - 1].y) / DS);
  assert.ok(ms < 0.13, 'pendiente ' + ms.toFixed(3));
  assert.ok(S.pts.every((p) => Number.isFinite(p.x + p.z + p.h + p.k + p.y)), 'NaN en la pista');
});
test('los Premium son los más largos', () => {
  const len = (t) => sample(t).length * SCALE;
  const maxOff = Math.max(...TRACKS.map(len));
  for (const p of PREMIUM) assert.ok(len(p) > maxOff, `${p.id} ${len(p).toFixed(1)} <= ${maxOff.toFixed(1)}`);
});

console.log('Física e IA (cada circuito, carril 0 y 3, con imán y sin imán)');
const lapsOf = (def, lane, magnet, seconds) => {
  const S = sample(def); const tr = { L: S.length, DSU: DS, pts: S.pts }; const d = laneOffsets(4)[lane];
  const setup = resolveSetup({ ...DEFAULT_SETUP, magnet });
  const prof = buildProfile(tr, d, setup, 0.95);
  let st = newCarState(tr.L - 0.55), laps = 0, outs = 0, vmax = 0;
  for (let k = 0; k < seconds / DT; k++) {
    const thr = aiThrottle(st, prof, tr, 0.97, setup);
    step(st, tr, d, thr, setup);
    if (!Number.isFinite(st.s + st.v + st.th + st.w)) throw new Error('NaN en la física');
    vmax = Math.max(vmax, st.v);
    if (st.out) { outs++; st = newCarState(st.s); }
    if (st.s >= tr.L) { st.s -= tr.L; laps++; }
  }
  return { laps, outs, vmax, meters: S.length * SCALE };
};
for (const t of [...TRACKS, ...PREMIUM]) for (const [lane, magnet] of [[0, 'medio'], [3, 'sin']]) test(`${t.id} carril ${lane} imán ${magnet}: la CPU da vueltas`, () => {
  const r = lapsOf(t, lane, magnet, 90);
  const expected = Math.floor(90 * 1.2 / r.meters);   // como mínimo ~1,2 m/s de media
  assert.ok(r.laps >= Math.max(1, expected), `solo ${r.laps} vueltas en 90 s (${r.meters.toFixed(1)} m)`);
  assert.ok(r.outs <= 2, `se sale ${r.outs} veces sin errores de pilotaje`);
  assert.ok(r.vmax < 8, 'velocidad absurda ' + r.vmax);
});

console.log('Ranking: repetición exacta de una vuelta');
for (const id of ['ovalo', 'resistencia', 'pico-xl', 'puerto-xl']) test(`${id}: una vuelta real se comprueba y una trampa no`, () => {
  const def = findTrack(id); const S = sample(def); const tr = { L: S.length, DSU: DS, pts: S.pts };
  const lane = 1, d = laneOffsets(4)[lane]; const setupRaw = { ...DEFAULT_SETUP };
  const setup = resolveSetup(setupRaw); const prof = buildProfile(tr, d, setup, 0.95);
  const s0 = tr.L - 0.55, t0 = 1.2, goT = 1.2;
  const st = newCarState(s0), inputs = []; let simT = t0; const cross = [];
  for (let k = 0; k < 480 * 200 && cross.length < 3; k++) {
    const thr = Math.round(aiThrottle(st, prof, tr, 0.9, setup) * 1000) / 1000;
    if (inputs.length && inputs[inputs.length - 2] === thr) inputs[inputs.length - 1]++; else inputs.push(thr, 1);
    simT += DT; step(st, tr, d, thr, setup);
    assert.ok(!st.out, 'se salió en la prueba');
    if (st.s >= tr.L) { st.s -= tr.L; cross.push(simT - (st.s * SCALE) / Math.max(0.05, st.v) - goT); }
  }
  const time = cross[2] - cross[1];
  const sub = { lane, setup: setupRaw, s0, t0, goT, inputs, lap: 2, time };
  const ok = verifyLap(sub, def);
  assert.ok(ok.ok, 'rechazada: ' + ok.error);
  assert.ok(!verifyLap({ ...sub, time: time - 0.05 }, def).ok, 'aceptó un tiempo falso');
  const bad = inputs.slice(); const mid = 2 * Math.floor(bad.length / 4); bad[mid] = bad[mid] > 0.5 ? 0 : 1;   // a mitad de vuelta, gatillo al revés
  assert.ok(!verifyLap({ ...sub, inputs: bad }, def).ok, 'aceptó pulsaciones cambiadas');
  const g = replay({ def, lane, setupRaw, s0, t0, goT, inputs }, 2);
  assert.ok(g.ghost && g.ghost.length > 20, 'sin fantasma');
});

console.log('Editor');
test('autoClose cierra una sola recta (circuito nuevo)', () => { const r = autoClose([['S', 0.35 / 0.126]], 4, 3.8); assert.ok(r.pieces, r.error); assert.ok(validateTrack({ pieces: r.pieces, lanes: 4 }).ok); });
test('autoClose con puente', () => { const r = autoClose([['S', 2.77], ['S', 8.33, 0.95], ['C', 90, 3.8], ['C', 90, 3.8], ['C', 90, 3.8]], 4, 3.8); assert.ok(r.pieces || r.error); });
test('validateTrack rechaza basura', () => { assert.ok(!validateTrack({ pieces: [['X', 1]], lanes: 4 }).ok); assert.ok(!validateTrack({ pieces: 'a', lanes: 4 }).ok); assert.ok(!validateTrack({ pieces: [['S', 1e9], ['C', 90, 3], ['C', 90, 3]], lanes: 4 }).ok); });

console.log('Sincronización');
test('fusión de dos dispositivos', () => {
  const m = mergeProfile({ keys: { best: { a: 3 }, hiddenTracks: ['x'] }, statsBy: { A: { races: 2 } } }, { keys: { best: { a: 2, b: 5 }, hiddenTracks: ['y'] }, statsBy: { B: { races: 3 } } }, 'remote');
  assert.deepStrictEqual(m.keys.best, { a: 2, b: 5 });
  assert.deepStrictEqual(m.keys.hiddenTracks.sort(), ['x', 'y']);
  assert.strictEqual(otherStats(m.statsBy, 'A').races, 3);
  const later = mergeProfile({ keys: { hiddenTracks: [] } }, { keys: { hiddenTracks: ['x', 'y'] } }, 'local');
  assert.deepStrictEqual(later.keys.hiddenTracks, [], '«volver a mostrar» se pierde');
  assert.ok(isSynced('ghost.ovalo.iman') && !isSynced('account') && !isSynced('settings'));
  const big = fitProfile({ keys: { 'ghost.a': { t: 1, s: new Array(9000).fill(1.5) } }, statsBy: {} }, 5000);
  assert.ok(!big.keys['ghost.a']);
});

console.log('Temporada Premium');
test('se valida y se aplica', () => {
  const keep = PREMIUM.slice();
  assert.strictEqual(setPremium({ tracks: [{ id: 'roto', name: 'x', lanes: 4, pieces: [['S', 4]] }] }), false);
  assert.strictEqual(setPremium({ season: 'T2', tracks: [{ id: 'ok-1', name: 'Ok', lanes: 4, pieces: [['S', 10], ['C', 180, 4], ['S', 10], ['C', 180, 4]] }] }), true);
  assert.strictEqual(findTrack('ok-1').premium, true);
  setPremium({ season: 'Temporada 1', tracks: keep });
  assert.deepStrictEqual(PREMIUM.map((t) => t.id), keep.map((t) => t.id));
});

console.log(`\n${passes} pruebas bien, ${fails} fallos`);
process.exit(fails ? 1 : 0);
