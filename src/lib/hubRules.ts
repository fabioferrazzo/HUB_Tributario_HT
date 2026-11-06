import { CSSProperties } from "react";
import type { HubProfile, HubUser, Pauta, TaskItem } from "../types";
import { canUserViewPautaApp } from "./pautasRepository";
import { getDateSortValue, getDueTone, normalizeForSearch } from "./formatters";

export const TASK_SIDEBAR_HISTORY_DAYS = 7;

export const TASK_SIDEBAR_HISTORY_MS = TASK_SIDEBAR_HISTORY_DAYS * 24 * 60 * 60 * 1000;

export function shouldKeepTaskInSidebarHistory(task: TaskItem) {
  if (task.archivedAt) return false;
  if (!task.prazo) return true;

  const timestamp = Date.parse(task.prazo);
  if (!Number.isFinite(timestamp)) return true;
  if (timestamp > Date.now()) return true;

  return Date.now() - timestamp <= TASK_SIDEBAR_HISTORY_MS;
}

export function isTaskSidebarHistoryRecord(task: TaskItem) {
  if (task.archivedAt) return false;
  if (!task.prazo) return false;

  const timestamp = Date.parse(task.prazo);
  return Number.isFinite(timestamp) && timestamp < Date.now();
}

export function taskToCalendarFrameEvent(task: TaskItem) {
  return {
    id: task.id,
    title: task.titulo,
    date: task.prazo || task.createdAt || new Date().toISOString(),
    description: task.descricao,
    category: task.prioridade === "alta" ? "important" : task.destaque ? "work" : "personal",
    attachments: task.anexos.map((name) => ({ name })),
    hub: {
      createdBy: task.createdBy,
      responsaveis: task.responsaveis,
      status: task.status,
      prioridade: task.prioridade,
      destaque: Boolean(task.destaque),
      origem: task.origem,
      coordItemId: task.coordItemId,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      archivedAt: task.archivedAt || ""
    }
  };
}

export function isPautaAssignedToUser(pauta: Pauta, user: HubUser) {
  if ((pauta.responsaveis || []).some((email) => email.toLowerCase() === user.email.toLowerCase())) return true;
  if (pauta.createdBy === user.id || pauta.createdBy === user.email) return true;
  const pautaEmail = normalizeForSearch(pauta.email);
  const userEmail = normalizeForSearch(user.email);
  const pautaResponsavel = normalizeForSearch(pauta.responsavel);
  const userName = normalizeForSearch(user.nome);

  if (pautaEmail && pautaEmail === userEmail) return true;
  if (!pautaResponsavel || !userName) return false;

  return pautaResponsavel.includes(userName) || userName.includes(pautaResponsavel);
}

export function isPautaGeneral(pauta: Pauta) {
  if (pauta.scope) return pauta.scope === "todos";
  const pautaEmail = normalizeForSearch(pauta.email);
  const pautaResponsavel = normalizeForSearch(pauta.responsavel);

  return (
    !pautaEmail &&
    (!pautaResponsavel ||
      pautaResponsavel.includes("equipe") ||
      pautaResponsavel.includes("todos") ||
      pautaResponsavel.includes("geral"))
  );
}

export function canUserViewPauta(pauta: Pauta, user: HubUser) {
  return canUserViewPautaApp(pauta, user);
}

export function isTaskAssignedToUser(task: TaskItem, user: HubUser, profiles: HubProfile[] = []) {
  const userTokens = getTaskUserTokens(user, profiles);
  const ownerTokens = getProfileIdentityTokens(task.createdBy || "", profiles);
  const responsavelTokens = new Set(task.responsaveis.flatMap((responsavel) => [...getProfileIdentityTokens(responsavel, profiles)]));

  return userTokens.some((token) => {
    if (!token) return false;
    if (ownerTokens.has(token)) return true;
    return responsavelTokens.has(token);
  });
}

export function isTaskOwnerForUser(task: TaskItem, user: HubUser, profiles: HubProfile[] = []) {
  const userTokens = getTaskUserTokens(user, profiles);
  const ownerTokens = getProfileIdentityTokens(task.createdBy || "", profiles);
  return userTokens.some((token) => token && ownerTokens.has(token));
}

