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

test('calcularProrrateo reparte una bolsa nacional entre todos los distritos por folios de Planta Interna', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'ORIENTE', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-NACIONAL': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'DIST-B', subtotal: 200 },
    { sucursal: 'BOLSA-NACIONAL', subtotal: 400 },
  ];
  const foliosPI = { 'DIST-A': 3, 'DIST-B': 1 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  const distB = result.distritos.find((d) => d.distrito === 'DIST-B');
  // DIST-A tiene 3 folios PI de 4 totales -> 300 de la bolsa; DIST-B tiene 1 de 4 -> 100
  assert.strictEqual(distA.folios, 3);
  assert.strictEqual(distB.folios, 1);
  assert.strictEqual(distA.gastoOperativoAsignado, 300);
  assert.strictEqual(distB.gastoOperativoAsignado, 100);
  assert.strictEqual(distA.totalProrrateado, 100 + 300);
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
  const foliosPI = { 'DIST-A': 5, 'DIST-B': 5 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  const distB = result.distritos.find((d) => d.distrito === 'DIST-B');
  // La bolsa de Bajío solo toca a DIST-A (único distrito de Bajío); DIST-B no recibe nada
  // aunque tenga los mismos folios PI, porque está en otra región.
  assert.strictEqual(distA.gastoOperativoAsignado, 500);
  assert.strictEqual(distB.gastoOperativoAsignado, 0);
});

test('regionGastoOperativo trata Guadalajara como Occidente (Occidente ya le da servicio)', () => {
  assert.strictEqual(Calc.regionGastoOperativo('GUADALAJARA'), 'OCCIDENTE');
  assert.strictEqual(Calc.regionGastoOperativo('OCCIDENTE'), 'OCCIDENTE');
  assert.strictEqual(Calc.regionGastoOperativo('BAJIO'), 'BAJIO');
  assert.strictEqual(Calc.regionGastoOperativo(null), null);
});

