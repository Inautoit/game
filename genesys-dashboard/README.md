# Dashboard Genesys (gestores en tiempo real)

Proyecto independiente del juego que hay en la raíz del repositorio.

```
PC de la oficina (cada 15 min)                         Cloudflare
BusinessObjects ─► 5 Excel ─► datos sin teléfonos ─►  Worker /api/upload ─► KV (último paquete)
                                   (gzip)             Dashboard web ◄── /api/datos (con clave)
```

- `pc/descargar_informes.ps1`: entra en BusinessObjects, actualiza los 5 informes a fecha de hoy,
  los descarga, los convierte a datos (quitando `Contact_info`, `LeadID`, `CUST_MKT19`, `ConnID`),
  los sube a la web y borra los Excel si la web confirma.
- `pc/programar_tarea.ps1`: lo programa en Windows cada 15 min, de 07:00 a 23:00.
- `web/`: Worker de Cloudflare (`src/worker.js`) y la web del dashboard (`public/`).

## Web

URL: https://genesys-dashboard.inautoit.workers.dev

Secretos del Worker (Cloudflare → Workers → genesys-dashboard → Settings → Variables and Secrets,
o `npx wrangler secret put NOMBRE`):

| Secreto | Para qué |
|---|---|
| `UPLOAD_TOKEN` | clave que usa el script del PC para subir (`$WebToken`) |
| `DASHBOARD_PASSWORD` | clave para entrar en el dashboard |
| `SESSION_SECRET` | firma de las sesiones (cambiarlo cierra todas las sesiones) |

Publicar cambios:

```
cd genesys-dashboard/web
npm install
npx wrangler deploy
```
