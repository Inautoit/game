# Hoja — álbum digital de trading cards

Tu colección **como un álbum de verdad**: cada carta en su hueco, con su número,
y los huecos vacíos como fichas diseñadas que te dicen qué te falta. Además:
repes, valor de mercado y listas listas para pegar en WhatsApp.

Funciona **entera sin conexión** (PWA instalable): se marcan cartas en el patio
del colegio, sin cobertura, y se sincroniza cuando vuelve.

## Arrancar

```bash
npm install
npm run catalog      # CSV -> public/catalog/<slug>.json
npm run dev          # http://localhost:3000
```

Sin configurar nada funciona en **modo local**: todo se guarda en IndexedDB de
ese navegador. Para sincronizar entre dispositivos, copia `.env.example` a
`.env.local` y rellena las claves de Supabase.

## Qué hay montado

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Álbum | `/album/[coleccion]/[vista]` | La hoja del archivador. Toque corto marca, toque largo abre la ficha |
| Ficha | `/card/[id]` | Foto propia, cantidad, disponible para cambio, precio con su desglose |
| Faltas | `/faltas` | Lo que falta, con filtros, indicador de pedible y compartir |
| Repes | `/repes` | Repes con cantidad y valor estimado del total |
| Valor | `/valor` | Valor de la colección por tipo de carta y top 10 |
| Sobre | `/sobre` | Entrada rápida: acabas de abrir un sobre y metes ocho seguidas |
| Entrar | `/login` | Magic link. Opcional: sin cuenta la app funciona igual |

Falta por construir la fase de **intercambios** (cruce de repes y faltas entre
usuarios, propuestas con estados). El resto del documento de producto está
implementado.

## Cómo está montado

```
app/            rutas (App Router) + /api/prices/refresh y /api/share/faltas
components/
  album/        AlbumSheet, CardSlot, EmptySlotArt, OwnedSlotArt, ProgressBar
  card/         CardDetail, PriceBreakdown, PriceHistoryChart
  lists/        faltas y repes
  valor/        pantalla de valor
lib/
  db/           clientes de Supabase (navegador, servidor, servicio)
  offline/      Dexie, cola de sincronización, mutaciones de la colección
  prices/       adaptadores de precio, mediana recortada y agregación
  share/        texto para WhatsApp
  server/       catálogo en el servidor (SSR de las fichas)
scripts/        catálogo, importación, iconos, comprobaciones de precio
supabase/       migraciones SQL con RLS
data/           el catálogo en CSV — ver data/README.md
```

**Los datos del usuario se escriben siempre primero en IndexedDB** y después
salen por una cola de sincronización. Nunca al revés: si la red falla, la app
no se entera.

### Las imágenes

Las imágenes de las cartas son propiedad de sus fabricantes y clubes. Aquí no se
publica ninguna:

- **Tu foto** — lo que se ve en los huecos que tienes es la foto que haces tú,
  en tu cuenta. Recortada a 63×88 y comprimida en el cliente antes de subirla.
- **Hueco vacío** — no es una imagen: es un componente generado con el número,
  el jugador, el equipo y el color del club. Diseño propio.
- **Sin foto todavía** — mismo tratamiento generado, pero lleno y con el color
  del club, para que se vea que ese hueco ya está ocupado.

### Los precios

Cada precio se muestra **siempre** con su fuente, su fecha y el tamaño de la
muestra, y con el aviso de que es una estimación y no una tasación.

- **Comunidad** — ventas reportadas por usuarios. Mediana recortada al 10% de
  los últimos 90 días. Es la fuente principal y la más defendible.
- **eBay** — API oficial (Browse). Devuelve anuncios activos, no ventas
  cerradas: el histórico de ventas está en Marketplace Insights, que requiere
  aprobación aparte. Por eso pesa menos en la agregación.
- **Manual** — lo que apuntaste que pagaste.
- **Wallapop y similares** — no se raspan. Hay un botón que abre su buscador con
  el nombre y el número ya rellenados.

El refresco va en un job (`/api/prices/refresh`, protegido por
`PRICE_REFRESH_SECRET`, programado en `vercel.json`), nunca en la petición del
usuario. Un snapshot por carta y fuente cada 24 h como mucho, priorizando las
cartas que alguien tiene.

```bash
npm run check:prices     # comprobaciones del cálculo de mediana y agregación
```

## Supabase

```bash
# 1. Ejecuta las migraciones en tu proyecto
supabase/migrations/0001_init.sql      # esquema, vistas y RLS
supabase/migrations/0002_storage.sql   # bucket de fotos y sus políticas

# 2. Sube el catálogo (idempotente: los ids son deterministas)
SUPABASE_SERVICE_ROLE_KEY=... npm run import:checklist
```

RLS activo en `profiles`, `user_cards` y `community_sales`: cada usuario solo lee
y escribe lo suyo. El catálogo (`collections`, `series`, `teams`, `cards`) es de
lectura pública.

## Antes de publicar

1. Rellena y verifica `data/checklist.csv` (ver `data/README.md`): es el cuello
   de botella real del proyecto, no la programación.
2. En `vercel.json`, el cron necesita `PRICE_REFRESH_SECRET` en el entorno; en
   Vercel se corresponde con `CRON_SECRET`.
3. El nombre de la colección va en la descripción de las fichas
   ("compatible con..."), nunca en el nombre del producto ni en el dominio.
