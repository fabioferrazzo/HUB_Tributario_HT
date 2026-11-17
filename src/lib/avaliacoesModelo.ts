// Avaliação por desempenho — modelo da planilha "AVALIAÇÃO POR DESEMPENHO - DEPTO de GESTÃO E PLANEJAMENTO TRIBUTÁRIO".
// Regras puras (sem acesso a banco), usadas pela tela, pelo modo demonstração e pelos testes.
// As mesmas regras são conferidas no banco (supabase/patch_avaliacoes_v4.sql).

export const AVALIACAO_TITULO = "Avaliação por desempenho - Depto de Gestão e Planejamento Tributário";
export const AVALIACAO_TITULO_PLANILHA = "AVALIAÇÃO POR DESEMPENHO - DEPTO de GESTÃO E PLANEJAMENTO TRIBUTÁRIO";

export const CRITERIOS = [
  { id: "producao", nome: "Produção", detalhe: "Tempo desperdiçado, qualidade do serviço entregue" },
  { id: "disposicoes", nome: "Disposições do coordenador", detalhe: "Diretrizes das reuniões, tarefas pós dia 20" },
  { id: "regras", nome: "Regras do escritório", detalhe: "Conforme o manual" },
  { id: "erros", nome: "Erros", detalhe: "Retrabalho, erros repetidos" },
  { id: "aprendizado", nome: "Aprendizado", detalhe: "Aprimoramento técnico, cursos, pesquisas, estudo etc." },
  { id: "atendimento", nome: "Atendimento ao cliente", detalhe: "Qualidade da informação passada, presteza e decoro profissional; relação com os colegas" },
  {
    id: "autonomia",
    nome: "Autonomia",
    detalhe: "“Faz sem perguntar”: pesquisar por si só antes de perguntar, seja na web, consultorias, suporte Domínio, legislação etc."
  }
] as const;

export type CriterioId = (typeof CRITERIOS)[number]["id"];

export const PERGUNTAS_FEEDBACK = [
  { id: "gosta", pergunta: "1) O que você mais gosta?" },
  { id: "naoGosta", pergunta: "2) O que você não gosta e gostaria de deixar de fazer?" },
  { id: "gostaria", pergunta: "3) Qual atividade que você não faz, mas gostaria de realizar, tendo em vista o seu perfil pessoal/profissional?" }
] as const;
export const FEEDBACK_INTRO = "Dentre as atividades que você realiza hoje:";

export type PerguntaId = (typeof PERGUNTAS_FEEDBACK)[number]["id"];

// Referência de notas da planilha ("Acima de").
export const ESCALA = [
  { minimo: 0, rotulo: "Péssimo" },
  { minimo: 2.5, rotulo: "Ruim" },
  { minimo: 5, rotulo: "Razoável" },
  { minimo: 7.5, rotulo: "Bom" },
  { minimo: 8.5, rotulo: "Muito bom" },
  { minimo: 10, rotulo: "Excelente" }
] as const;

export const LIMITES = {
  justificativa: 2000,
  texto: 4000,
  sugestoes: 10,
  recomendacoes: 5,
  replica: 4000
} as const;

export type Nota = { nota: number | null; justificativa: string };
export type Notas = Partial<Record<CriterioId, Nota>>;
export type Sugestao = { sugestao: string; justificativa: string };

export type ParteColaborador = {
  notas: Notas;
  sugestoes: Sugestao[];
  feedback: Partial<Record<PerguntaId, string>>;
};

export type ParteCoordenacao = {
  notas: Notas;
  subcoordenacao: Notas;
  pontosPositivos: string;
  aMelhorar: string;
  recomendacoes: string[];
};

export type Replica = {
  id: string;
  texto: string;
  enviadaEm: string;
  resposta?: string;
  respondidaEm?: string;
};

export type Evento = { em: string; por: string; acao: string; detalhe?: string };

export type AvaliacaoStatus = "rascunho" | "enviada" | "em_correcao" | "finalizada" | "replica";

export type Avaliacao = {
  id: string;
  userId: string;
  colaboradorNome: string;
  colaboradorEmail?: string;
  competencia: string; // AAAA-MM
  status: AvaliacaoStatus;
  colaborador: ParteColaborador;
  coordenacao: ParteCoordenacao | null; // null quando o colaborador ainda não pode ver
  replicas: Replica[];
  enviadaEm?: string;
  finalizadaEm?: string;
  updatedAt?: string;
  eventos?: Evento[]; // só para a coordenação
};

