-- supabase/06_fix_recursion_usuarios_select_admin.sql
-- Corrige "infinite recursion detected in policy for relation usuarios":
-- la política usuarios_select_admin no puede consultar la propia tabla
-- usuarios directamente, porque esa consulta dispara la misma política
-- de nuevo. Se resuelve con una función security definer que se ejecuta
-- sin aplicar RLS.

drop policy if exists "usuarios_select_admin" on usuarios;

create or replace function usuario_es_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from usuarios where id = auth.uid() and rol = 'admin'
  );
$$;

create policy "usuarios_select_admin" on usuarios
  for select using (usuario_es_admin());
