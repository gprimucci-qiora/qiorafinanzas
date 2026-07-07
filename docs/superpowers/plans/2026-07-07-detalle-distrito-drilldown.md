# Detalle de Distrito Drill-Down Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un drill-down de distrito a la vista "Por Sucursal/Distrito": al hacer click en un distrito se abre su desglose Familia→Gasto con variaciones MoM/YoY y gráficas de tendencia de los últimos 6 meses.

**Architecture:** Dos funciones puras nuevas en `calc.js` (con tests) para la agregación y el cálculo de variación %; el resto (fetch de datos, armado de gráficas Chart.js, interacción de expandir/contraer) vive en `index.html`, siguiendo el mismo patrón que las vistas existentes.

**Tech Stack:** Igual que el resto del proyecto — vanilla JS, Chart.js, Supabase JS, `node --test` para `calc.js`.

## Global Constraints

- El mes de referencia para MoM/YoY = mes calendario que contiene `obtenerRangoActivo().fin`, sin importar el modo de filtro activo.
- Al parsear un string `'YYYY-MM-DD'` de vuelta a un objeto `Date` para extraer año/mes, usar siempre el sufijo `'T00:00:00'` (fuerza interpretación en hora local) — parsear sin ese sufijo interpreta la fecha como medianoche UTC y puede desplazar el mes en zonas horarias negativas (bug ya corregido una vez en `fechaISODesdeCelda`, no reintroducirlo).
- El gasto operativo prorrateado para el distrito se calcula con `Calc.calcularProrrateo` sobre el conjunto **completo** de facturas del mes de referencia (todos los distritos), nunca sobre un subconjunto ya filtrado por distrito — la función necesita ver todos los folios de todos los distritos para calcular la proporción correctamente.
- No se agrega esta vista al sidebar. No hay ruteo por URL en esta SPA.

**Spec de referencia:** `docs/superpowers/specs/2026-07-07-detalle-distrito-drilldown-design.md`

---

## File Structure

```
QiORAConectaGastos/
├── calc.js              # + calcularVariacionPct, agruparPorFamiliaGasto
├── calc.test.js         # + tests para ambas
└── index.html            # + vista-detalle-distrito (HTML + JS), click en distrito ya clickeable
```

---

### Task 1: `calc.js` — `calcularVariacionPct`

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.js`

**Interfaces:**
- Produces: `Calc.calcularVariacionPct(actual, anterior)` → número (porcentaje) o `null` si `anterior` es 0/falsy. Usado por Task 4 (index.html).

- [ ] **Step 1: Agregar los tests a `calc.test.js`**

```js
test('calcularVariacionPct calcula el porcentaje de variación correcto', () => {
  assert.strictEqual(Calc.calcularVariacionPct(150, 100), 50);
  assert.strictEqual(Calc.calcularVariacionPct(80, 100), -20);
});

test('calcularVariacionPct retorna null si no hay monto anterior para comparar', () => {
  assert.strictEqual(Calc.calcularVariacionPct(500, 0), null);
});
```

- [ ] **Step 2: Correr los tests y confirmar que fallan**

Run: `node --test calc.test.js`
Expected: los 2 tests nuevos fallan (`Calc.calcularVariacionPct is not a function`), los tests existentes (10) siguen pasando.

- [ ] **Step 3: Agregar la función a `calc.js`**

Agregar dentro del `factory`, antes del `return` final:

```js
  function calcularVariacionPct(actual, anterior) {
    if (!anterior) return null;
    return ((actual - anterior) / anterior) * 100;
  }
```

Y actualizar el `return`:

```js
  return {
    computeVentana,
    clasificarFactura,
    calcularProrrateo,
    calcularKPIs,
    calcularVariacionPct,
  };
```

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 12`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add calcularVariacionPct with tests"
```

---

### Task 2: `calc.js` — `agruparPorFamiliaGasto`

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.js`

**Interfaces:**
- Produces: `Calc.agruparPorFamiliaGasto(facturas)` → `{ [familia]: { total: number, porGasto: { [gasto]: number } } }`. Usado por Task 4 (index.html) para el desglose del mes de referencia, mes anterior y mismo mes año anterior.

- [ ] **Step 1: Agregar el test a `calc.test.js`**

```js
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
```

- [ ] **Step 2: Correr los tests y confirmar que falla**

Run: `node --test calc.test.js`
Expected: el test nuevo falla (`Calc.agruparPorFamiliaGasto is not a function`), los 12 anteriores siguen pasando.

- [ ] **Step 3: Agregar la función a `calc.js`**

```js
  function agruparPorFamiliaGasto(facturas) {
    const porFamilia = {};
    facturas.forEach((f) => {
      porFamilia[f.familia] = porFamilia[f.familia] || { total: 0, porGasto: {} };
      porFamilia[f.familia].total += f.monto || 0;
      porFamilia[f.familia].porGasto[f.gasto] = (porFamilia[f.familia].porGasto[f.gasto] || 0) + (f.monto || 0);
    });
    return porFamilia;
  }
```

