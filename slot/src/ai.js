// Piloto de la CPU: usa exactamente la misma física que el jugador.
// Antes de la carrera mide, simulando, la velocidad límite para cada radio de curva
// y la frenada del coche; con eso construye un perfil de velocidad para su carril.
import { step, newCarState, DT, SCALE } from './physics.js';

const cache = new Map();
const RADII = [0.1, 0.13, 0.16, 0.2, 0.25, 0.3, 0.36, 0.43, 0.5, 0.6, 0.75, 1.0]; // metros

function circle(Ru) {
  const n = Math.max(8, Math.round((2 * Math.PI * Ru) / 0.04));
  return { L: n * 0.04, DSU: 0.04, pts: Array.from({ length: n }, () => ({ k: 1 / Ru, y: 0 })) };
}

// Velocidad máxima sostenida en una curva de radio r (m) con un reglaje dado
function limitFor(r, setup) {
  const tr = circle(r / SCALE);
  const c = newCarState(0);
  let t = 0, vmax = 0;
  while (!c.out && t < 30) {
    step(c, tr, 0, Math.min(1, 0.15 + t * 0.03), setup);
    t += DT;
    if (t > 0.6) vmax = Math.max(vmax, c.v);
  }
  return c.out ? vmax : 9;
}

export function carModel(setup) {
  const key = JSON.stringify(setup);
  if (cache.has(key)) return cache.get(key);
  const lims = RADII.map((r) => limitFor(r, setup));
  // Punta y frenada (dv/ds) en recta
  const straight = { L: 1000, DSU: 0.04, pts: Array.from({ length: 25000 }, () => ({ k: 0, y: 0 })) };
  const c = newCarState(0);
  for (let t = 0; t < 3; t += DT) step(c, straight, 0, 1, setup);
  const vtop = c.v;
  const s0 = c.s, v0 = c.v;
  let guard = 0;
  while (c.v > 1.2 && guard++ < 100000) step(c, straight, 0, 0, setup);
  const brake = (v0 - c.v) / Math.max(1e-6, (c.s - s0) * SCALE); // (m/s) por metro
  const m = { lims, vtop, brake };
  cache.set(key, m);
  return m;
}

function vlim(model, r) {
  if (!Number.isFinite(r) || r > RADII[RADII.length - 1]) return model.vtop;
  if (r <= RADII[0]) return model.lims[0];
  for (let i = 1; i < RADII.length; i++) {
    if (r <= RADII[i]) {
      const t = (r - RADII[i - 1]) / (RADII[i] - RADII[i - 1]);
      return model.lims[i - 1] + (model.lims[i] - model.lims[i - 1]) * t;
    }
  }
  return model.vtop;
}

// Perfil de velocidad objetivo a lo largo del carril d (unidades)
export function buildProfile(track, d, setup, margin = 0.92) {
  const model = carModel(setup);
  const P = track.pts, n = P.length;
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const kc = P[i].k;
    const kl = Math.abs(kc / (1 - kc * d)) / SCALE;
    v[i] = Math.min(model.vtop, vlim(model, kl > 1e-4 ? 1 / kl : Infinity) * margin);
  }
  // Frenada anticipada: hacia atrás, sin superar la deceleración del coche
  const kb = model.brake * 0.8;
  for (let pass = 0; pass < 2; pass++) {
    for (let i = n - 1; i >= 0; i--) {
      const j = (i + 1) % n;
      const ds = track.DSU * SCALE * (1 - P[i].k * d);
      v[i] = Math.min(v[i], v[j] + kb * ds);
    }
  }
  return { v, vtop: model.vtop };
}

// Gatillo de la CPU para el estado actual
export function aiThrottle(state, prof, track, skill, setup) {
  const n = prof.v.length;
  const i = Math.floor((((state.s % track.L) + track.L) % track.L) / track.DSU) % n;
  // Objetivo: el límite más bajo entre donde está y lo que viene
  let tv = Infinity;
  for (let k = 0; k <= 10; k += 2) tv = Math.min(tv, prof.v[(i + k) % n]);
  const target = tv * skill;
  const v = state.v;
  const th = Math.abs(state.th);
  if (th > 0.45) return 0.08;                          // salvar un derrape
  if (th > 0.22) return Math.min(0.6, Math.pow(Math.min(1, target / prof.vtop), 1 / setup.curve)); // levantar el pie
  if (v > target + 0.06) return 0;                    // frenar
  const ff = Math.pow(Math.min(1, target / prof.vtop), 1 / setup.curve);
  return Math.max(0, Math.min(1, ff + (target - v) * 0.8));
}
