import type { HubProfile, HubUser, TaskItem, TaskPriority, TaskStatus } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type TarefasSource = "calendario" | "local" | "supabase";

type TarefaRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  prazo: string | null;
  prioridade: TaskItem["prioridade"];
  status: TaskItem["status"];
  destaque: boolean | null;
  origem: TaskItem["origem"] | null;
  coord_item_id: string | null;
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

type CalendarAttachment = {
  name: string;
  type?: string;
  dataUrl?: string;
  size?: number;
};

type CalendarEvent = {
  id: string;
  title: string;
  date: string;
  description?: string;
  category?: string;
  attachments?: CalendarAttachment[];
  hub?: {
    createdBy?: string;
    responsaveis?: string[];
    status?: TaskStatus;
    prioridade?: TaskPriority;
    destaque?: boolean;
    origem?: TaskItem["origem"];
    coordItemId?: string;
    createdAt?: string;
    updatedAt?: string;
  };
};

const TASKS_STORAGE_KEY = "hub_tasks";
const CALENDAR_DB_NAME = "CalAppDB";
const CALENDAR_STORE_NAME = "events";
const STORAGE_BUCKET = "hub-anexos";
const SUPABASE_MIGRATION_KEY_PREFIX = "hub_tasks_supabase_migrated";

const useLocalTasksOnly = import.meta.env.VITE_TAREFAS_LOCAL_ONLY === "true";

export function getTarefasSource(user?: HubUser | null): TarefasSource {
  if (!useLocalTasksOnly && isSupabaseConfigured && Boolean(user?.id)) return "supabase";
  return canUseCalendarDb() ? "calendario" : "local";
}

export function canUserViewTask(task: TaskItem, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "gestor") return true;
  if (!task.createdBy && !task.responsaveis.length) return true;
  if (isTaskOwner(task, user)) return true;
  return isTaskResponsible(task, user);
}

export function canUserManageTask(task: TaskItem, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin" || user.role === "gestor") return true;
  return isTaskOwner(task, user);
}

export async function listAppTasks(user: HubUser): Promise<TaskItem[]> {
  const source = getTarefasSource(user);
  if (source === "supabase") {
    await migrateCalendarTasksToSupabaseOnce(user);
    const tasks = await loadSupabaseTasks();
    await syncTasksToCalendar(tasks);
    return tasks;
  }
  if (source === "calendario") return loadCalendarTasks(user);

  return filterVisibleTasks(readStorage<TaskItem[]>(TASKS_STORAGE_KEY, []).map(normalizeTask), user);
}

export async function saveCalendarEventTask(event: unknown, user: HubUser): Promise<TaskItem[]> {
  const source = getTarefasSource(user);
  const calendarEvent = normalizeCalendarEvent(event, user);

  if (source === "supabase") {
    const existingTasks = await loadSupabaseTasks();
    const existing = existingTasks.find((task) => task.id === calendarEvent.id);
    if (existing && !canUserManageTask(existing, user)) {
      throw new Error("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode altera-la.");
    }

    await putCalendarEvent(calendarEvent);
    await upsertSupabaseTask(calendarEventToTask(calendarEvent), user, {
      isExisting: Boolean(existing)
    });
    notifyTasksChanged();
    return listAppTasks(user);
  }

  return listAppTasks(user);
}

export async function deleteCalendarEventTask(id: string, user: HubUser): Promise<TaskItem[]> {
  const source = getTarefasSource(user);

  if (source === "supabase" && isUuid(id)) {
    const existingTasks = await loadSupabaseTasks();
    const existing = existingTasks.find((task) => task.id === id);
    if (existing && !canUserManageTask(existing, user)) {
      throw new Error("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode exclui-la.");
    }

    const client = assertSupabase();
    const { error } = await client.from("tarefas").delete().eq("id", id);
    if (error) throw error;
    notifyTasksChanged();
  }

  return listAppTasks(user);
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
  const source = getTarefasSource(user);
  const existingTask = current.find((item) => item.id === task.id);

  if (existingTask && !canUserManageTask(existingTask, user)) {
    throw new Error("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode altera-la.");
  }

  if (source === "supabase") {
    const taskId = await upsertSupabaseTask(task, user, {
      isExisting: Boolean(existingTask)
    });

    for (const file of files) {
      await uploadSupabaseTaskAttachment(taskId, file);
    }

    notifyTasksChanged();
    return listAppTasks(user);
  }

  if (source === "calendario") {
    const events = await readCalendarEvents();
    const existing = events.find((event) => event.id === task.id);
    if (existing && !canUserManageTask(calendarEventToTask(existing), user)) {
      throw new Error("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode altera-la.");
    }

    await putCalendarEvent(await taskToCalendarEvent(task, existing, files));
    notifyTasksChanged();
    return listAppTasks(user);
  }

  const localTask = normalizeTask({
    ...task,
    anexos: files.length ? files.map((file) => file.name) : task.anexos,
    updatedAt: new Date().toISOString()
  });
  const next = [localTask, ...current.filter((item) => item.id !== localTask.id)];
  writeStorage(TASKS_STORAGE_KEY, next);
  notifyTasksChanged();
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
  const source = getTarefasSource(user);

  if (!canUserManageTask(task, user)) {
    throw new Error("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode exclui-la.");
  }

  if (source === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("tarefas").delete().eq("id", task.id);
    if (error) throw error;
    notifyTasksChanged();
    return listAppTasks(user);
  }

  if (source === "calendario") {
    await deleteCalendarEvent(task.id);
    notifyTasksChanged();
    return listAppTasks(user);
  }

  const next = current.filter((item) => item.id !== task.id);
  writeStorage(TASKS_STORAGE_KEY, next);
  notifyTasksChanged();
  return filterVisibleTasks(next, user);
}

