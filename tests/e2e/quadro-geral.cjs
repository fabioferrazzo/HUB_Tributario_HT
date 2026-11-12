// Quadro geral (tela inicial): Aviso da Coordenação, três colunas da semana e Pautas no menu lateral (modo local, localhost).
const { CHROME, BASE } = require("./_config.cjs");
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
  page.on("dialog", (d) => d.accept());

  await page.goto(BASE + "/");
  // Agenda de exemplo para o mês atual (o app Agenda tributária guarda neste formato).
  await page.evaluate(() => {
    const hoje = new Date();
    const chave = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}`;
    const dados = {};
    dados[chave] = { source: "Teste", updated: "hoje", dates: { [String(hoje.getDate())]: [{ cat: "pj-fed", title: "<strong>[TESTE]</strong> DARF de exemplo", periodo: "mês anterior" }] } };
    localStorage.setItem("agenda-tributaria-rfb-v1", JSON.stringify(dados));
    localStorage.removeItem("hub_aviso_coordenacao_local");
  });
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  check("abre no Quadro geral", (await page.locator(".quadro-geral").count()) === 1 && (await page.evaluate(() => location.hash)) === "#/home");
  const grupos = await page.evaluate(() => [...document.querySelectorAll(".sidebar .nav-group, .sidebar nav > div, .sidebar section")].map((g) => g.innerText.replace(/\s+/g, " ").trim()).filter(Boolean));
  const menu = (await page.locator(".sidebar").innerText()).replace(/\s+/g, " ");
  check("menu: Quadro geral em Principal e Pautas em Ferramentas", /PRINCIPAL Quadro geral FERRAMENTAS Pautas Calendário/i.test(menu), menu.slice(0, 160) || grupos.join(" | "));
  check("três colunas da semana", (await page.locator(".qg-colunas > .qg-coluna").count()) === 3);
  const titulos = await page.locator(".qg-coluna-head h2").allInnerTexts();
  check("colunas: Pautas e avisos, Calendário, Agenda tributária", titulos.join("|") === "Pautas e avisos|Calendário|Agenda tributária", titulos.join("|"));
  const agendaTexto = await page.locator(".qg-coluna").nth(2).innerText();
  check("agenda mostra o vencimento do dia (sem HTML)", agendaTexto.includes("[TESTE] DARF de exemplo") && !agendaTexto.includes("<strong>"), agendaTexto.replace(/\s+/g, " ").slice(0, 120));

  // Aviso da Coordenação: publicar (com cor e tamanho), editar, recolher, retirar
  await page.click(".qg-aviso button:has-text('Novo aviso')");
  await page.locator(".qg-aviso-editor [contenteditable]").first().click();
  await page.keyboard.type("[TESTE] Reunião geral na sexta às 9h");
  await page.locator(".qg-aviso-opcoes label", { hasText: "Destaque" }).locator("select").selectOption("importante");
  await page.locator(".qg-aviso-opcoes label", { hasText: "Tamanho do texto" }).locator("select").selectOption("extra-grande");
  await page.click(".qg-aviso-cores button[aria-label='Azul claro']");
  check("prévia da cor no quadro durante a edição", (await page.locator(".qg-aviso").getAttribute("data-cor")) === "azul");
  await page.click(".qg-aviso button:has-text('Publicar')");
  await page.waitForTimeout(500);
  check("aviso publicado aparece no alto", (await page.locator(".qg-aviso-texto").innerText()).includes("Reunião geral na sexta às 9h"));
  check("aviso importante destacado", (await page.locator(".qg-aviso--importante").count()) === 1);
  const estilo = await page.evaluate(() => ({
    fundo: getComputedStyle(document.querySelector(".qg-aviso")).backgroundColor,
    fonte: getComputedStyle(document.querySelector(".qg-aviso-texto")).fontSize
  }));
  check("quadro inteiro em azul claro", estilo.fundo === "rgb(229, 239, 251)", estilo.fundo);
  check("texto extra grande (30px)", estilo.fonte === "30px", estilo.fonte);

  // Editar: corrige o mesmo aviso (sem notificar de novo, salvo se marcar)
  await page.click(".qg-aviso button:has-text('Editar')");
  check("edição oferece notificar a equipe (desmarcado)", (await page.locator(".qg-aviso-check input").count()) === 1 && !(await page.locator(".qg-aviso-check input").isChecked()));
  await page.click(".qg-aviso-cores button[aria-label='Verde claro']");
  await page.locator(".qg-aviso-opcoes label", { hasText: "Tamanho do texto" }).locator("select").selectOption("grande");
  await page.click(".qg-aviso button:has-text('Salvar alterações')");
  await page.waitForTimeout(500);
  const depois = await page.evaluate(() => ({
    cor: document.querySelector(".qg-aviso").getAttribute("data-cor"),
    fonte: getComputedStyle(document.querySelector(".qg-aviso-texto")).fontSize,
    texto: document.querySelector(".qg-aviso-texto").innerText
  }));
  check("edição troca a cor e o tamanho e mantém o texto", depois.cor === "verde" && depois.fonte === "19px" && depois.texto.includes("Reunião geral"), JSON.stringify(depois));
  await page.click(".qg-aviso button[aria-label='Recolher o aviso']");
  check("aviso recolhe", (await page.locator(".qg-aviso-texto").count()) === 0);
  await page.reload();
  await page.waitForTimeout(1200);
  check("aviso continua recolhido após recarregar", (await page.locator(".qg-aviso-texto").count()) === 0);
  await page.click(".qg-aviso button[aria-label='Mostrar o aviso']");
  check("aviso volta a aparecer", (await page.locator(".qg-aviso-texto").count()) === 1);
  await page.click(".qg-aviso button:has-text('Retirar')");
  await page.waitForTimeout(400);
  check("aviso retirado", (await page.locator(".qg-aviso-texto").count()) === 0 && (await page.locator(".qg-aviso").innerText()).includes("Nenhum aviso"));

  // Semana anterior/seguinte e atalho para Pautas
  await page.click(".qg-semana button[aria-label='Próxima semana']");
  check("navega para a próxima semana", (await page.locator(".qg-semana").innerText()).includes("Voltar para hoje"));
  await page.click(".qg-semana button:has-text('Voltar para hoje')");
  await page.locator(".qg-coluna").first().locator("button", { hasText: "Abrir" }).click();
  await page.waitForTimeout(700);
  check("Abrir (Pautas e avisos) leva para Pautas", (await page.evaluate(() => location.hash)) === "#/pautas" && (await page.locator(".panel--pautas").count()) === 1);

  // Celular: sem rolagem horizontal
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(BASE + "/#/home");
  await page.waitForTimeout(1200);
  const largura = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check("celular: sem rolagem horizontal", largura <= 2, String(largura));

  await page.evaluate(() => localStorage.removeItem("agenda-tributaria-rfb-v1"));
  check("sem erros no console", errors.length === 0, errors.join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); console.log(results.join("\n")); process.exit(1); });
