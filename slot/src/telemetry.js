// Telemetría profesional del coche del jugador: velocidad, límite de agarre,
// deriva, sectores, punta, trampa de velocidad y trazas de vuelta.
import { buildProfile } from './ai.js';
import { SCALE } from './physics.js';

const BIN_M = 0.1;          // una muestra de traza cada 10 cm de pista
export const SECTORS = 3;

// Límite real (sin margen) del carril con este reglaje: velocidad máxima en cada punto
// para seguir en la ranura y poder frenar a tiempo para lo que viene.
export function makeTelemetry(track, d, setup) {
  const lim = buildProfile(track, d, setup, 1.0).v;
  const n = lim.length;
  const lenM = track.L * SCALE;
  const bins = Math.max(20, Math.round(lenM / BIN_M));
  return {
    lim, n, lenM, bins, zones: brakeZones(lim), next: null,
    danger: 0,          // v / velocidad límite (≥ 1,03 suele ser salida)
    dangerS: 0,         // suavizado para la pantalla
    peak: 0,            // máximo de la vuelta
    vmax: 0,            // punta de la vuelta
    trap: NaN,          // velocidad al pasar por meta
    cur: { v: new Float32Array(bins).fill(NaN), g: new Float32Array(bins).fill(NaN) },
    best: null,         // trazas de la mejor vuelta
    last: null,
    sec: [], secBest: Array(SECTORS).fill(Infinity), secLast: Array(SECTORS).fill(NaN),
    secStart: 0, secIdx: 0, lapT0: 0,
  };
}

// Zonas de frenada: tramos donde la velocidad límite baja antes de una curva.
// start = dónde hay que empezar a frenar yendo a tope; end = entrada de la curva; vmin = velocidad de paso.
export function brakeZones(lim) {
  const n = lim.length;
  let i0 = 0;
  for (let i = 0; i < n; i++) if (lim[(i + 1) % n] >= lim[i] - 1e-4) { i0 = (i + 1) % n; break; }
  const zones = [];
  let run = null;
  for (let k = 0; k <= n; k++) {
    const i = (i0 + k) % n, j = (i + 1) % n;
    const dec = lim[j] < lim[i] - 1e-4;
    if (dec && !run) run = { start: i };
    if (!dec && run) {
      run.end = i;
      run.vmax = lim[run.start]; run.vmin = lim[i];
      if (run.vmax - run.vmin > 0.35) zones.push(run);
      run = null;
    }
  }
  return zones.sort((a, b) => a.start - b.start);
}

// Llamar en cada paso de física (480 por segundo)
export function telStep(tel, st, s, simT, onLap) {
  const i = Math.floor(s / 0.04) % tel.n;
  let m = Infinity;
  for (let k = 0; k <= 10; k += 2) m = Math.min(m, tel.lim[(i + k) % tel.n]);
  const dSpeed = st.v > 0.2 ? st.v / m : 0;
  // Deriva: ángulo de la trasera y hacia dónde va (predicción a 0,12 s)
  const dt = 1 / 480;
  const thDot = tel.prevTh === undefined ? 0 : (st.th - tel.prevTh) / dt;
  tel.prevTh = st.th;
  tel.thDot = tel.thDot === undefined ? thDot : tel.thDot + (thDot - tel.thDot) * 0.08;
  const thAbs = Math.max(Math.abs(st.th), Math.abs(st.th + tel.thDot * 0.12));
  const dDrift = st.v > 0.3 ? driftDanger(thAbs) : 0;
  tel.danger = Math.max(dSpeed, dDrift);
  tel.cause = dDrift > dSpeed ? 'drift' : 'speed';
  // Próxima frenada (distancia en metros hasta su inicio, o dentro de ella)
  let best = null, bd = Infinity;
  for (const z of tel.zones) {
    const len = (z.end - z.start + tel.n) % tel.n;
    const into = (i - z.start + tel.n) % tel.n;
    if (into <= len) { best = z; bd = 0; break; }
    const ahead = (z.start - i + tel.n) % tel.n;
    if (ahead < bd) { bd = ahead; best = z; }
  }
  tel.next = best ? { dist: bd * 0.04 * SCALE, vmin: best.vmin, inZone: bd === 0 } : null;
  if (!onLap) return;
  tel.peak = Math.max(tel.peak, tel.danger);
  tel.vmax = Math.max(tel.vmax, st.v);
  const b = Math.min(tel.bins - 1, Math.floor((i / tel.n) * tel.bins));
  const pv = tel.cur.v[b];
  tel.cur.v[b] = Number.isNaN(pv) ? st.v : Math.max(pv, st.v);
  const pg = tel.cur.g[b];
  tel.cur.g[b] = Number.isNaN(pg) ? tel.danger : Math.max(pg, tel.danger);
  // Sectores: tres tramos de igual longitud
  const sec = Math.min(SECTORS - 1, Math.floor((i / tel.n) * SECTORS));
  if (sec > tel.secIdx) {
    const t = simT - tel.secStart;
    tel.sec[tel.secIdx] = t;
    tel.secStart = simT;
    tel.secIdx = sec;
  }
}

