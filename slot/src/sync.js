// Sincronización del progreso con la cuenta: qué se guarda y cómo se juntan dos dispositivos.
// Regla general: de cada cosa se queda lo mejor (el tiempo más bajo, la mejor posición, todos los
// circuitos creados…). Las preferencias (coche, pintura, reglaje, nombre) las decide quien se aplica.

// Claves del almacenamiento local que viajan con la cuenta
export const SYNC_KEYS = ['best', 'pos', 'cups', 'coins', 'mytracks', 'liked', 'car0', 'liv0', 'setup0'];
export const SYNC_PREFIXES = ['ghost.', 'wrsent.'];
const PREFS = new Set(['car0', 'liv0', 'setup0', 'pilot']);
export const isSynced = (k) => SYNC_KEYS.includes(k) || SYNC_PREFIXES.some((p) => k.startsWith(p));

const minMap = (a = {}, b = {}) => {
  const o = { ...a };
  for (const [k, v] of Object.entries(b)) if (Number.isFinite(v) && (!Number.isFinite(o[k]) || v < o[k])) o[k] = v;
  return o;
};

// Junta dos juegos de claves. «prefer» = 'local' | 'remote' decide las preferencias.
export function mergeKeys(local = {}, remote = {}, prefer = 'local') {
  const out = {};
  const keys = new Set([...Object.keys(local), ...Object.keys(remote)]);
  for (const k of keys) {
    const a = local[k], b = remote[k];
    if (a === undefined) { out[k] = b; continue; }
    if (b === undefined) { out[k] = a; continue; }
    if (k === 'best' || k === 'pos' || k === 'cups') out[k] = minMap(a, b);
    else if (k === 'coins') out[k] = Math.max(+a || 0, +b || 0);
    else if (k === 'liked') out[k] = [...new Set([...(a || []), ...(b || [])])];
    else if (k === 'mytracks') {
      const byId = new Map();
      for (const d of [...(b || []), ...(a || [])]) {
        if (!d || !d.lid) continue;
        const prev = byId.get(d.lid);
        // Del mismo circuito, el que tenga más trabajo hecho (más piezas); si empatan, el de este dispositivo
        if (!prev || (d.pieces || []).length >= (prev.pieces || []).length) byId.set(d.lid, d);
      }
      out[k] = [...byId.values()].slice(0, 60);
    } else if (k.startsWith('ghost.')) out[k] = (b && Number.isFinite(b.t) && (!a || !(a.t <= b.t))) ? b : a;
    else if (k.startsWith('wrsent.')) out[k] = Math.min(+a, +b);
    else if (PREFS.has(k)) out[k] = prefer === 'remote' ? b : a;
    else out[k] = prefer === 'remote' ? b : a;
  }
  return out;
}

// Perfil completo: { keys, statsBy: { dispositivo: estadísticas } }
// Las estadísticas se guardan por dispositivo para poder sumarlas sin contar dos veces.
export function mergeProfile(local, remote, prefer = 'local') {
  const statsBy = { ...(remote.statsBy || {}) };
  for (const [dev, s] of Object.entries(local.statsBy || {})) {
    const r = statsBy[dev];
    statsBy[dev] = !r ? s : Object.fromEntries(Object.keys({ ...r, ...s }).map((f) => [f, Math.max(+r[f] || 0, +s[f] || 0)]));
  }
  return { keys: mergeKeys(local.keys || {}, remote.keys || {}, prefer), statsBy };
}

// Suma de las estadísticas de los demás dispositivos (para mostrarlas junto a las de este)
export function otherStats(statsBy = {}, me) {
  const o = { races: 0, wins: 0, crashes: 0, laps: 0 };
  for (const [dev, s] of Object.entries(statsBy)) if (dev !== me) for (const f of Object.keys(o)) o[f] += +s[f] || 0;
  return o;
}

// Si el perfil pasa del tamaño máximo, se quitan primero los fantasmas más largos (son lo que más ocupa)
export function fitProfile(p, max) {
  let text = JSON.stringify(p);
  if (text.length <= max) return p;
  const keys = { ...p.keys };
  const ghosts = Object.keys(keys).filter((k) => k.startsWith('ghost.')).sort((x, y) => JSON.stringify(keys[y]).length - JSON.stringify(keys[x]).length);
  for (const g of ghosts) {
    delete keys[g];
    text = JSON.stringify({ ...p, keys });
    if (text.length <= max) break;
  }
  return { ...p, keys };
}
