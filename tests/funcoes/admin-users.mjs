// Função admin-users (netlify/functions/admin-users.mjs) com fetch simulado — senhas v2 (27/11/2026):
// usuário novo com senha provisória gerada pelo HUB, exigir troca no 1º acesso, bloquear troca por usuário,
// troca da própria senha (confere a senha atual) e aviso no sino dos administradores.
// Roda com: node tests/funcoes/admin-users.mjs
process.env.VITE_SUPABASE_URL = "https://exemplo.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "anon";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service";
process.env.EMAIL_DELIVERY_ENABLED = "true";
process.env.EMAIL_PROVIDER = "resend";
process.env.EMAIL_PROVIDER_API_KEY = "chave-teste";
process.env.EMAIL_FROM = "hub@teste.local";

const SESSOES = { "tok-admin": "u-admin", "tok-colab": "u-colab", "tok-novo": "u-novo" };
const banco = {
  perfis: new Map([
    ["u-admin", { id: "u-admin", email: "adm@teste.local", nome: "[TESTE] Admin", role: "admin", active: true, senha_provisoria: false, senha_troca_bloqueada: false }],
    ["u-colab", { id: "u-colab", email: "colab@teste.local", nome: "[TESTE] Colab", role: "colaborador", active: true, senha_provisoria: false, senha_troca_bloqueada: false }]
  ]),
  senhas: new Map([["u-admin", "Admin-1234"], ["u-colab", "Colab-1234"]]),
  autorizacoes: [],
  emails: [],
  notificacoes: [],
  fila: []
};
let emailFalha = false;
let colunasNovas = true;

const r = (body, status = 200) => new Response(body === null ? null : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  const metodo = opt.method || "GET";
  const corpo = opt.body ? JSON.parse(opt.body) : null;
  const auth = (opt.headers?.authorization || "").replace("Bearer ", "");
  if (u.endsWith("/auth/v1/user")) return SESSOES[auth] ? r({ id: SESSOES[auth], email: banco.perfis.get(SESSOES[auth])?.email }) : r({ msg: "invalid" }, 401);
  if (u.includes("/auth/v1/token?grant_type=password")) {
    const perfil = [...banco.perfis.values()].find((p) => p.email === corpo.email);
    return perfil && banco.senhas.get(perfil.id) === corpo.password ? r({ access_token: "x" }) : r({ error: "invalid_grant" }, 400);
  }
  if (u.endsWith("/auth/v1/admin/users") && metodo === "POST") {
    if ([...banco.perfis.values()].some((p) => p.email === corpo.email)) return r({ msg: "User already registered" }, 422);
    const id = "u-novo";
    banco.senhas.set(id, corpo.password);
    return r({ id, user: { id } });
  }
  const mAdminUser = u.match(/\/auth\/v1\/admin\/users\/([^/?]+)$/);
  if (mAdminUser && metodo === "PUT") {
    const id = decodeURIComponent(mAdminUser[1]);
    const aut = banco.autorizacoes.find((a) => a.user_id === id);
    if (!aut) return r({ msg: "sem autorização" }, 500);
    banco.autorizacoes = banco.autorizacoes.filter((a) => a !== aut);
    banco.senhas.set(id, corpo.password);
    banco.ultimaTroca = { id, por: aut.autorizado_por };
    return r({ id });
  }
  if (u.includes("/rest/v1/senha_autorizacoes")) {
    if (metodo === "POST") banco.autorizacoes.push(corpo);
    if (metodo === "DELETE") banco.autorizacoes = [];
    return r(null, 201);
  }
  if (u.includes("/rest/v1/profiles")) {
    if (!colunasNovas && /senha_/.test(u + JSON.stringify(corpo || {}))) return r({ message: 'column profiles.senha_provisoria does not exist' }, 400);
    const id = (u.match(/id=eq\.([^&]+)/) || [])[1];
    if (metodo === "PATCH") {
      Object.assign(banco.perfis.get(decodeURIComponent(id)), corpo);
      return r(null, 204);
    }
    if (metodo === "POST") {
      const atual = banco.perfis.get(corpo.id) || { senha_provisoria: false, senha_troca_bloqueada: false };
      const salvo = { ...atual, ...corpo };
      banco.perfis.set(corpo.id, salvo);
      return r([salvo]);
    }
    if (u.includes("role=eq.admin")) return r([...banco.perfis.values()].filter((p) => p.role === "admin" && p.active).map((p) => ({ id: p.id })));
    return r(id ? [banco.perfis.get(decodeURIComponent(id))].filter(Boolean) : [...banco.perfis.values()]);
  }
  if (u.includes("/rest/v1/notificacoes")) {
    banco.notificacoes.push(...corpo);
    return r(null, 201);
  }
  if (u.includes("/rest/v1/rpc/queue_email")) {
    banco.fila.push(corpo);
    return r("fila-1");
  }
  if (u.includes("/rest/v1/email_outbox")) return r(null, 204);
  if (u.startsWith("https://api.resend.com")) {
    if (emailFalha) return r({ message: "falha" }, 500);
    banco.emails.push(corpo);
    return r({ id: "email-1" });
  }
  return r({ message: `rota não simulada: ${metodo} ${u}` }, 404);
};

