"""Indicadores técnicos. Todos son causales: el valor en t solo usa datos <= t."""
from __future__ import annotations

import numpy as np
import pandas as pd


def ema(s: pd.Series, n: int) -> pd.Series:
    return s.ewm(span=n, adjust=False, min_periods=n).mean()


def sma(s: pd.Series, n: int) -> pd.Series:
    return s.rolling(n, min_periods=n).mean()


def rsi(close: pd.Series, n: int = 14) -> pd.Series:
    d = close.diff()
    up = d.clip(lower=0).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    dn = (-d.clip(upper=0)).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    rs = up / dn.replace(0, np.nan)
    out = 100 - 100 / (1 + rs)
    return out.where(dn != 0, 100.0)


def true_range(df: pd.DataFrame) -> pd.Series:
    pc = df["close"].shift()
    return pd.concat([df["high"] - df["low"], (df["high"] - pc).abs(), (df["low"] - pc).abs()],
                     axis=1).max(axis=1)


def atr(df: pd.DataFrame, n: int = 14) -> pd.Series:
    return true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def bollinger(close: pd.Series, n: int = 20, k: float = 2.0):
    mid = sma(close, n)
    sd = close.rolling(n, min_periods=n).std()
    return mid - k * sd, mid, mid + k * sd


def macd(close: pd.Series, fast=12, slow=26, signal=9):
    line = ema(close, fast) - ema(close, slow)
    sig = ema(line, signal)
    return line, sig, line - sig


def adx(df: pd.DataFrame, n: int = 14) -> pd.Series:
    up = df["high"].diff()
    dn = -df["low"].diff()
    plus_dm = np.where((up > dn) & (up > 0), up, 0.0)
    minus_dm = np.where((dn > up) & (dn > 0), dn, 0.0)
    tr = true_range(df).ewm(alpha=1 / n, adjust=False, min_periods=n).mean()
    pdi = 100 * pd.Series(plus_dm, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / tr
    mdi = 100 * pd.Series(minus_dm, index=df.index).ewm(alpha=1 / n, adjust=False, min_periods=n).mean() / tr
    dx = 100 * (pdi - mdi).abs() / (pdi + mdi).replace(0, np.nan)
    return dx.ewm(alpha=1 / n, adjust=False, min_periods=n).mean()


def session_dates(index: pd.DatetimeIndex) -> pd.Index:
    """Fecha de sesión en hora de Nueva York (sirve para reset de VWAP y cierre diario)."""
    idx = index if index.tz is not None else index.tz_localize("UTC")
    return idx.tz_convert("America/New_York").date


def vwap(df: pd.DataFrame) -> pd.Series:
    """VWAP intradía que se reinicia cada sesión. Si no hay volumen usa precio típico medio."""
    tp = (df["high"] + df["low"] + df["close"]) / 3
    vol = df["volume"] if df["volume"].sum() > 0 else pd.Series(1.0, index=df.index)
    day = pd.Series(session_dates(df.index), index=df.index)
    pv = (tp * vol).groupby(day).cumsum()
    vv = vol.groupby(day).cumsum()
    return pv / vv.replace(0, np.nan)


def add_all(df: pd.DataFrame, p: dict) -> pd.DataFrame:
    out = df.copy()
    c = out["close"]
    out["ema_fast"] = ema(c, p.get("ema_fast", 9))
    out["ema_slow"] = ema(c, p.get("ema_slow", 21))
    out["ema_trend"] = ema(c, p.get("ema_trend", 100))
    out["rsi"] = rsi(c, p.get("rsi_period", 14))
    out["atr"] = atr(out, p.get("atr_period", 14))
    out["bb_low"], out["bb_mid"], out["bb_up"] = bollinger(c, p.get("bb_period", 20), p.get("bb_std", 2.0))
    _, _, out["macd_hist"] = macd(c)
    out["adx"] = adx(out, p.get("adx_period", 14))
    out["vwap"] = vwap(out)
    n = p.get("breakout_lookback", 20)
    out["hh"] = out["high"].rolling(n, min_periods=n).max().shift(1)
    out["ll"] = out["low"].rolling(n, min_periods=n).min().shift(1)
    vol_avg = out["volume"].rolling(20, min_periods=20).mean().shift(1)
    out["vol_ratio"] = (out["volume"] / vol_avg.replace(0, np.nan)).fillna(1.0)
    return out
