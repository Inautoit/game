# Dashboard Genesys (gestores en tiempo real)

Proyecto independiente del juego que hay en la raíz del repositorio.

```
PC de la oficina (cada 20 min)                          Cloudflare (Worker + KV)
BusinessObjects ─► 5 Excel ─► datos sin teléfonos ─►  /api/upload  ─► "paquete" (directo) + "dia:AAAA-MM-DD"
descargar_dia_completo (-Dia) ─────────────────────►  /api/cierre  ─► "dia:AAAA-MM-DD" (día cerrado, completo)
                                                       /           dashboard general
                                                       /tmk        competición TMK
```

## Web

- URL: https://genesys-dashboard.inautoit.workers.dev (general) y `/tmk` (competición). Misma clave.
- `web/src/worker.js`: subida (`/api/upload`, `/api/cierre?dia=`), login con clave (o Microsoft Entra si se
  ponen `MS_TENANT_ID`, `MS_CLIENT_ID`, `MS_CLIENT_SECRET`), `/api/datos` (`?dia=`, `?p=verificacion`),
  `/api/dias`, `/api/resumen` (resúmenes de días cerrados que calcula el navegador).
- `web/public/app.js`: dashboard general (OP.Comerciales, Agent Group + Skill, Agent State, AUX, Automarcador).
  Selector de día (`DIAS_DESDE`).
- `web/public/tmk.js`: competición TMK. Toda la configuración está arriba en `CONFIG`:
  - `colasOut`: `RBE_Outbound_TMK` (Agent Group + Skill / OUTBOUND, Ind_Agent_015 marcadas, Ind_Agent_016 llamadas).
  - `gestores`: los 6 del grupo RBE_Out_TMK_Piloto (solo cuentan ellos).
  - `campanasAuto`: `C_OC_RBE_Auto` (High y MPA fuera).
  - `desde`: inicio de la competición (2026-09-28).
  - Puntuación provisional: gestiones = llamadas TMK + registros RBE Auto.
- Automarcador: la hora de cada registro es `End_Timestamp` (Start_Timestamp es la carga en cola).
  La pestaña "Llamadas" se carga en BO con retraso; en directo la cifra fiable son los registros.

Secretos del Worker: `UPLOAD_TOKEN` (la usa el PC), `DASHBOARD_PASSWORD`, `SESSION_SECRET`.
Publicar: `cd web && npm install && CLOUDFLARE_API_TOKEN=... npx wrangler deploy`
(token de Cloudflare con la plantilla "Edit Cloudflare Workers").

## PC

- `pc/descargar_informes.ps1` → en el PC se llama `explorar_informe_BO.ps1` (con `$WebToken` relleno).
  Actualiza los 5 informes a hoy en BO (REST Raylight), los convierte, los sube y borra los Excel.
  Credencial de BO cifrada en `bo_credencial.xml` (solo vale para ese usuario de Windows).
- Día completo: el mismo script con `-Dia AAAA-MM-DD` o `-Dia ayer` (copia `descargar_dia_completo.ps1`,
  que sin parámetros descarga ayer). Usa la carpeta `BO_export_dia` y sube a `/api/cierre`.
- Cada 20 min: bucle en una ventana de PowerShell (ver abajo) o `pc/programar_tarea.ps1` (tarea programada;
  ojo: el portátil no puede suspenderse, y la tarea tiene que permitir batería).

```powershell
cd $env:USERPROFILE\Downloads
while ($true) {
    $h = (Get-Date).Hour
    if ($h -ge 7 -and $h -lt 23) { powershell -NoProfile -ExecutionPolicy Bypass -File .\explorar_informe_BO.ps1 | Out-Null }
    Start-Sleep -Seconds ((20 - (Get-Date).Minute % 20) * 60 - (Get-Date).Second)
}
```

## Pendiente

- Cómo se puntúa la competición, qué codificaciones son "contactada" y objetivo diario.
- Rellenar días completos del 28/09 al 12/10 con `descargar_dia_completo.ps1 -Dia ...`.
- Login con Microsoft: falta el registro de la aplicación en Entra ID.
