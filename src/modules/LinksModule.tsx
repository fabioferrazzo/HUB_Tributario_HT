import { Edit3, Link2, Search, Trash2 } from "lucide-react";
import type { FileResourceScope, HubUser, UsefulLink } from "../types";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { PanelHeader } from "../components/common";
import { confirmDeletion, formatDate, getErrorMessage, normalizeForSearch } from "../lib/formatters";
import { deleteAppLink, getLinksSource, listAppLinks, saveAppLink } from "../lib/linksRepository";

export function LinksModule({ user }: { user: HubUser }) {
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
    if (!confirmDeletion(`Excluir o link "${link.titulo}"?`)) return;
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
            Título
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
