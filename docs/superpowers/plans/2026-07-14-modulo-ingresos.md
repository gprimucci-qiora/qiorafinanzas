# Módulo de Ingresos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agregar un apartado "Ingresos" al dashboard que calcule el ingreso mensual por distrito para las 3 pólizas (Planta Interna, Recolecciones, Multidistrito), con un formulario admin para capturar cambios futuros de precio/órdenes.

**Architecture:** Tres tablas nuevas en Supabase con el patrón "vigente desde" (efectivo hasta que se agregue una fila nueva). Funciones puras en `calc.js` resuelven, para cualquier (distrito, mes), qué parámetros aplican y calculan el ingreso. `index.html` agrega una vista nueva que usa esas funciones sobre los datos ya cargados, respetando el selector global Mes/YTD existente.

**Tech Stack:** Supabase (Postgres + RLS), vanilla JS + Chart.js/Tailwind (mismo stack del resto del proyecto), Python one-off script (fuera del repo) para parsear el Excel histórico.

## Global Constraints

- Alcance v1: solo Planta Interna, Recolecciones, Multidistrito. Nada de Otros Ingresos, Notas de Crédito, ni Margen (Ingreso − Gasto) — eso es fase futura.
- El código de distrito en las tablas nuevas es el mismo `sucursal_secundaria` que ya usa el Glosario de Sucursales.
- Multidistrito: la bolsa de un distrito es su región del Glosario, **excepto** `GUADALAJARA` → bolsa `OCCIDENTE`, y `NORTE` → no participa (ingreso Multidistrito = 0).
- Solo se **insertan** filas nuevas de parámetros (nunca se edita/borra una vigencia pasada) — así el histórico nunca se corrompe.
- RLS: lectura para cualquier usuario autenticado; inserción solo para `rol = 'admin'` (mismo patrón que `glosario_sucursales`).
- Todo cálculo de ingreso vive en `calc.js` como funciones puras y testeadas, igual que `calcularProrrateo`/`calcularKPIs`.

**Spec de referencia:** `docs/superpowers/specs/2026-07-14-modulo-ingresos-design.md`

---

## File Structure

```
QiORAConectaGastos/
├── supabase/
│   ├── 07_ingresos_schema.sql       # 3 tablas nuevas + RLS
│   └── 08_seed_ingresos.sql          # INSERT del histórico (generado del Excel)
├── calc.js                           # + funciones de ingresos
├── calc.test.js                      # + pruebas de esas funciones
└── index.html                        # + vista "Ingresos" (sidebar, KPIs, tabla, form admin)
```

---

### Task 1: Esquema SQL de Ingresos

**Files:**
- Create: `supabase/07_ingresos_schema.sql`

- [ ] **Step 1: Escribir el esquema**

```sql
-- supabase/07_ingresos_schema.sql

create table poliza_parametros (
  id uuid primary key default gen_random_uuid(),
  poliza text not null check (poliza in ('PLANTA INTERNA', 'RECOLECCIONES')),
  distrito text not null,
  precio_por_orden numeric not null,
  ordenes_dimensionadas numeric not null,
  vigente_desde date not null,
  created_at timestamptz default now()
);

create table multidistrito_bolsas (
  id uuid primary key default gen_random_uuid(),
  region_bolsa text not null check (region_bolsa in ('BAJIO', 'OCCIDENTE', 'ORIENTE', 'SURESTE')),
  precio_por_orden numeric not null,
  ordenes_dimensionadas numeric not null,
  vigente_desde date not null,
  created_at timestamptz default now()
);

create table multidistrito_asignacion (
  id uuid primary key default gen_random_uuid(),
  distrito text not null,
  ordenes_asignadas numeric not null,
  porcentaje numeric,
  vigente_desde date not null,
  created_at timestamptz default now()
);

alter table poliza_parametros enable row level security;
alter table multidistrito_bolsas enable row level security;
alter table multidistrito_asignacion enable row level security;

create policy "poliza_parametros_select_autenticado" on poliza_parametros
  for select using (auth.role() = 'authenticated');
create policy "poliza_parametros_write_admin" on poliza_parametros
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

create policy "multidistrito_bolsas_select_autenticado" on multidistrito_bolsas
  for select using (auth.role() = 'authenticated');
create policy "multidistrito_bolsas_write_admin" on multidistrito_bolsas
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

create policy "multidistrito_asignacion_select_autenticado" on multidistrito_asignacion
  for select using (auth.role() = 'authenticated');
create policy "multidistrito_asignacion_write_admin" on multidistrito_asignacion
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/07_ingresos_schema.sql` en el SQL Editor de Supabase y ejecútalo."

