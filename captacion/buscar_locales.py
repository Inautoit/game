#!/usr/bin/env python3
"""Busca locales pequeños por sector y ciudad en OpenStreetMap y los guarda en locales.db.

Uso:
    python3 captacion/buscar_locales.py --sector peluqueria --ciudad Valencia --max 20
    python3 captacion/buscar_locales.py --sectores          # lista de sectores disponibles
    python3 captacion/buscar_locales.py ... --simular       # no guarda, solo muestra

Fuente de datos:
    1) API Overpass (gratuita, sin clave). Se prueban varios servidores.
    2) Si Overpass no responde, plan B con los mismos datos de OpenStreetMap:
       Nominatim (búsqueda) + API oficial de OSM (todas las etiquetas, incluida "brand").

Filtro de locales pequeños e independientes:
    - fuera los que tienen etiqueta brand / brand:wikidata / brand:wikipedia
    - fuera los que aparecen varias veces con el mismo nombre en la ciudad
    - fuera los nombres de cadenas conocidas (lista CADENAS)
    - fuera los que no tienen nombre
"""
import argparse
import json
import os
import sys
import time
import urllib.parse
from collections import Counter

import requests

import db

UA = "captacion-locales/1.0 (herramienta interna; uso moderado)"
OVERPASS = [
    "https://overpass-api.de/api/interpreter",
    "https://lz4.overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
]
NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSM_API = "https://api.openstreetmap.org/api/0.6"

# sector -> lista de etiquetas OSM (clave, valor)
SECTORES = {
    "peluqueria":   [("shop", "hairdresser")],
    "estetica":     [("shop", "beauty")],
    "bar":          [("amenity", "bar"), ("amenity", "pub")],
    "cafeteria":    [("amenity", "cafe")],
    "restaurante":  [("amenity", "restaurant")],
    "taller":       [("shop", "car_repair")],
    "clinica_dental": [("amenity", "dentist")],
    "fisioterapia": [("healthcare", "physiotherapist")],
    "clinica":      [("amenity", "clinic")],
    "veterinario":  [("amenity", "veterinary")],
    "gimnasio":     [("leisure", "fitness_centre")],
    "panaderia":    [("shop", "bakery")],
    "floristeria":  [("shop", "florist")],
    "ferreteria":   [("shop", "hardware")],
    "optica":       [("shop", "optician")],
    "carniceria":   [("shop", "butcher")],
    "fruteria":     [("shop", "greengrocer")],
    "tienda_ropa":  [("shop", "clothes")],
    "tienda_barrio": [("shop", "convenience")],
}
ALIAS = {
    "peluquerias": "peluqueria", "peluquería": "peluqueria", "peluquerías": "peluqueria",
    "barberia": "peluqueria", "barbería": "peluqueria",
    "bares": "bar", "restaurantes": "restaurante", "talleres": "taller",
    "dentista": "clinica_dental", "dentistas": "clinica_dental", "clínica": "clinica",
    "fisio": "fisioterapia", "gimnasios": "gimnasio", "gym": "gimnasio",
    "panadería": "panaderia", "floristería": "floristeria", "ferretería": "ferreteria",
    "óptica": "optica", "carnicería": "carniceria", "frutería": "fruteria",
    "cafeterías": "cafeteria", "cafeteria": "cafeteria", "estética": "estetica",
}

# Cadenas y franquicias habituales en España (por si OSM no tiene etiqueta brand)
CADENAS = {
    "marco aldany", "llongueras", "jean louis david", "provost", "franck provost",
    "tony&guy", "toni&guy", "pelostop", "no+vello", "nomasvello", "dessange", "camille albane",
    "multiopticas", "general optica", "alain afflelou", "opticalia", "visionlab",
    "telepizza", "domino's pizza", "100 montaditos", "lizarran", "foster's hollywood",
    "goiko", "vips", "ginos", "tagliatella", "la tagliatella", "burger king", "mcdonald's",
    "starbucks", "costa coffee", "panaria", "granier", "pans & company", "rodilla",
    "basic-fit", "mcfit", "on air", "gimnasio on air", "aldifit", "fitness park", "duet fit", "supera", "centro supera", "altafit", "anytime fitness", "synergym", "vivagym", "go fit",
    "dia", "carrefour express", "spar", "coviran", "covirán", "supeco", "consum",
    "midas", "norauto", "feu vert", "euromaster", "first stop", "confort auto",
    "vitaldent", "dentix", "sanitas", "adeslas", "caser",
    "kiwoko", "tiendanimal", "zara", "mango", "primark", "jack & jones",
}

