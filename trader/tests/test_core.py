import numpy as np
import pandas as pd
import pytest

from bot import indicators as ind, strategies as S
from bot.backtest import CostConfig, run_backtest, walk_forward
from bot.data import synthetic, closed_candles
from bot.risk import RiskConfig, RiskManager
from bot.strategies import Strategy


@pytest.fixture(scope="module")
def mkt():
    return synthetic(n_symbols=3, bars=24 * 60, seed=1)


def frame(closes, opens=None, lows=None):
    idx = pd.date_range("2025-01-01", periods=len(closes), freq="h", tz="UTC")
    c = np.asarray(closes, float)
    o = np.asarray(opens if opens is not None else c, float)
    lo = np.asarray(lows if lows is not None else np.minimum(o, c), float)
    return pd.DataFrame({"open": o, "high": np.maximum(o, c), "low": lo, "close": c, "volume": 1000.0}, index=idx)


class Scripted(Strategy):
    """Compra en la vela `at`, vende en `out`, stop a `stop_pct` por debajo."""
    def __init__(self, at, out, stop_pct=0.1):
        super().__init__({}, "scripted")
        self.at, self.out, self.stop_pct = at, out, stop_pct

    def generate(self, df):
        n = len(df)
        e = np.zeros(n, bool); e[self.at] = True
        x = np.zeros(n, bool); x[self.out] = True
        return self._out(df, pd.Series(e, df.index), pd.Series(x, df.index), df["close"] * (1 - self.stop_pct),
                         pd.Series(np.nan, df.index), pd.Series(1.0, df.index))


def test_rsi_bounds(mkt):
    r = ind.rsi(next(iter(mkt.values()))["close"]).dropna()
    assert r.between(0, 100).all()


def test_donchian_excludes_current_bar():
    df = frame([1, 2, 3, 10])
    assert ind.donchian_high(df, 3).iloc[-1] == 3


@pytest.mark.parametrize("name", list(S.REGISTRY))
def test_no_lookahead(mkt, name):
    """Cambiar el futuro no puede cambiar las señales del pasado."""
    df = next(iter(mkt.values()))
    st = S.REGISTRY[name]()
    base = st.generate(df)
    cut = len(df) - 100
    fut = df.copy()
    fut.iloc[cut:, :] = fut.iloc[cut:, :] * 3.7
    alt = st.generate(fut)
    pd.testing.assert_frame_equal(base.iloc[:cut], alt.iloc[:cut])


def test_executes_next_open_and_charges_costs():
    closes = [100.0] * 20
    opens = [100.0] * 20
    opens[6] = 101.0  # la compra decidida en la vela 5 se ejecuta a la apertura de la 6
    df = frame(closes, opens)
    costs = CostConfig(fee=0.001, slippage=0.0)
    risk = RiskConfig(risk_per_trade=0.5, max_position_pct=0.5, max_positions=1)
    r = run_backtest({"X/EUR": df}, [Scripted(5, 10)], risk, costs, initial=1000)
    t = r.trades.iloc[0]
    assert t.entry_px == pytest.approx(101.0)
    assert t.exit_px == pytest.approx(100.0)
    assert t.entry_time == df.index[6] and t.exit_time == df.index[11]
    expected = t.qty * 100 * (1 - 0.001) - t.qty * 101 * (1 + 0.001)
    assert t.pnl == pytest.approx(expected)
    assert r.equity.iloc[-1] == pytest.approx(1000 + expected)


def test_stop_gap_fills_at_open():
    closes = [100.0] * 20
    opens = [100.0] * 20
    lows = [99.5] * 20
    opens[8], lows[8], closes[8] = 70.0, 69.0, 72.0  # apertura muy por debajo del stop (90)
    df = frame(closes, opens, lows)
    r = run_backtest({"X/EUR": df}, [Scripted(5, 15)], RiskConfig(risk_per_trade=0.05),
                     CostConfig(fee=0.0, slippage=0.0), initial=1000)
    t = r.trades.iloc[0]
    assert t.reason == "stop" and t.exit_px == pytest.approx(70.0)


def test_position_sizing():
    rm = RiskManager(RiskConfig(risk_per_trade=0.01, max_position_pct=1.0, min_notional=0))
    q = rm.size(equity=10_000, cash=10_000, price=100, stop=95)
    assert q * 5 == pytest.approx(100)  # arriesga exactamente el 1%
    rm2 = RiskManager(RiskConfig(risk_per_trade=0.5, max_position_pct=0.25, min_notional=0))
    assert rm2.size(10_000, 10_000, 100, 99) * 100 == pytest.approx(2500)  # tope 25%
    assert rm.size(10_000, 10_000, 100, 101) == 0  # stop por encima = no opera


def test_kill_switch_and_daily_limit():
    rm = RiskManager(RiskConfig(max_drawdown=0.15, daily_loss_limit=0.03, max_positions=5))
    d = pd.Timestamp("2025-01-01")
    assert rm.update(1000, d) == ""
    assert rm.can_open(980, 0) and not rm.can_open(960, 0)  # -4% en el día
    assert rm.update(840, d) == "kill" and rm.halted and not rm.can_open(2000, 0)


def test_kill_switch_closes_everything():
    closes = list(np.linspace(100, 60, 60))
    df = frame(closes)
    r = run_backtest({"X/EUR": df}, [Scripted(2, 59, stop_pct=0.9)],
                     RiskConfig(risk_per_trade=1, max_position_pct=1, max_drawdown=0.15),
                     CostConfig(0, 0), initial=1000)
    assert r.metrics["kill_switch"] and r.trades.iloc[0].reason == "kill_switch"
    assert r.metrics["max_drawdown"] > -0.25


def test_backtest_and_walkforward_run(mkt):
    r = run_backtest(mkt, S.build({"trend": None, "breakout": None, "meanrev": None}), top_n=2)
    assert len(r.equity) == 24 * 60 and np.isfinite(r.equity).all()
    assert (r.equity > 0).all()
    wf = walk_forward(mkt, ["trend"], train_bars=24 * 30, test_bars=24 * 10, log=lambda *_: None)
    assert len(wf["equity"]) > 0


def test_closed_candles_drops_forming_bar():
    df = frame([1, 2, 3])
    now = int(df.index[-1].timestamp() * 1000) + 30 * 60_000  # media hora dentro de la última vela
    assert len(closed_candles(df, "1h", now)) == 2
