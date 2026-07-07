# Gestión de Usuarios

**Fecha:** 2026-07-07
**Estado:** Aprobado para planeación de implementación

## 1. Contexto

Hasta ahora, crear un usuario nuevo requería que Giacomo insertara manualmente en Supabase Auth (Dashboard) y en la tabla `usuarios` vía SQL Editor. Se pidió poder crear usuarios (con una contraseña inicial que el admin define), listar/gestionar los existentes, y que cualquier usuario pueda cambiar su propia contraseña — todo desde el dashboard, sin correr SQL.

## 2. Por qué se necesita un componente de servidor

Crear un usuario de Supabase Auth con una contraseña específica (no vía flujo de auto-registro/invitación) requiere la **Admin API** de Supabase (`auth.admin.createUser`, `auth.admin.updateUserById`). Esta API exige la **`service_role key`** del proyecto — una credencial que otorga acceso total a la base de datos, sin pasar por RLS. Esta llave **nunca debe existir en código que corre en el navegador** (cualquiera podría leerla desde el código fuente de la página y tomar control total de la base de datos).

Por eso este es el primer componente del proyecto que corre fuera del navegador: una **Supabase Edge Function**, un pequeño programa que Supabase ejecuta en sus propios servidores. La `service_role key` vive ahí, como secreto de la función, nunca en `index.html` ni en el repositorio de git.

Cambiar la propia contraseña **no** requiere esto — cualquier usuario autenticado puede hacerlo directo con la API pública de Supabase Auth (`auth.updateUser`), sin Admin API ni Edge Function.

## 3. Cambios al modelo de datos

Se agregan dos columnas a la tabla `usuarios` (ya existente):

```sql
alter table usuarios add column if not exists correo text;
alter table usuarios add column if not exists activo boolean not null default true;
```

- `correo`: se guarda al crear el usuario, para poder listarlo sin volver a llamar a la Edge Function en cada carga de la pantalla.
- `activo`: `true` por default; se pone en `false` al desactivar un usuario (sin borrar la fila — se conserva el historial de quién tuvo acceso).

Nueva política RLS en `usuarios` (hoy cada quien solo puede leer su propia fila):

```sql
create policy "usuarios_select_admin" on usuarios
  for select using (
    exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  );
```

Esto le permite a un admin leer todas las filas de `usuarios` para poder listarlas en la pantalla de gestión. (La política existente `usuarios_select_propio` sigue funcionando para el resto.)

## 4. Edge Function `gestionar-usuarios`

Un solo endpoint que recibe un `accion` en el body (`crear`, `desactivar`, `reactivar`). En **todas** las acciones, primero verifica que el JWT del llamador corresponda a un usuario con `rol = 'admin'` en `usuarios` — si no, responde 401/403 sin hacer nada más.

- **`crear`** `{ accion: 'crear', correo, password, nombre, rol }`:
  1. `supabaseAdmin.auth.admin.createUser({ email: correo, password, email_confirm: true })`
  2. Inserta en `usuarios` (`id` del usuario recién creado, `nombre`, `correo`, `rol`).
  3. Responde `{ success: true }` o `{ error: '...' }`.
- **`desactivar`** `{ accion: 'desactivar', id }`:
  1. `supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: '876000h' })` (~100 años — bloqueo efectivamente permanente pero reversible).
  2. `update usuarios set activo = false where id = ...`.
- **`reactivar`** `{ accion: 'reactivar', id }`:
  1. `supabaseAdmin.auth.admin.updateUserById(id, { ban_duration: 'none' })`.
  2. `update usuarios set activo = true where id = ...`.

El cliente la invoca con `supabaseClient.functions.invoke('gestionar-usuarios', { body: {...} })`, que adjunta automáticamente el JWT de la sesión activa.

## 5. Vista "Gestión de Usuarios" (nueva, solo admin)

Sidebar nuevo ítem, oculto para `finanzas` (mismo patrón que "Cargar Datos").

- Botón "+ Agregar Usuario" → formulario: nombre, correo, contraseña inicial, rol (`admin`/`finanzas`). Al guardar, llama a la Edge Function (`crear`) y recarga la lista.
- Tabla: Nombre, Correo, Rol, Estado (Activo/Inactivo), acción (Desactivar / Reactivar según estado actual).
- Editar el rol de alguien ya creado: un `select` inline en la fila que hace `update` directo en `usuarios` (no requiere Admin API, es solo cambiar el valor de `rol`).

## 6. "Cambiar contraseña" (cualquier usuario)

Un link junto a "Cerrar sesión" en el sidebar. Abre un formulario simple: nueva contraseña + confirmar contraseña (deben coincidir, mínimo 6 caracteres). Llama a `supabaseClient.auth.updateUser({ password })`.

## 7. Setup requerido (una sola vez, lo corre Giacomo)

1. Instalar Supabase CLI: `brew install supabase/tap/supabase`
2. `supabase login` (abre el navegador para autenticar)
3. `supabase link --project-ref <ref-del-proyecto>`
4. `supabase functions deploy gestionar-usuarios`
5. `supabase secrets set SUPABASE_SERVICE_ROLE_KEY=<la-llave-de-tu-dashboard>` — la llave la copia Giacomo directo de su Supabase Dashboard (Settings → API), nunca se comparte en el chat ni queda en ningún archivo del repo.

## 8. Fuera de alcance

- No se borra ningún usuario permanentemente (`auth.admin.deleteUser`) — solo desactivar/reactivar, para conservar el historial.
- No hay recuperación de contraseña por correo ("forgot password") en este alcance — si un usuario se bloquea, el admin puede desactivar+reactivar o crear credenciales nuevas manualmente por ahora.
- No se valida la fortaleza de la contraseña más allá del mínimo de Supabase (6 caracteres).
