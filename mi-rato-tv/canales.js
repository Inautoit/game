// Canales oficiales españoles. Cloudflare descarga sus últimos Shorts cada pocas horas.
// Para añadir uno: su identificador de canal (empieza por UC…) y su categoría.
export const CANALES = [
  { id: 'UC7QZIf0dta-XPXsp9Hv4dTw', nombre: 'RTVE Noticias', cat: 'noticias' },
  { id: 'UC_Oni82GyYcabEr3rd-eJkg', nombre: 'Antena 3 Noticias', cat: 'noticias' },
  { id: 'UCv2BcgqxHSrl2QQfIkjR5Eg', nombre: 'Telemadrid', cat: 'noticias' },
  { id: 'UCQ2Fej5pr1ipVeBWTX8Sc_Q', nombre: 'Cadena SER', cat: 'noticias' },
  { id: 'UCPCJV3XMMmdQ6ZJ4JPCf2jQ', nombre: 'José Mota', cat: 'humor' },
  { id: 'UCpu7hTlzAJUD-_PjjiBZCZg', nombre: 'Los Morancos', cat: 'humor' },
  { id: 'UCxthdekpMin2DTv4i-3AjDg', nombre: 'Got Talent España', cat: 'humor' },
  { id: 'UCC809eDg7gqOFGV7Ux_4ihg', nombre: 'Isabel Pantoja', cat: 'musica' },
  { id: 'UCZowf26DsJ0mL1Arj60A51w', nombre: 'La Voz', cat: 'musica' },
  { id: 'UCQtVEU1LEtZDj8aLi6Lkw2A', nombre: 'RTVE Cocina', cat: 'cocina' },
  { id: 'UCE9T3T5nhw4HxIeQBxGKSyw', nombre: 'RTVE Archivo', cat: 'nostalgia' },
  { id: 'UChtLgH7ZJLqLGWJpBnzy9Lg', nombre: 'Canal Sur', cat: 'humor' },
  { id: 'UChWJN4K0gKeOGo97m7mN14w', nombre: 'Informativos Telecinco', cat: 'noticias' },
  { id: 'UCMSOVP8zZq8BGwAJ2sEtOHw', nombre: 'Atresplayer', cat: 'nostalgia' },
  { id: 'UCWJ8aE2rSKlmJihqqhnK7Yg', nombre: 'Eltiempo.es', cat: 'noticias' },
  // Humor y entretenimiento
  { id: 'UCLNZvDlwQJMaQg477NAxvjQ', nombre: 'El Hormiguero', cat: 'humor' },
  { id: 'UCQcjDEVrrnRCgx99035ADtw', nombre: 'Carnaval de Cádiz (Canal Sur)', cat: 'humor' },
  { id: 'UCjsuIwGVcbyMU60tqrOXVVQ', nombre: 'MasterChef España', cat: 'humor' },
  // Series y programas de siempre
  { id: 'UCcJmo9dEwjkjOneRbmz7qfA', nombre: 'RTVE Series', cat: 'nostalgia' },
  { id: 'UCzFECXtTtodMuin8whWxDqQ', nombre: 'La 2', cat: 'nostalgia' },
  { id: 'UCE2CYjCSM-ebWPADoR7cLlg', nombre: 'Españoles en el mundo', cat: 'curiosidades' },
  { id: 'UCpyYUq9kcBMLPlfE8EzguvA', nombre: 'National Geographic España', cat: 'curiosidades' },
  // Música
  { id: 'UCF61cdwp7DHm6__qFNW3e0A', nombre: 'Dyango', cat: 'musica' },
  { id: 'UCVr4HNzc-0y2GYEh9UfQYJw', nombre: 'La Voz Kids', cat: 'musica' },
  { id: 'UCk7_W_QBCqMTYcVVQaImYUA', nombre: 'Cadena 100', cat: 'musica' },
  { id: 'UCliPx6aha_hf1oVyhDE1V9w', nombre: 'Orquesta y Coro RTVE', cat: 'musica' },
  // Cocina
  { id: 'UCq7v9oVEWn1T2Vn_CjM_X1w', nombre: 'Cocinatis', cat: 'cocina' },
  { id: 'UCMCQlw54oqPMRnKKRjsRnYA', nombre: 'Canal Cocina', cat: 'cocina' },
  { id: 'UCfYH5kIY7at9s5MR7gF1jkg', nombre: 'Directo al Paladar', cat: 'cocina' },
  // Deporte
  { id: 'UC4SBVYTpqOh-exr7BShLAPw', nombre: 'Teledeporte', cat: 'deporte' },
  { id: 'UCJ2F8qpzHRk3RdJZ4YXLbxQ', nombre: 'Selección Española', cat: 'deporte' },
  // Consejos útiles (estafas, seguridad)
  { id: 'UCmUAGTETe2N4ZIaAToIMobw', nombre: 'Policía Nacional', cat: 'util' },
];
// Orden de la mezcla: así no salen diez noticias seguidas.
export const RITMO = ['humor', 'noticias', 'musica', 'cocina', 'humor', 'nostalgia', 'curiosidades', 'noticias', 'humor', 'musica', 'deporte', 'cocina', 'util', 'nostalgia'];
// Títulos que no se muestran (anuncios, directos y sucesos duros).
export const FILTRO = /#publi|directo|muert|muere|fallec|asesin|matan|mató|violen|violad|agresi|apuñal|tirote|guerra|bomba|atentad|cad[aá]ver|suicid|terror|sangre|abus|secuestr|disparo|narco|incendio mortal/i;

/** Lee el XML de un feed de YouTube -> [{id, title, date}] */
export function parseFeed(xml) {
  const out = [];
  for (const e of xml.split('<entry>').slice(1)) {
    const id = (e.match(/<yt:videoId>([\w-]{11})<\/yt:videoId>/) || [])[1];
    const t = (e.match(/<title>([^<]*)<\/title>/) || [])[1] || '';
    const d = (e.match(/<published>([^<]*)<\/published>/) || [])[1] || '';
    if (id) out.push({ id, title: limpiar(t), raw: t, date: d });
  }
  return out;
}
function limpiar(t) {
  t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  return t.replace(/#\S+/g, '').replace(/\|\s*[^|]*$/, (m) => (m.length < 30 ? '' : m)).replace(/\s{2,}/g, ' ').trim();
}

/** Junta los feeds en una lista mezclada por categorías. */
export function mezclar(porCanal) {
  const porCat = {};
  for (const { canal, videos } of porCanal) {
    for (const v of videos) {
      if (FILTRO.test(v.raw)) continue;
      (porCat[canal.cat] ||= []).push({ id: v.id, title: v.title, canal: canal.nombre, cat: canal.cat, date: v.date });
    }
  }
  for (const k in porCat) porCat[k].sort((a, b) => b.date.localeCompare(a.date));
  const out = [], seen = new Set();
  let vacias = 0;
  for (let i = 0; vacias < RITMO.length; i++) {
    const c = RITMO[i % RITMO.length], lista = porCat[c];
    if (!lista || !lista.length) { vacias++; continue; }
    vacias = 0;
    const v = lista.shift();
    if (!seen.has(v.id)) { seen.add(v.id); out.push(v); }
  }
  return out;
}
