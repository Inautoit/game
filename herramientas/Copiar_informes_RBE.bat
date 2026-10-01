<# :
@echo off
rem  Doble clic      -> se ejecuta en segundo plano (sin ventana).
rem  Con "/ver"      -> se ejecuta con ventana, para ver que pasa si algo falla.
if /i "%~1"=="/ver" goto :visible
start "" powershell -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -Command "$f='%~f0'; $Oculto=$true; iex ((Get-Content -LiteralPath $f -Raw))"
exit /b
:visible
title Copiar informes RBE de SharePoint a la carpeta de red
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; $Oculto=$false; iex ((Get-Content -LiteralPath $f -Raw))"
echo.
pause
exit /b
#>

# =====================================================================
#  CONFIGURACION  (solo hay que tocar este bloque)
# =====================================================================

# Archivos de SharePoint a copiar (uno por linea, separados por coma).
# Es la URL directa del archivo, NO el enlace de "Compartir".
# Como sacarla: en SharePoint, clic en "..." del archivo > Detalles >
# "Ruta de acceso" (icono de copiar) y anade al final el nombre del archivo.
$Archivos = @(
    "https://verisure.sharepoint.com/sites/VaPFieldMKTCliente/Documentos compartidos/RBE/0_Mapeo_RBE.xlsx",
    "https://verisure.sharepoint.com/sites/VaPFieldMKTCliente/Documentos compartidos/RBE/ALL- Mntos OOCC_Ventas al Portfolio_RBE_mes fijo.xlsx"
)

# Carpeta de red donde se dejan las copias.
# Escribela SIN tildes: si en el servidor la carpeta lleva tilde
# ("Analisis" con acento), el script la encuentra solo.
$CarpetaRed = "\\fileserver\televenta\92 - Analisis piloto RBE\RBE"

# Mostrar un aviso junto al reloj de Windows al terminar ($true / $false)
$AvisoAlTerminar = $true

# =====================================================================
#  A PARTIR DE AQUI NO HACE FALTA TOCAR NADA
# =====================================================================

$ErrorActionPreference = "Stop"

function Escribir($texto, $color = "Gray") {
    if (-not $Oculto) { Write-Host $texto -ForegroundColor $color }
}

function Avisar($titulo, $texto, $esError = $false) {
    if (-not $AvisoAlTerminar) { return }
    try {
        Add-Type -AssemblyName System.Windows.Forms, System.Drawing
        $n = New-Object System.Windows.Forms.NotifyIcon
        $n.Icon = [System.Drawing.SystemIcons]::Information
        $tipo = if ($esError) { 'Error' } else { 'Info' }
        $n.Visible = $true
        $n.ShowBalloonTip(10000, $titulo, $texto, $tipo)
        Start-Sleep -Seconds 10
        $n.Dispose()
    } catch { }
}


function Resolver-Carpeta($ruta) {
    # Prueba la ruta tal cual y, si no existe, con tilde en "Analisis".
    # La tilde se genera con [char] para no depender de la codificacion del .bat.
    $conTilde = $ruta -replace 'Analisis', ('An' + [char]0x00E1 + 'lisis')
    foreach ($v in @($ruta, $conTilde)) {
        if (Test-Path -LiteralPath $v) { return $v }
    }
    return $null
}

