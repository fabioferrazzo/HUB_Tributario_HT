// Avaliação por desempenho (modelo "AVALIAÇÃO POR DESEMPENHO - Depto de Gestão e Planejamento Tributário").
// Autoavaliação do colaborador + notas do coordenador (e, no futuro, da subcoordenação), recomendações
// em itens e réplica do colaborador a cada recomendação depois da devolução.
import type { HubUser } from "../types";
import { getSupabaseAccessToken } from "./auth";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

export const AVALIACAO_TITULO = "Avaliação por desempenho - Depto de Gestão e Planejamento Tributário";

export const AVALIACAO_CRITERIOS = [
  { id: "producao", nome: "Produção", detalhe: "Tempo desperdiçado, qualidade do serviço entregue" },
  { id: "disposicoes", nome: "Disposições do coordenador", detalhe: "Diretrizes das reuniões, tarefas pós dia 20" },
  { id: "regras", nome: "Regras do escritório", detalhe: "Conforme o manual do escritório" },
  { id: "erros", nome: "Erros", detalhe: "Retrabalho, erros repetidos" },
  { id: "aprendizado", nome: "Aprendizado", detalhe: "Aprimoramento técnico, cursos, pesquisas, estudo etc." },
  {
    id: "atendimento",
    nome: "Atendimento ao cliente",
    detalhe: "Qualidade da informação passada, presteza e decoro profissional; relação com os colegas"
  },
  {
    id: "autonomia",
    nome: "Autonomia",
    detalhe: "“Faz sem perguntar”: pesquisar por si só antes de perguntar (web, consultorias, suporte Domínio, legislação etc.)"
  }
] as const;

export type CriterioId = (typeof AVALIACAO_CRITERIOS)[number]["id"];

export const AVALIACAO_FEEDBACK = [
  { id: "gosta", pergunta: "Dentre as atividades que você realiza hoje, o que você mais gosta?" },
  { id: "naoGosta", pergunta: "O que você não gosta e gostaria de deixar de fazer?" },
  { id: "gostaria", pergunta: "Qual atividade você não faz, mas gostaria de realizar, tendo em vista o seu perfil pessoal e profissional?" },
  { id: "sugestoes", pergunta: "Sugestões e críticas" }
] as const;

export type FeedbackId = (typeof AVALIACAO_FEEDBACK)[number]["id"];

// Quantidade de campos de recomendação oferecidos ao abrir uma avaliação sem recomendações.
export const RECOMENDACOES_PADRAO = 5;

// Notas de referência: a faixa vale a partir do valor indicado ("acima de").
export const AVALIACAO_ESCALA = [
  { minimo: 0, rotulo: "Péssimo" },
  { minimo: 2.5, rotulo: "Ruim" },
  { minimo: 5, rotulo: "Razoável" },
  { minimo: 7.5, rotulo: "Bom" },
  { minimo: 8.5, rotulo: "Muito bom" },
  { minimo: 10, rotulo: "Excelente" }
] as const;

export type NotaJustificativa = { nota: number | null; justificativa: string };
export type NotasPorCriterio = Partial<Record<CriterioId, NotaJustificativa>>;
export type AvaliacaoStatus = "rascunho" | "enviada" | "devolvida";
export type Recomendacao = { id: string; texto: string };
export type TipoEmailAvaliacao = "envio" | "devolvida" | "replica";

export type AvaliacaoCoordenacao = {
  coordenador: NotasPorCriterio;
  subcoordenacao: NotasPorCriterio;
  recomendacoes: Recomendacao[];
  respostasFeedback: Partial<Record<FeedbackId, string>>; // resposta da coordenação a cada item do feedback
  updatedAt?: string;
};

export type Avaliacao = {
  id: string;
  userId: string;
  colaboradorNome: string;
  competencia: string; // MM/AAAA
  status: AvaliacaoStatus;
  autoavaliacao: NotasPorCriterio;
  feedback: Partial<Record<FeedbackId, string>>;
  replicas: Record<string, string>; // réplica do colaborador por recomendação (id da recomendação)
  replicasEm?: string;
  enviadaEm?: string;
  devolvidaEm?: string;
  corrigidaEm?: string;
  updatedAt?: string;
  coordenacao?: AvaliacaoCoordenacao;
};

