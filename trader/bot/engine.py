"""El motor autónomo: funciona 24/7 sin intervención.

Cada `poll_seconds`: vigila los stop-loss de las posiciones abiertas.
Al cerrar cada vela: recalcula señales y aplica exactamente las mismas reglas que el backtest.
Cada `rescan_hours`: vuelve a escanear el mercado y elige dónde operar.
El estado se guarda en disco: si el ordenador se reinicia, continúa donde lo dejó.
"""
import json
import logging
import os
import time
import numpy as np
import pandas as pd

from . import data as D
from .scanner import pick_universe, score_series
from .risk import RiskManager

log = logging.getLogger("trader")


class Engine:
    def __init__(self, cfg, exchange, broker, strategies, risk_cfg, notifier):
        self.cfg, self.ex, self.broker, self.strats = cfg, exchange, broker, strategies
        self.by_name = {s.name: s for s in strategies}
        self.risk = RiskManager(risk_cfg)
        self.risk_cfg = risk_cfg
        self.notify = notifier
        self.tf = cfg["timeframe"]
        self.positions = {}   # sym -> {qty, entry_px, stop, strat, entry_ts, bars}
        self.universe, self.last_scan, self.last_bar = [], 0.0, None
        self.state_path = os.path.join(cfg.get("state_dir", "state"), f"state_{cfg['mode']}.json")
        self.trades_path = os.path.join(cfg.get("state_dir", "state"), f"trades_{cfg['mode']}.csv")
        self._load()

    # ---------- persistencia ----------
    def _load(self):
        if os.path.exists(self.state_path):
            st = json.load(open(self.state_path))
            self.positions = st.get("positions", {})
            self.risk.load_state(st.get("risk"))
            self.broker.load_state(st.get("broker"))
            self.universe = st.get("universe", [])
            self.notify.send(f"Estado recuperado: {len(self.positions)} posiciones abiertas.")

    def _save(self):
        os.makedirs(os.path.dirname(self.state_path), exist_ok=True)
        tmp = self.state_path + ".tmp"
        json.dump({"positions": self.positions, "risk": self.risk.to_state(), "broker": self.broker.to_state(),
                   "universe": self.universe}, open(tmp, "w"), indent=2, default=str)
        os.replace(tmp, self.state_path)

    def _log_trade(self, row):
        os.makedirs(os.path.dirname(self.trades_path), exist_ok=True)
        new = not os.path.exists(self.trades_path)
        pd.DataFrame([row]).to_csv(self.trades_path, mode="a", header=new, index=False)

    # ---------- operaciones ----------
    def equity(self, prices=None):
        prices = prices or {}
        val = 0.0
        for s, p in self.positions.items():
            px = prices.get(s) or self.broker.price(s)
            val += p["qty"] * px
        return self.broker.cash() + val

    def _open(self, sym, strat, qty, stop_dist, why):
        px, q, fee = self.broker.buy(sym, qty)
        if q <= 0:
            return
        self.positions[sym] = {"qty": q, "entry_px": px, "stop": px - stop_dist, "strat": strat,
                               "entry_ts": str(pd.Timestamp.now(tz="UTC")), "bars": 0, "fee": fee}
        self.notify.send(f"🟢 COMPRA {sym} x{q:.6g} @ {px:.6g} | estrategia {strat} | stop {px - stop_dist:.6g} | {why}")

    def _close(self, sym, reason):
        p = self.positions.pop(sym)
        px, q, fee = self.broker.sell(sym, p["qty"])
        pnl = q * px - fee - (p["qty"] * p["entry_px"] + p.get("fee", 0))
        self._log_trade({"symbol": sym, "strategy": p["strat"], "entry_time": p["entry_ts"],
                         "exit_time": str(pd.Timestamp.now(tz="UTC")), "entry_px": p["entry_px"], "exit_px": px,
                         "qty": q, "pnl": pnl, "reason": reason})
        icon = "✅" if pnl > 0 else "🔴"
        self.notify.send(f"{icon} VENTA {sym} @ {px:.6g} | {reason} | resultado {pnl:+.2f}")

    def kill(self, reason):
        for s in list(self.positions):
            self._close(s, "kill_switch")
        self.notify.send(f"⛔ MÁQUINA APAGADA: {reason}. Revisa y borra el estado para reiniciar.", important=True)
        self._save()

    # ---------- ciclo ----------
    def rescan(self):
        self.universe = pick_universe(self.ex, self.cfg["quote"], self.cfg["universe_size"],
                                      self.cfg.get("exclude", []))
        self.last_scan = time.time()
        self.notify.send(f"🔎 Escaneo: vigilando {len(self.universe)} mercados: {', '.join(self.universe[:10])}…")

    def check_stops(self):
        for s in list(self.positions):
            try:
                px = self.broker.price(s)
            except Exception as e:
                log.error(f"precio {s}: {e}")
                continue
            if px <= self.positions[s]["stop"]:
                self._close(s, "stop")

    def on_bar(self):
        now = self.ex.milliseconds()
        frames, sigs, scores = {}, {}, {}
        for s in set(self.universe) | set(self.positions):
            try:
                raw = D.to_df(self.ex.fetch_ohlcv(s, self.tf, limit=self.cfg.get("history_bars", 400)))
            except Exception as e:
                log.error(f"velas {s}: {e}")
                continue
            df = D.closed_candles(raw, self.tf, now)
            if len(df) < 250:
                continue
            frames[s] = df
            sigs[s] = {st.name: st.generate(df).iloc[-1] for st in self.strats}
            scores[s] = score_series(df).iloc[-1]
        prices = {s: f["close"].iloc[-1] for s, f in frames.items()}
        equity = self.equity(prices)
        day = pd.Timestamp.now(tz="UTC").floor("D")
        if self.risk.update(equity, day) == "kill":
            return self.kill(self.risk.halt_reason)
        if self.risk.halted:
            return

        # gestionar abiertas
        for s in list(self.positions):
            p = self.positions[s]
            p["bars"] += 1
            sg = sigs.get(s, {}).get(p["strat"])
            if sg is None:
                continue
            if np.isfinite(sg["trail"]):
                p["stop"] = max(p["stop"], float(sg["trail"]))
            mh = self.by_name[p["strat"]].max_hold_bars
            if sg["exit"]:
                self._close(s, "señal")
            elif mh and p["bars"] >= mh:
                self._close(s, "tiempo")

        # nuevas entradas en los mejores mercados
        ranked = [s for s, v in sorted(scores.items(), key=lambda kv: -kv[1] if np.isfinite(kv[1]) else np.inf)
                  if np.isfinite(v)][: self.cfg.get("top_n", 6)]
        if self.risk.can_open(equity, len(self.positions)):
            cands = []
            for s in ranked:
                if s in self.positions:
                    continue
                for st in self.strats:
                    sg = sigs[s][st.name]
                    if sg["entry"] and np.isfinite(sg["stop"]) and sg["stop"] < prices[s]:
                        cands.append((float(sg["strength"]), s, st.name, prices[s] - float(sg["stop"])))
                        break
            cands.sort(reverse=True)
            for strength, s, n, dist in cands[: self.risk_cfg.max_positions - len(self.positions)]:
                qty = self.risk.size(equity, self.broker.cash(), prices[s], prices[s] - dist)
                if qty > 0:
                    self._open(s, n, qty, dist, f"puntuación mercado {scores[s]:.2f}")
        log.info(f"vela cerrada | capital {equity:,.2f} | abiertas {list(self.positions)} | top {ranked}")

    def run(self):
        tf_ms = D.TF_MS[self.tf]
        self.notify.send(f"🤖 Máquina arrancada en modo {'REAL' if self.broker.live else 'SIMULADO'} "
                         f"({self.ex.id}, {self.tf}).", important=self.broker.live)
        while True:
            try:
                if self.risk.halted:
                    log.warning(f"Apagada: {self.risk.halt_reason}")
                    return
                if not self.universe or time.time() - self.last_scan > self.cfg.get("rescan_hours", 6) * 3600:
                    self.rescan()
                bar = self.ex.milliseconds() // tf_ms
                if bar != self.last_bar:
                    if self.last_bar is not None:
                        time.sleep(5)  # margen para que el exchange cierre la vela
                    self.on_bar()
                    self.last_bar = bar
                self.check_stops()
                self._save()
                time.sleep(self.cfg.get("poll_seconds", 30))
            except KeyboardInterrupt:
                self._save()
                self.notify.send("Máquina detenida por el usuario. Posiciones abiertas se mantienen.")
                return
            except Exception as e:  # nunca morir por un error de red
                log.exception(f"Error en el ciclo: {e}")
                time.sleep(30)
