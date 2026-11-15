// Máquina de trading autónoma en Cloudflare Workers: 6 traders SIMULADOS compitiendo con precios reales.
// Cada 5 min: consulta 7 exchanges y 3 mercados de futuros, revisa stop-loss, busca arbitrajes,
// cobra financiación y deja decidir a los traders cuya vela acaba de cerrar.
import { CONFIG, TRADERS, STRATS, score, explain, positionSize, canOpen, riskUpdate, parseKlines } from "./lib.js";
import { COINS, SPOT_FEES, PERP_FEES, ARB, FUNDING, PAIRS, bestRoutes, apr, fundingPnl, pairStats, pairPnl } from "./pro.js";
import { DASHBOARD } from "./dashboard.js";

export const PRO_TRADERS = [
  { id: "arbitraje", name: "📡 Arbitrajista", kind: "arb",
    simple: "Compara el precio de 10 monedas en 7 exchanges y compra donde está barato para vender donde está caro.",
    note: "No se puede probar con el pasado (haría falta el libro de órdenes histórico): se mide en directo. Supone que ya tienes dinero repartido en cada exchange." },
  { id: "financiacion", name: "💰 Cobrador", kind: "funding",
    simple: "Compra una moneda y a la vez la vende en futuros: no le importa si sube o baja, cobra la financiación.",
    note: "Prueba con 3 años reales: +5,5 % con una caída máxima de solo 0,4 %. Gana poco pero muy estable." },
  { id: "pares", name: "🔗 Estadístico", kind: "pairs",
    simple: "Vigila hasta 45 parejas de monedas que se mueven juntas y apuesta a que vuelven a juntarse cuando se separan.",
    note: "Prueba con 3 años reales: sin comisiones +36 %, con comisiones −26 %. Los profesionales ganan con esto porque casi no pagan comisión." },
];
const SIMPLE = {
  prudente: "Busca subidas fuertes y tendencias claras, revisando cada 4 horas. Opera poco.",
  rapido: "Lo mismo que el Prudente, pero revisa cada hora. Opera varias veces al día.",
  scalper: "Lo mismo, pero cada 15 minutos. Opera sin parar.",
};

// ---------- red ----------
const KRAKEN = "https://api.kraken.com/0/public/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, opts, retries = 1) {
  const r = await fetch(url, { ...opts, headers: { "user-agent": "maquina-trader", ...(opts?.headers || {}) } });
  if (r.status === 429 && retries > 0) { await sleep(2000); return getJSON(url, opts, retries - 1); } // IP compartida de Cloudflare
  if (!r.ok) throw new Error(`${new URL(url).host} ${r.status}`);
  return r.json();
}
async function kget(path, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const j = await getJSON(KRAKEN + path);
      if (!j.error || j.error.length === 0) return j.result;
      last = new Error(`kraken ${JSON.stringify(j.error)}`);
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1)); // límite de peticiones de Kraken
  }
  throw last;
}
async function tickers(alts) {
  const [pairs, t] = await Promise.all([kget(`AssetPairs?pair=${alts.join(",")}`), kget(`Ticker?pair=${alts.join(",")}`)]);
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const alt = pairs[k]?.altname || k;
    out[alt] = { bid: +v.b[0], ask: +v.a[0], bq: +v.b[2], aq: +v.a[2], last: +v.c[0], quoteVolume: +v.v[1] * +v.c[0] };
  }
  return out;
}
async function klines(alt, barMs) {
  const r = await kget(`OHLC?pair=${alt}&interval=${barMs / 60000}`);
  const rows = r[Object.keys(r).find((k) => k !== "last")];
  return rows.slice(-(CONFIG.historyBars + 1)).map((x) => [x[0] * 1000, x[1], x[2], x[3], x[4], x[6], x[0] * 1000 + barMs - 1]);
}

