// HUB Depto Tributário: aba Registros (aberturas, alterações contratuais e clientes novos).
// Ações (POST, JSON com "acao"):
//   - consultar-cnpj       (usuário ativo)   -> dados públicos da Receita (BrasilAPI, com reserva na Minha Receita)
//   - definir-responsavel  (administrador)   -> grava o responsável, inclui a empresa na apuração aberta dele
//                                               (Controle de Apuração) e avisa: sino e mensagem no chat
//   - enviar-contatos      (administrador ou responsável) -> leva telefones e e-mails ao cadastro da empresa no Controle de Apuração
//   - entrada-email        (script do Gmail, cabeçalho x-registros-token) -> cria/atualiza o registro (ou a alteração) com os anexos
import { CATEGORIAS_ALTERACAO, cnpjValido, consultarReceita, detectarCategorias, detectarTipo, extrairCnpjs, formatarCnpj, somenteDigitos } from "../lib/cnpj.mjs";

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
    if (acao === "enviar-contatos") return await enviarContatos(ctx, payload);
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
  let empresaApuracaoId = "";
  let jaExistia = false;
  let mensagemExistente = "";
  try {
    const criada = await sb(`${supabaseUrl}/rest/v1/rpc/apur_company_create`, {
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
    empresaApuracaoId = criada?.id || "";
  } catch (error) {
    const mensagem = String(error?.message || "");
    if (!/já cadastrad/i.test(mensagem)) throw error;
    jaExistia = true;
    mensagemExistente = `a empresa já estava na carteira do responsável (${mensagem.replace(/\.$/, "")}).`;
    empresaApuracaoId = (await localizarEmpresaApuracao(ctx, registro, responsavel.id)) || "";
  }
  const contatosEnviados = empresaApuracaoId ? await gravarContatosApuracao(ctx, empresaApuracaoId, registro).catch(() => false) : false;
  return { incluida: true, jaExistia, competencia, mensagem: mensagemExistente, contatosEnviados };
}

function contatosDoRegistro(registro) {
  return {
    telefone1: String(registro.telefone1 || "").trim(),
    telefone2: String(registro.telefone2 || "").trim(),
    email1: String(registro.email1 || "").trim().toLowerCase(),
    email2: String(registro.email2 || "").trim().toLowerCase()
  };
}

async function gravarContatosApuracao(ctx, empresaApuracaoId, registro) {
  const contatos = contatosDoRegistro(registro);
  if (!Object.values(contatos).some(Boolean)) return false;
  await sb(`${ctx.supabaseUrl}/rest/v1/rpc/apur_company_set_contacts`, {
    method: "POST",
    headers: { apikey: ctx.anonKey, authorization: `Bearer ${ctx.token}`, "content-type": "application/json" },
    body: JSON.stringify({ p_id: empresaApuracaoId, p: contatos })
  });
  return true;
}

async function localizarEmpresaApuracao(ctx, registro, donoId) {
  const base = `${ctx.supabaseUrl}/rest/v1/apur_companies?owner_user_id=eq.${encodeURIComponent(donoId)}&deleted=is.false&select=id,cnpj,legal_name`;
  const lista = (await sb(base, { headers: svc(ctx.serviceKey) })) || [];
  const cnpj = somenteDigitos(registro.cnpj);
  const chave = (texto) => String(texto || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
  const porCnpj = cnpj ? lista.find((item) => somenteDigitos(item.cnpj) === cnpj) : null;
  const porNome = lista.find((item) => chave(item.legal_name) === chave(registro.razao_social));
  return (porCnpj || porNome)?.id || "";
}

// Telefones e e-mails do registro para o cadastro da empresa no Controle de Apuração.
async function enviarContatos(ctx, payload) {
  const { supabaseUrl, serviceKey, perfil } = ctx;
  const registroId = String(payload?.registroId || "");
  if (!/^[0-9a-f-]{36}$/i.test(registroId)) throw httpError(400, "Registro inválido.");
  const [registro] = (await sb(`${supabaseUrl}/rest/v1/hub_registros?id=eq.${registroId}&select=*&limit=1`, { headers: svc(serviceKey) })) || [];
  if (!registro) throw httpError(404, "Registro não encontrado.");
  if (!registro.responsavel_id) throw httpError(400, "Defina primeiro o responsável pela apuração.");
  if (perfil.role !== "admin" && perfil.id !== registro.responsavel_id) throw httpError(403, "Somente o administrador ou o responsável pela empresa.");
  if (!Object.values(contatosDoRegistro(registro)).some(Boolean)) throw httpError(400, "Preencha ao menos um telefone ou e-mail e salve o registro.");
  const empresaApuracaoId = await localizarEmpresaApuracao(ctx, registro, registro.responsavel_id);
  if (!empresaApuracaoId) throw httpError(404, "A empresa não foi encontrada na carteira do responsável no Controle de Apuração.");
  await gravarContatosApuracao(ctx, empresaApuracaoId, registro);
  return json(200, { ok: true, mensagem: "Telefones e e-mails enviados ao cadastro da empresa no Controle de Apuração." });
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
  let empresa = null;
  if (cnpj) {
    [empresa] = (await sb(`${supabaseUrl}/rest/v1/hub_registros?cnpj=eq.${cnpj}&tipo=neq.alteracao&select=*&limit=1`, { headers })) || [];
  }
  const razaoDoAssunto = assunto
    .replace(/^(\s*(enc|fwd?|res|re)\s*:\s*)+/i, "")
    .replace(/\b(abertura|altera[cç][aã]o( contratual)?|cliente novo)\b\s*[-:–]?\s*/gi, "")
    .replace(/\d{2}[.\s]?\d{3}[.\s]?\d{3}[/\s]?\d{4}[-\s]?\d{2}/g, "")
    .replace(/[\s\-–:]+$/g, "")
    .trim();
  const dataEmail = dataEmSaoPaulo(payload?.data);

  if (tipo === "alteracao") {
    // Subaba Alterações: cada alteração é um item próprio, ligado ao registro da empresa (se houver).
    [registro] =
      (await sb(`${supabaseUrl}/rest/v1/hub_registros?select=*`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({
          cnpj,
          tipo: "alteracao",
          status: "revisao",
          origem: "email",
          empresa_id: empresa?.id || null,
          categorias: detectarCategorias(`${assunto}\n${corpo}`),
          data_alteracao: dataEmail,
          razao_social: dados?.razaoSocial || empresa?.razao_social || razaoDoAssunto.slice(0, 200),
          ie: empresa?.ie || "",
          codigo_dominio: empresa?.codigo_dominio || "",
          regime: empresa?.regime || dados?.regimeSugerido || "",
          ...(dados ? linhaRegistroDaReceita(dados) : {})
        })
      })) || [];
    criado = true;
    if (empresa) {
      await sb(`${supabaseUrl}/rest/v1/hub_registros?id=eq.${empresa.id}`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify(dados ? linhaRegistroDaReceita(dados) : { updated_at: new Date().toISOString() })
      }).catch(() => null);
      await sb(`${supabaseUrl}/rest/v1/hub_registros_eventos`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json" },
        body: JSON.stringify({
          registro_id: empresa.id,
          tipo: "alteracao",
          resumo: `Alteração recebida por e-mail (subaba Alterações)${dados ? "; dados da Receita atualizados" : ""}.`,
          assunto,
          remetente
        })
      }).catch(() => null);
    }
  } else if ((registro = empresa)) {
    [registro] =
      (await sb(`${supabaseUrl}/rest/v1/hub_registros?id=eq.${registro.id}&select=*`, {
        method: "PATCH",
        headers: { ...headers, "content-type": "application/json", prefer: "return=representation" },
        body: JSON.stringify({ status: "revisao", ...(TIPOS_REGISTRO.has(tipo) && tipo !== "outro" ? { tipo } : {}), ...(dados ? linhaRegistroDaReceita(dados) : {}) })
      })) || [registro];
  } else {
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
          telefone1: dados?.telefone1 || "",
          telefone2: dados?.telefone2 || "",
          email1: dados?.email || "",
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

  // Alteração em empresa que já tem responsável pela apuração: ele também é avisado no sino.
  if (tipo === "alteracao" && empresa?.responsavel_id) {
    try {
      const categorias = (registro.categorias || []).map((c) => CATEGORIAS_ALTERACAO[c] || c).join(", ");
      await sb(`${supabaseUrl}/rest/v1/notificacoes?on_conflict=user_id,dedupe_key`, {
        method: "POST",
        headers: { ...headers, "content-type": "application/json", prefer: "resolution=ignore-duplicates" },
        body: JSON.stringify({
          user_id: empresa.responsavel_id,
          tipo: "registro",
          titulo: "Alteração em empresa sob sua responsabilidade",
          body: `${empresa.razao_social || formatarCnpj(cnpj)}: ${categorias || "alteração contratual"}.`,
          meta: JSON.stringify({ route: "registros", id: registro.id }),
          target_type: "registro",
          target_ref: registro.id,
          dedupe_key: `registro_alteracao_resp:${messageId}`,
          route: "registros",
          tone: "info",
          active: true
        })
      });
    } catch (error) {
      console.warn("Registros: não foi possível avisar o responsável.", error?.message || error);
    }
  }

  return json(200, { ok: true, registroId: registro.id, criado, cnpj, tipo, anexos: anexosGravados, anexosRecusados });
}

function dataEmSaoPaulo(valor) {
  const data = valor ? new Date(valor) : new Date();
  const valida = Number.isNaN(data.getTime()) ? new Date() : data;
  return valida.toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
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
