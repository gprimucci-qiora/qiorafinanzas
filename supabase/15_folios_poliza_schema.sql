-- supabase/15_folios_poliza_schema.sql
-- Histórico mensual de folios por póliza y distrito: folios dimensionados (meta),
-- folios realizados (ejecutados) y % de alcance (realizados / dimensionados).
-- A diferencia de poliza_parametros (vigente_desde), esta es una tabla de hechos
-- históricos: una fila fija por (distrito, poliza, mes) que no se reinterpreta con
-- el tiempo. Alimenta la gráfica de folios apilados + alcance del pilar Operaciones.

create table folios_poliza (
  id uuid primary key default gen_random_uuid(),
  distrito text not null,
  poliza text not null check (poliza in ('PLANTA INTERNA', 'RECOLECCIONES', 'MULTIDISTRITO')),
  mes date not null,
  folios_dimensionados numeric not null,
  folios_realizados numeric,
  alcance_pct numeric,
  created_at timestamptz default now(),
  unique (distrito, poliza, mes)
);

alter table folios_poliza enable row level security;

create policy "folios_poliza_select_autenticado" on folios_poliza
  for select using (auth.role() = 'authenticated');
create policy "folios_poliza_write_admin" on folios_poliza
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
