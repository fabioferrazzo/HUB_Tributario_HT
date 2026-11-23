// Chat (modo local): ferramentas de formatação (itálico, sublinhado, grifo, tamanho da fonte, listas)
// preservadas na mensagem enviada e anexo que abre/baixa para quem recebe.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const path = require("path");
const os = require("os");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 }, acceptDownloads: true });
  const errors = [];
  const p = await ctx.newPage();
  p.on("pageerror", (e) => errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(BASE + "/#/home");
  await p.fill('input[type="password"]', "hub-demo-2026");
  await p.click('button[type="submit"]');
  await p.waitForTimeout(1300);
  await p.evaluate(() => localStorage.removeItem("hub_chat_local"));
  await p.locator('.topbar-actions button[aria-label^="Chat"]').click();
  await p.waitForTimeout(400);
  const chat = p.locator(".chat--janela");
  await chat.getByRole("button", { name: "Nova conversa" }).click();
  await chat.locator(".chat-item", { hasText: "Colaborador" }).first().click();
  await p.waitForTimeout(400);
  const editor = chat.locator(".chat-composer [contenteditable='true']");
  const barra = chat.locator(".chat-composer .pauta-format-toolbar");
  const botao = (nome) => barra.locator(`button[aria-label="${nome}"]`);
  const escreverComFormato = async (texto, aplicar) => {
    await editor.click();
    await p.keyboard.type(texto);
    for (let i = 0; i < texto.length; i++) await p.keyboard.press("Shift+ArrowLeft");
    await aplicar();
    await editor.click();
    await p.keyboard.press("End");
    await p.keyboard.type(" ");
  };
  check("barra de formatação visível no chat", await barra.isVisible().catch(() => false));
  await escreverComFormato("italico", () => botao("Itálico (Ctrl+I)").click());
  await escreverComFormato("sublinhado", () => botao("Sublinhado (Ctrl+U)").click());
  await escreverComFormato("grifado", () => botao("Grifo amarelo").click());
  const tamanho = barra.locator('select[aria-label="Tamanho da fonte"]');
  const opcoes = await tamanho.locator("option").allInnerTexts();
  await escreverComFormato("grande", () => tamanho.selectOption({ index: opcoes.length - 1 }));
  await p.keyboard.press("Enter");
  await p.waitForTimeout(700);
  const bolha = chat.locator(".chat-msg--minha .chat-msg-texto").last();
  const estilos = await bolha.evaluate((raiz) => {
    const base = parseFloat(getComputedStyle(raiz).fontSize);
    const achar = (palavra) => {
      const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = walker.nextNode())) if (n.textContent.includes(palavra)) return n.parentElement;
      return null;
    };
    const fundo = (el) => {
      for (let e = el; e && e !== raiz; e = e.parentElement) {
        const bg = getComputedStyle(e).backgroundColor;
        if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") return bg;
      }
      return "";
    };
    const sublinhado = (el) => {
      for (let e = el; e && e !== raiz.parentElement; e = e.parentElement) if (getComputedStyle(e).textDecorationLine.includes("underline")) return true;
      return false;
    };
    const it = achar("italico"), su = achar("sublinhado"), gr = achar("grifado"), gd = achar("grande");
    return {
      html: raiz.innerHTML,
      italico: it ? getComputedStyle(it).fontStyle : "",
      sublinhado: su ? sublinhado(su) : false,
      grifo: gr ? fundo(gr) : "",
      tamanho: gd ? parseFloat(getComputedStyle(gd).fontSize) : 0,
      base,
    };
  });
  check("itálico preservado e visível", estilos.italico === "italic", estilos.html.slice(0, 200));
  check("sublinhado preservado e visível", estilos.sublinhado === true);
  check("grifo preservado e em amarelo", /rgb\(255, 2[0-9]{2}, 1[0-9]{2}\)|rgb\(255, 255, 0\)/.test(estilos.grifo), estilos.grifo);
  check("tamanho da fonte maior que o texto normal", estilos.tamanho > estilos.base + 4, `${estilos.tamanho}px x ${estilos.base}px (${opcoes.join("/")})`);

  // Anexo: envia e abre/baixa
  const arq = path.join(os.tmpdir(), "hub_chat_anexo_teste.txt");
  fs.writeFileSync(arq, "conteudo do anexo de teste");
  await chat.locator('.chat-composer input[type="file"]').setInputFiles(arq);
  await p.waitForTimeout(300);
  await editor.click();
  await p.keyboard.type("segue anexo");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(900);
  const anexo = chat.locator(".chat-msg--minha").last().locator(".chat-anexo, a, button", { hasText: "hub_chat_anexo_teste.txt" }).first();
  check("anexo aparece na mensagem", (await anexo.count()) === 1);
  if (await anexo.count()) {
    const [evento] = await Promise.all([
      Promise.race([p.waitForEvent("download", { timeout: 5000 }), ctx.waitForEvent("page", { timeout: 5000 })]).catch(() => null),
      anexo.click(),
    ]);
    let conteudo = "";
    if (evento && typeof evento.path === "function" && evento.suggestedFilename) {
      conteudo = fs.readFileSync(await evento.path(), "utf8");
    } else if (evento) {
      await evento.waitForLoadState().catch(() => {});
      conteudo = await evento.evaluate(() => document.body.innerText).catch(() => "");
    }
    check("anexo abre/baixa com o conteúdo certo", /conteudo do anexo de teste/.test(conteudo), conteudo.slice(0, 60));
  }
  check("sem erros de página", errors.length === 0, errors.join(" | "));
  await browser.close();
  console.log(results.join("\n"));
  const falhas = results.filter((r) => r.startsWith("FALHA")).length;
  console.log(falhas ? `\n${falhas} falha(s)` : `\nTodas as ${results.length} verificações OK`);
  process.exit(falhas ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
