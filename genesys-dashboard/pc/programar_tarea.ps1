# Programa la descarga automatica cada 15 minutos (de 07:00 a 23:00, todos los dias).
# Ejecutalo UNA vez, en la carpeta donde este el script de descarga:
#     powershell -ExecutionPolicy Bypass -File .\programar_tarea.ps1
# Para quitarla:  Unregister-ScheduledTask -TaskName "Dashboard Genesys" -Confirm:$false

$Script = Join-Path $PWD "explorar_informe_BO.ps1"      # cambia el nombre si tu script se llama distinto
if (-not (Test-Path $Script)) { throw "No encuentro $Script" }

$accion = New-ScheduledTaskAction -Execute "powershell.exe" -WorkingDirectory $PWD `
    -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$Script`""
$disparador = New-ScheduledTaskTrigger -Daily -At "07:00"
$disparador.Repetition = (New-ScheduledTaskTrigger -Once -At "07:00" -RepetitionInterval (New-TimeSpan -Minutes 15) -RepetitionDuration (New-TimeSpan -Hours 16)).Repetition
# Si una ejecucion todavia no ha terminado, la siguiente no se lanza (no se solapan)
$ajustes = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -ExecutionTimeLimit (New-TimeSpan -Minutes 30) -StartWhenAvailable

Register-ScheduledTask -TaskName "Dashboard Genesys" -Action $accion -Trigger $disparador -Settings $ajustes `
    -Description "Descarga los informes de BusinessObjects y los sube al dashboard" -Force | Out-Null
Write-Host "Tarea 'Dashboard Genesys' programada: cada 15 min de 07:00 a 23:00." -ForegroundColor Green
Write-Host "Puedes verla en el Programador de tareas de Windows."
