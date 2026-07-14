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

test('clasificarFactura asigna tipo_gasto y sucursal_secundaria cuando hay match directo', () => {
  const glosarioMap = {
    'CTA-TPI-INT-XAL XALAPA': {
      tipo_sucursal: 'DISTRITO', region: 'ORIENTE',
      sucursal_secundaria: 'CTA-TPI-INT-XAL XALAPA', tipo_gasto: 'COSTOS DIRECTOS',
    },
  };
  const factura = { sucursal: 'CTA-TPI-INT-XAL XALAPA', subtotal: 1000, monto: 9999 };
  const result = Calc.clasificarFactura(factura, glosarioMap);
  assert.strictEqual(result.tipo_gasto, 'COSTOS DIRECTOS');
  assert.strictEqual(result.region, 'ORIENTE');
  assert.strictEqual(result.sucursal_secundaria, 'CTA-TPI-INT-XAL XALAPA');
  assert.strictEqual(result.monto, 1000);
});

test('clasificarFactura consolida contratista en su distrito real', () => {
  const glosarioMap = {
    'CTA-TPI-DLR-CBA CORDOBA ORIZABA CARLOS MARTINEZ': {
      tipo_sucursal: 'CONTRATISTAS', region: 'ORIENTE',
      sucursal_secundaria: 'CTA-TPI-INT-CBA CORDOBA ORIZABA', tipo_gasto: 'COSTOS DIRECTOS',
    },
  };
  const factura = { sucursal: 'CTA-TPI-DLR-CBA CORDOBA ORIZABA CARLOS MARTINEZ', subtotal: 500, monto: 9999 };
  const result = Calc.clasificarFactura(factura, glosarioMap);
  assert.strictEqual(result.sucursal_secundaria, 'CTA-TPI-INT-CBA CORDOBA ORIZABA');
});

test('clasificarFactura marca SIN_CLASIFICAR cuando la sucursal no está en el glosario', () => {
  const factura = { sucursal: 'CTA-TPI-INT-GCH GDL CHAPULTEPEC', subtotal: 200, monto: 9999 };
  const result = Calc.clasificarFactura(factura, {});
  assert.strictEqual(result.tipo_gasto, 'SIN_CLASIFICAR');
  assert.strictEqual(result.region, null);
});

test('clasificarFactura usa subtotal como monto, ignorando el monto original (con IVA)', () => {
  const factura = { sucursal: 'X', subtotal: 100, monto: 116 };
  const result = Calc.clasificarFactura(factura, {});
  assert.strictEqual(result.monto, 100);
});

test('calcularProrrateo reparte una bolsa nacional entre todos los distritos por folios', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'ORIENTE', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-NACIONAL': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'DIST-B', subtotal: 200 },
    { sucursal: 'BOLSA-NACIONAL', subtotal: 400 },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  const distB = result.distritos.find((d) => d.distrito === 'DIST-B');
  // DIST-A tiene 3 folios de 4 totales -> 300 de la bolsa; DIST-B tiene 1 de 4 -> 100
  assert.strictEqual(distA.folios, 3);
  assert.strictEqual(distB.folios, 1);
  assert.strictEqual(distA.gastoOperativoAsignado, 300);
  assert.strictEqual(distB.gastoOperativoAsignado, 100);
  assert.strictEqual(distA.totalProrrateado, 300 + 300);
  assert.strictEqual(result.gastoOperativoBolsaTotal, 400);
});

test('calcularProrrateo reparte una bolsa regional solo entre distritos de esa región', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'ORIENTE', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-BAJIO': { region: 'BAJIO', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'DIST-B', subtotal: 100 },
    { sucursal: 'BOLSA-BAJIO', subtotal: 500 },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  const distB = result.distritos.find((d) => d.distrito === 'DIST-B');
  // La bolsa de Bajío solo toca a DIST-A (único distrito de Bajío); DIST-B no recibe nada
  assert.strictEqual(distA.gastoOperativoAsignado, 500);
  assert.strictEqual(distB.gastoOperativoAsignado, 0);
});

