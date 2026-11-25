import { processDueEmails } from "./email-outbox.mjs";

const JSON_HEADERS = {
  "content-type": "application/json",
  "cache-control": "no-store"
};

const MANAGER_ROLES = new Set(["admin", "gestor"]);
const ITEM_TYPES = new Set(["colaborador", "coordenacao", "pauta"]);
const PRIORITIES = new Set(["alta", "media", "baixa"]);
const RECURRENCES = new Set(["none", "weekly", "monthly"]);
const STATUSES = new Set(["aberto", "concluido"]);
const PINNED = new Set(["main", "hidden"]);

export default async function handler(request) {
  if (request.method === "OPTIONS") {
    return json(204, {});
  }

  if (!["GET", "PUT"].includes(request.method)) {
    return json(405, { error: "Método não permitido." });
  }

  const supabaseUrl = getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL");
  const supabaseAnonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceRoleKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return json(500, { error: "Variáveis Supabase ausentes no servidor." });
  }

  const token = readBearerToken(request.headers.get("authorization"));
  if (!token) {
    return json(401, { error: "Sessão não informada." });
  }

  try {
    const authUser = await verifySession(supabaseUrl, supabaseAnonKey, token);
    const profile = await readProfile(supabaseUrl, serviceRoleKey, authUser.id);

    if (!profile?.active || !MANAGER_ROLES.has(profile.role)) {
      return json(403, { error: "Apenas administradores ou gestores podem sincronizar a Coordenação Tributária." });
    }

    if (request.method === "GET") {
      await limparAvisosVencidos(supabaseUrl, serviceRoleKey);
      const state = await loadState(supabaseUrl, serviceRoleKey);
      return json(200, { source: "supabase", state });
    }

    const payload = await parseJsonBody(request);
    const state = normalizeState(payload?.state, authUser.id);
    const { novos, mudancas } = await saveState(supabaseUrl, serviceRoleKey, state);
    const envios = novos.length
      ? await avisarColaboradores({
          supabaseUrl,
          supabaseAnonKey,
          serviceRoleKey,
          token,
          autor: authUser,
          itens: novos,
          collaborators: state.collaborators,
          hubUrl: originOf(request)
        })
      : [];
    const conclusoes = await tratarMudancasDeLembretes({ supabaseUrl, serviceRoleKey, mudancas, collaborators: state.collaborators });
    await limparAvisosVencidos(supabaseUrl, serviceRoleKey);
    return json(200, { ok: true, source: "supabase", state, envios, conclusoes });
  } catch (error) {
    const statusCode = error.statusCode && error.statusCode >= 400 ? error.statusCode : 400;
    return json(statusCode, { error: error?.message || "Não foi possível sincronizar a Coordenação Tributária." });
  }
}

async function loadState(supabaseUrl, serviceRoleKey) {
  const [collaboratorRows, itemRows, pautaRows] = await Promise.all([
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_colaboradores?select=id,nome,email,funcao,active,created_at,updated_at&order=nome.asc`,
      { headers: serviceHeaders(serviceRoleKey) }
    ),
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/coord_itens?select=id,titulo,descricao,tipo,colaborador_id,prazo,prioridade,recorrencia,status,pinned,anexos,integrar_calendario,tarefa_id,deleted_at,completed_at,created_at,updated_at&order=updated_at.desc`,
      { headers: serviceHeaders(serviceRoleKey) }
    ),
    supabaseRequest(
      `${trimUrl(supabaseUrl)}/rest/v1/pautas?select=id,titulo,descricao,prazo,prioridade,status,scope,destaque,created_by,created_by_email,created_at,updated_at&order=updated_at.desc`,
      { headers: serviceHeaders(serviceRoleKey) }
    )
  ]);

  const nativePautas = await loadNativePautasForCoord(supabaseUrl, serviceRoleKey, Array.isArray(pautaRows) ? pautaRows : []);
  const nativePautaIds = new Set(nativePautas.map((item) => item.id));
  const legacyItems = (Array.isArray(itemRows) ? itemRows : [])
    .map(fromItemRow)
    .filter((item) => !(item.type === "pauta" && nativePautaIds.has(item.id)));

  return {
    collaborators: (Array.isArray(collaboratorRows) ? collaboratorRows : []).map(fromCollaboratorRow),
    reminders: [...nativePautas, ...legacyItems]
  };
}

async function saveState(supabaseUrl, serviceRoleKey, state) {
  if (state.collaborators.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_colaboradores?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(state.collaborators.map(toCollaboratorRow))
    });
  }

  // Lembretes de colaborador que ainda não existem no banco: inseridos primeiro, sem sobrescrever,
  // para saber com segurança quais são novos (a resposta traz só as linhas realmente inseridas).
  const novos = await reservarNovosLembretesColaborador(supabaseUrl, serviceRoleKey, state.reminders);
  // Exclusão, conclusão e reabertura: mudança aplicada só se o banco ainda estava no estado anterior,
  // e a resposta traz as linhas que mudaram de fato (assim cada evento é tratado uma única vez).
  const mudancas = await registrarMudancasDeLembretes(supabaseUrl, serviceRoleKey, state.reminders);

  if (state.reminders.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(state.reminders.map(toItemRow))
    });
  }

  await syncCalendarTasksFromCoord(supabaseUrl, serviceRoleKey, state.reminders, state.collaborators);
  await saveNativePautasFromCoord(supabaseUrl, serviceRoleKey, state.reminders);
  return { novos, mudancas };
}

