from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml


def load_config(path: str | Path = "config.yaml") -> dict[str, Any]:
    with open(path, encoding="utf-8") as f:
        cfg = yaml.safe_load(f)
    cfg.setdefault("capital_inicial", 10_000)
    return cfg


def asset_class(symbol: str) -> str:
    s = symbol.upper()
    if s.endswith("=X"):
        return "forex"
    if s.endswith("=F"):
        return "future"
    if s.endswith("-USD") or s.endswith("-USDT") or s.endswith("-EUR"):
        return "crypto"
    return "stock"


def costs_for(cfg: dict, symbol: str) -> tuple[float, float]:
    """Devuelve (comisión, slippage) como fracción (no bps)."""
    c = cfg.get("costs", {}).get(asset_class(symbol), {})
    return c.get("commission_bps", 1.0) / 1e4, c.get("slippage_bps", 2.0) / 1e4
