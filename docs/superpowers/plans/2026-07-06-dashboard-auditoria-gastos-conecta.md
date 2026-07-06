# Dashboard de Auditoría de Gastos QiORA Conecta — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construir un dashboard financiero (SPA, Supabase) que audite el gasto real pagado de QiORA Conecta, desglosado por sucursal/distrito y por tipo de gasto, distinguiendo costo directo de gasto operativo prorrateado.

**Architecture:** SPA de un solo `index.html` (vanilla HTML/CSS/JS + Chart.js + SheetJS + Supabase JS), con la lógica de negocio pura (clasificación, prorrateo, KPIs) extraída a `calc.js` para poder probarla con el test runner nativo de Node (`node --test`), sin dependencias externas. Backend: Supabase (Postgres + Auth + RLS), con un reemplazo semanal de facturas acotado por rango de `fecha_pago` vía una función RPC atómica.

**Tech Stack:** HTML/CSS/JS vanilla (sin build step), Chart.js (CDN), SheetJS/xlsx (CDN), Supabase JS v2 (CDN), Supabase Postgres/Auth/RLS, Node.js ≥18 (solo para correr tests de `calc.js` en desarrollo, no es dependencia en producción).

## Global Constraints

- Todo el SQL de Supabase (schema, RLS, RPC, seed) lo ejecuta el usuario manualmente en el SQL Editor de Supabase — nunca se intenta ejecutar contra la base de datos directamente desde este entorno.
- Toda la UI y los mensajes al usuario van en español, siguiendo el tono ya usado en `SistemaBonos`.
- `calc.js` no debe depender de ningún framework ni de Node en producción — debe funcionar tanto vía `<script src="calc.js">` en el navegador (expone `window.Calc`) como vía `require('./calc.js')` en Node para los tests.
- La columna `TIPO DE GASTO` del Excel de facturas (`tipo_gasto_categoria`, 25 valores) y la columna `TIPO DE GASTO` del glosario (`tipo_gasto`, sólo `COSTOS DIRECTOS`/`GASTOS OPERATIVOS`) son conceptos distintos — nunca deben mezclarse en el código ni en la UI.
- "Folio" para el prorrateo = número de renglones pagados por distrito (no número de valores distintos de la columna `FACTURA`).
- Roles v1: solo `admin` y `finanzas`. No implementar recorte por región/distrito todavía (fuera de alcance v1, ver spec §8).
- No hay dato de presupuesto en v1 — ninguna vista debe mostrar una columna de "variación vs. presupuesto".

**Spec de referencia:** `docs/superpowers/specs/2026-07-06-dashboard-auditoria-gastos-conecta-design.md`

---

## File Structure

```
QiORAConectaGastos/
├── index.html                          # SPA: shell, login, nav, todas las vistas (crece por tarea)
├── calc.js                             # Lógica de negocio pura y testable
├── calc.test.js                        # Suite de tests (node --test calc.test.js)
├── supabase/
│   ├── 01_schema.sql                   # Tablas usuarios, glosario_sucursales, facturas + índices
│   ├── 02_rls_policies.sql             # Políticas RLS
│   ├── 03_rpc_reemplazar_facturas.sql  # Función atómica de reemplazo por ventana
│   └── 04_seed_glosario.sql            # Seed real de las 63 sucursales del glosario
├── docs/superpowers/specs/2026-07-06-dashboard-auditoria-gastos-conecta-design.md
├── docs/superpowers/plans/2026-07-06-dashboard-auditoria-gastos-conecta.md
└── CONTEXT.md
```

---

### Task 1: Esquema de Supabase (tablas + índices)

**Files:**
- Create: `supabase/01_schema.sql`

**Interfaces:**
- Produces: tablas `usuarios(id, nombre, rol)`, `glosario_sucursales(sucursal, tipo_sucursal, region, sucursal_secundaria, tipo_gasto, actualizado_en)`, `facturas(id, familia, gasto, empresa, sucursal, proveedor, factura, subtotal, iva, descuento, monto, fecha_alta, fecha_pago, tipo_gasto_categoria, linea_negocio, negocio, cargado_en)`.

- [ ] **Step 1: Escribir el SQL del esquema**

```sql
-- supabase/01_schema.sql

create table if not exists usuarios (
  id uuid references auth.users(id) primary key,
  nombre text not null,
  rol text not null check (rol in ('admin', 'finanzas'))
);

create table if not exists glosario_sucursales (
  sucursal text primary key,
  tipo_sucursal text,
  region text,
  sucursal_secundaria text,
  tipo_gasto text check (tipo_gasto in ('COSTOS DIRECTOS', 'GASTOS OPERATIVOS')),
  actualizado_en timestamptz default now()
);

create table if not exists facturas (
  id bigserial primary key,
  familia text,
  gasto text,
  empresa text,
  sucursal text,
  proveedor text,
  factura text,
  subtotal numeric,
  iva numeric,
  descuento numeric,
  monto numeric,
  fecha_alta date,
  fecha_pago date not null,
  tipo_gasto_categoria text,
  linea_negocio text,
  negocio text default 'CONECTA',
  cargado_en timestamptz default now()
);

create index if not exists idx_facturas_fecha_pago on facturas (fecha_pago);
create index if not exists idx_facturas_sucursal on facturas (sucursal);
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega el contenido de `supabase/01_schema.sql` en el SQL Editor de tu proyecto de Supabase y ejecútalo."

- [ ] **Step 3: Verificar (el usuario corre esta consulta y reporta el resultado)**

```sql
select table_name from information_schema.tables
where table_schema = 'public'
and table_name in ('usuarios', 'glosario_sucursales', 'facturas');
```
Esperado: las 3 filas.

- [ ] **Step 4: Commit**

```bash
git add supabase/01_schema.sql
git commit -m "Add Supabase schema for usuarios, glosario_sucursales, facturas"
```

---

### Task 2: Políticas RLS

**Files:**
- Create: `supabase/02_rls_policies.sql`

**Interfaces:**
- Consumes: tablas de Task 1.
- Produces: RLS activado con lectura para cualquier autenticado, escritura solo para `rol = 'admin'`.

- [ ] **Step 1: Escribir las políticas**

```sql
-- supabase/02_rls_policies.sql

alter table usuarios enable row level security;
alter table glosario_sucursales enable row level security;
alter table facturas enable row level security;

-- usuarios: cada quien lee solo su propio perfil
create policy "usuarios_select_propio" on usuarios
  for select using (auth.uid() = id);

-- glosario_sucursales: lectura para cualquier autenticado
create policy "glosario_select_autenticado" on glosario_sucursales
  for select using (auth.role() = 'authenticated');

-- glosario_sucursales: escritura solo admin
create policy "glosario_write_admin" on glosario_sucursales
  for all using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  ) with check (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );

-- facturas: lectura para cualquier autenticado
create policy "facturas_select_autenticado" on facturas
  for select using (auth.role() = 'authenticated');

