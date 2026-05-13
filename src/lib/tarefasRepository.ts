import type { HubProfile, HubUser, TaskItem } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type TarefasSource = "local" | "supabase";

type TarefaRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: TaskItem["prioridade"];
  status: TaskItem["status"];
  created_by: string;
  created_at: string;
  updated_at: string;
};

type TarefaUsuarioRow = {
  tarefa_id: string;
  user_id: string;
};

type TarefaAnexoRow = {
  tarefa_id: string;
  file_name: string;
};

type ProfileRow = Pick<HubProfile, "id" | "email">;

const TASKS_STORAGE_KEY = "hub_tasks";
const STORAGE_BUCKET = "hub-anexos";

export function getTarefasSource(user?: HubUser | null): TarefasSource {
  return isSupabaseConfigured && Boolean(user?.id) ? "supabase" : "local";
}

export function canUserViewTask(task: TaskItem, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "gestor") return true;
  if (isTaskOwner(task, user)) return true;
  return task.responsaveis.some((responsavel) => responsavel.toLowerCase() === user.email.toLowerCase());
}

export function canUserManageTask(task: TaskItem, user?: HubUser | null) {
  if (!user) return false;
  return user.role === "admin" || user.role === "gestor" || isTaskOwner(task, user);
}

export async function listAppTasks(user: HubUser): Promise<TaskItem[]> {
  if (getTarefasSource(user) === "supabase") {
    return loadSupabaseTasks();
  }

  return filterVisibleTasks(readStorage<TaskItem[]>(TASKS_STORAGE_KEY, []).map(normalizeTask), user);
}

export async function saveAppTask({
  current,
  files = [],
  task,
  user
}: {
  current: TaskItem[];
  files?: File[];
  task: TaskItem;
  user: HubUser;
}): Promise<TaskItem[]> {
  if (getTarefasSource(user) === "supabase") {
    await upsertSupabaseTask(task, user, {
      isExisting: current.some((item) => item.id === task.id)
    });

    for (const file of files) {
      await uploadSupabaseTaskAttachment(task.id, file);
    }

    return listAppTasks(user);
  }

  const localTask = normalizeTask({
    ...task,
    anexos: files.length ? files.map((file) => file.name) : task.anexos,
    updatedAt: new Date().toISOString()
  });
  const next = [localTask, ...current.filter((item) => item.id !== localTask.id)];
  writeStorage(TASKS_STORAGE_KEY, next);
  return filterVisibleTasks(next, user);
}

export async function deleteAppTask({
  current,
  task,
  user
}: {
  current: TaskItem[];
  task: TaskItem;
  user: HubUser;
}): Promise<TaskItem[]> {
  if (getTarefasSource(user) === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("tarefas").delete().eq("id", task.id);
    if (error) throw error;
    return listAppTasks(user);
  }

  const next = current.filter((item) => item.id !== task.id);
  writeStorage(TASKS_STORAGE_KEY, next);
  return filterVisibleTasks(next, user);
}

async function loadSupabaseTasks(): Promise<TaskItem[]> {
  const client = assertSupabase();
  const { data: tasks, error } = await client
    .from("tarefas")
    .select("id,titulo,descricao,prazo,prioridade,status,created_by,created_at,updated_at")
    .order("prazo", { ascending: true, nullsFirst: false });

  if (error) throw error;
  if (!tasks?.length) return [];

  const ids = tasks.map((task) => task.id);
  const { data: usuarios, error: usuariosError } = await client
    .from("tarefa_usuarios")
    .select("tarefa_id,user_id")
    .in("tarefa_id", ids);
  if (usuariosError) throw usuariosError;

  const { data: anexos, error: anexosError } = await client
    .from("tarefa_anexos")
    .select("tarefa_id,file_name")
    .in("tarefa_id", ids);
  if (anexosError) throw anexosError;

  const emailByProfileId = await getEmailsByProfileId((usuarios || []).map((usuario) => usuario.user_id));

  return (tasks as TarefaRow[]).map((row) =>
    normalizeTask({
      id: row.id,
      titulo: row.titulo,
      descricao: row.descricao || "",
      prazo: row.prazo || "",
      prioridade: row.prioridade,
      status: row.status,
      responsaveis: ((usuarios || []) as TarefaUsuarioRow[])
        .filter((usuario) => usuario.tarefa_id === row.id)
        .map((usuario) => emailByProfileId.get(usuario.user_id) || usuario.user_id),
      anexos: ((anexos || []) as TarefaAnexoRow[])
        .filter((anexo) => anexo.tarefa_id === row.id)
        .map((anexo) => anexo.file_name),
      createdBy: row.created_by,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    })
  );
}

