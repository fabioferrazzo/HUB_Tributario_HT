// Tela do colaborador: escolhe o mês, preenche a autoavaliação, salva para a coordenação e, depois da
// correção, vê o resultado e pode enviar réplica (sem alterar a avaliação).
import { Award, MessageSquareReply, RotateCcw, Save, Send, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { HubUser } from "../../types";
import { getErrorMessage } from "../../lib/formatters";
import {
  AVALIACAO_TITULO,
  LIMITES,
  STATUS_COLABORADOR,
  avisar,
  colaboradorVazio,
  competenciaAtual,
  enviarReplica,
  errosEnvio,
  excluirAvaliacao,
  formatarNota,
  limparColaborador,
  listarMinhas,
  media,
  notasPreenchidas,
  podeAcao,
  rotuloCompetencia,
  salvarColaborador,
  type Avaliacao,
  type ParteColaborador
} from "../../lib/avaliacoes";
import { BotoesArquivos } from "./Arquivos";
import { Formulario, Medias, type SecaoId } from "./Formulario";
import { apagarLocal, chaveLocal, guardarLocal, lerLocal, quando } from "./rascunhoLocal";
import { useSecoes } from "./secoes";

export function AreaColaborador({ user }: { user: HubUser }) {
  const [lista, setLista] = useState<Avaliacao[]>([]);
  const [comp, setComp] = useState(competenciaAtual());
  const [parte, setParte] = useState<ParteColaborador>(colaboradorVazio());
  const [sujo, setSujo] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const [aviso, setAviso] = useState<{ texto: string; erro?: boolean } | null>(null);
  const [replica, setReplica] = useState("");
  const [fechadas, alternar] = useSecoes();

  const atual = useMemo(() => lista.find((a) => a.competencia === comp) || null, [lista, comp]);
  const status = atual?.status ?? null;
  const editavel = podeAcao("editarColaborador", status, "colaborador");

  const chave = (c: string) => chaveLocal("colab", user.id || user.email, c);

  // Parte do colaborador da competência: a salva no HUB ou, se houver, a cópia local não salva (só em rascunho).
  function parteDe(itens: Avaliacao[], c: string): { parte: ParteColaborador; recuperada: string | null } {
    const a = itens.find((x) => x.competencia === c);
    const base = a ? { ...a.colaborador, sugestoes: a.colaborador.sugestoes.length ? a.colaborador.sugestoes : colaboradorVazio().sugestoes } : colaboradorVazio();
    if (a && a.status !== "rascunho") {
      apagarLocal(chave(c));
      return { parte: base, recuperada: null };
    }
    let local = lerLocal<ParteColaborador>(chave(c));
    if (local && a?.updatedAt && a.updatedAt > local.em) {
      apagarLocal(chave(c)); // a versão salva é mais nova que a cópia local
      local = null;
    }
    return local ? { parte: local.dados, recuperada: local.em } : { parte: base, recuperada: null };
  }

  function aplicarParte(itens: Avaliacao[], c: string) {
    const { parte: p, recuperada } = parteDe(itens, c);
    setParte(p);
    setSujo(!!recuperada);
    if (recuperada) setAviso({ texto: `Recuperei alterações não salvas de ${quando(recuperada)}. Salve o rascunho ou clique em “Descartar alterações”.` });
  }

  async function carregar(manter?: string) {
    setCarregando(true);
    try {
      const itens = await listarMinhas(user);
      setLista(itens);
      aplicarParte(itens, manter ?? comp);
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setCarregando(false);
    }
  }

  useEffect(() => {
    void carregar();
  }, [user.id, user.email]);

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

  function trocarComp(c: string) {
    if (!c || c === comp) return;
    if (sujo && !window.confirm("Há alterações não salvas nesta avaliação. Descartar e trocar de mês?")) return;
    if (sujo) apagarLocal(chave(comp));
    setComp(c);
    setAviso(null);
    setReplica("");
    aplicarParte(lista, c);
  }

  function alterar(p: ParteColaborador) {
    setParte(p);
    setSujo(true);
    guardarLocal(chave(comp), p);
  }

  function descartar() {
    if (!window.confirm("Descartar as alterações não salvas desta avaliação?")) return;
    apagarLocal(chave(comp));
    const a = lista.find((x) => x.competencia === comp);
    setParte(a ? { ...a.colaborador, sugestoes: a.colaborador.sugestoes.length ? a.colaborador.sugestoes : colaboradorVazio().sugestoes } : colaboradorVazio());
    setSujo(false);
    setAviso({ texto: "Alterações descartadas." });
  }

  async function salvar(enviar: boolean) {
    if (enviar) {
      const erros = errosEnvio(limparColaborador(parte));
      if (erros.length) return setAviso({ texto: erros.join(" "), erro: true });
      if (!window.confirm(`Salvar a avaliação de ${rotuloCompetencia(comp)} para a coordenação?\n\nDepois disso você não poderá mais editá-la.`)) return;
    }
    setOcupado(true);
    try {
      const salvo = await salvarColaborador(user, comp, parte, enviar);
      apagarLocal(chave(comp));
      await carregar(salvo.competencia);
      let texto = enviar ? "Avaliação salva para a coordenação." : "Rascunho salvo.";
      if (enviar) {
        try {
          texto += ` ${await avisar(salvo.id, "enviada")}`;
        } catch (e) {
          texto += ` (O aviso por e-mail não saiu: ${getErrorMessage(e)})`;
        }
      }
      setAviso({ texto });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  async function excluir() {
    if (!atual) return;
    if (!window.confirm(`Excluir o rascunho de ${rotuloCompetencia(comp)}?\n\nEsta ação não pode ser desfeita.`)) return;
    setOcupado(true);
    try {
      await excluirAvaliacao(user, atual.id);
      apagarLocal(chave(comp));
      await carregar();
      setAviso({ texto: "Rascunho excluído." });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  async function mandarReplica() {
    if (!atual) return;
    if (!replica.trim()) return setAviso({ texto: "Escreva a réplica.", erro: true });
    if (!window.confirm("Enviar a réplica à coordenação?\n\nA avaliação não é alterada; a coordenação recebe o seu texto e pode responder.")) return;
    setOcupado(true);
    try {
      const salvo = await enviarReplica(user, atual.id, replica);
      setReplica("");
      await carregar(salvo.competencia);
      let texto = "Réplica enviada à coordenação.";
      try {
        texto += ` ${await avisar(salvo.id, "replica")}`;
      } catch (e) {
        texto += ` (O aviso por e-mail não saiu: ${getErrorMessage(e)})`;
      }
      setAviso({ texto });
    } catch (e) {
      setAviso({ texto: getErrorMessage(e), erro: true });
    } finally {
      setOcupado(false);
    }
  }

  const verSub = !!atual?.coordenacao && notasPreenchidas(atual.coordenacao.subcoordenacao) > 0;
  const mostrar: ParteColaborador = editavel ? parte : atual?.colaborador || colaboradorVazio();
  const replicaSlot =
    status === "finalizada" ? (
      <div className="avd-txt">
        <label htmlFor="avd-replica">Réplica — o que você deseja esclarecer ou sugerir (não altera a avaliação)</label>
        <textarea id="avd-replica" maxLength={LIMITES.replica} rows={4} value={replica} onChange={(e) => setReplica(e.target.value)} />
        <div>
          <button className="avd-btn avd-btn--pri" disabled={ocupado || !replica.trim()} type="button" onClick={mandarReplica}>
            <MessageSquareReply size={15} strokeWidth={1.6} />
            Enviar réplica
          </button>
        </div>
      </div>
    ) : null;

  return (
    <div className="avd avd-grade">
      <aside className="panel avd-lista" aria-label="Minhas avaliações">
        <header className="panel-header">
          <div>
            <Award size={18} strokeWidth={1.6} />
            <h2>Minhas avaliações</h2>
          </div>
        </header>
        <ul>
          {lista.map((a) => (
            <li key={a.id}>
              <button className={a.competencia === comp ? "ativo" : ""} type="button" onClick={() => trocarComp(a.competencia)}>
                <strong>{rotuloCompetencia(a.competencia)}</strong>
                <span className={`avd-pill avd-pill--${a.status}`}>{STATUS_COLABORADOR[a.status]}</span>
                <small>Autoavaliação {formatarNota(media(a.colaborador.notas))}{a.coordenacao ? ` · Coordenador ${formatarNota(media(a.coordenacao.notas))}` : ""}</small>
              </button>
            </li>
          ))}
          {!carregando && !lista.length ? <li className="avd-vazio">Nenhuma avaliação ainda. Escolha o mês ao lado e preencha.</li> : null}
        </ul>
      </aside>

      <section className="panel" aria-label="Avaliação do mês">
        <div className="avd-topo">
          <div>
            <h2>{AVALIACAO_TITULO}</h2>
            <span className="avd-sub-tit">{user.nome || user.email}</span>
          </div>
          <span className="avd-espaco" />
          <label className="avd-comp">
            Mês
            <input aria-label="Competência da avaliação" type="month" value={comp} onChange={(e) => trocarComp(e.target.value)} />
          </label>
          <span className={`avd-pill avd-pill--${status ?? "pendente"}`}>{status ? STATUS_COLABORADOR[status] : "Não iniciada"}</span>
        </div>
        <div className="avd-topo avd-acoes" style={{ paddingTop: 0 }}>
          {editavel ? (
            <>
              <button className="avd-btn" disabled={ocupado} type="button" onClick={() => salvar(false)}>
                <Save size={15} strokeWidth={1.6} />
                Salvar rascunho
              </button>
              <button className="avd-btn avd-btn--pri" disabled={ocupado} type="button" onClick={() => salvar(true)}>
                <Send size={15} strokeWidth={1.6} />
                Salvar para a coordenação
              </button>
              {atual ? (
                <button className="avd-btn avd-btn--perigo" disabled={ocupado} type="button" onClick={excluir}>
                  <Trash2 size={15} strokeWidth={1.6} />
                  Excluir rascunho
                </button>
              ) : null}
            </>
          ) : null}
          <span className="avd-espaco" />
          {atual ? <BotoesArquivos avaliacao={atual} coordenacao={false} onAviso={(texto, erro) => setAviso({ texto, erro })} /> : null}
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
          {status === "enviada" || status === "em_correcao" ? (
            <p className="avd-aviso avd-aviso--neutro">Sua avaliação está com a coordenação. Você será avisado quando ela for finalizada.</p>
          ) : null}
          {status === "replica" ? <p className="avd-aviso avd-aviso--neutro">Réplica enviada. A coordenação pode responder; a resposta aparece abaixo.</p> : null}
          {carregando ? <p className="avd-aviso avd-aviso--neutro">Carregando…</p> : null}
          <Medias colaborador={mostrar} coordenacao={atual?.coordenacao ?? null} mostrarSub={verSub} />
          <Formulario
            colaborador={mostrar}
            coordenacao={atual?.coordenacao ?? null}
            fechadas={fechadas}
            mostrarAuto
            mostrarSub={verSub}
            replicaSlot={replicaSlot}
            replicas={atual?.replicas || []}
            onAlternar={(s: SecaoId) => alternar(s)}
            onColaborador={editavel && !carregando ? alterar : undefined}
          />
        </div>
      </section>
    </div>
  );
}
