// Envia por e-mail à coordenação (administradores) a autoavaliação que o colaborador acabou de enviar,
// e avisa no sino do HUB. Só o próprio colaborador (ou um administrador) pode disparar o envio.
import { processDueEmails } from "./email-outbox.mjs";

const CRITERIOS = [
  ["producao", "Produção"],
  ["disposicoes", "Disposições do coordenador"],
  ["regras", "Regras do escritório"],
  ["erros", "Erros"],
  ["aprendizado", "Aprendizado"],
  ["atendimento", "Atendimento ao cliente"],
  ["autonomia", "Autonomia"]
];
const FEEDBACK = [
  ["gosta", "Dentre as atividades que você realiza hoje, o que você mais gosta?"],
  ["naoGosta", "O que você não gosta e gostaria de deixar de fazer?"],
  ["gostaria", "Qual atividade você não faz, mas gostaria de realizar?"]
];

export default async function handler(request) {
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });

  const supabaseUrl = trimUrl(getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL"));
  const anonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Variáveis Supabase ausentes no servidor." });

  try {
    const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
    if (!token) return json(401, { error: "Sessão do HUB não informada." });
    const authUser = await req(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
    if (!authUser?.id) return json(401, { error: "Sessão inválida." });

    const payload = await request.json().catch(() => ({}));
    const id = String(payload?.id || "");
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Avaliação inválida." });

    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
    const [avaliacao] = (await req(`${supabaseUrl}/rest/v1/avaliacoes?id=eq.${id}&select=*`, { headers })) || [];
    if (!avaliacao) return json(404, { error: "Avaliação não encontrada." });

    const profiles = (await req(`${supabaseUrl}/rest/v1/profiles?select=id,email,nome,role,active`, { headers })) || [];
    const me = profiles.find((p) => p.id === authUser.id);
    const isAdmin = me?.role === "admin" && me?.active !== false;
    if (avaliacao.user_id !== authUser.id && !isAdmin) return json(403, { error: "Sem permissão para esta avaliação." });
    if (avaliacao.status !== "enviada") return json(409, { error: "A avaliação ainda não foi enviada." });

    const admins = profiles.filter((p) => p.role === "admin" && p.active !== false && p.email);
    if (!admins.length) return json(500, { error: "Nenhum administrador ativo para receber a avaliação." });

    const appUrl = trimUrl(getEnv("APP_BASE_URL") || getEnv("URL") || "");
    const subject = `Autoavaliação ${avaliacao.competencia} - ${avaliacao.colaborador_nome}`;
    const html = buildHtml(avaliacao, appUrl);
    const text = buildText(avaliacao, appUrl);
    const dedupe = `avaliacao:${avaliacao.id}:${avaliacao.enviada_em || ""}`;

    for (const admin of admins) {
      await req(`${supabaseUrl}/rest/v1/rpc/queue_email`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          p_to_email: admin.email,
          p_to_name: admin.nome || null,
          p_subject: subject,
          p_html_body: html,
          p_text_body: text,
          p_category: "avaliacao",
          p_target_type: "avaliacao",
          p_target_ref: avaliacao.id,
          p_scheduled_for: new Date().toISOString(),
          p_dedupe_key: `${dedupe}:${admin.id}`,
          p_created_by: authUser.id
        })
      });
    }

    // Aviso no sino dos administradores (ignora duplicados).
    const now = new Date().toISOString();
    await fetch(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        admins.map((admin) => ({
          user_id: admin.id,
          tipo: "avaliacao",
          titulo: `Autoavaliação recebida: ${avaliacao.colaborador_nome}`,
          body: `Competência ${avaliacao.competencia}. Abra o HUB em Avaliações para avaliar.`,
          meta: JSON.stringify({ route: "avaliacoes", id: avaliacao.id }),
          target_type: "avaliacao",
          target_ref: avaliacao.id,
          dedupe_key: dedupe,
          route: "avaliacoes",
          tone: "info",
          active: true,
          created_at: now,
          updated_at: now
        }))
      )
    }).catch(() => null);

    const processed = await processDueEmails(supabaseUrl, serviceKey, admins.length).catch((error) => ({ error: error?.message }));
    const sent = Number(processed?.processed || 0) > 0;
    return json(200, {
      ok: true,
      message: sent ? "A coordenação recebeu por e-mail." : "O e-mail foi colocado na fila e sai no próximo envio automático."
    });
  } catch (error) {
    return json(400, { error: error?.message || "Não foi possível enviar a avaliação por e-mail." });
  }
}

