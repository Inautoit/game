/* Motor del bot para el navegador: indicadores, features, modelo ML (árboles exportados
   desde Python), estrategia, gestión de riesgo, broker simulado y aprendizaje online.
   Replica bot/indicators.py y bot/ml.py: tests/parity verifica que coinciden. */
(function (root) {
  "use strict";
  const NaN_ = NaN, isn = Number.isNaN;

  // ---- ewm idéntico a pandas (adjust=False, ignore_na=False) ----
  function ewm(x, alpha, minp) {
    const n = x.length, out = new Array(n).fill(NaN_);
    let start = 0;
    let weighted = x[0], nobs = isn(weighted) ? 0 : 1, oldWt = 1;
    out[0] = nobs >= minp ? weighted : NaN_;
    for (let i = start + 1; i < n; i++) {
      const cur = x[i], obs = !isn(cur);
      nobs += obs ? 1 : 0;
      if (!isn(weighted)) {
        oldWt *= 1 - alpha;
        if (obs) {
          if (weighted !== cur) weighted = (oldWt * weighted + alpha * cur) / (oldWt + alpha);
          oldWt = 1;
        }
      } else if (obs) weighted = cur;
      out[i] = nobs >= minp ? weighted : NaN_;
    }
    return out;
  }
  const emaSpan = (x, n) => ewm(x, 2 / (n + 1), n);
  const wilder = (x, n) => ewm(x, 1 / n, n);
  function rolling(x, n, fn) {
    const out = new Array(x.length).fill(NaN_);
    for (let i = n - 1; i < x.length; i++) {
      const w = x.slice(i - n + 1, i + 1);
      if (w.some(isn)) continue;
      out[i] = fn(w);
    }
    return out;
  }
  const mean = w => w.reduce((a, b) => a + b, 0) / w.length;
  const std = w => { const m = mean(w); return Math.sqrt(w.reduce((a, b) => a + (b - m) ** 2, 0) / (w.length - 1)); };
  const shift = (x, k) => x.map((_, i) => (i - k >= 0 && i - k < x.length ? x[i - k] : NaN_));
  const map2 = (a, b, f) => a.map((v, i) => f(v, b[i]));

  const nyFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
  const nyDate = t => nyFmt.format(new Date(t));

  function indicators(b, p = {}) {
    const c = b.close, h = b.high, l = b.low, o = b.open, v = b.volume, n = c.length;
    const d = {};
    d.ema_fast = emaSpan(c, p.ema_fast || 9);
    d.ema_slow = emaSpan(c, p.ema_slow || 21);
    d.ema_trend = emaSpan(c, p.ema_trend || 100);
    // RSI
    const rp = p.rsi_period || 14;
    const diff = c.map((x, i) => (i ? x - c[i - 1] : NaN_));
    const up = wilder(diff.map(x => (isn(x) ? x : Math.max(x, 0))), rp);
    const dn = wilder(diff.map(x => (isn(x) ? x : Math.max(-x, 0))), rp);
    d.rsi = up.map((u, i) => {
      if (dn[i] === 0) return 100;
      return isn(u) || isn(dn[i]) ? NaN_ : 100 - 100 / (1 + u / dn[i]);
    });
    // ATR
    const tr = c.map((_, i) => {
      if (i === 0) return h[0] - l[0];
      const pc = c[i - 1];
      return Math.max(h[i] - l[i], Math.abs(h[i] - pc), Math.abs(l[i] - pc));
    });
    d.atr = wilder(tr, p.atr_period || 14);
    // Bollinger
    const bp = p.bb_period || 20, bk = p.bb_std || 2;
    d.bb_mid = rolling(c, bp, mean);
    const sd = rolling(c, bp, std);
    d.bb_low = map2(d.bb_mid, sd, (m, s) => m - bk * s);
    d.bb_up = map2(d.bb_mid, sd, (m, s) => m + bk * s);
    // MACD
    const line = map2(emaSpan(c, 12), emaSpan(c, 26), (a, b2) => a - b2);
    const sig = emaSpan(line, 9);
    d.macd_hist = map2(line, sig, (a, b2) => a - b2);
    // ADX
    const ap = p.adx_period || 14;
    const pdm = [], mdm = [];
    for (let i = 0; i < n; i++) {
      const u = i ? h[i] - h[i - 1] : NaN_, w = i ? -(l[i] - l[i - 1]) : NaN_;
      pdm.push(u > w && u > 0 ? u : 0);
      mdm.push(w > u && w > 0 ? w : 0);
    }
    const trs = wilder(tr, ap);
    const pdi = map2(wilder(pdm, ap), trs, (a, t) => 100 * a / t);
    const mdi = map2(wilder(mdm, ap), trs, (a, t) => 100 * a / t);
    const dx = pdi.map((a, i) => { const s = a + mdi[i]; return s === 0 || isn(s) ? NaN_ : 100 * Math.abs(a - mdi[i]) / s; });
    d.adx = wilder(dx, ap);
    // VWAP de sesión (fecha de Nueva York)
    const useVol = v.reduce((a, x) => a + x, 0) > 0;
    d.vwap = new Array(n);
    let day = null, pv = 0, vv = 0;
    for (let i = 0; i < n; i++) {
      const dd = nyDate(b.time[i]);
      if (dd !== day) { day = dd; pv = 0; vv = 0; }
      const vol = useVol ? v[i] : 1, tp = (h[i] + l[i] + c[i]) / 3;
      pv += tp * vol; vv += vol;
      d.vwap[i] = vv === 0 ? NaN_ : pv / vv;
    }
    const lb = p.breakout_lookback || 20;
    d.hh = shift(rolling(h, lb, w => Math.max(...w)), 1);
    d.ll = shift(rolling(l, lb, w => Math.min(...w)), 1);
    const va = shift(rolling(v, 20, mean), 1);
    d.vol_ratio = v.map((x, i) => { const r = va[i] === 0 ? NaN_ : x / va[i]; return isn(r) ? 1 : r; });
    return d;
  }

  const FEATURES = ["ret_1", "ret_3", "ret_6", "ret_12", "ret_24", "ret_48", "ret_96",
    "atr_pct", "atr_ratio", "rv_24", "rsi", "adx", "bb_pos", "bb_width",
    "d_ema_fast", "d_ema_slow", "d_ema_trend", "ema_slope", "macd_n", "vol_ratio",
    "range_pos", "d_vwap", "hour_sin", "hour_cos", "dow", "body", "upper_wick", "lower_wick"];

  function features(b, p) {
    const d = indicators(b, p), c = b.close, n = c.length;
    const a = d.atr.map((x, i) => x / c[i]);
    const lr = c.map((x, i) => (i ? Math.log(x / c[i - 1]) : NaN_));
    const atrMean = rolling(d.atr, 96, mean), rv = rolling(lr, 24, std);
    const fin = x => (Number.isFinite(x) ? x : NaN_);
    const rows = [];
    for (let i = 0; i < n; i++) {
      const f = {};
      for (const k of [1, 3, 6, 12, 24, 48, 96]) f["ret_" + k] = i >= k ? Math.log(c[i] / c[i - k]) / a[i] : NaN_;
      f.atr_pct = a[i];
      f.atr_ratio = d.atr[i] / atrMean[i];
      f.rv_24 = rv[i] / a[i];
      f.rsi = d.rsi[i] / 100;
      f.adx = d.adx[i] / 100;
      f.bb_pos = (c[i] - d.bb_mid[i]) / (d.bb_up[i] - d.bb_low[i]);
      f.bb_width = (d.bb_up[i] - d.bb_low[i]) / c[i] / a[i];
      f.d_ema_fast = (c[i] / d.ema_fast[i] - 1) / a[i];
      f.d_ema_slow = (c[i] / d.ema_slow[i] - 1) / a[i];
      f.d_ema_trend = (c[i] / d.ema_trend[i] - 1) / a[i];
      f.ema_slope = i >= 5 ? (d.ema_slow[i] / d.ema_slow[i - 5] - 1) / a[i] : NaN_;
      f.macd_n = d.macd_hist[i] / c[i] / a[i];
      f.vol_ratio = Math.log1p(Math.min(Math.max(d.vol_ratio[i], 0), 50));
      f.range_pos = (c[i] - d.ll[i]) / (d.hh[i] - d.ll[i]);
      f.d_vwap = (c[i] / d.vwap[i] - 1) / a[i];
      const t = new Date(b.time[i]);
      const hr = t.getUTCHours() + t.getUTCMinutes() / 60;
      f.hour_sin = Math.sin(2 * Math.PI * hr / 24);
      f.hour_cos = Math.cos(2 * Math.PI * hr / 24);
      f.dow = ((t.getUTCDay() + 6) % 7) / 6;
      const rng = b.high[i] - b.low[i];
      f.body = rng === 0 ? NaN_ : (c[i] - b.open[i]) / rng;
      f.upper_wick = rng === 0 ? NaN_ : (b.high[i] - Math.max(c[i], b.open[i])) / rng;
      f.lower_wick = rng === 0 ? NaN_ : (Math.min(c[i], b.open[i]) - b.low[i]) / rng;
      for (const k of FEATURES) f[k] = fin(f[k]);
      f.atr = d.atr[i];
      f.rsi_raw = d.rsi[i]; f.adx_raw = d.adx[i];
      rows.push(f);
    }
    return rows;
  }

  // ---- Árboles HistGradientBoosting exportados ----
  function treeRaw(model, x) {
    let raw = model.baseline;
    for (const t of model.trees) {
      let k = 0;
      while (!t.is_leaf[k]) {
        const v = x[t.feature_idx[k]];
        k = isn(v) ? (t.missing_go_to_left[k] ? t.left[k] : t.right[k])
                   : (v <= t.num_threshold[k] ? t.left[k] : t.right[k]);
      }
      raw += t.value[k];
    }
    return raw;
  }
  const sigmoid = z => 1 / (1 + Math.exp(-z));
  const logit = p => Math.log(Math.max(p, 1e-6) / Math.max(1 - p, 1e-6));
  function predict(model, f) {
    const x = model.meta.features.map(k => f[k]);
    return { p_long: sigmoid(treeRaw(model.long, x)), p_short: sigmoid(treeRaw(model.short, x)) };
  }

  // ---- Etiquetas triple barrera (para aprender online de cada vela resuelta) ----
  function tripleBarrier(b, atr, i, tp, sl, H, dir) {
    const c = b.close[i], a = atr[i];
    const win = c + dir * tp * a, stop = c - dir * sl * a;
    for (let k = 1; k <= H; k++) {
      const j = i + k;
      if (j >= b.close.length) return null;
      const hi = b.high[j], lo = b.low[j];
      if (dir === 1) { if (lo <= stop) return 0; if (hi >= win) return 1; }
      else { if (hi >= stop) return 0; if (lo <= win) return 1; }
    }
    return 0;
  }

  // ---- Calibrador online: aprende de velas resueltas y de las operaciones propias ----
  class Calibrator {
    constructor(s) { Object.assign(this, { w: { long: [0, 1], short: [0, 1] }, n: { long: 0, short: 0 },
      hits: { long: 0, short: 0 }, lr: 0.01 }, s || {}); }
    adjust(side, p) { const w = this.w[side]; return sigmoid(w[0] + w[1] * logit(p)); }
    learn(side, p, y, weight = 1) {
      const w = this.w[side], z = logit(p), q = sigmoid(w[0] + w[1] * z), g = (q - y) * weight * this.lr;
      w[0] -= g; w[1] -= g * z;
      w[1] = Math.min(Math.max(w[1], 0.2), 3);   // límites para que no se desboque
      w[0] = Math.min(Math.max(w[0], -2), 2);
      this.n[side] += 1; this.hits[side] += y;
    }
  }

  root.Engine = { ewm, indicators, features, FEATURES, predict, treeRaw, tripleBarrier, Calibrator, sigmoid, logit, nyDate };
  if (typeof module !== "undefined") module.exports = root.Engine;
})(typeof window !== "undefined" ? window : globalThis);
