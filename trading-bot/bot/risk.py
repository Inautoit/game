"""Gestión de riesgo: tamaño de posición, límites diarios e interruptor de emergencia."""
from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class RiskManager:
    risk_per_trade: float = 0.005
    max_position_pct: float = 0.20
    max_open_positions: int = 4
    stop_atr_mult: float = 1.5
    take_profit_atr_mult: float = 3.0
    trailing_atr_mult: float = 2.0
    max_holding_bars: int = 48
    daily_loss_limit: float = 0.02
    max_drawdown_kill: float = 0.10
    allow_short: bool = True
    flatten_eod_stocks: bool = True
    no_entry_last_bars: int = 3

    peak_equity: float = 0.0
    day_start_equity: float = 0.0
    current_day: object = None
    killed: bool = False
    halted_today: bool = False
    events: list = field(default_factory=list)

    @classmethod
    def from_config(cls, cfg: dict) -> "RiskManager":
        fields = {k: v for k, v in cfg.get("risk", {}).items() if k in cls.__dataclass_fields__}
        return cls(**fields)

    def on_equity(self, equity: float, day) -> None:
        if day != self.current_day:
            self.current_day = day
            self.day_start_equity = equity
            self.halted_today = False
        self.peak_equity = max(self.peak_equity, equity)
        if not self.killed and self.peak_equity > 0 and \
                equity < self.peak_equity * (1 - self.max_drawdown_kill):
            self.killed = True
            self.events.append(f"{day}: KILL SWITCH — drawdown > {self.max_drawdown_kill:.0%}")
        if not self.halted_today and self.day_start_equity > 0 and \
                equity < self.day_start_equity * (1 - self.daily_loss_limit):
            self.halted_today = True
            self.events.append(f"{day}: límite de pérdida diaria alcanzado, pausa hasta mañana")

    def can_open(self, n_open: int, direction: int) -> bool:
        if self.killed or self.halted_today:
            return False
        if direction < 0 and not self.allow_short:
            return False
        return n_open < self.max_open_positions

    def size(self, equity: float, price: float, atr_value: float) -> tuple[float, float, float]:
        """Devuelve (cantidad, distancia_stop, distancia_take_profit)."""
        if atr_value <= 0 or price <= 0 or equity <= 0:
            return 0.0, 0.0, 0.0
        stop_dist = self.stop_atr_mult * atr_value
        qty = (equity * self.risk_per_trade) / stop_dist
        qty = min(qty, equity * self.max_position_pct / price)
        return qty, stop_dist, self.take_profit_atr_mult * atr_value