test('calcularProrrateo mezcla distritos de Guadalajara con la bolsa regional de Occidente', () => {
  const glosarioMap = {
    'DIST-GDL': { region: 'GUADALAJARA', sucursal_secundaria: 'DIST-GDL', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-OCC': { region: 'OCCIDENTE', sucursal_secundaria: 'DIST-OCC', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-BAJIO': { region: 'BAJIO', sucursal_secundaria: 'DIST-BAJIO', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-OCCIDENTE': { region: 'OCCIDENTE', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-GDL', subtotal: 100 },
    { sucursal: 'DIST-OCC', subtotal: 100 },
    { sucursal: 'DIST-BAJIO', subtotal: 100 },
    { sucursal: 'BOLSA-OCCIDENTE', subtotal: 400 },
  ];
  const foliosPI = { 'DIST-GDL': 1, 'DIST-OCC': 1, 'DIST-BAJIO': 1 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distGdl = result.distritos.find((d) => d.distrito === 'DIST-GDL');
  const distOcc = result.distritos.find((d) => d.distrito === 'DIST-OCC');
  const distBajio = result.distritos.find((d) => d.distrito === 'DIST-BAJIO');
  // DIST-GDL (región GUADALAJARA) participa en la bolsa de OCCIDENTE como si fuera de esa región;
  // se reparte 50/50 con DIST-OCC. DIST-BAJIO (otra región real) no recibe nada.
  assert.strictEqual(distGdl.gastoOperativoAsignado, 200);
  assert.strictEqual(distOcc.gastoOperativoAsignado, 200);
  assert.strictEqual(distBajio.gastoOperativoAsignado, 0);
});

test('calcularProrrateo también junta una bolsa regional cuya sucursal está etiquetada Guadalajara con Occidente', () => {
  const glosarioMap = {
    'DIST-GDL': { region: 'GUADALAJARA', sucursal_secundaria: 'DIST-GDL', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-OCC': { region: 'OCCIDENTE', sucursal_secundaria: 'DIST-OCC', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-GDL': { region: 'GUADALAJARA', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-GDL', subtotal: 100 },
    { sucursal: 'DIST-OCC', subtotal: 100 },
    { sucursal: 'BOLSA-GDL', subtotal: 300 },
  ];
  const foliosPI = { 'DIST-GDL': 1, 'DIST-OCC': 2 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distGdl = result.distritos.find((d) => d.distrito === 'DIST-GDL');
  const distOcc = result.distritos.find((d) => d.distrito === 'DIST-OCC');
  // Una bolsa etiquetada como región GUADALAJARA también se reparte con los distritos de OCCIDENTE.
  assert.strictEqual(distGdl.gastoOperativoAsignado, 100); // 1/3 de 300
  assert.strictEqual(distOcc.gastoOperativoAsignado, 200); // 2/3 de 300
});

test('calcularProrrateo usa el mapa de folios de Planta Interna provisto como peso, no cuenta renglones de factura', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'BAJIO', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-BAJIO': { region: 'BAJIO', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    // DIST-A tiene 5 renglones de factura, DIST-B solo 1 — si el peso viniera
    // de contar renglones, DIST-A se llevaría casi toda la bolsa.
    { sucursal: 'DIST-A', subtotal: 20 },
    { sucursal: 'DIST-A', subtotal: 20 },
    { sucursal: 'DIST-A', subtotal: 20 },
    { sucursal: 'DIST-A', subtotal: 20 },
    { sucursal: 'DIST-A', subtotal: 20 },
    { sucursal: 'DIST-B', subtotal: 100 },
    { sucursal: 'BOLSA-BAJIO', subtotal: 1000 },
  ];
  // Pero el peso real es folios de Planta Interna: DIST-A=1, DIST-B=1 -> 50/50.
  const foliosPI = { 'DIST-A': 1, 'DIST-B': 1 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  const distB = result.distritos.find((d) => d.distrito === 'DIST-B');
  assert.strictEqual(distA.gastoOperativoAsignado, 500);
  assert.strictEqual(distB.gastoOperativoAsignado, 500);
});

test('calcularProrrateo no lanza error si una bolsa regional no tiene distritos con folios PI en el periodo', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-ORIENTE': { region: 'ORIENTE', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'BOLSA-ORIENTE', subtotal: 500 },
  ];
  const foliosPI = { 'DIST-A': 5 };
  const result = Calc.calcularProrrateo(facturas, glosarioMap, foliosPI);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  // Ningún distrito de ORIENTE aparece en las facturas de costo directo de este periodo,
  // así que el scope de BOLSA-ORIENTE no tiene distritos: se debe saltar sin
  // tronar ni producir NaN, y DIST-A (otra región) debe quedar intacto.
  assert.strictEqual(distA.gastoOperativoAsignado, 0);
  assert.strictEqual(result.gastoOperativoBolsaTotal, 500);
});

test('calcularProrrateo no asigna nada si no se provee el mapa de folios de Planta Interna', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-NACIONAL': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 100 },
    { sucursal: 'BOLSA-NACIONAL', subtotal: 400 },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  assert.strictEqual(distA.gastoOperativoAsignado, 0);
  assert.strictEqual(result.gastoOperativoBolsaTotal, 400);
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

test('calcularKPIs ignora por completo las facturas marcadas como EXCLUIDO (sucursales cerradas)', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-CERRADO': { region: 'NORTE', sucursal_secundaria: 'DIST-CERRADO', tipo_gasto: 'EXCLUIDO' },
  };
  const facturas = [
    { sucursal: 'DIST-A', subtotal: 1000 },
    { sucursal: 'DIST-CERRADO', subtotal: 99999 },
  ];
  const result = Calc.calcularKPIs(facturas, glosarioMap);
  // La factura de la sucursal cerrada no debe aparecer en ningún total, ni siquiera en sinClasificar.
  assert.strictEqual(result.totalPagado, 1000);
  assert.strictEqual(result.costoDirecto, 1000);
  assert.strictEqual(result.gastoOperativo, 0);
  assert.strictEqual(result.sinClasificar, 0);
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

test('obtenerCuadrillasMultidistrito suma personas autorizadas de todos los puestos vigentes de la sucursal MLT correspondiente', () => {
  const hcAutorizado = [
    { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'PI', personas_autorizadas: 20, vigente_desde: '2026-01-01' },
    { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'DESTAJO', personas_autorizadas: 5, vigente_desde: '2026-01-01' },
  ];
  const resultado = Calc.obtenerCuadrillasMultidistrito(hcAutorizado, 'CTA-TPI-INT-LON LEON', '2026-03-01');
  assert.strictEqual(resultado, 25);
});

test('obtenerCuadrillasMultidistrito usa la fila mas reciente por puesto (no vigencias futuras)', () => {
  const hcAutorizado = [
    { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'PI', personas_autorizadas: 20, vigente_desde: '2026-01-01' },
    { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'PI', personas_autorizadas: 30, vigente_desde: '2026-06-01' },
  ];
  const resultado = Calc.obtenerCuadrillasMultidistrito(hcAutorizado, 'CTA-TPI-INT-LON LEON', '2026-03-01');
  assert.strictEqual(resultado, 20);
});

test('obtenerCuadrillasMultidistrito reparte Guadalajara entre sus 4 sucursales por igual', () => {
  const hcAutorizado = [
    { distrito: 'CTA-TPI-MLT-GDL MLT GUADALAJARA', puesto: 'PI', personas_autorizadas: 36, vigente_desde: '2026-01-01' },
  ];
  assert.strictEqual(Calc.obtenerCuadrillasMultidistrito(hcAutorizado, 'CTA-TPI-INT-GES GDL ESTADIO', '2026-03-01'), 9);
  assert.strictEqual(Calc.obtenerCuadrillasMultidistrito(hcAutorizado, 'CTA-TPI-INT-GPR GDL PRIMAVERA', '2026-03-01'), 9);
});

test('obtenerCuadrillasMultidistrito regresa 0 si no hay fila de HC para esa sucursal', () => {
  const resultado = Calc.obtenerCuadrillasMultidistrito([], 'CTA-TPI-INT-LON LEON', '2026-03-01');
  assert.strictEqual(resultado, 0);
});

test('calcularIngresoMultidistritoDistrito reparte la bolsa proporcional al peso de cuadrillas del distrito', () => {
  const bolsas = [
    { region_bolsa: 'BAJIO', precio_por_orden: 613, ordenes_dimensionadas: 2000, vigente_desde: '2025-03-01' },
  ];
  const hcAutorizado = [
    { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'PI', personas_autorizadas: 30, vigente_desde: '2025-01-01' },
    { distrito: 'CTA-TPI-MLT-IRA MLT IRAPUATO', puesto: 'PI', personas_autorizadas: 10, vigente_desde: '2025-01-01' },
  ];
  const todosLosDistritos = ['CTA-TPI-INT-LON LEON', 'CTA-TPI-INT-IRA IRAPUATO'];
  const regionPorDistrito = { 'CTA-TPI-INT-LON LEON': 'BAJIO', 'CTA-TPI-INT-IRA IRAPUATO': 'BAJIO' };
  const resultado = Calc.calcularIngresoMultidistritoDistrito(bolsas, hcAutorizado, todosLosDistritos, regionPorDistrito, 'CTA-TPI-INT-LON LEON', 'BAJIO', '2025-06-01');
  // peso LEON = 30/(30+10) = 0.75; ordenes asignadas = 0.75 * 2000 = 1500
  assert.strictEqual(resultado, 1500 * 613);
});

test('calcularIngresoMultidistritoDistrito regresa 0 si la region es null (no participa)', () => {
  const resultado = Calc.calcularIngresoMultidistritoDistrito([], [], [], {}, 'CTA-TPI-INT-MTY MONTERREY', null, '2025-06-01');
  assert.strictEqual(resultado, 0);
});

test('calcularIngresoMultidistritoDistrito regresa 0 si nadie en la bolsa tiene cuadrillas autorizadas', () => {
  const bolsas = [
    { region_bolsa: 'BAJIO', precio_por_orden: 613, ordenes_dimensionadas: 2000, vigente_desde: '2025-03-01' },
  ];
  const todosLosDistritos = ['CTA-TPI-INT-LON LEON'];
  const regionPorDistrito = { 'CTA-TPI-INT-LON LEON': 'BAJIO' };
  const resultado = Calc.calcularIngresoMultidistritoDistrito(bolsas, [], todosLosDistritos, regionPorDistrito, 'CTA-TPI-INT-LON LEON', 'BAJIO', '2025-06-01');
  assert.strictEqual(resultado, 0);
});

test('calcularIngresosDistrito suma las 3 polizas en un solo objeto', () => {
  const datos = {
    polizaParametros: [
      { poliza: 'PLANTA INTERNA', distrito: 'CTA-TPI-INT-LON LEON', precio_por_orden: 475, ordenes_dimensionadas: 4245, vigente_desde: '2026-01-01' },
      { poliza: 'RECOLECCIONES', distrito: 'CTA-TPI-INT-LON LEON', precio_por_orden: 250, ordenes_dimensionadas: 100, vigente_desde: '2026-01-01' },
    ],
    multidistritoBolsas: [
      { region_bolsa: 'BAJIO', precio_por_orden: 613, ordenes_dimensionadas: 2000, vigente_desde: '2025-03-01' },
    ],
    hcAutorizado: [
      { distrito: 'CTA-TPI-MLT-LON MLT LEON', puesto: 'PI', personas_autorizadas: 30, vigente_desde: '2025-01-01' },
      { distrito: 'CTA-TPI-MLT-IRA MLT IRAPUATO', puesto: 'PI', personas_autorizadas: 10, vigente_desde: '2025-01-01' },
    ],
    todosLosDistritos: ['CTA-TPI-INT-LON LEON', 'CTA-TPI-INT-IRA IRAPUATO'],
    regionPorDistrito: { 'CTA-TPI-INT-LON LEON': 'BAJIO', 'CTA-TPI-INT-IRA IRAPUATO': 'BAJIO' },
  };
  const resultado = Calc.calcularIngresosDistrito(datos, 'CTA-TPI-INT-LON LEON', 'BAJIO', '2026-03-01');
  // peso LEON = 30/40 = 0.75; ordenes asignadas = 0.75 * 2000 = 1500
  assert.strictEqual(resultado.plantaInterna, 475 * 4245);
  assert.strictEqual(resultado.recolecciones, 250 * 100);
  assert.strictEqual(resultado.multidistrito, 1500 * 613);
  assert.strictEqual(resultado.total, 475 * 4245 + 250 * 100 + 1500 * 613);
});

test('clasificarIngreso asigna bucket POLIZA * y deja "otros" para el resto de categorías', () => {
  const glosarioMap = { 'CTA-TPI-INT-LON LEON': { sucursal_secundaria: 'CTA-TPI-INT-LON LEON' } };
  const poliza = Calc.clasificarIngreso({ sucursal: 'CTA-TPI-INT-LON LEON', gasto: 'POLIZA PLANTA INTERNA', subtotal: 100 }, glosarioMap);
  assert.strictEqual(poliza.bucket, 'plantaInterna');
  assert.strictEqual(poliza.sucursal_secundaria, 'CTA-TPI-INT-LON LEON');

  const otro = Calc.clasificarIngreso({ sucursal: 'CTA-TPI-INT-LON LEON', gasto: 'VENTA TECNICO', subtotal: 50 }, glosarioMap);
  assert.strictEqual(otro.bucket, 'otros');

  const sinGlosario = Calc.clasificarIngreso({ sucursal: 'CTA-TPI-MLT-LON MLT LEON', gasto: 'POLIZA MULTIDISTRITO', subtotal: 20 }, glosarioMap);
  assert.strictEqual(sinGlosario.sucursal_secundaria, null);
});

test('calcularIngresosDistrito usa el ingreso real del mes cuando existe, en vez de la fórmula', () => {
  const datos = {
    polizaParametros: [
      { poliza: 'PLANTA INTERNA', distrito: 'CTA-TPI-INT-LON LEON', precio_por_orden: 475, ordenes_dimensionadas: 4245, vigente_desde: '2026-01-01' },
    ],
    multidistritoBolsas: [],
    hcAutorizado: [],
    todosLosDistritos: ['CTA-TPI-INT-LON LEON'],
    regionPorDistrito: { 'CTA-TPI-INT-LON LEON': 'BAJIO' },
    ingresosRealesPorMes: {
      '2026-03-01': [
        { sucursal_secundaria: 'CTA-TPI-INT-LON LEON', bucket: 'plantaInterna', monto: 999 },
        { sucursal_secundaria: 'CTA-TPI-INT-LON LEON', bucket: 'otros', monto: 50 },
        { sucursal_secundaria: null, bucket: 'otros', monto: 777 }, // sucursal sin glosario, no cuenta para este distrito
      ],
    },
  };
  const resultado = Calc.calcularIngresosDistrito(datos, 'CTA-TPI-INT-LON LEON', 'BAJIO', '2026-03-01');
  assert.strictEqual(resultado.esReal, true);
  assert.strictEqual(resultado.plantaInterna, 999);
  assert.strictEqual(resultado.otros, 50);
  assert.strictEqual(resultado.total, 1049);

  // Un mes sin dato real cargado (pero con parámetro vigente) sigue usando la fórmula de siempre.
  const resultadoFormula = Calc.calcularIngresosDistrito(datos, 'CTA-TPI-INT-LON LEON', 'BAJIO', '2026-04-01');
  assert.strictEqual(resultadoFormula.esReal, false);
  assert.strictEqual(resultadoFormula.plantaInterna, 475 * 4245);
});

test('calcularIngresosGeneralMes no pierde ingreso real de sucursales sin distrito mapeado (a diferencia de sumar por distrito)', () => {
  const datos = {
    todosLosDistritos: ['CTA-TPI-INT-LON LEON'],
    regionPorDistrito: { 'CTA-TPI-INT-LON LEON': 'BAJIO' },
    ingresosRealesPorMes: {
      '2026-03-01': [
        { sucursal_secundaria: 'CTA-TPI-INT-LON LEON', bucket: 'plantaInterna', monto: 999 },
        { sucursal_secundaria: null, bucket: 'otros', monto: 777 }, // ej. sucursal "MLT" aún sin registrar en el glosario
      ],
    },
  };
  const resultado = Calc.calcularIngresosGeneralMes(datos, '2026-03-01');
  assert.strictEqual(resultado.total, 999 + 777);
  assert.strictEqual(resultado.otros, 777);
});

test('calcularRentabilidadDistritoMes calcula utilidad bruta y de operación restando costo directo y gasto operativo asignado', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'ORIENTE', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-NACIONAL': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturasDelMes = [
    { sucursal: 'DIST-A', subtotal: 300 },
    { sucursal: 'DIST-B', subtotal: 100 },
    { sucursal: 'BOLSA-NACIONAL', subtotal: 400 },
  ];
  const datosIngresos = {
    polizaParametros: [
      { poliza: 'PLANTA INTERNA', distrito: 'DIST-A', precio_por_orden: 100, ordenes_dimensionadas: 10, vigente_desde: '2026-01-01' },
    ],
    multidistritoBolsas: [],
    hcAutorizado: [],
    todosLosDistritos: ['DIST-A', 'DIST-B'],
    regionPorDistrito: { 'DIST-A': 'BAJIO', 'DIST-B': 'ORIENTE' },
  };
  // Ingreso DIST-A = 1000; Costo Directo DIST-A = 300; folios PI 1 de 2 -> 200 de la bolsa de 400
  const foliosPI = { 'DIST-A': 1, 'DIST-B': 1 };
  const resultado = Calc.calcularRentabilidadDistritoMes(facturasDelMes, datosIngresos, glosarioMap, 'DIST-A', 'BAJIO', '2026-03-01', foliosPI);
  assert.strictEqual(resultado.totalIngresos, 1000);
  assert.strictEqual(resultado.totalCD, 300);
  assert.strictEqual(resultado.totalGO, 200);
  assert.strictEqual(resultado.utilidadBruta, 700);
  assert.strictEqual(resultado.margenBruto, 70);
  assert.strictEqual(resultado.utilidadOperacion, 500);
  assert.strictEqual(resultado.margenOperacion, 50);
});

test('calcularRentabilidadDistritoMes regresa margenes null cuando no hay ingresos', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
  };
  const facturasDelMes = [{ sucursal: 'DIST-A', subtotal: 100 }];
  const datosIngresos = { polizaParametros: [], multidistritoBolsas: [], hcAutorizado: [], todosLosDistritos: ['DIST-A'], regionPorDistrito: { 'DIST-A': 'BAJIO' } };
  const resultado = Calc.calcularRentabilidadDistritoMes(facturasDelMes, datosIngresos, glosarioMap, 'DIST-A', 'BAJIO', '2026-03-01');
  assert.strictEqual(resultado.totalIngresos, 0);
  assert.strictEqual(resultado.margenBruto, null);
  assert.strictEqual(resultado.margenOperacion, null);
});

