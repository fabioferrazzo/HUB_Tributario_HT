import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, ClipboardList, Landmark, Megaphone, Pencil, Plus, RefreshCw, Sparkles, StickyNote, Trash2 } from "lucide-react";
import type { HubProfile, HubRoute, HubUser, Pauta, QuadroAviso, TaskItem } from "../types";
import { FooterUpdates } from "../components/Updates";
import { RichTextEditor } from "../components/RichTextEditor";
import { canUserManagePautaApp, deleteAppPauta, listAppPautas, hasUserCompletedPauta } from "../lib/pautasRepository";
import { deleteQuadroAviso, listQuadroAvisos } from "../lib/avisosRepository";
import { canUserManageTask, deleteAppTask, listAppTasks } from "../lib/tarefasRepository";
import { canUserViewPauta, isPautaAlta, isPautaConcluidaParaUsuario } from "../lib/hubRules";
import { confirmDeletion, formatResponsaveis, getErrorMessage, parseBrazilianDate } from "../lib/formatters";
import { pautaRichTextToPlain, sanitizePautaRichHtml } from "../lib/richText";
import { AGENDA_CATEGORIA_ROTULO, carregarAgendaSemana, type AgendaSemana } from "../lib/agendaSemana";
import {
  AVISO_CORES,
  AVISO_FONTES,
  loadAvisoCoordenacao,
  publishAvisoCoordenacao,
  removeAvisoCoordenacao,
  type AvisoCoordenacaoCor,
  type AvisoCoordenacaoEstado,
  type AvisoCoordenacaoFonte,
  type AvisoCoordenacaoNivel
} from "../lib/avisoCoordenacaoRepository";
import { getAppRoute, hubApps } from "../app/appsRegistry";
import { salvarVisualPremium, useVisualPremium } from "../lib/visualPremium";

// Quadro geral: tela inicial do HUB.
// No alto, o Aviso da Coordenação; abaixo, três colunas com o resumo da semana:
// Pautas e Quadro de Avisos, Calendário de Tarefas e Agenda tributária.

const DIAS_CURTOS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const AVISO_RECOLHIDO_KEY = "hub_quadro_geral_aviso_recolhido";
const AGENDA_ITENS_POR_DIA = 4;
// Visual premium: padrão para toda a equipe; quem escolheu o visual clássico pode voltar ao premium por aqui.
const QuadroPremium = lazy(() => import("./QuadroPremium").then((modulo) => ({ default: modulo.QuadroPremium })));

function inicioDoDia(data: Date) {
  return new Date(data.getFullYear(), data.getMonth(), data.getDate());
}

function segundaDaSemana(data: Date) {
  const dia = inicioDoDia(data);
  const deslocamento = (dia.getDay() + 6) % 7;
  dia.setDate(dia.getDate() - deslocamento);
  return dia;
}

function somarDias(data: Date, dias: number) {
  const nova = new Date(data);
  nova.setDate(nova.getDate() + dias);
  return nova;
}

