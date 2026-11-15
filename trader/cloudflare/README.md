# ☁️ La máquina en Cloudflare Workers

Funciona sola en Cloudflare, sin servidor propio y sin tener el ordenador encendido.

- **Panel:** https://maquina-trader.inautoit.workers.dev
- **Modo:** SIMULADO. Seis traders compiten, cada uno con 1.000 $ ficticios, precios reales y comisiones simuladas.
- **Panel con dos pestañas:** *Resumen* (sencillo: quién gana, qué hace cada uno) y *Detalle* (todo: radar de precios,
  tasas de financiación, parejas, posiciones, operaciones, registro y estado de cada fuente de datos).

| Trader | Qué hace | Prueba con datos reales |
|---|---|---|
| 🐢 Prudente | Rupturas y tendencias, velas de 4 h | +19 % en 3 años (walk-forward) |
| 🐇 Rápido | Igual, velas de 1 h | −18 % a −57 % en 3 años |
| ⚡ Scalper | Igual, velas de 15 min | −93 % en 1 año |
| 📡 Arbitrajista | Compra donde está barato y vende donde está caro, entre 7 exchanges | Solo medible en directo |
| 💰 Cobrador | Compra al contado + vende en perpetuo: cobra la financiación sin apostar por el precio | +5,5 % en 3 años, caída máx. 0,4 % |
| 🔗 Estadístico | Pares de monedas correlacionadas que se separan (z-score) | −26 % en 3 años (+36 % sin comisiones) |

**Fuentes (desde Cloudflare, EE. UU.):** precios de Kraken, Coinbase, OKX, Bitfinex, MEXC, HTX y Crypto.com;
financiación de Hyperliquid, Kraken Futures y MEXC Futuros. Binance, Bybit y Bitget bloquean a Cloudflare.

Cada 5 min: precios de los 7 exchanges, financiación, stop-loss, arbitraje y cobro. Al cerrar su vela decide
el trader direccional que toca; el Estadístico decide cada hora con las velas de 1 h.

## Archivos
| Archivo | Qué es |
|---|---|
| `lib.js` | Estrategias, escáner y riesgo: port exacto de la versión Python |
| `pro.js` | Arbitraje, financiación y pares (lógica pura) |
| `worker.js` | Motor (cron), datos de Kraken y API del panel |
| `dashboard.html` | Panel web (se empaqueta en `dashboard.js` con `node build.mjs`) |
| `deploy.sh` | Sube todo a Cloudflare |
| `parity_gen.py` + `parity_test.mjs` | Comprueba que JS y Python dan las mismas señales |
| `worker_test.mjs` | Prueba el Worker sin red (compra, stop, freno, panel) |
| `pro_test.mjs` | Prueba arbitraje, financiación y pares con casos controlados |

## Comandos
```bash
node worker_test.mjs && node pro_test.mjs              # tests del Worker
python3 parity_gen.py && node parity_test.mjs          # paridad con Python (necesita los datos de backtest)
CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=... ./deploy.sh   # desplegar
```

## Avisos al móvil
Añade al Worker los secretos `TELEGRAM_TOKEN` y `TELEGRAM_CHAT_ID`
(panel de Cloudflare → Workers → maquina-trader → Settings → Variables and Secrets).

## Reiniciar la simulación
Borra la clave `traders` (y `trades:<id>`) del KV `maquina-trader-estado`.

## Por qué Kraken y no Binance
Binance bloquea las IPs de Cloudflare (responde 403). Para operar con dinero real en Binance hace falta
la versión Python (`../main.py live`) en un servidor de un país permitido.
