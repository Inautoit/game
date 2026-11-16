"""Laboratorio de investigación: el bot estudia el mercado y se autoentrena.

Cada ciclo:
  1. Actualiza el histórico de todos los mercados (las velas nuevas se acumulan).
  2. Re-evalúa al CAMPEÓN actual sobre los datos más recientes.
  3. Prueba ASPIRANTES (variantes de objetivo, plazo, exigencia y complejidad del modelo)
     con validación walk-forward: siempre sobre meses que el modelo no vio al entrenar.
  4. Un aspirante sólo asciende si (a) supera al campeón en el periodo de selección y
     (b) gana dinero en el EXAMEN FINAL: los últimos meses, que no se usan para elegir.
  5. Decide qué tipos de mercado operar (desactiva los que pierden en validación).
  6. Reentrena el campeón con TODO lo reciente + las operaciones propias del bot y guarda
     models/model.pkl; el bot en marcha lo recarga en caliente.
"""
from __future__ import annotations

import copy
import json
import logging
import random
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import ml as M
from .backtest import Backtester
from .config import asset_class
from .data import fetch_universe
from .universe import full_universe

log = logging.getLogger("research")
DIR = Path("research")
SPACE = {
    "tp_atr": [1.5, 2.0, 3.0],
    "horizon": [8, 16, 24],
    "min_edge": [0.02, 0.05, 0.08],
    "model": ["small", "medium"],
}
TUNED = list(SPACE)


def bt_cfg(cfg: dict, ml: dict) -> dict:
    """Config de backtest coherente con las etiquetas del modelo."""
    c = copy.deepcopy(cfg)
    c["strategy"] = {"name": "ml", "params": {**cfg["strategy"].get("params", {}), "ml": ml}}
    c["risk"].update({"stop_atr_mult": ml["sl_atr"], "take_profit_atr_mult": ml["tp_atr"],
                      "trailing_atr_mult": 0, "max_holding_bars": ml["horizon"], "flatten_eod_stocks": False,
                      # Para INVESTIGAR se mide la estrategia todo el periodo: los frenos de emergencia
                      # (que sí actúan operando) cortarían la muestra y falsearían la comparación.
                      "max_drawdown_kill": 1.0, "daily_loss_limit": 1.0})
    return c


def _sharpe(eq: pd.Series) -> float:
    d = eq.resample("1D").last().dropna().pct_change().dropna()
    return float(np.sqrt(252) * d.mean() / d.std()) if len(d) > 5 and d.std() > 0 else 0.0


