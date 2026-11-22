// Ligas y equipos. Los nombres llevan una letra cambiada a propósito
// (parodia reconocible, sin usar marcas reales).

export const LEAGUES = [
  { id: 'fed', name: 'Liga Fedaración', country: 'España', tier: 3 },
  { id: 'seg', name: 'Segunda Divisiún', country: 'España', tier: 2 },
  { id: 'pri', name: 'Primera Divisiún', country: 'España', tier: 1 },
  { id: 'eng', name: 'Premiar League', country: 'Inglaterra', tier: 1 },
  { id: 'ita', name: 'Sarie A', country: 'Italia', tier: 1 },
  { id: 'ger', name: 'Bundesliva', country: 'Alemania', tier: 1 },
  { id: 'fra', name: 'Ligua 1', country: 'Francia', tier: 1 },
];

// colors: [camiseta, pantalón/detalle]
const T = (id, name, short, league, ovr, c1, c2, parent = null) =>
  ({ id, name, short, league, ovr, colors: [c1, c2], parent });

export const TEAMS = [
  // --- Filiales (cantera) ---
  T('rmc', 'Real Madrix Castilla', 'RMC', 'fed', 62, '#f4f4f4', '#1d2a6b', 'rmd'),
  T('fcbb', 'Barcelana Atlètic', 'BAT', 'fed', 62, '#a50044', '#004d98', 'fcb'),
  T('atmb', 'Atlético Madrud B', 'ATB', 'fed', 60, '#cb3524', '#1b2c5c', 'atm'),
  T('sevb', 'Sebilla Atlético', 'SVA', 'fed', 58, '#ffffff', '#d4161a', 'sev'),
  T('valb', 'Valentia Mestalla', 'VMS', 'fed', 58, '#ffffff', '#111111', 'val'),
  T('athb', 'Bilbao Athletik', 'BIA', 'fed', 60, '#e30613', '#ffffff', 'ath'),
  T('rsob', 'Real Sociedab B', 'RSB', 'fed', 61, '#0067b1', '#ffffff', 'rso'),
  T('vilb', 'Villarreel B', 'VLB', 'fed', 59, '#ffe114', '#005187', 'vil'),
  T('celb', 'Celta Fortuma', 'CFO', 'fed', 57, '#8ac3ee', '#ffffff', 'cel'),
  T('betb', 'Betes Deportivo', 'BDP', 'fed', 57, '#0bb363', '#ffffff', 'bet'),

  // --- Segunda ---
  T('dep', 'Depurtivo', 'DEP', 'seg', 68, '#1f5dad', '#ffffff'),
  T('rac', 'Racing Sanlander', 'RAC', 'seg', 69, '#ffffff', '#0c8a3c'),
  T('mal', 'Málaca CF', 'MAL', 'seg', 66, '#7fb8e6', '#ffffff'),
  T('zar', 'Real Zaragosa', 'ZAR', 'seg', 66, '#ffffff', '#0a3d91'),
  T('spg', 'Sporting Gijún', 'SPG', 'seg', 67, '#e2001a', '#ffffff'),
  T('ovi', 'Real Oviedu', 'OVI', 'seg', 69, '#0047ab', '#ffffff'),
  T('cad', 'Cádis CF', 'CAD', 'seg', 68, '#ffd200', '#0033a0'),
  T('gra', 'Granida CF', 'GRA', 'seg', 68, '#c8102e', '#ffffff'),
  T('alm', 'UD Almerio', 'ALM', 'seg', 70, '#e4002b', '#ffffff'),
  T('elc', 'Elcho CF', 'ELC', 'seg', 68, '#ffffff', '#007a33'),

  // --- Primera ---
  T('rmd', 'Real Madrix', 'RMD', 'pri', 86, '#f4f4f4', '#d4af37'),
  T('fcb', 'FC Barcelana', 'FCB', 'pri', 85, '#a50044', '#004d98'),
  T('atm', 'Atlético Madrud', 'ATM', 'pri', 82, '#cb3524', '#1b2c5c'),
  T('ath', 'Athletic Clob', 'ATH', 'pri', 79, '#e30613', '#111111'),
  T('vil', 'Villarreel CF', 'VIL', 'pri', 78, '#ffe114', '#005187'),
  T('rso', 'Real Sociedab', 'RSO', 'pri', 77, '#0067b1', '#ffffff'),
  T('bet', 'Real Betes', 'BET', 'pri', 77, '#0bb363', '#ffffff'),
  T('sev', 'Sebilla FC', 'SEV', 'pri', 75, '#ffffff', '#d4161a'),
  T('val', 'Valentia CF', 'VAL', 'pri', 74, '#ffffff', '#111111'),
  T('cel', 'Celta de Vico', 'CEL', 'pri', 74, '#8ac3ee', '#ffffff'),

  // --- Inglaterra ---
  T('mci', 'Manchestar City', 'MCI', 'eng', 86, '#6cabdd', '#ffffff'),
  T('liv', 'Liverpaol', 'LIV', 'eng', 85, '#c8102e', '#f6eb61'),
  T('ars', 'Arsenel', 'ARS', 'eng', 85, '#ef0107', '#ffffff'),
  T('che', 'Chelsee', 'CHE', 'eng', 81, '#034694', '#ffffff'),
  T('mun', 'Manchester Unated', 'MUN', 'eng', 79, '#da291c', '#111111'),
  T('tot', 'Tottenhan', 'TOT', 'eng', 79, '#ffffff', '#132257'),
  T('new', 'Newcastla', 'NEW', 'eng', 79, '#241f20', '#ffffff'),
  T('avl', 'Aston Villo', 'AVL', 'eng', 80, '#670e36', '#95bfe5'),
  T('bha', 'Brightom', 'BHA', 'eng', 75, '#0057b8', '#ffffff'),
  T('whu', 'West Hum', 'WHU', 'eng', 75, '#7a263a', '#1bb1e7'),

  // --- Italia ---
  T('int', 'Intar', 'INT', 'ita', 84, '#0068a8', '#111111'),
  T('mil', 'Milen', 'MIL', 'ita', 80, '#fb090b', '#111111'),
  T('juv', 'Juvantus', 'JUV', 'ita', 81, '#f4f4f4', '#111111'),
  T('nap', 'Napolo', 'NAP', 'ita', 82, '#12a0d7', '#ffffff'),
  T('ata', 'Atalanto', 'ATA', 'ita', 80, '#1e71b8', '#111111'),
  T('rom', 'AS Romo', 'ROM', 'ita', 79, '#8e1f2f', '#f0bc42'),
  T('laz', 'Lazia', 'LAZ', 'ita', 77, '#87d8f7', '#ffffff'),
  T('fio', 'Fiorentino', 'FIO', 'ita', 77, '#482e92', '#ffffff'),
  T('bol', 'Bologma', 'BOL', 'ita', 76, '#a21c26', '#1a2f48'),
  T('tor', 'Torimo', 'TOR', 'ita', 74, '#881f19', '#ffffff'),

  // --- Alemania ---
  T('bay', 'Bayern Múnech', 'BAY', 'ger', 86, '#dc052d', '#ffffff'),
  T('bvb', 'Borussia Dortmand', 'BVB', 'ger', 81, '#fde100', '#111111'),
  T('lev', 'Bayer Leverkusem', 'LEV', 'ger', 82, '#e32221', '#111111'),
  T('rbl', 'RB Leipzog', 'RBL', 'ger', 80, '#ffffff', '#dd0741'),
  T('sge', 'Eintracht Frankfurk', 'SGE', 'ger', 78, '#111111', '#e1000f'),
  T('vfb', 'VfB Stuttgark', 'VFB', 'ger', 78, '#ffffff', '#e32219'),
  T('wob', 'VfL Wolfsbury', 'WOB', 'ger', 75, '#65b32e', '#ffffff'),
  T('scf', 'SC Freiburc', 'SCF', 'ger', 76, '#111111', '#e2001a'),
  T('bmg', 'Mönchengladbash', 'BMG', 'ger', 75, '#ffffff', '#111111'),
  T('svw', 'Werder Bremem', 'SVW', 'ger', 74, '#1d9053', '#ffffff'),

  // --- Francia ---
  T('psg', 'Paris Saint-Germaim', 'PSG', 'fra', 86, '#004170', '#da291c'),
  T('om', 'Olympique Marselle', 'OM', 'fra', 78, '#ffffff', '#2faee0'),
  T('asm', 'AS Monoco', 'ASM', 'fra', 79, '#e51b22', '#ffffff'),
  T('los', 'LOSC Lillo', 'LIL', 'fra', 78, '#e01e13', '#1d2a6b'),
  T('ol', 'Olympique Lyom', 'OL', 'fra', 77, '#ffffff', '#1d2a6b'),
  T('ogc', 'OGC Nize', 'NIC', 'fra', 76, '#111111', '#c8102e'),
  T('rcl', 'RC Lems', 'RCL', 'fra', 77, '#ffd700', '#e2001a'),
  T('srf', 'Stade Rennoix', 'REN', 'fra', 75, '#e13327', '#111111'),
  T('fcn', 'FC Nantas', 'NAN', 'fra', 73, '#fcd405', '#007a3d'),
  T('tfc', 'Toulousa FC', 'TFC', 'fra', 73, '#5b2d8e', '#ffffff'),
];

