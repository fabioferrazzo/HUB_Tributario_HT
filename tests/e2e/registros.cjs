// Aba Registros (modo demonstração): novo registro pelo CNPJ com dados da Receita (consulta simulada),
// campos do escritório, observações, documentos, revisão, responsável, filtros e CNPJ repetido.
// Testa nos temas escuro/compacto e claro/ampliado. Itens de teste marcados com [TESTE].
const path = require("path");
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

const RECEITA = {
  fonte: "BrasilAPI",
  cnpj: "11222333000181",
  razaoSocial: "[TESTE] COMERCIO DE PECAS SERRANAS LTDA",
  nomeFantasia: "PECAS SERRANAS",
  dataInicio: "2026-11-03",
  situacao: "ATIVA",
  naturezaJuridica: "Sociedade Empresária Limitada",
  municipio: "SAO FRANCISCO DE PAULA",
  uf: "RS",
  cnaePrincipal: { codigo: "4530-7/03", descricao: "Comércio a varejo de peças e acessórios novos para veículos automotores" },
  cnaesSecundarios: [
    { codigo: "4520-0/01", descricao: "Serviços de manutenção e reparação mecânica de veículos automotores" },
    { codigo: "4541-2/06", descricao: "Comércio a varejo de peças e acessórios novos para motocicletas e motonetas" }
  ],
  socios: [
    { nome: "[TESTE] FULANO DA SILVA", qualificacao: "Sócio-Administrador", desde: "2026-11-03" },
    { nome: "[TESTE] BELTRANA SOUZA", qualificacao: "Sócio", desde: "2026-11-03" }
  ],
  regimeSugerido: "Simples Nacional",
  consultadoEm: new Date().toISOString()
};