async function patchCondicional(supabaseUrl, serviceRoleKey, ids, filtro, corpo) {
  if (!ids.length) return [];
  const linhas = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/coord_itens?id=in.(${ids.map(encodeURIComponent).join(",")})&${filtro}&select=id`,
    {
      method: "PATCH",
      headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify(corpo)
    }
  );
  const mudaram = new Set((Array.isArray(linhas) ? linhas : []).map((row) => row.id));
  return ids.filter((id) => mudaram.has(id));
}

async function registrarMudancasDeLembretes(supabaseUrl, serviceRoleKey, reminders) {
  const colaborador = reminders.filter((item) => item.type === "colaborador");
  const agora = new Date().toISOString();
  const excluidos = await patchCondicional(
    supabaseUrl,
    serviceRoleKey,
    colaborador.filter((item) => item.deletedAt).map((item) => item.id),
    "deleted_at=is.null",
    { deleted_at: agora }
  );
  const concluidos = await patchCondicional(
    supabaseUrl,
    serviceRoleKey,
    colaborador.filter((item) => !item.deletedAt && item.status === "concluido").map((item) => item.id),
    "status=eq.aberto&deleted_at=is.null",
    { status: "concluido", completed_at: agora }
  );
  const reabertos = await patchCondicional(
    supabaseUrl,
    serviceRoleKey,
    colaborador.filter((item) => !item.deletedAt && item.status === "aberto").map((item) => item.id),
    "status=eq.concluido&deleted_at=is.null",
    { status: "aberto", completed_at: null }
  );
  const porId = new Map(colaborador.map((item) => [item.id, item]));
  const pegar = (ids) => ids.map((id) => porId.get(id)).filter(Boolean);
  return { excluidos: pegar(excluidos), concluidos: pegar(concluidos), reabertos: pegar(reabertos) };
}

// ---- Aviso particular ligado ao lembrete ----
// O vínculo e os prazos ficam num comentário no fim do conteúdo (não aparece na tela):
// <!--hub:coord-lembrete id=<id> criado=<ISO> expira=<ISO> concluido=<ISO>-->
const DIA_MS = 24 * 60 * 60 * 1000;
const PRAZO_AVISO_DIAS = 30;
const PRAZO_CONCLUIDO_DIAS = 5;
const MARCA_RE = /<!--hub:coord-lembrete ([^>]*?)-->/;

function marcaAviso({ id, criado, expira, concluido }) {
  return `<!--hub:coord-lembrete id=${id} criado=${criado} expira=${expira}${concluido ? ` concluido=${concluido}` : ""}-->`;
}

function lerMarca(content) {
  const m = String(content || "").match(MARCA_RE);
  if (!m) return null;
  const campos = Object.fromEntries(m[1].trim().split(/\s+/).map((par) => par.split("=")).filter((par) => par.length === 2));
  return campos.id ? campos : null;
}

function trocarMarca(content, campos) {
  const semMarca = String(content || "").replace(MARCA_RE, "");
  return `${semMarca}${marcaAviso(campos)}`;
}

async function avisosDoLembrete(supabaseUrl, serviceRoleKey, itemId) {
  const filtro = encodeURIComponent(`*hub:coord-lembrete id=${itemId} *`);
  const rows = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_avisos?content=like.${filtro}&select=id,content`, {
    headers: serviceHeaders(serviceRoleKey)
  });
  return Array.isArray(rows) ? rows : [];
}

async function atualizarConteudoAviso(supabaseUrl, serviceRoleKey, avisoId, content) {
  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_avisos?id=eq.${encodeURIComponent(avisoId)}`, {
    method: "PATCH",
    headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json" },
    body: JSON.stringify({ content })
  });
}

async function apagarAviso(supabaseUrl, serviceRoleKey, avisoId) {
  await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_avisos?id=eq.${encodeURIComponent(avisoId)}`, {
    method: "DELETE",
    headers: serviceHeaders(serviceRoleKey)
  });
}

