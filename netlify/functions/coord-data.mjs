const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const MANAGER_ROLES = new Set(["admin", "gestor"]);
const ITEM_TYPES = new Set(["colaborador", "coordenacao", "pauta"]);
const PRIORITIES = new Set(["alta", "media", "baixa"]);
const RECURRENCES = new Set(["none", "weekly", "monthly"]);
const STATUSES = new Set(["aberto", "concluido"]);
const PINNED = new Set(["main", "hidden"]);

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return json(204, {});
  }

  if (!["GET", "PUT"].includes(request.method)) {
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

  try {
    const authUser = await verifySession(supabaseUrl, supabaseAnonKey, token);
    const profile = await readProfile(supabaseUrl, serviceRoleKey, authUser.id);

    if (!profile?.active || !MANAGER_ROLES.has(profile.role)) {
      return json(403, { error: "Apenas administradores ou gestores podem sincronizar a Coordenacao Tributaria." });
    }

    if (request.method === "GET") {
      const state = await loadState(supabaseUrl, serviceRoleKey);
      return json(200, { source: "supabase", state });
    }

    const payload = await parseJsonBody(request);
    const state = normalizeState(payload?.state, authUser.id);
    await saveState(supabaseUrl, serviceRoleKey, state);
    return json(200, { ok: true, source: "supabase", state });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 400;
    return json(statusCode, { error: error?.message || "Nao foi possivel sincronizar a Coordenacao Tributaria." });
  }
}

async function loadState(supabaseUrl, serviceRoleKey) {
  const [collaboratorRows, itemRows] = await Promise.all([
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_colaboradores?select=id,nome,email,funcao,active,created_at,updated_at&order=nome.asc`,
      { headers: serviceHeaders(serviceRoleKey) }
    ),
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_itens?select=id,titulo,descricao,tipo,colaborador_id,prazo,prioridade,recorrencia,status,pinned,anexos,deleted_at,completed_at,created_at,updated_at&order=updated_at.desc`,
      { headers: serviceHeaders(serviceRoleKey) }
    )
  ]);

  return {
    collaborators: (Array.isArray(collaboratorRows) ? collaboratorRows : []).map(fromCollaboratorRow),
    reminders: (Array.isArray(itemRows) ? itemRows : []).map(fromItemRow)
  };
}

async function saveState(supabaseUrl, serviceRoleKey, state) {
  if (state.collaborators.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_colaboradores?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(state.collaborators.map(toCollaboratorRow))
    });
  }

  if (state.reminders.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(state.reminders.map(toItemRow))
    });
  }
}

function normalizeState(value, userId) {
  if (!value || !Array.isArray(value.collaborators) || !Array.isArray(value.reminders)) {
    throw httpError(400, "Estado da Coordenacao Tributaria invalido.");
  }

  return {
    collaborators: value.collaborators.map((item) => normalizeCollaborator(item, userId)),
    reminders: value.reminders.map((item) => normalizeItem(item, userId))
  };
}

function normalizeCollaborator(item, userId) {
  const id = String(item?.id || "").trim() || randomId();
  const name = String(item?.name || item?.nome || "").trim();
  const email = String(item?.email || "").trim().toLowerCase();

  if (!name || !email) {
    throw httpError(400, "Colaborador sem nome ou e-mail.");
  }

  return {
    id,
    name,
    email,
    role: String(item?.role || item?.funcao || "").trim(),
    active: item?.active !== false,
    createdBy: userId,
    createdAt: normalizeDate(item?.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(item?.updatedAt) || new Date().toISOString()
  };
}

function normalizeItem(item, userId) {
  const id = String(item?.id || "").trim() || randomId();
  const title = String(item?.title || item?.titulo || "").trim();

  if (!title) {
    throw httpError(400, "Item de Coordenacao sem titulo.");
  }

  const type = ITEM_TYPES.has(item?.type) ? item.type : "colaborador";
  const priority = PRIORITIES.has(item?.priority) ? item.priority : "media";
  const recurring = RECURRENCES.has(item?.recurring) ? item.recurring : "none";
  const status = STATUSES.has(item?.status) ? item.status : "aberto";
  const pinned = PINNED.has(item?.pinned) ? item.pinned : "main";
  const attachments = Array.isArray(item?.attachments) ? item.attachments.map(normalizeAttachment).filter(Boolean) : [];

  return {
    id,
    title,
    description: String(item?.description || item?.descricao || "").trim(),
    type,
    collaboratorId: String(item?.collaboratorId || item?.colaborador_id || "").trim(),
    due: String(item?.due || item?.prazo || "").trim(),
    priority,
    recurring,
    status,
    pinned,
    attachments,
    deletedAt: normalizeDate(item?.deletedAt),
    completedAt: normalizeDate(item?.completedAt),
    createdBy: userId,
    createdAt: normalizeDate(item?.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(item?.updatedAt) || new Date().toISOString()
  };
}

function normalizeAttachment(item) {
  if (!item) return null;
  const name = String(item.name || item.file_name || "").trim();
  if (!name) return null;

  return {
    id: String(item.id || randomId()),
    name,
    type: String(item.type || item.mime_type || "application/octet-stream"),
    size: Number(item.size || item.size_bytes || 0),
    dataUrl: String(item.dataUrl || ""),
    createdAt: normalizeDate(item.createdAt) || new Date().toISOString()
  };
}

function fromCollaboratorRow(row) {
  return {
    id: row.id,
    name: row.nome,
    email: row.email,
    role: row.funcao || "",
    active: row.active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fromItemRow(row) {
  return {
    id: row.id,
    title: row.titulo,
    description: row.descricao || "",
    type: row.tipo || "colaborador",
    collaboratorId: row.colaborador_id || "",
    due: row.prazo || "",
    priority: row.prioridade || "media",
    recurring: row.recorrencia || "none",
    status: row.status || "aberto",
    pinned: row.pinned || "main",
    attachments: Array.isArray(row.anexos) ? row.anexos : [],
    deletedAt: row.deleted_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function toCollaboratorRow(item) {
  return {
    id: item.id,
    nome: item.name,
    email: item.email,
    funcao: item.role,
    active: item.active,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toItemRow(item) {
  return {
    id: item.id,
    titulo: item.title,
    descricao: item.description,
    tipo: item.type,
    colaborador_id: item.collaboratorId || null,
    prazo: item.due,
    prioridade: item.priority,
    recorrencia: item.recurring,
    status: item.status,
    pinned: item.pinned,
    anexos: item.attachments,
    deleted_at: item.deletedAt || null,
    completed_at: item.completedAt || null,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
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

async function readProfile(supabaseUrl, serviceRoleKey, userId) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,active&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) }
  );

  return Array.isArray(rows) ? rows[0] : null;
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw httpError(response.status, data?.message || data?.msg || data?.error || text || response.statusText);
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
  return new Response(status === 204 ? null : JSON.stringify(body), {
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

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "JSON invalido.");
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

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
