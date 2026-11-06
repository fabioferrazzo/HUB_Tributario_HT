import { AdminModule } from "./modules/AdminModule";
import { ArquivosModule } from "./modules/ArquivosModule";
import { Dashboard } from "./modules/Dashboard";
import type { HubNotification, HubProfile, HubRoute, HubUser } from "./types";
import { LembretesModule } from "./modules/LembretesModule";
import { LinksModule } from "./modules/LinksModule";
import { LogOut, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { LoginScreen } from "./components/LoginScreen";
import { ModuleFrame } from "./components/common";
import type { PomodoroArchivedNote } from "./app/appTypes";
import { PomodoroFloatingNotes } from "./components/PomodoroFloatingNotes";
import { TasksModule } from "./modules/TasksModule";
import { TopBar } from "./components/TopBar";
import { appFrames, routeGroups, routes } from "./app/appConfig";
import { buildSystemNotifications } from "./lib/hubNotifications";
import { canUserViewPauta } from "./lib/hubRules";
import { confirmDeletion } from "./lib/formatters";
import { getPlainTextFromHtml, readPomodoroArchivedNotes, readPomodoroNotes, savePomodoroArchivedNotes, savePomodoroNotes } from "./lib/pomodoroNotes";
import { getStoredSession, signOut } from "./lib/auth";
import { listAppLembretes } from "./lib/lembretesRepository";
import { listAppPautas } from "./lib/pautasRepository";
import { listAppTasks } from "./lib/tarefasRepository";
import { listAppUsers } from "./lib/usersRepository";
import { markAllAppNotificationsRead, markAppNotificationRead, syncAppNotifications } from "./lib/notificationsRepository";
import { useEffect, useState } from "react";

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
    if (!confirmDeletion("Excluir esta anotação arquivada do Pomodoro?")) return;
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
