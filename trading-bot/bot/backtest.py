"""Backtester de cartera multi-activo, vela a vela, sin mirar al futuro.

Reglas de ejecución (conservadoras):
- La señal se calcula al CIERRE de la vela t y se ejecuta en la APERTURA de t+1 (+ slippage).
- Stop y take-profit se comprueban con el máximo/mínimo de cada vela; si ambos se tocan
  en la misma vela se asume que salta primero el STOP (peor caso).
- Si el precio abre con hueco más allá del stop, se ejecuta en la apertura (no en el stop).
- Acciones: se cierra todo al final de la sesión si flatten_eod_stocks.
"""
from __future__ import annotations

from dataclasses import dataclass, asdict

import numpy as np
import pandas as pd

from .config import asset_class, costs_for
from .indicators import session_dates
from .metrics import summarize
from .risk import RiskManager
from .strategies import generate_signals


@dataclass
class Position:
    symbol: str
    direction: int
    qty: float
    entry_price: float
    entry_time: object
    stop: float
    take_profit: float
    bars_held: int = 0
    best_price: float = 0.0
    entry_cost: float = 0.0


@dataclass
class Trade:
    symbol: str
    direction: int
    qty: float
    entry_time: object
    entry_price: float
    exit_time: object
    exit_price: float
    pnl: float
    return_pct: float
    bars_held: int
    reason: str


