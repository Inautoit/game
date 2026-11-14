"""Control de riesgo: decide CUÁNTO y cuándo PARAR. Es la parte más importante.

Reglas:
  - Cada operación arriesga como máximo `risk_per_trade` del capital (distancia al stop-loss).
  - Ninguna posición supera `max_position_pct` del capital ni usa dinero que no hay (sin apalancamiento).
  - Máximo `max_positions` posiciones abiertas a la vez.
  - Si en un día se pierde `daily_loss_limit`, no abre nada más ese día.
  - Si desde el máximo se pierde `max_drawdown`, cierra todo y se APAGA (requiere reinicio manual).
"""
from dataclasses import dataclass


@dataclass
class RiskConfig:
    risk_per_trade: float = 0.01
    max_position_pct: float = 0.25
    max_positions: int = 4
    daily_loss_limit: float = 0.03
    max_drawdown: float = 0.15
    min_notional: float = 10.0


class RiskManager:
    def __init__(self, cfg: RiskConfig):
        self.cfg = cfg
        self.peak = None
        self.day = None
        self.day_start_equity = None
        self.halted = False
        self.halt_reason = ""

    def to_state(self):
        return {"peak": self.peak, "day": self.day, "day_start_equity": self.day_start_equity,
                "halted": self.halted, "halt_reason": self.halt_reason}

    def load_state(self, st):
        for k, v in (st or {}).items():
            setattr(self, k, v)

    def update(self, equity: float, day) -> str:
        """Llamar en cada vela. Devuelve 'kill' si hay que cerrar todo y apagar."""
        if self.peak is None or equity > self.peak:
            self.peak = equity
        if day != self.day:
            self.day, self.day_start_equity = day, equity
        if not self.halted and equity < self.peak * (1 - self.cfg.max_drawdown):
            self.halted = True
            self.halt_reason = f"drawdown máximo superado ({equity:.2f} < {self.peak * (1 - self.cfg.max_drawdown):.2f})"
            return "kill"
        return ""

    def can_open(self, equity: float, n_open: int) -> bool:
        if self.halted or n_open >= self.cfg.max_positions:
            return False
        if self.day_start_equity and equity < self.day_start_equity * (1 - self.cfg.daily_loss_limit):
            return False
        return True

    def size(self, equity: float, cash: float, price: float, stop: float) -> float:
        """Cantidad a comprar. 0 si no cumple las reglas."""
        if not (price > 0) or not (stop < price) or stop <= 0:
            return 0.0
        risk_amt = equity * self.cfg.risk_per_trade
        qty = risk_amt / (price - stop)
        qty = min(qty, equity * self.cfg.max_position_pct / price, cash * 0.98 / price)
        if qty * price < self.cfg.min_notional:
            return 0.0
        return qty
