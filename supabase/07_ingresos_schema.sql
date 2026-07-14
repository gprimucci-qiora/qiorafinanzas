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