class Lab:
    def __init__(self, cfg: dict, test_months: int = 12, exam_months: int = 3, candidates: int = 4):
        self.cfg = cfg
        self.base = dict(cfg["ml"])
        self.test_months, self.exam_months, self.n_cand = test_months, exam_months, candidates
        DIR.mkdir(exist_ok=True)
        self.champ_path = DIR / "champion.json"
        self.state_path = DIR / "state.json"

    # ---------------- persistencia
    def champion(self) -> dict:
        if self.champ_path.exists():
            return json.loads(self.champ_path.read_text())
        return {"params": {k: self.base.get(k, SPACE[k][0]) for k in TUNED}, "score": None,
                "enabled_classes": ["crypto", "stock", "forex", "future"], "since": None}

    def _log(self, row: dict):
        with (DIR / "experiments.jsonl").open("a") as f:
            f.write(json.dumps(row, default=str) + "\n")

    def _status(self, **kw):
        s = json.loads(self.state_path.read_text()) if self.state_path.exists() else {}
        s.update(kw, updated=datetime.now(timezone.utc).isoformat())
        self.state_path.write_text(json.dumps(s, default=str))

    # ---------------- evaluación
    def evaluate(self, params: dict, data, feats, label_cache) -> dict:
        ml = {**self.base, **params}
        key = (ml["tp_atr"], ml["sl_atr"], ml["horizon"])
        if key not in label_cache:
            label_cache.clear()  # una sola en memoria
            label_cache[key] = M.label_dataset(feats, data, ml)
        ds = label_cache[key]
        oos = M.walk_forward(ds, {**ml, "retrain_every_months": 3}, ml["train_months"],
                             test_months=self.test_months)
        start = oos.dropna(subset=["p_long"]).index.min()
        bt_data = {}
        for s, g in oos.dropna(subset=["p_long"]).groupby("symbol"):
            bt_data[s] = data[s].join(g[["p_long", "p_short"]]).loc[start:]
        res = Backtester(bt_cfg(self.cfg, ml)).run(bt_data)
        tr = res["trades"]
        exam_start = res["equity"].index.max() - pd.DateOffset(months=self.exam_months)
        if len(tr):
            tr = tr.assign(cls=tr.symbol.map(asset_class), exit_time=pd.to_datetime(tr.exit_time, utc=True))
        sel = tr[tr.exit_time < exam_start] if len(tr) else tr
        exam = tr[tr.exit_time >= exam_start] if len(tr) else tr
        # mercados que se operan: los que no pierden en el periodo de selección
        enabled = []
        for c in ["crypto", "stock", "forex", "future"]:
            g = sel[sel.cls == c] if len(sel) else sel
            if len(g) < 20 or g.pnl.sum() > 0:
                enabled.append(c)
        sel_on = sel[sel.cls.isin(enabled)] if len(sel) else sel
        exam_on = exam[exam.cls.isin(enabled)] if len(exam) else exam
        eq = res["equity"]["equity"]
        r_mean = float((sel_on.pnl / (self.cfg["capital_inicial"] * self.cfg["risk"]["risk_per_trade"])).mean()) if len(sel_on) else 0.0
        # Puntuación: esperanza por operación (en R) × √nº operaciones  ≈  t-estadístico de la ventaja
        score = r_mean * np.sqrt(len(sel_on)) if len(sel_on) >= 50 else -9.0
        return {"params": params, "score": round(float(score), 3), "enabled_classes": enabled,
                "sel_trades": int(len(sel_on)), "sel_pnl": round(float(sel_on.pnl.sum()) if len(sel_on) else 0, 2),
                "exam_trades": int(len(exam_on)), "exam_pnl": round(float(exam_on.pnl.sum()) if len(exam_on) else 0, 2),
                "sharpe": round(_sharpe(eq.loc[:exam_start]), 2), "metrics": res["metrics"],
                "equity": [[str(t), round(v, 2)] for t, v in eq.iloc[::max(1, len(eq) // 600)].items()],
                "by_class": {c: {"trades": int(len(g)), "pnl": round(float(g.pnl.sum()), 2),
                                 "win": round(float((g.pnl > 0).mean()), 3)} for c, g in tr.groupby("cls")} if len(tr) else {},
                "period": f"{start:%m/%Y} – {eq.index[-1]:%m/%Y}"}

    def sample(self, champ: dict, tried: set) -> dict:
        """Aspirante: mutación del campeón (60 %) o exploración aleatoria (40 %)."""
        for _ in range(50):
            if random.random() < 0.6:
                p = dict(champ["params"])
                k = random.choice(TUNED)
                p[k] = random.choice([v for v in SPACE[k] if v != p[k]])
            else:
                p = {k: random.choice(v) for k, v in SPACE.items()}
            if json.dumps(p, sort_keys=True) not in tried:
                return p
        return {k: random.choice(v) for k, v in SPACE.items()}

    # ---------------- ciclo
    def cycle(self):
        t0 = time.time()
        self._status(phase="descargando datos")
        data = fetch_universe(full_universe(self.cfg), self.base["interval"], self.base["years"],
                              self.cfg["data"].get("cache_dir"))
        self._status(phase="calculando indicadores", markets=len(data),
                     bars=int(sum(len(d) for d in data.values())))
        params = self.cfg["strategy"].get("params")
        feats = {s: M.make_features(df, params, s) for s, df in data.items()}
        label_cache: dict = {}
        champ = self.champion()
        self._status(phase="re-evaluando al campeón")
        cur = self.evaluate(champ["params"], data, feats, label_cache)
        self._log({"time": datetime.now(timezone.utc), "role": "campeón", **{k: v for k, v in cur.items() if k != "equity"}})
        best = cur
        tried = {json.dumps(champ["params"], sort_keys=True)}
        for i in range(self.n_cand):
            cand = self.sample(champ, tried)
            tried.add(json.dumps(cand, sort_keys=True))
            self._status(phase=f"probando aspirante {i + 1}/{self.n_cand}", candidate=cand)
            try:
                r = self.evaluate(cand, data, feats, label_cache)
            except Exception as e:  # noqa: BLE001
                log.warning("aspirante %s falló: %s", cand, e)
                continue
            self._log({"time": datetime.now(timezone.utc), "role": "aspirante", **{k: v for k, v in r.items() if k != "equity"}})
            log.info("aspirante %s → score %.2f (campeón %.2f) examen %.0f$", cand, r["score"], cur["score"], r["exam_pnl"])
            if r["score"] > best["score"] + 0.25 and r["exam_pnl"] > 0:
                best = r
        promoted = best is not cur
        if promoted:
            log.info("NUEVO CAMPEÓN: %s", best["params"])
        new = {"params": best["params"], "score": best["score"], "enabled_classes": best["enabled_classes"],
               "since": datetime.now(timezone.utc).isoformat() if promoted or not champ.get("since") else champ["since"]}
        self.champ_path.write_text(json.dumps(new, indent=2))
        Path("web").mkdir(exist_ok=True)
        Path("web/backtest_ml.json").write_text(json.dumps({
            "strategy": "ml", "metrics": best["metrics"], "equity": best["equity"], "by_class": best["by_class"],
            "period": best["period"], "auc": None, "trades": []}, default=str))
        # reentrenar el campeón con lo más reciente + operaciones propias
        self._status(phase="reentrenando al campeón")
        ml = {**self.base, **best["params"], "enabled_classes": best["enabled_classes"],
              "champion_score": best["score"]}
        key = (ml["tp_atr"], ml["sl_atr"], ml["horizon"])
        ds = label_cache[key] if key in label_cache else M.label_dataset(feats, data, ml)
        j = Path("ml_journal.csv")
        tmp = Path(self.base["model_path"]).with_suffix(".tmp")
        meta = M.fit_final(ds, ml, str(tmp), journal=pd.read_csv(j) if j.exists() else None,
                           train_months=ml["train_months"])
        tmp.replace(self.base["model_path"])   # el bot lo recarga en caliente
        n_exp = sum(1 for _ in (DIR / "experiments.jsonl").open()) if (DIR / "experiments.jsonl").exists() else 0
        self._status(phase="esperando al próximo ciclo", last_cycle_minutes=round((time.time() - t0) / 60, 1),
                     champion=new, promoted=promoted, experiments=n_exp, champion_result={
                         k: best[k] for k in ("score", "sel_trades", "sel_pnl", "exam_trades", "exam_pnl", "sharpe", "period")},
                     own_trades=meta["own_trades"], candidate=None)
        return new, promoted

    def loop(self, every_hours: float = 12):
        while True:
            try:
                self.cycle()
            except Exception as e:  # noqa: BLE001
                log.exception("ciclo de investigación falló: %s", e)
                self._status(phase=f"error: {e}")
            time.sleep(every_hours * 3600)
