"""
Actualizar informes de Retrasos (WFM VAP)
=========================================

Con un solo botón:
  1. Copia el Cuadrante ÚNICO del mes actual desde el servidor de ficheros.
  2. Descarga "CambiosTurno_Puntualidad 26.xlsx" desde SharePoint.
  3. Entra en https://wfmvap.lovable.app/retrasos y sube los dos archivos
     en "Cuadrante" y "Cambios de turno".

Uso:
  ActualizarRetrasos.exe                -> abre la ventana con el botón
  ActualizarRetrasos.exe --sin-ventana  -> lo ejecuta directamente
                                           (para el Programador de tareas)
  (o "python actualizar_retrasos.py ..." si se usa el script directamente)

La configuración está en config.ini (copia config.example.ini).
"""

from __future__ import annotations

import configparser
import datetime as dt
import os
import re
import shutil
import sys
import threading
import time
import traceback
from pathlib import Path
from urllib.parse import parse_qs, quote, unquote, urlparse

# Carpeta del programa: junto al .exe si está empaquetado, o junto al script.
if getattr(sys, "frozen", False):
    BASE = Path(sys.executable).resolve().parent
else:
    BASE = Path(__file__).resolve().parent
CONFIG = BASE / "config.ini"
# Datos de cada persona en su propio PC: así varias personas pueden ejecutar
# la herramienta desde la misma carpeta compartida sin pisarse.
_LOCAL = os.environ.get("LOCALAPPDATA")
DATOS_USUARIO = Path(_LOCAL) / "ActualizarRetrasos" if _LOCAL else BASE
DATOS_USUARIO.mkdir(parents=True, exist_ok=True)
DESCARGAS = DATOS_USUARIO / "descargas"
PERFIL_NAVEGADOR = DATOS_USUARIO / "perfil_navegador"
LOG_FILE = DATOS_USUARIO / "ultima_ejecucion.log"

MESES = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio",
         "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"]


class ErrorAutomatizacion(Exception):
    """Error con un mensaje pensado para el usuario."""


# --------------------------------------------------------------------------
# Configuración
# --------------------------------------------------------------------------
def cargar_config() -> configparser.ConfigParser:
    if not CONFIG.exists():
        raise ErrorAutomatizacion(
            f"No encuentro {CONFIG.name}. Copia 'config.example.ini' como "
            f"'config.ini' y rellena tu matrícula y correo.")
    cp = configparser.ConfigParser(interpolation=None)
    cp.read(CONFIG, encoding="utf-8")
    return cp


# --------------------------------------------------------------------------
# 1) Cuadrante desde el servidor de ficheros
# --------------------------------------------------------------------------
def copiar_cuadrante(cfg: configparser.ConfigParser, log) -> Path:
    hoy = dt.date.today()
    fija = cfg.get("cuadrante", "ruta_fija", fallback="").strip()

    if fija:
        origen = Path(fija)
        if not origen.exists():
            raise ErrorAutomatizacion(f"No existe el cuadrante indicado en ruta_fija:\n{origen}")
    else:
        valores = dict(anio=hoy.year, mes=hoy.month, nombre_mes=MESES[hoy.month - 1])
        carpeta = Path(cfg.get("cuadrante", "carpeta").format(**valores))
        patron = cfg.get("cuadrante", "patron",
                         fallback="{mes:02d}_Cuadrante*{anio}.xlsm").format(**valores)
        log(f"Buscando '{patron}' en:\n   {carpeta}")
        if not carpeta.exists():
            raise ErrorAutomatizacion(
                f"No puedo acceder a la carpeta del cuadrante:\n{carpeta}\n"
                f"¿Estás conectado a la red / VPN?")
        candidatos = [p for p in carpeta.glob(patron) if not p.name.startswith("~$")]
        if not candidatos:
            raise ErrorAutomatizacion(
                f"No hay ningún archivo que cumpla '{patron}' en\n{carpeta}")
        origen = max(candidatos, key=lambda p: p.stat().st_mtime)

    DESCARGAS.mkdir(exist_ok=True)
    destino = DESCARGAS / origen.name
    log(f"Copiando cuadrante: {origen.name}")
    try:
        shutil.copyfile(origen, destino)
    except PermissionError:
        raise ErrorAutomatizacion(
            f"No se puede leer el cuadrante (¿bloqueado o sin permisos?):\n{origen}")
    log(f"   OK ({destino.stat().st_size / 1024:.0f} KB)")
    return destino


