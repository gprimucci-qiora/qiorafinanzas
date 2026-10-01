-- supabase/37_permiso_carga_gasolina.sql
-- Permite que un usuario que NO es admin pueda subir la descarga de Edenred (Configuración →
-- Gasolina) sin darle acceso de admin completo (gestión de usuarios, otras cargas, etc.).
-- Se mantiene separado de usuarios.pilares_permitidos: pilares_permitidos controla qué VE un
-- usuario en el sidebar, esto controla qué puede CARGAR. Default = false, no amplía permisos de
-- nadie que ya exista al correr esta migración.

alter table usuarios add column if not exists puede_cargar_gasolina boolean not null default false;

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
  v_puede_cargar_gasolina boolean;
begin
  select rol, puede_cargar_gasolina into v_rol, v_puede_cargar_gasolina from usuarios where id = auth.uid();
  if v_rol is distinct from 'admin' and coalesce(v_puede_cargar_gasolina, false) is not true then
    raise exception 'No tienes permiso para cargar transacciones de gasolina';
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
