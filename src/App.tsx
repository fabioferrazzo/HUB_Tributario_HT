import { QuadroGeral } from "./modules/QuadroGeral";
import type { HubNotification, HubProfile, HubRoute, HubUser } from "./types";
import { ChevronDown, LogOut, Maximize2, Palette, Minimize2, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LoginScreen } from "./components/LoginScreen";
import { ModuleFrame, dispatchFrameAction } from "./components/common";
import type { PomodoroArchivedNote } from "./app/appTypes";
import { PomodoroFloatingNotes } from "./components/PomodoroFloatingNotes";
import { useVisualPremium, variaveisDaPaleta, abrirPersonalizarVisual } from "./lib/visualPremium";
import { PersonalizarVisual } from "./components/PersonalizarVisual";
import "./premium.css";
import { TopBar } from "./components/TopBar";
import { ChatCentral, type ChatJanela } from "./components/chat/ChatCentral";
import { routeGroups, routes } from "./app/appConfig";
import { canUserSeeApp, findAppByRoute } from "./app/appsRegistry";
import { buildSystemNotifications } from "./lib/hubNotifications";
import { canUserViewPauta } from "./lib/hubRules";
import { confirmDeletion } from "./lib/formatters";
import { getPlainTextFromHtml, readPomodoroArchivedNotes, readPomodoroNotes, savePomodoroArchivedNotes, savePomodoroNotes } from "./lib/pomodoroNotes";
import { aoEncerrarSessao, getStoredSession, limparSessaoLocal, sessaoSupabaseValida, signOut } from "./lib/auth";
import { listAppLembretes } from "./lib/lembretesRepository";
import { listAppPautas } from "./lib/pautasRepository";
import { listAppTasks } from "./lib/tarefasRepository";
import { listAppUsers } from "./lib/usersRepository";
import { markAllAppNotificationsRead, markAppNotificationRead, syncAppNotifications } from "./lib/notificationsRepository";
import { CarregamentoModulo } from "./components/CarregamentoModulo";
import { InstalarDesktop } from "./components/InstalarDesktop";
import { hubDesktop } from "./lib/desktop";
import { Suspense, lazy, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

// Módulos carregados sob demanda: o Quadro geral (tela inicial) e o chat seguem no pacote principal.
const AdminModule = lazy(() => import("./modules/AdminModule").then((m) => ({ default: m.AdminModule })));
const ArquivosModule = lazy(() => import("./modules/ArquivosModule").then((m) => ({ default: m.ArquivosModule })));
const AvaliacoesModule = lazy(() => import("./modules/AvaliacoesModule").then((m) => ({ default: m.AvaliacoesModule })));
const HistoricoModule = lazy(() => import("./modules/HistoricoModule").then((m) => ({ default: m.HistoricoModule })));
const Dashboard = lazy(() => import("./modules/Dashboard").then((m) => ({ default: m.Dashboard })));
const LembretesModule = lazy(() => import("./modules/LembretesModule").then((m) => ({ default: m.LembretesModule })));
const LinksModule = lazy(() => import("./modules/LinksModule").then((m) => ({ default: m.LinksModule })));
const RegistrosModule = lazy(() => import("./modules/RegistrosModule").then((m) => ({ default: m.RegistrosModule })));
const TasksModule = lazy(() => import("./modules/TasksModule").then((m) => ({ default: m.TasksModule })));

// A rota fica no endereço (#/rota) para abrir qualquer menu em nova janela ou por link.
function readRouteFromHash(): HubRoute | null {
  const id = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
  return routes.some((item) => item.id === id) ? (id as HubRoute) : null;
}

const windowMode = new URLSearchParams(window.location.search).get("janela") === "1";

export function App() {
  const [user, setUser] = useState<HubUser | null>(() => getStoredSession());
  const [avisoLogin, setAvisoLogin] = useState<{ texto: string; email: string } | null>(null);
  const saindoRef = useRef(false);
  const [chatJanela, setChatJanela] = useState<ChatJanela>(() => {
    try {
      const salvo = window.sessionStorage.getItem("hub_chat_janela");
      return salvo === "aberto" || salvo === "minimizado" ? salvo : "fechado";
    } catch {
      return "fechado";
    }
  });
  const [chatNaoLidas, setChatNaoLidas] = useState(0);
  // HUB instalado no Windows: contador de mensagens no ícone perto do relógio.
  useEffect(() => {
    hubDesktop()?.naoLidas(chatNaoLidas);
  }, [chatNaoLidas]);
  useEffect(() => {
    try {
      window.sessionStorage.setItem("hub_chat_janela", chatJanela);
    } catch {
      // ignorado
    }
  }, [chatJanela]);

  // Sessão vencida: volta para o login em vez de deixar os menus falhando com "sessão não encontrada".
  useEffect(() => {
    if (!user) return;
    let ativo = true;
    const expirar = () => {
      // Saída pelo botão "Sair" desta aba não é sessão vencida.
      if (!ativo || saindoRef.current) return;
      ativo = false;
      limparSessaoLocal();
      setAvisoLogin({ texto: "Sua sessão expirou ou foi encerrada. Entre novamente para continuar.", email: user.email });
      setUser(null);
    };
    const conferir = () => {
      void sessaoSupabaseValida().then((ok) => {
        if (!ok) expirar();
      });
    };
    conferir();
    const parar = aoEncerrarSessao(expirar);
    const aoVoltar = () => {
      if (document.visibilityState === "visible") conferir();
    };
    document.addEventListener("visibilitychange", aoVoltar);
    return () => {
      ativo = false;
      parar();
      document.removeEventListener("visibilitychange", aoVoltar);
    };
  }, [user]);
  const [route, setRoute] = useState<HubRoute>(() => readRouteFromHash() || "home");
  const workspaceRef = useRef<HTMLElement | null>(null);
  const [workspaceFullscreen, setWorkspaceFullscreen] = useState(false);

  useEffect(() => {
    const next = `#/${route}`;
    if (window.location.hash !== next) window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}${next}`);
  }, [route]);

  useEffect(() => {
    const onHashChange = () => {
      const next = readRouteFromHash();
      if (next) setRoute(next);
    };
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  useEffect(() => {
    const onChange = () => setWorkspaceFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleWorkspaceFullscreen = useCallback(async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await (windowMode ? document.documentElement : workspaceRef.current)?.requestFullscreen();
    } catch {
      // O navegador pode recusar; nada a fazer.
    }
  }, []);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuCollapsed, setMenuCollapsed] = useState(false);
  // Visual premium (padrão da equipe): menu, cabeçalho, rodapé e telas no tema novo.
  const visual = useVisualPremium(Boolean(user));
  useEffect(() => {
    const corpo = document.body;
    if (visual.ativo) corpo.dataset.hubPremium = visual.tema;
    else delete corpo.dataset.hubPremium;
    return () => {
      delete corpo.dataset.hubPremium;
    };
  }, [visual.ativo, visual.tema]);
  const [paletaAberta, setPaletaAberta] = useState(false);
  useEffect(() => {
    const abrir = () => setPaletaAberta(true);
    window.addEventListener("hub:abrir-paleta", abrir);
    return () => window.removeEventListener("hub:abrir-paleta", abrir);
  }, []);
  // submenus do menu lateral (ex.: Simuladores): começam abertos; os que o usuário fecha ficam guardados neste navegador
  const [closedSubmenus, setClosedSubmenus] = useState<string[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem("hub_menu_submenus_fechados") || "null");
      return Array.isArray(saved) ? saved.filter((item) => typeof item === "string") : [];
    } catch {
      return [];
    }
  });
  const toggleSubmenu = (id: string, open: boolean) => {
    setClosedSubmenus((current) => {
      const next = open ? current.filter((item) => item !== id) : [...current.filter((item) => item !== id), id];
      try {
        localStorage.setItem("hub_menu_submenus_fechados", JSON.stringify(next));
      } catch {
        // sem armazenamento: vale só nesta visita
      }
      return next;
    });
  };
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
    return (
      <LoginScreen
        aviso={avisoLogin?.texto}
        emailInicial={avisoLogin?.email}
        onLogin={(novo) => {
          saindoRef.current = false;
          setAvisoLogin(null);
          setUser(novo);
        }}
      />
    );
  }

  const visibleRoutes = routes.filter((item) => {
    if (item.id === "admin" || item.id === "historico") return user.role === "admin";
    const app = findAppByRoute(item.id);
    if (app) return canUserSeeApp(app, user.role);
    return true;
  });
  // Rota digitada no endereço sem permissão volta para o Quadro geral.
  const currentRoute: HubRoute = visibleRoutes.some((item) => item.id === route) ? route : "home";
  const currentApp = findAppByRoute(currentRoute);
  const isHubScreen = !currentApp;
  const appEmbedded = currentApp?.mode === "embutido";

  function openRouteWindow() {
    const width = Math.min(1440, window.screen.availWidth || 1440);
    const height = Math.min(960, window.screen.availHeight || 960);
    window.open(`${window.location.pathname}?janela=1#/${currentRoute}`, `hub-${currentRoute}`, `popup=yes,width=${width},height=${height}`);
  }

  if (windowMode) {
    const title = visibleRoutes.find((item) => item.id === currentRoute)?.label || "HUB";
    document.title = `${title} - HUB Depto Tributário`;
    return (
      <div className="window-mode">
        {isHubScreen ? (
          <header className="window-mode-bar">
            <strong>{title}</strong>
            <span>HUB Depto Tributário</span>
            <button type="button" onClick={() => void toggleWorkspaceFullscreen()} title={workspaceFullscreen ? "Sair da tela cheia (Esc)" : "Tela cheia"}>
              {workspaceFullscreen ? <Minimize2 size={15} strokeWidth={1.6} /> : <Maximize2 size={15} strokeWidth={1.6} />}
              <span>{workspaceFullscreen ? "Sair da tela cheia" : "Tela cheia"}</span>
            </button>
          </header>
        ) : null}
        <section className="workspace-body window-mode-body" ref={workspaceRef}>
          {renderRoute(currentRoute, user, hubUsers, handleRoute)}
        </section>
      </div>
    );
  }

  function handleRoute(nextRoute: HubRoute) {
    setRoute(nextRoute);
    setMenuOpen(false);
  }

  function handleSignOut() {
    saindoRef.current = true;
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
    setPomodoroNotesStatus("Anotações salvas.");
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
      setPomodoroNotesStatus("Escreva uma anotação antes de arquivar.");
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
    setPomodoroNotesStatus("Anotação arquivada.");
  }

  function handlePomodoroArchivedNoteOpen(note: PomodoroArchivedNote) {
    setPomodoroNotes(note.notes);
    savePomodoroNotes(note.notes);
    setPomodoroNotesStatus("Anotação arquivada aberta para edição.");
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
    setPomodoroNotesStatus("Edição do arquivo salva.");
  }

  function handlePomodoroArchivedNoteDelete(noteId: string) {
    if (!confirmDeletion("Excluir esta anotação arquivada do Pomodoro?")) return;
    const nextArchive = pomodoroArchivedNotes.filter((note) => note.id !== noteId);
    setPomodoroArchivedNotes(nextArchive);
    savePomodoroArchivedNotes(nextArchive);
    setPomodoroNotesStatus("Anotação arquivada excluida.");
  }

  return (
    <div
      className={`app-shell ${menuCollapsed ? "app-shell--collapsed" : ""}${
        visual.ativo ? ` hub-premium hub-premium--${visual.tema} hub-premium--${visual.tamanho}` : ""
      }`}
      style={visual.ativo ? (variaveisDaPaleta(visual.paleta, visual.tema) as CSSProperties) : undefined}
    >
      {visual.ativo ? (
        <div className="hp-fundo" aria-hidden="true">
          <i className="hp-orbe hp-orbe--1" />
          <i className="hp-orbe hp-orbe--2" />
          <i className="hp-orbe hp-orbe--3" />
          <i className="hp-orbe hp-orbe--b1" />
          <i className="hp-orbe hp-orbe--b3" />
          <i className="hp-orbe hp-orbe--b2" />
        </div>
      ) : null}
      <aside className={`sidebar ${menuOpen ? "sidebar--open" : ""} ${menuCollapsed ? "sidebar--collapsed" : ""}`}>
        <div className="brand-block">
          <div className="brand-mark">HT</div>
          <div className="brand-copy">
            <strong>HUB Depto Tributário</strong>
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

            const submenu = group.submenu;
            const submenuActive = Boolean(submenu) && groupRoutes.some((item) => item.id === currentRoute);
            const submenuOpen = !submenu || submenuActive || !closedSubmenus.includes(submenu.id);
            const SubmenuIcon = submenu?.icon;

            return (
              <div className={`side-nav-section${submenu ? " side-nav-section--submenu" : ""}`} key={group.label}>
                {submenu && SubmenuIcon ? (
                  <button
                    className={`side-nav-submenu-toggle${submenuActive ? " active-parent" : ""}`}
                    type="button"
                    aria-expanded={submenuOpen}
                    aria-controls={`submenu-${submenu.id}`}
                    title={submenuOpen ? `Recolher ${submenu.label}` : `Abrir ${submenu.label}`}
                    disabled={submenuActive}
                    onClick={() => toggleSubmenu(submenu.id, !submenuOpen)}
                  >
                    <span className="side-nav-icon">
                      <SubmenuIcon size={18} />
                    </span>
                    <span>{submenu.label}</span>
                    <ChevronDown className="side-nav-chevron" size={15} aria-hidden="true" />
                  </button>
                ) : (
                  <div className="side-nav-label">{group.label}</div>
                )}
                {submenuOpen ? (
                <div className={`side-nav-group${submenu ? " side-nav-submenu" : ""}`} id={submenu ? `submenu-${submenu.id}` : undefined}>
                  {groupRoutes.map((item) => {
                    const Icon = item.icon;
                    return (
                      <button
                        className={currentRoute === item.id ? "active" : ""}
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
                ) : null}
              </div>
            );
          })}
        </nav>

        {visual.ativo ? (
          <button className="sign-out sign-out--paleta" type="button" title="Personalizar visual" onClick={abrirPersonalizarVisual}>
            <Palette size={17} />
            <span>Personalizar visual</span>
          </button>
        ) : null}
        <InstalarDesktop />
        <button className="sign-out" type="button" onClick={handleSignOut}>
          <LogOut size={17} />
          <span>Sair</span>
        </button>
      </aside>

      <main className="workspace">
        <TopBar
          notificationItems={notificationItems}
          route={currentRoute}
          user={user}
          isFullscreen={workspaceFullscreen}
          onFullscreen={isHubScreen ? () => void toggleWorkspaceFullscreen() : appEmbedded ? () => dispatchFrameAction(currentApp!.id, "fullscreen") : undefined}
          onOpenWindow={isHubScreen ? openRouteWindow : currentApp ? () => dispatchFrameAction(currentApp.id, "window") : undefined}
          onReload={appEmbedded ? () => dispatchFrameAction(currentApp!.id, "reload") : undefined}
          menuOpen={menuOpen}
          onMenu={() => setMenuOpen((open) => !open)}
          onNavigate={handleRoute}
          onNotificationRead={handleNotificationRead}
          onNotificationsReadAll={handleAllNotificationsRead}
          chatNaoLidas={chatNaoLidas}
          onChat={() => (currentRoute === "chat" ? undefined : setChatJanela((atual) => (atual === "aberto" ? "fechado" : "aberto")))}
        />
        <section className={`workspace-body ${workspaceFullscreen && isHubScreen ? "workspace-body--fullscreen" : ""}`} ref={workspaceRef}>
          {renderRoute(currentRoute, user, hubUsers, handleRoute)}
        </section>
      </main>
      {visual.ativo && paletaAberta ? <PersonalizarVisual visual={visual} onFechar={() => setPaletaAberta(false)} /> : null}
      {currentRoute !== "chat" ? (
        <ChatCentral hubUsers={hubUsers} janela={chatJanela} modo="janela" onJanela={setChatJanela} onNaoLidas={setChatNaoLidas} user={user} />
      ) : null}
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

function renderRoute(route: HubRoute, user: HubUser, hubUsers: HubProfile[], onNavigate: (route: HubRoute) => void) {
  return (
    <CarregamentoModulo key={route}>
      <Suspense fallback={<div className="modulo-carregando" role="status">Carregando…</div>}>
        {renderRouteConteudo(route, user, hubUsers, onNavigate)}
      </Suspense>
    </CarregamentoModulo>
  );
}

function renderRouteConteudo(route: HubRoute, user: HubUser, hubUsers: HubProfile[], onNavigate: (route: HubRoute) => void) {
  if (route === "home") return <QuadroGeral hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
  if (route === "chat") return <ChatCentral hubUsers={hubUsers} modo="pagina" user={user} />;
  if (route === "pautas") return <Dashboard hubUsers={hubUsers} user={user} />;
  if (route === "tarefas") return <TasksModule hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
  if (route === "lembretes") return <LembretesModule hubUsers={hubUsers} user={user} />;
  if (route === "arquivos") return <ArquivosModule user={user} />;
  if (route === "links") return <LinksModule user={user} />;
  if (route === "registros") return <RegistrosModule hubUsers={hubUsers} user={user} />;
  if (route === "avaliacoes") return <AvaliacoesModule user={user} />;
  if (route === "historico") return user.role === "admin" ? <HistoricoModule /> : <QuadroGeral hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
  if (route === "admin") return <AdminModule currentUser={user} />;
  const app = findAppByRoute(route);
  if (app && canUserSeeApp(app, user.role)) return <ModuleFrame app={app} key={app.id} />;
  return <QuadroGeral hubUsers={hubUsers} onNavigate={onNavigate} user={user} />;
}