test('calcularProrrateo cuenta folios como número de renglones, no de FACTURA distinta', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100, factura: null },
    { sucursal: 'DIST-A', subtotal: 100, factura: null },
    { sucursal: 'DIST-A', subtotal: 100, factura: 'F-1' },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  assert.strictEqual(distA.folios, 3);
});

test('calcularProrrateo no lanza error si una bolsa regional no tiene distritos con folios en el periodo', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-ORIENTE': { region: 'ORIENTE', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'BOLSA-ORIENTE', subtotal: 500 },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  // No district in ORIENTE appeared in this period's direct-cost invoices,
  // so BOLSA-ORIENTE's scope has 0 total folios: it must be skipped, not
  // crash or produce NaN, and DIST-A (a different region) must stay untouched.
  assert.strictEqual(distA.gastoOperativoAsignado, 0);
  assert.strictEqual(result.gastoOperativoBolsaTotal, 500);
});

test('calcularKPIs suma correctamente costo directo, operativo y sin clasificar', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-X': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 1000 },
    { sucursal: 'BOLSA-X', subtotal: 500 },
    { sucursal: 'DESCONOCIDA', subtotal: 50 },
  ];
  const result = Calc.calcularKPIs(facturas, glosarioMap);
  assert.strictEqual(result.totalPagado, 1550);
  assert.strictEqual(result.costoDirecto, 1000);
  assert.strictEqual(result.gastoOperativo, 500);
  assert.strictEqual(result.sinClasificar, 50);
});

test('calcularVariacionPct calcula el porcentaje de variación correcto', () => {
  assert.strictEqual(Calc.calcularVariacionPct(150, 100), 50);
  assert.strictEqual(Calc.calcularVariacionPct(80, 100), -20);
});

test('calcularVariacionPct retorna null si no hay monto anterior para comparar', () => {
  assert.strictEqual(Calc.calcularVariacionPct(500, 0), null);
});

test('agruparPorFamiliaGasto agrega correctamente por familia y por gasto', () => {
  const facturas = [
    { familia: 'GASOLINA', gasto: 'GASOLINA', monto: 100 },
    { familia: 'GASOLINA', gasto: 'GASOLINA', monto: 50 },
    { familia: 'RENTAS', gasto: 'RENTA LOCALES', monto: 200 },
  ];
  const resultado = Calc.agruparPorFamiliaGasto(facturas);
  assert.strictEqual(resultado['GASOLINA'].total, 150);
  assert.strictEqual(resultado['GASOLINA'].porGasto['GASOLINA'], 150);
  assert.strictEqual(resultado['RENTAS'].total, 200);
  assert.strictEqual(resultado['RENTAS'].porGasto['RENTA LOCALES'], 200);
});

test('obtenerParametroVigente regresa la fila con vigente_desde mas reciente <= el mes dado', () => {
  const registros = [
    { valor: 'A', vigente_desde: '2026-01-01' },
    { valor: 'B', vigente_desde: '2026-03-01' },
    { valor: 'C', vigente_desde: '2026-06-01' },
  ];
  const resultado = Calc.obtenerParametroVigente(registros, '2026-04-01');
  assert.strictEqual(resultado.valor, 'B');
});

test('obtenerParametroVigente regresa null si no hay ninguna fila vigente para ese mes', () => {
  const registros = [{ valor: 'A', vigente_desde: '2026-06-01' }];
  const resultado = Calc.obtenerParametroVigente(registros, '2026-01-01');
  assert.strictEqual(resultado, null);
});

test('bolsaMultidistritoDeRegion mapea GUADALAJARA a OCCIDENTE', () => {
  assert.strictEqual(Calc.bolsaMultidistritoDeRegion('GUADALAJARA'), 'OCCIDENTE');
});

test('bolsaMultidistritoDeRegion regresa null para NORTE (no participa)', () => {
  assert.strictEqual(Calc.bolsaMultidistritoDeRegion('NORTE'), null);
});

test('bolsaMultidistritoDeRegion deja pasar las demas regiones tal cual', () => {
  assert.strictEqual(Calc.bolsaMultidistritoDeRegion('ORIENTE'), 'ORIENTE');
  assert.strictEqual(Calc.bolsaMultidistritoDeRegion('SURESTE'), 'SURESTE');
  assert.strictEqual(Calc.bolsaMultidistritoDeRegion('BAJIO'), 'BAJIO');
});

