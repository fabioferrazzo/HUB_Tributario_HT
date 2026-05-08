import type { HubUser, Lembrete } from "../types";
import { deleteSupabaseLembrete, loadSupabaseLembretes, uploadSupabaseLembreteAnexo, upsertSupabaseLembrete } from "./lembretesRemote";
import { loadLembretes, saveLembretes, withResolvedStatus } from "./lembretes";
import { isSupabaseConfigured } from "./supabase";

export type LembretesSource = "local" | "supabase";

export function getLembretesSource(user?: HubUser | null): LembretesSource {
  return isSupabaseConfigured && Boolean(user?.id) ? "supabase" : "local";
}

export async function listAppLembretes(user?: HubUser | null): Promise<Lembrete[]> {
  if (getLembretesSource(user) === "supabase") {
    return loadSupabaseLembretes();
  }

  return loadLembretes().map(withResolvedStatus);
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
