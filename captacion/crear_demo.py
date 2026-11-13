#!/usr/bin/env python3
"""Crea una web demo para un local a partir de la plantilla de su sector.

Uso:
    python3 captacion/crear_demo.py 12
    python3 captacion/crear_demo.py 12 --personalizar /ruta/extra.json
    python3 captacion/crear_demo.py 12 --sin-estado      # no cambia el estado en la BD

--personalizar: JSON con claves que sobrescriben las del sector en plantillas/sectores.json
    (eslogan, sobre, servicios, ventajas, cta, texto_reserva, color1, color2, icono, ...).
    Ejemplo: {"eslogan": "Barbería clásica en Ruzafa desde 1985", "ventajas": ["Sin cita los sábados"]}

Resultado: demos/<id>-<nombre>/index.html y el estado del local pasa a "demo lista".
"""
import argparse
import html
import json
import os
import re
import sys
import unicodedata
import urllib.parse
from datetime import date

import db

PLANTILLAS = os.path.join(db.RAIZ, "plantillas")
DEMOS = os.path.join(db.RAIZ, "demos")
CONFIG = os.path.join(db.RAIZ, "captacion", "config.json")

DIAS = {"Mo": "Lun", "Tu": "Mar", "We": "Mié", "Th": "Jue", "Fr": "Vie", "Sa": "Sáb", "Su": "Dom",
        "PH": "Festivos", "off": "cerrado", "closed": "cerrado"}


def slug(t):
    t = unicodedata.normalize("NFKD", t).encode("ascii", "ignore").decode().lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-")[:40] or "local"


def cargar_config():
    if os.path.exists(CONFIG):
        with open(CONFIG) as f:
            return json.load(f)
    return {"agencia": "tu agencia"}


def config_sector(sector):
    with open(os.path.join(PLANTILLAS, "sectores.json")) as f:
        todo = json.load(f)
    clave = todo.get("_alias", {}).get(sector, sector)
    return dict(todo.get(clave, todo["generico"]))


def horario_html(notas):
    m = re.search(r"horario OSM: (.+)", notas or "")
    if not m:
        return "<li><span>Consúltanos por WhatsApp</span></li>"
    filas = []
    for parte in m.group(1).split(";"):
        parte = parte.strip()
        if not parte:
            continue
        m2 = re.match(r"^((?:Mo|Tu|We|Th|Fr|Sa|Su|PH)[A-Za-z,\- ]*?)\s+(\d.*|off|closed)$", parte)
        dias, horas = (m2.group(1), m2.group(2)) if m2 else ("Todos los días", parte)
        for k, v in DIAS.items():
            dias = dias.replace(k, v)
            horas = horas.replace(k, v)
        horas = re.sub(r"\s*,\s*", " y ", horas)
        filas.append(f"<li><span>{html.escape(dias)}</span><span>{html.escape(horas)}</span></li>")
    return "\n".join(filas)


def tel_whatsapp(tel):
    if not tel:
        return ""
    d = re.sub(r"\D", "", tel.split(";")[0])
    if len(d) == 9:
        d = "34" + d
    return d


def campos_reserva(tipo, opciones):
    sel = ""
    if opciones:
        sel = '<select name="servicio">' + "".join(f"<option>{html.escape(o)}</option>" for o in opciones) + "</select>"
    if tipo == "mesa":
        return ('<input name="dia" type="date" required><select name="personas">'
                + "".join(f"<option>{n} personas</option>" for n in range(1, 11)) + "</select>"
                + '</div><div class="fila"><input name="hora" type="time" required><select name="zona"><option>Interior</option><option>Terraza</option></select>')
    if tipo == "presupuesto":
        return (sel or '<input name="asunto" placeholder="¿Qué necesitas?">') + '<input name="matricula" placeholder="Matrícula o modelo">'
    if tipo == "pedido":
        return '<input name="dia" type="date" required><input name="hora" type="time" placeholder="Hora de recogida">'
    # cita / clase
    return (sel or '<input name="servicio" placeholder="Servicio">') + '<input name="dia" type="datetime-local" required>'


