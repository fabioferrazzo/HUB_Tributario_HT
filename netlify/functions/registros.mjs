// HUB Depto Tributário: aba Registros (aberturas, alterações contratuais e clientes novos).
// Ações (POST, JSON com "acao"):
//   - consultar-cnpj       (usuário ativo)   -> dados públicos da Receita (BrasilAPI, com reserva na Minha Receita)
//   - definir-responsavel  (administrador)   -> grava o responsável e avisa: e-mail, sino e aviso particular (30 dias)
//   - entrada-email        (script do Gmail, cabeçalho x-registros-token) -> cria/atualiza o registro com os anexos
import { processDueEmails } from "./email-outbox.mjs";
import { cnpjValido, consultarReceita, detectarTipo, extrairCnpjs, formatarCnpj, somenteDigitos } from "../lib/cnpj.mjs";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
const DIA_MS = 24 * 60 * 60 * 1000;
const PRAZO_AVISO_DIAS = 30;
const REMETENTES_PADRAO = ["societario.hteixeira@gmail.com", "carlosreis.hteixeira@gmail.com"];
const ANEXO_MAX_BYTES = 8 * 1024 * 1024;
const TIPOS_REGISTRO = new Set(["abertura", "alteracao", "cliente_novo", "outro"]);
const ROTULO_TIPO = { abertura: "Abertura", alteracao: "Alteração contratual", cliente_novo: "Cliente novo", outro: "Registro" };
const TITULO_ENTRADA = {
  abertura: "Abertura recebida por e-mail",
  alteracao: "Alteração contratual recebida por e-mail",
  cliente_novo: "Cliente novo recebido por e-mail",
  outro: "Registro recebido por e-mail"
};

export default async function handler(request) {
  if (request.method === "OPTIONS") return json(204, {});
  if (request.method !== "POST") return json(405, { error: "Método não permitido." });

  const supabaseUrl = trimUrl(getEnv("VITE_SUPABASE_URL") || getEnv("SUPABASE_URL"));
  const anonKey = getEnv("VITE_SUPABASE_ANON_KEY") || getEnv("SUPABASE_ANON_KEY");
  const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !anonKey || !serviceKey) return json(500, { error: "Variáveis Supabase ausentes no servidor." });

  try {
    const payload = await request.json().catch(() => {
      throw httpError(400, "JSON inválido.");
    });
    const acao = String(payload?.acao || "");
    const ctx = { supabaseUrl, anonKey, serviceKey, hubUrl: originOf(request) };

    if (acao === "entrada-email") return await entradaEmail(ctx, request, payload);

    const token = readBearer(request.headers.get("authorization"));
    if (!token) throw httpError(401, "Sessão do HUB não informada.");
    const authUser = await sb(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
    if (!authUser?.id) throw httpError(401, "Sessão inválida.");
    const [perfil] =
      (await sb(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(authUser.id)}&select=id,email,nome,role,active&limit=1`, {
        headers: svc(serviceKey)
      })) || [];
    if (!perfil || perfil.active === false) throw httpError(403, "Usuário inativo.");
    Object.assign(ctx, { token, authUser, perfil });

    if (acao === "consultar-cnpj") {
      const cnpj = somenteDigitos(payload?.cnpj);
      if (!cnpjValido(cnpj)) throw httpError(400, "CNPJ inválido. Confira os 14 dígitos.");
      return json(200, { ok: true, dados: await consultarReceita(cnpj) });
    }
    if (acao === "definir-responsavel") return await definirResponsavel(ctx, payload);
    throw httpError(400, "Ação desconhecida.");
  } catch (error) {
    return json(error?.statusCode || 400, { error: error?.message || "Não foi possível concluir a operação." });
  }
}

function linhaRegistroDaReceita(dados) {
  return {
    razao_social: dados.razaoSocial,
    nome_fantasia: dados.nomeFantasia,
    data_inicio: dados.dataInicio || null,
    situacao_cadastral: dados.situacao,
    natureza_juridica: dados.naturezaJuridica,
    municipio: dados.municipio,
    uf: dados.uf,
    socios: dados.socios,
    cnae_principal: dados.cnaePrincipal,
    cnaes_secundarios: dados.cnaesSecundarios,
    dados_receita: dados,
    receita_atualizada_em: dados.consultadoEm
  };
}

// ---------------------------------------------------------------------------------------------
// Responsável pela apuração

async function definirResponsavel(ctx, payload) {
  const { supabaseUrl, serviceKey, anonKey, token, perfil } = ctx;
  if (perfil.role !== "admin") throw httpError(403, "Somente o administrador define o responsável pela apuração.");
  const registroId = String(payload?.registroId || "");
  if (!/^[0-9a-f-]{36}$/i.test(registroId)) throw httpError(400, "Registro inválido.");
  const responsavelId = payload?.responsavelId ? String(payload.responsavelId) : null;

  const [responsavel] = responsavelId
    ? (await sb(`${supabaseUrl}/rest/v1/profiles?id=eq.${encodeURIComponent(responsavelId)}&select=id,email,nome,active&limit=1`, {
        headers: svc(serviceKey)
      })) || []
    : [null];
  if (responsavelId && (!responsavel || responsavel.active === false)) throw httpError(400, "Usuário inativo ou inexistente.");

  // Grava com a sessão do administrador (histórico mostra quem definiu).
  const userHeaders = { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" };
  const [registro] =
    (await sb(`${supabaseUrl}/rest/v1/hub_registros?id=eq.${registroId}&select=*`, {
      method: "PATCH",
      headers: { ...userHeaders, prefer: "return=representation" },
      body: JSON.stringify({ responsavel_id: responsavelId, status: "ativo" })
    })) || [];
  if (!registro) throw httpError(404, "Registro não encontrado.");

  // Aviso anterior deste registro sai do quadro (troca ou retirada do responsável).
  for (const aviso of await avisosDoRegistro(ctx, registroId)) await apagarAviso(ctx, aviso.id);

  await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos`, {
    method: "POST",
    headers: userHeaders,
    body: JSON.stringify({
      registro_id: registroId,
      tipo: "responsavel",
      resumo: responsavel ? `Responsável pela apuração: ${responsavel.nome || responsavel.email}` : "Responsável pela apuração retirado",
      created_by: perfil.id
    })
  });

  const resultado = { ok: true, emailEnviado: false, avisoCriado: false, notificado: false, erros: [] };
  if (!responsavel) return json(200, { ...resultado, mensagem: "Responsável retirado." });

  const nomeEmpresa = registro.razao_social || formatarCnpj(registro.cnpj) || "Empresa sem razão social";
  const titulo = `Apuração sob sua responsabilidade: ${nomeEmpresa}`;
  const definidoEm = registro.responsavel_definido_em || new Date().toISOString();

  try {
    await sb(`${supabaseUrl}/rest/v1/rpc/queue_email`, {
      method: "POST",
      headers: { ...svc(serviceKey), "content-type": "application/json" },
      body: JSON.stringify({
        p_to_email: String(responsavel.email).toLowerCase(),
        p_to_name: responsavel.nome || null,
        p_subject: titulo,
        p_html_body: emailResponsavelHtml(registro, responsavel, ctx.hubUrl),
        p_text_body: emailResponsavelTexto(registro, responsavel, ctx.hubUrl),
        p_category: "registros",
        p_target_type: "registro",
        p_target_ref: registroId,
        p_scheduled_for: new Date().toISOString(),
        p_dedupe_key: `registro_responsavel:${registroId}:${responsavel.id}:${definidoEm}`,
        p_created_by: perfil.id
      })
    });
    resultado.emailEnviado = true;
  } catch (error) {
    resultado.erros.push(`E-mail: ${error?.message || "não foi possível enfileirar."}`);
  }

  try {
    const agora = Date.now();
    const [aviso] =
      (await sb(`${supabaseUrl}/rest/v1/quadro_avisos?select=id`, {
        method: "POST",
        headers: { ...userHeaders, prefer: "return=representation" },
        body: JSON.stringify({
          cell: 1,
          kind: "texto",
          visibility: "particular",
          title: titulo.slice(0, 200),
          content: `${avisoResponsavelHtml(registro)}${marcaAviso({
            id: registroId,
            criado: new Date(agora).toISOString(),
            expira: new Date(agora + PRAZO_AVISO_DIAS * DIA_MS).toISOString()
          })}`,
          color: "#ffffff",
          created_by: perfil.id,
          created_by_email: String(perfil.email || "").toLowerCase()
        })
      })) || [];
    if (!aviso?.id) throw new Error("aviso não retornado.");
    await sb(`${supabaseUrl}/rest/v1/quadro_aviso_usuarios`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({ aviso_id: aviso.id, user_id: responsavel.id, email: String(responsavel.email).toLowerCase(), nome: responsavel.nome || "" })
    });
    resultado.avisoCriado = true;
  } catch (error) {
    resultado.erros.push(`Quadro de Avisos: ${error?.message || "não foi possível criar o aviso."}`);
  }

  if (responsavel.id !== perfil.id) {
    try {
      await sb(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
        method: "POST",
        headers: { ...svc(serviceKey), "content-type": "application/json", prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          user_id: responsavel.id,
          tipo: "registro",
          titulo: "Nova empresa sob sua responsabilidade",
          body: `${nomeEmpresa}${registro.cnpj ? ` (${formatarCnpj(registro.cnpj)})` : ""}: você foi definido como responsável pela apuração.`,
          meta: JSON.stringify({ route: "registros", id: registroId }),
          target_type: "registro",
          target_ref: registroId,
          dedupe_key: `registro_responsavel:${registroId}:${definidoEm}`,
          route: "registros",
          tone: "info",
          active: true
        })
      });
      resultado.notificado = true;
    } catch (error) {
      resultado.erros.push(`Sino: ${error?.message || "não foi possível notificar."}`);
    }
  }

  if (resultado.emailEnviado) {
    await processDueEmails(supabaseUrl, serviceKey, 1).catch((error) => resultado.erros.push(`E-mail na fila; envio imediato falhou: ${error?.message || error}`));
  }
  return json(200, resultado);
}

