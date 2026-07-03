import type { HubProfile, HubUser, QuadroAviso, QuadroAvisoKind, QuadroAvisoVisibility } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type AvisosSource = "local" | "supabase";

type QuadroAvisoRow = {
  id: string;
  cell: number | null;
  kind: QuadroAvisoKind | null;
  visibility: QuadroAvisoVisibility | null;
  title: string | null;
  content: string | null;
  color: string | null;
  file_name: string | null;
  file_url: string | null;
  created_by: string | null;
  created_by_email: string | null;
  created_at: string;
  updated_at: string;
};

type QuadroAvisoUsuarioRow = {
  aviso_id: string;
  user_id: string | null;
  email: string;
  nome: string | null;
};

type ProfileRow = Pick<HubProfile, "id" | "email" | "nome">;
type QuadroAvisoInput = Omit<QuadroAviso, "id" | "createdBy" | "createdByEmail" | "createdAt" | "updatedAt"> &
  Partial<Pick<QuadroAviso, "id">>;

const QUADRO_AVISOS_STORAGE_KEY = "hub_quadro_avisos_app";

function normalizeEmail(email?: string) {
  return (email || "").trim().toLowerCase();
}

function uniqueEmails(emails: string[]) {
  return Array.from(new Set(emails.map(normalizeEmail).filter(Boolean)));
}

function getAvisosSource(user?: HubUser | null): AvisosSource {
  return user && isSupabaseConfigured ? "supabase" : "local";
}

function sanitizeAvisoFileName(fileName: string) {
  return (
    fileName
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 140) || "arquivo"
  );
}

export async function uploadQuadroAvisoFile(
  file: File,
  user: HubUser
): Promise<{ fileName: string; fileUrl: string }> {
  if (getAvisosSource(user) !== "supabase" || !supabase) {
    return { fileName: file.name, fileUrl: URL.createObjectURL(file) };
  }

  const safeName = sanitizeAvisoFileName(file.name);
  const owner = user.id || user.email || "usuario";
  const path = `quadro-avisos/${owner}/${Date.now()}-${crypto.randomUUID()}-${safeName}`;

  const { error } = await supabase.storage.from("hub-anexos").upload(path, file, {
    contentType: file.type || undefined,
    upsert: false
  });

  if (error) throw error;

  const { data } = supabase.storage.from("hub-anexos").getPublicUrl(path);
  return { fileName: file.name, fileUrl: data.publicUrl };
}

function canUserViewAviso(aviso: QuadroAviso, user?: HubUser | null) {
  if (aviso.visibility === "geral") return true;
  const userEmail = normalizeEmail(user?.email);
  if (!userEmail) return false;
  return aviso.createdBy === user?.id || normalizeEmail(aviso.createdByEmail) === userEmail || aviso.selectedUsers.includes(userEmail);
}

function notifyQuadroAvisosChanged() {
  window.dispatchEvent(new Event("hub:quadro-avisos"));
}

