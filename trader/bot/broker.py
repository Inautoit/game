"""Ejecución de órdenes. PaperBroker = dinero simulado con precios reales. LiveBroker = dinero real."""
import os


class PaperBroker:
    """Simula compras/ventas con los precios reales del exchange, comisión y slippage incluidos."""
    live = False

    def __init__(self, exchange, cash: float, fee: float, slippage: float):
        self.ex, self._cash, self.fee, self.slip = exchange, cash, fee, slippage

    def price(self, symbol):
        t = self.ex.fetch_ticker(symbol)
        return t.get("last") or t.get("close")

    def cash(self):
        return self._cash

    def buy(self, symbol, qty):
        t = self.ex.fetch_ticker(symbol)
        px = (t.get("ask") or t["last"]) * (1 + self.slip)
        qty = min(qty, self._cash / (px * (1 + self.fee)))
        fee = qty * px * self.fee
        self._cash -= qty * px + fee
        return px, qty, fee

    def sell(self, symbol, qty):
        t = self.ex.fetch_ticker(symbol)
        px = (t.get("bid") or t["last"]) * (1 - self.slip)
        fee = qty * px * self.fee
        self._cash += qty * px - fee
        return px, qty, fee

    def to_state(self):
        return {"cash": self._cash}

    def load_state(self, st):
        if st and "cash" in st:
            self._cash = st["cash"]


class LiveBroker:
    """Órdenes reales a mercado. Solo se activa con mode: live en config Y la variable TRADER_LIVE=SI."""
    live = True

    def __init__(self, exchange, quote: str, max_capital: float, fee: float):
        if os.getenv("TRADER_LIVE") != "SI":
            raise RuntimeError("Modo real bloqueado: exporta TRADER_LIVE=SI si de verdad quieres usar dinero real.")
        self.ex, self.quote, self.max_capital, self.fee = exchange, quote, max_capital, fee
        self.spent = 0.0  # lo invertido ahora mismo, para no superar max_capital

    def price(self, symbol):
        return self.ex.fetch_ticker(symbol)["last"]

    def cash(self):
        free = self.ex.fetch_balance()["free"].get(self.quote, 0.0)
        return max(0.0, min(free, self.max_capital - self.spent))

    def _fill(self, order, symbol, side):
        o = self.ex.fetch_order(order["id"], symbol) if order.get("average") is None else order
        px, qty = o.get("average") or o.get("price"), o.get("filled") or o.get("amount")
        fee = (o.get("fee") or {}).get("cost") or qty * px * self.fee
        return px, qty, fee

    def buy(self, symbol, qty):
        qty = float(self.ex.amount_to_precision(symbol, qty))
        px, q, fee = self._fill(self.ex.create_market_buy_order(symbol, qty), symbol, "buy")
        self.spent += q * px
        return px, q, fee

    def sell(self, symbol, qty):
        free = self.ex.fetch_balance()["free"].get(symbol.split("/")[0], 0.0)
        qty = float(self.ex.amount_to_precision(symbol, min(qty, free)))
        px, q, fee = self._fill(self.ex.create_market_sell_order(symbol, qty), symbol, "sell")
        self.spent = max(0.0, self.spent - q * px)
        return px, q, fee

    def to_state(self):
        return {"spent": self.spent}

    def load_state(self, st):
        self.spent = (st or {}).get("spent", 0.0)
