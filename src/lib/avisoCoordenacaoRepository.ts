import type { HubUser } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

// Aviso da Coordenação: um aviso geral no alto do Quadro geral.
// Supabase: funções hub_aviso_coord_* (supabase/patch_aviso_coordenacao.sql).
// Demonstração (sem Supabase): fica guardado neste navegador.

export type AvisoCoordenacaoNivel = "normal" | "importante";

export type AvisoCoordenacao = {
  id: string;
  conteudo: string;
  nivel: AvisoCoordenacaoNivel;
  validade: string;
  autor: string;
  publicadoEm: string;
};

export type AvisoCoordenacaoEstado = {
  aviso: AvisoCoordenacao | null;
  podeEditar: boolean;
};

export type AvisoCoordenacaoInput = {
  conteudo: string;
  nivel: AvisoCoordenacaoNivel;
  validade: string;
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

function readLocal(user: HubUser): AvisoCoordenacaoEstado {
  const aviso = normalize(readStorage<unknown>(LOCAL_KEY, null));
  const vigente = aviso && (!aviso.validade || aviso.validade >= todayIso()) ? aviso : null;
  return { aviso: vigente, podeEditar: canManage(user) };
}

export async function loadAvisoCoordenacao(user: HubUser): Promise<AvisoCoordenacaoEstado> {
  if (!isSupabaseConfigured || !supabase) return readLocal(user);
  const { data, error } = await supabase.rpc("hub_aviso_coord_atual");
  const failure = rpcError(error);
  if (failure) throw failure;
  const value = (data || {}) as { aviso?: unknown; podeEditar?: boolean };
  return { aviso: normalize(value.aviso), podeEditar: Boolean(value.podeEditar) };
}

export async function publishAvisoCoordenacao(user: HubUser, input: AvisoCoordenacaoInput): Promise<AvisoCoordenacaoEstado> {
  if (!plainText(input.conteudo)) throw new Error("Escreva o aviso antes de publicar.");
  if (input.validade && input.validade < todayIso()) throw new Error("A validade não pode ser uma data passada.");
  if (!isSupabaseConfigured || !supabase) {
    if (!canManage(user)) throw new Error("Só administradores e gestores do HUB publicam o Aviso da Coordenação.");
    writeStorage(LOCAL_KEY, {
      id: `local-${Date.now()}`,
      conteudo: input.conteudo,
      nivel: input.nivel,
      validade: input.validade,
      autor: user.nome || user.email,
      publicadoEm: new Date().toISOString()
    });
    return readLocal(user);
  }
  const { data, error } = await supabase.rpc("hub_aviso_coord_publicar", {
    p: { conteudo: input.conteudo, nivel: input.nivel, validade: input.validade || null }
  });
  const failure = rpcError(error);
  if (failure) throw failure;
  const value = (data || {}) as { aviso?: unknown; podeEditar?: boolean };
  return { aviso: normalize(value.aviso), podeEditar: Boolean(value.podeEditar) };
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
  const value = (data || {}) as { aviso?: unknown; podeEditar?: boolean };
  return { aviso: normalize(value.aviso), podeEditar: Boolean(value.podeEditar) };
}
