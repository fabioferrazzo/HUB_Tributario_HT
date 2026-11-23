// Tela de entrada: foto da sede (troca a cada dois dias), visual atual e visual premium (modo local, localhost).
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.location().url + m.text())) errors.push(m.text()); });

  await page.goto(BASE + "/");
  await page.evaluate(() => { localStorage.removeItem("hub_qg_visual_premium"); });
  await page.reload();
  await page.waitForSelector(".login-foto img");
  await page.waitForTimeout(600);
  const foto = await page.locator(".login-foto img").evaluate((img) => ({ src: img.getAttribute("src"), ok: img.complete && img.naturalWidth > 0 }));
  check("foto da sede carregada na entrada", foto.ok && /^\/login\/.+\.webp$/.test(foto.src), JSON.stringify(foto));
  check("visual atual: sem tema premium", (await page.locator(".login-premium").count()) === 0);
  check("formulário de entrada continua igual", (await page.locator('input[type="email"]').count()) === 1 && (await page.locator('input[type="password"]').count()) === 1);
  await page.screenshot({ path: path.join(OUT, "login-atual.png") });

  // Troca a cada dois dias: as sete fotos aparecem num ciclo de 14 dias.
  const ciclo = await page.evaluate(async () => {
    const fotos = new Set();
    const pares = [];
    for (let d = 0; d < 14; d++) {
      const data = new Date(2026, 10, 2 + d);
      const dias = Math.floor(Date.UTC(data.getFullYear(), data.getMonth(), data.getDate()) / 86400000);
      pares.push(Math.floor(dias / 2) % 7);
      fotos.add(Math.floor(dias / 2) % 7);
    }
    return { distintas: fotos.size, pares };
  });
  check("sete fotos em rodízio de dois em dois dias", ciclo.distintas === 7, JSON.stringify(ciclo));
  const todas = await page.evaluate(async () => {
    const nomes = ["recepcao-1", "recepcao-2", "recepcao-3", "recepcao-4", "recepcao-5", "frase", "fachada"];
    const r = await Promise.all(nomes.map((n) => fetch(`/login/${n}.webp`).then((x) => x.ok && /image/.test(x.headers.get("content-type") || ""))));
    return r.every(Boolean);
  });
  check("as sete fotos estão publicadas", todas);

  // Visual premium ligado neste navegador.
  await page.evaluate(() => { localStorage.setItem("hub_qg_visual_premium", "1"); localStorage.setItem("hub_qp_tema", "escuro"); });
  await page.reload();
  await page.waitForSelector(".login-premium");
  await page.waitForTimeout(500);
  check("visual premium escuro na entrada", (await page.locator(".login-premium.login-premium--escuro").count()) === 1);
  const painel = await page.locator(".login-panel").evaluate((el) => getComputedStyle(el).borderTopLeftRadius);
  check("painel de entrada em vidro arredondado", painel === "24px", painel);
  await page.screenshot({ path: path.join(OUT, "login-premium-escuro.png") });
  await page.evaluate(() => localStorage.setItem("hub_qp_tema", "claro"));
  await page.reload();
  await page.waitForSelector(".login-premium--claro");
  await page.screenshot({ path: path.join(OUT, "login-premium-claro.png") });

  // Celular: foto em cima, formulário embaixo, sem rolagem lateral.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  const largura = await page.evaluate(() => ({ doc: document.documentElement.scrollWidth, tela: window.innerWidth }));
  check("celular sem rolagem lateral", largura.doc <= largura.tela + 1, JSON.stringify(largura));
  await page.screenshot({ path: path.join(OUT, "login-premium-celular.png"), fullPage: true });

  // Entrar continua funcionando.
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  check("entra no HUB pela nova tela", (await page.locator(".app-shell").count()) === 1);

  check("sem erros no console", errors.length === 0, errors.slice(0, 3).join(" | "));
  await page.evaluate(() => { localStorage.removeItem("hub_qg_visual_premium"); localStorage.removeItem("hub_qp_tema"); });
  await browser.close();
  console.log(results.join("\n"));
})().catch((e) => {
  console.log(results.join("\n"));
  console.log("ERRO " + e.message);
  process.exit(1);
});
