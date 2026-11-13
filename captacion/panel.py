#!/usr/bin/env python3
"""Panel de gestión de locales.

PARA TI (desde la carpeta del proyecto):
    python3 captacion/panel.py                    # menú interactivo
    python3 captacion/panel.py pendientes         # mensajes esperando tu aprobación
    python3 captacion/panel.py ver 12             # ficha completa de un local
    python3 captacion/panel.py aprobar 12 15      # aprobar uno o varios mensajes
    python3 captacion/panel.py corregir 12        # reescribir el mensaje (pega el texto nuevo)
    python3 captacion/panel.py corregir 12 --texto "Hola..." --aprobar
    python3 captacion/panel.py contactado 12      # ya le has escrito tú
    python3 captacion/panel.py respondio 12 --nota "le interesa, llamar el lunes"
    python3 captacion/panel.py descartar 12 --nota "es una cadena"
    python3 captacion/panel.py listar [--estado aprobado] [--ciudad Valencia] [--sector peluqueria]
    python3 captacion/panel.py resumen            # cuántos hay en cada estado

PARA LOS AGENTES:
    python3 captacion/panel.py actualizar 12 --que_le_falta "..." --tiene_web no --potencial 8
    python3 captacion/panel.py candidatos --ciudad Valencia --sector peluqueria --n 5
    python3 captacion/panel.py estado 12 "demo lista"
    python3 captacion/panel.py guardar-mensaje 12 --texto "..."
    python3 captacion/panel.py informe            # estadísticas (SOLO LECTURA, JSON)
"""
import argparse
import json
import os
import sys
import textwrap

import db

RAIZ = db.RAIZ


def _fila(r):
    return (f"[{r['id']:>4}] {r['nombre'][:34]:34} {r['sector'][:12]:12} {r['ciudad'][:12]:12} "
            f"{r['estado']:18} pot {r['potencial'] or 0:>2}")


def cmd_listar(con, a):
    q, p = "SELECT * FROM locales WHERE 1=1", []
    if a.estado:
        q += " AND estado=?"; p.append(a.estado)
    if a.ciudad:
        q += " AND lower(ciudad)=lower(?)"; p.append(a.ciudad)
    if a.sector:
        q += " AND sector=?"; p.append(a.sector)
    q += " ORDER BY potencial DESC, id"
    filas = con.execute(q, p).fetchall()
    for r in filas:
        print(_fila(r))
    print(f"\n{len(filas)} locales")


def cmd_ver(con, a):
    r = con.execute("SELECT * FROM locales WHERE id=?", (a.id,)).fetchone()
    if not r:
        sys.exit(f"No existe el local {a.id}")
    for k in r.keys():
        if k == "mensaje" or r[k] in (None, ""):
            continue
        print(f"{k:15}: {r[k]}")
    if r["mensaje"]:
        print("\n--- MENSAJE ---\n" + r["mensaje"] + "\n---------------")
    print("\nHistorial:")
    for h in con.execute("SELECT * FROM historial WHERE local_id=? ORDER BY id", (a.id,)):
        print(f"  {h['fecha']}  {h['estado']:18} {h['nota'] or ''}")


def cmd_pendientes(con, a):
    filas = con.execute("SELECT * FROM locales WHERE estado='mensaje redactado' ORDER BY id").fetchall()
    if not filas:
        print("No hay mensajes pendientes de aprobar.")
        return
    lineas = []
    for r in filas:
        lineas += [f"## [{r['id']}] {r['nombre']} — {r['sector']}, {r['ciudad']}",
                   f"Teléfono: {r['telefono'] or '-'} | Email: {r['email'] or '-'} | "
                   f"Redes: {r['redes_sociales'] or '-'}",
                   f"Le falta: {r['que_le_falta'] or '-'}",
                   f"Se ofrece: {r['que_se_ofrece'] or '-'}",
                   f"Demo: {r['demo'] or '-'}", "", r["mensaje"] or "(sin texto)", ""]
    texto = "\n".join(lineas)
    print(texto)
    print(f"{len(filas)} mensajes pendientes. Aprueba con: python3 captacion/panel.py aprobar ID [ID...]")
    if a.archivo:
        ruta = os.path.join(RAIZ, "mensajes_pendientes.md")
        with open(ruta, "w") as f:
            f.write("# Mensajes pendientes de aprobar\n\n" + texto)
        print(f"También guardado en {ruta}")


def _cambiar(con, ids, estado, nota=None):
    for i in ids:
        try:
            db.cambiar_estado(con, i, estado, nota)
            print(f"[{i}] -> {estado}")
        except ValueError as e:
            print(f"[{i}] NO cambiado: {e}")
    con.commit()


def cmd_aprobar(con, a):
    for i in a.ids:
        r = con.execute("SELECT estado, mensaje FROM locales WHERE id=?", (i,)).fetchone()
        if r and not r["mensaje"]:
            print(f"[{i}] no tiene mensaje; no se puede aprobar.")
            a.ids = [x for x in a.ids if x != i]
    _cambiar(con, a.ids, "aprobado", a.nota)


