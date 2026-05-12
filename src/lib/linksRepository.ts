import type { HubUser, UsefulLink } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type LinksSource = "local" | "supabase";

type LinkRow = {
  id: string;
  user_id: string | null;
  titulo: string;
  url: string;
  scope: "privado" | "global";
  created_at: string;
  updated_at: string;
};

const LINKS_STORAGE_KEY = "hub_links";

export function getLinksSource(): LinksSource {
  return isSupabaseConfigured ? "supabase" : "local";
}

export async function listAppLinks(user: HubUser): Promise<UsefulLink[]> {
  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const { data, error } = await client
      .from("links_uteis")
      .select("id,user_id,titulo,url,scope,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;
    return (data || []).map((row) => mapLinkRow(row as LinkRow));
  }

  return filterVisibleLinks(readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, []).map(normalizeLink), user);
}

export async function saveAppLink(link: UsefulLink, user: HubUser): Promise<UsefulLink[]> {
  const normalized = normalizeLink({
    ...link,
    scope: user.role === "admin" ? link.scope : "privado",
    createdBy: link.createdBy || user.email
  });

  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();
    const { error } = await client.from("links_uteis").upsert(
      {
        id: normalized.id,
        user_id: normalized.createdBy.includes("-") ? normalized.createdBy : authUserId,
        titulo: normalized.titulo,
        url: normalized.url,
        scope: normalized.scope
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    return listAppLinks(user);
  }

  const links = readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, []).map(normalizeLink);
  const next = [normalized, ...links.filter((item) => item.id !== normalized.id)];
  writeStorage(LINKS_STORAGE_KEY, next);
  return filterVisibleLinks(next, user);
}

export async function deleteAppLink(link: UsefulLink, user: HubUser): Promise<UsefulLink[]> {
  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("links_uteis").delete().eq("id", link.id);
    if (error) throw error;
    return listAppLinks(user);
  }

  const next = readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, [])
    .map(normalizeLink)
    .filter((item) => item.id !== link.id);
  writeStorage(LINKS_STORAGE_KEY, next);
  return filterVisibleLinks(next, user);
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}

async function getCurrentAuthUserId() {
  const client = assertSupabase();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user?.id) {
    throw new Error("Sessao Supabase expirada. Entre novamente.");
  }

  return data.user.id;
}

function mapLinkRow(row: LinkRow): UsefulLink {
  return normalizeLink({
    id: row.id,
    titulo: row.titulo,
    url: row.url,
    scope: row.scope,
    createdBy: row.user_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function normalizeLink(value: Partial<UsefulLink>): UsefulLink {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    titulo: value.titulo?.trim() || "Link sem titulo",
    url: value.url?.trim() || "",
    scope: value.scope || "privado",
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function filterVisibleLinks(links: UsefulLink[], user: HubUser) {
  return links.filter(
    (link) =>
      user.role === "admin" ||
      user.role === "gestor" ||
      link.scope === "global" ||
      link.createdBy === user.email ||
      link.createdBy === user.id
  );
}
