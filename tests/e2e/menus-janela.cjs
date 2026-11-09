// Telas do HUB (Pautas, Arquivos, Links...): tela cheia, nova janela, rota no endereço e guarda de acesso.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  const login = async (email) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(500);
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
  };
  const menu = (label) => page.locator(".sidebar button", { hasText: label }).first();

  await login("");
  for (const label of ["Pautas", "Calendário de Tarefas", "Arquivos", "Links úteis", "Configurações"]) {
    await menu(label).click();
    await page.waitForTimeout(700);
    const fsBtn = page.locator(".top-page-actions button[aria-label='Tela cheia']");
    const winBtn = page.locator(".top-page-actions button[aria-label='Abrir em nova janela']");
    check(`${label}: botões de tela cheia e nova janela`, (await fsBtn.count()) === 1 && (await winBtn.count()) === 1);
  }
  await menu("Arquivos").click();
  await page.waitForTimeout(700);
  check("rota no endereço", page.url().endsWith("#/arquivos"), page.url().replace(BASE, ""));
  await page.locator(".top-page-actions button[aria-label='Tela cheia']").click();
  await page.waitForTimeout(400);
  check("tela cheia na área de trabalho", await page.evaluate(() => Boolean(document.fullscreenElement && document.fullscreenElement.classList.contains("workspace-body"))));
  await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
  await page.waitForTimeout(300);

  const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }).catch(() => null), page.locator(".top-page-actions button[aria-label='Abrir em nova janela']").click()]);
  check("nova janela aberta", Boolean(popup), popup ? popup.url().replace(BASE, "") : "sem janela");
  if (popup) {
    await popup.waitForLoadState("load").catch(() => {});
    await popup.waitForTimeout(1500);
    check("nova janela em modo janela (sem menu lateral)", (await popup.locator(".sidebar").count()) === 0 && (await popup.locator(".window-mode-bar strong", { hasText: "Arquivos" }).count()) === 1);
    check("nova janela mostra o conteúdo de Arquivos", (await popup.locator(".arquivos-form-panel").count()) === 1);
    await popup.close();
  }
  // app incorporado: os botões ficam na moldura, não na barra do topo
  await menu("Agenda tributária").click();
  await page.waitForTimeout(800);
  check("apps usam a moldura própria", (await page.locator(".top-page-actions").count()) === 0 && (await page.locator(".frame-actions").count()) === 1);

  // guarda de acesso pelo endereço
  await page.getByRole("button", { name: /Sair/ }).first().click();
  await page.waitForTimeout(600);
  await login("colaborador@hteixeira.local");
  await page.goto(BASE + "/#/admin");
  await page.waitForTimeout(1200);
  check("colaborador não abre Configurações pelo endereço", (await page.locator(".topbar h1", { hasText: "Configurações" }).count()) === 0);
  for (const label of ["Checklist", "Avaliações", "Informativos", "Controle de Apuração"]) {
    check(`colaborador vê ${label}`, (await menu(label).count()) === 1);
  }
  check("colaborador não vê Coordenação", (await menu("Coordenação").count()) === 0);
  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