test('obtenerRegionPorDistrito construye distrito -> region desde el glosarioMap', () => {
  const glosarioMap = {
    'CTA-TPI-INT-LON LEON': { region: 'BAJIO', sucursal_secundaria: 'CTA-TPI-INT-LON LEON' },
    'CTA-TPI-DLR-LON LEON CONTRATISTA': { region: 'BAJIO', sucursal_secundaria: 'CTA-TPI-INT-LON LEON' },
  };
  const resultado = Calc.obtenerRegionPorDistrito(glosarioMap);
  assert.strictEqual(resultado['CTA-TPI-INT-LON LEON'], 'BAJIO');
});

test('calcularIngresoPolizaDistrito multiplica precio vigente por ordenes vigentes', () => {
  const parametros = [
    { poliza: 'PLANTA INTERNA', distrito: 'LEON', precio_por_orden: 475, ordenes_dimensionadas: 4245, vigente_desde: '2026-01-01' },
    { poliza: 'RECOLECCIONES', distrito: 'LEON', precio_por_orden: 250, ordenes_dimensionadas: 100, vigente_desde: '2026-01-01' },
  ];
  const resultado = Calc.calcularIngresoPolizaDistrito(parametros, 'PLANTA INTERNA', 'LEON', '2026-03-01');
  assert.strictEqual(resultado, 475 * 4245);
});

test('calcularIngresoPolizaDistrito regresa 0 si no hay parametro vigente', () => {
  const resultado = Calc.calcularIngresoPolizaDistrito([], 'PLANTA INTERNA', 'LEON', '2026-03-01');
  assert.strictEqual(resultado, 0);
});

test('calcularIngresoMultidistritoDistrito multiplica ordenes asignadas del distrito por precio de su bolsa', () => {
  const asignaciones = [
    { distrito: 'LEON', ordenes_asignadas: 2107, porcentaje: 0.75, vigente_desde: '2025-03-01' },
  ];
  const bolsas = [
    { region_bolsa: 'BAJIO', precio_por_orden: 613, ordenes_dimensionadas: 2107, vigente_desde: '2025-03-01' },
  ];
  const resultado = Calc.calcularIngresoMultidistritoDistrito(asignaciones, bolsas, 'LEON', 'BAJIO', '2025-06-01');
  assert.strictEqual(resultado, 2107 * 613);
});

test('calcularIngresoMultidistritoDistrito regresa 0 si la region es null (no participa)', () => {
  const resultado = Calc.calcularIngresoMultidistritoDistrito([], [], 'MONTERREY', null, '2025-06-01');
  assert.strictEqual(resultado, 0);
});

test('calcularIngresosDistrito suma las 3 polizas en un solo objeto', () => {
  const datos = {
    polizaParametros: [
      { poliza: 'PLANTA INTERNA', distrito: 'LEON', precio_por_orden: 475, ordenes_dimensionadas: 4245, vigente_desde: '2026-01-01' },
      { poliza: 'RECOLECCIONES', distrito: 'LEON', precio_por_orden: 250, ordenes_dimensionadas: 100, vigente_desde: '2026-01-01' },
    ],
    multidistritoBolsas: [
      { region_bolsa: 'BAJIO', precio_por_orden: 613, ordenes_dimensionadas: 2107, vigente_desde: '2025-03-01' },
    ],
    multidistritoAsignacion: [
      { distrito: 'LEON', ordenes_asignadas: 2107, porcentaje: 0.75, vigente_desde: '2025-03-01' },
    ],
  };
  const resultado = Calc.calcularIngresosDistrito(datos, 'LEON', 'BAJIO', '2026-03-01');
  assert.strictEqual(resultado.plantaInterna, 475 * 4245);
  assert.strictEqual(resultado.recolecciones, 250 * 100);
  assert.strictEqual(resultado.multidistrito, 2107 * 613);
  assert.strictEqual(resultado.total, 475 * 4245 + 250 * 100 + 2107 * 613);
});