-- facturas: escritura directa solo admin (el flujo normal usa la función RPC de Task 3)
create policy "facturas_write_admin" on facturas
  for all using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  ) with check (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/02_rls_policies.sql` en el SQL Editor y ejecútalo. Esto requiere que ya exista al menos un usuario en la tabla `usuarios` con `rol = 'admin'` — créalo insertando manualmente tu propio `id` de `auth.users`."

- [ ] **Step 3: Verificar (el usuario corre esta consulta y reporta el resultado)**

```sql
select tablename, policyname from pg_policies where schemaname = 'public';
```
Esperado: 5 políticas listadas (una en `usuarios`, dos en `glosario_sucursales`, dos en `facturas`).

- [ ] **Step 4: Commit**

```bash
git add supabase/02_rls_policies.sql
git commit -m "Add RLS policies: read for authenticated, write for admin only"
```

---

### Task 3: Función RPC de reemplazo atómico por ventana de fecha

**Files:**
- Create: `supabase/03_rpc_reemplazar_facturas.sql`

**Interfaces:**
- Consumes: tablas `facturas`, `usuarios` (Task 1).
- Produces: función `reemplazar_facturas(filas jsonb, p_fecha_min date, p_fecha_max date) returns void`, invocable desde el cliente vía `supabase.rpc('reemplazar_facturas', {...})`.

- [ ] **Step 1: Escribir la función**

```sql
-- supabase/03_rpc_reemplazar_facturas.sql

create or replace function reemplazar_facturas(
  filas jsonb,
  p_fecha_min date,
  p_fecha_max date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rol text;
begin
  select rol into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'admin' then
    raise exception 'Solo el rol admin puede reemplazar facturas';
  end if;

  delete from facturas where fecha_pago between p_fecha_min and p_fecha_max;

  insert into facturas (
    familia, gasto, empresa, sucursal, proveedor, factura,
    subtotal, iva, descuento, monto, fecha_alta, fecha_pago,
    tipo_gasto_categoria, linea_negocio, negocio
  )
  select
    f->>'familia',
    f->>'gasto',
    f->>'empresa',
    f->>'sucursal',
    f->>'proveedor',
    f->>'factura',
    nullif(f->>'subtotal', '')::numeric,
    nullif(f->>'iva', '')::numeric,
    nullif(f->>'descuento', '')::numeric,
    nullif(f->>'monto', '')::numeric,
    nullif(f->>'fecha_alta', '')::date,
    (f->>'fecha_pago')::date,
    f->>'tipo_gasto_categoria',
    f->>'linea_negocio',
    coalesce(f->>'negocio', 'CONECTA')
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_facturas(jsonb, date, date) from public;
grant execute on function reemplazar_facturas(jsonb, date, date) to authenticated;
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/03_rpc_reemplazar_facturas.sql` en el SQL Editor y ejecútalo."

- [ ] **Step 3: Verificar (el usuario corre esta consulta y reporta el resultado)**

```sql
select reemplazar_facturas(
  '[{"familia":"PRUEBA","gasto":"PRUEBA","sucursal":"CTA-TPI-INT-XAL XALAPA","factura":"T1","monto":"100","fecha_pago":"2026-06-15"}]'::jsonb,
  '2026-06-15'::date,
  '2026-06-15'::date
);
select * from facturas where familia = 'PRUEBA';
```
Esperado: una fila con `monto = 100`. Limpieza: `delete from facturas where familia = 'PRUEBA';`

- [ ] **Step 4: Commit**

```bash
git add supabase/03_rpc_reemplazar_facturas.sql
git commit -m "Add atomic date-windowed replace RPC function for weekly invoice upload"
```

---

### Task 4: Seed inicial del glosario de sucursales

**Files:**
- Create: `supabase/04_seed_glosario.sql`

**Interfaces:**
- Consumes: tabla `glosario_sucursales` (Task 1).
- Produces: 63 filas reales cargadas (extraídas de `Glosario sucursales 06072026.xlsx`).

- [ ] **Step 1: Escribir el seed con los datos reales**

```sql
-- supabase/04_seed_glosario.sql

insert into glosario_sucursales (sucursal, tipo_sucursal, region, sucursal_secundaria, tipo_gasto) values
('CTA-TPI-ARH-BAJ CAPITAL HUMANO BAJIO', 'CAPITAL HUMANO', 'BAJIO', 'CTA-TPI-ARH-BAJ CAPITAL HUMANO BAJIO', 'GASTOS OPERATIVOS'),
('CTA-TPI-ARH-OCC CAPITAL HUMANO OCCIDENTE', 'CAPITAL HUMANO', 'OCCIDENTE', 'CTA-TPI-ARH-OCC CAPITAL HUMANO OCCIDENTE', 'GASTOS OPERATIVOS'),
('CTA-TPI-ARH-OTE CAPITAL HUMANO ORIENTE', 'CAPITAL HUMANO', 'ORIENTE', 'CTA-TPI-ARH-OTE CAPITAL HUMANO ORIENTE', 'GASTOS OPERATIVOS'),
('CTA-TPI-ARH-SUR CAPITAL HUMANO SURESTE', 'CAPITAL HUMANO', 'SURESTE', 'CTA-TPI-ARH-SUR CAPITAL HUMANO SURESTE', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-ACT CONTROL DE ACTIVOS', 'ACTIVOS', 'NACIONAL', 'CTA-TPI-COR-ACT CONTROL DE ACTIVOS', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-ADM ADMIN POLIZA', 'ADMIN', 'NACIONAL', 'CTA-TPI-COR-ADM ADMIN POLIZA', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-ALM ALMACENES', 'ACTIVOS', 'NACIONAL', 'CTA-TPI-COR-ALM ALMACENES', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-ARH ADMIN RECURSOS HUMANOS', 'CAPITAL HUMANO', 'NACIONAL', 'CTA-TPI-COR-ARH ADMIN RECURSOS HUMANOS', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-DIR CUADRILLAS LIDERCEL', 'DIRECCION', 'NACIONAL', 'CTA-TPI-COR-DIR CUADRILLAS LIDERCEL', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-DIR CUADRILLAS SUNIFY', 'DIRECCION', 'NACIONAL', 'CTA-TPI-COR-DIR CUADRILLAS SUNIFY', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-DIR DIRECCION POLIZA 2', 'DIRECCION', 'NACIONAL', 'CTA-TPI-COR-DIR DIRECCION POLIZA 2', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-OPR OPERACIONES POLIZA 2', 'OPERACIONES', 'NACIONAL', 'CTA-TPI-COR-OPR OPERACIONES POLIZA 2', 'GASTOS OPERATIVOS'),
('CTA-TPI-COR-VEH FLOTILLAS', 'ACTIVOS', 'NACIONAL', 'CTA-TPI-COR-VEH FLOTILLAS', 'GASTOS OPERATIVOS'),
('CTA-TPI-DLR-CBA CORDOBA ORIZABA CARLOS MARTINEZ', 'CONTRATISTAS', 'ORIENTE', 'CTA-TPI-INT-CBA CORDOBA ORIZABA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-COL COLIMA MARCO ANAYA', 'CONTRATISTAS', 'OCCIDENTE', 'CTA-TPI-INT-COL COLIMA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GBA GDL BARRANCA ELIZABETH ZAVALA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GBA GDL BARRANCA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GBA GDL BARRANCA MARCO ANAYA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GBA GDL BARRANCA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GBA GDL BARRANCA MARIA GPE GLEZ ADAME', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GBA GDL BARRANCA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GBA GDL BARRANCA OMAR RIVERA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GBA GDL BARRANCA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO ELIZABETH ZAVALA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO ESMERALDA VARGAS', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO JUAN VALENCIA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO MARCO ANAYA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO MARIA GPE GLEZ ADAME', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GES GDL ESTADIO OMAR RIVERA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GLM GDL LOPEZ MATEOS ELF PUNKTE', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GLM GDL LOPEZ MATEOS ELIZABETH ZAVALA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GLM GDL LOPEZ MATEOS JUAN VALENCIA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GLM GDL LOPEZ MATEOS MARCO ANAYA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GPR GDL PRIMAVERA ESMERALDA VARGAS', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GPR GDL PRIMAVERA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GPR GDL PRIMAVERA JUAN VALENCIA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GPR GDL PRIMAVERA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GPR GDL PRIMAVERA MARCO ANAYA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GPR GDL PRIMAVERA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-GPR GDL PRIMAVERA OMAR RIVERA', 'CONTRATISTAS', 'GUADALAJARA', 'CTA-TPI-INT-GPR GDL PRIMAVERA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-IRA IRAPUATO MARIA GPE GLEZ ADAME', 'CONTRATISTAS', 'BAJIO', 'CTA-TPI-INT-IRA IRAPUATO', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-LON LEON MARCO ANAYA', 'CONTRATISTAS', 'BAJIO', 'CTA-TPI-INT-LON LEON', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-MER MERIDA ADRIANA KUYOK', 'CONTRATISTAS', 'SURESTE', 'CTA-TPI-INT-MER MERIDA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-MTY MONTERREY MARCO ANAYA', 'CONTRATISTAS', 'NORTE', 'CTA-TPI-INT-MTY MONTERREY', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-PUE PUEBLA MIGUEL ANGEL ESQUIVEL', 'CONTRATISTAS', 'ORIENTE', 'CTA-TPI-INT-PUE PUEBLA', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-TEP TEPIC MARCO ANAYA', 'CONTRATISTAS', 'OCCIDENTE', 'CTA-TPI-INT-TEP TEPIC', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-VRZ VERACRUZ MARCO ANAYA', 'CONTRATISTAS', 'ORIENTE', 'CTA-TPI-INT-VRZ VERACRUZ', 'COSTOS DIRECTOS'),
('CTA-TPI-DLR-VRZ VERACRUZ MARIA GUADALUPE ORTIZ', 'CONTRATISTAS', 'ORIENTE', 'CTA-TPI-INT-VRZ VERACRUZ', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-AGS AGUASCALIENTES', 'DISTRITO', 'OCCIDENTE', 'CTA-TPI-INT-AGS AGUASCALIENTES', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-CBA CORDOBA ORIZABA', 'DISTRITO', 'ORIENTE', 'CTA-TPI-INT-CBA CORDOBA ORIZABA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-COA COATZA MINA', 'DISTRITO', 'ORIENTE', 'CTA-TPI-INT-COA COATZA MINA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-COL COLIMA', 'DISTRITO', 'OCCIDENTE', 'CTA-TPI-INT-COL COLIMA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-CUN CANCUN 1', 'DISTRITO', 'SURESTE', 'CTA-TPI-INT-CUN CANCUN 1', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-GBA GDL BARRANCA', 'DISTRITO', 'GUADALAJARA', 'CTA-TPI-INT-GBA GDL BARRANCA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-GES GDL ESTADIO', 'DISTRITO', 'GUADALAJARA', 'CTA-TPI-INT-GES GDL ESTADIO', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'DISTRITO', 'GUADALAJARA', 'CTA-TPI-INT-GLM GDL LOPEZ MATEOS', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-GPR GDL PRIMAVERA', 'DISTRITO', 'GUADALAJARA', 'CTA-TPI-INT-GPR GDL PRIMAVERA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-IRA IRAPUATO', 'DISTRITO', 'BAJIO', 'CTA-TPI-INT-IRA IRAPUATO', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-LON LEON', 'DISTRITO', 'BAJIO', 'CTA-TPI-INT-LON LEON', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-MER MERIDA', 'DISTRITO', 'SURESTE', 'CTA-TPI-INT-MER MERIDA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-MOR MORELIA', 'DISTRITO', 'OCCIDENTE', 'CTA-TPI-INT-MOR MORELIA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-MTY MONTERREY', 'DISTRITO', 'NORTE', 'CTA-TPI-INT-MTY MONTERREY', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-PUE PUEBLA', 'DISTRITO', 'ORIENTE', 'CTA-TPI-INT-PUE PUEBLA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-TEP TEPIC', 'DISTRITO', 'OCCIDENTE', 'CTA-TPI-INT-TEP TEPIC', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-TUX TUXTLA', 'DISTRITO', 'SURESTE', 'CTA-TPI-INT-TUX TUXTLA', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-VRZ VERACRUZ', 'DISTRITO', 'ORIENTE', 'CTA-TPI-INT-VRZ VERACRUZ', 'COSTOS DIRECTOS'),
('CTA-TPI-INT-XAL XALAPA', 'DISTRITO', 'ORIENTE', 'CTA-TPI-INT-XAL XALAPA', 'COSTOS DIRECTOS'),
('CTA-TPI-OPR-BAJ BAJIO OPERACIONES', 'OPERACIONES', 'BAJIO', 'CTA-TPI-OPR-BAJ BAJIO OPERACIONES', 'GASTOS OPERATIVOS'),
('CTA-TPI-OPR-OCC OCCIDENTE OPERACIONES', 'OPERACIONES', 'OCCIDENTE', 'CTA-TPI-OPR-OCC OCCIDENTE OPERACIONES', 'GASTOS OPERATIVOS'),
('CTA-TPI-OPR-OTE ORIENTE OPERACIONES', 'OPERACIONES', 'ORIENTE', 'CTA-TPI-OPR-OTE ORIENTE OPERACIONES', 'GASTOS OPERATIVOS')
on conflict (sucursal) do nothing;
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/04_seed_glosario.sql` en el SQL Editor y ejecútalo."

- [ ] **Step 3: Verificar (el usuario corre esta consulta y reporta el resultado)**

```sql
select count(*) from glosario_sucursales;
```
Esperado: `63`.

- [ ] **Step 4: Commit**

```bash
git add supabase/04_seed_glosario.sql
git commit -m "Seed glosario_sucursales with the 63 real sucursal mappings"
```

---

### Task 5: `calc.js` — cálculo de ventana de reemplazo

**Files:**
- Create: `calc.js`
- Create: `calc.test.js`

**Interfaces:**
- Produces: `Calc.computeVentana(rows)` → `{ fechaMin: 'YYYY-MM-DD', fechaMax: 'YYYY-MM-DD' }`. Usado por Task 9 (vista Cargar Datos).

- [ ] **Step 1: Escribir el archivo base UMD de `calc.js`**

```js
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
```

- [ ] **Step 2: Escribir el test**

```js
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
```

- [ ] **Step 3: Correr los tests y verificar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 2`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add computeVentana with tests"
```

---

### Task 6: `calc.js` — clasificación de facturas contra el glosario

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.js`

**Interfaces:**
- Consumes: ninguna función previa.
- Produces: `Calc.clasificarFactura(factura, glosarioMap)` → objeto factura enriquecido con `tipo_gasto`, `region`, `sucursal_secundaria` (o `tipo_gasto: 'SIN_CLASIFICAR'` si no hay match). `glosarioMap` es un objeto plano `{ [sucursal]: { tipo_sucursal, region, sucursal_secundaria, tipo_gasto } }`. Usado por Task 7 y por las vistas de dashboard (Tasks 11-14).

- [ ] **Step 1: Agregar la función a `calc.js`**

Agregar dentro del `factory` de `calc.js`, antes del `return`:

```js
  function clasificarFactura(factura, glosarioMap) {
    const entrada = glosarioMap[factura.sucursal];
    if (!entrada) {
      return Object.assign({}, factura, {
        tipo_gasto: 'SIN_CLASIFICAR',
        region: null,
        sucursal_secundaria: null,
      });
    }
    return Object.assign({}, factura, {
      tipo_gasto: entrada.tipo_gasto,
      region: entrada.region,
      sucursal_secundaria: entrada.sucursal_secundaria,
    });
  }
```

Y actualizar el `return` final:

```js
  return {
    computeVentana,
    clasificarFactura,
  };
```

- [ ] **Step 2: Agregar los tests**

```js
// agregar a calc.test.js

test('clasificarFactura asigna tipo_gasto y sucursal_secundaria cuando hay match directo', () => {
  const glosarioMap = {
    'CTA-TPI-INT-XAL XALAPA': {
      tipo_sucursal: 'DISTRITO', region: 'ORIENTE',
      sucursal_secundaria: 'CTA-TPI-INT-XAL XALAPA', tipo_gasto: 'COSTOS DIRECTOS',
    },
  };
  const factura = { sucursal: 'CTA-TPI-INT-XAL XALAPA', monto: 1000 };
  const result = Calc.clasificarFactura(factura, glosarioMap);
  assert.strictEqual(result.tipo_gasto, 'COSTOS DIRECTOS');
  assert.strictEqual(result.region, 'ORIENTE');
  assert.strictEqual(result.sucursal_secundaria, 'CTA-TPI-INT-XAL XALAPA');
});

test('clasificarFactura consolida contratista en su distrito real', () => {
  const glosarioMap = {
    'CTA-TPI-DLR-CBA CORDOBA ORIZABA CARLOS MARTINEZ': {
      tipo_sucursal: 'CONTRATISTAS', region: 'ORIENTE',
      sucursal_secundaria: 'CTA-TPI-INT-CBA CORDOBA ORIZABA', tipo_gasto: 'COSTOS DIRECTOS',
    },
  };
  const factura = { sucursal: 'CTA-TPI-DLR-CBA CORDOBA ORIZABA CARLOS MARTINEZ', monto: 500 };
  const result = Calc.clasificarFactura(factura, glosarioMap);
  assert.strictEqual(result.sucursal_secundaria, 'CTA-TPI-INT-CBA CORDOBA ORIZABA');
});

test('clasificarFactura marca SIN_CLASIFICAR cuando la sucursal no está en el glosario', () => {
  const factura = { sucursal: 'CTA-TPI-INT-GCH GDL CHAPULTEPEC', monto: 200 };
  const result = Calc.clasificarFactura(factura, {});
  assert.strictEqual(result.tipo_gasto, 'SIN_CLASIFICAR');
  assert.strictEqual(result.region, null);
});
```

- [ ] **Step 3: Correr los tests y verificar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 5`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add clasificarFactura with tests"
```

---

### Task 7: `calc.js` — prorrateo de gasto operativo

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.js`

**Interfaces:**
- Consumes: `Calc.clasificarFactura` (Task 6).
- Produces: `Calc.calcularProrrateo(facturas, glosarioMap)` → `{ distritos: [{ distrito, costoDirecto, folios, gastoOperativoAsignado, totalProrrateado }], gastoOperativoBolsaTotal, bolsas }`. Usado por Task 13 (vista Por Sucursal/Distrito).

- [ ] **Step 1: Agregar la función a `calc.js`**

```js
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
```

Y actualizar el `return` final:

```js
  return {
    computeVentana,
    clasificarFactura,
    calcularProrrateo,
  };
```

- [ ] **Step 2: Agregar los tests**

```js
// agregar a calc.test.js

test('calcularProrrateo reparte una bolsa nacional entre todos los distritos por folios', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'DIST-B': { region: 'ORIENTE', sucursal_secundaria: 'DIST-B', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-NACIONAL': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', monto: 100 },
    { sucursal: 'DIST-A', monto: 100 },
    { sucursal: 'DIST-A', monto: 100 },
    { sucursal: 'DIST-B', monto: 200 },
    { sucursal: 'BOLSA-NACIONAL', monto: 400 },
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
    { sucursal: 'DIST-A', monto: 100 },
    { sucursal: 'DIST-B', monto: 100 },
    { sucursal: 'BOLSA-BAJIO', monto: 500 },
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
    { sucursal: 'DIST-A', monto: 100, factura: null },
    { sucursal: 'DIST-A', monto: 100, factura: null },
    { sucursal: 'DIST-A', monto: 100, factura: 'F-1' },
  ];
  const result = Calc.calcularProrrateo(facturas, glosarioMap);
  const distA = result.distritos.find((d) => d.distrito === 'DIST-A');
  assert.strictEqual(distA.folios, 3);
});
```

- [ ] **Step 3: Correr los tests y verificar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 8`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add calcularProrrateo with regional/national scope tests"
```

---

### Task 8: `calc.js` — agregación de KPIs por periodo

**Files:**
- Modify: `calc.js`
- Modify: `calc.test.js`

**Interfaces:**
- Consumes: `Calc.clasificarFactura` (Task 6).
- Produces: `Calc.calcularKPIs(facturasClasificadas)` → `{ totalPagado, costoDirecto, gastoOperativo, sinClasificar }`. Usado por Task 12 (Resumen Ejecutivo) para el periodo actual y el anterior, comparando ambos resultados en la UI.

- [ ] **Step 1: Agregar la función a `calc.js`**

```js
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
```

Y actualizar el `return` final:

```js
  return {
    computeVentana,
    clasificarFactura,
    calcularProrrateo,
    calcularKPIs,
  };
```

- [ ] **Step 2: Agregar los tests**

```js
// agregar a calc.test.js

test('calcularKPIs suma correctamente costo directo, operativo y sin clasificar', () => {
  const glosarioMap = {
    'DIST-A': { region: 'BAJIO', sucursal_secundaria: 'DIST-A', tipo_gasto: 'COSTOS DIRECTOS' },
    'BOLSA-X': { region: 'NACIONAL', tipo_gasto: 'GASTOS OPERATIVOS' },
  };
  const facturas = [
    { sucursal: 'DIST-A', monto: 1000 },
    { sucursal: 'BOLSA-X', monto: 500 },
    { sucursal: 'DESCONOCIDA', monto: 50 },
  ];
  const result = Calc.calcularKPIs(facturas, glosarioMap);
  assert.strictEqual(result.totalPagado, 1550);
  assert.strictEqual(result.costoDirecto, 1000);
  assert.strictEqual(result.gastoOperativo, 500);
  assert.strictEqual(result.sinClasificar, 50);
});
```

- [ ] **Step 3: Correr los tests y verificar que pasan**

Run: `node --test calc.test.js`
Expected: `# pass 9`, `# fail 0`

- [ ] **Step 4: Commit**

```bash
git add calc.js calc.test.js
git commit -m "Add calcularKPIs with tests"
```

---

### Task 9: Shell de la aplicación — login, sesión y navegación

**Files:**
- Create: `index.html`

**Interfaces:**
- Consumes: `calc.js` (via `<script src="calc.js">`, expone `window.Calc`).
- Produces: variable global `supabaseClient` (cliente Supabase JS inicializado), función `mostrarVista(nombre)` para cambiar entre vistas, guardas de sesión que redirigen a login si no hay `auth.getSession()`.

- [ ] **Step 1: Escribir el shell HTML con login, sidebar y router simple**

```html
<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>QiORA Conecta — Auditoría de Gastos</title>
<script src="https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2"></script>
<script src="https://cdn.jsdelivr.net/npm/chart.js@4"></script>
<script src="https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js"></script>
<script src="calc.js"></script>
<style>
  * { box-sizing: border-box; }
  body { margin: 0; font-family: 'Inter', system-ui, sans-serif; background: #0f1117; color: #e6e8ec; }
  #login-screen { display: flex; align-items: center; justify-content: center; height: 100vh; }
  #login-card { background: #171a23; padding: 32px; border-radius: 12px; width: 320px; }
  #login-card input { width: 100%; padding: 10px; margin: 8px 0; border-radius: 6px; border: 1px solid #2a2e3a; background: #0f1117; color: #e6e8ec; }
  #login-card button { width: 100%; padding: 10px; border-radius: 6px; border: none; background: #E85420; color: white; font-weight: 600; cursor: pointer; }
  #app-shell { display: none; }
  #sidebar { position: fixed; left: 0; top: 0; bottom: 0; width: 220px; background: #171a23; padding: 20px 12px; }
  #sidebar button { display: block; width: 100%; text-align: left; padding: 10px 12px; margin-bottom: 4px; background: transparent; border: none; color: #b0b4c0; border-radius: 6px; cursor: pointer; }
  #sidebar button.activo { background: #E85420; color: white; }
  #contenido { margin-left: 220px; padding: 24px; }
  .vista { display: none; }
  .vista.activa { display: block; }
</style>
</head>
<body>

<div id="login-screen">
  <div id="login-card">
    <h2>QiORA Conecta</h2>
    <p>Auditoría de Gastos</p>
    <input id="login-email" type="email" placeholder="Correo">
    <input id="login-password" type="password" placeholder="Contraseña">
    <button onclick="iniciarSesion()">Entrar</button>
    <p id="login-error" style="color:#ff6b6b;"></p>
  </div>
</div>

<div id="app-shell">
  <div id="sidebar">
    <button data-vista="resumen" onclick="mostrarVista('resumen')">Resumen Ejecutivo</button>
    <button data-vista="tipo-gasto" onclick="mostrarVista('tipo-gasto')">Por Tipo de Gasto</button>
    <button data-vista="sucursal" onclick="mostrarVista('sucursal')">Por Sucursal/Distrito</button>
    <button data-vista="sin-clasificar" onclick="mostrarVista('sin-clasificar')">Sin Clasificar</button>
    <button data-vista="glosario" onclick="mostrarVista('glosario')">Glosario de Sucursales</button>
    <button data-vista="cargar" id="nav-cargar" onclick="mostrarVista('cargar')">Cargar Datos</button>
    <button onclick="cerrarSesion()" style="margin-top: 24px; color: #ff6b6b;">Cerrar sesión</button>
  </div>
  <div id="contenido">
    <div class="vista activa" id="vista-resumen"><h1>Resumen Ejecutivo</h1></div>
    <div class="vista" id="vista-tipo-gasto"><h1>Por Tipo de Gasto</h1></div>
    <div class="vista" id="vista-sucursal"><h1>Por Sucursal/Distrito</h1></div>
    <div class="vista" id="vista-sin-clasificar"><h1>Sin Clasificar</h1></div>
    <div class="vista" id="vista-glosario"><h1>Glosario de Sucursales</h1></div>
    <div class="vista" id="vista-cargar"><h1>Cargar Datos</h1></div>
  </div>
</div>

<script>
const SUPABASE_URL = 'https://TU-PROYECTO.supabase.co';
const SUPABASE_ANON_KEY = 'TU-ANON-KEY';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

let usuarioActual = null;

async function iniciarSesion() {
  const email = document.getElementById('login-email').value;
  const password = document.getElementById('login-password').value;
  const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
  if (error) {
    document.getElementById('login-error').textContent = 'Credenciales inválidas';
    return;
  }
  await cargarSesion();
}

async function cerrarSesion() {
  await supabaseClient.auth.signOut();
  location.reload();
}

async function cargarSesion() {
  const { data: { session } } = await supabaseClient.auth.getSession();
  if (!session) {
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('app-shell').style.display = 'none';
    return;
  }
  const { data: perfil } = await supabaseClient
    .from('usuarios')
    .select('nombre, rol')
    .eq('id', session.user.id)
    .single();
  usuarioActual = perfil;
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  if (perfil.rol !== 'admin') {
    document.getElementById('nav-cargar').style.display = 'none';
  }
  mostrarVista('resumen');
}

function mostrarVista(nombre) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
  document.querySelectorAll('#sidebar button[data-vista]').forEach((b) => b.classList.remove('activo'));
  document.getElementById('vista-' + nombre).classList.add('activa');
  const boton = document.querySelector('#sidebar button[data-vista="' + nombre + '"]');
  if (boton) boton.classList.add('activo');
}

cargarSesion();
</script>
</body>
</html>
```

- [ ] **Step 2: Verificación manual**

Decirle a Giacomo: "Reemplaza `SUPABASE_URL` y `SUPABASE_ANON_KEY` con los valores de tu proyecto (Supabase Dashboard → Settings → API), y crea tu primer usuario admin insertando manualmente en `auth.users` (o vía Supabase Auth) y en la tabla `usuarios` con `rol = 'admin'`. Luego abre `index.html` en el navegador y confirma que el login funciona y que ves el sidebar tras entrar."

- [ ] **Step 3: Commit**

```bash
git add index.html
git commit -m "Add app shell: login, session guard, sidebar navigation"
```

---

### Task 10: Vista "Cargar Datos"

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.computeVentana` (Task 5), `supabaseClient` (Task 9).
- Produces: flujo completo de carga semanal de facturas.

- [ ] **Step 1: Agregar el HTML de la vista**

Reemplazar el contenido de `<div class="vista" id="vista-cargar">`:

```html
<div class="vista" id="vista-cargar">
  <h1>Cargar Datos</h1>
  <p>Sube el Excel completo descargado de Siva (mínimo últimos 6 meses o año en curso).</p>
  <input type="file" id="input-excel" accept=".xlsx,.xls">
  <div id="preview-carga" style="display:none; margin-top: 16px;">
    <p>Rango detectado: <strong id="preview-rango"></strong></p>
    <p>Filas a cargar: <strong id="preview-filas"></strong></p>
    <p style="color:#ffb020;">Esto reemplazará todas las facturas existentes con fecha de pago en ese rango.</p>
    <button onclick="confirmarCarga()">Confirmar y reemplazar</button>
  </div>
  <p id="estado-carga"></p>
</div>
```

- [ ] **Step 2: Agregar el JS de parseo y carga**

Agregar antes de `cargarSesion();` en el `<script>` principal:

```js
let filasParaCargar = null;
let ventanaParaCargar = null;

document.getElementById('input-excel').addEventListener('change', function (evento) {
  const archivo = evento.target.files[0];
  if (!archivo) return;
  const lector = new FileReader();
  lector.onload = function (e) {
    const libro = XLSX.read(e.target.result, { type: 'array', cellDates: true });
    const hoja = libro.Sheets[libro.SheetNames[0]];
    const filas = XLSX.utils.sheet_to_json(hoja);

    filasParaCargar = filas.map((fila) => ({
      familia: fila['FAMILIA'] || null,
      gasto: fila['GASTO'] || null,
      empresa: fila['EMPRESA'] || null,
      sucursal: fila['SUCURSAL'] || null,
      proveedor: fila['PROVEEDOR'] || null,
      factura: fila['FACTURA'] || null,
      subtotal: fila['SUBTOTAL'] ?? null,
      iva: fila['IVA'] ?? null,
      descuento: fila['DESCUENTO'] ?? null,
      monto: fila['MONTO'] ?? null,
      fecha_alta: fila['FECHA ALTA'] ? new Date(fila['FECHA ALTA']).toISOString().slice(0, 10) : null,
      fecha_pago: new Date(fila['FECHA DE PAGO']).toISOString().slice(0, 10),
      tipo_gasto_categoria: fila['TIPO DE GASTO'] || null,
      linea_negocio: fila['LÍNEA DE NEGOCIO'] || null,
      negocio: fila['NEGOCIO'] || 'CONECTA',
    }));

    ventanaParaCargar = Calc.computeVentana(filasParaCargar);
    document.getElementById('preview-rango').textContent = ventanaParaCargar.fechaMin + ' a ' + ventanaParaCargar.fechaMax;
    document.getElementById('preview-filas').textContent = filasParaCargar.length;
    document.getElementById('preview-carga').style.display = 'block';
  };
  lector.readAsArrayBuffer(archivo);
});

async function confirmarCarga() {
  document.getElementById('estado-carga').textContent = 'Cargando...';
  const { error } = await supabaseClient.rpc('reemplazar_facturas', {
    filas: filasParaCargar,
    p_fecha_min: ventanaParaCargar.fechaMin,
    p_fecha_max: ventanaParaCargar.fechaMax,
  });
  if (error) {
    document.getElementById('estado-carga').textContent = 'Error: ' + error.message;
    return;
  }
  document.getElementById('estado-carga').textContent = 'Carga completada: ' + filasParaCargar.length + ' filas.';
  document.getElementById('preview-carga').style.display = 'none';
}
```

- [ ] **Step 3: Verificación manual**

Decirle a Giacomo: "Abre la vista 'Cargar Datos' con tu usuario admin, sube un Excel de prueba pequeño (5-10 filas con el mismo formato de columnas de Siva) y confirma que el rango detectado y el conteo de filas se ven correctos antes de confirmar la carga. Luego verifica en Supabase que las filas quedaron insertadas."

- [ ] **Step 4: Commit**

```bash
git add index.html
git commit -m "Add Cargar Datos view: parse Excel, detect date window, call replace RPC"
```

---

### Task 11: Vista "Glosario de Sucursales" (CRUD)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `supabaseClient` (Task 9).
- Produces: tabla editable de `glosario_sucursales`, usada como fuente por el resto de vistas para construir `glosarioMap`.

- [ ] **Step 1: Agregar el HTML de la vista**

Reemplazar el contenido de `<div class="vista" id="vista-glosario">`:

```html
<div class="vista" id="vista-glosario">
  <h1>Glosario de Sucursales</h1>
  <button onclick="mostrarFormularioGlosario()">+ Agregar sucursal</button>
  <div id="form-glosario" style="display:none; margin: 12px 0;">
    <input id="glosario-sucursal" placeholder="Sucursal (código completo)">
    <input id="glosario-tipo-sucursal" placeholder="Tipo de sucursal">
    <input id="glosario-region" placeholder="Región">
    <input id="glosario-sucursal-secundaria" placeholder="Sucursal secundaria (distrito real)">
    <select id="glosario-tipo-gasto">
      <option value="COSTOS DIRECTOS">COSTOS DIRECTOS</option>
      <option value="GASTOS OPERATIVOS">GASTOS OPERATIVOS</option>
    </select>
    <button onclick="guardarGlosario()">Guardar</button>
  </div>
  <table id="tabla-glosario">
    <thead><tr><th>Sucursal</th><th>Tipo</th><th>Región</th><th>Sucursal secundaria</th><th>Tipo de gasto</th><th></th></tr></thead>
    <tbody id="tabla-glosario-body"></tbody>
  </table>
</div>
```

- [ ] **Step 2: Agregar el JS de listado y edición**

```js
let glosarioActual = [];

async function cargarGlosario() {
  const { data, error } = await supabaseClient.from('glosario_sucursales').select('*').order('sucursal');
  if (error) { console.error(error); return; }
  glosarioActual = data;
  const cuerpo = document.getElementById('tabla-glosario-body');
  cuerpo.innerHTML = '';
  data.forEach((fila) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${fila.sucursal}</td><td>${fila.tipo_sucursal || ''}</td><td>${fila.region || ''}</td><td>${fila.sucursal_secundaria || ''}</td><td>${fila.tipo_gasto || ''}</td>
      <td>${usuarioActual && usuarioActual.rol === 'admin' ? '<button onclick="editarGlosario(\'' + fila.sucursal.replace(/'/g, "\\'") + '\')">Editar</button>' : ''}</td>`;
    cuerpo.appendChild(tr);
  });
}

function obtenerGlosarioMap() {
  const mapa = {};
  glosarioActual.forEach((fila) => { mapa[fila.sucursal] = fila; });
  return mapa;
}

function mostrarFormularioGlosario() {
  document.getElementById('form-glosario').style.display = 'block';
  document.getElementById('glosario-sucursal').value = '';
  document.getElementById('glosario-tipo-sucursal').value = '';
  document.getElementById('glosario-region').value = '';
  document.getElementById('glosario-sucursal-secundaria').value = '';
}

function editarGlosario(sucursal) {
  const fila = glosarioActual.find((f) => f.sucursal === sucursal);
  if (!fila) return;
  document.getElementById('form-glosario').style.display = 'block';
  document.getElementById('glosario-sucursal').value = fila.sucursal;
  document.getElementById('glosario-tipo-sucursal').value = fila.tipo_sucursal || '';
  document.getElementById('glosario-region').value = fila.region || '';
  document.getElementById('glosario-sucursal-secundaria').value = fila.sucursal_secundaria || '';
  document.getElementById('glosario-tipo-gasto').value = fila.tipo_gasto || 'COSTOS DIRECTOS';
}

async function guardarGlosario() {
  const registro = {
    sucursal: document.getElementById('glosario-sucursal').value,
    tipo_sucursal: document.getElementById('glosario-tipo-sucursal').value,
    region: document.getElementById('glosario-region').value,
    sucursal_secundaria: document.getElementById('glosario-sucursal-secundaria').value,
    tipo_gasto: document.getElementById('glosario-tipo-gasto').value,
  };
  const { error } = await supabaseClient.from('glosario_sucursales').upsert(registro);
  if (error) { alert('Error: ' + error.message); return; }
  document.getElementById('form-glosario').style.display = 'none';
  await cargarGlosario();
}
```

- [ ] **Step 3: Llamar `cargarGlosario()` dentro de `cargarSesion()`**

Agregar `await cargarGlosario();` justo antes de `mostrarVista('resumen');` en `cargarSesion()`.

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Entra a 'Glosario de Sucursales' y confirma que ves las 63 sucursales cargadas por el seed. Agrega una sucursal nueva de prueba (por ejemplo, una de las 29 sin clasificar que detectamos) y confirma que aparece en la tabla."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Glosario de Sucursales CRUD view"
```

---

### Task 12: Vista "Resumen Ejecutivo"

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.calcularKPIs` (Task 8), `obtenerGlosarioMap()` (Task 11), `supabaseClient` (Task 9).
- Produces: KPIs del mes actual vs. mes anterior + gráfica de composición mensual.

- [ ] **Step 1: Agregar el HTML de la vista**

```html
<div class="vista" id="vista-resumen">
  <h1>Resumen Ejecutivo</h1>
  <div id="kpis-resumen" style="display:flex; gap:16px;">
    <div class="kpi-card"><p>Gasto Total</p><h2 id="kpi-total">-</h2><span id="kpi-total-var"></span></div>
    <div class="kpi-card"><p>Costo Directo</p><h2 id="kpi-directo">-</h2></div>
    <div class="kpi-card"><p>Gasto Operativo</p><h2 id="kpi-operativo">-</h2></div>
    <div class="kpi-card"><p>Sin Clasificar</p><h2 id="kpi-sin-clasificar">-</h2></div>
  </div>
  <canvas id="grafica-composicion-mensual" height="100"></canvas>
</div>
```

- [ ] **Step 2: Agregar el JS de carga de datos y renderizado**

```js
function primerYUltimoDiaMes(offsetMeses) {
  const hoy = new Date();
  const base = new Date(hoy.getFullYear(), hoy.getMonth() + offsetMeses, 1);
  const primero = new Date(base.getFullYear(), base.getMonth(), 1);
  const ultimo = new Date(base.getFullYear(), base.getMonth() + 1, 0);
  return {
    inicio: primero.toISOString().slice(0, 10),
    fin: ultimo.toISOString().slice(0, 10),
  };
}

function formatoMoneda(valor) {
  return new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 }).format(valor);
}

