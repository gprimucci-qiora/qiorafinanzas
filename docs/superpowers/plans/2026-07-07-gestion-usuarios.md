# Gestión de Usuarios Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Permitir crear, listar, desactivar/reactivar usuarios y editar su rol desde el dashboard (sin SQL manual), y que cualquier usuario cambie su propia contraseña.

**Architecture:** Una Supabase Edge Function (`gestionar-usuarios`) concentra las 3 acciones que requieren la Admin API (crear, desactivar, reactivar), verificando siempre que quien llama sea `admin`. El resto (listar, editar rol, cambiar la propia contraseña) usa la API pública de Supabase directo desde `index.html`, sin la Edge Function.

**Tech Stack:** Supabase Edge Functions (Deno + TypeScript), Supabase JS `functions.invoke`, mismo patrón vanilla JS del resto del proyecto.

## Global Constraints

- La `service_role key` nunca aparece en `index.html`, en el repo, ni en el chat — solo la copia Giacomo directo de su Supabase Dashboard al correr `supabase secrets set`.
- "Eliminar" un usuario = desactivar (bloquear login), nunca borrado permanente — se conserva la fila en `usuarios` para historial.
- Todo el SQL lo ejecuta el usuario manualmente en el SQL Editor de Supabase (mismo patrón que el resto del proyecto).
- La Edge Function verifica `rol = 'admin'` en **cada** acción antes de hacer cualquier cambio.

**Spec de referencia:** `docs/superpowers/specs/2026-07-07-gestion-usuarios-design.md`

---

## File Structure

```
QiORAConectaGastos/
├── supabase/
│   ├── 05_gestion_usuarios_schema.sql       # + columnas correo/activo, + política RLS admin
│   └── functions/
│       └── gestionar-usuarios/
│           └── index.ts                      # Edge Function: crear/desactivar/reactivar
└── index.html                                 # + vista Gestión de Usuarios, + Cambiar contraseña
```

---

### Task 1: Esquema SQL — columnas nuevas y política RLS

**Files:**
- Create: `supabase/05_gestion_usuarios_schema.sql`

- [ ] **Step 1: Escribir el SQL**

```sql
-- supabase/05_gestion_usuarios_schema.sql

alter table usuarios add column if not exists correo text;
alter table usuarios add column if not exists activo boolean not null default true;

create policy "usuarios_select_admin" on usuarios
  for select using (
    exists (select 1 from usuarios u where u.id = auth.uid() and u.rol = 'admin')
  );
```

- [ ] **Step 2: Entregar el SQL al usuario para ejecutar**

Decirle a Giacomo: "Copia y pega `supabase/05_gestion_usuarios_schema.sql` en el SQL Editor de Supabase y ejecútalo."

- [ ] **Step 3: Verificar (el usuario corre esto y reporta el resultado)**

```sql
select column_name from information_schema.columns where table_name = 'usuarios';
select policyname from pg_policies where tablename = 'usuarios';
```
Esperado: columnas `correo` y `activo` presentes; política `usuarios_select_admin` listada junto a `usuarios_select_propio`.

- [ ] **Step 4: Commit**

```bash
git add supabase/05_gestion_usuarios_schema.sql
git commit -m "Add correo/activo columns and admin-read RLS policy to usuarios"
```

---

### Task 2: Edge Function `gestionar-usuarios`

**Files:**
- Create: `supabase/functions/gestionar-usuarios/index.ts`

**Interfaces:**
- Produces: endpoint invocable vía `supabaseClient.functions.invoke('gestionar-usuarios', { body: { accion, ... } })`, consumido por Task 4.

- [ ] **Step 1: Escribir la función**

