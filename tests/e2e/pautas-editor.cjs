// Testa o editor de texto das Pautas em modo local de demonstracao (localhost).
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const out = OUT;
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

  await page.goto(BASE + "/#/pautas");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.getByRole("button", { name: "Nova pauta" }).first().click();
  await page.waitForTimeout(400);

  const editor = page.locator(".pauta-description-input");
  await page.locator(".pauta-editor-panel input").first().fill("Teste do editor de texto");
  await editor.click();
  await page.keyboard.type("Prazo final da DCTFWeb amanha. Conferir retencoes.");

  // seleciona um trecho exato do texto
  const selectText = (text) =>
    page.evaluate((needle) => {
      const root = document.querySelector(".pauta-description-input");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const index = node.textContent.indexOf(needle);
        if (index >= 0) {
          const range = document.createRange();
          range.setStart(node, index);
          range.setEnd(node, index + needle.length);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
          root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          return true;
        }
      }
      return false;
    }, text);
  const html = () => editor.evaluate((el) => el.innerHTML);
  const press = (label) => page.locator(`.pauta-format-toolbar button[aria-label="${label}"]`).dispatchEvent("mousedown");

  // 1. grifo liga
  await selectText("DCTFWeb");
  await press("Grifo amarelo");
  let h = await html();
  check("grifo aplicado so no trecho", /background-color/.test(h) && !/background-color[^>]*>Prazo/.test(h), h.slice(0, 160));
  const btnState = await page.locator('.pauta-format-toolbar button[aria-pressed="true"][aria-label="Remover grifo"]').count();
  check("botao indica grifo ativo", btnState === 1);
  await page.screenshot({ path: `${out}\\ed-1-grifo.png`, clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  // 2. grifo desliga
  await selectText("DCTFWeb");
  await press("Remover grifo");
  h = await html();
  check("grifo removido", !/background/.test(h) && !/<mark/.test(h), h.slice(0, 160));

  // 3. grifo com cursor dentro do trecho (sem selecao) remove
  await selectText("amanha");
  await press("Grifo amarelo");
  await page.evaluate(() => {
    const root = document.querySelector(".pauta-description-input");
    const span = root.querySelector("span[style]");
    const range = document.createRange();
    range.setStart(span.firstChild, 2);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    root.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
  });
  await press("Remover grifo");
  h = await html();
  check("grifo removido com cursor dentro", !/background/.test(h), h.slice(0, 160));

  // 4. tamanhos
  for (const [value, expected] of [["titulo", "24px"], ["muito-grande", "20px"], ["grande", "16px"]]) {
    await selectText("Prazo final");
    await page.locator(".pauta-format-size select").selectOption(value);
    const size = await page.evaluate(() => {
      const root = document.querySelector(".pauta-description-input");
      const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) if (node.textContent.includes("Prazo")) return getComputedStyle(node.parentElement).fontSize;
      return "";
    });
    check(`tamanho ${value}`, size === expected, size);
  }
  await selectText("Prazo final");
  const shownSize = await page.locator(".pauta-format-size select").inputValue();
  check("seletor mostra o tamanho do trecho", shownSize === "grande", shownSize);

  // 5. negrito liga e desliga, so no trecho
  await selectText("Conferir");
  await press("Negrito (Ctrl+B)");
  h = await html();
  check("negrito so no trecho", /<b>Conferir<\/b>/.test(h), h.slice(-120));
  await selectText("Conferir");
  await press("Negrito (Ctrl+B)");
  h = await html();
  check("negrito desfeito", !/<b>Conferir/.test(h), h.slice(-120));

  // 6. sublinhado e italico
  await selectText("retencoes");
  await press("Sublinhado (Ctrl+U)");
  await press("Itálico (Ctrl+I)");
  h = await html();
  check("sublinhado + italico", /<u>|<i>/.test(h), h.slice(-140));

  // 7. limpar formatacao
  await selectText("Conferir retencoes");
  await press("Limpar formatação");
  h = await html();
  check("limpar formatacao do trecho", !/<u>|<i>|<b>/.test(h), h.slice(-140));

  // 8. lista
  await editor.click();
  await page.keyboard.press("End");
  await page.keyboard.press("Control+End");
  await page.keyboard.press("Enter");
  await press("Lista com marcadores");
  await page.keyboard.type("Item um");
  await page.keyboard.press("Enter");
  await page.keyboard.type("Item dois");
  h = await html();
  check("lista com marcadores", /<ul><li>Item um<\/li><li>Item dois<\/li><\/ul>/.test(h), h.slice(-120));

  // 9. grifo final para conferir na lista salva
  await selectText("DCTFWeb");
  await press("Grifo amarelo");
  await selectText("Prazo final");
  await page.locator(".pauta-format-size select").selectOption("titulo");
  await page.screenshot({ path: `${out}\\ed-2-editor.png`, clip: { x: 0, y: 0, width: 1440, height: 1000 } });

  // 10. salvar e verificar a exibicao na lista
  await page.locator(".pauta-editor-panel button[type='submit']").click();
  await page.waitForTimeout(800);
  const saved = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll(".list-row--pauta"));
    const row = rows.find((item) => item.textContent.includes("Teste do editor de texto"));
    if (!row) return null;
    const content = row.querySelector(".pauta-content");
    const description = row.querySelector(".pauta-description");
    return {
      html: description.innerHTML,
      weight: getComputedStyle(description).fontWeight,
      bold: content.getAttribute("data-font-bold"),
      size: content.getAttribute("data-font-size")
    };
  });
  check("pauta salva aparece na lista", Boolean(saved), JSON.stringify(saved).slice(0, 300));
  if (saved) {
    check("lista: grifo so no trecho", /<mark>DCTFWeb<\/mark>/.test(saved.html));
    check("lista: titulo so no trecho", /pauta-text-title/.test(saved.html));
    check("lista: lista salva", /<ul><li>Item um<\/li>/.test(saved.html));
    check("lista: pauta inteira nao ficou em negrito", saved.bold === "false" && Number(saved.weight) < 700, saved.weight);
  }
  const row = page.locator(".list-row--pauta", { hasText: "Teste do editor de texto" }).first();
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: `${out}\\ed-3-lista.png` });

  // 11. reabrir para editar: formatacao volta ao editor e pode ser desfeita
  const editBtn = row.getByRole("button", { name: /Editar/ });
  if (await editBtn.count()) {
    await editBtn.first().click();
    await page.waitForTimeout(400);
    h = await html();
    check("reabrir mantem grifo e tamanho", /<mark>DCTFWeb<\/mark>/.test(h) && /pauta-text-title/.test(h), h.slice(0, 160));
    await selectText("DCTFWeb");
    await press("Remover grifo");
    h = await html();
    check("remover grifo salvo anteriormente", !/<mark/.test(h), h.slice(0, 160));
  } else {
    check("botao editar encontrado", false);
  }

  check("sem erros no console", errors.length === 0, errors.join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
