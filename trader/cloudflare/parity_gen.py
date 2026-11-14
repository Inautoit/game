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