```ts
// supabase/functions/gestionar-usuarios/index.ts
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || ''
    const jwt = authHeader.replace('Bearer ', '')
    const supabaseAdmin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)

    const { data: userData, error: userError } = await supabaseAdmin.auth.getUser(jwt)
    if (userError || !userData.user) {
      return new Response(JSON.stringify({ error: 'No autenticado' }), { status: 401 })
    }

    const { data: perfil } = await supabaseAdmin
      .from('usuarios')
      .select('rol')
      .eq('id', userData.user.id)
      .single()
    if (!perfil || perfil.rol !== 'admin') {
      return new Response(JSON.stringify({ error: 'Solo un admin puede gestionar usuarios' }), { status: 403 })
    }

    const body = await req.json()

    if (body.accion === 'crear') {
      const { data: nuevoUsuario, error: crearError } = await supabaseAdmin.auth.admin.createUser({
        email: body.correo,
        password: body.password,
        email_confirm: true,
      })
      if (crearError) {
        return new Response(JSON.stringify({ error: crearError.message }), { status: 400 })
      }
      const { error: insertError } = await supabaseAdmin.from('usuarios').insert({
        id: nuevoUsuario.user.id,
        nombre: body.nombre,
        correo: body.correo,
        rol: body.rol,
      })
      if (insertError) {
        return new Response(JSON.stringify({ error: insertError.message }), { status: 400 })
      }
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    if (body.accion === 'desactivar') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(body.id, { ban_duration: '876000h' })
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400 })
      }
      await supabaseAdmin.from('usuarios').update({ activo: false }).eq('id', body.id)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    if (body.accion === 'reactivar') {
      const { error } = await supabaseAdmin.auth.admin.updateUserById(body.id, { ban_duration: 'none' })
      if (error) {
        return new Response(JSON.stringify({ error: error.message }), { status: 400 })
      }
      await supabaseAdmin.from('usuarios').update({ activo: true }).eq('id', body.id)
      return new Response(JSON.stringify({ success: true }), { status: 200 })
    }

    return new Response(JSON.stringify({ error: 'Acción no reconocida' }), { status: 400 })
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : 'Error desconocido' }), { status: 500 })
  }
})
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/gestionar-usuarios/index.ts
git commit -m "Add gestionar-usuarios Edge Function (crear/desactivar/reactivar)"
```

---

### Task 3: Setup y deploy (lo corre Giacomo en su terminal)

**Files:** ninguno — solo comandos de terminal.

- [ ] **Step 1: Instalar el CLI de Supabase**

```bash
brew install supabase/tap/supabase
```

- [ ] **Step 2: Iniciar sesión** (abre el navegador)

```bash
supabase login
```

- [ ] **Step 3: Vincular el proyecto**

Desde la carpeta `~/QiORAConectaGastos`:

```bash
cd ~/QiORAConectaGastos
supabase link --project-ref fnatpzeccnkurzqbhyfq
```

(El `project-ref` es el subdominio de tu URL de Supabase: `https://fnatpzeccnkurzqbhyfq.supabase.co` → `fnatpzeccnkurzqbhyfq`.)

- [ ] **Step 4: Guardar el secreto** (la llave la copias de Supabase Dashboard → Settings → API → `service_role` — **nunca la pegues en el chat**)

```bash
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=tu-llave-aqui
```

- [ ] **Step 5: Subir la función**

```bash
supabase functions deploy gestionar-usuarios
```

Esperado: mensaje de éxito con la URL de la función desplegada.

---

### Task 4: Vista "Gestión de Usuarios" en `index.html`

**Files:**
- Modify: `index.html`

**Interfaces:**
- Consumes: Edge Function `gestionar-usuarios` (Task 2/3).
- Produces: vista `vista-usuarios`, funciones `cargarUsuarios()`, `crearUsuario()`, `cambiarRolUsuario(id, rol)`, `desactivarUsuario(id)`, `reactivarUsuario(id)`.

- [ ] **Step 1: Agregar el ítem al sidebar** (junto a los demás, antes del botón "Cerrar sesión")

Buscar el botón `id="nav-cargar"` en el sidebar y agregar justo después:

```html
        <li><button data-vista="usuarios" id="nav-usuarios" onclick="mostrarVista('usuarios')" class="w-full flex items-center gap-sm p-sm rounded-lg text-on-surface-variant font-gordita-regular hover:bg-surface-container transition-colors text-left">
          <span class="material-symbols-outlined">group</span><span class="text-sm">Gestión de Usuarios</span>
        </button></li>
```

