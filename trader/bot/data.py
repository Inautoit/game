"""Datos de mercado: descarga velas (OHLCV) del exchange con ccxt y las guarda en caché.
También genera datos sintéticos para probar el sistema sin conexión."""
import os
import time
import numpy as np
import pandas as pd

TF_MS = {"1m": 60_000, "5m": 300_000, "15m": 900_000, "30m": 1_800_000, "1h": 3_600_000,
         "4h": 14_400_000, "1d": 86_400_000}


def make_exchange(exchange_id: str, api_key: str = None, secret: str = None, sandbox: bool = False):
    import ccxt
    opts = {"apiKey": api_key, "secret": secret, "enableRateLimit": True}
    if os.getenv("HTTPS_PROXY"):  # ccxt no usa el proxy del sistema por sí solo
        opts["httpsProxy"] = os.getenv("HTTPS_PROXY")
    ex = getattr(ccxt, exchange_id)(opts)
    if sandbox:
        ex.set_sandbox_mode(True)
    ex.load_markets()
    return ex


def to_df(rows) -> pd.DataFrame:
    df = pd.DataFrame(rows, columns=["ts", "open", "high", "low", "close", "volume"])
    df["ts"] = pd.to_datetime(df["ts"], unit="ms", utc=True)
    return df.drop_duplicates("ts").set_index("ts").sort_index().astype(float)


def fetch_ohlcv(exchange, symbol: str, timeframe: str = "1h", days: int = 365, cache_dir: str = "data") -> pd.DataFrame:
    """Descarga `days` días de velas con paginación y caché en CSV."""
    os.makedirs(cache_dir, exist_ok=True)
    path = os.path.join(cache_dir, f"{exchange.id}_{symbol.replace('/', '-')}_{timeframe}.csv")
    tf = TF_MS[timeframe]
    now = exchange.milliseconds()
    since = now - days * 86_400_000
    old = None
    if os.path.exists(path):
        old = pd.read_csv(path, index_col=0, parse_dates=True)
        if len(old):
            since = max(since, int(old.index[-1].timestamp() * 1000) + tf)
    rows = []
    while since < now - tf:
        batch = exchange.fetch_ohlcv(symbol, timeframe, since=since, limit=1000)
        if not batch:
            break
        rows += batch
        nxt = batch[-1][0] + tf
        if nxt <= since:
            break
        since = nxt
        time.sleep(exchange.rateLimit / 1000)
    df = to_df(rows) if rows else None
    if old is not None:
        df = pd.concat([old, df]) if df is not None else old
        df = df[~df.index.duplicated(keep="last")].sort_index()
    if df is None:
        raise ValueError(f"Sin datos para {symbol}")
    df = df[df.index >= pd.Timestamp(now - days * 86_400_000, unit="ms", tz="UTC")]
    df.to_csv(path)
    return df


def fetch_binance_vision(symbol: str, timeframe: str = "1h", days: int = 730, cache_dir: str = "data") -> pd.DataFrame:
    """Histórico largo gratuito: archivos mensuales públicos de Binance (data.binance.vision).
    Útil para backtest porque algunas APIs (p.ej. Kraken) solo devuelven las últimas 720 velas."""
    import io, zipfile, requests
    os.makedirs(cache_dir, exist_ok=True)
    pair = symbol.replace("/", "")
    end = pd.Timestamp.now(tz="UTC").normalize().replace(day=1)
    months = pd.date_range(end - pd.Timedelta(days=days), end, freq="MS", tz="UTC")[:-1] if days else []
    frames = []
    for m in months:
        path = os.path.join(cache_dir, f"bv_{pair}_{timeframe}_{m:%Y-%m}.csv")
        if not os.path.exists(path):
            url = f"https://data.binance.vision/data/spot/monthly/klines/{pair}/{timeframe}/{pair}-{timeframe}-{m:%Y-%m}.zip"
            r = requests.get(url, timeout=60)
            if r.status_code == 404:
                continue  # el par aún no existía
            r.raise_for_status()
            with zipfile.ZipFile(io.BytesIO(r.content)) as z:
                raw = pd.read_csv(z.open(z.namelist()[0]), header=None)
            if not str(raw.iloc[0, 0]).isdigit():
                raw = raw.iloc[1:].astype(float)
            raw = raw.iloc[:, :6]
            raw.columns = ["ts", "open", "high", "low", "close", "volume"]
            raw["ts"] = raw["ts"].astype("int64")
            raw.loc[raw.ts > 10**14, "ts"] //= 1000  # desde 2025 vienen en microsegundos
            raw.to_csv(path, index=False)
        frames.append(pd.read_csv(path))
    if not frames:
        raise ValueError(f"Sin histórico para {symbol}")
    return to_df(pd.concat(frames).values.tolist())


def closed_candles(df: pd.DataFrame, timeframe: str, now_ms: int) -> pd.DataFrame:
    """Quita la vela que aún se está formando (usar una vela sin cerrar = mirar al futuro)."""
    tf = TF_MS[timeframe]
    cutoff = pd.Timestamp(now_ms - tf, unit="ms", tz="UTC")
    return df[df.index <= cutoff]


def synthetic(n_symbols: int = 8, bars: int = 24 * 365, seed: int = 0, start="2025-01-01") -> dict:
    """Mercado sintético con regímenes (tendencia alcista/bajista/lateral) y un factor común.
    SOLO para probar que el sistema funciona: sus resultados NO dicen nada del mercado real."""
    rng = np.random.default_rng(seed)
    idx = pd.date_range(start, periods=bars, freq="h", tz="UTC")
    regime_len = 24 * 20
    drifts = rng.choice([-0.00012, 0.0, 0.00014], size=bars // regime_len + 1)
    market = np.repeat(drifts, regime_len)[:bars] + rng.normal(0, 0.006, bars)
    out = {}
    for k in range(n_symbols):
        beta = rng.uniform(0.7, 1.5)
        own = np.repeat(rng.normal(0, 0.0003, bars // regime_len + 1), regime_len)[:bars]
        r = beta * market + own + rng.normal(0, 0.008, bars)
        close = 100 * np.exp(np.cumsum(r))
        open_ = np.r_[close[0], close[:-1]] * (1 + rng.normal(0, 0.0005, bars))
        spread = np.abs(rng.normal(0, 0.006, bars))
        high = np.maximum(open_, close) * (1 + spread)
        low = np.minimum(open_, close) * (1 - spread)
        vol = rng.lognormal(10, 0.5, bars) * (1 + 20 * np.abs(r))
        out[f"SYN{k}/USDT"] = pd.DataFrame({"open": open_, "high": high, "low": low, "close": close,
                                            "volume": vol}, index=idx)
    return out
