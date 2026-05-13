const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const KEYWORDS = [
  "tribut",
  "fiscal",
  "imposto",
  "receita",
  "sefaz",
  "icms",
  "iss",
  "simples nacional",
  "cnpj",
  "arrecad",
  "reforma tributaria",
  "reforma tributária",
  "ibs",
  "cbs",
  "comite gestor",
  "comitê gestor",
  "imposto seletivo",
  "contribuinte",
  "obrigacao acessoria",
  "nota fiscal",
  "sped"
];

const LEGISLATION_KEYWORDS = [
  "reforma tributaria",
  "reforma tributária",
  "ibs",
  "cbs",
  "comite gestor",
  "comitê gestor",
  "imposto seletivo",
  "lei complementar 214",
  "lei complementar 227",
  "lc 214",
  "lc 227",
  "lcp214",
  "lcp227",
  "lei complementar",
  "portaria conjunta",
  "resolucao cgibs",
  "instrucao normativa",
  "ato declaratorio",
  "decreto",
  "norma",
  "regulamento",
  "tributacao do consumo",
  "regulamentacao da reforma",
  "regulamentação da reforma"
];

const SOURCES = [
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Receita Federal",
    url: "https://www.gov.br/receitafederal/pt-br/assuntos/noticias",
    parser: "html",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Ministerio da Fazenda",
    url: "https://www.gov.br/fazenda/pt-br/assuntos/noticias/",
    parser: "html",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "SEFAZ/RS",
    url: "http://www.sefaz.rs.gov.br/Rss/noticiassefazrs.xml",
    parser: "rss",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Camara dos Deputados",
    url: "https://www.camara.leg.br/noticias/",
    parser: "html",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Senado Federal",
    url: "https://www12.senado.leg.br/noticias",
    parser: "html",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "especializada",
    fonte: "JOTA Tributos",
    url: "https://www.jota.info/tributos/feed",
    parser: "rss",
    keywords: KEYWORDS
  },
  {
    tipo: "noticia",
    sourceType: "especializada",
    fonte: "Portal Contabeis",
    url: "https://www.contabeis.com.br/rss/noticias/",
    parser: "rss",
    keywords: KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "SEFAZ/RS Legislacao",
    url: "http://www.sefaz.rs.gov.br/Rss/alteracaolegislacao.xml",
    parser: "rss",
    keywords: LEGISLATION_KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto - Leis Complementares",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/quadro_lcp.htm",
    parser: "html",
    keywords: LEGISLATION_KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Receita Federal - Normas",
    url: "https://normas.receita.fazenda.gov.br/sijut2consulta/consulta.action?tipoData=2&optOrdem=Publicacao_DESC&termoBusca=CBS+IBS",
    parser: "html",
    keywords: LEGISLATION_KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Comite Gestor do IBS",
    url: "https://www.cgibs.gov.br/regulamentos",
    parser: "html",
    keywords: LEGISLATION_KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Camara dos Deputados",
    url: "https://www.camara.leg.br/noticias/",
    parser: "html",
    keywords: LEGISLATION_KEYWORDS
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Senado Federal",
    url: "https://www12.senado.leg.br/noticias",
    parser: "html",
    keywords: LEGISLATION_KEYWORDS
  }
];

const FALLBACK_UPDATES = [
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Receita Federal",
    title: "Receita Federal e CFC iniciam capacitacao sobre a Reforma Tributaria do Consumo",
    url: "https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/maio/receita-federal-e-conselho-federal-de-contabilidade-iniciam-capacitacao-inedita-sobre-a-reforma-tributaria-do-consumo",
    publishedAt: "2026-05-12"
  },
  {
    tipo: "noticia",
    sourceType: "oficial",
    fonte: "Receita Federal",
    title: "Programacao do Curso Reforma Tributaria do Consumo",
    url: "https://www.gov.br/receitafederal/pt-br/acesso-a-informacao/acoes-e-programas/programas-e-atividades/reforma-tributaria-do-consumo/curso/programacao",
    publishedAt: "2026-05-06"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto",
    title: "Decreto 12.955/2026 - Regulamento da Contribuicao Social sobre Bens e Servicos (CBS)",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm",
    publishedAt: "2026-04-29"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Comite Gestor do IBS",
    title: "Resolucao CGIBS 6/2026 - Regulamento do IBS",
    url: "https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf",
    publishedAt: "2026-04-30"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Diario Oficial da Uniao",
    title: "Portaria Conjunta MF/CGIBS 7/2026 - disposicoes comuns a CBS e ao IBS",
    url: "https://www.in.gov.br/web/dou/-/portaria-conjunta-mf/cgibs-n-7-de-30-de-abril-de-2026-702822417",
    publishedAt: "2026-04-30"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto",
    title: "Lei Complementar 227/2026 - Comite Gestor do IBS e processo administrativo tributario do IBS",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm",
    publishedAt: "2026-01-13"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto",
    title: "Lei Complementar 214/2025 - institui IBS, CBS e Imposto Seletivo",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/Lcp214compilado.htm",
    publishedAt: "2025-01-16"
  }
];

