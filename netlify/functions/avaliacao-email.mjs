// Avaliações por desempenho (tabelas avd_*): avisos por e-mail e no sino do HUB, e envio da avaliação
// por e-mail com os arquivos (XLSX/PDF) gerados no navegador.
//
// POST { acao: "aviso", id, tipo }
//   enviada    colaborador salvou para a coordenação  → administradores
//   finalizada coordenação finalizou                   → colaborador
//   replica    colaborador enviou réplica             → administradores
//   resposta   coordenação respondeu à réplica        → colaborador
//   devolvida  coordenação devolveu para ajustes      → colaborador
// POST { acao: "arquivos", id, para: "colaborador" | "eu", assunto, mensagem, anexos: [{ nome, tipo, base64 }] }
//   coordenação → colaborador da avaliação; colaborador → o próprio e-mail. Só Gmail (SMTP com senha de app).
import { assertDeliveryConfig, isDeliveryEnabled, processDueEmails } from "./email-outbox.mjs";

const CRITERIOS = [
  ["producao", "Produção"],
  ["disposicoes", "Disposições do coordenador"],
  ["regras", "Regras do escritório"],
  ["erros", "Erros"],
  ["aprendizado", "Aprendizado"],
  ["atendimento", "Atendimento ao cliente"],
  ["autonomia", "Autonomia"]
];
const TIPOS = ["enviada", "finalizada", "replica", "resposta", "devolvida"];
const ANEXO_TIPOS = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".pdf": "application/pdf"
};
const LIMITE_ANEXOS = 4 * 1024 * 1024; // bytes decodificados (a função recebe até ~6 MB em base64)
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
    if (!/^[0-9a-f-]{36}$/i.test(id)) return json(400, { error: "Avaliação inválida." });

    const headers = { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
    const [av] = (await req(`${supabaseUrl}/rest/v1/avd_avaliacoes?id=eq.${id}&select=*`, { headers })) || [];
    if (!av) return json(404, { error: "Avaliação não encontrada." });

    const profiles = (await req(`${supabaseUrl}/rest/v1/profiles?select=id,email,nome,role,active`, { headers })) || [];
    const me = profiles.find((p) => p.id === authUser.id);
    if (!me || me.active === false) return json(403, { error: "Usuário inativo." });
    const isAdmin = me.role === "admin";
    const isOwner = av.user_id === authUser.id;
    const admins = profiles.filter((p) => p.role === "admin" && p.active !== false && p.email);
    const owner = profiles.find((p) => p.id === av.user_id);
    const appUrl = trimUrl(getEnv("APP_BASE_URL") || getEnv("URL") || "");
    const ctx = { supabaseUrl, headers, authUser, me };

    if (payload?.acao === "arquivos") return await enviarArquivos(ctx, av, payload, { isAdmin, isOwner, owner });
    return await enviarAviso(ctx, av, String(payload?.tipo || ""), { isAdmin, isOwner, owner, admins, appUrl, serviceKey });
  } catch (error) {
    return json(400, { error: error?.message || "Não foi possível enviar o e-mail da avaliação." });
  }
}

// ----------------------------------------------------------------------------------------------
// Avisos (fila de e-mails do HUB + sino)

