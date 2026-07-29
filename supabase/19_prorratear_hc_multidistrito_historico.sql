-- supabase/19_prorratear_hc_multidistrito_historico.sql
-- El HC Autorizado (usado para prorratear la póliza Multidistrito) solo tiene una
-- vigencia ('2026-07-01'). Para cualquier mes ANTERIOR a esa fecha, el sistema no
-- encuentra cuadrillas vigentes y calcula $0 de Multidistrito para ese mes.
--
-- Como el peso por HC debe aplicar desde que existe la póliza de Multidistrito
-- (no solo desde julio 2026), recorremos esa vigencia hacia atrás hasta el mes
-- más antiguo que ya tiene bolsas de Multidistrito configuradas.

update hc_autorizado
  set vigente_desde = (select min(vigente_desde) from multidistrito_bolsas)
  where vigente_desde = '2026-07-01';

-- Verificación: la nueva vigencia de HC Autorizado debe ser <= la primera bolsa.
select
  (select min(vigente_desde) from hc_autorizado) as hc_vigente_desde,
  (select min(vigente_desde) from multidistrito_bolsas) as primera_bolsa_multidistrito;
