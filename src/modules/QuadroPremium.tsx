import type { ReactNode } from "react";
import {
  ArrowUpRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  Landmark,
  LayoutGrid,
  Moon,
  Palette,
  Pencil,
  StickyNote,
  Sun,
  Trash2,
  Type
} from "lucide-react";
import type { HubProfile, HubRoute, HubUser, Pauta, QuadroAviso, TaskItem } from "../types";
import type { AgendaSemana } from "../lib/agendaSemana";
import { AGENDA_CATEGORIA_ROTULO } from "../lib/agendaSemana";
import { formatResponsaveis, parseBrazilianDate } from "../lib/formatters";
import { isPautaAlta } from "../lib/hubRules";
import { pautaRichTextToPlain } from "../lib/richText";
import { abrirPersonalizarVisual, salvarVisualPremium, type TamanhoPremium, type TemaPremium } from "../lib/visualPremium";
import "./quadroPremium.css";

// Quadro geral no visual premium (padrão da equipe).
// Usa os mesmos dados e as mesmas ações do Quadro geral atual; muda só a apresentação:
// grade em blocos, vidro fosco e luzes, tema escuro ou claro e texto compacto ou ampliado.

type Acoes = { onEditar: () => void; onExcluir: () => void; excluindo: boolean };
type ItemData<T> = { data: Date } & T;

export type QuadroPremiumProps = {
  user: HubUser;
  hubUsers: HubProfile[];
  onNavigate: (route: HubRoute) => void;
  onSair: () => void;
  tema: TemaPremium;
  tamanho: TamanhoPremium;
  avisoCoordenacao: ReactNode;
  semana: Date;
  fimSemana: Date;
  dias: Date[];
  ehSemanaAtual: boolean;
  onSemanaAnterior: () => void;
  onProximaSemana: () => void;
  onHoje: () => void;
  carregando: { pautas: boolean; tarefas: boolean; agenda: boolean };
  erros: { pautas: string; tarefas: string; agenda: string };
  pautasAbertas: Pauta[];
  pautasSemana: Array<ItemData<{ pauta: Pauta }>>;
  pautasAtrasadas: Array<ItemData<{ pauta: Pauta }>>;
  avisosGerais: QuadroAviso[];
  tarefasPorDia: Map<string, Array<ItemData<{ tarefa: TaskItem }>>>;
  tarefasAtrasadas: Array<ItemData<{ tarefa: TaskItem }>>;
  totalTarefasSemana: number;
  agenda: AgendaSemana | null;
  rotaAgenda: HubRoute | null;
  acoesPauta: (pauta: Pauta) => Acoes | undefined;
  acoesTarefa: (tarefa: TaskItem) => Acoes | undefined;
  acoesAviso: (aviso: QuadroAviso) => Acoes | undefined;
  resumoAviso: (aviso: QuadroAviso) => string;
};

const DIAS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
const DIAS_LONGOS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
function iso(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

function ddmm(data: Date) {
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function rotuloDia(data: Date) {
  return `${DIAS[data.getDay()]} ${ddmm(data)}`;
}

function semanaIso(data: Date) {
  const d = new Date(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()));
  const dia = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dia);
  const inicioAno = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil(((d.getTime() - inicioAno.getTime()) / 86400000 + 1) / 7);
}

function saudacao(agora: Date) {
  const hora = agora.getHours();
  if (hora < 12) return "Bom dia";
  if (hora < 18) return "Boa tarde";
  return "Boa noite";
}

function temHora(valor: string) {
  return /T\d{2}:\d{2}|\s\d{2}:\d{2}/.test(valor) && !/T00:00(:00)?/.test(valor);
}

function horaCurta(data: Date) {
  return `${String(data.getHours()).padStart(2, "0")}:${String(data.getMinutes()).padStart(2, "0")}`;
}

function lerPrazo(valor: string) {
  if (!valor) return null;
  const data = parseBrazilianDate(valor) || new Date(valor);
  return Number.isNaN(data.getTime()) ? null : data;
}

function prazoCurto(valor: string) {
  const data = lerPrazo(valor);
  if (!data || Number.isNaN(data.getTime())) return "sem prazo";
  return `${String(data.getDate()).padStart(2, "0")}/${String(data.getMonth() + 1).padStart(2, "0")}`;
}

function plural(n: number, um: string, varios: string) {
  return n === 1 ? um : varios;
}