async function enviarAviso(ctx, av, tipo, { isAdmin, isOwner, owner, admins, appUrl, serviceKey }) {
  if (!TIPOS.includes(tipo)) return json(400, { error: "Tipo de aviso inválido." });
  const comp = rotulo(av.competencia);
  const nome = av.colaborador_nome || owner?.nome || "";
  const ultima = Array.isArray(av.replicas) && av.replicas.length ? av.replicas[av.replicas.length - 1] : null;
  let destinatarios = [];
  let subject = "";
  let corpo = "";
  let aviso = null;
  let dedupe = "";
  let okMessage = "";

  if (tipo === "enviada") {
    if (!isOwner && !isAdmin) return json(403, { error: "Sem permissão para esta avaliação." });
    if (av.status !== "enviada") return json(409, { error: "A avaliação ainda não foi salva para a coordenação." });
    destinatarios = admins;
    subject = `Avaliação ${comp} - ${nome} (aguardando correção)`;
    corpo = `<p><strong>${esc(nome)}</strong> salvou a avaliação de <strong>${esc(comp)}</strong> para a coordenação.</p>${tabelaNotas(av, false)}`;
    aviso = { titulo: `Avaliação recebida: ${nome}`, body: `Competência ${comp}. Abra o HUB em Avaliações para corrigir.` };
    dedupe = `avd-enviada:${av.id}:${av.enviada_em || ""}`;
    okMessage = "A coordenação foi avisada por e-mail.";
  } else if (tipo === "replica") {
    if (!isOwner && !isAdmin) return json(403, { error: "Sem permissão para esta avaliação." });
    if (av.status !== "replica" || !ultima) return json(409, { error: "Não há réplica enviada." });
    destinatarios = admins;
    subject = `Réplica à avaliação ${comp} - ${nome}`;
    corpo = `<p><strong>${esc(nome)}</strong> enviou réplica à avaliação de <strong>${esc(comp)}</strong>:</p><blockquote style="border-left:3px solid #8a2f74;margin:0;padding:6px 12px">${esc(ultima.texto)}</blockquote>`;
    aviso = { titulo: `Réplica de ${nome}`, body: `Competência ${comp}: o colaborador enviou réplica à avaliação.` };
    dedupe = `avd-replica:${av.id}:${ultima.enviadaEm || ""}`;
    okMessage = "A coordenação foi avisada por e-mail.";
  } else {
    if (!isAdmin) return json(403, { error: "Somente a coordenação envia este aviso." });
    if (!owner?.email) return json(409, { error: "O colaborador não tem e-mail cadastrado." });
    destinatarios = [owner];
    if (tipo === "finalizada") {
      if (av.status !== "finalizada") return json(409, { error: "A avaliação ainda não foi finalizada." });
      subject = `Sua avaliação ${comp} foi finalizada pela coordenação`;
      corpo = `<p>Olá, ${esc(primeiroNome(nome))}.</p><p>A coordenação finalizou a sua avaliação de <strong>${esc(comp)}</strong>.</p>${tabelaNotas(av, true)}${blocoGeral(av)}<p>Se quiser esclarecer algum ponto, abra a avaliação no HUB e use <strong>Enviar réplica</strong>.</p>`;
      aviso = { titulo: `Avaliação ${comp} finalizada`, body: "Abra o HUB em Avaliações para ver as notas, o feedback e as recomendações da coordenação." };
      dedupe = `avd-finalizada:${av.id}:${av.finalizada_em || ""}`;
    } else if (tipo === "resposta") {
      if (av.status !== "finalizada" || !ultima?.resposta) return json(409, { error: "Não há resposta à réplica." });
      subject = `Resposta à sua réplica - avaliação ${comp}`;
      corpo = `<p>Olá, ${esc(primeiroNome(nome))}.</p><p>A coordenação respondeu à sua réplica da avaliação de <strong>${esc(comp)}</strong>:</p><blockquote style="border-left:3px solid #174c44;margin:0;padding:6px 12px">${esc(ultima.resposta)}</blockquote><p style="color:#64716b">Sua réplica: ${esc(ultima.texto)}</p>`;
      aviso = { titulo: `Resposta à réplica (${comp})`, body: "A coordenação respondeu à sua réplica. Abra o HUB em Avaliações." };
      dedupe = `avd-resposta:${av.id}:${ultima.respondidaEm || ""}`;
    } else {
      if (av.status !== "rascunho") return json(409, { error: "A avaliação não está devolvida." });
      const [ev] =
        (await req(`${ctx.supabaseUrl}/rest/v1/avd_eventos?avaliacao_id=eq.${av.id}&acao=like.Devolveu*&select=detalhe,em&order=em.desc&limit=1`, { headers: ctx.headers })) || [];
      subject = `Avaliação ${comp} devolvida para ajustes`;
      corpo = `<p>Olá, ${esc(primeiroNome(nome))}.</p><p>A coordenação devolveu a sua avaliação de <strong>${esc(comp)}</strong> para ajustes na autoavaliação.</p>${ev?.detalhe ? `<p><strong>Motivo:</strong> ${esc(ev.detalhe)}</p>` : ""}<p>Abra o HUB em Avaliações, ajuste e salve de novo para a coordenação.</p>`;
      aviso = { titulo: `Avaliação ${comp} devolvida para ajustes`, body: ev?.detalhe ? `Motivo: ${ev.detalhe}` : "Abra o HUB em Avaliações para ajustar." };
      dedupe = `avd-devolvida:${av.id}:${ev?.em || av.updated_at || ""}`;
    }
    okMessage = "O colaborador foi avisado por e-mail.";
  }
  if (!destinatarios.length) return json(500, { error: "Nenhum destinatário ativo para este aviso." });

  const html = `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">${corpo}${link(appUrl)}</div>`;
  const text = stripHtml(html);
  for (const pessoa of destinatarios) {
    await req(`${ctx.supabaseUrl}/rest/v1/rpc/queue_email`, {
      method: "POST",
      headers: { ...ctx.headers, "content-type": "application/json" },
      body: JSON.stringify({
        p_to_email: pessoa.email,
        p_to_name: pessoa.nome || null,
        p_subject: subject,
        p_html_body: html,
        p_text_body: text,
        p_category: "avaliacao",
        p_target_type: "avaliacao",
        p_target_ref: av.id,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: `${dedupe}:${pessoa.id}`,
        p_created_by: ctx.authUser.id
      })
    });
  }
  const now = new Date().toISOString();
  await fetch(`${ctx.supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
    method: "POST",
    headers: { ...ctx.headers, "content-type": "application/json", prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify(
      destinatarios.map((pessoa) => ({
        user_id: pessoa.id,
        tipo: "avaliacao",
        titulo: aviso.titulo,
        body: aviso.body,
        meta: JSON.stringify({ route: "avaliacoes", id: av.id, tipo }),
        target_type: "avaliacao",
        target_ref: av.id,
        dedupe_key: dedupe,
        route: "avaliacoes",
        tone: "info",
        active: true,
        created_at: now,
        updated_at: now
      }))
    )
  }).catch(() => null);

  const processed = await processDueEmails(ctx.supabaseUrl, serviceKey, destinatarios.length).catch((error) => ({ error: error?.message }));
  const sent = Number(processed?.processed || 0) > 0;
  return json(200, { ok: true, message: sent ? okMessage : "O aviso foi colocado na fila e sai no próximo envio automático." });
}

// ----------------------------------------------------------------------------------------------
// Envio da avaliação com anexos (direto pelo Gmail; a fila do HUB não leva anexos)

async function enviarArquivos(ctx, av, payload, { isAdmin, isOwner, owner }) {
  const para = payload?.para === "eu" ? "eu" : "colaborador";
  let destino;
  if (para === "colaborador") {
    if (!isAdmin) return json(403, { error: "Somente a coordenação envia a avaliação ao colaborador." });
    if (av.status === "rascunho") return json(409, { error: "A avaliação ainda é rascunho do colaborador." });
    destino = owner;
  } else {
    if (!isOwner) return json(403, { error: "Você só pode enviar a sua própria avaliação para o seu e-mail." });
    destino = ctx.me;
  }
  if (!destino?.email) return json(409, { error: "Destinatário sem e-mail cadastrado no HUB." });

  const assunto = String(payload?.assunto || "").trim().slice(0, 200);
  const mensagem = String(payload?.mensagem || "").slice(0, 4000);
  if (!assunto) return json(400, { error: "Informe o assunto." });
  const anexos = Array.isArray(payload?.anexos) ? payload.anexos.slice(0, 3) : [];
  if (!anexos.length) return json(400, { error: "Nenhum arquivo anexado." });
  let total = 0;
  const attachments = [];
  for (const a of anexos) {
    const nome = String(a?.nome || "").replace(/[\\/:*?"<>|\r\n]+/g, " ").trim().slice(0, 120);
    const ext = (nome.match(/\.(xlsx|pdf)$/i)?.[0] || "").toLowerCase();
    if (!ext) return json(400, { error: "Só são aceitos anexos .xlsx e .pdf." });
    const conteudo = Buffer.from(String(a?.base64 || ""), "base64");
    if (!conteudo.length) return json(400, { error: `Anexo vazio: ${nome}.` });
    total += conteudo.length;
    attachments.push({ filename: nome, content: conteudo, contentType: ANEXO_TIPOS[ext] });
  }
  if (total > LIMITE_ANEXOS) return json(413, { error: "Anexos grandes demais para enviar por e-mail." });

  if (!isDeliveryEnabled()) return json(409, { error: "O envio de e-mails está desligado no servidor (EMAIL_DELIVERY_ENABLED)." });
  if ((getEnv("EMAIL_PROVIDER") || "resend").toLowerCase() !== "gmail") return json(409, { error: "O envio com anexos exige o Gmail configurado como provedor de e-mail." });
  assertDeliveryConfig();

  const forced = getEnv("EMAIL_FORCE_TEST_TO");
  const html = `<div style="font-family:Arial,sans-serif;font-size:12pt;color:#1b2a41">${esc(mensagem)}</div>`;
  const { default: nodemailer } = await import("nodemailer");
  const port = Number(getEnv("GMAIL_SMTP_PORT") || 465);
  const transport = nodemailer.createTransport({
    host: getEnv("GMAIL_SMTP_HOST") || "smtp.gmail.com",
    port,
    secure: port === 465,
    auth: { user: getEnv("GMAIL_USER"), pass: getEnv("GMAIL_APP_PASSWORD").replace(/\s+/g, "") },
    connectionTimeout: 8000,
    greetingTimeout: 8000,
    socketTimeout: 20000
  });
  await transport.sendMail({
    from: { name: getEnv("EMAIL_FROM_NAME") || "HUB Depto Tributário", address: getEnv("GMAIL_USER") },
    to: forced || destino.email,
    replyTo: (para === "colaborador" ? ctx.me.email : "") || getEnv("EMAIL_REPLY_TO") || undefined,
    subject: forced ? `[TESTE HUB] ${assunto}` : assunto,
    text: mensagem,
    html,
    attachments
  });

  await fetch(`${ctx.supabaseUrl}/rest/v1/avd_eventos`, {
    method: "POST",
    headers: { ...ctx.headers, "content-type": "application/json", prefer: "return=minimal" },
    body: JSON.stringify({
      avaliacao_id: av.id,
      por: ctx.me.id,
      por_nome: ctx.me.nome || ctx.me.email || "",
      acao: "Enviou por e-mail",
      detalhe: `Para ${destino.email}: ${attachments.map((x) => x.filename).join(", ")}`
    })
  }).catch(() => null);

  return json(200, { ok: true, message: `E-mail enviado para ${destino.email}${forced ? " (modo de teste: entregue no endereço de teste)" : ""}.` });
}

// ----------------------------------------------------------------------------------------------
// Conteúdo

function media(notas) {
  const v = CRITERIOS.map(([id]) => notas?.[id]?.nota);
  if (v.some((n) => typeof n !== "number")) return null;
  return v.reduce((s, n) => s + n, 0) / v.length;
}

function tabelaNotas(av, comCoord) {
  const auto = av.colaborador?.notas || {};
  const co = av.coordenacao?.notas || {};
  const linhas = CRITERIOS.map(
    ([id, nome], i) =>
      `<tr><td style="${CELL}"><strong>${i + 1}. ${esc(nome)}</strong></td><td style="${CELL};text-align:center">${fmt(auto[id]?.nota)}</td>` +
      (comCoord
        ? `<td style="${CELL};text-align:center">${fmt(co[id]?.nota)}</td><td style="${CELL}">${esc(co[id]?.justificativa || "")}</td>`
        : `<td style="${CELL}">${esc(auto[id]?.justificativa || "")}</td>`) +
      `</tr>`
  ).join("");
  const cab = comCoord
    ? `<th style="${HEAD}">Autoavaliação</th><th style="${HEAD}">Coordenador</th><th style="${HEAD};text-align:left">Justificativa do coordenador</th>`
    : `<th style="${HEAD}">Nota</th><th style="${HEAD};text-align:left">Justificativa</th>`;
  const pe = comCoord
    ? `<td style="${CELL};text-align:center"><strong>${fmt(media(auto))}</strong></td><td style="${CELL};text-align:center"><strong>${fmt(media(co))}</strong></td><td style="${CELL}"></td>`
    : `<td style="${CELL};text-align:center"><strong>${fmt(media(auto))}</strong></td><td style="${CELL}"></td>`;
  return `<table style="border-collapse:collapse;width:100%"><thead><tr><th style="${HEAD};text-align:left">Critério</th>${cab}</tr></thead><tbody>${linhas}</tbody><tfoot><tr><td style="${CELL}"><strong>Total (média)</strong></td>${pe}</tr></tfoot></table>`;
}

function blocoGeral(av) {
  const k = av.coordenacao || {};
  const recs = Array.isArray(k.recomendacoes) ? k.recomendacoes.filter((r) => String(r || "").trim()) : [];
  return (
    `<p><strong>1 - Pontos positivos</strong><br>${esc(k.pontosPositivos || "—")}</p>` +
    `<p><strong>2 - A melhorar/Sugestões</strong><br>${esc(k.aMelhorar || "—")}</p>` +
    (recs.length ? `<p><strong>Recomendações</strong></p><ol>${recs.map((r) => `<li>${esc(r)}</li>`).join("")}</ol>` : "")
  );
}

function link(appUrl) {
  return appUrl ? `<p><a href="${esc(appUrl)}/#/avaliacoes">Abrir no HUB (Avaliações)</a></p>` : "";
}
function rotulo(c) {
  return /^\d{4}-\d{2}$/.test(String(c || "")) ? `${c.slice(5, 7)}/${c.slice(0, 4)}` : String(c || "");
}
function primeiroNome(n) {
  return String(n || "").trim().split(/\s+/)[0] || "";
}
function stripHtml(html) {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|tr|li|blockquote|h\d)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, "\t")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