async function cargarResumenEjecutivo() {
  const glosarioMap = obtenerGlosarioMap();
  const mesActual = primerYUltimoDiaMes(0);
  const mesAnterior = primerYUltimoDiaMes(-1);

  const [{ data: facturasActual }, { data: facturasAnterior }] = await Promise.all([
    supabaseClient.from('facturas').select('*').gte('fecha_pago', mesActual.inicio).lte('fecha_pago', mesActual.fin),
    supabaseClient.from('facturas').select('*').gte('fecha_pago', mesAnterior.inicio).lte('fecha_pago', mesAnterior.fin),
  ]);

  const kpisActual = Calc.calcularKPIs(facturasActual || [], glosarioMap);
  const kpisAnterior = Calc.calcularKPIs(facturasAnterior || [], glosarioMap);

  document.getElementById('kpi-total').textContent = formatoMoneda(kpisActual.totalPagado);
  document.getElementById('kpi-directo').textContent = formatoMoneda(kpisActual.costoDirecto);
  document.getElementById('kpi-operativo').textContent = formatoMoneda(kpisActual.gastoOperativo);
  document.getElementById('kpi-sin-clasificar').textContent = formatoMoneda(kpisActual.sinClasificar);

  const variacion = kpisAnterior.totalPagado === 0 ? 0 : ((kpisActual.totalPagado - kpisAnterior.totalPagado) / kpisAnterior.totalPagado) * 100;
  document.getElementById('kpi-total-var').textContent = (variacion >= 0 ? '+' : '') + variacion.toFixed(1) + '% vs. mes anterior';

  const ctx = document.getElementById('grafica-composicion-mensual');
  if (window.graficaComposicion) window.graficaComposicion.destroy();
  window.graficaComposicion = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ['Mes anterior', 'Mes actual'],
      datasets: [
        { label: 'Costo Directo', data: [kpisAnterior.costoDirecto, kpisActual.costoDirecto], backgroundColor: '#E85420' },
        { label: 'Gasto Operativo', data: [kpisAnterior.gastoOperativo, kpisActual.gastoOperativo], backgroundColor: '#2a2e3a' },
      ],
    },
    options: { scales: { x: { stacked: true }, y: { stacked: true } } },
  });
}
```

- [ ] **Step 3: Llamar `cargarResumenEjecutivo()` al mostrar la vista**

Modificar `mostrarVista` para disparar la carga de datos cuando corresponda:

```js
function mostrarVista(nombre) {
  document.querySelectorAll('.vista').forEach((v) => v.classList.remove('activa'));
  document.querySelectorAll('#sidebar button[data-vista]').forEach((b) => b.classList.remove('activo'));
  document.getElementById('vista-' + nombre).classList.add('activa');
  const boton = document.querySelector('#sidebar button[data-vista="' + nombre + '"]');
  if (boton) boton.classList.add('activo');
  if (nombre === 'resumen') cargarResumenEjecutivo();
}
```

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Entra al Resumen Ejecutivo con datos de prueba cargados y confirma que los KPIs y la gráfica de composición mensual muestran cifras coherentes con lo que subiste."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Resumen Ejecutivo view with KPIs and monthly composition chart"
```

