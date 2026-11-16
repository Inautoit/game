# Atalaya Bot: trading intradía con machine learning

Bot que estudia el mercado, decide y opera a corto plazo (minutos y horas). **Funciona con dinero simulado** (paper trading) y está preparado para conectarse a un broker real más adelante.

> **Aviso importante.** La mayoría de los bots intradía pierden dinero, sobre todo por comisiones y por el ruido del mercado. Este proyecto mide su rendimiento de forma honesta: sólo cuenta el resultado sobre datos que el modelo no vio al entrenar. **No pases a dinero real** hasta tener varios meses de paper trading con resultados positivos y estables, y empieza con una cantidad que puedas permitirte perder.

## Qué incluye

| Pieza | Archivo | Qué hace |
|---|---|---|
| Datos | `bot/data.py` | Yahoo Finance (acciones, ETF, forex, futuros, cripto) y Binance (3+ años de velas de cripto, gratis) |
| Indicadores | `bot/indicators.py` | EMA, RSI, ATR, Bollinger, MACD, ADX, VWAP, rupturas, volumen relativo |
| Estrategias de reglas | `bot/strategies.py` | Tendencia, reversión a la media, ruptura, combinación por votos |
| **Machine learning** | `bot/ml.py` | Modelo de gradient boosting que estima la probabilidad de ganar cada operación |
| Riesgo | `bot/risk.py` | Arriesga un 0,5 % por operación, máximo 4 posiciones, freno diario del 2 % e interruptor de emergencia si cae un 10 % |
| Backtest | `bot/backtest.py` | Simulación vela a vela sin mirar al futuro, con comisiones, deslizamiento, huecos de precio y stops |
| Paper trading | `bot/live.py`, `bot/broker.py` | Opera en vivo con dinero simulado, o con la cuenta paper o real de Alpaca |
| Bot continuo | `bot/runner.py`, `bot/universe.py` | Vigila 134 mercados sin parar, elige las mejores oportunidades y sirve el panel web |
| **Panel web** | `web/` | Radar de oportunidades, posiciones, historial, actividad y validación |

## Cómo aprende el modelo

1. **Histórico**: 1,2 millones de velas de 1 hora de 134 mercados (3 años de cripto vía Binance; 2 años del resto vía Yahoo, el máximo gratuito).
2. **Etiquetado "triple barrera"**: en cada vela se pregunta si, al entrar ahí, el precio habría tocado el objetivo (2×ATR) antes que el stop (1×ATR) en las 16 velas siguientes.
3. **Features**: 32 variables (incluido el tipo de mercado) que no dependen de la escala del precio (retornos medidos en ATR, RSI, ADX, posición en Bollinger, distancia a medias y al VWAP, volatilidad, hora del día, forma de la vela…).
4. **Validación walk-forward**: se entrena con 18 meses y se prueba en el mes siguiente que el modelo no ha visto; luego se avanza un mes y se repite. Se deja un hueco de 2 días para que no se filtre información del futuro.
5. **Decisión**: sólo opera si la probabilidad supera el punto de equilibrio después de comisiones, más un margen de seguridad del 5 %.
6. **Aprendizaje continuo**:
   - El modelo se reentrena cada 24 h con los datos nuevos y con sus propias operaciones, que cuentan el triple (`ml_journal.csv`).

## Uso

```bash
cd trading-bot
pip install -r requirements.txt
```

```bash
python -m pytest -q tests                # tests (sin internet)
python main.py ml-train                  # descarga 3 años, valida, hace backtest y entrena el modelo
python main.py backtest                  # backtest de las estrategias de reglas con datos de Yahoo
python main.py compare                   # compara todas las estrategias
python main.py scan                      # señales actuales de cada activo
python main.py run                       # BOT CONTINUO en 134 mercados + panel en http://localhost:8080
```

## El bot continuo (`python main.py run`)

- Vigila **134 mercados**: las 30 criptos con más volumen, 50 empresas de EE. UU., IBEX y grandes europeas, 19 ETF (índices, oro, petróleo, bonos), 10 pares de divisas y 10 futuros. Puedes añadir más en `config.yaml` → `ml.markets.extra`.
- **Cada minuto** actualiza precios y ejecuta stops y objetivos al instante.
- **Cada vez que cierra una vela** en cualquier mercado, el modelo la analiza, ordena las oportunidades de todos los mercados por esperanza matemática y entra en las mejores (máx. 6 posiciones). Sólo opera en mercados abiertos.
- **Reentrena cada día** con los datos nuevos y con sus propias operaciones.
- Sirve el **panel web** en el puerto 8080 (también desde el móvil, con la IP del servidor).

### Laboratorio de autoentrenamiento (`python main.py research`)

Funciona en paralelo al bot. Cada 12 horas:

1. Descarga los datos nuevos de los 134 mercados.
2. Re-evalúa la estrategia actual (el **campeón**) y prueba 4 variantes (**aspirantes**): objetivo, plazo, exigencia mínima y complejidad del modelo. Siempre lo hace sobre meses que el modelo no vio al entrenar.
3. Un aspirante sólo sustituye al campeón si es claramente mejor **y** gana dinero en los últimos 3 meses (el examen final, que no se usa para elegir). Así evita engañarse con el azar.
4. Desactiva los tipos de mercado que pierden en la validación.
5. Reentrena al campeón con todo lo reciente y con las operaciones propias del bot. El bot carga el modelo nuevo sin pararse.

Todo queda registrado en `research/experiments.jsonl` y se ve en el panel.

### Dejarlo funcionando 24/7

**Guía paso a paso para Oracle Cloud (gratis): [`deploy/ORACLE.md`](deploy/ORACLE.md).**


Necesita un ordenador siempre encendido:

- **Servidor en la nube**: Oracle Cloud "Always Free" (gratis) u otro VPS de 4-5 €/mes (Hetzner, Contabo…). Con Ubuntu:
  ```bash
  curl -O https://raw.githubusercontent.com/Inautoit/game/claude/cool-ramanujan-5tjkw7/trading-bot/deploy/install.sh
  sudo bash install.sh
  ```
  Esto instala el bot como servicio: arranca solo y se reinicia si falla. Abre el puerto 8080 en el firewall del proveedor para ver el panel.
- **Tu PC o una Raspberry Pi**: `python main.py run`, y abre `http://localhost:8080`.

## Resultados de la validación (datos no vistos, nov 2024 – nov 2026, con comisiones)

| Métrica | Valor |
|---|---|
| Rentabilidad | +14,1 % |
| Caída máxima | −10,8 % |
| Operaciones | 663 · acierto 37 % · profit factor 1,11 |
| AUC del modelo | 0,555 largos / 0,534 cortos (0,5 = azar) |

La ventaja existe pero es pequeña y se concentra en acciones de EE. UU. muy volátiles. En cripto, las comisiones se comen casi toda la ventaja en velas de 1 h. **No es suficiente para dinero real**: déjalo meses en simulado.

## Paso a dinero real (en el futuro)

1. Abre una cuenta en un broker con API. Alpaca sirve para acciones de EE. UU. y cripto, y tiene una cuenta paper gratuita.
2. Exporta `ALPACA_API_KEY` y `ALPACA_SECRET_KEY`, pon `mode: alpaca_paper` y deja el bot funcionando semanas.
3. Para dinero real: `mode: live` **y** `export CONFIRMO_DINERO_REAL=si`. Sin las dos cosas, el bot se niega a operar.
4. El adaptador de Alpaca (`bot/broker.py`) aún no se ha probado contra la API real. Valídalo primero en la cuenta paper.