export const teamById = (id) => TEAMS.find((t) => t.id === id);
export const leagueById = (id) => LEAGUES.find((l) => l.id === id);
export const teamsOfLeague = (id) => TEAMS.filter((t) => t.league === id);

// Posiciones que puede elegir el jugador del usuario -> rol en el 4-3-3
export const POSITIONS = [
  { id: 'DC', name: 'Delantero centro', role: 'ST' },
  { id: 'EI', name: 'Extremo izquierdo', role: 'LW' },
  { id: 'ED', name: 'Extremo derecho', role: 'RW' },
  { id: 'MC', name: 'Mediocentro', role: 'CM' },
  { id: 'MCD', name: 'Mediocentro defensivo', role: 'CDM' },
  { id: 'LI', name: 'Lateral izquierdo', role: 'LB' },
  { id: 'LD', name: 'Lateral derecho', role: 'RB' },
  { id: 'DFC', name: 'Defensa central', role: 'CB' },
];

// Pesos de atributos para calcular la media según el rol
export const ROLE_WEIGHTS = {
  ST: { pac: 0.2, sho: 0.4, pas: 0.1, dri: 0.2, def: 0.0, phy: 0.1 },
  LW: { pac: 0.3, sho: 0.2, pas: 0.15, dri: 0.3, def: 0.0, phy: 0.05 },
  RW: { pac: 0.3, sho: 0.2, pas: 0.15, dri: 0.3, def: 0.0, phy: 0.05 },
  CM: { pac: 0.1, sho: 0.15, pas: 0.35, dri: 0.2, def: 0.1, phy: 0.1 },
  CDM: { pac: 0.05, sho: 0.05, pas: 0.3, dri: 0.1, def: 0.3, phy: 0.2 },
  LB: { pac: 0.3, sho: 0.0, pas: 0.2, dri: 0.1, def: 0.3, phy: 0.1 },
  RB: { pac: 0.3, sho: 0.0, pas: 0.2, dri: 0.1, def: 0.3, phy: 0.1 },
  CB: { pac: 0.1, sho: 0.0, pas: 0.1, dri: 0.0, def: 0.5, phy: 0.3 },
};