// Precios de las 10 monedas en 7 exchanges, todo convertido a USD. Cada exchange que falle se ignora.
async function gatherQuotes() {
  const sources = {}, raw = {};
  const timed = async (name, f) => {
    const t0 = Date.now();
    try { raw[name] = await f(); sources[name] = { ok: true, ms: Date.now() - t0 }; }
    catch (e) { sources[name] = { ok: false, ms: Date.now() - t0, err: String(e).slice(0, 120) }; }
  };
  const cbCoins = COINS.slice(0, 5); // Coinbase solo da un mercado por petición
  await Promise.all([
    timed("kraken", () => tickers([...COINS.map((c) => c.kraken), "USDTUSD"])),
    timed("coinbase", async () => Object.fromEntries(await Promise.all(cbCoins.map(async (c) => {
      const j = await getJSON(`https://api.exchange.coinbase.com/products/${c.coinbase}/ticker`);
      return [c.coinbase, { bid: +j.bid, ask: +j.ask }];
    })))),
    timed("okx", async () => Object.fromEntries((await getJSON("https://www.okx.com/api/v5/market/tickers?instType=SPOT")).data
      .map((d) => [d.instId, { bid: +d.bidPx, ask: +d.askPx, bq: +d.bidSz, aq: +d.askSz }]))),
    timed("bitfinex", async () => Object.fromEntries((await getJSON(`https://api-pub.bitfinex.com/v2/tickers?symbols=${COINS.map((c) => c.bitfinex).join(",")}`))
      .map((d) => [d[0], { bid: d[1], bq: d[2], ask: d[3], aq: d[4] }]))),
    timed("mexc", async () => Object.fromEntries((await getJSON("https://api.mexc.com/api/v3/ticker/bookTicker"))
      .map((d) => [d.symbol, { bid: +d.bidPrice, ask: +d.askPrice, bq: +d.bidQty, aq: +d.askQty }]))),
    timed("htx", async () => Object.fromEntries((await getJSON("https://api.huobi.pro/market/tickers")).data
      .map((d) => [d.symbol, { bid: d.bid, ask: d.ask, bq: d.bidSize, aq: d.askSize }]))),
    timed("cdc", async () => Object.fromEntries((await getJSON("https://api.crypto.com/exchange/v1/public/get-tickers")).result.data
      .map((d) => [d.i, { bid: +d.b, ask: +d.k }]))),
  ]);
  const usdt = raw.kraken?.USDTUSD ? (raw.kraken.USDTUSD.bid + raw.kraken.USDTUSD.ask) / 2 : 1;
  const quotes = {};
  const conv = (q, f) => q && { bid: q.bid * f, ask: q.ask * f, bq: q.bq, aq: q.aq };
  for (const c of COINS) {
    const byEx = {
      kraken: raw.kraken?.[c.kraken], coinbase: raw.coinbase?.[c.coinbase], bitfinex: raw.bitfinex?.[c.bitfinex], cdc: raw.cdc?.[c.cdc],
      okx: conv(raw.okx?.[c.okx], usdt), mexc: conv(raw.mexc?.[c.mexc], usdt), htx: conv(raw.htx?.[c.htx], usdt),
    };
    quotes[c.coin] = Object.fromEntries(Object.entries(byEx).filter(([, v]) => v && v.bid > 0 && v.ask > 0));
  }
  return { quotes, sources, usdt };
}

// Financiación de los perpetuos (tasa por hora) en 3 mercados de futuros
async function gatherFunding() {
  const sources = {}, rates = [];
  const timed = async (name, f) => {
    const t0 = Date.now();
    try { await f(); sources[name] = { ok: true, ms: Date.now() - t0 }; }
    catch (e) { sources[name] = { ok: false, ms: Date.now() - t0, err: String(e).slice(0, 120) }; }
  };
  await Promise.all([
    timed("hyperliquid", async () => {
      const [meta, ctx] = await getJSON("https://api.hyperliquid.xyz/info", { method: "POST", headers: { "content-type": "application/json" },
                                                                            body: JSON.stringify({ type: "metaAndAssetCtxs" }) });
      const idx = Object.fromEntries(meta.universe.map((u, i) => [u.name, i]));
      for (const c of COINS) { const x = ctx[idx[c.hl]]; if (x) rates.push({ coin: c.coin, venue: "hyperliquid", hourly: +x.funding, mark: +x.markPx }); }
    }),
    timed("krakenf", async () => {
      const t = Object.fromEntries((await getJSON("https://futures.kraken.com/derivatives/api/v3/tickers")).tickers.map((x) => [x.symbol, x]));
      for (const c of COINS) { const x = t[c.kf]; if (x && !x.suspended) rates.push({ coin: c.coin, venue: "krakenf", hourly: +(x.relativeFundingRatePrediction ?? x.relativeFundingRate), mark: +x.markPrice }); }
    }),
    timed("mexcf", async () => {
      const t = Object.fromEntries((await getJSON("https://contract.mexc.com/api/v1/contract/funding_rate")).data.map((x) => [x.symbol, x]));
      for (const c of COINS) { const x = t[c.mexcF]; if (x) rates.push({ coin: c.coin, venue: "mexcf", hourly: +x.fundingRate / (x.collectCycle || 8), mark: +x.fairPrice, usdt: true }); }
    }),
  ]);
  for (const r of rates) r.apr = apr(r.hourly);
  return { rates, sources };
}

// ---------- estado ----------
function fresh() {
  return { cash: CONFIG.paperCapital, positions: {}, risk: { peak: null, day: null, dayStart: null, halted: false, haltReason: "" },
           lastBar: null, universe: [], ranked: [], watch: [], equity: [], log: [], started: Date.now(),
           lastBarRun: null, checks: 0, decisions: 0 };
}
const ALL_IDS = [...TRADERS.map((t) => t.id), ...PRO_TRADERS.map((t) => t.id)];
async function loadAll(env) {
  let all = await env.STATE.get("traders", "json");
  if (!all) { // migración desde la versión de un solo trader
    const old = await env.STATE.get("state", "json");
    all = { meta: { checks: 0, lastRun: null, lastError: null }, traders: {} };
    if (old) all.traders.prudente = { ...fresh(), ...old, watch: [], checks: 0, decisions: (old.equity || []).length };
  }
  for (const id of ALL_IDS) all.traders[id] ??= fresh();
  const trades = {};
  await Promise.all(ALL_IDS.map(async (id) => {
    trades[id] = (await env.STATE.get(`trades:${id}`, "json")) || (id === "prudente" ? (await env.STATE.get("trades", "json")) || [] : []);
  }));
  return { all, trades };
}

function addLog(st, msg, now = Date.now()) { st.log.push([now, msg]); st.log = st.log.slice(-150); }
function telegram(env, msg) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg }) }).catch(() => {});
}
const nice = (p) => ({ XBT: "BTC", XDG: "DOGE" })[p.replace(/USD$/, "")] || p.replace(/USD$/, "");
const pushEquity = (st, now, eq, every = 0) => {
  const last = st.equity[st.equity.length - 1];
  if (!last || now - last[0] >= every) { st.equity.push([now, eq]); st.equity = st.equity.slice(-3000); }
  st.eqNow = eq;
};

// ---------- traders direccionales (Prudente, Rápido, Scalper) ----------
function makeOps(env, t, st, trades, ctx, now) {
  const { fee, slippage } = CONFIG.costs;
  const note = (msg, important) => { addLog(st, msg, now); if (important) ctx.notes.push(telegram(env, `${t.name}: ${msg}`)); };
  const close = (sym, reason, bid) => {
    const p = st.positions[sym];
    const px = bid * (1 - slippage), gross = p.qty * px, f = gross * fee;
    st.cash += gross - f;
    const pnl = gross - f - (p.qty * p.entryPx + p.fee);
    trades.push({ symbol: sym, strategy: p.strat, entryTime: p.entryTime, exitTime: now, entryPx: p.entryPx, exitPx: px,
                  qty: p.qty, pnl, ret: pnl / (p.qty * p.entryPx + p.fee), reason });
    delete st.positions[sym];
    ctx.changed.add(t.id);
    note(`${pnl > 0 ? "✅" : "🔴"} VENDE ${nice(sym)} a ${px.toPrecision(6)} (${reason}) → ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} $`, true);
  };
  const open = (sym, strat, q0, dist, ask, why) => {
    const px = ask * (1 + slippage), qty = Math.min(q0, st.cash / (px * (1 + fee)));
    if (qty * px < t.risk.min_notional) return;
    const f = qty * px * fee;
    st.cash -= qty * px + f;
    st.positions[sym] = { qty, entryPx: px, stop: px - dist, strat, entryTime: now, bars: 0, fee: f, last: px };
    note(`🟢 COMPRA ${nice(sym)} por ${(qty * px).toFixed(0)} $ a ${px.toPrecision(6)} · ${why} · stop ${(px - dist).toPrecision(6)}`, true);
  };
  return { note, close, open };
}
const dirEquity = (st, prices = {}) => st.cash + Object.entries(st.positions).reduce((a, [s, p]) => a + p.qty * (prices[s] ?? p.last ?? p.entryPx), 0);

