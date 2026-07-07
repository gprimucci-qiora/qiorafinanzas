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