export function getTaskUserTokens(user: HubUser, profiles: HubProfile[] = []) {
  const baseTokens = [user.id, user.email, user.nome];
  const normalizedEmail = normalizeForSearch(user.email);
  const normalizedId = normalizeForSearch(user.id || "");
  const matchedProfile = profiles.find((profile) => {
    return normalizeForSearch(profile.email) === normalizedEmail || (profile.id && normalizeForSearch(profile.id) === normalizedId);
  });
  const profileTokens = matchedProfile
    ? [matchedProfile.id, matchedProfile.email, matchedProfile.nome, matchedProfile.iniciais]
    : [];

  return [...new Set([...baseTokens, ...profileTokens].filter((value): value is string => Boolean(value)).map((value) => normalizeForSearch(value)))];
}

export function getProfileIdentityTokens(value: string, profiles: HubProfile[] = []) {
  const normalizedValue = normalizeForSearch(value);
  const tokens = new Set<string>();
  if (normalizedValue) tokens.add(normalizedValue);

  profiles
    .filter((profile) =>
      [profile.id, profile.email, profile.nome, profile.iniciais]
        .filter(Boolean)
        .some((token) => normalizeForSearch(String(token)) === normalizedValue)
    )
    .forEach((profile) => {
      [profile.id, profile.email, profile.nome, profile.iniciais]
        .filter(Boolean)
        .forEach((token) => tokens.add(normalizeForSearch(String(token))));
    });

  return tokens;
}

export function isPautaAlta(pauta: Pauta) {
  return normalizeForSearch(`${pauta.prioridade} ${pauta.status}`).includes("alta");
}

export function isPautaConcluida(pauta: Pauta) {
  return normalizeForSearch(`${pauta.status} ${pauta.concluidoEm}`).includes("conclu");
}

export function isPautaAtrasada(pauta: Pauta) {
  const status = normalizeForSearch(pauta.status);
  if (isPautaConcluida(pauta)) return false;
  if (status.includes("atrasad") || status.includes("vencid")) return true;
  return getDueTone(pauta.prazo) === "danger";
}

export function getPautaTone(pauta: Pauta) {
  if (isPautaConcluida(pauta)) return "ok";
  if (isPautaAtrasada(pauta)) return "danger";
  return getDueTone(pauta.prazo);
}

export function getPautaContentStyle(pauta: Pauta): CSSProperties {
  return {
    fontSize: getPautaFontSize(pauta.textSize),
    fontWeight: pauta.textBold ? 850 : undefined,
    fontStyle: pauta.textItalic ? "italic" : undefined
  };
}

export function getPautaDescriptionStyle(pauta: Pauta): CSSProperties {
  if (!pauta.textHighlight) return {};
  return {
    background: "#fff3a3",
    borderRadius: "4px",
    boxDecorationBreak: "clone",
    WebkitBoxDecorationBreak: "clone",
    padding: "1px 3px"
  };
}

export function getPautaFontSize(size: Pauta["textSize"]) {
  if (size === "pequena") return "12px";
  if (size === "grande") return "16px";
  return "14px";
}

export function sortPautasForDashboard(pautas: Pauta[]) {
  const toneOrder = { danger: 0, warning: 1, ok: 2, neutral: 3 } as const;

  return [...pautas].sort((a, b) => {
    const toneDiff = toneOrder[getPautaTone(a)] - toneOrder[getPautaTone(b)];
    if (toneDiff !== 0) return toneDiff;

    const priorityDiff = Number(isPautaAlta(b)) - Number(isPautaAlta(a));
    if (priorityDiff !== 0) return priorityDiff;

    return getDateSortValue(a.prazo) - getDateSortValue(b.prazo);
  });
}

export function countPautaStatus(pautas: Pauta[], user: HubUser) {
  return pautas.reduce(
    (acc, pauta) => {
      if (isPautaAssignedToUser(pauta, user)) acc.minhas += 1;
      if (pauta.destaque) acc.destaques += 1;
      if (isPautaAlta(pauta)) acc.alta += 1;
      if (isPautaAtrasada(pauta)) acc.atrasado += 1;
      if (isPautaConcluida(pauta)) acc.concluidas += 1;
      if (!pauta.prazo.trim()) acc.semPrazo += 1;
      return acc;
    },
    { alta: 0, atrasado: 0, concluidas: 0, destaques: 0, minhas: 0, semPrazo: 0 }
  );
}
