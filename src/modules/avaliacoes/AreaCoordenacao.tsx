// Tela da coordenação: painel por competência e editor da correção (finalizar, reabrir, devolver, responder réplica).
import {
  ArrowLeft,
  Award,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Eye,
  EyeOff,
  FileSpreadsheet,
  Mail,
  MessageSquareReply,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Undo2
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HubUser } from "../../types";
import { getErrorMessage } from "../../lib/formatters";
import { readStorage, writeStorage } from "../../lib/storage";
import {
  AVALIACAO_TITULO,
  LIMITES,
  STATUS_COORDENACAO,
  avisar,
  carregarPainel,
  competenciaAtual,
  coordenacaoVazia,
  corrigirAvaliacao,
  devolverAvaliacao,
  enviarArquivosPorEmail,
  errosFinalizacao,
  excluirAvaliacao,
  formatarNota,
  limparCoordenacao,
  media,
  notasPreenchidas,
  obterAvaliacao,
  podeAcao,
  preencherCom10,
  reabrirAvaliacao,
  responderReplica,
  rotuloCompetencia,
  somarMeses,
  ultimaReplica,
  type Avaliacao,
  type AvaliacaoStatus,
  type Painel,
  type ParteCoordenacao
} from "../../lib/avaliacoes";
import { BotoesArquivos, MODELO_EMAIL, anexosDa, preencherModelo } from "./Arquivos";
import { baixarConsolidado } from "./exportar";
import { Formulario, Medias } from "./Formulario";
import { apagarLocal, chaveLocal, guardarLocal, lerLocal, quando } from "./rascunhoLocal";
import { useSecoes } from "./secoes";

const COLUNAS: Array<{ id: AvaliacaoStatus; titulo: string }> = [
  { id: "enviada", titulo: "Aguardando correção" },
  { id: "em_correcao", titulo: "Em correção" },
  { id: "replica", titulo: "Réplicas recebidas" },
  { id: "finalizada", titulo: "Finalizadas" }
];
const CHAVE_AUTO = "hub_avd_mostrar_auto";

function dataHora(v?: string) {
  return v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
}

function completarRecs(c: ParteCoordenacao): ParteCoordenacao {
  return { ...c, recomendacoes: [...c.recomendacoes, "", "", "", "", ""].slice(0, LIMITES.recomendacoes) };
}

