// Pruebas de los traders profesionales con situaciones controladas (sin red).
import assert from "node:assert";
import { bestRoutes, SPOT_FEES, PERP_FEES, FUNDING, PAIRS, pairStats } from "./pro.js";
import { arbStep, fundingStep, pairsStep } from "./worker.js";

const fresh = () => ({ cash: 1000, positions: {}, risk: { halted: false }, equity: [], log: [], checks: 0, decisions: 0 });
const ctx = () => ({ changed: new Set(), notes: [] });
const near = (a, b, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${a} != ${b}`);
const H = 3600_000;
let now = Date.UTC(2026, 0, 1);

// ---------- Arbitrajista ----------
{
  const quotes = { BTC: { kraken: { bid: 100, ask: 100.1 }, okx: { bid: 101, ask: 101.1, bq: 10, aq: 10 } },
                   ETH: { kraken: { bid: 50, ask: 50.05 }, okx: { bid: 50.06, ask: 50.1 } } };
  const r = bestRoutes(quotes);
  const btc = r.find((x) => x.coin === "BTC");
  assert.equal(btc.buyEx, "kraken"); assert.equal(btc.sellEx, "okx");
  near(btc.net, (101 * (1 - SPOT_FEES.okx)) / (100.1 * (1 + SPOT_FEES.kraken)) - 1);
  assert.ok(r.find((x) => x.coin === "ETH").net < 0, "una diferencia pequeña no cubre comisiones");
  const st = fresh(), tr = [];
  arbStep({}, st, tr, ctx(), now, quotes);
  assert.equal(tr.length, 1, "solo arbitra BTC");
  near(st.cash, 1000 + 50 * btc.net); // Kraken no da profundidad en este caso: tope prudente de 50 $
  arbStep({}, st, tr, ctx(), now + 5 * 60_000, quotes);
  assert.equal(tr.length, 1, "no repite la misma ruta antes de 30 min");
  const bad = { BTC: { kraken: { bid: 100, ask: 100.1 }, htx: { bid: 110, ask: 110.1 } } };
  arbStep({}, st, tr, ctx(), now + 2 * H, bad);
  assert.equal(tr.length, 1, "ignora diferencias >3 % (dato dudoso)");
  console.log("arbitraje OK · ganancia", tr[0].pnl.toFixed(3), "$");
}

// ---------- Cobrador de financiación ----------
{
  const st = fresh(), tr = [];
  const q = (p) => ({ BTC: { kraken: { bid: p, ask: p } } });
  const rate = (h, mark) => [{ coin: "BTC", venue: "hyperliquid", hourly: h, mark, apr: h * 24 * 365 }];
  fundingStep({}, st, tr, ctx(), now, rate(0.0001, 100), q(100), 1);
  assert.equal(Object.keys(st.positions).length, 0, "espera a confirmar la tasa");
  fundingStep({}, st, tr, ctx(), now + 5 * 60_000, rate(0.0001, 100), q(100), 1);
  const p = st.positions["BTC@hyperliquid"];
  assert.ok(p, "entra con financiación alta confirmada");
  const notional = 1000 * FUNDING.capitalFrac / FUNDING.slots;
  near(p.qty * 100, notional);
  const fee = notional * (FUNDING.spotFee + PERP_FEES.hyperliquid + 2 * FUNDING.slip);
  near(st.cash, 1000 - fee);
  // 10 horas después el precio ha subido un 20 %: neutral, solo cuenta la financiación
  fundingStep({}, st, tr, ctx(), now + 5 * 60_000 + 10 * H, rate(0.0001, 120), q(120), 1);
  near(p.earned, p.qty * 120 * 0.0001 * 10);
  near(st.eqNow, 1000 - fee + p.earned);
  fundingStep({}, st, tr, ctx(), now + 11 * H, rate(0, 120), q(120), 1);
  assert.ok(st.positions["BTC@hyperliquid"], "un solo dato bajo no basta para salir");
  fundingStep({}, st, tr, ctx(), now + 11 * H + 60_000, rate(0, 120), q(120), 1);
  assert.equal(tr.length, 1);
  const exitFee = p.qty * 120 * (FUNDING.spotFee + PERP_FEES.hyperliquid + 2 * FUNDING.slip);
  near(tr[0].pnl, tr[0].earned - fee - exitFee, 1e-6);
  near(st.cash, 1000 + tr[0].pnl, 1e-6);
  console.log("financiación OK · cobrado", tr[0].earned.toFixed(3), "$ · resultado", tr[0].pnl.toFixed(3), "$");
}

// ---------- Estadístico de pares ----------
{
  const N = 401, t0 = Date.UTC(2026, 0, 1);
  const mk = (f) => ({ t: Array.from({ length: N }, (_, i) => t0 + i * H), c: Array.from({ length: N }, (_, i) => f(i)) });
  const noise = (i, k) => Math.sin(i * 1.7 + k) * 0.004 + Math.cos(i * 0.37 + 2 * k) * 0.003;
  const common = (i) => Math.exp(0.02 * Math.sin(i / 15) + noise(i, 0));
  const frames = {
    XBTUSD: mk((i) => 100 * common(i) * Math.exp(noise(i, 1) * 0.3)),
    ETHUSD: mk((i) => 50 * common(i) * Math.exp(noise(i, 2) * 0.3 + (i === N - 1 ? 0.05 : 0))), // ETH se dispara al final
  };
  const st = fresh(), tr = [];
  pairsStep({}, st, tr, ctx(), now, frames, null);
  const k = "BTC/ETH", p = st.positions[k];
  assert.ok(p, "abre la pareja separada: " + JSON.stringify(st.pairs));
  assert.equal(p.side, 1, "ETH cara: compra BTC (A) y vende ETH (B)");
  near(st.cash + p.n, 1000 - p.n * PAIRS.costRoundTrip / 2);
  // vuelven a juntarse: ETH cae un 5 %
  const a = frames.XBTUSD.c, b = frames.ETHUSD.c;
  const prev = a.slice(N - 168, N - 1).map((x, i) => Math.log(x) - Math.log(b[N - 168 + i]));
  b[N - 1] = a[N - 1] / Math.exp(prev.reduce((x, y) => x + y, 0) / prev.length); // relación normal: z ≈ 0
  pairsStep({}, st, tr, ctx(), now + H, frames, null);
  assert.equal(tr.length, 1); assert.equal(tr[0].reason, "volvieron a juntarse");
  const legB = -(p.n / 2) * (frames.ETHUSD.c[N - 1] / p.pxB - 1) * p.side;
  near(tr[0].pnl, legB - p.n * PAIRS.costRoundTrip, 1e-9);
  assert.ok(tr[0].pnl > 0, "gana al cerrarse la separación");
  near(st.cash, 1000 + tr[0].pnl);
  console.log("pares OK · resultado", tr[0].pnl.toFixed(3), "$");
}
console.log("todas las pruebas de traders profesionales OK");