---

### Task 13: Vista "Por Sucursal/Distrito" con toggle Bolsa/Prorrateado

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.calcularProrrateo` (Task 7), `obtenerGlosarioMap()` (Task 11).
- Produces: tabla de los 17 distritos con costo directo, gasto operativo (bolsa o prorrateado según toggle) y total.

- [ ] **Step 1: Agregar el HTML de la vista**

```html
<div class="vista" id="vista-sucursal">
  <h1>Por Sucursal / Distrito</h1>
  <label><input type="radio" name="modo-prorrateo" value="bolsa" checked onchange="renderizarSucursales()"> Bolsa</label>
  <label><input type="radio" name="modo-prorrateo" value="prorrateado" onchange="renderizarSucursales()"> Prorrateado</label>
  <table id="tabla-sucursales">
    <thead><tr><th>Distrito</th><th>Costo Directo</th><th>Gasto Operativo</th><th>Total</th></tr></thead>
    <tbody id="tabla-sucursales-body"></tbody>
  </table>
  <p id="bolsa-total-info"></p>
</div>
```

- [ ] **Step 2: Agregar el JS**

```js
let prorrateoActual = null;

async function cargarPorSucursal() {
  const glosarioMap = obtenerGlosarioMap();
  const mesActual = primerYUltimoDiaMes(0);
  const { data: facturas } = await supabaseClient
    .from('facturas').select('*')
    .gte('fecha_pago', mesActual.inicio).lte('fecha_pago', mesActual.fin);
  prorrateoActual = Calc.calcularProrrateo(facturas || [], glosarioMap);
  renderizarSucursales();
}

