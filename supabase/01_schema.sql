-- supabase/01_schema.sql

create table if not exists usuarios (
  id uuid references auth.users(id) primary key,
  nombre text not null,
  rol text not null check (rol in ('admin', 'finanzas'))
);

create table if not exists glosario_sucursales (
  sucursal text primary key,
  tipo_sucursal text,
  region text,
  sucursal_secundaria text,
  tipo_gasto text check (tipo_gasto in ('COSTOS DIRECTOS', 'GASTOS OPERATIVOS')),
  actualizado_en timestamptz default now()
);

create table if not exists facturas (
  id bigserial primary key,
  familia text,
  gasto text,
  empresa text,
  sucursal text,
  proveedor text,
  factura text,
  subtotal numeric,
  iva numeric,
  descuento numeric,
  monto numeric,
  fecha_alta date,
  fecha_pago date not null,
  tipo_gasto_categoria text,
  linea_negocio text,
  negocio text default 'CONECTA',
  cargado_en timestamptz default now()
);

create index if not exists idx_facturas_fecha_pago on facturas (fecha_pago);
create index if not exists idx_facturas_sucursal on facturas (sucursal);