async function onBar(env, t, st, trades, ctx, now) {
  const ops = makeOps(env, t, st, trades, ctx, now);
  const tk = await tickers(CONFIG.candidates);
  st.universe = Object.entries(tk).sort((a, b) => b[1].quoteVolume - a[1].quoteVolume).slice(0, t.universeSize).map(([s]) => s);

  const want = [...new Set([...st.universe, ...Object.keys(st.positions)])];
  const frames = {}, sigs = {}, scores = {}, prices = {};
  for (const s of want) { // de una en una para respetar el límite de Kraken
    try {
      const d = parseKlines(await klines(s, t.barMs), now);
      frames[s] = d;
      if (d.c.length >= CONFIG.minBars) {
        prices[s] = d.c[d.c.length - 1];
        sigs[s] = Object.fromEntries(Object.entries(t.strategies).map(([n, p]) => [n, STRATS[n](d, p)]));
        scores[s] = score(d);
      }
    } catch (e) { /* un mercado que falla no para al resto */ }
    await sleep(1100);
  }

  const day = new Date(now).toISOString().slice(0, 10);
  if (riskUpdate(t.risk, st.risk, dirEquity(st, prices), day) === "kill") {
    for (const s of Object.keys(st.positions)) ops.close(s, "freno de emergencia", tk[s]?.bid ?? prices[s]);
    ops.note(`⛔ APAGADO por seguridad: ${st.risk.haltReason}`, true);
    pushEquity(st, now, st.cash);
    return { frames, tk };
  }

  for (const s of Object.keys(st.positions)) {
    const p = st.positions[s], sg = sigs[s]?.[p.strat];
    p.bars = (p.bars || 0) + 1;
    if (prices[s]) p.last = prices[s];
    if (!sg) continue;
    if (Number.isFinite(sg.trail) && sg.trail > p.stop) p.stop = sg.trail;
    if (sg.exit) ops.close(s, "la señal se agotó", tk[s]?.bid ?? prices[s]);
  }

  st.ranked = Object.entries(scores).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])
    .slice(0, t.topN).map(([s, v]) => [s, +v.toFixed(3)]);
  const top = new Set(st.ranked.map(([s]) => s));
  st.watch = Object.keys(sigs).map((s) => ({
    s, price: prices[s], score: Number.isFinite(scores[s]) ? +scores[s].toFixed(3) : null, top: top.has(s),
    why: st.positions[s] ? "en cartera" : (Number.isFinite(scores[s]) ? "" : "volatilidad fuera de rango · ") + explain(sigs[s]),
  })).sort((a, b) => (b.score ?? -99) - (a.score ?? -99));

  let bought = 0, signals = 0;
  const eq = dirEquity(st, prices);
  if (canOpen(t.risk, st.risk, eq, Object.keys(st.positions).length)) {
    const cands = [];
    for (const [s] of st.ranked) {
      if (st.positions[s]) continue;
      for (const n of Object.keys(t.strategies)) {
        const sg = sigs[s][n];
        if (sg.entry && Number.isFinite(sg.stop) && sg.stop < prices[s]) { cands.push([sg.strength, s, n, prices[s] - sg.stop]); break; }
      }
    }
    signals = cands.length;
    cands.sort((a, b) => b[0] - a[0]);
    const slots = t.risk.max_positions - Object.keys(st.positions).length;
    for (const [, s, n, dist] of cands.slice(0, Math.max(0, slots))) {
      const q = positionSize(t.risk, eq, st.cash, prices[s], prices[s] - dist);
      if (q > 0 && tk[s]) { ops.open(s, n, q, dist, tk[s].ask, n === "breakout" ? "ruptura" : "tendencia"); bought++; }
    }
  }
  st.decisions++;
  const best = st.watch.find((w) => w.top && !st.positions[w.s]);
  ops.note(`📊 Vela de ${t.timeframe} cerrada: analizados ${Object.keys(sigs).length} mercados, ${signals} señales, ${bought} compras` +
    (bought ? "" : best ? ` · mejor candidato ${nice(best.s)}: ${best.why}` : " · nada interesante, espera"));
  pushEquity(st, now, dirEquity(st, prices));
  return { frames, tk };
}

