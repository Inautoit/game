#!/usr/bin/env python3
"""Revisa la web de un local y dice qué le falta.

Uso:
    python3 captacion/revisar_web.py https://ejemplo.es
    python3 captacion/revisar_web.py --id 12          # usa la web guardada del local 12
    python3 captacion/revisar_web.py --id 12 --guardar  # además guarda el resultado en la BD

Comprueba: si carga, HTTPS, adaptada a móvil, año del copyright, reservas online,
WhatsApp, formulario de contacto, si es solo una red social / Linktree.
"""
import argparse
import json
import re
import sys
from datetime import date

import requests

import db

UA = "Mozilla/5.0 (compatible; revision-web/1.0)"
RESERVA = ("booksy", "treatwell", "fresha", "reservio", "thefork", "eltenedor", "covermanager",
           "salonized", "bewe", "koibox", "flowww", "doctoralia", "calendly", "simplybook",
           "reservar", "reserva online", "pide cita", "pedir cita", "cita online", "book now")
SOLO_RED = ("facebook.com", "instagram.com", "linktr.ee", "tiktok.com", "business.site", "wa.me")


def revisar(url):
    res = {"url": url, "carga": False, "faltas": [], "detalles": {}}
    if not re.match(r"^https?://", url):
        url = "http://" + url
    low = url.lower()
    if any(d in low for d in SOLO_RED):
        res["carga"] = None
        res["faltas"].append("no tiene web propia (solo red social/Linktree)")
        res["es_web_propia"] = False
        return res
    res["es_web_propia"] = True
    r, error = None, None
    for _ in range(2):
        try:
            r = requests.get(url, headers={"User-Agent": UA}, timeout=20, allow_redirects=True)
            break
        except requests.RequestException as e:
            error = type(e).__name__
    if r is None:
        # No afirmamos que no tenga web: puede ser un fallo de red nuestro.
        res["carga"] = None
        res["no_revisable"] = f"no se pudo abrir desde aquí ({error}); revisar a mano o con WebFetch"
        return res
    if r.status_code >= 400:
        res["faltas"].append(f"la web da error {r.status_code}")
        return res
    res["carga"] = True
    html = r.text[:600000]
    h = html.lower()
    d = res["detalles"]
    d["url_final"] = r.url
    d["https"] = r.url.startswith("https://")
    d["movil"] = 'name="viewport"' in h or "name='viewport'" in h or "name=viewport" in h
    anios = [int(a) for a in re.findall(r"(?:©|&copy;|copyright)\s*(?:[^<]{0,40}?)((?:19|20)\d{2})", h, re.I)]
    d["anio_copyright"] = max(anios) if anios else None
    d["reservas_online"] = any(k in h for k in RESERVA)
    d["whatsapp"] = "wa.me/" in h or "api.whatsapp.com" in h or "whatsapp" in h
    d["formulario"] = "<form" in h
    gen = re.search(r'<meta[^>]+name=["\']generator["\'][^>]+content=["\']([^"\']+)', html, re.I)
    d["generador"] = gen.group(1) if gen else None
    d["tablas_layout"] = h.count("<table") >= 3 and "<div" not in h[:5000]
    d["flash"] = ".swf" in h
    d["kb"] = len(r.content) // 1024
    titulo = re.search(r"<title[^>]*>(.*?)</title>", html, re.I | re.S)
    d["titulo"] = titulo.group(1).strip()[:120] if titulo else None
    if len(re.sub(r"<[^>]+>", " ", h).split()) < 40:
        res["faltas"].append("web casi vacía o en construcción")

    f = res["faltas"]
    if not d["https"]:
        f.append("sin HTTPS (el navegador la marca como 'no segura')")
    if not d["movil"]:
        f.append("no está adaptada a móvil")
    if d["anio_copyright"] and d["anio_copyright"] < date.today().year - 3:
        f.append(f"web anticuada (copyright {d['anio_copyright']})")
    if d["flash"] or d["tablas_layout"]:
        f.append("tecnología muy antigua")
    if not d["reservas_online"]:
        f.append("sin reservas/citas online")
    if not d["whatsapp"]:
        f.append("sin botón de WhatsApp")
    if not d["formulario"]:
        f.append("sin formulario de contacto")
    return res


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("url", nargs="?")
    ap.add_argument("--id", type=int)
    ap.add_argument("--guardar", action="store_true")
    a = ap.parse_args()
    url = a.url
    if a.id:
        con = db.conectar()
        row = con.execute("SELECT web FROM locales WHERE id=?", (a.id,)).fetchone()
        if not row or not row["web"]:
            sys.exit(f"El local {a.id} no tiene web guardada.")
        url = row["web"]
    if not url:
        ap.error("indica una URL o --id")
    res = revisar(url)
    print(json.dumps(res, ensure_ascii=False, indent=1))
    if a.guardar and a.id and res.get("no_revisable"):
        print(f"No guardo nada: {res['no_revisable']}")
    elif a.guardar and a.id:
        falta = "; ".join(res["faltas"]) or "web correcta (poco que mejorar)"
        tiene = "sí" if res.get("es_web_propia") and res["carga"] else "no"
        db.actualizar(con, a.id, que_le_falta=falta, tiene_web=tiene)
        con.commit()
        print(f"Guardado en el local {a.id}: tiene_web={tiene}; que_le_falta={falta}")


if __name__ == "__main__":
    main()
