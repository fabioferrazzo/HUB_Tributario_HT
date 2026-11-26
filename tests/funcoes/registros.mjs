// Função registros (netlify/functions/registros.mjs) com fetch simulado:
// consulta de CNPJ, entrada por e-mail (remetente, CNPJ, tipo, anexos, duplicidade, sino) e definição do responsável
// (apuração aberta, chat e sino).
// Roda com: node tests/funcoes/registros.mjs
process.env.VITE_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.REGISTROS_ENTRADA_TOKEN = "token-teste";

const chamadas = [];
const banco = { registros: new Map(), eventos: [], anexos: [], objetos: [], avisos: new Map(), destinatarios: [], notificacoes: [], fila: [], periodos: { "u-colab": [{ competence: "2026-11", status: "OPEN" }], "u-admin": [{ competence: "2026-10", status: "CLOSED" }] }, carteira: [], apuracao: [], chat: [], contatos: [] };
let receitaFalha = 0;
let receitaFora = false;
let seq = 0;

const RECEITA = {
  cnpj: "11222333000181",
  razao_social: "[TESTE] ACME COMERCIO LTDA",
  nome_fantasia: "ACME",
  data_inicio_atividade: "2026-11-03",
  descricao_situacao_cadastral: "ATIVA",
  natureza_juridica: "Sociedade Empresária Limitada",
  municipio: "SAO FRANCISCO DE PAULA",
  uf: "RS",
  cnae_fiscal: 4530703,
  cnae_fiscal_descricao: "Comércio a varejo de peças",
  cnaes_secundarios: [{ codigo: 4520001, descricao: "Manutenção mecânica" }],
  qsa: [{ nome_socio: "[TESTE] FULANO", qualificacao_socio: "Sócio-Administrador", data_entrada_sociedade: "2026-11-03" }],
  opcao_pelo_simples: true,
  opcao_pelo_mei: false,
  ddd_telefone_1: "5432441234",
  ddd_telefone_2: "",
  email: "Contato@Acme.com.br"
};

