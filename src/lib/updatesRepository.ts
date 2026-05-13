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
      const mapped = (data || []).map((row) => mapUpdateRow(row as UpdateRow));
      if (mapped.length) return mapped;
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
