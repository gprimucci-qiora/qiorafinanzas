-- supabase/27_rol_operaciones.sql
-- Nuevo rol 'operaciones': solo puede ver el pilar de Operaciones (folios, contratistas) en la
-- app, sin acceso a Overview/Financieros/Capital Humano/Flota/Configuración. Para efectos de
-- escritura se comporta igual que 'finanzas' — todos los RPC de carga siguen exigiendo 'admin',
-- así que no hace falta tocar RLS ni RPCs, solo ampliar el rol permitido.

alter table usuarios drop constraint if exists usuarios_rol_check;
alter table usuarios add constraint usuarios_rol_check check (rol in ('admin', 'finanzas', 'operaciones'));