- [ ] **Step 2: Ocultar ese ítem para no-admin**

En `cargarSesion()`, dentro del bloque `if (perfil.rol !== 'admin') { ... }`, agregar:

```js
    document.getElementById('nav-usuarios').style.display = 'none';
```

- [ ] **Step 3: Agregar la vista HTML** (después de `vista-cargar`, antes de `vista-detalle-distrito`)

```html
      <div class="vista" id="vista-usuarios">
        <div class="mb-8 flex justify-between items-end flex-wrap gap-4">
          <div>
            <span class="font-gordita-bold text-xs text-secondary uppercase tracking-widest">QiORA Conecta</span>
            <h1 class="font-gordita-bold text-4xl text-primary mt-1">Gestión de Usuarios</h1>
          </div>
          <button onclick="mostrarFormularioUsuario()" class="px-4 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity flex items-center gap-2">
            <span class="material-symbols-outlined text-sm">add</span> Agregar Usuario
          </button>
        </div>
        <div id="form-usuario" class="bg-white border border-outline-variant rounded-xl shadow-sm p-6 mb-6 grid grid-cols-1 md:grid-cols-5 gap-3 items-end" style="display:none;">
          <input id="usuario-nombre" placeholder="Nombre completo" class="px-3 py-2 border border-outline-variant rounded text-sm md:col-span-2">
          <input id="usuario-correo" type="email" placeholder="Correo" class="px-3 py-2 border border-outline-variant rounded text-sm">
          <input id="usuario-password" type="password" placeholder="Contraseña inicial" class="px-3 py-2 border border-outline-variant rounded text-sm">
          <select id="usuario-rol" class="px-3 py-2 border border-outline-variant rounded text-sm">
            <option value="finanzas">finanzas</option>
            <option value="admin">admin</option>
          </select>
          <button onclick="crearUsuario()" class="px-4 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity">Crear</button>
        </div>
        <p id="estado-usuario" class="text-sm font-gordita-bold text-secondary mb-4"></p>
        <section class="bg-white border border-outline-variant rounded-xl shadow-sm overflow-hidden">
          <table id="tabla-usuarios" class="w-full text-left border-collapse">
            <thead>
              <tr class="bg-surface-container-low text-[10px] text-on-surface-variant border-b border-outline-variant">
                <th class="px-8 py-4 font-gordita-bold uppercase tracking-widest">Nombre</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest">Correo</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest">Rol</th>
                <th class="px-6 py-4 font-gordita-bold uppercase tracking-widest">Estado</th>
                <th class="px-6 py-4"></th>
              </tr>
            </thead>
            <tbody id="tabla-usuarios-body" class="text-sm divide-y divide-outline-variant"></tbody>
          </table>
        </section>
      </div>
```

- [ ] **Step 4: Agregar la lógica JS** (antes de la línea `cargarSesion();`)

