import {
  Award,
  ChevronDown,
  ExternalLink,
  FilePlus2,
  LayoutDashboard,
  ListChecks,
  Maximize2,
  MessageSquareReply,
  Minimize2,
  Plus,
  Printer,
  RotateCcw,
  Save,
  Send,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { HubUser } from "../types";
import { PanelHeader, StatusPill } from "../components/common";
import { confirmDeletion, getErrorMessage } from "../lib/formatters";
import { escapeHtmlText } from "../lib/reportExport";
import {
  AVALIACAO_CRITERIOS,
  AVALIACAO_ESCALA,
  AVALIACAO_FEEDBACK,
  AVALIACAO_TITULO,
  RECOMENDACOES_PADRAO,
  STATUS_LABEL,
  competenciaAtual,
  competenciaParaInput,
  enviarAvaliacaoPorEmail,
  excluirAvaliacao,
  faixaDaNota,
  formatNota,
  getAvaliacoesSource,
  inputParaCompetencia,
  isAvaliador,
  listAvaliacoes,
  mediaGeral,
  mediaGeralDaAvaliacao,
  mediaNotas,
  novaAvaliacao,
  novaRecomendacao,
  salvarAutoavaliacao,
  salvarCoordenacao,
  salvarReplicas,
  type Avaliacao,
  type AvaliacaoCoordenacao,
  type AvaliacaoStatus,
  type CriterioId,
  type FeedbackId,
  type NotasPorCriterio
} from "../lib/avaliacoes";

const APP_ANTIGO_URL = "https://script.google.com/macros/s/AKfycbyuiPXfkDNl_n-TKTRw3EQ8Dexk7Mq6vodTDQmxf8LRhJ9lJJw_j6h4M-tcsPc7iwsR/exec";

const coordVazia = (): AvaliacaoCoordenacao => ({ coordenador: {}, subcoordenacao: {}, recomendacoes: [], respostasFeedback: {} });

// Seções que podem ser minimizadas (a escolha fica guardada neste navegador).
const SECOES = ["notas", "feedback", "escala", "recomendacoes"] as const;
const MIN_KEY = "hub_aval_secoes_minimizadas";

function lerMinimizadas(): Record<string, boolean> {
  try {
    const valor = JSON.parse(window.localStorage.getItem(MIN_KEY) || "{}");
    return valor && typeof valor === "object" ? valor : {};
  } catch {
    return {};
  }
}

function gravarMinimizadas(valor: Record<string, boolean>) {
  try {
    window.localStorage.setItem(MIN_KEY, JSON.stringify(valor));
  } catch {
    // sem armazenamento local: vale só nesta sessão
  }
}

function Secao({
  titulo,
  resumo,
  aberta,
  onAlternar,
  acoes,
  className = "",
  children
}: {
  titulo: string;
  resumo?: string;
  aberta: boolean;
  onAlternar: () => void;
  acoes?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <section className={`aval-secao ${className} ${aberta ? "" : "is-minimizada"}`}>
      <header className="aval-secao-head">
        <button aria-expanded={aberta} className="aval-secao-toggle" type="button" onClick={onAlternar} title={aberta ? "Minimizar" : "Expandir"}>
          <ChevronDown size={16} strokeWidth={1.6} />
          <h3>{titulo}</h3>
        </button>
        {!aberta && resumo ? <small className="aval-secao-resumo">{resumo}</small> : null}
        {aberta && acoes ? <div className="aval-secao-acoes">{acoes}</div> : null}
      </header>
      {aberta ? <div className="aval-secao-body">{children}</div> : null}
    </section>
  );
}

function temNotas(notas: NotasPorCriterio | undefined) {
  return AVALIACAO_CRITERIOS.some((c) => typeof notas?.[c.id]?.nota === "number" || Boolean(notas?.[c.id]?.justificativa?.trim()));
}

function lerNota(valor: string): number | null {
  if (valor.trim() === "") return null;
  const n = Number(valor.replace(",", "."));
  if (Number.isNaN(n)) return null;
  return Math.min(10, Math.max(0, n));
}

export function AvaliacoesModule({ user }: { user: HubUser }) {
  const admin = isAvaliador(user);
  const meuId = user.id || user.email;
  const [items, setItems] = useState<Avaliacao[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState<Avaliacao | null>(null);
  const [coord, setCoord] = useState<AvaliacaoCoordenacao>(coordVazia());
  const [filtroCompetencia, setFiltroCompetencia] = useState("");
  const [filtroStatus, setFiltroStatus] = useState<"" | AvaliacaoStatus>("");
  const [minimizadas, setMinimizadas] = useState<Record<string, boolean>>(lerMinimizadas);
  const todasMinimizadas = SECOES.every((id) => minimizadas[id]);

  function alternarSecao(id: (typeof SECOES)[number]) {
    setMinimizadas((atual) => {
      const proximo = { ...atual, [id]: !atual[id] };
      gravarMinimizadas(proximo);
      return proximo;
    });
  }

  function alternarTodas() {
    const proximo = Object.fromEntries(SECOES.map((id) => [id, !todasMinimizadas]));
    gravarMinimizadas(proximo);
    setMinimizadas(proximo);
  }

  async function carregar(selecionarId?: string) {
    setLoading(true);
    try {
      const lista = await listAvaliacoes(user);
      setItems(lista);
      if (selecionarId) abrir(lista.find((a) => a.id === selecionarId) || null);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void carregar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.email]);

  function abrir(avaliacao: Avaliacao | null) {
    setDraft(avaliacao ? structuredClone(avaliacao) : null);
    const base = avaliacao?.coordenacao ? structuredClone(avaliacao.coordenacao) : coordVazia();
    base.respostasFeedback = base.respostasFeedback || {};
    // A coordenação começa com cinco campos de recomendação em branco (pode incluir ou excluir).
    if (admin && !base.recomendacoes.length) base.recomendacoes = Array.from({ length: RECOMENDACOES_PADRAO }, () => novaRecomendacao());
    setCoord(base);
    setError("");
  }

  function novaAutoavaliacao() {
    setNotice("");
    const competencia = competenciaAtual();
    const existente = items.find((a) => a.userId === meuId && a.competencia === competencia);
    abrir(existente || novaAvaliacao(user, competencia));
  }

  const competencias = useMemo(() => [...new Set(items.map((a) => a.competencia))], [items]);
  const visiveis = useMemo(
    () => items.filter((a) => (!filtroCompetencia || a.competencia === filtroCompetencia) && (!filtroStatus || a.status === filtroStatus)),
    [items, filtroCompetencia, filtroStatus]
  );

  const persistida = draft ? items.some((a) => a.id === draft.id) : false;
  const souDono = draft ? draft.userId === meuId : false;
  const podeEditarAuto = Boolean(draft) && ((souDono && draft!.status === "rascunho") || admin);
  const mostraCoord = Boolean(draft) && (admin || draft!.status === "devolvida");
  const mostraSub = temNotas(coord.subcoordenacao);
  const podeReplicar = Boolean(draft) && souDono && persistida && draft!.status === "devolvida";
  const recomendacoesVisiveis = admin ? coord.recomendacoes : coord.recomendacoes.filter((r) => r.texto.trim());

  function setAuto(id: CriterioId, campo: "nota" | "justificativa", valor: string) {
    if (!draft) return;
    const atual = draft.autoavaliacao[id] || { nota: null, justificativa: "" };
    const proximo = campo === "nota" ? { ...atual, nota: lerNota(valor) } : { ...atual, justificativa: valor };
    setDraft({ ...draft, autoavaliacao: { ...draft.autoavaliacao, [id]: proximo } });
  }

  function setCoordNota(id: CriterioId, campo: "nota" | "justificativa", valor: string) {
    const atual = coord.coordenador[id] || { nota: null, justificativa: "" };
    const proximo = campo === "nota" ? { ...atual, nota: lerNota(valor) } : { ...atual, justificativa: valor };
    setCoord({ ...coord, coordenador: { ...coord.coordenador, [id]: proximo } });
  }

  // Atalho da coordenação: lança 10 em todos os critérios (mantém as justificativas já escritas).
  function preencherCoordCom10() {
    const jaLancadas = AVALIACAO_CRITERIOS.some((c) => {
      const nota = coord.coordenador[c.id]?.nota;
      return typeof nota === "number" && nota !== 10;
    });
    if (jaLancadas && !window.confirm("Substituir as notas do coordenador já lançadas por 10 em todos os critérios?\nAs justificativas serão mantidas.")) return;
    const coordenador = { ...coord.coordenador };
    for (const c of AVALIACAO_CRITERIOS) coordenador[c.id] = { nota: 10, justificativa: coordenador[c.id]?.justificativa || "" };
    setCoord({ ...coord, coordenador });
    setNotice("Notas do coordenador preenchidas com 10. Ajuste as que precisar e salve.");
  }

  function setFeedback(id: FeedbackId, valor: string) {
    if (!draft) return;
    setDraft({ ...draft, feedback: { ...draft.feedback, [id]: valor } });
  }

  function setRespostaFeedback(id: FeedbackId, texto: string) {
    setCoord({ ...coord, respostasFeedback: { ...coord.respostasFeedback, [id]: texto } });
  }

  function setRecomendacao(id: string, texto: string) {
    setCoord({ ...coord, recomendacoes: coord.recomendacoes.map((r) => (r.id === id ? { ...r, texto } : r)) });
  }

  function incluirRecomendacao() {
    setCoord({ ...coord, recomendacoes: [...coord.recomendacoes, novaRecomendacao()] });
  }

  function excluirRecomendacao(id: string) {
    const item = coord.recomendacoes.find((r) => r.id === id);
    const temReplica = Boolean(draft?.replicas[id]?.trim());
    if ((item?.texto.trim() || temReplica) && !window.confirm(temReplica ? "Excluir esta recomendação? A réplica do colaborador a ela também deixará de aparecer." : "Excluir esta recomendação?")) return;
    setCoord({ ...coord, recomendacoes: coord.recomendacoes.filter((r) => r.id !== id) });
  }

  function setReplica(id: string, texto: string) {
    if (!draft) return;
    setDraft({ ...draft, replicas: { ...draft.replicas, [id]: texto } });
  }

  function validarEnvio(av: Avaliacao) {
    const faltando = AVALIACAO_CRITERIOS.filter((c) => typeof av.autoavaliacao[c.id]?.nota !== "number").map((c) => c.nome);
    if (faltando.length) return `Informe a nota de: ${faltando.join(", ")}.`;
    const semJust = AVALIACAO_CRITERIOS.filter((c) => !av.autoavaliacao[c.id]?.justificativa?.trim()).map((c) => c.nome);
    if (semJust.length) return `Escreva a justificativa de: ${semJust.join(", ")}.`;
    return "";
  }

  async function avisarPorEmail(salvo: Avaliacao, tipo: "envio" | "devolvida" | "replica", destino: string) {
    try {
      return ` ${await enviarAvaliacaoPorEmail(salvo, tipo)}`;
    } catch (err) {
      return ` Atenção: o e-mail não foi enviado (${getErrorMessage(err)}). ${destino}`;
    }
  }

  async function salvarColaborador(enviar: boolean) {
    if (!draft) return;
    setError("");
    setNotice("");
    if (enviar) {
      const problema = validarEnvio(draft);
      if (problema) {
        setError(problema);
        return;
      }
      if (!window.confirm("Enviar a autoavaliação para a coordenação?\nDepois do envio, só a coordenação poderá alterá-la.")) return;
    }
    setSaving(true);
    try {
      const salvo = await salvarAutoavaliacao(draft, user, enviar);
      let mensagem = enviar ? "Autoavaliação enviada à coordenação." : "Rascunho salvo.";
      if (enviar) mensagem += await avisarPorEmail(salvo, "envio", "A coordenação verá a avaliação no HUB.");
      setNotice(mensagem);
      await carregar(salvo.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function salvarAdmin(status: AvaliacaoStatus, mensagem: string, confirmar?: string, avisar = false) {
    if (!draft) return;
    if (confirmar && !window.confirm(confirmar)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      // "Salvar e devolver" sempre avisa o colaborador (inclusive ao devolver de novo após correções).
      const devolvendo = avisar && status === "devolvida";
      const salvo = await salvarCoordenacao(draft, coord, status, user);
      let texto = mensagem;
      if (devolvendo) texto += await avisarPorEmail(salvo, "devolvida", "O colaborador verá a devolutiva no HUB.");
      setNotice(texto);
      await carregar(salvo.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function gravarReplicas(avisar: boolean) {
    if (!draft) return;
    setError("");
    setNotice("");
    const preenchidas = coord.recomendacoes.filter((r) => draft.replicas[r.id]?.trim());
    if (avisar && !preenchidas.length) {
      setError("Escreva ao menos uma réplica antes de avisar a coordenação.");
      return;
    }
    setSaving(true);
    try {
      const salvo = await salvarReplicas(draft, draft.replicas, user);
      let mensagem = "Réplicas salvas.";
      if (avisar) mensagem += await avisarPorEmail(salvo, "replica", "A coordenação verá as réplicas no HUB.");
      setNotice(mensagem);
      await carregar(salvo.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function excluir() {
    if (!draft) return;
    if (!confirmDeletion(`Excluir a avaliação de ${draft.colaboradorNome} (${draft.competencia})?`)) return;
    setSaving(true);
    try {
      await excluirAvaliacao(draft, user);
      setNotice("Avaliação excluída.");
      abrir(null);
      await carregar();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  function imprimir() {
    if (!draft) return;
    const janela = window.open("", "_blank");
    if (!janela) return;
    janela.document.write(montarImpressao(draft, mostraCoord ? coord : null));
    janela.document.close();
    janela.focus();
    janela.print();
  }

  const mediaAuto = draft ? mediaNotas(draft.autoavaliacao) : null;
  const mediaCoord = mediaNotas(coord.coordenador);
  const mediaSub = mediaNotas(coord.subcoordenacao);
  const temAvaliacaoCoord = mediaCoord !== null || mediaSub !== null;
  const geral = temAvaliacaoCoord ? mediaGeral([mediaAuto, mediaCoord, mediaSub]) : null;

  return (
    <div className="aval-page">
      <section className="panel aval-list-panel">
        <PanelHeader title="Avaliações" icon={<Award size={18} strokeWidth={1.6} />} action={loading ? "carregando" : getAvaliacoesSource()} />
        <div className="aval-list-actions">
          <button className="primary-action" type="button" onClick={novaAutoavaliacao}>
            <FilePlus2 size={15} strokeWidth={1.6} />
            Nova autoavaliação
          </button>
          {admin ? (
            <button
              className={`aval-painel-btn ${!draft ? "active" : ""}`}
              type="button"
              onClick={() => {
                setNotice("");
                abrir(null);
              }}
              title="Painel da coordenação: avaliações aguardando análise, devolvidas e com réplica"
            >
              <LayoutDashboard size={15} strokeWidth={1.6} />
              Painel
            </button>
          ) : null}
          {admin ? (
            <a className="aval-old-app" href={APP_ANTIGO_URL} rel="noreferrer" target="_blank" title="Abrir o app de avaliações anterior (Google)">
              <ExternalLink size={14} strokeWidth={1.6} />
              App anterior
            </a>
          ) : null}
        </div>
        {admin ? (
          <div className="aval-filters">
            <label>
              Competência
              <select value={filtroCompetencia} onChange={(e) => setFiltroCompetencia(e.target.value)}>
                <option value="">Todas</option>
                {competencias.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Situação
              <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value as "" | AvaliacaoStatus)}>
                <option value="">Todas</option>
                <option value="rascunho">Rascunho</option>
                <option value="enviada">Enviada</option>
                <option value="devolvida">Avaliada</option>
              </select>
            </label>
          </div>
        ) : null}
        <div className="aval-list">
          {visiveis.map((a) => {
            const geralItem = mediaGeralDaAvaliacao(a);
            const temReplicas = Object.values(a.replicas || {}).some((t) => t?.trim());
            return (
              <button className={`aval-item ${draft?.id === a.id ? "active" : ""}`} key={a.id} type="button" onClick={() => abrir(a)}>
                <strong>{admin ? a.colaboradorNome : `Competência ${a.competencia}`}</strong>
                <span>{admin ? `Competência ${a.competencia}` : STATUS_LABEL[a.status]}</span>
                <em className={`aval-status aval-status--${a.status}`}>
                  {STATUS_LABEL[a.status]}
                  {temReplicas ? " · com réplica" : ""}
                </em>
                <small>
                  Autoavaliação {formatNota(mediaNotas(a.autoavaliacao))}
                  {a.coordenacao ? ` · Coordenador ${formatNota(mediaNotas(a.coordenacao.coordenador))}` : ""}
                  {geralItem !== null ? ` · Geral ${formatNota(geralItem)}` : ""}
                </small>
              </button>
            );
          })}
          {!loading && !visiveis.length ? <div className="empty-state">Nenhuma avaliação {admin ? "para o filtro atual" : "ainda"}.</div> : null}
        </div>
      </section>

      <section className="panel aval-main-panel">
        {!draft && admin ? (
          <PainelCoordenacao
            competencia={filtroCompetencia}
            itens={items.filter((a) => !filtroCompetencia || a.competencia === filtroCompetencia)}
            onAbrir={(a) => {
              setNotice("");
              abrir(a);
            }}
          />
        ) : !draft ? (
          <div className="aval-empty">
            <Award size={30} strokeWidth={1.4} />
            <h3>{AVALIACAO_TITULO}</h3>
            <p>
              {admin
                ? "Escolha uma avaliação na lista para avaliar, corrigir e devolver ao colaborador, ou crie a sua própria autoavaliação."
                : "Clique em “Nova autoavaliação”, preencha as notas, as justificativas e o feedback, salve e envie à coordenação."}
            </p>
            <EscalaReferencia />
          </div>
        ) : (
          <>
            <header className="aval-head">
              <div>
                <span className="aval-kicker">{AVALIACAO_TITULO}</span>
                <h2>{draft.colaboradorNome}</h2>
                <div className="aval-head-meta">
                  <label>
                    Competência
                    <input
                      disabled={persistida || !podeEditarAuto}
                      type="month"
                      value={competenciaParaInput(draft.competencia)}
                      onChange={(e) => {
                        const competencia = inputParaCompetencia(e.target.value);
                        if (!competencia) return;
                        const existente = items.find((a) => a.userId === draft.userId && a.competencia === competencia);
                        if (existente) abrir(existente);
                        else setDraft({ ...draft, competencia });
                      }}
                    />
                  </label>
                  <StatusPill label={STATUS_LABEL[draft.status]} />
                  {draft.enviadaEm ? <small>Enviada em {new Date(draft.enviadaEm).toLocaleString("pt-BR")}</small> : null}
                  {draft.corrigidaEm ? <small>Corrigida pela coordenação em {new Date(draft.corrigidaEm).toLocaleString("pt-BR")}</small> : null}
                </div>
              </div>
              <div className="aval-head-actions">
                <button type="button" onClick={alternarTodas} title={todasMinimizadas ? "Expandir todas as seções" : "Minimizar todas as seções"}>
                  {todasMinimizadas ? <Maximize2 size={15} strokeWidth={1.6} /> : <Minimize2 size={15} strokeWidth={1.6} />}
                  {todasMinimizadas ? "Expandir tudo" : "Minimizar tudo"}
                </button>
                <button type="button" onClick={imprimir} title="Imprimir ou salvar em PDF">
                  <Printer size={15} strokeWidth={1.6} />
                  Imprimir / PDF
                </button>
              </div>
            </header>

            {error ? <div className="form-error">{error}</div> : null}
            {notice ? <div className="module-notice">{notice}</div> : null}
            {!admin && draft.status === "enviada" ? (
              <div className="module-notice">Avaliação enviada. A coordenação vai avaliar e devolver; até lá ela fica bloqueada para edição.</div>
            ) : null}

            <Secao
              aberta={!minimizadas.notas}
              className="aval-secao--tabela"
              onAlternar={() => alternarSecao("notas")}
              resumo={`Autoavaliação ${formatNota(mediaAuto)}${mostraCoord ? ` · Coordenador ${formatNota(mediaCoord)}` : ""}`}
              titulo="Notas por critério"
              acoes={
                admin ? (
                  <button className="aval-tool-btn" type="button" onClick={preencherCoordCom10} title="Lança 10 em todos os critérios na coluna do coordenador; depois reduza só as notas necessárias.">
                    <ListChecks size={15} strokeWidth={1.6} />
                    Preencher notas do coordenador com 10
                  </button>
                ) : null
              }
            >
            <div className="aval-table-wrap">
              <table className="aval-table">
                <thead>
                  <tr>
                    <th rowSpan={2}>Critérios</th>
                    <th colSpan={2}>Colaborador (autoavaliação)</th>
                    {mostraCoord ? <th colSpan={2}>Coordenador</th> : null}
                    {mostraCoord && mostraSub ? <th colSpan={2}>Subcoordenação</th> : null}
                  </tr>
                  <tr>
                    <th>Nota</th>
                    <th>Justificativa: por que mereço essa nota?</th>
                    {mostraCoord ? (
                      <>
                        <th>Nota</th>
                        <th>Justificativa</th>
                      </>
                    ) : null}
                    {mostraCoord && mostraSub ? (
                      <>
                        <th>Nota</th>
                        <th>Justificativa</th>
                      </>
                    ) : null}
                  </tr>
                </thead>
                <tbody>
                  {AVALIACAO_CRITERIOS.map((c, indice) => {
                    const auto = draft.autoavaliacao[c.id];
                    const nCoord = coord.coordenador[c.id];
                    const nSub = coord.subcoordenacao[c.id];
                    return (
                      <tr key={c.id}>
                        <th scope="row">
                          <span className="aval-crit-num">{indice + 1}</span>
                          <strong>{c.nome}</strong>
                          <small>{c.detalhe}</small>
                        </th>
                        <td className="aval-nota">
                          {podeEditarAuto ? (
                            <input
                              aria-label={`Nota de autoavaliação - ${c.nome}`}
                              max={10}
                              min={0}
                              step={0.5}
                              type="number"
                              value={auto?.nota ?? ""}
                              onChange={(e) => setAuto(c.id, "nota", e.target.value)}
                            />
                          ) : (
                            <span>{formatNota(auto?.nota)}</span>
                          )}
                        </td>
                        <td>
                          {podeEditarAuto ? (
                            <textarea aria-label={`Justificativa - ${c.nome}`} rows={2} value={auto?.justificativa || ""} onChange={(e) => setAuto(c.id, "justificativa", e.target.value)} />
                          ) : (
                            <p>{auto?.justificativa || "—"}</p>
                          )}
                        </td>
                        {mostraCoord ? (
                          <>
                            <td className="aval-nota">
                              {admin ? (
                                <input
                                  aria-label={`Nota do coordenador - ${c.nome}`}
                                  max={10}
                                  min={0}
                                  step={0.5}
                                  type="number"
                                  value={nCoord?.nota ?? ""}
                                  onChange={(e) => setCoordNota(c.id, "nota", e.target.value)}
                                />
                              ) : (
                                <span>{formatNota(nCoord?.nota)}</span>
                              )}
                            </td>
                            <td>
                              {admin ? (
                                <textarea aria-label={`Justificativa do coordenador - ${c.nome}`} rows={2} value={nCoord?.justificativa || ""} onChange={(e) => setCoordNota(c.id, "justificativa", e.target.value)} />
                              ) : (
                                <p>{nCoord?.justificativa || "—"}</p>
                              )}
                            </td>
                          </>
                        ) : null}
                        {mostraCoord && mostraSub ? (
                          <>
                            <td className="aval-nota">
                              <span>{formatNota(nSub?.nota)}</span>
                            </td>
                            <td>
                              <p>{nSub?.justificativa || "—"}</p>
                            </td>
                          </>
                        ) : null}
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <th scope="row">Média aritmética</th>
                    <td className="aval-nota">
                      <strong>{formatNota(mediaAuto)}</strong>
                    </td>
                    <td>{faixaDaNota(mediaAuto)}</td>
                    {mostraCoord ? (
                      <>
                        <td className="aval-nota">
                          <strong>{formatNota(mediaCoord)}</strong>
                        </td>
                        <td>{faixaDaNota(mediaCoord)}</td>
                      </>
                    ) : null}
                    {mostraCoord && mostraSub ? (
                      <>
                        <td className="aval-nota">
                          <strong>{formatNota(mediaSub)}</strong>
                        </td>
                        <td>{faixaDaNota(mediaSub)}</td>
                      </>
                    ) : null}
                  </tr>
                </tfoot>
              </table>
            </div>
            {admin && !mostraSub ? <p className="aval-hint">A coluna Subcoordenação aparecerá quando houver usuário autorizado a preenchê-la.</p> : null}
            </Secao>

            {mostraCoord ? (
              <div className="aval-media-geral" aria-label="Média geral">
                <div>
                  <span>Média geral</span>
                  <strong>{formatNota(geral)}</strong>
                  {geral !== null ? <em>{faixaDaNota(geral)}</em> : null}
                </div>
                <small>
                  {geral === null
                    ? "Aparece quando a coordenação lançar as notas."
                    : `Média das médias: autoavaliação ${formatNota(mediaAuto)} · coordenador ${formatNota(mediaCoord)}${mediaSub !== null ? ` · subcoordenação ${formatNota(mediaSub)}` : ""}.`}
                </small>
              </div>
            ) : null}

            <div className="aval-sections">
              <Secao
                aberta={!minimizadas.feedback}
                className="aval-box aval-feedback"
                onAlternar={() => alternarSecao("feedback")}
                resumo={`${AVALIACAO_FEEDBACK.filter((f) => draft.feedback[f.id]?.trim()).length} de ${AVALIACAO_FEEDBACK.length} respondidos`}
                titulo="Feedback do colaborador"
              >
                {AVALIACAO_FEEDBACK.map((f, i) => {
                  const resposta = coord.respostasFeedback?.[f.id] || "";
                  return (
                    <div className="aval-fb-item" key={f.id}>
                      <label>
                        {i + 1}) {f.pergunta}
                        {podeEditarAuto ? (
                          <textarea aria-label={`Feedback ${i + 1}`} rows={2} value={draft.feedback[f.id] || ""} onChange={(e) => setFeedback(f.id, e.target.value)} />
                        ) : (
                          <p>{draft.feedback[f.id] || "—"}</p>
                        )}
                      </label>
                      {mostraCoord && admin ? (
                        <label className="aval-fb-resposta">
                          Resposta da coordenação
                          <textarea
                            aria-label={`Resposta da coordenação ${i + 1}`}
                            rows={2}
                            value={resposta}
                            onChange={(e) => setRespostaFeedback(f.id, e.target.value)}
                            placeholder="Opcional: resposta ao colaborador sobre este item."
                          />
                        </label>
                      ) : mostraCoord && resposta.trim() ? (
                        <div className="aval-fb-resposta aval-fb-resposta--lida">
                          <span>Resposta da coordenação</span>
                          <p>{resposta}</p>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </Secao>
              <Secao aberta={!minimizadas.escala} className="aval-box" onAlternar={() => alternarSecao("escala")} resumo="Péssimo a Excelente" titulo="Notas de referência">
                <EscalaReferencia />
              </Secao>
            </div>

            {mostraCoord ? (
              <Secao
                aberta={!minimizadas.recomendacoes}
                className="aval-box aval-recomendacoes"
                onAlternar={() => alternarSecao("recomendacoes")}
                resumo={`${recomendacoesVisiveis.filter((r) => r.texto.trim()).length} recomendação(ões) · ${recomendacoesVisiveis.filter((r) => draft.replicas[r.id]?.trim()).length} réplica(s)`}
                titulo="Recomendações da coordenação"
                acoes={podeReplicar ? <small>Responda a cada recomendação com a sua justificativa ou a conclusão definida.</small> : null}
              >
                {recomendacoesVisiveis.length ? (
                  <ol className="aval-rec-list">
                    {recomendacoesVisiveis.map((r, i) => {
                      const replica = draft.replicas[r.id] || "";
                      return (
                        <li className="aval-rec" key={r.id}>
                          <span className="aval-rec-num">{i + 1}</span>
                          <div className="aval-rec-body">
                            {admin ? (
                              <div className="aval-rec-edit">
                                <textarea aria-label={`Recomendação ${i + 1}`} rows={2} value={r.texto} onChange={(e) => setRecomendacao(r.id, e.target.value)} placeholder="Escreva a recomendação." />
                                <button className="aval-icon-btn" type="button" onClick={() => excluirRecomendacao(r.id)} title="Excluir recomendação" aria-label={`Excluir recomendação ${i + 1}`}>
                                  <X size={15} strokeWidth={1.6} />
                                </button>
                              </div>
                            ) : (
                              <p>{r.texto}</p>
                            )}
                            {podeReplicar && r.texto.trim() ? (
                              <label className="aval-replica">
                                Réplica do colaborador
                                <textarea
                                  aria-label={`Réplica à recomendação ${i + 1}`}
                                  rows={2}
                                  value={replica}
                                  onChange={(e) => setReplica(r.id, e.target.value)}
                                  placeholder="Justificativa ou conclusão definida."
                                />
                              </label>
                            ) : replica.trim() ? (
                              <div className="aval-replica aval-replica--lida">
                                <span>Réplica do colaborador</span>
                                <p>{replica}</p>
                              </div>
                            ) : null}
                          </div>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="aval-hint-inline">{admin ? "Nenhuma recomendação. Use “Incluir recomendação”." : "A coordenação não registrou recomendações."}</p>
                )}
                {admin ? (
                  <button className="aval-add-btn" type="button" onClick={incluirRecomendacao}>
                    <Plus size={15} strokeWidth={1.6} />
                    Incluir recomendação
                  </button>
                ) : null}
                {draft.replicasEm ? <small className="aval-hint-inline">Réplicas atualizadas em {new Date(draft.replicasEm).toLocaleString("pt-BR")}.</small> : null}
              </Secao>
            ) : null}

            <footer className="aval-actions">
              {souDono && draft.status === "rascunho" && !admin ? (
                <>
                  <button disabled={saving} type="button" onClick={() => void salvarColaborador(false)}>
                    <Save size={15} strokeWidth={1.6} />
                    Salvar rascunho
                  </button>
                  <button className="primary-action" disabled={saving} type="button" onClick={() => void salvarColaborador(true)}>
                    <Send size={15} strokeWidth={1.6} />
                    Salvar e enviar à coordenação
                  </button>
                  {persistida ? (
                    <button className="danger-action" disabled={saving} type="button" onClick={() => void excluir()}>
                      <Trash2 size={15} strokeWidth={1.6} />
                      Excluir rascunho
                    </button>
                  ) : null}
                </>
              ) : null}
              {podeReplicar && recomendacoesVisiveis.some((r) => r.texto.trim()) ? (
                <>
                  <button disabled={saving} type="button" onClick={() => void gravarReplicas(false)}>
                    <Save size={15} strokeWidth={1.6} />
                    Salvar réplicas
                  </button>
                  <button className={admin ? "" : "primary-action"} disabled={saving} type="button" onClick={() => void gravarReplicas(true)}>
                    <MessageSquareReply size={15} strokeWidth={1.6} />
                    Salvar e avisar a coordenação
                  </button>
                </>
              ) : null}
              {admin ? (
                <>
                  {!persistida || (souDono && draft.status === "rascunho") ? (
                    <button disabled={saving} type="button" onClick={() => void salvarColaborador(false)}>
                      <Save size={15} strokeWidth={1.6} />
                      Salvar minha autoavaliação
                    </button>
                  ) : null}
                  {persistida ? (
                    <>
                      <button disabled={saving} type="button" onClick={() => void salvarAdmin(draft.status, "Avaliação salva.")}>
                        <Save size={15} strokeWidth={1.6} />
                        Salvar
                      </button>
                      <button
                        className="primary-action"
                        disabled={saving}
                        type="button"
                        onClick={() =>
                          void salvarAdmin(
                            "devolvida",
                            "Avaliação devolvida: o colaborador já pode ver as notas e as correções.",
                            "Devolver a avaliação ao colaborador?\nEle passará a ver as notas, as justificativas e as recomendações da coordenação, e receberá um aviso por e-mail e no HUB.",
                            true
                          )
                        }
                      >
                        <Undo2 size={15} strokeWidth={1.6} />
                        Salvar e devolver ao colaborador
                      </button>
                      {draft.status !== "rascunho" ? (
                        <button
                          disabled={saving}
                          type="button"
                          onClick={() => void salvarAdmin("rascunho", "Avaliação reaberta para o colaborador editar.", "Reabrir a autoavaliação para o colaborador editar e reenviar?")}
                        >
                          <RotateCcw size={15} strokeWidth={1.6} />
                          Reabrir para o colaborador
                        </button>
                      ) : null}
                      <button className="danger-action" disabled={saving} type="button" onClick={() => void excluir()}>
                        <Trash2 size={15} strokeWidth={1.6} />
                        Excluir
                      </button>
                    </>
                  ) : null}
                </>
              ) : null}
            </footer>
          </>
        )}
      </section>
    </div>
  );
}

function temReplica(a: Avaliacao) {
  return Object.values(a.replicas || {}).some((t) => t?.trim());
}

function dataCurta(valor?: string) {
  return valor ? new Date(valor).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "";
}

// Painel da coordenação: situação das avaliações (aguardando análise, devolvidas, com réplica, em preenchimento).
function PainelCoordenacao({ itens, competencia, onAbrir }: { itens: Avaliacao[]; competencia: string; onAbrir: (a: Avaliacao) => void }) {
  const porData = (campo: (a: Avaliacao) => string | undefined, crescente = false) => (a: Avaliacao, b: Avaliacao) => {
    const x = campo(a) || "";
    const y = campo(b) || "";
    return crescente ? x.localeCompare(y) : y.localeCompare(x);
  };
  const colunas = [
    {
      id: "enviada",
      titulo: "Aguardando análise",
      descricao: "Enviadas pelo colaborador para a coordenação avaliar.",
      itens: itens.filter((a) => a.status === "enviada").sort(porData((a) => a.enviadaEm, true)),
      data: (a: Avaliacao) => (a.enviadaEm ? `Enviada em ${dataCurta(a.enviadaEm)}` : "")
    },
    {
      id: "devolvida",
      titulo: "Avaliadas e devolvidas",
      descricao: "Devolvidas ao colaborador, ainda sem réplica.",
      itens: itens.filter((a) => a.status === "devolvida" && !temReplica(a)).sort(porData((a) => a.devolvidaEm)),
      data: (a: Avaliacao) => (a.devolvidaEm ? `Devolvida em ${dataCurta(a.devolvidaEm)}` : "")
    },
    {
      id: "replica",
      titulo: "Com réplica do colaborador",
      descricao: "O colaborador respondeu às recomendações.",
      itens: itens.filter((a) => a.status === "devolvida" && temReplica(a)).sort(porData((a) => a.replicasEm)),
      data: (a: Avaliacao) => (a.replicasEm ? `Réplica em ${dataCurta(a.replicasEm)}` : "")
    },
    {
      id: "rascunho",
      titulo: "Em preenchimento",
      descricao: "Salvas pelo colaborador como rascunho, ainda não enviadas.",
      itens: itens.filter((a) => a.status === "rascunho").sort(porData((a) => a.updatedAt)),
      data: (a: Avaliacao) => (a.updatedAt ? `Atualizada em ${dataCurta(a.updatedAt)}` : "")
    }
  ];

  return (
    <div className="aval-painel">
      <header className="aval-painel-head">
        <div>
          <span className="aval-kicker">{AVALIACAO_TITULO}</span>
          <h2>Painel da coordenação</h2>
          <small>{competencia ? `Competência ${competencia}` : "Todas as competências"} · use o filtro à esquerda para escolher a competência.</small>
        </div>
      </header>
      <div className="aval-painel-colunas">
        {colunas.map((c) => (
          <section className={`aval-painel-col aval-painel-col--${c.id}`} key={c.id} aria-label={c.titulo}>
            <h3>
              {c.titulo}
              <em>{c.itens.length}</em>
            </h3>
            <p>{c.descricao}</p>
            <div className="aval-painel-lista">
              {c.itens.map((a) => {
                const geral = mediaGeralDaAvaliacao(a);
                return (
                  <button className="aval-painel-item" key={a.id} type="button" onClick={() => onAbrir(a)}>
                    <strong>{a.colaboradorNome}</strong>
                    <span>
                      Competência {a.competencia}
                      {c.data(a) ? ` · ${c.data(a)}` : ""}
                    </span>
                    <small>
                      Autoavaliação {formatNota(mediaNotas(a.autoavaliacao))}
                      {a.coordenacao && mediaNotas(a.coordenacao.coordenador) !== null ? ` · Coordenador ${formatNota(mediaNotas(a.coordenacao.coordenador))}` : ""}
                      {geral !== null ? ` · Geral ${formatNota(geral)}` : ""}
                    </small>
                  </button>
                );
              })}
              {!c.itens.length ? <div className="aval-painel-vazio">Nenhuma.</div> : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function EscalaReferencia() {
  return (
    <ul className="aval-escala">
      {AVALIACAO_ESCALA.map((f) => (
        <li key={f.rotulo}>
          <strong>{f.minimo === 10 ? "10" : `a partir de ${formatNota(f.minimo)}`}</strong>
          <span>{f.rotulo}</span>
        </li>
      ))}
    </ul>
  );
}

function montarImpressao(av: Avaliacao, coord: AvaliacaoCoordenacao | null) {
  const e = escapeHtmlText;
  const sub = coord && temNotas(coord.subcoordenacao);
  const cab = `<tr><th rowspan="2">Critérios</th><th colspan="2">Colaborador (autoavaliação)</th>${coord ? '<th colspan="2">Coordenador</th>' : ""}${sub ? '<th colspan="2">Subcoordenação</th>' : ""}</tr>
  <tr><th>Nota</th><th>Justificativa</th>${coord ? "<th>Nota</th><th>Justificativa</th>" : ""}${sub ? "<th>Nota</th><th>Justificativa</th>" : ""}</tr>`;
  const linhas = AVALIACAO_CRITERIOS.map((c, i) => {
    const cel = (n?: { nota: number | null; justificativa: string }) => `<td class="n">${e(formatNota(n?.nota))}</td><td>${e(n?.justificativa || "")}</td>`;
    return `<tr><th>${i + 1}. ${e(c.nome)}<small>${e(c.detalhe)}</small></th>${cel(av.autoavaliacao[c.id])}${coord ? cel(coord.coordenador[c.id]) : ""}${sub && coord ? cel(coord.subcoordenacao[c.id]) : ""}</tr>`;
  }).join("");
  const media = (n: NotasPorCriterio | undefined) => {
    const m = mediaNotas(n);
    return `<td class="n"><strong>${e(formatNota(m))}</strong></td><td>${e(faixaDaNota(m))}</td>`;
  };
  const geral = coord ? mediaGeralDaAvaliacao(av, coord) : null;
  const geralHtml = coord
    ? `<p class="geral"><strong>Média geral:</strong> ${e(formatNota(geral))}${geral !== null ? ` (${e(faixaDaNota(geral))})` : ""} — média das médias da autoavaliação, do coordenador${sub ? " e da subcoordenação" : ""}.</p>`
    : "";
  const feedback = AVALIACAO_FEEDBACK.map((f, i) => {
    const resposta = coord?.respostasFeedback?.[f.id]?.trim();
    return `<p><strong>${i + 1}) ${e(f.pergunta)}</strong><br>${e(av.feedback[f.id] || "—")}</p>${resposta ? `<p class="rep"><strong>Resposta da coordenação:</strong> ${e(resposta)}</p>` : ""}`;
  }).join("");
  const recs = (coord?.recomendacoes || []).filter((r) => r.texto.trim());
  const recomendacoes = coord
    ? `<h2>Recomendações da coordenação</h2>${
        recs.length
          ? `<ol>${recs
              .map((r) => {
                const replica = av.replicas?.[r.id]?.trim();
                return `<li><p>${e(r.texto)}</p>${replica ? `<p class="rep"><strong>Réplica do colaborador:</strong> ${e(replica)}</p>` : ""}</li>`;
              })
              .join("")}</ol>`
          : "<p>—</p>"
      }`
    : "";
  const escala = AVALIACAO_ESCALA.map((f) => `<li>${e(formatNota(f.minimo))}: ${e(f.rotulo)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Avaliação ${e(av.colaboradorNome)} ${e(av.competencia)}</title>
<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#1b2a41;margin:24px}h1{font-size:14pt;margin:0 0 4px}h2{font-size:12pt;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #9aa6b8;padding:6px;vertical-align:top;text-align:left}th small{display:block;font-weight:normal;color:#5e6d82}
td.n{text-align:center;width:52px}thead th{background:#eef1f6}tfoot th,tfoot td{background:#f7f8fa}ul,ol{margin:4px 0;padding-left:18px}
p{white-space:pre-wrap}.geral{margin:10px 0;padding:8px 10px;border:1px solid #9aa6b8;background:#f7f8fa}.rep{margin:4px 0 8px;padding-left:10px;border-left:3px solid #9aa6b8;color:#2a3b55}</style></head><body>
<h1>${e(AVALIACAO_TITULO)}</h1><p><strong>Colaborador:</strong> ${e(av.colaboradorNome)} &nbsp; <strong>Competência:</strong> ${e(av.competencia)} &nbsp; <strong>Situação:</strong> ${e(STATUS_LABEL[av.status])}</p>
<table><thead>${cab}</thead><tbody>${linhas}</tbody><tfoot><tr><th>Média aritmética</th>${media(av.autoavaliacao)}${coord ? media(coord.coordenador) : ""}${sub && coord ? media(coord.subcoordenacao) : ""}</tr></tfoot></table>
${geralHtml}
<h2>Feedback do colaborador</h2>${feedback}
${recomendacoes}
<h2>Notas de referência</h2><ul>${escala}</ul></body></html>`;
}