// Paso por meta. now = instante exacto; lapTime = tiempo de la vuelta (o NaN en la primera)
export function telLap(tel, st, now, lapTime, isBest) {
  tel.trap = st.v;
  let res = null;
  if (Number.isFinite(lapTime)) {
    tel.sec[SECTORS - 1] = now - tel.secStart;
    res = { sec: tel.sec.slice(0, SECTORS), status: [] };
    for (let k = 0; k < SECTORS; k++) {
      const t = res.sec[k];
      res.status[k] = !Number.isFinite(t) ? '' : t < tel.secBest[k] ? 'best' : t < tel.secLast[k] ? 'better' : 'worse';
      if (t < tel.secBest[k]) tel.secBest[k] = t;
    }
    tel.secLast = res.sec.slice();
    tel.lastStatus = res.status;
    tel.last = { v: tel.cur.v, g: tel.cur.g, vmax: tel.vmax, peak: tel.peak, t: lapTime };
    if (isBest) tel.best = tel.last;
  }
  tel.cur = { v: new Float32Array(tel.bins).fill(NaN), g: new Float32Array(tel.bins).fill(NaN) };
  tel.lapVmax = tel.vmax;
  tel.vmax = 0; tel.peak = 0;
  tel.sec = []; tel.secIdx = 0; tel.secStart = now; tel.lapT0 = now;
  return res;
}

// Ángulo de deriva (rad) → riesgo: 20° ≈ 95 % (normal al límite), 29° ≈ 103 % (trompo casi seguro)
export function driftDanger(th) {
  if (th < 0.35) return (th / 0.35) * 0.95;
  return 0.95 + (th - 0.35) * 0.533;
}

// Color del medidor de límite: verde → ámbar → rojo
export function dangerColor(x) {
  if (x < 0.9) return '#34c759';
  if (x < 0.98) return '#ffcc00';
  if (x < 1.03) return '#ff9500';
  return '#ff3b30';
}

// Dibuja la traza de velocidad (línea) y de agarre usado (relleno) de la vuelta actual
// contra la mejor vuelta (gris).
export function drawTrace(cv, tel, posFrac, vtop) {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const W = cv.clientWidth, H = cv.clientHeight;
  if (!W || !H) return;
  if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, W, H);
  const top = vtop * 1.02;
  const n = tel.bins;
  const X = (b) => (b / (n - 1)) * W;
  const Y = (v) => H - 2 - (v / top) * (H - 6);
  // Marcas de sectores
  g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 1;
  for (let k = 1; k < SECTORS; k++) { const x = (k / SECTORS) * W; g.beginPath(); g.moveTo(x, 0); g.lineTo(x, H); g.stroke(); }
  // Agarre usado: barras de color al pie (rojo = al límite)
  const cur = tel.cur;
  for (let b = 0; b < n; b++) {
    const gv = cur.g[b];
    if (Number.isNaN(gv) || gv < 0.85) continue;
    g.fillStyle = dangerColor(gv);
    g.globalAlpha = 0.85;
    g.fillRect(X(b), H - 4, Math.max(1, W / n + 0.5), 4);
  }
  g.globalAlpha = 1;
  const line = (arr, color, w) => {
    g.strokeStyle = color; g.lineWidth = w; g.beginPath();
    let pen = false;
    for (let b = 0; b < n; b++) {
      const v = arr[b];
      if (Number.isNaN(v)) { pen = false; continue; }
      if (!pen) { g.moveTo(X(b), Y(v)); pen = true; } else g.lineTo(X(b), Y(v));
    }
    g.stroke();
  };
  if (tel.best) line(tel.best.v, 'rgba(255,255,255,0.35)', 1.5);
  line(cur.v, '#4fc3f7', 2);
  // Posición actual
  g.fillStyle = '#fff';
  g.fillRect(posFrac * W - 1, 0, 2, H);
}
