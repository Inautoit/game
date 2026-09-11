// Parámetros globales del juego. Tocar aquí para ajustar la dificultad.

export const LANE_W = 3.6;      // ancho de carril (m)
export const SHOULDER = 1.2;    // arcén (m)

// Nota de ejes: el coche avanza hacia +Z y la cámara mira hacia +Z.
// Eso hace que la DERECHA de la pantalla sea -X. Conducimos por la derecha,
// así que nuestros carriles tienen x negativa.
const lane = (x, dir) => ({ x, dir });

export const MODES = {
  oneway: {
    id: 'oneway',
    name: 'Una dirección',
    desc: 'Todo el tráfico va en tu sentido. Ideal para empezar.',
    lanes: [lane(5.4, 1), lane(1.8, 1), lane(-1.8, 1), lane(-5.4, 1)],
    startLane: 2,
    scoreMult: 1,
  },
  twoway: {
    id: 'twoway',
    name: 'Dos direcciones',
    desc: 'Tráfico de frente. Adelantar de cerca puntúa doble.',
    lanes: [lane(9, -1), lane(5.4, -1), lane(1.8, -1), lane(-1.8, 1), lane(-5.4, 1), lane(-9, 1)],
    startLane: 4,
    scoreMult: 1.8,
  },
};

export function roadHalfWidth(mode) {
  const max = Math.max(...mode.lanes.map((l) => Math.abs(l.x)));
  return max + LANE_W / 2 + SHOULDER;
}

// Momentos del día. Cada uno cambia cielo, niebla y luces.
export const TIMES = {
  day: {
    id: 'day', name: 'Día',
    sky: 0x93c6ef, fog: 0x9fcbe8, fogNear: 40, fogFar: 260,
    hemiSky: 0xcfe8ff, hemiGround: 0x6d7a62, hemiInt: 2.4,
    sunColor: 0xfff4dd, sunInt: 1.6, ground: 0x3f6b3a, road: '#3a3d44',
    headlights: false,
  },
  dusk: {
    id: 'dusk', name: 'Atardecer',
    sky: 0xff9a62, fog: 0xf08a5d, fogNear: 30, fogFar: 210,
    hemiSky: 0xffc79a, hemiGround: 0x4a3d36, hemiInt: 1.7,
    sunColor: 0xffb070, sunInt: 1.5, ground: 0x4a4830, road: '#33353c',
    headlights: true,
  },
  night: {
    id: 'night', name: 'Noche',
    sky: 0x070b18, fog: 0x080c1a, fogNear: 20, fogFar: 150,
    hemiSky: 0x33456d, hemiGround: 0x161a25, hemiInt: 1.45,
    sunColor: 0x8fa5d6, sunInt: 0.55, ground: 0x14261a, road: '#24262b',
    headlights: true,
  },
};

// Coche del jugador
export const PLAYER = {
  length: 5.0,            // m (se escala el modelo a esta longitud)
  halfWidth: 1.02,
  halfLength: 2.5,
  maxSpeed: 72,           // m/s  (~259 km/h)
  nitroSpeed: 90,         // m/s  (~324 km/h)
  reverseSpeed: 6,
  brake: 26,
  drag: 0.0009,
  rollResist: 3.2,
  lateralMax: 11,         // m/s de desplazamiento lateral a tope
  lateralAccel: 34,
  nitroMax: 100,
};

// Tráfico
export const TRAFFIC = {
  maxActive: 18,
  spawnAhead: 330,
  despawnBehind: 70,
  despawnAhead: 480,
  minGap: 26,             // hueco mínimo entre coches del mismo carril
  laneChangeChance: 0.25,
};

export const SCORE = {
  perMeter: 0.55,
  fastBonusSpeed: 30,     // m/s a partir del cual puntúa doble
  overtake: 15,
  nearMiss: 60,
  nearMissDist: 2.1,      // separación lateral para "casi rozas"
  nitroPerNearMiss: 22,
  nitroPerOvertake: 5,
};

export const DRAW_DISTANCE = 900;