async function loadCalendarTasks(user: HubUser) {
  const events = await readCalendarEvents();
  return filterVisibleTasks(events.map(calendarEventToTask), user);
}

async function syncTasksToCalendar(tasks: TaskItem[]) {
  if (!canUseCalendarDb()) return;

  const events = await readCalendarEvents();
  const taskIds = new Set(tasks.map((task) => task.id));
  const eventById = new Map(events.map((event) => [event.id, event]));

  for (const event of events) {
    if (!taskIds.has(event.id)) {
      await deleteCalendarEvent(event.id);
    }
  }

  for (const task of tasks) {
    await putCalendarEvent(await taskToCalendarEvent(task, eventById.get(task.id), []));
  }
}

async function migrateCalendarTasksToSupabaseOnce(user: HubUser) {
  if (!canUseCalendarDb()) return;
  if (user.role !== "admin" && user.role !== "gestor") return;

  const migrationKey = `${SUPABASE_MIGRATION_KEY_PREFIX}:${user.id || user.email}`;
  if (readBrowserFlag(migrationKey)) return;

  const calendarTasks = (await readCalendarEvents()).map(calendarEventToTask);
  if (!calendarTasks.length) {
    writeBrowserFlag(migrationKey);
    return;
  }

  const existingTasks = await loadSupabaseTasks();
  const existingIds = new Set(existingTasks.map((task) => task.id));
  const tasksToMigrate = calendarTasks.filter((task) => !existingIds.has(task.id));

  for (const task of tasksToMigrate) {
    await upsertSupabaseTask(
      {
        ...task,
        createdBy: user.id || user.email,
        updatedAt: new Date().toISOString()
      },
      user,
      { isExisting: false }
    );
  }

  writeBrowserFlag(migrationKey);
}

function normalizeCalendarEvent(value: unknown, user: HubUser): CalendarEvent {
  const event = (value && typeof value === "object" ? value : {}) as Partial<CalendarEvent>;
  const now = new Date().toISOString();
  const id = isUuid(event.id || "") ? event.id || crypto.randomUUID() : crypto.randomUUID();

  return {
    id,
    title: String(event.title || "Tarefa sem titulo").trim(),
    date: event.date || now,
    description: event.description || "",
    category: event.category || "work",
    attachments: Array.isArray(event.attachments) ? event.attachments : [],
    hub: {
      ...(event.hub || {}),
      createdBy: event.hub?.createdBy || user.id || user.email,
      responsaveis: Array.isArray(event.hub?.responsaveis) ? event.hub?.responsaveis : [],
      status: event.hub?.status || "aberta",
      prioridade: event.hub?.prioridade || categoryToPriority(event.category),
      destaque: event.hub?.destaque === true,
      origem: event.hub?.origem || "calendario",
      coordItemId: event.hub?.coordItemId || "",
      createdAt: event.hub?.createdAt || now,
      updatedAt: now
    }
  };
}

function calendarEventToTask(event: CalendarEvent): TaskItem {
  const hub = event.hub || {};
  const createdAt = hub.createdAt || event.date || new Date().toISOString();

  return normalizeTask({
    id: event.id,
    titulo: event.title,
    descricao: event.description || "",
    prazo: event.date || "",
    prioridade: hub.prioridade || categoryToPriority(event.category),
    status: hub.status || "aberta",
    destaque: hub.destaque === true,
    origem: hub.origem || "calendario",
    coordItemId: hub.coordItemId || "",
    responsaveis: Array.isArray(hub.responsaveis) ? hub.responsaveis : [],
    anexos: (event.attachments || []).map((attachment) => attachment.name),
    createdBy: hub.createdBy || "",
    createdAt,
    updatedAt: hub.updatedAt || createdAt
  });
}

