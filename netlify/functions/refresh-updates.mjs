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
  "imposto seletivo"
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
  "lc 214",
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
    fonte: "Planalto Legislacao",
    url: "http://www4.planalto.gov.br/legislacao",
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

  const uniqueItems = uniqueByUrl(collected).slice(0, 80);
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
    .filter((item) => isRelevant(item, source.keywords))
    .filter((item) => isRecent(item.publishedAt))
    .slice(0, 12);
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
  const blocks = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((match) => match[0]);
  return blocks.map((block) => {
    const title = decodeXml(readTag(block, "title"));
    const link = decodeXml(readTag(block, "link") || readTag(block, "guid"));
    const description = decodeXml(readTag(block, "description"));
    const publishedAt = normalizeDate(readTag(block, "pubDate") || readTag(block, "dc:date") || readTag(block, "date"));

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
      const url = toAbsoluteUrl(decodeHtml(match[1]), source.url);
      const title = cleanText(decodeHtml(stripTags(match[2])));
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
  return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/noticias?published_at=lt.${cutoff}`, {
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
  const haystack = normalize(`${item.titulo} ${item.description || ""} ${item.fonte}`);
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

function readTag(block, tag) {
  const escapedTag = tag.replace(":", "\\:");
  const match = block.match(new RegExp(`<${escapedTag}[^>]*>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  return match?.[1]?.replace(/^<!\[CDATA\[|\]\]>$/g, "").trim() || "";
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