globalThis.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url).replace("https://exemplo.supabase.co", ""));
  const m = opt.method || "GET";
  const corpoTexto = typeof opt.body === "string" ? opt.body : null;
  const body = corpoTexto ? JSON.parse(corpoTexto) : opt.body;
  chamadas.push({ m, u, auth: opt.headers?.authorization, body });
  const r = (d, status = 200) => new Response(JSON.stringify(d), { status });

  if (u.startsWith("https://brasilapi.com.br/api/cnpj/v1/")) {
    if (receitaFora || receitaFalha > 0) { if (receitaFalha > 0) receitaFalha -= 1; return r({ message: "indisponível" }, 503); }
    return u.endsWith("00000000000191") ? r({ message: "não encontrado" }, 404) : r(RECEITA);
  }
  if (u.startsWith("https://minhareceita.org/")) {
    if (receitaFora) return r({ message: "indisponível" }, 503);
    return u.endsWith("00000000000191") ? r({ message: "não encontrado" }, 404) : r({ ...RECEITA, razao_social: "[TESTE] ACME (MINHA RECEITA)" });
  }
  if (u.startsWith("https://open.cnpja.com/office/")) {
    if (u.endsWith("00000000000191")) return r({ message: "não encontrado" }, 404);
    return r({ taxId: "11222333000181", company: { name: "[TESTE] ACME (CNPJÁ)", simples: { optant: true }, simei: { optant: false } }, status: { text: "Ativa" }, phones: [{ area: "54", number: "32441234" }] });
  }
  if (u.endsWith("/auth/v1/user")) return opt.headers?.authorization === "Bearer tok-admin" ? r({ id: "u-admin", email: "adm@teste" }) : r({ id: "u-colab", email: "col@teste" });
  if (u.includes("/profiles?id=eq.u-admin")) return r([{ id: "u-admin", email: "Adm@Teste", nome: "Fábio", role: "admin", active: true }]);
  if (u.includes("/profiles?id=eq.u-colab")) return r([{ id: "u-colab", email: "col@teste", nome: "Colaboradora Teste", role: "colaborador", active: true }]);
  if (u.includes("/profiles?role=eq.admin")) return r([{ id: "u-admin" }]);

  if (u.startsWith("/rest/v1/hub_registros_eventos")) {
    if (m === "GET") {
      const id = (u.match(/email_id=eq\.([^&]+)/) || [])[1];
      return r(banco.eventos.filter((e) => e.email_id === id).map((e) => ({ id: e.id, registro_id: e.registro_id })));
    }
    if (m === "POST") { const e = { id: `ev-${++seq}`, ...body }; banco.eventos.push(e); return r([{ id: e.id }], 201); }
    if (m === "PATCH") { const id = (u.match(/id=eq\.([^&]+)/) || [])[1]; Object.assign(banco.eventos.find((e) => e.id === id), body); return r([]); }
  }
  if (u.startsWith("/rest/v1/hub_registros_anexos")) { banco.anexos.push(body); return r([], 201); }
  if (u.startsWith("/rest/v1/hub_registros")) {
    if (m === "GET") {
      const id = (u.match(/[?&]id=eq\.([^&]+)/) || [])[1];
      if (id) return r([...banco.registros.values()].filter((x) => x.id === id));
      const cnpj = (u.match(/cnpj=eq\.(\d+)/) || [])[1];
      const semAlteracao = /tipo=neq\.alteracao/.test(u);
      return r([...banco.registros.values()].filter((x) => x.cnpj === cnpj && (!semAlteracao || x.tipo !== "alteracao")));
    }
    if (m === "POST") { const x = { id: `00000000-0000-4000-8000-${String(++seq).padStart(12, "0")}`, ...body }; banco.registros.set(x.id, x); return r([x], 201); }
    if (m === "PATCH") {
      const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
      const x = banco.registros.get(id);
      if (!x) return r([]);
      Object.assign(x, body, body.responsavel_id !== undefined ? { responsavel_definido_em: "2026-11-25T21:00:00.000Z" } : {});
      return r([x]);
    }
  }
  if (u.startsWith("/storage/v1/object/hub-anexos/")) { banco.objetos.push({ caminho: u.replace("/storage/v1/object/hub-anexos/", ""), bytes: body?.length || 0 }); return r({ Key: "ok" }); }
  if (u.startsWith("/rest/v1/notificacoes")) { (Array.isArray(body) ? body : [body]).forEach((n) => banco.notificacoes.push(n)); return r([], 201); }
  if (u.endsWith("/rpc/queue_email")) { banco.fila.push(body); return r("id"); }
  if (u.startsWith("/rest/v1/quadro_avisos")) {
    if (m === "POST") { const id = `aviso-${++seq}`; banco.avisos.set(id, { id, ...body }); return r([{ id }], 201); }
    if (m === "DELETE") { banco.avisos.delete((u.match(/id=eq\.([^&]+)/) || [])[1]); return r([]); }
    const like = (u.match(/content=like\.\*(.+?)\*&select/) || [])[1] || "";
    return r([...banco.avisos.values()].filter((a) => a.content.includes(like)).map((a) => ({ id: a.id })));
  }
  if (u.startsWith("/rest/v1/quadro_aviso_usuarios")) { banco.destinatarios.push(body); return r([], 201); }
  if (u.startsWith("/rest/v1/apur_periods")) {
    const dono = (u.match(/owner_user_id=eq\.([^&]+)/) || [])[1];
    return r(banco.periodos[dono] || []);
  }
  if (u.endsWith("/rpc/apur_company_create")) {
    const chave = `${body.p.owner_user_id}:${body.p.cnpj}`;
    if (banco.carteira.includes(chave)) return r({ message: "CNPJ já cadastrado para este responsável." }, 400);
    banco.carteira.push(chave);
    const id = `apur-${banco.carteira.length}`;
    banco.apuracao.push({ ...body.p, id, auth: opt.headers?.authorization });
    return r({ ok: true, id });
  }
  if (u.startsWith("/rest/v1/apur_companies")) {
    const dono = (u.match(/owner_user_id=eq\.([^&]+)/) || [])[1];
    return r(banco.apuracao.filter((x) => x.owner_user_id === dono).map((x) => ({ id: x.id, cnpj: x.cnpj, legal_name: x.legal_name })));
  }
  if (u.endsWith("/rpc/apur_company_set_contacts")) { banco.contatos.push({ ...body, auth: opt.headers?.authorization }); return r({ ok: true }); }
  if (u.endsWith("/rpc/chat_abrir_direta")) { if (body.p_outro === "u-admin") return r({ message: "Escolha outra pessoa para conversar." }, 400); return r("conv-1"); }
  if (u.endsWith("/rpc/chat_enviar")) { banco.chat.push({ ...body, auth: opt.headers?.authorization }); return r({ id: "m1" }); }
  if (u.includes("email_outbox") || u.includes("/rpc/")) return r([]);
  return r([]);
};

