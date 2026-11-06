// Varre todas as telas do HUB em modo local (localhost): erros, textos cortados e capturas.
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const out = require("path").join(OUT, "varredura"); require("fs").mkdirSync(out, { recursive: true });
require("fs").mkdirSync(out, { recursive: true });

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  let current = "login";
  const errors = {};
  const push = (msg) => { (errors[current] = errors[current] || []).push(msg.slice(0, 220)); };
  page.on("pageerror", (e) => push("pageerror: " + e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon/.test(m.location().url)) push(`console: ${m.text()} @ ${m.location().url}`); });
  page.on("response", (r) => { if (r.status() >= 400 && !/favicon/.test(r.url())) push(`HTTP ${r.status()} ${r.url()}`); });

  await page.goto(BASE + "/");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);

  const labels = await page.locator(".sidebar nav button, .sidebar button").allInnerTexts();
  const menu = labels.map((l) => l.trim()).filter((l) => l && !/Sair/.test(l));
  console.log("Menu:", JSON.stringify(menu));

  for (const label of menu) {
    current = label;
    await page.locator(".sidebar button", { hasText: label }).first().click();
    await page.waitForTimeout(2000);
    const truncated = await page.evaluate(() => {
      const found = [];
      document.querySelectorAll(".workspace-body *").forEach((el) => {
        const style = getComputedStyle(el);
        if (!el.childElementCount && el.textContent.trim() && el.scrollWidth > el.clientWidth + 2 && style.overflow !== "visible" && el.clientWidth > 0) {
          found.push(`${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0]}: "${el.textContent.trim().slice(0, 50)}"`);
        }
      });
      return found.slice(0, 15);
    });
    const buttons = await page.locator(".workspace-body button").allInnerTexts();
    console.log(`\n=== ${label}`);
    console.log("botoes:", JSON.stringify([...new Set(buttons.map((b) => b.trim()).filter(Boolean))].slice(0, 40)));
    if (truncated.length) console.log("texto cortado:", truncated.join(" || "));
    if (errors[label]) console.log("ERROS:", errors[label].join(" || "));
    await page.screenshot({ path: `${out}\\${label.replace(/[^a-z0-9]+/gi, "_")}.png`, fullPage: true });
  }
  if (errors.login) console.log("ERROS login:", errors.login.join(" || "));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
