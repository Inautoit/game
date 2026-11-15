// Estrategias "profesionales": arbitraje entre exchanges, cobro de financiación y pares estadísticos.
// Lógica pura (sin red) para poder probarla. Los resultados de las pruebas históricas están en las notas.

// Monedas vigiladas y su nombre en cada exchange
export const COINS = [
  ["BTC", "XBTUSD", "BTC-USD", "BTC-USDT", "tBTCUSD", "BTCUSDT", "btcusdt", "BTC_USD", "BTC", "BTC_USDT", "PF_XBTUSD"],
  ["ETH", "ETHUSD", "ETH-USD", "ETH-USDT", "tETHUSD", "ETHUSDT", "ethusdt", "ETH_USD", "ETH", "ETH_USDT", "PF_ETHUSD"],
  ["SOL", "SOLUSD", "SOL-USD", "SOL-USDT", "tSOLUSD", "SOLUSDT", "solusdt", "SOL_USD", "SOL", "SOL_USDT", "PF_SOLUSD"],
  ["XRP", "XRPUSD", "XRP-USD", "XRP-USDT", "tXRPUSD", "XRPUSDT", "xrpusdt", "XRP_USD", "XRP", "XRP_USDT", "PF_XRPUSD"],
  ["DOGE", "XDGUSD", "DOGE-USD", "DOGE-USDT", "tDOGE:USD", "DOGEUSDT", "dogeusdt", "DOGE_USD", "DOGE", "DOGE_USDT", "PF_DOGEUSD"],
  ["ADA", "ADAUSD", "ADA-USD", "ADA-USDT", "tADAUSD", "ADAUSDT", "adausdt", "ADA_USD", "ADA", "ADA_USDT", "PF_ADAUSD"],
  ["LINK", "LINKUSD", "LINK-USD", "LINK-USDT", "tLINK:USD", "LINKUSDT", "linkusdt", "LINK_USD", "LINK", "LINK_USDT", "PF_LINKUSD"],
  ["LTC", "LTCUSD", "LTC-USD", "LTC-USDT", "tLTCUSD", "LTCUSDT", "ltcusdt", "LTC_USD", "LTC", "LTC_USDT", "PF_LTCUSD"],
  ["AVAX", "AVAXUSD", "AVAX-USD", "AVAX-USDT", "tAVAX:USD", "AVAXUSDT", "avaxusdt", "AVAX_USD", "AVAX", "AVAX_USDT", "PF_AVAXUSD"],
  ["DOT", "DOTUSD", "DOT-USD", "DOT-USDT", "tDOTUSD", "DOTUSDT", "dotusdt", "DOT_USD", "DOT", "DOT_USDT", "PF_DOTUSD"],
].map(([coin, kraken, coinbase, okx, bitfinex, mexc, htx, cdc, hl, mexcF, kf]) =>
  ({ coin, kraken, coinbase, okx, bitfinex, mexc, htx, cdc, hl, mexcF, kf }));

// Comisión "taker" aproximada del tramo de menor volumen (particular). Revisa tu cuenta: cambian a menudo.
export const SPOT_FEES = { kraken: 0.004, coinbase: 0.006, okx: 0.001, bitfinex: 0.002, mexc: 0.0005, htx: 0.002, cdc: 0.0025 };
export const EX_NAMES = { kraken: "Kraken", coinbase: "Coinbase", okx: "OKX", bitfinex: "Bitfinex", mexc: "MEXC", htx: "HTX", cdc: "Crypto.com" };
export const PERP_FEES = { hyperliquid: 0.00045, krakenf: 0.0005, mexcf: 0.0004 };
export const VENUE_NAMES = { hyperliquid: "Hyperliquid", krakenf: "Kraken Futures", mexcf: "MEXC Futuros" };

// Si un exchange no dice cuánta cantidad hay a ese precio, se limita a unknownDepthSize por prudencia.
export const ARB = { maxSize: 250, unknownDepthSize: 50, minNet: 0.0005, maxGross: 0.03, cooldownMs: 30 * 60_000 };
export const FUNDING = { slots: 3, capitalFrac: 0.5, enterApr: 0.15, exitApr: 0.03, spotFee: 0.001, slip: 0.0005 };
export const PAIRS = { lookback: 168, corrWindow: 200, zIn: 2.5, zOut: 0.5, zStop: 4.5, maxHold: 72, minCorr: 0.7,
                       costRoundTrip: 0.0007, slots: 5 };

// ---------- Radar / arbitraje ----------
// quotes: {coin: {ex: {bid, ask, bq, aq}}} ya en USD. Devuelve la mejor ruta por moneda.
export function bestRoutes(quotes, fees = SPOT_FEES) {
  const out = [];
  for (const [coin, byEx] of Object.entries(quotes)) {
    const q = Object.entries(byEx).filter(([, v]) => v.bid > 0 && v.ask > 0 && v.ask >= v.bid && v.ask / v.bid - 1 < 0.01);
    if (q.length < 2) continue;
    let best = null;
    for (const [bx, b] of q) for (const [sx, s] of q) {
      if (bx === sx) continue;
      const gross = s.bid / b.ask - 1;
      const net = (s.bid * (1 - fees[sx])) / (b.ask * (1 + fees[bx])) - 1;
      if (!best || net > best.net) best = { coin, buyEx: bx, sellEx: sx, buyPx: b.ask, sellPx: s.bid, gross, net,
                                            depth: Math.min(b.aq ? b.aq * b.ask : ARB.unknownDepthSize, s.bq ? s.bq * s.bid : ARB.unknownDepthSize) };
    }
    out.push(best);
  }
  return out.sort((a, b) => b.net - a.net);
}

// ---------- Financiación ----------
export const apr = (hourly) => hourly * 24 * 365;

// pnl de una posición neutral: compra al contado + venta en perpetuo de la misma cantidad
export function fundingPnl(p, spotNow, perpNow) {
  return p.earned + p.qty * (spotNow - p.spotEntry) - p.qty * (perpNow - p.perpEntry);
}

// ---------- Pares estadísticos ----------
const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;
function std(a) { const m = mean(a); return Math.sqrt(a.reduce((x, y) => x + (y - m) ** 2, 0) / (a.length - 1)); }
export function corr(a, b) {
  const ma = mean(a), mb = mean(b); let n = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) { n += (a[i] - ma) * (b[i] - mb); da += (a[i] - ma) ** 2; db += (b[i] - mb) ** 2; }
  return n / Math.sqrt(da * db);
}
// z-score de la relación de precios en la última vela + correlación de rentabilidades (igual que bot/pairs.py)
export function pairStats(ca, cb, cfg = PAIRS) {
  const N = ca.length;
  if (N < Math.max(cfg.lookback, cfg.corrWindow + 1)) return null;
  const r = ca.map((x, i) => Math.log(x) - Math.log(cb[i]));
  const w = r.slice(N - cfg.lookback);
  const z = (r[N - 1] - mean(w)) / std(w);
  const ra = [], rb = [];
  for (let i = N - cfg.corrWindow; i < N; i++) { ra.push(Math.log(ca[i] / ca[i - 1])); rb.push(Math.log(cb[i] / cb[i - 1])); }
  return { z, corr: corr(ra, rb) };
}
// valor actual de una pareja abierta: mitad comprada, mitad vendida
export function pairPnl(p, pxA, pxB) {
  const half = p.n / 2;
  const legA = half * (pxA / p.pxA - 1) * p.side, legB = -half * (pxB / p.pxB - 1) * p.side;
  return legA + legB;
}