// ---------- 📡 Arbitrajista ----------
export function arbStep(env, st, trades, ctx, now, quotes) {
  const routes = bestRoutes(quotes);
  st.checks++;
  st.radar = { t: now, quotes, routes };
  st.cooldown ??= {};
  let done = 0;
  for (const r of routes) {
    if (!(r.net > ARB.minNet) || r.gross > ARB.maxGross) continue; // >3 % suele ser un dato erróneo o retiradas bloqueadas
    const key = `${r.coin}:${r.buyEx}>${r.sellEx}`;
    if (st.cooldown[key] && now - st.cooldown[key] < ARB.cooldownMs) continue;
    const size = Math.min(ARB.maxSize, r.depth, st.cash * 0.25);
    if (!(size >= 10)) continue;
    const pnl = size * r.net;
    st.cash += pnl;
    st.cooldown[key] = now;
    trades.push({ coin: r.coin, buyEx: r.buyEx, sellEx: r.sellEx, buyPx: r.buyPx, sellPx: r.sellPx, size, gross: r.gross, net: r.net, pnl, time: now });
    ctx.changed.add("arbitraje");
    addLog(st, `⚡ ARBITRAJE ${r.coin}: compra en ${r.buyEx} a ${r.buyPx.toPrecision(6)}, vende en ${r.sellEx} a ${r.sellPx.toPrecision(6)} → +${pnl.toFixed(2)} $ (${(r.net * 100).toFixed(2)} % neto)`, now);
    done++;
  }
  for (const k of Object.keys(st.cooldown)) if (now - st.cooldown[k] > ARB.cooldownMs) delete st.cooldown[k];
  const best = routes[0];
  st.bestSeen ??= [];
  if (best) { st.bestSeen.push([now, +best.gross.toFixed(5), +best.net.toFixed(5), best.coin]); st.bestSeen = st.bestSeen.slice(-600); }
  if (!done && st.checks % 12 === 1 && best) // un resumen cada hora para no llenar el registro
    addLog(st, `🔎 ${routes.length} monedas comparadas en 7 exchanges · mejor diferencia ${best.coin} ${(best.gross * 100).toFixed(2)} % (tras comisiones ${(best.net * 100).toFixed(2)} %) · no compensa`, now);
  st.decisions = st.checks;
  pushEquity(st, now, st.cash, 3600_000);
}

