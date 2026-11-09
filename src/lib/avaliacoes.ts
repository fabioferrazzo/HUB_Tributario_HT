// Avaliação por desempenho (modelo "AVALIAÇÃO POR DESEMPENHO - Depto de Gestão e Planejamento Tributário").
// Autoavaliação do colaborador + notas do coordenador (e, no futuro, da subcoordenação) e recomendações.
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
  { id: "gostaria", pergunta: "Qual atividade você não faz, mas gostaria de realizar, tendo em vista o seu perfil pessoal e profissional?" }
] as const;

export type FeedbackId = (typeof AVALIACAO_FEEDBACK)[number]["id"];

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

export type AvaliacaoCoordenacao = {
  coordenador: NotasPorCriterio;
  subcoordenacao: NotasPorCriterio;
  recomendacoes: string;
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

export function novaAvaliacao(user: HubUser, competencia = competenciaAtual()): Avaliacao {
  return {
    id: crypto.randomUUID(),
    userId: user.id || user.email,
    colaboradorNome: user.nome || user.email,
    competencia,
    status: "rascunho",
    autoavaliacao: {},
    feedback: {}
  };
}

// ---------------------------------------------------------------------------------------------
// Repositório (Supabase ou, no modo demonstração, armazenamento local)

const LOCAL_KEY = "hub_avaliacoes";

type AvaliacaoRow = {
  id: string;
  user_id: string;
  colaborador_nome: string;
  competencia: string;
  status: AvaliacaoStatus;
  autoavaliacao: NotasPorCriterio | null;
  feedback: Avaliacao["feedback"] | null;
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
  updated_at: string | null;
};

function sortAvaliacoes(items: Avaliacao[]) {
  const chave = (a: Avaliacao) => {
    const [mes, ano] = a.competencia.split("/");
    return `${ano}${mes}`;
  };
  return [...items].sort((a, b) => chave(b).localeCompare(chave(a)) || a.colaboradorNome.localeCompare(b.colaboradorNome, "pt-BR"));
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
    enviadaEm: row.enviada_em || undefined,
    devolvidaEm: row.devolvida_em || undefined,
    corrigidaEm: row.corrigida_em || undefined,
    updatedAt: row.updated_at || undefined,
    coordenacao: coord
      ? {
          coordenador: coord.coordenador || {},
          subcoordenacao: coord.subcoordenacao || {},
          recomendacoes: coord.recomendacoes || "",
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
  return readStorage<Avaliacao[]>(LOCAL_KEY, []);
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
  const { data, error } = await client
    .from("avaliacoes")
    .select("id,user_id,colaborador_nome,competencia,status,autoavaliacao,feedback,enviada_em,devolvida_em,corrigida_em,updated_at");
  if (error) throw error;
  const rows = (data || []) as AvaliacaoRow[];
  const coordMap = new Map<string, CoordenacaoRow>();
  if (rows.length) {
    const { data: coord, error: coordError } = await client
      .from("avaliacoes_coordenacao")
      .select("avaliacao_id,coordenador,subcoordenacao,recomendacoes,updated_at")
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
    const salvo: Avaliacao = { ...avaliacao, coordenacao: atual?.coordenacao, status, updatedAt: now, enviadaEm: enviar ? now : avaliacao.enviadaEm };
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
  const { data, error } = await query.select("id,user_id,colaborador_nome,competencia,status,autoavaliacao,feedback,enviada_em,devolvida_em,corrigida_em,updated_at");
  if (error) {
    if (String(error.message || "").includes("avaliacoes_user_id_competencia_key") || error.code === "23505") {
      throw new Error(`Você já tem uma avaliação de ${avaliacao.competencia}. Abra-a na lista para continuar.`);
    }
    throw error;
  }
  if (!data || !data.length) throw new Error("A avaliação não pôde ser salva (ela pode já ter sido enviada).");
  return mapRow(data[0] as AvaliacaoRow);
}

// Administrador: corrige a autoavaliação, lança as notas da coordenação e define a situação.
export async function salvarCoordenacao(avaliacao: Avaliacao, coordenacao: AvaliacaoCoordenacao, status: AvaliacaoStatus, user: HubUser): Promise<Avaliacao> {
  if (!isAvaliador(user)) throw new Error("Somente a coordenação pode avaliar.");

  if (getAvaliacoesSource() === "local") {
    const todas = readLocal();
    const now = new Date().toISOString();
    const atual = todas.find((a) => a.id === avaliacao.id);
    const corrigiu =
      atual && (JSON.stringify(atual.autoavaliacao) !== JSON.stringify(avaliacao.autoavaliacao) || JSON.stringify(atual.feedback) !== JSON.stringify(avaliacao.feedback));
    const salvo: Avaliacao = {
      ...avaliacao,
      status,
      coordenacao: { ...coordenacao, updatedAt: now },
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
    .select("id,user_id,colaborador_nome,competencia,status,autoavaliacao,feedback,enviada_em,devolvida_em,corrigida_em,updated_at");
  if (error) throw error;
  if (!data || !data.length) throw new Error("A avaliação não foi encontrada ou você não tem permissão.");
  const { data: coord, error: coordError } = await client
    .from("avaliacoes_coordenacao")
    .upsert(
      {
        avaliacao_id: avaliacao.id,
        coordenador: coordenacao.coordenador,
        subcoordenacao: coordenacao.subcoordenacao,
        recomendacoes: coordenacao.recomendacoes,
        updated_at: new Date().toISOString()
      },
      { onConflict: "avaliacao_id" }
    )
    .select("avaliacao_id,coordenador,subcoordenacao,recomendacoes,updated_at");
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

// Envia a avaliação por e-mail à coordenação (função do servidor). No modo demonstração não envia.
export async function enviarAvaliacaoPorEmail(avaliacao: Avaliacao): Promise<string> {
  if (getAvaliacoesSource() === "local") return "Modo demonstração: o e-mail não é enviado.";
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Sessão expirada. Entre novamente para enviar.");
  const response = await fetch("/.netlify/functions/avaliacao-email", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ id: avaliacao.id })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data?.error || "Não foi possível enviar o e-mail da avaliação.");
  return data?.message || "E-mail enviado à coordenação.";
}