def copiar_cambios_local(ruta: str, log) -> Path:
    """Si la biblioteca de SharePoint está sincronizada con OneDrive."""
    origen = Path(ruta)
    if not origen.exists():
        raise ErrorAutomatizacion(f"No existe el archivo de cambios en:\n{origen}")
    DESCARGAS.mkdir(exist_ok=True)
    destino = DESCARGAS / origen.name
    log(f"Copiando cambios de turno desde OneDrive: {origen.name}")
    shutil.copyfile(origen, destino)
    return destino


# --------------------------------------------------------------------------
# 2) Cambios de turno desde SharePoint
# --------------------------------------------------------------------------
def url_descarga_sharepoint(url: str) -> tuple[str, str]:
    """Convierte el enlace 'Doc.aspx?sourcedoc={GUID}&file=...' en un enlace
    de descarga directa (download.aspx?UniqueId=GUID). Devuelve (url, nombre)."""
    u = urlparse(url)
    q = parse_qs(u.query)
    guid = q.get("sourcedoc", [""])[0].strip("{}")
    nombre = unquote(q.get("file", ["cambios_turno.xlsx"])[0])
    if not guid:
        raise ErrorAutomatizacion("El enlace de SharePoint no tiene 'sourcedoc'. "
                                  "Copia el enlace completo del archivo en config.ini.")
    ruta = re.sub(r"^/:[a-z]:/[a-z]", "", u.path)          # quita '/:x:/r'
    sitio = ruta.split("/_layouts/")[0]                     # /sites/filerEs
    return f"{u.scheme}://{u.netloc}{sitio}/_layouts/15/download.aspx?UniqueId={quote(guid)}", nombre


def descargar_sharepoint(context, url: str, log, espera_login_seg: int = 300) -> Path:
    descarga, nombre = url_descarga_sharepoint(url)
    log(f"Descargando de SharePoint: {nombre}")

    def intentar() -> bytes | None:
        r = context.request.get(descarga, timeout=120_000)
        cuerpo = r.body()
        # Un .xlsx es un ZIP: empieza por 'PK'. Si no, es la página de login.
        return cuerpo if r.ok and cuerpo[:2] == b"PK" else None

    datos = intentar()
    if datos is None:
        log("   Hace falta iniciar sesión en Microsoft. Inicia sesión en la "
            "ventana del navegador (solo la primera vez)...")
        pagina = context.new_page()
        pagina.goto(url)
        limite = time.time() + espera_login_seg
        while datos is None and time.time() < limite:
            pagina.wait_for_timeout(5000)
            datos = intentar()
        pagina.close()
        if datos is None:
            raise ErrorAutomatizacion("No se pudo descargar el archivo de SharePoint "
                                      "(no se completó el inicio de sesión o no tienes acceso).")

    DESCARGAS.mkdir(exist_ok=True)
    destino = DESCARGAS / nombre
    destino.write_bytes(datos)
    log(f"   OK ({len(datos) / 1024:.0f} KB)")
    return destino


# --------------------------------------------------------------------------
# 3) Subida a la web de Retrasos
# --------------------------------------------------------------------------
JS_ETIQUETAS_INPUTS = """
() => Array.from(document.querySelectorAll('input[type=file]')).map(inp => {
  let el = inp;
  for (let i = 0; i < 6 && el; i++, el = el.parentElement) {
    const t = (el.innerText || '').toLowerCase();
    const c = t.includes('cuadrante'), m = t.includes('cambios');
    if (c && !m) return 'cuadrante';
    if (m && !c) return 'cambios';
  }
  return '';
})
"""


