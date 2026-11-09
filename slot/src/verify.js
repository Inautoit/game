// Repetición exacta de una vuelta a partir de las pulsaciones del gatillo.
// La usan el servidor (para comprobar que un tiempo es real) y el juego (para
// reconstruir el fantasma del récord). La física es determinista (ver dmath.js).
import { step, newCarState, resolveSetup, DT, SCALE } from './physics.js';
import { sample, laneOffsets, DS } from './tracks.js';

export const MAX_STEPS = 480 * 300;   // como mucho 5 minutos desde la última parada

// Cuántos pasos de física hay en una lista de pulsaciones comprimida [valor, pasos, valor, pasos…]
export function countSteps(inputs) {
  let n = 0;
  for (let i = 1; i < inputs.length; i += 2) n += inputs[i];
  return n;
}

// Pista lista para la física a partir de su definición
export function physTrackOf(def) {
  const S = sample(def);
  return { L: S.length, DSU: DS, pts: S.pts };
}

// Simula desde una parada (coche quieto en s0) con el reloj de la carrera en t0.
// Devuelve los pasos por meta con su hora exacta (igual que el juego). Si se pide ghostLap
// (número de vuelta, 1 = la que acaba en el segundo paso por meta), devuelve también la
// trayectoria (s, θ) a 60 por segundo de esa vuelta, para pintar el fantasma.
export function replay({ def, track, lane, setupRaw, s0, t0, goT, inputs }, ghostLap = 0) {
  const tr = track || physTrackOf(def);
  const d = laneOffsets(def.lanes)[lane];
  if (d === undefined) return { error: 'Carril no válido' };
  const setup = resolveSetup(setupRaw);
  const c = newCarState(s0);
  let simT = t0, k = 0;
  const cross = [];      // [{ step, now }]
  let out = false;
  const ghost = ghostLap ? [] : null;
  let recT = 0;
  for (let i = 0; i < inputs.length && !out; i += 2) {
    const thr = inputs[i], n = inputs[i + 1];
    for (let j = 0; j < n; j++) {
      simT += DT;
      step(c, tr, d, thr, setup);
      k++;
      if (c.out) { out = true; break; }
      if (c.s >= tr.L) {
        c.s -= tr.L;
        const over = (c.s * SCALE) / Math.max(0.05, c.v);
        cross.push({ step: k, now: simT - over - goT });
        if (ghost && cross.length === ghostLap) recT = 0;
      }
      // Igual que el juego: una muestra cada 1/60 s durante la vuelta pedida
      if (ghost && cross.length === ghostLap) {
        recT += DT;
        if (recT >= 1 / 60) { recT -= 1 / 60; ghost.push(+c.s.toFixed(3), +c.th.toFixed(3)); }
      }
    }
  }
  return { cross, out, steps: k, ghost, L: tr.L, d };
}

// Tiempos de vuelta (entre pasos por meta consecutivos), calculados igual que el juego
export function lapTimes(cross) {
  const t = [];
  for (let i = 1; i < cross.length; i++) t.push(cross[i].now - cross[i - 1].now);
  return t;
}

// Comprueba una vuelta enviada: devuelve { ok, time } o { ok:false, error }
export function verifyLap(sub, def) {
  const { inputs, lap } = sub;
  if (!Array.isArray(inputs) || inputs.length < 2 || inputs.length % 2) return { ok: false, error: 'Datos de la vuelta no válidos' };
  for (let i = 0; i < inputs.length; i += 2) {
    const v = inputs[i], n = inputs[i + 1];
    if (!(Number.isFinite(v) && v >= 0 && v <= 1) || !(Number.isInteger(n) && n > 0)) return { ok: false, error: 'Datos de la vuelta no válidos' };
  }
  if (countSteps(inputs) > MAX_STEPS) return { ok: false, error: 'Vuelta demasiado larga para comprobarla' };
  if (!Number.isFinite(sub.s0) || !Number.isFinite(sub.t0) || !Number.isFinite(sub.goT)) return { ok: false, error: 'Datos de la vuelta no válidos' };
  const r = replay({ def, lane: sub.lane, setupRaw: sub.setup, s0: sub.s0, t0: sub.t0, goT: sub.goT, inputs });
  if (r.error) return { ok: false, error: r.error };
  const times = lapTimes(r.cross);
  // La vuelta pedida es la última completa de la repetición, sin salidas
  if (!times.length || r.out) return { ok: false, error: 'La repetición no completa la vuelta' };
  const time = times[times.length - 1];
  if (!Number.isInteger(lap) || lap !== times.length) return { ok: false, error: 'La vuelta no coincide' };
  if (Math.abs(time - sub.time) > 1e-9) return { ok: false, error: 'El tiempo no coincide con la repetición' };
  return { ok: true, time, steps: r.steps };
}