function renderizarSucursales() {
  if (!prorrateoActual) return;
  const modo = document.querySelector('input[name="modo-prorrateo"]:checked').value;
  const cuerpo = document.getElementById('tabla-sucursales-body');
  cuerpo.innerHTML = '';
  prorrateoActual.distritos.forEach((d) => {
    const operativo = modo === 'prorrateado' ? d.gastoOperativoAsignado : 0;
    const total = modo === 'prorrateado' ? d.totalProrrateado : d.costoDirecto;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${d.distrito}</td><td>${formatoMoneda(d.costoDirecto)}</td><td>${formatoMoneda(operativo)}</td><td>${formatoMoneda(total)}</td>`;
    cuerpo.appendChild(tr);
  });
  document.getElementById('bolsa-total-info').textContent = modo === 'bolsa'
    ? 'Gasto operativo total sin asignar: ' + formatoMoneda(prorrateoActual.gastoOperativoBolsaTotal)
    : '';
}
```

- [ ] **Step 3: Disparar la carga desde `mostrarVista`**

```js
  if (nombre === 'sucursal') cargarPorSucursal();
```

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Entra a 'Por Sucursal/Distrito', alterna entre 'Bolsa' y 'Prorrateado' y confirma que en modo Bolsa el gasto operativo se muestra en cero por distrito (con el total agregado abajo), y en modo Prorrateado se reparte según folios."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Por Sucursal/Distrito view with bolsa/prorrateado toggle"
```

---

### Task 14: Vista "Por Tipo de Gasto" (drill-down Familia → Gasto)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `supabaseClient` (Task 9).
- Produces: tabla agrupada por `familia` con expansión a `gasto`.

- [ ] **Step 1: Agregar el HTML de la vista**

```html
<div class="vista" id="vista-tipo-gasto">
  <h1>Por Tipo de Gasto</h1>
  <table id="tabla-tipo-gasto">
    <thead><tr><th>Familia</th><th>Monto</th></tr></thead>
    <tbody id="tabla-tipo-gasto-body"></tbody>
  </table>
</div>
```

- [ ] **Step 2: Agregar el JS de agregación y expansión**

```js
async function cargarPorTipoGasto() {
  const mesActual = primerYUltimoDiaMes(0);
  const { data: facturas } = await supabaseClient
    .from('facturas').select('familia, gasto, monto')
    .gte('fecha_pago', mesActual.inicio).lte('fecha_pago', mesActual.fin);

  const porFamilia = {};
  (facturas || []).forEach((f) => {
    porFamilia[f.familia] = porFamilia[f.familia] || { total: 0, porGasto: {} };
    porFamilia[f.familia].total += f.monto || 0;
    porFamilia[f.familia].porGasto[f.gasto] = (porFamilia[f.familia].porGasto[f.gasto] || 0) + (f.monto || 0);
  });

  const cuerpo = document.getElementById('tabla-tipo-gasto-body');
  cuerpo.innerHTML = '';
  Object.keys(porFamilia).sort((a, b) => porFamilia[b].total - porFamilia[a].total).forEach((familia) => {
    const filaFamilia = document.createElement('tr');
    filaFamilia.style.cursor = 'pointer';
    filaFamilia.innerHTML = `<td>▸ ${familia}</td><td>${formatoMoneda(porFamilia[familia].total)}</td>`;
    filaFamilia.onclick = () => alternarDetalleGasto(familia);
    cuerpo.appendChild(filaFamilia);

    const filaDetalle = document.createElement('tr');
    filaDetalle.id = 'detalle-' + familia.replace(/\s/g, '-');
    filaDetalle.style.display = 'none';
    const subfilas = Object.keys(porFamilia[familia].porGasto)
      .sort((a, b) => porFamilia[familia].porGasto[b] - porFamilia[familia].porGasto[a])
      .map((gasto) => `<div>${gasto}: ${formatoMoneda(porFamilia[familia].porGasto[gasto])}</div>`)
      .join('');
    filaDetalle.innerHTML = `<td colspan="2">${subfilas}</td>`;
    cuerpo.appendChild(filaDetalle);
  });
}

function alternarDetalleGasto(familia) {
  const el = document.getElementById('detalle-' + familia.replace(/\s/g, '-'));
  el.style.display = el.style.display === 'none' ? 'table-row' : 'none';
}
```

- [ ] **Step 3: Disparar la carga desde `mostrarVista`**

```js
  if (nombre === 'tipo-gasto') cargarPorTipoGasto();
```

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Entra a 'Por Tipo de Gasto', confirma que ves las familias ordenadas por monto descendente, y que al hacer clic en una familia se expande el desglose por 'gasto'."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Por Tipo de Gasto view with Familia to Gasto drill-down"
```

---

### Task 15: Vista "Sin Clasificar"

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: `Calc.clasificarFactura` (Task 6), `obtenerGlosarioMap()` (Task 11).
- Produces: lista de sucursales sin match en el glosario, con monto y conteo, del mes actual.

- [ ] **Step 1: Agregar el HTML de la vista**

```html
<div class="vista" id="vista-sin-clasificar">
  <h1>Sin Clasificar</h1>
  <p>Sucursales que aparecen en las facturas pero no están en el glosario. Agrégalas desde "Glosario de Sucursales".</p>
  <table id="tabla-sin-clasificar">
    <thead><tr><th>Sucursal</th><th>Facturas</th><th>Monto</th></tr></thead>
    <tbody id="tabla-sin-clasificar-body"></tbody>
  </table>
</div>
```

- [ ] **Step 2: Agregar el JS**

```js
async function cargarSinClasificar() {
  const glosarioMap = obtenerGlosarioMap();
  const mesActual = primerYUltimoDiaMes(0);
  const { data: facturas } = await supabaseClient
    .from('facturas').select('*')
    .gte('fecha_pago', mesActual.inicio).lte('fecha_pago', mesActual.fin);

  const porSucursal = {};
  (facturas || []).forEach((raw) => {
    const f = Calc.clasificarFactura(raw, glosarioMap);
    if (f.tipo_gasto !== 'SIN_CLASIFICAR') return;
    porSucursal[f.sucursal] = porSucursal[f.sucursal] || { count: 0, monto: 0 };
    porSucursal[f.sucursal].count += 1;
    porSucursal[f.sucursal].monto += f.monto || 0;
  });

  const cuerpo = document.getElementById('tabla-sin-clasificar-body');
  cuerpo.innerHTML = '';
  Object.keys(porSucursal).sort((a, b) => porSucursal[b].monto - porSucursal[a].monto).forEach((sucursal) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${sucursal}</td><td>${porSucursal[sucursal].count}</td><td>${formatoMoneda(porSucursal[sucursal].monto)}</td>`;
    cuerpo.appendChild(tr);
  });
}
```

- [ ] **Step 3: Disparar la carga desde `mostrarVista`**

```js
  if (nombre === 'sin-clasificar') cargarSinClasificar();
