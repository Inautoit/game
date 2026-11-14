// Lógica pura de la máquina (port exacto de bot/indicators.py, strategies.py, scanner.py y risk.py).
// Se verifica contra la versión Python con parity_test.mjs.

export const CONFIG = {
  timeframe: "4h", barMs: 4 * 3600_000, historyBars: 400, minBars: 250,
  universeSize: 20, topN: 6, paperCapital: 1000,
  strategies: { // orden = prioridad
    breakout: { n: 24, vol_mult: 1.5, atr_mult: 2.5 },
    trend: { fast: 20, slow: 50, adx_min: 22, atr_mult: 3.0 },
  },
  risk: { risk_per_trade: 0.01, max_position_pct: 0.25, max_positions: 4, daily_loss_limit: 0.03,
          max_drawdown: 0.15, min_notional: 10 },
  costs: { fee: 0.001, slippage: 0.0005 },
  // Pares de Kraken (Binance bloquea las IPs de Cloudflare). XBT = BTC, XDG = DOGE.
  candidates: ["XBTUSD","ETHUSD","SOLUSD","XRPUSD","BNBUSD","XDGUSD","ADAUSD","TRXUSD","LINKUSD","AVAXUSD","DOTUSD",
               "LTCUSD","BCHUSD","NEARUSD","SUIUSD","APTUSD","UNIUSD","ATOMUSD","XLMUSD","FILUSD","ICPUSD","ETCUSD",
               "HBARUSD","ARBUSD","OPUSD","INJUSD","AAVEUSD","TONUSD","PEPEUSD","SHIBUSD","TAOUSD","RENDERUSD","SEIUSD",
               "TIAUSD","WLDUSD","ENAUSD","ONDOUSD","FETUSD","ALGOUSD","VETUSD"],
};

const NaNs = (n) => new Array(n).fill(NaN);

// pandas ewm(adjust=False, min_periods=m): empieza en el primer valor válido
export function ewm(x, alpha, minPeriods) {
  const out = NaNs(x.length); let y = NaN, cnt = 0;
  for (let i = 0; i < x.length; i++) {
    const v = x[i];
    if (!Number.isNaN(v)) { y = cnt === 0 ? v : alpha * v + (1 - alpha) * y; cnt++; }
    if (cnt >= minPeriods) out[i] = y;
  }
  return out;
}
export const ema = (s, n) => ewm(s, 2 / (n + 1), n);
export function sma(s, n) {
  const out = NaNs(s.length); let sum = 0;
  for (let i = 0; i < s.length; i++) { sum += s[i]; if (i >= n) sum -= s[i - n]; if (i >= n - 1) out[i] = sum / n; }
  return out;
}
export function trueRange(h, l, c) {
  return h.map((hi, i) => i === 0 ? hi - l[i] : Math.max(hi - l[i], Math.abs(hi - c[i - 1]), Math.abs(l[i] - c[i - 1])));
}
export const atr = (h, l, c, n = 14) => ewm(trueRange(h, l, c), 1 / n, n);
export function adx(h, l, c, n = 14) {
  const N = h.length, pdm = new Array(N).fill(0), mdm = new Array(N).fill(0);
  for (let i = 1; i < N; i++) {
    const up = h[i] - h[i - 1], dn = l[i - 1] - l[i];
    if (up > dn && up > 0) pdm[i] = up;
    if (dn > up && dn > 0) mdm[i] = dn;
  }
  const tr = ewm(trueRange(h, l, c), 1 / n, n), p = ewm(pdm, 1 / n, n), m = ewm(mdm, 1 / n, n);
  const dx = tr.map((t, i) => {
    const pdi = 100 * p[i] / t, mdi = 100 * m[i] / t, s = pdi + mdi;
    return s === 0 ? NaN : 100 * Math.abs(pdi - mdi) / s;
  });
  return ewm(dx, 1 / n, n);
}
export function rollMax(s, n) { return s.map((_, i) => i < n - 1 ? NaN : Math.max(...s.slice(i - n + 1, i + 1))); }
export function rollMin(s, n) { return s.map((_, i) => i < n - 1 ? NaN : Math.min(...s.slice(i - n + 1, i + 1))); }
const shift1 = (s) => [NaN, ...s.slice(0, -1)];
export const donchianHigh = (h, n) => shift1(rollMax(h, n));
export const donchianLow = (l, n) => shift1(rollMin(l, n));
const nz = (v) => (Number.isNaN(v) ? 0 : v);