// ---------- 💰 Cobrador de financiación ----------
export function fundingStep(env, st, trades, ctx, now, rates, quotes, usdt) {
  st.checks++;
  const spot = {};
  for (const c of COINS) { const q = quotes[c.coin]?.kraken || Object.values(quotes[c.coin] || {})[0]; if (q) spot[c.coin] = (q.bid + q.ask) / 2; }
  const key = (r) => `${r.coin}@${r.venue}`;
  const byKey = Object.fromEntries(rates.map((r) => [key(r), { ...r, markUsd: r.usdt ? r.mark * usdt : r.mark }]));
  const prev = st.prevApr || {};
  st.rates = rates.map((r) => ({ coin: r.coin, venue: r.venue, apr: r.apr, hourly: r.hourly })).sort((a, b) => b.apr - a.apr);

  // cobrar lo devengado y valorar
  for (const [k, p] of Object.entries(st.positions)) {
    const r = byKey[k];
    if (!r || !spot[p.coin]) { p.missing = (p.missing || 0) + 1; continue; }
    p.missing = 0;
    const hours = (now - p.lastT) / 3600_000;
    p.earned += p.qty * r.markUsd * r.hourly * hours; // tasa positiva: el que vende en perpetuo cobra
    p.lastT = now; p.spotNow = spot[p.coin]; p.perpNow = r.markUsd; p.aprNow = r.apr;
  }
  const exitCost = (p) => p.qty * (p.spotNow ?? p.spotEntry) * (FUNDING.spotFee + PERP_FEES[p.venue] + 2 * FUNDING.slip);
  // salidas: financiación baja dos revisiones seguidas, o sin datos mucho rato
  for (const [k, p] of Object.entries(st.positions)) {
    const low = byKey[k] && byKey[k].apr < FUNDING.exitApr && (prev[k] ?? 1) < FUNDING.exitApr;
    if (low || p.missing > 6) {
      const value = fundingPnl(p, p.spotNow ?? p.spotEntry, p.perpNow ?? p.perpEntry);
      const pnl = value - exitCost(p) - p.fee;
      st.cash += value - exitCost(p); // la comisión de entrada ya se descontó al entrar
      trades.push({ coin: p.coin, venue: p.venue, entryTime: p.entryTime, exitTime: now, notional: p.qty * p.spotEntry,
                    earned: p.earned, basis: value - p.earned, fees: p.fee + exitCost(p), pnl, reason: low ? "la financiación bajó" : "sin datos" });
      delete st.positions[k];
      ctx.changed.add("financiacion");
      addLog(st, `${pnl > 0 ? "✅" : "🔴"} CIERRA ${p.coin} en ${p.venue}: cobró ${p.earned.toFixed(2)} $, resultado ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} $`, now);
    }
  }
  const equity = () => st.cash + Object.values(st.positions).reduce((a, p) => a + fundingPnl(p, p.spotNow ?? p.spotEntry, p.perpNow ?? p.perpEntry), 0);
  // entradas: financiación alta dos revisiones seguidas, una moneda solo una vez
  const held = new Set(Object.values(st.positions).map((p) => p.coin));
  const cands = Object.values(byKey).filter((r) => r.apr > FUNDING.enterApr && (prev[key(r)] ?? 0) > FUNDING.enterApr && spot[r.coin] && !held.has(r.coin))
    .sort((a, b) => b.apr - a.apr);
  for (const r of cands) {
    if (Object.keys(st.positions).length >= FUNDING.slots || held.has(r.coin)) continue;
    const notional = equity() * FUNDING.capitalFrac / FUNDING.slots, qty = notional / spot[r.coin];
    const fee = notional * (FUNDING.spotFee + PERP_FEES[r.venue] + 2 * FUNDING.slip);
    st.cash -= fee;
    st.positions[key(r)] = { coin: r.coin, venue: r.venue, qty, spotEntry: spot[r.coin], perpEntry: r.markUsd, entryTime: now, lastT: now,
                             earned: 0, fee, spotNow: spot[r.coin], perpNow: r.markUsd, aprNow: r.apr };
    held.add(r.coin);
    addLog(st, `🟢 ABRE ${r.coin}: compra ${notional.toFixed(0)} $ al contado y vende lo mismo en ${r.venue} · financiación ${(r.apr * 100).toFixed(1)} % anual`, now);
  }
  st.prevApr = Object.fromEntries(Object.entries(byKey).map(([k, r]) => [k, r.apr]));
  st.decisions = st.checks;
  if (st.checks % 12 === 1 && !cands.length && st.rates[0])
    addLog(st, `🔎 ${rates.length} tasas revisadas · la mejor: ${st.rates[0].coin} en ${st.rates[0].venue} ${(st.rates[0].apr * 100).toFixed(1)} % anual (necesita más de ${FUNDING.enterApr * 100} %)`, now);
  pushEquity(st, now, equity(), 3600_000);
}

