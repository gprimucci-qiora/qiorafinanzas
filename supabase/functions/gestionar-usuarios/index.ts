import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!
const SERVICE_ROLE_KEY = Deno.env.get(
  "SERVICE_ROLE_KEY",
)!

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
}

function jsonResponse(body, status) {
  const headers = {
    ...corsHeaders,
    "Content-Type": "application/json",
  }
  return new Response(
    JSON.stringify(body),
    { status, headers },
  )
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders })
  }

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
      return jsonResponse({ error: msg }, 401)
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
      return jsonResponse({ error: msg }, 403)
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
        return jsonResponse({ error: crearError.message }, 400)
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
        return jsonResponse({ error: insertError.message }, 400)
      }
      return jsonResponse({ success: true }, 200)
    }

    if (body.accion === "desactivar") {
      const result = await supabaseAdmin.auth.admin.updateUserById(
        body.id,
        { ban_duration: "876000h" },
      )
      if (result.error) {
        return jsonResponse({ error: result.error.message }, 400)
      }
      await supabaseAdmin
        .from("usuarios")
        .update({ activo: false })
        .eq("id", body.id)
      return jsonResponse({ success: true }, 200)
    }

    if (body.accion === "reactivar") {
      const result = await supabaseAdmin.auth.admin.updateUserById(
        body.id,
        { ban_duration: "none" },
      )
      if (result.error) {
        return jsonResponse({ error: result.error.message }, 400)
      }
      await supabaseAdmin
        .from("usuarios")
        .update({ activo: true })
        .eq("id", body.id)
      return jsonResponse({ success: true }, 200)
    }

    const msg = "Accion"
      + " no"
      + " reconocida"
    return jsonResponse({ error: msg }, 400)
  } catch (e) {
    const msg = e instanceof Error
      ? e.message
      : "Error desconocido"
    return jsonResponse({ error: msg }, 500)
  }
})
