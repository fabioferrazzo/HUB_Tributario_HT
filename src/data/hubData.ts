import type { Lembrete, Noticia, Pauta, TeamMember } from "../types";
import { csvToRecords, type CsvRecord } from "../lib/csv";

const SHEET_ID = import.meta.env.VITE_SHEETS_ID || "1rpAcGBQCmm5KlMX1TMBN-qBL1vaNgy6gn3j_ffjkVsg";
const SHEET_GID = import.meta.env.VITE_SHEETS_HUB_GID || "1705398292";
const LOCAL_PAUTAS_CSV = "/data/pautas-hub.csv";

export const sheetsHubUrl = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/edit#gid=${SHEET_GID}`;

export const mockPautas: Pauta[] = [
  {
    id: "pauta-1",
    tema: "Revisao de obrigacoes acessorias da semana",
    acoes: "Conferir pendencias da semana",
    prazo: "2026-05-08",
    prioridade: "Alta",
    responsavel: "Equipe fiscal",
    email: "",
    pendenciasObs: "",
    retorno: "",
    status: "Em andamento",
    periodicidade: "Semanal",
    modificadoEm: "",
    concluidoEm: "",
    origem: "Massa local"
  },
  {
    id: "pauta-2",
    tema: "Conferencia de atualizacoes SEFAZ/RS",
    acoes: "Verificar comunicados recentes",
    prazo: "2026-05-10",
    prioridade: "Normal",
    responsavel: "Gestao tributaria",
    email: "",
    pendenciasObs: "",
    retorno: "",
    status: "Em andamento",
    periodicidade: "",
    modificadoEm: "",
    concluidoEm: "",
    origem: "Massa local"
  },
  {
    id: "pauta-3",
    tema: "Consolidar orientacoes da coordenacao",
    acoes: "Atualizar orientacoes por responsavel",
    prazo: "2026-05-13",
    prioridade: "Normal",
    responsavel: "",
    email: "",
    pendenciasObs: "",
    retorno: "",
    status: "Pendente",
    periodicidade: "",
    modificadoEm: "",
    concluidoEm: "",
    origem: "Massa local"
  }
];

export const mockLembretes: Lembrete[] = [
  {
    id: "lem-1",
    titulo: "Enviar resumo de vencimentos",
    descricao: "Consolidar pendencias com prazo curto.",
    prazo: "2026-05-08T16:00",
    prioridade: "alta",
    status: "aberto",
    confidencial: false,
    responsaveis: ["fiscal10.hteixeira@gmail.com"],
    anexos: ["resumo-vencimentos.pdf"],
    createdBy: "fiscal10.hteixeira@gmail.com",
    createdAt: "2026-05-07T09:00",
    updatedAt: "2026-05-07T09:00"
  },
  {
    id: "lem-2",
    titulo: "Revisar pauta de reuniao",
    descricao: "Atualizar itens da coordenacao.",
    prazo: "2026-05-09T10:00",
    prioridade: "normal",
    status: "aberto",
    confidencial: false,
    responsaveis: ["gestor.tributario@hteixeira.local"],
    anexos: [],
    createdBy: "fiscal10.hteixeira@gmail.com",
    createdAt: "2026-05-07T09:30",
    updatedAt: "2026-05-07T09:30"
  }
];

export const teamMembers: TeamMember[] = [
  { nome: "Fabio", email: "fiscal10.hteixeira@gmail.com", iniciais: "FB", role: "admin" },
  { nome: "Allan", email: "fiscal02.hteixeira@gmail.com", iniciais: "AL", role: "colaborador" },
  { nome: "Filipe", email: "fiscal03.hteixeira@gmail.com", iniciais: "FI", role: "colaborador" },
  { nome: "Vanessa", email: "fiscal04.hteixeira@gmail.com", iniciais: "VA", role: "colaborador" },
  { nome: "Gabi", email: "fiscal01.hteixeira@gmail.com", iniciais: "GB", role: "colaborador" },
  { nome: "Carol", email: "fiscal07.hteixeira@gmail.com", iniciais: "CA", role: "colaborador" },
  { nome: "Flavio", email: "fiscal05.hteixeira@gmail.com", iniciais: "FL", role: "colaborador" },
  { nome: "Leticia", email: "fiscal13.hteixeira@gmail.com", iniciais: "LE", role: "colaborador" },
  { nome: "Gestor Tributario", email: "gestor.tributario@hteixeira.local", iniciais: "GT", role: "gestor" },
  { nome: "Colaborador", email: "colaborador@hteixeira.local", iniciais: "CO", role: "colaborador" }
];

const legacyMockNoticias: Noticia[] = [
  {
    id: "noticia-1",
    titulo: "Receita Federal publica nova orientacao tributaria",
    fonte: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br",
    data: "2026-05-07"
  },
  {
    id: "noticia-2",
    titulo: "SEFAZ/RS atualiza comunicados ao contribuinte",
    fonte: "SEFAZ/RS",
    url: "https://www.sefaz.rs.gov.br/",
    data: "2026-05-07"
  },
  {
    id: "noticia-3",
    titulo: "Planalto disponibiliza atos normativos recentes",
    fonte: "Planalto",
    url: "https://www4.planalto.gov.br/legislacao",
    data: "2026-05-07"
  }
];