// ---------- 🔗 Estadístico de pares (cada hora, con velas de 1 h) ----------
export function pairsStep(env, st, trades, ctx, now, frames, tk) {
  const coins = COINS.filter((c) => frames[c.kraken]?.c?.length >= PAIRS.corrWindow + 1);
  const sets = coins.map((c) => new Set(frames[c.kraken].t));
  const common = coins.length ? frames[coins[0].kraken].t.filter((t) => sets.every((s) => s.has(t))) : [];
  const closes = Object.fromEntries(coins.map((c) => {
    const d = frames[c.kraken], m = new Map(d.t.map((t, i) => [t, d.c[i]]));
    return [c.coin, common.map((t) => m.get(t))];
  }));
  // precio de ejecución: compra al ask, vende al bid (si no hay libro, último cierre)
  const px = (coin, side) => { const c = COINS.find((x) => x.coin === coin), q = tk?.[c.kraken]; return q ? (side > 0 ? q.ask : q.bid) : closes[coin]?.at(-1); };
  const stats = [];
  for (let i = 0; i < coins.length; i++) for (let j = i + 1; j < coins.length; j++) {
    const A = coins[i].coin, B = coins[j].coin, s = pairStats(closes[A], closes[B]);
    if (s && Number.isFinite(s.z)) stats.push({ A, B, z: s.z, corr: s.corr });
  }
  st.pairs = stats.slice().sort((a, b) => Math.abs(b.z) - Math.abs(a.z)).map((p) => ({ ...p, z: +p.z.toFixed(2), corr: +p.corr.toFixed(2) }));
  const zOf = Object.fromEntries(stats.map((p) => [`${p.A}/${p.B}`, p]));
  const half = PAIRS.costRoundTrip / 2;
  const value = (p) => pairPnl(p, px(p.A, -p.side) ?? p.pxA, px(p.B, p.side) ?? p.pxB);
  // salidas
  for (const [k, p] of Object.entries(st.positions)) {
    p.bars = (p.bars || 0) + 1;
    const s = zOf[k];
    p.zNow = s ? +s.z.toFixed(2) : null; p.pnlNow = value(p);
    const why = !s ? "sin datos" : Math.abs(s.z) < PAIRS.zOut ? "volvieron a juntarse" : Math.abs(s.z) > PAIRS.zStop ? "stop: se separaron más"
      : p.bars >= PAIRS.maxHold ? "tiempo máximo" : null;
    if (!why) continue;
    const exitPnl = p.pnlNow - p.n * half;           // valor menos comisión de salida
    const pnl = exitPnl - p.n * half;                 // resultado total (la de entrada ya se pagó)
    st.cash += p.n + exitPnl;
    trades.push({ A: p.A, B: p.B, side: p.side, entryTime: p.entryTime, exitTime: now, n: p.n, zIn: p.zIn, zOut: p.zNow, pnl, ret: pnl / p.n, reason: why });
    delete st.positions[k];
    ctx.changed.add("pares");
    addLog(st, `${pnl > 0 ? "✅" : "🔴"} CIERRA ${p.A}/${p.B} (${why}) → ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} $`, now);
  }
  const equity = () => st.cash + Object.values(st.positions).reduce((a, p) => a + p.n + (p.pnlNow ?? 0), 0);
  // entradas
  let opened = 0;
  for (const s of stats.filter((s) => Math.abs(s.z) > PAIRS.zIn && s.corr > PAIRS.minCorr).sort((a, b) => Math.abs(b.z) - Math.abs(a.z))) {
    const k = `${s.A}/${s.B}`;
    if (st.positions[k] || Object.keys(st.positions).length >= PAIRS.slots) continue;
    const n = equity() / PAIRS.slots;
    if (st.cash < n * (1 + half)) break;
    const side = s.z > 0 ? -1 : 1; // z>0: A está cara -> vende A, compra B
    st.cash -= n + n * half;
    st.positions[k] = { A: s.A, B: s.B, side, n, pxA: px(s.A, side), pxB: px(s.B, -side), zIn: +s.z.toFixed(2), zNow: +s.z.toFixed(2),
                        entryTime: now, bars: 0, pnlNow: 0 };
    const [buy, sell] = side > 0 ? [s.A, s.B] : [s.B, s.A];
    addLog(st, `🟢 ABRE pareja ${s.A}/${s.B}: compra ${buy} y vende ${sell} (${n.toFixed(0)} $) · separación z=${s.z.toFixed(2)}, correlación ${s.corr.toFixed(2)}`, now);
    opened++;
  }
  st.checks++; st.decisions++; st.lastBarRun = now;
  if (!opened) addLog(st, `📊 ${stats.length} parejas analizadas · la más separada: ${st.pairs[0] ? `${st.pairs[0].A}/${st.pairs[0].B} z=${st.pairs[0].z}` : "–"} (entra con |z| > ${PAIRS.zIn} y correlación > ${PAIRS.minCorr})`, now);
  pushEquity(st, now, equity());
}

