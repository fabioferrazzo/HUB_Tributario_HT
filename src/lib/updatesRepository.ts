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
      if (kind === "noticia") {
        const news = rankNews(mapped.filter(isTaxNews)).slice(0, 3);
        if (news.length) return news;
      }

      if (kind === "legislacao") {
        const legislation = mergeUpdates(mapped, mockLegislacoes).filter(isSpecificUpdateUrl).sort(sortByDateDesc);
        if (legislation.length >= 3) return legislation.slice(0, 8);
      }

      const { data: latestData, error: latestError } = await supabase!
        .from("noticias")
        .select("id,titulo,fonte,url,published_at,tipo,source_type,source_url")
        .eq("active", true)
        .eq("tipo", kind)
        .order("published_at", { ascending: false })
        .limit(10);

      if (!latestError) {
        const latestMapped = (latestData || []).map((row) => mapUpdateRow(row as UpdateRow)).filter(isSpecificUpdateUrl);
        if (kind === "noticia") {
          const latestNews = rankNews(latestMapped.filter(isTaxNews)).slice(0, 3);
          if (latestNews.length) return latestNews;
        }

        if (kind === "legislacao") {
          const latestLegislation = mergeUpdates(latestMapped, mockLegislacoes).filter(isSpecificUpdateUrl).sort(sortByDateDesc);
          if (latestLegislation.length) return latestLegislation.slice(0, 8);
        }
      }
    } catch {
      return kind === "legislacao" ? mockLegislacoes : rankNews(mockNoticias.filter(isTaxNews)).slice(0, 3);
    }
  }

  return kind === "legislacao" ? mockLegislacoes : rankNews(mockNoticias.filter(isTaxNews)).slice(0, 3);
}

function mapUpdateRow(row: UpdateRow): Noticia {
  const item: Noticia = {
    id: row.id,
    titulo: row.titulo,
    fonte: row.fonte || "Fonte",
    url: row.url,
    data: row.published_at || "",
    tipo: row.tipo || "noticia",
    sourceType: row.source_type || "oficial",
    sourceUrl: row.source_url || ""
  };

  if (item.tipo === "legislacao") {
    return {
      ...item,
      titulo: formatLegislationTitle(item)
    };
  }

  return item;
}

