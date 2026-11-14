# 🤖 Máquina de trading autónoma

Opera sola, 24/7, en criptomonedas, con operaciones que duran **de horas a pocos días** (velas de 4h).
Decide por sí misma **dónde**, **cuándo** y **cuánto**, y tiene frenos para no arruinarte.

> ⚠️ No es asesoramiento financiero. Ningún sistema garantiza ganancias.
> La mayoría de los bots pierden dinero. Úsala primero SIEMPRE en modo simulado.

## Cómo piensa

| Pregunta | Quién la responde | Cómo |
|---|---|---|
| **¿Dónde?** | `bot/scanner.py` | Vigila los 25 mercados más líquidos y puntúa cada uno por momentum, fuerza de tendencia, volatilidad útil y liquidez. Solo entra en los 6 mejores. |
| **¿Cuándo?** | `bot/strategies.py` | Tres estrategias, cada una con su propio filtro de mercado: **tendencia** (cruce de medias + ADX), **ruptura** (nuevos máximos con volumen) y **reversión a la media** (compra caídas exageradas en mercado lateral). |
| **¿Cuánto?** | `bot/risk.py` | Arriesga el 1 % por operación, máximo 4 posiciones, máximo 25 % del capital en una sola. |
| **¿Cuándo parar?** | `bot/risk.py` | Si pierde un 3 % en un día, deja de abrir. Si cae un 15 % desde el máximo, **cierra todo y se apaga**. |

Todas las salidas usan stop-loss; las de tendencia y ruptura además lo suben a medida que el precio sube (trailing stop).

## Instalación

```bash
cd trader
pip install -r requirements.txt
```

## Uso

```bash
python main.py scan          # dónde ve oportunidades ahora mismo
python main.py backtest      # simulación sobre 3 años de histórico real
python main.py walkforward   # la prueba honesta (ver abajo)
python main.py paper         # opera sola con dinero SIMULADO y precios reales
python main.py live          # dinero REAL (ver "Pasar a real")
python -m pytest             # tests
```

### Backtest vs walk-forward
- **backtest**: prueba unos parámetros fijos en todo el histórico. Es optimista, porque esos parámetros
  pueden estar elegidos "a posteriori".
- **walkforward**: elige los parámetros con 120 días de datos, opera los 30 días siguientes (que no ha visto)
  y avanza. Si una estrategia no funcionó recientemente, **no la usa**. Este resultado es el que cuenta.

Las dos simulaciones compran en la apertura de la vela siguiente a la señal y cobran comisión y slippage en cada operación.

## Pasar a real (solo cuando el modo simulado lleve semanas ganando)

1. Crea una API key en el exchange **con permiso de operar y SIN permiso de retirada**.
2. En `config.yaml`: `mode: live` y `live_max_capital: 100` (lo máximo que puede tocar).
3. Ejecuta:
   ```bash
   export EXCHANGE_API_KEY=...  EXCHANGE_SECRET=...  TRADER_LIVE=SI
   python main.py live
   ```

Para que funcione 24/7, ponla en un servidor (un VPS de ~5 €/mes) con `systemd`, `tmux` o `docker`.

## Avisos al móvil (opcional)
Crea un bot con @BotFather en Telegram y exporta `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`.
Te avisará de cada compra, venta y apagado.

## Archivos que genera
- `state/state_paper.json`: posiciones y capital (si se reinicia, sigue donde lo dejó)
- `state/trades_paper.csv`: historial de operaciones
- `logs/trader.log`: todo lo que hace

## Resultados con precios reales (12 criptomonedas, dic. 2023 – nov. 2026)

Datos honestos, incluidos los malos:

| Prueba | Resultado |
|---|---|
| Velas de 1h, cualquier estrategia, con cualquier comisión | **Pierde** (−5 % a −87 %). Demasiadas operaciones: las comisiones se comen todo. |
| Velas de 4h, comisión 0,26 % (Kraken) | Pierde ligeramente. |
| Velas de 4h, comisión 0,10 % (Binance): tendencia / ruptura | +12 % / +26 % en 3 años, con caídas de hasta −38 %. Comprar y mantener: +38 %. |
| **Walk-forward 4h** (lo que no había visto) | **+19 %** (llegó a +32 %). Mientras, comprar y mantener: −6 %. El freno del −15 % saltó en enero de 2025 y no volvió a operar. |
| Reversión a la media | Pierde en todas las pruebas → desactivada. |

**Conclusión:** la máquina funciona y se protege, pero **todavía no hay pruebas suficientes de que gane
de forma fiable**. Antes de usar dinero real: varias semanas o meses en `paper`.

## Limitaciones conocidas
- En modo real, los stop-loss los vigila el programa cada 30 s; si el servidor se cae, no hay stop
  en el exchange. Usa un servidor fiable.
- Solo compra (no vende en corto): en mercados bajistas largos se queda mayormente en liquidez, que es lo deseado.
- El histórico de prueba es de Binance (USDT). Kraken solo da 720 velas por API, insuficiente para validar.
- Tras un apagado por el freno, hay que reiniciarla a mano (borrar `state/`): es intencionado.
