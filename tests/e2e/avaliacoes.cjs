// Avaliações: colaborador preenche, salva e envia (trava); administrador corrige, avalia e devolve; colaborador vê a devolutiva.
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
  const login = async (email) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(500);
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.locator(".sidebar button", { hasText: "Avaliações" }).first().click();
    await page.waitForTimeout(800);
  };
  const logout = async () => { await page.getByRole("button", { name: /Sair/ }).first().click(); await page.waitForTimeout(600); };
  const notas = [9, 8.5, 10, 7.5, 9, 10, 8];

  // 1) colaborador preenche e envia
  await login("colaborador@hteixeira.local");
  check("menu Avaliações aberto", (await page.locator(".aval-page").count()) === 1);
  await page.getByRole("button", { name: "Nova autoavaliação" }).click();
  await page.waitForTimeout(300);
  const notaInputs = page.locator('input[aria-label^="Nota de autoavaliação"]');
  check("7 critérios do modelo", (await notaInputs.count()) === 7);
  await page.getByRole("button", { name: /Salvar e enviar/ }).click();
  await page.waitForTimeout(400);
  check("envio exige notas", /Informe a nota/.test(await page.locator(".form-error").innerText().catch(() => "")));
  for (let i = 0; i < 7; i++) {
    await notaInputs.nth(i).fill(String(notas[i]));
    await page.locator('textarea[aria-label^="Justificativa - "]').nth(i).fill(`Justificativa ${i + 1} com acentuação: está ótimo.`);
  }
  const fb = page.locator(".aval-box textarea");
  await fb.nth(0).fill("Apuração do ICMS");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.waitForTimeout(600);
  check("rascunho salvo", /Rascunho salvo/.test(await page.locator(".module-notice").first().innerText().catch(() => "")));
  const media = await page.locator(".aval-table tfoot td").first().innerText();
  check("média aritmética da autoavaliação", media.trim() === "8,86", media);
  check("faixa da média", (await page.locator(".aval-table tfoot td").nth(1).innerText()).includes("Muito bom"));
  await page.getByRole("button", { name: /Salvar e enviar/ }).click();
  await page.waitForTimeout(800);
  check("enviada à coordenação", /enviada à coordenação/i.test(await page.locator(".module-notice").first().innerText().catch(() => "")));
  check("travada após o envio", (await page.locator('input[aria-label^="Nota de autoavaliação"]').count()) === 0);
  check("colaborador não vê coluna do coordenador antes da devolutiva", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 0);
  await logout();

  // 2) administrador corrige, avalia e devolve
  await login("");
  await page.locator(".aval-item").first().click();
  await page.waitForTimeout(500);
  check("admin vê a avaliação enviada", (await page.locator(".aval-head h2").innerText()).length > 0);
  check("admin vê coluna do coordenador", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 1);
  await page.locator('input[aria-label^="Nota de autoavaliação"]').first().fill("8");
  const coordInputs = page.locator('input[aria-label^="Nota do coordenador"]');
  for (let i = 0; i < 7; i++) await coordInputs.nth(i).fill("10");
  await page.locator('textarea[aria-label^="Justificativa do coordenador"]').first().fill("Ótima produção.");
  await page.locator(".aval-recomendacoes textarea").fill("1 - Estudar a reforma tributária.");
  await page.getByRole("button", { name: /Salvar e devolver/ }).click();
  await page.waitForTimeout(800);
  check("devolvida ao colaborador", /devolvida/i.test(await page.locator(".module-notice").first().innerText().catch(() => "")));
  await logout();

  // 3) colaborador vê a devolutiva
  await login("colaborador@hteixeira.local");
  await page.locator(".aval-item").first().click();
  await page.waitForTimeout(500);
  check("colaborador vê coluna do coordenador", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 1);
  const primeiraLinha = await page.locator(".aval-table tbody tr").first().innerText();
  check("vê a nota corrigida e a do coordenador", /\b8\b/.test(primeiraLinha) && /Ótima produção/.test(primeiraLinha), primeiraLinha.replace(/\s+/g, " ").slice(0, 120));
  check("vê as recomendações", /reforma tributária/.test(await page.locator(".aval-recomendacoes").innerText()));
  check("média do coordenador", (await page.locator(".aval-table tfoot").innerText()).includes("10"));
  check("continua sem edição", (await page.locator('input[aria-label^="Nota de autoavaliação"]').count()) === 0);

  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
