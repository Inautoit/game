import test from 'node:test';
import assert from 'node:assert';
import '../public/static/voice.js';

const V = globalThis.VoiceQuote;

test('números en letra', () => {
  assert.equal(V.wordsToDigits('treinta y cinco euros'), '35 euros');
  assert.equal(V.wordsToDigits('dos puntos de luz a veintiocho'), '2 puntos de luz a 28');
  assert.equal(V.wordsToDigits('mil doscientos cincuenta'), '1250');
  assert.equal(V.wordsToDigits('ciento veinte'), '120');
});

test('dictado completo con palabras clave', () => {
  const r = V.parse(
    'Cliente Juan García. Teléfono 611 22 33 44. Dirección calle Mayor 5. Concepto cambiar enchufe de la cocina 35 euros. ' +
      'Concepto 2 puntos de luz a 28 euros. Concepto 3 horas de mano de obra a 25 euros la hora. IVA 10. Nota material incluido'
  );
  assert.equal(r.cliente, 'Juan García');
  assert.equal(r.telefono, '611 22 33 44');
  assert.equal(r.direccion, 'Calle Mayor 5');
  assert.equal(r.iva, 10);
  assert.equal(r.nota, 'Material incluido');
  assert.deepEqual(r.lines, [
    { descripcion: 'Cambiar enchufe de la cocina', cantidad: 1, precio: 35 },
    { descripcion: 'Puntos de luz', cantidad: 2, precio: 28 },
    { descripcion: 'Horas de mano de obra', cantidad: 3, precio: 25 },
  ]);
});

test('como lo transcribe el móvil (sin puntos, números en letra, €)', () => {
  const r = V.parse('cliente maría lópez teléfono seis uno uno dos dos tres tres cuatro cuatro concepto cuadro eléctrico nuevo 350 € concepto cable 20 metros a 1,20 sin iva');
  assert.equal(r.cliente, 'María López');
  assert.equal(r.telefono, '611 22 33 44');
  assert.equal(r.iva, 0);
  assert.deepEqual(r.lines[0], { descripcion: 'Cuadro eléctrico nuevo', cantidad: 1, precio: 350 });
  assert.deepEqual(r.lines[1], { descripcion: 'Cable 20 metros', cantidad: 1, precio: 1.2 });
});

test('teléfono dicho cifra a cifra o por grupos', () => {
  assert.equal(V.parse('teléfono seis cero cero uno dos tres cuatro cinco seis').telefono, '600 12 34 56');
  assert.equal(V.parse('teléfono seiscientos... ').telefono, undefined);
  assert.equal(V.parse('teléfono 6 1 1 22 33 44').telefono, '611 22 33 44');
  assert.equal(V.parse('teléfono seis once veintidós treinta y tres cuarenta y cuatro').telefono, '611 22 33 44');
});

test('variantes de precio', () => {
  assert.deepEqual(V.parseLine('4 enchufes por 15 euros'), { descripcion: 'Enchufes', cantidad: 4, precio: 15 });
  assert.deepEqual(V.parseLine('instalación de toldo 120 euros con 50'), { descripcion: 'Instalación de toldo', cantidad: 1, precio: 120.5 });
  assert.deepEqual(V.parseLine('3 focos 90 euros en total'), { descripcion: 'Focos', cantidad: 3, precio: 30 });
  assert.deepEqual(V.parseLine('revisión boletín mil doscientos euros'), { descripcion: 'Revisión boletín', cantidad: 1, precio: 1200 });
});

test('dictado por partes y sin palabras clave', () => {
  assert.deepEqual(V.parse('concepto cambiar diferencial 60 euros').lines, [{ descripcion: 'Cambiar diferencial', cantidad: 1, precio: 60 }]);
  assert.equal(V.parse('cliente Bar El Rincón').cliente, 'Bar el Rincón');
  const r = V.parse('cambiar lámpara 25 euros y luego instalar ventilador 40 euros');
  assert.equal(r.lines.length, 2);
  assert.equal(r.lines[1].precio, 40);
});

test('descuento', () => {
  assert.deepEqual(V.parse('concepto cuadro 200 euros descuento 10 por ciento').descuento, { valor: 10, tipo: 'pct' });
  assert.deepEqual(V.parse('descuento del 15%').descuento, { valor: 15, tipo: 'pct' });
  assert.deepEqual(V.parse('descuento de veinte euros').descuento, { valor: 20, tipo: 'eur' });
  assert.equal(V.parse('concepto cuadro 200 euros descuento 10 por ciento').lines[0].precio, 200);
});
