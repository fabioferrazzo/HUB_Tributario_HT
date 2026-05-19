import type {
  FileFolder,
  FileProcessingStatus,
  FileResource,
  FileResourceCategory,
  FileResourceScope,
  FileViewerNote,
  FileViewerNoteKind,
  HubUser
} from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type ArquivosSource = "local" | "supabase";

type FolderRow = {
  id: string;
  nome: string;
  descricao: string | null;
  scope: FileResourceScope;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type ResourceRow = {
  id: string;
  titulo: string;
  descricao: string | null;
  url: string | null;
  categoria: FileResourceCategory;
  scope: FileResourceScope;
  folder_id: string | null;
  kind: "link" | "upload";
  file_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  processing_status: FileProcessingStatus | null;
  processing_message: string | null;
  processed_file_name: string | null;
  processed_storage_path: string | null;
  processed_mime_type: string | null;
  processed_size_bytes: number | null;
  processed_at: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type FileViewerNoteRow = {
  id: string;
  resource_id: string;
  created_by: string;
  kind: FileViewerNoteKind;
  text: string;
  page: number | null;
  created_at: string;
  updated_at: string;
};

const FOLDERS_STORAGE_KEY = "hub_file_folders";
const RESOURCES_STORAGE_KEY = "hub_file_resources";
const NOTES_STORAGE_KEY = "hub_file_viewer_notes";
const STORAGE_BUCKET = "hub-arquivos";
const RESOURCE_SELECT_WITH_PROCESSING =
  "id,titulo,descricao,url,categoria,scope,folder_id,kind,file_name,storage_path,mime_type,size_bytes,processing_status,processing_message,processed_file_name,processed_storage_path,processed_mime_type,processed_size_bytes,processed_at,created_by,created_at,updated_at";
const RESOURCE_SELECT_LEGACY =
  "id,titulo,descricao,url,categoria,scope,folder_id,kind,file_name,storage_path,mime_type,size_bytes,created_by,created_at,updated_at";

export function getArquivosSource(): ArquivosSource {
  return isSupabaseConfigured ? "supabase" : "local";
}

export async function listAppFileFolders(user: HubUser): Promise<FileFolder[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const { data, error } = await client
      .from("arquivo_pastas")
      .select("id,nome,descricao,scope,created_by,created_at,updated_at")
      .order("nome", { ascending: true });

    if (error) throw error;
    return (data || []).map(mapFolderRow);
  }

  return filterVisibleFolders(readStorage<FileFolder[]>(FOLDERS_STORAGE_KEY, []).map(normalizeFolder), user);
}

export async function saveAppFileFolder(folder: FileFolder, user: HubUser): Promise<FileFolder[]> {
  const normalized = normalizeFolder({
    ...folder,
    scope: user.role === "admin" ? folder.scope : "privado",
    createdBy: folder.createdBy || user.email
  });

  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();

    const { error } = await client.from("arquivo_pastas").upsert(
      {
        id: normalized.id,
        nome: normalized.nome,
        descricao: normalized.descricao,
        scope: normalized.scope,
        created_by: normalized.createdBy.includes("-") ? normalized.createdBy : authUserId
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    return listAppFileFolders(user);
  }

  const folders = readStorage<FileFolder[]>(FOLDERS_STORAGE_KEY, []).map(normalizeFolder);
  const next = [normalized, ...folders.filter((item) => item.id !== normalized.id)];
  writeStorage(FOLDERS_STORAGE_KEY, next);
  return filterVisibleFolders(next, user);
}

export async function deleteAppFileFolder(id: string, user: HubUser): Promise<FileFolder[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("arquivo_pastas").delete().eq("id", id);
    if (error) throw error;
    return listAppFileFolders(user);
  }

  const resources = readStorage<FileResource[]>(RESOURCES_STORAGE_KEY, []).map(normalizeResource);
  if (resources.some((resource) => resource.folderId === id)) {
    throw new Error("Remova ou mova os arquivos desta pasta antes de exclui-la.");
  }

  const next = readStorage<FileFolder[]>(FOLDERS_STORAGE_KEY, []).map(normalizeFolder).filter((folder) => folder.id !== id);
  writeStorage(FOLDERS_STORAGE_KEY, next);
  return filterVisibleFolders(next, user);
}

export async function listAppFileResources(user: HubUser): Promise<FileResource[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const result = await client.from("arquivo_recursos").select(RESOURCE_SELECT_WITH_PROCESSING).order("updated_at", { ascending: false });
    let data: unknown[] | null = result.data;
    let error = result.error;

    if (error && isMissingProcessingColumnsError(error)) {
      const legacy = await client.from("arquivo_recursos").select(RESOURCE_SELECT_LEGACY).order("updated_at", { ascending: false });
      data = legacy.data;
      error = legacy.error;
    }

    if (error) throw error;
    return Promise.all((data || []).map((row) => mapResourceRow(row as ResourceRow)));
  }

  return filterVisibleResources(readStorage<FileResource[]>(RESOURCES_STORAGE_KEY, []).map(normalizeResource), user);
}

