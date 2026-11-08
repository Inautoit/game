// Niveles de Isla Rodante.
// Leyenda:  #  muro      .  suelo      ~  hielo (resbala)
//           S  salida    G  meta       *  gema
//           T  árbol (muro decorado)   espacio u  o  = vacío (te caes)

export const WORLDS = [
  {
    id: 'pradera',
    name: 'Pradera',
    emoji: '🌿',
    sky: ['#bfe8ff', '#ffe6f2'],
    grass: '#8fd16a', grass2: '#7cc35a', dirt: '#b9825a', rock: '#8c5f43',
    wall: '#4fa65a', wall2: '#3f9450', ice: '#cfeeff',
    levels: [
      { name: 'Primeros pasos', map: [
        '###########',
        '#S...*...*#',
        '#########.#',
        '#G..*.....#',
        '###########',
      ] },
      { name: 'La curva', map: [
        '#######',
        '#S.*..#',
        '#####.#',
        '#....*#',
        '#.#####',
        '#*...G#',
        '#######',
      ] },
      { name: 'Pasillos', map: [
        'T########',
        '#S..#..*#',
        '#.#.#.#.#',
        '#.#...#.#',
        '#*#####.#',
        '#...*..G#',
        '########T',
      ] },
      { name: 'Caracol', map: [
        '###########',
        '#S........#',
        '#########.#',
        '#*......#.#',
        '#.#####.#.#',
        '#.#G*.#.#.#',
        '#.###.#.#.#',
        '#.....#*..#',
        '###########',
      ] },
      { name: 'Zigzag', map: [
        'T#########T',
        '#S.#...#..#',
        '#..#.#.#..#',
        '#..#.#.#.*#',
        '#..#.#.#..#',
        '#....#....#',
        '#*####.####',
        '#.........#',
        '#####*###G#',
        '###########',
      ] },
      { name: 'El jardín', map: [
        '#############',
        '#S....#.....#',
        '#.###.#.###.#',
        '#.#*#...#*#.#',
        '#.#.#####.#.#',
        '#...#...#...#',
        '###.#.#.#.###',
        '#...#.#.#...#',
        '#.###.#.###.#',
        '#.....#....G#',
        '#####*#######',
      ] },
    ],
  },
  {
    id: 'desierto',
    name: 'Desierto',
    emoji: '🏜️',
    sky: ['#ffd9a8', '#ffb3a7'],
    grass: '#f2d38b', grass2: '#e8c675', dirt: '#d39b62', rock: '#a8683f',
    wall: '#c97c4f', wall2: '#b86b40', ice: '#cfeeff',
    levels: [
      { name: 'Sin barandilla', map: [
        ' ....... ',
        ' .S...*. ',
        ' ..o.o.. ',
        ' .*...G. ',
        ' ...*... ',
        ' ....... ',
      ] },
      { name: 'El puente', map: [
        '.....   .....',
        '.S.*.....*..G',
        '.....   ..*..',
      ] },
      { name: 'El cráter', map: [
        '.........',
        '.S..*....',
        '..ooooo..',
        '.*ooooo..',
        '..ooooo.G',
        '.....*...',
      ] },
      { name: 'Serpiente', map: [
        '.S.....*..',
        'oooooooo..',
        '..*.......',
        '..oooooooo',
        '.......*.G',
      ] },
      { name: 'Arenas movedizas', map: [
        '##########',
        '#S...o..*#',
        '#.o..o...#',
        '#...*o.o.#',
        '#.o......#',
        '#*..o..oG#',
        '##########',
      ] },
      { name: 'Archipiélago', map: [
        '...       ...',
        '.S.........*.',
        '...   .   ...',
        '      .      ',
        '...   .   ...',
        '.*.........G.',
        '...   *   ...',
      ] },
    ],
  },
  {
    id: 'nieve',
    name: 'Nieve',
    emoji: '❄️',
    sky: ['#d7ecff', '#efe6ff'],
    grass: '#f4f8ff', grass2: '#e6eefb', dirt: '#9fb4cf', rock: '#7d93b3',
    wall: '#9fc6e8', wall2: '#8ab6de', ice: '#bfe6ff',
    levels: [
      { name: 'Pista de hielo', map: [
        '#########',
        '#S~~~~~*#',
        '#~~~~~~~#',
        '#*~~#~~~#',
        '#~~~#~~G#',
        '#~~*#~~~#',
        '#########',
      ] },
      { name: 'Lago helado', map: [
        '...~~~~~...',
        '.S.~~*~~.G.',
        '...~~~~~...',
        ' *  ooo  * ',
      ] },
      { name: 'El foso', map: [
        '~~~~~~~~~',
        '~S~~~~~*~',
        '~~ooooo~~',
        '~*o~~~o~~',
        '~~o~G~o~~',
        '~~o~~~o*~',
        '~~oo~oo~~',
        '~~~~~~~~~',
      ] },
      { name: 'Toboganes', map: [
        '###########',
        '#S~~~~~~~*#',
        '#########~#',
        '#~~~*~~~~~#',
        '#~#########',
        '#~~~~~~~*G#',
        '###########',
      ] },
      { name: 'Copo de nieve', map: [
        ' ~~~   ~~~ ',
        '~~S~~~~~*~~',
        ' ~~~ o ~~~ ',
        '  ~ ooo ~  ',
        ' ~~~ o ~~~ ',
        '~~*~~~~~G~~',
        ' ~~~ * ~~~ ',
      ] },
      { name: 'La cumbre', map: [
        '#############',
        '#S~~~~#~~~~*#',
        '#~###~#~###~#',
        '#~#*~~~~~#~~#',
        '#~#o#####o#~#',
        '#~~~~~G~~~~~#',
        '###~#####~###',
        '#*~~~~~~~~~~#',
        '#############',
      ] },
    ],
  },
];

