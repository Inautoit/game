"""Modelo de machine learning que aprende del histórico y de sus propias operaciones.

Idea (método "triple barrera", López de Prado):
  Para cada vela t simulamos entrar al cierre con stop = SL·ATR y objetivo = TP·ATR.
  Etiqueta long = 1 si el precio toca el objetivo ANTES que el stop en las próximas H velas.
  (Igual para cortos.) El modelo aprende P(ganar | situación del mercado en t).

Se opera sólo cuando la probabilidad estimada supera el punto de equilibrio:
  p* = (SL + costes) / (TP + SL)   → esperanza matemática positiva.

Validación walk-forward con purga: el modelo sólo se evalúa en meses que NO ha visto,
entrenando siempre con datos anteriores y dejando un hueco de H velas para no filtrar
información del futuro. Ésta es la única cifra honesta de rendimiento.
"""
from __future__ import annotations

import json
import logging
import pickle
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.ensemble import HistGradientBoostingClassifier

from .indicators import add_all

log = logging.getLogger(__name__)

FEATURES = [
    "ret_1", "ret_3", "ret_6", "ret_12", "ret_24", "ret_48", "ret_96",
    "atr_pct", "atr_ratio", "rv_24", "rsi", "adx", "bb_pos", "bb_width",
    "d_ema_fast", "d_ema_slow", "d_ema_trend", "ema_slope", "macd_n", "vol_ratio",
    "range_pos", "d_vwap", "hour_sin", "hour_cos", "dow", "body", "upper_wick", "lower_wick",
    "is_crypto", "is_stock", "is_forex", "is_future",
]


def make_features(df: pd.DataFrame, p: dict | None = None, symbol: str = "") -> pd.DataFrame:
    """Variables independientes de la escala de precio (sirven para cualquier activo)."""
    from .config import asset_class
    p = p or {}
    d = add_all(df, p)
    c = d["close"]
    lr = np.log(c).diff()
    a = d["atr"] / c
    f = pd.DataFrame(index=d.index)
    for k in (1, 3, 6, 12, 24, 48, 96):
        f[f"ret_{k}"] = np.log(c / c.shift(k)) / a  # retornos medidos en "ATRs"
    f["atr_pct"] = a
    f["atr_ratio"] = d["atr"] / d["atr"].rolling(96, min_periods=96).mean()
    f["rv_24"] = lr.rolling(24, min_periods=24).std() / a
    f["rsi"] = d["rsi"] / 100
    f["adx"] = d["adx"] / 100
    f["bb_pos"] = (c - d["bb_mid"]) / (d["bb_up"] - d["bb_low"])
    f["bb_width"] = (d["bb_up"] - d["bb_low"]) / c / a
    f["d_ema_fast"] = (c / d["ema_fast"] - 1) / a
    f["d_ema_slow"] = (c / d["ema_slow"] - 1) / a
    f["d_ema_trend"] = (c / d["ema_trend"] - 1) / a
    f["ema_slope"] = (d["ema_slow"] / d["ema_slow"].shift(5) - 1) / a
    f["macd_n"] = d["macd_hist"] / c / a
    f["vol_ratio"] = np.log1p(d["vol_ratio"].clip(0, 50))
    f["range_pos"] = (c - d["ll"]) / (d["hh"] - d["ll"])
    f["d_vwap"] = (c / d["vwap"] - 1) / a
    hour = d.index.hour + d.index.minute / 60
    f["hour_sin"] = np.sin(2 * np.pi * hour / 24)
    f["hour_cos"] = np.cos(2 * np.pi * hour / 24)
    f["dow"] = d.index.dayofweek / 6
    rng = (d["high"] - d["low"]).replace(0, np.nan)
    f["body"] = (c - d["open"]) / rng
    f["upper_wick"] = (d["high"] - np.maximum(c, d["open"])) / rng
    f["lower_wick"] = (np.minimum(c, d["open"]) - d["low"]) / rng
    cls = asset_class(symbol) if symbol else "crypto"
    for k in ("crypto", "stock", "forex", "future"):
        f[f"is_{k}"] = float(cls == k)
    f = f.replace([np.inf, -np.inf], np.nan)
    f["atr"] = d["atr"]
    return f


