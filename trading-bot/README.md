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
| **Panel web** | `web/` | El bot funcionando en el navegador: precios en directo, señales, posiciones, aprendizaje |

## Cómo aprende el modelo

1. **Histórico de 3 años**: velas de 15 minutos de BTC, ETH, SOL, BNB y XRP descargadas de Binance.
2. **Etiquetado "triple barrera"**: en cada vela se pregunta si, al entrar ahí, el precio habría tocado el objetivo (2×ATR) antes que el stop (1×ATR) en las 8 horas siguientes.
3. **Features**: 28 variables que no dependen de la escala del precio (retornos medidos en ATR, RSI, ADX, posición en Bollinger, distancia a medias y al VWAP, volatilidad, hora del día, forma de la vela…).
4. **Validación walk-forward**: se entrena con 18 meses y se prueba en el mes siguiente que el modelo no ha visto; luego se avanza un mes y se repite. Se deja un hueco de 2 días para que no se filtre información del futuro.
5. **Decisión**: sólo opera si la probabilidad supera el punto de equilibrio después de comisiones, más un margen de seguridad del 5 %.
6. **Aprendizaje continuo**:
   - En Python, el modelo se reentrena cada 24 h con los datos nuevos y con sus propias operaciones, que cuentan el triple (`ml_journal.csv`).
   - En la web, un calibrador online se ajusta con cada vela que se resuelve y con cada operación cerrada.

## Uso

```bash
cd trading-bot
pip install -r requirements.txt scikit-learn
```

```bash
python -m pytest -q tests                # tests (sin internet)
python main.py ml-train                  # descarga 3 años, valida, hace backtest y entrena el modelo
python main.py backtest                  # backtest de las estrategias de reglas con datos de Yahoo
python main.py compare                   # compara todas las estrategias
python main.py scan                      # señales actuales de cada activo
python main.py paper                     # paper trading en vivo (Ctrl+C para parar)
```

Para que `paper` use el modelo de machine learning, pon `strategy.name: ml` en `config.yaml`.

## Panel web

Abre `web/index.html` en el navegador, o publícalo en GitHub Pages (en GitHub: Settings → Pages, y elige la rama y la carpeta). El bot:

- lee precios en directo de la API pública de Binance cada 20 segundos;
- calcula las señales con el mismo modelo (exportado a `web/model.js`; los árboles se ejecutan en JavaScript);
- abre y cierra posiciones simuladas, y guarda el estado en tu navegador;
- muestra el capital, las posiciones, el historial, la actividad y lo que va aprendiendo.

Funciona mientras la pestaña está abierta. Para que opere 24/7 sin el navegador, ejecuta `python main.py paper` en un servidor o en un VPS.

## Paso a dinero real (en el futuro)

1. Abre una cuenta en un broker con API. Alpaca sirve para acciones de EE. UU. y cripto, y tiene una cuenta paper gratuita.
2. Exporta `ALPACA_API_KEY` y `ALPACA_SECRET_KEY`, pon `mode: alpaca_paper` y deja el bot funcionando semanas.
3. Para dinero real: `mode: live` **y** `export CONFIRMO_DINERO_REAL=si`. Sin las dos cosas, el bot se niega a operar.
4. El adaptador de Alpaca (`bot/broker.py`) aún no se ha probado contra la API real. Valídalo primero en la cuenta paper.