- [ ] **Step 3: Verificar**

```sql
select table_name from information_schema.tables where table_name in ('poliza_parametros', 'multidistrito_bolsas', 'multidistrito_asignacion');
select policyname from pg_policies where tablename in ('poliza_parametros', 'multidistrito_bolsas', 'multidistrito_asignacion');
```
Esperado: las 3 tablas listadas, y 2 políticas (`_select_autenticado`, `_write_admin`) por tabla = 6 políticas en total.

- [ ] **Step 4: Commit**

```bash
git add supabase/07_ingresos_schema.sql
git commit -m "Add schema and RLS for poliza_parametros, multidistrito_bolsas, multidistrito_asignacion"
```

---

### Task 2: Funciones de cálculo en calc.js (TDD)

**Files:**
- Modify: `calc.js`
- Test: `calc.test.js`

**Interfaces:**
- Consumes: nada nuevo — funciones puras sobre arrays planos.
- Produces:
  - `Calc.obtenerParametroVigente(registros, mesISO)` → objeto o `null`
  - `Calc.bolsaMultidistritoDeRegion(region)` → string o `null`
  - `Calc.obtenerRegionPorDistrito(glosarioMap)` → `{ [distrito]: region }`
  - `Calc.calcularIngresoPolizaDistrito(polizaParametros, poliza, distrito, mesISO)` → number
  - `Calc.calcularIngresoMultidistritoDistrito(asignaciones, bolsas, distrito, region, mesISO)` → number
  - `Calc.calcularIngresosDistrito(datos, distrito, region, mesISO)` → `{ plantaInterna, recolecciones, multidistrito, total }`, donde `datos = { polizaParametros, multidistritoBolsas, multidistritoAsignacion }`

- [ ] **Step 1: Escribir las pruebas (deben fallar)**

Agregar a `calc.test.js`:

```js
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
```

- [ ] **Step 2: Correr las pruebas y verificar que fallan**

Run: `node --test calc.test.js`
Expected: FAIL — `Calc.obtenerParametroVigente is not a function` (y similares para las demás).

- [ ] **Step 3: Implementar las funciones**

Agregar a `calc.js`, dentro de la función factory (mismo patrón que `clasificarFactura`/`calcularProrrateo`), y agregarlas también al objeto exportado al final del archivo:

```js
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
```

Y en el `return { ... }` del final de `calc.js`, agregar las 6 funciones nuevas a la lista exportada.

- [ ] **Step 4: Correr las pruebas y verificar que pasan**

Run: `node --test calc.test.js`
Expected: todas las pruebas pasan, incluidas las 27 anteriores (14 previas de Gastos + 13 nuevas de Ingresos — ajustar el conteo exacto si difiere).

- [ ] **Step 5: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add Ingresos calculation functions to calc.js (Planta Interna, Recolecciones, Multidistrito)"
```

---

### Task 3: Generar el seed SQL del histórico desde el Excel

**Files:**
- Create (fuera del repo, en el scratchpad): script Python de un solo uso.
- Create: `supabase/08_seed_ingresos.sql`

**Interfaces:**
- Consumes: el archivo `/Users/giacomoprimucci/Desktop/ingresos.xlsx` (hoja `Ingresos`), y el esquema de Task 1.
- Produces: `supabase/08_seed_ingresos.sql` con los `INSERT` de las 3 tablas.

- [ ] **Step 1: Escribir el script de parseo**

El Excel tiene: fechas de fin de mes en la fila 7, columnas F(6) a AQ(41) (36 meses, ene-2024 a dic-2026). Las secciones relevantes, todas con los mismos 19 distritos en el mismo orden (`CTA-TPI-INT-IRA IRAPUATO` ... `CTA-TPI-INT-TUX TUXTLA`), excepto donde se indica:

| Sección | Filas (19 distritos, o 4 bolsas) |
|---|---|
| Planta Interna — # DE OS | 78–96 |
| Planta Interna — PRECIO POR OS | 100–118 |
| Multidistrito bolsas — # DE OS (4 bolsas: BAJ,OCC,OTE,SUR) | 131–134 |
| Multidistrito bolsas — PRECIO POR OS | 138–141 |
| Multidistrito asignación — % por distrito | 145–163 |
| Multidistrito asignación — # DE OS por distrito | 193–211 |
| Recolecciones — # DE OS | 239–257 |
| Recolecciones — PRECIO POR OS | 261–279 |

Escribir en `/private/tmp/claude-501/-Users-giacomoprimucci/7449e107-0203-441c-befd-d2179da56b01/scratchpad/parse_ingresos.py` (ruta de scratchpad de la sesión activa):

```python
import openpyxl

