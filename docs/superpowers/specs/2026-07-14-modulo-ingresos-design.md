# Módulo de Ingresos (v1)

**Fecha:** 2026-07-14
**Estado:** Aprobado para planeación de implementación

## 1. Contexto

QiORA Conecta cobra por 3 pólizas de servicio: **Planta Interna**, **Recolecciones** y **Multidistrito**. No se cobra a destajo por orden entregada — se recibe una "iguala" mensual calculada como `precio por orden × órdenes dimensionadas`, definida por distrito (Planta Interna, Recolecciones) o por bolsa regional (Multidistrito). Las notas de crédito por incumplimiento existen pero aplican a facturas por cobrar y **no se modelan en esta versión**.

Este módulo agrega un apartado de Ingresos al dashboard, separado de Gastos, para ver ese ingreso por póliza y por distrito.

## 2. Alcance v1

**Incluye:** Planta Interna, Recolecciones, Multidistrito.
**No incluye (fase futura):** Otros Ingresos (apoyo por viáticos, venta técnico, venta de unidades, otros), Notas de Crédito, y cualquier cálculo de margen (Ingreso − Gasto) — eso es una fase 2 aparte.

## 3. Modelo de datos

Tres tablas nuevas en Supabase, todas con el mismo patrón "vigente desde": la fila con `vigente_desde` más reciente que sea ≤ un mes dado es la que aplica ese mes. Un cambio futuro solo agrega una fila nueva; el pasado nunca se modifica.

```sql
create table poliza_parametros (
  id uuid primary key default gen_random_uuid(),
  poliza text not null check (poliza in ('PLANTA INTERNA', 'RECOLECCIONES')),
  distrito text not null,              -- mismo código que sucursal_secundaria del Glosario
  precio_por_orden numeric not null,
  ordenes_dimensionadas numeric not null,
  vigente_desde date not null,          -- primer día del mes
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
  porcentaje numeric,                   -- informativo, no impulsa el cálculo
  vigente_desde date not null,
  created_at timestamptz default now()
);
```

**RLS** (mismo patrón que `glosario_sucursales`): lectura para cualquier usuario autenticado; inserción/borrado solo para `rol = 'admin'`.

```sql
create policy "poliza_parametros_select_autenticado" on poliza_parametros
  for select using (auth.role() = 'authenticated');
create policy "poliza_parametros_write_admin" on poliza_parametros
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

-- (misma pareja de políticas para multidistrito_bolsas y multidistrito_asignacion)
```

## 4. Lógica de cálculo

Para un (distrito, mes) dado:

- **Ingreso Planta Interna** = precio vigente (`poliza_parametros`, poliza='PLANTA INTERNA', ese distrito, ese mes) × órdenes dimensionadas vigentes.
- **Ingreso Recolecciones** = igual, con poliza='RECOLECCIONES'.
- **Ingreso Multidistrito**:
  1. Se determina la bolsa del distrito según su `región` en el Glosario: mismo nombre, **excepto** `GUADALAJARA` → bolsa `OCCIDENTE`, y `NORTE` → no participa (ingreso Multidistrito = 0, sin bolsa).
  2. `Ingreso Multidistrito del distrito` = órdenes asignadas vigentes (`multidistrito_asignacion`, ese distrito, ese mes) × precio por orden vigente de esa bolsa (`multidistrito_bolsas`, ese mes).
- **Ingreso Total del distrito** = suma de las tres.

Estas funciones se agregan a `calc.js` (mismo archivo y estilo que `calcularProrrateo`/`calcularKPIs`), con sus pruebas en `calc.test.js`.

## 5. Vista "Ingresos"

Nuevo ítem en el sidebar, visible para ambos roles (lectura), con edición restringida a admin (mismo patrón que Glosario de Sucursales).

- **KPIs**: Ingreso Total del periodo (respeta el selector global Mes/YTD ya existente) + desglose por póliza (Planta Interna / Recolecciones / Multidistrito).
- **Tabla por distrito**: Distrito, Planta Interna, Recolecciones, Multidistrito, Total — ordenable por columna (mismo patrón que las demás tablas).
- **Sección admin** ("Actualizar Parámetros"): formulario para agregar una nueva fila vigente desde tal mes — ya sea a `poliza_parametros` (póliza + distrito + precio + órdenes), `multidistrito_bolsas` (bolsa + precio + órdenes), o `multidistrito_asignacion` (distrito + órdenes asignadas + % informativo). Solo inserta; no edita filas existentes (para no alterar el histórico).

## 6. Carga del histórico

El Excel histórico viene en formato "ancho" (36 meses en columnas, no en filas), muy distinto al formato de facturas de Gastos. En vez de un importador dentro del dashboard, se genera un archivo SQL (`supabase/07_seed_ingresos.sql`) con los INSERT ya parseados del Excel, para correr una sola vez en el SQL Editor de Supabase — mismo patrón que el seed inicial del Glosario de Sucursales.

## 7. Fuera de alcance

- Otros Ingresos (viáticos, venta técnico, venta de unidades, otros) — fase futura.
- Notas de Crédito — aplican a cobranza, no a este módulo.
- Margen/Utilidad (Ingreso − Gasto) por distrito — fase futura, una vez validado este módulo.
- Edición en línea de filas históricas de parámetros — solo inserción de nuevas vigencias.