// ---------------------------------------------------------------------------
// Isla del día: laberinto generado a partir de la fecha (igual para todos)
// ---------------------------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function dailyNumber(date = new Date()) {
  return Math.floor((Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) - Date.UTC(2026, 10, 8)) / 864e5) + 1;
}

export function dailyLevel(n) {
  const rnd = mulberry32(n * 9973 + 7);
  const cw = 6, ch = 7;                 // celdas
  const W = cw * 2 + 1, H = ch * 2 + 1; // casillas
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const seen = Array.from({ length: ch }, () => Array(cw).fill(false));
  // Laberinto por búsqueda en profundidad
  const stack = [[0, 0]];
  seen[0][0] = true;
  g[1][1] = '.';
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [x + dx, y + dy, dx, dy])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny][nx]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nb[Math.floor(rnd() * nb.length)];
    seen[ny][nx] = true;
    g[y * 2 + 1 + dy][x * 2 + 1 + dx] = '.';
    g[ny * 2 + 1][nx * 2 + 1] = '.';
    stack.push([nx, ny]);
  }
  // Algunos atajos para que haya más de un camino
  for (let i = 0; i < 6; i++) {
    const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
    if (g[y][x] === '#' && ((x % 2 === 1 && y % 2 === 0) || (x % 2 === 0 && y % 2 === 1))) g[y][x] = '.';
  }
  // Distancias desde la salida
  const dist = bfs(g, 1, 1);
  const cells = [];
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) cells.push([x, y, dist[y][x]]);
  cells.sort((a, b) => b[2] - a[2]);
  const [gx, gy] = cells[0];
  g[1][1] = 'S';
  g[gy][gx] = 'G';
  // Gemas en callejones sin salida lejanos
  const dead = cells.filter(([x, y]) => g[y][x] === '.' && [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([dx, dy]) => g[y + dy][x + dx] !== '#').length === 1);
  const pool = (dead.length >= 3 ? dead : cells.filter(([x, y]) => g[y][x] === '.'));
  for (let i = 0; i < 3 && pool.length; i++) {
    const k = Math.floor(rnd() * Math.min(pool.length, 8));
    const [x, y] = pool.splice(k, 1)[0];
    g[y][x] = '*';
  }
  // Árboles en las esquinas
  g[0][0] = 'T'; g[H - 1][W - 1] = 'T';
  const world = WORLDS[n % WORLDS.length];
  // En el mundo de nieve, el suelo es hielo
  if (world.id === 'nieve') for (const row of g) for (let x = 0; x < W; x++) if (row[x] === '.') row[x] = '~';
  return { name: `Isla del día #${n}`, map: g.map((r) => r.join('')), world };
}