def cmd_corregir(con, a):
    r = con.execute("SELECT * FROM locales WHERE id=?", (a.id,)).fetchone()
    if not r:
        sys.exit(f"No existe el local {a.id}")
    texto = a.texto
    if texto is None:
        print("Mensaje actual:\n" + (r["mensaje"] or "(vacío)"))
        print("\nPega el mensaje corregido y termina con una línea que solo tenga un punto (.):")
        lineas = []
        for linea in sys.stdin:
            if linea.rstrip("\n") == ".":
                break
            lineas.append(linea.rstrip("\n"))
        texto = "\n".join(lineas).strip()
    if not texto:
        sys.exit("Texto vacío: no cambio nada.")
    db.actualizar(con, a.id, mensaje=texto)
    con.execute("INSERT INTO historial (local_id, estado, fecha, nota) VALUES (?,?,?,?)",
                (a.id, r["estado"], db.ahora(), "mensaje corregido a mano"))
    con.commit()
    print(f"[{a.id}] mensaje actualizado.")
    if a.aprobar:
        _cambiar(con, [a.id], "aprobado", "aprobado tras corregir")


def cmd_actualizar(con, a):
    campos = {k: v for k, v in vars(a).items() if k in db.CAMPOS_EDITABLES and v is not None}
    if "potencial" in campos:
        campos["potencial"] = int(campos["potencial"])
    db.actualizar(con, a.id, **campos)
    con.commit()
    print(f"[{a.id}] actualizado: {', '.join(campos) or 'nada'}")


def cmd_estado(con, a):
    _cambiar(con, [a.id], a.estado, a.nota)


def cmd_guardar_mensaje(con, a):
    texto = a.texto if a.texto is not None else open(a.archivo).read()
    r = con.execute("SELECT estado FROM locales WHERE id=?", (a.id,)).fetchone()
    if not r:
        sys.exit(f"No existe el local {a.id}")
    if r["estado"] not in ("demo lista", "mensaje redactado"):
        sys.exit(f"[{a.id}] está en '{r['estado']}'. Solo se redacta para locales con 'demo lista'.")
    campos = {"mensaje": texto.strip()}
    if a.que_se_ofrece:
        campos["que_se_ofrece"] = a.que_se_ofrece
    db.actualizar(con, a.id, **campos)
    if r["estado"] == "demo lista":
        db.cambiar_estado(con, a.id, "mensaje redactado", "redactado por el agente redactor")
    con.commit()
    print(f"[{a.id}] mensaje guardado (estado: mensaje redactado, pendiente de tu aprobación).")


def cmd_candidatos(con, a):
    q = "SELECT * FROM locales WHERE estado='encontrado'"
    p = []
    if a.ciudad:
        q += " AND lower(ciudad)=lower(?)"; p.append(a.ciudad)
    if a.sector:
        q += " AND sector=?"; p.append(a.sector)
    q += " ORDER BY potencial DESC, (telefono IS NOT NULL) DESC, id LIMIT ?"
    p.append(a.n)
    filas = [dict(r) for r in con.execute(q, p)]
    print(json.dumps(filas, ensure_ascii=False, indent=1))


def informe(con):
    """Estadísticas para el analista. Solo lectura."""
    est = {e: 0 for e in db.TODOS_LOS_ESTADOS}
    for r in con.execute("SELECT estado, count(*) n FROM locales GROUP BY estado"):
        est[r["estado"]] = r["n"]

    def tasa(col):
        out = []
        for r in con.execute(f"""
            SELECT {col} AS grupo, count(*) total,
              sum(estado IN ('contactado','respondió')) contactados,
              sum(estado='respondió') respondieron
            FROM locales GROUP BY {col} ORDER BY total DESC"""):
            d = dict(r)
            d["tasa_respuesta_%"] = round(100 * d["respondieron"] / d["contactados"], 1) if d["contactados"] else None
            out.append(d)
        return out

    ofertas = [dict(r) for r in con.execute(
        "SELECT id, nombre, sector, ciudad, estado, que_le_falta, que_se_ofrece, demo "
        "FROM locales WHERE estado NOT IN ('encontrado','descartado') ORDER BY id")]
    web = [dict(r) for r in con.execute("SELECT tiene_web, count(*) n FROM locales GROUP BY tiene_web")]
    falta = {}
    for r in con.execute("SELECT que_le_falta FROM locales WHERE que_le_falta IS NOT NULL"):
        for parte in r["que_le_falta"].split(";"):
            parte = parte.strip()
            if parte:
                falta[parte] = falta.get(parte, 0) + 1
    tiempos = [dict(r) for r in con.execute("""
        SELECT h1.local_id, h1.fecha contactado, h2.fecha respondio
        FROM historial h1 JOIN historial h2 ON h1.local_id=h2.local_id
        WHERE h1.estado='contactado' AND h2.estado='respondió'""")]
    sin_mover = con.execute("""SELECT count(*) FROM locales WHERE estado IN
        ('mensaje redactado','aprobado') AND fecha < datetime('now','-3 days')""").fetchone()[0]
    return {
        "total": sum(est.values()), "por_estado": est, "por_sector": tasa("sector"),
        "por_ciudad": tasa("ciudad"), "tiene_web": web,
        "carencias_mas_comunes": sorted(falta.items(), key=lambda x: -x[1])[:10],
        "ofrecido_a_cada_local": ofertas, "tiempos_contacto_respuesta": tiempos,
        "pendientes_de_mas_de_3_dias": sin_mover,
    }


