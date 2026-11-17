// Avaliações por desempenho — acesso aos dados.
// HUB real: funções do banco (supabase/patch_avaliacoes_v4.sql), que conferem permissões e situações.
// Modo demonstração (testes, sem Supabase): mesmas regras aplicadas aqui, com os dados no navegador.
import type { HubUser } from "../types";
import { getSupabaseAccessToken } from "./auth";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";
import { loadLocalUsers } from "./usersRepository";
import {
  coordenacaoVisivelAoColaborador,
  errosEnvio,
  errosFinalizacao,
  limparColaborador,
  limparCoordenacao,
  podeAcao,
  rotuloCompetencia,
  type Avaliacao,
  type AvaliacaoStatus,
  type Evento,
  type ParteColaborador,
  type ParteCoordenacao,
  type Replica
} from "./avaliacoesModelo";

export * from "./avaliacoesModelo";

export type Colaborador = { id: string; nome: string; email: string };
export type Painel = { avaliacoes: Avaliacao[]; colaboradores: Colaborador[]; competencias: string[] };
export type TipoAviso = "enviada" | "finalizada" | "replica" | "resposta" | "devolvida";

export function isCoordenacao(user: HubUser) {
  return user.role === "admin";
}

export function fonteAvaliacoes(): "local" | "supabase" {
  return isSupabaseConfigured ? "supabase" : "local";
}

// ---------------------------------------------------------------------------------------------
// Conversão do JSON das funções do banco

type Bruto = Record<string, unknown>;

function paraAvaliacao(b: Bruto): Avaliacao {
  const colab = (b.colaborador || {}) as Partial<ParteColaborador>;
  const coord = b.coordenacao as Partial<ParteCoordenacao> | null | undefined;
  return {
    id: String(b.id),
    userId: String(b.userId),
    colaboradorNome: String(b.colaboradorNome || ""),
    colaboradorEmail: b.colaboradorEmail ? String(b.colaboradorEmail) : undefined,
    competencia: String(b.competencia),
    status: b.status as AvaliacaoStatus,
    colaborador: { notas: colab.notas || {}, sugestoes: Array.isArray(colab.sugestoes) ? colab.sugestoes : [], feedback: colab.feedback || {} },
    coordenacao: coord
      ? {
          notas: coord.notas || {},
          subcoordenacao: coord.subcoordenacao || {},
          pontosPositivos: coord.pontosPositivos || "",
          aMelhorar: coord.aMelhorar || "",
          recomendacoes: Array.isArray(coord.recomendacoes) ? coord.recomendacoes : []
        }
      : null,
    replicas: Array.isArray(b.replicas) ? (b.replicas as Replica[]) : [],
    enviadaEm: (b.enviadaEm as string) || undefined,
    finalizadaEm: (b.finalizadaEm as string) || undefined,
    updatedAt: (b.updatedAt as string) || undefined,
    eventos: Array.isArray(b.eventos) ? (b.eventos as Evento[]) : undefined
  };
}

async function rpc<T>(fn: string, args: Record<string, unknown> = {}): Promise<T> {
  if (!supabase) throw new Error("Supabase não configurado.");
  const { data, error } = await supabase.rpc(fn, args);
  if (error) {
    if (/Could not find the function|schema cache/i.test(error.message || "")) {
      throw new Error("O banco do HUB ainda não tem a nova versão das Avaliações (falta rodar o patch_avaliacoes_v4.sql no Supabase).");
    }
    throw new Error(error.message || "Erro no banco do HUB.");
  }
  return data as T;
}

// ---------------------------------------------------------------------------------------------
// Modo demonstração

type Registro = Omit<Avaliacao, "coordenacao" | "eventos"> & { coordenacao: ParteCoordenacao | null; eventos: Evento[] };
const CHAVE = "hub_avd_avaliacoes";

function ler(): Registro[] {
  return readStorage<Registro[]>(CHAVE, []);
}
function gravar(itens: Registro[]) {
  writeStorage(CHAVE, itens);
}
function idDe(user: HubUser) {
  return user.id || user.email;
}
function agora() {
  return new Date().toISOString();
}
function evento(r: Registro, user: HubUser, acao: string, detalhe = "") {
  r.eventos.push({ em: agora(), por: user.nome || user.email, acao, detalhe });
}
function visao(r: Registro, coord: boolean): Avaliacao {
  return {
    ...r,
    colaborador: coord && r.status === "rascunho" ? { notas: {}, sugestoes: [], feedback: {} } : r.colaborador,
    coordenacao: coord || coordenacaoVisivelAoColaborador(r.status) ? r.coordenacao : null,
    eventos: coord ? r.eventos : undefined
  };
}
function localCarregar(user: HubUser, id: string, coord: boolean) {
  const todos = ler();
  const r = todos.find((x) => x.id === id);
  if (!r) throw new Error("Avaliação não encontrada.");
  if (coord && !isCoordenacao(user)) throw new Error("Somente a coordenação pode fazer isso.");
  if (!coord && r.userId !== idDe(user)) throw new Error("Sem permissão para esta avaliação.");
  return { todos, r };
}
function exigir(ok: boolean, msg: string) {
  if (!ok) throw new Error(msg);
}

