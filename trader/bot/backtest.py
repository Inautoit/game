"""Simulador histórico realista (backtest) y validación walk-forward.

Reglas anti-autoengaño:
  - Las señales se calculan al CIERRE de una vela y se ejecutan en la APERTURA de la siguiente.
  - Cada compra/venta paga comisión y slippage.
  - Los stop-loss se comprueban con el mínimo de la vela; si el precio abre por debajo (gap), se vende a la apertura.
  - Walk-forward: los parámetros se eligen en un periodo y se evalúan en el SIGUIENTE, que el modelo no ha visto.
"""
from dataclasses import dataclass, field
import math
import numpy as np
import pandas as pd

from .risk import RiskConfig, RiskManager
from .scanner import score_series
from . import strategies as S


@dataclass
class CostConfig:
    fee: float = 0.0026        # comisión por lado (Kraken taker ~0.25%; Binance ~0.1%)
    slippage: float = 0.0005   # deslizamiento medio por lado


@dataclass
class Result:
    equity: pd.Series
    trades: pd.DataFrame
    metrics: dict
    benchmark: pd.Series = field(default=None)


def _bars_per_year(idx: pd.DatetimeIndex) -> float:
    if len(idx) < 2:
        return 365 * 24
    dt = pd.Series(idx).diff().median().total_seconds()
    return 365 * 24 * 3600 / dt


def metrics(equity: pd.Series, trades: pd.DataFrame, bpy: float, fees_paid: float = 0.0, exposure: float = 0.0) -> dict:
    if len(equity) < 2:
        return {}
    r = equity.pct_change().dropna()
    total = equity.iloc[-1] / equity.iloc[0] - 1
    years = len(equity) / bpy
    ann = (1 + total) ** (1 / years) - 1 if years > 0 and total > -1 else -1.0
    vol = r.std() * math.sqrt(bpy)
    sharpe = (r.mean() * bpy) / vol if vol > 0 else 0.0
    dd = (equity / equity.cummax() - 1).min()
    m = {"retorno_total": total, "retorno_anual": ann, "volatilidad_anual": vol, "sharpe": sharpe,
         "max_drawdown": dd, "operaciones": int(len(trades)), "comisiones_pagadas": fees_paid,
         "tiempo_invertido": exposure}
    if len(trades):
        wins = trades[trades.pnl > 0].pnl.sum()
        losses = -trades[trades.pnl < 0].pnl.sum()
        m.update({"aciertos": float((trades.pnl > 0).mean()),
                  "profit_factor": wins / losses if losses > 0 else float("inf"),
                  "ganancia_media_op": float(trades.ret.mean())})
    return m


