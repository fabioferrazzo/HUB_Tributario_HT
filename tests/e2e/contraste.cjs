// Mede o contraste de todo texto visivel em todas as telas do HUB e dos apps integrados (localhost).
const { CHROME, BASE, OUT } = require("./_config.cjs");
const { chromium } = require("playwright-core");

const scan = () => {
  const parse = (s) => (s.match(/[\d.]+/g) || []).map(Number);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const out = new Map();
  document.querySelectorAll("body *").forEach((el) => {
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim()).map((n) => n.textContent.trim()).join(" ");
    if (!own || own.length < 2) return;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    if (cs.visibility === "hidden" || cs.display === "none" || rect.width === 0 || rect.height === 0 || Number(cs.opacity) < 0.3) return;
    if (el.closest("[aria-hidden='true'], .sr-only, option, select, input, textarea")) return;
    let n = el;
    let bg = "";
    while (n && n !== document.documentElement) {
      const s = getComputedStyle(n);
      const c = s.backgroundColor;
      if (s.backgroundImage && s.backgroundImage !== "none" && !c.startsWith("rgba(0, 0, 0, 0)")) { bg = c; break; }
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent" && parse(c)[3] !== 0) { bg = c; break; }
      n = n.parentElement;
    }
    const fg = parse(cs.color);
    const back = parse(bg || "rgb(255,255,255)");
    if (fg.length > 3 && fg[3] < 1) { for (let i = 0; i < 3; i++) fg[i] = fg[i] * fg[3] + back[i] * (1 - fg[3]); }
    const a = lum(fg), c = lum(back);
    const ratio = (Math.max(a, c) + 0.05) / (Math.min(a, c) + 0.05);
    const size = parseFloat(cs.fontSize);
    const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
    const min = large ? 3 : 4.5;
    if (ratio < min) {
      const key = `${String(el.className).split(" ")[0] || el.tagName.toLowerCase()} | ${cs.color} sobre ${bg || "branco"}`;
      if (!out.has(key)) out.set(key, `${ratio.toFixed(2)}:1 (${size}px) ${key} | "${own.slice(0, 45)}"`);
    }
  });
  return Array.from(out.values()).sort();
};

(async () => {
  const browser = await chromium.launch({ executablePath: CHROME, headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 950 } });
  await page.goto(BASE + "/");
  await page.fill('input[type="password"]', "hub-demo-2026");
  await page.click('button[type="submit"]');
  await page.waitForTimeout(1500);
  const menu = ["Pautas", "Calendário de Tarefas", "Arquivos", "Links úteis", "Configurações"];
  for (const label of menu) {
    await page.locator(".sidebar button", { hasText: label }).first().click();
    await page.waitForTimeout(1500);
    const found = await page.evaluate(scan);
    console.log(`\n=== ${label} (${found.length})\n` + found.join("\n"));
    if (label === "Pautas") {
      await page.getByRole("tab", { name: "Quadro de Avisos" }).click();
      await page.waitForTimeout(800);
      const q = await page.evaluate(scan);
      console.log(`\n=== Quadro de Avisos (${q.length})\n` + q.join("\n"));
    }
  }
  for (const app of ["agenda-tributaria", "pomodoro", "coord-tributaria"]) {
    const p2 = await browser.newPage({ viewport: { width: 1300, height: 900 } });
    await p2.goto(`${BASE}/apps/${app}.html`);
    await p2.waitForTimeout(2500);
    const found = await p2.evaluate(scan);
    console.log(`\n=== app ${app} (${found.length})\n` + found.join("\n"));
    await p2.close();
  }
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
