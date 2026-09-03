-- supabase/29_fix_cancun_folios_dimensionados_2026.sql
-- Corrige un desfase de la migración 28: el Excel "nuevos folios.xlsx" trae el distrito de Cancún
-- como 'CTA-TPI-INT-CUN CANCUN 1', pero en poliza_parametros el nombre real (sin el "1") es
-- 'CTA-TPI-INT-CUN CANCUN' — por eso el UPDATE de la migración 28 no encontró ninguna fila que
-- coincidiera para Cancún y se quedó con el valor viejo de ordenes_dimensionadas. Aquí se aplica
-- con el nombre correcto.

update poliza_parametros as pp set ordenes_dimensionadas = v.valor
from (values
  ('CTA-TPI-INT-CUN CANCUN', '2026-01-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-02-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-03-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-04-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-05-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-06-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-07-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-08-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-09-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-10-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-11-01'::date, 3957),
  ('CTA-TPI-INT-CUN CANCUN', '2026-12-01'::date, 3957)
) as v(distrito, vigente_desde, valor)
where pp.poliza = 'PLANTA INTERNA' and pp.distrito = v.distrito and pp.vigente_desde = v.vigente_desde;

-- Verificación: debería regresar 12.
-- select count(*) from poliza_parametros
--   where poliza = 'PLANTA INTERNA' and distrito = 'CTA-TPI-INT-CUN CANCUN'
--   and vigente_desde between '2026-01-01' and '2026-12-01' and ordenes_dimensionadas = 3957;