class Backtester:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.strategy = cfg["strategy"]["name"]
        self.params = cfg["strategy"].get("params", {})

    def prepare(self, data: dict[str, pd.DataFrame]) -> dict[str, pd.DataFrame]:
        out = {}
        for sym, df in data.items():
            comm, slip = costs_for(self.cfg, sym)
            s = generate_signals(df, self.strategy, {**self.params, "_cost_frac": 2 * (comm + slip)})
            day = pd.Series(session_dates(s.index), index=s.index)
            s["last_of_session"] = day.ne(day.shift(-1))
            # posición de la vela dentro de los últimos N de la sesión
            s["bars_to_close"] = s.groupby(day.values).cumcount(ascending=False)
            s["day"] = day.values
            out[sym] = s
        return out

    def run(self, data: dict[str, pd.DataFrame]) -> dict:
        risk = RiskManager.from_config(self.cfg)
        cash = float(self.cfg.get("capital_inicial", 10_000))
        sigs = self.prepare(data)
        positions: dict[str, Position] = {}
        pending: dict[str, tuple[str, int]] = {}  # sym -> ("open"/"close", dir/ reason)
        pending_reason: dict[str, str] = {}
        trades: list[Trade] = []
        last_price: dict[str, float] = {}
        equity_curve = []
        keep = ["open", "high", "low", "close", "atr", "entry", "exit_long", "exit_short",
                "score", "last_of_session", "bars_to_close"]
        rows = {s: df[[c for c in keep if c in df]].to_dict("index") for s, df in sigs.items()}
        timeline = sorted(set().union(*[df.index for df in sigs.values()]))

        def equity() -> float:
            return cash + sum(p.qty * p.direction * last_price.get(p.symbol, p.entry_price)
                              for p in positions.values())

        def close_pos(sym: str, price: float, t, reason: str):
            nonlocal cash
            p = positions.pop(sym)
            comm, slip = costs_for(self.cfg, sym)
            fill = price * (1 - slip * p.direction)
            fee = abs(p.qty * fill) * comm
            cash += p.direction * p.qty * fill - fee
            pnl = p.direction * p.qty * (fill - p.entry_price) - fee - p.entry_cost
            trades.append(Trade(sym, p.direction, p.qty, p.entry_time, p.entry_price, t, fill,
                                pnl, pnl / (p.qty * p.entry_price), p.bars_held, reason))

        candidates: list = []
        for t in timeline:
            for sym, r_all in rows.items():
                r = r_all.get(t)
                if r is None:
                    continue
                cls = asset_class(sym)
                # 1) ejecutar órdenes pendientes en la apertura
                if sym in pending:
                    action, d = pending.pop(sym)
                    if action == "close" and sym in positions:
                        close_pos(sym, r["open"], t, pending_reason.pop(sym, "señal"))
                    elif action == "open" and sym not in positions and r.get("atr", np.nan) > 0:
                        comm, slip = costs_for(self.cfg, sym)
                        fill = r["open"] * (1 + slip * d)
                        qty, sd, td = risk.size(equity(), fill, r["atr"])
                        if qty > 0:
                            fee = qty * fill * comm
                            cash -= d * qty * fill + fee
                            positions[sym] = Position(sym, d, qty, fill, t, fill - d * sd,
                                                      fill + d * td, 0, fill, fee)
                # 2) gestionar posición abierta con el rango de la vela
                if sym in positions:
                    p = positions[sym]
                    p.bars_held += 1
                    hit = None
                    if p.direction == 1:
                        if r["open"] <= p.stop:
                            hit = (r["open"], "stop (gap)")
                        elif r["low"] <= p.stop:
                            hit = (p.stop, "stop")
                        elif r["high"] >= p.take_profit:
                            hit = (max(p.take_profit, r["open"]), "take profit")
                    else:
                        if r["open"] >= p.stop:
                            hit = (r["open"], "stop (gap)")
                        elif r["high"] >= p.stop:
                            hit = (p.stop, "stop")
                        elif r["low"] <= p.take_profit:
                            hit = (min(p.take_profit, r["open"]), "take profit")
                    if hit:
                        close_pos(sym, hit[0], t, hit[1])
                    else:
                        # trailing stop
                        if risk.trailing_atr_mult > 0 and r["atr"] > 0:
                            if p.direction == 1:
                                p.best_price = max(p.best_price, r["high"])
                                p.stop = max(p.stop, p.best_price - risk.trailing_atr_mult * r["atr"])
                            else:
                                p.best_price = min(p.best_price, r["low"])
                                p.stop = min(p.stop, p.best_price + risk.trailing_atr_mult * r["atr"])
                        eod = cls == "stock" and risk.flatten_eod_stocks and r["last_of_session"]
                        if eod:
                            close_pos(sym, r["close"], t, "cierre de sesión")
                        elif p.bars_held >= risk.max_holding_bars:
                            pending[sym] = ("close", 0); pending_reason[sym] = "tiempo máximo"
                        elif (p.direction == 1 and r["exit_long"]) or (p.direction == -1 and r["exit_short"]):
                            pending[sym] = ("close", 0); pending_reason[sym] = "señal de salida"
                last_price[sym] = r["close"]
                # 3) candidatas a nueva entrada (se ordenan por calidad al final de la vela)
                if sym not in positions and sym not in pending and r["entry"] != 0:
                    late = cls == "stock" and risk.flatten_eod_stocks and r["bars_to_close"] < risk.no_entry_last_bars
                    if not late:
                        sc = r.get("score", 1.0)
                        candidates.append((abs(sc) if sc == sc else 0.0, sym, int(r["entry"])))
            # elegir las MEJORES oportunidades de todos los mercados hasta llenar el cupo
            for _, sym, d in sorted(candidates, reverse=True):
                if risk.can_open(len(positions) + sum(1 for a, _ in pending.values() if a == "open"), d):
                    pending[sym] = ("open", d)
            candidates.clear()
            eq = equity()
            risk.on_equity(eq, pd.Timestamp(t).tz_convert("America/New_York").date())
            if risk.killed or risk.halted_today:
                pending = {k: v for k, v in pending.items() if v[0] != "open"}
            equity_curve.append((t, eq, cash, len(positions)))

        for sym in list(positions):  # liquidar al final
            close_pos(sym, last_price[sym], timeline[-1], "fin del backtest")
        eq_df = pd.DataFrame(equity_curve, columns=["time", "equity", "cash", "open_positions"]).set_index("time")
        if len(eq_df):
            eq_df.iloc[-1, eq_df.columns.get_loc("equity")] = cash
        tr_df = pd.DataFrame([asdict(x) for x in trades])
        bench = {s: float(df["close"].iloc[-1] / df["close"].iloc[0] - 1) for s, df in data.items()}
        return {"equity": eq_df, "trades": tr_df, "risk_events": risk.events,
                "metrics": summarize(eq_df["equity"], tr_df, float(self.cfg.get("capital_inicial", 10_000))),
                "buy_and_hold": bench}
