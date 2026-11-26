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
  fontesComplementares: ["CNPJá"],
  capitalSocial: 70000,
  porte: "Microempresa",
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
  telefone1: "(54) 3244-1234",
  telefone2: "",
  email: "contato@pecasserranas.com.br",
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
  check(`${rotulo} subabas Registros e Alterações`, (await page.locator(".registros-subabas [role=tab]").allInnerTexts()).map((t) => t.replace(/\s+\d+$/, "").trim()).join("|") === "Registros|Alterações");

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
  check(`${rotulo} capital social em reais`, /Capital social:\s*R\$\s*70\.000,00/.test(await form.locator(".registros-capital").innerText().catch(() => "")));
  check(`${rotulo} porte e fontes da consulta`, /Porte: Microempresa/.test(await form.locator(".registros-receita-linha").innerText()) && /Fonte: BrasilAPI \+ CNPJá/.test(await form.locator(".registros-receita-linha").innerText()));
  check(`${rotulo} CNAE principal e secundários`, (await form.locator(".registros-cnaes li").count()) === 3 && /Principal/.test(await form.locator(".registros-cnaes__principal").innerText()));

  check(`${rotulo} telefone e e-mail da Receita nos contatos`, (await form.locator("label", { hasText: "Telefone 1" }).locator("input").inputValue()) === "(54) 3244-1234" && (await form.locator("label", { hasText: "E-mail 1" }).locator("input").inputValue()) === "contato@pecasserranas.com.br");
  await form.locator("label", { hasText: "Telefone 2" }).locator("input").fill("(54) 99999-0000");
  await form.locator("label", { hasText: "E-mail 2" }).locator("input").fill("financeiro.pecasserranas.com.br");
  await form.locator("label", { hasText: "Inscrição estadual" }).locator("input").fill("123/4567890");
  await form.locator("label", { hasText: "Código no Domínio" }).locator("input").fill("[TESTE] 9876");
  await form.locator(".registros-obs [contenteditable='true']").click();
  await page.keyboard.type("[TESTE] Aguardando alvará municipal.");
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(400);
  check(`${rotulo} e-mail inválido é recusado`, /E-mail inválido/.test(await page.locator(".registros-form .form-error").innerText().catch(() => "")));
  await form.locator("label", { hasText: "E-mail 2" }).locator("input").fill("financeiro@pecasserranas.com.br");
  await form.locator("button[type=submit]").click();
  await page.waitForTimeout(500);
  check(`${rotulo} registro salvo`, /Registro criado/.test(await page.locator(".registros-form .module-notice").innerText()));
  const item = page.locator(".registro-item").first();
  check(`${rotulo} aparece na lista aguardando revisão`, /Aguardando revisão/i.test(await item.innerText()) && /11\.222\.333\/0001-81/.test(await item.innerText()));
  check(`${rotulo} contador de revisão`, (await page.locator(".registros-totais button").first().locator("strong").innerText()) === "1");

  // Documentos
  await page.locator(".registros-form input[type=file]").setInputFiles({ name: "[TESTE] contrato social.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 teste") });
  await page.waitForTimeout(500);
  check(`${rotulo} documento anexado`, (await page.locator(".registros-anexos li").count()) === 1 && /contrato social/.test(await page.locator(".registros-anexos").innerText()));

  // Revisão e responsável
  await page.locator(".registros-detalhe__acoes button", { hasText: "Marcar como revisado" }).click();
  await page.waitForTimeout(400);
  check(`${rotulo} marcado como revisado`, /Ativo/i.test(await page.locator(".registro-item").first().innerText()));
  await page.locator(".registros-responsavel select").selectOption("local-colaborador");
  await page.locator(".registros-responsavel button").click();
  await page.waitForTimeout(600);
  check(`${rotulo} responsável definido`, /Colaborador/.test(await page.locator(".registro-item").first().innerText()));
  check(`${rotulo} aviso de modo demonstração`, /Modo demonstração/.test(await page.locator(".registros-form .module-notice").innerText()));
  await page.locator(".registros-secao summary", { hasText: "Histórico do registro" }).click();
  check(`${rotulo} histórico registra criação e responsável`, (await page.locator(".registros-eventos li").count()) >= 2 && /Responsável pela apuração: Colaborador/.test(await page.locator(".registros-eventos").innerText()));

  // Razão social do e-mail diferente da Receita: a Receita não sobrescreve sozinha; alerta e botão para usar a oficial
  const campoRazao = page.locator(".registros-form label", { hasText: "Razão social" }).locator("input");
  await campoRazao.fill("[TESTE] NOME INFORMADO NO E-MAIL LTDA");
  await page.locator(".registros-form .registros-cnpj__linha button").click();
  await page.waitForTimeout(600);
  check(`${rotulo} Receita não troca a razão social já preenchida`, (await campoRazao.inputValue()) === "[TESTE] NOME INFORMADO NO E-MAIL LTDA");
  const alerta = page.locator(".registros-alerta-razao");
  check(`${rotulo} alerta de razão social divergente`, (await alerta.count()) === 1 && (await alerta.innerText()).includes(RECEITA.razaoSocial));
  check(`${rotulo} mensagem avisa da divergência`, /diferente/.test(await page.locator(".registros-form .module-notice").innerText()));
  check(`${rotulo} selo "Razão divergente" na lista`, /Razão divergente/i.test(await page.locator(".registro-item").first().innerText()));
  await alerta.locator("button").click();
  check(`${rotulo} botão usa a razão social da Receita`, (await campoRazao.inputValue()) === RECEITA.razaoSocial && (await page.locator(".registros-alerta-razao").count()) === 0);
  await page.locator(".registros-form button[type=submit]").click();
  await page.waitForTimeout(500);
  check(`${rotulo} selo some depois de salvar`, !/Razão divergente/i.test(await page.locator(".registro-item").first().innerText()));

  // Subaba Alterações: nova alteração ligada à empresa
  await page.locator(".registros-subabas [role=tab]", { hasText: "Alterações" }).click();
  check(`${rotulo} subaba Alterações começa vazia`, /Nenhuma alteração/.test(await page.locator(".registros-lista .empty-state").innerText()));
  await page.click(".registros-novo");
  check(`${rotulo} botão vira "Nova alteração"`, /Nova alteração/.test(await page.locator(".registros-novo").innerText()) && /Nova alteração/.test(await page.locator(".registros-detalhe__cabeca h2").innerText()));
  await page.locator(".registros-form .registros-cnpj input").fill("11222333000181");
  await page.locator(".registros-form .registros-cnpj__linha button").click();
  await page.waitForTimeout(400);
  check(`${rotulo} alteração aceita CNPJ de empresa já registrada`, /Dados encontrados/.test(await page.locator(".registros-form .module-notice").innerText()));
  // Cliques rápidos seguidos (sem esperar renderizar) não podem se sobrescrever.
  await page.evaluate(() => {
    const botoes = [...document.querySelectorAll(".registros-categorias button")];
    const achar = (t) => botoes.find((b) => b.textContent.includes(t));
    achar("Quadro societário").click();
    achar("Atividades (CNAE)").click();
    achar("Endereço").click();
    achar("Endereço").click();
  });
  await page.waitForTimeout(150);
  const marcadas = await page.locator(".registros-categorias button[aria-pressed=true]").allInnerTexts();
  check(`${rotulo} cliques rápidos nas categorias não se perdem`, marcadas.length === 2 && marcadas.some((t) => /Quadro societário/.test(t)) && marcadas.some((t) => /CNAE/.test(t)), marcadas.join(", "));
  await page.locator(".registros-form label", { hasText: "Data da alteração" }).locator("input").fill("2026-11-20");
  check(`${rotulo} alteração não mostra responsável nem contatos`, (await page.locator(".registros-responsavel").count()) === 0 && (await page.locator(".registros-form label", { hasText: "Telefone 1" }).count()) === 0);
  await page.locator(".registros-form button[type=submit]").click();
  await page.waitForTimeout(500);
  check(`${rotulo} mensagem "Alteração registrada."`, /Alteração registrada/.test(await page.locator(".registros-form .module-notice").innerText()));
  const alt = page.locator(".registro-item").first();
  const altTexto = await alt.innerText();
  check(`${rotulo} alteração na lista com o que mudou e a data`, /Quadro societário/i.test(altTexto) && /Atividades \(CNAE\)/i.test(altTexto) && /Alteração de 20\/11\/2026/.test(altTexto), altTexto.replace(/\n/g, " | "));
  check(`${rotulo} alteração ligada à empresa`, /Empresa:\s*\[TESTE\] COMERCIO DE PECAS SERRANAS LTDA/.test(await page.locator(".registros-empresa-link").innerText()) && /Responsável: Colaborador/.test(await page.locator(".registros-empresa-link").innerText()));
  await page.screenshot({ path: path.join(OUT, `registros-alteracao-${tema}-${tamanho}-${largura}.png`) });
  await page.locator(".registros-detalhe__acoes button", { hasText: "Marcar como concluída" }).click();
  await page.waitForTimeout(400);
  check(`${rotulo} alteração concluída`, /Concluída/i.test(await page.locator(".registro-item").first().innerText()));
  await page.locator(".registros-empresa-link button").click();
  await page.waitForTimeout(500);
  check(`${rotulo} empresa abre na subaba Registros com a lista de alterações`, (await page.locator(".registros-subabas [aria-selected=true]").innerText()).includes("Registros") && (await page.locator(".registros-alteracoes-empresa li").count()) === 1);
  check(`${rotulo} contatos salvos no registro`, (await page.locator(".registros-form label", { hasText: "E-mail 2" }).locator("input").inputValue()) === "financeiro@pecasserranas.com.br");
  check(`${rotulo} botão de enviar contatos ao Controle de Apuração`, (await page.locator(".registros-enviar-contatos").count()) === 1);

  // Padrão premium: tipografia, rótulo do detalhe, barra de salvar e indicadores inteiros
  const premium = await page.evaluate(() => {
    const css = (sel, prop) => { const el = document.querySelector(sel); return el ? getComputedStyle(el)[prop] : ""; };
    const rotulos = [...document.querySelectorAll(".registros-totais span")];
    return {
      ligado: !!document.querySelector(".hub-premium"),
      titulo: css(".registros-detalhe__cabeca h2", "fontFamily"),
      rotulo: css(".registros-rotulo", "fontFamily"),
      selo: css(".registro-selo", "fontFamily"),
      numero: css(".registros-totais strong", "fontWeight"),
      barra: css(".registros-salvar", "position"),
      cortados: rotulos.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.textContent)
    };
  });
  check(
    `${rotulo} visual premium (Nunito, DM Mono, número fino, barra fixa)`,
    premium.ligado && /Nunito/.test(premium.titulo) && /DM Mono/.test(premium.rotulo) && /DM Mono/.test(premium.selo) && premium.numero === "200" && premium.barra === "sticky",
    JSON.stringify(premium)
  );
  check(`${rotulo} rótulos dos indicadores inteiros`, !premium.cortados.length, premium.cortados.join(", "));

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
