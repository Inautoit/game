"""Base de datos de locales (SQLite).

Una fila por local. El estado avanza en este orden:
    encontrado -> demo lista -> mensaje redactado -> aprobado -> contactado -> respondió
Además existe "descartado" para apartar un local (cadena, cerrado, no interesa...).
"""
import os
import sqlite3
from datetime import datetime

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RUTA_DB = os.environ.get("LOCALES_DB", os.path.join(RAIZ, "locales.db"))

ESTADOS = [
    "encontrado",
    "demo lista",
    "mensaje redactado",
    "aprobado",
    "contactado",
    "respondió",
]
DESCARTADO = "descartado"
TODOS_LOS_ESTADOS = ESTADOS + [DESCARTADO]

ESQUEMA = """
CREATE TABLE IF NOT EXISTS locales (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    osm_tipo        TEXT,                 -- node / way / relation
    osm_id          INTEGER,
    nombre          TEXT NOT NULL,
    ciudad          TEXT NOT NULL,
    sector          TEXT NOT NULL,
    direccion       TEXT,
    telefono        TEXT,
    email           TEXT,
    redes_sociales  TEXT,                 -- "instagram: ..., facebook: ..."
    web             TEXT,                 -- URL si la tiene
    tiene_web       TEXT NOT NULL DEFAULT 'sin comprobar'
                    CHECK (tiene_web IN ('sí', 'no', 'sin comprobar')),
    que_le_falta    TEXT,                 -- p. ej. "sin web; sin reservas online"
    que_se_ofrece   TEXT,                 -- p. ej. "web + reservas por WhatsApp"
    potencial       INTEGER DEFAULT 0,    -- 0-10, cuanto más alto mejor candidato
    demo            TEXT,                 -- ruta o enlace de la demo
    mensaje         TEXT,                 -- mensaje redactado (NO se envía solo)
    estado          TEXT NOT NULL DEFAULT 'encontrado'
                    CHECK (estado IN ('encontrado','demo lista','mensaje redactado',
                                      'aprobado','contactado','respondió','descartado')),
    fecha           TEXT NOT NULL,        -- fecha del último cambio de estado
    fecha_alta      TEXT NOT NULL,
    notas           TEXT,
    UNIQUE (osm_tipo, osm_id)
);
CREATE INDEX IF NOT EXISTS idx_locales_estado ON locales(estado);
CREATE INDEX IF NOT EXISTS idx_locales_nombre_ciudad ON locales(nombre, ciudad);

CREATE TABLE IF NOT EXISTS historial (
    id        INTEGER PRIMARY KEY AUTOINCREMENT,
    local_id  INTEGER NOT NULL REFERENCES locales(id),
    estado    TEXT NOT NULL,
    fecha     TEXT NOT NULL,
    nota      TEXT
);
"""

# Campos que se pueden actualizar con panel.py actualizar
CAMPOS_EDITABLES = [
    "nombre", "ciudad", "sector", "direccion", "telefono", "email",
    "redes_sociales", "web", "tiene_web", "que_le_falta", "que_se_ofrece",
    "potencial", "demo", "mensaje", "notas",
]


def ahora():
    return datetime.now().strftime("%Y-%m-%d %H:%M")


def conectar(solo_lectura=False):
    if solo_lectura:
        if not os.path.exists(RUTA_DB):
            raise SystemExit(f"No existe la base de datos {RUTA_DB}")
        con = sqlite3.connect(f"file:{RUTA_DB}?mode=ro", uri=True)
    else:
        con = sqlite3.connect(RUTA_DB)
        con.executescript(ESQUEMA)
    con.row_factory = sqlite3.Row
    return con


def normalizar_nombre(nombre):
    import unicodedata
    n = unicodedata.normalize("NFKD", nombre or "").encode("ascii", "ignore").decode()
    return " ".join(n.lower().replace("'", " ").replace(".", " ").split())


def existe(con, osm_tipo, osm_id, nombre, ciudad):
    """Duplicado = mismo objeto OSM, o mismo nombre (normalizado) en la misma ciudad."""
    if osm_id is not None:
        r = con.execute("SELECT id FROM locales WHERE osm_tipo=? AND osm_id=?",
                        (osm_tipo, osm_id)).fetchone()
        if r:
            return r["id"]
    clave = normalizar_nombre(nombre)
    for r in con.execute("SELECT id, nombre FROM locales WHERE lower(ciudad)=lower(?)", (ciudad,)):
        if normalizar_nombre(r["nombre"]) == clave:
            return r["id"]
    return None


def insertar_local(con, datos):
    """Inserta un local si no existe. Devuelve (id, nuevo:bool)."""
    previo = existe(con, datos.get("osm_tipo"), datos.get("osm_id"),
                    datos["nombre"], datos["ciudad"])
    if previo:
        return previo, False
    f = ahora()
    campos = ["osm_tipo", "osm_id", "nombre", "ciudad", "sector", "direccion",
              "telefono", "email", "redes_sociales", "web", "tiene_web",
              "que_le_falta", "potencial", "notas"]
    valores = [datos.get(c) for c in campos]
    if valores[campos.index("tiene_web")] is None:
        valores[campos.index("tiene_web")] = "sin comprobar"
    cur = con.execute(
        f"INSERT INTO locales ({', '.join(campos)}, estado, fecha, fecha_alta) "
        f"VALUES ({', '.join('?' * len(campos))}, 'encontrado', ?, ?)",
        valores + [f, f],
    )
    con.execute("INSERT INTO historial (local_id, estado, fecha, nota) VALUES (?,?,?,?)",
                (cur.lastrowid, "encontrado", f, "alta desde OpenStreetMap"))
    return cur.lastrowid, True


def cambiar_estado(con, local_id, nuevo, nota=None, forzar=False):
    """Cambia el estado respetando el orden (no se puede saltar pasos salvo forzar)."""
    if nuevo not in TODOS_LOS_ESTADOS:
        raise ValueError(f"Estado no válido: {nuevo}. Opciones: {', '.join(TODOS_LOS_ESTADOS)}")
    r = con.execute("SELECT estado FROM locales WHERE id=?", (local_id,)).fetchone()
    if not r:
        raise ValueError(f"No existe el local {local_id}")
    actual = r["estado"]
    if not forzar and nuevo != DESCARTADO and actual != DESCARTADO:
        i_act, i_new = ESTADOS.index(actual), ESTADOS.index(nuevo)
        if i_new > i_act + 1:
            raise ValueError(
                f"El local {local_id} está en '{actual}'. No puede pasar a '{nuevo}' "
                f"sin pasar antes por '{ESTADOS[i_act + 1]}'.")
    f = ahora()
    con.execute("UPDATE locales SET estado=?, fecha=? WHERE id=?", (nuevo, f, local_id))
    con.execute("INSERT INTO historial (local_id, estado, fecha, nota) VALUES (?,?,?,?)",
                (local_id, nuevo, f, nota))


def actualizar(con, local_id, **campos):
    for k in campos:
        if k not in CAMPOS_EDITABLES:
            raise ValueError(f"Campo no editable: {k}. Editables: {', '.join(CAMPOS_EDITABLES)}")
    if not campos:
        return
    sets = ", ".join(f"{k}=?" for k in campos)
    con.execute(f"UPDATE locales SET {sets} WHERE id=?", list(campos.values()) + [local_id])


if __name__ == "__main__":
    with conectar() as c:
        n = c.execute("SELECT count(*) FROM locales").fetchone()[0]
    print(f"Base de datos lista en {RUTA_DB} ({n} locales)")