const legacyMockLegislacoes: Noticia[] = [
  {
    id: "leg-1",
    titulo: "Monitorar publicacoes oficiais relacionadas a IBS, CBS e Comite Gestor",
    fonte: "Reforma Tributaria",
    url: "https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria",
    data: "2026-05-07"
  },
  {
    id: "leg-2",
    titulo: "Acompanhar atos normativos no Planalto sobre regulamentacao da Reforma Tributaria",
    fonte: "Planalto",
    url: "https://www4.planalto.gov.br/legislacao",
    data: "2026-05-07"
  },
  {
    id: "leg-3",
    titulo: "Conferir tramitação e novas publicações legislativas sobre tributos sobre consumo",
    fonte: "Senado",
    url: "https://www12.senado.leg.br/noticias",
    data: "2026-05-07"
  }
];

export const mockNoticias: Noticia[] = [
  {
    id: "noticia-rfb-curso-rtc",
    titulo: "Receita Federal e CFC iniciam capacitacao sobre a Reforma Tributaria do Consumo",
    fonte: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/maio/receita-federal-e-conselho-federal-de-contabilidade-iniciam-capacitacao-inedita-sobre-a-reforma-tributaria-do-consumo",
    data: "2026-05-12",
    tipo: "noticia",
    sourceType: "oficial"
  },
  {
    id: "noticia-rfb-programacao-rtc",
    titulo: "Receita Federal divulga programacao do Curso Reforma Tributaria do Consumo",
    fonte: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/curso/programacao",
    data: "2026-05-06",
    tipo: "noticia",
    sourceType: "oficial"
  },
  {
    id: "noticia-rfb-orientacoes-2026",
    titulo: "Receita Federal atualiza orientacoes da Reforma Tributaria para 2026",
    fonte: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/orientacoes-2026",
    data: "2026-05-06",
    tipo: "noticia",
    sourceType: "oficial"
  }
];

export const mockLegislacoes: Noticia[] = [
  {
    id: "leg-portaria-mf-cgibs-7-2026",
    titulo: "Portaria Conjunta MF/CGIBS nº 7, de 30 de abril de 2026",
    fonte: "Diario Oficial da Uniao",
    url: "https://www.in.gov.br/web/dou/-/portaria-conjunta-mf/cgibs-n-7-de-30-de-abril-de-2026-702822417",
    data: "2026-04-30",
    tipo: "legislacao",
    sourceType: "oficial"
  },
  {
    id: "leg-resolucao-cgibs-6-2026",
    titulo: "Resolucao CGIBS nº 6, de 30 de abril de 2026",
    fonte: "Comite Gestor do IBS",
    url: "https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf",
    data: "2026-04-30",
    tipo: "legislacao",
    sourceType: "oficial"
  },
  {
    id: "leg-decreto-12955-2026",
    titulo: "Decreto nº 12.955, de 29 de abril de 2026",
    fonte: "Planalto",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm",
    data: "2026-04-29",
    tipo: "legislacao",
    sourceType: "oficial"
  },
  {
    id: "leg-lcp-227-2026",
    titulo: "Lei Complementar nº 227, de 13 de janeiro de 2026",
    fonte: "Planalto",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm",
    data: "2026-01-13",
    tipo: "legislacao",
    sourceType: "oficial"
  },
  {
    id: "leg-lcp-214-2025",
    titulo: "Lei Complementar nº 214, de 16 de janeiro de 2025",
    fonte: "Planalto",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214compilado.htm",
    data: "2025-01-16",
    tipo: "legislacao",
    sourceType: "oficial"
  }
];

function pick(record: CsvRecord, ...keys: string[]) {
  for (const key of keys) {
    if (record[key]) return record[key];
  }
  return "";
}

function mapHubRecord(record: CsvRecord, index: number, origem: string): Pauta {
  return {
    id: pick(record, "id") || `${origem.toLowerCase().replace(/\s+/g, "-")}-${index + 1}`,
    tema: pick(record, "tema", "pauta", "assunto", "titulo") || "Pauta sem titulo",
    acoes: pick(record, "acoes", "acao"),
    prazo: pick(record, "prazo", "data", "vencimento"),
    prioridade: pick(record, "prioridade") || "Normal",
    responsavel: pick(record, "responsavel", "usuario", "colaborador"),
    email: pick(record, "email", "e_mail"),
    pendenciasObs: pick(record, "pendencias_obs", "pendencias", "obs", "observacoes"),
    retorno: pick(record, "retorno"),
    status: pick(record, "status") || "Sem status",
    periodicidade: pick(record, "periodicidade"),
    modificadoEm: pick(record, "modificado_em", "modificado"),
    concluidoEm: pick(record, "concluido_em", "concluido"),
    origem
  };
}

function mapCsvToPautas(text: string, origem: string) {
  return csvToRecords(text)
    .map((record, index) => mapHubRecord(record, index, origem))
    .filter((pauta) => pauta.tema !== "Pauta sem titulo" || pauta.acoes || pauta.responsavel || pauta.status);
}

async function loadLocalCsvPautas(): Promise<Pauta[]> {
  const response = await fetch(LOCAL_PAUTAS_CSV, { cache: "no-store" });
  if (!response.ok) return [];
  const text = await response.text();
  return mapCsvToPautas(text, "CSV HUB");
}

export async function loadPautas(): Promise<Pauta[]> {
  try {
    const localPautas = await loadLocalCsvPautas();
    if (localPautas.length) return localPautas;
  } catch {
    // Keep the HUB usable even before the CSV is published.
  }

  try {
    const params = new URLSearchParams({ sheetId: SHEET_ID, gid: SHEET_GID });
    const response = await fetch(`/.netlify/functions/sheets-pautas?${params.toString()}`);
    if (!response.ok) return mockPautas;

    const payload = (await response.json()) as { rows?: Pauta[] };
    return payload.rows?.length ? payload.rows : mockPautas;
  } catch {
    return mockPautas;
  }
}
