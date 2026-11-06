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
  if (request.method !== "GET") return json(405, { error: "Método não permitido." });

  const url = new URL(request.url);
  const year = clampInteger(url.searchParams.get("year"), 2020, 2035, new Date().getFullYear());
  const month = clampInteger(url.searchParams.get("month"), 1, 12, new Date().getMonth() + 1);

  try {
    return json(200, await fetchRfbAgenda(year, month));
  } catch (error) {
    return json(502, {
      error: error?.message || "Não foi possível consultar a Receita Federal.",
      sourceUrl: error?.sourceUrl || buildSourceUrl(year, month)
    });
  }
}

const RFB_REQUEST_HEADERS = {
  accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "user-agent": "HUB-Depto-Tributario/1.0 (+https://hub-depto-tributario-ht.netlify.app)"
};

// A Receita nao padroniza o endereco: ate jul/2026 usa "julho", a partir de ago/2026 usa "Agosto".
// Tenta as grafias conhecidas e, se nenhuma existir, procura o link do mes na pagina do ano.
async function fetchRfbMonthPage(year, month) {
  const slug = MONTH_SLUGS[month];
  const candidates = [slug, slug.charAt(0).toUpperCase() + slug.slice(1)];
  if (month === 3) candidates.push("março", "Março");

  let lastStatus = 0;
  for (const candidate of candidates) {
    const sourceUrl = buildSourceUrl(year, month, candidate);
    const response = await fetch(sourceUrl, { headers: RFB_REQUEST_HEADERS });
    if (response.ok) return { sourceUrl, html: await response.text() };
    lastStatus = response.status;
  }

  const discovered = await discoverMonthUrl(year, month);
  if (discovered) {
    const response = await fetch(discovered, { headers: RFB_REQUEST_HEADERS });
    if (response.ok) return { sourceUrl: discovered, html: await response.text() };
    lastStatus = response.status;
  }

  const error = new Error(`Receita Federal respondeu ${lastStatus || "sem resposta"}.`);
  error.sourceUrl = buildSourceUrl(year, month);
  throw error;
}

async function discoverMonthUrl(year, month) {
  try {
    const indexUrl = `https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/${year}`;
    const response = await fetch(indexUrl, { headers: RFB_REQUEST_HEADERS });
    if (!response.ok) return "";
    const html = await response.text();
    const pattern = new RegExp(`href="([^"]*/agenda-tributaria/${year}/([^"/?#]+))"`, "gi");
    for (const match of html.matchAll(pattern)) {
      if (normalize(decodeURIComponent(match[2])) === normalize(MONTH_SLUGS[month])) {
        return new URL(match[1], indexUrl).toString();
      }
    }
  } catch {
    return "";
  }
  return "";
}

export async function fetchRfbAgenda(year, month) {
  const { sourceUrl, html } = await fetchRfbMonthPage(year, month);
  // Desde 2026 a pagina do mes so traz o calendario; os vencimentos ficam em uma subpagina por dia.
  const dayLinks = findDayPageLinks(html, sourceUrl, year, month);
  let dates = dayLinks.length ? await fetchDayPages(dayLinks) : {};
  if (!Object.keys(dates).length) dates = parseAgendaHtml(html, year, month);

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
            title: "Agenda Tributária RFB – consultar a fonte oficial",
            periodo: `${MONTH_SLUGS[month]}/${year}`,
            doc: "Receita Federal",
            base: "Fonte oficial",
            desc: "A página oficial foi acessada, mas os vencimentos ainda não estão publicados em formato legível. Abra a fonte oficial para conferir e, se necessário, use a importação manual."
          }
        ]
      },
      warning: "Parser não encontrou eventos estruturados na página oficial."
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

function findDayPageLinks(html, baseUrl, year, month) {
  const links = new Map();
  const pattern = /href="([^"]*\/agenda-tributaria\/\d{4}\/[^"/]+\/[^"]*?dia(?:-|%20|\s)(\d{1,2})-(\d{1,2})-(\d{4})[^"]*)"/gi;
  for (const match of String(html || "").matchAll(pattern)) {
    const day = Number(match[2]);
    if (Number(match[3]) !== month || Number(match[4]) !== year || day < 1 || day > 31 || links.has(day)) continue;
    links.set(day, new URL(decodeEntities(match[1]), baseUrl).toString());
  }
  return Array.from(links, ([day, url]) => ({ day, url }));
}

async function fetchDayPages(dayLinks) {
  const results = await Promise.all(
    dayLinks.map(async ({ day, url }) => {
      try {
        const response = await fetch(url, { headers: RFB_REQUEST_HEADERS });
        if (!response.ok) return [day, []];
        return [day, groupDayRows(parseDayTableRows(await response.text()))];
      } catch {
        return [day, []];
      }
    })
  );

  const dates = {};
  for (const [day, items] of results) {
    if (items.length) dates[String(day)] = items;
  }
  return sortDates(dates);
}

