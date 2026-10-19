import assert from 'node:assert/strict';
import { calcular, rangoPorDefecto, parseFecha } from '../public/calc.js';

const d = (s) => parseFecha(s);
const logs = [
  // A: 2 ilocalizados y luego contacto
  { id: 'A', fecha: d('2026-06-20'), key4: 'R_ILOC01' },
  { id: 'A', fecha: d('2026-07-02'), key4: 'R_TRA006' },
  { id: 'A', fecha: d('2026-07-03'), key4: 'R_OK' },
  // B: excluida aunque tenga intentos
  { id: 'B', fecha: d('2026-07-01'), key4: 'R_ILOC02' },
  { id: 'B', fecha: d('2026-07-04'), key4: 'R_NOU_03' },
  // C: 1 ilocalizado, sin contacto
  { id: 'C', fecha: d('05/07/2026'), key4: 'R_ILOC01' },
  // fuera de rango y fuera de BBDD
  { id: 'C', fecha: d('2026-06-10'), key4: 'R_ILOC01' },
  { id: 'Z', fecha: d('2026-07-05'), key4: 'R_ILOC01' },
];

const r = calcular(['A', 'B', 'C', 'D'], logs, '2026-06-15', '2026-07-18');
assert.equal(r.resumen.total, 4);
assert.equal(r.resumen.excluidas, 1);
assert.equal(r.resumen.gestionables, 3);
assert.equal(r.resumen.contactadas, 1);
assert.equal(r.resumen.ilocalizadas, 1);
assert.equal(r.resumen.sinIntentos, 1);
assert.equal(r.resumen.totalIntentos, 4);
assert.equal(r.resumen.logsFueraBbdd, 1);
assert.equal(r.detalle.find((x) => x.id === 'A').ilocAntes, 2);
assert.equal(r.detalle.find((x) => x.id === 'B').intentos, 0);
// D sin intentos -> ni la vuelta 1 está completa
assert.equal(r.resumen.vueltasCompletas, 0);
assert.deepEqual(rangoPorDefecto('2026-07', new Date(2026, 6, 19)), { desde: '2026-06-15', hasta: '2026-07-18' });
assert.deepEqual(rangoPorDefecto('2026-07', new Date(2026, 9, 19)), { desde: '2026-06-15', hasta: '2026-07-31' });
console.log('OK');
