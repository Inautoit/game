# ☁️ La máquina en Cloudflare Workers

Funciona sola en Cloudflare, sin servidor propio y sin tener el ordenador encendido.

- **Panel:** https://maquina-trader.inautoit.workers.dev
- **Modo:** SIMULADO. Tres traders compiten, cada uno con 1.000 $ ficticios, precios reales de Kraken y comisión simulada del 0,10 %:
  | Trader | Velas | Resultado en pruebas con datos reales |
  |---|---|---|
  | 🐢 Prudente | 4 h | +19 % en walk-forward de 3 años (el validado) |
  | 🐇 Rápido | 1 h | −18 % a −57 % en 3 años |
  | ⚡ Scalper | 15 min | −93 % en 1 año (~9 operaciones/día) |
- **Cada 5 min** revisa los stop-loss de todos. Cuando cierra la vela de un trader, ese trader escanea 20 mercados y decide.
- El panel muestra la clasificación, la actividad en directo y, para cada mercado, por qué compra o no.
- Estado guardado en Cloudflare KV (`maquina-trader-estado`).

## Archivos
| Archivo | Qué es |
|---|---|
| `lib.js` | Estrategias, escáner y riesgo: port exacto de la versión Python |
| `worker.js` | Motor (cron), datos de Kraken y API del panel |
| `dashboard.html` | Panel web (se empaqueta en `dashboard.js` con `node build.mjs`) |
| `deploy.sh` | Sube todo a Cloudflare |
| `parity_gen.py` + `parity_test.mjs` | Comprueba que JS y Python dan las mismas señales |
| `worker_test.mjs` | Prueba el Worker sin red (compra, stop, freno, panel) |

## Comandos
```bash
node worker_test.mjs                                   # tests del Worker
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
