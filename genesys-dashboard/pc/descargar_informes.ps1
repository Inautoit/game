# =====================================================================
#  Descarga automatica de informes de SAP BusinessObjects (Genesys)
#  - Entra en BO, actualiza cada informe a fecha de HOY y lo descarga (Excel).
#  - Los informes se actualizan EN PARALELO (ver $MaxParalelo).
#  - Convierte los Excel a datos (quitando telefonos de clientes), los sube a la
#    web del dashboard y, si la web confirma, borra los Excel de BO_export.
#  - Primera ejecucion: pide usuario/contrasena y los guarda CIFRADOS
#    (solo tu usuario de Windows en este PC puede leerlos).
# =====================================================================
param([string]$WorkerId, [string]$WorkerNombre, [string]$Sello, [string]$Raiz, $Cred)

# ===== CONFIGURACION =====
$Server      = "http://es1insigen02v:6405/biprws"
$Auth        = "secEnterprise"
$MaxParalelo = 5      # informes a la vez (baja a 2-3 si el servidor BO va lento o da errores)

# Subida a la web del dashboard. Mientras $WebUrl este vacio, no se sube ni se borra nada.
$WebUrl          = "https://genesys-dashboard.inautoit.workers.dev/api/upload"
$WebToken        = ""     # PEGA AQUI la clave de subida (UPLOAD_TOKEN). No la subas a GitHub.
$BorrarTrasSubir = $true  # borra los Excel de BO_export SOLO si la web confirma que los ha recibido
# Columnas con datos personales de clientes que NUNCA salen del PC
$QuitarColumnas  = @("Contact_info", "LeadID", "CUST_MKT19", "ConnID")

# Informes anclados. Usa "id" si lo sabes; si no, "nombre" (admite * como comodin)
# y "pestanas" para distinguir entre copias con el mismo nombre.
$Informes = @(
    # Automarcador: se fuerzan los filtros con los que ya funciono (Today + fechas de hoy)
    @{ nombre = "HistReport_Automarcador";    id = 8648842; respuestas = @{
        "Pre-set Date Filter:" = @("Today")
        "Start Date:" = @((Get-Date).ToString("yyyy-MM-dd") + "T00:00:00.000Z")
        "End Date:"   = @((Get-Date).ToString("yyyy-MM-dd") + "T00:00:00.000Z") } },
    @{ nombre = "10.Agent_AUX";               id = 5495261 },
    # Sin id: se busca por nombre y, si hay varias copias, por las pestanas que tiene
    @{ nombre = "Agent State*";               pestanas = @("Agent States", "Login Time") },
    @{ nombre = "Agent Group + Skill - v2.3_06"; pestanas = @("INBOUND", "OUTBOUND") },   # nombre exacto
    @{ nombre = "00.Servicio OP.Comercial*";  pestanas = @("LlamInbound", "TiemposInb", "TiemposOut", "Chat", "Email", "Callback", "Tareas") }
)
# =========================

$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try { [Net.WebRequest]::DefaultWebProxy.Credentials = [Net.CredentialCache]::DefaultNetworkCredentials } catch {}   # proxy de empresa
if (-not $Raiz)  { $Raiz  = if ($PSScriptRoot) { $PSScriptRoot } else { $PWD.Path } }
if (-not $Sello) { $Sello = Get-Date -Format "yyyyMMdd_HHmm" }
$Carpeta  = Join-Path $Raiz "BO_export"
$CredFile = Join-Path $Raiz "bo_credencial.xml"
$IdsFile  = Join-Path $Raiz "bo_ids.json"
$Hoy      = (Get-Date).ToString("yyyy-MM-dd")
$HoyISO   = "$($Hoy)T00:00:00.000Z"
New-Item -ItemType Directory -Force -Path $Carpeta | Out-Null
$Log = if ($WorkerId) { Join-Path $Carpeta "_parcial_$($WorkerId).txt" } else { Join-Path $Carpeta "resultado_$Sello.txt" }

