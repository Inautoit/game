import * as THREE from 'three';

// Mapa de entorno procedural. Sin él, la pintura metalizada del Urus se ve
// negra: el PBR necesita algo que reflejar. Lo generamos en un canvas y lo
// pasamos por PMREM, así no hay que descargar ningún HDRI.
export function makeEnvironment(renderer, time) {
  const cv = document.createElement('canvas');
  cv.width = 512; cv.height = 256;
  const ctx = cv.getContext('2d');

  const sky = '#' + time.sky.toString(16).padStart(6, '0');
  const ground = '#' + time.ground.toString(16).padStart(6, '0');
  const horizon = '#' + time.fog.toString(16).padStart(6, '0');

  const g = ctx.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0, time.id === 'night' ? '#0a1020' : shade(sky, 1.25));
  g.addColorStop(0.42, sky);
  g.addColorStop(0.52, horizon);
  g.addColorStop(0.56, shade(ground, 0.9));
  g.addColorStop(1, shade(ground, 0.55));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 512, 256);

  // Sol / luna: un punto brillante da los reflejos característicos de la chapa.
  const sx = 150, sy = time.id === 'dusk' ? 118 : 58;
  const sun = ctx.createRadialGradient(sx, sy, 2, sx, sy, time.id === 'night' ? 26 : 54);
  sun.addColorStop(0, time.id === 'night' ? 'rgba(200,220,255,0.9)' : 'rgba(255,250,232,1)');
  sun.addColorStop(1, 'rgba(255,250,232,0)');
  ctx.fillStyle = sun;
  ctx.fillRect(sx - 60, sy - 60, 120, 120);

  // Siluetas de edificios en el horizonte: rompen el reflejo plano.
  ctx.fillStyle = time.id === 'night' ? 'rgba(8,12,24,0.95)' : 'rgba(0,0,0,0.28)';
  let x = 0;
  while (x < 512) {
    const w = 12 + Math.random() * 34;
    const h = 8 + Math.random() * 34;
    ctx.fillRect(x, 132 - h, w, h + 4);
    x += w + 3 + Math.random() * 10;
  }

  const tex = new THREE.CanvasTexture(cv);
  tex.mapping = THREE.EquirectangularReflectionMapping;
  tex.colorSpace = THREE.SRGBColorSpace;

  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileEquirectangularShader();
  const rt = pmrem.fromEquirectangular(tex);
  tex.dispose();
  pmrem.dispose();
  return rt;
}

function shade(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255]
    .map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
  return `rgb(${c[0]},${c[1]},${c[2]})`;
}
