// Física de un coche de slot 1:32 en unidades del SI.
// Determinista y de paso fijo: el mismo mando produce siempre la misma vuelta
// (permite fantasmas y, en el futuro, verificar récords en el servidor).
//
// Modelo:
//  - La guía delantera (punto G) va dentro de la ranura del carril.
//  - El coche gira alrededor de la guía: la trasera puede derrapar (ángulo θ).
//  - Las ruedas traseras dan tracción (motor) y fuerza lateral (neumático),
//    limitadas por el círculo de fricción μ·N; el imán aumenta N.
//  - Motor de corriente continua: par = ke·(V − ke·ω)/R. Al soltar el gatillo,
//    el mando cortocircuita el motor (freno), con intensidad regulable.
//  - Si la fuerza lateral en la guía supera lo que sujeta el coche, o la trasera
//    gira demasiado, el coche se sale de la ranura.

export const DT = 1 / 480;      // paso de integración (s)
export const SCALE = 0.126;     // metros por unidad de pista (78 mm entre carriles)
const GRAV = 9.81;

// Coche base 1:32
export const BODY = {
  m: 0.088,       // masa (kg)
  I: 1.45e-4,     // inercia de guiñada (kg·m²)
  a: 0.050,       // guía → centro de gravedad (m)
  f: 0.010,       // guía → eje delantero (m)
  L: 0.082,       // guía → eje trasero (m)
  r: 0.0105,      // radio de rueda (m)
};
export const MOTOR = { V: 12, ke: 0.0064, R: 3.0, fric: 0.035 };

// Opciones de reglaje (lo que se ajusta en el taller)
export const SETUP_OPTIONS = {
  magnet: [{ id: 'sin', name: 'Sin imán', F: 0 }, { id: 'bajo', name: 'Bajo', F: 0.35 }, { id: 'medio', name: 'Medio', F: 0.75 }, { id: 'alto', name: 'Alto', F: 1.3 }],
  gear: [{ id: 'corto', name: 'Corto (9:30)', G: 3.33 }, { id: 'medio', name: 'Medio (9:27)', G: 3.0 }, { id: 'largo', name: 'Largo (10:27)', G: 2.7 }],
  tire: [{ id: 'duro', name: 'Duro', mu: 0.95 }, { id: 'blando', name: 'Blando', mu: 1.15 }],
};
export const DEFAULT_SETUP = { magnet: 'medio', gear: 'medio', tire: 'blando', brake: 0.7, curve: 1.4 };

export function resolveSetup(s) {
  const pick = (k, id) => SETUP_OPTIONS[k].find((o) => o.id === id) || SETUP_OPTIONS[k][1];
  return {
    Fmag: pick('magnet', s.magnet).F,
    G: pick('gear', s.gear).G,
    mu: pick('tire', s.tire).mu,
    brake: Math.max(0, Math.min(1, s.brake)),
    curve: Math.max(1, Math.min(2.5, s.curve)),
  };
}

export function newCarState(s0) {
  return { s: s0, v: 0, th: 0, w: 0, out: false, lam: 0, risk: 0, slip: 0, wheelspin: 0, amps: 0, rpm: 0, Fr: 0 };
}

// Curvatura del carril (1/m) y pendiente en la posición s (unidades)
// track: { L, pts:[{k,y}], DSU } con k en 1/unidad
function trackAt(track, s, d) {
  const n = track.pts.length;
  let u = (((s % track.L) + track.L) % track.L) / track.DSU;
  const i = Math.floor(u) % n;
  const p = track.pts[i], q = track.pts[(i + 1) % n];
  const kc = p.k;
  const kl = kc / (1 - kc * d);                  // curvatura del carril (1/unidad)
  return { kc, kl: kl / SCALE, slope: (q.y - p.y) / track.DSU };
}

