/* Atalaya Bot — panel. Lee data/state.json que escribe el bot (python main.py run). */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const CLS = { crypto: "Cripto", stock: "Acción/ETF", forex: "Divisa", future: "Futuro" };
  const fmt = (x, d = 2) => (x == null || Number.isNaN(x) ? "—" : Number(x).toLocaleString("es-ES", { minimumFractionDigits: d, maximumFractionDigits: d }));
  const px = x => (x == null ? "—" : fmt(x, Math.abs(x) >= 100 ? 2 : Math.abs(x) >= 1 ? 4 : 6));
  const money = x => (x == null ? "—" : (x < 0 ? "−" : "") + fmt(Math.abs(x)) + " $");
  const cls = x => (x > 0 ? "up" : x < 0 ? "down" : "muted");
  const when = t => new Date(t).toLocaleString("es-ES", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  let S = window.STATE || null, filter = "all", query = "";

  async function load() {
    if (window.STATE) { S = window.STATE; return render(); }
    try {
      const r = await fetch("data/state.json?t=" + Date.now(), { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      S = await r.json();
    } catch { S = S || null; }
    render();
  }

  function render() {
    $("offline").hidden = !!S;
    if (!S) { $("stTxt").textContent = "Sin conexión con el bot"; $("st").className = "pill err"; return; }
    const age = (Date.now() - new Date(S.updated)) / 1000;
    const live = age < 300 && !window.STATE;
    $("st").className = "pill " + (S.killed ? "err" : live ? "live" : "paused");
    $("stTxt").textContent = window.STATE ? `Instantánea del ${when(S.updated)}`
      : S.killed ? "Detenido por riesgo" : live ? `Vigilando ${S.n_markets} mercados · hace ${Math.round(age)} s` : `Última señal de vida ${when(S.updated)}`;
    $("mode").textContent = S.mode === "live" ? "DINERO REAL" : "DINERO SIMULADO";

    const eq = S.equity_now, trades = S.trades || [];
    const wins = trades.filter(t => t.pnl > 0).length;
    const peak = Math.max(S.initial, ...(S.equity || []).map(p => p[1]), eq);
    const today = new Date().toDateString();
    const pnlToday = trades.filter(t => new Date(t.close_time).toDateString() === today).reduce((a, t) => a + t.pnl, 0);
    const k = [
      ["Capital", money(eq), ""],
      ["Resultado total", `${money(eq - S.initial)} (${fmt(100 * (eq / S.initial - 1))} %)`, cls(eq - S.initial)],
      ["Cerrado hoy", money(pnlToday), cls(pnlToday)],
      ["Posiciones abiertas", `${S.positions.length} / ${S.risk.max_open}`, ""],
      ["Operaciones · acierto", `${trades.length} · ${trades.length ? fmt(100 * wins / trades.length, 0) + " %" : "—"}`, ""],
      ["Caída desde máximo", fmt(100 * (eq / peak - 1)) + " %", eq / peak - 1 < -0.05 ? "down" : ""],
    ];
    $("kpis").innerHTML = k.map(([l, v, c]) => `<div class="kpi"><span>${l}</span><b class="${c}">${v}</b></div>`).join("");

    // radar
    let rows = S.scan || [];
    $("scanInfo").textContent = `${rows.length} de ${S.n_markets} mercados analizados · ${rows.filter(r => r.entry).length} con señal`;
    if (filter === "signal") rows = rows.filter(r => r.entry);
    else if (filter !== "all") rows = rows.filter(r => r.cls === filter);
    if (query) rows = rows.filter(r => r.symbol.toLowerCase().includes(query));
    const bar = (v, be) => `<span class="prob"><span>${fmt(100 * v, 0)}%</span><span class="bar"><i style="width:${Math.min(100, v * 125)}%"></i><em style="left:${Math.min(100, be * 125)}%"></em></span></span>`;
    $("mkt").tBodies[0].innerHTML = rows.slice(0, 200).map(r => {
      const sig = r.entry > 0 ? '<span class="sig long">COMPRA</span>' : r.entry < 0 ? '<span class="sig short">VENTA</span>' : '<span class="sig">ESPERAR</span>';
      const ev = r.entry ? r.score : Math.max(r.ev_long, r.ev_short);
      return `<tr class="${r.open ? "" : "closed"}"><td>${r.symbol}</td><td class="muted">${CLS[r.cls] || r.cls}</td><td>${px(r.price)}</td>
        <td class="${cls(r.chg24)}">${fmt(100 * r.chg24)}%</td><td>${fmt(r.rsi, 0)}</td>
        <td>${bar(r.p_long, r.p_be)}</td><td>${bar(r.p_short, r.p_be)}</td>
        <td class="${cls(ev)}">${ev >= 0 ? "+" : ""}${fmt(ev)}R</td><td>${sig}</td><td class="muted">${r.open ? "abierto" : "cerrado"}</td></tr>`;
    }).join("") || `<tr><td colspan="10" class="empty">Sin resultados para este filtro.</td></tr>`;

    $("pos").tBodies[0].innerHTML = S.positions.length ? S.positions.map(q =>
      `<tr><td>${q.symbol}</td><td class="${q.dir > 0 ? "up" : "down"}">${q.dir > 0 ? "Largo" : "Corto"}</td><td>${px(q.entry)}</td><td>${px(q.price)}</td>
       <td>${px(q.stop)}</td><td>${px(q.tp)}</td><td>${q.bars}/${S.risk.horizon}</td><td class="${cls(q.pnl)}">${money(q.pnl)}</td></tr>`).join("")
      : `<tr><td colspan="8" class="empty">Sin posiciones. Entra cuando una oportunidad supera el umbral al cerrar una vela.</td></tr>`;

    $("trades").tBodies[0].innerHTML = trades.length ? trades.slice(0, 60).map(t =>
      `<tr><td>${when(t.close_time)}</td><td>${t.symbol}</td><td class="${t.dir > 0 ? "up" : "down"}">${t.dir > 0 ? "Largo" : "Corto"}</td>
       <td>${px(t.entry)}</td><td>${px(t.exit)}</td><td class="muted">${t.reason}</td><td class="${cls(t.pnl)}">${money(t.pnl)}</td></tr>`).join("")
      : `<tr><td colspan="7" class="empty">Todavía no hay operaciones cerradas.</td></tr>`;

    $("log").innerHTML = (S.events || []).slice(0, 100).map(e => `<li class="${e.kind}"><time>${when(e.t)}</time>${e.msg}</li>`).join("") || '<li class="muted">Sin actividad todavía.</li>';

    const m = S.model || {}, r = S.risk;
    $("learn").innerHTML = [
      ["Entrenado hasta", m.trained_until ? new Date(m.trained_until).toLocaleDateString("es-ES") : "—"],
      ["Velas de entrenamiento", m.rows ? m.rows.toLocaleString("es-ES") : "—"],
      ["Operaciones propias aprendidas", m.own_trades ?? 0],
      ["Velas", S.interval + " · reentrena a diario"],
      ["Riesgo por operación", fmt(100 * r.risk_per_trade, 1) + " % del capital"],
      ["Objetivo / stop", `${r.tp}×ATR / ${r.sl}×ATR`],
    ].map(([l, v]) => `<div><span class="muted">${l}</span><b>${v}</b></div>`).join("");

    const R = S.research, pr = S.params || {};
    const labItems = [
      ["Estado", R ? R.phase : "laboratorio no iniciado"],
      ["Experimentos realizados", R ? (R.experiments ?? 0) : 0],
      ["Estrategia en uso", pr.tp_atr ? `objetivo ${pr.tp_atr}×ATR · plazo ${pr.horizon} velas · exigencia +${fmt(100 * pr.min_edge, 0)} %` : "—"],
      ["Mercados que opera", (S.enabled || []).map(c => CLS[c]).join(", ") || "—"],
      ["Confianza → riesgo usado", S.confidence != null ? `${fmt(100 * S.confidence, 0)} % → ${fmt(100 * S.risk.risk_per_trade, 2)} % por operación` : "—"],
    ];
    if (R && R.champion_result) {
      const c = R.champion_result;
      labItems.push(["Campeón: selección", `${c.sel_trades} op. · <span class="${cls(c.sel_pnl)}">${money(c.sel_pnl)}</span>`]);
      labItems.push(["Campeón: examen final", `${c.exam_trades} op. · <span class="${cls(c.exam_pnl)}">${money(c.exam_pnl)}</span>`]);
      labItems.push(["Último ciclo", `${R.last_cycle_minutes ?? "—"} min · ${R.promoted ? "nuevo campeón" : "se mantiene"}`]);
      labItems.push(["Actualizado", when(R.updated)]);
    }
    $("lab").innerHTML = labItems.map(([l, v]) => `<div><span class="muted">${l}</span><b>${v}</b></div>`).join("");
    const ex = (R && R.recent) || [];
    $("exp").tBodies[0].innerHTML = ex.length ? ex.map(e => {
      const p = e.params || {};
      return `<tr><td>${when(e.time)}</td><td>${e.role}</td><td>${p.tp_atr}×</td><td>${p.horizon}</td><td>+${fmt(100 * p.min_edge, 0)}%</td><td>${p.model === "medium" ? "medio" : "sencillo"}</td>
        <td class="${cls(e.score)}">${fmt(e.score)}</td><td>${e.sel_trades}</td><td class="${cls(e.exam_pnl)}">${money(e.exam_pnl)}</td></tr>`;
    }).join("") : `<tr><td colspan="9" class="empty">Todavía no hay experimentos. El laboratorio hace el primero al arrancar.</td></tr>`;

    const b = S.backtest;
    if (b && b.metrics) {
      const x = b.metrics;
      const items = [["Periodo no visto", b.period || "—"], ["Rentabilidad", fmt(x["rentabilidad_total_%"]) + " %"],
        ["Caída máxima", fmt(x["max_drawdown_%"]) + " %"], ["Sharpe", fmt(x.sharpe_diario)], ["Operaciones", x.num_operaciones],
        ["Acierto", (x["tasa_acierto_%"] ?? "—") + " %"], ["Profit factor", fmt(x.profit_factor)], ["AUC (largo / corto)", b.auc || "—"]];
      for (const [c, v] of Object.entries(b.by_class || {})) items.push([`${CLS[c]}: ${v.trades} op.`, `<span class="${cls(v.pnl)}">${money(v.pnl)}</span>`]);
      $("bt").innerHTML = items.map(([l, v]) => `<div><span class="muted">${l}</span><b>${v}</b></div>`).join("");
    } else $("bt").innerHTML = '<div class="muted">Ejecuta <code>python main.py ml-train</code> para generar la validación.</div>';
    drawEquity();
  }

  function drawEquity() {
    const pts = (S.equity || []).length > 1 ? S.equity : [[Date.now() - 6e4, S.initial], [Date.now(), S.equity_now]];
    drawLine($("eq"), pts, S.initial);
    if (S.backtest && (S.backtest.equity || []).length > 1) drawLine($("bteq"), S.backtest.equity, S.backtest.equity[0][1]);
  }

  function drawLine(cv, pts, base) {
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
    if (!W) return;
    cv.width = W * dpr; cv.height = H * dpr;
    const g = cv.getContext("2d"); g.scale(dpr, dpr);
    const css = getComputedStyle(document.documentElement), col = n => css.getPropertyValue(n).trim();
    const ys = pts.map(p => p[1]).concat([base]);
    let lo = Math.min(...ys), hi = Math.max(...ys); const pad = (hi - lo) * 0.1 || base * 0.002; lo -= pad; hi += pad;
    const L = 64, R = 10, T = 10, B = 22;
    const t0 = pts[0][0], t1 = pts[pts.length - 1][0] || t0 + 1;
    const X = t => L + (W - L - R) * ((t - t0) / Math.max(1, t1 - t0)), Y = v => T + (H - T - B) * (1 - (v - lo) / (hi - lo));
    g.font = `11px ${col("--f-mono")}`; g.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      const v = lo + (hi - lo) * k / 4, y = Y(v);
      g.strokeStyle = col("--line"); g.beginPath(); g.moveTo(L, y); g.lineTo(W - R, y); g.stroke();
      g.fillStyle = col("--muted"); g.fillText(fmt(v, 0), 4, y + 4);
    }
    g.setLineDash([4, 4]); g.strokeStyle = col("--muted"); g.beginPath(); g.moveTo(L, Y(base)); g.lineTo(W - R, Y(base)); g.stroke(); g.setLineDash([]);
    const last = pts[pts.length - 1][1], c = last >= base ? col("--up") : col("--down");
    g.beginPath(); pts.forEach((p, i) => (i ? g.lineTo(X(p[0]), Y(p[1])) : g.moveTo(X(p[0]), Y(p[1]))));
    g.strokeStyle = c; g.lineWidth = 2; g.stroke();
    g.lineTo(X(t1), H - B); g.lineTo(L, H - B); g.closePath();
    g.globalAlpha = 0.12; g.fillStyle = c; g.fill(); g.globalAlpha = 1;
    g.beginPath(); g.arc(X(t1), Y(last), 3.5, 0, 7); g.fillStyle = c; g.fill();
    g.fillStyle = col("--muted"); g.fillText(when(t0), L, H - 6);
    const e = when(t1); g.fillText(e, W - R - g.measureText(e).width, H - 6);
  }

  $("filters").addEventListener("click", e => {
    const b = e.target.closest("button[data-f]"); if (!b) return;
    filter = b.dataset.f;
    document.querySelectorAll("#filters button").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
    render();
  });
  $("q").addEventListener("input", e => { query = e.target.value.trim().toLowerCase(); render(); });
  window.addEventListener("resize", () => S && drawEquity());
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => S && render());
  load();
  if (!window.STATE) setInterval(load, 10000);
})();
