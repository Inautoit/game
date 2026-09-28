import test from 'node:test';
import assert from 'node:assert';
import { computeInvoice } from '../src/worker.js';
import { hashPassword, verifyPassword, encrypt, decrypt } from '../src/crypto.js';

test('calcula subtotal, IVA, IRPF y total', () => {
  const { inv, lines } = computeInvoice({
    cliente_nombre: 'Cliente',
    iva_pct: '21',
    irpf_pct: '15',
    lines: [
      { descripcion: 'Punto de luz', cantidad: '3', precio: '35,5' },
      { descripcion: 'Mano de obra', cantidad: 2, precio: 25, descuento: 10 },
      { descripcion: '', precio: 99 },
    ],
  });
  assert.equal(lines.length, 2);
  assert.deepEqual([inv.base, inv.iva, inv.irpf, inv.total], [151.5, 31.82, 22.73, 160.59]);
});

test('exige cliente y líneas', () => {
  assert.throws(() => computeInvoice({ cliente_nombre: 'X', lines: [] }), /al menos un producto/);
  assert.throws(() => computeInvoice({ lines: [{ descripcion: 'a', precio: 1 }] }), /cliente/);
});

test('contraseñas y cifrado', async () => {
  const h = await hashPassword('secreto123');
  assert.ok(await verifyPassword('secreto123', h));
  assert.ok(!(await verifyPassword('otra', h)));
  assert.equal(await decrypt('k', await encrypt('k', 'token')), 'token');
});
