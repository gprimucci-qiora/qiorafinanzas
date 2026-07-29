-- supabase/17_flota_vehicular_schema.sql
-- Inventario de flota vehicular (REPORTE SUCURSAL DETALLE). A diferencia de facturas,
-- este reporte es una FOTOGRAFÍA completa del estado actual de la flota (cambia en
-- cuestión de segundos según FFM) — no se acumula histórico por rango de fechas,
-- cada carga reemplaza TODA la tabla. cargado_en marca cuándo se subió cada snapshot.

create table flota_vehicular (
  id bigserial primary key,
  numero_unico text,
  placa text,
  estado_placa text,
  sucursal text,
  empleado_asignado text,
  numero_empleado text,
  usuario_ffm text,
  puesto_empleado text,
  tipo_poliza text,
  clasificacion text,
  estatus_nuevo text,
  responsable text,
  empleado_aprobo text,
  fecha_aprobo date,
  fecha_modificacion date,
  no_poliza text,
  inciso_poliza text,
  fecha_vencimiento_poliza date,
  indicador_gasolina text,
  marca text,
  modelo text,
  numero_serie text,
  placa_anterior text,
  anio numeric,
  propiedad_vehiculo text,
  arrendadora text,
  empresa_compra_propio text,
  ultimo_kilometraje numeric,
  fecha_ultimo_kilometraje date,
  taller text,
  tipos_servicio text,
  fecha_compromiso date,
  monto numeric,
  motivo_reprogramacion text,
  comentario text,
  cargado_en timestamptz default now()
);

create index if not exists idx_flota_sucursal on flota_vehicular (sucursal);
create index if not exists idx_flota_clasificacion on flota_vehicular (clasificacion);

alter table flota_vehicular enable row level security;

create policy "flota_vehicular_select_autenticado" on flota_vehicular
  for select using (auth.role() = 'authenticated');
create policy "flota_vehicular_write_admin" on flota_vehicular
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
