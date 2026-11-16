"""Bot continuo multi-mercado.

- Cada ~minuto: precios en directo de todo el universo; ejecuta stops/objetivos al instante.
- Cuando cierra una vela en cualquier mercado: calcula features, consulta al modelo, ordena
  las oportunidades de TODOS los mercados por esperanza (R) y entra en las mejores.
- Reentrena el modelo cada día (histórico actualizado + sus propias operaciones).
- Sirve un panel web en http://localhost:8080 con todo lo que hace.
"""
from __future__ import annotations

import csv
import functools
import http.server
import json
import logging
import threading
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import requests

from . import ml as M
from .broker import AlpacaBroker, PaperBroker
from .config import asset_class, costs_for
from .data import COLS, _normalize
from .risk import RiskManager
from .strategies import ml_strategy
from .universe import full_universe

log = logging.getLogger("bot")
WEB = Path(__file__).resolve().parent.parent / "web"
CLASS_ES = {"crypto": "Cripto", "stock": "Acción/ETF", "forex": "Divisa", "future": "Futuro"}


# ------------------------------------------------------------------ horarios
def market_open(sym: str, now: datetime) -> bool:
    cls = asset_class(sym)
    if cls == "crypto":
        return True
    if cls in ("forex", "future"):   # casi 24h de domingo 17:00 a viernes 17:00 (NY)
        ny = pd.Timestamp(now).tz_convert("America/New_York")
        wd, h = ny.weekday(), ny.hour
        return not (wd == 5 or (wd == 4 and h >= 17) or (wd == 6 and h < 18))
    if sym.endswith((".MC", ".PA", ".DE", ".AS", ".SW", ".MI", ".L")):
        cet = pd.Timestamp(now).tz_convert("Europe/Madrid")
        return cet.weekday() < 5 and (9, 0) <= (cet.hour, cet.minute) < (17, 30)
    ny = pd.Timestamp(now).tz_convert("America/New_York")
    return ny.weekday() < 5 and (9, 30) <= (ny.hour, ny.minute) < (16, 0)


# ------------------------------------------------------------------ datos en vivo
BINANCE = "https://data-api.binance.vision/api/v3"


def crypto_bars(sym: str, interval: str, limit: int = 400) -> pd.DataFrame:
    r = requests.get(f"{BINANCE}/klines", params={"symbol": sym.split("-")[0] + "USDT",
                     "interval": interval, "limit": limit}, timeout=15)
    r.raise_for_status()
    k = r.json()
    df = pd.DataFrame([x[:6] for x in k], columns=["t", *COLS])
    df.index = pd.to_datetime(df.pop("t"), unit="ms", utc=True)
    return df.astype(float)


def crypto_prices(syms: list[str]) -> dict[str, float]:
    r = requests.get(f"{BINANCE}/ticker/price", timeout=15)
    r.raise_for_status()
    px = {x["symbol"]: float(x["price"]) for x in r.json()}
    return {s: px[s.split("-")[0] + "USDT"] for s in syms if s.split("-")[0] + "USDT" in px}


def yahoo_batch(syms: list[str], interval: str, period: str) -> dict[str, pd.DataFrame]:
    import yfinance as yf
    out = {}
    for i in range(0, len(syms), 40):
        part = syms[i:i + 40]
        try:
            raw = yf.download(part, interval=interval, period=period, auto_adjust=True,
                              progress=False, group_by="ticker", threads=True)
        except Exception as e:  # noqa: BLE001
            log.warning("Yahoo: %s", e)
            continue
        for s in part:
            try:
                df = _normalize(raw[s] if isinstance(raw.columns, pd.MultiIndex) else raw)
                df.index = pd.to_datetime(df.index, utc=True)
                if len(df):
                    out[s] = df
            except Exception:  # noqa: BLE001
                pass
    return out


def _clean(o):
    """NaN/inf -> null para que el JSON sea válido en el navegador."""
    if isinstance(o, dict):
        return {k: _clean(v) for k, v in o.items()}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, (float, np.floating)):
        return float(o) if np.isfinite(o) else None
    if isinstance(o, np.integer):
        return int(o)
    return o


