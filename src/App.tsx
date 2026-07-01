import {
  Bell,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Edit3,
  FileArchive,
  Filter,
  Highlighter,
  Home,
  Link2,
  ListChecks,
  LogOut,
  Menu,
  Newspaper,
  Paperclip,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  Tag,
  Timer,
  Trash2,
  UserRoundCog,
  UserRound,
  X
} from "lucide-react";
import pdfWorkerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { CSSProperties, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { teamMembers } from "./data/hubData";
import {
  deleteAppFileAnnotation,
  deleteAppFileFolder,
  deleteAppFileResource,
  getArquivosSource,
  listAppFileAnnotations,
  listAppFileFolders,
  listAppFileResources,
  saveAppFileAnnotation,
  saveAppFileFolder,
  saveAppFileResource
} from "./lib/arquivosRepository";
import { getStoredSession, getSupabaseAccessToken, signIn, signOut } from "./lib/auth";
import {
  canUserManageLembrete,
  deleteAppLembrete,
  getLembretesSource,
  listAppLembretes,
  saveAppLembrete
} from "./lib/lembretesRepository";
import { deleteAppLink, getLinksSource, listAppLinks, saveAppLink } from "./lib/linksRepository";
import { markAllAppNotificationsRead, markAppNotificationRead, syncAppNotifications } from "./lib/notificationsRepository";
import {
  canUserCompletePautaApp,
  canUserManagePautaApp,
  canUserViewPautaApp,
  completeAppPauta,
  deleteAppPauta,
  getPautasSource,
  hasUserCompletedPauta,
  listAppPautas,
  saveAppPauta
} from "./lib/pautasRepository";
import {
  canUserManageTask,
  deleteAppTask,
  deleteCalendarEventTask,
  getTarefasSource,
  listAppTasks,
  saveAppTask,
  saveCalendarEventTask
} from "./lib/tarefasRepository";
import { listAppUpdates } from "./lib/updatesRepository";
import { getUsersSource, listAppUsers, resetAppUserPassword, saveAppUserWithOptions, setAppUserActive } from "./lib/usersRepository";
import { configuredSupabaseHost } from "./lib/supabase";
import type {
  FileFolder,
  FileResource,
  FileResourceCategory,
  FileResourceScope,
  FileViewerNote,
  FileViewerNoteKind,
  HubProfile,
  HubNotification,
  HubRoute,
  HubUser,
  Lembrete,
  Noticia,
  Pauta,
  TaskItem,
  UsefulLink,
  UserRole
} from "./types";

type PautaFilter = "todas" | "minhas" | "destaques" | "alta" | "atrasadas" | "semPrazo" | "concluidas";
type TaskFilter = "todas" | "minhas" | "abertas" | "concluidas";
type HealthStatusTone = "ok" | "warning" | "info";
type ViewerPreviewMode = "image" | "iframe" | "unsupported";
type ReportFormat = "pdf" | "excel";
type ReportRow = Record<string, string | number>;
type PdfReportLine = { bold?: boolean; size?: number; text: string };
type PomodoroArchivedNote = {
  id: string;
  title: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

type ViewerPreview = {
  mode: ViewerPreviewMode;
  src: string;
  title: string;
  detail?: string;
  notice?: string;
};

type PdfTextSpan = {
  id: string;
  text: string;
};

type PdfSearchPlan = {
  total: number;
  indexesBySpanId: Map<string, number>;
};

type PdfGlobalSearchMatch = {
  globalIndex: number;
  page: number;
};

type PdfTextRawItem = {
  dir?: string;
  hasEOL?: boolean;
  height?: number;
  str?: string;
  transform?: number[];
  width?: number;
};

type PdfViewportLike = {
  height: number;
  scale: number;
  transform: number[];
  width: number;
};

type PdfJsLike = {
  Util: {
    transform: (left: number[], right: number[]) => number[];
  };
};

type HealthCheck = {
  area: string;
  status: string;
  detail: string;
  tone: HealthStatusTone;
};

type CoordSyncHealth = {
  status: string;
  detail: string;
  tone: HealthStatusTone;
};

type EmailQueuePreviewItem = {
  id: string;
  category?: string;
  targetType?: string;
  targetRef?: string;
  toEmail?: string;
  subject?: string;
  scheduledFor?: string;
};

type EmailOperationResult = {
  id?: string;
  status?: string;
  error?: string;
};

type EmailOperationResponse = {
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

type HomologationStatus = "pendente" | "ok" | "ajustar" | "falhou";

type HomologationItem = {
  id: string;
  title: string;
  detail: string;
};

type HomologationBlock = {
  id: string;
  title: string;
  items: HomologationItem[];
};

const HOMOLOGATION_STORAGE_KEY = "hub_homologation_status_v1";
const APP_RELEASE_LABEL = "2026-06-19-agenda-make-pomodoro";
const APP_RELEASE_DATE = "19/06/2026";
const HUB_SUPABASE_HOST = "kgorlrpparhcrprwamlc.supabase.co";

const dailyOperationalGuide = [
  {
    title: "Abrir Saude operacional",
    detail: "Conferir a etiqueta de versao, origens Supabase/local, Functions e avisos antes de mexer em dados reais."
  },
  {
    title: "Conferir sino e pendencias",
    detail: "Abrir notificacoes, revisar lembretes vencidos/proximos e pautas criticas do dia."
  },
  {
    title: "Rodar e-mails do dia",
    detail: "No console de Lembretes e e-mails, consultar fila, enfileirar vencimentos e processar pendentes quando necessario."
  },
  {
    title: "Conferir Agenda Tributaria",
    detail: "Abrir Agenda tributaria e confirmar se o mes atual foi carregado do cache compartilhado ou atualizado pela RFB."
  },
  {
    title: "Registrar homologacao",
    detail: "Usar o Checklist funcional para marcar OK/Ajustar/Falhou e copiar o resumo ao final da rodada."
  }
];

const weeklyOperationalGuide = [
  {
    title: "Revisar usuarios",
    detail: "Confirmar admins, gestores, colaboradores ativos e remover/desativar acessos que nao devem permanecer."
  },
  {
    title: "Revisar biblioteca",
    detail: "Organizar arquivos por pastas, excluir duplicados e deixar documentos importantes com comentario ou grifo."
  },
  {
    title: "Revisar Coordenacao",
    detail: "Atualizar colaboradores, atividades, pautas e usar os botoes manuais de e-mail quando a comunicacao estiver pronta."
  },
  {
    title: "Conferir Make da Agenda",
    detail: "Verificar se o cenario mensal esta ativo e chamando /api/agenda-tributaria com o AGENDA_SYNC_TOKEN."
  },
  {
    title: "Preflight antes de deploy",
    detail: "Rodar npm.cmd run preflight e npm.cmd run build localmente antes de liberar builds do Netlify."
  }
];

const homologationStatusLabels: Record<HomologationStatus, string> = {
  pendente: "Pendente",
  ok: "OK",
  ajustar: "Ajustar",
  falhou: "Falhou"
};

const homologationBlocks: HomologationBlock[] = [
  {
    id: "acesso",
    title: "Login e perfis",
    items: [
      { id: "login-admin", title: "Login admin", detail: "Admin entra, ve Configuracoes e Coordenacao." },
      { id: "login-colaborador", title: "Login colaborador", detail: "Colaborador entra e nao ve areas restritas." },
      { id: "logout", title: "Logout", detail: "Saida pelo menu lateral encerra a sessao." }
    ]
  },
  {
    id: "lembretes",
    title: "Lembretes",
    items: [
      { id: "lembrete-crud", title: "Criar/editar/concluir/excluir", detail: "Permissoes corretas para criador, marcado, gestor e admin." },
      { id: "lembrete-confidencial", title: "Confidencialidade", detail: "Sem marcados fica visivel so para criador/admin; com marcados inclui usuarios selecionados." },
      { id: "lembrete-anexo", title: "Anexos", detail: "Arquivo anexado salva e permanece acessivel." }
    ]
  },
  {
    id: "tarefas",
    title: "Tarefas",
    items: [
      { id: "tarefa-sidebar", title: "Sidebar", detail: "Cria tarefa com responsaveis e anexo." },
      { id: "tarefa-calendario", title: "Calendario original", detail: "Criacao no calendario aparece no painel lateral." },
      { id: "tarefa-acoes", title: "Acoes", detail: "Editar, concluir/reabrir e excluir respeitam permissao." }
    ]
  },
  {
    id: "arquivos",
    title: "Arquivos",
    items: [
      { id: "arquivo-biblioteca", title: "Biblioteca", detail: "Pastas, upload, edicao e exclusao controlada." },
      { id: "arquivo-visualizador", title: "Visualizador", detail: "Busca, zoom, grifo, comentarios e exportacao de notas." },
      { id: "arquivo-ocr", title: "OCR manual", detail: "Botao Rodar OCR aciona o agente local quando houver pendentes." }
    ]
  },
  {
    id: "comunicacao",
    title: "E-mails e notificacoes",
    items: [
      { id: "email-fila", title: "Fila email_outbox", detail: "Consultar, enfileirar vencimentos e processar fila." },
      { id: "email-manual", title: "Envio manual", detail: "Disparo pontual pelo console operacional." },
      { id: "notificacoes", title: "Sino", detail: "Contador, marcar lida e visibilidade por usuario." }
    ]
  },
  {
    id: "agenda-tributaria",
    title: "Agenda Tributaria",
    items: [
      { id: "agenda-cache", title: "Cache compartilhado", detail: "Mes abre com dados persistidos em agenda_tributaria_cache quando disponivel." },
      { id: "agenda-rfb", title: "Atualizacao RFB", detail: "Botao de atualizar busca RFB e preserva fallback local se a Function falhar." },
      { id: "agenda-make", title: "Make mensal", detail: "Cenario mensal chama /api/agenda-tributaria com AGENDA_SYNC_TOKEN configurado." }
    ]
  },
  {
    id: "pomodoro",
    title: "Pomodoro",
    items: [
      { id: "pomodoro-open", title: "App Pomodoro", detail: "Menu Pomodoro abre sem erro dentro do HUB." },
      { id: "pomodoro-notes", title: "Anotacoes", detail: "Sidebar de anotacoes abre, edita e salva o conteudo." },
      { id: "pomodoro-floating", title: "Janela flutuante", detail: "Anotacoes ficam flutuantes, opacas e acessiveis ao navegar por outros menus." },
      { id: "pomodoro-return", title: "Retorno ao painel", detail: "Fechar a janela flutuante recolhe para o Pomodoro preservando o texto salvo." }
    ]
  },
  {
    id: "coordenacao",
    title: "Coordenacao Tributaria",
    items: [
      { id: "coord-layout", title: "Layout simplificado", detail: "Busca, colaborador e acoes na mesma linha." },
      { id: "coord-pautas", title: "Pautas e lembretes", detail: "Criar pauta/lembrete com anexos e historico." },
      { id: "coord-email", title: "E-mails da Coordenacao", detail: "Enviar pauta e avaliacoes por comando manual." }
    ]
  },
  {
    id: "publicacao",
    title: "Pre-deploy",
    items: [
      { id: "supabase-check", title: "Supabase check", detail: "check_hub_status.sql retorna todos os itens como OK." },
      { id: "preflight", title: "Preflight local", detail: "npm.cmd run preflight aprovado antes do deploy de marco." },
      { id: "netlify-controlado", title: "Deploy controlado", detail: "Builds Netlify liberados somente para marco final." }
    ]
  }
];

const routes = [
  { id: "home", label: "Pautas", icon: ListChecks },
  { id: "tarefas", label: "Calendario de Tarefas", icon: CalendarDays },
  { id: "lembretes", label: "Lembretes", icon: Bell },
  { id: "arquivos", label: "Arquivos", icon: FileArchive },
  { id: "agenda", label: "Agenda tributaria", icon: ListChecks },
  { id: "pomodoro", label: "Pomodoro", icon: Timer },
  { id: "links", label: "Links uteis", icon: Link2 },
  { id: "coord", label: "Coordenacao", icon: UserRoundCog },
  { id: "admin", label: "Configuracoes", icon: Settings }
] satisfies Array<{ id: HubRoute; label: string; icon: typeof Home }>;

const routeGroups = [
  { label: "Principal", items: ["home"] },
  { label: "Ferramentas", items: ["tarefas", "arquivos", "agenda", "pomodoro", "links"] },
  { label: "Sistema", items: ["coord", "admin"] }
] satisfies Array<{ label: string; items: HubRoute[] }>;

const coordStandaloneVersion = "2026-07-01-coord-list-cards";

const appFrames: Record<"agenda" | "pomodoro" | "coord", { title: string; src: string }> = {
  agenda: { title: "Agenda tributaria", src: "/apps/agenda-tributaria.html" },
  pomodoro: { title: "Pomodoro Timer", src: "/apps/pomodoro.html" },
  coord: { title: "Coordenacao tributaria", src: `/apps/coord-tributaria.html?v=${coordStandaloneVersion}` }
};

const POMODORO_STORAGE_KEY = "pomo_complete_data_v7";
const POMODORO_ARCHIVE_STORAGE_KEY = "hub_pomodoro_notes_archive";

const roleOptions: Array<{ value: UserRole; label: string }> = [
  { value: "admin", label: "Administrador" },
  { value: "gestor", label: "Gestor" },
  { value: "colaborador", label: "Colaborador" }
];

const fileCategoryOptions: Array<{ value: FileResourceCategory | "todos"; label: string }> = [
  { value: "todos", label: "Todos" },
  { value: "drive", label: "Google Drive" },
  { value: "modelo", label: "Modelos" },
  { value: "guia", label: "Guias" },
  { value: "anexo", label: "Anexos" },
  { value: "outro", label: "Outros" }
];

export function App() {
  const [user, setUser] = useState<HubUser | null>(() => getStoredSession());
  const [route, setRoute] = useState<HubRoute>("home");
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  const [lembretesVersion, setLembretesVersion] = useState(0);
  const [pautasVersion, setPautasVersion] = useState(0);
  const [tasksVersion, setTasksVersion] = useState(0);
  const [usersVersion, setUsersVersion] = useState(0);
  const [hubUsers, setHubUsers] = useState<HubProfile[]>([]);
  const [notificationItems, setNotificationItems] = useState<HubNotification[]>([]);
  const [pomodoroNotesOpen, setPomodoroNotesOpen] = useState(false);
  const [pomodoroNotes, setPomodoroNotes] = useState("");
  const [pomodoroNotesStatus, setPomodoroNotesStatus] = useState("");
  const [pomodoroArchivedNotes, setPomodoroArchivedNotes] = useState<PomodoroArchivedNote[]>(() => readPomodoroArchivedNotes());

  useEffect(() => {
    function handleLembretesChange() {
      setLembretesVersion((version) => version + 1);
    }

    window.addEventListener("hub:lembretes", handleLembretesChange);
    return () => window.removeEventListener("hub:lembretes", handleLembretesChange);
  }, []);

  useEffect(() => {
    function handlePautasChange() {
      setPautasVersion((version) => version + 1);
    }

    window.addEventListener("hub:pautas", handlePautasChange);
    return () => window.removeEventListener("hub:pautas", handlePautasChange);
  }, []);

  useEffect(() => {
    function handleTasksChange() {
      setTasksVersion((version) => version + 1);
    }

    window.addEventListener("hub:tasks", handleTasksChange);
    return () => window.removeEventListener("hub:tasks", handleTasksChange);
  }, []);

  useEffect(() => {
    function handleUsersChange() {
      setUsersVersion((version) => version + 1);
    }

    window.addEventListener("hub:users", handleUsersChange);
    return () => window.removeEventListener("hub:users", handleUsersChange);
  }, []);

  useEffect(() => {
    function handlePomodoroMessage(event: MessageEvent) {
      if (event.origin !== window.location.origin) return;
      if (event.data?.type !== "hub:pomodoro-notes-float") return;

      const incomingNotes = typeof event.data.notes === "string" ? event.data.notes : readPomodoroNotes();
      setPomodoroNotes(incomingNotes);
      setPomodoroNotesStatus("");
      setPomodoroNotesOpen(true);
    }

    window.addEventListener("message", handlePomodoroMessage);
    return () => window.removeEventListener("message", handlePomodoroMessage);
  }, []);

  useEffect(() => {
    let active = true;

    if (!user) {
      setHubUsers([]);
      return;
    }

    listAppUsers()
      .then((users) => {
        if (active) setHubUsers(users);
      })
      .catch(() => {
        if (active) setHubUsers([]);
      });

    return () => {
      active = false;
    };
  }, [user, usersVersion]);

  useEffect(() => {
    let active = true;

    if (!user) {
      setNotificationItems([]);
      return;
    }

    Promise.all([listAppLembretes(user), listAppPautas(user), listAppTasks(user)])
      .then(([lembretes, pautas, tasks]) => {
        if (!active) return undefined;
        const visiblePautas = pautas.filter((pauta) => canUserViewPauta(pauta, user));
        return syncAppNotifications(user, buildSystemNotifications({ hubUsers, lembretes, pautas: visiblePautas, tasks, user }));
      })
      .then((notifications) => {
        if (active && notifications) setNotificationItems(notifications);
      })
      .catch(() => {
        if (active) setNotificationItems([]);
      });

    return () => {
      active = false;
    };
  }, [hubUsers, lembretesVersion, pautasVersion, tasksVersion, user]);

  if (!user) {
    return <LoginScreen onLogin={setUser} />;
  }

  const visibleRoutes = routes.filter((item) => {
    if (item.id === "admin") return user.role === "admin";
    if (item.id === "coord") return user.role !== "colaborador";
    return true;
  });

  function handleRoute(nextRoute: HubRoute) {
    setRoute(nextRoute);
    setMenuOpen(false);
  }

  function handleSignOut() {
    signOut();
    setUser(null);
    setRoute("home");
  }

  async function handleNotificationRead(notificationId: string) {
    if (!user) return;
    setNotificationItems((items) => items.filter((item) => item.id !== notificationId));
    await markAppNotificationRead(user, notificationId);
  }

  async function handleAllNotificationsRead() {
    if (!user) return;
    const ids = notificationItems.map((item) => item.id);
    setNotificationItems([]);
    await markAllAppNotificationsRead(user, ids);
  }

  function handlePomodoroNotesSave(nextNotes = pomodoroNotes) {
    savePomodoroNotes(nextNotes);
    setPomodoroNotes(nextNotes);
    setPomodoroNotesStatus("Anotacoes salvas.");
  }

  function handlePomodoroNotesClose(nextNotes = pomodoroNotes) {
    savePomodoroNotes(nextNotes);
    setPomodoroNotes(nextNotes);
    setPomodoroNotesOpen(false);
    setPomodoroNotesStatus("");
  }

  function handlePomodoroNotesChange(nextNotes: string) {
    setPomodoroNotes(nextNotes);
    savePomodoroNotes(nextNotes);
  }

  function handlePomodoroNoteArchive(nextNotes = pomodoroNotes) {
    const plainText = getPlainTextFromHtml(nextNotes);
    if (!plainText) {
      setPomodoroNotesStatus("Escreva uma anotacao antes de arquivar.");
      return;
    }

    const now = new Date().toISOString();
    const archivedNote: PomodoroArchivedNote = {
      id: crypto.randomUUID(),
      title: plainText.slice(0, 64),
      notes: nextNotes,
      createdAt: now,
      updatedAt: now
    };
    const nextArchive = [archivedNote, ...pomodoroArchivedNotes];
    setPomodoroArchivedNotes(nextArchive);
    savePomodoroArchivedNotes(nextArchive);
    setPomodoroNotesStatus("Anotacao arquivada.");
  }

  function handlePomodoroArchivedNoteOpen(note: PomodoroArchivedNote) {
    setPomodoroNotes(note.notes);
    savePomodoroNotes(note.notes);
    setPomodoroNotesStatus("Anotacao arquivada aberta para edicao.");
  }

  function handlePomodoroArchivedNoteSave(noteId: string, nextNotes = pomodoroNotes) {
    const plainText = getPlainTextFromHtml(nextNotes);
    const now = new Date().toISOString();
    const nextArchive = pomodoroArchivedNotes.map((note) =>
      note.id === noteId
        ? {
            ...note,
            title: plainText.slice(0, 64) || note.title,
            notes: nextNotes,
            updatedAt: now
          }
        : note
    );
    setPomodoroArchivedNotes(nextArchive);
    savePomodoroArchivedNotes(nextArchive);
    setPomodoroNotesStatus("Edicao do arquivo salva.");
  }

  function handlePomodoroArchivedNoteDelete(noteId: string) {
    const nextArchive = pomodoroArchivedNotes.filter((note) => note.id !== noteId);
    setPomodoroArchivedNotes(nextArchive);
    savePomodoroArchivedNotes(nextArchive);
    setPomodoroNotesStatus("Anotacao arquivada excluida.");
  }

  return (
    <div className={`app-shell ${menuCollapsed ? "app-shell--collapsed" : ""}`}>
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""} ${menuCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark">HT</div>
          <div className="brand-copy">
            <strong>HUB Depto Tributario</strong>
            <span>H. Teixeira</span>
          </div>
          <button
            className="sidebar-header-toggle"
            type="button"
            onClick={() => setMenuCollapsed((collapsed) => !collapsed)}
            title={menuCollapsed ? "Expandir menu" : "Recolher menu"}
            aria-label={menuCollapsed ? "Expandir menu" : "Recolher menu"}
          >
            {menuCollapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}
          </button>
        </div>

        <nav className="side-nav" aria-label="Navegacao principal">
          {routeGroups.map((group) => {
            const groupRoutes = group.items
              .map((id) => visibleRoutes.find((item) => item.id === id))
              .filter((item): item is (typeof visibleRoutes)[number] => Boolean(item));

            if (!groupRoutes.length) return null;

            return (
              <div className="side-nav-section" key={group.label}>
                <div className="side-nav-label">{group.label}</div>
                <div className="side-nav-group">
                  {groupRoutes.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className={route === item.id ? "active" : ""}
                        key={item.id}
                        type="button"
                        onClick={() => handleRoute(item.id)}
                        title={item.label}
                      >
                        <span className="side-nav-icon">
                          <Icon size={18} />
                        </span>
                        <span>{item.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        <button className="sign-out" type="button" onClick={handleSignOut}>
          <LogOut size={17} />
          <span>Sair</span>
        </button>
      </aside>

      <main className="workspace">
        <TopBar
          notificationItems={notificationItems}
          route={route}
          user={user}
          menuOpen={menuOpen}
          onMenu={() => setMenuOpen((open) => !open)}
          onNavigate={handleRoute}
          onNotificationRead={handleNotificationRead}
          onNotificationsReadAll={handleAllNotificationsRead}
        />
        <section className="workspace-body">{renderRoute(route, user, hubUsers, handleRoute)}</section>
      </main>
      <PomodoroFloatingNotes
        archivedNotes={pomodoroArchivedNotes}
        notes={pomodoroNotes}
        open={pomodoroNotesOpen}
        status={pomodoroNotesStatus}
        onArchive={handlePomodoroNoteArchive}
        onChange={handlePomodoroNotesChange}
        onClose={handlePomodoroNotesClose}
        onDeleteArchived={handlePomodoroArchivedNoteDelete}
        onOpenArchived={handlePomodoroArchivedNoteOpen}
        onSave={handlePomodoroNotesSave}
        onSaveArchived={handlePomodoroArchivedNoteSave}
      />
    </div>
  );
}

function PomodoroFloatingNotes({
  archivedNotes,
  notes,
  open,
  status,
  onArchive,
  onChange,
  onClose,
  onDeleteArchived,
  onOpenArchived,
  onSave,
  onSaveArchived
}: {
  archivedNotes: PomodoroArchivedNote[];
  notes: string;
  open: boolean;
  status: string;
  onArchive: (notes?: string) => void;
  onChange: (notes: string) => void;
  onClose: (notes?: string) => void;
  onDeleteArchived: (noteId: string) => void;
  onOpenArchived: (note: PomodoroArchivedNote) => void;
  onSave: (notes?: string) => void;
  onSaveArchived: (noteId: string, notes?: string) => void;
}) {
  const editorRef = useRef<HTMLDivElement | null>(null);
  const dragStartRef = useRef<{ pointerId: number; x: number; y: number; left: number; top: number } | null>(null);
  const draftRef = useRef(notes);
  const [minimized, setMinimized] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [activeArchiveId, setActiveArchiveId] = useState<string | null>(null);
  const [position, setPosition] = useState(() => ({ left: Math.max(16, window.innerWidth - 460), top: Math.max(16, window.innerHeight - 560) }));

  useEffect(() => {
    if (!open || !editorRef.current) return;
    if (notes !== draftRef.current && editorRef.current.innerHTML !== notes) {
      draftRef.current = notes;
      editorRef.current.innerHTML = notes;
    }
  }, [notes, open]);

  if (!open) return null;

  function startDrag(event: React.PointerEvent<HTMLElement>) {
    const target = event.target as HTMLElement;
    if (target.closest("button,input,select,textarea,[contenteditable='true']")) return;
    dragStartRef.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: position.left,
      top: position.top
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const width = minimized ? 280 : Math.min(420, window.innerWidth - 32);
    const height = minimized ? 58 : Math.min(520, window.innerHeight - 48);
    const nextLeft = Math.min(Math.max(8, drag.left + event.clientX - drag.x), Math.max(8, window.innerWidth - width - 8));
    const nextTop = Math.min(Math.max(8, drag.top + event.clientY - drag.y), Math.max(8, window.innerHeight - height - 8));
    setPosition({ left: nextLeft, top: nextTop });
  }

  function stopDrag(event: React.PointerEvent<HTMLElement>) {
    const drag = dragStartRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragStartRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function commitEditorDraft() {
    const nextNotes = editorRef.current ? editorRef.current.innerHTML : notes;
    draftRef.current = nextNotes;
    onChange(nextNotes);
    savePomodoroNotes(nextNotes);
    return nextNotes;
  }

  function runEditorCommand(command: string, value?: string) {
    editorRef.current?.focus();
    document.execCommand(command, false, value);
    commitEditorDraft();
  }

  function handleArchivedOpen(note: PomodoroArchivedNote) {
    setActiveArchiveId(note.id);
    setArchiveOpen(false);
    onOpenArchived(note);
  }

  return (
    <section
      className={`pomodoro-floating-notes ${minimized ? "pomodoro-floating-notes--minimized" : ""}`}
      style={{ left: position.left, top: position.top }}
      aria-label="Anotacoes flutuantes do Pomodoro"
    >
      <header
        className="pomodoro-floating-notes__header"
        onPointerDown={startDrag}
        onPointerMove={moveDrag}
        onPointerUp={stopDrag}
        onPointerCancel={stopDrag}
      >
        <div>
          <strong>Anotacoes</strong>
          <span>Pomodoro</span>
        </div>
        <div className="pomodoro-floating-notes__actions">
          {!minimized ? (
            <button type="button" onClick={() => setArchiveOpen((current) => !current)}>
              Arquivo
            </button>
          ) : null}
          {!minimized ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSave(nextNotes);
              }}
            >
              Salvar
            </button>
          ) : null}
          {!minimized ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onArchive(nextNotes);
              }}
            >
              Arquivar
            </button>
          ) : null}
          {!minimized && activeArchiveId ? (
            <button
              type="button"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSaveArchived(activeArchiveId, nextNotes);
              }}
            >
              Salvar edicao
            </button>
          ) : null}
          <button
              type="button"
              className="pomodoro-floating-notes__icon-action"
              aria-label={minimized ? "Restaurar anotacoes" : "Minimizar anotacoes"}
              title={minimized ? "Restaurar" : "Minimizar"}
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onSave(nextNotes);
                setMinimized((current) => !current);
            }}
          >
            {minimized ? "+" : "_"}
          </button>
          <button
              type="button"
              className="pomodoro-floating-notes__icon-action"
              aria-label="Fechar anotacoes"
              title="Fechar"
              onClick={() => {
                const nextNotes = commitEditorDraft();
                onClose(nextNotes);
              }}
            >
            <span aria-hidden="true">x</span>
          </button>
        </div>
      </header>
      <div className="pomodoro-floating-notes__body" aria-hidden={minimized}>
        <div className="pomodoro-floating-notes__toolbar" aria-label="Formatacao das anotacoes">
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("bold")}>
              B
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("italic")}>
              I
            </button>
            <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => runEditorCommand("strikeThrough")}>
              S
            </button>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => runEditorCommand("backColor", "#fff4a8")}
            >
              Grifo
            </button>
            <label>
              Cor
              <input
                aria-label="Cor do texto"
                type="color"
                defaultValue="#000000"
                onChange={(event) => runEditorCommand("foreColor", event.target.value)}
              />
            </label>
            <select aria-label="Tamanho da fonte" defaultValue="3" onChange={(event) => runEditorCommand("fontSize", event.target.value)}>
              <option value="2">Pequeno</option>
              <option value="3">Normal</option>
              <option value="4">Grande</option>
            </select>
        </div>
        {archiveOpen ? (
          <div className="pomodoro-floating-notes__archive">
            <strong>Arquivo de notas</strong>
            {archivedNotes.length ? (
              <div className="pomodoro-floating-notes__archive-list">
                {archivedNotes.map((note) => (
                  <article key={note.id}>
                    <div>
                      <strong>{note.title}</strong>
                      <span>{formatPomodoroArchiveDate(note.updatedAt)}</span>
                    </div>
                    <div>
                      <button type="button" onClick={() => handleArchivedOpen(note)}>
                        Abrir
                      </button>
                      <button type="button" onClick={() => onDeleteArchived(note.id)}>
                        Excluir
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            ) : (
              <p>Nenhuma anotacao arquivada.</p>
            )}
          </div>
        ) : null}
        <div
          className="pomodoro-floating-notes__editor"
          contentEditable
          ref={editorRef}
          suppressContentEditableWarning
          onInput={(event) => {
            const nextNotes = event.currentTarget.innerHTML;
            draftRef.current = nextNotes;
            onChange(nextNotes);
            savePomodoroNotes(nextNotes);
          }}
          onBlur={(event) => {
            const nextNotes = event.currentTarget.innerHTML;
            draftRef.current = nextNotes;
            onChange(nextNotes);
            savePomodoroNotes(nextNotes);
          }}
        />
        {status ? <div className="pomodoro-floating-notes__status">{status}</div> : null}
      </div>
    </section>
  );
}

function readPomodoroNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) || "{}") as { notes?: string };
    return parsed.notes || "";
  } catch {
    return "";
  }
}

function savePomodoroNotes(notes: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify({ ...parsed, notes }));
  } catch {
    localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify({ notes }));
  }
}

