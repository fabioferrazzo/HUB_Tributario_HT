import type { HubNotification, HubNotificationTone, HubRoute, HubUser } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

const NOTIFICATIONS_STORAGE_KEY = "hub_notifications";

type NotificationsSource = "local" | "supabase";

type NotificationRow = {
  id: string;
  tipo: string;
  titulo: string;
  body: string;
  meta: string | null;
  target_type: string | null;
  target_ref: string | null;
  dedupe_key: string;
  route: HubRoute | null;
  tone: HubNotificationTone | null;
  active: boolean;
  read_at: string | null;
  created_at: string;
  updated_at: string | null;
};

type StoredNotification = Partial<HubNotification> & {
  dedupeKey: string;
  title?: string;
};

export function getNotificationsSource(user?: HubUser | null): NotificationsSource {
  return isSupabaseConfigured && Boolean(user?.id) ? "supabase" : "local";
}

export async function syncAppNotifications(user: HubUser, generated: HubNotification[]) {
  const normalized = generated.map(normalizeGeneratedNotification);

  if (getNotificationsSource(user) === "supabase") {
    try {
      await purgeOldSupabaseNotifications();
      const { data, error } = await assertSupabase().rpc("sync_user_notifications", {
        p_items: normalized.map((item) => ({
          tipo: item.tipo,
          titulo: item.title,
          body: item.detail,
          meta: item.meta,
          target_type: item.targetType || null,
          target_ref: item.targetRef || null,
          dedupe_key: item.dedupeKey,
          route: item.route,
          tone: item.tone
        }))
      });

      if (error) throw error;
      return mapRows(data as NotificationRow[]);
    } catch {
      return syncLocalNotifications(user, normalized);
    }
  }

  return syncLocalNotifications(user, normalized);
}

async function purgeOldSupabaseNotifications() {
  try {
    await assertSupabase().rpc("purge_old_notifications", { p_days: 5 });
  } catch {
    // Ambientes antigos continuam sincronizando mesmo antes do patch de retencao.
  }
}

export async function markAppNotificationRead(user: HubUser, notificationId: string) {
  const readAt = new Date().toISOString();

  if (getNotificationsSource(user) === "supabase") {
    try {
      const { error } = await assertSupabase().from("notificacoes").update({ read_at: readAt }).eq("id", notificationId);
      if (error) throw error;
      return;
    } catch {
      markLocalNotificationRead(user, notificationId, readAt);
      return;
    }
  }

  markLocalNotificationRead(user, notificationId, readAt);
}

export async function markAllAppNotificationsRead(user: HubUser, notificationIds: string[]) {
  if (!notificationIds.length) return;
  const readAt = new Date().toISOString();

  if (getNotificationsSource(user) === "supabase") {
    try {
      const { error } = await assertSupabase().from("notificacoes").update({ read_at: readAt }).in("id", notificationIds);
      if (error) throw error;
      return;
    } catch {
      markLocalNotificationsRead(user, notificationIds, readAt);
      return;
    }
  }

  markLocalNotificationsRead(user, notificationIds, readAt);
}

function syncLocalNotifications(user: HubUser, generated: HubNotification[]) {
  const key = storageKey(user);
  const current = readStorage<StoredNotification[]>(key, []).map(normalizeStoredNotification);
  const currentByDedupe = new Map(current.map((item) => [item.dedupeKey, item]));
  const generatedKeys = new Set(generated.map((item) => item.dedupeKey));

  const nextGenerated = generated.map((item) => ({
    ...item,
    id: currentByDedupe.get(item.dedupeKey)?.id || item.id,
    readAt: currentByDedupe.get(item.dedupeKey)?.readAt,
    active: true,
    updatedAt: new Date().toISOString()
  }));

  const inactiveOld = current
    .filter((item) => !generatedKeys.has(item.dedupeKey))
    .map((item) => ({ ...item, active: false, updatedAt: new Date().toISOString() }));

  const next = [...nextGenerated, ...inactiveOld].sort(sortNotifications);
  writeStorage(key, next);
  return next.filter(isUnreadActive);
}

function markLocalNotificationRead(user: HubUser, notificationId: string, readAt: string) {
  markLocalNotificationsRead(user, [notificationId], readAt);
}

function markLocalNotificationsRead(user: HubUser, notificationIds: string[], readAt: string) {
  const ids = new Set(notificationIds);
  const key = storageKey(user);
  const next = readStorage<StoredNotification[]>(key, []).map(normalizeStoredNotification).map((item) =>
    ids.has(item.id) ? { ...item, readAt, updatedAt: readAt } : item
  );
  writeStorage(key, next);
}

function normalizeGeneratedNotification(item: HubNotification): HubNotification {
  const now = new Date().toISOString();

  return {
    ...item,
    id: item.id || item.dedupeKey,
    dedupeKey: item.dedupeKey,
    title: item.title.trim(),
    detail: item.detail.trim(),
    meta: item.meta.trim(),
    tone: item.tone,
    route: item.route,
    active: true,
    createdAt: item.createdAt || now,
    updatedAt: now
  };
}

function normalizeStoredNotification(item: StoredNotification): HubNotification {
  const now = new Date().toISOString();

  return {
    id: item.id || item.dedupeKey,
    dedupeKey: item.dedupeKey,
    tipo: item.tipo || "sistema",
    title: item.title || "Notificacao",
    detail: item.detail || "",
    meta: item.meta || "",
    tone: item.tone || "info",
    route: item.route || "home",
    targetType: item.targetType || "",
    targetRef: item.targetRef || "",
    active: item.active ?? true,
    readAt: item.readAt || "",
    createdAt: item.createdAt || now,
    updatedAt: item.updatedAt || now
  };
}

function mapRows(rows: NotificationRow[] = []) {
  return rows.map(mapRow).filter(isUnreadActive).sort(sortNotifications);
}

function mapRow(row: NotificationRow): HubNotification {
  return {
    id: row.id,
    dedupeKey: row.dedupe_key,
    tipo: row.tipo,
    title: row.titulo,
    detail: row.body,
    meta: row.meta || "",
    tone: row.tone || "info",
    route: row.route || "home",
    targetType: row.target_type || "",
    targetRef: row.target_ref || "",
    active: row.active,
    readAt: row.read_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at || ""
  };
}

function isUnreadActive(item: HubNotification) {
  return item.active && !item.readAt;
}

function sortNotifications(a: HubNotification, b: HubNotification) {
  const toneOrder = { danger: 0, warning: 1, info: 2 } satisfies Record<HubNotificationTone, number>;
  const toneDiff = toneOrder[a.tone] - toneOrder[b.tone];
  if (toneDiff !== 0) return toneDiff;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}

function storageKey(user: HubUser) {
  return `${NOTIFICATIONS_STORAGE_KEY}_${user.id || user.email}`;
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}
