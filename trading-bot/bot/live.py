"""Bucle de paper trading en tiempo (casi) real. Datos de Yahoo (pueden ir algo retrasados)."""
from __future__ import annotations

import csv
import logging
import time
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from .broker import AlpacaBroker, PaperBroker
from .config import asset_class
from .data import fetch
from .indicators import session_dates
from .risk import RiskManager
from .strategies import generate_signals

log = logging.getLogger("live")


def market_open(sym: str, now: datetime) -> bool:
    cls = asset_class(sym)
    if cls == "crypto":
        return True
    ny = pd.Timestamp(now).tz_convert("America/New_York")
    if cls == "stock":
        return ny.weekday() < 5 and (9, 30) <= (ny.hour, ny.minute) < (16, 0)
    return not (ny.weekday() == 5 or (ny.weekday() == 4 and ny.hour >= 17)
                or (ny.weekday() == 6 and ny.hour < 17))


class LiveTrader:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        lc = cfg.get("live", {})
        mode = cfg.get("mode", "paper")
        state = lc.get("state_file", "paper_state.json")
        if mode == "paper":
            self.broker = PaperBroker(cfg, state)
        else:
            self.broker = AlpacaBroker(cfg, state, live=(mode == "live"))
        self.risk = RiskManager.from_config(cfg)
        self.journal = Path(lc.get("journal_file", "journal.csv"))
        self.last_bar: dict[str, pd.Timestamp] = {}
        self.is_ml = cfg["strategy"]["name"] == "ml"
        self.model = None
        self.last_feats: dict = {}
        self.entry_feats: dict = {}
        if self.is_ml:  # alinear stops/objetivo con las etiquetas del modelo
            mc = cfg["ml"]
            self.risk.stop_atr_mult, self.risk.take_profit_atr_mult = mc["sl_atr"], mc["tp_atr"]
            self.risk.trailing_atr_mult, self.risk.max_holding_bars = 0, mc["horizon"]
        self.prices: dict[str, float] = {}

    # ------------------------------------------------------------ ML
    def _ml_frame(self, sym: str) -> pd.DataFrame:
        """Velas cerradas de Binance + probabilidades del modelo (reentrena si toca)."""
        from . import ml as M
        from .data import fetch_binance
        mc = self.cfg["ml"]
        self._maybe_retrain()
        df = fetch_binance(sym, mc["interval"], years=0.08, cache_dir=self.cfg["data"].get("cache_dir"))
        feats = M.make_features(df, self.cfg["strategy"].get("params"))
        pr = M.predict(self.model, feats)
        self.last_feats[sym] = feats.iloc[-1]
        return df.join(pr)

    def _maybe_retrain(self):
        from . import ml as M
        from .data import fetch_binance
        mc = self.cfg["ml"]
        path = Path(mc["model_path"])
        age_h = (time.time() - path.stat().st_mtime) / 3600 if path.exists() else 1e9
        if self.model is not None and age_h < mc.get("retrain_hours", 24):
            return
        if age_h >= mc.get("retrain_hours", 24):
            log.info("Reentrenando modelo con histórico actualizado + %s operaciones propias",
                     len(self._ml_journal()))
            data = {s: fetch_binance(s, mc["interval"], mc["years"], self.cfg["data"].get("cache_dir"))
                    for s in mc["universe"]}
            ds = M.build_dataset(data, mc, self.cfg["strategy"].get("params"))
            M.fit_final(ds, mc, str(path), journal=self._ml_journal(), train_months=mc["train_months"])
        self.model = M.load_model(str(path))

    def _ml_journal(self) -> pd.DataFrame:
        p = Path("ml_journal.csv")
        return pd.read_csv(p) if p.exists() else pd.DataFrame()

    def log_trade(self, row: dict):
        new = not self.journal.exists()
        with self.journal.open("a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row))
            if new:
                w.writeheader()
            w.writerow(row)

    def step(self):
        now = datetime.now(timezone.utc)
        dc = self.cfg["data"]
        st = self.cfg["strategy"]
        universe = self.cfg["ml"]["universe"] if self.is_ml else self.cfg["universe"]
        for sym in universe:
            try:
                if self.is_ml:
                    df = self._ml_frame(sym)
                else:
                    df = fetch(sym, interval=dc["interval"], period="5d" if dc["interval"] == "1m" else "30d")
            except Exception as e:  # noqa: BLE001
                log.warning("%s: %s", sym, e)
                continue
            if len(df) < 100:
                continue
            from .config import costs_for
            comm, slip = costs_for(self.cfg, sym)
            params = {**st.get("params", {}), "ml": self.cfg.get("ml", {}), "_cost_frac": 2 * (comm + slip)}
            closed = df if self.is_ml else df.iloc[:-1]  # Binance ya entrega sólo velas cerradas
            s = generate_signals(closed, st["name"], params)
            bar = s.iloc[-1]
            price = float(df["close"].iloc[-1])
            self.prices[sym] = price
            is_new = self.last_bar.get(sym) != s.index[-1]
            self.last_bar[sym] = s.index[-1]
            pos = self.broker.positions.get(sym)
            if pos:
                reason = None
                if (pos.direction == 1 and price <= pos.stop) or (pos.direction == -1 and price >= pos.stop):
                    reason = "stop"
                elif (pos.direction == 1 and price >= pos.take_profit) or \
                        (pos.direction == -1 and price <= pos.take_profit):
                    reason = "take profit"
                elif is_new:
                    pos.bars_held += 1
                    if self.risk.trailing_atr_mult > 0:
                        if pos.direction == 1:
                            pos.best_price = max(pos.best_price, bar["high"])
                            pos.stop = max(pos.stop, pos.best_price - self.risk.trailing_atr_mult * bar["atr"])
                        else:
                            pos.best_price = min(pos.best_price, bar["low"])
                            pos.stop = min(pos.stop, pos.best_price + self.risk.trailing_atr_mult * bar["atr"])
                        self.broker.save()
                    if (pos.direction == 1 and bar["exit_long"]) or (pos.direction == -1 and bar["exit_short"]):
                        reason = "señal de salida"
                    elif pos.bars_held >= self.risk.max_holding_bars:
                        reason = "tiempo máximo"
                ny = pd.Timestamp(now).tz_convert("America/New_York")
                if asset_class(sym) == "stock" and self.risk.flatten_eod_stocks and \
                        (ny.hour, ny.minute) >= (15, 50):
                    reason = reason or "cierre de sesión"
                if reason:
                    p, fill, pnl = self.broker.close(sym, price)
                    log.info("CIERRE %s %s @ %.4f PnL=%.2f (%s)", sym, "L" if p.direction == 1 else "S",
                             fill, pnl, reason)
                    if sym in self.entry_feats:  # memoria de aprendizaje: features al entrar + resultado
                        from .ml import FEATURES
                        row = {k: self.entry_feats.pop(sym)[k] for k in FEATURES}
                        row.update(direction=p.direction, pnl=pnl, time=now.isoformat(), symbol=sym)
                        j = Path("ml_journal.csv")
                        pd.DataFrame([row]).to_csv(j, mode="a", header=not j.exists(), index=False)
                    self.log_trade({"time": now.isoformat(), "symbol": sym, "action": "close",
                                    "direction": p.direction, "qty": p.qty, "price": fill,
                                    "pnl": round(pnl, 2), "reason": reason})
            elif is_new and bar["entry"] != 0 and market_open(sym, now):
                if self.risk.can_open(len(self.broker.positions), int(bar["entry"])):
                    eq = self.broker.equity(self.prices)
                    qty, sd, td = self.risk.size(eq, price, bar["atr"])
                    if qty > 0:
                        p = self.broker.open(sym, int(bar["entry"]), qty, price, sd, td, now)
                        if sym in self.last_feats:
                            self.entry_feats[sym] = self.last_feats[sym]
                        log.info("APERTURA %s %s qty=%.4f @ %.4f SL=%.4f TP=%.4f", sym,
                                 "LARGO" if p.direction == 1 else "CORTO", qty, p.entry_price,
                                 p.stop, p.take_profit)
                        self.log_trade({"time": now.isoformat(), "symbol": sym, "action": "open",
                                        "direction": p.direction, "qty": qty, "price": p.entry_price,
                                        "pnl": 0, "reason": "señal de entrada"})
        eq = self.broker.equity(self.prices)
        self.risk.on_equity(eq, pd.Timestamp(now).tz_convert("America/New_York").date())
        log.info("Capital: %.2f | efectivo: %.2f | posiciones: %s", eq, self.broker.cash,
                 list(self.broker.positions) or "-")

    def run(self, once: bool = False):
        poll = self.cfg.get("live", {}).get("poll_seconds", 60)
        while True:
            self.step()
            if once or self.risk.killed:
                break
            time.sleep(poll)
