import { fetchRfbAgenda } from "./rfb-agenda.mjs";

const JSON_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type,x-agenda-sync-token",
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

export const config = {
  path: "/api/agenda-tributaria",
  method: ["GET", "POST", "OPTIONS"]
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return json(204, {});

  try {
    if (request.method === "GET") return await handleGet(request);
    if (request.method === "POST") return await handlePost(request);
    return json(405, { error: "Metodo nao permitido." });
  } catch (error) {
    return json(500, { error: error?.message || "Falha ao processar agenda tributaria." });
  }
}

async function handleGet(request) {
  const url = new URL(request.url);
  const year = clampInteger(url.searchParams.get("year"), 2020, 2035, new Date().getFullYear());
  const month = clampInteger(url.searchParams.get("month"), 1, 12, new Date().getMonth() + 1);
  const refresh = url.searchParams.get("refresh") === "1";

  if (!refresh) {
    const cached = await readCache(year, month);
    if (cached) return json(200, { ...cached, cached: true });
  }

  const agenda = await fetchRfbAgenda(year, month);
  return json(200, { ...agenda, cached: false });
}

async function handlePost(request) {
  const url = new URL(request.url);
  const expectedToken = getEnv("AGENDA_SYNC_TOKEN");
  const token = request.headers.get("x-agenda-sync-token") || url.searchParams.get("token") || "";

  if (!expectedToken) return json(500, { error: "AGENDA_SYNC_TOKEN nao configurado no Netlify." });
  if (token !== expectedToken) return json(401, { error: "Token invalido para sincronizar agenda." });

  const body = await readJson(request);
  const now = new Date();
  const year = clampInteger(body.year ?? url.searchParams.get("year"), 2020, 2035, now.getFullYear());
  const month = clampInteger(body.month ?? url.searchParams.get("month"), 1, 12, now.getMonth() + 1);
  const agenda = mergeExtraDates(await fetchRfbAgenda(year, month), body.dates || body.extraDates);
  const saved = await upsertCache(agenda, body.updatedBy || "make");

  return json(200, { saved: true, ...saved });
}

async function readCache(year, month) {
  const supabase = getSupabaseEnv();
  if (!supabase) return null;

  const endpoint = `${supabase.url}/rest/v1/agenda_tributaria_cache?year=eq.${year}&month=eq.${month}&select=*&limit=1`;
  const response = await fetch(endpoint, {
    headers: supabaseHeaders(supabase.key)
  });

  if (!response.ok) return null;
  const rows = await response.json().catch(() => []);
  const row = rows?.[0];
  if (!row?.dates) return null;
  return rowToAgenda(row);
}

async function upsertCache(agenda, updatedBy) {
  const supabase = getSupabaseEnv();
  if (!supabase) throw new Error("VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao configurados.");

  const row = {
    year: agenda.year,
    month: agenda.month,
    source: agenda.source || "Receita Federal",
    source_url: agenda.sourceUrl || null,
    updated_label: agenda.updated || new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }),
    critical: agenda.critical || null,
    dates: agenda.dates || {},
    updated_by: updatedBy,
    synced_at: new Date().toISOString()
  };

  const response = await fetch(`${supabase.url}/rest/v1/agenda_tributaria_cache?on_conflict=year,month`, {
    method: "POST",
    headers: {
      ...supabaseHeaders(supabase.key),
      prefer: "resolution=merge-duplicates,return=representation"
    },
    body: JSON.stringify(row)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase recusou cache da agenda: ${detail || response.status}`);
  }

  const saved = await response.json().catch(() => [row]);
  return rowToAgenda(saved?.[0] || row);
}

function rowToAgenda(row) {
  return {
    year: row.year,
    month: row.month,
    source: row.source || "Receita Federal",
    sourceUrl: row.source_url || "",
    updated: row.updated_label || formatDate(row.synced_at),
    syncedAt: row.synced_at || row.updated_at || null,
    critical: row.critical || null,
    dates: row.dates || {}
  };
}

function mergeExtraDates(agenda, extraDates) {
  if (!extraDates || typeof extraDates !== "object") return agenda;
  const merged = JSON.parse(JSON.stringify(agenda.dates || {}));

  for (const [day, items] of Object.entries(extraDates)) {
    if (!Array.isArray(items)) continue;
    merged[day] = [...(merged[day] || []), ...items.map((item) => ({
      cat: item.cat || "sefaz",
      title: item.title || "Obrigacao tributaria",
      periodo: item.periodo || "",
      doc: item.doc || "Sefaz/RS",
      base: item.base || "Fonte oficial",
      desc: item.desc || ""
    }))];
  }

  return {
    ...agenda,
    source: "Receita Federal / Sefaz-RS",
    dates: Object.fromEntries(Object.entries(merged).sort(([a], [b]) => Number(a) - Number(b)))
  };
}

function getSupabaseEnv() {
  const url = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const key = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  return { url: url.replace(/\/$/, ""), key };
}

function supabaseHeaders(key) {
  return {
    apikey: key,
    authorization: `Bearer ${key}`,
    "content-type": "application/json"
  };
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || "";
}

async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < min || number > max) return fallback;
  return number;
}

function formatDate(value) {
  if (!value) return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

function json(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}
