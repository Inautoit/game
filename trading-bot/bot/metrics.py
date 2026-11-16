from __future__ import annotations

import numpy as np
import pandas as pd


def summarize(equity: pd.Series, trades: pd.DataFrame, initial: float) -> dict:
    if equity.empty:
        return {}
    daily = equity.resample("1D").last().dropna()
    rets = daily.pct_change().dropna()
    sharpe = float(np.sqrt(252) * rets.mean() / rets.std()) if len(rets) > 2 and rets.std() > 0 else 0.0
    dd = equity / equity.cummax() - 1
    m = {
        "capital_final": round(float(equity.iloc[-1]), 2),
        "rentabilidad_total_%": round(100 * (equity.iloc[-1] / initial - 1), 2),
        "max_drawdown_%": round(100 * float(dd.min()), 2),
        "sharpe_diario": round(sharpe, 2),
        "num_operaciones": int(len(trades)),
    }
    if len(trades):
        wins = trades[trades.pnl > 0]
        losses = trades[trades.pnl <= 0]
        gp, gl = wins.pnl.sum(), -losses.pnl.sum()
        m.update({
            "tasa_acierto_%": round(100 * len(wins) / len(trades), 1),
            "profit_factor": round(gp / gl, 2) if gl > 0 else float("inf"),
            "ganancia_media": round(float(wins.pnl.mean()), 2) if len(wins) else 0.0,
            "perdida_media": round(float(losses.pnl.mean()), 2) if len(losses) else 0.0,
            "esperanza_por_operacion": round(float(trades.pnl.mean()), 2),
            "velas_medias_en_posicion": round(float(trades.bars_held.mean()), 1),
        })
    return m
