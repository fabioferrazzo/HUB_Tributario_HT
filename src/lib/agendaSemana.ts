// Agenda tributária da semana para o Quadro geral.
// Lê a mesma fonte do app Agenda tributária (/api/agenda-tributaria, com cache compartilhado no Supabase).
// Se a função não responder (ou na demonstração local, sem Supabase), usa o que o app da Agenda guardou neste navegador.
import { isSupabaseConfigured } from "./supabase";

export type AgendaCategoria = "pf" | "pj-fed" | "pj-aces" | "ret" | "simples" | "serv" | "estadual" | "municipal" | string;

export type AgendaItem = {
  cat: AgendaCategoria;
  titulo: string;
  periodo: string;
  documento: string;
};

export type AgendaDia = {
  data: string; // AAAA-MM-DD
  itens: AgendaItem[];
};

export type AgendaSemana = {
  dias: AgendaDia[];
  fonte: string;
  atualizado: string;
  mesesSemDados: string[];
};

export const AGENDA_CATEGORIA_ROTULO: Record<string, string> = {
  pf: "Pessoa Física",
  "pj-fed": "PJ Federal",
  "pj-aces": "Acessória",
  ret: "Retenção",
  simples: "Simples/MEI",
  serv: "Servidor",
  estadual: "ICMS/RS",
  municipal: "ISS"
};

type MesAgenda = { source?: string; updated?: string; dates?: Record<string, Array<Record<string, unknown>>> };

const AGENDA_STORAGE_KEY = "agenda-tributaria-rfb-v1";
const MESES = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
const memoria = new Map<string, { at: number; mes: MesAgenda | null }>();
const MEMORIA_MS = 10 * 60 * 1000;

function textoPuro(value: unknown) {
  return String(value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function chaveMes(ano: number, mes: number) {
  return `${ano}-${String(mes).padStart(2, "0")}`;
}

function lerGuardado(ano: number, mes: number): MesAgenda | null {
  try {
    const guardado = JSON.parse(localStorage.getItem(AGENDA_STORAGE_KEY) || "{}") as Record<string, MesAgenda>;
    const valor = guardado[chaveMes(ano, mes)];
    return valor && valor.dates ? valor : null;
  } catch {
    return null;
  }
}

async function carregarMes(ano: number, mes: number): Promise<MesAgenda | null> {
  const chave = chaveMes(ano, mes);
  const emMemoria = memoria.get(chave);
  if (emMemoria && Date.now() - emMemoria.at < MEMORIA_MS) return emMemoria.mes;
  let resultado: MesAgenda | null = null;
  if (!isSupabaseConfigured) {
    resultado = lerGuardado(ano, mes);
    memoria.set(chave, { at: Date.now(), mes: resultado });
    return resultado;
  }
  try {
    const resposta = await fetch(`/api/agenda-tributaria?year=${ano}&month=${mes}`, { headers: { accept: "application/json" } });
    const tipo = resposta.headers.get("content-type") || "";
    if (resposta.ok && tipo.includes("json")) {
      const corpo = (await resposta.json()) as MesAgenda;
      if (corpo && corpo.dates) resultado = corpo;
    }
  } catch {
    resultado = null;
  }
  if (!resultado) resultado = lerGuardado(ano, mes);
  memoria.set(chave, { at: Date.now(), mes: resultado });
  return resultado;
}

function isoLocal(data: Date) {
  return `${data.getFullYear()}-${String(data.getMonth() + 1).padStart(2, "0")}-${String(data.getDate()).padStart(2, "0")}`;
}

// dias: as datas da semana (objetos Date locais, segunda a domingo).
export async function carregarAgendaSemana(dias: Date[]): Promise<AgendaSemana> {
  const meses = Array.from(new Set(dias.map((dia) => chaveMes(dia.getFullYear(), dia.getMonth() + 1))));
  const carregados = new Map<string, MesAgenda | null>();
  await Promise.all(
    meses.map(async (chave) => {
      const [ano, mes] = chave.split("-").map(Number);
      carregados.set(chave, await carregarMes(ano, mes));
    })
  );
  const fontes = new Set<string>();
  let atualizado = "";
  const mesesSemDados: string[] = [];
  carregados.forEach((mes, chave) => {
    if (!mes) {
      const [ano, numero] = chave.split("-").map(Number);
      mesesSemDados.push(`${MESES[numero - 1]}/${ano}`);
      return;
    }
    if (mes.source) fontes.add(mes.source);
    if (mes.updated && !atualizado) atualizado = mes.updated;
  });
  const resultado: AgendaDia[] = dias.map((dia) => {
    const mes = carregados.get(chaveMes(dia.getFullYear(), dia.getMonth() + 1));
    const brutos = (mes?.dates && mes.dates[String(dia.getDate())]) || [];
    const itens = brutos
      .map((item) => ({
        cat: String(item.cat || ""),
        titulo: textoPuro(item.title),
        periodo: textoPuro(item.periodo),
        documento: textoPuro(item.doc)
      }))
      .filter((item) => item.titulo);
    return { data: isoLocal(dia), itens };
  });
  return { dias: resultado, fonte: Array.from(fontes).join(" · "), atualizado, mesesSemDados };
}
