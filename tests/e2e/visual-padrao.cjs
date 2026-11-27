// Visual premium como padrão da equipe (27/11/2026): colaborador e administrador entram no visual premium,
// podem escolher o visual clássico (a escolha fica guardada) e voltar ao premium (modo local, localhost).
process.env.HUB_TESTE_PADRAO_PREMIUM = "1"; // este teste confere o padrão real, sem o ajuste dos testes antigos
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];

  async function entrar(email) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE + "/");
    await page.waitForTimeout(500);
    const chave = await page.evaluate(() => localStorage.getItem("hub_qg_visual_premium"));
    check(`${email || "administrador"}: navegador novo, sem preferência guardada`, chave === null, String(chave));
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1800);
    return { context, page };
  }

  for (const [email, rotulo] of [["colaborador@hteixeira.local", "colaborador"], ["", "administrador"]]) {
    const { context, page } = await entrar(email);
    check(`${rotulo}: entra no visual premium`, (await page.locator(".app-shell.hub-premium").count()) === 1 && (await page.locator(".qp").count()) === 1);
    check(`${rotulo}: sem o selo "beta"`, !/beta/i.test(await page.locator("body").innerText()));
    if (rotulo === "colaborador") await page.screenshot({ path: path.join(OUT, "visual-padrao-colaborador.png") });

    const classico = page.getByRole("button", { name: /Visual clássico/ });
    check(`${rotulo}: botão "Visual clássico" disponível`, (await classico.count()) === 1);
    await classico.click();
    await page.waitForTimeout(800);
    check(`${rotulo}: visual clássico aplicado`, (await page.locator(".app-shell.hub-premium").count()) === 0 && (await page.locator(".qg-colunas").count()) === 1);
    check(`${rotulo}: escolha guardada`, (await page.evaluate(() => localStorage.getItem("hub_qg_visual_premium"))) === "0");
    await page.reload();
    await page.waitForTimeout(1800);
    check(`${rotulo}: continua no clássico ao recarregar`, (await page.locator(".app-shell.hub-premium").count()) === 0);

    const premium = page.locator("button.qg-visual-premium");
    check(`${rotulo}: botão para voltar ao premium`, (await premium.count()) === 1 && /Visual premium/.test(await premium.innerText()) && !/beta/i.test(await premium.innerText()));
    await premium.click();
    await page.waitForTimeout(800);
    check(`${rotulo}: volta ao visual premium`, (await page.locator(".app-shell.hub-premium").count()) === 1 && (await page.locator(".qp").count()) === 1);
    await context.close();
  }

  // App embutido aberto sozinho também segue o padrão (sem preferência = premium; "0" = clássico).
  const ctx = await browser.newContext({ viewport: { width: 1200, height: 800 } });
  const app = await ctx.newPage();
  await app.goto(BASE + "/apps/pomodoro.html");
  await app.waitForTimeout(800);
  check("app avulso sem preferência abre no premium", /ht-premium/.test(await app.evaluate(() => document.documentElement.className)));
  await app.evaluate(() => localStorage.setItem("hub_qg_visual_premium", "0"));
  await app.reload();
  await app.waitForTimeout(800);
  check("app avulso com visual clássico escolhido fica no clássico", !/ht-premium/.test(await app.evaluate(() => document.documentElement.className)));
  await ctx.close();

  check("sem erros de script", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => {
  console.error("ERRO", e);
  process.exit(1);
});