const { default: handler } = await import(new URL("../../netlify/functions/registros.mjs", import.meta.url).href);
let falhas = 0;
const ok = (n, c, d = "") => { if (!c) falhas += 1; console.log(`${c ? "OK   " : "FALHA"} ${n}${d ? " -> " + d : ""}`); };
const chamar = async (corpo, headers = {}) => {
  const res = await handler(new Request("https://hub-depto-tributario-ht.netlify.app/.netlify/functions/registros", { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(corpo) }));
  return { status: res.status, data: await res.json() };
};
const pdf = Buffer.from("%PDF-1.4 [TESTE] contrato").toString("base64");

// 1. Consulta de CNPJ
let r = await chamar({ acao: "consultar-cnpj", cnpj: "11.222.333/0001-81" }, { authorization: "Bearer tok-colab" });
ok("consulta: usuário ativo recebe dados normalizados", r.status === 200 && r.data.dados.razaoSocial === RECEITA.razao_social && r.data.dados.cnaePrincipal.codigo === "4530-7/03" && r.data.dados.regimeSugerido === "Simples Nacional", JSON.stringify(r.data).slice(0, 160));
r = await chamar({ acao: "consultar-cnpj", cnpj: "11222333000182" }, { authorization: "Bearer tok-colab" });
ok("consulta: CNPJ com dígito errado é recusado", r.status === 400 && /inválido/.test(r.data.error));
r = await chamar({ acao: "consultar-cnpj", cnpj: "11222333000181" });
ok("consulta: sem sessão é recusada", r.status === 401);
receitaFalha = 1;
r = await chamar({ acao: "consultar-cnpj", cnpj: "11222333000181" }, { authorization: "Bearer tok-colab" });
ok("consulta: BrasilAPI fora do ar usa a Minha Receita", r.status === 200 && r.data.dados.fonte === "Minha Receita", r.data.dados?.fonte);
r = await chamar({ acao: "consultar-cnpj", cnpj: "00.000.000/0001-91" }, { authorization: "Bearer tok-colab" });
ok("consulta: CNPJ inexistente informa 'não encontrado'", r.status === 404 && /não encontrad/i.test(r.data.error), r.data.error);
receitaFora = true;
r = await chamar({ acao: "consultar-cnpj", cnpj: "11222333000181" }, { authorization: "Bearer tok-colab" });
ok("consulta: BrasilAPI e Minha Receita fora do ar usam a CNPJá", r.status === 200 && r.data.dados.fonte === "CNPJá" && r.data.dados.razaoSocial === "[TESTE] ACME (CNPJÁ)" && r.data.dados.regimeSugerido === "Simples Nacional", JSON.stringify(r.data.dados || r.data));
receitaFora = false;