export const STATUS_LABEL: Record<AvaliacaoStatus, string> = {
  rascunho: "Rascunho",
  enviada: "Enviada à coordenação",
  devolvida: "Avaliada pela coordenação"
};

export function getAvaliacoesSource(): "local" | "supabase" {
  return isSupabaseConfigured ? "supabase" : "local";
}

export function isAvaliador(user: HubUser) {
  return user.role === "admin";
}

export function mediaNotas(notas: NotasPorCriterio | undefined): number | null {
  const valores = AVALIACAO_CRITERIOS.map((c) => notas?.[c.id]?.nota).filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (!valores.length) return null;
  return valores.reduce((soma, n) => soma + n, 0) / valores.length;
}

// Média geral: média das médias disponíveis (autoavaliação, coordenador e subcoordenação, quando houver).
export function mediaGeral(medias: Array<number | null | undefined>): number | null {
  const valores = medias.filter((n): n is number => typeof n === "number" && !Number.isNaN(n));
  if (!valores.length) return null;
  return valores.reduce((soma, n) => soma + n, 0) / valores.length;
}

export function mediaGeralDaAvaliacao(avaliacao: Avaliacao, coordenacao = avaliacao.coordenacao): number | null {
  if (!coordenacao) return null;
  const coord = mediaNotas(coordenacao.coordenador);
  const sub = mediaNotas(coordenacao.subcoordenacao);
  if (coord === null && sub === null) return null;
  return mediaGeral([mediaNotas(avaliacao.autoavaliacao), coord, sub]);
}

export function faixaDaNota(nota: number | null): string {
  if (nota === null) return "";
  let rotulo: string = AVALIACAO_ESCALA[0].rotulo;
  for (const faixa of AVALIACAO_ESCALA) if (nota >= faixa.minimo) rotulo = faixa.rotulo;
  return rotulo;
}