export function AreaCoordenacao({ user }: { user: HubUser }) {
  const [comp, setComp] = useState(competenciaAtual());
  const [painel, setPainel] = useState<Painel | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [aberta, setAberta] = useState<Avaliacao | null>(null);
  const [parte, setParte] = useState<ParteCoordenacao>(completarRecs(coordenacaoVazia()));
  const [sujo, setSujo] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [mostrarAuto, setMostrarAuto] = useState<boolean>(() => readStorage(CHAVE_AUTO, true));
  const [mostrarSub, setMostrarSub] = useState(false);
  const [resposta, setResposta] = useState("");
  const [fechadas, alternar] = useSecoes();

  async function carregar(c = comp) {
    setCarregando(true);
    try {
      setPainel(await carregarPainel(user, c));
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar(comp);
    // recarrega ao trocar de competência
  }, [comp]); // eslint-disable-line

  useEffect(() => {
    const aoSair = (e: BeforeUnloadEvent) => {
      if (sujo) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", aoSair);
    return () => window.removeEventListener("beforeunload", aoSair);
  }, [sujo]);

  function descartarOk() {
    return !sujo || window.confirm("Há alterações não salvas na correção. Descartar?");
  }

  const chave = (id: string) => chaveLocal("coord", user.id || user.email, id);

  function salvaDe(a: Avaliacao) {
    return a.coordenacao ? { ...coordenacaoVazia(), ...a.coordenacao } : coordenacaoVazia();
  }

  // Abre a correção; se houver cópia local não salva (e mais nova que a do HUB), recupera.
  function aplicar(a: Avaliacao) {
    setAberta(a);
    let c = salvaDe(a);
    let recuperada: string | null = null;
    if (podeAcao("corrigir", a.status, "coordenacao")) {
      const local = lerLocal<ParteCoordenacao>(chave(a.id));
      if (local && !(a.updatedAt && a.updatedAt > local.em)) {
        c = { ...coordenacaoVazia(), ...local.dados };
        recuperada = local.em;
      } else if (local) apagarLocal(chave(a.id));
    } else apagarLocal(chave(a.id));
    setParte(completarRecs(c));
    setMostrarSub(notasPreenchidas(c.subcoordenacao) > 0);
    setSujo(!!recuperada);
    setResposta("");
    if (recuperada) setAviso({ texto: `Recuperei alterações não salvas de ${quando(recuperada)}. Salve a correção ou clique em “Descartar alterações”.` });
  }

  function descartar() {
    if (!aberta || !window.confirm("Descartar as alterações não salvas desta correção?")) return;
    apagarLocal(chave(aberta.id));
    const c = salvaDe(aberta);
    setParte(completarRecs(c));
    setMostrarSub(notasPreenchidas(c.subcoordenacao) > 0);
    setSujo(false);
    setAviso({ texto: "Alterações descartadas." });
  }

  async function abrir(id: string) {
    if (!descartarOk()) return;
    if (aberta && sujo) apagarLocal(chave(aberta.id));
    setAviso(null);
    setOcupado(true);
    try {
      aplicar(await obterAvaliacao(user, id));
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  function voltar() {
    if (!descartarOk()) return;
    if (aberta) apagarLocal(chave(aberta.id));
    setAberta(null);
    setSujo(false);
    setAviso(null);
    void carregar();
  }

  function trocarComp(c: string) {
    if (!c || c === comp) return;
    setComp(c);
  }

  function alterar(p: ParteCoordenacao) {
    setParte(p);
    setSujo(true);
    if (aberta) guardarLocal(chave(aberta.id), p);
  }

  async function executar(fn: () => Promise<Avaliacao | void>, ok: string, aviso?: "finalizada" | "resposta" | "devolvida") {
    if (!aberta) return;
    setOcupado(true);
    try {
      const r = await fn();
      apagarLocal(chave(aberta.id));
      let texto = ok;
      if (r) {
        if (r.status === "rascunho") {
          setAberta(null);
          void carregar();
        } else aplicar(r);
        if (aviso) {
          try {
            texto += ` ${await avisar(r.id, aviso)}`;
          } catch (e) {
            texto += ` (O aviso por e-mail não saiu: ${getErrorMessage(e)})`;
          }
        }
      }
      setAviso({ texto });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  function salvar(acao: "salvar" | "finalizar") {
    if (!aberta) return;
    const usar = mostrarSub ? parte : { ...parte, subcoordenacao: {} };
    if (acao === "finalizar") {
      const erros = errosFinalizacao(limparCoordenacao(usar));
      if (erros.length) return setAviso({ texto: erros.join(" "), erro: true });
      if (!window.confirm(`Finalizar a avaliação de ${aberta.colaboradorNome} (${rotuloCompetencia(aberta.competencia)})?\n\nO colaborador passa a ver a correção e pode enviar réplica.`)) return;
    }
    void executar(() => corrigirAvaliacao(user, aberta.id, usar, acao), acao === "finalizar" ? "Avaliação finalizada." : "Correção salva.", acao === "finalizar" ? "finalizada" : undefined);
  }

  function reabrir() {
    if (!aberta) return;
    if (!window.confirm("Reabrir a avaliação para editar? O colaborador deixa de ver a correção até você finalizar de novo.")) return;
    void executar(() => reabrirAvaliacao(user, aberta.id), "Avaliação reaberta para edição.");
  }

  function devolver() {
    if (!aberta || !descartarOk()) return;
    const motivo = window.prompt(`Devolver a avaliação a ${aberta.colaboradorNome} para ajustes na autoavaliação?\n\nMotivo (opcional, vai no aviso ao colaborador):`, "");
    if (motivo === null) return;
    void executar(() => devolverAvaliacao(user, aberta.id, motivo), "Avaliação devolvida ao colaborador para ajustes.", "devolvida");
  }

  function responder() {
    if (!aberta) return;
    if (!resposta.trim()) return setAviso({ texto: "Escreva a resposta à réplica.", erro: true });
    void executar(() => responderReplica(user, aberta.id, resposta), "Resposta enviada.", "resposta");
  }

  async function excluir() {
    if (!aberta) return;
    if (!window.confirm(`Excluir a avaliação de ${aberta.colaboradorNome} (${rotuloCompetencia(aberta.competencia)})?\n\nIsto apaga a autoavaliação, a correção, as réplicas e o histórico. Esta ação não pode ser desfeita.`)) return;
    setOcupado(true);
    try {
      await excluirAvaliacao(user, aberta.id);
      apagarLocal(chave(aberta.id));
      setAberta(null);
      setSujo(false);
      await carregar();
      setAviso({ texto: "Avaliação excluída." });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  const grupos = useMemo(() => {
    const g: Record<string, Avaliacao[]> = {};
    for (const c of COLUNAS) g[c.id] = [];
    for (const a of painel?.avaliacoes || []) if (g[a.status]) g[a.status].push(a);
    return g;
  }, [painel]);

  const pendentes = useMemo(() => {
    if (!painel) return [] as Array<{ nome: string; rascunho: boolean }>;
    const porUser = new Map(painel.avaliacoes.map((a) => [a.userId, a]));
    return painel.colaboradores
      .filter((c) => {
        const a = porUser.get(c.id);
        return !a || a.status === "rascunho";
      })
      .map((c) => ({ nome: c.nome, rascunho: porUser.get(c.id)?.status === "rascunho" }));
  }, [painel]);

  async function enviarFinalizadas() {
    const alvo = grupos.finalizada || [];
    if (!alvo.length) return setAviso({ texto: "Não há avaliações finalizadas nesta competência.", erro: true });
    if (!window.confirm(`Enviar por e-mail as ${alvo.length} avaliação(ões) finalizada(s) de ${rotuloCompetencia(comp)}, cada uma ao seu colaborador, com XLSX e PDF anexados?`)) return;
    setOcupado(true);
    let ok = 0;
    const falhas: string[] = [];
    for (const item of alvo) {
      setAviso({ texto: `Enviando ${ok + falhas.length + 1} de ${alvo.length}…` });
      try {
        const a = await obterAvaliacao(user, item.id);
        await enviarArquivosPorEmail({
          id: a.id,
          para: "colaborador",
          assunto: preencherModelo(MODELO_EMAIL.assunto, a),
          mensagem: preencherModelo(MODELO_EMAIL.corpo, a),
          anexos: await anexosDa(a, true, true)
        });
        ok++;
      } catch (e) {
        falhas.push(`${item.colaboradorNome}: ${getErrorMessage(e)}`);
      }
    }
    setOcupado(false);
    setAviso({ texto: `${ok} e-mail(s) enviado(s).${falhas.length ? ` Falharam: ${falhas.join("; ")}` : ""}`, erro: falhas.length > 0 });
  }

  // ------------------------------------------------------------------ editor
  if (aberta) {
    const st = aberta.status;
    const edita = podeAcao("corrigir", st, "coordenacao");
    const coordMostrar = edita ? parte : aberta.coordenacao || coordenacaoVazia();
    const ultima = ultimaReplica(aberta);
    const replicaSlot =
      st === "replica" ? (
        <div className="avd-txt">
          <label htmlFor="avd-resposta">Resposta à réplica {ultima ? `de ${dataHora(ultima.enviadaEm)}` : ""}</label>
          <textarea id="avd-resposta" maxLength={LIMITES.replica} rows={4} value={resposta} onChange={(e) => setResposta(e.target.value)} />
          <div className="avd-acoes">
            <button className="avd-btn avd-btn--pri" disabled={ocupado || !resposta.trim()} type="button" onClick={responder}>
              <MessageSquareReply size={15} strokeWidth={1.6} />
              Responder réplica
            </button>
            <span className="avd-dica">A avaliação volta a "Finalizada". Para mudar notas, use "Reabrir para editar".</span>
          </div>
        </div>
      ) : null;
    return (
      <div className="avd">
        <section className="panel" aria-label="Correção da avaliação">
          <div className="avd-topo">
            <button className="avd-btn" type="button" onClick={voltar}>
              <ArrowLeft size={15} strokeWidth={1.6} />
              Painel
            </button>
            <div>
              <h2>{aberta.colaboradorNome}</h2>
              <span className="avd-sub-tit">
                Competência {rotuloCompetencia(aberta.competencia)}
                {aberta.enviadaEm ? ` · enviada em ${dataHora(aberta.enviadaEm)}` : ""}
                {aberta.finalizadaEm ? ` · finalizada em ${dataHora(aberta.finalizadaEm)}` : ""}
              </span>
            </div>
            <span className={`avd-pill avd-pill--${st}`}>{STATUS_COORDENACAO[st]}</span>
            <span className="avd-espaco" />
            <label className="avd-toggle" title="Mostra ou oculta as notas e justificativas do colaborador">
              <input
                checked={mostrarAuto}
                type="checkbox"
                onChange={(e) => {
                  setMostrarAuto(e.target.checked);
                  writeStorage(CHAVE_AUTO, e.target.checked);
                }}
              />
              {mostrarAuto ? <Eye size={15} strokeWidth={1.6} /> : <EyeOff size={15} strokeWidth={1.6} />}
              Autoavaliação do colaborador
            </label>
            <label className="avd-toggle" title="Coluna opcional de notas da subcoordenação">
              <input checked={mostrarSub} disabled={!edita && notasPreenchidas(coordMostrar.subcoordenacao) === 0} type="checkbox" onChange={(e) => setMostrarSub(e.target.checked)} />
              Subcoordenação
            </label>
          </div>
          <div className="avd-topo avd-acoes" style={{ paddingTop: 0 }}>
            {edita ? (
              <>
                <button className="avd-btn" disabled={ocupado} type="button" onClick={() => alterar({ ...parte, notas: preencherCom10(parte.notas) })}>
                  <Sparkles size={15} strokeWidth={1.6} />
                  Preencher notas do coordenador com 10
                </button>
                <button className="avd-btn" disabled={ocupado} type="button" onClick={() => salvar("salvar")}>
                  <Save size={15} strokeWidth={1.6} />
                  Salvar correção
                </button>
                <button className="avd-btn avd-btn--pri" disabled={ocupado} type="button" onClick={() => salvar("finalizar")}>
                  <CheckCircle2 size={15} strokeWidth={1.6} />
                  Finalizar avaliação
                </button>
                <button className="avd-btn" disabled={ocupado} title="Volta para o colaborador ajustar a autoavaliação" type="button" onClick={devolver}>
                  <Undo2 size={15} strokeWidth={1.6} />
                  Devolver ao colaborador
                </button>
              </>
            ) : null}
            {podeAcao("reabrir", st, "coordenacao") ? (
              <button className="avd-btn" disabled={ocupado} type="button" onClick={reabrir}>
                <RotateCcw size={15} strokeWidth={1.6} />
                Reabrir para editar
              </button>
            ) : null}
            <span className="avd-espaco" />
            <BotoesArquivos avaliacao={{ ...aberta, coordenacao: coordMostrar }} coordenacao onAviso={(texto, erro) => setAviso({ texto, erro })} />
            <button className="avd-btn avd-btn--perigo avd-btn--icone" disabled={ocupado} title="Excluir avaliação" type="button" onClick={excluir}>
              <Trash2 size={15} strokeWidth={1.6} />
            </button>
          </div>
          <div style={{ padding: "0 16px 16px", display: "grid", gap: 12 }}>
            {aviso ? <p className={`avd-aviso ${aviso.erro ? "avd-aviso--erro" : ""}`}>{aviso.texto}</p> : null}
            {sujo ? (
              <p className="avd-aviso avd-aviso--alerta avd-linha">
                Alterações ainda não salvas.
                <button className="avd-btn" type="button" onClick={descartar}>
                  <RotateCcw size={14} strokeWidth={1.6} />
                  Descartar alterações
                </button>
              </p>
            ) : null}
            {st === "replica" ? <p className="avd-aviso avd-aviso--alerta">O colaborador enviou réplica — veja em “Avaliação geral” e responda.</p> : null}
            <Medias colaborador={aberta.colaborador} coordenacao={coordMostrar} mostrarSub={mostrarSub} />
            <Formulario
              colaborador={aberta.colaborador}
              coordenacao={coordMostrar}
              fechadas={fechadas}
              mostrarAuto={mostrarAuto}
              mostrarSub={mostrarSub}
              replicaSlot={replicaSlot}
              replicas={aberta.replicas}
              onAlternar={alternar}
              onCoordenacao={edita ? alterar : undefined}
            />
            {aberta.eventos?.length ? (
              <details className="avd-sec">
                <summary>
                  <ChevronRight className="avd-seta" size={15} strokeWidth={1.8} />
                  Histórico desta avaliação
                  <span className="avd-resumo">{aberta.eventos.length} registro(s)</span>
                </summary>
                <div className="avd-sec-corpo">
                  <ul className="avd-trilha">
                    {aberta.eventos.map((e, i) => (
                      <li key={i}>
                        <time>{dataHora(e.em)}</time>
                        <span>
                          <strong>{e.por}</strong> — {e.acao}
                          {e.detalhe ? `: ${e.detalhe}` : ""}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </details>
            ) : null}
          </div>
        </section>
      </div>
    );
  }

  // ------------------------------------------------------------------ painel
  const outras = (painel?.competencias || []).filter((c) => c !== comp).sort().reverse().slice(0, 6);
  return (
    <div className="avd">
      <section className="panel" aria-label="Painel da coordenação">
        <div className="avd-topo">
          <Award size={18} strokeWidth={1.6} />
          <div>
            <h2>Painel da coordenação</h2>
            <span className="avd-sub-tit">{AVALIACAO_TITULO}</span>
          </div>
          <span className="avd-espaco" />
          <div className="avd-comp">
            <button aria-label="Mês anterior" className="avd-btn avd-btn--icone" type="button" onClick={() => trocarComp(somarMeses(comp, -1))}>
              <ChevronLeft size={16} strokeWidth={1.6} />
            </button>
            <input aria-label="Competência do painel" type="month" value={comp} onChange={(e) => trocarComp(e.target.value)} />
            <button aria-label="Próximo mês" className="avd-btn avd-btn--icone" type="button" onClick={() => trocarComp(somarMeses(comp, 1))}>
              <ChevronRight size={16} strokeWidth={1.6} />
            </button>
          </div>
          <button aria-label="Atualizar" className="avd-btn avd-btn--icone" disabled={carregando} title="Atualizar" type="button" onClick={() => void carregar()}>
            <RefreshCw size={15} strokeWidth={1.6} />
          </button>
        </div>
        <div className="avd-topo avd-acoes" style={{ paddingTop: 0 }}>
          <button
            className="avd-btn"
            disabled={!painel || !painel.avaliacoes.some((a) => a.status !== "rascunho")}
            type="button"
            onClick={async () => {
              if (!painel) return;
              try {
                const completas = await Promise.all(painel.avaliacoes.filter((a) => a.status !== "rascunho").map((a) => obterAvaliacao(user, a.id)));
                baixarConsolidado(comp, completas, pendentes.map((p) => p.nome));
              } catch (e) {
                setAviso({ texto: getErrorMessage(e), erro: true });
              }
            }}
          >
            <FileSpreadsheet size={15} strokeWidth={1.6} />
            Consolidado da competência (XLSX)
          </button>
          <button className="avd-btn" disabled={ocupado || !(grupos.finalizada || []).length} type="button" onClick={enviarFinalizadas}>
            <Mail size={15} strokeWidth={1.6} />
            Enviar finalizadas por e-mail
          </button>
          {outras.length ? (
            <span className="avd-dica" style={{ marginLeft: 8 }}>
              Outras competências:{" "}
              {outras.map((c) => (
                <button className="avd-btn" key={c} style={{ height: 26, marginLeft: 4 }} type="button" onClick={() => trocarComp(c)}>
                  {rotuloCompetencia(c)}
                </button>
              ))}
            </span>
          ) : null}
        </div>
        {aviso ? <p className={`avd-aviso ${aviso.erro ? "avd-aviso--erro" : ""}`} style={{ margin: "0 16px 12px" }}>{aviso.texto}</p> : null}
        <div className="avd-resumo-comp">
          Competência <b>{rotuloCompetencia(comp)}</b> · {painel ? `${painel.colaboradores.length} colaborador(es)` : ""} ·{" "}
          {COLUNAS.map((c) => `${c.titulo}: ${grupos[c.id]?.length || 0}`).join(" · ")}
          {carregando ? " · carregando…" : ""}
        </div>
        <div className="avd-painel">
          {COLUNAS.map((c) => (
            <section className={`avd-coluna avd-coluna--${c.id}`} key={c.id} aria-label={c.titulo}>
              <h3>
                <span className={`avd-pill avd-pill--${c.id}`}>{c.titulo}</span>
                <span className="avd-cont">{grupos[c.id]?.length || 0}</span>
              </h3>
              <ul>
                {(grupos[c.id] || []).map((a) => (
                  <li key={a.id}>
                    <button className="avd-card" disabled={ocupado} type="button" onClick={() => abrir(a.id)}>
                      <strong>{a.colaboradorNome}</strong>
                      <small>
                        Autoavaliação {formatarNota(media(a.colaborador.notas))}
                        {a.coordenacao && media(a.coordenacao.notas) !== null ? ` · Coordenador ${formatarNota(media(a.coordenacao.notas))}` : ""}
                      </small>
                      <small>{c.id === "replica" ? `Réplica em ${dataHora(ultimaReplica(a)?.enviadaEm)}` : c.id === "finalizada" ? `Finalizada em ${dataHora(a.finalizadaEm)}` : `Enviada em ${dataHora(a.enviadaEm)}`}</small>
                    </button>
                  </li>
                ))}
              </ul>
              {!(grupos[c.id] || []).length ? <div className="avd-vazio">Nenhuma.</div> : null}
            </section>
          ))}
        </div>
        <div className="avd-pendentes" aria-label="Ainda não enviaram">
          <strong>Ainda não enviaram ({pendentes.length}):</strong>
          {pendentes.length ? (
            pendentes.map((p) => (
              <span className={`avd-pill ${p.rascunho ? "avd-pill--rascunho" : "avd-pill--pendente"}`} key={p.nome} title={p.rascunho ? "Tem rascunho, ainda não salvou para a coordenação" : "Não iniciou"}>
                {p.nome}
                {p.rascunho ? " · rascunho" : ""}
              </span>
            ))
          ) : (
            <span className="avd-dica">todos enviaram.</span>
          )}
        </div>
      </section>
    </div>
  );
}
