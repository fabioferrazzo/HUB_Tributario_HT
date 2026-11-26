// HUB Depto Tributário: aba Registros (aberturas, alterações contratuais e clientes novos).
// Ações (POST, JSON com "acao"):
//   - consultar-cnpj       (usuário ativo)   -> dados públicos da Receita (BrasilAPI, com reserva na Minha Receita)
//   - definir-responsavel  (administrador)   -> grava o responsável, inclui a empresa na apuração aberta dele
//                                               (Controle de Apuração) e avisa: sino e mensagem no chat
//   - entrada-email        (script do Gmail, cabeçalho x-registros-token) -> cria/atualiza o registro com os anexos
import { cnpjValido, consultarReceita, detectarTipo, extrairCnpjs, formatarCnpj, somenteDigitos } from "../lib/cnpj.mjs";

const JSON_HEADERS = { "content-type": "application/json", "cache-control": "no-store" };
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

  const resultado = { ok: true, notificado: false, chatEnviado: false, apuracao: null, erros: [] };
  if (!responsavel) return json(200, { ...resultado, mensagem: "Responsável retirado." });

  const nomeEmpresa = registro.razao_social || formatarCnpj(registro.cnpj) || "Empresa sem razão social";
  const definidoEm = registro.responsavel_definido_em || new Date().toISOString();

  // 1. Linha na apuração aberta do responsável (Controle de Apuração), pela função oficial do app.
  try {
    resultado.apuracao = await incluirNaApuracao(ctx, registro, responsavel);
  } catch (error) {
    resultado.apuracao = { incluida: false, competencia: "", mensagem: error?.message || "não foi possível incluir." };
    resultado.erros.push(`Controle de Apuração: ${resultado.apuracao.mensagem}`);
  }
  if (resultado.apuracao?.incluida) {
    await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos`, {
      method: "POST",
      headers: userHeaders,
      body: JSON.stringify({
        registro_id: registroId,
        tipo: "nota",
        resumo: resultado.apuracao.jaExistia
          ? `Controle de Apuração: ${resultado.apuracao.mensagem}`
          : resultado.apuracao.competencia
            ? `Incluída na apuração de ${rotuloCompetencia(resultado.apuracao.competencia)} de ${responsavel.nome || responsavel.email}.`
            : `Incluída na carteira de ${responsavel.nome || responsavel.email} no Controle de Apuração (sem período aberto).`,
        created_by: perfil.id
      })
    }).catch(() => null);
  }
  const textoApuracao = resultado.apuracao?.incluida
    ? resultado.apuracao.competencia
      ? `Ela já está na sua apuração de ${rotuloCompetencia(resultado.apuracao.competencia)} (Controle de Apuração).`
      : "Ela já está na sua carteira do Controle de Apuração e entra no próximo período que você gerar."
    : "";

  // 2. Mensagem no chat (conversa direta do administrador com o responsável).
  if (responsavel.id !== perfil.id) {
    try {
      const conversa = await sb(`${supabaseUrl}/rest/v1/rpc/chat_abrir_direta`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ p_outro: responsavel.id })
      });
      await sb(`${supabaseUrl}/rest/v1/rpc/chat_enviar`, {
        method: "POST",
        headers: userHeaders,
        body: JSON.stringify({ p_conversa: conversa, p_conteudo: mensagemChat(registro, textoApuracao), p_anexos: [] })
      });
      resultado.chatEnviado = true;
    } catch (error) {
      resultado.erros.push(`Chat: ${error?.message || "não foi possível enviar a mensagem."}`);
    }

    // 3. Sino do responsável.
    try {
      await sb(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
        method: "POST",
        headers: { ...svc(serviceKey), "content-type": "application/json", prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          user_id: responsavel.id,
          tipo: "registro",
          titulo: "Nova empresa sob sua responsabilidade",
          body: `${nomeEmpresa}${registro.cnpj ? ` (${formatarCnpj(registro.cnpj)})` : ""}: você é o responsável pela apuração.${textoApuracao ? ` ${textoApuracao}` : ""}`,
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

  return json(200, resultado);
}

// Competência aberta = a mais recente do responsável, se não estiver encerrada.
// Sem período aberto, a empresa entra só na carteira (aparece no próximo período gerado).
async function incluirNaApuracao(ctx, registro, responsavel) {
  const { supabaseUrl, serviceKey, anonKey, token } = ctx;
  if (!String(registro.razao_social || "").trim()) throw new Error("informe a razão social no registro antes de definir o responsável.");
  const periodos =
    (await sb(
      `${supabaseUrl}/rest/v1/apur_periods?owner_user_id=eq.${encodeURIComponent(responsavel.id)}&select=competence,status&order=competence.desc&limit=1`,
      { headers: svc(serviceKey) }
    )) || [];
  const ultimo = periodos[0];
  const competencia = ultimo && ultimo.status !== "CLOSED" ? ultimo.competence : "";
  const nota = `Incluída pela aba Registros (${ROTULO_TIPO[registro.tipo] || "Registro"}) em ${new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" })}.`;
  try {
    await sb(`${supabaseUrl}/rest/v1/rpc/apur_company_create`, {
      method: "POST",
      headers: { apikey: anonKey, authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({
        p: {
          owner_user_id: responsavel.id,
          legal_name: registro.razao_social,
          cnpj: registro.cnpj || "",
          dominio_code: registro.codigo_dominio || "",
          tax_regime: registro.regime || "OUTROS",
          notes: nota,
          competence: competencia || null
        }
      })
    });
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (/já cadastrad/i.test(mensagem)) {
      return { incluida: true, jaExistia: true, competencia, mensagem: `a empresa já estava na carteira do responsável (${mensagem.replace(/\.$/, "")}).` };
    }
    throw error;
  }
  return { incluida: true, jaExistia: false, competencia, mensagem: "" };
}

function rotuloCompetencia(comp) {
  const [ano, mes] = String(comp || "").split("-");
  return mes && ano ? `${mes}/${ano}` : comp;
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

function mensagemChat(registro, textoApuracao) {
  return [
    "<p><strong>Nova empresa sob sua responsabilidade</strong></p>",
    `<p>${linhasResumo(registro)
      .map(([rotulo, valor]) => `<strong>${escapeHtml(rotulo)}:</strong> ${escapeHtml(valor)}`)
      .join("<br>")}</p>`,
    textoApuracao ? `<p>${escapeHtml(textoApuracao)}</p>` : "",
    "<p>Sócios, atividades e documentos estão na aba Registros.</p>"
  ].join("");
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
