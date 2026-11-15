"""Arbitraje estadístico de pares — backtest.

Dos monedas que suelen moverse juntas (p. ej. ETH y BTC) mantienen una relación de precios estable.
Cuando esa relación se separa mucho de lo normal (z-score), se compra la "barata" y se vende la "cara"
por el mismo importe, esperando que vuelvan a juntarse. No apuesta por si el mercado sube o baja.
"""
import itertools
import numpy as np
import pandas as pd


def zscore(a: pd.Series, b: pd.Series, lookback: int) -> pd.Series:
    r = np.log(a) - np.log(b)
    return (r - r.rolling(lookback).mean()) / r.rolling(lookback).std()


def backtest_pairs(closes: pd.DataFrame, lookback=168, z_in=2.5, z_out=0.5, z_stop=4.5, max_hold=72,
                   cost_rt=0.0014, min_corr=0.7, corr_window=24 * 30):
    """Devuelve las operaciones (una fila por operación, retorno sobre el importe de la operación).
    Decide al cierre de una vela y ejecuta al cierre de la siguiente (sin mirar al futuro)."""
    rets = np.log(closes).diff()
    trades = []
    for A, B in itertools.combinations(closes.columns, 2):
        z = zscore(closes[A], closes[B], lookback).to_numpy()
        corr = rets[A].rolling(corr_window).corr(rets[B]).to_numpy()
        la, lb = np.log(closes[A].to_numpy()), np.log(closes[B].to_numpy())
        pos, entry_i = 0, None
        for i in range(lookback, len(z) - 1):
            if pos == 0:
                if np.isfinite(z[i]) and np.isfinite(corr[i]) and corr[i] > min_corr and abs(z[i]) > z_in:
                    pos, entry_i = (-1 if z[i] > 0 else 1), i + 1   # z>0: A cara -> vender A, comprar B
            else:
                held = i + 1 - entry_i
                if abs(z[i]) < z_out or abs(z[i]) > z_stop or held >= max_hold or not np.isfinite(z[i]):
                    j = i + 1
                    spread_ret = pos * ((la[j] - la[entry_i]) - (lb[j] - lb[entry_i])) / 2
                    reason = "vuelve" if abs(z[i]) < z_out else ("stop" if abs(z[i]) > z_stop else "tiempo")
                    trades.append((closes.index[entry_i], closes.index[j], A, B, pos, spread_ret - cost_rt, reason))
                    pos = 0
    return pd.DataFrame(trades, columns=["entrada", "salida", "A", "B", "lado", "ret", "motivo"])


def portfolio(trades: pd.DataFrame, slots: int = 5):
    """Capital repartido en `slots` operaciones a la vez; si hay más señales que huecos, se ignoran."""
    trades = trades.sort_values("entrada")
    busy, eq, taken = [], 1.0, []
    for _, t in trades.iterrows():
        busy = [x for x in busy if x > t.entrada]
        if len(busy) < slots:
            busy.append(t.salida)
            taken.append(t)
    tk = pd.DataFrame(taken)
    tk["pnl"] = tk.ret / slots
    return tk