// --- Gasolina ---

test('tipoSucursalGasolina usa glosario para prefijo CTA-', () => {
  const glosarioMap = { 'CTA-TPI-INT-XAL XALAPA': { tipo_sucursal: 'DISTRITO' } };
  assert.strictEqual(Calc.tipoSucursalGasolina('CTA-TPI-INT-XAL XALAPA', glosarioMap), 'DISTRITO');
});

test('tipoSucursalGasolina cae en "Otros / Sin Clasificar" si CTA- no está en glosario', () => {
  assert.strictEqual(Calc.tipoSucursalGasolina('CTA-NUEVA-SUCURSAL', {}), 'Otros / Sin Clasificar');
});

test('tipoSucursalGasolina mapea IFR- a Infraestructura / Planta Externa', () => {
  assert.strictEqual(Calc.tipoSucursalGasolina('IFR-TPX-01', {}), 'Infraestructura / Planta Externa');
});

test('tipoSucursalGasolina mapea QRA- a Seguridad', () => {
  assert.strictEqual(Calc.tipoSucursalGasolina('QRA-QRA-COR-SEG SEGURIDAD', {}), 'Seguridad');
});

test('tipoSucursalGasolina cae en "Otros / Sin Clasificar" para prefijo desconocido o sucursal vacía', () => {
  assert.strictEqual(Calc.tipoSucursalGasolina('XYZ-ALGO', {}), 'Otros / Sin Clasificar');
  assert.strictEqual(Calc.tipoSucursalGasolina(null, {}), 'Otros / Sin Clasificar');
});