function Log($t) {
    $t = if ($WorkerId) { "[$WorkerNombre] $t" } else { $t }
    Write-Host $t; Add-Content -Path $Log -Value $t -Encoding UTF8
}
function Corto($s) { $s = "$s"; if ($s.Length -gt 250) { $s.Substring(0, 250) + "..." } else { $s } }
function Limpio($s) { ($s -replace '[\\/:*?"<>|]', '_').Trim() }
$h = @{ "Accept" = "application/json"; "Content-Type" = "application/json" }

function Entrar($c) {
    $body  = @{ userName = $c.UserName; password = $c.GetNetworkCredential().Password; auth = $Auth } | ConvertTo-Json
    $login = Invoke-RestMethod -Method Post -Uri "$Server/logon/long" -Headers $h -Body $body
    $h["X-SAP-LogonToken"] = "`"$($login.logonToken)`""
}
function Salir() {
    if ($h["X-SAP-LogonToken"]) { try { Invoke-RestMethod -Method Post -Uri "$Server/logoff" -Headers $h | Out-Null } catch {} }
}

# ---------- Respuesta automatica a los filtros ----------
function Respuesta($p) {
    $n      = "$($p.name)".Trim()
    $tipo   = "$($p.answer.'@type')"
    $actual = @($p.answer.values.value | Where-Object { $_ -ne $null })
    $hoy    = Get-Date
    $HoyISO    = $hoy.ToString("yyyy-MM-dd") + "T00:00:00.000Z"
    $MananaISO = $hoy.AddDays(1).ToString("yyyy-MM-dd") + "T00:00:00.000Z"
    $esFin  = $n -match '(?i)\b(end|fin|hasta|to)\b'

    # 1. Filtros conocidos
    if ($n -match '(?i)^Pre-set Date Filter') { return @("None") }            # fechas explicitas, igual que a mano
    if ($n -match '(?i)^Franja Inicio')       { return @($hoy.ToString("yyyy-MM-dd") + " 06:00-06:30") }
    if ($n -match '(?i)^Franja Fin')          { return @($hoy.ToString("yyyy-MM-dd") + " 23:00-23:30") }
    # 2. Filtros de tipo fecha: inicio = hoy, fin = manana (asi entra el dia de hoy completo)
    if ($tipo -match '^Date')                 { if ($esFin) { return @($MananaISO) } else { return @($HoyISO) } }
    # 3. Dia / mes / ano sueltos
    if ($n -match '(?i)^(d(i|\u00ed)a|day)\b')  { return @($hoy.Day.ToString()) }
    if ($n -match '(?i)^(mes|month)\b') {
        if ("$($actual[0])" -match '^\d{4}-\d{2}$') { return @($hoy.ToString("yyyy-MM")) } else { return @($hoy.Month.ToString()) } }
    if ($n -match '(?i)^(a(n|\u00f1)o|year)\b') { return @($hoy.Year.ToString()) }
    # 4. Cualquier otro filtro cuyo valor lleve una fecha escrita: se cambia esa fecha por la de hoy
    #    (2026-09-21 -> hoy, 21/09/2026 -> hoy), manteniendo el resto del texto
    $cambiados = @($actual | ForEach-Object {
        $v = "$_"
        $v = [regex]::Replace($v, '\d{4}-\d{2}-\d{2}', $hoy.ToString("yyyy-MM-dd"))
        [regex]::Replace($v, '\d{2}/\d{2}/\d{4}', $hoy.ToString("dd/MM/yyyy"))
    })
    return $cambiados   # sin fecha dentro: se deja como esta (campanas, zona horaria, empleados...)
}

# Cuenta las filas de cada pestana de un .xlsx (sin necesitar Excel instalado)
function Filas($fichero) {
    try {
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        $zip = [IO.Compression.ZipFile]::OpenRead($fichero)
        $leer = { param($e) $r = New-Object IO.StreamReader($e.Open()); $t = $r.ReadToEnd(); $r.Close(); $t }
        $nombres = [regex]::Matches((& $leer ($zip.GetEntry("xl/workbook.xml"))), '<sheet [^>]*name="([^"]*)"') | ForEach-Object { $_.Groups[1].Value }
        $res = @(); $i = 1
        foreach ($n in $nombres) {
            $e = $zip.GetEntry("xl/worksheets/sheet$i.xml"); $i++
            $c = if ($e) { [regex]::Matches((& $leer $e), '<row[ >]').Count } else { "?" }
            $res += "$n=$c"
        }
        $zip.Dispose()
        $res -join ', '
    } catch { "no se pudo contar ($($_.Exception.Message))" }
}

function Bajar($uri, $accept, $fichero) {
    $h2 = $h.Clone(); $h2.Remove("Content-Type"); $h2["Accept"] = $accept
    try {
        # se descarga a .tmp y luego se renombra: nunca queda un Excel a medias
        Invoke-WebRequest -Uri $uri -Headers $h2 -OutFile "$fichero.tmp" -UseBasicParsing -TimeoutSec 600
        Move-Item "$fichero.tmp" $fichero -Force
        Log ("   OK  {0}  ({1} KB)" -f [IO.Path]::GetFileName($fichero), [math]::Round((Get-Item $fichero).Length / 1KB, 1))
        Log "   Filas por pestana: $(Filas $fichero)"
        return $true
    } catch { Log "   NO  $([IO.Path]::GetFileName($fichero)) -> $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")"; return $false }
}

function Procesar($id, $nombre) {
    $base = "$Server/raylight/v1/documents/$id"
    Log "Empezando (id=$id)"
    try {
        # 1. Filtros
        $params = @((Invoke-RestMethod -Uri "$base/parameters" -Headers $h).parameters.parameter | Where-Object { $_ })
        $lista = @()
        foreach ($p in $params) {
            if ($p.'@type' -ne 'prompt') { Log "   AVISO: filtro de tipo '$($p.'@type')' ('$($p.name)') sin responder"; continue }
            $conf = $Informes | Where-Object { "$($_.id)" -eq "$id" } | Select-Object -First 1
            if ($conf -and $conf.respuestas -and $conf.respuestas.ContainsKey("$($p.name)")) { $vals = @($conf.respuestas["$($p.name)"]) }
            else { $vals = @(Respuesta $p) }
            if ($vals.Count -eq 0) { Log "   AVISO: filtro '$($p.name)' sin valor" }
            $antes = @($p.answer.values.value | Where-Object { $_ -ne $null }) -join ', '
            Log "   Filtro '$($p.name)' = $(Corto ($vals -join ', '))   (antes: $(Corto $antes))"
            $lista += @{ id = $p.id; answer = @{ values = @{ value = $vals } } }
        }
        if ($params.Count -eq 0) { Log "   AVISO: este informe no pide filtros; si la fecha esta fija dentro de la consulta, no se puede cambiar desde aqui" }
        # 2. Actualizar
        Log "   Actualizando..."
        $t0 = Get-Date
        $cuerpo = if ($lista.Count -gt 0) { @{ parameters = @{ parameter = $lista } } | ConvertTo-Json -Depth 10 } else { '{"parameters":{"parameter":[]}}' }
        $resp = Invoke-RestMethod -Method Put -Uri "$base/parameters" -Headers $h -Body $cuerpo -TimeoutSec 1800
        Log "   Actualizado en $([int]((Get-Date) - $t0).TotalSeconds) s. Respuesta: $(Corto ($resp | ConvertTo-Json -Depth 4 -Compress))"

        # 3. Descargar UN Excel con todas las pestanas (igual que a mano).
        #    Nombre fijo: cada ejecucion sustituye al anterior.
        $fichero = Join-Path $Carpeta "$(Limpio $nombre).xlsx"
        [void](Bajar $base "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" $fichero)
        Log "TERMINADO"
    }
    catch { Log "   ERROR: $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
    finally { try { Invoke-RestMethod -Method Put -Uri $base -Headers $h -Body '{"document":{"state":"Unused"}}' | Out-Null } catch {} }
}

# =====================================================================
#  CONVERSION Excel -> datos del dashboard, y SUBIDA a la web
#  (lo hace el proceso principal cuando ya han terminado todas las descargas)
# =====================================================================
$CodigoConversor = @'
using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.IO.Compression;
using System.Text;
using System.Xml;

public static class BoXlsx
{
    const string RelNs = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

    static void Esc(StringBuilder sb, string s)
    {
        if (s == null) { sb.Append("null"); return; }
        sb.Append('"');
        foreach (char ch in s)
        {
            switch (ch)
            {
                case '"': sb.Append("\\\""); break;
                case '\\': sb.Append("\\\\"); break;
                case '\n': sb.Append("\\n"); break;
                case '\r': sb.Append("\\r"); break;
                case '\t': sb.Append("\\t"); break;
                default:
                    if (ch < 0x20) sb.Append("\\u").Append(((int)ch).ToString("x4")); else sb.Append(ch);
                    break;
            }
        }
        sb.Append('"');
    }

    static int ColIndex(string r)
    {
        int n = 0;
        foreach (char ch in r) { if (ch >= 'A' && ch <= 'Z') n = n * 26 + (ch - 'A' + 1); else break; }
        return n - 1;
    }

    static XmlReader Lector(ZipArchiveEntry e)
    {
        XmlReaderSettings s = new XmlReaderSettings();
        s.DtdProcessing = DtdProcessing.Prohibit;
        return XmlReader.Create(e.Open(), s);
    }

    static XmlDocument Documento(ZipArchiveEntry e)
    {
        XmlDocument d = new XmlDocument();
        d.XmlResolver = null;
        using (XmlReader xr = Lector(e)) d.Load(xr);
        return d;
    }

    static bool EsTexto(XmlNodeType t)
    {
        return t == XmlNodeType.Text || t == XmlNodeType.CDATA || t == XmlNodeType.Whitespace || t == XmlNodeType.SignificantWhitespace;
    }

    static List<string> TextosCompartidos(ZipArchive zip)
    {
        List<string> res = new List<string>();
        ZipArchiveEntry e = zip.GetEntry("xl/sharedStrings.xml");
        if (e == null) return res;
        using (XmlReader xr = Lector(e))
        {
            StringBuilder cur = null; bool enT = false; int enRph = 0;
            while (xr.Read())
            {
                if (xr.NodeType == XmlNodeType.Element)
                {
                    if (xr.LocalName == "si") { if (xr.IsEmptyElement) res.Add(""); else cur = new StringBuilder(); }
                    else if (xr.LocalName == "rPh" && !xr.IsEmptyElement) enRph++;
                    else if (xr.LocalName == "t" && enRph == 0 && !xr.IsEmptyElement) enT = true;
                }
                else if (xr.NodeType == XmlNodeType.EndElement)
                {
                    if (xr.LocalName == "si" && cur != null) { res.Add(cur.ToString()); cur = null; }
                    else if (xr.LocalName == "rPh") enRph--;
                    else if (xr.LocalName == "t") enT = false;
                }
                else if (enT && cur != null && EsTexto(xr.NodeType)) cur.Append(xr.Value);
            }
        }
        return res;
    }

    static bool EsFormatoFecha(int id, string code)
    {
        if ((id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58)) return true;
        if (code == null) return false;
        StringBuilder sb = new StringBuilder(); bool comillas = false;
        for (int i = 0; i < code.Length; i++)
        {
            char c = code[i];
            if (c == '"') { comillas = !comillas; continue; }
            if (comillas) continue;
            if (c == '\\') { i++; continue; }
            if (c == '[') { int j = code.IndexOf(']', i); if (j < 0) break; i = j; continue; }
            sb.Append(char.ToLowerInvariant(c));
        }
        string s = sb.ToString();
        if (s == "general") return false;
        return s.IndexOfAny(new char[] { 'd', 'm', 'y', 'h', 's' }) >= 0;
    }

    static List<bool> EstilosFecha(ZipArchive zip)
    {
        List<bool> res = new List<bool>();
        ZipArchiveEntry e = zip.GetEntry("xl/styles.xml");
        if (e == null) return res;
        XmlDocument doc = Documento(e);
        Dictionary<int, string> formatos = new Dictionary<int, string>();
        foreach (XmlNode n in doc.GetElementsByTagName("numFmt", "*"))
        {
            XmlAttribute id = n.Attributes["numFmtId"], cod = n.Attributes["formatCode"];
            if (id != null) formatos[int.Parse(id.Value)] = cod != null ? cod.Value : null;
        }
        XmlNodeList xfs = doc.GetElementsByTagName("cellXfs", "*");
        if (xfs.Count > 0)
            foreach (XmlNode xf in xfs[0].ChildNodes)
            {
                if (xf.LocalName != "xf") continue;
                XmlAttribute a = xf.Attributes["numFmtId"];
                int id = a != null ? int.Parse(a.Value) : 0;
                string cod; formatos.TryGetValue(id, out cod);
                res.Add(EsFormatoFecha(id, cod));
            }
        return res;
    }

    static List<KeyValuePair<string, string>> Hojas(ZipArchive zip)
    {
        Dictionary<string, string> rels = new Dictionary<string, string>();
        foreach (XmlNode n in Documento(zip.GetEntry("xl/_rels/workbook.xml.rels")).GetElementsByTagName("Relationship", "*"))
        {
            string t = n.Attributes["Target"].Value;
            rels[n.Attributes["Id"].Value] = t.StartsWith("/") ? t.Substring(1) : "xl/" + t;
        }
        List<KeyValuePair<string, string>> res = new List<KeyValuePair<string, string>>();
        foreach (XmlNode n in Documento(zip.GetEntry("xl/workbook.xml")).GetElementsByTagName("sheet", "*"))
        {
            string rid = ((XmlElement)n).GetAttribute("id", RelNs);
            if (rels.ContainsKey(rid)) res.Add(new KeyValuePair<string, string>(n.Attributes["name"].Value, rels[rid]));
        }
        return res;
    }

    static void Poner(List<string> fila, string rref, string v)
    {
        if (fila == null) return;
        int ci = rref != null ? ColIndex(rref) : fila.Count;
        if (ci < 0) ci = fila.Count;
        while (fila.Count < ci) fila.Add(null);
        if (ci < fila.Count) fila[ci] = v; else fila.Add(v);
    }

    static List<List<string>> LeerHoja(ZipArchiveEntry e, List<string> ss, List<bool> fecha)
    {
        List<List<string>> filas = new List<List<string>>();
        using (XmlReader xr = Lector(e))
        {
            List<string> fila = null; string rref = null, tipo = null; int estilo = 0;
            StringBuilder val = null; bool enValor = false;
            while (xr.Read())
            {
                XmlNodeType nt = xr.NodeType;
                if (nt == XmlNodeType.Element)
                {
                    string ln = xr.LocalName;
                    if (ln == "row") { fila = new List<string>(); filas.Add(fila); }
                    else if (ln == "c")
                    {
                        rref = xr.GetAttribute("r"); tipo = xr.GetAttribute("t");
                        string s = xr.GetAttribute("s"); estilo = s != null ? int.Parse(s) : 0; val = null;
                    }
                    else if ((ln == "v" || ln == "t") && !xr.IsEmptyElement) { enValor = true; if (val == null) val = new StringBuilder(); }
                }
                else if (nt == XmlNodeType.EndElement)
                {
                    string ln = xr.LocalName;
                    if (ln == "v" || ln == "t") enValor = false;
                    else if (ln == "c")
                    {
                        string v = val != null ? val.ToString() : null;
                        if (v != null)
                        {
                            if (tipo == "s") { int i; if (int.TryParse(v, out i) && i >= 0 && i < ss.Count) v = ss[i]; }
                            else if (tipo == "b") v = v == "1" ? "TRUE" : "FALSE";
                            else if ((tipo == null || tipo == "n") && estilo < fecha.Count && fecha[estilo])
                            {
                                double d;
                                if (double.TryParse(v, NumberStyles.Float, CultureInfo.InvariantCulture, out d) && d > 0 && d < 2958466)
                                {
                                    DateTime dt = new DateTime(1899, 12, 30).AddSeconds(Math.Round(d * 86400));
                                    v = dt.TimeOfDay.Ticks == 0 ? dt.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture)
                                                               : dt.ToString("yyyy-MM-dd HH:mm:ss", CultureInfo.InvariantCulture);
                                }
                            }
                        }
                        Poner(fila, rref, v);
                        val = null;
                    }
                }
                else if (enValor && val != null && EsTexto(nt)) val.Append(xr.Value);
            }
        }
        return filas;
    }

    // Convierte un .xlsx en JSON: {"informe","generado","hojas":[{"nombre","filas":[[...],...]}]}
    // Las columnas cuyo titulo (en las 10 primeras filas) este en "quitar" se vacian.
    public static string AJson(string ruta, string informe, string generado, string[] quitar)
    {
        StringBuilder sb = new StringBuilder();
        using (ZipArchive zip = ZipFile.OpenRead(ruta))
        {
            List<string> ss = TextosCompartidos(zip);
            List<bool> fecha = EstilosFecha(zip);
            sb.Append("{\"informe\":"); Esc(sb, informe);
            sb.Append(",\"generado\":"); Esc(sb, generado);
            sb.Append(",\"hojas\":[");
            bool primeraHoja = true;
            foreach (KeyValuePair<string, string> h in Hojas(zip))
            {
                ZipArchiveEntry e = zip.GetEntry(h.Value);
                if (e == null) continue;
                List<List<string>> filas = LeerHoja(e, ss, fecha);
                HashSet<int> fuera = new HashSet<int>();
                for (int i = 0; i < filas.Count && i < 10; i++)
                    for (int j = 0; j < filas[i].Count; j++)
                    {
                        string c = filas[i][j];
                        if (c == null) continue;
                        c = c.Trim();
                        foreach (string q in quitar) if (string.Equals(c, q, StringComparison.OrdinalIgnoreCase)) fuera.Add(j);
                    }
                if (!primeraHoja) sb.Append(',');
                primeraHoja = false;
                sb.Append("{\"nombre\":"); Esc(sb, h.Key); sb.Append(",\"filas\":[");
                bool primeraFila = true;
                foreach (List<string> f in filas)
                {
                    int ult = -1;
                    for (int j = 0; j < f.Count; j++) if (!fuera.Contains(j) && !string.IsNullOrEmpty(f[j])) ult = j;
                    if (ult < 0) continue;
                    if (!primeraFila) sb.Append(',');
                    primeraFila = false;
                    sb.Append('[');
                    for (int j = 0; j <= ult; j++) { if (j > 0) sb.Append(','); Esc(sb, fuera.Contains(j) ? null : f[j]); }
                    sb.Append(']');
                }
                sb.Append("]}");
            }
            sb.Append("]}");
        }
        return sb.ToString();
    }
}
'@

function Convertir-Y-Subir {
    $CarpetaJson = Join-Path $Carpeta "json"
    New-Item -ItemType Directory -Force -Path $CarpetaJson | Out-Null
    # los datos de dias anteriores no se vuelven a subir
    Get-ChildItem $CarpetaJson -Filter "*.json" | Where-Object { $_.LastWriteTime.Date -lt (Get-Date).Date } | Remove-Item -ErrorAction SilentlyContinue
    if (-not ("BoXlsx" -as [type])) {
        Add-Type -AssemblyName System.IO.Compression, System.IO.Compression.FileSystem
        $refs = @([System.IO.Compression.ZipArchive].Assembly.Location,
                  [System.IO.Compression.ZipFile].Assembly.Location,
                  [System.Xml.XmlReader].Assembly.Location)
        Add-Type -TypeDefinition $CodigoConversor -ReferencedAssemblies $refs
    }

    # 1. Cada Excel descargado -> json/<informe>.json (sin las columnas de $QuitarColumnas)
    $convertidos = @()
    foreach ($x in Get-ChildItem $Carpeta -Filter "*.xlsx" -ErrorAction SilentlyContinue) {
        try {
            $t0 = Get-Date
            $json = [BoXlsx]::AJson($x.FullName, $x.BaseName, $x.LastWriteTime.ToString("yyyy-MM-ddTHH:mm:ss"), [string[]]$QuitarColumnas)
            [IO.File]::WriteAllText((Join-Path $CarpetaJson "$($x.BaseName).json"), $json, (New-Object Text.UTF8Encoding($false)))
            Log ("Convertido {0} ({1} KB de datos, {2} s)" -f $x.Name, [math]::Round($json.Length / 1KB), [int]((Get-Date) - $t0).TotalSeconds)
            $convertidos += $x
        } catch { Log "ERROR convirtiendo $($x.Name): $(Corto $_.Exception.Message)" }
    }

    # 2. Subir TODOS los informes (los recien convertidos y, para los que hoy hayan fallado, la ultima version buena)
    if (-not $WebUrl) { Log "Subida a la web desactivada (falta WebUrl)"; return }
    $partes = @(Get-ChildItem $CarpetaJson -Filter "*.json" | ForEach-Object { [IO.File]::ReadAllText($_.FullName) })
    if ($partes.Count -eq 0) { Log "Nada que subir"; return }
    $paquete = '{"subido":"' + (Get-Date).ToString("yyyy-MM-ddTHH:mm:ss") + '","informes":[' + ($partes -join ',') + ']}'
    $bytes = [Text.Encoding]::UTF8.GetBytes($paquete)
    $ms = New-Object IO.MemoryStream
    $gz = New-Object IO.Compression.GZipStream($ms, [IO.Compression.CompressionMode]::Compress)
    $gz.Write($bytes, 0, $bytes.Length); $gz.Close()
    $comprimido = $ms.ToArray()
    try {
        Invoke-RestMethod -Method Post -Uri $WebUrl -Headers @{ Authorization = "Bearer $WebToken" } `
            -ContentType "application/octet-stream" -Body $comprimido -TimeoutSec 300 | Out-Null
        Log ("SUBIDO a la web: {0} informes, {1} KB" -f $partes.Count, [math]::Round($comprimido.Length / 1KB))
        if ($BorrarTrasSubir) {
            foreach ($x in $convertidos) { Remove-Item $x.FullName -Force -ErrorAction SilentlyContinue }
            Log "Excel borrados de BO_export"
        }
    } catch {
        Log "NO SUBIDO (los Excel se quedan en BO_export): $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")"
    }
}