# Instalaciones públicas o no comerciales (no son clientes)
PUBLICO = ("pavello", "pabellon", "polideportiv", "poliesportiu", "sala de musculaci",
           "ayuntamiento", "ajuntament", "universitat", "universidad", "municipal",
           "centro de salud", "hospital", "colegio", "instituto", "parroquia")

# Palabras en web que indican reserva online
RESERVA_DOMINIOS = ("booksy", "treatwell", "fresha", "reservio", "thefork", "eltenedor",
                    "covermanager", "salonized", "bewe", "koibox", "flowww", "doctoralia")


def _get(url, **kw):
    kw.setdefault("timeout", 40)
    kw.setdefault("headers", {"User-Agent": UA})
    return requests.get(url, **kw)


# ---------------------------------------------------------------- ciudad
def geocodificar_ciudad(ciudad):
    r = _get(NOMINATIM, params={"city": ciudad, "country": "Spain", "format": "jsonv2",
                                "limit": 5, "addressdetails": 1})
    r.raise_for_status()
    res = [x for x in r.json() if x.get("osm_type") == "relation"] or r.json()
    if not res:
        raise SystemExit(f"No encuentro la ciudad '{ciudad}' en España.")
    c = res[0]
    lat1, lat2, lon1, lon2 = map(float, c["boundingbox"])
    nombre_oficial = c["name"]
    return {
        "nombre": ciudad.strip().title() if ciudad.strip() else nombre_oficial,
        "nombre_oficial": nombre_oficial,
        "relation_id": int(c["osm_id"]) if c["osm_type"] == "relation" else None,
        "bbox": (lat1, lat2, lon1, lon2),
    }


# ---------------------------------------------------------------- Overpass
MARCA_CAIDO = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".overpass_caido")


def overpass_caido_hace_poco(minutos=30):
    return os.path.exists(MARCA_CAIDO) and time.time() - os.path.getmtime(MARCA_CAIDO) < minutos * 60


def buscar_overpass(ciudad_info, etiquetas):
    if not ciudad_info["relation_id"]:
        raise RuntimeError("Sin relación OSM para la ciudad")
    area = 3600000000 + ciudad_info["relation_id"]
    partes = "".join(f'nwr["{k}"="{v}"](area.a);' for k, v in etiquetas)
    q = f"[out:json][timeout:60];area(id:{area})->.a;({partes});out center tags;"
    ultimo = None
    for url in OVERPASS:
        try:
            r = requests.post(url, data={"data": q}, headers={"User-Agent": UA}, timeout=(8, 40))
            if r.status_code == 200 and r.text.lstrip().startswith("{"):
                elems = r.json().get("elements", [])
                if os.path.exists(MARCA_CAIDO):
                    os.remove(MARCA_CAIDO)
                print(f"  · Overpass OK ({urllib.parse.urlparse(url).netloc}): {len(elems)} elementos",
                      file=sys.stderr)
                return [{"tipo": e["type"], "id": e["id"], "tags": e.get("tags", {}), "dir_nominatim": None}
                        for e in elems]
            ultimo = f"HTTP {r.status_code}"
        except requests.RequestException as e:
            ultimo = type(e).__name__
        print(f"  · Overpass {urllib.parse.urlparse(url).netloc} no responde ({ultimo})", file=sys.stderr)
    open(MARCA_CAIDO, "w").close()
    raise RuntimeError(f"Ningún servidor Overpass responde ({ultimo})")


# ---------------------------------------------------------------- Plan B
def _ciudad_coincide(addr, ciudad_info):
    nombres = {db.normalizar_nombre(ciudad_info["nombre"]), db.normalizar_nombre(ciudad_info["nombre_oficial"])}
    for k in ("city", "town", "village", "municipality"):
        if addr.get(k) and db.normalizar_nombre(addr[k]) in nombres:
            return True
    return False