```

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Entra a 'Sin Clasificar' y confirma que lista las sucursales de facturas del mes actual que no están en el glosario (si subiste datos que incluyen alguna de las 29 detectadas originalmente, deberían aparecer aquí)."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add Sin Clasificar view for invoices without glosario match"
```

---

### Task 16: Filtro de tiempo global (selector de mes / YTD / rango libre)

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: nada nuevo — reemplaza las llamadas directas a `primerYUltimoDiaMes(0)` dentro de `cargarResumenEjecutivo`, `cargarPorSucursal`, `cargarPorTipoGasto` y `cargarSinClasificar` (Tasks 12-15).
- Produces: `obtenerRangoActivo()` → `{ inicio: 'YYYY-MM-DD', fin: 'YYYY-MM-DD' }`, y un selector en la barra superior que dispara `recargarVistaActiva()` al cambiar.

- [ ] **Step 1: Agregar el HTML del selector en la parte superior de `#contenido`**

Insertar como primer hijo de `<div id="contenido">`, antes de las vistas:

```html
<div id="filtro-tiempo" style="margin-bottom: 16px;">
  <select id="filtro-tiempo-tipo" onchange="cambiarFiltroTiempo()">
    <option value="mes-actual">Mes actual vs. mes anterior</option>
    <option value="ytd">Acumulado del año (YTD)</option>
    <option value="rango">Rango personalizado</option>
  </select>
  <span id="filtro-rango-personalizado" style="display:none;">
    <input type="date" id="filtro-fecha-inicio">
    <input type="date" id="filtro-fecha-fin">
    <button onclick="aplicarRangoPersonalizado()">Aplicar</button>
  </span>
</div>
```

