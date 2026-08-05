// Estado del coche + catálogo de opciones + presets.
// Todo el "tuning" vive aquí como datos; el resto del código solo lo lee.

// ---------- Configuración por defecto ----------
export const DEFAULTS = {
  model: 'coupe',        // coupe | hatch | sedan | muscle | super | kei
  paint: '#c81f2a',      // color de carrocería
  finish: 'gloss',       // gloss | metallic | matte | chrome | pearl
  wheelStyle: 'spoke5',  // spoke5 | mesh | split10 | dish | steelie
  wheelColor: '#15171d', // color de la llanta
  wheelSize: 18,         // pulgadas (15..20)
  tint: 0.7,             // oscuridad de lunas (0 claro .. 1 limo)
  rideHeight: 0.34,      // altura de suspensión en m (0.16 slam .. 0.58 lift)
  camber: 3,             // caída negativa en grados (0..14)
  poke: 0.0,             // cuánto sobresalen las ruedas (-0.02..0.14)
  wing: 'lip',           // none | lip | ducktail | gt
  splitter: true,        // faldón/splitter delantero
  skirts: true,          // taloneras laterales
  widebody: false,       // ensanchado (aletas anchas)
  caliper: '#e0b000',    // color de pinzas de freno
  hood: 'stock',         // stock | scoop | vented
  underglow: false,      // neón inferior
  underglowColor: '#22d3ee',
  bg: 'studio',          // studio | dusk | night | white
  autoRotate: true,
};

// ---------- Catálogos para la interfaz ----------
export const MODELS = [
  { id: 'coupe',  name: 'Coupé JDM' },
  { id: 'hatch',  name: 'Hatchback' },
  { id: 'sedan',  name: 'Berlina' },
  { id: 'muscle', name: 'Muscle' },
  { id: 'super',  name: 'Superdeportivo' },
  { id: 'kei',    name: 'Kei / Van' },
];

export const FINISHES = [
  { id: 'gloss',    name: 'Brillo' },
  { id: 'metallic', name: 'Metalizado' },
  { id: 'matte',    name: 'Mate' },
  { id: 'pearl',    name: 'Perlado' },
  { id: 'chrome',   name: 'Cromado' },
];

export const WHEEL_STYLES = [
  { id: 'spoke5',  name: '5 radios' },
  { id: 'mesh',    name: 'Malla (mesh)' },
  { id: 'split10', name: 'Split 10' },
  { id: 'dish',    name: 'Deep dish' },
  { id: 'steelie', name: 'Acero + tapa' },
];

export const WINGS = [
  { id: 'none',     name: 'Sin alerón' },
  { id: 'lip',      name: 'Lip trasero' },
  { id: 'ducktail', name: 'Ducktail' },
  { id: 'gt',       name: 'Ala GT' },
];

export const HOODS = [
  { id: 'stock',  name: 'Estándar' },
  { id: 'scoop',  name: 'Toma de aire' },
  { id: 'vented', name: 'Ventilado' },
];

export const BACKGROUNDS = [
  { id: 'studio', name: 'Estudio' },
  { id: 'dusk',   name: 'Atardecer' },
  { id: 'night',  name: 'Noche' },
  { id: 'white',  name: 'Blanco' },
];

// Colores rápidos de pintura (paleta) y de llantas.
export const PAINT_SWATCHES = [
  '#c81f2a', '#1560d8', '#12a150', '#f4b400', '#e85d04',
  '#7b2cbf', '#0b0d12', '#f2f4f8', '#8a8f98', '#00b4d8',
  '#e0e0e0', '#3a3f46', '#d81b60', '#00e5a0', '#5c3d2e',
];
export const WHEEL_SWATCHES = [
  '#15171d', '#c9ccd4', '#b08d2b', '#8a5a2b', '#f2f4f8',
  '#e0b000', '#1560d8', '#c81f2a', '#0b0d12', '#00e5a0',
];

