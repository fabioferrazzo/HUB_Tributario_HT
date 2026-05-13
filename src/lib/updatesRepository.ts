import { mockLegislacoes, mockNoticias } from "../data/hubData";
import type { Noticia } from "../types";
import { isSupabaseConfigured, supabase } from "./supabase";

type UpdateKind = "noticia" | "legislacao";

type UpdateRow = {
  id: string;
  titulo: string;
  fonte: string | null;
  url: string;
  published_at: string | null;
  tipo: UpdateKind | null;
  source_type: "oficial" | "especializada" | null;
  source_url: string | null;
};

export function getUpdatesSource() {
  return isSupabaseConfigured ? "supabase" : "local";
}

export async function listAppUpdates(kind: UpdateKind): Promise<Noticia[]> {
  if (getUpdatesSource() === "supabase") {
    try {
      const since = new Date();
      since.setDate(since.getDate() - 7);

      const { data, error } = await supabase!
        .from("noticias")
        .select("id,titulo,fonte,url,published_at,tipo,source_type,source_url")
        .eq("active", true)
        .eq("tipo", kind)
        .gte("published_at", since.toISOString().slice(0, 10))
        .order("published_at", { ascending: false })
        .limit(30);

      if (error) throw error;
      const mapped = (data || []).map((row) => mapUpdateRow(row as UpdateRow)).filter(isSpecificUpdateUrl);
      if (mapped.length) return mapped;

      const { data: latestData, error: latestError } = await supabase!
        .from("noticias")
        .select("id,titulo,fonte,url,published_at,tipo,source_type,source_url")
        .eq("active", true)
        .eq("tipo", kind)
        .order("published_at", { ascending: false })
        .limit(10);

      if (!latestError) {
        const latestMapped = (latestData || []).map((row) => mapUpdateRow(row as UpdateRow)).filter(isSpecificUpdateUrl);
        if (latestMapped.length) return latestMapped;
      }
    } catch {
      return kind === "legislacao" ? mockLegislacoes : mockNoticias;
    }
  }

  return kind === "legislacao" ? mockLegislacoes : mockNoticias;
}

function mapUpdateRow(row: UpdateRow): Noticia {
  return {
    id: row.id,
    titulo: row.titulo,
    fonte: row.fonte || "Fonte",
    url: row.url,
    data: row.published_at || "",
    tipo: row.tipo || "noticia",
    sourceType: row.source_type || "oficial",
    sourceUrl: row.source_url || ""
  };
}

function isSpecificUpdateUrl(item: Noticia) {
  try {
    const parsed = new URL(item.url);
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const host = parsed.hostname.toLowerCase();

    if (host.includes("planalto.gov.br")) {
      return /\/leis\/lcp\/lcp\d|\/leis\/lcp\/lcp\d+compilado|\/_ato\d{4}-\d{4}\/\d{4}\//.test(path);
    }

    if (host.includes("normas.receita.fazenda.gov.br")) {
      return true;
    }

    if (host.includes("cgibs.gov.br")) {
      return path.includes("/upload/arquivos/") || path === "/regulamentos";
    }

    if (host.includes("in.gov.br")) {
      return path.includes("/web/dou/-/");
    }

    if (host.includes("gov.br")) {
      return (
        path.includes("/assuntos/noticias/") ||
        path.includes("/reforma-tributaria-do-consumo/") ||
        path.includes("/reforma-consumo/")
      ) && !path.endsWith("/pt-br");
    }

    if (host.includes("sefaz.rs.gov.br")) {
      return path.length > 1;
    }

    if (host.includes("senado.leg.br") || host.includes("camara.leg.br")) {
      return path.split("/").filter(Boolean).length >= 2;
    }

    return path.length > 1;
  } catch {
    return false;
  }
}
