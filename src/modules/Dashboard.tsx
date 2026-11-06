import { CSSProperties, type ChangeEvent, FormEvent, type PointerEvent as ReactPointerEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Edit3, FileText, Image as ImageIcon, ListChecks, Paperclip, Plus, RefreshCw, Search, StickyNote, Tag, Trash2, Type as TypeIcon, X } from "lucide-react";
import { DashboardPanelHeader, PanelHeader, StatusPill } from "../components/common";
import { FooterUpdates } from "../components/Updates";
import type { HubProfile, HubUser, Pauta, QuadroAviso, QuadroAvisoKind } from "../types";
import type { PautaFilter, ReportFormat } from "../app/appTypes";
import { RichTextEditor } from "../components/RichTextEditor";
import { buildPautasEmailHtml, pautaToReportRow } from "../lib/reportRows";
import { canUserCompletePautaApp, canUserManagePautaApp, completeAppPauta, deleteAppPauta, getPautasSource, hasUserCompletedPauta, listAppPautas, saveAppPauta } from "../lib/pautasRepository";
import { canUserViewPauta, countPautaStatus, getPautaContentStyle, getPautaTone, isPautaAlta, isPautaAssignedToUser, isPautaAtrasada, isPautaConcluida, sortPautasForDashboard } from "../lib/hubRules";
import { confirmDeletion, formatDate, formatResponsaveis, getActiveProfiles, getErrorMessage, getInitials, normalizeForSearch, parseBrazilianDate, toDatetimeLocalValue } from "../lib/formatters";
import { convertLegacyPautaFormatting, hasPautaRichContent, pautaRichTextToPlain, sanitizePautaRichHtml } from "../lib/richText";
import { deleteQuadroAviso, listQuadroAvisos, removeQuadroAvisoFile, saveQuadroAviso, uploadQuadroAvisoFile } from "../lib/avisosRepository";
import { exportReport } from "../lib/reportExport";
import { getSupabaseAccessToken } from "../lib/auth";

