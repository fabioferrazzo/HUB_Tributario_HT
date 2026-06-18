const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,OPTIONS",
  "access-control-allow-headers": "content-type",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

const MONTH_SLUGS = {
  1: "janeiro",
  2: "fevereiro",
  3: "marco",
  4: "abril",
  5: "maio",
  6: "junho",
  7: "julho",
  8: "agosto",
  9: "setembro",
  10: "outubro",
  11: "novembro",
  12: "dezembro"
};

const MONTH_NAMES = {
  janeiro: 1,
  fevereiro: 2,
  marco: 3,
  março: 3,
  abril: 4,
  maio: 5,
  junho: 6,
  julho: 7,
  agosto: 8,
  setembro: 9,
  outubro: 10,
  novembro: 11,
  dezembro: 12
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return json(204, {});
  if (request.method !== "GET") return json(405, { error: "Metodo nao permitido." });

  const url = new URL(request.url);
  const year = clampInteger(url.searchParams.get("year"), 2020, 2035, new Date().getFullYear());
  const month = clampInteger(url.searchParams.get("month"), 1, 12, new Date().getMonth() + 1);

  try {
    return json(200, await fetchRfbAgenda(year, month));
  } catch (error) {
    return json(502, {
      error: error?.message || "Nao foi possivel consultar a Receita Federal.",
      sourceUrl: error?.sourceUrl || buildSourceUrl(year, month)
    });
  }
}

export async function fetchRfbAgenda(year, month) {
  const sourceUrl = buildSourceUrl(year, month);
  const response = await fetch(sourceUrl, {
    headers: {
      accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "user-agent": "HUB-Depto-Tributario/1.0 (+https://hub-depto-tributario-ht.netlify.app)"
    }
  });

  if (!response.ok) {
    const error = new Error(`Receita Federal respondeu ${response.status}.`);
    error.sourceUrl = sourceUrl;
    throw error;
  }

  const html = await response.text();
  const dates = parseAgendaHtml(html, year, month);

  if (!Object.keys(dates).length) {
    return {
      year,
      month,
      source: "Receita Federal",
      sourceUrl,
      updated: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
      critical: null,
      dates: {
        1: [
          {
            cat: "pj-fed",
            title: "Agenda Tributaria RFB - consultar fonte oficial",
            periodo: `${MONTH_SLUGS[month]}/${year}`,
            doc: "Receita Federal",
            base: "Fonte oficial",
            desc: "A pagina oficial foi acessada, mas o parser nao identificou vencimentos estruturados. Abra a fonte oficial para conferir e use a importacao manual se necessario."
          }
        ]
      },
      warning: "Parser nao encontrou eventos estruturados na pagina oficial."
    };
  }

  return {
    year,
    month,
    source: "Receita Federal",
    sourceUrl,
    updated: new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    critical: buildCritical(dates),
    dates
  };
}

