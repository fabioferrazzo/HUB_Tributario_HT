// Avisos da avaliação por desempenho, por e-mail e no sino do HUB:
// - envio:     o colaborador enviou a autoavaliação → administradores (coordenação);
// - devolvida: a coordenação devolveu a avaliação → colaborador;
// - replica:   o colaborador respondeu às recomendações → administradores.
// Quem dispara precisa ter permissão sobre a avaliação (dono ou administrador, conforme o tipo).
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
  ["gostaria", "Qual atividade você não faz, mas gostaria de realizar?"],
  ["sugestoes", "Sugestões e críticas"]
];
const TIPOS = ["envio", "devolvida", "replica"];
const CELL = "border:1px solid #c9d1dc;padding:6px";
const HEAD = `${CELL};background:#eef1f6`;

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
    const tipo = TIPOS.includes(payload?.tipo) ? payload.tipo : "envio";
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Avaliação inválida." });

    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
    const [avaliacao] = (await req(`${supabaseUrl}/rest/v1/avaliacoes?id=eq.${id}&select=*`, { headers })) || [];
    if (!avaliacao) return json(404, { error: "Avaliação não encontrada." });

    const profiles = (await req(`${supabaseUrl}/rest/v1/profiles?select=id,email,nome,role,active`, { headers })) || [];
    const me = profiles.find((p) => p.id === authUser.id);
    const isAdmin = me?.role === "admin" && me?.active !== false;
    const isOwner = avaliacao.user_id === authUser.id;
    const admins = profiles.filter((p) => p.role === "admin" && p.active !== false && p.email);
    const owner = profiles.find((p) => p.id === avaliacao.user_id);

    let coordenacao = null;
    if (tipo !== "envio") {
      const [coord] = (await req(`${supabaseUrl}/rest/v1/avaliacoes_coordenacao?avaliacao_id=eq.${id}&select=*`, { headers })) || [];
      coordenacao = coord || null;
    }

    const appUrl = trimUrl(getEnv("APP_BASE_URL") || getEnv("URL") || "");
    let destinatarios = [];
    let subject = "";
    let html = "";
    let text = "";
    let dedupe = "";
    let aviso = null;
    let okMessage = "";

    if (tipo === "envio") {
      if (!isOwner && !isAdmin) return json(403, { error: "Sem permissão para esta avaliação." });
      if (avaliacao.status !== "enviada") return json(409, { error: "A avaliação ainda não foi enviada." });
      destinatarios = admins;
      subject = `Autoavaliação ${avaliacao.competencia} - ${avaliacao.colaborador_nome}`;
      html = buildEnvioHtml(avaliacao, appUrl);
      text = buildEnvioText(avaliacao, appUrl);
      dedupe = `avaliacao:${avaliacao.id}:${avaliacao.enviada_em || ""}`;
      aviso = { titulo: `Autoavaliação recebida: ${avaliacao.colaborador_nome}`, body: `Competência ${avaliacao.competencia}. Abra o HUB em Avaliações para avaliar.` };
      okMessage = "A coordenação recebeu por e-mail.";
    } else if (tipo === "devolvida") {
      if (!isAdmin) return json(403, { error: "Somente a coordenação pode devolver a avaliação." });
      if (avaliacao.status !== "devolvida") return json(409, { error: "A avaliação ainda não foi devolvida." });
      if (!owner?.email) return json(409, { error: "O colaborador não tem e-mail cadastrado." });
      destinatarios = [owner];
      subject = `Sua avaliação ${avaliacao.competencia} foi avaliada pela coordenação`;
      html = buildDevolvidaHtml(avaliacao, coordenacao, appUrl);
      text = buildDevolvidaText(avaliacao, coordenacao, appUrl);
      // A cada "Salvar e devolver" (updated_at muda) sai um novo aviso, inclusive após correções.
      dedupe = `avaliacao-devolvida:${avaliacao.id}:${avaliacao.updated_at || avaliacao.devolvida_em || ""}`;
      aviso = { titulo: `Avaliação ${avaliacao.competencia} avaliada pela coordenação`, body: "Abra o HUB em Avaliações para ver as notas, a média geral e as recomendações." };
      okMessage = "O colaborador recebeu o aviso por e-mail.";
    } else {
      if (!isOwner && !isAdmin) return json(403, { error: "Sem permissão para esta avaliação." });
      if (avaliacao.status !== "devolvida") return json(409, { error: "A avaliação ainda não foi devolvida." });
      destinatarios = admins;
      subject = `Réplica às recomendações ${avaliacao.competencia} - ${avaliacao.colaborador_nome}`;
      html = buildReplicaHtml(avaliacao, coordenacao, appUrl);
      text = buildReplicaText(avaliacao, coordenacao, appUrl);
      dedupe = `avaliacao-replica:${avaliacao.id}:${avaliacao.replicas_em || ""}`;
      aviso = { titulo: `Réplica de ${avaliacao.colaborador_nome}`, body: `Competência ${avaliacao.competencia}: o colaborador respondeu às recomendações.` };
      okMessage = "A coordenação recebeu as réplicas por e-mail.";
    }

    if (!destinatarios.length) return json(500, { error: "Nenhum destinatário ativo para este aviso." });

    for (const pessoa of destinatarios) {
      await req(`${supabaseUrl}/rest/v1/rpc/queue_email`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          p_to_email: pessoa.email,
          p_to_name: pessoa.nome || null,
          p_subject: subject,
          p_html_body: html,
          p_text_body: text,
          p_category: "avaliacao",
          p_target_type: "avaliacao",
          p_target_ref: avaliacao.id,
          p_scheduled_for: new Date().toISOString(),
          p_dedupe_key: `${dedupe}:${pessoa.id}`,
          p_created_by: authUser.id
        })
      });
    }

    // Aviso no sino (ignora duplicados).
    const now = new Date().toISOString();
    await fetch(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
      body: JSON.stringify(
        destinatarios.map((pessoa) => ({
          user_id: pessoa.id,
          tipo: "avaliacao",
          titulo: aviso.titulo,
          body: aviso.body,
          meta: JSON.stringify({ route: "avaliacoes", id: avaliacao.id, tipo }),
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

    const processed = await processDueEmails(supabaseUrl, serviceKey, destinatarios.length).catch((error) => ({ error: error?.message }));
    const sent = Number(processed?.processed || 0) > 0;
    return json(200, { ok: true, message: sent ? okMessage : "O e-mail foi colocado na fila e sai no próximo envio automático." });
  } catch (error) {
    return json(400, { error: error?.message || "Não foi possível enviar o aviso da avaliação." });
  }
}

// ----------------------------------------------------------------------------------------------
// Conteúdo dos e-mails

function media(notas) {
  const valores = CRITERIOS.map(([id]) => notas?.[id]?.nota).filter((n) => typeof n === "number");
  return valores.length ? valores.reduce((s, n) => s + n, 0) / valores.length : null;
}

function mediaGeral(av, coord) {
  const mc = media(coord?.coordenador);
  const ms = media(coord?.subcoordenacao);
  if (mc === null && ms === null) return null;
  const valores = [media(av.autoavaliacao), mc, ms].filter((n) => typeof n === "number");
  return valores.length ? valores.reduce((s, n) => s + n, 0) / valores.length : null;
}

function recomendacoes(coord) {
  const itens = Array.isArray(coord?.recomendacoes_itens) ? coord.recomendacoes_itens.filter((r) => r?.texto?.trim()) : [];
  if (itens.length) return itens;
  return String(coord?.recomendacoes || "")
    .split(/\r?\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t, i) => ({ id: `texto-${i + 1}`, texto: t }));
}

function link(appUrl) {
  return appUrl ? `<p><a href="${esc(appUrl)}/#/avaliacoes">Abrir no HUB (Avaliações)</a></p>` : "";
}

function cabecalho(titulo, av) {
  return `<p><strong>${esc(titulo)}</strong></p><p>Colaborador: <strong>${esc(av.colaborador_nome)}</strong><br>Competência: <strong>${esc(av.competencia)}</strong></p>`;
}

function buildEnvioHtml(av, appUrl) {
  const auto = av.autoavaliacao || {};
  const linhas = CRITERIOS.map(
    ([id, nome], i) =>
      `<tr><td style="${CELL}"><strong>${i + 1}. ${esc(nome)}</strong></td>` +
      `<td style="${CELL};text-align:center">${fmt(auto[id]?.nota)}</td>` +
      `<td style="${CELL}">${esc(auto[id]?.justificativa || "")}</td></tr>`
  ).join("");
  const fb = FEEDBACK.map(([id, q], i) => `<p><strong>${i + 1}) ${esc(q)}</strong><br>${esc(av.feedback?.[id] || "—")}</p>`).join("");
  return (
    `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">${cabecalho("Autoavaliação recebida", av)}` +
    `<table style="border-collapse:collapse;width:100%"><thead><tr>` +
    `<th style="${HEAD};text-align:left">Critério</th><th style="${HEAD}">Nota</th><th style="${HEAD};text-align:left">Justificativa</th></tr></thead>` +
    `<tbody>${linhas}</tbody><tfoot><tr><td style="${CELL}"><strong>Média aritmética</strong></td>` +
    `<td style="${CELL};text-align:center"><strong>${fmt(media(auto))}</strong></td><td style="${CELL}"></td></tr></tfoot></table>` +
    `<p><strong>Feedback</strong></p>${fb}${link(appUrl)}</div>`
  );
}

function buildEnvioText(av, appUrl) {
  const auto = av.autoavaliacao || {};
  const linhas = CRITERIOS.map(([id, nome], i) => `${i + 1}. ${nome}: ${fmt(auto[id]?.nota)} - ${auto[id]?.justificativa || ""}`).join("\n");
  const fb = FEEDBACK.map(([id, q], i) => `${i + 1}) ${q}\n${av.feedback?.[id] || "—"}`).join("\n\n");
  return `Autoavaliação recebida\nColaborador: ${av.colaborador_nome}\nCompetência: ${av.competencia}\n\n${linhas}\n\nMédia aritmética: ${fmt(media(auto))}\n\nFeedback\n${fb}${appUrl ? `\n\n${appUrl}/#/avaliacoes` : ""}`;
}

function buildDevolvidaHtml(av, coord, appUrl) {
  const auto = av.autoavaliacao || {};
  const co = coord?.coordenador || {};
  const linhas = CRITERIOS.map(
    ([id, nome], i) =>
      `<tr><td style="${CELL}"><strong>${i + 1}. ${esc(nome)}</strong></td>` +
      `<td style="${CELL};text-align:center">${fmt(auto[id]?.nota)}</td>` +
      `<td style="${CELL};text-align:center">${fmt(co[id]?.nota)}</td>` +
      `<td style="${CELL}">${esc(co[id]?.justificativa || "")}</td></tr>`
  ).join("");
  const recs = recomendacoes(coord);
  const recHtml = recs.length ? `<ol>${recs.map((r) => `<li>${esc(r.texto)}</li>`).join("")}</ol>` : "<p>—</p>";
  return (
    `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">${cabecalho("Sua avaliação foi avaliada pela coordenação", av)}` +
    `<table style="border-collapse:collapse;width:100%"><thead><tr>` +
    `<th style="${HEAD};text-align:left">Critério</th><th style="${HEAD}">Autoavaliação</th><th style="${HEAD}">Coordenador</th><th style="${HEAD};text-align:left">Justificativa do coordenador</th></tr></thead>` +
    `<tbody>${linhas}</tbody><tfoot><tr><td style="${CELL}"><strong>Média aritmética</strong></td>` +
    `<td style="${CELL};text-align:center"><strong>${fmt(media(auto))}</strong></td><td style="${CELL};text-align:center"><strong>${fmt(media(co))}</strong></td><td style="${CELL}"></td></tr></tfoot></table>` +
    `<p><strong>Média geral: ${fmt(mediaGeral(av, coord))}</strong></p>` +
    `<p><strong>Recomendações da coordenação</strong></p>${recHtml}` +
    `<p>No HUB você pode registrar a sua réplica a cada recomendação.</p>${link(appUrl)}</div>`
  );
}

function buildDevolvidaText(av, coord, appUrl) {
  const auto = av.autoavaliacao || {};
  const co = coord?.coordenador || {};
  const linhas = CRITERIOS.map(([id, nome], i) => `${i + 1}. ${nome}: autoavaliação ${fmt(auto[id]?.nota)} | coordenador ${fmt(co[id]?.nota)} ${co[id]?.justificativa ? `- ${co[id].justificativa}` : ""}`).join("\n");
  const recs = recomendacoes(coord).map((r, i) => `${i + 1}. ${r.texto}`).join("\n") || "—";
  return `Sua avaliação foi avaliada pela coordenação\nCompetência: ${av.competencia}\n\n${linhas}\n\nMédia geral: ${fmt(mediaGeral(av, coord))}\n\nRecomendações\n${recs}${appUrl ? `\n\n${appUrl}/#/avaliacoes` : ""}`;
}

function buildReplicaHtml(av, coord, appUrl) {
  const replicas = av.replicas || {};
  const itens = recomendacoes(coord)
    .map((r) => `<li><p>${esc(r.texto)}</p><p style="margin:4px 0 10px;padding-left:10px;border-left:3px solid #9aa6b8"><strong>Réplica:</strong> ${esc(replicas[r.id] || "—")}</p></li>`)
    .join("");
  return `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">${cabecalho("Réplica às recomendações da coordenação", av)}<ol>${itens}</ol>${link(appUrl)}</div>`;
}

function buildReplicaText(av, coord, appUrl) {
  const replicas = av.replicas || {};
  const itens = recomendacoes(coord).map((r, i) => `${i + 1}. ${r.texto}\n   Réplica: ${replicas[r.id] || "—"}`).join("\n\n");
  return `Réplica às recomendações da coordenação\nColaborador: ${av.colaborador_nome}\nCompetência: ${av.competencia}\n\n${itens}${appUrl ? `\n\n${appUrl}/#/avaliacoes` : ""}`;
}

// ----------------------------------------------------------------------------------------------

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
