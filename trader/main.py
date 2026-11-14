#!/usr/bin/env python3
"""Máquina de trading autónoma.

  python main.py scan                 # ¿dónde está la oportunidad ahora mismo?
  python main.py backtest             # simula la configuración actual sobre el histórico
  python main.py walkforward          # validación honesta: optimiza en el pasado, prueba en lo no visto
  python main.py paper                # opera sola con dinero SIMULADO y precios reales, 24/7
  python main.py live                 # opera con dinero REAL (requiere mode: live y TRADER_LIVE=SI)
  añade --synthetic a backtest/walkforward para probar sin conexión (datos inventados).
"""
import argparse
import logging
import os
import sys

import yaml

from bot import data as D, strategies as S
from bot.backtest import CostConfig, run_backtest, walk_forward
from bot.risk import RiskConfig
from bot.notify import Notifier

PCT = {"retorno_total", "retorno_anual", "volatilidad_anual", "max_drawdown", "aciertos", "ganancia_media_op",
       "comprar_y_mantener", "tiempo_invertido"}


def show(m: dict):
    for k, v in m.items():
        if k.startswith("_"):
            continue
        if isinstance(v, float) and k in PCT:
            print(f"  {k:22s} {v:+.2%}")
        elif isinstance(v, float):
            print(f"  {k:22s} {v:.2f}")
        else:
            print(f"  {k:22s} {v}")


def load_data(cfg, synthetic):
    if synthetic:
        print("⚠️  DATOS SINTÉTICOS: sirven para probar que todo funciona, no para saber si gana dinero.")
        return D.synthetic(n_symbols=8, bars=24 * cfg["backtest"]["days"])
    bt = cfg["backtest"]
    ex = None if bt.get("source") == "binance_vision" else D.make_exchange(cfg["exchange"])
    out = {}
    for s in bt["symbols"]:
        try:
            out[s] = (D.fetch_binance_vision(s, cfg["timeframe"], bt["days"]) if ex is None
                      else D.fetch_ohlcv(ex, s, cfg["timeframe"], bt["days"]))
            print(f"  {s}: {len(out[s])} velas")
        except Exception as e:
            print(f"  {s}: omitido ({e})")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("cmd", choices=["scan", "backtest", "walkforward", "paper", "live"])
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--synthetic", action="store_true")
    a = ap.parse_args()
    cfg = yaml.safe_load(open(a.config))
    os.makedirs("logs", exist_ok=True)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s",
                        handlers=[logging.StreamHandler(), logging.FileHandler("logs/trader.log")])
    risk_cfg = RiskConfig(**cfg["risk"])
    costs = CostConfig(**cfg["costs"])

    if a.cmd in ("backtest", "walkforward"):
        data = load_data(cfg, a.synthetic)
        if a.cmd == "backtest":
            r = run_backtest(data, S.build(cfg["strategies"]), risk_cfg, costs, 10_000, cfg["top_n"])
            print("\n=== BACKTEST (parámetros fijos; ojo: puede estar sobreajustado) ===")
            show(r.metrics)
            if len(r.trades):
                print("\nPor estrategia:\n", r.trades.groupby("strategy").pnl.agg(["count", "sum", "mean"]).round(2))
        else:
            bph = {"1h": 24, "4h": 6, "15m": 96, "30m": 48, "5m": 288, "1d": 1}[cfg["timeframe"]]
            print("\n=== WALK-FORWARD (solo cuenta el periodo que el modelo NO había visto) ===")
            r = walk_forward(data, list(cfg["strategies"]), risk_cfg, costs, 10_000, cfg["top_n"],
                             cfg["backtest"]["train_days"] * bph, cfg["backtest"]["test_days"] * bph)
            print("\nResultado fuera de muestra:")
            show(r["metrics"])
        return

    ex = D.make_exchange(cfg["exchange"],
                         os.getenv("EXCHANGE_API_KEY") if a.cmd == "live" else None,
                         os.getenv("EXCHANGE_SECRET") if a.cmd == "live" else None)
    if a.cmd == "scan":
        from bot.scanner import pick_universe, score_series
        uni = pick_universe(ex, cfg["quote"], cfg["universe_size"], cfg.get("exclude", []))
        rows = []
        for s in uni:
            df = D.closed_candles(D.to_df(ex.fetch_ohlcv(s, cfg["timeframe"], limit=400)), cfg["timeframe"],
                                  ex.milliseconds())
            sigs = {st.name: bool(st.generate(df)["entry"].iloc[-1]) for st in S.build(cfg["strategies"])}
            rows.append((score_series(df).iloc[-1], s, [k for k, v in sigs.items() if v]))
        rows.sort(key=lambda r: -r[0] if r[0] == r[0] and r[0] != float("-inf") else float("inf"))
        print(f"\n{'mercado':14s} {'puntuación':>10s}  señal de compra ahora")
        for sc, s, sg in rows:
            print(f"{s:14s} {sc:10.2f}  {', '.join(sg) or '-'}")
        return

    from bot.broker import LiveBroker, PaperBroker
    from bot.engine import Engine
    cfg["mode"] = "live" if a.cmd == "live" else "paper"
    if a.cmd == "live":
        if yaml.safe_load(open(a.config)).get("mode") != "live":
            sys.exit("Para dinero real pon mode: live en config.yaml (y exporta TRADER_LIVE=SI).")
        broker = LiveBroker(ex, cfg["quote"], cfg["live_max_capital"], costs.fee)
    else:
        broker = PaperBroker(ex, cfg["paper_capital"], costs.fee, costs.slippage)
    Engine(cfg, ex, broker, S.build(cfg["strategies"]), risk_cfg, Notifier()).run()


if __name__ == "__main__":
    main()