// Señales de la ÚLTIMA vela cerrada: {entry, exit, stop, trail, strength}
export function trendSignal(d, p) {
  const { c, h, l } = d, N = c.length;
  const fast = ema(c, p.fast), slow = ema(c, p.slow), a = adx(h, l, c), at = atr(h, l, c);
  const cond = (i) => fast[i] > slow[i] && c[i] > slow[i] && a[i] > p.adx_min;
  const i = N - 1;
  const strength = nz((a[i] / 50) * Math.max(fast[i] / slow[i] - 1, 0) * 100);
  return { entry: cond(i) && !cond(i - 1), exit: fast[i] < slow[i], stop: c[i] - p.atr_mult * at[i],
           trail: c[i] - p.atr_mult * at[i], strength };
}
export function breakoutSignal(d, p) {
  const { c, h, l, v } = d, N = c.length, i = N - 1;
  const hi = donchianHigh(h, p.n), lo = donchianLow(l, Math.max(2, Math.floor(p.n / 2)));
  const vs = sma(v, 20), e100 = ema(c, 100), at = atr(h, l, c);
  const entry = c[i] > hi[i] && v[i] > p.vol_mult * vs[i] && c[i] > e100[i];
  const s1 = (c[i] - hi[i]) / at[i];
  const strength = nz((Number.isNaN(s1) ? NaN : Math.max(s1, 0)) + v[i] / vs[i]);
  return { entry, exit: c[i] < lo[i], stop: c[i] - p.atr_mult * at[i], trail: c[i] - p.atr_mult * at[i], strength };
}
export const STRATS = { trend: trendSignal, breakout: breakoutSignal };

export function score(d, lookback = 72, volMin = 0.004, volMax = 0.05) {
  const { c, h, l, v } = d, i = c.length - 1;
  const mom = c[i] / c[i - lookback] - 1;
  const a = adx(h, l, c)[i] / 100, atrPct = atr(h, l, c)[i] / c[i];
  if (!(atrPct > volMin && atrPct < volMax)) return -Infinity;
  let s = 0; for (let k = i - 23; k <= i; k++) s += v[k] * c[k];
  return 3 * mom + a + 0.05 * Math.log1p(s / 24);
}

export function positionSize(cfg, equity, cash, price, stop) {
  if (!(price > 0) || !(stop < price) || stop <= 0) return 0;
  let q = equity * cfg.risk_per_trade / (price - stop);
  q = Math.min(q, equity * cfg.max_position_pct / price, cash * 0.98 / price);
  return q * price < cfg.min_notional ? 0 : q;
}
export function canOpen(cfg, risk, equity, nOpen) {
  if (risk.halted || nOpen >= cfg.max_positions) return false;
  if (risk.dayStart && equity < risk.dayStart * (1 - cfg.daily_loss_limit)) return false;
  return true;
}
// Devuelve "kill" si se supera el drawdown máximo
export function riskUpdate(cfg, risk, equity, day) {
  if (risk.peak == null || equity > risk.peak) risk.peak = equity;
  if (day !== risk.day) { risk.day = day; risk.dayStart = equity; }
  if (!risk.halted && equity < risk.peak * (1 - cfg.max_drawdown)) {
    risk.halted = true;
    risk.haltReason = `drawdown máximo superado (${equity.toFixed(2)} < ${(risk.peak * (1 - cfg.max_drawdown)).toFixed(2)})`;
    return "kill";
  }
  return "";
}

// Velas en formato [openTimeMs, o, h, l, c, vol, closeTimeMs] -> arrays, descartando la vela que aún se forma
export function parseKlines(rows, nowMs) {
  const d = { t: [], o: [], h: [], l: [], c: [], v: [] };
  for (const r of rows) {
    if (r[6] >= nowMs) continue; // closeTime en el futuro = vela sin cerrar
    d.t.push(r[0]); d.o.push(+r[1]); d.h.push(+r[2]); d.l.push(+r[3]); d.c.push(+r[4]); d.v.push(+r[5]);
  }
  return d;
}