// 2. Entrada por e-mail
const email = {
  acao: "entrada-email",
  messageId: "msg-001",
  de: "Societário H. Teixeira <Societario.HTeixeira@gmail.com>",
  assunto: "ENC: Abertura - [TESTE] ACME 11.222.333/0001-81",
  corpo: "Segue contrato social da nova empresa.\nSócios: Fulano.",
  anexos: [{ nome: "Contrato Social ÁCME.pdf", tipo: "application/pdf", base64: pdf }],
  anexosIgnorados: ["video-grande.mp4"]
};
r = await chamar(email);
ok("entrada: sem token é recusada", r.status === 401);
r = await chamar({ ...email, de: "estranho@gmail.com" }, { "x-registros-token": "token-teste" });
ok("entrada: remetente não autorizado é ignorado", r.status === 200 && r.data.ignorado === true && banco.registros.size === 0);
r = await chamar(email, { "x-registros-token": "token-teste" });
const reg = banco.registros.get(r.data.registroId);
ok("entrada: cria registro com CNPJ, tipo e dados da Receita", r.status === 200 && r.data.criado && reg?.cnpj === "11222333000181" && reg.tipo === "abertura" && reg.status === "revisao" && reg.origem === "email" && reg.razao_social === "[TESTE] ACME" && reg.dados_receita?.razaoSocial === RECEITA.razao_social, reg?.razao_social);
ok("entrada: razão do e-mail diferente da Receita gera alerta no evento", banco.eventos.some((e) => e.email_id === "msg-001" && /diferente da Receita/.test(e.resumo) && /\[TESTE\] ACME COMERCIO LTDA/.test(e.resumo)));
ok("entrada: regime sugerido e CNAEs gravados", reg?.regime === "Simples Nacional" && reg.cnaes_secundarios.length === 1 && reg.socios.length === 1);
ok("entrada: telefone e e-mail da Receita no registro novo", reg?.telefone1 === "(54) 3244-1234" && reg.email1 === "contato@acme.com.br" && reg.telefone2 === "", `${reg?.telefone1} ${reg?.email1}`);
ok("entrada: evento com assunto, remetente e id do e-mail", banco.eventos.some((e) => e.email_id === "msg-001" && e.remetente === "societario.hteixeira@gmail.com" && /Abertura/.test(e.assunto)));
ok("entrada: anexo gravado na pasta do registro (nome seguro)", banco.objetos.length === 1 && banco.objetos[0].caminho.startsWith(`registros/${reg.id}/`) && /Contrato_Social_ACME\.pdf$/.test(banco.objetos[0].caminho) && banco.anexos.length === 1, banco.objetos[0]?.caminho);
ok("entrada: anexo grande demais fica anotado no evento", banco.eventos.some((e) => /video-grande\.mp4/.test(e.resumo)));
ok("entrada: administradores avisados no sino", banco.notificacoes.some((n) => n.user_id === "u-admin" && n.titulo === "Abertura recebida por e-mail" && n.route === "registros" && n.dedupe_key === "registro_entrada:msg-001"));
const antes = banco.registros.size;
r = await chamar(email, { "x-registros-token": "token-teste" });
ok("entrada: o mesmo e-mail não é processado duas vezes", r.data.duplicado === true && banco.registros.size === antes && banco.objetos.length === 1);

