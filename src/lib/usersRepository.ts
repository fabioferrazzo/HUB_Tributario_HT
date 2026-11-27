import { teamMembers } from "../data/hubData";
import type { HubProfile, UserRole } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

// Senha do modo demonstracao: existe apenas em `npm run dev` (vazia no build de producao).
export const LOCAL_DEMO_PASSWORD = import.meta.env.DEV ? "hub-demo-2026" : "";

const USERS_STORAGE_KEY = "hub_users";
const ADMIN_EMAIL = import.meta.env.VITE_ADMIN_EMAIL || "fiscal10.hteixeira@gmail.com";

type UsersSource = "local" | "supabase";

type ProfileRow = {
  id: string;
  email: string;
  nome: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  updated_at: string;
  senha_provisoria?: boolean | null;
  senha_troca_bloqueada?: boolean | null;
};

/** Como a senha do usuário novo (ou redefinida) é tratada. */
export type OpcoesSenha = {
  /** O HUB gera a senha e envia por e-mail ao usuário (ninguém precisa digitá-la). */
  gerarSenha: boolean;
  /** Senha digitada pelo administrador (quando não gera). */
  senha?: string;
  /** Exigir senha nova no primeiro acesso. */
  exigirTroca: boolean;
  /** Impedir que o usuário troque a senha (prevalece sobre "exigir troca"). */
  bloquearTroca: boolean;
};

export type ResultadoEnvioSenha = { emailSent: boolean; emailReason?: string; senhaParaInformar?: string };

// Modo demonstração: senha de cada usuário guardada só neste navegador (para testar troca e 1º acesso).
const LOCAL_SENHAS_KEY = "hub_local_senhas";
export function senhaLocalDe(email: string) {
  return readStorage<Record<string, string>>(LOCAL_SENHAS_KEY, {})[email.trim().toLowerCase()] || LOCAL_DEMO_PASSWORD;
}
function gravarSenhaLocal(email: string, senha: string) {
  const senhas = readStorage<Record<string, string>>(LOCAL_SENHAS_KEY, {});
  writeStorage(LOCAL_SENHAS_KEY, { ...senhas, [email.trim().toLowerCase()]: senha });
}
function senhaLocalGerada() {
  const letras = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const v = crypto.getRandomValues(new Uint32Array(12));
  const s = Array.from(v, (n) => letras[n % letras.length]).join("");
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}7`;
}

type StoredProfile = Partial<HubProfile> & {
  email: string;
  nome?: string;
  role?: UserRole;
};

const prototypeUsers: HubProfile[] = [
  {
    id: "local-admin",
    email: ADMIN_EMAIL,
    nome: "Administrador Tributário",
    iniciais: "AT",
    role: "admin",
    active: true
  },
  {
    id: "local-gestor",
    email: "gestor.tributario@hteixeira.local",
    nome: "Gestor Tributário",
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
      .select("*")
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
      throw new Error("Informe o ID do usuário criado no Supabase Auth.");
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

export async function resetAppUserPassword(
  profile: HubProfile,
  password: string
): Promise<{ emailSent: boolean; emailReason?: string }> {
  if (getUsersSource() !== "supabase") {
    throw new Error("Reset de senha real exige Supabase.");
  }

  if (!profile.id) {
    throw new Error("Perfil Supabase sem ID Auth.");
  }

  if (password.trim().length < 8) {
    throw new Error("Informe uma senha provisória com pelo menos 8 caracteres.");
  }

  const client = assertSupabase();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Sessão Supabase expirada. Entre novamente.");
  }

  const response = await fetch("/.netlify/functions/admin-users", {
    method: "POST",
    headers: {
      "authorization": `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      action: "reset-password",
      id: profile.id,
      email: profile.email,
      nome: profile.nome,
      role: profile.role,
      active: profile.active,
      password: password.trim()
    })
  });

  const payload = (await response.json().catch(() => ({}))) as { error?: string; emailSent?: boolean; emailReason?: string };

  if (!response.ok) {
    throw new Error(payload.error || "Não foi possível redefinir a senha do usuário.");
  }

  return { emailSent: Boolean(payload.emailSent), emailReason: payload.emailReason };
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase não configurado.");
  }

  return supabase;
}

