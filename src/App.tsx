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
import { loadPautas, sheetsHubUrl, teamMembers } from "./data/hubData";
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
import { getStoredSession, signIn, signOut } from "./lib/auth";
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

type PautaFilter = "todas" | "minhas" | "alta" | "atrasadas" | "semPrazo";
type TaskFilter = "todas" | "minhas" | "abertas" | "concluidas";
type HealthStatusTone = "ok" | "warning" | "info";
type ViewerPreviewMode = "image" | "iframe" | "unsupported";

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

const routes = [
  { id: "home", label: "Inicio", icon: Home },
  { id: "tarefas", label: "Tarefas", icon: CalendarDays },
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

const appFrames: Record<"agenda" | "pomodoro" | "coord", { title: string; src: string }> = {
  agenda: { title: "Agenda tributaria", src: "/apps/agenda-tributaria.html" },
  pomodoro: { title: "Pomodoro Timer", src: "/apps/pomodoro.html" },
  coord: { title: "Coordenacao tributaria", src: "/apps/coord-tributaria.html" }
};

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
  const [usersVersion, setUsersVersion] = useState(0);
  const [hubUsers, setHubUsers] = useState<HubProfile[]>([]);
  const [notificationItems, setNotificationItems] = useState<HubNotification[]>([]);

  useEffect(() => {
    function handleLembretesChange() {
      setLembretesVersion((version) => version + 1);
    }

    window.addEventListener("hub:lembretes", handleLembretesChange);
    return () => window.removeEventListener("hub:lembretes", handleLembretesChange);
  }, []);

  useEffect(() => {
    function handleUsersChange() {
      setUsersVersion((version) => version + 1);
    }

    window.addEventListener("hub:users", handleUsersChange);
    return () => window.removeEventListener("hub:users", handleUsersChange);
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

    Promise.all([listAppLembretes(user), loadPautas()])
      .then(([lembretes, pautas]) => {
        if (!active) return undefined;
        const visiblePautas = user.role === "colaborador" ? pautas.filter((pauta) => canUserViewPauta(pauta, user)) : pautas;
        return syncAppNotifications(user, buildSystemNotifications({ hubUsers, lembretes, pautas: visiblePautas, user }));
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
  }, [hubUsers, lembretesVersion, user]);

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
    </div>
  );
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

  useEffect(() => {
    setNotificationsOpen(false);
  }, [route]);

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
            Sheets HUB <strong>CSV local</strong>
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
                {notificationItems.length ? (
                  <button className="notification-read-all" type="button" onClick={onNotificationsReadAll}>
                    Marcar todas
                  </button>
                ) : null}
              </header>

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
  if (route === "home") return <Dashboard hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
  if (route === "tarefas") return <TasksModule hubUsers={hubUsers} user={user} />;
  if (route === "lembretes") return <LembretesModule hubUsers={hubUsers} user={user} />;
  if (route === "arquivos") return <ArquivosModule user={user} />;
  if (route === "links") return <LinksModule user={user} />;
  if (route === "admin") return <AdminModule currentUser={user} />;
  if (route === "agenda" || route === "pomodoro" || route === "coord") {
    return <ModuleFrame title={appFrames[route].title} src={appFrames[route].src} />;
  }
  return <Dashboard hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
}

function Dashboard({
  hubUsers,
  onNavigate,
  user
}: {
  hubUsers: HubProfile[];
  onNavigate: (route: HubRoute) => void;
  user: HubUser;
}) {
  const [pautas, setPautas] = useState<Pauta[]>([]);
  const [lembretes, setLembretes] = useState<Lembrete[]>([]);
  const [loading, setLoading] = useState(true);
  const [lembretesLoading, setLembretesLoading] = useState(true);
  const [pautaQuery, setPautaQuery] = useState("");
  const [pautaFilter, setPautaFilter] = useState<PautaFilter>("todas");
  const [lembreteQuery, setLembreteQuery] = useState("");

  useEffect(() => {
    loadPautas()
      .then(setPautas)
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshLembretes() {
      setLembretesLoading(true);
      try {
        const loaded = await listAppLembretes(user);
        if (active) setLembretes(loaded);
      } finally {
        if (active) setLembretesLoading(false);
      }
    }

    refreshLembretes();
    window.addEventListener("hub:lembretes", refreshLembretes);

    return () => {
      active = false;
      window.removeEventListener("hub:lembretes", refreshLembretes);
    };
  }, [user]);

  const canManagePautas = user.role === "admin";
  const canSeeAllPautas = user.role === "admin" || user.role === "gestor";

  const visiblePautas = useMemo(() => {
    const allowed = canSeeAllPautas ? pautas : pautas.filter((pauta) => canUserViewPauta(pauta, user));
    return sortPautasForDashboard(allowed);
  }, [canSeeAllPautas, pautas, user]);

  const filteredPautas = useMemo(() => {
    const query = normalizeForSearch(pautaQuery);
    return visiblePautas.filter((pauta) => {
      if (pautaFilter === "minhas" && !isPautaAssignedToUser(pauta, user)) return false;
      if (pautaFilter === "alta" && !isPautaAlta(pauta)) return false;
      if (pautaFilter === "atrasadas" && !isPautaAtrasada(pauta)) return false;
      if (pautaFilter === "semPrazo" && pauta.prazo.trim()) return false;

      if (!query) return true;

      return normalizeForSearch(
        [pauta.tema, pauta.acoes, pauta.responsavel, pauta.email, pauta.status, pauta.prioridade, pauta.pendenciasObs, pauta.retorno].join(" ")
      ).includes(query);
    });
  }, [pautaFilter, pautaQuery, user, visiblePautas]);
  const filteredLembretes = useMemo(() => {
    const query = lembreteQuery.trim().toLowerCase();
    if (!query) return lembretes;
    return lembretes.filter((lembrete) =>
      [lembrete.titulo, lembrete.descricao, lembrete.prioridade, lembrete.status].join(" ").toLowerCase().includes(query)
    );
  }, [lembreteQuery, lembretes]);
  const statusCounts = useMemo(() => countPautaStatus(visiblePautas, user), [user, visiblePautas]);
  const overdueLembretes = lembretes.filter((lembrete) => getDueTone(lembrete.prazo) === "danger").length;
  const todayLembretes = lembretes.filter((lembrete) => getDueTone(lembrete.prazo) === "warning").length;
  const pautaStatusLabel = loading
    ? "Sincronizando"
    : `${canSeeAllPautas ? "CSV HUB" : "minhas pautas"} - ${visiblePautas.length} itens`;

  return (
    <div className="dashboard-grid">
      <section className="panel panel--pautas">
        <DashboardPanelHeader
          actionLabel={canManagePautas ? "Nova" : undefined}
          actionTitle="Abrir planilha HUB para cadastrar pauta"
          icon={<ListChecks size={18} />}
          onAction={canManagePautas ? () => window.open(sheetsHubUrl, "_blank", "noopener,noreferrer") : undefined}
          secondaryIcon={<Filter size={14} />}
          secondaryLabel="Filtrar"
          status={pautaStatusLabel}
          title="Pautas"
        />
        <div className="panel-toolbar">
          <button className={`filter-pill ${pautaFilter === "todas" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("todas")}>
            Todas ({visiblePautas.length})
          </button>
          <button className={`filter-pill ${pautaFilter === "minhas" ? "active" : ""}`} type="button" onClick={() => setPautaFilter("minhas")}>
            Minhas ({statusCounts.minhas})
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
          <label className="panel-search">
            <Search size={14} />
            <input
              aria-label="Buscar pautas"
              onChange={(event) => setPautaQuery(event.target.value)}
              placeholder="Buscar..."
              value={pautaQuery}
            />
          </label>
        </div>
        <div className="stack-list">
          {filteredPautas.map((pauta) => (
            <article className="list-row list-row--pauta" key={pauta.id}>
              <div>
                <strong>{pauta.tema}</strong>
                <span>{pauta.acoes || pauta.pendenciasObs || "Sem acao registrada"}</span>
                {pauta.retorno ? <span className="pauta-return">Retorno: {pauta.retorno}</span> : null}
                <em>{pauta.responsavel || "Sem responsavel definido"}{pauta.email ? ` - ${pauta.email}` : ""}</em>
              </div>
              <div className="pauta-row-badges">
                <StatusPill label={pauta.status || "Sem status"} />
                {pauta.prioridade ? <StatusPill label={pauta.prioridade} /> : null}
              </div>
              <small className={`pauta-date pauta-date--${getPautaTone(pauta)}`}>
                <CalendarDays size={12} />
                {formatDate(pauta.prazo)} - {pauta.origem}
              </small>
            </article>
          ))}
          {!filteredPautas.length && !loading ? (
            <div className="empty-state">
              Nenhuma pauta encontrada para o filtro atual.
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel panel--lembretes">
        <DashboardPanelHeader
          actionLabel="Novo"
          icon={<Bell size={18} />}
          onAction={() => onNavigate("lembretes")}
          secondaryIcon={<Bell size={14} />}
          secondaryLabel="Avisos"
          status={lembretesLoading ? "Carregando" : `${getLembretesSource(user)} - ${lembretes.length} itens`}
          title="Lembretes"
        />
        <div className="panel-toolbar">
          <button className="filter-pill active" type="button">
            Todos ({lembretes.length})
          </button>
          <button className="filter-pill filter-pill--danger" type="button">
            Atrasados ({overdueLembretes})
          </button>
          <button className="filter-pill filter-pill--warning" type="button">
            Hoje ({todayLembretes})
          </button>
          <label className="panel-search">
            <Search size={14} />
            <input
              aria-label="Buscar lembretes"
              onChange={(event) => setLembreteQuery(event.target.value)}
              placeholder="Buscar..."
              value={lembreteQuery}
            />
          </label>
        </div>
        <div className="stack-list">
          {filteredLembretes.map((lembrete) => (
            <article className="list-row" key={lembrete.id}>
              <div>
                <strong>{lembrete.titulo}</strong>
                <span>{lembrete.descricao || "Sem descricao"}</span>
                <em>{formatResponsaveis(lembrete.responsaveis, hubUsers)}</em>
              </div>
              <DueSignal prazo={lembrete.prazo} />
              <small>{formatDateTime(lembrete.prazo)} - {lembrete.anexos.length} anexo(s)</small>
            </article>
          ))}
        </div>
      </section>

      <FooterUpdates />
    </div>
  );
}

function DashboardPanelHeader({
  actionLabel,
  actionTitle,
  icon,
  onAction,
  secondaryIcon,
  secondaryLabel,
  status,
  title
}: {
  actionLabel?: string;
  actionTitle?: string;
  icon: React.ReactNode;
  onAction?: () => void;
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
        <button className="btn-mini" type="button">
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
  return (
    <div className="updates-sidebar-backdrop" role="presentation" onClick={onClose}>
      <aside className="updates-sidebar" aria-label={title} role="dialog" onClick={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>{title}</strong>
            <small>{kind === "legislacao" ? "Normas oficiais monitoradas" : "Ultimos 7 dias"} - {items.length} item(ns)</small>
          </div>
          <button aria-label="Fechar atualizacoes" type="button" onClick={onClose}>
            <X size={18} />
          </button>
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

function TasksModule({ hubUsers, user }: { hubUsers: HubProfile[]; user: HubUser }) {
  const [calendarVersion, setCalendarVersion] = useState(0);

  useEffect(() => {
    function refreshCalendarFrame() {
      setCalendarVersion((version) => version + 1);
    }

    function handleMessage(event: MessageEvent) {
      if (event.origin === window.location.origin && event.data?.type === "hub:tasks") {
        refreshCalendarFrame();
      }
    }

    window.addEventListener("hub:tasks", refreshCalendarFrame);
    window.addEventListener("message", handleMessage);

    return () => {
      window.removeEventListener("hub:tasks", refreshCalendarFrame);
      window.removeEventListener("message", handleMessage);
    };
  }, []);

  return (
    <div className="tasks-layout">
      <div className="calendar-shell">
        <iframe key={calendarVersion} src="/apps/calendar.html" title="Calendario de tarefas" />
      </div>
      <TaskSidebar hubUsers={hubUsers} user={user} />
    </div>
  );
}

function TaskSidebar({ hubUsers, user }: { hubUsers: HubProfile[]; user: HubUser }) {
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<TaskFilter>("todas");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [prazo, setPrazo] = useState("");
  const [prioridade, setPrioridade] = useState<TaskItem["prioridade"]>("normal");
  const [responsaveis, setResponsaveis] = useState<string[]>([]);
  const [anexos, setAnexos] = useState<string[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
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

    async function syncCalendarMessage(data: { action?: string; event?: unknown; id?: string }) {
      try {
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
    const interval = window.setInterval(() => refresh({ silent: true }), 3000);
    window.addEventListener("hub:tasks", handleHubTasks);
    window.addEventListener("message", handleMessage);

    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener("hub:tasks", handleHubTasks);
      window.removeEventListener("message", handleMessage);
    };
  }, [user]);

  const filteredTasks = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);
    return tasks
      .filter((task) => {
        if (filter === "minhas") return isTaskAssignedToUser(task, user);
        if (filter === "abertas") return task.status === "aberta";
        if (filter === "concluidas") return task.status === "concluida";
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
  }, [filter, hubUsers, query, tasks, user]);

  function resetForm() {
    setEditingId(null);
    setTitulo("");
    setDescricao("");
    setPrazo("");
    setPrioridade("normal");
    setResponsaveis([]);
    setAnexos([]);
    setSelectedFiles([]);
  }

  function startEdit(task: TaskItem) {
    if (!canUserManageTask(task, user)) {
      setError("Voce pode visualizar esta tarefa, mas apenas o criador, gestor ou administrador pode altera-la.");
      return;
    }

    setEditingId(task.id);
    setTitulo(task.titulo);
    setDescricao(task.descricao);
    setPrazo(task.prazo);
    setPrioridade(task.prioridade);
    setResponsaveis(task.responsaveis);
    setAnexos(task.anexos);
    setSelectedFiles([]);
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
      setTasks(saved);
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

  return (
    <aside className="task-sidebar">
      <header>
        <div>
          <h2>Tarefas</h2>
          <small>{loading ? "Carregando..." : `${source} - ${tasks.length} item(ns)`}</small>
        </div>
        <span>{tasks.filter((task) => task.status === "aberta").length} abertas</span>
      </header>

      <form className="task-form" onSubmit={handleSubmit}>
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
            <select value={prioridade} onChange={(event) => setPrioridade(event.target.value as TaskItem["prioridade"])}>
              <option value="normal">Normal</option>
              <option value="alta">Alta</option>
              <option value="baixa">Baixa</option>
            </select>
          </label>
        </div>
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
            {saving ? "Salvando..." : editingId ? "Atualizar tarefa" : "Salvar tarefa"}
          </button>
          {editingId ? (
            <button disabled={saving} type="button" onClick={resetForm}>
              Cancelar
            </button>
          ) : null}
        </div>
      </form>

      <div className="panel-toolbar task-toolbar">
        <button className={`filter-pill ${filter === "todas" ? "active" : ""}`} onClick={() => setFilter("todas")} type="button">
          Todas ({tasks.length})
        </button>
        <button className={`filter-pill ${filter === "minhas" ? "active" : ""}`} onClick={() => setFilter("minhas")} type="button">
          Minhas ({tasks.filter((task) => isTaskAssignedToUser(task, user)).length})
        </button>
        <button className={`filter-pill ${filter === "abertas" ? "active" : ""}`} onClick={() => setFilter("abertas")} type="button">
          Abertas ({tasks.filter((task) => task.status === "aberta").length})
        </button>
        <label className="panel-search">
          <Search size={14} />
          <input aria-label="Buscar tarefas" onChange={(event) => setQuery(event.target.value)} placeholder="Buscar..." value={query} />
        </label>
      </div>

      {error ? <p className="module-error module-error--compact">{error}</p> : null}

      <div className="task-list">
        {filteredTasks.map((task) => {
          const canManage = canUserManageTask(task, user);

          return (
            <article className={`task-item task-item--${task.status}`} key={task.id}>
              <CheckCircle2 size={17} />
              <div>
                <strong>{task.titulo}</strong>
                <span>{task.descricao || "Sem descricao"}</span>
                <small>{task.prazo ? formatDateTime(task.prazo) : "Sem prazo"} - {formatResponsaveis(task.responsaveis, hubUsers)}</small>
                <div className="lembrete-tags">
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
                      Editar
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
  const source = getArquivosSource();
  const viewerStudyResource = useMemo(() => (viewerResource ? getStudyResource(viewerResource) : null), [viewerResource]);
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

  async function openViewer(resource: FileResource) {
    if (!resource.url && !resource.processedUrl) return;
    setViewerResource(resource);
    setViewerZoom(100);
    setViewerPage(1);
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
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${toSafeDownloadFileName(viewerResource.titulo || viewerResource.fileName || "arquivo")}-anotacoes.md`;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
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
                <div>
                  <FileArchive size={17} />
                  <span>{resource.kind === "upload" ? "Upload" : formatFileCategory(resource.categoria)}</span>
                </div>
                <strong>{resource.titulo}</strong>
                <p>{resource.descricao || "Sem descricao"}</p>
                <small>
                  {resource.scope === "global" ? "Global" : "Pessoal"} - {folderNames.get(resource.folderId) || "Sem pasta"} -{" "}
                  {formatDate(resource.createdAt)}
                </small>
                {resource.fileName ? <small>{resource.fileName}</small> : null}
                {processingBadge ? (
                  <span className={`processing-badge processing-badge--${processingBadge.tone}`}>{processingBadge.label}</span>
                ) : null}
                {resource.processingMessage ? <small>{resource.processingMessage}</small> : null}
                <small>{resource.scope === "global" ? "Global" : "Pessoal"} - {formatDate(resource.createdAt)}</small>
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
                  {viewerResource.processingStatus === "ready" && viewerResource.processedFileName
                    ? `${viewerResource.processedFileName} - versao para estudo`
                    : viewerResource.fileName || formatFileCategory(viewerResource.categoria)}
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
              <label>
                Pagina
                <input min={1} type="number" value={viewerPage} onChange={(event) => setViewerPage(Math.max(1, Number(event.target.value) || 1))} />
              </label>
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
              <a href={viewerResource.url} rel="noreferrer" target="_blank">
                Abrir em nova aba
              </a>
            </div>

            <div className="document-viewer-body">
              <div className={`document-preview ${viewerPreview?.notice ? "document-preview--with-banner" : ""}`}>
                {viewerPreview?.notice ? <div className="document-preview-banner">{viewerPreview.notice}</div> : null}
                {isPdfResource(viewerResource) ? (
                  <InternalPdfViewer
                    highlightNotes={viewerNotes.filter((note) => note.kind === "highlight")}
                    page={viewerPage}
                    resource={viewerResource}
                    searchIndex={viewerSearchIndex}
                    searchTerm={viewerSearchTerm}
                    zoom={viewerZoom}
                    onSearchStats={handleViewerSearchStats}
                    onSelectText={setViewerHighlight}
                  />
                ) : isDocxResource(viewerResource) ? (
                  <InternalDocxViewer
                    highlightNotes={viewerNotes.filter((note) => note.kind === "highlight")}
                    resource={viewerResource}
                    searchIndex={viewerSearchIndex}
                    searchTerm={viewerSearchTerm}
                    onSearchStats={handleViewerSearchStats}
                    onSelectText={setViewerHighlight}
                  />
                ) : viewerPreview?.mode === "image" ? (
                  <div className="document-preview__image-scroll">
                    <img
                      alt={viewerResource.titulo}
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
                    <a href={viewerResource.url} rel="noreferrer" target="_blank">
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
  onSearchStats,
  onSelectText,
  page,
  resource,
  searchIndex,
  searchTerm,
  zoom
}: {
  highlightNotes: FileViewerNote[];
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
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [spans, setSpans] = useState<PdfTextSpan[]>([]);
  const [pageSize, setPageSize] = useState({ width: 0, height: 0 });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const highlightTerms = useMemo(() => getViewerManualHighlightTerms(highlightNotes), [highlightNotes]);
  const normalizedSearchTerm = normalizeForSearch(searchTerm);
  const searchPlan = useMemo(() => buildPdfSearchPlan(spans, normalizedSearchTerm), [normalizedSearchTerm, spans]);

  useEffect(() => {
    onSearchStats(searchPlan.total);
  }, [onSearchStats, searchPlan.total]);

  useEffect(() => {
    if (!searchPlan.total) return;
    const target = containerRef.current?.querySelector(`[data-search-index="${searchIndex}"]`);
    target?.scrollIntoView({ block: "center", inline: "center", behavior: "smooth" });
  }, [searchIndex, searchPlan.total]);

  useEffect(() => {
    let active = true;

    async function renderPdf() {
      const canvas = canvasRef.current;
      if (!canvas) return;

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
        const safePage = Math.min(Math.max(1, page), document.numPages);
        const pdfPage = await document.getPage(safePage);
        const scale = Math.max(0.6, Math.min(2.4, zoom / 100)) * 1.35;
        const viewport = pdfPage.getViewport({ scale });
        const context = canvas.getContext("2d");
        const textLayerElement = textLayerRef.current;
        if (!context) throw new Error("Canvas indisponivel para renderizar PDF.");

        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        if (active) setPageSize({ width: Math.floor(viewport.width), height: Math.floor(viewport.height) });

        await pdfPage.render({ canvasContext: context, viewport }).promise;
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
        if (active) setError(getErrorMessage(renderError));
      } finally {
        if (active) setLoading(false);
      }
    }

    renderPdf();

    return () => {
      active = false;
    };
  }, [page, resource.url, zoom]);

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

function buildPdfSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  if (!normalizedSearchTerm) return { total: 0, indexesBySpanId };

  let total = 0;
  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

    let index = normalizedText.indexOf(normalizedSearchTerm);
    while (index >= 0) {
      if (!indexesBySpanId.has(span.id)) indexesBySpanId.set(span.id, total);
      total += 1;
      index = normalizedText.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
    }
  }

  if (total) return { total, indexesBySpanId };

  return buildPdfCombinedSearchPlan(spans, normalizedSearchTerm);
}

function buildPdfCombinedSearchPlan(spans: PdfTextSpan[], normalizedSearchTerm: string): PdfSearchPlan {
  const indexesBySpanId = new Map<string, number>();
  let text = "";
  const ranges: Array<{ end: number; id: string; start: number }> = [];

  for (const span of spans) {
    const normalizedText = normalizeForSearch(span.text);
    if (!normalizedText) continue;

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
      if (!indexesBySpanId.has(range.id)) indexesBySpanId.set(range.id, total);
    }
    total += 1;
    index = text.indexOf(normalizedSearchTerm, index + Math.max(1, normalizedSearchTerm.length));
  }

  return { total, indexesBySpanId };
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
  const healthChecks = useMemo(() => buildOperationalHealthChecks(currentUser, users), [currentUser, users]);

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

function ModuleFrame({ title, src }: { title: string; src: string }) {
  return (
    <section className="frame-page">
      <header>
        <h2>{title}</h2>
        <a href={src} rel="noreferrer" target="_blank">
          Abrir em nova aba
        </a>
      </header>
      <iframe src={src} title={title} />
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

function buildOperationalHealthChecks(user: HubUser, users: HubProfile[]): HealthCheck[] {
  const usersSource = getUsersSource();
  const lembretesSource = getLembretesSource(user);
  const arquivosSource = getArquivosSource();
  const linksSource = getLinksSource();
  const tarefasSource = getTarefasSource();
  const hasAdmin = users.some((profile) => profile.active && profile.role === "admin");
  const hasCurrentUser = users.some((profile) => profile.active && profile.email.toLowerCase() === user.email.toLowerCase());
  const supabaseReady = [usersSource, lembretesSource, arquivosSource, linksSource].every((source) => source === "supabase");

  return [
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
        tarefasSource === "calendario"
          ? "Operando integrado ao calendario original; Supabase fica preparado para ativacao futura."
          : "Modo Supabase/local ativo conforme configuracao atual.",
      tone: "info"
    },
    {
      area: "E-mails",
      status: "Fila preparada",
      detail: "Validar email_outbox, Resend e botoes da Coordenacao somente no proximo deploy de marco.",
      tone: supabaseReady ? "ok" : "info"
    },
    {
      area: "Rodapes",
      status: "Automacao preparada",
      detail: "Noticias e legislacoes dependem da funcao refresh-updates no Netlify publicado.",
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

function formatFileCategory(category: FileResourceCategory) {
  return fileCategoryOptions.find((option) => option.value === category)?.label || "Outro";
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
  const pautaEmail = normalizeForSearch(pauta.email);
  const userEmail = normalizeForSearch(user.email);
  const pautaResponsavel = normalizeForSearch(pauta.responsavel);
  const userName = normalizeForSearch(user.nome);

  if (pautaEmail && pautaEmail === userEmail) return true;
  if (!pautaResponsavel || !userName) return false;

  return pautaResponsavel.includes(userName) || userName.includes(pautaResponsavel);
}

function isPautaGeneral(pauta: Pauta) {
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
  return isPautaGeneral(pauta) || isPautaAssignedToUser(pauta, user);
}

function isTaskAssignedToUser(task: TaskItem, user: HubUser) {
  return (
    task.createdBy === user.id ||
    task.createdBy === user.email ||
    task.responsaveis.some((responsavel) => responsavel.toLowerCase() === user.email.toLowerCase())
  );
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
      if (isPautaAlta(pauta)) acc.alta += 1;
      if (isPautaAtrasada(pauta)) acc.atrasado += 1;
      if (!pauta.prazo.trim()) acc.semPrazo += 1;
      return acc;
    },
    { alta: 0, atrasado: 0, minhas: 0, semPrazo: 0 }
  );
}

function buildSystemNotifications({
  hubUsers,
  lembretes,
  pautas,
  user
}: {
  hubUsers: HubProfile[];
  lembretes: Lembrete[];
  pautas: Pauta[];
  user: HubUser;
}): HubNotification[] {
  return [...buildLembreteNotifications(lembretes, hubUsers, user), ...buildPautaNotifications(pautas, user)];
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

function parseBrazilianDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;

  const [, day, month, year, hour = "00", minute = "00"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Nao foi possivel concluir a operacao.");
  }
  return "Nao foi possivel concluir a operacao.";
}