// ---------- Presets ----------
export const PRESETS = [
  {
    id: 'stock', name: 'De serie',
    cfg: { finish: 'metallic', wheelStyle: 'spoke5', wheelColor: '#c9ccd4',
      wheelSize: 17, rideHeight: 0.42, camber: 0.5, poke: 0, wing: 'none',
      splitter: false, skirts: false, widebody: false, tint: 0.35,
      hood: 'stock', underglow: false },
  },
  {
    id: 'jdm', name: 'JDM Stance',
    cfg: { finish: 'gloss', wheelStyle: 'dish', wheelColor: '#b08d2b',
      wheelSize: 18, rideHeight: 0.19, camber: 10, poke: 0.10, wing: 'ducktail',
      splitter: true, skirts: true, widebody: false, tint: 0.85,
      hood: 'stock', underglow: false, paint: '#0b0d12' },
  },
  {
    id: 'widebody', name: 'Widebody GT',
    cfg: { finish: 'matte', wheelStyle: 'split10', wheelColor: '#15171d',
      wheelSize: 19, rideHeight: 0.26, camber: 4, poke: 0.06, wing: 'gt',
      splitter: true, skirts: true, widebody: true, tint: 0.7,
      hood: 'vented', underglow: false, paint: '#3a3f46', caliper: '#c81f2a' },
  },
  {
    id: 'drift', name: 'Drift Missile',
    cfg: { finish: 'gloss', wheelStyle: 'spoke5', wheelColor: '#f2f4f8',
      wheelSize: 18, rideHeight: 0.24, camber: 6, poke: 0.08, wing: 'gt',
      splitter: true, skirts: true, widebody: true, tint: 0.6,
      hood: 'scoop', underglow: false, paint: '#e85d04', model: 'coupe' },
  },
  {
    id: 'show', name: 'Show Car',
    cfg: { finish: 'chrome', wheelStyle: 'mesh', wheelColor: '#e0b000',
      wheelSize: 20, rideHeight: 0.20, camber: 3, poke: 0.05, wing: 'gt',
      splitter: true, skirts: true, widebody: true, tint: 0.9,
      hood: 'vented', underglow: true, underglowColor: '#c026d3',
      bg: 'night', paint: '#7b2cbf' },
  },
  {
    id: 'offroad', name: 'Lifted',
    cfg: { finish: 'matte', wheelStyle: 'steelie', wheelColor: '#15171d',
      wheelSize: 17, rideHeight: 0.58, camber: 0, poke: 0.04, wing: 'none',
      splitter: false, skirts: false, widebody: false, tint: 0.5,
      hood: 'stock', underglow: false, paint: '#5c3d2e', model: 'kei' },
  },
];

// ---------- (De)serialización para guardar y compartir ----------
export function encodeConfig(cfg) {
  try {
    const json = JSON.stringify(cfg);
    return btoa(unescape(encodeURIComponent(json)));
  } catch { return ''; }
}

export function decodeConfig(str) {
  try {
    const json = decodeURIComponent(escape(atob(str)));
    const obj = JSON.parse(json);
    return sanitize(obj);
  } catch { return null; }
}

// Solo aceptamos claves conocidas y con el tipo correcto.
export function sanitize(obj) {
  const out = { ...DEFAULTS };
  if (!obj || typeof obj !== 'object') return out;
  for (const k of Object.keys(DEFAULTS)) {
    if (obj[k] === undefined) continue;
    if (typeof DEFAULTS[k] === typeof obj[k]) out[k] = obj[k];
  }
  // Clamps numéricos por seguridad
  out.wheelSize = clamp(out.wheelSize, 15, 20);
  out.tint = clamp(out.tint, 0, 1);
  out.rideHeight = clamp(out.rideHeight, 0.16, 0.6);
  out.camber = clamp(out.camber, 0, 14);
  out.poke = clamp(out.poke, -0.03, 0.16);
  return out;
}

export function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
