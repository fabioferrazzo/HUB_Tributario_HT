import { Bell, CheckCircle2, Clock3, Edit3, Paperclip, Search, Trash2 } from "lucide-react";
import { DueSignal, PanelHeader, StatusPill } from "../components/common";
import { FormEvent, useEffect, useMemo, useState } from "react";
import type { HubProfile, HubUser, Lembrete } from "../types";
import { canUserManageLembrete, deleteAppLembrete, getLembretesSource, listAppLembretes, saveAppLembrete } from "../lib/lembretesRepository";
import { confirmDeletion, formatDateTime, formatResponsaveis, getActiveProfiles, getErrorMessage, getInitials } from "../lib/formatters";

export function LembretesModule({ hubUsers, user }: { hubUsers: HubProfile[]; user: HubUser }) {
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
      setError("Você pode visualizar este lembrete, mas apenas o criador, coordenação ou administrador pode altera-lo.");
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
      setError("Você pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode altera-lo.");
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
      setError("Você pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode altera-lo.");
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
      setError("Você pode visualizar este lembrete, mas apenas o criador, gestor ou administrador pode exclui-lo.");
      return;
    }
    if (!confirmDeletion(`Excluir o lembrete "${target?.titulo || ""}"?`)) return;

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
                  <span>{lembrete.descricao || "Sem descrição"}</span>
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
                  <span className="readonly-note">Somente visualização</span>
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
            Título
            <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
          </label>
          <label>
            Descrição
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
                <small>Visível apenas para o admin criador e usuários marcados.</small>
              </span>
            </label>
          ) : null}

          <fieldset className="member-picker">
            <legend>Usuários marcados</legend>
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
