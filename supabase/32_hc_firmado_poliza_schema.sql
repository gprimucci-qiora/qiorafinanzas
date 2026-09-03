-- supabase/32_hc_firmado_poliza_schema.sql
-- Histórico mensual de HC (personal) firmado promedio por póliza y distrito, para contrastarlo
-- contra folios_poliza en el pilar Operaciones (¿el HC firmado va acorde al volumen de folios?).
-- Mismo shape que folios_poliza: una fila fija por (distrito, poliza, mes).
-- Fuente: Excel "HC promedio x poliza" (columnas Sucursal Padre / MesNombre / Promedio Firmadas
-- PI / Promedio Firmadas REC / Promedio Firmadas MD) — mismo mapeo de distrito que el Excel de
-- Pólizas de Operaciones (ver MAPEO_DISTRITO_POLIZA en index.html).

create table hc_firmado_poliza (
  id uuid primary key default gen_random_uuid(),
  distrito text not null,
  poliza text not null check (poliza in ('PLANTA INTERNA', 'RECOLECCIONES', 'MULTIDISTRITO')),
  mes date not null,
  hc_promedio numeric not null,
  created_at timestamptz default now(),
  unique (distrito, poliza, mes)
);

alter table hc_firmado_poliza enable row level security;

create policy "hc_firmado_poliza_select_autenticado" on hc_firmado_poliza
  for select using (auth.role() = 'authenticated');
create policy "hc_firmado_poliza_write_admin" on hc_firmado_poliza
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