export function bfs(g, sx, sy) {
  const H = g.length, W = g[0].length;
  const d = Array.from({ length: H }, () => Array(W).fill(Infinity));
  d[sy][sx] = 0;
  const q = [[sx, sy]];
  while (q.length) {
    const [x, y] = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
      const c = g[ny][nx];
      if (!c || c === '#' || c === 'T' || c === ' ' || c === 'o') continue;
      if (d[ny][nx] <= d[y][x] + 1) continue;
      d[ny][nx] = d[y][x] + 1;
      q.push([nx, ny]);
    }
  }
  return d;
}

// Normaliza un mapa (filas del mismo ancho) y calcula el tiempo para la 3.ª estrella
export function prepare(level) {
  const w = Math.max(...level.map.map((r) => r.length));
  const map = level.map.map((r) => r.padEnd(w, ' '));
  let sx = 0, sy = 0, gx = 0, gy = 0;
  const gems = [];
  map.forEach((r, y) => [...r].forEach((c, x) => {
    if (c === 'S') { sx = x; sy = y; }
    if (c === 'G') { gx = x; gy = y; }
    if (c === '*') gems.push([x, y]);
  }));
  const d = bfs(map.map((r) => [...r]), sx, sy);
  // Ruta aproximada recogiendo todas las gemas
  let len = 0, cx = sx, cy = sy;
  const left = gems.slice();
  while (left.length) {
    const dd = bfs(map.map((r) => [...r]), cx, cy);
    left.sort((a, b) => dd[a[1]][a[0]] - dd[b[1]][b[0]]);
    const [nx, ny] = left.shift();
    len += dd[ny][nx];
    cx = nx; cy = ny;
  }
  len += bfs(map.map((r) => [...r]), cx, cy)[gy][gx];
  return { ...level, map, w, h: map.length, start: [sx, sy], goal: [gx, gy], gems, reachable: Number.isFinite(d[gy][gx]), par: Math.round(4 + len * 0.55) };
}

// ---------------------------------------------------------------------------
// Validación de mapas (editor y servidor usan las mismas reglas)
// ---------------------------------------------------------------------------
export const MAP_LIMITS = { minW: 4, maxW: 16, minH: 4, maxH: 18, maxGems: 5 };
const WALKABLE = (c) => c === '.' || c === '~' || c === 'S' || c === 'G' || c === '*';

export function validateMap(rows) {
  const errs = [];
  if (!Array.isArray(rows) || !rows.length) return ['El mapa está vacío'];
  const h = rows.length, w = Math.max(...rows.map((r) => r.length));
  if (w < MAP_LIMITS.minW || h < MAP_LIMITS.minH) errs.push(`Tamaño mínimo ${MAP_LIMITS.minW}×${MAP_LIMITS.minH}`);
  if (w > MAP_LIMITS.maxW || h > MAP_LIMITS.maxH) errs.push(`Tamaño máximo ${MAP_LIMITS.maxW}×${MAP_LIMITS.maxH}`);
  const g = rows.map((r) => [...r.padEnd(w, ' ')]);
  let S = null, G = null, gems = [];
  g.forEach((r, y) => r.forEach((c, x) => {
    if (!'#.~SGT* o'.includes(c)) errs.push('Hay casillas no válidas');
    if (c === 'S') S = S ? 'dup' : [x, y];
    if (c === 'G') G = G ? 'dup' : [x, y];
    if (c === '*') gems.push([x, y]);
  }));
  if (!S) errs.push('Falta la salida');
  if (!G) errs.push('Falta la meta');
  if (S === 'dup') errs.push('Solo puede haber una salida');
  if (G === 'dup') errs.push('Solo puede haber una meta');
  if (gems.length > MAP_LIMITS.maxGems) errs.push(`Máximo ${MAP_LIMITS.maxGems} gemas`);
  if (errs.length) return [...new Set(errs)];
  const d = bfs(g, S[0], S[1]);
  if (!Number.isFinite(d[G[1]][G[0]])) errs.push('No se puede llegar a la meta desde la salida');
  if (gems.some(([x, y]) => !Number.isFinite(d[y][x]))) errs.push('Hay gemas a las que no se puede llegar');
  return errs;
}

