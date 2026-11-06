// Quadro de Avisos: formatacao, cor do post-it e edicao (modo local, localhost).
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const fs = require("fs");
const out = OUT;
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url)) errors.push(m.text()); });
  await page.goto(BASE + "/");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.removeItem("hub_quadro_avisos_app"));
  await page.getByRole("tab", { name: "Quadro de Avisos" }).click();
  await page.waitForTimeout(500);

  const panel = page.locator(".avisos-editor-panel");
  const editor = panel.locator(".pauta-description-input");
  const press = (label) => panel.locator(`.pauta-format-toolbar button[aria-label="${label}"]`).dispatchEvent("mousedown");
  const selectText = (needle) =>
    editor.evaluate((root, text) => {
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = node.textContent.indexOf(text);
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + text.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, needle);

  // 1. post-it rosa com formatacao
  await page.getByRole("button", { name: "Novo aviso" }).first().click();
  await panel.getByRole("radio", { name: "Post-it" }).click();
  await panel.getByRole("button", { name: "Usar cor #fde2e2" }).click();
  const previewBg = await editor.evaluate((el) => getComputedStyle(el).backgroundColor);
  check("previa da cor do post-it no editor", previewBg === "rgb(253, 226, 226)", previewBg);
  check("barra de formatacao no quadro", (await panel.locator(".pauta-format-toolbar button").count()) >= 7);
  await editor.click();
  await page.keyboard.type("Reunião às 9h com toda a equipe");
  await selectText("Reunião");
  await press("Negrito (Ctrl+B)");
  await selectText("9h");
  await press("Grifo amarelo");
  await selectText("toda a equipe");
  await panel.locator(".pauta-format-size select").selectOption("muito-grande");
  await page.screenshot({ path: `${out}\\q2-1-editor.png` });
  await panel.getByRole("button", { name: "Salvar aviso" }).click();
  await page.waitForTimeout(600);
  let card = page.locator(".aviso-cell").first().locator(".aviso-card").first();
  const info1 = await card.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, html: el.querySelector(".aviso-card__text").innerHTML }));
  check("post-it salvo com a cor rosa", info1.bg === "rgb(253, 226, 226)", info1.bg);
  check("formatacao salva (negrito, grifo, tamanho)", /<strong>Reunião<\/strong>/.test(info1.html) && /<mark>9h<\/mark>/.test(info1.html) && /pauta-text-xlarge/.test(info1.html), info1.html);

  // 2. editar: texto, cor e remover grifo
  const reading = page.locator(".avisos-side-panel").first();
  await reading.getByRole("button", { name: "Editar" }).first().click();
  await page.waitForTimeout(300);
  check("editor abre em modo edicao", (await panel.locator("h3").innerText()) === "Editar aviso");
  const loaded = await editor.evaluate((el) => el.innerHTML);
  check("edicao carrega o texto formatado", /<mark>9h<\/mark>/.test(loaded), loaded);
  check("edicao carrega o tipo post-it", (await panel.getByRole("radio", { name: "Post-it" }).getAttribute("aria-checked")) === "true");
  await panel.getByRole("button", { name: "Usar cor #dcfce7" }).click();
  await selectText("9h");
  await press("Remover grifo");
  await editor.click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type(" (sala 2)");
  await panel.getByRole("button", { name: "Salvar alterações" }).click();
  await page.waitForTimeout(600);
  const count = await page.locator(".aviso-cell").first().locator(".aviso-card").count();
  card = page.locator(".aviso-cell").first().locator(".aviso-card").first();
  const info2 = await card.evaluate((el) => ({ bg: getComputedStyle(el).backgroundColor, html: el.querySelector(".aviso-card__text").innerHTML }));
  check("edicao nao duplica o aviso", count === 1, String(count));
  check("edicao salva nova cor", info2.bg === "rgb(220, 252, 231)", info2.bg);
  check("edicao salva texto e remove grifo", /sala 2/.test(info2.html) && !/<mark>/.test(info2.html), info2.html);
  const msg = await page.locator(".avisos-message").innerText().catch(() => "");
  check("mensagem de sucesso", /Alterações salvas/.test(msg), msg);

  // 3. anexo: editar so a legenda mantem o arquivo
  fs.writeFileSync(`${out}\\teste.pdf`, "%PDF-1.4\n%teste\n");
  await page.getByRole("button", { name: "Novo aviso" }).first().click();
  await panel.getByRole("radio", { name: "Anexo" }).click();
  await page.locator('input[type="file"].sr-only').setInputFiles(`${out}\\teste.pdf`);
  await panel.getByRole("button", { name: "Salvar aviso" }).click();
  await page.waitForTimeout(600);
  const fileCard = page.locator(".avisos-side-panel .aviso-card--anexo").first();
  await fileCard.getByRole("button", { name: "Editar" }).click();
  const currentFile = await panel.locator(".aviso-file-tools small").innerText();
  check("edicao mostra o arquivo atual", /Arquivo atual: teste\.pdf/.test(currentFile), currentFile);
  await editor.click();
  await page.keyboard.type("Instrução normativa nova");
  await panel.getByRole("button", { name: "Salvar alterações" }).click();
  await page.waitForTimeout(600);
  const fileInfo = await page.locator(".aviso-cell").first().locator(".aviso-card--anexo").first().innerText();
  check("anexo mantido com nova legenda", /teste\.pdf/.test(fileInfo) && /Instrução normativa nova/.test(fileInfo), fileInfo.replace(/\n/g, " | "));
  await page.locator(".avisos-board").screenshot({ path: `${out}\\q2-2-quadro.png` });

  check("sem erros no console", errors.length === 0, errors.join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