r = await chamar({ ...email, messageId: "msg-002", data: "2026-11-20T13:00:00Z", assunto: "Alteração contratual - entrada de sócio e inclusão de CNAE - CNPJ 11222333000181", anexos: [] }, { "x-registros-token": "token-teste" });
const reg2 = banco.registros.get(r.data.registroId);
ok("entrada: alteração vira item próprio (subaba Alterações) ligado à empresa", r.data.criado === true && r.data.registroId !== reg.id && banco.registros.size === antes + 1 && reg2.tipo === "alteracao" && reg2.empresa_id === reg.id && reg2.status === "revisao" && reg.tipo === "abertura", JSON.stringify({ tipo: reg2?.tipo, empresa: reg2?.empresa_id }));
ok("entrada: categorias e data da alteração", JSON.stringify(reg2.categorias) === JSON.stringify(["quadro_societario", "cnae", "contrato_social"]) && reg2.data_alteracao === "2026-11-20", JSON.stringify(reg2.categorias) + " " + reg2.data_alteracao);
ok("entrada: empresa recebe evento da alteração", banco.eventos.some((e) => e.registro_id === reg.id && e.tipo === "alteracao" && /subaba Alterações/.test(e.resumo)));
ok("entrada: administradores avisados da alteração", banco.notificacoes.some((n) => n.titulo === "Alteração contratual recebida por e-mail" && n.target_ref === reg2.id));

r = await chamar({ ...email, messageId: "msg-003", de: "carlosreis.hteixeira@gmail.com", assunto: "Fwd: Cliente novo - [TESTE] Padaria Serrana", corpo: "Vem de outro escritório, CNPJ ainda a confirmar.", anexos: [] }, { "x-registros-token": "token-teste" });
const reg3 = banco.registros.get(r.data.registroId);
ok("entrada: sem CNPJ cria registro pela razão do assunto", r.data.criado && reg3.cnpj === "" && reg3.tipo === "cliente_novo" && reg3.razao_social === "[TESTE] Padaria Serrana", reg3?.razao_social);
ok("entrada: evento avisa que falta o CNPJ", banco.eventos.some((e) => e.email_id === "msg-003" && /CNPJ não identificado/.test(e.resumo)));
receitaFora = true;
r = await chamar(
  { ...email, messageId: "msg-real", assunto: "cliente novo", corpo: "[TESTE] KETERSON ALESSANDRO PAIM LTDA, CNPJ 62865660000192, data da alteração 19/11/2026\n\nAtenciosamente.", anexos: [], anexosIgnorados: [] },
  { "x-registros-token": "token-teste" }
);
receitaFora = false;
const regReal = banco.registros.get(r.data.registroId);
ok("entrada: razão social tirada do texto quando o assunto não tem nome", r.data.criado && regReal?.razao_social === "[TESTE] KETERSON ALESSANDRO PAIM LTDA" && regReal.cnpj === "62865660000192" && regReal.tipo === "cliente_novo", regReal?.razao_social);

// 3. Responsável pela apuração
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-colab" });
ok("responsável: colaborador não pode definir", r.status === 403);
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-admin" });
const patchReg = chamadas.find((c) => c.m === "PATCH" && c.u.startsWith(`/rest/v1/hub_registros?id=eq.${reg.id}`) && c.auth === "Bearer tok-admin");
ok("responsável: gravado com a sessão do administrador", r.status === 200 && Boolean(patchReg) && patchReg.body.responsavel_id === "u-colab", JSON.stringify(r.data));
const apur = banco.apuracao.at(-1);
ok("responsável: empresa incluída na apuração aberta (11/2026) do responsável", r.data.apuracao?.incluida && r.data.apuracao.competencia === "2026-11" && apur?.owner_user_id === "u-colab" && apur.competence === "2026-11" && apur.legal_name === "[TESTE] ACME" && apur.cnpj === "11222333000181" && apur.tax_regime === "Simples Nacional" && apur.auth === "Bearer tok-admin", JSON.stringify(r.data.apuracao));
ok("responsável: mensagem no chat com a sessão do administrador", r.data.chatEnviado && banco.chat.at(-1)?.p_conversa === "conv-1" && banco.chat.at(-1).auth === "Bearer tok-admin" && /Nova empresa sob sua responsabilidade/.test(banco.chat.at(-1).p_conteudo) && /apuração de 11\/2026/.test(banco.chat.at(-1).p_conteudo));
ok("responsável: sino do responsável", r.data.notificado && banco.notificacoes.some((n) => n.user_id === "u-colab" && n.route === "registros" && n.target_ref === reg.id && /11\/2026/.test(n.body)));
ok("responsável: sem e-mail e sem aviso no quadro", banco.fila.length === 0 && banco.avisos.size === 0);
ok("responsável: eventos no histórico do registro", banco.eventos.some((e) => e.registro_id === reg.id && e.tipo === "responsavel" && /Colaboradora Teste/.test(e.resumo)) && banco.eventos.some((e) => e.registro_id === reg.id && /Incluída na apuração de 11\/2026/.test(e.resumo)));
ok("responsável: sem erros", r.data.erros.length === 0, JSON.stringify(r.data.erros));
ok("responsável: telefones e e-mails vão ao cadastro da empresa no Controle de Apuração", r.data.apuracao.contatosEnviados && banco.contatos.at(-1)?.p_id === "apur-1" && banco.contatos.at(-1).p.telefone1 === "(54) 3244-1234" && banco.contatos.at(-1).p.email1 === "contato@acme.com.br" && banco.contatos.at(-1).auth === "Bearer tok-admin", JSON.stringify(banco.contatos.at(-1)));

