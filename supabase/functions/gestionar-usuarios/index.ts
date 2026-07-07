import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get(
  "SERVICE_ROLE_KEY",
)!

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get("Authorization") || ""
    const jwt = authHeader.replace("Bearer ", "")
    const supabaseAdmin = createClient(
      SUPABASE_URL,
      SERVICE_ROLE_KEY,
    )

    const authResult = await supabaseAdmin.auth.getUser(jwt)
    const userData = authResult.data
    const userError = authResult.error
    if (userError || !userData.user) {
      const msg = "No autenticado"
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 401 },
      )
    }

    const perfilResult = await supabaseAdmin
      .from("usuarios")
      .select("rol")
      .eq("id", userData.user.id)
      .single()
    const perfil = perfilResult.data
    if (!perfil || perfil.rol !== "admin") {
      const msg = "Solo"
        + " un admin"
        + " puede"
        + " gestionar"
        + " usuarios"
      return new Response(
        JSON.stringify({ error: msg }),
        { status: 403 },
      )
    }

    const body = await req.json()

    if (body.accion === "crear") {
      const crearResult = await supabaseAdmin.auth.admin.createUser({
        email: body.correo,
        password: body.password,
        email_confirm: true,
      })
      const nuevoUsuario = crearResult.data
      const crearError = crearResult.error
      if (crearError) {
        return new Response(
          JSON.stringify({ error: crearError.message }),
          { status: 400 },
        )
      }
      const insertResult = await supabaseAdmin
        .from("usuarios")
        .insert({
          id: nuevoUsuario.user.id,
          nombre: body.nombre,
          correo: body.correo,
          rol: body.rol,
        })
      const insertError = insertResult.error
      if (insertError) {
        return new Response(
          JSON.stringify({ error: insertError.message }),
          { status: 400 },
        )
      }
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200 },
      )
    }

    if (body.accion === "desactivar") {
      const result = await supabaseAdmin.auth.admin.updateUserById(
        body.id,
        { ban_duration: "876000h" },
      )
      if (result.error) {
        return new Response(
          JSON.stringify({ error: result.error.message }),
          { status: 400 },
        )
      }
      await supabaseAdmin
        .from("usuarios")
        .update({ activo: false })
        .eq("id", body.id)
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200 },
      )
    }

    if (body.accion === "reactivar") {
      const result = await supabaseAdmin.auth.admin.updateUserById(
        body.id,
        { ban_duration: "none" },
      )
      if (result.error) {
        return new Response(
          JSON.stringify({ error: result.error.message }),
          { status: 400 },
        )
      }
      await supabaseAdmin
        .from("usuarios")
        .update({ activo: true })
        .eq("id", body.id)
      return new Response(
        JSON.stringify({ success: true }),
        { status: 200 },
      )
    }

    const msg = "Accion"
      + " no"
      + " reconocida"
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 400 },
    )
  } catch (e) {
    const msg = e instanceof Error
      ? e.message
      : "Error desconocido"
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500 },
    )
  }
})