export async function saveAppFileResource(resource: FileResource, user: HubUser, file?: File | null): Promise<FileResource[]> {
  const normalized = normalizeResource({
    ...resource,
    scope: user.role === "admin" ? resource.scope : "privado",
    createdBy: resource.createdBy || user.email
  });

  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();
    const uploadData = file ? await uploadFileResource(file, normalized.id) : null;

    const storagePath = uploadData?.storagePath || normalized.storagePath || null;
    const fileName = uploadData?.fileName || normalized.fileName || null;
    const mimeType = uploadData?.mimeType || normalized.mimeType || null;
    const sizeBytes = uploadData?.sizeBytes || normalized.sizeBytes || null;
    const processingStatus = uploadData
      ? getInitialProcessingStatus(uploadData.fileName, uploadData.mimeType)
      : normalized.processingStatus;

    const payload = {
        id: normalized.id,
        titulo: normalized.titulo,
        descricao: normalized.descricao,
        url: uploadData ? "" : normalized.url,
        categoria: normalized.categoria,
        scope: normalized.scope,
        folder_id: normalized.folderId || null,
        kind: storagePath ? "upload" : "link",
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        size_bytes: sizeBytes,
        processing_status: processingStatus,
        processing_message: uploadData && processingStatus === "pending" ? "Aguardando conversao/OCR para versao pesquisavel." : normalized.processingMessage,
        processed_file_name: uploadData ? null : normalized.processedFileName || null,
        processed_storage_path: uploadData ? null : normalized.processedStoragePath || null,
        processed_mime_type: uploadData ? null : normalized.processedMimeType || null,
        processed_size_bytes: uploadData ? null : normalized.processedSizeBytes || null,
        processed_at: uploadData ? null : normalized.processedAt || null,
        created_by: normalized.createdBy.includes("-") ? normalized.createdBy : authUserId
      };
    let { error } = await client.from("arquivo_recursos").upsert(payload, { onConflict: "id" });

    if (error && isMissingProcessingColumnsError(error)) {
      const {
        processing_status,
        processing_message,
        processed_file_name,
        processed_storage_path,
        processed_mime_type,
        processed_size_bytes,
        processed_at,
        ...legacyPayload
      } = payload;
      void processing_status;
      void processing_message;
      void processed_file_name;
      void processed_storage_path;
      void processed_mime_type;
      void processed_size_bytes;
      void processed_at;
      const legacy = await client.from("arquivo_recursos").upsert(legacyPayload, { onConflict: "id" });
      error = legacy.error;
    }

    if (error) throw error;

    if (uploadData?.storagePath && normalized.storagePath && normalized.storagePath !== uploadData.storagePath) {
      await client.storage.from(STORAGE_BUCKET).remove([normalized.storagePath]);
    }
    if (uploadData?.storagePath && normalized.processedStoragePath) {
      await client.storage.from(STORAGE_BUCKET).remove([normalized.processedStoragePath]);
    }

    return listAppFileResources(user);
  }

  const localUrl = file ? URL.createObjectURL(file) : normalized.url;
  const localResource = normalizeResource({
    ...normalized,
    url: localUrl,
    kind: file ? "upload" : normalized.kind,
    fileName: file?.name || normalized.fileName,
    mimeType: file?.type || normalized.mimeType,
    sizeBytes: file?.size || normalized.sizeBytes,
    processingStatus: file ? getInitialProcessingStatus(file.name, file.type || "") : normalized.processingStatus,
    processingMessage: file && getInitialProcessingStatus(file.name, file.type || "") === "pending" ? "Aguardando conversao/OCR para versao pesquisavel." : normalized.processingMessage,
    updatedAt: new Date().toISOString()
  });
  const resources = readStorage<FileResource[]>(RESOURCES_STORAGE_KEY, []).map(normalizeResource);
  const next = [localResource, ...resources.filter((item) => item.id !== localResource.id)];
  writeStorage(RESOURCES_STORAGE_KEY, next);
  return filterVisibleResources(next, user);
}

