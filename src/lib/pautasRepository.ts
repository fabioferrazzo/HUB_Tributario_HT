import type { HubProfile, HubUser, Pauta, PautaAttachment, PautaCompletion, PautaTextSize } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

export type PautasSource = "local" | "supabase";

type PautaRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: string | null;
  status: string | null;
  scope: "todos" | "usuarios" | null;
  destaque: boolean | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type PautaUsuarioRow = {
  pauta_id: string;
  user_id: string | null;
  email: string;
  nome: string | null;
};

type PautaAnexoRow = {
  id: string;
  pauta_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string | null;
  size_bytes: number | null;
  uploaded_by: string | null;
  created_at: string;
};

type PautaConclusaoRow = {
  pauta_id: string;
  user_id: string | null;
  email: string;
  nome: string | null;
  completed_at: string;
};

type ProfileRow = Pick<HubProfile, "id" | "email" | "nome">;

const PAUTAS_STORAGE_KEY = "hub_pautas_app";
const STORAGE_BUCKET = "hub-anexos";
const PAUTA_STYLE_META_RE = /^<!--hub:pauta-style:([\s\S]*?)-->\s*/;

export function getPautasSource(user?: HubUser | null): PautasSource {
  return isSupabaseConfigured && Boolean(user?.id) ? "supabase" : "local";
}

export function canUserViewPautaApp(pauta: Pauta, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "gestor") return true;
  if (hasUserCompletedPauta(pauta, user)) return false;
  if ((pauta.createdBy || "").toLowerCase() === user.email.toLowerCase() || pauta.createdBy === user.id) return true;
  if ((pauta.scope || "todos") === "todos") return true;
  return (pauta.responsaveis || []).some((email) => email.toLowerCase() === user.email.toLowerCase());
}

export function canUserManagePautaApp(_pauta: Pauta, user?: HubUser | null) {
  return user?.role === "admin";
}

export function canUserCompletePautaApp(pauta: Pauta, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin") return true;
  return (pauta.responsaveis || []).some((email) => email.toLowerCase() === user.email.toLowerCase());
}

export function hasUserCompletedPauta(pauta: Pauta, user?: HubUser | null) {
  if (!user) return false;
  return (pauta.conclusoes || []).some((item) => item.email.toLowerCase() === user.email.toLowerCase() || item.userId === user.id);
}

export async function listAppPautas(user?: HubUser | null): Promise<Pauta[]> {
  if (getPautasSource(user) === "supabase") {
    return loadSupabasePautas(user);
  }

  return readStorage<Pauta[]>(PAUTAS_STORAGE_KEY, seedLocalPautas()).map(normalizePauta).filter((pauta) => canUserViewPautaApp(pauta, user));
}

export async function saveAppPauta({
  current,
  files = [],
  pauta,
  user
}: {
  current: Pauta[];
  files?: File[];
  pauta: Pauta;
  user: HubUser;
}) {
  if (getPautasSource(user) === "supabase") {
    const pautaId = await upsertSupabasePauta(pauta, user, {
      isExisting: current.some((item) => item.id === pauta.id)
    });

    for (const file of files) {
      await uploadSupabasePautaAnexo(pautaId, file);
    }

    notifyPautasChanged();
    return listAppPautas(user);
  }

  const next = [normalizePauta(pauta), ...current.filter((item) => item.id !== pauta.id)];
  writeStorage(PAUTAS_STORAGE_KEY, next);
  notifyPautasChanged();
  return next.filter((item) => canUserViewPautaApp(item, user));
}

export async function deleteAppPauta({
  current,
  pauta,
  user
}: {
  current: Pauta[];
  pauta: Pauta;
  user: HubUser;
}) {
  if (!canUserManagePautaApp(pauta, user)) {
    throw new Error("Apenas o administrador pode excluir pautas.");
  }

  if (getPautasSource(user) === "supabase") {
    await callPautasAdminFunction<{ ok: boolean; id: string }>({
      action: "delete",
      id: pauta.id
    });
    notifyPautasChanged();
    return listAppPautas(user);
  }

  const next = current.filter((item) => item.id !== pauta.id);
  writeStorage(PAUTAS_STORAGE_KEY, next);
  notifyPautasChanged();
  return next;
}

