import { useEffect, useState } from "react";

// Visual premium (beta): liga/desliga, tema (escuro/claro) e tamanho do texto (compacto/ampliado).
// Fica guardado neste navegador e vale para o app inteiro (menu, cabeçalho, rodapé e Quadro geral).
// Por enquanto só o administrador pode ligar; para os demais o visual atual continua igual.

export type TemaPremium = "escuro" | "claro";
export type TamanhoPremium = "compacto" | "ampliado";
export type PaletaPremium = {
  base: number; // matiz da predefinição escolhida
  h: number; // matiz final (predefinição + ajuste fino)
  s: number; // intensidade (saturação), 40–100
  luz: number; // luzes de fundo, 0–140 (%)
  degrade: number; // força do degradê, 0–100 (%)
  angulo: number | null; // ângulo do degradê (null = padrão do tema)
  vidro: number; // transparência do vidro, 60–160 (%)
  sombra: number; // sombra, 0–200 (%)
  raio: number; // cantos, 12–32 px
  versao: 1;
};
export type VisualPremium = { ativo: boolean; tema: TemaPremium; tamanho: TamanhoPremium; paleta: PaletaPremium };

export const PALETA_PADRAO: PaletaPremium = { base: 179, h: 179, s: 75, luz: 100, degrade: 100, angulo: null, vidro: 100, sombra: 100, raio: 24, versao: 1 };

// Cores de destaque (sempre frias). Lilás só no tema escuro.
export const PREDEFINICOES_DESTAQUE = [
  { nome: "Turquesa H. Teixeira", h: 179 },
  { nome: "Teal da marca", h: 170 },
  { nome: "Verde", h: 160 },
  { nome: "Petróleo", h: 190 },
  { nome: "Azul", h: 215 },
  { nome: "Lilás", h: 250, soEscuro: true }
] as const;

const ATIVO_KEY = "hub_qg_visual_premium";
const TEMA_KEY = "hub_qp_tema";
const TAMANHO_KEY = "hub_qp_tamanho";
const PALETA_KEY = "ht_premium_paleta";
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

function limitar(valor: unknown, min: number, max: number, padrao: number) {
  const n = Number(valor);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : padrao;
}

export function lerPaleta(): PaletaPremium {
  try {
    const salvo = JSON.parse(ler(PALETA_KEY) || "null");
    if (!salvo || typeof salvo !== "object") return { ...PALETA_PADRAO };
    const base = limitar(salvo.base, 0, 360, PALETA_PADRAO.base);
    return {
      base,
      h: limitar(salvo.h, base - 20, base + 20, base),
      s: limitar(salvo.s, 40, 100, PALETA_PADRAO.s),
      luz: limitar(salvo.luz, 0, 140, PALETA_PADRAO.luz),
      degrade: limitar(salvo.degrade, 0, 100, PALETA_PADRAO.degrade),
      angulo: salvo.angulo === null || salvo.angulo === undefined ? null : limitar(salvo.angulo, 150, 200, 180),
      vidro: limitar(salvo.vidro, 60, 160, PALETA_PADRAO.vidro),
      sombra: limitar(salvo.sombra, 0, 200, PALETA_PADRAO.sombra),
      raio: limitar(salvo.raio, 12, 32, PALETA_PADRAO.raio),
      versao: 1
    };
  } catch {
    return { ...PALETA_PADRAO };
  }
}

export function lerVisualPremium(): VisualPremium {
  return {
    ativo: ler(ATIVO_KEY) === "1",
    tema: ler(TEMA_KEY) === "claro" ? "claro" : "escuro",
    tamanho: ler(TAMANHO_KEY) === "ampliado" ? "ampliado" : "compacto",
    paleta: lerPaleta()
  };
}

export function salvarVisualPremium(parcial: Partial<Omit<VisualPremium, "paleta">> & { paleta?: Partial<PaletaPremium> | null }) {
  if (parcial.ativo !== undefined) gravar(ATIVO_KEY, parcial.ativo ? "1" : "0");
  if (parcial.tema) gravar(TEMA_KEY, parcial.tema);
  if (parcial.tamanho) gravar(TAMANHO_KEY, parcial.tamanho);
  if (parcial.paleta === null) gravar(PALETA_KEY, JSON.stringify(PALETA_PADRAO));
  else if (parcial.paleta) gravar(PALETA_KEY, JSON.stringify({ ...lerPaleta(), ...parcial.paleta, versao: 1 }));
  window.dispatchEvent(new Event(EVENTO));
}

// ---- Guarda de contraste (WCAG): a cor de destaque escolhida nunca pode prejudicar a leitura.
function hslParaRgb(h: number, s: number, l: number): [number, number, number] {
  const sat = s / 100;
  const lum = l / 100;
  const c = (1 - Math.abs(2 * lum - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lum - c / 2;
  const hh = ((h % 360) + 360) % 360;
  const [r, g, b] =
    hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
}

function luminancia([r, g, b]: [number, number, number]) {
  const canal = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

export function contraste(a: [number, number, number], b: [number, number, number]) {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

const FUNDO_CARTAO = { escuro: [22, 27, 48] as [number, number, number], claro: [245, 243, 238] as [number, number, number] };
const SOBRE_ACENTO = { escuro: [4, 18, 26] as [number, number, number], claro: [255, 255, 255] as [number, number, number] };

// Luminosidade final do destaque e do texto em destaque, já corrigida para contraste mínimo de 4,5:1.
export function tonsDaPaleta(paleta: PaletaPremium, tema: TemaPremium) {
  const escuro = tema === "escuro";
  let lAcento = escuro ? 42 : 28;
  let lTexto = escuro ? 61 : 24;
  const sTexto = escuro ? paleta.s * 0.85 : paleta.s;
  let ajustado = false;
  for (let passo = 0; passo < 12 && contraste(hslParaRgb(paleta.h, paleta.s, lAcento), SOBRE_ACENTO[tema]) < 4.5; passo++) {
    lAcento += escuro ? 2 : -2;
    ajustado = true;
  }
  for (let passo = 0; passo < 12 && contraste(hslParaRgb(paleta.h, sTexto, lTexto), FUNDO_CARTAO[tema]) < 4.5; passo++) {
    lTexto += escuro ? 2 : -2;
    ajustado = true;
  }
  return { lAcento, lTexto, ajustado };
}

// Variáveis CSS que levam a paleta para o app (aplicadas no elemento raiz do visual premium).
export function variaveisDaPaleta(paleta: PaletaPremium, tema: TemaPremium): Record<string, string> {
  const tons = tonsDaPaleta(paleta, tema);
  const vars: Record<string, string> = {
    "--ht-h": String(paleta.h),
    "--ht-s": `${paleta.s}%`,
    "--ht-l-acento": `${tons.lAcento}%`,
    "--ht-l-texto": `${tons.lTexto}%`,
    "--ht-luz": String(paleta.luz / 100),
    "--ht-degrade": String(paleta.degrade / 100),
    "--ht-vidro-k": String(paleta.vidro / 100),
    "--ht-sombra-k": String(paleta.sombra / 100),
    "--ht-raio": `${paleta.raio}px`
  };
  if (paleta.angulo !== null) vars["--ht-angulo"] = `${paleta.angulo}deg`;
  return vars;
}

export function abrirPersonalizarVisual() {
  window.dispatchEvent(new Event("hub:abrir-paleta"));
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
