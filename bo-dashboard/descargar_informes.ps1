# =====================================================================
#  Descarga automatica de informes de SAP BusinessObjects (Genesys)
#  - Entra en BO, actualiza cada informe a fecha de HOY y lo descarga.
#  - Primera ejecucion: pide usuario/contrasena y los guarda CIFRADOS
#    (solo tu usuario de Windows en este PC puede leerlos).
# =====================================================================

# ===== CONFIGURACION =====
$Server  = "http://es1insigen02v:6405/biprws"
$Auth    = "secEnterprise"
$Raiz    = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path }
$Carpeta = Join-Path $Raiz "BO_export"
$CredFile = Join-Path $Raiz "bo_credencial.xml"

# Informes anclados. Usa "id" si lo sabes; si no, "nombre" (admite * como comodin).
# Si un nombre coincide con varios documentos, el script los lista y NO lo descarga:
# copia el id correcto aqui y vuelve a ejecutar.
$Informes = @(
    @{ nombre = "HistReport_Automarcador";    id = 8648842 },
    @{ nombre = "10.Agent_AUX";               id = 5495261 },
    @{ nombre = "Agent State*" },
    @{ nombre = "*Agent*Login*" },
    @{ nombre = "Agent Group + Skill*" },
    @{ nombre = "00.Servicio OP.Comercial*" }
)
# =========================

$ErrorActionPreference = "Stop"
$Hoy    = (Get-Date).ToString("yyyy-MM-dd")
$HoyISO = "$($Hoy)T00:00:00.000Z"
$Sello  = Get-Date -Format "yyyyMMdd_HHmm"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$Log = Join-Path $Carpeta "resultado_$Sello.txt"
function Log($t) { Write-Host $t; Add-Content -Path $Log -Value $t -Encoding UTF8 }
function Corto($s) { $s = "$s"; if ($s.Length -gt 250) { $s.Substring(0, 250) + "..." } else { $s } }
function Limpio($s) { $s -replace '[^\w\.-]', '_' }

# ---------- Credenciales ----------
if (Test-Path $CredFile) {
    $cred = Import-Clixml $CredFile
} else {
    $usuario = Read-Host "Usuario de BusinessObjects"
    $clave   = Read-Host "Contrasena" -AsSecureString
    $cred    = New-Object System.Management.Automation.PSCredential($usuario, $clave)
    if ((Read-Host "Guardar credencial cifrada en este PC para no volver a pedirla? (s/n)") -eq "s") {
        $cred | Export-Clixml $CredFile
    }
}
$h = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }

# ---------- Respuesta automatica a los filtros ----------
function Respuesta($p) {
    $n = "$($p.name)".Trim()
    switch -Regex ($n) {
        '^Pre-set Date Filter'                     { return @("Today") }
        '^(Start|End) Date|^Fecha (Inicio|Fin)'    { return @($HoyISO) }
        '^Franja Inicio'                           { return @("$Hoy 07:00-07:30") }
        '^Franja Fin'                              { return @("$Hoy 23:00-23:30") }
    }
    if ("$($p.answer.'@type')" -match '^Date') { return @($HoyISO) }
    return @($p.answer.values.value | Where-Object { $_ -ne $null })   # se deja como esta
}