test('clasificarGasolina agrega modelo/anio/empleadoAsignado desde flotaMap y tipoSucursal', () => {
  const flotaMap = { 'ABC123': { modelo: 'NP300', anio: 2022, empleado_asignado: 'JUAN PEREZ' } };
  const glosarioMap = { 'CTA-TPI-INT-XAL XALAPA': { tipo_sucursal: 'DISTRITO' } };
  const transaccion = { placa: 'ABC123', sucursal: 'CTA-TPI-INT-XAL XALAPA', litros: 40 };
  const resultado = Calc.clasificarGasolina(transaccion, flotaMap, glosarioMap);
  assert.strictEqual(resultado.modelo, 'NP300');
  assert.strictEqual(resultado.anio, 2022);
  assert.strictEqual(resultado.empleadoAsignado, 'JUAN PEREZ');
  assert.strictEqual(resultado.tipoSucursal, 'DISTRITO');
  assert.strictEqual(resultado.litros, 40);
});

test('clasificarGasolina deja modelo/anio/empleadoAsignado en null si la placa no tiene match en flota', () => {
  const resultado = Calc.clasificarGasolina({ placa: 'ZZZ999', sucursal: 'IFR-TPX-01' }, {}, {});
  assert.strictEqual(resultado.modelo, null);
  assert.strictEqual(resultado.anio, null);
  assert.strictEqual(resultado.empleadoAsignado, null);
  assert.strictEqual(resultado.tipoSucursal, 'Infraestructura / Planta Externa');
});

