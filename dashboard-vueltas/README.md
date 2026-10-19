# Vueltas de BBDD

Dashboard estático (HTML + JS, sin build) para medir las vueltas que llevamos
sobre la BBDD del mes a partir de los commlogs.

## Reglas de cálculo

| Clasificación   | Valores de key4                      |
|-----------------|--------------------------------------|
| No contacto     | R_ILOC01, R_ILOC02, R_TRA006         |
| Exclusión       | R_NOU_02, R_NOU_03, R_NOU_04         |
| Contacto válido | Cualquier otro valor                 |

- **Rango de fechas** por defecto: del día 15 del mes anterior a la BBDD hasta
  ayer (sin pasar de fin de mes). BBDD de julio → commlogs desde el 15 de junio.
  Se puede cambiar a mano.
- **Excluidas primero**: si una instalación tiene algún commlog de exclusión
  dentro del rango, cuenta como *excluida* y ninguno de sus commlogs cuenta
  como intento.
- **Intentos**: todos los commlogs en rango de instalaciones no excluidas.
- **Ilocalizados antes de contacto**: nº de commlogs de no contacto anteriores
  al primer contacto válido (solo instalaciones contactadas).
- **Vuelta N cubierta**: % de instalaciones gestionables (BBDD − excluidas) con
  ≥ N intentos o ya contactadas. *Vueltas completas* = vueltas cubiertas al 100 %.
- Commlogs de instalaciones que no están en la BBDD se ignoran (se informa del total).

La lógica está en `public/calc.js` y se prueba con `npm test`.

## Fuentes de datos

1. **Ficheros** CSV/Excel de BBDD y commlogs (se procesan en el navegador, no
   se suben a ningún servidor).
2. **Power BI con tu usuario Microsoft**: botón *Leer del dataflow*. Inicia
   sesión con MSAL (delegado, tus permisos) y lanza consultas DAX día a día
   contra el **modelo semántico** que carga el dataflow de commlogs
   (`executeQueries`). La API de Power BI no permite leer filas directamente
   de un dataflow, por eso se consulta a través del modelo.

   Requisitos (una sola vez, en Azure / Entra ID):
   - Registrar una app tipo **SPA** con URI de redirección = la URL del
     dashboard en Cloudflare (y `http://localhost:8788/` para pruebas).
   - Permiso delegado *Power BI Service → Dataset.Read.All*.
   - En el tenant de Power BI: habilitar *Dataset Execute Queries REST API*.
   - Rellenar en el dashboard: Tenant ID, Client ID, Workspace ID, Dataset ID,
     nombre de la tabla y columnas (se guardan en tu navegador).

## Despliegue en Cloudflare Pages

```bash
cd dashboard-vueltas
npx wrangler@3 login          # o CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
npm run deploy                # publica ./public como proyecto "vueltas-bbdd"
```

O desde el panel de Cloudflare: *Workers & Pages → Create → Pages → Connect
to Git*, repo `inautoit/game`, directorio raíz `dashboard-vueltas`, comando de
build vacío, directorio de salida `public`.

Recomendado: proteger la URL con **Cloudflare Access** (login con Microsoft).

## Local

```bash
npm run dev   # http://localhost:8788
```