async function tratarMudancasDeLembretes({ supabaseUrl, serviceRoleKey, mudancas, collaborators }) {
  const resultados = [];
  const porId = new Map(collaborators.map((item) => [item.id, item]));
  const agora = Date.now();

  for (const item of mudancas.excluidos) {
    try {
      for (const aviso of await avisosDoLembrete(supabaseUrl, serviceRoleKey, item.id)) await apagarAviso(supabaseUrl, serviceRoleKey, aviso.id);
    } catch (error) {
      console.warn("Não foi possível retirar o aviso do lembrete excluído.", error?.message || error);
    }
  }

  for (const item of mudancas.reabertos) {
    try {
      for (const aviso of await avisosDoLembrete(supabaseUrl, serviceRoleKey, item.id)) {
        const marca = lerMarca(aviso.content);
        const criado = marca?.criado || new Date(agora).toISOString();
        const expira = new Date(Math.max(Date.parse(criado) + PRAZO_AVISO_DIAS * DIA_MS, agora + DIA_MS)).toISOString();
        await atualizarConteudoAviso(supabaseUrl, serviceRoleKey, aviso.id, trocarMarca(aviso.content, { id: item.id, criado, expira }));
      }
    } catch (error) {
      console.warn("Não foi possível reabrir o aviso do lembrete.", error?.message || error);
    }
  }

  for (const item of mudancas.concluidos) {
    const colaborador = porId.get(item.collaboratorId);
    const email = String(colaborador?.email || "").trim().toLowerCase();
    const resultado = { id: item.id, titulo: item.title, colaborador: colaborador?.name || email, avisoAtualizado: false, notificado: false, erros: [] };
    resultados.push(resultado);
    const concluido = new Date(agora).toISOString();
    let avisoId = null;

    try {
      for (const aviso of await avisosDoLembrete(supabaseUrl, serviceRoleKey, item.id)) {
        const marca = lerMarca(aviso.content);
        const expira = new Date(agora + PRAZO_CONCLUIDO_DIAS * DIA_MS).toISOString();
        await atualizarConteudoAviso(
          supabaseUrl,
          serviceRoleKey,
          aviso.id,
          trocarMarca(aviso.content, { id: item.id, criado: marca?.criado || concluido, expira, concluido })
        );
        avisoId = aviso.id;
        resultado.avisoAtualizado = true;
      }
      if (!avisoId) resultado.erros.push("O aviso do quadro particular não existe mais (excluído ou vencido).");
    } catch (error) {
      resultado.erros.push(`Quadro de Avisos: ${error?.message || "não foi possível marcar como concluído."}`);
    }

    try {
      const perfis = email
        ? await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id&limit=1`, {
            headers: serviceHeaders(serviceRoleKey)
          })
        : [];
      const perfil = Array.isArray(perfis) ? perfis[0] : null;
      if (!perfil?.id) {
        resultado.erros.push("Colaborador sem usuário no HUB: não há sino para notificar.");
      } else {
        await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
          method: "POST",
          headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json", prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify({
            user_id: perfil.id,
            tipo: "quadro_aviso",
            titulo: "Lembrete concluído pela coordenação",
            body: `A Coordenação Tributária concluiu o lembrete: ${item.title}`,
            meta: JSON.stringify({ avisoId, route: "pautas", tab: "avisos", board: "particular", title: item.title }),
            target_type: "quadro_aviso",
            target_id: avisoId,
            target_ref: item.id,
            dedupe_key: `coord_lembrete_concluido:${item.id}:${concluido}`,
            route: "pautas",
            tone: "info",
            active: true
          })
        });
        resultado.notificado = true;
      }
    } catch (error) {
      resultado.erros.push(`Sino: ${error?.message || "não foi possível notificar."}`);
    }
  }

  return resultados;
}

// Avisos de lembrete vencidos (30 dias, ou 5 dias depois de concluídos) saem do quadro.
async function limparAvisosVencidos(supabaseUrl, serviceRoleKey) {
  try {
    const filtro = encodeURIComponent("*hub:coord-lembrete id=*");
    const rows = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_avisos?content=like.${filtro}&select=id,content`, {
      headers: serviceHeaders(serviceRoleKey)
    });
    const agora = Date.now();
    for (const row of Array.isArray(rows) ? rows : []) {
      const expira = Date.parse(lerMarca(row.content)?.expira || "");
      if (Number.isFinite(expira) && expira <= agora) await apagarAviso(supabaseUrl, serviceRoleKey, row.id);
    }
  } catch (error) {
    console.warn("Não foi possível limpar avisos vencidos.", error?.message || error);
  }
}

const NOVO_LEMBRETE_JANELA_MS = 7 * 24 * 60 * 60 * 1000;