// Dificultad estimada de 1 a 5
export function estimateDifficulty(rows) {
  const lv = prepare({ map: rows });
  let edge = 0, ice = 0;
  lv.map.forEach((r, y) => [...r].forEach((c, x) => {
    if (!WALKABLE(c)) return;
    if (c === '~') ice++;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = (lv.map[y + dy] || '')[x + dx];
      if (!n || n === ' ' || n === 'o') { edge++; break; }
    }
  }));
  const score = (lv.par - 12) / 22 + edge / 26 + ice / 45;
  return clampInt(1 + Math.round(score), 1, 5);
}
const clampInt = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------------------
// Modo infinito: islas generadas cada vez más difíciles
// ---------------------------------------------------------------------------
export function infiniteLevel(n, runSeed) {
  const rnd = mulberry32(runSeed * 7919 + n * 104729);
  const cw = Math.min(3 + Math.floor(n / 4), 7);
  const ch = Math.min(3 + Math.floor(n / 3), 8);
  const W = cw * 2 + 1, H = ch * 2 + 1;
  const g = Array.from({ length: H }, () => Array(W).fill('#'));
  const seen = Array.from({ length: ch }, () => Array(cw).fill(false));
  const stack = [[0, 0]];
  seen[0][0] = true;
  g[1][1] = '.';
  while (stack.length) {
    const [x, y] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]]
      .map(([dx, dy]) => [x + dx, y + dy, dx, dy])
      .filter(([nx, ny]) => nx >= 0 && ny >= 0 && nx < cw && ny < ch && !seen[ny][nx]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny, dx, dy] = nb[Math.floor(rnd() * nb.length)];
    seen[ny][nx] = true;
    g[y * 2 + 1 + dy][x * 2 + 1 + dx] = '.';
    g[ny * 2 + 1][nx * 2 + 1] = '.';
    stack.push([nx, ny]);
  }
  // Atajos
  for (let i = 0; i < 2 + cw; i++) {
    const x = 1 + Math.floor(rnd() * (W - 2)), y = 1 + Math.floor(rnd() * (H - 2));
    if (g[y][x] === '#' && (x + y) % 2 === 1) g[y][x] = '.';
  }
  // Salida, meta y gemas
  const dist = bfs(g, 1, 1);
  const cells = [];
  for (let y = 1; y < H; y += 2) for (let x = 1; x < W; x += 2) cells.push([x, y, dist[y][x]]);
  cells.sort((a, b) => b[2] - a[2]);
  g[1][1] = 'S';
  g[cells[0][1]][cells[0][0]] = 'G';
  const free = cells.filter(([x, y]) => g[y][x] === '.');
  for (let i = 0; i < 3 && free.length; i++) {
    const k = Math.floor(rnd() * free.length);
    const [x, y] = free.splice(k, 1)[0];
    g[y][x] = '*';
  }
  // Peligros según el nivel
  const pit = n >= 4 ? Math.min(0.35, 0.06 * (n - 3)) : 0;   // agujeros dentro
  const edge = n >= 7 ? Math.min(0.7, 0.08 * (n - 6)) : 0;   // bordes sin muro
  const ice = n >= 10 ? Math.min(0.6, 0.07 * (n - 9)) : 0;   // hielo
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (g[y][x] !== '#') continue;
      const border = x === 0 || y === 0 || x === W - 1 || y === H - 1;
      if (border ? rnd() < edge : rnd() < pit) g[y][x] = border ? ' ' : 'o';
    }
  }
  if (ice) {
    const seeds = Math.max(1, Math.round(ice * 6));
    for (let s = 0; s < seeds; s++) {
      let [x, y] = cells[Math.floor(rnd() * cells.length)];
      for (let k = 0; k < 10; k++) {
        if (g[y][x] === '.') g[y][x] = '~';
        const [dx, dy] = [[1, 0], [-1, 0], [0, 1], [0, -1]][Math.floor(rnd() * 4)];
        const nx = x + dx, ny = y + dy;
        if (WALKABLE((g[ny] || [])[nx])) { x = nx; y = ny; }
      }
    }
  }
  // Árboles decorativos en algunos muros
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === '#' && rnd() < 0.06) g[y][x] = 'T';
  const world = WORLDS[Math.floor((n - 1) / 5) % WORLDS.length];
  return { name: `Isla ${n}`, map: g.map((r) => r.join('')), world };
}