export async function completeAppPauta({
  current,
  pauta,
  user
}: {
  current: Pauta[];
  pauta: Pauta;
  user: HubUser;
}) {
  if (!canUserCompletePautaApp(pauta, user)) {
    throw new Error("Voce nao esta autorizado a concluir esta pauta.");
  }

  if (hasUserCompletedPauta(pauta, user)) {
    throw new Error("Esta pauta ja foi concluida por voce.");
  }

  const now = new Date().toISOString();

  if (getPautasSource(user) === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();
    const { error } = await client.from("pauta_conclusoes").insert({
      pauta_id: pauta.id,
      user_id: authUserId,
      email: user.email.toLowerCase(),
      nome: user.nome,
      completed_at: now
    });
    if (error) throw error;

    await client.rpc("notify_pauta_conclusion", {
      p_pauta_id: pauta.id,
      p_completed_by: authUserId
    });

    notifyPautasChanged();
    return listAppPautas(user);
  }

  const completion: PautaCompletion = {
    userId: user.id || user.email,
    email: user.email,
    nome: user.nome,
    completedAt: now
  };
  const next = current.map((item) =>
    item.id === pauta.id
      ? normalizePauta({
          ...item,
          conclusoes: [...(item.conclusoes || []), completion],
          concluidoEm: now,
          updatedAt: now
        })
      : item
  );
  writeStorage(PAUTAS_STORAGE_KEY, next);
  notifyPautasChanged();
  return next.filter((item) => canUserViewPautaApp(item, user));
}

async function loadSupabasePautas(user?: HubUser | null): Promise<Pauta[]> {
  const client = assertSupabase();
  const { data: pautaRows, error } = await client
    .from("pautas")
    .select("id,titulo,descricao,prazo,prioridade,status,scope,destaque,created_by,created_by_email,created_at,updated_at")
    .order("destaque", { ascending: false })
    .order("prazo", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!pautaRows?.length) return [];

  const ids = pautaRows.map((row) => row.id);
  const [{ data: usuarios, error: usuariosError }, { data: anexos, error: anexosError }, { data: conclusoes, error: conclusoesError }] =
    await Promise.all([
      client.from("pauta_usuarios").select("pauta_id,user_id,email,nome").in("pauta_id", ids),
      client.from("pauta_anexos").select("id,pauta_id,file_name,storage_path,mime_type,size_bytes,uploaded_by,created_at").in("pauta_id", ids),
      client.from("pauta_conclusoes").select("pauta_id,user_id,email,nome,completed_at").in("pauta_id", ids)
    ]);

  if (usuariosError) throw usuariosError;
  if (anexosError) throw anexosError;
  if (conclusoesError) throw conclusoesError;

  const mapped = (pautaRows as PautaRow[]).map((row) =>
    mapPautaRow(
      row,
      ((usuarios || []) as PautaUsuarioRow[]).filter((item) => item.pauta_id === row.id),
      ((anexos || []) as PautaAnexoRow[]).filter((item) => item.pauta_id === row.id),
      ((conclusoes || []) as PautaConclusaoRow[]).filter((item) => item.pauta_id === row.id)
    )
  );

  return mapped.filter((pauta) => canUserViewPautaApp(pauta, user));
}

async function upsertSupabasePauta(pauta: Pauta, user: HubUser, options: { isExisting: boolean }) {
  const authUserId = await getCurrentAuthUserId();
  const normalized = normalizePauta(pauta);
  const existingCreatedBy = options.isExisting && isUuid(normalized.createdBy || "") ? normalized.createdBy : authUserId;

  const result = await callPautasAdminFunction<{ id: string }>({
    action: "upsert",
    pauta: {
      id: normalized.id,
      titulo: normalized.tema,
      descricao: encodePautaDescricao(normalized),
      prazo: normalized.prazo || null,
      prioridade: normalized.prioridade || "normal",
      status: normalized.status || "aberta",
      scope: normalized.scope || "todos",
      destaque: Boolean(normalized.destaque),
      createdBy: existingCreatedBy,
      createdByEmail: options.isExisting ? normalized.email || user.email.toLowerCase() : user.email.toLowerCase(),
      responsaveis: normalized.responsaveis || []
    }
  });

  return result.id;
}

