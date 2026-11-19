// Calendário de Tarefas: título e descrição da tarefa aparecem como texto (nunca executam código).
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);
(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  page.on("dialog", (d) => d.accept());
  await page.goto(BASE + "/"); await page.waitForTimeout(600);
  await page.fill('input[type="password"]', "hub-demo-2026"); await page.click('button[type="submit"]'); await page.waitForTimeout(1500);
  await page.locator(".sidebar button", { hasText: "Calendário de Tarefas" }).first().click(); await page.waitForTimeout(1500);
  await page.getByRole("button", { name: "Nova tarefa" }).click(); await page.waitForTimeout(400);
  const form = page.locator("form.task-form").first();
  const titulo = '[TESTE] <img src=x onerror="window.top.__xss=(window.top.__xss||0)+1"> & "aspas"';
  await form.getByLabel("Título").fill(titulo);
  const d = new Date(); d.setHours(10, 0, 0, 0);
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  await form.locator("input[type=datetime-local]").fill(local);
  await page.getByRole("button", { name: "Salvar tarefa" }).click(); await page.waitForTimeout(1500);
  const frame = page.frames().find((f) => /calendar/.test(f.url()));
  check("calendário embutido carregado", !!frame);
  if (frame) {
    await frame.getByText("Agenda", { exact: true }).first().click().catch(() => {}); await page.waitForTimeout(800);
    const texto = await frame.locator("body").innerText();
    const ok = texto.includes("<img src=x onerror=");
    check("título aparece como texto", ok, ok ? "" : texto.slice(0, 80).replace(/\n/g, " "));
  }
  check("nenhum código executado pelo título", (await page.evaluate(() => window.__xss || 0)) === 0);
  console.log(results.join("\n"));
  await browser.close();
  process.exit(results.some((r) => r.startsWith("FALHA")) ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
