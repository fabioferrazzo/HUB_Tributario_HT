// Histórico e auditoria: só administradores veem; filtros, detalhes e exportação (com registros de exemplo do modo demonstração).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
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

  const agora = Date.now();
  const iso = (diasAtras) => new Date(agora - diasAtras * 86400000).toISOString();
  const exemplos = [
    { quando: iso(0.01), usuario: "Fábio", modulo: "Pautas", acao: "Editou", titulo: "[TESTE] Pauta de exemplo",
      detalhes: { alteracoes: { "Título": { de: "Antigo", para: "Novo" } }, entraram: ["Bia"], sairam: [] } },
    { quando: iso(1), usuario: "Bia", modulo: "Calendário de Tarefas", acao: "Concluiu", titulo: "[TESTE] Tarefa de exemplo", detalhes: {} },
    { quando: iso(2), usuario: "Fábio", modulo: "Férias", acao: "Incluiu férias", titulo: "id=1 Bia 2027-01-04..2027-01-15", detalhes: {} },
    { quando: iso(60), usuario: "Fábio", modulo: "Pautas", acao: "Excluiu", titulo: "[TESTE] Fora do período", detalhes: {} }
  ];

  await login("");
  await page.evaluate((itens) => localStorage.setItem("hub_demo_historico", JSON.stringify(itens)), exemplos);
  check("administrador vê o menu Histórico", (await menu("Histórico").count()) === 1);
  await menu("Histórico").click();
  await page.waitForTimeout(800);
  check("rota #/historico", page.url().endsWith("#/historico"), page.url().replace(BASE, ""));
  const linhas = () => page.locator(".historico-registro");
  check("mostra só os registros dos últimos 30 dias", (await linhas().count()) === 3, String(await linhas().count()));
  check("aviso de modo demonstração", (await page.locator(".historico-aviso").count()) === 1);
  check("mais recente primeiro", (await linhas().first().innerText()).includes("Pauta de exemplo"));

  await linhas().first().locator(".historico-toggle").click();
  const det = await page.locator(".historico-detalhes").innerText();
  check("detalhes: alteração e quem entrou", det.includes("Título: Antigo → Novo") && det.includes("Entraram: Bia"), det.replace(/\n/g, " | "));

  await page.locator(".historico-filtros select").first().selectOption("Férias");
  await page.locator(".historico-filtros button[type='submit']").click();
  await page.waitForTimeout(500);
  check("filtro por módulo", (await linhas().count()) === 1 && (await linhas().first().innerText()).includes("Incluiu férias"));

  await page.locator(".historico-filtros .hist-btn--ghost").click();
  await page.locator(".historico-busca input").fill("tarefa de exemplo");
  await page.locator(".historico-filtros button[type='submit']").click();
  await page.waitForTimeout(500);
  check("busca por texto", (await linhas().count()) === 1 && (await linhas().first().innerText()).includes("Concluiu"));

  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
    page.locator(".historico-head-actions button", { hasText: "Exportar" }).click()
  ]);
  check("exporta em Excel", Boolean(download) && /\.xlsx$/.test(download.suggestedFilename()), download ? download.suggestedFilename() : "sem download");

  // colaborador não vê nem abre pelo endereço
  await page.getByRole("button", { name: /Sair/ }).first().click();
  await page.waitForTimeout(600);
  await login("colaborador@hteixeira.local");
  check("colaborador não vê o menu Histórico", (await menu("Histórico").count()) === 0);
  await page.goto(BASE + "/#/historico");
  await page.waitForTimeout(1200);
  check("colaborador não abre o Histórico pelo endereço", (await page.locator(".historico-page").count()) === 0);

  await page.evaluate(() => localStorage.removeItem("hub_demo_historico"));
  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
