// Seções minimizadas do formulário (a escolha fica guardada neste navegador).
import { useState } from "react";
import { readStorage, writeStorage } from "../../lib/storage";
import type { SecaoId } from "./Formulario";

const CHAVE = "hub_avd_secoes_fechadas";

export function useSecoes(): [Partial<Record<SecaoId, boolean>>, (s: SecaoId) => void] {
  const [fechadas, setFechadas] = useState<Partial<Record<SecaoId, boolean>>>(() => readStorage(CHAVE, {}));
  function alternar(s: SecaoId) {
    setFechadas((atual) => {
      const novo = { ...atual, [s]: !atual[s] };
      try {
        writeStorage(CHAVE, novo);
      } catch {
        /* armazenamento indisponível */
      }
      return novo;
    });
  }
  return [fechadas, alternar];
}