function Obtener-Descargas {
    try { return (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path }
    catch { return (Join-Path $env:USERPROFILE "Downloads") }
}

function Copiar-ADestino($origen, $destino) {
    # Reintenta por si el archivo de destino esta abierto en ese momento
    for ($i = 1; $i -le 3; $i++) {
        try { Copy-Item -LiteralPath $origen -Destination $destino -Force; return }
        catch {
            if ($i -eq 3) { throw "no se pudo pegar en la carpeta de red (puede que alguien lo tenga abierto en Excel): $($_.Exception.Message)" }
            Start-Sleep -Seconds 5
        }
    }
}

function Copiar-Archivo($url, $carpeta) {
    $uri          = [Uri]([Uri]::UnescapeDataString($url))
    $servidor     = $uri.Host
    $rutaRelativa = [Uri]::UnescapeDataString($uri.AbsolutePath)
    $nombre       = [IO.Path]::GetFileName($rutaRelativa)
    $destino      = Join-Path $carpeta $nombre

    Escribir ""
    Escribir "=== $nombre ===" Cyan

    # --- Metodo 1: copia directa (WebDAV), sin navegador ---
    try {
        $unc = "\\$servidor@SSL\DavWWWRoot" + ($rutaRelativa -replace '/', '\')
        if (Test-Path -LiteralPath $unc) {
            Copy-Item -LiteralPath $unc -Destination $destino -Force
            Escribir "OK (copia directa)" Green
            return
        }
    } catch { }

    # --- Metodo 2: descarga con el navegador (sesion de Microsoft 365) ---
    Escribir "Copia directa no disponible, descargando con el navegador..." Yellow
    $descargas = Obtener-Descargas
    $base      = [IO.Path]::GetFileNameWithoutExtension($nombre)
    $extension = [IO.Path]::GetExtension($nombre)
    $inicio    = Get-Date

    $sitio = "https://$servidor" + ($rutaRelativa -replace '^(/(sites|teams)/[^/]+).*$', '$1')
    $urlDescarga = "$sitio/_layouts/15/download.aspx?SourceUrl=" + [Uri]::EscapeDataString($rutaRelativa)
    Start-Process $urlDescarga -WindowStyle Minimized

    Escribir "Esperando a que termine la descarga (max. 2 min)..."
    $descargado = $null
    $limite = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $limite -and -not $descargado) {
        Start-Sleep -Seconds 2
        $candidato = Get-ChildItem -LiteralPath $descargas -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.LastWriteTime -ge $inicio.AddSeconds(-5) -and
                $_.Extension -eq $extension -and
                $_.Name.StartsWith($base, [StringComparison]::OrdinalIgnoreCase)
            } |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1

        if ($candidato) {
            # Esperar a que el navegador suelte el archivo
            Start-Sleep -Seconds 2
            try {
                $s = [IO.File]::Open($candidato.FullName, 'Open', 'Read', 'None'); $s.Close()
                $descargado = $candidato
            } catch { }
        }
    }

    if (-not $descargado) {
        throw "no se ha descargado en 2 min (revisa que la URL y el nombre del archivo son correctos)"
    }

    try { Copiar-ADestino $descargado.FullName $destino }
    finally { Remove-Item -LiteralPath $descargado.FullName -Force -ErrorAction SilentlyContinue }
    Escribir "OK (descarga por navegador)" Green
}

$carpeta = Resolver-Carpeta $CarpetaRed
if (-not $carpeta) {
    Escribir "No se encuentra la carpeta de red: $CarpetaRed" Red
    Escribir "Comprueba que estas en la red / VPN y que tienes permisos." Red
    Avisar "Informes RBE" "No se encuentra la carpeta de red (revisa la VPN)." $true
    return
}
Escribir "Destino: $carpeta"

$ok = 0; $errores = @()
foreach ($a in $Archivos) {
    try {
        Copiar-Archivo $a $carpeta
        $ok++
    } catch {
        $nombreArchivo = [IO.Path]::GetFileName([Uri]::UnescapeDataString($a))
        Escribir "ERROR: $($_.Exception.Message)" Red
        $errores += "$nombreArchivo -> $($_.Exception.Message)"
    }
}
$fallos = $errores.Count

Escribir ""
if ($fallos -eq 0) {
    Escribir "HECHO: $ok archivo(s) copiados  ($(Get-Date -Format 'dd/MM/yyyy HH:mm'))" Green
    Avisar "Informes RBE" "$ok archivo(s) copiados a la carpeta de red."
} else {
    Escribir "Terminado con errores: $ok OK, $fallos con fallo." Red
    $detalle = "$ok OK, $fallos con fallo.`n" + ($errores -join "`n")
    if ($detalle.Length -gt 250) { $detalle = $detalle.Substring(0, 247) + "..." }
    Avisar "Informes RBE - errores" $detalle $true
}
