import type { HubUser, Lembrete } from "../types";
import { deleteSupabaseLembrete, loadSupabaseLembretes, uploadSupabaseLembreteAnexo, upsertSupabaseLembrete } from "./lembretesRemote";
import { loadLembretes, saveLembretes, withResolvedStatus } from "./lembretes";
import { isSupabaseConfigured } from "./supabase";

export type LembretesSource = "local" | "supabase";

export function getLembretesSource(user?: HubUser | null): LembretesSource {
  return isSupabaseConfigured && Boolean(user?.id) ? "supabase" : "local";
}

export function isLembreteOwner(lembrete: Lembrete, user?: HubUser | null) {
  if (!user) return false;
  return lembrete.createdBy === user.id || lembrete.createdBy === user.email;
}

export function isUserMarkedInLembrete(lembrete: Lembrete, user?: HubUser | null) {
  if (!user) return false;
  return lembrete.responsaveis.some((responsavel) => responsavel.toLowerCase() === user.email.toLowerCase());
}

export function canUserViewLembrete(lembrete: Lembrete, user?: HubUser | null) {
  if (!user) return false;
  if (user.role === "admin") return true;
  if (isLembreteOwner(lembrete, user)) return true;
  if (!lembrete.responsaveis.length) return false;
  if (lembrete.confidencial) return isUserMarkedInLembrete(lembrete, user);
  return true;
}

export function canUserManageLembrete(lembrete: Lembrete, user?: HubUser | null) {
  if (!user) return false;
  return user.role === "admin" || isLembreteOwner(lembrete, user);
}

function filterVisibleLembretes(lembretes: Lembrete[], user?: HubUser | null) {
  return lembretes.filter((lembrete) => canUserViewLembrete(lembrete, user));
}

export async function listAppLembretes(user?: HubUser | null): Promise<Lembrete[]> {
  if (getLembretesSource(user) === "supabase") {
    return filterVisibleLembretes(await loadSupabaseLembretes(), user);
  }

  return filterVisibleLembretes(loadLembretes().map(withResolvedStatus), user);
}

export async function saveAppLembrete({
  current,
  files = [],
  lembrete,
  user
}: {
  current: Lembrete[];
  files?: File[];
  lembrete: Lembrete;
  user: HubUser;
}): Promise<Lembrete[]> {
  if (getLembretesSource(user) === "supabase") {
    const lembreteId = await upsertSupabaseLembrete(lembrete, user, {
      isExisting: current.some((item) => item.id === lembrete.id)
    });

    for (const file of files) {
      await uploadSupabaseLembreteAnexo(lembreteId, file, user);
    }

    window.dispatchEvent(new Event("hub:lembretes"));
    return loadSupabaseLembretes();
  }

  const next = [lembrete, ...current.filter((item) => item.id !== lembrete.id)].map(withResolvedStatus);
  saveLembretes(next);
  return next;
}

export async function saveAppLembretesCollection({
  lembretes,
  user
}: {
  lembretes: Lembrete[];
  user?: HubUser | null;
}): Promise<Lembrete[]> {
  const resolved = lembretes.map(withResolvedStatus);

  if (getLembretesSource(user) === "supabase" && user?.id) {
    for (const lembrete of resolved) {
      await upsertSupabaseLembrete(lembrete, user, { isExisting: true });
    }

    window.dispatchEvent(new Event("hub:lembretes"));
    return loadSupabaseLembretes();
  }

  saveLembretes(resolved);
  return resolved;
}

export async function deleteAppLembrete({
  current,
  id,
  user
}: {
  current: Lembrete[];
  id: string;
  user: HubUser;
}): Promise<Lembrete[]> {
  if (getLembretesSource(user) === "supabase") {
    await deleteSupabaseLembrete(id);
    window.dispatchEvent(new Event("hub:lembretes"));
    return loadSupabaseLembretes();
  }

  const next = current.filter((lembrete) => lembrete.id !== id).map(withResolvedStatus);
  saveLembretes(next);
  return next;
}
