import { ChevronLeft, ChevronRight, Edit3, FileArchive, Link2, Paperclip, RefreshCw, Search, Trash2, X } from "lucide-react";
import type { FileFolder, FileResource, FileResourceCategory, FileResourceScope, FileViewerNote, FileViewerNoteKind, HubUser } from "../types";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { InternalDocxViewer, InternalPdfViewer } from "../components/viewers";
import { PanelHeader } from "../components/common";
import { buildFileDownloadUrl, buildViewerNotesMarkdown, buildViewerPreview, getInitialFileProcessingStatus, getProcessingBadge, getStudyResource, isDocxResource, isPdfResource, summarizeLocalOcrOutput, toSafeDownloadFileName, triggerOcrProtocol } from "../lib/viewerUtils";
import { confirmDeletion, formatDate, formatFileCategory, getErrorMessage, normalizeForSearch } from "../lib/formatters";
import { deleteAppFileAnnotation, deleteAppFileFolder, deleteAppFileResource, getArquivosSource, listAppFileAnnotations, listAppFileFolders, listAppFileResources, saveAppFileAnnotation, saveAppFileFolder, saveAppFileResource } from "../lib/arquivosRepository";
import { downloadBlob } from "../lib/reportExport";
import { fileCategoryOptions } from "../app/appConfig";

export function ArquivosModule({ user }: { user: HubUser }) {
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
  const [scope, setScope] = useState<FileResourceScope>("global");
  const [folderId, setFolderId] = useState("");
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [dropActive, setDropActive] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderScope, setFolderScope] = useState<FileResourceScope>("global");
  const [editingFolderId, setEditingFolderId] = useState<string | null>(null);
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
    if (!confirmDeletion("Excluir esta anotação do documento?")) return;
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
    setScope("global");
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
      scope,
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
          scope,
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
    if (!confirmDeletion(`Excluir "${target.titulo}" da biblioteca de arquivos? Se for um arquivo enviado, ele também será apagado do armazenamento.`)) return;
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
    const existingFolder = editingFolderId ? folders.find((item) => item.id === editingFolderId) : undefined;
    const nextFolder: FileFolder = {
      id: existingFolder?.id || crypto.randomUUID(),
      nome: folderName.trim(),
      descricao: folderDescription.trim(),
      scope: folderScope,
      createdBy: existingFolder?.createdBy || user.email,
      createdAt: existingFolder?.createdAt || now,
      updatedAt: now
    };

    try {
      setFolders(await saveAppFileFolder(nextFolder, user));
      cancelFolderEdit();
    } catch (folderError) {
      setError(getErrorMessage(folderError));
    } finally {
      setSaving(false);
    }
  }

  function startEditFolder(folder: FileFolder) {
    setEditingFolderId(folder.id);
    setFolderName(folder.nome);
    setFolderDescription(folder.descricao || "");
    setFolderScope(folder.scope);
  }

  function cancelFolderEdit() {
    setEditingFolderId(null);
    setFolderName("");
    setFolderDescription("");
    setFolderScope("global");
  }

  async function removeFolder(folder: FileFolder) {
    if (!canManageFolder(folder)) return;
    if (!confirmDeletion(`Excluir a pasta "${folder.nome}"? Os arquivos dela não serão apagados: passarão para "Sem pasta".`)) return;
    setError("");
    setSaving(true);
    try {
      const nextFolders = await deleteAppFileFolder(folder.id, user);
      setFolders(nextFolders);
      if (folderFilter === folder.id) setFolderFilter("todos");
      if (folderId === folder.id) setFolderId("");
      if (editingFolderId === folder.id) cancelFolderEdit();
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
                    <p>{resource.descricao || "Sem descrição"}</p>
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
                {resource.kind === "upload" && resource.url ? (
                  <a href={buildFileDownloadUrl(resource)} rel="noreferrer" target="_blank">
                    <FileArchive size={14} strokeWidth={1.8} />
                    Baixar
                  </a>
                ) : null}
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
        <PanelHeader title={editingId ? "Editar arquivo" : "Novo arquivo"} icon={<Paperclip size={18} />} action="global/pessoal" />
        <form className="stack-form" onSubmit={handleSubmit}>
          <label>
            Título
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
          <label>
            Visibilidade
            <select value={scope} onChange={(event) => setScope(event.target.value as FileResourceScope)}>
              <option value="global">Todos os usuários (global)</option>
              <option value="privado">Somente eu (pessoal)</option>
            </select>
          </label>
          <label>
            Descrição
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
          <strong>{editingFolderId ? "Editar pasta" : "Nova pasta"}</strong>
          <label>
            Nome da pasta
            <input value={folderName} onChange={(event) => setFolderName(event.target.value)} />
          </label>
          <label>
            Visibilidade
            <select value={folderScope} onChange={(event) => setFolderScope(event.target.value as FileResourceScope)}>
              <option value="global">Todos os usuários (global)</option>
              <option value="privado">Somente eu (pessoal)</option>
            </select>
          </label>
          <label>
            Descrição
            <textarea value={folderDescription} onChange={(event) => setFolderDescription(event.target.value)} />
          </label>
          <div className="form-actions-inline">
            <button className="primary-action" disabled={saving || !folderName.trim()} type="submit">
              {editingFolderId ? "Salvar pasta" : "Criar pasta"}
            </button>
            {editingFolderId ? (
              <button disabled={saving} type="button" onClick={cancelFolderEdit}>
                Cancelar
              </button>
            ) : null}
          </div>
          {folders.length ? (
            <div className="folder-manage-list">
              {folders.map((folder) => (
                <span key={folder.id}>
                  {folder.nome}
                  {canManageFolder(folder) ? (
                    <>
                      <button aria-label={`Editar pasta ${folder.nome}`} disabled={saving} onClick={() => startEditFolder(folder)} title="Editar pasta" type="button">
                        <Edit3 size={12} strokeWidth={1.8} />
                      </button>
                      <button aria-label={`Excluir pasta ${folder.nome}`} disabled={saving} onClick={() => removeFolder(folder)} title="Excluir pasta" type="button">
                        <X size={12} strokeWidth={1.8} />
                      </button>
                    </>
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
