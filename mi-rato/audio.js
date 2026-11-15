// Voz (síntesis del navegador) y música (Web Audio). Sin archivos externos.

export const Cancelled = Symbol('cancelled');

let ctx = null, master = null, voice = null, silentEl = null;

/** WAV de 1 s de silencio, generado aquí mismo (sin archivos). */
function silentWav() {
  const rate = 8000, n = rate, buf = new DataView(new ArrayBuffer(44 + n));
  const w = (o, s) => [...s].forEach((c, i) => buf.setUint8(o + i, c.charCodeAt(0)));
  w(0, 'RIFF'); buf.setUint32(4, 36 + n, true); w(8, 'WAVEfmt '); buf.setUint32(16, 16, true);
  buf.setUint16(20, 1, true); buf.setUint16(22, 1, true); buf.setUint32(24, rate, true); buf.setUint32(28, rate, true);
  buf.setUint16(32, 1, true); buf.setUint16(34, 8, true); w(36, 'data'); buf.setUint32(40, n, true);
  for (let i = 0; i < n; i++) buf.setUint8(44 + i, 128);
  let bin = ''; new Uint8Array(buf.buffer).forEach(b => bin += String.fromCharCode(b));
  return 'data:audio/wav;base64,' + btoa(bin);
}

/** Habla directamente (para usar dentro de un toque: así el móvil da permiso a la voz). */
export function sayNow(text) {
  if (!('speechSynthesis' in window)) return false;
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'es-ES'; if (voice) u.voice = voice; u.rate = 0.9;
  speechSynthesis.resume(); speechSynthesis.speak(u);
  return true;
}
export const state = { muted: false };

export function initAudio() {
  try {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain();
      master.gain.value = 0.5;
      // Pequeño eco para que suene más cálido
      const delay = ctx.createDelay(); delay.delayTime.value = 0.22;
      const fb = ctx.createGain(); fb.gain.value = 0.25;
      master.connect(ctx.destination);
      master.connect(delay); delay.connect(fb); fb.connect(delay); fb.connect(ctx.destination);
    }
    ctx.resume();
    // Un "clic" inaudible dentro del toque desbloquea Web Audio en iPhone
    const b = ctx.createBuffer(1, 1, 22050), src = ctx.createBufferSource();
    src.buffer = b; src.connect(ctx.destination); src.start(0);
  } catch { /* sin audio */ }
  // iPhone: que suene aunque el interruptor de silencio esté puesto
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch {}
  try {
    if (!silentEl) {
      silentEl = new Audio(silentWav());
      silentEl.loop = true; silentEl.setAttribute('playsinline', '');
    }
    silentEl.play().catch(() => {});
  } catch {}
  pickVoice();
  if ('speechSynthesis' in window) speechSynthesis.onvoiceschanged = pickVoice;
}

function pickVoice() {
  if (!('speechSynthesis' in window)) return;
  const vs = speechSynthesis.getVoices();
  voice = vs.find(v => v.lang === 'es-ES') || vs.find(v => v.lang?.startsWith('es')) || null;
}

export function setMuted(m) {
  state.muted = m;
  if (master) master.gain.value = m ? 0 : 0.5;
  if (m && 'speechSynthesis' in window) speechSynthesis.cancel();
}

/** Una "ejecución" de un reel: se puede cancelar al deslizar. */
export class Run {
  constructor() { this.cancelled = false; this.cleanups = []; }
  cancel() {
    this.cancelled = true;
    this.cleanups.splice(0).forEach(f => { try { f(); } catch {} });
  }
  check() { if (this.cancelled) throw Cancelled; }

  wait(ms) {
    this.check();
    return new Promise((res, rej) => {
      const t = setTimeout(() => { done(); res(); }, ms);
      const stop = () => { clearTimeout(t); rej(Cancelled); };
      const done = () => { const i = this.cleanups.indexOf(stop); if (i >= 0) this.cleanups.splice(i, 1); };
      this.cleanups.push(stop);
    });
  }