export function Dashboard({
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
  const [quadroAvisos, setQuadroAvisos] = useState<QuadroAviso[]>([]);
  const [avisosLoading, setAvisosLoading] = useState(false);
  const [avisoSaving, setAvisoSaving] = useState(false);
  const [avisoMessage, setAvisoMessage] = useState("");
  const [avisoDraft, setAvisoDraft] = useState("");
  const [avisoKind, setAvisoKind] = useState<QuadroAvisoKind>("texto");
  const [avisoSelectedUsers, setAvisoSelectedUsers] = useState<string[]>([]);
  const [avisoColor, setAvisoColor] = useState("#fff4b8");
  const [avisoSelectedFile, setAvisoSelectedFile] = useState<File | null>(null);
  const [avisoDrawColor, setAvisoDrawColor] = useState("#1d3f6d");
  const [avisoDrawSize, setAvisoDrawSize] = useState(4);
  const [avisosPanel, setAvisosPanel] = useState<"leitura" | "editor" | null>(null);
  const [avisoDeleteId, setAvisoDeleteId] = useState("");
  const [avisoDeleting, setAvisoDeleting] = useState(false);
  const [avisoEditingId, setAvisoEditingId] = useState<string | null>(null);
  const [avisoEditorKey, setAvisoEditorKey] = useState(0);
  const avisoFileInputRef = useRef<HTMLInputElement | null>(null);
  const avisoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const avisoDrawingRef = useRef(false);
  const avisoLastPointRef = useRef<{ x: number; y: number } | null>(null);
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

  const loadQuadroAvisos = useCallback(async () => {
    setAvisosLoading(true);
    setAvisoMessage("");
    try {
      const loaded = await listQuadroAvisos(user);
      setQuadroAvisos(loaded);
    } catch (loadError) {
      setAvisoMessage(getErrorMessage(loadError));
    } finally {
      setAvisosLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (pautasView !== "avisos") return;
    void loadQuadroAvisos();
    window.addEventListener("hub:quadro-avisos", loadQuadroAvisos);
    return () => window.removeEventListener("hub:quadro-avisos", loadQuadroAvisos);
  }, [loadQuadroAvisos, pautasView]);

  const canManagePautas = user.role === "admin";
  const selectedYear = monthCursor.getFullYear();
  const selectedMonth = monthCursor.getMonth();

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
    setDescricao(convertLegacyPautaFormatting(pauta));
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
      // A formatacao fica no proprio texto (trecho a trecho), e nao na pauta inteira.
      textSize: "normal",
      textBold: false,
      textItalic: false,
      textHighlight: false,
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
    if (!confirmDeletion(`Excluir a pauta "${pauta.tema}"?`)) return;
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

  function toggleAvisoUser(email: string) {
    const normalizedEmail = email.trim().toLowerCase();
    setAvisoSelectedUsers((current) =>
      current.includes(normalizedEmail)
        ? current.filter((item) => item !== normalizedEmail)
        : [...current, normalizedEmail]
    );
  }

  function handleAvisosViewChange(nextView: "geral" | "particular") {
    setAvisosView(nextView);
    if (nextView === "geral") {
      setAvisoSelectedUsers([]);
    }
  }

  function chooseAvisoKind(nextKind: QuadroAvisoKind) {
    setAvisoKind(nextKind);
    setAvisosDrawMode(false);
    setAvisoMessage("");
    if (nextKind !== "imagem" && nextKind !== "anexo") {
      setAvisoSelectedFile(null);
      if (avisoFileInputRef.current) {
        avisoFileInputRef.current.value = "";
      }
    }
  }

  function handleAvisoFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] || null;
    setAvisoSelectedFile(file);
    if (file) {
      setAvisoMessage("");
    }
  }

  function openAvisoFilePicker(nextKind: Extract<QuadroAvisoKind, "imagem" | "anexo">) {
    setAvisoKind(nextKind);
    setAvisosDrawMode(false);
    setAvisoMessage("");
    avisoFileInputRef.current?.click();
  }

  function getAvisoCanvasPoint(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = event.currentTarget;
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height
    };
  }

  function beginAvisoDrawing(event: ReactPointerEvent<HTMLCanvasElement>) {
    event.preventDefault();
    avisoDrawingRef.current = true;
    avisoLastPointRef.current = getAvisoCanvasPoint(event);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function drawAvisoLine(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!avisoDrawingRef.current || !avisoLastPointRef.current) return;
    const canvas = event.currentTarget;
    const context = canvas.getContext("2d");
    if (!context) return;

    const nextPoint = getAvisoCanvasPoint(event);
    context.lineCap = "round";
    context.lineJoin = "round";
    context.strokeStyle = avisoDrawColor;
    context.lineWidth = avisoDrawSize;
    context.beginPath();
    context.moveTo(avisoLastPointRef.current.x, avisoLastPointRef.current.y);
    context.lineTo(nextPoint.x, nextPoint.y);
    context.stroke();
    avisoLastPointRef.current = nextPoint;
  }

  function endAvisoDrawing(event?: ReactPointerEvent<HTMLCanvasElement>) {
    avisoDrawingRef.current = false;
    avisoLastPointRef.current = null;
    if (event?.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function clearAvisoCanvas() {
    const canvas = avisoCanvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.clearRect(0, 0, canvas.width, canvas.height);
  }

  function exportAvisoDrawing() {
    const canvas = avisoCanvasRef.current;
    if (!canvas) return;
    const link = document.createElement("a");
    link.href = canvas.toDataURL("image/png");
    link.download = `quadro-avisos-desenho-${new Date().toISOString().slice(0, 10)}.png`;
    link.click();
  }

  async function handleSaveAviso() {
    setAvisoMessage("");
    const editingAviso = avisoEditingId ? quadroAvisos.find((aviso) => aviso.id === avisoEditingId) : undefined;
    const isFileKind = avisoKind === "imagem" || avisoKind === "anexo";
    const hasText = hasPautaRichContent(avisoDraft);
    const currentFile =
      editingAviso && editingAviso.kind === avisoKind && (editingAviso.filePath || editingAviso.fileUrl) ? editingAviso : undefined;

    if (isFileKind && !avisoSelectedFile && !currentFile) {
      setAvisoMessage(avisoKind === "imagem" ? "Selecione uma imagem antes de salvar." : "Selecione um documento antes de salvar.");
      return;
    }

    if (!isFileKind && !hasText) {
      setAvisoMessage("Escreva o aviso antes de salvar.");
      return;
    }

    if (avisosView === "particular" && avisoSelectedUsers.length === 0) {
      setAvisoMessage("Selecione ao menos um usuário para o quadro particular.");
      return;
    }

    setAvisoSaving(true);
    try {
      const uploadedFile = isFileKind && avisoSelectedFile ? await uploadQuadroAvisoFile(avisoSelectedFile, user) : null;
      const fileName = uploadedFile?.fileName || (isFileKind ? currentFile?.fileName : undefined);
      const filePath = uploadedFile ? uploadedFile.filePath : isFileKind ? currentFile?.filePath : undefined;
      const fileUrl = uploadedFile ? uploadedFile.fileUrl : isFileKind ? currentFile?.fileUrl : undefined;
      const nextAvisos = await saveQuadroAviso({
        current: quadroAvisos,
        user,
        aviso: {
          id: editingAviso?.id,
          cell: editingAviso?.cell || selectedAvisoCell,
          kind: avisoKind,
          visibility: avisosView,
          title: avisoKind === "postit" ? "Post-it" : fileName || "Aviso",
          content: hasText ? sanitizePautaRichHtml(avisoDraft) : fileName || "",
          color: avisoKind === "postit" ? avisoColor : "#ffffff",
          fileName,
          fileUrl,
          filePath,
          selectedUsers: avisosView === "particular" ? avisoSelectedUsers : []
        }
      });

      // Arquivo substituido ou removido na edicao: apaga o antigo do armazenamento.
      if (editingAviso?.filePath && editingAviso.filePath !== filePath) {
        void removeQuadroAvisoFile(editingAviso.filePath, user);
      }

      setQuadroAvisos(nextAvisos);
      setAvisoDraft("");
      setAvisoSelectedFile(null);
      if (avisoFileInputRef.current) {
        avisoFileInputRef.current.value = "";
      }
      setAvisoEditingId(null);
      setAvisoEditorKey((current) => current + 1);
      setAvisosPanel("leitura");
      setAvisoMessage(editingAviso ? "Alterações salvas." : "Aviso salvo no quadro.");
    } catch (saveError) {
      setAvisoMessage(getErrorMessage(saveError));
    } finally {
      setAvisoSaving(false);
    }
  }

  function getAvisoAuthorName(aviso: QuadroAviso) {
    const email = (aviso.createdByEmail || "").trim().toLowerCase();
    const profile = hubUsers.find((member) => member.email.trim().toLowerCase() === email);
    return profile?.nome || aviso.createdByEmail || "Autor não identificado";
  }

  function getAvisoRecipientNames(aviso: QuadroAviso) {
    return aviso.selectedUsers.map(
      (email) => hubUsers.find((member) => member.email.trim().toLowerCase() === email)?.nome || email
    );
  }

  function canManageAviso(aviso: QuadroAviso) {
    if (user.role === "admin") return true;
    if (aviso.createdBy && user.id && aviso.createdBy === user.id) return true;
    return Boolean(aviso.createdByEmail) && aviso.createdByEmail === user.email.trim().toLowerCase();
  }

  function openAvisoCell(cell: number) {
    setSelectedAvisoCell(cell);
    setAvisosPanel("leitura");
    setAvisoDeleteId("");
    setAvisoMessage("");
  }

  function openAvisoEditor(cell = selectedAvisoCell) {
    setSelectedAvisoCell(cell);
    setAvisoEditingId(null);
    setAvisoDraft("");
    setAvisoSelectedFile(null);
    if (avisoFileInputRef.current) {
      avisoFileInputRef.current.value = "";
    }
    setAvisoEditorKey((current) => current + 1);
    setAvisosPanel("editor");
    setAvisosDrawMode(false);
    setAvisoDeleteId("");
    setAvisoMessage("");
  }

  function closeAvisosPanel() {
    setAvisosPanel(null);
    setAvisoDeleteId("");
    setAvisoEditingId(null);
  }

  function startEditAviso(aviso: QuadroAviso) {
    const isFile = aviso.kind === "imagem" || aviso.kind === "anexo";
    setSelectedAvisoCell(aviso.cell);
    setAvisoEditingId(aviso.id);
    setAvisoKind(aviso.kind);
    if (aviso.kind === "postit") setAvisoColor(aviso.color || "#fff4b8");
    setAvisoDraft(isFile ? (aviso.content && aviso.content !== aviso.fileName ? aviso.content : "") : aviso.content);
    setAvisosView(aviso.visibility);
    setAvisoSelectedUsers(aviso.selectedUsers);
    setAvisoSelectedFile(null);
    if (avisoFileInputRef.current) {
      avisoFileInputRef.current.value = "";
    }
    setAvisoDeleteId("");
    setAvisoMessage("");
    setAvisosDrawMode(false);
    setAvisoEditorKey((current) => current + 1);
    setAvisosPanel("editor");
  }

  async function handleDeleteAviso(aviso: QuadroAviso) {
    if (avisoDeleteId !== aviso.id) {
      setAvisoDeleteId(aviso.id);
      return;
    }

    setAvisoDeleting(true);
    setAvisoMessage("");
    try {
      const nextAvisos = await deleteQuadroAviso({ current: quadroAvisos, aviso, user });
      setQuadroAvisos(nextAvisos);
      setAvisoDeleteId("");
      setAvisoMessage("Aviso excluído.");
    } catch (deleteError) {
      setAvisoMessage(getErrorMessage(deleteError));
    } finally {
      setAvisoDeleting(false);
    }
  }

  function renderAvisoCard(aviso: QuadroAviso, mode: "quadro" | "leitura") {
    const isPostit = aviso.kind === "postit";
    const caption = aviso.content && aviso.content !== aviso.fileName ? aviso.content : "";
    const text = aviso.kind === "texto" || isPostit ? aviso.content : caption;
    const stopCellClick = (event: { stopPropagation: () => void }) => event.stopPropagation();

    return (
      <article
        className={`aviso-card aviso-card--${aviso.kind} aviso-card--${mode}`}
        key={aviso.id}
        style={isPostit ? { background: aviso.color || "#fff4b8" } : undefined}
      >
        {aviso.kind === "imagem" ? (
          aviso.fileUrl ? (
            <a
              className="aviso-card__image"
              href={aviso.fileUrl}
              rel="noreferrer"
              target="_blank"
              title="Abrir imagem em tamanho original"
              onClick={stopCellClick}
            >
              <img alt={caption || aviso.fileName || "Imagem do aviso"} src={aviso.fileUrl} />
            </a>
          ) : (
            <span className="aviso-card__file aviso-card__file--indisponivel">
              <ImageIcon size={18} strokeWidth={1.6} />
              <span>Imagem indisponível no momento</span>
            </span>
          )
        ) : null}
        {aviso.kind === "anexo" ? (
          aviso.fileUrl ? (
            <a
              className="aviso-card__file"
              href={aviso.fileUrl}
              rel="noreferrer"
              target="_blank"
              title="Abrir anexo"
              onClick={stopCellClick}
            >
              <FileText size={18} strokeWidth={1.6} />
              <span>{aviso.fileName || "Documento anexado"}</span>
            </a>
          ) : (
            <span className="aviso-card__file aviso-card__file--indisponivel">
              <FileText size={18} strokeWidth={1.6} />
              <span>{aviso.fileName || "Documento"} (indisponível no momento)</span>
            </span>
          )
        ) : null}
        {hasPautaRichContent(text) ? (
          <div className="aviso-card__text pauta-rich-text" dangerouslySetInnerHTML={{ __html: sanitizePautaRichHtml(text) }} />
        ) : null}
        <footer className="aviso-card__meta">
          <span>{mode === "quadro" ? getAvisoAuthorName(aviso).split(" ")[0] : getAvisoAuthorName(aviso)}</span>
          <span>{formatDate(aviso.updatedAt)}</span>
        </footer>
        {mode === "leitura" && aviso.visibility === "particular" && aviso.selectedUsers.length ? (
          <p className="aviso-card__para">Para: {getAvisoRecipientNames(aviso).join(", ")}</p>
        ) : null}
        {mode === "leitura" && canManageAviso(aviso) ? (
          <div className="aviso-card__actions">
            {avisoDeleteId === aviso.id ? (
              <>
                <span>Excluir este aviso definitivamente?</span>
                <button disabled={avisoDeleting} type="button" onClick={() => setAvisoDeleteId("")}>
                  Cancelar
                </button>
                <button className="danger" disabled={avisoDeleting} type="button" onClick={() => handleDeleteAviso(aviso)}>
                  {avisoDeleting ? "Excluindo..." : "Confirmar exclusão"}
                </button>
              </>
            ) : (
              <>
                <button type="button" onClick={() => startEditAviso(aviso)}>
                  <Edit3 size={14} strokeWidth={1.6} />
                  Editar
                </button>
                <button type="button" onClick={() => handleDeleteAviso(aviso)}>
                  <Trash2 size={14} strokeWidth={1.6} />
                  Excluir
                </button>
              </>
            )}
          </div>
        ) : null}
      </article>
    );
  }

  function renderQuadroAvisos() {
    const avisoCells = Array.from({ length: 10 }, (_, index) => index + 1);
    const activeProfiles = getActiveProfiles(hubUsers);
    const visibleAvisos = quadroAvisos.filter((aviso) => aviso.visibility === avisosView);
    const selectedCellAvisos = visibleAvisos.filter((aviso) => aviso.cell === selectedAvisoCell);
    const selectedCellLabel = `Espaço ${String(selectedAvisoCell).padStart(2, "0")}`;
    const boardLabel = avisosView === "geral" ? "Quadro geral" : "Quadro particular";
    const avisoKinds = [
      { kind: "texto", label: "Texto", Icon: TypeIcon },
      { kind: "postit", label: "Post-it", Icon: StickyNote },
      { kind: "imagem", label: "Imagem", Icon: ImageIcon },
      { kind: "anexo", label: "Anexo", Icon: Paperclip }
    ] as const;
    const isFileKind = avisoKind === "imagem" || avisoKind === "anexo";
    const editingAviso = avisoEditingId ? quadroAvisos.find((aviso) => aviso.id === avisoEditingId) : undefined;

    return (
      <div className="avisos-board">
        <div className="avisos-toolbar">
          <div className="avisos-toolbar-main">
            <button
              className={!avisosDrawMode ? "primary" : ""}
              type="button"
              onClick={() => {
                setAvisosDrawMode(false);
                setAvisoMessage("");
              }}
            >
              Quadro de Avisos
            </button>
            <button
              className={avisosDrawMode ? "primary" : ""}
              type="button"
              onClick={() => {
                setAvisosDrawMode(true);
                setAvisoMessage("");
              }}
            >
              Desenhar
            </button>
          </div>
          {!avisosDrawMode ? (
            <div className="avisos-toolbar-side">
              {avisosLoading ? <span className="avisos-status">Carregando avisos...</span> : null}
              <div className="avisos-mode-switch" aria-label="Filtro do quadro de avisos">
                <button
                  className={avisosView === "geral" ? "active" : ""}
                  type="button"
                  onClick={() => handleAvisosViewChange("geral")}
                >
                  Quadro geral
                </button>
                <button
                  className={avisosView === "particular" ? "active" : ""}
                  type="button"
                  onClick={() => handleAvisosViewChange("particular")}
                >
                  Quadro particular
                </button>
              </div>
              <button className="avisos-new" type="button" onClick={() => openAvisoEditor()}>
                <Plus size={14} strokeWidth={1.8} />
                Novo aviso
              </button>
            </div>
          ) : null}
        </div>

        {avisoMessage ? (
          <div className={`avisos-message ${/salv|excluído/.test(avisoMessage) ? "success" : ""}`}>
            {avisoMessage}
          </div>
        ) : null}

        <input
          ref={avisoFileInputRef}
          accept={avisoKind === "imagem" ? "image/png,image/jpeg,image/webp,image/gif" : ".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg"}
          className="sr-only"
          type="file"
          onChange={handleAvisoFileChange}
        />

        {avisosDrawMode ? (
          <div className="avisos-draw-stage">
            <div className="avisos-draw-head">
              <div>
                <strong>Modo desenho</strong>
                <span>Quadro branco temporario para rascunhos. Exporte antes de sair deste modo.</span>
              </div>
              <div className="avisos-export-actions">
                <button type="button" onClick={exportAvisoDrawing}>Exportar PNG</button>
                <button type="button" onClick={clearAvisoCanvas}>Limpar</button>
              </div>
            </div>
            <div className="avisos-draw-tools">
              <label>
                Cor
                <input value={avisoDrawColor} type="color" onChange={(event) => setAvisoDrawColor(event.target.value)} />
              </label>
              <label>
                Espessura
                <input
                  max={18}
                  min={1}
                  type="range"
                  value={avisoDrawSize}
                  onChange={(event) => setAvisoDrawSize(Number(event.target.value))}
                />
              </label>
            </div>
            <div className="avisos-draw-canvas">
              <canvas
                ref={avisoCanvasRef}
                aria-label="Area livre para desenho estilo Paint"
                height={790}
                width={1400}
                onPointerCancel={endAvisoDrawing}
                onPointerDown={beginAvisoDrawing}
                onPointerLeave={endAvisoDrawing}
                onPointerMove={drawAvisoLine}
                onPointerUp={endAvisoDrawing}
              />
            </div>
          </div>
        ) : (
          <div className={`avisos-workspace ${avisosPanel ? "avisos-workspace--com-painel" : ""}`}>
            <div className="avisos-grid" aria-label="Quadro de avisos em 10 espaços">
              {avisoCells.map((cell) => {
                const cellAvisos = visibleAvisos.filter((aviso) => aviso.cell === cell);
                const cellLabel = `Espaço ${String(cell).padStart(2, "0")}`;
                return (
                  <section
                    className={`aviso-cell ${avisosPanel && selectedAvisoCell === cell ? "active" : ""} ${cellAvisos.length ? "" : "aviso-cell--vazia"}`}
                    key={cell}
                    onClick={() => (cellAvisos.length ? openAvisoCell(cell) : openAvisoEditor(cell))}
                  >
                    <header className="aviso-cell__head">
                      <button
                        aria-label={cellAvisos.length ? `Abrir avisos do ${cellLabel}` : `Adicionar aviso no ${cellLabel}`}
                        className="aviso-cell__title"
                        type="button"
                      >
                        {cellLabel}
                      </button>
                      {cellAvisos.length ? (
                        <span className="aviso-cell__count">
                          {cellAvisos.length} {cellAvisos.length === 1 ? "aviso" : "avisos"}
                        </span>
                      ) : null}
                    </header>
                    <div className="aviso-cell__body">
                      {cellAvisos.length ? (
                        cellAvisos.map((aviso) => renderAvisoCard(aviso, "quadro"))
                      ) : (
                        <span className="aviso-cell__empty">
                          <Plus size={14} strokeWidth={1.6} />
                          Adicionar aviso
                        </span>
                      )}
                    </div>
                  </section>
                );
              })}
            </div>

            {avisosPanel === "leitura" ? (
              <aside className="avisos-side-panel" aria-label={`Avisos do ${selectedCellLabel}`}>
                <header className="avisos-side-panel__head">
                  <div>
                    <h3>{selectedCellLabel}</h3>
                    <span>
                      {boardLabel} · {selectedCellAvisos.length} {selectedCellAvisos.length === 1 ? "aviso" : "avisos"}
                    </span>
                  </div>
                  <div className="avisos-side-panel__actions">
                    <button type="button" onClick={() => openAvisoEditor(selectedAvisoCell)}>
                      <Plus size={14} strokeWidth={1.6} />
                      Novo aviso
                    </button>
                    <button aria-label="Fechar painel" className="icon-only" type="button" onClick={closeAvisosPanel}>
                      <X size={16} strokeWidth={1.6} />
                    </button>
                  </div>
                </header>
                <div className="avisos-side-panel__body">
                  {selectedCellAvisos.length ? (
                    selectedCellAvisos.map((aviso) => renderAvisoCard(aviso, "leitura"))
                  ) : (
                    <p className="avisos-muted">Nenhum aviso neste espaço.</p>
                  )}
                </div>
              </aside>
            ) : null}

            {avisosPanel === "editor" ? (
              <aside
                className="avisos-side-panel avisos-editor-panel"
                aria-label={`${editingAviso ? "Editar aviso" : "Novo aviso"} no ${selectedCellLabel}`}
              >
                <header className="avisos-side-panel__head">
                  <div>
                    <h3>{editingAviso ? "Editar aviso" : "Novo aviso"}</h3>
                    <span>{selectedCellLabel} · {boardLabel}</span>
                  </div>
                  <div className="avisos-side-panel__actions">
                    {selectedCellAvisos.length ? (
                      <button type="button" onClick={() => openAvisoCell(selectedAvisoCell)}>
                        <ChevronLeft size={14} strokeWidth={1.6} />
                        Ver avisos
                      </button>
                    ) : null}
                    <button aria-label="Fechar editor" className="icon-only" type="button" onClick={closeAvisosPanel}>
                      <X size={16} strokeWidth={1.6} />
                    </button>
                  </div>
                </header>
                <div className="avisos-side-panel__body">
                  <div className="aviso-kind-switch" role="radiogroup" aria-label="Tipo de aviso">
                    {avisoKinds.map(({ kind, label, Icon }) => (
                      <button
                        aria-checked={avisoKind === kind}
                        className={avisoKind === kind ? "active" : ""}
                        key={kind}
                        role="radio"
                        type="button"
                        onClick={() => chooseAvisoKind(kind)}
                      >
                        <Icon size={16} strokeWidth={1.6} />
                        {label}
                      </button>
                    ))}
                  </div>
                  {avisoKind === "postit" ? (
                    <div className="aviso-color-swatches" aria-label="Cores da nota adesiva">
                      {["#fff4b8", "#fde2e2", "#dcfce7", "#dbeafe", "#fef3c7", "#f3e8ff"].map((color) => (
                        <button
                          aria-label={`Usar cor ${color}`}
                          className={avisoColor === color ? "active" : ""}
                          key={color}
                          style={{ background: color }}
                          type="button"
                          onClick={() => setAvisoColor(color)}
                        />
                      ))}
                    </div>
                  ) : null}
                  {isFileKind ? (
                    <div className="aviso-file-tools">
                      <button type="button" onClick={() => avisoFileInputRef.current?.click()}>
                        {avisoKind === "imagem" ? "Selecionar imagem" : "Selecionar documento"}
                      </button>
                      {avisoSelectedFile ? (
                        <span className="aviso-file-chip">
                          {avisoSelectedFile.name}
                          <button
                            aria-label="Remover arquivo selecionado"
                            type="button"
                            onClick={() => {
                              setAvisoSelectedFile(null);
                              if (avisoFileInputRef.current) {
                                avisoFileInputRef.current.value = "";
                              }
                            }}
                          >
                            <X size={12} strokeWidth={1.8} />
                          </button>
                        </span>
                      ) : (
                        <small>
                          {editingAviso?.fileName && editingAviso.kind === avisoKind
                            ? `Arquivo atual: ${editingAviso.fileName}`
                            : "Nenhum arquivo selecionado."}
                        </small>
                      )}
                    </div>
                  ) : null}
                  <RichTextEditor
                    ariaLabel={isFileKind ? "Legenda do arquivo" : "Texto do aviso"}
                    editorStyle={avisoKind === "postit" ? { background: avisoColor, borderColor: "rgba(0, 0, 0, 0.12)" } : undefined}
                    label={isFileKind ? "Legenda (opcional)" : "Texto do aviso"}
                    placeholder={
                      avisoKind === "postit"
                        ? "Escreva o texto da nota adesiva."
                        : isFileKind
                          ? "Descreva brevemente o arquivo, se quiser."
                          : "Escreva o aviso, orientação ou recado."
                    }
                    resetKey={avisoEditorKey}
                    value={avisoDraft}
                    onChange={setAvisoDraft}
                  />
                  <fieldset className="member-picker avisos-member-picker">
                    <legend>Publicar em</legend>
                    <label>
                      <input checked={avisosView === "geral"} onChange={() => handleAvisosViewChange("geral")} type="radio" />
                      Quadro geral
                    </label>
                    <label>
                      <input checked={avisosView === "particular"} onChange={() => handleAvisosViewChange("particular")} type="radio" />
                      Quadro particular
                    </label>
                  </fieldset>
                  {avisosView === "particular" ? (
                    <div className="avisos-user-list" aria-label="Destinatários do aviso particular">
                      {activeProfiles.map((member) => {
                        const email = member.email.trim().toLowerCase();
                        return (
                          <label key={member.email}>
                            <input
                              checked={avisoSelectedUsers.includes(email)}
                              onChange={() => toggleAvisoUser(member.email)}
                              type="checkbox"
                            />
                            {member.nome}
                          </label>
                        );
                      })}
                    </div>
                  ) : null}
                  <button className="primary-action" disabled={avisoSaving || avisosLoading} type="button" onClick={handleSaveAviso}>
                    {avisoSaving ? "Salvando..." : editingAviso ? "Salvar alterações" : "Salvar aviso"}
                  </button>
                </div>
              </aside>
            ) : null}
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
              Título
              <input value={titulo} onChange={(event) => setTitulo(event.target.value)} />
            </label>
            <RichTextEditor
              ariaLabel="Descrição / orientação"
              label="Descrição / orientação"
              placeholder="Escreva a orientação da pauta..."
              resetKey={`${formOpen}-${editingId || "nova"}`}
              value={descricao}
              onChange={setDescricao}
            />
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
