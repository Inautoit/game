"""Escáner de mercado: decide DÓNDE operar.

Puntúa cada activo por:
  - liquidez (volumen negociado): sin liquidez las comisiones y el slippage te comen
  - momentum relativo: los que suben más que el mercado tienden a seguir haciéndolo a corto plazo
  - fuerza de tendencia (ADX)
  - volatilidad útil: suficiente para cubrir costes, pero no una locura
La misma función se usa en backtest (vela a vela) y en vivo, para que lo probado sea lo que se ejecuta.
"""
import numpy as np
import pandas as pd

from . import indicators as ind

STABLE = {"USDT", "USDC", "BUSD", "DAI", "TUSD", "FDUSD", "USDP", "EUR", "GBP", "PYUSD", "USDE", "EURC"}


def score_series(df: pd.DataFrame, lookback: int = 72, vol_min: float = 0.004, vol_max: float = 0.05) -> pd.Series:
    close = df["close"]
    mom = close / close.shift(lookback) - 1
    a = ind.adx(df, 14) / 100
    atr_pct = ind.atr(df, 14) / close
    vol_ok = ((atr_pct > vol_min) & (atr_pct < vol_max)).astype(float)
    liq = np.log1p((df["volume"] * close).rolling(24, min_periods=24).mean())
    raw = 3.0 * mom + 1.0 * a + 0.05 * liq
    return (raw * vol_ok).where(vol_ok > 0, -np.inf)


def rank_at(scores: dict, ts) -> list:
    """Ordena símbolos de mejor a peor en el instante ts."""
    vals = []
    for sym, s in scores.items():
        v = s.get(ts, np.nan)
        if v is not None and np.isfinite(v):
            vals.append((v, sym))
    return [s for _, s in sorted(vals, reverse=True)]


def pick_universe(exchange, quote: str, top_by_volume: int, exclude=()):
    """Elige en vivo los N mercados más líquidos de la moneda de cotización (p.ej. USDT o EUR)."""
    tickers = exchange.fetch_tickers()
    rows = []
    for sym, t in tickers.items():
        m = exchange.markets.get(sym)
        if not m or not m.get("spot") or not m.get("active", True) or m.get("quote") != quote:
            continue
        base = m.get("base", "")
        if base in STABLE or base in exclude or (len(base) > 4 and base.endswith(("UP", "DOWN", "BULL", "BEAR"))):
            continue
        qv = t.get("quoteVolume") or 0
        if not qv and t.get("baseVolume") and t.get("last"):
            qv = t["baseVolume"] * t["last"]
        rows.append((qv or 0, sym))
    rows.sort(reverse=True)
    return [s for _, s in rows[:top_by_volume]]
