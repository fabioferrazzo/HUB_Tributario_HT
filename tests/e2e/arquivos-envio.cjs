// Arquivos sem OCR: colaborador envia PDF e imagem digitalizados, sem selo de OCR; baixa; exclui.
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|api\/agenda/.test(m.location().url + m.text())) errors.push(m.text()); });
  page.on("dialog", (d) => d.accept());
  const login = async (email) => {
    await page.goto(BASE + "/");
    await page.waitForTimeout(600);
    if (email) await page.fill('input[type="email"]', email);
    await page.fill('input[type="password"]', "hub-demo-2026");
    await page.click('button[type="submit"]');
    await page.waitForTimeout(1200);
    await page.locator(".sidebar button", { hasText: "Arquivos" }).first().click();
    await page.waitForTimeout(900);
  };
  const logout = async () => { await page.getByRole("button", { name: /Sair/ }).first().click(); await page.waitForTimeout(800); };

  // admin: sem painel de OCR
  await login("");
  check("admin: painel Rodar OCR oculto", (await page.getByRole("button", { name: "Rodar OCR" }).count()) === 0);
  await logout();

  // colaborador envia dois arquivos digitalizados
  await login("colaborador@hteixeira.local");
  const form = page.locator("form.stack-form:not(.folder-form)").filter({ has: page.locator("input[type=url]") });
  const pdf = Buffer.from("%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF");
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=", "base64");
  await form.locator("input[type=file]").setInputFiles([
    { name: "nota-digitalizada.pdf", mimeType: "application/pdf", buffer: pdf },
    { name: "recibo-foto.png", mimeType: "image/png", buffer: png }
  ]);
  await form.getByLabel("Título").fill("Digitalizado teste");
  await form.getByRole("button", { name: "Salvar arquivo" }).click();
  await page.waitForTimeout(1500);
  const cards = page.locator("article.file-resource", { hasText: /nota-digitalizada|recibo-foto|Digitalizado teste/ });
  const n = await cards.count();
  check("colaborador: arquivos digitalizados enviados", n >= 1, `${n} cartao(oes)`);
  const text = n ? await cards.first().innerText() : "";
  check("sem selo de OCR/conversao", !/OCR|conversao|conversão|pesquis/i.test(text), text.replace(/\s+/g, " ").slice(0, 140));
  const baixar = cards.first().getByRole("link", { name: "Baixar" });
  check("botao Baixar presente", (await baixar.count()) === 1);
  if (await baixar.count()) {
    const href = await baixar.getAttribute("href");
    check("link de download valido", !!href && !/\?download=.*base64|data:[^,]*\?/.test(href), (href || "").slice(0, 60));
    const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 8000 }).catch(() => null), baixar.click()]);
    check("download inicia", !!dl, dl ? dl.suggestedFilename() : "sem evento de download");
  }
  // exclui o proprio
  const antes = await cards.count();
  await cards.first().getByRole("button", { name: "Excluir" }).click();
  await page.waitForTimeout(800);
  check("colaborador exclui o proprio arquivo", (await cards.count()) === antes - 1, `${antes} -> ${await cards.count()}`);
  while (await cards.count()) { await cards.first().getByRole("button", { name: "Excluir" }).click(); await page.waitForTimeout(600); }

  check("sem erros de pagina", errors.length === 0, errors.slice(0, 3).join(" | "));
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
