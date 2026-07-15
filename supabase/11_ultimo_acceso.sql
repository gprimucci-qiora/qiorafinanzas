-- supabase/11_ultimo_acceso.sql
-- Agrega seguimiento de "último acceso" por usuario, para que un admin
-- pueda ver qué tan seguido usa la app cada quien.

alter table usuarios add column if not exists ultimo_acceso timestamptz;

-- Cada usuario solo puede actualizar su PROPIO ultimo_acceso, nunca su rol
-- ni el de nadie más. Se hace vía función security definer en vez de una
-- política de update directa, para no abrir la puerta a que un usuario
-- se autoasigne rol = 'admin' actualizando su propia fila.
create or replace function actualizar_ultimo_acceso()
returns void
language sql
security definer
set search_path = public
as $$
  update usuarios set ultimo_acceso = now() where id = auth.uid();
$$;

grant execute on function actualizar_ultimo_acceso() to authenticated;
