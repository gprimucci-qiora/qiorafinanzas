-- supabase/23_rpc_reemplazar_presupuesto.sql
-- Reemplaza TODA la tabla presupuesto con el snapshot recién parseado del Excel (ya transpuesto
-- a formato largo en el navegador). No hay ventana de fechas: cada carga sustituye por completo
-- el presupuesto anterior, porque es un presupuesto anual único, no un histórico acumulable.

create or replace function reemplazar_presupuesto(filas jsonb)
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
    raise exception 'Solo el rol admin puede reemplazar el presupuesto';
  end if;

  truncate table presupuesto;

  insert into presupuesto (tipo_gasto_categoria, familia, gasto, negocio, distrito, mes, monto)
  select
    f->>'tipo_gasto_categoria', f->>'familia', f->>'gasto', f->>'negocio', f->>'distrito',
    (f->>'mes')::date, (f->>'monto')::numeric
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function reemplazar_presupuesto(jsonb) from public;
grant execute on function reemplazar_presupuesto(jsonb) to authenticated;

-- El presupuesto transpuesto (~1789 filas x 12 meses) es demasiado grande para una sola llamada RPC
-- sin arriesgar el límite de tamaño de payload. reemplazar_presupuesto trunca e inserta el primer lote;
-- esta función solo inserta, para los lotes siguientes.
create or replace function agregar_lote_presupuesto(filas jsonb)
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
    raise exception 'Solo el rol admin puede cargar presupuesto';
  end if;

  insert into presupuesto (tipo_gasto_categoria, familia, gasto, negocio, distrito, mes, monto)
  select
    f->>'tipo_gasto_categoria', f->>'familia', f->>'gasto', f->>'negocio', f->>'distrito',
    (f->>'mes')::date, (f->>'monto')::numeric
  from jsonb_array_elements(filas) as f;
end;
$$;

revoke all on function agregar_lote_presupuesto(jsonb) from public;
grant execute on function agregar_lote_presupuesto(jsonb) to authenticated;