def buscar_nominatim(ciudad_info, etiquetas, max_paginas=6):
    lat1, lat2, lon1, lon2 = ciudad_info["bbox"]
    vistos, encontrados = [], {}
    for k, v in etiquetas:
        excluir = []
        for _ in range(max_paginas):
            params = {"q": f"[{k}={v}]", "viewbox": f"{lon1},{lat2},{lon2},{lat1}", "bounded": 1,
                      "format": "jsonv2", "addressdetails": 1, "limit": 50}
            if excluir:
                params["exclude_place_ids"] = ",".join(excluir)
            time.sleep(1.1)  # política de uso de Nominatim: 1 petición/segundo
            r = _get(NOMINATIM, params=params)
            r.raise_for_status()
            res = r.json()
            if not res:
                break
            for x in res:
                excluir.append(str(x["place_id"]))
                if x.get("category") != k or x.get("type") != v:
                    continue
                if not _ciudad_coincide(x.get("address", {}), ciudad_info):
                    continue
                encontrados[(x["osm_type"], int(x["osm_id"]))] = x.get("address", {})
            if len(res) < 50:
                break
    print(f"  · Nominatim: {len(encontrados)} elementos en la ciudad", file=sys.stderr)
    # Etiquetas completas desde la API oficial de OSM (incluye brand, website, etc.)
    salida = []
    por_tipo = {}
    for (t, i) in encontrados:
        por_tipo.setdefault(t, []).append(i)
    for t, ids in por_tipo.items():
        for n in range(0, len(ids), 100):
            lote = ids[n:n + 100]
            r = _get(f"{OSM_API}/{t}s.json", params={f"{t}s": ",".join(map(str, lote))})
            r.raise_for_status()
            for e in r.json().get("elements", []):
                salida.append({"tipo": e["type"], "id": e["id"], "tags": e.get("tags", {}),
                               "dir_nominatim": encontrados.get((e["type"], e["id"]))})
    return salida


# ---------------------------------------------------------------- procesado
def _primera(tags, *claves):
    for c in claves:
        if tags.get(c):
            return tags[c].split(";")[0].strip()
    return None


def construir_direccion(tags, addr_nom):
    calle = tags.get("addr:street") or (addr_nom or {}).get("road")
    num = tags.get("addr:housenumber") or (addr_nom or {}).get("house_number")
    cp = tags.get("addr:postcode") or (addr_nom or {}).get("postcode")
    if not calle:
        return None
    d = calle + (f", {num}" if num else "")
    return d + (f" ({cp})" if cp else "")


def redes(tags):
    out = []
    for red in ("instagram", "facebook", "tiktok", "twitter", "whatsapp"):
        v = _primera(tags, f"contact:{red}", red)
        if v:
            out.append(f"{red}: {v}")
    return ", ".join(out) or None


def calcular_potencial(loc):
    p = 0
    p += 4 if not loc["web"] else 1
    p += 2 if loc["telefono"] else 0
    p += 1 if loc["email"] else 0
    p += 1 if loc["redes_sociales"] else 0
    p += 1 if loc["_horario"] else 0
    p += 1 if loc["direccion"] and any(ch.isdigit() for ch in loc["direccion"].split("(")[0]) else 0
    return min(p, 10)


def nombre_base(nombre):
    """'Gimnasio On Air - Ruzafa' -> 'gimnasio on air' (para detectar sucursales)."""
    for sep in (" - ", " | ", " – ", " (" ):
        nombre = nombre.split(sep)[0]
    return db.normalizar_nombre(nombre)


