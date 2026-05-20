import type { HubUser, UserRole } from "../types";
import { isSupabaseConfigured, supabase } from "./supabase";
import { findLocalUserByEmail, LOCAL_DEMO_PASSWORD } from "./usersRepository";

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
    throw new Error("Supabase nao configurado.");
  }

  const { data, error } = await supabase.from("profiles").select("id,email,nome,role,active").eq("id", userId).single();

  if (error || !data) {
    return {
      id: userId,
      email,
      nome: email.split("@")[0],
      role: email.toLowerCase() === ADMIN_EMAIL.toLowerCase() ? "admin" : "colaborador"
    };
  }

  if (!data.active) {
    throw new Error("Usuario desativado. Solicite liberacao ao administrador.");
  }

  return {
    id: data.id,
    email: data.email,
    nome: data.nome,
    role: data.role as UserRole
  };
}

export async function signIn(email: string, password: string): Promise<HubUser> {
  const normalizedEmail = email.trim().toLowerCase();

  if (isSupabaseConfigured && supabase) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: normalizedEmail,
      password
    });

    if (error || !data.user?.email) {
      throw new Error(error?.message || "E-mail ou senha invalidos.");
    }

    const user = await getSupabaseProfile(data.user.id, data.user.email);
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    return user;
  }

  const found = findLocalUserByEmail(normalizedEmail);

  if (!found || !found.active || password !== LOCAL_DEMO_PASSWORD) {
    throw new Error("E-mail ou senha invalidos.");
  }

  const user: HubUser = {
    id: found.id,
    email: found.email,
    nome: found.nome,
    role: found.role as UserRole
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

export async function getSupabaseAccessToken() {
  if (!isSupabaseConfigured || !supabase) return "";
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token || "";
}