function Bajar($uri, $accept, $fichero) {
    $h2 = $h.Clone(); $h2.Remove("Content-Type"); $h2["Accept"] = $accept
    try {
        Invoke-WebRequest -Uri $uri -Headers $h2 -OutFile $fichero -UseBasicParsing -TimeoutSec 600
        Log ("   OK  {0}  ({1} KB)" -f [IO.Path]::GetFileName($fichero), [math]::Round((Get-Item $fichero).Length / 1KB, 1))
    } catch { Log "   NO  $([IO.Path]::GetFileName($fichero)) -> $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
}

function Procesar($id, $nombre) {
    $base = "$Server/raylight/v1/documents/$id"
    $pref = Join-Path $Carpeta ("{0}_{1}" -f (Limpio $nombre), $Sello)
    Log "`n######## $nombre (id=$id)"
    try {
        # 1. Filtros
        $params = @((Invoke-RestMethod -Uri "$base/parameters" -Headers $h).parameters.parameter | Where-Object { $_ })
        $lista = @()
        foreach ($p in $params) {
            if ($p.'@type' -ne 'prompt') { Log "   AVISO: filtro de tipo '$($p.'@type')' ('$($p.name)') sin responder"; continue }
            $vals = @(Respuesta $p)
            if ($vals.Count -eq 0) { Log "   AVISO: filtro '$($p.name)' sin valor" }
            Log "   Filtro '$($p.name)' = $(Corto ($vals -join ', '))"
            $lista += @{ id = $p.id; answer = @{ values = @{ value = $vals } } }
        }
        # 2. Actualizar
        $t0 = Get-Date
        if ($lista.Count -gt 0) {
            $cuerpo = @{ parameters = @{ parameter = $lista } } | ConvertTo-Json -Depth 10
            $resp = Invoke-RestMethod -Method Put -Uri "$base/parameters" -Headers $h -Body $cuerpo -TimeoutSec 900
        } else {
            $resp = Invoke-RestMethod -Method Put -Uri "$base/parameters" -Headers $h -Body '{"parameters":{"parameter":[]}}' -TimeoutSec 900
        }
        Log "   Actualizado en $([int]((Get-Date) - $t0).TotalSeconds) s. Respuesta: $(Corto ($resp | ConvertTo-Json -Depth 4 -Compress))"

        # 3. Descargar: Excel completo + CSV de cada pestana + CSV de cada consulta
        Bajar $base "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" "$pref.xlsx"
        $reps = @((Invoke-RestMethod -Uri "$base/reports" -Headers $h).reports.report | Where-Object { $_ })
        foreach ($r in $reps) { Bajar "$base/reports/$($r.id)" "text/csv" ("{0}_{1}.csv" -f $pref, (Limpio $r.name)) }
        $dps = @((Invoke-RestMethod -Uri "$base/dataproviders" -Headers $h).dataproviders.dataprovider | Where-Object { $_ })
        foreach ($dp in $dps) { Bajar "$base/dataproviders/$($dp.id)/flows/0" "text/csv" ("{0}_datos_{1}.csv" -f $pref, (Limpio $dp.name)) }
    }
    catch { Log "   ERROR: $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
    finally { try { Invoke-RestMethod -Method Put -Uri $base -Headers $h -Body '{"document":{"state":"Unused"}}' | Out-Null } catch {} }
}

# ---------- Programa principal ----------
try {
    $body  = @{ userName = $cred.UserName; password = $cred.GetNetworkCredential().Password; auth = $Auth } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$Server/logon/long" -Headers $h -Body $body
    $h["X-SAP-LogonToken"] = "`"$($login.logonToken)`""
    Log "OK: login correcto ($(Get-Date))"

    $docs = $null
    foreach ($inf in $Informes) {
        if ($inf.id) { Procesar $inf.id $inf.nombre; continue }

        if (-not $docs) {   # lista de documentos, solo si hace falta buscar por nombre
            $docs = @(); $off = 0
            do {
                $pg = @((Invoke-RestMethod -Uri "$Server/raylight/v1/documents?offset=$off&limit=50" -Headers $h).documents.document | Where-Object { $_ })
                $docs += $pg; $off += 50
            } while ($pg.Count -eq 50 -and $off -lt 10000)
        }
        $enc = @($docs | Where-Object { $_.name -like $inf.nombre })
        if ($enc.Count -eq 1) { Procesar $enc[0].id $enc[0].name }
        elseif ($enc.Count -eq 0) { Log "`n######## NO ENCONTRADO: $($inf.nombre)" }
        else {
            Log "`n######## VARIOS CANDIDATOS para '$($inf.nombre)' (pon el id correcto en la configuracion):"
            foreach ($d in $enc) { Log "   id=$($d.id)   $($d.name)" }
        }
    }
}
catch { Log "ERROR: $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
finally {
    if ($h["X-SAP-LogonToken"]) { try { Invoke-RestMethod -Method Post -Uri "$Server/logoff" -Headers $h | Out-Null } catch {} }
    Log "`nFin: $(Get-Date). Archivos en $Carpeta"
}
