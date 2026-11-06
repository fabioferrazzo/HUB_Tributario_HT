// Abre cada app interno (public/apps) e acusa erros de JavaScript ou textos com mojibake.
const { CHROME, BASE } = require("./_config.cjs");
const { chromium } = require("playwright-core");
const results = [];
const check = (name, ok, detail = "") => results.push(`${ok ? "OK   " : "FALHA"} ${name}${detail ? " -> " + detail : ""}`);

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const registry = require("fs").readFileSync(require("path").join(__dirname, "..", "..", "src", "app", "appsRegistry.ts"), "utf8");
  const fromRegistry = [...registry.matchAll(/src: [`"]\/apps\/([a-z0-9-]+)\.html/g)].map((m) => m[1]);
  for (const app of [...new Set([...fromRegistry, "calendar"])]) {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (m) => { if (m.type() === "error" && !/favicon|api\/|Failed to load resource/.test(m.text())) errors.push(m.text()); });
    await page.goto(`${BASE}/apps/${app}.html`);
    await page.waitForTimeout(1500);
    const text = await page.locator("body").innerText();
    check(`${app}: abre sem erros de JavaScript`, errors.length === 0, errors.slice(0, 2).join(" | "));
    check(`${app}: sem mojibake`, !/Ã[\u0080-¿§£©¡ª³º]|�|Â·/.test(text));
    await page.close();
  }
  console.log(results.join("\n"));
  await browser.close();
})().catch((e) => { console.log(results.join("\n")); console.error("ERRO:", e.message); process.exit(1); });
