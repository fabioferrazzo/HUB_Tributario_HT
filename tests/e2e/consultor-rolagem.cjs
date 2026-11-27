// Consultor CT-e/MDF-e dentro do HUB: ao trocar de etapa, gerar a análise ou abrir o relatório, a rolagem para
// logo abaixo das barras fixas (cabeçalho do app e abas), sem esconder o começo do conteúdo, e não mexe na página
// do HUB (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const errors = [];
  for (const [largura, altura] of [[1366, 768], [1600, 900]]) {
    const page = await browser.newPage({ viewport: { width: largura, height: altura }, locale: "pt-BR" });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.accept());
    await page.goto(BASE + "/");
    await page.waitForTimeout(500);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
    await page.locator(".sidebar button", { hasText: "Consultor" }).first().click();
    await page.waitForTimeout(2500);
    const f = page.frames().find((x) => /consultor-cte-mdfe/.test(x.url()));
    check(`${largura}px: Consultor abre no HUB`, Boolean(f));

    // Distância entre o fim das barras fixas e o começo do alvo (>= 0: nada escondido).
    const folga = (alvo) =>
      f.evaluate((sel) => {
        const barras = [".topbar", ".app-tabs"]
          .map((q) => document.querySelector(q))
          .filter((el) => el && ["sticky", "fixed"].includes(getComputedStyle(el).position))
          .map((el) => el.getBoundingClientRect().bottom);
        const fim = Math.max(0, ...barras);
        const el = document.querySelector(sel);
        return Math.round(el.getBoundingClientRect().top - fim);
      }, alvo);
    const paginaHub = () => page.evaluate(() => scrollY + [...document.querySelectorAll("*")].reduce((t, el) => t + el.scrollTop, 0));

    // A rolagem do próprio menu lateral (ao clicar no item) não conta: mede só o que muda depois das ações do Consultor.
    const antes = await paginaHub();
    await f.locator("#wizardNextBtn").click(); // etapa 1 incompleta: mostra a mensagem de erro no topo das etapas
    await page.waitForTimeout(1200);
    let d = await folga(".wizard-shell");
    check(`${largura}px: troca de etapa mostra o cabeçalho das etapas inteiro`, d >= 0 && d <= 40, `${d}px`);

    await f.locator("#exampleBtn").click();
    await page.waitForTimeout(800);
    await f.evaluate(() => scrollTo(0, 0));
    await f.evaluate(() => { const b = document.getElementById("analyzeBtn"); b.hidden = false; b.click(); });
    await page.waitForTimeout(1500);
    d = await folga("#resultPanel");
    check(`${largura}px: análise aparece logo abaixo das abas (sem esconder o início)`, d >= 0 && d <= 40, `${d}px`);
    if (largura === 1366) await page.screenshot({ path: path.join(OUT, "consultor-rolagem.png") });

    const depois = await paginaHub();
    check(`${largura}px: página do HUB não se move`, depois === antes, `${antes} -> ${depois}`);
    await page.close();
  }
  check("sem erros de script", errors.length === 0, errors.slice(0, 3).join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => {
  console.error("ERRO", e);
  process.exit(1);
});