export async function deleteAppFileResource(resource: FileResource, user: HubUser): Promise<FileResource[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("arquivo_recursos").delete().eq("id", resource.id);
    if (error) throw error;

    if (resource.storagePath) {
      await client.storage.from(STORAGE_BUCKET).remove([resource.storagePath]);
    }
    if (resource.processedStoragePath) {
      await client.storage.from(STORAGE_BUCKET).remove([resource.processedStoragePath]);
    }

    return listAppFileResources(user);
  }

  const next = readStorage<FileResource[]>(RESOURCES_STORAGE_KEY, [])
    .map(normalizeResource)
    .filter((item) => item.id !== resource.id);
  writeStorage(RESOURCES_STORAGE_KEY, next);
  return filterVisibleResources(next, user);
}

export async function listAppFileAnnotations(resourceId: string, user: HubUser): Promise<FileViewerNote[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const { data, error } = await client
      .from("arquivo_anotacoes")
      .select("id,resource_id,created_by,kind,text,page,created_at,updated_at")
      .eq("resource_id", resourceId)
      .order("created_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => mapViewerNoteRow(row as FileViewerNoteRow, user));
  }

  return readStorage<FileViewerNote[]>(NOTES_STORAGE_KEY, [])
    .map((note) => normalizeViewerNote(note, user))
    .filter((note) => note.resourceId === resourceId)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export async function saveAppFileAnnotation(note: FileViewerNote, user: HubUser): Promise<FileViewerNote[]> {
  const normalized = normalizeViewerNote(note, user);

  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();
    const { error } = await client.from("arquivo_anotacoes").insert({
      id: normalized.id,
      resource_id: normalized.resourceId,
      created_by: authUserId,
      kind: normalized.kind,
      text: normalized.text,
      page: normalized.page
    });

    if (error) throw error;
    return listAppFileAnnotations(normalized.resourceId, user);
  }

  const notes = readStorage<FileViewerNote[]>(NOTES_STORAGE_KEY, []).map((item) => normalizeViewerNote(item, user));
  const next = [normalized, ...notes.filter((item) => item.id !== normalized.id)];
  writeStorage(NOTES_STORAGE_KEY, next);
  return listAppFileAnnotations(normalized.resourceId, user);
}

