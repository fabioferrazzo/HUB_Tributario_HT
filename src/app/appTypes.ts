export type PautaFilter = "todas" | "minhas" | "destaques" | "alta" | "atrasadas" | "semPrazo" | "concluidas";

export type TaskFilter = "todas" | "minhas" | "abertas" | "concluidas";

export type HealthStatusTone = "ok" | "warning" | "info";

export type ViewerPreviewMode = "image" | "iframe" | "unsupported";

export type ReportFormat = "pdf" | "excel";

export type ReportRow = Record<string, string | number>;

export type PdfReportLine = { bold?: boolean; size?: number; text: string };

export type PomodoroArchivedNote = {
  id: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type ViewerPreview = {
  mode: ViewerPreviewMode;
  src: string;
  title: string;
  detail?: string;
  notice?: string;
};

export type PdfTextSpan = {
  id: string;
  text: string;
};

export type PdfSearchPlan = {
  total: number;
  indexesBySpanId: Map<string, number>;
};

export type PdfGlobalSearchMatch = {
  globalIndex: number;
  page: number;
};

export type PdfTextRawItem = {
  dir?: string;
  hasEOL?: boolean;
  height?: number;
  str?: string;
  transform?: number[];
  width?: number;
};

export type PdfViewportLike = {
  height: number;
  scale: number;
  transform: number[];
  width: number;
};

export type PdfJsLike = {
  Util: {
    transform: (left: number[], right: number[]) => number[];
  };
};

export type HealthCheck = {
  area: string;
  status: string;
  detail: string;
  tone: HealthStatusTone;
};

export type CoordSyncHealth = {
  status: string;
  detail: string;
  tone: HealthStatusTone;
};

export type EmailQueuePreviewItem = {
  id: string;
  category?: string;
  targetType?: string;
  targetRef?: string;
  toEmail?: string;
  subject?: string;
  scheduledFor?: string;
};

export type EmailOperationResult = {
  id?: string;
  status?: string;
  error?: string;
};

export type EmailOperationResponse = {
  deliveryEnabled?: boolean;
  provider?: string;
  queuedPreview?: number;
  items?: EmailQueuePreviewItem[];
  queued?: number | string;
  processed?: number;
  results?: EmailOperationResult[];
  dryRun?: boolean;
  error?: string;
  ok?: boolean;
  category?: string;
};

export type HomologationStatus = "pendente" | "ok" | "ajustar" | "falhou";

export type HomologationItem = {
  id: string;
  title: string;
  detail: string;
};

export type HomologationBlock = {
  id: string;
  title: string;
  items: HomologationItem[];
};
