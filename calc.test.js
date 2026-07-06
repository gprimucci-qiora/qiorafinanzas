// calc.test.js
const test = require('node:test');
const assert = require('node:assert');
const Calc = require('./calc.js');

test('computeVentana devuelve fecha_min y fecha_max en formato ISO', () => {
  const rows = [
    { fecha_pago: '2026-03-15' },
    { fecha_pago: '2026-01-02' },
    { fecha_pago: '2026-05-30' },
  ];
  const result = Calc.computeVentana(rows);
  assert.strictEqual(result.fechaMin, '2026-01-02');
  assert.strictEqual(result.fechaMax, '2026-05-30');
});

test('computeVentana lanza error si no hay filas', () => {
  assert.throws(() => Calc.computeVentana([]), /No hay filas/);
});