def run_backtest(data: dict, strategies: list, risk_cfg: RiskConfig = None, costs: CostConfig = None,
                 initial: float = 10_000.0, top_n: int = None, start=None, end=None,
                 signals: dict = None, scores: dict = None, risk: RiskManager = None) -> Result:
    risk_cfg = risk_cfg or RiskConfig()
    costs = costs or CostConfig()
    risk = risk or RiskManager(risk_cfg)  # se puede pasar uno compartido para que el freno sea global
    syms = sorted(data)
    idx = pd.DatetimeIndex(sorted(set().union(*[d.index for d in data.values()])))

    # Señales y puntuaciones sobre TODO el histórico (son causales) y luego se recorta al periodo.
    if signals is None:
        signals = {s: {st.name: st.generate(data[s]) for st in strategies} for s in syms}
    if top_n and scores is None:
        scores = {s: score_series(data[s]) for s in syms}

    mask = np.ones(len(idx), bool)
    if start is not None:
        mask &= idx >= pd.Timestamp(start)
    if end is not None:
        mask &= idx < pd.Timestamp(end)
    idx = idx[mask]
    T = len(idx)
    if T == 0:
        raise ValueError("Periodo vacío")

    def arr(df, col):
        return df[col].reindex(idx).to_numpy(dtype=float)

    O = {s: arr(data[s], "open") for s in syms}
    H = {s: arr(data[s], "high") for s in syms}
    L = {s: arr(data[s], "low") for s in syms}
    C = {s: arr(data[s], "close") for s in syms}
    def sig_arrays(df):
        out = {c: df[c].reindex(idx).fillna(False).to_numpy(dtype=bool) for c in ("entry", "exit")}
        out.update({c: df[c].reindex(idx).to_numpy(dtype=float) for c in ("stop", "trail", "strength")})
        return out

    SIG = {s: {n: sig_arrays(signals[s][n]) for n in signals[s]} for s in syms}
    SC = np.vstack([scores[s].reindex(idx).to_numpy(dtype=float) for s in syms]) if top_n else None
    strat_by_name = {st.name: st for st in strategies}

    cash = initial
    pos = {}            # sym -> dict(qty, entry_px, stop, strat, entry_i, fee)
    last_close = {s: np.nan for s in syms}
    pend_buy, pend_sell = [], {}
    trades, eq = [], np.empty(T)
    fees_paid, invested_bars = 0.0, 0
    days = idx.floor("D")

    def close_pos(s, px, i, reason):
        nonlocal cash, fees_paid
        p = pos.pop(s)
        gross = p["qty"] * px
        fee = gross * costs.fee
        cash += gross - fee
        fees_paid += fee
        pnl = gross - fee - (p["qty"] * p["entry_px"] + p["fee"])
        trades.append({"symbol": s, "strategy": p["strat"], "entry_time": idx[p["entry_i"]], "exit_time": idx[i],
                       "entry_px": p["entry_px"], "exit_px": px, "qty": p["qty"], "pnl": pnl,
                       "ret": pnl / (p["qty"] * p["entry_px"] + p["fee"]), "reason": reason})

    for i in range(T):
        # 1) Ejecutar órdenes pendientes en la apertura
        for s, reason in list(pend_sell.items()):
            if s in pos and not np.isnan(O[s][i]):
                close_pos(s, O[s][i] * (1 - costs.slippage), i, reason)
                pend_sell.pop(s)
            elif s not in pos:
                pend_sell.pop(s)
        for (s, n, qty, stop_dist) in pend_buy:
            o = O[s][i]
            if s in pos or np.isnan(o):
                continue
            px = o * (1 + costs.slippage)
            stop = px - stop_dist
            qty = min(qty, cash / (px * (1 + costs.fee)))
            if qty <= 0 or stop <= 0 or qty * px < risk_cfg.min_notional:
                continue
            fee = qty * px * costs.fee
            cash -= qty * px + fee
            fees_paid += fee
            pos[s] = {"qty": qty, "entry_px": px, "stop": stop, "strat": n, "entry_i": i, "fee": fee}
        pend_buy = []

        # 2) Stop-loss dentro de la vela
        for s in list(pos):
            p = pos[s]
            if not np.isnan(L[s][i]) and L[s][i] <= p["stop"]:
                px = min(O[s][i], p["stop"]) * (1 - costs.slippage)
                close_pos(s, px, i, "stop")
                pend_sell.pop(s, None)

        # 3) Valorar cartera al cierre
        for s in syms:
            if not np.isnan(C[s][i]):
                last_close[s] = C[s][i]
        equity = cash + sum(p["qty"] * last_close[s] for s, p in pos.items())
        eq[i] = equity
        invested_bars += bool(pos)

        if risk.update(equity, days[i]) == "kill":
            for s in pos:
                pend_sell[s] = "kill_switch"

        # 4) Gestionar posiciones abiertas: trailing, salida por señal, tiempo máximo
        for s, p in pos.items():
            sg = SIG[s][p["strat"]]
            t = sg["trail"][i]
            if np.isfinite(t):
                p["stop"] = max(p["stop"], t)
            mh = strat_by_name[p["strat"]].max_hold_bars
            if sg["exit"][i]:
                pend_sell.setdefault(s, "señal")
            elif mh and i - p["entry_i"] >= mh:
                pend_sell.setdefault(s, "tiempo")

        # 5) Nuevas entradas
        if i < T - 1 and risk.can_open(equity, len(pos)):
            eligible = syms
            if top_n:
                col = SC[:, i]
                ok = np.isfinite(col)
                order = [syms[j] for j in np.argsort(-np.where(ok, col, -np.inf)) if ok[j]]
                eligible = set(order[:top_n])
            cands = []
            for s in syms:
                if s in pos or s not in eligible or np.isnan(C[s][i]):
                    continue
                for st in strategies:
                    sg = SIG[s][st.name]
                    if sg["entry"][i] and np.isfinite(sg["stop"][i]) and sg["stop"][i] < C[s][i]:
                        cands.append((sg["strength"][i], s, st.name, sg["stop"][i]))
                        break
            cands.sort(reverse=True)
            avail = cash
            slots = risk_cfg.max_positions - len(pos)
            for strength, s, n, stop in cands[:max(0, slots)]:
                q = risk.size(equity, avail, C[s][i], stop)
                if q > 0:
                    pend_buy.append((s, n, q, C[s][i] - stop))
                    avail -= q * C[s][i] * (1 + costs.fee)

    for s in list(pos):  # cerrar al final
        close_pos(s, last_close[s] * (1 - costs.slippage), T - 1, "fin")
    eq[-1] = cash

    equity = pd.Series(eq, index=idx, name="equity")
    tdf = pd.DataFrame(trades, columns=["symbol", "strategy", "entry_time", "exit_time", "entry_px", "exit_px",
                                        "qty", "pnl", "ret", "reason"])
    bpy = _bars_per_year(idx)
    closes = pd.DataFrame({s: data[s]["close"].reindex(idx) for s in syms}).ffill().bfill()
    bench = initial * (closes / closes.iloc[0]).mean(axis=1)
    m = metrics(equity, tdf, bpy, fees_paid, invested_bars / T)
    m["_invested_bars"] = invested_bars
    m["comprar_y_mantener"] = bench.iloc[-1] / bench.iloc[0] - 1
    m["kill_switch"] = risk.halted
    return Result(equity, tdf, m, bench)