// ---------------------------------------------------------------------------
// Mapas del equipo para estrenar la sección de Comunidad (se suben una vez)
// ---------------------------------------------------------------------------
export const TEAM_MAPS = [
  { name: 'La escalera rota', world: 'desierto', map: [
    '.S..       ',
    '...o.      ',
    ' o....*    ',
    '   o...    ',
    '    ....o  ',
    '    *o...  ',
    '      o....',
    '       .*.G',
  ] },
  { name: 'Espiral helada', world: 'nieve', map: [
    '#############',
    '#S~~~~~~~~~~#',
    '#o#########~#',
    '#~#*~~~~~~#~#',
    '#~#~#####~#~#',
    '#~#~#G~*#~#~#',
    '#~#~###~#~#~#',
    '#~#~~~~~#~#~#',
    '#~#######~o~#',
    '#~~~~*~~~~~~#',
    '#############',
  ] },
  { name: 'Hilo de seda', world: 'pradera', map: [
    '...           ',
    '.S...........*',
    '...         ..',
    '            . ',
    '  *.......... ',
    '  .           ',
    '  ...........G',
    '            *.',
  ] },
  { name: 'Campo de minas', world: 'desierto', map: [
    '###########',
    '#S..o...o*#',
    '#.o.o.o.o.#',
    '#.o...o...#',
    '#.ooo.ooo.#',
    '#*..o...o.#',
    '#.o.o.o.o.#',
    '#...o.*.oG#',
    '###########',
  ] },
  { name: 'Patinaje artístico', world: 'nieve', map: [
    ' ~~~~~~~~~ ',
    '~~S~~o~~~*~',
    '~~~~ooo~~~~',
    '~o~~~o~~~o~',
    '~~~~~~~~~~~',
    '~*~o~~~o~~~',
    '~~ooo~ooo~~',
    '~~~o~*~o~G~',
    ' ~~~~~~~~~ ',
  ] },
  { name: 'Laberinto sin paredes', world: 'pradera', map: [
    'S..oG.*....',
    'oo.ooooooo.',
    '.o...o*....',
    '.o.o.o.oooo',
    '.....o..*..',
    '.ooooooo.o.',
    '...o.......',
    'oo.o.ooooo.',
    '...o.o...o.',
    '.ooo.o.o.o.',
    '...o...o.o.',
    'oo.ooooo.o.',
    '...........',
  ] },
  { name: 'Las cuatro esquinas', world: 'pradera', map: [
    '....     ....',
    '.S..     .*..',
    '.............',
    '..   .~.   ..',
    '     ~~~     ',
    '..   .~.   ..',
    '.............',
    '.*..     ..G.',
    '....     .*..',
  ] },
  { name: 'Cumbre final', world: 'nieve', map: [
    'T###########T',
    '#S.o~~~~~o.*#',
    '#..~~###~~..#',
    '#oo~~#G#~~oo#',
    '#~~~~#.#~~~~#',
    '#~##o#.#o##~#',
    '#~~~~~.~~~~~#',
    '#o~*~ooo~~~o#',
    '#~~~~~~~~~*~#',
    'T###########T',
  ] },
];