function isSpecificUpdateUrl(item: Noticia) {
  if (item.tipo === "legislacao" && !isNormativeLegislation(item)) return false;

  try {
    const parsed = new URL(item.url);
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const host = parsed.hostname.toLowerCase();

    if (item.tipo === "legislacao" && (host.includes("senado.leg.br") || host.includes("camara.leg.br"))) {
      return false;
    }

    if (host.includes("planalto.gov.br")) {
      return /\/leis\/lcp\/lcp\d|\/leis\/lcp\/lcp\d+compilado|\/_ato\d{4}-\d{4}\/\d{4}\//.test(path);
    }

    if (host.includes("normas.receita.fazenda.gov.br")) {
      return true;
    }

    if (host.includes("cgibs.gov.br")) {
      return path.includes("/upload/arquivos/");
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

function isNormativeLegislation(item: Noticia) {
  const title = normalizeText(item.titulo);
  const url = item.url.toLowerCase();

  if (!title || title.startsWith("-->") || title.includes("conteudo do") || title === "reforma tributaria") return false;
  if (title.includes("cigarro") || title.includes("especialista") || title.includes("pode reduzir consumo")) return false;
  if (title.includes("csibs n 1") || title.includes("csibs nº 1")) return false;
  if (url.includes("camara.leg.br/noticias") || url.includes("senado.leg.br/noticias")) return false;
  if (url.includes("cgibs.gov.br/regulamentos")) return false;

  return /\b(lei complementar|decreto|portaria conjunta|portaria|resolucao|instrucao normativa|ato declaratorio|convenio icms|ajuste sinief|protocolo icms)\b/.test(title);
}

function isTaxNews(item: Noticia) {
  const title = normalizeText(item.titulo);
  const haystack = normalizeText(`${item.titulo} ${item.url}`);
  const rejectedTitles = new Set([
    "arrecadacao e cobranca",
    "cidadania fiscal",
    "combate ao contrabando",
    "combate a corrupcao",
    "aduana e comercio exterior",
    "atendimento",
    "institucional"
  ]);

  if (rejectedTitles.has(title)) return false;
  if (title.includes("contrabando") || title.includes("corrupcao") || title.includes("cidadania fiscal")) return false;

  return [
    "tribut",
    "imposto",
    "icms",
    "iss",
    "simples nacional",
    "reforma tributaria",
    "ibs",
    "cbs",
    "imposto seletivo",
    "sped",
    "efd",
    "nf-e",
    "nfe",
    "nota fiscal",
    "contribuicao",
    "piscofins",
    "arrecadacao",
    "obrigacao acessoria",
    "receita federal do brasil"
  ].some((keyword) => haystack.includes(keyword));
}

function rankNews(items: Noticia[]) {
  return [...items].sort((a, b) => newsScore(b) - newsScore(a) || sortByDateDesc(a, b));
}

function newsScore(item: Noticia) {
  const haystack = normalizeText(`${item.titulo} ${item.url}`);
  let score = 0;
  if (haystack.includes("reforma tributaria") || haystack.includes("ibs") || haystack.includes("cbs")) score += 40;
  if (haystack.includes("imposto seletivo")) score += 28;
  if (haystack.includes("tribut") || haystack.includes("imposto")) score += 22;
  if (haystack.includes("icms") || haystack.includes("iss") || haystack.includes("simples nacional")) score += 18;
  if (haystack.includes("sped") || haystack.includes("efd") || haystack.includes("nota fiscal") || haystack.includes("nf-e")) score += 14;
  if (item.sourceType === "oficial") score += 8;
  score += dateWeight(item.data);
  return score;
}

function mergeUpdates(primary: Noticia[], fallback: Noticia[]) {
  const seen = new Set<string>();
  const merged: Noticia[] = [];

  for (const item of [...primary, ...fallback]) {
    const key = `${item.tipo || "noticia"}:${item.url.replace(/[#?].*$/, "")}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function sortByDateDesc(a: Noticia, b: Noticia) {
  return new Date(`${b.data || "1900-01-01"}T00:00:00`).getTime() - new Date(`${a.data || "1900-01-01"}T00:00:00`).getTime();
}

function dateWeight(value: string) {
  const date = new Date(`${value || ""}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return Math.max(0, 14 - ageDays);
}

function formatLegislationTitle(item: Noticia) {
  const url = item.url.toLowerCase();
  const title = item.titulo.trim();
  const normalizedTitle = normalizeText(title);

  if (url.includes("res-cgibs-n-6") || normalizedTitle.includes("res cgibs n 6") || normalizedTitle.includes("resolucao cgibs n 6")) {
    return "Resolucao CGIBS nº 6, de 30 de abril de 2026";
  }

  if (url.includes("portaria-conjunta") || normalizedTitle.includes("portaria conjunta")) {
    return "Portaria Conjunta MF/CGIBS nº 7, de 30 de abril de 2026";
  }

  if (url.includes("d12955") || normalizedTitle.includes("decreto n 12.955") || normalizedTitle.includes("decreto nº 12.955")) {
    return "Decreto nº 12.955, de 29 de abril de 2026";
  }

  if (url.includes("lcp227") || normalizedTitle.includes("lei complementar 227")) {
    return "Lei Complementar nº 227, de 13 de janeiro de 2026";
  }

  if (url.includes("lcp214") || normalizedTitle.includes("lei complementar 214")) {
    return "Lei Complementar nº 214, de 16 de janeiro de 2025";
  }

  return title;
}

function normalizeText(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}
