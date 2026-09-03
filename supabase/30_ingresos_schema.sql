-- supabase/30_ingresos_schema.sql
-- Ingreso real facturado (espejo de "facturas" pero del lado de ingresos), viene del
-- "REPORTE DE INGRESOS" que exporta Siva. Ese Excel reutiliza el machote de columnas de
-- gastos, así que varias columnas dicen "GASTO" aunque son de ingreso:
--   D  FECHA P&L                  -> fecha_pl (fecha a usar para todo el análisis)
--   X  FAMILIA                    -> familia
--   Y  GASTO                      -> gasto (en realidad es la categoría de ingreso, ej.
--                                    "POLIZA PLANTA INTERNA", "VENTA TECNICO", "APOYO VIATICOS")
--   Z  TIPO DE GASTO              -> tipo_gasto_categoria
--   AA SUCURSAL                   -> sucursal
--   AB SUBTOTAL GASTO/SUCURSAL    -> subtotal (el monto que se debe sumar; una factura puede
--                                    venir repartida en varias filas por sucursal/categoría)
--   AE LÍNEA DE NEGOCIO           -> linea_negocio
--   AF NEGOCIO                    -> negocio
--
-- Nota: parte de "gasto" cae en categorías POLIZA * (PLANTA INTERNA/MULTIDISTRITO/RECOLECCIONES/
-- DESTAJO/VENTA UNIDADES), que es el mismo ingreso que hoy la app calcula como
-- folios_dimensionados × precio_por_orden. El resto (VENTA TECNICO, APOYO VIATICOS,
-- TALLERES Y SINIESTROS, INGRESOS VARIOS, DEPOSITOS EN EFECTIVO, DEVOLUCION VIATICOS) es
-- ingreso real que hoy NO se captura en ningún lado de la app.
--
-- Igual que facturas: cada carga reemplaza solo el rango de fechas incluido en el archivo
-- (ver 31_rpc_reemplazar_ingresos.sql), no se acumula por fecha de carga.

create table if not exists ingresos (
  id bigserial primary key,
  empresa text,
  cliente text,
  tipo_ingreso text,
  familia text,
  gasto text,
  tipo_gasto_categoria text,
  sucursal text,
  subtotal numeric,
  fecha_pl date not null,
  linea_negocio text,
  negocio text default 'CONECTA',
  cargado_en timestamptz default now()
);

create index if not exists idx_ingresos_fecha_pl on ingresos (fecha_pl);
create index if not exists idx_ingresos_sucursal on ingresos (sucursal);
create index if not exists idx_ingresos_gasto on ingresos (gasto);

alter table ingresos enable row level security;

create policy "ingresos_select_autenticado" on ingresos
  for select using (auth.role() = 'authenticated');

-- Escritura directa solo admin (el flujo normal usa la función RPC de 31_rpc_reemplazar_ingresos.sql)
create policy "ingresos_write_admin" on ingresos
  for all using (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  ) with check (
    exists (select 1 from usuarios where id = auth.uid() and rol = 'admin')
  );