wb = openpyxl.load_workbook("/Users/giacomoprimucci/Desktop/ingresos.xlsx", data_only=True)
ws = wb["Ingresos"]

MESES = list(range(6, 42))  # columnas F..AQ = 36 meses

def fecha_mes(col):
    d = ws.cell(row=7, column=col).value
    return f"{d.year:04d}-{d.month:02d}-01"

def distritos(fila_inicio, fila_fin):
    return [ws.cell(row=r, column=2).value for r in range(fila_inicio, fila_fin + 1)]

def valores_fila(fila):
    return [ws.cell(row=fila, column=c).value or 0 for c in MESES]

def escapar(s):
    return s.replace("'", "''")

lineas = []

# --- Planta Interna y Recolecciones: poliza_parametros ---
secciones_poliza = [
    ("PLANTA INTERNA", 78, 96, 100, 118),
    ("RECOLECCIONES", 239, 257, 261, 279),
]
for poliza, fila_os_ini, fila_os_fin, fila_precio_ini, fila_precio_fin in secciones_poliza:
    nombres = distritos(fila_os_ini, fila_os_fin)
    for i, distrito in enumerate(nombres):
        ordenes = valores_fila(fila_os_ini + i)
        precios = valores_fila(fila_precio_ini + i)
        for j, col in enumerate(MESES):
            vigente = fecha_mes(col)
            lineas.append(
                f"insert into poliza_parametros (poliza, distrito, precio_por_orden, ordenes_dimensionadas, vigente_desde) "
                f"values ('{poliza}', '{escapar(distrito)}', {precios[j]}, {ordenes[j]}, '{vigente}');"
            )

# --- Multidistrito bolsas ---
nombres_bolsas_raw = distritos(131, 134)  # nombres de cuenta OPR
mapa_bolsa = {
    "CTA-TPI-OPR-BAJ BAJIO OPERACIONES": "BAJIO",
    "CTA-TPI-OPR-OCC OCCIDENTE OPERACIONES": "OCCIDENTE",
    "CTA-TPI-OPR-OTE ORIENTE OPERACIONES": "ORIENTE",
    "CTA-TPI-OPR-SUR SURESTE OPERACIONES": "SURESTE",
}
for i, nombre in enumerate(nombres_bolsas_raw):
    region_bolsa = mapa_bolsa[nombre]
    ordenes = valores_fila(131 + i)
    precios = valores_fila(138 + i)
    for j, col in enumerate(MESES):
        vigente = fecha_mes(col)
        lineas.append(
            f"insert into multidistrito_bolsas (region_bolsa, precio_por_orden, ordenes_dimensionadas, vigente_desde) "
            f"values ('{region_bolsa}', {precios[j]}, {ordenes[j]}, '{vigente}');"
        )

# --- Multidistrito asignacion (ordenes + % por distrito) ---
nombres_asig = distritos(193, 211)
for i, distrito in enumerate(nombres_asig):
    ordenes_asig = valores_fila(193 + i)
    porcentajes = valores_fila(145 + i)
    for j, col in enumerate(MESES):
        vigente = fecha_mes(col)
        lineas.append(
            f"insert into multidistrito_asignacion (distrito, ordenes_asignadas, porcentaje, vigente_desde) "
            f"values ('{escapar(distrito)}', {ordenes_asig[j]}, {porcentajes[j]}, '{vigente}');"
        )

with open("/Users/giacomoprimucci/QiORAConectaGastos/supabase/08_seed_ingresos.sql", "w") as f:
    f.write("-- supabase/08_seed_ingresos.sql\n")
    f.write("-- Generado desde ingresos.xlsx (histórico ene-2024 a dic-2026)\n\n")
    f.write("\n".join(lineas))
    f.write("\n")

print(f"{len(lineas)} filas generadas")
```

- [ ] **Step 2: Correr el script**

Run: `python3 /private/tmp/claude-501/-Users-giacomoprimucci/7449e107-0203-441c-befd-d2179da56b01/scratchpad/parse_ingresos.py`
Expected: imprime `2196 filas generadas` (2 pólizas × 19 distritos × 36 meses = 1368, + 4 bolsas × 36 meses = 144, + 19 distritos × 36 meses = 684 → 1368+144+684 = 2196) y crea `supabase/08_seed_ingresos.sql`.

- [ ] **Step 3: Verificar una muestra del archivo generado**

Run: `head -20 supabase/08_seed_ingresos.sql` y `grep -c "insert into" supabase/08_seed_ingresos.sql`
Expected: sentencias `insert into` bien formadas, con distritos, números y fechas `YYYY-MM-01` válidas.

- [ ] **Step 4: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/08_seed_ingresos.sql` en el SQL Editor de Supabase (es un archivo grande, dale tiempo a correr) y ejecútalo. Es una carga única del histórico."

- [ ] **Step 5: Verificar en Supabase**

```sql
select count(*) from poliza_parametros;
select count(*) from multidistrito_bolsas;
select count(*) from multidistrito_asignacion;
select * from poliza_parametros where distrito = 'CTA-TPI-INT-LON LEON' and poliza = 'PLANTA INTERNA' order by vigente_desde desc limit 3;
```
Esperado: conteos > 0 coincidiendo con lo generado, y los valores de León más recientes se ven razonables (precio y órdenes > 0).

- [ ] **Step 6: Commit**

```bash
git add supabase/08_seed_ingresos.sql
git commit -m "Add historical seed data for Ingresos (parsed from ingresos.xlsx, Jan 2024 - Dec 2026)"
```

---

### Task 4: Vista "Ingresos" — KPIs y tabla por distrito

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.calcularIngresosDistrito`, `Calc.obtenerRegionPorDistrito`, `calcularRangosPeriodo`, `modoPeriodoGlobal`, `obtenerGlosarioMap()`, `mesGlobalSeleccionado`, `formatoMoneda`, `mostrarIndicadorCarga`/`ocultarIndicadorCarga`, `actualizarIconoOrden`.
- Produces: vista `vista-ingresos`, función `cargarIngresos()`, `renderizarIngresos()`, `ordenarIngresos(columna)`.

- [ ] **Step 1: Agregar el ítem al sidebar**

Buscar el botón `id="nav-usuarios"` en el sidebar (o el que sea el último ítem antes de "Gestión de Usuarios") y agregar un nuevo botón antes de él:

```html
        <li><button data-vista="ingresos" onclick="mostrarVista('ingresos')" class="w-full flex items-center gap-sm p-sm rounded-lg text-on-surface-variant font-gordita-regular hover:bg-surface-container transition-colors text-left">
          <span class="material-symbols-outlined">payments</span><span class="text-sm">Ingresos</span>
        </button></li>
