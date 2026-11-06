import type { HubNotification, HubProfile, HubRoute, HubUser, Lembrete, Pauta, TaskItem } from "../types";
import { formatDate, formatDateTime, formatOwner, formatResponsaveis, getDateSortValue, getDueTone, isRecentIso } from "./formatters";
import { isPautaAssignedToUser, isPautaAtrasada, isPautaConcluida, isTaskAssignedToUser, isTaskOwnerForUser } from "./hubRules";

export function buildSystemNotifications({
  hubUsers,
  lembretes,
  pautas,
  tasks,
  user
}: {
  hubUsers: HubProfile[];
  lembretes: Lembrete[];
  pautas: Pauta[];
  tasks: TaskItem[];
  user: HubUser;
}): HubNotification[] {
  return [
    ...buildLembreteNotifications(lembretes, hubUsers, user),
    ...buildPautaNotifications(pautas, user),
    ...buildTaskNotifications(tasks, hubUsers, user)
  ];
}

export function buildLembreteNotifications(lembretes: Lembrete[], profiles: HubProfile[], user: HubUser): HubNotification[] {
  const eventNotifications = lembretes.flatMap((lembrete) => {
    if (lembrete.status === "concluido") return [];
    const notifications: HubNotification[] = [];
    const isOwner = lembrete.createdBy === user.id || lembrete.createdBy === user.email;
    const isMarked = lembrete.responsaveis.some((responsavel) => responsavel.toLowerCase() === user.email.toLowerCase());

    if (isRecentIso(lembrete.createdAt, 7) && isOwner) {
      notifications.push(
        createNotification({
          dedupeKey: `lembrete:${lembrete.id}:created`,
          detail: `Criado em ${formatDateTime(lembrete.createdAt)}`,
          meta: formatResponsaveis(lembrete.responsaveis, profiles),
          route: "lembretes",
          targetRef: lembrete.id,
          targetType: "lembrete",
          title: `Lembrete criado: ${lembrete.titulo}`,
          tipo: "lembrete_created",
          tone: "info"
        })
      );
    }

    if (isRecentIso(lembrete.createdAt, 7) && isMarked && !isOwner) {
      notifications.push(
        createNotification({
          dedupeKey: `lembrete:${lembrete.id}:assigned:${user.email}`,
          detail: `Prazo: ${formatDateTime(lembrete.prazo)}`,
          meta: `Criado por ${formatOwner(lembrete.createdBy, profiles)}`,
          route: "lembretes",
          targetRef: lembrete.id,
          targetType: "lembrete",
          title: `Você foi marcado: ${lembrete.titulo}`,
          tipo: "lembrete_assigned",
          tone: "info"
        })
      );
    }

    return notifications;
  });

  const dueNotifications = lembretes
    .map((lembrete) => ({ lembrete, tone: getDueTone(lembrete.prazo) }))
    .filter(
      (item): item is { lembrete: Lembrete; tone: "danger" | "warning" } =>
        item.lembrete.status !== "concluido" && (item.tone === "danger" || item.tone === "warning")
    )
    .sort((a, b) => {
      const toneOrder = a.tone === b.tone ? 0 : a.tone === "danger" ? -1 : 1;
      if (toneOrder !== 0) return toneOrder;
      return getDateSortValue(a.lembrete.prazo) - getDateSortValue(b.lembrete.prazo);
    })
    .map(({ lembrete, tone }) =>
      createNotification({
        dedupeKey: `lembrete:${lembrete.id}:${tone}`,
        title: lembrete.titulo,
        detail: tone === "danger" ? `Vencido: ${formatDateTime(lembrete.prazo)}` : `Vence em até 24h: ${formatDateTime(lembrete.prazo)}`,
        meta: formatResponsaveis(lembrete.responsaveis, profiles),
        tone,
        route: "lembretes",
        tipo: tone === "danger" ? "lembrete_overdue" : "lembrete_due",
        targetType: "lembrete",
        targetRef: lembrete.id
      })
    );

  return [...dueNotifications, ...eventNotifications].sort(sortNotificationsForDisplay);
}