export function formatNota(nota: number | null | undefined) {
  if (nota === null || nota === undefined || Number.isNaN(nota)) return "—";
  return nota.toLocaleString("pt-BR", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
}

export function competenciaAtual() {
  const hoje = new Date();
  return `${String(hoje.getMonth() + 1).padStart(2, "0")}/${hoje.getFullYear()}`;
}

export function competenciaParaInput(competencia: string) {
  const [mes, ano] = competencia.split("/");
  return ano && mes ? `${ano}-${mes}` : "";
}

export function inputParaCompetencia(valor: string) {
  const [ano, mes] = valor.split("-");
  return ano && mes ? `${mes}/${ano}` : "";
}

export function novaRecomendacao(texto = ""): Recomendacao {
  return { id: crypto.randomUUID(), texto };
}

export function novaAvaliacao(user: HubUser, competencia = competenciaAtual()): Avaliacao {
  return {
    id: crypto.randomUUID(),
    userId: user.id || user.email,
    colaboradorNome: user.nome || user.email,
    competencia,
    status: "rascunho",
    autoavaliacao: {},
    feedback: {},
    replicas: {}
  };
}

// ---------------------------------------------------------------------------------------------
// Repositório (Supabase ou, no modo demonstração, armazenamento local)

const LOCAL_KEY = "hub_avaliacoes";
const AVALIACAO_COLS =
  "id,user_id,colaborador_nome,competencia,status,autoavaliacao,feedback,replicas,replicas_em,enviada_em,devolvida_em,corrigida_em,updated_at";
const COORD_COLS = "avaliacao_id,coordenador,subcoordenacao,recomendacoes,recomendacoes_itens,feedback_respostas,updated_at";

type AvaliacaoRow = {
  id: string;
  user_id: string;
  colaborador_nome: string;
  competencia: string;
  status: AvaliacaoStatus;
  autoavaliacao: NotasPorCriterio | null;
  feedback: Avaliacao["feedback"] | null;
  replicas: Record<string, string> | null;
  replicas_em: string | null;
  enviada_em: string | null;
  devolvida_em: string | null;
  corrigida_em: string | null;
  updated_at: string | null;
};

type CoordenacaoRow = {
  avaliacao_id: string;
  coordenador: NotasPorCriterio | null;
  subcoordenacao: NotasPorCriterio | null;
  recomendacoes: string | null;
  recomendacoes_itens: Recomendacao[] | null;
  feedback_respostas: Partial<Record<FeedbackId, string>> | null;
  updated_at: string | null;
};

function sortAvaliacoes(items: Avaliacao[]) {
  const chave = (a: Avaliacao) => {
    const [mes, ano] = a.competencia.split("/");
    return `${ano}${mes}`;
  };
  return [...items].sort((a, b) => chave(b).localeCompare(chave(a)) || a.colaboradorNome.localeCompare(b.colaboradorNome, "pt-BR"));
}

// Recomendações antigas (texto livre, uma por linha) viram itens com identificador estável.
function itensDeRecomendacoes(itens: Recomendacao[] | null | undefined, texto: string | null | undefined, avaliacaoId: string): Recomendacao[] {
  const validos = (itens || []).filter((r) => r && typeof r.texto === "string" && r.texto.trim());
  if (validos.length) return validos.map((r) => ({ id: String(r.id || crypto.randomUUID()), texto: r.texto }));
  return String(texto || "")
    .split(/\r?\n/)
    .map((linha) => linha.trim())
    .filter(Boolean)
    .map((linha, i) => ({ id: `${avaliacaoId}-texto-${i + 1}`, texto: linha }));
}

function mapRow(row: AvaliacaoRow, coord?: CoordenacaoRow): Avaliacao {
  return {
    id: row.id,
    userId: row.user_id,
    colaboradorNome: row.colaborador_nome,
    competencia: row.competencia,
    status: row.status,
    autoavaliacao: row.autoavaliacao || {},
    feedback: row.feedback || {},
    replicas: row.replicas || {},
    replicasEm: row.replicas_em || undefined,
    enviadaEm: row.enviada_em || undefined,
    devolvidaEm: row.devolvida_em || undefined,
    corrigidaEm: row.corrigida_em || undefined,
    updatedAt: row.updated_at || undefined,
    coordenacao: coord
      ? {
          coordenador: coord.coordenador || {},
          subcoordenacao: coord.subcoordenacao || {},
          recomendacoes: itensDeRecomendacoes(coord.recomendacoes_itens, coord.recomendacoes, row.id),
          respostasFeedback: coord.feedback_respostas || {},
          updatedAt: coord.updated_at || undefined
        }
      : undefined
  };
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) throw new Error("Supabase não configurado.");
  return supabase;
}

function readLocal(): Avaliacao[] {
  return readStorage<Avaliacao[]>(LOCAL_KEY, []).map((a) => ({ ...a, replicas: a.replicas || {} }));
}

// Modo demonstração: aplica as mesmas regras de visibilidade do banco.
function visibleLocal(items: Avaliacao[], user: HubUser) {
  const meuId = user.id || user.email;
  return items
    .filter((a) => isAvaliador(user) || a.userId === meuId)
    .map((a) => (isAvaliador(user) || a.status === "devolvida" ? a : { ...a, coordenacao: undefined }));
}

export async function listAvaliacoes(user: HubUser): Promise<Avaliacao[]> {
  if (getAvaliacoesSource() === "local") return sortAvaliacoes(visibleLocal(readLocal(), user));

  const client = assertSupabase();
  const { data, error } = await client.from("avaliacoes").select(AVALIACAO_COLS);
  if (error) throw error;
  const rows = (data || []) as AvaliacaoRow[];
  const coordMap = new Map<string, CoordenacaoRow>();
  if (rows.length) {
    const { data: coord, error: coordError } = await client
      .from("avaliacoes_coordenacao")
      .select(COORD_COLS)
      .in(
        "avaliacao_id",
        rows.map((r) => r.id)
      );
    if (coordError) throw coordError;
    for (const item of (coord || []) as CoordenacaoRow[]) coordMap.set(item.avaliacao_id, item);
  }
  return sortAvaliacoes(rows.map((row) => mapRow(row, coordMap.get(row.id))));
}

