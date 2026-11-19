// Comentários em pautas e avisos (modo local): comentar, bloquear/desbloquear (admin), excluir (autor/admin).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url)) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());

  const entrar = async (email) => {
    await page.goto(BASE + "/#/pautas");
    await page.waitForTimeout(500);
    if (await page.getByRole("button", { name: /^Sair/ }).count()) {
      await page.getByRole("button", { name: /^Sair/ }).first().click();
      await page.waitForTimeout(500);
    }
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.goto(BASE + "/#/pautas");
    await page.waitForTimeout(900);
  };
  const linhaPauta = () => page.locator("[data-pauta-row]", { hasText: "Todos os usuários" }).first();
  const conversaPauta = () => linhaPauta().locator(".hub-comentarios");

  // --- administrador comenta e bloqueia
  await entrar("");
  await page.evaluate(() => { localStorage.removeItem("hub_comentarios_local"); localStorage.removeItem("hub_comentarios_bloqueios_local"); localStorage.removeItem("hub_quadro_avisos_app"); });
  await page.reload(); await page.waitForTimeout(900);
  check("pauta visível para todos existe", (await linhaPauta().count()) === 1);
  const tituloPauta = (await linhaPauta().locator("strong").first().innerText()).trim();
  await conversaPauta().locator(".hub-comentarios__toggle").click();
  check("conversa vazia", /Nenhum comentário/.test(await conversaPauta().innerText()));
  await conversaPauta().getByLabel("Escrever comentário").fill("[TESTE] Comentário do admin");
  await conversaPauta().getByRole("button", { name: "Comentar" }).click();
  await page.waitForTimeout(400);
  check("admin comentou na pauta", /Comentário do admin/.test(await conversaPauta().innerText()));
  check("contador mostra (1)", /Comentários \(1\)/.test(await conversaPauta().locator(".hub-comentarios__toggle").innerText()));
  await conversaPauta().getByRole("button", { name: "Bloquear" }).click();
  await page.waitForTimeout(300);
  check("bloqueio: admin continua podendo comentar", /Você ainda pode comentar/.test(await conversaPauta().innerText()) && (await conversaPauta().getByLabel("Escrever comentário").count()) === 1);

  // --- colaborador vê, mas não comenta (bloqueado)
  await entrar("colaborador@hteixeira.local");
  const linhaColab = page.locator("[data-pauta-row]", { hasText: tituloPauta }).first();
  check("colaborador vê a pauta", (await linhaColab.count()) === 1);
  await linhaColab.locator(".hub-comentarios__toggle").click();
  await page.waitForTimeout(300);
  const conversaColab = linhaColab.locator(".hub-comentarios");
  check("colaborador lê o comentário", /Comentário do admin/.test(await conversaColab.innerText()));
  check("colaborador vê aviso de bloqueio e não tem campo", /bloqueados pela coordenação/.test(await conversaColab.innerText()) && (await conversaColab.getByLabel("Escrever comentário").count()) === 0);
  check("colaborador não pode excluir comentário do admin", (await conversaColab.locator(".hub-comentarios__excluir").count()) === 0);
  check("colaborador não vê botão de bloqueio", (await conversaColab.getByRole("button", { name: /Bloquear|Desbloquear/ }).count()) === 0);

  // --- admin desbloqueia
  await entrar("");
  await conversaPauta().locator(".hub-comentarios__toggle").click();
  await conversaPauta().getByRole("button", { name: "Desbloquear" }).click();
  await page.waitForTimeout(300);

  // --- colaborador comenta e exclui o próprio
  await entrar("colaborador@hteixeira.local");
  await linhaColab.locator(".hub-comentarios__toggle").click();
  await conversaColab.getByLabel("Escrever comentário").fill("[TESTE] Pergunta do colaborador");
  await conversaColab.getByRole("button", { name: "Comentar" }).click();
  await page.waitForTimeout(400);
  check("colaborador comentou após desbloqueio", /Pergunta do colaborador/.test(await conversaColab.innerText()));
  check("colaborador pode excluir só o próprio", (await conversaColab.locator(".hub-comentarios__excluir").count()) === 1);
  await conversaColab.locator(".hub-comentarios__excluir").click();
  await page.waitForTimeout(400);
  check("comentário excluído pelo autor", !/Pergunta do colaborador/.test(await conversaColab.innerText()));

  // --- aviso do quadro geral: colaborador publica e comenta; admin vê e exclui
  await page.getByRole("tab", { name: "Quadro de Avisos" }).click();
  await page.waitForTimeout(400);
  const editorPanel = page.locator(".avisos-editor-panel");
  await page.getByRole("button", { name: "Novo aviso" }).first().click();
  await editorPanel.locator(".pauta-description-input").click();
  await page.keyboard.type("[TESTE] Aviso para comentar");
  await editorPanel.getByRole("button", { name: "Salvar aviso" }).click();
  await page.waitForTimeout(700);
  const lateral = page.locator(".avisos-side-panel").first();
  const conversaAviso = lateral.locator(".hub-comentarios").first();
  check("comentários aparecem abaixo do aviso na barra lateral", (await conversaAviso.count()) === 1 && (await conversaAviso.getByLabel("Escrever comentário").count()) === 1);
  await conversaAviso.getByLabel("Escrever comentário").fill("[TESTE] Dúvida sobre o aviso");
  await conversaAviso.getByLabel("Escrever comentário").press("Control+Enter");
  await page.waitForTimeout(400);
  check("comentário no aviso (Ctrl+Enter)", /Dúvida sobre o aviso/.test(await conversaAviso.innerText()));

  await entrar("");
  await page.getByRole("tab", { name: "Quadro de Avisos" }).click();
  await page.waitForTimeout(400);
  await page.locator(".aviso-cell").first().click();
  await page.waitForTimeout(500);
  const conversaAdmin = page.locator(".avisos-side-panel .hub-comentarios").first();
  check("admin vê o comentário do aviso", /Dúvida sobre o aviso/.test(await conversaAdmin.innerText().catch(() => "")));
  check("admin pode excluir comentário de outro", (await conversaAdmin.locator(".hub-comentarios__excluir").count()) === 1);
  await conversaAdmin.locator(".hub-comentarios__excluir").click();
  await page.waitForTimeout(400);
  check("admin excluiu o comentário", !/Dúvida sobre o aviso/.test(await conversaAdmin.innerText()));

  check("sem erros no console", errors.length === 0, errors.join(" | "));
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.log(results.join("\n")); console.error(e); process.exit(1); });
