"""Estrategias intradía. Cada una devuelve columnas:
   entry      : 1 (comprar), -1 (vender en corto), 0 (nada) — evaluado al cierre de la vela
   exit_long  : True si conviene cerrar un largo
   exit_short : True si conviene cerrar un corto
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .indicators import add_all


def _has_volume(d: pd.DataFrame) -> bool:
    return d["volume"].sum() > 0


def trend(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Seguimiento de tendencia: cruce de EMAs confirmado por ADX, VWAP y MACD."""
    adx_ok = d["adx"] > p.get("adx_trend", 20)
    cross_up = (d["ema_fast"] > d["ema_slow"]) & (d["ema_fast"].shift() <= d["ema_slow"].shift())
    cross_dn = (d["ema_fast"] < d["ema_slow"]) & (d["ema_fast"].shift() >= d["ema_slow"].shift())
    long_ = cross_up & adx_ok & (d["close"] > d["vwap"]) & (d["macd_hist"] > 0)
    short = cross_dn & adx_ok & (d["close"] < d["vwap"]) & (d["macd_hist"] < 0)
    return pd.DataFrame({
        "entry": np.where(long_, 1, np.where(short, -1, 0)),
        "exit_long": d["ema_fast"] < d["ema_slow"],
        "exit_short": d["ema_fast"] > d["ema_slow"],
    }, index=d.index)


def mean_reversion(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Reversión a la media en mercado lateral: RSI extremo + fuera de Bollinger + ADX bajo."""
    ranging = d["adx"] < p.get("adx_trend", 20)
    long_ = ranging & (d["rsi"] < p.get("rsi_low", 30)) & (d["close"] < d["bb_low"])
    short = ranging & (d["rsi"] > p.get("rsi_high", 70)) & (d["close"] > d["bb_up"])
    return pd.DataFrame({
        "entry": np.where(long_, 1, np.where(short, -1, 0)),
        "exit_long": d["close"] >= d["bb_mid"],
        "exit_short": d["close"] <= d["bb_mid"],
    }, index=d.index)


def breakout(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Ruptura de máximos/mínimos de N velas con volumen alto."""
    vol_ok = d["vol_ratio"] > p.get("volume_mult", 1.5) if _has_volume(d) else True
    long_ = (d["close"] > d["hh"]) & vol_ok & (d["close"] > d["ema_trend"])
    short = (d["close"] < d["ll"]) & vol_ok & (d["close"] < d["ema_trend"])
    return pd.DataFrame({
        "entry": np.where(long_, 1, np.where(short, -1, 0)),
        "exit_long": d["close"] < d["ema_slow"],
        "exit_short": d["close"] > d["ema_slow"],
    }, index=d.index)


BASE = {"trend": trend, "mean_reversion": mean_reversion, "breakout": breakout}


def ensemble(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Votación ponderada. Cada estrategia solo actúa en su régimen, así que se complementan."""
    w = p.get("weights", {k: 1.0 for k in BASE})
    total = sum(w.values()) or 1.0
    thr = p.get("ensemble_threshold", 0.5)
    parts = {k: f(d, p) for k, f in BASE.items() if w.get(k, 0) > 0}
    score = sum(parts[k]["entry"] * w[k] for k in parts)
    # Normalizamos contra el peso máximo individual: una señal fuerte de una estrategia basta
    norm = score / max(w.values())
    entry = np.where(norm >= thr, 1, np.where(norm <= -thr, -1, 0))
    exit_long = sum(parts[k]["exit_long"].astype(float) * w[k] for k in parts) / total >= 0.5
    exit_short = sum(parts[k]["exit_short"].astype(float) * w[k] for k in parts) / total >= 0.5
    return pd.DataFrame({"entry": entry, "exit_long": exit_long | (entry == -1),
                         "exit_short": exit_short | (entry == 1), "score": norm}, index=d.index)


def ml_strategy(d: pd.DataFrame, p: dict) -> pd.DataFrame:
    """Opera cuando el modelo ML estima probabilidad de éxito > equilibrio + margen.
    Requiere columnas p_long / p_short (walk-forward o modelo cargado)."""
    if "p_long" not in d:
        raise ValueError("La estrategia 'ml' necesita predicciones: usa `python main.py ml-train`")
    m = p.get("ml", {})
    tp, sl = m.get("tp_atr", 2.0), m.get("sl_atr", 1.0)
    cost = p.get("_cost_frac", 0.002)            # coste ida+vuelta como fracción del precio
    atr_pct = (d["atr"] / d["close"]).clip(lower=1e-6)
    p_be = (sl + cost / atr_pct) / (tp + sl)        # probabilidad de equilibrio por vela
    edge = m.get("min_edge", 0.05)
    pl, ps = d["p_long"].fillna(0), d["p_short"].fillna(0)
    long_ = (pl > p_be + edge) & (pl >= ps)
    short = (ps > p_be + edge) & (ps > pl)
    return pd.DataFrame({
        "entry": np.where(long_, 1, np.where(short, -1, 0)),
        "exit_long": short, "exit_short": long_, "score": pl - ps,
    }, index=d.index)


STRATEGIES = {**BASE, "ensemble": ensemble, "ml": ml_strategy}


def generate_signals(df: pd.DataFrame, name: str, params: dict) -> pd.DataFrame:
    if name not in STRATEGIES:
        raise ValueError(f"Estrategia desconocida: {name}. Opciones: {list(STRATEGIES)}")
    d = add_all(df, params)
    sig = STRATEGIES[name](d, params)
    out = d.join(sig)
    warm = out[["atr", "adx", "ema_slow", "bb_mid"]].isna().any(axis=1)
    out.loc[warm, "entry"] = 0
    out["entry"] = out["entry"].astype(int)
    return out