def cmd_informe(con, a):
    print(json.dumps(informe(db.conectar(solo_lectura=True)), ensure_ascii=False, indent=1))


def cmd_resumen(con, a):
    i = informe(con)
    print(f"Total de locales: {i['total']}")
    for e, n in i["por_estado"].items():
        print(f"  {e:18} {n:>4}  {'█' * n}")


def menu(con):
    opciones = [
        ("Ver mensajes pendientes de aprobar", lambda: cmd_pendientes(con, argparse.Namespace(archivo=False))),
        ("Aprobar mensajes", lambda: cmd_aprobar(con, argparse.Namespace(
            ids=[int(x) for x in input("IDs a aprobar (separados por espacio): ").split()], nota=None))),
        ("Corregir un mensaje", lambda: cmd_corregir(con, argparse.Namespace(
            id=int(input("ID: ")), texto=None,
            aprobar=input("¿Aprobar después de corregir? (s/n): ").lower().startswith("s")))),
        ("Marcar como contactado", lambda: _cambiar(con, [int(x) for x in input("IDs: ").split()], "contactado")),
        ("Marcar que ha respondido", lambda: _cambiar(con, [int(input("ID: "))], "respondió",
                                                     input("Nota (qué ha dicho): ") or None)),
        ("Ver ficha de un local", lambda: cmd_ver(con, argparse.Namespace(id=int(input("ID: "))))),
        ("Listar locales por estado", lambda: cmd_listar(con, argparse.Namespace(
            estado=input(f"Estado ({', '.join(db.TODOS_LOS_ESTADOS)}; vacío = todos): ") or None,
            ciudad=None, sector=None))),
        ("Resumen", lambda: cmd_resumen(con, None)),
    ]
    while True:
        print("\n=== PANEL DE CAPTACIÓN ===")
        for n, (t, _) in enumerate(opciones, 1):
            print(f" {n}. {t}")
        print(" 0. Salir")
        try:
            o = input("> ").strip()
        except EOFError:
            return
        if o in ("0", "", "q"):
            return
        if o.isdigit() and 1 <= int(o) <= len(opciones):
            try:
                opciones[int(o) - 1][1]()
            except (ValueError, KeyboardInterrupt) as e:
                print(f"Error: {e}")


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sp = ap.add_subparsers(dest="cmd")
    p = sp.add_parser("listar"); p.add_argument("--estado"); p.add_argument("--ciudad"); p.add_argument("--sector")
    p = sp.add_parser("ver"); p.add_argument("id", type=int)
    p = sp.add_parser("pendientes"); p.add_argument("--archivo", action="store_true",
                                                    help="guarda también mensajes_pendientes.md")
    p = sp.add_parser("aprobar"); p.add_argument("ids", type=int, nargs="+"); p.add_argument("--nota")
    p = sp.add_parser("corregir"); p.add_argument("id", type=int); p.add_argument("--texto")
    p.add_argument("--aprobar", action="store_true")
    for nombre, estado in (("contactado", "contactado"), ("respondio", "respondió"), ("descartar", "descartado")):
        p = sp.add_parser(nombre); p.add_argument("ids", type=int, nargs="+"); p.add_argument("--nota")
        p.set_defaults(estado_fijo=estado)
    p = sp.add_parser("actualizar"); p.add_argument("id", type=int)
    for c in db.CAMPOS_EDITABLES:
        p.add_argument(f"--{c}")
    p = sp.add_parser("estado"); p.add_argument("id", type=int)
    p.add_argument("estado", choices=db.TODOS_LOS_ESTADOS); p.add_argument("--nota")
    p = sp.add_parser("guardar-mensaje"); p.add_argument("id", type=int)
    g = p.add_mutually_exclusive_group(required=True); g.add_argument("--texto"); g.add_argument("--archivo")
    p.add_argument("--que_se_ofrece")
    p = sp.add_parser("candidatos"); p.add_argument("--ciudad"); p.add_argument("--sector")
    p.add_argument("--n", type=int, default=5)
    sp.add_parser("informe"); sp.add_parser("resumen")
    a = ap.parse_args()

    if a.cmd == "informe":
        return cmd_informe(None, a)
    con = db.conectar()
    if a.cmd is None:
        return menu(con)
    if hasattr(a, "estado_fijo"):
        return _cambiar(con, a.ids, a.estado_fijo, a.nota)
    {"listar": cmd_listar, "ver": cmd_ver, "pendientes": cmd_pendientes, "aprobar": cmd_aprobar,
     "corregir": cmd_corregir, "actualizar": cmd_actualizar, "estado": cmd_estado,
     "guardar-mensaje": cmd_guardar_mensaje, "candidatos": cmd_candidatos,
     "resumen": cmd_resumen}[a.cmd](con, a)


if __name__ == "__main__":
    main()
