-- supabase/05_gestion_usuarios_schema.sql

alter table usuarios add column if not exists correo text;
alter table usuarios add column if not exists activo boolean not null default true;

create policy "usuarios_select_admin" on usuarios
  for select using (
    exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  );