def resumen_cargas(page) -> str:
    """Línea 'Cuadrante: ... Cambios: ... dd/mm/aa, hh:mm' que muestra la web."""
    texto = page.locator("body").inner_text()
    m = re.search(r"Cuadrante:.*", texto)
    return m.group(0).strip() if m else ""


def esperar_cambio_resumen(page, anterior: str, log, timeout_seg: int = 90) -> bool:
    limite = time.time() + timeout_seg
    while time.time() < limite:
        page.wait_for_timeout(1500)
        actual = resumen_cargas(page)
        if actual and actual != anterior:
            return True
    return False


def iniciar_sesion_si_hace_falta(page, cfg, url_web, log):
    page.goto(url_web, wait_until="networkidle")
    if "/auth" not in page.url:
        return
    matricula = cfg.get("web", "matricula", fallback="").strip()
    correo = cfg.get("web", "correo", fallback="").strip()
    if not matricula or not correo:
        raise ErrorAutomatizacion("La web pide iniciar sesión: rellena 'matricula' y "
                                  "'correo' en la sección [web] de config.ini.")
    log("Iniciando sesión en WFM VAP...")
    page.fill("#matricula", matricula)
    page.fill("#email", correo)
    page.get_by_role("button", name=re.compile("Entrar", re.I)).click()
    try:
        page.wait_for_url(lambda u: "/auth" not in u, timeout=60_000)
    except Exception:
        raise ErrorAutomatizacion("No se pudo iniciar sesión en WFM VAP. "
                                  "Revisa la matrícula y el correo de config.ini.")
    page.goto(url_web, wait_until="networkidle")


def subir_a_web(context, cfg, cuadrante: Path, cambios: Path, log):
    url_web = cfg.get("web", "url", fallback="https://wfmvap.lovable.app/retrasos")
    page = context.new_page()
    iniciar_sesion_si_hace_falta(page, cfg, url_web, log)

    inputs = page.locator("input[type=file]")
    try:
        inputs.first.wait_for(state="attached", timeout=30_000)
    except Exception:
        raise ErrorAutomatizacion("No encuentro los campos para subir archivos en la "
                                  "página de Retrasos. ¿Tu usuario tiene permiso de admin?")

    etiquetas = page.evaluate(JS_ETIQUETAS_INPUTS)
    idx_cuadrante = etiquetas.index("cuadrante") if "cuadrante" in etiquetas else 0
    idx_cambios = etiquetas.index("cambios") if "cambios" in etiquetas else 1
    if len(etiquetas) < 2:
        raise ErrorAutomatizacion(f"Esperaba 2 campos de archivo y hay {len(etiquetas)}.")

    for idx, archivo, nombre in ((idx_cuadrante, cuadrante, "Cuadrante"),
                                 (idx_cambios, cambios, "Cambios de turno")):
        antes = resumen_cargas(page)
        log(f"Subiendo {nombre}: {archivo.name}")
        page.locator("input[type=file]").nth(idx).set_input_files(str(archivo))
        if esperar_cambio_resumen(page, antes, log):
            log("   OK, la web lo ha procesado")
        else:
            log("   Subido, pero no he podido confirmar que la web lo haya procesado "
                "(revísalo en pantalla).")

    log("Estado en la web:\n   " + (resumen_cargas(page) or "(sin resumen)"))
    return page


