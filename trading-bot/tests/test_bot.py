import numpy as np
import pandas as pd
import pytest

from bot.backtest import Backtester
from bot.config import asset_class, load_config
from bot.data import synthetic
from bot.indicators import rsi, atr, vwap
from bot.risk import RiskManager
from bot.strategies import STRATEGIES, generate_signals

CFG = load_config("config.yaml")


def test_asset_class():
    assert asset_class("AAPL") == "stock"
    assert asset_class("BTC-USD") == "crypto"
    assert asset_class("EURUSD=X") == "forex"
    assert asset_class("GC=F") == "future"


def test_indicators_ranges():
    df = synthetic(1000)
    r = rsi(df.close).dropna()
    assert r.between(0, 100).all()
    assert (atr(df).dropna() > 0).all()
    v = vwap(df).dropna()
    assert ((v >= df.low.min()) & (v <= df.high.max())).all()


@pytest.mark.parametrize("name", [n for n in STRATEGIES if n != "ml"])
def test_no_lookahead(name):
    """Cambiar el futuro no debe alterar las señales del pasado."""
    df = synthetic(1500, seed=3)
    a = generate_signals(df, name, CFG["strategy"]["params"])
    df2 = df.copy()
    df2.iloc[1000:, :4] *= 1.5
    b = generate_signals(df2, name, CFG["strategy"]["params"])
    cols = ["entry", "exit_long", "exit_short"]
    pd.testing.assert_frame_equal(a[cols].iloc[:1000], b[cols].iloc[:1000])


def test_position_sizing_caps():
    rm = RiskManager(risk_per_trade=0.01, max_position_pct=0.2, stop_atr_mult=2)
    qty, sd, td = rm.size(10_000, 100, 1.0)
    assert sd == 2.0
    assert qty * 100 <= 2000 + 1e-9          # tope del 20%
    qty, _, _ = rm.size(10_000, 100, 10.0)   # stop amplio -> 100$/20 = 5 acciones
    assert qty == pytest.approx(5)


def test_kill_switch():
    rm = RiskManager(max_drawdown_kill=0.1, daily_loss_limit=0.5)
    rm.on_equity(10_000, 1)
    rm.on_equity(8_900, 2)
    assert rm.killed and not rm.can_open(0, 1)


def test_daily_halt_resets():
    rm = RiskManager(daily_loss_limit=0.02, max_drawdown_kill=0.5)
    rm.on_equity(10_000, 1)
    rm.on_equity(9_700, 1)
    assert rm.halted_today
    rm.on_equity(9_700, 2)
    assert not rm.halted_today


@pytest.mark.parametrize("name", [n for n in STRATEGIES if n != "ml"])
def test_backtest_runs_and_accounts(name):
    cfg = {**CFG, "strategy": {"name": name, "params": CFG["strategy"]["params"]}}
    data = {"AAA": synthetic(2500, seed=1), "BTC-USD": synthetic(2500, seed=2, session=False)}
    res = Backtester(cfg).run(data)
    eq = res["equity"]["equity"]
    assert np.isfinite(eq).all()
    tr = res["trades"]
    if len(tr):
        # contabilidad: capital final = inicial + suma de PnL de operaciones
        assert eq.iloc[-1] == pytest.approx(cfg["capital_inicial"] + tr.pnl.sum(), rel=1e-6)
        # acciones nunca quedan abiertas de un día para otro
        st = tr[tr.symbol == "AAA"]
        ny = lambda s: pd.to_datetime(s).dt.tz_convert("America/New_York").dt.date
        assert (ny(st.entry_time) == ny(st.exit_time)).all()


def test_triple_barrier_and_ml_no_lookahead():
    from bot.ml import make_features, triple_barrier, FEATURES
    df = synthetic(1500, seed=5, session=False)
    f = make_features(df)
    f2 = make_features(df.assign(close=df.close.where(df.index < df.index[1000], df.close * 2)))
    pd.testing.assert_frame_equal(f[FEATURES].iloc[:1000], f2[FEATURES].iloc[:1000])
    yl, ys = triple_barrier(df, f["atr"], 2.0, 1.0, 24)
    v = yl.dropna()
    assert set(v.unique()) <= {0.0, 1.0} and np.isnan(yl.iloc[-1])


def test_ml_strategy_backtest():
    df = synthetic(3000, seed=9, session=False)
    df["p_long"] = 0.9   # modelo "perfecto" ficticio -> debe generar entradas largas
    df["p_short"] = 0.0
    cfg = {**CFG, "strategy": {"name": "ml", "params": {**CFG["strategy"]["params"],
           "ml": {"tp_atr": 2, "sl_atr": 1, "min_edge": 0.05}}}}
    res = Backtester(cfg).run({"X-USD": df})
    assert len(res["trades"]) > 0 and (res["trades"].direction == 1).all()


def test_market_hours():
    from datetime import datetime, timezone
    from bot.runner import market_open
    mon_15utc = datetime(2026, 11, 16, 15, 0, tzinfo=timezone.utc)   # lunes 10:00 NY, 16:00 Madrid
    sat = datetime(2026, 11, 14, 15, 0, tzinfo=timezone.utc)
    assert market_open("AAPL", mon_15utc) and market_open("SAN.MC", mon_15utc)
    assert not market_open("AAPL", sat) and market_open("BTC-USD", sat) and not market_open("EURUSD=X", sat)
    assert not market_open("SAN.MC", datetime(2026, 11, 16, 17, 0, tzinfo=timezone.utc))  # 18:00 Madrid


def test_clean_json():
    from bot.runner import _clean
    assert _clean({"a": [float("nan"), 1.0, np.float64("inf")]}) == {"a": [None, 1.0, None]}
