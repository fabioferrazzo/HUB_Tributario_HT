import { mockLembretes } from "../data/hubData";
import type { Lembrete } from "../types";
import { readStorage, writeStorage } from "./storage";

export const LEMBRETES_STORAGE_KEY = "hub_lembretes";

type PartialStoredLembrete = Partial<Lembrete> & {
  id?: string;
  titulo?: string;
};

export function normalizeLembrete(value: PartialStoredLembrete): Lembrete {
  const now = new Date().toISOString();
  const status = value.status || "aberto";

  return {
    id: value.id || crypto.randomUUID(),
    titulo: value.titulo || "Lembrete sem titulo",
    descricao: value.descricao || "",
    prazo: value.prazo || "",
    prioridade: value.prioridade || "normal",
    status,
    confidencial: Boolean(value.confidencial),
    responsaveis: Array.isArray(value.responsaveis) ? value.responsaveis : [],
    anexos: Array.isArray(value.anexos) ? value.anexos : [],
    createdBy: value.createdBy || "fiscal10.hteixeira@gmail.com",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

export function loadLembretes() {
  return readStorage<PartialStoredLembrete[]>(LEMBRETES_STORAGE_KEY, mockLembretes).map(normalizeLembrete);
}

export function saveLembretes(lembretes: Lembrete[]) {
  writeStorage(LEMBRETES_STORAGE_KEY, lembretes);
  window.dispatchEvent(new Event("hub:lembretes"));
}

export function resolveLembreteStatus(lembrete: Lembrete): Lembrete["status"] {
  if (lembrete.status === "concluido") return "concluido";
  if (!lembrete.prazo) return "aberto";

  const due = new Date(lembrete.prazo).getTime();
  if (!Number.isNaN(due) && due < Date.now()) return "vencido";
  return "aberto";
}

export function withResolvedStatus(lembrete: Lembrete): Lembrete {
  return {
    ...lembrete,
    status: resolveLembreteStatus(lembrete)
  };
}
