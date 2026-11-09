import { Award, ExternalLink, FilePlus2, Printer, RotateCcw, Save, Send, Trash2, Undo2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HubUser } from "../types";
import { PanelHeader, StatusPill } from "../components/common";
import { confirmDeletion, getErrorMessage } from "../lib/formatters";
import { escapeHtmlText } from "../lib/reportExport";
import {
  AVALIACAO_CRITERIOS,
  AVALIACAO_ESCALA,
  AVALIACAO_FEEDBACK,
  AVALIACAO_TITULO,
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
  mediaNotas,
  novaAvaliacao,
  salvarAutoavaliacao,
  salvarCoordenacao,
  type Avaliacao,
  type AvaliacaoCoordenacao,
  type AvaliacaoStatus,
  type CriterioId,
  type FeedbackId,
  type NotasPorCriterio
} from "../lib/avaliacoes";

const APP_ANTIGO_URL = "https://script.google.com/macros/s/AKfycbyuiPXfkDNl_n-TKTRw3EQ8Dexk7Mq6vodTDQmxf8LRhJ9lJJw_j6h4M-tcsPc7iwsR/exec";

const coordVazia = (): AvaliacaoCoordenacao => ({ coordenador: {}, subcoordenacao: {}, recomendacoes: "" });

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
    setCoord(avaliacao?.coordenacao ? structuredClone(avaliacao.coordenacao) : coordVazia());
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

  function setFeedback(id: FeedbackId, valor: string) {
    if (!draft) return;
    setDraft({ ...draft, feedback: { ...draft.feedback, [id]: valor } });
  }

  function validarEnvio(av: Avaliacao) {
    const faltando = AVALIACAO_CRITERIOS.filter((c) => typeof av.autoavaliacao[c.id]?.nota !== "number").map((c) => c.nome);
    if (faltando.length) return `Informe a nota de: ${faltando.join(", ")}.`;
    const semJust = AVALIACAO_CRITERIOS.filter((c) => !av.autoavaliacao[c.id]?.justificativa?.trim()).map((c) => c.nome);
    if (semJust.length) return `Escreva a justificativa de: ${semJust.join(", ")}.`;
    return "";
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
      if (enviar) {
        try {
          mensagem += ` ${await enviarAvaliacaoPorEmail(salvo)}`;
        } catch (err) {
          mensagem += ` Atenção: o e-mail não foi enviado (${getErrorMessage(err)}). A coordenação verá a avaliação no HUB.`;
        }
      }
      setNotice(mensagem);
      await carregar(salvo.id);
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSaving(false);
    }
  }

  async function salvarAdmin(status: AvaliacaoStatus, mensagem: string, confirmar?: string) {
    if (!draft) return;
    if (confirmar && !window.confirm(confirmar)) return;
    setSaving(true);
    setError("");
    setNotice("");
    try {
      const salvo = await salvarCoordenacao(draft, coord, status, user);
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
          {visiveis.map((a) => (
            <button className={`aval-item ${draft?.id === a.id ? "active" : ""}`} key={a.id} type="button" onClick={() => abrir(a)}>
              <strong>{admin ? a.colaboradorNome : `Competência ${a.competencia}`}</strong>
              <span>{admin ? `Competência ${a.competencia}` : STATUS_LABEL[a.status]}</span>
              <em className={`aval-status aval-status--${a.status}`}>{STATUS_LABEL[a.status]}</em>
              <small>
                Autoavaliação {formatNota(mediaNotas(a.autoavaliacao))}
                {a.coordenacao ? ` · Coordenador ${formatNota(mediaNotas(a.coordenacao.coordenador))}` : ""}
              </small>
            </button>
          ))}
          {!loading && !visiveis.length ? <div className="empty-state">Nenhuma avaliação {admin ? "para o filtro atual" : "ainda"}.</div> : null}
        </div>
      </section>

      <section className="panel aval-main-panel">
        {!draft ? (
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

            <div className="aval-sections">
              <section className="aval-box">
                <h3>Feedback do colaborador</h3>
                {AVALIACAO_FEEDBACK.map((f, i) => (
                  <label key={f.id}>
                    {i + 1}) {f.pergunta}
                    {podeEditarAuto ? (
                      <textarea rows={2} value={draft.feedback[f.id] || ""} onChange={(e) => setFeedback(f.id, e.target.value)} />
                    ) : (
                      <p>{draft.feedback[f.id] || "—"}</p>
                    )}
                  </label>
                ))}
              </section>
              <section className="aval-box">
                <h3>Notas de referência</h3>
                <EscalaReferencia />
                {mostraCoord ? (
                  <label className="aval-recomendacoes">
                    Recomendações da coordenação
                    {admin ? (
                      <textarea rows={6} value={coord.recomendacoes} onChange={(e) => setCoord({ ...coord, recomendacoes: e.target.value })} placeholder="Uma recomendação por linha." />
                    ) : (
                      <p>{coord.recomendacoes || "—"}</p>
                    )}
                  </label>
                ) : null}
              </section>
            </div>

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
                          void salvarAdmin("devolvida", "Avaliação devolvida: o colaborador já pode ver as notas e as correções.", "Devolver a avaliação ao colaborador?\nEle passará a ver as notas, as justificativas e as recomendações da coordenação.")
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
  const feedback = AVALIACAO_FEEDBACK.map((f, i) => `<p><strong>${i + 1}) ${e(f.pergunta)}</strong><br>${e(av.feedback[f.id] || "—")}</p>`).join("");
  const escala = AVALIACAO_ESCALA.map((f) => `<li>${e(formatNota(f.minimo))}: ${e(f.rotulo)}</li>`).join("");
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Avaliação ${e(av.colaboradorNome)} ${e(av.competencia)}</title>
<style>body{font-family:Arial,sans-serif;font-size:11pt;color:#1b2a41;margin:24px}h1{font-size:14pt;margin:0 0 4px}h2{font-size:12pt;margin:18px 0 6px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #9aa6b8;padding:6px;vertical-align:top;text-align:left}th small{display:block;font-weight:normal;color:#5e6d82}
td.n{text-align:center;width:52px}thead th{background:#eef1f6}tfoot th,tfoot td{background:#f7f8fa}ul{margin:4px 0;padding-left:18px}</style></head><body>
<h1>${e(AVALIACAO_TITULO)}</h1><p><strong>Colaborador:</strong> ${e(av.colaboradorNome)} &nbsp; <strong>Competência:</strong> ${e(av.competencia)} &nbsp; <strong>Situação:</strong> ${e(STATUS_LABEL[av.status])}</p>
<table><thead>${cab}</thead><tbody>${linhas}</tbody><tfoot><tr><th>Média aritmética</th>${media(av.autoavaliacao)}${coord ? media(coord.coordenador) : ""}${sub && coord ? media(coord.subcoordenacao) : ""}</tr></tfoot></table>
<h2>Feedback do colaborador</h2>${feedback}
${coord ? `<h2>Recomendações da coordenação</h2><p>${e(coord.recomendacoes || "—").replace(/\n/g, "<br>")}</p>` : ""}
<h2>Notas de referência</h2><ul>${escala}</ul></body></html>`;
}
