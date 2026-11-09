// Avaliações: colaborador preenche, salva e envia (trava); administrador corrige, avalia, registra
// recomendações em itens e devolve; colaborador vê a devolutiva e a média geral e responde às recomendações.
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
  const notice = async () => page.locator(".module-notice").first().innerText().catch(() => "");
  const notas = [9, 8.5, 10, 7.5, 9, 10, 8];

  // 1) colaborador preenche e envia
  await login("colaborador@hteixeira.local");
  check("menu Avaliações aberto", (await page.locator(".aval-page").count()) === 1);
  await page.getByRole("button", { name: "Nova autoavaliação" }).click();
  await page.waitForTimeout(300);
  const notaInputs = page.locator('input[aria-label^="Nota de autoavaliação"]');
  check("7 critérios do modelo", (await notaInputs.count()) === 7);
  const feedbackLabels = await page.locator(".aval-box").first().locator("label").allInnerTexts();
  check("feedback com 4 itens (inclui Sugestões e críticas)", feedbackLabels.length === 4 && /4\) Sugestões e críticas/.test(feedbackLabels[3]), String(feedbackLabels.length));
  await page.getByRole("button", { name: /Salvar e enviar/ }).click();
  await page.waitForTimeout(400);
  check("envio exige notas", /Informe a nota/.test(await page.locator(".form-error").innerText().catch(() => "")));
  for (let i = 0; i < 7; i++) {
    await notaInputs.nth(i).fill(String(notas[i]));
    await page.locator('textarea[aria-label^="Justificativa - "]').nth(i).fill(`Justificativa ${i + 1} com acentuação: está ótimo.`);
  }
  const fb = page.locator(".aval-box").first().locator("textarea");
  await fb.nth(0).fill("Apuração do ICMS");
  await fb.nth(3).fill("Sugiro reuniões quinzenais.");
  await page.getByRole("button", { name: "Salvar rascunho" }).click();
  await page.waitForTimeout(600);
  check("rascunho salvo", /Rascunho salvo/.test(await notice()));
  const media = await page.locator(".aval-table tfoot td").first().innerText();
  check("média aritmética da autoavaliação", media.trim() === "8,86", media);
  check("faixa da média", (await page.locator(".aval-table tfoot td").nth(1).innerText()).includes("Muito bom"));
  check("colaborador não vê média geral antes da devolutiva", (await page.locator(".aval-media-geral").count()) === 0);
  await page.getByRole("button", { name: /Salvar e enviar/ }).click();
  await page.waitForTimeout(800);
  check("enviada à coordenação", /enviada à coordenação/i.test(await notice()));
  check("travada após o envio", (await page.locator('input[aria-label^="Nota de autoavaliação"]').count()) === 0);
  check("colaborador não vê coluna do coordenador antes da devolutiva", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 0);
  check("colaborador não vê recomendações antes da devolutiva", (await page.locator(".aval-recomendacoes").count()) === 0);
  await logout();

  // 2) administrador corrige, avalia, registra recomendações e devolve
  await login("");
  const col = (id) => page.locator(`.aval-painel-col--${id}`);
  check("admin abre no painel da coordenação", (await page.locator(".aval-painel").count()) === 1);
  check("painel: aguardando análise", (await col("enviada").locator(".aval-painel-item").count()) === 1 && (await col("devolvida").locator(".aval-painel-item").count()) === 0);
  await col("enviada").locator(".aval-painel-item").first().click();
  await page.waitForTimeout(500);
  check("admin vê a avaliação enviada", (await page.locator(".aval-head h2").innerText()).length > 0);
  check("admin vê coluna do coordenador", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 1);
  check("admin vê o item 4 do feedback", /Sugiro reuniões quinzenais/.test(await page.locator(".aval-box").first().locator("textarea").nth(3).inputValue()));
  await page.locator('input[aria-label^="Nota de autoavaliação"]').first().fill("8");
  const coordInputs = page.locator('input[aria-label^="Nota do coordenador"]');
  for (let i = 0; i < 7; i++) await coordInputs.nth(i).fill("10");
  await page.locator('textarea[aria-label^="Justificativa do coordenador"]').first().fill("Ótima produção.");
  const geralAdmin = await page.locator(".aval-media-geral strong").innerText();
  check("média geral = média das médias (8,71 e 10)", geralAdmin.trim() === "9,36", geralAdmin);
  const recs = page.locator('textarea[aria-label^="Recomendação "]');
  check("5 campos de recomendação por padrão", (await recs.count()) === 5, String(await recs.count()));
  await page.getByRole("button", { name: "Incluir recomendação" }).click();
  check("inclui novo campo", (await recs.count()) === 6);
  await page.getByRole("button", { name: "Excluir recomendação 6" }).click();
  await page.getByRole("button", { name: "Excluir recomendação 5" }).click();
  check("exclui campos", (await recs.count()) === 4);
  await recs.nth(0).fill("Estudar a reforma tributária.");
  await recs.nth(1).fill("Conferir as guias antes do envio.");
  await page.getByRole("button", { name: /Salvar e devolver/ }).click();
  await page.waitForTimeout(800);
  check("devolvida ao colaborador", /devolvida/i.test(await notice()));
  check("após salvar, só as recomendações preenchidas ficam", (await page.locator('textarea[aria-label^="Recomendação "]').count()) === 2);
  await page.getByRole("button", { name: "Painel", exact: true }).click();
  await page.waitForTimeout(300);
  check("painel: avaliada e devolvida", (await col("devolvida").locator(".aval-painel-item").count()) === 1 && (await col("enviada").locator(".aval-painel-item").count()) === 0);
  await logout();

  // 3) colaborador vê a devolutiva, a média geral e responde às recomendações
  await login("colaborador@hteixeira.local");
  await page.locator(".aval-item").first().click();
  await page.waitForTimeout(500);
  check("colaborador vê coluna do coordenador", (await page.locator(".aval-table thead th", { hasText: "Coordenador" }).count()) === 1);
  const primeiraLinha = await page.locator(".aval-table tbody tr").first().innerText();
  check("vê a nota corrigida e a do coordenador", /\b8\b/.test(primeiraLinha) && /Ótima produção/.test(primeiraLinha), primeiraLinha.replace(/\s+/g, " ").slice(0, 120));
  check("vê a média geral", (await page.locator(".aval-media-geral").innerText()).includes("9,36"));
  const recTexto = await page.locator(".aval-recomendacoes").innerText();
  check("vê as recomendações", /reforma tributária/.test(recTexto) && /Conferir as guias/.test(recTexto));
  check("vê só as 2 recomendações preenchidas", (await page.locator(".aval-rec").count()) === 2);
  check("continua sem edição das notas", (await page.locator('input[aria-label^="Nota de autoavaliação"]').count()) === 0);
  check("não edita as recomendações", (await page.locator('textarea[aria-label^="Recomendação "]').count()) === 0);
  await page.getByRole("button", { name: /Salvar e avisar a coordenação/ }).click();
  await page.waitForTimeout(400);
  check("avisar exige réplica", /ao menos uma réplica/.test(await page.locator(".form-error").innerText().catch(() => "")));
  await page.locator('textarea[aria-label="Réplica à recomendação 1"]').fill("Concluído: farei o curso da reforma em dezembro.");
  await page.getByRole("button", { name: /Salvar e avisar a coordenação/ }).click();
  await page.waitForTimeout(800);
  check("réplica salva", /Réplicas salvas/.test(await notice()));
  check("réplica permanece após recarregar", (await page.locator('textarea[aria-label="Réplica à recomendação 1"]').inputValue()).includes("curso da reforma"));
  await logout();

  // 4) administrador vê a réplica
  await login("");
  check("painel: com réplica do colaborador", (await col("replica").locator(".aval-painel-item").count()) === 1 && (await col("devolvida").locator(".aval-painel-item").count()) === 0);
  const item = page.locator(".aval-item").first();
  check("lista indica réplica", /com réplica/.test(await item.innerText()));
  await item.click();
  await page.waitForTimeout(500);
  check("admin lê a réplica", /curso da reforma/.test(await page.locator(".aval-replica--lida").first().innerText().catch(() => "")));

  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