export async function deleteAppFileAnnotation(note: FileViewerNote, user: HubUser): Promise<FileViewerNote[]> {
  if (getArquivosSource() === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("arquivo_anotacoes").delete().eq("id", note.id);
    if (error) throw error;
    return listAppFileAnnotations(note.resourceId, user);
  }

  const next = readStorage<FileViewerNote[]>(NOTES_STORAGE_KEY, [])
    .map((item) => normalizeViewerNote(item, user))
    .filter((item) => item.id !== note.id);
  writeStorage(NOTES_STORAGE_KEY, next);
  return listAppFileAnnotations(note.resourceId, user);
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

async function uploadFileResource(file: File, resourceId: string) {
  const client = assertSupabase();
  const storagePath = `${resourceId}/${crypto.randomUUID()}-${toSafeStorageFileName(file.name)}`;
  const { error } = await client.storage.from(STORAGE_BUCKET).upload(storagePath, file, {
    upsert: false,
    contentType: file.type || undefined
  });

  if (error) throw error;

  return {
    fileName: file.name,
    storagePath,
    mimeType: file.type || "",
    sizeBytes: file.size
  };
}

async function createSignedResourceUrl(path: string) {
  const client = assertSupabase();
  const { data, error } = await client.storage.from(STORAGE_BUCKET).createSignedUrl(path, 60 * 60);
  if (error) return "";
  return data.signedUrl;
}

function mapFolderRow(row: FolderRow): FileFolder {
  return normalizeFolder({
    id: row.id,
    nome: row.nome,
    descricao: row.descricao || "",
    scope: row.scope,
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

async function mapResourceRow(row: ResourceRow): Promise<FileResource> {
  const signedUrl = row.storage_path ? await createSignedResourceUrl(row.storage_path) : "";
  const processedSignedUrl = row.processed_storage_path ? await createSignedResourceUrl(row.processed_storage_path) : "";
  return normalizeResource({
    id: row.id,
    titulo: row.titulo,
    descricao: row.descricao || "",
    url: signedUrl || row.url || "",
    categoria: row.categoria,
    scope: row.scope,
    folderId: row.folder_id || "",
    kind: row.kind,
    fileName: row.file_name || "",
    storagePath: row.storage_path || "",
    mimeType: row.mime_type || "",
    sizeBytes: row.size_bytes || 0,
    processingStatus: row.processing_status || "none",
    processingMessage: row.processing_message || "",
    processedUrl: processedSignedUrl,
    processedFileName: row.processed_file_name || "",
    processedStoragePath: row.processed_storage_path || "",
    processedMimeType: row.processed_mime_type || "",
    processedSizeBytes: row.processed_size_bytes || 0,
    processedAt: row.processed_at || "",
    createdBy: row.created_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function mapViewerNoteRow(row: FileViewerNoteRow, user: HubUser): FileViewerNote {
  return normalizeViewerNote(
    {
      id: row.id,
      resourceId: row.resource_id,
      createdBy: row.created_by,
      userEmail: row.created_by === user.id ? user.email : row.created_by,
      kind: row.kind,
      text: row.text,
      page: row.page || 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at
    },
    user
  );
}

function normalizeFolder(value: Partial<FileFolder>): FileFolder {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    nome: value.nome?.trim() || "Nova pasta",
    descricao: value.descricao || "",
    scope: value.scope || "privado",
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function normalizeResource(value: Partial<FileResource>): FileResource {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    titulo: value.titulo?.trim() || value.fileName || "Arquivo sem titulo",
    descricao: value.descricao || "",
    url: value.url || "",
    categoria: value.categoria || "outro",
    scope: value.scope || "privado",
    folderId: value.folderId || "",
    kind: value.kind || (value.storagePath ? "upload" : "link"),
    fileName: value.fileName || "",
    storagePath: value.storagePath || "",
    mimeType: value.mimeType || "",
    sizeBytes: value.sizeBytes || 0,
    processingStatus: value.processingStatus || "none",
    processingMessage: value.processingMessage || "",
    processedUrl: value.processedUrl || "",
    processedFileName: value.processedFileName || "",
    processedStoragePath: value.processedStoragePath || "",
    processedMimeType: value.processedMimeType || "",
    processedSizeBytes: value.processedSizeBytes || 0,
    processedAt: value.processedAt || "",
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function normalizeViewerNote(value: Partial<FileViewerNote>, user: HubUser): FileViewerNote {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    resourceId: value.resourceId || "",
    createdBy: value.createdBy || user.id || user.email,
    userEmail: value.userEmail || user.email,
    kind: value.kind || "comment",
    text: value.text || "",
    page: Math.max(1, Number(value.page) || 1),
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || value.createdAt || now
  };
}

function filterVisibleFolders(folders: FileFolder[], user: HubUser) {
  return folders.filter((folder) => user.role === "admin" || folder.scope === "global" || folder.createdBy === user.email || folder.createdBy === user.id);
}

function filterVisibleResources(resources: FileResource[], user: HubUser) {
  return resources.filter(
    (resource) => user.role === "admin" || resource.scope === "global" || resource.createdBy === user.email || resource.createdBy === user.id
  );
}

function toSafeStorageFileName(fileName: string) {
  const normalized = fileName
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "arquivo";
}

function getInitialProcessingStatus(fileName: string, mimeType: string): FileProcessingStatus {
  const target = `${mimeType} ${fileName}`.toLowerCase();
  const needsStudyVersion =
    target.includes("pdf") ||
    target.includes("presentation") ||
    target.includes("powerpoint") ||
    target.includes("wordprocessingml.document") ||
    target.includes("spreadsheetml.sheet") ||
    target.includes("image/") ||
    /\.(pdf|pptx?|docx?|xlsx?|png|jpe?g|webp|tiff?|bmp)(\?|#|$)?$/i.test(fileName);

  return needsStudyVersion ? "pending" : "none";
}

function isMissingProcessingColumnsError(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  return /processing_status|processing_message|processed_file_name|processed_storage_path|processed_mime_type|processed_size_bytes|processed_at/i.test(
    message
  );
}
