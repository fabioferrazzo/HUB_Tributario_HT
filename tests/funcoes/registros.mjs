// Função registros (netlify/functions/registros.mjs) com fetch simulado:
// consulta de CNPJ, entrada por e-mail (remetente, CNPJ, tipo, anexos, duplicidade, sino) e definição do responsável.
// Roda com: node tests/funcoes/registros.mjs
process.env.VITE_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.REGISTROS_ENTRADA_TOKEN = "token-teste";

const chamadas = [];
const banco = { registros: new Map(), eventos: [], anexos: [], objetos: [], avisos: new Map(), destinatarios: [], notificacoes: [], fila: [] };
let receitaFalha = 0;
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
  opcao_pelo_mei: false
};

globalThis.fetch = async (url, opt = {}) => {
  const u = decodeURIComponent(String(url).replace("https://exemplo.supabase.co", ""));
  const m = opt.method || "GET";
  const corpoTexto = typeof opt.body === "string" ? opt.body : null;
  const body = corpoTexto ? JSON.parse(corpoTexto) : opt.body;
  chamadas.push({ m, u, auth: opt.headers?.authorization, body });
  const r = (d, status = 200) => new Response(JSON.stringify(d), { status });

  if (u.startsWith("https://brasilapi.com.br/api/cnpj/v1/")) {
    if (receitaFalha > 0) { receitaFalha -= 1; return r({ message: "indisponível" }, 503); }
    return u.endsWith("00000000000191") ? r({ message: "não encontrado" }, 404) : r(RECEITA);
  }
  if (u.startsWith("https://minhareceita.org/")) return r({ ...RECEITA, razao_social: "[TESTE] ACME (MINHA RECEITA)" });
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
    if (m === "GET") { const cnpj = (u.match(/cnpj=eq\.(\d+)/) || [])[1]; return r([...banco.registros.values()].filter((x) => x.cnpj === cnpj)); }
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
ok("consulta: CNPJ inexistente informa 'não encontrado'", r.status === 404 && /não encontrado/i.test(r.data.error), r.data.error);

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
ok("entrada: cria registro com CNPJ, tipo e dados da Receita", r.status === 200 && r.data.criado && reg?.cnpj === "11222333000181" && reg.tipo === "abertura" && reg.status === "revisao" && reg.origem === "email" && reg.razao_social === RECEITA.razao_social, JSON.stringify(r.data));
ok("entrada: regime sugerido e CNAEs gravados", reg?.regime === "Simples Nacional" && reg.cnaes_secundarios.length === 1 && reg.socios.length === 1);
ok("entrada: evento com assunto, remetente e id do e-mail", banco.eventos.some((e) => e.email_id === "msg-001" && e.remetente === "societario.hteixeira@gmail.com" && /Abertura/.test(e.assunto)));
ok("entrada: anexo gravado na pasta do registro (nome seguro)", banco.objetos.length === 1 && banco.objetos[0].caminho.startsWith(`registros/${reg.id}/`) && /Contrato_Social_ACME\.pdf$/.test(banco.objetos[0].caminho) && banco.anexos.length === 1, banco.objetos[0]?.caminho);
ok("entrada: anexo grande demais fica anotado no evento", banco.eventos.some((e) => /video-grande\.mp4/.test(e.resumo)));
ok("entrada: administradores avisados no sino", banco.notificacoes.some((n) => n.user_id === "u-admin" && n.titulo === "Abertura recebida por e-mail" && n.route === "registros" && n.dedupe_key === "registro_entrada:msg-001"));
const antes = banco.registros.size;
r = await chamar(email, { "x-registros-token": "token-teste" });
ok("entrada: o mesmo e-mail não é processado duas vezes", r.data.duplicado === true && banco.registros.size === antes && banco.objetos.length === 1);

r = await chamar({ ...email, messageId: "msg-002", assunto: "Alteração contratual - CNPJ 11222333000181", anexos: [] }, { "x-registros-token": "token-teste" });
const reg2 = banco.registros.get(r.data.registroId);
ok("entrada: alteração do mesmo CNPJ entra no registro existente", r.data.criado === false && r.data.registroId === reg.id && banco.registros.size === antes && reg2.tipo === "alteracao" && reg2.status === "revisao");

r = await chamar({ ...email, messageId: "msg-003", de: "carlosreis.hteixeira@gmail.com", assunto: "Fwd: Cliente novo - [TESTE] Padaria Serrana", corpo: "Vem de outro escritório, CNPJ ainda a confirmar.", anexos: [] }, { "x-registros-token": "token-teste" });
const reg3 = banco.registros.get(r.data.registroId);
ok("entrada: sem CNPJ cria registro pela razão do assunto", r.data.criado && reg3.cnpj === "" && reg3.tipo === "cliente_novo" && reg3.razao_social === "[TESTE] Padaria Serrana", reg3?.razao_social);
ok("entrada: evento avisa que falta o CNPJ", banco.eventos.some((e) => e.email_id === "msg-003" && /CNPJ não identificado/.test(e.resumo)));

// 3. Responsável pela apuração
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-colab" });
ok("responsável: colaborador não pode definir", r.status === 403);
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-colab" }, { authorization: "Bearer tok-admin" });
const patchReg = chamadas.find((c) => c.m === "PATCH" && c.u.startsWith(`/rest/v1/hub_registros?id=eq.${reg.id}`) && c.auth === "Bearer tok-admin");
ok("responsável: gravado com a sessão do administrador", r.status === 200 && Boolean(patchReg) && patchReg.body.responsavel_id === "u-colab", JSON.stringify(r.data));
const filaResp = banco.fila.at(-1);
ok("responsável: e-mail ao responsável", r.data.emailEnviado && filaResp?.p_to_email === "col@teste" && /Apuração sob sua responsabilidade: \[TESTE\] ACME/.test(filaResp.p_subject) && /11\.222\.333\/0001-81/.test(filaResp.p_html_body));
const aviso = [...banco.avisos.values()].at(-1);
ok("responsável: aviso particular por 30 dias", r.data.avisoCriado && aviso.visibility === "particular" && /<!--hub:registro id=[^ ]+ criado=\S+ expira=\S+-->$/.test(aviso.content) && banco.destinatarios.at(-1)?.user_id === "u-colab");
const m = aviso.content.match(/criado=(\S+) expira=(\S+?)-->/);
ok("responsável: prazo do aviso = 30 dias", m && Math.round((Date.parse(m[2]) - Date.parse(m[1])) / 86400000) === 30);
ok("responsável: sino do responsável", r.data.notificado && banco.notificacoes.some((n) => n.user_id === "u-colab" && n.route === "registros" && n.target_ref === reg.id));
ok("responsável: evento no histórico do registro", banco.eventos.some((e) => e.registro_id === reg.id && e.tipo === "responsavel" && /Colaboradora Teste/.test(e.resumo)));
const avisosAntes = banco.avisos.size;
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: "u-admin" }, { authorization: "Bearer tok-admin" });
ok("responsável: troca retira o aviso anterior", banco.avisos.size === avisosAntes && ![...banco.avisos.values()].some((a) => a.id === aviso.id));
ok("responsável: quem define a si mesmo não recebe sino", r.data.notificado === false);
r = await chamar({ acao: "definir-responsavel", registroId: reg.id, responsavelId: null }, { authorization: "Bearer tok-admin" });
ok("responsável: retirar apaga o aviso", r.status === 200 && ![...banco.avisos.values()].some((a) => a.content.includes(`hub:registro id=${reg.id} `)));

process.exit(falhas ? 1 : 0);