def procesar(elementos, ciudad, sector):
    descartes = Counter()
    nombres = Counter(nombre_base(e["tags"]["name"]) for e in elementos if e["tags"].get("name"))
    locales = []
    for e in elementos:
        t = e["tags"]
        nombre = (t.get("name") or "").strip()
        clave = db.normalizar_nombre(nombre)
        if not nombre:
            descartes["sin nombre"] += 1; continue
        if any(t.get(k) for k in ("brand", "brand:wikidata", "brand:wikipedia")):
            descartes["etiqueta brand (cadena)"] += 1; continue
        if nombres[nombre_base(nombre)] > 1:
            descartes["varios locales con el mismo nombre"] += 1; continue
        if clave in CADENAS or nombre_base(nombre) in CADENAS or any(clave.startswith(c + " ") for c in CADENAS):
            descartes["cadena conocida"] += 1; continue
        if (t.get("operator:type") in ("public", "government", "community")
                or any(p in clave for p in PUBLICO)):
            descartes["instalación pública"] += 1; continue
        if t.get("disused") == "yes" or any(k.startswith(("disused:", "was:")) for k in t):
            descartes["cerrado"] += 1; continue
        web = _primera(t, "website", "contact:website", "url")
        loc = {
            "osm_tipo": e["tipo"], "osm_id": e["id"], "nombre": nombre, "ciudad": ciudad,
            "sector": sector, "direccion": construir_direccion(t, e.get("dir_nominatim")),
            "telefono": _primera(t, "phone", "contact:phone", "contact:mobile", "mobile"),
            "email": _primera(t, "email", "contact:email"),
            "redes_sociales": redes(t), "web": web,
            "tiene_web": "sí" if web else "sin comprobar",
            "_horario": t.get("opening_hours"),
        }
        falta = []
        if not web:
            falta.append("sin web en OpenStreetMap (pendiente de comprobar)")
        elif any(d in web.lower() for d in ("facebook.com", "instagram.com", "linktr.ee")):
            falta.append("su 'web' es solo una red social o linktree")
        loc["que_le_falta"] = "; ".join(falta) or None
        loc["potencial"] = calcular_potencial(loc)
        loc["notas"] = f"horario OSM: {loc['_horario']}" if loc["_horario"] else None
        locales.append(loc)
    locales.sort(key=lambda x: -x["potencial"])
    return locales, descartes


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--sector")
    ap.add_argument("--ciudad")
    ap.add_argument("--max", type=int, default=20, help="máximo de locales NUEVOS a guardar")
    ap.add_argument("--fuente", choices=["auto", "overpass", "nominatim"], default="auto")
    ap.add_argument("--simular", action="store_true", help="no guarda nada")
    ap.add_argument("--json", action="store_true", help="salida en JSON")
    ap.add_argument("--sectores", action="store_true", help="lista los sectores")
    a = ap.parse_args()

    if a.sectores:
        for s, tags in SECTORES.items():
            print(f"{s:16} {', '.join(f'{k}={v}' for k, v in tags)}")
        return
    if not a.sector or not a.ciudad:
        ap.error("indica --sector y --ciudad (o --sectores para ver la lista)")
    sector = ALIAS.get(a.sector.lower(), a.sector.lower())
    if sector not in SECTORES:
        ap.error(f"sector desconocido '{a.sector}'. Usa --sectores para ver la lista.")

    print(f"Buscando '{sector}' en {a.ciudad}...", file=sys.stderr)
    ciudad_info = geocodificar_ciudad(a.ciudad)
    etiquetas = SECTORES[sector]
    elementos = None
    if a.fuente == "auto" and overpass_caido_hace_poco():
        print("  · Overpass falló hace menos de 30 min: voy directo al plan B.", file=sys.stderr)
    elif a.fuente in ("auto", "overpass"):
        try:
            elementos = buscar_overpass(ciudad_info, etiquetas)
        except RuntimeError as e:
            if a.fuente == "overpass":
                raise SystemExit(str(e))
            print(f"  · {e}. Uso el plan B (Nominatim + API de OSM).", file=sys.stderr)
    if elementos is None:
        elementos = buscar_nominatim(ciudad_info, etiquetas)

    locales, descartes = procesar(elementos, ciudad_info["nombre"], sector)
    nuevos, repetidos = [], 0
    con = None if a.simular else db.conectar()
    for loc in locales:
        if len(nuevos) >= a.max:
            break
        datos = {k: v for k, v in loc.items() if not k.startswith("_")}
        if con:
            lid, es_nuevo = db.insertar_local(con, datos)
            if not es_nuevo:
                repetidos += 1; continue
            datos["id"] = lid
        nuevos.append(datos)
    if con:
        con.commit()

    if a.json:
        print(json.dumps({"guardados": nuevos, "repetidos": repetidos, "descartados": descartes},
                         ensure_ascii=False, indent=1))
        return
    print(f"\nEncontrados en OSM: {len(elementos)} | independientes: {len(locales)} | "
          f"{'mostrando' if a.simular else 'guardados nuevos'}: {len(nuevos)} | ya estaban: {repetidos}")
    if descartes:
        print("Descartados: " + ", ".join(f"{k}: {v}" for k, v in descartes.items()))
    for d in nuevos:
        print(f"  [{d.get('id', '-'):>4}] {d['nombre'][:38]:38} pot {d['potencial']:>2}  "
              f"web: {d['web'] or 'NO':30.30} tel: {d['telefono'] or '-'}")


if __name__ == "__main__":
    main()
