-- supabase/22_presupuesto_schema.sql
-- Presupuesto anual de Conecta (todas las pólizas consolidadas por distrito), en formato largo:
-- una fila por combinación tipo_gasto_categoria/familia/gasto/negocio/distrito/mes. El Excel de origen
-- trae 12 columnas (una por mes) que se transponen a filas antes de insertar.
--
-- tipo_gasto_categoria coincide con facturas.tipo_gasto_categoria (columna "P&L" del Excel).
-- familia/gasto coinciden con facturas.familia/facturas.gasto.
-- distrito ya viene a nivel distrito (igual que poliza_parametros/hc_autorizado), no requiere glosario.
--
-- Es un presupuesto anual único: cada carga reemplaza TODA la tabla (ver 23_rpc_reemplazar_presupuesto.sql),
-- no se acumula por fecha de carga.

create table presupuesto (
  id bigserial primary key,
  tipo_gasto_categoria text,
  familia text,
  gasto text,
  negocio text,
  distrito text,
  mes date not null,
  monto numeric not null default 0,
  cargado_en timestamptz default now()
);

create index if not exists idx_presupuesto_distrito on presupuesto (distrito);
create index if not exists idx_presupuesto_mes on presupuesto (mes);
create index if not exists idx_presupuesto_categoria on presupuesto (tipo_gasto_categoria);

alter table presupuesto enable row level security;

create policy "presupuesto_select_autenticado" on presupuesto
  for select using (auth.role() = 'authenticated');
create policy "presupuesto_write_admin" on presupuesto
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
