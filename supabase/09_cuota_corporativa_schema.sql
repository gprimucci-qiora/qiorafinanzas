-- supabase/09_cuota_corporativa_schema.sql

create table cuota_corporativa_parametros (
  id uuid primary key default gen_random_uuid(),
  monto numeric not null,
  vigente_desde date not null,
  created_at timestamptz default now()
);

alter table cuota_corporativa_parametros enable row level security;

create policy "cuota_corporativa_select_autenticado" on cuota_corporativa_parametros
  for select using (auth.role() = 'authenticated');
create policy "cuota_corporativa_write_admin" on cuota_corporativa_parametros
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
