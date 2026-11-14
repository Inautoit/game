// Máquina de trading autónoma en Cloudflare Workers (modo SIMULADO con precios reales de Kraken).
// Cron cada 5 min: vigila stop-loss. Al cerrar cada vela de 4h: escanea, decide y opera.
import { CONFIG, STRATS, score, positionSize, canOpen, riskUpdate, parseKlines } from "./lib.js";
import { DASHBOARD } from "./dashboard.js";

// ---- Fuente de datos: Kraken (API pública) ----
const KRAKEN = "https://api.kraken.com/0/public/";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function kget(path, tries = 3) {
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(KRAKEN + path, { headers: { "user-agent": "maquina-trader" } });
      const j = await r.json();
      if (r.ok && (!j.error || j.error.length === 0)) return j.result;
      last = new Error(`kraken ${r.status} ${JSON.stringify(j.error)}`);
    } catch (e) { last = e; }
    await sleep(1500 * (i + 1)); // límite de peticiones de Kraken
  }
  throw last;
}
// Precio actual (bid/ask) y volumen 24h de varios pares de una vez
async function tickers(alts) {
  const [pairs, t] = await Promise.all([kget(`AssetPairs?pair=${alts.join(",")}`), kget(`Ticker?pair=${alts.join(",")}`)]);
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const alt = pairs[k]?.altname || k;
    out[alt] = { bid: +v.b[0], ask: +v.a[0], last: +v.c[0], quoteVolume: +v.v[1] * +v.c[0] };
  }
  return out;
}
async function klines(alt) {
  const r = await kget(`OHLC?pair=${alt}&interval=${CONFIG.barMs / 60000}`);
  const rows = r[Object.keys(r).find((k) => k !== "last")];
  return rows.slice(-(CONFIG.historyBars + 1)).map((x) => [x[0] * 1000, x[1], x[2], x[3], x[4], x[6], x[0] * 1000 + CONFIG.barMs - 1]);
}
async function book(sym) { return (await tickers([sym]))[sym]; }

function freshState() {
  return { cash: CONFIG.paperCapital, positions: {}, risk: { peak: null, day: null, dayStart: null, halted: false, haltReason: "" },
           lastBar: null, universe: [], ranked: [], equity: [], log: [], started: Date.now(), lastRun: null,
           lastError: null, lastBarRun: null };
}
async function load(env) {
  const [s, t] = await Promise.all([env.STATE.get("state", "json"), env.STATE.get("trades", "json")]);
  return { st: s || freshState(), trades: t || [] };
}
async function save(env, st, trades, tradesChanged) {
  await env.STATE.put("state", JSON.stringify(st));
  if (tradesChanged) await env.STATE.put("trades", JSON.stringify(trades.slice(-500)));
}

function note(env, st, msg) {
  st.log.push([Date.now(), msg]);
  st.log = st.log.slice(-100);
  if (env.TELEGRAM_TOKEN && env.TELEGRAM_CHAT_ID) {
    return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg }) }).catch(() => {});
  }
}

async function tick(env, now = Date.now()) {
  const { st, trades } = await load(env);
  const ctx = { tradesChanged: false, notes: [] };
  const { fee, slippage } = CONFIG.costs;

  const closePos = async (sym, reason, bid) => {
    const p = st.positions[sym];
    if (!p) return;
    bid = bid ?? (await book(sym)).bid;
    const px = bid * (1 - slippage), gross = p.qty * px, f = gross * fee;
    st.cash += gross - f;
    const pnl = gross - f - (p.qty * p.entryPx + p.fee);
    trades.push({ symbol: sym, strategy: p.strat, entryTime: p.entryTime, exitTime: now, entryPx: p.entryPx, exitPx: px,
                  qty: p.qty, pnl, ret: pnl / (p.qty * p.entryPx + p.fee), reason });
    delete st.positions[sym];
    ctx.tradesChanged = true;
    ctx.notes.push(note(env, st, `${pnl > 0 ? "✅" : "🔴"} VENTA ${sym} @ ${px.toPrecision(6)} | ${reason} | ${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)} USD`));
  };

  try {
    // 1) stop-loss (cada 5 minutos)
    const open = Object.keys(st.positions);
    const books = open.length ? await tickers(open) : {};
    for (const sym of open) {
      const { bid } = books[sym];
      st.positions[sym].last = bid;
      if (bid <= st.positions[sym].stop) await closePos(sym, "stop", bid);
    }

    // 2) nueva vela cerrada -> decidir
    const bar = Math.floor(now / CONFIG.barMs);
    if (!st.risk.halted && bar !== st.lastBar && now - bar * CONFIG.barMs > 60_000) {
      await onBar(env, st, now, closePos, ctx);
      st.lastBar = bar;
      st.lastBarRun = now;
    }
    st.lastError = null;
  } catch (e) {
    st.lastError = [now, String(e && e.stack || e).slice(0, 500)];
  }
  st.lastRun = now;
  await Promise.all(ctx.notes);
  await save(env, st, trades, ctx.tradesChanged);
  return st;
}

