// Rotina diaria da Agenda Tributaria (Netlify Scheduled Function).
//
// Todo dia as 06h15 (Brasilia) busca na Receita Federal o mes atual e o seguinte,
// junta as regras da SEFAZ-RS e o ISS municipal, grava no cache do Supabase quando
// algo mudou e avisa os administradores (sino do HUB e e-mail) quando:
//   - a agenda de um mes e publicada pela primeira vez;
//   - a Receita altera datas ja publicadas (prorrogacoes, inclusoes, exclusoes);
//   - a leitura do mes atual falha (possivel mudanca de formato no site da Receita).
// Para rodar na hora: painel do Netlify > Functions > agenda-sync > Run now.

import { fetchRfbAgenda } from "./rfb-agenda.mjs";
import { getSupabaseEnv, readCache, supabaseHeaders, upsertCache } from "./agenda-tributaria.mjs";
import { MONTH_LABELS, combineAgenda, describeAgendaChanges } from "../lib/agenda-regras.mjs";

export const config = {
  schedule: "15 9 * * *"
};

export default async function handler() {
  const supabase = getSupabaseEnv();
  if (!supabase) {
    console.error("agenda-sync: VITE_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY nao configurados.");
    return new Response("Supabase nao configurado.", { status: 500 });
  }

  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const current = { year: today.getFullYear(), month: today.getMonth() + 1 };
  const nextDate = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const next = { year: nextDate.getFullYear(), month: nextDate.getMonth() + 1 };
  const report = [];

  for (const target of [current, next]) {
    const isCurrent = target === current;
    const label = `${MONTH_LABELS[target.month - 1]}/${target.year}`;
    try {
      report.push(await syncMonth(supabase, target.year, target.month, isCurrent, label));
    } catch (error) {
      report.push(`${label}: erro ${error?.message || error}`);
      console.error(`agenda-sync ${label}:`, error);
    }
  }

  console.log("agenda-sync:", JSON.stringify(report));
  return new Response(JSON.stringify(report), { status: 200, headers: { "content-type": "application/json; charset=utf-8" } });
}

async function syncMonth(supabase, year, month, isCurrent, label) {
  const cached = await readCache(year, month);
  let federal = null;
  let failure = "";

  try {
    federal = await fetchRfbAgenda(year, month);
    if (federal.warning) failure = federal.warning;
  } catch (error) {
    failure = error?.message || "falha ao consultar a Receita Federal";
  }

  if (failure) {
    // Mes seguinte ainda nao publicado e normal; so alerta quando o mes atual nao pode ser lido.
    if (isCurrent) {
      await notifyAdmins(supabase, {
        dedupeKey: `agenda_falha:${year}-${month}:${todayKey()}`,
        tone: "warning",
        title: `Agenda ${label}: não foi possível ler a Receita Federal`,
        body: `A rotina diária não conseguiu ler a agenda oficial de ${label} (${failure}). ${cached ? "A versão gravada anteriormente continua em uso." : "A agenda está sendo montada só com as regras estaduais e municipais."} Confira a página oficial da Receita e avise o suporte se persistir.`,
        year,
        month
      });
    }
    return `${label}: Receita indisponível ou não publicada (${failure})${cached ? "; mantida versão gravada" : ""}`;
  }

  const agenda = combineAgenda(federal, year, month);

  if (!cached) {
    await upsertCache(agenda, "netlify-agenda-sync");
    await notifyAdmins(supabase, {
      dedupeKey: `agenda_publicada:${year}-${month}`,
      tone: "info",
      title: `Agenda Tributária de ${label} disponível`,
      body: `A agenda de ${label} foi sincronizada com a Receita Federal e as regras da SEFAZ-RS e do ISS municipal.`,
      year,
      month
    });
    return `${label}: gravada pela primeira vez`;
  }

  const changes = describeAgendaChanges(cached.dates, agenda.dates);
  if (!changes.changed) return `${label}: sem mudanças`;

  await upsertCache(agenda, "netlify-agenda-sync");
  const summary = changes.lines.slice(0, 8);
  const more = changes.lines.length > 8 ? [`... e mais ${changes.lines.length - 8} alteração(ões).`] : [];
  await notifyAdmins(supabase, {
    dedupeKey: `agenda_alterada:${year}-${month}:${hash(changes.lines.join("|"))}`,
    tone: "warning",
    title: `Agenda Tributária de ${label} alterada`,
    body: `A Receita Federal publicou alterações na agenda de ${label}:\n${[...summary, ...more].join("\n")}`,
    year,
    month
  });
  return `${label}: atualizada (${changes.moved} movidas, ${changes.added} novas, ${changes.removed} removidas)`;
}

async function notifyAdmins(supabase, { dedupeKey, tone, title, body, year, month }) {
  const headers = supabaseHeaders(supabase.key);
  const response = await fetch(`${supabase.url}/rest/v1/profiles?select=*`, { headers });
  if (!response.ok) throw new Error(`Supabase recusou leitura de perfis: ${response.status}`);
  const admins = ((await response.json()) || []).filter(
    (profile) => profile.role === "admin" && profile.active !== false && profile.id
  );
  if (!admins.length) return;

  const now = new Date().toISOString();
  const rows = admins.map((admin) => ({
    user_id: admin.id,
    tipo: "agenda_tributaria",
    titulo: title,
    body,
    meta: JSON.stringify({ route: "agenda", year, month }),
    target_type: "agenda_tributaria",
    target_ref: `${year}-${String(month).padStart(2, "0")}`,
    dedupe_key: dedupeKey,
    route: "agenda",
    tone,
    active: true,
    created_at: now,
    updated_at: now
  }));

  const insert = await fetch(`${supabase.url}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
    method: "POST",
    headers: { ...headers, prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(rows)
  });
  if (!insert.ok) console.error("agenda-sync: falha ao gravar notificacao", insert.status, await insert.text().catch(() => ""));

  const html = `<p><strong>${escapeHtml(title)}</strong></p><p>${escapeHtml(body).replace(/\n/g, "<br>")}</p><p>Abra o HUB em Agenda tributária para conferir.</p>`;
  for (const admin of admins) {
    if (!admin.email) continue;
    const email = await fetch(`${supabase.url}/rest/v1/rpc/queue_email`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        p_to_email: admin.email,
        p_subject: `HUB Depto Tributario - ${title}`,
        p_html_body: html,
        p_text_body: `${title}\n\n${body}`,
        p_category: "agenda",
        p_target_type: "agenda_tributaria",
        p_target_ref: `${year}-${String(month).padStart(2, "0")}`,
        p_dedupe_key: `${dedupeKey}:${admin.id}`,
        p_to_name: admin.nome || null
      })
    });
    if (!email.ok) console.error("agenda-sync: falha ao enfileirar e-mail", email.status, await email.text().catch(() => ""));
  }
}

function todayKey() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
}

function hash(value) {
  let result = 0;
  for (let index = 0; index < value.length; index += 1) result = (result * 31 + value.charCodeAt(index)) | 0;
  return Math.abs(result).toString(36);
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
