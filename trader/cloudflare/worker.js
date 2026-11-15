// Máquina de trading autónoma en Cloudflare Workers: varios traders SIMULADOS compitiendo con precios reales de Kraken.
// Cron cada 5 min: revisa los stop-loss de todos y deja decidir al trader cuya vela acaba de cerrar.
import { CONFIG, TRADERS, STRATS, score, explain, positionSize, canOpen, riskUpdate, parseKlines } from "./lib.js";
import { DASHBOARD } from "./dashboard.js";

// ---- Fuente de datos: Kraken (API pública). Binance bloquea las IPs de Cloudflare. ----
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
async function tickers(alts) {
  const [pairs, t] = await Promise.all([kget(`AssetPairs?pair=${alts.join(",")}`), kget(`Ticker?pair=${alts.join(",")}`)]);
  const out = {};
  for (const [k, v] of Object.entries(t)) {
    const alt = pairs[k]?.altname || k;
    out[alt] = { bid: +v.b[0], ask: +v.a[0], last: +v.c[0], quoteVolume: +v.v[1] * +v.c[0] };
  }
  return out;
}
async function klines(alt, barMs) {
  const r = await kget(`OHLC?pair=${alt}&interval=${barMs / 60000}`);
  const rows = r[Object.keys(r).find((k) => k !== "last")];
  return rows.slice(-(CONFIG.historyBars + 1)).map((x) => [x[0] * 1000, x[1], x[2], x[3], x[4], x[6], x[0] * 1000 + barMs - 1]);
}

// ---- Estado (una sola clave KV para todos: pocas escrituras) ----
function fresh(t) {
  return { cash: CONFIG.paperCapital, positions: {}, risk: { peak: null, day: null, dayStart: null, halted: false, haltReason: "" },
           lastBar: null, universe: [], ranked: [], watch: [], equity: [], log: [], started: Date.now(),
           lastBarRun: null, checks: 0, decisions: 0 };
}
async function loadAll(env) {
  let all = await env.STATE.get("traders", "json");
  if (!all) { // migración desde la versión de un solo trader
    const old = await env.STATE.get("state", "json");
    all = { meta: { checks: 0, lastRun: null, lastError: null }, traders: {} };
    if (old) all.traders.prudente = { ...fresh(), ...old, watch: [], checks: 0, decisions: (old.equity || []).length };
  }
  for (const t of TRADERS) all.traders[t.id] ??= fresh(t);
  const trades = {};
  await Promise.all(TRADERS.map(async (t) => {
    trades[t.id] = (await env.STATE.get(`trades:${t.id}`, "json")) || (t.id === "prudente" ? (await env.STATE.get("trades", "json")) || [] : []);
  }));
  return { all, trades };
}

