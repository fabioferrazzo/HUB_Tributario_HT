import { CheckCircle2, Edit3, Paperclip, Plus, Search, Trash2, X } from "lucide-react";
import { DueSignal, StatusPill } from "../components/common";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { HubProfile, HubRoute, HubUser, Lembrete, TaskItem } from "../types";
import type { ReportFormat, TaskFilter } from "../app/appTypes";
import { canUserManageLembrete, getLembretesSource, listAppLembretes } from "../lib/lembretesRepository";
import { canUserManageTask, deleteAppTask, deleteCalendarEventTask, getTarefasSource, listAppTasks, saveAppTask, saveCalendarEventTask } from "../lib/tarefasRepository";
import { confirmDeletion, formatDateTime, formatResponsaveis, getActiveProfiles, getDueTone, getErrorMessage, getInitials, normalizeForSearch } from "../lib/formatters";
import { escapeHtmlText, exportReport } from "../lib/reportExport";
import { getSupabaseAccessToken } from "../lib/auth";
import { isTaskAssignedToUser, isTaskSidebarHistoryRecord, shouldKeepTaskInSidebarHistory, taskToCalendarFrameEvent } from "../lib/hubRules";
import { lembreteToReportRow, taskToReportRow } from "../lib/reportRows";

export function TasksModule({ hubUsers, onNavigate, user }: { hubUsers: HubProfile[]; onNavigate: (route: HubRoute) => void; user: HubUser }) {
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

export function TaskSidebar({ hubUsers, onNavigate, user }: { hubUsers: HubProfile[]; onNavigate: (route: HubRoute) => void; user: HubUser }) {
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
    if (!confirmDeletion(`Excluir a tarefa "${task.titulo}"?`)) return;

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
            Título
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

export function TaskLembretesPanel({
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
                <span>{lembrete.descricao || "Sem descrição"}</span>
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