test('agruparGasolinaPorSemana calcula precioPonderado como promedio simple de precio_por_litro por transacción (no por litros/monto)', () => {
  const transacciones = [
    // monto y litros deliberadamente distintos entre sí, para probar que el precio no se deriva de ahí
    { fecha: '2026-01-05', litros: 40, monto: 999, precio_por_litro: 20, placa: 'A1' }, // lunes, semana viernes 2026-01-02
    { fecha: '2026-01-07', litros: 10, monto: 50, precio_por_litro: 21, placa: 'A2' }, // miercoles, misma semana (viernes a jueves)
    { fecha: '2026-01-12', litros: 20, monto: 440, precio_por_litro: 22, placa: 'A1' }, // lunes siguiente, semana viernes 2026-01-09
  ];
  const resultado = Calc.agruparGasolinaPorSemana(transacciones);
  assert.strictEqual(resultado.length, 2);
  assert.strictEqual(resultado[0].semana, '2026-01-02');
  assert.strictEqual(resultado[0].litros, 50);
  assert.strictEqual(resultado[0].monto, 1049);
  assert.strictEqual(resultado[0].transacciones, 2);
  assert.strictEqual(resultado[0].unidades, 2);
  // (20 + 21) / 2 = 20.5 — promedio por transacción, NO ponderado por litros ni monto
  assert.strictEqual(resultado[0].precioPonderado, 20.5);
  assert.strictEqual(resultado[1].semana, '2026-01-09');
  assert.strictEqual(resultado[1].unidades, 1);
});

