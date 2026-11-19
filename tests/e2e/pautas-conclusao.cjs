// Pauta concluída pelo colaborador continua visível para ele em "Concluídas" (some de "Atrasadas" e do Quadro geral).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/#/pautas");
  await page.waitForTimeout(500);
  await page.fill('input[type="email"]', "colaborador@hteixeira.local");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  // pauta atrasada (dia 1 do mês atual) com o colaborador como responsável
  await page.evaluate(() => {
    const d = new Date(); const p = (n) => String(n).padStart(2, "0");
    const prazo = `${d.getFullYear()}-${p(d.getMonth() + 1)}-01T08:00`;
    const agora = new Date().toISOString();
    localStorage.setItem("hub_pautas_app", JSON.stringify([{
      id: "pauta-conclusao-teste", tema: "[TESTE] Pauta para concluir", acoes: "<p>Conferir</p>", prazo, prioridade: "normal",
      responsavel: "Colaborador", email: "fiscal10.hteixeira@gmail.com", pendenciasObs: "", retorno: "", status: "aberta",
      periodicidade: "", modificadoEm: agora, concluidoEm: "", origem: "HUB Pautas", scope: "usuarios", destaque: false,
      responsaveis: ["colaborador@hteixeira.local"], anexos: [], conclusoes: [], createdBy: "fiscal10.hteixeira@gmail.com", createdAt: agora, updatedAt: agora
    }]));
  });
  await page.goto(BASE + "/#/pautas"); await page.reload(); await page.waitForTimeout(1200);

  const linha = page.locator("[data-pauta-row]", { has: page.getByRole("button", { name: "Concluir" }) }).first();
  check("colaborador tem pauta para concluir", (await linha.count()) === 1);
  const titulo = (await linha.locator("strong").first().innerText()).trim();
  await linha.getByRole("button", { name: "Concluir" }).click();
  await page.waitForTimeout(800);
  const mesma = page.locator("[data-pauta-row]", { hasText: titulo }).first();
  check("pauta concluída continua na lista", (await mesma.count()) === 1);
  check("mostra 'Concluída por você'", /Concluída por você/.test(await mesma.innerText().catch(() => "")));
  await page.locator(".filter-pill", { hasText: "Concluídas" }).click();
  await page.waitForTimeout(400);
  check("aparece em Concluídas", (await page.locator("[data-pauta-row]", { hasText: titulo }).count()) >= 1);
  await page.locator(".filter-pill", { hasText: "Atrasadas" }).click();
  await page.waitForTimeout(400);
  check("não aparece em Atrasadas", (await page.locator("[data-pauta-row]", { hasText: titulo }).count()) === 0);
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  check("não aparece no Quadro geral", !(await page.locator(".qg-coluna").first().innerText()).includes(titulo));

  check("sem erros de página", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
