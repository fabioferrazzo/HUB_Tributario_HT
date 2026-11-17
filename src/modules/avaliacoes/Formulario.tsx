// Formulário da avaliação no formato da planilha: critérios (colaborador × coordenador × subcoordenação),
// avaliação geral (itens 1, 2 e réplica), recomendações, sugestões do colaborador e feedback.
import { ChevronRight, Plus, Trash2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  CRITERIOS,
  ESCALA,
  FEEDBACK_INTRO,
  LIMITES,
  PERGUNTAS_FEEDBACK,
  faixa,
  formatarNota,
  lerNota,
  media,
  notaValida,
  type CriterioId,
  type Notas,
  type ParteColaborador,
  type ParteCoordenacao,
  type Replica
} from "../../lib/avaliacoes";

export type SecaoId = "criterios" | "geral" | "recomendacoes" | "sugestoes" | "feedback";

type Props = {
  colaborador: ParteColaborador;
  onColaborador?: (p: ParteColaborador) => void; // presente = colaborador editando
  coordenacao: ParteCoordenacao | null; // null = ainda não visível
  onCoordenacao?: (p: ParteCoordenacao) => void; // presente = coordenação editando
  mostrarAuto: boolean; // coordenação pode ocultar a autoavaliação
  mostrarSub: boolean;
  replicas: Replica[];
  replicaSlot?: ReactNode; // caixa da réplica (colaborador) ou da resposta (coordenação)
  fechadas: Partial<Record<SecaoId, boolean>>;
  onAlternar: (s: SecaoId) => void;
};

function dataHora(v?: string) {
  return v ? new Date(v).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "";
}

// Campo de nota: aceita "8,5" enquanto digita e só repassa valores válidos.
function CampoNota({ valor, onValor, rotulo }: { valor: number | null | undefined; onValor: (n: number | null) => void; rotulo: string }) {
  const [texto, setTexto] = useState(notaValida(valor) ? formatarNota(valor) : "");
  const [foco, setFoco] = useState(false);
  useEffect(() => {
    if (!foco) setTexto(notaValida(valor) ? formatarNota(valor) : "");
  }, [valor, foco]);
  const lida = lerNota(texto);
  const invalida = typeof lida === "number" && Number.isNaN(lida);
  return (
    <input
      aria-label={rotulo}
      className={invalida ? "invalido" : ""}
      inputMode="decimal"
      maxLength={5}
      placeholder="—"
      title={invalida ? "Nota de 0 a 10 (até duas casas decimais)" : undefined}
      value={texto}
      onBlur={() => {
        setFoco(false);
        if (!invalida) setTexto(lida === null ? "" : formatarNota(lida));
      }}
      onChange={(e) => {
        setTexto(e.target.value);
        const n = lerNota(e.target.value);
        if (n === null || !Number.isNaN(n)) onValor(n);
      }}
      onFocus={() => setFoco(true)}
    />
  );
}

function Lido({ texto }: { texto?: string }) {
  return texto?.trim() ? <div className="avd-lido">{texto}</div> : <div className="avd-lido avd-lido--vazio">—</div>;
}

function Secao({ id, titulo, resumo, fechadas, onAlternar, children }: { id: SecaoId; titulo: string; resumo?: string; fechadas: Props["fechadas"]; onAlternar: Props["onAlternar"]; children: ReactNode }) {
  return (
    <details
      className="avd-sec"
      data-secao={id}
      open={!fechadas[id]}
      onToggle={(e) => {
        const aberta = (e.currentTarget as HTMLDetailsElement).open;
        if (aberta === !!fechadas[id]) onAlternar(id);
      }}
    >
      <summary>
        <ChevronRight className="avd-seta" size={15} strokeWidth={1.8} />
        {titulo}
        {resumo ? <span className="avd-resumo">{resumo}</span> : null}
      </summary>
      <div className="avd-sec-corpo">{children}</div>
    </details>
  );
}