test('calcularExcedenteVsPromedio usa el promedio de litros de la ventana como meta', () => {
  const semanas = [{ litros: 100 }, { litros: 200 }, { litros: 300 }];
  const resultado = Calc.calcularExcedenteVsPromedio(semanas);
  assert.strictEqual(resultado.meta, 200);
  assert.strictEqual(resultado.semanas[0].excedente, -100);
  assert.strictEqual(resultado.semanas[2].excedente, 100);
});

test('calcularExcedenteVsPresupuesto prorratea el presupuesto mensual a semanal y compara contra monto', () => {
  const semanas = [{ monto: 1000 }];
  const resultado = Calc.calcularExcedenteVsPresupuesto(semanas, 4348); // ~1000/semana
  assert.ok(Math.abs(resultado.meta - 1000) < 1);
  assert.ok(Math.abs(resultado.semanas[0].excedente) < 1);
});

test('agruparGasolinaPorGrupo agrupa por tipoSucursal y cuenta placas únicas', () => {
  const transacciones = [
    { tipoSucursal: 'DISTRITO', placa: 'A1', litros: 10, monto: 200 },
    { tipoSucursal: 'DISTRITO', placa: 'A1', litros: 5, monto: 100 },
    { tipoSucursal: 'DISTRITO', placa: 'A2', litros: 20, monto: 400 },
    { tipoSucursal: 'Seguridad', placa: 'B1', litros: 8, monto: 160 },
  ];
  const resultado = Calc.agruparGasolinaPorGrupo(transacciones, 'tipoSucursal');
  const distrito = resultado.find((r) => r.clave === 'DISTRITO');
  assert.strictEqual(distrito.litros, 35);
  assert.strictEqual(distrito.monto, 700);
  assert.strictEqual(distrito.unidades, 2);
  assert.strictEqual(distrito.transacciones, 3);
});