async function createSupabaseAuthUser(profile: HubProfile, password: string) {
  const client = assertSupabase();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;

  if (!token) {
    throw new Error("Sessão Supabase expirada. Entre novamente.");
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
    throw new Error(payload.error || "Não foi possível criar o usuário no Supabase Auth.");
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
    senhaProvisoria: Boolean(profile.senhaProvisoria),
    senhaTrocaBloqueada: Boolean(profile.senhaTrocaBloqueada),
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
    senhaProvisoria: Boolean(row.senha_provisoria),
    senhaTrocaBloqueada: Boolean(row.senha_troca_bloqueada),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

// ---------------------------------------------------------------------------------------------
// Senhas v2: criar com senha provisória, redefinir, marcar (exigir/bloquear) e trocar a própria senha.

async function chamarAdminUsers(corpo: Record<string, unknown>, erroPadrao: string) {
  const client = assertSupabase();
  const { data } = await client.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Sessão expirada. Entre novamente.");
  const response = await fetch("/.netlify/functions/admin-users", {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(corpo)
  });
  const payload = (await response.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
  if (!response.ok) throw new Error(payload.error || erroPadrao);
  return payload;
}

const corpoPerfil = (profile: HubProfile) => ({
  id: profile.id,
  email: profile.email.trim().toLowerCase(),
  nome: profile.nome.trim(),
  role: profile.role,
  active: profile.active
});

const corpoSenha = (opcoes: OpcoesSenha) => ({
  gerarSenha: opcoes.gerarSenha,
  password: opcoes.gerarSenha ? "" : (opcoes.senha || "").trim(),
  exigirTroca: !opcoes.bloquearTroca && opcoes.exigirTroca,
  bloquearTroca: opcoes.bloquearTroca
});

function validarOpcoesSenha(opcoes: OpcoesSenha) {
  if (!opcoes.gerarSenha && (opcoes.senha || "").trim().length < 8) {
    throw new Error("Informe uma senha com pelo menos 8 caracteres ou deixe o HUB gerar a senha provisória.");
  }
}

export async function criarUsuario(profile: HubProfile, opcoes: OpcoesSenha): Promise<{ users: HubProfile[] } & ResultadoEnvioSenha> {
  validarOpcoesSenha(opcoes);
  if (getUsersSource() === "supabase") {
    const r = await chamarAdminUsers({ ...corpoPerfil(profile), id: undefined, createAuthUser: true, ...corpoSenha(opcoes) }, "Não foi possível criar o usuário.");
    window.dispatchEvent(new Event("hub:users"));
    return { users: await listAppUsers(), emailSent: Boolean(r.emailSent), emailReason: r.emailReason as string | undefined, senhaParaInformar: r.senhaParaInformar as string | undefined };
  }
  const senha = opcoes.gerarSenha ? senhaLocalGerada() : (opcoes.senha || "").trim();
  gravarSenhaLocal(profile.email, senha);
  const novo = normalizeProfile({ ...profile, senhaProvisoria: !opcoes.bloquearTroca && opcoes.exigirTroca, senhaTrocaBloqueada: opcoes.bloquearTroca });
  const users = [novo, ...loadLocalUsers().filter((u) => u.email.toLowerCase() !== novo.email.toLowerCase())];
  saveLocalUsers(users);
  // Demonstração: não há e-mail; a senha gerada aparece só para o administrador informar.
  return { users: sortUsers(users), emailSent: false, emailReason: "modo demonstração", senhaParaInformar: opcoes.gerarSenha ? senha : undefined };
}

export async function redefinirSenha(profile: HubProfile, opcoes: OpcoesSenha): Promise<ResultadoEnvioSenha> {
  validarOpcoesSenha(opcoes);
  if (getUsersSource() === "supabase") {
    if (!profile.id) throw new Error("Perfil sem ID.");
    const r = await chamarAdminUsers({ action: "reset-password", ...corpoPerfil(profile), ...corpoSenha(opcoes) }, "Não foi possível redefinir a senha.");
    window.dispatchEvent(new Event("hub:users"));
    return { emailSent: Boolean(r.emailSent), emailReason: r.emailReason as string | undefined, senhaParaInformar: r.senhaParaInformar as string | undefined };
  }
  const senha = opcoes.gerarSenha ? senhaLocalGerada() : (opcoes.senha || "").trim();
  gravarSenhaLocal(profile.email, senha);
  await gravarMarcasSenha(profile, opcoes);
  return { emailSent: false, emailReason: "modo demonstração", senhaParaInformar: opcoes.gerarSenha ? senha : undefined };
}

export async function gravarMarcasSenha(profile: HubProfile, opcoes: Pick<OpcoesSenha, "exigirTroca" | "bloquearTroca">): Promise<HubProfile[]> {
  if (getUsersSource() === "supabase") {
    await chamarAdminUsers({ action: "marcas-senha", ...corpoPerfil(profile), exigirTroca: !opcoes.bloquearTroca && opcoes.exigirTroca, bloquearTroca: opcoes.bloquearTroca }, "Não foi possível gravar as opções de senha.");
    window.dispatchEvent(new Event("hub:users"));
    return listAppUsers();
  }
  const users = loadLocalUsers().map((u) =>
    u.email.toLowerCase() === profile.email.toLowerCase()
      ? { ...u, senhaTrocaBloqueada: opcoes.bloquearTroca, senhaProvisoria: !opcoes.bloquearTroca && opcoes.exigirTroca, updatedAt: new Date().toISOString() }
      : u
  );
  saveLocalUsers(users);
  return sortUsers(users);
}

/** O próprio usuário troca a senha (confere a senha atual no servidor). */
export async function trocarMinhaSenha(email: string, senhaAtual: string, novaSenha: string) {
  if (novaSenha.length < 8) throw new Error("A nova senha precisa ter pelo menos 8 caracteres.");
  if (!/[A-Za-zÀ-ÿ]/.test(novaSenha) || !/\d/.test(novaSenha)) throw new Error("Use letras e números na nova senha.");
  if (novaSenha === senhaAtual) throw new Error("A nova senha precisa ser diferente da atual.");
  if (getUsersSource() === "supabase") {
    await chamarAdminUsers({ action: "trocar-propria-senha", senhaAtual, novaSenha }, "Não foi possível trocar a senha.");
    return;
  }
  const local = loadLocalUsers().find((u) => u.email.toLowerCase() === email.toLowerCase());
  if (local?.senhaTrocaBloqueada && !local.senhaProvisoria) throw new Error("A troca de senha está bloqueada pela coordenação. Fale com o administrador.");
  if (senhaAtual !== senhaLocalDe(email)) throw new Error("Senha atual incorreta.");
  gravarSenhaLocal(email, novaSenha);
  saveLocalUsers(loadLocalUsers().map((u) => (u.email.toLowerCase() === email.toLowerCase() ? { ...u, senhaProvisoria: false } : u)));
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
