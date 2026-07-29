-- supabase/14_fix_vigente_hc_autorizado.sql
-- El seed inicial (13_seed_hc_autorizado.sql) se corrió con vigente_desde = fecha real
-- del día ('2026-07-28') en vez del primer día del mes, que es la convención que usan
-- poliza_parametros y multidistrito_bolsas para "vigente_desde". Como el mes vigente se
-- calcula siempre como el día 1 (ej. '2026-07-01'), esa fecha quedaba DESPUÉS del corte,
-- por lo que ninguna fila se consideraba vigente y el peso de Multidistrito salía en 0.
-- Este script corrige las filas que ya se insertaron.

update hc_autorizado
  set vigente_desde = '2026-07-01'
  where vigente_desde = '2026-07-28';
