"""Avisos: registra todo en log y, si configuras Telegram, te lo manda al móvil."""
import logging
import os
import requests

log = logging.getLogger("trader")


class Notifier:
    def __init__(self):
        self.token = os.getenv("TELEGRAM_TOKEN")
        self.chat = os.getenv("TELEGRAM_CHAT_ID")

    def send(self, msg: str, important: bool = False):
        (log.warning if important else log.info)(msg)
        if self.token and self.chat:
            try:
                requests.post(f"https://api.telegram.org/bot{self.token}/sendMessage",
                              json={"chat_id": self.chat, "text": msg}, timeout=10)
            except Exception as e:  # un fallo de aviso nunca debe parar la máquina
                log.error(f"Telegram falló: {e}")
