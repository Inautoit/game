// Matemáticas deterministas: dan exactamente el mismo resultado en cualquier navegador y en el
// servidor. Solo usan suma, resta, multiplicación, división y raíz cuadrada (exactas en IEEE 754),
// nunca Math.sin/cos/exp/…, cuyo último decimal cambia de un motor de JavaScript a otro.
// Así el servidor puede repetir una vuelta con las mismas pulsaciones y comprobar el tiempo.

const LN2_HI = 6.93147180369123816490e-01, LN2_LO = 1.90821492927058770002e-10, INV_LN2 = 1.44269504088896338700e+00;
const PIO2_HI = 1.57079632673412561417e+00, PIO2_LO = 6.07710050650619224932e-11;
const PI = 3.141592653589793, PIO2 = 1.5707963267948966, PIO6 = 0.5235987755982988;
const SQRT3 = 1.7320508075688772, TAN_PI12 = 0.2679491924311227;

const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
const LITTLE = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
const HI = LITTLE ? 1 : 0, LO = LITTLE ? 0 : 1;

// 2^k exacto (k entero), construido a mano con los bits del número
function pow2(k) {
  if (k > 1023) return Infinity;
  if (k < -1022) return 0;
  u32[HI] = (k + 1023) << 20; u32[LO] = 0;
  return f64[0];
}

export function exp(x) {
  if (x !== x) return x;
  if (x > 709) return Infinity;
  if (x < -745) return 0;
  const k = Math.round(x * INV_LN2);
  const r = (x - k * LN2_HI) - k * LN2_LO;   // |r| <= 0,35
  // Serie de Taylor hasta r^14 (error < 1e-17)
  let t = 1, s = 1;
  for (let i = 1; i <= 14; i++) { t = (t * r) / i; s += t; }
  return s * pow2(k);
}

export function log(x) {
  if (!(x > 0)) return x === 0 ? -Infinity : NaN;
  if (x === Infinity) return x;
  f64[0] = x;
  let e = ((u32[HI] >>> 20) & 0x7ff) - 1023;
  u32[HI] = (u32[HI] & 0x000fffff) | 0x3ff00000;   // mantisa en [1, 2)
  let m = f64[0];
  if (e === -1023) { // subnormal
    f64[0] = x * 18014398509481984; // 2^54
    e = ((u32[HI] >>> 20) & 0x7ff) - 1023 - 54;
    u32[HI] = (u32[HI] & 0x000fffff) | 0x3ff00000;
    m = f64[0];
  }
  if (m > 1.4142135623730951) { m /= 2; e += 1; }
  const f = (m - 1) / (m + 1), f2 = f * f;   // |f| <= 0,1716
  let term = f, s = 0;
  for (let i = 1; i <= 23; i += 2) { s += term / i; term *= f2; }
  return e * LN2_HI + (2 * s + e * LN2_LO);
}

export function pow(x, y) {
  if (y === 0) return 1;
  if (x === 0) return y > 0 ? 0 : Infinity;
  if (x === 1) return 1;
  if (x < 0) return NaN;   // la física solo eleva números positivos
  return exp(y * log(x));
}

export function tanh(x) {
  if (x !== x) return x;
  if (x > 20) return 1;
  if (x < -20) return -1;
  const a = x < 0 ? -x : x;
  let r;
  if (a < 0.03) {
    // Serie para valores pequeños (evita perder precisión en e^2x - 1)
    const a2 = a * a;
    r = a * (1 - a2 * (1 / 3 - a2 * (2 / 15 - a2 * (17 / 315 - a2 * (62 / 2835)))));
  } else {
    const e = exp(2 * a);
    r = (e - 1) / (e + 1);
  }
  return x < 0 ? -r : r;
}

// Seno y coseno: reducción a [-π/4, π/4] y series de Taylor
function sinPoly(r) {
  const r2 = r * r;
  let t = r, s = r;
  for (let i = 1; i <= 9; i++) { t = (-t * r2) / ((2 * i) * (2 * i + 1)); s += t; }
  return s;
}
function cosPoly(r) {
  const r2 = r * r;
  let t = 1, s = 1;
  for (let i = 1; i <= 9; i++) { t = (-t * r2) / ((2 * i - 1) * (2 * i)); s += t; }
  return s;
}
function reduce(x) {
  const n = Math.round(x / PIO2);
  const r = (x - n * PIO2_HI) - n * PIO2_LO;
  return [r, ((n % 4) + 4) % 4];
}
export function sin(x) {
  if (!isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? sinPoly(r) : q === 1 ? cosPoly(r) : q === 2 ? -sinPoly(r) : -cosPoly(r);
}
export function cos(x) {
  if (!isFinite(x)) return NaN;
  const [r, q] = reduce(x);
  return q === 0 ? cosPoly(r) : q === 1 ? -sinPoly(r) : q === 2 ? -cosPoly(r) : sinPoly(r);
}

// Arcotangente: reducción a |t| <= tan(π/12) y serie
function atanSmall(t) {
  const t2 = t * t;
  let term = t, s = 0;
  for (let i = 1; i <= 27; i += 2) { s += term / i; term *= -t2; }
  return s;
}
export function atan(x) {
  if (x !== x) return x;
  const neg = x < 0;
  let t = neg ? -x : x;
  let base = 0, inv = false;
  if (t > 1) { t = 1 / t; inv = true; }
  if (t > TAN_PI12) { t = (t * SQRT3 - 1) / (SQRT3 + t); base = PIO6; }
  let r = base + atanSmall(t);
  if (inv) r = PIO2 - r;
  return neg ? -r : r;
}
export function atan2(y, x) {
  if (y !== y || x !== x) return NaN;
  if (x > 0) return atan(y / x);
  if (x < 0) return y >= 0 ? atan(y / x) + PI : atan(y / x) - PI;
  if (y > 0) return PIO2;
  if (y < 0) return -PIO2;
  return 0;
}
export const hypot = (a, b) => Math.sqrt(a * a + b * b);