- [ ] **Step 2: Agregar la lógica del selector**

```js
let rangoActivoTipo = 'mes-actual';
let rangoPersonalizado = null;

function obtenerRangoActivo() {
  if (rangoActivoTipo === 'rango' && rangoPersonalizado) {
    return rangoPersonalizado;
  }
  if (rangoActivoTipo === 'ytd') {
    const hoy = new Date();
    return {
      inicio: new Date(hoy.getFullYear(), 0, 1).toISOString().slice(0, 10),
      fin: hoy.toISOString().slice(0, 10),
    };
  }
  return primerYUltimoDiaMes(0);
}

function cambiarFiltroTiempo() {
  rangoActivoTipo = document.getElementById('filtro-tiempo-tipo').value;
  document.getElementById('filtro-rango-personalizado').style.display = rangoActivoTipo === 'rango' ? 'inline' : 'none';
  if (rangoActivoTipo !== 'rango') recargarVistaActiva();
}

function aplicarRangoPersonalizado() {
  rangoPersonalizado = {
    inicio: document.getElementById('filtro-fecha-inicio').value,
    fin: document.getElementById('filtro-fecha-fin').value,
  };
  recargarVistaActiva();
}

function recargarVistaActiva() {
  const vistaActiva = document.querySelector('#sidebar button.activo');
  if (vistaActiva) mostrarVista(vistaActiva.dataset.vista);
}
```

