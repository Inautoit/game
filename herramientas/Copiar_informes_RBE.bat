<# :
@echo off
title Copiar informes RBE de SharePoint a la carpeta de red
powershell -NoProfile -ExecutionPolicy Bypass -Command "$f='%~f0'; iex ((Get-Content -LiteralPath $f -Raw))"
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
# ("Planificacion" con acento), el script la encuentra solo.
$CarpetaRed = "\\fileserver\SSRR_SP\Operaciones Comerciales\INFORMES\Ventas al Portfolio\Planificacion Comercial\Informes"

# =====================================================================
#  A PARTIR DE AQUI NO HACE FALTA TOCAR NADA
# =====================================================================

$ErrorActionPreference = "Stop"

function Escribir($texto, $color = "Gray") { Write-Host $texto -ForegroundColor $color }

function Resolver-Carpeta($ruta) {
    # Prueba la ruta tal cual y, si no existe, con tilde en "Planificacion".
    # La tilde se genera con [char] para no depender de la codificacion del .bat.
    $conTilde = $ruta -replace 'Planificacion', ('Planificaci' + [char]0x00F3 + 'n')
    foreach ($v in @($ruta, $conTilde)) {
        if (Test-Path -LiteralPath $v) { return $v }
    }
    return $null
}

function Obtener-Descargas {
    try { return (New-Object -ComObject Shell.Application).NameSpace('shell:Downloads').Self.Path }
    catch { return (Join-Path $env:USERPROFILE "Downloads") }
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
            return $true
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
    Start-Process $urlDescarga

    Escribir "Esperando a que termine la descarga (max. 2 min)..."
    $descargado = $null
    $limite = (Get-Date).AddMinutes(2)
    while ((Get-Date) -lt $limite -and -not $descargado) {
        Start-Sleep -Seconds 2
        $candidato = Get-ChildItem -LiteralPath $descargas -File -ErrorAction SilentlyContinue |
            Where-Object {
                $_.LastWriteTime -ge $inicio.AddSeconds(-5) -and
                $_.Extension -eq $extension -and
                $_.Name.StartsWith($base)
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
        Escribir "ERROR: no se ha detectado la descarga (revisa si el navegador pide iniciar sesion o confirmar)." Red
        return $false
    }

    Copy-Item -LiteralPath $descargado.FullName -Destination $destino -Force
    Remove-Item -LiteralPath $descargado.FullName -Force -ErrorAction SilentlyContinue
    Escribir "OK (descarga por navegador)" Green
    return $true
}

$carpeta = Resolver-Carpeta $CarpetaRed
if (-not $carpeta) {
    Escribir "No se encuentra la carpeta de red: $CarpetaRed" Red
    Escribir "Comprueba que estas en la red / VPN y que tienes permisos." Red
    return
}
Escribir "Destino: $carpeta"

$ok = 0; $fallos = 0
foreach ($a in $Archivos) {
    try {
        if (Copiar-Archivo $a $carpeta) { $ok++ } else { $fallos++ }
    } catch {
        Escribir "ERROR: $($_.Exception.Message)" Red
        $fallos++
    }
}

Escribir ""
if ($fallos -eq 0) {
    Escribir "HECHO: $ok archivo(s) copiados  ($(Get-Date -Format 'dd/MM/yyyy HH:mm'))" Green
} else {
    Escribir "Terminado con errores: $ok OK, $fallos con fallo." Red
}
