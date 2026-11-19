// Quadro geral: administrador edita/exclui pautas direto no quadro; "Postar como Aviso da Coordenação" no formulário da pauta.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|agenda-tributaria|fonts\.g/.test(`${m.text()} ${m.location().url}`)) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  const entrar = async (email) => {
    await page.goto(BASE + "/#/home");
    await page.waitForTimeout(500);
    if (await page.getByRole("button", { name: /^Sair/ }).count()) {
      await page.getByRole("button", { name: /^Sair/ }).first().click();
      await page.waitForTimeout(500);
    }
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1500);
  };

  await entrar("");
  await page.evaluate(() => localStorage.removeItem("hub_aviso_coordenacao_local"));
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  const itens = page.locator(".qg-coluna .qg-item:has(.qg-item-acoes)");
  const n0 = await itens.count();
  check("admin vê editar/excluir nas pautas do Quadro geral", n0 >= 1, String(n0));
  const titulo = (await itens.first().locator(".qg-item-titulo").innerText()).replace(/^destaque\s*/i, "").trim();

  // editar a partir do Quadro geral
  await itens.first().getByRole("button", { name: /Editar a pauta/ }).click();
  await page.waitForTimeout(1500);
  check("Editar abre Pautas com o editor da pauta", /#\/pautas/.test(page.url()) && (await page.getByRole("button", { name: "Salvar edição da pauta" }).count()) === 1);
  const campoTitulo = page.locator("form").filter({ has: page.getByRole("button", { name: "Salvar edição da pauta" }) }).locator("input").first();
  check("editor traz o título da pauta", (await campoTitulo.inputValue()).trim() === titulo, await campoTitulo.inputValue());

  // postar como aviso da coordenação
  await page.getByText("Postar como Aviso da Coordenação").click();
  await page.getByRole("button", { name: "Salvar edição da pauta" }).click();
  await page.waitForTimeout(1200);
  check("confirmação de postagem", /postada como Aviso da Coordenação/.test(await page.locator(".module-notice").allInnerTexts().then((t) => t.join(" "))));
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  const aviso = await page.locator(".qg-aviso").innerText();
  check("pauta aparece como Aviso da Coordenação no Quadro geral", aviso.includes(titulo), aviso.slice(0, 160).replace(/\n/g, " | "));

  // excluir a partir do Quadro geral
  const antes = await page.locator(".qg-coluna .qg-item:has(.qg-item-acoes)").count();
  await page.locator(".qg-coluna .qg-item:has(.qg-item-acoes)").first().getByRole("button", { name: /Excluir a pauta/ }).click();
  await page.waitForTimeout(1200);
  const depois = await page.locator(".qg-coluna .qg-item:has(.qg-item-acoes)").count();
  check("Excluir no Quadro geral remove a pauta", depois === antes - 1, `${antes} -> ${depois}`);

  // colaborador: sem editar/excluir, vê o aviso
  await entrar("colaborador@hteixeira.local");
  await page.goto(BASE + "/#/home"); await page.waitForTimeout(1500);
  check("colaborador não vê editar/excluir", (await page.locator(".qg-item-acoes").count()) === 0);
  check("colaborador vê o Aviso da Coordenação", (await page.locator(".qg-aviso").innerText()).includes(titulo));

  check("sem erros no console", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
