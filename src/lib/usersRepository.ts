import { teamMembers } from "../data/hubData";
import type { HubProfile, UserRole } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

export const LOCAL_DEMO_PASSWORD = "hub-demo-2026";

const USERS_STORAGE_KEY = "hub_users";
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.heixeira@gmail.com";

type UsersSource = "local" | "supabase";

type ProfileRow = {
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
};

type StoredProfile = Partial<HubProfile> & {
  email: string;
  nome?: string;
  role?: UserRole;
};

const prototypeUsers: HubProfile[] = [
  {
    id: "local-admin",
    email: ADMIN_EMAIL,
    nome: "Administrador Tributario",
    iniciais: "AT",
    role: "admin",
    active: true
  },
  {
    id: "local-gestor",
    email: "gestor.tributario@hteixeira.local",
    nome: "Gestor Tributario",
    iniciais: "GT",
    role: "gestor",
    active: true
  },
  {
    id: "local-colaborador",
    email: "colaborador@hteixeira.local",
    nome: "Colaborador",
    iniciais: "CO",
    role: "colaborador",
    active: true
  }
];

export function getUsersSource(): UsersSource {
  return isSupabaseConfigured ? "supabase" : "local";
}

export function loadLocalUsers() {
  const stored = readStorage<StoredProfile[]>(USERS_STORAGE_KEY, []);
  if (stored.length) return sortUsers(stored.map(normalizeProfile));

  return sortUsers(seedLocalUsers());
}

export function saveLocalUsers(users: HubProfile[]) {
  writeStorage(USERS_STORAGE_KEY, sortUsers(users.map(normalizeProfile)));
  window.dispatchEvent(new Event("hub:users"));
}

export function findLocalUserByEmail(email: string) {
  const normalizedEmail = email.trim().toLowerCase();
  return loadLocalUsers().find((user) => user.email.toLowerCase() === normalizedEmail);
}

export async function listAppUsers(): Promise<HubProfile[]> {
  if (getUsersSource() === "supabase") {
    const client = assertSupabase();
    const { data, error } = await client
      .from("profiles")
      .select("id,email,nome,role,active,created_at,updated_at")
      .order("nome", { ascending: true });

    if (error) throw error;
    return sortUsers((data || []).map(mapProfileRow));
  }

  return loadLocalUsers();
}

export async function saveAppUser(profile: HubProfile): Promise<HubProfile[]> {
  return saveAppUserWithOptions(profile);
}

export async function saveAppUserWithOptions(
  profile: HubProfile,
  options: { password?: string; createAuthUser?: boolean } = {}
): Promise<HubProfile[]> {
  if (getUsersSource() === "supabase") {
    if (!profile.id && options.createAuthUser !== false) {
      await createSupabaseAuthUser(profile, options.password || "");
      window.dispatchEvent(new Event("hub:users"));
      return listAppUsers();
    }

    const client = assertSupabase();
    if (!profile.id) {
      throw new Error("Informe o ID do usuario criado no Supabase Auth.");
    }

    const { error } = await client.from("profiles").upsert(
      {
        id: profile.id,
        email: profile.email.trim().toLowerCase(),
        nome: profile.nome.trim(),
        role: profile.role,
        active: profile.active
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    window.dispatchEvent(new Event("hub:users"));
    return listAppUsers();
  }

  const normalized = normalizeProfile(profile);
  const users = loadLocalUsers();
  const next = [
    normalized,
    ...users.filter((user) => user.id !== normalized.id && user.email.toLowerCase() !== normalized.email.toLowerCase())
  ];

  saveLocalUsers(next);
  return sortUsers(next);
}

export async function setAppUserActive(profile: HubProfile, active: boolean): Promise<HubProfile[]> {
  if (getUsersSource() === "supabase") {
    const client = assertSupabase();
    if (!profile.id) throw new Error("Perfil Supabase sem ID.");

    const { error } = await client.from("profiles").update({ active }).eq("id", profile.id);
    if (error) throw error;

    window.dispatchEvent(new Event("hub:users"));
    return listAppUsers();
  }

  const users = loadLocalUsers().map((user) =>
    user.id === profile.id || user.email.toLowerCase() === profile.email.toLowerCase()
      ? { ...user, active, updatedAt: new Date().toISOString() }
      : user
  );

  saveLocalUsers(users);
  return sortUsers(users);
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}

async function createSupabaseAuthUser(profile: HubProfile, password: string) {
  const client = assertSupabase();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Sessao Supabase expirada. Entre novamente.");
  }

  const response = await fetch("/.netlify/functions/admin-users", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      email: profile.email,
      nome: profile.nome,
      role: profile.role,
      active: profile.active,
      password,
      createAuthUser: true
    })
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Nao foi possivel criar o usuario no Supabase Auth.");
  }
}

function seedLocalUsers() {
  const now = new Date().toISOString();
  const byEmail = new Map<string, HubProfile>();

  [...teamMembers, ...prototypeUsers].forEach((user) => {
    const normalized = normalizeProfile({ ...user, active: true, createdAt: now, updatedAt: now });
    byEmail.set(normalized.email.toLowerCase(), normalized);
  });

  return [...byEmail.values()];
}

function normalizeProfile(profile: StoredProfile): HubProfile {
  const now = new Date().toISOString();
  const nome = profile.nome?.trim() || profile.email.split("@")[0];

  return {
    id: profile.id || crypto.randomUUID(),
    email: profile.email.trim().toLowerCase(),
    nome,
    iniciais: profile.iniciais || getInitials(nome),
    role: profile.role || "colaborador",
    active: profile.active ?? true,
    createdAt: profile.createdAt || now,
    updatedAt: now
  };
}

function mapProfileRow(row: ProfileRow): HubProfile {
  return {
    id: row.id,
    email: row.email,
    nome: row.nome,
    iniciais: getInitials(row.nome),
    role: row.role,
    active: row.active,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function sortUsers(users: HubProfile[]) {
  return [...users].sort((a, b) => {
    if (a.active !== b.active) return a.active ? -1 : 1;
    return a.nome.localeCompare(b.nome, "pt-BR");
  });
}

function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}