async function uploadSupabasePautaAnexo(pautaId: string, file: File) {
  const client = assertSupabase();
  const authUserId = await getCurrentAuthUserId();
  const storagePath = `pautas/${pautaId}/${crypto.randomUUID()}-${toSafeStorageFileName(file.name)}`;
  const { error: uploadError } = await client.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await client.from("pauta_anexos").insert({
    pauta_id: pautaId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: authUserId
  });
  if (metadataError) throw metadataError;
}

function mapPautaRow(row: PautaRow, usuarios: PautaUsuarioRow[], anexos: PautaAnexoRow[], conclusoes: PautaConclusaoRow[]): Pauta {
  const responsaveis = usuarios.map((item) => item.email).filter(Boolean);
  const firstResponsavel = usuarios.map((item) => item.nome || item.email).filter(Boolean).join(", ");
  const concludedDates = conclusoes.map((item) => item.completed_at).sort();
  const concludedAt = concludedDates[concludedDates.length - 1] || "";
  const descricao = decodePautaDescricao(row.descricao || "");

  return normalizePauta({
    id: row.id,
    tema: row.titulo,
    acoes: descricao.text,
    prazo: row.prazo || "",
    prioridade: row.prioridade || "normal",
    responsavel: (row.scope || "todos") === "todos" ? "Todos" : firstResponsavel,
    email: row.created_by_email || "",
    pendenciasObs: "",
    retorno: "",
    status: row.status || "aberta",
    periodicidade: "",
    modificadoEm: row.updated_at,
    concluidoEm: concludedAt,
    origem: "HUB Pautas",
    scope: row.scope || "todos",
    destaque: Boolean(row.destaque),
    textSize: descricao.textSize,
    textBold: descricao.textBold,
    textItalic: descricao.textItalic,
    textHighlight: descricao.textHighlight,
    responsaveis,
    anexos: anexos.map(mapPautaAnexoRow),
    conclusoes: conclusoes.map(mapPautaConclusaoRow),
    createdBy: row.created_by || row.created_by_email || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapPautaAnexoRow(row: PautaAnexoRow): PautaAttachment {
  const { data } = assertSupabase().storage.from(STORAGE_BUCKET).getPublicUrl(row.storage_path);
  return {
    id: row.id,
    name: row.file_name,
    storagePath: row.storage_path,
    url: data.publicUrl,
    mimeType: row.mime_type || "",
    sizeBytes: row.size_bytes || 0,
    uploadedBy: row.uploaded_by || "",
    createdAt: row.created_at
  };
}

function mapPautaConclusaoRow(row: PautaConclusaoRow): PautaCompletion {
  return {
    userId: row.user_id || "",
    email: row.email,
    nome: row.nome || row.email,
    completedAt: row.completed_at
  };
}

function normalizePauta(value: Partial<Pauta>): Pauta {
  const now = new Date().toISOString();
  const responsaveis = Array.isArray(value.responsaveis) ? value.responsaveis.filter(Boolean) : [];
  const scope = value.scope || (responsaveis.length ? "usuarios" : "todos");

  return {
    id: value.id || crypto.randomUUID(),
    tema: value.tema?.trim() || "Pauta sem titulo",
    acoes: value.acoes || "",
    prazo: value.prazo || "",
    prioridade: value.prioridade || "normal",
    responsavel: value.responsavel || (scope === "todos" ? "Todos" : responsaveis.join(", ")),
    email: value.email || "",
    pendenciasObs: value.pendenciasObs || "",
    retorno: value.retorno || "",
    status: value.status || "aberta",
    periodicidade: value.periodicidade || "",
    modificadoEm: value.modificadoEm || value.updatedAt || now,
    concluidoEm: value.concluidoEm || "",
    origem: value.origem || "HUB Pautas",
    scope,
    destaque: Boolean(value.destaque),
    textSize: normalizePautaTextSize(value.textSize),
    textBold: Boolean(value.textBold),
    textItalic: Boolean(value.textItalic),
    textHighlight: Boolean(value.textHighlight),
    responsaveis,
    anexos: Array.isArray(value.anexos) ? value.anexos : [],
    conclusoes: Array.isArray(value.conclusoes) ? value.conclusoes : [],
    createdBy: value.createdBy || value.email || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function encodePautaDescricao(pauta: Pauta) {
  const meta = {
    textSize: normalizePautaTextSize(pauta.textSize),
    textBold: Boolean(pauta.textBold),
    textItalic: Boolean(pauta.textItalic),
    textHighlight: Boolean(pauta.textHighlight)
  };

  return `<!--hub:pauta-style:${JSON.stringify(meta)}-->\n${pauta.acoes || ""}`;
}

function decodePautaDescricao(value: string): {
  text: string;
  textSize: PautaTextSize;
  textBold: boolean;
  textItalic: boolean;
  textHighlight: boolean;
} {
  const match = value.match(PAUTA_STYLE_META_RE);
  if (!match) {
    return {
      text: value,
      textSize: "normal",
      textBold: false,
      textItalic: false,
      textHighlight: false
    };
  }

  try {
    const meta = JSON.parse(match[1] || "{}") as Partial<Pick<Pauta, "textSize" | "textBold" | "textItalic" | "textHighlight">>;
    return {
      text: value.replace(PAUTA_STYLE_META_RE, ""),
      textSize: normalizePautaTextSize(meta.textSize),
      textBold: Boolean(meta.textBold),
      textItalic: Boolean(meta.textItalic),
      textHighlight: Boolean(meta.textHighlight)
    };
  } catch {
    return {
      text: value.replace(PAUTA_STYLE_META_RE, ""),
      textSize: "normal",
      textBold: false,
      textItalic: false,
      textHighlight: false
    };
  }
}

function normalizePautaTextSize(value?: string): PautaTextSize {
  if (value === "pequena" || value === "grande" || value === "muito-grande") return value;
  if (value === "muitoGrande") return "muito-grande";
  return "normal";
}

function seedLocalPautas(): Pauta[] {
  const now = new Date().toISOString();
  return [
    normalizePauta({
      id: "local-pauta-reuniao",
      tema: "Revisao de obrigacoes acessorias da semana",
      acoes: "Conferir pendencias, responsaveis e proximos prazos antes da reuniao.",
      prazo: now,
      prioridade: "alta",
      responsavel: "Equipe Fiscal",
      status: "aberta",
      origem: "Massa local",
      scope: "todos",
      destaque: true
    }),
    normalizePauta({
      id: "local-pauta-orientacoes",
      tema: "Consolidar orientacoes da coordenacao",
      acoes: "Atualizar orientacoes por responsavel.",
      prioridade: "normal",
      responsavel: "Todos",
      status: "aberta",
      origem: "Massa local",
      scope: "todos"
    })
  ];
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}

async function getCurrentAuthUserId() {
  const client = assertSupabase();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user?.id) {
    throw new Error("Sessao Supabase expirada. Entre novamente.");
  }

  return data.user.id;
}

async function getCurrentAccessToken() {
  const client = assertSupabase();
  const { data, error } = await client.auth.getSession();

  if (error || !data.session?.access_token) {
    throw new Error("Sessao Supabase expirada. Entre novamente.");
  }

  return data.session.access_token;
}

async function callPautasAdminFunction<T>(body: unknown): Promise<T> {
  const token = await getCurrentAccessToken();
  const response = await fetch("/.netlify/functions/pautas-admin", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`
    },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  let data: { error?: string; detail?: unknown } | null = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const detail =
      data?.detail && typeof data.detail === "object"
        ? ` (${Object.entries(data.detail as Record<string, unknown>)
            .map(([key, value]) => `${key}: ${String(value)}`)
            .join(", ")})`
        : "";
    throw new Error(`${data?.error || text || "Nao foi possivel gerenciar a pauta."}${detail}`);
  }

  return data as T;
}

async function getProfilesByEmail(emails: string[]) {
  const client = assertSupabase();
  const uniqueEmails = [...new Set(emails.map((email) => email.trim().toLowerCase()).filter(Boolean))];
  if (!uniqueEmails.length) return new Map<string, ProfileRow>();

  const { data, error } = await client.from("profiles").select("id,email,nome").in("email", uniqueEmails);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.email.toLowerCase(), profile as ProfileRow]));
}

function notifyPautasChanged() {
  window.dispatchEvent(new Event("hub:pautas"));
}

function toSafeStorageFileName(fileName: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "pauta-anexo";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
