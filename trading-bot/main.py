"""CLI del bot.

  python main.py backtest            # backtest con datos reales del universo de config.yaml
  python main.py backtest --demo     # backtest con datos sintéticos (sin internet)
  python main.py compare             # compara todas las estrategias
  python main.py paper               # paper trading en vivo (Ctrl+C para parar)
  python main.py scan                # señales actuales de cada activo
"""
from __future__ import annotations

import argparse
import copy
import json
import logging

import pandas as pd

from bot.backtest import Backtester
from bot.config import load_config
from bot.data import fetch_many, synthetic
from bot.strategies import STRATEGIES, generate_signals


def load_data(cfg, demo):
    if demo:
        return {"DEMO1": synthetic(4000, seed=1), "DEMO2": synthetic(4000, seed=7),
                "DEMO-USD": synthetic(4000, seed=11, session=False)}
    d = cfg["data"]
    return fetch_many(cfg["universe"], interval=d["interval"], period=d["period"],
                      cache_dir=d.get("cache_dir"))


def cmd_backtest(cfg, args):
    data = load_data(cfg, args.demo)
    res = Backtester(cfg).run(data)
    print(f"\n== Backtest: estrategia '{cfg['strategy']['name']}' sobre {len(data)} activos ==")
    for k, v in res["metrics"].items():
        print(f"  {k:28s} {v}")
    if len(res["trades"]):
        print("\nPnL por activo:")
        print(res["trades"].groupby("symbol").pnl.agg(["count", "sum"]).round(2).to_string())
        print("\nMotivos de salida:")
        print(res["trades"].reason.value_counts().to_string())
    print("\nComprar y mantener (referencia):",
          {k: f"{v:+.1%}" for k, v in res["buy_and_hold"].items()})
    for e in res["risk_events"][:10]:
        print("  [riesgo]", e)
    res["trades"].to_csv("backtest_trades.csv", index=False)
    res["equity"].to_csv("backtest_equity.csv")
    export_web(res, cfg, "web/backtest.json")
    print("\nGuardado: backtest_trades.csv, backtest_equity.csv, web/backtest.json")


def build_web_bundle():
    """web/model.js = modelo + resultados de validación (lo carga web/index.html sin servidor)."""
    from pathlib import Path
    model = Path("web/model.json").read_text()
    bt = Path("web/backtest_ml.json").read_text() if Path("web/backtest_ml.json").exists() else "null"
    Path("web/model.js").write_text(f"window.MODEL={model};\nwindow.BACKTEST={bt};\n")


