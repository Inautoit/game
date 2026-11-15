"""Arbitraje de financiación (funding) — backtest con el historial real de Binance.

Idea profesional: comprar la moneda al contado y, a la vez, venderla en futuros perpetuos por el mismo importe.
Si el precio sube o baja, una pata gana lo que pierde la otra (posición "neutral"). Lo que queda es la
financiación: cuando el mercado es optimista, los que compran perpetuos pagan a los que venden cada 8 horas.
"""
import io
import os
import zipfile
import numpy as np
import pandas as pd
import requests


def fetch_funding(symbol: str, days: int = 1095, cache_dir: str = "data") -> pd.Series:
    """Tasa de financiación de cada periodo (normalmente cada 8 h) de Binance USDⓈ-M."""
    os.makedirs(cache_dir, exist_ok=True)
    pair = symbol.replace("/", "")
    end = pd.Timestamp.now(tz="UTC").normalize().replace(day=1)
    months = pd.date_range(end - pd.Timedelta(days=days), end, freq="MS", tz="UTC")[:-1]
    parts = []
    for m in months:
        path = os.path.join(cache_dir, f"fr_{pair}_{m:%Y-%m}.csv")
        if not os.path.exists(path):
            url = f"https://data.binance.vision/data/futures/um/monthly/fundingRate/{pair}/{pair}-fundingRate-{m:%Y-%m}.zip"
            r = requests.get(url, timeout=60)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                raw = pd.read_csv(z.open(z.namelist()[0]))
            raw.to_csv(path, index=False)
        parts.append(pd.read_csv(path))
    if not parts:
        raise ValueError(f"sin funding para {symbol}")
    df = pd.concat(parts)
    tcol = [c for c in df.columns if "time" in c.lower()][0]
    rcol = [c for c in df.columns if "rate" in c.lower() and "interval" not in c.lower()][0]
    t = pd.to_numeric(df[tcol])
    t = np.where(t > 10**14, t // 1000, t)
    s = pd.Series(pd.to_numeric(df[rcol]).to_numpy(), index=pd.to_datetime(t, unit="ms", utc=True)).sort_index()
    return s[~s.index.duplicated()].resample("8h").sum()  # agrupar a periodos de 8 h


def backtest_funding(rates: pd.DataFrame, max_pos: int = 3, enter_apr: float = 0.15, exit_apr: float = 0.03,
                     lookback: int = 3, cost_round_trip: float = 0.003, capital: float = 10_000.0):
    """rates: columnas = monedas, filas = periodos de 8 h. Devuelve curva de capital y estadísticas.
    Se decide con la media de los ÚLTIMOS `lookback` periodos (ya conocidos) y se cobra el SIGUIENTE."""
    per_year = 3 * 365
    sig = rates.rolling(lookback, min_periods=lookback).mean() * per_year  # APR estimado, conocido al cierre
    held, eq, curve, switches, earned, paid = set(), capital, [], 0, 0.0, 0.0
    notional_frac = 0.5  # la mitad del capital al contado y la otra mitad de garantía del corto
    for i in range(len(rates) - 1):
        row = sig.iloc[i]
        keep = {c for c in held if row.get(c, np.nan) > exit_apr}
        cands = [c for c in row.sort_values(ascending=False).index if row[c] > enter_apr and c not in keep]
        new = set(list(keep) + cands[: max(0, max_pos - len(keep))])
        changes = len(held - new) + len(new - held)
        per_slot = eq * notional_frac / max_pos
        cost = changes * per_slot * cost_round_trip / 2
        eq -= cost
        paid += cost
        switches += changes
        held = new
        nxt = rates.iloc[i + 1]
        gain = sum(per_slot * nxt[c] for c in held if not np.isnan(nxt[c]))
        eq += gain
        earned += gain
        curve.append((rates.index[i + 1], eq))
    c = pd.Series(dict(curve))
    years = len(c) / per_year
    dd = (c / c.cummax() - 1).min()
    r = c.pct_change().dropna()
    sharpe = r.mean() / r.std() * np.sqrt(per_year) if r.std() > 0 else 0
    return c, {"retorno_total": c.iloc[-1] / capital - 1, "retorno_anual": (c.iloc[-1] / capital) ** (1 / years) - 1,
               "max_drawdown": dd, "sharpe": sharpe, "cambios": switches, "cobrado": earned, "costes": paid,
               "periodos_con_posicion_%": None}
