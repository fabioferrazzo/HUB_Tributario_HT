import type { HubUser, UsefulLink } from "../types";
import { readStorage, writeStorage } from "./storage";
import { isSupabaseConfigured, supabase } from "./supabase";

type LinksSource = "local" | "supabase";

type LinkRow = {
  id: string;
  user_id: string | null;
  titulo: string;
  url: string;
  scope: "privado" | "global";
  created_at: string;
  updated_at: string;
};

const LINKS_STORAGE_KEY = "hub_links";
const DEFAULT_LINK_OWNER = "hub-defaults";
const DEFAULT_LINKS_CREATED_AT = "2026-06-01T00:00:00.000Z";

const DEFAULT_USEFUL_LINKS: UsefulLink[] = [
  {
    id: "11111111-1111-4111-8111-111111111001",
    titulo: "Dominio Sistemas",
    url: "https://www.dominiosistemas.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111002",
    titulo: "ONVIO",
    url: "https://onvio.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111003",
    titulo: "Central de Solucoes ONVIO",
    url: "https://suporte.dominioatendimento.com/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111004",
    titulo: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111005",
    titulo: "SEFAZ RS",
    url: "https://www.sefaz.rs.gov.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111006",
    titulo: "DTE RS",
    url: "https://www.sefaz.rs.gov.br/dte/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111007",
    titulo: "Gov.br",
    url: "https://www.gov.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111008",
    titulo: "Portal NF-e",
    url: "https://www.nfe.fazenda.gov.br/portal/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111009",
    titulo: "Portal Nacional NFS-e",
    url: "https://www.nfse.gov.br/EmissorNacional/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111010",
    titulo: "Reforma Tributaria - Ministerio da Fazenda",
    url: "https://www.gov.br/fazenda/pt-br/acesso-a-informacao/acoes-e-programas/reforma-tributaria",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111011",
    titulo: "Comite Gestor do IBS",
    url: "https://www.cgibs.gov.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111012",
    titulo: "Planalto - Legislacao",
    url: "https://www4.planalto.gov.br/legislacao",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111013",
    titulo: "Senado Federal",
    url: "https://www12.senado.leg.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111014",
    titulo: "Camara dos Deputados",
    url: "https://www.camara.leg.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111015",
    titulo: "Econet Editora",
    url: "https://www.econeteditora.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111016",
    titulo: "e-Auditoria",
    url: "https://www.e-auditoria.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111017",
    titulo: "Zappy Contabil",
    url: "https://www.zappycontabil.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111018",
    titulo: "SIEG",
    url: "https://www.sieg.com/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111019",
    titulo: "Portal Contabeis",
    url: "https://www.contabeis.com.br/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111020",
    titulo: "JOTA",
    url: "https://www.jota.info/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111021",
    titulo: "e-CAC",
    url: "https://cav.receita.fazenda.gov.br/autenticacao/login",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111022",
    titulo: "SPED",
    url: "https://www.gov.br/receitafederal/pt-br/assuntos/orientacao-tributaria/declaracoes-e-demonstrativos/sped",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111023",
    titulo: "Simples Nacional",
    url: "https://www8.receita.fazenda.gov.br/SimplesNacional/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  },
  {
    id: "11111111-1111-4111-8111-111111111024",
    titulo: "PGDAS-D",
    url: "https://www8.receita.fazenda.gov.br/SimplesNacional/Aplicacoes/ATSPO/pgdasd.app/",
    scope: "global",
    createdBy: DEFAULT_LINK_OWNER,
    createdAt: DEFAULT_LINKS_CREATED_AT,
    updatedAt: DEFAULT_LINKS_CREATED_AT
  }
];

export function getLinksSource(): LinksSource {
  return isSupabaseConfigured ? "supabase" : "local";
}

export async function listAppLinks(user: HubUser): Promise<UsefulLink[]> {
  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const { data, error } = await client
      .from("links_uteis")
      .select("id,user_id,titulo,url,scope,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) {
      console.warn("Falha ao carregar links do Supabase; usando links padrao.", error);
      return filterVisibleLinks(mergeDefaultLinks([]), user);
    }

    return filterVisibleLinks(mergeDefaultLinks((data || []).map((row) => mapLinkRow(row as LinkRow))), user);
  }

  return filterVisibleLinks(mergeDefaultLinks(readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, []).map(normalizeLink)), user);
}