function parseDayTableRows(html) {
  // A pagina de cada dia tem dois tipos de tabela:
  // 1) Tributos: cada registro ocupa duas linhas
  //      Codigo (rowspan 2) | Grupo | Descricao | Periodo de apuracao
  //      Documento | Categoria da declaracao/escrituracao | Fundamentacao legal
  // 2) Declaracoes: Interessado | Declaracao/documento | Periodo de referencia | Base normativa
  const rows = [];
  for (const tableMatch of String(html || "").matchAll(/<table[^>]*>([\s\S]*?)<\/table>/gi)) {
    let isDeclaracoes = false;
    let pending = null;
    for (const rowMatch of tableMatch[1].matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)) {
      const cells = Array.from(rowMatch[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi), (cell) =>
        htmlToText(cell[1]).replace(/\s+/g, " ").trim()
      );
      const joined = normalize(cells.join(" "));
      if (/^interessado\b/.test(normalize(cells[0] || "")) && /periodo de referencia/.test(joined)) {
        isDeclaracoes = true;
        continue;
      }
      if (/codigo de receita|grupo de tributo|documento arrecada|fundamentacao legal/.test(joined) && cells.every((cell) => cell.length < 60)) {
        pending = null;
        continue;
      }

      if (isDeclaracoes) {
        if (cells.length < 3) continue;
        const [interessado, nome, periodo, base = ""] = cells;
        if (nome) rows.push({ tipo: "declaracao", interessado, nome, periodo, base });
        continue;
      }

      if (cells.length >= 7) {
        const [codigo, grupo, descricao, periodo, documento, categoria, fundamento] = cells;
        rows.push({ tipo: "tributo", codigo, grupo, descricao, periodo, documento, categoria, fundamento });
        pending = null;
      } else if (cells.length === 4) {
        const [codigo, grupo, descricao, periodo] = cells;
        pending = { tipo: "tributo", codigo, grupo, descricao, periodo, documento: "", categoria: "", fundamento: "" };
        rows.push(pending);
      } else if (cells.length === 3 && pending) {
        [pending.documento, pending.categoria, pending.fundamento] = cells;
        pending = null;
      }
    }
  }
  return rows.filter((row) => (row.tipo === "declaracao" ? row.nome : row.grupo || row.descricao));
}

function categorizeTributo(grupo, descricao) {
  const g = normalize(grupo);
  const d = normalize(descricao);
  if (/simples|pgdas|dasn|simei|\bdas\b/.test(g)) return "simples";
  if (/^cpss/.test(g)) return "serv";
  if (/^irpf|carne/.test(g)) return "pf";
  if (/^(irrf|csrf|iof)\b/.test(g) || /^retencao/.test(d)) return "ret";
  return "pj-fed";
}

function categorizeDeclaracao(nome, interessado) {
  const value = normalize(`${nome} ${interessado}`);
  if (/pgdas|dasn|simples|simei|\bmei\b|defis/.test(value)) return "simples";
  if (/irpf|ajuste anual|espolio|carne-leao|ganho de capital/.test(value)) return "pf";
  return "pj-aces";
}

const escapeHtml = (value) =>
  String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// Os textos sao exibidos como HTML na agenda: escapa tudo o que vem do site da Receita.
function groupDayRows(rows) {
  return groupDayRowsRaw(rows).map((item) => ({
    ...item,
    title: escapeHtml(item.title),
    periodo: escapeHtml(item.periodo),
    doc: escapeHtml(item.doc),
    base: escapeHtml(item.base),
    desc: escapeHtml(item.desc)
  }));
}

function groupDayRowsRaw(rows) {
  const items = [];
  const groups = new Map();

  for (const row of rows) {
    if (row.tipo === "declaracao") {
      items.push({
        cat: categorizeDeclaracao(row.nome, row.interessado),
        title: cleanTitle(row.nome),
        periodo: row.periodo || "",
        doc: "Declaração / escrituração",
        base: row.base || "Agenda Tributária da Receita Federal",
        desc: row.interessado ? `Interessado: ${row.interessado}.` : ""
      });
      continue;
    }
    const key = [row.grupo, row.periodo, row.documento].map(normalize).join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }

  for (const groupRows of groups.values()) {
    const first = groupRows[0];
    const grupo = first.grupo || "Tributo federal";
    const title = groupRows.length === 1 ? `${grupo} – ${first.descricao}` : `${grupo} – ${groupRows.length} códigos de receita`;
    const listed = groupRows.slice(0, 12).map((item) => `${/^[-–\s]*$/.test(item.codigo || "") ? "" : item.codigo} ${item.descricao}`.trim());
    const more = groupRows.length > 12 ? ` e mais ${groupRows.length - 12}.` : "";
    const fundamentos = Array.from(new Set(groupRows.map((item) => item.fundamento).filter(Boolean))).slice(0, 4).join("; ");
    const categorias = Array.from(new Set(groupRows.map((item) => item.categoria).filter((value) => value && !/^-+( \/ -+)?$/.test(value)))).slice(0, 3).join("; ");
    items.push({
      cat: categorizeTributo(grupo, first.descricao),
      title: cleanTitle(title),
      periodo: first.periodo || "",
      doc: first.documento || "DARF",
      base: fundamentos || "Agenda Tributária da Receita Federal",
      desc: `${groupRows.length === 1 ? "Código" : "Códigos"}: ${listed.join("; ")}${more}${categorias ? ` Declaração/escrituração: ${categorias}.` : ""}`
    });
  }

  return items;
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
      base: "Agenda Tributária da Receita Federal",
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

  const title = lines.find((line) => likelyTitle(line)) || lines[0] || "Obrigação tributária";
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
    text: `O dia <strong>${String(day).padStart(2, "0")}</strong> concentra ${items.length} obrigações/vencimentos identificados na agenda oficial da Receita Federal.`
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
      .map(([day, items]) => [day, items])
  );
}

function normalize(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function buildSourceUrl(year, month, slug = MONTH_SLUGS[month]) {
  return `https://www.gov.br/receitafederal/pt-br/assuntos/agenda-tributaria/${year}/${encodeURIComponent(slug)}`;
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