// alteração em empresa que já tem responsável: o responsável é avisado no sino
r = await chamar({ ...email, messageId: "msg-004", assunto: "ALTERAÇÃO - mudança de endereço - 11.222.333/0001-81", anexos: [] }, { "x-registros-token": "token-teste" });
ok("entrada: responsável da empresa avisado da alteração", banco.notificacoes.some((n) => n.user_id === "u-colab" && n.titulo === "Alteração em empresa sob sua responsabilidade" && /Endereço/.test(n.body)), JSON.stringify(banco.notificacoes.at(-1)));

// enviar contatos depois (registro editado)
reg.telefone2 = "(54) 99999-0000";
r = await chamar({ acao: "enviar-contatos", registroId: reg.id }, { authorization: "Bearer tok-colab" });
ok("contatos: o responsável reenvia ao Controle de Apuração", r.status === 200 && banco.contatos.at(-1).p.telefone2 === "(54) 99999-0000" && banco.contatos.at(-1).p_id === "apur-1", JSON.stringify(r.data));
const outro = banco.registros.get(reg3.id);
r = await chamar({ acao: "enviar-contatos", registroId: reg3.id }, { authorization: "Bearer tok-colab" });
ok("contatos: sem responsável definido é recusado", r.status === 400 && /responsável/.test(r.data.error), r.data.error);

r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-admin" });
ok("responsável: empresa já na carteira não duplica (informa) e atualiza os contatos", r.data.apuracao?.jaExistia === true && banco.apuracao.length === 1 && r.data.erros.length === 0 && r.data.apuracao.contatosEnviados === true, JSON.stringify(r.data.apuracao));

r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-admin" }, { authorization: "Bearer tok-admin" });
ok("responsável: sem período aberto, entra só na carteira", r.data.apuracao?.incluida && r.data.apuracao.competencia === "" && banco.apuracao.at(-1).competence === null, JSON.stringify(r.data.apuracao));
ok("responsável: quem define a si mesmo não recebe sino nem chat", r.data.notificado === false && r.data.chatEnviado === false && r.data.erros.length === 0);

const semRazao = banco.registros.get(reg3.id);
semRazao.razao_social = "";
r = await chamar({ acao: "definir-responsavel", registroId: reg3.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-admin" });
ok("responsável: sem razão social avisa e ainda notifica", r.status === 200 && r.data.apuracao?.incluida === false && /razão social/.test(r.data.erros.join(" ")) && r.data.notificado);

r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: null }, { authorization: "Bearer tok-admin" });
ok("responsável: retirar funciona", r.status === 200 && r.data.mensagem === "Responsável retirado.");

process.exit(falhas ? 1 : 0);