function buildHtml(av, appUrl) {
  const auto = av.autoavaliacao || {};
  const notas = CRITERIOS.map(([id]) => auto[id]?.nota).filter((n) => typeof n === "number");
  const media = notas.length ? notas.reduce((s, n) => s + n, 0) / notas.length : null;
  const linhas = CRITERIOS.map(
    ([id, nome], i) =>
      `<tr><td style="border:1px solid #c9d1dc;padding:6px"><strong>${i + 1}. ${esc(nome)}</strong></td>` +
      `<td style="border:1px solid #c9d1dc;padding:6px;text-align:center">${fmt(auto[id]?.nota)}</td>` +
      `<td style="border:1px solid #c9d1dc;padding:6px">${esc(auto[id]?.justificativa || "")}</td></tr>`
  ).join("");
  const fb = FEEDBACK.map(([id, q], i) => `<p><strong>${i + 1}) ${esc(q)}</strong><br>${esc(av.feedback?.[id] || "—")}</p>`).join("");
  const link = appUrl ? `<p><a href="${esc(appUrl)}/#/avaliacoes">Abrir no HUB (Avaliações)</a></p>` : "";
  return (
    `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">` +
    `<p><strong>Autoavaliação recebida</strong></p>` +
    `<p>Colaborador: <strong>${esc(av.colaborador_nome)}</strong><br>Competência: <strong>${esc(av.competencia)}</strong></p>` +
    `<table style="border-collapse:collapse;width:100%"><thead><tr>` +
    `<th style="border:1px solid #c9d1dc;padding:6px;background:#eef1f6;text-align:left">Critério</th>` +
    `<th style="border:1px solid #c9d1dc;padding:6px;background:#eef1f6">Nota</th>` +
    `<th style="border:1px solid #c9d1dc;padding:6px;background:#eef1f6;text-align:left">Justificativa</th></tr></thead>` +
    `<tbody>${linhas}</tbody><tfoot><tr><td style="border:1px solid #c9d1dc;padding:6px"><strong>Média aritmética</strong></td>` +
    `<td style="border:1px solid #c9d1dc;padding:6px;text-align:center"><strong>${fmt(media)}</strong></td><td style="border:1px solid #c9d1dc"></td></tr></tfoot></table>` +
    `<p><strong>Feedback</strong></p>${fb}${link}</div>`
  );
}

function buildText(av, appUrl) {
  const auto = av.autoavaliacao || {};
  const linhas = CRITERIOS.map(([id, nome], i) => `${i + 1}. ${nome}: ${fmt(auto[id]?.nota)} - ${auto[id]?.justificativa || ""}`).join("\n");
  const fb = FEEDBACK.map(([id, q], i) => `${i + 1}) ${q}\n${av.feedback?.[id] || "—"}`).join("\n\n");
  return `Autoavaliação recebida\nColaborador: ${av.colaborador_nome}\nCompetência: ${av.competencia}\n\n${linhas}\n\nFeedback\n${fb}${appUrl ? `\n\n${appUrl}/#/avaliacoes` : ""}`;
}

async function req(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.message || data?.msg || data?.error || text || response.statusText);
  return data;
}

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("pt-BR", { maximumFractionDigits: 2 }) : "—";
}

function esc(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/\n/g, "<br>");
}

function json(status, body) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}
