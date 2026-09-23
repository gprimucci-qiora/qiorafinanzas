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

  // Guadalajara es su propia "región" en el glosario solo por el tamaño del distrito, pero para
  // efectos de bolsas de Gasto Operativo regionales, Occidente ya le da servicio — se tratan como
  // la misma región (a diferencia de bolsaMultidistritoDeRegion, aquí no hay caso especial para NORTE).
  function regionGastoOperativo(region) {
    return region === 'GUADALAJARA' ? 'OCCIDENTE' : region;
  }

  function calcularProrrateo(facturas, glosarioMap, foliosPlantaInternaPorDistrito) {
    const folios = foliosPlantaInternaPorDistrito || {};
    const distritos = new Set();
    const costoDirecto = {};
    const bolsas = {};

    for (const raw of facturas) {
      const f = clasificarFactura(raw, glosarioMap);
      if (f.tipo_gasto === 'COSTOS DIRECTOS') {
        const distrito = f.sucursal_secundaria;
        distritos.add(distrito);
        costoDirecto[distrito] = (costoDirecto[distrito] || 0) + (f.monto || 0);
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
      const regionBolsa = regionGastoOperativo(bolsa.region);
      const esNacional = !regionBolsa || regionBolsa === 'NACIONAL';
      const scope = esNacional
        ? distritoList
        : distritoList.filter((d) => glosarioMap[d] && regionGastoOperativo(glosarioMap[d].region) === regionBolsa);
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
      if (f.tipo_gasto === 'EXCLUIDO') continue;
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

  // Convierte 'CTA-TPI-INT-CBA CORDOBA ORIZABA' -> 'CBA'. Las 4 sucursales de Guadalajara
  // (GBA/GES/GLM/GPR) comparten una sola sucursal MLT ('GDL') en el Excel de HC Autorizado,
  // por lo que su cuadrilla se reparte entre las 4 en partes iguales.
  function obtenerCuadrillasMultidistrito(hcAutorizado, distrito, mesISO) {
    const match = distrito.match(/^CTA-TPI-INT-([A-Z]+)\s/);
    if (!match) return 0;
    const codigo = match[1];
    const esGuadalajara = codigo === 'GBA' || codigo === 'GES' || codigo === 'GLM' || codigo === 'GPR';
    const codigoMLT = esGuadalajara ? 'GDL' : codigo;
    const factorReparto = esGuadalajara ? 0.25 : 1;

    const prefijoMLT = 'CTA-TPI-MLT-' + codigoMLT + ' ';
    const filaEjemplo = hcAutorizado.find((h) => h.distrito.indexOf(prefijoMLT) === 0);
    if (!filaEjemplo) return 0;

    const filasVigentes = hcAutorizado.filter((h) => h.distrito === filaEjemplo.distrito && h.vigente_desde <= mesISO);
    const porPuesto = {};
    filasVigentes.forEach((h) => {
      if (!porPuesto[h.puesto] || h.vigente_desde > porPuesto[h.puesto].vigente_desde) porPuesto[h.puesto] = h;
    });
    const total = Object.values(porPuesto).reduce((s, h) => s + (h.personas_autorizadas || 0), 0);
    return total * factorReparto;
  }

  function calcularIngresoMultidistritoDistrito(bolsas, hcAutorizado, todosLosDistritos, regionPorDistrito, distrito, region, mesISO) {
    const regionBolsa = bolsaMultidistritoDeRegion(region);
    if (!regionBolsa) return 0;
    const vigenteBolsa = obtenerParametroVigente(
      bolsas.filter((b) => b.region_bolsa === regionBolsa),
      mesISO,
    );
    if (!vigenteBolsa) return 0;

    const distritosBolsa = todosLosDistritos.filter((d) => bolsaMultidistritoDeRegion(regionPorDistrito[d]) === regionBolsa);
    let totalCuadrillas = 0;
    let cuadrillasDistrito = 0;
    distritosBolsa.forEach((d) => {
      const cuadrillas = obtenerCuadrillasMultidistrito(hcAutorizado, d, mesISO);
      totalCuadrillas += cuadrillas;
      if (d === distrito) cuadrillasDistrito = cuadrillas;
    });
    if (totalCuadrillas === 0) return 0;

    const peso = cuadrillasDistrito / totalCuadrillas;
    const ordenesAsignadas = peso * vigenteBolsa.ordenes_dimensionadas;
    return ordenesAsignadas * vigenteBolsa.precio_por_orden;
  }

  // El Excel "REPORTE DE INGRESOS" de Siva reutiliza el machote de columnas de gastos:
  // la columna "GASTO" es en realidad la categoría de ingreso. Las 3 categorías POLIZA *
  // que sí tienen equivalente en el cálculo por fórmula (folios × precio) sustituyen a ese
  // cálculo cuando hay dato real cargado ese mes; todo lo demás (POLIZA DESTAJO, POLIZA
  // VENTA UNIDADES, VENTA TECNICO, APOYO VIATICOS, TALLERES Y SINIESTROS, etc.) es ingreso
  // real que la fórmula nunca capturó, y se suma aparte como "otros".
  const CATEGORIAS_INGRESO_POLIZA = {
    'POLIZA PLANTA INTERNA': 'plantaInterna',
    'POLIZA RECOLECCIONES': 'recolecciones',
    'POLIZA MULTIDISTRITO': 'multidistrito',
  };

  function clasificarIngreso(ingreso, glosarioMap) {
    const entrada = glosarioMap[ingreso.sucursal];
    return Object.assign({}, ingreso, {
      monto: ingreso.subtotal,
      bucket: CATEGORIAS_INGRESO_POLIZA[ingreso.gasto] || 'otros',
      sucursal_secundaria: entrada ? entrada.sucursal_secundaria : null,
    });
  }

  function agruparIngresosPorBucket(ingresosClasificados) {
    const r = { plantaInterna: 0, recolecciones: 0, multidistrito: 0, otros: 0 };
    ingresosClasificados.forEach((i) => { r[i.bucket] = (r[i.bucket] || 0) + (i.monto || 0); });
    return Object.assign(r, { total: r.plantaInterna + r.recolecciones + r.multidistrito + r.otros });
  }

  // datos.ingresosRealesPorMes, si viene, es un mapa { mesISO: [ingresos clasificados] } con el
  // ingreso real facturado (tabla "ingresos") de TODA la compañía ese mes. Cuando existe para el
  // mes pedido se usa como fuente de verdad (reemplaza la fórmula); si no hay dato real cargado
  // para ese mes (fuera del rango del Excel subido), se sigue calculando por fórmula como antes.
  function calcularIngresosDistrito(datos, distrito, region, mesISO) {
    const ingresosRealesDelMes = datos.ingresosRealesPorMes && datos.ingresosRealesPorMes[mesISO];
    if (ingresosRealesDelMes) {
      const delDistrito = ingresosRealesDelMes.filter((i) => i.sucursal_secundaria === distrito);
      const r = agruparIngresosPorBucket(delDistrito);
      return {
        plantaInterna: r.plantaInterna,
        recolecciones: r.recolecciones,
        multidistrito: r.multidistrito,
        otros: r.otros,
        total: r.total,
        esReal: true,
      };
    }
    const plantaInterna = calcularIngresoPolizaDistrito(datos.polizaParametros, 'PLANTA INTERNA', distrito, mesISO);
    const recolecciones = calcularIngresoPolizaDistrito(datos.polizaParametros, 'RECOLECCIONES', distrito, mesISO);
    const multidistrito = calcularIngresoMultidistritoDistrito(
      datos.multidistritoBolsas,
      datos.hcAutorizado,
      datos.todosLosDistritos,
      datos.regionPorDistrito,
      distrito,
      region,
      mesISO,
    );
    return {
      plantaInterna,
      recolecciones,
      multidistrito,
      otros: 0,
      total: plantaInterna + recolecciones + multidistrito,
      esReal: false,
    };
  }

  // Total de compañía de un mes. No se puede obtener sumando calcularIngresosDistrito() sobre
  // todosLosDistritos cuando hay datos reales, porque algunos ingresos reales quedan en
  // sucursales que el glosario todavía no mapea a un distrito real (p.ej. "MLT" o cuentas
  // corporativas sin registrar) — sumarlos por distrito los perdería. Con dato real se suman
  // TODOS los renglones de la tabla "ingresos" del mes, sin filtrar por distrito.
  function calcularIngresosGeneralMes(datos, mesISO) {
    const ingresosRealesDelMes = datos.ingresosRealesPorMes && datos.ingresosRealesPorMes[mesISO];
    if (ingresosRealesDelMes) {
      const r = agruparIngresosPorBucket(ingresosRealesDelMes);
      return {
        plantaInterna: r.plantaInterna,
        recolecciones: r.recolecciones,
        multidistrito: r.multidistrito,
        otros: r.otros,
        total: r.total,
        esReal: true,
      };
    }
    let plantaInterna = 0;
    let recolecciones = 0;
    let multidistrito = 0;
    (datos.todosLosDistritos || []).forEach((distrito) => {
      const region = datos.regionPorDistrito[distrito];
      const r = calcularIngresosDistrito(datos, distrito, region, mesISO);
      plantaInterna += r.plantaInterna;
      recolecciones += r.recolecciones;
      multidistrito += r.multidistrito;
    });
    return {
      plantaInterna,
      recolecciones,
      multidistrito,
      otros: 0,
      total: plantaInterna + recolecciones + multidistrito,
      esReal: false,
    };
  }

  function calcularRentabilidadDistritoMes(facturasDelMes, datosIngresos, glosarioMap, distrito, region, mesISO, foliosPlantaInternaPorDistrito) {
    const clasificadas = facturasDelMes.map((f) => clasificarFactura(f, glosarioMap));
    const totalCD = clasificadas
      .filter((f) => f.tipo_gasto === 'COSTOS DIRECTOS' && f.sucursal_secundaria === distrito)
      .reduce((s, f) => s + (f.monto || 0), 0);

    const prorrateo = calcularProrrateo(facturasDelMes, glosarioMap, foliosPlantaInternaPorDistrito);
    const entradaProrrateo = prorrateo.distritos.find((d) => d.distrito === distrito);
    const totalGO = entradaProrrateo ? entradaProrrateo.gastoOperativoAsignado : 0;

    const ingresos = calcularIngresosDistrito(datosIngresos, distrito, region, mesISO);
    const totalIngresos = ingresos.total;

    const utilidadBruta = totalIngresos - totalCD;
    const margenBruto = totalIngresos > 0 ? (utilidadBruta / totalIngresos) * 100 : null;
    const utilidadOperacion = utilidadBruta - totalGO;
    const margenOperacion = totalIngresos > 0 ? (utilidadOperacion / totalIngresos) * 100 : null;

    return {
      ingresoPlantaInterna: ingresos.plantaInterna,
      ingresoRecolecciones: ingresos.recolecciones,
      ingresoMultidistrito: ingresos.multidistrito,
      ingresoOtros: ingresos.otros,
      totalIngresos,
      totalCD,
      totalGO,
      utilidadBruta,
      margenBruto,
      utilidadOperacion,
      margenOperacion,
    };
  }

  // --- Gasolina (transacciones Edenred) ---

  // Tipo de Sucursal se deriva del prefijo de la Sucursal que ya trae la transacción de
  // Edenred, NO de flota_vehicular.tipo_poliza (45% nulo). Ver spec §5.
  const PREFIJOS_TIPO_SUCURSAL_GASOLINA = [
    { prefijo: 'IFR-', tipo: 'Infraestructura / Planta Externa' },
    { prefijo: 'QRA-', tipo: 'Seguridad' },
  ];

  function tipoSucursalGasolina(sucursal, glosarioMap) {
    if (!sucursal) return 'Otros / Sin Clasificar';
    if (sucursal.indexOf('CTA-') === 0) {
      const entrada = glosarioMap[sucursal];
      return entrada && entrada.tipo_sucursal ? entrada.tipo_sucursal : 'Otros / Sin Clasificar';
    }
    const match = PREFIJOS_TIPO_SUCURSAL_GASOLINA.find((p) => sucursal.indexOf(p.prefijo) === 0);
    return match ? match.tipo : 'Otros / Sin Clasificar';
  }

  // Modelo/Año vienen de flota_vehicular (cruce por Placa); si la placa no tiene match,
  // quedan null y la transacción se reporta bajo "Sin Match" en vez de perderse silenciosamente.
  function clasificarGasolina(transaccion, flotaMap, glosarioMap) {
    const vehiculo = flotaMap[transaccion.placa];
    return Object.assign({}, transaccion, {
      modelo: vehiculo ? vehiculo.modelo : null,
      anio: vehiculo ? vehiculo.anio : null,
      tipoSucursal: tipoSucursalGasolina(transaccion.sucursal, glosarioMap),
    });
  }

  function inicioSemanaGasolina(fechaISO) {
    const d = new Date(fechaISO + 'T00:00:00');
    const diaJs = d.getDay(); // 0=domingo..6=sábado
    const diff = diaJs === 0 ? -6 : 1 - diaJs;
    d.setDate(d.getDate() + diff);
    return toISODate(d);
  }

  // precioPonderado usa el precio_por_litro que ya manda Edenred por transacción (ponderado por
  // litros), NO monto/litros — el monto puede incluir cargos que no son estrictamente $/L, así
  // que se respeta el precio que Edenred ya calculó en vez de recalcularlo.
  function agruparGasolinaPorSemana(transacciones) {
    const porSemana = {};
    transacciones.forEach((t) => {
      if (!t.fecha) return;
      const semana = inicioSemanaGasolina(t.fecha);
      const s = porSemana[semana] = porSemana[semana] || { semana, litros: 0, monto: 0, transacciones: 0, sumaPrecioPorLitros: 0 };
      s.litros += t.litros || 0;
      s.monto += t.monto || 0;
      s.transacciones += 1;
      s.sumaPrecioPorLitros += (t.precio_por_litro || 0) * (t.litros || 0);
    });
    return Object.values(porSemana)
      .map((s) => ({
        semana: s.semana,
        litros: s.litros,
        monto: s.monto,
        transacciones: s.transacciones,
        precioPonderado: s.litros > 0 ? s.sumaPrecioPorLitros / s.litros : 0,
      }))
      .sort((a, b) => (a.semana < b.semana ? -1 : a.semana > b.semana ? 1 : 0));
  }

  // Meta = promedio móvil de litros sobre la ventana visible (recalcula si cambia la ventana).
  function calcularExcedenteVsPromedio(semanas) {
    if (!semanas.length) return { meta: 0, semanas: [] };
    const meta = semanas.reduce((s, w) => s + w.litros, 0) / semanas.length;
    return { meta, semanas: semanas.map((w) => Object.assign({}, w, { excedente: w.litros - meta })) };
  }

  // Prorrateo mensual->semanal del presupuesto (familia "GASOLINA"). Compara contra el gasto
  // ($ monto) de la semana, no litros, porque el presupuesto está en dinero.
  const SEMANAS_POR_MES_GASOLINA = 30.4368 / 7; // ~4.348, mismo criterio que otros prorrateos mensuales de la app

  function calcularExcedenteVsPresupuesto(semanas, presupuestoMensual) {
    const meta = (presupuestoMensual || 0) / SEMANAS_POR_MES_GASOLINA;
    return { meta, semanas: semanas.map((w) => Object.assign({}, w, { excedente: w.monto - meta })) };
  }

  // Agrupa transacciones ya clasificadas (con tipoSucursal) por un campo dado (tipoSucursal o
  // sucursal), para los niveles 2 y 3 del drill-down.
  function agruparGasolinaPorGrupo(transaccionesClasificadas, campo) {
    const grupos = {};
    transaccionesClasificadas.forEach((t) => {
      const clave = t[campo] || 'Sin Clasificar';
      grupos[clave] = grupos[clave] || { clave, litros: 0, monto: 0, transacciones: 0, placas: new Set(), sumaPrecioPorLitros: 0 };
      grupos[clave].litros += t.litros || 0;
      grupos[clave].monto += t.monto || 0;
      grupos[clave].transacciones += 1;
      grupos[clave].sumaPrecioPorLitros += (t.precio_por_litro || 0) * (t.litros || 0);
      if (t.placa) grupos[clave].placas.add(t.placa);
    });
    return Object.values(grupos)
      .map((g) => ({
        clave: g.clave,
        litros: g.litros,
        monto: g.monto,
        transacciones: g.transacciones,
        unidades: g.placas.size,
        precioPonderado: g.litros > 0 ? g.sumaPrecioPorLitros / g.litros : 0,
      }))
      .sort((a, b) => b.monto - a.monto);
  }

  // Agrupa por Placa. ordenarPor: 'monto' (default, usado en el nivel 4 del drill-down) o
  // 'litros' (usado en el ranking nacional "Placas que Más Consumen"). La desviación de
  // rendimiento que manda Edenred no se usa — los valores observados en datos reales son
  // atípicos/poco fiables (ej. -62024%), así que v1 no la considera para ordenar ni resaltar.
  function agruparGasolinaPorPlaca(transaccionesClasificadas, ordenarPor) {
    const porPlaca = {};
    transaccionesClasificadas.forEach((t) => {
      porPlaca[t.placa] = porPlaca[t.placa] || {
        placa: t.placa, modelo: t.modelo, anio: t.anio, sucursal: t.sucursal,
        litros: 0, monto: 0, transacciones: 0,
      };
      const p = porPlaca[t.placa];
      p.litros += t.litros || 0;
      p.monto += t.monto || 0;
      p.transacciones += 1;
    });
    const campo = ordenarPor === 'litros' ? 'litros' : 'monto';
    return Object.values(porPlaca).sort((a, b) => b[campo] - a[campo]);
  }

  // Matriz [día 0=lunes..6=domingo][hora 0-23] = # de transacciones, para el heatmap de patrón.
  function agruparGasolinaPorHoraDia(transacciones) {
    const matriz = Array.from({ length: 7 }, () => Array(24).fill(0));
    transacciones.forEach((t) => {
      if (!t.fecha || !t.hora) return;
      const diaJs = new Date(t.fecha + 'T00:00:00').getDay();
      const dia = diaJs === 0 ? 6 : diaJs - 1;
      const hora = parseInt(String(t.hora).split(':')[0], 10);
      if (Number.isNaN(hora) || hora < 0 || hora > 23) return;
      matriz[dia][hora] += 1;
    });
    return matriz;
  }

  // { placa: { semanaISO: conteo } } — para el mini-heatmap de frecuencia de cargas por placa.
  function agruparGasolinaFrecuenciaPorPlaca(transacciones) {
    const porPlacaSemana = {};
    transacciones.forEach((t) => {
      if (!t.fecha || !t.placa) return;
      const semana = inicioSemanaGasolina(t.fecha);
      porPlacaSemana[t.placa] = porPlacaSemana[t.placa] || {};
      porPlacaSemana[t.placa][semana] = (porPlacaSemana[t.placa][semana] || 0) + 1;
    });
    return porPlacaSemana;
  }

  function rankingGasolinerasGasolina(transacciones) {
    const porGasolinera = {};
    let litrosTotales = 0;
    let sumaPrecioPorLitrosTotal = 0;
    transacciones.forEach((t) => {
      if (!t.gasolinera) return;
      const g = porGasolinera[t.gasolinera] = porGasolinera[t.gasolinera] || { gasolinera: t.gasolinera, litros: 0, monto: 0, transacciones: 0, sumaPrecioPorLitros: 0 };
      g.litros += t.litros || 0;
      g.monto += t.monto || 0;
      g.transacciones += 1;
      const aporte = (t.precio_por_litro || 0) * (t.litros || 0);
      g.sumaPrecioPorLitros += aporte;
      litrosTotales += t.litros || 0;
      sumaPrecioPorLitrosTotal += aporte;
    });
    const precioPromedioFlota = litrosTotales > 0 ? sumaPrecioPorLitrosTotal / litrosTotales : 0;
    return Object.values(porGasolinera)
      .map((g) => {
        const precioPonderado = g.litros > 0 ? g.sumaPrecioPorLitros / g.litros : 0;
        return {
          gasolinera: g.gasolinera,
          litros: g.litros,
          monto: g.monto,
          transacciones: g.transacciones,
          precioPonderado,
          vsPromedioFlotaPct: precioPromedioFlota > 0 ? ((precioPonderado - precioPromedioFlota) / precioPromedioFlota) * 100 : null,
        };
      })
      .sort((a, b) => b.transacciones - a.transacciones);
  }

  return {
    computeVentana,
    clasificarFactura,
    calcularProrrateo,
    regionGastoOperativo,
    calcularKPIs,
    calcularVariacionPct,
    agruparPorFamiliaGasto,
    obtenerParametroVigente,
    bolsaMultidistritoDeRegion,
    obtenerRegionPorDistrito,
    calcularIngresoPolizaDistrito,
    obtenerCuadrillasMultidistrito,
    calcularIngresoMultidistritoDistrito,
    calcularIngresosDistrito,
    calcularIngresosGeneralMes,
    calcularRentabilidadDistritoMes,
    clasificarIngreso,
    agruparIngresosPorBucket,
    tipoSucursalGasolina,
    clasificarGasolina,
    inicioSemanaGasolina,
    agruparGasolinaPorSemana,
    calcularExcedenteVsPromedio,
    calcularExcedenteVsPresupuesto,
    agruparGasolinaPorGrupo,
    agruparGasolinaPorPlaca,
    agruparGasolinaPorHoraDia,
    agruparGasolinaFrecuenciaPorPlaca,
    rankingGasolinerasGasolina,
  };
});
