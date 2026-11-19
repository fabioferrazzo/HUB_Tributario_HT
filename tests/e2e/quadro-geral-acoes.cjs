// Quadro geral: editar/excluir tarefas e avisos direto no quadro; pautas concluídas (7 dias para os demais, exclusão em lote pelo admin).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);
const ADMIN = "fiscal10.hteixeira@gmail.com";
const COLAB = "colaborador@hteixeira.local";

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());

  const entrar = async (email) => {
    await page.goto(BASE + "/#/home");
    await page.waitForTimeout(500);
    if (await page.getByRole("button", { name: /^Sair/ }).count()) {
      await page.getByRole("button", { name: /^Sair/ }).first().click();
      await page.waitForTimeout(500);
    }
    await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
  };

  await entrar(ADMIN);
  await page.evaluate(({ ADMIN, COLAB }) => {
    const p = (n) => String(n).padStart(2, "0");
    const d = new Date();
    const hoje = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    const agora = d.toISOString();
    const diasAtras = (n) => new Date(Date.now() - n * 864e5).toISOString();
    localStorage.setItem("hub_quadro_avisos_app", JSON.stringify([
      { id: "a-colab", cell: 1, kind: "texto", visibility: "geral", title: "", content: "[TESTE] Aviso do colaborador", color: "", selectedUsers: [], createdBy: "", createdByEmail: COLAB, createdAt: agora, updatedAt: agora }
    ]));
    const base = { acoes: "<p>x</p>", prioridade: "normal", responsavel: "Colaborador", email: ADMIN, pendenciasObs: "", retorno: "", status: "aberta", periodicidade: "", concluidoEm: "", origem: "HUB Pautas", scope: "usuarios", destaque: false, responsaveis: [COLAB], anexos: [], createdBy: ADMIN, createdAt: agora, updatedAt: agora, modificadoEm: agora, prazo: `${hoje}T08:00` };
    localStorage.setItem("hub_pautas_app", JSON.stringify([
      { ...base, id: "p-velha", tema: "[TESTE] Concluída há 8 dias", conclusoes: [{ userId: "", email: COLAB, nome: "Colaborador", completedAt: diasAtras(8) }] },
      { ...base, id: "p-nova", tema: "[TESTE] Concluída há 2 dias", conclusoes: [{ userId: "", email: COLAB, nome: "Colaborador", completedAt: diasAtras(2) }] },
      { ...base, id: "p-fechada", tema: "[TESTE] Pauta encerrada", status: "concluída", concluidoEm: diasAtras(1), conclusoes: [] }
    ]));
  }, { ADMIN, COLAB });

  // tarefa criada pelo administrador no Calendário (hoje, 18h)
  await page.goto(BASE + "/#/tarefas"); await page.reload(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Nova tarefa" }).click(); await page.waitForTimeout(400);
  const novo = page.locator("form.task-form").first();
  await novo.getByLabel("Título").fill("[TESTE] Tarefa do admin");
  const hoje18 = new Date(); hoje18.setHours(18, 0, 0, 0);
  await novo.locator("input[type=datetime-local]").fill(new Date(hoje18.getTime() - hoje18.getTimezoneOffset() * 60000).toISOString().slice(0, 16));
  await page.getByRole("button", { name: "Salvar tarefa" }).click(); await page.waitForTimeout(1500);

  // --- administrador no Quadro geral
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  const tarefa = page.locator(".qg-item", { hasText: "Tarefa do admin" }).first();
  const aviso = page.locator(".qg-item", { hasText: "Aviso do colaborador" }).first();
  check("admin: tarefa com editar/excluir", (await tarefa.locator(".qg-item-acoes button").count()) === 2);
  check("admin: aviso com editar/excluir", (await aviso.locator(".qg-item-acoes button").count()) === 2);

  await tarefa.getByRole("button", { name: /Editar a tarefa/ }).click();
  await page.waitForTimeout(1500);
  const formTarefa = page.locator("form.task-form").first();
  check("editar tarefa abre o Calendário com o editor", /#\/tarefas/.test(page.url()) && (await formTarefa.getByLabel("Título").inputValue().catch(() => "")) === "[TESTE] Tarefa do admin");

  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  await page.locator(".qg-item", { hasText: "Aviso do colaborador" }).first().getByRole("button", { name: /Editar o aviso/ }).click();
  await page.waitForTimeout(1800);
  const editorAviso = page.locator(".avisos-editor-panel");
  check("editar aviso abre o Quadro de Avisos com o editor", /#\/pautas/.test(page.url()) && (await editorAviso.locator("h3").innerText().catch(() => "")) === "Editar aviso");

  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  await page.locator(".qg-item", { hasText: "Tarefa do admin" }).first().getByRole("button", { name: /Excluir a tarefa/ }).click();
  await page.waitForTimeout(1000);
  check("excluir tarefa no Quadro geral", (await page.locator(".qg-item", { hasText: "Tarefa do admin" }).count()) === 0);

  // --- concluídas: admin vê todas e exclui em lote
  await page.goto(BASE + "/#/pautas"); await page.waitForTimeout(1200);
  await page.locator(".filter-pill", { hasText: "Concluídas" }).click();
  await page.waitForTimeout(400);
  const nAdmin = await page.locator("[data-pauta-row]").count();
  check("admin vê as concluídas (antigas, recentes e encerradas)", nAdmin === 3 && (await page.locator("[data-pauta-row]", { hasText: "Pauta encerrada" }).count()) === 1, String(nAdmin));

  // --- colaborador
  await entrar(COLAB);
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  check("colaborador: editar/excluir o próprio aviso", (await page.locator(".qg-item", { hasText: "Aviso do colaborador" }).locator(".qg-item-acoes button").count()) === 2);
  await page.goto(BASE + "/#/pautas"); await page.waitForTimeout(1200);
  await page.locator(".filter-pill", { hasText: "Concluídas" }).click();
  await page.waitForTimeout(400);
  check("colaborador vê concluída há 2 dias", (await page.locator("[data-pauta-row]", { hasText: "Concluída há 2 dias" }).count()) === 1);
  check("colaborador não vê concluída há 8 dias", (await page.locator("[data-pauta-row]", { hasText: "Concluída há 8 dias" }).count()) === 0);
  check("colaborador não tem exclusão em lote", (await page.getByRole("button", { name: /Excluir concluídas/ }).count()) === 0);

  // --- admin exclui as concluídas em lote
  await entrar(ADMIN);
  await page.goto(BASE + "/#/pautas"); await page.waitForTimeout(1200);
  await page.locator(".filter-pill", { hasText: "Concluídas" }).click();
  await page.waitForTimeout(400);
  const botaoLote = page.getByRole("button", { name: /Excluir concluídas/ });
  check("admin tem 'Excluir concluídas'", (await botaoLote.count()) === 1);
  await botaoLote.click();
  await page.waitForTimeout(1200);
  check("concluídas excluídas", (await page.locator("[data-pauta-row]").count()) === 0, String(await page.locator("[data-pauta-row]").count()));

  check("sem erros de página", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
