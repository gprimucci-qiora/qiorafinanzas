-- supabase/34_gasolina_transacciones_schema.sql
-- Transacciones de tarjetas de combustible Edenred, hoja "Report" de la descarga cruda.
-- Modelo/Año/Tipo de Sucursal NO se guardan aquí: se resuelven en el cliente cruzando por
-- Placa contra flota_vehicular y por prefijo de Sucursal contra glosario_sucursales (ver
-- docs/superpowers/specs/2026-09-22-modulo-gasolina-design.md §5), así el histórico de
-- gasolina no se desactualiza si el maestro de vehículos cambia.
--
-- Igual que facturas/ingresos: cada carga reemplaza solo el rango de fechas incluido en el
-- archivo (ver 35_rpc_reemplazar_gasolina_transacciones.sql), no se acumula por fecha de carga.
-- Las filas "ANULACIÓN DE CONSUMO" se cargan igual que "CONSUMO" (litros/monto negativos) sin
-- filtrarlas: se cancelan solas contra la transacción que anulan al sumar.

create table if not exists gasolina_transacciones (
  id bigserial primary key,
  fecha date not null,
  hora time,
  placa text not null,
  sucursal text,
  vin text,
  capacidad_tanque numeric,
  tipo_transaccion text,
  precio_por_litro numeric,
  litros numeric,
  monto numeric,
  gasolinera text,
  desviacion_rendimiento_pct numeric,
  desviacion_rendimiento_monto numeric,
  razon_social text,
  cargado_en timestamptz default now()
);

create index if not exists idx_gasolina_fecha on gasolina_transacciones (fecha);
create index if not exists idx_gasolina_placa on gasolina_transacciones (placa);
create index if not exists idx_gasolina_sucursal on gasolina_transacciones (sucursal);

alter table gasolina_transacciones enable row level security;

create policy "gasolina_select_autenticado" on gasolina_transacciones
  for select using (auth.role() = 'authenticated');

-- Escritura directa solo admin (el flujo normal usa la función RPC de
-- 35_rpc_reemplazar_gasolina_transacciones.sql)
create policy "gasolina_write_admin" on gasolina_transacciones
  for all using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  ) with check (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );
