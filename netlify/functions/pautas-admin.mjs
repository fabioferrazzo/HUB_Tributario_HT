const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const PRIORITIES = new Set(["alta", "normal", "baixa"]);
const STATUSES = new Set(["aberta", "concluida"]);
const SCOPES = new Set(["todos", "usuarios"]);

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

  try {
    const authUser = await verifySession(supabaseUrl, supabaseAnonKey, token);
    const callerProfile = await assertAdminCaller(supabaseUrl, serviceRoleKey, authUser);
    const action = String(payload.value.action || "upsert");

    if (action === "delete") {
      const pautaId = String(payload.value.id || "").trim();
      if (!pautaId) return json(400, { error: "ID da pauta nao informado." });
      await deletePauta(supabaseUrl, serviceRoleKey, pautaId);
      return json(200, { ok: true, id: pautaId });
    }

    if (action !== "upsert") {
      return json(400, { error: "Acao invalida." });
    }

    const pauta = normalizePautaPayload(payload.value.pauta, callerProfile);
    const saved = await upsertPauta(supabaseUrl, serviceRoleKey, pauta);
    await replacePautaUsuarios(supabaseUrl, serviceRoleKey, saved.id, pauta.responsaveis);

    return json(200, { ok: true, id: saved.id, pauta: saved });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 400;
    return json(statusCode, { error: toPublicMessage(error), detail: error?.detail || "" });
  }
}

async function verifySession(supabaseUrl, anonKey, token) {
  const user = await supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });

  if (!user?.id || !user?.email) {
    throw httpError(401, "Sessao invalida.");
  }

  return { id: user.id, email: String(user.email).toLowerCase() };
}

async function assertAdminCaller(supabaseUrl, serviceRoleKey, authUser) {
  const byId = await selectProfiles(supabaseUrl, serviceRoleKey, `id=eq.${encodeURIComponent(authUser.id)}`);
  const byEmail = byId.length ? byId : await selectProfiles(supabaseUrl, serviceRoleKey, `email=eq.${encodeURIComponent(authUser.email)}`);
  const profile = byEmail[0];

  if (!profile?.active || profile.role !== "admin") {
    throw httpError(403, "Apenas o administrador pode gerenciar pautas.", {
      authUserId: authUser.id,
      authEmail: authUser.email,
      profileId: profile?.id || "",
      profileEmail: profile?.email || "",
      profileRole: profile?.role || "",
      profileActive: profile?.active ?? null
    });
  }

  return {
    id: profile.id,
    email: String(profile.email || authUser.email).toLowerCase(),
    nome: profile.nome || authUser.email
  };
}

async function selectProfiles(supabaseUrl, serviceRoleKey, filter) {
  const rows = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/profiles?select=id,email,nome,role,active&${filter}&limit=1`, {
    headers: serviceHeaders(serviceRoleKey)
  });
  return Array.isArray(rows) ? rows : [];
}

function normalizePautaPayload(raw, callerProfile) {
  const value = raw && typeof raw === "object" ? raw : {};
  const id = typeof value.id === "string" && value.id.trim() ? value.id.trim() : crypto.randomUUID();
  const titulo = typeof value.titulo === "string" ? value.titulo.trim() : "";
  const descricao = typeof value.descricao === "string" ? value.descricao : "";
  const prioridade = PRIORITIES.has(value.prioridade) ? value.prioridade : "normal";
  const status = STATUSES.has(value.status) ? value.status : "aberta";
  const scope = SCOPES.has(value.scope) ? value.scope : "todos";
  const responsaveis = Array.isArray(value.responsaveis)
    ? [...new Set(value.responsaveis.map((email) => String(email || "").trim().toLowerCase()).filter(Boolean))]
    : [];

  if (!titulo) {
    throw httpError(400, "Titulo da pauta e obrigatorio.");
  }

  return {
    id,
    titulo,
    descricao,
    prazo: value.prazo || null,
    prioridade,
    status,
    scope,
    destaque: Boolean(value.destaque),
    created_by: callerProfile.id,
    created_by_email: callerProfile.email,
    responsaveis
  };
}

async function upsertPauta(supabaseUrl, serviceRoleKey, pauta) {
  const rows = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?on_conflict=id&select=id,titulo,created_by,created_by_email`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify({
      id: pauta.id,
      titulo: pauta.titulo,
      descricao: pauta.descricao,
      prazo: pauta.prazo,
      prioridade: pauta.prioridade,
      status: pauta.status,
      scope: pauta.scope,
      destaque: pauta.destaque,
      created_by: pauta.created_by,
      created_by_email: pauta.created_by_email
    })
  });

  const saved = Array.isArray(rows) ? rows[0] : rows;
  if (!saved?.id) throw httpError(500, "Pauta salva sem ID retornado.");
  return saved;
}

async function replacePautaUsuarios(supabaseUrl, serviceRoleKey, pautaId, emails) {
  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pauta_usuarios?pauta_id=eq.${encodeURIComponent(pautaId)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey)
  });

  if (!emails.length) return;

  const profiles = await getProfilesByEmail(supabaseUrl, serviceRoleKey, emails);
  const rows = emails.map((email) => {
    const profile = profiles.get(email);
    return {
      pauta_id: pautaId,
      user_id: profile?.id || null,
      email,
      nome: profile?.nome || email
    };
  });

  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pauta_usuarios`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(rows)
  });
}

async function getProfilesByEmail(supabaseUrl, serviceRoleKey, emails) {
  if (!emails.length) return new Map();
  const quoted = emails.map((email) => `"${email.replace(/"/g, '\\"')}"`).join(",");
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?select=id,email,nome&email=in.(${encodeURIComponent(quoted)})`,
    { headers: serviceHeaders(serviceRoleKey) }
  );
  return new Map((Array.isArray(rows) ? rows : []).map((profile) => [String(profile.email).toLowerCase(), profile]));
}

async function deletePauta(supabaseUrl, serviceRoleKey, pautaId) {
  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=eq.${encodeURIComponent(pautaId)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey)
  });
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw httpError(response.status, extractSupabaseMessage(data, text, response.statusText), data);
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

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function extractSupabaseMessage(data, text, fallback) {
  return data?.msg || data?.message || data?.error_description || data?.error || text || fallback || "Erro Supabase.";
}

function httpError(statusCode, message, detail = "") {
  const error = new Error(message);
  error.statusCode = statusCode;
  error.detail = detail;
  return error;
}

function toPublicMessage(error) {
  return error?.message || "Nao foi possivel gerenciar a pauta.";
}
