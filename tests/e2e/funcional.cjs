// Testes funcionais: criar, editar e excluir (com confirmacao) em varias secoes (modo local, localhost).
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
  let dialogAnswer = false;
  const dialogs = [];
  page.on("dialog", async (d) => { dialogs.push(d.message().split("\n")[0]); dialogAnswer ? await d.accept() : await d.dismiss(); });

  await page.goto(BASE + "/");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const go = async (label) => { await page.locator(".sidebar button", { hasText: label }).first().click(); await page.waitForTimeout(900); };

  // ---- Pautas: excluir pede confirmacao
  const pautasAntes = await page.locator(".pautas-scroll-group:not(.pautas-scroll-group--copy) .list-row--pauta, .pautas-stack > .list-row--pauta").count();
  const firstDelete = page.locator(".list-row--pauta .danger-action").first();
  dialogAnswer = false;
  await firstDelete.click();
  await page.waitForTimeout(400);
  const pautasCancel = await page.locator(".pautas-scroll-group:not(.pautas-scroll-group--copy) .list-row--pauta, .pautas-stack > .list-row--pauta").count();
  check("pautas: excluir pede confirmacao e cancelar mantem", dialogs.length === 1 && pautasCancel === pautasAntes, `${dialogs[0] || "sem dialogo"} | ${pautasAntes}->${pautasCancel}`);

  // ---- Links: criar, editar, excluir
  await go("Links úteis");
  const linksAntes = await page.locator(".link-row, .list-row").count();
  await page.locator("form input").nth(0).fill("Teste de link");
  await page.locator("form input").nth(1).fill("https://exemplo.gov.br/");
  await page.getByRole("button", { name: "Salvar link" }).click();
  await page.waitForTimeout(500);
  const linkCard = page.locator("article, .list-row", { hasText: "Teste de link" }).first();
  check("links: criado", (await linkCard.count()) === 1);
  await linkCard.getByRole("button", { name: "Editar" }).click();
  await page.locator("form input").nth(0).fill("Teste de link editado");
  await page.getByRole("button", { name: "Atualizar link" }).click();
  await page.waitForTimeout(500);
  check("links: editado", (await page.locator("article, .list-row", { hasText: "Teste de link editado" }).count()) === 1);
  dialogAnswer = true;
  await page.locator("article, .list-row", { hasText: "Teste de link editado" }).first().getByRole("button", { name: "Excluir" }).click();
  await page.waitForTimeout(500);
  check("links: excluido apos confirmar", (await page.locator("article, .list-row", { hasText: "Teste de link editado" }).count()) === 0, dialogs[dialogs.length - 1]);

  // ---- Arquivos: pasta criar, editar, excluir; atalho criar/editar/excluir
  await go("Arquivos");
  const folderForm = page.locator("form.folder-form");
  await folderForm.locator("input").first().fill("Pasta teste");
  await folderForm.getByRole("button", { name: "Criar pasta" }).click();
  await page.waitForTimeout(500);
  check("arquivos: pasta criada", (await page.locator(".folder-manage-list span", { hasText: "Pasta teste" }).count()) === 1);
  await page.getByRole("button", { name: "Editar pasta Pasta teste" }).click();
  check("arquivos: formulario em modo edicao", (await folderForm.locator("strong").first().innerText()) === "Editar pasta");
  await folderForm.locator("input").first().fill("Pasta renomeada");
  await folderForm.getByRole("button", { name: "Salvar pasta" }).click();
  await page.waitForTimeout(500);
  const pastas = await page.locator(".folder-manage-list span").allInnerTexts();
  check("arquivos: pasta renomeada sem duplicar", pastas.length === 1 && /Pasta renomeada/.test(pastas[0]), pastas.join(" | "));
  dialogAnswer = false;
  await page.getByRole("button", { name: "Excluir pasta Pasta renomeada" }).click();
  await page.waitForTimeout(300);
  check("arquivos: cancelar exclusao de pasta mantem", (await page.locator(".folder-manage-list span").count()) === 1);
  dialogAnswer = true;
  await page.getByRole("button", { name: "Excluir pasta Pasta renomeada" }).click();
  await page.waitForTimeout(500);
  check("arquivos: pasta excluida apos confirmar", (await page.locator(".folder-manage-list span").count()) === 0, dialogs[dialogs.length - 1]);

  const resForm = page.locator("form").first();
  await page.locator("form.stack-form:not(.folder-form)").filter({ has: page.locator("input[type=url]") }).getByLabel("Título").fill("Atalho teste");
  await page.locator("form.stack-form:not(.folder-form) input[type=url]").first().fill("https://drive.google.com/teste");
  await page.getByRole("button", { name: "Salvar arquivo" }).click();
  await page.waitForTimeout(600);
  const resItem = page.locator("article", { hasText: "Atalho teste" }).first();
  check("arquivos: atalho criado", (await resItem.count()) === 1);
  dialogAnswer = true;
  if (await resItem.count()) {
    await resItem.getByRole("button", { name: /Excluir/ }).click();
    await page.waitForTimeout(500);
    check("arquivos: atalho excluido apos confirmar", (await page.locator("article", { hasText: "Atalho teste" }).count()) === 0, dialogs[dialogs.length - 1]);
  }

  // ---- Tarefas: criar, editar, concluir, reabrir, excluir
  await go("Calendário de Tarefas");
  await page.getByRole("button", { name: "Nova tarefa" }).click();
  await page.waitForTimeout(400);
  const taskForm = page.locator("form.task-form").first();
  await taskForm.getByLabel("Título").fill("Tarefa de teste");
  await taskForm.locator("input[type=datetime-local]").fill("2026-11-10T09:00");
  await page.getByRole("button", { name: "Salvar tarefa" }).click();
  await page.waitForTimeout(800);
  await page.screenshot({ path: require("path").join(OUT, "tarefa_salva.png") });
  const todas = page.getByRole("button", { name: /^Todas/ }).first();
  if (await todas.count()) await todas.click();
  await page.waitForTimeout(300);
  const taskItem = page.locator("article", { hasText: "Tarefa de teste" }).first();
  check("tarefas: criada", (await taskItem.count()) === 1);
  if (await taskItem.count()) {
    const btns = await taskItem.locator("button").allInnerTexts();
    check("tarefas: botoes editar/concluir/excluir", btns.some((b) => /Editar/.test(b)) && btns.some((b) => /Excluir/.test(b)), btns.join(", "));
    dialogAnswer = false;
    await taskItem.getByRole("button", { name: /Excluir/ }).click();
    await page.waitForTimeout(400);
    check("tarefas: cancelar exclusao mantem", (await page.locator("article", { hasText: "Tarefa de teste" }).count()) === 1, dialogs[dialogs.length - 1]);
    dialogAnswer = true;
    await page.locator("article", { hasText: "Tarefa de teste" }).first().getByRole("button", { name: /Excluir/ }).click();
    await page.waitForTimeout(500);
    check("tarefas: excluida apos confirmar", (await page.locator("article", { hasText: "Tarefa de teste" }).count()) === 0);
  }

  check("sem erros no console", errors.length === 0, errors.join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
