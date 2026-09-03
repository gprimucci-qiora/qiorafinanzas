-- supabase/31_rpc_reemplazar_ingresos.sql
-- Mismo patrón que 03_rpc_reemplazar_facturas.sql: borra el rango de fecha_pl cubierto
-- por el archivo cargado y vuelve a insertar, para poder recargar un mismo mes sin duplicar.

create or replace function reemplazar_ingresos(
  filas jsonb,
  p_fecha_min date,
  p_fecha_max date
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
    raise exception 'Solo el rol admin puede reemplazar ingresos';
  end if;

  delete from ingresos where fecha_pl between p_fecha_min and p_fecha_max;

  insert into ingresos (
    empresa, cliente, tipo_ingreso, familia, gasto, tipo_gasto_categoria,
    sucursal, subtotal, fecha_pl, linea_negocio, negocio
  )
  select
    f->>'empresa',
    f->>'cliente',
    f->>'tipo_ingreso',
    f->>'familia',
    f->>'gasto',
    f->>'tipo_gasto_categoria',
    f->>'sucursal',
    nullif(f->>'subtotal', '')::numeric,
    (f->>'fecha_pl')::date,
    f->>'linea_negocio',
    coalesce(f->>'negocio', 'CONECTA')
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_ingresos(jsonb, date, date) from public;
grant execute on function reemplazar_ingresos(jsonb, date, date) to authenticated;
