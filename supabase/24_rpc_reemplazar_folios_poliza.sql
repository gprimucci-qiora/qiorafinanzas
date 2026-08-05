-- supabase/24_rpc_reemplazar_folios_poliza.sql
-- Reemplaza folios_poliza solo dentro de la ventana de meses del Excel recién cargado (igual que
-- reemplazar_facturas): borra lo que ya existía en esos meses y lo sustituye por el nuevo snapshot,
-- sin tocar meses anteriores que no vengan en este archivo.

create or replace function reemplazar_folios_poliza(
  filas jsonb,
  p_mes_min date,
  p_mes_max date
)
returns void
language plpgsql
security definer
set search_path = public
set statement_timeout = '600000'
as $$
declare
  v_rol text;
begin
  select rol into v_rol from usuarios where id = auth.uid();
  if v_rol is distinct from 'admin' then
    raise exception 'Solo el rol admin puede reemplazar folios_poliza';
  end if;

  delete from folios_poliza where mes between p_mes_min and p_mes_max;

  insert into folios_poliza (distrito, poliza, mes, folios_dimensionados, folios_realizados, alcance_pct)
  select
    f->>'distrito',
    f->>'poliza',
    (f->>'mes')::date,
    nullif(f->>'folios_dimensionados', '')::numeric,
    nullif(f->>'folios_realizados', '')::numeric,
    nullif(f->>'alcance_pct', '')::numeric
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_folios_poliza(jsonb, date, date) from public;
grant execute on function reemplazar_folios_poliza(jsonb, date, date) to authenticated;
