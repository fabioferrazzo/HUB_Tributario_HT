// Testa a escrita no Quadro de Avisos e nas anotacoes do Pomodoro (modo local, localhost).
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
  await page.goto(BASE + "/");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1200);
  await page.evaluate(() => localStorage.removeItem("hub_quadro_avisos_app"));

  // Quadro de Avisos: texto com quebras de linha, acentos e endereco longo
  await page.getByRole("tab", { name: "Quadro de Avisos" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Novo aviso" }).first().click();
  const texto = "Atenção, equipe:\n\n1) Revisar a apuração do ICMS-ST até sexta.\n2) Conferir créditos de PIS/COFINS.\n\nLink: https://www.sefaz.rs.gov.br/receita-estadual/portal-de-servicos-muito-longo-sem-espacos-para-quebrar";
  const ed = page.locator(".avisos-editor-panel [contenteditable=true]").first();
  await ed.click();
  const linhas = texto.split("\n");
  for (let i = 0; i < linhas.length; i++) { if (linhas[i]) await page.keyboard.insertText(linhas[i]); if (i < linhas.length - 1) await page.keyboard.press("Enter"); }
  await page.getByRole("button", { name: "Salvar aviso" }).click();
  await page.waitForTimeout(600);
  const card = page.locator(".aviso-cell").first().locator(".aviso-card__text");
  const shown = await card.innerText();
  check("quadro: texto completo, acentos e quebras de linha", shown.replace(/\n+/g, "\n").trim() === texto.replace(/\n+/g, "\n").trim(), JSON.stringify(shown).slice(0, 120));
  const overflow = await page.locator(".aviso-cell").first().evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  check("quadro: endereco longo nao estoura o espaco", !overflow);
  await page.locator(".avisos-board").screenshot({ path: `${out}\\escrita-quadro.png` });

  // Pomodoro: grifo liga e desliga
  await page.evaluate(() => window.postMessage({ type: "hub:pomodoro-notes-float", notes: "" }, window.location.origin));
  await page.waitForTimeout(500);
  const notes = page.locator(".pomodoro-floating-notes__editor");
  if (await notes.count()) {
    await notes.click();
    await page.keyboard.type("Nota de teste com grifo");
    await notes.evaluate((root) => {
      const node = root.firstChild && root.firstChild.nodeType === 3 ? root.firstChild : root.querySelector("*").firstChild;
      const index = node.textContent.indexOf("grifo");
      const range = document.createRange();
      range.setStart(node, index);
      range.setEnd(node, index + 5);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    const grifo = page.locator(".pomodoro-floating-notes__toolbar button", { hasText: "Grifo" });
    await grifo.click();
    const on = await notes.evaluate((el) => el.innerHTML);
    check("pomodoro: grifo aplicado", /background-color/.test(on), on);
    await notes.evaluate((root) => {
      const el = root.querySelector("[style*='background']");
      const range = document.createRange();
      range.selectNodeContents(el);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
    });
    await grifo.click();
    const off = await notes.evaluate((el) => el.innerHTML);
    check("pomodoro: grifo removido", !/background-color: rgb\(255/.test(off), off);
    const options = await page.locator(".pomodoro-floating-notes__toolbar select option").allInnerTexts();
    check("pomodoro: tamanhos maiores", options.includes("Muito grande") && options.includes("Título"), options.join(", "));
    await notes.evaluate((el) => { el.innerHTML = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
  } else {
    check("pomodoro: anotacoes encontradas", false);
  }

  check("sem erros no console", errors.length === 0, errors.join(" | ").slice(0, 300));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
