// Senhas v2 (27/11/2026), modo demonstração: o administrador cria o usuário com senha provisória gerada pelo HUB;
// no primeiro acesso o HUB exige uma senha nova (sem como fugir, a não ser sair); depois o usuário troca a senha
// pelo menu; o administrador bloqueia a troca e a opção some para o usuário.
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);
const NOVO = { nome: "[TESTE] Colega Novo", email: "colega.novo@hteixeira.local" };

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, locale: "pt-BR" });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  const sair = async () => {
    await page.locator(".sidebar .sign-out", { hasText: "Sair" }).last().click();
    await page.waitForTimeout(700);
  };
  const entrar = async (email, senha) => {
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', senha);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
  };
  const campo = (rotulo) => page.locator(".admin-user-form label", { hasText: rotulo }).locator("input").first();

  await page.goto(BASE + "/");
  await page.evaluate(() => { localStorage.removeItem("hub_local_senhas"); localStorage.removeItem("hub_users"); });
  await page.reload();
  await entrar("", "hub-demo-2026");
  await page.locator(".sidebar button", { hasText: "Configurações" }).first().click();
  await page.waitForTimeout(1000);

  // 1. Criar com senha gerada pelo HUB (padrão) e troca obrigatória no 1º acesso
  check("formulário: padrão é gerar a senha e exigir troca", (await page.locator('.admin-senha input[type="radio"]').nth(0).isChecked()) && (await page.locator(".admin-senha label", { hasText: "Exigir troca" }).locator("input").isChecked()));
  await campo("Nome").fill(NOVO.nome);
  await campo("E-mail").fill(NOVO.email);
  await page.locator(".admin-user-form button[type=submit]").click();
  await page.waitForTimeout(900);
  const aviso = await page.locator(".module-notice").innerText();
  check("criar: aviso de usuário criado", /Colega Novo criado/.test(aviso), aviso);
  const caixa = page.locator(".admin-senha-informar");
  check("criar: senha escondida até clicar em Mostrar", (await caixa.count()) === 1 && /••••/.test(await caixa.innerText()));
  await caixa.getByRole("button", { name: /Mostrar/ }).click();
  const senhaProv = (await caixa.locator("code").innerText()).trim();
  check("criar: senha provisória no formato do HUB", /^[A-Za-z0-9]{4}-[A-Za-z0-9]{4}-[A-Za-z0-9]{4,5}$/.test(senhaProv), senhaProv);
  const item = page.locator(".admin-user", { hasText: NOVO.email });
  check("lista: selo Senha provisória", /Senha provisória/i.test(await item.innerText()));
  await page.screenshot({ path: path.join(OUT, "usuarios-senha-admin.png") });

  // 2. Primeiro acesso: troca obrigatória
  await sair();
  await entrar(NOVO.email, senhaProv);
  const dialogo = page.locator(".trocar-senha");
  check("1º acesso: HUB exige criar a senha", (await dialogo.count()) === 1 && /Crie sua senha/.test(await dialogo.innerText()));
  check("1º acesso: sem botão de fechar", (await dialogo.locator(".trocar-senha__fechar").count()) === 0);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  check("1º acesso: Esc não fecha", (await dialogo.count()) === 1);
  const enviar = dialogo.locator("button[type=submit]");
  await dialogo.locator("label", { hasText: "provisória" }).locator("input").fill(senhaProv);
  await dialogo.locator("label", { hasText: /^\s*Nova senha/ }).locator("input").fill("curta");
  check("regras: botão desativado com senha fraca", await enviar.isDisabled());
  await dialogo.locator("label", { hasText: /^\s*Nova senha/ }).locator("input").fill("MinhaSenha2026");
  await dialogo.locator("label", { hasText: "Confirme" }).locator("input").fill("MinhaSenha2026");
  check("regras: todas atendidas", (await dialogo.locator(".trocar-senha__regras li.ok").count()) === 4);
  await page.screenshot({ path: path.join(OUT, "usuarios-senha-primeiro-acesso.png") });
  await enviar.click();
  await page.waitForTimeout(1500);
  check("1º acesso: senha criada e HUB liberado", (await page.locator(".trocar-senha").count()) === 0 && (await page.locator(".sidebar").count()) === 1);

  // 3. Nova senha vale, a provisória não
  await sair();
  await entrar(NOVO.email, senhaProv);
  check("senha provisória não vale mais", (await page.locator(".sidebar").count()) === 0);
  await entrar(NOVO.email, "MinhaSenha2026");
  check("nova senha entra sem pedir troca", (await page.locator(".sidebar").count()) === 1 && (await page.locator(".trocar-senha").count()) === 0);

  // 4. Troca pelo menu (senha atual errada e depois certa)
  const botaoTroca = page.locator(".sidebar .sign-out", { hasText: "Trocar senha" });
  check("menu: opção Trocar senha disponível", (await botaoTroca.count()) === 1);
  await botaoTroca.click();
  await page.waitForTimeout(300);
  const d2 = page.locator(".trocar-senha");
  await d2.locator("label", { hasText: "Senha atual" }).locator("input").fill("errada123");
  await d2.locator("label", { hasText: /^\s*Nova senha/ }).locator("input").fill("OutraSenha2026");
  await d2.locator("label", { hasText: "Confirme" }).locator("input").fill("OutraSenha2026");
  await d2.locator("button[type=submit]").click();
  await page.waitForTimeout(500);
  check("menu: senha atual errada é recusada", /Senha atual incorreta/.test(await d2.innerText()));
  await d2.locator("label", { hasText: "Senha atual" }).locator("input").fill("MinhaSenha2026");
  await d2.locator("button[type=submit]").click();
  await page.waitForTimeout(1800);
  check("menu: senha trocada e janela fecha", (await page.locator(".trocar-senha").count()) === 0);

  // 5. Admin bloqueia a troca
  await sair();
  await entrar("", "hub-demo-2026");
  await page.locator(".sidebar button", { hasText: "Configurações" }).first().click();
  await page.waitForTimeout(900);
  await page.locator(".admin-user", { hasText: NOVO.email }).getByRole("button", { name: /Editar/ }).click();
  await page.waitForTimeout(300);
  check("editar: padrão é manter a senha atual", await page.locator(".admin-senha label", { hasText: "Manter a senha atual" }).locator("input").isChecked());
  await page.locator(".admin-senha label", { hasText: "Impedir" }).locator("input").check();
  check("editar: bloquear desativa 'exigir troca'", await page.locator(".admin-senha label", { hasText: "Exigir troca" }).locator("input").isDisabled());
  await page.locator(".admin-user-form button[type=submit]").click();
  await page.waitForTimeout(900);
  check("editar: opções gravadas", /opções de senha gravadas/.test(await page.locator(".module-notice").innerText()));
  check("lista: selo Troca de senha bloqueada", /bloqueada/i.test(await page.locator(".admin-user", { hasText: NOVO.email }).innerText()));

  // 6. Usuário bloqueado não vê a opção
  await sair();
  await entrar(NOVO.email, "OutraSenha2026");
  check("bloqueado: entra normalmente", (await page.locator(".sidebar").count()) === 1);
  check("bloqueado: opção Trocar senha some", (await page.locator(".sidebar .sign-out", { hasText: "Trocar senha" }).count()) === 0);

  check("sem erros de script", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => {
  console.error("ERRO", e);
  process.exit(1);
});