```

- [ ] **Step 2: Agregar la vista HTML**

Insertar, junto a las demás vistas (por ejemplo después de `vista-sin-clasificar`), el siguiente bloque:

```html
      <div class="vista" id="vista-ingresos">
        <div class="mb-8">
          <span class="font-gordita-bold text-xs text-secondary uppercase tracking-widest">QiORA Conecta</span>
          <h1 class="font-gordita-bold text-4xl text-primary mt-1">Ingresos</h1>
        </div>
        <div id="kpis-ingresos" class="grid grid-cols-1 md:grid-cols-4 gap-gutter mb-lg">
          <div class="bg-white p-6 border border-outline-variant rounded-xl shadow-sm">
            <div class="p-2 bg-primary/5 rounded-lg inline-flex mb-4">
              <span class="material-symbols-outlined text-primary">payments</span>
            </div>
            <p class="font-gordita-bold text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Ingreso Total</p>
            <h2 id="ingreso-total" class="font-gordita-bold text-3xl text-primary">-</h2>
          </div>
          <div class="bg-white p-6 border border-outline-variant rounded-xl shadow-sm">
            <div class="p-2 bg-qiora-blue/10 rounded-lg inline-flex mb-4">
              <span class="material-symbols-outlined text-qiora-blue">store</span>
            </div>
            <p class="font-gordita-bold text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Planta Interna</p>
            <h2 id="ingreso-planta-interna" class="font-gordita-bold text-3xl text-primary">-</h2>
          </div>
          <div class="bg-white p-6 border border-outline-variant rounded-xl shadow-sm">
            <div class="p-2 bg-secondary-container/10 rounded-lg inline-flex mb-4">
              <span class="material-symbols-outlined text-secondary">local_shipping</span>
            </div>
            <p class="font-gordita-bold text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Recolecciones</p>
            <h2 id="ingreso-recolecciones" class="font-gordita-bold text-3xl text-primary">-</h2>
          </div>
          <div class="bg-white p-6 border border-outline-variant rounded-xl shadow-sm">
            <div class="p-2 bg-qiora-green/10 rounded-lg inline-flex mb-4">
              <span class="material-symbols-outlined text-qiora-green">hub</span>
            </div>
            <p class="font-gordita-bold text-[10px] text-on-surface-variant uppercase tracking-wider mb-1">Multidistrito</p>
            <h2 id="ingreso-multidistrito" class="font-gordita-bold text-3xl text-primary">-</h2>
          </div>
        </div>
        <section class="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <table id="tabla-ingresos" class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-surface-container-low text-[10px] text-on-surface-variant border-b border-outline-variant">
                <th class="px-8 py-4 font-gordita-bold uppercase tracking-widest cursor-pointer select-none" onclick="ordenarIngresos('distrito')">Distrito <span id="orden-ingresos-distrito"></span></th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right cursor-pointer select-none" onclick="ordenarIngresos('plantaInterna')">Planta Interna <span id="orden-ingresos-plantaInterna"></span></th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right cursor-pointer select-none" onclick="ordenarIngresos('recolecciones')">Recolecciones <span id="orden-ingresos-recolecciones"></span></th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right cursor-pointer select-none" onclick="ordenarIngresos('multidistrito')">Multidistrito <span id="orden-ingresos-multidistrito"></span></th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest text-right cursor-pointer select-none" onclick="ordenarIngresos('total')">Total <span id="orden-ingresos-total"></span></th>
              </tr>
            </thead>
            <tbody id="tabla-ingresos-body" class="text-sm divide-y divide-outline-variant"></tbody>
          </table>
        </section>
      </div>
```

- [ ] **Step 3: Agregar el dispatch en `mostrarVista`**

Localizar la función `mostrarVista` (busca `const cargadores = {`) y agregar la entrada:

```js
  const cargadores = {
    resumen: cargarResumenEjecutivo,
    sucursal: cargarPorSucursal,
    'sin-clasificar': cargarSinClasificar,
    usuarios: cargarUsuarios,
    ingresos: cargarIngresos,
  };
```

- [ ] **Step 4: Agregar la lógica JS**

Agregar antes de la línea final `cargarSesion();`:

```js
let ingresosPorDistrito = [];
let ordenIngresos = { columna: 'total', direccion: 'desc' };

async function cargarIngresos() {
  const glosarioMap = obtenerGlosarioMap();
  const regionPorDistrito = Calc.obtenerRegionPorDistrito(glosarioMap);
  const { anio: anioRef, mes: mesRef } = mesGlobalSeleccionado;
  const rangos = calcularRangosPeriodo(modoPeriodoGlobal, anioRef, mesRef);

  const [{ data: polizaParametros }, { data: multidistritoBolsas }, { data: multidistritoAsignacion }] = await Promise.all([
    supabaseClient.from('poliza_parametros').select('*'),
    supabaseClient.from('multidistrito_bolsas').select('*'),
    supabaseClient.from('multidistrito_asignacion').select('*'),
  ]);
  const datos = {
    polizaParametros: polizaParametros || [],
    multidistritoBolsas: multidistritoBolsas || [],
    multidistritoAsignacion: multidistritoAsignacion || [],
  };

  const distritos = new Set();
  datos.polizaParametros.forEach((p) => distritos.add(p.distrito));
  datos.multidistritoAsignacion.forEach((a) => distritos.add(a.distrito));

  const inicioMes = new Date(rangos.actual.inicio + 'T00:00:00');
  const finMes = new Date(rangos.actual.fin + 'T00:00:00');
  const mesesEnRango = [];
  let cursor = new Date(inicioMes.getFullYear(), inicioMes.getMonth(), 1);
  while (cursor <= finMes) {
    mesesEnRango.push(claveMes(cursor.getFullYear(), cursor.getMonth()) + '-01');
    cursor = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1);
  }

  ingresosPorDistrito = Array.from(distritos).map((distrito) => {
    const region = regionPorDistrito[distrito];
    const acumulado = { plantaInterna: 0, recolecciones: 0, multidistrito: 0, total: 0 };
    mesesEnRango.forEach((mesISO) => {
      const resultado = Calc.calcularIngresosDistrito(datos, distrito, region, mesISO);
      acumulado.plantaInterna += resultado.plantaInterna;
      acumulado.recolecciones += resultado.recolecciones;
      acumulado.multidistrito += resultado.multidistrito;
      acumulado.total += resultado.total;
    });
    return { distrito, ...acumulado };
  });

  renderizarIngresos();
}

