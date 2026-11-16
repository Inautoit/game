"""Brokers. PaperBroker = dinero simulado con estado persistente en JSON.
AlpacaBroker = cuenta paper (o real) de Alpaca vía REST. Para dinero real se exige
mode=live en config Y la variable de entorno CONFIRMO_DINERO_REAL=si.
"""
from __future__ import annotations

import json
import os
from dataclasses import asdict
from pathlib import Path

from .backtest import Position
from .config import costs_for


class PaperBroker:
    def __init__(self, cfg: dict, state_file: str):
        self.cfg = cfg
        self.path = Path(state_file)
        if self.path.exists():
            s = json.loads(self.path.read_text())
            self.cash = s["cash"]
            self.positions = {k: Position(**v) for k, v in s["positions"].items()}
        else:
            self.cash = float(cfg.get("capital_inicial", 10_000))
            self.positions: dict[str, Position] = {}

    def save(self):
        self.path.write_text(json.dumps({"cash": self.cash, "positions": {
            k: asdict(v) for k, v in self.positions.items()}}, default=str, indent=2))

    def equity(self, prices: dict[str, float]) -> float:
        return self.cash + sum(p.qty * p.direction * prices.get(s, p.entry_price)
                               for s, p in self.positions.items())

    def open(self, sym, direction, qty, price, stop_dist, tp_dist, t) -> Position:
        comm, slip = costs_for(self.cfg, sym)
        fill = price * (1 + slip * direction)
        fee = qty * fill * comm
        self.cash -= direction * qty * fill + fee
        p = Position(sym, direction, qty, fill, str(t), fill - direction * stop_dist,
                     fill + direction * tp_dist, 0, fill, fee)
        self.positions[sym] = p
        self.save()
        return p

    def close(self, sym, price) -> tuple[Position, float, float]:
        p = self.positions.pop(sym)
        comm, slip = costs_for(self.cfg, sym)
        fill = price * (1 - slip * p.direction)
        fee = abs(p.qty * fill) * comm
        self.cash += p.direction * p.qty * fill - fee
        pnl = p.direction * p.qty * (fill - p.entry_price) - fee - p.entry_cost
        self.save()
        return p, fill, pnl


class AlpacaBroker(PaperBroker):
    """Adaptador para Alpaca (acciones EEUU y cripto). Sin probar contra la API real:
    úsalo primero con la cuenta paper. Claves en ALPACA_API_KEY / ALPACA_SECRET_KEY."""

    def __init__(self, cfg: dict, state_file: str, live: bool = False):
        super().__init__(cfg, state_file)
        if live and os.environ.get("CONFIRMO_DINERO_REAL") != "si":
            raise RuntimeError("Para operar con dinero real exporta CONFIRMO_DINERO_REAL=si")
        self.base = "https://api.alpaca.markets" if live else "https://paper-api.alpaca.markets"
        self.headers = {"APCA-API-KEY-ID": os.environ["ALPACA_API_KEY"],
                        "APCA-API-SECRET-KEY": os.environ["ALPACA_SECRET_KEY"]}

    def _order(self, sym, qty, side):
        import requests
        r = requests.post(f"{self.base}/v2/orders", headers=self.headers, timeout=10, json={
            "symbol": sym.replace("-", "/"), "qty": str(round(qty, 6)), "side": side,
            "type": "market", "time_in_force": "day" if "-" not in sym else "gtc"})
        r.raise_for_status()
        return r.json()

    def open(self, sym, direction, qty, price, stop_dist, tp_dist, t):
        self._order(sym, qty, "buy" if direction == 1 else "sell")
        return super().open(sym, direction, qty, price, stop_dist, tp_dist, t)

    def close(self, sym, price):
        p = self.positions[sym]
        self._order(sym, p.qty, "sell" if p.direction == 1 else "buy")
        return super().close(sym, price)