export function QuadroPremium(props: QuadroPremiumProps) {
  const {
    user,
    hubUsers,
    onNavigate,
    onSair,
    avisoCoordenacao,
    semana,
    fimSemana,
    dias,
    ehSemanaAtual,
    carregando,
    erros,
    pautasAbertas,
    pautasSemana,
    pautasAtrasadas,
    avisosGerais,
    tarefasPorDia,
    tarefasAtrasadas,
    totalTarefasSemana,
    agenda,
    rotaAgenda,
    tema,
    tamanho
  } = props;

  function alternarTema() {
    salvarVisualPremium({ tema: tema === "escuro" ? "claro" : "escuro" });
  }

  function alternarTamanho() {
    salvarVisualPremium({ tamanho: tamanho === "compacto" ? "ampliado" : "compacto" });
  }

  const agora = new Date();
  const hoje = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate());
  const primeiroNome = (user.nome || user.email).trim().split(/\s+/)[0];

  // ---- Pautas
  const pautasAltas = pautasAbertas.filter((pauta) => isPautaAlta(pauta)).length;
  const idsAtrasadas = new Set(pautasAtrasadas.map((item) => item.pauta.id));
  const ehPautaAtrasada = (pauta: Pauta) => idsAtrasadas.has(pauta.id);
  // Ordem da lista: destaques, atrasadas, prioridade alta e, por fim, prazo mais próximo (sem prazo no fim).
  const pautasOrdenadas = [...pautasAbertas].sort((a, b) => {
    const peso = (p: Pauta) => (p.destaque ? 0 : 4) + (ehPautaAtrasada(p) ? 0 : 2) + (isPautaAlta(p) ? 0 : 1);
    const diferenca = peso(a) - peso(b);
    if (diferenca) return diferenca;
    const prazoA = lerPrazo(a.prazo)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    const prazoB = lerPrazo(b.prazo)?.getTime() ?? Number.MAX_SAFE_INTEGER;
    return prazoA - prazoB;
  });
  const listaPautas = [...pautasAtrasadas.map((item) => ({ ...item, atrasada: true })), ...pautasSemana.map((item) => ({ ...item, atrasada: false }))];

  // ---- Agenda tributária (dias úteis sempre; sábado e domingo só se tiverem vencimento)
  const itensPorDia = new Map((agenda?.dias || []).map((dia) => [dia.data, dia.itens]));
  const diasFaixa = dias.filter((dia) => {
    const fimDeSemana = dia.getDay() === 0 || dia.getDay() === 6;
    return !fimDeSemana || (itensPorDia.get(iso(dia)) || []).length > 0;
  });
  const vencimentos = dias.flatMap((dia) => (itensPorDia.get(iso(dia)) || []).map((item) => ({ dia, item })));
  const LIMITE_AGENDA = 6;

  // ---- Tarefas
  const tarefasSemana = dias.flatMap((dia) => tarefasPorDia.get(iso(dia)) || []);
  const listaTarefas = [
    ...tarefasAtrasadas.map((item) => ({ ...item, atrasada: true })),
    ...tarefasSemana.map((item) => ({ ...item, atrasada: item.data < hoje }))
  ];
  const LIMITE_TAREFAS = 7;
  const totalAtrasadas = listaTarefas.filter((item) => item.atrasada).length;

  const rotuloSemana = `Semana de ${ddmm(semana)} a ${ddmm(fimSemana)}`;
  const contagem = (pronto: boolean, valor: string) => (pronto ? valor : "…");

  return (
    <div className={`qp qp--${tema} qp--${tamanho}`} data-tema={tema} data-tamanho={tamanho}>
      <div className="qp-orbes" aria-hidden="true">
        <i className="qp-orbe qp-orbe--1" />
        <i className="qp-orbe qp-orbe--2" />
        <i className="qp-orbe qp-orbe--3" />
        <i className="qp-orbe qp-orbe--b1" />
        <i className="qp-orbe qp-orbe--b3" />
        <i className="qp-orbe qp-orbe--b2" />
      </div>

      <div className="qp-conteudo">
        <header className="qp-topo">
          <div className="qp-topo-texto">
            <span className="qp-rotulo">
              {DIAS_LONGOS[agora.getDay()]} · {agora.getDate()} {MESES[agora.getMonth()]} {agora.getFullYear()} · Semana {semanaIso(semana)}
            </span>
            <h1>
              {saudacao(agora)}, <strong>{primeiroNome}</strong>
            </h1>
          </div>
          <div className="qp-topo-acoes">
            <div className="qp-semana" role="group" aria-label="Semana exibida">
              <button type="button" className="qp-icone" onClick={props.onSemanaAnterior} aria-label="Semana anterior" title="Semana anterior">
                <ChevronLeft size={18} strokeWidth={1.6} />
              </button>
              <span className="qp-semana-rotulo">
                {rotuloSemana}
                {ehSemanaAtual ? <em>atual</em> : null}
              </span>
              <button type="button" className="qp-icone" onClick={props.onProximaSemana} aria-label="Próxima semana" title="Próxima semana">
                <ChevronRight size={18} strokeWidth={1.6} />
              </button>
              {!ehSemanaAtual ? (
                <button type="button" className="qp-botao" onClick={props.onHoje}>
                  Hoje
                </button>
              ) : null}
            </div>
            <button
              type="button"
              className="qp-icone qp-icone--grande"
              onClick={alternarTamanho}
              aria-pressed={tamanho === "ampliado"}
              aria-label={tamanho === "ampliado" ? "Usar texto compacto" : "Aumentar o texto"}
              title={tamanho === "ampliado" ? "Usar texto compacto" : "Aumentar o texto"}
            >
              <Type size={19} strokeWidth={1.6} />
            </button>
            <button
              type="button"
              className="qp-icone qp-icone--grande"
              onClick={alternarTema}
              aria-label={tema === "escuro" ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
              title={tema === "escuro" ? "Mudar para o tema claro" : "Mudar para o tema escuro"}
            >
              {tema === "escuro" ? <Sun size={19} strokeWidth={1.6} /> : <Moon size={19} strokeWidth={1.6} />}
            </button>
            <button
              type="button"
              className="qp-icone qp-icone--grande"
              onClick={abrirPersonalizarVisual}
              aria-label="Personalizar visual"
              title="Personalizar visual (cores, luzes, degradê, sombra)"
            >
              <Palette size={19} strokeWidth={1.6} />
            </button>
            <button type="button" className="qp-botao" onClick={onSair} title="Usar o visual clássico do HUB">
              <LayoutGrid size={15} strokeWidth={1.6} /> Visual clássico
            </button>
          </div>
        </header>

        {/* Aviso da Coordenação: faixa de destaque no alto, para toda a equipe ver primeiro */}
        <div className="qp-aviso-topo">{avisoCoordenacao}</div>

        <div className="qp-bento">
          {/* ------------------------------------------------------------ A · Pautas abertas */}
          <section className="qp-cartao qp-A" aria-labelledby="qp-pautas-num">
            <div className="qp-A-brilho" aria-hidden="true" />
            <div className="qp-A-topo">
              <span className="qp-rotulo qp-rotulo--urgente">Pautas · Coordenação</span>
              <button type="button" className="qp-abrir" onClick={() => onNavigate("pautas")} aria-label="Abrir Pautas">
                Abrir <ArrowUpRight size={14} strokeWidth={1.6} />
              </button>
            </div>
            <div className="qp-A-numero" id="qp-pautas-num">
              <span className="qp-numero-gigante">{carregando.pautas ? "…" : pautasAbertas.length}</span>
              <span className="qp-numero-legenda">{plural(pautasAbertas.length, "pauta aberta", "pautas abertas")}</span>
            </div>
            {erros.pautas ? <p className="qp-erro">{erros.pautas}</p> : null}
            {!carregando.pautas && !pautasAbertas.length && !erros.pautas ? <p className="qp-vazio">Nenhuma pauta aberta.</p> : null}
            {pautasAbertas.length ? (
              <ol className="qp-A-lista" aria-label="Pautas abertas">
                {pautasOrdenadas.map((pauta) => {
                  const atrasada = ehPautaAtrasada(pauta);
                  const alta = isPautaAlta(pauta);
                  return (
                    <li
                      className={`qp-A-item${pauta.destaque ? " qp-A-item--destaque" : ""}${atrasada ? " qp-A-item--atrasada" : ""}`}
                      key={pauta.id}
                    >
                      <button type="button" onClick={() => onNavigate("pautas")} title="Abrir em Pautas">
                        <span className="qp-A-item-titulo">{pauta.tema || "(sem título)"}</span>
                        <span className="qp-A-item-meta">
                          {pauta.destaque ? <span className="qp-A-selo qp-A-selo--destaque">Destaque</span> : null}
                          {alta ? <span className="qp-A-selo qp-A-selo--alta">Alta</span> : null}
                          {atrasada ? <span className="qp-A-selo qp-A-selo--atrasada">Atrasada</span> : null}
                          <span className="qp-A-prazo">{prazoCurto(pauta.prazo)}</span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ol>
            ) : null}
            <dl className="qp-A-linhas">
              <div>
                <dt>{ehSemanaAtual ? "Vencem nesta semana" : "Vencem na semana exibida"}</dt>
                <dd className={pautasSemana.length ? "qp-urgente" : undefined}>{contagem(!carregando.pautas, String(pautasSemana.length))}</dd>
              </div>
              {ehSemanaAtual ? (
                <div>
                  <dt>Atrasadas</dt>
                  <dd className={pautasAtrasadas.length ? "qp-urgente" : undefined}>{contagem(!carregando.pautas, String(pautasAtrasadas.length))}</dd>
                </div>
              ) : null}
              <div>
                <dt>Prioridade alta</dt>
                <dd>{contagem(!carregando.pautas, String(pautasAltas))}</dd>
              </div>
            </dl>
          </section>

          {/* ------------------------------------------------------------ B · Agenda tributária */}
          <section className="qp-cartao qp-B qp-tinta-azul" aria-labelledby="qp-agenda-titulo">
            <CabecalhoCartao
              rotulo={`Agenda tributária · Semana ${semanaIso(semana)}`}
              titulo="Vencimentos da semana"
              tituloId="qp-agenda-titulo"
              icone={<Landmark size={15} strokeWidth={1.6} />}
              abrir={rotaAgenda ? () => onNavigate(rotaAgenda) : undefined}
              abrirRotulo="Abrir a Agenda tributária"
            />
            <div className="qp-dias">
              {diasFaixa.map((dia) => {
                const qtd = (itensPorDia.get(iso(dia)) || []).length;
                const ehHoje = iso(dia) === iso(hoje);
                return (
                  <div key={iso(dia)} className={`qp-dia${ehHoje ? " qp-dia--hoje" : ""}${dia < hoje ? " qp-dia--passado" : ""}`}>
                    <span className="qp-dia-semana">{DIAS[dia.getDay()]}</span>
                    <span className="qp-dia-numero">{String(dia.getDate()).padStart(2, "0")}</span>
                    <span className="qp-dia-pontos" aria-label={`${qtd} ${plural(qtd, "vencimento", "vencimentos")}`}>
                      {Array.from({ length: Math.min(qtd, 4) }, (_, i) => (
                        <i key={i} />
                      ))}
                    </span>
                  </div>
                );
              })}
            </div>
            {erros.agenda ? <p className="qp-erro">{erros.agenda}</p> : null}
            {agenda?.mesesSemDados.length ? (
              <p className="qp-vazio">Agenda de {agenda.mesesSemDados.join(" e ")} ainda não disponível. Atualize pelo app Agenda tributária.</p>
            ) : null}
            {!carregando.agenda && agenda && !agenda.mesesSemDados.length && !vencimentos.length ? <p className="qp-vazio">Nenhum vencimento nesta semana.</p> : null}
            <ul className="qp-lista">
              {vencimentos.slice(0, LIMITE_AGENDA).map(({ dia, item }, indice) => (
                <li key={`${iso(dia)}-${indice}`} className="qp-linha qp-linha--agenda">
                  <span className="qp-prazo">{rotuloDia(dia)}</span>
                  <span className="qp-linha-titulo">{item.titulo}</span>
                  <span className="qp-etiqueta">{AGENDA_CATEGORIA_ROTULO[item.cat] || item.cat}</span>
                </li>
              ))}
            </ul>
            {vencimentos.length > LIMITE_AGENDA && rotaAgenda ? (
              <button type="button" className="qp-link" onClick={() => onNavigate(rotaAgenda)}>
                +{vencimentos.length - LIMITE_AGENDA} {plural(vencimentos.length - LIMITE_AGENDA, "vencimento", "vencimentos")} na Agenda tributária
              </button>
            ) : null}
            {agenda?.fonte ? (
              <p className="qp-fonte">
                Fonte: {agenda.fonte}
                {agenda.atualizado ? ` · atualizado em ${agenda.atualizado}` : ""}
              </p>
            ) : null}
          </section>


          {/* ------------------------------------------------------------ D · Quadro de Avisos */}
          <section className="qp-cartao qp-D qp-tinta-verde" aria-labelledby="qp-avisos-titulo">
            <CabecalhoCartao
              rotulo="Quadro de avisos"
              titulo="Avisos recentes"
              tituloId="qp-avisos-titulo"
              icone={<StickyNote size={15} strokeWidth={1.6} />}
              abrir={() => onNavigate("pautas")}
              abrirRotulo="Abrir o Quadro de Avisos"
            />
            {!carregando.pautas && !avisosGerais.length ? <p className="qp-vazio">Nenhum aviso geral no quadro.</p> : null}
            <ul className="qp-lista">
              {avisosGerais.map((aviso) => {
                const acoes = props.acoesAviso(aviso);
                const resumo = props.resumoAviso(aviso);
                return (
                  <li key={aviso.id} className="qp-linha qp-linha--aviso">
                    <span className="qp-ponto" style={aviso.color ? { background: aviso.color, boxShadow: `0 0 10px ${aviso.color}` } : undefined} aria-hidden="true" />
                    <span className="qp-linha-titulo">{resumo}</span>
                    <span className="qp-prazo qp-prazo--neutro">{formatarCurta(aviso.updatedAt || aviso.createdAt)}</span>
                    {acoes ? <AcoesLinha {...acoes} rotulo={`o aviso ${resumo}`} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>

          {/* ------------------------------------------------------------ E · Tarefas */}
          <section className="qp-cartao qp-E qp-tinta-azul" aria-labelledby="qp-tarefas-titulo">
            <CabecalhoCartao
              rotulo={`Calendário · ${carregando.tarefas ? "…" : `${listaTarefas.length} ${plural(listaTarefas.length, "aberta", "abertas")}`}`}
              titulo="Tarefas da semana"
              tituloId="qp-tarefas-titulo"
              icone={<CalendarDays size={15} strokeWidth={1.6} />}
              abrir={() => onNavigate("tarefas")}
              abrirRotulo="Abrir o Calendário de Tarefas"
            />
            {erros.tarefas ? <p className="qp-erro">{erros.tarefas}</p> : null}
            {!carregando.tarefas && !listaTarefas.length ? <p className="qp-vazio">Nenhuma tarefa com prazo nesta semana.</p> : null}
            <ul className="qp-lista">
              {listaTarefas.slice(0, LIMITE_TAREFAS).map(({ tarefa, data, atrasada }) => {
                const acoes = props.acoesTarefa(tarefa);
                const titulo = tarefa.titulo || "Tarefa sem título";
                const responsaveis = tarefa.responsaveis?.length ? formatResponsaveis(tarefa.responsaveis, hubUsers) : "Sem responsável";
                return (
                  <li key={tarefa.id} className={`qp-linha qp-linha--tarefa${atrasada ? " qp-linha--atrasada" : ""}`}>
                    <span className={`qp-ponto${atrasada || tarefa.prioridade === "alta" ? " qp-ponto--urgente" : ""}`} aria-hidden="true" />
                    <span className="qp-linha-bloco">
                      <span className="qp-linha-titulo">{titulo}</span>
                      <span className="qp-linha-sub">{responsaveis}</span>
                    </span>
                    <span className={`qp-prazo${atrasada ? " qp-prazo--urgente" : ""}`}>
                      {atrasada ? "Atrasada · " : ""}
                      {rotuloDia(data)}
                      {temHora(tarefa.prazo) ? ` ${horaCurta(data)}` : ""}
                    </span>
                    {acoes ? <AcoesLinha {...acoes} rotulo={`a tarefa ${titulo}`} /> : null}
                  </li>
                );
              })}
            </ul>
            {listaTarefas.length > LIMITE_TAREFAS ? (
              <button type="button" className="qp-link" onClick={() => onNavigate("tarefas")}>
                +{listaTarefas.length - LIMITE_TAREFAS} {plural(listaTarefas.length - LIMITE_TAREFAS, "tarefa", "tarefas")} no calendário
              </button>
            ) : null}
          </section>

          {/* ------------------------------------------------------------ F · Semana em números */}
          <section className="qp-cartao qp-F qp-tinta-ciano" aria-labelledby="qp-numeros-titulo">
            <span className="qp-rotulo" id="qp-numeros-titulo">
              Semana em números
            </span>
            <Numero rotulo="Tarefas atrasadas" valor={contagem(!carregando.tarefas, String(totalAtrasadas))} urgente={totalAtrasadas > 0} />
            <Numero rotulo="Tarefas na semana" valor={contagem(!carregando.tarefas, String(totalTarefasSemana))} />
            <Numero rotulo="Vencimentos na agenda" valor={contagem(!carregando.agenda, String(vencimentos.length))} />
          </section>

          {/* ------------------------------------------------------------ G · Lista de pautas */}
          <section className="qp-cartao qp-G qp-tinta-neutra" aria-labelledby="qp-lista-pautas-titulo">
            <CabecalhoCartao
              rotulo="Pautas · Coordenação"
              titulo={ehSemanaAtual ? "Pautas da semana e atrasadas" : "Pautas da semana"}
              tituloId="qp-lista-pautas-titulo"
              icone={<ClipboardList size={15} strokeWidth={1.6} />}
              abrir={() => onNavigate("pautas")}
              abrirRotulo="Abrir todas as pautas"
            />
            {erros.pautas ? <p className="qp-erro">{erros.pautas}</p> : null}
            {!carregando.pautas && !listaPautas.length ? <p className="qp-vazio">Nenhuma pauta com prazo nesta semana.</p> : null}
            <ul className="qp-lista">
              {listaPautas.map(({ pauta, data, atrasada }) => {
                const acoes = props.acoesPauta(pauta);
                const titulo = pauta.tema?.trim() || pautaRichTextToPlain(pauta.acoes).slice(0, 120) || "Pauta sem título";
                const responsaveis = pauta.responsaveis?.length
                  ? formatResponsaveis(pauta.responsaveis, hubUsers)
                  : pauta.scope === "todos"
                    ? "Todos"
                    : pauta.responsavel;
                const alta = isPautaAlta(pauta);
                return (
                  <li key={pauta.id} className={`qp-linha qp-linha--pauta${atrasada ? " qp-linha--atrasada" : ""}`}>
                    <span
                      className={`qp-ponto${alta || atrasada ? " qp-ponto--urgente" : ""}`}
                      title={atrasada ? "Atrasada" : alta ? "Prioridade alta" : "Prioridade normal"}
                      aria-hidden="true"
                    />
                    <span className="qp-linha-titulo">
                      {pauta.destaque ? <span className="qp-selo">destaque</span> : null}
                      {titulo}
                    </span>
                    <span className="qp-etiqueta">{responsaveis || ""}</span>
                    <span className={`qp-prazo${atrasada ? " qp-prazo--urgente" : ""}`}>
                      {atrasada ? "Atrasada · " : ""}
                      {rotuloDia(data)}
                    </span>
                    {acoes ? <AcoesLinha {...acoes} rotulo={`a pauta ${titulo}`} /> : null}
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}

function formatarCurta(valor: string) {
  const texto = String(valor || "");
  const m = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[3]}/${m[2]}`;
  const br = texto.match(/^(\d{2})\/(\d{2})/);
  return br ? `${br[1]}/${br[2]}` : "";
}

function CabecalhoCartao({
  rotulo,
  titulo,
  tituloId,
  icone,
  abrir,
  abrirRotulo
}: {
  rotulo: string;
  titulo: string;
  tituloId: string;
  icone: ReactNode;
  abrir?: () => void;
  abrirRotulo: string;
}) {
  return (
    <header className="qp-cabecalho">
      <div className="qp-cabecalho-texto">
        <span className="qp-rotulo">
          {icone}
          {rotulo}
        </span>
        <h2 id={tituloId}>{titulo}</h2>
      </div>
      {abrir ? (
        <button type="button" className="qp-abrir" onClick={abrir} aria-label={abrirRotulo}>
          Abrir <ArrowUpRight size={14} strokeWidth={1.6} />
        </button>
      ) : null}
    </header>
  );
}

function Numero({ rotulo, valor, urgente }: { rotulo: string; valor: string; urgente?: boolean }) {
  return (
    <div className="qp-numero">
      <span className="qp-rotulo">{rotulo}</span>
      <span className={`qp-numero-valor${urgente ? " qp-urgente" : ""}`}>{valor}</span>
    </div>
  );
}

function AcoesLinha({ rotulo, onEditar, onExcluir, excluindo }: Acoes & { rotulo: string }) {
  return (
    <span className="qp-acoes">
      <button type="button" className="qp-icone qp-icone--mini" onClick={onEditar} aria-label={`Editar ${rotulo}`} title="Editar">
        <Pencil size={14} strokeWidth={1.6} />
      </button>
      <button
        type="button"
        className="qp-icone qp-icone--mini qp-icone--perigo"
        onClick={onExcluir}
        disabled={excluindo}
        aria-label={`Excluir ${rotulo}`}
        title="Excluir"
      >
        <Trash2 size={14} strokeWidth={1.6} />
      </button>
    </span>
  );
}