export function Formulario(p: Props) {
  const { colaborador: colab, coordenacao: coord } = p;
  const editColab = !!p.onColaborador;
  const editCoord = !!p.onCoordenacao && !!coord;
  const verCoord = !!coord;
  const verColab = p.mostrarAuto || !verCoord;
  const verSub = verCoord && p.mostrarSub;

  function setNotaColab(id: CriterioId, campo: "nota" | "justificativa", v: number | null | string) {
    if (!p.onColaborador) return;
    const atual = colab.notas[id] || { nota: null, justificativa: "" };
    p.onColaborador({ ...colab, notas: { ...colab.notas, [id]: { ...atual, [campo]: v } } });
  }
  function setNotaCoord(bloco: "notas" | "subcoordenacao", id: CriterioId, campo: "nota" | "justificativa", v: number | null | string) {
    if (!p.onCoordenacao || !coord) return;
    const notas: Notas = coord[bloco];
    const atual = notas[id] || { nota: null, justificativa: "" };
    p.onCoordenacao({ ...coord, [bloco]: { ...notas, [id]: { ...atual, [campo]: v } } });
  }

  const mColab = media(colab.notas);
  const mCoord = coord ? media(coord.notas) : null;
  const mSub = coord ? media(coord.subcoordenacao) : null;

  function celulasNota(notas: Notas, id: CriterioId, classe: string, editar: boolean, onNota: (n: number | null) => void, onJust: (t: string) => void, rotulo: string, rotJust: string) {
    const n = notas[id];
    return (
      <>
        <td className={`avd-n ${classe}`}>
          {editar ? (
            <CampoNota rotulo={rotulo} valor={n?.nota} onValor={onNota} />
          ) : (
            <>
              <span className="avd-nota-lida">{formatarNota(n?.nota)}</span>
              <span className="avd-faixa">{faixa(n?.nota)}</span>
            </>
          )}
        </td>
        <td className={`avd-j ${classe}`}>
          {editar ? (
            <textarea aria-label={rotJust} maxLength={LIMITES.justificativa} rows={2} value={n?.justificativa || ""} onChange={(e) => onJust(e.target.value)} />
          ) : (
            <Lido texto={n?.justificativa} />
          )}
        </td>
      </>
    );
  }

  const recomendacoes = coord ? (editCoord ? [...coord.recomendacoes, "", "", "", "", ""].slice(0, LIMITES.recomendacoes) : coord.recomendacoes) : [];
  const sugestoes = editColab ? (colab.sugestoes.length ? colab.sugestoes : [{ sugestao: "", justificativa: "" }]) : colab.sugestoes;

  return (
    <div className="avd-form">
      <Secao
        fechadas={p.fechadas}
        id="criterios"
        resumo={[verColab ? `Colaborador ${formatarNota(mColab)}` : "", verCoord ? `Coordenador ${formatarNota(mCoord)}` : "", verSub && mSub !== null ? `Subcoordenação ${formatarNota(mSub)}` : ""].filter(Boolean).join(" · ")}
        titulo="Critérios e notas"
        onAlternar={p.onAlternar}
      >
        <div className="avd-rolagem">
          <table className="avd-tab">
            <thead>
              <tr>
                <th rowSpan={2}>Critérios</th>
                {verColab ? <th className="avd-col-colab" colSpan={2}>Colaborador (autoavaliação)</th> : null}
                {verCoord ? <th className="avd-col-coord" colSpan={2}>Coordenador</th> : null}
                {verSub ? <th className="avd-col-sub" colSpan={2}>Subcoordenação</th> : null}
              </tr>
              <tr>
                {verColab ? (
                  <>
                    <th className="avd-col-colab">Nota</th>
                    <th className="avd-col-colab">Justificativa — por que mereço essa nota?</th>
                  </>
                ) : null}
                {verCoord ? (
                  <>
                    <th className="avd-col-coord">Nota</th>
                    <th className="avd-col-coord">Justificativa</th>
                  </>
                ) : null}
                {verSub ? (
                  <>
                    <th className="avd-col-sub">Nota</th>
                    <th className="avd-col-sub">Justificativa</th>
                  </>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {CRITERIOS.map((c, i) => (
                <tr key={c.id}>
                  <td className="avd-crit">
                    <strong>
                      {i + 1}. {c.nome}
                    </strong>
                    <span>{c.detalhe}</span>
                  </td>
                  {verColab
                    ? celulasNota(
                        colab.notas,
                        c.id,
                        "avd-col-colab",
                        editColab,
                        (n) => setNotaColab(c.id, "nota", n),
                        (t) => setNotaColab(c.id, "justificativa", t),
                        `Nota do colaborador - ${c.nome}`,
                        `Justificativa do colaborador - ${c.nome}`
                      )
                    : null}
                  {verCoord && coord
                    ? celulasNota(
                        coord.notas,
                        c.id,
                        "avd-col-coord",
                        editCoord,
                        (n) => setNotaCoord("notas", c.id, "nota", n),
                        (t) => setNotaCoord("notas", c.id, "justificativa", t),
                        `Nota do coordenador - ${c.nome}`,
                        `Justificativa do coordenador - ${c.nome}`
                      )
                    : null}
                  {verSub && coord
                    ? celulasNota(
                        coord.subcoordenacao,
                        c.id,
                        "avd-col-sub",
                        editCoord,
                        (n) => setNotaCoord("subcoordenacao", c.id, "nota", n),
                        (t) => setNotaCoord("subcoordenacao", c.id, "justificativa", t),
                        `Nota da subcoordenação - ${c.nome}`,
                        `Justificativa da subcoordenação - ${c.nome}`
                      )
                    : null}
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td>Total (média dos 7 critérios)</td>
                {verColab ? (
                  <>
                    <td className="avd-n avd-col-colab" data-media="colaborador">{formatarNota(mColab)}</td>
                    <td className="avd-col-colab">{faixa(mColab)}</td>
                  </>
                ) : null}
                {verCoord ? (
                  <>
                    <td className="avd-n avd-col-coord" data-media="coordenador">{formatarNota(mCoord)}</td>
                    <td className="avd-col-coord">{faixa(mCoord)}</td>
                  </>
                ) : null}
                {verSub ? (
                  <>
                    <td className="avd-n avd-col-sub" data-media="subcoordenacao">{formatarNota(mSub)}</td>
                    <td className="avd-col-sub">{faixa(mSub)}</td>
                  </>
                ) : null}
              </tr>
            </tfoot>
          </table>
        </div>
        <div className="avd-escala" aria-label="Notas de referência">
          Referência (acima de):
          {ESCALA.map((e) => (
            <b key={e.rotulo}>
              {formatarNota(e.minimo)} {e.rotulo}
            </b>
          ))}
        </div>
      </Secao>

      {verCoord || p.replicas.length ? (
        <Secao fechadas={p.fechadas} id="geral" titulo="Avaliação geral e detalhes (feedback da coordenação)" onAlternar={p.onAlternar}>
          {coord ? (
            <>
              <div className="avd-txt">
                <label htmlFor="avd-pos">1 - Pontos positivos</label>
                {editCoord ? (
                  <textarea id="avd-pos" maxLength={LIMITES.texto} rows={3} value={coord.pontosPositivos} onChange={(e) => p.onCoordenacao?.({ ...coord, pontosPositivos: e.target.value })} />
                ) : (
                  <Lido texto={coord.pontosPositivos} />
                )}
              </div>
              <div className="avd-txt">
                <label htmlFor="avd-melhorar">2 - A melhorar/Sugestões</label>
                {editCoord ? (
                  <textarea id="avd-melhorar" maxLength={LIMITES.texto} rows={3} value={coord.aMelhorar} onChange={(e) => p.onCoordenacao?.({ ...coord, aMelhorar: e.target.value })} />
                ) : (
                  <Lido texto={coord.aMelhorar} />
                )}
              </div>
            </>
          ) : null}
          <div className="avd-txt">
            <span className="avd-rot">3 - Dúvidas ou réplica do colaborador</span>
            {p.replicas.length ? (
              <div className="avd-replicas">
                {p.replicas.map((r, i) => (
                  <article className="avd-replica" key={r.id || i}>
                    <header>
                      Réplica {i + 1} · {dataHora(r.enviadaEm)}
                    </header>
                    <p>{r.texto}</p>
                    {r.resposta ? (
                      <div className="avd-resposta">
                        <header>Resposta da coordenação · {dataHora(r.respondidaEm)}</header>
                        <p>{r.resposta}</p>
                      </div>
                    ) : null}
                  </article>
                ))}
              </div>
            ) : !p.replicaSlot ? (
              <div className="avd-lido avd-lido--vazio">Sem réplica.</div>
            ) : null}
            {p.replicaSlot}
          </div>
        </Secao>
      ) : null}

      {verCoord && coord ? (
        <Secao fechadas={p.fechadas} id="recomendacoes" resumo={`${coord.recomendacoes.filter((r) => r.trim()).length} de ${LIMITES.recomendacoes}`} titulo="Recomendações da coordenação" onAlternar={p.onAlternar}>
          <div className="avd-recs">
            {recomendacoes.length ? (
              recomendacoes.map((r, i) => (
                <div className="avd-rec" key={i}>
                  <span>{i + 1} -</span>
                  {editCoord ? (
                    <textarea
                      aria-label={`Recomendação ${i + 1}`}
                      maxLength={LIMITES.texto}
                      rows={2}
                      value={r}
                      onChange={(e) => {
                        const lista = [...recomendacoes];
                        lista[i] = e.target.value;
                        p.onCoordenacao?.({ ...coord, recomendacoes: lista });
                      }}
                    />
                  ) : (
                    <Lido texto={r} />
                  )}
                </div>
              ))
            ) : (
              <div className="avd-lido avd-lido--vazio">Sem recomendações.</div>
            )}
          </div>
        </Secao>
      ) : null}

      {/* Sugestões e feedback do colaborador: sempre visíveis (a opção de ocultar vale para as notas da autoavaliação) */}
        <>
          <Secao fechadas={p.fechadas} id="sugestoes" titulo="Sugestões do colaborador" onAlternar={p.onAlternar}>
            {sugestoes.length ? (
              <div className="avd-recs">
                <div className="avd-sug avd-sug-cab">
                  <span />
                  <span>Sugestão</span>
                  <span>Justificativa</span>
                  <span />
                </div>
                {sugestoes.map((s, i) => (
                  <div className="avd-sug" key={i}>
                    <span>{i + 1} -</span>
                    {editColab ? (
                      <>
                        <textarea
                          aria-label={`Sugestão ${i + 1}`}
                          maxLength={LIMITES.texto}
                          rows={2}
                          value={s.sugestao}
                          onChange={(e) => {
                            const lista = [...sugestoes];
                            lista[i] = { ...lista[i], sugestao: e.target.value };
                            p.onColaborador?.({ ...colab, sugestoes: lista });
                          }}
                        />
                        <textarea
                          aria-label={`Justificativa da sugestão ${i + 1}`}
                          maxLength={LIMITES.texto}
                          rows={2}
                          value={s.justificativa}
                          onChange={(e) => {
                            const lista = [...sugestoes];
                            lista[i] = { ...lista[i], justificativa: e.target.value };
                            p.onColaborador?.({ ...colab, sugestoes: lista });
                          }}
                        />
                        <button
                          aria-label={`Excluir sugestão ${i + 1}`}
                          className="avd-btn avd-btn--icone"
                          title="Excluir sugestão"
                          type="button"
                          onClick={() => p.onColaborador?.({ ...colab, sugestoes: sugestoes.filter((_, k) => k !== i) })}
                        >
                          <Trash2 size={15} strokeWidth={1.6} />
                        </button>
                      </>
                    ) : (
                      <>
                        <Lido texto={s.sugestao} />
                        <Lido texto={s.justificativa} />
                        <span />
                      </>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="avd-lido avd-lido--vazio">Sem sugestões.</div>
            )}
            {editColab && sugestoes.length < LIMITES.sugestoes ? (
              <div>
                <button className="avd-btn" type="button" onClick={() => p.onColaborador?.({ ...colab, sugestoes: [...sugestoes, { sugestao: "", justificativa: "" }] })}>
                  <Plus size={15} strokeWidth={1.6} />
                  Incluir sugestão
                </button>
              </div>
            ) : null}
          </Secao>

          <Secao fechadas={p.fechadas} id="feedback" titulo="Feedback" onAlternar={p.onAlternar}>
            <div className="avd-dica">{FEEDBACK_INTRO}</div>
            {PERGUNTAS_FEEDBACK.map((q) => (
              <div className="avd-txt" key={q.id}>
                <label htmlFor={`avd-fb-${q.id}`}>{q.pergunta}</label>
                {editColab ? (
                  <textarea
                    id={`avd-fb-${q.id}`}
                    maxLength={LIMITES.texto}
                    rows={3}
                    value={colab.feedback[q.id] || ""}
                    onChange={(e) => p.onColaborador?.({ ...colab, feedback: { ...colab.feedback, [q.id]: e.target.value } })}
                  />
                ) : (
                  <Lido texto={colab.feedback[q.id]} />
                )}
              </div>
            ))}
          </Secao>
        </>
      
    </div>
  );
}

export function Medias({ colaborador, coordenacao, mostrarSub }: { colaborador: ParteColaborador; coordenacao: ParteCoordenacao | null; mostrarSub: boolean }) {
  const mC = media(colaborador.notas);
  const mK = coordenacao ? media(coordenacao.notas) : null;
  const mS = coordenacao ? media(coordenacao.subcoordenacao) : null;
  return (
    <div className="avd-medias">
      <div className="avd-media avd-media--colab">
        <small>Autoavaliação</small>
        <strong>{formatarNota(mC)}</strong>
        <em>{faixa(mC) || "—"}</em>
      </div>
      {coordenacao ? (
        <div className="avd-media avd-media--coord">
          <small>Coordenador</small>
          <strong>{formatarNota(mK)}</strong>
          <em>{faixa(mK) || "—"}</em>
        </div>
      ) : null}
      {coordenacao && mostrarSub && mS !== null ? (
        <div className="avd-media avd-media--sub">
          <small>Subcoordenação</small>
          <strong>{formatarNota(mS)}</strong>
          <em>{faixa(mS)}</em>
        </div>
      ) : null}
    </div>
  );
}