// Colaborador: grava a própria autoavaliação (rascunho) ou envia (status "enviada").
export async function salvarAutoavaliacao(avaliacao: Avaliacao, user: HubUser, enviar: boolean): Promise<Avaliacao> {
  const status: AvaliacaoStatus = enviar ? "enviada" : "rascunho";

  if (getAvaliacoesSource() === "local") {
    const todas = readLocal();
    const atual = todas.find((a) => a.id === avaliacao.id);
    if (atual && atual.status !== "rascunho" && !isAvaliador(user)) throw new Error("Avaliação já enviada: somente a coordenação pode alterá-la.");
    const duplicada = todas.find((a) => a.id !== avaliacao.id && a.userId === avaliacao.userId && a.competencia === avaliacao.competencia);
    if (duplicada) throw new Error(`Já existe uma avaliação de ${avaliacao.competencia} para este colaborador.`);
    const now = new Date().toISOString();
    const salvo: Avaliacao = {
      ...avaliacao,
      replicas: atual?.replicas || {},
      coordenacao: atual?.coordenacao,
      status,
      updatedAt: now,
      enviadaEm: enviar ? now : avaliacao.enviadaEm
    };
    writeStorage(LOCAL_KEY, [salvo, ...todas.filter((a) => a.id !== avaliacao.id)]);
    return salvo;
  }

  const client = assertSupabase();
  const payload = {
    id: avaliacao.id,
    colaborador_nome: avaliacao.colaboradorNome,
    competencia: avaliacao.competencia,
    status,
    autoavaliacao: avaliacao.autoavaliacao,
    feedback: avaliacao.feedback
  };
  const { data: existente } = await client.from("avaliacoes").select("id").eq("id", avaliacao.id).maybeSingle();
  const query = existente
    ? client.from("avaliacoes").update(payload).eq("id", avaliacao.id)
    : client.from("avaliacoes").insert({ ...payload, user_id: avaliacao.userId });
  const { data, error } = await query.select(AVALIACAO_COLS);
  if (error) {
    if (String(error.message || "").includes("avaliacoes_user_id_competencia_key") || error.code === "23505") {
      throw new Error(`Você já tem uma avaliação de ${avaliacao.competencia}. Abra-a na lista para continuar.`);
    }
    throw error;
  }
  if (!data || !data.length) throw new Error("A avaliação não pôde ser salva (ela pode já ter sido enviada).");
  return mapRow(data[0] as AvaliacaoRow);
}

// Colaborador (dono da avaliação devolvida): grava as réplicas às recomendações da coordenação.
export async function salvarReplicas(avaliacao: Avaliacao, replicas: Record<string, string>, user: HubUser): Promise<Avaliacao> {
  const limpas = Object.fromEntries(Object.entries(replicas).filter(([, texto]) => texto.trim()));

  if (getAvaliacoesSource() === "local") {
    const todas = readLocal();
    const atual = todas.find((a) => a.id === avaliacao.id);
    if (!atual || atual.status !== "devolvida") throw new Error("As réplicas só podem ser registradas depois da devolução.");
    if (!isAvaliador(user) && atual.userId !== (user.id || user.email)) throw new Error("Sem permissão para esta avaliação.");
    const now = new Date().toISOString();
    const salvo: Avaliacao = { ...atual, replicas: limpas, replicasEm: now, updatedAt: now };
    writeStorage(LOCAL_KEY, [salvo, ...todas.filter((a) => a.id !== avaliacao.id)]);
    return salvo;
  }

  const client = assertSupabase();
  const { data, error } = await client.from("avaliacoes").update({ replicas: limpas }).eq("id", avaliacao.id).select(AVALIACAO_COLS);
  if (error) throw error;
  if (!data || !data.length) throw new Error("As réplicas não puderam ser salvas.");
  return mapRow(data[0] as AvaliacaoRow, undefined);
}