export const ATTR_NAMES = {
  pac: 'Ritmo', sho: 'Tiro', pas: 'Pase', dri: 'Regate', def: 'Defensa', phy: 'Físico',
};

export function overallFor(role, a) {
  const w = ROLE_WEIGHTS[role] || ROLE_WEIGHTS.CM;
  let s = 0;
  for (const k in w) s += a[k] * w[k];
  return Math.round(s);
}

const FIRST = ['Álex', 'Iker', 'Pablo', 'Hugo', 'Mario', 'Dani', 'Sergio', 'Raúl', 'Jorge', 'Adri', 'Marcos', 'Unai',
  'Luca', 'Marco', 'Jan', 'Leo', 'Nico', 'Theo', 'Jules', 'Kai', 'Ben', 'Tom', 'Joao', 'Rúben', 'Diego', 'Iván',
  'Óscar', 'Rodri', 'Samu', 'Bruno', 'Enzo', 'Mateo', 'Félix', 'Gavi', 'Pau', 'Aitor', 'Ander', 'Yeray', 'Lamine', 'Moussa'];
const LAST = ['García', 'Martín', 'López', 'Sánchez', 'Romero', 'Navarro', 'Torres', 'Ruiz', 'Gil', 'Vidal', 'Molina',
  'Serrano', 'Ortega', 'Castro', 'Rossi', 'Bianchi', 'Müller', 'Schmidt', 'Dubois', 'Martin', 'Smith', 'Silva',
  'Costa', 'Pereira', 'Diallo', 'Koné', 'Iglesias', 'Herrera', 'Prieto', 'Vega', 'Rubio', 'Mora', 'Blanco', 'Ramos'];

export function randomName(rng = Math.random) {
  const f = FIRST[Math.floor(rng() * FIRST.length)];
  const l = LAST[Math.floor(rng() * LAST.length)];
  return `${f[0]}. ${l}`;
}