function addLog(st, msg) { st.log.push([Date.now(), msg]); st.log = st.log.slice(-150); }
function telegram(env, msg) {
  if (!env.TELEGRAM_TOKEN || !env.TELEGRAM_CHAT_ID) return null;
  return fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/sendMessage`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: msg }) }).catch(() => {});
}
const nice = (p) => ({ XBT: "BTC", XDG: "DOGE" })[p.replace(/USD$/, "")] || p.replace(/USD$/, "");

function makeOps(env, t, st, trades, ctx, now) {
  const { fee, slippage } = CONFIG.costs;
  const note = (msg, important) => { addLog(st, msg); if (important) ctx.notes.push(telegram(env, `${t.name}: ${msg}`)); };
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

async function onBar(env, t, st, trades, ctx, now) {
  const ops = makeOps(env, t, st, trades, ctx, now);
  const tk = await tickers(CONFIG.candidates);
  st.universe = Object.entries(tk).sort((a, b) => b[1].quoteVolume - a[1].quoteVolume).slice(0, t.universeSize).map(([s]) => s);

  const want = [...new Set([...st.universe, ...Object.keys(st.positions)])];
  const sigs = {}, scores = {}, prices = {};
  for (const s of want) { // de una en una para respetar el límite de Kraken
    try {
      const d = parseKlines(await klines(s, t.barMs), now);
      if (d.c.length >= CONFIG.minBars) {
        prices[s] = d.c[d.c.length - 1];
        sigs[s] = Object.fromEntries(Object.entries(t.strategies).map(([n, p]) => [n, STRATS[n](d, p)]));
        scores[s] = score(d);
      }
    } catch (e) { /* un mercado que falla no para al resto */ }
    await sleep(1100);
  }

  const equity = () => st.cash + Object.entries(st.positions).reduce((a, [s, p]) => a + p.qty * (prices[s] ?? p.last ?? p.entryPx), 0);
  const day = new Date(now).toISOString().slice(0, 10);
  if (riskUpdate(t.risk, st.risk, equity(), day) === "kill") {
    for (const s of Object.keys(st.positions)) ops.close(s, "freno de emergencia", tk[s]?.bid ?? prices[s]);
    ops.note(`⛔ APAGADO: ${st.risk.haltReason}`, true);
    st.equity.push([now, st.cash]);
    return;
  }

  // gestionar abiertas
  for (const s of Object.keys(st.positions)) {
    const p = st.positions[s], sg = sigs[s]?.[p.strat];
    p.bars = (p.bars || 0) + 1;
    if (prices[s]) p.last = prices[s];
    if (!sg) continue;
    if (Number.isFinite(sg.trail) && sg.trail > p.stop) p.stop = sg.trail;
    if (sg.exit) ops.close(s, "la señal se agotó", tk[s]?.bid ?? prices[s]);
  }

  // ranking y lista de vigilancia con el porqué de cada uno
  st.ranked = Object.entries(scores).filter(([, v]) => Number.isFinite(v)).sort((a, b) => b[1] - a[1])
    .slice(0, t.topN).map(([s, v]) => [s, +v.toFixed(3)]);
  const top = new Set(st.ranked.map(([s]) => s));
  st.watch = Object.keys(sigs).map((s) => ({
    s, price: prices[s], score: Number.isFinite(scores[s]) ? +scores[s].toFixed(3) : null, top: top.has(s),
    why: st.positions[s] ? "en cartera" : (Number.isFinite(scores[s]) ? "" : "volatilidad fuera de rango · ") + explain(sigs[s]),
  })).sort((a, b) => (b.score ?? -99) - (a.score ?? -99));

  // nuevas entradas
  let bought = 0, signals = 0;
  const eq = equity();
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
  st.equity.push([now, equity()]);
  st.equity = st.equity.slice(-3000);
}

async function tick(env, now = Date.now()) {
  const { all, trades } = await loadAll(env);
  const ctx = { changed: new Set(), notes: [] };
  try {
    // 1) stop-loss de todos los traders con una sola consulta de precios
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
    }
    // 2) decide el trader cuya vela acaba de cerrar (uno por ejecución para no saturar)
    const due = TRADERS.find((t) => {
      const st = all.traders[t.id], bar = Math.floor(now / t.barMs);
      return !st.risk.halted && bar !== st.lastBar && now - bar * t.barMs > 60_000;
    });
    if (due) {
      const st = all.traders[due.id];
      await onBar(env, due, st, trades[due.id], ctx, now);
      st.lastBar = Math.floor(now / due.barMs);
      st.lastBarRun = now;
    }
    all.meta.lastError = null;
  } catch (e) {
    all.meta.lastError = [now, String((e && e.stack) || e).slice(0, 500)];
  }
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
      return Response.json({
        now: Date.now(), meta: all.meta, capital: CONFIG.paperCapital, costs: CONFIG.costs,
        traders: TRADERS.map((t) => ({ id: t.id, name: t.name, timeframe: t.timeframe, note: t.note, risk: t.risk,
                                       state: all.traders[t.id], trades: trades[t.id] })),
      }, { headers: { "cache-control": "no-store" } });
    }
    if (url.pathname === "/") return new Response(DASHBOARD, { headers: { "content-type": "text/html; charset=utf-8" } });
    return new Response("No encontrado", { status: 404 });
  },
};
