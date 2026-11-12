import { isSupabaseConfigured, supabase } from "./supabase";

// Histórico e auditoria: quem fez o quê em Pautas, Avisos, Tarefas, Férias e Apuração.
// O registro é feito pelo banco (supabase/patch_historico.sql); só administradores consultam.

export const HISTORICO_MODULOS = ["Pautas", "Quadro de Avisos", "Aviso da Coordenação", "Calendário de Tarefas", "Férias", "Apuração", "Informativos"] as const;

export type HistoricoAlteracao = { de: string; para: string };

export type HistoricoItem = {
  quando: string;
  usuario: string;
  modulo: string;
  acao: string;
  titulo: string;
  detalhes: Record<string, unknown>;
};

export type HistoricoFiltro = {
  de: string; // aaaa-mm-dd
  ate: string; // aaaa-mm-dd
  modulo: string;
  usuario: string;
  busca: string;
};

export type HistoricoPagina = {
  total: number;
  itens: HistoricoItem[];
  usuarios: Array<{ id: string; nome: string }>;
  modulos: string[];
  local: boolean;
};

export const HISTORICO_POR_PAGINA = 100;

// Modo demonstração (sem banco): lê registros de exemplo gravados pelos testes, se houver.
const DEMO_KEY = "hub_demo_historico";

function lerDemo(filtro: HistoricoFiltro, deslocamento: number): HistoricoPagina {
  let todos: HistoricoItem[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(DEMO_KEY) || "[]");
    if (Array.isArray(raw)) todos = raw as HistoricoItem[];
  } catch {
    todos = [];
  }
  const de = new Date(`${filtro.de}T00:00:00`).getTime();
  const ate = new Date(`${filtro.ate}T23:59:59`).getTime();
  const busca = filtro.busca.trim().toLowerCase();
  const filtrados = todos
    .filter((item) => {
      const t = new Date(item.quando).getTime();
      if (Number.isFinite(de) && t < de) return false;
      if (Number.isFinite(ate) && t > ate) return false;
      if (filtro.modulo && item.modulo !== filtro.modulo) return false;
      if (filtro.usuario && item.usuario !== filtro.usuario) return false;
      if (busca && !`${item.titulo} ${item.acao} ${JSON.stringify(item.detalhes)}`.toLowerCase().includes(busca)) return false;
      return true;
    })
    .sort((a, b) => b.quando.localeCompare(a.quando));
  const nomes = [...new Set(todos.map((item) => item.usuario))].sort((a, b) => a.localeCompare(b, "pt-BR"));
  return {
    total: filtrados.length,
    itens: filtrados.slice(deslocamento, deslocamento + HISTORICO_POR_PAGINA),
    usuarios: nomes.map((nome) => ({ id: nome, nome })),
    modulos: [...HISTORICO_MODULOS],
    local: true
  };
}

export async function listarHistorico(filtro: HistoricoFiltro, deslocamento = 0): Promise<HistoricoPagina> {
  if (!isSupabaseConfigured || !supabase) return lerDemo(filtro, deslocamento);
  const { data, error } = await supabase.rpc("hub_historico_listar", {
    p: {
      de: filtro.de,
      ate: filtro.ate,
      modulo: filtro.modulo || null,
      usuario: filtro.usuario || null,
      busca: filtro.busca.trim() || null,
      limite: HISTORICO_POR_PAGINA,
      deslocamento
    }
  });
  if (error) {
    if (error.code === "PGRST202" || /hub_historico_listar/.test(error.message || "")) {
      throw new Error("O Histórico ainda não foi ativado no banco do HUB (falta rodar o SQL do Histórico no Supabase).");
    }
    throw new Error(error.message || "Não foi possível carregar o histórico.");
  }
  const d = (data || {}) as Partial<HistoricoPagina>;
  return {
    total: Number(d.total) || 0,
    itens: Array.isArray(d.itens) ? (d.itens as HistoricoItem[]) : [],
    usuarios: Array.isArray(d.usuarios) ? d.usuarios : [],
    modulos: [...new Set([...(Array.isArray(d.modulos) ? d.modulos : []), ...HISTORICO_MODULOS])],
    local: false
  };
}

// Todas as páginas do filtro atual (para exportar). Limite de segurança: 5.000 registros.
export async function listarHistoricoCompleto(filtro: HistoricoFiltro): Promise<HistoricoItem[]> {
  const itens: HistoricoItem[] = [];
  for (let deslocamento = 0; deslocamento < 5000; deslocamento += HISTORICO_POR_PAGINA) {
    const pagina = await listarHistorico(filtro, deslocamento);
    itens.push(...pagina.itens);
    if (itens.length >= pagina.total || !pagina.itens.length) break;
  }
  return itens;
}

// Detalhes em linhas de texto legíveis (tela e exportação).
const CHAVES_OCULTAS = new Set(["owner_user_id", "company_id", "item_id", "period_membership", "id", "progress_saved_at", "length"]);
const ROTULOS: Record<string, string> = {
  para: "Para",
  prazo: "Prazo",
  prioridade: "Prioridade",
  visibilidade: "Visibilidade",
  validade: "Válido até",
  destaque: "Destaque",
  cor: "Cor",
  status: "Situação",
  competence: "Competência",
  legal_name: "Empresa",
  note_type: "Tipo de nota",
  entraram: "Entraram",
  sairam: "Saíram"
};

function textoValor(valor: unknown): string {
  if (valor === null || valor === undefined || valor === "") return "—";
  if (Array.isArray(valor)) return valor.length ? valor.map(textoValor).join(", ") : "—";
  if (typeof valor === "boolean") return valor ? "sim" : "não";
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
}

export function detalhesEmLinhas(detalhes: Record<string, unknown>): string[] {
  const linhas: string[] = [];
  const alteracoes = detalhes?.alteracoes as Record<string, HistoricoAlteracao> | undefined;
  if (alteracoes && typeof alteracoes === "object") {
    for (const [campo, mudanca] of Object.entries(alteracoes)) {
      linhas.push(`${campo}: ${textoValor(mudanca?.de)} → ${textoValor(mudanca?.para)}`);
    }
  }
  for (const [chave, valor] of Object.entries(detalhes || {})) {
    if (chave === "alteracoes" || CHAVES_OCULTAS.has(chave)) continue;
    if (Array.isArray(valor) && !valor.length) continue;
    if (valor && typeof valor === "object" && !Array.isArray(valor)) continue;
    linhas.push(`${ROTULOS[chave] || chave}: ${textoValor(valor)}`);
  }
  return linhas;
}
