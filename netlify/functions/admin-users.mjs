import { createClient } from "@supabase/supabase-js";

const JSON_HEADERS = {
  "content-type": "application/json"
};

const ROLES = new Set(["admin", "gestor", "colaborador"]);

export async function handler(event) {
  if (event.httpMethod !== "POST") {
    return json(405, { error: "Metodo nao permitido." });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: "Variaveis Supabase ausentes no servidor." });
  }

  const token = readBearerToken(event.headers.authorization || event.headers.Authorization);
  if (!token) {
    return json(401, { error: "Sessao nao informada." });
  }

  const payload = parseBody(event.body);
  if (!payload.ok) return json(400, { error: payload.error });

  const body = payload.value;
  const profile = normalizeProfile(body);
  const password = String(body.password || "").trim();

  if (!profile.email || !profile.nome) {
    return json(400, { error: "Nome e e-mail sao obrigatorios." });
  }

  if (!ROLES.has(profile.role)) {
    return json(400, { error: "Perfil invalido." });
  }

  if (body.createAuthUser !== false && password.length < 8) {
    return json(400, { error: "Informe uma senha inicial com pelo menos 8 caracteres." });
  }

  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } }
  });
  const adminClient = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false }
  });

  const { data: authData, error: authError } = await userClient.auth.getUser(token);
  if (authError || !authData.user) {
    return json(401, { error: "Sessao invalida." });
  }

  const { data: caller, error: callerError } = await adminClient
    .from("profiles")
    .select("role,active")
    .eq("id", authData.user.id)
    .single();

  if (callerError || !caller?.active || caller.role !== "admin") {
    return json(403, { error: "Apenas administradores podem criar usuarios." });
  }

  try {
    let userId = profile.id;

    if (body.createAuthUser !== false) {
      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: profile.email,
        password,
        email_confirm: true,
        user_metadata: {
          nome: profile.nome,
          role: profile.role
        }
      });

      if (createError) throw createError;
      userId = created.user?.id;
    }

    if (!userId) {
      return json(400, { error: "ID do usuario Auth nao encontrado." });
    }

    const { data: savedProfile, error: profileError } = await adminClient
      .from("profiles")
      .upsert(
        {
          id: userId,
          email: profile.email,
          nome: profile.nome,
          role: profile.role,
          active: profile.active
        },
        { onConflict: "id" }
      )
      .select("id,email,nome,role,active,created_at,updated_at")
      .single();

    if (profileError) throw profileError;

    return json(200, { profile: savedProfile });
  } catch (error) {
    return json(400, { error: error?.message || "Nao foi possivel criar o usuario." });
  }
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: JSON_HEADERS,
    body: JSON.stringify(body)
  };
}

function readBearerToken(value) {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

function parseBody(value) {
  try {
    return { ok: true, value: JSON.parse(value || "{}") };
  } catch {
    return { ok: false, error: "JSON invalido." };
  }
}

function normalizeProfile(body) {
  return {
    id: typeof body.id === "string" ? body.id.trim() : "",
    email: typeof body.email === "string" ? body.email.trim().toLowerCase() : "",
    nome: typeof body.nome === "string" ? body.nome.trim() : "",
    role: typeof body.role === "string" ? body.role : "colaborador",
    active: body.active !== false
  };
}
