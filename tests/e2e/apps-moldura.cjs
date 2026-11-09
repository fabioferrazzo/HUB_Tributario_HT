// Moldura padrão dos apps: tela cheia, nova janela (com botão de tela cheia próprio), recarregar e permissões.
const fs = require("fs");
const path = require("path");
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

// Lê o cadastro de apps (src/app/appsRegistry.ts) para testar todos os apps "embutidos".
const registry = fs.readFileSync(path.join(__dirname, "..", "..", "src", "app", "appsRegistry.ts"), "utf8");
const apps = [...registry.matchAll(/\{\s*id: "([^"]+)",[\s\S]*?label: "([^"]+)",[\s\S]*?access: "([^"]+)",[\s\S]*?mode: "([^"]+)"/g)]
  .map((m) => ({ id: m[1], label: m[2], access: m[3], mode: m[4] }));

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

  check("cadastro lido", apps.length >= 3, apps.map((a) => a.id).join(", "));
  await login("");
  for (const app of apps) {
    await menu(app.label).click();
    await page.waitForTimeout(1200);
    const frame = page.locator(".frame-page");
    check(`${app.id}: moldura aberta`, (await frame.count()) === 1);
    if (app.mode === "embutido") {
      await frame.getByRole("button", { name: /Tela cheia/ }).click();
      await page.waitForTimeout(400);
      const fs1 = await page.evaluate(() => Boolean(document.fullscreenElement && document.fullscreenElement.classList.contains("frame-page")));
      check(`${app.id}: tela cheia ativa`, fs1);
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());
      await page.waitForTimeout(300);
      await frame.getByRole("button", { name: /Recarregar/ }).click();
      await page.waitForTimeout(800);
      check(`${app.id}: recarregar mantém o app`, (await page.locator(".frame-page iframe").count()) === 1);
    }
    const [popup] = await Promise.all([page.waitForEvent("popup", { timeout: 5000 }).catch(() => null), frame.getByRole("button", { name: /Nova janela/ }).click()]);
    check(`${app.id}: abre em nova janela`, Boolean(popup), popup ? popup.url().replace(BASE, "") : "sem janela");
    if (popup && app.mode !== "embutido") await popup.close().catch(() => {});
    if (popup && app.mode === "embutido") {
      await popup.waitForLoadState("load").catch(() => {});
      await popup.waitForTimeout(800);
      check(`${app.id}: janela separada tem botão de tela cheia`, (await popup.locator(".hub-fs-btn").count()) === 1);
      await popup.close();
    }
  }
  // dentro do HUB o app não mostra o botão próprio (a moldura já tem)
  await menu(apps.find((a) => a.mode === "embutido").label).click();
  await page.waitForTimeout(1200);
  const inner = page.frameLocator(".frame-page iframe");
  check("dentro do HUB sem botão duplicado", (await inner.locator(".hub-fs-btn").count()) === 0);

  await page.getByRole("button", { name: /Sair/ }).first().click();
  await page.waitForTimeout(600);
  await login("colaborador@hteixeira.local");
  for (const app of apps.filter((a) => a.access !== "todos")) {
    check(`${app.id}: oculto para colaborador`, (await menu(app.label).count()) === 0);
  }
  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
