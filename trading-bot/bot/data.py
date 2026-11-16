"""Descarga y normalización de datos OHLCV (Yahoo Finance) + datos sintéticos."""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

COLS = ["open", "high", "low", "close", "volume"]


def _normalize(df: pd.DataFrame) -> pd.DataFrame:
    if isinstance(df.columns, pd.MultiIndex):
        df = df.copy()
        df.columns = df.columns.get_level_values(0)
    df = df.rename(columns=str.lower)
    df = df[[c for c in COLS if c in df.columns]].dropna(subset=["open", "high", "low", "close"])
    if "volume" not in df:
        df["volume"] = 0.0
    df = df[~df.index.duplicated(keep="last")].sort_index()
    return df.astype(float)


def fetch(symbol: str, interval: str = "5m", period: str = "60d",
          cache_dir: str | None = None, use_cache: bool = False) -> pd.DataFrame:
    """Descarga velas de Yahoo Finance. Funciona con acciones, ETF, cripto, forex y futuros."""
    cache = None
    if cache_dir:
        Path(cache_dir).mkdir(parents=True, exist_ok=True)
        cache = Path(cache_dir) / f"{symbol.replace('=', '_')}_{interval}_{period}.csv"
        if use_cache and cache.exists():
            df = pd.read_csv(cache, index_col=0)
            df.index = pd.to_datetime(df.index, utc=True)
            return df

    import yfinance as yf  # import perezoso: los tests no lo necesitan

    raw = yf.download(symbol, interval=interval, period=period, auto_adjust=True,
                      progress=False, threads=False)
    if raw is None or raw.empty:
        log.warning("Sin datos para %s", symbol)
        return pd.DataFrame(columns=COLS)
    df = _normalize(raw)
    df.index = pd.to_datetime(df.index, utc=True)
    if cache is not None:
        df.to_csv(cache)
    return df


def fetch_many(symbols, **kw) -> dict[str, pd.DataFrame]:
    out = {}
    for s in symbols:
        try:
            df = fetch(s, **kw)
            if len(df) > 50:
                out[s] = df
            else:
                log.warning("%s: datos insuficientes (%d velas)", s, len(df))
        except Exception as e:  # noqa: BLE001
            log.warning("%s: error descargando: %s", s, e)
    return out


def synthetic(n: int = 3000, seed: int = 0, start_price: float = 100.0,
              freq: str = "5min", session: bool = True) -> pd.DataFrame:
    """Serie sintética con regímenes de tendencia/rango (para tests y demos offline)."""
    rng = np.random.default_rng(seed)
    drift = np.zeros(n)
    i = 0
    while i < n:
        length = rng.integers(100, 400)
        drift[i:i + length] = rng.choice([-1, 0, 0, 1]) * 0.0004
        i += length
    rets = drift + rng.normal(0, 0.002, n)
    close = start_price * np.exp(np.cumsum(rets))
    open_ = np.concatenate([[start_price], close[:-1]]) * (1 + rng.normal(0, 0.0005, n))
    spread = np.abs(rng.normal(0, 0.0015, n)) * close
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - spread
    vol = rng.lognormal(10, 0.5, n)
    if session:  # 78 velas de 5m = sesión bursátil de 6.5h
        days = pd.bdate_range("2025-01-02", periods=n // 78 + 2, tz="America/New_York")
        idx = pd.DatetimeIndex([d + pd.Timedelta(hours=9, minutes=30) + pd.Timedelta(minutes=5 * k)
                                for d in days for k in range(78)][:n]).tz_convert("UTC")
    else:
        idx = pd.date_range("2025-01-01", periods=n, freq=freq, tz="UTC")
    return pd.DataFrame({"open": open_, "high": high, "low": low, "close": close, "volume": vol}, index=idx)


# ---------------------------------------------------------------------------
# Histórico largo de cripto desde Binance (gratis, sin clave, años de velas)
# ---------------------------------------------------------------------------
BINANCE_URL = "https://data-api.binance.vision/api/v3/klines"
_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000,
       "4h": 14_400_000, "1d": 86_400_000}


def binance_symbol(symbol: str) -> str:
    """BTC-USD -> BTCUSDT (convención Yahoo -> Binance)."""
    base = symbol.upper().split("-")[0]
    return f"{base}USDT"


def fetch_binance(symbol: str, interval: str = "15m", years: float = 3.0,
                  cache_dir: str | None = "data_cache", end_ms: int | None = None) -> pd.DataFrame:
    import time
    import requests

    sym = binance_symbol(symbol)
    step = _MS[interval]
    end = end_ms or int(time.time() * 1000)
    start = end - int(years * 365 * 86_400_000)
    cache = Path(cache_dir) / f"binance_{sym}_{interval}.csv" if cache_dir else None
    old = None
    if cache is not None and cache.exists():
        old = pd.read_csv(cache, index_col=0)
        old.index = pd.to_datetime(old.index, utc=True)
        start = max(start, int(old.index[-1].timestamp() * 1000) + step)
    rows = []
    cur = start
    while cur < end:
        r = requests.get(BINANCE_URL, params={"symbol": sym, "interval": interval,
                                             "startTime": cur, "limit": 1000}, timeout=20)
        r.raise_for_status()
        batch = r.json()
        if not batch:
            break
        rows.extend(batch)
        cur = batch[-1][0] + step
        if len(batch) < 1000:
            break
    df = pd.DataFrame(rows, columns=["t", "open", "high", "low", "close", "volume", *range(6)])
    if len(df):
        df.index = pd.to_datetime(df["t"], unit="ms", utc=True)
        df = df[COLS].astype(float)
    else:
        df = pd.DataFrame(columns=COLS)
    if old is not None:
        df = pd.concat([old, df])
        df = df[~df.index.duplicated(keep="last")].sort_index()
    # quitar la vela en curso (aún no cerrada)
    if len(df) and df.index[-1].timestamp() * 1000 + step > end:
        df = df.iloc[:-1]
    if cache is not None and len(df):
        cache.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(cache)
    cutoff = pd.Timestamp(end - int(years * 365 * 86_400_000), unit="ms", tz="UTC")
    return df[df.index >= cutoff]