export default async function handler() {
  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return json(500, { error: "Variaveis Supabase ausentes no servidor." });
  }

  const collected = [];
  const errors = [];

  for (const source of SOURCES) {
    try {
      const items = await fetchSource(source);
      collected.push(...items);
    } catch (error) {
      errors.push({ fonte: source.fonte, error: getErrorMessage(error) });
    }
  }

  const uniqueItems = uniqueByUrl([...collected, ...fallbackItems()])
    .filter(isSpecificUpdateUrl)
    .slice(0, 80);
  const saved = uniqueItems.length ? await upsertUpdates(supabaseUrl, serviceRoleKey, uniqueItems) : [];
  await removeExpiredUpdates(supabaseUrl, serviceRoleKey);

  return json(200, {
    collected: collected.length,
    saved: Array.isArray(saved) ? saved.length : uniqueItems.length,
    errors
  });
}

export const config = {
  schedule: "@daily"
};

async function fetchSource(source) {
  const text = await fetchText(source.url);
  const parsed = looksLikeXml(text) ? parseRss(text, source) : parseHtmlLinks(text, source);
  return parsed
    .filter((item) => item.titulo.length > 12 && item.url.startsWith("http"))
    .filter((item) => !isBadTitle(item.titulo))
    .filter(isSpecificUpdateUrl)
    .filter((item) => isRelevant(item, source.keywords))
    .filter((item) => source.tipo === "legislacao" || isRecent(item.published_at))
    .slice(0, 12);
}

function fallbackItems() {
  return FALLBACK_UPDATES.map((item) =>
    buildUpdate({
      source: {
        tipo: item.tipo,
        sourceType: item.sourceType,
        fonte: item.fonte,
        url: item.url
      },
      title: item.title,
      url: item.url,
      description: "",
      publishedAt: item.publishedAt
    })
  );
}

async function fetchText(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "HUB Depto Tributario/1.0 (+https://hub-depto-tributario-ht.netlify.app)"
    }
  });

  if (!response.ok) {
    throw new Error(`Falha ao buscar ${url}: ${response.status}`);
  }

  return response.text();
}

function parseRss(xml, source) {
  const blocks = [
    ...[...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]),
    ...[...xml.matchAll(/<entry\b[\s\S]*?<\/entry>/gi)].map((match) => match[0])
  ];
  return blocks.map((block) => {
    const title = decodeXml(readTag(block, "title"));
    const link = decodeXml(readTag(block, "link") || readTagAttribute(block, "link", "href") || readTag(block, "guid"));
    const description = decodeXml(readTag(block, "description") || readTag(block, "summary") || readTag(block, "content"));
    const publishedAt = normalizeDate(
      readTag(block, "pubDate") || readTag(block, "published") || readTag(block, "updated") || readTag(block, "dc:date") || readTag(block, "date")
    );

    return buildUpdate({
      source,
      title,
      url: link,
      description,
      publishedAt
    });
  });
}

