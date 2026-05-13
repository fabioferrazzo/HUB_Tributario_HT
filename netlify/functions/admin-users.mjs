const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const ROLES = new Set(["admin", "gestor", "colaborador"]);

export default async function handler(request) {
  if (request.method !== "POST") {
    return json(405, { error: "Metodo nao permitido." });
  }

  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: "Variaveis Supabase ausentes no servidor." });
  }

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(401, { error: "Sessao nao informada." });
  }

  const payload = await parseBody(request);
  if (!payload.ok) return json(400, { error: payload.error });

  const body = payload.value;
  const profile = normalizeProfile(body);
  const password = String(body.password || "").trim();
  const action = String(body.action || "upsert-user");

  if (!profile.email || !profile.nome) {
    return json(400, { error: "Nome e e-mail sao obrigatorios." });
  }

  if (!ROLES.has(profile.role)) {
    return json(400, { error: "Perfil invalido." });
  }

  if ((action === "reset-password" || body.createAuthUser !== false) && password.length < 8) {
    return json(400, { error: "Informe uma senha inicial com pelo menos 8 caracteres." });
  }

  try {
    const authUser = await verifySession(supabaseUrl, supabaseAnonKey, token);
    await assertAdminCaller(supabaseUrl, serviceRoleKey, authUser.id);

    if (action === "reset-password") {
      if (!profile.id) {
        return json(400, { error: "ID Auth Supabase nao informado para redefinir senha." });
      }

      await resetAuthUserPassword(supabaseUrl, serviceRoleKey, profile.id, password);
      const emailQueued = await queuePasswordResetEmail(supabaseUrl, serviceRoleKey, profile, password, authUser.id);
      return json(200, { ok: true, emailQueued });
    }

    let userId = profile.id;

    if (body.createAuthUser !== false) {
      const created = await createAuthUser(supabaseUrl, serviceRoleKey, profile, password);
      userId = created.user?.id || created.id || created.user_id;
    }

    if (!userId) {
      return json(400, { error: "ID do usuario Auth nao encontrado." });
    }

    const savedProfile = await upsertProfile(supabaseUrl, serviceRoleKey, {
      id: userId,
      email: profile.email,
      nome: profile.nome,
      role: profile.role,
      active: profile.active
    });

    return json(200, { profile: savedProfile });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 400;
    return json(statusCode, { error: toPublicMessage(error) });
  }
}

async function verifySession(supabaseUrl, anonKey, token) {
  const user = await supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });

  if (!user?.id) {
    throw httpError(401, "Sessao invalida.");
  }

  return user;
}

async function assertAdminCaller(supabaseUrl, serviceRoleKey, userId) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,active&limit=1`,
    {
      headers: serviceHeaders(serviceRoleKey)
    }
  );

  const caller = Array.isArray(rows) ? rows[0] : null;

  if (!caller?.active || caller.role !== "admin") {
    throw httpError(403, "Apenas administradores podem criar usuarios.");
  }
}

async function createAuthUser(supabaseUrl, serviceRoleKey, profile, password) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: profile.email,
      password,
      email_confirm: true,
      user_metadata: {
        nome: profile.nome,
        role: profile.role
      }
    })
  });
}

async function resetAuthUserPassword(supabaseUrl, serviceRoleKey, userId, password) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/admin/users/${encodeURIComponent(userId)}`, {
    method: "PUT",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({
      password
    })
  });
}

async function queuePasswordResetEmail(supabaseUrl, serviceRoleKey, profile, password, createdBy) {
  try {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/queue_email`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        p_to_email: profile.email,
        p_to_name: profile.nome,
        p_subject: "Senha provisoria do HUB Depto Tributario",
        p_html_body:
          "<p>Uma senha provisoria foi gerada para seu acesso ao HUB Depto Tributario.</p>" +
          `<p><strong>E-mail:</strong> ${escapeHtml(profile.email)}</p>` +
          `<p><strong>Senha provisoria:</strong> ${escapeHtml(password)}</p>` +
          `<p>Acesse: <a href="${escapeHtml(getAppBaseUrl())}">${escapeHtml(getAppBaseUrl())}</a></p>`,
        p_text_body:
          "Uma senha provisoria foi gerada para seu acesso ao HUB Depto Tributario.\n" +
          `E-mail: ${profile.email}\n` +
          `Senha provisoria: ${password}\n` +
          `Acesse: ${getAppBaseUrl()}`,
        p_category: "usuario_senha",
        p_target_type: "profile",
        p_target_ref: profile.id,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: `password_reset:${profile.id}:${Date.now()}`,
        p_created_by: createdBy
      })
    });
    return true;
  } catch (error) {
    console.warn("Nao foi possivel enfileirar e-mail de senha provisoria.", error?.message || error);
    return false;
  }
}

async function upsertProfile(supabaseUrl, serviceRoleKey, profile) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?on_conflict=id&select=id,email,nome,role,active,created_at,updated_at`,
    {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates,return=representation"
      },
      body: JSON.stringify(profile)
    }
  );

  return Array.isArray(rows) ? rows[0] : rows;
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw httpError(response.status, extractSupabaseMessage(data, text, response.statusText));
  }

  return data;
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function readBearerToken(value) {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function parseBody(request) {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, error: "JSON invalido." };
  }
}

function parseJson(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
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

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function getAppBaseUrl() {
  return getEnv("APP_BASE_URL") || getEnv("URL") || "https://hub-depto-tributario-ht.netlify.app";
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function extractSupabaseMessage(data, text, fallback) {
  return data?.msg || data?.message || data?.error_description || data?.error || text || fallback || "Erro Supabase.";
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function toPublicMessage(error) {
  const message = error?.message || "Nao foi possivel criar o usuario.";

  if (/already registered|already exists|duplicate/i.test(message)) {
    return "Este e-mail ja possui usuario no Supabase Auth.";
  }

  return message;
}