function parseAgendaHtml(html, year, month) {
  const text = htmlToText(html);
  const events = [];

  collectDateChunks(text, year, month, events);
  collectDayHeadingChunks(text, month, events);

  const seen = new Set();
  const dates = {};

  for (const event of events) {
    const day = String(event.day);
    const title = cleanTitle(event.title);
    if (!title || title.length < 4) continue;

    const key = `${day}:${title}:${event.periodo || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);

    if (!dates[day]) dates[day] = [];
    dates[day].push({
      cat: categorize(title, event.desc),
      title,
      periodo: event.periodo || `${MONTH_SLUGS[month]}/${year}`,
      doc: "Receita Federal",
      base: "Agenda Tributaria da Receita Federal",
      desc: event.desc || "Vencimento identificado na agenda oficial da Receita Federal."
    });
  }

  return sortDates(dates);
}

function collectDateChunks(text, year, month, events) {
  const numericDate = /(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})/g;
  let match;

  while ((match = numericDate.exec(text))) {
    const day = Number(match[1]);
    const foundMonth = Number(match[2]);
    const foundYear = Number(match[3]);
    if (foundMonth !== month || foundYear !== year || day < 1 || day > 31) continue;

    const chunk = readChunkAfter(text, numericDate.lastIndex, 520);
    events.push(chunkToEvent(day, chunk, `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`));
  }
}

function collectDayHeadingChunks(text, month, events) {
  const monthName = MONTH_SLUGS[month];
  const dayHeading = new RegExp(`\\b(\\d{1,2})\\s+de\\s+${monthName}\\b`, "gi");
  let match;

  while ((match = dayHeading.exec(text))) {
    const day = Number(match[1]);
    if (day < 1 || day > 31) continue;

    const chunk = readChunkAfter(text, dayHeading.lastIndex, 520);
    events.push(chunkToEvent(day, chunk, `${String(day).padStart(2, "0")} de ${monthName}`));
  }
}

function chunkToEvent(day, chunk, periodo) {
  const lines = chunk
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^(agenda tributaria|receita federal|voltar|compartilhe|publicado em)/i.test(line));

  const title = lines.find((line) => likelyTitle(line)) || lines[0] || "Obrigacao tributaria";
  const desc = lines.filter((line) => line !== title).slice(0, 4).join(" ");

  return { day, title, desc: desc.slice(0, 420), periodo };
}

function likelyTitle(line) {
  const value = normalize(line);
  return /dctf|dirf|irpf|irpj|csll|pis|cofins|ipi|iof|darf|pgdas|simples|mei|efd|reinf|ecf|ecd|dimob|dmed|doi|dme|declara|contribui|imposto|retenc/.test(value);
}

function categorize(title, desc) {
  const value = normalize(`${title} ${desc}`);
  if (/simples|mei|pgdas|dasn|simei/.test(value)) return "simples";
  if (/irpf|carn[eê]|pessoa fisica|ganho de capital/.test(value)) return "pf";
  if (/dctf|dirf|efd|reinf|ecf|ecd|dimob|dmed|doi|dme|e-financeira|esocial|e-social|mit/.test(value)) return "pj-aces";
  if (/irrf|retenc|reten[cç][aã]o|fonte|iof/.test(value)) return "ret";
  if (/cpss|servidor|pensionista/.test(value)) return "serv";
  return "pj-fed";
}

function buildCritical(dates) {
  const entries = Object.entries(dates).sort((a, b) => b[1].length - a[1].length);
  if (!entries.length) return null;

  const [day, items] = entries[0];
  if (items.length < 3) return null;

  return {
    day: Number(day),
    text: `O dia <strong>${String(day).padStart(2, "0")}</strong> concentra ${items.length} obrigacoes/vencimentos identificados na agenda oficial da Receita Federal.`
  };
}

function readChunkAfter(text, index, length) {
  const nextDateIndex = text.slice(index).search(/\n\s*\d{1,2}(?:[\/.-]\d{1,2}[\/.-]\d{4}|\s+de\s+[a-zç]+)\b/i);
  const end = nextDateIndex > 40 ? index + Math.min(nextDateIndex, length) : index + length;
  return text.slice(index, end);
}

function cleanTitle(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/^[-–—:;.,\s]+/, "")
    .replace(/\s+[-–—:;.,]+$/, "")
    .slice(0, 150)
    .trim();
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<(br|p|div|li|tr|td|th|h[1-6])\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/[ \t\r\f\v]+/g, " ")
      .replace(/\n\s+/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
  );
}

function decodeEntities(value) {
  return value
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function sortDates(dates) {
  return Object.fromEntries(
    Object.entries(dates)
      .sort(([a], [b]) => Number(a) - Number(b))
      .map(([day, items]) => [day, items.slice(0, 12)])
  );
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildSourceUrl(year, month) {
  return `https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/${year}/${MONTH_SLUGS[month]}`;
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function json(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
