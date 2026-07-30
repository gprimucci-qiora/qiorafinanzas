-- supabase/20_unidades_autorizadas_schema.sql
-- Unidades Autorizadas: mismo patrón "vigente desde" que hc_autorizado, pero para
-- vehículos en vez de personas. Cada fila es la cantidad autorizada de una
-- combinación distrito + categoría de uso + tipo de unidad.
--
-- categoria: 'PI' | 'RECOLECCION' | 'MULTIDISTRITO' | 'STBY' | 'STAFF' | 'ALMACEN' | 'DESTAJO' | 'TEMPORAL'
-- tipo_unidad: 'AUTO' | 'MOTO'
--
-- Se cruza contra flota_vehicular para el pilar Flota Vehicular (área "Real vs. Autorizado"):
-- tipo_unidad real = MOTO si flota_vehicular.modelo coincide con ITALIKA/ECO 150 CARGO/RYDER,
-- AUTO en cualquier otro caso; categoria real = flota_vehicular.tipo_poliza.

create table unidades_autorizadas (
  id uuid primary key default gen_random_uuid(),
  distrito text not null,
  categoria text not null,
  tipo_unidad text not null,
  unidades_autorizadas numeric not null,
  vigente_desde date not null,
  created_at timestamptz default now()
);

alter table unidades_autorizadas enable row level security;

create policy "unidades_autorizadas_select_autenticado" on unidades_autorizadas
  for select using (auth.role() = 'authenticated');
create policy "unidades_autorizadas_write_admin" on unidades_autorizadas
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
