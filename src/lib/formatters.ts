import type { FileResourceCategory, HubProfile, UserRole } from "../types";
import { fileCategoryOptions, roleOptions } from "../app/appConfig";
import { teamMembers } from "../data/hubData";

export function getInitials(value: string) {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
}

export function getActiveProfiles(profiles: HubProfile[]) {
  if (profiles.length) return profiles.filter((profile) => profile.active);
  return teamMembers.map((member) => ({ ...member, active: true }));
}

export function getProfileKey(profile: HubProfile) {
  return profile.id || profile.email;
}

export function formatRole(role: UserRole) {
  return roleOptions.find((option) => option.value === role)?.label || role;
}

export function formatFileCategory(category: FileResourceCategory) {
  return fileCategoryOptions.find((option) => option.value === category)?.label || "Outro";
}

export function toReportFileName(title: string) {
  return normalizeForSearch(title).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "relatorio";
}

export function formatResponsaveis(responsaveis: string[], profiles: Array<{ email: string; nome: string }> = teamMembers) {
  if (!responsaveis.length) return "Sem usuários marcados";
  return responsaveis
    .map((emailOrName) => profiles.find((member) => member.email === emailOrName)?.nome || emailOrName)
    .join(", ");
}

export function normalizeForSearch(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

export function formatOwner(owner: string, profiles: HubProfile[]) {
  return profiles.find((profile) => profile.id === owner || profile.email === owner)?.nome || owner;
}

export function isRecentIso(value: string, days: number) {
  if (!value) return false;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return false;
  return Date.now() - date.getTime() <= days * 24 * 60 * 60 * 1000;
}

export function getDateSortValue(value: string) {
  if (!value) return Number.MAX_SAFE_INTEGER;
  const brDate = parseBrazilianDate(value);
  const timestamp = (brDate || new Date(value)).getTime();
  return Number.isNaN(timestamp) ? Number.MAX_SAFE_INTEGER : timestamp;
}

export function getDueTone(value: string) {
  if (!value) return "neutral";
  const brDate = parseBrazilianDate(value);
  const due = (brDate || new Date(value)).getTime();
  if (Number.isNaN(due)) return "neutral";

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  if (due < now) return "danger";
  if (due - now <= day) return "warning";
  return "ok";
}

export function formatDate(value: string) {
  if (!value) return "Sem prazo";
  const brDate = parseBrazilianDate(value);
  if (brDate) return brDate.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
}

export function formatDateTime(value: string) {
  if (!value) return "Sem prazo";
  const brDate = parseBrazilianDate(value);
  if (brDate) {
    return brDate.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("pt-BR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function toDatetimeLocalValue(value: string) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return value.slice(0, 16);
  const brDate = parseBrazilianDate(value);
  const date = brDate || new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function parseBrazilianDate(value: string) {
  const match = value.match(/^(\d{2})\/(\d{2})\/(\d{4})(?:\s+(\d{2}):(\d{2}))?$/);
  if (!match) return null;

  const [, day, month, year, hour = "00", minute = "00"] = match;
  return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute));
}

// Exclusoes sao definitivas: sempre pedir confirmacao antes.
export function confirmDeletion(message: string) {
  return window.confirm(`${message}\n\nEsta ação não pode ser desfeita.`);
}

export function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message?: unknown }).message || "Não foi possível concluir a operação.");
  }
  return "Não foi possível concluir a operação.";
}
