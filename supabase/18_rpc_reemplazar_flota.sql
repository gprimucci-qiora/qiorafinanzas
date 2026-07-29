-- supabase/18_rpc_reemplazar_flota.sql
-- Reemplaza TODA la tabla flota_vehicular con el snapshot recién descargado de FFM.
-- No hay ventana de fechas (a diferencia de facturas): cada carga sustituye
-- por completo el estado anterior, porque el reporte ya es la fotografía completa.

create or replace function reemplazar_flota_vehicular(filas jsonb)
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
    raise exception 'Solo el rol admin puede reemplazar la flota vehicular';
  end if;

  truncate table flota_vehicular;

  insert into flota_vehicular (
    numero_unico, placa, estado_placa, sucursal, empleado_asignado, numero_empleado,
    usuario_ffm, puesto_empleado, tipo_poliza, clasificacion, estatus_nuevo, responsable,
    empleado_aprobo, fecha_aprobo, fecha_modificacion, no_poliza, inciso_poliza,
    fecha_vencimiento_poliza, indicador_gasolina, marca, modelo, numero_serie,
    placa_anterior, anio, propiedad_vehiculo, arrendadora, empresa_compra_propio,
    ultimo_kilometraje, fecha_ultimo_kilometraje, taller, tipos_servicio,
    fecha_compromiso, monto, motivo_reprogramacion, comentario
  )
  select
    f->>'numero_unico', f->>'placa', f->>'estado_placa', f->>'sucursal', f->>'empleado_asignado', f->>'numero_empleado',
    f->>'usuario_ffm', f->>'puesto_empleado', f->>'tipo_poliza', f->>'clasificacion', f->>'estatus_nuevo', f->>'responsable',
    f->>'empleado_aprobo', nullif(f->>'fecha_aprobo', '')::date, nullif(f->>'fecha_modificacion', '')::date, f->>'no_poliza', f->>'inciso_poliza',
    nullif(f->>'fecha_vencimiento_poliza', '')::date, f->>'indicador_gasolina', f->>'marca', f->>'modelo', f->>'numero_serie',
    f->>'placa_anterior', nullif(f->>'anio', '')::numeric, f->>'propiedad_vehiculo', f->>'arrendadora', f->>'empresa_compra_propio',
    nullif(f->>'ultimo_kilometraje', '')::numeric, nullif(f->>'fecha_ultimo_kilometraje', '')::date, f->>'taller', f->>'tipos_servicio',
    nullif(f->>'fecha_compromiso', '')::date, nullif(f->>'monto', '')::numeric, f->>'motivo_reprogramacion', f->>'comentario'
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_flota_vehicular(jsonb) from public;
grant execute on function reemplazar_flota_vehicular(jsonb) to authenticated;