export function buildPautaNotifications(pautas: Pauta[], user: HubUser): HubNotification[] {
  return pautas
    .filter((pauta) => !isPautaConcluida(pauta) && pauta.prazo.trim())
    .filter((pauta) => user.role !== "colaborador" || isPautaAssignedToUser(pauta, user))
    .map((pauta) => ({ pauta, tone: isPautaAtrasada(pauta) ? "danger" : getDueTone(pauta.prazo) }))
    .filter(
      (item): item is { pauta: Pauta; tone: "danger" | "warning" } =>
        item.tone === "danger" || item.tone === "warning"
    )
    .map(({ pauta, tone }) => {
      return createNotification({
        dedupeKey: `pauta:${pauta.id}:${tone}`,
        title: pauta.tema,
        detail: tone === "danger" ? `Pauta atrasada: ${formatDate(pauta.prazo)}` : `Pauta vence em até 24h: ${formatDate(pauta.prazo)}`,
        meta: pauta.responsavel || pauta.email || "Sem responsável definido",
        tone,
        route: "home",
        tipo: tone === "danger" ? "pauta_overdue" : "pauta_due",
        targetType: "pauta",
        targetRef: pauta.id
      });
    })
    .sort(sortNotificationsForDisplay);
}

export function buildTaskNotifications(tasks: TaskItem[], profiles: HubProfile[], user: HubUser): HubNotification[] {
  const eventNotifications = tasks.flatMap((task) => {
    if (task.status === "concluida") return [];
    const isOwner = isTaskOwnerForUser(task, user, profiles);
    const isMarked = isTaskAssignedToUser(task, user, profiles);
    if (!isRecentIso(task.createdAt, 7) || !isMarked || isOwner) return [];

    return [
      createNotification({
        dedupeKey: `tarefa:${task.id}:assigned:${user.email}`,
        detail: task.prazo ? `Prazo: ${formatDateTime(task.prazo)}` : "Sem prazo definido",
        meta: `Criada por ${formatOwner(task.createdBy, profiles)}`,
        route: "tarefas",
        targetRef: task.id,
        targetType: "tarefa",
        title: `Você foi marcado em uma tarefa: ${task.titulo}`,
        tipo: "tarefa_assigned",
        tone: "info"
      })
    ];
  });

  const dueNotifications = tasks
    .map((task) => ({ task, tone: getDueTone(task.prazo) }))
    .filter(
      (item): item is { task: TaskItem; tone: "danger" | "warning" } =>
        item.task.status !== "concluida" &&
        (isTaskAssignedToUser(item.task, user, profiles) || user.role === "admin" || user.role === "gestor") &&
        (item.tone === "danger" || item.tone === "warning")
    )
    .map(({ task, tone }) =>
      createNotification({
        dedupeKey: `tarefa:${task.id}:${tone}:${user.email}`,
        detail: tone === "danger" ? `Tarefa vencida: ${formatDateTime(task.prazo)}` : `Tarefa vence em até 24h: ${formatDateTime(task.prazo)}`,
        meta: formatResponsaveis(task.responsaveis, profiles),
        route: "tarefas",
        targetRef: task.id,
        targetType: "tarefa",
        title: task.titulo,
        tipo: tone === "danger" ? "tarefa_overdue" : "tarefa_due",
        tone
      })
    );

  return [...dueNotifications, ...eventNotifications].sort(sortNotificationsForDisplay);
}

export function createNotification({
  dedupeKey,
  detail,
  meta,
  route,
  targetRef,
  targetType,
  title,
  tipo,
  tone
}: {
  dedupeKey: string;
  detail: string;
  meta: string;
  route: HubRoute;
  targetRef: string;
  targetType: string;
  title: string;
  tipo: string;
  tone: HubNotification["tone"];
}): HubNotification {
  const now = new Date().toISOString();

  return {
    id: dedupeKey,
    dedupeKey,
    tipo,
    title,
    detail,
    meta,
    tone,
    route,
    targetRef,
    targetType,
    active: true,
    createdAt: now,
    updatedAt: now
  };
}

export function sortNotificationsForDisplay(a: HubNotification, b: HubNotification) {
  const toneOrder = { danger: 0, warning: 1, info: 2 } as const;
  const toneDiff = toneOrder[a.tone] - toneOrder[b.tone];
  if (toneDiff !== 0) return toneDiff;
  return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
}
