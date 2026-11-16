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


# ---------------------------------------------------------------------------
# Descarga masiva rápida: ficheros mensuales de data.binance.vision + Yahoo por lotes
# ---------------------------------------------------------------------------
def _binance_month(sym: str, interval: str, ym: str) -> pd.DataFrame | None:
    import io
    import zipfile
    import requests
    url = f"https://data.binance.vision/data/spot/monthly/klines/{sym}/{interval}/{sym}-{interval}-{ym}.zip"
    try:
        r = requests.get(url, timeout=30)
        if r.status_code != 200:
            return None
        with zipfile.ZipFile(io.BytesIO(r.content)) as z:
            raw = pd.read_csv(z.open(z.namelist()[0]), header=None)
    except Exception:  # noqa: BLE001
        return None
    if not str(raw.iloc[0, 0]).isdigit():   # cabecera opcional
        raw = raw.iloc[1:]
    t = raw[0].astype("int64")
    t = t.where(t < 1e14, t // 1000)        # desde 2025 los ficheros vienen en microsegundos
    df = pd.DataFrame({c: raw[i].astype(float) for i, c in enumerate(COLS, start=1)})
    df.index = pd.to_datetime(t.values, unit="ms", utc=True)
    return df


def fetch_binance_bulk(symbol: str, interval: str = "1h", years: float = 3.0,
                       cache_dir: str | None = "data_cache") -> pd.DataFrame:
    """Histórico largo vía ficheros mensuales (rápido) + API para el mes en curso."""
    from concurrent.futures import ThreadPoolExecutor
    sym = binance_symbol(symbol)
    cache = Path(cache_dir) / f"binance_{sym}_{interval}.csv" if cache_dir else None
    now = pd.Timestamp.now(tz="UTC")
    if cache is not None and cache.exists():
        df = pd.read_csv(cache, index_col=0)
        df.index = pd.to_datetime(df.index, utc=True)
        if df.index[0] <= now - pd.Timedelta(days=int(years * 365) - 40):
            # sólo actualizar la cola por la API
            tail = fetch_binance(symbol, interval, years=(now - df.index[-1]).days / 365 + 0.01,
                                 cache_dir=None)
            df = pd.concat([df, tail])
            df = df[~df.index.duplicated(keep="last")].sort_index()
            df.to_csv(cache)
            return df[df.index >= now - pd.Timedelta(days=int(years * 365))]
    months = pd.period_range((now - pd.Timedelta(days=int(years * 365))).tz_localize(None).to_period("M"),
                             now.tz_localize(None).to_period("M") - 1, freq="M")
    with ThreadPoolExecutor(12) as ex:
        parts = [p for p in ex.map(lambda m: _binance_month(sym, interval, str(m)), months) if p is not None]
    hist = pd.concat(parts) if parts else pd.DataFrame(columns=COLS)
    start_ms = int((hist.index[-1].timestamp() if len(hist) else (now - pd.Timedelta(days=40)).timestamp()) * 1000)
    tail = fetch_binance(symbol, interval, years=(now.timestamp() * 1000 - start_ms) / 86_400_000 / 365 + 0.001,
                         cache_dir=None)
    df = pd.concat([hist, tail])
    df = df[~df.index.duplicated(keep="last")].sort_index()
    if cache is not None and len(df):
        cache.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(cache)
    return df


def fetch_yahoo_batch(symbols: list[str], interval: str = "1h", period: str = "730d",
                      cache_dir: str | None = "data_cache", chunk: int = 25) -> dict[str, pd.DataFrame]:
    """Descarga por lotes de Yahoo (acciones, ETF, forex, futuros)."""
    import yfinance as yf
    out: dict[str, pd.DataFrame] = {}
    for i in range(0, len(symbols), chunk):
        part = symbols[i:i + chunk]
        try:
            raw = yf.download(part, interval=interval, period=period, auto_adjust=True,
                              progress=False, group_by="ticker", threads=True)
        except Exception as e:  # noqa: BLE001
            log.warning("Yahoo lote %s: %s", part, e)
            continue
        for s in part:
            try:
                sub = raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw
                df = _normalize(sub)
                df.index = pd.to_datetime(df.index, utc=True)
                if len(df) > 200:
                    out[s] = df
                    if cache_dir:
                        Path(cache_dir).mkdir(parents=True, exist_ok=True)
                        df.to_csv(Path(cache_dir) / f"yahoo_{s.replace('=', '_').replace('^', '')}_{interval}.csv")
            except Exception:  # noqa: BLE001
                log.warning("Sin datos de Yahoo para %s", s)
    return out


def fetch_universe(symbols: list[str], interval: str = "1h", years: float = 3.0,
                   cache_dir: str | None = "data_cache") -> dict[str, pd.DataFrame]:
    from concurrent.futures import ThreadPoolExecutor
    from .config import asset_class
    crypto = [s for s in symbols if asset_class(s) == "crypto"]
    other = [s for s in symbols if asset_class(s) != "crypto"]
    out: dict[str, pd.DataFrame] = {}
    with ThreadPoolExecutor(4) as ex:
        for s, df in zip(crypto, ex.map(lambda s: fetch_binance_bulk(s, interval, years, cache_dir), crypto)):
            if len(df) > 500:
                out[s] = df
    if other:
        out.update(fetch_yahoo_batch(other, interval, "730d" if interval in ("1h", "60m") else "60d", cache_dir))
    return out
