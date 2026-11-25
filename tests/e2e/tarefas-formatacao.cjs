// Calendário de Tarefas: formatação nas notas da tarefa (tamanho, negrito, itálico, sublinhado, grifo e listas).
// A tarefa guarda o texto formatado; a lista mostra a formatação; o calendário e as exportações recebem texto simples.
// Modo local (localhost). Itens de teste marcados com [TESTE].
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/");
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); localStorage.setItem("hub_qp_tamanho", "compacto"); });
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.click(".side-nav button[title='Calendário de Tarefas']");
  await page.waitForSelector(".calendar-shell iframe");
  await page.waitForTimeout(1200);

  await page.click(".task-sidebar button:has-text('Nova tarefa')");
  await page.waitForTimeout(300);
  const form = page.locator(".task-sidebar--form");
  check("formulário com barra de formatação", (await form.locator(".pauta-format-toolbar").count()) === 1);
  for (const rotulo of ["Tamanho da fonte", "Negrito (Ctrl+B)", "Itálico (Ctrl+I)", "Sublinhado (Ctrl+U)", "Lista com marcadores", "Lista numerada"]) {
    check(`botão: ${rotulo}`, (await form.locator(`[aria-label='${rotulo}']`).count()) === 1);
  }
  check("botão de grifo", (await form.locator("button[title*='rifo'], button[aria-label*='rifo']").count()) >= 1);

  await form.locator("label", { hasText: "Título" }).locator("input").fill("[TESTE] Tarefa com notas formatadas");
  const editor = form.locator("[contenteditable='true']");
  await editor.click();
  await page.keyboard.type("Conferir [TESTE] guias");
  await page.keyboard.press("Control+A");
  await form.locator("[aria-label='Negrito (Ctrl+B)']").click();
  await form.locator("button[title*='rifo'], button[aria-label*='rifo']").first().click();
  await page.keyboard.press("Control+A");
  await form.locator("select[aria-label='Tamanho da fonte']").selectOption("grande");
  await page.keyboard.press("End");
  await page.keyboard.press("Enter");
  await form.locator("[aria-label='Lista com marcadores']").click();
  await page.keyboard.type("Item um");
  const html = await editor.evaluate((el) => el.innerHTML);
  check("editor aplica negrito, grifo, tamanho e lista", /<(b|strong)\b/.test(html) && /<mark|background/.test(html) && /pauta-text-large|<font/.test(html) && /<ul/.test(html), html.slice(0, 200));

  const amanha = new Date(Date.now() + 86400000);
  const pad = (n) => String(n).padStart(2, "0");
  await form.locator("input[type='datetime-local']").fill(`${amanha.getFullYear()}-${pad(amanha.getMonth() + 1)}-${pad(amanha.getDate())}T10:00`);
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(1500);

  const item = page.locator(".task-item", { hasText: "Tarefa com notas formatadas" }).first();
  check("tarefa salva na lista", (await item.count()) === 1);
  const prev = await item.locator(".task-note-preview").evaluate((el) => ({
    html: el.innerHTML,
    grifo: el.querySelector("mark") ? getComputedStyle(el.querySelector("mark")).backgroundColor : "",
    negrito: el.querySelector("strong") ? +getComputedStyle(el.querySelector("strong")).fontWeight : 0
  })).catch(() => ({ html: "", grifo: "", negrito: 0 }));
  check("lista mostra o negrito", prev.negrito >= 700, String(prev.negrito));
  check("lista mostra o grifo amarelo", prev.grifo === "rgb(255, 243, 163)", prev.grifo);
  check("lista não mostra marcação crua", !/&lt;/.test(prev.html), prev.html.slice(0, 120));

  const quadro = page.frames().find((f) => /calendar\.html/.test(f.url()));
  const semTags = await quadro.evaluate(() => {
    const txt = document.body.innerText;
    return !/<\/?(strong|mark|span|ul|li)/i.test(txt);
  });
  check("calendário recebe as notas sem marcação HTML", semTags);

  await item.locator("button", { hasText: "Editar" }).first().click();
  await page.waitForTimeout(500);
  const reaberto = await page.locator(".task-sidebar--form [contenteditable='true']").evaluate((el) => el.innerHTML);
  check("ao editar, a formatação volta no editor", /<strong/.test(reaberto) && /<mark/.test(reaberto), reaberto.slice(0, 160));
  await page.screenshot({ path: path.join(OUT, "tarefas-formatacao.png") });

  // Sem formatação: continua guardando texto simples.
  await page.click(".task-sidebar--form button:has-text('Cancelar')");
  await page.click(".task-sidebar button:has-text('Nova tarefa')");
  await page.waitForTimeout(300);
  await page.locator(".task-sidebar--form label", { hasText: "Título" }).locator("input").fill("[TESTE] Tarefa sem formatação");
  await page.locator(".task-sidebar--form [contenteditable='true']").click();
  await page.keyboard.type("Nota simples [TESTE]");
  await page.locator(".task-sidebar--form input[type='datetime-local']").fill(`${amanha.getFullYear()}-${pad(amanha.getMonth() + 1)}-${pad(amanha.getDate())}T11:00`);
  await page.locator(".task-sidebar--form button[type=submit]").click();
  await page.waitForTimeout(1500);
  const simples = await page.locator(".task-item", { hasText: "Tarefa sem formatação" }).first().locator(".task-note-preview").innerHTML().catch(() => "");
  check("nota sem formatação segue texto simples", simples.trim() === "Nota simples [TESTE]", simples);

  // Limpeza dos itens de teste.
  for (const titulo of ["Tarefa com notas formatadas", "Tarefa sem formatação"]) {
    const alvo = page.locator(".task-item", { hasText: titulo }).first();
    const excluir = alvo.locator("button", { hasText: "Excluir" });
    if (await excluir.count()) { await excluir.first().click(); await page.waitForTimeout(800); }
  }
  check("sem erros no console", errors.length === 0, errors.join(" | "));

  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})();