// ---------------------------------------------------------------------------------------------
// Colaborador

export async function listarMinhas(user: HubUser): Promise<Avaliacao[]> {
  if (fonteAvaliacoes() === "supabase") return ((await rpc<Bruto[]>("avd_minhas")) || []).map(paraAvaliacao);
  return ler()
    .filter((r) => r.userId === idDe(user))
    .sort((a, b) => b.competencia.localeCompare(a.competencia))
    .map((r) => visao(r, false));
}

export async function salvarColaborador(user: HubUser, competencia: string, parte: ParteColaborador, enviar: boolean): Promise<Avaliacao> {
  const limpa = limparColaborador(parte);
  if (enviar) {
    const erros = errosEnvio(limpa);
    if (erros.length) throw new Error(erros.join(" "));
  }
  if (fonteAvaliacoes() === "supabase") {
    return paraAvaliacao(await rpc<Bruto>("avd_salvar_colaborador", { p_competencia: competencia, p_colaborador: limpa, p_enviar: enviar }));
  }
  exigir(!isCoordenacao(user), "A coordenação não preenche autoavaliação.");
  const todos = ler();
  let r = todos.find((x) => x.userId === idDe(user) && x.competencia === competencia);
  if (r && r.status !== "rascunho") throw new Error(`A avaliação de ${rotuloCompetencia(competencia)} já foi enviada à coordenação e não pode mais ser alterada.`);
  if (!r) {
    r = {
      id: crypto.randomUUID(),
      userId: idDe(user),
      colaboradorNome: user.nome || user.email,
      colaboradorEmail: user.email,
      competencia,
      status: "rascunho",
      colaborador: limpa,
      coordenacao: null,
      replicas: [],
      eventos: []
    };
    evento(r, user, "Criou o rascunho");
    todos.push(r);
  }
  r.colaborador = limpa;
  r.updatedAt = agora();
  if (enviar) {
    r.status = "enviada";
    r.enviadaEm = agora();
    evento(r, user, "Salvou para a coordenação");
  }
  gravar(todos);
  return visao(r, false);
}

export async function enviarReplica(user: HubUser, id: string, texto: string): Promise<Avaliacao> {
  const t = texto.trim();
  exigir(!!t, "Escreva a réplica.");
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_replica", { p_id: id, p_texto: t }));
  const { todos, r } = localCarregar(user, id, false);
  exigir(podeAcao("replica", r.status, "colaborador"), "A réplica só pode ser enviada com a avaliação finalizada.");
  r.replicas.push({ id: crypto.randomUUID(), texto: t.slice(0, 4000), enviadaEm: agora() });
  r.status = "replica";
  r.updatedAt = agora();
  evento(r, user, "Enviou réplica");
  gravar(todos);
  return visao(r, false);
}

export async function excluirAvaliacao(user: HubUser, id: string): Promise<void> {
  if (fonteAvaliacoes() === "supabase") {
    await rpc("avd_excluir", { p_id: id });
    return;
  }
  const todos = ler();
  const r = todos.find((x) => x.id === id);
  if (!r) throw new Error("Avaliação não encontrada.");
  if (!isCoordenacao(user)) {
    exigir(r.userId === idDe(user), "Sem permissão para esta avaliação.");
    exigir(r.status === "rascunho", "Só é possível excluir rascunhos.");
  }
  gravar(todos.filter((x) => x.id !== id));
}

// ---------------------------------------------------------------------------------------------
// Coordenação

export async function carregarPainel(user: HubUser, competencia: string): Promise<Painel> {
  if (fonteAvaliacoes() === "supabase") {
    const p = await rpc<{ avaliacoes: Bruto[]; colaboradores: Colaborador[]; competencias: string[] }>("avd_painel", { p_competencia: competencia });
    return { avaliacoes: (p.avaliacoes || []).map(paraAvaliacao), colaboradores: p.colaboradores || [], competencias: p.competencias || [] };
  }
  exigir(isCoordenacao(user), "Somente a coordenação acessa o painel.");
  const todos = ler();
  return {
    avaliacoes: todos
      .filter((r) => r.competencia === competencia)
      .sort((a, b) => a.colaboradorNome.localeCompare(b.colaboradorNome, "pt-BR"))
      .map((r) => ({ ...visao(r, true), eventos: undefined })),
    colaboradores: loadLocalUsers()
      .filter((u) => u.active && u.role !== "admin")
      .map((u) => ({ id: u.id || u.email, nome: u.nome || u.email, email: u.email })),
    competencias: [...new Set(todos.filter((r) => r.status !== "rascunho").map((r) => r.competencia))]
  };
}