function readPomodoroArchivedNotes(): PomodoroArchivedNote[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_ARCHIVE_STORAGE_KEY) || "[]") as PomodoroArchivedNote[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((note) => note && typeof note.id === "string" && typeof note.notes === "string")
      .map((note) => ({
        id: note.id,
        title: note.title || getPlainTextFromHtml(note.notes).slice(0, 64) || "Anotacao",
        notes: note.notes,
        createdAt: note.createdAt || new Date().toISOString(),
        updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
      }));
  } catch {
    return [];
  }
}

function savePomodoroArchivedNotes(notes: PomodoroArchivedNote[]) {
  localStorage.setItem(POMODORO_ARCHIVE_STORAGE_KEY, JSON.stringify(notes));
}

function getPlainTextFromHtml(html: string) {
  if (!html) return "";
  const element = document.createElement("div");
  element.innerHTML = html;
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

function formatPomodoroArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}

function LoginScreen({ onLogin }: { onLogin: (user: HubUser) => void }) {
  const [email, setEmail] = useState(import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.hteixeira@gmail.com");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");

    try {
      const session = await signIn(email, password);
      onLogin(session);
    } catch (loginError) {
      setError(loginError instanceof Error ? loginError.message : "Falha ao entrar.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="login-page">
      <form className="login-panel" onSubmit={handleSubmit}>
        <div className="login-brand">
          <div className="brand-mark">HT</div>
          <div>
            <strong>HUB Depto Tributario</strong>
            <span>H. Teixeira</span>
          </div>
        </div>

        <label>
          E-mail
          <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
        </label>

        <label>
          Senha
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            required
          />
        </label>

        {error ? <p className="form-error">{error}</p> : null}

        <button className="primary-action" disabled={loading} type="submit">
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}

function TopBar({
  route,
  notificationItems,
  user,
  menuOpen,
  onMenu,
  onNavigate,
  onNotificationRead,
  onNotificationsReadAll
}: {
  route: HubRoute;
  notificationItems: HubNotification[];
  user: HubUser;
  menuOpen: boolean;
  onMenu: () => void;
  onNavigate: (route: HubRoute) => void;
  onNotificationRead: (notificationId: string) => void;
  onNotificationsReadAll: () => void;
}) {
  const label = routes.find((item) => item.id === route)?.label || "Inicio";
  const [notificationsOpen, setNotificationsOpen] = useState(false);
  const [notificationAction, setNotificationAction] = useState("");

  useEffect(() => {
    setNotificationsOpen(false);
  }, [route]);

  function exportNotificationsDocx() {
    const rows = notificationItems.length ? notificationItems.map(notificationToReportRow) : [{ Info: "Nenhuma notificacao pendente." }];
    downloadDocxReport("Notificacoes - HUB Depto Tributario", rows);
  }

  async function emailNotifications() {
    setNotificationAction("Enviando...");
    try {
      await sendNotificationsByEmail(user, notificationItems);
      setNotificationAction("E-mail enviado.");
      window.setTimeout(() => setNotificationAction(""), 2500);
    } catch (error) {
      setNotificationAction(getErrorMessage(error));
    }
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <button className="icon-button mobile-menu" type="button" onClick={onMenu} aria-label="Abrir menu">
          {menuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
        <h1>
          <span />
          {label}
        </h1>
      </div>
      <div className="topbar-brand-strip">
        <img src="/assets/logo-h-teixeira.jpeg" alt="H. Teixeira" />
        <span>{"Depto Tribut\u00e1rio"}</span>
      </div>
      <div className="topbar-actions">
        <div className="top-chip">
          <CalendarDays size={14} />
          <span>{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" })}</span>
        </div>
        <div className="top-chip">
          <Link2 size={14} />
          <span>
            Pautas HUB <strong>app</strong>
          </span>
        </div>
        <div className="notification-wrap">
          <button
            aria-controls="hub-notifications"
            aria-expanded={notificationsOpen}
            aria-label="Notificacoes"
            className={`notification-button ${notificationsOpen ? "active" : ""}`}
            type="button"
            onClick={() => setNotificationsOpen((open) => !open)}
          >
            <Bell size={18} />
            {notificationItems.length ? <span className="notification-badge">{notificationItems.length}</span> : null}
          </button>
          {notificationsOpen ? (
            <section className="notification-popover" id="hub-notifications" role="dialog" aria-label="Avisos ativos">
              <header>
                <div>
                  <strong>Notificacoes</strong>
                  <small>{notificationItems.length ? `${notificationItems.length} aviso(s) nao lido(s)` : "Sem avisos ativos"}</small>
                </div>
                <div className="notification-actions">
                  <button className="notification-read-all" type="button" onClick={exportNotificationsDocx}>
                    DOCX
                  </button>
                  <button className="notification-read-all" type="button" onClick={emailNotifications}>
                    E-mail
                  </button>
                  {notificationItems.length ? (
                    <button className="notification-read-all" type="button" onClick={onNotificationsReadAll}>
                      Marcar todas
                    </button>
                  ) : null}
                </div>
              </header>
              {notificationAction ? <p className="notification-action-status">{notificationAction}</p> : null}

              <div className="notification-list">
                {notificationItems.length ? (
                  notificationItems.map((item) => (
                    <div
                      className={`notification-item notification-item--${item.tone}`}
                      key={item.id}
                    >
                      <span className="notification-dot" />
                      <button
                        className="notification-link"
                        type="button"
                        onClick={() => {
                          onNotificationRead(item.id);
                          onNavigate(item.route);
                          setNotificationsOpen(false);
                        }}
                      >
                        <strong>{item.title}</strong>
                        <em>{item.detail}</em>
                        <small>{item.meta}</small>
                      </button>
                      <button
                        className="notification-read"
                        type="button"
                        onClick={() => onNotificationRead(item.id)}
                        aria-label={`Marcar ${item.title} como lida`}
                      >
                        Lida
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="notification-empty">
                    <CheckCircle2 size={18} />
                    <span>Nenhuma notificacao pendente.</span>
                  </div>
                )}
              </div>
            </section>
          ) : null}
        </div>
        <div className="user-chip">
          <strong>{getInitials(user.nome)}</strong>
        </div>
      </div>
    </header>
  );
}

function renderRoute(route: HubRoute, user: HubUser, hubUsers: HubProfile[], onNavigate: (route: HubRoute) => void) {
  if (route === "home") return <Dashboard hubUsers={hubUsers} user={user} />;
  if (route === "tarefas") return <TasksModule hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
  if (route === "lembretes") return <LembretesModule hubUsers={hubUsers} user={user} />;
  if (route === "arquivos") return <ArquivosModule user={user} />;
  if (route === "links") return <LinksModule user={user} />;
  if (route === "admin") return <AdminModule currentUser={user} />;
  if (route === "agenda" || route === "pomodoro" || route === "coord") {
    return <ModuleFrame title={appFrames[route].title} src={appFrames[route].src} />;
  }
  return <Dashboard hubUsers={hubUsers} user={user} />;
}

function Dashboard({
  hubUsers,
  user
}: {
  hubUsers: HubProfile[];
  user: HubUser;
}) {
  const [pautas, setPautas] = useState<Pauta[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [pautaQuery, setPautaQuery] = useState("");
  const [pautaFilter, setPautaFilter] = useState<PautaFilter>("todas");
  const [monthCursor, setMonthCursor] = useState(() => new Date());
  const [autoScroll, setAutoScroll] = useState(true);
  const pautaEditorRef = useRef<HTMLElement | null>(null);
  const pautasStackRef = useRef<HTMLDivElement | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [pautaTextSize, setPautaTextSize] = useState<NonNullable<Pauta["textSize"]>>("normal");
  const [pautaTextBold, setPautaTextBold] = useState(false);
  const [pautaTextItalic, setPautaTextItalic] = useState(false);
  const [pautaTextHighlight, setPautaTextHighlight] = useState(false);
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState("normal");
  const [status, setStatus] = useState("aberta");
  const [scope, setScope] = useState<"todos" | "usuarios">("todos");
  const [destaque, setDestaque] = useState(false);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [pautasEmailStatus, setPautasEmailStatus] = useState("");
  const [sendingPautasEmail, setSendingPautasEmail] = useState(false);
  const [pautasView, setPautasView] = useState<"lista" | "avisos">("lista");
  const [avisosView, setAvisosView] = useState<"geral" | "particular">("geral");
  const [avisosDrawMode, setAvisosDrawMode] = useState(false);
  const [selectedAvisoCell, setSelectedAvisoCell] = useState(1);
  const source = getPautasSource(user);

  useEffect(() => {
    let active = true;

    async function refreshPautas() {
      setLoading(true);
      setError("");
      try {
        const loaded = await listAppPautas(user);
        if (active) setPautas(loaded);
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }

    refreshPautas();
    window.addEventListener("hub:pautas", refreshPautas);

    return () => {
      active = false;
      window.removeEventListener("hub:pautas", refreshPautas);
    };
  }, [user]);

  const canManagePautas = user.role === "admin";
  const selectedYear = monthCursor.getFullYear();
  const selectedMonth = monthCursor.getMonth();
  const pautaDescriptionEditorRef = useRef<HTMLDivElement | null>(null);
  const pautaSelectionRef = useRef<Range | null>(null);

  const visiblePautas = useMemo(() => {
    const allowed = pautas.filter((pauta) => canUserViewPauta(pauta, user));
    return sortPautasForDashboard(allowed);
  }, [pautas, user]);

  const monthPautas = useMemo(() => {
    return visiblePautas.filter((pauta) => {
      if (!pauta.prazo?.trim()) return true;
      const date = parseBrazilianDate(pauta.prazo) || new Date(pauta.prazo);
      if (Number.isNaN(date.getTime())) return true;
      return date.getFullYear() === selectedYear && date.getMonth() === selectedMonth;
    });
  }, [selectedMonth, selectedYear, visiblePautas]);

  const filteredPautas = useMemo(() => {
    const query = normalizeForSearch(pautaQuery);
    return monthPautas.filter((pauta) => {
      if (pautaFilter === "minhas" && !isPautaAssignedToUser(pauta, user)) return false;
      if (pautaFilter === "destaques" && !pauta.destaque) return false;
      if (pautaFilter === "alta" && !isPautaAlta(pauta)) return false;
      if (pautaFilter === "atrasadas" && !isPautaAtrasada(pauta)) return false;
      if (pautaFilter === "semPrazo" && pauta.prazo.trim()) return false;
      if (pautaFilter === "concluidas" && !isPautaConcluida(pauta)) return false;

      if (!query) return true;

      return normalizeForSearch(
        [
          pauta.tema,
          pautaRichTextToPlain(pauta.acoes),
          pauta.responsavel,
          pauta.email,
          pauta.status,
          pauta.prioridade,
          pauta.pendenciasObs,
          pauta.retorno,
          formatResponsaveis(pauta.responsaveis || [], hubUsers)
        ].join(" ")
      ).includes(query);
    });
  }, [hubUsers, monthPautas, pautaFilter, pautaQuery, user]);
  const statusCounts = useMemo(() => countPautaStatus(monthPautas, user), [monthPautas, user]);
  const pautaStatusLabel = loading ? "Sincronizando" : `${source} - ${monthPautas.length} pauta(s)`;

  const shouldAutoScrollPautas = autoScroll && !loading && filteredPautas.length > 3;
  const pautasScrollStyle = shouldAutoScrollPautas
    ? ({ "--pautas-scroll-duration": `${Math.max(85, filteredPautas.length * 18)}s` } as CSSProperties)
    : undefined;

  useEffect(() => {
    const stack = pautasStackRef.current;
    if (!stack) return;
    stack.scrollTop = 0;
  }, [autoScroll, filteredPautas.length, pautaFilter, pautaQuery, selectedMonth, selectedYear]);

  useEffect(() => {
    const editor = pautaDescriptionEditorRef.current;
    if (!formOpen || !editor) return;
    editor.innerHTML = sanitizePautaRichHtml(descricao);
    pautaSelectionRef.current = null;
  }, [editingId, formOpen]);

  function rememberPautaSelection() {
    const editor = pautaDescriptionEditorRef.current;
    const selection = window.getSelection();
    if (!editor || !selection || selection.rangeCount === 0) return;
    const anchor = selection.anchorNode;
    const focus = selection.focusNode;
    if ((anchor && editor.contains(anchor)) || (focus && editor.contains(focus))) {
      pautaSelectionRef.current = selection.getRangeAt(0).cloneRange();
    }
  }

  function restorePautaSelection() {
    const editor = pautaDescriptionEditorRef.current;
    if (!editor) return false;
    editor.focus();
    const selection = window.getSelection();
    if (!selection) return false;

    selection.removeAllRanges();
    const savedRange = pautaSelectionRef.current;
    if (savedRange) {
      selection.addRange(savedRange);
      return true;
    }

    const range = document.createRange();
    range.selectNodeContents(editor);
    range.collapse(false);
    selection.addRange(range);
    pautaSelectionRef.current = range.cloneRange();
    return true;
  }

  function syncPautaDescriptionFromEditor() {
    const editor = pautaDescriptionEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizePautaRichHtml(editor.innerHTML);
    setDescricao(sanitized);
    rememberPautaSelection();
  }

  function normalizePautaEditorAfterCommand() {
    const editor = pautaDescriptionEditorRef.current;
    if (!editor) return;
    const sanitized = sanitizePautaRichHtml(editor.innerHTML);
    if (editor.innerHTML !== sanitized) {
      editor.innerHTML = sanitized;
    }
    setDescricao(sanitized);
    rememberPautaSelection();
  }

  function applyPautaTextSize(nextSize: NonNullable<Pauta["textSize"]>) {
    setPautaTextSize(nextSize);
    restorePautaSelection();
    document.execCommand("fontSize", false, getPautaExecFontSize(nextSize));
    normalizePautaEditorAfterCommand();
  }

  function applyPautaInlineCommand(command: "bold" | "italic") {
    restorePautaSelection();
    document.execCommand(command);
    normalizePautaEditorAfterCommand();
    if (command === "bold") setPautaTextBold(document.queryCommandState("bold"));
    if (command === "italic") setPautaTextItalic(document.queryCommandState("italic"));
  }

  function applyPautaHighlight() {
    restorePautaSelection();
    const applied = document.execCommand("hiliteColor", false, "#fff3a3");
    if (!applied) document.execCommand("backColor", false, "#fff3a3");
    setPautaTextHighlight(true);
    normalizePautaEditorAfterCommand();
  }

  function exportPautas(format: ReportFormat) {
    exportReport(format, "Pautas - HUB Depto Tributario", filteredPautas.map(pautaToReportRow));
  }

  async function sendPautasByEmail() {
    setSendingPautasEmail(true);
    setPautasEmailStatus("");
    setError("");

    try {
      const rows = filteredPautas.length ? filteredPautas.map(pautaToReportRow) : [{ Info: "Nenhuma pauta encontrada para o filtro atual." }];
      const body = rows
        .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join("\n"))
        .join("\n\n");
      const authToken = await getSupabaseAccessToken();
      const response = await fetch("/.netlify/functions/coord-email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          authToken,
          to: user.email,
          subject: "Pautas do HUB Depto Tributario",
          body,
          htmlBody: buildPautasEmailHtml(filteredPautas, hubUsers)
        })
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(data?.error || "Nao foi possivel enviar as pautas por e-mail.");
      }

      setPautasEmailStatus(`Pautas enviadas para ${user.email}.`);
    } catch (emailError) {
      setError(getErrorMessage(emailError));
    } finally {
      setSendingPautasEmail(false);
    }
  }

  function clearForm() {
    setEditingId(null);
    setTitulo("");
    setDescricao("");
    setPautaTextSize("normal");
    setPautaTextBold(false);
    setPautaTextItalic(false);
    setPautaTextHighlight(false);
    setPrazo("");
    setPrioridade("normal");
    setStatus("aberta");
    setScope("todos");
    setDestaque(false);
    setResponsaveis([]);
    setSelectedFiles([]);
  }

  function startNewPauta() {
    clearForm();
    setFormOpen(true);
    setError("");
    window.requestAnimationFrame(() => pautaEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  function startEditPauta(pauta: Pauta) {
    if (!canUserManagePautaApp(pauta, user)) {
      setError("Apenas o administrador pode editar pautas.");
      return;
    }

    setEditingId(pauta.id);
    setTitulo(pauta.tema);
    setDescricao(pauta.acoes || pauta.pendenciasObs || "");
    setPautaTextSize(pauta.textSize || "normal");
    setPautaTextBold(Boolean(pauta.textBold));
    setPautaTextItalic(Boolean(pauta.textItalic));
    setPautaTextHighlight(Boolean(pauta.textHighlight));
    setPrazo(toDatetimeLocalValue(pauta.prazo));
    setPrioridade(pauta.prioridade || "normal");
    setStatus(pauta.status || "aberta");
    setScope(pauta.scope || "todos");
    setDestaque(Boolean(pauta.destaque));
    setResponsaveis(pauta.responsaveis || []);
    setSelectedFiles([]);
    setFormOpen(true);
    setError("");
    window.requestAnimationFrame(() => pautaEditorRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  async function submitPauta(event: FormEvent) {
    event.preventDefault();
    if (!canManagePautas) return;
    if (!titulo.trim()) {
      setError("Informe o titulo da pauta.");
      return;
    }

    const richDescricao = sanitizePautaRichHtml(descricao);
    const now = new Date().toISOString();
    const existing = pautas.find((pauta) => pauta.id === editingId);
    const nextPauta: Pauta = {
      id: existing?.id || crypto.randomUUID(),
      tema: titulo.trim(),
      acoes: richDescricao,
      prazo,
      prioridade,
      responsavel: scope === "todos" ? "Todos" : formatResponsaveis(responsaveis, hubUsers),
      email: user.email,
      pendenciasObs: "",
      retorno: "",
      status,
      periodicidade: "",
      modificadoEm: now,
      concluidoEm: existing?.concluidoEm || "",
      origem: "HUB Pautas",
      scope,
      destaque,
      textSize: pautaTextSize,
      textBold: pautaTextBold,
      textItalic: pautaTextItalic,
      textHighlight: pautaTextHighlight,
      responsaveis: scope === "usuarios" ? responsaveis : [],
      anexos: existing?.anexos || [],
      conclusoes: existing?.conclusoes || [],
      createdBy: existing?.createdBy || user.id || user.email,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    setSaving(true);
    setError("");

    try {
      const saved = await saveAppPauta({ current: pautas, files: selectedFiles, pauta: nextPauta, user });
      setPautas(saved);
      clearForm();
      setFormOpen(false);
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function persistPauta(pauta: Pauta, files: File[] = []) {
    setSaving(true);
    setError("");

    try {
      const saved = await saveAppPauta({ current: pautas, files, pauta, user });
      setPautas(saved);
    } catch (persistError) {
      setError(getErrorMessage(persistError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleDestaque(pauta: Pauta) {
    if (!canUserManagePautaApp(pauta, user)) return;
    await persistPauta({ ...pauta, destaque: !pauta.destaque, updatedAt: new Date().toISOString(), modificadoEm: new Date().toISOString() });
  }

  async function concludePauta(pauta: Pauta) {
    setSaving(true);
    setError("");

    try {
      const saved = await completeAppPauta({ current: pautas, pauta, user });
      setPautas(saved);
    } catch (completeError) {
      setError(getErrorMessage(completeError));
    } finally {
      setSaving(false);
    }
  }

  async function removePauta(pauta: Pauta) {
    if (!canUserManagePautaApp(pauta, user)) return;
    setSaving(true);
    setError("");

    try {
      const saved = await deleteAppPauta({ current: pautas, pauta, user });
      setPautas(saved);
      if (editingId === pauta.id) {
        clearForm();
        setFormOpen(false);
      }
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  function toggleResponsavel(email: string) {
    setResponsaveis((current) => (current.includes(email) ? current.filter((item) => item !== email) : [...current, email]));
  }

  function shiftMonth(delta: number) {
    setMonthCursor((current) => new Date(current.getFullYear(), current.getMonth() + delta, 1));
  }

  function renderPautaRow(pauta: Pauta, keyPrefix = "") {
    const pautaContentStyle = getPautaContentStyle(pauta);
    const pautaDescriptionHtml = sanitizePautaRichHtml(pauta.acoes || pauta.pendenciasObs || "Sem acao registrada");
    return (
      <article className={`list-row list-row--pauta ${pauta.destaque ? "list-row--pauta-featured" : ""}`} data-pauta-row key={`${keyPrefix}${pauta.id}`}>
        <div
          className={`pauta-content pauta-content--${pauta.textSize || "normal"} ${pauta.textBold ? "pauta-content--bold" : ""} ${
            pauta.textItalic ? "pauta-content--italic" : ""
          }`}
          data-font-bold={pauta.textBold ? "true" : "false"}
          data-font-size={pauta.textSize || "normal"}
          data-font-italic={pauta.textItalic ? "true" : "false"}
          style={pautaContentStyle}
        >
          <strong style={{ fontStyle: pautaContentStyle.fontStyle, fontWeight: pautaContentStyle.fontWeight }}>
            {pauta.tema}
          </strong>
          <span
            className="pauta-description pauta-rich-text"
            dangerouslySetInnerHTML={{ __html: pautaDescriptionHtml }}
            style={{ fontStyle: pautaContentStyle.fontStyle, fontWeight: pautaContentStyle.fontWeight }}
          />
          {pauta.retorno ? (
            <span className="pauta-return" style={{ fontStyle: pautaContentStyle.fontStyle, fontWeight: pautaContentStyle.fontWeight }}>
              Retorno: {pauta.retorno}
            </span>
          ) : null}
          <em style={{ fontStyle: pautaContentStyle.fontStyle, fontWeight: pautaContentStyle.fontWeight }}>
            {pauta.scope === "usuarios" ? formatResponsaveis(pauta.responsaveis || [], hubUsers) : "Todos os usuarios"}
          </em>
          {pauta.anexos?.length ? (
            <div className="pauta-attachments">
              {pauta.anexos.map((anexo) => (
                <a href={anexo.url} key={anexo.id} rel="noreferrer" target="_blank">
                  <Paperclip size={12} />
                  {anexo.name}
                </a>
              ))}
            </div>
          ) : null}
        </div>
        <div className="pauta-row-badges">
          {pauta.destaque ? <StatusPill label="Destaque" /> : null}
          <StatusPill label={pauta.status || "Sem status"} />
          {pauta.prioridade ? <StatusPill label={pauta.prioridade} /> : null}
        </div>
        <small className={`pauta-date pauta-date--${getPautaTone(pauta)}`}>
          <CalendarDays size={12} />
          {formatDate(pauta.prazo)} - {pauta.origem}
        </small>
        <div className="record-actions pauta-actions">
          {canUserCompletePautaApp(pauta, user) && !hasUserCompletedPauta(pauta, user) ? (
            <button disabled={saving} type="button" onClick={() => concludePauta(pauta)}>
              <CheckCircle2 size={14} />
              Concluir
            </button>
          ) : null}
          {hasUserCompletedPauta(pauta, user) ? <span className="readonly-note">Concluida por voce</span> : null}
          {canUserManagePautaApp(pauta, user) ? (
            <>
              <button disabled={saving} type="button" onClick={() => startEditPauta(pauta)}>
                <Edit3 size={14} />
                Editar
              </button>
              <button disabled={saving} type="button" onClick={() => toggleDestaque(pauta)}>
                <Tag size={14} />
                {pauta.destaque ? "Remover destaque" : "Destacar"}
              </button>
              <button className="danger-action" disabled={saving} type="button" onClick={() => removePauta(pauta)}>
                <Trash2 size={14} />
                Excluir
              </button>
            </>
          ) : null}
        </div>
      </article>
    );
  }

  function renderQuadroAvisos() {
    const avisoCells = Array.from({ length: 10 }, (_, index) => index + 1);

    return (
      <div className="avisos-board">
        <div className="avisos-toolbar">
          <div className="avisos-toolbar-main">
            <button type="button">Texto</button>
            <button
              className={avisosDrawMode ? "primary" : ""}
              type="button"
              onClick={() => setAvisosDrawMode((current) => !current)}
            >
              Desenhar
            </button>
            <button type="button">Imagem</button>
            <button type="button">Anexo</button>
            <button type="button">Post-it</button>
          </div>
          <div className="avisos-mode-switch" aria-label="Filtro do quadro de avisos">
            <button
              className={avisosView === "geral" ? "active" : ""}
              type="button"
              onClick={() => setAvisosView("geral")}
            >
              Quadro geral
            </button>
            <button
              className={avisosView === "particular" ? "active" : ""}
              type="button"
              onClick={() => setAvisosView("particular")}
            >
              Quadro particular
            </button>
          </div>
        </div>

        {avisosDrawMode ? (
          <div className="avisos-draw-stage">
            <div className="avisos-draw-head">
              <div>
                <strong>Modo desenho</strong>
                <span>Quadro branco temporario para rascunhos. Exporte antes de sair deste modo.</span>
              </div>
              <div className="avisos-export-actions">
                <button type="button">PDF</button>
                <button type="button">DOCX</button>
                <button type="button">XLSX</button>
              </div>
            </div>
            <div className="avisos-draw-canvas">
              <span>Area livre para desenho estilo Paint</span>
            </div>
          </div>
        ) : (
          <div className="avisos-workspace">
            <div className="avisos-grid" aria-label="Quadro de avisos em 10 partes">
              {avisoCells.map((cell) => (
                <button
                  className={`aviso-cell ${selectedAvisoCell === cell ? "active" : ""}`}
                  key={cell}
                  type="button"
                  onClick={() => setSelectedAvisoCell(cell)}
                >
                  <span className="aviso-cell__title">Espaco {String(cell).padStart(2, "0")}</span>
                  <span className="aviso-cell__hint">
                    {avisosView === "geral" ? "Geral" : "Particular"}
                  </span>
                </button>
              ))}
            </div>
            <aside className="avisos-editor-panel">
              <span className="panel-status">Rascunho visual</span>
              <h3>Editor do espaco {String(selectedAvisoCell).padStart(2, "0")}</h3>
              <div className="pauta-format-toolbar avisos-format-toolbar">
                <label>
                  Fonte
                  <select defaultValue="normal">
                    <option value="pequena">Pequena</option>
                    <option value="normal">Normal</option>
                    <option value="grande">Grande</option>
                  </select>
                </label>
                <button type="button"><strong>B</strong></button>
                <button type="button"><Highlighter size={15} /></button>
              </div>
              <textarea placeholder="Escreva um aviso, orientacao ou recado para este espaco." />
              <div className="avisos-editor-actions">
                <button type="button">Inserir imagem</button>
                <button type="button">Anexar documento</button>
                <button type="button">Post-it</button>
              </div>
              <fieldset className="member-picker avisos-member-picker">
                <legend>Salvar como</legend>
                <label>
                  <input checked={avisosView === "geral"} readOnly type="radio" />
                  Quadro geral
                </label>
                <label>
                  <input checked={avisosView === "particular"} readOnly type="radio" />
                  Quadro particular
                </label>
              </fieldset>
              {avisosView === "particular" ? (
                <div className="avisos-user-list">
                  {getActiveProfiles(hubUsers).map((member) => (
                    <label key={member.email}>
                      <input type="checkbox" />
                      {member.nome}
                    </label>
                  ))}
                </div>
              ) : null}
              <button className="primary-action" type="button">Salvar aviso</button>
            </aside>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="pautas-page">
      <section className="panel panel--pautas">
        <DashboardPanelHeader
          actionLabel={pautasView === "lista" && canManagePautas ? "Nova pauta" : undefined}
          actionTitle="Criar pauta no HUB"
          icon={<ListChecks size={18} />}
          onAction={pautasView === "lista" && canManagePautas ? startNewPauta : undefined}
          secondaryIcon={<RefreshCw size={14} />}
          secondaryLabel={pautasView === "lista" ? (autoScroll ? "Rolagem ligada" : "Rolagem parada") : "Quadro ativo"}
          onSecondaryAction={pautasView === "lista" ? () => setAutoScroll((current) => !current) : undefined}
          status={pautaStatusLabel}
          title="Pautas"
        />
        <div className="pautas-subtabs" role="tablist" aria-label="Secoes do menu Pautas">
          <button
            aria-selected={pautasView === "lista"}
            className={pautasView === "lista" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setPautasView("lista")}
          >
            Pautas
          </button>
          <button
            aria-selected={pautasView === "avisos"}
            className={pautasView === "avisos" ? "active" : ""}
            role="tab"
            type="button"
            onClick={() => setPautasView("avisos")}
          >
            Quadro de Avisos
          </button>
        </div>
        {pautasView === "avisos" ? renderQuadroAvisos() : (
          <>
            <div className="pautas-monthbar">
              <button type="button" onClick={() => shiftMonth(-1)} aria-label="Mes anterior">
                <ChevronLeft size={16} />
              </button>
              <strong>{monthCursor.toLocaleDateString("pt-BR", { month: "long", year: "numeric" })}</strong>
              <button type="button" onClick={() => shiftMonth(1)} aria-label="Proximo mes">
                <ChevronRight size={16} />
              </button>
              <button type="button" onClick={() => setMonthCursor(new Date())}>Mes atual</button>
            </div>
            <div className="panel-toolbar">
              <button className={`filter-pill ${pautaFilter === "todas" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("todas")}>
                Todas ({monthPautas.length})
              </button>
              <button className={`filter-pill ${pautaFilter === "minhas" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("minhas")}>
                Minhas ({statusCounts.minhas})
              </button>
              <button className={`filter-pill ${pautaFilter === "destaques" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("destaques")}>
                Destaques ({statusCounts.destaques})
              </button>
              <button className={`filter-pill ${pautaFilter === "alta" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("alta")}>
                Alta ({statusCounts.alta})
              </button>
              <button
                className={`filter-pill filter-pill--danger ${pautaFilter === "atrasadas" ? "active" : ""}`}
                type="button"
                onClick={() => setPautaFilter("atrasadas")}
              >
                Atrasadas ({statusCounts.atrasado})
              </button>
              <button
                className={`filter-pill filter-pill--warning ${pautaFilter === "semPrazo" ? "active" : ""}`}
                type="button"
                onClick={() => setPautaFilter("semPrazo")}
              >
                Sem prazo ({statusCounts.semPrazo})
              </button>
              <button className={`filter-pill ${pautaFilter === "concluidas" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("concluidas")}>
                Concluidas ({statusCounts.concluidas})
              </button>
              <label className="panel-search">
                <Search size={14} />
                <input
                  aria-label="Buscar pautas"
                  onChange={(event) => setPautaQuery(event.target.value)}
                  placeholder="Buscar..."
                  value={pautaQuery}
                />
              </label>
              <div className="panel-export-actions" aria-label="Exportar pautas">
                <button type="button" onClick={() => exportPautas("pdf")}>PDF</button>
                <button type="button" onClick={() => exportPautas("excel")}>XLSX</button>
                <button disabled={sendingPautasEmail} type="button" onClick={sendPautasByEmail}>
                  {sendingPautasEmail ? "Enviando..." : "E-mail"}
                </button>
              </div>
            </div>
            {error ? <p className="module-error module-error--compact">{error}</p> : null}
            {pautasEmailStatus ? <p className="module-notice module-notice--compact">{pautasEmailStatus}</p> : null}
            <div
              className={`stack-list pautas-stack ${shouldAutoScrollPautas ? "pautas-stack--scrolling" : ""}`}
              ref={pautasStackRef}
              style={pautasScrollStyle}
            >
              <div className="pautas-scroll-track" key={`${selectedYear}-${selectedMonth}-${pautaFilter}-${filteredPautas.length}-${autoScroll ? "scroll" : "static"}`}>
                <div className="pautas-scroll-group">
                  {filteredPautas.map((pauta) => renderPautaRow(pauta))}
                  {!filteredPautas.length && !loading ? (
                    <div className="empty-state">
                      Nenhuma pauta encontrada para o filtro atual.
                    </div>
                  ) : null}
                </div>
                {shouldAutoScrollPautas ? (
                  <div aria-hidden="true" className="pautas-scroll-group pautas-scroll-group--copy">
                    {filteredPautas.map((pauta) => renderPautaRow(pauta, "copy-"))}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}
      </section>

      {pautasView === "lista" && canManagePautas && formOpen ? (
        <section className="panel pauta-editor-panel" ref={pautaEditorRef}>
          <PanelHeader title={editingId ? "Editar pauta" : "Nova pauta"} icon={<ListChecks size={18} />} action={source} />
          <form className="stack-form" onSubmit={submitPauta}>
            <label>
              Titulo
              <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
            </label>
            <div className="rich-editor-field">
              <span>Descricao / orientacao</span>
              <div
                aria-label="Descricao / orientacao"
                className="pauta-description-input pauta-rich-text"
                contentEditable
                data-placeholder="Escreva a orientacao da pauta..."
                onBlur={rememberPautaSelection}
                onInput={syncPautaDescriptionFromEditor}
                onKeyUp={rememberPautaSelection}
                onMouseUp={rememberPautaSelection}
                ref={pautaDescriptionEditorRef}
                suppressContentEditableWarning
              />
            </div>
            <div className="pauta-format-toolbar" aria-label="Formatacao da descricao da pauta">
              <label>
                Fonte
                <select
                  value={pautaTextSize}
                  onMouseDown={rememberPautaSelection}
                  onChange={(event) => applyPautaTextSize(event.target.value as NonNullable<Pauta["textSize"]>)}
                >
                  <option value="pequena">Pequena</option>
                  <option value="normal">Normal</option>
                  <option value="grande">Grande</option>
                </select>
              </label>
              <button
                className={pautaTextBold ? "active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyPautaInlineCommand("bold");
                }}
                type="button"
                title="Negrito"
              >
                <strong>B</strong>
              </button>
              <button
                className={pautaTextItalic ? "active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyPautaInlineCommand("italic");
                }}
                type="button"
                title="Italico"
              >
                <em>I</em>
              </button>
              <button
                className={pautaTextHighlight ? "active highlight-active" : ""}
                onMouseDown={(event) => {
                  event.preventDefault();
                  applyPautaHighlight();
                }}
                type="button"
                title="Grifo amarelo"
              >
                <Highlighter size={15} />
              </button>
            </div>
            {titulo.trim() || hasPautaRichContent(descricao) ? (
              <div className="pauta-format-preview">
                <span>Previa da formatacao</span>
                {titulo.trim() ? <strong>{titulo}</strong> : null}
                {hasPautaRichContent(descricao) ? (
                  <div className="pauta-rich-text" dangerouslySetInnerHTML={{ __html: sanitizePautaRichHtml(descricao) }} />
                ) : null}
              </div>
            ) : null}
            <div className="form-row">
              <label>
                Prazo
                <input value={prazo} onChange={(event) => setPrazo(event.target.value)} type="datetime-local" />
              </label>
              <label>
                Prioridade
                <select value={prioridade} onChange={(event) => setPrioridade(event.target.value)}>
                  <option value="normal">Normal</option>
                  <option value="alta">Alta</option>
                  <option value="baixa">Baixa</option>
                </select>
              </label>
            </div>
            <div className="form-row">
              <label>
                Status
                <select value={status} onChange={(event) => setStatus(event.target.value)}>
                  <option value="aberta">Aberta</option>
                  <option value="concluida">Concluida</option>
                </select>
              </label>
              <label>
                Destinatarios
                <select value={scope} onChange={(event) => setScope(event.target.value as "todos" | "usuarios")}>
                  <option value="todos">Todos</option>
                  <option value="usuarios">Colaboradores marcados</option>
                </select>
              </label>
            </div>
            <label className="confidential-field">
              <input checked={destaque} onChange={(event) => setDestaque(event.target.checked)} type="checkbox" />
              <span>
                <strong>Destacar pauta</strong>
                <small>Exibe o item em alto relevo no painel principal.</small>
              </span>
            </label>
            {scope === "usuarios" ? (
              <fieldset className="member-picker">
                <legend>Colaboradores marcados</legend>
                <div>
                  {getActiveProfiles(hubUsers).map((member) => (
                    <label key={member.email}>
                      <input
                        checked={responsaveis.includes(member.email)}
                        onChange={() => toggleResponsavel(member.email)}
                        type="checkbox"
                      />
                      <span>{member.iniciais || getInitials(member.nome)}</span>
                      {member.nome}
                    </label>
                  ))}
                </div>
              </fieldset>
            ) : null}
            <label>
              Anexos
              <input multiple onChange={(event) => setSelectedFiles(Array.from(event.target.files || []))} type="file" />
            </label>
            {selectedFiles.length ? (
              <div className="attachment-list">
                {selectedFiles.map((file) => (
                  <span key={`${file.name}-${file.size}`}>{file.name}</span>
                ))}
              </div>
            ) : null}
            <div className="form-actions-inline">
              <button className="primary-action" disabled={saving || loading} type="submit">
                {saving ? "Salvando..." : editingId ? "Salvar edicao da pauta" : "Salvar pauta"}
              </button>
              <button disabled={saving} type="button" onClick={() => { clearForm(); setFormOpen(false); }}>
                {editingId ? "Cancelar edicao" : "Cancelar"}
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <FooterUpdates />
    </div>
  );
}

function DashboardPanelHeader({
  actionLabel,
  actionTitle,
  icon,
  onAction,
  onSecondaryAction,
  secondaryIcon,
  secondaryLabel,
  status,
  title
}: {
  actionLabel?: string;
  actionTitle?: string;
  icon: React.ReactNode;
  onAction?: () => void;
  onSecondaryAction?: () => void;
  secondaryIcon: React.ReactNode;
  secondaryLabel: string;
  status: string;
  title: string;
}) {
  return (
    <header className="panel-head">
      <div className="panel-title">
        <span className="panel-accent" />
        {icon}
        <h2>{title}</h2>
      </div>
      <div className="panel-actions">
        <span className="panel-status">{status}</span>
        <button className="btn-mini" type="button" onClick={onSecondaryAction}>
          {secondaryIcon}
          {secondaryLabel}
        </button>
        {actionLabel ? (
          <button className="btn-mini primary" type="button" onClick={onAction} title={actionTitle || actionLabel}>
            <Plus size={14} />
            {actionLabel}
          </button>
        ) : null}
      </div>
    </header>
  );
}

function PanelHeader({ title, icon, action }: { title: string; icon: React.ReactNode; action: string }) {
  return (
    <header className="panel-header">
      <div>
        {icon}
        <h2>{title}</h2>
      </div>
      <span>{action}</span>
    </header>
  );
}

function StatusPill({ label }: { label: string }) {
  const normalized = label.toLowerCase();
  const tone =
    normalized.includes("atrasado") || normalized.includes("alta") || normalized.includes("urgente")
      ? "danger"
      : normalized.includes("conclu")
        ? "ok"
        : normalized.includes("andamento")
          ? "warning"
          : "neutral";
  return <span className={`status-pill status-pill--${tone}`}>{label}</span>;
}

function DueSignal({ prazo }: { prazo: string }) {
  const tone = getDueTone(prazo);

  return <span className={`due-signal due-signal--${tone}`} aria-label={`Prazo ${tone}`} />;
}

function FooterUpdates() {
  const [noticias, setNoticias] = useState<Noticia[]>([]);
  const [legislacoes, setLegislacoes] = useState<Noticia[]>([]);
  const [openDrawer, setOpenDrawer] = useState<"noticia" | "legislacao" | null>(null);

  useEffect(() => {
    let active = true;

    Promise.all([listAppUpdates("noticia"), listAppUpdates("legislacao")])
      .then(([loadedNoticias, loadedLegislacoes]) => {
        if (!active) return;
        setNoticias(loadedNoticias);
        setLegislacoes(loadedLegislacoes);
      })
      .catch(() => {
        if (!active) return;
        setNoticias([]);
        setLegislacoes([]);
      });

    return () => {
      active = false;
    };
  }, []);

  const drawerItems = openDrawer === "legislacao" ? legislacoes : noticias;

  return (
    <footer className="footer-updates">
      <UpdateTicker
        icon={<Newspaper size={18} />}
        items={noticias}
        onOpen={() => setOpenDrawer("noticia")}
        title="Noticias Tributarias"
      />
      <UpdateTicker
        icon={<ShieldCheck size={18} />}
        items={legislacoes}
        onOpen={() => setOpenDrawer("legislacao")}
        title="Legislacoes Reforma Tributaria"
      />
      {openDrawer ? (
        <UpdatesDrawer
          items={drawerItems}
          kind={openDrawer}
          onClose={() => setOpenDrawer(null)}
          title={openDrawer === "legislacao" ? "Legislacoes recentes" : "Noticias da semana"}
        />
      ) : null}
    </footer>
  );
}

function UpdateTicker({ icon, items, onOpen, title }: { icon: React.ReactNode; items: Noticia[]; onOpen: () => void; title: string }) {
  const tickerItems = items.length ? items : [{ id: `${title}-empty`, titulo: "Aguardando atualizacoes automaticas", fonte: "HUB", url: "#", data: "" }];
  const repeatCount = Math.max(2, Math.ceil(6 / tickerItems.length));
  const loopItems = Array.from({ length: repeatCount }, () => tickerItems).flat();
  const textSize = tickerItems.reduce((total, item) => total + item.fonte.length + item.titulo.length, 0);
  const tickerDuration = Math.max(52, Math.min(132, textSize * 0.62));
  const tickerStyle = { "--ticker-duration": `${tickerDuration}s` } as CSSProperties;

  return (
    <section
      className="news-band"
      aria-label={title}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") onOpen();
      }}
    >
      <div className="news-label">
        {icon}
        <strong>{title}</strong>
      </div>
      <div className="ticker-window">
        <div className="ticker-track" style={tickerStyle}>
          {loopItems.map((item, index) => (
            <span className="ticker-item" key={`${item.id}-${index}`}>
              <strong>{item.fonte}</strong>
              <span>{item.titulo}</span>
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function UpdatesDrawer({ items, kind, onClose, title }: { items: Noticia[]; kind: "noticia" | "legislacao"; onClose: () => void; title: string }) {
  function exportUpdates(format: ReportFormat) {
    exportReport(format, title, items.map(noticiaToReportRow));
  }

  return (
    <div className="updates-sidebar-backdrop" role="presentation" onClick={onClose}>
      <aside className="updates-sidebar" aria-label={title} role="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{title}</strong>
            <small>{kind === "legislacao" ? "Normas oficiais monitoradas" : "Ultimos 7 dias"} - {items.length} item(ns)</small>
          </div>
          <div className="updates-sidebar-actions">
            <button type="button" onClick={() => exportUpdates("pdf")}>PDF</button>
            <button type="button" onClick={() => exportUpdates("excel")}>XLSX</button>
            <button aria-label="Fechar atualizacoes" type="button" onClick={onClose}>
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="updates-list">
          {items.map((item) => (
            <a href={item.url} key={item.id} rel="noreferrer" target="_blank">
              <span>{formatDate(item.data)}</span>
              <strong>{item.titulo}</strong>
              <em>{item.fonte}</em>
              <small>{item.url}</small>
            </a>
          ))}
          {!items.length ? <div className="empty-state">Nenhuma atualizacao registrada para a ultima semana.</div> : null}
        </div>
      </aside>
    </div>
  );
}

function TasksModule({ hubUsers, onNavigate, user }: { hubUsers: HubProfile[]; onNavigate: (route: HubRoute) => void; user: HubUser }) {
  const [calendarVersion, setCalendarVersion] = useState(0);
  const calendarFrameRef = useRef<HTMLIFrameElement | null>(null);

  const syncCalendarFrame = useCallback(async () => {
    try {
      const items = await listAppTasks(user);
      calendarFrameRef.current?.contentWindow?.postMessage(
        {
          type: "hub:tasks-sync",
          events: items.map(taskToCalendarFrameEvent)
        },
        window.location.origin
      );
    } catch {
      // A sidebar mostra o erro operacional; o iframe apenas deixa de sincronizar.
    }
  }, [user]);

  useEffect(() => {
    function refreshCalendarFrame() {
      setCalendarVersion((version) => version + 1);
      window.setTimeout(() => {
        void syncCalendarFrame();
      }, 150);
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin === window.location.origin && event.data?.type === "hub:tasks") {
        const action = typeof event.data.action === "string" ? event.data.action : "";
        if (action === "ready") {
          void syncCalendarFrame();
          return;
        }
        if (!action || action === "saved" || action === "deleted" || action === "refresh") {
          refreshCalendarFrame();
        }
      }
    }

    window.addEventListener("hub:tasks", refreshCalendarFrame);
    window.addEventListener("message", handleMessage);
    void syncCalendarFrame();

    return () => {
      window.removeEventListener("hub:tasks", refreshCalendarFrame);
      window.removeEventListener("message", handleMessage);
    };
  }, [syncCalendarFrame]);

  return (
    <div className="tasks-layout">
      <div className="calendar-shell">
        <iframe
          ref={calendarFrameRef}
          key={calendarVersion}
          src={`/apps/calendar.html?v=tasks-unified-20260625-${calendarVersion}`}
          title="Calendario de tarefas"
          onLoad={() => {
            void syncCalendarFrame();
          }}
        />
      </div>
      <TaskSidebar hubUsers={hubUsers} onNavigate={onNavigate} user={user} />
    </div>
  );
}

function TaskSidebar({ hubUsers, onNavigate, user }: { hubUsers: HubProfile[]; onNavigate: (route: HubRoute) => void; user: HubUser }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("minhas");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<TaskItem["prioridade"]>("normal");
  const [destaque, setDestaque] = useState(false);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [sendingTaskEmail, setSendingTaskEmail] = useState(false);
  const [taskEmailStatus, setTaskEmailStatus] = useState("");
  const source = getTarefasSource(user);

  useEffect(() => {
    let active = true;

    async function refresh(options: { silent?: boolean } = {}) {
      if (!options.silent) setLoading(true);
      setError("");

      try {
        const items = await listAppTasks(user);
        if (active) setTasks(items);
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      } finally {
        if (active && !options.silent) setLoading(false);
      }
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin === window.location.origin && event.data?.type === "hub:tasks") {
        syncCalendarMessage(event.data);
      }
    }

    function handleHubTasks() {
      refresh({ silent: true });
    }

    async function syncCalendarMessage(data: { action?: string; event?: unknown; id?: string; date?: string }) {
      try {
        if (data.action === "new") {
          startNewTask(data.date);
          return;
        }

        if (data.action === "edit" && data.id) {
          const latestTasks = await listAppTasks(user);
          if (active) setTasks(latestTasks);
          const target = latestTasks.find((task) => task.id === data.id);
          if (target) startEdit(target);
          else refresh({ silent: true });
          return;
        }

        if (data.action === "delete-request" && data.id) {
          const latestTasks = await listAppTasks(user);
          if (active) setTasks(latestTasks);
          const target = latestTasks.find((task) => task.id === data.id);
          if (target) await removeTask(target);
          else refresh({ silent: true });
          return;
        }

        if (data.action === "saved" && data.event) {
          const items = await saveCalendarEventTask(data.event, user);
          if (active) setTasks(items);
          return;
        }

        if (data.action === "deleted" && data.id) {
          const items = await deleteCalendarEventTask(data.id, user);
          if (active) setTasks(items);
          return;
        }

        refresh({ silent: true });
      } catch (syncError) {
        if (active) setError(getErrorMessage(syncError));
      }
    }

    refresh();
    window.addEventListener("hub:tasks", handleHubTasks);
    window.addEventListener("message", handleMessage);

    return () => {
      active = false;
      window.removeEventListener("hub:tasks", handleHubTasks);
      window.removeEventListener("message", handleMessage);
    };
  }, [user]);

  const sidebarTasks = useMemo(() => tasks.filter(shouldKeepTaskInSidebarHistory), [tasks]);
  const activeTasks = useMemo(() => tasks.filter((task) => !task.archivedAt), [tasks]);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);
    return sidebarTasks
      .filter((task) => {
        if (filter === "minhas") return isTaskAssignedToUser(task, user, hubUsers);
        if (filter === "abertas") return !task.archivedAt && task.status === "aberta";
        if (filter === "concluidas") return !task.archivedAt && task.status === "concluida";
        return true;
      })
      .filter((task) => {
        if (!normalizedQuery) return true;
        return [
          task.titulo,
          task.descricao,
          task.prioridade,
          task.status,
          formatResponsaveis(task.responsaveis, hubUsers),
          task.anexos.join(" ")
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedQuery);
      });
  }, [filter, hubUsers, query, sidebarTasks, user]);

  const minhasTasks = useMemo(() => sidebarTasks.filter((task) => isTaskAssignedToUser(task, user, hubUsers)), [hubUsers, sidebarTasks, user]);
  const abertasCount = activeTasks.filter((task) => task.status === "aberta").length;

  function clearFormFields() {
    setEditingId(null);
    setTitulo("");
    setDescricao("");
    setPrazo("");
    setPrioridade("normal");
    setDestaque(false);
    setResponsaveis([]);
    setAnexos([]);
    setSelectedFiles([]);
    setTaskEmailStatus("");
  }

  function resetForm() {
    clearFormFields();
    setError("");
    setFormOpen(false);
  }

  function startNewTask(defaultPrazo = "") {
    clearFormFields();
    setPrazo(defaultPrazo);
    setResponsaveis(user.email ? [user.email] : []);
    setError("");
    setFormOpen(true);
  }

  function startEdit(task: TaskItem) {
    setTaskEmailStatus("");

    if (!canUserManageTask(task, user)) {
      setFormOpen(false);
      setError("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode altera-la.");
      return;
    }

    setError("");
    setEditingId(task.id);
    setTitulo(task.titulo);
    setDescricao(task.descricao);
    setPrazo(task.prazo);
    setPrioridade(task.prioridade);
    setDestaque(task.destaque === true);
    setResponsaveis(task.responsaveis);
    setAnexos(task.anexos);
    setSelectedFiles([]);
    setFormOpen(true);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim()) {
      setError("Informe o titulo da tarefa.");
      return;
    }
    if (!prazo) {
      setError("Informe o prazo da tarefa para sincronizar com o calendario.");
      return;
    }

    const now = new Date().toISOString();
    const existing = tasks.find((task) => task.id === editingId);
    const nextTask: TaskItem = {
      id: existing?.id || crypto.randomUUID(),
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      prazo,
      prioridade,
      status: existing?.status || "aberta",
      destaque,
      origem: existing?.origem || "calendario",
      coordItemId: existing?.coordItemId || "",
      responsaveis,
      anexos,
      createdBy: existing?.createdBy || user.id || user.email,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    setSaving(true);
    setError("");

    try {
      const saved = await saveAppTask({
        current: tasks,
        files: selectedFiles,
        task: nextTask,
        user
      });
      setTasks(saved);
      resetForm();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function persistSingle(task: TaskItem) {
    setSaving(true);
    setError("");

    try {
      const saved = await saveAppTask({ current: tasks, task, user });
      setTasks(saved);
    } catch (persistError) {
      setError(getErrorMessage(persistError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleTask(id: string) {
    const target = tasks.find((task) => task.id === id);
    if (!target) return;

    if (!canUserManageTask(target, user)) {
      setError("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode conclui-la.");
      return;
    }

    await persistSingle({
      ...target,
      status: target.status === "aberta" ? "concluida" : "aberta",
      updatedAt: new Date().toISOString()
    });
  }

  async function removeTask(task: TaskItem) {
    if (!canUserManageTask(task, user)) {
      setError("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode exclui-la.");
      return;
    }

    setSaving(true);
    setError("");

    try {
      const saved = await deleteAppTask({ current: tasks, task, user });
      setTasks(saved.filter((item) => item.id !== task.id));
      if (editingId === task.id) resetForm();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  function toggleResponsavel(email: string) {
    setResponsaveis((current) => (current.includes(email) ? current.filter((item) => item !== email) : [...current, email]));
  }

  function handleFiles(files: FileList | null) {
    const fileList = Array.from(files || []);
    setSelectedFiles(fileList);
    setAnexos(fileList.length ? fileList.map((file) => file.name) : anexos);
  }

  function exportTasks(format: ReportFormat) {
    exportReport(format, "Calendario de Tarefas - HUB Depto Tributario", filteredTasks.map(taskToReportRow));
  }

  async function sendTasksByEmail() {
    setSendingTaskEmail(true);
    setTaskEmailStatus("");
    setError("");

    try {
      const rows = filteredTasks.length ? filteredTasks.map(taskToReportRow) : [{ Info: "Nenhuma tarefa encontrada para o filtro atual." }];
      const body = rows
        .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join("\n"))
        .join("\n\n");
      const authToken = await getSupabaseAccessToken();
      const taskRecipients = filteredTasks.flatMap((task) => task.responsaveis);
      const recipients = [...new Set([user.email, ...taskRecipients].filter(Boolean).map((email) => email.toLowerCase()))];

      for (const to of recipients) {
        const response = await fetch("/.netlify/functions/coord-email", {
          method: "POST",
          headers: {
            accept: "application/json",
            "content-type": "application/json"
          },
          body: JSON.stringify({
            authToken,
            to,
            subject: "Calendario de Tarefas - HUB Depto Tributario",
            body,
            htmlBody: `<p>Segue o resumo do Calendario de Tarefas do HUB Depto Tributario.</p><pre>${escapeHtmlText(body)}</pre>`
          })
        });
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || `Nao foi possivel enviar o calendario para ${to}.`);
      }

      setTaskEmailStatus(`Resumo enviado para ${recipients.length} destinatario(s).`);
    } catch (sendError) {
      setError(getErrorMessage(sendError));
    } finally {
      setSendingTaskEmail(false);
    }
  }

  if (formOpen) {
    return (
      <aside className="task-sidebar task-sidebar--form">
        <header className="task-sidebar-head">
          <div className="task-sidebar-title">
            <h2>{editingId ? "Editar tarefa" : "Nova tarefa"}</h2>
            <small>{editingId ? "Atualize os dados e salve para voltar a lista." : "Preencha a tarefa e salve para voltar a lista."}</small>
          </div>
          <button className="btn-mini" disabled={saving} type="button" onClick={resetForm}>
            <X size={14} />
            Cancelar
          </button>
        </header>

        <form className="task-form task-form--open task-form--full" onSubmit={handleSubmit}>
          {error ? <p className="module-error module-error--compact">{error}</p> : null}
          <label>
            Titulo
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            Notas / descricao
            <textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Prazo
              <input value={prazo} onChange={(event) => setPrazo(event.target.value)} type="datetime-local" />
            </label>
            <label>
              Prioridade
              <select value={prioridade} onChange={(event) => setPrioridade(event.target.value as TaskItem["prioridade"])}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="baixa">Baixa</option>
              </select>
            </label>
          </div>
          <label className="inline-check task-featured-check">
            <input checked={destaque} onChange={(event) => setDestaque(event.target.checked)} type="checkbox" />
            Destacar esta tarefa no calendario/lista
          </label>
          <fieldset className="member-picker member-picker--compact">
            <legend>Responsaveis</legend>
            <div>
              {getActiveProfiles(hubUsers).map((member) => (
                <label key={member.email}>
                  <input
                    checked={responsaveis.includes(member.email)}
                    onChange={() => toggleResponsavel(member.email)}
                    type="checkbox"
                  />
                  <span>{member.iniciais || getInitials(member.nome)}</span>
                  {member.nome}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            Anexos
            <input multiple onChange={(event) => handleFiles(event.target.files)} type="file" />
          </label>
          {anexos.length ? (
            <div className="attachment-list">
              {anexos.map((anexo) => (
                <span key={anexo}>{anexo}</span>
              ))}
            </div>
          ) : null}
          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingId ? "Salvar edicao" : "Salvar tarefa"}
            </button>
            <button disabled={saving} type="button" onClick={resetForm}>
              Cancelar
            </button>
          </div>
        </form>
      </aside>
    );
  }

  return (
    <aside className="task-sidebar">
      <header className="task-sidebar-head">
        <div className="task-sidebar-title">
          <h2>Minhas tarefas</h2>
          <small>{loading ? "Carregando..." : `${source} - ${sidebarTasks.length} item(ns)`}</small>
        </div>
        <button className="btn-mini primary task-new-button" disabled={saving || loading} type="button" onClick={() => startNewTask()}>
          <Plus size={14} />
          Nova tarefa
        </button>
      </header>

      <div className="task-sidebar-summary">
        <span>{minhasTasks.length} minhas</span>
        <span>{abertasCount} abertas</span>
      </div>

      <div className="panel-toolbar task-toolbar">
        <button className={`filter-pill ${filter === "minhas" ? "active" : ""}`} onClick={() => setFilter("minhas")} type="button">
          Minhas ({minhasTasks.length})
        </button>
        <button className={`filter-pill ${filter === "todas" ? "active" : ""}`} onClick={() => setFilter("todas")} type="button">
          Todas ({sidebarTasks.length})
        </button>
        <button className={`filter-pill ${filter === "abertas" ? "active" : ""}`} onClick={() => setFilter("abertas")} type="button">
          Abertas ({abertasCount})
        </button>
        <label className="panel-search">
          <Search size={14} />
          <input aria-label="Buscar tarefas" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." value={query} />
        </label>
      </div>

      <div className="task-export-actions">
        <button type="button" onClick={() => exportTasks("pdf")}>
          PDF
        </button>
        <button type="button" onClick={() => exportTasks("excel")}>
          XLSX
        </button>
        <button disabled={sendingTaskEmail || loading} type="button" onClick={sendTasksByEmail}>
          {sendingTaskEmail ? "Enviando..." : "Enviar por e-mail"}
        </button>
      </div>

      {error ? <p className="module-error module-error--compact">{error}</p> : null}
      {taskEmailStatus ? <p className="module-notice module-notice--compact">{taskEmailStatus}</p> : null}

      <div className="task-list">
        {filteredTasks.map((task) => {
          const canManage = canUserManageTask(task, user);
          const isHistoryTask = isTaskSidebarHistoryRecord(task);

          return (
            <article
              className={`task-item task-item--${task.status} ${task.destaque ? "task-item--featured" : ""} ${
                isHistoryTask ? "task-item--history" : ""
              }`}
              key={task.id}
            >
              <CheckCircle2 size={17} />
              <div>
                <strong>{task.titulo}</strong>
                <span className="task-note-preview">{task.descricao || "Sem notas registradas"}</span>
                <small>{task.prazo ? formatDateTime(task.prazo) : "Sem prazo"} - {formatResponsaveis(task.responsaveis, hubUsers)}</small>
                <div className="lembrete-tags">
                  {isHistoryTask ? <StatusPill label="historico" /> : null}
                  {task.destaque ? <StatusPill label="destaque" /> : null}
                  <StatusPill label={task.status} />
                  <StatusPill label={task.prioridade} />
                  {task.anexos.length ? (
                    <span className="attachments">
                      <Paperclip size={12} />
                      {task.anexos.length}
                    </span>
                  ) : null}
                </div>
                {canManage ? (
                  <div className="record-actions">
                    <button disabled={saving} type="button" onClick={() => startEdit(task)}>
                      <Edit3 size={14} />
                      Editar notas
                    </button>
                    <button disabled={saving} type="button" onClick={() => toggleTask(task.id)}>
                      <CheckCircle2 size={14} />
                      {task.status === "concluida" ? "Reabrir" : "Concluir"}
                    </button>
                    <button className="danger-action" disabled={saving} type="button" onClick={() => removeTask(task)}>
                      <Trash2 size={14} />
                      Excluir
                    </button>
                  </div>
                ) : (
                  <div className="record-actions record-actions--readonly">
                    <span className="readonly-note">Somente visualizacao</span>
                  </div>
                )}
              </div>
            </article>
          );
        })}
        {!filteredTasks.length ? <div className="empty-state">Nenhuma tarefa encontrada.</div> : null}
      </div>
    </aside>
  );
}

function TaskLembretesPanel({
  hubUsers,
  onNavigate,
  user
}: {
  hubUsers: HubProfile[];
  onNavigate: (route: HubRoute) => void;
  user: HubUser;
}) {
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const source = getLembretesSource(user);

  useEffect(() => {
    let active = true;

    async function refresh(options: { silent?: boolean } = {}) {
      if (!options.silent) setLoading(true);
      try {
        const loaded = await listAppLembretes(user);
        if (active) setLembretes(loaded);
      } finally {
        if (active && !options.silent) setLoading(false);
      }
    }

    function handleLembretesChange() {
      refresh({ silent: true });
    }

    refresh();
    window.addEventListener("hub:lembretes", handleLembretesChange);

    return () => {
      active = false;
      window.removeEventListener("hub:lembretes", handleLembretesChange);
    };
  }, [user]);

  const filtered = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return lembretes;
    return lembretes.filter((lembrete) =>
      normalizeForSearch(
        [lembrete.titulo, lembrete.descricao, lembrete.status, lembrete.prioridade, formatResponsaveis(lembrete.responsaveis, hubUsers)].join(" ")
      ).includes(normalizedQuery)
    );
  }, [hubUsers, lembretes, query]);

  const overdueCount = lembretes.filter((lembrete) => getDueTone(lembrete.prazo) === "danger").length;

  function openLembrete(lembrete?: Lembrete) {
    if (lembrete && canUserManageLembrete(lembrete, user)) {
      sessionStorage.setItem("hub_open_lembrete_id", lembrete.id);
    }
    onNavigate("lembretes");
  }

  return (
    <section className="task-lembretes-panel">
      <header>
        <div>
          <strong>Lembretes</strong>
          <small>{loading ? "Carregando..." : `${source} - ${lembretes.length} item(ns)`}</small>
        </div>
        <button className="btn-mini primary" type="button" onClick={() => openLembrete()}>
          <Plus size={14} />
          Novo
        </button>
      </header>
      <div className="task-sidebar-summary">
        <span>{lembretes.length} visiveis</span>
        <span>{overdueCount} atrasados</span>
      </div>
      <div className="panel-toolbar task-toolbar">
        <label className="panel-search">
          <Search size={14} />
          <input aria-label="Buscar lembretes" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar lembrete..." value={query} />
        </label>
        <div className="panel-export-actions" aria-label="Exportar lembretes">
          <button type="button" onClick={() => exportReport("pdf", "Lembretes - HUB Depto Tributario", filtered.map((lembrete) => lembreteToReportRow(lembrete, hubUsers)))}>
            PDF
          </button>
          <button type="button" onClick={() => exportReport("excel", "Lembretes - HUB Depto Tributario", filtered.map((lembrete) => lembreteToReportRow(lembrete, hubUsers)))}>
            XLSX
          </button>
        </div>
      </div>
      <div className="task-lembretes-list">
        {filtered.map((lembrete) => {
          const canOpen = canUserManageLembrete(lembrete, user);
          return (
            <article
              className={`task-item task-lembrete-item ${canOpen ? "task-lembrete-item--clickable" : ""}`}
              key={lembrete.id}
              onClick={canOpen ? () => openLembrete(lembrete) : undefined}
              role={canOpen ? "button" : undefined}
              tabIndex={canOpen ? 0 : undefined}
            >
              <DueSignal prazo={lembrete.prazo} />
              <div>
                <strong>{lembrete.titulo}</strong>
                <span>{lembrete.descricao || "Sem descricao"}</span>
                <small>{formatDateTime(lembrete.prazo)} - {formatResponsaveis(lembrete.responsaveis, hubUsers)}</small>
              </div>
            </article>
          );
        })}
        {!filtered.length ? <div className="empty-state">Nenhum lembrete encontrado.</div> : null}
      </div>
    </section>
  );
}

function LembretesModule({ hubUsers, user }: { hubUsers: HubProfile[]; user: HubUser }) {
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prioridade, setPrioridade] = useState<Lembrete["prioridade"]>("normal");
  const [confidencial, setConfidencial] = useState(false);
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const source = getLembretesSource(user);

  useEffect(() => {
    let active = true;

    async function refresh() {
      setLoading(true);
      setError("");
      try {
        const loaded = await listAppLembretes(user);
        if (active) setLembretes(loaded);
      } catch (loadError) {
        if (active) setError(getErrorMessage(loadError));
      } finally {
        if (active) setLoading(false);
      }
    }

    refresh();
    window.addEventListener("hub:lembretes", refresh);

    return () => {
      active = false;
      window.removeEventListener("hub:lembretes", refresh);
    };
  }, [user]);

  useEffect(() => {
    if (loading) return;

    const pendingId = sessionStorage.getItem("hub_open_lembrete_id");
    if (!pendingId) return;

    const target = lembretes.find((lembrete) => lembrete.id === pendingId);
    if (!target) return;

    sessionStorage.removeItem("hub_open_lembrete_id");

    if (canUserManageLembrete(target, user)) {
      startEdit(target);
    } else {
      setError("Voce pode visualizar este lembrete, mas apenas o criador, coordenacao ou administrador pode altera-lo.");
    }
  }, [lembretes, loading, user]);

  const filtered = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return lembretes;
    return lembretes.filter((lembrete) =>
      [
        lembrete.titulo,
        lembrete.descricao,
        lembrete.prioridade,
        lembrete.status,
        lembrete.confidencial ? "confidencial" : "",
        formatResponsaveis(lembrete.responsaveis, hubUsers),
        lembrete.anexos.join(" ")
      ]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery)
    );
  }, [lembretes, query]);

  function resetForm() {
    setEditingId(null);
    setTitulo("");
    setDescricao("");
    setPrazo("");
    setPrioridade("normal");
    setConfidencial(false);
    setResponsaveis([]);
    setAnexos([]);
    setSelectedFiles([]);
  }

  function canManageLembrete(lembrete: Lembrete) {
    return canUserManageLembrete(lembrete, user);
  }

  function startEdit(lembrete: Lembrete) {
    if (!canManageLembrete(lembrete)) {
      setError("Voce pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode altera-lo.");
      return;
    }

    setEditingId(lembrete.id);
    setTitulo(lembrete.titulo);
    setDescricao(lembrete.descricao);
    setPrazo(lembrete.prazo);
    setPrioridade(lembrete.prioridade);
    setConfidencial(Boolean(lembrete.confidencial));
    setResponsaveis(lembrete.responsaveis);
    setAnexos(lembrete.anexos);
    setSelectedFiles([]);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim()) return;

    const now = new Date().toISOString();
    const existing = lembretes.find((lembrete) => lembrete.id === editingId);
    const nextLembrete: Lembrete = {
      id: existing?.id || crypto.randomUUID(),
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      prazo,
      prioridade,
      status: existing?.status || "aberto",
      confidencial: user.role === "admin" ? confidencial : Boolean(existing?.confidencial),
      responsaveis,
      anexos,
      createdBy: existing?.createdBy || user.id || user.email,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    setSaving(true);
    setError("");

    try {
      const saved = await saveAppLembrete({
        current: lembretes,
        files: selectedFiles,
        lembrete: nextLembrete,
        user
      });
      setLembretes(saved);
      resetForm();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function persistSingle(lembrete: Lembrete) {
    setSaving(true);
    setError("");

    try {
      const saved = await saveAppLembrete({
        current: lembretes,
        lembrete,
        user
      });
      setLembretes(saved);
    } catch (persistError) {
      setError(getErrorMessage(persistError));
    } finally {
      setSaving(false);
    }
  }

  function toggleResponsavel(email: string) {
    setResponsaveis((current) => (current.includes(email) ? current.filter((item) => item !== email) : [...current, email]));
  }

  function handleFiles(files: FileList | null) {
    const fileList = Array.from(files || []);
    setSelectedFiles(fileList);
    setAnexos(fileList.length ? fileList.map((file) => file.name) : anexos);
  }

  async function toggleStatus(id: string) {
    const target = lembretes.find((lembrete) => lembrete.id === id);
    if (!target) return;

    if (!canManageLembrete(target)) {
      setError("Voce pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode altera-lo.");
      return;
    }

    await persistSingle({
      ...target,
      status: target.status === "concluido" ? "aberto" : "concluido",
      updatedAt: new Date().toISOString()
    });
  }

  async function removeLembrete(id: string) {
    const target = lembretes.find((lembrete) => lembrete.id === id);
    if (target && !canManageLembrete(target)) {
      setError("Voce pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode exclui-lo.");
      return;
    }

    setSaving(true);
    setError("");
    try {
      const saved = await deleteAppLembrete({ current: lembretes, id, user });
      setLembretes(saved);
      if (editingId === id) resetForm();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="split-page lembretes-page">
      <section className="panel lembretes-list-panel">
        <PanelHeader title="Lembretes" icon={<Clock3 size={18} />} action={loading ? "Carregando" : source} />
        <div className="panel-toolbar">
          <button className="filter-pill active" type="button">
            Todos ({lembretes.length})
          </button>
          <button className="filter-pill filter-pill--danger" type="button">
            Vencidos ({lembretes.filter((item) => item.status === "vencido").length})
          </button>
          <button className="filter-pill filter-pill--warning" type="button">
            Abertos ({lembretes.filter((item) => item.status === "aberto").length})
          </button>
          <label className="panel-search">
            <Search size={14} />
            <input
              aria-label="Buscar lembretes"
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar..."
              value={query}
            />
          </label>
        </div>

        {error ? <p className="module-error">{error}</p> : null}

        <div className="lembrete-records">
          {filtered.map((lembrete) => {
            const canManage = canManageLembrete(lembrete);

            return (
              <article className={`lembrete-record lembrete-record--${lembrete.status}`} key={lembrete.id}>
              <div className="lembrete-record-main">
                <DueSignal prazo={lembrete.prazo} />
                <div>
                  <strong>{lembrete.titulo}</strong>
                  <span>{lembrete.descricao || "Sem descricao"}</span>
                  <em>{formatDateTime(lembrete.prazo)} - {formatResponsaveis(lembrete.responsaveis, hubUsers)}</em>
                </div>
              </div>

              <div className="lembrete-tags">
                {lembrete.confidencial ? <StatusPill label="Confidencial" /> : null}
                <StatusPill label={lembrete.status} />
                <StatusPill label={lembrete.prioridade} />
                {lembrete.anexos.length ? (
                  <span className="attachments">
                    <Paperclip size={12} />
                    {lembrete.anexos.length}
                  </span>
                ) : null}
              </div>

              {canManage ? (
                <div className="record-actions">
                  <button disabled={saving} type="button" onClick={() => startEdit(lembrete)}>
                    <Edit3 size={14} />
                    Editar
                  </button>
                  <button disabled={saving} type="button" onClick={() => toggleStatus(lembrete.id)}>
                    <CheckCircle2 size={14} />
                    {lembrete.status === "concluido" ? "Reabrir" : "Concluir"}
                  </button>
                  <button className="danger-action" disabled={saving} type="button" onClick={() => removeLembrete(lembrete.id)}>
                    <Trash2 size={14} />
                    Excluir
                  </button>
                </div>
              ) : (
                <div className="record-actions record-actions--readonly">
                  <span className="readonly-note">Somente visualizacao</span>
                </div>
              )}
            </article>
            );
          })}
        </div>
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title={editingId ? "Editar lembrete" : "Novo lembrete"} icon={<Bell size={18} />} action={source} />
        <form className="stack-form lembrete-form" onSubmit={handleSubmit}>
          <label>
            Titulo
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            Descricao
            <textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} />
          </label>
          <div className="form-row">
            <label>
              Prazo
              <input value={prazo} onChange={(event) => setPrazo(event.target.value)} type="datetime-local" />
            </label>
            <label>
              Prioridade
              <select value={prioridade} onChange={(event) => setPrioridade(event.target.value as Lembrete["prioridade"])}>
                <option value="normal">Normal</option>
                <option value="alta">Alta</option>
                <option value="baixa">Baixa</option>
              </select>
            </label>
          </div>

          {user.role === "admin" ? (
            <label className="confidential-field">
              <input
                checked={confidencial}
                onChange={(event) => setConfidencial(event.target.checked)}
                type="checkbox"
              />
              <span>
                <strong>Confidencial</strong>
                <small>Visivel apenas para o admin criador e usuarios marcados.</small>
              </span>
            </label>
          ) : null}

          <fieldset className="member-picker">
            <legend>Usuarios marcados</legend>
            <div>
              {getActiveProfiles(hubUsers).map((member) => (
                <label key={member.email}>
                  <input
                    checked={responsaveis.includes(member.email)}
                    onChange={() => toggleResponsavel(member.email)}
                    type="checkbox"
                  />
                  <span>{member.iniciais || getInitials(member.nome)}</span>
                  {member.nome}
                </label>
              ))}
            </div>
          </fieldset>

          <label>
            Anexos
            <input
              multiple
              onChange={(event) => handleFiles(event.target.files)}
              type="file"
            />
          </label>

          {anexos.length ? (
            <div className="attachment-list">
              {anexos.map((anexo) => (
                <span key={anexo}>{anexo}</span>
              ))}
            </div>
          ) : null}

          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingId ? "Atualizar lembrete" : "Salvar lembrete"}
            </button>
            {editingId ? (
              <button disabled={saving} type="button" onClick={resetForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

    </div>
  );
}

function ArquivosModule({ user }: { user: HubUser }) {
  const [resources, setResources] = useState<FileResource[]>([]);
  const [folders, setFolders] = useState<FileFolder[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FileResourceCategory | "todos">("todos");
  const [folderFilter, setFolderFilter] = useState("todos");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [url, setUrl] = useState("");
  const [categoria, setCategoria] = useState<FileResourceCategory>("drive");
  const [scope, setScope] = useState<FileResourceScope>(user.role === "admin" ? "global" : "privado");
  const [folderId, setFolderId] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderScope, setFolderScope] = useState<FileResourceScope>(user.role === "admin" ? "global" : "privado");
  const [viewerResource, setViewerResource] = useState<FileResource | null>(null);
  const [viewerZoom, setViewerZoom] = useState(100);
  const [viewerPage, setViewerPage] = useState(1);
  const [viewerPageTotal, setViewerPageTotal] = useState(0);
  const [viewerQuery, setViewerQuery] = useState("");
  const [viewerSearchTerm, setViewerSearchTerm] = useState("");
  const [viewerSearchIndex, setViewerSearchIndex] = useState(0);
  const [viewerSearchTotal, setViewerSearchTotal] = useState(0);
  const [viewerHighlight, setViewerHighlight] = useState("");
  const [viewerComment, setViewerComment] = useState("");
  const [viewerNotes, setViewerNotes] = useState<FileViewerNote[]>([]);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerSaving, setViewerSaving] = useState(false);
  const [viewerError, setViewerError] = useState("");
  const [viewerFullscreen, setViewerFullscreen] = useState(false);
  const [ocrRunning, setOcrRunning] = useState(false);
  const [ocrMessage, setOcrMessage] = useState("");
  const source = getArquivosSource();
  const viewerStudyResource = useMemo(() => (viewerResource ? getStudyResource(viewerResource) : null), [viewerResource]);
  const activeViewerResource = viewerStudyResource || viewerResource;
  const viewerPreview = useMemo(
    () => (viewerStudyResource ? buildViewerPreview(viewerStudyResource, viewerPage, viewerZoom, viewerSearchTerm) : null),
    [viewerPage, viewerSearchTerm, viewerStudyResource, viewerZoom]
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    Promise.all([listAppFileFolders(user), listAppFileResources(user)])
      .then(([loadedFolders, loadedResources]) => {
        if (!active) return;
        setFolders(loadedFolders);
        setResources(loadedResources);
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  async function refreshResources() {
    setResources(await listAppFileResources(user));
  }

  async function runLocalOcr() {
    setOcrRunning(true);
    setOcrMessage("");
    setError("");

    try {
      const response = await fetch("http://127.0.0.1:8787/process", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ limit: 5 })
      });
      const payload = (await response.json().catch(() => null)) as {
        ok?: boolean;
        stdout?: string;
        stderr?: string;
        error?: string;
      } | null;

      if (!response.ok || !payload?.ok) {
        throw new Error(payload?.error || "Agente OCR local nao respondeu.");
      }

      setOcrMessage(summarizeLocalOcrOutput([payload.stdout, payload.stderr].filter(Boolean).join("\n")));
      await refreshResources();
    } catch (ocrError) {
      const protocolTriggered = triggerOcrProtocol();

      if (protocolTriggered) {
        setOcrMessage(
          "OCR enviado ao Windows pelo protocolo hubocr://rodar. Se o Chrome pedir permissao, confirme para abrir o HUB OCR. Ao terminar, volte aqui e atualize a lista se necessario."
        );
        window.setTimeout(() => {
          void refreshResources();
        }, 15000);
      } else {
        setError(
          `${getErrorMessage(ocrError)} Registre o protocolo local com scripts\\registrar-protocolo-ocr.ps1 ou abra o agente local com INICIAR_OCR_HUB.cmd.`
        );
      }
    } finally {
      setOcrRunning(false);
    }
  }

  async function openViewer(resource: FileResource) {
    if (!resource.url && !resource.processedUrl) return;
    setViewerResource(resource);
    setViewerZoom(100);
    setViewerPage(1);
    setViewerPageTotal(0);
    setViewerQuery("");
    setViewerSearchTerm("");
    setViewerSearchIndex(0);
    setViewerSearchTotal(0);
    setViewerHighlight("");
    setViewerComment("");
    setViewerError("");
    setViewerFullscreen(false);
    setViewerNotes([]);
    setViewerLoading(true);

    try {
      setViewerNotes(await listAppFileAnnotations(resource.id, user));
    } catch (loadError) {
      setViewerError(getErrorMessage(loadError));
    } finally {
      setViewerLoading(false);
    }
  }

  useEffect(() => {
    if (!viewerResource) return;

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closeViewer();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewerResource]);

  function closeViewer() {
    setViewerResource(null);
    setViewerHighlight("");
    setViewerComment("");
    setViewerQuery("");
    setViewerSearchTerm("");
    setViewerSearchIndex(0);
    setViewerSearchTotal(0);
    setViewerPageTotal(0);
    setViewerError("");
    setViewerFullscreen(false);
  }

  function runViewerSearch() {
    const term = viewerQuery.trim();
    setViewerSearchIndex(0);
    setViewerSearchTotal(0);
    setViewerError("");

    if (!term) {
      setViewerSearchTerm("");
      return;
    }

    if (viewerStudyResource && !isPdfResource(viewerStudyResource) && !isDocxResource(viewerStudyResource)) {
      setViewerSearchTerm("");
      setViewerError("Busca interna com navegacao esta disponivel para PDF pesquisavel e DOCX convertido. Para PPTX, Excel, imagens ou links externos, abra em nova aba ou converta para PDF pesquisavel.");
      return;
    }

    setViewerSearchTerm(term);
  }

  const handleViewerSearchStats = useCallback((total: number) => {
    setViewerSearchTotal(total);
    setViewerSearchIndex((current) => (total ? Math.min(current, total - 1) : 0));
  }, []);

  const handleViewerPageCount = useCallback((total: number) => {
    setViewerPageTotal(total);
    setViewerPage((current) => (total ? Math.min(Math.max(1, current), total) : current));
  }, []);

  function moveViewerSearch(delta: number) {
    if (!viewerSearchTotal) return;
    setViewerSearchIndex((current) => (current + delta + viewerSearchTotal) % viewerSearchTotal);
  }

  async function addViewerNote(kind: FileViewerNoteKind) {
    if (!viewerResource) return;
    const text = (kind === "highlight" ? viewerHighlight : viewerComment).trim();
    if (!text) return;

    const now = new Date().toISOString();
    const note: FileViewerNote = {
      id: crypto.randomUUID(),
      resourceId: viewerResource.id,
      createdBy: user.id || user.email,
      userEmail: user.email,
      kind,
      text,
      page: viewerPage,
      createdAt: now,
      updatedAt: now
    };

    setViewerSaving(true);
    setViewerError("");
    try {
      setViewerNotes(await saveAppFileAnnotation(note, user));
      if (kind === "highlight") setViewerHighlight("");
      if (kind === "comment") setViewerComment("");
    } catch (saveError) {
      setViewerError(getErrorMessage(saveError));
    } finally {
      setViewerSaving(false);
    }
  }

  async function removeViewerNote(note: FileViewerNote) {
    if (!viewerResource) return;
    if (!canManageViewerNote(note)) return;
    setViewerSaving(true);
    setViewerError("");
    try {
      setViewerNotes(await deleteAppFileAnnotation(note, user));
    } catch (deleteError) {
      setViewerError(getErrorMessage(deleteError));
    } finally {
      setViewerSaving(false);
    }
  }

  async function removeSelectedHighlight() {
    const selectedText = viewerHighlight.trim();
    if (!selectedText) {
      setViewerError("Selecione no documento ou cole o trecho do grifo amarelo que deseja remover.");
      return;
    }

    const selected = normalizeForSearch(selectedText);
    const matchingNote = viewerNotes.find((note) => {
      if (note.kind !== "highlight" || !canManageViewerNote(note)) return false;
      const noteText = normalizeForSearch(note.text);
      return noteText === selected || noteText.includes(selected) || selected.includes(noteText);
    });

    if (!matchingNote) {
      setViewerError("Nenhum grifo amarelo salvo corresponde ao trecho selecionado.");
      return;
    }

    await removeViewerNote(matchingNote);
    setViewerHighlight("");
  }

  function canManageResource(resource: FileResource) {
    return user.role === "admin" || resource.createdBy === user.email || resource.createdBy === user.id;
  }

  function canManageViewerNote(note: FileViewerNote) {
    return user.role === "admin" || note.createdBy === user.id || note.createdBy === user.email || note.userEmail === user.email;
  }

  function exportViewerNotes() {
    if (!viewerResource || !viewerNotes.length) return;

    const markdown = buildViewerNotesMarkdown(viewerResource, viewerNotes);
    const blob = new Blob([markdown], { type: "text/markdown;charset=utf-8" });
    downloadBlob(blob, `${toSafeDownloadFileName(viewerResource.titulo || viewerResource.fileName || "arquivo")}-anotacoes.md`);
  }

  function canManageFolder(folder: FileFolder) {
    return user.role === "admin" || folder.createdBy === user.email || folder.createdBy === user.id;
  }

  const folderNames = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.nome])), [folders]);

  const visibleResources = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);

    return resources
      .filter((resource) => categoryFilter === "todos" || resource.categoria === categoryFilter)
      .filter((resource) => {
        if (folderFilter === "todos") return true;
        if (folderFilter === "sem-pasta") return !resource.folderId;
        return resource.folderId === folderFilter;
      })
      .filter((resource) => {
        if (!normalizedQuery) return true;
        return normalizeForSearch(
          [
            resource.titulo,
            resource.descricao,
            resource.url,
            resource.fileName,
            formatFileCategory(resource.categoria),
            folderNames.get(resource.folderId) || ""
          ].join(" ")
        ).includes(normalizedQuery);
      });
  }, [categoryFilter, folderFilter, folderNames, query, resources]);

  const totals = useMemo(
    () => ({
      drive: visibleResources.filter((resource) => resource.categoria === "drive").length,
      links: visibleResources.filter((resource) => resource.kind === "link").length,
      uploads: visibleResources.filter((resource) => resource.kind === "upload").length,
      global: visibleResources.filter((resource) => resource.scope === "global").length,
      pastas: folders.length,
      pessoal: visibleResources.filter((resource) => resource.scope === "privado").length,
      total: visibleResources.length
    }),
    [folders.length, visibleResources]
  );

  function resetFileForm() {
    setEditingId(null);
    setTitulo("");
    setDescricao("");
    setUrl("");
    setCategoria("drive");
    setScope(user.role === "admin" ? "global" : "privado");
    setFolderId("");
    setSelectedFiles([]);
    setError("");
  }

  function startEditResource(resource: FileResource) {
    if (!canManageResource(resource)) return;
    setEditingId(resource.id);
    setTitulo(resource.titulo);
    setDescricao(resource.descricao);
    setUrl(resource.kind === "link" ? resource.url : "");
    setCategoria(resource.categoria);
    setScope(resource.scope);
    setFolderId(resource.folderId);
    setSelectedFiles([]);
    setError("");
  }

  function handleSelectedFiles(files: FileList | File[]) {
    const nextFiles = Array.from(files);
    setSelectedFiles(nextFiles);
    if (nextFiles.length === 1 && !titulo.trim()) {
      setTitulo(nextFiles[0].name.replace(/\.[^.]+$/, ""));
    }
    if (nextFiles.length && categoria === "drive") {
      setCategoria("anexo");
    }
  }

  function buildResource(file?: File): FileResource {
    const now = new Date().toISOString();
    const shouldUseFileName = Boolean(file && (!titulo.trim() || selectedFiles.length > 1));
    const processingStatus = file ? getInitialFileProcessingStatus(file.name, file.type || "") : "none";
    return {
      id: crypto.randomUUID(),
      titulo: (shouldUseFileName ? file?.name.replace(/\.[^.]+$/, "") : titulo.trim()) || "Arquivo sem titulo",
      descricao: descricao.trim(),
      url: file ? "" : url.trim(),
      categoria,
      scope: user.role === "admin" ? scope : "privado",
      folderId,
      kind: file ? "upload" : "link",
      fileName: file?.name || "",
      storagePath: "",
      mimeType: file?.type || "",
      sizeBytes: file?.size || 0,
      processingStatus,
      processingMessage: processingStatus === "pending" ? "Aguardando conversao/OCR para versao pesquisavel." : "",
      processedUrl: "",
      processedFileName: "",
      processedStoragePath: "",
      processedMimeType: "",
      processedSizeBytes: 0,
      processedAt: "",
      createdBy: user.email,
      createdAt: now,
      updatedAt: now
    };
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError("");

    if (!titulo.trim() && !selectedFiles.length) {
      setError("Informe um titulo ou selecione um arquivo.");
      return;
    }

    const editingResource = editingId ? resources.find((resource) => resource.id === editingId) : null;
    if (!selectedFiles.length && !url.trim() && !editingResource?.storagePath) {
      setError("Informe uma URL ou envie um arquivo.");
      return;
    }

    setSaving(true);

    try {
      if (editingResource) {
        const file = selectedFiles[0] || null;
        const processingStatus = file ? getInitialFileProcessingStatus(file.name, file.type || "") : editingResource.processingStatus;
        const updated: FileResource = {
          ...editingResource,
          titulo: titulo.trim() || editingResource.titulo,
          descricao: descricao.trim(),
          url: file ? "" : url.trim() || editingResource.url,
          categoria,
          scope: user.role === "admin" ? scope : "privado",
          folderId,
          kind: file || editingResource.storagePath ? "upload" : "link",
          fileName: file?.name || editingResource.fileName,
          mimeType: file?.type || editingResource.mimeType,
          sizeBytes: file?.size || editingResource.sizeBytes,
          processingStatus,
          processingMessage: file && processingStatus === "pending" ? "Aguardando conversao/OCR para versao pesquisavel." : editingResource.processingMessage,
          processedUrl: file ? "" : editingResource.processedUrl,
          processedFileName: file ? "" : editingResource.processedFileName,
          processedStoragePath: file ? "" : editingResource.processedStoragePath,
          processedMimeType: file ? "" : editingResource.processedMimeType,
          processedSizeBytes: file ? 0 : editingResource.processedSizeBytes,
          processedAt: file ? "" : editingResource.processedAt,
          updatedAt: new Date().toISOString()
        };
        setResources(await saveAppFileResource(updated, user, file));
      } else if (selectedFiles.length) {
        let nextResources = resources;
        for (const file of selectedFiles) {
          nextResources = await saveAppFileResource(buildResource(file), user, file);
        }
        setResources(nextResources);
      } else {
        setResources(await saveAppFileResource(buildResource(), user));
      }

      resetFileForm();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function removeResource(resource: FileResource) {
    const target = resources.find((item) => item.id === resource.id);
    if (!target || !canManageResource(target)) return;
    setError("");
    setSaving(true);
    try {
      setResources(await deleteAppFileResource(target, user));
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  async function handleFolderSubmit(event: FormEvent) {
    event.preventDefault();
    if (!folderName.trim()) return;
    setError("");
    setSaving(true);

    const now = new Date().toISOString();
    const nextFolder: FileFolder = {
      id: crypto.randomUUID(),
      nome: folderName.trim(),
      descricao: folderDescription.trim(),
      scope: user.role === "admin" ? folderScope : "privado",
      createdBy: user.email,
      createdAt: now,
      updatedAt: now
    };

    try {
      setFolders(await saveAppFileFolder(nextFolder, user));
      setFolderName("");
      setFolderDescription("");
      setFolderScope(user.role === "admin" ? "global" : "privado");
    } catch (folderError) {
      setError(getErrorMessage(folderError));
    } finally {
      setSaving(false);
    }
  }

  async function removeFolder(folder: FileFolder) {
    if (!canManageFolder(folder)) return;
    setError("");
    setSaving(true);
    try {
      const nextFolders = await deleteAppFileFolder(folder.id, user);
      setFolders(nextFolders);
      if (folderFilter === folder.id) setFolderFilter("todos");
      if (folderId === folder.id) setFolderId("");
      await refreshResources();
    } catch (folderError) {
      setError(getErrorMessage(folderError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="split-page arquivos-page">
      <section className="panel arquivos-panel">
        <PanelHeader title="Arquivos" icon={<FileArchive size={18} />} action={loading ? "carregando" : source} />

        <div className="file-summary">
          <article>
            <strong>{totals.total}</strong>
            <span>Total visivel</span>
          </article>
          <article>
            <strong>{totals.uploads}</strong>
            <span>Uploads</span>
          </article>
          <article>
            <strong>{totals.links}</strong>
            <span>Links</span>
          </article>
          <article>
            <strong>{totals.pastas}</strong>
            <span>Pastas</span>
          </article>
        </div>

        {user.role === "admin" ? (
          <div className="ocr-runner-bar">
            <div>
              <strong>OCR local</strong>
              <span>Converte PDFs, PowerPoint, Word, Excel e imagens pendentes para versao pesquisavel.</span>
            </div>
            <button disabled={ocrRunning || loading} onClick={runLocalOcr} type="button">
              <RefreshCw size={14} />
              {ocrRunning ? "Rodando..." : "Rodar OCR"}
            </button>
          </div>
        ) : null}

        {ocrMessage ? <div className="module-notice">{ocrMessage}</div> : null}

        <div className="folder-strip">
          <button className={`folder-chip ${folderFilter === "todos" ? "active" : ""}`} onClick={() => setFolderFilter("todos")} type="button">
            Todas
          </button>
          <button className={`folder-chip ${folderFilter === "sem-pasta" ? "active" : ""}`} onClick={() => setFolderFilter("sem-pasta")} type="button">
            Sem pasta
          </button>
          {folders.map((folder) => (
            <button
              className={`folder-chip ${folderFilter === folder.id ? "active" : ""}`}
              key={folder.id}
              onClick={() => setFolderFilter(folder.id)}
              type="button"
            >
              {folder.nome}
            </button>
          ))}
        </div>

        <div className="panel-toolbar">
          {fileCategoryOptions.map((option) => (
            <button
              className={`filter-pill ${categoryFilter === option.value ? "active" : ""}`}
              key={option.value}
              onClick={() => setCategoryFilter(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
          <label className="panel-search">
            <Search size={14} />
            <input aria-label="Buscar arquivos" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." value={query} />
          </label>
        </div>

        {error ? <div className="form-error">{error}</div> : null}

        <div className="file-resource-list">
          {visibleResources.map((resource) => {
            const processingBadge = getProcessingBadge(resource);
            return (
              <article className="file-resource" key={resource.id}>
                <div className="file-resource__content">
                  <div className="file-resource__label">
                    <FileArchive size={14} />
                    <span>{resource.kind === "upload" ? "Upload" : formatFileCategory(resource.categoria)}</span>
                  </div>
                  <div className="file-resource__body">
                    <strong>{resource.titulo}</strong>
                    <p>{resource.descricao || "Sem descricao"}</p>
                  </div>
                  <div className="file-resource__meta">
                    <span>
                      {resource.scope === "global" ? "Global" : "Pessoal"} - {folderNames.get(resource.folderId) || "Sem pasta"} -{" "}
                      {formatDate(resource.createdAt)}
                    </span>
                    {resource.fileName ? <span>{resource.fileName}</span> : null}
                    {processingBadge ? (
                      <span className={`processing-badge processing-badge--${processingBadge.tone}`}>{processingBadge.label}</span>
                    ) : null}
                    {resource.processingMessage ? <span>{resource.processingMessage}</span> : null}
                  </div>
                </div>
                <div className="record-actions">
                  {resource.url || resource.processedUrl ? (
                    <button type="button" onClick={() => openViewer(resource)}>
                      <Search size={14} />
                      Visualizar
                    </button>
                  ) : (
                    <button disabled type="button">
                      <Search size={14} />
                      Visualizar
                    </button>
                  )}
                {resource.url ? (
                  <a href={resource.url} rel="noreferrer" target="_blank">
                    <Link2 size={14} />
                    Abrir
                  </a>
                  ) : (
                    <button disabled type="button">
                      <Link2 size={14} />
                    Abrir
                  </button>
                )}
                {resource.processedUrl ? (
                  <a href={resource.processedUrl} rel="noreferrer" target="_blank">
                    <Search size={14} />
                    Abrir estudo
                  </a>
                ) : null}
                {canManageResource(resource) ? (
                  <>
                      <button type="button" onClick={() => startEditResource(resource)}>
                        <Edit3 size={14} />
                        Editar
                      </button>
                      <button className="danger-action" disabled={saving} type="button" onClick={() => removeResource(resource)}>
                        <Trash2 size={14} />
                        Excluir
                      </button>
                    </>
                  ) : (
                    <span className="record-actions--readonly">Somente leitura</span>
                  )}
                </div>
              </article>
            );
          })}
          {!visibleResources.length ? (
            <div className="empty-state">
              Nenhum arquivo ou atalho cadastrado para o filtro atual.
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel narrow-panel arquivos-form-panel">
        <PanelHeader title={editingId ? "Editar arquivo" : "Novo arquivo"} icon={<Paperclip size={18} />} action={user.role === "admin" ? "global/pessoal" : "pessoal"} />
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Titulo
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" />
          </label>
          <label>
            Pasta
            <select value={folderId} onChange={(event) => setFolderId(event.target.value)}>
              <option value="">Sem pasta</option>
              {folders.map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {folder.nome}
                </option>
              ))}
            </select>
          </label>
          <label>
            Categoria
            <select value={categoria} onChange={(event) => setCategoria(event.target.value as FileResourceCategory)}>
              <option value="drive">Google Drive</option>
              <option value="modelo">Modelo</option>
              <option value="guia">Guia</option>
              <option value="anexo">Anexo</option>
              <option value="outro">Outro</option>
            </select>
          </label>
          {user.role === "admin" ? (
            <label>
              Escopo
              <select value={scope} onChange={(event) => setScope(event.target.value as "privado" | "global")}>
                <option value="global">Global</option>
                <option value="privado">Pessoal</option>
              </select>
            </label>
          ) : null}
          <label>
            Descricao
            <textarea value={descricao} onChange={(event) => setDescricao(event.target.value)} />
          </label>
          <label
            className={`drop-zone ${dropActive ? "drop-zone--active" : ""}`}
            onDragLeave={() => setDropActive(false)}
            onDragOver={(event) => {
              event.preventDefault();
              setDropActive(true);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDropActive(false);
              handleSelectedFiles(event.dataTransfer.files);
            }}
          >
            <input multiple onChange={(event) => event.target.files && handleSelectedFiles(event.target.files)} type="file" />
            <Paperclip size={19} />
            <span>
              <strong>Arraste arquivos aqui</strong>
              <small>Ou clique para selecionar documentos para a biblioteca.</small>
            </span>
          </label>

          {selectedFiles.length ? (
            <div className="attachment-list">
              {selectedFiles.map((file) => (
                <span key={`${file.name}-${file.size}`}>{file.name}</span>
              ))}
              <button type="button" onClick={() => setSelectedFiles([])}>
                <X size={13} />
                Limpar
              </button>
            </div>
          ) : null}

          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingId ? "Atualizar arquivo" : "Salvar arquivo"}
            </button>
            {editingId ? (
              <button disabled={saving} type="button" onClick={resetFileForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>

        <form className="stack-form folder-form" onSubmit={handleFolderSubmit}>
          <strong>Nova pasta</strong>
          <label>
            Nome da pasta
            <input value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          </label>
          {user.role === "admin" ? (
            <label>
              Escopo
              <select value={folderScope} onChange={(event) => setFolderScope(event.target.value as FileResourceScope)}>
                <option value="global">Global</option>
                <option value="privado">Pessoal</option>
              </select>
            </label>
          ) : null}
          <label>
            Descricao
            <textarea value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} />
          </label>
          <button disabled={saving} type="submit">
            Criar pasta
          </button>
          {folders.length ? (
            <div className="folder-manage-list">
              {folders.map((folder) => (
                <span key={folder.id}>
                  {folder.nome}
                  {canManageFolder(folder) ? (
                    <button aria-label={`Excluir pasta ${folder.nome}`} disabled={saving} onClick={() => removeFolder(folder)} type="button">
                      <X size={12} />
                    </button>
                  ) : null}
                </span>
              ))}
            </div>
          ) : null}
        </form>
      </section>

      {viewerResource ? (
        <div
          className={`document-viewer-backdrop ${viewerFullscreen ? "document-viewer-backdrop--fullscreen" : ""}`}
          role="dialog"
          aria-modal="true"
          aria-label={`Visualizador de ${viewerResource.titulo}`}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) closeViewer();
          }}
        >
          <section className={`document-viewer-panel ${viewerFullscreen ? "document-viewer-panel--fullscreen" : ""}`}>
            <header className="document-viewer-header">
              <div>
                <span>
                  {activeViewerResource?.fileName || formatFileCategory(viewerResource.categoria)}
                  {viewerResource.processingStatus === "ready" && viewerResource.processedFileName ? " - versao para estudo" : ""}
                </span>
                <h2>{viewerResource.titulo}</h2>
              </div>
              <button aria-label="Fechar visualizador" className="document-viewer-close" type="button" onClick={closeViewer}>
                <X size={19} />
                Fechar
              </button>
            </header>

            <div className="document-viewer-toolbar">
              <button type="button" onClick={() => setViewerZoom((current) => Math.max(50, current - 10))}>
                -
              </button>
              <strong>{viewerZoom}%</strong>
              <button type="button" onClick={() => setViewerZoom((current) => Math.min(200, current + 10))}>
                +
              </button>
              <button aria-label="Pagina anterior" disabled={viewerPage <= 1} type="button" onClick={() => setViewerPage((current) => Math.max(1, current - 1))}>
                <ChevronLeft size={14} />
              </button>
              <label>
                Pagina
                <input
                  max={viewerPageTotal || undefined}
                  min={1}
                  type="number"
                  value={viewerPage}
                  onChange={(event) => {
                    const nextPage = Math.max(1, Number(event.target.value) || 1);
                    setViewerPage(viewerPageTotal ? Math.min(nextPage, viewerPageTotal) : nextPage);
                  }}
                />
              </label>
              <span className="document-search-count">{viewerPageTotal ? `de ${viewerPageTotal}` : "de -"}</span>
              <button
                aria-label="Proxima pagina"
                disabled={Boolean(viewerPageTotal && viewerPage >= viewerPageTotal)}
                type="button"
                onClick={() => setViewerPage((current) => (viewerPageTotal ? Math.min(viewerPageTotal, current + 1) : current + 1))}
              >
                <ChevronRight size={14} />
              </button>
              <label className="document-viewer-search">
                <Search size={14} />
                <input
                  value={viewerQuery}
                  onChange={(event) => setViewerQuery(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      runViewerSearch();
                    }
                  }}
                  placeholder="Pesquisar no documento..."
                />
              </label>
              <button type="button" onClick={runViewerSearch}>
                Pesquisar
              </button>
              <button aria-label="Resultado anterior da busca" disabled={!viewerSearchTotal} type="button" onClick={() => moveViewerSearch(-1)}>
                <ChevronLeft size={14} />
              </button>
              <span className="document-search-count">{viewerSearchTerm ? `${viewerSearchTotal ? viewerSearchIndex + 1 : 0}/${viewerSearchTotal}` : "0/0"}</span>
              <button aria-label="Proximo resultado da busca" disabled={!viewerSearchTotal} type="button" onClick={() => moveViewerSearch(1)}>
                <ChevronRight size={14} />
              </button>
              <button type="button" onClick={() => setViewerFullscreen((current) => !current)}>
                {viewerFullscreen ? "Sair da tela cheia" : "Tela cheia HUB"}
              </button>
              <a href={activeViewerResource?.url || viewerResource.url} rel="noreferrer" target="_blank">
                Abrir em nova aba
              </a>
            </div>

            <div className="document-viewer-body">
              <div className={`document-preview ${viewerPreview?.notice ? "document-preview--with-banner" : ""}`}>
                {viewerPreview?.notice ? <div className="document-preview-banner">{viewerPreview.notice}</div> : null}
                {activeViewerResource && isPdfResource(activeViewerResource) ? (
                  <InternalPdfViewer
                    highlightNotes={viewerNotes.filter((note) => note.kind === "highlight")}
                    page={viewerPage}
                    resource={activeViewerResource}
                    searchIndex={viewerSearchIndex}
                    searchTerm={viewerSearchTerm}
                    zoom={viewerZoom}
                    onPageCount={handleViewerPageCount}
                    onRequestPage={setViewerPage}
                    onSearchStats={handleViewerSearchStats}
                    onSelectText={setViewerHighlight}
                  />
                ) : activeViewerResource && isDocxResource(activeViewerResource) ? (
                  <InternalDocxViewer
                    highlightNotes={viewerNotes.filter((note) => note.kind === "highlight")}
                    resource={activeViewerResource}
                    searchIndex={viewerSearchIndex}
                    searchTerm={viewerSearchTerm}
                    onSearchStats={handleViewerSearchStats}
                    onSelectText={setViewerHighlight}
                  />
                ) : viewerPreview?.mode === "image" ? (
                  <div className="document-preview__image-scroll">
                    <img
                      alt={activeViewerResource?.titulo || viewerResource.titulo}
                      src={viewerPreview.src}
                      style={{ width: `${viewerZoom}%`, maxWidth: viewerZoom > 100 ? "none" : "100%" }}
                    />
                  </div>
                ) : viewerPreview?.mode === "iframe" ? (
                  <iframe src={viewerPreview.src} title={viewerPreview.title} />
                ) : (
                  <div className="document-preview-fallback">
                    <FileArchive size={38} />
                    <h3>Previa interna indisponivel</h3>
                    <p>{viewerPreview?.detail || "Este arquivo ou link nao permite visualizacao embutida no painel."}</p>
                    <a href={activeViewerResource?.url || viewerResource.url} rel="noreferrer" target="_blank">
                      <Link2 size={15} />
                      Abrir em nova aba
                    </a>
                  </div>
                )}
              </div>

              <aside className="document-study-panel">
                <div>
                  <span className="panel-chip">Estudo do documento</span>
                  <h3>Grifos e comentarios</h3>
                </div>
                <div className="viewer-note-actions">
                  <button disabled={!viewerNotes.length} type="button" onClick={exportViewerNotes}>
                    Exportar notas
                  </button>
                </div>

                {viewerError ? <div className="form-error">{viewerError}</div> : null}
                {viewerLoading ? <p className="muted-note">Carregando anotacoes...</p> : null}

                <label>
                  Grifo amarelo
                  <textarea
                    value={viewerHighlight}
                    onChange={(event) => setViewerHighlight(event.target.value)}
                    placeholder="Selecione um trecho no documento ou cole o texto a grifar."
                  />
                  <small className="field-note">
                    O grifo manual fica amarelo no texto renderizado internamente. A busca usa verde e nao cria anotacao salva.
                  </small>
                </label>
                <div className="viewer-note-actions">
                  <button disabled={viewerSaving} type="button" onClick={() => addViewerNote("highlight")}>
                    {viewerSaving ? "Salvando..." : "Salvar grifo"}
                  </button>
                  <button className="button-danger-soft" disabled={viewerSaving || !viewerHighlight.trim()} type="button" onClick={removeSelectedHighlight}>
                    Remover grifo selecionado
                  </button>
                </div>

                <label>
                  Comentario
                  <textarea
                    value={viewerComment}
                    onChange={(event) => setViewerComment(event.target.value)}
                    placeholder="Registre observacoes, riscos ou pontos de estudo."
                  />
                </label>
                <button disabled={viewerSaving} type="button" onClick={() => addViewerNote("comment")}>
                  {viewerSaving ? "Salvando..." : "Adicionar comentario"}
                </button>

                <div className="viewer-note-list">
                  {viewerNotes.map((note) => (
                    <article className={`viewer-note viewer-note--${note.kind}`} key={note.id}>
                      <small>
                        Pag. {note.page} - {formatDate(note.createdAt)} - {note.userEmail}
                      </small>
                      <p>{note.text}</p>
                      {canManageViewerNote(note) ? (
                        <button disabled={viewerSaving} type="button" onClick={() => removeViewerNote(note)}>
                          Remover
                        </button>
                      ) : null}
                    </article>
                  ))}
                  {!viewerNotes.length ? <p className="muted-note">Nenhum grifo ou comentario salvo para este arquivo.</p> : null}
                </div>
              </aside>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function InternalPdfViewer({
  highlightNotes,
  onPageCount,
  onRequestPage,
  onSearchStats,
  onSelectText,
  page,
  resource,
  searchIndex,
  searchTerm,
  zoom
}: {
  highlightNotes: FileViewerNote[];
  onPageCount: (total: number) => void;
  onRequestPage: (page: number) => void;
  onSearchStats: (total: number) => void;
  onSelectText: (text: string) => void;
  page: number;
  resource: FileResource;
  searchIndex: number;
  searchTerm: string;
  zoom: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderTaskRef = useRef<{ cancel: () => void; promise: Promise<unknown> } | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [spans, setSpans] = useState<PdfTextSpan[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [globalSearchMatches, setGlobalSearchMatches] = useState<PdfGlobalSearchMatch[]>([]);
  const [globalSearchTerm, setGlobalSearchTerm] = useState("");
  const highlightTerms = useMemo(() => getViewerManualHighlightTerms(highlightNotes), [highlightNotes]);
  const normalizedSearchTerm = normalizeForSearch(searchTerm);
  const searchOffset = useMemo(() => getPdfSearchOffset(globalSearchMatches, page), [globalSearchMatches, page]);
  const searchPlan = useMemo(() => buildPdfSearchPlan(spans, normalizedSearchTerm, searchOffset), [normalizedSearchTerm, searchOffset, spans]);

  useEffect(() => {
    if (!normalizedSearchTerm) {
      setGlobalSearchMatches([]);
      setGlobalSearchTerm("");
      setSearchError("");
      setSearchLoading(false);
      onSearchStats(0);
      return;
    }

    let active = true;
    setSearchLoading(true);
    setSearchError("");
    setGlobalSearchTerm(normalizedSearchTerm);
    setGlobalSearchMatches([]);

    async function collectPdfMatches() {
      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Nao foi possivel carregar o PDF para pesquisar todas as paginas.");
        const bytes = await response.arrayBuffer();
        const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (active) onPageCount(document.numPages);

        const matches: PdfGlobalSearchMatch[] = [];
        for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
          if (!active) return;
          const pdfPage = await document.getPage(pageNumber);
          const textContent = await pdfPage.getTextContent();
          const matchCount = countPdfTextContentMatches(textContent.items as PdfTextRawItem[], normalizedSearchTerm);

          for (let matchNumber = 0; matchNumber < matchCount; matchNumber += 1) {
            matches.push({ page: pageNumber, globalIndex: matches.length });
          }
        }

        if (!active) return;
        setGlobalSearchMatches(matches);
        onSearchStats(matches.length);
        if (matches.length) onRequestPage(matches[0].page);
      } catch (searchErrorValue) {
        if (!active) return;
        setSearchError(getErrorMessage(searchErrorValue));
        setGlobalSearchMatches([]);
        onSearchStats(0);
      } finally {
        if (active) setSearchLoading(false);
      }
    }

    collectPdfMatches();

    return () => {
      active = false;
    };
  }, [normalizedSearchTerm, onPageCount, onRequestPage, onSearchStats, resource.url]);

  useEffect(() => {
    if (!normalizedSearchTerm) return;
    const activeMatch = globalSearchMatches[searchIndex];
    if (activeMatch && activeMatch.page !== page) {
      onRequestPage(activeMatch.page);
      return;
    }

    const target = containerRef.current?.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [globalSearchMatches, normalizedSearchTerm, onRequestPage, page, searchIndex]);

  useEffect(() => {
    let active = true;
    let cancelled = false;

    async function renderPdf() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const previousRenderTask = renderTaskRef.current;
      if (previousRenderTask) {
        previousRenderTask.cancel();
        renderTaskRef.current = null;
        try {
          await previousRenderTask.promise;
        } catch {
          // Expected when PDF.js cancels an in-flight render before redrawing zoom/page.
        }
        if (!active) return;
      }
      setLoading(true);
      setError("");
      setSpans([]);
      setPageSize({ width: 0, height: 0 });

      try {
        const pdfjs = await import("pdfjs-dist");
        pdfjs.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Nao foi possivel carregar o PDF para estudo interno.");
        const bytes = await response.arrayBuffer();
        const document = await pdfjs.getDocument({ data: new Uint8Array(bytes) }).promise;
        if (!active || cancelled) return;
        if (active) onPageCount(document.numPages);
        const safePage = Math.min(Math.max(1, page), document.numPages);
        const pdfPage = await document.getPage(safePage);
        if (!active || cancelled) return;
        const scale = Math.max(0.6, Math.min(2.4, zoom / 100)) * 1.35;
        const viewport = pdfPage.getViewport({ scale });
        const context = canvas.getContext("2d");
        const textLayerElement = textLayerRef.current;
        if (!context) throw new Error("Canvas indisponivel para renderizar PDF.");
        if (!active || cancelled) return;

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        if (active) setPageSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });

        const renderTask = pdfPage.render({ canvasContext: context, viewport });
        renderTaskRef.current = renderTask;
        await renderTask.promise;
        if (renderTaskRef.current === renderTask) renderTaskRef.current = null;
        if (!active || cancelled) return;
        const textContent = await pdfPage.getTextContent();
        if (textLayerElement) {
          textLayerElement.innerHTML = "";
          textLayerElement.style.width = `${Math.floor(viewport.width)}px`;
          textLayerElement.style.height = `${Math.floor(viewport.height)}px`;
          textLayerElement.style.setProperty("--scale-factor", String(scale));
          let nextSpans: PdfTextSpan[] = [];
          try {
            const textLayer = new pdfjs.TextLayer({
              container: textLayerElement,
              textContentSource: textContent,
              viewport
            });
            await textLayer.render();

            nextSpans = textLayer.textDivs
              .map((element: HTMLElement, index: number) => {
                const text = textLayer.textContentItemsStr[index] || element.textContent || "";
                const id = `${safePage}-${index}`;
                element.dataset.pdfTextIndex = id;
                return { id, text };
              })
              .filter((span: PdfTextSpan) => span.text.trim());
          } catch {
            nextSpans = [];
          }

          if (!nextSpans.length) {
            nextSpans = renderManualPdfTextLayer(
              pdfjs as PdfJsLike,
              textLayerElement,
              textContent.items as PdfTextRawItem[],
              viewport as PdfViewportLike,
              safePage
            );
          }

          if (active) setSpans(nextSpans);
        }
      } catch (renderError) {
        if (active && !isPdfRenderCancelled(renderError)) setError(getErrorMessage(renderError));
      } finally {
        renderTaskRef.current = null;
        if (active) setLoading(false);
      }
    }

    renderPdf();

    return () => {
      active = false;
      cancelled = true;
      renderTaskRef.current?.cancel();
      renderTaskRef.current = null;
    };
  }, [onPageCount, page, resource.url, zoom]);

  useEffect(() => {
    const layer = textLayerRef.current;
    if (!layer) return;

    for (const element of Array.from(layer.querySelectorAll<HTMLElement>("[data-pdf-text-index]"))) {
      element.classList.remove("pdf-text-span--highlighted", "pdf-text-span--search", "pdf-text-span--search-active");
    }

    for (const span of spans) {
      const element = layer.querySelector<HTMLElement>(`[data-pdf-text-index="${span.id}"]`);
      if (!element) continue;

      const matchIndex = searchPlan.indexesBySpanId.get(span.id);
      if (isTextHighlightedByTerms(span.text, highlightTerms)) element.classList.add("pdf-text-span--highlighted");
      if (matchIndex !== undefined) {
        element.classList.add("pdf-text-span--search");
        element.dataset.searchIndex = String(matchIndex);
      } else {
        delete element.dataset.searchIndex;
      }
      if (matchIndex === searchIndex) element.classList.add("pdf-text-span--search-active");
    }
  }, [highlightTerms, searchIndex, searchPlan, spans]);

  function handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || "";
    const anchorNode = selection?.anchorNode;
    if (selectedText && anchorNode && containerRef.current?.contains(anchorNode)) {
      onSelectText(selectedText);
    }
  }

  return (
    <div className="internal-doc-viewer" onMouseUp={handleSelection} ref={containerRef}>
      {loading ? <div className="document-preview-banner">Renderizando PDF para estudo interno...</div> : null}
      {searchLoading ? <div className="document-preview-banner">Pesquisando em todas as paginas do PDF...</div> : null}
      {searchError && globalSearchTerm === normalizedSearchTerm ? (
        <div className="document-preview-banner document-preview-banner--error">{searchError}</div>
      ) : null}
      {error ? (
        <div className="document-preview-fallback">
          <FileArchive size={38} />
          <h3>PDF nao renderizado internamente</h3>
          <p>{error}</p>
          <a href={resource.url} rel="noreferrer" target="_blank">
            <Link2 size={15} />
            Abrir em nova aba
          </a>
        </div>
      ) : (
        <div className="pdf-page-shell">
          <div className="pdf-page-content" style={{ width: pageSize.width || undefined, height: pageSize.height || undefined }}>
            <canvas ref={canvasRef} />
            <div className="pdf-text-layer textLayer" ref={textLayerRef} />
          </div>
          {!loading && !spans.length ? (
            <div className="document-preview-banner document-preview-banner--floating">
              Nao foi encontrada camada de texto neste PDF. Para grifar trechos, use OCR ou uma versao pesquisavel do arquivo.
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function getPdfSearchOffset(matches: PdfGlobalSearchMatch[], page: number) {
  if (!matches.length) return 0;
  return matches.filter((match) => match.page < page).length;
}

function countPdfTextContentMatches(items: PdfTextRawItem[], normalizedSearchTerm: string) {
  if (!normalizedSearchTerm) return 0;
  const normalizedItems = items.map((item) => normalizeForSearch(item.str || "")).filter(Boolean);
  if (!normalizedItems.length) return 0;

  const spacedText = normalizedItems.join(" ");
  const compactText = normalizedItems.join("");
  const compactTerm = normalizedSearchTerm.replace(/\s+/g, "");

  return Math.max(
    countNormalizedTermMatches(spacedText, normalizedSearchTerm),
    compactTerm ? countNormalizedTermMatches(compactText, compactTerm) : 0
  );
}

function countNormalizedTermMatches(text: string, term: string) {
  if (!text || !term) return 0;
  let total = 0;
  let index = text.indexOf(term);
  while (index >= 0) {
    total += 1;
    index = text.indexOf(term, index + Math.max(1, term.length));
  }
  return total;
}

function buildPdfSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string, startIndex = 0): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  if (!normalizedSearchTerm) return { total: 0, indexesBySpanId };

  let total = 0;
  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

    let index = normalizedText.indexOf(normalizedSearchTerm);
    while (index >= 0) {
      if (!indexesBySpanId.has(span.id)) indexesBySpanId.set(span.id, startIndex + total);
      total += 1;
      index = normalizedText.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
    }
  }

  if (total) return { total, indexesBySpanId };

  return buildPdfCombinedSearchPlan(spans, normalizedSearchTerm, startIndex, " ");
}

function buildPdfCombinedSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string, startIndex = 0, separator = ""): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  let text = "";
  const ranges: Array<{ end: number; id: string; start: number }> = [];

  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

    if (separator && text) text += separator;
    const start = text.length;
    text += normalizedText;
    ranges.push({ id: span.id, start, end: text.length });
  }

  let total = 0;
  let index = text.indexOf(normalizedSearchTerm);
  while (index >= 0) {
    const end = index + normalizedSearchTerm.length;
    for (const range of ranges) {
      if (range.end <= index || range.start >= end) continue;
      if (!indexesBySpanId.has(range.id)) indexesBySpanId.set(range.id, startIndex + total);
    }
    total += 1;
    index = text.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
  }

  if (total || !separator) return { total, indexesBySpanId };

  return buildPdfCombinedSearchPlan(spans, normalizedSearchTerm.replace(/\s+/g, ""), startIndex);
}

function renderManualPdfTextLayer(
  pdfjs: PdfJsLike,
  textLayerElement: HTMLDivElement,
  items: PdfTextRawItem[],
  viewport: PdfViewportLike,
  page: number
) {
  const spans: PdfTextSpan[] = [];
  const measureCanvas = document.createElement("canvas");
  const measureContext = measureCanvas.getContext("2d");

  textLayerElement.innerHTML = "";

  items.forEach((item, index) => {
    const text = item.str || "";
    if (!text.trim() || !Array.isArray(item.transform)) return;

    const transform = pdfjs.Util.transform(viewport.transform, item.transform);
    const angle = Math.atan2(transform[1], transform[0]);
    const fontHeight = Math.max(6, Math.hypot(transform[2], transform[3]));
    const left = transform[4];
    const top = transform[5] - fontHeight * 0.82;
    const span = document.createElement("span");
    const id = `${page}-${index}`;

    span.dataset.pdfTextIndex = id;
    span.setAttribute("role", "presentation");
    span.textContent = text;
    span.dir = item.dir || "ltr";
    span.style.left = `${left}px`;
    span.style.top = `${top}px`;
    span.style.fontSize = `${fontHeight}px`;
    span.style.fontFamily = "Arial, Helvetica, sans-serif";

    const expectedWidth = typeof item.width === "number" ? item.width * viewport.scale : 0;
    if (measureContext && expectedWidth > 0) {
      measureContext.font = `${fontHeight}px Arial, Helvetica, sans-serif`;
      const measuredWidth = measureContext.measureText(text).width;
      const scaleX = measuredWidth ? expectedWidth / measuredWidth : 1;
      span.style.transform = `${Math.abs(angle) > 0.001 ? `rotate(${angle}rad) ` : ""}scaleX(${Math.max(0.2, scaleX)})`;
    } else if (Math.abs(angle) > 0.001) {
      span.style.transform = `rotate(${angle}rad)`;
    }

    textLayerElement.append(span);
    spans.push({ id, text });

    if (item.hasEOL) {
      const lineBreak = document.createElement("br");
      lineBreak.setAttribute("role", "presentation");
      textLayerElement.append(lineBreak);
    }
  });

  return spans;
}

function InternalDocxViewer({
  highlightNotes,
  onSearchStats,
  onSelectText,
  resource,
  searchIndex,
  searchTerm
}: {
  highlightNotes: FileViewerNote[];
  onSearchStats: (total: number) => void;
  onSelectText: (text: string) => void;
  resource: FileResource;
  searchIndex: number;
  searchTerm: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const highlightTerms = useMemo(() => getViewerManualHighlightTerms(highlightNotes), [highlightNotes]);
  const markedContent = useMemo(() => markHtmlWithTerms(html, highlightTerms, searchTerm), [highlightTerms, html, searchTerm]);

  useEffect(() => {
    onSearchStats(markedContent.searchCount);
  }, [markedContent.searchCount, onSearchStats]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root || !markedContent.searchCount) return;

    root.querySelectorAll(".doc-search-highlight--active").forEach((element) => element.classList.remove("doc-search-highlight--active"));
    const target = root.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.classList.add("doc-search-highlight--active");
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [markedContent.html, markedContent.searchCount, searchIndex]);

  useEffect(() => {
    let active = true;

    async function renderDocx() {
      setLoading(true);
      setError("");
      setHtml("");

      try {
        const mammothModule = await import("mammoth");
        const mammothLib = mammothModule.default;
        const response = await fetch(resource.url);
        if (!response.ok) throw new Error("Nao foi possivel carregar o DOCX para estudo interno.");
        const arrayBuffer = await response.arrayBuffer();
        const result = await mammothLib.convertToHtml(
          { arrayBuffer },
          {
            convertImage: mammothLib.images.dataUri,
            ignoreEmptyParagraphs: false
          }
        );
        if (active) setHtml(result.value || "<p>Documento sem texto convertido.</p>");
      } catch (renderError) {
        if (active) setError(getErrorMessage(renderError));
      } finally {
        if (active) setLoading(false);
      }
    }

    renderDocx();

    return () => {
      active = false;
    };
  }, [resource.url]);

  function handleSelection() {
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim() || "";
    const anchorNode = selection?.anchorNode;
    if (selectedText && anchorNode && containerRef.current?.contains(anchorNode)) {
      onSelectText(selectedText);
    }
  }

  if (error) {
    return (
      <div className="document-preview-fallback">
        <FileArchive size={38} />
        <h3>DOCX nao convertido internamente</h3>
        <p>{error}</p>
        <a href={resource.url} rel="noreferrer" target="_blank">
          <Link2 size={15} />
          Abrir em nova aba
        </a>
      </div>
    );
  }

  return (
    <div className="internal-doc-viewer internal-doc-viewer--docx" onMouseUp={handleSelection} ref={containerRef}>
      {loading ? <div className="document-preview-banner">Convertendo DOCX para estudo interno...</div> : null}
      <article className="docx-rendered" dangerouslySetInnerHTML={{ __html: markedContent.html }} />
    </div>
  );
}

function isImageResource(resource: FileResource) {
  return resource.mimeType.startsWith("image/") || /\.(png|jpe?g|gif|webp|bmp)$/i.test(resource.fileName || resource.url);
}

function getStudyResource(resource: FileResource): FileResource {
  if (resource.processingStatus !== "ready" || !resource.processedUrl) return resource;

  return {
    ...resource,
    url: resource.processedUrl,
    fileName: resource.processedFileName || resource.fileName,
    storagePath: resource.processedStoragePath || resource.storagePath,
    mimeType: resource.processedMimeType || "application/pdf",
    sizeBytes: resource.processedSizeBytes || resource.sizeBytes
  };
}

function getInitialFileProcessingStatus(fileName: string, mimeType: string): FileResource["processingStatus"] {
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

function getProcessingBadge(resource: FileResource) {
  const status = resource.processingStatus || "none";
  if (status === "none") return null;

  const labels: Record<FileResource["processingStatus"], string> = {
    none: "",
    pending: "OCR/conversao pendente",
    processing: "Processando OCR",
    ready: "Versao pesquisavel pronta",
    error: "Falha no OCR"
  };

  return {
    label: labels[status],
    tone: status
  };
}

function buildViewerPreview(resource: FileResource, page: number, zoom: number, query: string): ViewerPreview {
  if (!resource.url) {
    return {
      mode: "unsupported",
      src: "",
      title: resource.titulo,
      detail: "O registro nao possui URL ou arquivo anexado disponivel para visualizacao."
    };
  }

  if (isImageResource(resource)) {
    return {
      mode: "image",
      src: resource.url,
      title: resource.titulo
    };
  }

  if (isPdfResource(resource)) {
    return {
      mode: "iframe",
      src: buildPdfViewerUrl(resource, page, zoom, query),
      title: resource.titulo,
      notice:
        resource.processingStatus === "ready"
          ? "Abrindo a versao processada para estudo, com PDF pesquisavel quando o OCR/conversao estiver completo."
          : query
            ? "Pesquisa aplicada a camada de texto do PDF. Se o arquivo for escaneado ou imagem, use OCR para permitir busca/grifo."
            : "PDF renderizado internamente com PDF.js para permitir selecao de texto e grifo visual quando houver camada de texto."
    };
  }

  if (isDocxResource(resource)) {
    return {
      mode: "iframe",
      src: "",
      title: resource.titulo,
      notice: query
        ? "Pesquisa aplicada ao DOCX convertido internamente. Selecione um trecho do texto para salvar como grifo."
        : "DOCX convertido internamente para permitir selecao de texto e grifo visual no conteudo renderizado."
    };
  }

  const googleDrivePreview = buildGoogleDrivePreviewUrl(resource.url);
  if (googleDrivePreview) {
    return {
      mode: "iframe",
      src: googleDrivePreview,
      title: resource.titulo,
      notice: "Google Drive pode exigir permissao de acesso. Busca e selecao de texto dependem do preview do Google."
    };
  }

  if (isGoogleDriveFolderUrl(resource.url)) {
    return {
      mode: "unsupported",
      src: "",
      title: resource.titulo,
      detail: "Pastas do Google Drive normalmente bloqueiam visualizacao embutida. Abra em nova aba para acessar com sua conta Google."
    };
  }

  if (isOfficeResource(resource)) {
    return {
      mode: "iframe",
      src: `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(resource.url)}`,
      title: resource.titulo,
      notice:
        resource.processingStatus === "pending" || resource.processingStatus === "processing"
          ? "Arquivo aguardando conversao/OCR para PDF pesquisavel. Enquanto isso, o preview usa Office externo e nao permite busca/grifo interno."
          : "Arquivos Word, Excel e PowerPoint usam o visualizador do Office. Busca, selecao e grifo direto dependem desse preview externo."
    };
  }

  if (isTextLikeResource(resource) || isEmbeddableWebUrl(resource.url)) {
    return {
      mode: "iframe",
      src: resource.url,
      title: resource.titulo,
      notice: "Alguns sites bloqueiam visualizacao embutida por seguranca. Busca e selecao podem nao funcionar dentro do painel."
    };
  }

  return {
    mode: "unsupported",
    src: "",
    title: resource.titulo,
    detail: "Tipo de arquivo sem pre-visualizacao interna. Use Abrir em nova aba para consultar o documento."
  };
}

function buildPdfViewerUrl(resource: FileResource, page: number, zoom: number, query: string) {
  if (!resource.url) return "";

  const cleanUrl = resource.url.split("#")[0];
  const hash = new URLSearchParams();
  hash.set("page", String(Math.max(1, page)));
  hash.set("zoom", String(Math.max(50, Math.min(200, zoom))));
  if (query.trim()) hash.set("search", query.trim());
  return `${cleanUrl}#${hash.toString()}`;
}

function isPdfResource(resource: FileResource) {
  return resource.mimeType === "application/pdf" || /\.pdf(\?|#|$)/i.test(resource.fileName || resource.url);
}

function isDocxResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return target.includes("wordprocessingml.document") || /\.docx(\?|#|$)/i.test(target);
}

function isOfficeResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return (
    target.includes("officedocument") ||
    target.includes("msword") ||
    target.includes("ms-excel") ||
    target.includes("ms-powerpoint") ||
    /\.(docx?|xlsx?|pptx?)(\?|#|$)/i.test(resource.fileName || resource.url)
  );
}

function isTextLikeResource(resource: FileResource) {
  const target = `${resource.mimeType} ${resource.fileName} ${resource.url}`.toLowerCase();
  return target.includes("text/") || /\.(txt|csv|md|html?|json|xml)(\?|#|$)/i.test(target);
}

function isEmbeddableWebUrl(value: string) {
  return /^https?:\/\//i.test(value) && !isGoogleDriveFolderUrl(value);
}

function isGoogleDriveFolderUrl(value: string) {
  return /drive\.google\.com\/drive\/folders\//i.test(value) || /drive\.google\.com\/folders\//i.test(value);
}

function buildGoogleDrivePreviewUrl(value: string) {
  if (!/drive\.google\.com|docs\.google\.com/i.test(value)) return "";
  if (isGoogleDriveFolderUrl(value)) return "";

  if (/docs\.google\.com/i.test(value)) {
    return value
      .replace(/\/edit(\?.*)?$/i, "/preview")
      .replace(/\/view(\?.*)?$/i, "/preview")
      .replace(/\/pub(\?.*)?$/i, "/preview");
  }

  const fileId = extractGoogleFileId(value);
  if (fileId) return `https://drive.google.com/file/d/${fileId}/preview`;

  return value
    .replace(/\/edit(\?.*)?$/i, "/preview")
    .replace(/\/view(\?.*)?$/i, "/preview");
}

function extractGoogleFileId(value: string) {
  const patterns = [
    /\/file\/d\/([^/]+)/i,
    /[?&]id=([^&]+)/i,
    /\/document\/d\/([^/]+)/i,
    /\/spreadsheets\/d\/([^/]+)/i,
    /\/presentation\/d\/([^/]+)/i
  ];

  for (const pattern of patterns) {
    const match = value.match(pattern);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  return "";
}

function getViewerManualHighlightTerms(notes: FileViewerNote[]) {
  const terms = notes
    .map((note) => note.text)
    .map((term) => term.trim())
    .filter((term) => term.length > 1);
  return Array.from(new Set(terms));
}

function isTextHighlightedByTerms(text: string, terms: string[]) {
  const normalizedText = normalizeForSearch(text);
  if (!normalizedText) return false;

  return terms.some((term) => {
    const normalizedTerm = normalizeForSearch(term);
    if (!normalizedTerm) return false;
    return normalizedTerm.includes(normalizedText) || normalizedText.includes(normalizedTerm);
  });
}

function markHtmlWithTerms(html: string, highlightTerms: string[], searchTerm: string) {
  if (!html || typeof DOMParser === "undefined") return { html, searchCount: 0 };

  const document = new DOMParser().parseFromString(`<main>${html}</main>`, "text/html");
  const root = document.body.firstElementChild;
  if (!root) return { html, searchCount: 0 };

  let searchCount = 0;
  const normalizedSearchTerm = searchTerm.trim();
  if (normalizedSearchTerm.length > 1) {
    searchCount = markTermsInHtml(document, root, [normalizedSearchTerm], (mark, index) => {
      mark.className = "doc-search-highlight";
      mark.dataset.searchIndex = String(index);
    });
  }

  markTermsInHtml(document, root, highlightTerms, (mark) => {
    mark.className = "doc-highlight";
  });

  return { html: root.innerHTML, searchCount };
}

function markTermsInHtml(
  document: Document,
  root: Element,
  terms: string[],
  decorate: (mark: HTMLElement, index: number, text: string) => void
) {
  const escapedTerms = terms.map((term) => term.trim()).filter(Boolean).sort((left, right) => right.length - left.length).map(escapeRegExp);
  if (!escapedTerms.length) return 0;

  const matcher = new RegExp(`(${escapedTerms.join("|")})`, "gi");
  let markCount = 0;

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || parent.closest("mark")) return NodeFilter.FILTER_REJECT;
      return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });

  const textNodes: Text[] = [];
  let current = walker.nextNode();
  while (current) {
    textNodes.push(current as Text);
    current = walker.nextNode();
  }

  for (const textNode of textNodes) {
    const value = textNode.textContent || "";
    matcher.lastIndex = 0;
    if (!matcher.test(value)) continue;
    matcher.lastIndex = 0;

    const fragment = document.createDocumentFragment();
    let lastIndex = 0;
    for (const match of value.matchAll(matcher)) {
      const index = match.index || 0;
      if (index > lastIndex) fragment.append(document.createTextNode(value.slice(lastIndex, index)));
      const mark = document.createElement("mark");
      decorate(mark, markCount, match[0]);
      mark.textContent = match[0];
      fragment.append(mark);
      markCount += 1;
      lastIndex = index + match[0].length;
    }
    if (lastIndex < value.length) fragment.append(document.createTextNode(value.slice(lastIndex)));
    textNode.replaceWith(fragment);
  }

  return markCount;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildViewerNotesMarkdown(resource: FileResource, notes: FileViewerNote[]) {
  const sortedNotes = [...notes].sort((a, b) => {
    const pageDiff = a.page - b.page;
    if (pageDiff !== 0) return pageDiff;
    return new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
  });

  const lines = [
    `# Anotacoes - ${resource.titulo}`,
    "",
    `- Arquivo: ${resource.fileName || resource.titulo}`,
    `- Categoria: ${formatFileCategory(resource.categoria)}`,
    `- URL: ${resource.url || "Sem URL"}`,
    `- Exportado em: ${formatDateTime(new Date().toISOString())}`,
    "",
    "## Registros",
    ""
  ];

  if (!sortedNotes.length) {
    lines.push("Nenhuma anotacao registrada.");
  }

  sortedNotes.forEach((note) => {
    lines.push(`### ${formatViewerNoteKind(note.kind)} - pagina ${note.page}`);
    lines.push("");
    lines.push(`- Autor: ${note.userEmail || note.createdBy}`);
    lines.push(`- Criado em: ${formatDateTime(note.createdAt)}`);
    lines.push("");
    lines.push(note.text);
    lines.push("");
  });

  return `${lines.join("\n")}\n`;
}

function formatViewerNoteKind(kind: FileViewerNoteKind) {
  return kind === "highlight" ? "Grifo" : "Comentario";
}

function toSafeDownloadFileName(value: string) {
  return (
    value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^[-.]+|[-.]+$/g, "")
      .toLowerCase() || "arquivo"
  );
}

function LinksModule({ user }: { user: HubUser }) {
  const [links, setLinks] = useState<UsefulLink[]>([]);
  const [query, setQuery] = useState("");
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<FileResourceScope>(user.role === "admin" ? "global" : "privado");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const source = getLinksSource();

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");

    listAppLinks(user)
      .then((loaded) => {
        if (active) setLinks(loaded);
      })
      .catch((loadError) => {
        if (active) setError(getErrorMessage(loadError));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [user]);

  const filteredLinks = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);
    if (!normalizedQuery) return links;
    return links.filter((link) => normalizeForSearch(`${link.titulo} ${link.url} ${link.scope}`).includes(normalizedQuery));
  }, [links, query]);

  const totals = useMemo(
    () => ({
      global: links.filter((link) => link.scope === "global").length,
      pessoal: links.filter((link) => link.scope === "privado").length,
      total: links.length
    }),
    [links]
  );

  function canManageLink(link: UsefulLink) {
    return user.role === "admin" || user.role === "gestor" || link.createdBy === user.email || link.createdBy === user.id;
  }

  function resetForm() {
    setEditingId(null);
    setTitulo("");
    setUrl("");
    setScope(user.role === "admin" ? "global" : "privado");
    setError("");
  }

  function startEditLink(link: UsefulLink) {
    if (!canManageLink(link)) return;
    setEditingId(link.id);
    setTitulo(link.titulo);
    setUrl(link.url);
    setScope(link.scope);
    setError("");
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim() || !url.trim()) return;
    setSaving(true);
    setError("");

    const existing = editingId ? links.find((link) => link.id === editingId) : null;
    const now = new Date().toISOString();
    const nextLink: UsefulLink = {
      id: existing?.id || crypto.randomUUID(),
      titulo: titulo.trim(),
      url: url.trim(),
      scope: user.role === "admin" || user.role === "gestor" ? scope : "privado",
      createdBy: existing?.createdBy || user.email,
      createdAt: existing?.createdAt || now,
      updatedAt: now
    };

    try {
      setLinks(await saveAppLink(nextLink, user));
      resetForm();
    } catch (submitError) {
      setError(getErrorMessage(submitError));
    } finally {
      setSaving(false);
    }
  }

  async function removeLink(link: UsefulLink) {
    if (!canManageLink(link)) return;
    setSaving(true);
    setError("");

    try {
      setLinks(await deleteAppLink(link, user));
      if (editingId === link.id) resetForm();
    } catch (deleteError) {
      setError(getErrorMessage(deleteError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="split-page">
      <section className="panel">
        <PanelHeader title="Links uteis" icon={<Link2 size={18} />} action={loading ? "carregando" : source} />
        <div className="file-summary link-summary">
          <article>
            <strong>{totals.total}</strong>
            <span>Total visivel</span>
          </article>
          <article>
            <strong>{totals.global}</strong>
            <span>Globais</span>
          </article>
          <article>
            <strong>{totals.pessoal}</strong>
            <span>Pessoais</span>
          </article>
        </div>
        <div className="panel-toolbar">
          <label className="panel-search">
            <Search size={14} />
            <input aria-label="Buscar links" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." value={query} />
          </label>
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <div className="link-list">
          {filteredLinks.map((link) => (
            <article className="link-record" key={link.id}>
              <a href={link.url} rel="noreferrer" target="_blank">
                <strong>{link.titulo}</strong>
                <span>{link.url}</span>
              </a>
              <small>{link.scope === "global" ? "Global" : "Pessoal"} - {formatDate(link.updatedAt)}</small>
              <div className="record-actions">
                {canManageLink(link) ? (
                  <>
                    <button type="button" onClick={() => startEditLink(link)}>
                      <Edit3 size={14} />
                      Editar
                    </button>
                    <button className="danger-action" disabled={saving} type="button" onClick={() => removeLink(link)}>
                      <Trash2 size={14} />
                      Excluir
                    </button>
                  </>
                ) : (
                  <span className="record-actions--readonly">Somente leitura</span>
                )}
              </div>
            </article>
          ))}
          {!filteredLinks.length ? <div className="empty-state">Nenhum link encontrado.</div> : null}
        </div>
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title={editingId ? "Editar link" : "Novo link"} icon={<Link2 size={18} />} action={user.role === "admin" || user.role === "gestor" ? "global/pessoal" : "pessoal"} />
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Titulo
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" />
          </label>
          {user.role === "admin" || user.role === "gestor" ? (
            <label>
              Escopo
              <select value={scope} onChange={(event) => setScope(event.target.value as FileResourceScope)}>
                <option value="global">Global</option>
                <option value="privado">Pessoal</option>
              </select>
            </label>
          ) : null}
          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingId ? "Atualizar link" : "Salvar link"}
            </button>
            {editingId ? (
              <button disabled={saving} type="button" onClick={resetForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>

    </div>
  );
}

function AdminModule({ currentUser }: { currentUser: HubUser }) {
  const [users, setUsers] = useState<HubProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [authId, setAuthId] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
  const [temporaryPassword, setTemporaryPassword] = useState("");
  const [role, setRole] = useState<UserRole>("colaborador");
  const [active, setActive] = useState(true);
  const [coordHealth, setCoordHealth] = useState<CoordSyncHealth>({
    status: "Nao consultado",
    detail: "A sincronizacao da Coordenacao sera conferida neste painel.",
    tone: "info"
  });
  const source = getUsersSource();

  useEffect(() => {
    let mounted = true;

    async function refreshUsers() {
      setLoading(true);
      setError("");
      try {
        const loaded = await listAppUsers();
        if (mounted) setUsers(loaded);
      } catch (loadError) {
        if (mounted) setError(getErrorMessage(loadError));
      } finally {
        if (mounted) setLoading(false);
      }
    }

    refreshUsers();
    window.addEventListener("hub:users", refreshUsers);

    return () => {
      mounted = false;
      window.removeEventListener("hub:users", refreshUsers);
    };
  }, []);

  const totals = useMemo(
    () => ({
      active: users.filter((user) => user.active).length,
      admin: users.filter((user) => user.role === "admin" && user.active).length,
      gestor: users.filter((user) => user.role === "gestor" && user.active).length,
      colaborador: users.filter((user) => user.role === "colaborador" && user.active).length
    }),
    [users]
  );
  const healthChecks = useMemo(() => buildOperationalHealthChecks(currentUser, users, coordHealth), [currentUser, users, coordHealth]);

  useEffect(() => {
    let mounted = true;

    async function checkCoordSync() {
      if (source !== "supabase") {
        setCoordHealth({
          status: "Modo local",
          detail: "A Coordenacao so sincroniza entre usuarios quando o HUB esta conectado ao Supabase.",
          tone: "warning"
        });
        return;
      }

      try {
        const token = await getSupabaseAccessToken();
        if (!token) {
          throw new Error("Sessao Supabase nao disponivel para consultar coord-data.");
        }

        const response = await fetch("/.netlify/functions/coord-data", {
          headers: { accept: "application/json", authorization: `Bearer ${token}` }
        });
        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(data.error || response.statusText || "Function coord-data indisponivel.");
        }

        if (!mounted) return;

        const collaborators = Array.isArray(data.state?.collaborators) ? data.state.collaborators.length : 0;
        const reminders = Array.isArray(data.state?.reminders) ? data.state.reminders.length : 0;

        setCoordHealth({
          status: "Supabase pronto",
          detail: `Function coord-data respondeu. Base atual: ${collaborators} colaborador(es) e ${reminders} item(ns).`,
          tone: "ok"
        });
      } catch (healthError) {
        if (!mounted) return;
        setCoordHealth({
          status: "Aguardando deploy",
          detail: `${getErrorMessage(healthError)} Execute o proximo deploy de marco para publicar a Function coord-data.`,
          tone: "info"
        });
      }
    }

    checkCoordSync();

    return () => {
      mounted = false;
    };
  }, [source]);

  function resetForm() {
    setEditingKey(null);
    setAuthId("");
    setNome("");
    setEmail("");
    setInitialPassword("");
    setTemporaryPassword("");
    setRole("colaborador");
    setActive(true);
  }

  function startEdit(profile: HubProfile) {
    setNotice("");
    setEditingKey(getProfileKey(profile));
    setAuthId(profile.id || "");
    setNome(profile.nome);
    setEmail(profile.email);
    setInitialPassword("");
    setTemporaryPassword("");
    setRole(profile.role);
    setActive(profile.active);
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!nome.trim() || !email.trim()) return;
    if (source === "supabase" && !editingKey && initialPassword.trim().length < 8) {
      setError("Informe uma senha inicial com pelo menos 8 caracteres.");
      return;
    }
    if (source === "supabase" && editingKey && temporaryPassword.trim() && temporaryPassword.trim().length < 8) {
      setError("Informe uma senha provisoria com pelo menos 8 caracteres.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const saved = await saveAppUserWithOptions(
        {
          id: authId || editingKey || undefined,
          nome: nome.trim(),
          email: email.trim(),
          iniciais: getInitials(nome),
          role,
          active
        },
        {
          createAuthUser: source === "supabase" && !editingKey && !authId,
          password: initialPassword.trim()
        }
      );
      setUsers(saved);

      if (source === "supabase" && editingKey && temporaryPassword.trim()) {
        const resetResult = await resetAppUserPassword(
          {
            id: authId || editingKey || undefined,
            nome: nome.trim(),
            email: email.trim(),
            iniciais: getInitials(nome),
            role,
            active
          },
          temporaryPassword
        );

        setNotice(
          resetResult.emailQueued
            ? "Usuario atualizado. Senha provisoria redefinida e e-mail enfileirado."
            : "Usuario atualizado. Senha provisoria redefinida, mas o e-mail nao foi enfileirado."
        );
      } else {
        setNotice(editingKey ? "Usuario atualizado." : "Usuario salvo.");
      }

      resetForm();
    } catch (saveError) {
      setError(getErrorMessage(saveError));
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(profile: HubProfile) {
    if (profile.email.toLowerCase() === currentUser.email.toLowerCase() && profile.active) {
      setError("Nao desative o usuario logado.");
      return;
    }

    setSaving(true);
    setError("");
    setNotice("");

    try {
      const saved = await setAppUserActive(profile, !profile.active);
      setUsers(saved);
      if (editingKey === getProfileKey(profile)) resetForm();
    } catch (toggleError) {
      setError(getErrorMessage(toggleError));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="split-page admin-page">
      <section className="panel admin-users-panel">
        <PanelHeader
          title="Usuarios e perfis"
          icon={<UserRoundCog size={18} />}
          action={loading ? "Carregando" : `${source} - ${users.length} usuarios`}
        />

        {error ? <p className="module-error">{error}</p> : null}
        {notice ? <p className="module-notice">{notice}</p> : null}

        <div className="admin-summary">
          <article>
            <strong>{totals.active}</strong>
            <span>Ativos</span>
          </article>
          <article>
            <strong>{totals.admin}</strong>
            <span>Admins</span>
          </article>
          <article>
            <strong>{totals.gestor}</strong>
            <span>Gestores</span>
          </article>
          <article>
            <strong>{totals.colaborador}</strong>
            <span>Colaboradores</span>
          </article>
        </div>

        <div className="admin-user-list">
          {users.map((profile) => (
            <article className={!profile.active ? "admin-user admin-user--inactive" : "admin-user"} key={getProfileKey(profile)}>
              <div className="admin-user-avatar">{profile.iniciais || getInitials(profile.nome)}</div>
              <div className="admin-user-main">
                <strong>{profile.nome}</strong>
                <span>{profile.email}</span>
                <small>{formatRole(profile.role)}</small>
              </div>
              <StatusPill label={profile.active ? "ativo" : "inativo"} />
              <div className="record-actions">
                <button disabled={saving} type="button" onClick={() => startEdit(profile)}>
                  <Edit3 size={14} />
                  Editar
                </button>
                <button disabled={saving} type="button" onClick={() => toggleActive(profile)}>
                  <CheckCircle2 size={14} />
                  {profile.active ? "Desativar" : "Reativar"}
                </button>
              </div>
            </article>
          ))}
        </div>

        <section className="operational-health">
          <div className="section-title-row">
            <div>
              <span className="panel-chip">Pre-deploy</span>
              <h3>Saude operacional do HUB</h3>
            </div>
            <small>{formatDateTime(new Date().toISOString())}</small>
          </div>
          <div className="health-grid">
            {healthChecks.map((check) => (
              <article className={`health-card health-card--${check.tone}`} key={check.area}>
                <div>
                  <strong>{check.area}</strong>
                  <span>{check.status}</span>
                </div>
                <p>{check.detail}</p>
              </article>
            ))}
          </div>
          <p className="health-footnote">
            Use este painel como checklist antes de liberar novo deploy. Ele nao dispara builds nem consome creditos do Netlify.
          </p>
        </section>

        <OperationalGuidePanel />

        <OperationalEmailConsole currentUser={currentUser} users={users} />

        <OperationalHomologationPanel />
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title={editingKey ? "Editar usuario" : "Novo usuario"} icon={<UserRound size={18} />} action={source} />
        <form className="stack-form admin-user-form" onSubmit={handleSubmit}>
          {source === "supabase" && editingKey ? (
            <label>
              ID Auth Supabase
              <input value={authId} onChange={(event) => setAuthId(event.target.value)} required />
            </label>
          ) : null}
          <label>
            Nome
            <input value={nome} onChange={(event) => setNome(event.target.value)} required />
          </label>
          <label>
            E-mail
            <input value={email} onChange={(event) => setEmail(event.target.value)} type="email" required />
          </label>
          <label>
            Perfil
            <select value={role} onChange={(event) => setRole(event.target.value as UserRole)}>
              {roleOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          {source === "supabase" && !editingKey ? (
            <label>
              Senha inicial
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setInitialPassword(event.target.value)}
                type="password"
                value={initialPassword}
                required
              />
            </label>
          ) : null}
          {source === "supabase" && editingKey ? (
            <label>
              Nova senha provisoria
              <input
                autoComplete="new-password"
                minLength={8}
                onChange={(event) => setTemporaryPassword(event.target.value)}
                placeholder="Opcional"
                type="password"
                value={temporaryPassword}
              />
              <small className="form-hint">Preencha somente se quiser redefinir a senha deste usuario.</small>
            </label>
          ) : null}
          <label className="toggle-row">
            <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
            Usuario ativo
          </label>

          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingKey ? "Atualizar usuario" : "Salvar usuario"}
            </button>
            {editingKey ? (
              <button disabled={saving} type="button" onClick={resetForm}>
                Cancelar
              </button>
            ) : null}
          </div>
        </form>
      </section>
    </div>
  );
}

function OperationalHomologationPanel() {
  const [statuses, setStatuses] = useState<Record<string, HomologationStatus>>(() => readHomologationStatuses());
  const [notice, setNotice] = useState("");

  const summary = useMemo(() => {
    const allItems = homologationBlocks.flatMap((block) => block.items);
    const counts = allItems.reduce(
      (acc, item) => {
        const status = statuses[item.id] || "pendente";
        acc[status] += 1;
        return acc;
      },
      { pendente: 0, ok: 0, ajustar: 0, falhou: 0 } as Record<HomologationStatus, number>
    );

    return {
      counts,
      total: allItems.length,
      progress: allItems.length ? Math.round((counts.ok / allItems.length) * 100) : 0
    };
  }, [statuses]);

  useEffect(() => {
    try {
      localStorage.setItem(HOMOLOGATION_STORAGE_KEY, JSON.stringify(statuses));
    } catch {
      // Se o navegador bloquear localStorage, o checklist continua utilizavel na sessao atual.
    }
  }, [statuses]);

  function updateStatus(itemId: string, status: HomologationStatus) {
    setNotice("");
    setStatuses((current) => ({ ...current, [itemId]: status }));
  }

  function clearChecklist() {
    setNotice("");
    setStatuses({});
  }

  async function copyChecklistSummary() {
    const lines = [
      "# Homologacao funcional - HUB Depto Tributario",
      "",
      `Gerado em: ${formatDateTime(new Date().toISOString())}`,
      `Resumo: ${summary.counts.ok}/${summary.total} OK, ${summary.counts.ajustar} ajustar, ${summary.counts.falhou} falhou, ${summary.counts.pendente} pendente.`,
      "",
      ...homologationBlocks.flatMap((block) => [
        `## ${block.title}`,
        ...block.items.map((item) => `- [${homologationStatusLabels[statuses[item.id] || "pendente"]}] ${item.title}: ${item.detail}`),
        ""
      ])
    ];

    try {
      await navigator.clipboard.writeText(lines.join("\n"));
      setNotice("Resumo copiado para a area de transferencia.");
    } catch {
      setNotice("Nao foi possivel copiar automaticamente. Use o roteiro Markdown como fallback.");
    }
  }

  return (
    <section className="operational-homologation">
      <div className="section-title-row">
        <div>
          <span className="panel-chip">Homologacao</span>
          <h3>Checklist funcional</h3>
        </div>
        <small>{summary.progress}% OK</small>
      </div>

      <div className="homologation-summary">
        <article>
          <strong>{summary.counts.ok}</strong>
          <span>OK</span>
        </article>
        <article>
          <strong>{summary.counts.ajustar}</strong>
          <span>Ajustar</span>
        </article>
        <article>
          <strong>{summary.counts.falhou}</strong>
          <span>Falhou</span>
        </article>
        <article>
          <strong>{summary.counts.pendente}</strong>
          <span>Pendente</span>
        </article>
      </div>

      {notice ? <p className="module-notice">{notice}</p> : null}

      <div className="homologation-actions">
        <button onClick={copyChecklistSummary} type="button">
          Copiar resumo
        </button>
        <button onClick={clearChecklist} type="button">
          Limpar marcacoes
        </button>
      </div>

      <div className="homologation-blocks">
        {homologationBlocks.map((block) => (
          <article className="homologation-block" key={block.id}>
            <strong>{block.title}</strong>
            <div>
              {block.items.map((item) => {
                const status = statuses[item.id] || "pendente";
                return (
                  <label className={`homologation-item homologation-item--${status}`} key={item.id}>
                    <span>
                      <b>{item.title}</b>
                      <small>{item.detail}</small>
                    </span>
                    <select value={status} onChange={(event) => updateStatus(item.id, event.target.value as HomologationStatus)}>
                      {(Object.keys(homologationStatusLabels) as HomologationStatus[]).map((option) => (
                        <option key={option} value={option}>
                          {homologationStatusLabels[option]}
                        </option>
                      ))}
                    </select>
                  </label>
                );
              })}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}

function OperationalGuidePanel() {
  const [copyNotice, setCopyNotice] = useState("");

  const guideText = useMemo(
    () =>
      [
        "# Guia rapido operacional - HUB Depto Tributario",
        "",
        `Versao esperada: ${APP_RELEASE_LABEL}`,
        "",
        "## Rotina diaria",
        ...dailyOperationalGuide.flatMap((item, index) => [`${index + 1}. ${item.title}`, `   - ${item.detail}`]),
        "",
        "## Rotina semanal",
        ...weeklyOperationalGuide.flatMap((item, index) => [`${index + 1}. ${item.title}`, `   - ${item.detail}`]),
        "",
        "## Antes de deploy de marco",
        "- Confirmar checklist funcional sem itens Falhou.",
        "- Rodar npm.cmd run preflight.",
        "- Rodar npm.cmd run build.",
        "- Conferir supabase/check_hub_status.sql com tudo OK.",
        "- Liberar builds no Netlify somente quando for publicar o marco."
      ].join("\n"),
    []
  );

  async function copyGuide() {
    try {
      await navigator.clipboard.writeText(guideText);
      setCopyNotice("Guia copiado.");
    } catch {
      setCopyNotice("Nao foi possivel copiar automaticamente.");
    }
  }

  return (
    <section className="operational-console operational-guide">
      <div className="section-title-row">
        <div>
          <span className="panel-chip">Operacao</span>
          <h3>Guia rapido do administrador</h3>
        </div>
        <button className="secondary-button" type="button" onClick={copyGuide}>
          Copiar guia
        </button>
      </div>
      <div className="operation-grid">
        <article className="operation-card">
          <strong>Rotina diaria</strong>
          <p>Sequencia curta para abrir o HUB, conferir riscos e acionar e-mails sem depender de instrucoes externas.</p>
          <ol className="operational-guide-list">
            {dailyOperationalGuide.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </li>
            ))}
          </ol>
        </article>
        <article className="operation-card">
          <strong>Rotina semanal</strong>
          <p>Revisoes de manutencao para manter dados, acessos, biblioteca e Coordenacao em ordem.</p>
          <ol className="operational-guide-list">
            {weeklyOperationalGuide.map((item) => (
              <li key={item.title}>
                <b>{item.title}</b>
                <span>{item.detail}</span>
              </li>
            ))}
          </ol>
        </article>
      </div>
      <div className="operation-card operation-card--compact">
        <strong>Antes de deploy de marco</strong>
        <p>
          Confirme o checklist funcional, rode <code>npm.cmd run preflight</code>, rode <code>npm.cmd run build</code> e so entao libere os
          builds do Netlify para publicar a rodada.
        </p>
      </div>
      {copyNotice ? <p className="module-notice">{copyNotice}</p> : null}
    </section>
  );
}

function OperationalEmailConsole({ currentUser, users }: { currentUser: HubUser; users: HubProfile[] }) {
  const [dispatchToken, setDispatchToken] = useState(() => localStorage.getItem("hub_email_dispatch_token") || "");
  const [limit, setLimit] = useState(20);
  const [runningAction, setRunningAction] = useState("");
  const [operationError, setOperationError] = useState("");
  const [operationNotice, setOperationNotice] = useState("");
  const [queuePreview, setQueuePreview] = useState<EmailQueuePreviewItem[]>([]);
  const [manualTo, setManualTo] = useState(currentUser.email);
  const [manualSubject, setManualSubject] = useState("Teste manual - HUB Depto Tributario");
  const [manualBody, setManualBody] = useState("Mensagem enviada manualmente pelo HUB Depto Tributario.");

  const activeUsers = useMemo(() => getActiveProfiles(users), [users]);

  useEffect(() => {
    const token = dispatchToken.trim();
    if (token) {
      localStorage.setItem("hub_email_dispatch_token", token);
    } else {
      localStorage.removeItem("hub_email_dispatch_token");
    }
  }, [dispatchToken]);

  async function parseEmailResponse(response: Response) {
    const text = await response.text();
    let data: EmailOperationResponse = {};

    try {
      data = text ? (JSON.parse(text) as EmailOperationResponse) : {};
    } catch {
      data = { error: text };
    }

    if (!response.ok) {
      throw new Error(data.error || response.statusText || "Nao foi possivel executar a operacao.");
    }

    return data;
  }

  async function buildEmailOperationPayload(action: "preview" | "queue-deadlines" | "process" | "daily") {
    const token = dispatchToken.trim();
    const authToken = await getSupabaseAccessToken();
    if (!token && !authToken) throw new Error("Informe o EMAIL_DISPATCH_TOKEN ou faca login novamente como admin/gestor.");
    return { action, authToken, limit, token };
  }

  async function previewEmailQueue() {
    setRunningAction("preview");
    setOperationError("");
    setOperationNotice("");

    try {
      const payload = await buildEmailOperationPayload("preview");
      const response = await fetch("/.netlify/functions/email-outbox", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(payload.token ? { "x-email-dispatch-token": payload.token } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await parseEmailResponse(response);
      setQueuePreview(data.items || []);
      setOperationNotice(
        `Fila consultada: ${data.queuedPreview || 0} e-mail(s) prontos para envio. Entrega ${
          data.deliveryEnabled ? "ativa" : "em teste"
        }.`
      );
    } catch (error) {
      setOperationError(getErrorMessage(error));
    } finally {
      setRunningAction("");
    }
  }

  async function runEmailQueueAction(action: "queue-deadlines" | "process" | "daily") {
    setRunningAction(action);
    setOperationError("");
    setOperationNotice("");

    try {
      const payload = await buildEmailOperationPayload(action);
      const response = await fetch("/.netlify/functions/email-outbox", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(payload.token ? { "x-email-dispatch-token": payload.token } : {})
        },
        body: JSON.stringify(payload)
      });
      const data = await parseEmailResponse(response);
      const queued = data.queued || data.items?.length || 0;
      const processed = data.processed || data.results?.length || 0;
      setQueuePreview(data.items || []);

      if (action === "queue-deadlines") {
        setOperationNotice(`${queued} aviso(s) de vencimento enfileirado(s).`);
      } else if (action === "daily") {
        setOperationNotice(`Rotina diaria executada: ${queued} aviso(s) enfileirado(s) e ${processed} e-mail(s) processado(s).`);
      } else {
        setOperationNotice(`${processed} e-mail(s) processado(s).`);
      }
    } catch (error) {
      setOperationError(getErrorMessage(error));
    } finally {
      setRunningAction("");
    }
  }

  async function sendManualEmail(event: FormEvent) {
    event.preventDefault();
    if (!manualTo.trim() || !manualSubject.trim() || !manualBody.trim()) {
      setOperationError("Destinatario, assunto e mensagem sao obrigatorios.");
      return;
    }

    setRunningAction("manual");
    setOperationError("");
    setOperationNotice("");

    try {
      const authToken = await getSupabaseAccessToken();
      const token = dispatchToken.trim();

      if (!authToken && !token) {
        throw new Error("Informe o token de despacho ou faca login novamente como admin/gestor.");
      }

      const recipient = activeUsers.find((profile) => profile.email.toLowerCase() === manualTo.trim().toLowerCase());
      const response = await fetch("/.netlify/functions/coord-email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json"
        },
        body: JSON.stringify({
          to: manualTo.trim(),
          subject: manualSubject.trim(),
          body: manualBody.trim(),
          collaboratorName: recipient?.nome || manualTo.trim(),
          periodId: `manual-${new Date().toISOString().slice(0, 10)}`,
          token,
          authToken
        })
      });
      const data = await parseEmailResponse(response);
      const processed = data.processed || data.results?.length || 0;
      setOperationNotice(`E-mail manual enfileirado${processed ? " e processado" : ""}. Categoria: ${data.category || "coord_email"}.`);
    } catch (error) {
      setOperationError(getErrorMessage(error));
    } finally {
      setRunningAction("");
    }
  }

  const isRunning = Boolean(runningAction);

  return (
    <section className="operational-console">
      <div className="section-title-row">
        <div>
          <span className="panel-chip">Operacao</span>
          <h3>Lembretes e e-mails</h3>
        </div>
        <small>Manual + fila</small>
      </div>

      {operationError ? <p className="module-error">{operationError}</p> : null}
      {operationNotice ? <p className="module-notice">{operationNotice}</p> : null}

      <div className="operation-grid">
        <article className="operation-card">
          <strong>Fila de e-mails</strong>
          <p>
            Consulte e processe a fila <code>email_outbox</code>. A rotina diaria enfileira avisos de vencimento e envia o que estiver
            pronto. O token abaixo e necessario apenas para comandos manuais no HUB; o agendamento da Netlify usa
            <code>EMAIL_SCHEDULE_ENABLED=true</code>. Se voce estiver logado como admin/gestor, os botoes tambem funcionam sem colar o token.
          </p>
          <label>
            EMAIL_DISPATCH_TOKEN (opcional para admin/gestor logado)
            <input
              autoComplete="off"
              onChange={(event) => setDispatchToken(event.target.value)}
              placeholder="Opcional: cole o token usado no Netlify"
              type="password"
              value={dispatchToken}
            />
          </label>
          <label>
            Limite por processamento
            <input
              max={50}
              min={1}
              onChange={(event) => setLimit(Number(event.target.value) || 1)}
              type="number"
              value={limit}
            />
          </label>
          <div className="operation-actions">
            <button disabled={isRunning} onClick={previewEmailQueue} type="button">
              Consultar fila
            </button>
            <button disabled={isRunning} onClick={() => runEmailQueueAction("queue-deadlines")} type="button">
              Enfileirar vencimentos
            </button>
            <button disabled={isRunning} onClick={() => runEmailQueueAction("process")} type="button">
              Processar fila agora
            </button>
            <button className="primary-action" disabled={isRunning} onClick={() => runEmailQueueAction("daily")} type="button">
              Rodar rotina diaria
            </button>
          </div>
        </article>

        <article className="operation-card">
          <strong>Envio manual</strong>
          <p>Use para testar entrega ou disparar um aviso operacional pontual sem criar lembrete.</p>
          <form className="manual-email-form" onSubmit={sendManualEmail}>
            <label>
              Destinatario
              <input
                list="manual-email-users"
                onChange={(event) => setManualTo(event.target.value)}
                type="email"
                value={manualTo}
                required
              />
              <datalist id="manual-email-users">
                {activeUsers.map((profile) => (
                  <option key={getProfileKey(profile)} value={profile.email}>
                    {profile.nome}
                  </option>
                ))}
              </datalist>
            </label>
            <label>
              Assunto
              <input onChange={(event) => setManualSubject(event.target.value)} value={manualSubject} required />
            </label>
            <label>
              Mensagem
              <textarea onChange={(event) => setManualBody(event.target.value)} rows={4} value={manualBody} required />
            </label>
            <button className="primary-action" disabled={isRunning} type="submit">
              {runningAction === "manual" ? "Enviando..." : "Enviar e-mail manual"}
            </button>
          </form>
        </article>
      </div>

      <div className="queue-preview">
        <div className="queue-preview-title">
          <strong>Previa da fila</strong>
          <span>{queuePreview.length} item(ns)</span>
        </div>
        {queuePreview.length ? (
          <div className="queue-preview-list">
            {queuePreview.map((item) => (
              <article key={item.id}>
                <strong>{item.subject || "Sem assunto"}</strong>
                <span>
                  {item.toEmail || "destinatario oculto"} - {formatDateTime(item.scheduledFor || "")}
                </span>
                <small>{item.category || "email"} / {item.targetType || "geral"}</small>
              </article>
            ))}
          </div>
        ) : (
          <p>Nenhum item carregado. Clique em Consultar fila para ver os e-mails prontos para envio.</p>
        )}
      </div>
    </section>
  );
}

function ModuleFrame({ title, src }: { title: string; src: string }) {
  const frameRef = useRef<HTMLIFrameElement | null>(null);

  const postAuthToken = useCallback(async () => {
    const token = await getSupabaseAccessToken();
    if (!token || !frameRef.current?.contentWindow) return;
    frameRef.current.contentWindow.postMessage({ type: "hub-auth-token", token }, window.location.origin);
  }, []);

  return (
    <section className="frame-page">
      <header>
        <h2>{title}</h2>
        <a href={src} rel="noreferrer" target="_blank">
          Abrir em nova aba
        </a>
      </header>
      <iframe ref={frameRef} src={src} title={title} onLoad={postAuthToken} />
    </section>
  );
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

function getActiveProfiles(profiles: HubProfile[]) {
  if (profiles.length) return profiles.filter((profile) => profile.active);
  return teamMembers.map((member) => ({ ...member, active: true }));
}

function getProfileKey(profile: HubProfile) {
  return profile.id || profile.email;
}

function formatRole(role: UserRole) {
  return roleOptions.find((option) => option.value === role)?.label || role;
}

function buildOperationalHealthChecks(user: HubUser, users: HubProfile[], coordHealth: CoordSyncHealth): HealthCheck[] {
  const usersSource = getUsersSource();
  const lembretesSource = getLembretesSource(user);
  const arquivosSource = getArquivosSource();
  const linksSource = getLinksSource();
  const tarefasSource = getTarefasSource(user);
  const hasAdmin = users.some((profile) => profile.active && profile.role === "admin");
  const hasCurrentUser = users.some((profile) => profile.active && profile.email.toLowerCase() === user.email.toLowerCase());
  const supabaseReady = [usersSource, lembretesSource, arquivosSource, linksSource].every((source) => source === "supabase");

  return [
    {
      area: "Versao do HUB",
      status: APP_RELEASE_LABEL,
      detail: `Pacote preparado em ${APP_RELEASE_DATE}; use esta etiqueta para confirmar se o navegador/Netlify carregou a versao correta.`,
      tone: "info"
    },
    {
      area: "Projeto Supabase",
      status: configuredSupabaseHost,
      detail:
        configuredSupabaseHost === HUB_SUPABASE_HOST
          ? "Conectado ao projeto correto do HUB Depto Tributario."
          : `Revise o Netlify: este HUB deve usar ${HUB_SUPABASE_HOST}, nao o projeto futuro do app substituto do Sheets.`,
      tone: configuredSupabaseHost === HUB_SUPABASE_HOST ? "ok" : "warning"
    },
    {
      area: "Usuarios e perfis",
      status: usersSource === "supabase" ? "Supabase ativo" : "Modo local",
      detail: hasAdmin && hasCurrentUser ? "Admin ativo e usuario logado presente na lista." : "Revise se ha admin ativo e se o usuario logado esta em profiles.",
      tone: usersSource === "supabase" && hasAdmin && hasCurrentUser ? "ok" : "warning"
    },
    {
      area: "Lembretes",
      status: lembretesSource === "supabase" ? "Persistencia real" : "Fallback local",
      detail: "Criacao, visibilidade, anexos, confidencialidade e e-mails usam esta origem.",
      tone: lembretesSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Arquivos",
      status: arquivosSource === "supabase" ? "Biblioteca multiusuario" : "Fallback local",
      detail: "Pastas, uploads e anotacoes do visualizador devem usar Supabase no ambiente publicado.",
      tone: arquivosSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Links uteis",
      status: linksSource === "supabase" ? "Links sincronizados" : "Fallback local",
      detail: "Links globais e pessoais respeitam permissoes de admin, gestor e colaborador.",
      tone: linksSource === "supabase" ? "ok" : "warning"
    },
    {
      area: "Tarefas",
      status: tarefasSource,
      detail:
        tarefasSource === "supabase"
          ? "Persistencia multiusuario ativa; calendario original sincroniza com Supabase."
          : tarefasSource === "calendario"
            ? "Calendario local ativo; Supabase preparado para ativacao por VITE_TAREFAS_SUPABASE=true."
            : "Fallback local ativo porque o calendario do navegador nao esta disponivel.",
      tone: tarefasSource === "supabase" ? "ok" : "info"
    },
    {
      area: "Coordenacao Tributaria",
      status: coordHealth.status,
      detail: coordHealth.detail,
      tone: coordHealth.tone
    },
    {
      area: "E-mails",
      status: "Fila ativa",
      detail: "Lembretes, vencimentos, reset de senha e Coordenacao usam email_outbox; envio real segue em modo teste ate validar dominio proprio.",
      tone: supabaseReady ? "ok" : "info"
    },
    {
      area: "Rodapes",
      status: "Automacao ativa",
      detail: "Noticias tributarias e legislacoes oficiais sao atualizadas pela funcao refresh-updates e exibidas nos rodapes/sidebars.",
      tone: "info"
    },
    {
      area: "Agenda Tributaria",
      status: "Make/RFB preparado",
      detail: "Agenda usa o endpoint /api/agenda-tributaria e o cache agenda_tributaria_cache; configure AGENDA_SYNC_TOKEN no Netlify e no Make.",
      tone: "info"
    },
    {
      area: "Netlify",
      status: "Builds pausados",
      detail: "Manter builds parados durante desenvolvimento e liberar apenas para deploy de marco.",
      tone: "info"
    }
  ];
}

function readHomologationStatuses() {
  try {
    const raw = localStorage.getItem(HOMOLOGATION_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, HomologationStatus>;
    const validStatuses = new Set(Object.keys(homologationStatusLabels));
    return Object.fromEntries(Object.entries(parsed).filter(([, status]) => validStatuses.has(status)));
  } catch {
    return {};
  }
}

function formatFileCategory(category: FileResourceCategory) {
  return fileCategoryOptions.find((option) => option.value === category)?.label || "Outro";
}

function pautaToReportRow(pauta: Pauta): ReportRow {
  return {
    Tema: pauta.tema,
    Acao: pautaRichTextToPlain(pauta.acoes || pauta.pendenciasObs || "Sem acao registrada"),
    Responsavel: pauta.responsavel || "Sem responsavel definido",
    Email: pauta.email || "",
    Prazo: formatDate(pauta.prazo),
    Prioridade: pauta.prioridade || "",
    Status: pauta.status || "Sem status",
    Origem: pauta.origem || ""
  };
}

function buildPautasEmailHtml(pautas: Pauta[], profiles: HubProfile[]) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const content = pautas.length
    ? pautas
        .map((pauta) => {
          const fontSize = getPautaEmailFontSize(pauta.textSize);
          const fontWeight = pauta.textBold ? "700" : "400";
          const fontStyle = pauta.textItalic ? "italic" : "normal";
          const description = pauta.acoes || pauta.pendenciasObs || "Sem acao registrada";
          const responsaveis = pauta.scope === "usuarios" ? formatResponsaveis(pauta.responsaveis || [], profiles) : "Todos os usuarios";

          return `
            <article style="border:1px solid #d8cdb6;border-radius:8px;padding:14px 16px;margin:0 0 12px;background:#fffdf8;">
              <h2 style="font-family:Arial,sans-serif;font-size:${fontSize};line-height:1.35;margin:0 0 8px;color:#10233d;font-weight:700;font-style:${fontStyle};">
                ${escapeHtmlText(pauta.tema)}
              </h2>
              <div style="font-family:Arial,sans-serif;font-size:${fontSize};line-height:1.45;color:#243955;font-weight:${fontWeight};font-style:${fontStyle};white-space:pre-wrap;">
                ${renderPautaRichHtmlForEmail(description)}
              </div>
              <p style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;margin:10px 0 0;color:#10233d;">
                <strong>Responsaveis:</strong> ${escapeHtmlText(responsaveis)}<br/>
                <strong>Prazo:</strong> ${escapeHtmlText(formatDate(pauta.prazo))}<br/>
                <strong>Status:</strong> ${escapeHtmlText(pauta.status || "Sem status")}<br/>
                <strong>Prioridade:</strong> ${escapeHtmlText(pauta.prioridade || "Normal")}
              </p>
            </article>
          `;
        })
        .join("")
    : `<p style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;color:#243955;">Nenhuma pauta encontrada para o filtro atual.</p>`;

  return `
    <div style="font-family:Arial,sans-serif;font-size:12pt;line-height:1.45;color:#17211c;">
      <p style="margin:0 0 12px;">Segue a lista filtrada de pautas do HUB Depto Tributario.</p>
      <p style="margin:0 0 16px;color:#64716b;">Gerado em ${escapeHtmlText(generatedAt)}.</p>
      ${content}
    </div>
  `;
}

function getPautaEmailFontSize(size: Pauta["textSize"]) {
  if (size === "pequena") return "12pt";
  if (size === "grande") return "16pt";
  return "14pt";
}

function lembreteToReportRow(lembrete: Lembrete, profiles: HubProfile[]): ReportRow {
  return {
    Titulo: lembrete.titulo,
    Descricao: lembrete.descricao || "Sem descricao",
    Responsaveis: formatResponsaveis(lembrete.responsaveis, profiles),
    Prazo: formatDateTime(lembrete.prazo),
    Prioridade: lembrete.prioridade,
    Status: lembrete.status,
    Confidencial: lembrete.confidencial ? "Sim" : "Nao",
    Anexos: String(lembrete.anexos.length)
  };
}

function taskToReportRow(task: TaskItem): ReportRow {
  return {
    Titulo: task.titulo,
    Descricao: task.descricao || "Sem descricao",
    Prazo: formatDateTime(task.prazo),
    Prioridade: task.prioridade,
    Status: task.status,
    Destaque: task.destaque ? "Sim" : "Nao",
    Origem: task.origem || "calendario",
    Responsaveis: task.responsaveis.join(", ") || "Sem responsavel definido",
    Anexos: String(task.anexos.length)
  };
}

const TASK_SIDEBAR_HISTORY_DAYS = 7;
const TASK_SIDEBAR_HISTORY_MS = TASK_SIDEBAR_HISTORY_DAYS * 24 * 60 * 60 * 1000;

function shouldKeepTaskInSidebarHistory(task: TaskItem) {
  if (task.archivedAt) return false;
  if (!task.prazo) return true;

  const timestamp = Date.parse(task.prazo);
  if (!Number.isFinite(timestamp)) return true;
  if (timestamp > Date.now()) return true;

  return Date.now() - timestamp <= TASK_SIDEBAR_HISTORY_MS;
}

function isTaskSidebarHistoryRecord(task: TaskItem) {
  if (task.archivedAt) return false;
  if (!task.prazo) return false;

  const timestamp = Date.parse(task.prazo);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

function taskToCalendarFrameEvent(task: TaskItem) {
  return {
    id: task.id,
    title: task.titulo,
    date: task.prazo || task.createdAt || new Date().toISOString(),
    description: task.descricao,
    category: task.prioridade === "alta" ? "important" : task.destaque ? "work" : "personal",
    attachments: task.anexos.map((name) => ({ name })),
    hub: {
      createdBy: task.createdBy,
      responsaveis: task.responsaveis,
      status: task.status,
      prioridade: task.prioridade,
      destaque: Boolean(task.destaque),
      origem: task.origem,
      coordItemId: task.coordItemId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      archivedAt: task.archivedAt || ""
    }
  };
}

function noticiaToReportRow(item: Noticia): ReportRow {
  return {
    Data: formatDate(item.data),
    Titulo: item.titulo,
    Fonte: item.fonte,
    URL: item.url,
    Tipo: item.tipo || ""
  };
}

function notificationToReportRow(item: HubNotification): ReportRow {
  return {
    Titulo: item.title,
    Detalhe: item.detail,
    Meta: item.meta,
    Tom: item.tone,
    Tipo: item.tipo,
    Criada: formatDateTime(item.createdAt),
    Rota: item.route
  };
}

async function sendNotificationsByEmail(user: HubUser, items: HubNotification[]) {
  const rows = items.length ? items.map(notificationToReportRow) : [{ Info: "Nenhuma notificacao pendente." }];
  const body = rows
    .map((row) => Object.entries(row).map(([key, value]) => `${key}: ${value}`).join("\n"))
    .join("\n\n");
  const authToken = await getSupabaseAccessToken();
  const response = await fetch("/.netlify/functions/coord-email", {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      authToken,
      to: user.email,
      subject: "Notificacoes do HUB Depto Tributario",
      body,
      htmlBody: `<p>Segue o resumo das notificacoes do HUB Depto Tributario.</p><pre>${escapeHtmlText(body)}</pre>`
    })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || "Nao foi possivel enviar as notificacoes por e-mail.");
  return data;
}

function exportReport(format: ReportFormat, title: string, rows: ReportRow[]) {
  const reportRows = rows.length ? rows : [{ Info: "Nenhum registro encontrado para o filtro atual." }];
  if (format === "pdf") {
    downloadPdfReport(title, reportRows);
    return;
  }

  downloadXlsxReport(title, reportRows);
}

function openPrintableReport(title: string, rows: ReportRow[]) {
  const reportWindow = window.open("", "_blank", "noopener,noreferrer");
  if (!reportWindow) return;

  reportWindow.document.write(buildReportHtml(title, rows, true));
  reportWindow.document.close();
  reportWindow.focus();
  window.setTimeout(() => reportWindow.print(), 250);
}

function downloadPdfReport(title: string, rows: ReportRow[]) {
  const pdf = buildPdfReport(title, rows);
  downloadBlob(new Blob([pdf], { type: "application/pdf" }), `${toReportFileName(title)}.pdf`);
}

function downloadXlsxReport(title: string, rows: ReportRow[]) {
  const workbook = buildXlsxWorkbook(title, rows);
  downloadBlob(new Blob([workbook], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }), `${toReportFileName(title)}.xlsx`);
}

function downloadDocxReport(title: string, rows: ReportRow[]) {
  const docx = buildDocxReport(title, rows);
  downloadBlob(new Blob([docx], { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" }), `${toReportFileName(title)}.docx`);
}

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 2500);
}

function buildPdfReport(title: string, rows: ReportRow[]) {
  const pageWidth = 842;
  const pageHeight = 595;
  const margin = 36;
  const maxLineLength = 118;
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const lines: PdfReportLine[] = [
    { text: title, bold: true, size: 16 },
    { text: `Gerado em ${generatedAt} pelo HUB Depto Tributario.`, size: 9 },
    { text: "", size: 5 }
  ];

  rows.forEach((row, rowIndex) => {
    if (rowIndex > 0) lines.push({ text: "", size: 5 });
    lines.push({ text: `Registro ${rowIndex + 1}`, bold: true, size: 10 });
    columns.forEach((column) => {
      const value = `${column}: ${String(row[column] ?? "")}`;
      wrapReportText(value, maxLineLength).forEach((text) => lines.push({ text, size: 9 }));
    });
  });

  const pages = paginatePdfReportLines(lines, pageHeight, margin);
  const pageObjectNumbers: number[] = [];
  const contentObjectNumbers: number[] = [];
  let nextObjectNumber = 5;
  pages.forEach(() => {
    pageObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
    contentObjectNumbers.push(nextObjectNumber);
    nextObjectNumber += 1;
  });

  const objects = new Map<number, string>();
  objects.set(1, "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  objects.set(
    2,
    `2 0 obj\n<< /Type /Pages /Kids [${pageObjectNumbers.map((number) => `${number} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`
  );
  objects.set(3, "3 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n");
  objects.set(4, "4 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>\nendobj\n");

  pages.forEach((pageLines, index) => {
    const pageObjectNumber = pageObjectNumbers[index];
    const contentObjectNumber = contentObjectNumbers[index];
    const content = buildPdfReportPageStream(pageLines, pageHeight, margin);
    objects.set(
      pageObjectNumber,
      `${pageObjectNumber} 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentObjectNumber} 0 R >>\nendobj\n`
    );
    objects.set(
      contentObjectNumber,
      `${contentObjectNumber} 0 obj\n<< /Length ${encodeAscii(content).length} >>\nstream\n${content}\nendstream\nendobj\n`
    );
  });

  const maxObjectNumber = nextObjectNumber - 1;
  const offsets = new Array<number>(maxObjectNumber + 1).fill(0);
  let document = "%PDF-1.4\n% HUB Depto Tributario\n";

  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    offsets[objectNumber] = document.length;
    document += objects.get(objectNumber) || `${objectNumber} 0 obj\n<<>>\nendobj\n`;
  }

  const xrefOffset = document.length;
  document += `xref\n0 ${maxObjectNumber + 1}\n0000000000 65535 f \n`;
  for (let objectNumber = 1; objectNumber <= maxObjectNumber; objectNumber += 1) {
    document += `${String(offsets[objectNumber]).padStart(10, "0")} 00000 n \n`;
  }
  document += `trailer\n<< /Size ${maxObjectNumber + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return encodeAscii(document);
}

function paginatePdfReportLines(lines: PdfReportLine[], pageHeight: number, margin: number) {
  const pages: PdfReportLine[][] = [];
  let page: PdfReportLine[] = [];
  let cursorY = pageHeight - margin;

  lines.forEach((line) => {
    const size = line.size || 9;
    const lineHeight = size + 4;
    if (page.length && cursorY - lineHeight < margin) {
      pages.push(page);
      page = [];
      cursorY = pageHeight - margin;
    }
    page.push(line);
    cursorY -= lineHeight;
  });

  if (page.length) pages.push(page);
  return pages.length ? pages : [[{ text: "Nenhum registro encontrado.", size: 10 }]];
}

function buildPdfReportPageStream(lines: PdfReportLine[], pageHeight: number, margin: number) {
  let cursorY = pageHeight - margin;
  const commands: string[] = [];

  lines.forEach((line) => {
    const size = line.size || 9;
    const font = line.bold ? "F2" : "F1";
    if (line.text.trim()) {
      commands.push(`BT /${font} ${size} Tf 1 0 0 1 ${margin} ${cursorY.toFixed(2)} Tm <${pdfTextHex(line.text)}> Tj ET`);
    }
    cursorY -= size + 4;
  });

  return commands.join("\n");
}

function wrapReportText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (!normalized) return [""];

  const lines: string[] = [];
  let current = "";

  normalized.split(" ").forEach((word) => {
    if (!word) return;
    if (word.length > maxLength) {
      if (current) {
        lines.push(current);
        current = "";
      }
      for (let index = 0; index < word.length; index += maxLength) {
        lines.push(word.slice(index, index + maxLength));
      }
      return;
    }

    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxLength) {
      lines.push(current);
      current = word;
      return;
    }
    current = candidate;
  });

  if (current) lines.push(current);
  return lines.length ? lines : [normalized.slice(0, maxLength)];
}

function pdfTextHex(value: string) {
  return Array.from(encodeWinAnsiPdfText(value), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function encodeWinAnsiPdfText(value: string) {
  const fallbackMap: Record<number, number> = {
    0x00a0: 32,
    0x2013: 45,
    0x2014: 45,
    0x2018: 39,
    0x2019: 39,
    0x201c: 34,
    0x201d: 34,
    0x2026: 46,
    0x20ac: 128
  };
  const bytes: number[] = [];
  const normalized = value.replace(/\r?\n/g, " ").replace(/\s+/g, " ").trim();

  for (const character of normalized) {
    const codePoint = character.codePointAt(0) || 0;
    if (codePoint >= 32 && codePoint <= 255) {
      bytes.push(codePoint);
    } else {
      bytes.push(fallbackMap[codePoint] || 63);
    }
  }

  return new Uint8Array(bytes);
}

function encodeAscii(value: string) {
  const output = new Uint8Array(value.length);
  for (let index = 0; index < value.length; index += 1) {
    output[index] = value.charCodeAt(index) & 0xff;
  }
  return output;
}

function buildDocxReport(title: string, rows: ReportRow[]) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const bodyRows = rows
    .map((row) =>
      `<w:p><w:r><w:t>${escapeXmlText(columns.map((column) => `${column}: ${String(row[column] ?? "")}`).join(" | "))}</w:t></w:r></w:p>`
    )
    .join("");
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:rPr><w:b/></w:rPr><w:t>${escapeXmlText(title)}</w:t></w:r></w:p>
    <w:p><w:r><w:t>Gerado em ${escapeXmlText(generatedAt)} pelo HUB Depto Tributario.</w:t></w:r></w:p>
    ${bodyRows}
    <w:sectPr><w:pgSz w:w="16838" w:h="11906" w:orient="landscape"/><w:pgMar w:top="720" w:right="720" w:bottom="720" w:left="720"/></w:sectPr>
  </w:body>
</w:document>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>HUB Depto Tributario</dc:creator>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "word/document.xml",
      data: documentXml
    }
  ];

  return createZipArchive(files.map((file) => ({ name: file.name, data: encodeUtf8(file.data) })));
}

function buildReportHtml(title: string, rows: ReportRow[], printable: boolean) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const tableHead = columns.map((column) => `<th>${escapeHtmlText(column)}</th>`).join("");
  const tableRows = rows
    .map((row) => `<tr>${columns.map((column) => `<td>${escapeHtmlText(String(row[column] ?? ""))}</td>`).join("")}</tr>`)
    .join("");

  return `<!doctype html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8" />
  <title>${escapeHtmlText(title)}</title>
  <style>
    body { font-family: Arial, sans-serif; color: #17211c; margin: 24px; font-size: 12pt; line-height: 1.45; }
    h1 { font-size: 18pt; margin: 0 0 6px; }
    p { color: #64716b; margin: 0 0 18px; }
    table { border-collapse: collapse; width: 100%; font-size: 11pt; line-height: 1.35; }
    th, td { border: 1px solid #dce3dd; padding: 8px; text-align: left; vertical-align: top; white-space: pre-wrap; }
    th { background: #eef2ed; }
    ${printable ? "@page { size: A4 landscape; margin: 14mm; }" : ""}
  </style>
</head>
<body>
  <h1>${escapeHtmlText(title)}</h1>
  <p>Gerado em ${escapeHtmlText(generatedAt)} pelo HUB Depto Tributario.</p>
  <table>
    <thead><tr>${tableHead}</tr></thead>
    <tbody>${tableRows}</tbody>
  </table>
</body>
</html>`;
}

function buildXlsxWorkbook(title: string, rows: ReportRow[]) {
  const columns = Object.keys(rows[0] || { Info: "" });
  const generatedAt = new Date().toLocaleString("pt-BR");
  const worksheetRows = [
    columns,
    ...rows.map((row) => columns.map((column) => row[column] ?? ""))
  ];
  const columnWidths = columns.map((column, columnIndex) => {
    const widest = worksheetRows.reduce((width, row) => {
      const value = String(row[columnIndex] ?? "");
      return Math.max(width, Math.min(58, value.length + 3));
    }, Math.max(12, column.length + 3));
    return widest;
  });
  const sheetData = worksheetRows
    .map((row, rowIndex) => {
      const rowNumber = rowIndex + 1;
      const cells = row
        .map((value, columnIndex) => {
          const cellRef = `${getSpreadsheetColumnName(columnIndex + 1)}${rowNumber}`;
          const style = rowIndex === 0 ? " s=\"1\"" : "";
          return `<c r="${cellRef}"${style} t="inlineStr"><is><t>${escapeXmlText(String(value ?? ""))}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowNumber}">${cells}</row>`;
    })
    .join("");
  const cols = columnWidths
    .map((width, index) => `<col min="${index + 1}" max="${index + 1}" width="${width}" customWidth="1"/>`)
    .join("");
  const usedRange = `A1:${getSpreadsheetColumnName(Math.max(1, columns.length))}${Math.max(1, worksheetRows.length)}`;
  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
  <sheetFormatPr defaultRowHeight="18"/>
  <cols>${cols}</cols>
  <sheetData>${sheetData}</sheetData>
  <autoFilter ref="${usedRange}"/>
</worksheet>`;
  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <fileVersion appName="xl"/>
  <sheets><sheet name="${escapeXmlAttribute(getSpreadsheetSheetName(title))}" sheetId="1" r:id="rId1"/></sheets>
</workbook>`;
  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>`
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`
    },
    {
      name: "docProps/app.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>HUB Depto Tributario</Application>
  <DocSecurity>0</DocSecurity>
  <ScaleCrop>false</ScaleCrop>
  <HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs>
  <TitlesOfParts><vt:vector size="1" baseType="lpstr"><vt:lpstr>${escapeXmlText(getSpreadsheetSheetName(title))}</vt:lpstr></vt:vector></TitlesOfParts>
</Properties>`
    },
    {
      name: "docProps/core.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXmlText(title)}</dc:title>
  <dc:creator>HUB Depto Tributario</dc:creator>
  <cp:lastModifiedBy>HUB Depto Tributario</cp:lastModifiedBy>
  <dc:description>Relatorio gerado em ${escapeXmlText(generatedAt)}</dc:description>
  <dcterms:created xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${new Date().toISOString()}</dcterms:modified>
</cp:coreProperties>`
    },
    {
      name: "xl/workbook.xml",
      data: workbookXml
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`
    },
    {
      name: "xl/styles.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
  <fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFEFF3EF"/><bgColor indexed="64"/></patternFill></fill></fills>
  <borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
  <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
  <cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>
  <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`
    },
    {
      name: "xl/worksheets/sheet1.xml",
      data: worksheetXml
    }
  ];

  return createZipArchive(files.map((file) => ({ name: file.name, data: encodeUtf8(file.data) })));
}

function getSpreadsheetColumnName(index: number) {
  let name = "";
  let current = index;
  while (current > 0) {
    current -= 1;
    name = String.fromCharCode(65 + (current % 26)) + name;
    current = Math.floor(current / 26);
  }
  return name || "A";
}

function getSpreadsheetSheetName(title: string) {
  const clean = title.replace(/[:\\/?*\[\]]/g, " ").replace(/\s+/g, " ").trim();
  return (clean || "Relatorio").slice(0, 31);
}

function createZipArchive(files: Array<{ data: Uint8Array; name: string }>) {
  const localChunks: Uint8Array[] = [];
  const centralChunks: Uint8Array[] = [];
  const encodedEntries: Array<{ crc: number; data: Uint8Array; name: Uint8Array; offset: number }> = [];
  let offset = 0;

  for (const file of files) {
    const name = encodeUtf8(file.name);
    const crc = crc32(file.data);
    const localHeader = createZipLocalHeader(name, file.data.length, crc);
    encodedEntries.push({ name, data: file.data, crc, offset });
    localChunks.push(localHeader, file.data);
    offset += localHeader.length + file.data.length;
  }

  const centralDirectoryOffset = offset;
  for (const entry of encodedEntries) {
    const centralHeader = createZipCentralHeader(entry.name, entry.data.length, entry.crc, entry.offset);
    centralChunks.push(centralHeader);
    offset += centralHeader.length;
  }

  const centralDirectorySize = offset - centralDirectoryOffset;
  const endRecord = createZipEndRecord(files.length, centralDirectorySize, centralDirectoryOffset);
  return concatUint8Arrays([...localChunks, ...centralChunks, endRecord]);
}

function createZipLocalHeader(name: Uint8Array, size: number, crc: number) {
  const header = new Uint8Array(30 + name.length);
  const view = new DataView(header.buffer);
  const { date, time } = getZipDateTime();
  view.setUint32(0, 0x04034b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 0x0800, true);
  view.setUint16(8, 0, true);
  view.setUint16(10, time, true);
  view.setUint16(12, date, true);
  view.setUint32(14, crc, true);
  view.setUint32(18, size, true);
  view.setUint32(22, size, true);
  view.setUint16(26, name.length, true);
  view.setUint16(28, 0, true);
  header.set(name, 30);
  return header;
}

function createZipCentralHeader(name: Uint8Array, size: number, crc: number, localHeaderOffset: number) {
  const header = new Uint8Array(46 + name.length);
  const view = new DataView(header.buffer);
  const { date, time } = getZipDateTime();
  view.setUint32(0, 0x02014b50, true);
  view.setUint16(4, 20, true);
  view.setUint16(6, 20, true);
  view.setUint16(8, 0x0800, true);
  view.setUint16(10, 0, true);
  view.setUint16(12, time, true);
  view.setUint16(14, date, true);
  view.setUint32(16, crc, true);
  view.setUint32(20, size, true);
  view.setUint32(24, size, true);
  view.setUint16(28, name.length, true);
  view.setUint16(30, 0, true);
  view.setUint16(32, 0, true);
  view.setUint16(34, 0, true);
  view.setUint16(36, 0, true);
  view.setUint32(38, 0, true);
  view.setUint32(42, localHeaderOffset, true);
  header.set(name, 46);
  return header;
}

function createZipEndRecord(entryCount: number, centralDirectorySize: number, centralDirectoryOffset: number) {
  const record = new Uint8Array(22);
  const view = new DataView(record.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(4, 0, true);
  view.setUint16(6, 0, true);
  view.setUint16(8, entryCount, true);
  view.setUint16(10, entryCount, true);
  view.setUint32(12, centralDirectorySize, true);
  view.setUint32(16, centralDirectoryOffset, true);
  view.setUint16(20, 0, true);
  return record;
}

function getZipDateTime() {
  const now = new Date();
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | Math.floor(now.getSeconds() / 2);
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  return { date, time };
}

function concatUint8Arrays(chunks: Uint8Array[]) {
  const totalLength = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const output = new Uint8Array(totalLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function encodeUtf8(value: string) {
  return new TextEncoder().encode(value);
}

const CRC32_TABLE = buildCrc32Table();

function buildCrc32Table() {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    table[index] = crc >>> 0;
  }
  return table;
}

function crc32(data: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function escapeXmlText(value: string) {
  return value
    .replace(/[^\u0009\u000a\u000d\u0020-\ud7ff\ue000-\ufffd]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value: string) {
  return escapeXmlText(value).replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function escapeHtmlText(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const pautaTextSizeClassMap: Record<NonNullable<Pauta["textSize"]>, string> = {
  pequena: "pauta-text-small",
  normal: "pauta-text-normal",
  grande: "pauta-text-large"
};

const pautaAllowedTextSizeClasses = new Set(Object.values(pautaTextSizeClassMap));

function sanitizePautaRichHtml(value: string) {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (typeof document === "undefined") {
    return escapeHtmlText(stripHtmlTagsForPauta(source)).replace(/\n/g, "<br>");
  }

  const template = document.createElement("template");
  const hasHtml = /<\/?[a-z][\s\S]*>/i.test(source);
  template.innerHTML = hasHtml ? source : escapeHtmlText(source).replace(/\n/g, "<br>");
  const output = document.createElement("div");

  const appendCleanChildren = (node: Node, parent: Node) => {
    Array.from(node.childNodes).forEach((child) => appendCleanNode(child, parent));
  };

  const appendCleanNode = (node: Node, parent: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      parent.appendChild(document.createTextNode(node.textContent || ""));
      return;
    }

    if (!(node instanceof HTMLElement)) return;

    const tagName = node.tagName.toLowerCase();

    if (tagName === "br") {
      parent.appendChild(document.createElement("br"));
      return;
    }

    if (tagName === "b" || tagName === "strong") {
      const strong = document.createElement("strong");
      appendCleanChildren(node, strong);
      parent.appendChild(strong);
      return;
    }

    if (tagName === "i" || tagName === "em") {
      const emphasis = document.createElement("em");
      appendCleanChildren(node, emphasis);
      parent.appendChild(emphasis);
      return;
    }

    if (tagName === "mark" || hasYellowBackground(node)) {
      const mark = document.createElement("mark");
      appendCleanChildren(node, mark);
      parent.appendChild(mark);
      return;
    }

    if (tagName === "font") {
      const span = document.createElement("span");
      span.className = getPautaFontClassFromLegacySize(node.getAttribute("size"));
      appendCleanChildren(node, span);
      parent.appendChild(span);
      return;
    }

    if (tagName === "span") {
      const className = Array.from(node.classList).find((item) => pautaAllowedTextSizeClasses.has(item));
      if (className) {
        const span = document.createElement("span");
        span.className = className;
        appendCleanChildren(node, span);
        parent.appendChild(span);
        return;
      }
    }

    if (tagName === "div" || tagName === "p") {
      appendCleanChildren(node, parent);
      parent.appendChild(document.createElement("br"));
      return;
    }

    appendCleanChildren(node, parent);
  };

  appendCleanChildren(template.content, output);
  return output.innerHTML.replace(/(<br>\s*){3,}/g, "<br><br>").replace(/(<br>\s*)+$/g, "").trim();
}

function hasYellowBackground(element: HTMLElement) {
  const background = `${element.style.backgroundColor} ${element.style.background}`.toLowerCase();
  return background.includes("255, 243, 163") || background.includes("255, 248") || background.includes("yellow") || background.includes("#fff3a3");
}

function getPautaFontClassFromLegacySize(size: string | null) {
  if (size === "1" || size === "2") return pautaTextSizeClassMap.pequena;
  if (size === "4" || size === "5" || size === "6" || size === "7") return pautaTextSizeClassMap.grande;
  return pautaTextSizeClassMap.normal;
}

function pautaRichTextToPlain(value: string) {
  const source = String(value || "");
  if (!source.trim()) return "";
  if (typeof document === "undefined") return stripHtmlTagsForPauta(source);

  const container = document.createElement("div");
  container.innerHTML = sanitizePautaRichHtml(source);
  container.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
  return (container.textContent || "").replace(/\n{3,}/g, "\n\n").trim();
}

function stripHtmlTagsForPauta(value: string) {
  return String(value || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .trim();
}

function hasPautaRichContent(value: string) {
  return pautaRichTextToPlain(value).trim().length > 0;
}

function renderPautaRichHtmlForEmail(value: string) {
  return sanitizePautaRichHtml(value || "Sem acao registrada")
    .replace(/<span class="pauta-text-small">/g, '<span style="font-size:12pt;">')
    .replace(/<span class="pauta-text-normal">/g, '<span style="font-size:14pt;">')
    .replace(/<span class="pauta-text-large">/g, '<span style="font-size:16pt;">')
    .replace(/<mark>/g, '<mark style="background:#fff3a3;padding:0 2px;border-radius:3px;">');
}

function toReportFileName(title: string) {
  return normalizeForSearch(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "relatorio";
}

function formatResponsaveis(responsaveis: string[], profiles: Array<{ email: string; nome: string }> = teamMembers) {
  if (!responsaveis.length) return "Sem usuarios marcados";
  return responsaveis
    .map((emailOrName) => profiles.find((member) => member.email === emailOrName)?.nome || emailOrName)
    .join(", ");
}

function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function isPautaAssignedToUser(pauta: Pauta, user: HubUser) {
  if ((pauta.responsaveis || []).some((email) => email.toLowerCase() === user.email.toLowerCase())) return true;
  if (pauta.createdBy === user.id || pauta.createdBy === user.email) return true;
  const pautaEmail = normalizeForSearch(pauta.email);
  const userEmail = normalizeForSearch(user.email);
  const pautaResponsavel = normalizeForSearch(pauta.responsavel);
  const userName = normalizeForSearch(user.nome);

  if (pautaEmail && pautaEmail === userEmail) return true;
  if (!pautaResponsavel || !userName) return false;

  return pautaResponsavel.includes(userName) || userName.includes(pautaResponsavel);
}

function isPautaGeneral(pauta: Pauta) {
  if (pauta.scope) return pauta.scope === "todos";
  const pautaEmail = normalizeForSearch(pauta.email);
  const pautaResponsavel = normalizeForSearch(pauta.responsavel);

  return (
    !pautaEmail &&
    (!pautaResponsavel ||
      pautaResponsavel.includes("equipe") ||
      pautaResponsavel.includes("todos") ||
      pautaResponsavel.includes("geral"))
  );
}

function canUserViewPauta(pauta: Pauta, user: HubUser) {
  return canUserViewPautaApp(pauta, user);
}

function isTaskAssignedToUser(task: TaskItem, user: HubUser, profiles: HubProfile[] = []) {
  const userTokens = getTaskUserTokens(user, profiles);
  const ownerTokens = getProfileIdentityTokens(task.createdBy || "", profiles);
  const responsavelTokens = new Set(task.responsaveis.flatMap((responsavel) => [...getProfileIdentityTokens(responsavel, profiles)]));

  return userTokens.some((token) => {
    if (!token) return false;
    if (ownerTokens.has(token)) return true;
    return responsavelTokens.has(token);
  });
}

function isTaskOwnerForUser(task: TaskItem, user: HubUser, profiles: HubProfile[] = []) {
  const userTokens = getTaskUserTokens(user, profiles);
  const ownerTokens = getProfileIdentityTokens(task.createdBy || "", profiles);
  return userTokens.some((token) => token && ownerTokens.has(token));
}

function getTaskUserTokens(user: HubUser, profiles: HubProfile[] = []) {
  const baseTokens = [user.id, user.email, user.nome];
  const normalizedEmail = normalizeForSearch(user.email);
  const normalizedId = normalizeForSearch(user.id || "");
  const matchedProfile = profiles.find((profile) => {
    return normalizeForSearch(profile.email) === normalizedEmail || (profile.id && normalizeForSearch(profile.id) === normalizedId);
  });
  const profileTokens = matchedProfile
    ? [matchedProfile.id, matchedProfile.email, matchedProfile.nome, matchedProfile.iniciais]
    : [];

  return [...new Set([...baseTokens, ...profileTokens].filter((value): value is string => Boolean(value)).map((value) => normalizeForSearch(value)))];
}

function getProfileIdentityTokens(value: string, profiles: HubProfile[] = []) {
  const normalizedValue = normalizeForSearch(value);
  const tokens = new Set<string>();
  if (normalizedValue) tokens.add(normalizedValue);

  profiles
    .filter((profile) =>
      [profile.id, profile.email, profile.nome, profile.iniciais]
        .filter(Boolean)
        .some((token) => normalizeForSearch(String(token)) === normalizedValue)
    )
    .forEach((profile) => {
      [profile.id, profile.email, profile.nome, profile.iniciais]
        .filter(Boolean)
        .forEach((token) => tokens.add(normalizeForSearch(String(token))));
    });

  return tokens;
}

function isPautaAlta(pauta: Pauta) {
  return normalizeForSearch(`${pauta.prioridade} ${pauta.status}`).includes("alta");
}

function isPautaConcluida(pauta: Pauta) {
  return normalizeForSearch(`${pauta.status} ${pauta.concluidoEm}`).includes("conclu");
}

function isPautaAtrasada(pauta: Pauta) {
  const status = normalizeForSearch(pauta.status);
  if (isPautaConcluida(pauta)) return false;
  if (status.includes("atrasad") || status.includes("vencid")) return true;
  return getDueTone(pauta.prazo) === "danger";
}

function getPautaTone(pauta: Pauta) {
  if (isPautaConcluida(pauta)) return "ok";
  if (isPautaAtrasada(pauta)) return "danger";
  return getDueTone(pauta.prazo);
}

function getPautaContentStyle(pauta: Pauta): CSSProperties {
  return {
    fontSize: getPautaFontSize(pauta.textSize),
    fontWeight: pauta.textBold ? 850 : undefined,
    fontStyle: pauta.textItalic ? "italic" : undefined
  };
}

function getPautaDescriptionStyle(pauta: Pauta): CSSProperties {
  if (!pauta.textHighlight) return {};
  return {
    background: "#fff3a3",
    borderRadius: "4px",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
    padding: "1px 3px"
  };
}

function getPautaFontSize(size: Pauta["textSize"]) {
  if (size === "pequena") return "12px";
  if (size === "grande") return "16px";
  return "14px";
}

function getPautaExecFontSize(size: Pauta["textSize"]) {
  if (size === "pequena") return "2";
  if (size === "grande") return "4";
  return "3";
}

function sortPautasForDashboard(pautas: Pauta[]) {
  const toneOrder = { danger: 0, warning: 1, ok: 2, neutral: 3 } as const;

  return [...pautas].sort((a, b) => {
    const toneDiff = toneOrder[getPautaTone(a)] - toneOrder[getPautaTone(b)];
    if (toneDiff !== 0) return toneDiff;

    const priorityDiff = Number(isPautaAlta(b)) - Number(isPautaAlta(a));
    if (priorityDiff !== 0) return priorityDiff;

    return getDateSortValue(a.prazo) - getDateSortValue(b.prazo);
  });
}

function countPautaStatus(pautas: Pauta[], user: HubUser) {
  return pautas.reduce(
    (acc, pauta) => {
      if (isPautaAssignedToUser(pauta, user)) acc.minhas += 1;
      if (pauta.destaque) acc.destaques += 1;
      if (isPautaAlta(pauta)) acc.alta += 1;
      if (isPautaAtrasada(pauta)) acc.atrasado += 1;
      if (isPautaConcluida(pauta)) acc.concluidas += 1;
      if (!pauta.prazo.trim()) acc.semPrazo += 1;
      return acc;
    },
    { alta: 0, atrasado: 0, concluidas: 0, destaques: 0, minhas: 0, semPrazo: 0 }
  );
}

function buildSystemNotifications({
  hubUsers,
  lembretes,
  pautas,
  tasks,
  user
}: {
  hubUsers: HubProfile[];
  lembretes: Lembrete[];
  pautas: Pauta[];
  tasks: TaskItem[];
  user: HubUser;
}): HubNotification[] {
  return [
    ...buildLembreteNotifications(lembretes, hubUsers, user),
    ...buildPautaNotifications(pautas, user),
    ...buildTaskNotifications(tasks, hubUsers, user)
  ];
}

function buildLembreteNotifications(lembretes: Lembrete[], profiles: HubProfile[], user: HubUser): HubNotification[] {
  const eventNotifications = lembretes.flatMap((lembrete) => {
    if (lembrete.status === "concluido") return [];
    const notifications: HubNotification[] = [];
    const isOwner = lembrete.createdBy === user.id || lembrete.createdBy === user.email;
    const isMarked = lembrete.responsaveis.some((responsavel) => responsavel.toLowerCase() === user.email.toLowerCase());

    if (isRecentIso(lembrete.createdAt, 7) && isOwner) {
      notifications.push(
        createNotification({
          dedupeKey: `lembrete:${lembrete.id}:created`,
          detail: `Criado em ${formatDateTime(lembrete.createdAt)}`,
          meta: formatResponsaveis(lembrete.responsaveis, profiles),
          route: "lembretes",
          targetRef: lembrete.id,
          targetType: "lembrete",
          title: `Lembrete criado: ${lembrete.titulo}`,
          tipo: "lembrete_created",
          tone: "info"
        })
      );
    }

    if (isRecentIso(lembrete.createdAt, 7) && isMarked && !isOwner) {
      notifications.push(
        createNotification({
          dedupeKey: `lembrete:${lembrete.id}:assigned:${user.email}`,
          detail: `Prazo: ${formatDateTime(lembrete.prazo)}`,
          meta: `Criado por ${formatOwner(lembrete.createdBy, profiles)}`,
          route: "lembretes",
          targetRef: lembrete.id,
          targetType: "lembrete",
          title: `Voce foi marcado: ${lembrete.titulo}`,
          tipo: "lembrete_assigned",
          tone: "info"
        })
      );
    }

    return notifications;
  });

  const dueNotifications = lembretes
    .map((lembrete) => ({ lembrete, tone: getDueTone(lembrete.prazo) }))
    .filter(
      (item): item is { lembrete: Lembrete; tone: "danger" | "warning" } =>
        item.lembrete.status !== "concluido" && (item.tone === "danger" || item.tone === "warning")
    )
    .sort((a, b) => {
      const toneOrder = a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1;
      if (toneOrder !== 0) return toneOrder;
      return getDateSortValue(a.lembrete.prazo) - getDateSortValue(b.lembrete.prazo);
    })
    .map(({ lembrete, tone }) =>
      createNotification({
        dedupeKey: `lembrete:${lembrete.id}:${tone}`,
        title: lembrete.titulo,
        detail: tone === "danger" ? `Vencido: ${formatDateTime(lembrete.prazo)}` : `Vence em ate 24h: ${formatDateTime(lembrete.prazo)}`,
        meta: formatResponsaveis(lembrete.responsaveis, profiles),
        tone,
        route: "lembretes",
        tipo: tone === "danger" ? "lembrete_overdue" : "lembrete_due",
        targetType: "lembrete",
        targetRef: lembrete.id
      })
    );

  return [...dueNotifications, ...eventNotifications].sort(sortNotificationsForDisplay);
}

function buildPautaNotifications(pautas: Pauta[], user: HubUser): HubNotification[] {
  return pautas
    .filter((pauta) => !isPautaConcluida(pauta) && pauta.prazo.trim())
    .filter((pauta) => user.role !== "colaborador" || isPautaAssignedToUser(pauta, user))
    .map((pauta) => ({ pauta, tone: isPautaAtrasada(pauta) ? "danger" : getDueTone(pauta.prazo) }))
    .filter(
      (item): item is { pauta: Pauta; tone: "danger" | "warning" } =>
        item.tone === "danger" || item.tone === "warning"
    )
    .map(({ pauta, tone }) => {
      return createNotification({
        dedupeKey: `pauta:${pauta.id}:${tone}`,
        title: pauta.tema,
        detail: tone === "danger" ? `Pauta atrasada: ${formatDate(pauta.prazo)}` : `Pauta vence em ate 24h: ${formatDate(pauta.prazo)}`,
        meta: pauta.responsavel || pauta.email || "Sem responsavel definido",
        tone,
        route: "home",
        tipo: tone === "danger" ? "pauta_overdue" : "pauta_due",
        targetType: "pauta",
        targetRef: pauta.id
      });
    })
    .sort(sortNotificationsForDisplay);
}

function buildTaskNotifications(tasks: TaskItem[], profiles: HubProfile[], user: HubUser): HubNotification[] {
  const eventNotifications = tasks.flatMap((task) => {
    if (task.status === "concluida") return [];
    const isOwner = isTaskOwnerForUser(task, user, profiles);
    const isMarked = isTaskAssignedToUser(task, user, profiles);
    if (!isRecentIso(task.createdAt, 7) || !isMarked || isOwner) return [];

    return [
      createNotification({
        dedupeKey: `tarefa:${task.id}:assigned:${user.email}`,
        detail: task.prazo ? `Prazo: ${formatDateTime(task.prazo)}` : "Sem prazo definido",
        meta: `Criada por ${formatOwner(task.createdBy, profiles)}`,
        route: "tarefas",
        targetRef: task.id,
        targetType: "tarefa",
        title: `Voce foi marcado em uma tarefa: ${task.titulo}`,
        tipo: "tarefa_assigned",
        tone: "info"
      })
    ];
  });

  const dueNotifications = tasks
    .map((task) => ({ task, tone: getDueTone(task.prazo) }))
    .filter(
      (item): item is { task: TaskItem; tone: "danger" | "warning" } =>
        item.task.status !== "concluida" &&
        (isTaskAssignedToUser(item.task, user, profiles) || user.role === "admin" || user.role === "gestor") &&
        (item.tone === "danger" || item.tone === "warning")
    )
    .map(({ task, tone }) =>
      createNotification({
        dedupeKey: `tarefa:${task.id}:${tone}:${user.email}`,
        detail: tone === "danger" ? `Tarefa vencida: ${formatDateTime(task.prazo)}` : `Tarefa vence em ate 24h: ${formatDateTime(task.prazo)}`,
        meta: formatResponsaveis(task.responsaveis, profiles),
        route: "tarefas",
        targetRef: task.id,
        targetType: "tarefa",
        title: task.titulo,
        tipo: tone === "danger" ? "tarefa_overdue" : "tarefa_due",
        tone
      })
    );

  return [...dueNotifications, ...eventNotifications].sort(sortNotificationsForDisplay);
}

function createNotification({
  dedupeKey,
  detail,
  meta,
  route,
  targetRef,
  targetType,
  title,
  tipo,
  tone
}: {
  dedupeKey: string;
  detail: string;
  meta: string;
  route: HubRoute;
  targetRef: string;
  targetType: string;
  title: string;
  tipo: string;
  tone: HubNotification["tone"];
}): HubNotification {
  const now = new Date().toISOString();

  return {
    id: dedupeKey,
    dedupeKey,
    tipo,
    title,
    detail,
    meta,
    tone,
    route,
    targetRef,
    targetType,
    active: true,
    createdAt: now,
    updatedAt: now
  };
}

function sortNotificationsForDisplay(a: HubNotification, b: HubNotification) {
  const toneOrder = { danger: 0, warning: 1, info: 2 } as const;
  const toneDiff = toneOrder[a.tone] - toneOrder[b.tone];
  if (toneDiff !== 0) return toneDiff;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function formatOwner(owner: string, profiles: HubProfile[]) {
  return profiles.find((profile) => profile.id === owner || profile.email === owner)?.nome || owner;
}

function isRecentIso(value: string, days: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

function getDateSortValue(value: string) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const brDate = parseBrazilianDate(value);
  const timestamp = (brDate || new Date(value)).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

function getDueTone(value: string) {
  if (!value) return "neutral";
  const brDate = parseBrazilianDate(value);
  const due = (brDate || new Date(value)).getTime();
  if (Number.isNaN(due)) return "neutral";

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (due < now) return "danger";
  if (due - now <= day) return "warning";
  return "ok";
}

function formatDate(value: string) {
  if (!value) return "Sem prazo";
  const brDate = parseBrazilianDate(value);
  if (brDate) return brDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

function formatDateTime(value: string) {
  if (!value) return "Sem prazo";
  const brDate = parseBrazilianDate(value);
  if (brDate) {
    return brDate.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function toDatetimeLocalValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  const brDate = parseBrazilianDate(value);
  const date = brDate || new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function parseBrazilianDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;

  const [, day, month, year, hour = "00", minute = "00"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function isPdfRenderCancelled(error: unknown) {
  const message = error instanceof Error ? error.message : String((error as { message?: string } | null)?.message || error || "");
  const name = error && typeof error === "object" && "name" in error ? String((error as { name?: unknown }).name || "") : "";
  return name === "RenderingCancelledException" || /cancel/i.test(message);
}

function triggerOcrProtocol() {
  if (typeof window === "undefined") return false;

  try {
    window.location.href = "hubocr://rodar";
    return true;
  } catch {
    return false;
  }
}

function summarizeLocalOcrOutput(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const foundLine = [...lines].reverse().find((line) => /^Arquivos encontrados:/i.test(line));
  const statusLines = lines.filter((line) => /^OK:|^ERRO:/i.test(line)).slice(-3);

  if (!lines.length) return "OCR executado. Lista de arquivos atualizada.";
  if (statusLines.length) return [foundLine, ...statusLines].filter(Boolean).join(" ");
  return lines.slice(-2).join(" ");
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Nao foi possivel concluir a operacao.");
  }
  return "Nao foi possivel concluir a operacao.";
}
