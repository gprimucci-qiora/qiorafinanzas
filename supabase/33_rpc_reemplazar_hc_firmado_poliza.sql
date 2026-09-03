-- supabase/33_rpc_reemplazar_hc_firmado_poliza.sql
-- Mismo patrón que 24_rpc_reemplazar_folios_poliza.sql: borra solo la ventana de meses del Excel
-- recién cargado y la sustituye, sin tocar meses anteriores que no vengan en este archivo.

create or replace function reemplazar_hc_firmado_poliza(
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
    raise exception 'Solo el rol admin puede reemplazar hc_firmado_poliza';
  end if;

  delete from hc_firmado_poliza where mes between p_mes_min and p_mes_max;

  insert into hc_firmado_poliza (distrito, poliza, mes, hc_promedio)
  select
    f->>'distrito',
    f->>'poliza',
    (f->>'mes')::date,
    nullif(f->>'hc_promedio', '')::numeric
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_hc_firmado_poliza(jsonb, date, date) from public;
grant execute on function reemplazar_hc_firmado_poliza(jsonb, date, date) to authenticated;