async function reservarNovosLembretesColaborador(supabaseUrl, serviceRoleKey, reminders) {
  const agora = Date.now();
  const candidatos = reminders.filter(
    (item) =>
      item.type === "colaborador" &&
      item.collaboratorId &&
      !item.deletedAt &&
      item.status === "aberto" &&
      agora - Date.parse(item.createdAt || "") < NOVO_LEMBRETE_JANELA_MS
  );
  if (!candidatos.length) return [];

  const inseridos = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?on_conflict=id&select=id`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": "application/json",
      prefer: "resolution=ignore-duplicates,return=representation"
    },
    body: JSON.stringify(candidatos.map(toItemRow))
  });
  const ids = new Set((Array.isArray(inseridos) ? inseridos : []).map((row) => row.id));
  return candidatos.filter((item) => ids.has(item.id));
}

// Lembrete de avaliação novo: e-mail ao colaborador e aviso no Quadro de Avisos particular dele.
// O aviso é gravado com a sessão de quem criou o lembrete (mesmas permissões e histórico do HUB).
async function avisarColaboradores({ supabaseUrl, supabaseAnonKey, serviceRoleKey, token, autor, itens, collaborators, hubUrl }) {
  const porId = new Map(collaborators.map((item) => [item.id, item]));
  const envios = [];
  let emailsNaFila = 0;

  for (const item of itens) {
    const colaborador = porId.get(item.collaboratorId);
    const email = String(colaborador?.email || "").trim().toLowerCase();
    const nome = colaborador?.name || email;
    const envio = { id: item.id, titulo: item.title, colaborador: nome, email, emailEnviado: false, avisoCriado: false, erros: [] };
    envios.push(envio);

    if (!email) {
      envio.erros.push("Colaborador sem e-mail cadastrado.");
      continue;
    }

    try {
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/queue_email`, {
        method: "POST",
        headers: { ...serviceHeaders(serviceRoleKey), "content-type": "application/json" },
        body: JSON.stringify({
          p_to_email: email,
          p_to_name: nome,
          p_subject: `Lembrete de avaliação: ${item.title}`,
          p_html_body: emailLembreteHtml(item, nome, hubUrl),
          p_text_body: emailLembreteTexto(item, nome, hubUrl),
          p_category: "coord_avaliacoes",
          p_target_type: "coordenacao",
          p_target_ref: item.id,
          p_scheduled_for: new Date().toISOString(),
          p_dedupe_key: `coord_lembrete:${item.id}:${email}`,
          p_created_by: autor.id || null
        })
      });
      emailsNaFila += 1;
      envio.emailEnviado = true;
    } catch (error) {
      envio.erros.push(`E-mail: ${error?.message || "não foi possível enfileirar."}`);
    }

    try {
      const userHeaders = { apikey: supabaseAnonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
      const criados = await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_avisos?select=id`, {
        method: "POST",
        headers: { ...userHeaders, prefer: "return=representation" },
        body: JSON.stringify({
          cell: 1,
          kind: "texto",
          visibility: "particular",
          title: `Lembrete de avaliação: ${item.title}`.slice(0, 200),
          content: `${avisoLembreteHtml(item)}${marcaAviso({
            id: item.id,
            criado: new Date().toISOString(),
            expira: new Date(Date.now() + PRAZO_AVISO_DIAS * DIA_MS).toISOString()
          })}`,
          color: "#ffffff",
          created_by: autor.id,
          created_by_email: String(autor.email || "").trim().toLowerCase()
        })
      });
      const avisoId = Array.isArray(criados) ? criados[0]?.id : criados?.id;
      if (!avisoId) throw new Error("aviso não retornado.");

      const perfis = await supabaseRequest(
        `${trimUrl(supabaseUrl)}/rest/v1/profiles?email=eq.${encodeURIComponent(email)}&select=id,nome&limit=1`,
        { headers: serviceHeaders(serviceRoleKey) }
      );
      const perfil = Array.isArray(perfis) ? perfis[0] : null;
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/quadro_aviso_usuarios`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ aviso_id: avisoId, user_id: perfil?.id || null, email, nome: perfil?.nome || nome })
      });
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/rpc/notify_quadro_aviso_particular`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ p_aviso_id: avisoId })
      }).catch(() => null);
      envio.avisoCriado = true;
      if (!perfil?.id) envio.erros.push("Aviso criado, mas o e-mail do colaborador não corresponde a um usuário do HUB.");
    } catch (error) {
      envio.erros.push(`Quadro de Avisos: ${error?.message || "não foi possível criar o aviso."}`);
    }
  }

  if (emailsNaFila) {
    try {
      await processDueEmails(supabaseUrl, serviceRoleKey, emailsNaFila);
    } catch (error) {
      envios.forEach((envio) => envio.emailEnviado && envio.erros.push(`E-mail na fila; envio imediato falhou: ${error?.message || error}`));
    }
  }

  return envios;
}

const PRIORIDADE_ROTULO = { alta: "Alta", media: "Média", baixa: "Baixa" };

function formatarPrazo(value) {
  // Prazo digitado no navegador (sem fuso): já está no horário de Brasília.
  const local = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?(?::\d{2}(?:\.\d+)?)?$/);
  if (local) return `${local[3]}/${local[2]}/${local[1]}${local[4] ? ` ${local[4]}:${local[5]}` : ""}`;
  const data = new Date(value);
  if (!value || Number.isNaN(data.getTime())) return "Sem prazo";
  return data.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function avisoLembreteHtml(item) {
  const partes = [
    `<strong>${escapeHtml(item.title)}</strong>`,
    `<strong>Prazo:</strong> ${escapeHtml(formatarPrazo(item.due))}`,
    `<strong>Prioridade:</strong> ${escapeHtml(PRIORIDADE_ROTULO[item.priority] || "Média")}`
  ];
  if (item.description) partes.push(escapeHtml(item.description).replace(/\n/g, "<br>"));
  partes.push("<em>Enviado pela Coordenação Tributária.</em>");
  return partes.join("<br>");
}

function emailLembreteHtml(item, nome, hubUrl) {
  const celula = "border:1px solid #c9d1dc;padding:6px 10px;text-align:left;vertical-align:top";
  const cabeca = `${celula};background:#eef1f6;width:120px`;
  const linhas = [
    ["Lembrete", escapeHtml(item.title)],
    ["Prazo", escapeHtml(formatarPrazo(item.due))],
    ["Prioridade", escapeHtml(PRIORIDADE_ROTULO[item.priority] || "Média")]
  ];
  if (item.description) linhas.push(["Detalhes", escapeHtml(item.description).replace(/\n/g, "<br>")]);
  return [
    `<p>Olá, ${escapeHtml(nome)}.</p>`,
    "<p>A Coordenação Tributária registrou um lembrete de avaliação para você:</p>",
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${linhas
      .map(([rotulo, valor]) => `<tr><th style="${cabeca}">${rotulo}</th><td style="${celula}">${valor}</td></tr>`)
      .join("")}</table>`,
    `<p>O lembrete também está no seu Quadro de Avisos particular no HUB${item.calendarSync ? " e no seu Calendário de Tarefas" : ""}.</p>`,
    hubUrl ? `<p><a href="${escapeHtml(hubUrl)}">Abrir o HUB Depto Tributário</a></p>` : "",
    "<p>H. Teixeira Contabilidade · Departamento Tributário</p>"
  ].join("");
}

function emailLembreteTexto(item, nome, hubUrl) {
  return [
    `Olá, ${nome}.`,
    "",
    "A Coordenação Tributária registrou um lembrete de avaliação para você:",
    `Lembrete: ${item.title}`,
    `Prazo: ${formatarPrazo(item.due)}`,
    `Prioridade: ${PRIORIDADE_ROTULO[item.priority] || "Média"}`,
    item.description ? `Detalhes: ${item.description}` : "",
    "",
    `O lembrete também está no seu Quadro de Avisos particular no HUB${item.calendarSync ? " e no seu Calendário de Tarefas" : ""}.`,
    hubUrl ? `HUB: ${hubUrl}` : ""
  ]
    .filter((linha, indice, lista) => linha !== "" || lista[indice - 1] !== "")
    .join("\n");
}

function originOf(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

async function loadNativePautasForCoord(supabaseUrl, serviceRoleKey, rows) {
  if (!rows.length) return [];

  const ids = rows.map((row) => row.id).filter(Boolean);
  const [usuariosRows, anexoRows] = await Promise.all([
    ids.length
      ? supabaseRequest(
          `${trimUrl(supabaseUrl)}/rest/v1/pauta_usuarios?pauta_id=in.(${ids.map(encodeURIComponent).join(",")})&select=pauta_id,email,nome,user_id`,
          { headers: serviceHeaders(serviceRoleKey) }
        )
      : [],
    ids.length
      ? supabaseRequest(
          `${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos?pauta_id=in.(${ids.map(encodeURIComponent).join(",")})&select=id,pauta_id,file_name,storage_path,mime_type,size_bytes,created_at`,
          { headers: serviceHeaders(serviceRoleKey) }
        )
      : []
  ]);

  const safeAnexoRows = Array.isArray(anexoRows) ? anexoRows : [];
  const signedUrls = await createSignedStorageUrls(
    supabaseUrl,
    serviceRoleKey,
    "hub-anexos",
    safeAnexoRows.map((item) => item.storage_path)
  );

  return rows.map((row) =>
    fromPautaRow(
      row,
      (Array.isArray(usuariosRows) ? usuariosRows : []).filter((item) => item.pauta_id === row.id),
      safeAnexoRows.filter((item) => item.pauta_id === row.id),
      signedUrls
    )
  );
}

async function saveNativePautasFromCoord(supabaseUrl, serviceRoleKey, reminders) {
  const pautaItems = reminders.filter((item) => item.type === "pauta");
  if (!pautaItems.length) return;

  const deletedIds = pautaItems.filter((item) => item.deletedAt).map((item) => item.id).filter(Boolean);
  if (deletedIds.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=in.(${deletedIds.map(encodeURIComponent).join(",")})`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });
  }

  const activePautas = pautaItems.filter((item) => !item.deletedAt);
  if (!activePautas.length) return;

  const ids = activePautas.map((item) => item.id).filter(Boolean);
  const existingRows = ids.length
    ? await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=in.(${ids.map(encodeURIComponent).join(",")})&select=id`, {
        headers: serviceHeaders(serviceRoleKey)
      })
    : [];
  const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => row.id));

  const inserts = activePautas.filter((item) => !existingIds.has(item.id)).map(toNewPautaRow);
  if (inserts.length) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify(inserts)
    });
  }

  for (const item of activePautas.filter((entry) => existingIds.has(entry.id))) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pautas?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify(toExistingPautaPatch(item))
    });
  }

  await syncPautaAttachmentsFromCoord(supabaseUrl, serviceRoleKey, activePautas);
}

function normalizeState(value, userId) {
  if (!value || !Array.isArray(value.collaborators) || !Array.isArray(value.reminders)) {
    throw httpError(400, "Estado da Coordenação Tributária inválido.");
  }

  return {
    collaborators: value.collaborators.map((item) => normalizeCollaborator(item, userId)),
    reminders: value.reminders.map((item) => normalizeItem(item, userId))
  };
}

function normalizeCollaborator(item, userId) {
  const id = String(item?.id || "").trim() || randomId();
  const name = String(item?.name || item?.nome || "").trim();
  const email = String(item?.email || "").trim().toLowerCase();

  if (!name || !email) {
    throw httpError(400, "Colaborador sem nome ou e-mail.");
  }

  return {
    id,
    name,
    email,
    role: String(item?.role || item?.funcao || "").trim(),
    active: item?.active !== false,
    createdBy: userId,
    createdAt: normalizeDate(item?.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(item?.updatedAt) || new Date().toISOString()
  };
}

function normalizeItem(item, userId) {
  const id = String(item?.id || "").trim() || randomId();
  const title = String(item?.title || item?.titulo || "").trim();

  if (!title) {
    throw httpError(400, "Item de Coordenação sem título.");
  }

  const type = ITEM_TYPES.has(item?.type) ? item.type : "colaborador";
  const priority = PRIORITIES.has(item?.priority) ? item.priority : "media";
  const recurring = RECURRENCES.has(item?.recurring) ? item.recurring : "none";
  const status = STATUSES.has(item?.status) ? item.status : "aberto";
  const pinned = PINNED.has(item?.pinned) ? item.pinned : "main";
  const attachments = Array.isArray(item?.attachments) ? item.attachments.map(normalizeAttachment).filter(Boolean) : [];
  const calendarSync = item?.calendarSync === true || item?.integrar_calendario === true;

  return {
    id,
    title,
    description: String(item?.description || item?.descricao || "").trim(),
    type,
    collaboratorId: String(item?.collaboratorId || item?.colaborador_id || "").trim(),
    due: String(item?.due || item?.prazo || "").trim(),
    priority,
    recurring,
    status,
    pinned,
    calendarSync: type === "colaborador" && calendarSync,
    taskId: isUuid(String(item?.taskId || item?.tarefa_id || "")) ? String(item?.taskId || item?.tarefa_id) : "",
    attachments,
    deletedAt: normalizeDate(item?.deletedAt),
    completedAt: normalizeDate(item?.completedAt),
    createdBy: userId,
    createdAt: normalizeDate(item?.createdAt) || new Date().toISOString(),
    updatedAt: normalizeDate(item?.updatedAt) || new Date().toISOString()
  };
}

function normalizeAttachment(item) {
  if (!item) return null;
  const name = String(item.name || item.file_name || "").trim();
  if (!name) return null;

  return {
    id: String(item.id || randomId()),
    name,
    type: String(item.type || item.mime_type || "application/octet-stream"),
    size: Number(item.size || item.size_bytes || 0),
    dataUrl: String(item.dataUrl || ""),
    url: String(item.url || ""),
    createdAt: normalizeDate(item.createdAt) || new Date().toISOString()
  };
}

function fromCollaboratorRow(row) {
  return {
    id: row.id,
    name: row.nome,
    email: row.email,
    role: row.funcao || "",
    active: row.active !== false,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fromItemRow(row) {
  return {
    id: row.id,
    title: row.titulo,
    description: row.descricao || "",
    type: row.tipo || "colaborador",
    collaboratorId: row.colaborador_id || "",
    due: row.prazo || "",
    priority: row.prioridade || "media",
    recurring: row.recorrencia || "none",
    status: row.status || "aberto",
    pinned: row.pinned || "main",
    calendarSync: row.integrar_calendario === true,
    taskId: row.tarefa_id || "",
    attachments: Array.isArray(row.anexos) ? row.anexos : [],
    deletedAt: row.deleted_at || "",
    completedAt: row.completed_at || "",
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function fromPautaRow(row, usuarios, anexos, signedUrls) {
  return {
    id: row.id,
    title: row.titulo,
    description: row.descricao || "",
    type: "pauta",
    collaboratorId: "",
    due: row.prazo || "",
    priority: fromPautaPriority(row.prioridade),
    recurring: "none",
    status: row.status === "concluida" ? "concluido" : "aberto",
    pinned: row.destaque ? "main" : "main",
    attachments: anexos.map((anexo) => fromPautaAnexoRow(anexo, signedUrls)),
    deletedAt: "",
    completedAt: "",
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    scope: row.scope || "todos",
    assignedUsers: usuarios.map((item) => ({
      email: item.email,
      name: item.nome || item.email,
      userId: item.user_id || ""
    }))
  };
}

function fromPautaAnexoRow(row, signedUrls) {
  return {
    id: row.id,
    name: row.file_name,
    type: row.mime_type || "application/octet-stream",
    size: Number(row.size_bytes || 0),
    dataUrl: "",
    url: signedUrls.get(row.storage_path) || "",
    createdAt: row.created_at
  };
}

function toCollaboratorRow(item) {
  return {
    id: item.id,
    nome: item.name,
    email: item.email,
    funcao: item.role,
    active: item.active,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toItemRow(item) {
  return {
    id: item.id,
    titulo: item.title,
    descricao: item.description,
    tipo: item.type,
    colaborador_id: item.collaboratorId || null,
    prazo: item.due,
    prioridade: item.priority,
    recorrencia: item.recurring,
    status: item.status,
    pinned: item.pinned,
    integrar_calendario: item.calendarSync === true,
    tarefa_id: isUuid(item.taskId || "") ? item.taskId : null,
    anexos: item.attachments,
    deleted_at: item.deletedAt || null,
    completed_at: item.completedAt || null,
    created_by: item.createdBy,
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toNewPautaRow(item) {
  return {
    id: item.id,
    titulo: item.title,
    descricao: item.description,
    prazo: item.due || null,
    prioridade: toPautaPriority(item.priority),
    status: item.status === "concluido" ? "concluida" : "aberta",
    scope: "todos",
    destaque: item.pinned === "main",
    created_by: item.createdBy,
    created_by_email: "",
    created_at: item.createdAt,
    updated_at: item.updatedAt
  };
}

function toExistingPautaPatch(item) {
  return {
    titulo: item.title,
    descricao: item.description,
    prazo: item.due || null,
    prioridade: toPautaPriority(item.priority),
    status: item.status === "concluido" ? "concluida" : "aberta",
    destaque: item.pinned === "main",
    updated_at: item.updatedAt
  };
}

async function syncPautaAttachmentsFromCoord(supabaseUrl, serviceRoleKey, pautaItems) {
  const candidates = pautaItems
    .flatMap((item) =>
      (item.attachments || [])
        .filter((attachment) => attachment?.dataUrl && attachment.name)
        .map((attachment) => ({ pauta: item, attachment }))
    );

  if (!candidates.length) return;

  const pautaIds = [...new Set(candidates.map((item) => item.pauta.id).filter(Boolean))];
  const existingRows = pautaIds.length
    ? await supabaseRequest(
        `${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos?pauta_id=in.(${pautaIds.map(encodeURIComponent).join(",")})&select=id,pauta_id,file_name,size_bytes`,
        { headers: serviceHeaders(serviceRoleKey) }
      )
    : [];

  const existingIds = new Set((Array.isArray(existingRows) ? existingRows : []).map((row) => row.id));
  const existingKeys = new Set(
    (Array.isArray(existingRows) ? existingRows : []).map((row) => `${row.pauta_id}:${row.file_name}:${Number(row.size_bytes || 0)}`)
  );

  for (const { pauta, attachment } of candidates) {
    const bytes = parseDataUrlBytes(attachment.dataUrl);
    if (!bytes?.length) continue;

    const attachmentId = isUuid(attachment.id) ? attachment.id : randomId();
    const duplicateKey = `${pauta.id}:${attachment.name}:${bytes.length}`;
    if (existingIds.has(attachmentId) || existingKeys.has(duplicateKey)) continue;

    const storagePath = `pautas/${pauta.id}/${attachmentId}-${toSafeStorageFileName(attachment.name)}`;
    await uploadStorageObject(supabaseUrl, serviceRoleKey, "hub-anexos", storagePath, bytes, attachment.type || "application/octet-stream");

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/pauta_anexos`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({
        id: attachmentId,
        pauta_id: pauta.id,
        file_name: attachment.name,
        storage_path: storagePath,
        mime_type: attachment.type || "application/octet-stream",
        size_bytes: bytes.length,
        uploaded_by: pauta.createdBy || null
      })
    });

    existingIds.add(attachmentId);
    existingKeys.add(duplicateKey);
  }
}