  /** Habla y espera a que termine (con tiempo máximo por si el navegador falla). */
  async say(text) {
    this.check();
    const est = 900 + text.split(/\s+/).length * 420;
    const canSpeak = 'speechSynthesis' in window && !state.muted;
    if (!canSpeak) return this.wait(est);
    await new Promise((res, rej) => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'es-ES'; if (voice) u.voice = voice;
      u.rate = 0.9; u.pitch = 1.05;
      let finished = false;
      const finish = () => { if (finished) return; finished = true; clearTimeout(guard); res(); };
      const guard = setTimeout(finish, est + 4000);
      u.onend = finish; u.onerror = finish;
      this.cleanups.push(() => { clearTimeout(guard); speechSynthesis.cancel(); if (!finished) { finished = true; rej(Cancelled); } });
      if (speechSynthesis.speaking || speechSynthesis.pending) speechSynthesis.cancel();
      speechSynthesis.resume();
      speechSynthesis.speak(u);
    });
    this.check();
  }

  /** Toca una melodía. onNote(i) se llama en cada nota (para animar). */
  async melody(song, onNote) {
    this.check();
    const beat = 60 / song.bpm;
    const notes = parseNotes(song.notes);
    let t0 = ctx ? ctx.currentTime + 0.08 : 0;
    const nodes = [], timers = [];
    let t = 0;
    notes.forEach((n, i) => {
      const dur = n.beats * beat;
      if (ctx && n.freq) nodes.push(...playTone(n.freq, t0 + t, dur));
      if (onNote && n.freq) timers.push(setTimeout(() => onNote(i, n), t * 1000));
      t += dur;
    });
    this.cleanups.push(() => {
      timers.forEach(clearTimeout);
      nodes.forEach(o => { try { o.stop(); } catch {} });
    });
    await this.wait(t * 1000 + 300);
  }

  /** Acorde suave y largo (para el reel de relajarse). */
  pad(freqs, seconds) {
    if (!ctx) return;
    const now = ctx.currentTime;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(0.07, now + 2);
    g.gain.setValueAtTime(0.07, now + seconds - 2);
    g.gain.linearRampToValueAtTime(0, now + seconds);
    g.connect(master);
    const oscs = freqs.map(f => { const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f; o.connect(g); o.start(now); o.stop(now + seconds); return o; });
    this.cleanups.push(() => { const t = ctx.currentTime; g.gain.cancelScheduledValues(t); g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.3); oscs.forEach(o => o.stop(t + 0.35)); });
  }
}

/** Sonido corto y alegre al revelar la respuesta. */
export function chime() {
  if (!ctx) return;
  const t = ctx.currentTime;
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => playTone(f, t + i * 0.09, 0.35, 0.18));
}

function playTone(freq, start, dur, vol = 0.3) {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
  g.gain.exponentialRampToValueAtTime(vol * 0.5, start + Math.min(0.25, dur * 0.6));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur * 0.98 + 0.05);
  g.connect(master);
  const a = ctx.createOscillator(); a.type = 'triangle'; a.frequency.value = freq;
  const b = ctx.createOscillator(); b.type = 'sine'; b.frequency.value = freq * 2;
  const bg = ctx.createGain(); bg.gain.value = 0.15;
  a.connect(g); b.connect(bg); bg.connect(g);
  a.start(start); b.start(start); a.stop(start + dur + 0.1); b.stop(start + dur + 0.1);
  return [a, b];
}

const SEMI = { C: -9, D: -7, E: -5, F: -4, G: -2, A: 0, B: 2 };
function parseNotes(str) {
  return str.trim().split(/\s+/).map(tok => {
    const [name, d] = tok.split(':');
    const beats = d ? parseFloat(d) : 1;
    if (name === 'R') return { freq: 0, beats };
    const m = name.match(/^([A-G])(#|b)?(\d)$/);
    const semis = SEMI[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0) + (parseInt(m[3]) - 4) * 12;
    return { freq: 440 * Math.pow(2, semis / 12), beats };
  });
}