async function taskToCalendarEvent(
  task: TaskItem,
  existing: CalendarEvent | undefined,
  files: File[] = []
): Promise<CalendarEvent> {
  return {
    ...(existing || {}),
    id: task.id,
    title: task.titulo,
    date: task.prazo,
    description: task.descricao,
    category: priorityToCategory(task.prioridade, existing?.category),
    attachments: await mergeCalendarAttachments(task, existing, files),
    hub: {
      ...(existing?.hub || {}),
      createdBy: task.createdBy,
      responsaveis: task.responsaveis,
      status: task.status,
      prioridade: task.prioridade,
      destaque: task.destaque === true,
      origem: task.origem || "calendario",
      coordItemId: task.coordItemId || "",
      createdAt: task.createdAt,
      updatedAt: task.updatedAt
    }
  };
}

async function mergeCalendarAttachments(task: TaskItem, existing: CalendarEvent | undefined, files: File[]) {
  const currentAttachments = existing?.attachments || [];
  const selectedNames = new Set(task.anexos);
  const preserved = selectedNames.size
    ? currentAttachments.filter((attachment) => selectedNames.has(attachment.name))
    : currentAttachments;
  const uploaded = await Promise.all(files.map(fileToCalendarAttachment));
  return [...preserved, ...uploaded];
}

function fileToCalendarAttachment(file: File): Promise<CalendarAttachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error("Nao foi possivel ler o anexo."));
    reader.onload = () =>
      resolve({
        name: file.name,
        type: file.type,
        dataUrl: String(reader.result || ""),
        size: file.size
      });
    reader.readAsDataURL(file);
  });
}

function categoryToPriority(category?: string): TaskPriority {
  if (category === "important") return "alta";
  if (category === "other") return "baixa";
  return "normal";
}

function priorityToCategory(priority: TaskPriority, existingCategory?: string) {
  if (priority === "alta") return "important";
  if (priority === "baixa") return "other";
  return existingCategory || "work";
}

function canUseCalendarDb() {
  return typeof indexedDB !== "undefined";
}

function openCalendarDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!canUseCalendarDb()) {
      reject(new Error("IndexedDB indisponivel neste navegador."));
      return;
    }

    const request = indexedDB.open(CALENDAR_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(CALENDAR_STORE_NAME)) {
        db.createObjectStore(CALENDAR_STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Nao foi possivel abrir o calendario."));
  });
}

async function readCalendarEvents(): Promise<CalendarEvent[]> {
  const db = await openCalendarDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CALENDAR_STORE_NAME, "readonly");
    const request = transaction.objectStore(CALENDAR_STORE_NAME).getAll();

    request.onsuccess = () => resolve((request.result || []) as CalendarEvent[]);
    request.onerror = () => reject(request.error || new Error("Nao foi possivel carregar as tarefas."));
    transaction.oncomplete = () => db.close();
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Nao foi possivel carregar as tarefas."));
    };
  });
}

async function putCalendarEvent(event: CalendarEvent): Promise<void> {
  const db = await openCalendarDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CALENDAR_STORE_NAME, "readwrite");
    transaction.objectStore(CALENDAR_STORE_NAME).put(event);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Nao foi possivel salvar a tarefa."));
    };
  });
}

async function deleteCalendarEvent(id: string): Promise<void> {
  const db = await openCalendarDb();

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(CALENDAR_STORE_NAME, "readwrite");
    transaction.objectStore(CALENDAR_STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      db.close();
      resolve();
    };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error("Nao foi possivel excluir a tarefa."));
    };
  });
}