# --------------------------------------------------------------------------
# Proceso completo
# --------------------------------------------------------------------------
def abrir_navegador(pw, cfg, log):
    canal = cfg.get("navegador", "canal", fallback="msedge").strip() or None
    headless = cfg.getboolean("navegador", "oculto", fallback=False)
    opciones = dict(user_data_dir=str(PERFIL_NAVEGADOR), headless=headless,
                    accept_downloads=True, viewport={"width": 1400, "height": 900})
    ejecutable = cfg.get("navegador", "ruta_ejecutable", fallback="").strip()
    if ejecutable:
        return pw.chromium.launch_persistent_context(executable_path=ejecutable, **opciones)
    try:
        return pw.chromium.launch_persistent_context(channel=canal, **opciones)
    except Exception as e:
        if canal:
            log(f"No se pudo abrir '{canal}' ({e.__class__.__name__}); uso Chromium.")
            return pw.chromium.launch_persistent_context(**opciones)
        raise


def ejecutar(log) -> bool:
    from playwright.sync_api import sync_playwright

    inicio = time.time()
    log(f"=== Inicio {dt.datetime.now():%d/%m/%Y %H:%M:%S} ===")
    try:
        cfg = cargar_config()
        cuadrante = copiar_cuadrante(cfg, log)

        with sync_playwright() as pw:
            context = abrir_navegador(pw, cfg, log)
            try:
                ruta_local = cfg.get("sharepoint", "ruta_local", fallback="").strip()
                if ruta_local:
                    cambios = copiar_cambios_local(ruta_local, log)
                else:
                    cambios = descargar_sharepoint(context, cfg.get("sharepoint", "url"), log)

                page = subir_a_web(context, cfg, cuadrante, cambios, log)
                page.wait_for_timeout(cfg.getint("navegador", "segundos_antes_de_cerrar",
                                                 fallback=5) * 1000)
            finally:
                context.close()

        log(f"=== Terminado correctamente en {time.time() - inicio:.0f} s ===")
        return True
    except ErrorAutomatizacion as e:
        log(f"ERROR: {e}")
    except Exception:
        log("ERROR inesperado:\n" + traceback.format_exc())
    return False


# --------------------------------------------------------------------------
# Interfaz
# --------------------------------------------------------------------------
def crear_logger(extra=None):
    LOG_FILE.write_text("", encoding="utf-8")

    def log(msg: str):
        with LOG_FILE.open("a", encoding="utf-8") as f:
            f.write(msg + "\n")
        try:
            print(msg, flush=True)
        except Exception:  # el .exe con ventana no tiene consola
            pass
        if extra:
            extra(msg)
    return log


def ventana():
    import tkinter as tk
    from tkinter import scrolledtext

    root = tk.Tk()
    root.title("Actualizar Retrasos - WFM VAP")
    root.geometry("640x420")

    tk.Label(root, text="Cuadrante (servidor) + Cambios de turno (SharePoint)  →  WFM VAP / Retrasos",
             font=("Segoe UI", 10)).pack(pady=(12, 6))
    texto = scrolledtext.ScrolledText(root, height=16, font=("Consolas", 9), state="disabled")

    def escribir(msg):
        def _():
            texto.configure(state="normal")
            texto.insert("end", msg + "\n")
            texto.see("end")
            texto.configure(state="disabled")
        root.after(0, _)

    def lanzar():
        boton.configure(state="disabled", text="Trabajando...")
        texto.configure(state="normal"); texto.delete("1.0", "end"); texto.configure(state="disabled")

        def trabajo():
            ok = ejecutar(crear_logger(escribir))
            root.after(0, lambda: boton.configure(
                state="normal",
                text="✔ Hecho - volver a ejecutar" if ok else "✖ Falló - reintentar",
                bg="#1f7a3a" if ok else "#c62828"))
        threading.Thread(target=trabajo, daemon=True).start()

    boton = tk.Button(root, text="Descargar y subir informes", command=lanzar,
                      font=("Segoe UI", 12, "bold"), bg="#d32f2f", fg="white",
                      activebackground="#b71c1c", padx=20, pady=8)
    boton.pack(pady=6)
    texto.pack(fill="both", expand=True, padx=12, pady=(6, 12))
    root.mainloop()


if __name__ == "__main__":
    if "--sin-ventana" in sys.argv:
        sys.exit(0 if ejecutar(crear_logger()) else 1)
    ventana()
