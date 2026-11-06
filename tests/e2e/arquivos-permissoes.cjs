// Etapa 3: permissoes da tela Arquivos (modo local). Colaborador publica para todos; gestor so le; admin gerencia.
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|api\/agenda/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  const login = async (email) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(600);
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.locator(".sidebar button", { hasText: "Arquivos" }).first().click();
    await page.waitForTimeout(900);
  };
  const logout = async () => { await page.getByRole("button", { name: /Sair/ }).first().click(); await page.waitForTimeout(800); };
  const card = () => page.locator("article", { hasText: "Atalho do colaborador" }).first();
  const resourceForm = page.locator("form.stack-form:not(.folder-form)").filter({ has: page.locator("input[type=url]") });

  // 1) colaborador
  await login("colaborador@hteixeira.local");
  const vis = resourceForm.getByLabel("Visibilidade");
  check("colaborador: seletor de visibilidade no formulario de arquivo", (await vis.count()) === 1 && (await vis.inputValue()) === "global", await vis.inputValue().catch(() => "ausente"));
  const folderVis = page.locator("form.folder-form").getByLabel("Visibilidade");
  check("colaborador: seletor de visibilidade no formulario de pasta", (await folderVis.count()) === 1 && (await folderVis.inputValue()) === "global");
  check("colaborador: rotulo acentuado", (await resourceForm.getByLabel("Título").count()) === 1);
  await resourceForm.getByLabel("Título").fill("Atalho do colaborador");
  await resourceForm.locator("input[type=url]").fill("https://exemplo.gov.br/colab");
  await resourceForm.getByRole("button", { name: "Salvar arquivo" }).click();
  await page.waitForTimeout(700);
  check("colaborador: atalho criado", (await card().count()) === 1);
  check("colaborador: marcado como global", /global/i.test(await card().innerText()), (await card().innerText()).replace(/\s+/g, " ").slice(0, 120));
  check("colaborador: pode editar/excluir o proprio", (await card().getByRole("button", { name: "Editar" }).count()) === 1 && (await card().getByRole("button", { name: "Excluir" }).count()) === 1);
  await logout();

  // 2) gestor (outro usuario) so le
  await login("gestor.tributario@hteixeira.local");
  check("gestor: ve o atalho global do colaborador", (await card().count()) === 1);
  check("gestor: sem editar/excluir no arquivo alheio", (await card().getByRole("button", { name: "Editar" }).count()) === 0 && (await card().getByRole("button", { name: "Excluir" }).count()) === 0);
  check("gestor: pode abrir", (await card().locator("a").count()) >= 1);
  await logout();

  // 3) admin gerencia tudo
  await login("");
  check("admin: ve o atalho", (await card().count()) === 1);
  check("admin: pode editar/excluir", (await card().getByRole("button", { name: "Editar" }).count()) === 1 && (await card().getByRole("button", { name: "Excluir" }).count()) === 1);
  await card().getByRole("button", { name: "Excluir" }).click();
  await page.waitForTimeout(700);
  check("admin: excluiu", (await card().count()) === 0);

  check("sem erros de pagina", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
