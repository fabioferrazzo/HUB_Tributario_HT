import type { HubUser, UserRole } from "../types";
import { isSupabaseConfigured, supabase } from "./supabase";
import { findLocalUserByEmail, LOCAL_DEMO_PASSWORD, senhaLocalDe } from "./usersRepository";

const SESSION_KEY = "hub_tributario_session";
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.hteixeira@gmail.com";

export function getStoredSession(): HubUser | null {
  const raw = localStorage.getItem(SESSION_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as HubUser;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

async function getSupabaseProfile(userId: string, email: string): Promise<HubUser> {
  if (!supabase) {
    throw new Error("Supabase não configurado.");
  }

  // "*": funciona antes e depois do patch_senhas_v2.sql (marcas de senha opcionais).
  const { data, error } = await supabase.from("profiles").select("*").eq("id", userId).single();

  if (error || !data) {
    return {
      id: userId,
      email,
      nome: email.split("@")[0],
      role: email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "colaborador"
    };
  }

  if (!data.active) {
    throw new Error("Usuário desativado. Solicite liberação ao administrador.");
  }

  return {
    id: data.id,
    email: data.email,
    nome: data.nome,
    role: data.role as UserRole,
    senhaProvisoria: Boolean(data.senha_provisoria),
    senhaTrocaBloqueada: Boolean(data.senha_troca_bloqueada)
  };
}

/** Atualiza a sessão guardada (ex.: depois de trocar a senha provisória). */
export function atualizarSessao(parcial: Partial<HubUser>) {
  const atual = getStoredSession();
  if (!atual) return null;
  const novo = { ...atual, ...parcial };
  localStorage.setItem(SESSION_KEY, JSON.stringify(novo));
  return novo;
}

export async function signIn(email: string, password: string): Promise<HubUser> {
  const normalizedEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error || !data.user?.email) {
      throw new Error(error?.message || "E-mail ou senha inválidos.");
    }

    const user = await getSupabaseProfile(data.user.id, data.user.email);
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }

  // Modo demonstracao (dados locais, senha fixa) existe apenas em `npm run dev`.
  // Em producao, sem Supabase configurado, o login fica bloqueado.
  if (!import.meta.env.DEV || !LOCAL_DEMO_PASSWORD) {
    throw new Error("Login indisponível: Supabase não configurado neste ambiente. Contate o administrador.");
  }

  const found = findLocalUserByEmail(normalizedEmail);

  if (!found || !found.active || password !== senhaLocalDe(found.email)) {
    throw new Error("E-mail ou senha inválidos.");
  }

  const user: HubUser = {
    id: found.id,
    email: found.email,
    nome: found.nome,
    role: found.role as UserRole,
    senhaProvisoria: Boolean(found.senhaProvisoria),
    senhaTrocaBloqueada: Boolean(found.senhaTrocaBloqueada)
  };

  localStorage.setItem(SESSION_KEY, JSON.stringify(user));
  return user;
}

export function signOut() {
  if (isSupabaseConfigured && supabase) {
    supabase.auth.signOut();
  }
  localStorage.removeItem(SESSION_KEY);
}

// Confere se o login do Supabase ainda vale. O perfil guardado no navegador sozinho não basta:
// se a sessão venceu (ou a senha foi redefinida), o HUB precisa voltar para a tela de login.
export async function sessaoSupabaseValida(): Promise<boolean> {
  if (!isSupabaseConfigured || !supabase) return true;
  try {
    const { data, error } = await supabase.auth.getSession();
    if (data.session) return true;
    // Sem internet não dá para confirmar: mantém a tela e deixa para a próxima conferência.
    if (error && typeof navigator !== "undefined" && !navigator.onLine) return true;
    return false;
  } catch {
    return typeof navigator !== "undefined" && !navigator.onLine;
  }
}

// Avisa quando o Supabase encerra a sessão (logout em outra aba, sessão vencida sem renovação).
export function aoEncerrarSessao(callback: () => void) {
  if (!isSupabaseConfigured || !supabase) return () => undefined;
  const { data } = supabase.auth.onAuthStateChange((event, session) => {
    if (event === "SIGNED_OUT" || (event === "INITIAL_SESSION" && !session)) callback();
  });
  return () => data.subscription.unsubscribe();
}

export function limparSessaoLocal() {
  localStorage.removeItem(SESSION_KEY);
}

export async function getSupabaseAccessToken() {
  if (!isSupabaseConfigured || !supabase) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}