export type Papel = "colaborador" | "coordenacao";

export const STATUS_COLABORADOR: Record<AvaliacaoStatus, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada à coordenação",
  em_correcao: "Em correção pela coordenação",
  finalizada: "Avaliação finalizada",
  replica: "Réplica enviada"
};

export const STATUS_COORDENACAO: Record<AvaliacaoStatus, string> = {
  rascunho: "Rascunho do colaborador",
  enviada: "Aguardando correção",
  em_correcao: "Em correção",
  finalizada: "Finalizada",
  replica: "Réplica recebida"
};

// O colaborador vê a parte da coordenação só depois de finalizada (ou com réplica em andamento).
export function coordenacaoVisivelAoColaborador(status: AvaliacaoStatus) {
  return status === "finalizada" || status === "replica";
}

// ---------------------------------------------------------------------------------------------
// Competência

const RE_COMP = /^\d{4}-(0[1-9]|1[0-2])$/;
export function competenciaValida(c: string) {
  return RE_COMP.test(String(c || ""));
}
export function competenciaAtual(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
export function rotuloCompetencia(c: string) {
  return competenciaValida(c) ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : c;
}
export function somarMeses(c: string, n: number) {
  const total = Number(c.slice(0, 4)) * 12 + Number(c.slice(5, 7)) - 1 + n;
  return `${Math.floor(total / 12)}-${String((total % 12) + 1).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------------------------
// Notas e médias

export function notaValida(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 10;
}

// Lê o que foi digitado ("8,5", "10", "") — devolve null se vazio e NaN se inválido.
export function lerNota(valor: string): number | null {
  const t = String(valor ?? "").trim().replace(",", ".");
  if (!t) return null;
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(t)) return Number.NaN;
  const n = Number(t);
  return notaValida(n) ? n : Number.NaN;
}

// Média da coluna como na planilha: soma das 7 notas ÷ 7 (só quando os 7 critérios têm nota).
export function media(notas: Notas | undefined): number | null {
  const valores = CRITERIOS.map((c) => notas?.[c.id]?.nota);
  if (valores.some((v) => !notaValida(v))) return null;
  return (valores as number[]).reduce((s, n) => s + n, 0) / CRITERIOS.length;
}

export function notasPreenchidas(notas: Notas | undefined) {
  return CRITERIOS.filter((c) => notaValida(notas?.[c.id]?.nota)).length;
}

export function temAlgumaNota(notas: Notas | undefined) {
  return notasPreenchidas(notas) > 0 || CRITERIOS.some((c) => (notas?.[c.id]?.justificativa || "").trim());
}

export function faixa(n: number | null | undefined) {
  if (!notaValida(n)) return "";
  let rotulo: string = ESCALA[0].rotulo;
  for (const f of ESCALA) if (n >= f.minimo) rotulo = f.rotulo;
  return rotulo;
}

export function formatarNota(n: number | null | undefined, casas = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: casas });
}

// "Preencher tudo com nota 10": mantém as justificativas já escritas.
export function preencherCom10(notas: Notas | undefined): Notas {
  const out: Notas = {};
  for (const c of CRITERIOS) out[c.id] = { nota: 10, justificativa: notas?.[c.id]?.justificativa || "" };
  return out;
}

// ---------------------------------------------------------------------------------------------
// Estruturas vazias, limpeza e validação

export function colaboradorVazio(): ParteColaborador {
  return { notas: {}, sugestoes: [{ sugestao: "", justificativa: "" }, { sugestao: "", justificativa: "" }], feedback: {} };
}

export function coordenacaoVazia(): ParteCoordenacao {
  return { notas: {}, subcoordenacao: {}, pontosPositivos: "", aMelhorar: "", recomendacoes: ["", "", "", "", ""] };
}

function limparTexto(t: unknown, max: number) {
  return String(t ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

export function limparNotas(notas: Notas | undefined): Notas {
  const out: Notas = {};
  for (const c of CRITERIOS) {
    const n = notas?.[c.id];
    if (!n) continue;
    const nota = notaValida(n.nota) ? Math.round(n.nota * 100) / 100 : null;
    const justificativa = limparTexto(n.justificativa, LIMITES.justificativa);
    if (nota !== null || justificativa) out[c.id] = { nota, justificativa };
  }
  return out;
}

export function limparColaborador(p: Partial<ParteColaborador> | undefined): ParteColaborador {
  const sugestoes = (p?.sugestoes || [])
    .map((s) => ({ sugestao: limparTexto(s?.sugestao, LIMITES.texto), justificativa: limparTexto(s?.justificativa, LIMITES.texto) }))
    .filter((s) => s.sugestao || s.justificativa)
    .slice(0, LIMITES.sugestoes);
  const feedback: ParteColaborador["feedback"] = {};
  for (const q of PERGUNTAS_FEEDBACK) {
    const t = limparTexto(p?.feedback?.[q.id], LIMITES.texto);
    if (t) feedback[q.id] = t;
  }
  return { notas: limparNotas(p?.notas), sugestoes, feedback };
}

export function limparCoordenacao(p: Partial<ParteCoordenacao> | undefined): ParteCoordenacao {
  return {
    notas: limparNotas(p?.notas),
    subcoordenacao: limparNotas(p?.subcoordenacao),
    pontosPositivos: limparTexto(p?.pontosPositivos, LIMITES.texto),
    aMelhorar: limparTexto(p?.aMelhorar, LIMITES.texto),
    recomendacoes: (p?.recomendacoes || []).map((r) => limparTexto(r, LIMITES.texto)).filter(Boolean).slice(0, LIMITES.recomendacoes)
  };
}

// Erros que impedem "Salvar para a coordenação".
export function errosEnvio(p: ParteColaborador): string[] {
  const erros: string[] = [];
  const faltam = CRITERIOS.filter((c) => !notaValida(p.notas?.[c.id]?.nota)).map((c) => c.nome);
  if (faltam.length) erros.push(`Informe a nota (de 0 a 10) de: ${faltam.join(", ")}.`);
  return erros;
}

// Erros que impedem "Finalizar avaliação" (campos obrigatórios da planilha: notas do coordenador, itens 1 e 2).
export function errosFinalizacao(p: ParteCoordenacao): string[] {
  const erros: string[] = [];
  const faltam = CRITERIOS.filter((c) => !notaValida(p.notas?.[c.id]?.nota)).map((c) => c.nome);
  if (faltam.length) erros.push(`Informe a nota do coordenador de: ${faltam.join(", ")}.`);
  const sub = notasPreenchidas(p.subcoordenacao);
  if (sub > 0 && sub < CRITERIOS.length) erros.push("A subcoordenação é opcional, mas, se usada, precisa de nota nos 7 critérios.");
  if (!p.pontosPositivos.trim()) erros.push("Preencha o item 1 — Pontos positivos.");
  if (!p.aMelhorar.trim()) erros.push("Preencha o item 2 — A melhorar/Sugestões.");
  return erros;
}

// ---------------------------------------------------------------------------------------------
// Ações permitidas por situação e papel (o banco confere as mesmas regras)

export type Acao =
  | "editarColaborador" // salvar rascunho
  | "enviar" // salvar para a coordenação
  | "excluir"
  | "corrigir" // salvar a correção sem finalizar
  | "finalizar"
  | "reabrir"
  | "devolver" // volta para o colaborador ajustar
  | "replica"
  | "responderReplica";

export function podeAcao(acao: Acao, status: AvaliacaoStatus | null, papel: Papel): boolean {
  const s = status;
  if (papel === "colaborador") {
    if (acao === "editarColaborador" || acao === "enviar") return s === null || s === "rascunho";
    if (acao === "excluir") return s === "rascunho";
    if (acao === "replica") return s === "finalizada";
    return false;
  }
  switch (acao) {
    case "corrigir":
    case "finalizar":
    case "devolver":
      return s === "enviada" || s === "em_correcao";
    case "reabrir":
      return s === "finalizada" || s === "replica";
    case "responderReplica":
      return s === "replica";
    case "excluir":
      return s !== null;
    default:
      return false;
  }
}

export function ultimaReplica(a: Pick<Avaliacao, "replicas">): Replica | null {
  return a.replicas.length ? a.replicas[a.replicas.length - 1] : null;
}

export function nomeArquivo(a: Pick<Avaliacao, "colaboradorNome" | "competencia">, ext: "xlsx" | "pdf") {
  const nome = a.colaboradorNome.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w\- ]+/g, "").trim().replace(/\s+/g, " ");
  return `AVALIACAO - ${nome || "colaborador"} ${a.competencia.slice(5, 7)}.${a.competencia.slice(0, 4)}.${ext}`;
}
