-- supabase/35_rpc_reemplazar_gasolina_transacciones.sql
-- Mismo patrón que 31_rpc_reemplazar_ingresos.sql: borra el rango de fecha cubierto por el
-- archivo cargado y vuelve a insertar, para poder recargar un mismo periodo sin duplicar.
-- El rango se calcula de las fechas mínima/máxima encontradas en el archivo, no del nombre
-- del archivo (un archivo de un mes puede traer días del mes siguiente).

create or replace function reemplazar_gasolina_transacciones(
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
    raise exception 'Solo el rol admin puede reemplazar transacciones de gasolina';
  end if;

  delete from gasolina_transacciones where fecha between p_fecha_min and p_fecha_max;

  insert into gasolina_transacciones (
    fecha, hora, placa, sucursal, vin, capacidad_tanque, tipo_transaccion,
    precio_por_litro, litros, monto, gasolinera,
    desviacion_rendimiento_pct, desviacion_rendimiento_monto, razon_social
  )
  select
    (f->>'fecha')::date,
    nullif(f->>'hora', '')::time,
    f->>'placa',
    f->>'sucursal',
    f->>'vin',
    nullif(f->>'capacidad_tanque', '')::numeric,
    f->>'tipo_transaccion',
    nullif(f->>'precio_por_litro', '')::numeric,
    nullif(f->>'litros', '')::numeric,
    nullif(f->>'monto', '')::numeric,
    f->>'gasolinera',
    nullif(f->>'desviacion_rendimiento_pct', '')::numeric,
    nullif(f->>'desviacion_rendimiento_monto', '')::numeric,
    f->>'razon_social'
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_gasolina_transacciones(jsonb, date, date) from public;
grant execute on function reemplazar_gasolina_transacciones(jsonb, date, date) to authenticated;
