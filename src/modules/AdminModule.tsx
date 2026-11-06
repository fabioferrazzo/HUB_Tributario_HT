import { APP_RELEASE_LABEL, HOMOLOGATION_STORAGE_KEY, dailyOperationalGuide, homologationBlocks, homologationStatusLabels, roleOptions, weeklyOperationalGuide } from "../app/appConfig";
import { CheckCircle2, Edit3, UserRound, UserRoundCog } from "lucide-react";
import type { CoordSyncHealth, EmailOperationResponse, EmailQueuePreviewItem, HomologationStatus } from "../app/appTypes";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { HubProfile, HubUser, UserRole } from "../types";
import { PanelHeader, StatusPill } from "../components/common";
import { buildOperationalHealthChecks, readHomologationStatuses } from "../lib/healthChecks";
import { formatDateTime, formatRole, getActiveProfiles, getErrorMessage, getInitials, getProfileKey } from "../lib/formatters";
import { getSupabaseAccessToken } from "../lib/auth";
import { getUsersSource, listAppUsers, resetAppUserPassword, saveAppUserWithOptions, setAppUserActive } from "../lib/usersRepository";

export function AdminModule({ currentUser }: { currentUser: HubUser }) {
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
    detail: "A sincronização da Coordenação será conferida neste painel.",
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
          detail: "A Coordenação so sincroniza entre usuários quando o HUB esta conectado ao Supabase.",
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
          resetResult.emailSent
            ? "Usuário atualizado. Senha provisória redefinida e enviada por e-mail ao usuário."
            : `Usuário atualizado. Senha provisória redefinida; o e-mail não foi enviado (${resetResult.emailReason || "envio indisponível"}). Informe a senha ao usuário pessoalmente.`
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
          title="Usuários e perfis"
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
            Use este painel como checklist antes de liberar novo deploy. Ele não dispara builds nem consome creditos do Netlify.
          </p>
        </section>

        <OperationalGuidePanel />

        <OperationalEmailConsole currentUser={currentUser} users={users} />

        <OperationalHomologationPanel />
      </section>

      <section className="panel narrow-panel">
        <PanelHeader title={editingKey ? "Editar usuário" : "Novo usuário"} icon={<UserRound size={18} />} action={source} />
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
              <small className="form-hint">Preencha somente se quiser redefinir a senha deste usuário.</small>
            </label>
          ) : null}
          <label className="toggle-row">
            <input checked={active} onChange={(event) => setActive(event.target.checked)} type="checkbox" />
            Usuário ativo
          </label>

          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || loading} type="submit">
              {saving ? "Salvando..." : editingKey ? "Atualizar usuário" : "Salvar usuário"}
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

export function OperationalHomologationPanel() {
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
          <span className="panel-chip">Homologação</span>
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
          Limpar marcações
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

export function OperationalGuidePanel() {
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
          <span className="panel-chip">Operação</span>
          <h3>Guia rápido do administrador</h3>
        </div>
        <button className="secondary-button" type="button" onClick={copyGuide}>
          Copiar guia
        </button>
      </div>
      <div className="operation-grid">
        <article className="operation-card">
          <strong>Rotina diária</strong>
          <p>Sequência curta para abrir o HUB, conferir riscos e acionar e-mails sem depender de instruções externas.</p>
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
          <p>Revisões de manutenção para manter dados, acessos, biblioteca e Coordenação em ordem.</p>
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

export function OperationalEmailConsole({ currentUser, users }: { currentUser: HubUser; users: HubProfile[] }) {
  const [dispatchToken, setDispatchToken] = useState(() => sessionStorage.getItem("hub_email_dispatch_token") || "");
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
      sessionStorage.setItem("hub_email_dispatch_token", token);
    } else {
      sessionStorage.removeItem("hub_email_dispatch_token");
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
          <span className="panel-chip">Operação</span>
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
            Consulte e processe a fila <code>email_outbox</code>. A rotina diária enfileira avisos de vencimento e envia o que estiver
            pronto. O token abaixo e necessário apenas para comandos manuais no HUB; o agendamento da Netlify usa
            <code>EMAIL_SCHEDULE_ENABLED=true</code>. Se você estiver logado como admin/gestor, os botões também funcionam sem colar o token.
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
              Rodar rotina diária
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