async function onBar(env, st, now, closePos, ctx) {
  const { fee, slippage } = CONFIG.costs;
  // ¿Dónde? los más líquidos entre los candidatos
  const tk = await tickers(CONFIG.candidates);
  st.universe = Object.entries(tk).sort((a, b) => b[1].quoteVolume - a[1].quoteVolume).slice(0, CONFIG.universeSize).map(([s]) => s);

  const want = [...new Set([...st.universe, ...Object.keys(st.positions)])];
  const res = [];
  for (const s of want) { // de una en una para respetar el límite de Kraken
    try { res.push([s, parseKlines(await klines(s), now)]); } catch (e) { res.push([s, null]); }
    await sleep(1100);
  }
  const sigs = {}, scores = {}, prices = {};
  for (const [s, d] of res) {
    if (!d || d.c.length < CONFIG.minBars) continue;
    prices[s] = d.c[d.c.length - 1];
    sigs[s] = Object.fromEntries(Object.entries(CONFIG.strategies).map(([n, p]) => [n, STRATS[n](d, p)]));
    scores[s] = score(d);
  }

  const equity = () => st.cash + Object.entries(st.positions).reduce((a, [s, p]) => a + p.qty * (prices[s] ?? p.last ?? p.entryPx), 0);
  let eq = equity();
  const day = new Date(now).toISOString().slice(0, 10);
  if (riskUpdate(CONFIG.risk, st.risk, eq, day) === "kill") {
    for (const s of Object.keys(st.positions)) await closePos(s, "kill_switch");
    ctx.notes.push(note(env, st, `⛔ MÁQUINA APAGADA: ${st.risk.haltReason}`));
    st.equity.push([now, st.cash]);
    return;
  }

  // gestionar abiertas
  for (const s of Object.keys(st.positions)) {
    const p = st.positions[s], sg = sigs[s]?.[p.strat];
    p.bars = (p.bars || 0) + 1;
    if (!sg) continue;
    if (Number.isFinite(sg.trail)) p.stop = Math.max(p.stop, sg.trail);
    if (sg.exit) await closePos(s, "señal");
  }

  // ¿Cuándo y cuánto? nuevas entradas en los mejor puntuados
  st.ranked = Object.entries(scores).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])
    .slice(0, CONFIG.topN).map(([s, v]) => [s, +v.toFixed(3)]);
  eq = equity();
  if (canOpen(CONFIG.risk, st.risk, eq, Object.keys(st.positions).length)) {
    const cands = [];
    for (const [s] of st.ranked) {
      if (st.positions[s]) continue;
      for (const n of Object.keys(CONFIG.strategies)) {
        const sg = sigs[s][n];
        if (sg.entry && Number.isFinite(sg.stop) && sg.stop < prices[s]) { cands.push([sg.strength, s, n, prices[s] - sg.stop]); break; }
      }
    }
    cands.sort((a, b) => b[0] - a[0]);
    const slots = CONFIG.risk.max_positions - Object.keys(st.positions).length;
    for (const [, s, n, dist] of cands.slice(0, Math.max(0, slots))) {
      const q0 = positionSize(CONFIG.risk, eq, st.cash, prices[s], prices[s] - dist);
      if (q0 <= 0) continue;
      const { ask } = await book(s);
      const px = ask * (1 + slippage), qty = Math.min(q0, st.cash / (px * (1 + fee)));
      if (qty * px < CONFIG.risk.min_notional) continue;
      const f = qty * px * fee;
      st.cash -= qty * px + f;
      st.positions[s] = { qty, entryPx: px, stop: px - dist, strat: n, entryTime: now, bars: 0, fee: f, last: px };
      ctx.notes.push(note(env, st, `🟢 COMPRA ${s} ${qty.toPrecision(5)} @ ${px.toPrecision(6)} | ${n} | stop ${(px - dist).toPrecision(6)}`));
    }
  }
  st.equity.push([now, equity()]);
  st.equity = st.equity.slice(-3000);
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(tick(env, event.scheduledTime));
  },
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname === "/api/state") {
      const { st, trades } = await load(env);
      const config = { timeframe: CONFIG.timeframe, strategies: CONFIG.strategies, risk: CONFIG.risk, costs: CONFIG.costs,
                       paperCapital: CONFIG.paperCapital };
      return Response.json({ state: st, trades, config, now: Date.now() }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/api/health") {
      const out = {};
      try { const t = await tickers(CONFIG.candidates); out.ok = true; out.tickers = Object.keys(t).length; }
      catch (e) { out.ok = false; out.error = String(e); }
      out.colo = req.cf && req.cf.colo; out.country = req.cf && req.cf.country;
      return Response.json(out);
    }
    if (url.pathname === "/") return new Response(DASHBOARD, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("No encontrado", { status: 404 });
  },
};
