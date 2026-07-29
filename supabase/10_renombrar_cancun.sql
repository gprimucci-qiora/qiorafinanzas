-- supabase/10_renombrar_cancun.sql
-- Renombra el distrito "CTA-TPI-INT-CUN CANCUN 1" a "CTA-TPI-INT-CUN CANCUN"
-- en las tablas de Ingresos, para que vuelvan a coincidir con el sucursal_secundaria
-- actualizado en glosario_sucursales.

update poliza_parametros
  set distrito = 'CTA-TPI-INT-CUN CANCUN'
  where distrito = 'CTA-TPI-INT-CUN CANCUN 1';

update multidistrito_asignacion
  set distrito = 'CTA-TPI-INT-CUN CANCUN'
  where distrito = 'CTA-TPI-INT-CUN CANCUN 1';

-- Verificación: no debe quedar ninguna fila con el nombre viejo
select count(*) as filas_con_nombre_viejo
from (
  select distrito from poliza_parametros where distrito = 'CTA-TPI-INT-CUN CANCUN 1'
  union all
  select distrito from multidistrito_asignacion where distrito = 'CTA-TPI-INT-CUN CANCUN 1'
) t;
