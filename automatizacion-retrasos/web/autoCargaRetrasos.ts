/**
 * Carga automática de los dos Excel de /retrasos. Sin dependencias.
 * Solo Edge/Chrome (File System Access API). El navegador recuerda lo elegido.
 *
 * - getCuadrante(): la primera vez se elige la carpeta "Cuadrantes UNICOS" (red).
 *   Después coge sola <año>\<MM>_Cuadrante*<año>.xlsm del mes actual.
 * - getCambiosTurno(): la primera vez se elige "CambiosTurno_Puntualidad 26.xlsx"
 *   en la carpeta de SharePoint sincronizada con OneDrive. Después lo relee solo
 *   (siempre la versión más reciente).
 */

const RUTA_CUADRANTES =
  "\\\\fileserver\\SSRR_SP\\Operaciones Comerciales\\INFORMES\\Ventas al Portfolio\\Planificacion Comercial\\Workforce\\01.Cuadrantes\\00.Cuadrantes\\Cuadrantes UNICOS";
const NOMBRE_CAMBIOS = "CambiosTurno_Puntualidad 26.xlsx";

const DB = "auto-carga-retrasos";
const STORE = "handles";

function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE);
    open.onerror = () => reject(open.error);
    open.onsuccess = () => {
      const req = fn(open.result.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    };
  });
}

export const soportaAutoCarga = () => "showDirectoryPicker" in window && "showOpenFilePicker" in window;

async function permiso(h: any): Promise<boolean> {
  return (await h.queryPermission({ mode: "read" })) === "granted" ||
         (await h.requestPermission({ mode: "read" })) === "granted";
}

async function handleGuardado<T>(clave: string, forzar: boolean, elegir: () => Promise<T>): Promise<T> {
  if (!soportaAutoCarga()) throw new Error("Usa Microsoft Edge o Google Chrome para la carga automática.");
  let h = forzar ? undefined : await idb<T | undefined>("readonly", s => s.get(clave));
  if (h && !(await permiso(h))) h = undefined;
  if (!h) {
    h = await elegir();
    await idb("readwrite", s => s.put(h, clave));
  }
  return h as T;
}

async function copiaEnMemoria(f: File): Promise<File> {
  return new File([await f.arrayBuffer()], f.name, { type: f.type, lastModified: f.lastModified });
}

/** Cuadrante ÚNICO del mes. forzar=true vuelve a pedir la carpeta. */
export async function getCuadrante(fecha = new Date(), forzar = false): Promise<File> {
  const raiz = await handleGuardado<FileSystemDirectoryHandle>("carpetaCuadrantes", forzar, async () => {
    alert('Elige la carpeta "Cuadrantes UNICOS".\n\nPuedes pegar esta ruta en la barra de direcciones de la ventana:\n' + RUTA_CUADRANTES);
    return (window as any).showDirectoryPicker({ id: "cuadrantes", mode: "read" });
  });
  const anioTxt = String(fecha.getFullYear());
  let carpeta: FileSystemDirectoryHandle;
  try {
    carpeta = await raiz.getDirectoryHandle(anioTxt);
  } catch {
    if (raiz.name !== anioTxt) throw new Error(`No encuentro la carpeta ${anioTxt} dentro de "${raiz.name}". Pulsa "Cambiar carpetas".`);
    carpeta = raiz;
  }
  const mes = String(fecha.getMonth() + 1).padStart(2, "0");
  const patron = new RegExp(`^${mes}_Cuadrante.*${anioTxt}\\.xlsm$`, "i");
  let mejor: File | undefined;
  for await (const e of (carpeta as any).values()) {
    if (e.kind !== "file" || e.name.startsWith("~$") || !patron.test(e.name)) continue;
    const f: File = await e.getFile();
    if (!mejor || f.lastModified > mejor.lastModified) mejor = f;
  }
  if (!mejor) throw new Error(`No hay cuadrante de ${mes}/${anioTxt} en la carpeta ${carpeta.name}.`);
  return copiaEnMemoria(mejor);
}

/** Excel de cambios de turno (copia sincronizada de SharePoint). forzar=true lo vuelve a pedir. */
export async function getCambiosTurno(forzar = false): Promise<File> {
  const h = await handleGuardado<FileSystemFileHandle>("archivoCambios", forzar, async () => {
    alert(`Elige el archivo "${NOMBRE_CAMBIOS}".\n\nEstá en la carpeta de SharePoint sincronizada con OneDrive ` +
      '(en el Explorador de archivos, a la izquierda, con el nombre de la empresa).\n' +
      'Si no la tienes: abre el archivo en SharePoint, ve a su biblioteca y pulsa "Sincronizar".');
    const [fh] = await (window as any).showOpenFilePicker({
      id: "cambios", multiple: false,
      types: [{ description: "Excel", accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] } }],
    });
    return fh;
  });
  return copiaEnMemoria(await h.getFile());
}
