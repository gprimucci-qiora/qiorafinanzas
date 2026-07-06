// calc.js
(function (root, factory) {
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();
  } else {
    root.Calc = factory();
  }
})(typeof self !== 'undefined' ? self : this, function () {

  function toISODate(date) {
    return date.toISOString().slice(0, 10);
  }

  function computeVentana(rows) {
    if (!rows || rows.length === 0) {
      throw new Error('No hay filas para calcular la ventana');
    }
    let min = null;
    let max = null;
    for (const row of rows) {
      const fecha = row.fecha_pago instanceof Date ? row.fecha_pago : new Date(row.fecha_pago);
      if (min === null || fecha < min) min = fecha;
      if (max === null || fecha > max) max = fecha;
    }
    return { fechaMin: toISODate(min), fechaMax: toISODate(max) };
  }

  return {
    computeVentana,
  };
});
