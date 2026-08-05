import * as THREE from 'three';

// Genera un mapa de entorno (para reflejos en pintura/cromo) a partir de una
// pequeña escena con "softboxes" de estudio, usando PMREMGenerator.
// También devuelve fondos degradados según el ambiente elegido.

const BG_STOPS = {
  studio: [0x2b3446, 0x0c1018],
  dusk:   [0x3a2a4d, 0x120a18],
  night:  [0x0a1224, 0x02040a],
  white:  [0xf2f5fa, 0xd7dde6],
};

export function makeBackground(id) {
  const [top, bottom] = BG_STOPS[id] || BG_STOPS.studio;
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const ctx = c.getContext('2d');
  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, '#' + top.toString(16).padStart(6, '0'));
  g.addColorStop(1, '#' + bottom.toString(16).padStart(6, '0'));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 8, 256);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// Color de suelo/plataforma acorde al ambiente.
export function groundColor(id) {
  return ({
    studio: 0x0e1420, dusk: 0x1a1220, night: 0x05080f, white: 0xc7cdd6,
  })[id] || 0x0e1420;
}

// Construye una escena de iluminación de estudio y la "hornea" en un envMap.
export function buildEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();

  const envScene = new THREE.Scene();
  envScene.background = new THREE.Color(0x0a0d14);

  // Cúpula tenue para dar tono ambiente.
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(40, 24, 16),
    new THREE.MeshBasicMaterial({ color: 0x1a2130, side: THREE.BackSide })
  );
  envScene.add(dome);

  // Softboxes: rectángulos emisivos que se reflejan en la carrocería.
  const soft = (w, h, color, intensity, pos, rot) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(intensity) })
    );
    m.position.set(...pos);
    if (rot) m.rotation.set(...rot);
    envScene.add(m);
  };

  soft(14, 6, 0xffffff, 4.5, [0, 12, 6], [-Math.PI / 2.2, 0, 0]);   // cenital
  soft(10, 10, 0xbfe0ff, 3.2, [-14, 6, 4], [0, Math.PI / 2, 0]);    // lateral frío
  soft(10, 10, 0xffe6c2, 2.6, [14, 6, -4], [0, -Math.PI / 2, 0]);   // lateral cálido
  soft(12, 5, 0xffffff, 2.0, [0, 5, -16], [0, 0, 0]);               // relleno trasero
  soft(16, 8, 0x223046, 1.0, [0, -6, 0], [Math.PI / 2, 0, 0]);      // rebote suelo

  const rt = pmrem.fromScene(envScene, 0, 0.1, 100);
  pmrem.dispose();
  dome.geometry.dispose();
  return rt.texture;
}
