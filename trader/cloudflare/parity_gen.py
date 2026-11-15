"""Genera casos de prueba con la versión Python (la validada) para comparar con lib.js."""
import json, sys, os
import numpy as np
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
os.chdir(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from bot import data as D, strategies as S
from bot.scanner import score_series

cases = []
rng = np.random.default_rng(0)
for sym in ["BTC/USDT", "SOL/USDT", "DOGE/USDT", "LINK/USDT"]:
    df = D.fetch_binance_vision(sym, "4h", 1095)
    ends = list(rng.integers(400, len(df), 40))
    tr = S.TrendFollow({"fast": 20, "slow": 50, "adx_min": 22, "atr_mult": 3.0})
    br = S.Breakout({"n": 24, "vol_mult": 1.5, "atr_mult": 2.5})
    # incluir velas con señal de entrada para probar ambos caminos
    sig_t, sig_b = tr.generate(df), br.generate(df)
    ends += list(np.flatnonzero(sig_t.entry.to_numpy())[-10:] + 1) + list(np.flatnonzero(sig_b.entry.to_numpy())[-10:] + 1)
    for e in ends:
        w = df.iloc[e - 400:e]
        if len(w) < 400:
            continue
        out = {"sym": sym, "o": w.open.tolist(), "h": w.high.tolist(), "l": w.low.tolist(), "c": w.close.tolist(),
               "v": w.volume.tolist(), "score": float(score_series(w).iloc[-1])}
        for name, st in (("trend", tr), ("breakout", br)):
            r = st.generate(w).iloc[-1]
            out[name] = {k: (bool(r[k]) if k in ("entry", "exit") else float(r[k])) for k in ("entry", "exit", "stop", "trail", "strength")}
        cases.append(out)
# casos de pares (velas de 1 h)
from bot.pairs import zscore
pc = []
h1 = {s: D.fetch_binance_vision(s, "1h", 1095)["close"] for s in ["BTC/USDT", "ETH/USDT", "SOL/USDT", "DOGE/USDT"]}
import pandas as pd
closes = pd.DataFrame(h1).dropna()
for e in rng.integers(400, len(closes), 30):
    w = closes.iloc[e - 400:e]
    for A, B in (("BTC/USDT", "ETH/USDT"), ("SOL/USDT", "DOGE/USDT"), ("ETH/USDT", "SOL/USDT")):
        r = np.log(w).diff()
        pc.append({"a": w[A].tolist(), "b": w[B].tolist(), "z": float(zscore(w[A], w[B], 168).iloc[-1]),
                   "corr": float(r[A].rolling(200).corr(r[B]).iloc[-1])})
json.dump(pc, open(os.path.join("cloudflare", "parity_pairs.json"), "w"))
print(len(pc), "casos de pares")

def clean(x):
    if isinstance(x, float):
        return None if x != x else ("-inf" if x == float("-inf") else x)
    if isinstance(x, dict):
        return {k: clean(v) for k, v in x.items()}
    if isinstance(x, list):
        return [clean(v) for v in x]
    return x
json.dump(clean(cases), open(os.path.join("cloudflare", "parity_cases.json"), "w"))
print(len(cases), "casos;", sum(c["trend"]["entry"] for c in cases), "entradas trend;", sum(c["breakout"]["entry"] for c in cases), "entradas breakout")