const { default: handler, gerarSenhaProvisoria, lerMarcasDeSenha } = await import("../../netlify/functions/admin-users.mjs");
const resultados = [];
const ok = (nome, cond, detalhe = "") => resultados.push(`${cond ? "OK   " : "FALHA"} ${nome}${cond || !detalhe ? "" : " -> " + detalhe}`);
const chamar = async (corpo, token) => {
  const res = await handler(new Request("https://hub/.netlify/functions/admin-users", { method: "POST", headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(corpo) }));
  return { status: res.status, data: await res.json() };
};
const textoEmails = () => JSON.stringify(banco.emails);

// Gerador de senha
const amostras = Array.from({ length: 200 }, gerarSenhaProvisoria);
ok("senha gerada: formato XXXX-XXXX-XXXX com maiúscula, minúscula e número", amostras.every((s) => /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4}$/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s)));
ok("senha gerada: sem caracteres que se confundem (0, O, 1, l, I)", amostras.every((s) => !/[0O1lI]/.test(s)));
ok("senha gerada: não se repete", new Set(amostras).size === amostras.length);
ok("marcas: bloquear prevalece sobre exigir troca", JSON.stringify(lerMarcasDeSenha({ bloquearTroca: true, exigirTroca: true })) === JSON.stringify({ senha_troca_bloqueada: true, senha_provisoria: false }));
ok("marcas: padrão é exigir troca", lerMarcasDeSenha({}).senha_provisoria === true);

// 1. Novo usuário, senha gerada pelo HUB, enviada por e-mail (não volta para a tela)
let res = await chamar({ nome: "[TESTE] Novo Colega", email: "novo@teste.local", role: "colaborador", active: true, gerarSenha: true, exigirTroca: true }, "tok-admin");
const senhaNovo = banco.senhas.get("u-novo");
ok("criar: usuário criado com senha gerada", res.status === 200 && /^[A-Za-z0-9]{4}-/.test(senhaNovo || ""), JSON.stringify(res.data));
ok("criar: e-mail enviado ao colega com a senha e o aviso do 1º acesso", res.data.emailSent === true && textoEmails().includes(senhaNovo) && /primeiro acesso/.test(textoEmails()) && /Seu acesso ao HUB/.test(textoEmails()));
ok("criar: a senha não volta para a tela quando o e-mail saiu", !("senhaParaInformar" in res.data) && !JSON.stringify(res.data).includes(senhaNovo));
ok("criar: fila de e-mails guarda o registro SEM a senha", !JSON.stringify(banco.fila).includes(senhaNovo) && /senha omitida/.test(JSON.stringify(banco.fila)));
ok("criar: marcado para trocar no 1º acesso", banco.perfis.get("u-novo").senha_provisoria === true && banco.perfis.get("u-novo").senha_troca_bloqueada === false);

// 2. Usuário comum não cria usuários
res = await chamar({ nome: "X", email: "x@teste.local", role: "colaborador", gerarSenha: true }, "tok-colab");
ok("criar: colaborador não pode criar usuário", res.status === 403);

// 3. Primeiro acesso: troca da própria senha
res = await chamar({ action: "trocar-propria-senha", senhaAtual: "errada", novaSenha: "MinhaSenha2026" }, "tok-novo");
ok("trocar: senha atual errada é recusada", res.status === 400 && /atual incorreta/.test(res.data.error), JSON.stringify(res.data));
res = await chamar({ action: "trocar-propria-senha", senhaAtual: senhaNovo, novaSenha: "curta1" }, "tok-novo");
ok("trocar: senha curta é recusada", res.status === 400 && /8 caracteres/.test(res.data.error));
res = await chamar({ action: "trocar-propria-senha", senhaAtual: senhaNovo, novaSenha: "somenteletras" }, "tok-novo");
ok("trocar: exige letras e números", res.status === 400 && /letras e números/.test(res.data.error));
res = await chamar({ action: "trocar-propria-senha", senhaAtual: senhaNovo, novaSenha: "MinhaSenha2026" }, "tok-novo");
ok("trocar: senha trocada pelo próprio usuário", res.status === 200 && banco.senhas.get("u-novo") === "MinhaSenha2026" && banco.ultimaTroca.por === "u-novo", JSON.stringify(res.data));
ok("trocar: deixa de ser provisória", banco.perfis.get("u-novo").senha_provisoria === false);
ok("trocar: administradores avisados no sino (sem a senha)", banco.notificacoes.some((n) => n.user_id === "u-admin" && /alterou a própria senha/.test(n.body)) && !JSON.stringify(banco.notificacoes).includes("MinhaSenha2026"));