export async function saveAppLink(link: UsefulLink, user: HubUser): Promise<UsefulLink[]> {
  const normalized = normalizeLink({
    ...link,
    scope: user.role === "admin" ? link.scope : "privado",
    createdBy: link.createdBy || user.email
  });

  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const authUserId = await getCurrentAuthUserId();
    const { error } = await client.from("links_uteis").upsert(
      {
        id: normalized.id,
        user_id: normalized.createdBy.includes("-") ? normalized.createdBy : authUserId,
        titulo: normalized.titulo,
        url: normalized.url,
        scope: normalized.scope
      },
      { onConflict: "id" }
    );

    if (error) throw error;
    return listAppLinks(user);
  }

  const links = readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, []).map(normalizeLink);
  const next = [normalized, ...links.filter((item) => item.id !== normalized.id)];
  writeStorage(LINKS_STORAGE_KEY, next);
  return filterVisibleLinks(next, user);
}

export async function deleteAppLink(link: UsefulLink, user: HubUser): Promise<UsefulLink[]> {
  if (getLinksSource() === "supabase") {
    const client = assertSupabase();
    const { error } = await client.from("links_uteis").delete().eq("id", link.id);
    if (error) throw error;
    return listAppLinks(user);
  }

  const next = readStorage<UsefulLink[]>(LINKS_STORAGE_KEY, [])
    .map(normalizeLink)
    .filter((item) => item.id !== link.id);
  writeStorage(LINKS_STORAGE_KEY, next);
  return filterVisibleLinks(next, user);
}

function assertSupabase() {
  if (!isSupabaseConfigured || !supabase) {
    throw new Error("Supabase nao configurado.");
  }

  return supabase;
}

async function getCurrentAuthUserId() {
  const client = assertSupabase();
  const { data, error } = await client.auth.getUser();

  if (error || !data.user?.id) {
    throw new Error("Sessao Supabase expirada. Entre novamente.");
  }

  return data.user.id;
}

function mapLinkRow(row: LinkRow): UsefulLink {
  return normalizeLink({
    id: row.id,
    titulo: row.titulo,
    url: row.url,
    scope: row.scope,
    createdBy: row.user_id || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  });
}

function normalizeLink(value: Partial<UsefulLink>): UsefulLink {
  const now = new Date().toISOString();
  return {
    id: value.id || crypto.randomUUID(),
    titulo: value.titulo?.trim() || "Link sem titulo",
    url: value.url?.trim() || "",
    scope: value.scope || "privado",
    createdBy: value.createdBy || "",
    createdAt: value.createdAt || now,
    updatedAt: value.updatedAt || now
  };
}

function mergeDefaultLinks(links: UsefulLink[]) {
  const existingUrls = new Set(links.map((link) => normalizeUrlForMerge(link.url)));
  const missingDefaults = DEFAULT_USEFUL_LINKS.filter((link) => !existingUrls.has(normalizeUrlForMerge(link.url)));
  return [...links, ...missingDefaults];
}

function normalizeUrlForMerge(url: string) {
  return url.trim().toLowerCase().replace(/\/+$/, "");
}

function filterVisibleLinks(links: UsefulLink[], user: HubUser) {
  return links.filter(
    (link) =>
      user.role === "admin" ||
      user.role === "gestor" ||
      link.scope === "global" ||
      link.createdBy === user.email ||
      link.createdBy === user.id
  );
}