async function syncCalendarTasksFromCoord(supabaseUrl, serviceRoleKey, reminders, collaborators) {
  const collaboratorById = new Map(collaborators.map((item) => [item.id, item]));
  const syncItems = reminders.filter((item) => item.type === "colaborador" && item.calendarSync === true && !item.deletedAt);
  const unsyncItems = reminders.filter((item) => item.type === "colaborador" && item.calendarSync !== true && isUuid(item.taskId || ""));

  for (const item of unsyncItems) {
    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefas?id=eq.${encodeURIComponent(item.taskId)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?id=eq.${encodeURIComponent(item.id)}`, {
      method: "PATCH",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({ tarefa_id: null })
    });
  }

  for (const item of syncItems) {
    const taskId = isUuid(item.taskId || "") ? item.taskId : randomId();
    const collaborator = collaboratorById.get(item.collaboratorId);
    const responsibleEmail = collaborator?.email || "";

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefas?on_conflict=id`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json",
        prefer: "resolution=merge-duplicates"
      },
      body: JSON.stringify({
        id: taskId,
        titulo: item.title,
        descricao: item.description || "",
        prazo: item.due || null,
        prioridade: coordPriorityToTaskPriority(item.priority),
        status: item.status === "concluido" ? "concluida" : "aberta",
        destaque: item.priority === "alta",
        origem: "coord",
        coord_item_id: item.id,
        created_by: item.createdBy || null,
        created_at: item.createdAt || new Date().toISOString(),
        updated_at: item.updatedAt || new Date().toISOString()
      })
    });

    if (taskId !== item.taskId) {
      item.taskId = taskId;
      await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/coord_itens?id=eq.${encodeURIComponent(item.id)}`, {
        method: "PATCH",
        headers: {
          ...serviceHeaders(serviceRoleKey),
          "content-type": "application/json"
        },
        body: JSON.stringify({ tarefa_id: taskId })
      });
    }

    await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefa_usuarios?tarefa_id=eq.${encodeURIComponent(taskId)}`, {
      method: "DELETE",
      headers: serviceHeaders(serviceRoleKey)
    });

    if (responsibleEmail) {
      const profileRows = await supabaseRequest(
        `${trimUrl(supabaseUrl)}/rest/v1/profiles?email=eq.${encodeURIComponent(responsibleEmail.toLowerCase())}&select=id,email,nome&limit=1`,
        { headers: serviceHeaders(serviceRoleKey) }
      );
      const profile = Array.isArray(profileRows) ? profileRows[0] : null;
      if (profile?.id) {
        await supabaseRequest(`${trimUrl(supabaseUrl)}/rest/v1/tarefa_usuarios`, {
          method: "POST",
          headers: {
            ...serviceHeaders(serviceRoleKey),
            "content-type": "application/json"
          },
          body: JSON.stringify({
            tarefa_id: taskId,
            user_id: profile.id,
            email: profile.email || responsibleEmail,
            nome: profile.nome || collaborator?.name || responsibleEmail
          })
        });
      }
    }
  }
}

function coordPriorityToTaskPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "normal";
}

async function uploadStorageObject(supabaseUrl, serviceRoleKey, bucket, storagePath, bytes, contentType) {
  const response = await fetch(`${trimUrl(supabaseUrl)}/storage/v1/object/${bucket}/${encodeStoragePath(storagePath)}`, {
    method: "POST",
    headers: {
      ...serviceHeaders(serviceRoleKey),
      "content-type": contentType,
      "x-upsert": "false"
    },
    body: bytes
  });

  const text = await response.text();
  if (!response.ok && response.status !== 409) {
    const data = parseJson(text);
    throw httpError(response.status, data?.message || data?.error || text || response.statusText);
  }
}

function parseDataUrlBytes(value) {
  const match = String(value || "").match(/^data:([^;,]+)?(?:;base64)?,(.*)$/);
  if (!match) return null;
  try {
    return Buffer.from(match[2], "base64");
  } catch {
    return null;
  }
}

// O bucket hub-anexos e privado: gera links assinados temporarios (1 hora)
// para os anexos das pautas entregues a Coordenacao.
const SIGNED_URL_TTL_SECONDS = 60 * 60;

async function createSignedStorageUrls(supabaseUrl, serviceRoleKey, bucket, paths) {
  const unique = Array.from(new Set((paths || []).filter(Boolean)));
  const result = new Map();
  if (!unique.length) return result;

  try {
    const response = await fetch(`${trimUrl(supabaseUrl)}/storage/v1/object/sign/${bucket}`, {
      method: "POST",
      headers: {
        ...serviceHeaders(serviceRoleKey),
        "content-type": "application/json"
      },
      body: JSON.stringify({ expiresIn: SIGNED_URL_TTL_SECONDS, paths: unique })
    });
    const data = parseJson(await response.text());
    if (!response.ok || !Array.isArray(data)) {
      console.warn("Não foi possível gerar links assinados dos anexos.", response.status);
      return result;
    }
    for (const item of data) {
      const signed = item?.signedURL || item?.signedUrl;
      if (!item?.path || !signed || item?.error) continue;
      result.set(item.path, `${trimUrl(supabaseUrl)}/storage/v1${signed.startsWith("/") ? "" : "/"}${signed}`);
    }
  } catch (error) {
    console.warn("Não foi possível gerar links assinados dos anexos.", error?.message || error);
  }
  return result;
}