# ------------------------------------------------------------------ bot
class Runner:
    def __init__(self, cfg: dict):
        self.cfg = cfg
        self.mc = cfg["ml"]
        self.interval = self.mc["interval"]
        self.bar = pd.Timedelta(self.interval)
        self.universe = full_universe(cfg)
        self.crypto = [s for s in self.universe if asset_class(s) == "crypto"]
        self.other = [s for s in self.universe if asset_class(s) != "crypto"]
        lc = cfg.get("live", {})
        mode = cfg.get("mode", "paper")
        state = lc.get("state_file", "paper_state.json")
        self.broker = PaperBroker(cfg, state) if mode == "paper" else \
            AlpacaBroker(cfg, state, live=(mode == "live"))
        self.risk = RiskManager.from_config(cfg)
        self.risk.stop_atr_mult, self.risk.take_profit_atr_mult = self.mc["sl_atr"], self.mc["tp_atr"]
        self.risk.trailing_atr_mult, self.risk.max_holding_bars = 0, self.mc["horizon"]
        self.journal = Path(lc.get("journal_file", "journal.csv"))
        self.bars: dict[str, pd.DataFrame] = {}
        self.prices: dict[str, float] = {}
        self.last_closed: dict[str, pd.Timestamp] = {}
        self.scan: dict[str, dict] = {}
        self.entry_feats: dict[str, dict] = {}
        self.events: list[dict] = []
        self.equity_hist: list = []
        self.trades: list[dict] = []
        self.last_bars_refresh = 0.0
        self.model = None
        self.model_lock = threading.Lock()
        self.status = "arrancando"
        self._load_history()

    # ---------------- persistencia
    def _load_history(self):
        p = WEB / "data" / "state.json"
        if p.exists():
            try:
                s = json.loads(p.read_text())
                self.equity_hist = s.get("equity", [])
                self.trades = s.get("trades", [])
                self.events = s.get("events", [])
            except Exception:  # noqa: BLE001
                pass

    def event(self, msg: str, kind: str = ""):
        log.info(msg)
        self.events.insert(0, {"t": datetime.now(timezone.utc).isoformat(), "msg": msg, "kind": kind})
        self.events = self.events[:300]

    # ---------------- modelo
    def load_or_train(self, force: bool = False):
        path = Path(self.mc["model_path"])
        age_h = (time.time() - path.stat().st_mtime) / 3600 if path.exists() else 1e9
        if force or age_h >= self.mc.get("retrain_hours", 24):
            self.event("Reentrenando el modelo con el histórico actualizado y las operaciones propias…")
            from .data import fetch_universe
            data = fetch_universe(self.universe, self.interval, self.mc["years"],
                                  self.cfg["data"].get("cache_dir"))
            ds = M.build_dataset(data, self.mc, self.cfg["strategy"].get("params"))
            j = Path("ml_journal.csv")
            meta = M.fit_final(ds, self.mc, str(path), journal=pd.read_csv(j) if j.exists() else None,
                               train_months=self.mc["train_months"])
            self.event(f"Modelo reentrenado: {meta['rows']:,} velas, {meta['own_trades']} operaciones propias.", "up")
        with self.model_lock:
            self.model = M.load_model(str(path))

    def _retrain_loop(self):
        while True:
            time.sleep(3600)
            try:
                self.load_or_train()
            except Exception as e:  # noqa: BLE001
                self.event(f"Error reentrenando: {e}", "down")

    # ---------------- datos
    def refresh_bars(self):
        now = pd.Timestamp.now(tz="UTC")
        for s in self.crypto:
            try:
                self.bars[s] = crypto_bars(s, self.interval)
            except Exception as e:  # noqa: BLE001
                log.debug("%s: %s", s, e)
        self.bars.update(yahoo_batch(self.other, self.interval, "60d"))
        # descartar la vela en curso
        for s, df in list(self.bars.items()):
            if len(df) and df.index[-1] + self.bar > now:
                self.bars[s] = df.iloc[:-1]
        self.last_bars_refresh = time.time()

    def refresh_prices(self):
        try:
            self.prices.update(crypto_prices(self.crypto))
        except Exception as e:  # noqa: BLE001
            log.debug("precios cripto: %s", e)
        live = yahoo_batch(self.other, "1m", "1d")
        for s, df in live.items():
            self.prices[s] = float(df["close"].iloc[-1])
        for s, df in self.bars.items():
            self.prices.setdefault(s, float(df["close"].iloc[-1]))

    # ---------------- análisis
    def analyse(self, sym: str) -> dict | None:
        df = self.bars.get(sym)
        if df is None or len(df) < 150:
            return None
        feats = M.make_features(df, self.cfg["strategy"].get("params"), sym)
        with self.model_lock:
            pr = M.predict(self.model, feats.iloc[-1:])
        comm, slip = costs_for(self.cfg, sym)
        d = feats.iloc[-1:].assign(close=df["close"].iloc[-1], **pr.iloc[-1].to_dict())
        sig = ml_strategy(d, {"ml": self.mc, "_cost_frac": 2 * (comm + slip)}).iloc[-1]
        f = feats.iloc[-1]
        return {"symbol": sym, "cls": asset_class(sym), "time": str(df.index[-1]),
                "close": float(df["close"].iloc[-1]), "atr": float(f["atr"]),
                "atr_pct": float(f["atr_pct"]), "rsi": float(f["rsi"] * 100), "adx": float(f["adx"] * 100),
                "p_long": float(pr["p_long"].iloc[-1]), "p_short": float(pr["p_short"].iloc[-1]),
                "p_be": float(sig["p_breakeven"] + self.mc["min_edge"]),
                "ev_long": float(sig["ev_long"]), "ev_short": float(sig["ev_short"]),
                "entry": int(sig["entry"]), "score": float(sig["score"]),
                "chg24": float(df["close"].iloc[-1] / df["close"].iloc[max(0, len(df) - 25)] - 1),
                "feats": {k: (None if pd.isna(f[k]) else float(f[k])) for k in M.FEATURES}}

    # ---------------- operativa
    def close(self, sym: str, price: float, reason: str):
        p, fill, pnl = self.broker.close(sym, price)
        now = datetime.now(timezone.utc).isoformat()
        self.trades.insert(0, {"symbol": sym, "cls": asset_class(sym), "dir": p.direction,
                               "entry": p.entry_price, "exit": fill, "pnl": round(pnl, 2),
                               "r": round(pnl / max(p.qty * abs(p.entry_price - p.stop) if p.stop else 1, 1e-9), 2),
                               "reason": reason, "open_time": str(p.entry_time), "close_time": now})
        self.trades = self.trades[:1000]
        if sym in self.entry_feats:   # memoria de aprendizaje
            row = {**self.entry_feats.pop(sym), "direction": p.direction, "pnl": pnl,
                   "time": now, "symbol": sym}
            j = Path("ml_journal.csv")
            pd.DataFrame([row]).to_csv(j, mode="a", header=not j.exists(), index=False)
        self._journal({"time": now, "symbol": sym, "action": "close", "direction": p.direction,
                       "price": fill, "pnl": round(pnl, 2), "reason": reason})
        self.event(f"CIERRA {sym} ({reason}) a {fill:.6g} → {'gana' if pnl > 0 else 'pierde'} {abs(pnl):.2f} $",
                   "up" if pnl > 0 else "down")

    def _journal(self, row):
        new = not self.journal.exists()
        with self.journal.open("a", newline="") as f:
            w = csv.DictWriter(f, fieldnames=list(row))
            if new:
                w.writeheader()
            w.writerow(row)

    def manage_positions(self, new_bar: set[str]):
        for sym, p in list(self.broker.positions.items()):
            px = self.prices.get(sym)
            if px is None:
                continue
            if (p.direction == 1 and px <= p.stop) or (p.direction == -1 and px >= p.stop):
                self.close(sym, px, "stop")
            elif (p.direction == 1 and px >= p.take_profit) or (p.direction == -1 and px <= p.take_profit):
                self.close(sym, px, "objetivo")
            elif sym in new_bar:
                p.bars_held += 1
                self.broker.save()
                sc = self.scan.get(sym, {})
                if p.bars_held >= self.risk.max_holding_bars:
                    self.close(sym, px, "tiempo máximo")
                elif sc.get("entry") == -p.direction:
                    self.close(sym, px, "señal contraria")

    def open_best(self, candidates: list[dict], now: datetime):
        eq = self.broker.equity(self.prices)
        for c in sorted(candidates, key=lambda c: -c["score"]):
            sym = c["symbol"]
            if sym in self.broker.positions or not market_open(sym, now):
                continue
            if not self.risk.can_open(len(self.broker.positions), c["entry"]):
                break
            px = self.prices.get(sym, c["close"])
            qty, sd, td = self.risk.size(eq, px, c["atr"])
            if qty <= 0:
                continue
            p = self.broker.open(sym, c["entry"], qty, px, sd, td, now.isoformat())
            self.entry_feats[sym] = c["feats"]
            prob = c["p_long"] if c["entry"] == 1 else c["p_short"]
            self._journal({"time": now.isoformat(), "symbol": sym, "action": "open", "direction": c["entry"],
                           "price": p.entry_price, "pnl": 0, "reason": f"prob {prob:.2f} EV {c['score']:.2f}R"})
            self.event(f"ABRE {'LARGO' if c['entry'] == 1 else 'CORTO'} {sym} ({CLASS_ES[c['cls']]}) a {p.entry_price:.6g} · "
                       f"prob {prob:.0%} · esperanza {c['score']:+.2f}R · stop {p.stop:.6g} · objetivo {p.take_profit:.6g}",
                       "up" if c["entry"] == 1 else "down")

    def step(self):
        now = datetime.now(timezone.utc)
        # velas: refresco cada 5 min (o al cambiar de hora)
        if time.time() - self.last_bars_refresh > 300 or now.minute < 2:
            self.refresh_bars()
        self.refresh_prices()
        new_bar = set()
        for s, df in self.bars.items():
            if len(df) and self.last_closed.get(s) != df.index[-1]:
                new_bar.add(s)
                self.last_closed[s] = df.index[-1]
        for s in new_bar:
            try:
                a = self.analyse(s)
                if a:
                    self.scan[s] = a
            except Exception as e:  # noqa: BLE001
                log.debug("análisis %s: %s", s, e)
        self.manage_positions(new_bar)
        eq = self.broker.equity(self.prices)
        was_killed, was_halted = self.risk.killed, self.risk.halted_today
        self.risk.on_equity(eq, pd.Timestamp(now).tz_convert("America/New_York").date())
        if self.risk.killed and not was_killed:
            self.event("INTERRUPTOR DE EMERGENCIA: caída del 10 % desde máximos. No abrirá más operaciones.", "down")
        if self.risk.halted_today and not was_halted:
            self.event("Límite de pérdida diaria alcanzado: pausa hasta mañana.", "down")
        cands = [self.scan[s] for s in new_bar if s in self.scan and self.scan[s]["entry"] != 0]
        if cands:
            self.open_best(cands, now)
        if not self.equity_hist or now.timestamp() - self.equity_hist[-1][0] / 1000 >= 300:
            self.equity_hist.append([int(now.timestamp() * 1000), round(eq, 2)])
            if len(self.equity_hist) > 5000:
                self.equity_hist = self.equity_hist[::2]
        self.status = "en marcha"
        self.write_state(now, eq, len(new_bar))

    def write_state(self, now, eq, n_new):
        pos = []
        for s, p in self.broker.positions.items():
            px = self.prices.get(s, p.entry_price)
            pos.append({"symbol": s, "cls": asset_class(s), "dir": p.direction, "qty": p.qty,
                        "entry": p.entry_price, "price": px, "stop": p.stop, "tp": p.take_profit,
                        "bars": p.bars_held, "pnl": p.direction * p.qty * (px - p.entry_price) - p.entry_cost,
                        "open_time": str(p.entry_time)})
        scan = sorted(({k: v for k, v in x.items() if k != "feats"} | {"price": self.prices.get(x["symbol"], x["close"]),
                        "open": market_open(x["symbol"], now)} for x in self.scan.values()),
                      key=lambda x: -x["score"])
        meta = self.model["meta"] if self.model else {}
        bt = None
        p = WEB / "backtest_ml.json"
        if p.exists():
            b = json.loads(p.read_text())
            bt = {k: b.get(k) for k in ("metrics", "auc", "period", "by_class")}
        state = {
            "updated": now.isoformat(), "status": self.status, "mode": self.cfg.get("mode", "paper"),
            "initial": float(self.cfg.get("capital_inicial", 10_000)), "equity_now": eq, "cash": self.broker.cash,
            "killed": self.risk.killed, "halted": self.risk.halted_today, "n_markets": len(self.universe),
            "n_analysed": len(self.scan), "new_bars": n_new, "interval": self.interval,
            "risk": {"max_open": self.risk.max_open_positions, "risk_per_trade": self.risk.risk_per_trade,
                     "tp": self.mc["tp_atr"], "sl": self.mc["sl_atr"], "horizon": self.mc["horizon"]},
            "model": {"trained_until": meta.get("trained_until"), "rows": meta.get("rows"),
                      "own_trades": meta.get("own_trades")},
            "positions": pos, "trades": self.trades[:300], "equity": self.equity_hist,
            "scan": scan, "events": self.events[:150], "backtest": bt,
        }
        out = WEB / "data"
        out.mkdir(exist_ok=True)
        tmp = out / "state.tmp"
        tmp.write_text(json.dumps(_clean(state), default=str))
        tmp.replace(out / "state.json")

    # ---------------- arranque
    def serve(self, port: int):
        handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(WEB))
        handler.log_message = lambda *a, **k: None
        srv = http.server.ThreadingHTTPServer(("0.0.0.0", port), handler)
        threading.Thread(target=srv.serve_forever, daemon=True).start()
        log.info("Panel web en http://localhost:%d", port)

    def run(self, port: int = 8080, once: bool = False, poll: int = 60):
        if port:
            self.serve(port)
        self.load_or_train()
        self.event(f"Bot en marcha: vigila {len(self.universe)} mercados ({len(self.crypto)} cripto, "
                   f"{len(self.other)} acciones, ETF, divisas y futuros).")
        if not once:
            threading.Thread(target=self._retrain_loop, daemon=True).start()
        while True:
            t0 = time.time()
            try:
                self.step()
            except Exception as e:  # noqa: BLE001
                self.event(f"Error en el ciclo: {e}", "down")
            if once:
                break
            time.sleep(max(5, poll - (time.time() - t0)))