async function loadSupabaseTasks(): Promise<TaskItem[]> {
  const client = assertSupabase();
  const { data: tasks, error } = await client
    .from("tarefas")
    .select("id,titulo,descricao,prazo,prioridade,status,destaque,origem,coord_item_id,created_by,created_at,updated_at")
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
      destaque: row.destaque === true,
      origem: row.origem || "calendario",
      coordItemId: row.coord_item_id || "",
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
  void user;
  void options;

  const client = assertSupabase();
  const payload = {
    p_id: isUuid(task.id) ? task.id : null,
    p_titulo: task.titulo,
    p_descricao: task.descricao,
    p_prazo: task.prazo || null,
    p_prioridade: task.prioridade,
    p_status: task.status,
    p_destaque: task.destaque === true,
    p_origem: task.origem || "calendario",
    p_coord_item_id: task.coordItemId || null
  };

  const { data, error } = await client.rpc("save_tarefa_v2", {
    ...payload,
    p_responsaveis: task.responsaveis.map(normalizeIdentity).filter(Boolean)
  });

  if (error && !isMissingRpcError(error)) throw error;

  if (error) {
    const responsavelIds = await resolveResponsavelIds(task.responsaveis);
    const fallback = await client.rpc("save_tarefa", {
      ...payload,
      p_responsaveis: responsavelIds
    });
    if (fallback.error) throw fallback.error;

    const taskId = typeof fallback.data === "string" && fallback.data ? fallback.data : task.id;
    if (!taskId) throw new Error("Nao foi possivel identificar a tarefa salva.");
    return taskId;
  }

  if (error) throw error;

  const taskId = typeof data === "string" && data ? data : task.id;
  if (!taskId) throw new Error("Nao foi possivel identificar a tarefa salva.");
  return taskId;
}

async function resolveResponsavelIds(responsaveis: string[]) {
  const profilesByIdentity = await getProfilesByIdentity(responsaveis);
  return responsaveis
    .map((identity) => profilesByIdentity.get(normalizeIdentity(identity))?.id)
    .filter((id): id is string => Boolean(id))
    .filter((id, index, ids) => ids.indexOf(id) === index);
}

function isMissingRpcError(error: { code?: string; message?: string }) {
  const message = error.message || "";
  return error.code === "PGRST202" || message.includes("save_tarefa_v2") || message.includes("Could not find the function");
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

async function getProfilesByIdentity(identities: string[]) {
  const client = assertSupabase();
  const uniqueIdentities = [...new Set(identities.map(normalizeIdentity).filter(Boolean))];
  if (!uniqueIdentities.length) return new Map<string, ProfileRow>();

  const emails = uniqueIdentities.filter((identity) => identity.includes("@"));
  const ids = uniqueIdentities.filter(isUuid);
  const rows: ProfileRow[] = [];

  if (emails.length) {
    const { data, error } = await client.from("profiles").select("id,email").in("email", emails);
    if (error) throw error;
    rows.push(...((data || []) as ProfileRow[]));
  }

  if (ids.length) {
    const { data, error } = await client.from("profiles").select("id,email").in("id", ids);
    if (error) throw error;
    rows.push(...((data || []) as ProfileRow[]));
  }

  const profilesByIdentity = new Map<string, ProfileRow>();
  rows.forEach((profile) => {
    if (profile.id) profilesByIdentity.set(normalizeIdentity(profile.id), profile);
    if (profile.email) profilesByIdentity.set(normalizeIdentity(profile.email), profile);
  });

  return profilesByIdentity;
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
    destaque: value.destaque === true,
    origem: value.origem || "calendario",
    coordItemId: value.coordItemId || "",
    responsaveis: Array.isArray(value.responsaveis) ? value.responsaveis : [],
    anexos: Array.isArray(value.anexos) ? value.anexos : [],
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function filterVisibleTasks(tasks: TaskItem[], user: HubUser) {
  return tasks
    .filter((task) => canUserViewTask(task, user))
    .sort((a, b) => (a.prazo || "9999").localeCompare(b.prazo || "9999"));
}

function isTaskOwner(task: TaskItem, user: HubUser) {
  return getUserIdentityTokens(user).some((token) => token && normalizeIdentity(task.createdBy) === token);
}

function isTaskResponsible(task: TaskItem, user: HubUser) {
  const userTokens = getUserIdentityTokens(user);
  const responsaveis = task.responsaveis.map(normalizeIdentity);

  return userTokens.some((token) => {
    if (!token) return false;
    return responsaveis.some((responsavel) => responsavel === token);
  });
}

function getUserIdentityTokens(user: HubUser) {
  return [user.id, user.email, user.nome].filter(Boolean).map((value) => normalizeIdentity(value));
}

function normalizeIdentity(value?: string) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function notifyTasksChanged() {
  window.dispatchEvent(new CustomEvent("hub:tasks"));
}

function readBrowserFlag(key: string) {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(key) === "true";
  } catch {
    return false;
  }
}

function writeBrowserFlag(key: string) {
  try {
    if (typeof localStorage !== "undefined") localStorage.setItem(key, "true");
  } catch {
    // Sem localStorage, apenas pula a marcacao; o app continua funcionando.
  }
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
