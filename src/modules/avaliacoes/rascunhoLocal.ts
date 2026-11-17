// Cópia local das alterações ainda não salvas (protege contra fechar a aba ou trocar de menu sem salvar).
import { readStorage, writeStorage } from "../../lib/storage";

type Copia<T> = { em: string; dados: T };
const PREFIXO = "hub_avd_naosalvo:";

export function chaveLocal(...partes: string[]) {
  return PREFIXO + partes.join(":");
}

export function guardarLocal<T>(chave: string, dados: T) {
  try {
    writeStorage<Copia<T>>(chave, { em: new Date().toISOString(), dados });
  } catch {
    /* armazenamento indisponível: segue sem a cópia */
  }
}

export function lerLocal<T>(chave: string): Copia<T> | null {
  try {
    const c = readStorage<Copia<T> | null>(chave, null);
    return c && c.dados ? c : null;
  } catch {
    return null;
  }
}

export function apagarLocal(chave: string) {
  try {
    window.localStorage.removeItem(chave);
  } catch {
    /* nada a fazer */
  }
}

export function quando(iso: string) {
  return new Date(iso).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" });
}
