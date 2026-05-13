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
    title: "Decreto nº 12.955, de 29 de abril de 2026",
    url: "https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2026/decreto/d12955.htm",
    publishedAt: "2026-04-29"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Comite Gestor do IBS",
    title: "Resolucao CGIBS nº 6, de 30 de abril de 2026",
    url: "https://www.cgibs.gov.br/upload/arquivos/202604/30084927-res-cgibs-n-6-30-abr-2026-regulamenta-o-ibs.pdf",
    publishedAt: "2026-04-30"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Diario Oficial da Uniao",
    title: "Portaria Conjunta MF/CGIBS nº 7, de 30 de abril de 2026",
    url: "https://www.in.gov.br/web/dou/-/portaria-conjunta-mf/cgibs-n-7-de-30-de-abril-de-2026-702822417",
    publishedAt: "2026-04-30"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto",
    title: "Lei Complementar nº 227, de 13 de janeiro de 2026",
    url: "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp227.htm",
    publishedAt: "2026-01-13"
  },
  {
    tipo: "legislacao",
    sourceType: "oficial",
    fonte: "Planalto",
    title: "Lei Complementar nº 214, de 16 de janeiro de 2025",
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
    .filter((item) => item.tipo !== "noticia" || isTaxNews(item))
    .filter((item) => item.tipo !== "legislacao" || isNormativeLegislation(item));
  const publishItems = [
    ...rankNews(uniqueItems.filter((item) => item.tipo === "noticia")).slice(0, 3),
    ...rankLegislation(uniqueItems.filter((item) => item.tipo === "legislacao")).slice(0, 20)
  ];
  await removeRejectedLegislationUpdates(supabaseUrl, serviceRoleKey);
  await removeRejectedNewsUpdates(supabaseUrl, serviceRoleKey);
  const saved = publishItems.length ? await upsertUpdates(supabaseUrl, serviceRoleKey, publishItems) : [];
  await removeExpiredUpdates(supabaseUrl, serviceRoleKey);

  return json(200, {
    collected: collected.length,
    saved: Array.isArray(saved) ? saved.length : publishItems.length,
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
    .map(normalizeUpdate)
    .filter((item) => item.titulo.length > 12 && item.url.startsWith("http"))
    .filter((item) => !isBadTitle(item.titulo))
    .filter(isSpecificUpdateUrl)
    .filter((item) => source.tipo !== "noticia" || isTaxNews(item))
    .filter((item) => source.tipo !== "legislacao" || isNormativeLegislation(item))
    .filter((item) => isRelevant(item, source.keywords))
    .filter((item) => source.tipo === "legislacao" || isRecent(item.published_at))
    .slice(0, source.tipo === "noticia" ? 6 : 12);
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
  const item = {
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

  return normalizeUpdate(item);
}

function normalizeUpdate(item) {
  if (item.tipo !== "legislacao") return item;

  return {
    ...item,
    titulo: formatLegislationTitle(item)
  };
}

function formatLegislationTitle(item) {
  const url = item.url.toLowerCase();
  const title = cleanText(item.titulo);
  const normalizedTitle = normalize(title);

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

  const normMatch = title.match(
    /\b(Lei Complementar|Decreto|Portaria(?:\s+Conjunta)?|Resolucao|Resolu[cç][aã]o|Instrucao Normativa|Instru[cç][aã]o Normativa|Ato Declaratorio|Ato Declarat[oó]rio|Convenio ICMS|Conv[eê]nio ICMS|Ajuste SINIEF)\s*(?:n[ºo.]*)?\s*([\w./-]+)/i
  );
  const date = extractDateText(title);

  if (normMatch && date) {
    return `${normalizeNormKind(normMatch[1])} nº ${normMatch[2].replace(/^0+/, "")}, de ${date}`;
  }

  if (normMatch) {
    return `${normalizeNormKind(normMatch[1])} nº ${normMatch[2].replace(/^0+/, "")}`;
  }

  return title;
}

function normalizeNormKind(value) {
  const normalized = normalize(value);
  if (normalized.includes("lei complementar")) return "Lei Complementar";
  if (normalized.includes("portaria conjunta")) return "Portaria Conjunta";
  if (normalized.includes("resolucao")) return "Resolucao";
  if (normalized.includes("instrucao normativa")) return "Instrucao Normativa";
  if (normalized.includes("ato declaratorio")) return "Ato Declaratorio";
  if (normalized.includes("convenio icms")) return "Convenio ICMS";
  if (normalized.includes("ajuste sinief")) return "Ajuste SINIEF";
  if (normalized.includes("decreto")) return "Decreto";
  return cleanText(value);
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

async function removeRejectedLegislationUpdates(supabaseUrl, serviceRoleKey) {
  const filters = [
    [
      ["tipo", "eq.legislacao"],
      ["url", "like.*camara.leg.br/noticias*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["url", "like.*senado.leg.br/noticias*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["source_url", "like.*camara.leg.br/noticias*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["source_url", "like.*senado.leg.br/noticias*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["url", "like.*cgibs.gov.br/regulamentos*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["titulo", "ilike.*cigarro*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["titulo", "ilike.*conteudo do*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["titulo", "like.-->*"]
    ],
    [
      ["tipo", "eq.legislacao"],
      ["titulo", "ilike.*csibs*"]
    ]
  ];

  await Promise.allSettled(
    filters.map((pairs) => {
      const params = new URLSearchParams(pairs);
      return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/noticias?${params.toString()}`, {
        method: "DELETE",
        headers: serviceHeaders(serviceRoleKey)
      });
    })
  );
}

async function removeRejectedNewsUpdates(supabaseUrl, serviceRoleKey) {
  const filters = [
    [
      ["tipo", "eq.noticia"],
      ["titulo", "ilike.Arrecadação e Cobrança"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["titulo", "ilike.Cidadania Fiscal"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["titulo", "ilike.Combate ao contrabando"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["titulo", "ilike.Combate à corrupção"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["titulo", "ilike.Aduana e Comércio Exterior"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["url", "like.*/assuntos/noticias/arrecadacao-e-cobranca"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["url", "like.*/assuntos/noticias/cidadania"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["url", "like.*/assuntos/noticias/contrabando"]
    ],
    [
      ["tipo", "eq.noticia"],
      ["url", "like.*/assuntos/noticias/corrupcao"]
    ]
  ];

  await Promise.allSettled(
    filters.map((pairs) => {
      const params = new URLSearchParams(pairs);
      return supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/noticias?${params.toString()}`, {
        method: "DELETE",
        headers: serviceHeaders(serviceRoleKey)
      });
    })
  );
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
    if (item.tipo === "legislacao" && (host.includes("senado.leg.br") || host.includes("camara.leg.br"))) return false;

    if (host.includes("planalto.gov.br")) {
      return /\/ccivil_03\/leis\/lcp\/lcp\d/.test(path) || /\/ccivil_03\/_ato\d{4}-\d{4}\/\d{4}\//.test(path);
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

function isNormativeLegislation(item) {
  const title = normalize(item.titulo);
  const url = item.url.toLowerCase();

  if (!title || title.startsWith("-->") || title.includes("conteudo do") || title === "reforma tributaria") return false;
  if (title.includes("cigarro") || title.includes("especialista") || title.includes("pode reduzir consumo")) return false;
  if (title.includes("csibs n 1") || title.includes("csibs nº 1")) return false;
  if (url.includes("camara.leg.br/noticias") || url.includes("senado.leg.br/noticias")) return false;
  if (url.includes("cgibs.gov.br/regulamentos")) return false;

  return /\b(lei complementar|decreto|portaria conjunta|portaria|resolucao|instrucao normativa|ato declaratorio|convenio icms|ajuste sinief|protocolo icms)\b/.test(title);
}

function isTaxNews(item) {
  const title = normalize(item.titulo);
  const haystack = normalize(`${item.titulo} ${item.description || ""} ${item.url}`);
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

function rankNews(items) {
  return [...items].sort((a, b) => newsScore(b) - newsScore(a) || sortByDateDesc(a, b));
}

function rankLegislation(items) {
  return [...items].sort(sortByDateDesc);
}

function newsScore(item) {
  const haystack = normalize(`${item.titulo} ${item.description || ""} ${item.url}`);
  let score = 0;
  if (haystack.includes("reforma tributaria") || haystack.includes("ibs") || haystack.includes("cbs")) score += 40;
  if (haystack.includes("imposto seletivo")) score += 28;
  if (haystack.includes("tribut") || haystack.includes("imposto")) score += 22;
  if (haystack.includes("icms") || haystack.includes("iss") || haystack.includes("simples nacional")) score += 18;
  if (haystack.includes("sped") || haystack.includes("efd") || haystack.includes("nota fiscal") || haystack.includes("nf-e")) score += 14;
  if (item.source_type === "oficial") score += 8;
  score += dateWeight(item.published_at);
  return score;
}

function sortByDateDesc(a, b) {
  return new Date(`${b.published_at || "1900-01-01"}T00:00:00`).getTime() - new Date(`${a.published_at || "1900-01-01"}T00:00:00`).getTime();
}

function dateWeight(value) {
  const date = new Date(`${value || ""}T00:00:00`);
  if (Number.isNaN(date.getTime())) return 0;
  const ageDays = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  return Math.max(0, 14 - ageDays);
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
    "arrecadacao e cobranca",
    "cidadania fiscal",
    "combate ao contrabando",
    "combate a corrupcao",
    "aduana e comercio exterior",
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
  const textDate = extractDateText(text);
  if (textDate) return isoFromPtDateText(textDate);
  const brDate = text.match(/\b(\d{2})\/(\d{2})\/(\d{4})\b/);
  if (brDate) return `${brDate[3]}-${brDate[2]}-${brDate[1]}`;
  const isoDate = text.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (isoDate) return `${isoDate[1]}-${isoDate[2]}-${isoDate[3]}`;
  return todayIsoDate();
}

function extractDateText(value) {
  const text = cleanText(value);
  const longDate = text.match(/\b(\d{1,2})\s+de\s+(janeiro|fevereiro|mar[cç]o|abril|maio|junho|julho|agosto|setembro|outubro|novembro|dezembro)\s+de\s+(20\d{2})\b/i);
  if (longDate) return `${longDate[1]} de ${normalizeMonthName(longDate[2])} de ${longDate[3]}`;

  const shortDate = text.match(/\b(\d{1,2})\s+(jan|fev|mar|abr|mai|jun|jul|ago|set|out|nov|dez)\s+(20\d{2})\b/i);
  if (shortDate) return `${shortDate[1]} de ${monthNameFromShort(shortDate[2])} de ${shortDate[3]}`;

  return "";
}

function isoFromPtDateText(value) {
  const match = value.match(/\b(\d{1,2})\s+de\s+([a-zç]+)\s+de\s+(20\d{2})\b/i);
  if (!match) return todayIsoDate();
  const month = monthNumber(match[2]);
  if (!month) return todayIsoDate();
  return `${match[3]}-${month}-${String(Number(match[1])).padStart(2, "0")}`;
}

function normalizeMonthName(value) {
  const month = normalize(value);
  if (month === "marco") return "marco";
  return month;
}

function monthNameFromShort(value) {
  const months = {
    jan: "janeiro",
    fev: "fevereiro",
    mar: "marco",
    abr: "abril",
    mai: "maio",
    jun: "junho",
    jul: "julho",
    ago: "agosto",
    set: "setembro",
    out: "outubro",
    nov: "novembro",
    dez: "dezembro"
  };
  return months[normalize(value).slice(0, 3)] || "";
}

function monthNumber(value) {
  const months = {
    janeiro: "01",
    fevereiro: "02",
    marco: "03",
    abril: "04",
    maio: "05",
    junho: "06",
    julho: "07",
    agosto: "08",
    setembro: "09",
    outubro: "10",
    novembro: "11",
    dezembro: "12"
  };
  return months[normalize(value)];
}

function normalizeDate(value) {
  if (!value) return todayIsoDate();
  const textDate = extractDateText(value);
  if (textDate) return isoFromPtDateText(textDate);
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