// 4. Admin bloqueia a troca para o colaborador
res = await chamar({ action: "marcas-senha", id: "u-colab", nome: "[TESTE] Colab", email: "colab@teste.local", role: "colaborador", bloquearTroca: true }, "tok-admin");
ok("bloquear: admin bloqueia a troca do colaborador", res.status === 200 && banco.perfis.get("u-colab").senha_troca_bloqueada === true && banco.perfis.get("u-colab").senha_provisoria === false);
res = await chamar({ action: "trocar-propria-senha", senhaAtual: "Colab-1234", novaSenha: "OutraSenha99" }, "tok-colab");
ok("bloquear: colaborador bloqueado não troca a senha", res.status === 403 && /bloqueada pela coordenação/.test(res.data.error) && banco.senhas.get("u-colab") === "Colab-1234");
res = await chamar({ action: "marcas-senha", id: "u-colab", nome: "[TESTE] Colab", email: "colab@teste.local", role: "colaborador", bloquearTroca: true }, "tok-colab");
ok("bloquear: colaborador não mexe nas marcas", res.status === 403);

// 5. Admin redefine a senha (digitada por ele), mantendo o bloqueio; e-mail falha -> senha digitada não volta
emailFalha = true;
res = await chamar({ action: "reset-password", id: "u-colab", nome: "[TESTE] Colab", email: "colab@teste.local", role: "colaborador", password: "Definida-pelo-adm1", bloquearTroca: true }, "tok-admin");
ok("redefinir: admin define a senha de qualquer usuário", res.status === 200 && banco.senhas.get("u-colab") === "Definida-pelo-adm1" && banco.ultimaTroca.por === "u-admin");
ok("redefinir: e-mail falhou e a senha digitada pelo admin não volta na resposta", res.data.emailSent === false && !("senhaParaInformar" in res.data));
ok("redefinir: bloqueio mantido", banco.perfis.get("u-colab").senha_troca_bloqueada === true);

// 6. Redefinir gerando senha, com e-mail falhando: só nesse caso a senha volta para o admin informar
res = await chamar({ action: "reset-password", id: "u-novo", nome: "[TESTE] Novo Colega", email: "novo@teste.local", role: "colaborador", gerarSenha: true, exigirTroca: true }, "tok-admin");
ok("redefinir gerada + e-mail falhou: senha volta só para o admin", res.status === 200 && res.data.senhaParaInformar === banco.senhas.get("u-novo"));
ok("redefinir gerada: volta a exigir troca", banco.perfis.get("u-novo").senha_provisoria === true);
emailFalha = false;

// 7. Admin troca a própria senha sem aviso no sino
const notifAntes = banco.notificacoes.length;
res = await chamar({ action: "trocar-propria-senha", senhaAtual: "Admin-1234", novaSenha: "AdminNova2026" }, "tok-admin");
ok("admin troca a própria senha", res.status === 200 && banco.senhas.get("u-admin") === "AdminNova2026");
ok("admin: sem aviso para si mesmo", banco.notificacoes.length === notifAntes);

// 8. Sem sessão e banco sem a atualização
res = await chamar({ action: "trocar-propria-senha", senhaAtual: "a", novaSenha: "b" });
ok("sem sessão: recusado", res.status === 401);
colunasNovas = false;
res = await chamar({ action: "trocar-propria-senha", senhaAtual: "MinhaSenha2026", novaSenha: "Nova2026xx" }, "tok-novo");
ok("banco sem o patch: mensagem clara para executar patch_senhas_v2.sql", res.status === 500 && /patch_senhas_v2\.sql/.test(res.data.error), JSON.stringify(res.data));

const usuariosAntes = banco.perfis.size;
res = await chamar({ nome: "[TESTE] Outro", email: "outro@teste.local", role: "colaborador", gerarSenha: true }, "tok-admin");
ok("banco sem o patch: não cria usuário pela metade", res.status === 500 && /patch_senhas_v2\.sql/.test(res.data.error) && banco.perfis.size === usuariosAntes && !banco.senhas.has("u-outro"), JSON.stringify(res.data));

console.log(resultados.join("\n"));
const falhas = resultados.filter((l) => l.startsWith("FALHA")).length;
console.log(`\n${resultados.length - falhas} OK, ${falhas} falha(s)`);
process.exit(falhas ? 1 : 0);