test('agruparGasolinaPorPlaca agrupa por placa y ordena por gasto, mayor a menor', () => {
  const transacciones = [
    { placa: 'A1', litros: 10, monto: 200 },
    { placa: 'A1', litros: 10, monto: 200 },
    { placa: 'A2', litros: 10, monto: 500 },
    { placa: 'A3', litros: 10, monto: 100 },
  ];
  const resultado = Calc.agruparGasolinaPorPlaca(transacciones);
  assert.strictEqual(resultado[0].placa, 'A2');
  assert.strictEqual(resultado[0].monto, 500);
  assert.strictEqual(resultado[1].placa, 'A1');
  assert.strictEqual(resultado[1].monto, 400);
  assert.strictEqual(resultado[1].litros, 20);
  assert.strictEqual(resultado[2].placa, 'A3');
});

test('agruparGasolinaPorPlaca ordena por litros cuando ordenarPor es "litros"', () => {
  const transacciones = [
    { placa: 'A1', litros: 5, monto: 500 },
    { placa: 'A2', litros: 50, monto: 100 },
    { placa: 'A3', litros: 20, monto: 200 },
  ];
  const resultado = Calc.agruparGasolinaPorPlaca(transacciones, 'litros');
  assert.strictEqual(resultado[0].placa, 'A2');
  assert.strictEqual(resultado[1].placa, 'A3');
  assert.strictEqual(resultado[2].placa, 'A1');
});