Y actualizar el `return` para incluir `agruparPorFamiliaGasto`.

- [ ] **Step 4: Correr los tests y confirmar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 13`, `# fail 0`

- [ ] **Step 5: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add agruparPorFamiliaGasto with tests"
```

---

### Task 3: `index.html` — Vista de detalle de distrito (HTML + navegación)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: nada nuevo todavía (solo estructura + navegación).
- Produces: contenedor `#vista-detalle-distrito` con los ids `detalle-distrito-titulo`, `grafica-tendencia-distrito`, `grafica-top-familias-distrito`, `tabla-detalle-distrito-body`, `detalle-distrito-operativo` — consumidos por Task 4.

- [ ] **Step 1: Agregar la nueva vista al final de `#contenido`, después de `vista-cargar`**

```html
      <div class="vista" id="vista-detalle-distrito">
        <button onclick="mostrarVista('sucursal')" class="mb-4 flex items-center gap-1 text-sm font-gordita-bold text-on-surface-variant hover:text-primary transition-colors">
          <span class="material-symbols-outlined text-sm">arrow_back</span> Volver
        </button>
        <div class="mb-8">
          <span class="font-gordita-bold text-xs text-secondary uppercase tracking-widest">QiORA Conecta</span>
          <h1 id="detalle-distrito-titulo" class="font-gordita-bold text-4xl text-primary mt-1">-</h1>
        </div>
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-gutter mb-lg">
          <div class="bg-white p-8 border border-outline-variant rounded-xl shadow-sm">
            <h3 class="font-gordita-bold text-lg text-primary mb-6">Tendencia mensual (últimos 6 meses)</h3>
            <canvas id="grafica-tendencia-distrito" height="220"></canvas>
          </div>
          <div class="bg-white p-8 border border-outline-variant rounded-xl shadow-sm">
            <h3 class="font-gordita-bold text-lg text-primary mb-6">Top familias de gasto (últimos 6 meses)</h3>
            <canvas id="grafica-top-familias-distrito" height="220"></canvas>
          </div>
        </div>
        <section class="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <table id="tabla-detalle-distrito" class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-surface-container-low text-[10px] text-on-surface-variant border-b border-outline-variant">
                <th class="px-8 py-4 font-gordita-bold uppercase tracking-widest">Familia</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right">Monto</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right">% MoM</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right">% YoY</th>
              </tr>
            </thead>
            <tbody id="tabla-detalle-distrito-body" class="text-sm divide-y divide-outline-variant"></tbody>
          </table>
          <div id="detalle-distrito-operativo" class="px-8 py-4 bg-surface-container-low flex justify-between items-center text-sm font-gordita-bold"></div>
        </section>
      </div>
```

- [ ] **Step 2: Hacer clickeable el nombre del distrito en `renderizarSucursales`**

Reemplazar la línea del `tr.innerHTML` dentro de `renderizarSucursales` (actualmente empieza con `<td class="px-8 py-4 font-gordita-bold">${d.distrito}</td>`) por:

```js
    tr.innerHTML = `<td class="px-8 py-4 font-gordita-bold"><button onclick="abrirDetalleDistrito('${d.distrito.replace(/'/g, "\\'")}')" class="hover:underline text-left">${d.distrito}</button></td><td class="px-6 py-4 text-right">${formatoMoneda(d.costoDirecto)}</td><td class="px-6 py-4 text-right">${formatoMoneda(operativo)}</td><td class="px-6 py-4 text-right font-gordita-bold">${formatoMoneda(total)}</td>`;
```

- [ ] **Step 3: Verificación manual**

Decirle a Giacomo: "Recarga el dashboard, entra a 'Por Sucursal/Distrito' y confirma que el nombre de cada distrito ahora se ve como link. Al hacer click no pasará nada todavía (la función `abrirDetalleDistrito` se agrega en la Tarea 4) — eso es esperado en este punto."

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add district detail view shell and clickable district links"
```

---

### Task 4: `index.html` — Lógica de datos, gráficas y tabla de variaciones

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.clasificarFactura` (Task 6 del plan original), `Calc.calcularProrrateo` (Task 7), `Calc.agruparPorFamiliaGasto` (Task 2), `Calc.calcularVariacionPct` (Task 1), `obtenerFacturasEnRango`, `obtenerGlosarioMap`, `obtenerRangoActivo`, `formatoMoneda` (ya existentes en `index.html`).

- [ ] **Step 1: Agregar las funciones auxiliares de fecha y la función principal `abrirDetalleDistrito`**

Agregar al final del `<script>`, antes de la línea `cargarSesion();`:

```js
let distritoActual = null;

