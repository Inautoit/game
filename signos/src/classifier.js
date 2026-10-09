// Clasificador k-vecinos: compara la mano actual con los ejemplos que
// la persona ha grabado y vota entre los más parecidos.

import { distance } from './features.js';

const STORAGE_KEY = 'signa.dataset.v1';

export class SignClassifier {
  constructor() {
    /** @type {{label:string, hands:number, v:number[]}[]} */
    this.samples = [];
  }

  add(label, feat) {
    this.samples.push({
      label,
      hands: feat.hands,
      v: feat.v.map((n) => Math.round(n * 1000) / 1000),
    });
  }

  countFor(label) {
    let n = 0;
    for (const s of this.samples) if (s.label === label) n++;
    return n;
  }

  removeLabel(label) {
    this.samples = this.samples.filter((s) => s.label !== label);
  }

  clear() {
    this.samples = [];
  }

  /**
   * @returns {{label:string, confidence:number, distance:number,
   *            ranking:{label:string, share:number}[]}|null}
   */
  predict(feat, k = 7) {
    if (!feat) return null;
    const cands = [];
    for (const s of this.samples) {
      if (s.hands === feat.hands) cands.push({ label: s.label, d: distance(feat.v, s.v) });
    }
    if (cands.length === 0) return null;
    cands.sort((a, b) => a.d - b.d);
    const top = cands.slice(0, k);

    const votes = new Map();
    let total = 0;
    for (const c of top) {
      const w = 1 / (c.d + 0.02);
      votes.set(c.label, (votes.get(c.label) || 0) + w);
      total += w;
    }
    const ranking = [...votes.entries()]
      .map(([label, w]) => ({ label, share: w / total }))
      .sort((a, b) => b.share - a.share);
    const best = ranking[0];
    const nearest = top.find((c) => c.label === best.label).d;
    return { label: best.label, confidence: best.share, distance: nearest, ranking };
  }

  toJSON() {
    return { app: 'signa', version: 1, samples: this.samples };
  }

  load(data) {
    if (!data || !Array.isArray(data.samples)) throw new Error('El archivo no tiene ejemplos de Signa.');
    this.samples = data.samples.filter(
      (s) => typeof s.label === 'string' && Array.isArray(s.v) && (s.hands === 1 || s.hands === 2),
    );
  }

  save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.toJSON()));
      return true;
    } catch {
      return false;
    }
  }

  restore() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) this.load(JSON.parse(raw));
    } catch {
      this.samples = [];
    }
  }
}