test('agruparGasolinaPorHoraDia arma una matriz 7x24 con conteo de transacciones', () => {
  const transacciones = [
    { fecha: '2026-01-05', hora: '08:15:00' }, // lunes
    { fecha: '2026-01-05', hora: '08:45:00' }, // lunes, misma hora
    { fecha: '2026-01-11', hora: '02:00:00' }, // domingo
  ];
  const matriz = Calc.agruparGasolinaPorHoraDia(transacciones);
  assert.strictEqual(matriz.length, 7);
  assert.strictEqual(matriz[0][8], 2); // lunes=0, hora 8
  assert.strictEqual(matriz[6][2], 1); // domingo=6, hora 2
});

test('agruparGasolinaFrecuenciaPorPlaca cuenta cargas por placa y semana', () => {
  const transacciones = [
    { fecha: '2026-01-05', placa: 'A1' }, // semana viernes 2026-01-02
    { fecha: '2026-01-06', placa: 'A1' }, // misma semana
    { fecha: '2026-01-12', placa: 'A1' }, // semana viernes 2026-01-09
  ];
  const resultado = Calc.agruparGasolinaFrecuenciaPorPlaca(transacciones);
  assert.strictEqual(resultado['A1']['2026-01-02'], 2);
  assert.strictEqual(resultado['A1']['2026-01-09'], 1);
});

test('rankingGasolinerasGasolina usa precio_por_litro de Edenred (no monto/litros) y calcula variación vs promedio de flota', () => {
  const transacciones = [
    { gasolinera: 'OXXO A', litros: 10, monto: 999, precio_por_litro: 22 }, // monto no coincide con 10*22
    { gasolinera: 'PEMEX B', litros: 10, monto: 1, precio_por_litro: 18 },
  ];
  const resultado = Calc.rankingGasolinerasGasolina(transacciones);
  const oxxo = resultado.find((r) => r.gasolinera === 'OXXO A');
  assert.strictEqual(oxxo.precioPonderado, 22);
  assert.ok(oxxo.vsPromedioFlotaPct > 0); // 22 > promedio de 20
});

test('calcularMetricasPorDiaSemanaGasolina arma 7 días en orden calendario desde el viernes de esa semana', () => {
  const transacciones = [
    { fecha: '2026-08-07', litros: 10, monto: 200, precio_por_litro: 20 }, // viernes, dia 0
    { fecha: '2026-08-07', litros: 5, monto: 110, precio_por_litro: 22 }, // mismo dia, segunda transaccion
    { fecha: '2026-08-10', litros: 8, monto: 160, precio_por_litro: 20 }, // lunes, dia 3
  ];
  const dias = Calc.calcularMetricasPorDiaSemanaGasolina(transacciones, '2026-08-07');
  assert.strictEqual(dias.length, 7);
  assert.strictEqual(dias[0].fecha, '2026-08-07');
  assert.strictEqual(dias[0].transacciones, 2);
  assert.strictEqual(dias[0].litros, 15);
  assert.strictEqual(dias[0].monto, 310);
  assert.strictEqual(dias[0].precioPonderado, 21); // (20+22)/2
  assert.strictEqual(dias[1].fecha, '2026-08-08');
  assert.strictEqual(dias[1].transacciones, 0);
  assert.strictEqual(dias[1].precioPonderado, 0);
  assert.strictEqual(dias[3].fecha, '2026-08-10');
  assert.strictEqual(dias[3].transacciones, 1);
  assert.strictEqual(dias[3].litros, 8);
  assert.strictEqual(dias[6].fecha, '2026-08-13');
});