function normalizeAviso(row: QuadroAvisoRow, usuarios: QuadroAvisoUsuarioRow[] = []): QuadroAviso {
  const selectedUsers = usuarios
    .filter((usuario) => usuario.aviso_id === row.id)
    .map((usuario) => normalizeEmail(usuario.email))
    .filter(Boolean);

  return {
    id: row.id,
    cell: row.cell || 1,
    kind: row.kind || "texto",
    visibility: row.visibility || "geral",
    title: row.title || "Aviso",
    content: row.content || "",
    color: row.color || "#ffffff",
    fileName: row.file_name || undefined,
    fileUrl: row.file_url || undefined,
    selectedUsers: uniqueEmails(selectedUsers),
    createdBy: row.created_by || "",
    createdByEmail: normalizeEmail(row.created_by_email || ""),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function loadSupabaseAvisos(user?: HubUser | null): Promise<QuadroAviso[]> {
  const client = supabase;
  if (!client) return [];

  const { data, error } = await client
    .from("quadro_avisos")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) throw error;

  const rows = (data || []) as QuadroAvisoRow[];
  const ids = rows.map((row) => row.id);
  let usuarios: QuadroAvisoUsuarioRow[] = [];

  if (ids.length) {
    const { data: selectedRows, error: selectedError } = await client
      .from("quadro_aviso_usuarios")
      .select("aviso_id,user_id,email,nome")
      .in("aviso_id", ids);

    if (selectedError) throw selectedError;
    usuarios = (selectedRows || []) as QuadroAvisoUsuarioRow[];
  }

  return rows.map((row) => normalizeAviso(row, usuarios)).filter((aviso) => canUserViewAviso(aviso, user));
}

async function resolveSelectedProfiles(emails: string[]) {
  const client = supabase;
  const normalized = uniqueEmails(emails);
  if (!client || normalized.length === 0) return new Map<string, ProfileRow>();

  const { data, error } = await client
    .from("profiles")
    .select("id,email,nome")
    .in("email", normalized);

  if (error) throw error;

  return new Map(
    ((data || []) as ProfileRow[]).map((profile) => [normalizeEmail(profile.email), profile])
  );
}

async function upsertSupabaseAviso(
  aviso: QuadroAvisoInput,
  user: HubUser
) {
  const client = supabase;
  if (!client) return;

  const payload: Record<string, unknown> = {
    cell: aviso.cell,
    kind: aviso.kind,
    visibility: aviso.visibility,
    title: aviso.title,
    content: aviso.content,
    color: aviso.color,
    file_name: aviso.fileName || null,
    file_url: aviso.fileUrl || null,
    created_by: user.id || null,
    created_by_email: normalizeEmail(user.email)
  };

  if (aviso.id) payload.id = aviso.id;

  const { data, error } = await client
    .from("quadro_avisos")
    .upsert(payload)
    .select("id")
    .single();

  if (error) throw error;

  const avisoId = data?.id as string;
  if (!avisoId) return;

  const { error: deleteError } = await client
    .from("quadro_aviso_usuarios")
    .delete()
    .eq("aviso_id", avisoId);

  if (deleteError) throw deleteError;

  const selectedUsers = aviso.visibility === "particular" ? uniqueEmails(aviso.selectedUsers) : [];
  if (selectedUsers.length === 0) return;

  const profilesByEmail = await resolveSelectedProfiles(selectedUsers);
  const selectedPayload = selectedUsers.map((email) => {
    const profile = profilesByEmail.get(email);
    return {
      aviso_id: avisoId,
      user_id: profile?.id || null,
      email,
      nome: profile?.nome || email
    };
  });

  const { error: insertError } = await client
    .from("quadro_aviso_usuarios")
    .insert(selectedPayload);

  if (insertError) throw insertError;
}

export async function listQuadroAvisos(user?: HubUser | null): Promise<QuadroAviso[]> {
  if (getAvisosSource(user) === "supabase") return loadSupabaseAvisos(user);

  const local = readStorage<QuadroAviso[]>(QUADRO_AVISOS_STORAGE_KEY, []);
  return local.filter((aviso) => canUserViewAviso(aviso, user));
}

export async function saveQuadroAviso({
  current,
  aviso,
  user
}: {
  current: QuadroAviso[];
  aviso: QuadroAvisoInput;
  user: HubUser;
}): Promise<QuadroAviso[]> {
  if (getAvisosSource(user) === "supabase") {
    await upsertSupabaseAviso(aviso, user);
    notifyQuadroAvisosChanged();
    return loadSupabaseAvisos(user);
  }

  const now = new Date().toISOString();
  const existing = aviso.id ? current.find((item) => item.id === aviso.id) : null;
  const saved: QuadroAviso = {
    id: existing?.id || aviso.id || crypto.randomUUID(),
    cell: aviso.cell,
    kind: aviso.kind,
    visibility: aviso.visibility,
    title: aviso.title,
    content: aviso.content,
    color: aviso.color,
    fileName: aviso.fileName,
    fileUrl: aviso.fileUrl,
    selectedUsers: aviso.visibility === "particular" ? uniqueEmails(aviso.selectedUsers) : [],
    createdBy: existing?.createdBy || user.id || user.email,
    createdByEmail: existing?.createdByEmail || normalizeEmail(user.email),
    createdAt: existing?.createdAt || now,
    updatedAt: now
  };

  const merged = [saved, ...current.filter((item) => item.id !== saved.id)];
  writeStorage(QUADRO_AVISOS_STORAGE_KEY, merged);
  notifyQuadroAvisosChanged();
  return merged.filter((item) => canUserViewAviso(item, user));
}
