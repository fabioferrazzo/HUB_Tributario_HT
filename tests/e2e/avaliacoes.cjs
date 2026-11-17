// Avaliações (nova versão, formato da planilha): colaborador preenche e salva para a coordenação (trava);
// coordenação corrige com a autoavaliação ao lado (oculta/mostra), salva, finaliza, reabre, devolve e responde
// réplica; colaborador vê a correção e envia réplica sem alterar a avaliação; XLSX, PDF e consolidado.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => (d.type() === "prompt" ? d.accept("Ajuste as justificativas, por favor.") : d.accept()));
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
  const logout = async () => {
    await page.getByRole("button", { name: /Sair/ }).first().click();
    await page.waitForTimeout(600);
  };
  const recarregar = async (email) => {
    await page.reload();
    await page.waitForTimeout(900);
    if (await page.locator('input[type="password"]').count()) return login(email);
    await page.locator(".sidebar button", { hasText: "Avaliações" }).first().click();
    await page.waitForTimeout(800);
  };
  const aviso = async () => (await page.locator(".avd-aviso").allInnerTexts()).join(" | ");
  const botao = (nome) => page.getByRole("button", { name: nome, exact: true });
  const baixar = async (nome) => {
    const [d] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), botao(nome).first().click()]);
    const caminho = await d.path();
    return { nome: d.suggestedFilename(), dados: fs.readFileSync(caminho) };
  };
  const notas = [9, 8.5, 10, 7.5, 9, 10, 8]; // média 8,857…

  // 1) colaborador
  await login("colaborador@hteixeira.local");
  check("menu Avaliações do colaborador", (await page.locator(".avd-grade").count()) === 1 && (await page.locator(".avd-painel").count()) === 0);
  check("mês não iniciado", /Não iniciada/.test(await page.locator(".avd-topo .avd-pill").first().innerText()));
  const notaCol = page.locator('input[aria-label^="Nota do colaborador"]');
  check("7 critérios da planilha", (await notaCol.count()) === 7);
  check("3 perguntas de feedback", (await page.locator('textarea[id^="avd-fb-"]').count()) === 3);
  check("2 sugestões em branco", (await page.locator('textarea[aria-label^="Sugestão "]').count()) === 2);
  check("colaborador não vê colunas da coordenação", (await page.locator(".avd-tab thead th", { hasText: "Coordenador" }).count()) === 0);
  await botao("Salvar para a coordenação").click();
  await page.waitForTimeout(300);
  check("envio exige as notas", /Informe a nota/.test(await aviso()));
  await botao("Preencher tudo com nota 10").click();
  await page.waitForTimeout(300);
  check("preencher tudo com 10", (await notaCol.nth(3).inputValue()) === "10");
  for (let i = 0; i < 7; i++) {
    await notaCol.nth(i).fill(String(notas[i]).replace(".", ","));
    await page.locator('textarea[aria-label^="Justificativa do colaborador"]').nth(i).fill(`Justificativa ${i + 1} — acentuação: está ótimo.`);
  }
  await notaCol.nth(0).fill("11");
  check("nota acima de 10 marcada como inválida", (await notaCol.nth(0).getAttribute("class")) === "invalido");
  await notaCol.nth(0).fill("9");
  await page.locator('textarea[aria-label="Sugestão 1"]').fill("Reunião quinzenal de alinhamento");
  await page.locator('textarea[aria-label="Justificativa da sugestão 1"]').fill("Ajuda a priorizar as entregas");
  await botao("Incluir sugestão").click();
  check("inclui sugestão", (await page.locator('textarea[aria-label^="Sugestão "]').count()) === 3);
  await page.locator("#avd-fb-gosta").fill("Apuração do ICMS");
  await page.locator("#avd-fb-gostaria").fill("Planejamento da reforma");
  check("aviso de alterações não salvas", /não salvas/.test(await aviso()));
  await botao("Salvar rascunho").click();
  await page.waitForTimeout(500);
  check("rascunho salvo", /Rascunho salvo/.test(await aviso()));
  check("média da autoavaliação (soma ÷ 7)", (await page.locator('[data-media="colaborador"]').innerText()).trim() === "8,86");
  check("lista mostra o rascunho", /Rascunho/.test(await page.locator(".avd-lista").innerText()));
  const just1 = page.locator('textarea[aria-label^="Justificativa do colaborador"]').first();
  await just1.fill("Texto ainda não salvo");
  await recarregar("colaborador@hteixeira.local");
  check("recupera alteração não salva (colaborador)", /Recuperei alterações/.test(await aviso()) && (await just1.inputValue()) === "Texto ainda não salvo");
  await botao("Descartar alterações").click();
  await page.waitForTimeout(300);
  check("descartar volta ao rascunho salvo", (await just1.inputValue()).startsWith("Justificativa 1") && !/não salvas/.test(await aviso()));
  await recarregar("colaborador@hteixeira.local");
  check("sem recuperação após descartar", !/Recuperei/.test(await aviso()));
  await botao("Salvar para a coordenação").click();
  await page.waitForTimeout(700);
  check("salva para a coordenação", /salva para a coordenação/i.test(await aviso()));
  check("travada após salvar", (await notaCol.count()) === 0 && (await page.getByRole("button", { name: "Salvar rascunho" }).count()) === 0);
  check("sugestões vazias descartadas", (await page.locator(".avd-sug").count()) === 2);
  const x1 = await baixar("XLSX");
  const xml1 = x1.dados.toString("latin1");
  check("XLSX do colaborador", /^AVALIACAO - Colaborador \d{2}\.\d{4}\.xlsx$/.test(x1.nome) && x1.dados.slice(0, 2).toString() === "PK" && /SUM\(E4:E10\)\/7/.test(xml1), x1.nome);
  const p1 = await baixar("PDF");
  check("PDF do colaborador", p1.dados.slice(0, 5).toString() === "%PDF-" && p1.dados.length > 3000, String(p1.dados.length));
  await logout();

  // 2) coordenação
  await login("");
  const col = (id) => page.locator(`.avd-coluna--${id} .avd-card`);
  check("coordenação abre no painel", (await page.locator(".avd-painel").count()) === 1 && (await page.locator(".avd-grade").count()) === 0);
  check("painel: aguardando correção", (await col("enviada").count()) === 1 && (await col("finalizada").count()) === 0);
  check("painel: pendentes listados", /Gestor Tribut/.test(await page.locator(".avd-pendentes").innerText()));
  await col("enviada").first().click();
  await page.waitForTimeout(600);
  check("editor da coordenação", (await page.locator(".avd-topo h2").first().innerText()).trim() === "Colaborador");
  check("vê a autoavaliação", (await page.locator(".avd-tab thead th", { hasText: "Colaborador (autoavaliação)" }).count()) === 1);
  check("vê justificativa do colaborador", /acentuação: está ótimo/.test(await page.locator(".avd-tab").innerText()));
  await page.getByLabel("Autoavaliação do colaborador", { exact: true }).uncheck();
  check("oculta a autoavaliação", (await page.locator(".avd-tab thead th", { hasText: "Colaborador (autoavaliação)" }).count()) === 0);
  await page.getByLabel("Autoavaliação do colaborador", { exact: true }).check();
  check("mostra de novo", (await page.locator(".avd-tab thead th", { hasText: "Colaborador (autoavaliação)" }).count()) === 1);
  await page.locator('details[data-secao="sugestoes"] > summary').click();
  check("minimiza seção", (await page.locator('details[data-secao="sugestoes"]').getAttribute("open")) === null);
  await page.locator('details[data-secao="sugestoes"] > summary').click();
  const notaCoord = page.locator('input[aria-label^="Nota do coordenador"]');
  check("7 notas do coordenador", (await notaCoord.count()) === 7);
  check("colaborador não editável pela coordenação", (await notaCol.count()) === 0);
  await botao("Preencher notas do coordenador com 10").click();
  await page.waitForTimeout(300);
  await notaCoord.nth(3).fill("8");
  await page.locator('textarea[aria-label="Justificativa do coordenador - Erros"]').fill("Retrabalho em duas apurações.");
  await botao("Finalizar avaliação").click();
  await page.waitForTimeout(300);
  check("finalizar exige itens 1 e 2", /Pontos positivos/.test(await aviso()));
  await page.locator("#avd-pos").fill("Pontualidade e organização.");
  await page.locator("#avd-melhorar").fill("Revisar o SPED antes do envio.");
  await page.locator('textarea[aria-label="Recomendação 1"]').fill("Fazer o curso de EFD.");
  await page.locator('textarea[aria-label="Recomendação 2"]').fill("Checklist de fechamento.");
  check("5 campos de recomendação", (await page.locator('textarea[aria-label^="Recomendação "]').count()) === 5);
  await page.getByLabel("Subcoordenação", { exact: true }).check();
  check("coluna da subcoordenação", (await page.locator('input[aria-label^="Nota da subcoordenação"]').count()) === 7);
  await page.locator('input[aria-label^="Nota da subcoordenação"]').first().fill("7");
  await botao("Finalizar avaliação").click();
  await page.waitForTimeout(300);
  check("subcoordenação parcial bloqueia", /subcoordenação/i.test(await aviso()));
  await page.getByLabel("Subcoordenação", { exact: true }).uncheck();
  await botao("Salvar correção").click();
  await page.waitForTimeout(500);
  check("correção salva (em correção)", /Correção salva/.test(await aviso()) && /Em correção/.test(await page.locator(".avd-topo .avd-pill").first().innerText()));
  check("média do coordenador", (await page.locator('[data-media="coordenador"]').innerText()).trim() === "9,71");
  await botao("Painel").click();
  await page.waitForTimeout(500);
  check("painel: em correção", (await col("em_correcao").count()) === 1 && (await col("enviada").count()) === 0);
  await col("em_correcao").first().click();
  await page.waitForTimeout(500);
  check("correção mantida", (await page.locator("#avd-melhorar").inputValue()) === "Revisar o SPED antes do envio.");
  check("e-mail ao colaborador só após finalizar", await botao("E-mail").first().isDisabled());
  await page.locator("#avd-melhorar").fill("Rascunho local da correção");
  await recarregar("");
  await col("em_correcao").first().click();
  await page.waitForTimeout(600);
  check("recupera correção não salva", /Recuperei alterações/.test(await aviso()) && (await page.locator("#avd-melhorar").inputValue()) === "Rascunho local da correção");
  await botao("Descartar alterações").click();
  await page.waitForTimeout(300);
  check("descartar volta à correção salva", (await page.locator("#avd-melhorar").inputValue()) === "Revisar o SPED antes do envio.");
  await botao("Finalizar avaliação").click();
  await page.waitForTimeout(600);
  check("finalizada", /Avaliação finalizada/.test(await aviso()) && /Finalizada/.test(await page.locator(".avd-topo .avd-pill").first().innerText()));
  check("finalizada fica só leitura", (await notaCoord.count()) === 0 && (await botao("Reabrir para editar").count()) === 1);
  const x2 = await baixar("XLSX");
  const xml2 = x2.dados.toString("utf8");
  check("XLSX com notas e itens da coordenação", /Pontualidade e organização/.test(xml2) && /1 - Fazer o curso de EFD/.test(xml2) && /SUM\(C4:C10\)\/7/.test(xml2));
  await page.locator("details.avd-sec", { hasText: "Histórico desta avaliação" }).locator("summary").click();
  check("histórico registra as ações", /Finalizou a avaliação/.test(await page.locator(".avd-trilha").innerText()) && /Salvou para a coordenação/.test(await page.locator(".avd-trilha").innerText()));
  await botao("Painel").click();
  await page.waitForTimeout(400);
  const cons = await baixar("Consolidado da competência (XLSX)");
  check("consolidado da competência", /^AVALIACOES - consolidado \d{2}\.\d{4}\.xlsx$/.test(cons.nome) && /Pontualidade e organização/.test(cons.dados.toString("utf8")), cons.nome);
  await logout();

  // 3) colaborador vê a correção e envia réplica
  await login("colaborador@hteixeira.local");
  check("colaborador vê finalizada", /Avaliação finalizada/.test(await page.locator(".avd-topo .avd-pill").first().innerText()));
  check("vê notas do coordenador", (await page.locator(".avd-tab thead th", { hasText: "Coordenador" }).count()) === 1 && /Retrabalho em duas apurações/.test(await page.locator(".avd-tab").innerText()));
  check("vê pontos positivos e recomendações", /Pontualidade e organização/.test(await page.locator(".avd-form").innerText()) && /Checklist de fechamento/.test(await page.locator(".avd-form").innerText()));
  check("não pode editar a avaliação corrigida", (await notaCol.count()) === 0);
  await page.locator("#avd-replica").fill("Peço esclarecer a nota de Erros: o retrabalho foi por mudança do cliente.");
  await botao("Enviar réplica").click();
  await page.waitForTimeout(600);
  check("réplica enviada", /Réplica enviada/.test(await aviso()) && /Réplica enviada/.test(await page.locator(".avd-topo .avd-pill").first().innerText()));
  check("réplica aparece no item 3", /mudança do cliente/.test(await page.locator(".avd-replica").first().innerText()));
  check("sem nova réplica até a resposta", (await page.locator("#avd-replica").count()) === 0);
  await logout();

  // 4) coordenação responde, reabre e devolve
  await login("");
  check("painel: réplica recebida", (await col("replica").count()) === 1);
  await col("replica").first().click();
  await page.waitForTimeout(500);
  await page.locator("#avd-resposta").fill("Ok, vamos considerar na próxima competência.");
  await botao("Responder réplica").click();
  await page.waitForTimeout(500);
  check("resposta registrada", /Resposta enviada/.test(await aviso()) && /vamos considerar/.test(await page.locator(".avd-resposta").innerText()));
  await botao("Reabrir para editar").click();
  await page.waitForTimeout(500);
  check("reaberta", /Em correção/.test(await page.locator(".avd-topo .avd-pill").first().innerText()) && (await notaCoord.count()) === 7);
  await botao("Devolver ao colaborador").click();
  await page.waitForTimeout(700);
  check("devolvida ao colaborador", /devolvida ao colaborador/i.test(await aviso()) && (await page.locator(".avd-painel").count()) === 1);
  check("painel: aparece como rascunho pendente", /Colaborador · rascunho/.test(await page.locator(".avd-pendentes").innerText()));
  await logout();

  // 5) colaborador ajusta de novo
  await login("colaborador@hteixeira.local");
  check("rascunho editável de novo", (await notaCol.count()) === 7 && (await notaCol.nth(0).inputValue()) === "9");
  check("coordenação oculta enquanto rascunho", (await page.locator(".avd-tab thead th", { hasText: "Coordenador" }).count()) === 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(400);
  const transborda = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    return [...document.querySelectorAll(".avd *")].filter((e) => !e.closest(".avd-rolagem") && e.getBoundingClientRect().right > w + 2).length;
  });
  check("celular sem rolagem lateral (fora da tabela)", transborda === 0, String(transborda));

  check("sem erros de página", errors.length === 0, errors.slice(0, 2).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => {
  console.log(results.join("\n"));
  console.error("ERRO:", e.message);
  process.exit(1);
});
