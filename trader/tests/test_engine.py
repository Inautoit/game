"""Prueba el motor en vivo con un exchange falso (sin red)."""
import numpy as np
import pandas as pd

from bot.broker import PaperBroker
from bot.engine import Engine
from bot.notify import Notifier
from bot.risk import RiskConfig
from bot.strategies import Strategy


class FakeExchange:
    id = "fake"

    def __init__(self, n=400):
        self.t0 = 1_735_689_600_000
        self.n = n
        self.px = 100.0
        self.markets = {"A/EUR": {"spot": True, "active": True, "quote": "EUR", "base": "A"},
                        "USDT/EUR": {"spot": True, "active": True, "quote": "EUR", "base": "USDT"}}

    def milliseconds(self):
        return self.t0 + self.n * 3_600_000 + 60_000

    def fetch_tickers(self):
        return {"A/EUR": {"quoteVolume": 1e6}, "USDT/EUR": {"quoteVolume": 1e9}}

    def fetch_ticker(self, s):
        return {"last": self.px, "bid": self.px, "ask": self.px}

    def fetch_ohlcv(self, s, tf, limit=400):
        rows = []
        for i in range(self.n + 1):  # la última vela está "formándose"
            c = 100 + 0.05 * i
            rows.append([self.t0 + i * 3_600_000, c, c * 1.01, c * 0.99, c, 1000])
        return rows


class AlwaysBuy(Strategy):
    def __init__(self):
        super().__init__({}, "always")

    def generate(self, df):
        n = len(df)
        return self._out(df, pd.Series(True, df.index), pd.Series(False, df.index), df["close"] * 0.95,
                         pd.Series(np.nan, df.index), pd.Series(1.0, df.index))


def test_engine_opens_and_stops(tmp_path):
    ex = FakeExchange()
    cfg = {"mode": "paper", "timeframe": "1h", "quote": "EUR", "universe_size": 5, "top_n": 3,
           "state_dir": str(tmp_path)}
    broker = PaperBroker(ex, 1000, 0.001, 0.0)
    eng = Engine(cfg, ex, broker, [AlwaysBuy()], RiskConfig(risk_per_trade=0.02), Notifier())
    eng.rescan()
    assert eng.universe == ["A/EUR"]  # descarta stablecoins
    eng.on_bar()
    assert "A/EUR" in eng.positions
    stop = eng.positions["A/EUR"]["stop"]
    ex.px = stop * 0.99
    eng.check_stops()
    assert not eng.positions and broker.cash() < 1000
    eng._save()
    eng2 = Engine(cfg, ex, PaperBroker(ex, 1000, 0.001, 0.0), [AlwaysBuy()], RiskConfig(), Notifier())
    assert eng2.broker.cash() == broker.cash()  # recupera el estado tras reinicio
    assert (tmp_path / "trades_paper.csv").exists()