function ordenarIngresos(columna) {
  if (ordenIngresos.columna === columna) {
    ordenIngresos.direccion = ordenIngresos.direccion === 'desc' ? 'asc' : 'desc';
  } else {
    ordenIngresos = { columna, direccion: columna === 'distrito' ? 'asc' : 'desc' };
  }
  renderizarIngresos();
}

function renderizarIngresos() {
  const totales = ingresosPorDistrito.reduce(
    (acc, d) => ({
      plantaInterna: acc.plantaInterna + d.plantaInterna,
      recolecciones: acc.recolecciones + d.recolecciones,
      multidistrito: acc.multidistrito + d.multidistrito,
      total: acc.total + d.total,
    }),
    { plantaInterna: 0, recolecciones: 0, multidistrito: 0, total: 0 },
  );
  document.getElementById('ingreso-total').textContent = formatoMoneda(totales.total);
  document.getElementById('ingreso-planta-interna').textContent = formatoMoneda(totales.plantaInterna);
  document.getElementById('ingreso-recolecciones').textContent = formatoMoneda(totales.recolecciones);
  document.getElementById('ingreso-multidistrito').textContent = formatoMoneda(totales.multidistrito);

  const dir = ordenIngresos.direccion === 'asc' ? 1 : -1;
  const filas = ingresosPorDistrito.slice().sort((a, b) => {
    if (ordenIngresos.columna === 'distrito') return a.distrito.localeCompare(b.distrito) * dir;
    return (a[ordenIngresos.columna] - b[ordenIngresos.columna]) * dir;
  });
  actualizarIconoOrden('orden-ingresos', ordenIngresos);

  const cuerpo = document.getElementById('tabla-ingresos-body');
  cuerpo.innerHTML = '';
  filas.forEach((d) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td class="px-8 py-4 font-gordita-bold">${d.distrito}</td><td class="px-6 py-4 text-right">${formatoMoneda(d.plantaInterna)}</td><td class="px-6 py-4 text-right">${formatoMoneda(d.recolecciones)}</td><td class="px-6 py-4 text-right">${formatoMoneda(d.multidistrito)}</td><td class="px-6 py-4 text-right font-gordita-bold">${formatoMoneda(d.total)}</td>`;
    cuerpo.appendChild(tr);
  });
}
```

Actualizar `actualizarIconoOrden` para incluir las nuevas columnas en la lista que limpia:

```js
function actualizarIconoOrden(prefijo, orden) {
  ['distrito', 'costoDirecto', 'operativo', 'total', 'familia', 'monto', 'deltaPesos', 'deltaPct', 'plantaInterna', 'recolecciones', 'multidistrito'].forEach((col) => {
```

- [ ] **Step 5: Verificar sintaxis**

Extraer el `<script>` a un archivo temporal y correr `node --check` sobre él; confirmar sin errores. Correr `node --test calc.test.js` para confirmar que sigue en verde.

- [ ] **Step 6: Verificación visual**

Levantar un servidor local (`python3 -m http.server 8934` desde la carpeta del proyecto), entrar al dashboard, ir a "Ingresos", confirmar que los KPIs y la tabla muestran números (no ceros ni NaN) para distritos como León.

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add Ingresos view: KPIs and sortable table by distrito"
```

---

### Task 5: Formulario admin para agregar vigencias

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: mismas tablas de Task 1; `usuarioActual.rol` para ocultar a no-admin.
- Produces: sección "Actualizar Parámetros" dentro de `vista-ingresos`, funciones `guardarParametroPoliza()`, `guardarBolsaMultidistrito()`, `guardarAsignacionMultidistrito()`.

- [ ] **Step 1: Agregar el HTML del formulario** (dentro de `vista-ingresos`, después de la tabla)

```html
        <div id="admin-ingresos" class="mt-lg" style="display:none;">
          <h3 class="font-gordita-bold text-lg text-primary mb-4">Actualizar Parámetros</h3>
          <div class="bg-white border border-outline-variant rounded-xl shadow-sm p-6 mb-4 grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <select id="param-poliza" class="px-3 py-2 border border-outline-variant rounded text-sm">
              <option value="PLANTA INTERNA">Planta Interna</option>
              <option value="RECOLECCIONES">Recolecciones</option>
            </select>
            <input id="param-distrito" placeholder="Distrito (código)" class="px-3 py-2 border border-outline-variant rounded text-sm md:col-span-2">
            <input id="param-precio" type="number" step="0.01" placeholder="Precio por orden" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="param-ordenes" type="number" step="0.01" placeholder="Órdenes dimensionadas" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="param-vigente" type="month" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <button onclick="guardarParametroPoliza()" class="px-4 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity md:col-span-6">Agregar vigencia (Planta Interna / Recolecciones)</button>
          </div>
          <div class="bg-white border border-outline-variant rounded-xl shadow-sm p-6 mb-4 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <select id="bolsa-region" class="px-3 py-2 border border-outline-variant rounded text-sm">
              <option value="BAJIO">Bajío</option>
              <option value="OCCIDENTE">Occidente (incluye Guadalajara)</option>
              <option value="ORIENTE">Oriente</option>
              <option value="SURESTE">Sureste</option>
            </select>
            <input id="bolsa-precio" type="number" step="0.01" placeholder="Precio por orden" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="bolsa-ordenes" type="number" step="0.01" placeholder="Órdenes dimensionadas" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="bolsa-vigente" type="month" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <button onclick="guardarBolsaMultidistrito()" class="px-4 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity">Agregar bolsa Multidistrito</button>
          </div>
          <div class="bg-white border border-outline-variant rounded-xl shadow-sm p-6 grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <input id="asignacion-distrito" placeholder="Distrito (código)" class="px-3 py-2 border border-outline-variant rounded text-sm md:col-span-2">
            <input id="asignacion-ordenes" type="number" step="0.01" placeholder="Órdenes asignadas" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="asignacion-porcentaje" type="number" step="0.0001" placeholder="% (informativo)" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <input id="asignacion-vigente" type="month" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <button onclick="guardarAsignacionMultidistrito()" class="px-4 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity md:col-span-5">Agregar asignación de distrito (Multidistrito)</button>
          </div>
          <p id="estado-ingresos-admin" class="text-sm font-gordita-bold text-secondary mt-3"></p>
        </div>
```

- [ ] **Step 2: Mostrar la sección solo a admin**

En `cargarSesion()`, dentro del bloque `if (perfil.rol !== 'admin') { ... }`, no cambia nada (ya oculta por default via `style="display:none"`). En cambio, agregar el show para admin: buscar dónde se hace `mesGlobalSeleccionado = await obtenerUltimoMesConDatos();` y, justo después de la sección `if (perfil.rol !== 'admin') {...}`, agregar:

```js
  if (perfil.rol === 'admin') {
    const seccionAdminIngresos = document.getElementById('admin-ingresos');
    if (seccionAdminIngresos) seccionAdminIngresos.style.display = 'block';
  }
```

- [ ] **Step 3: Agregar la lógica JS de guardado**

Agregar junto a las demás funciones de Ingresos:

```js
async function guardarParametroPoliza() {
  const poliza = document.getElementById('param-poliza').value;
  const distrito = document.getElementById('param-distrito').value;
  const precio_por_orden = parseFloat(document.getElementById('param-precio').value);
  const ordenes_dimensionadas = parseFloat(document.getElementById('param-ordenes').value);
  const vigenteMes = document.getElementById('param-vigente').value;
  if (!distrito || isNaN(precio_por_orden) || isNaN(ordenes_dimensionadas) || !vigenteMes) {
    document.getElementById('estado-ingresos-admin').textContent = 'Completa todos los campos de Planta Interna/Recolecciones.';
    return;
  }
  const vigente_desde = vigenteMes + '-01';
  const { error } = await supabaseClient.from('poliza_parametros').insert({ poliza, distrito, precio_por_orden, ordenes_dimensionadas, vigente_desde });
  if (error) { document.getElementById('estado-ingresos-admin').textContent = 'Error: ' + error.message; return; }
  document.getElementById('estado-ingresos-admin').textContent = 'Vigencia agregada.';
  await cargarIngresos();
}

async function guardarBolsaMultidistrito() {
  const region_bolsa = document.getElementById('bolsa-region').value;
  const precio_por_orden = parseFloat(document.getElementById('bolsa-precio').value);
  const ordenes_dimensionadas = parseFloat(document.getElementById('bolsa-ordenes').value);
  const vigenteMes = document.getElementById('bolsa-vigente').value;
  if (isNaN(precio_por_orden) || isNaN(ordenes_dimensionadas) || !vigenteMes) {
    document.getElementById('estado-ingresos-admin').textContent = 'Completa todos los campos de la bolsa Multidistrito.';
    return;
  }
  const vigente_desde = vigenteMes + '-01';
  const { error } = await supabaseClient.from('multidistrito_bolsas').insert({ region_bolsa, precio_por_orden, ordenes_dimensionadas, vigente_desde });
  if (error) { document.getElementById('estado-ingresos-admin').textContent = 'Error: ' + error.message; return; }
  document.getElementById('estado-ingresos-admin').textContent = 'Bolsa actualizada.';
  await cargarIngresos();
}

async function guardarAsignacionMultidistrito() {
  const distrito = document.getElementById('asignacion-distrito').value;
  const ordenes_asignadas = parseFloat(document.getElementById('asignacion-ordenes').value);
  const porcentajeInput = document.getElementById('asignacion-porcentaje').value;
  const porcentaje = porcentajeInput === '' ? null : parseFloat(porcentajeInput);
  const vigenteMes = document.getElementById('asignacion-vigente').value;
  if (!distrito || isNaN(ordenes_asignadas) || !vigenteMes) {
    document.getElementById('estado-ingresos-admin').textContent = 'Completa distrito, órdenes asignadas y vigencia.';
    return;
  }
  const vigente_desde = vigenteMes + '-01';
  const { error } = await supabaseClient.from('multidistrito_asignacion').insert({ distrito, ordenes_asignadas, porcentaje, vigente_desde });
  if (error) { document.getElementById('estado-ingresos-admin').textContent = 'Error: ' + error.message; return; }
  document.getElementById('estado-ingresos-admin').textContent = 'Asignación actualizada.';
  await cargarIngresos();
}
```

- [ ] **Step 4: Verificar sintaxis y tests**

Mismo procedimiento que Task 4 Step 5.

- [ ] **Step 5: Verificación funcional**

Iniciar sesión como admin, ir a Ingresos, agregar una vigencia de prueba en cada uno de los 3 formularios, confirmar que la tabla/KPIs se actualizan tras guardar. Iniciar sesión como `finanzas` y confirmar que la sección admin no aparece.

- [ ] **Step 6: Commit**

```bash
git add index.html
git commit -m "Add admin forms to append new pricing/dimensioning vigencies for Ingresos"
```

---

### Task 6: Push a GitHub

- [ ] **Step 1:** Pedir un GitHub Personal Access Token si hace falta (ver memoria: Giacomo prefiere reusar el mismo token sin revocarlo).
- [ ] **Step 2:** `git push` a `main` en `gprimucci-qiora/qiorafinanzas`.
- [ ] **Step 3:** Confirmar que GitHub Pages refleja los cambios (puede tardar 1-2 minutos).
