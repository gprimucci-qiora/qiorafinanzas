-- supabase/03_rpc_reemplazar_facturas.sql

create or replace function reemplazar_facturas(
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
    raise exception 'Solo el rol admin puede reemplazar facturas';
  end if;

  delete from facturas where fecha_pago between p_fecha_min and p_fecha_max;

  insert into facturas (
    familia, gasto, empresa, sucursal, proveedor, factura,
    subtotal, iva, descuento, monto, fecha_alta, fecha_pago,
    tipo_gasto_categoria, linea_negocio, negocio
  )
  select
    f->>'familia',
    f->>'gasto',
    f->>'empresa',
    f->>'sucursal',
    f->>'proveedor',
    f->>'factura',
    nullif(f->>'subtotal', '')::numeric,
    nullif(f->>'iva', '')::numeric,
    nullif(f->>'descuento', '')::numeric,
    nullif(f->>'monto', '')::numeric,
    nullif(f->>'fecha_alta', '')::date,
    (f->>'fecha_pago')::date,
    f->>'tipo_gasto_categoria',
    f->>'linea_negocio',
    coalesce(f->>'negocio', 'CONECTA')
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_facturas(jsonb, date, date) from public;
grant execute on function reemplazar_facturas(jsonb, date, date) to authenticated;
