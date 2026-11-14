"""Estrategias: deciden CUÁNDO entrar y salir.

Cada estrategia devuelve, por vela (calculado al CIERRE de esa vela):
  entry  -> True si hay que comprar en la apertura de la siguiente vela
  exit   -> True si hay que vender en la apertura de la siguiente vela
  stop   -> stop-loss inicial sugerido si se entra
  trail  -> nivel de stop dinámico (el stop solo puede subir); NaN = sin trailing
  strength -> fuerza de la señal (para priorizar cuando hay varias a la vez)

Solo posiciones largas (comprar barato, vender caro): en spot no hace falta apalancamiento.
Cada estrategia incluye su propio filtro de "régimen" de mercado, así la máquina
usa tendencia cuando hay tendencia y reversión a la media cuando el mercado va lateral.
"""
from dataclasses import dataclass, field
import numpy as np
import pandas as pd

from . import indicators as ind


@dataclass
class Strategy:
    params: dict = field(default_factory=dict)
    name: str = "base"
    max_hold_bars: int = 0  # 0 = sin límite

    def p(self, key, default):
        return self.params.get(key, default)

    def generate(self, df: pd.DataFrame) -> pd.DataFrame:
        raise NotImplementedError

    def _out(self, df, entry, exit_, stop, trail, strength):
        out = pd.DataFrame(index=df.index)
        out["entry"] = entry.fillna(False).astype(bool)
        out["exit"] = exit_.fillna(False).astype(bool)
        out["stop"] = stop
        out["trail"] = trail
        out["strength"] = strength.fillna(0.0)
        return out


class TrendFollow(Strategy):
    """Sigue tendencias fuertes: cruce de medias + ADX alto. Stop dinámico tipo 'chandelier'."""

    def __init__(self, params=None):
        super().__init__(params or {}, "trend")

    def generate(self, df):
        fast = ind.ema(df["close"], self.p("fast", 20))
        slow = ind.ema(df["close"], self.p("slow", 50))
        a = ind.adx(df, 14)
        atr = ind.atr(df, 14)
        cond = (fast > slow) & (df["close"] > slow) & (a > self.p("adx_min", 22))
        entry = cond & ~cond.shift(1, fill_value=False)
        exit_ = fast < slow
        m = self.p("atr_mult", 3.0)
        stop = df["close"] - m * atr
        trail = df["close"] - m * atr
        strength = (a / 50.0) * ((fast / slow) - 1).clip(lower=0) * 100
        return self._out(df, entry, exit_, stop, trail, strength)


class Breakout(Strategy):
    """Rupturas de máximos con volumen: captura el inicio de movimientos explosivos."""

    def __init__(self, params=None):
        super().__init__(params or {}, "breakout")

    def generate(self, df):
        n = self.p("n", 24)
        hi = ind.donchian_high(df, n)
        lo = ind.donchian_low(df, max(2, n // 2))
        vol_ok = df["volume"] > self.p("vol_mult", 1.5) * ind.sma(df["volume"], 20)
        trend_ok = df["close"] > ind.ema(df["close"], 100)
        atr = ind.atr(df, 14)
        entry = (df["close"] > hi) & vol_ok & trend_ok
        exit_ = df["close"] < lo
        m = self.p("atr_mult", 2.5)
        stop = df["close"] - m * atr
        trail = df["close"] - m * atr
        strength = ((df["close"] - hi) / atr).clip(lower=0) + (df["volume"] / ind.sma(df["volume"], 20))
        return self._out(df, entry, exit_, stop, trail, strength)


class MeanReversion(Strategy):
    """Compra caídas exageradas dentro de una tendencia alcista y en mercado lateral."""

    def __init__(self, params=None):
        super().__init__(params or {}, "meanrev")
        self.max_hold_bars = self.p("max_hold", 24)

    def generate(self, df):
        r = ind.rsi(df["close"], 14)
        lower, mid, _ = ind.bollinger(df["close"], 20, 2.0)
        a = ind.adx(df, 14)
        atr = ind.atr(df, 14)
        uptrend = df["close"] > ind.ema(df["close"], 200)
        entry = (r < self.p("rsi_entry", 30)) & (df["close"] < lower) & uptrend & (a < self.p("adx_max", 25))
        exit_ = (df["close"] > mid) | (r > self.p("rsi_exit", 55))
        stop = df["close"] - self.p("atr_mult", 2.0) * atr
        trail = pd.Series(np.nan, index=df.index)
        strength = (self.p("rsi_entry", 30) - r).clip(lower=0) / 10
        return self._out(df, entry, exit_, stop, trail, strength)


REGISTRY = {"trend": TrendFollow, "breakout": Breakout, "meanrev": MeanReversion}

# Rejillas pequeñas para el walk-forward (pocas combinaciones = menos sobreajuste).
PARAM_GRIDS = {
    "trend": [{"fast": f, "slow": s, "adx_min": a, "atr_mult": 3.0}
              for f, s in [(12, 36), (20, 50), (30, 90)] for a in (18, 25)],
    "breakout": [{"n": n, "vol_mult": v, "atr_mult": 2.5} for n in (12, 24, 48) for v in (1.2, 1.8)],
    "meanrev": [{"rsi_entry": r, "atr_mult": 2.0, "max_hold": h} for r in (25, 30, 35) for h in (12, 36)],
}


def build(cfg_strats: dict) -> list:
    """cfg_strats: {"trend": {params} | None, ...}. Orden = prioridad."""
    return [REGISTRY[name](params or {}) for name, params in cfg_strats.items()]