export async function obterAvaliacao(user: HubUser, id: string): Promise<Avaliacao> {
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_obter", { p_id: id }));
  const coord = isCoordenacao(user);
  const { r } = localCarregar(user, id, coord);
  if (coord) exigir(r.status !== "rascunho", "Esta avaliação ainda é rascunho do colaborador.");
  return visao(r, coord);
}

export async function corrigirAvaliacao(user: HubUser, id: string, parte: ParteCoordenacao, acao: "salvar" | "finalizar"): Promise<Avaliacao> {
  const limpa = limparCoordenacao(parte);
  if (acao === "finalizar") {
    const erros = errosFinalizacao(limpa);
    if (erros.length) throw new Error(erros.join(" "));
  }
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_corrigir", { p_id: id, p_coordenacao: limpa, p_acao: acao }));
  const { todos, r } = localCarregar(user, id, true);
  exigir(podeAcao("corrigir", r.status, "coordenacao"), "Reabra a avaliação para corrigir.");
  r.coordenacao = limpa;
  r.status = acao === "finalizar" ? "finalizada" : "em_correcao";
  if (acao === "finalizar") r.finalizadaEm = agora();
  r.updatedAt = agora();
  evento(r, user, acao === "finalizar" ? "Finalizou a avaliação" : "Salvou a correção");
  gravar(todos);
  return visao(r, true);
}

async function transicaoLocal(user: HubUser, id: string, acao: "reabrir" | "devolver" | "responderReplica", texto: string): Promise<Avaliacao> {
  const { todos, r } = localCarregar(user, id, true);
  if (acao === "reabrir") {
    exigir(podeAcao("reabrir", r.status, "coordenacao"), "Só avaliações finalizadas podem ser reabertas.");
    r.status = "em_correcao";
    evento(r, user, "Reabriu para edição");
  } else if (acao === "devolver") {
    exigir(podeAcao("devolver", r.status, "coordenacao"), "Só avaliações aguardando ou em correção podem ser devolvidas.");
    r.status = "rascunho";
    r.enviadaEm = undefined;
    evento(r, user, "Devolveu ao colaborador para ajustes", texto.trim());
  } else {
    exigir(podeAcao("responderReplica", r.status, "coordenacao"), "Não há réplica aguardando resposta.");
    exigir(!!texto.trim(), "Escreva a resposta.");
    const ultima = r.replicas[r.replicas.length - 1];
    ultima.resposta = texto.trim().slice(0, 4000);
    ultima.respondidaEm = agora();
    r.status = "finalizada";
    evento(r, user, "Respondeu à réplica");
  }
  r.updatedAt = agora();
  gravar(todos);
  return { ...visao(r, true), colaborador: r.colaborador };
}

export async function reabrirAvaliacao(user: HubUser, id: string) {
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_reabrir", { p_id: id }));
  return transicaoLocal(user, id, "reabrir", "");
}

export async function devolverAvaliacao(user: HubUser, id: string, motivo: string) {
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_devolver", { p_id: id, p_motivo: motivo }));
  return transicaoLocal(user, id, "devolver", motivo);
}

export async function responderReplica(user: HubUser, id: string, resposta: string) {
  exigir(!!resposta.trim(), "Escreva a resposta.");
  if (fonteAvaliacoes() === "supabase") return paraAvaliacao(await rpc<Bruto>("avd_responder_replica", { p_id: id, p_resposta: resposta.trim() }));
  return transicaoLocal(user, id, "responderReplica", resposta);
}

// ---------------------------------------------------------------------------------------------
// Avisos (sino e e-mail) e envio de arquivos por e-mail — função do servidor (netlify/functions/avaliacao-email.mjs)

async function chamarServidor(corpo: Record<string, unknown>): Promise<string> {
  const token = await getSupabaseAccessToken();
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  const resp = await fetch("/.netlify/functions/avaliacao-email", {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(corpo)
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) throw new Error(data?.error || "Não foi possível enviar o e-mail.");
  return data?.message || "E-mail enviado.";
}

export async function avisar(id: string, tipo: TipoAviso): Promise<string> {
  if (fonteAvaliacoes() === "local") return "Modo demonstração: o aviso por e-mail não é enviado.";
  return chamarServidor({ acao: "aviso", id, tipo });
}

export type Anexo = { nome: string; tipo: string; base64: string };
export type EnvioArquivos = { id: string; para: "colaborador" | "eu"; assunto: string; mensagem: string; anexos: Anexo[] };

export async function enviarArquivosPorEmail(envio: EnvioArquivos): Promise<string> {
  if (fonteAvaliacoes() === "local") return "Modo demonstração: o e-mail não é enviado.";
  return chamarServidor({ acao: "arquivos", ...envio });
}
