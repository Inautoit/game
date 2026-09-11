import * as THREE from 'three';

// Post-proceso de una sola pasada: desenfoque radial + aberración cromática
// + viñeta + tinte. Es lo que hace que 250 km/h se *sientan* como 250 km/h.
//
// A propósito NO usa EffectComposer: una cadena de pasadas en un móvil cuesta
// varios render targets. Aquí hay uno solo y el shader hace todo de golpe.
//
// Ojo: al pintar a un render target, three no aplica ni tone mapping ni
// conversión a sRGB (los deja para el destino final), así que el target es
// half-float para no perder rango y el shader cierra con los dos includes.

const VERT = /* glsl */`
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const COMMON = /* glsl */`
uniform sampler2D tDiffuse;
uniform float uVignette;
uniform vec3 uTint;
uniform float uTintAmount;
varying vec2 vUv;
`;

// Modo tranquilo: una sola muestra. Se usa por debajo del umbral de velocidad
// para que el cambio a modo rápido no dé un salto de nitidez.
const FRAG_CALM = COMMON + /* glsl */`
void main() {
  float d = length(0.5 - vUv);
  vec3 color = texture2D(tDiffuse, vUv).rgb;
  color = mix(color, color * uTint, uTintAmount);
  color *= 1.0 - uVignette * smoothstep(0.22, 0.78, d);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

// Modo rápido: 5 muestras hacia el centro. Los canales rojo y azul se
// desplazan un pelo más y menos -> aberración cromática, gratis.
const FRAG_SPEED = COMMON + /* glsl */`
uniform float uBlur;
uniform float uAberration;
uniform float uStreak;
uniform float uTime;

float hash1(float n) { return fract(sin(n) * 43758.5453123); }

void main() {
  vec2 toCenter = 0.5 - vUv;
  float d = length(toCenter);

  // Zona protegida: una elipse algo por debajo del centro, que es justo donde
  // está el coche. Ahí no hay ni desenfoque ni rayos, así que sigue nítido y
  // el efecto se lee como velocidad y no como "se ha roto el render".
  vec2 m = vUv - vec2(0.5, 0.32);
  m.y *= 0.75;
  float mask = smoothstep(0.16, 0.58, length(m));

  float amt = uBlur * mask * 0.22;
  float ca = uAberration * mask;

  vec3 sum = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < 5; i++) {
    float t = float(i) / 4.0;
    float w = 1.0 - 0.45 * t;
    sum.r += texture2D(tDiffuse, vUv + toCenter * (t * amt + ca)).r * w;
    sum.g += texture2D(tDiffuse, vUv + toCenter * (t * amt)).g * w;
    sum.b += texture2D(tDiffuse, vUv + toCenter * (t * amt - ca)).b * w;
    total += w;
  }

  vec3 color = sum / total;

  // Rayos de velocidad. El desenfoque radial no se ve sobre un cielo liso;
  // esto sí. Son bandas que salen del centro y se van hacia los bordes.
  if (uStreak > 0.001) {
    float ang = atan(toCenter.y, toCenter.x);
    float cell = ang * 0.1591549 * 44.0;         // 44 sectores en toda la vuelta
    float h = hash1(floor(cell) * 1.37);
    // Cada rayo sale del centro con su propia fase y velocidad.
    float head = fract(h * 3.1 + uTime * (0.8 + h * 1.6)) * 0.55 + 0.08;
    float band = smoothstep(head - 0.30, head - 0.03, d) * (1.0 - smoothstep(head, head + 0.05, d));
    float across = abs(fract(cell) - 0.5) * 2.0;
    float thin = 1.0 - smoothstep(0.0, 0.45, across);
    // Mezclamos hacia blanco en vez de sumar: sumar sobre un cielo ya claro
    // se lo come el tone mapping y los rayos no se ven.
    float s = step(0.66, h) * band * thin * mask * uStreak;
    color = mix(color, vec3(1.12, 1.15, 1.25), clamp(s, 0.0, 0.92));
  }

  color = mix(color, color * uTint, uTintAmount * mask);
  color *= 1.0 - uVignette * smoothstep(0.22, 0.78, d);
  gl_FragColor = vec4(color, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`;

export class PostFX {
  constructor(renderer) {
    this.renderer = renderer;
    this.enabled = true;

    // Sin half-float renderizable no podemos guardar la escena en lineal sin
    // bandeado; en ese caso se pinta directo a pantalla y no pasa nada.
    this.available = renderer.extensions.has('EXT_color_buffer_half_float')
      || renderer.extensions.has('EXT_color_buffer_float');
    if (!this.available) return;

    const size = renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target = new THREE.WebGLRenderTarget(size.x, size.y, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      type: THREE.HalfFloatType,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.uniforms = {
      tDiffuse: { value: this.target.texture },
      uBlur: { value: 0 },
      uAberration: { value: 0 },
      uStreak: { value: 0 },
      uTime: { value: 0 },
      uVignette: { value: 0 },
      uTint: { value: new THREE.Color(1, 1, 1) },
      uTintAmount: { value: 0 },
    };

    const make = (fragmentShader) => new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: VERT,
      fragmentShader,
      depthTest: false,
      depthWrite: false,
    });
    this.matCalm = make(FRAG_CALM);
    this.matSpeed = make(FRAG_SPEED);

    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.matCalm);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    this.camera = new THREE.Camera();
  }

  get active() { return this.available && this.enabled; }

  setSize() {
    if (!this.available) return;
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.target.setSize(size.x, size.y);
  }

  // fx: { blur, aberration, streak, vignette, tint (THREE.Color), tintAmount }
  render(scene, camera, fx, dt = 0) {
    const u = this.uniforms;
    u.uBlur.value = fx.blur;
    u.uAberration.value = fx.aberration;
    u.uStreak.value = fx.streak;
    u.uTime.value += dt;
    u.uVignette.value = fx.vignette;
    u.uTintAmount.value = fx.tintAmount;
    u.uTint.value.copy(fx.tint);

    this.quad.material = fx.blur > 0.02 ? this.matSpeed : this.matCalm;

    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    if (!this.available) return;
    this.target.dispose();
    this.matCalm.dispose();
    this.matSpeed.dispose();
    this.quad.geometry.dispose();
  }
}
