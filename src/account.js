// Identidad del jugador. Cuenta anónima: no hay email ni contraseña, el
// móvil guarda {id, secret} y hay un código para llevársela a otro aparato.
//
// Todo lo de red va envuelto: si no hay conexión (o estás abriendo el
// index.html a pelo), el juego sigue funcionando con récords locales.

const KEY = 'urus:account';

export class Account {
  constructor() {
    this.data = load();
    this.online = false;
    this.runId = null;
  }

  get id() { return this.data?.id || null; }
  get name() { return this.data?.name || defaultName(); }
  get recovery() { return this.data?.recovery || null; }
  get signedIn() { return !!(this.data?.id && this.data?.secret); }

  get headers() {
    return this.signedIn ? { Authorization: `Bearer ${this.data.id}.${this.data.secret}` } : {};
  }

  // Crea la cuenta la primera vez. Si el servidor no responde, seguimos
  // jugando sin ella y se reintentará en la siguiente partida.
  async ensure(name) {
    if (this.signedIn) {
      if (name && name !== this.data.name) await this.rename(name);
      return this.data;
    }
    const res = await this.post('/api/account', { name: name || defaultName() });
    if (res) { this.data = res; save(this.data); this.online = true; }
    return this.data;
  }

  async rename(name) {
    if (!this.signedIn) return this.ensure(name);
    const res = await this.patch('/api/account', { name });
    if (res?.ok) { this.data.name = res.name; save(this.data); }
    return this.data;
  }

  async recover(code) {
    const res = await this.post('/api/account/recover', { recovery: code });
    if (!res || res.error) return { error: res?.error || 'No se pudo recuperar' };
    this.data = res;
    save(this.data);
    this.online = true;
    return res;
  }

  // Vale de partida: se pide al empezar y se envía con la puntuación, para
  // que el servidor pueda comprobar cuánto ha durado de verdad.
  async startRun() {
    this.runId = null;
    if (!this.signedIn) return null;
    const res = await this.post('/api/run', {});
    this.runId = res?.runId || null;
    return this.runId;
  }

  async submit(stats) {
    if (!this.signedIn || !this.runId) return null;
    const res = await this.post('/api/score', { ...stats, runId: this.runId });
    this.runId = null;
    return res && !res.error ? res : null;
  }

  async leaderboard(mode) {
    return this.get(`/api/leaderboard?mode=${encodeURIComponent(mode)}&limit=25`);
  }

  // ------------------------------------------------------------- fetch
  async get(path) { return this.request('GET', path); }
  async post(path, body) { return this.request('POST', path, body); }
  async patch(path, body) { return this.request('PATCH', path, body); }

  async request(method, path, body) {
    try {
      const res = await fetch(path, {
        method,
        headers: { ...this.headers, ...(body ? { 'content-type': 'application/json' } : {}) },
        body: body ? JSON.stringify(body) : undefined,
      });
      const data = await res.json().catch(() => null);
      this.online = res.ok;
      return data;
    } catch {
      this.online = false;
      return null;
    }
  }
}

export function defaultName() {
  return 'Piloto ' + (1000 + Math.floor(Math.random() * 9000));
}

function load() {
  try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; }
}
function save(data) {
  try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* modo privado */ }
}