// Aviso particular ligado ao registro: mesma marca oculta dos lembretes da Coordenação.
function marcaAviso({ id, criado, expira }) {
  return `<!--hub:registro id=${id} criado=${criado} expira=${expira}-->`;
}

async function avisosDoRegistro(ctx, registroId) {
  const filtro = encodeURIComponent(`*hub:registro id=${registroId} *`);
  const rows = await sb(`${ctx.supabaseUrl}/rest/v1/quadro_avisos?content=like.${filtro}&select=id`, { headers: svc(ctx.serviceKey) });
  return Array.isArray(rows) ? rows : [];
}

async function apagarAviso(ctx, avisoId) {
  await sb(`${ctx.supabaseUrl}/rest/v1/quadro_avisos?id=eq.${encodeURIComponent(avisoId)}`, { method: "DELETE", headers: svc(ctx.serviceKey) });
}

function linhasResumo(registro) {
  const linhas = [
    ["Empresa", registro.razao_social || "(sem razão social)"],
    ["CNPJ", formatarCnpj(registro.cnpj) || "(a informar)"]
  ];
  if (registro.regime) linhas.push(["Regime", registro.regime]);
  if (registro.codigo_dominio) linhas.push(["Código no Domínio", registro.codigo_dominio]);
  if (registro.data_inicio) linhas.push(["Início", registro.data_inicio.split("-").reverse().join("/")]);
  linhas.push(["Tipo", ROTULO_TIPO[registro.tipo] || "Registro"]);
  return linhas;
}

function avisoResponsavelHtml(registro) {
  return [
    `<strong>${escapeHtml(registro.razao_social || formatarCnpj(registro.cnpj) || "Nova empresa")}</strong>`,
    ...linhasResumo(registro)
      .slice(1)
      .map(([rotulo, valor]) => `<strong>${escapeHtml(rotulo)}:</strong> ${escapeHtml(valor)}`),
    "<em>Detalhes e anexos na aba Registros.</em>"
  ].join("<br>");
}

