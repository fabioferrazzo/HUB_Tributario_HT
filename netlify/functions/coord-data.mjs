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
  const [collaboratorRows, itemRows, pautaRows] = await Promise.all([
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_colaboradores?select=id,nome,email,funcao,active,created_at,updated_at&order=nome.asc`,
      { headers: serviceHeaders(serviceRoleKey) }
    ),
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_itens?select=id,titulo,descricao,tipo,colaborador_id,prazo,prioridade,recorrencia,status,pinned,anexos,integrar_calendario,tarefa_id,deleted_at,completed_at,created_at,updated_at&order=updated_at.desc`,
      { headers: serviceHeaders(serviceRoleKey) }
    ),
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/pautas?select=id,titulo,descricao,prazo,prioridade,status,scope,destaque,created_by,created_by_email,created_at,updated_at&order=updated_at.desc`,
      { headers: serviceHeaders(serviceRoleKey) }
    )
  ]);

  const nativePautas = await loadNativePautasForCoord(supabaseUrl, serviceRoleKey, Array.isArray(pautaRows) ? pautaRows : []);
  const nativePautaIds = new Set(nativePautas.map((item) => item.id));
  const legacyItems = (Array.isArray(itemRows) ? itemRows : [])
    .map(fromItemRow)
    .filter((item) => !(item.type === "pauta" && nativePautaIds.has(item.id)));

  return {
    collaborators: (Array.isArray(collaboratorRows) ? collaboratorRows : []).map(fromCollaboratorRow),
    reminders: [...nativePautas, ...legacyItems]
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

  await syncCalendarTasksFromCoord(supabaseUrl, serviceRoleKey, state.reminders, state.collaborators);
  await saveNativePautasFromCoord(supabaseUrl, serviceRoleKey, state.reminders);
}

async function loadNativePautasForCoord(supabaseUrl, serviceRoleKey, rows) {
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id).filter(Boolean);
  const [usuariosRows, anexoRows] = await Promise.all([
    ids.length
      ? supabaseRequest(
          `${trimUrl(supabaseUrl)}/rest/v1/pauta_usuarios?pauta_id=in.(${ids.map(encodeURIComponent).join(",")})&select=pauta_id,email,nome,user_id`,
          { headers: serviceHeaders(serviceRoleKey) }
        )
      : [],
    ids.length
      ? supabaseRequest(
          `${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos?pauta_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,pauta_id,file_name,storage_path,mime_type,size_bytes,created_at`,
          { headers: serviceHeaders(serviceRoleKey) }
        )
      : []
  ]);

  return rows.map((row) =>
    fromPautaRow(
      row,
      (Array.isArray(usuariosRows) ? usuariosRows : []).filter((item) => item.pauta_id === row.id),
      (Array.isArray(anexoRows) ? anexoRows : []).filter((item) => item.pauta_id === row.id),
      supabaseUrl
    )
  );
}

async function saveNativePautasFromCoord(supabaseUrl, serviceRoleKey, reminders) {
  const pautaItems = reminders.filter((item) => item.type === "pauta");
  if (!pautaItems.length) return;

  const deletedIds = pautaItems.filter((item) => item.deletedAt).map((item) => item.id).filter(Boolean);
  if (deletedIds.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=in.(${deletedIds.map(encodeURIComponent).join(",")})`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });
  }

  const activePautas = pautaItems.filter((item) => !item.deletedAt);
  if (!activePautas.length) return;

  const ids = activePautas.map((item) => item.id).filter(Boolean);
  const existingRows = ids.length
    ? await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id`, {
        headers: serviceHeaders(serviceRoleKey)
      })
    : [];
  const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => row.id));

  const inserts = activePautas.filter((item) => !existingIds.has(item.id)).map(toNewPautaRow);
  if (inserts.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(inserts)
    });
  }

  for (const item of activePautas.filter((entry) => existingIds.has(entry.id))) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify(toExistingPautaPatch(item))
    });
  }

  await syncPautaAttachmentsFromCoord(supabaseUrl, serviceRoleKey, activePautas);
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
  const calendarSync = item?.calendarSync === true || item?.integrar_calendario === true;

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
    calendarSync: type === "colaborador" && calendarSync,
    taskId: isUuid(String(item?.taskId || item?.tarefa_id || "")) ? String(item?.taskId || item?.tarefa_id) : "",
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
    url: String(item.url || ""),
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
    calendarSync: row.integrar_calendario === true,
    taskId: row.tarefa_id || "",
    attachments: Array.isArray(row.anexos) ? row.anexos : [],
    deletedAt: row.deleted_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fromPautaRow(row, usuarios, anexos, supabaseUrl) {
  return {
    id: row.id,
    title: row.titulo,
    description: row.descricao || "",
    type: "pauta",
    collaboratorId: "",
    due: row.prazo || "",
    priority: fromPautaPriority(row.prioridade),
    recurring: "none",
    status: row.status === "concluida" ? "concluido" : "aberto",
    pinned: row.destaque ? "main" : "main",
    attachments: anexos.map((anexo) => fromPautaAnexoRow(anexo, supabaseUrl)),
    deletedAt: "",
    completedAt: "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scope: row.scope || "todos",
    assignedUsers: usuarios.map((item) => ({
      email: item.email,
      name: item.nome || item.email,
      userId: item.user_id || ""
    }))
  };
}

function fromPautaAnexoRow(row, supabaseUrl) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.mime_type || "application/octet-stream",
    size: Number(row.size_bytes || 0),
    dataUrl: "",
    url: buildPublicStorageUrl(supabaseUrl, "hub-anexos", row.storage_path),
    createdAt: row.created_at
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
    integrar_calendario: item.calendarSync === true,
    tarefa_id: isUuid(item.taskId || "") ? item.taskId : null,
    anexos: item.attachments,
    deleted_at: item.deletedAt || null,
    completed_at: item.completedAt || null,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toNewPautaRow(item) {
  return {
    id: item.id,
    titulo: item.title,
    descricao: item.description,
    prazo: item.due || null,
    prioridade: toPautaPriority(item.priority),
    status: item.status === "concluido" ? "concluida" : "aberta",
    scope: "todos",
    destaque: item.pinned === "main",
    created_by: item.createdBy,
    created_by_email: "",
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toExistingPautaPatch(item) {
  return {
    titulo: item.title,
    descricao: item.description,
    prazo: item.due || null,
    prioridade: toPautaPriority(item.priority),
    status: item.status === "concluido" ? "concluida" : "aberta",
    destaque: item.pinned === "main",
    updated_at: item.updatedAt
  };
}

async function syncPautaAttachmentsFromCoord(supabaseUrl, serviceRoleKey, pautaItems) {
  const candidates = pautaItems
    .flatMap((item) =>
      (item.attachments || [])
        .filter((attachment) => attachment?.dataUrl && attachment.name)
        .map((attachment) => ({ pauta: item, attachment }))
    );

  if (!candidates.length) return;

  const pautaIds = [...new Set(candidates.map((item) => item.pauta.id).filter(Boolean))];
  const existingRows = pautaIds.length
    ? await supabaseRequest(
        `${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos?pauta_id=in.(${pautaIds.map(encodeURIComponent).join(",")})&select=id,pauta_id,file_name,size_bytes`,
        { headers: serviceHeaders(serviceRoleKey) }
      )
    : [];

  const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => row.id));
  const existingKeys = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => `${row.pauta_id}:${row.file_name}:${Number(row.size_bytes || 0)}`)
  );

  for (const { pauta, attachment } of candidates) {
    const bytes = parseDataUrlBytes(attachment.dataUrl);
    if (!bytes?.length) continue;

    const attachmentId = isUuid(attachment.id) ? attachment.id : randomId();
    const duplicateKey = `${pauta.id}:${attachment.name}:${bytes.length}`;
    if (existingIds.has(attachmentId) || existingKeys.has(duplicateKey)) continue;

    const storagePath = `pautas/${pauta.id}/${attachmentId}-${toSafeStorageFileName(attachment.name)}`;
    await uploadStorageObject(supabaseUrl, serviceRoleKey, "hub-anexos", storagePath, bytes, attachment.type || "application/octet-stream");

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: attachmentId,
        pauta_id: pauta.id,
        file_name: attachment.name,
        storage_path: storagePath,
        mime_type: attachment.type || "application/octet-stream",
        size_bytes: bytes.length,
        uploaded_by: pauta.createdBy || null
      })
    });

    existingIds.add(attachmentId);
    existingKeys.add(duplicateKey);
  }
}

async function syncCalendarTasksFromCoord(supabaseUrl, serviceRoleKey, reminders, collaborators) {
  const collaboratorById = new Map(collaborators.map((item) => [item.id, item]));
  const syncItems = reminders.filter((item) => item.type === "colaborador" && item.calendarSync === true && !item.deletedAt);
  const unsyncItems = reminders.filter((item) => item.type === "colaborador" && item.calendarSync !== true && isUuid(item.taskId || ""));

  for (const item of unsyncItems) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefas?id=eq.${encodeURIComponent(item.taskId)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({ tarefa_id: null })
    });
  }

  for (const item of syncItems) {
    const taskId = isUuid(item.taskId || "") ? item.taskId : randomId();
    const collaborator = collaboratorById.get(item.collaboratorId);
    const responsibleEmail = collaborator?.email || "";

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefas?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        id: taskId,
        titulo: item.title,
        descricao: item.description || "",
        prazo: item.due || null,
        prioridade: coordPriorityToTaskPriority(item.priority),
        status: item.status === "concluido" ? "concluida" : "aberta",
        destaque: item.priority === "alta",
        origem: "coord",
        coord_item_id: item.id,
        created_by: item.createdBy || null,
        created_at: item.createdAt || new Date().toISOString(),
        updated_at: item.updatedAt || new Date().toISOString()
      })
    });

    if (taskId !== item.taskId) {
      item.taskId = taskId;
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: {
          ...serviceHeaders(serviceRoleKey),
          "content-type": "application/json"
        },
        body: JSON.stringify({ tarefa_id: taskId })
      });
    }

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefa_usuarios?tarefa_id=eq.${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });

    if (responsibleEmail) {
      const profileRows = await supabaseRequest(
        `${trimUrl(supabaseUrl)}/rest/v1/profiles?email=eq.${encodeURIComponent(responsibleEmail.toLowerCase())}&select=id,email,nome&limit=1`,
        { headers: serviceHeaders(serviceRoleKey) }
      );
      const profile = Array.isArray(profileRows) ? profileRows[0] : null;
      if (profile?.id) {
        await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefa_usuarios`, {
          method: "POST",
          headers: {
            ...serviceHeaders(serviceRoleKey),
            "content-type": "application/json"
          },
          body: JSON.stringify({
            tarefa_id: taskId,
            user_id: profile.id,
            email: profile.email || responsibleEmail,
            nome: profile.nome || collaborator?.name || responsibleEmail
          })
        });
      }
    }
  }
}

function coordPriorityToTaskPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "normal";
}

async function uploadStorageObject(supabaseUrl, serviceRoleKey, bucket, storagePath, bytes, contentType) {
  const response = await fetch(`${trimUrl(supabaseUrl)}/storage/v1/object/${bucket}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": contentType,
      "x-upsert": "false"
    },
    body: bytes
  });

  const text = await response.text();
  if (!response.ok && response.status !== 409) {
    const data = parseJson(text);
    throw httpError(response.status, data?.message || data?.error || text || response.statusText);
  }
}

function parseDataUrlBytes(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

function buildPublicStorageUrl(supabaseUrl, bucket, storagePath) {
  if (!storagePath) return "";
  return `${trimUrl(supabaseUrl)}/storage/v1/object/public/${bucket}/${encodeStoragePath(storagePath)}`;
}

function encodeStoragePath(value) {
  return String(value || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toSafeStorageFileName(fileName) {
  const normalized = String(fileName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "pauta-anexo";
}

function fromPautaPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "media";
}

function toPautaPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "normal";
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

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