// Avanza un paso. thr: gatillo 0..1. Devuelve el estado (mutado).
export function step(c, track, d, thr, setup) {
  if (c.out) return c;
  const { m, I, a, f, L, r } = BODY;
  const { kc, kl, slope } = trackAt(track, c.s, d);
  const v = c.v, th = c.th, w = c.w;
  const cs = Math.cos(th), sn = Math.sin(th);

  // Cargas: peso repartido + imán sobre el eje trasero
  const rearFrac = (a - f) / (L - f);
  const Nr = m * GRAV * rearFrac + setup.Fmag;
  const Nt = m * GRAV + setup.Fmag;

  // Velocidad de la rueda trasera en ejes del coche
  const u = v * cs;              // longitudinal
  const wl = -v * sn - L * w;    // lateral

  // Motor
  const omega = (setup.G * u) / r;
  let torque;
  if (thr > 0.015) {
    const V = MOTOR.V * Math.pow(thr, setup.curve);
    torque = (MOTOR.ke * (V - MOTOR.ke * omega)) / MOTOR.R;
  } else {
    torque = (-MOTOR.ke * MOTOR.ke * omega * setup.brake * 1.6) / MOTOR.R; // freno por cortocircuito
  }
  c.amps = torque / MOTOR.ke;
  c.rpm = Math.abs(omega) * 9.549;
  let Fd = (torque * setup.G) / r - MOTOR.fric * Math.tanh(u * 20);

  // Neumático trasero: fuerza lateral según el ángulo de deriva
  const alpha = Math.atan2(wl, Math.max(Math.abs(u), 0.25));
  let Fl = -setup.mu * Nr * Math.tanh(alpha / 0.09);
  // Círculo de fricción
  const lim = setup.mu * Nr;
  const mag = Math.hypot(Fd, Fl);
  let spin = 0;
  if (mag > lim) { const k = lim / mag; spin = 1 - k; Fd *= k; Fl *= k; }
  c.slip = Math.min(1.5, Math.abs(alpha) / 0.35);
  c.wheelspin = spin;

  // Fuerza trasera en ejes de la pista (t = x, n = y)
  const Frx = Fd * cs - Fl * sn;
  const Fry = Fd * sn + Fl * cs;
  // Resistencias en el centro de gravedad (según la tangente) y pendiente
  const drag = 0.012 * Nt * Math.tanh(v * 10) + 0.0006 * v * Math.abs(v) + m * GRAV * slope;
  const Fx = Frx - drag, Fy = Fry;
  // Momento de la fuerza trasera respecto al centro de gravedad, más el rozamiento
  // de la guía y las trencillas, que amortigua el bamboleo de la trasera
  const Mr = -(L - a) * (cs * Fry - sn * Frx) - 0.0016 * (w - kl * v);

  // Ecuaciones con la guía como restricción (incógnitas: s̈, ψ̈, λ)
  const psidd = (Mr - a * cs * Fy + a * cs * m * (kl * v * v + a * w * w * sn)) / (I + m * a * a * cs * cs);
  const sdd = (Fx - m * a * w * w * cs) / m - a * psidd * sn;
  const lam = -m * a * cs * psidd - Fy + m * (kl * v * v + a * w * w * sn);
  c.lam = lam;
  c.Fr = Math.abs(Fl) / Math.max(1e-6, lim);

  // Integración (Euler semiimplícito)
  c.v = v + sdd * DT;
  c.w = w + psidd * DT;
  c.th = th + (c.w - kl * c.v) * DT;
  const k1 = 1 - kc * d;
  c.s += (c.v * DT) / SCALE / k1;

  // ¿Se sale de la ranura?
  const lamMax = Nt * 1.9;
  // Riesgo de salida (0 = tranquilo, 1 = fuera): lo que tira la guía y lo que gira la trasera
  c.risk = Math.max(Math.abs(lam) / lamMax, Math.abs(c.th) / 1.25);
  if (Math.abs(lam) > lamMax || Math.abs(c.th) > 1.25) c.out = true;
  return c;
}
