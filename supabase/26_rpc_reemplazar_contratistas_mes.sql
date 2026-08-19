-- supabase/26_rpc_reemplazar_contratistas_mes.sql
-- Reemplaza el estado de cuenta de contratistas de UN mes específico (borra ese mes en las 4
-- tablas y sustituye por el snapshot recién parseado del navegador). Los meses anteriores no
-- incluidos en la carga no se tocan, igual que reemplazar_folios_poliza.

create or replace function reemplazar_contratistas_mes(
  p_mes date,
  cuadrillas jsonb,
  os_tipo jsonb,
  resumen jsonb,
  adicionales jsonb
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
    raise exception 'Solo el rol admin puede reemplazar el estado de cuenta de contratistas';
  end if;

  delete from contratistas_cuadrillas where mes = p_mes;
  delete from contratistas_cuadrillas_os_tipo where mes = p_mes;
  delete from contratistas_resumen_mensual where mes = p_mes;
  delete from contratistas_adicionales where mes = p_mes;

  insert into contratistas_cuadrillas (contratista, mes, ffm, nombre_tecnico, distrito, asistencias, os_totales, productividad_diaria, estrellas, pago_total)
  select
    f->>'contratista', (f->>'mes')::date, f->>'ffm', f->>'nombre_tecnico', f->>'distrito',
    (f->>'asistencias')::numeric, (f->>'os_totales')::numeric,
    nullif(f->>'productividad_diaria', '')::numeric, (f->>'estrellas')::numeric, (f->>'pago_total')::numeric
  from jsonb_array_elements(cuadrillas) as f;

  insert into contratistas_cuadrillas_os_tipo (contratista, mes, ffm, tipo_os, monto)
  select f->>'contratista', (f->>'mes')::date, f->>'ffm', f->>'tipo_os', (f->>'monto')::numeric
  from jsonb_array_elements(os_tipo) as f;

  insert into contratistas_resumen_mensual (
    contratista, mes, cuadrillas_activas, asistencias_totales, os_totales, estrellas_totales,
    productividad_promedio, os_promedio, estrellas_promedio, pago_total, adicionales_total,
    subtotal_facturar, iva, total_final
  )
  select
    f->>'contratista', (f->>'mes')::date,
    nullif(f->>'cuadrillas_activas', '')::numeric, nullif(f->>'asistencias_totales', '')::numeric,
    nullif(f->>'os_totales', '')::numeric, nullif(f->>'estrellas_totales', '')::numeric,
    nullif(f->>'productividad_promedio', '')::numeric, nullif(f->>'os_promedio', '')::numeric,
    nullif(f->>'estrellas_promedio', '')::numeric, nullif(f->>'pago_total', '')::numeric,
    nullif(f->>'adicionales_total', '')::numeric, nullif(f->>'subtotal_facturar', '')::numeric,
    nullif(f->>'iva', '')::numeric, nullif(f->>'total_final', '')::numeric
  from jsonb_array_elements(resumen) as f;

  insert into contratistas_adicionales (contratista, mes, concepto, monto)
  select f->>'contratista', (f->>'mes')::date, f->>'concepto', (f->>'monto')::numeric
  from jsonb_array_elements(adicionales) as f;
end;
$$;

revoke all on function reemplazar_contratistas_mes(date, jsonb, jsonb, jsonb, jsonb) from public;
grant execute on function reemplazar_contratistas_mes(date, jsonb, jsonb, jsonb, jsonb) to authenticated;