# =====================================================================
#  MODO TRABAJADOR: procesa UN informe (lo lanza el modo principal)
# =====================================================================
if ($WorkerId) {
    try { Entrar $Cred; Procesar $WorkerId $WorkerNombre }
    catch { Log "ERROR login: $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
    finally { Salir }
    return
}

# =====================================================================
#  MODO PRINCIPAL
# =====================================================================
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

# Ids ya encontrados en ejecuciones anteriores (bo_ids.json); borralo para volver a buscar
if (Test-Path $IdsFile) {
    $guardados = @(Get-Content $IdsFile -Raw | ConvertFrom-Json | ForEach-Object { $_ })   # ForEach: separa la lista en elementos
    foreach ($inf in $Informes) {
        if (-not $inf.id) {
            $g = $guardados | Where-Object { $_.id -and $_.nombre -like $inf.nombre } | Select-Object -First 1
            if ($g) { $inf.id = $g.id; $inf.nombre = $g.nombre }
        }
    }
}

# Limpieza: borrar resultados de mas de 7 dias
Get-ChildItem $Carpeta -Filter "resultado_*.txt" -ErrorAction SilentlyContinue |
    Where-Object { $_.LastWriteTime -lt (Get-Date).AddDays(-7) } | Remove-Item -ErrorAction SilentlyContinue

$inicio = Get-Date
$trabajos = @()
try {
    Entrar $cred
    Log "OK: login correcto ($inicio)"

    # 1. Resolver que documento es cada informe
    $cola = @(); $docs = $null; $cambios = $false
    foreach ($inf in $Informes) {
        if ($inf.id) { $cola += @{ id = "$($inf.id)"; nombre = $inf.nombre }; continue }
        if (-not $docs) {
            $docs = @(); $off = 0
            do {
                $pg = @((Invoke-RestMethod -Uri "$Server/raylight/v1/documents?offset=$off&limit=50" -Headers $h).documents.document | Where-Object { $_ })
                $docs += $pg; $off += 50
            } while ($pg.Count -eq 50 -and $off -lt 10000)
        }
        $enc = @($docs | Where-Object { $_.name -like $inf.nombre })
        if ($enc.Count -gt 1 -and $inf.pestanas) {
            # Varias copias: quedarse con las que tienen exactamente las mismas pestanas
            $buscadas = $inf.pestanas -join '|'
            $enc = @($enc | Where-Object {
                try { (@((Invoke-RestMethod -Uri "$Server/raylight/v1/documents/$($_.id)/reports" -Headers $h).reports.report | ForEach-Object { $_.name }) -join '|') -eq $buscadas }
                catch { $false } })
        }
        if ($enc.Count -eq 0) { Log "NO ENCONTRADO: $($inf.nombre)"; continue }
        if ($enc.Count -gt 1) {
            Log "AVISO: '$($inf.nombre)' tiene $($enc.Count) copias iguales; uso la primera (id=$($enc[0].id)). Candidatos:"
            foreach ($d in $enc) { Log "   id=$($d.id)   $($d.name)" }
        }
        $cola += @{ id = "$($enc[0].id)"; nombre = $enc[0].name }
        $inf.id = $enc[0].id; $inf.nombre = $enc[0].name
        $cambios = $true
    }
    if ($cambios) {   # recordar los ids encontrados para no buscarlos en cada ejecucion
        $Informes | ForEach-Object { @{ nombre = $_.nombre; id = $_.id } } | ConvertTo-Json | Set-Content $IdsFile -Encoding UTF8
        Log "Ids guardados en $IdsFile"
    }
    Salir; $h.Remove("X-SAP-LogonToken")

    # 2. Lanzar los informes en paralelo (cada uno con su propia sesion)
    Log "`nLanzando $($cola.Count) informes (maximo $MaxParalelo a la vez)...`n"
    foreach ($c in $cola) {
        while (@($trabajos | Where-Object { $_.State -eq 'Running' }).Count -ge $MaxParalelo) {
            $trabajos | Receive-Job -ErrorAction Continue; Start-Sleep -Seconds 2
        }
        $trabajos += Start-Job -Name "$($c.nombre)" -FilePath $PSCommandPath -ArgumentList $c.id, $c.nombre, $Sello, $Raiz, $cred
    }
    # 3. Ir mostrando el progreso hasta que acaben todos
    while (@($trabajos | Where-Object { $_.State -eq 'Running' }).Count -gt 0) {
        $trabajos | Receive-Job -ErrorAction Continue; Start-Sleep -Seconds 2
    }
    $trabajos | Receive-Job -ErrorAction Continue

    # 4. Convertir los Excel y subirlos a la web
    Log ""
    Convertir-Y-Subir
}
catch { Log "ERROR: $(Corto "$($_.Exception.Message) $($_.ErrorDetails.Message)")" }
finally {
    Salir
    $trabajos | Remove-Job -Force -ErrorAction SilentlyContinue
    # Juntar los resultados parciales en el resultado final
    foreach ($f in Get-ChildItem $Carpeta -Filter "_parcial_*.txt" -ErrorAction SilentlyContinue) {
        Add-Content -Path $Log -Value ("`n" + (Get-Content $f.FullName -Raw)) -Encoding UTF8
        Remove-Item $f.FullName -ErrorAction SilentlyContinue
    }
    Log "`nFin: $(Get-Date). Duracion total: $([int]((Get-Date) - $inicio).TotalSeconds) s. Archivos en $Carpeta"
}