function mesReferenciaActivo() {
  const fin = new Date(obtenerRangoActivo().fin + 'T00:00:00');
  return { anio: fin.getFullYear(), mes: fin.getMonth() };
}

function rangoDeMes(anio, mes) {
  const primero = new Date(anio, mes, 1);
  const ultimo = new Date(anio, mes + 1, 0);
  return {
    inicio: primero.toISOString().slice(0, 10),
    fin: ultimo.toISOString().slice(0, 10),
  };
}

function claveMes(anio, mes) {
  return anio + '-' + String(mes + 1).padStart(2, '0');
}

function alternarDetalleFamiliaDistrito(familia) {
  const el = document.getElementById('detalle-distrito-' + familia.replace(/\s/g, '-'));
  el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
}

async function abrirDetalleDistrito(distrito) {
  distritoActual = distrito;
  document.getElementById('vista-sucursal').classList.remove('activa');
  document.getElementById('vista-detalle-distrito').classList.add('activa');
  document.getElementById('detalle-distrito-titulo').textContent = distrito;

  const glosarioMap = obtenerGlosarioMap();
  const { anio: anioRef, mes: mesRef } = mesReferenciaActivo();

  const inicioVentana = rangoDeMes(anioRef, mesRef - 5).inicio;
  const finVentana = rangoDeMes(anioRef, mesRef).fin;
  const facturasVentana = await obtenerFacturasEnRango(inicioVentana, finVentana, '*');

  const directasDistrito = facturasVentana
    .map((f) => Calc.clasificarFactura(f, glosarioMap))
    .filter((f) => f.tipo_gasto === 'COSTOS DIRECTOS' && f.sucursal_secundaria === distrito);

  const totalesPorMes = {};
  const clavesMeses = [];
  for (let i = 5; i >= 0; i--) {
    const base = new Date(anioRef, mesRef - i, 1);
    const clave = claveMes(base.getFullYear(), base.getMonth());
    clavesMeses.push(clave);
    totalesPorMes[clave] = 0;
  }
  directasDistrito.forEach((f) => {
    const clave = f.fecha_pago.slice(0, 7);
    if (clave in totalesPorMes) totalesPorMes[clave] += f.monto || 0;
  });

  const ctxTendencia = document.getElementById('grafica-tendencia-distrito');
  if (window.graficaTendenciaDistrito) window.graficaTendenciaDistrito.destroy();
  window.graficaTendenciaDistrito = new Chart(ctxTendencia, {
    type: 'bar',
    data: {
      labels: clavesMeses,
      datasets: [{ label: 'Gasto total', data: clavesMeses.map((c) => totalesPorMes[c]), backgroundColor: '#2DD4BF' }],
    },
    options: { plugins: { legend: { display: false } } },
  });

  const porFamiliaVentana = Calc.agruparPorFamiliaGasto(directasDistrito);
  const familiasOrdenadas = Object.keys(porFamiliaVentana).sort((a, b) => porFamiliaVentana[b].total - porFamiliaVentana[a].total);
  const topFamilias = familiasOrdenadas.slice(0, 5);
  const otrosTotal = familiasOrdenadas.slice(5).reduce((s, f) => s + porFamiliaVentana[f].total, 0);
  const labelsTop = topFamilias.concat(otrosTotal > 0 ? ['Otros'] : []);
  const datosTop = topFamilias.map((f) => porFamiliaVentana[f].total).concat(otrosTotal > 0 ? [otrosTotal] : []);

  const ctxTop = document.getElementById('grafica-top-familias-distrito');
  if (window.graficaTopFamiliasDistrito) window.graficaTopFamiliasDistrito.destroy();
  window.graficaTopFamiliasDistrito = new Chart(ctxTop, {
    type: 'bar',
    data: { labels: labelsTop, datasets: [{ label: 'Monto', data: datosTop, backgroundColor: '#000000' }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } } },
  });

  const rangoMesRef = rangoDeMes(anioRef, mesRef);
  const rangoMesAnt = rangoDeMes(anioRef, mesRef - 1);
  const rangoMesAnioAnt = rangoDeMes(anioRef - 1, mesRef);

  const facturasMesAnioAnt = await obtenerFacturasEnRango(rangoMesAnioAnt.inicio, rangoMesAnioAnt.fin, '*');
  const directasMesAnioAnt = facturasMesAnioAnt
    .map((f) => Calc.clasificarFactura(f, glosarioMap))
    .filter((f) => f.tipo_gasto === 'COSTOS DIRECTOS' && f.sucursal_secundaria === distrito);

  const directasMesRef = directasDistrito.filter((f) => f.fecha_pago >= rangoMesRef.inicio && f.fecha_pago <= rangoMesRef.fin);
  const directasMesAnt = directasDistrito.filter((f) => f.fecha_pago >= rangoMesAnt.inicio && f.fecha_pago <= rangoMesAnt.fin);

  const porFamiliaMesRef = Calc.agruparPorFamiliaGasto(directasMesRef);
  const porFamiliaMesAnt = Calc.agruparPorFamiliaGasto(directasMesAnt);
  const porFamiliaMesAnioAnt = Calc.agruparPorFamiliaGasto(directasMesAnioAnt);

  const cuerpo = document.getElementById('tabla-detalle-distrito-body');
  cuerpo.innerHTML = '';
  Object.keys(porFamiliaMesRef).sort((a, b) => porFamiliaMesRef[b].total - porFamiliaMesRef[a].total).forEach((familia) => {
    const montoActual = porFamiliaMesRef[familia].total;
    const montoAnt = (porFamiliaMesAnt[familia] && porFamiliaMesAnt[familia].total) || 0;
    const montoAnioAnt = (porFamiliaMesAnioAnt[familia] && porFamiliaMesAnioAnt[familia].total) || 0;
    const mom = Calc.calcularVariacionPct(montoActual, montoAnt);
    const yoy = Calc.calcularVariacionPct(montoActual, montoAnioAnt);
    const claseColor = (v) => (v === null ? '' : (v >= 0 ? 'text-error' : 'text-qiora-green'));
    const textoVar = (v) => (v === null ? '—' : (v >= 0 ? '+' : '') + v.toFixed(1) + '%');

    const filaFamilia = document.createElement('tr');
    filaFamilia.className = 'cursor-pointer hover:bg-surface-container-low/50 transition-colors';
    filaFamilia.innerHTML = `<td class="px-8 py-4 font-gordita-bold flex items-center gap-2"><span class="material-symbols-outlined text-sm">chevron_right</span>${familia}</td><td class="px-6 py-4 text-right font-gordita-bold">${formatoMoneda(montoActual)}</td><td class="px-6 py-4 text-right ${claseColor(mom)}">${textoVar(mom)}</td><td class="px-6 py-4 text-right ${claseColor(yoy)}">${textoVar(yoy)}</td>`;
    filaFamilia.onclick = () => alternarDetalleFamiliaDistrito(familia);
    cuerpo.appendChild(filaFamilia);

    const filaDetalle = document.createElement('tr');
    filaDetalle.id = 'detalle-distrito-' + familia.replace(/\s/g, '-');
    filaDetalle.className = 'bg-surface-container-low/50';
    filaDetalle.style.display = 'none';
    const subfilas = Object.keys(porFamiliaMesRef[familia].porGasto)
      .sort((a, b) => porFamiliaMesRef[familia].porGasto[b] - porFamiliaMesRef[familia].porGasto[a])
      .map((gasto) => `<div class="flex justify-between py-1 text-xs text-on-surface-variant"><span>${gasto}</span><span class="font-gordita-bold">${formatoMoneda(porFamiliaMesRef[familia].porGasto[gasto])}</span></div>`)
      .join('');
    filaDetalle.innerHTML = `<td colspan="4" class="px-8 py-4">${subfilas}</td>`;
    cuerpo.appendChild(filaDetalle);
  });

  const facturasMesRefTodas = facturasVentana.filter((f) => f.fecha_pago >= rangoMesRef.inicio && f.fecha_pago <= rangoMesRef.fin);
  const prorrateoMesRef = Calc.calcularProrrateo(facturasMesRefTodas, glosarioMap);
  const entradaDistrito = prorrateoMesRef.distritos.find((d) => d.distrito === distrito);
  const operativoAsignado = entradaDistrito ? entradaDistrito.gastoOperativoAsignado : 0;
  document.getElementById('detalle-distrito-operativo').innerHTML = `<span>Gasto Operativo Asignado (${claveMes(anioRef, mesRef)})</span><span>${formatoMoneda(operativoAsignado)}</span>`;
}
```

- [ ] **Step 2: Verificar sintaxis**

Extraer el contenido del `<script>` a un archivo temporal y correr `node --check` sobre él; confirmar que no hay errores de sintaxis, luego borrar el archivo temporal.

- [ ] **Step 3: Verificación manual**

Decirle a Giacomo: "Recarga el dashboard, entra a 'Por Sucursal/Distrito', haz click en un distrito con datos (ej. León) y confirma: (1) las dos gráficas muestran datos de los últimos 6 meses, (2) la tabla de Familia→Gasto muestra montos con % MoM y % YoY (o '—' donde no haya mes comparable), (3) el renglón de 'Gasto Operativo Asignado' al final tiene un número coherente con lo que ya viste en la vista 'Por Sucursal/Distrito' en modo Prorrateado, (4) el botón 'Volver' regresa a la tabla de distritos."

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add district drill-down data logic: 6-month trend, top familias, MoM/YoY breakdown table, operating expense allocation"
```