function isoLocal(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function ddmm(data: Date) {
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
}

// Datas do HUB chegam como "dd/mm/aaaa", "aaaa-mm-dd" ou data e hora ISO.
// "aaaa-mm-dd" é tratada como data local (sem deslocar o dia pelo fuso).
function lerData(valor: string | undefined | null): Date | null {
  const texto = String(valor || "").trim();
  if (!texto) return null;
  const br = parseBrazilianDate(texto);
  if (br) return br;
  const soData = texto.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (soData) return new Date(Number(soData[1]), Number(soData[2]) - 1, Number(soData[3]));
  const data = new Date(texto);
  return Number.isNaN(data.getTime()) ? null : data;
}

function temHora(valor: string) {
  return /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(valor) && !/T00:00(:00)?/.test(valor);
}

function horaCurta(data: Date) {
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

function textoPuro(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function rotuloDia(data: Date) {
  return `${DIAS_CURTOS[data.getDay()]} ${ddmm(data)}`;
}

function rotaDoApp(id: string): HubRoute | null {
  const app = hubApps.find((item) => item.id === id);
  return app ? getAppRoute(app) : null;
}

function lerRecolhido() {
  try {
    return localStorage.getItem(AVISO_RECOLHIDO_KEY) === "1";
  } catch {
    return false;
  }
}

export function QuadroGeral({
  hubUsers,
  onNavigate,
  user
}: {
  hubUsers: HubProfile[];
  onNavigate: (route: HubRoute) => void;
  user: HubUser;
}) {
  const [semana, setSemana] = useState(() => segundaDaSemana(new Date()));
  const [pautas, setPautas] = useState<Pauta[]>([]);
  const [avisos, setAvisos] = useState<QuadroAviso[]>([]);
  const [tarefas, setTarefas] = useState<TaskItem[]>([]);
  const [agenda, setAgenda] = useState<AgendaSemana | null>(null);
  const [carregando, setCarregando] = useState({ pautas: true, tarefas: true, agenda: true });
  const [erros, setErros] = useState({ pautas: "", tarefas: "", agenda: "" });

  const dias = useMemo(() => Array.from({ length: 7 }, (_, indice) => somarDias(semana, indice)), [semana]);
  const fimSemana = dias[6];
  const hoje = inicioDoDia(new Date());
  const ehSemanaAtual = isoLocal(semana) === isoLocal(segundaDaSemana(new Date()));

  // Administrador: editar (abre o editor em Pautas) ou excluir a pauta direto daqui.
  const [excluindoPauta, setExcluindoPauta] = useState("");
  function editarPauta(pauta: Pauta) {
    try {
      window.sessionStorage.setItem("hub_pautas_editar", pauta.id);
    } catch {
      // sem armazenamento: abre Pautas sem o editor
    }
    onNavigate("pautas");
  }
  async function excluirPauta(pauta: Pauta) {
    if (!confirmDeletion(`Excluir a pauta "${pauta.tema}"?`)) return;
    setExcluindoPauta(pauta.id);
    try {
      const restantes = await deleteAppPauta({ current: pautas, pauta, user });
      setPautas(restantes);
      setErros((atual) => ({ ...atual, pautas: "" }));
    } catch (erro) {
      setErros((atual) => ({ ...atual, pautas: getErrorMessage(erro) }));
    } finally {
      setExcluindoPauta("");
    }
  }
  const acoesPauta = (pauta: Pauta) =>
    canUserManagePautaApp(pauta, user)
      ? { onEditar: () => editarPauta(pauta), onExcluir: () => void excluirPauta(pauta), excluindo: excluindoPauta === pauta.id }
      : undefined;

  // Tarefas do calendário: quem pode alterá-las no Calendário (criador, gestor ou administrador).
  function editarTarefa(tarefa: TaskItem) {
    try {
      window.sessionStorage.setItem("hub_tarefas_editar", tarefa.id);
    } catch {
      // sem armazenamento: abre o Calendário sem o editor
    }
    onNavigate("tarefas");
  }
  async function excluirTarefa(tarefa: TaskItem) {
    if (!confirmDeletion(`Excluir a tarefa "${tarefa.titulo}"?`)) return;
    setExcluindoPauta(tarefa.id);
    try {
      const restantes = await deleteAppTask({ current: tarefas, task: tarefa, user });
      setTarefas(restantes.filter((item) => item.id !== tarefa.id));
      setErros((atual) => ({ ...atual, tarefas: "" }));
    } catch (erro) {
      setErros((atual) => ({ ...atual, tarefas: getErrorMessage(erro) }));
    } finally {
      setExcluindoPauta("");
    }
  }
  const acoesTarefa = (tarefa: TaskItem) =>
    canUserManageTask(tarefa, user)
      ? { onEditar: () => editarTarefa(tarefa), onExcluir: () => void excluirTarefa(tarefa), excluindo: excluindoPauta === tarefa.id }
      : undefined;

  // Avisos do quadro: autor do aviso ou administrador.
  function podeGerenciarAviso(aviso: QuadroAviso) {
    if (user.role === "admin") return true;
    if (aviso.createdBy && user.id && aviso.createdBy === user.id) return true;
    return Boolean(aviso.createdByEmail) && aviso.createdByEmail === user.email.trim().toLowerCase();
  }
  function editarAviso(aviso: QuadroAviso) {
    try {
      window.sessionStorage.setItem("hub_avisos_editar", aviso.id);
      window.sessionStorage.setItem("hub_pautas_aba", aviso.visibility === "particular" ? "particular" : "geral");
    } catch {
      // sem armazenamento: abre Pautas sem o editor
    }
    onNavigate("pautas");
  }
  async function excluirAviso(aviso: QuadroAviso) {
    if (!confirmDeletion(`Excluir o aviso "${resumoAviso(aviso)}" do quadro?`)) return;
    setExcluindoPauta(aviso.id);
    try {
      setAvisos(await deleteQuadroAviso({ current: avisos, aviso, user }));
      setErros((atual) => ({ ...atual, pautas: "" }));
    } catch (erro) {
      setErros((atual) => ({ ...atual, pautas: getErrorMessage(erro) }));
    } finally {
      setExcluindoPauta("");
    }
  }

  const carregarPautas = useCallback(async () => {
    setCarregando((atual) => ({ ...atual, pautas: true }));
    try {
      const [listaPautas, listaAvisos] = await Promise.all([listAppPautas(user), listQuadroAvisos(user).catch(() => [] as QuadroAviso[])]);
      setPautas(listaPautas);
      setAvisos(listaAvisos);
      setErros((atual) => ({ ...atual, pautas: "" }));
    } catch (erro) {
      setErros((atual) => ({ ...atual, pautas: getErrorMessage(erro) }));
    } finally {
      setCarregando((atual) => ({ ...atual, pautas: false }));
    }
  }, [user]);

  const carregarTarefas = useCallback(async () => {
    setCarregando((atual) => ({ ...atual, tarefas: true }));
    try {
      setTarefas(await listAppTasks(user));
      setErros((atual) => ({ ...atual, tarefas: "" }));
    } catch (erro) {
      setErros((atual) => ({ ...atual, tarefas: getErrorMessage(erro) }));
    } finally {
      setCarregando((atual) => ({ ...atual, tarefas: false }));
    }
  }, [user]);

  useEffect(() => {
    void carregarPautas();
    void carregarTarefas();
    const aoMudarPautas = () => void carregarPautas();
    const aoMudarTarefas = () => void carregarTarefas();
    window.addEventListener("hub:pautas", aoMudarPautas);
    window.addEventListener("hub:quadro-avisos", aoMudarPautas);
    window.addEventListener("hub:tasks", aoMudarTarefas);
    return () => {
      window.removeEventListener("hub:pautas", aoMudarPautas);
      window.removeEventListener("hub:quadro-avisos", aoMudarPautas);
      window.removeEventListener("hub:tasks", aoMudarTarefas);
    };
  }, [carregarPautas, carregarTarefas]);

  useEffect(() => {
    let ativo = true;
    setCarregando((atual) => ({ ...atual, agenda: true }));
    carregarAgendaSemana(dias)
      .then((resultado) => {
        if (!ativo) return;
        setAgenda(resultado);
        setErros((atual) => ({ ...atual, agenda: "" }));
      })
      .catch((erro) => {
        if (ativo) setErros((atual) => ({ ...atual, agenda: getErrorMessage(erro) }));
      })
      .finally(() => {
        if (ativo) setCarregando((atual) => ({ ...atual, agenda: false }));
      });
    return () => {
      ativo = false;
    };
  }, [dias]);

  // ---- Pautas da semana (e atrasadas, só na semana atual)
  const pautasAbertas = useMemo(
    () => pautas.filter((pauta) => canUserViewPauta(pauta, user) && !isPautaConcluidaParaUsuario(pauta, user)),
    [pautas, user]
  );
  const pautasSemana = useMemo(
    () =>
      pautasAbertas
        .map((pauta) => ({ pauta, data: lerData(pauta.prazo) }))
        .filter((item): item is { pauta: Pauta; data: Date } => Boolean(item.data) && item.data! >= semana && item.data! < somarDias(fimSemana, 1))
        .sort((a, b) => a.data.getTime() - b.data.getTime()),
    [fimSemana, pautasAbertas, semana]
  );
  const pautasAtrasadas = useMemo(
    () =>
      ehSemanaAtual
        ? pautasAbertas
            .map((pauta) => ({ pauta, data: lerData(pauta.prazo) }))
            .filter((item): item is { pauta: Pauta; data: Date } => Boolean(item.data) && item.data! < semana)
            .sort((a, b) => a.data.getTime() - b.data.getTime())
        : [],
    [ehSemanaAtual, pautasAbertas, semana]
  );
  const avisosGerais = useMemo(
    () =>
      avisos
        .filter((aviso) => aviso.visibility === "geral")
        .sort((a, b) => (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt))
        .slice(0, 4),
    [avisos]
  );

  // ---- Tarefas da semana, por dia
  const tarefasAbertas = useMemo(() => tarefas.filter((tarefa) => tarefa.status !== "concluida" && !tarefa.archivedAt), [tarefas]);
  const tarefasPorDia = useMemo(() => {
    const mapa = new Map<string, Array<{ tarefa: TaskItem; data: Date }>>();
    for (const tarefa of tarefasAbertas) {
      const data = lerData(tarefa.prazo);
      if (!data || data < semana || data >= somarDias(fimSemana, 1)) continue;
      const chave = isoLocal(data);
      mapa.set(chave, [...(mapa.get(chave) || []), { tarefa, data }]);
    }
    mapa.forEach((lista) => lista.sort((a, b) => a.data.getTime() - b.data.getTime()));
    return mapa;
  }, [fimSemana, semana, tarefasAbertas]);
  // Atrasadas: prazo antes desta semana (as atrasadas da própria semana aparecem no dia, em vermelho).
  const tarefasComData = useMemo(
    () =>
      tarefasAbertas
        .map((tarefa) => ({ tarefa, data: lerData(tarefa.prazo) }))
        .filter((item): item is { tarefa: TaskItem; data: Date } => Boolean(item.data))
        .sort((a, b) => a.data.getTime() - b.data.getTime()),
    [tarefasAbertas]
  );
  const tarefasAtrasadas = ehSemanaAtual ? tarefasComData.filter((item) => item.data < semana) : [];
  const proximasTarefas = ehSemanaAtual ? tarefasComData.filter((item) => item.data >= somarDias(fimSemana, 1)).slice(0, 5) : [];
  const totalTarefasSemana = Array.from(tarefasPorDia.values()).reduce((soma, lista) => soma + lista.length, 0);

  // ---- Agenda tributária
  const diasAgenda = (agenda?.dias || []).filter((dia) => dia.itens.length);
  const totalObrigacoes = diasAgenda.reduce((soma, dia) => soma + dia.itens.length, 0);
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});

  const rotaAgenda = rotaDoApp("agenda");

  const podeVisualPremium = true;
  const visual = useVisualPremium(podeVisualPremium);
  function alternarVisualPremium(ativo: boolean) {
    salvarVisualPremium({ ativo });
  }

  if (visual.ativo) {
    return (
      <div className="quadro-geral quadro-geral--premium">
        <Suspense fallback={<div className="modulo-carregando" role="status">Carregando…</div>}>
          <QuadroPremium
            acoesAviso={(aviso) =>
              podeGerenciarAviso(aviso)
                ? { onEditar: () => editarAviso(aviso), onExcluir: () => void excluirAviso(aviso), excluindo: excluindoPauta === aviso.id }
                : undefined
            }
            acoesPauta={acoesPauta}
            acoesTarefa={acoesTarefa}
            agenda={agenda}
            avisoCoordenacao={<AvisoCoordenacaoPainel noTopo user={user} />}
            avisosGerais={avisosGerais}
            carregando={carregando}
            dias={dias}
            ehSemanaAtual={ehSemanaAtual}
            erros={erros}
            fimSemana={fimSemana}
            hubUsers={hubUsers}
            onHoje={() => setSemana(segundaDaSemana(new Date()))}
            onNavigate={onNavigate}
            onProximaSemana={() => setSemana(somarDias(semana, 7))}
            onSair={() => alternarVisualPremium(false)}
            onSemanaAnterior={() => setSemana(somarDias(semana, -7))}
            pautasAbertas={pautasAbertas}
            pautasAtrasadas={pautasAtrasadas}
            pautasSemana={pautasSemana}
            resumoAviso={resumoAviso}
            rotaAgenda={rotaAgenda}
            semana={semana}
            tarefasAtrasadas={tarefasAtrasadas}
            tarefasPorDia={tarefasPorDia}
            tamanho={visual.tamanho}
            tema={visual.tema}
            totalTarefasSemana={totalTarefasSemana}
            user={user}
          />
        </Suspense>
        <FooterUpdates />
      </div>
    );
  }

  return (
    <div className="quadro-geral">
      <AvisoCoordenacaoPainel user={user} />

      <div className="qg-semana" role="group" aria-label="Semana exibida">
        <button type="button" className="qg-icon-btn" onClick={() => setSemana(somarDias(semana, -7))} aria-label="Semana anterior" title="Semana anterior">
          <ChevronLeft size={16} strokeWidth={1.6} />
        </button>
        <strong>
          Semana de {ddmm(semana)} a {ddmm(fimSemana)}
          {ehSemanaAtual ? <span className="qg-semana-atual">semana atual</span> : null}
        </strong>
        <button type="button" className="qg-icon-btn" onClick={() => setSemana(somarDias(semana, 7))} aria-label="Próxima semana" title="Próxima semana">
          <ChevronRight size={16} strokeWidth={1.6} />
        </button>
        {!ehSemanaAtual ? (
          <button type="button" className="btn-mini" onClick={() => setSemana(segundaDaSemana(new Date()))}>
            Voltar para hoje
          </button>
        ) : null}
        {podeVisualPremium ? (
          <button type="button" className="btn-mini qg-visual-premium" onClick={() => alternarVisualPremium(true)} title="Voltar ao visual premium">
            <Sparkles size={13} strokeWidth={1.6} /> Visual premium
          </button>
        ) : null}
      </div>

      <div className="qg-colunas">
        {/* ---------------------------------------------------------------- Pautas e avisos */}
        <section className="panel qg-coluna" aria-labelledby="qg-pautas-titulo">
          <header className="qg-coluna-head">
            <ClipboardList size={17} strokeWidth={1.6} />
            <h2 id="qg-pautas-titulo">Pautas e avisos</h2>
            <span className="qg-contagem">{carregando.pautas ? "…" : `${pautasSemana.length} na semana`}</span>
            <button type="button" className="btn-mini" onClick={() => onNavigate("pautas")}>
              Abrir
            </button>
          </header>
          <div className="qg-coluna-corpo">
            {erros.pautas ? <p className="qg-erro">{erros.pautas}</p> : null}
            {pautasAtrasadas.length ? (
              <div className="qg-bloco">
                <h3 className="qg-bloco-titulo qg-bloco-titulo--alerta">Atrasadas ({pautasAtrasadas.length})</h3>
                <ul className="qg-lista">
                  {pautasAtrasadas.slice(0, 5).map(({ pauta, data }) => (
                    <PautaLinha key={pauta.id} acoes={acoesPauta(pauta)} data={data} hubUsers={hubUsers} pauta={pauta} atrasada />
                  ))}
                </ul>
                {pautasAtrasadas.length > 5 ? <p className="qg-mais">+{pautasAtrasadas.length - 5} atrasada(s) em Pautas</p> : null}
              </div>
            ) : null}
            <div className="qg-bloco">
              <h3 className="qg-bloco-titulo">Pautas da semana</h3>
              {!carregando.pautas && !pautasSemana.length ? <p className="qg-vazio">Nenhuma pauta com prazo nesta semana.</p> : null}
              <ul className="qg-lista">
                {pautasSemana.map(({ pauta, data }) => (
                  <PautaLinha key={pauta.id} acoes={acoesPauta(pauta)} data={data} hubUsers={hubUsers} pauta={pauta} />
                ))}
              </ul>
            </div>
            <div className="qg-bloco">
              <h3 className="qg-bloco-titulo">
                <StickyNote size={13} strokeWidth={1.6} /> Quadro de Avisos
              </h3>
              {!carregando.pautas && !avisosGerais.length ? <p className="qg-vazio">Nenhum aviso geral no quadro.</p> : null}
              <ul className="qg-lista">
                {avisosGerais.map((aviso) => (
                  <li key={aviso.id} className="qg-item qg-item--aviso" style={{ borderLeftColor: aviso.color || undefined }}>
                    <span className="qg-item-titulo">{resumoAviso(aviso)}</span>
                    <span className="qg-item-meta">{formatarDataCurta(aviso.updatedAt || aviso.createdAt)}</span>
                    {podeGerenciarAviso(aviso) ? (
                      <AcoesQuadro
                        excluindo={excluindoPauta === aviso.id}
                        onEditar={() => editarAviso(aviso)}
                        onExcluir={() => void excluirAviso(aviso)}
                        rotulo={`o aviso ${resumoAviso(aviso)}`}
                      />
                    ) : null}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </section>

        {/* ---------------------------------------------------------------- Calendário */}
        <section className="panel qg-coluna" aria-labelledby="qg-calendario-titulo">
          <header className="qg-coluna-head">
            <CalendarDays size={17} strokeWidth={1.6} />
            <h2 id="qg-calendario-titulo">Calendário</h2>
            <span className="qg-contagem">{carregando.tarefas ? "…" : `${totalTarefasSemana} tarefa(s)`}</span>
            <button type="button" className="btn-mini" onClick={() => onNavigate("tarefas")}>
              Abrir
            </button>
          </header>
          <div className="qg-coluna-corpo">
            {erros.tarefas ? <p className="qg-erro">{erros.tarefas}</p> : null}
            {tarefasAtrasadas.length ? (
              <div className="qg-bloco">
                <h3 className="qg-bloco-titulo qg-bloco-titulo--alerta">Atrasadas ({tarefasAtrasadas.length})</h3>
                <ul className="qg-lista">
                  {tarefasAtrasadas.slice(0, 5).map(({ tarefa, data }) => (
                    <TarefaLinha key={tarefa.id} acoes={acoesTarefa(tarefa)} data={data} hubUsers={hubUsers} tarefa={tarefa} atrasada />
                  ))}
                </ul>
                {tarefasAtrasadas.length > 5 ? (
                  <button type="button" className="qg-link" onClick={() => onNavigate("tarefas")}>
                    +{tarefasAtrasadas.length - 5} atrasada(s) no calendário
                  </button>
                ) : null}
              </div>
            ) : null}
            <div className="qg-bloco">
              <h3 className="qg-bloco-titulo">Tarefas da semana</h3>
              {!carregando.tarefas && !totalTarefasSemana ? <p className="qg-vazio">Nenhuma tarefa com prazo nesta semana.</p> : null}
              {dias.map((dia) => {
                const lista = tarefasPorDia.get(isoLocal(dia));
                if (!lista?.length) return null;
                const ehHoje = isoLocal(dia) === isoLocal(hoje);
                return (
                  <div key={isoLocal(dia)} className={`qg-dia${ehHoje ? " qg-dia--hoje" : ""}`}>
                    <DiaTitulo data={dia} hoje={ehHoje} />
                    <ul className="qg-lista">
                      {lista.map(({ tarefa, data }) => (
                        <TarefaLinha key={tarefa.id} acoes={acoesTarefa(tarefa)} data={data} hubUsers={hubUsers} tarefa={tarefa} atrasada={data < hoje} />
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
            {proximasTarefas.length ? (
              <div className="qg-bloco">
                <h3 className="qg-bloco-titulo">Próximas tarefas</h3>
                <ul className="qg-lista">
                  {proximasTarefas.map(({ tarefa, data }) => (
                    <TarefaLinha key={tarefa.id} acoes={acoesTarefa(tarefa)} data={data} hubUsers={hubUsers} tarefa={tarefa} />
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </section>

        {/* ---------------------------------------------------------------- Agenda tributária */}
        <section className="panel qg-coluna" aria-labelledby="qg-agenda-titulo">
          <header className="qg-coluna-head">
            <Landmark size={17} strokeWidth={1.6} />
            <h2 id="qg-agenda-titulo">Agenda tributária</h2>
            <span className="qg-contagem">{carregando.agenda ? "…" : `${totalObrigacoes} vencimento(s)`}</span>
            {rotaAgenda ? (
              <button type="button" className="btn-mini" onClick={() => onNavigate(rotaAgenda)}>
                Abrir
              </button>
            ) : null}
          </header>
          <div className="qg-coluna-corpo">
            {erros.agenda ? <p className="qg-erro">{erros.agenda}</p> : null}
            {agenda?.mesesSemDados.length ? (
              <p className="qg-aviso-linha">Agenda de {agenda.mesesSemDados.join(" e ")} ainda não disponível. Atualize pelo app Agenda tributária.</p>
            ) : null}
            {!carregando.agenda && agenda && !agenda.mesesSemDados.length && !diasAgenda.length ? (
              <p className="qg-vazio">Nenhum vencimento nesta semana.</p>
            ) : null}
            {diasAgenda.map((dia) => {
              const data = lerData(dia.data)!;
              const ehHoje = dia.data === isoLocal(hoje);
              const aberto = Boolean(diasAbertos[dia.data]);
              const visiveis = aberto ? dia.itens : dia.itens.slice(0, AGENDA_ITENS_POR_DIA);
              return (
                <div key={dia.data} className={`qg-dia${ehHoje ? " qg-dia--hoje" : ""}${data < hoje ? " qg-dia--passado" : ""}`}>
                  <DiaTitulo data={data} hoje={ehHoje} contagem={dia.itens.length} />
                  <ul className="qg-lista">
                    {visiveis.map((item, indice) => (
                      <li key={`${dia.data}-${indice}`} className="qg-item qg-item--agenda">
                        <span className="qg-cat" data-cat={item.cat}>
                          {AGENDA_CATEGORIA_ROTULO[item.cat] || item.cat}
                        </span>
                        <span className="qg-item-titulo">{item.titulo}</span>
                        {item.periodo ? <span className="qg-item-meta">{item.periodo}</span> : null}
                      </li>
                    ))}
                  </ul>
                  {dia.itens.length > AGENDA_ITENS_POR_DIA ? (
                    <button type="button" className="qg-link" onClick={() => setDiasAbertos((atual) => ({ ...atual, [dia.data]: !aberto }))}>
                      {aberto ? "Mostrar menos" : `+${dia.itens.length - AGENDA_ITENS_POR_DIA} obrigação(ões)`}
                    </button>
                  ) : null}
                </div>
              );
            })}
            {agenda?.fonte ? (
              <p className="qg-fonte">
                Fonte: {agenda.fonte}
                {agenda.atualizado ? ` · atualizado em ${agenda.atualizado}` : ""}
              </p>
            ) : null}
          </div>
        </section>
      </div>

      <FooterUpdates />
    </div>
  );
}

type AcoesPauta = { onEditar: () => void; onExcluir: () => void; excluindo: boolean };

function PautaLinha({
  pauta,
  data,
  hubUsers,
  atrasada,
  acoes
}: {
  pauta: Pauta;
  data: Date;
  hubUsers: HubProfile[];
  atrasada?: boolean;
  acoes?: AcoesPauta;
}) {
  const titulo = pauta.tema?.trim() || pautaRichTextToPlain(pauta.acoes).slice(0, 120) || "Pauta sem título";
  const responsaveis = pauta.responsaveis?.length ? formatResponsaveis(pauta.responsaveis, hubUsers) : pauta.scope === "todos" ? "Todos" : pauta.responsavel;
  return (
    <li className={`qg-item${atrasada ? " qg-item--atrasada" : ""}${isPautaAlta(pauta) ? " qg-item--alta" : ""}`}>
      <span className="qg-item-titulo">
        {pauta.destaque ? <span className="qg-selo">destaque</span> : null}
        {titulo}
      </span>
      <span className="qg-item-meta">
        <strong className="qg-item-data">{rotuloDia(data)}</strong>
        {responsaveis ? ` · ${responsaveis}` : ""}
      </span>
      {acoes ? <AcoesQuadro {...acoes} rotulo={`a pauta ${titulo}`} /> : null}
    </li>
  );
}

function DiaTitulo({ data, hoje, contagem }: { data: Date; hoje?: boolean; contagem?: number }) {
  return (
    <h3 className="qg-dia-titulo">
      <span className="qg-dia-semana">{DIAS_CURTOS[data.getDay()]}</span>
      <strong className="qg-dia-data">{ddmm(data)}</strong>
      {hoje ? <span className="qg-hoje">hoje</span> : null}
      {contagem !== undefined ? <span className="qg-dia-contagem">{contagem}</span> : null}
    </h3>
  );
}

// Ícones de editar/excluir no canto do item (só para quem pode alterar o item no menu de origem).
function AcoesQuadro({ rotulo, onEditar, onExcluir, excluindo }: AcoesPauta & { rotulo: string }) {
  return (
    <span className="qg-item-acoes">
      <button aria-label={`Editar ${rotulo}`} className="qg-icon-btn" title="Editar" type="button" onClick={onEditar}>
        <Pencil size={13} strokeWidth={1.6} />
      </button>
      <button
        aria-label={`Excluir ${rotulo}`}
        className="qg-icon-btn qg-icon-btn--perigo"
        disabled={excluindo}
        title="Excluir"
        type="button"
        onClick={onExcluir}
      >
        <Trash2 size={13} strokeWidth={1.6} />
      </button>
    </span>
  );
}

function TarefaLinha({
  tarefa,
  data,
  hubUsers,
  atrasada,
  acoes
}: {
  tarefa: TaskItem;
  data: Date;
  hubUsers: HubProfile[];
  atrasada?: boolean;
  acoes?: AcoesPauta;
}) {
  const responsaveis = tarefa.responsaveis?.length ? formatResponsaveis(tarefa.responsaveis, hubUsers) : "Sem responsável";
  return (
    <li className={`qg-item${atrasada ? " qg-item--atrasada" : ""}${tarefa.prioridade === "alta" ? " qg-item--alta" : ""}`}>
      <span className="qg-item-titulo">
        {tarefa.destaque ? <span className="qg-selo">destaque</span> : null}
        {tarefa.titulo || "Tarefa sem título"}
      </span>
      <span className="qg-item-meta">
        <strong className="qg-item-data">
          {rotuloDia(data)}
          {temHora(tarefa.prazo) ? ` às ${horaCurta(data)}` : ""}
        </strong>
        {` · ${responsaveis}`}
      </span>
      {acoes ? <AcoesQuadro {...acoes} rotulo={`a tarefa ${tarefa.titulo || "sem título"}`} /> : null}
    </li>
  );
}

function resumoAviso(aviso: QuadroAviso) {
  if (aviso.title?.trim()) return aviso.title.trim();
  if (aviso.kind === "imagem") return aviso.fileName ? `Imagem: ${aviso.fileName}` : "Imagem no quadro";
  if (aviso.kind === "anexo") return aviso.fileName ? `Anexo: ${aviso.fileName}` : "Anexo no quadro";
  const texto = textoPuro(aviso.content || "");
  if (!texto || texto.startsWith("data:")) return "Aviso no quadro";
  return texto.length > 140 ? `${texto.slice(0, 140)}…` : texto;
}

function formatarDataCurta(valor: string) {
  const data = lerData(valor);
  return data ? ddmm(data) : "";
}

// ------------------------------------------------------------------------------------------------
// Aviso da Coordenação

// noTopo: no Quadro geral premium o aviso fica em faixa de destaque no alto da página; sem aviso publicado,
// só quem pode publicar vê a faixa (para escrever um novo).
function AvisoCoordenacaoPainel({ user, noTopo = false }: { user: HubUser; noTopo?: boolean }) {
  const [estado, setEstado] = useState<AvisoCoordenacaoEstado>({ aviso: null, podeEditar: false, guardaEstilo: true });
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [conteudo, setConteudo] = useState("");
  const [nivel, setNivel] = useState<AvisoCoordenacaoNivel>("normal");
  const [cor, setCor] = useState<AvisoCoordenacaoCor>("padrao");
  const [fonte, setFonte] = useState<AvisoCoordenacaoFonte>("normal");
  const [validade, setValidade] = useState("");
  const [editarId, setEditarId] = useState("");
  const [notificar, setNotificar] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [recolhido, setRecolhido] = useState(lerRecolhido);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      setEstado(await loadAvisoCoordenacao(user));
      setErro("");
    } catch (falha) {
      setErro(getErrorMessage(falha));
    } finally {
      setCarregando(false);
    }
  }, [user]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  function alternarRecolhido() {
    const novo = !recolhido;
    setRecolhido(novo);
    try {
      localStorage.setItem(AVISO_RECOLHIDO_KEY, novo ? "1" : "0");
    } catch {
      // sem armazenamento local: vale só nesta tela
    }
  }

  function abrirEditor(novo: boolean) {
    const aviso = novo ? null : estado.aviso;
    setConteudo(aviso?.conteudo || "");
    setNivel(aviso?.nivel || "normal");
    setCor(aviso?.cor || "padrao");
    setFonte(aviso?.fonte || "normal");
    setValidade(aviso?.validade || "");
    setEditarId(aviso?.id || "");
    setNotificar(false);
    setEditorKey((valor) => valor + 1);
    setEditando(true);
    setRecolhido(false);
    setErro("");
  }

  async function publicar() {
    setSalvando(true);
    setErro("");
    try {
      const novoEstado = await publishAvisoCoordenacao(user, {
        conteudo: sanitizePautaRichHtml(conteudo),
        nivel,
        cor,
        fonte,
        validade,
        editarId: editarId || undefined,
        notificar
      });
      setEstado(novoEstado);
      setEditando(false);
      if (!novoEstado.guardaEstilo && (cor !== "padrao" || fonte !== "normal")) {
        setErro("Aviso publicado, mas a cor e o tamanho do texto só ficam guardados depois de rodar no Supabase o SQL patch_aviso_coordenacao.sql atualizado.");
      }
    } catch (falha) {
      setErro(getErrorMessage(falha));
    } finally {
      setSalvando(false);
    }
  }

  async function retirar() {
    if (!confirmDeletion("Retirar o Aviso da Coordenação do Quadro geral de todos os usuários?")) return;
    setSalvando(true);
    setErro("");
    try {
      setEstado(await removeAvisoCoordenacao(user));
    } catch (falha) {
      setErro(getErrorMessage(falha));
    } finally {
      setSalvando(false);
    }
  }

  const aviso = estado.aviso;
  const importante = aviso?.nivel === "importante";
  if (noTopo && !carregando && !aviso && !estado.podeEditar && !editando && !erro) return null;
  const publicado = aviso ? lerData(aviso.publicadoEm) : null;
  const validadeData = aviso?.validade ? lerData(aviso.validade) : null;
  // Na edição, o quadro já mostra a cor e o tamanho escolhidos (prévia).
  const corAtiva = editando ? cor : aviso?.cor || "padrao";
  const fonteAtiva = editando ? fonte : aviso?.fonte || "normal";

  return (
    <section
      className={`panel qg-aviso${importante && !editando ? " qg-aviso--importante" : ""}${noTopo ? " qg-aviso--topo" : ""}${noTopo && aviso && !editando ? " qg-aviso--publicado" : ""}`}
      data-cor={corAtiva}
      data-fonte={fonteAtiva}
      aria-labelledby="qg-aviso-titulo"
    >
      <header className="qg-aviso-head">
        <Megaphone size={18} strokeWidth={1.6} />
        <h2 id="qg-aviso-titulo">Aviso da Coordenação</h2>
        {importante && !editando ? <span className="qg-selo qg-selo--importante">importante</span> : null}
        {aviso && !editando ? (
          <span className="qg-aviso-meta">
            {aviso.autor ? `${aviso.autor} · ` : ""}
            {publicado ? `${ddmm(publicado)} às ${horaCurta(publicado)}` : ""}
            {validadeData ? ` · válido até ${ddmm(validadeData)}` : ""}
          </span>
        ) : null}
        <span className="qg-aviso-acoes">
          {estado.podeEditar && !editando ? (
            <>
              {aviso ? (
                <button type="button" className="btn-mini" onClick={() => abrirEditor(false)} disabled={salvando}>
                  <Pencil size={13} strokeWidth={1.6} /> Editar
                </button>
              ) : null}
              <button type="button" className="btn-mini" onClick={() => abrirEditor(true)} disabled={salvando}>
                <Plus size={13} strokeWidth={1.6} /> Novo aviso
              </button>
              {aviso ? (
                <button type="button" className="btn-mini" onClick={() => void retirar()} disabled={salvando}>
                  <Trash2 size={13} strokeWidth={1.6} /> Retirar
                </button>
              ) : null}
            </>
          ) : null}
          {!editando ? (
            <button type="button" className="qg-icon-btn" onClick={() => void carregar()} aria-label="Atualizar aviso" title="Atualizar">
              <RefreshCw size={14} strokeWidth={1.6} />
            </button>
          ) : null}
          {!editando ? (
            <button
              type="button"
              className={`qg-icon-btn${recolhido ? " qg-icon-btn--recolhido" : ""}`}
              onClick={alternarRecolhido}
              aria-expanded={!recolhido}
              aria-label={recolhido ? "Mostrar o aviso" : "Recolher o aviso"}
              title={recolhido ? "Mostrar" : "Recolher"}
            >
              <ChevronDown size={15} strokeWidth={1.6} />
            </button>
          ) : null}
        </span>
      </header>

      {erro ? <p className="qg-erro">{erro}</p> : null}

      {editando ? (
        <div className="qg-aviso-editor">
          {!estado.guardaEstilo ? (
            <p className="qg-aviso-linha">Para guardar a cor e o tamanho do texto, rode no Supabase o SQL patch_aviso_coordenacao.sql atualizado.</p>
          ) : null}
          <RichTextEditor
            ariaLabel="Texto do Aviso da Coordenação"
            onChange={setConteudo}
            placeholder="Escreva o aviso para toda a equipe…"
            resetKey={editorKey}
            value={conteudo}
          />
          <div className="qg-aviso-opcoes">
            <label>
              Destaque
              <select value={nivel} onChange={(evento) => setNivel(evento.target.value as AvisoCoordenacaoNivel)}>
                <option value="normal">Normal</option>
                <option value="importante">Importante</option>
              </select>
            </label>
            <label>
              Tamanho do texto
              <select value={fonte} onChange={(evento) => setFonte(evento.target.value as AvisoCoordenacaoFonte)}>
                {AVISO_FONTES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="qg-aviso-cores-campo">
              <span id="qg-aviso-cor-rotulo">Cor do quadro</span>
              <div className="qg-aviso-cores" role="radiogroup" aria-labelledby="qg-aviso-cor-rotulo">
                {AVISO_CORES.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    role="radio"
                    aria-checked={cor === item.value}
                    aria-label={item.label}
                    title={item.label}
                    className={`qg-cor${cor === item.value ? " qg-cor--ativa" : ""}`}
                    data-cor={item.value}
                    onClick={() => setCor(item.value)}
                  />
                ))}
              </div>
            </div>
            <label>
              Válido até (opcional)
              <input type="date" value={validade} min={isoLocal(new Date())} onChange={(evento) => setValidade(evento.target.value)} />
            </label>
            {editarId ? (
              <label className="qg-aviso-check">
                <input type="checkbox" checked={notificar} onChange={(evento) => setNotificar(evento.target.checked)} />
                Notificar a equipe sobre esta alteração
              </label>
            ) : (
              <span className="qg-aviso-dica">Ao publicar, todos recebem uma notificação no sino.</span>
            )}
            <span className="qg-aviso-botoes">
              <button type="button" className="btn-mini" onClick={() => setEditando(false)} disabled={salvando}>
                Cancelar
              </button>
              <button type="button" className="btn-mini primary" onClick={() => void publicar()} disabled={salvando}>
                {salvando ? "Salvando…" : editarId ? "Salvar alterações" : "Publicar"}
              </button>
            </span>
          </div>
        </div>
      ) : recolhido ? null : (
        <div className="qg-aviso-corpo">
          {carregando && !aviso ? <p className="qg-vazio">Carregando…</p> : null}
          {!carregando && !aviso && !erro ? (
            <p className="qg-vazio">
              Nenhum aviso da Coordenação no momento.
              {estado.podeEditar ? " Use “Novo aviso” para escrever um recado a toda a equipe." : ""}
            </p>
          ) : null}
          {aviso ? <div className="qg-aviso-texto rich-text pauta-rich-text" dangerouslySetInnerHTML={{ __html: sanitizePautaRichHtml(aviso.conteudo) }} /> : null}
        </div>
      )}
    </section>
  );
}
