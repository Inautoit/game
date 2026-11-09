// Música del menú, sintetizada en directo con Web Audio (nada que descargar).
// Electrónica de carreras a 116 BPM en La menor: bombo, palmas, charles, bajo en corcheas,
// colchón de acordes y un arpegio con eco. 32 compases: entrada, cuerpo y subida.
const BPM = 116;
const BEAT = 60 / BPM, SIX = BEAT / 4;            // negra y semicorchea (s)
const BAR = BEAT * 4;
// Progresión (raíces en MIDI): Am · F · C · G, dos compases cada acorde en el cuerpo
const PROG = [
  { root: 45, chord: [57, 60, 64] },   // La menor
  { root: 41, chord: [57, 60, 65] },   // Fa
  { root: 48, chord: [55, 60, 64] },   // Do
  { root: 43, chord: [55, 59, 62] },   // Sol
];
const hz = (m) => 440 * Math.pow(2, (m - 69) / 12);

export function createMusic(ctx, dest) {
  const out = ctx.createGain();
  out.gain.value = 0;
  out.connect(dest);
  // Compresor suave para que todo empaste
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = 0.01; comp.release.value = 0.2;
  comp.connect(out);
  const bus = ctx.createGain(); bus.gain.value = 0.9; bus.connect(comp);
  // «Bombeo» del colchón y el bajo con el bombo (sidechain)
  const duck = ctx.createGain(); duck.connect(bus);
  // Eco para el arpegio
  const delay = ctx.createDelay(1); delay.delayTime.value = SIX * 3;
  const fb = ctx.createGain(); fb.gain.value = 0.32;
  const dlf = ctx.createBiquadFilter(); dlf.type = 'lowpass'; dlf.frequency.value = 2600;
  delay.connect(dlf); dlf.connect(fb); fb.connect(delay); dlf.connect(bus);
  // Ruido blanco para la batería
  const nbuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = nbuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;

  function kick(t) {
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
    g.gain.setValueAtTime(0.95, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.38);
    o.connect(g); g.connect(bus); o.start(t); o.stop(t + 0.4);
    duck.gain.setValueAtTime(0.35, t); duck.gain.linearRampToValueAtTime(1, t + BEAT * 0.6);
  }
  function noise(t, dur, type, freq, q, vol) {
    const s = ctx.createBufferSource(); s.buffer = nbuf;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(bus);
    s.start(t, Math.random() * 0.5); s.stop(t + dur + 0.02);
  }
  const clap = (t) => { noise(t, 0.18, 'bandpass', 1500, 0.9, 0.5); noise(t + 0.012, 0.12, 'bandpass', 2200, 1.2, 0.25); };
  const hat = (t, open) => noise(t, open ? 0.22 : 0.045, 'highpass', 8000, 0.7, open ? 0.12 : 0.09);
  function bass(t, m, dur) {
    const o = ctx.createOscillator(), o2 = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'sawtooth'; o2.type = 'square'; o.frequency.value = hz(m); o2.frequency.value = hz(m - 12);
    f.type = 'lowpass'; f.Q.value = 6; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(180, t + dur);
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.32, t + 0.008); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(f); o2.connect(f); f.connect(g); g.connect(duck);
    o.start(t); o2.start(t); o.stop(t + dur + 0.02); o2.stop(t + dur + 0.02);
  }
  function pad(t, notes, dur, bright) {
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 1; f.frequency.setValueAtTime(bright, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.07, t + 0.35); g.gain.setValueAtTime(0.07, t + dur - 0.3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
    f.connect(g); g.connect(duck);
    for (const m of notes) for (const det of [-9, 8]) {
      const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz(m); o.detune.value = det;
      o.connect(f); o.start(t); o.stop(t + dur + 0.05);
    }
  }
  function arp(t, m, cutoff) {
    const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = 'square'; o.frequency.value = hz(m);
    f.type = 'lowpass'; f.frequency.value = cutoff; f.Q.value = 4;
    g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.005); g.gain.exponentialRampToValueAtTime(0.001, t + SIX * 0.9);
    o.connect(f); f.connect(g); g.connect(bus); g.connect(delay);
    o.start(t); o.stop(t + SIX);
  }

  // Programa un compás entero
  function scheduleBar(bar, t0) {
    const sec = bar % 32;
    const intro = sec < 4, build = sec >= 28, full = !intro;
    const ch = PROG[Math.floor(sec / 2) % 4];
    if (sec % 2 === 0) pad(t0, ch.chord, BAR * 2, intro ? 700 : 1400 + (sec % 8) * 120);
    for (let s = 0; s < 16; s++) {
      const t = t0 + s * SIX;
      if (full && s % 4 === 0) kick(t);
      if (build && sec >= 30 && s % 2 === 0) kick(t);          // redoble de bombo antes de volver a empezar
      if (full && (s === 4 || s === 12)) clap(t);
      if (s % 2 === 0) hat(t, false); else if (s % 4 === 2 && full) hat(t, true);
      if (s % 4 === 2 && !intro) hat(t + SIX * 0.5, false);
      if (full && s % 2 === 0) bass(t, ch.root + (s % 8 === 6 ? 12 : 0), SIX * 1.8);
      if (sec >= 8) {
        const seq = [0, 1, 2, 1, 0, 2, 1, 2];
        const m = ch.chord[seq[s % 8]] + (s >= 8 ? 12 : 0);
        arp(t, m, 1200 + ((sec - 8) % 8) * 350 + (build ? 1500 : 0));
      }
    }
  }

  let playing = false, nextBar = 0, nextT = 0, timer = null;
  function pump() {
    while (nextT < ctx.currentTime + 0.25) { scheduleBar(nextBar++, nextT); nextT += BAR; }
  }
  return {
    get playing() { return playing; },
    // Para pruebas y grabaciones (OfflineAudioContext): programa de golpe los primeros «sec» segundos
    renderAll(sec) { out.gain.value = 0.55; let t = 0.05, b = 0; while (t < sec) { scheduleBar(b++, t); t += BAR; } },
    play() {
      if (playing) return;
      playing = true;
      nextBar = 0; nextT = ctx.currentTime + 0.08;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0.55, ctx.currentTime + 1.5);
      pump();
      timer = setInterval(pump, 60);
    },
    stop(fade = 0.8) {
      if (!playing) return;
      playing = false;
      out.gain.cancelScheduledValues(ctx.currentTime);
      out.gain.setValueAtTime(out.gain.value, ctx.currentTime);
      out.gain.linearRampToValueAtTime(0, ctx.currentTime + fade);
      clearInterval(timer); timer = null;
    },
  };
}
