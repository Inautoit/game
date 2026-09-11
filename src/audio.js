// Sonido sintetizado con WebAudio: motor, derrape, choque y avisos.
// Sin ficheros de audio -> nada que descargar y funciona offline.
export class Sound {
  constructor() {
    this.ctx = null;
    this.enabled = load('sound', true);
    this.started = false;
  }

  // Los navegadores exigen que el audio arranque tras un gesto del usuario.
  start() {
    if (this.started || !this.enabled) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.started = true;

    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(ctx.destination);

    // Motor: dos dientes de sierra desafinados + filtro paso bajo.
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineFilter = ctx.createBiquadFilter();
    this.engineFilter.type = 'lowpass';
    this.engineFilter.frequency.value = 900;
    this.engineFilter.Q.value = 3;
    this.engineGain.connect(this.engineFilter);
    this.engineFilter.connect(this.master);

    this.oscs = [0, 1].map((i) => {
      const o = ctx.createOscillator();
      o.type = i ? 'square' : 'sawtooth';
      o.frequency.value = 60;
      const g = ctx.createGain();
      g.gain.value = i ? 0.22 : 0.5;
      o.connect(g); g.connect(this.engineGain);
      o.start();
      return o;
    });

    // Ruido de rodadura / viento
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    this.noise = ctx.createBufferSource();
    this.noise.buffer = buf;
    this.noise.loop = true;
    this.noiseFilter = ctx.createBiquadFilter();
    this.noiseFilter.type = 'bandpass';
    this.noiseFilter.frequency.value = 700;
    this.noiseGain = ctx.createGain();
    this.noiseGain.gain.value = 0;
    this.noise.connect(this.noiseFilter);
    this.noiseFilter.connect(this.noiseGain);
    this.noiseGain.connect(this.master);
    this.noise.start();
  }

  setEnabled(v) {
    this.enabled = !!v;
    save('sound', this.enabled);
    if (!this.enabled && this.master) this.master.gain.value = 0;
    if (this.enabled) { this.start(); this.resume(); }
  }

  resume() { if (this.ctx?.state === 'suspended') this.ctx.resume(); }

  setActive(on) {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.linearRampToValueAtTime(on && this.enabled ? 0.5 : 0, t + 0.25);
  }

  // ratio 0..1 de revoluciones, throttle 0..1
  engine(ratio, throttle, nitro) {
    if (!this.ctx || !this.enabled) return;
    const rpm = 55 + ratio * 420 + (nitro ? 90 : 0);
    const t = this.ctx.currentTime;
    for (let i = 0; i < this.oscs.length; i++) {
      this.oscs[i].frequency.setTargetAtTime(rpm * (i ? 1.51 : 1) , t, 0.06);
    }
    this.engineFilter.frequency.setTargetAtTime(500 + ratio * 2600 + throttle * 500, t, 0.08);
    this.engineGain.gain.setTargetAtTime(0.16 + throttle * 0.12 + ratio * 0.1, t, 0.1);
    this.noiseFilter.frequency.setTargetAtTime(400 + ratio * 2200, t, 0.1);
    this.noiseGain.gain.setTargetAtTime(0.015 + ratio * 0.07, t, 0.1);
  }

  blip(freq = 880, dur = 0.09, type = 'triangle', vol = 0.22) {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.frequency.exponentialRampToValueAtTime(freq * 1.6, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  nearMiss() { this.blip(1250, 0.08, 'triangle', 0.18); }
  overtake() { this.blip(700, 0.06, 'sine', 0.12); }
  nitro() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(180, t);
    o.frequency.exponentialRampToValueAtTime(1400, t + 0.4);
    g.gain.setValueAtTime(0.2, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.55);
  }

  crash() {
    if (!this.ctx || !this.enabled) return;
    const t = this.ctx.currentTime;
    const len = this.ctx.sampleRate * 0.7;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.2);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2600, t);
    f.frequency.exponentialRampToValueAtTime(160, t + 0.6);
    const g = this.ctx.createGain();
    g.gain.value = 0.75;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
  }
}

function load(key, def) {
  try {
    const v = localStorage.getItem('urus:' + key);
    return v === null ? def : JSON.parse(v);
  } catch { return def; }
}
function save(key, value) {
  try { localStorage.setItem('urus:' + key, JSON.stringify(value)); } catch { /* ignorar */ }
}