function encodeStoragePath(value) {
  return String(value || "")
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function toSafeStorageFileName(fileName) {
  const normalized = String(fileName || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");

  return normalized || "pauta-anexo";
}

function fromPautaPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "media";
}

function toPautaPriority(value) {
  if (value === "alta" || value === "baixa") return value;
  return "normal";
}

async function verifySession(supabaseUrl, anonKey, token) {
  const user = await supabaseRequest(`${trimUrl(supabaseUrl)}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });

  if (!user?.id) {
    throw httpError(401, "Sessão inválida.");
  }

  return user;
}

async function readProfile(supabaseUrl, serviceRoleKey, userId) {
  const rows = await supabaseRequest(
    `${trimUrl(supabaseUrl)}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=role,active&limit=1`,
    { headers: serviceHeaders(serviceRoleKey) }
  );

  return Array.isArray(rows) ? rows[0] : null;
}

async function supabaseRequest(url, options) {
  const response = await fetch(url, options);
  const text = await response.text();
  const data = parseJson(text);

  if (!response.ok) {
    throw httpError(response.status, data?.message || data?.msg || data?.error || text || response.statusText);
  }

  return data;
}

function serviceHeaders(serviceRoleKey) {
  return {
    apikey: serviceRoleKey,
    authorization: `Bearer ${serviceRoleKey}`
  };
}

function json(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: JSON_HEADERS
  });
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function readBearerToken(value) {
  if (!value) return "";
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || "";
}

async function parseJsonBody(request) {
  try {
    return await request.json();
  } catch {
    throw httpError(400, "JSON inválido.");
  }
}

function parseJson(value) {
  if (!value) return null;

  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function normalizeDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toISOString();
}

function randomId() {
  return globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isUuid(value) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(value || ""));
}

function trimUrl(value) {
  return value.replace(/\/+$/, "");
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