def triple_barrier(df: pd.DataFrame, atr_s: pd.Series, tp: float, sl: float, horizon: int):
    """Devuelve (label_long, label_short) ∈ {0,1}. Empate en la misma vela = cuenta como stop."""
    c = df["close"].to_numpy()
    h = df["high"].to_numpy()
    lo = df["low"].to_numpy()
    a = atr_s.to_numpy()
    n = len(c)
    res_l = np.full(n, np.nan)
    res_s = np.full(n, np.nan)
    done_l = np.zeros(n, bool)
    done_s = np.zeros(n, bool)
    up_l, dn_l = c + tp * a, c - sl * a      # largo
    dn_s, up_s = c - tp * a, c + sl * a      # corto
    for k in range(1, horizon + 1):
        hh = np.full(n, np.nan); ll = np.full(n, np.nan)
        hh[:n - k] = h[k:]; ll[:n - k] = lo[k:]
        stop_l = (~done_l) & (ll <= dn_l)
        win_l = (~done_l) & ~stop_l & (hh >= up_l)
        res_l[stop_l] = 0; res_l[win_l] = 1; done_l |= stop_l | win_l
        stop_s = (~done_s) & (hh >= up_s)
        win_s = (~done_s) & ~stop_s & (ll <= dn_s)
        res_s[stop_s] = 0; res_s[win_s] = 1; done_s |= stop_s | win_s
    valid = np.arange(n) < n - horizon       # al final no hay futuro suficiente
    res_l[~done_l & valid] = 0                # tiempo agotado = no ganó
    res_s[~done_s & valid] = 0
    res_l[~valid & ~done_l] = np.nan
    res_s[~valid & ~done_s] = np.nan
    return pd.Series(res_l, df.index), pd.Series(res_s, df.index)


def build_dataset(data: dict[str, pd.DataFrame], ml: dict, params: dict | None = None) -> pd.DataFrame:
    parts = []
    for sym, df in data.items():
        f = make_features(df, params, sym)
        yl, ys = triple_barrier(df, f["atr"], ml["tp_atr"], ml["sl_atr"], ml["horizon"])
        f["y_long"], f["y_short"], f["symbol"] = yl, ys, sym
        parts.append(f.dropna(subset=FEATURES + ["y_long", "y_short"]))
    return pd.concat(parts).sort_index()


def new_model(seed: int = 0) -> HistGradientBoostingClassifier:
    # Modelo deliberadamente "humilde": pocas hojas, muchas muestras por hoja, regularizado.
    return HistGradientBoostingClassifier(max_iter=300, learning_rate=0.03, max_leaf_nodes=15,
                                          min_samples_leaf=500, l2_regularization=1.0,
                                          early_stopping=False, random_state=seed)


def breakeven_prob(ml: dict, cost_frac: float, atr_pct: float) -> float:
    cost_atr = cost_frac / max(atr_pct, 1e-9)
    return (ml["sl_atr"] + cost_atr) / (ml["tp_atr"] + ml["sl_atr"])


