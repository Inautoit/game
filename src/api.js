// Cliente de la API de mapas de la comunidad (Worker + D1).
async function req(path, opts = {}) {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), 9000);
  try {
    const r = await fetch('/api/' + path, {
      ...opts,
      signal: ctrl.signal,
      headers: opts.body ? { 'content-type': 'application/json' } : undefined,
    });
    let data = null;
    try { data = await r.json(); } catch { /* sin cuerpo */ }
    if (!r.ok) throw new Error((data && data.error) || 'No hay conexión con el servidor');
    return data;
  } catch (e) {
    if (e.name === 'AbortError' || e instanceof TypeError) throw new Error('No hay conexión. Inténtalo de nuevo');
    throw e;
  } finally {
    clearTimeout(to);
  }
}

export const listMaps = (sort) => req('maps?sort=' + encodeURIComponent(sort)).then((d) => d.maps);
export const listByIds = (ids) => req('maps?ids=' + ids.join(',')).then((d) => d.maps);
export const getMap = (id) => req('maps/' + encodeURIComponent(id)).then((d) => d.map);
export const publish = (m) => req('maps', { method: 'POST', body: JSON.stringify(m) });
export const ping = (id, act, body) => req(`maps/${encodeURIComponent(id)}/${act}`, { method: 'POST', body: JSON.stringify(body || {}) }).catch(() => {});