function emailResponsavelHtml(registro, pessoa, hubUrl) {
  const celula = "border:1px solid #c9d1dc;padding:6px 10px;text-align:left;vertical-align:top";
  const cabeca = `${celula};background:#eef1f6;width:150px`;
  return [
    `<p>Olá, ${escapeHtml(primeiroNome(pessoa.nome || pessoa.email))}.</p>`,
    "<p>Você foi definido como responsável pela apuração desta empresa:</p>",
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">${linhasResumo(registro)
      .map(([r, v]) => `<tr><th style="${cabeca}">${escapeHtml(r)}</th><td style="${celula}">${escapeHtml(v)}</td></tr>`)
      .join("")}</table>`,
    "<p>Os dados completos, sócios, atividades e documentos estão na aba Registros do HUB. O aviso também está no seu Quadro de Avisos particular.</p>",
    hubUrl ? `<p><a href="${escapeHtml(hubUrl)}">Abrir o HUB Depto Tributário</a></p>` : "",
    "<p>H. Teixeira Contabilidade · Departamento Tributário</p>"
  ].join("");
}

function emailResponsavelTexto(registro, pessoa, hubUrl) {
  return [
    `Olá, ${primeiroNome(pessoa.nome || pessoa.email)}.`,
    "",
    "Você foi definido como responsável pela apuração desta empresa:",
    ...linhasResumo(registro).map(([r, v]) => `${r}: ${v}`),
    "",
    "Os dados completos estão na aba Registros do HUB.",
    hubUrl ? `HUB: ${hubUrl}` : ""
  ].join("\n");
}

// ---------------------------------------------------------------------------------------------
// Entrada por e-mail (script do Gmail)

async function entradaEmail(ctx, request, payload) {
  const esperado = getEnv("REGISTROS_ENTRADA_TOKEN");
  if (!esperado) throw httpError(503, "Entrada por e-mail não configurada (REGISTROS_ENTRADA_TOKEN).");
  if ((request.headers.get("x-registros-token") || "") !== esperado) throw httpError(401, "Token inválido.");

  const { supabaseUrl, serviceKey } = ctx;
  const headers = svc(serviceKey);
  const messageId = String(payload?.messageId || "").slice(0, 200);
  if (!messageId) throw httpError(400, "messageId ausente.");
  const remetente = extrairEmail(payload?.de);
  const permitidos = (getEnv("REGISTROS_REMETENTES") || REMETENTES_PADRAO.join(","))
    .split(/[,;\s]+/)
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!permitidos.includes(remetente)) return json(200, { ok: true, ignorado: true, motivo: `Remetente não autorizado: ${remetente || "(vazio)"}` });

  const [jaTratado] =
    (await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos?email_id=eq.${encodeURIComponent(messageId)}&select=id,registro_id&limit=1`, { headers })) || [];
  if (jaTratado) return json(200, { ok: true, duplicado: true, registroId: jaTratado.registro_id });

  const assunto = String(payload?.assunto || "").slice(0, 300);
  const corpo = String(payload?.corpo || "").slice(0, 20000);
  const ignorar = new Set(
    (getEnv("REGISTROS_CNPJ_IGNORAR") || "")
      .split(/[,;\s]+/)
      .map(somenteDigitos)
      .filter(Boolean)
  );
  const cnpjs = [...extrairCnpjs(assunto), ...extrairCnpjs(corpo)].filter((c, i, lista) => !ignorar.has(c) && lista.indexOf(c) === i);
  const cnpj = cnpjs[0] || "";
  const tipo = detectarTipo(`${assunto}\n${corpo}`);

  let dados = null;
  let erroReceita = "";
  if (cnpj) {
    try {
      dados = await consultarReceita(cnpj);
    } catch (error) {
      erroReceita = error?.message || "consulta indisponível";
    }
  }

  let registro = null;
  let criado = false;
  if (cnpj) {
    [registro] = (await sb(`${supabaseUrl}/rest/v1/hub_registros?cnpj=eq.${cnpj}&select=*&limit=1`, { headers })) || [];
  }
  if (registro) {
    [registro] =
      (await sb(`${supabaseUrl}/rest/v1/hub_registros?id=eq.${registro.id}&select=*`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({ status: "revisao", ...(TIPOS_REGISTRO.has(tipo) && tipo !== "outro" ? { tipo } : {}), ...(dados ? linhaRegistroDaReceita(dados) : {}) })
      })) || [registro];
  } else {
    const razaoDoAssunto = assunto.replace(/^(\s*(enc|fwd?|res|re)\s*:\s*)+/i, "").replace(/\b(abertura|altera[cç][aã]o( contratual)?|cliente novo)\b\s*[-:–]?\s*/gi, "").trim();
    [registro] =
      (await sb(`${supabaseUrl}/rest/v1/hub_registros?select=*`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({
          cnpj,
          tipo,
          status: "revisao",
          origem: "email",
          razao_social: dados?.razaoSocial || (cnpj ? "" : razaoDoAssunto.slice(0, 200)),
          regime: dados?.regimeSugerido || "",
          ...(dados ? linhaRegistroDaReceita(dados) : {})
        })
      })) || [];
    criado = true;
  }
  if (!registro?.id) throw httpError(500, "Não foi possível gravar o registro.");

  const avisosEvento = [];
  if (!cnpj) avisosEvento.push("CNPJ não identificado no e-mail: informe-o no registro.");
  if (cnpjs.length > 1) avisosEvento.push(`Outros CNPJs citados: ${cnpjs.slice(1).map(formatarCnpj).join(", ")}.`);
  if (erroReceita) avisosEvento.push(`Consulta à Receita: ${erroReceita}.`);

  const [evento] =
    (await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos?select=id`, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json", prefer: "return=representation" },
      body: JSON.stringify({
        registro_id: registro.id,
        tipo,
        resumo: [resumoCorpo(corpo), ...avisosEvento].filter(Boolean).join("\n"),
        assunto,
        remetente,
        email_id: messageId
      })
    })) || [];

  const anexosGravados = [];
  const anexosRecusados = [];
  for (const anexo of Array.isArray(payload?.anexos) ? payload.anexos.slice(0, 15) : []) {
    const nome = nomeSeguro(anexo?.nome || "anexo");
    try {
      const bytes = Buffer.from(String(anexo?.base64 || ""), "base64");
      if (!bytes.length) throw new Error("vazio");
      if (bytes.length > ANEXO_MAX_BYTES) throw new Error("grande demais");
      const caminho = `registros/${registro.id}/${crypto.randomUUID()}-${nome}`;
      await sb(`${supabaseUrl}/storage/v1/object/hub-anexos/${caminho.split("/").map(encodeURIComponent).join("/")}`, {
        method: "POST",
        headers: { ...headers, "content-type": anexo?.tipo || "application/octet-stream", "x-upsert": "false" },
        body: bytes
      });
      await sb(`${supabaseUrl}/rest/v1/hub_registros_anexos`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          registro_id: registro.id,
          evento_id: evento?.id || null,
          file_name: nome,
          storage_path: caminho,
          mime_type: String(anexo?.tipo || ""),
          size_bytes: bytes.length
        })
      });
      anexosGravados.push(nome);
    } catch (error) {
      anexosRecusados.push(`${nome} (${error?.message || "erro"})`);
    }
  }
  for (const nome of Array.isArray(payload?.anexosIgnorados) ? payload.anexosIgnorados : []) anexosRecusados.push(`${nomeSeguro(nome)} (grande demais para o e-mail automático)`);
  if (anexosRecusados.length && evento?.id) {
    await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos?id=eq.${evento.id}`, {
      method: "PATCH",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        resumo: [resumoCorpo(corpo), ...avisosEvento, `Anexos não gravados (anexe manualmente): ${anexosRecusados.join("; ")}.`].filter(Boolean).join("\n")
      })
    }).catch(() => null);
  }

  // Sino dos administradores: registro aguardando revisão.
  try {
    const admins = (await sb(`${supabaseUrl}/rest/v1/profiles?role=eq.admin&active=is.true&select=id`, { headers })) || [];
    const nomeEmpresa = registro.razao_social || formatarCnpj(cnpj) || assunto || "Registro sem identificação";
    if (admins.length) {
      await sb(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify(
          admins.map((admin) => ({
            user_id: admin.id,
            tipo: "registro",
            titulo: TITULO_ENTRADA[tipo] || TITULO_ENTRADA.outro,
            body: `${nomeEmpresa}: aguardando revisão na aba Registros.`,
            meta: JSON.stringify({ route: "registros", id: registro.id }),
            target_type: "registro",
            target_ref: registro.id,
            dedupe_key: `registro_entrada:${messageId}`,
            route: "registros",
            tone: "info",
            active: true
          }))
        )
      });
    }
  } catch (error) {
    console.warn("Registros: não foi possível notificar os administradores.", error?.message || error);
  }

  return json(200, { ok: true, registroId: registro.id, criado, cnpj, tipo, anexos: anexosGravados, anexosRecusados });
}

function resumoCorpo(corpo) {
  return String(corpo || "")
    .replace(/\r/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 1500);
}

function extrairEmail(valor) {
  const texto = String(valor || "").toLowerCase();
  return (texto.match(/<([^>]+)>/)?.[1] || texto).trim();
}

function nomeSeguro(nome) {
  return (
    String(nome || "anexo")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^\w.\- ]+/g, "_")
      .replace(/\s+/g, "_")
      .slice(-120) || "anexo"
  );
}

// ---------------------------------------------------------------------------------------------
// Utilidades

function primeiroNome(nome) {
  return String(nome || "").trim().split(/\s+/)[0] || "";
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

async function sb(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw httpError(response.status >= 500 ? 502 : 400, data?.message || data?.msg || data?.error || text || response.statusText);
  return data;
}

function svc(serviceKey) {
  return { apikey: serviceKey, authorization: `Bearer ${serviceKey}` };
}

function json(status, body) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function getEnv(name) {
  return globalThis.Netlify?.env?.get?.(name) || process.env[name] || "";
}

function readBearer(value) {
  return String(value || "").match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || "";
}

function trimUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

function originOf(request) {
  try {
    return new URL(request.url).origin;
  } catch {
    return "";
  }
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}