async function rodar(browser, tema, tamanho, largura) {
  const page = await (await browser.newContext({ viewport: { width: largura, height: 900 }, locale: "pt-BR", timezoneId: "America/Sao_Paulo" })).newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("dialog", (d) => d.accept());
  const chamadas = [];
  await page.route("**/.netlify/functions/registros", async (route) => {
    const corpo = JSON.parse(route.request().postData() || "{}");
    chamadas.push(corpo);
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ok: true, dados: RECEITA }) });
  });
  await page.goto(BASE + "/");
  await page.evaluate(([t, z]) => {
    localStorage.removeItem("hub_registros_app");
    localStorage.setItem("hub_qg_visual_premium", "1");
    localStorage.setItem("hub_qp_tema", t);
    localStorage.setItem("hub_qp_tamanho", z);
  }, [tema, tamanho]);
  await page.reload();
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  const rotulo = `[${tema}/${tamanho}]`;

  await page.click(".side-nav button[title='Registros']");
  await page.waitForSelector(".registros-page");
  check(`${rotulo} aba Registros abre no menu Escritório`, (await page.locator(".registros-page.hp-migrada").count()) === 1);
  check(`${rotulo} lista vazia orienta o usuário`, /Novo registro/.test(await page.locator(".registros-lista .empty-state").innerText()));

  // Novo registro pelo CNPJ
  await page.click(".registros-novo");
  const form = page.locator(".registros-form");
  const botaoReceita = form.locator(".registros-cnpj__linha button");
  await form.locator(".registros-cnpj input").fill("11.222.333/0001-82");
  check(`${rotulo} CNPJ inválido não consulta`, await botaoReceita.isDisabled());
  await form.locator(".registros-cnpj input").fill("11.222.333/0001-81");
  check(`${rotulo} CNPJ é formatado ao digitar`, (await form.locator(".registros-cnpj input").inputValue()) === "11.222.333/0001-81");
  await botaoReceita.click();
  await page.waitForTimeout(500);
  check(`${rotulo} consulta enviada ao servidor`, chamadas.some((c) => c.acao === "consultar-cnpj" && c.cnpj === "11222333000181"));
  check(`${rotulo} razão social preenchida pela Receita`, (await form.locator("label", { hasText: "Razão social" }).locator("input").inputValue()) === RECEITA.razaoSocial);
  check(`${rotulo} regime sugerido pela Receita`, (await form.locator("label", { hasText: "Regime tributário" }).locator("input").inputValue()) === "Simples Nacional");
  check(`${rotulo} data de início`, (await form.locator("input[type=date]").inputValue()) === "2026-11-03");
  check(`${rotulo} sócios listados`, (await form.locator(".registros-socios li").count()) === 2);
  check(`${rotulo} CNAE principal e secundários`, (await form.locator(".registros-cnaes li").count()) === 3 && /Principal/.test(await form.locator(".registros-cnaes__principal").innerText()));

  await form.locator("label", { hasText: "Inscrição estadual" }).locator("input").fill("123/4567890");
  await form.locator("label", { hasText: "Código no Domínio" }).locator("input").fill("[TESTE] 9876");
  await form.locator(".registros-obs [contenteditable='true']").click();
  await page.keyboard.type("[TESTE] Aguardando alvará municipal.");
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(500);
  check(`${rotulo} registro salvo`, /Registro criado/.test(await page.locator(".registros-form .module-notice").innerText()));
  const item = page.locator(".registro-item").first();
  check(`${rotulo} aparece na lista aguardando revisão`, /Aguardando revisão/.test(await item.innerText()) && /11\.222\.333\/0001-81/.test(await item.innerText()));
  check(`${rotulo} contador de revisão`, (await page.locator(".registros-totais button").first().locator("strong").innerText()) === "1");

  // Documentos
  await page.locator(".registros-form input[type=file]").setInputFiles({ name: "[TESTE] contrato social.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 teste") });
  await page.waitForTimeout(500);
  check(`${rotulo} documento anexado`, (await page.locator(".registros-anexos li").count()) === 1 && /contrato social/.test(await page.locator(".registros-anexos").innerText()));

  // Revisão e responsável
  await page.locator(".registros-detalhe__acoes button", { hasText: "Marcar como revisado" }).click();
  await page.waitForTimeout(400);
  check(`${rotulo} marcado como revisado`, /Ativo/.test(await page.locator(".registro-item").first().innerText()));
  await page.locator(".registros-responsavel select").selectOption("local-colaborador");
  await page.locator(".registros-responsavel button").click();
  await page.waitForTimeout(600);
  check(`${rotulo} responsável definido`, /Colaborador/.test(await page.locator(".registro-item").first().innerText()));
  check(`${rotulo} aviso de modo demonstração`, /Modo demonstração/.test(await page.locator(".registros-form .module-notice").innerText()));
  await page.locator(".registros-secao summary", { hasText: "Histórico do registro" }).click();
  check(`${rotulo} histórico registra criação e responsável`, (await page.locator(".registros-eventos li").count()) >= 2 && /Responsável pela apuração: Colaborador/.test(await page.locator(".registros-eventos").innerText()));

  // Layout: nada estourando
  const estouro = await page.evaluate(() => {
    const fora = [];
    for (const el of document.querySelectorAll(".registros-page *")) {
      const r = el.getBoundingClientRect();
      const pai = el.closest(".panel");
      if (!pai || !r.width) continue;
      const p = pai.getBoundingClientRect();
      if (r.right > p.right + 1) fora.push(`${el.tagName}.${el.className}`.slice(0, 60));
    }
    return { fora: fora.slice(0, 5), rolagem: document.documentElement.scrollWidth > window.innerWidth };
  });
  check(`${rotulo} nada ultrapassa os painéis`, !estouro.fora.length && !estouro.rolagem, JSON.stringify(estouro));
  const cnpjCabe = await page.locator(".registros-form .registros-cnpj input").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  check(`${rotulo} CNPJ cabe inteiro no campo`, cnpjCabe);
  const razaoCabe = await page.locator(".registros-form label", { hasText: "Razão social" }).locator("input").evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
  check(`${rotulo} razão social cabe inteira no campo`, razaoCabe);
  await page.locator(".registros-detalhe__cabeca").scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `registros-${tema}-${tamanho}-${largura}.png`) });
  await page.locator(".registros-secao summary", { hasText: "Responsável pela apuração" }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(OUT, `registros-${tema}-${tamanho}-${largura}-b.png`) });

  // CNPJ repetido abre o existente
  await page.click(".registros-novo");
  await page.locator(".registros-form .registros-cnpj input").fill("11222333000181");
  await page.locator(".registros-form .registros-cnpj__linha button").click();
  await page.waitForTimeout(400);
  check(`${rotulo} CNPJ repetido abre o registro existente`, /já tem registro/.test(await page.locator(".registros-form .module-notice").innerText()));

  // Filtros e busca
  await page.locator(".registros-toolbar input").fill("pecas serranas");
  check(`${rotulo} busca por razão social`, (await page.locator(".registro-item").count()) === 1);
  await page.locator(".registros-toolbar input").fill("");
  await page.locator(".registros-toolbar select").first().selectOption("arquivado");
  check(`${rotulo} filtro por situação`, (await page.locator(".registro-item").count()) === 0);
  await page.locator(".registros-toolbar select").first().selectOption("todos");

  // Exclusão (administrador)
  await page.locator(".registro-item").first().click();
  await page.locator(".registros-detalhe__acoes .danger-action").click();
  await page.waitForTimeout(400);
  check(`${rotulo} administrador exclui o registro`, (await page.locator(".registro-item").count()) === 0);

  check(`${rotulo} sem erros no console`, errors.length === 0, errors.join(" | "));
  await page.evaluate(() => localStorage.removeItem("hub_registros_app"));
  await page.context().close();
}

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  await rodar(browser, "escuro", "compacto", 1440);
  await rodar(browser, "claro", "ampliado", 1280);
  await browser.close();
  console.log(results.join("\n"));
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})();
