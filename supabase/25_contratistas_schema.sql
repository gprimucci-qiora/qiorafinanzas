-- supabase/25_contratistas_schema.sql
-- Estado de cuenta mensual de contratistas de instalación (folios, comisiones pagadas,
-- adicionales/descuentos). Se alimenta de dos Excel mensuales: uno "general" (una hoja por
-- contratista estándar) y uno de Marco Anaya (esquema especial multi-territorio: León, Tepic,
-- Colima, Guadalajara y Veracruz). Fase 1: solo captura de datos crudos, sin cálculo de
-- rentabilidad/potencial todavía (eso queda para una siguiente fase).

-- Detalle a nivel cuadrilla (técnico) por mes. Aplica igual para contratistas estándar y para
-- los técnicos de Marco Anaya en cualquiera de sus territorios (el distrito ya distingue).
create table contratistas_cuadrillas (
  id uuid primary key default gen_random_uuid(),
  contratista text not null,
  mes date not null,
  ffm text not null,
  nombre_tecnico text not null,
  distrito text not null,
  asistencias numeric not null default 0,
  os_totales numeric not null default 0,
  productividad_diaria numeric,
  estrellas numeric not null default 0,
  pago_total numeric not null default 0,
  created_at timestamptz default now(),
  unique (contratista, ffm, mes)
);

-- Desglose del pago de cada cuadrilla por tipo de OS (Instalación, Mantenimiento, etc.),
-- alimenta la distribución de OS por tipo.
create table contratistas_cuadrillas_os_tipo (
  id uuid primary key default gen_random_uuid(),
  contratista text not null,
  mes date not null,
  ffm text not null,
  tipo_os text not null,
  monto numeric not null default 0,
  created_at timestamptz default now(),
  unique (contratista, ffm, mes, tipo_os)
);

-- Resumen mensual por contratista (encabezado del estado de cuenta): KPIs agregados y
-- resumen de facturación. Para Marco Anaya es el consolidado de todos sus territorios.
create table contratistas_resumen_mensual (
  id uuid primary key default gen_random_uuid(),
  contratista text not null,
  mes date not null,
  cuadrillas_activas numeric,
  asistencias_totales numeric,
  os_totales numeric,
  estrellas_totales numeric,
  productividad_promedio numeric,
  os_promedio numeric,
  estrellas_promedio numeric,
  pago_total numeric,
  adicionales_total numeric,
  subtotal_facturar numeric,
  iva numeric,
  total_final numeric,
  created_at timestamptz default now(),
  unique (contratista, mes)
);

-- Líneas de adicionales/descuentos del estado de cuenta (bonos, penalizaciones, arrendamiento,
-- prontos pagos, etc.), a nivel contratista y mes.
create table contratistas_adicionales (
  id uuid primary key default gen_random_uuid(),
  contratista text not null,
  mes date not null,
  concepto text not null,
  monto numeric not null default 0,
  created_at timestamptz default now()
);

alter table contratistas_cuadrillas enable row level security;
alter table contratistas_cuadrillas_os_tipo enable row level security;
alter table contratistas_resumen_mensual enable row level security;
alter table contratistas_adicionales enable row level security;

create policy "contratistas_cuadrillas_select_autenticado" on contratistas_cuadrillas
  for select using (auth.role() = 'authenticated');
create policy "contratistas_cuadrillas_write_admin" on contratistas_cuadrillas
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

create policy "contratistas_cuadrillas_os_tipo_select_autenticado" on contratistas_cuadrillas_os_tipo
  for select using (auth.role() = 'authenticated');
create policy "contratistas_cuadrillas_os_tipo_write_admin" on contratistas_cuadrillas_os_tipo
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

create policy "contratistas_resumen_mensual_select_autenticado" on contratistas_resumen_mensual
  for select using (auth.role() = 'authenticated');
create policy "contratistas_resumen_mensual_write_admin" on contratistas_resumen_mensual
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));

create policy "contratistas_adicionales_select_autenticado" on contratistas_adicionales
  for select using (auth.role() = 'authenticated');
create policy "contratistas_adicionales_write_admin" on contratistas_adicionales
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
