/* Atalaya Bot — bucle de paper trading en el navegador. */
(function () {
  "use strict";
  const E = window.Engine, MODEL = window.MODEL, BT = window.BACKTEST || null;
  const ML = MODEL.meta.ml;
  const SYMBOLS = ML.universe.map(s => s.split("-")[0] + "USDT");
  const INTERVAL = ML.interval, BAR_MS = { "5m": 3e5, "15m": 9e5, "1h": 36e5 }[INTERVAL];
  const RISK = { perTrade: 0.005, maxPosPct: 0.2, maxOpen: 4, dailyLoss: 0.02, killDD: 0.10 };
  const COMM = 0.0010, SLIP = 0.0005, COST_RT = 2 * (COMM + SLIP);
  const API = "https://data-api.binance.vision/api/v3";
  const KEY = "atalaya-state-v1";
  const POLL_MS = 20000;

  const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : x.toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const px = x => fmt(x, x >= 100 ? 2 : x >= 1 ? 4 : 5);
  const money = x => (x >= 0 ? "" : "−") + fmt(Math.abs(x)) + " $";
  const cls = x => (x > 0 ? "up" : x < 0 ? "down" : "muted");
  const hhmm = t => new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const $ = id => document.getElementById(id);

  function fresh(initial = 10000) {
    return { initial, cash: initial, positions: {}, trades: [], equity: [], log: [], cal: null,
      lastBar: {}, learnedUntil: {}, peak: initial, day: null, dayStart: initial, halted: false, killed: false, paused: false };
  }
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || fresh(); } catch { S = fresh(); }
  const cal = new E.Calibrator(S.cal);
  const save = () => { S.cal = { w: cal.w, n: cal.n, hits: cal.hits, lr: cal.lr }; try { localStorage.setItem(KEY, JSON.stringify(S)); } catch { /* sin almacenamiento */ } };
  const log = (msg, kind = "") => { S.log.unshift({ t: Date.now(), msg, kind }); S.log = S.log.slice(0, 200); };

  const market = {};   // sym -> {bars, feats, price, chg24, p, signal, pbe}

  async function getBars(sym) {
    const r = await fetch(`${API}/klines?symbol=${sym}&interval=${INTERVAL}&limit=600`);
    if (!r.ok) throw new Error(`${sym}: HTTP ${r.status}`);
    const k = await r.json();
    const live = k[k.length - 1];
    const closed = k.slice(0, -1);   // la última vela aún no ha cerrado
    const b = { time: [], open: [], high: [], low: [], close: [], volume: [] };
    for (const x of closed) { b.time.push(x[0]); b.open.push(+x[1]); b.high.push(+x[2]); b.low.push(+x[3]); b.close.push(+x[4]); b.volume.push(+x[5]); }
    return { b, price: +live[4], liveHigh: +live[2], liveLow: +live[3] };
  }

  const prices = () => Object.fromEntries(Object.entries(market).map(([s, m]) => [s, m.price]));
  function equity() {
    const p = prices();
    return S.cash + Object.values(S.positions).reduce((a, q) => a + q.dir * q.qty * (p[q.sym] ?? q.entry), 0);
  }

  function openPos(sym, dir, price, atr, prob, t) {
    const eq = equity();
    const stopDist = ML.sl_atr * atr, tpDist = ML.tp_atr * atr;
    let qty = eq * RISK.perTrade / stopDist;
    qty = Math.min(qty, eq * RISK.maxPosPct / price);
    if (!(qty > 0)) return;
    const fill = price * (1 + SLIP * dir), fee = qty * fill * COMM;
    S.cash -= dir * qty * fill + fee;
    S.positions[sym] = { sym, dir, qty, entry: fill, fee, t, stop: fill - dir * stopDist, tp: fill + dir * tpDist, bars: 0, prob };
    log(`ABRE ${dir > 0 ? "LARGO" : "CORTO"} ${sym} @ ${px(fill)} · prob ${(prob * 100).toFixed(1)}% · stop ${px(fill - dir * stopDist)} · objetivo ${px(fill + dir * tpDist)}`, dir > 0 ? "up" : "down");
  }

  function closePos(sym, price, reason) {
    const q = S.positions[sym]; delete S.positions[sym];
    const fill = price * (1 - SLIP * q.dir), fee = q.qty * fill * COMM;
    S.cash += q.dir * q.qty * fill - fee;
    const pnl = q.dir * q.qty * (fill - q.entry) - fee - q.fee;
    S.trades.unshift({ sym, dir: q.dir, entry: q.entry, exit: fill, pnl, reason, tOpen: q.t, tClose: Date.now(), prob: q.prob });
    S.trades = S.trades.slice(0, 500);
    // Aprende de su propia operación (peso triple)
    cal.learn(q.dir > 0 ? "long" : "short", q.prob, pnl > 0 ? 1 : 0, 3);
    log(`CIERRA ${sym} (${reason}) @ ${px(fill)} · ${pnl >= 0 ? "gana" : "pierde"} ${money(pnl)}`, pnl >= 0 ? "up" : "down");
  }

  function riskCheck() {
    const eq = equity(), day = E.nyDate(Date.now());
    if (day !== S.day) { S.day = day; S.dayStart = eq; S.halted = false; }
    S.peak = Math.max(S.peak, eq);
    if (!S.killed && eq < S.peak * (1 - RISK.killDD)) { S.killed = true; log(`INTERRUPTOR DE EMERGENCIA: caída del ${RISK.killDD * 100}% desde máximos. El bot deja de abrir operaciones.`, "down"); }
    if (!S.halted && eq < S.dayStart * (1 - RISK.dailyLoss)) { S.halted = true; log(`Límite de pérdida diaria (${RISK.dailyLoss * 100}%) alcanzado: pausa hasta mañana.`, "down"); }
    return eq;
  }

  function processSymbol(sym, data) {
    const { b, price, liveHigh, liveLow } = data;
    const feats = E.features(b, {});
    const n = b.close.length, last = feats[n - 1];
    const raw = E.predict(MODEL, last);
    const p = { long: cal.adjust("long", raw.p_long), short: cal.adjust("short", raw.p_short) };
    const atrPct = last.atr / b.close[n - 1];
    const pbe = (ML.sl_atr + COST_RT / atrPct) / (ML.tp_atr + ML.sl_atr) + ML.min_edge;
    const signal = p.long > pbe && p.long >= p.short ? 1 : p.short > pbe && p.short > p.long ? -1 : 0;
    const i24 = Math.max(0, n - Math.round(864e5 / BAR_MS));
    market[sym] = { b, feats, price, chg24: price / b.close[i24] - 1, p, raw, signal, pbe, rsi: last.rsi_raw, adx: last.adx_raw, atrPct };

    // 1) Aprendizaje online con velas cuya etiqueta ya se conoce
    const from = S.learnedUntil[sym] || b.time[Math.max(0, n - 400)];
    let learned = 0;
    const atrs = feats.map(f => f.atr);
    for (let i = 0; i < n; i++) {
      if (b.time[i] <= from) continue;
      const yl = E.tripleBarrier(b, atrs, i, ML.tp_atr, ML.sl_atr, ML.horizon, 1);
      const ys = E.tripleBarrier(b, atrs, i, ML.tp_atr, ML.sl_atr, ML.horizon, -1);
      if (yl === null || ys === null || Number.isNaN(feats[i].atr)) break;
      const r = E.predict(MODEL, feats[i]);
      cal.learn("long", r.p_long, yl); cal.learn("short", r.p_short, ys);
      S.learnedUntil[sym] = b.time[i]; learned++;
    }
    if (learned > 20) log(`Aprendizaje: ${learned} velas nuevas de ${sym} incorporadas al calibrador.`);

    // 2) Gestión de la posición abierta
    const q = S.positions[sym];
    const newBar = S.lastBar[sym] !== b.time[n - 1];
    if (q) {
      const hi = Math.max(liveHigh, price), lo = Math.min(liveLow, price);
      if ((q.dir > 0 && lo <= q.stop) || (q.dir < 0 && hi >= q.stop)) closePos(sym, q.stop, "stop");
      else if ((q.dir > 0 && hi >= q.tp) || (q.dir < 0 && lo <= q.tp)) closePos(sym, q.tp, "objetivo");
      else if (newBar) {
        q.bars++;
        if (q.bars >= ML.horizon) closePos(sym, price, "tiempo máximo");
        else if (signal === -q.dir) closePos(sym, price, "señal contraria");
      }
    }
    // 3) Nuevas entradas (sólo al cerrar vela)
    if (newBar && !S.positions[sym] && signal !== 0 && !S.paused && !S.killed && !S.halted
        && Object.keys(S.positions).length < RISK.maxOpen && S.lastBar[sym]) {
      openPos(sym, signal, price, last.atr, signal > 0 ? p.long : p.short, Date.now());
    }
    S.lastBar[sym] = b.time[n - 1];
  }

  let busy = false, lastOk = 0, lastErr = "";
  async function cycle() {
    if (busy) return; busy = true;
    try {
      const res = await Promise.allSettled(SYMBOLS.map(getBars));
      res.forEach((r, i) => {
        if (r.status === "fulfilled") processSymbol(SYMBOLS[i], r.value);
        else lastErr = String(r.reason && r.reason.message || r.reason);
      });
      if (res.some(r => r.status === "fulfilled")) lastOk = Date.now();
      const eq = riskCheck();
      const lastPt = S.equity[S.equity.length - 1];
      if (!lastPt || Date.now() - lastPt[0] > 60000) S.equity.push([Date.now(), eq]);
      if (S.equity.length > 6000) S.equity = S.equity.filter((_, i) => i % 2 === 0);
      save();
    } catch (e) { lastErr = String(e.message || e); }
    busy = false; render();
  }

  // ---------------- Render ----------------
  function render() {
    const eq = equity(), st = $("st");
    const ok = Date.now() - lastOk < 3 * POLL_MS;
    st.className = "pill " + (S.paused ? "paused" : ok ? "live" : "err");
    $("stTxt").textContent = S.paused ? "En pausa" : S.killed ? "Detenido por riesgo" : ok ? `En vivo · actualizado ${new Date(lastOk).toLocaleTimeString("es-ES")}` : (lastErr ? "Sin conexión con Binance" : "Conectando…");
    $("pause").textContent = S.paused ? "Reanudar" : "Pausar";

    const wins = S.trades.filter(t => t.pnl > 0).length;
    const today = S.trades.filter(t => E.nyDate(t.tClose) === E.nyDate(Date.now())).reduce((a, t) => a + t.pnl, 0);
    const dd = S.peak > 0 ? eq / S.peak - 1 : 0;
    const k = [
      ["Capital", money(eq), ""], ["Resultado total", money(eq - S.initial) + ` (${fmt(100 * (eq / S.initial - 1))} %)`, cls(eq - S.initial)],
      ["Cerrado hoy", money(today), cls(today)], ["Operaciones", String(S.trades.length), ""],
      ["Acierto", S.trades.length ? fmt(100 * wins / S.trades.length, 1) + " %" : "—", ""], ["Caída desde máximo", fmt(100 * dd) + " %", dd < -0.05 ? "down" : ""],
    ];
    $("kpis").innerHTML = k.map(([l, v, c]) => `<div class="kpi"><span>${l}</span><b class="${c}">${v}</b></div>`).join("");

    $("mkt").tBodies[0].innerHTML = SYMBOLS.map(s => {
      const m = market[s];
      if (!m) return `<tr><td>${s}</td><td colspan="9" class="muted">cargando…</td></tr>`;
      const bar = v => `<span class="prob"><span>${fmt(100 * v, 1)}%</span><span class="bar"><i style="width:${Math.min(100, v * 100 / 0.8)}%"></i><em style="left:${Math.min(100, m.pbe * 100 / 0.8)}%"></em></span></span>`;
      const sig = m.signal > 0 ? '<span class="sig long">COMPRA</span>' : m.signal < 0 ? '<span class="sig short">VENTA</span>' : '<span class="sig">ESPERAR</span>';
      return `<tr><td>${s.replace("USDT", "/USDT")}</td><td>${px(m.price)}</td><td class="${cls(m.chg24)}">${fmt(100 * m.chg24)}%</td>
        <td>${fmt(m.rsi, 1)}</td><td>${fmt(m.adx, 1)}</td><td>${fmt(100 * m.atrPct, 2)}%</td>
        <td>${bar(m.p.long)}</td><td>${bar(m.p.short)}</td><td>${fmt(100 * m.pbe, 1)}%</td><td>${sig}</td></tr>`;
    }).join("");

    const pos = Object.values(S.positions);
    $("pos").tBodies[0].innerHTML = pos.length ? pos.map(q => {
      const cur = market[q.sym] ? market[q.sym].price : q.entry, pnl = q.dir * q.qty * (cur - q.entry) - q.fee;
      return `<tr><td>${q.sym}</td><td class="${q.dir > 0 ? "up" : "down"}">${q.dir > 0 ? "Largo" : "Corto"}</td><td>${px(q.entry)}</td><td>${px(cur)}</td>
        <td>${px(q.stop)}</td><td>${px(q.tp)}</td><td>${q.bars}/${ML.horizon}</td><td class="${cls(pnl)}">${money(pnl)}</td></tr>`;
    }).join("") : `<tr><td colspan="8" class="empty">Sin posiciones. El bot abre una cuando la probabilidad supera el umbral al cierre de una vela.</td></tr>`;

    $("trades").tBodies[0].innerHTML = S.trades.length ? S.trades.slice(0, 50).map(t =>
      `<tr><td>${hhmm(t.tClose)}</td><td>${t.sym}</td><td class="${t.dir > 0 ? "up" : "down"}">${t.dir > 0 ? "Largo" : "Corto"}</td><td>${px(t.entry)}</td><td>${px(t.exit)}</td><td class="muted">${t.reason}</td><td class="${cls(t.pnl)}">${money(t.pnl)}</td></tr>`
    ).join("") : `<tr><td colspan="7" class="empty">Todavía no hay operaciones cerradas.</td></tr>`;

    $("log").innerHTML = S.log.slice(0, 80).map(l => `<li class="${l.kind}"><time>${hhmm(l.t)}</time>${l.msg}</li>`).join("") || '<li class="muted">Esperando el primer ciclo…</li>';

    const m = MODEL.meta;
    const hit = side => cal.n[side] ? fmt(100 * cal.hits[side] / cal.n[side], 1) + " %" : "—";
    $("learn").innerHTML = `
      <div><span class="muted">Modelo base entrenado hasta</span><b>${new Date(m.trained_until).toLocaleDateString("es-ES")}</b></div>
      <div><span class="muted">Velas históricas usadas</span><b>${m.rows.toLocaleString("es-ES")}</b></div>
      <div><span class="muted">Ejemplos aprendidos en vivo</span><b>${(cal.n.long + cal.n.short).toLocaleString("es-ES")}</b></div>
      <div><span class="muted">Éxito real largos / cortos</span><b>${hit("long")} / ${hit("short")}</b></div>
      <div><span class="muted">Ajuste largos (sesgo, pendiente)</span><b>${fmt(cal.w.long[0], 3)}, ${fmt(cal.w.long[1], 3)}</b></div>
      <div><span class="muted">Ajuste cortos (sesgo, pendiente)</span><b>${fmt(cal.w.short[0], 3)}, ${fmt(cal.w.short[1], 3)}</b></div>`;

    if (BT) {
      const x = BT.metrics;
      $("bt").innerHTML = [["Periodo fuera de muestra", BT.period || "—"], ["Rentabilidad", fmt(x["rentabilidad_total_%"]) + " %"],
        ["Caída máxima", fmt(x["max_drawdown_%"]) + " %"], ["Sharpe", fmt(x.sharpe_diario)], ["Operaciones", x.num_operaciones],
        ["Acierto", (x["tasa_acierto_%"] ?? "—") + " %"], ["Profit factor", fmt(x.profit_factor)], ["AUC del modelo", BT.auc || "—"]]
        .map(([l, v]) => `<div><span class="muted">${l}</span><b>${v}</b></div>`).join("");
    }
    drawEquity();
    const nb = Math.ceil(((Math.floor(Date.now() / BAR_MS) + 1) * BAR_MS - Date.now()) / 1000);
    $("nextBar").textContent = `próxima vela en ${Math.floor(nb / 60)}:${String(nb % 60).padStart(2, "0")}`;
  }

  function drawEquity() {
    const cv = $("eq"), dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
    const pts = S.equity.length > 1 ? S.equity : [[Date.now() - 6e4, S.initial], [Date.now(), equity()]];
    const ys = pts.map(p => p[1]).concat([S.initial]);
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.1 || S.initial * 0.002; lo -= pad; hi += pad;
    const L = 64, R = 10, T = 10, B = 22;
    const X = i => L + (W - L - R) * (i / (pts.length - 1)), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    g.font = `11px ${col("--f-mono")}`; g.fillStyle = col("--muted"); g.strokeStyle = col("--line"); g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillText(fmt(v, 0), 4, y + 4);
    }
    g.setLineDash([4, 4]); g.strokeStyle = col("--muted"); g.beginPath(); g.moveTo(L, Y(S.initial)); g.lineTo(W - R, Y(S.initial)); g.stroke(); g.setLineDash([]);
    const last = pts[pts.length - 1][1], c = last >= S.initial ? col("--up") : col("--down");
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(i), Y(p[1])) : g.moveTo(X(i), Y(p[1]))));
    g.strokeStyle = c; g.lineWidth = 2; g.stroke();
    g.lineTo(X(pts.length - 1), H - B); g.lineTo(L, H - B); g.closePath();
    g.globalAlpha = 0.12; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.arc(X(pts.length - 1), Y(last), 3.5, 0, 7); g.fillStyle = c; g.fill();
    g.fillStyle = col("--muted");
    g.fillText(hhmm(pts[0][0]), L, H - 6);
    const endLbl = hhmm(pts[pts.length - 1][0]); g.fillText(endLbl, W - R - g.measureText(endLbl).width, H - 6);
  }

  // ---------------- Controles ----------------
  $("pause").addEventListener("click", () => { S.paused = !S.paused; log(S.paused ? "Bot en pausa: no abrirá operaciones nuevas." : "Bot reanudado."); save(); render(); });
  $("resetBox").addEventListener("click", e => {
    const box = $("resetBox");
    if (e.target.id === "reset") {
      box.innerHTML = '<span class="confirm">¿Borrar todo y empezar con <input id="cap" type="number" value="10000" min="100" step="100" style="width:90px"> $? <button id="yes" class="danger" type="button">Sí</button><button id="no" type="button">No</button></span>';
    } else if (e.target.id === "yes") {
      const c = Math.max(100, +$("cap").value || 10000);
      S = fresh(c); Object.assign(cal, new E.Calibrator()); log(`Cuenta reiniciada con ${money(c)} simulados.`); save();
      box.innerHTML = '<button id="reset" class="danger" type="button">Reiniciar cuenta</button>'; cycle();
    } else if (e.target.id === "no") box.innerHTML = '<button id="reset" class="danger" type="button">Reiniciar cuenta</button>';
  });
  window.addEventListener("resize", drawEquity);
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", render);

  if (!S.log.length) log(`Bot iniciado con ${money(S.initial)} simulados. Vigila ${SYMBOLS.length} criptomonedas en velas de ${INTERVAL}.`);
  render(); cycle();
  setInterval(cycle, POLL_MS);
  setInterval(render, 1000);
})();