function parseHtmlLinks(html, source) {
  const links = [...html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  return links
    .map((match) => {
      const anchor = match[0];
      const url = toAbsoluteUrl(decodeHtml(match[1]), source.url);
      const title = cleanText(decodeHtml(stripTags(match[2]))) || decodeHtml(readTagAttribute(anchor, "a", "title")) || decodeHtml(readTagAttribute(anchor, "a", "aria-label"));
      return buildUpdate({
        source,
        title,
        url,
        description: "",
        publishedAt: findNearbyDate(html, match.index || 0)
      });
    })
    .filter((item) => item.titulo.length > 12 && item.url.startsWith("http"));
}

function buildUpdate({ source, title, url, description, publishedAt }) {
  return {
    titulo: cleanText(title).slice(0, 240),
    fonte: source.fonte,
    url: cleanText(url),
    published_at: publishedAt || todayIsoDate(),
    expires_at: addDaysIsoDate(publishedAt || todayIsoDate(), 7),
    active: true,
    tipo: source.tipo,
    source_type: source.sourceType,
    source_url: source.url,
    description: cleanText(description)
  };
}

async function upsertUpdates(supabaseUrl, serviceRoleKey, items) {
  return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/noticias?on_conflict=tipo,url&select=id`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(
      items.map((item) => ({
        titulo: item.titulo,
        fonte: item.fonte,
        url: item.url,
        published_at: item.published_at,
        expires_at: item.expires_at,
        active: item.active,
        tipo: item.tipo,
        source_type: item.source_type,
        source_url: item.source_url
      }))
    )
  });
}

async function removeExpiredUpdates(supabaseUrl, serviceRoleKey) {
  const cutoff = addDaysIsoDate(todayIsoDate(), -7);
  return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/noticias?tipo=eq.noticia&published_at=lt.${cutoff}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey)
  });
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw new Error(extractSupabaseMessage(data, text, response.statusText));
  }

  return data;
}

function isRelevant(item, keywords) {
  const haystack = normalize(`${item.titulo} ${item.description || ""} ${item.fonte} ${item.url} ${item.source_url || ""}`);
  return keywords.some((keyword) => haystack.includes(normalize(keyword)));
}

function isRecent(value) {
  if (!value) return true;
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return true;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 8);
  return date >= cutoff;
}

function uniqueByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.url || !item.titulo) return false;
    const key = `${item.tipo}:${item.url.replace(/[#?].*$/, "")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isSpecificUpdateUrl(item) {
  try {
    const parsed = new URL(item.url);
    const host = parsed.hostname.toLowerCase();
    const path = parsed.pathname.replace(/\/+$/, "").toLowerCase();
    const segments = path.split("/").filter(Boolean);

    if (!path || path === "/") return false;
    if (host.includes("www4.planalto.gov.br") && path === "/legislacao") return false;

    if (host.includes("planalto.gov.br")) {
      return /\/ccivil_03\/leis\/lcp\/lcp\d/.test(path) || /\/ccivil_03\/_ato\d{4}-\d{4}\/\d{4}\//.test(path);
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
      if (path.endsWith("/pt-br") || path.endsWith("/assuntos/noticias")) return false;
      return path.includes("/assuntos/noticias/") || path.includes("/reforma-tributaria-do-consumo/");
    }

    if (host.includes("sefaz.rs.gov.br")) {
      return segments.length >= 1 && !["home", "inicial"].includes(segments.at(-1) || "");
    }

    if (host.includes("senado.leg.br") || host.includes("camara.leg.br")) {
      return segments.length >= 2 && segments.at(-1) !== "noticias";
    }

    if (host.includes("jota.info") || host.includes("contabeis.com.br")) {
      return segments.length >= 2;
    }

    return segments.length >= 2;
  } catch {
    return false;
  }
}

function isBadTitle(title) {
  const normalized = normalize(title);
  const blockedExact = new Set([
    "noticias",
    "legislacao",
    "receita federal",
    "ministerio da fazenda",
    "camara dos deputados",
    "senado federal",
    "acesse",
    "leia mais",
    "saiba mais",
    "compartilhe",
    "pagina inicial"
  ]);

  return (
    blockedExact.has(normalized) ||
    normalized.includes("compartilhe") ||
    normalized.includes("copiar para area de transferencia") ||
    normalized.includes("seu navegador") ||
    normalized.includes("menu")
  );
}

function readTag(block, tag) {
  const escapedTag = tag.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() || "";
}

function readTagAttribute(block, tag, attribute) {
  const escapedTag = tag.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escapedTag}\\b[^>]*\\s${attribute}=["']([^"']+)["'][^>]*>`, "i"));
  return match?.[1]?.trim() || "";
}

function findNearbyDate(html, index) {
  const start = Math.max(0, index - 280);
  const end = Math.min(html.length, index + 280);
  const text = stripTags(html.slice(start, end));
  const brDate = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  const isoDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  return todayIsoDate();
}

function normalizeDate(value) {
  if (!value) return todayIsoDate();
  const date = new Date(value);
  if (!Number.isNaN(date.getTime())) return date.toISOString().slice(0, 10);
  const brDate = value.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  return todayIsoDate();
}

function todayIsoDate() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysIsoDate(value, days) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function toAbsoluteUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function looksLikeXml(value) {
  return /<(rss|feed|item|entry)\b/i.test(value);
}

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function stripTags(value) {
  return String(value || "").replace(/<[^>]+>/g, " ");
}

function decodeXml(value) {
  return decodeHtml(value).replace(/<!\[CDATA\[|\]\]>/g, "");
}

function decodeHtml(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function trimUrl(url) {
  return String(url || "").replace(/\/$/, "");
}

function parseJson(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function extractSupabaseMessage(data, text, fallback) {
  if (data?.message) return data.message;
  if (data?.error_description) return data.error_description;
  if (data?.error) return typeof data.error === "string" ? data.error : JSON.stringify(data.error);
  return text || fallback || "Falha Supabase.";
}

function getErrorMessage(error) {
  return error instanceof Error ? error.message : "Falha ao atualizar noticias.";
}

function getEnv(name) {
  return process.env[name] || "";
}

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
