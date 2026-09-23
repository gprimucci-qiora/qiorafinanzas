-- supabase/36_usuarios_pilares_permitidos.sql
-- Acceso granular por pilar y por usuario (antes solo existía el único pilar fijo por rol
-- 'operaciones' vía PILAR_EXCLUSIVO_POR_ROL en el cliente). Un admin ahora puede marcar, por
-- usuario, exactamente qué pilares de negocio ve en el sidebar — el resto se le ocultan.
--
-- Default = los 5 pilares (acceso completo), para no romper a ningún usuario existente al
-- correr esta migración. rol = 'admin' siempre tiene acceso completo sin importar este campo
-- (se aplica así del lado del cliente en index.html, para no arriesgar que un admin se bloquee
-- a sí mismo por accidente).

alter table usuarios add column if not exists pilares_permitidos text[]
  not null default array['operaciones', 'financieros', 'capitalhumano', 'flota', 'gasolina'];

-- Preserva el comportamiento actual de los usuarios con rol 'operaciones' (antes fijo vía
-- PILAR_EXCLUSIVO_POR_ROL en el cliente) — sin esto, el default de arriba les abriría de golpe
-- los 5 pilares en vez de solo Operaciones.
update usuarios set pilares_permitidos = array['operaciones'] where rol = 'operaciones';

-- No existía ninguna política de UPDATE para usuarios (solo select propio/admin) — sin esto,
-- cambiar el rol o los pilares permitidos de otro usuario fallaba por RLS.
create policy "usuarios_update_admin" on usuarios
  for update using (usuario_es_admin())
  with check (usuario_es_admin());