```js
function mostrarFormularioUsuario() {
  document.getElementById('form-usuario').style.display = 'grid';
  document.getElementById('usuario-nombre').value = '';
  document.getElementById('usuario-correo').value = '';
  document.getElementById('usuario-password').value = '';
  document.getElementById('usuario-rol').value = 'finanzas';
  document.getElementById('estado-usuario').textContent = '';
}

async function crearUsuario() {
  const nombre = document.getElementById('usuario-nombre').value;
  const correo = document.getElementById('usuario-correo').value;
  const password = document.getElementById('usuario-password').value;
  const rol = document.getElementById('usuario-rol').value;
  if (!nombre || !correo || !password) {
    document.getElementById('estado-usuario').textContent = 'Completa nombre, correo y contraseña.';
    return;
  }
  document.getElementById('estado-usuario').textContent = 'Creando...';
  const { data, error } = await supabaseClient.functions.invoke('gestionar-usuarios', {
    body: { accion: 'crear', nombre, correo, password, rol },
  });
  if (error || (data && data.error)) {
    document.getElementById('estado-usuario').textContent = 'Error: ' + (data && data.error ? data.error : error.message);
    return;
  }
  document.getElementById('estado-usuario').textContent = 'Usuario creado.';
  document.getElementById('form-usuario').style.display = 'none';
  await cargarUsuarios();
}

async function cambiarRolUsuario(id, rol) {
  const { error } = await supabaseClient.from('usuarios').update({ rol }).eq('id', id);
  if (error) { alert('Error: ' + error.message); return; }
  await cargarUsuarios();
}

async function desactivarUsuario(id) {
  document.getElementById('estado-usuario').textContent = 'Desactivando...';
  const { data, error } = await supabaseClient.functions.invoke('gestionar-usuarios', {
    body: { accion: 'desactivar', id },
  });
  if (error || (data && data.error)) {
    document.getElementById('estado-usuario').textContent = 'Error: ' + (data && data.error ? data.error : error.message);
    return;
  }
  document.getElementById('estado-usuario').textContent = '';
  await cargarUsuarios();
}

async function reactivarUsuario(id) {
  document.getElementById('estado-usuario').textContent = 'Reactivando...';
  const { data, error } = await supabaseClient.functions.invoke('gestionar-usuarios', {
    body: { accion: 'reactivar', id },
  });
  if (error || (data && data.error)) {
    document.getElementById('estado-usuario').textContent = 'Error: ' + (data && data.error ? data.error : error.message);
    return;
  }
  document.getElementById('estado-usuario').textContent = '';
  await cargarUsuarios();
}

async function cargarUsuarios() {
  const { data, error } = await supabaseClient.from('usuarios').select('*').order('nombre');
  if (error) { console.error(error); return; }
  const cuerpo = document.getElementById('tabla-usuarios-body');
  cuerpo.innerHTML = '';
  data.forEach((u) => {
    const tr = document.createElement('tr');
    tr.className = 'hover:bg-surface-container-low/50 transition-colors';
    const accionBoton = u.activo
      ? `<button onclick="desactivarUsuario('${u.id}')" class="text-xs font-gordita-bold text-error hover:underline">Desactivar</button>`
      : `<button onclick="reactivarUsuario('${u.id}')" class="text-xs font-gordita-bold text-qiora-green hover:underline">Reactivar</button>`;
    tr.innerHTML = `<td class="px-8 py-4 font-gordita-bold">${u.nombre || ''}</td><td class="px-6 py-4">${u.correo || ''}</td><td class="px-6 py-4"><select onchange="cambiarRolUsuario('${u.id}', this.value)" class="text-xs border border-outline-variant rounded px-2 py-1"><option value="finanzas" ${u.rol === 'finanzas' ? 'selected' : ''}>finanzas</option><option value="admin" ${u.rol === 'admin' ? 'selected' : ''}>admin</option></select></td><td class="px-6 py-4">${u.activo ? 'Activo' : 'Inactivo'}</td><td class="px-6 py-4">${accionBoton}</td>`;
    cuerpo.appendChild(tr);
  });
}
```

- [ ] **Step 5: Disparar la carga desde `mostrarVista`**

```js
  if (nombre === 'usuarios') cargarUsuarios();
```

- [ ] **Step 6: Verificar sintaxis**

Extraer el `<script>` a un archivo temporal y correr `node --check` sobre él; confirmar sin errores, borrar el archivo temporal. Correr también `node --test calc.test.js` para confirmar que los 13 tests existentes siguen pasando (este cambio no toca `calc.js`).

- [ ] **Step 7: Commit**

```bash
git add index.html
git commit -m "Add Gestión de Usuarios view: create, list, change role, deactivate/reactivate"
```

---

### Task 5: "Cambiar contraseña" (cualquier usuario)

**Files:**
- Modify: `index.html`

- [ ] **Step 1: Agregar el link en el sidebar**, junto al botón "Cerrar sesión"

