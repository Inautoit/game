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
  maxSpeed: 83,           // m/s  (~299 km/h)
  nitroSpeed: 96,         // m/s  (~346 km/h)
  brake: 30,              // frenar tiene que ser una herramienta, no un castigo
  drag: 0.00028,
  rollResist: 3.2,
  power: 16,              // empuje del motor en seco
  powerNitro: 22,
  lateralMax: 12.5,       // m/s de desplazamiento lateral estando suelto
  // Cuánta agilidad pierdes al ir a tope. Con 0.55, a 300 por hora el coche
  // se mueve de lado a menos de la mitad que a 100: para esquivar hay que
  // levantar el pie, no basta con girar.
  agilityLoss: 0.55,
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
  overtake: 15,
  nearMiss: 60,
  nearMissDist: 2.1,      // separación lateral para "casi rozas"
  nitroPerNearMiss: 22,
  nitroPerOvertake: 5,
};

// Efectos de velocidad. Todo lo que hace que 250 km/h se noten.
export const FX = {
  startSpeed: 30,          // m/s en que empieza a notarse (~108 km/h)
  blur: 1.0,               // desenfoque radial a velocidad punta
  blurNitro: 0.6,          // extra mientras dura el nitro
  streak: 1.3,            // rayos de velocidad
  streakNitro: 0.55,
  aberration: 0.0028,
  aberrationNitro: 0.0075,
  vignetteBase: 0.10,
  vignetteSpeed: 0.34,
  vignetteNitro: 0.20,
  nitroTint: 0xb4d4ff,     // azulado al soltar el nitro
  crashTint: 0xff8a5a,
  rumble: 0.020,           // vibración de la cámara por el asfalto
  kickBack: 2.4,           // cuánto se retrasa la cámara al meter nitro
  kickFov: 8,
};

export const DRAW_DISTANCE = 900;