// ---------- ciclo principal ----------
async function tick(env, now = Date.now()) {
  const { all, trades } = await loadAll(env);
  const ctx = { changed: new Set(), notes: [] };
  const errors = [];
  const step = async (name, f) => { try { await f(); } catch (e) { errors.push(`${name}: ${String((e && e.stack) || e).slice(0, 300)}`); } };

  // 1) datos de mercado de todos los exchanges a la vez
  let market = null, funding = null;
  await step("datos", async () => { [market, funding] = await Promise.all([gatherQuotes(), gatherFunding()]); });
  if (market) all.meta.sources = { ...market.sources, ...funding.sources };

  // 2) stop-loss de los traders direccionales
  await step("stops", async () => {
    const openSyms = [...new Set(TRADERS.flatMap((t) => Object.keys(all.traders[t.id].positions)))];
    const book = openSyms.length ? await tickers(openSyms) : {};
    for (const t of TRADERS) {
      const st = all.traders[t.id], ops = makeOps(env, t, st, trades[t.id], ctx, now);
      st.checks++;
      for (const s of Object.keys(st.positions)) {
        const b = book[s]; if (!b) continue;
        st.positions[s].last = b.bid;
        if (b.bid <= st.positions[s].stop) ops.close(s, "stop-loss", b.bid);
      }
      st.eqNow = dirEquity(st);
    }
  });

  // 3) traders profesionales que trabajan en cada revisión
  if (market) {
    await step("arbitraje", () => arbStep(env, all.traders.arbitraje, trades.arbitraje, ctx, now, market.quotes));
    await step("financiacion", () => fundingStep(env, all.traders.financiacion, trades.financiacion, ctx, now, funding.rates, market.quotes, market.usdt));
  }

  // 4) el trader direccional cuya vela acaba de cerrar (uno por ejecución)
  await step("velas", async () => {
    const due = TRADERS.find((t) => {
      const st = all.traders[t.id], bar = Math.floor(now / t.barMs);
      return !st.risk.halted && bar !== st.lastBar && now - bar * t.barMs > 30_000;
    });
    if (!due) return;
    const st = all.traders[due.id];
    const res = await onBar(env, due, st, trades[due.id], ctx, now);
    st.lastBar = Math.floor(now / due.barMs);
    st.lastBarRun = now;
    if (due.id === "rapido") {
      await step("pares", () => pairsStep(env, all.traders.pares, trades.pares, ctx, now, res.frames, res.tk));
      all.traders.pares.lastBar = st.lastBar;
    }
  });
  // si el Rápido está apagado, el Estadístico pide sus propias velas de 1 h
  const pst = all.traders.pares, hourBar = Math.floor(now / 3600_000);
  if (all.traders.rapido.risk.halted && pst.lastBar !== hourBar && now - hourBar * 3600_000 > 30_000) {
    await step("pares", async () => {
      const frames = {};
      for (const c of COINS) { try { frames[c.kraken] = parseKlines(await klines(c.kraken, 3600_000), now); } catch (e) {} await sleep(1100); }
      pairsStep(env, pst, trades.pares, ctx, now, frames, null);
      pst.lastBar = hourBar;
    });
  }

  all.meta.lastError = errors.length ? [now, errors.join(" | ").slice(0, 900)] : null;
  all.meta.checks = (all.meta.checks || 0) + 1;
  all.meta.lastRun = now;
  await Promise.all(ctx.notes);
  await env.STATE.put("traders", JSON.stringify(all));
  await Promise.all([...ctx.changed].map((id) => env.STATE.put(`trades:${id}`, JSON.stringify(trades[id].slice(-500)))));
  return all;
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/state") {
      const { all, trades } = await loadAll(env);
      const dir = TRADERS.map((t) => ({ id: t.id, name: t.name, kind: "dir", timeframe: t.timeframe, note: t.note, simple: SIMPLE[t.id],
                                        state: all.traders[t.id], trades: trades[t.id] }));
      const pro = PRO_TRADERS.map((t) => ({ ...t, state: all.traders[t.id], trades: trades[t.id] }));
      return Response.json({ now: Date.now(), meta: all.meta, capital: CONFIG.paperCapital,
                             fees: { spot: SPOT_FEES, perp: PERP_FEES, directional: CONFIG.costs }, traders: [...dir, ...pro] },
                           { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/") return new Response(DASHBOARD, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("No encontrado", { status: 404 });
  },
};