def generar(local, extra=None):
    cfg = config_sector(local["sector"])
    cfg.update(extra or {})
    ag = cargar_config()
    nombre, ciudad = local["nombre"], local["ciudad"]
    fmt = lambda s: s.replace("{nombre}", nombre).replace("{ciudad}", ciudad)
    e = html.escape

    servicios = "\n".join(
        f'    <div class="servicio"><div class="ico">{s[0]}</div><h3>{e(s[1])}</h3><p>{e(fmt(s[2]))}</p></div>'
        for s in cfg["servicios"])
    ventajas = "".join(f"<span>✓ {e(v)}</span>" for v in cfg["ventajas"])
    contacto = []
    if local["telefono"]:
        contacto.append(f'📞 <a href="tel:{e(local["telefono"])}">{e(local["telefono"])}</a>')
    if local["email"]:
        contacto.append(f'✉️ <a href="mailto:{e(local["email"])}">{e(local["email"])}</a>')
    if local["redes_sociales"]:
        contacto.append("📱 " + e(local["redes_sociales"]))
    wa = tel_whatsapp(local["telefono"])
    fuente = cfg.get("fuente", "Playfair Display")
    direccion = local["direccion"] or ""
    valores = {
        "NOMBRE": e(nombre), "NOMBRE_JS": nombre.replace("\\", "").replace("'", "\\'"),
        "CIUDAD": e(ciudad), "ETIQUETA": e(cfg["etiqueta"]), "ETIQUETA_MIN": e(cfg["etiqueta"].lower()),
        "ESLOGAN": e(fmt(cfg["eslogan"])), "ICONO": cfg["icono"],
        "COLOR1": cfg["color1"], "COLOR2": cfg["color2"], "FONDO": cfg["fondo"],
        "FUENTE_TITULOS": fuente, "FUENTE_TITULOS_URL": fuente.replace(" ", "+"),
        "TITULO_SERVICIOS": e(cfg["titulo_servicios"]), "TITULO_SERVICIOS_MIN": e(cfg["titulo_servicios"].lower()),
        "SUBTITULO_SERVICIOS": e(cfg["subtitulo_servicios"]), "SERVICIOS_HTML": servicios,
        "TITULO_NOSOTROS": e(cfg["titulo_nosotros"]), "SOBRE_NOSOTROS": e(fmt(cfg["sobre"])),
        "VENTAJAS_HTML": ventajas, "CTA": e(cfg["cta"]), "CTA_MIN": e(cfg["cta"].lower()),
        "TEXTO_RESERVA": e(cfg["texto_reserva"]),
        "CAMPOS_RESERVA": campos_reserva(cfg["campos_reserva"], cfg.get("servicios_opciones")),
        "PLACEHOLDER_NOTA": e(cfg.get("placeholder_nota", "Comentarios")),
        "DIRECCION": e(direccion.split(" (")[0]) or "Dirección por confirmar",
        "CONTACTO_HTML": "<br>".join(contacto) or "Escríbenos por WhatsApp",
        "HORARIO_HTML": horario_html(local["notas"]),
        "MAPA_Q": urllib.parse.quote_plus(f"{nombre}, {direccion.split(' (')[0]}, {ciudad}"),
        "TEL_WA": wa, "ANIO": str(date.today().year), "AGENCIA": e(ag.get("agencia", "tu agencia")),
        "BOTON_WA": f'<a class="wa" href="https://wa.me/{wa}" aria-label="WhatsApp" target="_blank">💬</a>' if wa else "",
    }
    with open(os.path.join(PLANTILLAS, "base.html")) as f:
        plantilla = f.read()
    salida = re.sub(r"\{\{([A-Z_0-9]+)\}\}", lambda m: valores.get(m.group(1), m.group(0)), plantilla)
    pendientes = re.findall(r"\{\{[A-Z_0-9]+\}\}", salida)
    if pendientes:
        raise RuntimeError(f"Marcadores sin rellenar: {pendientes}")
    return salida


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("id", type=int)
    ap.add_argument("--personalizar", help="JSON con textos/colores propios para este local")
    ap.add_argument("--sin-estado", action="store_true")
    a = ap.parse_args()
    con = db.conectar()
    local = con.execute("SELECT * FROM locales WHERE id=?", (a.id,)).fetchone()
    if not local:
        sys.exit(f"No existe el local {a.id}")
    extra = None
    if a.personalizar:
        with open(a.personalizar) as f:
            extra = json.load(f)
    pagina = generar(local, extra)
    carpeta = os.path.join(DEMOS, f"{local['id']}-{slug(local['nombre'])}")
    os.makedirs(carpeta, exist_ok=True)
    ruta = os.path.join(carpeta, "index.html")
    with open(ruta, "w") as f:
        f.write(pagina)
    rel = os.path.relpath(ruta, db.RAIZ)
    db.actualizar(con, a.id, demo=rel)
    if not a.sin_estado and local["estado"] == "encontrado":
        db.cambiar_estado(con, a.id, "demo lista", "demo generada desde plantilla")
    con.commit()
    print(f"Demo creada: {rel}")


if __name__ == "__main__":
    main()
