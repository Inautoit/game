# Programa la descarga automatica cada 20 minutos (de 07:00 a 23:00, todos los dias).
# Ejecutalo UNA vez, en la carpeta donde este el script de descarga:
#     powershell -ExecutionPolicy Bypass -File .\programar_tarea.ps1
# Para quitarla:  Unregister-ScheduledTask -TaskName "Dashboard Genesys" -Confirm:$false

# Se usa la copia MAS RECIENTE del script (la ultima que has descargado). Si hay varias
# ("explorar_informe_BO (1).ps1", "(2)"...), se borran las viejas y la nueva se queda con el nombre fijo.
$Script = Join-Path $PWD "explorar_informe_BO.ps1"
$copias = @(Get-ChildItem $PWD -Filter "explorar_informe_BO*.ps1" | Sort-Object LastWriteTime -Descending)
if ($copias.Count -eq 0) { throw "No encuentro explorar_informe_BO.ps1 en $PWD" }
$nueva = $copias[0]
Write-Host "Script que se va a usar: $($nueva.Name) (descargado $($nueva.LastWriteTime))"
if ($nueva.FullName -ne $Script) {
    $copias | Where-Object { $_.FullName -ne $nueva.FullName } | Remove-Item -Force
    Rename-Item $nueva.FullName "explorar_informe_BO.ps1"
}
$copias | Select-Object -Skip 1 | Where-Object { Test-Path $_.FullName } | Where-Object { $_.FullName -ne $Script } | Remove-Item -Force
Unblock-File $Script -ErrorAction SilentlyContinue   # quita la marca "descargado de Internet"

$accion = New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $PWD `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`""
$disparador = New-ScheduledTaskTrigger -Daily -At "07:00"
$disparador.Repetition = (New-ScheduledTaskTrigger -Once -At "07:00" -RepetitionInterval (New-TimeSpan -Minutes 20) -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition
# Si una ejecucion todavia no ha terminado, la siguiente no se lanza (no se solapan)
$ajustes = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -StartWhenAvailable

Register-ScheduledTask -TaskName "Dashboard Genesys" -Action $accion -Trigger $disparador -Settings $ajustes `
    -Description "Descarga los informes de BusinessObjects y los sube al dashboard" -Force | Out-Null
Write-Host "Tarea 'Dashboard Genesys' programada: cada 20 min de 07:00 a 23:00." -ForegroundColor Green
Write-Host "Puedes verla en el Programador de tareas de Windows."
Write-Host ""
Write-Host "Se lanza ahora una vez para comprobarlo. Aqui veras lo que va haciendo (Ctrl+C para dejar de mirar; la tarea sigue):" -ForegroundColor Cyan
$carpeta = Join-Path $PWD "BO_export"
$antes = Get-Date
Start-ScheduledTask -TaskName "Dashboard Genesys"
$res = $null
for ($i = 0; $i -lt 60 -and -not $res; $i++) {
    Start-Sleep -Seconds 2
    $res = Get-ChildItem $carpeta -Filter "resultado_*.txt" -ErrorAction SilentlyContinue | Where-Object { $_.LastWriteTime -ge $antes.AddSeconds(-5) } |
        Sort-Object LastWriteTime -Descending | Select-Object -First 1
}
if ($res) { Get-Content $res.FullName -Wait -Encoding UTF8 }
else { Write-Host "La tarea no ha escrito nada en 2 minutos. Mira en el Programador de tareas el 'Resultado de la ultima ejecucion'." -ForegroundColor Yellow }
