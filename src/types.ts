export type UserRole = "admin" | "gestor" | "colaborador";

export type HubUser = {
  id?: string;
  email: string;
  nome: string;
  role: UserRole;
};

export type TeamMember = {
  nome: string;
  email: string;
  iniciais: string;
  role: UserRole;
};

export type HubProfile = TeamMember & {
  id?: string;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
};

export type PautaTextSize = "pequena" | "normal" | "grande" | "muito-grande";

export type Pauta = {
  id: string;
  tema: string;
  acoes: string;
  prazo: string;
  prioridade: string;
  responsavel: string;
  email: string;
  pendenciasObs: string;
  retorno: string;
  status: string;
  periodicidade: string;
  modificadoEm: string;
  concluidoEm: string;
  origem: string;
  scope?: "todos" | "usuarios";
  destaque?: boolean;
  textSize?: PautaTextSize;
  textBold?: boolean;
  textItalic?: boolean;
  textHighlight?: boolean;
  responsaveis?: string[];
  anexos?: PautaAttachment[];
  conclusoes?: PautaCompletion[];
  createdBy?: string;
  createdAt?: string;
  updatedAt?: string;
};

export type PautaAttachment = {
  id: string;
  name: string;
  storagePath: string;
  url: string;
  mimeType: string;
  sizeBytes: number;
  uploadedBy: string;
  createdAt: string;
};

export type PautaCompletion = {
  userId: string;
  email: string;
  nome: string;
  completedAt: string;
};

export type Lembrete = {
  id: string;
  titulo: string;
  descricao: string;
  prazo: string;
  prioridade: "alta" | "normal" | "baixa";
  status: "aberto" | "concluido" | "vencido";
  confidencial: boolean;
  responsaveis: string[];
  anexos: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type TaskPriority = "alta" | "normal" | "baixa";

export type TaskStatus = "aberta" | "concluida";

export type TaskItem = {
  id: string;
  titulo: string;
  descricao: string;
  prazo: string;
  prioridade: TaskPriority;
  status: TaskStatus;
  destaque?: boolean;
  origem?: "calendario" | "coord" | "manual";
  coordItemId?: string;
  responsaveis: string[];
  anexos: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  archivedAt?: string;
};

export type FileResourceCategory = "drive" | "modelo" | "guia" | "anexo" | "outro";

export type FileResourceScope = "privado" | "global";

export type FileFolder = {
  id: string;
  nome: string;
  descricao: string;
  scope: FileResourceScope;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FileResourceKind = "link" | "upload";

export type FileProcessingStatus = "none" | "pending" | "processing" | "ready" | "error";

export type FileResource = {
  id: string;
  titulo: string;
  descricao: string;
  url: string;
  categoria: FileResourceCategory;
  scope: FileResourceScope;
  folderId: string;
  kind: FileResourceKind;
  fileName: string;
  storagePath: string;
  mimeType: string;
  sizeBytes: number;
  processingStatus: FileProcessingStatus;
  processingMessage: string;
  processedUrl: string;
  processedFileName: string;
  processedStoragePath: string;
  processedMimeType: string;
  processedSizeBytes: number;
  processedAt: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type FileViewerNoteKind = "highlight" | "comment";

export type FileViewerNote = {
  id: string;
  resourceId: string;
  createdBy: string;
  userEmail: string;
  kind: FileViewerNoteKind;
  text: string;
  page: number;
  createdAt: string;
  updatedAt: string;
};

export type UsefulLink = {
  id: string;
  titulo: string;
  url: string;
  scope: FileResourceScope;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type Noticia = {
  id: string;
  titulo: string;
  fonte: string;
  url: string;
  data: string;
  tipo?: "noticia" | "legislacao";
  sourceType?: "oficial" | "especializada";
  sourceUrl?: string;
};

export type HubNotificationTone = "danger" | "warning" | "info";

export type HubNotification = {
  id: string;
  dedupeKey: string;
  tipo: string;
  title: string;
  detail: string;
  meta: string;
  tone: HubNotificationTone;
  route: HubRoute;
  targetType?: string;
  targetRef?: string;
  active: boolean;
  readAt?: string;
  createdAt: string;
  updatedAt?: string;
};

export type HubRoute =
  | "home"
  | "tarefas"
  | "lembretes"
  | "arquivos"
  | "agenda"
  | "pomodoro"
  | "links"
  | "coord"
  | "admin";
