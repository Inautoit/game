/**
 * Carga automática de los dos Excel de la página /retrasos.
 *
 *  - getCuadrante(): lee el Cuadrante ÚNICO del mes actual de la carpeta de red
 *    (\\fileserver\...\Cuadrantes UNICOS). La primera vez el usuario elige esa
 *    carpeta; el navegador la recuerda (File System Access API, Edge/Chrome).
 *  - getCambiosTurno(): descarga "CambiosTurno_Puntualidad 26.xlsx" de SharePoint
 *    con la cuenta Microsoft del usuario (Microsoft Graph + MSAL).
 *
 * Dependencia: npm i @azure/msal-browser
 */
import { PublicClientApplication, InteractionRequiredAuthError } from "@azure/msal-browser";

// ---------------------------------------------------------------- Config
export const CONFIG = {
  // Lo da IT al registrar la aplicación en Entra ID (Azure AD)
  msClientId: "PEGAR_AQUI_CLIENT_ID",
  msTenantId: "PEGAR_AQUI_TENANT_ID",
  spHost: "verisure.sharepoint.com",
  spSitePath: "/sites/filerEs",
  spFileName: "CambiosTurno_Puntualidad 26.xlsx",
  spFileUniqueId: "EC0EF118-E30B-402F-941C-1A5F9E650F89", // 'sourcedoc' del enlace
  // Archivo del mes: 11_Cuadrante ÚNICO_Noviembre_2026.xlsm
  cuadrantePattern: (d: Date) =>
    new RegExp(`^${String(d.getMonth() + 1).padStart(2, "0")}_Cuadrante.*${d.getFullYear()}\\.xlsm$`, "i"),
};

// ---------------------------------------------------------------- Cuadrante (red)
const DB = "auto-carga-retrasos", STORE = "handles", KEY = "carpetaCuadrantes";

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

export const soportaCarpetas = () => "showDirectoryPicker" in window;

/** Pide (o recupera) la carpeta "Cuadrantes UNICOS". Llamar desde un clic. */
async function carpetaCuadrantes(forzarElegir = false): Promise<FileSystemDirectoryHandle> {
  if (!soportaCarpetas()) throw new Error("Usa Microsoft Edge o Google Chrome para la carga automática.");
  let dir = forzarElegir ? undefined : await idb<FileSystemDirectoryHandle | undefined>("readonly", s => s.get(KEY));
  if (dir) {
    const d = dir as any;
    if ((await d.queryPermission({ mode: "read" })) !== "granted" &&
        (await d.requestPermission({ mode: "read" })) !== "granted") dir = undefined;
  }
  if (!dir) {
    alert('Elige la carpeta "Cuadrantes UNICOS".\nEn la barra de direcciones puedes pegar:\n' +
      "\\\\fileserver\\SSRR_SP\\Operaciones Comerciales\\INFORMES\\Ventas al Portfolio\\Planificacion Comercial\\Workforce\\01.Cuadrantes\\00.Cuadrantes\\Cuadrantes UNICOS");
    dir = await (window as any).showDirectoryPicker({ id: "cuadrantes", mode: "read" });
    await idb("readwrite", s => s.put(dir, KEY));
  }
  return dir!;
}

export async function getCuadrante(fecha = new Date(), forzarElegir = false): Promise<File> {
  const raiz = await carpetaCuadrantes(forzarElegir);
  let anio: FileSystemDirectoryHandle;
  try {
    anio = await raiz.getDirectoryHandle(String(fecha.getFullYear()));
  } catch {
    // Puede que hayan elegido directamente la carpeta del año
    if (raiz.name === String(fecha.getFullYear())) anio = raiz;
    else throw new Error(`No encuentro la carpeta ${fecha.getFullYear()} dentro de "${raiz.name}". ` +
      'Pulsa "Cambiar carpeta" y elige "Cuadrantes UNICOS".');
  }
  const patron = CONFIG.cuadrantePattern(fecha);
  let mejor: File | undefined;
  for await (const entrada of (anio as any).values()) {
    if (entrada.kind !== "file" || entrada.name.startsWith("~$") || !patron.test(entrada.name)) continue;
    const f: File = await entrada.getFile();
    if (!mejor || f.lastModified > mejor.lastModified) mejor = f;
  }
  if (!mejor) throw new Error(`No hay cuadrante del mes en ${raiz.name}\\${anio.name} (${patron.source}).`);
  // Copia en memoria: el archivo de red puede cambiar mientras se procesa
  return new File([await mejor.arrayBuffer()], mejor.name, { type: mejor.type, lastModified: mejor.lastModified });
}

// ---------------------------------------------------------------- Cambios (SharePoint)
const SCOPES = ["Files.Read.All"];
let msal: PublicClientApplication | undefined;

async function tokenGraph(): Promise<string> {
  if (!msal) {
    msal = new PublicClientApplication({
      auth: {
        clientId: CONFIG.msClientId,
        authority: `https://login.microsoftonline.com/${CONFIG.msTenantId}`,
        redirectUri: window.location.origin,
      },
      cache: { cacheLocation: "localStorage" },
    });
    await msal.initialize();
  }
  const cuenta = msal.getAllAccounts()[0];
  if (cuenta) {
    try {
      return (await msal.acquireTokenSilent({ scopes: SCOPES, account: cuenta })).accessToken;
    } catch (e) {
      if (!(e instanceof InteractionRequiredAuthError)) throw e;
    }
  }
  return (await msal.acquireTokenPopup({ scopes: SCOPES })).accessToken;
}

async function graph(url: string, token: string) {
  const r = await fetch(url.startsWith("http") ? url : `https://graph.microsoft.com/v1.0${url}`,
    { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`SharePoint respondió ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}

export async function getCambiosTurno(): Promise<File> {
  const token = await tokenGraph();
  const site = await (await graph(`/sites/${CONFIG.spHost}:${CONFIG.spSitePath}`, token)).json();
  const q = encodeURIComponent(CONFIG.spFileName.replace(/'/g, "''"));
  const res = await (await graph(
    `/sites/${site.id}/drive/root/search(q='${q}')?$select=id,name,parentReference,sharepointIds,lastModifiedDateTime`,
    token)).json();
  const items: any[] = res.value ?? [];
  const uid = CONFIG.spFileUniqueId.toLowerCase();
  const item = items.find(i => i.sharepointIds?.listItemUniqueId?.toLowerCase() === uid)
            ?? items.find(i => i.name === CONFIG.spFileName);
  if (!item) throw new Error(`No encuentro "${CONFIG.spFileName}" en SharePoint (¿tienes acceso?).`);
  const blob = await (await graph(`/drives/${item.parentReference.driveId}/items/${item.id}/content`, token)).blob();
  return new File([blob], item.name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    lastModified: Date.parse(item.lastModifiedDateTime) || Date.now(),
  });
}

// ---------------------------------------------------------------- Todo junto
/** Llamar desde el onClick del botón. Devuelve los dos File listos para procesar. */
export async function cargarAmbos() {
  const cuadrante = await getCuadrante(); // primero: necesita el gesto del clic para el permiso
  const cambios = await getCambiosTurno();
  return { cuadrante, cambios };
}