def walk_forward(ds: pd.DataFrame, ml: dict, train_months: int = 18, sample_weight=None) -> pd.DataFrame:
    """Predicciones fuera de muestra mes a mes. Devuelve ds con columnas p_long, p_short."""
    out = ds.copy()
    out["p_long"] = np.nan
    out["p_short"] = np.nan
    months = pd.period_range(ds.index.min().to_period("M"), ds.index.max().to_period("M"), freq="M")
    first_test = ml.get("min_train_months", 12)
    purge = pd.Timedelta(ml.get("purge", "2D"))
    step = ml.get("retrain_every_months", 1)
    for i, m in enumerate(months[first_test::step], start=first_test):
        t0 = m.start_time.tz_localize("UTC")
        t1 = (m + step).start_time.tz_localize("UTC")
        lo_t = (m - train_months).start_time.tz_localize("UTC")
        tr = ds[(ds.index >= lo_t) & (ds.index < t0 - purge)]
        te_mask = (ds.index >= t0) & (ds.index < t1)
        if te_mask.sum() == 0 or len(tr) < 5000:
            continue
        X, Xt = tr[FEATURES], ds.loc[te_mask, FEATURES]
        for side in ("long", "short"):
            mdl = new_model(i)
            mdl.fit(X, tr[f"y_{side}"].astype(int))
            out.loc[te_mask, f"p_{side}"] = mdl.predict_proba(Xt)[:, 1]
        log.info("walk-forward %s: entrenado con %d filas, test %d", m, len(tr), te_mask.sum())
    return out


def fit_final(ds: pd.DataFrame, ml: dict, path: str, journal: pd.DataFrame | None = None,
              train_months: int = 18) -> dict:
    """Entrena con los últimos meses + operaciones propias (con más peso) y guarda el modelo."""
    lo_t = ds.index.max() - pd.DateOffset(months=train_months)
    tr = ds[ds.index >= lo_t]
    # Más peso a lo reciente: decaimiento exponencial con vida media de 6 meses
    age_days = (tr.index.max() - tr.index).days.to_numpy()
    w = 0.5 ** (age_days / 180)
    X = tr[FEATURES]
    ys = {"long": tr["y_long"].astype(int), "short": tr["y_short"].astype(int)}
    if journal is not None and len(journal):
        j = journal.dropna(subset=FEATURES)
        for side, d in (("long", 1), ("short", -1)):
            js = j[j.direction == d]
            if len(js):
                X_side = pd.concat([X, js[FEATURES]])
                ys[side] = pd.concat([ys[side], (js.pnl > 0).astype(int)])
                ys[f"w_{side}"] = np.concatenate([w, np.full(len(js), 3.0)])
                ys[f"X_{side}"] = X_side
    models = {}
    for side in ("long", "short"):
        mdl = new_model()
        mdl.fit(ys.get(f"X_{side}", X), ys[side], sample_weight=ys.get(f"w_{side}", w))
        models[side] = mdl
    meta = {"features": FEATURES, "trained_until": str(ds.index.max()), "rows": int(len(tr)),
            "ml": ml, "own_trades": int(0 if journal is None else len(journal))}
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as fh:
        pickle.dump({"models": models, "meta": meta}, fh)
    return meta


def load_model(path: str):
    with open(path, "rb") as fh:
        return pickle.load(fh)


def predict(bundle, feats: pd.DataFrame) -> pd.DataFrame:
    X = feats[FEATURES]
    ok = X.notna().all(axis=1)
    out = pd.DataFrame({"p_long": np.nan, "p_short": np.nan}, index=feats.index)
    if ok.any():
        out.loc[ok, "p_long"] = bundle["models"]["long"].predict_proba(X[ok])[:, 1]
        out.loc[ok, "p_short"] = bundle["models"]["short"].predict_proba(X[ok])[:, 1]
    return out


def export_trees_json(bundle, path: str) -> None:
    """Exporta los árboles a JSON para ejecutar el modelo en el navegador (panel web)."""
    def dump(mdl):
        trees = []
        for it in mdl._predictors:
            nodes = it[0].nodes
            trees.append({k: nodes[k].tolist() for k in
                          ("value", "feature_idx", "num_threshold", "left", "right", "is_leaf",
                           "missing_go_to_left")})
        return {"baseline": float(np.ravel(mdl._baseline_prediction)[0]), "trees": trees}
    payload = {"meta": bundle["meta"], "long": dump(bundle["models"]["long"]),
               "short": dump(bundle["models"]["short"])}
    Path(path).write_text(json.dumps(payload, separators=(",", ":")))