def walk_forward(data: dict, strat_names: list, risk_cfg: RiskConfig = None, costs: CostConfig = None,
                 initial: float = 10_000.0, top_n: int = None, train_bars: int = 24 * 120,
                 test_bars: int = 24 * 30, min_trades: int = 8, log=print) -> dict:
    """Optimiza en una ventana, evalúa en la siguiente (no vista), y avanza. Solo cuenta lo no visto."""
    idx = pd.DatetimeIndex(sorted(set().union(*[d.index for d in data.values()])))
    scores = {s: score_series(data[s]) for s in data} if top_n else None
    # Precalcular señales de cada combinación de parámetros (son causales).
    cache = {}

    def sigs(name, params):
        key = (name, tuple(sorted(params.items())))
        if key not in cache:
            st = S.REGISTRY[name](params)
            cache[key] = (st, {s: {st.name: st.generate(data[s])} for s in data})
        return cache[key]

    folds, equity_parts, all_trades, chosen = [], [], [], []
    capital = initial
    global_risk = RiskManager(risk_cfg or RiskConfig())  # freno de emergencia común a todos los tramos
    fees, invested, total_bars = 0.0, 0, 0
    start = train_bars
    while start + test_bars <= len(idx):
        tr0, tr1, te1 = idx[start - train_bars], idx[start], idx[min(start + test_bars, len(idx) - 1)]
        picks = []
        for name in strat_names:
            best, best_sh = None, 0.0
            for params in S.PARAM_GRIDS[name]:
                st, sg = sigs(name, params)
                r = run_backtest(data, [st], risk_cfg, costs, initial, top_n, tr0, tr1, signals=sg, scores=scores)
                sh = r.metrics.get("sharpe", 0) if r.metrics.get("operaciones", 0) >= min_trades else -1
                if sh > best_sh:
                    best, best_sh = params, sh
            if best is not None:   # solo se usa la estrategia si funcionó en el pasado reciente
                picks.append((name, best, best_sh))
        chosen.append({"desde": tr1, "hasta": te1, "estrategias": [(n, p) for n, p, _ in picks]})
        if picks and not global_risk.halted:
            sts = [sigs(n, p)[0] for n, p, _ in picks]
            sg = {s: {k: v for n, p, _ in picks for k, v in sigs(n, p)[1][s].items()} for s in data}
            r = run_backtest(data, sts, risk_cfg, costs, capital, top_n, tr1, te1, signals=sg, scores=scores,
                             risk=global_risk)
            part = r.equity
            all_trades.append(r.trades)
            fees += r.metrics.get("comisiones_pagadas", 0)
            invested += r.metrics.get("_invested_bars", 0)
        else:
            part = pd.Series(capital, index=idx[(idx >= tr1) & (idx < te1)])
        capital = float(part.iloc[-1])
        total_bars += len(part)
        equity_parts.append(part)
        used = "APAGADA (freno de emergencia)" if global_risk.halted else ([n for n, _, _ in picks] or "NADA (liquidez)")
        log(f"  tramo {tr1:%Y-%m-%d} → {te1:%Y-%m-%d}: usa {used}"
            f" | capital {capital:,.2f}")
        start += test_bars

    if not equity_parts:
        raise ValueError("No hay datos suficientes para walk-forward")
    equity = pd.concat(equity_parts)
    equity = equity[~equity.index.duplicated(keep="last")]
    trades = pd.concat(all_trades, ignore_index=True) if all_trades else pd.DataFrame(columns=["pnl", "ret"])
    m = metrics(equity, trades, _bars_per_year(equity.index), fees, invested / max(1, total_bars))
    m["kill_switch"] = global_risk.halted
    closes = pd.DataFrame({s: data[s]["close"].reindex(equity.index) for s in data}).ffill().bfill()
    m["comprar_y_mantener"] = float((closes.iloc[-1] / closes.iloc[0]).mean() - 1)
    return {"equity": equity, "trades": trades, "metrics": m, "folds": chosen}
