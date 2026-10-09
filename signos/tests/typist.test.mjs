// Prueba de cuándo se escribe una letra, simulando una cámara de 30 fps.
// Ejecutar: node signos/tests/typist.test.mjs
import { Typist } from '../src/typist.js';
const FRAME = 1000 / 30, HOLD = 350;
function run(script) {
  // script: [[label|null|'-' (sin mano), ms], ...]  label con '~' = se mueve
  const t = new Typist({ handGoneMs: 700, autoSpaceMs: 1200 });
  let now = 0; const out = []; let firstAt = null;
  for (const [lab, ms] of script) {
    const end = now + ms;
    for (; now < end; now += FRAME) {
      const hand = lab !== '-';
      const moving = typeof lab === 'string' && lab.endsWith('~');
      const stable = !hand ? null : lab && lab.replace('~', '');
      const r = t.update({ now, hand, stable, holdMs: HOLD, writing: true, autoSpace: true,
        variant: moving ? { C: 'CH', L: 'LL' }[stable] : undefined });
      if (r.commit) { out.push(r.commit); firstAt ??= now; }
      if (r.variant) out.push(`${r.variant.base}→${r.variant.label}`);
      if (r.space) out.push('␣');
    }
  }
  return { out: out.join(' '), firstAt };
}
const cases = [
  ['Mantener A 5 s → una sola A', [['A', 5000]], 'A'],
  ['Detector pierde la mano 300 ms → no repite', [['A', 1000], ['-', 300], ['A', 2000]], 'A'],
  ['Dudas del detector (null) → no repite', [['A', 600], [null, 200], ['A', 300], [null, 100], ['A', 1500]], 'A'],
  ['Bajar la mano 1 s → puede repetir', [['A', 1000], ['-', 1000], ['A', 1000]], 'A A'],
  ['Bajar la mano 2 s → espacio y repite', [['A', 1000], ['-', 2000], ['A', 1000]], 'A ␣ A'],
  ['Cambiar de letra sin bajar la mano', [['H', 800], ['O', 800], ['L', 800], ['A', 800]], 'H O L A'],
  ['A → B → A seguidas', [['A', 800], ['B', 800], ['A', 800]], 'A B A'],
  ['Parpadeo de otra letra 150 ms → no la escribe', [['A', 800], ['E', 150], ['A', 1000]], 'A'],
  ['C quieta y luego movida → CH', [['C', 600], ['C~', 400], ['C', 1000]], 'C C→CH'],
];
let fail = 0;
for (const [name, script, want] of cases) {
  const { out } = run(script);
  const ok = out === want; if (!ok) fail++;
  console.log(`${ok ? 'OK  ' : 'FALLO'} ${name}: "${out}"${ok ? '' : ` (esperado "${want}")`}`);
}
console.log('Tiempo hasta escribir la primera letra:', Math.round(run([['A', 2000]]).firstAt), 'ms desde que el signo es estable');
process.exit(fail ? 1 : 0);