async function upsertSupabaseTask(task: TaskItem, user: HubUser, options: { isExisting?: boolean }) {
  const client = assertSupabase();
  const authUserId = await getCurrentAuthUserId();
  const createdBy = task.createdBy && task.createdBy.includes("-") ? task.createdBy : authUserId;

  const { data, error } = await client
    .from("tarefas")
    .upsert(
      {
        id: task.id,
        titulo: task.titulo,
        descricao: task.descricao,
        prazo: task.prazo || null,
        prioridade: task.prioridade,
        status: task.status,
        created_by: options.isExisting ? createdBy : authUserId
      },
      { onConflict: "id" }
    )
    .select("id")
    .single();

  if (error) throw error;

  const taskId = data.id as string;
  const profilesByEmail = await getProfilesByEmail(task.responsaveis);
  await client.from("tarefa_usuarios").delete().eq("tarefa_id", taskId);

  const userLinks = task.responsaveis
    .map((email) => profilesByEmail.get(email)?.id)
    .filter((id): id is string => Boolean(id))
    .map((userId) => ({ tarefa_id: taskId, user_id: userId }));

  if (userLinks.length) {
    const { error: linksError } = await client.from("tarefa_usuarios").insert(userLinks);
    if (linksError) throw linksError;
  }
}

async function uploadSupabaseTaskAttachment(taskId: string, file: File) {
  const client = assertSupabase();
  const authUserId = await getCurrentAuthUserId();
  const storagePath = `tarefas/${taskId}/${crypto.randomUUID()}-${toSafeStorageFileName(file.name)}`;
  const { error: uploadError } = await client.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });
  if (uploadError) throw uploadError;

  const { error: metadataError } = await client.from("tarefa_anexos").insert({
    tarefa_id: taskId,
    file_name: file.name,
    storage_path: storagePath,
    mime_type: file.type || null,
    size_bytes: file.size,
    uploaded_by: authUserId
  });
  if (metadataError) throw metadataError;
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

async function getProfilesByEmail(emails: string[]) {
  const client = assertSupabase();
  const uniqueEmails = [...new Set(emails.filter(Boolean))];
  if (!uniqueEmails.length) return new Map<string, ProfileRow>();

  const { data, error } = await client.from("profiles").select("id,email").in("email", uniqueEmails);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.email, profile as ProfileRow]));
}

async function getEmailsByProfileId(ids: string[]) {
  const client = assertSupabase();
  const uniqueIds = [...new Set(ids.filter(Boolean))];
  if (!uniqueIds.length) return new Map<string, string>();

  const { data, error } = await client.from("profiles").select("id,email").in("id", uniqueIds);
  if (error) throw error;

  return new Map((data || []).map((profile) => [profile.id, profile.email]));
}

function normalizeTask(value: Partial<TaskItem>): TaskItem {
  const now = new Date().toISOString();

  return {
    id: value.id || crypto.randomUUID(),
    titulo: value.titulo?.trim() || "Tarefa sem titulo",
    descricao: value.descricao || "",
    prazo: value.prazo || "",
    prioridade: value.prioridade || "normal",
    status: value.status || "aberta",
    responsaveis: Array.isArray(value.responsaveis) ? value.responsaveis : [],
    anexos: Array.isArray(value.anexos) ? value.anexos : [],
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function filterVisibleTasks(tasks: TaskItem[], user: HubUser) {
  return tasks.filter((task) => canUserViewTask(task, user));
}

function isTaskOwner(task: TaskItem, user: HubUser) {
  return task.createdBy === user.id || task.createdBy === user.email;
}

function toSafeStorageFileName(fileName: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "tarefa-anexo";
}
