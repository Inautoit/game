# Hoja — álbum digital de trading cards

Tu colección **como un álbum de verdad**: cada carta en su hueco, con su número,
y los huecos vacíos como fichas diseñadas que te dicen qué te falta. Además:
repes, valor de mercado y listas listas para pegar en WhatsApp.

Es un **sitio estático**: HTML, JS y JSON. Se sube tal cual a Cloudflare Pages,
sin servidor, sin funciones y sin nada que mantener corriendo. Y funciona
**entera sin conexión** (PWA instalable): se marcan cartas en el patio del
colegio, sin cobertura, y se sincroniza cuando vuelve.

## Arrancar

```bash
npm install
npm run dev        # http://localhost:3000
npm run preview    # compila y sirve el sitio estático tal como se publicará
```

Sin configurar nada funciona en **modo local**: todo se guarda en IndexedDB de
ese navegador. Para sincronizar entre dispositivos, copia `.env.example` a
`.env.local` y rellena las claves de Supabase.

## Verlo sin instalar nada

`preview/index.html` es una **vista previa de una sola página**: el álbum con el
catálogo real dentro, sin build ni servidor. Se abre haciendo doble clic en el
fichero, o se publica como página suelta en cualquier sitio.

```bash
npm run preview:build    # catálogo -> preview/index.html
```

Es una vista previa, no la app: sirve para enseñársela a alguien por un enlace.
Lo que se marca ahí se guarda en `localStorage` de ese navegador y no sale de
él. La app de verdad es todo lo demás de este directorio.

## Publicar en Cloudflare Pages

```bash
npm run deploy     # compila y sube con wrangler
```

O conectando el repositorio desde el panel de Cloudflare:

| Ajuste | Valor |
|---|---|
| Build command | `npm run build` |
| Build output directory | `out` |
| Root directory | `album` (este proyecto vive en un subdirectorio del repo) |
| Variables de entorno | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (opcionales) |

La versión de Node la fija `.node-version`. Las cabeceras de caché van en
`public/_headers`: los chunks son inmutables y el service worker nunca se
cachea, para que la app no se quede congelada en una versión vieja.

Al ser estático, **cada carta tiene su propia página en disco** (`/card/<id>/`):
los enlaces se comparten, se indexan y cargan sin JavaScript por delante.

## Qué hay montado

| Pantalla | Ruta | Qué hace |
|---|---|---|
| Álbum | `/album/[coleccion]/[vista]/` | La hoja del archivador. Toque corto marca, toque largo abre la ficha |
| Ficha | `/card/[id]/` | Foto propia, cantidad, disponible para cambio, precio con su desglose |
| Faltas | `/faltas/` | Lo que falta, con filtros, indicador de pedible y compartir |
| Repes | `/repes/` | Repes con cantidad y valor estimado del total |
| Valor | `/valor/` | Valor de la colección por tipo de carta y top 10 |
| Sobre | `/sobre/` | Entrada rápida: acabas de abrir un sobre y metes ocho seguidas |
| Entrar | `/login/` | Enlace mágico. Opcional: sin cuenta la app funciona igual |

Falta por construir la fase de **intercambios** (cruce de repes y faltas entre
usuarios, propuestas con estados). El resto del documento de producto está
implementado.

## Cómo está montado

```
app/            rutas (App Router, exportación estática)
components/
  album/        AlbumSheet, CardSlot, EmptySlotArt, OwnedSlotArt, ProgressBar
  card/         CardDetail, PriceBreakdown, PriceHistoryChart
  lists/        faltas y repes
  valor/        pantalla de valor
lib/
  db/           cliente de Supabase (solo navegador)
  offline/      Dexie, cola de sincronización, mutaciones de la colección
  prices/       adaptadores de precio, mediana recortada y agregación
  share/        texto para WhatsApp e imagen dibujada en canvas
  server/       lectura del catálogo en tiempo de build (páginas de carta)
preview/        vista previa de una sola página (plantilla + generado)
scripts/        catálogo, importación, iconos, comprobaciones de precio
worker/         Worker opcional de precios (Cloudflare cron) — ver abajo
supabase/       migraciones SQL con RLS
data/           el catálogo en CSV — ver data/README.md
```

**Los datos del usuario se escriben siempre primero en IndexedDB** y después
salen por una cola de sincronización. Nunca al revés: si la red falla, la app no
se entera.

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
  los últimos 90 días. Es la fuente principal y la más defendible, y **se
  calcula entera en el navegador**: las ventas son de lectura pública, así que
  esta fuente no necesita servidor.
- **Manual** — lo que apuntaste que pagaste.
- **Wallapop y similares** — no se raspan. Hay un botón que abre su buscador con
  el nombre y el número ya rellenados.
- **eBay** — API oficial (Browse). Necesita un secreto, así que vive en el
  Worker opcional. Devuelve anuncios activos, no ventas cerradas: el histórico
  está en Marketplace Insights, que requiere aprobación aparte. Por eso pesa
  menos en la agregación.

```bash
npm run check:prices     # comprobaciones del cálculo de mediana y agregación
```

### El Worker de precios (opcional)

La app no lo necesita. Solo hace falta si quieres precios de eBay, porque eso
requiere credenciales que no pueden vivir en un sitio estático.

```bash
npm run worker:deploy
npx wrangler secret put SUPABASE_URL --config worker/wrangler.jsonc
npx wrangler secret put SUPABASE_SERVICE_ROLE_KEY --config worker/wrangler.jsonc
npx wrangler secret put EBAY_CLIENT_ID --config worker/wrangler.jsonc
npx wrangler secret put EBAY_CLIENT_SECRET --config worker/wrangler.jsonc
npx wrangler secret put PRICE_REFRESH_SECRET --config worker/wrangler.jsonc
```

Corre una vez al día por cron, prioriza las cartas que alguien tiene y respeta
las 24 h de caché por carta y fuente. Nunca se llama desde la petición de un
usuario, porque no hay peticiones de usuario que interceptar.

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
lectura pública. En un sitio estático **RLS es toda la seguridad que hay**, así
que las políticas del fichero 0001 no son opcionales.

En Supabase, añade la URL de tu sitio a *Authentication → URL Configuration →
Redirect URLs* para que funcione el enlace mágico.

## Antes de publicar

1. Rellena y verifica `data/checklist.csv` (ver `data/README.md`): es el cuello
   de botella real del proyecto, no la programación.
2. El nombre de la colección va en la descripción de las fichas
   ("compatible con..."), nunca en el nombre del producto ni en el dominio.