- [ ] **Step 3: Reemplazar `primerYUltimoDiaMes(0)` por `obtenerRangoActivo()` en las 4 vistas**

En `cargarResumenEjecutivo` (Task 12), reemplazar:
```js
  const mesActual = primerYUltimoDiaMes(0);
  const mesAnterior = primerYUltimoDiaMes(-1);
```
por:
```js
  const mesActual = obtenerRangoActivo();
  const mesAnterior = primerYUltimoDiaMes(-1);
```

En `cargarPorSucursal` (Task 13), `cargarPorTipoGasto` (Task 14) y `cargarSinClasificar` (Task 15), reemplazar cada `const mesActual = primerYUltimoDiaMes(0);` por `const mesActual = obtenerRangoActivo();`.

- [ ] **Step 4: Verificación manual**

Decirle a Giacomo: "Cambia el selector a 'Acumulado del año (YTD)' y confirma que el Resumen Ejecutivo y las demás vistas recalculan sobre todo el año en curso. Luego prueba 'Rango personalizado' con dos fechas y confirma que también recalcula correctamente."

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add global time filter selector (mes actual/YTD/rango libre) wired to all views"
```

---

### Task 17: Verificación final de roles y checklist de humo

**Files:**
- No se crean archivos nuevos; solo verificación end-to-end.

**Interfaces:**
- Consumes: todas las tareas anteriores.

- [ ] **Step 1: Checklist de verificación manual (Giacomo lo corre y reporta resultados)**

1. Login con usuario `admin`: ve las 6 vistas del sidebar, incluyendo "Cargar Datos".
2. Crear un segundo usuario con `rol = 'finanzas'` en Supabase (mismo patrón que en `SistemaBonos`) e iniciar sesión con él: confirmar que "Cargar Datos" NO aparece en el sidebar, y que intentar `supabaseClient.from('facturas').insert(...)` manualmente desde la consola del navegador falla por RLS.
3. Con el usuario `admin`, subir un Excel de prueba de ~20 filas cubriendo 2 distritos y 1 bolsa operativa nacional; confirmar que "Resumen Ejecutivo", "Por Sucursal/Distrito" (ambos modos) y "Por Tipo de Gasto" muestran cifras consistentes entre sí (la suma de costo directo + gasto operativo de "Por Sucursal/Distrito" en modo prorrateado debe igualar el total de "Resumen Ejecutivo").
4. Confirmar que subir un segundo Excel con fechas traslapadas reemplaza correctamente solo esas fechas (verificar en Supabase que las facturas fuera del rango del segundo archivo siguen intactas).

- [ ] **Step 2: Actualizar `CONTEXT.md` con el estado final**

Modificar la sección "## Estado" de `CONTEXT.md` para reflejar que la v1 del dashboard está implementada y en pruebas con datos reales.

- [ ] **Step 3: Commit final**

```bash
git add CONTEXT.md
git commit -m "Update CONTEXT.md: v1 implemented, in manual testing"
```
