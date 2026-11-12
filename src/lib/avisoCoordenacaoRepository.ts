import type { HubUser } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

// Aviso da Coordenação: um aviso geral no alto do Quadro geral.
// Supabase: funções hub_aviso_coord_* (supabase/patch_aviso_coordenacao.sql).
// Demonstração (sem Supabase): fica guardado neste navegador.

export type AvisoCoordenacaoNivel = "normal" | "importante";

// Cor de fundo do quadro (destaque visual) e tamanho do texto do aviso inteiro.
export const AVISO_CORES = [
  { value: "padrao", label: "Sem cor" },
  { value: "amarelo", label: "Amarelo claro" },
  { value: "azul", label: "Azul claro" },
  { value: "verde", label: "Verde claro" },
  { value: "roxo", label: "Roxo claro" },
  { value: "rosa", label: "Rosa claro" },
  { value: "laranja", label: "Laranja claro" },
  { value: "vermelho", label: "Vermelho claro" },
  { value: "cinza", label: "Cinza claro" }
] as const;
export type AvisoCoordenacaoCor = (typeof AVISO_CORES)[number]["value"];

export const AVISO_FONTES = [
  { value: "normal", label: "Normal" },
  { value: "grande", label: "Grande" },
  { value: "muito-grande", label: "Muito grande" },
  { value: "extra-grande", label: "Extra grande" }
] as const;
export type AvisoCoordenacaoFonte = (typeof AVISO_FONTES)[number]["value"];

function lerCor(valor: unknown): AvisoCoordenacaoCor {
  return (AVISO_CORES.find((item) => item.value === valor)?.value || "padrao") as AvisoCoordenacaoCor;
}

function lerFonte(valor: unknown): AvisoCoordenacaoFonte {
  return (AVISO_FONTES.find((item) => item.value === valor)?.value || "normal") as AvisoCoordenacaoFonte;
}

export type AvisoCoordenacao = {
  id: string;
  conteudo: string;
  nivel: AvisoCoordenacaoNivel;
  cor: AvisoCoordenacaoCor;
  fonte: AvisoCoordenacaoFonte;
  validade: string;
  autor: string;
  publicadoEm: string;
};

export type AvisoCoordenacaoEstado = {
  aviso: AvisoCoordenacao | null;
  podeEditar: boolean;
  // false quando o banco ainda não guarda cor e tamanho (SQL antigo).
  guardaEstilo: boolean;
};

export type AvisoCoordenacaoInput = {
  conteudo: string;
  nivel: AvisoCoordenacaoNivel;
  cor: AvisoCoordenacaoCor;
  fonte: AvisoCoordenacaoFonte;
  validade: string;
  // Corrigir o aviso em vigor (sem trocar por um novo). Na correção, notificar é opcional.
  editarId?: string;
  notificar?: boolean;
};

const LOCAL_KEY = "hub_aviso_coordenacao_local";

function canManage(user: HubUser) {
  return user.role === "admin" || user.role === "gestor";
}

function todayIso() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function plainText(html: string) {
  return html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ").trim();
}

function normalize(raw: unknown): AvisoCoordenacao | null {
  if (!raw || typeof raw !== "object") return null;
  const value = raw as Record<string, unknown>;
  return {
    id: String(value.id || ""),
    conteudo: String(value.conteudo || ""),
    nivel: value.nivel === "importante" ? "importante" : "normal",
    cor: lerCor(value.cor),
    fonte: lerFonte(value.fonte),
    validade: String(value.validade || ""),
    autor: String(value.autor || ""),
    publicadoEm: String(value.publicadoEm || "")
  };
}

function rpcError(error: { message?: string; code?: string } | null) {
  if (!error) return null;
  if (error.code === "PGRST202" || /hub_aviso_coord/.test(error.message || "")) {
    return new Error("O Aviso da Coordenação ainda não foi ativado no banco. Rode o SQL patch_aviso_coordenacao.sql no Supabase.");
  }
  return new Error(error.message || "Não foi possível acessar o Aviso da Coordenação.");
}

function fromServer(data: unknown): AvisoCoordenacaoEstado {
  const value = (data || {}) as { aviso?: unknown; podeEditar?: boolean; estilo?: boolean };
  return { aviso: normalize(value.aviso), podeEditar: Boolean(value.podeEditar), guardaEstilo: value.estilo === true };
}

function readLocal(user: HubUser): AvisoCoordenacaoEstado {
  const aviso = normalize(readStorage<unknown>(LOCAL_KEY, null));
  const vigente = aviso && (!aviso.validade || aviso.validade >= todayIso()) ? aviso : null;
  return { aviso: vigente, podeEditar: canManage(user), guardaEstilo: true };
}

export async function loadAvisoCoordenacao(user: HubUser): Promise<AvisoCoordenacaoEstado> {
  if (!isSupabaseConfigured || !supabase) return readLocal(user);
  const { data, error } = await supabase.rpc("hub_aviso_coord_atual");
  const failure = rpcError(error);
  if (failure) throw failure;
  return fromServer(data);
}

export async function publishAvisoCoordenacao(user: HubUser, input: AvisoCoordenacaoInput): Promise<AvisoCoordenacaoEstado> {
  if (!plainText(input.conteudo)) throw new Error("Escreva o aviso antes de publicar.");
  if (input.validade && input.validade < todayIso()) throw new Error("A validade não pode ser uma data passada.");
  if (!isSupabaseConfigured || !supabase) {
    if (!canManage(user)) throw new Error("Só administradores e gestores do HUB publicam o Aviso da Coordenação.");
    const atual = input.editarId ? normalize(readStorage<unknown>(LOCAL_KEY, null)) : null;
    writeStorage(LOCAL_KEY, {
      id: atual?.id || `local-${Date.now()}`,
      conteudo: input.conteudo,
      nivel: input.nivel,
      cor: input.cor,
      fonte: input.fonte,
      validade: input.validade,
      autor: user.nome || user.email,
      publicadoEm: atual?.publicadoEm || new Date().toISOString()
    });
    return readLocal(user);
  }
  const { data, error } = await supabase.rpc("hub_aviso_coord_publicar", {
    p: {
      conteudo: input.conteudo,
      nivel: input.nivel,
      cor: input.cor,
      fonte: input.fonte,
      validade: input.validade || null,
      id: input.editarId || null,
      notificar: Boolean(input.notificar)
    }
  });
  const failure = rpcError(error);
  if (failure) throw failure;
  return fromServer(data);
}

export async function removeAvisoCoordenacao(user: HubUser): Promise<AvisoCoordenacaoEstado> {
  if (!isSupabaseConfigured || !supabase) {
    if (!canManage(user)) throw new Error("Só administradores e gestores do HUB retiram o Aviso da Coordenação.");
    localStorage.removeItem(LOCAL_KEY);
    return readLocal(user);
  }
  const { data, error } = await supabase.rpc("hub_aviso_coord_remover");
  const failure = rpcError(error);
  if (failure) throw failure;
  return fromServer(data);
}