// Administrador: corrige a autoavaliação, lança as notas da coordenação e define a situação.
export async function salvarCoordenacao(avaliacao: Avaliacao, coordenacao: AvaliacaoCoordenacao, status: AvaliacaoStatus, user: HubUser): Promise<Avaliacao> {
  if (!isAvaliador(user)) throw new Error("Somente a coordenação pode avaliar.");
  const recomendacoes = coordenacao.recomendacoes.map((r) => ({ id: r.id, texto: r.texto.trim() })).filter((r) => r.texto);
  const respostasFeedback = Object.fromEntries(
    Object.entries(coordenacao.respostasFeedback || {}).filter(([, texto]) => typeof texto === "string" && texto.trim())
  ) as AvaliacaoCoordenacao["respostasFeedback"];
  const coordLimpa: AvaliacaoCoordenacao = { ...coordenacao, recomendacoes, respostasFeedback };

  if (getAvaliacoesSource() === "local") {
    const todas = readLocal();
    const now = new Date().toISOString();
    const atual = todas.find((a) => a.id === avaliacao.id);
    const corrigiu =
      atual && (JSON.stringify(atual.autoavaliacao) !== JSON.stringify(avaliacao.autoavaliacao) || JSON.stringify(atual.feedback) !== JSON.stringify(avaliacao.feedback));
    const salvo: Avaliacao = {
      ...avaliacao,
      replicas: atual?.replicas || avaliacao.replicas || {},
      status,
      coordenacao: { ...coordLimpa, updatedAt: now },
      updatedAt: now,
      devolvidaEm: status === "devolvida" && atual?.status !== "devolvida" ? now : avaliacao.devolvidaEm,
      corrigidaEm: corrigiu ? now : avaliacao.corrigidaEm
    };
    writeStorage(LOCAL_KEY, [salvo, ...todas.filter((a) => a.id !== avaliacao.id)]);
    return salvo;
  }

  const client = assertSupabase();
  const { data, error } = await client
    .from("avaliacoes")
    .update({ autoavaliacao: avaliacao.autoavaliacao, feedback: avaliacao.feedback, status, colaborador_nome: avaliacao.colaboradorNome })
    .eq("id", avaliacao.id)
    .select(AVALIACAO_COLS);
  if (error) throw error;
  if (!data || !data.length) throw new Error("A avaliação não foi encontrada ou você não tem permissão.");
  const { data: coord, error: coordError } = await client
    .from("avaliacoes_coordenacao")
    .upsert(
      {
        avaliacao_id: avaliacao.id,
        coordenador: coordLimpa.coordenador,
        subcoordenacao: coordLimpa.subcoordenacao,
        recomendacoes_itens: recomendacoes,
        feedback_respostas: respostasFeedback,
        recomendacoes: recomendacoes.map((r, i) => `${i + 1}. ${r.texto}`).join("\n"),
        updated_at: new Date().toISOString()
      },
      { onConflict: "avaliacao_id" }
    )
    .select(COORD_COLS);
  if (coordError) throw coordError;
  return mapRow(data[0] as AvaliacaoRow, (coord || [])[0] as CoordenacaoRow | undefined);
}

export async function excluirAvaliacao(avaliacao: Avaliacao, user: HubUser) {
  if (getAvaliacoesSource() === "local") {
    const todas = readLocal();
    const atual = todas.find((a) => a.id === avaliacao.id);
    if (!isAvaliador(user) && atual?.status !== "rascunho") throw new Error("Só é possível excluir rascunhos.");
    writeStorage(
      LOCAL_KEY,
      todas.filter((a) => a.id !== avaliacao.id)
    );
    return;
  }
  const client = assertSupabase();
  const { data, error } = await client.from("avaliacoes").delete().eq("id", avaliacao.id).select("id");
  if (error) throw error;
  if (!data || !data.length) throw new Error("A avaliação não pôde ser excluída (só rascunhos podem ser excluídos pelo colaborador).");
}

// Avisos por e-mail e no sino do HUB (função do servidor). No modo demonstração não envia.
// - envio: colaborador enviou a autoavaliação → coordenação;
// - devolvida: coordenação devolveu → colaborador;
// - replica: colaborador respondeu às recomendações → coordenação.
export async function enviarAvaliacaoPorEmail(avaliacao: Avaliacao, tipo: TipoEmailAvaliacao = "envio"): Promise<string> {
  if (getAvaliacoesSource() === "local") return "Modo demonstração: o e-mail não é enviado.";
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Sessão expirada. Entre novamente para enviar.");
  const response = await fetch("/.netlify/functions/avaliacao-email", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: avaliacao.id, tipo })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Não foi possível enviar o e-mail da avaliação.");
  return data?.message || "E-mail enviado.";
}