def export_web(res, cfg, path, extra=None):
    """Exporta resultados para el panel web."""
    from pathlib import Path
    Path(path).parent.mkdir(exist_ok=True)
    eq = res["equity"]["equity"]
    step = max(1, len(eq) // 1500)
    tr = res["trades"].copy()
    for c in ("entry_time", "exit_time"):
        if c in tr:
            tr[c] = tr[c].astype(str)
    Path(path).write_text(json.dumps({
        "strategy": cfg["strategy"]["name"], "metrics": res["metrics"],
        "equity": [[str(t), round(v, 2)] for t, v in eq.iloc[::step].items()],
        "trades": tr.round(4).to_dict("records"), "buy_and_hold": res["buy_and_hold"],
        **(extra or {}),
    }, default=str))


def cmd_compare(cfg, args):
    data = load_data(cfg, args.demo)
    rows = []
    for name in STRATEGIES:
        c = copy.deepcopy(cfg)
        c["strategy"]["name"] = name
        m = Backtester(c).run(data)["metrics"]
        rows.append({"estrategia": name, **m})
    print(pd.DataFrame(rows).set_index("estrategia").T.to_string())


def cmd_scan(cfg, args):
    data = load_data(cfg, args.demo)
    st = cfg["strategy"]
    for sym, df in data.items():
        s = generate_signals(df, st["name"], st.get("params", {})).iloc[-1]
        sig = {1: "COMPRA", -1: "VENTA", 0: "-"}[int(s["entry"])]
        print(f"{sym:10s} precio={s['close']:<12.4f} RSI={s['rsi']:5.1f} ADX={s['adx']:5.1f} "
              f"ATR={s['atr']:.4f}  señal: {sig}")


def ml_cfg(cfg):
    """Config de backtest para la estrategia ML (stops/TP alineados con las etiquetas)."""
    ml = cfg["ml"]
    c = copy.deepcopy(cfg)
    c["strategy"] = {"name": "ml", "params": {**cfg["strategy"].get("params", {}), "ml": ml}}
    c["risk"].update({"stop_atr_mult": ml["sl_atr"], "take_profit_atr_mult": ml["tp_atr"],
                      "trailing_atr_mult": 0, "max_holding_bars": ml["horizon"]})
    return c


def cmd_ml_train(cfg, args):
    """Descarga 3 años, valida walk-forward, hace backtest fuera de muestra y entrena el modelo final."""
    from bot.data import fetch_binance
    from bot import ml as M
    mc = cfg["ml"]
    data = {}
    for s in mc["universe"]:
        df = fetch_binance(s, mc["interval"], mc["years"], cfg["data"].get("cache_dir"))
        if len(df) > 5000:
            data[s] = df
            print(f"{s}: {len(df)} velas {df.index[0]:%Y-%m-%d} → {df.index[-1]:%Y-%m-%d}")
    ds = M.build_dataset(data, mc, cfg["strategy"].get("params"))
    print(f"Dataset: {len(ds)} filas | tasa base ganadoras largo={ds.y_long.mean():.1%} "
          f"corto={ds.y_short.mean():.1%} | equilibrio sin costes={mc['sl_atr']/(mc['tp_atr']+mc['sl_atr']):.1%}")
    oos = M.walk_forward(ds, mc, mc["train_months"])
    ok = oos.dropna(subset=["p_long"])
    from sklearn.metrics import roc_auc_score
    auc_l = roc_auc_score(ok.y_long, ok.p_long)
    auc_s = roc_auc_score(ok.y_short, ok.p_short)
    print(f"AUC fuera de muestra: largo={auc_l:.3f} corto={auc_s:.3f} (0.5 = azar)")
    # Calibración: tasa real de acierto por tramo de probabilidad predicha
    ok = ok.assign(bucket=pd.cut(ok.p_long, [0, .2, .3, .35, .4, .45, .5, 1]))
    print("Calibración largos (prob. predicha → acierto real):")
    print(ok.groupby("bucket", observed=True).y_long.agg(["count", "mean"]).round(3).to_string())
    # Backtest SOLO con predicciones fuera de muestra
    test_start = ok.index.min()
    bt_data = {}
    for s, df in data.items():
        pr = oos[oos.symbol == s][["p_long", "p_short"]]
        bt_data[s] = df.join(pr).loc[test_start:]
    res = Backtester(ml_cfg(cfg)).run(bt_data)
    print(f"\n== Backtest ML fuera de muestra ({test_start:%Y-%m-%d} → hoy) ==")
    for k, v in res["metrics"].items():
        print(f"  {k:28s} {v}")
    if len(res["trades"]):
        print(res["trades"].groupby("symbol").pnl.agg(["count", "sum"]).round(2).to_string())
    print("Comprar y mantener:", {k: f"{v:+.1%}" for k, v in res["buy_and_hold"].items()})
    for e in res["risk_events"][:5]:
        print("  [riesgo]", e)
    export_web(res, ml_cfg(cfg), "web/backtest_ml.json",
               extra={"auc": f"{auc_l:.3f} / {auc_s:.3f}",
                      "period": f"{test_start:%m/%Y} – {res['equity'].index[-1]:%m/%Y}"})
    meta = M.fit_final(ds, mc, mc["model_path"], train_months=mc["train_months"])
    bundle = M.load_model(mc["model_path"])
    M.export_trees_json(bundle, "web/model.json")
    build_web_bundle()
    print("Modelo final guardado:", meta)


def cmd_paper(cfg, args):
    from bot.live import LiveTrader
    LiveTrader(cfg).run(once=args.once)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["backtest", "compare", "scan", "paper", "ml-train"])
    ap.add_argument("--config", default="config.yaml")
    ap.add_argument("--demo", action="store_true", help="usar datos sintéticos")
    ap.add_argument("--once", action="store_true", help="paper: un solo ciclo")
    a = ap.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    logging.getLogger("yfinance").setLevel(logging.CRITICAL)
    conf = load_config(a.config)
    {"backtest": cmd_backtest, "compare": cmd_compare, "scan": cmd_scan, "paper": cmd_paper, "ml-train": cmd_ml_train}[a.cmd](conf, a)
