-- supabase/12_hc_autorizado_schema.sql
-- HC Autorizado: personas autorizadas para contratación por sucursal y puesto.
-- Mismo patrón "vigente desde" que poliza_parametros: la fila con vigente_desde
-- más reciente <= un mes dado es la que aplica. Un cambio futuro solo agrega
-- una fila nueva; el pasado nunca se modifica.
--
-- Alimenta el cálculo de la póliza Multidistrito: el peso de cada distrito dentro
-- de su bolsa regional = cuadrillas autorizadas del distrito (sucursal "MLT") /
-- cuadrillas autorizadas totales de esa bolsa. Ver Calc.obtenerCuadrillasMultidistrito
-- en calc.js.

create table hc_autorizado (
  id uuid primary key default gen_random_uuid(),
  distrito text not null,
  puesto text not null,
  personas_autorizadas numeric not null,
  vigente_desde date not null,
  created_at timestamptz default now()
);

alter table hc_autorizado enable row level security;

create policy "hc_autorizado_select_autenticado" on hc_autorizado
  for select using (auth.role() = 'authenticated');
create policy "hc_autorizado_write_admin" on hc_autorizado
  for all using (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'))
  with check (exists (select 1 from usuarios where id = auth.uid() and rol = 'admin'));