```html
      <button onclick="mostrarFormularioPassword()" class="w-full flex items-center gap-sm p-sm rounded-lg text-on-surface-variant hover:bg-surface-container transition-colors text-left">
        <span class="material-symbols-outlined">lock_reset</span><span class="text-sm">Cambiar contraseña</span>
      </button>
```

- [ ] **Step 2: Agregar un modal simple** (justo antes de cerrar `</body>`, fuera de `#app-shell` para que quede siempre disponible)

```html
<div id="modal-password" class="fixed inset-0 bg-black/40 items-center justify-center z-50" style="display:none;">
  <div class="bg-white rounded-xl p-6 w-80 shadow-xl">
    <h3 class="font-gordita-bold text-lg text-primary mb-4">Cambiar contraseña</h3>
    <input id="password-nueva" type="password" placeholder="Nueva contraseña" class="w-full mb-3 px-3 py-2 border border-outline-variant rounded text-sm">
    <input id="password-confirmar" type="password" placeholder="Confirmar contraseña" class="w-full mb-4 px-3 py-2 border border-outline-variant rounded text-sm">
    <p id="estado-password" class="text-xs text-error mb-3"></p>
    <div class="flex gap-2">
      <button onclick="guardarNuevaPassword()" class="flex-1 py-2 bg-primary text-on-primary font-gordita-bold text-xs uppercase tracking-widest rounded hover:opacity-90 transition-opacity">Guardar</button>
      <button onclick="cerrarFormularioPassword()" class="flex-1 py-2 border border-outline-variant font-gordita-bold text-xs uppercase tracking-widest rounded hover:bg-surface-container transition-colors">Cancelar</button>
    </div>
  </div>
</div>
```

- [ ] **Step 3: Agregar la lógica JS** (antes de `cargarSesion();`)

```js
function mostrarFormularioPassword() {
  document.getElementById('password-nueva').value = '';
  document.getElementById('password-confirmar').value = '';
  document.getElementById('estado-password').textContent = '';
  document.getElementById('modal-password').style.display = 'flex';
}

function cerrarFormularioPassword() {
  document.getElementById('modal-password').style.display = 'none';
}

async function guardarNuevaPassword() {
  const nueva = document.getElementById('password-nueva').value;
  const confirmar = document.getElementById('password-confirmar').value;
  if (nueva.length < 6) {
    document.getElementById('estado-password').textContent = 'Mínimo 6 caracteres.';
    return;
  }
  if (nueva !== confirmar) {
    document.getElementById('estado-password').textContent = 'Las contraseñas no coinciden.';
    return;
  }
  const { error } = await supabaseClient.auth.updateUser({ password: nueva });
  if (error) {
    document.getElementById('estado-password').textContent = 'Error: ' + error.message;
    return;
  }
  cerrarFormularioPassword();
}
```

- [ ] **Step 4: Verificar sintaxis y tests**

Mismo procedimiento que Task 4 Step 6.

- [ ] **Step 5: Commit**

```bash
git add index.html
git commit -m "Add self-service Cambiar contraseña modal for any logged-in user"
```

---

### Task 6: Verificación end-to-end (la corre Giacomo)

- [ ] **Step 1:** Recargar el dashboard (con caché deshabilitado en DevTools), entrar como admin, ir a "Gestión de Usuarios".
- [ ] **Step 2:** Crear un usuario de prueba (nombre, correo, contraseña, rol `finanzas`). Confirmar que aparece en la tabla.
- [ ] **Step 3:** Cerrar sesión, iniciar sesión con ese usuario nuevo y esa contraseña — confirmar que entra y que no ve "Gestión de Usuarios" ni "Cargar Datos" en el sidebar (rol finanzas).
- [ ] **Step 4:** Desde ese usuario, usar "Cambiar contraseña", poner una nueva, cerrar sesión, volver a entrar con la nueva contraseña.
- [ ] **Step 5:** Volver a entrar como admin, desactivar al usuario de prueba, confirmar que ya no puede iniciar sesión. Reactivarlo y confirmar que vuelve a poder.
