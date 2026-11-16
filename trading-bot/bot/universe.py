"""Universo de mercados que vigila el bot. Todo lo que tiene datos horarios gratuitos."""
from __future__ import annotations

import logging

log = logging.getLogger(__name__)

STOCKS_US = [  # grandes empresas y valores muy líquidos/volátiles de EEUU
    "AAPL", "MSFT", "NVDA", "AMZN", "GOOGL", "META", "TSLA", "AVGO", "AMD", "NFLX",
    "JPM", "V", "MA", "BAC", "WMT", "COST", "XOM", "CVX", "LLY", "UNH", "JNJ", "PG",
    "KO", "PEP", "DIS", "INTC", "CSCO", "ORCL", "CRM", "ADBE", "QCOM", "MU", "PLTR",
    "COIN", "MSTR", "UBER", "SHOP", "BA", "CAT", "GS", "NKE", "PYPL", "SMCI", "ARM",
    "HOOD", "SOFI", "RIVN", "SNOW", "PANW", "CRWD",
]
STOCKS_EU = [  # España y grandes europeas
    "SAN.MC", "BBVA.MC", "ITX.MC", "IBE.MC", "TEF.MC", "REP.MC", "CABK.MC", "AMS.MC",
    "ASML.AS", "SAP.DE", "SIE.DE", "MC.PA", "TTE.PA", "AIR.PA", "NESN.SW",
]
ETFS = [  # índices, sectores, bonos, materias primas vía ETF
    "SPY", "QQQ", "IWM", "DIA", "XLF", "XLE", "XLK", "XLV", "SMH", "ARKK",
    "TLT", "GLD", "SLV", "USO", "EEM", "EWZ", "FXI", "EWG", "EWP",
]
FOREX = ["EURUSD=X", "GBPUSD=X", "USDJPY=X", "AUDUSD=X", "USDCAD=X", "USDCHF=X",
         "NZDUSD=X", "EURJPY=X", "EURGBP=X", "GBPJPY=X"]
FUTURES = ["GC=F", "SI=F", "CL=F", "NG=F", "HG=F", "ES=F", "NQ=F", "YM=F", "ZC=F", "ZW=F"]

STABLE = {"USDC", "FDUSD", "TUSD", "DAI", "USDP", "BUSD", "EUR", "USD1", "AEUR", "PAXG",
          "XUSD", "USDE", "BFUSD", "WBTC", "WBETH", "RLUSD", "EURI"}


def top_crypto(n: int = 30) -> list[str]:
    """Las n criptos con más volumen en Binance (pares USDT), en formato Yahoo (BTC-USD)."""
    import requests
    try:
        r = requests.get("https://data-api.binance.vision/api/v3/ticker/24hr", timeout=20)
        r.raise_for_status()
        rows = [x for x in r.json() if x["symbol"].endswith("USDT")]
    except Exception as e:  # noqa: BLE001
        log.warning("No se pudo leer el ranking de Binance (%s); uso lista fija", e)
        return [f"{s}-USD" for s in ["BTC", "ETH", "SOL", "BNB", "XRP", "DOGE", "ADA", "AVAX",
                                     "LINK", "DOT", "LTC", "TRX", "SUI", "NEAR", "TON"]][:n]
    out = []
    for x in sorted(rows, key=lambda x: -float(x["quoteVolume"])):
        base = x["symbol"][:-4]
        if base in STABLE or base.endswith(("UP", "DOWN", "BULL", "BEAR")):
            continue
        out.append(f"{base}-USD")
        if len(out) >= n:
            break
    return out


def full_universe(cfg: dict) -> list[str]:
    u = cfg.get("ml", {}).get("markets", {})
    syms: list[str] = []
    if u.get("crypto", 30):
        syms += top_crypto(u.get("crypto", 30))
    if u.get("stocks_us", True):
        syms += STOCKS_US
    if u.get("stocks_eu", True):
        syms += STOCKS_EU
    if u.get("etfs", True):
        syms += ETFS
    if u.get("forex", True):
        syms += FOREX
    if u.get("futures", True):
        syms += FUTURES
    syms += u.get("extra", [])
    return list(dict.fromkeys(syms))
