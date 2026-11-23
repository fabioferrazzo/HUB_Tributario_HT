import { useEffect, useState } from "react";

// Visual premium (beta): liga/desliga, tema (escuro/claro) e tamanho do texto (compacto/ampliado).
// Fica guardado neste navegador e vale para o app inteiro (menu, cabeçalho, rodapé e Quadro geral).
// Por enquanto só o administrador pode ligar; para os demais o visual atual continua igual.

export type TemaPremium = "escuro" | "claro";
export type TamanhoPremium = "compacto" | "ampliado";
export type VisualPremium = { ativo: boolean; tema: TemaPremium; tamanho: TamanhoPremium };

const ATIVO_KEY = "hub_qg_visual_premium";
const TEMA_KEY = "hub_qp_tema";
const TAMANHO_KEY = "hub_qp_tamanho";
const EVENTO = "hub:visual-premium";
const FONTES_URL =
  "https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=Nunito:wght@200;300;600;700;800&display=swap";

function ler(chave: string) {
  try {
    return localStorage.getItem(chave) || "";
  } catch {
    return "";
  }
}

function gravar(chave: string, valor: string) {
  try {
    localStorage.setItem(chave, valor);
  } catch {
    // sem armazenamento local: vale só nesta tela
  }
}

export function lerVisualPremium(): VisualPremium {
  return {
    ativo: ler(ATIVO_KEY) === "1",
    tema: ler(TEMA_KEY) === "claro" ? "claro" : "escuro",
    tamanho: ler(TAMANHO_KEY) === "ampliado" ? "ampliado" : "compacto"
  };
}

export function salvarVisualPremium(parcial: Partial<VisualPremium>) {
  if (parcial.ativo !== undefined) gravar(ATIVO_KEY, parcial.ativo ? "1" : "0");
  if (parcial.tema) gravar(TEMA_KEY, parcial.tema);
  if (parcial.tamanho) gravar(TAMANHO_KEY, parcial.tamanho);
  window.dispatchEvent(new Event(EVENTO));
}

export function carregarFontesPremium() {
  if (typeof document === "undefined" || document.getElementById("qp-fontes")) return;
  const link = document.createElement("link");
  link.id = "qp-fontes";
  link.rel = "stylesheet";
  link.href = FONTES_URL;
  document.head.appendChild(link);
}

// Estado do visual premium, atualizado em todas as partes do app quando muda (e entre abas).
export function useVisualPremium(podeUsar: boolean): VisualPremium {
  const [visual, setVisual] = useState(lerVisualPremium);

  useEffect(() => {
    const atualizar = () => setVisual(lerVisualPremium());
    window.addEventListener(EVENTO, atualizar);
    window.addEventListener("storage", atualizar);
    return () => {
      window.removeEventListener(EVENTO, atualizar);
      window.removeEventListener("storage", atualizar);
    };
  }, []);

  const ativo = podeUsar && visual.ativo;
  useEffect(() => {
    if (ativo) carregarFontesPremium();
  }, [ativo]);

  return { ...visual, ativo };
}
