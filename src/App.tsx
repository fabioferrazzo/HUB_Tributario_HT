import {
  Bell,
  CalendarDays,
  CheckCircle2,
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
import { FormEvent, useEffect, useMemo, useState } from "react";
import { loadPautas, mockLegislacoes, mockNoticias, sheetsHubUrl, teamMembers } from "./data/hubData";
import { getStoredSession, signIn, signOut } from "./lib/auth";
import {
  canUserManageLembrete,
  deleteAppLembrete,
  getLembretesSource,
  listAppLembretes,
  saveAppLembrete
} from "./lib/lembretesRepository";
import { readStorage, writeStorage } from "./lib/storage";
import { getUsersSource, listAppUsers, saveAppUserWithOptions, setAppUserActive } from "./lib/usersRepository";
import type { HubProfile, HubRoute, HubUser, Lembrete, Noticia, Pauta, UserRole } from "./types";

type TaskItem = {
  id: string;
  titulo: string;
  prazo: string;
  status: "aberta" | "concluida";
  anexos: string[];
};

type PautaFilter = "todas" | "minhas" | "alta" | "atrasadas" | "semPrazo";

type UsefulLink = {
  id: string;
  titulo: string;
  url: string;
  scope: "privado" | "global";
};

type FileResourceCategory = "drive" | "modelo" | "guia" | "anexo" | "outro";

type FileResource = {
  id: string;
  titulo: string;
  descricao: string;
  url: string;
  categoria: FileResourceCategory;
  scope: "privado" | "global";
  createdBy: string;
  createdAt: string;
};

type NotificationItem = {
  id: string;
  title: string;
  detail: string;
  meta: string;
  tone: "danger" | "warning";
  route: HubRoute;
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
  const [notificationItems, setNotificationItems] = useState<NotificationItem[]>([]);

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

    listAppLembretes(user)
      .then((lembretes) => {
        if (active) setNotificationItems(buildLembreteNotifications(lembretes, hubUsers));
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
        />
        <section className="workspace-body">{renderRoute(route, user, hubUsers, handleRoute)}</section>
      </main>
    </div>
  );
}

function LoginScreen({ onLogin }: { onLogin: (user: HubUser) => void }) {
  const [email, setEmail] = useState(import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.heixeira@gmail.com");
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
  onNavigate
}: {
  route: HubRoute;
  notificationItems: NotificationItem[];
  user: HubUser;
  menuOpen: boolean;
  onMenu: () => void;
  onNavigate: (route: HubRoute) => void;
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
        <span>Depto Tributário</span>
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
                <strong>Notificacoes</strong>
                <small>{notificationItems.length ? `${notificationItems.length} aviso(s) ativo(s)` : "Sem avisos ativos"}</small>
              </header>

              <div className="notification-list">
                {notificationItems.length ? (
                  notificationItems.map((item) => (
                    <button
                      className={`notification-item notification-item--${item.tone}`}
                      key={item.id}
                      type="button"
                      onClick={() => {
                        onNavigate(item.route);
                        setNotificationsOpen(false);
                      }}
                    >
                      <span className="notification-dot" />
                      <span>
                        <strong>{item.title}</strong>
                        <em>{item.detail}</em>
                        <small>{item.meta}</small>
                      </span>
                    </button>
                  ))
                ) : (
                  <div className="notification-empty">
                    <CheckCircle2 size={18} />
                    <span>Nenhum lembrete vencido ou proximo do vencimento.</span>
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
  if (route === "tarefas") return <TasksModule />;
  if (route === "lembretes") return <LembretesModule hubUsers={hubUsers} user={user} />;
  if (route === "arquivos") return <ArquivosModule user={user} />;
  if (route === "links") return <LinksModule />;
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
    : `${canSeeAllPautas ? "CSV HUB" : "minhas pautas"} · ${visiblePautas.length} itens`;

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
                <em>{pauta.responsavel || "Sem responsavel definido"}{pauta.email ? ` · ${pauta.email}` : ""}</em>
              </div>
              <div className="pauta-row-badges">
                <StatusPill label={pauta.status || "Sem status"} />
                {pauta.prioridade ? <StatusPill label={pauta.prioridade} /> : null}
              </div>
              <small className={`pauta-date pauta-date--${getPautaTone(pauta)}`}>
                <CalendarDays size={12} />
                {formatDate(pauta.prazo)} · {pauta.origem}
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
          status={lembretesLoading ? "Carregando" : `${getLembretesSource(user)} · ${lembretes.length} itens`}
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
              <small>{formatDateTime(lembrete.prazo)} · {lembrete.anexos.length} anexo(s)</small>
            </article>
          ))}
        </div>
      </section>

      <FooterUpdates legislacoes={mockLegislacoes} noticias={mockNoticias} />
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

function FooterUpdates({ legislacoes, noticias }: { legislacoes: Noticia[]; noticias: Noticia[] }) {
  return (
    <footer className="footer-updates">
      <UpdateTicker
        icon={<Newspaper size={18} />}
        items={noticias}
        title="Noticias Tributarias"
      />
      <UpdateTicker
        icon={<ShieldCheck size={18} />}
        items={legislacoes}
        title="Legislacoes Reforma Tributaria"
      />
    </footer>
  );
}

function UpdateTicker({ icon, items, title }: { icon: React.ReactNode; items: Noticia[]; title: string }) {
  return (
    <section className="news-band" aria-label={title}>
      <div className="news-label">
        {icon}
        <strong>{title}</strong>
      </div>
      <div className="ticker-window">
        <div className="ticker-track">
          {[...items, ...items].map((item, index) => (
            <a href={item.url} key={`${item.id}-${index}`} rel="noreferrer" target="_blank">
              <strong>{item.fonte}</strong>
              <span>{item.titulo}</span>
            </a>
          ))}
        </div>
      </div>
    </section>
  );
}

function TasksModule() {
  return (
    <div className="tasks-layout">
      <div className="calendar-shell">
        <iframe src="/apps/calendar.html" title="Calendario de tarefas" />
      </div>
      <TaskSidebar />
    </div>
  );
}

function TaskSidebar() {
  const [tasks, setTasks] = useState<TaskItem[]>(() => readStorage<TaskItem[]>("hub_tasks", []));
  const [titulo, setTitulo] = useState("");
  const [prazo, setPrazo] = useState("");
  const [anexos, setAnexos] = useState<string[]>([]);

  function persist(nextTasks: TaskItem[]) {
    setTasks(nextTasks);
    writeStorage("hub_tasks", nextTasks);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim()) return;

    persist([
      {
        id: crypto.randomUUID(),
        titulo: titulo.trim(),
        prazo,
        status: "aberta",
        anexos
      },
      ...tasks
    ]);
    setTitulo("");
    setPrazo("");
    setAnexos([]);
  }

  function toggleTask(id: string) {
    persist(tasks.map((task) => (task.id === id ? { ...task, status: task.status === "aberta" ? "concluida" : "aberta" } : task)));
  }

  return (
    <aside className="task-sidebar">
      <header>
        <h2>Tarefas</h2>
        <span>{tasks.filter((task) => task.status === "aberta").length} abertas</span>
      </header>

      <form className="task-form" onSubmit={handleSubmit}>
        <label>
          Titulo
          <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
        </label>
        <label>
          Prazo
          <input value={prazo} onChange={(event) => setPrazo(event.target.value)} type="datetime-local" />
        </label>
        <label>
          Anexos
          <input
            multiple
            onChange={(event) => setAnexos(Array.from(event.target.files || []).map((file) => file.name))}
            type="file"
          />
        </label>
        <button className="primary-action" type="submit">
          Adicionar
        </button>
      </form>

      <div className="task-list">
        {tasks.map((task) => (
          <button className={`task-item task-item--${task.status}`} key={task.id} type="button" onClick={() => toggleTask(task.id)}>
            <CheckCircle2 size={17} />
            <span>
              <strong>{task.titulo}</strong>
              <small>{task.prazo ? formatDateTime(task.prazo) : "Sem prazo"}</small>
              {task.anexos.length ? <em>{task.anexos.length} anexo(s)</em> : null}
            </span>
          </button>
        ))}
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
                  <em>{formatDateTime(lembrete.prazo)} · {formatResponsaveis(lembrete.responsaveis, hubUsers)}</em>
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
  const [resources, setResources] = useState<FileResource[]>(() => readStorage<FileResource[]>("hub_file_resources", []));
  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<FileResourceCategory | "todos">("todos");
  const [titulo, setTitulo] = useState("");
  const [descricao, setDescricao] = useState("");
  const [url, setUrl] = useState("");
  const [categoria, setCategoria] = useState<FileResourceCategory>("drive");
  const [scope, setScope] = useState<"privado" | "global">(user.role === "admin" ? "global" : "privado");

  function persist(next: FileResource[]) {
    setResources(next);
    writeStorage("hub_file_resources", next);
  }

  function canManageResource(resource: FileResource) {
    return user.role === "admin" || resource.createdBy === user.email || resource.createdBy === user.id;
  }

  const visibleResources = useMemo(() => {
    const normalizedQuery = normalizeForSearch(query);

    return resources
      .filter((resource) => resource.scope === "global" || resource.createdBy === user.email || user.role === "admin")
      .filter((resource) => categoryFilter === "todos" || resource.categoria === categoryFilter)
      .filter((resource) => {
        if (!normalizedQuery) return true;
        return normalizeForSearch([resource.titulo, resource.descricao, resource.url, resource.categoria].join(" ")).includes(normalizedQuery);
      });
  }, [categoryFilter, query, resources, user]);

  const totals = useMemo(
    () => ({
      drive: visibleResources.filter((resource) => resource.categoria === "drive").length,
      global: visibleResources.filter((resource) => resource.scope === "global").length,
      pessoal: visibleResources.filter((resource) => resource.scope === "privado").length,
      total: visibleResources.length
    }),
    [visibleResources]
  );

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim() || !url.trim()) return;

    const nextResource: FileResource = {
      id: crypto.randomUUID(),
      titulo: titulo.trim(),
      descricao: descricao.trim(),
      url: url.trim(),
      categoria,
      scope: user.role === "admin" ? scope : "privado",
      createdBy: user.email,
      createdAt: new Date().toISOString()
    };

    persist([nextResource, ...resources]);
    setTitulo("");
    setDescricao("");
    setUrl("");
    setCategoria("drive");
    setScope(user.role === "admin" ? "global" : "privado");
  }

  function removeResource(id: string) {
    const target = resources.find((resource) => resource.id === id);
    if (!target || !canManageResource(target)) return;
    persist(resources.filter((resource) => resource.id !== id));
  }

  return (
    <div className="split-page arquivos-page">
      <section className="panel arquivos-panel">
        <PanelHeader title="Arquivos" icon={<FileArchive size={18} />} action={`${visibleResources.length} itens`} />

        <div className="file-summary">
          <article>
            <strong>{totals.total}</strong>
            <span>Total visivel</span>
          </article>
          <article>
            <strong>{totals.drive}</strong>
            <span>Google Drive</span>
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

        <div className="file-resource-list">
          {visibleResources.map((resource) => (
            <article className="file-resource" key={resource.id}>
              <div>
                <FileArchive size={17} />
                <span>{formatFileCategory(resource.categoria)}</span>
              </div>
              <strong>{resource.titulo}</strong>
              <p>{resource.descricao || "Sem descricao"}</p>
              <small>{resource.scope === "global" ? "Global" : "Pessoal"} · {formatDate(resource.createdAt)}</small>
              <div className="record-actions">
                <a href={resource.url} rel="noreferrer" target="_blank">
                  <Link2 size={14} />
                  Abrir
                </a>
                {canManageResource(resource) ? (
                  <button className="danger-action" type="button" onClick={() => removeResource(resource.id)}>
                    <Trash2 size={14} />
                    Excluir
                  </button>
                ) : null}
              </div>
            </article>
          ))}
          {!visibleResources.length ? (
            <div className="empty-state">
              Nenhum arquivo ou atalho cadastrado para o filtro atual.
            </div>
          ) : null}
        </div>
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title="Novo arquivo" icon={<Paperclip size={18} />} action={user.role === "admin" ? "global/pessoal" : "pessoal"} />
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
          <button className="primary-action" type="submit">
            Salvar arquivo
          </button>
        </form>
      </section>
    </div>
  );
}

function LinksModule() {
  const [links, setLinks] = useState<UsefulLink[]>(() => readStorage("hub_links", []));
  const [titulo, setTitulo] = useState("");
  const [url, setUrl] = useState("");

  function persist(next: UsefulLink[]) {
    setLinks(next);
    writeStorage("hub_links", next);
  }

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!titulo.trim() || !url.trim()) return;
    persist([{ id: crypto.randomUUID(), titulo, url, scope: "privado" }, ...links]);
    setTitulo("");
    setUrl("");
  }

  return (
    <div className="split-page">
      <section className="panel">
        <PanelHeader title="Links uteis" icon={<Link2 size={18} />} action={`${links.length} links`} />
        <div className="link-list">
          {links.map((link) => (
            <a href={link.url} key={link.id} rel="noreferrer" target="_blank">
              <strong>{link.titulo}</strong>
              <span>{link.url}</span>
            </a>
          ))}
        </div>
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title="Novo link" icon={<Link2 size={18} />} action="Pessoal" />
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Titulo
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            URL
            <input value={url} onChange={(event) => setUrl(event.target.value)} type="url" />
          </label>
          <button className="primary-action" type="submit">
            Salvar
          </button>
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
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [authId, setAuthId] = useState("");
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [initialPassword, setInitialPassword] = useState("");
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

  function resetForm() {
    setEditingKey(null);
    setAuthId("");
    setNome("");
    setEmail("");
    setInitialPassword("");
    setRole("colaborador");
    setActive(true);
  }

  function startEdit(profile: HubProfile) {
    setEditingKey(getProfileKey(profile));
    setAuthId(profile.id || "");
    setNome(profile.nome);
    setEmail(profile.email);
    setInitialPassword("");
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

    setSaving(true);
    setError("");

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
          action={loading ? "Carregando" : `${source} · ${users.length} usuarios`}
        />

        {error ? <p className="module-error">{error}</p> : null}

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

function buildLembreteNotifications(lembretes: Lembrete[], profiles: HubProfile[]): NotificationItem[] {
  return lembretes
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
    .map(({ lembrete, tone }) => ({
      id: `lembrete-${lembrete.id}-${tone}`,
      title: lembrete.titulo,
      detail: tone === "danger" ? `Vencido: ${formatDateTime(lembrete.prazo)}` : `Vence em ate 24h: ${formatDateTime(lembrete.prazo)}`,
      meta: formatResponsaveis(lembrete.responsaveis, profiles),
      tone,
      route: "lembretes"
    }));
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
