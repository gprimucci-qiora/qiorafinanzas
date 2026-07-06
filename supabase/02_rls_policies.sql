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
