import { POMODORO_ARCHIVE_STORAGE_KEY, POMODORO_STORAGE_KEY } from "../app/appConfig";
import type { PomodoroArchivedNote } from "../app/appTypes";

export function readPomodoroNotes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) || "{}") as { notes?: string };
    return parsed.notes || "";
  } catch {
    return "";
  }
}

export function savePomodoroNotes(notes: string) {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_STORAGE_KEY) || "{}") as Record<string, unknown>;
    localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify({ ...parsed, notes }));
  } catch {
    localStorage.setItem(POMODORO_STORAGE_KEY, JSON.stringify({ notes }));
  }
}

export function readPomodoroArchivedNotes(): PomodoroArchivedNote[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(POMODORO_ARCHIVE_STORAGE_KEY) || "[]") as PomodoroArchivedNote[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((note) => note && typeof note.id === "string" && typeof note.notes === "string")
      .map((note) => ({
        id: note.id,
        title: note.title || getPlainTextFromHtml(note.notes).slice(0, 64) || "Anotacao",
        notes: note.notes,
        createdAt: note.createdAt || new Date().toISOString(),
        updatedAt: note.updatedAt || note.createdAt || new Date().toISOString()
      }));
  } catch {
    return [];
  }
}

export function savePomodoroArchivedNotes(notes: PomodoroArchivedNote[]) {
  localStorage.setItem(POMODORO_ARCHIVE_STORAGE_KEY, JSON.stringify(notes));
}

export function getPlainTextFromHtml(html: string) {
  if (!html) return "";
  const element = document.createElement("div");
  element.innerHTML = html;
  return (element.textContent || "").replace(/\s+/g, " ").trim();
}

export function formatPomodoroArchiveDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
