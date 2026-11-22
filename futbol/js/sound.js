// Sonidos generados con WebAudio (sin archivos externos).

export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.crowd = null;
  }

  init() {
    if (this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.6;
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate * 2;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    } catch { this.ctx = null; }
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  setMuted(m) {
    this.muted = m;
    if (this.master) this.master.gain.value = m ? 0 : 0.6;
  }

  startCrowd() {
    if (!this.ctx || this.crowd) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 700; f.Q.value = 0.6;
    const g = this.ctx.createGain(); g.gain.value = 0.05;
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start();
    this.crowd = { src, g, f };
  }

  stopCrowd() {
    if (!this.crowd) return;
    try { this.crowd.src.stop(); } catch { /* ya parado */ }
    this.crowd = null;
  }

  excitement(v) {
    if (!this.crowd) return;
    const t = this.ctx.currentTime;
    this.crowd.g.gain.setTargetAtTime(0.04 + v * 0.1, t, 0.4);
  }

  kick(power = 10) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(160 + power * 4, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.09);
    g.gain.setValueAtTime(Math.min(0.5, 0.12 + power * 0.012), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 0.13);
  }

  whistle(long = false, final = false) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const n = final ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const t = t0 + i * 0.45;
      const dur = long || final ? 0.38 : 0.22;
      const o = this.ctx.createOscillator();
      const lfo = this.ctx.createOscillator();
      const lg = this.ctx.createGain();
      const g = this.ctx.createGain();
      o.frequency.value = 2900;
      lfo.frequency.value = 38; lg.gain.value = 140;
      lfo.connect(lg); lg.connect(o.frequency);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.09, t + 0.02);
      g.gain.setValueAtTime(0.09, t + dur - 0.05);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g); g.connect(this.master);
      o.start(t); lfo.start(t); o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
    }
  }

  roar(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 900; f.Q.value = 0.5;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.35 * strength, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 3.3);
  }

  ooh() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.setValueAtTime(500, t); f.frequency.linearRampToValueAtTime(250, t + 1.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.25, t + 0.2);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.4);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t); src.stop(t + 1.5);
  }
}
