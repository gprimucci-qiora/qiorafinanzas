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

  function clasificarFactura(factura, glosarioMap) {
    const entrada = glosarioMap[factura.sucursal];
    if (!entrada) {
      return Object.assign({}, factura, {
        monto: factura.subtotal,
        tipo_gasto: 'SIN_CLASIFICAR',
        region: null,
        sucursal_secundaria: null,
      });
    }
    return Object.assign({}, factura, {
      monto: factura.subtotal,
      tipo_gasto: entrada.tipo_gasto,
      region: entrada.region,
      sucursal_secundaria: entrada.sucursal_secundaria,
    });
  }

  function calcularProrrateo(facturas, glosarioMap) {
    const distritos = new Set();
    const costoDirecto = {};
    const folios = {};
    const bolsas = {};

    for (const raw of facturas) {
      const f = clasificarFactura(raw, glosarioMap);
      if (f.tipo_gasto === 'COSTOS DIRECTOS') {
        const distrito = f.sucursal_secundaria;
        distritos.add(distrito);
        costoDirecto[distrito] = (costoDirecto[distrito] || 0) + (f.monto || 0);
        folios[distrito] = (folios[distrito] || 0) + 1;
      } else if (f.tipo_gasto === 'GASTOS OPERATIVOS') {
        const entrada = glosarioMap[f.sucursal];
        const region = entrada ? entrada.region : null;
        bolsas[f.sucursal] = bolsas[f.sucursal] || { monto: 0, region };
        bolsas[f.sucursal].monto += (f.monto || 0);
      }
      // SIN_CLASIFICAR no participa del prorrateo; se reporta aparte (Task 15)
    }

    const distritoList = Array.from(distritos);
    const gastoOperativoAsignado = {};
    for (const d of distritoList) gastoOperativoAsignado[d] = 0;

    for (const sucursalBolsa in bolsas) {
      const bolsa = bolsas[sucursalBolsa];
      const esNacional = !bolsa.region || bolsa.region === 'NACIONAL';
      const scope = esNacional
        ? distritoList
        : distritoList.filter((d) => glosarioMap[d] && glosarioMap[d].region === bolsa.region);
      const totalFoliosScope = scope.reduce((sum, d) => sum + (folios[d] || 0), 0);
      if (totalFoliosScope === 0) continue;
      for (const d of scope) {
        gastoOperativoAsignado[d] += bolsa.monto * ((folios[d] || 0) / totalFoliosScope);
      }
    }

    const gastoOperativoBolsaTotal = Object.values(bolsas).reduce((sum, b) => sum + b.monto, 0);

    return {
      distritos: distritoList.map((d) => ({
        distrito: d,
        costoDirecto: costoDirecto[d] || 0,
        folios: folios[d] || 0,
        gastoOperativoAsignado: gastoOperativoAsignado[d],
        totalProrrateado: (costoDirecto[d] || 0) + gastoOperativoAsignado[d],
      })),
      gastoOperativoBolsaTotal,
      bolsas,
    };
  }

  function calcularKPIs(facturas, glosarioMap) {
    let totalPagado = 0;
    let costoDirecto = 0;
    let gastoOperativo = 0;
    let sinClasificar = 0;

    for (const raw of facturas) {
      const f = clasificarFactura(raw, glosarioMap);
      const monto = f.monto || 0;
      totalPagado += monto;
      if (f.tipo_gasto === 'COSTOS DIRECTOS') costoDirecto += monto;
      else if (f.tipo_gasto === 'GASTOS OPERATIVOS') gastoOperativo += monto;
      else sinClasificar += monto;
    }

    return { totalPagado, costoDirecto, gastoOperativo, sinClasificar };
  }

  function calcularVariacionPct(actual, anterior) {
    if (!anterior) return null;
    return ((actual - anterior) / anterior) * 100;
  }

  function agruparPorFamiliaGasto(facturas) {
    const porFamilia = {};
    facturas.forEach((f) => {
      porFamilia[f.familia] = porFamilia[f.familia] || { total: 0, porGasto: {} };
      porFamilia[f.familia].total += f.monto || 0;
      porFamilia[f.familia].porGasto[f.gasto] = (porFamilia[f.familia].porGasto[f.gasto] || 0) + (f.monto || 0);
    });
    return porFamilia;
  }

  function obtenerParametroVigente(registros, mesISO) {
    const candidatos = registros.filter((r) => r.vigente_desde <= mesISO);
    if (candidatos.length === 0) return null;
    return candidatos.reduce((mejor, r) => (r.vigente_desde > mejor.vigente_desde ? r : mejor));
  }

  function bolsaMultidistritoDeRegion(region) {
    if (region === 'GUADALAJARA') return 'OCCIDENTE';
    if (region === 'NORTE') return null;
    return region;
  }

  function obtenerRegionPorDistrito(glosarioMap) {
    const mapa = {};
    Object.values(glosarioMap).forEach((entrada) => {
      if (entrada.sucursal_secundaria && !mapa[entrada.sucursal_secundaria]) {
        mapa[entrada.sucursal_secundaria] = entrada.region;
      }
    });
    return mapa;
  }

  function calcularIngresoPolizaDistrito(polizaParametros, poliza, distrito, mesISO) {
    const candidatos = polizaParametros.filter((p) => p.poliza === poliza && p.distrito === distrito);
    const vigente = obtenerParametroVigente(candidatos, mesISO);
    if (!vigente) return 0;
    return vigente.precio_por_orden * vigente.ordenes_dimensionadas;
  }

  function calcularIngresoMultidistritoDistrito(asignaciones, bolsas, distrito, region, mesISO) {
    const regionBolsa = bolsaMultidistritoDeRegion(region);
    if (!regionBolsa) return 0;
    const vigenteAsignacion = obtenerParametroVigente(
      asignaciones.filter((a) => a.distrito === distrito),
      mesISO,
    );
    if (!vigenteAsignacion) return 0;
    const vigenteBolsa = obtenerParametroVigente(
      bolsas.filter((b) => b.region_bolsa === regionBolsa),
      mesISO,
    );
    if (!vigenteBolsa) return 0;
    return vigenteAsignacion.ordenes_asignadas * vigenteBolsa.precio_por_orden;
  }

  function calcularIngresosDistrito(datos, distrito, region, mesISO) {
    const plantaInterna = calcularIngresoPolizaDistrito(datos.polizaParametros, 'PLANTA INTERNA', distrito, mesISO);
    const recolecciones = calcularIngresoPolizaDistrito(datos.polizaParametros, 'RECOLECCIONES', distrito, mesISO);
    const multidistrito = calcularIngresoMultidistritoDistrito(
      datos.multidistritoAsignacion,
      datos.multidistritoBolsas,
      distrito,
      region,
      mesISO,
    );
    return {
      plantaInterna,
      recolecciones,
      multidistrito,
      total: plantaInterna + recolecciones + multidistrito,
    };
  }

  return {
    computeVentana,
    clasificarFactura,
    calcularProrrateo,
    calcularKPIs,
    calcularVariacionPct,
    agruparPorFamiliaGasto,
    obtenerParametroVigente,
    bolsaMultidistritoDeRegion,
    obtenerRegionPorDistrito,
    calcularIngresoPolizaDistrito,
    calcularIngresoMultidistritoDistrito,
    calcularIngresosDistrito,
  };
});
